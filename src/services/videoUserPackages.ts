import { buildDefaultCustomVideoLayout } from '../constants/videoLayoutCustom';
import type {
  AspectLayoutSnapshot,
  VideoAspectRatio,
  VideoPackageAspectLayouts,
  VideoPackageSharedSettings,
  VideoSettings,
  VideoUserPackage
} from '../types';
import {
  DEFAULT_APP_GLOBAL_SETTINGS,
  sanitizeAppGlobalSettings
} from './appSettings';
import { sanitizeVideoCustomLayout } from './videoLayoutStorage';
import {
  applyVideoStyleLabPresetToSettings,
  loadVideoStyleLabPresets,
  type VideoStyleLabPreset
} from './videoStyleLabPresets';

export interface VideoUserPackageLibraryState {
  packages: VideoUserPackage[];
  activePackageId: string;
}

interface StoredVideoUserPackageLibrary {
  version: 1;
  packages: VideoUserPackage[];
  activePackageId: string;
}

interface CreateVideoUserPackageOptions {
  id?: string;
  createdAt?: number;
  updatedAt?: number;
  lastUsedAt?: number;
  existingAspectLayouts?: VideoPackageAspectLayouts;
}

const STORAGE_KEY = 'spotitnow.video-user-packages.v1';
export const DEFAULT_VIDEO_USER_PACKAGE_ID = 'video-package-default';
export const DEFAULT_VIDEO_USER_PACKAGE_NAME = 'Default Package';

