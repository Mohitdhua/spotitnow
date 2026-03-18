import { VideoSettings } from '../types';
import type { ProgressBarVisualStyle } from '../constants/progressBarThemes';

export type ProgressBarExportSettings = Pick<
  VideoSettings,
  'exportResolution' | 'exportBitrateMbps' | 'exportCodec'
>;

export type ProgressBarRenderMode = 'bar' | 'text_fill';

interface ExportProgressBarOptions {
  style: ProgressBarVisualStyle;
  durationSeconds: number;
  renderMode: ProgressBarRenderMode;
  progressLabel: string;
  settings: ProgressBarExportSettings;
  onProgress?: (progress: number, status?: string) => void;
}

interface RenderedProgressBarResult {
  blob: Blob;
  fileName: string;
  mimeType: string;
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

export const cancelProgressBarExport = () => {
  if (!activeWorker) return;
  activeWorker.postMessage({ type: 'cancel' });
};

export const renderProgressBarWithWebCodecs = async ({
  style,
  durationSeconds,
  renderMode,
  progressLabel,
  settings,
  onProgress
}: ExportProgressBarOptions): Promise<RenderedProgressBarResult> => {
  if (activeWorker) {
    throw new Error('Another progress-bar export is already running.');
  }

  return new Promise<RenderedProgressBarResult>((resolve, reject) => {
    const worker = new Worker(new URL('../workers/progressBarExport.worker.ts', import.meta.url), {
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
      reject(new Error(`Progress-bar export worker crashed.${detail}`));
    };

    worker.postMessage({
      type: 'start',
      payload: {
        style,
        durationSeconds,
        renderMode,
        progressLabel,
        settings
      }
    });
  });
};

export const exportProgressBarWithWebCodecs = async (options: ExportProgressBarOptions): Promise<void> => {
  const result = await renderProgressBarWithWebCodecs(options);
  downloadBlob(result.blob, result.fileName);
};
