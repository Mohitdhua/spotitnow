import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
  canEncodeVideo
} from 'mediabunny';
import { OverlayTransform, VideoSettings } from '../types';

type OverlayExportSettings = Pick<VideoSettings, 'exportResolution' | 'exportBitrateMbps' | 'exportCodec'>;

type OverlayBaseSourceMode = 'video' | 'photo' | 'color';

interface OverlayCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface OverlayBackgroundFill {
  enabled: boolean;
  color: string;
}

interface OverlayChromaKey {
  enabled: boolean;
  color: string;
  similarity: number;
  smoothness: number;
}

interface OverlayTimeline {
  start: number;
  end: number;
}

interface WorkerOverlayMedia {
  id: string;
  name: string;
  kind: 'image' | 'video';
  file: File;
  transform: OverlayTransform;
  crop: OverlayCrop;
  background: OverlayBackgroundFill;
  chromaKey: OverlayChromaKey;
  timeline: OverlayTimeline;
}

interface WorkerBatchPhoto extends WorkerOverlayMedia {
  kind: 'image';
}

interface WorkerBaseInput {
  mode: OverlayBaseSourceMode;
  color: string;
  aspectRatio: number;
  durationSeconds: number;
  videoFile?: File;
  photoFile?: File;
}

interface WorkerStartMessage {
  type: 'start';
  payload: {
    base: WorkerBaseInput;
    batchPhotos: WorkerBatchPhoto[];
    overlays: WorkerOverlayMedia[];
    settings: OverlayExportSettings;
  };
}

interface WorkerCancelMessage {
  type: 'cancel';
}

type WorkerMessage = WorkerStartMessage | WorkerCancelMessage;

type WorkerResponse =
  | { type: 'progress'; progress: number; status?: string }
  | { type: 'file'; fileName: string; mimeType: string; buffer: ArrayBuffer; index: number; total: number }
  | { type: 'done' }
  | { type: 'cancelled' }
  | { type: 'error'; message: string };

interface OverlayImageResource {
  kind: 'image';
  clip: WorkerOverlayMedia;
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

interface OverlayVideoResource {
  kind: 'video';
  clip: WorkerOverlayMedia;
  sink: CanvasSink;
  duration: number;
}

type OverlayResource = OverlayImageResource | OverlayVideoResource;

interface ExportResult {
  buffer: ArrayBuffer;
  width: number;
  height: number;
  mimeType: string;
  extension: string;
}

const FPS = 30;

const RESOLUTION_HEIGHT: Record<OverlayExportSettings['exportResolution'], number> = {
  '480p': 480,
  '720p': 720,
  '1080p': 1080,
  '1440p': 1440,
  '2160p': 2160
};

const FORMAT_BY_CODEC: Record<
  OverlayExportSettings['exportCodec'],
  { codec: 'avc' | 'av1'; extension: string; mimeType: string; outputFormat: Mp4OutputFormat | WebMOutputFormat }
> = {
  h264: {
    codec: 'avc',
    extension: 'mp4',
    mimeType: 'video/mp4',
    outputFormat: new Mp4OutputFormat()
  },
  av1: {
    codec: 'av1',
    extension: 'webm',
    mimeType: 'video/webm',
    outputFormat: new WebMOutputFormat()
  }
};

let isCanceled = false;
let activeConversion: Conversion | null = null;

const postToMain = (message: WorkerResponse, transfer: Transferable[] = []) => {
  (self as any).postMessage(message, transfer);
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);

const throwIfCanceled = () => {
  if (isCanceled) throw new Error('__OVERLAY_EXPORT_CANCELED__');
};

const sanitizeName = (name: string) =>
  name
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64) || 'overlay';

const computeOutputSizeFromAspect = (aspectRatio: number, resolution: OverlayExportSettings['exportResolution']) => {
  const baseHeight = RESOLUTION_HEIGHT[resolution];
  const safeAspect = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 16 / 9;

  if (safeAspect >= 1) {
    return {
      width: even(baseHeight * safeAspect),
      height: even(baseHeight)
    };
  }

  return {
    width: even(baseHeight),
    height: even(baseHeight / safeAspect)
  };
};

