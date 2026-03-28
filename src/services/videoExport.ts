import { Puzzle, type VideoAudioCuePoolKey, VideoSettings } from '../types';
import { loadGeneratedBackgroundPacks } from './backgroundPacks';
import { mediaDiagnosticsStore, type MediaJobController } from './mediaDiagnostics';
import type { MediaTaskEventMessage, MediaWorkerStatsMessage } from './mediaTelemetry';
import type {
  BinaryRenderablePuzzle,
  VideoExportAudioAssets,
  VideoExportWorkerStartPayload
} from './videoRenderSource';
import { decodeAudioAssetFromSource } from '../utils/audioDecode';
import { loadVideoAssetBlob } from './videoAssetStore';
import { isStoredVideoAssetSource } from './videoAssetStore';
import { VIDEO_AUDIO_POOL_KEYS } from '../utils/videoAudioPools';
import {
  createVideoExportRecoveryManifest,
  deleteVideoExportRecoveryManifest,
  getVideoExportRecoveryManifest,
  loadVideoExportRecoveryDirectoryHandle,
  markVideoExportRecoveryCancelled,
  markVideoExportRecoveryEntryCompleted,
  markVideoExportRecoveryFailed,
  markVideoExportRecoveryRunning,
  saveVideoExportRecoveryDirectoryHandle,
  summarizeVideoExportRecovery,
  updateVideoExportRecoveryOutputMode
} from './videoExportRecovery';

interface ExportVideoBaseOptions {
  settings: VideoSettings;
  onProgress?: (progress: number, status?: string) => void;
  diagnosticsJob?: MediaJobController | null;
  manageDiagnosticsLifecycle?: boolean;
  puzzleIndexOffset?: number;
  recoveryMode?: 'fresh' | 'resume';
  recoveryManifestId?: string | null;
  recoveryProjectId?: string | null;
  recoveryProjectName?: string;
  recoveryBatchSignature?: string;
  recoverySettingsSignature?: string;
}

type ExportVideoOptions =
  | (ExportVideoBaseOptions & {
      source?: 'legacy';
      puzzles: Puzzle[];
    })
  | (ExportVideoBaseOptions & {
      source: 'binary';
      puzzles: BinaryRenderablePuzzle[];
    });

interface RenderedVideoResult {
  blob: Blob;
  fileName: string;
  mimeType: string;
}

export interface VideoExportPlan {
  totalPuzzles: number;
  puzzlesPerVideo: number;
  outputCount: number;
  batchSizes: number[];
  splitEnabled: boolean;
}

export interface VideoExportSummary extends VideoExportPlan {
  usedDirectory: boolean;
}

interface RenderedVideoFramePreview {
  blob: Blob;
  mimeType: string;
}

type RenderVideoFramePreviewOptions =
  | {
      source?: 'legacy';
      puzzles: Puzzle[];
      settings: VideoSettings;
      timestamp: number;
      signal?: AbortSignal;
    }
  | {
      source: 'binary';
      puzzles: BinaryRenderablePuzzle[];
      settings: VideoSettings;
      timestamp: number;
      signal?: AbortSignal;
    };

const resolveGeneratedBackgroundPack = (settings: VideoSettings) =>
  settings.generatedBackgroundsEnabled
    ? loadGeneratedBackgroundPacks().find((pack) => pack.id === settings.generatedBackgroundPackId) ?? null
    : null;

let cachedIntroVideoSource = '';
let cachedIntroVideoFile: File | null = null;

const resolveIntroVideoFile = async (settings: VideoSettings): Promise<File | null> => {
  if (!settings.introVideoEnabled || !settings.introVideoSrc) {
    cachedIntroVideoSource = '';
    cachedIntroVideoFile = null;
    return null;
  }
  if (cachedIntroVideoSource === settings.introVideoSrc && cachedIntroVideoFile) {
    return cachedIntroVideoFile;
  }

  try {
    const blob = await loadVideoAssetBlob(settings.introVideoSrc);
    if (!blob) return null;
    const file = new File([blob], 'intro-video', { type: blob.type || 'video/mp4' });
    cachedIntroVideoSource = settings.introVideoSrc;
    cachedIntroVideoFile = file;
    return file;
  } catch (error) {
    console.error('Failed to load intro video asset', error);
    return null;
  }
};

type WorkerResponse =
  | { type: 'progress'; progress: number; status?: string }
  | { type: 'stream-chunk'; position: number; data: ArrayBuffer }
  | { type: 'stream-done'; mimeType: string; fileName: string }
  | { type: 'preview-frame-done'; buffer: ArrayBuffer; mimeType: string; requestId?: number }
  | { type: 'done'; buffer: ArrayBuffer; mimeType: string; fileName: string }
  | { type: 'error'; message: string; requestId?: number }
  | { type: 'cancelled'; requestId?: number }
  | MediaTaskEventMessage
  | MediaWorkerStatsMessage;

interface DiagnosticsContext {
  job: MediaJobController | null;
  mirrorProgress: boolean;
  manageLifecycle: boolean;
}

interface PreparedVideoExportAssets {
  audioAssets: VideoExportAudioAssets | null;
  introVideoFile: File | null;
}

interface VideoExportBatchEntry {
  fileName: string;
  options: ExportVideoOptions;
  outputIndex: number;
  totalOutputs: number;
  puzzleCount: number;
}

interface ActiveVideoExportSession {
  worker: Worker;
  workerId: string;
  cancel: () => void;
}

interface ActivePreviewFrameRequest {
  id: number;
  resolve: (result: RenderedVideoFramePreview) => void;
  reject: (error: Error | DOMException) => void;
  cleanupAbort: () => void;
}

export interface VideoFramePreviewRenderer {
  render: (options: RenderVideoFramePreviewOptions) => Promise<RenderedVideoFramePreview>;
  dispose: () => void;
}

