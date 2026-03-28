import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConfirmDialog } from '../../app/components/ConfirmDialog';
import { TextPromptDialog } from '../../app/components/TextPromptDialog';
import { VideoSettingsPanel } from '../../components/VideoSettingsPanel';
import type { VideoSettings, VideoUserPackage } from '../../types';
import { migrateInlineImageSource } from '../../services/imageAssetStore';
import { downloadJsonFile } from '../../services/jsonTransfer';
import { notifyError, notifyInfo, notifySuccess } from '../../services/notifications';
import {
  createProjectRecord,
  listProjects,
  loadProject,
  saveProject
} from '../../services/projects/projectStore';
import {
  applyVideoPackageTransferBundle,
  createVideoPackageTransferBundle,
  resolveImportedVideoPackageSettings
} from '../../services/videoPackageTransfer';
import { cancelVideoExport, exportVideoWithWebCodecs, getVideoExportPlan } from '../../services/videoExport';
import {
  getCurrentVideoSnapshot,
  getCurrentWorkspaceSnapshot,
  useAppStore
} from '../../store/appStore';
import { beginExportJob, cancelExportJobEntry, completeExportJob, failExportJob, patchExportJob } from '../shared/exportJobs';
import {
  buildVideoBatchRecoverySignature,
  buildVideoSettingsRecoverySignature,
  deleteVideoExportRecoveryManifest,
  findLatestMatchingVideoExportRecovery,
  summarizeVideoExportRecovery,
  type VideoExportRecoveryManifest
} from '../../services/videoExportRecovery';

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

const slugifyPackageFileName = (name: string) =>
  (name
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'video-package');

const buildProjectSnapshotRecord = (
  existingProject: Awaited<ReturnType<typeof loadProject>>,
  {
    activeProjectId,
    activeProjectName,
  settings
}: {
  activeProjectId: string | null;
  activeProjectName: string;
  settings: VideoSettings;
}) => {
  const fallbackProject = existingProject ?? createProjectRecord(activeProjectName, settings, '/video/setup');

  return {
    ...fallbackProject,
    id: activeProjectId ?? existingProject?.id ?? fallbackProject.id,
    name: activeProjectName,
    lastOpenedAt: Date.now(),
    workspace: getCurrentWorkspaceSnapshot(),
    video: getCurrentVideoSnapshot(),
    uiSnapshot: {
      lastRoute: '/video/setup' as const
    }
  };
};