const normalizeTimeline = (timeline: OverlayTimeline): OverlayTimeline => {
  const start = clamp(Number.isFinite(timeline.start) ? timeline.start : 0, 0, 60 * 60 * 3);
  const rawEnd = Number.isFinite(timeline.end) ? timeline.end : start + 0.5;
  const end = clamp(Math.max(rawEnd, start + 0.05), 0.05, 60 * 60 * 3);
  return { start, end };
};

const normalizeCrop = (crop: OverlayCrop): OverlayCrop => {
  const x = clamp(Number.isFinite(crop.x) ? crop.x : 0, 0, 0.98);
  const y = clamp(Number.isFinite(crop.y) ? crop.y : 0, 0, 0.98);
  const width = clamp(Number.isFinite(crop.width) ? crop.width : 1, 0.02, 1 - x);
  const height = clamp(Number.isFinite(crop.height) ? crop.height : 1, 0.02, 1 - y);
  return { x, y, width, height };
};

const parseHexColor = (value: string): { r: number; g: number; b: number } => {
  const normalized = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(normalized)) {
    return {
      r: Number.parseInt(`${normalized[1]}${normalized[1]}`, 16),
      g: Number.parseInt(`${normalized[2]}${normalized[2]}`, 16),
      b: Number.parseInt(`${normalized[3]}${normalized[3]}`, 16)
    };
  }
  if (/^#[0-9a-f]{6}$/.test(normalized)) {
    return {
      r: Number.parseInt(normalized.slice(1, 3), 16),
      g: Number.parseInt(normalized.slice(3, 5), 16),
      b: Number.parseInt(normalized.slice(5, 7), 16)
    };
  }
  return { r: 0, g: 255, b: 0 };
};

const applyChromaKeyToCanvas = (
  ctx: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  chromaKey: OverlayChromaKey
) => {
  const keyColor = parseHexColor(chromaKey.color);
  const similarity = clamp(chromaKey.similarity, 0, 1);
  const smoothness = clamp(chromaKey.smoothness, 0, 1);
  const softEdge = Math.max(0.0001, smoothness * 0.25);
  const minThreshold = Math.max(0, similarity - softEdge);
  const maxThreshold = Math.min(1, similarity + softEdge);

  const frame = ctx.getImageData(0, 0, width, height);
  const data = frame.data;

  for (let index = 0; index < data.length; index += 4) {
    const dr = data[index] - keyColor.r;
    const dg = data[index + 1] - keyColor.g;
    const db = data[index + 2] - keyColor.b;
    const distance = Math.sqrt(dr * dr + dg * dg + db * db) / 441.67295593;

    if (distance <= minThreshold) {
      data[index + 3] = 0;
      continue;
    }

    if (distance >= maxThreshold) continue;

    const alphaScale = (distance - minThreshold) / Math.max(0.0001, maxThreshold - minThreshold);
    data[index + 3] = Math.round(data[index + 3] * alphaScale);
  }

  ctx.putImageData(frame, 0, 0);
};

const getVisibleSources = async (resource: OverlayResource, timestamp: number): Promise<CanvasImageSource | null> => {
  const timeline = normalizeTimeline(resource.clip.timeline);
  if (timestamp < timeline.start || timestamp > timeline.end) return null;

  if (resource.kind === 'image') {
    return resource.bitmap;
  }

  const localTime = Math.max(0, timestamp - timeline.start);
  const duration = resource.duration > 0.01 ? resource.duration : 0.01;
  const lookupTimestamp = localTime % duration;
  const wrapped = await resource.sink.getCanvas(lookupTimestamp);
  return wrapped?.canvas ?? null;
};

