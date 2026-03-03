import { Puzzle, VideoSettings } from '../types';

interface ExportVideoOptions {
  puzzles: Puzzle[];
  settings: VideoSettings;
  onProgress?: (progress: number, status?: string) => void;
}

type WorkerResponse =
  | { type: 'progress'; progress: number; status?: string }
  | { type: 'done'; buffer: ArrayBuffer; mimeType: string; fileName: string }
  | { type: 'error'; message: string }
  | { type: 'cancelled' };

let activeWorker: Worker | null = null;

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

export const exportVideoWithWebCodecs = async ({
  puzzles,
  settings,
  onProgress
}: ExportVideoOptions): Promise<void> => {
  if (activeWorker) {
    throw new Error('Another export is already running.');
  }

  return new Promise<void>((resolve, reject) => {
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
        downloadBlob(blob, message.fileName);
        onProgress?.(1, `Exported ${message.fileName}`);
        cleanup();
        resolve();
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
