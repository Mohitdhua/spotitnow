import { VideoSettings } from '../types';

export const BASE_STAGE_SIZE: Record<VideoSettings['aspectRatio'], { width: number; height: number }> = {
  '16:9': { width: 1600, height: 900 },
  '9:16': { width: 900, height: 1600 },
  '1:1': { width: 1200, height: 1200 },
  '4:3': { width: 1440, height: 1080 }
};

export const CLASSIC_HUD_SPEC = {
  headerHeight: 64,
  title: {
    top: 8,
    left: 16,
    fontSize: 20,
    subtitleSize: 10,
    subtitleGap: 2
  },
  timer: {
    top: 8,
    right: 14,
    padX: 12,
    padY: 4,
    dotSize: 10,
    gap: 8,
    fontSize: 30,
    minWidth: 100
  },
  progress: {
    widthRatio: 0.74,
    height: 12,
    bottom: 4,
    borderWidth: 2,
    fillInset: 1,
    trackBackground: 'linear-gradient(180deg, #0B0B0B 0%, #1D1D1D 100%)',
    fillGradient: 'linear-gradient(90deg, #FF4D4D 0%, #FF8A5B 48%, #FFD166 100%)',
    fillGlowCss: '0 0 10px rgba(255, 99, 71, 0.45)',
    fillGlowCanvas: 'rgba(255, 99, 71, 0.45)'
  },
  centerTitle: {
    text: 'spot three differences',
    fontSize: 40,
    fontSizeNarrow: 26,
    letterSpacingEm: 0.08,
    fillGradient: 'linear-gradient(180deg, #FFF7A8 0%, #FFD93D 55%, #FF9F1C 100%)',
    strokeColor: '#1E293B',
    glowCss: 'drop-shadow(0 2px 0 rgba(0,0,0,0.45)) drop-shadow(0 8px 14px rgba(255, 124, 30, 0.28))'
  },
  puzzleBadge: {
    top: 8,
    left: 14,
    padX: 14,
    padY: 4,
    minWidth: 164,
    height: 48,
    radius: 14,
    labelSize: 10,
    valueSize: 32,
    valueSizeNarrow: 24,
    gap: 6,
    background: 'linear-gradient(180deg, #FFF8BC 0%, #FFE88A 55%, #FFC94A 100%)',
    border: '#000000'
  }
} as const;

export const TRANSITION_TUNING = {
  overlayBaseAlpha: 0.26,
  overlayPulseAlpha: 0.52,
  overlayBaseAlphaStorybook: 0.24,
  overlayPulseAlphaStorybook: 0.58,
  blurBase: 1.1,
  blurPulse: 2.9,
  saturateBase: 1,
  saturatePulse: 0.16,
  wipeLeftBase: -62,
  wipeLeftTravel: 224,
  wipeSkewBase: -22,
  wipeSkewTravel: 9,
  cardOpacityBase: 0.12,
  cardOpacityPulse: 1.18,
  cardOpacityDecay: 0.08,
  cardTranslateY: 36,
  cardScaleBase: 0.9,
  cardScalePulse: 0.1
} as const;
