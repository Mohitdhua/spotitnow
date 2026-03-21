import {
  BOTTOM_RAIL,
  LEFT_STACK,
  RIGHT_STACK,
  SPLIT_CORNERS,
  TOP_INLINE,
  VERTICAL_LEFT,
  type HudLayoutSpec
} from './videoHudLayoutSpec';
import {
  type VideoPackagePreset,
  type VideoSceneCardStyle,
  type VideoRevealBehavior,
  type VideoSceneSettings,
  type VideoSettings,
  type VideoTextTemplates
} from '../types';

export interface VideoPackageFrameDefaults {
  contentPadding: number;
  panelGap: number;
  panelRadius: number;
  gamePadding: number;
}

export interface VideoPackageChrome {
  titleGap: number;
  titleFontClass: string;
  subtitleFontClass: string;
  subtitleLetterSpacingEm: number;
  logoSize: number;
  timerJustify: 'center' | 'flex-start' | 'flex-end';
  timerShapeClass: string;
  timerTextClass: string;
  progressTrackClass: string;
  progressFillClass: string;
}

export interface VideoPackagePresetDefinition {
  label: string;
  description: string;
  recommendedAspectRatios: VideoSettings['aspectRatio'][];
  defaultVisualStyle: VideoSettings['visualStyle'];
  defaultRevealBehavior: VideoRevealBehavior;
  imageArrangement: 'auto' | 'horizontal' | 'vertical';
  surfaceStyle: 'gameshow' | 'standard' | 'storybook';
  layoutSummary: {
    images: string;
    title: string;
    timer: string;
  };
  hudLayout: HudLayoutSpec;
  frameDefaults: VideoPackageFrameDefaults;
  chrome: VideoPackageChrome;
  introCardVariant: Exclude<VideoSceneCardStyle, 'package' | 'spotlight' | 'celebration'>;
  transitionCardVariant: Exclude<VideoSceneCardStyle, 'package' | 'spotlight' | 'celebration'>;
  outroCardVariant: Exclude<VideoSceneCardStyle, 'package' | 'spotlight' | 'celebration'>;
}

const STANDARD_FRAME_DEFAULTS: VideoPackageFrameDefaults = {
  contentPadding: 18,
  panelGap: 14,
  panelRadius: 14,
  gamePadding: 8
};

const STORYBOOK_FRAME_DEFAULTS: VideoPackageFrameDefaults = {
  contentPadding: 14,
  panelGap: 22,
  panelRadius: 18,
  gamePadding: 8
};

