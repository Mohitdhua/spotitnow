import { Suspense, lazy, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RouteWorkspaceLoading } from '../../app/components/RouteWorkspaceLoading';
import { exportOverlayBatchWithWebCodecs } from '../../services/overlayVideoExport';
import { notifyError, notifyInfo, notifySuccess } from '../../services/notifications';
import { useAppStore } from '../../store/appStore';
import { beginExportJob, cancelExportJobEntry, completeExportJob, failExportJob, patchExportJob } from '../shared/exportJobs';

const OverlayVideoEditor = lazy(async () => {
  const module = await import('../../components/OverlayVideoEditor');
  return { default: module.OverlayVideoEditor };
});

interface OverlayExportPayload {
  editorMode?: 'standard' | 'linked_pairs';
  base: {
    mode: 'video' | 'photo' | 'color';
    color: string;
    aspectRatio: number;
    durationSeconds: number;
    videoFile?: File;
    photoFile?: File;
  };
  batchPhotos: Array<{
    id: string;
    name: string;
    kind: 'image';
    file: File;
    transform: { x: number; y: number; width: number; height: number };
    crop: { x: number; y: number; width: number; height: number };
    background: { enabled: boolean; color: string };
    chromaKey: { enabled: boolean; color: string; similarity: number; smoothness: number };
    timeline: { start: number; end: number };
  }>;
  overlays: Array<{
    id: string;
    name: string;
    kind: 'image' | 'video';
    file: File;
    transform: { x: number; y: number; width: number; height: number };
    crop: { x: number; y: number; width: number; height: number };
    background: { enabled: boolean; color: string };
    chromaKey: { enabled: boolean; color: string; similarity: number; smoothness: number };
    timeline: { start: number; end: number };
  }>;
  soundtrack?: {
    file: File;
    start: number;
    trimStart: number;
    volume: number;
    loop: boolean;
  };
  linkedPairs?: Array<{
    id: string;
    name: string;
    puzzleFile: File;
    diffFile: File;
  }>;
  linkedPairLayout?: {
    x: number;
    y: number;
    size: number;
    gap: number;
  };
  linkedPairStyle?: {
    outlineColor: string;
    outlineWidth: number;
    cornerRadius: number;
  };
  linkedPairExportMode?: 'single_video' | 'one_per_pair';
  linkedPairsPerVideo?: number;
}