const drawOverlayClip = async (
  ctx: OffscreenCanvasRenderingContext2D,
  resource: OverlayResource,
  timestamp: number,
  frameWidth: number,
  frameHeight: number,
  scratchCanvas: OffscreenCanvas,
  scratchCtx: OffscreenCanvasRenderingContext2D
) => {
  const source = await getVisibleSources(resource, timestamp);
  if (!source) return;

  const sourceWidth = 'width' in source ? source.width : 0;
  const sourceHeight = 'height' in source ? source.height : 0;
  if (!sourceWidth || !sourceHeight) return;

  const transform = resource.clip.transform;
  const x = clamp(transform.x, 0, 1) * frameWidth;
  const y = clamp(transform.y, 0, 1) * frameHeight;
  const width = Math.max(1, clamp(transform.width, 0.01, 1) * frameWidth);
  const height = Math.max(1, clamp(transform.height, 0.01, 1) * frameHeight);
  const maxWidth = Math.max(1, frameWidth - x);
  const maxHeight = Math.max(1, frameHeight - y);
  const drawWidth = Math.min(width, maxWidth);
  const drawHeight = Math.min(height, maxHeight);

  if (resource.clip.background.enabled) {
    ctx.fillStyle = resource.clip.background.color || '#ffffff';
    ctx.fillRect(x, y, drawWidth, drawHeight);
  }

  const crop = normalizeCrop(resource.clip.crop);
  const sx = Math.floor(crop.x * sourceWidth);
  const sy = Math.floor(crop.y * sourceHeight);
  const sw = Math.max(1, Math.floor(crop.width * sourceWidth));
  const sh = Math.max(1, Math.floor(crop.height * sourceHeight));

  if (!resource.clip.chromaKey.enabled) {
    ctx.drawImage(source, sx, sy, sw, sh, x, y, drawWidth, drawHeight);
    return;
  }

  scratchCanvas.width = Math.max(1, Math.round(drawWidth));
  scratchCanvas.height = Math.max(1, Math.round(drawHeight));
  scratchCtx.clearRect(0, 0, scratchCanvas.width, scratchCanvas.height);
  scratchCtx.drawImage(source, sx, sy, sw, sh, 0, 0, scratchCanvas.width, scratchCanvas.height);

  if (resource.clip.chromaKey.enabled) {
    applyChromaKeyToCanvas(scratchCtx, scratchCanvas.width, scratchCanvas.height, resource.clip.chromaKey);
  }

  ctx.drawImage(scratchCanvas, x, y, drawWidth, drawHeight);
};

const renderOverlayResources = async (
  ctx: OffscreenCanvasRenderingContext2D,
  resources: OverlayResource[],
  timestamp: number,
  frameWidth: number,
  frameHeight: number,
  scratchCanvas: OffscreenCanvas,
  scratchCtx: OffscreenCanvasRenderingContext2D
) => {
  for (let index = 0; index < resources.length; index += 1) {
    throwIfCanceled();
    await drawOverlayClip(ctx, resources[index], timestamp, frameWidth, frameHeight, scratchCanvas, scratchCtx);
  }
};

const prepareOverlayResource = async (clip: WorkerOverlayMedia): Promise<OverlayResource> => {
  if (clip.kind === 'image') {
    const bitmap = await createImageBitmap(clip.file);
    return {
      kind: 'image',
      clip,
      bitmap,
      width: bitmap.width,
      height: bitmap.height
    };
  }

  const input = new Input({
    source: new BlobSource(clip.file),
    formats: ALL_FORMATS
  });
  const track = await input.getPrimaryVideoTrack();
  if (!track) {
    throw new Error(`Overlay clip "${clip.name}" has no video track.`);
  }
  const sink = new CanvasSink(track, { alpha: true });
  let duration = 0;
  try {
    duration = await track.computeDuration();
  } catch {
    duration = 0;
  }
  return {
    kind: 'video',
    clip,
    sink,
    duration
  };
};

const releaseOverlayResource = (resource: OverlayResource) => {
  if (resource.kind === 'image') {
    resource.bitmap.close();
  }
};

