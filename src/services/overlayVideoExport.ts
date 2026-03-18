import { OverlayTransform, VideoSettings } from '../types';
import { runBatchExportTasks } from './batchExportScheduler';
import { mediaDiagnosticsStore, type MediaJobController } from './mediaDiagnostics';
import type { MediaTaskEventMessage, MediaWorkerStatsMessage } from './mediaTelemetry';

export type OverlayExportSettings = Pick<VideoSettings, 'exportResolution' | 'exportBitrateMbps' | 'exportCodec'>;

export type OverlayBaseSourceMode = 'video' | 'photo' | 'color';
export type OverlayEditorMode = 'standard' | 'linked_pairs';
export type OverlayLinkedPairExportMode = 'single_video' | 'one_per_pair';

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

export interface OverlaySoundtrackInput {
  file: File;
  start: number;
  trimStart: number;
  volume: number;
  loop: boolean;
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

export interface OverlayLinkedPairLayout {
  x: number;
  y: number;
  size: number;
  gap: number;
}

export interface OverlayLinkedPairStyle {
  outlineColor: string;
  outlineWidth: number;
  cornerRadius: number;
}

export interface OverlayLinkedPairInput {
  id: string;
  name: string;
  puzzleFile: File;
  diffFile: File;
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
  editorMode?: OverlayEditorMode;
  base: OverlayBaseInput;
  batchPhotos: OverlayBatchPhotoInput[];
  overlays: OverlayMediaClipInput[];
  soundtrack?: OverlaySoundtrackInput;
  linkedPairs?: OverlayLinkedPairInput[];
  linkedPairLayout?: OverlayLinkedPairLayout;
  linkedPairStyle?: OverlayLinkedPairStyle;
  linkedPairExportMode?: OverlayLinkedPairExportMode;
  settings: OverlayExportSettings;
  onProgress?: (progress: number, status?: string) => void;
}

export interface OverlayWorkerLinkedPairSegment {
  pair: OverlayLinkedPairInput;
  start: number;
  end: number;
}

export type OverlayWorkerOutputTarget =
  | {
      kind: 'standard';
      taskId: string;
      outputLabel: string;
      outputIndex: number;
      totalOutputs: number;
      photo: OverlayBatchPhotoInput | null;
    }
  | {
      kind: 'linked_pairs';
      taskId: string;
      outputLabel: string;
      outputIndex: number;
      totalOutputs: number;
      segments: OverlayWorkerLinkedPairSegment[];
      linkedPairLayout?: OverlayLinkedPairLayout;
      linkedPairStyle?: OverlayLinkedPairStyle;
    };

export interface OverlayWorkerStartPayload {
  base: OverlayBaseInput;
  overlays: OverlayMediaClipInput[];
  soundtrack?: OverlaySoundtrackInput;
  settings: OverlayExportSettings;
  target: OverlayWorkerOutputTarget;
  workerSessionId: string;
}

type WorkerResponse =
  | { type: 'progress'; progress: number; status?: string }
  | { type: 'done'; fileName: string; mimeType: string; buffer: ArrayBuffer }
  | { type: 'cancelled' }
  | { type: 'error'; message: string }
  | MediaTaskEventMessage
  | MediaWorkerStatsMessage;

let activeOverlayExportController: { cancel: () => void } | null = null;
let nextOverlayWorkerSessionId = 1;

const createOverlayExportJob = () =>
  import.meta.env.DEV ? mediaDiagnosticsStore.startJob('overlay_export', 'Overlay Export') : null;

const createWorkerSessionId = () => `overlay-session-${nextOverlayWorkerSessionId++}`;
const getOverlayWorkerId = (workerSessionId: string) => `overlay-export-worker:${workerSessionId}`;

const handleDiagnosticsMessage = (job: MediaJobController | null, message: WorkerResponse) => {
  if (!job) return;
  if (message.type === 'task-event') {
    job.handleTaskEvent(message.event);
    return;
  }
  if (message.type === 'stats') {
    job.updateWorkerStats(message.stats);
  }
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

const buildOutputTargets = ({
  editorMode,
  base,
  batchPhotos,
  linkedPairs,
  linkedPairLayout,
  linkedPairStyle,
  linkedPairExportMode
}: Pick<
  OverlayBatchExportOptions,
  'editorMode' | 'base' | 'batchPhotos' | 'linkedPairs' | 'linkedPairLayout' | 'linkedPairStyle' | 'linkedPairExportMode'
>): OverlayWorkerOutputTarget[] => {
  if (editorMode === 'linked_pairs') {
    const safeDuration = Math.max(0.5, base.durationSeconds);
    if (linkedPairExportMode === 'single_video') {
      return [
        {
          kind: 'linked_pairs',
          taskId: 'overlay-linked-pairs:1',
          outputLabel: linkedPairs.length === 1 ? linkedPairs[0].name : `linked_pairs_${linkedPairs.length}_items`,
          outputIndex: 0,
          totalOutputs: 1,
          linkedPairLayout,
          linkedPairStyle,
          segments: linkedPairs.map((pair, index) => ({
            pair,
            start: index * safeDuration,
            end: (index + 1) * safeDuration
          }))
        }
      ];
    }

    return linkedPairs.map((pair, index) => ({
      kind: 'linked_pairs',
      taskId: `overlay-linked-pairs:${index + 1}`,
      outputLabel: pair.name,
      outputIndex: index,
      totalOutputs: linkedPairs.length,
      linkedPairLayout,
      linkedPairStyle,
      segments: [
        {
          pair,
          start: 0,
          end: safeDuration
        }
      ]
    }));
  }

  const outputTargets = batchPhotos.length > 0 ? batchPhotos : [null];
  return outputTargets.map((photo, index) => ({
    kind: 'standard',
    taskId: `overlay-standard:${index + 1}`,
    outputLabel: photo?.name || base.videoFile?.name || `timeline_${index + 1}`,
    outputIndex: index,
    totalOutputs: outputTargets.length,
    photo
  }));
};

export const cancelOverlayBatchExport = () => {
  activeOverlayExportController?.cancel();
};

export const exportOverlayBatchWithWebCodecs = async ({
  editorMode = 'standard',
  base,
  batchPhotos,
  overlays,
  soundtrack,
  linkedPairs = [],
  linkedPairLayout,
  linkedPairStyle,
  linkedPairExportMode = 'one_per_pair',
  settings,
  onProgress
}: OverlayBatchExportOptions): Promise<void> => {
  if (activeOverlayExportController) {
    throw new Error('Another overlay export is already running.');
  }

  if (editorMode === 'linked_pairs' && linkedPairs.length === 0) {
    throw new Error('Add at least one linked puzzle pair before exporting.');
  }
  if (editorMode !== 'linked_pairs' && !batchPhotos.length && base.mode !== 'video') {
    throw new Error('Upload at least one batch image when base mode is photo or color.');
  }
  if (base.mode === 'video' && !base.videoFile) throw new Error('Upload a base video file.');
  if (base.mode === 'photo' && !base.photoFile) throw new Error('Upload a base photo file.');

  const job = createOverlayExportJob();
  const abortController = new AbortController();
  activeOverlayExportController = {
    cancel: () => {
      abortController.abort();
    }
  };

  const outputTargets = buildOutputTargets({
    editorMode,
    base,
    batchPhotos,
    linkedPairs,
    linkedPairLayout,
    linkedPairStyle,
    linkedPairExportMode
  });

  try {
    job?.setProgress(0, 'Preparing overlay export');

    await runBatchExportTasks({
      tasks: outputTargets.map((target) => {
        const workerSessionId = createWorkerSessionId();
        const workerId = getOverlayWorkerId(workerSessionId);
        let worker: Worker | null = null;

        return {
          id: target.taskId,
          label: target.outputLabel,
          weight: target.kind === 'linked_pairs' ? Math.max(1, target.segments.length) : 1,
          cancel: () => {
            worker?.postMessage({ type: 'cancel' });
          },
          run: async (reportProgress: (progress: number, status?: string) => void) => {
            return await new Promise<void>((resolve, reject) => {
              worker = new Worker(new URL('../workers/overlayVideoExport.worker.ts', import.meta.url), {
                type: 'module'
              });
              let settled = false;

              const cleanup = () => {
                worker?.terminate();
                worker = null;
                job?.removeWorkerStats(workerId);
              };

              const fail = (error: Error) => {
                if (settled) return;
                settled = true;
                cleanup();
                reject(error);
              };

              worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
                const message = event.data;
                if (message.type === 'task-event' || message.type === 'stats') {
                  handleDiagnosticsMessage(job, message);
                  return;
                }

                if (message.type === 'progress') {
                  reportProgress(message.progress, message.status);
                  return;
                }

                if (message.type === 'done') {
                  if (settled) return;
                  settled = true;
                  downloadBlob(new Blob([message.buffer], { type: message.mimeType }), message.fileName);
                  cleanup();
                  resolve();
                  return;
                }

                if (message.type === 'cancelled') {
                  fail(new Error('Export canceled'));
                  return;
                }

                if (message.type === 'error') {
                  fail(new Error(message.message));
                }
              };

              worker.onerror = (event) => {
                const detail = event.message ? ` ${event.message}` : '';
                fail(new Error(`Overlay export worker crashed.${detail}`));
              };

              worker.postMessage({
                type: 'start',
                payload: {
                  base,
                  overlays,
                  soundtrack,
                  settings,
                  target,
                  workerSessionId
                } satisfies OverlayWorkerStartPayload
              });
            });
          }
        };
      }),
      maxConcurrency: Math.min(2, Math.max(1, outputTargets.length)),
      signal: abortController.signal,
      cancelMessage: 'Export canceled',
      onProgress: (progress, status) => {
        onProgress?.(progress, status);
        job?.setProgress(progress, status || 'Exporting overlay video');
      }
    });

    onProgress?.(1, 'Batch export complete');
    job?.setProgress(1, 'Batch export complete');
    job?.complete('Batch export complete');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Overlay export failed.';
    if (abortController.signal.aborted || message === 'Export canceled') {
      job?.cancel('Export canceled');
      throw new Error('Export canceled');
    }
    job?.fail(message, 'Overlay export failed');
    throw error instanceof Error ? error : new Error(message);
  } finally {
    activeOverlayExportController = null;
  }
};