export default function VideoOverlayPage() {
  const navigate = useNavigate();
  const [isExporting, setIsExporting] = useState(false);
  const batch = useAppStore((state) => state.workspace.batch);
  const incomingVideoFrames = useAppStore((state) => state.workspace.incomingVideoFrames);
  const incomingVideoFramesSessionId = useAppStore((state) => state.workspace.incomingVideoFramesSessionId);
  const jobs = useAppStore((state) => state.exports.jobs);
  const videoSettings = useAppStore((state) => state.video.videoSettings);
  const setVideoSettings = useAppStore((state) => state.setVideoSettings);
  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate('/');
  };

  const hasRunningExport = jobs.some((job) => job.state === 'running');

  const handleExport = async (payload: OverlayExportPayload) => {
    if (hasRunningExport) {
      notifyError('Another export is already running. Wait for it to finish or cancel it first.');
      return;
    }
    if (isExporting) return;

    const jobId = beginExportJob({
      kind: 'overlay',
      label: 'Overlay batch export',
      status: 'Preparing batch export...'
    });

    try {
      setIsExporting(true);
      await exportOverlayBatchWithWebCodecs({
        editorMode: payload.editorMode,
        base: payload.base,
        batchPhotos: payload.batchPhotos,
        overlays: payload.overlays,
        soundtrack: payload.soundtrack,
        linkedPairs: payload.linkedPairs,
        linkedPairLayout: payload.linkedPairLayout,
        linkedPairStyle: payload.linkedPairStyle,
        linkedPairExportMode: payload.linkedPairExportMode,
        linkedPairsPerVideo: payload.linkedPairsPerVideo,
        settings: {
          videoPackagePreset: videoSettings.videoPackagePreset,
          visualStyle: videoSettings.visualStyle,
          textStyle: videoSettings.textStyle,
          headerStyle: videoSettings.headerStyle,
          timerStyle: videoSettings.timerStyle,
          progressStyle: videoSettings.progressStyle,
          progressMotion: videoSettings.progressMotion,
          generatedProgressEnabled: videoSettings.generatedProgressEnabled,
          generatedProgressStyle: videoSettings.generatedProgressStyle,
          generatedProgressRenderMode: videoSettings.generatedProgressRenderMode,
          showProgress: videoSettings.showProgress,
          introCardStyle: videoSettings.introCardStyle,
          transitionCardStyle: videoSettings.transitionCardStyle,
          outroCardStyle: videoSettings.outroCardStyle,
          transitionStyle: videoSettings.transitionStyle,
          textTemplates: videoSettings.textTemplates,
          exportResolution: videoSettings.exportResolution,
          exportBitrateMbps: videoSettings.exportBitrateMbps,
          exportCodec: videoSettings.exportCodec
        },
        onProgress: (progress, status) => {
          patchExportJob(jobId, {
            state: 'running',
            progress,
            status: status || 'Rendering overlay export...'
          });
        }
      });

      completeExportJob(jobId, 'Batch export complete');
      notifySuccess('Overlay export finished.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Overlay batch export failed.';
      if (message === 'Export canceled') {
        cancelExportJobEntry(jobId, 'Export canceled');
        notifyInfo('Overlay export canceled.');
      } else {
        failExportJob(jobId, message);
        notifyError(message);
      }
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Suspense
      fallback={
        <RouteWorkspaceLoading
          eyebrow="Editor Studio"
          title="Loading overlay editor"
          description="Preparing the timeline, batch clips, and export tools for the editor workspace."
          fullHeight
        />
      }
    >
      <OverlayVideoEditor
        settings={{
          videoPackagePreset: videoSettings.videoPackagePreset,
          visualStyle: videoSettings.visualStyle,
          textStyle: videoSettings.textStyle,
          headerStyle: videoSettings.headerStyle,
          timerStyle: videoSettings.timerStyle,
          progressStyle: videoSettings.progressStyle,
          progressMotion: videoSettings.progressMotion,
          generatedProgressEnabled: videoSettings.generatedProgressEnabled,
          generatedProgressStyle: videoSettings.generatedProgressStyle,
          generatedProgressRenderMode: videoSettings.generatedProgressRenderMode,
          showProgress: videoSettings.showProgress,
          introCardStyle: videoSettings.introCardStyle,
          transitionCardStyle: videoSettings.transitionCardStyle,
          outroCardStyle: videoSettings.outroCardStyle,
          transitionStyle: videoSettings.transitionStyle,
          textTemplates: videoSettings.textTemplates,
          exportResolution: videoSettings.exportResolution,
          exportBitrateMbps: videoSettings.exportBitrateMbps,
          exportCodec: videoSettings.exportCodec
        }}
        puzzles={batch}
        defaultPuzzleClipDurationSeconds={
          Math.max(0.5, videoSettings.showDuration) +
          Math.max(0.5, videoSettings.revealDuration) +
          Math.max(0, videoSettings.transitionDuration)
        }
        incomingVideoFrames={incomingVideoFrames}
        incomingVideoFramesSessionId={incomingVideoFramesSessionId}
        defaultLogo={videoSettings.logo}
        defaultLogoChromaKeyEnabled={videoSettings.logoChromaKeyEnabled}
        defaultLogoChromaKeyColor={videoSettings.logoChromaKeyColor}
        defaultLogoChromaKeyTolerance={videoSettings.logoChromaKeyTolerance}
        onSettingsChange={(patch) =>
          setVideoSettings((current) => ({
            ...current,
            ...patch
          }))
        }
        onExport={handleExport}
        isExporting={isExporting}
        onBack={handleBack}
      />
    </Suspense>
  );
}
