import type { ExportJob } from '../../types';
import { createExportJobId, useAppStore } from '../../store/appStore';

type ExportJobPatch = Partial<Omit<ExportJob, 'id' | 'kind'>>;

const getJob = (jobId: string) =>
  useAppStore.getState().exports.jobs.find((entry) => entry.id === jobId) ?? null;

export const beginExportJob = ({
  kind,
  label,
  status
}: {
  kind: ExportJob['kind'];
  label: string;
  status: string;
}) => {
  const jobId = createExportJobId(kind);
  useAppStore.getState().upsertExportJob({
    id: jobId,
    kind,
    label,
    state: 'running',
    progress: 0,
    status,
    startedAt: Date.now(),
    endedAt: null,
    errorMessage: null,
    actions: []
  });
  return jobId;
};

export const patchExportJob = (jobId: string, patch: ExportJobPatch) => {
  const current = getJob(jobId);
  if (!current) return;
  const hasChange = Object.entries(patch).some(([key, value]) => current[key as keyof ExportJob] !== value);
  if (!hasChange) return;
  useAppStore.getState().upsertExportJob({
    ...current,
    ...patch
  });
};

export const completeExportJob = (jobId: string, status: string) => {
  patchExportJob(jobId, {
    state: 'completed',
    progress: 1,
    status,
    endedAt: Date.now(),
    errorMessage: null
  });
};

export const cancelExportJobEntry = (jobId: string, status: string) => {
  patchExportJob(jobId, {
    state: 'cancelled',
    status,
    endedAt: Date.now()
  });
};

export const failExportJob = (jobId: string, message: string, status = 'Export failed') => {
  patchExportJob(jobId, {
    state: 'failed',
    status,
    endedAt: Date.now(),
    errorMessage: message
  });
};
