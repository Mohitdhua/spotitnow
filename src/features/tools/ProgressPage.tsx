import { useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProgressBarMode } from '../../components/ProgressBarMode';
import { useAppStore } from '../../store/appStore';
import { beginExportJob, cancelExportJobEntry, completeExportJob, patchExportJob } from '../shared/exportJobs';

export default function ProgressPage() {
  const navigate = useNavigate();
  const jobs = useAppStore((state) => state.exports.jobs);
  const videoSettings = useAppStore((state) => state.video.videoSettings);
  const setVideoSettings = useAppStore((state) => state.setVideoSettings);
  const jobIdRef = useRef<string | null>(null);
  const lastProgressRef = useRef(0);
  const hasActiveAppExport = jobs.some((job) => job.state === 'running');

  const handleExportStateChange = useCallback(
    (next: { isExporting: boolean; progress: number; status: string }) => {
      if (next.isExporting) {
        if (!jobIdRef.current) {
          jobIdRef.current = beginExportJob({
            kind: 'progress',
            label: 'Progress bar export',
            status: next.status || 'Preparing progress export...'
          });
        }
        lastProgressRef.current = next.progress;
        patchExportJob(jobIdRef.current, {
          state: 'running',
          progress: next.progress,
          status: next.status || 'Rendering progress bars...'
        });
        return;
      }

      if (!jobIdRef.current) return;
      if (lastProgressRef.current >= 0.999) {
        completeExportJob(jobIdRef.current, 'Progress export complete');
      } else {
        cancelExportJobEntry(jobIdRef.current, 'Progress export stopped');
      }
      jobIdRef.current = null;
      lastProgressRef.current = 0;
    },
    []
  );

  return (
    <ProgressBarMode
      settings={{
        visualStyle: videoSettings.visualStyle,
        exportResolution: videoSettings.exportResolution,
        exportBitrateMbps: videoSettings.exportBitrateMbps,
        exportCodec: videoSettings.exportCodec
      }}
      onSettingsChange={(patch) =>
        setVideoSettings((current) => ({
          ...current,
          ...patch
        }))
      }
      onBack={() => navigate('/')}
      hasActiveAppExport={hasActiveAppExport}
      onExportStateChange={handleExportStateChange}
    />
  );
}
