import type { GeneratedProgressBarStyle } from '../types';
import type { TextProgressFillColors } from './textProgressFill';

export interface TextProgressEffectBand {
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  color: string;
  opacity: number;
}

export interface TextProgressEffectOrb {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  color: string;
  opacity: number;
}

export interface TextProgressShellStyle {
  fill: string;
  stroke: string;
  strokeScale: number;
  fontScale: number;
}

export interface TextProgressEffectFrame {
  bands: TextProgressEffectBand[];
  orbs: TextProgressEffectOrb[];
}

interface ResolveTextProgressEffectFrameOptions {
  style: GeneratedProgressBarStyle | null;
  width: number;
  height: number;
  fillX: number;
  fillWidth: number;
  spanWidth: number;
  fillRatio: number;
  animationSeconds: number;
  fillColors: TextProgressFillColors;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const normalizeHex = (value: string) => {
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed;
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
  }
  return '#000000';
};

const hexToRgb = (value: string) => {
  const normalized = normalizeHex(value).slice(1);
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
  return `#${toHex(start.red + (end.red - start.red) * blend)}${toHex(
    start.green + (end.green - start.green) * blend
  )}${toHex(start.blue + (end.blue - start.blue) * blend)}`;
};

const loop = (value: number) => {
  const remainder = value % 1;
  return remainder < 0 ? remainder + 1 : remainder;
};

const emptyFrame = (): TextProgressEffectFrame => ({
  bands: [],
  orbs: []
});

const createBand = (
  x: number,
  y: number,
  width: number,
  height: number,
  angle: number,
  color: string,
  opacity: number
): TextProgressEffectBand => ({
  x,
  y,
  width,
  height,
  angle,
  color,
  opacity
});

const createOrb = (
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: string,
  opacity: number
): TextProgressEffectOrb => ({
  cx,
  cy,
  rx,
  ry,
  color,
  opacity
});

const buildVoltageFrame = (
  width: number,
  height: number,
  fillX: number,
  fillWidth: number,
  fillRatio: number,
  animationSeconds: number,
  fillColors: TextProgressFillColors
): TextProgressEffectFrame => {
  const urgency = 1 - fillRatio;
  const bandWidth = Math.max(10, fillWidth * 0.09);
  const bandHeight = height * 1.35;
  const sweepA = fillX + fillWidth * loop(animationSeconds * 0.92);
  const sweepB = fillX + fillWidth * loop(animationSeconds * 1.26 + 0.32);
  const sweepC = fillX + fillWidth * loop(animationSeconds * 1.58 + 0.68);
  const headX = fillX + fillWidth;
  return {
    bands: [
      createBand(sweepA, height * 0.5, bandWidth, bandHeight, -28, '#FFFFFF', 0.2 + urgency * 0.1),
      createBand(sweepB, height * 0.48, bandWidth * 0.9, bandHeight * 0.92, -24, '#67E8F9', 0.2 + urgency * 0.12),
      createBand(sweepC, height * 0.52, bandWidth * 0.7, bandHeight * 0.88, -32, '#A3E635', 0.14 + urgency * 0.08)
    ],
    orbs: [
      createOrb(
        headX - Math.max(8, fillWidth * 0.06),
        height * 0.5,
        Math.max(18, fillWidth * 0.12),
        height * 0.58,
        '#FFFFFF',
        0.12 + urgency * 0.12
      ),
      createOrb(
        headX - Math.max(10, fillWidth * 0.09),
        height * 0.5,
        Math.max(14, fillWidth * 0.08),
        height * 0.42,
        fillColors.middle,
        0.18 + urgency * 0.12
      )
    ]
  };
};

