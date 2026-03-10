import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  WebMOutputFormat,
  canEncodeVideo
} from 'mediabunny';
import { Puzzle, Region, VideoSettings } from '../types';
import { VISUAL_THEMES, resolveVisualThemeStyle } from '../constants/videoThemes';
import { BASE_STAGE_SIZE, CLASSIC_HUD_SPEC, TRANSITION_TUNING } from '../constants/videoLayoutSpec';
import { type HudAnchorSpec } from '../constants/videoHudLayoutSpec';
import { resolveVideoLayoutSettings } from '../constants/videoLayoutCustom';
import { VIDEO_PACKAGE_PRESETS, resolvePackageImageArrangement } from '../constants/videoPackages';
import { applyLogoChromaKey, clampLogoZoom } from '../utils/logoProcessing';

type FramePhase = 'intro' | 'showing' | 'revealing' | 'transitioning' | 'outro';
type SceneCardKind = 'intro' | 'transition' | 'outro';

interface TimelineSegment {
  puzzleIndex: number;
  phase: FramePhase;
  start: number;
  duration: number;
  end: number;
}

interface RenderScene {
  segment: TimelineSegment;
  phaseElapsed: number;
  timeLeft: number;
  progressPercent: number;
  countdownPercent: number;
  revealedRegionCount: number;
  blinkOverlayActive: boolean;
  blinkOverlayVisible: boolean;
  title: string;
  subtitle: string;
  cardEyebrow: string;
}

interface ExportVideoOptions {
  puzzles: Puzzle[];
  settings: VideoSettings;
  streamOutput?: boolean;
  onProgress?: (progress: number, status?: string) => void;
}

interface PreviewFrameOptions {
  puzzles: Puzzle[];
  settings: VideoSettings;
  timestamp: number;
}

interface WorkerStartMessage {
  type: 'start';
  payload: {
    puzzles: Puzzle[];
    settings: VideoSettings;
    streamOutput?: boolean;
  };
}

interface WorkerPreviewFrameMessage {
  type: 'preview-frame';
  payload: {
    puzzles: Puzzle[];
    settings: VideoSettings;
    timestamp: number;
  };
}

interface WorkerCancelMessage {
  type: 'cancel';
}

type WorkerMessage = WorkerStartMessage | WorkerPreviewFrameMessage | WorkerCancelMessage;

type WorkerResponse =
  | { type: 'progress'; progress: number; status?: string }
  | { type: 'stream-chunk'; position: number; data: ArrayBuffer }
  | { type: 'stream-done'; mimeType: string; fileName: string }
  | { type: 'preview-frame-done'; buffer: ArrayBuffer; mimeType: string }
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

interface MarkerBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LoadedPuzzleImages {
  original: ImageBitmap;
  modified: ImageBitmap;
}

let isCanceled = false;

const FPS = 30;

const RESOLUTION_HEIGHT: Record<VideoSettings['exportResolution'], number> = {
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
const formatCountdownSeconds = (seconds: number) =>
  `${Math.max(0, Math.ceil(seconds - 0.001))}s`;
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
  ctx: CanvasRenderingContext2D,
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
    ctx.lineWidth = options.lineWidth ?? 1;
    ctx.strokeStyle = options.stroke;
    ctx.stroke();
  }
};

const resolveAnchoredRect = (
  anchor: HudAnchorSpec,
  width: number,
  height: number,
  container: Rect,
  scale: number
): Rect => {
  const left = anchor.left === undefined ? undefined : anchor.left * scale;
  const right = anchor.right === undefined ? undefined : anchor.right * scale;
  const top = anchor.top === undefined ? undefined : anchor.top * scale;
  const bottom = anchor.bottom === undefined ? undefined : anchor.bottom * scale;

  let x = container.x;
  if (anchor.centerX) {
    x = container.x + (container.width - width) / 2;
  } else if (left !== undefined) {
    x = container.x + left;
  } else if (right !== undefined) {
    x = container.x + container.width - right - width;
  }

  let y = container.y;
  if (anchor.centerY) {
    y = container.y + (container.height - height) / 2;
  } else if (top !== undefined) {
    y = container.y + top;
  } else if (bottom !== undefined) {
    y = container.y + container.height - bottom - height;
  }

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height)
  };
};

const throwIfCanceled = () => {
  if (isCanceled) {
    throw new Error('__EXPORT_CANCELED__');
  }
};

const loadImage = async (src: string): Promise<ImageBitmap> => {
  const response = await fetch(src);
  if (!response.ok) {
    throw new Error('Failed to fetch puzzle image for export.');
  }
  const blob = await response.blob();
  throwIfCanceled();
  return await createImageBitmap(blob);
};

const getExportDimensions = (
  aspectRatio: VideoSettings['aspectRatio'],
  resolution: VideoSettings['exportResolution']
) => {
  const baseHeight = RESOLUTION_HEIGHT[resolution];
  const baseStage = BASE_STAGE_SIZE[aspectRatio];
  if (baseStage.width >= baseStage.height) {
    return {
      width: even((baseHeight * baseStage.width) / baseStage.height),
      height: even(baseHeight)
    };
  }
  return {
    width: even(baseHeight),
    height: even((baseHeight * baseStage.height) / baseStage.width)
  };
};