export default function VideoSetupPage() {
  const navigate = useNavigate();
  const importPackageInputRef = useRef<HTMLInputElement | null>(null);
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
  const activeProjectId = useAppStore((state) => state.projects.activeProjectId);
  const activeProjectName = useAppStore((state) => state.projects.activeProjectName);
  const setVideoSettings = useAppStore((state) => state.setVideoSettings);
  const applyVideoPackageLibraryState = useAppStore((state) => state.applyVideoPackageLibraryState);
  const selectVideoPackage = useAppStore((state) => state.selectVideoPackage);
  const createVideoPackage = useAppStore((state) => state.createVideoPackage);
  const duplicateActiveVideoPackage = useAppStore((state) => state.duplicateActiveVideoPackage);
  const renameVideoPackage = useAppStore((state) => state.renameVideoPackage);
  const deleteVideoPackage = useAppStore((state) => state.deleteVideoPackage);
  const changeVideoAspectRatio = useAppStore((state) => state.changeVideoAspectRatio);
  const bumpBackgroundPacksSession = useAppStore((state) => state.bumpBackgroundPacksSession);
  const setActiveProjectMeta = useAppStore((state) => state.setActiveProjectMeta);
  const setRecentProjects = useAppStore((state) => state.setRecentProjects);
  const [resumeRecovery, setResumeRecovery] = useState<VideoExportRecoveryManifest | null>(null);

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
  const exportPlan = useMemo(
    () => getVideoExportPlan(batch.length, videoSettings.exportPuzzlesPerVideo),
    [batch.length, videoSettings.exportPuzzlesPerVideo]
  );
  const batchRecoverySignature = useMemo(() => buildVideoBatchRecoverySignature(batch), [batch]);
  const settingsRecoverySignature = useMemo(
    () => buildVideoSettingsRecoverySignature(videoSettings),
    [videoSettings]
  );

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

  const refreshResumeRecovery = useCallback(() => {
    if (exportPlan.outputCount <= 1 || !activeProjectId) {
      setResumeRecovery(null);
      return;
    }

    setResumeRecovery(
      findLatestMatchingVideoExportRecovery({
        projectId: activeProjectId,
        batchSignature: batchRecoverySignature,
        settingsSignature: settingsRecoverySignature
      })
    );
  }, [activeProjectId, batchRecoverySignature, exportPlan.outputCount, settingsRecoverySignature]);

  useEffect(() => {
    if (isExporting) {
      setResumeRecovery(null);
      return;
    }
    refreshResumeRecovery();
  }, [isExporting, refreshResumeRecovery]);

  const ensureProjectSnapshotSavedForRecovery = async () => {
    try {
      const existingProject = activeProjectId ? await loadProject(activeProjectId) : null;
      const savedProject = await saveProject(
        buildProjectSnapshotRecord(existingProject, {
          activeProjectId,
          activeProjectName,
          settings: videoSettings
        })
      );
      setActiveProjectMeta(savedProject.id, savedProject.name);
      setRecentProjects(await listProjects());
      return savedProject;
    } catch (error) {
      notifyInfo(
        error instanceof Error && error.message.trim()
          ? `Export recovery snapshot skipped: ${error.message}`
          : 'Export recovery snapshot could not be saved.'
      );
      return null;
    }
  };

  const handleExport = async (mode: 'fresh' | 'resume' = 'fresh') => {
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
      label:
        exportPlan.outputCount > 1
          ? `Video export (${batch.length} puzzles, ${exportPlan.outputCount} videos)`
          : `Video export (${batch.length} puzzle${batch.length === 1 ? '' : 's'})`,
      status: 'Preparing export...'
    });

    try {
      setIsExporting(true);
      setExportProgress(0);
      setExportStatus('Preparing export...');
      setResumeRecovery(null);

      const savedProject = await ensureProjectSnapshotSavedForRecovery();
      const recoveryEnabled = exportPlan.outputCount > 1;
      const recoveryProjectId = savedProject?.id ?? activeProjectId ?? null;
      const recoveryProjectName = savedProject?.name ?? activeProjectName;

      const result = await exportVideoWithWebCodecs({
        puzzles: batch,
        settings: videoSettings,
        recoveryMode: recoveryEnabled ? mode : undefined,
        recoveryManifestId: recoveryEnabled && mode === 'resume' ? resumeRecovery?.id ?? null : null,
        recoveryProjectId: recoveryEnabled ? recoveryProjectId : undefined,
        recoveryProjectName: recoveryEnabled ? recoveryProjectName : undefined,
        recoveryBatchSignature: recoveryEnabled ? batchRecoverySignature : undefined,
        recoverySettingsSignature: recoveryEnabled ? settingsRecoverySignature : undefined,
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
      const completionMessage =
        result.outputCount > 1
          ? `Exported ${result.outputCount} videos.`
          : 'Export complete';
      setExportStatus(completionMessage);
      completeExportJob(jobId, completionMessage);
      notifySuccess(
        result.outputCount > 1
          ? result.usedDirectory
            ? `Video export finished. ${result.outputCount} videos saved to the selected folder.`
            : `Video export finished. ${result.outputCount} videos created.`
          : 'Video export finished.'
      );
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
      refreshResumeRecovery();
    }
  };

  const handleRestartExport = async () => {
    if (resumeRecovery?.id) {
      await deleteVideoExportRecoveryManifest(resumeRecovery.id);
      setResumeRecovery(null);
    }
    await handleExport('fresh');
  };

  const handleResumeExport = async () => {
    await handleExport('resume');
  };

  const resumeRecoverySummary = useMemo(() => {
    if (!resumeRecovery) return null;
    const summary = summarizeVideoExportRecovery(resumeRecovery);
    const title =
      resumeRecovery.state === 'failed'
        ? 'Failed split export found'
        : resumeRecovery.state === 'cancelled'
        ? 'Canceled split export found'
        : 'Interrupted split export found';

    return {
      title,
      detail:
        summary.completedOutputs > 0
          ? `${summary.completedOutputs} of ${summary.totalOutputs} videos are already done. Resume the remaining ${summary.remainingOutputs}.`
          : `Resume all ${summary.totalOutputs} videos from the saved split export checkpoint.`,
      remainingOutputs: summary.remainingOutputs,
      completedOutputs: summary.completedOutputs,
      totalOutputs: summary.totalOutputs,
      lastError: resumeRecovery.lastError
    };
  }, [resumeRecovery]);

  const handleStartPreview = () => {
    if (!batch.length) {
      notifyError('Load or create at least one puzzle before starting video preview.');
      return;
    }
    navigate('/video/preview');
  };

  const handleCancelExport = () => {
    if (!isExporting) return;
    setExportStatus('Canceling export...');
    cancelVideoExport();
  };

  const handleExportVideoPackage = async () => {
    if (!activePackage) {
      notifyError('Select a video package before exporting.');
      return;
    }

    try {
      const bundle = await createVideoPackageTransferBundle(activePackage);
      const timestamp = bundle.exportedAt.replace(/[:.]/g, '-');
      downloadJsonFile(
        bundle,
        `${slugifyPackageFileName(activePackage.name)}-${timestamp}.json`
      );
      notifySuccess(`Exported "${activePackage.name}".`);
    } catch (error) {
      notifyError(
        error instanceof Error && error.message.trim()
          ? error.message
          : 'Could not export that video package.'
      );
    }
  };

  const handleImportVideoPackageFile = async (file: File) => {
    try {
      const raw = await file.text();
      const result = await applyVideoPackageTransferBundle(raw, {
        library: useAppStore.getState().video.videoPackageLibrary,
        defaultSettings: useAppStore.getState().video.appDefaults.videoDefaults
      });
      const nextLibrary = {
        packages: [
          ...useAppStore.getState().video.videoPackageLibrary.packages,
          result.videoPackage
        ],
        activePackageId: result.videoPackage.id
      };
      applyVideoPackageLibraryState(
        nextLibrary,
        resolveImportedVideoPackageSettings(
          result.videoPackage,
          useAppStore.getState().video.appDefaults.videoDefaults
        )
      );
      if (result.backgroundPack) {
        bumpBackgroundPacksSession();
      }
      notifySuccess(
        `Imported "${result.videoPackage.name}"${result.backgroundPack ? ' with its background pack.' : '.'}`
      );
    } catch (error) {
      notifyError(
        error instanceof Error && error.message.trim()
          ? error.message
          : 'Could not import that video package.'
      );
    }
  };

  return (
    <div className="h-[100dvh] overflow-hidden">
      <input
        ref={importPackageInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) {
            return;
          }
          void handleImportVideoPackageFile(file);
        }}
      />

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
        onExportVideoPackage={handleExportVideoPackage}
        onImportVideoPackage={() => importPackageInputRef.current?.click()}
        onExport={resumeRecoverySummary ? handleResumeExport : handleExport}
        onRestartExport={resumeRecoverySummary ? handleRestartExport : undefined}
        exportRecovery={resumeRecoverySummary}
        onCancelExport={handleCancelExport}
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
