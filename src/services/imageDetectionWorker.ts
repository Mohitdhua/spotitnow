import type { DifferenceDetectionOptions, ProcessedPuzzleData } from './imageProcessing';

export interface ImageDetectionWorkerTask {
  id: string;
  imageA: string;
  imageB: string;
  options: DifferenceDetectionOptions;
  fallbackOptions?: DifferenceDetectionOptions | null;
}

interface ImageDetectionWorkerProgress {
  completed: number;
  total: number;
  label: string;
  taskId: string;
}

interface ImageDetectionWorkerResult {
  id: string;
  result: Omit<ProcessedPuzzleData, 'imageA' | 'imageB'> & {
    imageA: string | null;
    imageB: string | null;
  };
}

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
      result: ImageDetectionWorkerResult['result'];
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

const MAX_IMAGE_DETECTION_POOL_SIZE = 4;

interface ActiveImageDetectionBatch {
  cancel: () => void;
}

let activeBatch: ActiveImageDetectionBatch | null = null;

const getImageDetectionPoolSize = (taskCount: number) => {
  const hardwareConcurrency =
    typeof navigator !== 'undefined' && Number.isFinite(navigator.hardwareConcurrency)
      ? navigator.hardwareConcurrency
      : 2;

  return Math.max(
    1,
    Math.min(MAX_IMAGE_DETECTION_POOL_SIZE, taskCount, Math.ceil(hardwareConcurrency / 2))
  );
};

export const cancelImageDetectionWorker = () => {
  activeBatch?.cancel();
};

export const runImageDetectionBatchInWorker = async ({
  tasks,
  onProgress
}: {
  tasks: ImageDetectionWorkerTask[];
  onProgress?: (progress: ImageDetectionWorkerProgress) => void;
}): Promise<ImageDetectionWorkerResult[]> => {
  if (activeBatch) {
    throw new Error('Another image detection task is already running.');
  }

  if (!tasks.length) {
    return [];
  }

  return await new Promise<ImageDetectionWorkerResult[]>((resolve, reject) => {
    const workerCount = getImageDetectionPoolSize(tasks.length);
    const workers = Array.from(
      { length: workerCount },
      () =>
        new Worker(new URL('../workers/imageDetection.worker.ts', import.meta.url), {
          type: 'module'
        })
    );
    const results = new Map<string, ImageDetectionWorkerResult>();
    const activeTasks = new Map<Worker, ImageDetectionWorkerTask>();
    let nextTaskIndex = 0;
    let completedCount = 0;
    let settled = false;

    const cleanup = () => {
      workers.forEach((worker) => worker.terminate());
      if (activeBatch?.cancel === cancel) {
        activeBatch = null;
      }
    };

    const finishWithError = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const finishWithSuccess = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(
        tasks
          .map((task) => results.get(task.id))
          .filter((entry): entry is ImageDetectionWorkerResult => Boolean(entry))
      );
    };

    const emitProgress = (taskId: string, label: string) => {
      onProgress?.({
        completed: completedCount,
        total: tasks.length,
        label,
        taskId
      });
    };

    const dispatchNextTask = (worker: Worker) => {
      if (settled) return;

      const task = tasks[nextTaskIndex];
      if (!task) {
        return;
      }

      nextTaskIndex += 1;
      activeTasks.set(worker, task);
      emitProgress(
        task.id,
        `running ${workerCount} workers: ${completedCount} of ${tasks.length} puzzles done...`
      );
      worker.postMessage({
        type: 'start',
        payload: {
          tasks: [task]
        }
      } satisfies WorkerRequest);
    };

    const cancel = () => {
      if (settled) return;
      settled = true;
      workers.forEach((worker) => {
        try {
          worker.postMessage({ type: 'cancel' } satisfies WorkerRequest);
        } catch {
          // Worker may already be gone.
        }
      });
      cleanup();
      reject(new Error('Image detection canceled'));
    };

    activeBatch = { cancel };

    emitProgress(
      tasks[0].id,
      `starting ${workerCount} worker${workerCount === 1 ? '' : 's'} for ${tasks.length} puzzles...`
    );

    workers.forEach((worker) => {
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        if (settled) return;

        const message = event.data;
        const activeTask = activeTasks.get(worker);

        if (message.type === 'progress') {
          if (activeTask) {
            emitProgress(
              activeTask.id,
              `running ${workerCount} workers: ${completedCount} of ${tasks.length} puzzles done...`
            );
          }
          return;
        }

        if (message.type === 'result') {
          results.set(message.id, {
            id: message.id,
            result: message.result
          });
          return;
        }

        if (message.type === 'done') {
          if (activeTask) {
            activeTasks.delete(worker);
            completedCount += 1;
            emitProgress(
              activeTask.id,
              `running ${workerCount} workers: ${completedCount} of ${tasks.length} puzzles done...`
            );
            if (completedCount >= tasks.length) {
              finishWithSuccess();
              return;
            }
          }

          dispatchNextTask(worker);
          return;
        }

        if (message.type === 'cancelled') {
          finishWithError(new Error('Image detection canceled'));
          return;
        }

        if (message.type === 'error') {
          finishWithError(new Error(message.message));
        }
      };

      worker.onerror = (event) => {
        const detail = event.message ? ` ${event.message}` : '';
        finishWithError(new Error(`Image detection worker crashed.${detail}`));
      };

      dispatchNextTask(worker);
    });
  });
};
