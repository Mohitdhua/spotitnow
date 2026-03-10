const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export interface BatchExportTask<T> {
  id: string;
  label: string;
  weight: number;
  run: (reportProgress: (progress: number, status?: string) => void) => Promise<T>;
  cancel: () => void;
}

interface RunBatchExportTasksOptions<T> {
  tasks: BatchExportTask<T>[];
  maxConcurrency: number;
  signal?: AbortSignal;
  cancelMessage?: string;
  onProgress?: (progress: number, status?: string) => void;
}

const normalizeWeight = (weight: number) => (Number.isFinite(weight) && weight > 0 ? weight : 1);

export const runBatchExportTasks = async <T>({
  tasks,
  maxConcurrency,
  signal,
  cancelMessage = 'Export canceled',
  onProgress
}: RunBatchExportTasksOptions<T>): Promise<T[]> => {
  if (tasks.length === 0) {
    onProgress?.(1, 'Nothing to export');
    return [];
  }

  if (signal?.aborted) {
    throw new Error(cancelMessage);
  }

  const normalizedWeights = tasks.map((task) => normalizeWeight(task.weight));
  const totalWeight = normalizedWeights.reduce((sum, weight) => sum + weight, 0);
  const safeConcurrency = Math.max(1, Math.min(tasks.length, Math.floor(maxConcurrency) || 1));
  const progressByTaskId = new Map(tasks.map((task) => [task.id, 0]));
  const results = new Array<T>(tasks.length);
  let nextTaskIndex = 0;
  let runningCount = 0;
  let settled = false;
  let lastStatus = `Preparing ${tasks.length} export${tasks.length === 1 ? '' : 's'}`;

  const emitProgress = (status?: string) => {
    if (status) {
      lastStatus = status;
    }
    const weightedProgress = tasks.reduce((sum, task, index) => {
      return sum + (progressByTaskId.get(task.id) ?? 0) * normalizedWeights[index];
    }, 0);
    onProgress?.(totalWeight > 0 ? clamp(weightedProgress / totalWeight, 0, 1) : 0, lastStatus);
  };

  const cancelAllTasks = () => {
    tasks.forEach((task) => {
      try {
        task.cancel();
      } catch {
        // Ignore individual cancellation failures while unwinding the batch.
      }
    });
  };

  emitProgress(lastStatus);

  return await new Promise<T[]>((resolve, reject) => {
    const cleanupAbortListener = () => {
      if (!signal) return;
      signal.removeEventListener('abort', handleAbort);
    };

    const finish = (error: Error | null) => {
      if (settled) return;
      settled = true;
      cleanupAbortListener();
      if (error) {
        cancelAllTasks();
        reject(error);
        return;
      }
      progressByTaskId.forEach((_value, taskId) => {
        progressByTaskId.set(taskId, 1);
      });
      emitProgress(lastStatus);
      resolve(results);
    };

    const handleAbort = () => {
      finish(new Error(cancelMessage));
    };

    const maybeStartMore = () => {
      if (settled) return;
      if (signal?.aborted) {
        finish(new Error(cancelMessage));
        return;
      }

      while (runningCount < safeConcurrency && nextTaskIndex < tasks.length) {
        const taskIndex = nextTaskIndex;
        const task = tasks[taskIndex];
        nextTaskIndex += 1;
        runningCount += 1;

        void task
          .run((progress, status) => {
            if (settled) return;
            progressByTaskId.set(task.id, clamp(progress, 0, 1));
            emitProgress(status ?? task.label);
          })
          .then((result) => {
            if (settled) return;
            results[taskIndex] = result;
            progressByTaskId.set(task.id, 1);
            runningCount -= 1;
            emitProgress(`${task.label} complete`);
            if (runningCount === 0 && nextTaskIndex >= tasks.length) {
              finish(null);
              return;
            }
            maybeStartMore();
          })
          .catch((error) => {
            if (settled) return;
            runningCount -= 1;
            const wrappedError =
              signal?.aborted || (error instanceof Error && error.message === cancelMessage)
                ? new Error(cancelMessage)
                : error instanceof Error
                  ? error
                  : new Error('Batch export failed.');
            finish(wrappedError);
          });
      }
    };

    if (signal) {
      signal.addEventListener('abort', handleAbort, { once: true });
    }

    maybeStartMore();
  });
};