const exportWithVideoBase = async (options: {
  base: WorkerBaseInput;
  photo: WorkerBatchPhoto;
  overlayResources: OverlayResource[];
  settings: OverlayExportSettings;
  photoIndex: number;
  totalPhotos: number;
  onProgress: (progress: number, status: string) => void;
}): Promise<ExportResult> => {
  const { base, photo, overlayResources, settings, photoIndex, totalPhotos, onProgress } = options;
  if (!base.videoFile) throw new Error('Missing base video file.');

  const codecConfig = FORMAT_BY_CODEC[settings.exportCodec];
  const probeInput = new Input({
    source: new BlobSource(base.videoFile),
    formats: ALL_FORMATS
  });
  const primaryVideoTrack = await probeInput.getPrimaryVideoTrack();
  if (!primaryVideoTrack) {
    throw new Error('The uploaded base file does not contain a video track.');
  }

  const sourceWidth = primaryVideoTrack.displayWidth || primaryVideoTrack.codedWidth || 1920;
  const sourceHeight = primaryVideoTrack.displayHeight || primaryVideoTrack.codedHeight || 1080;
  const sourceAspectRatio = sourceWidth / Math.max(1, sourceHeight);
  const preferredAspectRatio = clamp(base.aspectRatio, 0.3, 4);
  const outputAspectRatio =
    Number.isFinite(preferredAspectRatio) && preferredAspectRatio > 0 ? preferredAspectRatio : sourceAspectRatio;
  const { width: outputWidth, height: outputHeight } = computeOutputSizeFromAspect(
    outputAspectRatio,
    settings.exportResolution
  );
  const bitrate = Math.max(500_000, Math.round(settings.exportBitrateMbps * 1_000_000));

  const encodable = await canEncodeVideo(codecConfig.codec, {
    width: outputWidth,
    height: outputHeight,
    bitrate
  });
  if (!encodable) {
    throw new Error(
      `Cannot encode ${settings.exportCodec.toUpperCase()} at ${outputWidth}x${outputHeight} with current browser support.`
    );
  }

  throwIfCanceled();

  const input = new Input({
    source: new BlobSource(base.videoFile),
    formats: ALL_FORMATS
  });
  const target = new BufferTarget();
  const output = new Output({
    format: codecConfig.outputFormat,
    target
  });
  const overlayCanvas = new OffscreenCanvas(outputWidth, outputHeight);
  const overlayCtx = overlayCanvas.getContext('2d');
  if (!overlayCtx) {
    throw new Error('Failed to initialize overlay canvas context.');
  }
  overlayCtx.imageSmoothingEnabled = true;
  overlayCtx.imageSmoothingQuality = 'high';

  const scratchCanvas = new OffscreenCanvas(2, 2);
  const scratchCtx = scratchCanvas.getContext('2d');
  if (!scratchCtx) {
    throw new Error('Failed to initialize scratch canvas context.');
  }
  scratchCtx.imageSmoothingEnabled = true;
  scratchCtx.imageSmoothingQuality = 'high';

  const conversion = await Conversion.init({
    input,
    output,
    video: {
      width: outputWidth,
      height: outputHeight,
      frameRate: FPS,
      fit: 'cover',
      codec: codecConfig.codec,
      bitrate,
      forceTranscode: true,
      processedWidth: outputWidth,
      processedHeight: outputHeight,
      process: async (sample) => {
        overlayCtx.clearRect(0, 0, outputWidth, outputHeight);
        sample.draw(overlayCtx, 0, 0, outputWidth, outputHeight);
        await renderOverlayResources(
          overlayCtx,
          overlayResources,
          Math.max(0, sample.timestamp),
          outputWidth,
          outputHeight,
          scratchCanvas,
          scratchCtx
        );
        return overlayCanvas;
      }
    }
  });
  activeConversion = conversion;

  conversion.onProgress = (progress) => {
    const overall = (photoIndex + progress) / totalPhotos;
    onProgress(clamp(overall, 0, 0.995), `Exporting ${photo.name} (${photoIndex + 1}/${totalPhotos})`);
  };

  await conversion.execute();
  throwIfCanceled();

  const buffer = target.buffer;
  if (!buffer) {
    throw new Error(`Failed to build output for ${photo.name}.`);
  }

  return {
    buffer,
    width: outputWidth,
    height: outputHeight,
    mimeType: codecConfig.mimeType,
    extension: codecConfig.extension
  };
};

