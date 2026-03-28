import { canvasToBlob, decodeRuntimeImageBitmapFromBlob } from '../services/canvasRuntime';
import type { ImageUpscaleAiModel } from '../services/imageUpscaler';
import type {
  ImageUpscalerAiWorkerProcessMessage,
  ImageUpscalerAiWorkerRequest,
  ImageUpscalerAiWorkerResponse
} from '../services/imageUpscalerWorkerProtocol';

interface AiUpscalerTensorRuntime {
  ready: Promise<void>;
  upscale: (
    image: ImageBitmap | OffscreenCanvas,
    options?: {
      patchSize?: number;
      padding?: number;
      progress?: (amount: number) => void;
      awaitNextFrame?: boolean;
      output?: 'tensor';
    }
  ) => Promise<{
    shape: [number, number, number];
    dispose: () => void;
  }>;
}

const aiUpscalerCache = new Map<string, Promise<AiUpscalerTensorRuntime>>();
let aiDeblurCache: Promise<AiUpscalerTensorRuntime> | null = null;

const clampUnit = (value: number) => Math.max(0, Math.min(1, value));
const mapProgress = (value: number, start: number, end: number) => start + (end - start) * clampUnit(value);

const postToMain = (message: ImageUpscalerAiWorkerResponse, transferables: Transferable[] = []) => {
  (self as unknown as Worker).postMessage(message, transferables);
};

const get2dContext = (canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D => {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('Failed to create an offscreen canvas context.');
  }
  return context;
};

const createCanvas = (width: number, height: number) =>
  new OffscreenCanvas(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));

const drawBitmapToCanvas = (bitmap: ImageBitmap): OffscreenCanvas => {
  const canvas = createCanvas(bitmap.width, bitmap.height);
  const context = get2dContext(canvas);
  context.drawImage(bitmap, 0, 0);
  return canvas;
};

const resizeCanvas = (source: OffscreenCanvas, width: number, height: number): OffscreenCanvas => {
  if (source.width === width && source.height === height) {
    return source;
  }
  const resized = createCanvas(width, height);
  const context = get2dContext(resized);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, source.width, source.height, 0, 0, width, height);
  return resized;
};

const tensorToCanvas = async (
  tf: typeof import('@tensorflow/tfjs'),
  tensor: { shape: [number, number, number]; dispose: () => void }
): Promise<OffscreenCanvas> => {
  const [height, width] = tensor.shape;
  const canvas = createCanvas(width, height);
  await tf.browser.toPixels(tensor as any, canvas as any);
  tensor.dispose();
  return canvas;
};

const getAiUpscalePatchSettings = (model: ImageUpscaleAiModel, scaleFactor: 2 | 4) => {
  if (model === 'thick') {
    return scaleFactor === 4
      ? { patchSize: 64, padding: 12 }
      : { patchSize: 96, padding: 12 };
  }

  if (model === 'medium') {
    return scaleFactor === 4
      ? { patchSize: 80, padding: 12 }
      : { patchSize: 112, padding: 12 };
  }

  return scaleFactor === 4
    ? { patchSize: 96, padding: 12 }
    : { patchSize: 128, padding: 12 };
};

const getAiDeblurPatchSettings = () => ({
  patchSize: 96,
  padding: 12
});

const resolveAiUpscaleModelImport = (model: ImageUpscaleAiModel, scaleFactor: 2 | 4) => {
  if (model === 'medium') {
    return scaleFactor === 4
      ? import('@upscalerjs/esrgan-medium/4x')
      : import('@upscalerjs/esrgan-medium/2x');
  }

  if (model === 'thick') {
    return scaleFactor === 4
      ? import('@upscalerjs/esrgan-thick/4x')
      : import('@upscalerjs/esrgan-thick/2x');
  }

  return scaleFactor === 4
    ? import('@upscalerjs/esrgan-slim/4x')
    : import('@upscalerjs/esrgan-slim/2x');
};

const getAiUpscaler = (model: ImageUpscaleAiModel, scaleFactor: 2 | 4): Promise<AiUpscalerTensorRuntime> => {
  const cacheKey = `${model}-${scaleFactor}`;
  const cached = aiUpscalerCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const runtimePromise = (async () => {
    const tf = await import('@tensorflow/tfjs');
    await tf.ready();

    const [{ default: Upscaler }, modelModule] = await Promise.all([
      import('upscaler'),
      resolveAiUpscaleModelImport(model, scaleFactor)
    ]);

    const upscaler = new Upscaler({
      model: modelModule.default
    }) as AiUpscalerTensorRuntime;
    await upscaler.ready;
    return upscaler;
  })();

  aiUpscalerCache.set(cacheKey, runtimePromise);
  return runtimePromise;
};

