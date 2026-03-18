import { useEffect, useMemo } from 'react';
import { ExternalLink, LoaderCircle, Trash2, X } from 'lucide-react';
import { cancelOverlayBatchExport } from '../../services/overlayVideoExport';
import { cancelProgressBarExport } from '../../services/progressBarExport';
import { cancelSuperExport, cancelSuperImageExport } from '../../services/superExport';
import { cancelVideoExport } from '../../services/videoExport';
import { useAppStore } from '../../store/appStore';
import type { ExportJob } from '../../types';

const jobTone: Record<string, string> = {
  running: 'bg-[#DBEAFE] text-blue-800',
  completed: 'bg-[#DCFCE7] text-emerald-800',
  failed: 'bg-[#FEE2E2] text-red-800',
  cancelled: 'bg-[#FEF3C7] text-amber-800',
  idle: 'bg-slate-100 text-slate-700'
};

const jobPriority: Record<string, number> = {
  running: 0,
  failed: 1,
  cancelled: 2,
  completed: 3,
  idle: 4
};

const cancelJobByKind = (kind: string) => {
  switch (kind) {
    case 'video':
      cancelVideoExport();
      break;
    case 'overlay':
      cancelOverlayBatchExport();
      break;
    case 'progress':
      cancelProgressBarExport();
      break;
    case 'super_image':
      cancelSuperImageExport();
      break;
    case 'super_video':
      cancelSuperExport();
      break;
    default:
      break;
  }
};

const getProgressValue = (job: ExportJob) => Math.max(0, Math.min(100, Math.round(job.progress * 100)));

