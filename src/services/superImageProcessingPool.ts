import type { SplitterSharedRegion } from './appSettings';
import type {
  SuperImageProcessorResultPayload,
  SuperImageProcessorWorkerRequest,
  SuperImageProcessorWorkerResponse
} from './superImageProcessorProtocol';
import type { WatermarkSelectionPreset } from './watermarkRemoval';
import type { MediaTaskEventPayload, MediaWorkerStatsPayload } from './mediaTelemetry';

const MAX_POOL_SIZE = 4;
const IDLE_TIMEOUT_MS = 20_000;

interface SuperImageProcessorPoolTask {
  blob: Blob;
  filename: string;
  sharedRegion?: SplitterSharedRegion | null;
  watermarkEnabled: boolean;
  watermarkSelectionPreset?: WatermarkSelectionPreset | null;
  taskId: string;
  taskLabel: string;
  onTaskEvent?: (event: MediaTaskEventPayload) => void;
  onStats?: (stats: MediaWorkerStatsPayload) => void;
}

interface QueuedPoolTask {
  id: number;
  workerRequest: SuperImageProcessorWorkerRequest;
  transferables: Transferable[];
  resolve: (payload: SuperImageProcessorResultPayload) => void;
  reject: (error: Error) => void;
  telemetry: Pick<SuperImageProcessorPoolTask, 'taskId' | 'taskLabel' | 'onTaskEvent' | 'onStats'>;
  queuedAt: number;
}

interface ActivePoolTask extends QueuedPoolTask {
  workerId: string;
  startedAt: number;
}

export interface SuperImageProcessingPool {
  run(task: SuperImageProcessorPoolTask): Promise<SuperImageProcessorResultPayload>;
  hasPendingWork(): boolean;
  isDestroyed(): boolean;
  destroy(): void;
}

class SharedSuperImageProcessingPool implements SuperImageProcessingPool {
  private readonly workers: Array<{ id: string; worker: Worker }>;
  private readonly idleWorkers: Array<{ id: string; worker: Worker }>;
  private readonly taskQueue: QueuedPoolTask[] = [];
  private readonly activeTasks = new Map<number, ActivePoolTask>();
  private nextTaskId = 1;
  private destroyed = false;
  private readonly startedAt = performance.now();
  private completedTaskCount = 0;
  private totalTaskDurationMs = 0;
  private lastStatsAt = 0;

  constructor(size: number) {
    const safeSize = Math.max(1, Math.min(MAX_POOL_SIZE, Math.floor(size) || 1));
    this.workers = Array.from({ length: safeSize }, (_value, index) => ({
      id: `super-image-pool-${index + 1}`,
      worker: new Worker(new URL('../workers/superImageProcessor.worker.ts', import.meta.url), {
        type: 'module'
      })
    }));
    this.idleWorkers = [...this.workers];

    this.workers.forEach(({ id, worker }) => {
      worker.onmessage = (event: MessageEvent<SuperImageProcessorWorkerResponse>) => {
        if (this.destroyed) {
          return;
        }

        const message = event.data;
        const activeTask = this.activeTasks.get(message.id);
        if (!activeTask) {
          return;
        }

        this.activeTasks.delete(message.id);
        this.idleWorkers.push({ id, worker });

        const durationMs = Math.max(0, performance.now() - activeTask.startedAt);
        this.completedTaskCount += 1;
        this.totalTaskDurationMs += durationMs;

        if (message.type === 'result') {
          activeTask.telemetry.onTaskEvent?.({
            taskId: activeTask.telemetry.taskId,
            label: activeTask.telemetry.taskLabel,
            stage: 'detect',
            state: message.payload.kind === 'error' ? 'failed' : 'done',
            workerId: id,
            durationMs,
            meta:
              message.payload.kind === 'success'
                ? {
                    diffCount: message.payload.diffCount,
                    watermarkApplied: message.payload.watermarkApplied
                  }
                : {
                    warning: message.payload.warning
                  }
          });
          activeTask.resolve(message.payload);
          this.emitStats(activeTask.telemetry.onStats, true);
          this.dispatch();
          return;
        }

        activeTask.telemetry.onTaskEvent?.({
          taskId: activeTask.telemetry.taskId,
          label: activeTask.telemetry.taskLabel,
          stage: 'detect',
          state: 'failed',
          workerId: id,
          durationMs,
          meta: {
            message: message.message
          }
        });
        activeTask.reject(new Error(message.message));
        this.emitStats(activeTask.telemetry.onStats, true);
      };

      worker.onerror = (event) => {
        const detail = event.message ? ` ${event.message}` : '';
        this.failAll(new Error(`Super image processor worker crashed.${detail}`));
      };
    });
  }

  run(task: SuperImageProcessorPoolTask): Promise<SuperImageProcessorResultPayload> {
    if (this.destroyed) {
      throw new Error('Super image processing pool is no longer available.');
    }

    return new Promise<SuperImageProcessorResultPayload>((resolve, reject) => {
      void task.blob.arrayBuffer().then(
        (frameBuffer) => {
          const queuedTask: QueuedPoolTask = {
            id: this.nextTaskId,
            workerRequest: {
              type: 'process',
              id: this.nextTaskId,
              payload: {
                frameBuffer,
                mimeType: task.blob.type || 'image/png',
                filename: task.filename,
                sharedRegion: task.sharedRegion,
                watermarkEnabled: task.watermarkEnabled,
                watermarkSelectionPreset: task.watermarkSelectionPreset
              }
            },
            transferables: [frameBuffer],
            resolve,
            reject,
            telemetry: {
              taskId: task.taskId,
              taskLabel: task.taskLabel,
              onTaskEvent: task.onTaskEvent,
              onStats: task.onStats
            },
            queuedAt: performance.now()
          };
          this.nextTaskId += 1;
          task.onTaskEvent?.({
            taskId: task.taskId,
            label: task.taskLabel,
            stage: 'detect',
            state: 'queued',
            bytes: task.blob.size
          });
          this.taskQueue.push(queuedTask);
          this.emitStats(task.onStats, true);
          this.dispatch();
        },
        (error) => {
          reject(error instanceof Error ? error : new Error('Failed to queue super image processing task.'));
        }
      );
    });
  }