const computeCoverFrame = (viewport: Rect, image: ImageBitmap): Rect => {
  const imageWidth = image.width;
  const imageHeight = image.height;

  if (imageWidth <= 0 || imageHeight <= 0) {
    return { ...viewport };
  }

  const scale = Math.max(viewport.width / imageWidth, viewport.height / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;

  return {
    x: viewport.x + (viewport.width - width) / 2,
    y: viewport.y + (viewport.height - height) / 2,
    width,
    height
  };
};

const drawImageCover = (ctx: CanvasRenderingContext2D, image: ImageBitmap, panel: Rect) => {
  const coverFrame = computeCoverFrame(panel, image);
  ctx.save();
  roundRectPath(ctx, panel);
  ctx.clip();
  ctx.drawImage(image, coverFrame.x, coverFrame.y, coverFrame.width, coverFrame.height);
  ctx.restore();
  return coverFrame;
};

const computeContainFrame = (viewport: Rect, image: ImageBitmap): Rect => {
  const imageWidth = image.width;
  const imageHeight = image.height;

  if (imageWidth <= 0 || imageHeight <= 0) {
    return { ...viewport };
  }

  const scale = Math.min(viewport.width / imageWidth, viewport.height / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;

  return {
    x: viewport.x + (viewport.width - width) / 2,
    y: viewport.y + (viewport.height - height) / 2,
    width,
    height
  };
};

const drawImageContain = (
  ctx: CanvasRenderingContext2D,
  image: ImageBitmap,
  panel: Rect,
  zoom = 1
) => {
  const containFrame = computeContainFrame(panel, image);
  const safeZoom = clampLogoZoom(zoom);
  const zoomedWidth = containFrame.width * safeZoom;
  const zoomedHeight = containFrame.height * safeZoom;
  const zoomedFrame = {
    x: containFrame.x - (zoomedWidth - containFrame.width) / 2,
    y: containFrame.y - (zoomedHeight - containFrame.height) / 2,
    width: zoomedWidth,
    height: zoomedHeight
  };
  ctx.drawImage(image, zoomedFrame.x, zoomedFrame.y, zoomedFrame.width, zoomedFrame.height);
  return zoomedFrame;
};

const processLogoBitmap = async (
  logo: ImageBitmap,
  settings: Pick<
    VideoSettings,
    'logoChromaKeyEnabled' | 'logoChromaKeyColor' | 'logoChromaKeyTolerance'
  >
) => {
  if (!settings.logoChromaKeyEnabled || logo.width <= 0 || logo.height <= 0) {
    return logo;
  }

  const canvas = new OffscreenCanvas(logo.width, logo.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return logo;
  }

  ctx.drawImage(logo, 0, 0, logo.width, logo.height);
  const imageData = ctx.getImageData(0, 0, logo.width, logo.height);
  applyLogoChromaKey(imageData, {
    enabled: settings.logoChromaKeyEnabled,
    color: settings.logoChromaKeyColor,
    tolerance: settings.logoChromaKeyTolerance
  });
  ctx.clearRect(0, 0, logo.width, logo.height);
  ctx.putImageData(imageData, 0, 0);
  return await createImageBitmap(canvas);
};

const normalizeRegion = (region: Region, image: ImageBitmap) => {
  const imageWidth = image.width || 1;
  const imageHeight = image.height || 1;
  const ratioBased = region.x <= 1 && region.y <= 1 && region.width <= 1 && region.height <= 1;
  if (ratioBased) return region;

  return {
    ...region,
    x: region.x / imageWidth,
    y: region.y / imageHeight,
    width: region.width / imageWidth,
    height: region.height / imageHeight
  };
};

const getMarkerBounds = (
  region: Region,
  frame: Rect,
  image: ImageBitmap,
  settings: VideoSettings,
  revealVariant: VideoSettings['revealVariant']
): MarkerBounds => {
  const normalized = normalizeRegion(region, image);

  const clampedX = clamp(normalized.x, 0, 1);
  const clampedY = clamp(normalized.y, 0, 1);
  const clampedWidth = clamp(normalized.width, 0, 1 - clampedX);
  const clampedHeight = clamp(normalized.height, 0, 1 - clampedY);
  const centerX = clampedX + clampedWidth / 2;
  const centerY = clampedY + clampedHeight / 2;

  const isCircleReveal = settings.revealStyle === 'circle';
  const minMarkerPx = isCircleReveal ? 42 : 36;
  const minWidthNormalized = frame.width > 0 ? minMarkerPx / frame.width : 0.05;
  const minHeightNormalized = frame.height > 0 ? minMarkerPx / frame.height : 0.05;
  const regionPixelMax = Math.max(clampedWidth * frame.width, clampedHeight * frame.height);
  const tinyObjectCutoffPx = 48;
  const largeObjectCutoffPx = 180;
  const smallObjectFactor = isCircleReveal ? 2.2 : 1.95;
  const largeObjectFactor = isCircleReveal ? 1.2 : 1.15;
  const scaleBlend =
    regionPixelMax <= tinyObjectCutoffPx
      ? 0
      : regionPixelMax >= largeObjectCutoffPx
      ? 1
      : (regionPixelMax - tinyObjectCutoffPx) / (largeObjectCutoffPx - tinyObjectCutoffPx);
  const expansionFactor = smallObjectFactor + (largeObjectFactor - smallObjectFactor) * scaleBlend;
  const expandedWidth = clamp(Math.max(clampedWidth * expansionFactor, minWidthNormalized), 0, 1);
  const expandedHeight = clamp(Math.max(clampedHeight * expansionFactor, minHeightNormalized), 0, 1);
  const circleSize = clamp(Math.max(expandedWidth, expandedHeight), 0, 1);
  const rawCircleLeft = centerX - circleSize / 2;
  const rawCircleTop = centerY - circleSize / 2;
  const circleLeft = clamp(rawCircleLeft, 0, 1 - circleSize);
  const circleTop = clamp(rawCircleTop, 0, 1 - circleSize);
  const boxLeft = clamp(centerX - expandedWidth / 2, 0, 1 - expandedWidth);
  const boxTop = clamp(centerY - expandedHeight / 2, 0, 1 - expandedHeight);

  const isEllipseVariant =
    settings.revealStyle === 'circle' &&
    (revealVariant === 'circle_ellipse' || revealVariant === 'circle_ellipse_dotted');

  const useSquareCircleFrame = settings.revealStyle === 'circle' && !isEllipseVariant;
  const markerX = useSquareCircleFrame ? circleLeft : boxLeft;
  const markerY = useSquareCircleFrame ? circleTop : boxTop;
  const markerW = useSquareCircleFrame ? circleSize : expandedWidth;
  const markerH = useSquareCircleFrame ? circleSize : expandedHeight;

  return {
    x: frame.x + markerX * frame.width,
    y: frame.y + markerY * frame.height,
    width: markerW * frame.width,
    height: markerH * frame.height
  };
};

const resolveSceneText = (
  segment: TimelineSegment,
  puzzles: Puzzle[],
  settings: VideoSettings
) => {
  const currentPuzzleNumber = segment.puzzleIndex + 1;
  const nextPuzzleNumber = Math.min(puzzles.length, segment.puzzleIndex + 2);
  const templateValues = {
    current: currentPuzzleNumber,
    next: nextPuzzleNumber,
    total: puzzles.length,
    puzzleCount: puzzles.length,
    remaining: Math.max(0, puzzles.length - currentPuzzleNumber),
    preset: ''
  };
  const introEyebrow = fillTemplate(settings.textTemplates.introEyebrow, templateValues);
  const introTitle = fillTemplate(settings.textTemplates.introTitle, templateValues);
  const introSubtitle = fillTemplate(settings.textTemplates.introSubtitle, templateValues);
  const playModeTitle = fillTemplate(settings.textTemplates.playTitle, templateValues);
  const playModeSubtitle = fillTemplate(settings.textTemplates.playSubtitle, templateValues);
  const revealModeTitle = fillTemplate(settings.textTemplates.revealTitle, templateValues);
  const transitionEyebrow = fillTemplate(settings.textTemplates.transitionEyebrow, templateValues);
  const transitionTitle = fillTemplate(settings.textTemplates.transitionTitle, templateValues);
  const transitionSubtitle = fillTemplate(settings.textTemplates.transitionSubtitle, templateValues);
  const completionEyebrow = fillTemplate(settings.textTemplates.completionEyebrow, templateValues);
  const completionTitle = fillTemplate(settings.textTemplates.completionTitle, templateValues);
  const completionSubtitle = fillTemplate(settings.textTemplates.completionSubtitle, templateValues);

  return {
    title:
      segment.phase === 'intro'
        ? introTitle
        : segment.phase === 'revealing'
        ? revealModeTitle
        : segment.phase === 'transitioning'
        ? transitionTitle
        : segment.phase === 'outro'
        ? completionTitle
        : playModeTitle,
    subtitle:
      segment.phase === 'intro'
        ? introSubtitle
        : segment.phase === 'transitioning'
        ? transitionSubtitle
        : segment.phase === 'outro'
        ? completionSubtitle
        : playModeSubtitle,
    cardEyebrow:
      segment.phase === 'intro'
        ? introEyebrow
        : segment.phase === 'transitioning'
        ? transitionEyebrow
        : segment.phase === 'outro'
        ? completionEyebrow
        : ''
  };
};

const buildTimeline = (puzzles: Puzzle[], settings: VideoSettings): TimelineSegment[] => {
  const showDuration = Math.max(0.1, settings.showDuration);
  const revealDuration = Math.max(0.5, settings.revealDuration);
  const transitionDuration = Math.max(0, settings.transitionDuration);
  const introDuration = settings.sceneSettings.introEnabled
    ? Math.max(0, settings.sceneSettings.introDuration)
    : 0;
  const outroDuration = settings.sceneSettings.outroEnabled
    ? Math.max(0, settings.sceneSettings.outroDuration)
    : 0;

  let cursor = 0;
  const timeline: TimelineSegment[] = [];

  if (introDuration > 0) {
    timeline.push({
      puzzleIndex: 0,
      phase: 'intro',
      start: cursor,
      duration: introDuration,
      end: cursor + introDuration
    });
    cursor += introDuration;
  }

  puzzles.forEach((_, puzzleIndex) => {
    timeline.push({
      puzzleIndex,
      phase: 'showing',
      start: cursor,
      duration: showDuration,
      end: cursor + showDuration
    });
    cursor += showDuration;

    timeline.push({
      puzzleIndex,
      phase: 'revealing',
      start: cursor,
      duration: revealDuration,
      end: cursor + revealDuration
    });
    cursor += revealDuration;

    if (puzzleIndex < puzzles.length - 1 && transitionDuration > 0) {
      timeline.push({
        puzzleIndex,
        phase: 'transitioning',
        start: cursor,
        duration: transitionDuration,
        end: cursor + transitionDuration
      });
      cursor += transitionDuration;
    }
  });

  if (outroDuration > 0) {
    timeline.push({
      puzzleIndex: Math.max(0, puzzles.length - 1),
      phase: 'outro',
      start: cursor,
      duration: outroDuration,
      end: cursor + outroDuration
    });
    cursor += outroDuration;
  }

  return timeline;
};

const getSceneAtTime = (
  timestamp: number,
  timeline: TimelineSegment[],
  puzzles: Puzzle[],
  settings: VideoSettings
): RenderScene => {
  const segment =
    timeline.find((currentSegment) => timestamp >= currentSegment.start && timestamp < currentSegment.end) ??
    timeline[timeline.length - 1];
  const puzzle = puzzles[segment.puzzleIndex];
  const phaseElapsed = clamp(timestamp - segment.start, 0, segment.duration);
  const timeLeft = Math.max(0, segment.duration - phaseElapsed);
  const progressPercent = segment.duration > 0 ? (phaseElapsed / segment.duration) * 100 : 100;
  const countdownPercent = segment.duration > 0 ? (timeLeft / Math.max(0.1, segment.duration)) * 100 : 0;
  const sceneText = resolveSceneText(segment, puzzles, settings);

  let revealedRegionCount = 0;
  let blinkOverlayActive = false;
  let blinkOverlayVisible = false;

  if (segment.phase === 'revealing') {
    const revealPhaseDuration = Math.max(0.5, settings.revealDuration);
    const revealRegionCount = puzzle.regions.length;
    const isBlinkingEnabled = settings.enableBlinking !== false;
    const revealStepSeconds = Math.min(
      Math.max(0.5, settings.sequentialRevealStep),
      revealPhaseDuration / Math.max(1, revealRegionCount + 1)
    );
    const revealBlinkStartTime = revealRegionCount * revealStepSeconds;
    const revealElapsed = clamp(phaseElapsed, 0, revealPhaseDuration);

    revealedRegionCount =
      revealRegionCount > 0 ? Math.min(revealRegionCount, Math.floor(revealElapsed / revealStepSeconds) + 1) : 0;

    blinkOverlayActive = isBlinkingEnabled && revealRegionCount > 0 && revealElapsed >= revealBlinkStartTime;
    if (blinkOverlayActive) {
      const halfCycle = Math.max(0.05, Math.max(0.2, settings.blinkSpeed) / 2);
      const blinkElapsed = revealElapsed - revealBlinkStartTime;
      blinkOverlayVisible = Math.floor(blinkElapsed / halfCycle) % 2 === 0;
    }
  }

  return {
    segment,
    phaseElapsed,
    timeLeft,
    progressPercent,
    countdownPercent,
    revealedRegionCount,
    blinkOverlayActive,
    blinkOverlayVisible,
    title: sceneText.title,
    subtitle: sceneText.subtitle,
    cardEyebrow: sceneText.cardEyebrow
  };
};

const fitTextSize = (
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  initialSize: number,
  fontFamily: string,
  fontWeight = 900,
  minSize = 12
) => {
  let size = initialSize;
  ctx.font = `${fontWeight} ${size}px ${fontFamily}`;
  while (size > minSize && ctx.measureText(text).width > maxWidth) {
    size -= 1;
    ctx.font = `${fontWeight} ${size}px ${fontFamily}`;
  }
  return size;
};

const drawSceneCard = (
  ctx: CanvasRenderingContext2D,
  gameRect: Rect,
  scene: RenderScene,
  settings: VideoSettings,
  visualTheme: typeof VISUAL_THEMES[VideoSettings['visualStyle']],
  isVerticalLayout: boolean,
  uiScale: number
) => {
  const kind: SceneCardKind =
    scene.segment.phase === 'intro'
      ? 'intro'
      : scene.segment.phase === 'outro'
      ? 'outro'
      : 'transition';
  const packagePreset =
    VIDEO_PACKAGE_PRESETS[settings.videoPackagePreset] ?? VIDEO_PACKAGE_PRESETS.gameshow;
  const variant =
    kind === 'intro'
      ? packagePreset.introCardVariant
      : kind === 'outro'
      ? packagePreset.outroCardVariant
      : packagePreset.transitionCardVariant;
  const transitionProgress = kind === 'transition' ? clamp(scene.progressPercent / 100, 0, 1) : 0;
  const transitionSmooth =
    kind === 'transition'
      ? transitionProgress * transitionProgress * (3 - 2 * transitionProgress)
      : 0;
  const transitionCardOpacity =
    kind === 'transition'
      ? clamp(
          TRANSITION_TUNING.cardOpacityBase +
            transitionSmooth * (TRANSITION_TUNING.cardOpacityPulse - 0.3) -
            transitionProgress * TRANSITION_TUNING.cardOpacityDecay,
          0,
          1
        )
      : 1;
  const transitionCardTranslateY =
    kind === 'transition' ? Math.round((1 - transitionSmooth) * (TRANSITION_TUNING.cardTranslateY + 8)) : 0;
  const transitionCardScale =
    kind === 'transition'
      ? TRANSITION_TUNING.cardScaleBase + transitionSmooth * (TRANSITION_TUNING.cardScalePulse + 0.04)
      : 1;
  const transitionCardGlowOpacity = 0.18 + transitionSmooth * 0.34;

  ctx.save();
  roundRectPath(ctx, gameRect);
  ctx.clip();

  if (variant === 'storybook') {
    const overlay = ctx.createLinearGradient(gameRect.x, gameRect.y, gameRect.x, gameRect.y + gameRect.height);
    overlay.addColorStop(
      0,
      `rgba(52,35,14,${kind === 'transition' ? (0.24 + transitionSmooth * 0.44).toFixed(3) : '0.48'})`
    );
    overlay.addColorStop(1, 'rgba(19,11,4,0.74)');
    ctx.fillStyle = overlay;
  } else if (variant === 'scoreboard') {
    const overlay = ctx.createRadialGradient(
      gameRect.x + gameRect.width / 2,
      gameRect.y,
      Math.max(1, gameRect.width * 0.04),
      gameRect.x + gameRect.width / 2,
      gameRect.y,
      Math.max(gameRect.width, gameRect.height)
    );
    overlay.addColorStop(
      0,
      `rgba(34,211,238,${kind === 'transition' ? (0.16 + transitionSmooth * 0.16).toFixed(3) : '0.14'})`
    );
    overlay.addColorStop(0.58, 'rgba(8,15,28,0.82)');
    overlay.addColorStop(1, 'rgba(2,6,16,0.92)');
    ctx.fillStyle = overlay;
  } else {
    const overlay = ctx.createLinearGradient(gameRect.x, gameRect.y, gameRect.x, gameRect.y + gameRect.height);
    overlay.addColorStop(
      0,
      `rgba(255,255,255,${kind === 'transition' ? (0.18 + transitionSmooth * 0.16).toFixed(3) : '0.22'})`
    );
    overlay.addColorStop(1, 'rgba(17,24,39,0.18)');
    ctx.fillStyle = overlay;
  }
  ctx.fillRect(gameRect.x, gameRect.y, gameRect.width, gameRect.height);

  const maxCardWidth = Math.min(gameRect.width * (isVerticalLayout ? 0.88 : 0.72), Math.round(760 * uiScale));
  const minCardWidth = Math.min(maxCardWidth, Math.round((isVerticalLayout ? 300 : 520) * uiScale));
  const cardWidth = Math.max(minCardWidth, Math.min(maxCardWidth, gameRect.width * 0.7));
  const cardHeight = Math.min(gameRect.height * 0.62, Math.max(Math.round(210 * uiScale), Math.round(280 * uiScale)));
  const cardCenterX = gameRect.x + gameRect.width / 2;
  const cardCenterY = gameRect.y + gameRect.height / 2 + transitionCardTranslateY;

  ctx.save();
  ctx.translate(cardCenterX, cardCenterY);
  ctx.scale(transitionCardScale, transitionCardScale);
  ctx.globalAlpha = transitionCardOpacity;
  ctx.shadowColor =
    variant === 'storybook'
      ? `rgba(229,191,115,${kind === 'transition' ? transitionCardGlowOpacity.toFixed(3) : '0.22'})`
      : variant === 'scoreboard'
      ? `rgba(90,223,255,${kind === 'transition' ? transitionCardGlowOpacity.toFixed(3) : '0.18'})`
      : 'rgba(15,23,42,0.18)';
  ctx.shadowBlur = Math.round((variant === 'standard' ? 18 : 28) * uiScale);
  ctx.shadowOffsetY = Math.round(8 * uiScale);

  const cardRect: Rect = {
    x: -cardWidth / 2,
    y: -cardHeight / 2,
    width: cardWidth,
    height: cardHeight,
    radius: Math.round(28 * uiScale)
  };
  const cardFill =
    variant === 'storybook'
      ? 'rgba(248,232,194,0.97)'
      : variant === 'scoreboard'
      ? 'rgba(13,20,37,0.96)'
      : 'rgba(255,255,255,0.97)';
  const cardStroke = variant === 'storybook' ? '#4D3E26' : variant === 'scoreboard' ? visualTheme.headerBg : '#111827';
  drawRoundedRect(ctx, cardRect, {
    fill: cardFill,
    stroke: cardStroke,
    lineWidth: Math.max(2, Math.round(3 * uiScale))
  });

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  drawRoundedRect(
    ctx,
    {
      x: cardRect.x,
      y: cardRect.y,
      width: cardRect.width,
      height: Math.max(6, Math.round(8 * uiScale)),
      radius: cardRect.radius
    },
    {
      fill: variant === 'standard' ? '#D97706' : visualTheme.headerBg
    }
  );

  const badgeFontFamily =
    variant === 'storybook' ? '"Georgia", "Times New Roman", serif' : '"Segoe UI", Arial, sans-serif';
  const badgeColor =
    variant === 'scoreboard' ? visualTheme.headerBg : variant === 'storybook' ? '#5A4320' : '#475569';
  const badgeBackground =
    variant === 'scoreboard'
      ? hexToRgba(visualTheme.headerBg, 0.16)
      : variant === 'storybook'
      ? 'rgba(255,248,230,0.84)'
      : 'rgba(255,255,255,0.78)';
  const badgeBorder =
    variant === 'scoreboard' ? hexToRgba(visualTheme.headerBg, 0.7) : variant === 'storybook' ? '#8B6D33' : '#CBD5E1';
  const badgeText = scene.cardEyebrow.toUpperCase();
  const badgeFontSize = Math.max(10, Math.round(13 * uiScale));
  ctx.font = `900 ${badgeFontSize}px ${badgeFontFamily}`;
  const badgeWidth = Math.max(
    Math.round(140 * uiScale),
    Math.ceil(ctx.measureText(badgeText).width + Math.round(32 * uiScale))
  );
  const badgeHeight = Math.max(30, Math.round(34 * uiScale));
  drawRoundedRect(
    ctx,
    {
      x: -badgeWidth / 2,
      y: cardRect.y + Math.round(28 * uiScale),
      width: badgeWidth,
      height: badgeHeight,
      radius: badgeHeight / 2
    },
    {
      fill: badgeBackground,
      stroke: badgeBorder,
      lineWidth: Math.max(1.5, Math.round(2 * uiScale))
    }
  );
  ctx.fillStyle = badgeColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(badgeText, 0, cardRect.y + Math.round(28 * uiScale) + badgeHeight / 2 + 1);

  const titleFontFamily =
    variant === 'storybook' ? '"Georgia", "Times New Roman", serif' : '"Arial Black", "Segoe UI", sans-serif';
  const subtitleFontFamily =
    variant === 'storybook' ? '"Georgia", "Times New Roman", serif' : '"Segoe UI", Arial, sans-serif';
  const titleText = scene.title.toUpperCase();
  const subtitleText = scene.subtitle.toUpperCase();
  const textColor = variant === 'storybook' ? '#2E2414' : variant === 'scoreboard' ? '#F8FAFC' : '#111827';
  const subtitleColor = variant === 'scoreboard' ? '#CBD5E1' : textColor;
  const maxTextWidth = cardWidth - Math.round(64 * uiScale);
  const titleFontSize = fitTextSize(
    ctx,
    titleText,
    maxTextWidth,
    Math.max(26, Math.round((isVerticalLayout ? 38 : 52) * uiScale)),
    titleFontFamily
  );
  const subtitleFontSize = fitTextSize(
    ctx,
    subtitleText,
    maxTextWidth,
    Math.max(12, Math.round(18 * uiScale)),
    subtitleFontFamily,
    800,
    10
  );
  ctx.fillStyle = textColor;
  ctx.font = `900 ${titleFontSize}px ${titleFontFamily}`;
  ctx.fillText(titleText, 0, -Math.round(4 * uiScale));
  ctx.fillStyle = subtitleColor;
  ctx.font = `800 ${subtitleFontSize}px ${subtitleFontFamily}`;
  ctx.fillText(subtitleText, 0, Math.round(48 * uiScale));

  const aspectFontSize = Math.max(10, Math.round(12 * uiScale));
  const aspectText = settings.aspectRatio;
  ctx.font = `900 ${aspectFontSize}px "Segoe UI", Arial, sans-serif`;
  const aspectWidth = Math.max(
    Math.round(90 * uiScale),
    Math.ceil(ctx.measureText(aspectText).width + Math.round(24 * uiScale))
  );
  const aspectHeight = Math.max(26, Math.round(30 * uiScale));
  drawRoundedRect(
    ctx,
    {
      x: -aspectWidth / 2,
      y: cardRect.y + cardRect.height - aspectHeight - Math.round(26 * uiScale),
      width: aspectWidth,
      height: aspectHeight,
      radius: aspectHeight / 2
    },
    {
      fill: variant === 'scoreboard' ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.62)',
      stroke: variant === 'scoreboard' ? 'rgba(226,232,240,0.32)' : 'rgba(17,24,39,0.12)',
      lineWidth: Math.max(1.5, Math.round(2 * uiScale))
    }
  );
  ctx.fillStyle = subtitleColor;
  ctx.font = `900 ${aspectFontSize}px "Segoe UI", Arial, sans-serif`;
  ctx.fillText(aspectText, 0, cardRect.y + cardRect.height - aspectHeight / 2 - Math.round(26 * uiScale) + 1);

  ctx.restore();
  ctx.restore();
};

const drawRevealMarker = (
  ctx: CanvasRenderingContext2D,
  markerBounds: MarkerBounds,
  settings: VideoSettings,
  revealVariant: VideoSettings['revealVariant'],
  scale: number
) => {
  const circleStroke = Math.max(2, settings.circleThickness) * scale;
  const outlineStroke = Math.max(0, settings.outlineThickness) * scale;
  const lineStroke = Math.max(2, 4 * scale);
  const x = markerBounds.x;
  const y = markerBounds.y;
  const width = markerBounds.width;
  const height = markerBounds.height;
  const centerX = x + width / 2;
  const centerY = y + height / 2;

  const strokeEllipse = (
    strokeColor: string,
    strokeWidth: number,
    dash: number[] = [],
    dashOffset = 0
  ) => {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, Math.max(2, width / 2), Math.max(2, height / 2), 0, 0, Math.PI * 2);
    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = strokeColor;
    ctx.setLineDash(dash);
    ctx.lineDashOffset = dashOffset;
    ctx.stroke();
    ctx.restore();
  };

  const strokeInsetEllipse = (
    insetRatio: number,
    strokeColor: string,
    strokeWidth: number,
    dash: number[] = [],
    dashOffset = 0
  ) => {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(
      centerX,
      centerY,
      Math.max(2, width / 2 - width * insetRatio),
      Math.max(2, height / 2 - height * insetRatio),
      0,
      0,
      Math.PI * 2
    );
    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = strokeColor;
    ctx.setLineDash(dash);
    ctx.lineDashOffset = dashOffset;
    ctx.stroke();
    ctx.restore();
  };

  const strokeRect = (dash: number[] = []) => {
    ctx.save();
    ctx.setLineDash(dash);
    if (outlineStroke > 0) {
      ctx.lineWidth = lineStroke + outlineStroke * 2;
      ctx.strokeStyle = settings.outlineColor;
      ctx.strokeRect(x, y, width, height);
    }
    ctx.lineWidth = lineStroke;
    ctx.strokeStyle = settings.revealColor;
    ctx.strokeRect(x, y, width, height);
    ctx.restore();
  };

  if (settings.revealStyle === 'box' && revealVariant === 'box_glow') {
    strokeRect();
    return;
  }

  if (settings.revealStyle === 'box' && revealVariant === 'box_classic') {
    strokeRect();
    const inset = Math.max(4 * scale, Math.min(width, height) * 0.14);
    ctx.save();
    if (outlineStroke > 0) {
      ctx.lineWidth = Math.max(1, lineStroke * 0.45) + outlineStroke * 1.5;
      ctx.strokeStyle = settings.outlineColor;
      ctx.strokeRect(x + inset, y + inset, Math.max(1, width - inset * 2), Math.max(1, height - inset * 2));
    }
    ctx.lineWidth = Math.max(1, lineStroke * 0.45);
    ctx.strokeStyle = hexToRgba(settings.revealColor, 0.82);
    ctx.strokeRect(x + inset, y + inset, Math.max(1, width - inset * 2), Math.max(1, height - inset * 2));
    ctx.restore();
    return;
  }

  if (settings.revealStyle === 'box' && revealVariant === 'box_minimal') {
    ctx.save();
    if (outlineStroke > 0) {
      ctx.lineWidth = Math.max(1, 2.5 * scale) + outlineStroke * 2;
      ctx.strokeStyle = settings.outlineColor;
      ctx.strokeRect(x, y, width, height);
    }
    ctx.lineWidth = Math.max(1, 2.5 * scale);
    ctx.strokeStyle = settings.revealColor;
    ctx.strokeRect(x, y, width, height);
    ctx.restore();
    return;
  }

  if (settings.revealStyle === 'box' && revealVariant === 'box_dashed') {
    strokeRect([10 * scale, 8 * scale]);
    return;
  }

  if (settings.revealStyle === 'box' && revealVariant === 'box_corners') {
    const cornerLength = Math.min(width, height) * 0.35;
    const strokeWidth = lineStroke;
    const drawCorner = (fromX: number, fromY: number, toX: number, toY: number, endX: number, endY: number) => {
      if (outlineStroke > 0) {
        ctx.strokeStyle = settings.outlineColor;
        ctx.lineWidth = strokeWidth + outlineStroke * 2;
        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(toX, toY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
      }

      ctx.strokeStyle = settings.revealColor;
      ctx.lineWidth = strokeWidth;
      ctx.beginPath();
      ctx.moveTo(fromX, fromY);
      ctx.lineTo(toX, toY);
      ctx.lineTo(endX, endY);
      ctx.stroke();
    };

    drawCorner(x, y + cornerLength, x, y, x + cornerLength, y);
    drawCorner(x + width - cornerLength, y, x + width, y, x + width, y + cornerLength);
    drawCorner(x, y + height - cornerLength, x, y + height, x + cornerLength, y + height);
    drawCorner(x + width - cornerLength, y + height, x + width, y + height, x + width, y + height - cornerLength);
    return;
  }

  if (settings.revealStyle === 'circle' && revealVariant === 'circle_ring') {
    if (outlineStroke > 0) {
      strokeEllipse(settings.outlineColor, circleStroke + outlineStroke * 2);
    }
    strokeEllipse(settings.revealColor, circleStroke);
    return;
  }

  if (settings.revealStyle === 'circle' && revealVariant === 'circle_classic') {
    if (outlineStroke > 0) {
      strokeEllipse(settings.outlineColor, circleStroke + outlineStroke * 2);
    }
    strokeEllipse(settings.revealColor, circleStroke);
    strokeInsetEllipse(0.18, hexToRgba(settings.revealColor, 0.82), Math.max(1, circleStroke * 0.45));
    return;
  }

  if (settings.revealStyle === 'circle' && revealVariant === 'circle_crosshair') {
    if (outlineStroke > 0) {
      strokeEllipse(settings.outlineColor, circleStroke + outlineStroke * 2);
    }
    strokeEllipse(settings.revealColor, circleStroke);

    const guideStroke = Math.max(1.5, circleStroke * 0.72);
    const verticalInset = Math.max(4 * scale, height * 0.07);
    const verticalLength = Math.max(8 * scale, height * 0.17);
    const horizontalInset = Math.max(4 * scale, width * 0.07);
    const horizontalLength = Math.max(8 * scale, width * 0.17);

    ctx.save();
    ctx.strokeStyle = settings.revealColor;
    ctx.lineWidth = guideStroke;
    ctx.lineCap = 'round';

    ctx.beginPath();
    ctx.moveTo(centerX, y + verticalInset);
    ctx.lineTo(centerX, y + verticalInset + verticalLength);
    ctx.moveTo(centerX, y + height - verticalInset);
    ctx.lineTo(centerX, y + height - verticalInset - verticalLength);
    ctx.moveTo(x + horizontalInset, centerY);
    ctx.lineTo(x + horizontalInset + horizontalLength, centerY);
    ctx.moveTo(x + width - horizontalInset, centerY);
    ctx.lineTo(x + width - horizontalInset - horizontalLength, centerY);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (settings.revealStyle === 'circle' && revealVariant === 'circle_dotted') {
    if (outlineStroke > 0) {
      strokeEllipse(settings.outlineColor, circleStroke + outlineStroke * 2);
    }
    strokeEllipse(settings.revealColor, circleStroke, [2 * scale, 8 * scale]);
    return;
  }

  if (settings.revealStyle === 'circle' && revealVariant === 'circle_ellipse') {
    if (outlineStroke > 0) {
      strokeEllipse(settings.outlineColor, circleStroke + outlineStroke * 2);
    }
    strokeEllipse(settings.revealColor, circleStroke);
    return;
  }

  if (settings.revealStyle === 'circle' && revealVariant === 'circle_ellipse_dotted') {
    if (outlineStroke > 0) {
      strokeEllipse(settings.outlineColor, circleStroke + outlineStroke * 2);
    }
    strokeEllipse(settings.revealColor, circleStroke, [3 * scale, 8 * scale]);
    return;
  }

  if (settings.revealStyle === 'circle' && revealVariant === 'circle_red_black') {
    if (outlineStroke > 0) {
      strokeEllipse(settings.outlineColor, circleStroke + outlineStroke * 2);
    }
    const dashSize = 12 * scale;
    strokeEllipse('#DC2626', circleStroke, [dashSize, dashSize], 0);
    strokeEllipse('#111111', circleStroke, [dashSize, dashSize], dashSize);
    return;
  }

  if (settings.revealStyle === 'highlight') {
    if (revealVariant === 'highlight_classic') {
      const inset = Math.max(3 * scale, Math.min(width, height) * 0.1);
      ctx.save();
      if (outlineStroke > 0) {
        ctx.lineWidth = Math.max(1, outlineStroke * 2);
        ctx.strokeStyle = settings.outlineColor;
        ctx.strokeRect(x, y, width, height);
      }
      ctx.lineWidth = Math.max(2, 2 * scale);
      ctx.strokeStyle = hexToRgba(settings.revealColor, 0.72);
      ctx.fillStyle = hexToRgba(settings.revealColor, 0.18);
      ctx.fillRect(x, y, width, height);
      ctx.strokeRect(x, y, width, height);
      ctx.lineWidth = Math.max(1, 1.25 * scale);
      ctx.strokeStyle = hexToRgba(settings.revealColor, 0.34);
      ctx.strokeRect(x + inset, y + inset, Math.max(1, width - inset * 2), Math.max(1, height - inset * 2));
      ctx.restore();
      return;
    }

    ctx.save();
    if (outlineStroke > 0) {
      ctx.lineWidth = Math.max(1, outlineStroke * 2);
      ctx.strokeStyle = settings.outlineColor;
      ctx.strokeRect(x, y, width, height);
    }
    ctx.lineWidth = Math.max(2, 2 * scale);
    ctx.strokeStyle = hexToRgba(settings.revealColor, 0.8);
    ctx.fillStyle = hexToRgba(settings.revealColor, 0.35);
    ctx.fillRect(x, y, width, height);
    ctx.strokeRect(x, y, width, height);
    ctx.restore();
  }
};

const drawRevealSpotlightFill = (
  ctx: CanvasRenderingContext2D,
  markerBounds: MarkerBounds,
  settings: VideoSettings,
  revealVariant: VideoSettings['revealVariant'],
  isActive: boolean,
  scale: number
) => {
  const inset = Math.max(2, Math.round(Math.min(markerBounds.width, markerBounds.height) * 0.08));
  const innerBounds: MarkerBounds = {
    x: markerBounds.x + inset,
    y: markerBounds.y + inset,
    width: Math.max(1, markerBounds.width - inset * 2),
    height: Math.max(1, markerBounds.height - inset * 2)
  };
  const centerX = innerBounds.x + innerBounds.width / 2;
  const centerY = innerBounds.y + innerBounds.height / 2;
  const isEllipseVariant =
    settings.revealStyle === 'circle' &&
    (revealVariant === 'circle_ellipse' || revealVariant === 'circle_ellipse_dotted');

  ctx.save();
  ctx.shadowColor = hexToRgba(settings.revealColor, isActive ? 0.34 : 0.2);
  ctx.shadowBlur = Math.max(8, Math.round((isActive ? 18 : 10) * scale));
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  if (settings.revealStyle === 'circle') {
    const radiusX = Math.max(2, innerBounds.width / 2);
    const radiusY = Math.max(2, innerBounds.height / 2);
    const gradient = ctx.createRadialGradient(
      centerX,
      centerY,
      Math.max(2, Math.min(radiusX, radiusY) * 0.2),
      centerX,
      centerY,
      Math.max(radiusX, radiusY)
    );
    gradient.addColorStop(0, hexToRgba(settings.revealColor, isActive ? 0.3 : 0.16));
    gradient.addColorStop(0.55, isActive ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.12)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath();
    if (isEllipseVariant) {
      ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
    } else {
      ctx.arc(centerX, centerY, Math.max(2, Math.min(radiusX, radiusY)), 0, Math.PI * 2);
    }
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.restore();
    return;
  }

  const radius = settings.revealStyle === 'highlight' ? Math.round(10 * scale) : Math.round(12 * scale);
  const gradient = ctx.createLinearGradient(
    innerBounds.x,
    innerBounds.y,
    innerBounds.x + innerBounds.width,
    innerBounds.y + innerBounds.height
  );
  gradient.addColorStop(0, isActive ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.12)');
  gradient.addColorStop(1, hexToRgba(settings.revealColor, isActive ? 0.22 : 0.1));
  roundRectPath(ctx, { ...innerBounds, radius });
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.restore();
};

const drawFrame = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  puzzles: Puzzle[],
  loadedImages: Array<LoadedPuzzleImages | null>,
  brandLogo: ImageBitmap | null,
  settings: VideoSettings,
  scene: RenderScene
) => {
  const packagePreset =
    VIDEO_PACKAGE_PRESETS[settings.videoPackagePreset] ?? VIDEO_PACKAGE_PRESETS.gameshow;
  const effectiveVisualStyle = resolveVisualThemeStyle(settings.visualStyle, scene.segment.puzzleIndex);
  const visualTheme = VISUAL_THEMES[effectiveVisualStyle];
  const accent = visualTheme.timerDot;
  const isVerticalLayout = resolvePackageImageArrangement(packagePreset, settings.aspectRatio);
  const customLayoutEnabled = settings.useCustomLayout === true;
  const isStorybookStyle =
    packagePreset.surfaceStyle === 'storybook' && settings.aspectRatio === '16:9' && !customLayoutEnabled;
  const isClassicStyle =
    packagePreset.surfaceStyle === 'gameshow' && !customLayoutEnabled;
  const uiScale = clamp(Math.min(width, height) / 1080, 0.55, 2.2);

  const panelBackground = visualTheme.imagePanelBg;
  const rootBackground = isStorybookStyle ? '#E5D19A' : visualTheme.gameBg;
  const boardBackground = isStorybookStyle ? '#E5D19A' : visualTheme.gameBg;
  const boardStroke = isStorybookStyle ? '#3F301A' : '#000000';
  const headerBackground = visualTheme.headerBg;
  const gameBackground = visualTheme.gameBg;
  const timerBackground = visualTheme.timerBg;
  const timerTextColor = visualTheme.timerText;
  const timerBorderColor = visualTheme.timerBorder;
  const isRevealPhase = scene.segment.phase === 'revealing';
  const shouldRenderHeaderText = scene.segment.phase !== 'intro' && scene.segment.phase !== 'outro';
  const shouldShowHeaderTimer = !isRevealPhase;
  const shouldShowHeaderProgress = scene.segment.phase === 'showing';
  const shouldRenderCustomLogo = Boolean(brandLogo) && customLayoutEnabled;
  const shouldRenderInlineLogo =
    Boolean(brandLogo) && !customLayoutEnabled && !isClassicStyle && !isStorybookStyle && shouldRenderHeaderText;
  const shouldRenderPuzzlePanels = scene.segment.phase !== 'intro' && scene.segment.phase !== 'outro';
  const countdownPercent = clamp(scene.countdownPercent, 0, 100);

  const outerPad = 0;
  const board: Rect = {
    x: outerPad,
    y: outerPad,
    width: width - outerPad * 2,
    height: height - outerPad * 2,
    radius: 0
  };
  const baseStage = BASE_STAGE_SIZE[settings.aspectRatio];
  const layoutScale = Math.min(board.width / baseStage.width, board.height / baseStage.height);
  const classicLayoutScale = Math.max(0.55, layoutScale);
  const resolvedLayout = resolveVideoLayoutSettings(settings.videoPackagePreset, settings.aspectRatio, settings);
  const styleHudLayout = resolvedLayout.hud;
  const styleFrameLayout = resolvedLayout.frame;
  const boardStrokeWidth = Math.max(4, 4 * uiScale);
  const headerHeight = isClassicStyle
    ? Math.max(40, Math.round(CLASSIC_HUD_SPEC.headerHeight * classicLayoutScale))
    : isStorybookStyle
    ? Math.round(board.height * 0.14)
    : Math.max(36, Math.round(styleFrameLayout.headerHeight * layoutScale));
  const contentPadding = isClassicStyle
    ? Math.max(6, Math.round(8 * classicLayoutScale))
    : isStorybookStyle
    ? Math.round(14 * uiScale)
    : Math.round(styleFrameLayout.contentPadding * layoutScale);
  const gameRect: Rect = {
    x: board.x + contentPadding,
    y: board.y + headerHeight + contentPadding,
    width: board.width - contentPadding * 2,
    height: board.height - headerHeight - contentPadding * 2
  };
  const panelGap = isClassicStyle
    ? Math.max(6, Math.round(8 * classicLayoutScale))
    : isStorybookStyle
    ? Math.round(22 * uiScale)
    : Math.round(styleFrameLayout.panelGap * layoutScale);
  const panelRadius = isClassicStyle
    ? Math.max(8, Math.round(12 * classicLayoutScale))
    : isStorybookStyle
    ? Math.round(18 * uiScale)
    : Math.round(styleFrameLayout.panelRadius * layoutScale);
  const gamePadding = isStorybookStyle
    ? Math.round(8 * uiScale)
    : isClassicStyle
    ? Math.max(0, Math.round(styleFrameLayout.gamePadding * classicLayoutScale))
    : Math.max(0, Math.round(styleFrameLayout.gamePadding * layoutScale));
  const drawHeaderLogo = (rect: Rect) => {
    if (!brandLogo) return;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = Math.max(3, Math.round(6 * uiScale));
    ctx.shadowOffsetY = Math.max(1, Math.round(2 * uiScale));
    drawImageContain(ctx, brandLogo, rect, settings.logoZoom);
    ctx.restore();
  };

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = rootBackground;
  ctx.fillRect(0, 0, width, height);

  drawRoundedRect(ctx, board, { fill: boardBackground, stroke: boardStroke, lineWidth: boardStrokeWidth });
  drawRoundedRect(
    ctx,
    { x: board.x, y: board.y, width: board.width, height: headerHeight, radius: board.radius },
    { fill: headerBackground }
  );
  ctx.fillStyle = boardStroke;
  ctx.fillRect(board.x, board.y + headerHeight - Math.max(3, 3 * uiScale), board.width, Math.max(3, 3 * uiScale));

  const templateValues = {
    current: scene.segment.puzzleIndex + 1,
    next: Math.min(puzzles.length, scene.segment.puzzleIndex + 2),
    total: puzzles.length,
    puzzleCount: puzzles.length,
    remaining: Math.max(0, puzzles.length - (scene.segment.puzzleIndex + 1)),
    preset: ''
  };
  const puzzleBadgeLabel = fillTemplate(settings.textTemplates.puzzleBadgeLabel, templateValues);
  const titleFontSize = Math.max(18, Math.round((isStorybookStyle ? 48 : 34) * uiScale));

  if (isStorybookStyle) {
    const timerBoxWidth = Math.round(126 * uiScale);
    const timerBoxHeight = Math.round(52 * uiScale);
    const timerBoxX = board.x + board.width - contentPadding - timerBoxWidth;
    const timerBoxY = board.y + Math.round((headerHeight - timerBoxHeight) / 2);

    if (shouldRenderHeaderText) {
      ctx.fillStyle = '#2E2414';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = `900 ${titleFontSize}px "Georgia", "Times New Roman", serif`;
      ctx.fillText(
        scene.title.toLowerCase(),
        board.x + contentPadding,
        board.y + headerHeight / 2 + Math.round(2 * uiScale)
      );
    }

    if (shouldShowHeaderProgress) {
      const progressTrackHeight = Math.max(14, Math.round(24 * uiScale));
      const progressTrackWidth = Math.round(board.width * 0.31);
      const progressTrackX = Math.round(board.x + board.width * 0.51 - progressTrackWidth / 2);
      const progressTrackY = Math.round(board.y + (headerHeight - progressTrackHeight) / 2);
      const progressTrackRect: Rect = {
        x: progressTrackX,
        y: progressTrackY,
        width: progressTrackWidth,
        height: progressTrackHeight,
        radius: progressTrackHeight / 2
      };
      drawRoundedRect(ctx, progressTrackRect, {
        fill: '#8B6D33',
        stroke: '#3F301A',
        lineWidth: Math.max(2, 3 * uiScale)
      });
      const progressFillRect: Rect = {
        x: progressTrackX + Math.max(2, 3 * uiScale),
        y: progressTrackY + Math.max(2, 3 * uiScale),
        width: ((progressTrackWidth - Math.max(4, 6 * uiScale)) * countdownPercent) / 100,
        height: progressTrackHeight - Math.max(4, 6 * uiScale),
        radius: (progressTrackHeight - Math.max(4, 6 * uiScale)) / 2
      };
      if (progressFillRect.width > 0) {
        roundRectPath(ctx, progressFillRect);
        ctx.fillStyle = resolveProgressFill(ctx, progressFillRect, visualTheme.progressFill, accent);
        ctx.fill();
      }
    }

    ctx.fillStyle = '#2E2414';
    ctx.textAlign = 'right';
    ctx.font = `900 ${Math.max(16, Math.round(34 * uiScale))}px "Georgia", "Times New Roman", serif`;
    ctx.fillText(`${scene.segment.puzzleIndex + 1}/${puzzles.length}`, timerBoxX - Math.round(12 * uiScale), board.y + headerHeight / 2 + 1);

    if (shouldShowHeaderTimer) {
      drawRoundedRect(
        ctx,
        { x: timerBoxX, y: timerBoxY, width: timerBoxWidth, height: timerBoxHeight, radius: Math.round(14 * uiScale) },
        { fill: timerBackground, stroke: timerBorderColor, lineWidth: Math.max(2, 3 * uiScale) }
      );
      ctx.fillStyle = timerTextColor;
      ctx.textAlign = 'center';
      ctx.font = `900 ${Math.max(14, Math.round(30 * uiScale))}px "Georgia", "Times New Roman", serif`;
      ctx.fillText(formatCountdownSeconds(scene.timeLeft), timerBoxX + timerBoxWidth / 2, timerBoxY + timerBoxHeight / 2 + 1);
    }
  } else {
    const headerRect: Rect = { x: board.x, y: board.y, width: board.width, height: headerHeight };
    const timerTextValue = formatCountdownSeconds(scene.timeLeft);

    if (isClassicStyle) {
      const timerPadX = Math.max(6, Math.round(CLASSIC_HUD_SPEC.timer.padX * classicLayoutScale));
      const timerPadY = Math.max(2, Math.round(CLASSIC_HUD_SPEC.timer.padY * classicLayoutScale));
      const timerDotSize = Math.max(4, Math.round(CLASSIC_HUD_SPEC.timer.dotSize * classicLayoutScale));
      const timerGap = Math.max(4, Math.round(CLASSIC_HUD_SPEC.timer.gap * classicLayoutScale));
      const timerFontSize = Math.max(14, Math.round(CLASSIC_HUD_SPEC.timer.fontSize * classicLayoutScale));
      ctx.font = `900 ${timerFontSize}px "Consolas", "Courier New", monospace`;
      const timerTextWidth = ctx.measureText(timerTextValue).width;
      const timerBoxWidth = Math.max(
        Math.round(CLASSIC_HUD_SPEC.timer.minWidth * classicLayoutScale),
        Math.ceil(timerPadX * 2 + timerDotSize + timerGap + timerTextWidth + Math.round(2 * classicLayoutScale))
      );
      const timerBoxHeight = Math.max(30, Math.round(timerFontSize + timerPadY * 2 + Math.round(2 * classicLayoutScale)));
      const timerBoxX = board.x + board.width - contentPadding - timerBoxWidth;
      const timerBoxY = board.y + Math.round(CLASSIC_HUD_SPEC.timer.top * classicLayoutScale);

      const badgePadX = Math.max(8, Math.round(CLASSIC_HUD_SPEC.puzzleBadge.padX * classicLayoutScale));
      const badgeGap = Math.max(4, Math.round(CLASSIC_HUD_SPEC.puzzleBadge.gap * classicLayoutScale));
      const badgeLabelSize = Math.max(
        8,
        Math.round(CLASSIC_HUD_SPEC.puzzleBadge.labelSize * classicLayoutScale)
      );
      const badgeValueSize = Math.max(
        16,
        Math.round(
          (isVerticalLayout
            ? CLASSIC_HUD_SPEC.puzzleBadge.valueSizeNarrow
            : CLASSIC_HUD_SPEC.puzzleBadge.valueSize) * classicLayoutScale
        )
      );
      const badgeHeight = Math.max(30, Math.round(CLASSIC_HUD_SPEC.puzzleBadge.height * classicLayoutScale));
      const badgeX = board.x + Math.round(CLASSIC_HUD_SPEC.puzzleBadge.left * classicLayoutScale);
      const badgeY = board.y + Math.round(CLASSIC_HUD_SPEC.puzzleBadge.top * classicLayoutScale);
      const badgeText = `${scene.segment.puzzleIndex + 1}/${puzzles.length}`;

      ctx.font = `900 ${badgeLabelSize}px "Segoe UI", Arial, sans-serif`;
      const badgeLabelWidth = ctx.measureText(puzzleBadgeLabel).width;
      ctx.font = `900 ${badgeValueSize}px "Arial Black", "Segoe UI", sans-serif`;
      const badgeValueWidth = ctx.measureText(badgeText).width;
      const badgeWidth = Math.max(
        Math.round(CLASSIC_HUD_SPEC.puzzleBadge.minWidth * classicLayoutScale),
        Math.ceil(badgePadX * 2 + badgeLabelWidth + badgeGap + badgeValueWidth)
      );
      const badgeRect: Rect = {
        x: badgeX,
        y: badgeY,
        width: badgeWidth,
        height: badgeHeight,
        radius: Math.max(8, Math.round(CLASSIC_HUD_SPEC.puzzleBadge.radius * classicLayoutScale))
      };
      const badgeFill = resolveProgressFill(
        ctx,
        badgeRect,
        CLASSIC_HUD_SPEC.puzzleBadge.background,
        '#FFE88A'
      );
      drawRoundedRect(ctx, badgeRect, {
        fill: badgeFill,
        stroke: CLASSIC_HUD_SPEC.puzzleBadge.border,
        lineWidth: Math.max(2, Math.round(2 * classicLayoutScale))
      });
      ctx.save();
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#111827';
      ctx.textAlign = 'left';
      ctx.font = `900 ${badgeLabelSize}px "Segoe UI", Arial, sans-serif`;
      ctx.fillText(puzzleBadgeLabel, badgeRect.x + badgePadX, badgeRect.y + badgeRect.height / 2 + 1);
      ctx.fillStyle = '#020617';
      ctx.textAlign = 'right';
      ctx.font = `900 ${badgeValueSize}px "Arial Black", "Segoe UI", sans-serif`;
      ctx.fillText(
        badgeText,
        badgeRect.x + badgeRect.width - badgePadX,
        badgeRect.y + badgeRect.height / 2 + 1
      );
      ctx.restore();

      if (shouldRenderHeaderText) {
        const centerTitleText = scene.title.toUpperCase();
        let centerTitleSize = Math.max(
          16,
          Math.round(
            (isVerticalLayout
              ? CLASSIC_HUD_SPEC.centerTitle.fontSizeNarrow
              : CLASSIC_HUD_SPEC.centerTitle.fontSize) * classicLayoutScale
          )
        );
        const sidePadding = Math.max(8, Math.round(10 * classicLayoutScale));
        const titleAvailableWidth = Math.max(
          120,
          timerBoxX - sidePadding - (badgeRect.x + badgeRect.width + sidePadding)
        );
        ctx.font = `900 ${centerTitleSize}px "Arial Black", "Segoe UI", sans-serif`;
        const measuredTitleWidth = ctx.measureText(centerTitleText).width;
        if (measuredTitleWidth > titleAvailableWidth) {
          centerTitleSize = Math.max(
            14,
            Math.floor(centerTitleSize * (titleAvailableWidth / Math.max(1, measuredTitleWidth)))
          );
        }
        const centerTitleRect: Rect = {
          x: board.x + (board.width - titleAvailableWidth) / 2,
          y: board.y,
          width: titleAvailableWidth,
          height: headerHeight
        };
        const centerTitleFill = resolveProgressFill(
          ctx,
          centerTitleRect,
          CLASSIC_HUD_SPEC.centerTitle.fillGradient,
          '#FFD93D'
        );
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `900 ${centerTitleSize}px "Arial Black", "Segoe UI", sans-serif`;
        ctx.lineWidth = Math.max(1.5, Math.round(2 * classicLayoutScale));
        ctx.strokeStyle = CLASSIC_HUD_SPEC.centerTitle.strokeColor;
        ctx.shadowColor = 'rgba(0, 0, 0, 0.24)';
        ctx.shadowBlur = Math.max(2, Math.round(8 * classicLayoutScale));
        const centerTitleX = board.x + board.width / 2;
        const centerTitleY = board.y + headerHeight / 2;
        ctx.strokeText(centerTitleText, centerTitleX, centerTitleY);
        ctx.fillStyle = centerTitleFill;
        ctx.fillText(centerTitleText, centerTitleX, centerTitleY);
        ctx.restore();
      }

      if (shouldShowHeaderTimer) {
        drawRoundedRect(
          ctx,
          {
            x: timerBoxX,
            y: timerBoxY,
            width: timerBoxWidth,
            height: timerBoxHeight,
            radius: timerBoxHeight / 2
          },
          {
            fill: timerBackground,
            stroke: timerBorderColor,
            lineWidth: Math.max(2, Math.round(2 * classicLayoutScale))
          }
        );
        ctx.beginPath();
        ctx.arc(
          timerBoxX + timerPadX + timerDotSize / 2,
          timerBoxY + timerBoxHeight / 2,
          timerDotSize / 2,
          0,
          Math.PI * 2
        );
        ctx.fillStyle = scene.timeLeft <= 2 ? '#FF0000' : accent;
        ctx.fill();
        ctx.fillStyle = timerTextColor;
        ctx.font = `900 ${timerFontSize}px "Consolas", "Courier New", monospace`;
        ctx.textBaseline = 'middle';
        ctx.fillText(
          timerTextValue,
          timerBoxX + timerPadX + timerDotSize + timerGap,
          timerBoxY + timerBoxHeight / 2 + 1
        );

        if (shouldShowHeaderProgress) {
          const progressTrackHeight = Math.max(8, Math.round(CLASSIC_HUD_SPEC.progress.height * classicLayoutScale));
          const progressTrackWidth = Math.round(board.width * CLASSIC_HUD_SPEC.progress.widthRatio);
          const progressTrackX = Math.round(board.x + (board.width - progressTrackWidth) / 2);
          const progressTrackY =
            board.y +
            headerHeight -
            progressTrackHeight -
            Math.max(1, Math.round(CLASSIC_HUD_SPEC.progress.bottom * classicLayoutScale));
          const progressTrackRect: Rect = {
            x: progressTrackX,
            y: progressTrackY,
            width: progressTrackWidth,
            height: progressTrackHeight,
            radius: progressTrackHeight / 2
          };
          const classicTrackFill = resolveProgressFill(
            ctx,
            progressTrackRect,
            CLASSIC_HUD_SPEC.progress.trackBackground,
            '#141414'
          );
          drawRoundedRect(ctx, progressTrackRect, {
            fill: classicTrackFill,
            stroke: visualTheme.progressTrackBorder,
            lineWidth: Math.max(1, Math.round(CLASSIC_HUD_SPEC.progress.borderWidth * classicLayoutScale))
          });
          const fillInset = Math.max(1, Math.round(CLASSIC_HUD_SPEC.progress.fillInset * classicLayoutScale));
          const progressFillRect: Rect = {
            x: progressTrackX + fillInset,
            y: progressTrackY + fillInset,
            width: ((progressTrackWidth - fillInset * 2) * countdownPercent) / 100,
            height: Math.max(1, progressTrackHeight - fillInset * 2),
            radius: Math.max(1, (progressTrackHeight - fillInset * 2) / 2)
          };
          if (progressFillRect.width > 0) {
            roundRectPath(ctx, progressFillRect);
            ctx.fillStyle = resolveProgressFill(ctx, progressFillRect, CLASSIC_HUD_SPEC.progress.fillGradient, accent);
            ctx.fill();
            ctx.save();
            roundRectPath(ctx, progressFillRect);
            ctx.shadowColor = CLASSIC_HUD_SPEC.progress.fillGlowCanvas;
            ctx.shadowBlur = Math.max(4, Math.round(8 * uiScale));
            ctx.strokeStyle = 'rgba(255, 166, 120, 0.8)';
            ctx.lineWidth = Math.max(1, Math.round(1.5 * uiScale));
            ctx.stroke();
            ctx.restore();
          }
        }
      }

      if (shouldShowHeaderProgress && !shouldShowHeaderTimer) {
        const progressTrackHeight = Math.max(8, Math.round(CLASSIC_HUD_SPEC.progress.height * classicLayoutScale));
        const progressTrackWidth = Math.round(board.width * CLASSIC_HUD_SPEC.progress.widthRatio);
        const progressTrackX = Math.round(board.x + (board.width - progressTrackWidth) / 2);
        const progressTrackY =
          board.y +
          headerHeight -
          progressTrackHeight -
          Math.max(1, Math.round(CLASSIC_HUD_SPEC.progress.bottom * classicLayoutScale));
        const progressTrackRect: Rect = {
          x: progressTrackX,
          y: progressTrackY,
          width: progressTrackWidth,
          height: progressTrackHeight,
          radius: progressTrackHeight / 2
        };
        const classicTrackFill = resolveProgressFill(
          ctx,
          progressTrackRect,
          CLASSIC_HUD_SPEC.progress.trackBackground,
          '#141414'
        );
        drawRoundedRect(ctx, progressTrackRect, {
          fill: classicTrackFill,
          stroke: visualTheme.progressTrackBorder,
          lineWidth: Math.max(1, Math.round(CLASSIC_HUD_SPEC.progress.borderWidth * classicLayoutScale))
        });
        const fillInset = Math.max(1, Math.round(CLASSIC_HUD_SPEC.progress.fillInset * classicLayoutScale));
        const progressFillRect: Rect = {
          x: progressTrackX + fillInset,
          y: progressTrackY + fillInset,
          width: ((progressTrackWidth - fillInset * 2) * countdownPercent) / 100,
          height: Math.max(1, progressTrackHeight - fillInset * 2),
          radius: Math.max(1, (progressTrackHeight - fillInset * 2) / 2)
        };
        if (progressFillRect.width > 0) {
          roundRectPath(ctx, progressFillRect);
          ctx.fillStyle = resolveProgressFill(ctx, progressFillRect, CLASSIC_HUD_SPEC.progress.fillGradient, accent);
          ctx.fill();
          ctx.save();
          roundRectPath(ctx, progressFillRect);
          ctx.shadowColor = CLASSIC_HUD_SPEC.progress.fillGlowCanvas;
          ctx.shadowBlur = Math.max(4, Math.round(8 * uiScale));
          ctx.strokeStyle = 'rgba(255, 166, 120, 0.8)';
          ctx.lineWidth = Math.max(1, Math.round(1.5 * uiScale));
          ctx.stroke();
          ctx.restore();
        }
      }
    } else {
      const nonClassicScale = Math.max(0.55, layoutScale);
      const titleFontSizePx = Math.max(12, Math.round(styleHudLayout.title.fontSize * nonClassicScale));
      const subtitleFontSizePx = Math.max(8, Math.round(styleHudLayout.title.subtitleSize * nonClassicScale));
      const subtitleGapPx = Math.max(1, Math.round(styleHudLayout.title.subtitleGap * nonClassicScale));
      const titleOrigin = resolveAnchoredRect(styleHudLayout.title, 0, 0, headerRect, nonClassicScale);
      const customLogoSize = Math.max(12, Math.round(resolvedLayout.logo.size * nonClassicScale));

      if (shouldRenderCustomLogo) {
        drawHeaderLogo({
          x: headerRect.x + Math.round(resolvedLayout.logo.left * nonClassicScale),
          y: headerRect.y + Math.round(resolvedLayout.logo.top * nonClassicScale),
          width: customLogoSize,
          height: customLogoSize
        });
      }

      if (shouldRenderHeaderText) {
        ctx.textAlign = styleHudLayout.title.align;
        ctx.textBaseline = 'top';
        ctx.font = `900 ${titleFontSizePx}px "Arial Black", "Segoe UI", sans-serif`;
        const titleTextWidth = ctx.measureText(scene.title).width;
        ctx.font = `700 ${subtitleFontSizePx}px "Segoe UI", Arial, sans-serif`;
        const subtitleTextWidth = ctx.measureText(scene.subtitle).width;
        const titleBlockWidth = Math.max(titleTextWidth, subtitleTextWidth);
        const inlineLogoSize =
          shouldRenderInlineLogo && brandLogo
            ? Math.max(14, Math.round(packagePreset.chrome.logoSize * nonClassicScale))
            : 0;
        const inlineLogoGap = inlineLogoSize > 0 ? Math.max(4, Math.round(packagePreset.chrome.titleGap * nonClassicScale)) : 0;
        let titleTextX = titleOrigin.x;

        if (inlineLogoSize > 0) {
          const inlineLogoRect: Rect = {
            x:
              styleHudLayout.title.align === 'left'
                ? titleOrigin.x
                : styleHudLayout.title.align === 'center'
                ? titleOrigin.x - titleBlockWidth / 2 - inlineLogoGap - inlineLogoSize
                : titleOrigin.x - titleBlockWidth - inlineLogoGap - inlineLogoSize,
            y: titleOrigin.y,
            width: inlineLogoSize,
            height: inlineLogoSize
          };
          if (styleHudLayout.title.align === 'left') {
            titleTextX += inlineLogoSize + inlineLogoGap;
          }
          drawHeaderLogo(inlineLogoRect);
        }

        ctx.fillStyle = visualTheme.headerText;
        ctx.font = `900 ${titleFontSizePx}px "Arial Black", "Segoe UI", sans-serif`;
        ctx.fillText(scene.title, titleTextX, titleOrigin.y);
        ctx.fillStyle = visualTheme.headerSubText;
        ctx.font = `700 ${subtitleFontSizePx}px "Segoe UI", Arial, sans-serif`;
        ctx.fillText(scene.subtitle, titleTextX, titleOrigin.y + titleFontSizePx + subtitleGapPx);
      }

      const timerPadX = Math.max(6, Math.round(styleHudLayout.timer.padX * nonClassicScale));
      const timerPadY = Math.max(2, Math.round(styleHudLayout.timer.padY * nonClassicScale));
      const timerDotSize = Math.max(4, Math.round(styleHudLayout.timer.dotSize * nonClassicScale));
      const timerGap = Math.max(4, Math.round(styleHudLayout.timer.gap * nonClassicScale));
      const timerFontSize = Math.max(12, Math.round(styleHudLayout.timer.fontSize * nonClassicScale));
      ctx.font = `900 ${timerFontSize}px "Consolas", "Courier New", monospace`;
      const timerTextWidth = ctx.measureText(timerTextValue).width;
      const timerBoxWidth = Math.max(
        Math.round(styleHudLayout.timer.minWidth * nonClassicScale),
        Math.ceil(timerPadX * 2 + timerDotSize + timerGap + timerTextWidth + Math.round(2 * nonClassicScale))
      );
      const timerBoxHeight = Math.max(
        Math.round(timerDotSize + timerPadY * 2 + Math.round(2 * nonClassicScale)),
        Math.round(timerFontSize + timerPadY * 2 + Math.round(2 * nonClassicScale))
      );
      const timerRect = resolveAnchoredRect(styleHudLayout.timer, timerBoxWidth, timerBoxHeight, headerRect, nonClassicScale);
      const timerRadius =
        visualTheme.timerShapeClass.includes('rounded-none')
          ? 0
          : visualTheme.timerShapeClass.includes('rounded-2xl')
          ? Math.round(14 * nonClassicScale)
          : visualTheme.timerShapeClass.includes('rounded-lg')
          ? Math.round(10 * nonClassicScale)
          : visualTheme.timerShapeClass.includes('rounded-md')
          ? Math.round(8 * nonClassicScale)
          : visualTheme.timerShapeClass.includes('rounded-sm')
          ? Math.round(5 * nonClassicScale)
          : Math.round(timerRect.height / 2);
      if (shouldShowHeaderTimer) {
        drawRoundedRect(
          ctx,
          { ...timerRect, radius: timerRadius },
          {
            fill: timerBackground,
            stroke: timerBorderColor,
            lineWidth: Math.max(2, Math.round(2 * nonClassicScale))
          }
        );
        ctx.beginPath();
        ctx.arc(
          timerRect.x + timerPadX + timerDotSize / 2,
          timerRect.y + timerRect.height / 2,
          timerDotSize / 2,
          0,
          Math.PI * 2
        );
        ctx.fillStyle = scene.timeLeft <= 2 ? '#FF0000' : accent;
        ctx.fill();
        ctx.fillStyle = timerTextColor;
        ctx.font = `900 ${timerFontSize}px "Consolas", "Courier New", monospace`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(
          timerTextValue,
          timerRect.x + timerPadX + timerDotSize + timerGap,
          timerRect.y + timerRect.height / 2 + 1
        );
      }

      if (shouldShowHeaderProgress) {
        const progressTrackWidth = Math.max(4, Math.round(styleHudLayout.progress.width * nonClassicScale));
        const progressTrackHeight = Math.max(4, Math.round(styleHudLayout.progress.height * nonClassicScale));
        const progressTrackRectBase = resolveAnchoredRect(
          styleHudLayout.progress,
          progressTrackWidth,
          progressTrackHeight,
          headerRect,
          nonClassicScale
        );
        const progressTrackRect: Rect = {
          ...progressTrackRectBase,
          radius: clamp(
            Math.round(styleHudLayout.progress.radius * nonClassicScale),
            0,
            Math.min(progressTrackRectBase.width, progressTrackRectBase.height) / 2
          )
        };
        drawRoundedRect(ctx, progressTrackRect, {
          fill: visualTheme.progressTrackBg,
          stroke: visualTheme.progressTrackBorder,
          lineWidth: Math.max(2, Math.round(2 * nonClassicScale))
        });
        const fillPercent = countdownPercent / 100;
        const progressFillRect: Rect =
          styleHudLayout.progress.orientation === 'vertical'
            ? {
                x: progressTrackRect.x,
                y: progressTrackRect.y + progressTrackRect.height * (1 - fillPercent),
                width: progressTrackRect.width,
                height: progressTrackRect.height * fillPercent,
                radius: progressTrackRect.radius
              }
            : {
                x: progressTrackRect.x,
                y: progressTrackRect.y,
                width: progressTrackRect.width * fillPercent,
                height: progressTrackRect.height,
                radius: progressTrackRect.radius
              };
        if (progressFillRect.width > 0 && progressFillRect.height > 0) {
          roundRectPath(ctx, progressFillRect);
          ctx.fillStyle = resolveProgressFill(ctx, progressFillRect, visualTheme.progressFill, accent);
          ctx.fill();
        }
      }
    }
  }

  drawRoundedRect(ctx, gameRect, {
    fill: isStorybookStyle ? '#1F475B' : gameBackground,
    stroke: isStorybookStyle ? '#3F301A' : '#000000',
    lineWidth: Math.max(2, 2 * uiScale)
  });
  ctx.save();
  roundRectPath(ctx, gameRect);
  ctx.clip();
  if (isStorybookStyle) {
    const gameGradient = ctx.createLinearGradient(gameRect.x, gameRect.y, gameRect.x, gameRect.y + gameRect.height);
    gameGradient.addColorStop(0, 'rgba(255,255,255,0.12)');
    gameGradient.addColorStop(1, 'rgba(0,0,0,0.18)');
    ctx.fillStyle = gameGradient;
    ctx.fillRect(gameRect.x, gameRect.y, gameRect.width, gameRect.height);
  } else {
    ctx.fillStyle = hexToRgba(visualTheme.patternColor, 0.12);
    const patternSpacing = Math.max(16, Math.round(26 * uiScale));
    const patternRadius = Math.max(1, Math.round(2 * uiScale));
    for (let y = gameRect.y; y <= gameRect.y + gameRect.height; y += patternSpacing) {
      for (let x = gameRect.x; x <= gameRect.x + gameRect.width; x += patternSpacing) {
        ctx.beginPath();
        ctx.arc(x, y, patternRadius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();

  if (shouldRenderPuzzlePanels) {
    const currentImages = loadedImages[scene.segment.puzzleIndex];
    if (!currentImages) {
      throw new Error('Missing puzzle images for frame render.');
    }

    let originalPanel: Rect;
    let modifiedPanel: Rect;

    let originalImageViewport: Rect;
    let modifiedImageViewport: Rect;

    if (isStorybookStyle) {
      if (isVerticalLayout) {
        const panelHeight = (gameRect.height - panelGap) / 2;
        originalPanel = {
          x: gameRect.x + Math.round(8 * uiScale),
          y: gameRect.y + Math.round(8 * uiScale),
          width: gameRect.width - Math.round(16 * uiScale),
          height: panelHeight - Math.round(12 * uiScale),
          radius: panelRadius
        };
        modifiedPanel = {
          x: originalPanel.x,
          y: originalPanel.y + originalPanel.height + panelGap,
          width: originalPanel.width,
          height: originalPanel.height,
          radius: panelRadius
        };
      } else {
        const panelWidth = (gameRect.width - panelGap) / 2;
        originalPanel = {
          x: gameRect.x + Math.round(8 * uiScale),
          y: gameRect.y + Math.round(8 * uiScale),
          width: panelWidth - Math.round(12 * uiScale),
          height: gameRect.height - Math.round(16 * uiScale),
          radius: panelRadius
        };
        modifiedPanel = {
          x: originalPanel.x + originalPanel.width + panelGap,
          y: originalPanel.y,
          width: originalPanel.width,
          height: originalPanel.height,
          radius: panelRadius
        };
      }

      const panelStrokeColor = '#CEC3A5';
      const panelStrokeWidth = Math.max(4, 4 * uiScale);
      const insetPanelViewport = (panel: Rect): Rect => {
        const inset = panelStrokeWidth;
        const innerWidth = Math.max(1, panel.width - inset * 2);
        const innerHeight = Math.max(1, panel.height - inset * 2);
        return {
          x: panel.x + inset,
          y: panel.y + inset,
          width: innerWidth,
          height: innerHeight,
          radius: Math.max(0, panel.radius - inset)
        };
      };

      originalImageViewport = insetPanelViewport(originalPanel);
      modifiedImageViewport = insetPanelViewport(modifiedPanel);

      drawRoundedRect(ctx, originalPanel, {
        fill: panelStrokeColor
      });
      drawRoundedRect(ctx, modifiedPanel, {
        fill: panelStrokeColor
      });
      drawRoundedRect(ctx, originalImageViewport, {
        fill: panelBackground
      });
      drawRoundedRect(ctx, modifiedImageViewport, {
        fill: panelBackground
      });
    } else {
      const contentRect: Rect = {
        x: gameRect.x + gamePadding,
        y: gameRect.y + gamePadding,
        width: Math.max(1, gameRect.width - gamePadding * 2),
        height: Math.max(1, gameRect.height - gamePadding * 2),
        radius: 0
      };

      if (isVerticalLayout) {
        const panelHeight = Math.max(1, (contentRect.height - panelGap) / 2);
        originalPanel = {
          x: contentRect.x,
          y: contentRect.y,
          width: contentRect.width,
          height: panelHeight,
          radius: panelRadius
        };
        modifiedPanel = {
          x: contentRect.x,
          y: contentRect.y + panelHeight + panelGap,
          width: contentRect.width,
          height: panelHeight,
          radius: panelRadius
        };
      } else {
        const panelWidth = Math.max(1, (contentRect.width - panelGap) / 2);
        originalPanel = {
          x: contentRect.x,
          y: contentRect.y,
          width: panelWidth,
          height: contentRect.height,
          radius: panelRadius
        };
        modifiedPanel = {
          x: contentRect.x + panelWidth + panelGap,
          y: contentRect.y,
          width: panelWidth,
          height: contentRect.height,
          radius: panelRadius
        };
      }

      originalImageViewport = originalPanel;
      modifiedImageViewport = modifiedPanel;
    }

    drawImageCover(ctx, currentImages.original, originalImageViewport);
    const modifiedCoverFrame = drawImageCover(ctx, currentImages.modified, modifiedImageViewport);

    if (scene.blinkOverlayActive && scene.blinkOverlayVisible) {
      ctx.save();
      roundRectPath(ctx, modifiedImageViewport);
      ctx.clip();
      ctx.drawImage(
        currentImages.original,
        modifiedCoverFrame.x,
        modifiedCoverFrame.y,
        modifiedCoverFrame.width,
        modifiedCoverFrame.height
      );
      ctx.restore();
    }

    if (isStorybookStyle && !isVerticalLayout) {
      const separatorX = originalPanel.x + originalPanel.width + panelGap / 2;
      ctx.fillStyle = hexToRgba('#5A4A2B', 0.45);
      ctx.fillRect(
        separatorX - Math.max(1, Math.round(1.5 * uiScale)),
        gameRect.y + Math.round(8 * uiScale),
        Math.max(2, Math.round(3 * uiScale)),
        gameRect.height - Math.round(16 * uiScale)
      );

      const badgeWidth = Math.max(36, Math.round(44 * uiScale));
      const badgeHeight = Math.max(16, Math.round(120 * uiScale));
      const badgeRect: Rect = {
        x: separatorX - badgeWidth / 2,
        y: gameRect.y + gameRect.height / 2 - badgeHeight / 2,
        width: badgeWidth,
        height: badgeHeight,
        radius: Math.round(8 * uiScale)
      };
      drawRoundedRect(ctx, badgeRect, {
        fill: '#D8B149',
        stroke: '#4D3E26',
        lineWidth: Math.max(2, 2 * uiScale)
      });
      ctx.save();
      ctx.translate(badgeRect.x + badgeRect.width / 2, badgeRect.y + badgeRect.height / 2);
      ctx.rotate(Math.PI / 2);
      ctx.fillStyle = '#3B2E1A';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `900 ${Math.max(9, Math.round(16 * uiScale))}px "Arial Black", "Segoe UI", sans-serif`;
      ctx.fillText('COMPARE', 0, 0);
      ctx.restore();

      const drawPanelTag = (panel: Rect, label: string, fill: string, text: string) => {
        const tagRect: Rect = {
          x: panel.x + Math.round(8 * uiScale),
          y: panel.y + Math.round(8 * uiScale),
          width: Math.round(95 * uiScale),
          height: Math.round(28 * uiScale),
          radius: Math.round(8 * uiScale)
        };
        drawRoundedRect(ctx, tagRect, { fill, stroke: '#4D3E26', lineWidth: Math.max(2, 2 * uiScale) });
        ctx.fillStyle = text;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `900 ${Math.max(9, Math.round(14 * uiScale))}px "Arial Black", "Segoe UI", sans-serif`;
        ctx.fillText(label, tagRect.x + tagRect.width / 2, tagRect.y + tagRect.height / 2 + 1);
      };

      drawPanelTag(originalPanel, 'ORIGINAL', '#F3E6C4', '#3B2E1A');
      drawPanelTag(modifiedPanel, 'MODIFIED', '#D37872', '#23180D');
    }

    const effectiveRevealVariant =
      settings.revealStyle === 'box'
        ? settings.revealVariant.startsWith('box_')
          ? settings.revealVariant
          : 'box_glow'
        : settings.revealStyle === 'circle'
        ? settings.revealVariant.startsWith('circle_')
          ? settings.revealVariant
          : 'circle_dotted'
        : 'highlight_soft';

    if (scene.segment.phase === 'revealing' && scene.revealedRegionCount > 0) {
      const visibleRegions = puzzles[scene.segment.puzzleIndex].regions.slice(0, scene.revealedRegionCount);
      const markerBoundsList = visibleRegions.map((region) =>
        getMarkerBounds(region, modifiedCoverFrame, currentImages.modified, settings, effectiveRevealVariant)
      );
      const usesPersistentSpotlight =
        settings.revealBehavior === 'spotlight' || settings.revealBehavior === 'cinematic_sequential';

      if (usesPersistentSpotlight) {
        ctx.save();
        roundRectPath(ctx, modifiedImageViewport);
        ctx.clip();
        ctx.fillStyle =
          settings.revealBehavior === 'cinematic_sequential'
            ? 'rgba(3,7,18,0.5)'
            : 'rgba(3,7,18,0.32)';
        ctx.fillRect(
          modifiedImageViewport.x,
          modifiedImageViewport.y,
          modifiedImageViewport.width,
          modifiedImageViewport.height
        );
        markerBoundsList.forEach((markerBounds, index) => {
          drawRevealSpotlightFill(
            ctx,
            markerBounds,
            settings,
            effectiveRevealVariant,
            index === markerBoundsList.length - 1,
            uiScale
          );
        });
        ctx.restore();
      }

      markerBoundsList.forEach((markerBounds) => {
        drawRevealMarker(ctx, markerBounds, settings, effectiveRevealVariant, uiScale);
      });
    }

  }

  if (
    scene.segment.phase === 'intro' ||
    scene.segment.phase === 'transitioning' ||
    scene.segment.phase === 'outro'
  ) {
    drawSceneCard(ctx, gameRect, scene, settings, visualTheme, isVerticalLayout, uiScale);
  }
};

const postMessageToMain = (message: WorkerResponse, transfer: Transferable[] = []) => {
  (self as any).postMessage(message, transfer);
};

const renderPreviewFrameInWorker = async ({
  puzzles,
  settings,
  timestamp
}: PreviewFrameOptions): Promise<{ buffer: ArrayBuffer; mimeType: string }> => {
  if (!puzzles.length) throw new Error('No puzzles available for preview.');

  const { width, height } = getExportDimensions(settings.aspectRatio, settings.exportResolution);
  const timeline = buildTimeline(puzzles, settings);
  const totalDuration = timeline.length > 0 ? timeline[timeline.length - 1].end : 0;
  const safeTimestamp =
    totalDuration > 0 ? clamp(timestamp, 0, Math.max(0, totalDuration - 1 / FPS)) : 0;
  const scene = getSceneAtTime(safeTimestamp, timeline, puzzles, settings);

  const loadedImages: Array<LoadedPuzzleImages | null> = new Array(puzzles.length).fill(null);
  const sceneNeedsImages = scene.segment.phase !== 'intro' && scene.segment.phase !== 'outro';

  if (sceneNeedsImages) {
    const puzzle = puzzles[scene.segment.puzzleIndex];
    const [original, modified] = await Promise.all([loadImage(puzzle.imageA), loadImage(puzzle.imageB)]);
    loadedImages[scene.segment.puzzleIndex] = {
      original,
      modified
    };
  }
  const brandLogo = settings.logo
    ? await processLogoBitmap(await loadImage(settings.logo), settings)
    : null;
  throwIfCanceled();

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Unable to initialize canvas renderer for preview.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  drawFrame(
    ctx as unknown as CanvasRenderingContext2D,
    width,
    height,
    puzzles,
    loadedImages,
    brandLogo,
    settings,
    scene
  );
  throwIfCanceled();

  const blob = await canvas.convertToBlob({ type: 'image/png' });
  throwIfCanceled();

  return {
    buffer: await blob.arrayBuffer(),
    mimeType: blob.type || 'image/png'
  };
};

const exportVideoInWorker = async ({
  puzzles,
  settings,
  streamOutput = false,
  onProgress
}: ExportVideoOptions): Promise<
  | { mode: 'buffer'; buffer: ArrayBuffer; fileName: string; mimeType: string }
  | { mode: 'stream'; fileName: string; mimeType: string }
> => {
  if (!puzzles.length) throw new Error('No puzzles available for export.');

  const { width, height } = getExportDimensions(settings.aspectRatio, settings.exportResolution);
  const timeline = buildTimeline(puzzles, settings);
  const totalDuration = timeline.length > 0 ? timeline[timeline.length - 1].end : 0;
  if (totalDuration <= 0) throw new Error('Video duration is zero. Increase show/reveal timings and try again.');

  const totalFrames = Math.max(1, Math.ceil(totalDuration * FPS));
  const bitrate = Math.max(500_000, Math.round(settings.exportBitrateMbps * 1_000_000));
  const codecConfig = FORMAT_BY_CODEC[settings.exportCodec];

  const canEncode = await canEncodeVideo(codecConfig.codec, { width, height, bitrate });
  if (!canEncode) {
    throw new Error(
      `Your browser could not encode ${settings.exportCodec.toUpperCase()} at ${settings.exportResolution}. Try a lower resolution/bitrate or switch codec.`
    );
  }
  throwIfCanceled();

  onProgress?.(0, 'Loading puzzle images...');
  const imageCache = new Map<string, ImageBitmap>();
  const getImage = async (src: string) => {
    const cached = imageCache.get(src);
    if (cached) return cached;
    const loaded = await loadImage(src);
    imageCache.set(src, loaded);
    return loaded;
  };

  const loadedImages: Array<LoadedPuzzleImages | null> = [];
  for (let index = 0; index < puzzles.length; index += 1) {
    const puzzle = puzzles[index];
    const [original, modified] = await Promise.all([getImage(puzzle.imageA), getImage(puzzle.imageB)]);
    loadedImages.push({
      original,
      modified
    });
    onProgress?.((index + 1) / (puzzles.length * 12), `Loaded images ${index + 1}/${puzzles.length}`);
    throwIfCanceled();
  }
  const brandLogo = settings.logo
    ? await processLogoBitmap(await getImage(settings.logo), settings)
    : null;

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Unable to initialize canvas renderer for export.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const target = streamOutput
    ? new StreamTarget(
        new WritableStream({
          write: async (chunk: { type: 'write'; data: Uint8Array; position: number }) => {
            const payload =
              chunk.data.byteOffset === 0 && chunk.data.byteLength === chunk.data.buffer.byteLength
                ? chunk.data
                : chunk.data.slice();
            postMessageToMain(
              {
                type: 'stream-chunk',
                position: chunk.position,
                data: payload.buffer
              },
              [payload.buffer]
            );
          }
        }),
        {
          chunked: true,
          chunkSize: 16 * 1024 * 1024
        }
      )
    : new BufferTarget();
  const output = new Output({
    format: codecConfig.format,
    target
  });
  const videoSource = new CanvasSource(canvas, {
    codec: codecConfig.codec,
    bitrate,
    bitrateMode: 'constant',
    latencyMode: 'quality',
    contentHint: 'detail'
  });
  output.addVideoTrack(videoSource, { frameRate: FPS });

  onProgress?.(0.1, 'Starting encoder...');
  await output.start();
  throwIfCanceled();

  const progressStep = Math.max(1, Math.floor(totalFrames / 150));
  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
    const timestamp = frameIndex / FPS;
    const scene = getSceneAtTime(timestamp, timeline, puzzles, settings);
    drawFrame(
      ctx as unknown as CanvasRenderingContext2D,
      width,
      height,
      puzzles,
      loadedImages,
      brandLogo,
      settings,
      scene
    );
    await videoSource.add(timestamp, 1 / FPS);
    throwIfCanceled();

    if (frameIndex % progressStep === 0 || frameIndex === totalFrames - 1) {
      const exportProgress = 0.1 + ((frameIndex + 1) / totalFrames) * 0.85;
      onProgress?.(exportProgress, `Encoding frame ${frameIndex + 1}/${totalFrames}`);
    }
  }

  onProgress?.(0.96, 'Finalizing file...');
  await output.finalize();
  throwIfCanceled();

  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
    now.getDate()
  ).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(
    2,
    '0'
  )}${String(now.getSeconds()).padStart(2, '0')}`;
  const fileName = `spotitnow-${settings.aspectRatio.replace(':', 'x')}-${settings.exportResolution}-${settings.exportCodec}-${stamp}.${codecConfig.extension}`;

  if (streamOutput) {
    return {
      mode: 'stream',
      fileName,
      mimeType: codecConfig.mimeType
    };
  }

  const buffer = (target as BufferTarget).buffer;
  if (!buffer) throw new Error('Failed to build exported video buffer.');
  return {
    mode: 'buffer',
    buffer,
    fileName,
    mimeType: codecConfig.mimeType
  };
};

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;

  if (message.type === 'cancel') {
    isCanceled = true;
    return;
  }

  if (message.type !== 'start' && message.type !== 'preview-frame') return;

  isCanceled = false;

  try {
    if (message.type === 'preview-frame') {
      const result = await renderPreviewFrameInWorker(message.payload);
      postMessageToMain(
        {
          type: 'preview-frame-done',
          buffer: result.buffer,
          mimeType: result.mimeType
        },
        [result.buffer]
      );
    } else {
      const { puzzles, settings, streamOutput } = message.payload;
      const result = await exportVideoInWorker({
        puzzles,
        settings,
        streamOutput,
        onProgress: (progress, status) => {
          postMessageToMain({ type: 'progress', progress, status });
        }
      });

      if (result.mode === 'stream') {
        postMessageToMain({
          type: 'stream-done',
          fileName: result.fileName,
          mimeType: result.mimeType
        });
      } else {
        postMessageToMain(
          {
            type: 'done',
            buffer: result.buffer,
            fileName: result.fileName,
            mimeType: result.mimeType
          },
          [result.buffer]
        );
      }
    }
  } catch (error) {
    const fallbackMessage =
      message.type === 'preview-frame' ? 'Preview frame render failed.' : 'Video export failed.';
    const messageText = error instanceof Error ? error.message : fallbackMessage;
    if (messageText === '__EXPORT_CANCELED__') {
      postMessageToMain({ type: 'cancelled' });
    } else {
      postMessageToMain({ type: 'error', message: messageText });
    }
  } finally {
    isCanceled = false;
  }
};
