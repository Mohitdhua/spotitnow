import { VideoSettings } from '../types';
import { buildDefaultCustomVideoLayout } from '../constants/videoLayoutCustom';
import {
  DEFAULT_VIDEO_SCENE_SETTINGS,
  DEFAULT_VIDEO_TEXT_TEMPLATES,
  VIDEO_PACKAGE_PRESETS,
  VIDEO_REVEAL_BEHAVIOR_OPTIONS
} from '../constants/videoPackages';
import { sanitizeVideoCustomLayout } from './videoLayoutStorage';

export interface FrameExtractorDefaults {
  timestampsText: string;
  format: 'jpeg' | 'png';
  jpegQuality: number;
  superExportImagesPerVideo: number;
  superImageExportMode: SuperImageExportMode;
  superExportWatermarkRemoval: boolean;
  superExportWatermarkPresetId: string;
  useSceneCopyPresetForSuperExport: boolean;
  sceneCopyPresetId: string;
  useSavedVideoLayoutForSuperExport: boolean;
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

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const DEFAULT_VIDEO_SETTINGS: VideoSettings = {
  aspectRatio: '16:9',
  videoPackagePreset: 'gameshow',
  visualStyle: 'classic',
  sceneSettings: DEFAULT_VIDEO_SCENE_SETTINGS,
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
  transitionStyle: 'fade',
  transitionDuration: 1,
  useCustomLayout: false,
  exportResolution: '1080p',
  exportBitrateMbps: 8,
  exportCodec: 'h264',
  logoZoom: 1,
  logoChromaKeyEnabled: false,
  logoChromaKeyColor: '#00FF00',
  logoChromaKeyTolerance: 70,
  generatedBackgroundsEnabled: false,
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
    superExportWatermarkPresetId: '',
    useSceneCopyPresetForSuperExport: false,
    sceneCopyPresetId: '',
    useSavedVideoLayoutForSuperExport: false
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

const VIDEO_PACKAGE_PRESET_VALUES = Object.keys(VIDEO_PACKAGE_PRESETS) as VideoSettings['videoPackagePreset'][];
const VIDEO_REVEAL_BEHAVIOR_VALUES = VIDEO_REVEAL_BEHAVIOR_OPTIONS.map(
  (option) => option.value
) as VideoSettings['revealBehavior'][];
const ASPECT_RATIO_VALUES: VideoSettings['aspectRatio'][] = ['16:9', '9:16', '1:1', '4:3'];
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
const TRANSITION_STYLE_VALUES: VideoSettings['transitionStyle'][] = ['fade', 'slide', 'none'];
const EXPORT_RESOLUTION_VALUES: VideoSettings['exportResolution'][] = ['480p', '720p', '1080p', '1440p', '2160p'];
const EXPORT_CODEC_VALUES: VideoSettings['exportCodec'][] = ['h264', 'av1'];

const sanitizeTemplateText = (value: unknown, fallback: string) =>
  typeof value === 'string' ? value.trim() || fallback : fallback;

const sanitizeOptionalText = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const sanitizeBoolean = (value: unknown, fallback: boolean) =>
  typeof value === 'boolean' ? value : fallback;

const sanitizeInteger = (value: unknown, fallback: number, min: number, max: number) =>
  clamp(Math.floor(Number(value) || fallback), min, max);

const sanitizeSuperImageExportMode = (value: unknown): SuperImageExportMode =>
  value === 'folder' ? 'folder' : 'zip';

const sanitizeHexColor = (value: unknown, fallback: string) => {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim();
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(normalized) ? normalized : fallback;
};

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
      sceneSettings: {
        introEnabled:
          typeof mergedVideo.sceneSettings?.introEnabled === 'boolean'
            ? mergedVideo.sceneSettings.introEnabled
            : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.sceneSettings.introEnabled,
        introDuration: clamp(Number(mergedVideo.sceneSettings?.introDuration) || 1.5, 0.5, 10),
        outroEnabled:
          typeof mergedVideo.sceneSettings?.outroEnabled === 'boolean'
            ? mergedVideo.sceneSettings.outroEnabled
            : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.sceneSettings.outroEnabled,
        outroDuration: clamp(Number(mergedVideo.sceneSettings?.outroDuration) || 1.5, 0.5, 10)
      },
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
      transitionStyle: TRANSITION_STYLE_VALUES.includes(mergedVideo.transitionStyle)
        ? mergedVideo.transitionStyle
        : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.transitionStyle,
      transitionDuration: clamp(Number(mergedVideo.transitionDuration) || 0, 0, 5),
      useCustomLayout: sanitizeBoolean(
        mergedVideo.useCustomLayout,
        Boolean(DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.useCustomLayout)
      ),
      customLayout: safeCustomLayout,
      exportResolution: EXPORT_RESOLUTION_VALUES.includes(mergedVideo.exportResolution)
        ? mergedVideo.exportResolution
        : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.exportResolution,
      exportBitrateMbps: clamp(Number(mergedVideo.exportBitrateMbps) || 1, 1, 80),
      exportCodec: EXPORT_CODEC_VALUES.includes(mergedVideo.exportCodec)
        ? mergedVideo.exportCodec
        : DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults.exportCodec,
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
      superExportWatermarkPresetId: sanitizeOptionalText(mergedFrame.superExportWatermarkPresetId),
      useSceneCopyPresetForSuperExport: sanitizeBoolean(
        mergedFrame.useSceneCopyPresetForSuperExport,
        DEFAULT_APP_GLOBAL_SETTINGS.frameExtractorDefaults.useSceneCopyPresetForSuperExport
      ),
      sceneCopyPresetId: sanitizeOptionalText(mergedFrame.sceneCopyPresetId),
      useSavedVideoLayoutForSuperExport: sanitizeBoolean(
        mergedFrame.useSavedVideoLayoutForSuperExport,
        DEFAULT_APP_GLOBAL_SETTINGS.frameExtractorDefaults.useSavedVideoLayoutForSuperExport
      )
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
