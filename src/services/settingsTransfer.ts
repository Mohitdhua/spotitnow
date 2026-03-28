import type { CustomVideoLayout, GeneratedBackgroundPack, VideoSettings } from '../types';
import type { WatermarkSelectionPreset } from './watermarkRemoval';
import {
  applySplitterSetupSnapshot,
  loadSplitterSetupPresets,
  loadAppGlobalSettings,
  readCurrentSplitterSetupSnapshot,
  replaceSplitterSetupPresets,
  sanitizeAppGlobalSettings,
  saveAppGlobalSettings,
  type AppGlobalSettings,
  type SplitterSetupPreset,
  type SplitterSetupSnapshot
} from './appSettings';
import { loadGameAudioMuted, saveGameAudioMuted } from './gameAudio';
import {
  loadFrameTimestampPresets,
  replaceFrameTimestampPresets,
  type FrameTimestampPreset
} from './frameTimestampPresets';
import {
  loadSavedVideoCustomLayout,
  replaceSavedVideoCustomLayout,
  sanitizeVideoCustomLayout
} from './videoLayoutStorage';
import {
  replaceVideoSceneCopyPresets,
} from './videoSceneCopyPresets';
import {
  loadVideoStyleLabPresets,
  replaceVideoStyleLabPresets
} from './videoStyleLabPresets';
import {
  loadVideoUserPackageLibrary,
  replaceVideoUserPackageLibrary
} from './videoUserPackages';
import type { VideoUserPackage } from '../types';
import {
  loadGeneratedBackgroundPacks,
  replaceGeneratedBackgroundPacks
} from './backgroundPacks';
import {
  exportStoredImageAssetMap,
  importStoredImageAssetMap
} from './imageAssetStore';
import {
  exportStoredAudioAssetMap,
  importStoredAudioAssetMap
} from './audioAssetStore';
import { loadWatermarkPresets, replaceWatermarkPresets } from './watermarkPresets';
import { VIDEO_AUDIO_POOL_KEYS } from '../utils/videoAudioPools';

export interface AppSettingsTransferBundle {
  kind: 'spotitnow-settings-transfer@v6';
  version: 6;
  exportedAt: string;
  appSettings: AppGlobalSettings;
  splitterSetup: SplitterSetupSnapshot;
  splitterPresets: SplitterSetupPreset[];
  timestampPresets: FrameTimestampPreset[];
  watermarkPresets: WatermarkSelectionPreset[];
  videoPackages: VideoUserPackage[];
  lastSelectedVideoPackageId: string;
  backgroundPacks: GeneratedBackgroundPack[];
  savedVideoLayout: CustomVideoLayout | null;
  gameAudioMuted: boolean;
  imageAssets?: Record<string, string>;
  audioAssets?: Record<string, string>;
}

export interface ApplyAppSettingsTransferResult {
  appSettings: AppGlobalSettings;
  splitterSetup: SplitterSetupSnapshot;
  splitterPresetCount: number;
  timestampPresetCount: number;
  watermarkPresetCount: number;
  videoPackageCount: number;
  migratedLegacyStyleLabPresetCount: number;
  backgroundPackCount: number;
  hasSavedVideoLayout: boolean;
  gameAudioMuted: boolean;
  videoPackages: VideoUserPackage[];
  lastSelectedVideoPackageId: string;
}

interface CreateBundleOverrides {
  appSettings?: AppGlobalSettings;
  gameAudioMuted?: boolean;
}

const TRANSFER_KIND = 'spotitnow-settings-transfer@v6';
const TRANSFER_VERSION = 6;
const LEGACY_TRANSFER_KIND_V5 = 'spotitnow-settings-transfer@v5';
const LEGACY_TRANSFER_VERSION_V5 = 5;
const LEGACY_TRANSFER_KIND_V4 = 'spotitnow-settings-transfer@v4';
const LEGACY_TRANSFER_VERSION_V4 = 4;
const LEGACY_TRANSFER_KIND_V3 = 'spotitnow-settings-transfer@v3';
const LEGACY_TRANSFER_VERSION_V3 = 3;
const LEGACY_TRANSFER_KIND_V2 = 'spotitnow-settings-transfer@v2';
const LEGACY_TRANSFER_VERSION_V2 = 2;
const LEGACY_TRANSFER_KIND = 'spotitnow-settings-transfer';
const LEGACY_TRANSFER_VERSION = 1;

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object';

const hasKnownTransferField = (value: Record<string, unknown>) =>
  'appSettings' in value ||
  'splitterSetup' in value ||
  'splitterPresets' in value ||
  'timestampPresets' in value ||
  'watermarkPresets' in value ||
  'sceneCopyPresets' in value ||
  'videoPackages' in value ||
  'lastSelectedVideoPackageId' in value ||
  'styleLabPresets' in value ||
  'backgroundPacks' in value ||
  'savedVideoLayout' in value ||
  'gameAudioMuted' in value;

