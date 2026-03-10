import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
  canEncodeVideo
} from 'mediabunny';
import { VISUAL_THEMES } from '../constants/videoThemes';
import { VideoSettings } from '../types';

type ProgressBarExportSettings = Pick<
  VideoSettings,
  'exportResolution' | 'exportBitrateMbps' | 'exportCodec'
>;

interface WorkerStartMessage {
  type: 'start';
  payload: {
    style: VideoSettings['visualStyle'];
    durationSeconds: number;
    settings: ProgressBarExportSettings;
  };
}

interface WorkerCancelMessage {
  type: 'cancel';
}

type WorkerMessage = WorkerStartMessage | WorkerCancelMessage;

type WorkerResponse =
  | { type: 'progress'; progress: number; status?: string }
  | { type: 'done'; buffer: ArrayBuffer; mimeType: string; fileName: string }
  | { type: 'error'; message: string }
  | { type: 'cancelled' };

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  radius?: number;
}

let isCanceled = false;

const FPS = 30;

const RESOLUTION_HEIGHT: Record<ProgressBarExportSettings['exportResolution'], number> = {
  '480p': 480,
  '720p': 720,
  '1080p': 1080,
  '1440p': 1440,
  '2160p': 2160
};

const FORMAT_BY_CODEC = {
  h264: {
    codec: 'avc' as const,
    format: new Mp4OutputFormat(),
    extension: 'mp4',
    mimeType: 'video/mp4'
  },
  av1: {
    codec: 'av1' as const,
    format: new WebMOutputFormat(),
    extension: 'webm',
    mimeType: 'video/webm'
  }
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);

const extractHexColors = (input: string): string[] =>
  (input.match(/#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})/g) ?? []).map((value) =>
    value.length === 4
      ? `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`
      : value
  );

const createRepeatingStripePattern = (
  ctx: CanvasRenderingContext2D,
  colors: string[]
): CanvasPattern | null => {
  const tileSize = 28;
  const patternCanvas = new OffscreenCanvas(tileSize, tileSize);
  const patternCtx = patternCanvas.getContext('2d');
  if (!patternCtx) return null;

  patternCtx.fillStyle = colors[0];
  patternCtx.fillRect(0, 0, tileSize, tileSize);
  patternCtx.translate(tileSize / 2, tileSize / 2);
  patternCtx.rotate(-Math.PI / 4);
  const stripeWidth = 8;
  const stripeLength = tileSize * 2;
  for (let index = -3; index < colors.length + 3; index += 1) {
    const color = colors[(index + colors.length) % colors.length];
    patternCtx.fillStyle = color;
    patternCtx.fillRect(index * stripeWidth, -stripeLength / 2, stripeWidth, stripeLength);
  }
  return ctx.createPattern(patternCanvas, 'repeat');
};

const resolveProgressFill = (
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  fillDefinition: string,
  fallbackColor: string
): CanvasGradient | CanvasPattern | string => {
  const colors = extractHexColors(fillDefinition);
  if (colors.length === 0) return fallbackColor;

  if (fillDefinition.includes('repeating-linear-gradient')) {
    return createRepeatingStripePattern(ctx, colors) ?? colors[0];
  }

  const angleMatch = fillDefinition.match(/(-?\d+(?:\.\d+)?)deg/);
  const angleDeg = angleMatch ? Number.parseFloat(angleMatch[1]) : 90;
  const normalizedAngle = ((angleDeg % 360) + 360) % 360;
  const horizontal = normalizedAngle === 90 || normalizedAngle === 270;
  const vertical = normalizedAngle === 0 || normalizedAngle === 180;

  const gradient = horizontal
    ? ctx.createLinearGradient(rect.x, rect.y, rect.x + rect.width, rect.y)
    : vertical
    ? ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.height)
    : ctx.createLinearGradient(rect.x, rect.y, rect.x + rect.width, rect.y + rect.height);

  const denominator = Math.max(1, colors.length - 1);
  colors.forEach((color, index) => {
    gradient.addColorStop(index / denominator, color);
  });
  return gradient;
};

