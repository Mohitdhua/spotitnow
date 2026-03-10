export type MediaJobKind =
  | 'video_export'
  | 'frame_extract'
  | 'super_image_export'
  | 'super_video_export'
  | 'overlay_export'
  | 'progress_bar_export';

export type MediaTaskStage =
  | 'load'
  | 'decode'
  | 'split'
  | 'detect'
  | 'render'
  | 'encode'
  | 'package'
  | 'write';

export type MediaTaskState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export type MediaWorkerRuntimeKind = 'worker' | 'pool' | 'coordinator';

export interface MediaTaskSnapshot {
  id: string;
  label: string;
  stage: MediaTaskStage;
  state: MediaTaskState;
  workerId: string | null;
  startTime: number;
  endTime: number | null;
  durationMs: number | null;
  bytes: number;
  meta?: Record<string, string | number | boolean | null>;
}

export interface MediaWorkerStatsSnapshot {
  workerId: string;
  label: string;
  runtimeKind: MediaWorkerRuntimeKind;
  activeWorkers: number;
  queueSize: number;
  runningTasks: number;
  avgTaskMs: number;
  fps: number;
  bytesInFlight: number;
  stageQueueDepths: Partial<Record<MediaTaskStage, number>>;
  metrics: Record<string, number>;
  updatedAt: number;
}

export interface MediaJobSnapshot {
  id: string;
  kind: MediaJobKind;
  label: string;
  state: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: number;
  endedAt: number | null;
  progress: number | null;
  status: string;
  errorMessage: string | null;
  runningTasks: MediaTaskSnapshot[];
  completedTasks: MediaTaskSnapshot[];
  workerStats: MediaWorkerStatsSnapshot[];
  stageQueueDepths: Partial<Record<MediaTaskStage, number>>;
  bytesInFlight: number;
  averageTaskMs: number;
  fps: number;
}

export interface MediaTaskEventPayload {
  taskId: string;
  label: string;
  stage: MediaTaskStage;
  state: MediaTaskState;
  workerId?: string | null;
  timestamp?: number;
  durationMs?: number;
  bytes?: number;
  meta?: Record<string, string | number | boolean | null>;
}

export interface MediaWorkerStatsPayload {
  workerId: string;
  label?: string;
  runtimeKind?: MediaWorkerRuntimeKind;
  activeWorkers: number;
  queueSize: number;
  runningTasks?: number;
  avgTaskMs?: number;
  fps?: number;
  bytesInFlight?: number;
  stageQueueDepths?: Partial<Record<MediaTaskStage, number>>;
  metrics?: Record<string, number>;
  updatedAt?: number;
}

export interface MediaTaskEventMessage {
  type: 'task-event';
  event: MediaTaskEventPayload;
}

export interface MediaWorkerStatsMessage {
  type: 'stats';
  stats: MediaWorkerStatsPayload;
}

export const MEDIA_DIAGNOSTICS_MAX_COMPLETED_TASKS = 200;
export const MEDIA_DIAGNOSTICS_STATS_INTERVAL_MS = 250;