  hasPendingWork() {
    return this.taskQueue.length > 0 || this.activeTasks.size > 0;
  }

  isDestroyed() {
    return this.destroyed;
  }

  destroy() {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.taskQueue.splice(0).forEach((task) => {
      task.reject(new Error('Super image processing pool terminated.'));
      task.telemetry.onTaskEvent?.({
        taskId: task.telemetry.taskId,
        label: task.telemetry.taskLabel,
        stage: 'detect',
        state: 'cancelled'
      });
    });
    this.activeTasks.forEach((task) => {
      task.reject(new Error('Super image processing pool terminated.'));
      task.telemetry.onTaskEvent?.({
        taskId: task.telemetry.taskId,
        label: task.telemetry.taskLabel,
        stage: 'detect',
        state: 'cancelled',
        workerId: task.workerId
      });
    });
    this.activeTasks.clear();
    this.idleWorkers.length = 0;
    this.workers.forEach(({ worker }) => worker.terminate());
  }

  private dispatch() {
    if (this.destroyed) {
      return;
    }

    while (this.idleWorkers.length > 0 && this.taskQueue.length > 0) {
      const availableWorker = this.idleWorkers.shift();
      const queuedTask = this.taskQueue.shift();
      if (!availableWorker || !queuedTask) {
        return;
      }

      const activeTask: ActivePoolTask = {
        ...queuedTask,
        workerId: availableWorker.id,
        startedAt: performance.now()
      };
      this.activeTasks.set(activeTask.id, activeTask);
      activeTask.telemetry.onTaskEvent?.({
        taskId: activeTask.telemetry.taskId,
        label: activeTask.telemetry.taskLabel,
        stage: 'detect',
        state: 'running',
        workerId: availableWorker.id,
        durationMs: Math.max(0, activeTask.startedAt - activeTask.queuedAt)
      });
      availableWorker.worker.postMessage(activeTask.workerRequest, activeTask.transferables);
      this.emitStats(activeTask.telemetry.onStats, true);
    }
  }

  private emitStats(onStats: SuperImageProcessorPoolTask['onStats'], force = false) {
    const now = Date.now();
    if (!force && now - this.lastStatsAt < 250) {
      return;
    }
    this.lastStatsAt = now;
    const elapsedSeconds = Math.max(0.001, (performance.now() - this.startedAt) / 1000);
    onStats?.({
      workerId: 'super-image-processing-pool',
      label: 'Super Image Processing Pool',
      runtimeKind: 'pool',
      activeWorkers: this.workers.length,
      queueSize: this.taskQueue.length,
      runningTasks: this.activeTasks.size,
      avgTaskMs: this.completedTaskCount > 0 ? this.totalTaskDurationMs / this.completedTaskCount : 0,
      fps: this.completedTaskCount / elapsedSeconds,
      stageQueueDepths: {
        split: this.taskQueue.length + this.activeTasks.size,
        detect: this.taskQueue.length + this.activeTasks.size
      },
      metrics: {
        completedTasks: this.completedTaskCount
      },
      updatedAt: now
    });
  }

  private failAll(error: Error) {
    this.taskQueue.splice(0).forEach((task) => task.reject(error));
    this.activeTasks.forEach((task) => task.reject(error));
    this.destroy();
  }
}

let sharedPool: SharedSuperImageProcessingPool | null = null;
let idleTimerId: ReturnType<typeof setTimeout> | null = null;

const clearIdleTimer = () => {
  if (!idleTimerId) return;
  clearTimeout(idleTimerId);
  idleTimerId = null;
};

const resolvePoolSize = () => {
  const hardwareConcurrency =
    typeof navigator !== 'undefined' && Number.isFinite(navigator.hardwareConcurrency)
      ? navigator.hardwareConcurrency
      : 2;
  return Math.min(MAX_POOL_SIZE, Math.max(1, Math.floor(hardwareConcurrency / 2)));
};

export const acquireSuperImageProcessingPool = (): SuperImageProcessingPool => {
  clearIdleTimer();
  if (!sharedPool || sharedPool.isDestroyed()) {
    sharedPool = new SharedSuperImageProcessingPool(resolvePoolSize());
  }
  return sharedPool;
};

export const releaseSuperImageProcessingPool = () => {
  if (!sharedPool || sharedPool.isDestroyed() || sharedPool.hasPendingWork()) {
    if (sharedPool?.isDestroyed()) {
      sharedPool = null;
    }
    return;
  }
  clearIdleTimer();
  idleTimerId = setTimeout(() => {
    if (!sharedPool || sharedPool.hasPendingWork()) {
      return;
    }
    sharedPool.destroy();
    sharedPool = null;
    idleTimerId = null;
  }, IDLE_TIMEOUT_MS);
};

export const disposeSuperImageProcessingPool = () => {
  clearIdleTimer();
  sharedPool?.destroy();
  sharedPool = null;
};