const roundRectPath = (ctx: CanvasRenderingContext2D, rect: Rect) => {
  const radius = clamp(rect.radius ?? 0, 0, Math.min(rect.width, rect.height) / 2);
  ctx.beginPath();
  ctx.moveTo(rect.x + radius, rect.y);
  ctx.lineTo(rect.x + rect.width - radius, rect.y);
  ctx.quadraticCurveTo(rect.x + rect.width, rect.y, rect.x + rect.width, rect.y + radius);
  ctx.lineTo(rect.x + rect.width, rect.y + rect.height - radius);
  ctx.quadraticCurveTo(
    rect.x + rect.width,
    rect.y + rect.height,
    rect.x + rect.width - radius,
    rect.y + rect.height
  );
  ctx.lineTo(rect.x + radius, rect.y + rect.height);
  ctx.quadraticCurveTo(rect.x, rect.y + rect.height, rect.x, rect.y + rect.height - radius);
  ctx.lineTo(rect.x, rect.y + radius);
  ctx.quadraticCurveTo(rect.x, rect.y, rect.x + radius, rect.y);
  ctx.closePath();
};

const drawRoundedRect = (
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  options: {
    fill?: string | CanvasGradient | CanvasPattern;
    stroke?: string | CanvasGradient | CanvasPattern;
    lineWidth?: number;
  }
) => {
  roundRectPath(ctx, rect);
  if (options.fill) {
    ctx.fillStyle = options.fill;
    ctx.fill();
  }
  if (options.stroke && (options.lineWidth ?? 0) > 0) {
    ctx.strokeStyle = options.stroke;
    ctx.lineWidth = options.lineWidth ?? 1;
    ctx.stroke();
  }
};

const getExportDimensions = (resolution: ProgressBarExportSettings['exportResolution']) => {
  const height = RESOLUTION_HEIGHT[resolution];
  const width = even((height * 16) / 9);
  return { width, height };
};

const drawFrame = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  style: VideoSettings['visualStyle'],
  durationSeconds: number,
  timestamp: number
) => {
  const theme = VISUAL_THEMES[style];
  const progress = clamp(timestamp / Math.max(0.001, durationSeconds), 0, 1);
  const remaining = 1 - progress;
  ctx.clearRect(0, 0, width, height);

  const barWidth = Math.round(width * 0.82);
  const barHeight = Math.max(26, Math.round(height * 0.11));
  const trackRect: Rect = {
    x: Math.round((width - barWidth) / 2),
    y: Math.round((height - barHeight) / 2),
    width: barWidth,
    height: barHeight,
    radius: Math.max(8, Math.round(barHeight / 2))
  };

  drawRoundedRect(ctx, trackRect, {
    fill: theme.progressTrackBg,
    stroke: theme.progressTrackBorder,
    lineWidth: Math.max(2, Math.round(width * 0.0018))
  });

  const fillRect: Rect = {
    x: trackRect.x + 3,
    y: trackRect.y + 3,
    width: Math.max(0, (trackRect.width - 6) * remaining),
    height: Math.max(0, trackRect.height - 6),
    radius: Math.max(4, (trackRect.height - 6) / 2)
  };

  if (fillRect.width > 0 && fillRect.height > 0) {
    roundRectPath(ctx, fillRect);
    ctx.fillStyle = resolveProgressFill(ctx, fillRect, theme.progressFill, theme.timerDot);
    ctx.fill();

    const shimmerWidth = Math.max(8, fillRect.width * 0.2);
    const shimmerRect: Rect = {
      x: fillRect.x + fillRect.width - shimmerWidth,
      y: fillRect.y,
      width: shimmerWidth,
      height: fillRect.height,
      radius: fillRect.radius
    };
    const shimmerGradient = ctx.createLinearGradient(
      shimmerRect.x,
      shimmerRect.y,
      shimmerRect.x + shimmerRect.width,
      shimmerRect.y
    );
    shimmerGradient.addColorStop(0, 'rgba(255,255,255,0)');
    shimmerGradient.addColorStop(1, 'rgba(255,255,255,0.45)');
    roundRectPath(ctx, shimmerRect);
    ctx.fillStyle = shimmerGradient;
    ctx.fill();
  }
};

