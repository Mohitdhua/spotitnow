import { canvasToBlob } from './canvasRuntime';
import type {
  ImageUpscalerAiWorkerResponse,
  ImageUpscalerAiWorkerResultMessage
} from './imageUpscalerWorkerProtocol';

export type ImageUpscaleEngine = 'fast_enhance' | 'ai_super_resolution';
export type ImageUpscaleAiModel = 'slim' | 'medium' | 'thick';

export interface ImageUpscaleOptions {
  engine: ImageUpscaleEngine;
  scaleFactor: 2 | 4;
  aiModel: ImageUpscaleAiModel;
  useAiDeblur: boolean;
  noiseReduction: number;
  detailBoost: number;
  localContrast: number;
  edgeThreshold: number;
}

export interface ImageUpscaleResult {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

export type ImageUpscaleProgressHandler = (progress: number, label: string) => void;

interface AiUpscalerRuntime {
  ready: Promise<void>;
  upscale: (
    image: string | HTMLImageElement | HTMLCanvasElement,
    options?: {
      patchSize?: number;
      padding?: number;
      progress?: (amount: number) => void;
      awaitNextFrame?: boolean;
    }
  ) => Promise<string>;
}

const aiUpscalerCache = new Map<string, Promise<AiUpscalerRuntime>>();
let aiDeblurCache: Promise<AiUpscalerRuntime> | null = null;
let aiUpscaleWorker: Worker | null = null;
let aiUpscaleWorkerRequestId = 1;

const pendingAiUpscaleRequests = new Map<
  number,
  {
    resolve: (payload: ImageUpscalerAiWorkerResultMessage['payload']) => void;
    reject: (error: Error) => void;
    onProgress?: ImageUpscaleProgressHandler;
  }
>();

const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
const clampUnit = (value: number) => Math.max(0, Math.min(1, value));
const clampInt = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(value)));
const mapProgress = (value: number, start: number, end: number) => start + (end - start) * clampUnit(value);
const reportProgress = (
  onProgress: ImageUpscaleProgressHandler | undefined,
  progress: number,
  label: string
) => {
  onProgress?.(clampUnit(progress), label);
};
const yieldToBrowser = () =>
  new Promise<void>((resolve) => {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });

const supportsAiWorkerRuntime = () =>
  typeof Worker !== 'undefined' &&
  typeof OffscreenCanvas !== 'undefined' &&
  typeof createImageBitmap !== 'undefined';

const resetAiUpscaleWorker = (error?: Error) => {
  if (aiUpscaleWorker) {
    aiUpscaleWorker.terminate();
    aiUpscaleWorker = null;
  }

  if (error) {
    pendingAiUpscaleRequests.forEach((request) => request.reject(error));
    pendingAiUpscaleRequests.clear();
  }
};

const ensureAiUpscaleWorker = () => {
  if (aiUpscaleWorker) {
    return aiUpscaleWorker;
  }

  const worker = new Worker(new URL('../workers/imageUpscaler.worker.ts', import.meta.url), {
    type: 'module'
  });

  worker.onmessage = (event: MessageEvent<ImageUpscalerAiWorkerResponse>) => {
    const message = event.data;
    const request = pendingAiUpscaleRequests.get(message.id);
    if (!request) {
      return;
    }

    if (message.type === 'progress') {
      request.onProgress?.(message.progress, message.label);
      return;
    }

    pendingAiUpscaleRequests.delete(message.id);
    if (message.type === 'result') {
      request.resolve(message.payload);
      return;
    }

    request.reject(new Error(message.message));
  };

  worker.onerror = (event) => {
    const detail = event.message ? ` ${event.message}` : '';
    resetAiUpscaleWorker(new Error(`AI upscaler worker crashed.${detail}`));
  };

  aiUpscaleWorker = worker;
  return worker;
};

const createCanvas = (width: number, height: number): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
};

const get2dContext = (canvas: HTMLCanvasElement): CanvasRenderingContext2D => {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Failed to create a canvas context.');
  }
  return ctx;
};

export const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve((event.target?.result as string) ?? '');
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });

export const readImageDimensions = (src: string): Promise<{ width: number; height: number }> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () =>
      resolve({
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height
      });
    image.onerror = () => reject(new Error('Failed to read image dimensions.'));
    image.src = src;
  });

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load image.'));
    image.src = src;
  });

