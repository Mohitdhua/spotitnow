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
  },
  voltage: {
    rootBg: '#ECFEFF',
    headerBg: '#22D3EE',
    headerText: '#082F49',
    headerSubText: '#0F172A',
    gameBg: '#CFFAFE',
    imagePanelBg: '#F0FDFF',
    patternColor: '#155E75',
    playHoverBg: '#67E8F9',
    skipHoverBg: '#A3E635',
    timerBg: '#0F172A',
    timerText: '#F8FAFC',
    timerDot: '#67E8F9',
    timerBorder: '#082F49',
    timerShapeClass: 'rounded-full',
    timerTextClass: 'font-mono font-black tracking-wide',
    progressTrackBg: '#FFFFFF',
    progressTrackBorder: '#082F49',
    progressTrackClass: 'rounded-full',
    progressFill: 'linear-gradient(90deg, #67E8F9 0%, #22D3EE 42%, #0EA5E9 76%, #A3E635 100%)',
    progressFillClass: '',
    progressFillGlow: '0 0 18px rgba(34,211,238,0.62), 0 0 36px rgba(103,232,249,0.36)',
    completionBg: '#A3E635',
    completionIcon: '#14532D'
  },
  sunburst: {
    rootBg: '#FFF7ED',
    headerBg: '#FDBA74',
    headerText: '#7C2D12',
    headerSubText: '#9A3412',
    gameBg: '#FED7AA',
    imagePanelBg: '#FFF7ED',
    patternColor: '#C2410C',
    playHoverBg: '#FDE68A',
    skipHoverBg: '#FB7185',
    timerBg: '#7C2D12',
    timerText: '#FFF7ED',
    timerDot: '#FDE047',
    timerBorder: '#9A3412',
    timerShapeClass: 'rounded-full',
    timerTextClass: 'font-mono font-black tracking-wide',
    progressTrackBg: '#FFF7ED',
    progressTrackBorder: '#7C2D12',
    progressTrackClass: 'rounded-full',
    progressFill: 'linear-gradient(90deg, #FDE047 0%, #FB923C 46%, #F97316 72%, #FB7185 100%)',
    progressFillClass: '',
    progressFillGlow: '0 0 18px rgba(249,115,22,0.54), 0 0 34px rgba(253,224,71,0.3)',
    completionBg: '#FB7185',
    completionIcon: '#881337'
  },
  hyperpop: {
    rootBg: '#FFF4FD',
    headerBg: '#F472B6',
    headerText: '#4A044E',
    headerSubText: '#831843',
    gameBg: '#FCE7F3',
    imagePanelBg: '#FFF1F2',
    patternColor: '#9D174D',
    playHoverBg: '#22D3EE',
    skipHoverBg: '#A3E635',
    timerBg: '#831843',
    timerText: '#FFF7FB',
    timerDot: '#22D3EE',
    timerBorder: '#4A044E',
    timerShapeClass: 'rounded-full',
    timerTextClass: 'font-mono font-black tracking-wide',
    progressTrackBg: '#FFF7FB',
    progressTrackBorder: '#4A044E',
    progressTrackClass: 'rounded-full',
    progressFill: 'linear-gradient(90deg, #22D3EE 0%, #60A5FA 22%, #F472B6 58%, #FB7185 78%, #A3E635 100%)',
    progressFillClass: '',
    progressFillGlow: '0 0 18px rgba(244,114,182,0.58), 0 0 34px rgba(34,211,238,0.34)',
    completionBg: '#A3E635',
    completionIcon: '#365314'
  },
  laser: {
    rootBg: '#F5F3FF',
    headerBg: '#C084FC',
    headerText: '#2E1065',
    headerSubText: '#4C1D95',
    gameBg: '#E9D5FF',
    imagePanelBg: '#F5F3FF',
    patternColor: '#6D28D9',
    playHoverBg: '#38BDF8',
    skipHoverBg: '#A78BFA',
    timerBg: '#1E1B4B',
    timerText: '#F8FAFC',
    timerDot: '#38BDF8',
    timerBorder: '#312E81',
    timerShapeClass: 'rounded-full',
    timerTextClass: 'font-mono font-black tracking-wide',
    progressTrackBg: '#FAF5FF',
    progressTrackBorder: '#312E81',
    progressTrackClass: 'rounded-full',
    progressFill: 'linear-gradient(90deg, #38BDF8 0%, #22D3EE 18%, #A855F7 62%, #E879F9 100%)',
    progressFillClass: '',
    progressFillGlow: '0 0 18px rgba(168,85,247,0.58), 0 0 34px rgba(56,189,248,0.34)',
    completionBg: '#E879F9',
    completionIcon: '#701A75'
  },
  toxic: {
    rootBg: '#F7FEE7',
    headerBg: '#A3E635',
    headerText: '#1A2E05',
    headerSubText: '#365314',
    gameBg: '#ECFCCB',
    imagePanelBg: '#F7FEE7',
    patternColor: '#4D7C0F',
    playHoverBg: '#4ADE80',
    skipHoverBg: '#22D3EE',
    timerBg: '#1A2E05',
    timerText: '#F7FEE7',
    timerDot: '#4ADE80',
    timerBorder: '#365314',
    timerShapeClass: 'rounded-full',
    timerTextClass: 'font-mono font-black tracking-wide',
    progressTrackBg: '#FEFFEF',
    progressTrackBorder: '#1A2E05',
    progressTrackClass: 'rounded-full',
    progressFill: 'linear-gradient(90deg, #D9F99D 0%, #A3E635 34%, #4ADE80 64%, #22D3EE 100%)',
    progressFillClass: '',
    progressFillGlow: '0 0 18px rgba(74,222,128,0.5), 0 0 34px rgba(163,230,53,0.28)',
    completionBg: '#22D3EE',
    completionIcon: '#164E63'
  },
  inferno: {
    rootBg: '#FFF7ED',
    headerBg: '#FB923C',
    headerText: '#431407',
    headerSubText: '#7C2D12',
    gameBg: '#FED7AA',
    imagePanelBg: '#FFF7ED',
    patternColor: '#9A3412',
    playHoverBg: '#FACC15',
    skipHoverBg: '#F87171',
    timerBg: '#431407',
    timerText: '#FFF7ED',
    timerDot: '#FACC15',
    timerBorder: '#7C2D12',
    timerShapeClass: 'rounded-full',
    timerTextClass: 'font-mono font-black tracking-wide',
    progressTrackBg: '#FFF7ED',
    progressTrackBorder: '#431407',
    progressTrackClass: 'rounded-full',
    progressFill: 'linear-gradient(90deg, #FDE68A 0%, #F59E0B 26%, #F97316 56%, #EF4444 100%)',
    progressFillClass: '',
    progressFillGlow: '0 0 20px rgba(249,115,22,0.56), 0 0 38px rgba(239,68,68,0.3)',
    completionBg: '#EF4444',
    completionIcon: '#7F1D1D'
  },
  blackout: {
    rootBg: '#05070C',
    headerBg: '#0B1020',
    headerText: '#F8FAFC',
    headerSubText: '#CBD5E1',
    gameBg: '#080C14',
    imagePanelBg: '#0E1420',
    patternColor: '#38BDF8',
    playHoverBg: '#111827',
    skipHoverBg: '#1E293B',
    timerBg: '#02040A',
    timerText: '#F8FAFC',
    timerDot: '#F8FAFC',
    timerBorder: '#38BDF8',
    timerShapeClass: 'rounded-full',
    timerTextClass: 'font-mono font-black tracking-wide',
    progressTrackBg: '#04070C',
    progressTrackBorder: '#F8FAFC',
    progressTrackClass: 'rounded-full',
    progressFill: 'linear-gradient(90deg, #F8FAFC 0%, #38BDF8 22%, #E11D48 58%, #F8FAFC 100%)',
    progressFillClass: '',
    progressFillGlow: '0 0 20px rgba(248,250,252,0.24), 0 0 38px rgba(56,189,248,0.24)',
    completionBg: '#E11D48',
    completionIcon: '#F8FAFC'
  },
  obsidian_gold: {
    rootBg: '#0D0904',
    headerBg: '#1A1208',
    headerText: '#FEF3C7',
    headerSubText: '#FCD34D',
    gameBg: '#120A04',
    imagePanelBg: '#1A1107',
    patternColor: '#F59E0B',
    playHoverBg: '#FBBF24',
    skipHoverBg: '#FDE68A',
    timerBg: '#080603',
    timerText: '#FEF3C7',
    timerDot: '#FBBF24',
    timerBorder: '#F59E0B',
    timerShapeClass: 'rounded-full',
    timerTextClass: 'font-mono font-black tracking-wide',
    progressTrackBg: '#0E0804',
    progressTrackBorder: '#FBBF24',
    progressTrackClass: 'rounded-full',
    progressFill: 'linear-gradient(90deg, #FEF3C7 0%, #FDE68A 18%, #FBBF24 52%, #D97706 100%)',
    progressFillClass: '',
    progressFillGlow: '0 0 20px rgba(251,191,36,0.42), 0 0 38px rgba(217,119,6,0.28)',
    completionBg: '#D97706',
    completionIcon: '#FEF3C7'
  },
  chrome_furnace: {
    rootBg: '#0C1118',
    headerBg: '#18212B',
    headerText: '#E5E7EB',
    headerSubText: '#CBD5E1',
    gameBg: '#111827',
    imagePanelBg: '#1B2430',
    patternColor: '#FB923C',
    playHoverBg: '#334155',
    skipHoverBg: '#FB923C',
    timerBg: '#050911',
    timerText: '#F8FAFC',
    timerDot: '#E5E7EB',
    timerBorder: '#FB923C',
    timerShapeClass: 'rounded-full',
    timerTextClass: 'font-mono font-black tracking-wide',
    progressTrackBg: '#0B1220',
    progressTrackBorder: '#E5E7EB',
    progressTrackClass: 'rounded-full',
    progressFill: 'linear-gradient(90deg, #E5E7EB 0%, #94A3B8 24%, #FB923C 62%, #F97316 100%)',
    progressFillClass: '',
    progressFillGlow: '0 0 20px rgba(251,146,60,0.38), 0 0 36px rgba(229,231,235,0.18)',
    completionBg: '#F97316',
    completionIcon: '#F8FAFC'
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