const buildSunburstFrame = (
  width: number,
  height: number,
  fillX: number,
  fillWidth: number,
  fillRatio: number,
  animationSeconds: number
): TextProgressEffectFrame => {
  const urgency = 1 - fillRatio;
  const flareX = fillX + fillWidth * loop(animationSeconds * 0.38 + 0.18);
  const warmBandWidth = Math.max(26, fillWidth * 0.22);
  const headX = fillX + fillWidth;
  return {
    bands: [
      createBand(flareX, height * 0.5, warmBandWidth, height * 1.55, -18, '#FFF1A8', 0.18 + urgency * 0.12),
      createBand(
        headX - Math.max(16, fillWidth * 0.1),
        height * 0.52,
        Math.max(14, fillWidth * 0.12),
        height * 1.18,
        -10,
        '#FFFFFF',
        0.12 + urgency * 0.08
      )
    ],
    orbs: [
      createOrb(
        headX - Math.max(18, fillWidth * 0.1),
        height * 0.36,
        Math.max(18, fillWidth * 0.1),
        height * 0.28,
        '#FFE082',
        0.14 + urgency * 0.1
      ),
      createOrb(
        headX - Math.max(10, fillWidth * 0.06),
        height * 0.66,
        Math.max(16, fillWidth * 0.08),
        height * 0.22,
        '#FFD54F',
        0.12 + urgency * 0.08
      )
    ]
  };
};

const buildHyperpopFrame = (
  width: number,
  height: number,
  fillX: number,
  fillWidth: number,
  fillRatio: number,
  animationSeconds: number
): TextProgressEffectFrame => {
  const urgency = 1 - fillRatio;
  const bandWidth = Math.max(12, fillWidth * 0.1);
  const headX = fillX + fillWidth;
  return {
    bands: [
      createBand(
        fillX + fillWidth * loop(animationSeconds * 0.82),
        height * 0.44,
        bandWidth,
        height * 1.2,
        -26,
        '#22D3EE',
        0.18 + urgency * 0.1
      ),
      createBand(
        fillX + fillWidth * loop(animationSeconds * 1.08 + 0.26),
        height * 0.56,
        bandWidth * 0.95,
        height * 1.14,
        -18,
        '#F472B6',
        0.18 + urgency * 0.1
      ),
      createBand(
        fillX + fillWidth * loop(animationSeconds * 1.34 + 0.52),
        height * 0.5,
        bandWidth * 0.72,
        height * 0.96,
        -34,
        '#A3E635',
        0.14 + urgency * 0.08
      )
    ],
    orbs: [
      createOrb(
        fillX + fillWidth * loop(animationSeconds * 0.74 + 0.15),
        height * 0.22,
        Math.max(9, fillWidth * 0.04),
        Math.max(8, height * 0.12),
        '#FFFFFF',
        0.1 + urgency * 0.06
      ),
      createOrb(
        headX - Math.max(10, fillWidth * 0.05),
        height * 0.76,
        Math.max(12, fillWidth * 0.05),
        Math.max(8, height * 0.14),
        '#F9A8D4',
        0.16 + urgency * 0.08
      )
    ]
  };
};

const buildLaserFrame = (
  width: number,
  height: number,
  fillX: number,
  fillWidth: number,
  fillRatio: number,
  animationSeconds: number
): TextProgressEffectFrame => {
  const urgency = 1 - fillRatio;
  const scanX = fillX + fillWidth * loop(animationSeconds * 1.65 + 0.24);
  const headX = fillX + fillWidth;
  return {
    bands: [
      createBand(
        scanX,
        height * 0.5,
        Math.max(8, fillWidth * 0.05),
        height * 1.7,
        0,
        '#FFFFFF',
        0.2 + urgency * 0.12
      ),
      createBand(
        headX - Math.max(8, fillWidth * 0.04),
        height * 0.5,
        Math.max(10, fillWidth * 0.08),
        height * 1.3,
        0,
        '#A855F7',
        0.12 + urgency * 0.08
      )
    ],
    orbs: [
      createOrb(
        headX - Math.max(12, fillWidth * 0.06),
        height * 0.5,
        Math.max(20, fillWidth * 0.13),
        height * 0.42,
        '#38BDF8',
        0.12 + urgency * 0.08
      )
    ]
  };
};