const canvasFromBlob = async (blob: Blob): Promise<HTMLCanvasElement> => {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await loadImage(objectUrl);
    return canvasFromImage(image);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

const upscaleAiCanvasInWorker = async (
  source: HTMLCanvasElement,
  options: ImageUpscaleOptions,
  onProgress?: ImageUpscaleProgressHandler
) => {
  const worker = ensureAiUpscaleWorker();
  const sourceBlob = await canvasToBlob(source, 'image/png');
  const imageBuffer = await sourceBlob.arrayBuffer();
  const requestId = aiUpscaleWorkerRequestId;
  aiUpscaleWorkerRequestId += 1;

  return await new Promise<ImageUpscalerAiWorkerResultMessage['payload']>((resolve, reject) => {
    pendingAiUpscaleRequests.set(requestId, {
      resolve,
      reject,
      onProgress
    });

    worker.postMessage(
      {
        type: 'process',
        id: requestId,
        payload: {
          imageBuffer,
          mimeType: sourceBlob.type || 'image/png',
          aiModel: options.aiModel,
          scaleFactor: options.scaleFactor,
          useAiDeblur: options.useAiDeblur
        }
      },
      [imageBuffer]
    );
  });
};

const canvasFromImage = (image: HTMLImageElement): HTMLCanvasElement => {
  const canvas = createCanvas(image.naturalWidth || image.width, image.naturalHeight || image.height);
  const ctx = get2dContext(canvas);
  ctx.drawImage(image, 0, 0);
  return canvas;
};

const copyCanvas = (source: HTMLCanvasElement): HTMLCanvasElement => {
  const copy = createCanvas(source.width, source.height);
  const ctx = get2dContext(copy);
  ctx.drawImage(source, 0, 0);
  return copy;
};

const cropCanvas = (
  source: HTMLCanvasElement,
  x: number,
  y: number,
  width: number,
  height: number
): HTMLCanvasElement => {
  const safeX = clampInt(x, 0, source.width - 1);
  const safeY = clampInt(y, 0, source.height - 1);
  const safeWidth = clampInt(width, 1, source.width - safeX);
  const safeHeight = clampInt(height, 1, source.height - safeY);
  const cropped = createCanvas(safeWidth, safeHeight);
  const ctx = get2dContext(cropped);
  ctx.drawImage(source, safeX, safeY, safeWidth, safeHeight, 0, 0, safeWidth, safeHeight);
  return cropped;
};

const getEdgeBleedSteps = (distance: number) => {
  const steps: number[] = [];
  let remaining = Math.max(0, Math.round(distance));
  let step = 1;

  while (remaining > 0) {
    const nextStep = Math.min(step, remaining);
    steps.push(nextStep);
    remaining -= nextStep;
    step *= 2;
  }

  return steps;
};

const analyzeCanvasTransparency = (source: HTMLCanvasElement) => {
  const ctx = get2dContext(source);
  const imageData = ctx.getImageData(0, 0, source.width, source.height);
  let hasTransparency = false;
  let weightSum = 0;
  let redSum = 0;
  let greenSum = 0;
  let blueSum = 0;

  for (let index = 0; index < imageData.data.length; index += 4) {
    const alpha = imageData.data[index + 3];
    if (alpha < 255) {
      hasTransparency = true;
    }
    if (alpha === 0) {
      continue;
    }

    const weight = alpha / 255;
    redSum += imageData.data[index] * weight;
    greenSum += imageData.data[index + 1] * weight;
    blueSum += imageData.data[index + 2] * weight;
    weightSum += weight;
  }

  if (weightSum <= 0) {
    return {
      hasTransparency,
      averageColor: [255, 255, 255] as const
    };
  }

  return {
    hasTransparency,
    averageColor: [
      clampByte(redSum / weightSum),
      clampByte(greenSum / weightSum),
      clampByte(blueSum / weightSum)
    ] as const
  };
};

const buildAlphaMaskCanvas = (source: HTMLCanvasElement): HTMLCanvasElement => {
  const mask = copyCanvas(source);
  const ctx = get2dContext(mask);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, mask.width, mask.height);
  ctx.globalCompositeOperation = 'source-over';
  return mask;
};

const bleedTransparentPixels = (source: HTMLCanvasElement, distance: number): HTMLCanvasElement => {
  const output = copyCanvas(source);
  const outputCtx = get2dContext(output);
  const scratch = createCanvas(source.width, source.height);
  const scratchCtx = get2dContext(scratch);
  const directions = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1]
  ] as const;

  for (const step of getEdgeBleedSteps(distance)) {
    scratchCtx.clearRect(0, 0, scratch.width, scratch.height);
    scratchCtx.drawImage(output, 0, 0);
    scratchCtx.globalCompositeOperation = 'destination-over';

    for (const [dx, dy] of directions) {
      scratchCtx.drawImage(output, dx * step, dy * step);
    }

    scratchCtx.globalCompositeOperation = 'source-over';
    outputCtx.clearRect(0, 0, output.width, output.height);
    outputCtx.drawImage(scratch, 0, 0);
  }

  return output;
};

const flattenCanvas = (source: HTMLCanvasElement, fillColor: readonly [number, number, number]): HTMLCanvasElement => {
  const flattened = createCanvas(source.width, source.height);
  const ctx = get2dContext(flattened);
  ctx.fillStyle = `rgb(${fillColor[0]}, ${fillColor[1]}, ${fillColor[2]})`;
  ctx.fillRect(0, 0, flattened.width, flattened.height);
  ctx.drawImage(source, 0, 0);
  return flattened;
};

const extendCanvasEdges = (source: HTMLCanvasElement, padding: number): HTMLCanvasElement => {
  const safePadding = Math.max(0, Math.round(padding));
  if (safePadding <= 0) {
    return source;
  }

  const extended = createCanvas(source.width + safePadding * 2, source.height + safePadding * 2);
  const ctx = get2dContext(extended);
  const rightX = safePadding + source.width;
  const bottomY = safePadding + source.height;
  ctx.drawImage(source, safePadding, safePadding);

  ctx.drawImage(source, 0, 0, 1, source.height, 0, safePadding, safePadding, source.height);
  ctx.drawImage(source, source.width - 1, 0, 1, source.height, rightX, safePadding, safePadding, source.height);
  ctx.drawImage(source, 0, 0, source.width, 1, safePadding, 0, source.width, safePadding);
  ctx.drawImage(source, 0, source.height - 1, source.width, 1, safePadding, bottomY, source.width, safePadding);

  ctx.drawImage(source, 0, 0, 1, 1, 0, 0, safePadding, safePadding);
  ctx.drawImage(source, source.width - 1, 0, 1, 1, rightX, 0, safePadding, safePadding);
  ctx.drawImage(source, 0, source.height - 1, 1, 1, 0, bottomY, safePadding, safePadding);
  ctx.drawImage(source, source.width - 1, source.height - 1, 1, 1, rightX, bottomY, safePadding, safePadding);

  return extended;
};

