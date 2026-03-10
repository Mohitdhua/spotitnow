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
import type { MediaTaskEventMessage, MediaWorkerStatsMessage } from '../services/mediaTelemetry';
import type {
  OverlayBaseInput as WorkerBaseInput,
  OverlayBatchPhotoInput as WorkerBatchPhoto,
  OverlayChromaKey,
  OverlayCrop,
  OverlayExportSettings,
  OverlayLinkedPairInput as WorkerLinkedPairInput,
  OverlayLinkedPairLayout as WorkerLinkedPairLayout,
  OverlayLinkedPairStyle as WorkerLinkedPairStyle,
  OverlayMediaClipInput as WorkerOverlayMedia,
  OverlayTimeline,
  OverlayWorkerOutputTarget,
  OverlayWorkerStartPayload
} from '../services/overlayVideoExport';

interface WorkerStartMessage {
  type: 'start';
  payload: OverlayWorkerStartPayload;
}

interface WorkerCancelMessage {
  type: 'cancel';
}

type WorkerMessage = WorkerStartMessage | WorkerCancelMessage;

type WorkerResponse =
  | { type: 'progress'; progress: number; status?: string }
  | { type: 'done'; fileName: string; mimeType: string; buffer: ArrayBuffer }
  | { type: 'cancelled' }
  | { type: 'error'; message: string }
  | MediaTaskEventMessage
  | MediaWorkerStatsMessage;

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
type VisibleOverlaySource = ImageBitmap | OffscreenCanvas;

interface LinkedPairImageResource {
  pair: WorkerLinkedPairInput;
  puzzleBitmap: ImageBitmap;
  diffBitmap: ImageBitmap;
}

interface BaseVideoResource {
  sink: CanvasSink;
  duration: number;
}

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
let activeTaskId: string | null = null;
let activeTaskStartedAt = 0;
let currentWorkerSessionId = 'primary';

const getOverlayWorkerId = () => `overlay-export-worker:${currentWorkerSessionId}`;

const postToMain = (message: WorkerResponse, transfer: Transferable[] = []) => {
  (self as any).postMessage(message, transfer);
};

const emitTaskEvent = (event: MediaTaskEventMessage['event']) => {
  postToMain({
    type: 'task-event',
    event: {
      workerId: getOverlayWorkerId(),
      timestamp: Date.now(),
      ...event
    }
  });
};

