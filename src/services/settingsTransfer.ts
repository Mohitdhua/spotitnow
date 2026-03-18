import type { CustomVideoLayout, GeneratedBackgroundPack } from '../types';
import type { WatermarkSelectionPreset } from './watermarkRemoval';
import {
  applySplitterSetupSnapshot,
  loadAppGlobalSettings,
  readCurrentSplitterSetupSnapshot,
  sanitizeAppGlobalSettings,
  saveAppGlobalSettings,
  type AppGlobalSettings,
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
import { loadWatermarkPresets, replaceWatermarkPresets } from './watermarkPresets';

export interface AppSettingsTransferBundle {
  kind: 'spotitnow-settings-transfer@v4';
  version: 4;
  exportedAt: string;
  appSettings: AppGlobalSettings;
  splitterSetup: SplitterSetupSnapshot;
  timestampPresets: FrameTimestampPreset[];
  watermarkPresets: WatermarkSelectionPreset[];
  videoPackages: VideoUserPackage[];
  lastSelectedVideoPackageId: string;
  backgroundPacks: GeneratedBackgroundPack[];
  savedVideoLayout: CustomVideoLayout | null;
  gameAudioMuted: boolean;
}

export interface ApplyAppSettingsTransferResult {
  appSettings: AppGlobalSettings;
  splitterSetup: SplitterSetupSnapshot;
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

const TRANSFER_KIND = 'spotitnow-settings-transfer@v4';
const TRANSFER_VERSION = 4;
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
    value.kind !== LEGACY_TRANSFER_KIND_V3 &&
    value.kind !== LEGACY_TRANSFER_KIND_V2 &&
    value.kind !== LEGACY_TRANSFER_KIND
  ) {
    return null;
  }

  if (
    'version' in value &&
    value.version !== TRANSFER_VERSION &&
    value.version !== LEGACY_TRANSFER_VERSION_V3 &&
    value.version !== LEGACY_TRANSFER_VERSION_V2 &&
    value.version !== LEGACY_TRANSFER_VERSION
  ) {
    return null;
  }

  return value;
};

export const createAppSettingsTransferBundle = (
  overrides: CreateBundleOverrides = {}
): AppSettingsTransferBundle => {
  const appSettings = sanitizeAppGlobalSettings(
    overrides.appSettings ?? loadAppGlobalSettings()
  );
  const videoPackageLibrary = loadVideoUserPackageLibrary(
    appSettings.videoDefaults
  );

  return {
    kind: TRANSFER_KIND,
    version: TRANSFER_VERSION,
    exportedAt: new Date().toISOString(),
    appSettings,
    splitterSetup: readCurrentSplitterSetupSnapshot(),
    timestampPresets: loadFrameTimestampPresets(),
    watermarkPresets: loadWatermarkPresets(),
    videoPackages: videoPackageLibrary.packages,
    lastSelectedVideoPackageId: videoPackageLibrary.activePackageId,
    backgroundPacks: loadGeneratedBackgroundPacks(),
    savedVideoLayout: loadSavedVideoCustomLayout(),
    gameAudioMuted: overrides.gameAudioMuted ?? loadGameAudioMuted()
  };
};

export const applyAppSettingsTransferBundle = (
  raw: string
): ApplyAppSettingsTransferResult => {
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

  const currentBundle = createAppSettingsTransferBundle();
  const appSettings = sanitizeAppGlobalSettings(
    isObjectRecord(candidate.appSettings) ? (candidate.appSettings as Partial<AppGlobalSettings>) : currentBundle.appSettings
  );
  const splitterSetup = applySplitterSetupSnapshot(
    isObjectRecord(candidate.splitterSetup)
      ? (candidate.splitterSetup as unknown as SplitterSetupSnapshot)
      : currentBundle.splitterSetup
  );
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
            packages: candidate.videoPackages,
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
