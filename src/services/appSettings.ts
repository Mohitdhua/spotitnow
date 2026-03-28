import { VideoSettings } from '../types';
import { buildDefaultCustomVideoLayout } from '../constants/videoLayoutCustom';
import {
  DEFAULT_VIDEO_SCENE_SETTINGS,
  DEFAULT_VIDEO_TEXT_TEMPLATES,
  VIDEO_PACKAGE_PRESETS,
  VIDEO_REVEAL_BEHAVIOR_OPTIONS
} from '../constants/videoPackages';
import { sanitizeVideoCustomLayout } from './videoLayoutStorage';
import {
  createDefaultVideoAudioCuePools,
  sanitizeVideoAudioCuePools
} from '../utils/videoAudioPools';

export interface FrameExtractorDefaults {
  timestampsText: string;
  format: 'jpeg' | 'png';
  jpegQuality: number;
  superExportImagesPerVideo: number;
  superImageExportMode: SuperImageExportMode;
  superExportWatermarkRemoval: boolean;
  superExportWatermarkPresetId: string;
}

export interface SplitterDefaults {
  filenamePrefix: string;
  filenamePadDigits: number;
  defaultMode: SplitterModePreference;
}

export interface SplitterSharedRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SplitterSharedPair {
  x: number;
  y: number;
  size: number;
  gap: number;
}

export type SplitterModePreference = 'shared_area' | 'manual_pair';
export type SuperImageExportMode = 'zip' | 'folder';

export interface SplitterSetupSnapshot {
  kind: 'spotdiff-splitter-setup';
  version: 1;
  splitterMode: SplitterModePreference;
  nextSequence: number;
  sharedRegion: SplitterSharedRegion | null;
  sharedPair: SplitterSharedPair | null;
}

export interface SplitterSetupPreset {
  id: string;
  name: string;
  updatedAt: string;
  setup: SplitterSetupSnapshot;
}

export interface AppGlobalSettings {
  videoDefaults: VideoSettings;
  frameExtractorDefaults: FrameExtractorDefaults;
  splitterDefaults: SplitterDefaults;
}

export const APP_GLOBAL_SETTINGS_KEY = 'spotdiff.app-global-settings.v1';
export const SPLITTER_NEXT_SEQUENCE_KEY = 'spotdiff.splitter.next-sequence';
export const SPLITTER_SHARED_REGION_KEY = 'spotdiff.splitter.shared-region';
export const SPLITTER_SHARED_PAIR_KEY = 'spotdiff.splitter.shared-pair';
export const SPLITTER_MODE_KEY = 'spotdiff.splitter.mode';
export const SPLITTER_PRESETS_KEY = 'spotdiff.splitter.presets';

export const DEFAULT_SPLITTER_SETUP: SplitterSetupSnapshot = {
  kind: 'spotdiff-splitter-setup',
  version: 1,
  splitterMode: 'manual_pair',
  nextSequence: 483,
  sharedRegion: {
    x: 0.009895833333333333,
    y: 0.11574074074074074,
    width: 0.9791666666666666,
    height: 0.8685185185185185
  },
  sharedPair: null
};

const DEFAULT_AUDIO_PHASE_LEVELS: VideoSettings['musicPhaseLevels'] = {
  intro: 1,
  showing: 1,
  revealing: 1,
  transitioning: 1,
  outro: 1
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const DEFAULT_VIDEO_SETTINGS: VideoSettings = {
  aspectRatio: '16:9',
  videoPackagePreset: 'gameshow',
  visualStyle: 'classic',
  textStyle: 'package',
  headerStyle: 'package',
  timerStyle: 'package',
  progressStyle: 'package',
  progressMotion: 'countdown',
  generatedProgressEnabled: false,
  generatedProgressStyle: 'classic',
  generatedProgressRenderMode: 'bar',
  showTimer: true,
  showProgress: true,
  introCardStyle: 'package',
  transitionCardStyle: 'package',
  outroCardStyle: 'package',
  sceneSettings: DEFAULT_VIDEO_SCENE_SETTINGS,
  introVideoEnabled: false,
  introVideoSrc: '',
  introVideoDuration: 0,
  textTemplates: DEFAULT_VIDEO_TEXT_TEMPLATES,
  showDuration: 5,
  revealDuration: 6,
  sequentialRevealStep: 1,
  enableBlinking: true,
  blinkSpeed: 0.8,
  circleThickness: 4,
  revealBehavior: 'pulse',
  revealStyle: 'box',
  revealVariant: 'box_glow',
  revealColor: '#FF6B6B',
  outlineColor: '#000000',
  outlineThickness: 2,
  imagePanelOutlineColor: '#CEC3A5',
  imagePanelOutlineThickness: 4,
  transitionStyle: 'fade',
  transitionDuration: 1,
  useCustomLayout: false,
  skipLastPuzzleReveal: false,
  finalCommentPromptText: '',
  finalCommentPromptX: 50,
  finalCommentPromptY: 12,
  exportPuzzlesPerVideo: 0,
  exportParallelWorkers: 1,
  exportResolution: '1080p',
  exportBitrateMbps: 8,
  exportCodec: 'h264',
  soundEffectsEnabled: false,
  countdownSoundEnabled: true,
  revealSoundEnabled: true,
  markerSoundEnabled: false,
  blinkSoundEnabled: false,
  playSoundEnabled: false,
  introSoundEnabled: false,
  transitionSoundEnabled: false,
  outroSoundEnabled: false,
  previewSoundEnabled: false,
  soundEffectsVolume: 0.7,
  audioCuePools: createDefaultVideoAudioCuePools(),
  puzzlePlayUrgencyRampEnabled: false,
  countdownSoundSrc: '',
  revealSoundSrc: '',
  markerSoundSrc: '',
  blinkSoundSrc: '',
  playSoundSrc: '',
  introSoundSrc: '',
  transitionSoundSrc: '',
  outroSoundSrc: '',
  revealSoundVariantSrcs: [],
  revealSoundRandomize: false,
  countdownSoundOffsetMs: 0,
  revealSoundOffsetMs: 0,
  backgroundMusicEnabled: false,
  backgroundMusicSrc: '',
  backgroundMusicVolume: 0.35,
  backgroundMusicLoop: true,
  backgroundMusicFadeIn: 0.3,
  backgroundMusicFadeOut: 0.4,
  backgroundMusicDuckingAmount: 0.5,
  backgroundMusicOffsetSec: 0,
  musicPhaseLevels: DEFAULT_AUDIO_PHASE_LEVELS,
  sfxPhaseLevels: DEFAULT_AUDIO_PHASE_LEVELS,
  audioLimiterEnabled: true,
  logoZoom: 1,
  logoChromaKeyEnabled: false,
  logoChromaKeyColor: '#00FF00',
  logoChromaKeyTolerance: 70,
  generatedBackgroundsEnabled: false,
  generatedBackgroundCoverage: 'game_area',
  generatedBackgroundPackId: '',
  generatedBackgroundShuffleSeed: 1
};

export const DEFAULT_APP_GLOBAL_SETTINGS: AppGlobalSettings = {
  videoDefaults: DEFAULT_VIDEO_SETTINGS,
  frameExtractorDefaults: {
    timestampsText: '00:05.000\n00:10.000',
    format: 'png',
    jpegQuality: 1,
    superExportImagesPerVideo: 5,
    superImageExportMode: 'zip',
    superExportWatermarkRemoval: false,
    superExportWatermarkPresetId: ''
  },
  splitterDefaults: {
    filenamePrefix: 'puzzle',
    filenamePadDigits: 0,
    defaultMode: DEFAULT_SPLITTER_SETUP.splitterMode
  }
};

const sanitizePrefix = (value: unknown) => {
  if (typeof value !== 'string') return DEFAULT_APP_GLOBAL_SETTINGS.splitterDefaults.filenamePrefix;
  const cleaned = value.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '').replace(/\s+/g, '');
  return cleaned || DEFAULT_APP_GLOBAL_SETTINGS.splitterDefaults.filenamePrefix;
};

