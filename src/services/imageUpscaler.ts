export type ImageUpscaleEngine = 'fast_enhance' | 'ai_super_resolution';
export type ImageUpscaleAiModel = 'slim' | 'medium' | 'thick';

export interface ImageUpscaleOptions {
  engine: ImageUpscaleEngine;
  scaleFactor: 2 | 4;
  aiModel: ImageUpscaleAiModel;
  useAiDeblur: boolean;
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

const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
const clampUnit = (value: number) => Math.max(0, Math.min(1, value));
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

const getAiUpscalePatchSettings = (model: ImageUpscaleAiModel, scaleFactor: 2 | 4) => {
  if (model === 'thick') {
    return scaleFactor === 4
      ? {
          patchSize: 64,
          padding: 8
        }
      : {
          patchSize: 96,
          padding: 8
        };
  }

  if (model === 'medium') {
    return scaleFactor === 4
      ? {
          patchSize: 80,
          padding: 8
        }
      : {
          patchSize: 112,
          padding: 8
        };
  }

  return scaleFactor === 4
    ? {
        patchSize: 96,
        padding: 8
      }
    : {
        patchSize: 128,
        padding: 8
      };
};

const getAiDeblurPatchSettings = () => ({
  patchSize: 96,
  padding: 8
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

const enhanceUpscaledCanvas = async (
  source: HTMLCanvasElement,
  options: ImageUpscaleOptions,
  onProgress?: ImageUpscaleProgressHandler
): Promise<HTMLCanvasElement> => {
  const detailStrength = Math.max(0, options.detailBoost) / 100;
  const contrastStrength = Math.max(0, options.localContrast) / 100;

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
  const sharpenAmount = detailStrength * (options.scaleFactor === 4 ? 1.9 : 1.35);
  const contrastAmount = contrastStrength * 0.45;
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
        const edgeWeight = Math.min(1, Math.max(0, (Math.abs(lumaDelta) - threshold) / 40));
        const detailR = (r - blurR) * sharpenAmount * edgeWeight;
        const detailG = (g - blurG) * sharpenAmount * edgeWeight;
        const detailB = (b - blurB) * sharpenAmount * edgeWeight;
        const contrastLift = lumaDelta * contrastAmount * edgeWeight;

        result.data[index] = clampByte(r + detailR + contrastLift);
        result.data[index + 1] = clampByte(g + detailG + contrastLift);
        result.data[index + 2] = clampByte(b + detailB + contrastLift);
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

export const upscaleImageDataUrl = async (
  src: string,
  options: ImageUpscaleOptions,
  onProgress?: ImageUpscaleProgressHandler
): Promise<ImageUpscaleResult> => {
  if (options.engine === 'ai_super_resolution') {
    let workingSrc = src;

    if (options.useAiDeblur) {
      reportProgress(onProgress, 0.06, 'Loading MAXIM Deblur');
      const deblurrer = await getAiDeblurrer();
      reportProgress(onProgress, 0.12, 'Running MAXIM Deblur');
      await yieldToBrowser();
      const deblurredSrc = await deblurrer.upscale(workingSrc, {
        ...getAiDeblurPatchSettings(),
        progress: (amount) => {
          reportProgress(
            onProgress,
            mapProgress(amount, 0.12, 0.48),
            `MAXIM Deblur ${Math.round(clampUnit(amount) * 100)}%`
          );
        },
        awaitNextFrame: true
      });
      workingSrc = deblurredSrc;
    }

    reportProgress(onProgress, options.useAiDeblur ? 0.52 : 0.08, 'Loading ESRGAN model');
    const upscaler = await getAiUpscaler(options.aiModel, options.scaleFactor);
    reportProgress(onProgress, options.useAiDeblur ? 0.58 : 0.16, `Running ESRGAN ${options.aiModel}`);
    await yieldToBrowser();
    const patchSettings = getAiUpscalePatchSettings(options.aiModel, options.scaleFactor);
    const upscaledSrc = await upscaler.upscale(workingSrc, {
      ...patchSettings,
      progress: (amount) => {
        reportProgress(
          onProgress,
          mapProgress(amount, options.useAiDeblur ? 0.58 : 0.16, 0.96),
          `Upscaling ${Math.round(clampUnit(amount) * 100)}%`
        );
      },
      awaitNextFrame: true
    });
    reportProgress(onProgress, 0.98, 'Finalizing AI output');
    const image = await loadImage(upscaledSrc);
    const canvas = createCanvas(image.naturalWidth || image.width, image.naturalHeight || image.height);
    const ctx = get2dContext(canvas);
    ctx.drawImage(image, 0, 0);
    reportProgress(onProgress, 1, 'AI upscale complete');
    return {
      canvas,
      width: canvas.width,
      height: canvas.height
    };
  }

  reportProgress(onProgress, 0.04, 'Loading source image');
  const image = await loadImage(src);
  const sourceCanvas = createCanvas(image.naturalWidth || image.width, image.naturalHeight || image.height);
  const sourceCtx = get2dContext(sourceCanvas);
  sourceCtx.drawImage(image, 0, 0);
  reportProgress(onProgress, 0.12, 'Source image ready');
  await yieldToBrowser();

  const targetWidth = Math.max(1, Math.round(sourceCanvas.width * options.scaleFactor));
  const targetHeight = Math.max(1, Math.round(sourceCanvas.height * options.scaleFactor));
  const scaledCanvas = await progressiveResize(sourceCanvas, targetWidth, targetHeight, (progress, label) => {
    reportProgress(onProgress, mapProgress(progress, 0.12, 0.56), label);
  });
  const enhancedCanvas = await enhanceUpscaledCanvas(scaledCanvas, options, (progress, label) => {
    reportProgress(onProgress, mapProgress(progress, 0.56, 0.98), label);
  });
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
