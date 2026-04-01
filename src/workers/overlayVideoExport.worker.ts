import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSink,
  AudioSampleSource,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat
} from 'mediabunny';
import { VIDEO_PACKAGE_PRESETS } from '../constants/videoPackages';
import { VISUAL_THEMES, resolveVisualThemeStyle, type VisualTheme } from '../constants/videoThemes';
import {
  PROGRESS_BAR_THEMES,
  resolveProgressBarFillColors,
  resolveProgressBarFillStyle
} from '../constants/progressBarThemes';
import {
  applyTextTransform,
  buildProgressFillDefinition,
  radiusTokenToPx,
  resolveVideoStyleModules
} from '../constants/videoStyleModules';
import type { MediaTaskEventMessage, MediaWorkerStatsMessage } from '../services/mediaTelemetry';
import { decodeRuntimeImageBitmapFromBlob } from '../services/canvasRuntime';
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
  OverlaySoundtrackInput as WorkerSoundtrackInput,
  OverlayTimeline,
  OverlayWorkerOutputTarget,
  OverlayWorkerStartPayload
} from '../services/overlayVideoExport';
import { resolveSmoothTextProgressFillColors } from '../utils/textProgressFill';
import {
  resolveTextProgressBaseAccent,
  resolveTextProgressEffectFrame,
  resolveTextProgressShellStyle
} from '../utils/textProgressEffects';
import { drawTextProgressCanvasEffects } from '../utils/textProgressCanvasEffects';
import { resolveVideoProgressMotionState } from '../utils/videoProgressMotion';
import { resolveVideoEncodingPlan } from './videoEncoding';

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

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  radius?: number;
}

interface OverlayProgressWindow {
  start: number;
  end: number;
  current: number;
  total: number;
  themeIndex: number;
}

type ProgressCanvasContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

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
  {
    codec: 'avc' | 'av1';
    audioCodec: 'aac' | 'opus';
    extension: string;
    mimeType: string;
    outputFormat: Mp4OutputFormat | WebMOutputFormat;
  }
> = {
  h264: {
    codec: 'avc',
    audioCodec: 'aac',
    extension: 'mp4',
    mimeType: 'video/mp4',
    outputFormat: new Mp4OutputFormat()
  },
  av1: {
    codec: 'av1',
    audioCodec: 'opus',
    extension: 'webm',
    mimeType: 'video/webm',
    outputFormat: new WebMOutputFormat()
  }
};

const AUDIO_BITRATE = 128_000;

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

const fillTemplate = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) => String(values[key] ?? ''));