const activeSessions = new Set<ActiveVideoExportSession>();
let nextVideoExportSessionId = 1;
let previewWorker: Worker | null = null;
let nextPreviewRequestId = 1;
let activePreviewFrameRequest: ActivePreviewFrameRequest | null = null;

const CODEC_EXTENSION: Record<VideoSettings['exportCodec'], string> = {
  h264: 'mp4',
  av1: 'webm'
};

const CODEC_MIME: Record<VideoSettings['exportCodec'], string> = {
  h264: 'video/mp4',
  av1: 'video/webm'
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeExportPuzzlesPerVideo = (puzzleCount: number, requestedPerVideo: number) => {
  if (puzzleCount <= 0) return 0;
  const numericValue = Math.floor(Number(requestedPerVideo) || 0);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return puzzleCount;
  }
  return Math.min(puzzleCount, Math.max(1, numericValue));
};

const normalizeExportParallelWorkers = (requestedWorkers: number, maxWorkers: number) => {
  const numericValue = Math.floor(Number(requestedWorkers) || 1);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return 1;
  }
  return Math.max(1, Math.min(4, Math.max(1, maxWorkers), numericValue));
};

export const getVideoExportPlan = (
  puzzleCount: number,
  requestedPerVideo: number
): VideoExportPlan => {
  if (puzzleCount <= 0) {
    return {
      totalPuzzles: 0,
      puzzlesPerVideo: 0,
      outputCount: 0,
      batchSizes: [],
      splitEnabled: false
    };
  }

  const puzzlesPerVideo = normalizeExportPuzzlesPerVideo(puzzleCount, requestedPerVideo);
  const batchSizes: number[] = [];

  for (let index = 0; index < puzzleCount; index += puzzlesPerVideo) {
    batchSizes.push(Math.min(puzzlesPerVideo, puzzleCount - index));
  }

  return {
    totalPuzzles: puzzleCount,
    puzzlesPerVideo,
    outputCount: batchSizes.length,
    batchSizes,
    splitEnabled: batchSizes.length > 1
  };
};

const resetPreviewWorker = () => {
  if (previewWorker) {
    previewWorker.terminate();
    previewWorker = null;
  }
};

const clearActivePreviewFrameRequest = (request: ActivePreviewFrameRequest | null) => {
  if (!request) return;
  if (activePreviewFrameRequest?.id === request.id) {
    activePreviewFrameRequest = null;
  }
  request.cleanupAbort();
};

const ensurePreviewWorker = () => {
  if (previewWorker) {
    return previewWorker;
  }

  previewWorker = new Worker(new URL('../workers/videoExport.worker.ts', import.meta.url), {
    type: 'module'
  });

  previewWorker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    const request = activePreviewFrameRequest;
    if (!request) return;

    if ('requestId' in message && typeof message.requestId === 'number' && message.requestId !== request.id) {
      return;
    }

    if (message.type === 'preview-frame-done') {
      clearActivePreviewFrameRequest(request);
      request.resolve({
        blob: new Blob([message.buffer], { type: message.mimeType }),
        mimeType: message.mimeType
      });
      return;
    }

    if (message.type === 'cancelled') {
      clearActivePreviewFrameRequest(request);
      request.reject(new DOMException('Preview canceled', 'AbortError'));
      return;
    }

    if (message.type === 'error') {
      clearActivePreviewFrameRequest(request);
      request.reject(new Error(message.message));
    }
  };

  previewWorker.onerror = (event) => {
    const request = activePreviewFrameRequest;
    clearActivePreviewFrameRequest(request);
    resetPreviewWorker();
    if (!request) return;
    const detail = event.message ? ` ${event.message}` : '';
    request.reject(new Error(`Video preview worker crashed.${detail}`));
  };

  return previewWorker;
};

export const createIsolatedVideoFramePreviewRenderer = (): VideoFramePreviewRenderer => {
  let worker: Worker | null = null;
  let nextRequestId = 1;
  let activeRequest: ActivePreviewFrameRequest | null = null;

  const resetWorker = () => {
    if (worker) {
      worker.terminate();
      worker = null;
    }
  };

  const clearRequest = (request: ActivePreviewFrameRequest | null) => {
    if (!request) return;
    if (activeRequest?.id === request.id) {
      activeRequest = null;
    }
    request.cleanupAbort();
  };

  const ensureWorker = () => {
    if (worker) {
      return worker;
    }

    worker = new Worker(new URL('../workers/videoExport.worker.ts', import.meta.url), {
      type: 'module'
    });

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      const request = activeRequest;
      if (!request) return;

      if ('requestId' in message && typeof message.requestId === 'number' && message.requestId !== request.id) {
        return;
      }

      if (message.type === 'preview-frame-done') {
        clearRequest(request);
        request.resolve({
          blob: new Blob([message.buffer], { type: message.mimeType }),
          mimeType: message.mimeType
        });
        return;
      }

      if (message.type === 'cancelled') {
        clearRequest(request);
        request.reject(new DOMException('Preview canceled', 'AbortError'));
        return;
      }

      if (message.type === 'error') {
        clearRequest(request);
        request.reject(new Error(message.message));
      }
    };

    worker.onerror = (event) => {
      const request = activeRequest;
      clearRequest(request);
      resetWorker();
      if (!request) return;
      const detail = event.message ? ` ${event.message}` : '';
      request.reject(new Error(`Video preview worker crashed.${detail}`));
    };

    return worker;
  };

  return {
    dispose: () => {
      clearRequest(activeRequest);
      try {
        worker?.postMessage({ type: 'cancel' });
      } catch {
        // Ignore cancellation failures during cleanup.
      }
      resetWorker();
    },
    render: async ({
      source = 'legacy',
      puzzles,
      settings,
      timestamp,
      signal
    }: RenderVideoFramePreviewOptions) => {
      const introVideoFile = await resolveIntroVideoFile(settings);
      if (signal?.aborted) {
        throw new DOMException('Preview canceled', 'AbortError');
      }

      return await new Promise<RenderedVideoFramePreview>((resolve, reject) => {
        if (signal?.aborted) {
          reject(new DOMException('Preview canceled', 'AbortError'));
          return;
        }

        if (activeRequest) {
          const previousRequest = activeRequest;
          clearRequest(previousRequest);
          try {
            worker?.postMessage({ type: 'cancel' });
          } catch {
            // Ignore worker cancellation failures and reset below.
          }
          resetWorker();
          previousRequest.reject(new DOMException('Preview canceled', 'AbortError'));
        }

        const liveWorker = ensureWorker();
        const requestId = nextRequestId++;
        let settled = false;

        const cleanupAbort = () => {
          if (signal) {
            signal.removeEventListener('abort', handleAbort);
          }
        };

        const handleAbort = () => {
          if (settled) return;
          settled = true;
          if (activeRequest?.id === requestId) {
            activeRequest = null;
          }
          cleanupAbort();
          try {
            liveWorker.postMessage({ type: 'cancel', requestId });
          } catch {
            // Ignore worker cancellation failures on abort.
          }
          resetWorker();
          reject(new DOMException('Preview canceled', 'AbortError'));
        };

        activeRequest = {
          id: requestId,
          resolve: (result) => {
            if (settled) return;
            settled = true;
            resolve(result);
          },
          reject: (error) => {
            if (settled) return;
            settled = true;
            reject(error);
          },
          cleanupAbort
        };

        if (signal) {
          signal.addEventListener('abort', handleAbort, { once: true });
        }

        liveWorker.postMessage({
          type: 'preview-frame',
          requestId,
          payload: {
            source,
            puzzles,
            settings,
            timestamp,
            generatedBackgroundPack: resolveGeneratedBackgroundPack(settings),
            introVideoFile: introVideoFile ?? undefined
          }
        });
      });
    }
  };
};