const applyAlphaMask = (source: HTMLCanvasElement, alphaMask: HTMLCanvasElement): HTMLCanvasElement => {
  const output = copyCanvas(source);
  const ctx = get2dContext(output);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(alphaMask, 0, 0, alphaMask.width, alphaMask.height, 0, 0, output.width, output.height);
  ctx.globalCompositeOperation = 'source-over';
  return output;
};

interface PreparedSourceCanvas {
  colorCanvas: HTMLCanvasElement;
  alphaMaskCanvas: HTMLCanvasElement | null;
  overscan: number;
}

interface SourceLineArtGuide {
  darkMaskCanvas: HTMLCanvasElement;
  colorGuideCanvas: HTMLCanvasElement;
}

const getTransparencyBleedDistance = (scaleFactor: 2 | 4) => (scaleFactor === 4 ? 24 : 16);
const getAiOverscan = (scaleFactor: 2 | 4) => (scaleFactor === 4 ? 16 : 12);

const prepareSourceCanvas = (
  source: HTMLCanvasElement,
  scaleFactor: 2 | 4,
  addAiOverscan: boolean
): PreparedSourceCanvas => {
  const { hasTransparency, averageColor } = analyzeCanvasTransparency(source);
  const alphaMaskCanvas = hasTransparency ? buildAlphaMaskCanvas(source) : null;
  let colorCanvas = source;

  if (hasTransparency) {
    const bled = bleedTransparentPixels(source, getTransparencyBleedDistance(scaleFactor));
    colorCanvas = flattenCanvas(bled, averageColor);
  }

  const overscan = addAiOverscan ? getAiOverscan(scaleFactor) : 0;
  if (overscan > 0) {
    colorCanvas = extendCanvasEdges(colorCanvas, overscan);
  }

  return {
    colorCanvas,
    alphaMaskCanvas,
    overscan
  };
};

const resizeCanvasHighQuality = (
  source: HTMLCanvasElement,
  targetWidth: number,
  targetHeight: number
): HTMLCanvasElement => {
  if (source.width === targetWidth && source.height === targetHeight) {
    return source;
  }

  const resized = createCanvas(targetWidth, targetHeight);
  const context = get2dContext(resized);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, source.width, source.height, 0, 0, targetWidth, targetHeight);
  return resized;
};

const resizeCanvasCrisp = (
  source: HTMLCanvasElement,
  targetWidth: number,
  targetHeight: number
): HTMLCanvasElement => {
  if (source.width === targetWidth && source.height === targetHeight) {
    return source;
  }

  const resized = createCanvas(targetWidth, targetHeight);
  const context = get2dContext(resized);
  context.imageSmoothingEnabled = false;
  context.drawImage(source, 0, 0, source.width, source.height, 0, 0, targetWidth, targetHeight);
  return resized;
};

const buildSourceLineArtGuide = (source: HTMLCanvasElement): SourceLineArtGuide => {
  const blurred = createBlurredCanvas(source, 0.9);
  const sourceCtx = get2dContext(source);
  const blurredCtx = get2dContext(blurred);
  const sourceData = sourceCtx.getImageData(0, 0, source.width, source.height);
  const blurredData = blurredCtx.getImageData(0, 0, blurred.width, blurred.height);

  const darkMaskCanvas = createCanvas(source.width, source.height);
  const darkMaskCtx = get2dContext(darkMaskCanvas);
  const darkMask = darkMaskCtx.createImageData(source.width, source.height);

  for (let index = 0; index < sourceData.data.length; index += 4) {
    const r = sourceData.data[index];
    const g = sourceData.data[index + 1];
    const b = sourceData.data[index + 2];
    const a = sourceData.data[index + 3];
    const blurR = blurredData.data[index];
    const blurG = blurredData.data[index + 1];
    const blurB = blurredData.data[index + 2];
    const luma = r * 0.299 + g * 0.587 + b * 0.114;
    const blurLuma = blurR * 0.299 + blurG * 0.587 + blurB * 0.114;
    const lumaDelta = Math.abs(luma - blurLuma);
    const edgeWeight = clampUnit((lumaDelta - 3) / 16);
    const maxChannel = Math.max(r, g, b);
    const minChannel = Math.min(r, g, b);
    const saturation = (maxChannel - minChannel) / 255;

    const inkTone = clampUnit((152 - luma) / 152);
    const darkBias = clampUnit((blurLuma - luma + 8) / 30);
    const darkBase = edgeWeight * Math.max(inkTone * 0.92, darkBias) * (0.72 + saturation * 0.28);

    const darkValue =
      darkBase > 0.48 ? 1 : darkBase > 0.26 ? clampUnit(0.42 + darkBase * 0.9) : clampUnit(darkBase * 0.55);

    const darkByte = clampByte(darkValue * 255);

    darkMask.data[index] = darkByte;
    darkMask.data[index + 1] = darkByte;
    darkMask.data[index + 2] = darkByte;
    darkMask.data[index + 3] = a;
  }

  darkMaskCtx.putImageData(darkMask, 0, 0);

  return {
    darkMaskCanvas,
    colorGuideCanvas: copyCanvas(source)
  };
};

const getAiUpscalePatchSettings = (model: ImageUpscaleAiModel, scaleFactor: 2 | 4) => {
  if (model === 'thick') {
    return scaleFactor === 4
      ? {
          patchSize: 64,
          padding: 12
        }
      : {
          patchSize: 96,
          padding: 12
        };
  }

  if (model === 'medium') {
    return scaleFactor === 4
      ? {
          patchSize: 80,
          padding: 12
        }
      : {
          patchSize: 112,
          padding: 12
        };
  }

  return scaleFactor === 4
    ? {
        patchSize: 96,
        padding: 12
      }
    : {
        patchSize: 128,
        padding: 12
      };
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

const getAiUpscaler = (model: ImageUpscaleAiModel, scaleFactor: 2 | 4): Promise<AiUpscalerRuntime> => {
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
    }) as AiUpscalerRuntime;
    await upscaler.ready;
    return upscaler;
  })();

  aiUpscalerCache.set(cacheKey, runtimePromise);
  return runtimePromise;
};

