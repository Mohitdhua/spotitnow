import { useEffect, useMemo, useState } from 'react';
import { Activity, Cpu, HardDrive, ListTree, X } from 'lucide-react';
import { useMediaDiagnostics } from '../hooks/useMediaDiagnostics';
import type { MediaJobSnapshot, MediaTaskSnapshot, MediaWorkerStatsSnapshot } from '../services/mediaTelemetry';

const formatDuration = (value: number | null) => {
  if (!Number.isFinite(value ?? NaN) || value === null) return '--';
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
};

const formatBytes = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let nextValue = value;
  let unitIndex = 0;
  while (nextValue >= 1024 && unitIndex < units.length - 1) {
    nextValue /= 1024;
    unitIndex += 1;
  }
  const precision = nextValue >= 100 ? 0 : nextValue >= 10 ? 1 : 2;
  return `${nextValue.toFixed(precision)} ${units[unitIndex]}`;
};

const taskStateTone: Record<MediaTaskSnapshot['state'], string> = {
  queued: 'bg-slate-100 text-slate-700',
  running: 'bg-blue-100 text-blue-700',
  done: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700',
  cancelled: 'bg-amber-100 text-amber-700'
};

const getRealWorkerCounts = (workerStats: MediaWorkerStatsSnapshot[]) =>
  workerStats.reduce(
    (totals, stats) => {
      if (stats.runtimeKind === 'coordinator') {
        return totals;
      }

      const liveWorkers = Math.max(0, stats.activeWorkers);
      const busyWorkers =
        stats.runtimeKind === 'pool'
          ? Math.min(liveWorkers, Math.max(0, stats.runningTasks))
          : stats.runningTasks > 0
            ? liveWorkers
            : 0;

      return {
        busy: totals.busy + busyWorkers,
        live: totals.live + liveWorkers
      };
    },
    { busy: 0, live: 0 }
  );

const getWorkerBadgeLabel = (stats: MediaWorkerStatsSnapshot) => {
  if (stats.runtimeKind === 'pool') {
    return `${stats.activeWorkers} allocated`;
  }
  if (stats.runtimeKind === 'coordinator') {
    return `${stats.runningTasks} running`;
  }
  return `${stats.activeWorkers} live`;
};

const getWorkerKindLabel = (stats: MediaWorkerStatsSnapshot) => {
  if (stats.runtimeKind === 'pool') return 'pool';
  if (stats.runtimeKind === 'coordinator') return 'coordinator';
  return 'worker';
};