export const VIDEO_PACKAGE_PRESETS: Record<VideoPackagePreset, VideoPackagePresetDefinition> = {
  gameshow: {
    label: 'Gameshow',
    description: 'Bold HUD, scoreboard framing, and energetic puzzle progression.',
    recommendedAspectRatios: ['16:9', '9:16'],
    defaultVisualStyle: 'classic',
    defaultRevealBehavior: 'pulse',
    imageArrangement: 'auto',
    surfaceStyle: 'gameshow',
    layoutSummary: {
      images: 'Balanced split images',
      title: 'Big center headline',
      timer: 'Scoreboard timer on the right'
    },
    hudLayout: RIGHT_STACK,
    frameDefaults: STANDARD_FRAME_DEFAULTS,
    chrome: {
      titleGap: 14,
      titleFontClass: 'font-display',
      subtitleFontClass: 'font-sans',
      subtitleLetterSpacingEm: 0.22,
      logoSize: 40,
      timerJustify: 'center',
      timerShapeClass: 'rounded-full',
      timerTextClass: 'font-mono font-bold',
      progressTrackClass: 'rounded-full',
      progressFillClass: ''
    },
    introCardVariant: 'scoreboard',
    transitionCardVariant: 'scoreboard',
    outroCardVariant: 'scoreboard'
  },
  shorts_clean: {
    label: 'Shorts Clean',
    description: 'Minimal framing for fast vertical and square social exports.',
    recommendedAspectRatios: ['9:16'],
    defaultVisualStyle: 'ivory',
    defaultRevealBehavior: 'marker_only',
    imageArrangement: 'auto',
    surfaceStyle: 'standard',
    layoutSummary: {
      images: 'Clean split with more breathing room',
      title: 'Simple headline block',
      timer: 'Compact floating timer'
    },
    hudLayout: BOTTOM_RAIL,
    frameDefaults: {
      contentPadding: 16,
      panelGap: 12,
      panelRadius: 16,
      gamePadding: 10
    },
    chrome: {
      titleGap: 12,
      titleFontClass: 'font-sans',
      subtitleFontClass: 'font-sans',
      subtitleLetterSpacingEm: 0.18,
      logoSize: 36,
      timerJustify: 'center',
      timerShapeClass: 'rounded-full',
      timerTextClass: 'font-sans font-semibold tracking-wide',
      progressTrackClass: 'rounded-full',
      progressFillClass: ''
    },
    introCardVariant: 'standard',
    transitionCardVariant: 'standard',
    outroCardVariant: 'standard'
  },
  storybook_plus: {
    label: 'Storybook Plus',
    description: 'Illustrated framing with page-turn pacing and warm cards.',
    recommendedAspectRatios: ['16:9'],
    defaultVisualStyle: 'storybook',
    defaultRevealBehavior: 'cinematic_sequential',
    imageArrangement: 'horizontal',
    surfaceStyle: 'storybook',
    layoutSummary: {
      images: 'Framed storybook spread',
      title: 'Left-aligned story heading',
      timer: 'Framed badge timer'
    },
    hudLayout: {
      ...TOP_INLINE,
      title: { ...TOP_INLINE.title, fontSize: 22, subtitleSize: 10 },
      timer: { ...TOP_INLINE.timer, fontSize: 20, minWidth: 95 },
      progress: { ...TOP_INLINE.progress, width: 300, height: 20, radius: 10 }
    },
    frameDefaults: STORYBOOK_FRAME_DEFAULTS,
    chrome: {
      titleGap: 12,
      titleFontClass: 'font-serif',
      subtitleFontClass: 'font-serif',
      subtitleLetterSpacingEm: 0.08,
      logoSize: 34,
      timerJustify: 'center',
      timerShapeClass: 'rounded-2xl',
      timerTextClass: 'font-mono font-black',
      progressTrackClass: 'rounded-full',
      progressFillClass: ''
    },
    introCardVariant: 'storybook',
    transitionCardVariant: 'storybook',
    outroCardVariant: 'storybook'
  },
  arcade: {
    label: 'Arcade',
    description: 'High-energy retro UI with stronger reveal feedback.',
    recommendedAspectRatios: ['16:9', '9:16'],
    defaultVisualStyle: 'arcade',
    defaultRevealBehavior: 'freeze_ring',
    imageArrangement: 'auto',
    surfaceStyle: 'standard',
    layoutSummary: {
      images: 'Split images with HUD on the left',
      title: 'Right-side arcade title',
      timer: 'Block timer with vertical progress'
    },
    hudLayout: VERTICAL_LEFT,
    frameDefaults: STANDARD_FRAME_DEFAULTS,
    chrome: {
      titleGap: 12,
      titleFontClass: 'font-mono',
      subtitleFontClass: 'font-mono',
      subtitleLetterSpacingEm: 0.24,
      logoSize: 34,
      timerJustify: 'center',
      timerShapeClass: 'rounded-none',
      timerTextClass: 'font-mono font-black tracking-[0.18em]',
      progressTrackClass: 'rounded-none',
      progressFillClass: ''
    },
    introCardVariant: 'scoreboard',
    transitionCardVariant: 'scoreboard',
    outroCardVariant: 'standard'
  },
  editorial: {
    label: 'Editorial',
    description: 'Clean text-first packaging for polished branded exports.',
    recommendedAspectRatios: ['16:9'],
    defaultVisualStyle: 'slate',
    defaultRevealBehavior: 'spotlight',
    imageArrangement: 'horizontal',
    surfaceStyle: 'standard',
    layoutSummary: {
      images: 'Wide compare canvas',
      title: 'Centered editorial title',
      timer: 'Minimal timer with clean progress rail'
    },
    hudLayout: SPLIT_CORNERS,
    frameDefaults: {
      contentPadding: 18,
      panelGap: 18,
      panelRadius: 10,
      gamePadding: 8
    },
    chrome: {
      titleGap: 10,
      titleFontClass: 'font-display',
      subtitleFontClass: 'font-mono',
      subtitleLetterSpacingEm: 0.24,
      logoSize: 32,
      timerJustify: 'center',
      timerShapeClass: 'rounded-sm',
      timerTextClass: 'font-mono font-bold tracking-wider',
      progressTrackClass: 'rounded-sm',
      progressFillClass: ''
    },
    introCardVariant: 'standard',
    transitionCardVariant: 'standard',
    outroCardVariant: 'standard'
  }
};

export const DEFAULT_VIDEO_SCENE_SETTINGS: VideoSceneSettings = {
  introEnabled: true,
  introDuration: 1.5,
  outroEnabled: true,
  outroDuration: 1.5
};

export const DEFAULT_VIDEO_TEXT_TEMPLATES: VideoTextTemplates = {
  introEyebrow: 'SpotDiff Studio',
  introTitle: 'Spot 3 Differences',
  introSubtitle: '{puzzleCount} puzzles',
  playTitle: 'Find Differences',
  playSubtitle: 'Puzzle {current} / {total}',
  progressLabel: 'SPOT THE 3 DIFFERENCES',
  revealTitle: 'Solution',
  transitionEyebrow: 'Up Next',
  transitionTitle: 'Next Puzzle',
  transitionSubtitle: 'Puzzle {current} / {total}',
  completionEyebrow: 'Complete',
  completionTitle: 'Playback Complete!',
  completionSubtitle: 'All puzzles shown.',
  puzzleBadgeLabel: 'Puzzle'
};

export const VIDEO_REVEAL_BEHAVIOR_OPTIONS: Array<{
  value: VideoRevealBehavior;
  label: string;
  description: string;
}> = [
  { value: 'marker_only', label: 'Marker Only', description: 'Keep the current marker-based reveal without extra motion.' },
  { value: 'pulse', label: 'Pulse', description: 'Add timed pulses around the active difference.' },
  { value: 'spotlight', label: 'Spotlight', description: 'Dim the scene and isolate the active region.' },
  { value: 'zoom_to_diff', label: 'Zoom To Diff', description: 'Briefly push the camera toward the active difference.' },
  { value: 'freeze_ring', label: 'Freeze Ring', description: 'Pause the scene briefly and drop a stronger ring marker.' },
  { value: 'cinematic_sequential', label: 'Cinematic Sequential', description: 'Stage each difference with more deliberate pacing.' }
];

export const resolvePackageImageArrangement = (
  preset: VideoPackagePresetDefinition,
  aspectRatio: VideoSettings['aspectRatio']
) => {
  if (preset.imageArrangement === 'horizontal') return false;
  if (preset.imageArrangement === 'vertical') return true;
  return aspectRatio === '9:16';
};