const getJobTimestampLabel = (job: ExportJob) => {
  const timestamp = job.endedAt ?? job.startedAt;
  const prefix = job.endedAt ? 'Finished' : 'Started';
  return `${prefix} ${new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
};

export function JobCenterDrawer() {
  const isOpen = useAppStore((state) => state.ui.jobCenterOpen);
  const jobs = useAppStore((state) => state.exports.jobs);
  const setJobCenterOpen = useAppStore((state) => state.setJobCenterOpen);
  const clearFinished = useAppStore((state) => state.clearFinishedExportJobs);
  const removeJob = useAppStore((state) => state.removeExportJob);

  const sortedJobs = useMemo(
    () =>
      [...jobs].sort((left, right) => {
        const priorityDelta = (jobPriority[left.state] ?? 99) - (jobPriority[right.state] ?? 99);
        if (priorityDelta !== 0) return priorityDelta;
        return (right.endedAt ?? right.startedAt) - (left.endedAt ?? left.startedAt);
      }),
    [jobs]
  );
  const runningCount = sortedJobs.filter((job) => job.state === 'running').length;
  const completedCount = sortedJobs.filter((job) => job.state === 'completed').length;
  const failedCount = sortedJobs.filter((job) => job.state === 'failed').length;

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setJobCenterOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, setJobCenterOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[72] bg-black/35 backdrop-blur-sm"
      onClick={() => setJobCenterOpen(false)}
    >
      <div
        className="absolute inset-x-0 bottom-0 top-auto flex max-h-[82dvh] flex-col rounded-t-[28px] border-x-4 border-t-4 border-black bg-[radial-gradient(circle_at_top_right,#DBEAFE_0%,#FFFDF8_34%,#FFF7ED_100%)] shadow-[0px_-12px_0px_0px_rgba(0,0,0,1)] sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-full sm:max-w-[28rem] sm:rounded-none sm:border-t-0 sm:border-r-0 sm:border-l-4 sm:border-b-0 sm:shadow-[-12px_0px_0px_0px_rgba(0,0,0,1)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex justify-center py-2.5 sm:hidden">
          <div className="h-1.5 w-14 rounded-full border border-black/20 bg-slate-300" />
        </div>

        <div className="sticky top-0 z-10 border-b-4 border-black bg-white/95 px-4 py-3 backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Production Queue</div>
              <div className="mt-1 text-xl font-black uppercase text-slate-900 sm:text-2xl">Job Center</div>
              <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-wide sm:text-[11px]">
                <span className="rounded-full border border-black bg-[#DBEAFE] px-2.5 py-1">
                  Running {runningCount}
                </span>
                <span className="rounded-full border border-black bg-white px-2.5 py-1">
                  Done {completedCount}
                </span>
                {failedCount > 0 ? (
                  <span className="rounded-full border border-black bg-[#FEE2E2] px-2.5 py-1">
                    Failed {failedCount}
                  </span>
                ) : null}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setJobCenterOpen(false)}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 border-black bg-white text-slate-900"
              aria-label="Close Job Center"
            >
              <X size={18} strokeWidth={3} />
            </button>
          </div>
        </div>

        <div className="border-b-2 border-black bg-[#FFF7ED] px-4 py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[11px] font-semibold text-slate-600 sm:text-xs">
              Live export progress stays pinned here without taking over the whole workspace.
            </p>
            <button
              type="button"
              onClick={clearFinished}
              className="inline-flex items-center justify-center gap-2 rounded-lg border-2 border-black bg-white px-3 py-2 text-[11px] font-black uppercase tracking-wide text-slate-700 hover:bg-slate-100"
            >
              <Trash2 size={14} />
              Clear Done
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-4 pt-3 sm:p-4">
          <div className="space-y-3">
            {sortedJobs.length ? (
              sortedJobs.map((job) => {
                const progressValue = getProgressValue(job);
                return (
                  <div
                    key={job.id}
                    className="rounded-[20px] border-4 border-black bg-white p-3 shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] sm:p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                            {job.kind.replace(/_/g, ' ')}
                          </div>
                          {job.outputName ? (
                            <span className="rounded-full border border-black bg-[#FFF7ED] px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-slate-700">
                              {job.outputName}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 text-base font-black uppercase leading-tight text-slate-900 sm:text-lg">
                          {job.label}
                        </div>
                        <div className="mt-1 text-xs font-semibold leading-snug text-slate-600 sm:text-sm">
                          {job.status || 'Waiting for updates...'}
                        </div>
                      </div>

                      <span
                        className={`shrink-0 rounded-full border border-black px-2.5 py-1 text-[10px] font-black uppercase ${jobTone[job.state] ?? jobTone.idle}`}
                      >
                        {job.state}
                      </span>
                    </div>

                    <div className="mt-3 rounded-2xl border-2 border-black bg-[#F8FAFC] p-3">
                      <div className="flex items-center justify-between gap-3 text-[10px] font-black uppercase tracking-wide text-slate-600 sm:text-[11px]">
                        <span>{progressValue}%</span>
                        <span>{getJobTimestampLabel(job)}</span>
                      </div>
                      <div className="mt-2 h-2.5 overflow-hidden rounded-full border border-black bg-white">
                        <div
                          className="h-full bg-[#2563EB] transition-all"
                          style={{ width: `${progressValue}%` }}
                        />
                      </div>
                      {job.errorMessage ? (
                        <div className="mt-3 rounded-xl border border-[#EF4444] bg-[#FEF2F2] px-3 py-2 text-[11px] font-semibold text-red-700 sm:text-xs">
                          {job.errorMessage}
                        </div>
                      ) : null}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {job.state === 'running' ? (
                        <button
                          type="button"
                          onClick={() => cancelJobByKind(job.kind)}
                          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border-2 border-black bg-white px-3 py-2 text-[11px] font-black uppercase tracking-wide text-slate-700 hover:bg-red-50"
                        >
                          <LoaderCircle size={14} className="animate-spin" />
                          Cancel
                        </button>
                      ) : null}

                      {job.actions
                        .filter((action) => action.id === 'open' && action.href)
                        .map((action) => (
                          <a
                            key={`${job.id}-${action.id}`}
                            href={action.href}
                            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border-2 border-black bg-[#DBEAFE] px-3 py-2 text-[11px] font-black uppercase tracking-wide text-slate-900 hover:bg-[#BFDBFE]"
                          >
                            <ExternalLink size={14} />
                            {action.label}
                          </a>
                        ))}

                      <button
                        type="button"
                        onClick={() => removeJob(job.id)}
                        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border-2 border-black bg-white px-3 py-2 text-[11px] font-black uppercase tracking-wide text-slate-700 hover:bg-slate-100"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-[20px] border-4 border-black bg-white p-6 text-center shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] sm:p-8">
                <div className="text-base font-black uppercase text-slate-900 sm:text-lg">No jobs yet</div>
                <div className="mt-2 text-xs font-semibold text-slate-600 sm:text-sm">
                  Start a video, overlay, progress, or super export to monitor it here.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