const ASPECT_RATIOS: VideoAspectRatio[] = ['16:9', '9:16', '1:1', '4:3'];

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object';

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const createPackageId = () =>
  `video-package-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const mergeVideoSettings = (
  input: Partial<VideoSettings>,
  fallbackSettings: VideoSettings
): VideoSettings =>
  sanitizeAppGlobalSettings({
    videoDefaults: {
      ...fallbackSettings,
      ...input,
      sceneSettings: {
        ...fallbackSettings.sceneSettings,
        ...(input.sceneSettings ?? {})
      },
      textTemplates: {
        ...fallbackSettings.textTemplates,
        ...(input.textTemplates ?? {})
      },
      headerTextOverrides:
        input.headerTextOverrides ?? fallbackSettings.headerTextOverrides
    }
  }).videoDefaults;

const extractSharedSettings = (
  settings: VideoSettings
): VideoPackageSharedSettings => {
  const { aspectRatio, useCustomLayout, customLayout, ...sharedSettings } = settings;
  void aspectRatio;
  void useCustomLayout;
  void customLayout;
  return {
    ...sharedSettings
  };
};

const sanitizeAspectLayoutSnapshot = (
  value: unknown,
  aspectRatio: VideoAspectRatio,
  baseTemplate: VideoSettings['videoPackagePreset'],
  fallbackSnapshot?: AspectLayoutSnapshot
): AspectLayoutSnapshot => {
  const defaultLayout = buildDefaultCustomVideoLayout(baseTemplate, aspectRatio);
  const candidate = isObjectRecord(value) ? value : {};
  const layout =
    sanitizeVideoCustomLayout(candidate.customLayout) ??
    sanitizeVideoCustomLayout(fallbackSnapshot?.customLayout) ??
    defaultLayout;

  return {
    aspectRatio,
    useCustomLayout:
      typeof candidate.useCustomLayout === 'boolean'
        ? candidate.useCustomLayout
        : fallbackSnapshot?.useCustomLayout ?? false,
    customLayout: {
      ...layout
    }
  };
};

const sanitizeAspectLayouts = (
  value: unknown,
  sharedSettings: VideoPackageSharedSettings,
  fallbackLayouts?: VideoPackageAspectLayouts
): VideoPackageAspectLayouts =>
  Object.fromEntries(
    ASPECT_RATIOS.map((aspectRatio) => [
      aspectRatio,
      sanitizeAspectLayoutSnapshot(
        isObjectRecord(value) ? value[aspectRatio] : undefined,
        aspectRatio,
        sharedSettings.videoPackagePreset,
        fallbackLayouts?.[aspectRatio]
      )
    ])
  ) as VideoPackageAspectLayouts;

const buildAspectLayoutsFromSettings = (
  settings: VideoSettings,
  existingAspectLayouts?: VideoPackageAspectLayouts
): VideoPackageAspectLayouts =>
  Object.fromEntries(
    ASPECT_RATIOS.map((aspectRatio) => {
      const existingSnapshot = existingAspectLayouts?.[aspectRatio];
      const defaultLayout = buildDefaultCustomVideoLayout(
        settings.videoPackagePreset,
        aspectRatio
      );

      if (aspectRatio === settings.aspectRatio) {
        const currentLayout =
          sanitizeVideoCustomLayout(settings.customLayout) ?? defaultLayout;
        return [
          aspectRatio,
          {
            aspectRatio,
            useCustomLayout: settings.useCustomLayout === true,
            customLayout: {
              ...currentLayout
            }
          }
        ];
      }

      if (existingSnapshot?.useCustomLayout) {
        return [
          aspectRatio,
          {
            aspectRatio,
            useCustomLayout: true,
            customLayout: {
              ...(sanitizeVideoCustomLayout(existingSnapshot.customLayout) ??
                defaultLayout)
            }
          }
        ];
      }

      return [
        aspectRatio,
        {
          aspectRatio,
          useCustomLayout: existingSnapshot?.useCustomLayout ?? false,
          customLayout: {
            ...defaultLayout
          }
        }
      ];
    })
  ) as VideoPackageAspectLayouts;

const createDefaultVideoUserPackage = (
  defaultSettings: VideoSettings
): VideoUserPackage =>
  createVideoUserPackageFromSettings(
    DEFAULT_VIDEO_USER_PACKAGE_NAME,
    defaultSettings,
    {
      id: DEFAULT_VIDEO_USER_PACKAGE_ID
    }
  );

const sanitizeVideoUserPackage = (
  value: unknown,
  defaultSettings: VideoSettings
): VideoUserPackage | null => {
  if (!isObjectRecord(value) || typeof value.id !== 'string') {
    return null;
  }

  const now = Date.now();
  const preferredAspectRatio = ASPECT_RATIOS.includes(
    value.preferredAspectRatio as VideoAspectRatio
  )
    ? (value.preferredAspectRatio as VideoAspectRatio)
    : defaultSettings.aspectRatio;

  const fallbackRuntimeSettings = {
    ...defaultSettings,
    aspectRatio: preferredAspectRatio
  };
  const sharedSettings = extractSharedSettings(
    mergeVideoSettings(
      {
        ...(isObjectRecord(value.sharedSettings)
          ? (value.sharedSettings as Partial<VideoSettings>)
          : {}),
        aspectRatio: preferredAspectRatio,
        useCustomLayout: false,
        customLayout: buildDefaultCustomVideoLayout(
          fallbackRuntimeSettings.videoPackagePreset,
          preferredAspectRatio
        )
      },
      fallbackRuntimeSettings
    )
  );

  return {
    id: value.id,
    name:
      typeof value.name === 'string' && value.name.trim()
        ? value.name.trim()
        : 'Untitled Package',
    createdAt: isFiniteNumber(value.createdAt) ? value.createdAt : now,
    updatedAt: isFiniteNumber(value.updatedAt) ? value.updatedAt : now,
    lastUsedAt: isFiniteNumber(value.lastUsedAt) ? value.lastUsedAt : now,
    preferredAspectRatio,
    sharedSettings,
    aspectLayouts: sanitizeAspectLayouts(
      value.aspectLayouts,
      sharedSettings
    )
  };
};

const sanitizeVideoUserPackageLibrary = (
  packages: unknown,
  activePackageId: unknown,
  defaultSettings: VideoSettings
): VideoUserPackageLibraryState => {
  const sanitizedPackages = Array.isArray(packages)
    ? packages
        .map((value) => sanitizeVideoUserPackage(value, defaultSettings))
        .filter((value): value is VideoUserPackage => Boolean(value))
    : [];

  const dedupedPackages = sanitizedPackages.filter(
    (entry, index, all) => all.findIndex((candidate) => candidate.id === entry.id) === index
  );

  const hasDefaultPackage = dedupedPackages.some(
    (entry) => entry.id === DEFAULT_VIDEO_USER_PACKAGE_ID
  );
  const nextPackages = hasDefaultPackage
    ? dedupedPackages
    : [createDefaultVideoUserPackage(defaultSettings), ...dedupedPackages];

  const resolvedActivePackageId =
    typeof activePackageId === 'string' &&
    nextPackages.some((entry) => entry.id === activePackageId)
      ? activePackageId
      : nextPackages[0]?.id ?? DEFAULT_VIDEO_USER_PACKAGE_ID;

  return {
    packages: nextPackages,
    activePackageId: resolvedActivePackageId
  };
};

const readStoredLibrary = (): StoredVideoUserPackageLibrary | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!isObjectRecord(parsed) || parsed.version !== 1) {
      return null;
    }

    return {
      version: 1,
      packages: Array.isArray(parsed.packages)
        ? (parsed.packages as VideoUserPackage[])
        : [],
      activePackageId:
        typeof parsed.activePackageId === 'string' ? parsed.activePackageId : ''
    };
  } catch {
    return null;
  }
};

const writeStoredLibrary = (library: VideoUserPackageLibraryState) => {
  if (typeof window === 'undefined') {
    return;
  }

  const payload: StoredVideoUserPackageLibrary = {
    version: 1,
    packages: library.packages,
    activePackageId: library.activePackageId
  };

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
};

const buildLibraryFromLegacyPresets = (
  defaultSettings: VideoSettings,
  legacyPresets: VideoStyleLabPreset[]
): VideoUserPackageLibraryState => {
  const defaultPackage = createDefaultVideoUserPackage(defaultSettings);
  const migratedPackages = legacyPresets.map((preset) => {
    const migratedSettings = applyVideoStyleLabPresetToSettings(
      defaultSettings,
      preset
    );
    return createVideoUserPackageFromSettings(preset.name, migratedSettings, {
      id: `legacy-${preset.id}`,
      createdAt: preset.createdAt,
      updatedAt: preset.updatedAt,
      lastUsedAt: preset.updatedAt
    });
  });

  return {
    packages: [defaultPackage, ...migratedPackages],
    activePackageId: defaultPackage.id
  };
};

export const createVideoUserPackageFromSettings = (
  name: string,
  settings: VideoSettings,
  options: CreateVideoUserPackageOptions = {}
): VideoUserPackage => {
  const now = options.updatedAt ?? Date.now();
  const safeSettings = mergeVideoSettings(settings, settings);

  return {
    id: options.id ?? createPackageId(),
    name: name.trim() || 'Untitled Package',
    createdAt: options.createdAt ?? now,
    updatedAt: now,
    lastUsedAt: options.lastUsedAt ?? now,
    preferredAspectRatio: safeSettings.aspectRatio,
    sharedSettings: extractSharedSettings(safeSettings),
    aspectLayouts: buildAspectLayoutsFromSettings(
      safeSettings,
      options.existingAspectLayouts
    )
  };
};

export const applyVideoUserPackageToSettings = (
  videoPackage: VideoUserPackage,
  defaultSettings: VideoSettings = DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults
): VideoSettings =>
  applyVideoUserPackageToAspectRatio(
    videoPackage,
    videoPackage.preferredAspectRatio,
    defaultSettings
  );

export const applyVideoUserPackageToAspectRatio = (
  videoPackage: VideoUserPackage,
  aspectRatio: VideoAspectRatio,
  defaultSettings: VideoSettings = DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults
): VideoSettings => {
  const layoutSnapshot =
    videoPackage.aspectLayouts[aspectRatio] ??
    sanitizeAspectLayoutSnapshot(
      undefined,
      aspectRatio,
      videoPackage.sharedSettings.videoPackagePreset
    );

  return mergeVideoSettings(
    {
      ...videoPackage.sharedSettings,
      aspectRatio,
      useCustomLayout: layoutSnapshot.useCustomLayout,
      customLayout:
        sanitizeVideoCustomLayout(layoutSnapshot.customLayout) ??
        buildDefaultCustomVideoLayout(
          videoPackage.sharedSettings.videoPackagePreset,
          aspectRatio
        )
    },
    {
      ...defaultSettings,
      aspectRatio
    }
  );
};

export const persistVideoSettingsToVideoUserPackage = (
  videoPackage: VideoUserPackage,
  settings: VideoSettings,
  defaultSettings: VideoSettings = DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults
): VideoUserPackage => {
  const safeSettings = mergeVideoSettings(
    settings,
    applyVideoUserPackageToSettings(videoPackage, defaultSettings)
  );
  const now = Date.now();

  return {
    ...videoPackage,
    updatedAt: now,
    lastUsedAt: now,
    preferredAspectRatio: safeSettings.aspectRatio,
    sharedSettings: extractSharedSettings(safeSettings),
    aspectLayouts: buildAspectLayoutsFromSettings(
      safeSettings,
      videoPackage.aspectLayouts
    )
  };
};

export const loadVideoUserPackageLibrary = (
  defaultSettings: VideoSettings = DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults
): VideoUserPackageLibraryState => {
  const storedLibrary = readStoredLibrary();
  if (!storedLibrary) {
    const library = buildLibraryFromLegacyPresets(
      defaultSettings,
      loadVideoStyleLabPresets()
    );
    writeStoredLibrary(library);
    return library;
  }

  const library = sanitizeVideoUserPackageLibrary(
    storedLibrary.packages,
    storedLibrary.activePackageId,
    defaultSettings
  );
  writeStoredLibrary(library);
  return library;
};

export const saveVideoUserPackageLibrary = (
  library: VideoUserPackageLibraryState,
  defaultSettings: VideoSettings = DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults
): VideoUserPackageLibraryState => {
  const safeLibrary = sanitizeVideoUserPackageLibrary(
    library.packages,
    library.activePackageId,
    defaultSettings
  );
  writeStoredLibrary(safeLibrary);
  return safeLibrary;
};

export const replaceVideoUserPackageLibrary = (
  input: {
    packages?: unknown;
    activePackageId?: unknown;
    legacyStyleLabPresets?: VideoStyleLabPreset[];
  },
  defaultSettings: VideoSettings = DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults
): VideoUserPackageLibraryState => {
  const safeLibrary =
    Array.isArray(input.packages) && input.packages.length > 0
      ? sanitizeVideoUserPackageLibrary(
          input.packages,
          input.activePackageId,
          defaultSettings
        )
      : buildLibraryFromLegacyPresets(
          defaultSettings,
          input.legacyStyleLabPresets ?? []
        );

  writeStoredLibrary(safeLibrary);
  return safeLibrary;
};

export const resolveActiveVideoUserPackage = (
  library: VideoUserPackageLibraryState
): VideoUserPackage => {
  return (
    library.packages.find((entry) => entry.id === library.activePackageId) ??
    library.packages[0] ??
    createDefaultVideoUserPackage(DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults)
  );
};

export const setActiveVideoUserPackage = (
  library: VideoUserPackageLibraryState,
  packageId: string
): VideoUserPackageLibraryState => {
  const now = Date.now();
  const nextPackages = library.packages.map((entry) =>
    entry.id === packageId
      ? {
          ...entry,
          lastUsedAt: now
        }
      : entry
  );

  return {
    packages: nextPackages,
    activePackageId: nextPackages.some((entry) => entry.id === packageId)
      ? packageId
      : library.activePackageId
  };
};

export const upsertVideoUserPackageInLibrary = (
  library: VideoUserPackageLibraryState,
  videoPackage: VideoUserPackage
): VideoUserPackageLibraryState => {
  const existingIndex = library.packages.findIndex(
    (entry) => entry.id === videoPackage.id
  );

  if (existingIndex === -1) {
    return {
      packages: [...library.packages, videoPackage],
      activePackageId: library.activePackageId
    };
  }

  const nextPackages = [...library.packages];
  nextPackages[existingIndex] = videoPackage;
  return {
    packages: nextPackages,
    activePackageId: library.activePackageId
  };
};

export const deleteVideoUserPackageFromLibrary = (
  library: VideoUserPackageLibraryState,
  packageId: string,
  defaultSettings: VideoSettings = DEFAULT_APP_GLOBAL_SETTINGS.videoDefaults
): VideoUserPackageLibraryState => {
  if (packageId === DEFAULT_VIDEO_USER_PACKAGE_ID) {
    return library;
  }

  const nextPackages = library.packages.filter((entry) => entry.id !== packageId);
  const nextLibrary = sanitizeVideoUserPackageLibrary(
    nextPackages,
    library.activePackageId === packageId
      ? DEFAULT_VIDEO_USER_PACKAGE_ID
      : library.activePackageId,
    defaultSettings
  );

  return nextLibrary;
};