const sanitizeSharedRegion = (value: unknown): SplitterSharedRegion | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<SplitterSharedRegion>;
  const x = clamp(Number(candidate.x) || 0, 0, 0.9999);
  const y = clamp(Number(candidate.y) || 0, 0, 0.9999);
  const width = clamp(Number(candidate.width) || 0, 0.0001, 1);
  const height = clamp(Number(candidate.height) || 0, 0.0001, 1);
  const safeWidth = clamp(width, 0.0001, 1 - x);
  const safeHeight = clamp(height, 0.0001, 1 - y);

  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(safeWidth) || !Number.isFinite(safeHeight)) {
    return null;
  }

  return {
    x,
    y,
    width: safeWidth,
    height: safeHeight
  };
};

const sanitizeSharedPair = (value: unknown): SplitterSharedPair | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<SplitterSharedPair>;
  const x = clamp(Number(candidate.x) || 0, 0, 1);
  const y = clamp(Number(candidate.y) || 0, 0, 1);
  const size = clamp(Number(candidate.size) || 0, 0.0001, 1);
  const gap = clamp(Number(candidate.gap) || 0, 0, 1);

  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(size) || !Number.isFinite(gap)) {
    return null;
  }

  return {
    x,
    y,
    size,
    gap
  };
};

const sanitizeSplitterMode = (value: unknown): SplitterModePreference =>
  value === 'manual_pair' ? 'manual_pair' : 'shared_area';

const sanitizeSplitterPresetName = (value: unknown) => {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ').slice(0, 80);
};

const sanitizeSplitterSetupSnapshot = (value: unknown): SplitterSetupSnapshot | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<SplitterSetupSnapshot>;
  const nextSequence = Math.max(1, Math.floor(Number(candidate.nextSequence) || 1));

  return {
    kind: 'spotdiff-splitter-setup',
    version: 1,
    splitterMode: sanitizeSplitterMode(candidate.splitterMode),
    nextSequence,
    sharedRegion: sanitizeSharedRegion(candidate.sharedRegion),
    sharedPair: sanitizeSharedPair(candidate.sharedPair)
  };
};

const sanitizeIsoDateString = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) {
    return new Date(0).toISOString();
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date(0).toISOString();
};

const sanitizeSplitterSetupPreset = (value: unknown): SplitterSetupPreset | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<SplitterSetupPreset> & { setup?: unknown };
  const name = sanitizeSplitterPresetName(candidate.name);
  const setup = sanitizeSplitterSetupSnapshot(candidate.setup);
  const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';

  if (!id || !name || !setup) {
    return null;
  }

  return {
    id,
    name,
    updatedAt: sanitizeIsoDateString(candidate.updatedAt),
    setup
  };
};

const sanitizeSplitterSetupPresetList = (value: unknown): SplitterSetupPreset[] => {
  if (!Array.isArray(value)) return [];

  const byId = new Map<string, SplitterSetupPreset>();
  for (const entry of value) {
    const preset = sanitizeSplitterSetupPreset(entry);
    if (!preset) continue;
    const existing = byId.get(preset.id);
    if (!existing || Date.parse(preset.updatedAt) >= Date.parse(existing.updatedAt)) {
      byId.set(preset.id, preset);
    }
  }

  return Array.from(byId.values()).sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
};