const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};

const createVideoExportJob = () =>
  import.meta.env.DEV ? mediaDiagnosticsStore.startJob('video_export', 'Video Export') : null;

const createVideoExportSessionId = () => `session-${nextVideoExportSessionId++}`;
const getWorkerIdForSession = (sessionId: string) => `video-export-worker:${sessionId}`;

const registerSession = (worker: Worker, workerId: string): ActiveVideoExportSession => {
  const session: ActiveVideoExportSession = {
    worker,
    workerId,
    cancel: () => {
      worker.postMessage({ type: 'cancel' });
    }
  };
  activeSessions.add(session);
  return session;
};

const cleanupSession = (session: ActiveVideoExportSession, job: MediaJobController | null) => {
  session.worker.terminate();
  activeSessions.delete(session);
  job?.removeWorkerStats(session.workerId);
};

const resolveDiagnosticsContext = (options: ExportVideoOptions): DiagnosticsContext => {
  if (options.diagnosticsJob) {
    return {
      job: options.diagnosticsJob,
      mirrorProgress: options.manageDiagnosticsLifecycle === true,
      manageLifecycle: options.manageDiagnosticsLifecycle === true
    };
  }

  return {
    job: createVideoExportJob(),
    mirrorProgress: true,
    manageLifecycle: true
  };
};

const cloneVideoExportAudioAsset = (
  asset: NonNullable<VideoExportAudioAssets['music']>
): NonNullable<VideoExportAudioAssets['music']> => ({
  ...asset,
  data: asset.data.slice()
});

const cloneVideoExportAudioAssets = (
  audioAssets?: VideoExportAudioAssets | null
): VideoExportAudioAssets | null => {
  if (!audioAssets) return null;

  const clonedSfxPools = audioAssets.sfxPools
    ? Object.fromEntries(
        VIDEO_AUDIO_POOL_KEYS.map((key) => [
          key,
          audioAssets.sfxPools?.[key]?.map((asset) => cloneVideoExportAudioAsset(asset))
        ])
      )
    : undefined;

  return {
    sfxPools: clonedSfxPools,
    introClip: audioAssets.introClip ? cloneVideoExportAudioAsset(audioAssets.introClip) : undefined,
    music: audioAssets.music ? cloneVideoExportAudioAsset(audioAssets.music) : undefined
  };
};

const collectAudioTransferables = (audioAssets?: VideoExportAudioAssets | null): Transferable[] => {
  if (!audioAssets) return [];
  const transferables: Transferable[] = [];
  VIDEO_AUDIO_POOL_KEYS.forEach((key) => {
    audioAssets.sfxPools?.[key]?.forEach((asset) => {
      if (asset?.data?.buffer) {
        transferables.push(asset.data.buffer);
      }
    });
  });
  if (audioAssets.introClip?.data?.buffer) transferables.push(audioAssets.introClip.data.buffer);
  if (audioAssets.music?.data?.buffer) transferables.push(audioAssets.music.data.buffer);
  return transferables;
};

const decodeIntroClipAudio = async (settings: VideoSettings) => {
  if (!settings.introVideoEnabled || !settings.introVideoSrc) return null;
  let objectUrl: string | null = null;
  let source = settings.introVideoSrc;
  try {
    if (isStoredVideoAssetSource(source)) {
      const blob = await loadVideoAssetBlob(source);
      if (!blob) return null;
      objectUrl = URL.createObjectURL(blob);
      source = objectUrl;
    }
    return await decodeAudioAssetFromSource(source);
  } finally {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
  }
};