const buildToxicFrame = (
  width: number,
  height: number,
  fillX: number,
  fillWidth: number,
  fillRatio: number,
  animationSeconds: number,
  fillColors: TextProgressFillColors
): TextProgressEffectFrame => {
  const urgency = 1 - fillRatio;
  const drift = loop(animationSeconds * 0.42);
  const headX = fillX + fillWidth;
  return {
    bands: [
      createBand(
        headX - Math.max(18, fillWidth * 0.12),
        height * 0.58,
        Math.max(18, fillWidth * 0.16),
        height * 1.05,
        -8,
        '#D9F99D',
        0.14 + urgency * 0.08
      )
    ],
    orbs: [
      createOrb(
        fillX + fillWidth * loop(animationSeconds * 0.54 + 0.11),
        height * (0.28 + drift * 0.12),
        Math.max(10, fillWidth * 0.05),
        Math.max(7, height * 0.12),
        '#A3E635',
        0.14 + urgency * 0.08
      ),
      createOrb(
        fillX + fillWidth * loop(animationSeconds * 0.66 + 0.43),
        height * (0.7 - drift * 0.14),
        Math.max(14, fillWidth * 0.08),
        Math.max(10, height * 0.16),
        fillColors.middle,
        0.14 + urgency * 0.1
      ),
      createOrb(
        headX - Math.max(10, fillWidth * 0.06),
        height * 0.5,
        Math.max(18, fillWidth * 0.11),
        Math.max(14, height * 0.26),
        '#ECFCCB',
        0.12 + urgency * 0.1
      )
    ]
  };
};

const buildInfernoFrame = (
  width: number,
  height: number,
  fillX: number,
  fillWidth: number,
  fillRatio: number,
  animationSeconds: number
): TextProgressEffectFrame => {
  const urgency = 1 - fillRatio;
  const emberLift = loop(animationSeconds * 0.72);
  const headX = fillX + fillWidth;
  return {
    bands: [
      createBand(
        headX - Math.max(18, fillWidth * 0.1),
        height * 0.52,
        Math.max(16, fillWidth * 0.12),
        height * 1.42,
        -14,
        '#FFF7C2',
        0.16 + urgency * 0.12
      ),
      createBand(
        fillX + fillWidth * loop(animationSeconds * 0.3 + 0.18),
        height * 0.62,
        Math.max(20, fillWidth * 0.16),
        height * 1.06,
        -22,
        '#FDBA74',
        0.1 + urgency * 0.08
      )
    ],
    orbs: [
      createOrb(
        fillX + fillWidth * loop(animationSeconds * 0.58 + 0.14),
        height * (0.74 - emberLift * 0.22),
        Math.max(10, fillWidth * 0.05),
        Math.max(8, height * 0.12),
        '#FB923C',
        0.12 + urgency * 0.08
      ),
      createOrb(
        fillX + fillWidth * loop(animationSeconds * 0.78 + 0.52),
        height * (0.68 - emberLift * 0.28),
        Math.max(8, fillWidth * 0.04),
        Math.max(6, height * 0.1),
        '#FDE68A',
        0.14 + urgency * 0.08
      ),
      createOrb(
        headX - Math.max(12, fillWidth * 0.07),
        height * 0.48,
        Math.max(18, fillWidth * 0.1),
        Math.max(14, height * 0.28),
        '#FFF7C2',
        0.12 + urgency * 0.12
      )
    ]
  };
};

