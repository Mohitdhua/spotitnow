import { VideoSettings } from '../types';

export type MeterOrientation = 'horizontal' | 'vertical';

export interface HudAnchorSpec {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  centerX?: boolean;
  centerY?: boolean;
}

export interface HudLayoutSpec {
  headerHeight: number;
  title: HudAnchorSpec & {
    align: 'left' | 'center' | 'right';
    fontSize: number;
    subtitleSize: number;
    subtitleGap: number;
  };
  timer: HudAnchorSpec & {
    padX: number;
    padY: number;
    dotSize: number;
    gap: number;
    fontSize: number;
    minWidth: number;
  };
  progress: HudAnchorSpec & {
    width: number;
    height: number;
    radius: number;
    orientation: MeterOrientation;
  };
}

export const RIGHT_STACK: HudLayoutSpec = {
  headerHeight: 64,
  title: { top: 8, left: 16, align: 'left', fontSize: 20, subtitleSize: 10, subtitleGap: 2 },
  timer: { top: 8, right: 14, padX: 12, padY: 4, dotSize: 10, gap: 8, fontSize: 30, minWidth: 100 },
  progress: { top: 42, right: 14, width: 96, height: 10, radius: 999, orientation: 'horizontal' }
};

export const LEFT_STACK: HudLayoutSpec = {
  headerHeight: 68,
  title: { top: 10, right: 18, align: 'right', fontSize: 19, subtitleSize: 9, subtitleGap: 2 },
  timer: { top: 9, left: 16, padX: 14, padY: 5, dotSize: 9, gap: 9, fontSize: 28, minWidth: 102 },
  progress: { top: 44, left: 16, width: 120, height: 12, radius: 8, orientation: 'horizontal' }
};

export const SPLIT_CORNERS: HudLayoutSpec = {
  headerHeight: 72,
  title: { top: 10, centerX: true, align: 'center', fontSize: 20, subtitleSize: 9, subtitleGap: 2 },
  timer: { top: 10, right: 16, padX: 11, padY: 5, dotSize: 8, gap: 7, fontSize: 23, minWidth: 104 },
  progress: { top: 10, left: 16, width: 128, height: 12, radius: 6, orientation: 'horizontal' }
};

export const CENTER_STACK: HudLayoutSpec = {
  headerHeight: 74,
  title: { top: 6, centerX: true, align: 'center', fontSize: 23, subtitleSize: 9, subtitleGap: 2 },
  timer: { bottom: 8, right: 14, padX: 12, padY: 4, dotSize: 8, gap: 8, fontSize: 22, minWidth: 96 },
  progress: { bottom: 8, centerX: true, width: 220, height: 10, radius: 999, orientation: 'horizontal' }
};

export const TOP_INLINE: HudLayoutSpec = {
  headerHeight: 68,
  title: { top: 12, left: 16, align: 'left', fontSize: 19, subtitleSize: 8, subtitleGap: 2 },
  timer: { top: 12, right: 16, padX: 12, padY: 4, dotSize: 8, gap: 7, fontSize: 21, minWidth: 98 },
  progress: { top: 12, right: 126, width: 102, height: 9, radius: 999, orientation: 'horizontal' }
};

export const BOTTOM_RAIL: HudLayoutSpec = {
  headerHeight: 80,
  title: { top: 10, centerX: true, align: 'center', fontSize: 20, subtitleSize: 9, subtitleGap: 2 },
  timer: { top: 10, right: 16, padX: 12, padY: 4, dotSize: 8, gap: 7, fontSize: 21, minWidth: 98 },
  progress: { bottom: 8, centerX: true, width: 300, height: 8, radius: 999, orientation: 'horizontal' }
};

export const VERTICAL_RIGHT: HudLayoutSpec = {
  headerHeight: 72,
  title: { top: 10, left: 16, align: 'left', fontSize: 19, subtitleSize: 8, subtitleGap: 2 },
  timer: { top: 10, right: 16, padX: 10, padY: 5, dotSize: 8, gap: 8, fontSize: 24, minWidth: 92 },
  progress: { top: 10, right: 124, width: 10, height: 52, radius: 6, orientation: 'vertical' }
};

export const VERTICAL_LEFT: HudLayoutSpec = {
  headerHeight: 72,
  title: { top: 10, right: 18, align: 'right', fontSize: 19, subtitleSize: 8, subtitleGap: 2 },
  timer: { top: 10, left: 18, padX: 10, padY: 5, dotSize: 8, gap: 8, fontSize: 24, minWidth: 92 },
  progress: { top: 10, left: 124, width: 10, height: 52, radius: 6, orientation: 'vertical' }
};

export const HUD_LAYOUT_SPEC: Record<VideoSettings['visualStyle'], HudLayoutSpec> = {
  random: RIGHT_STACK,
  classic: RIGHT_STACK,
  pop: RIGHT_STACK,
  neon: { ...TOP_INLINE, title: { ...TOP_INLINE.title, fontSize: 18 }, timer: { ...TOP_INLINE.timer, fontSize: 22 } },
  sunset: { ...CENTER_STACK, timer: { ...CENTER_STACK.timer, fontSize: 24 } },
  mint: LEFT_STACK,
  midnight: { ...BOTTOM_RAIL, progress: { ...BOTTOM_RAIL.progress, width: 260 } },
  mono: { ...SPLIT_CORNERS, timer: { ...SPLIT_CORNERS.timer, fontSize: 22 } },
  retro: { ...SPLIT_CORNERS, title: { ...SPLIT_CORNERS.title, fontSize: 22 }, timer: { ...SPLIT_CORNERS.timer, fontSize: 25 } },
  cyber: { ...VERTICAL_RIGHT, title: { ...VERTICAL_RIGHT.title, fontSize: 18 }, timer: { ...VERTICAL_RIGHT.timer, fontSize: 22 } },
  oceanic: { ...BOTTOM_RAIL, progress: { ...BOTTOM_RAIL.progress, width: 320, height: 9 } },
  ember: { ...LEFT_STACK, timer: { ...LEFT_STACK.timer, fontSize: 26, padX: 16 } },
  candy: { ...CENTER_STACK, title: { ...CENTER_STACK.title, fontSize: 21 }, progress: { ...CENTER_STACK.progress, width: 210 } },
  forest: { ...LEFT_STACK, timer: { ...LEFT_STACK.timer, fontSize: 24 }, progress: { ...LEFT_STACK.progress, width: 132 } },
  aurora: { ...TOP_INLINE, timer: { ...TOP_INLINE.timer, minWidth: 110 }, progress: { ...TOP_INLINE.progress, width: 118 } },
  slate: { ...RIGHT_STACK, title: { ...RIGHT_STACK.title, fontSize: 18 }, timer: { ...RIGHT_STACK.timer, fontSize: 20 }, progress: { ...RIGHT_STACK.progress, width: 140, height: 8 } },
  arcade: VERTICAL_LEFT,
  ivory: { ...BOTTOM_RAIL, title: { ...BOTTOM_RAIL.title, fontSize: 18, subtitleSize: 8 }, timer: { ...BOTTOM_RAIL.timer, fontSize: 20 }, progress: { ...BOTTOM_RAIL.progress, width: 220, height: 7 } },
  storybook: { ...TOP_INLINE, title: { ...TOP_INLINE.title, fontSize: 22, subtitleSize: 10 }, timer: { ...TOP_INLINE.timer, fontSize: 20, minWidth: 95 }, progress: { ...TOP_INLINE.progress, width: 300, height: 20, radius: 10 } }
};
