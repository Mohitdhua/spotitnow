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

export type VideoTextStyle =
  | 'package'
  | 'poster'
  | 'rounded'
  | 'mono'
  | 'storybook'
  | 'editorial';

export type VideoHeaderStyle =
  | 'package'
  | 'plain'
  | 'panel'
  | 'ribbon'
  | 'split'
  | 'underline';

export type VideoTimerStyle =
  | 'package'
  | 'pill'
  | 'digital'
  | 'chunky'
  | 'ticket'
  | 'minimal'
  | 'capsule'
  | 'scoreboard'
  | 'beacon'
  | 'retro_flip'
  | 'neon_chip'
  | 'sticker'
  | 'jelly'
  | 'marquee'
  | 'glass'
  | 'notched'
  | 'orbital'
  | 'bracelet'
  | 'tab'
  | 'soft_block'
  | 'badge'
  | 'micro'
  | 'terminal'
  | 'ticket_stub'
  | 'chevron'
  | 'burst'
  | 'frame'
  | 'lozenge'
  | 'capsule_duo'
  | 'racer'
  | 'slab'
  | 'countdown_ring'
  | 'hollow_drain'
  | 'pill_progress'
  | 'magnify_timer'
  | 'radar_sweep'
  | 'fuse_burn'
  | 'badge_pop'
  | 'dual_ring_pro'
  | 'segmented_timer'
  | 'warning_mode';

export type VideoProgressStyle =
  | 'package'
  | 'pill'
  | 'segmented'
  | 'blocks'
  | 'glow'
  | 'minimal'
  | 'text_fill';

export type VideoProgressMotion =
  | 'countdown'
  | 'intro_fill'
  | 'intro_sweep';

export type GeneratedProgressBarStyle =
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
  | 'storybook'
  | 'heat'
  | 'voltage'
  | 'sunburst'
  | 'hyperpop'
  | 'laser'
  | 'toxic'
  | 'inferno'
  | 'blackout'
  | 'obsidian_gold'
  | 'chrome_furnace';

export type GeneratedProgressBarRenderMode = 'bar' | 'text_fill';

export type VideoSceneCardStyle =
  | 'package'
  | 'standard'
  | 'scoreboard'
  | 'storybook'
  | 'spotlight'
  | 'celebration';

export type VideoTransitionStyle =
  | 'fade'
  | 'slide'
  | 'zoom'
  | 'pop'
  | 'wipe'
  | 'none';

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
  progressLabel: string;
  revealTitle: string;
  transitionEyebrow: string;
  transitionTitle: string;
  transitionSubtitle: string;
  completionEyebrow: string;
  completionTitle: string;
  completionSubtitle: string;
  puzzleBadgeLabel: string;
}