const parseTransferCandidate = (value: unknown): Record<string, unknown> | null => {
  if (!isObjectRecord(value) || !hasKnownTransferField(value)) {
    return null;
  }

  if (
    'kind' in value &&
    value.kind !== TRANSFER_KIND &&
    value.kind !== LEGACY_TRANSFER_KIND_V5 &&
    value.kind !== LEGACY_TRANSFER_KIND_V4 &&
    value.kind !== LEGACY_TRANSFER_KIND_V3 &&
    value.kind !== LEGACY_TRANSFER_KIND_V2 &&
    value.kind !== LEGACY_TRANSFER_KIND
  ) {
    return null;
  }

  if (
    'version' in value &&
    value.version !== TRANSFER_VERSION &&
    value.version !== LEGACY_TRANSFER_VERSION_V5 &&
    value.version !== LEGACY_TRANSFER_VERSION_V4 &&
    value.version !== LEGACY_TRANSFER_VERSION_V3 &&
    value.version !== LEGACY_TRANSFER_VERSION_V2 &&
    value.version !== LEGACY_TRANSFER_VERSION
  ) {
    return null;
  }

  return value;
};

const remapStoredLogoSource = (
  source: unknown,
  restoredImageAssets: Map<string, string>
) =>
  typeof source === 'string'
    ? restoredImageAssets.get(source) ?? source
    : source;

const remapStoredAudioSource = (
  source: unknown,
  restoredAudioAssets: Map<string, string>
) =>
  typeof source === 'string'
    ? restoredAudioAssets.get(source) ?? source
    : source;

const collectTransferredAudioSources = (
  settings: Partial<VideoSettings> | null | undefined
): Array<string | undefined> => {
  if (!settings) {
    return [];
  }

  const pooledSources = VIDEO_AUDIO_POOL_KEYS.flatMap((key) => {
    const sources = settings.audioCuePools?.[key]?.sources;
    return Array.isArray(sources) ? sources : [];
  });

  return [settings.backgroundMusicSrc, ...pooledSources];
};

const remapTransferredVideoSettingsAssets = (
  settings: unknown,
  restoredImageAssets: Map<string, string>,
  restoredAudioAssets: Map<string, string>
) => {
  if (!isObjectRecord(settings)) {
    return settings;
  }

  const nextAudioCuePools = isObjectRecord(settings.audioCuePools)
    ? Object.fromEntries(
        VIDEO_AUDIO_POOL_KEYS.map((key) => {
          const pool = settings.audioCuePools[key];
          if (!isObjectRecord(pool)) {
            return [key, pool];
          }

          return [
            key,
            {
              ...pool,
              sources: Array.isArray(pool.sources)
                ? pool.sources.map((source) =>
                    remapStoredAudioSource(source, restoredAudioAssets)
                  )
                : pool.sources
            }
          ];
        })
      )
    : settings.audioCuePools;

  return {
    ...settings,
    logo: remapStoredLogoSource(settings.logo, restoredImageAssets),
    backgroundMusicSrc: remapStoredAudioSource(
      settings.backgroundMusicSrc,
      restoredAudioAssets
    ),
    audioCuePools: nextAudioCuePools
  };
};

const remapTransferredVideoPackages = (
  packages: unknown,
  restoredImageAssets: Map<string, string>,
  restoredAudioAssets: Map<string, string>
) => {
  if (
    !Array.isArray(packages) ||
    (restoredImageAssets.size === 0 && restoredAudioAssets.size === 0)
  ) {
    return packages;
  }

  return packages.map((entry) => {
    if (!isObjectRecord(entry) || !isObjectRecord(entry.sharedSettings)) {
      return entry;
    }

    return {
      ...entry,
      sharedSettings: remapTransferredVideoSettingsAssets(
        entry.sharedSettings,
        restoredImageAssets,
        restoredAudioAssets
      )
    };
  });
};

export const createAppSettingsTransferBundle = async (
  overrides: CreateBundleOverrides = {}
): Promise<AppSettingsTransferBundle> => {
  const appSettings = sanitizeAppGlobalSettings(
    overrides.appSettings ?? loadAppGlobalSettings()
  );
  const videoPackageLibrary = loadVideoUserPackageLibrary(
    appSettings.videoDefaults
  );
  const imageAssets = await exportStoredImageAssetMap([
    appSettings.videoDefaults.logo,
    ...videoPackageLibrary.packages.map((videoPackage) => videoPackage.sharedSettings.logo)
  ]);
  const audioAssets = await exportStoredAudioAssetMap([
    ...collectTransferredAudioSources(appSettings.videoDefaults),
    ...videoPackageLibrary.packages.flatMap((videoPackage) =>
      collectTransferredAudioSources(videoPackage.sharedSettings)
    )
  ]);

  return {
    kind: TRANSFER_KIND,
    version: TRANSFER_VERSION,
    exportedAt: new Date().toISOString(),
    appSettings,
    splitterSetup: readCurrentSplitterSetupSnapshot(),
    splitterPresets: loadSplitterSetupPresets(),
    timestampPresets: loadFrameTimestampPresets(),
    watermarkPresets: loadWatermarkPresets(),
    videoPackages: videoPackageLibrary.packages,
    lastSelectedVideoPackageId: videoPackageLibrary.activePackageId,
    backgroundPacks: loadGeneratedBackgroundPacks(),
    savedVideoLayout: loadSavedVideoCustomLayout(),
    gameAudioMuted: overrides.gameAudioMuted ?? loadGameAudioMuted(),
    imageAssets: Object.keys(imageAssets).length > 0 ? imageAssets : undefined,
    audioAssets: Object.keys(audioAssets).length > 0 ? audioAssets : undefined
  };
};