const drawBasePhotoCover = (
  ctx: OffscreenCanvasRenderingContext2D,
  bitmap: ImageBitmap,
  width: number,
  height: number,
  backgroundColor: string
) => {
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, width, height);

  const sourceAspect = bitmap.width / Math.max(1, bitmap.height);
  const destAspect = width / Math.max(1, height);

  let drawWidth = width;
  let drawHeight = height;
  let drawX = 0;
  let drawY = 0;

  if (sourceAspect > destAspect) {
    drawHeight = width / sourceAspect;
    drawY = (height - drawHeight) / 2;
  } else {
    drawWidth = height * sourceAspect;
    drawX = (width - drawWidth) / 2;
  }

  ctx.drawImage(bitmap, drawX, drawY, drawWidth, drawHeight);
};

const exportWithStaticBase = async (options: {
  base: WorkerBaseInput;
  basePhotoBitmap: ImageBitmap | null;
  photo: WorkerBatchPhoto;
  overlayResources: OverlayResource[];
  settings: OverlayExportSettings;
  photoIndex: number;
  totalPhotos: number;
  onProgress: (progress: number, status: string) => void;
}): Promise<ExportResult> => {
  const { base, basePhotoBitmap, photo, overlayResources, settings, photoIndex, totalPhotos, onProgress } = options;
  const codecConfig = FORMAT_BY_CODEC[settings.exportCodec];

  const maxTimelineEnd = overlayResources.reduce((acc, resource) => {
    const timeline = normalizeTimeline(resource.clip.timeline);
    return Math.max(acc, timeline.end);
  }, 0);
  const duration = Math.max(0.5, base.durationSeconds, maxTimelineEnd);

  const aspectRatio = clamp(base.aspectRatio, 0.3, 4);
  const { width: outputWidth, height: outputHeight } = computeOutputSizeFromAspect(aspectRatio, settings.exportResolution);
  const bitrate = Math.max(500_000, Math.round(settings.exportBitrateMbps * 1_000_000));
  const totalFrames = Math.max(1, Math.ceil(duration * FPS));

  const encodable = await canEncodeVideo(codecConfig.codec, {
    width: outputWidth,
    height: outputHeight,
    bitrate
  });
  if (!encodable) {
    throw new Error(
      `Cannot encode ${settings.exportCodec.toUpperCase()} at ${outputWidth}x${outputHeight} with current browser support.`
    );
  }

  throwIfCanceled();

  const target = new BufferTarget();
  const output = new Output({
    format: codecConfig.outputFormat,
    target
  });
  const canvas = new OffscreenCanvas(outputWidth, outputHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to initialize static export canvas context.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const scratchCanvas = new OffscreenCanvas(2, 2);
  const scratchCtx = scratchCanvas.getContext('2d');
  if (!scratchCtx) throw new Error('Failed to initialize scratch canvas context.');
  scratchCtx.imageSmoothingEnabled = true;
  scratchCtx.imageSmoothingQuality = 'high';

  const videoSource = new CanvasSource(canvas, {
    codec: codecConfig.codec,
    bitrate,
    frameRate: FPS,
    bitrateMode: 'constant',
    latencyMode: 'quality',
    contentHint: 'detail'
  });
  output.addVideoTrack(videoSource);

  await output.start();
  throwIfCanceled();

  const progressStep = Math.max(1, Math.floor(totalFrames / 120));
  const baseColor = base.color || '#ffffff';

  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
    throwIfCanceled();
    const timestamp = frameIndex / FPS;
    ctx.clearRect(0, 0, outputWidth, outputHeight);

    if (base.mode === 'photo' && basePhotoBitmap) {
      drawBasePhotoCover(ctx, basePhotoBitmap, outputWidth, outputHeight, baseColor);
    } else {
      ctx.fillStyle = baseColor;
      ctx.fillRect(0, 0, outputWidth, outputHeight);
    }

    await renderOverlayResources(ctx, overlayResources, timestamp, outputWidth, outputHeight, scratchCanvas, scratchCtx);
    await videoSource.add(timestamp, 1 / FPS);

    if (frameIndex % progressStep === 0 || frameIndex === totalFrames - 1) {
      const localProgress = (frameIndex + 1) / totalFrames;
      const overall = (photoIndex + localProgress) / totalPhotos;
      onProgress(
        clamp(overall, 0, 0.995),
        `Rendering ${photo.name} (${photoIndex + 1}/${totalPhotos}) frame ${frameIndex + 1}/${totalFrames}`
      );
    }
  }

  await output.finalize();
  throwIfCanceled();

  const buffer = target.buffer;
  if (!buffer) {
    throw new Error(`Failed to build output for ${photo.name}.`);
  }

  return {
    buffer,
    width: outputWidth,
    height: outputHeight,
    mimeType: codecConfig.mimeType,
    extension: codecConfig.extension
  };
};