const VIDEO_PACKAGE_PRESET_VALUES = Object.keys(VIDEO_PACKAGE_PRESETS) as VideoSettings['videoPackagePreset'][];
const VIDEO_REVEAL_BEHAVIOR_VALUES = VIDEO_REVEAL_BEHAVIOR_OPTIONS.map(
  (option) => option.value
) as VideoSettings['revealBehavior'][];
const ASPECT_RATIO_VALUES: VideoSettings['aspectRatio'][] = ['16:9', '9:16'];
const VISUAL_STYLE_VALUES: VideoSettings['visualStyle'][] = [
  'random',
  'classic',
  'pop',
  'neon',
  'sunset',
  'mint',
  'midnight',
  'mono',
  'retro',
  'cyber',
  'oceanic',
  'ember',
  'candy',
  'forest',
  'aurora',
  'slate',
  'arcade',
  'ivory',
  'storybook'
];
const REVEAL_STYLE_VALUES: VideoSettings['revealStyle'][] = ['box', 'circle', 'highlight'];
const REVEAL_VARIANT_VALUES: VideoSettings['revealVariant'][] = [
  'box_glow',
  'box_dashed',
  'box_corners',
  'box_classic',
  'box_minimal',
  'circle_ring',
  'circle_dotted',
  'circle_ellipse',
  'circle_ellipse_dotted',
  'circle_red_black',
  'circle_classic',
  'circle_crosshair',
  'highlight_soft',
  'highlight_classic'
];
const TEXT_STYLE_VALUES: VideoSettings['textStyle'][] = [
  'package',
  'poster',
  'rounded',
  'mono',
  'storybook',
  'editorial'
];
const HEADER_STYLE_VALUES: VideoSettings['headerStyle'][] = [
  'package',
  'plain',
  'panel',
  'ribbon',
  'split',
  'underline'
];
const TIMER_STYLE_VALUES: VideoSettings['timerStyle'][] = [
  'package',
  'pill',
  'digital',
  'chunky',
  'ticket',
  'minimal',
  'capsule',
  'scoreboard',
  'beacon',
  'retro_flip',
  'neon_chip',
  'sticker',
  'jelly',
  'marquee',
  'glass',
  'notched',
  'orbital',
  'bracelet',
  'tab',
  'soft_block',
  'badge',
  'micro',
  'terminal',
  'ticket_stub',
  'chevron',
  'burst',
  'frame',
  'lozenge',
  'capsule_duo',
  'racer',
  'slab',
  'countdown_ring',
  'hollow_drain',
  'pill_progress',
  'magnify_timer',
  'radar_sweep',
  'fuse_burn',
  'badge_pop',
  'dual_ring_pro',
  'segmented_timer',
  'warning_mode'
];
const PROGRESS_STYLE_VALUES: VideoSettings['progressStyle'][] = [
  'package',
  'pill',
  'segmented',
  'blocks',
  'glow',
  'minimal',
  'text_fill'
];
const PROGRESS_MOTION_VALUES: VideoSettings['progressMotion'][] = [
  'countdown',
  'intro_fill',
  'intro_sweep'
];
const GENERATED_PROGRESS_STYLE_VALUES: VideoSettings['generatedProgressStyle'][] = [
  'random',
  'classic',
  'pop',
  'neon',
  'sunset',
  'mint',
  'midnight',
  'mono',
  'retro',
  'cyber',
  'oceanic',
  'ember',
  'candy',
  'forest',
  'aurora',
  'slate',
  'arcade',
  'ivory',
  'storybook',
  'heat',
  'voltage',
  'sunburst',
  'hyperpop',
  'laser',
  'toxic',
  'inferno',
  'blackout',
  'obsidian_gold',
  'chrome_furnace'
];
const GENERATED_PROGRESS_RENDER_MODE_VALUES: VideoSettings['generatedProgressRenderMode'][] = [
  'bar',
  'text_fill'
];
const SCENE_CARD_STYLE_VALUES: VideoSettings['introCardStyle'][] = [
  'package',
  'standard',
  'scoreboard',
  'storybook',
  'spotlight',
  'celebration'
];
const TRANSITION_STYLE_VALUES: VideoSettings['transitionStyle'][] = [
  'fade',
  'slide',
  'zoom',
  'pop',
  'wipe',
  'none'
];
const EXPORT_RESOLUTION_VALUES: VideoSettings['exportResolution'][] = ['480p', '720p', '1080p', '1440p', '2160p'];
const EXPORT_CODEC_VALUES: VideoSettings['exportCodec'][] = ['h264', 'av1'];

const sanitizeTemplateText = (value: unknown, fallback: string) =>
  typeof value === 'string' ? value.trim() : fallback;

const sanitizeOptionalText = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const sanitizeBoolean = (value: unknown, fallback: boolean) =>
  typeof value === 'boolean' ? value : fallback;

const sanitizeInteger = (value: unknown, fallback: number, min: number, max: number) =>
  clamp(Math.floor(Number(value) || fallback), min, max);

const sanitizeNumber = (value: unknown, fallback: number, min: number, max: number) => {
  const next = Number(value);
  return Number.isFinite(next) ? clamp(next, min, max) : fallback;
};

const sanitizeSuperImageExportMode = (value: unknown): SuperImageExportMode =>
  value === 'folder' ? 'folder' : 'zip';

const sanitizeHexColor = (value: unknown, fallback: string) => {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim();
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(normalized) ? normalized : fallback;
};

const mergeUniqueAudioSources = (...groups: unknown[]) => {
  const seen = new Set<string>();
  const next: string[] = [];
  groups.flat().forEach((value) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    next.push(trimmed);
  });
  return next;
};

const resolveLegacyAudioCuePools = (mergedVideo: Record<string, unknown>) => ({
  progress_fill_intro: {
    enabled: true,
    volume: 1,
    sources: []
  },
  puzzle_play: {
    enabled:
      typeof mergedVideo.playSoundEnabled === 'boolean'
        ? mergedVideo.playSoundEnabled
        : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.audioCuePools.puzzle_play.enabled,
    volume: 1,
    sources: mergeUniqueAudioSources(mergedVideo.playSoundSrc)
  },
  low_time_warning: {
    enabled:
      typeof mergedVideo.countdownSoundEnabled === 'boolean'
        ? mergedVideo.countdownSoundEnabled
        : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.audioCuePools.low_time_warning.enabled,
    volume: 1,
    sources: mergeUniqueAudioSources(mergedVideo.countdownSoundSrc)
  },
  marker_reveal: {
    enabled:
      typeof mergedVideo.markerSoundEnabled === 'boolean'
        ? mergedVideo.markerSoundEnabled
        : typeof mergedVideo.revealSoundEnabled === 'boolean'
        ? mergedVideo.revealSoundEnabled
        : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.audioCuePools.marker_reveal.enabled,
    volume: 1,
    sources: mergeUniqueAudioSources(
      mergedVideo.markerSoundSrc,
      mergedVideo.revealSoundSrc,
      Array.isArray(mergedVideo.revealSoundVariantSrcs) ? mergedVideo.revealSoundVariantSrcs : []
    )
  },
  blink: {
    enabled:
      typeof mergedVideo.blinkSoundEnabled === 'boolean'
        ? mergedVideo.blinkSoundEnabled
        : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.audioCuePools.blink.enabled,
    volume: 1,
    sources: mergeUniqueAudioSources(mergedVideo.blinkSoundSrc)
  },
  transition: {
    enabled:
      typeof mergedVideo.transitionSoundEnabled === 'boolean'
        ? mergedVideo.transitionSoundEnabled
        : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.audioCuePools.transition.enabled,
    volume: 1,
    sources: mergeUniqueAudioSources(mergedVideo.transitionSoundSrc)
  }
});

