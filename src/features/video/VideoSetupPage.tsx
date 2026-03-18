import { useMemo, useState } from 'react';
import { Film, Layers, PencilLine } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { ConfirmDialog } from '../../app/components/ConfirmDialog';
import { TextPromptDialog } from '../../app/components/TextPromptDialog';
import { VideoSettingsPanel } from '../../components/VideoSettingsPanel';
import type { VideoUserPackage } from '../../types';
import { notifyError, notifyInfo, notifySuccess } from '../../services/notifications';
import { exportVideoWithWebCodecs } from '../../services/videoExport';
import { useAppStore } from '../../store/appStore';
import { beginExportJob, cancelExportJobEntry, completeExportJob, failExportJob, patchExportJob } from '../shared/exportJobs';

export default function VideoSetupPage() {
  const navigate = useNavigate();
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStatus, setExportStatus] = useState('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<VideoUserPackage | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VideoUserPackage | null>(null);
  const batch = useAppStore((state) => state.workspace.batch);
  const jobs = useAppStore((state) => state.exports.jobs);
  const videoSettings = useAppStore((state) => state.video.videoSettings);
  const videoPackageLibrary = useAppStore((state) => state.video.videoPackageLibrary);
  const backgroundPacksSessionId = useAppStore((state) => state.video.backgroundPacksSessionId);
  const setVideoSettings = useAppStore((state) => state.setVideoSettings);
  const selectVideoPackage = useAppStore((state) => state.selectVideoPackage);
  const createVideoPackage = useAppStore((state) => state.createVideoPackage);
  const duplicateActiveVideoPackage = useAppStore((state) => state.duplicateActiveVideoPackage);
  const renameVideoPackage = useAppStore((state) => state.renameVideoPackage);
  const deleteVideoPackage = useAppStore((state) => state.deleteVideoPackage);
  const changeVideoAspectRatio = useAppStore((state) => state.changeVideoAspectRatio);

  const activePackage = useMemo(
    () =>
      videoPackageLibrary.packages.find((entry) => entry.id === videoPackageLibrary.activePackageId) ??
      videoPackageLibrary.packages[0] ??
      null,
    [videoPackageLibrary.activePackageId, videoPackageLibrary.packages]
  );

  const hasRunningExport = jobs.some((job) => job.state === 'running');

  const handleExport = async () => {
    if (!batch.length) {
      notifyError('Add or load at least one puzzle before exporting.');
      return;
    }
    if (hasRunningExport) {
      notifyError('Another export is already running. Wait for it to finish or cancel it first.');
      return;
    }
    if (isExporting) return;

    const jobId = beginExportJob({
      kind: 'video',
      label: `Video export (${batch.length} puzzle${batch.length === 1 ? '' : 's'})`,
      status: 'Preparing export...'
    });

    try {
      setIsExporting(true);
      setExportProgress(0);
      setExportStatus('Preparing export...');

      await exportVideoWithWebCodecs({
        puzzles: batch,
        settings: videoSettings,
        onProgress: (progress, label) => {
          const nextStatus = label || 'Rendering video...';
          setExportProgress(progress);
          setExportStatus(nextStatus);
          patchExportJob(jobId, {
            state: 'running',
            progress,
            status: nextStatus
          });
        }
      });

      setExportProgress(1);
      setExportStatus('Export complete');
      completeExportJob(jobId, 'Export complete');
      notifySuccess('Video export finished.');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Export failed. Try a different codec or resolution.';
      if (message === 'Export canceled') {
        setExportStatus('Export canceled');
        setExportProgress(0);
        cancelExportJobEntry(jobId, 'Export canceled');
        notifyInfo('Video export canceled.');
      } else {
        setExportStatus('');
        failExportJob(jobId, message);
        notifyError(message);
      }
    } finally {
      setIsExporting(false);
    }
  };

  const handleStartPreview = () => {
    if (!batch.length) {
      notifyError('Load or create at least one puzzle before starting video preview.');
      return;
    }
    navigate('/video/preview');
  };

  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border-4 border-black bg-white p-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#2563EB]">Video Workflow</div>
            <h1 className="mt-3 text-3xl font-black uppercase tracking-tight text-slate-900">Package the batch for video production</h1>
            <p className="mt-3 text-sm font-semibold text-slate-600">
              Tune package presets, adjust the aspect ratio, preview timing, and keep exports visible in the Job Center instead of hidden behind one giant app screen.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              to="/create/review"
              className="inline-flex items-center gap-2 rounded-xl border-2 border-black bg-white px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-700 hover:bg-slate-100"
            >
              <Layers size={14} strokeWidth={2.5} />
              Review Batch
            </Link>
            <Link
              to="/create/editor"
              className="inline-flex items-center gap-2 rounded-xl border-2 border-black bg-white px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-700 hover:bg-slate-100"
            >
              <PencilLine size={14} strokeWidth={2.5} />
              Refine Puzzle
            </Link>
            <Link
              to="/editor"
              className="inline-flex items-center gap-2 rounded-xl border-2 border-black bg-[#FCE7F3] px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-900 hover:bg-[#FBCFE8]"
            >
              <Film size={14} strokeWidth={2.5} />
              Editor Studio
            </Link>
          </div>
        </div>
      </section>

      <VideoSettingsPanel
        settings={videoSettings}
        puzzles={batch}
        videoPackages={videoPackageLibrary.packages}
        activeVideoPackageId={videoPackageLibrary.activePackageId}
        backgroundPacksSessionId={backgroundPacksSessionId}
        onSettingsChange={(next) => setVideoSettings(next)}
        onAspectRatioChange={changeVideoAspectRatio}
        onSelectVideoPackage={selectVideoPackage}
        onCreateVideoPackage={() => setCreateDialogOpen(true)}
        onDuplicateVideoPackage={() => setDuplicateDialogOpen(true)}
        onRenameVideoPackage={(packageId) => {
          const target = videoPackageLibrary.packages.find((entry) => entry.id === packageId) ?? null;
          setRenameTarget(target);
        }}
        onDeleteVideoPackage={(packageId) => {
          const target = videoPackageLibrary.packages.find((entry) => entry.id === packageId) ?? null;
          setDeleteTarget(target);
        }}
        onExport={handleExport}
        isExporting={isExporting}
        exportProgress={exportProgress}
        exportStatus={exportStatus}
        onStart={handleStartPreview}
        onBack={() => navigate('/')}
      />

      <TextPromptDialog
        open={createDialogOpen}
        title="Create video package"
        description="Packages help you keep one reusable look across different projects and aspect ratios."
        label="Package name"
        placeholder="Creator package"
        initialValue={activePackage ? `${activePackage.name} Copy` : 'Creator package'}
        confirmLabel="Create"
        onOpenChange={setCreateDialogOpen}
        onConfirm={(value) => {
          createVideoPackage(value.trim());
          setCreateDialogOpen(false);
          notifySuccess(`Created "${value.trim()}".`);
        }}
      />

      <TextPromptDialog
        open={duplicateDialogOpen}
        title="Duplicate active package"
        description="Use duplication when the active package is close and you only need a variation."
        label="New package name"
        placeholder="Package copy"
        initialValue={activePackage ? `${activePackage.name} Copy` : 'Package copy'}
        confirmLabel="Duplicate"
        onOpenChange={setDuplicateDialogOpen}
        onConfirm={(value) => {
          duplicateActiveVideoPackage(value.trim());
          setDuplicateDialogOpen(false);
          notifySuccess(`Duplicated package as "${value.trim()}".`);
        }}
      />

      <TextPromptDialog
        open={Boolean(renameTarget)}
        title="Rename video package"
        description="Rename the package without changing the current settings."
        label="Package name"
        placeholder="Package name"
        initialValue={renameTarget?.name ?? ''}
        confirmLabel="Rename"
        onOpenChange={(open) => {
          if (!open) {
            setRenameTarget(null);
          }
        }}
        onConfirm={(value) => {
          if (!renameTarget) return;
          renameVideoPackage(renameTarget.id, value.trim());
          setRenameTarget(null);
          notifySuccess(`Renamed package to "${value.trim()}".`);
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete video package?"
        description={deleteTarget ? `Delete "${deleteTarget.name}" from the package library?` : ''}
        confirmLabel="Delete"
        tone="danger"
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
        onConfirm={() => {
          if (!deleteTarget) return;
          deleteVideoPackage(deleteTarget.id);
          notifySuccess(`Deleted "${deleteTarget.name}".`);
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}
