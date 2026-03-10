export type RuntimeCanvas = HTMLCanvasElement | OffscreenCanvas;
export type RuntimeCanvasContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type RuntimeImageLike = HTMLImageElement | ImageBitmap;

const hasDocumentCanvas = () => typeof document !== 'undefined' && typeof document.createElement === 'function';

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
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Failed to load image source'));
      image.src = src;
    });
  }

  if (typeof fetch !== 'function' || typeof createImageBitmap !== 'function') {
    throw new Error('Image loading is not supported in this runtime');
  }

  const response = await fetch(src);
  if (!response.ok) {
    throw new Error(`Failed to fetch image source (${response.status})`);
  }

  const blob = await response.blob();
  return await createImageBitmap(blob);
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