const mergeSettings = (input?: Partial<AppGlobalSettings>): AppGlobalSettings => {
  const mergedVideo = {
    ...DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults,
    ...(input?.videoDefaults ?? {}),
    sceneSettings: {
      ...DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.sceneSettings,
      ...(input?.videoDefaults?.sceneSettings ?? {})
    },
    textTemplates: {
      ...DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.textTemplates,
      ...(input?.videoDefaults?.textTemplates ?? {})
    }
  } as VideoSettings;
  const legacyMergedVideo = mergedVideo as unknown as Record<string, unknown>;

  const mergedFrame = {
    ...DEFAULT_APP_GLOBAL_SETTINGS.frameExtractorDefaults,
    ...(input?.frameExtractorDefaults ?? {})
  };

  const mergedSplitter = {
    ...DEFAULT_APP_GLOBAL_SETTINGS.splitterDefaults,
    ...(input?.splitterDefaults ?? {})
  };

  const safeAspectRatio = ASPECT_RATIO_VALUES.includes(mergedVideo.aspectRatio)
    ? mergedVideo.aspectRatio
    : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.aspectRatio;
  const safePackagePreset = VIDEO_PACKAGE_PRESET_VALUES.includes(mergedVideo.videoPackagePreset)
    ? mergedVideo.videoPackagePreset
    : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.videoPackagePreset;
  const safeRevealStyle = REVEAL_STYLE_VALUES.includes(mergedVideo.revealStyle)
    ? mergedVideo.revealStyle
    : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.revealStyle;
  const safeRevealVariant = REVEAL_VARIANT_VALUES.includes(mergedVideo.revealVariant)
    ? mergedVideo.revealVariant
    : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.revealVariant;
  const safeCustomLayout =
    sanitizeVideoCustomLayout(mergedVideo.customLayout) ??
    buildDefaultCustomVideoLayout(safePackagePreset, safeAspectRatio);

  return {
    videoDefaults: {
      ...mergedVideo,
      aspectRatio: safeAspectRatio,
      videoPackagePreset: safePackagePreset,
      visualStyle: VISUAL_STYLE_VALUES.includes(mergedVideo.visualStyle)
        ? mergedVideo.visualStyle
        : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.visualStyle,
      textStyle: TEXT_STYLE_VALUES.includes(mergedVideo.textStyle)
        ? mergedVideo.textStyle
        : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.textStyle,
      headerStyle: HEADER_STYLE_VALUES.includes(mergedVideo.headerStyle)
        ? mergedVideo.headerStyle
        : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.headerStyle,
      timerStyle: TIMER_STYLE_VALUES.includes(mergedVideo.timerStyle)
        ? mergedVideo.timerStyle
        : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.timerStyle,
      progressStyle: PROGRESS_STYLE_VALUES.includes(mergedVideo.progressStyle)
        ? mergedVideo.progressStyle
        : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.progressStyle,
      progressMotion: PROGRESS_MOTION_VALUES.includes(mergedVideo.progressMotion)
        ? mergedVideo.progressMotion
        : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.progressMotion,
      generatedProgressEnabled: sanitizeBoolean(
        mergedVideo.generatedProgressEnabled,
        DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.generatedProgressEnabled
      ),
      generatedProgressStyle: GENERATED_PROGRESS_STYLE_VALUES.includes(
        mergedVideo.generatedProgressStyle
      )
        ? mergedVideo.generatedProgressStyle
        : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.generatedProgressStyle,
      generatedProgressRenderMode: GENERATED_PROGRESS_RENDER_MODE_VALUES.includes(
        mergedVideo.generatedProgressRenderMode
      )
        ? mergedVideo.generatedProgressRenderMode
        : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.generatedProgressRenderMode,
      showTimer: sanitizeBoolean(
        mergedVideo.showTimer,
        DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.showTimer
      ),
      showProgress: sanitizeBoolean(
        mergedVideo.showProgress,
        DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.showProgress
      ),
      introCardStyle: SCENE_CARD_STYLE_VALUES.includes(mergedVideo.introCardStyle)
        ? mergedVideo.introCardStyle
        : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.introCardStyle,
      transitionCardStyle: SCENE_CARD_STYLE_VALUES.includes(mergedVideo.transitionCardStyle)
        ? mergedVideo.transitionCardStyle
        : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.transitionCardStyle,
      outroCardStyle: SCENE_CARD_STYLE_VALUES.includes(mergedVideo.outroCardStyle)
        ? mergedVideo.outroCardStyle
        : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.outroCardStyle,
      sceneSettings: {
        introEnabled:
          typeof mergedVideo.sceneSettings?.introEnabled === 'boolean'
            ? mergedVideo.sceneSettings.introEnabled
            : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.sceneSettings.introEnabled,
        introDuration: clamp(Number(mergedVideo.sceneSettings?.introDuration) || 1.5, 0.5, 180),
        outroEnabled:
          typeof mergedVideo.sceneSettings?.outroEnabled === 'boolean'
            ? mergedVideo.sceneSettings.outroEnabled
            : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.sceneSettings.outroEnabled,
        outroDuration: clamp(Number(mergedVideo.sceneSettings?.outroDuration) || 1.5, 0.5, 180)
      },
      introVideoEnabled:
        typeof mergedVideo.introVideoEnabled === 'boolean'
          ? mergedVideo.introVideoEnabled
          : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.introVideoEnabled,
      introVideoSrc:
        typeof mergedVideo.introVideoSrc === 'string'
          ? mergedVideo.introVideoSrc
          : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.introVideoSrc,
      introVideoDuration: Number.isFinite(Number(mergedVideo.introVideoDuration))
        ? Number(mergedVideo.introVideoDuration)
        : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.introVideoDuration,
      textTemplates: {
        introEyebrow: sanitizeTemplateText(
          mergedVideo.textTemplates?.introEyebrow,
          DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.textTemplates.introEyebrow
        ),
        introTitle: sanitizeTemplateText(
          mergedVideo.textTemplates?.introTitle,
          DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.textTemplates.introTitle
        ),
        introSubtitle: sanitizeTemplateText(
          mergedVideo.textTemplates?.introSubtitle,
          DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.textTemplates.introSubtitle
        ),
        playTitle: sanitizeTemplateText(
          mergedVideo.textTemplates?.playTitle,
          DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.textTemplates.playTitle
        ),
        playSubtitle: sanitizeTemplateText(
          mergedVideo.textTemplates?.playSubtitle,
          DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.textTemplates.playSubtitle
        ),
        progressLabel: sanitizeTemplateText(
          mergedVideo.textTemplates?.progressLabel,
          mergedVideo.textTemplates?.playTitle || DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.textTemplates.progressLabel
        ),
        revealTitle: sanitizeTemplateText(
          mergedVideo.textTemplates?.revealTitle,
          DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.textTemplates.revealTitle
        ),
        transitionEyebrow: sanitizeTemplateText(
          mergedVideo.textTemplates?.transitionEyebrow,
          DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.textTemplates.transitionEyebrow
        ),
        transitionTitle: sanitizeTemplateText(
          mergedVideo.textTemplates?.transitionTitle,
          DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.textTemplates.transitionTitle
        ),
        transitionSubtitle: sanitizeTemplateText(
          mergedVideo.textTemplates?.transitionSubtitle,
          DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.textTemplates.transitionSubtitle
        ),
        completionEyebrow: sanitizeTemplateText(
          mergedVideo.textTemplates?.completionEyebrow,
          DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.textTemplates.completionEyebrow
        ),
        completionTitle: sanitizeTemplateText(
          mergedVideo.textTemplates?.completionTitle,
          DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.textTemplates.completionTitle
        ),
        completionSubtitle: sanitizeTemplateText(
          mergedVideo.textTemplates?.completionSubtitle,
          DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.textTemplates.completionSubtitle
        ),
        puzzleBadgeLabel: sanitizeTemplateText(
          mergedVideo.textTemplates?.puzzleBadgeLabel,
          DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.textTemplates.puzzleBadgeLabel
        )
      },
      showDuration: clamp(Number(mergedVideo.showDuration) || 1, 1, 90),
      revealDuration: clamp(Number(mergedVideo.revealDuration) || 1, 1, 60),
      sequentialRevealStep: clamp(Number(mergedVideo.sequentialRevealStep) || 0.5, 0.5, 10),
      enableBlinking:
        typeof mergedVideo.enableBlinking === 'boolean'
          ? mergedVideo.enableBlinking
          : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.enableBlinking,
      blinkSpeed: clamp(Number(mergedVideo.blinkSpeed) || 0.5, 0.2, 5),
      circleThickness: clamp(Number(mergedVideo.circleThickness) || 1, 1, 30),
      revealBehavior: VIDEO_REVEAL_BEHAVIOR_VALUES.includes(mergedVideo.revealBehavior)
        ? mergedVideo.revealBehavior
        : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.revealBehavior,
      revealStyle: safeRevealStyle,
      revealVariant: safeRevealVariant,
      revealColor: sanitizeHexColor(
        mergedVideo.revealColor,
        DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.revealColor
      ),
      outlineColor: sanitizeHexColor(
        mergedVideo.outlineColor,
        DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.outlineColor
      ),
      outlineThickness: clamp(Number(mergedVideo.outlineThickness) || 0, 0, 20),
      imagePanelOutlineColor: sanitizeHexColor(
        mergedVideo.imagePanelOutlineColor,
        DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.imagePanelOutlineColor
      ),
      imagePanelOutlineThickness: clamp(
        Number(mergedVideo.imagePanelOutlineThickness) || 0,
        0,
        24
      ),
      transitionStyle: TRANSITION_STYLE_VALUES.includes(mergedVideo.transitionStyle)
        ? mergedVideo.transitionStyle
        : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.transitionStyle,
      transitionDuration: clamp(Number(mergedVideo.transitionDuration) || 0, 0, 5),
      useCustomLayout: sanitizeBoolean(
        mergedVideo.useCustomLayout,
        Boolean(DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.useCustomLayout)
      ),
      customLayout: safeCustomLayout,
      skipLastPuzzleReveal: sanitizeBoolean(
        mergedVideo.skipLastPuzzleReveal,
        DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.skipLastPuzzleReveal
      ),
      finalCommentPromptText:
        typeof mergedVideo.finalCommentPromptText === 'string'
          ? mergedVideo.finalCommentPromptText
          : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.finalCommentPromptText,
      finalCommentPromptX: Number.isFinite(Number(mergedVideo.finalCommentPromptX))
        ? clamp(Number(mergedVideo.finalCommentPromptX), 0, 100)
        : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.finalCommentPromptX,
      finalCommentPromptY: Number.isFinite(Number(mergedVideo.finalCommentPromptY))
        ? clamp(Number(mergedVideo.finalCommentPromptY), 0, 100)
        : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.finalCommentPromptY,
      exportPuzzlesPerVideo: clamp(
        Math.floor(Number(mergedVideo.exportPuzzlesPerVideo) || 0),
        0,
        500
      ),
      exportParallelWorkers: clamp(
        Math.floor(Number(mergedVideo.exportParallelWorkers) || 1),
        1,
        4
      ),
      exportResolution: EXPORT_RESOLUTION_VALUES.includes(mergedVideo.exportResolution)
        ? mergedVideo.exportResolution
        : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.exportResolution,
      exportBitrateMbps: clamp(Number(mergedVideo.exportBitrateMbps) || 1, 1, 80),
      exportCodec: EXPORT_CODEC_VALUES.includes(mergedVideo.exportCodec)
        ? mergedVideo.exportCodec
        : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.exportCodec,
      soundEffectsEnabled: sanitizeBoolean(
        mergedVideo.soundEffectsEnabled,
        DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.soundEffectsEnabled
      ),
      countdownSoundEnabled: sanitizeBoolean(
        mergedVideo.countdownSoundEnabled,
        DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.countdownSoundEnabled
      ),
      revealSoundEnabled: sanitizeBoolean(
        mergedVideo.revealSoundEnabled,
        DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.revealSoundEnabled
      ),
      markerSoundEnabled: sanitizeBoolean(
        mergedVideo.markerSoundEnabled,
        DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.markerSoundEnabled
      ),
      blinkSoundEnabled: sanitizeBoolean(
        mergedVideo.blinkSoundEnabled,
        DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.blinkSoundEnabled
      ),
      playSoundEnabled: sanitizeBoolean(
        mergedVideo.playSoundEnabled,
        DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.playSoundEnabled
      ),
      introSoundEnabled: sanitizeBoolean(
        mergedVideo.introSoundEnabled,
        DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.introSoundEnabled
      ),
      transitionSoundEnabled: sanitizeBoolean(
        mergedVideo.transitionSoundEnabled,
        DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.transitionSoundEnabled
      ),
      outroSoundEnabled: sanitizeBoolean(
        mergedVideo.outroSoundEnabled,
        DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.outroSoundEnabled
      ),
      previewSoundEnabled: sanitizeBoolean(
        mergedVideo.previewSoundEnabled,
        DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.previewSoundEnabled
      ),
      soundEffectsVolume: clamp(
        Number.isFinite(Number(mergedVideo.soundEffectsVolume))
          ? Number(mergedVideo.soundEffectsVolume)
          : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.soundEffectsVolume,
        0,
        1
      ),
      audioCuePools: sanitizeVideoAudioCuePools(
        legacyMergedVideo.audioCuePools ?? resolveLegacyAudioCuePools(legacyMergedVideo),
        DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.audioCuePools
      ),
      puzzlePlayUrgencyRampEnabled: sanitizeBoolean(
        mergedVideo.puzzlePlayUrgencyRampEnabled,
        DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.puzzlePlayUrgencyRampEnabled
      ),
      countdownSoundSrc:
        typeof mergedVideo.countdownSoundSrc === 'string'
          ? mergedVideo.countdownSoundSrc
          : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.countdownSoundSrc,
      revealSoundSrc:
        typeof mergedVideo.revealSoundSrc === 'string'
          ? mergedVideo.revealSoundSrc
          : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.revealSoundSrc,
      markerSoundSrc:
        typeof mergedVideo.markerSoundSrc === 'string'
          ? mergedVideo.markerSoundSrc
          : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.markerSoundSrc,
      blinkSoundSrc:
        typeof mergedVideo.blinkSoundSrc === 'string'
          ? mergedVideo.blinkSoundSrc
          : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.blinkSoundSrc,
      playSoundSrc:
        typeof mergedVideo.playSoundSrc === 'string'
          ? mergedVideo.playSoundSrc
          : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.playSoundSrc,
      introSoundSrc:
        typeof mergedVideo.introSoundSrc === 'string'
          ? mergedVideo.introSoundSrc
          : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.introSoundSrc,
      transitionSoundSrc:
        typeof mergedVideo.transitionSoundSrc === 'string'
          ? mergedVideo.transitionSoundSrc
          : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.transitionSoundSrc,
      outroSoundSrc:
        typeof mergedVideo.outroSoundSrc === 'string'
          ? mergedVideo.outroSoundSrc
          : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.outroSoundSrc,
      revealSoundVariantSrcs: Array.isArray(mergedVideo.revealSoundVariantSrcs)
        ? mergedVideo.revealSoundVariantSrcs.filter((value) => typeof value === 'string')
        : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.revealSoundVariantSrcs,
      revealSoundRandomize: sanitizeBoolean(
        mergedVideo.revealSoundRandomize,
        DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.revealSoundRandomize
      ),
      countdownSoundOffsetMs: clamp(
        Number.isFinite(Number(mergedVideo.countdownSoundOffsetMs))
          ? Number(mergedVideo.countdownSoundOffsetMs)
          : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.countdownSoundOffsetMs,
        -2000,
        2000
      ),
      revealSoundOffsetMs: clamp(
        Number.isFinite(Number(mergedVideo.revealSoundOffsetMs))
          ? Number(mergedVideo.revealSoundOffsetMs)
          : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.revealSoundOffsetMs,
        -2000,
        2000
      ),
      backgroundMusicEnabled: sanitizeBoolean(
        mergedVideo.backgroundMusicEnabled,
        DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.backgroundMusicEnabled
      ),
      backgroundMusicSrc:
        typeof mergedVideo.backgroundMusicSrc === 'string'
          ? mergedVideo.backgroundMusicSrc
          : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.backgroundMusicSrc,
      backgroundMusicVolume: clamp(
        Number.isFinite(Number(mergedVideo.backgroundMusicVolume))
          ? Number(mergedVideo.backgroundMusicVolume)
          : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.backgroundMusicVolume,
        0,
        1
      ),
      backgroundMusicLoop: sanitizeBoolean(
        mergedVideo.backgroundMusicLoop,
        DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.backgroundMusicLoop
      ),
      backgroundMusicFadeIn: clamp(
        Number.isFinite(Number(mergedVideo.backgroundMusicFadeIn))
          ? Number(mergedVideo.backgroundMusicFadeIn)
          : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.backgroundMusicFadeIn,
        0,
        10
      ),
      backgroundMusicFadeOut: clamp(
        Number.isFinite(Number(mergedVideo.backgroundMusicFadeOut))
          ? Number(mergedVideo.backgroundMusicFadeOut)
          : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.backgroundMusicFadeOut,
        0,
        10
      ),
      backgroundMusicDuckingAmount: clamp(
        Number.isFinite(Number(mergedVideo.backgroundMusicDuckingAmount))
          ? Number(mergedVideo.backgroundMusicDuckingAmount)
          : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.backgroundMusicDuckingAmount,
        0,
        1
      ),
      backgroundMusicOffsetSec: clamp(
        Number.isFinite(Number(mergedVideo.backgroundMusicOffsetSec))
          ? Number(mergedVideo.backgroundMusicOffsetSec)
          : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.backgroundMusicOffsetSec,
        0,
        60
      ),
      musicPhaseLevels: {
        intro: clamp(
          Number.isFinite(Number(mergedVideo.musicPhaseLevels?.intro))
            ? Number(mergedVideo.musicPhaseLevels?.intro)
            : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.musicPhaseLevels.intro,
          0,
          1
        ),
        showing: clamp(
          Number.isFinite(Number(mergedVideo.musicPhaseLevels?.showing))
            ? Number(mergedVideo.musicPhaseLevels?.showing)
            : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.musicPhaseLevels.showing,
          0,
          1
        ),
        revealing: clamp(
          Number.isFinite(Number(mergedVideo.musicPhaseLevels?.revealing))
            ? Number(mergedVideo.musicPhaseLevels?.revealing)
            : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.musicPhaseLevels.revealing,
          0,
          1
        ),
        transitioning: clamp(
          Number.isFinite(Number(mergedVideo.musicPhaseLevels?.transitioning))
            ? Number(mergedVideo.musicPhaseLevels?.transitioning)
            : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.musicPhaseLevels.transitioning,
          0,
          1
        ),
        outro: clamp(
          Number.isFinite(Number(mergedVideo.musicPhaseLevels?.outro))
            ? Number(mergedVideo.musicPhaseLevels?.outro)
            : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.musicPhaseLevels.outro,
          0,
          1
        )
      },
      sfxPhaseLevels: {
        intro: clamp(
          Number.isFinite(Number(mergedVideo.sfxPhaseLevels?.intro))
            ? Number(mergedVideo.sfxPhaseLevels?.intro)
            : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.sfxPhaseLevels.intro,
          0,
          1
        ),
        showing: clamp(
          Number.isFinite(Number(mergedVideo.sfxPhaseLevels?.showing))
            ? Number(mergedVideo.sfxPhaseLevels?.showing)
            : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.sfxPhaseLevels.showing,
          0,
          1
        ),
        revealing: clamp(
          Number.isFinite(Number(mergedVideo.sfxPhaseLevels?.revealing))
            ? Number(mergedVideo.sfxPhaseLevels?.revealing)
            : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.sfxPhaseLevels.revealing,
          0,
          1
        ),
        transitioning: clamp(
          Number.isFinite(Number(mergedVideo.sfxPhaseLevels?.transitioning))
            ? Number(mergedVideo.sfxPhaseLevels?.transitioning)
            : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.sfxPhaseLevels.transitioning,
          0,
          1
        ),
        outro: clamp(
          Number.isFinite(Number(mergedVideo.sfxPhaseLevels?.outro))
            ? Number(mergedVideo.sfxPhaseLevels?.outro)
            : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.sfxPhaseLevels.outro,
          0,
          1
        )
      },
      audioLimiterEnabled: sanitizeBoolean(
        mergedVideo.audioLimiterEnabled,
        DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.audioLimiterEnabled
      ),
      logo:
        typeof mergedVideo.logo === 'string' && mergedVideo.logo.trim()
          ? mergedVideo.logo
          : undefined,
      logoZoom: clamp(Number(mergedVideo.logoZoom) || 1, 0.5, 4),
      logoChromaKeyEnabled:
        typeof mergedVideo.logoChromaKeyEnabled === 'boolean'
          ? mergedVideo.logoChromaKeyEnabled
          : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.logoChromaKeyEnabled,
      logoChromaKeyColor: sanitizeHexColor(
        mergedVideo.logoChromaKeyColor,
        DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.logoChromaKeyColor
      ),
      logoChromaKeyTolerance: clamp(
        Number(mergedVideo.logoChromaKeyTolerance) || 0,
        0,
        255
      ),
      generatedBackgroundsEnabled: sanitizeBoolean(
        mergedVideo.generatedBackgroundsEnabled,
        DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.generatedBackgroundsEnabled
      ),
      generatedBackgroundCoverage:
        mergedVideo.generatedBackgroundCoverage === 'full_board' ||
        mergedVideo.generatedBackgroundCoverage === 'game_area'
          ? mergedVideo.generatedBackgroundCoverage
          : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.generatedBackgroundCoverage,
      generatedBackgroundPackId: sanitizeOptionalText(mergedVideo.generatedBackgroundPackId),
      generatedBackgroundShuffleSeed: sanitizeInteger(
        mergedVideo.generatedBackgroundShuffleSeed,
        DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.generatedBackgroundShuffleSeed,
        1,
        9999
      )
    },
    frameExtractorDefaults: {
      timestampsText:
        typeof mergedFrame.timestampsText === 'string'
          ? mergedFrame.timestampsText
          : DEFAULT_APP_GLOBAL_SETTINGS.frameExtractorDefaults.timestampsText,
      format: mergedFrame.format === 'png' ? 'png' : 'jpeg',
      jpegQuality: clamp(Number(mergedFrame.jpegQuality) || DEFAULT_APP_GLOBAL_SETTINGS.frameExtractorDefaults.jpegQuality, 0.5, 1),
      superExportImagesPerVideo: clamp(Math.floor(Number(mergedFrame.superExportImagesPerVideo) || 5), 1, 20),
      superImageExportMode: sanitizeSuperImageExportMode(mergedFrame.superImageExportMode),
      superExportWatermarkRemoval: sanitizeBoolean(
        mergedFrame.superExportWatermarkRemoval,
        DEFAULT_APP_GLOBAL_SETTINGS.frameExtractorDefaults.superExportWatermarkRemoval
      ),
      superExportWatermarkPresetId: sanitizeOptionalText(mergedFrame.superExportWatermarkPresetId)
    },
    splitterDefaults: {
      filenamePrefix: sanitizePrefix(mergedSplitter.filenamePrefix),
      filenamePadDigits: clamp(Math.floor(Number(mergedSplitter.filenamePadDigits) || 0), 0, 8),
      defaultMode: sanitizeSplitterMode(mergedSplitter.defaultMode)
    }
  };
};

