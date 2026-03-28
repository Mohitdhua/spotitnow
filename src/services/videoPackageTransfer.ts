import type {
  GeneratedBackgroundPack,
  VideoSettings,
  VideoUserPackage
} from '../types';
import {
  exportStoredAudioAssetMap,
  importStoredAudioAssetMap
} from './audioAssetStore';
import {
  loadGeneratedBackgroundPacks,
  saveGeneratedBackgroundPack
} from './backgroundPacks';
import {
  exportStoredImageAssetMap,
  importStoredImageAssetMap
} from './imageAssetStore';
import {
  applyVideoUserPackageToSettings,
  createImportedVideoUserPackage,
  type VideoUserPackageLibraryState
} from './videoUserPackages';
import { VIDEO_AUDIO_POOL_KEYS } from '../utils/videoAudioPools';

const VIDEO_PACKAGE_TRANSFER_KIND = 'spotitnow-video-package@v1';
const VIDEO_PACKAGE_TRANSFER_VERSION = 1;

export interface VideoPackageTransferBundle {
  kind: typeof VIDEO_PACKAGE_TRANSFER_KIND;
  version: typeof VIDEO_PACKAGE_TRANSFER_VERSION;
  exportedAt: string;
  videoPackage: VideoUserPackage;
  backgroundPack?: GeneratedBackgroundPack;
  imageAssets?: Record<string, string>;
  audioAssets?: Record<string, string>;
}

export interface ApplyVideoPackageTransferResult {
  videoPackage: VideoUserPackage;
  backgroundPack: GeneratedBackgroundPack | null;
}

interface ApplyVideoPackageTransferOptions {
  library: VideoUserPackageLibraryState;
  defaultSettings: VideoSettings;
}

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object';

const normalizeNameKey = (value: string) => value.trim().toLocaleLowerCase();

const resolveUniqueImportedName = (preferredName: string, existingNames: string[]) => {
  const safeBase = preferredName.trim() || 'Imported';
  const takenNames = new Set(existingNames.map(normalizeNameKey));

  if (!takenNames.has(normalizeNameKey(safeBase))) {
    return safeBase;
  }

  const importedBase = `${safeBase} (Imported)`;
  if (!takenNames.has(normalizeNameKey(importedBase))) {
    return importedBase;
  }

  let suffix = 2;
  while (takenNames.has(normalizeNameKey(`${safeBase} (Imported ${suffix})`))) {
    suffix += 1;
  }

  return `${safeBase} (Imported ${suffix})`;
};

