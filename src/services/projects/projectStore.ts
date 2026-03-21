import type {
  AppRoute,
  ProjectRecord,
  ProjectUiSnapshot,
  ProjectVideoSnapshot,
  ProjectWorkspaceSnapshot,
  VideoSettings
} from '../../types';
import {
  exportStoredImageAssetMap,
  importStoredImageAssetMap
} from '../imageAssetStore';
import {
  exportStoredAudioAssetMap,
  importStoredAudioAssetMap
} from '../audioAssetStore';
import { VIDEO_AUDIO_POOL_KEYS } from '../../utils/videoAudioPools';

const DB_NAME = 'spotitnow.projects';
const STORE_NAME = 'projects';
const DB_VERSION = 1;
const ACTIVE_PROJECT_KEY = 'spotitnow.active-project-id';

interface StoredProjectEnvelope {
  kind: 'spotitnow-project';
  version: 1;
  project: ProjectRecord;
  imageAssets?: Record<string, string>;
  audioAssets?: Record<string, string>;
}

const supportsIndexedDb = () => typeof window !== 'undefined' && 'indexedDB' in window;

const openProjectDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error('Failed to open project database.'));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });

const createProjectId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `project-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const defaultUiSnapshot = (lastRoute: AppRoute): ProjectUiSnapshot => ({
  lastRoute
});

const createEmptyWorkspace = (): ProjectWorkspaceSnapshot => ({
  puzzle: null,
  batch: [],
  playIndex: 0,
  incomingVideoFrames: []
});

const createVideoSnapshot = (settings: VideoSettings): ProjectVideoSnapshot => ({
  settings
});

const collectProjectAudioSources = (settings: VideoSettings): Array<string | undefined> => [
  settings.backgroundMusicSrc,
  ...VIDEO_AUDIO_POOL_KEYS.flatMap((key) => settings.audioCuePools[key]?.sources ?? [])
];

const remapProjectVideoSettingsAssets = (
  settings: VideoSettings,
  restoredImageAssets: Map<string, string>,
  restoredAudioAssets: Map<string, string>
): VideoSettings => ({
  ...settings,
  logo:
    typeof settings.logo === 'string'
      ? restoredImageAssets.get(settings.logo) ?? settings.logo
      : settings.logo,
  backgroundMusicSrc:
    typeof settings.backgroundMusicSrc === 'string'
      ? restoredAudioAssets.get(settings.backgroundMusicSrc) ?? settings.backgroundMusicSrc
      : settings.backgroundMusicSrc,
  audioCuePools: VIDEO_AUDIO_POOL_KEYS.reduce<VideoSettings['audioCuePools']>(
    (pools, key) => ({
      ...pools,
      [key]: {
        ...settings.audioCuePools[key],
        sources: settings.audioCuePools[key].sources.map(
          (source) => restoredAudioAssets.get(source) ?? source
        )
      }
    }),
    settings.audioCuePools
  )
});

export const getActiveProjectId = () =>
  typeof window === 'undefined' ? null : window.localStorage.getItem(ACTIVE_PROJECT_KEY);

export const setActiveProjectId = (projectId: string) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ACTIVE_PROJECT_KEY, projectId);
};

export const listProjects = async (): Promise<ProjectRecord[]> => {
  if (!supportsIndexedDb()) return [];
  const db = await openProjectDb();

  return await new Promise<ProjectRecord[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onerror = () => reject(request.error ?? new Error('Failed to list projects.'));
    request.onsuccess = () => {
      const records = (request.result as ProjectRecord[] | undefined) ?? [];
      resolve([...records].sort((left, right) => right.lastOpenedAt - left.lastOpenedAt));
    };
  });
};

export const loadProject = async (id: string): Promise<ProjectRecord | null> => {
  if (!supportsIndexedDb()) return null;
  const db = await openProjectDb();

  return await new Promise<ProjectRecord | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(id);
    request.onerror = () => reject(request.error ?? new Error('Failed to load project.'));
    request.onsuccess = () => resolve((request.result as ProjectRecord | undefined) ?? null);
  });
};

export const saveProject = async (project: ProjectRecord): Promise<ProjectRecord> => {
  if (!supportsIndexedDb()) {
    return project;
  }

  const db = await openProjectDb();
  const nextProject: ProjectRecord = {
    ...project,
    kind: 'spotitnow-project',
    version: 1,
    updatedAt: Date.now()
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to save project.'));
    tx.objectStore(STORE_NAME).put(nextProject);
  });

  setActiveProjectId(nextProject.id);
  return nextProject;
};

export const deleteProject = async (id: string): Promise<void> => {
  if (!supportsIndexedDb()) return;
  const db = await openProjectDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to delete project.'));
    tx.objectStore(STORE_NAME).delete(id);
  });
};

export const createProjectRecord = (
  name: string,
  settings: VideoSettings,
  lastRoute: AppRoute = '/'
): ProjectRecord => {
  const now = Date.now();
  return {
    kind: 'spotitnow-project',
    version: 1,
    id: createProjectId(),
    name: name.trim() || 'Untitled Project',
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    workspace: createEmptyWorkspace(),
    video: createVideoSnapshot(settings),
    uiSnapshot: defaultUiSnapshot(lastRoute)
  };
};

export const touchProject = (project: ProjectRecord, route: AppRoute): ProjectRecord => ({
  ...project,
  lastOpenedAt: Date.now(),
  uiSnapshot: {
    lastRoute: route
  }
});

export const createProjectExport = async (
  project: ProjectRecord
): Promise<StoredProjectEnvelope> => {
  const imageAssets = await exportStoredImageAssetMap([project.video.settings.logo]);
  const audioAssets = await exportStoredAudioAssetMap(
    collectProjectAudioSources(project.video.settings)
  );
  return {
    kind: 'spotitnow-project',
    version: 1,
    project,
    imageAssets: Object.keys(imageAssets).length > 0 ? imageAssets : undefined,
    audioAssets: Object.keys(audioAssets).length > 0 ? audioAssets : undefined
  };
};

export const parseImportedProject = async (raw: string): Promise<ProjectRecord> => {
  const parsed = JSON.parse(raw) as unknown;
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('kind' in parsed) ||
    (parsed as StoredProjectEnvelope).kind !== 'spotitnow-project'
  ) {
    throw new Error('This file is not a Spotitnow project backup.');
  }

  const envelope = parsed as StoredProjectEnvelope;
  if (!envelope.project || typeof envelope.project !== 'object') {
    throw new Error('Project backup is missing project data.');
  }

  const restoredImageAssets = await importStoredImageAssetMap(envelope.imageAssets);
  const restoredAudioAssets = await importStoredAudioAssetMap(envelope.audioAssets);
  const nextSettings = remapProjectVideoSettingsAssets(
    envelope.project.video.settings,
    restoredImageAssets,
    restoredAudioAssets
  );

  return {
    ...envelope.project,
    id: createProjectId(),
    name: envelope.project.name.trim() || 'Imported Project',
    updatedAt: Date.now(),
    lastOpenedAt: Date.now(),
    video: {
      ...envelope.project.video,
      settings: {
        ...nextSettings
      }
    },
    uiSnapshot: envelope.project.uiSnapshot ?? defaultUiSnapshot('/')
  };
};
