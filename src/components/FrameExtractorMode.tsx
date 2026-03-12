import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Clock3, Download, Layers, LoaderCircle, Sparkles, Trash2, Upload, Video } from 'lucide-react';
import { VIDEO_PACKAGE_PRESETS } from '../constants/videoPackages';
import { buildDefaultCustomVideoLayout } from '../constants/videoLayoutCustom';
import { TimestampPresetPicker } from './TimestampPresetPicker';
import {
  ExtractFramesSummary,
  extractFrames,
  parseTimestampInput,
  readVideoFileMetadata,
  VideoFileMetadata
} from '../services/frameExtractor';
import {
  FrameExtractorDefaults,
  readSplitterSharedRegion,
  SplitterDefaults,
  type SuperImageExportMode
} from '../services/appSettings';
import { type CustomVideoLayout, type VideoSettings } from '../types';
import { runFrameAutoAligner, type FrameAutoAlignerResult } from '../services/frameAutoAligner';
import {
  canUseSuperImageDirectoryExport,
  requestSuperImageOutputDirectory,
  runFrameSuperExport,
  runFrameSuperImageExport,
  type SuperExportResult,
  type SuperImageExportResult
} from '../services/superExport';
import { loadWatermarkPresets } from '../services/watermarkPresets';
import type { WatermarkSelectionPreset } from '../services/watermarkRemoval';
import {
  applyVideoSceneCopyPresetToSettings,
  loadVideoSceneCopyPresets,
  type VideoSceneCopyPreset
} from '../services/videoSceneCopyPresets';
import { loadSavedVideoCustomLayout } from '../services/videoLayoutStorage';

interface FrameExtractorModeProps {
  onBack: () => void;
  defaults: FrameExtractorDefaults;
  splitterDefaults: SplitterDefaults;
  videoSettings: VideoSettings;
  defaultsSessionId: number;
  onSendToBatchAuto: (files: File[]) => void;
  hasActiveAppExport?: boolean;
  onSuperImageExportStateChange?: (state: { isExporting: boolean; progress: number; status: string }) => void;
  onSuperExportStateChange?: (state: { isExporting: boolean; progress: number; status: string }) => void;
}

interface UploadedVideoItem {
  id: string;
  file: File;
  metadata: VideoFileMetadata;
}

const pad = (value: number) => String(value).padStart(2, '0');

const formatDurationShort = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '--';
  const safe = Math.floor(seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(secs)}`;
  }
  return `${minutes}:${pad(secs)}`;
};

const formatFileSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[index]}`;
};

const triggerBlobDownload = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const cloneVideoSettings = (settings: VideoSettings): VideoSettings => ({
  ...settings,
  sceneSettings: {
    ...settings.sceneSettings
  },
  textTemplates: {
    ...settings.textTemplates
  },
  customLayout: settings.customLayout ? { ...settings.customLayout } : undefined
});

const resolveSuperExportVideoSettings = ({
  baseSettings,
  sceneCopyPreset,
  savedCustomLayout
}: {
  baseSettings: VideoSettings;
  sceneCopyPreset?: VideoSceneCopyPreset | null;
  savedCustomLayout?: CustomVideoLayout | null;
}) => {
  let nextSettings = cloneVideoSettings(baseSettings);

  if (sceneCopyPreset) {
    nextSettings = applyVideoSceneCopyPresetToSettings(nextSettings, sceneCopyPreset);
  }

  if (savedCustomLayout) {
    nextSettings = {
      ...nextSettings,
      useCustomLayout: true,
      customLayout: {
        ...buildDefaultCustomVideoLayout(nextSettings.videoPackagePreset, nextSettings.aspectRatio),
        ...savedCustomLayout
      }
    };
  }

  return {
    settings: nextSettings,
    appliedSceneCopyPresetName: sceneCopyPreset?.name ?? null,
    appliedSavedCustomLayout: Boolean(savedCustomLayout)
  };
};

