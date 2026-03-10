import { Puzzle, VideoSettings } from '../types';

interface ExportVideoOptions {
  puzzles: Puzzle[];
  settings: VideoSettings;
  onProgress?: (progress: number, status?: string) => void;
}

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
  | { type: 'cancelled' };

let activeWorker: Worker | null = null;

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

export const cancelVideoExport = () => {
  if (!activeWorker) return;
  activeWorker.postMessage({ type: 'cancel' });
};

const supportsStreamingSave = () =>
  typeof window !== 'undefined' &&
  typeof (window as any).showSaveFilePicker === 'function' &&
  typeof WritableStream !== 'undefined';

const isAbortError = (error: unknown) =>
  error instanceof DOMException && error.name === 'AbortError';

const getSuggestedFileName = (settings: VideoSettings) => {
  const extension = CODEC_EXTENSION[settings.exportCodec];
  return `spotitnow-${settings.aspectRatio.replace(':', 'x')}-${settings.exportResolution}-${settings.exportCodec}.${extension}`;
};

const streamVideoWithWebCodecs = async ({
  puzzles,
  settings,
  onProgress,
  writable
}: ExportVideoOptions & { writable: FileSystemWritableFileStream }): Promise<void> => {
  if (activeWorker) {
    throw new Error('Another export is already running.');
  }

  return new Promise<void>((resolve, reject) => {
    const worker = new Worker(new URL('../workers/videoExport.worker.ts', import.meta.url), {
      type: 'module'
    });
    activeWorker = worker;
    let settled = false;
    let writeQueue: Promise<void> = Promise.resolve();

    const cleanupWorker = () => {
      worker.terminate();
      if (activeWorker === worker) {
        activeWorker = null;
      }
    };

    const fail = async (error: Error) => {
      if (settled) return;
      settled = true;
      cleanupWorker();
      try {
        await writeQueue;
      } catch {
        // ignore write queue failures when already failing
      }
      try {
        await writable.abort(error.message);
      } catch {
        // ignore abort failures
      }
      reject(error);
    };

    const complete = async (fileName: string) => {
      if (settled) return;
      settled = true;
      cleanupWorker();
      try {
        await writeQueue;
        await writable.close();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to finalize saved video file.';
        reject(new Error(message));
        return;
      }
      onProgress?.(1, `Rendered ${fileName}`);
      resolve();
    };

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;

      if (message.type === 'progress') {
        onProgress?.(message.progress, message.status);
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

    worker.onerror = (event) => {
      const detail = event.message ? ` ${event.message}` : '';
      void fail(new Error(`Video export worker crashed.${detail}`));
    };

    worker.postMessage({
      type: 'start',
      payload: {
        puzzles,
        settings,
        streamOutput: true
      }
    });
  });
};

export const renderVideoWithWebCodecs = async ({
  puzzles,
  settings,
  onProgress
}: ExportVideoOptions): Promise<RenderedVideoResult> => {
  if (activeWorker) {
    throw new Error('Another export is already running.');
  }

  return new Promise<RenderedVideoResult>((resolve, reject) => {
    const worker = new Worker(new URL('../workers/videoExport.worker.ts', import.meta.url), {
      type: 'module'
    });
    activeWorker = worker;

    const cleanup = () => {
      worker.terminate();
      if (activeWorker === worker) {
        activeWorker = null;
      }
    };

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;

      if (message.type === 'progress') {
        onProgress?.(message.progress, message.status);
        return;
      }

      if (message.type === 'done') {
        const blob = new Blob([message.buffer], { type: message.mimeType });
        onProgress?.(1, `Rendered ${message.fileName}`);
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
        cleanup();
        reject(new Error('Export canceled'));
        return;
      }

      if (message.type === 'error') {
        cleanup();
        reject(new Error(message.message));
      }
    };

    worker.onerror = (event) => {
      cleanup();
      const detail = event.message ? ` ${event.message}` : '';
      reject(new Error(`Video export worker crashed.${detail}`));
    };

    worker.postMessage({
      type: 'start',
      payload: {
        puzzles,
        settings
      }
    });
  });
};

export const renderVideoFramePreview = async ({
  puzzles,
  settings,
  timestamp,
  signal
}: RenderVideoFramePreviewOptions): Promise<RenderedVideoFramePreview> => {
  return new Promise<RenderedVideoFramePreview>((resolve, reject) => {
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
        // If streaming path fails unexpectedly, fall back to in-memory export.
      }
    }
  }

  const result = await renderVideoWithWebCodecs(options);
  downloadBlob(result.blob, result.fileName);
};
