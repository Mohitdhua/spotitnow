import { Puzzle, VideoSettings } from '../types';
import { VIDEO_AUDIO_POOL_KEYS } from '../utils/videoAudioPools';

const VIDEO_EXPORT_RECOVERY_STORAGE_KEY = 'spotdiff.video-export-recoveries.v1';
const DIRECTORY_HANDLE_DB_NAME = 'spotitnow.video-export-recovery';
const DIRECTORY_HANDLE_STORE_NAME = 'directory-handles';
const DIRECTORY_HANDLE_DB_VERSION = 1;

export type VideoExportRecoveryState = 'running' | 'failed' | 'cancelled';
export type VideoExportRecoveryOutputMode = 'downloads' | 'directory';

export interface VideoExportRecoveryEntry {
  outputIndex: number;
  fileName: string;
  puzzleCount: number;
  startIndex: number;
  endIndex: number;
  completedAt: number | null;
}

export interface VideoExportRecoveryManifest {
  kind: 'spotitnow-video-export-recovery';
  version: 1;
  id: string;
  projectId: string | null;
  projectName: string;
  createdAt: number;
  updatedAt: number;
  state: VideoExportRecoveryState;
  lastError: string | null;
  totalPuzzles: number;
  puzzlesPerVideo: number;
  totalOutputs: number;
  exportCodec: VideoSettings['exportCodec'];
  outputMode: VideoExportRecoveryOutputMode;
  batchSignature: string;
  settingsSignature: string;
  entries: VideoExportRecoveryEntry[];
}

