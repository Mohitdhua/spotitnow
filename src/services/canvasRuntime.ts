export type RuntimeCanvas = HTMLCanvasElement | OffscreenCanvas;
export type RuntimeCanvasContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type RuntimeImageLike = HTMLImageElement | ImageBitmap;

type RuntimeImageDecoderFrame = {
  close?: () => void;
};

type RuntimeImageDecoderInstance = {
  decode: (options?: { frameIndex?: number }) => Promise<{ image: RuntimeImageDecoderFrame }>;
  close?: () => void;
};

type RuntimeImageDecoderCtor = new (init: { data: Blob; type: string }) => RuntimeImageDecoderInstance;

const hasDocumentCanvas = () => typeof document !== 'undefined' && typeof document.createElement === 'function';
const getImageDecoderCtor = () =>
  (globalThis as unknown as { ImageDecoder?: RuntimeImageDecoderCtor }).ImageDecoder ?? null;

const loadHtmlImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load image source'));
    image.src = src;
  });

export const createRuntimeCanvas = (
  width: number,
  height: number,
  existing?: RuntimeCanvas
): RuntimeCanvas => {
  const nextCanvas =
    existing ??
    (hasDocumentCanvas()
      ? (document.createElement('canvas') as RuntimeCanvas)
      : new OffscreenCanvas(Math.max(1, width), Math.max(1, height)));

  nextCanvas.width = Math.max(1, width);
  nextCanvas.height = Math.max(1, height);
  return nextCanvas;
};

export const getRuntimeCanvasContext = (
  canvas: RuntimeCanvas,
  settings?: CanvasRenderingContext2DSettings
): RuntimeCanvasContext => {
  const context = canvas.getContext('2d', settings);
  if (!context) {
    throw new Error('Failed to get canvas context');
  }
  return context as RuntimeCanvasContext;
};

export const isRuntimeCanvas = (value: unknown): value is RuntimeCanvas => {
  if (typeof HTMLCanvasElement !== 'undefined' && value instanceof HTMLCanvasElement) {
    return true;
  }
  return typeof OffscreenCanvas !== 'undefined' && value instanceof OffscreenCanvas;
};

export const isRuntimeImage = (value: unknown): value is RuntimeImageLike => {
  if (typeof HTMLImageElement !== 'undefined' && value instanceof HTMLImageElement) {
    return true;
  }
  return typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap;
};

export const loadRuntimeImageFromSource = async (src: string): Promise<RuntimeImageLike> => {
  if (typeof Image !== 'undefined') {
    return await loadHtmlImage(src);
  }

  if (typeof fetch !== 'function' || typeof createImageBitmap !== 'function') {
    throw new Error('Image loading is not supported in this runtime');
  }

  const response = await fetch(src);
  if (!response.ok) {
    throw new Error(`Failed to fetch image source (${response.status})`);
  }

  const blob = await response.blob();
  return await decodeRuntimeImageBitmapFromBlob(blob);
};

const decodeRuntimeImageBitmapWithImageDecoder = async (blob: Blob): Promise<ImageBitmap> => {
  const ImageDecoderCtor = getImageDecoderCtor();
  if (!ImageDecoderCtor || !blob.type || typeof createImageBitmap !== 'function') {
    throw new Error('ImageDecoder fallback is unavailable for this image.');
  }

  const decoder = new ImageDecoderCtor({
    data: blob,
    type: blob.type
  });

  try {
    const { image } = await decoder.decode({ frameIndex: 0 });
    try {
      return await createImageBitmap(image as any);
    } finally {
      image.close?.();
    }
  } finally {
    decoder.close?.();
  }
};

export const decodeRuntimeImageBitmapFromBlob = async (blob: Blob): Promise<ImageBitmap> => {
  let lastError: unknown = null;

  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch (error) {
      lastError = error;
    }
  }

  try {
    return await decodeRuntimeImageBitmapWithImageDecoder(blob);
  } catch (error) {
    lastError = error;
  }

  const detail =
    lastError instanceof Error && lastError.message.trim()
      ? ` ${lastError.message}`
      : '';
  throw new Error(`Failed to decode image data.${detail}`);
};

export const readRuntimeBlobImageDimensions = async (blob: Blob): Promise<{ width: number; height: number }> => {
  try {
    const bitmap = await decodeRuntimeImageBitmapFromBlob(blob);
    try {
      return {
        width: bitmap.width,
        height: bitmap.height
      };
    } finally {
      if (typeof bitmap.close === 'function') {
        bitmap.close();
      }
    }
  } catch {
    // Fall through to the HTML image decoder below.
  }

  if (typeof Image === 'undefined') {
    throw new Error('Image decoding is not supported in this runtime.');
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await loadHtmlImage(objectUrl);
    return {
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

export const canvasToBlob = async (
  canvas: RuntimeCanvas,
  type = 'image/png',
  quality?: number
): Promise<Blob> => {
  if ('convertToBlob' in canvas && typeof canvas.convertToBlob === 'function') {
    return await canvas.convertToBlob({
      type,
      quality
    });
  }

  return await new Promise<Blob>((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error(`Failed to encode canvas as ${type}`));
          return;
        }
        resolve(blob);
      },
      type,
      quality
    );
  });
};

const blobToDataUrl = async (blob: Blob): Promise<string> =>
  await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Failed to convert blob to data URL'));
    reader.readAsDataURL(blob);
  });

export const canvasToDataUrl = async (
  canvas: RuntimeCanvas,
  type = 'image/png',
  quality?: number
): Promise<string> => {
  if ('toDataURL' in canvas && typeof canvas.toDataURL === 'function') {
    return (canvas as HTMLCanvasElement).toDataURL(type, quality);
  }

  const blob = await canvasToBlob(canvas, type, quality);
  return await blobToDataUrl(blob);
};