const getAiDeblurrer = (): Promise<AiUpscalerRuntime> => {
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
    }) as AiUpscalerRuntime;
    await upscaler.ready;
    return upscaler;
  })();

  return aiDeblurCache;
};

const progressiveResize = async (
  source: HTMLCanvasElement,
  targetWidth: number,
  targetHeight: number,
  onProgress?: ImageUpscaleProgressHandler
): Promise<HTMLCanvasElement> => {
  let current = source;
  let currentWidth = source.width;
  let currentHeight = source.height;
  let totalSteps = 0;
  let probeWidth = source.width;
  let probeHeight = source.height;

  while (probeWidth < targetWidth || probeHeight < targetHeight) {
    probeWidth = Math.min(targetWidth, probeWidth * 2);
    probeHeight = Math.min(targetHeight, probeHeight * 2);
    totalSteps += 1;
  }

  if (probeWidth !== targetWidth || probeHeight !== targetHeight) {
    totalSteps += 1;
  }

  totalSteps = Math.max(1, totalSteps);
  let completedSteps = 0;

  while (currentWidth < targetWidth || currentHeight < targetHeight) {
    const nextWidth = Math.min(targetWidth, currentWidth * 2);
    const nextHeight = Math.min(targetHeight, currentHeight * 2);
    const nextCanvas = createCanvas(nextWidth, nextHeight);
    const nextCtx = get2dContext(nextCanvas);
    nextCtx.imageSmoothingEnabled = true;
    nextCtx.imageSmoothingQuality = 'high';
    nextCtx.drawImage(current, 0, 0, currentWidth, currentHeight, 0, 0, nextWidth, nextHeight);
    current = nextCanvas;
    currentWidth = nextWidth;
    currentHeight = nextHeight;
    completedSteps += 1;
    reportProgress(onProgress, completedSteps / totalSteps, `Resizing ${currentWidth}x${currentHeight}`);
    if (completedSteps < totalSteps) {
      await yieldToBrowser();
    }
  }

  if (currentWidth === targetWidth && currentHeight === targetHeight) {
    reportProgress(onProgress, 1, `Resizing ${targetWidth}x${targetHeight}`);
    return current;
  }

  const finalCanvas = createCanvas(targetWidth, targetHeight);
  const finalCtx = get2dContext(finalCanvas);
  finalCtx.imageSmoothingEnabled = true;
  finalCtx.imageSmoothingQuality = 'high';
  finalCtx.drawImage(current, 0, 0, currentWidth, currentHeight, 0, 0, targetWidth, targetHeight);
  reportProgress(onProgress, 1, `Resizing ${targetWidth}x${targetHeight}`);
  return finalCanvas;
};

const createBlurredCanvas = (source: HTMLCanvasElement, radius: number): HTMLCanvasElement => {
  const blurred = createCanvas(source.width, source.height);
  const ctx = get2dContext(blurred);
  ctx.filter = `blur(${Math.max(0, radius).toFixed(2)}px)`;
  ctx.drawImage(source, 0, 0);
  ctx.filter = 'none';
  return blurred;
};

const reduceNoiseCanvas = async (
  source: HTMLCanvasElement,
  options: ImageUpscaleOptions,
  onProgress?: ImageUpscaleProgressHandler
): Promise<HTMLCanvasElement> => {
  const strength = clampUnit(Math.max(0, options.noiseReduction) / 100);
  if (strength <= 0) {
    reportProgress(onProgress, 1, 'Skipping noise reduction');
    return source;
  }

  reportProgress(onProgress, 0.08, 'Preparing noise reduction');
  const radius =
    options.engine === 'ai_super_resolution'
      ? 0.8 + strength * 1.35
      : 0.65 + strength * 1.05;
  const blurred = createBlurredCanvas(source, radius);
  reportProgress(onProgress, 0.2, 'Building denoise reference');
  await yieldToBrowser();

  const sourceCtx = get2dContext(source);
  const blurredCtx = get2dContext(blurred);
  const output = createCanvas(source.width, source.height);
  const outputCtx = get2dContext(output);
  const sourceData = sourceCtx.getImageData(0, 0, source.width, source.height);
  const blurredData = blurredCtx.getImageData(0, 0, blurred.width, blurred.height);
  const result = outputCtx.createImageData(source.width, source.height);
  const baseBlend = 0.2 + strength * 0.62;
  const protectStart = 4 + (1 - strength) * 10;
  const protectRange = 20 + (1 - strength) * 12;
  const chunkRows = Math.max(16, Math.min(128, Math.round(65536 / Math.max(1, source.width))));

  for (let row = 0; row < source.height; row += chunkRows) {
    const rowEnd = Math.min(source.height, row + chunkRows);

    for (let y = row; y < rowEnd; y += 1) {
      const rowOffset = y * source.width * 4;
      for (let x = 0; x < source.width; x += 1) {
        const index = rowOffset + x * 4;
        const r = sourceData.data[index];
        const g = sourceData.data[index + 1];
        const b = sourceData.data[index + 2];
        const a = sourceData.data[index + 3];
        const blurR = blurredData.data[index];
        const blurG = blurredData.data[index + 1];
        const blurB = blurredData.data[index + 2];
        const luma = r * 0.299 + g * 0.587 + b * 0.114;
        const blurLuma = blurR * 0.299 + blurG * 0.587 + blurB * 0.114;
        const lumaDelta = Math.abs(luma - blurLuma);
        const chromaDelta = (Math.abs(r - blurR) + Math.abs(g - blurG) + Math.abs(b - blurB)) / 3;
        const signalDelta = Math.max(lumaDelta, chromaDelta * 0.92);
        const edgeProtection = clampUnit((signalDelta - protectStart) / protectRange);
        const blend = baseBlend * (1 - edgeProtection);

        result.data[index] = clampByte(r + (blurR - r) * blend);
        result.data[index + 1] = clampByte(g + (blurG - g) * blend);
        result.data[index + 2] = clampByte(b + (blurB - b) * blend);
        result.data[index + 3] = a;
      }
    }

    reportProgress(
      onProgress,
      mapProgress(rowEnd / Math.max(1, source.height), 0.2, 0.95),
      `Reducing noise ${Math.round((rowEnd / Math.max(1, source.height)) * 100)}%`
    );
    if (rowEnd < source.height) {
      await yieldToBrowser();
    }
  }

  outputCtx.putImageData(result, 0, 0);
  reportProgress(onProgress, 1, 'Noise reduction complete');
  return output;
};