const getAiDeblurrer = (): Promise<AiUpscalerTensorRuntime> => {
  if (aiDeblurCache) {
    return aiDeblurCache;
  }

  aiDeblurCache = (async () => {
    const tf = await import('@tensorflow/tfjs');
    await tf.ready();

    const [{ default: Upscaler }, modelModule] = await Promise.all([
      import('upscaler'),
      import('@upscalerjs/maxim-deblurring')
    ]);

    const upscaler = new Upscaler({
      model: modelModule.default
    }) as AiUpscalerTensorRuntime;
    await upscaler.ready;
    return upscaler;
  })();

  return aiDeblurCache;
};

const MAX_DEBLUR_LONG_SIDE = 960;

const prepareDeblurInput = (source: OffscreenCanvas) => {
  const longSide = Math.max(source.width, source.height);
  if (longSide <= MAX_DEBLUR_LONG_SIDE) {
    return {
      canvas: source,
      deblurScaleApplied: 1
    };
  }

  const scale = MAX_DEBLUR_LONG_SIDE / longSide;
  return {
    canvas: resizeCanvas(source, Math.max(1, Math.round(source.width * scale)), Math.max(1, Math.round(source.height * scale))),
    deblurScaleApplied: scale
  };
};

const processAiUpscale = async (message: ImageUpscalerAiWorkerProcessMessage) => {
  const tf = await import('@tensorflow/tfjs');
  await tf.ready();

  const blob = new Blob([message.payload.imageBuffer], { type: message.payload.mimeType || 'image/png' });
  const bitmap = await decodeRuntimeImageBitmapFromBlob(blob);

  try {
    let workingCanvas = drawBitmapToCanvas(bitmap);
    let deblurScaleApplied = 1;

    if (message.payload.useAiDeblur) {
      const preparedDeblur = prepareDeblurInput(workingCanvas);
      workingCanvas = preparedDeblur.canvas;
      deblurScaleApplied = preparedDeblur.deblurScaleApplied;

      postToMain({
        type: 'progress',
        id: message.id,
        progress: 0.12,
        label:
          deblurScaleApplied < 1
            ? `Preparing MAXIM Deblur ${Math.round(deblurScaleApplied * 100)}% scale`
            : 'Loading MAXIM Deblur'
      });

      const deblurrer = await getAiDeblurrer();
      const deblurredTensor = await deblurrer.upscale(workingCanvas as ImageBitmap | OffscreenCanvas, {
        ...getAiDeblurPatchSettings(),
        output: 'tensor',
        progress: (amount) => {
          postToMain({
            type: 'progress',
            id: message.id,
            progress: mapProgress(amount, 0.18, 0.46),
            label: `MAXIM Deblur ${Math.round(clampUnit(amount) * 100)}%`
          });
        },
        awaitNextFrame: false
      });

      let deblurredCanvas = await tensorToCanvas(tf, deblurredTensor);
      if (deblurScaleApplied < 1) {
        deblurredCanvas = resizeCanvas(deblurredCanvas, bitmap.width, bitmap.height);
      }
      workingCanvas = deblurredCanvas;
    }

    postToMain({
      type: 'progress',
      id: message.id,
      progress: message.payload.useAiDeblur ? 0.52 : 0.18,
      label: 'Loading ESRGAN model'
    });

    const upscaler = await getAiUpscaler(message.payload.aiModel, message.payload.scaleFactor);
    const upscaledTensor = await upscaler.upscale(workingCanvas as ImageBitmap | OffscreenCanvas, {
      ...getAiUpscalePatchSettings(message.payload.aiModel, message.payload.scaleFactor),
      output: 'tensor',
      progress: (amount) => {
        postToMain({
          type: 'progress',
          id: message.id,
          progress: mapProgress(amount, message.payload.useAiDeblur ? 0.58 : 0.24, 0.94),
          label: `Upscaling ${Math.round(clampUnit(amount) * 100)}%`
        });
      },
      awaitNextFrame: false
    });

    postToMain({
      type: 'progress',
      id: message.id,
      progress: 0.97,
      label: 'Encoding AI output'
    });

    const upscaledCanvas = await tensorToCanvas(tf, upscaledTensor);
    const resultBlob = await canvasToBlob(upscaledCanvas, 'image/png');
    const resultBuffer = await resultBlob.arrayBuffer();

    postToMain(
      {
        type: 'result',
        id: message.id,
        payload: {
          imageBuffer: resultBuffer,
          mimeType: 'image/png',
          width: upscaledCanvas.width,
          height: upscaledCanvas.height,
          deblurScaleApplied
        }
      },
      [resultBuffer]
    );
  } finally {
    bitmap.close();
  }
};

self.onmessage = async (event: MessageEvent<ImageUpscalerAiWorkerRequest>) => {
  const message = event.data;
  if (message.type !== 'process') {
    return;
  }

  try {
    await processAiUpscale(message);
  } catch (error) {
    postToMain({
      type: 'error',
      id: message.id,
      message: error instanceof Error ? error.message : 'AI upscaler worker failed.'
    });
  }
};
