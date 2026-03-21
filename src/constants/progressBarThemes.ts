import { type VisualTheme, VISUAL_THEMES } from './videoThemes';
import type { GeneratedProgressBarStyle } from '../types';

export type ProgressBarVisualStyle = GeneratedProgressBarStyle;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const hslToHex = (hue: number, saturation: number, lightness: number) => {
  const normalizedHue = ((hue % 360) + 360) % 360;
  const s = clamp(saturation / 100, 0, 1);
  const l = clamp(lightness / 100, 0, 1);
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const segment = normalizedHue / 60;
  const secondary = chroma * (1 - Math.abs((segment % 2) - 1));
  let red = 0;
  let green = 0;
  let blue = 0;

  if (segment >= 0 && segment < 1) {
    red = chroma;
    green = secondary;
  } else if (segment < 2) {
    red = secondary;
    green = chroma;
  } else if (segment < 3) {
    green = chroma;
    blue = secondary;
  } else if (segment < 4) {
    green = secondary;
    blue = chroma;
  } else if (segment < 5) {
    red = secondary;
    blue = chroma;
  } else {
    red = chroma;
    blue = secondary;
  }

  const match = l - chroma / 2;
  const toHex = (channel: number) => Math.round((channel + match) * 255).toString(16).padStart(2, '0');
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
};

export const PROGRESS_BAR_THEMES: Record<ProgressBarVisualStyle, VisualTheme> = {
  ...VISUAL_THEMES,
  heat: {
    rootBg: '#F3FFF5',
    headerBg: '#86EFAC',
    headerText: '#052E16',
    headerSubText: '#166534',
    gameBg: '#DCFCE7',
    imagePanelBg: '#F0FDF4',
    patternColor: '#14532D',
    playHoverBg: '#4ADE80',
    skipHoverBg: '#FACC15',
    timerBg: '#052E16',
    timerText: '#F0FDF4',
    timerDot: '#22C55E',
    timerBorder: '#14532D',
    timerShapeClass: 'rounded-full',
    timerTextClass: 'font-mono font-black tracking-wide',
    progressTrackBg: '#FFFFFF',
    progressTrackBorder: '#14532D',
    progressTrackClass: 'rounded-full',
    progressFill: 'linear-gradient(90deg, #4ADE80 0%, #22C55E 58%, #15803D 100%)',
    progressFillClass: '',
    progressFillGlow: undefined,
    completionBg: '#F97316',
    completionIcon: '#7F1D1D'
  }
};

export const resolveHeatProgressColors = (remainingRatio: number) => {
  const clampedRatio = clamp(remainingRatio, 0, 1);
  const hue = clampedRatio * 120;
  return {
    start: hslToHex(hue, 88, 66),
    middle: hslToHex(hue, 84, 54),
    end: hslToHex(hue, 78, 42)
  };
};

export const resolveProgressBarFillColors = (
  style: ProgressBarVisualStyle,
  remainingRatio: number
) => (style === 'heat' ? resolveHeatProgressColors(remainingRatio) : null);

export const resolveProgressBarFillStyle = (
  style: ProgressBarVisualStyle,
  remainingRatio: number,
  theme: VisualTheme
) => {
  const colors = resolveProgressBarFillColors(style, remainingRatio);
  if (!colors) return theme.progressFill;
  return `linear-gradient(90deg, ${colors.start} 0%, ${colors.middle} 58%, ${colors.end} 100%)`;
};
