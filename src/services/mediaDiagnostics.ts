import {
  MEDIA_DIAGNOSTICS_MAX_COMPLETED_TASKS,
  type MediaJobKind,
  type MediaJobSnapshot,
  type MediaTaskEventPayload,
  type MediaTaskSnapshot,
  type MediaWorkerStatsPayload,
  type MediaWorkerStatsSnapshot
} from './mediaTelemetry';

interface InternalJobRecord {
  snapshot: MediaJobSnapshot;
  runningTaskMap: Map<string, MediaTaskSnapshot>;
  workerStatsMap: Map<string, MediaWorkerStatsSnapshot>;
}

interface MediaDiagnosticsState {
  jobs: MediaJobSnapshot[];
  updatedAt: number;
}

export interface MediaJobController {
  jobId: string;
  kind: MediaJobKind;
  setProgress: (progress: number | null, status: string) => void;
  handleTaskEvent: (event: MediaTaskEventPayload) => void;
  updateWorkerStats: (stats: MediaWorkerStatsPayload) => void;
  removeWorkerStats: (workerId: string) => void;
  complete: (status?: string) => void;
  fail: (errorMessage: string, status?: string) => void;
  cancel: (status?: string) => void;
}

type Listener = () => void;

let nextJobId = 1;

const listeners = new Set<Listener>();
const jobs = new Map<string, InternalJobRecord>();
let currentSnapshot: MediaDiagnosticsState = {
  jobs: [],
  updatedAt: 0
};

const cloneStageQueueDepths = (
  source: Partial<Record<keyof MediaJobSnapshot['stageQueueDepths'], number>> | Partial<Record<string, number>>
) => ({ ...source });

const sortJobs = (jobList: MediaJobSnapshot[]) =>
  [...jobList].sort((left, right) => {
    if (left.state === 'running' && right.state !== 'running') return -1;
    if (left.state !== 'running' && right.state === 'running') return 1;
    return right.startedAt - left.startedAt;
  });

const rebuildSnapshot = () => {
  currentSnapshot = {
    jobs: sortJobs([...jobs.values()].map((record) => record.snapshot)),
    updatedAt: Date.now()
  };
};

const emitChange = () => {
  rebuildSnapshot();
  listeners.forEach((listener) => listener());
};

const recomputeJobSnapshot = (record: InternalJobRecord) => {
  const runningTasks = [...record.runningTaskMap.values()].sort((left, right) => left.startTime - right.startTime);
  const workerStats = [...record.workerStatsMap.values()].sort((left, right) => left.label.localeCompare(right.label));
  const stageQueueDepths = workerStats.reduce<Partial<Record<string, number>>>((accumulator, stats) => {
    Object.entries(stats.stageQueueDepths).forEach(([stage, depth]) => {
      accumulator[stage] = (accumulator[stage] ?? 0) + (Number.isFinite(depth) ? depth : 0);
    });
    return accumulator;
  }, {});
  const bytesInFlight = workerStats.reduce((sum, stats) => sum + Math.max(0, stats.bytesInFlight || 0), 0);
  const avgTaskSamples = workerStats.filter((stats) => stats.avgTaskMs > 0);
  const fpsSamples = workerStats.filter((stats) => stats.fps > 0);

  record.snapshot = {
    ...record.snapshot,
    runningTasks,
    workerStats,
    stageQueueDepths: cloneStageQueueDepths(stageQueueDepths),
    bytesInFlight,
    averageTaskMs:
      avgTaskSamples.length > 0
        ? avgTaskSamples.reduce((sum, stats) => sum + stats.avgTaskMs, 0) / avgTaskSamples.length
        : 0,
    fps: fpsSamples.length > 0 ? fpsSamples.reduce((sum, stats) => sum + stats.fps, 0) / fpsSamples.length : 0
  };
};

const createInitialSnapshot = (id: string, kind: MediaJobKind, label: string, startedAt: number): MediaJobSnapshot => ({
  id,
  kind,
  label,
  state: 'running',
  startedAt,
  endedAt: null,
  progress: null,
  status: '',
  errorMessage: null,
  runningTasks: [],
  completedTasks: [],
  workerStats: [],
  stageQueueDepths: {},
  bytesInFlight: 0,
  averageTaskMs: 0,
  fps: 0
});

const ensureRecord = (jobId: string) => {
  const record = jobs.get(jobId);
  if (!record) {
    throw new Error(`Unknown media diagnostics job: ${jobId}`);
  }
  return record;
};