const emitStats = ({
  queueSize,
  runningTasks,
  avgTaskMs = 0
}: {
  queueSize: number;
  runningTasks: number;
  avgTaskMs?: number;
}) => {
  postToMain({
    type: 'stats',
    stats: {
      workerId: getOverlayWorkerId(),
      label: 'Overlay Export Worker',
      runtimeKind: 'worker',
      activeWorkers: 1,
      queueSize,
      runningTasks,
      avgTaskMs,
      stageQueueDepths: {
        render: runningTasks > 0 ? 1 : 0,
        encode: runningTasks > 0 ? 1 : 0,
        write: runningTasks > 0 ? 1 : 0
      },
      updatedAt: Date.now()
    }
  });
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

const normalizeLinkedPairLayout = (
  layout: WorkerLinkedPairLayout | undefined,
  frameWidth: number,
  frameHeight: number
): WorkerLinkedPairLayout => {
  const safeMinDimension = Math.max(1, Math.min(frameWidth, frameHeight));
  const isVertical = frameHeight > frameWidth;
  const maxSize = Math.max(
    0.08,
    Math.min(
      1,
      isVertical ? frameWidth / safeMinDimension : frameWidth / safeMinDimension / 2,
      isVertical ? frameHeight / safeMinDimension / 2 : frameHeight / safeMinDimension
    )
  );
  const size = clamp(Number.isFinite(layout?.size) ? layout?.size ?? 0.34 : 0.34, 0.08, maxSize);
  const sizePx = size * safeMinDimension;
  const gap = clamp(
    Number.isFinite(layout?.gap) ? layout?.gap ?? 0.04 : 0.04,
    0,
    Math.max(0, 1 - (sizePx * 2) / Math.max(1, isVertical ? frameHeight : frameWidth))
  );
  const gapPx = gap * (isVertical ? frameHeight : frameWidth);
  const x = clamp(
    Number.isFinite(layout?.x) ? layout?.x ?? 0.14 : 0.14,
    0,
    isVertical ? Math.max(0, 1 - sizePx / Math.max(1, frameWidth)) : Math.max(0, 1 - (sizePx * 2 + gapPx) / Math.max(1, frameWidth))
  );
  const y = clamp(
    Number.isFinite(layout?.y) ? layout?.y ?? 0.18 : 0.18,
    0,
    isVertical ? Math.max(0, 1 - (sizePx * 2 + gapPx) / Math.max(1, frameHeight)) : Math.max(0, 1 - sizePx / Math.max(1, frameHeight))
  );

  return { x, y, size, gap };
};

const getLinkedPairBounds = (
  layout: WorkerLinkedPairLayout,
  frameWidth: number,
  frameHeight: number
) => {
  const safeLayout = normalizeLinkedPairLayout(layout, frameWidth, frameHeight);
  const sizePx = safeLayout.size * Math.min(frameWidth, frameHeight);
  const isVertical = frameHeight > frameWidth;
  const gapPx = safeLayout.gap * (isVertical ? frameHeight : frameWidth);
  const xPx = safeLayout.x * frameWidth;
  const yPx = safeLayout.y * frameHeight;

  return {
    puzzle: {
      x: xPx,
      y: yPx,
      size: sizePx
    },
    diff: {
      x: isVertical ? xPx : xPx + sizePx + gapPx,
      y: isVertical ? yPx + sizePx + gapPx : yPx,
      size: sizePx
    }
  };
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

const getVisibleSources = async (
  resource: OverlayResource,
  timestamp: number
): Promise<VisibleOverlaySource | null> => {
  const timeline = normalizeTimeline(resource.clip.timeline);
  if (timestamp < timeline.start || timestamp > timeline.end) return null;

  if (resource.kind === 'image') {
    return resource.bitmap;
  }

  const localTime = Math.max(0, timestamp - timeline.start);
  const duration = resource.duration > 0.01 ? resource.duration : 0.01;
  const lookupTimestamp = localTime % duration;
  const wrapped = await resource.sink.getCanvas(lookupTimestamp);
  return (wrapped?.canvas as OffscreenCanvas | undefined) ?? null;
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

  const sourceWidth = source.width;
  const sourceHeight = source.height;
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

const prepareLinkedPairResource = async (pair: WorkerLinkedPairInput): Promise<LinkedPairImageResource> => ({
  pair,
  puzzleBitmap: await createImageBitmap(pair.puzzleFile),
  diffBitmap: await createImageBitmap(pair.diffFile)
});

const releaseLinkedPairResource = (resource: LinkedPairImageResource) => {
  resource.puzzleBitmap.close();
  resource.diffBitmap.close();
};

const prepareBaseVideoResource = async (file: File): Promise<BaseVideoResource> => {
  const input = new Input({
    source: new BlobSource(file),
    formats: ALL_FORMATS
  });
  const track = await input.getPrimaryVideoTrack();
  if (!track) {
    throw new Error('The uploaded base file does not contain a video track.');
  }
  const sink = new CanvasSink(track, { alpha: true });
  let duration = 0;
  try {
    duration = await track.computeDuration();
  } catch {
    duration = 0;
  }

  return {
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
  outputLabel: string;
  overlayResources: OverlayResource[];
  settings: OverlayExportSettings;
  onProgress: (progress: number, status: string) => void;
}): Promise<ExportResult> => {
  const { base, outputLabel, overlayResources, settings, onProgress } = options;
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
    onProgress(clamp(progress, 0, 0.995), `Exporting ${outputLabel}`);
  };

  await conversion.execute();
  throwIfCanceled();

  const buffer = target.buffer;
  if (!buffer) {
    throw new Error(`Failed to build output for ${outputLabel}.`);
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

const drawImageContain = (
  ctx: OffscreenCanvasRenderingContext2D,
  bitmap: ImageBitmap,
  x: number,
  y: number,
  width: number,
  height: number
) => {
  const sourceWidth = Math.max(1, bitmap.width);
  const sourceHeight = Math.max(1, bitmap.height);
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const drawX = x + (width - drawWidth) / 2;
  const drawY = y + (height - drawHeight) / 2;
  ctx.drawImage(bitmap, drawX, drawY, drawWidth, drawHeight);
};

const normalizeLinkedPairStyle = (style: WorkerLinkedPairStyle | undefined): WorkerLinkedPairStyle => ({
  outlineColor: typeof style?.outlineColor === 'string' && style.outlineColor.trim() ? style.outlineColor : '#000000',
  outlineWidth: clamp(Number.isFinite(style?.outlineWidth) ? style?.outlineWidth ?? 6 : 6, 0, 36),
  cornerRadius: clamp(Number.isFinite(style?.cornerRadius) ? style?.cornerRadius ?? 18 : 18, 0, 72)
});

const addRoundedRectPath = (
  ctx: OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) => {
  const safeRadius = clamp(radius, 0, Math.min(width, height) / 2);
  ctx.beginPath();
  if (safeRadius <= 0) {
    ctx.rect(x, y, width, height);
    return;
  }
  ctx.moveTo(x + safeRadius, y);
  ctx.arcTo(x + width, y, x + width, y + height, safeRadius);
  ctx.arcTo(x + width, y + height, x, y + height, safeRadius);
  ctx.arcTo(x, y + height, x, y, safeRadius);
  ctx.arcTo(x, y, x + width, y, safeRadius);
  ctx.closePath();
};

const drawBaseFrame = async (options: {
  ctx: OffscreenCanvasRenderingContext2D;
  base: WorkerBaseInput;
  basePhotoBitmap: ImageBitmap | null;
  baseVideoResource: BaseVideoResource | null;
  timestamp: number;
  outputWidth: number;
  outputHeight: number;
}) => {
  const { ctx, base, basePhotoBitmap, baseVideoResource, timestamp, outputWidth, outputHeight } = options;

  if (base.mode === 'video' && baseVideoResource) {
    const safeDuration = baseVideoResource.duration > 0.01 ? baseVideoResource.duration : Math.max(0.5, base.durationSeconds);
    const wrapped = await baseVideoResource.sink.getCanvas(timestamp % safeDuration);
    const canvas = (wrapped?.canvas as OffscreenCanvas | undefined) ?? null;
    if (canvas) {
      ctx.drawImage(canvas, 0, 0, outputWidth, outputHeight);
      return;
    }
  }

  if (base.mode === 'photo' && basePhotoBitmap) {
    drawBasePhotoCover(ctx, basePhotoBitmap, outputWidth, outputHeight, base.color || '#ffffff');
    return;
  }

  ctx.fillStyle = base.color || '#ffffff';
  ctx.fillRect(0, 0, outputWidth, outputHeight);
};

const drawLinkedPairOnFrame = (
  ctx: OffscreenCanvasRenderingContext2D,
  pair: LinkedPairImageResource,
  layout: WorkerLinkedPairLayout,
  style: WorkerLinkedPairStyle | undefined,
  frameWidth: number,
  frameHeight: number
) => {
  const bounds = getLinkedPairBounds(layout, frameWidth, frameHeight);
  const safeStyle = normalizeLinkedPairStyle(style);
  const outputScale = Math.min(frameWidth, frameHeight) / 1080;
  const frameStroke = Math.max(0, safeStyle.outlineWidth * outputScale);
  const cornerRadius = Math.max(0, safeStyle.cornerRadius * outputScale);
  const panelFill = '#f8fafc';

  const drawPanel = (bitmap: ImageBitmap, x: number, y: number, size: number) => {
    ctx.save();
    addRoundedRectPath(ctx, x, y, size, size, cornerRadius);
    ctx.fillStyle = panelFill;
    ctx.fill();
    ctx.clip();
    drawImageContain(ctx, bitmap, x, y, size, size);
    if (frameStroke > 0) {
      addRoundedRectPath(ctx, x + frameStroke / 2, y + frameStroke / 2, size - frameStroke, size - frameStroke, Math.max(0, cornerRadius - frameStroke / 2));
      ctx.strokeStyle = safeStyle.outlineColor;
      ctx.lineWidth = frameStroke;
      ctx.stroke();
    }
    ctx.restore();
  };

  drawPanel(pair.puzzleBitmap, bounds.puzzle.x, bounds.puzzle.y, bounds.puzzle.size);
  drawPanel(pair.diffBitmap, bounds.diff.x, bounds.diff.y, bounds.diff.size);
};

const exportWithStaticBase = async (options: {
  base: WorkerBaseInput;
  basePhotoBitmap: ImageBitmap | null;
  photo: WorkerBatchPhoto;
  overlayResources: OverlayResource[];
  settings: OverlayExportSettings;
  outputLabel: string;
  onProgress: (progress: number, status: string) => void;
}): Promise<ExportResult> => {
  const { base, basePhotoBitmap, photo, overlayResources, settings, outputLabel, onProgress } = options;
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
    bitrateMode: 'constant',
    latencyMode: 'quality',
    contentHint: 'detail'
  });
  output.addVideoTrack(videoSource, { frameRate: FPS });

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
      onProgress(
        clamp(localProgress, 0, 0.995),
        `Rendering ${outputLabel} frame ${frameIndex + 1}/${totalFrames}`
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

const encodeLinkedPairTimeline = async (options: {
  base: WorkerBaseInput;
  basePhotoBitmap: ImageBitmap | null;
  baseVideoResource: BaseVideoResource | null;
  segments: Array<{ pair: LinkedPairImageResource; start: number; end: number }>;
  overlayResources: OverlayResource[];
  settings: OverlayExportSettings;
  linkedPairLayout: WorkerLinkedPairLayout;
  linkedPairStyle: WorkerLinkedPairStyle;
  outputLabel: string;
  onProgress: (progress: number, status: string) => void;
}): Promise<ExportResult> => {
  const {
    base,
    basePhotoBitmap,
    baseVideoResource,
    segments,
    overlayResources,
    settings,
    linkedPairLayout,
    linkedPairStyle,
    outputLabel,
    onProgress
  } = options;
  const codecConfig = FORMAT_BY_CODEC[settings.exportCodec];
  const maxOverlayEnd = overlayResources.reduce((acc, resource) => {
    const timeline = normalizeTimeline(resource.clip.timeline);
    return Math.max(acc, timeline.end);
  }, 0);
  const lastSegmentEnd = segments.reduce((acc, segment) => Math.max(acc, segment.end), 0);
  const duration = Math.max(0.5, base.durationSeconds, maxOverlayEnd, lastSegmentEnd);
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
  if (!ctx) throw new Error('Failed to initialize linked pair export canvas context.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const scratchCanvas = new OffscreenCanvas(2, 2);
  const scratchCtx = scratchCanvas.getContext('2d');
  if (!scratchCtx) throw new Error('Failed to initialize linked pair scratch canvas context.');
  scratchCtx.imageSmoothingEnabled = true;
  scratchCtx.imageSmoothingQuality = 'high';

  const videoSource = new CanvasSource(canvas, {
    codec: codecConfig.codec,
    bitrate,
    bitrateMode: 'constant',
    latencyMode: 'quality',
    contentHint: 'detail'
  });
  output.addVideoTrack(videoSource, { frameRate: FPS });

  await output.start();
  throwIfCanceled();

  const progressStep = Math.max(1, Math.floor(totalFrames / 120));

  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
    throwIfCanceled();
    const timestamp = frameIndex / FPS;
    ctx.clearRect(0, 0, outputWidth, outputHeight);
    await drawBaseFrame({
      ctx,
      base,
      basePhotoBitmap,
      baseVideoResource,
      timestamp,
      outputWidth,
      outputHeight
    });

    const activeSegment = segments.find((segment) => timestamp >= segment.start && timestamp <= segment.end);
    if (activeSegment) {
      drawLinkedPairOnFrame(ctx, activeSegment.pair, linkedPairLayout, linkedPairStyle, outputWidth, outputHeight);
    }

    await renderOverlayResources(ctx, overlayResources, timestamp, outputWidth, outputHeight, scratchCanvas, scratchCtx);
    await videoSource.add(timestamp, 1 / FPS);

    if (frameIndex % progressStep === 0 || frameIndex === totalFrames - 1) {
      const localProgress = (frameIndex + 1) / totalFrames;
      onProgress(
        clamp(localProgress, 0, 0.995),
        `Rendering ${outputLabel} frame ${frameIndex + 1}/${totalFrames}`
      );
    }
  }

  await output.finalize();
  throwIfCanceled();

  const buffer = target.buffer;
  if (!buffer) {
    throw new Error(`Failed to build output for ${outputLabel}.`);
  }

  return {
    buffer,
    width: outputWidth,
    height: outputHeight,
    mimeType: codecConfig.mimeType,
    extension: codecConfig.extension
  };
};

const exportLinkedPairOutput = async (
  base: WorkerBaseInput,
  overlays: WorkerOverlayMedia[],
  settings: OverlayExportSettings,
  target: Extract<OverlayWorkerOutputTarget, { kind: 'linked_pairs' }>
) => {
  if (!target.segments.length) {
    throw new Error('No linked puzzle pair segments provided.');
  }
  if (base.mode === 'video' && !base.videoFile) throw new Error('Missing base video file.');
  if (base.mode === 'photo' && !base.photoFile) throw new Error('Missing base photo file.');

  const commonOverlayResources: OverlayResource[] = [];
  const linkedPairResources: LinkedPairImageResource[] = [];
  let basePhotoBitmap: ImageBitmap | null = null;
  let baseVideoResource: BaseVideoResource | null = null;

  try {
    for (let index = 0; index < overlays.length; index += 1) {
      throwIfCanceled();
      commonOverlayResources.push(await prepareOverlayResource(overlays[index]));
    }

    for (let index = 0; index < target.segments.length; index += 1) {
      throwIfCanceled();
      linkedPairResources.push(await prepareLinkedPairResource(target.segments[index].pair));
    }

    if (base.mode === 'photo' && base.photoFile) {
      basePhotoBitmap = await createImageBitmap(base.photoFile);
    }
    if (base.mode === 'video' && base.videoFile) {
      baseVideoResource = await prepareBaseVideoResource(base.videoFile);
    }

    const result = await encodeLinkedPairTimeline({
      base,
      basePhotoBitmap,
      baseVideoResource,
      segments: target.segments.map((segment, index) => ({
        pair: linkedPairResources[index],
        start: segment.start,
        end: segment.end
      })),
      overlayResources: commonOverlayResources,
      settings,
      linkedPairLayout: target.linkedPairLayout ?? { x: 0.14, y: 0.18, size: 0.34, gap: 0.04 },
      linkedPairStyle: normalizeLinkedPairStyle(target.linkedPairStyle),
      outputLabel: target.outputLabel,
      onProgress: (progress, status) => {
        postToMain({ type: 'progress', progress, status });
      }
    });

    return {
      fileName: `${sanitizeName(target.outputLabel)}-${result.width}x${result.height}.${result.extension}`,
      mimeType: result.mimeType,
      buffer: result.buffer
    };
  } finally {
    commonOverlayResources.forEach(releaseOverlayResource);
    linkedPairResources.forEach(releaseLinkedPairResource);
    basePhotoBitmap?.close();
    activeConversion = null;
  }
};

const exportStandardOutput = async (
  base: WorkerBaseInput,
  overlays: WorkerOverlayMedia[],
  settings: OverlayExportSettings,
  target: Extract<OverlayWorkerOutputTarget, { kind: 'standard' }>
) => {
  if (!target.photo && base.mode !== 'video') {
    throw new Error('Missing batch image for non-video overlay export.');
  }
  if (base.mode === 'video' && !base.videoFile) throw new Error('Missing base video file.');
  if (base.mode === 'photo' && !base.photoFile) throw new Error('Missing base photo file.');

  const commonOverlayResources: OverlayResource[] = [];
  let basePhotoBitmap: ImageBitmap | null = null;
  let primaryResource: OverlayResource | null = null;

  try {
    for (let index = 0; index < overlays.length; index += 1) {
      throwIfCanceled();
      commonOverlayResources.push(await prepareOverlayResource(overlays[index]));
    }

    if (base.mode === 'photo' && base.photoFile) {
      basePhotoBitmap = await createImageBitmap(base.photoFile);
    }

    const clipResources = [...commonOverlayResources];
    if (target.photo) {
      primaryResource = await prepareOverlayResource(target.photo);
      clipResources.unshift(primaryResource);
    }

    const result =
      base.mode === 'video'
        ? await exportWithVideoBase({
            base,
            outputLabel: target.outputLabel,
            overlayResources: clipResources,
            settings,
            onProgress: (progress, status) => {
              postToMain({ type: 'progress', progress, status });
            }
          })
        : await exportWithStaticBase({
            base,
            basePhotoBitmap,
            photo: target.photo as WorkerBatchPhoto,
            overlayResources: clipResources,
            settings,
            outputLabel: target.outputLabel,
            onProgress: (progress, status) => {
              postToMain({ type: 'progress', progress, status });
            }
          });

    return {
      fileName: `${sanitizeName(target.outputLabel)}-${result.width}x${result.height}.${result.extension}`,
      mimeType: result.mimeType,
      buffer: result.buffer
    };
  } finally {
    commonOverlayResources.forEach(releaseOverlayResource);
    if (primaryResource) {
      releaseOverlayResource(primaryResource);
    }
    basePhotoBitmap?.close();
    activeConversion = null;
  }
};

const exportOverlayOutput = async (
  base: WorkerBaseInput,
  overlays: WorkerOverlayMedia[],
  settings: OverlayExportSettings,
  target: OverlayWorkerOutputTarget
) => {
  postToMain({
    type: 'progress',
    progress: 0,
    status: `Preparing ${target.outputLabel}...`
  });

  if (target.kind === 'linked_pairs') {
    return await exportLinkedPairOutput(base, overlays, settings, target);
  }

  return await exportStandardOutput(base, overlays, settings, target);
};

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;

  if (message.type === 'cancel') {
    isCanceled = true;
    if (activeConversion) {
      activeConversion.cancel().catch(() => undefined);
    }
    if (activeTaskId) {
      emitTaskEvent({
        taskId: activeTaskId,
        label: 'Overlay Export',
        stage: 'encode',
        state: 'cancelled'
      });
    }
    emitStats({ queueSize: 0, runningTasks: 0 });
    return;
  }

  if (message.type !== 'start') return;

  const { base, overlays, settings, target, workerSessionId } = message.payload;
  currentWorkerSessionId = workerSessionId || 'primary';
  isCanceled = false;
  activeTaskId = target.taskId;
  activeTaskStartedAt = performance.now();

  try {
    emitTaskEvent({
      taskId: activeTaskId,
      label: target.outputLabel,
      stage: 'render',
      state: 'queued'
    });
    emitTaskEvent({
      taskId: activeTaskId,
      label: target.outputLabel,
      stage: 'render',
      state: 'running'
    });
    emitStats({ queueSize: 0, runningTasks: 1 });

    const result = await exportOverlayOutput(base, overlays, settings, target);

    emitTaskEvent({
      taskId: activeTaskId,
      label: target.outputLabel,
      stage: 'encode',
      state: 'done',
      durationMs: Math.max(0, performance.now() - activeTaskStartedAt)
    });
    emitStats({
      queueSize: 0,
      runningTasks: 0,
      avgTaskMs: Math.max(0, performance.now() - activeTaskStartedAt)
    });
    postToMain(
      {
        type: 'done',
        fileName: result.fileName,
        mimeType: result.mimeType,
        buffer: result.buffer
      },
      [result.buffer]
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Overlay export failed.';
    if (errorMessage === '__OVERLAY_EXPORT_CANCELED__' || isCanceled) {
      emitStats({ queueSize: 0, runningTasks: 0 });
      postToMain({ type: 'cancelled' });
    } else {
      if (activeTaskId) {
        emitTaskEvent({
          taskId: activeTaskId,
          label: target.outputLabel,
          stage: 'encode',
          state: 'failed',
          durationMs: Math.max(0, performance.now() - activeTaskStartedAt),
          meta: {
            message: errorMessage
          }
        });
      }
      emitStats({ queueSize: 0, runningTasks: 0 });
      postToMain({ type: 'error', message: errorMessage });
    }
  } finally {
    activeConversion = null;
    isCanceled = false;
    activeTaskId = null;
    activeTaskStartedAt = 0;
    currentWorkerSessionId = 'primary';
  }
};