const resolveAudioAssetsForExport = async (
  settings: VideoSettings,
  onProgress?: (progress: number, status?: string) => void
): Promise<VideoExportAudioAssets | null> => {
  const needsSfx =
    settings.soundEffectsEnabled &&
    VIDEO_AUDIO_POOL_KEYS.some(
      (key) => settings.audioCuePools[key].enabled && settings.audioCuePools[key].sources.length > 0
    );
  const needsMusic = settings.backgroundMusicEnabled && settings.backgroundMusicSrc;
  const needsIntroClipAudio = settings.introVideoEnabled && settings.introVideoSrc;

  if (!needsSfx && !needsMusic && !needsIntroClipAudio) return null;
  onProgress?.(0.02, 'Decoding audio assets...');

  const assets: VideoExportAudioAssets = {};
  if (needsSfx) {
    const sfxPools: Partial<Record<VideoAudioCuePoolKey, NonNullable<VideoExportAudioAssets['sfxPools']>[VideoAudioCuePoolKey]>> = {};
    for (const key of VIDEO_AUDIO_POOL_KEYS) {
      const pool = settings.audioCuePools[key];
      if (!pool.enabled || pool.sources.length === 0) continue;
      const decoded = await Promise.all(pool.sources.map((src) => decodeAudioAssetFromSource(src)));
      const safeDecoded = decoded.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
      if (safeDecoded.length > 0) {
        sfxPools[key] = safeDecoded;
      }
    }
    if (Object.keys(sfxPools).length > 0) {
      assets.sfxPools = sfxPools;
    }
  }
  if (needsIntroClipAudio) {
    assets.introClip = (await decodeIntroClipAudio(settings)) ?? undefined;
  }
  if (needsMusic && settings.backgroundMusicSrc) {
    assets.music = (await decodeAudioAssetFromSource(settings.backgroundMusicSrc)) ?? undefined;
  }

  return assets;
};

const prepareVideoExportAssets = async (
  settings: VideoSettings,
  onProgress?: (progress: number, status?: string) => void
): Promise<PreparedVideoExportAssets> => {
  const audioAssets = await resolveAudioAssetsForExport(settings, onProgress);
  const introVideoFile = await resolveIntroVideoFile(settings);
  return {
    audioAssets,
    introVideoFile
  };
};

const handleWorkerDiagnostics = (job: MediaJobController | null, message: WorkerResponse) => {
  if (!job) return false;
  if (message.type === 'task-event') {
    job.handleTaskEvent(message.event);
    return true;
  }
  if (message.type === 'stats') {
    job.updateWorkerStats(message.stats);
    return true;
  }
  return false;
};

const buildWorkerStartPayload = (
  options: ExportVideoOptions,
  sessionId: string,
  jobId?: string,
  audioAssets?: VideoExportAudioAssets | null,
  introVideoFile?: File | null
): { payload: VideoExportWorkerStartPayload; transferables: Transferable[] } => {
  const safeAudioAssets = cloneVideoExportAudioAssets(audioAssets);
  const audioTransferables = collectAudioTransferables(safeAudioAssets);
  if (options.source === 'binary') {
    // Binary Super Export batches can be rendered more than once
    // across separate render passes. Clone the buffers
    // before transferring so the originals stay usable for later passes.
    const clonedPuzzles = options.puzzles.map((puzzle) => ({
      ...puzzle,
      imageABuffer: puzzle.imageABuffer.slice(0),
      imageBBuffer: puzzle.imageBBuffer.slice(0)
    }));
    const puzzleTransferables: Transferable[] = clonedPuzzles.flatMap((puzzle) => [
      puzzle.imageABuffer,
      puzzle.imageBBuffer
    ]);
    return {
      payload: {
        source: 'binary',
        puzzles: clonedPuzzles,
        settings: options.settings,
        generatedBackgroundPack: resolveGeneratedBackgroundPack(options.settings),
        puzzleIndexOffset: options.puzzleIndexOffset ?? 0,
        audioAssets: safeAudioAssets ?? undefined,
        introVideoFile: introVideoFile ?? undefined,
        jobId,
        workerSessionId: sessionId
      },
      transferables: [...puzzleTransferables, ...audioTransferables]
    };
  }

  return {
    payload: {
      source: 'legacy',
      puzzles: options.puzzles,
      settings: options.settings,
      generatedBackgroundPack: resolveGeneratedBackgroundPack(options.settings),
      puzzleIndexOffset: options.puzzleIndexOffset ?? 0,
      audioAssets: safeAudioAssets ?? undefined,
      introVideoFile: introVideoFile ?? undefined,
      jobId,
      workerSessionId: sessionId
    },
    transferables: audioTransferables
  };
};

const supportsStreamingSave = () =>
  typeof window !== 'undefined' &&
  typeof (window as any).showSaveFilePicker === 'function' &&
  typeof WritableStream !== 'undefined';