const exportOverlayBatch = async (
  base: WorkerBaseInput,
  batchPhotos: WorkerBatchPhoto[],
  overlays: WorkerOverlayMedia[],
  settings: OverlayExportSettings
) => {
  if (!batchPhotos.length) throw new Error('No photos provided for overlay export.');
  if (base.mode === 'video' && !base.videoFile) throw new Error('Missing base video file.');
  if (base.mode === 'photo' && !base.photoFile) throw new Error('Missing base photo file.');

  postToMain({ type: 'progress', progress: 0, status: 'Preparing batch export...' });

  const commonOverlayResources: OverlayResource[] = [];
  let basePhotoBitmap: ImageBitmap | null = null;

  try {
    for (let index = 0; index < overlays.length; index += 1) {
      throwIfCanceled();
      commonOverlayResources.push(await prepareOverlayResource(overlays[index]));
    }

    if (base.mode === 'photo' && base.photoFile) {
      basePhotoBitmap = await createImageBitmap(base.photoFile);
    }

    for (let index = 0; index < batchPhotos.length; index += 1) {
      throwIfCanceled();
      const photo = batchPhotos[index];

      const primaryResource = await prepareOverlayResource(photo);
      const clipResources = [primaryResource, ...commonOverlayResources];

      try {
        const result =
          base.mode === 'video'
            ? await exportWithVideoBase({
                base,
                photo,
                overlayResources: clipResources,
                settings,
                photoIndex: index,
                totalPhotos: batchPhotos.length,
                onProgress: (progress, status) => {
                  postToMain({
                    type: 'progress',
                    progress,
                    status
                  });
                }
              })
            : await exportWithStaticBase({
                base,
                basePhotoBitmap,
                photo,
                overlayResources: clipResources,
                settings,
                photoIndex: index,
                totalPhotos: batchPhotos.length,
                onProgress: (progress, status) => {
                  postToMain({
                    type: 'progress',
                    progress,
                    status
                  });
                }
              });

        const fileName = `${sanitizeName(photo.name)}-${result.width}x${result.height}.${result.extension}`;
        postToMain(
          {
            type: 'file',
            fileName,
            mimeType: result.mimeType,
            buffer: result.buffer,
            index: index + 1,
            total: batchPhotos.length
          },
          [result.buffer]
        );
      } finally {
        releaseOverlayResource(primaryResource);
        activeConversion = null;
      }

      postToMain({
        type: 'progress',
        progress: clamp((index + 1) / batchPhotos.length, 0, 1),
        status: `Completed ${index + 1}/${batchPhotos.length}`
      });
    }
  } finally {
    commonOverlayResources.forEach(releaseOverlayResource);
    basePhotoBitmap?.close();
  }

  postToMain({ type: 'done' });
};

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;

  if (message.type === 'cancel') {
    isCanceled = true;
    if (activeConversion) {
      activeConversion.cancel().catch(() => undefined);
    }
    return;
  }

  if (message.type !== 'start') return;

  const { base, batchPhotos, overlays, settings } = message.payload;
  isCanceled = false;

  try {
    await exportOverlayBatch(base, batchPhotos, overlays, settings);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Batch overlay export failed.';
    if (errorMessage === '__OVERLAY_EXPORT_CANCELED__' || isCanceled) {
      postToMain({ type: 'cancelled' });
    } else {
      postToMain({ type: 'error', message: errorMessage });
    }
  } finally {
    activeConversion = null;
    isCanceled = false;
  }
};
