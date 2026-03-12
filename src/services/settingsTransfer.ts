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
  loadVideoSceneCopyPresets,
  replaceVideoSceneCopyPresets,
  type VideoSceneCopyPreset
} from './videoSceneCopyPresets';
import {
  loadGeneratedBackgroundPacks,
  replaceGeneratedBackgroundPacks
} from './backgroundPacks';
import { loadWatermarkPresets, replaceWatermarkPresets } from './watermarkPresets';

export interface AppSettingsTransferBundle {
  kind: 'spotitnow-settings-transfer@v2';
  version: 2;
  exportedAt: string;
  appSettings: AppGlobalSettings;
  splitterSetup: SplitterSetupSnapshot;
  timestampPresets: FrameTimestampPreset[];
  watermarkPresets: WatermarkSelectionPreset[];
  sceneCopyPresets: VideoSceneCopyPreset[];
  backgroundPacks: GeneratedBackgroundPack[];
  savedVideoLayout: CustomVideoLayout | null;
  gameAudioMuted: boolean;
}

export interface ApplyAppSettingsTransferResult {
  appSettings: AppGlobalSettings;
  splitterSetup: SplitterSetupSnapshot;
  timestampPresetCount: number;
  watermarkPresetCount: number;
  sceneCopyPresetCount: number;
  backgroundPackCount: number;
  hasSavedVideoLayout: boolean;
  gameAudioMuted: boolean;
}

interface CreateBundleOverrides {
  appSettings?: AppGlobalSettings;
  gameAudioMuted?: boolean;
}

const TRANSFER_KIND = 'spotitnow-settings-transfer@v2';
const TRANSFER_VERSION = 2;
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
    value.kind !== LEGACY_TRANSFER_KIND
  ) {
    return null;
  }

  if (
    'version' in value &&
    value.version !== TRANSFER_VERSION &&
    value.version !== LEGACY_TRANSFER_VERSION
  ) {
    return null;
  }

  return value;
};

export const createAppSettingsTransferBundle = (
  overrides: CreateBundleOverrides = {}
): AppSettingsTransferBundle => ({
  kind: TRANSFER_KIND,
  version: TRANSFER_VERSION,
  exportedAt: new Date().toISOString(),
  appSettings: sanitizeAppGlobalSettings(overrides.appSettings ?? loadAppGlobalSettings()),
  splitterSetup: readCurrentSplitterSetupSnapshot(),
  timestampPresets: loadFrameTimestampPresets(),
  watermarkPresets: loadWatermarkPresets(),
  sceneCopyPresets: loadVideoSceneCopyPresets(),
  backgroundPacks: loadGeneratedBackgroundPacks(),
  savedVideoLayout: loadSavedVideoCustomLayout(),
  gameAudioMuted: overrides.gameAudioMuted ?? loadGameAudioMuted()
});

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
  const sceneCopyPresets =
    'sceneCopyPresets' in candidate
      ? replaceVideoSceneCopyPresets(candidate.sceneCopyPresets)
      : currentBundle.sceneCopyPresets;
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
    sceneCopyPresetCount: sceneCopyPresets.length,
    backgroundPackCount: backgroundPacks.length,
    hasSavedVideoLayout: Boolean(savedVideoLayout),
    gameAudioMuted
  };
};
