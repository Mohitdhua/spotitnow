import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Clock3, Download, Layers, LoaderCircle, Sparkles, Trash2, Upload, Video } from 'lucide-react';
import { ConfirmDialog } from '../app/components/ConfirmDialog';
import { VIDEO_PACKAGE_PRESETS } from '../constants/videoPackages';
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
  loadSplitterSetupPresets,
  readSplitterSharedRegion,
  SplitterDefaults,
  type SplitterSetupPreset,
  type SplitterSharedRegion,
  type SuperImageExportMode
} from '../services/appSettings';
import { type VideoSettings, type VideoUserPackage } from '../types';
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

interface FrameExtractorModeProps {
  onBack: () => void;
  defaults: FrameExtractorDefaults;
  splitterDefaults: SplitterDefaults;
  videoSettings: VideoSettings;
  videoPackages: VideoUserPackage[];
  activeVideoPackageId: string;
  defaultsSessionId: number;
  onSendToBatchAuto: (files: File[]) => void;
  onSelectVideoPackage: (packageId: string) => void;
  onOpenVideoMode: () => void;
  hasActiveAppExport?: boolean;
  onSuperImageExportStateChange?: (state: { isExporting: boolean; progress: number; status: string }) => void;
  onSuperExportStateChange?: (state: { isExporting: boolean; progress: number; status: string }) => void;
}

interface UploadedVideoItem {
  id: string;
  file: File;
  metadata: VideoFileMetadata;
}

interface PendingWatermarkConfirm {
  kind: 'super_image' | 'super_video';
  message: string;
  currentPreset: WatermarkSelectionPreset | null;
  targetDirectory?: FileSystemDirectoryHandle | null;
}

type SplitterRegionSourceId = 'current' | `preset:${string}`;

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