const buildBlackoutFrame = (
  width: number,
  height: number,
  fillX: number,
  fillWidth: number,
  fillRatio: number,
  animationSeconds: number
): TextProgressEffectFrame => {
  const urgency = 1 - fillRatio;
  const scanX = fillX + fillWidth * loop(animationSeconds * 1.7 + 0.12);
  return {
    bands: [
      createBand(
        scanX,
        height * 0.5,
        Math.max(8, fillWidth * 0.05),
        height * 1.84,
        0,
        '#FFFFFF',
        0.26 + urgency * 0.14
      ),
      createBand(
        fillX + fillWidth * loop(animationSeconds * 0.34 + 0.44),
        height * 0.5,
        Math.max(20, fillWidth * 0.16),
        height * 0.92,
        0,
        '#EF4444',
        0.08 + urgency * 0.06
      ),
      createBand(
        fillX + fillWidth * loop(animationSeconds * 0.62 + 0.78),
        height * 0.48,
        Math.max(10, fillWidth * 0.08),
        height * 1.24,
        -20,
        '#38BDF8',
        0.1 + urgency * 0.06
      )
    ],
    orbs: [
      createOrb(
        fillX + fillWidth * loop(animationSeconds * 0.52 + 0.2),
        height * 0.24,
        Math.max(10, fillWidth * 0.04),
        Math.max(6, height * 0.1),
        '#F8FAFC',
        0.12
      )
    ]
  };
};

const buildObsidianGoldFrame = (
  width: number,
  height: number,
  fillX: number,
  fillWidth: number,
  fillRatio: number,
  animationSeconds: number
): TextProgressEffectFrame => {
  const urgency = 1 - fillRatio;
  const flareX = fillX + fillWidth * loop(animationSeconds * 0.46 + 0.18);
  const headX = fillX + fillWidth;
  return {
    bands: [
      createBand(
        flareX,
        height * 0.5,
        Math.max(18, fillWidth * 0.14),
        height * 1.5,
        -18,
        '#FEF3C7',
        0.18 + urgency * 0.08
      ),
      createBand(
        headX - Math.max(10, fillWidth * 0.07),
        height * 0.52,
        Math.max(12, fillWidth * 0.09),
        height * 1.28,
        -8,
        '#F59E0B',
        0.14 + urgency * 0.08
      )
    ],
    orbs: [
      createOrb(
        headX - Math.max(12, fillWidth * 0.08),
        height * 0.46,
        Math.max(18, fillWidth * 0.11),
        Math.max(12, height * 0.24),
        '#FDE68A',
        0.12 + urgency * 0.06
      )
    ]
  };
};

const buildChromeFurnaceFrame = (
  width: number,
  height: number,
  fillX: number,
  fillWidth: number,
  fillRatio: number,
  animationSeconds: number
): TextProgressEffectFrame => {
  const urgency = 1 - fillRatio;
  return {
    bands: [
      createBand(
        fillX + fillWidth * loop(animationSeconds * 0.72),
        height * 0.5,
        Math.max(14, fillWidth * 0.11),
        height * 1.36,
        -22,
        '#E5E7EB',
        0.18 + urgency * 0.08
      ),
      createBand(
        fillX + fillWidth * loop(animationSeconds * 0.26 + 0.46),
        height * 0.6,
        Math.max(22, fillWidth * 0.17),
        height * 1.02,
        -12,
        '#FB923C',
        0.12 + urgency * 0.08
      )
    ],
    orbs: [
      createOrb(
        fillX + fillWidth * loop(animationSeconds * 0.44 + 0.18),
        height * 0.72,
        Math.max(10, fillWidth * 0.05),
        Math.max(7, height * 0.12),
        '#FB923C',
        0.12
      ),
      createOrb(
        fillX + fillWidth * loop(animationSeconds * 0.88 + 0.54),
        height * 0.3,
        Math.max(12, fillWidth * 0.06),
        Math.max(8, height * 0.14),
        '#F8FAFC',
        0.08
      )
    ]
  };
};