const hexToRgba = (hex: string, alpha: number) => {
  if (!hex.startsWith('#')) return hex;
  const normalized =
    hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  const r = Number.parseInt(normalized.slice(1, 3), 16);
  const g = Number.parseInt(normalized.slice(3, 5), 16);
  const b = Number.parseInt(normalized.slice(5, 7), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return hex;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const extractHexColors = (input: string): string[] =>
  (input.match(/#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})/g) ?? []).map((value) =>
    value.length === 4
      ? `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`
      : value
  );

const createRepeatingStripePattern = (
  ctx: ProgressCanvasContext,
  colors: string[]
): CanvasPattern | null => {
  const tileSize = 24;
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
  ctx: ProgressCanvasContext,
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

const roundRectPath = (ctx: ProgressCanvasContext, rect: Rect) => {
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
  ctx: ProgressCanvasContext,
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
    ctx.lineWidth = options.lineWidth ?? 1;
    ctx.strokeStyle = options.stroke;
    ctx.stroke();
  }
};

const resolveTextProgressFontSize = (text: string, width: number, height: number, preferred: number) => {
  const safeText = text.trim() || 'PROGRESS';
  const widthBound = width / Math.max(4.8, safeText.length * 0.68);
  const heightBound = height * 0.78;
  return clamp(Math.min(preferred, widthBound, heightBound), 12, 256);
};

const drawTextProgressLabel = (
  ctx: ProgressCanvasContext,
  rect: Rect,
  label: string,
  fillPercent: number,
  colorPercent: number,
  styleModules: ReturnType<typeof resolveVideoStyleModules>,
  visualTheme: VisualTheme,
  scale: number,
  generatedStyle: OverlayExportSettings['generatedProgressStyle'] | null,
  animationSeconds: number,
  dynamicFillColors?: ReturnType<typeof resolveProgressBarFillColors>,
  sweep?: {
    active: boolean;
    progress: number;
    opacity: number;
  }
) => {
  const safeLabel = label.trim() || 'PROGRESS';
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const fillColors = resolveSmoothTextProgressFillColors(colorPercent, visualTheme, dynamicFillColors);
  const shellStyle = resolveTextProgressShellStyle(generatedStyle, fillColors);
  const fontSize = Math.max(
    12,
    Math.round(
      resolveTextProgressFontSize(safeLabel, width, height, Math.max(18, height * 1.24, width, 28 * scale)) *
        shellStyle.fontScale
    )
  );
  const textCanvas = new OffscreenCanvas(Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height)));
  const textCtx = textCanvas.getContext('2d');
  if (!textCtx) return;

  textCtx.clearRect(0, 0, width, height);
  textCtx.textAlign = 'center';
  textCtx.textBaseline = 'alphabetic';
  textCtx.font = `${styleModules.text.titleCanvasWeight} ${fontSize}px ${styleModules.text.titleCanvasFamily}`;
  const metrics = textCtx.measureText(safeLabel);
  const textSpanWidth = Math.max(
    1,
    Math.min(width, Math.max(metrics.width, (metrics.actualBoundingBoxLeft || 0) + (metrics.actualBoundingBoxRight || 0)))
  );
  const fillX = Math.max(0, (width - textSpanWidth) / 2);
  const fillWidth = Math.max(0, Math.min(textSpanWidth, (textSpanWidth * clamp(fillPercent, 0, 100)) / 100));
  const fillRatio = textSpanWidth > 0 ? fillWidth / textSpanWidth : 0;
  const textProgressEffects = resolveTextProgressEffectFrame({
    style: generatedStyle,
    width,
    height,
    fillX,
    fillWidth,
    spanWidth: textSpanWidth,
    fillRatio,
    animationSeconds,
    fillColors
  });
  const textProgressBaseAccent = resolveTextProgressBaseAccent(generatedStyle, fillColors);
  textCtx.fillStyle = '#000000';
  textCtx.fillText(safeLabel, width / 2, height * 0.68);
  textCtx.globalCompositeOperation = 'source-in';
  const gradient = textCtx.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, fillColors.start);
  gradient.addColorStop(0.58, fillColors.middle);
  gradient.addColorStop(1, fillColors.end);
  textCtx.fillStyle = gradient;
  textCtx.fillRect(fillX, 0, fillWidth, height);
  drawTextProgressCanvasEffects(
    textCtx,
    textProgressEffects,
    fillX,
    fillWidth,
    height,
    textProgressBaseAccent
  );

  if (sweep?.active && sweep.opacity > 0) {
    const sweepWidth = Math.max(18, textSpanWidth * 0.18);
    const sweepCenterX = fillX + textSpanWidth * sweep.progress;
    const sweepX = sweepCenterX - sweepWidth / 2;
    const sweepGradient = textCtx.createLinearGradient(sweepX, 0, sweepX + sweepWidth, 0);
    sweepGradient.addColorStop(0, 'rgba(255,255,255,0)');
    sweepGradient.addColorStop(0.3, 'rgba(255,255,255,0.06)');
    sweepGradient.addColorStop(0.5, 'rgba(255,255,255,0.28)');
    sweepGradient.addColorStop(0.7, 'rgba(255,255,255,0.06)');
    sweepGradient.addColorStop(1, 'rgba(255,255,255,0)');
    textCtx.save();
    textCtx.globalAlpha = clamp(sweep.opacity, 0, 1);
    textCtx.fillStyle = sweepGradient;
    textCtx.fillRect(sweepX, 0, sweepWidth, height);
    textCtx.restore();
  }

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `${styleModules.text.titleCanvasWeight} ${fontSize}px ${styleModules.text.titleCanvasFamily}`;
  ctx.lineWidth = Math.max(2, Math.round(fontSize * 0.08 * shellStyle.strokeScale));
  ctx.strokeStyle = shellStyle.stroke;
  ctx.fillStyle = shellStyle.fill;
  ctx.strokeText(safeLabel, rect.x + width / 2, rect.y + height * 0.68);
  ctx.fillText(safeLabel, rect.x + width / 2, rect.y + height * 0.68);
  ctx.drawImage(textCanvas, rect.x, rect.y, width, height);
  ctx.restore();
};

