import { OverlayTransform, VideoSettings } from '../types';

type OverlayExportSettings = Pick<VideoSettings, 'exportResolution' | 'exportBitrateMbps' | 'exportCodec'>;

export type OverlayBaseSourceMode = 'video' | 'photo' | 'color';

export interface OverlayCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OverlayBackgroundFill {
  enabled: boolean;
  color: string;
}

export interface OverlayChromaKey {
  enabled: boolean;
  color: string;
  similarity: number;
  smoothness: number;
}

export interface OverlayTimeline {
  start: number;
  end: number;
}

export interface OverlayMediaClipInput {
  id: string;
  name: string;
  kind: 'image' | 'video';
  file: File;
  transform: OverlayTransform;
  crop: OverlayCrop;
  background: OverlayBackgroundFill;
  chromaKey: OverlayChromaKey;
  timeline: OverlayTimeline;
}

export interface OverlayBatchPhotoInput extends OverlayMediaClipInput {
  kind: 'image';
}

export interface OverlayBaseInput {
  mode: OverlayBaseSourceMode;
  color: string;
  aspectRatio: number;
  durationSeconds: number;
  videoFile?: File;
  photoFile?: File;
}

interface OverlayBatchExportOptions {
  base: OverlayBaseInput;
  batchPhotos: OverlayBatchPhotoInput[];
  overlays: OverlayMediaClipInput[];
  settings: OverlayExportSettings;
  onProgress?: (progress: number, status?: string) => void;
}

type WorkerResponse =
  | { type: 'progress'; progress: number; status?: string }
  | { type: 'file'; fileName: string; mimeType: string; buffer: ArrayBuffer; index: number; total: number }
  | { type: 'done' }
  | { type: 'cancelled' }
  | { type: 'error'; message: string };

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

export const cancelOverlayBatchExport = () => {
  if (!activeWorker) return;
  activeWorker.postMessage({ type: 'cancel' });
};

export const exportOverlayBatchWithWebCodecs = async ({
  base,
  batchPhotos,
  overlays,
  settings,
  onProgress
}: OverlayBatchExportOptions): Promise<void> => {
  if (activeWorker) {
    throw new Error('Another overlay export is already running.');
  }

  if (!batchPhotos.length) throw new Error('Upload at least one batch image.');
  if (base.mode === 'video' && !base.videoFile) throw new Error('Upload a base video file.');
  if (base.mode === 'photo' && !base.photoFile) throw new Error('Upload a base photo file.');

  return new Promise<void>((resolve, reject) => {
    const worker = new Worker(new URL('../workers/overlayVideoExport.worker.ts', import.meta.url), {
      type: 'module'
    });
    activeWorker = worker;

    const cleanup = () => {
      worker.terminate();
      if (activeWorker === worker) activeWorker = null;
    };

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;

      if (message.type === 'progress') {
        onProgress?.(message.progress, message.status);
        return;
      }

      if (message.type === 'file') {
        const blob = new Blob([message.buffer], { type: message.mimeType });
        downloadBlob(blob, message.fileName);
        return;
      }

      if (message.type === 'done') {
        onProgress?.(1, 'Batch export complete');
        cleanup();
        resolve();
        return;
      }

      if (message.type === 'cancelled') {
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
      reject(new Error(`Overlay export worker crashed.${detail}`));
    };

    worker.postMessage({
      type: 'start',
      payload: {
        base,
        batchPhotos,
        overlays,
        settings
      }
    });
  });
};