export const sanitizeAppGlobalSettings = (input?: Partial<AppGlobalSettings>): AppGlobalSettings =>
  mergeSettings(input);

export const loadAppGlobalSettings = (): AppGlobalSettings => {
  if (typeof window === 'undefined') return DEFAULT_APP_GLOBAL_SETTINGS;

  try {
    const raw = window.localStorage.getItem(APP_GLOBAL_SETTINGS_KEY);
    if (!raw) return DEFAULT_APP_GLOBAL_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppGlobalSettings>;
    return mergeSettings(parsed);
  } catch {
    return DEFAULT_APP_GLOBAL_SETTINGS;
  }
};

export const saveAppGlobalSettings = (settings: AppGlobalSettings) => {
  if (typeof window === 'undefined') return;
  const safeSettings = mergeSettings(settings);
  window.localStorage.setItem(APP_GLOBAL_SETTINGS_KEY, JSON.stringify(safeSettings));
};

export const resetAppGlobalSettings = (): AppGlobalSettings => {
  saveAppGlobalSettings(DEFAULT_APP_GLOBAL_SETTINGS);
  return DEFAULT_APP_GLOBAL_SETTINGS;
};

export const readSplitterNextSequence = () => {
  if (typeof window === 'undefined') return DEFAULT_SPLITTER_SETUP.nextSequence;
  const raw = window.localStorage.getItem(SPLITTER_NEXT_SEQUENCE_KEY);
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SPLITTER_SETUP.nextSequence;
};

