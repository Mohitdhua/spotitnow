export interface Point {
  x: number;
  y: number;
}

export interface Region {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Puzzle {
  imageA: string; // Base64 or URL
  imageB: string; // Base64 or URL
  regions: Region[];
  title?: string;
}

export interface PuzzleSet {
  title: string;
  puzzles: Puzzle[];
  version: number;
}

export interface OverlayTransform {
  x: number; // normalized (0..1) from left
  y: number; // normalized (0..1) from top
  width: number; // normalized width relative to frame
  height: number; // normalized height relative to frame
}

export interface CustomVideoLayout {
  headerHeight: number;
  contentPadding: number;
  panelGap: number;
  panelRadius: number;
  gamePadding: number;
  logoTop: number;
  logoLeft: number;
  logoSize: number;
  titleTop: number;
  titleLeft: number;
  titleAlign: 'left' | 'center' | 'right';
  titleFontSize: number;
  subtitleSize: number;
  subtitleGap: number;
  timerTop: number;
  timerLeft: number;
  timerPadX: number;
  timerPadY: number;
  timerDotSize: number;
  timerGap: number;
  timerFontSize: number;
  timerMinWidth: number;
  progressTop: number;
  progressLeft: number;
  progressWidth: number;
  progressHeight: number;
  progressRadius: number;
  progressOrientation: 'horizontal' | 'vertical';
}

export type VideoPackagePreset =
  | 'gameshow'
  | 'shorts_clean'
  | 'storybook_plus'
  | 'arcade'
  | 'editorial';

export type VideoRevealBehavior =
  | 'marker_only'
  | 'pulse'
  | 'spotlight'
  | 'zoom_to_diff'
  | 'freeze_ring'
  | 'cinematic_sequential';

export interface VideoSceneSettings {
  introEnabled: boolean;
  introDuration: number;
  outroEnabled: boolean;
  outroDuration: number;
}

export interface VideoTextTemplates {
  introEyebrow: string;
  introTitle: string;
  introSubtitle: string;
  playTitle: string;
  playSubtitle: string;
  revealTitle: string;
  transitionEyebrow: string;
  transitionTitle: string;
  transitionSubtitle: string;
  completionEyebrow: string;
  completionTitle: string;
  completionSubtitle: string;
  puzzleBadgeLabel: string;
}

export interface VideoSettings {
  aspectRatio: '16:9' | '9:16' | '1:1' | '4:3';
  videoPackagePreset: VideoPackagePreset;
  visualStyle:
    | 'random'
    | 'classic'
    | 'pop'
    | 'neon'
    | 'sunset'
    | 'mint'
    | 'midnight'
    | 'mono'
    | 'retro'
    | 'cyber'
    | 'oceanic'
    | 'ember'
    | 'candy'
    | 'forest'
    | 'aurora'
    | 'slate'
    | 'arcade'
    | 'ivory'
    | 'storybook';
  sceneSettings: VideoSceneSettings;
  textTemplates: VideoTextTemplates;
  showDuration: number; // Seconds to show the puzzle before revealing
  revealDuration: number; // Total seconds spent in the reveal phase
  sequentialRevealStep: number; // Seconds between each revealed diff (and blink-start gap)
  enableBlinking: boolean; // Enables compare blinking in preview playback and exports
  blinkSpeed: number; // Seconds per blink cycle when compare overlay is active
  circleThickness: number; // Border thickness for circle-based reveal markers
  revealBehavior: VideoRevealBehavior; // Controls how the reveal phase behaves beyond the marker skin
  revealStyle: 'box' | 'circle' | 'highlight';
  revealVariant:
    | 'box_glow'
    | 'box_dashed'
    | 'box_corners'
    | 'box_classic'
    | 'box_minimal'
    | 'circle_ring'
    | 'circle_dotted'
    | 'circle_ellipse'
    | 'circle_ellipse_dotted'
    | 'circle_red_black'
    | 'circle_classic'
    | 'circle_crosshair'
    | 'highlight_soft'
    | 'highlight_classic';
  revealColor: string;
  outlineColor: string;
  outlineThickness: number;
  transitionStyle: 'fade' | 'slide' | 'none';
  transitionDuration: number; // Seconds
  useCustomLayout?: boolean;
  customLayout?: CustomVideoLayout;
  exportResolution: '480p' | '720p' | '1080p' | '1440p' | '2160p';
  exportBitrateMbps: number;
  exportCodec: 'h264' | 'av1';
  logo?: string; // Base64 or URL
  logoZoom: number;
  logoChromaKeyEnabled: boolean;
  logoChromaKeyColor: string;
  logoChromaKeyTolerance: number;
  generatedBackgroundsEnabled: boolean;
  generatedBackgroundPackId: string;
  generatedBackgroundShuffleSeed: number;
}

export type GeneratedBackgroundSceneKind =
  | 'arcade'
  | 'studio'
  | 'forest'
  | 'city'
  | 'seaside'
  | 'dreamscape';

export type GeneratedBackgroundPaletteId =
  | 'sunrise'
  | 'mint'
  | 'midnight'
  | 'candy'
  | 'ocean'
  | 'amber';

export type GeneratedBackgroundPattern = 'dots' | 'grid' | 'sparkle' | 'waves';

export interface GeneratedBackgroundSpec {
  id: string;
  name: string;
  seed: number;
  sceneKind: GeneratedBackgroundSceneKind;
  paletteId: GeneratedBackgroundPaletteId;
  horizon: number;
  density: number;
  accentScale: number;
  pattern: GeneratedBackgroundPattern;
}

export interface GeneratedBackgroundPack {
  id: string;
  name: string;
  description: string;
  aspectRatio: VideoSettings['aspectRatio'];
  createdAt: number;
  updatedAt: number;
  backgrounds: GeneratedBackgroundSpec[];
  coverBackgroundId: string;
}

export interface VideoModeTransferPosition {
  x: number; // normalized (0..1) from left
  y: number; // normalized (0..1) from top
  width: number; // normalized width relative to frame
  height: number; // normalized height relative to frame
}

export interface VideoModeTransferFrame {
  id: string;
  clipId: string;
  name: string;
  image: string; // Raw image source (data URL or URL)
  frame: number;
  timeMs: number;
  durationMs: number;
  position: VideoModeTransferPosition;
  rotation: number;
  scale: number;
}

export type ProcessingMode = 'manual' | 'auto' | 'ai';

export type GameMode =
  | 'upload'
  | 'splitter'
  | 'image_upscaler'
  | 'background_generator'
  | 'frame_extractor'
  | 'edit'
  | 'play'
  | 'video_setup'
  | 'video_play'
  | 'overlay_editor'
  | 'progress_bar'
  | 'watermark_removal';