const renderTaskList = (title: string, tasks: MediaTaskSnapshot[]) => (
  <div className="rounded-2xl border-2 border-black bg-white p-3">
    <div className="mb-2 text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">{title}</div>
    <div className="space-y-2">
      {tasks.length ? (
        tasks.map((task) => (
          <div key={`${title}-${task.id}-${task.state}`} className="rounded-xl border border-slate-200 bg-slate-50 p-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-slate-900">{task.label}</div>
                <div className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">
                  {task.stage}
                  {task.workerId ? ` | ${task.workerId}` : ''}
                </div>
              </div>
              <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${taskStateTone[task.state]}`}>
                {task.state}
              </span>
            </div>
            <div className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {formatDuration(task.durationMs)}
              {task.bytes > 0 ? ` | ${formatBytes(task.bytes)}` : ''}
            </div>
          </div>
        ))
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300 px-3 py-4 text-[11px] font-semibold text-slate-500">
          No tasks.
        </div>
      )}
    </div>
  </div>
);

const renderJobCard = (job: MediaJobSnapshot) => {
  const queuedTasks = job.runningTasks.filter((task) => task.state === 'queued');
  const runningTasks = job.runningTasks.filter((task) => task.state === 'running');
  const completedTasks = [...job.completedTasks].slice(-8).reverse();
  const workerCounts = getRealWorkerCounts(job.workerStats);

  return (
    <div key={job.id} className="rounded-[24px] border-4 border-black bg-[#FFFDF8] p-4 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">{job.kind.replace(/_/g, ' ')}</div>
            <div className="mt-1 text-lg font-black uppercase text-slate-900">{job.label}</div>
            <div className="mt-1 text-xs font-semibold text-slate-600">
              {job.status || job.state}
              {job.errorMessage ? ` | ${job.errorMessage}` : ''}
            </div>
          </div>
          <div className="rounded-full border-2 border-black bg-black px-3 py-1 text-[11px] font-black uppercase text-white">
            {job.state}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
          <div className="rounded-xl border-2 border-black bg-white p-2">
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Progress</div>
            <div className="mt-2 text-xl font-black text-slate-900">
              {job.progress === null ? '--' : `${Math.round(job.progress * 100)}%`}
            </div>
          </div>
          <div className="rounded-xl border-2 border-black bg-white p-2">
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">FPS</div>
            <div className="mt-2 text-xl font-black text-slate-900">{job.fps > 0 ? job.fps.toFixed(1) : '--'}</div>
          </div>
          <div className="rounded-xl border-2 border-black bg-white p-2">
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Avg Task</div>
            <div className="mt-2 text-xl font-black text-slate-900">{job.averageTaskMs > 0 ? `${Math.round(job.averageTaskMs)} ms` : '--'}</div>
          </div>
          <div className="rounded-xl border-2 border-black bg-white p-2">
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Bytes In Flight</div>
            <div className="mt-2 text-xl font-black text-slate-900">{formatBytes(job.bytesInFlight)}</div>
          </div>
          <div className="rounded-xl border-2 border-black bg-white p-2">
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Workers</div>
            <div className="mt-2 text-xl font-black text-slate-900">{workerCounts.live}</div>
            <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {workerCounts.busy} busy
            </div>
          </div>
        </div>

        <div className="rounded-2xl border-2 border-black bg-[#F8FAFC] p-3">
          <div className="mb-2 text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Stage Queues</div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {Object.entries(job.stageQueueDepths).length ? (
              Object.entries(job.stageQueueDepths).map(([stage, depth]) => (
                <div key={`${job.id}-${stage}`} className="rounded-xl border border-slate-200 bg-white p-2">
                  <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">{stage}</div>
                  <div className="mt-1 text-lg font-black text-slate-900">{depth}</div>
                </div>
              ))
            ) : (
              <div className="col-span-full rounded-xl border border-dashed border-slate-300 px-3 py-4 text-[11px] font-semibold text-slate-500">
                No queue telemetry yet.
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border-2 border-black bg-[#F8FAFC] p-3">
          <div className="mb-2 text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Worker Stats</div>
          <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
            {job.workerStats.length ? (
              job.workerStats.map((stats) => (
                <div key={`${job.id}-${stats.workerId}`} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-black uppercase text-slate-900">{stats.label}</div>
                      <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        {stats.workerId} | {getWorkerKindLabel(stats)}
                      </div>
                    </div>
                    <div className="rounded-full border border-black bg-[#EFF6FF] px-2 py-1 text-[10px] font-black uppercase text-slate-700">
                      {getWorkerBadgeLabel(stats)}
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-[11px] font-semibold text-slate-600">
                      Queue {stats.queueSize}
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-[11px] font-semibold text-slate-600">
                      Running {stats.runningTasks}
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-[11px] font-semibold text-slate-600">
                      Avg {stats.avgTaskMs > 0 ? `${Math.round(stats.avgTaskMs)} ms` : '--'}
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-[11px] font-semibold text-slate-600">
                      FPS {stats.fps > 0 ? stats.fps.toFixed(1) : '--'}
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-[11px] font-semibold text-slate-600">
                      Bytes {formatBytes(stats.bytesInFlight)}
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-[11px] font-semibold text-slate-600">
                      Updated {new Date(stats.updatedAt).toLocaleTimeString()}
                    </div>
                  </div>
                  {Object.keys(stats.metrics).length ? (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {Object.entries(stats.metrics).map(([key, value]) => (
                        <div key={`${stats.workerId}-${key}`} className="rounded-lg border border-dashed border-slate-300 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                          {key}: {Number.isInteger(value) ? value : value.toFixed(2)}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-slate-300 px-3 py-4 text-[11px] font-semibold text-slate-500">
                No worker stats yet.
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          {renderTaskList('Queued Tasks', queuedTasks)}
          {renderTaskList('Running Tasks', runningTasks)}
          {renderTaskList('Completed Tasks', completedTasks)}
        </div>
      </div>
    </div>
  );
};

export function MediaDiagnosticsDrawer() {
  const diagnostics = useMediaDiagnostics();
  const [isOpen, setIsOpen] = useState(false);
  const [memoryLabel, setMemoryLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const readMemory = () => {
      const memory = (performance as Performance & {
        memory?: {
          usedJSHeapSize: number;
          jsHeapSizeLimit: number;
        };
      }).memory;
      if (!memory) {
        setMemoryLabel(null);
        return;
      }
      setMemoryLabel(`${formatBytes(memory.usedJSHeapSize)} / ${formatBytes(memory.jsHeapSizeLimit)}`);
    };

    readMemory();
    const intervalId = window.setInterval(readMemory, 250);
    return () => window.clearInterval(intervalId);
  }, [isOpen]);

  const activeJobs = diagnostics.jobs.filter((job) => job.state === 'running');
  const headline = useMemo(() => {
    if (activeJobs.length > 0) {
      return `${activeJobs.length} active job${activeJobs.length === 1 ? '' : 's'}`;
    }
    return diagnostics.jobs.length ? `${diagnostics.jobs.length} recent jobs` : 'No jobs yet';
  }, [activeJobs.length, diagnostics.jobs.length]);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="fixed bottom-4 right-4 z-[70] inline-flex items-center gap-2 rounded-2xl border-4 border-black bg-[#DBEAFE] px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-900 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] transition-all hover:-translate-y-0.5"
      >
        <Activity size={16} strokeWidth={3} />
        <span>Task List</span>
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-[69] bg-black/35 backdrop-blur-sm">
          <div className="absolute inset-y-0 right-0 flex w-full max-w-3xl flex-col border-l-4 border-black bg-[radial-gradient(circle_at_top_right,#DBEAFE_0%,#FFFDF8_34%,#FFF7ED_100%)] shadow-[-12px_0px_0px_0px_rgba(0,0,0,1)]">
            <div className="flex items-start justify-between gap-3 border-b-4 border-black bg-white px-4 py-4">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Developer Diagnostics</div>
                <div className="mt-1 text-2xl font-black uppercase text-slate-900">Media Pipeline Monitor</div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                  <span className="inline-flex items-center gap-1 rounded-full border border-black bg-[#FDE68A] px-2.5 py-1">
                    <ListTree size={12} strokeWidth={2.5} />
                    {headline}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-black bg-white px-2.5 py-1">
                    <Cpu size={12} strokeWidth={2.5} />
                    Updated {new Date(diagnostics.updatedAt).toLocaleTimeString()}
                  </span>
                  {memoryLabel ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-black bg-white px-2.5 py-1">
                      <HardDrive size={12} strokeWidth={2.5} />
                      Heap {memoryLabel}
                    </span>
                  ) : null}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="inline-flex h-11 w-11 items-center justify-center rounded-xl border-2 border-black bg-white text-slate-900"
              >
                <X size={18} strokeWidth={3} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <div className="space-y-4">
                {diagnostics.jobs.length ? (
                  diagnostics.jobs.map((job) => renderJobCard(job))
                ) : (
                  <div className="rounded-[24px] border-4 border-black bg-white p-8 text-center shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
                    <div className="text-lg font-black uppercase text-slate-900">No media jobs yet</div>
                    <div className="mt-2 text-sm font-semibold text-slate-600">
                      Start a video export, frame extraction, or Super Image export to inspect worker activity.
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
