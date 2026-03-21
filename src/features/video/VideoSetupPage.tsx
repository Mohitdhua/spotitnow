import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConfirmDialog } from '../../app/components/ConfirmDialog';
import { TextPromptDialog } from '../../app/components/TextPromptDialog';
import { VideoSettingsPanel } from '../../components/VideoSettingsPanel';
import type { VideoSettings, VideoUserPackage } from '../../types';
import { migrateInlineImageSource } from '../../services/imageAssetStore';
import { notifyError, notifyInfo, notifySuccess } from '../../services/notifications';
import { exportVideoWithWebCodecs } from '../../services/videoExport';
import { useAppStore } from '../../store/appStore';
import { beginExportJob, cancelExportJobEntry, completeExportJob, failExportJob, patchExportJob } from '../shared/exportJobs';

const resolveVideoPackageActionError = (
  error: unknown,
  fallback = 'Could not save the video package.'
) => {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return 'Video package storage is full. Large legacy inline logos are usually the cause. Re-upload the logo on the active package and try again.';
  }
  return error instanceof Error && error.message.trim() ? error.message : fallback;
};

const normalizeVideoSettingsLogo = async (settings: VideoSettings): Promise<VideoSettings> => {
  const nextLogo = await migrateInlineImageSource(settings.logo, 'video-package-logo');
  if (nextLogo === settings.logo) {
    return settings;
  }
  return {
    ...settings,
    logo: nextLogo
  };
};

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

  useEffect(() => {
    let cancelled = false;
    const originalLogo = videoSettings.logo;

    const migrateActiveLogo = async () => {
      const nextLogo = await migrateInlineImageSource(originalLogo, 'video-package-logo');
      if (cancelled || nextLogo === originalLogo) {
        return;
      }

      try {
        const currentSettings = useAppStore.getState().video.videoSettings;
        if (currentSettings.logo !== originalLogo) {
          return;
        }
        setVideoSettings({
          ...currentSettings,
          logo: nextLogo
        });
      } catch (error) {
        if (!cancelled) {
          notifyError(resolveVideoPackageActionError(error));
        }
      }
    };

    void migrateActiveLogo();

    return () => {
      cancelled = true;
    };
  }, [videoSettings.logo, setVideoSettings]);

  const activePackage = useMemo(
    () =>
      videoPackageLibrary.packages.find((entry) => entry.id === videoPackageLibrary.activePackageId) ??
      videoPackageLibrary.packages[0] ??
      null,
    [videoPackageLibrary.activePackageId, videoPackageLibrary.packages]
  );

  const hasRunningExport = jobs.some((job) => job.state === 'running');

  const ensureCurrentLogoUsesSharedStorage = async () => {
    const currentSettings = useAppStore.getState().video.videoSettings;
    const nextSettings = await normalizeVideoSettingsLogo(currentSettings);
    if (nextSettings === currentSettings) {
      return true;
    }

    try {
      setVideoSettings(nextSettings);
      return true;
    } catch (error) {
      notifyError(resolveVideoPackageActionError(error));
      return false;
    }
  };

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
    <div className="h-[100dvh] overflow-hidden">
      <VideoSettingsPanel
        settings={videoSettings}
        puzzles={batch}
        videoPackages={videoPackageLibrary.packages}
        activeVideoPackageId={videoPackageLibrary.activePackageId}
        backgroundPacksSessionId={backgroundPacksSessionId}
        onSettingsChange={(next) => {
          try {
            setVideoSettings(next);
          } catch (error) {
            notifyError(resolveVideoPackageActionError(error));
          }
        }}
        onAspectRatioChange={(aspectRatio) => {
          try {
            changeVideoAspectRatio(aspectRatio);
          } catch (error) {
            notifyError(resolveVideoPackageActionError(error));
          }
        }}
        onSelectVideoPackage={(packageId) => {
          try {
            selectVideoPackage(packageId);
          } catch (error) {
            notifyError(resolveVideoPackageActionError(error));
          }
        }}
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
          void (async () => {
            const name = value.trim();
            if (!name) return;
            if (!(await ensureCurrentLogoUsesSharedStorage())) {
              return;
            }
            try {
              createVideoPackage(name);
              setCreateDialogOpen(false);
              notifySuccess(`Created "${name}".`);
            } catch (error) {
              notifyError(resolveVideoPackageActionError(error, 'Could not create that video package.'));
            }
          })();
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
          void (async () => {
            const name = value.trim();
            if (!name) return;
            if (!(await ensureCurrentLogoUsesSharedStorage())) {
              return;
            }
            try {
              duplicateActiveVideoPackage(name);
              setDuplicateDialogOpen(false);
              notifySuccess(`Duplicated package as "${name}".`);
            } catch (error) {
              notifyError(resolveVideoPackageActionError(error, 'Could not duplicate that video package.'));
            }
          })();
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
          try {
            renameVideoPackage(renameTarget.id, value.trim());
            setRenameTarget(null);
            notifySuccess(`Renamed package to "${value.trim()}".`);
          } catch (error) {
            notifyError(resolveVideoPackageActionError(error, 'Could not rename that video package.'));
          }
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
          try {
            deleteVideoPackage(deleteTarget.id);
            notifySuccess(`Deleted "${deleteTarget.name}".`);
            setDeleteTarget(null);
          } catch (error) {
            notifyError(resolveVideoPackageActionError(error, 'Could not delete that video package.'));
          }
        }}
      />
    </div>
  );
}