export const applyAppSettingsTransferBundle = async (
  raw: string
): Promise<ApplyAppSettingsTransferResult> => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('The selected file is not valid JSON.');
  }

  const candidate = parseTransferCandidate(parsed);
  if (!candidate) {
    throw new Error('This file is not a Spotitnow settings backup.');
  }

  const currentBundle = await createAppSettingsTransferBundle();
  const restoredImageAssets = await importStoredImageAssetMap(
    isObjectRecord(candidate.imageAssets)
      ? (candidate.imageAssets as Record<string, unknown>)
      : undefined
  );
  const restoredAudioAssets = await importStoredAudioAssetMap(
    isObjectRecord(candidate.audioAssets)
      ? (candidate.audioAssets as Record<string, unknown>)
      : undefined
  );
  let appSettings = sanitizeAppGlobalSettings(
    isObjectRecord(candidate.appSettings)
      ? (candidate.appSettings as Partial<AppGlobalSettings>)
      : currentBundle.appSettings
  );
  if (restoredImageAssets.size > 0 || restoredAudioAssets.size > 0) {
    appSettings = {
      ...appSettings,
      videoDefaults: remapTransferredVideoSettingsAssets(
        appSettings.videoDefaults,
        restoredImageAssets,
        restoredAudioAssets
      ) as AppGlobalSettings['videoDefaults']
    };
  }
  const splitterSetup = applySplitterSetupSnapshot(
    isObjectRecord(candidate.splitterSetup)
      ? (candidate.splitterSetup as unknown as SplitterSetupSnapshot)
      : currentBundle.splitterSetup
  );
  const splitterPresets =
    'splitterPresets' in candidate
      ? replaceSplitterSetupPresets(candidate.splitterPresets)
      : currentBundle.splitterPresets;
  const timestampPresets =
    'timestampPresets' in candidate
      ? replaceFrameTimestampPresets(candidate.timestampPresets)
      : currentBundle.timestampPresets;
  const watermarkPresets =
    'watermarkPresets' in candidate
      ? replaceWatermarkPresets(candidate.watermarkPresets)
      : currentBundle.watermarkPresets;
  if ('sceneCopyPresets' in candidate) {
    replaceVideoSceneCopyPresets(candidate.sceneCopyPresets);
  }
  const legacyStyleLabPresets =
    'styleLabPresets' in candidate
      ? replaceVideoStyleLabPresets(candidate.styleLabPresets)
      : loadVideoStyleLabPresets();
  const videoPackageLibrary =
    'videoPackages' in candidate
      ? replaceVideoUserPackageLibrary(
          {
            packages: remapTransferredVideoPackages(
              candidate.videoPackages,
              restoredImageAssets,
              restoredAudioAssets
            ),
            activePackageId: candidate.lastSelectedVideoPackageId
          },
          appSettings.videoDefaults
        )
      : replaceVideoUserPackageLibrary(
          {
            legacyStyleLabPresets
          },
          appSettings.videoDefaults
        );
  const backgroundPacks =
    'backgroundPacks' in candidate
      ? replaceGeneratedBackgroundPacks(candidate.backgroundPacks)
      : currentBundle.backgroundPacks;
  const savedVideoLayout =
    'savedVideoLayout' in candidate
      ? replaceSavedVideoCustomLayout(candidate.savedVideoLayout)
      : sanitizeVideoCustomLayout(currentBundle.savedVideoLayout);
  const gameAudioMuted =
    typeof candidate.gameAudioMuted === 'boolean'
      ? candidate.gameAudioMuted
      : currentBundle.gameAudioMuted;

  saveAppGlobalSettings(appSettings);
  saveGameAudioMuted(gameAudioMuted);

  return {
    appSettings,
    splitterSetup,
    splitterPresetCount: splitterPresets.length,
    timestampPresetCount: timestampPresets.length,
    watermarkPresetCount: watermarkPresets.length,
    videoPackageCount: videoPackageLibrary.packages.length,
    migratedLegacyStyleLabPresetCount:
      'videoPackages' in candidate ? 0 : legacyStyleLabPresets.length,
    backgroundPackCount: backgroundPacks.length,
    hasSavedVideoLayout: Boolean(savedVideoLayout),
    gameAudioMuted,
    videoPackages: videoPackageLibrary.packages,
    lastSelectedVideoPackageId: videoPackageLibrary.activePackageId
  };
};