type DirectoryPicker = (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;

const supportsDirectorySave = () =>
  typeof window !== 'undefined' &&
  typeof (window as Window & { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker === 'function' &&
  typeof WritableStream !== 'undefined';

const isAbortError = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

const getSuggestedFileName = (settings: VideoSettings) => {
  const extension = CODEC_EXTENSION[settings.exportCodec];
  return `video1.${extension}`;
};

const getSuggestedBatchFileName = (settings: VideoSettings, outputIndex: number) => {
  const extension = CODEC_EXTENSION[settings.exportCodec];
  return `video${outputIndex + 1}.${extension}`;
};

const createVideoExportSummary = (
  plan: VideoExportPlan,
  usedDirectory: boolean
): VideoExportSummary => ({
  ...plan,
  usedDirectory
});

const buildVideoExportBatchEntries = (options: ExportVideoOptions): VideoExportBatchEntry[] => {
  const plan = getVideoExportPlan(options.puzzles.length, options.settings.exportPuzzlesPerVideo);
  if (plan.outputCount <= 1) {
    return [
      {
        fileName: getSuggestedFileName(options.settings),
        options,
        outputIndex: 0,
        totalOutputs: 1,
        puzzleCount: options.puzzles.length
      }
    ];
  }

  return plan.batchSizes.map((batchSize, outputIndex) => {
    const startIndex = outputIndex * plan.puzzlesPerVideo;
    const endIndex = startIndex + batchSize;
    const slicedOptions =
      options.source === 'binary'
        ? ({
            ...options,
            source: 'binary',
            puzzles: options.puzzles.slice(startIndex, endIndex),
            puzzleIndexOffset: startIndex
          } satisfies ExportVideoOptions)
        : ({
            ...options,
            puzzles: options.puzzles.slice(startIndex, endIndex),
            puzzleIndexOffset: startIndex
          } satisfies ExportVideoOptions);

    return {
      fileName: getSuggestedBatchFileName(options.settings, outputIndex),
      options: slicedOptions,
      outputIndex,
      totalOutputs: plan.outputCount,
      puzzleCount: batchSize
    };
  });
};

const getDirectoryPicker = (): DirectoryPicker | null => {
  if (typeof window === 'undefined') return null;
  return (window as Window & { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker ?? null;
};

const requestVideoExportDirectory = async () => {
  const picker = getDirectoryPicker();
  if (!picker) return null;

  try {
    return await picker({ mode: 'readwrite' });
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error('Export canceled');
    }
    throw error;
  }
};

const ensureVideoExportDirectoryPermission = async (handle: FileSystemDirectoryHandle) => {
  const permissionHandle = handle as FileSystemDirectoryHandle & {
    queryPermission?: (descriptor: { mode: 'readwrite' }) => Promise<'granted' | 'denied' | 'prompt'>;
    requestPermission?: (descriptor: { mode: 'readwrite' }) => Promise<'granted' | 'denied' | 'prompt'>;
  };
  const descriptor = { mode: 'readwrite' } as const;

  try {
    if (typeof permissionHandle.queryPermission === 'function') {
      const currentPermission = await permissionHandle.queryPermission(descriptor);
      if (currentPermission === 'granted') {
        return true;
      }
    }

    if (typeof permissionHandle.requestPermission === 'function') {
      return (await permissionHandle.requestPermission(descriptor)) === 'granted';
    }
  } catch {
    return false;
  }

  return false;
};

const createDirectoryWritable = async (
  directory: FileSystemDirectoryHandle,
  filename: string
): Promise<FileSystemWritableFileStream> => {
  const fileHandle = await directory.getFileHandle(filename, { create: true });
  return await fileHandle.createWritable();
};

export const cancelVideoExport = () => {
  activeSessions.forEach((session) => {
    session.cancel();
  });
};

const streamVideoWithWebCodecs = async (
  options: ExportVideoOptions & {
    writable: FileSystemWritableFileStream;
    outputFileName?: string;
  },
  preparedAssets?: PreparedVideoExportAssets
): Promise<void> => {
  const { onProgress, writable } = options;
  const assets =
    preparedAssets ?? (await prepareVideoExportAssets(options.settings, onProgress));
  const audioAssets = assets.audioAssets;
  const introVideoFile = assets.introVideoFile;

  return await new Promise<void>((resolve, reject) => {
    const diagnostics = resolveDiagnosticsContext(options);
    const job = diagnostics.job;
    const sessionId = createVideoExportSessionId();
    const session = registerSession(
      new Worker(new URL('../workers/videoExport.worker.ts', import.meta.url), {
        type: 'module'
      }),
      getWorkerIdForSession(sessionId)
    );
    let settled = false;
    let writeQueue: Promise<void> = Promise.resolve();

    if (diagnostics.mirrorProgress) {
      job?.setProgress(0, 'Preparing export...');
    }

    const cleanup = () => {
      cleanupSession(session, job);
    };

    const fail = async (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        await writeQueue;
      } catch {
        // Ignore write-queue failures when the session is already failing.
      }
      try {
        await writable.abort(error.message);
      } catch {
        // Ignore abort failures.
      }
      if (diagnostics.manageLifecycle && error.message === 'Export canceled') {
        job?.cancel('Export canceled');
      } else if (diagnostics.manageLifecycle) {
        job?.fail(error.message, 'Video export failed');
      }
      reject(error);
    };

    const complete = async (fileName: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        await writeQueue;
        await writable.close();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to finalize saved video file.';
        reject(new Error(message));
        return;
      }
      const resolvedFileName = options.outputFileName ?? fileName;
      onProgress?.(1, `Rendered ${resolvedFileName}`);
      if (diagnostics.mirrorProgress) {
        job?.setProgress(1, `Rendered ${resolvedFileName}`);
      }
      if (diagnostics.manageLifecycle) {
        job?.complete(`Rendered ${resolvedFileName}`);
      }
      resolve();
    };

    session.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (handleWorkerDiagnostics(job, message)) {
        return;
      }

      if (message.type === 'progress') {
        onProgress?.(message.progress, message.status);
        if (diagnostics.mirrorProgress) {
          job?.setProgress(message.progress, message.status || 'Exporting video');
        }
        return;
      }

      if (message.type === 'stream-chunk') {
        const payload = message.data;
        writeQueue = writeQueue.then(() =>
          writable.write({
            type: 'write',
            position: message.position,
            data: new Uint8Array(payload)
          } as any)
        ) as Promise<void>;
        return;
      }

      if (message.type === 'stream-done') {
        void complete(message.fileName);
        return;
      }

      if (message.type === 'cancelled') {
        onProgress?.(0, 'Export canceled');
        void fail(new Error('Export canceled'));
        return;
      }

      if (message.type === 'error') {
        void fail(new Error(message.message));
      }
    };

    session.worker.onerror = (event) => {
      if (settled) return;
      const detail = event.message ? ` ${event.message}` : '';
      void fail(new Error(`Video export worker crashed.${detail}`));
    };

    const { payload, transferables } = buildWorkerStartPayload(
      options,
      sessionId,
      job?.jobId,
      audioAssets,
      introVideoFile
    );
    session.worker.postMessage(
      {
        type: 'start',
        payload: {
          ...payload,
          streamOutput: true
        }
      },
      transferables
    );
  });
};

export const streamVideoToWritableWithWebCodecs = async (
  options: ExportVideoOptions & { writable: FileSystemWritableFileStream }
): Promise<void> => {
  await streamVideoWithWebCodecs(options);
};

export const renderVideoWithWebCodecs = async (options: ExportVideoOptions): Promise<RenderedVideoResult> => {
  const { onProgress } = options;
  return await renderPreparedVideoWithWebCodecs(options);
};

const renderPreparedVideoWithWebCodecs = async (
  options: ExportVideoOptions & { outputFileName?: string },
  preparedAssets?: PreparedVideoExportAssets
): Promise<RenderedVideoResult> => {
  const { onProgress } = options;
  const assets =
    preparedAssets ?? (await prepareVideoExportAssets(options.settings, onProgress));
  const audioAssets = assets.audioAssets;
  const introVideoFile = assets.introVideoFile;

  return await new Promise<RenderedVideoResult>((resolve, reject) => {
    const diagnostics = resolveDiagnosticsContext(options);
    const job = diagnostics.job;
    const sessionId = createVideoExportSessionId();
    const session = registerSession(
      new Worker(new URL('../workers/videoExport.worker.ts', import.meta.url), {
        type: 'module'
      }),
      getWorkerIdForSession(sessionId)
    );

    if (diagnostics.mirrorProgress) {
      job?.setProgress(0, 'Preparing export...');
    }

    const cleanup = () => {
      cleanupSession(session, job);
    };

    session.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (handleWorkerDiagnostics(job, message)) {
        return;
      }

      if (message.type === 'progress') {
        onProgress?.(message.progress, message.status);
        if (diagnostics.mirrorProgress) {
          job?.setProgress(message.progress, message.status || 'Exporting video');
        }
        return;
      }

      if (message.type === 'done') {
        const blob = new Blob([message.buffer], { type: message.mimeType });
        const resolvedFileName = options.outputFileName ?? message.fileName;
        onProgress?.(1, `Rendered ${resolvedFileName}`);
        if (diagnostics.mirrorProgress) {
          job?.setProgress(1, `Rendered ${resolvedFileName}`);
        }
        if (diagnostics.manageLifecycle) {
          job?.complete(`Rendered ${resolvedFileName}`);
        }
        cleanup();
        resolve({
          blob,
          fileName: resolvedFileName,
          mimeType: message.mimeType
        });
        return;
      }

      if (message.type === 'cancelled') {
        onProgress?.(0, 'Export canceled');
        if (diagnostics.manageLifecycle) {
          job?.cancel('Export canceled');
        }
        cleanup();
        reject(new Error('Export canceled'));
        return;
      }

      if (message.type === 'error') {
        if (diagnostics.manageLifecycle) {
          job?.fail(message.message, 'Video export failed');
        }
        cleanup();
        reject(new Error(message.message));
      }
    };

    session.worker.onerror = (event) => {
      if (diagnostics.manageLifecycle) {
        job?.fail(`Video export worker crashed.${event.message ? ` ${event.message}` : ''}`, 'Video export failed');
      }
      cleanup();
      const detail = event.message ? ` ${event.message}` : '';
      reject(new Error(`Video export worker crashed.${detail}`));
    };

    const { payload, transferables } = buildWorkerStartPayload(
      options,
      sessionId,
      job?.jobId,
      audioAssets,
      introVideoFile
    );
    session.worker.postMessage(
      {
        type: 'start',
        payload
      },
      transferables
    );
  });
};