const enhanceUpscaledCanvas = async (
  source: HTMLCanvasElement,
  options: ImageUpscaleOptions,
  onProgress?: ImageUpscaleProgressHandler
): Promise<HTMLCanvasElement> => {
  const detailStrength = Math.max(0, options.detailBoost) / 100;
  const contrastStrength = Math.max(0, options.localContrast) / 100;
  const noiseReductionStrength = clampUnit(Math.max(0, options.noiseReduction) / 100);

  if (detailStrength <= 0 && contrastStrength <= 0) {
    reportProgress(onProgress, 1, 'Skipping detail enhancement');
    return source;
  }

  reportProgress(onProgress, 0.08, 'Preparing detail enhancement');
  const radius =
    options.scaleFactor === 4
      ? 1.8 + detailStrength * 0.8 + contrastStrength * 0.4
      : 1.05 + detailStrength * 0.55 + contrastStrength * 0.25;
  const blurred = createBlurredCanvas(source, radius);
  reportProgress(onProgress, 0.2, 'Building blur reference');
  await yieldToBrowser();

  const sourceCtx = get2dContext(source);
  const blurredCtx = get2dContext(blurred);
  const output = createCanvas(source.width, source.height);
  const outputCtx = get2dContext(output);
  const sourceData = sourceCtx.getImageData(0, 0, source.width, source.height);
  const blurredData = blurredCtx.getImageData(0, 0, blurred.width, blurred.height);
  const result = outputCtx.createImageData(source.width, source.height);
  const threshold = Math.max(0, options.edgeThreshold);
  const noiseDampening = 1 - noiseReductionStrength * 0.35;
  const sharpenAmount = detailStrength * (options.scaleFactor === 4 ? 1.9 : 1.35) * noiseDampening;
  const contrastAmount = contrastStrength * 0.52 * (1 - noiseReductionStrength * 0.18);
  const outlineAmount = detailStrength * (options.scaleFactor === 4 ? 0.08 : 0.06) * (1 - noiseReductionStrength * 0.1);
  const colorPopAmount = contrastStrength * 0.1;
  const chunkRows = Math.max(16, Math.min(96, Math.round(65536 / Math.max(1, source.width))));

  for (let row = 0; row < source.height; row += chunkRows) {
    const rowEnd = Math.min(source.height, row + chunkRows);

    for (let y = row; y < rowEnd; y += 1) {
      const rowOffset = y * source.width * 4;
      for (let x = 0; x < source.width; x += 1) {
        const index = rowOffset + x * 4;
        const r = sourceData.data[index];
        const g = sourceData.data[index + 1];
        const b = sourceData.data[index + 2];
        const a = sourceData.data[index + 3];
        const blurR = blurredData.data[index];
        const blurG = blurredData.data[index + 1];
        const blurB = blurredData.data[index + 2];
        const luma = r * 0.299 + g * 0.587 + b * 0.114;
        const blurLuma = blurR * 0.299 + blurG * 0.587 + blurB * 0.114;
        const lumaDelta = luma - blurLuma;
        const chromaDelta = (Math.abs(r - blurR) + Math.abs(g - blurG) + Math.abs(b - blurB)) / 3;
        const signalDelta = Math.max(Math.abs(lumaDelta), chromaDelta * 0.9);
        const edgeWeight = Math.min(1, Math.max(0, (signalDelta - threshold) / 32));
        const lineBias = Math.min(1, Math.max(0, (136 - luma) / 136));
        const outlinePull = Math.max(0, blurLuma - luma) * outlineAmount * edgeWeight * lineBias;
        const detailR = (r - blurR) * sharpenAmount * edgeWeight;
        const detailG = (g - blurG) * sharpenAmount * edgeWeight;
        const detailB = (b - blurB) * sharpenAmount * edgeWeight;
        const contrastLift = lumaDelta * contrastAmount * edgeWeight;
        const maxChannel = Math.max(r, g, b);
        const minChannel = Math.min(r, g, b);
        const saturation = maxChannel - minChannel;
        const vibrance = colorPopAmount * (1 - saturation / 255) * (0.4 + edgeWeight * 0.6);
        const avgColor = (r + g + b) / 3;

        result.data[index] = clampByte(r + detailR + contrastLift - outlinePull + (r - avgColor) * vibrance);
        result.data[index + 1] = clampByte(g + detailG + contrastLift - outlinePull + (g - avgColor) * vibrance);
        result.data[index + 2] = clampByte(b + detailB + contrastLift - outlinePull + (b - avgColor) * vibrance);
        result.data[index + 3] = a;
      }
    }

    reportProgress(
      onProgress,
      mapProgress(rowEnd / Math.max(1, source.height), 0.2, 0.95),
      `Enhancing details ${Math.round((rowEnd / Math.max(1, source.height)) * 100)}%`
    );
    if (rowEnd < source.height) {
      await yieldToBrowser();
    }
  }

  outputCtx.putImageData(result, 0, 0);
  reportProgress(onProgress, 1, 'Detail enhancement complete');
  return output;
};

