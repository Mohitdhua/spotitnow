import { detectDifferencesClientSide, type ProcessedPuzzleData } from '../services/imageProcessing';
import type { ImageDetectionWorkerTask } from '../services/imageDetectionWorker';

type WorkerRequest =
  | {
      type: 'start';
      payload: {
        tasks: ImageDetectionWorkerTask[];
      };
    }
  | { type: 'cancel' };

type WorkerResponse =
  | {
      type: 'progress';
      completed: number;
      total: number;
      label: string;
      taskId: string;
    }
  | {
      type: 'result';
      id: string;
      result: Omit<ProcessedPuzzleData, 'imageA' | 'imageB'> & {
        imageA: string | null;
        imageB: string | null;
      };
    }
  | {
      type: 'done';
    }
  | {
      type: 'cancelled';
    }
  | {
      type: 'error';
      message: string;
    };

let cancelled = false;

const postMessageSafe = (message: WorkerResponse) => {
  (self as unknown as Worker).postMessage(message);
};

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;

  if (message.type === 'cancel') {
    cancelled = true;
    return;
  }

  if (message.type !== 'start') return;

  cancelled = false;

  try {
    const { tasks } = message.payload;

    for (let index = 0; index < tasks.length; index += 1) {
      if (cancelled) {
        postMessageSafe({ type: 'cancelled' });
        return;
      }

      const task = tasks[index];
      const primary = await detectDifferencesClientSide(task.imageA, task.imageB, task.options);
      let result = primary;

      if (
        task.fallbackOptions &&
        (primary.regions.length === 0 || primary.regions.length === 1)
      ) {
        const fallback = await detectDifferencesClientSide(task.imageA, task.imageB, task.fallbackOptions);
        if (fallback.regions.length > 0 && fallback.regions.length <= 12) {
          result = fallback;
        }
      }

      if (cancelled) {
        postMessageSafe({ type: 'cancelled' });
        return;
      }

      postMessageSafe({
        type: 'result',
        id: task.id,
        result: {
          ...result,
          imageA: result.imageA === task.imageA ? null : result.imageA,
          imageB: result.imageB === task.imageB ? null : result.imageB
        }
      });
      postMessageSafe({
        type: 'progress',
        completed: index + 1,
        total: tasks.length,
        label: `Processing puzzle ${index + 1} of ${tasks.length}...`,
        taskId: task.id
      });
    }

    postMessageSafe({ type: 'done' });
  } catch (error) {
    postMessageSafe({
      type: 'error',
      message: error instanceof Error ? error.message : 'Image detection failed in worker.'
    });
  }
};
