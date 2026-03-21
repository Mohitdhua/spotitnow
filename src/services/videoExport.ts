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

interface ExportVideoBaseOptions {
  settings: VideoSettings;
  onProgress?: (progress: number, status?: string) => void;
  diagnosticsJob?: MediaJobController | null;
  manageDiagnosticsLifecycle?: boolean;
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
  const audioTransferables = collectAudioTransferables(audioAssets);
  if (options.source === 'binary') {
    // Binary Super Export batches can be rendered more than once
    // (thumbnail preview first, then full video export). Clone the buffers
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
        audioAssets: audioAssets ?? undefined,
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
      audioAssets: audioAssets ?? undefined,
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

const isAbortError = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

const getSuggestedFileName = (settings: VideoSettings) => {
  const extension = CODEC_EXTENSION[settings.exportCodec];
  return `spotitnow-${settings.aspectRatio.replace(':', 'x')}-${settings.exportResolution}-${settings.exportCodec}.${extension}`;
};

export const cancelVideoExport = () => {
  activeSessions.forEach((session) => {
    session.cancel();
  });
};

const streamVideoWithWebCodecs = async (
  options: ExportVideoOptions & { writable: FileSystemWritableFileStream }
): Promise<void> => {
  const { onProgress, writable } = options;
  const audioAssets = await resolveAudioAssetsForExport(options.settings, onProgress);
  const introVideoFile = await resolveIntroVideoFile(options.settings);

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
      onProgress?.(1, `Rendered ${fileName}`);
      if (diagnostics.mirrorProgress) {
        job?.setProgress(1, `Rendered ${fileName}`);
      }
      if (diagnostics.manageLifecycle) {
        job?.complete(`Rendered ${fileName}`);
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
  const audioAssets = await resolveAudioAssetsForExport(options.settings, onProgress);
  const introVideoFile = await resolveIntroVideoFile(options.settings);

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
        onProgress?.(1, `Rendered ${message.fileName}`);
        if (diagnostics.mirrorProgress) {
          job?.setProgress(1, `Rendered ${message.fileName}`);
        }
        if (diagnostics.manageLifecycle) {
          job?.complete(`Rendered ${message.fileName}`);
        }
        cleanup();
        resolve({
          blob,
          fileName: message.fileName,
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

export const exportVideoWithWebCodecs = async (options: ExportVideoOptions): Promise<void> => {
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
          writable
        });
        return;
      } catch (error) {
        if (isAbortError(error)) {
          throw new Error('Export canceled');
        }
        // If streaming unexpectedly fails, fall back to in-memory export.
      }
    }
  }

  const result = await renderVideoWithWebCodecs(options);
  downloadBlob(result.blob, result.fileName);
};