export const renderVideoFramePreview = async ({
  source = 'legacy',
  puzzles,
  settings,
  timestamp,
  signal
}: RenderVideoFramePreviewOptions): Promise<RenderedVideoFramePreview> => {
  const introVideoFile = await resolveIntroVideoFile(settings);
  if (signal?.aborted) {
    throw new DOMException('Preview canceled', 'AbortError');
  }

  return await new Promise<RenderedVideoFramePreview>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Preview canceled', 'AbortError'));
      return;
    }

    if (activePreviewFrameRequest) {
      const previousRequest = activePreviewFrameRequest;
      clearActivePreviewFrameRequest(previousRequest);
      try {
        previewWorker?.postMessage({ type: 'cancel' });
      } catch {
        // Ignore worker cancellation failures and reset below.
      }
      resetPreviewWorker();
      previousRequest.reject(new DOMException('Preview canceled', 'AbortError'));
    }

    const worker = ensurePreviewWorker();
    const requestId = nextPreviewRequestId++;
    let settled = false;

    const cleanupAbort = () => {
      if (signal) {
        signal.removeEventListener('abort', handleAbort);
      }
    };

    const handleAbort = () => {
      if (settled) return;
      settled = true;
      if (activePreviewFrameRequest?.id === requestId) {
        activePreviewFrameRequest = null;
      }
      cleanupAbort();
      try {
        worker.postMessage({ type: 'cancel', requestId });
      } catch {
        // Ignore worker cancellation failures on abort.
      }
      resetPreviewWorker();
      reject(new DOMException('Preview canceled', 'AbortError'));
    };

    activePreviewFrameRequest = {
      id: requestId,
      resolve: (result) => {
        if (settled) return;
        settled = true;
        resolve(result);
      },
      reject: (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      },
      cleanupAbort
    };

    if (signal) {
      signal.addEventListener('abort', handleAbort, { once: true });
    }

    worker.postMessage({
      type: 'preview-frame',
      requestId,
      payload: {
        source,
        puzzles,
        settings,
        timestamp,
        generatedBackgroundPack: resolveGeneratedBackgroundPack(settings),
        introVideoFile: introVideoFile ?? undefined
      }
    });
  });
};