const applySourceGuidedLineArt = async (
  source: HTMLCanvasElement,
  guide: SourceLineArtGuide,
  options: ImageUpscaleOptions,
  onProgress?: ImageUpscaleProgressHandler
): Promise<HTMLCanvasElement> => {
  const detailStrength = Math.max(0, options.detailBoost) / 100;
  const contrastStrength = Math.max(0, options.localContrast) / 100;
  const noiseReductionStrength = clampUnit(Math.max(0, options.noiseReduction) / 100);

  if (detailStrength <= 0 && contrastStrength <= 0) {
    reportProgress(onProgress, 1, 'Skipping line art cleanup');
    return source;
  }

  reportProgress(onProgress, 0.08, 'Preparing line guide');
  const darkMaskCanvas = resizeCanvasCrisp(guide.darkMaskCanvas, source.width, source.height);
  reportProgress(onProgress, 0.18, 'Scaling line guide');
  await yieldToBrowser();

  const sourceCtx = get2dContext(source);
  const darkMaskCtx = get2dContext(darkMaskCanvas);
  const output = createCanvas(source.width, source.height);
  const outputCtx = get2dContext(output);
  const sourceData = sourceCtx.getImageData(0, 0, source.width, source.height);
  const darkMaskData = darkMaskCtx.getImageData(0, 0, darkMaskCanvas.width, darkMaskCanvas.height);
  const result = outputCtx.createImageData(source.width, source.height);
  const darkPullAmount = 18 + detailStrength * 46 + contrastStrength * 18;
  const chunkRows = Math.max(16, Math.min(112, Math.round(65536 / Math.max(1, source.width))));

  for (let row = 0; row < source.height; row += chunkRows) {
    const rowEnd = Math.min(source.height, row + chunkRows);

    for (let y = row; y < rowEnd; y += 1) {
      const rowOffset = y * source.width * 4;
      for (let x = 0; x < source.width; x += 1) {
        const index = rowOffset + x * 4;
        const r = sourceData.data[index];
        const g = sourceData.data[index + 1];
        const b = sourceData.data[index + 2];
        const a = sourceData.data[index + 3];
        const darkWeight = clampUnit(darkMaskData.data[index] / 255) * (1 - noiseReductionStrength * 0.1);
        const darkenedR = clampByte(r - darkWeight * darkPullAmount);
        const darkenedG = clampByte(g - darkWeight * darkPullAmount);
        const darkenedB = clampByte(b - darkWeight * darkPullAmount);

        result.data[index] = darkenedR;
        result.data[index + 1] = darkenedG;
        result.data[index + 2] = darkenedB;
        result.data[index + 3] = a;
      }
    }

    reportProgress(
      onProgress,
      mapProgress(rowEnd / Math.max(1, source.height), 0.18, 0.96),
      `Cleaning line art ${Math.round((rowEnd / Math.max(1, source.height)) * 100)}%`
    );
    if (rowEnd < source.height) {
      await yieldToBrowser();
    }
  }

  outputCtx.putImageData(result, 0, 0);
  reportProgress(onProgress, 1, 'Line art cleanup complete');
  return output;
};