export function FrameExtractorMode({
  onBack,
  defaults,
  splitterDefaults,
  videoSettings,
  videoPackages,
  activeVideoPackageId,
  defaultsSessionId,
  onSendToBatchAuto,
  onSelectVideoPackage,
  onOpenVideoMode,
  hasActiveAppExport = false,
  onSuperImageExportStateChange,
  onSuperExportStateChange
}: FrameExtractorModeProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sourceSectionRef = useRef<HTMLDivElement>(null);
  const timestampsSectionRef = useRef<HTMLDivElement>(null);
  const outputSectionRef = useRef<HTMLDivElement>(null);
  const recentRunsSectionRef = useRef<HTMLDivElement>(null);
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
  const [splitterPresets, setSplitterPresets] = useState<SplitterSetupPreset[]>([]);
  const [selectedSplitterRegionSourceId, setSelectedSplitterRegionSourceId] =
    useState<SplitterRegionSourceId>('current');
  const [pendingWatermarkConfirm, setPendingWatermarkConfirm] = useState<PendingWatermarkConfirm | null>(null);

  useEffect(() => {
    setTimestampsText(defaults.timestampsText);
    setImageFormat(defaults.format);
    setJpegQuality(defaults.jpegQuality);
    setSuperExportImagesPerVideo(defaults.superExportImagesPerVideo);
    setSuperImageExportMode(defaults.superImageExportMode);
    setUseSuperExportWatermarkRemoval(defaults.superExportWatermarkRemoval);
    setSelectedWatermarkPresetId(defaults.superExportWatermarkPresetId);
  }, [defaults, defaultsSessionId]);

  useEffect(() => {
    const nextPresets = loadWatermarkPresets();
    setWatermarkPresets(nextPresets);
  }, [defaultsSessionId]);

  useEffect(() => {
    const nextSplitterPresets = loadSplitterSetupPresets().filter((preset) => Boolean(preset.setup.sharedRegion));
    setSplitterPresets(nextSplitterPresets);
    setSelectedSplitterRegionSourceId((current) => {
      if (current === 'current') return current;
      return nextSplitterPresets.some((preset) => `preset:${preset.id}` === current) ? current : 'current';
    });
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
  const selectedSplitterPreset = useMemo(
    () =>
      selectedSplitterRegionSourceId === 'current'
        ? null
        : splitterPresets.find((preset) => `preset:${preset.id}` === selectedSplitterRegionSourceId) ?? null,
    [selectedSplitterRegionSourceId, splitterPresets]
  );
  const selectedSplitterRegion: SplitterSharedRegion | null =
    selectedSplitterPreset?.setup.sharedRegion ?? savedSharedRegion;
  const hasSelectedSplitterRegion = Boolean(selectedSplitterRegion);
  const isBusy = isReadingMetadata || isExtracting || isSuperAligning || isSuperImaging || isSuperExporting;
  const canExtract =
    !isBusy && videos.length > 0 && parsedTimestamps.timestamps.length > 0;
  const canSuperAlign = canExtract && hasSelectedSplitterRegion;
  const canSuperImage = canExtract;
  const canSuperExport = canExtract;
  const selectedWatermarkPreset = useMemo(
    () => watermarkPresets.find((preset) => preset.id === selectedWatermarkPresetId) ?? null,
    [watermarkPresets, selectedWatermarkPresetId]
  );
  const activeVideoPackage = useMemo(
    () => videoPackages.find((entry) => entry.id === activeVideoPackageId) ?? videoPackages[0] ?? null,
    [activeVideoPackageId, videoPackages]
  );
  const effectiveSuperExportPackageLabel =
    activeVideoPackage?.name ??
    VIDEO_PACKAGE_PRESETS[videoSettings.videoPackagePreset]?.label ??
    videoSettings.videoPackagePreset;
  const currentVideoPresetLabel =
    VIDEO_PACKAGE_PRESETS[videoSettings.videoPackagePreset]?.label ?? videoSettings.videoPackagePreset;
  const supportsDirectoryExport = canUseSuperImageDirectoryExport();
  const superImageExportTargetLabel = superImageExportMode === 'folder' ? 'folder' : 'zip';
  const selectedSplitterRegionLabel =
    selectedSplitterRegionSourceId === 'current'
      ? 'Current shared splitter area'
      : selectedSplitterPreset?.name ?? 'Saved splitter preset';

  useEffect(() => {
    if (!supportsDirectoryExport && superImageExportMode === 'folder') {
      setSuperImageExportMode('zip');
    }
  }, [superImageExportMode, supportsDirectoryExport]);

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

    const sharedRegion = selectedSplitterRegion;
    if (!sharedRegion) {
      alert('Choose a saved splitter area first. The aligner uses that shared area to prepare split pairs.');
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

  const runSuperImageExportFlow = async ({
    targetDirectory,
    currentPreset
  }: {
    targetDirectory: FileSystemDirectoryHandle | null;
    currentPreset: WatermarkSelectionPreset | null;
  }) => {
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
        sharedRegion: selectedSplitterRegion,
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
      setPendingWatermarkConfirm({
        kind: 'super_image',
        message: `Super Image Export will remove watermarks using ${methodLabel} before building the ${superImageExportTargetLabel}. Puzzle Image (A) maps to files like puzzle1.png and Diff Image (B) maps to files like puzzle1diff.png. This adds extra processing time. Continue?`,
        currentPreset,
        targetDirectory
      });
      return;
    }

    await runSuperImageExportFlow({
      targetDirectory,
      currentPreset
    });
  };

  const runSuperVideoExportFlow = async (currentPreset: WatermarkSelectionPreset | null) => {
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
        videoSettings,
        imagesPerVideo: superExportImagesPerVideo,
        sharedRegion: selectedSplitterRegion,
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
      setPendingWatermarkConfirm({
        kind: 'super_video',
        message: `Super Export Videos will remove watermarks using ${methodLabel} before rendering the videos. Puzzle Image (A) maps to files like puzzle1.png and Diff Image (B) maps to files like puzzle1diff.png. This adds extra processing time. Continue?`,
        currentPreset
      });
      return;
    }

    await runSuperVideoExportFlow(currentPreset);
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
  const scrollToSection = (sectionRef: React.RefObject<HTMLDivElement | null>) => {
    sectionRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  };

  return (
    <div className="mx-auto w-full max-w-7xl p-2 sm:p-4 md:p-6">
      <div className="overflow-hidden rounded-[20px] border-4 border-black bg-[#FFFDF8] shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] sm:rounded-[28px] sm:shadow-[10px_10px_0px_0px_rgba(0,0,0,1)]">
        <div className="border-b-4 border-black bg-[linear-gradient(135deg,#FED7AA_0%,#FDE68A_48%,#BFDBFE_100%)] p-3 sm:p-5 md:p-7">
          <div className="flex flex-col gap-2 sm:gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-2.5 sm:gap-4">
              <button
                onClick={onBack}
                className="shrink-0 rounded-lg border-2 border-black bg-white p-2 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all hover:-translate-y-0.5 hover:bg-black hover:text-white sm:rounded-xl sm:p-2.5 sm:shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]"
              >
                <ArrowLeft size={18} strokeWidth={3} className="sm:w-[22px] sm:h-[22px]" />
              </button>
              <div className="min-w-0">
                <h2 className="text-lg font-black font-display uppercase tracking-tight text-black sm:text-2xl lg:text-4xl">
                  Frame Extractor
                </h2>
                <p className="mt-1 line-clamp-2 text-[12px] font-bold leading-4 text-slate-700 sm:mt-2 sm:text-[14px] sm:line-clamp-none">
                  Build one extraction plan, jump to the section you need, and run the exact export path without desktop sprawl.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5 sm:gap-2">
              <div className="rounded-full border-2 border-black bg-white px-2.5 py-1 text-[10px] font-black uppercase shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] sm:px-3 sm:py-1.5 sm:text-[11px]">
                {isBusy ? 'Processing' : canExtract ? 'Ready To Run' : 'Setup Needed'}
              </div>
              <div className="rounded-full border-2 border-black bg-black px-2.5 py-1 text-[10px] font-black uppercase text-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] sm:px-3 sm:py-1.5 sm:text-[11px]">
                {videos.length} Video{videos.length === 1 ? '' : 's'}
              </div>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-4 lg:mt-4">
            <div className="rounded-xl border-2 border-black bg-white/90 p-2.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] sm:rounded-2xl sm:p-3 sm:shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
              <div className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500 sm:text-[10px]">Videos</div>
              <div className="mt-1.5 text-xl font-black text-slate-900 sm:mt-2 sm:text-2xl">{videos.length}</div>
              <div className="mt-1 text-[10px] font-bold text-slate-700 sm:text-[11px]">
                {videos.length ? formatDurationShort(totalVideoDurationSeconds) : '--'}
              </div>
              <div className="mt-0.5 text-[10px] font-bold text-slate-600 sm:text-[11px]">{formatFileSize(totalVideoBytes)}</div>
            </div>

            <div className="rounded-xl border-2 border-black bg-white/90 p-2.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] sm:rounded-2xl sm:p-3 sm:shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
              <div className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500 sm:text-[10px]">Timestamps</div>
              <div className="mt-1.5 text-xl font-black text-slate-900 sm:mt-2 sm:text-2xl">{parsedTimestamps.timestamps.length}</div>
              <div className="mt-1 text-[10px] font-bold text-slate-700 sm:text-[11px]">
                {parsedTimestamps.invalidTokens.length > 0
                  ? `${parsedTimestamps.invalidTokens.length} invalid`
                  : 'All valid'}
              </div>
            </div>

            <div className="rounded-xl border-2 border-black bg-white/90 p-2.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] sm:rounded-2xl sm:p-3 sm:shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
              <div className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500 sm:text-[10px]">Requests</div>
              <div className="mt-1.5 text-xl font-black text-slate-900 sm:mt-2 sm:text-2xl">{requestedFrames}</div>
              <div className="mt-1 text-[10px] font-bold text-slate-700 sm:text-[11px]">
                {videos.length}x{parsedTimestamps.timestamps.length}
              </div>
              <div className="mt-0.5 text-[10px] font-bold text-slate-600 sm:text-[11px]">{imageFormat === 'png' ? 'PNG' : 'JPEG'}</div>
            </div>

            <div className="rounded-xl border-2 border-black bg-white/90 p-2.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] sm:rounded-2xl sm:p-3 sm:shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
              <div className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500 sm:text-[10px]">Package</div>
              <div className="mt-1.5 text-xs font-black uppercase text-slate-900 sm:mt-2 sm:text-sm">
                {effectiveSuperExportPackageLabel.length > 12 ? effectiveSuperExportPackageLabel.split(' ')[0] : effectiveSuperExportPackageLabel}
              </div>
              <div className="mt-1 text-[10px] font-bold text-slate-700 sm:text-[11px]">
                {hasSelectedSplitterRegion ? '✓ Ready' : '○ Missing'}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4 bg-[radial-gradient(circle_at_top_right,#DBEAFE_0%,#FFFDF8_34%,#FFF7ED_100%)] p-3 sm:p-5 md:p-8">
          <div className="rounded-2xl border-4 border-black bg-[#111827] p-3 text-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] sm:rounded-[24px] sm:p-4 sm:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-black sm:text-base lg:text-xl">
                  {isBusy && <LoaderCircle size={16} className="animate-spin sm:w-[18px] sm:h-[18px]" />}
                  <Clock3 size={16} className="sm:w-[18px] sm:h-[18px]" />
                  <span className="truncate">{activeStatusLabel}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 sm:gap-2">
                <div className="rounded-full border-2 border-white/80 bg-white/10 px-2.5 py-1 text-[10px] font-black uppercase sm:px-3 sm:py-1.5 sm:text-[11px]">
                  {progressPercent}%
                </div>
                <div className="rounded-full border-2 border-white/80 bg-white/10 px-2.5 py-1 text-[10px] font-black uppercase sm:px-3 sm:py-1.5 sm:text-[11px]">
                  {recentRunCount} Run{recentRunCount === 1 ? '' : 's'}
                </div>
              </div>
            </div>

            <div className="mt-3 h-3 overflow-hidden rounded-full border-2 border-white/80 bg-white/15 sm:mt-4 sm:h-4">
              <div
                className="h-full bg-[linear-gradient(90deg,#FDE68A_0%,#86EFAC_38%,#60A5FA_72%,#C084FC_100%)] transition-all"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-2 lg:hidden">
            <button
              type="button"
              onClick={() => scrollToSection(sourceSectionRef)}
              className="shrink-0 rounded-xl border-2 border-black bg-white px-4 py-2.5 text-[11px] font-black uppercase text-slate-900 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:bg-slate-100"
            >
              Clips
            </button>
            <button
              type="button"
              onClick={() => scrollToSection(timestampsSectionRef)}
              className="shrink-0 rounded-xl border-2 border-black bg-white px-4 py-2.5 text-[11px] font-black uppercase text-slate-900 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:bg-slate-100"
            >
              Times
            </button>
            <button
              type="button"
              onClick={() => scrollToSection(outputSectionRef)}
              className="shrink-0 rounded-xl border-2 border-black bg-[#DBEAFE] px-4 py-2.5 text-[11px] font-black uppercase text-slate-900 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:bg-[#BFDBFE]"
            >
              Output
            </button>
            <button
              type="button"
              onClick={() => scrollToSection(recentRunsSectionRef)}
              className="shrink-0 rounded-xl border-2 border-black bg-[#FFF7ED] px-4 py-2.5 text-[11px] font-black uppercase text-slate-900 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:bg-orange-100"
            >
              Runs
            </button>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
            <div ref={sourceSectionRef} className="min-w-0 scroll-mt-32 space-y-4 xl:col-span-7">
              <div className="rounded-2xl border-4 border-black bg-[#FFF7ED] p-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] sm:rounded-[24px] sm:p-5 sm:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
                <div className="flex flex-col gap-3 sm:gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <h3 className="text-lg sm:text-2xl font-black uppercase text-slate-900">Source Clips</h3>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 rounded-lg border-2 border-black bg-white px-3 py-2 text-[11px] font-black uppercase shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all hover:-translate-y-0.5 hover:bg-black hover:text-white sm:rounded-xl sm:px-4 sm:py-2.5 sm:text-xs sm:gap-2 sm:shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]"
                    >
                      <Upload size={14} strokeWidth={3} className="sm:w-[16px] sm:h-[16px]" />
                      <span>Add</span>
                    </button>
                    <button
                      onClick={handleClearVideos}
                      disabled={!videos.length}
                      className={`rounded-lg border-2 border-black px-3 py-2 text-[11px] font-black uppercase transition-all sm:rounded-xl sm:px-4 sm:py-2.5 sm:text-xs ${
                        videos.length
                          ? 'bg-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 hover:bg-red-50 sm:shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]'
                          : 'bg-slate-200 text-slate-500 cursor-not-allowed'
                      }`}
                    >
                      Clear
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

                <div className="mt-3 flex flex-wrap gap-1.5 text-[9px] font-black uppercase tracking-wide text-slate-700 sm:text-[10px] sm:gap-2">
                  <div className="rounded-full border-2 border-black bg-white px-2.5 py-1 sm:px-3 sm:py-1.5">
                    {videos.length ? formatDurationShort(totalVideoDurationSeconds) : '--'}
                  </div>
                  <div className="rounded-full border-2 border-black bg-white px-2.5 py-1 sm:px-3 sm:py-1.5">
                    {formatFileSize(totalVideoBytes)}
                  </div>
                  <div className="rounded-full border-2 border-black bg-white px-2.5 py-1 sm:px-3 sm:py-1.5">
                    {parsedTimestamps.timestamps.length} time
                  </div>
                  <div className="rounded-full border-2 border-black bg-white px-2.5 py-1 sm:px-3 sm:py-1.5">
                    {requestedFrames} req
                  </div>
                </div>

                <div className="mt-3 max-h-[300px] space-y-2 overflow-auto pr-1 sm:max-h-[430px] sm:space-y-3">
                  {videos.length === 0 ? (
                    <div className="rounded-[24px] border-2 border-dashed border-black bg-white px-6 py-8 text-center">
                      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border-2 border-black bg-[#FEF3C7]">
                        <Video size={24} strokeWidth={2.8} />
                      </div>
                      <div className="mt-4 text-lg font-black uppercase text-slate-900">No videos loaded</div>
                      <div className="mt-2 text-[11px] font-bold uppercase tracking-wide text-slate-600">
                        Add clips once, then keep the queue scrollable instead of stretching the page.
                      </div>
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="mt-4 inline-flex items-center gap-2 rounded-xl border-2 border-black bg-black px-4 py-2 text-xs font-black uppercase text-white shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] transition-all hover:-translate-y-0.5 hover:bg-slate-900"
                      >
                        <Upload size={14} strokeWidth={3} />
                        <span>Choose Videos</span>
                      </button>
                    </div>
                  ) : (
                    videos.map((item, index) => (
                      <div
                        key={item.id}
                        className="rounded-lg border-2 border-black bg-white p-2.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all hover:-translate-y-0.5 sm:rounded-[20px] sm:p-3 sm:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
                      >
                        <div className="flex items-start justify-between gap-2.5 sm:gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-xs font-black text-slate-900 sm:text-sm">{item.file.name.length > 20 ? item.file.name.substring(0, 17) + '...' : item.file.name}</div>
                            <div className="mt-1.5 flex flex-wrap gap-1 text-[9px] font-black uppercase tracking-wide sm:mt-2 sm:gap-2 sm:text-[10px]">
                              <div className="rounded-full border-2 border-black bg-[#FED7AA] px-2 py-0.5 sm:px-2.5 sm:py-1">
                                #{index + 1}
                              </div>
                              <div className="rounded-full border border-black bg-[#FFF7ED] px-2 py-0.5 sm:px-2.5 sm:py-1">
                                {formatDurationShort(item.metadata.durationSeconds)}
                              </div>
                              <div className="rounded-full border border-black bg-[#EEF9FF] px-2 py-0.5 sm:px-2.5 sm:py-1">
                                {formatFileSize(item.file.size)}
                              </div>
                              <div className="rounded-full border border-black bg-[#F3E8FF] px-2 py-0.5 sm:px-2.5 sm:py-1">
                                {item.metadata.width}x{item.metadata.height}
                              </div>
                            </div>
                          </div>
                          <button
                            onClick={() => handleRemoveVideo(item.id)}
                            className="shrink-0 rounded-lg border-2 border-black bg-white p-1.5 transition-all hover:bg-red-50 sm:rounded-xl sm:p-2"
                            title="Remove video"
                          >
                            <Trash2 size={14} strokeWidth={2.5} className="sm:w-[15px] sm:h-[15px]" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div
              ref={timestampsSectionRef}
              className="min-w-0 self-start scroll-mt-32 space-y-4 xl:sticky xl:top-6 xl:col-span-5"
            >
              <div className="rounded-2xl border-4 border-black bg-[#EEF9FF] p-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] space-y-3 sm:rounded-[24px] sm:p-5 sm:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] sm:space-y-4">
                <div className="flex flex-col gap-2 sm:gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <h3 className="text-lg sm:text-2xl font-black uppercase text-slate-900">Shared Timestamps</h3>
                  <div className="flex flex-wrap gap-1.5 sm:gap-2">
                    <div className="rounded-full border-2 border-black bg-white px-2.5 py-1 text-[10px] font-black uppercase sm:px-3 sm:py-1.5 sm:text-[11px]">
                      {parsedTimestamps.timestamps.length} Valid
                    </div>
                    {parsedTimestamps.invalidTokens.length > 0 && (
                      <div className="rounded-full border-2 border-black bg-[#FECACA] px-2.5 py-1 text-[10px] font-black uppercase sm:px-3 sm:py-1.5 sm:text-[11px]">
                        {parsedTimestamps.invalidTokens.length} Bad
                      </div>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:gap-3">
                  <div className="rounded-xl border-2 border-black bg-white px-2.5 py-2.5 text-[10px] font-bold text-slate-700 sm:rounded-2xl sm:px-3 sm:py-3 sm:text-[11px]">
                    <div className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500 sm:text-[10px]">Requests</div>
                    <div className="mt-1.5 text-base font-black text-slate-900 sm:mt-2 sm:text-lg">{requestedFrames}</div>
                  </div>
                  <div className="rounded-xl border-2 border-black bg-white px-2.5 py-2.5 text-[10px] font-bold text-slate-700 sm:rounded-2xl sm:px-3 sm:py-3 sm:text-[11px]">
                    <div className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500 sm:text-[10px]">Format</div>
                    <div className="mt-1.5 text-base font-black text-slate-900 sm:mt-2 sm:text-lg">{imageFormat.toUpperCase()}</div>
                  </div>
                </div>
                <textarea
                  value={timestampsText}
                  onChange={(event) => setTimestampsText(event.target.value)}
                  rows={5}
                  className="min-h-[120px] w-full resize-y rounded-lg border-2 border-black bg-white p-3 font-mono text-xs shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] sm:min-h-[170px] sm:rounded-[22px] sm:p-4 sm:text-sm sm:shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]"
                  placeholder="00:05, 00:10.5, 90"
                />
                <div className="rounded-lg border-2 border-black bg-white px-3 py-2.5 text-[10px] font-bold text-slate-700 sm:rounded-2xl sm:px-4 sm:py-3 sm:text-[11px]">
                  MM:SS, HH:MM:SS.mmm, or seconds. Commas or breaks.
                </div>
                {parsedTimestamps.invalidTokens.length > 0 && (
                  <div className="rounded-lg border-2 border-black bg-[#FECACA] px-3 py-2 text-[10px] font-bold text-slate-800 sm:rounded-2xl sm:px-4 sm:py-3 sm:text-[11px]">
                    Bad: {parsedTimestamps.invalidTokens.slice(0, 6).join(', ')}
                    {parsedTimestamps.invalidTokens.length > 6 ? ' ...' : ''}
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

            <div ref={outputSectionRef} className="min-w-0 scroll-mt-32 xl:col-span-12">
              <div className="rounded-2xl border-4 border-black bg-[#F8FDFF] p-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] space-y-4 sm:rounded-[24px] sm:p-5 sm:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
                <div className="flex flex-col gap-2 sm:gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <h3 className="text-lg sm:text-2xl font-black uppercase text-slate-900">Output + Routing</h3>
                  <div className="flex flex-wrap gap-1.5 sm:gap-2">
                    <div className="rounded-full border-2 border-black bg-white px-2.5 py-1 text-[10px] font-black uppercase sm:px-3 sm:py-1.5 sm:text-[11px]">
                      {effectiveSuperExportPackageLabel.split(' ')[0]}
                    </div>
                    <div className="rounded-full border-2 border-black bg-[#DBEAFE] px-2.5 py-1 text-[10px] font-black uppercase sm:px-3 sm:py-1.5 sm:text-[11px]">
                      {effectiveOutputModeLabel.split(' ')[0]}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:gap-4 xl:grid-cols-2">
                <div className="rounded-xl border-2 border-black bg-white p-3 space-y-3 sm:rounded-2xl sm:p-4 sm:space-y-4">
                  <div className="text-xs sm:text-sm font-black uppercase text-slate-900">Image Format</div>
                  <div className="grid grid-cols-2 gap-2 sm:gap-3">
                    {(['png', 'jpeg'] as const).map((value) => (
                      <button
                        key={value}
                        onClick={() => setImageFormat(value)}
                        className={`rounded-lg border-2 border-black px-2.5 py-2.5 text-[10px] font-black uppercase transition-all sm:rounded-xl sm:px-3 sm:py-3 sm:text-xs ${
                          imageFormat === value
                            ? 'bg-[#FDE68A] text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] sm:shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]'
                            : 'bg-white hover:bg-slate-100'
                        }`}
                      >
                        {value === 'png' ? 'PNG' : 'JPEG'}
                      </button>
                    ))}
                  </div>
                </div>

              {imageFormat === 'jpeg' && (
                <div className="rounded-xl border-2 border-black bg-white p-3 sm:rounded-2xl sm:p-4">
                  <div className="flex items-center justify-between text-[10px] font-black uppercase mb-2 sm:text-xs sm:mb-3">
                    <span>Quality</span>
                    <span>{Math.round(jpegQuality * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0.5}
                    max={1}
                    step={0.01}
                    value={jpegQuality}
                    onChange={(event) => setJpegQuality(Number(event.target.value))}
                    className="w-full h-2 border-2 border-black rounded-full accent-black sm:h-3"
                  />
                </div>
              )}

                <div className="grid grid-cols-1 gap-2 sm:gap-3 sm:grid-cols-3 xl:col-span-2">
                <div className="rounded-xl border-2 border-black bg-white p-2.5 text-[10px] font-bold text-slate-700 sm:rounded-2xl sm:p-4 sm:text-xs">
                  <div className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500 sm:text-[10px]">Workload</div>
                  <div className="mt-1.5 text-base font-black text-slate-900 sm:mt-2 sm:text-lg">{requestedFrames}</div>
                  <div className="mt-0.5 text-[9px] font-bold text-slate-600 sm:mt-1 sm:text-[11px]">
                    {videos.length}x{parsedTimestamps.timestamps.length}
                  </div>
                </div>
                <div className="rounded-xl border-2 border-black bg-white p-2.5 text-[10px] font-bold text-slate-700 sm:rounded-2xl sm:p-4 sm:text-xs">
                  <div className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500 sm:text-[10px]">Split Area</div>
                  <div className="mt-1.5 text-base font-black text-slate-900 sm:mt-2 sm:text-lg">{hasSelectedSplitterRegion ? '✓' : '○'}</div>
                  <div className="mt-0.5 text-[9px] font-bold text-slate-600 line-clamp-1 sm:mt-1 sm:text-[11px]">{selectedSplitterRegionLabel.split(' ')[0]}</div>
                </div>
                  <div className="rounded-xl border-2 border-black bg-white p-2.5 text-[10px] font-bold text-slate-700 sm:rounded-2xl sm:p-4 sm:text-xs">
                    <div className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500 sm:text-[10px]">Watermark</div>
                    <div className="mt-1.5 text-base font-black text-slate-900 sm:mt-2 sm:text-lg">
                      {useSuperExportWatermarkRemoval ? 'On' : 'Off'}
                    </div>
                  </div>
                </div>

              <div className="rounded-xl border-2 border-black bg-white p-3 space-y-3 sm:rounded-2xl sm:p-4 sm:space-y-4 xl:col-span-2">
                <div className="flex flex-col gap-2 sm:gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-xs sm:text-sm font-black uppercase text-slate-900">Super Image Target</div>
                  {!supportsDirectoryExport && (
                    <div className="text-[9px] font-bold text-slate-600 sm:text-[11px]">Zip only</div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 sm:gap-3">
                  <button
                    onClick={() => setSuperImageExportMode('zip')}
                    className={`rounded-lg border-2 border-black px-2.5 py-2.5 text-[10px] font-black uppercase transition-all sm:rounded-xl sm:px-3 sm:py-3 sm:text-xs ${
                      superImageExportMode === 'zip'
                        ? 'bg-[#DBEAFE] shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] sm:shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]'
                        : 'bg-white hover:bg-slate-100'
                    }`}
                  >
                    Zip
                  </button>
                  <button
                    onClick={() => setSuperImageExportMode('folder')}
                    disabled={!supportsDirectoryExport}
                    className={`rounded-lg border-2 border-black px-2.5 py-2.5 text-[10px] font-black uppercase transition-all sm:rounded-xl sm:px-3 sm:py-3 sm:text-xs ${
                      superImageExportMode === 'folder' && supportsDirectoryExport
                        ? 'bg-[#C7F9CC] shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] sm:shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]'
                        : 'bg-white hover:bg-slate-100'
                    } ${!supportsDirectoryExport ? 'bg-slate-200 text-slate-500 cursor-not-allowed' : ''}`}
                  >
                    Folder
                  </button>
                </div>
              </div>

              <div className="rounded-xl border-2 border-black bg-white p-3 space-y-3 sm:rounded-2xl sm:p-4 sm:space-y-4 xl:col-span-2">
                <div className="flex flex-col gap-2 sm:gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-xs sm:text-sm font-black uppercase text-slate-900">Super Export Package</div>
                  <button
                    onClick={onOpenVideoMode}
                    className="rounded-lg border-2 border-black bg-white px-2.5 py-1.5 text-[10px] font-black uppercase transition-all hover:bg-slate-100 sm:rounded-xl sm:px-3 sm:py-2 sm:text-[11px]"
                  >
                    Video Mode
                  </button>
                </div>
                <div className="rounded-lg border border-black bg-[#EFF6FF] px-2.5 py-2 text-[9px] font-bold text-slate-700 sm:rounded-xl sm:px-3 sm:py-2.5 sm:text-[11px]">
                  Uses active Video Mode package. Tune full settings there.
                </div>
                <label className="block">
                  <div className="mb-1.5 text-[10px] font-black uppercase text-slate-600 sm:text-[11px]">Active Package</div>
                  <select
                    value={activeVideoPackageId}
                    onChange={(event) => onSelectVideoPackage(event.target.value)}
                    disabled={isBusy || videoPackages.length === 0}
                    className="w-full rounded-lg border-2 border-black bg-white px-2.5 py-2 text-xs font-bold disabled:bg-slate-200 disabled:text-slate-500 disabled:cursor-not-allowed sm:rounded-xl sm:px-3 sm:text-sm"
                  >
                    {videoPackages.map((videoPackage) => (
                      <option key={videoPackage.id} value={videoPackage.id}>
                        {videoPackage.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
                  <div className="rounded-lg border border-black bg-[#FFF7ED] px-2.5 py-2 text-[9px] font-bold text-slate-700 sm:rounded-xl sm:px-3 sm:py-2.5 sm:text-[11px]">
                    <div className="text-[8px] font-black uppercase tracking-[0.18em] text-slate-500 sm:text-[10px]">Package</div>
                    <div className="mt-1 text-xs font-black text-slate-900 sm:mt-2 sm:text-sm">{effectiveSuperExportPackageLabel.split(' ')[0]}</div>
                  </div>
                  <div className="rounded-lg border border-black bg-white px-2.5 py-2 text-[9px] font-bold text-slate-700 sm:rounded-xl sm:px-3 sm:py-2.5 sm:text-[11px]">
                    <div className="text-[8px] font-black uppercase tracking-[0.18em] text-slate-500 sm:text-[10px]">Preset</div>
                    <div className="mt-1 text-xs font-black text-slate-900 line-clamp-1 sm:mt-2 sm:text-sm">{currentVideoPresetLabel.split(' ')[0]}</div>
                  </div>
                  <div className="rounded-lg border border-black bg-white px-2.5 py-2 text-[9px] font-bold text-slate-700 sm:rounded-xl sm:px-3 sm:py-2.5 sm:text-[11px]">
                    <div className="text-[8px] font-black uppercase tracking-[0.18em] text-slate-500 sm:text-[10px]">Ratio</div>
                    <div className="mt-1 text-xs font-black text-slate-900 sm:mt-2 sm:text-sm">{videoSettings.aspectRatio}</div>
                  </div>
                  <div className="rounded-lg border border-black bg-white px-2.5 py-2 text-[9px] font-bold text-slate-700 sm:rounded-xl sm:px-3 sm:py-2.5 sm:text-[11px]">
                    <div className="text-[8px] font-black uppercase tracking-[0.18em] text-slate-500 sm:text-[10px]">Export</div>
                    <div className="mt-1 text-xs font-black text-slate-900 sm:mt-2 sm:text-sm">
                      {videoSettings.exportResolution.split('p')[0]}p
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border-2 border-black bg-white p-3 space-y-2.5 sm:rounded-2xl sm:p-4 sm:space-y-3">
                <div className="flex items-center justify-between gap-2.5 sm:gap-3">
                  <div className="text-xs sm:text-sm font-black uppercase text-slate-900">Watermark Removal</div>
                  <button
                    onClick={() => setUseSuperExportWatermarkRemoval((current) => !current)}
                    disabled={isBusy}
                    className={`px-2.5 py-1.5 rounded-lg border-2 border-black text-[10px] font-black uppercase sm:px-3 sm:py-2 sm:text-[11px] ${
                      useSuperExportWatermarkRemoval ? 'bg-[#A7F3D0]' : 'bg-white hover:bg-slate-100'
                    } ${isBusy ? 'cursor-not-allowed bg-slate-200 text-slate-500' : ''}`}
                  >
                    {useSuperExportWatermarkRemoval ? 'On' : 'Off'}
                  </button>
                </div>

                {useSuperExportWatermarkRemoval && (
                  <div className="space-y-2 pt-1">
                    <label className="block">
                      <div className="mb-1 text-[10px] font-black uppercase text-slate-600 sm:text-[11px]">Preset</div>
                      <select
                        value={selectedWatermarkPresetId}
                        onChange={(event) => setSelectedWatermarkPresetId(event.target.value)}
                        disabled={isBusy}
                        className="w-full border-2 border-black rounded-lg bg-white px-2.5 py-1.5 text-xs font-bold sm:rounded-lg sm:px-3 sm:py-2 sm:text-sm"
                      >
                        <option value="">Auto</option>
                        {watermarkPresets.map((preset) => (
                          <option key={preset.id} value={preset.id}>
                            {preset.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="text-[10px] font-bold text-slate-600 sm:text-[11px]">
                      {selectedWatermarkPreset ? selectedWatermarkPreset.name : 'Auto'}
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-xl border-2 border-black bg-white p-3 sm:rounded-2xl sm:p-4">
                <div className="flex items-center justify-between text-[10px] font-black uppercase mb-1.5 sm:text-xs sm:mb-2">
                  <span>Images / Video</span>
                  <span>{superExportImagesPerVideo}</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={20}
                  step={1}
                  value={superExportImagesPerVideo}
                  onChange={(event) => setSuperExportImagesPerVideo(Number(event.target.value))}
                  className="w-full h-2 border-2 border-black rounded-full accent-black sm:h-3"
                />
              </div>

              <div className="rounded-2xl border-2 border-black bg-white p-4 space-y-4 xl:col-span-2">
                <div className="text-xs sm:text-sm font-black uppercase text-slate-900">Run</div>
                <div className="rounded-lg border-2 border-black bg-[#F8FDFF] p-2.5 space-y-2 sm:rounded-2xl sm:p-4 sm:space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2 sm:gap-3">
                    <div>
                      <div className="text-[10px] font-black uppercase text-slate-500 sm:text-[11px]">Splitter Source</div>
                      <div className="text-xs font-black text-slate-900 line-clamp-1 sm:text-sm">{selectedSplitterRegionLabel.split(' ')[0]}</div>
                    </div>
                    <div className="rounded-full border-2 border-black bg-white px-2.5 py-1 text-[9px] font-black uppercase sm:px-3 sm:text-[10px]">
                      {splitterPresets.length} saved
                    </div>
                  </div>
                  <select
                    value={selectedSplitterRegionSourceId}
                    onChange={(event) => setSelectedSplitterRegionSourceId(event.target.value as SplitterRegionSourceId)}
                    className="w-full rounded-lg border-2 border-black bg-white px-2.5 py-1.5 text-xs font-bold sm:rounded-xl sm:px-3 sm:py-2 sm:text-sm"
                  >
                    <option value="current">Current</option>
                    {splitterPresets.map((preset) => (
                      <option key={preset.id} value={`preset:${preset.id}`}>
                        {preset.name}
                      </option>
                    ))}
                  </select>
                  <div className="text-[9px] font-bold text-slate-600 sm:text-[11px]">
                    Aligner reuses selected splitter area. Export uses it when chosen.
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:gap-3 sm:grid-cols-2">
                  <button
                    onClick={handleExtractFrames}
                    disabled={!canExtract}
                    className={`rounded-lg border-3 border-black p-2.5 text-left transition-all sm:rounded-[20px] sm:border-4 sm:p-3.5 lg:p-4 ${
                      canExtract
                        ? 'bg-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 hover:bg-[#ECFCCB] sm:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] sm:hover:-translate-y-1'
                        : 'cursor-not-allowed bg-slate-200 text-slate-500'
                    }`}
                  >
                    <div className="flex items-center gap-2 sm:gap-3">
                      <Download size={15} strokeWidth={2.5} className="sm:w-[18px] sm:h-[18px]" />
                      <div className="text-[11px] font-black uppercase sm:text-sm">Extract</div>
                    </div>
                    <div className="mt-1 text-[9px] font-bold text-slate-600 sm:mt-2 sm:text-[11px]">Download all images.</div>
                  </button>

                  <button
                    onClick={handleSuperAligner}
                    disabled={!canSuperAlign}
                    className={`rounded-lg border-3 border-black p-2.5 text-left transition-all sm:rounded-[20px] sm:border-4 sm:p-3.5 lg:p-4 ${
                      canSuperAlign
                        ? 'bg-[#DCFCE7] shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 hover:bg-[#BBF7D0] sm:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] sm:hover:-translate-y-1'
                        : 'cursor-not-allowed bg-slate-200 text-slate-500'
                    }`}
                  >
                    <div className="flex items-center gap-2 sm:gap-3">
                      <Layers size={15} strokeWidth={2.5} className="sm:w-[18px] sm:h-[18px]" />
                      <div className="text-[11px] font-black uppercase sm:text-sm">Aligner</div>
                    </div>
                    <div className="mt-1 text-[9px] font-bold text-slate-600 sm:mt-2 sm:text-[11px]">Build pairs for batch.</div>
                  </button>

                  <button
                    onClick={handleSuperImageExport}
                    disabled={!canSuperImage}
                    className={`rounded-lg border-3 border-black p-2.5 text-left transition-all sm:rounded-[20px] sm:border-4 sm:p-3.5 lg:p-4 ${
                      canSuperImage
                        ? 'bg-[#DBEAFE] shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 hover:bg-[#BFDBFE] sm:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] sm:hover:-translate-y-1'
                        : 'cursor-not-allowed bg-slate-200 text-slate-500'
                    }`}
                  >
                    <div className="flex items-center gap-2 sm:gap-3">
                      <Layers size={15} strokeWidth={2.5} className="sm:w-[18px] sm:h-[18px]" />
                      <div className="text-[11px] font-black uppercase sm:text-sm">Image</div>
                    </div>
                    <div className="mt-1 text-[9px] font-bold text-slate-600 sm:mt-2 sm:text-[11px]">
                      Pairs as {effectiveOutputModeLabel.split(' ')[0]}.
                    </div>
                  </button>

                  <button
                    onClick={handleSuperExport}
                    disabled={!canSuperExport}
                    className={`rounded-lg border-3 border-black p-2.5 text-left transition-all sm:rounded-[20px] sm:border-4 sm:p-3.5 lg:p-4 ${
                      canSuperExport
                        ? 'bg-[#FEF3C7] shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 hover:bg-[#FDE68A] sm:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] sm:hover:-translate-y-1'
                        : 'cursor-not-allowed bg-slate-200 text-slate-500'
                    }`}
                  >
                    <div className="flex items-center gap-2 sm:gap-3">
                      <Sparkles size={15} strokeWidth={2.5} className="sm:w-[18px] sm:h-[18px]" />
                      <div className="text-[11px] font-black uppercase sm:text-sm">Video</div>
                    </div>
                    <div className="mt-1 text-[9px] font-bold text-slate-600 sm:mt-2 sm:text-[11px]">Render puzzles.</div>
                  </button>
                </div>

                {!hasSelectedSplitterRegion && (
                  <div className="rounded-lg border-2 border-black bg-[#FDE68A] px-3 py-2 text-[10px] font-bold text-slate-800 sm:rounded-2xl sm:px-4 sm:py-3 sm:text-[11px]">
                    Save area in Splitter or choose preset to unlock Aligner.
                  </div>
                )}
              </div>
                </div>
            </div>

            {recentRunCount > 0 && (
              <div ref={recentRunsSectionRef} className="space-y-2 scroll-mt-32 xl:col-span-12 sm:space-y-3">
                <div className="flex flex-col gap-2 sm:gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-base sm:text-lg font-black uppercase text-slate-900">Recent Runs</div>
                  <div className="rounded-full border-2 border-black bg-white px-2.5 py-1 text-[10px] font-black uppercase sm:px-3 sm:py-1.5 sm:text-[11px]">
                    {recentRunCount} Report
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:gap-3 md:grid-cols-2 lg:gap-4 xl:grid-cols-4">
                  {summary && (
                    <div className="space-y-1.5 rounded-lg border-3 border-black bg-[#ECFCCB] p-3 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] sm:rounded-xl sm:border-4 sm:p-4 sm:space-y-2 sm:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                      <div className="text-xs sm:text-sm font-black uppercase">Extraction</div>
                      <div className="text-[11px] sm:text-xs font-bold text-slate-700">
                        {summary.extractedCount} ✓ | {summary.skippedCount} ⊘ | {summary.failedCount} ✕
                      </div>
                      {summary.warnings.length > 0 && (
                        <div className="text-[10px] sm:text-[11px] font-bold text-slate-700">
                          {summary.warnings.slice(0, 2).join(' ')}
                        </div>
                      )}
                    </div>
                  )}

                  {alignerSummary && (
                    <div className="space-y-1.5 rounded-lg border-3 border-black bg-[#DCFCE7] p-3 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] sm:rounded-xl sm:border-4 sm:p-4 sm:space-y-2 sm:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                      <div className="text-xs sm:text-sm font-black uppercase">Aligner</div>
                      <div className="text-[11px] sm:text-xs font-bold text-slate-700">
                        {alignerSummary.extractedFrameCount} frames | {alignerSummary.preparedPairCount} pairs
                      </div>
                      <div className="text-[11px] sm:text-xs font-bold text-slate-700">
                        {alignerSummary.preparedPairCount * 2} uploads
                      </div>
                    </div>
                  )}

                  {superImageSummary && (
                    <div className="space-y-1.5 rounded-lg border-3 border-black bg-[#DBEAFE] p-3 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] sm:rounded-xl sm:border-4 sm:p-4 sm:space-y-2 sm:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                      <div className="text-xs sm:text-sm font-black uppercase">Image Export</div>
                      <div className="text-[11px] sm:text-xs font-bold text-slate-700">
                        {superImageSummary.validPuzzleCount} valid | {superImageSummary.exportedImagePairCount} pairs
                      </div>
                      <div className="text-[11px] sm:text-xs font-bold text-slate-700">
                        WM: {superImageSummary.watermarkRemovalEnabled ? 'on' : 'off'}
                      </div>
                      {superImageSummary.outputName && (
                        <div className="break-all font-mono text-[10px] sm:text-[11px] font-bold text-slate-700">
                          {superImageSummary.outputMode === 'folder'
                            ? `📁 ${superImageSummary.outputName.substring(0, 20)}`
                            : `📦 ${superImageSummary.outputName.substring(0, 20)}`}
                        </div>
                      )}
                    </div>
                  )}

                  {superSummary && (
                    <div className="space-y-1.5 rounded-lg border-3 border-black bg-[#FEF3C7] p-3 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] sm:rounded-xl sm:border-4 sm:p-4 sm:space-y-2 sm:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                      <div className="text-xs sm:text-sm font-black uppercase">Video Export</div>
                      <div className="text-[11px] sm:text-xs font-bold text-slate-700">
                        {superSummary.validPuzzleCount} valid | {superSummary.exportedVideoCount} videos
                      </div>
                      <div className="text-[11px] sm:text-xs font-bold text-slate-700">
                        WM: {superSummary.watermarkRemovalEnabled ? 'on' : 'off'}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(pendingWatermarkConfirm)}
        title="Enable Watermark Removal?"
        description={pendingWatermarkConfirm?.message}
        confirmLabel="Continue"
        onOpenChange={(open) => {
          if (!open) {
            setPendingWatermarkConfirm(null);
          }
        }}
        onConfirm={() => {
          const pending = pendingWatermarkConfirm;
          setPendingWatermarkConfirm(null);
          if (!pending) return;
          if (pending.kind === 'super_image') {
            void runSuperImageExportFlow({
              targetDirectory: pending.targetDirectory ?? null,
              currentPreset: pending.currentPreset
            });
            return;
          }
          void runSuperVideoExportFlow(pending.currentPreset);
        }}
      />
    </div>
  </div>
  );
}