export const setSplitterNextSequence = (nextSequence: number) => {
  if (typeof window === 'undefined') return;
  const safe = Math.max(1, Math.floor(nextSequence));
  window.localStorage.setItem(SPLITTER_NEXT_SEQUENCE_KEY, String(safe));
};

export const readSplitterSharedRegion = (): SplitterSharedRegion | null => {
  if (typeof window === 'undefined') return DEFAULT_SPLITTER_SETUP.sharedRegion;

  try {
    const raw = window.localStorage.getItem(SPLITTER_SHARED_REGION_KEY);
    if (!raw) return DEFAULT_SPLITTER_SETUP.sharedRegion;
    return sanitizeSharedRegion(JSON.parse(raw)) ?? DEFAULT_SPLITTER_SETUP.sharedRegion;
  } catch {
    return DEFAULT_SPLITTER_SETUP.sharedRegion;
  }
};

export const saveSplitterSharedRegion = (region: SplitterSharedRegion) => {
  if (typeof window === 'undefined') return;
  const safeRegion = sanitizeSharedRegion(region);
  if (!safeRegion) return;
  window.localStorage.setItem(SPLITTER_SHARED_REGION_KEY, JSON.stringify(safeRegion));
};

export const clearSplitterSharedRegion = () => {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(SPLITTER_SHARED_REGION_KEY);
};

