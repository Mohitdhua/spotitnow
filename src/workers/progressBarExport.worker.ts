import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
  canEncodeVideo
} from 'mediabunny';
import { PROGRESS_BAR_THEMES, resolveProgressBarFillColors, type ProgressBarVisualStyle } from '../constants/progressBarThemes';
import { VideoSettings } from '../types';
import type { ProgressBarRenderMode } from '../services/progressBarExport';
import {
  resolveSmoothTextProgressFillColors,
  resolveTextProgressFillSpan,
  resolveTextProgressSpanFromMetrics
} from '../utils/textProgressFill';
import {
  resolveTextProgressBaseAccent,
  resolveTextProgressEffectFrame,
  resolveTextProgressShellStyle
} from '../utils/textProgressEffects';
import { drawTextProgressCanvasEffects } from '../utils/textProgressCanvasEffects';
import { resolveVideoProgressMotionState } from '../utils/videoProgressMotion';

type ProgressBarExportSettings = Pick<
  VideoSettings,
  'exportResolution' | 'exportBitrateMbps' | 'exportCodec'
>;

interface WorkerStartMessage {
  type: 'start';
  payload: {
    style: ProgressBarVisualStyle;
    durationSeconds: number;
    renderMode: ProgressBarRenderMode;
    progressLabel: string;
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
const hexToRgba = (hex: string, alpha: number) => {
  const sanitized = hex.replace('#', '');
  const normalized =
    sanitized.length === 3
      ? sanitized
          .split('')
          .map((char) => char + char)
          .join('')
      : sanitized.padEnd(6, '0').slice(0, 6);
  const value = Number.parseInt(normalized, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

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

const drawProgressPulseOverlay = (
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  pulseOpacity: number
) => {
  if (rect.width <= 0 || rect.height <= 0 || pulseOpacity <= 0) return;

  ctx.save();
  roundRectPath(ctx, rect);
  ctx.clip();
  ctx.globalAlpha = clamp(pulseOpacity, 0, 1);
  const pulseWidth = Math.max(22, rect.width * 0.28);
  const pulseX = rect.x + rect.width - pulseWidth;
  const gradient = ctx.createLinearGradient(pulseX, 0, pulseX + pulseWidth, 0);
  gradient.addColorStop(0, 'rgba(255,255,255,0)');
  gradient.addColorStop(0.45, 'rgba(255,255,255,0.08)');
  gradient.addColorStop(0.78, 'rgba(255,255,255,0.32)');
  gradient.addColorStop(1, 'rgba(255,255,255,0.84)');
  ctx.fillStyle = gradient;
  ctx.fillRect(pulseX, rect.y, pulseWidth, rect.height);
  ctx.restore();
};

const drawProgressPulseGlow = (
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  pulseGlowOpacity: number,
  glowColor: string,
  blurBase: number,
  lineWidth: number,
  strokeColor = 'rgba(255,255,255,0.82)'
) => {
  if (rect.width <= 0 || rect.height <= 0 || pulseGlowOpacity <= 0) return;

  ctx.save();
  roundRectPath(ctx, rect);
  ctx.shadowColor = glowColor;
  ctx.shadowBlur = Math.max(blurBase, Math.round(blurBase * (1 + pulseGlowOpacity * 1.8)));
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  ctx.restore();
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

const resolveTextProgressFillColors = (
  remainingPercent: number,
  style: ProgressBarVisualStyle,
  theme: (typeof PROGRESS_BAR_THEMES)[ProgressBarVisualStyle]
) => {
  return resolveSmoothTextProgressFillColors(
    remainingPercent,
    theme,
    resolveProgressBarFillColors(style, remainingPercent / 100)
  );
};

const resolveTextProgressFontSize = (text: string, width: number, height: number, preferred: number) => {
  const safeText = text.trim() || 'PROGRESS';
  const widthBound = width / Math.max(4.8, safeText.length * 0.68);
  const heightBound = height * 0.78;
  return clamp(Math.min(preferred, widthBound, heightBound), 12, 160);
};

const drawTextFillProgress = (
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  label: string,
  remainingPercent: number,
  style: ProgressBarVisualStyle,
  theme: (typeof PROGRESS_BAR_THEMES)[ProgressBarVisualStyle],
  scale: number,
  animationSeconds: number
) => {
  const safeLabel = label.trim() || 'PROGRESS';
  const textX = rect.x + rect.width / 2;
  const textY = rect.y + rect.height * 0.68;
  const fillColors = resolveTextProgressFillColors(remainingPercent, style, theme);
  const shellStyle = resolveTextProgressShellStyle(style, fillColors);
  const fontSize = Math.max(
    12,
    Math.round(
      resolveTextProgressFontSize(safeLabel, rect.width, rect.height, Math.max(22, 38 * scale)) *
        shellStyle.fontScale
    )
  );
  const strokeWidth = Math.max(2, Math.round(fontSize * 0.08 * shellStyle.strokeScale));
  const textCanvas = new OffscreenCanvas(Math.max(1, Math.ceil(rect.width)), Math.max(1, Math.ceil(rect.height)));
  const textCtx = textCanvas.getContext('2d');

  if (!textCtx) return;

  textCtx.clearRect(0, 0, rect.width, rect.height);
  textCtx.textAlign = 'center';
  textCtx.textBaseline = 'alphabetic';
  textCtx.font = `900 ${fontSize}px "Arial Black", "Segoe UI", sans-serif`;
  const textSpan = resolveTextProgressSpanFromMetrics(rect.width, textCtx.measureText(safeLabel));
  const fillSpan = resolveTextProgressFillSpan(textSpan, clamp(remainingPercent, 0, 100) / 100);
  const textEffects = resolveTextProgressEffectFrame({
    style,
    width: rect.width,
    height: rect.height,
    fillX: fillSpan.left,
    fillWidth: fillSpan.fillWidth,
    spanWidth: fillSpan.width,
    fillRatio: fillSpan.fillRatio,
    animationSeconds,
    fillColors
  });
  textCtx.fillStyle = '#000000';
  textCtx.fillText(safeLabel, rect.width / 2, rect.height * 0.68);
  textCtx.globalCompositeOperation = 'source-in';
  const gradient = textCtx.createLinearGradient(0, 0, rect.width, 0);
  gradient.addColorStop(0, fillColors.start);
  gradient.addColorStop(0.58, fillColors.middle);
  gradient.addColorStop(1, fillColors.end);
  textCtx.fillStyle = gradient;
  textCtx.fillRect(fillSpan.left, 0, fillSpan.fillWidth, rect.height);
  drawTextProgressCanvasEffects(
    textCtx,
    textEffects,
    fillSpan.left,
    fillSpan.fillWidth,
    rect.height,
    resolveTextProgressBaseAccent(style, fillColors)
  );

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `900 ${fontSize}px "Arial Black", "Segoe UI", sans-serif`;
  ctx.lineWidth = strokeWidth;
  ctx.strokeStyle = shellStyle.stroke;
  ctx.fillStyle = shellStyle.fill;
  ctx.strokeText(safeLabel, textX, textY);
  ctx.fillText(safeLabel, textX, textY);
  ctx.drawImage(textCanvas, rect.x, rect.y, rect.width, rect.height);
  ctx.restore();
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
  style: ProgressBarVisualStyle,
  durationSeconds: number,
  timestamp: number,
  renderMode: ProgressBarRenderMode,
  progressLabel: string
) => {
  const theme = PROGRESS_BAR_THEMES[style];
  const progress = clamp(timestamp / Math.max(0.001, durationSeconds), 0, 1);
  const remaining = 1 - progress;
  const motionState = resolveVideoProgressMotionState({
    mode: 'countdown',
    phase: 'showing',
    phaseDuration: durationSeconds,
    timeLeft: Math.max(0, durationSeconds - timestamp)
  });
  ctx.clearRect(0, 0, width, height);

  const barWidth = Math.round(width * 0.82);
  const barHeight =
    renderMode === 'text_fill'
      ? Math.max(42, Math.round(height * 0.16))
      : Math.max(26, Math.round(height * 0.11));
  const trackRect: Rect = {
    x: Math.round((width - barWidth) / 2),
    y: Math.round((height - barHeight) / 2),
    width: barWidth,
    height: barHeight,
    radius: Math.max(8, Math.round(barHeight / 2))
  };

  if (renderMode === 'text_fill') {
    drawTextFillProgress(ctx, trackRect, progressLabel, remaining * 100, style, theme, width / 1280, timestamp);
    return;
  }

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
    const dynamicFillColors = resolveProgressBarFillColors(style, remaining);
    if (dynamicFillColors) {
      const gradient = ctx.createLinearGradient(fillRect.x, fillRect.y, fillRect.x + fillRect.width, fillRect.y);
      gradient.addColorStop(0, dynamicFillColors.start);
      gradient.addColorStop(0.58, dynamicFillColors.middle);
      gradient.addColorStop(1, dynamicFillColors.end);
      ctx.fillStyle = gradient;
    } else {
      ctx.fillStyle = resolveProgressFill(ctx, fillRect, theme.progressFill, theme.timerDot);
    }
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
    drawProgressPulseOverlay(ctx, fillRect, motionState.pulseOverlayOpacity);
    drawProgressPulseGlow(
      ctx,
      fillRect,
      motionState.pulseGlowOpacity,
      hexToRgba(dynamicFillColors?.middle ?? theme.timerDot, 0.16 + motionState.pulseGlowOpacity * 0.36),
      Math.max(10, Math.round(width * 0.006)),
      Math.max(2, Math.round(width * 0.0018))
    );
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
  renderMode,
  progressLabel,
  settings,
  onProgress
}: {
  style: ProgressBarVisualStyle;
  durationSeconds: number;
  renderMode: ProgressBarRenderMode;
  progressLabel: string;
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
    drawFrame(ctx as unknown as CanvasRenderingContext2D, width, height, style, duration, timestamp, renderMode, progressLabel);
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

  const variantLabel = renderMode === 'text_fill' ? 'text-fill' : 'bar';
  const fileName = `spotitnow-progress-${style}-${variantLabel}-${duration.toFixed(1)}s-${settings.exportResolution}-${settings.exportCodec}-${stamp}.${codecConfig.extension}`;
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
    const { style, durationSeconds, renderMode, progressLabel, settings } = message.payload;
    const result = await exportProgressBarInWorker({
      style,
      durationSeconds,
      renderMode,
      progressLabel,
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