const applySourceColorRecovery = async (
  source: HTMLCanvasElement,
  guide: SourceLineArtGuide,
  options: ImageUpscaleOptions,
  onProgress?: ImageUpscaleProgressHandler
): Promise<HTMLCanvasElement> => {
  reportProgress(onProgress, 0.08, 'Preparing flat color recovery');
  const colorGuideCanvas = resizeCanvasHighQuality(guide.colorGuideCanvas, source.width, source.height);
  const darkMaskCanvas = resizeCanvasCrisp(guide.darkMaskCanvas, source.width, source.height);
  const darkMaskBlurCanvas = createBlurredCanvas(darkMaskCanvas, options.scaleFactor === 4 ? 1.6 : 1.2);
  reportProgress(onProgress, 0.2, 'Scaling flat color guide');
  await yieldToBrowser();

  const sourceCtx = get2dContext(source);
  const colorGuideCtx = get2dContext(colorGuideCanvas);
  const darkMaskCtx = get2dContext(darkMaskCanvas);
  const darkMaskBlurCtx = get2dContext(darkMaskBlurCanvas);
  const output = createCanvas(source.width, source.height);
  const outputCtx = get2dContext(output);
  const sourceData = sourceCtx.getImageData(0, 0, source.width, source.height);
  const colorGuideData = colorGuideCtx.getImageData(0, 0, colorGuideCanvas.width, colorGuideCanvas.height);
  const darkMaskData = darkMaskCtx.getImageData(0, 0, darkMaskCanvas.width, darkMaskCanvas.height);
  const darkMaskBlurData = darkMaskBlurCtx.getImageData(0, 0, darkMaskBlurCanvas.width, darkMaskBlurCanvas.height);
  const result = outputCtx.createImageData(source.width, source.height);
  const chunkRows = Math.max(16, Math.min(112, Math.round(65536 / Math.max(1, source.width))));

  for (let row = 0; row < source.height; row += chunkRows) {
    const rowEnd = Math.min(source.height, row + chunkRows);

    for (let y = row; y < rowEnd; y += 1) {
      const rowOffset = y * source.width * 4;
      for (let x = 0; x < source.width; x += 1) {
        const index = rowOffset + x * 4;
        const r = sourceData.data[index];
        const g = sourceData.data[index + 1];
        const b = sourceData.data[index + 2];
        const a = sourceData.data[index + 3];
        const guideR = colorGuideData.data[index];
        const guideG = colorGuideData.data[index + 1];
        const guideB = colorGuideData.data[index + 2];
        const lineWeight = clampUnit(darkMaskData.data[index] / 255);
        const edgeProximity = clampUnit(darkMaskBlurData.data[index] / 255);
        const colorDelta = (Math.abs(r - guideR) + Math.abs(g - guideG) + Math.abs(b - guideB)) / 3;
        const driftWeight = clampUnit((colorDelta - 3) / 26);
        const recoveryWeight = clampUnit(Math.max(edgeProximity * 0.95, driftWeight * 0.35) * (1 - lineWeight) * (1 - lineWeight * 0.8));

        result.data[index] = clampByte(r + (guideR - r) * recoveryWeight);
        result.data[index + 1] = clampByte(g + (guideG - g) * recoveryWeight);
        result.data[index + 2] = clampByte(b + (guideB - b) * recoveryWeight);
        result.data[index + 3] = a;
      }
    }

    reportProgress(
      onProgress,
      mapProgress(rowEnd / Math.max(1, source.height), 0.2, 0.96),
      `Recovering flat colors ${Math.round((rowEnd / Math.max(1, source.height)) * 100)}%`
    );
    if (rowEnd < source.height) {
      await yieldToBrowser();
    }
  }

  outputCtx.putImageData(result, 0, 0);
  reportProgress(onProgress, 1, 'Flat color recovery complete');
  return output;
};

