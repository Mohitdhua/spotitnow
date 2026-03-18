import { useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { FrameExtractorMode } from '../../components/FrameExtractorMode';
import { notifySuccess } from '../../services/notifications';
import { useAppStore } from '../../store/appStore';
import { beginExportJob, cancelExportJobEntry, completeExportJob, patchExportJob } from '../shared/exportJobs';

export default function ExtractorPage() {
  const navigate = useNavigate();
  const jobs = useAppStore((state) => state.exports.jobs);
  const appDefaults = useAppStore((state) => state.video.appDefaults);
  const videoSettings = useAppStore((state) => state.video.videoSettings);
  const videoPackageLibrary = useAppStore((state) => state.video.videoPackageLibrary);
  const defaultsSessionId = useAppStore((state) => state.video.frameDefaultsSessionId);
  const queueInjectedUpload = useAppStore((state) => state.queueInjectedUpload);
  const selectVideoPackage = useAppStore((state) => state.selectVideoPackage);
  const superImageJobIdRef = useRef<string | null>(null);
  const superVideoJobIdRef = useRef<string | null>(null);
  const superImageLastProgressRef = useRef(0);
  const superVideoLastProgressRef = useRef(0);
  const hasActiveAppExport = jobs.some((job) => job.state === 'running');

  const handleSuperImageExportStateChange = useCallback(
    (next: { isExporting: boolean; progress: number; status: string }) => {
      if (next.isExporting) {
        if (!superImageJobIdRef.current) {
          superImageJobIdRef.current = beginExportJob({
            kind: 'super_image',
            label: 'Frame extractor super image export',
            status: next.status || 'Preparing super image export...'
          });
        }
        superImageLastProgressRef.current = next.progress;
        patchExportJob(superImageJobIdRef.current, {
          state: 'running',
          progress: next.progress,
          status: next.status || 'Building exact 3-difference image pairs...'
        });
        return;
      }

      if (!superImageJobIdRef.current) return;
      if (superImageLastProgressRef.current >= 0.999) {
        completeExportJob(superImageJobIdRef.current, 'Super image export complete');
      } else {
        cancelExportJobEntry(superImageJobIdRef.current, 'Super image export stopped');
      }
      superImageJobIdRef.current = null;
      superImageLastProgressRef.current = 0;
    },
    []
  );

  const handleSuperExportStateChange = useCallback(
    (next: { isExporting: boolean; progress: number; status: string }) => {
      if (next.isExporting) {
        if (!superVideoJobIdRef.current) {
          superVideoJobIdRef.current = beginExportJob({
            kind: 'super_video',
            label: 'Frame extractor super video export',
            status: next.status || 'Preparing super export...'
          });
        }
        superVideoLastProgressRef.current = next.progress;
        patchExportJob(superVideoJobIdRef.current, {
          state: 'running',
          progress: next.progress,
          status: next.status || 'Rendering super export videos...'
        });
        return;
      }

      if (!superVideoJobIdRef.current) return;
      if (superVideoLastProgressRef.current >= 0.999) {
        completeExportJob(superVideoJobIdRef.current, 'Super video export complete');
      } else {
        cancelExportJobEntry(superVideoJobIdRef.current, 'Super video export stopped');
      }
      superVideoJobIdRef.current = null;
      superVideoLastProgressRef.current = 0;
    },
    []
  );

  const handleSendToBatchAuto = useCallback(
    (files: File[]) => {
      queueInjectedUpload(files, 'auto');
      notifySuccess('Extracted frames queued for auto review in the upload workflow.');
      navigate('/create/upload');
    },
    [navigate, queueInjectedUpload]
  );

  return (
    <FrameExtractorMode
      onBack={() => navigate('/')}
      defaults={appDefaults.frameExtractorDefaults}
      splitterDefaults={appDefaults.splitterDefaults}
      videoSettings={videoSettings}
      videoPackages={videoPackageLibrary.packages}
      activeVideoPackageId={videoPackageLibrary.activePackageId}
      defaultsSessionId={defaultsSessionId}
      onSendToBatchAuto={handleSendToBatchAuto}
      onSelectVideoPackage={selectVideoPackage}
      onOpenVideoMode={() => navigate('/video/setup')}
      hasActiveAppExport={hasActiveAppExport}
      onSuperImageExportStateChange={handleSuperImageExportStateChange}
      onSuperExportStateChange={handleSuperExportStateChange}
    />
  );
}