const throwIfCanceled = () => {
  if (isCanceled) {
    throw new Error('__EXPORT_CANCELED__');
  }
};

const exportProgressBarInWorker = async ({
  style,
  durationSeconds,
  settings,
  onProgress
}: {
  style: VideoSettings['visualStyle'];
  durationSeconds: number;
  settings: ProgressBarExportSettings;
  onProgress?: (progress: number, status?: string) => void;
}): Promise<{ buffer: ArrayBuffer; fileName: string; mimeType: string }> => {
  const duration = Math.max(0.5, durationSeconds);
  const { width, height } = getExportDimensions(settings.exportResolution);
  const totalFrames = Math.max(1, Math.ceil(duration * FPS));
  const bitrate = Math.max(500_000, Math.round(settings.exportBitrateMbps * 1_000_000));
  const codecConfig = FORMAT_BY_CODEC[settings.exportCodec];

  const canEncode = await canEncodeVideo(codecConfig.codec, { width, height, bitrate });
  if (!canEncode) {
    throw new Error(
      `Your browser could not encode ${settings.exportCodec.toUpperCase()} at ${settings.exportResolution}. Try lower resolution/bitrate or switch codec.`
    );
  }
  throwIfCanceled();

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Unable to initialize canvas renderer for export.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const target = new BufferTarget();
  const output = new Output({
    format: codecConfig.format,
    target
  });
  const videoSource = new CanvasSource(canvas, {
    codec: codecConfig.codec,
    bitrate,
    bitrateMode: 'constant',
    latencyMode: 'quality',
    contentHint: 'detail',
    alpha: settings.exportCodec === 'av1' ? 'keep' : 'discard'
  });
  output.addVideoTrack(videoSource, { frameRate: FPS });

  onProgress?.(0.04, 'Starting encoder...');
  await output.start();
  throwIfCanceled();

  const progressStep = Math.max(1, Math.floor(totalFrames / 120));
  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
    const timestamp = frameIndex / FPS;
    drawFrame(ctx as unknown as CanvasRenderingContext2D, width, height, style, duration, timestamp);
    await videoSource.add(timestamp, 1 / FPS);
    throwIfCanceled();

    if (frameIndex % progressStep === 0 || frameIndex === totalFrames - 1) {
      const exportProgress = 0.06 + ((frameIndex + 1) / totalFrames) * 0.9;
      onProgress?.(exportProgress, `Encoding frame ${frameIndex + 1}/${totalFrames}`);
    }
  }

  onProgress?.(0.97, 'Finalizing file...');
  await output.finalize();
  throwIfCanceled();

  const buffer = target.buffer;
  if (!buffer) throw new Error('Failed to build exported progress-bar video buffer.');

  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
    now.getDate()
  ).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(
    2,
    '0'
  )}${String(now.getSeconds()).padStart(2, '0')}`;

  const fileName = `spotitnow-progress-${style}-${duration.toFixed(1)}s-${settings.exportResolution}-${settings.exportCodec}-${stamp}.${codecConfig.extension}`;
  return {
    buffer,
    fileName,
    mimeType: codecConfig.mimeType
  };
};

const postMessageToMain = (message: WorkerResponse, transfer: Transferable[] = []) => {
  (self as any).postMessage(message, transfer);
};

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;

  if (message.type === 'cancel') {
    isCanceled = true;
    return;
  }

  if (message.type !== 'start') return;

  isCanceled = false;

  try {
    const { style, durationSeconds, settings } = message.payload;
    const result = await exportProgressBarInWorker({
      style,
      durationSeconds,
      settings,
      onProgress: (progress, status) => {
        postMessageToMain({ type: 'progress', progress, status });
      }
    });

    postMessageToMain(
      {
        type: 'done',
        buffer: result.buffer,
        fileName: result.fileName,
        mimeType: result.mimeType
      },
      [result.buffer]
    );
  } catch (error) {
    const messageText = error instanceof Error ? error.message : 'Progress-bar export failed.';
    if (messageText === '__EXPORT_CANCELED__') {
      postMessageToMain({ type: 'cancelled' });
    } else {
      postMessageToMain({ type: 'error', message: messageText });
    }
  }
};