const exportVideoBatchWithWebCodecs = async (
  options: ExportVideoOptions,
  plan: VideoExportPlan
): Promise<VideoExportSummary> => {
  const batchEntries = buildVideoExportBatchEntries(options);
  const diagnosticsJob = createVideoExportJob();
  let recoveryManifest =
    options.recoveryMode === 'resume' && options.recoveryManifestId
      ? getVideoExportRecoveryManifest(options.recoveryManifestId)
      : null;

  if (
    !recoveryManifest &&
    options.recoveryProjectName &&
    options.recoveryBatchSignature &&
    options.recoverySettingsSignature
  ) {
    recoveryManifest = createVideoExportRecoveryManifest({
      projectId: options.recoveryProjectId ?? null,
      projectName: options.recoveryProjectName,
      totalPuzzles: plan.totalPuzzles,
      puzzlesPerVideo: plan.puzzlesPerVideo,
      totalOutputs: plan.outputCount,
      exportCodec: options.settings.exportCodec,
      outputMode: plan.outputCount > 1 && supportsDirectorySave() ? 'directory' : 'downloads',
      batchSignature: options.recoveryBatchSignature,
      settingsSignature: options.recoverySettingsSignature,
      entries: batchEntries.map((entry) => ({
        outputIndex: entry.outputIndex,
        fileName: entry.fileName,
        puzzleCount: entry.puzzleCount,
        startIndex: entry.outputIndex * plan.puzzlesPerVideo,
        endIndex: entry.outputIndex * plan.puzzlesPerVideo + entry.puzzleCount,
        completedAt: null
      }))
    });
  }

  if (recoveryManifest) {
    markVideoExportRecoveryRunning(recoveryManifest.id);
  }

  const completedOutputIndices = new Set(
    recoveryManifest?.entries
      .filter((entry) => entry.completedAt !== null)
      .map((entry) => entry.outputIndex) ?? []
  );
  const pendingBatchEntries = batchEntries
    .map((entry) => ({
      ...entry,
      fileName:
        recoveryManifest?.entries.find((manifestEntry) => manifestEntry.outputIndex === entry.outputIndex)?.fileName ??
        entry.fileName
    }))
    .filter((entry) => !completedOutputIndices.has(entry.outputIndex));
  const preflightProgress = 0.08;
  const parallelWorkers = normalizeExportParallelWorkers(
    options.settings.exportParallelWorkers,
    pendingBatchEntries.length
  );
  const preparingStatus = `Preparing ${plan.outputCount} video${plan.outputCount === 1 ? '' : 's'}...`;
  options.onProgress?.(0.01, preparingStatus);
  diagnosticsJob?.setProgress(0.01, preparingStatus);
  try {
    const shouldUseDirectoryExport =
      plan.outputCount > 1 &&
      supportsDirectorySave() &&
      (recoveryManifest ? recoveryManifest.outputMode === 'directory' : true);
    let directoryHandle: FileSystemDirectoryHandle | null = null;

    if (shouldUseDirectoryExport && recoveryManifest?.id) {
      const persistedHandle = await loadVideoExportRecoveryDirectoryHandle(recoveryManifest.id);
      if (persistedHandle && (await ensureVideoExportDirectoryPermission(persistedHandle))) {
        directoryHandle = persistedHandle;
      }
    }

    if (shouldUseDirectoryExport && !directoryHandle) {
      directoryHandle = await requestVideoExportDirectory();
      if (directoryHandle && recoveryManifest?.id) {
        await saveVideoExportRecoveryDirectoryHandle(recoveryManifest.id, directoryHandle);
      }
    }

    if (recoveryManifest?.id) {
      updateVideoExportRecoveryOutputMode(recoveryManifest.id, directoryHandle ? 'directory' : 'downloads');
    }

    const preparedAssets = await prepareVideoExportAssets(options.settings, (progress, label) => {
      const status = label || 'Preparing export assets...';
      const scaledProgress = Math.min(preflightProgress, progress * preflightProgress);
      options.onProgress?.(scaledProgress, status);
      diagnosticsJob?.setProgress(scaledProgress, status);
    });
    if (pendingBatchEntries.length === 0) {
      if (recoveryManifest?.id) {
        await deleteVideoExportRecoveryManifest(recoveryManifest.id);
      }
      const completionStatus = directoryHandle
        ? `Saved ${plan.outputCount} video${plan.outputCount === 1 ? '' : 's'} to the selected folder`
        : `Exported ${plan.outputCount} video${plan.outputCount === 1 ? '' : 's'}`;
      options.onProgress?.(1, completionStatus);
      diagnosticsJob?.complete(completionStatus);
      return createVideoExportSummary(plan, Boolean(directoryHandle));
    }

    const entryProgress = pendingBatchEntries.map(() => 0);
    const entryStatuses = pendingBatchEntries.map(() => '');
    const pendingRenderedDownloads = new Map<number, RenderedVideoResult>();
    let nextDownloadIndex = 0;
    let downloadQueue: Promise<void> = Promise.resolve();
    let nextEntryIndex = 0;
    let firstError: Error | null = null;

    const publishOverallProgress = (entryIndex: number, progress: number, label?: string) => {
      entryProgress[entryIndex] = Math.max(0, Math.min(1, progress));
      entryStatuses[entryIndex] = label ?? entryStatuses[entryIndex];
      const aggregateProgress =
        preflightProgress +
        (entryProgress.reduce((sum, value) => sum + value, 0) / Math.max(1, pendingBatchEntries.length)) *
          (1 - preflightProgress);
      const activeLabel = label || entryStatuses.find((value) => value.trim().length > 0);
      options.onProgress?.(
        aggregateProgress,
        activeLabel || `Rendering ${plan.outputCount} videos with ${parallelWorkers} workers...`
      );
      diagnosticsJob?.setProgress(
        aggregateProgress,
        activeLabel || `Rendering ${plan.outputCount} videos with ${parallelWorkers} workers...`
      );
    };

    const queueDownloadInOrder = async (pendingIndex: number, rendered: RenderedVideoResult) => {
      pendingRenderedDownloads.set(pendingIndex, rendered);
      downloadQueue = downloadQueue.then(async () => {
        while (pendingRenderedDownloads.has(nextDownloadIndex)) {
          const nextRendered = pendingRenderedDownloads.get(nextDownloadIndex);
          if (!nextRendered) break;
          pendingRenderedDownloads.delete(nextDownloadIndex);
          downloadBlob(nextRendered.blob, nextRendered.fileName);
          nextDownloadIndex += 1;
          if (nextDownloadIndex < pendingBatchEntries.length) {
            await delay(120);
          }
        }
      });
      await downloadQueue;
    };

    const renderBatchEntry = async (pendingIndex: number) => {
      const batchEntry = pendingBatchEntries[pendingIndex];
      const prefix = `Video ${batchEntry.outputIndex + 1}/${batchEntry.totalOutputs}`;
      const fallbackLabel = `${prefix} (${batchEntry.puzzleCount} puzzle${batchEntry.puzzleCount === 1 ? '' : 's'})`;
      const handleProgress = (progress: number, label?: string) => {
        publishOverallProgress(
          pendingIndex,
          progress,
          label ? `${prefix}: ${label}` : `Exporting ${fallbackLabel}...`
        );
      };

      if (directoryHandle) {
        const writable = await createDirectoryWritable(directoryHandle, batchEntry.fileName);
        await streamVideoWithWebCodecs(
          {
            ...batchEntry.options,
            diagnosticsJob,
            manageDiagnosticsLifecycle: false,
            writable,
            outputFileName: batchEntry.fileName,
            onProgress: handleProgress
          },
          preparedAssets
        );
      } else {
        const rendered = await renderPreparedVideoWithWebCodecs(
          {
            ...batchEntry.options,
            diagnosticsJob,
            manageDiagnosticsLifecycle: false,
            outputFileName: batchEntry.fileName,
            onProgress: handleProgress
          },
          preparedAssets
        );
        await queueDownloadInOrder(pendingIndex, rendered);
      }

      if (recoveryManifest?.id) {
        markVideoExportRecoveryEntryCompleted(recoveryManifest.id, batchEntry.outputIndex);
      }
    };

    const runBatchWorker = async () => {
      while (true) {
        if (firstError) {
          return;
        }
        const entryIndex = nextEntryIndex;
        nextEntryIndex += 1;
        if (entryIndex >= pendingBatchEntries.length) {
          return;
        }

        try {
          await renderBatchEntry(entryIndex);
        } catch (error) {
          const resolvedError =
            error instanceof Error ? error : new Error('Video export failed while rendering the split batch.');
          if (!firstError) {
            firstError = resolvedError;
            cancelVideoExport();
          }
          return;
        }
      }
    };

    const alreadyCompleted = recoveryManifest ? summarizeVideoExportRecovery(recoveryManifest).completedOutputs : 0;
    publishOverallProgress(
      0,
      0,
      alreadyCompleted > 0
        ? `Resuming ${pendingBatchEntries.length} remaining video${pendingBatchEntries.length === 1 ? '' : 's'} with ${parallelWorkers} worker${parallelWorkers === 1 ? '' : 's'}...`
        : `Rendering ${plan.outputCount} videos with ${parallelWorkers} worker${parallelWorkers === 1 ? '' : 's'}...`
    );
    await Promise.all(Array.from({ length: parallelWorkers }, () => runBatchWorker()));
    if (firstError) {
      throw firstError;
    }
    await downloadQueue;

    const completionStatus = directoryHandle
      ? `Saved ${plan.outputCount} video${plan.outputCount === 1 ? '' : 's'} to the selected folder`
      : `Exported ${plan.outputCount} video${plan.outputCount === 1 ? '' : 's'}`;
    options.onProgress?.(1, completionStatus);
    diagnosticsJob?.complete(completionStatus);
    if (recoveryManifest?.id) {
      await deleteVideoExportRecoveryManifest(recoveryManifest.id);
    }

    return createVideoExportSummary(plan, Boolean(directoryHandle));
  } catch (error) {
    const resolvedError =
      error instanceof Error ? error : new Error('Video export failed while rendering the split batch.');
    if (resolvedError.message === 'Export canceled') {
      diagnosticsJob?.cancel('Export canceled');
      if (recoveryManifest?.id) {
        markVideoExportRecoveryCancelled(recoveryManifest.id);
      }
    } else {
      diagnosticsJob?.fail(resolvedError.message, 'Video export failed');
      if (recoveryManifest?.id) {
        markVideoExportRecoveryFailed(recoveryManifest.id, resolvedError.message);
      }
    }
    throw resolvedError;
  }
};