const applyTaskEvent = (record: InternalJobRecord, event: MediaTaskEventPayload) => {
  const now = event.timestamp ?? Date.now();
  const existing = record.runningTaskMap.get(event.taskId);
  const nextTask: MediaTaskSnapshot = {
    id: event.taskId,
    label: event.label,
    stage: event.stage,
    state: event.state,
    workerId: event.workerId ?? existing?.workerId ?? null,
    startTime: existing?.startTime ?? now,
    endTime: existing?.endTime ?? null,
    durationMs: existing?.durationMs ?? null,
    bytes: event.bytes ?? existing?.bytes ?? 0,
    meta: {
      ...(existing?.meta ?? {}),
      ...(event.meta ?? {})
    }
  };

  if (event.state === 'queued' || event.state === 'running') {
    record.runningTaskMap.set(event.taskId, nextTask);
    return;
  }

  const completedTask: MediaTaskSnapshot = {
    ...nextTask,
    endTime: now,
    durationMs: event.durationMs ?? Math.max(0, now - nextTask.startTime)
  };
  record.runningTaskMap.delete(event.taskId);
  const completedTasks = [...record.snapshot.completedTasks, completedTask];
  record.snapshot = {
    ...record.snapshot,
    completedTasks: completedTasks.slice(-MEDIA_DIAGNOSTICS_MAX_COMPLETED_TASKS)
  };
};

const applyWorkerStats = (record: InternalJobRecord, stats: MediaWorkerStatsPayload) => {
  const nextStats: MediaWorkerStatsSnapshot = {
    workerId: stats.workerId,
    label: stats.label ?? stats.workerId,
    runtimeKind: stats.runtimeKind ?? 'worker',
    activeWorkers: Math.max(0, Math.floor(stats.activeWorkers || 0)),
    queueSize: Math.max(0, Math.floor(stats.queueSize || 0)),
    runningTasks: Math.max(0, Math.floor(stats.runningTasks ?? 0)),
    avgTaskMs: Math.max(0, stats.avgTaskMs ?? 0),
    fps: Math.max(0, stats.fps ?? 0),
    bytesInFlight: Math.max(0, stats.bytesInFlight ?? 0),
    stageQueueDepths: { ...(stats.stageQueueDepths ?? {}) },
    metrics: { ...(stats.metrics ?? {}) },
    updatedAt: stats.updatedAt ?? Date.now()
  };
  record.workerStatsMap.set(stats.workerId, nextStats);
};

const removeWorkerStats = (record: InternalJobRecord, workerId: string) => {
  if (!record.workerStatsMap.delete(workerId)) {
    return;
  }
};

const finalizeJob = (
  record: InternalJobRecord,
  nextState: MediaJobSnapshot['state'],
  status: string,
  errorMessage: string | null
) => {
  const endedAt = Date.now();
  record.runningTaskMap.forEach((task) => {
    const finishedTask: MediaTaskSnapshot = {
      ...task,
      state: nextState === 'cancelled' ? 'cancelled' : 'failed',
      endTime: endedAt,
      durationMs: Math.max(0, endedAt - task.startTime)
    };
    record.snapshot.completedTasks = [...record.snapshot.completedTasks, finishedTask].slice(
      -MEDIA_DIAGNOSTICS_MAX_COMPLETED_TASKS
    );
  });
  record.runningTaskMap.clear();
  record.snapshot = {
    ...record.snapshot,
    state: nextState,
    status,
    errorMessage,
    endedAt
  };
  recomputeJobSnapshot(record);
};

export const mediaDiagnosticsStore = {
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): MediaDiagnosticsState {
    return currentSnapshot;
  },
  startJob(kind: MediaJobKind, label: string): MediaJobController {
    const jobId = `media-job-${nextJobId}`;
    nextJobId += 1;
    const record: InternalJobRecord = {
      snapshot: createInitialSnapshot(jobId, kind, label, Date.now()),
      runningTaskMap: new Map<string, MediaTaskSnapshot>(),
      workerStatsMap: new Map<string, MediaWorkerStatsSnapshot>()
    };
    jobs.set(jobId, record);
    emitChange();

    const controller: MediaJobController = {
      jobId,
      kind,
      setProgress(progress, status) {
        const nextRecord = ensureRecord(jobId);
        nextRecord.snapshot = {
          ...nextRecord.snapshot,
          progress,
          status
        };
        emitChange();
      },
      handleTaskEvent(event) {
        const nextRecord = ensureRecord(jobId);
        applyTaskEvent(nextRecord, event);
        recomputeJobSnapshot(nextRecord);
        emitChange();
      },
      updateWorkerStats(stats) {
        const nextRecord = ensureRecord(jobId);
        applyWorkerStats(nextRecord, stats);
        recomputeJobSnapshot(nextRecord);
        emitChange();
      },
      removeWorkerStats(workerId) {
        const nextRecord = ensureRecord(jobId);
        removeWorkerStats(nextRecord, workerId);
        recomputeJobSnapshot(nextRecord);
        emitChange();
      },
      complete(status = 'Completed') {
        const nextRecord = ensureRecord(jobId);
        finalizeJob(nextRecord, 'completed', status, null);
        emitChange();
      },
      fail(errorMessage, status = 'Failed') {
        const nextRecord = ensureRecord(jobId);
        finalizeJob(nextRecord, 'failed', status, errorMessage);
        emitChange();
      },
      cancel(status = 'Canceled') {
        const nextRecord = ensureRecord(jobId);
        finalizeJob(nextRecord, 'cancelled', status, null);
        emitChange();
      }
    };

    return controller;
  }
};