export const readSplitterSharedPair = (): SplitterSharedPair | null => {
  if (typeof window === 'undefined') return DEFAULT_SPLITTER_SETUP.sharedPair;

  try {
    const raw = window.localStorage.getItem(SPLITTER_SHARED_PAIR_KEY);
    if (!raw) return DEFAULT_SPLITTER_SETUP.sharedPair;
    return sanitizeSharedPair(JSON.parse(raw)) ?? DEFAULT_SPLITTER_SETUP.sharedPair;
  } catch {
    return DEFAULT_SPLITTER_SETUP.sharedPair;
  }
};

export const saveSplitterSharedPair = (pair: SplitterSharedPair) => {
  if (typeof window === 'undefined') return;
  const safePair = sanitizeSharedPair(pair);
  if (!safePair) return;
  window.localStorage.setItem(SPLITTER_SHARED_PAIR_KEY, JSON.stringify(safePair));
};

export const clearSplitterSharedPair = () => {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(SPLITTER_SHARED_PAIR_KEY);
};

export const readSplitterMode = (): SplitterModePreference => {
  if (typeof window === 'undefined') return DEFAULT_APP_GLOBAL_SETTINGS.splitterDefaults.defaultMode;

  try {
    const stored = window.localStorage.getItem(SPLITTER_MODE_KEY);
    if (stored) {
      return sanitizeSplitterMode(stored);
    }
    return loadAppGlobalSettings().splitterDefaults.defaultMode;
  } catch {
    return DEFAULT_APP_GLOBAL_SETTINGS.splitterDefaults.defaultMode;
  }
};