const createImportedBackgroundPackId = () =>
  `background-pack-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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

const persistImportedBackgroundPack = (input: unknown) => {
  if (!isObjectRecord(input)) {
    return null;
  }

  const existingPacks = loadGeneratedBackgroundPacks();
  const nextName = resolveUniqueImportedName(
    typeof input.name === 'string' ? input.name : 'Imported Background Pack',
    existingPacks.map((entry) => entry.name)
  );
  const originalId = typeof input.id === 'string' ? input.id : '';
  const nextId = createImportedBackgroundPackId();
  const preparedPack = {
    ...input,
    id: nextId,
    name: nextName,
    updatedAt: Date.now()
  };
  const nextPacks = saveGeneratedBackgroundPack(
    preparedPack as GeneratedBackgroundPack
  );
  const savedPack =
    nextPacks.find((entry) => entry.id === nextId) ?? nextPacks[0] ?? null;

  if (!savedPack) {
    return null;
  }

  return {
    originalId,
    savedPack
  };
};

export const createVideoPackageTransferBundle = async (
  videoPackage: VideoUserPackage
): Promise<VideoPackageTransferBundle> => {
  const backgroundPack = loadGeneratedBackgroundPacks().find(
    (entry) => entry.id === videoPackage.sharedSettings.generatedBackgroundPackId
  );
  const imageAssets = await exportStoredImageAssetMap([
    videoPackage.sharedSettings.logo
  ]);
  const audioAssets = await exportStoredAudioAssetMap(
    collectTransferredAudioSources(videoPackage.sharedSettings)
  );

  return {
    kind: VIDEO_PACKAGE_TRANSFER_KIND,
    version: VIDEO_PACKAGE_TRANSFER_VERSION,
    exportedAt: new Date().toISOString(),
    videoPackage,
    backgroundPack,
    imageAssets: Object.keys(imageAssets).length > 0 ? imageAssets : undefined,
    audioAssets: Object.keys(audioAssets).length > 0 ? audioAssets : undefined
  };
};

export const applyVideoPackageTransferBundle = async (
  raw: string,
  options: ApplyVideoPackageTransferOptions
): Promise<ApplyVideoPackageTransferResult> => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('The selected file is not valid JSON.');
  }

  if (
    !isObjectRecord(parsed) ||
    parsed.kind !== VIDEO_PACKAGE_TRANSFER_KIND ||
    parsed.version !== VIDEO_PACKAGE_TRANSFER_VERSION
  ) {
    throw new Error('This file is not a Spotitnow video package export.');
  }

  const restoredImageAssets = await importStoredImageAssetMap(
    isObjectRecord(parsed.imageAssets)
      ? (parsed.imageAssets as Record<string, unknown>)
      : undefined
  );
  const restoredAudioAssets = await importStoredAudioAssetMap(
    isObjectRecord(parsed.audioAssets)
      ? (parsed.audioAssets as Record<string, unknown>)
      : undefined
  );

  let importedBackgroundPack: GeneratedBackgroundPack | null = null;
  let remappedBackgroundPackId: string | null = null;

  if (isObjectRecord(parsed.backgroundPack)) {
    const persistedBackgroundPack = persistImportedBackgroundPack(
      parsed.backgroundPack
    );
    if (persistedBackgroundPack) {
      importedBackgroundPack = persistedBackgroundPack.savedPack;
      remappedBackgroundPackId = persistedBackgroundPack.savedPack.id;
    }
  }

  if (!isObjectRecord(parsed.videoPackage) || !isObjectRecord(parsed.videoPackage.sharedSettings)) {
    throw new Error('This file does not contain a valid video package.');
  }

  const nextSharedSettings = remapTransferredVideoSettingsAssets(
    parsed.videoPackage.sharedSettings,
    restoredImageAssets,
    restoredAudioAssets
  );
  const safeSharedSettings = isObjectRecord(nextSharedSettings)
    ? nextSharedSettings
    : {};
  const requestedBackgroundPackId =
    typeof safeSharedSettings.generatedBackgroundPackId === 'string'
      ? safeSharedSettings.generatedBackgroundPackId
      : '';
  const backgroundPackExists = requestedBackgroundPackId
    ? loadGeneratedBackgroundPacks().some(
        (entry) => entry.id === requestedBackgroundPackId
      )
    : false;

  const nextVideoPackage = createImportedVideoUserPackage(
    {
      ...parsed.videoPackage,
      sharedSettings: {
        ...safeSharedSettings,
        generatedBackgroundPackId:
          remappedBackgroundPackId ??
          (backgroundPackExists ? requestedBackgroundPackId : ''),
        generatedBackgroundsEnabled:
          remappedBackgroundPackId || backgroundPackExists
            ? safeSharedSettings.generatedBackgroundsEnabled
            : false
      }
    },
    options.library,
    options.defaultSettings
  );

  if (!nextVideoPackage) {
    throw new Error('This file does not contain a valid video package.');
  }

  return {
    videoPackage: nextVideoPackage,
    backgroundPack: importedBackgroundPack
  };
};

export const resolveImportedVideoPackageSettings = (
  videoPackage: VideoUserPackage,
  defaultSettings: VideoSettings
) => applyVideoUserPackageToSettings(videoPackage, defaultSettings);