export const exportVideoWithWebCodecs = async (options: ExportVideoOptions): Promise<VideoExportSummary> => {
  const plan = getVideoExportPlan(options.puzzles.length, options.settings.exportPuzzlesPerVideo);

  if (plan.outputCount > 1) {
    return await exportVideoBatchWithWebCodecs(options, plan);
  }

  if (supportsStreamingSave()) {
    const showSaveFilePicker = (window as any).showSaveFilePicker as
      | ((options?: any) => Promise<{ createWritable: () => Promise<FileSystemWritableFileStream> }>)
      | undefined;

    if (showSaveFilePicker) {
      try {
        const handle = await showSaveFilePicker({
          suggestedName: getSuggestedFileName(options.settings),
          types: [
            {
              description: options.settings.exportCodec === 'h264' ? 'MP4 Video' : 'WebM Video',
              accept: {
                [CODEC_MIME[options.settings.exportCodec]]: [`.${CODEC_EXTENSION[options.settings.exportCodec]}`]
              }
            }
          ]
        });
        const writable = await handle.createWritable();
        await streamVideoWithWebCodecs({
          ...options,
          writable,
          outputFileName: getSuggestedFileName(options.settings)
        });
        return createVideoExportSummary(plan, false);
      } catch (error) {
        if (isAbortError(error)) {
          throw new Error('Export canceled');
        }
        // If streaming unexpectedly fails, fall back to in-memory export.
      }
    }
  }

  const result = await renderPreparedVideoWithWebCodecs({
    ...options,
    outputFileName: getSuggestedFileName(options.settings)
  });
  downloadBlob(result.blob, result.fileName);
  return createVideoExportSummary(plan, false);
};