export const saveSplitterMode = (mode: SplitterModePreference) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SPLITTER_MODE_KEY, sanitizeSplitterMode(mode));
};

export const loadSplitterSetupPresets = (): SplitterSetupPreset[] => {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(SPLITTER_PRESETS_KEY);
    if (!raw) return [];
    return sanitizeSplitterSetupPresetList(JSON.parse(raw));
  } catch {
    return [];
  }
};

export const replaceSplitterSetupPresets = (value: unknown): SplitterSetupPreset[] => {
  const safePresets = sanitizeSplitterSetupPresetList(value);
  if (typeof window !== 'undefined') {
    if (safePresets.length > 0) {
      window.localStorage.setItem(SPLITTER_PRESETS_KEY, JSON.stringify(safePresets));
    } else {
      window.localStorage.removeItem(SPLITTER_PRESETS_KEY);
    }
  }
  return safePresets;
};

export const saveSplitterSetupPreset = (input: {
  id?: string;
  name: string;
  splitterMode: SplitterModePreference;
  nextSequence: number;
  sharedRegion: SplitterSharedRegion | null;
  sharedPair: SplitterSharedPair | null;
}): SplitterSetupPreset | null => {
  const name = sanitizeSplitterPresetName(input.name);
  if (!name) return null;

  const preset: SplitterSetupPreset = {
    id: typeof input.id === 'string' && input.id.trim()
      ? input.id.trim()
      : `splitter-preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    updatedAt: new Date().toISOString(),
    setup: createSplitterSetupSnapshot({
      splitterMode: input.splitterMode,
      nextSequence: input.nextSequence,
      sharedRegion: input.sharedRegion,
      sharedPair: input.sharedPair
    })
  };

  replaceSplitterSetupPresets([
    preset,
    ...loadSplitterSetupPresets().filter((existing) => existing.id !== preset.id)
  ]);

  return preset;
};

export const deleteSplitterSetupPreset = (id: string): SplitterSetupPreset[] => {
  const safeId = typeof id === 'string' ? id.trim() : '';
  if (!safeId) return loadSplitterSetupPresets();
  return replaceSplitterSetupPresets(
    loadSplitterSetupPresets().filter((preset) => preset.id !== safeId)
  );
};

export const createSplitterSetupSnapshot = (input: {
  splitterMode: SplitterModePreference;
  nextSequence: number;
  sharedRegion: SplitterSharedRegion | null;
  sharedPair: SplitterSharedPair | null;
}): SplitterSetupSnapshot => ({
  kind: 'spotdiff-splitter-setup',
  version: 1,
  splitterMode: sanitizeSplitterMode(input.splitterMode),
  nextSequence: Math.max(1, Math.floor(input.nextSequence)),
  sharedRegion: sanitizeSharedRegion(input.sharedRegion),
  sharedPair: sanitizeSharedPair(input.sharedPair)
});

export const parseSplitterSetupSnapshot = (raw: string): SplitterSetupSnapshot | null => {
  try {
    return sanitizeSplitterSetupSnapshot(JSON.parse(raw));
  } catch {
    return null;
  }
};

export const readCurrentSplitterSetupSnapshot = (): SplitterSetupSnapshot =>
  createSplitterSetupSnapshot({
    splitterMode: readSplitterMode(),
    nextSequence: readSplitterNextSequence(),
    sharedRegion: readSplitterSharedRegion(),
    sharedPair: readSplitterSharedPair()
  });

export const applySplitterSetupSnapshot = (snapshot: SplitterSetupSnapshot) => {
  const safeSnapshot = sanitizeSplitterSetupSnapshot(snapshot);
  if (!safeSnapshot) {
    return DEFAULT_SPLITTER_SETUP;
  }

  saveSplitterMode(safeSnapshot.splitterMode);
  setSplitterNextSequence(safeSnapshot.nextSequence);

  if (safeSnapshot.sharedRegion) {
    saveSplitterSharedRegion(safeSnapshot.sharedRegion);
  } else {
    clearSplitterSharedRegion();
  }

  if (safeSnapshot.sharedPair) {
    saveSplitterSharedPair(safeSnapshot.sharedPair);
  } else {
    clearSplitterSharedPair();
  }

  return safeSnapshot;
};
