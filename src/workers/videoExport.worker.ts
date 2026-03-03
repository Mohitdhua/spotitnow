import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
  canEncodeVideo
} from 'mediabunny';
import { Puzzle, Region, VideoSettings } from '../types';
import { VISUAL_THEMES } from '../constants/videoThemes';

type FramePhase = 'showing' | 'revealing' | 'transitioning';

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
  revealedRegionCount: number;
  blinkOverlayActive: boolean;
  blinkOverlayVisible: boolean;
  title: string;
}

interface ExportVideoOptions {
  puzzles: Puzzle[];
  settings: VideoSettings;
  onProgress?: (progress: number, status?: string) => void;
}

interface WorkerStartMessage {
  type: 'start';
  payload: {
    puzzles: Puzzle[];
    settings: VideoSettings;
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
  options: { fill?: string; stroke?: string; lineWidth?: number }
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

  if (aspectRatio === '16:9') {
    return { width: even((baseHeight * 16) / 9), height: even(baseHeight) };
  }

  if (aspectRatio === '9:16') {
    return { width: even(baseHeight), height: even((baseHeight * 16) / 9) };
  }

  if (aspectRatio === '4:3') {
    return { width: even((baseHeight * 4) / 3), height: even(baseHeight) };
  }

  return { width: even(baseHeight), height: even(baseHeight) };
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

const buildTimeline = (puzzles: Puzzle[], settings: VideoSettings): TimelineSegment[] => {
  const showDuration = Math.max(0.1, settings.showDuration);
  const revealDuration = Math.max(0.5, settings.revealDuration);
  const transitionDuration = Math.max(0, settings.transitionDuration);

  let cursor = 0;
  const timeline: TimelineSegment[] = [];

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

  let revealedRegionCount = 0;
  let blinkOverlayActive = false;
  let blinkOverlayVisible = false;
  let title = 'Find Differences';

  if (segment.phase === 'revealing') {
    const revealPhaseDuration = Math.max(0.5, settings.revealDuration);
    const revealRegionCount = puzzle.regions.length;
    const revealStepSeconds = Math.min(
      Math.max(0.5, settings.sequentialRevealStep),
      revealPhaseDuration / Math.max(1, revealRegionCount + 1)
    );
    const revealBlinkStartTime = revealRegionCount * revealStepSeconds;
    const revealElapsed = clamp(phaseElapsed, 0, revealPhaseDuration);

    revealedRegionCount =
      revealRegionCount > 0 ? Math.min(revealRegionCount, Math.floor(revealElapsed / revealStepSeconds) + 1) : 0;

    blinkOverlayActive = revealRegionCount > 0 && revealElapsed >= revealBlinkStartTime;
    if (blinkOverlayActive) {
      const halfCycle = Math.max(0.05, Math.max(0.2, settings.blinkSpeed) / 2);
      const blinkElapsed = revealElapsed - revealBlinkStartTime;
      blinkOverlayVisible = Math.floor(blinkElapsed / halfCycle) % 2 === 0;
    }

    title = blinkOverlayActive ? 'Blink Compare' : 'Revealing...';
  } else if (segment.phase === 'transitioning') {
    title = 'Next Puzzle';
  }

  return {
    segment,
    phaseElapsed,
    timeLeft,
    progressPercent,
    revealedRegionCount,
    blinkOverlayActive,
    blinkOverlayVisible,
    title
  };
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

const drawFrame = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  puzzles: Puzzle[],
  loadedImages: LoadedPuzzleImages[],
  settings: VideoSettings,
  scene: RenderScene
) => {
  const styleSupportedAspectRatio = settings.aspectRatio === '16:9' || settings.aspectRatio === '9:16';
  const visualStyle = styleSupportedAspectRatio ? settings.visualStyle : 'classic';
  const visualTheme = VISUAL_THEMES[visualStyle];
  const accent = visualTheme.timerDot;
  const isVerticalLayout = settings.aspectRatio === '9:16' || settings.aspectRatio === '1:1';
  const uiScale = clamp(Math.min(width, height) / 1080, 0.55, 2.2);

  const rootBackground = visualTheme.rootBg;
  const boardBackground = '#FFFFFF';
  const boardStroke = '#000000';
  const headerBackground = visualTheme.headerBg;
  const gameBackground = visualTheme.gameBg;
  const panelBackground = visualTheme.imagePanelBg;
  const timerBackground = visualTheme.timerBg;
  const timerTextColor = visualTheme.timerText;
  const timerBorderColor = visualTheme.timerBorder;

  const outerPad = Math.round(28 * uiScale);
  const board: Rect = {
    x: outerPad,
    y: outerPad,
    width: width - outerPad * 2,
    height: height - outerPad * 2,
    radius: Math.round(24 * uiScale)
  };
  const boardStrokeWidth = Math.max(4, 4 * uiScale);
  const headerHeight = Math.round(board.height * 0.17);
  const contentPadding = Math.round(18 * uiScale);
  const gameRect: Rect = {
    x: board.x + contentPadding,
    y: board.y + headerHeight + contentPadding,
    width: board.width - contentPadding * 2,
    height: board.height - headerHeight - contentPadding * 2
  };
  const panelGap = Math.round(14 * uiScale);
  const panelRadius = Math.round(14 * uiScale);

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

  const puzzleLabel = `Puzzle ${scene.segment.puzzleIndex + 1} / ${puzzles.length}`;
  const titleFontSize = Math.max(18, Math.round(34 * uiScale));
  const subtitleFontSize = Math.max(11, Math.round(14 * uiScale));
  const timerBoxWidth = Math.round(178 * uiScale);
  const timerBoxHeight = Math.round(58 * uiScale);
  const timerBoxX = board.x + board.width - contentPadding - timerBoxWidth;
  const timerBoxY = board.y + Math.round((headerHeight - timerBoxHeight) / 2);

  ctx.fillStyle = visualTheme.headerText;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = `900 ${titleFontSize}px "Arial Black", "Segoe UI", sans-serif`;
  ctx.fillText(scene.title, board.x + contentPadding, board.y + Math.round(16 * uiScale));
  ctx.fillStyle = visualTheme.headerSubText;
  ctx.font = `700 ${subtitleFontSize}px "Segoe UI", Arial, sans-serif`;
  ctx.fillText(puzzleLabel, board.x + contentPadding, board.y + Math.round(16 * uiScale) + titleFontSize + Math.round(2 * uiScale));

  drawRoundedRect(
    ctx,
    { x: timerBoxX, y: timerBoxY, width: timerBoxWidth, height: timerBoxHeight, radius: Math.round(28 * uiScale) },
    { fill: timerBackground, stroke: timerBorderColor, lineWidth: Math.max(2, 2 * uiScale) }
  );
  ctx.beginPath();
  ctx.arc(
    timerBoxX + Math.round(26 * uiScale),
    timerBoxY + timerBoxHeight / 2,
    Math.max(4, 6 * uiScale),
    0,
    Math.PI * 2
  );
  ctx.fillStyle = scene.timeLeft <= 2 ? '#FF0000' : accent;
  ctx.fill();
  ctx.fillStyle = timerTextColor;
  ctx.font = `900 ${Math.max(14, Math.round(21 * uiScale))}px "Consolas", "Courier New", monospace`;
  ctx.textBaseline = 'middle';
  ctx.fillText(
    `${scene.timeLeft.toFixed(1)}s`,
    timerBoxX + Math.round(42 * uiScale),
    timerBoxY + timerBoxHeight / 2 + 1
  );

  const progressTrackHeight = Math.max(8, Math.round(11 * uiScale));
  const progressTrackWidth = Math.round(board.width * 0.36);
  const progressTrackX = timerBoxX - progressTrackWidth - Math.round(18 * uiScale);
  const progressTrackY = timerBoxY + Math.round((timerBoxHeight - progressTrackHeight) / 2);
  const progressTrackRect: Rect = {
    x: progressTrackX,
    y: progressTrackY,
    width: progressTrackWidth,
    height: progressTrackHeight,
    radius: progressTrackHeight / 2
  };
  drawRoundedRect(ctx, progressTrackRect, {
    fill: visualTheme.progressTrackBg,
    stroke: visualTheme.progressTrackBorder,
    lineWidth: Math.max(2, 2 * uiScale)
  });
  const progressFillRect: Rect = {
    x: progressTrackX,
    y: progressTrackY,
    width: (progressTrackWidth * clamp(scene.progressPercent, 0, 100)) / 100,
    height: progressTrackHeight,
    radius: progressTrackHeight / 2
  };
  if (progressFillRect.width > 0) {
    roundRectPath(ctx, progressFillRect);
    ctx.fillStyle = resolveProgressFill(ctx, progressFillRect, visualTheme.progressFill, accent);
    ctx.fill();
  }

  drawRoundedRect(ctx, gameRect, { fill: gameBackground, stroke: '#000000', lineWidth: Math.max(2, 2 * uiScale) });
  ctx.save();
  roundRectPath(ctx, gameRect);
  ctx.clip();
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
  ctx.restore();

  let originalPanel: Rect;
  let modifiedPanel: Rect;

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

  drawRoundedRect(ctx, originalPanel, { fill: panelBackground, stroke: '#000000', lineWidth: Math.max(3, 3 * uiScale) });
  drawRoundedRect(ctx, modifiedPanel, { fill: panelBackground, stroke: '#000000', lineWidth: Math.max(3, 3 * uiScale) });

  const currentImages = loadedImages[scene.segment.puzzleIndex];
  const originalCoverFrame = drawImageCover(ctx, currentImages.original, originalPanel);
  const modifiedCoverFrame = drawImageCover(ctx, currentImages.modified, modifiedPanel);

  if (scene.blinkOverlayActive && scene.blinkOverlayVisible) {
    ctx.save();
    roundRectPath(ctx, modifiedPanel);
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
    visibleRegions.forEach((region) => {
      const markerBounds = getMarkerBounds(
        region,
        modifiedCoverFrame,
        currentImages.modified,
        settings,
        effectiveRevealVariant
      );
      drawRevealMarker(ctx, markerBounds, settings, effectiveRevealVariant, uiScale);
    });
  }

  if (scene.segment.phase === 'transitioning') {
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    roundRectPath(ctx, gameRect);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `900 ${Math.max(24, Math.round(46 * uiScale))}px "Arial Black", "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('NEXT PUZZLE', gameRect.x + gameRect.width / 2, gameRect.y + gameRect.height / 2);
    ctx.restore();
  }

  void originalCoverFrame;
};

const postMessageToMain = (message: WorkerResponse, transfer: Transferable[] = []) => {
  (self as any).postMessage(message, transfer);
};

const exportVideoInWorker = async ({
  puzzles,
  settings,
  onProgress
}: ExportVideoOptions): Promise<{ buffer: ArrayBuffer; fileName: string; mimeType: string }> => {
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

  const loadedImages: LoadedPuzzleImages[] = [];
  for (let index = 0; index < puzzles.length; index += 1) {
    const puzzle = puzzles[index];
    const [original, modified] = await Promise.all([getImage(puzzle.imageA), getImage(puzzle.imageB)]);
    loadedImages.push({ original, modified });
    onProgress?.((index + 1) / (puzzles.length * 12), `Loaded images ${index + 1}/${puzzles.length}`);
    throwIfCanceled();
  }

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
    frameRate: FPS,
    bitrateMode: 'constant',
    latencyMode: 'quality',
    contentHint: 'detail'
  });
  output.addVideoTrack(videoSource);

  onProgress?.(0.1, 'Starting encoder...');
  await output.start();
  throwIfCanceled();

  const progressStep = Math.max(1, Math.floor(totalFrames / 150));
  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
    const timestamp = frameIndex / FPS;
    const scene = getSceneAtTime(timestamp, timeline, puzzles, settings);
    drawFrame(ctx, width, height, puzzles, loadedImages, settings, scene);
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

  const buffer = target.buffer;
  if (!buffer) throw new Error('Failed to build exported video buffer.');

  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
    now.getDate()
  ).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(
    2,
    '0'
  )}${String(now.getSeconds()).padStart(2, '0')}`;
  const fileName = `spotitnow-${settings.aspectRatio.replace(':', 'x')}-${settings.exportResolution}-${settings.exportCodec}-${stamp}.${codecConfig.extension}`;
  return {
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

  if (message.type !== 'start') return;

  isCanceled = false;

  try {
    const { puzzles, settings } = message.payload;
    const result = await exportVideoInWorker({
      puzzles,
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
    const messageText = error instanceof Error ? error.message : 'Video export failed.';
    if (messageText === '__EXPORT_CANCELED__') {
      postMessageToMain({ type: 'cancelled' });
    } else {
      postMessageToMain({ type: 'error', message: messageText });
    }
  } finally {
    isCanceled = false;
  }
};