export interface VideoHeaderTextOverrides {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface AudioPhaseLevels {
  intro: number;
  showing: number;
  revealing: number;
  transitioning: number;
  outro: number;
}

export type VideoAudioCuePoolKey =
  | 'progress_fill_intro'
  | 'puzzle_play'
  | 'low_time_warning'
  | 'marker_reveal'
  | 'blink'
  | 'transition';

export interface VideoAudioCuePool {
  enabled: boolean;
  volume: number;
  sources: string[];
}

export type VideoAudioCuePools = Record<VideoAudioCuePoolKey, VideoAudioCuePool>;

export interface VideoSettings {
  aspectRatio: '16:9' | '9:16';
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
  textStyle: VideoTextStyle;
  headerStyle: VideoHeaderStyle;
  timerStyle: VideoTimerStyle;
  progressStyle: VideoProgressStyle;
  progressMotion: VideoProgressMotion;
  generatedProgressEnabled: boolean;
  generatedProgressStyle: GeneratedProgressBarStyle;
  generatedProgressRenderMode: GeneratedProgressBarRenderMode;
  showTimer: boolean;
  showProgress: boolean;
  introCardStyle: VideoSceneCardStyle;
  transitionCardStyle: VideoSceneCardStyle;
  outroCardStyle: VideoSceneCardStyle;
  sceneSettings: VideoSceneSettings;
  introVideoEnabled: boolean;
  introVideoSrc?: string;
  introVideoDuration?: number;
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
  imagePanelOutlineColor: string;
  imagePanelOutlineThickness: number;
  transitionStyle: VideoTransitionStyle;
  transitionDuration: number; // Seconds
  useCustomLayout?: boolean;
  customLayout?: CustomVideoLayout;
  skipLastPuzzleReveal: boolean; // When true, the last puzzle ends without showing the reveal
  finalCommentPromptText: string; // Optional subtitle-style prompt shown during the last 5 seconds
  finalCommentPromptX: number; // Percentage across the full stage width
  finalCommentPromptY: number; // Percentage across the full stage height
  exportPuzzlesPerVideo: number; // 0 means export the whole selected batch as one video
  exportParallelWorkers: number; // Number of parallel worker renders to use for split exports
  exportResolution: '480p' | '720p' | '1080p' | '1440p' | '2160p';
  exportBitrateMbps: number;
  exportCodec: 'h264' | 'av1';
  soundEffectsEnabled: boolean;
  countdownSoundEnabled: boolean;
  revealSoundEnabled: boolean;
  markerSoundEnabled: boolean;
  blinkSoundEnabled: boolean;
  playSoundEnabled: boolean;
  introSoundEnabled: boolean;
  transitionSoundEnabled: boolean;
  outroSoundEnabled: boolean;
  previewSoundEnabled: boolean;
  soundEffectsVolume: number;
  audioCuePools: VideoAudioCuePools;
  puzzlePlayUrgencyRampEnabled: boolean;
  countdownSoundSrc?: string;
  revealSoundSrc?: string;
  markerSoundSrc?: string;
  blinkSoundSrc?: string;
  playSoundSrc?: string;
  introSoundSrc?: string;
  transitionSoundSrc?: string;
  outroSoundSrc?: string;
  revealSoundVariantSrcs?: string[];
  revealSoundRandomize: boolean;
  countdownSoundOffsetMs: number;
  revealSoundOffsetMs: number;
  backgroundMusicEnabled: boolean;
  backgroundMusicSrc?: string;
  backgroundMusicVolume: number;
  backgroundMusicLoop: boolean;
  backgroundMusicFadeIn: number;
  backgroundMusicFadeOut: number;
  backgroundMusicDuckingAmount: number;
  backgroundMusicOffsetSec: number;
  musicPhaseLevels: AudioPhaseLevels;
  sfxPhaseLevels: AudioPhaseLevels;
  audioLimiterEnabled: boolean;
  logo?: string; // Base64 or URL
  logoZoom: number;
  logoChromaKeyEnabled: boolean;
  logoChromaKeyColor: string;
  logoChromaKeyTolerance: number;
  generatedBackgroundsEnabled: boolean;
  generatedBackgroundCoverage: 'game_area' | 'full_board';
  generatedBackgroundPackId: string;
  generatedBackgroundShuffleSeed: number;
  headerTextOverrides?: VideoHeaderTextOverrides;
}

export type VideoAspectRatio = VideoSettings['aspectRatio'];

export interface AspectLayoutSnapshot {
  aspectRatio: VideoAspectRatio;
  useCustomLayout: boolean;
  customLayout: CustomVideoLayout | null;
}

export type VideoPackageSharedSettings = Omit<
  VideoSettings,
  'aspectRatio' | 'useCustomLayout' | 'customLayout'
>;

export type VideoPackageAspectLayouts = Record<VideoAspectRatio, AspectLayoutSnapshot>;

export interface VideoUserPackage {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number;
  preferredAspectRatio: VideoAspectRatio;
  sharedSettings: VideoPackageSharedSettings;
  aspectLayouts: VideoPackageAspectLayouts;
}

export type GeneratedBackgroundMotifFamily =
  | 'confetti_field'
  | 'paper_cut'
  | 'comic_dots'
  | 'ribbon_swoop'
  | 'blob_garden'
  | 'starburst'
  | 'doodle_parade'
  | 'spark_trails'
  | 'layered_waves'
  | 'sticker_scatter';

export type GeneratedBackgroundPaletteId =
  | 'sunrise'
  | 'mint'
  | 'midnight'
  | 'candy'
  | 'ocean'
  | 'amber';

export type GeneratedBackgroundDetailStyle =
  | 'sprinkles'
  | 'halftone'
  | 'sparkle'
  | 'sticker'
  | 'streamers';

export interface GeneratedBackgroundRecipe {
  id: string;
  name: string;
  seed: number;
  family: GeneratedBackgroundMotifFamily;
  paletteId: GeneratedBackgroundPaletteId;
  density: number;
  accentScale: number;
  contrast: number;
  safeZone: number;
  motionSpeed: number;
  detailStyle: GeneratedBackgroundDetailStyle;
}

export type GeneratedBackgroundSceneKind = GeneratedBackgroundMotifFamily;
export type GeneratedBackgroundPattern = GeneratedBackgroundDetailStyle;
export type GeneratedBackgroundSpec = GeneratedBackgroundRecipe;

export interface GeneratedBackgroundPack {
  id: string;
  name: string;
  description: string;
  aspectRatio: VideoSettings['aspectRatio'];
  createdAt: number;
  updatedAt: number;
  backgrounds: GeneratedBackgroundRecipe[];
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

export type ProcessingMode = 'manual' | 'ultra' | 'auto' | 'ai';

export type GameMode =
  | 'upload'
  | 'splitter'
  | 'image_upscaler'
  | 'timer_mode'
  | 'background_generator'
  | 'frame_extractor'
  | 'edit'
  | 'play'
  | 'video_setup'
  | 'video_play'
  | 'overlay_editor'
  | 'progress_bar'
  | 'watermark_removal';

export type AppRoute =
  | '/'
  | '/create/upload'
  | '/create/review'
  | '/create/editor'
  | '/editor'
  | '/play'
  | '/video/setup'
  | '/video/preview'
  | '/video/overlay'
  | '/tools/thumbnail'
  | '/tools/splitter'
  | '/tools/extractor'
  | '/tools/upscaler'
  | '/tools/vector'
  | '/tools/backgrounds'
  | '/tools/timers'
  | '/tools/progress'
  | '/tools/watermark'
  | '/settings';

export type ExportJobKind =
  | 'video'
  | 'overlay'
  | 'progress'
  | 'super_image'
  | 'super_video';

export type ExportJobState =
  | 'idle'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ExportJobAction {
  id: 'cancel' | 'retry' | 'open';
  label: string;
  href?: string;
  disabled?: boolean;
}

export interface ExportJob {
  id: string;
  kind: ExportJobKind;
  label: string;
  state: ExportJobState;
  progress: number;
  status: string;
  startedAt: number;
  endedAt: number | null;
  errorMessage: string | null;
  outputName?: string;
  actions: ExportJobAction[];
}

export interface ProjectWorkspaceSnapshot {
  puzzle: Puzzle | null;
  batch: Puzzle[];
  playIndex: number;
  incomingVideoFrames: VideoModeTransferFrame[];
}

export interface ProjectVideoSnapshot {
  settings: VideoSettings;
}

export interface ProjectUiSnapshot {
  lastRoute: AppRoute;
}

export interface ProjectRecord {
  kind: 'spotitnow-project';
  version: 1;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
  workspace: ProjectWorkspaceSnapshot;
  video: ProjectVideoSnapshot;
  uiSnapshot: ProjectUiSnapshot;
}