const drawProgressSweepOverlay = (
  ctx: ProgressCanvasContext,
  rect: Rect,
  sweepProgress: number,
  sweepOpacity: number
) => {
  if (rect.width <= 0 || rect.height <= 0 || sweepOpacity <= 0) return;

  ctx.save();
  roundRectPath(ctx, rect);
  ctx.clip();
  ctx.globalAlpha = clamp(sweepOpacity, 0, 1);
  const sweepWidth = Math.max(18, rect.width * 0.18);
  const sweepCenterX = rect.x + rect.width * sweepProgress;
  const sweepX = sweepCenterX - sweepWidth / 2;
  const gradient = ctx.createLinearGradient(sweepX, 0, sweepX + sweepWidth, 0);
  gradient.addColorStop(0, 'rgba(255,255,255,0)');
  gradient.addColorStop(0.3, 'rgba(255,255,255,0.06)');
  gradient.addColorStop(0.5, 'rgba(255,255,255,0.28)');
  gradient.addColorStop(0.7, 'rgba(255,255,255,0.06)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(sweepX, rect.y, sweepWidth, rect.height);
  ctx.restore();
};

const drawProgressPulseOverlay = (
  ctx: ProgressCanvasContext,
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
  ctx: ProgressCanvasContext,
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

const resolveOverlayProgressWindow = (options: {
  timestamp: number;
  duration: number;
  target: OverlayWorkerOutputTarget;
}): OverlayProgressWindow | null => {
  const { timestamp, duration, target } = options;

  if (target.kind === 'linked_pairs') {
    const activeSegment =
      target.segments.find(
        (segment, index) =>
          timestamp >= segment.start &&
          (timestamp < segment.end || index === target.segments.length - 1)
      ) ?? null;
    if (!activeSegment) return null;
    const segmentIndex = target.segments.findIndex((segment) => segment.pair.id === activeSegment.pair.id);
    return {
      start: activeSegment.start,
      end: activeSegment.end,
      current: segmentIndex + 1,
      total: target.segments.length,
      themeIndex: segmentIndex
    };
  }

  if (target.photo) {
    const timeline = normalizeTimeline(target.photo.timeline);
    if (timestamp < timeline.start || timestamp > timeline.end) return null;
    return {
      start: timeline.start,
      end: timeline.end,
      current: 1,
      total: 1,
      themeIndex: target.outputIndex
    };
  }

  return {
    start: 0,
    end: duration,
    current: 1,
    total: 1,
    themeIndex: target.outputIndex
  };
};

const drawOverlayProgressBar = (options: {
  ctx: ProgressCanvasContext;
  frameWidth: number;
  frameHeight: number;
  timestamp: number;
  duration: number;
  settings: OverlayExportSettings;
  target: OverlayWorkerOutputTarget;
}) => {
  const { ctx, frameWidth, frameHeight, timestamp, duration, settings, target } = options;
  if (settings.showProgress === false) return;

  const progressWindow = resolveOverlayProgressWindow({ timestamp, duration, target });
  if (!progressWindow) return;

  const windowDuration = Math.max(0.5, progressWindow.end - progressWindow.start);
  const elapsed = clamp(timestamp - progressWindow.start, 0, windowDuration);
  const timeLeft = Math.max(0, windowDuration - elapsed);
  const countdownPercent = clamp((timeLeft / windowDuration) * 100, 0, 100);
  const packagePreset =
    VIDEO_PACKAGE_PRESETS[settings.videoPackagePreset] ?? VIDEO_PACKAGE_PRESETS.gameshow;
  const styleModules = resolveVideoStyleModules(settings, packagePreset);
  const effectiveVisualStyle = resolveVisualThemeStyle(settings.visualStyle, progressWindow.themeIndex);
  const visualTheme = settings.generatedProgressEnabled
    ? PROGRESS_BAR_THEMES[settings.generatedProgressStyle]
    : VISUAL_THEMES[effectiveVisualStyle];
  const generatedFillColors = settings.generatedProgressEnabled
    ? resolveProgressBarFillColors(settings.generatedProgressStyle, countdownPercent / 100)
    : null;
  const progressFillDefinition = settings.generatedProgressEnabled
    ? resolveProgressBarFillStyle(settings.generatedProgressStyle, countdownPercent / 100, visualTheme)
    : buildProgressFillDefinition(styleModules.progress, visualTheme);
  const motionState = resolveVideoProgressMotionState({
    mode: settings.progressMotion,
    phase: 'showing',
    phaseDuration: windowDuration,
    timeLeft
  });
  const scale = clamp(Math.min(frameWidth, frameHeight) / 1080, 0.55, 2);
  const baseWidth = Math.min(frameWidth * 0.72, 420 * scale);
  const isTextFill =
    settings.generatedProgressEnabled
      ? settings.generatedProgressRenderMode === 'text_fill'
      : styleModules.progress.variant === 'text_fill';
  const progressRect: Rect = isTextFill
    ? {
        x: (frameWidth - baseWidth) / 2,
        y: frameHeight - Math.max(64, 78 * scale),
        width: baseWidth,
        height: Math.max(34, 46 * scale)
      }
    : {
        x: (frameWidth - baseWidth) / 2,
        y: frameHeight - Math.max(42, 54 * scale),
        width: baseWidth,
        height: Math.max(18, 24 * scale),
        radius: settings.generatedProgressEnabled
          ? Math.max(10, Math.round(Math.max(18, 24 * scale) / 2))
          : radiusTokenToPx(styleModules.progress.radiusToken, Math.max(18, 24 * scale), scale)
      };
  const templateValues = {
    current: progressWindow.current,
    next: Math.min(progressWindow.total, progressWindow.current + 1),
    total: progressWindow.total,
    puzzleCount: progressWindow.total,
    remaining: Math.max(0, progressWindow.total - progressWindow.current),
    preset: ''
  };
  const progressLabel = applyTextTransform(
    fillTemplate(settings.textTemplates.progressLabel || settings.textTemplates.playTitle || 'Progress', templateValues),
    styleModules.text.titleTransform
  );

  if (isTextFill) {
    drawTextProgressLabel(
      ctx,
      progressRect,
      progressLabel,
      clamp(motionState.fillPercent, 0, 100),
      countdownPercent,
      styleModules,
      visualTheme,
      scale,
      settings.generatedProgressEnabled ? settings.generatedProgressStyle : null,
      elapsed,
      generatedFillColors,
      {
        active: motionState.sweepActive,
        progress: motionState.sweepProgress,
        opacity: motionState.sweepOpacity
      }
    );
    return;
  }

  drawRoundedRect(ctx, progressRect, {
    fill: visualTheme.progressTrackBg,
    stroke: visualTheme.progressTrackBorder,
    lineWidth: settings.generatedProgressEnabled
      ? Math.max(2, Math.round(progressRect.height * 0.08))
      : Math.max(1.5, Math.round(2 * scale * styleModules.progress.borderWidthScale))
  });
  const progressFillRect: Rect = {
    x: progressRect.x,
    y: progressRect.y,
    width: (progressRect.width * clamp(motionState.fillPercent, 0, 100)) / 100,
    height: progressRect.height,
    radius: progressRect.radius
  };
  if (progressFillRect.width <= 0) return;

  roundRectPath(ctx, progressFillRect);
  ctx.fillStyle = resolveProgressFill(ctx, progressFillRect, progressFillDefinition, visualTheme.timerDot);
  ctx.fill();

  if (motionState.sweepActive) {
    drawProgressSweepOverlay(ctx, progressFillRect, motionState.sweepProgress, motionState.sweepOpacity);
  }
  drawProgressPulseOverlay(ctx, progressFillRect, motionState.pulseOverlayOpacity);
  drawProgressPulseGlow(
    ctx,
    progressFillRect,
    motionState.pulseGlowOpacity,
    hexToRgba(visualTheme.timerDot, 0.16 + motionState.pulseGlowOpacity * 0.38),
    Math.max(6, Math.round(10 * scale)),
    Math.max(1, Math.round(1.5 * scale))
  );

  const glowColor = settings.generatedProgressEnabled
    ? visualTheme.progressFillGlow
    : styleModules.progress.variant === 'glow'
      ? visualTheme.progressFillGlow ?? visualTheme.timerDot
      : null;
  if (!glowColor) return;

  ctx.save();
  roundRectPath(ctx, progressFillRect);
  ctx.shadowColor = glowColor;
  ctx.shadowBlur = Math.max(6, Math.round(10 * scale));
  ctx.strokeStyle = hexToRgba(visualTheme.timerDot, 0.85);
  ctx.lineWidth = Math.max(1, Math.round(1.5 * scale));
  ctx.stroke();
  ctx.restore();
};

const createOutputAudioSample = (
  sample: AudioSample,
  timestamp: number,
  volume: number,
  maxDuration: number
): AudioSample | null => {
  if (maxDuration <= 0) return null;

  const maxFrames = Math.max(1, Math.floor(maxDuration * sample.sampleRate));
  if (maxFrames <= 0) return null;

  const frameCount = Math.min(sample.numberOfFrames, maxFrames);
  if (frameCount <= 0) return null;

  if (Math.abs(volume - 1) < 0.0001 && frameCount === sample.numberOfFrames) {
    const cloned = sample.clone();
    cloned.setTimestamp(timestamp);
    return cloned;
  }

  const data = new Float32Array(frameCount * sample.numberOfChannels);
  sample.copyTo(data, {
    planeIndex: 0,
    format: 'f32',
    frameCount
  });

  if (Math.abs(volume - 1) >= 0.0001) {
    for (let index = 0; index < data.length; index += 1) {
      data[index] *= volume;
    }
  }

  return new AudioSample({
    data,
    format: 'f32',
    numberOfChannels: sample.numberOfChannels,
    sampleRate: sample.sampleRate,
    timestamp
  });
};

const createAudioPump = async (options: {
  output: Output;
  file: File;
  codec: 'aac' | 'opus';
  outputDuration: number;
  start: number;
  trimStart: number;
  volume: number;
  loop: boolean;
}) => {
  const { output, file, codec, outputDuration, start, trimStart, volume, loop } = options;
  if (start >= outputDuration) return null;

  const input = new Input({
    source: new BlobSource(file),
    formats: ALL_FORMATS
  });
  const track = await input.getPrimaryAudioTrack();
  if (!track) {
    input.dispose();
    return null;
  }

  const source = new AudioSampleSource({
    codec,
    bitrate: AUDIO_BITRATE
  });
  output.addAudioTrack(source);

  const safeTrimStart = Math.max(0, trimStart);
  const sourceDuration = await track.computeDuration().catch(() => 0);
  const availableDuration = sourceDuration > safeTrimStart ? sourceDuration - safeTrimStart : 0;
  const shouldLoop = loop && availableDuration > 0.001;

  return async () => {
    try {
      let iteration = 0;
      let timelineOffset = start;

      while (timelineOffset < outputDuration) {
        throwIfCanceled();

        if (iteration > 0 && !shouldLoop) break;

        const sink = new AudioSampleSink(track);
        let sawSample = false;

        for await (const sample of sink.samples(safeTrimStart, Infinity)) {
          throwIfCanceled();
          sawSample = true;

          const sampleTimestamp = timelineOffset + Math.max(0, sample.timestamp - safeTrimStart);
          const remainingDuration = outputDuration - sampleTimestamp;
          const outputSample = createOutputAudioSample(sample, sampleTimestamp, volume, remainingDuration);
          sample.close();

          if (!outputSample) {
            if (remainingDuration <= 0) break;
            continue;
          }

          const outputSampleDuration = outputSample.duration;
          await source.add(outputSample);
          outputSample.close();

          if (remainingDuration <= outputSampleDuration) break;
        }

        if (!sawSample) break;
        if (!shouldLoop) break;

        timelineOffset += availableDuration;
        iteration += 1;
      }
    } finally {
      source.close();
      input.dispose();
    }
  };
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
    const bitmap = await decodeRuntimeImageBitmapFromBlob(clip.file);
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
  puzzleBitmap: await decodeRuntimeImageBitmapFromBlob(pair.puzzleFile),
  diffBitmap: await decodeRuntimeImageBitmapFromBlob(pair.diffFile)
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
  soundtrack?: WorkerSoundtrackInput;
  settings: OverlayExportSettings;
  target: Extract<OverlayWorkerOutputTarget, { kind: 'standard' }>;
  onProgress: (progress: number, status: string) => void;
}): Promise<ExportResult> => {
  const { base, outputLabel, overlayResources, soundtrack, settings, target, onProgress } = options;
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
  const requestedBitrate = Math.max(500_000, Math.round(settings.exportBitrateMbps * 1_000_000));

  const encodingPlan = await resolveVideoEncodingPlan({
    exportCodec: settings.exportCodec,
    width: outputWidth,
    height: outputHeight,
    bitrate: requestedBitrate
  });
  if (!encodingPlan) {
    throw new Error(
      `Cannot encode ${settings.exportCodec.toUpperCase()} at ${outputWidth}x${outputHeight} with current browser support.`
    );
  }

  throwIfCanceled();

  const baseVideoResource = await prepareBaseVideoResource(base.videoFile);
  const duration = Math.max(0.5, base.durationSeconds);
  const bufferTarget = new BufferTarget();
  const output = new Output({
    format: codecConfig.outputFormat,
    target: bufferTarget
  });
  const canvas = new OffscreenCanvas(outputWidth, outputHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to initialize video export canvas context.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const scratchCanvas = new OffscreenCanvas(2, 2);
  const scratchCtx = scratchCanvas.getContext('2d');
  if (!scratchCtx) {
    throw new Error('Failed to initialize scratch canvas context.');
  }
  scratchCtx.imageSmoothingEnabled = true;
  scratchCtx.imageSmoothingQuality = 'high';

  const videoSource = new CanvasSource(canvas, {
    codec: encodingPlan.codec,
    bitrate: encodingPlan.bitrate,
    bitrateMode: encodingPlan.bitrateMode,
    latencyMode: encodingPlan.latencyMode,
    contentHint: encodingPlan.contentHint,
    alpha: encodingPlan.alpha,
    ...(encodingPlan.fullCodecString ? { fullCodecString: encodingPlan.fullCodecString } : {}),
    ...(encodingPlan.hardwareAcceleration
      ? { hardwareAcceleration: encodingPlan.hardwareAcceleration }
      : {})
  });
  output.addVideoTrack(videoSource, { frameRate: FPS });
  const audioPump = await createAudioPump({
    output,
    file: soundtrack?.file ?? base.videoFile,
    codec: codecConfig.audioCodec,
    outputDuration: duration,
    start: soundtrack?.start ?? 0,
    trimStart: soundtrack?.trimStart ?? 0,
    volume: soundtrack?.volume ?? 1,
    loop: soundtrack?.loop ?? false
  });

  await output.start();

  const totalFrames = Math.max(1, Math.ceil(duration * FPS));
  const progressStep = Math.max(1, Math.floor(totalFrames / 120));
  const audioPromise = audioPump ? audioPump() : Promise.resolve();

  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
    throwIfCanceled();
    const timestamp = frameIndex / FPS;
    ctx.clearRect(0, 0, outputWidth, outputHeight);
    await drawBaseFrame({
      ctx,
      base,
      basePhotoBitmap: null,
      baseVideoResource,
      timestamp,
      outputWidth,
      outputHeight
    });
    await renderOverlayResources(ctx, overlayResources, timestamp, outputWidth, outputHeight, scratchCanvas, scratchCtx);
    drawOverlayProgressBar({
      ctx,
      frameWidth: outputWidth,
      frameHeight: outputHeight,
      timestamp,
      duration,
      settings,
      target
    });
    await videoSource.add(timestamp, 1 / FPS);

    if (frameIndex % progressStep === 0 || frameIndex === totalFrames - 1) {
      const localProgress = (frameIndex + 1) / totalFrames;
      onProgress(clamp(localProgress, 0, 0.995), `Rendering ${outputLabel} frame ${frameIndex + 1}/${totalFrames}`);
    }
  }

  await audioPromise;
  await output.finalize();
  throwIfCanceled();

  const buffer = bufferTarget.buffer;
  if (!buffer) {
    throw new Error(`Failed to build output for ${outputLabel}.`);
  }

  activeConversion = null;

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
  loopVideo?: boolean;
}) => {
  const { ctx, base, basePhotoBitmap, baseVideoResource, timestamp, outputWidth, outputHeight, loopVideo = false } = options;

  if (base.mode === 'video' && baseVideoResource) {
    const safeDuration = baseVideoResource.duration > 0.01 ? baseVideoResource.duration : Math.max(0.5, base.durationSeconds);
    const sampleTimestamp =
      loopVideo && safeDuration > 0.01
        ? timestamp % safeDuration
        : Math.min(timestamp, Math.max(0, safeDuration - 1 / FPS));
    const wrapped = await baseVideoResource.sink.getCanvas(sampleTimestamp);
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
  soundtrack?: WorkerSoundtrackInput;
  settings: OverlayExportSettings;
  outputLabel: string;
  target: Extract<OverlayWorkerOutputTarget, { kind: 'standard' }>;
  onProgress: (progress: number, status: string) => void;
}): Promise<ExportResult> => {
  const { base, basePhotoBitmap, photo, overlayResources, soundtrack, settings, outputLabel, target, onProgress } = options;
  const codecConfig = FORMAT_BY_CODEC[settings.exportCodec];

  const maxTimelineEnd = overlayResources.reduce((acc, resource) => {
    const timeline = normalizeTimeline(resource.clip.timeline);
    return Math.max(acc, timeline.end);
  }, 0);
  const duration = Math.max(0.5, base.durationSeconds, maxTimelineEnd);

  const aspectRatio = clamp(base.aspectRatio, 0.3, 4);
  const { width: outputWidth, height: outputHeight } = computeOutputSizeFromAspect(aspectRatio, settings.exportResolution);
  const requestedBitrate = Math.max(500_000, Math.round(settings.exportBitrateMbps * 1_000_000));
  const totalFrames = Math.max(1, Math.ceil(duration * FPS));

  const encodingPlan = await resolveVideoEncodingPlan({
    exportCodec: settings.exportCodec,
    width: outputWidth,
    height: outputHeight,
    bitrate: requestedBitrate
  });
  if (!encodingPlan) {
    throw new Error(
      `Cannot encode ${settings.exportCodec.toUpperCase()} at ${outputWidth}x${outputHeight} with current browser support.`
    );
  }

  throwIfCanceled();

  const bufferTarget = new BufferTarget();
  const output = new Output({
    format: codecConfig.outputFormat,
    target: bufferTarget
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
    codec: encodingPlan.codec,
    bitrate: encodingPlan.bitrate,
    bitrateMode: encodingPlan.bitrateMode,
    latencyMode: encodingPlan.latencyMode,
    contentHint: encodingPlan.contentHint,
    alpha: encodingPlan.alpha,
    ...(encodingPlan.fullCodecString ? { fullCodecString: encodingPlan.fullCodecString } : {}),
    ...(encodingPlan.hardwareAcceleration
      ? { hardwareAcceleration: encodingPlan.hardwareAcceleration }
      : {})
  });
  output.addVideoTrack(videoSource, { frameRate: FPS });
  const audioPump =
    soundtrack
      ? await createAudioPump({
          output,
          file: soundtrack.file,
          codec: codecConfig.audioCodec,
          outputDuration: duration,
          start: soundtrack.start,
          trimStart: soundtrack.trimStart,
          volume: soundtrack.volume,
          loop: soundtrack.loop
        })
      : null;

  await output.start();
  throwIfCanceled();
  const audioPromise = audioPump ? audioPump() : Promise.resolve();

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
    drawOverlayProgressBar({
      ctx,
      frameWidth: outputWidth,
      frameHeight: outputHeight,
      timestamp,
      duration,
      settings,
      target
    });
    await videoSource.add(timestamp, 1 / FPS);

    if (frameIndex % progressStep === 0 || frameIndex === totalFrames - 1) {
      const localProgress = (frameIndex + 1) / totalFrames;
      onProgress(
        clamp(localProgress, 0, 0.995),
        `Rendering ${outputLabel} frame ${frameIndex + 1}/${totalFrames}`
      );
    }
  }

  await audioPromise;
  await output.finalize();
  throwIfCanceled();

  const buffer = bufferTarget.buffer;
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
  soundtrack?: WorkerSoundtrackInput;
  settings: OverlayExportSettings;
  linkedPairLayout: WorkerLinkedPairLayout;
  linkedPairStyle: WorkerLinkedPairStyle;
  outputLabel: string;
  target: Extract<OverlayWorkerOutputTarget, { kind: 'linked_pairs' }>;
  onProgress: (progress: number, status: string) => void;
}): Promise<ExportResult> => {
  const {
    base,
    basePhotoBitmap,
    baseVideoResource,
    segments,
    overlayResources,
    soundtrack,
    settings,
    linkedPairLayout,
    linkedPairStyle,
    outputLabel,
    target,
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
  const requestedBitrate = Math.max(500_000, Math.round(settings.exportBitrateMbps * 1_000_000));
  const totalFrames = Math.max(1, Math.ceil(duration * FPS));

  const encodingPlan = await resolveVideoEncodingPlan({
    exportCodec: settings.exportCodec,
    width: outputWidth,
    height: outputHeight,
    bitrate: requestedBitrate
  });
  if (!encodingPlan) {
    throw new Error(
      `Cannot encode ${settings.exportCodec.toUpperCase()} at ${outputWidth}x${outputHeight} with current browser support.`
    );
  }

  throwIfCanceled();

  const bufferTarget = new BufferTarget();
  const output = new Output({
    format: codecConfig.outputFormat,
    target: bufferTarget
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
    codec: encodingPlan.codec,
    bitrate: encodingPlan.bitrate,
    bitrateMode: encodingPlan.bitrateMode,
    latencyMode: encodingPlan.latencyMode,
    contentHint: encodingPlan.contentHint,
    alpha: encodingPlan.alpha,
    ...(encodingPlan.fullCodecString ? { fullCodecString: encodingPlan.fullCodecString } : {}),
    ...(encodingPlan.hardwareAcceleration
      ? { hardwareAcceleration: encodingPlan.hardwareAcceleration }
      : {})
  });
  output.addVideoTrack(videoSource, { frameRate: FPS });
  const audioPump =
    soundtrack
      ? await createAudioPump({
          output,
          file: soundtrack.file,
          codec: codecConfig.audioCodec,
          outputDuration: duration,
          start: soundtrack.start,
          trimStart: soundtrack.trimStart,
          volume: soundtrack.volume,
          loop: soundtrack.loop
        })
      : base.mode === 'video' && base.videoFile
        ? await createAudioPump({
            output,
            file: base.videoFile,
            codec: codecConfig.audioCodec,
            outputDuration: duration,
            start: 0,
            trimStart: 0,
            volume: 1,
            loop: true
          })
        : null;

  await output.start();
  throwIfCanceled();
  const audioPromise = audioPump ? audioPump() : Promise.resolve();

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
      outputHeight,
      loopVideo: base.mode === 'video'
    });

    const activeSegment = segments.find((segment) => timestamp >= segment.start && timestamp <= segment.end);
    if (activeSegment) {
      drawLinkedPairOnFrame(ctx, activeSegment.pair, linkedPairLayout, linkedPairStyle, outputWidth, outputHeight);
    }

    await renderOverlayResources(ctx, overlayResources, timestamp, outputWidth, outputHeight, scratchCanvas, scratchCtx);
    drawOverlayProgressBar({
      ctx,
      frameWidth: outputWidth,
      frameHeight: outputHeight,
      timestamp,
      duration,
      settings,
      target
    });
    await videoSource.add(timestamp, 1 / FPS);

    if (frameIndex % progressStep === 0 || frameIndex === totalFrames - 1) {
      const localProgress = (frameIndex + 1) / totalFrames;
      onProgress(
        clamp(localProgress, 0, 0.995),
        `Rendering ${outputLabel} frame ${frameIndex + 1}/${totalFrames}`
      );
    }
  }

  await audioPromise;
  await output.finalize();
  throwIfCanceled();

  const buffer = bufferTarget.buffer;
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
  soundtrack: WorkerSoundtrackInput | undefined,
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
      basePhotoBitmap = await decodeRuntimeImageBitmapFromBlob(base.photoFile);
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
      soundtrack,
      settings,
      linkedPairLayout: target.linkedPairLayout ?? { x: 0.14, y: 0.18, size: 0.34, gap: 0.04 },
      linkedPairStyle: normalizeLinkedPairStyle(target.linkedPairStyle),
      outputLabel: target.outputLabel,
      target,
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
  soundtrack: WorkerSoundtrackInput | undefined,
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
      basePhotoBitmap = await decodeRuntimeImageBitmapFromBlob(base.photoFile);
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
            soundtrack,
            settings,
            target,
            onProgress: (progress, status) => {
              postToMain({ type: 'progress', progress, status });
            }
          })
        : await exportWithStaticBase({
            base,
            basePhotoBitmap,
            photo: target.photo as WorkerBatchPhoto,
            overlayResources: clipResources,
            soundtrack,
            settings,
            outputLabel: target.outputLabel,
            target,
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
  soundtrack: WorkerSoundtrackInput | undefined,
  settings: OverlayExportSettings,
  target: OverlayWorkerOutputTarget
) => {
  postToMain({
    type: 'progress',
    progress: 0,
    status: `Preparing ${target.outputLabel}...`
  });

  if (target.kind === 'linked_pairs') {
    return await exportLinkedPairOutput(base, overlays, soundtrack, settings, target);
  }

  return await exportStandardOutput(base, overlays, soundtrack, settings, target);
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

  const { base, overlays, soundtrack, settings, target, workerSessionId } = message.payload;
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

    const result = await exportOverlayOutput(base, overlays, soundtrack, settings, target);

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
