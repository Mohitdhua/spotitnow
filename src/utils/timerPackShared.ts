import type { VisualTheme } from '../constants/videoThemes';

export const DESIGNER_TIMER_STYLE_DEFINITIONS = [
  {
    id: 'countdown_ring',
    label: 'Circular Countdown Ring',
    description: 'Large central seconds with a clockwise draining outer ring.',
    widthFactor: 1.24,
    heightFactor: 1.24
  },
  {
    id: 'hollow_drain',
    label: 'Hollow Text Drain',
    description: 'Outlined seconds text with a draining fill that matches text-based progress.',
    widthFactor: 2.8,
    heightFactor: 1.05
  },
  {
    id: 'pill_progress',
    label: 'Pill Progress',
    description: 'Smooth capsule timer with a centered label and clean horizontal drain.',
    widthFactor: 3,
    heightFactor: 1.1
  },
  {
    id: 'magnify_timer',
    label: 'Magnifying Glass',
    description: 'Puzzle-themed lens timer with a stylish handle and inner countdown.',
    widthFactor: 1.45,
    heightFactor: 1.3
  },
  {
    id: 'radar_sweep',
    label: 'Radar Sweep',
    description: 'Modern radar ring with a sweep line and shrinking active arc.',
    widthFactor: 1.24,
    heightFactor: 1.24
  },
  {
    id: 'fuse_burn',
    label: 'Fuse Burn',
    description: 'A burning fuse line with a moving spark and a bold countdown badge.',
    widthFactor: 3.2,
    heightFactor: 0.9
  },
  {
    id: 'badge_pop',
    label: 'Badge Pop',
    description: 'Rounded badge timer with a punchy tick bounce and thick outline.',
    widthFactor: 1.45,
    heightFactor: 1.18
  },
  {
    id: 'dual_ring_pro',
    label: 'Dual Ring Pro',
    description: 'Premium dual-ring timer with a thin outer halo and clean center count.',
    widthFactor: 1.28,
    heightFactor: 1.28
  },
  {
    id: 'segmented_timer',
    label: 'Segmented Timer',
    description: 'A satisfying segmented countdown ring that drops away piece by piece.',
    widthFactor: 1.3,
    heightFactor: 1.3
  },
  {
    id: 'warning_mode',
    label: 'Warning Mode',
    description: 'A calm timer that intensifies near the end without getting messy.',
    widthFactor: 2.7,
    heightFactor: 1.12
  }
] as const;

export type DesignerTimerStyleId = (typeof DESIGNER_TIMER_STYLE_DEFINITIONS)[number]['id'];

export interface DesignerTimerPalette {
  background: string;
  panel: string;
  shell: string;
  shellSoft: string;
  track: string;
  text: string;
  mutedText: string;
  accent: string;
  accentAlt: string;
  warning: string;
  warningAlt: string;
  empty: string;
  glow: string;
  spark: string;
}

export interface DesignerTimerProps {
  duration?: number;
  remainingTime?: number;
  progress?: number;
  isEndingSoon?: boolean;
  size?: number;
  className?: string;
  palette?: DesignerTimerPalette;
}

export interface DesignerTimerState {
  width: number;
  height: number;
  duration: number;
  remainingTime: number;
  remainingRatio: number;
  elapsedRatio: number;
  isEndingSoon: boolean;
  isFinished: boolean;
  size: number;
  secondsLabel: string;
  numericLabel: string;
}

type Rgb = {
  r: number;
  g: number;
  b: number;
};

const DIMENSION_MAP = Object.fromEntries(
  DESIGNER_TIMER_STYLE_DEFINITIONS.map((definition) => [definition.id, definition])
) as Record<DesignerTimerStyleId, (typeof DESIGNER_TIMER_STYLE_DEFINITIONS)[number]>;

const clampChannel = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

const parseHexColor = (value: string): Rgb | null => {
  const normalized = value.trim();
  if (!normalized.startsWith('#')) return null;
  const hex = normalized.slice(1);
  if (hex.length === 3) {
    const [r, g, b] = hex.split('');
    return {
      r: parseInt(r + r, 16),
      g: parseInt(g + g, 16),
      b: parseInt(b + b, 16)
    };
  }
  if (hex.length === 6) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16)
    };
  }
  return null;
};

const rgbToHex = ({ r, g, b }: Rgb) =>
  `#${clampChannel(r).toString(16).padStart(2, '0')}${clampChannel(g).toString(16).padStart(2, '0')}${clampChannel(b).toString(16).padStart(2, '0')}`;

export const clampNumber = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const clamp01 = (value: number) => clampNumber(value, 0, 1);

