import { Puzzle, VideoSettings } from '../types';
import { mediaDiagnosticsStore, type MediaJobController } from './mediaDiagnostics';
import type { MediaTaskEventMessage, MediaWorkerStatsMessage } from './mediaTelemetry';
import type { BinaryRenderablePuzzle, VideoExportWorkerStartPayload } from './videoRenderSource';

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

interface RenderVideoFramePreviewOptions {
  puzzles: Puzzle[];
  settings: VideoSettings;
  timestamp: number;
  signal?: AbortSignal;
}

type WorkerResponse =
  | { type: 'progress'; progress: number; status?: string }
  | { type: 'stream-chunk'; position: number; data: ArrayBuffer }
  | { type: 'stream-done'; mimeType: string; fileName: string }
  | { type: 'preview-frame-done'; buffer: ArrayBuffer; mimeType: string }
  | { type: 'done'; buffer: ArrayBuffer; mimeType: string; fileName: string }
  | { type: 'error'; message: string }
  | { type: 'cancelled' }
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

const activeSessions = new Set<ActiveVideoExportSession>();
let nextVideoExportSessionId = 1;

const CODEC_EXTENSION: Record<VideoSettings['exportCodec'], string> = {
  h264: 'mp4',
  av1: 'webm'
};

const CODEC_MIME: Record<VideoSettings['exportCodec'], string> = {
  h264: 'video/mp4',
  av1: 'video/webm'
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
  jobId?: string
): { payload: VideoExportWorkerStartPayload; transferables: Transferable[] } => {
  if (options.source === 'binary') {
    return {
      payload: {
        source: 'binary',
        puzzles: options.puzzles,
        settings: options.settings,
        jobId,
        workerSessionId: sessionId
      },
      transferables: options.puzzles.flatMap((puzzle) => [puzzle.imageABuffer, puzzle.imageBBuffer])
    };
  }

  return {
    payload: {
      source: 'legacy',
      puzzles: options.puzzles,
      settings: options.settings,
      jobId,
      workerSessionId: sessionId
    },
    transferables: []
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

    const { payload, transferables } = buildWorkerStartPayload(options, sessionId, job?.jobId);
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

    const { payload, transferables } = buildWorkerStartPayload(options, sessionId, job?.jobId);
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
  puzzles,
  settings,
  timestamp,
  signal
}: RenderVideoFramePreviewOptions): Promise<RenderedVideoFramePreview> => {
  return await new Promise<RenderedVideoFramePreview>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Preview canceled', 'AbortError'));
      return;
    }

    const worker = new Worker(new URL('../workers/videoExport.worker.ts', import.meta.url), {
      type: 'module'
    });
    let settled = false;

    const cleanup = () => {
      worker.terminate();
      if (signal) {
        signal.removeEventListener('abort', handleAbort);
      }
    };

    const handleAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new DOMException('Preview canceled', 'AbortError'));
    };

    if (signal) {
      signal.addEventListener('abort', handleAbort, { once: true });
    }

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;

      if (message.type === 'preview-frame-done') {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({
          blob: new Blob([message.buffer], { type: message.mimeType }),
          mimeType: message.mimeType
        });
        return;
      }

      if (message.type === 'cancelled') {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('Preview canceled'));
        return;
      }

      if (message.type === 'error') {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(message.message));
      }
    };

    worker.onerror = (event) => {
      if (settled) return;
      settled = true;
      cleanup();
      const detail = event.message ? ` ${event.message}` : '';
      reject(new Error(`Video preview worker crashed.${detail}`));
    };

    worker.postMessage({
      type: 'preview-frame',
      payload: {
        puzzles,
        settings,
        timestamp
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