export const resolveTextProgressEffectFrame = ({
  style,
  width,
  height,
  fillX,
  fillWidth,
  spanWidth,
  fillRatio,
  animationSeconds,
  fillColors
}: ResolveTextProgressEffectFrameOptions): TextProgressEffectFrame => {
  const safeSpanWidth = Math.max(1, spanWidth);
  const clampedFillWidth = clamp(fillWidth, 0, safeSpanWidth);
  if (!style || clampedFillWidth <= 0 || width <= 0 || height <= 0) {
    return emptyFrame();
  }

  const safeFillX = clamp(fillX, 0, width);
  const normalizedRatio = clamp(fillRatio, 0, 1);

  switch (style) {
    case 'voltage':
      return buildVoltageFrame(width, height, safeFillX, clampedFillWidth, normalizedRatio, animationSeconds, fillColors);
    case 'sunburst':
      return buildSunburstFrame(width, height, safeFillX, clampedFillWidth, normalizedRatio, animationSeconds);
    case 'hyperpop':
      return buildHyperpopFrame(width, height, safeFillX, clampedFillWidth, normalizedRatio, animationSeconds);
    case 'laser':
      return buildLaserFrame(width, height, safeFillX, clampedFillWidth, normalizedRatio, animationSeconds);
    case 'toxic':
      return buildToxicFrame(width, height, safeFillX, clampedFillWidth, normalizedRatio, animationSeconds, fillColors);
    case 'inferno':
      return buildInfernoFrame(width, height, safeFillX, clampedFillWidth, normalizedRatio, animationSeconds);
    case 'blackout':
      return buildBlackoutFrame(width, height, safeFillX, clampedFillWidth, normalizedRatio, animationSeconds);
    case 'obsidian_gold':
      return buildObsidianGoldFrame(width, height, safeFillX, clampedFillWidth, normalizedRatio, animationSeconds);
    case 'chrome_furnace':
      return buildChromeFurnaceFrame(width, height, safeFillX, clampedFillWidth, normalizedRatio, animationSeconds);
    default:
      return emptyFrame();
  }
};

export const resolveTextProgressBaseAccent = (
  style: GeneratedProgressBarStyle | null,
  fillColors: TextProgressFillColors
) => {
  if (!style) return null;

  switch (style) {
    case 'voltage':
      return mixHexColor(fillColors.middle, '#FFFFFF', 0.42);
    case 'sunburst':
      return mixHexColor(fillColors.end, '#FFF1A8', 0.48);
    case 'hyperpop':
      return mixHexColor(fillColors.start, '#FFFFFF', 0.3);
    case 'laser':
      return mixHexColor(fillColors.middle, '#E9D5FF', 0.34);
    case 'toxic':
      return mixHexColor(fillColors.middle, '#ECFCCB', 0.34);
    case 'inferno':
      return mixHexColor(fillColors.end, '#FFF7C2', 0.34);
    case 'blackout':
      return mixHexColor(fillColors.middle, '#F8FAFC', 0.2);
    case 'obsidian_gold':
      return mixHexColor(fillColors.end, '#FEF3C7', 0.36);
    case 'chrome_furnace':
      return mixHexColor(fillColors.middle, '#F8FAFC', 0.16);
    default:
      return null;
  }
};

export const resolveTextProgressShellStyle = (
  style: GeneratedProgressBarStyle | null,
  _fillColors: TextProgressFillColors
): TextProgressShellStyle => {
  switch (style) {
    case 'blackout':
      return {
        fill: '#04070C',
        stroke: '#F8FAFC',
        strokeScale: 1.24,
        fontScale: 1.04
      };
    case 'obsidian_gold':
      return {
        fill: '#120C05',
        stroke: '#FDE68A',
        strokeScale: 1.22,
        fontScale: 1.05
      };
    case 'chrome_furnace':
      return {
        fill: '#111827',
        stroke: '#E5E7EB',
        strokeScale: 1.18,
        fontScale: 1.03
      };
    default:
      return {
        fill: '#FFFFFF',
        stroke: '#111827',
        strokeScale: 1,
        fontScale: 1
      };
  }
};