export const withAlpha = (hex: string, alpha: number) => {
  const rgb = parseHexColor(hex);
  if (!rgb) return hex;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clamp01(alpha)})`;
};

export const mixHexColor = (from: string, to: string, amount: number) => {
  const start = parseHexColor(from);
  const end = parseHexColor(to);
  if (!start || !end) return amount >= 0.5 ? to : from;
  const ratio = clamp01(amount);
  return rgbToHex({
    r: start.r + (end.r - start.r) * ratio,
    g: start.g + (end.g - start.g) * ratio,
    b: start.b + (end.b - start.b) * ratio
  });
};

export const polarToCartesian = (centerX: number, centerY: number, radius: number, angleDeg: number) => {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: centerX + radius * Math.cos(angleRad),
    y: centerY + radius * Math.sin(angleRad)
  };
};

export const describeArc = (
  centerX: number,
  centerY: number,
  radius: number,
  startAngle: number,
  endAngle: number
) => {
  const start = polarToCartesian(centerX, centerY, radius, endAngle);
  const end = polarToCartesian(centerX, centerY, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
};

export const formatTimerSecondsLabel = (remainingTime: number) => `${Math.max(0, Math.ceil(remainingTime))}s`;

export const getRemainingRatio = (
  progress: number | undefined,
  remainingTime: number | undefined,
  duration: number | undefined
) => {
  if (typeof progress === 'number' && Number.isFinite(progress)) return clamp01(progress);
  if (typeof remainingTime === 'number' && typeof duration === 'number' && duration > 0) {
    return clamp01(remainingTime / duration);
  }
  return 0;
};

export const getElapsedRatio = (
  progress: number | undefined,
  remainingTime: number | undefined,
  duration: number | undefined
) => 1 - getRemainingRatio(progress, remainingTime, duration);

export const getEndingPulse = (remainingTime: number, strength = 1) => {
  const wave = (Math.sin(remainingTime * 8.4) + 1) / 2;
  return 1 + wave * 0.06 * strength;
};

export const getTickPulse = (remainingTime: number, strength = 1) => {
  const fractional = ((1 - (remainingTime % 1)) + 1) % 1;
  return 1 + Math.exp(-fractional * 10) * 0.07 * strength;
};

export const getDesignerTimerDimensions = (styleId: DesignerTimerStyleId, size: number) => {
  const definition = DIMENSION_MAP[styleId];
  return {
    width: Math.round(size * definition.widthFactor),
    height: Math.round(size * definition.heightFactor)
  };
};

export const isDesignerTimerStyle = (value: string): value is DesignerTimerStyleId =>
  Object.prototype.hasOwnProperty.call(DIMENSION_MAP, value);

export const resolveDesignerTimerPalette = (
  theme?: Partial<VisualTheme>,
  isEndingSoon = false,
  remainingRatio = 1
): DesignerTimerPalette => {
  const urgency = isEndingSoon ? clamp01(1 - remainingRatio * 0.8) : clamp01((1 - remainingRatio) * 0.28);
  const baseAccent = theme?.timerDot ?? '#44D7FF';
  const baseAccentAlt = theme?.headerBg ?? '#FFD54A';
  const shell = mixHexColor(theme?.timerBorder ?? '#020617', '#FFFFFF', 0.06);
  const warning = '#FF5E5E';
  const accent = mixHexColor(baseAccent, warning, urgency * 0.9);
  const accentAlt = mixHexColor(baseAccentAlt, '#F59E0B', urgency * 0.65);
  return {
    background: mixHexColor(theme?.timerBg ?? '#111827', '#1E293B', 0.2),
    panel: withAlpha('#FFFFFF', 0.14),
    shell,
    shellSoft: mixHexColor(shell, '#FFFFFF', 0.18),
    track: withAlpha('#FFFFFF', 0.16),
    text: theme?.timerText ?? '#FFFFFF',
    mutedText: mixHexColor(theme?.timerText ?? '#FFFFFF', '#C7D2FE', 0.36),
    accent,
    accentAlt,
    warning,
    warningAlt: '#F59E0B',
    empty: '#FFFFFF',
    glow: withAlpha(accent, isEndingSoon ? 0.34 : 0.2),
    spark: mixHexColor(accentAlt, '#FFFFFF', 0.38)
  };
};

export const resolveDesignerTimerState = (
  styleId: DesignerTimerStyleId,
  props: DesignerTimerProps
): DesignerTimerState => {
  const duration = Math.max(0.5, props.duration ?? 30);
  const remainingTime = clampNumber(props.remainingTime ?? duration, 0, duration);
  const remainingRatio = getRemainingRatio(props.progress, remainingTime, duration);
  const elapsedRatio = 1 - remainingRatio;
  const size = Math.max(44, Math.round(props.size ?? 72));
  const { width, height } = getDesignerTimerDimensions(styleId, size);
  const isEndingSoon = Boolean(props.isEndingSoon) || remainingRatio <= 0.2;
  return {
    width,
    height,
    duration,
    remainingTime,
    remainingRatio,
    elapsedRatio,
    isEndingSoon,
    isFinished: remainingRatio <= 0.001,
    size,
    secondsLabel: formatTimerSecondsLabel(remainingTime),
    numericLabel: `${Math.max(0, Math.ceil(remainingTime))}`
  };
};
