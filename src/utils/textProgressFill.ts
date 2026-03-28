export interface TextProgressThemeColors {
  timerDot: string;
  headerBg: string;
  completionBg: string;
}

export interface TextProgressFillColors {
  start: string;
  middle: string;
  end: string;
}

export interface TextProgressSpan {
  left: number;
  width: number;
}

export interface TextProgressFillSpan extends TextProgressSpan {
  fillRatio: number;
  fillWidth: number;
}

export const TEXT_PROGRESS_EMPTY_FILL = '#FFFFFF';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const smoothstep = (edge0: number, edge1: number, value: number) => {
  if (edge0 === edge1) {
    return value < edge0 ? 0 : 1;
  }
  const normalized = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
};

const normalizeHex = (hex: string) => {
  const value = hex.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(value)) {
    return value;
  }
  if (/^#[0-9a-fA-F]{3}$/.test(value)) {
    const [, a = '0', b = '0', c = '0'] = value;
    return `#${a}${a}${b}${b}${c}${c}`;
  }
  return '#000000';
};

const hexToRgb = (hex: string) => {
  const normalized = normalizeHex(hex).slice(1);
  return {
    red: Number.parseInt(normalized.slice(0, 2), 16),
    green: Number.parseInt(normalized.slice(2, 4), 16),
    blue: Number.parseInt(normalized.slice(4, 6), 16)
  };
};

const toHex = (value: number) => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0');

const mixHexColor = (from: string, to: string, amount: number) => {
  const start = hexToRgb(from);
  const end = hexToRgb(to);
  const blend = clamp(amount, 0, 1);
  return `#${toHex(start.red + (end.red - start.red) * blend)}${toHex(start.green + (end.green - start.green) * blend)}${toHex(
    start.blue + (end.blue - start.blue) * blend
  )}`;
};

const mixPalette = (from: TextProgressFillColors, to: TextProgressFillColors, amount: number): TextProgressFillColors => ({
  start: mixHexColor(from.start, to.start, amount),
  middle: mixHexColor(from.middle, to.middle, amount),
  end: mixHexColor(from.end, to.end, amount)
});

let textProgressMeasureCanvas: HTMLCanvasElement | null = null;

const resolveMeasuredTextProgressWidth = (
  containerWidth: number,
  metricsOrWidth:
    | number
    | Pick<TextMetrics, 'width' | 'actualBoundingBoxLeft' | 'actualBoundingBoxRight'>
) => {
  if (typeof metricsOrWidth === 'number') {
    return Math.max(1, Math.min(containerWidth, metricsOrWidth));
  }

  return Math.max(
    1,
    Math.min(
      containerWidth,
      Math.max(
        metricsOrWidth.width,
        (metricsOrWidth.actualBoundingBoxLeft || 0) + (metricsOrWidth.actualBoundingBoxRight || 0)
      )
    )
  );
};

export const resolveTextProgressSpanFromMetrics = (
  containerWidth: number,
  metricsOrWidth:
    | number
    | Pick<TextMetrics, 'width' | 'actualBoundingBoxLeft' | 'actualBoundingBoxRight'>
): TextProgressSpan => {
  const safeWidth = Math.max(1, containerWidth);
  const measuredWidth = resolveMeasuredTextProgressWidth(safeWidth, metricsOrWidth);
  return {
    left: Math.max(0, (safeWidth - measuredWidth) / 2),
    width: measuredWidth
  };
};

export const measureTextProgressSpan = (
  text: string,
  containerWidth: number,
  fontSize: number,
  fontFamily: string,
  fontWeight: number | string
): TextProgressSpan => {
  const safeWidth = Math.max(1, containerWidth);
  if (typeof document === 'undefined') {
    return { left: 0, width: safeWidth };
  }

  textProgressMeasureCanvas ??= document.createElement('canvas');
  const ctx = textProgressMeasureCanvas.getContext('2d');
  if (!ctx) {
    return { left: 0, width: safeWidth };
  }

  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  return resolveTextProgressSpanFromMetrics(safeWidth, ctx.measureText(text.trim() || 'PROGRESS'));
};

export const resolveTextProgressFillSpan = (
  span: TextProgressSpan,
  fillRatio: number
): TextProgressFillSpan => {
  const safeWidth = Math.max(1, span.width);
  const clampedRatio = clamp(fillRatio, 0, 1);
  return {
    left: span.left,
    width: safeWidth,
    fillRatio: clampedRatio,
    fillWidth: safeWidth * clampedRatio
  };
};

export const resolveSmoothTextProgressFillColors = (
  remainingPercent: number,
  theme: TextProgressThemeColors,
  dynamicColors?: TextProgressFillColors | null
): TextProgressFillColors => {
  if (dynamicColors) {
    return dynamicColors;
  }

  const urgency = 1 - clamp(remainingPercent, 0, 100) / 100;
  const safePalette: TextProgressFillColors = {
    start: theme.timerDot,
    middle: theme.headerBg,
    end: theme.completionBg
  };
  const warmPalette: TextProgressFillColors = {
    start: mixHexColor(theme.timerDot, '#FACC15', 0.48),
    middle: mixHexColor(theme.completionBg, '#F59E0B', 0.52),
    end: mixHexColor(theme.completionBg, '#EF4444', 0.34)
  };
  const dangerPalette: TextProgressFillColors = {
    start: '#FACC15',
    middle: '#F97316',
    end: '#EF4444'
  };

  const warmedPalette = mixPalette(safePalette, warmPalette, smoothstep(0.12, 0.62, urgency));
  return mixPalette(warmedPalette, dangerPalette, smoothstep(0.58, 0.98, urgency));
};