export interface CreateVideoExportRecoveryManifestInput {
  projectId: string | null;
  projectName: string;
  totalPuzzles: number;
  puzzlesPerVideo: number;
  totalOutputs: number;
  exportCodec: VideoSettings['exportCodec'];
  outputMode: VideoExportRecoveryOutputMode;
  batchSignature: string;
  settingsSignature: string;
  entries: VideoExportRecoveryEntry[];
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const createRecoveryId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `video-export-recovery-${crypto.randomUUID()}`
    : `video-export-recovery-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const supportsLocalStorage = () => typeof window !== 'undefined' && 'localStorage' in window;
const supportsIndexedDb = () => typeof window !== 'undefined' && 'indexedDB' in window;

const hashString = (input: string) => {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const fingerprintLargeText = (value: string | undefined) => {
  if (typeof value !== 'string' || value.length === 0) {
    return '';
  }

  const sampleSize = 48;
  const safeLength = value.length;
  const middleStart = Math.max(0, Math.floor(safeLength / 2) - Math.floor(sampleSize / 2));
  const sample = `${value.slice(0, sampleSize)}|${value.slice(middleStart, middleStart + sampleSize)}|${value.slice(
    Math.max(0, safeLength - sampleSize)
  )}`;
  return `${safeLength}:${hashString(sample)}`;
};

const sanitizeEntry = (value: unknown): VideoExportRecoveryEntry | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<VideoExportRecoveryEntry>;
  const outputIndex = Math.max(0, Math.floor(Number(candidate.outputIndex) || 0));
  const fileName = typeof candidate.fileName === 'string' ? candidate.fileName.trim() : '';
  const puzzleCount = Math.max(0, Math.floor(Number(candidate.puzzleCount) || 0));
  const startIndex = Math.max(0, Math.floor(Number(candidate.startIndex) || 0));
  const endIndex = Math.max(startIndex, Math.floor(Number(candidate.endIndex) || 0));
  const completedAt =
    typeof candidate.completedAt === 'number' && Number.isFinite(candidate.completedAt) ? candidate.completedAt : null;

  if (!fileName) return null;

  return {
    outputIndex,
    fileName,
    puzzleCount,
    startIndex,
    endIndex,
    completedAt
  };
};

const sanitizeManifest = (value: unknown): VideoExportRecoveryManifest | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<VideoExportRecoveryManifest>;
  if (candidate.kind !== 'spotitnow-video-export-recovery' || candidate.version !== 1) {
    return null;
  }

  const entries = Array.isArray(candidate.entries)
    ? candidate.entries
        .map((entry) => sanitizeEntry(entry))
        .filter((entry): entry is VideoExportRecoveryEntry => Boolean(entry))
        .sort((left, right) => left.outputIndex - right.outputIndex)
    : [];

  const state: VideoExportRecoveryState =
    candidate.state === 'failed' || candidate.state === 'cancelled' || candidate.state === 'running'
      ? candidate.state
      : 'failed';

  const outputMode: VideoExportRecoveryOutputMode =
    candidate.outputMode === 'directory' || candidate.outputMode === 'downloads'
      ? candidate.outputMode
      : 'downloads';

  const exportCodec: VideoSettings['exportCodec'] = candidate.exportCodec === 'av1' ? 'av1' : 'h264';
  const totalOutputs = Math.max(entries.length, Math.floor(Number(candidate.totalOutputs) || entries.length));
  const puzzlesPerVideo = Math.max(0, Math.floor(Number(candidate.puzzlesPerVideo) || 0));
  const totalPuzzles = Math.max(0, Math.floor(Number(candidate.totalPuzzles) || 0));

  return {
    kind: 'spotitnow-video-export-recovery',
    version: 1,
    id: typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id : createRecoveryId(),
    projectId: typeof candidate.projectId === 'string' && candidate.projectId.trim() ? candidate.projectId : null,
    projectName: typeof candidate.projectName === 'string' && candidate.projectName.trim() ? candidate.projectName : 'Untitled Project',
    createdAt:
      typeof candidate.createdAt === 'number' && Number.isFinite(candidate.createdAt) ? candidate.createdAt : Date.now(),
    updatedAt:
      typeof candidate.updatedAt === 'number' && Number.isFinite(candidate.updatedAt) ? candidate.updatedAt : Date.now(),
    state,
    lastError: typeof candidate.lastError === 'string' && candidate.lastError.trim() ? candidate.lastError : null,
    totalPuzzles,
    puzzlesPerVideo,
    totalOutputs,
    exportCodec,
    outputMode,
    batchSignature: typeof candidate.batchSignature === 'string' ? candidate.batchSignature : '',
    settingsSignature: typeof candidate.settingsSignature === 'string' ? candidate.settingsSignature : '',
    entries
  };
};

const loadStoredManifests = (): VideoExportRecoveryManifest[] => {
  if (!supportsLocalStorage()) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(VIDEO_EXPORT_RECOVERY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => sanitizeManifest(item))
      .filter((item): item is VideoExportRecoveryManifest => Boolean(item))
      .sort((left, right) => right.updatedAt - left.updatedAt);
  } catch {
    return [];
  }
};

const saveStoredManifests = (manifests: VideoExportRecoveryManifest[]) => {
  if (!supportsLocalStorage()) {
    return;
  }

  if (manifests.length === 0) {
    window.localStorage.removeItem(VIDEO_EXPORT_RECOVERY_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(VIDEO_EXPORT_RECOVERY_STORAGE_KEY, JSON.stringify(manifests));
};

const updateManifest = (
  manifestId: string,
  updater: (manifest: VideoExportRecoveryManifest) => VideoExportRecoveryManifest | null
) => {
  const manifests = loadStoredManifests();
  const nextManifests: VideoExportRecoveryManifest[] = [];

  manifests.forEach((manifest) => {
    if (manifest.id !== manifestId) {
      nextManifests.push(manifest);
      return;
    }

    const nextManifest = updater(manifest);
    if (nextManifest) {
      nextManifests.push(nextManifest);
    }
  });

  saveStoredManifests(nextManifests);
  return nextManifests.find((manifest) => manifest.id === manifestId) ?? null;
};

const openDirectoryHandleDb = (): Promise<IDBDatabase | null> =>
  new Promise((resolve, reject) => {
    if (!supportsIndexedDb()) {
      resolve(null);
      return;
    }

    const request = indexedDB.open(DIRECTORY_HANDLE_DB_NAME, DIRECTORY_HANDLE_DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error('Failed to open video export recovery database.'));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DIRECTORY_HANDLE_STORE_NAME)) {
        db.createObjectStore(DIRECTORY_HANDLE_STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });

export const buildVideoBatchRecoverySignature = (batch: Puzzle[]) =>
  hashString(
    JSON.stringify(
      batch.map((puzzle) => ({
        title: puzzle.title ?? '',
        imageA: fingerprintLargeText(puzzle.imageA),
        imageB: fingerprintLargeText(puzzle.imageB),
        regions: puzzle.regions.map((region) => ({
          id: region.id,
          x: clamp(region.x, -1_000_000, 1_000_000),
          y: clamp(region.y, -1_000_000, 1_000_000),
          width: clamp(region.width, 0, 1_000_000),
          height: clamp(region.height, 0, 1_000_000)
        }))
      }))
    )
  );

export const buildVideoSettingsRecoverySignature = (settings: VideoSettings) =>
  hashString(
    JSON.stringify({
      ...settings,
      exportParallelWorkers: undefined,
      previewSoundEnabled: undefined,
      logo: fingerprintLargeText(settings.logo),
      introVideoSrc: fingerprintLargeText(settings.introVideoSrc),
      backgroundMusicSrc: fingerprintLargeText(settings.backgroundMusicSrc),
      audioCuePools: VIDEO_AUDIO_POOL_KEYS.reduce<Record<string, unknown>>((accumulator, key) => {
        accumulator[key] = {
          enabled: settings.audioCuePools[key].enabled,
          volume: settings.audioCuePools[key].volume,
          sources: settings.audioCuePools[key].sources.map((source) => fingerprintLargeText(source))
        };
        return accumulator;
      }, {})
    })
  );

export const listVideoExportRecoveries = () => loadStoredManifests();

export const getVideoExportRecoveryManifest = (manifestId: string) =>
  loadStoredManifests().find((manifest) => manifest.id === manifestId) ?? null;

export const summarizeVideoExportRecovery = (manifest: VideoExportRecoveryManifest) => {
  const completedOutputs = manifest.entries.filter((entry) => entry.completedAt !== null).length;
  return {
    completedOutputs,
    remainingOutputs: Math.max(0, manifest.entries.length - completedOutputs),
    totalOutputs: manifest.entries.length
  };
};

export const findLatestMatchingVideoExportRecovery = ({
  projectId,
  batchSignature,
  settingsSignature
}: {
  projectId: string | null;
  batchSignature: string;
  settingsSignature: string;
}) =>
  loadStoredManifests().find((manifest) => {
    if (manifest.projectId !== projectId) return false;
    if (manifest.batchSignature !== batchSignature) return false;
    if (manifest.settingsSignature !== settingsSignature) return false;
    return summarizeVideoExportRecovery(manifest).remainingOutputs > 0;
  }) ?? null;

export const createVideoExportRecoveryManifest = (input: CreateVideoExportRecoveryManifestInput) => {
  const now = Date.now();
  const manifest: VideoExportRecoveryManifest = {
    kind: 'spotitnow-video-export-recovery',
    version: 1,
    id: createRecoveryId(),
    projectId: input.projectId,
    projectName: input.projectName.trim() || 'Untitled Project',
    createdAt: now,
    updatedAt: now,
    state: 'running',
    lastError: null,
    totalPuzzles: Math.max(0, input.totalPuzzles),
    puzzlesPerVideo: Math.max(0, input.puzzlesPerVideo),
    totalOutputs: Math.max(0, input.totalOutputs),
    exportCodec: input.exportCodec === 'av1' ? 'av1' : 'h264',
    outputMode: input.outputMode,
    batchSignature: input.batchSignature,
    settingsSignature: input.settingsSignature,
    entries: [...input.entries].sort((left, right) => left.outputIndex - right.outputIndex)
  };

  saveStoredManifests([manifest, ...loadStoredManifests().filter((entry) => entry.id !== manifest.id)]);
  return manifest;
};

export const markVideoExportRecoveryEntryCompleted = (manifestId: string, outputIndex: number) =>
  updateManifest(manifestId, (manifest) => ({
    ...manifest,
    state: 'running',
    lastError: null,
    updatedAt: Date.now(),
    entries: manifest.entries.map((entry) =>
      entry.outputIndex === outputIndex
        ? {
            ...entry,
            completedAt: entry.completedAt ?? Date.now()
          }
        : entry
    )
  }));

export const markVideoExportRecoveryFailed = (manifestId: string, message: string) =>
  updateManifest(manifestId, (manifest) => ({
    ...manifest,
    state: 'failed',
    lastError: message.trim() || 'Video export failed.',
    updatedAt: Date.now()
  }));

export const markVideoExportRecoveryCancelled = (manifestId: string) =>
  updateManifest(manifestId, (manifest) => ({
    ...manifest,
    state: 'cancelled',
    updatedAt: Date.now()
  }));

export const markVideoExportRecoveryRunning = (manifestId: string) =>
  updateManifest(manifestId, (manifest) => ({
    ...manifest,
    state: 'running',
    lastError: null,
    updatedAt: Date.now()
  }));

export const updateVideoExportRecoveryOutputMode = (
  manifestId: string,
  outputMode: VideoExportRecoveryOutputMode
) =>
  updateManifest(manifestId, (manifest) => ({
    ...manifest,
    outputMode,
    updatedAt: Date.now()
  }));

export const deleteVideoExportRecoveryManifest = async (manifestId: string) => {
  saveStoredManifests(loadStoredManifests().filter((manifest) => manifest.id !== manifestId));
  await deleteVideoExportRecoveryDirectoryHandle(manifestId);
};

export const saveVideoExportRecoveryDirectoryHandle = async (
  manifestId: string,
  handle: FileSystemDirectoryHandle
) => {
  try {
    const db = await openDirectoryHandleDb();
    if (!db) return;

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DIRECTORY_HANDLE_STORE_NAME, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to save the video export recovery directory.'));
      tx.objectStore(DIRECTORY_HANDLE_STORE_NAME).put({
        id: manifestId,
        handle
      });
    });
  } catch {
    // Ignore directory-handle persistence failures and fall back to picking again later.
  }
};

export const loadVideoExportRecoveryDirectoryHandle = async (manifestId: string) => {
  try {
    const db = await openDirectoryHandleDb();
    if (!db) return null;

    return await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
      const tx = db.transaction(DIRECTORY_HANDLE_STORE_NAME, 'readonly');
      const request = tx.objectStore(DIRECTORY_HANDLE_STORE_NAME).get(manifestId);
      request.onerror = () => reject(request.error ?? new Error('Failed to load the video export recovery directory.'));
      request.onsuccess = () => {
        const result = request.result as { id: string; handle?: FileSystemDirectoryHandle } | undefined;
        resolve(result?.handle ?? null);
      };
    });
  } catch {
    return null;
  }
};

export const deleteVideoExportRecoveryDirectoryHandle = async (manifestId: string) => {
  try {
    const db = await openDirectoryHandleDb();
    if (!db) return;

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DIRECTORY_HANDLE_STORE_NAME, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to delete the video export recovery directory.'));
      tx.objectStore(DIRECTORY_HANDLE_STORE_NAME).delete(manifestId);
    });
  } catch {
    // Ignore cleanup failures.
  }
};