export function FrameExtractorMode({
  onBack,
  defaults,
  splitterDefaults,
  videoSettings,
  defaultsSessionId,
  onSendToBatchAuto,
  hasActiveAppExport = false,
  onSuperImageExportStateChange,
  onSuperExportStateChange
}: FrameExtractorModeProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [videos, setVideos] = useState<UploadedVideoItem[]>([]);
  const [timestampsText, setTimestampsText] = useState(defaults.timestampsText);
  const [imageFormat, setImageFormat] = useState<'jpeg' | 'png'>(defaults.format);
  const [jpegQuality, setJpegQuality] = useState(defaults.jpegQuality);
  const [superExportImagesPerVideo, setSuperExportImagesPerVideo] = useState(defaults.superExportImagesPerVideo);
  const [superImageExportMode, setSuperImageExportMode] = useState<SuperImageExportMode>(defaults.superImageExportMode);
  const [isReadingMetadata, setIsReadingMetadata] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isSuperAligning, setIsSuperAligning] = useState(false);
  const [isSuperImaging, setIsSuperImaging] = useState(false);
  const [isSuperExporting, setIsSuperExporting] = useState(false);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState<ExtractFramesSummary | null>(null);
  const [alignerSummary, setAlignerSummary] = useState<FrameAutoAlignerResult | null>(null);
  const [superImageSummary, setSuperImageSummary] = useState<SuperImageExportResult | null>(null);
  const [superSummary, setSuperSummary] = useState<SuperExportResult | null>(null);
  const [useSuperExportWatermarkRemoval, setUseSuperExportWatermarkRemoval] = useState(
    defaults.superExportWatermarkRemoval
  );
  const [watermarkPresets, setWatermarkPresets] = useState<WatermarkSelectionPreset[]>([]);
  const [selectedWatermarkPresetId, setSelectedWatermarkPresetId] = useState(defaults.superExportWatermarkPresetId);
  const [sceneCopyPresets, setSceneCopyPresets] = useState<VideoSceneCopyPreset[]>([]);
  const [selectedSceneCopyPresetId, setSelectedSceneCopyPresetId] = useState(defaults.sceneCopyPresetId);
  const [useSavedSceneCopyForSuperExport, setUseSavedSceneCopyForSuperExport] = useState(
    defaults.useSceneCopyPresetForSuperExport
  );
  const [useSavedLayoutForSuperExport, setUseSavedLayoutForSuperExport] = useState(
    defaults.useSavedVideoLayoutForSuperExport
  );
  const [savedVideoCustomLayout, setSavedVideoCustomLayout] = useState<CustomVideoLayout | null>(null);

  useEffect(() => {
    setTimestampsText(defaults.timestampsText);
    setImageFormat(defaults.format);
    setJpegQuality(defaults.jpegQuality);
    setSuperExportImagesPerVideo(defaults.superExportImagesPerVideo);
    setSuperImageExportMode(defaults.superImageExportMode);
    setUseSuperExportWatermarkRemoval(defaults.superExportWatermarkRemoval);
    setSelectedWatermarkPresetId(defaults.superExportWatermarkPresetId);
    setSelectedSceneCopyPresetId(defaults.sceneCopyPresetId);
    setUseSavedSceneCopyForSuperExport(defaults.useSceneCopyPresetForSuperExport);
    setUseSavedLayoutForSuperExport(defaults.useSavedVideoLayoutForSuperExport);
  }, [defaults, defaultsSessionId]);

  useEffect(() => {
    const nextPresets = loadWatermarkPresets();
    setWatermarkPresets(nextPresets);
    setSceneCopyPresets(loadVideoSceneCopyPresets());
    setSavedVideoCustomLayout(loadSavedVideoCustomLayout());
  }, [defaultsSessionId]);

  useEffect(() => {
    onSuperImageExportStateChange?.({
      isExporting: isSuperImaging,
      progress: isSuperImaging ? Math.max(0, Math.min(1, progress)) : 0,
      status: isSuperImaging ? status : ''
    });
  }, [isSuperImaging, progress, status, onSuperImageExportStateChange]);

  useEffect(() => {
    onSuperExportStateChange?.({
      isExporting: isSuperExporting,
      progress: isSuperExporting ? Math.max(0, Math.min(1, progress)) : 0,
      status: isSuperExporting ? status : ''
    });
  }, [isSuperExporting, onSuperExportStateChange, progress, status]);

  const parsedTimestamps = useMemo(() => parseTimestampInput(timestampsText), [timestampsText]);
  const requestedFrames = videos.length * parsedTimestamps.timestamps.length;
  const savedSharedRegion = readSplitterSharedRegion();
  const hasSavedSharedRegion = Boolean(savedSharedRegion);
  const isBusy = isReadingMetadata || isExtracting || isSuperAligning || isSuperImaging || isSuperExporting;
  const canExtract =
    !isBusy && videos.length > 0 && parsedTimestamps.timestamps.length > 0;
  const canSuperAlign = canExtract && hasSavedSharedRegion;
  const canSuperImage = canExtract;
  const canSuperExport = canExtract;
  const selectedWatermarkPreset = useMemo(
    () => watermarkPresets.find((preset) => preset.id === selectedWatermarkPresetId) ?? null,
    [watermarkPresets, selectedWatermarkPresetId]
  );
  const selectedSceneCopyPreset = useMemo(
    () => sceneCopyPresets.find((preset) => preset.id === selectedSceneCopyPresetId) ?? null,
    [sceneCopyPresets, selectedSceneCopyPresetId]
  );
  const effectiveSuperExportVideoSetup = useMemo(
    () =>
      resolveSuperExportVideoSettings({
        baseSettings: videoSettings,
        sceneCopyPreset: useSavedSceneCopyForSuperExport ? selectedSceneCopyPreset : null,
        savedCustomLayout: useSavedLayoutForSuperExport ? savedVideoCustomLayout : null
      }),
    [
      videoSettings,
      useSavedSceneCopyForSuperExport,
      selectedSceneCopyPreset,
      useSavedLayoutForSuperExport,
      savedVideoCustomLayout
    ]
  );
  const effectiveSuperExportPackageLabel =
    VIDEO_PACKAGE_PRESETS[effectiveSuperExportVideoSetup.settings.videoPackagePreset]?.label ??
    effectiveSuperExportVideoSetup.settings.videoPackagePreset;
  const supportsDirectoryExport = canUseSuperImageDirectoryExport();
  const superImageExportTargetLabel = superImageExportMode === 'folder' ? 'folder' : 'zip';

  useEffect(() => {
    if (!supportsDirectoryExport && superImageExportMode === 'folder') {
      setSuperImageExportMode('zip');
    }
  }, [superImageExportMode, supportsDirectoryExport]);

  const refreshSavedSuperExportVideoSetup = () => {
    const nextSceneCopyPresets = loadVideoSceneCopyPresets();
    const nextSavedVideoCustomLayout = loadSavedVideoCustomLayout();
    setSceneCopyPresets(nextSceneCopyPresets);
    setSavedVideoCustomLayout(nextSavedVideoCustomLayout);
    if (
      selectedSceneCopyPresetId &&
      !nextSceneCopyPresets.some((preset) => preset.id === selectedSceneCopyPresetId)
    ) {
      setSelectedSceneCopyPresetId('');
    }
    return {
      nextSceneCopyPresets,
      nextSavedVideoCustomLayout
    };
  };

  const handleAddVideos = async (files: FileList | null) => {
    const selected = files ? Array.from(files).filter((file) => file.type.startsWith('video/')) : [];
    if (!selected.length) return;

    setSummary(null);
    setAlignerSummary(null);
    setSuperImageSummary(null);
    setSuperSummary(null);
    setIsReadingMetadata(true);
    let failed = 0;
    const loaded: UploadedVideoItem[] = [];

    for (let index = 0; index < selected.length; index += 1) {
      const file = selected[index];
      setStatus(`Reading metadata ${index + 1}/${selected.length}: ${file.name}`);
      try {
        const metadata = await readVideoFileMetadata(file);
        loaded.push({
          id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
          file,
          metadata
        });
      } catch (error) {
        failed += 1;
        console.error(`Failed metadata read for "${file.name}"`, error);
      }
    }

    setVideos((current) => [...current, ...loaded]);
    setIsReadingMetadata(false);
    setStatus('');

    if (failed > 0) {
      alert(`Added ${loaded.length} video(s). Failed to load ${failed} file(s).`);
    }
  };

  const handleRemoveVideo = (id: string) => {
    setVideos((current) => current.filter((item) => item.id !== id));
    setSummary(null);
    setAlignerSummary(null);
    setSuperImageSummary(null);
    setSuperSummary(null);
  };

  const handleClearVideos = () => {
    setVideos([]);
    setSummary(null);
    setAlignerSummary(null);
    setSuperImageSummary(null);
    setSuperSummary(null);
  };

  const handleExtractFrames = async () => {
    if (!canExtract) return;

    setSummary(null);
    setAlignerSummary(null);
    setSuperImageSummary(null);
    setSuperSummary(null);
    setIsExtracting(true);
    setProgress(0);
    setStatus('Preparing extraction...');

    try {
      const result = await extractFrames({
        videos: videos.map((item) => item.file),
        timestamps: parsedTimestamps.timestamps,
        format: imageFormat,
        jpegQuality,
        onProgress: (next) => {
          const ratio = next.total > 0 ? next.completed / next.total : 0;
          setProgress(Math.max(0, Math.min(1, ratio)));
          setStatus(next.label);
        }
      });

      for (let index = 0; index < result.files.length; index += 1) {
        const item = result.files[index];
        setStatus(`Downloading ${index + 1}/${result.files.length}: ${item.filename}`);
        triggerBlobDownload(item.blob, item.filename);
        await delay(80);
      }

      setSummary(result.summary);
      setProgress(1);
      setStatus(`Downloaded ${result.files.length} image${result.files.length === 1 ? '' : 's'}.`);
    } catch (error) {
      setStatus('');
      const message = error instanceof Error ? error.message : 'Frame extraction failed.';
      alert(message);
    } finally {
      setIsExtracting(false);
    }
  };

  const handleSuperAligner = async () => {
    if (!canSuperAlign) return;

    const sharedRegion = readSplitterSharedRegion();
    if (!sharedRegion) {
      alert('Set a shared split area in Splitter mode first. The aligner uses that saved area.');
      return;
    }

    setSummary(null);
    setAlignerSummary(null);
    setSuperImageSummary(null);
    setSuperSummary(null);
    setIsSuperAligning(true);
    setProgress(0);
    setStatus('Preparing Super Image Aligner...');

    try {
      const result = await runFrameAutoAligner({
        videos: videos.map((item) => item.file),
        timestamps: parsedTimestamps.timestamps,
        format: imageFormat,
        jpegQuality,
        splitterDefaults,
        sharedRegion,
        onProgress: (next) => {
          setProgress(Math.max(0, Math.min(1, next.progress)));
          setStatus(next.label);
        }
      });

      const preparedFiles = result.files;
      setAlignerSummary({
        ...result,
        files: []
      });
      setProgress(1);

      if (!preparedFiles.length) {
        setStatus('Super Image Aligner finished, but no split pairs could be prepared.');
        return;
      }

      setStatus(
        `Prepared ${result.preparedPairCount} split pair${result.preparedPairCount === 1 ? '' : 's'} and sending them to batch auto mode...`
      );
      onSendToBatchAuto(preparedFiles);
    } catch (error) {
      setStatus('');
      const message = error instanceof Error ? error.message : 'Super Image Aligner failed.';
      alert(message);
    } finally {
      setIsSuperAligning(false);
    }
  };

  const handleSuperImageExport = async () => {
    if (!canSuperImage) return;
    if (hasActiveAppExport && !isSuperImaging) {
      alert('Another export is already running. Please wait or cancel it first.');
      return;
    }

    let targetDirectory: FileSystemDirectoryHandle | null = null;
    if (superImageExportMode === 'folder' && canUseSuperImageDirectoryExport()) {
      try {
        targetDirectory = await requestSuperImageOutputDirectory(splitterDefaults);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to select a folder for Super Image export.';
        alert(message);
        return;
      }
    }

    const latestPresets = loadWatermarkPresets();
    setWatermarkPresets(latestPresets);
    const currentPreset =
      latestPresets.find((preset) => preset.id === selectedWatermarkPresetId) ?? selectedWatermarkPreset;

    if (useSuperExportWatermarkRemoval) {
      const methodLabel = currentPreset
        ? `the saved preset "${currentPreset.name}"`
        : 'automatic watermark detection';
      const confirmed = window.confirm(
        `Super Image Export will remove watermarks using ${methodLabel} before building the ${superImageExportTargetLabel}. Puzzle Image (A) maps to files like puzzle1.png and Diff Image (B) maps to files like puzzle1diff.png. This adds extra processing time. Continue?`
      );
      if (!confirmed) {
        return;
      }
    }

    setSummary(null);
    setAlignerSummary(null);
    setSuperImageSummary(null);
    setSuperSummary(null);
    setIsSuperImaging(true);
    setProgress(0);
    setStatus('Preparing Super Image...');

    try {
      const result = await runFrameSuperImageExport({
        videos: videos.map((item) => item.file),
        timestamps: parsedTimestamps.timestamps,
        format: imageFormat,
        jpegQuality,
        splitterDefaults,
        outputMode: superImageExportMode,
        targetDirectory,
        sharedRegion: readSplitterSharedRegion(),
        watermarkRemoval: {
          enabled: useSuperExportWatermarkRemoval,
          selectionPreset: useSuperExportWatermarkRemoval ? currentPreset : null
        },
        onProgress: (next) => {
          setProgress(Math.max(0, Math.min(1, next.progress)));
          setStatus(next.label);
        }
      });

      setSuperImageSummary(result);
      setProgress(1);
      if (result.exportedImagePairCount > 0) {
        const outputVerb = result.outputMode === 'folder' ? 'Saved' : 'Downloaded';
        const outputTarget =
          result.outputMode === 'folder'
            ? `into folder "${result.outputName}"`
            : `as zip "${result.outputName}"`;
        setStatus(
          `${outputVerb} ${result.exportedImagePairCount} exact 3-difference image pair${
            result.exportedImagePairCount === 1 ? '' : 's'
          } ${outputTarget}.`
        );
      } else {
        setStatus('Super Image finished, but no exact 3-difference puzzles were available to export.');
      }
    } catch (error) {
      setStatus('');
      const message = error instanceof Error ? error.message : 'Super Image export failed.';
      alert(message);
    } finally {
      setIsSuperImaging(false);
    }
  };

  const handleSuperExport = async () => {
    if (!canSuperExport) return;

    const latestPresets = loadWatermarkPresets();
    setWatermarkPresets(latestPresets);
    const currentPreset =
      latestPresets.find((preset) => preset.id === selectedWatermarkPresetId) ?? selectedWatermarkPreset;

    if (useSuperExportWatermarkRemoval) {
      const methodLabel = currentPreset
        ? `the saved preset "${currentPreset.name}"`
        : 'automatic watermark detection';
      const confirmed = window.confirm(
        `Super Export Videos will remove watermarks using ${methodLabel} before rendering the videos. Puzzle Image (A) maps to files like puzzle1.png and Diff Image (B) maps to files like puzzle1diff.png. This adds extra processing time. Continue?`
      );
      if (!confirmed) {
        return;
      }
    }

    setSummary(null);
    setAlignerSummary(null);
    setSuperImageSummary(null);
    setSuperSummary(null);
    setIsSuperExporting(true);
    setProgress(0);
    setStatus('Preparing Super Export...');

    try {
      const result = await runFrameSuperExport({
        videos: videos.map((item) => item.file),
        timestamps: parsedTimestamps.timestamps,
        format: imageFormat,
        jpegQuality,
        splitterDefaults,
        videoSettings: effectiveSuperExportVideoSetup.settings,
        imagesPerVideo: superExportImagesPerVideo,
        sharedRegion: readSplitterSharedRegion(),
        watermarkRemoval: {
          enabled: useSuperExportWatermarkRemoval,
          selectionPreset: useSuperExportWatermarkRemoval ? currentPreset : null
        },
        onProgress: (next) => {
          setProgress(Math.max(0, Math.min(1, next.progress)));
          setStatus(next.label);
        }
      });

      setSuperSummary(result);
      setProgress(1);
      if (result.exportedVideoCount > 0) {
        setStatus(
          `Exported ${result.exportedVideoCount} video${result.exportedVideoCount === 1 ? '' : 's'} from ${
            result.validPuzzleCount
          } puzzle${result.validPuzzleCount === 1 ? '' : 's'}.`
        );
      } else {
        setStatus('Super Export finished, but no exact 3-difference puzzles were available to export.');
      }
    } catch (error) {
      setStatus('');
      const message = error instanceof Error ? error.message : 'Super Export failed.';
      alert(message);
    } finally {
      setIsSuperExporting(false);
    }
  };

  const totalVideoDurationSeconds = useMemo(
    () =>
      videos.reduce(
        (total, item) => total + (Number.isFinite(item.metadata.durationSeconds) ? item.metadata.durationSeconds : 0),
        0
      ),
    [videos]
  );
  const totalVideoBytes = useMemo(
    () => videos.reduce((total, item) => total + (Number.isFinite(item.file.size) ? item.file.size : 0), 0),
    [videos]
  );
  const progressPercent = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  const recentRunCount =
    Number(Boolean(summary)) +
    Number(Boolean(alignerSummary)) +
    Number(Boolean(superImageSummary)) +
    Number(Boolean(superSummary));
  const activeStatusLabel =
    status ||
    (isBusy
      ? 'Working...'
      : canExtract
        ? 'Ready to extract frames or run the super workflows.'
        : 'Add at least one video and one valid timestamp to unlock the actions.');
  const effectiveOutputModeLabel =
    superImageExportMode === 'folder' && supportsDirectoryExport ? 'Folder Picker' : 'Zip Download';

  return (
    <div className="w-full max-w-7xl mx-auto p-3 sm:p-4 md:p-6">
      <div className="overflow-hidden rounded-[28px] border-4 border-black bg-[#FFFDF8] shadow-[10px_10px_0px_0px_rgba(0,0,0,1)]">
        <div className="border-b-4 border-black bg-[linear-gradient(135deg,#FED7AA_0%,#FDE68A_48%,#BFDBFE_100%)] p-4 sm:p-6 md:p-7">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-start gap-3 sm:gap-4">
              <button
                onClick={onBack}
                className="shrink-0 rounded-xl border-2 border-black bg-white p-2.5 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] transition-all hover:-translate-y-0.5 hover:bg-black hover:text-white"
              >
                <ArrowLeft size={22} strokeWidth={3} />
              </button>
              <div>
                <h2 className="text-2xl sm:text-3xl lg:text-4xl font-black font-display uppercase tracking-tight text-black">
                  Frame Extractor
                </h2>
                <p className="mt-2 max-w-2xl text-sm sm:text-[15px] font-bold text-slate-700">
                  Apply one timestamp plan across every loaded clip, then run the export path you need.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <div className="rounded-full border-2 border-black bg-white px-3 py-1.5 text-[11px] font-black uppercase shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                {isBusy ? 'Processing' : canExtract ? 'Ready To Run' : 'Setup Needed'}
              </div>
              <div className="rounded-full border-2 border-black bg-black px-3 py-1.5 text-[11px] font-black uppercase text-white shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                {videos.length} Video{videos.length === 1 ? '' : 's'} Loaded
              </div>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
            <div className="rounded-2xl border-2 border-black bg-white/90 p-3 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Videos</div>
              <div className="mt-2 text-2xl font-black text-slate-900">{videos.length}</div>
              <div className="mt-1 text-[11px] font-bold text-slate-700">
                {videos.length ? formatDurationShort(totalVideoDurationSeconds) : 'No queue yet'}
              </div>
              <div className="mt-1 text-[11px] font-bold text-slate-600">{formatFileSize(totalVideoBytes)}</div>
            </div>

            <div className="rounded-2xl border-2 border-black bg-white/90 p-3 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Timestamps</div>
              <div className="mt-2 text-2xl font-black text-slate-900">{parsedTimestamps.timestamps.length}</div>
              <div className="mt-1 text-[11px] font-bold text-slate-700">
                {parsedTimestamps.invalidTokens.length > 0
                  ? `${parsedTimestamps.invalidTokens.length} invalid`
                  : 'All valid'}
              </div>
            </div>

            <div className="rounded-2xl border-2 border-black bg-white/90 p-3 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Requests</div>
              <div className="mt-2 text-2xl font-black text-slate-900">{requestedFrames}</div>
              <div className="mt-1 text-[11px] font-bold text-slate-700">
                {videos.length} video(s) x {parsedTimestamps.timestamps.length} timestamp(s)
              </div>
              <div className="mt-1 text-[11px] font-bold text-slate-600">{imageFormat === 'png' ? 'PNG' : 'JPEG'}</div>
            </div>

            <div className="rounded-2xl border-2 border-black bg-white/90 p-3 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Package</div>
              <div className="mt-2 text-sm font-black uppercase text-slate-900">{effectiveSuperExportPackageLabel}</div>
              <div className="mt-2 text-[11px] font-bold text-slate-700">
                Split area {hasSavedSharedRegion ? 'saved' : 'missing'}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-6 bg-[radial-gradient(circle_at_top_right,#DBEAFE_0%,#FFFDF8_34%,#FFF7ED_100%)] p-4 sm:p-6 md:p-8">
          <div className="rounded-[24px] border-4 border-black bg-[#111827] p-4 sm:p-5 text-white shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-lg sm:text-xl font-black">
                  {isBusy && <LoaderCircle size={18} className="animate-spin" />}
                  <Clock3 size={18} />
                  <span className="truncate">{activeStatusLabel}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <div className="rounded-full border-2 border-white/80 bg-white/10 px-3 py-1.5 text-[11px] font-black uppercase">
                  Progress {progressPercent}%
                </div>
                <div className="rounded-full border-2 border-white/80 bg-white/10 px-3 py-1.5 text-[11px] font-black uppercase">
                  Reports {recentRunCount}
                </div>
              </div>
            </div>

            <div className="mt-4 h-4 overflow-hidden rounded-full border-2 border-white/80 bg-white/15">
              <div
                className="h-full bg-[linear-gradient(90deg,#FDE68A_0%,#86EFAC_38%,#60A5FA_72%,#C084FC_100%)] transition-all"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
            <div className="min-w-0 space-y-5 xl:col-span-7">
              <div className="rounded-[24px] border-4 border-black bg-[#FFF7ED] p-4 sm:p-6 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <h3 className="text-xl sm:text-2xl font-black uppercase text-slate-900">Source Clips</h3>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-2 rounded-xl border-2 border-black bg-white px-4 py-2 text-xs font-black uppercase shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] transition-all hover:-translate-y-0.5 hover:bg-black hover:text-white"
                    >
                      <Upload size={14} strokeWidth={3} />
                      <span>Add Videos</span>
                    </button>
                    <button
                      onClick={handleClearVideos}
                      disabled={!videos.length}
                      className={`rounded-xl border-2 border-black px-4 py-2 text-xs font-black uppercase transition-all ${
                        videos.length
                          ? 'bg-white shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 hover:bg-red-50'
                          : 'bg-slate-200 text-slate-500 cursor-not-allowed'
                      }`}
                    >
                      Clear Queue
                    </button>
                  </div>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    handleAddVideos(event.target.files);
                    event.target.value = '';
                  }}
                />

                <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border-2 border-black bg-white p-4">
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Runtime</div>
                    <div className="mt-2 text-lg font-black text-slate-900">
                      {videos.length ? formatDurationShort(totalVideoDurationSeconds) : '--'}
                    </div>
                  </div>
                  <div className="rounded-2xl border-2 border-black bg-white p-4">
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Size</div>
                    <div className="mt-2 text-lg font-black text-slate-900">{formatFileSize(totalVideoBytes)}</div>
                  </div>
                  <div className="rounded-2xl border-2 border-black bg-white p-4">
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Plan</div>
                    <div className="mt-2 text-lg font-black text-slate-900">
                      {parsedTimestamps.timestamps.length} timestamp{parsedTimestamps.timestamps.length === 1 ? '' : 's'}
                    </div>
                  </div>
                </div>

                <div className="mt-5 max-h-[560px] space-y-3 overflow-auto pr-1">
                  {videos.length === 0 ? (
                    <div className="rounded-[24px] border-2 border-dashed border-black bg-white px-6 py-10 text-center">
                      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-black bg-[#FEF3C7]">
                        <Video size={28} strokeWidth={2.8} />
                      </div>
                      <div className="mt-4 text-lg font-black uppercase text-slate-900">No videos loaded</div>
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="mt-5 inline-flex items-center gap-2 rounded-xl border-2 border-black bg-black px-4 py-2 text-xs font-black uppercase text-white shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] transition-all hover:-translate-y-0.5 hover:bg-slate-900"
                      >
                        <Upload size={14} strokeWidth={3} />
                        <span>Choose Videos</span>
                      </button>
                    </div>
                  ) : (
                    videos.map((item, index) => (
                      <div
                        key={item.id}
                        className="rounded-[22px] border-2 border-black bg-white p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-all hover:-translate-y-0.5"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-base font-black text-slate-900">{item.file.name}</div>
                            <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-wide">
                              <div className="rounded-full border-2 border-black bg-[#FED7AA] px-2.5 py-1">
                                Clip {index + 1}
                              </div>
                              <div className="rounded-full border border-black bg-[#FFF7ED] px-2.5 py-1">
                                {formatDurationShort(item.metadata.durationSeconds)}
                              </div>
                              <div className="rounded-full border border-black bg-[#EEF9FF] px-2.5 py-1">
                                {formatFileSize(item.file.size)}
                              </div>
                              <div className="rounded-full border border-black bg-[#F3E8FF] px-2.5 py-1">
                                {item.metadata.width}x{item.metadata.height}
                              </div>
                              <div className="rounded-full border border-black bg-[#ECFCCB] px-2.5 py-1">
                                {parsedTimestamps.timestamps.length} timestamp
                                {parsedTimestamps.timestamps.length === 1 ? '' : 's'}
                              </div>
                            </div>
                          </div>
                          <button
                            onClick={() => handleRemoveVideo(item.id)}
                            className="rounded-xl border-2 border-black bg-white p-2 transition-all hover:bg-red-50"
                            title="Remove video"
                          >
                            <Trash2 size={15} strokeWidth={2.5} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="min-w-0 space-y-5 xl:col-span-5">
              <div className="rounded-[24px] border-4 border-black bg-[#EEF9FF] p-4 sm:p-6 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <h3 className="text-xl sm:text-2xl font-black uppercase text-slate-900">Shared Timestamps</h3>
                  <div className="flex flex-wrap gap-2">
                    <div className="rounded-full border-2 border-black bg-white px-3 py-1.5 text-[11px] font-black uppercase">
                      {parsedTimestamps.timestamps.length} Valid
                    </div>
                    {parsedTimestamps.invalidTokens.length > 0 && (
                      <div className="rounded-full border-2 border-black bg-[#FECACA] px-3 py-1.5 text-[11px] font-black uppercase">
                        {parsedTimestamps.invalidTokens.length} Invalid
                      </div>
                    )}
                  </div>
                </div>
                <textarea
                  value={timestampsText}
                  onChange={(event) => setTimestampsText(event.target.value)}
                  rows={8}
                  className="min-h-[220px] w-full resize-y rounded-[22px] border-2 border-black bg-white p-4 font-mono text-sm shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]"
                  placeholder="00:05.000, 00:10.500, 90"
                />
                <div className="rounded-2xl border-2 border-black bg-white px-4 py-3 text-[11px] font-bold text-slate-700">
                  Seconds or `MM:SS` / `HH:MM:SS.mmm`. Commas and line breaks both work.
                </div>
                {parsedTimestamps.invalidTokens.length > 0 && (
                  <div className="rounded-2xl border-2 border-black bg-[#FECACA] px-4 py-3 text-[11px] font-bold text-slate-800">
                    Invalid: {parsedTimestamps.invalidTokens.slice(0, 12).join(', ')}
                    {parsedTimestamps.invalidTokens.length > 12 ? ' ...' : ''}
                  </div>
                )}
                <TimestampPresetPicker
                  value={timestampsText}
                  onChange={setTimestampsText}
                  disabled={isBusy}
                  storageRefreshKey={defaultsSessionId}
                />
              </div>
            </div>

            <div className="min-w-0 xl:col-span-12">
              <div className="rounded-[24px] border-4 border-black bg-[#F8FDFF] p-4 sm:p-6 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] space-y-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <h3 className="text-xl sm:text-2xl font-black uppercase text-slate-900">Output + Routing</h3>
                  <div className="flex flex-wrap gap-2">
                    <div className="rounded-full border-2 border-black bg-white px-3 py-1.5 text-[11px] font-black uppercase">
                      Package {effectiveSuperExportPackageLabel}
                    </div>
                    <div className="rounded-full border-2 border-black bg-[#DBEAFE] px-3 py-1.5 text-[11px] font-black uppercase">
                      {effectiveOutputModeLabel}
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border-2 border-black bg-white p-4 space-y-4">
                  <div className="text-sm font-black uppercase text-slate-900">Image Format</div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {(['png', 'jpeg'] as const).map((value) => (
                      <button
                        key={value}
                        onClick={() => setImageFormat(value)}
                        className={`rounded-xl border-2 border-black px-3 py-3 text-xs font-black uppercase transition-all ${
                          imageFormat === value
                            ? 'bg-[#FDE68A] text-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]'
                            : 'bg-white hover:bg-slate-100'
                        }`}
                      >
                        {value === 'png' ? 'PNG Lossless' : 'JPEG Compressed'}
                      </button>
                    ))}
                  </div>
                </div>

              {imageFormat === 'jpeg' && (
                <div className="rounded-2xl border-2 border-black bg-white p-4">
                  <div className="flex items-center justify-between text-xs font-black uppercase mb-2">
                    <span>JPEG Quality</span>
                    <span>{Math.round(jpegQuality * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0.5}
                    max={1}
                    step={0.01}
                    value={jpegQuality}
                    onChange={(event) => setJpegQuality(Number(event.target.value))}
                    className="w-full h-3 border-2 border-black rounded-full accent-black"
                  />
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border-2 border-black bg-white p-4 text-xs font-bold text-slate-700 break-words">
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Workload</div>
                  <div className="mt-2 text-lg font-black text-slate-900">{requestedFrames}</div>
                  <div className="mt-1 text-[11px] font-bold text-slate-600">
                    {videos.length} x {parsedTimestamps.timestamps.length}
                  </div>
                </div>
                <div className="rounded-2xl border-2 border-black bg-white p-4 text-xs font-bold text-slate-700">
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Split Area</div>
                  <div className="mt-2 text-lg font-black text-slate-900">{hasSavedSharedRegion ? 'Saved' : 'Missing'}</div>
                </div>
                <div className="rounded-2xl border-2 border-black bg-white p-4 text-xs font-bold text-slate-700">
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Watermark</div>
                  <div className="mt-2 text-lg font-black text-slate-900">
                    {useSuperExportWatermarkRemoval ? 'On' : 'Off'}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border-2 border-black bg-white p-4 space-y-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm font-black uppercase text-slate-900">Super Image Target</div>
                  {!supportsDirectoryExport && (
                    <div className="text-[11px] font-bold text-slate-600">Zip only in this browser</div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setSuperImageExportMode('zip')}
                    className={`rounded-xl border-2 border-black px-3 py-3 text-xs font-black uppercase transition-all ${
                      superImageExportMode === 'zip'
                        ? 'bg-[#DBEAFE] shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]'
                        : 'bg-white hover:bg-slate-100'
                    }`}
                  >
                    Zip Download
                  </button>
                  <button
                    onClick={() => setSuperImageExportMode('folder')}
                    disabled={!supportsDirectoryExport}
                    className={`rounded-xl border-2 border-black px-3 py-3 text-xs font-black uppercase transition-all ${
                      superImageExportMode === 'folder' && supportsDirectoryExport
                        ? 'bg-[#C7F9CC] shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]'
                        : 'bg-white hover:bg-slate-100'
                    } ${!supportsDirectoryExport ? 'bg-slate-200 text-slate-500 cursor-not-allowed' : ''}`}
                  >
                    Folder Picker
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border-2 border-black bg-white p-4 space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm font-black uppercase text-slate-900">Super Export Video Setup</div>
                  <button
                    onClick={() => refreshSavedSuperExportVideoSetup()}
                    className="rounded-xl border-2 border-black bg-white px-3 py-2 text-[11px] font-black uppercase transition-all hover:bg-slate-100"
                  >
                    Refresh
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <button
                    onClick={() => setUseSavedSceneCopyForSuperExport((current) => !current)}
                    disabled={isBusy}
                    className={`rounded-2xl border-2 border-black px-4 py-3 text-left transition-all ${
                      useSavedSceneCopyForSuperExport
                        ? 'bg-[#DBEAFE] shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]'
                        : 'bg-white hover:bg-slate-100'
                    } ${isBusy ? 'bg-slate-200 text-slate-500 cursor-not-allowed shadow-none' : ''}`}
                  >
                    <div className="text-sm font-black uppercase text-slate-900">Scene Copy</div>
                    <div className="mt-1 text-[11px] font-bold text-slate-600">
                      {useSavedSceneCopyForSuperExport ? selectedSceneCopyPreset?.name ?? 'Enabled' : 'Off'}
                    </div>
                  </button>
                  <button
                    onClick={() => setUseSavedLayoutForSuperExport((current) => !current)}
                    disabled={isBusy}
                    className={`rounded-2xl border-2 border-black px-4 py-3 text-left transition-all ${
                      useSavedLayoutForSuperExport
                        ? 'bg-[#FEF3C7] shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]'
                        : 'bg-white hover:bg-slate-100'
                    } ${isBusy ? 'bg-slate-200 text-slate-500 cursor-not-allowed shadow-none' : ''}`}
                  >
                    <div className="text-sm font-black uppercase text-slate-900">Saved Layout</div>
                    <div className="mt-1 text-[11px] font-bold text-slate-600">
                      {useSavedLayoutForSuperExport
                        ? savedVideoCustomLayout
                          ? 'Enabled'
                          : 'No layout saved'
                        : 'Off'}
                    </div>
                  </button>
                </div>
                <label className="block">
                  <div className="mb-1 text-[11px] font-black uppercase text-slate-600">Scene Copy Preset</div>
                  <select
                    value={selectedSceneCopyPresetId}
                    onChange={(event) => setSelectedSceneCopyPresetId(event.target.value)}
                    disabled={isBusy || !useSavedSceneCopyForSuperExport}
                    className="w-full rounded-xl border-2 border-black bg-white px-3 py-2 text-sm font-bold disabled:bg-slate-200 disabled:text-slate-500 disabled:cursor-not-allowed"
                  >
                    <option value="">None</option>
                    {sceneCopyPresets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="rounded-xl border border-black bg-[#FFF7ED] px-3 py-2 text-[11px] font-bold text-slate-700">
                  Package {effectiveSuperExportPackageLabel}
                  {effectiveSuperExportVideoSetup.appliedSceneCopyPresetName
                    ? ` | ${effectiveSuperExportVideoSetup.appliedSceneCopyPresetName}`
                    : ' | Scene copy off'}
                  {effectiveSuperExportVideoSetup.appliedSavedCustomLayout ? ' | Saved layout on' : ' | Package layout'}
                </div>
              </div>

              <div className="rounded-2xl border-2 border-black bg-white p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-black uppercase text-slate-900">Watermark Removal</div>
                  <button
                    onClick={() => setUseSuperExportWatermarkRemoval((current) => !current)}
                    disabled={isBusy}
                    className={`px-3 py-2 rounded-lg border-2 border-black text-[11px] font-black uppercase ${
                      useSuperExportWatermarkRemoval ? 'bg-[#A7F3D0]' : 'bg-white hover:bg-slate-100'
                    } ${isBusy ? 'cursor-not-allowed bg-slate-200 text-slate-500' : ''}`}
                  >
                    {useSuperExportWatermarkRemoval ? 'On' : 'Off'}
                  </button>
                </div>

                {useSuperExportWatermarkRemoval && (
                  <div className="space-y-2">
                    <label className="block">
                      <div className="mb-1 text-[11px] font-black uppercase text-slate-600">Preset</div>
                      <select
                        value={selectedWatermarkPresetId}
                        onChange={(event) => setSelectedWatermarkPresetId(event.target.value)}
                        disabled={isBusy}
                        className="w-full border-2 border-black rounded-lg bg-white px-3 py-2 text-sm font-bold"
                      >
                        <option value="">Auto Detect</option>
                        {watermarkPresets.map((preset) => (
                          <option key={preset.id} value={preset.id}>
                            {preset.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="text-[11px] font-bold text-slate-600">
                      {selectedWatermarkPreset ? selectedWatermarkPreset.name : 'Auto detect'}
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-2xl border-2 border-black bg-white p-4">
                <div className="flex items-center justify-between text-xs font-black uppercase mb-2">
                  <span>Images Per Super Export Video</span>
                  <span>{superExportImagesPerVideo}</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={20}
                  step={1}
                  value={superExportImagesPerVideo}
                  onChange={(event) => setSuperExportImagesPerVideo(Number(event.target.value))}
                  className="w-full h-3 border-2 border-black rounded-full accent-black"
                />
              </div>

              <div className="rounded-2xl border-2 border-black bg-white p-4 space-y-4">
                <div className="text-sm font-black uppercase text-slate-900">Run</div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <button
                    onClick={handleExtractFrames}
                    disabled={!canExtract}
                    className={`rounded-[20px] border-4 border-black p-4 text-left transition-all ${
                      canExtract
                        ? 'bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-1 hover:bg-[#ECFCCB]'
                        : 'cursor-not-allowed bg-slate-200 text-slate-500'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Download size={18} strokeWidth={3} />
                      <div className="text-sm font-black uppercase">Extract Frames</div>
                    </div>
                    <div className="mt-2 text-[11px] font-bold text-slate-600">Download every requested image.</div>
                  </button>

                  <button
                    onClick={handleSuperAligner}
                    disabled={!canSuperAlign}
                    className={`rounded-[20px] border-4 border-black p-4 text-left transition-all ${
                      canSuperAlign
                        ? 'bg-[#DCFCE7] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-1 hover:bg-[#BBF7D0]'
                        : 'cursor-not-allowed bg-slate-200 text-slate-500'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Layers size={18} strokeWidth={3} />
                      <div className="text-sm font-black uppercase">Super Image Aligner</div>
                    </div>
                    <div className="mt-2 text-[11px] font-bold text-slate-600">Build split pairs for batch auto.</div>
                  </button>

                  <button
                    onClick={handleSuperImageExport}
                    disabled={!canSuperImage}
                    className={`rounded-[20px] border-4 border-black p-4 text-left transition-all ${
                      canSuperImage
                        ? 'bg-[#DBEAFE] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-1 hover:bg-[#BFDBFE]'
                        : 'cursor-not-allowed bg-slate-200 text-slate-500'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Layers size={18} strokeWidth={3} />
                      <div className="text-sm font-black uppercase">Super Image Export</div>
                    </div>
                    <div className="mt-2 text-[11px] font-bold text-slate-600">
                      Export exact 3-difference pairs as {effectiveOutputModeLabel.toLowerCase()}.
                    </div>
                  </button>

                  <button
                    onClick={handleSuperExport}
                    disabled={!canSuperExport}
                    className={`rounded-[20px] border-4 border-black p-4 text-left transition-all ${
                      canSuperExport
                        ? 'bg-[#FEF3C7] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-1 hover:bg-[#FDE68A]'
                        : 'cursor-not-allowed bg-slate-200 text-slate-500'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Sparkles size={18} strokeWidth={3} />
                      <div className="text-sm font-black uppercase">Super Export Videos</div>
                    </div>
                    <div className="mt-2 text-[11px] font-bold text-slate-600">Render packaged puzzle videos.</div>
                  </button>
                </div>

                {!hasSavedSharedRegion && (
                  <div className="rounded-2xl border-2 border-black bg-[#FDE68A] px-4 py-3 text-[11px] font-bold text-slate-800">
                    Save a shared split area in Splitter mode to unlock Super Image Aligner.
                  </div>
                )}
              </div>
            </div>

            {recentRunCount > 0 && (
              <div className="space-y-3 xl:col-span-12">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-lg font-black uppercase text-slate-900">Recent Runs</div>
                  <div className="rounded-full border-2 border-black bg-white px-3 py-1.5 text-[11px] font-black uppercase">
                    {recentRunCount} Report{recentRunCount === 1 ? '' : 's'}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {summary && (
                    <div className="space-y-2 rounded-xl border-4 border-black bg-[#ECFCCB] p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                      <div className="text-sm font-black uppercase">Extraction</div>
                      <div className="text-xs font-bold text-slate-700">
                        {summary.extractedCount} extracted | {summary.skippedCount} skipped | {summary.failedCount} failed
                      </div>
                      {summary.warnings.length > 0 && (
                        <div className="text-[11px] font-bold text-slate-700">
                          {summary.warnings.slice(0, 4).join(' ')}
                          {summary.warnings.length > 4 ? ' ...' : ''}
                        </div>
                      )}
                    </div>
                  )}

                  {alignerSummary && (
                    <div className="space-y-2 rounded-xl border-4 border-black bg-[#DCFCE7] p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                      <div className="text-sm font-black uppercase">Super Image Aligner</div>
                      <div className="text-xs font-bold text-slate-700">
                        {alignerSummary.extractedFrameCount} frames | {alignerSummary.preparedPairCount} pairs
                      </div>
                      <div className="text-xs font-bold text-slate-700">
                        {alignerSummary.skippedFrameCount} skipped | {alignerSummary.preparedPairCount * 2} uploads
                      </div>
                      {alignerSummary.warnings.length > 0 && (
                        <div className="text-[11px] font-bold text-slate-700">
                          {alignerSummary.warnings.slice(0, 4).join(' ')}
                          {alignerSummary.warnings.length > 4 ? ' ...' : ''}
                        </div>
                      )}
                    </div>
                  )}

                  {superImageSummary && (
                    <div className="space-y-2 rounded-xl border-4 border-black bg-[#DBEAFE] p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                      <div className="text-sm font-black uppercase">Super Image Export</div>
                      <div className="text-xs font-bold text-slate-700">
                        {superImageSummary.validPuzzleCount} valid | {superImageSummary.exportedImagePairCount} pairs
                      </div>
                      <div className="text-xs font-bold text-slate-700">
                        Watermark {superImageSummary.watermarkRemovalEnabled ? 'on' : 'off'} | Cleaned{' '}
                        {superImageSummary.watermarkPairsCleaned}
                      </div>
                      {superImageSummary.outputName && (
                        <div className="break-all font-mono text-[11px] font-bold text-slate-700">
                          {superImageSummary.outputMode === 'folder'
                            ? `Folder: ${superImageSummary.outputName}`
                            : `Zip: ${superImageSummary.outputName}`}
                        </div>
                      )}
                      {superImageSummary.warnings.length > 0 && (
                        <div className="text-[11px] font-bold text-slate-700">
                          {superImageSummary.warnings.slice(0, 4).join(' ')}
                          {superImageSummary.warnings.length > 4 ? ' ...' : ''}
                        </div>
                      )}
                    </div>
                  )}

                  {superSummary && (
                    <div className="space-y-2 rounded-xl border-4 border-black bg-[#FEF3C7] p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                      <div className="text-sm font-black uppercase">Super Video Export</div>
                      <div className="text-xs font-bold text-slate-700">
                        {superSummary.validPuzzleCount} valid | {superSummary.exportedVideoCount} videos
                      </div>
                      <div className="text-xs font-bold text-slate-700">
                        Batch sizes: {superSummary.batchSizes.length > 0 ? superSummary.batchSizes.join(', ') : 'none'}
                      </div>
                      <div className="text-xs font-bold text-slate-700">
                        Watermark {superSummary.watermarkRemovalEnabled ? 'on' : 'off'} | Cleaned{' '}
                        {superSummary.watermarkPairsCleaned}
                      </div>
                      {superSummary.warnings.length > 0 && (
                        <div className="text-[11px] font-bold text-slate-700">
                          {superSummary.warnings.slice(0, 4).join(' ')}
                          {superSummary.warnings.length > 4 ? ' ...' : ''}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  </div>
  );
}