export const upscaleImageDataUrl = async (
  src: string,
  options: ImageUpscaleOptions,
  onProgress?: ImageUpscaleProgressHandler
): Promise<ImageUpscaleResult> => {
  reportProgress(onProgress, 0.04, 'Loading source image');
  const image = await loadImage(src);
  const sourceCanvas = canvasFromImage(image);
  const guideSource = prepareSourceCanvas(sourceCanvas, options.scaleFactor, false);
  const sourceLineArtGuide = buildSourceLineArtGuide(guideSource.colorCanvas);

  if (options.engine === 'ai_super_resolution') {
    const preparedSource = prepareSourceCanvas(sourceCanvas, options.scaleFactor, true);
    reportProgress(onProgress, 0.08, 'Preparing boundary-safe source');
    await yieldToBrowser();
    const denoisedSource = await reduceNoiseCanvas(preparedSource.colorCanvas, options, (progress, label) => {
      reportProgress(onProgress, mapProgress(progress, 0.08, 0.18), label);
    });
    let canvas: HTMLCanvasElement;

    if (supportsAiWorkerRuntime()) {
      try {
        reportProgress(onProgress, 0.2, 'Starting AI worker');
        const workerResult = await upscaleAiCanvasInWorker(denoisedSource, options, (progress, label) => {
          reportProgress(onProgress, mapProgress(progress, 0.22, 0.94), label);
        });
        canvas = await canvasFromBlob(new Blob([workerResult.imageBuffer], { type: workerResult.mimeType }));
      } catch (workerError) {
        console.warn('AI worker upscale failed, falling back to the main thread.', workerError);
        resetAiUpscaleWorker();
        let workingSrc: string | HTMLCanvasElement = denoisedSource;

        if (options.useAiDeblur) {
          reportProgress(onProgress, 0.2, 'Loading MAXIM Deblur');
          const deblurrer = await getAiDeblurrer();
          reportProgress(onProgress, 0.26, 'Running MAXIM Deblur');
          await yieldToBrowser();
          const deblurredSrc = await deblurrer.upscale(workingSrc, {
            ...getAiDeblurPatchSettings(),
            progress: (amount) => {
              reportProgress(
                onProgress,
                mapProgress(amount, 0.26, 0.46),
                `MAXIM Deblur ${Math.round(clampUnit(amount) * 100)}%`
              );
            },
            awaitNextFrame: true
          });
          workingSrc = deblurredSrc;
        }

        reportProgress(onProgress, options.useAiDeblur ? 0.5 : 0.22, 'Loading ESRGAN model');
        const upscaler = await getAiUpscaler(options.aiModel, options.scaleFactor);
        reportProgress(onProgress, options.useAiDeblur ? 0.56 : 0.28, `Running ESRGAN ${options.aiModel}`);
        await yieldToBrowser();
        const patchSettings = getAiUpscalePatchSettings(options.aiModel, options.scaleFactor);
        const upscaledSrc = await upscaler.upscale(workingSrc, {
          ...patchSettings,
          progress: (amount) => {
            reportProgress(
              onProgress,
              mapProgress(amount, options.useAiDeblur ? 0.56 : 0.28, 0.92),
              `Upscaling ${Math.round(clampUnit(amount) * 100)}%`
            );
          },
          awaitNextFrame: true
        });
        reportProgress(onProgress, 0.94, 'Finalizing AI output');
        const upscaledImage = await loadImage(upscaledSrc);
        canvas = canvasFromImage(upscaledImage);
      }
    } else {
      let workingSrc: string | HTMLCanvasElement = denoisedSource;

      if (options.useAiDeblur) {
        reportProgress(onProgress, 0.2, 'Loading MAXIM Deblur');
        const deblurrer = await getAiDeblurrer();
        reportProgress(onProgress, 0.26, 'Running MAXIM Deblur');
        await yieldToBrowser();
        const deblurredSrc = await deblurrer.upscale(workingSrc, {
          ...getAiDeblurPatchSettings(),
          progress: (amount) => {
            reportProgress(
              onProgress,
              mapProgress(amount, 0.26, 0.46),
              `MAXIM Deblur ${Math.round(clampUnit(amount) * 100)}%`
            );
          },
          awaitNextFrame: true
        });
        workingSrc = deblurredSrc;
      }

      reportProgress(onProgress, options.useAiDeblur ? 0.5 : 0.22, 'Loading ESRGAN model');
      const upscaler = await getAiUpscaler(options.aiModel, options.scaleFactor);
      reportProgress(onProgress, options.useAiDeblur ? 0.56 : 0.28, `Running ESRGAN ${options.aiModel}`);
      await yieldToBrowser();
      const patchSettings = getAiUpscalePatchSettings(options.aiModel, options.scaleFactor);
      const upscaledSrc = await upscaler.upscale(workingSrc, {
        ...patchSettings,
        progress: (amount) => {
          reportProgress(
            onProgress,
            mapProgress(amount, options.useAiDeblur ? 0.56 : 0.28, 0.92),
            `Upscaling ${Math.round(clampUnit(amount) * 100)}%`
          );
        },
        awaitNextFrame: true
      });
      reportProgress(onProgress, 0.94, 'Finalizing AI output');
      const upscaledImage = await loadImage(upscaledSrc);
      canvas = canvasFromImage(upscaledImage);
    }

    if (preparedSource.overscan > 0) {
      const cropInset = preparedSource.overscan * options.scaleFactor;
      canvas = cropCanvas(
        canvas,
        cropInset,
        cropInset,
        canvas.width - cropInset * 2,
        canvas.height - cropInset * 2
      );
    }

    canvas = await enhanceUpscaledCanvas(canvas, options, (progress, label) => {
      reportProgress(onProgress, mapProgress(progress, 0.94, 0.975), label);
    });
    canvas = await applySourceGuidedLineArt(canvas, sourceLineArtGuide, options, (progress, label) => {
      reportProgress(onProgress, mapProgress(progress, 0.975, 0.989), label);
    });
    canvas = await applySourceColorRecovery(canvas, sourceLineArtGuide, options, (progress, label) => {
      reportProgress(onProgress, mapProgress(progress, 0.989, 0.996), label);
    });

    if (preparedSource.alphaMaskCanvas) {
      reportProgress(onProgress, 0.996, 'Restoring clean alpha edges');
      const alphaMask = await progressiveResize(
        preparedSource.alphaMaskCanvas,
        canvas.width,
        canvas.height,
        (progress, label) => {
          reportProgress(onProgress, mapProgress(progress, 0.996, 0.999), label);
        }
      );
      canvas = applyAlphaMask(canvas, alphaMask);
    }

    reportProgress(onProgress, 1, 'AI upscale complete');
    return {
      canvas,
      width: canvas.width,
      height: canvas.height
    };
  }

  const preparedSource = prepareSourceCanvas(sourceCanvas, options.scaleFactor, false);
  reportProgress(onProgress, 0.12, 'Source image ready');
  await yieldToBrowser();
  const denoisedSource = await reduceNoiseCanvas(preparedSource.colorCanvas, options, (progress, label) => {
    reportProgress(onProgress, mapProgress(progress, 0.12, 0.28), label);
  });

  const targetWidth = Math.max(1, Math.round(denoisedSource.width * options.scaleFactor));
  const targetHeight = Math.max(1, Math.round(denoisedSource.height * options.scaleFactor));
  const scaledCanvas = await progressiveResize(denoisedSource, targetWidth, targetHeight, (progress, label) => {
    reportProgress(onProgress, mapProgress(progress, 0.28, 0.62), label);
  });
  let enhancedCanvas = await enhanceUpscaledCanvas(scaledCanvas, options, (progress, label) => {
    reportProgress(onProgress, mapProgress(progress, 0.62, 0.91), label);
  });
  enhancedCanvas = await applySourceGuidedLineArt(enhancedCanvas, sourceLineArtGuide, options, (progress, label) => {
    reportProgress(onProgress, mapProgress(progress, 0.91, 0.97), label);
  });
  enhancedCanvas = await applySourceColorRecovery(enhancedCanvas, sourceLineArtGuide, options, (progress, label) => {
    reportProgress(onProgress, mapProgress(progress, 0.97, 0.995), label);
  });

  if (preparedSource.alphaMaskCanvas) {
    const alphaMask = await progressiveResize(
      preparedSource.alphaMaskCanvas,
      enhancedCanvas.width,
      enhancedCanvas.height,
      (progress, label) => {
        reportProgress(onProgress, mapProgress(progress, 0.995, 0.999), label);
      }
    );
    enhancedCanvas = applyAlphaMask(enhancedCanvas, alphaMask);
  }

  reportProgress(onProgress, 1, 'Upscale complete');

  return {
    canvas: enhancedCanvas,
    width: enhancedCanvas.width,
    height: enhancedCanvas.height
  };
};

export const exportUpscaledImage = (
  canvas: HTMLCanvasElement,
  format: 'png' | 'jpeg' | 'webp',
  quality = 0.92
): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const mimeType = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
    const normalizedQuality = Math.max(0.1, Math.min(1, quality));
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Failed to export image.'));
          return;
        }
        resolve(blob);
      },
      mimeType,
      mimeType === 'image/png' ? undefined : normalizedQuality
    );
  });
