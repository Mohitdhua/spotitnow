import JSZip from 'jszip';
import { Puzzle, Region, VideoSettings } from '../types';
import { canvasToDataUrl, readRuntimeBlobImageDimensions } from './canvasRuntime';
import {
  SplitterDefaults,
  type SplitterSharedRegion,
  type SuperExportThumbnailExportMode,
  type SuperImageExportMode
} from './appSettings';
import {
  detectDifferencesClientSideCanvases,
  type DifferenceDetectionOptions,
  type ProcessedPuzzleCanvasData
} from './imageProcessing';
import { extractFrames, extractFramesStream, type ExtractFramesSummary, type ParsedTimestamp } from './frameExtractor';
import {
  splitCombinedBlobFromSelectionToCanvas,
  splitCombinedBlobSmartToCanvas,
  splitCombinedFileSmartToCanvas
} from './imageSplitter';
import {
  removeWatermark,
  removeWatermarkWithRegions,
  scaleWatermarkRegions,
  type WatermarkSelectionPreset
} from './watermarkRemoval';
import type {
  SuperImageProcessorResultPayload
} from './superImageProcessorProtocol';
import type {
  SuperImageExportWorkerDoneMessage,
  SuperImageExportWorkerRequest,
  SuperImageExportWorkerResponse
} from './superImageExportProtocol';
import { runBatchExportTasks } from './batchExportScheduler';
import {
  cancelVideoExport,
  renderVideoFramePreview,
  renderVideoWithWebCodecs,
  streamVideoToWritableWithWebCodecs
} from './videoExport';
import { mediaDiagnosticsStore, type MediaJobController } from './mediaDiagnostics';
import { acquireSuperImageProcessingPool, disposeSuperImageProcessingPool, releaseSuperImageProcessingPool } from './superImageProcessingPool';
import type { BinaryRenderablePuzzle } from './videoRenderSource';
import {
  applySuperExportThumbnailStylePreset,
  type SuperExportThumbnailStylePresetId
} from '../constants/superExportThumbnailStyles';

export type SuperProcessingStage = 'extracting' | 'processing' | 'cleaning' | 'packaging' | 'exporting';
export type SuperExportOutputMode = 'videos_only' | 'videos_and_thumbnails' | 'thumbnails_only';

export interface SuperExportProgress {
  stage: SuperProcessingStage;
  progress: number;
  label: string;
}

interface SuperBaseResult {
  extractionSummary: ExtractFramesSummary;
  extractedFrameCount: number;
  processedFrameCount: number;
  validPuzzleCount: number;
  discardedFrameCount: number;
  warnings: string[];
}

export interface SuperExportResult extends SuperBaseResult {
  exportMode: SuperExportOutputMode;
  exportedVideoCount: number;
  exportedThumbnailCount: number;
  batchSizes: number[];
  imagesPerVideo: number;
  thumbnailEnabled: boolean;
  watermarkRemovalEnabled: boolean;
  watermarkPairsCleaned: number;
  watermarkPresetName: string | null;
}

export interface SuperImageExportResult extends SuperBaseResult {
  exportedImagePairCount: number;
  outputMode: SuperImageExportMode;
  outputName: string | null;
  watermarkRemovalEnabled: boolean;
  watermarkPairsCleaned: number;
  watermarkPresetName: string | null;
}

let activeSuperImageExportWorker: Worker | null = null;
let activeSuperImageExportController: { cancel: () => void } | null = null;
let activeSuperExportController: { cancel: () => void } | null = null;

const SUPER_VIDEO_COORDINATOR_ID = 'super-video-coordinator';
const SUPER_IMAGE_COORDINATOR_ID = 'super-image-coordinator';
const SUPER_IMAGE_POOL_ID = 'super-image-processing-pool';

interface SuperWatermarkOptions {
  enabled: boolean;
  selectionPreset?: WatermarkSelectionPreset | null;
}

interface RunFrameSuperExportOptions {
  videos: File[];
  timestamps: ParsedTimestamp[];
  format: 'jpeg' | 'png';
  jpegQuality: number;
  videoSettings: VideoSettings;
  splitterDefaults: SplitterDefaults;
  imagesPerVideo: number;
  sharedRegion?: SplitterSharedRegion | null;
  watermarkRemoval?: SuperWatermarkOptions;
  thumbnail?: SuperExportThumbnailOptions;
  onProgress?: (progress: SuperExportProgress) => void;
}

interface RunFrameSuperImageExportOptions {
  videos: File[];
  timestamps: ParsedTimestamp[];
  format: 'jpeg' | 'png';
  jpegQuality: number;
  splitterDefaults: SplitterDefaults;
  outputMode: SuperImageExportMode;
  targetDirectory?: FileSystemDirectoryHandle | null;
  sharedRegion?: SplitterSharedRegion | null;
  watermarkRemoval?: SuperWatermarkOptions;
  onProgress?: (progress: SuperExportProgress) => void;
}

interface RenderSuperExportThumbnailPreviewOptions {
  video: File;
  timestamp: ParsedTimestamp;
  format: 'jpeg' | 'png';
  jpegQuality: number;
  videoSettings: VideoSettings;
  sharedRegion?: SplitterSharedRegion | null;
  thumbnail: SuperExportThumbnailOptions;
  watermarkRemoval?: SuperWatermarkOptions;
  signal?: AbortSignal;
}

export interface SuperExportThumbnailOptions {
  enabled: boolean;
  exportMode: SuperExportThumbnailExportMode;
  stylePreset: SuperExportThumbnailStylePresetId;
  title: string;
  subtitle: string;
  badgeLabel: string;
  textScale: number;
  textOffsetX: number;
  textOffsetY: number;
}

interface CollectedExactPuzzleResult<TPuzzle> {
  extractionSummary: ExtractFramesSummary;
  extractedFrameCount: number;
  processedFrameCount: number;
  validPuzzles: TPuzzle[];
  warnings: string[];
}

type CollectedExactCanvasPuzzleResult = CollectedExactPuzzleResult<CanvasPuzzle>;
type CollectedExactBinaryPuzzleResult = CollectedExactPuzzleResult<BinaryRenderablePuzzle>;

interface CanvasSplitResult {
  baseName: string;
  imageA: HTMLCanvasElement;
  imageB: HTMLCanvasElement;
}

interface CanvasPuzzle {
  imageA: HTMLCanvasElement;
  imageB: HTMLCanvasElement;
  regions: Region[];
  title: string;
}

const splitAutoDefault: DifferenceDetectionOptions = {
  diffThreshold: 70,
  dilationPasses: 2,
  minAreaRatio: 0.0002,
  mergeDistancePx: 5,
  blurRadius: 1.5,
  borderIgnoreRatio: 0.08,
  maxRegionAreaRatio: 0.25,
  maxRegions: 10,
  regionPaddingPx: 4
};

const splitAutoSensitive: DifferenceDetectionOptions = {
  diffThreshold: 52,
  dilationPasses: 2,
  minAreaRatio: 0.00015,
  mergeDistancePx: 5,
  blurRadius: 1,
  borderIgnoreRatio: 0.08,
  maxRegionAreaRatio: 0.3,
  maxRegions: 12,
  regionPaddingPx: 3
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const PROCESSING_PROGRESS_END = 0.72;
const PACKAGING_PROGRESS_START = PROCESSING_PROGRESS_END;
const PACKAGING_PROGRESS_END = 0.92;
const CLEANING_PROGRESS_END = 0.84;
const SUPER_IMAGE_HIGH_WATERMARK_BYTES = 96 * 1024 * 1024;
const SUPER_IMAGE_LOW_WATERMARK_BYTES = 48 * 1024 * 1024;

const createSuperImageExportJob = () =>
  import.meta.env.DEV ? mediaDiagnosticsStore.startJob('super_image_export', 'Super Image Export') : null;
const createSuperExportJob = () =>
  import.meta.env.DEV ? mediaDiagnosticsStore.startJob('super_video_export', 'Super Video Export') : null;
const createSuperImageExportCancellationError = () => new Error('Super Image export canceled.');
const isSuperImageExportCancellationError = (error: unknown) =>
  error instanceof Error && error.message === 'Super Image export canceled.';
const createSuperExportCancellationError = () => new Error('Super Export canceled.');
const isSuperExportCancellationError = (error: unknown) =>
  error instanceof Error && error.message === 'Super Export canceled.';
const sanitizePrefix = (value: string) => {
  const cleaned = value.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '').replace(/\s+/g, '');
  return cleaned || 'puzzle';
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

type DirectoryPicker = (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;

const getDirectoryPicker = (): DirectoryPicker | null => {
  if (typeof window === 'undefined') return null;
  return (window as Window & { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker ?? null;
};

const supportsDirectoryExport = () => Boolean(getDirectoryPicker());
const supportsWritableStreamExport = () => typeof WritableStream !== 'undefined';
const canUseSuperVideoDirectoryExport = () => supportsDirectoryExport() && supportsWritableStreamExport();

export const canUseSuperImageDirectoryExport = () => supportsDirectoryExport();

const createDirectoryWritable = async (
  directory: FileSystemDirectoryHandle,
  filename: string
): Promise<FileSystemWritableFileStream> => {
  const fileHandle = await directory.getFileHandle(filename, { create: true });
  return await fileHandle.createWritable();
};

const writeBlobToDirectory = async (
  directory: FileSystemDirectoryHandle,
  filename: string,
  blob: Blob
) => {
  const writable = await createDirectoryWritable(directory, filename);
  try {
    await writable.write(blob);
  } finally {
    await writable.close();
  }
};

const openOutputDirectory = async (
  rootFolderName: string,
  cancelMessage: string
): Promise<FileSystemDirectoryHandle | null> => {
  const picker = getDirectoryPicker();
  if (!picker) return null;

  try {
    const baseDirectory = await picker({ mode: 'readwrite' });
    return await baseDirectory.getDirectoryHandle(rootFolderName, { create: true });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(cancelMessage);
    }
    throw error;
  }
};

const getSuperImageRootFolderName = (splitterDefaults: SplitterDefaults) =>
  `${sanitizePrefix(splitterDefaults.filenamePrefix)}-super-image`;

const getSuperExportRootFolderName = (splitterDefaults: SplitterDefaults) =>
  `${sanitizePrefix(splitterDefaults.filenamePrefix)}-super-export`;

export const requestSuperImageOutputDirectory = async (
  splitterDefaults: SplitterDefaults
): Promise<FileSystemDirectoryHandle | null> => {
  return await openOutputDirectory(
    getSuperImageRootFolderName(splitterDefaults),
    'Super Image export canceled during folder selection.'
  );
};

const requestSuperExportOutputDirectory = async (
  splitterDefaults: SplitterDefaults
): Promise<FileSystemDirectoryHandle | null> =>
  await openOutputDirectory(getSuperExportRootFolderName(splitterDefaults), createSuperExportCancellationError().message);

const supportsSuperImageProcessorPool = () =>
  typeof Worker !== 'undefined' &&
  typeof OffscreenCanvas !== 'undefined' &&
  typeof createImageBitmap === 'function';

const sanitizeRegions = (regions: Region[]): Region[] =>
  regions.filter((region) => {
    if (region.width <= 0 || region.height <= 0) return false;
    if (region.width < 0.004 || region.height < 0.004) return false;
    if (region.width > 0.95 || region.height > 0.95) return false;
    if (region.width * region.height > 0.35) return false;
    return true;
  });

const stripExtension = (filename: string) => filename.replace(/\.[^/.]+$/, '');

const mapProgress = (ratio: number, start: number, end: number) =>
  start + clamp(ratio, 0, 1) * (end - start);

const buildBaseResult = <TPuzzle,>(processed: CollectedExactPuzzleResult<TPuzzle>): SuperBaseResult => ({
  extractionSummary: processed.extractionSummary,
  extractedFrameCount: processed.extractedFrameCount,
  processedFrameCount: processed.processedFrameCount,
  validPuzzleCount: processed.validPuzzles.length,
  discardedFrameCount: Math.max(0, processed.processedFrameCount - processed.validPuzzles.length),
  warnings: processed.warnings
});

const shuffleArray = <T,>(items: T[]) => {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
};

const chunkArray = <T,>(items: T[], size: number) => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const getVideoExtension = (codec: VideoSettings['exportCodec']) => (codec === 'h264' ? 'mp4' : 'webm');

const buildImageFilename = (
  sequence: number,
  splitterDefaults: SplitterDefaults,
  isDiff: boolean
) => {
  const prefix = sanitizePrefix(splitterDefaults.filenamePrefix);
  const padDigits = Math.max(0, Math.floor(splitterDefaults.filenamePadDigits || 0));
  const serial = padDigits > 0 ? String(sequence).padStart(padDigits, '0') : String(sequence);
  return `${prefix}${serial}${isDiff ? 'diff' : ''}.png`;
};

const buildImageFilenames = (sequence: number, splitterDefaults: SplitterDefaults) => ({
  puzzleFilename: buildImageFilename(sequence, splitterDefaults, false),
  diffFilename: buildImageFilename(sequence, splitterDefaults, true)
});

const buildBatchVideoFilename = (
  settings: VideoSettings,
  splitterDefaults: SplitterDefaults,
  batchIndex: number,
  totalBatches: number,
  puzzleCount: number
) => {
  const prefix = sanitizePrefix(splitterDefaults.filenamePrefix);
  const padDigits = Math.max(2, Math.floor(splitterDefaults.filenamePadDigits || 0));
  const batchLabel = String(batchIndex + 1).padStart(padDigits, '0');
  const totalLabel = String(totalBatches).padStart(padDigits, '0');
  return `${prefix}-super-export-${batchLabel}-of-${totalLabel}-${puzzleCount}puzzles-${settings.aspectRatio.replace(':', 'x')}-${settings.exportResolution}.${getVideoExtension(
    settings.exportCodec
  )}`;
};

const buildBatchThumbnailFilename = (videoFilename: string) => {
  const extensionIndex = videoFilename.lastIndexOf('.');
  const baseName = extensionIndex > 0 ? videoFilename.slice(0, extensionIndex) : videoFilename;
  return `${baseName}-thumbnail.png`;
};

const buildSuperExportThumbnailSettings = (
  settings: VideoSettings,
  thumbnail: SuperExportThumbnailOptions
): VideoSettings => {
  const styledSettings = applySuperExportThumbnailStylePreset(settings, thumbnail.stylePreset);
  return {
    ...styledSettings,
    introVideoEnabled: false,
    introVideoSrc: '',
    introVideoDuration: 0,
    showTimer: false,
    showProgress: false,
    sceneSettings: {
      ...styledSettings.sceneSettings,
      introEnabled: false,
      outroEnabled: false
    },
    textTemplates: {
      ...styledSettings.textTemplates,
      playTitle: thumbnail.title,
      playSubtitle: thumbnail.subtitle,
      puzzleBadgeLabel: thumbnail.badgeLabel
    },
    headerTextOverrides: {
      scale: thumbnail.textScale,
      offsetX: thumbnail.textOffsetX,
      offsetY: thumbnail.textOffsetY
    }
  };
};

const shouldExportSuperThumbnails = (thumbnail?: SuperExportThumbnailOptions | null) =>
  Boolean(thumbnail?.enabled);

const shouldExportSuperVideos = (thumbnail?: SuperExportThumbnailOptions | null) =>
  !thumbnail?.enabled || thumbnail.exportMode === 'with_video';

const shouldSerializeSuperVideoBatches = (settings: VideoSettings, thumbnail?: SuperExportThumbnailOptions | null) =>
  shouldExportSuperVideos(thumbnail) && settings.introVideoEnabled && Boolean(settings.introVideoSrc);

const resolveSuperExportOutputMode = (
  thumbnail?: SuperExportThumbnailOptions | null
): SuperExportOutputMode => {
  const exportVideos = shouldExportSuperVideos(thumbnail);
  const exportThumbnails = shouldExportSuperThumbnails(thumbnail);
  if (exportVideos && exportThumbnails) return 'videos_and_thumbnails';
  if (exportThumbnails) return 'thumbnails_only';
  return 'videos_only';
};

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw new DOMException('Preview canceled', 'AbortError');
  }
};

const buildSuperImageZipFilename = (splitterDefaults: SplitterDefaults, puzzleCount: number) => {
  const prefix = sanitizePrefix(splitterDefaults.filenamePrefix);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${prefix}-super-image-${puzzleCount}puzzle${puzzleCount === 1 ? '' : 's'}-${stamp}.zip`;
};

const readBlobImageSize = async (blob: Blob): Promise<{ width: number; height: number }> => {
  try {
    return await readRuntimeBlobImageDimensions(blob);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown image decoding error.';
    throw new Error(`Failed to decode the extracted frame image. ${message}`);
  }
};

const canvasToPngBlob = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Failed to encode image as PNG'));
        return;
      }
      resolve(blob);
    }, 'image/png');
  });

const releaseCanvas = (canvas: HTMLCanvasElement | null | undefined) => {
  if (!canvas) return;
  const context = canvas.getContext('2d');
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
  }
  canvas.width = 1;
  canvas.height = 1;
};

const releaseCanvases = (...canvases: Array<HTMLCanvasElement | null | undefined>) => {
  const seen = new Set<HTMLCanvasElement>();
  canvases.forEach((canvas) => {
    if (!canvas || seen.has(canvas)) {
      return;
    }
    seen.add(canvas);
    releaseCanvas(canvas);
  });
};

const releaseProcessedCanvasResult = (
  result: ProcessedPuzzleCanvasData | null | undefined,
  originalA: HTMLCanvasElement,
  originalB: HTMLCanvasElement
) => {
  if (!result) return;
  releaseCanvases(
    result.imageA !== originalA && result.imageA !== originalB ? result.imageA : null,
    result.imageB !== originalA && result.imageB !== originalB ? result.imageB : null
  );
};

const readImageSize = (src: string): Promise<{ width: number; height: number }> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () =>
      resolve({
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height
      });
    image.onerror = () => reject(new Error('Failed to load image metadata'));
    image.src = src;
  });

const clampRegionSelection = (
  region: SplitterSharedRegion,
  sourceWidth: number,
  sourceHeight: number
) => {
  const maxWidth = Math.max(1, Math.floor(sourceWidth));
  const maxHeight = Math.max(1, Math.floor(sourceHeight));
  const x = clamp(Math.floor(region.x * sourceWidth), 0, maxWidth - 1);
  const y = clamp(Math.floor(region.y * sourceHeight), 0, maxHeight - 1);
  const right = clamp(Math.ceil((region.x + region.width) * sourceWidth), x + 1, maxWidth);
  const bottom = clamp(Math.ceil((region.y + region.height) * sourceHeight), y + 1, maxHeight);

  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y)
  };
};

const resolveFrameSplitToCanvases = async (
  frameBlob: Blob,
  frameFilename: string,
  sharedRegion?: SplitterSharedRegion | null
): Promise<CanvasSplitResult> => {
  const baseName = stripExtension(frameFilename);
  if (!sharedRegion) {
    const split = await splitCombinedBlobSmartToCanvas(frameBlob);
    return {
      baseName,
      imageA: split.imageA,
      imageB: split.imageB
    };
  }

  try {
    const { width, height } = await readBlobImageSize(frameBlob);
    const splitSelection = clampRegionSelection(sharedRegion, width, height);
    const split = await splitCombinedBlobFromSelectionToCanvas(frameBlob, splitSelection);

    return {
      baseName,
      imageA: split.imageA,
      imageB: split.imageB
    };
  } catch {
    const frameFile = new File([frameBlob], frameFilename, {
      type: frameBlob.type || 'image/png',
      lastModified: Date.now()
    });
    const split = await splitCombinedFileSmartToCanvas(frameFile);
    return {
      baseName,
      imageA: split.imageA,
      imageB: split.imageB
    };
  }
};

const processExactThreeDifferencePuzzleCanvases = async (
  imageA: HTMLCanvasElement,
  imageB: HTMLCanvasElement,
  title: string
): Promise<CanvasPuzzle | null> => {
  const defaultResult = await detectDifferencesClientSideCanvases(imageA, imageB, splitAutoDefault);
  const defaultRegions = sanitizeRegions(defaultResult.regions);
  if (defaultRegions.length === 3) {
    return {
      imageA: defaultResult.imageA,
      imageB: defaultResult.imageB,
      regions: defaultRegions,
      title
    };
  }

  releaseProcessedCanvasResult(defaultResult, imageA, imageB);

  const sensitiveResult = await detectDifferencesClientSideCanvases(imageA, imageB, splitAutoSensitive);
  const sensitiveRegions = sanitizeRegions(sensitiveResult.regions);
  if (sensitiveRegions.length === 3) {
    return {
      imageA: sensitiveResult.imageA,
      imageB: sensitiveResult.imageB,
      regions: sensitiveRegions,
      title
    };
  }

  releaseProcessedCanvasResult(sensitiveResult, imageA, imageB);
  return null;
};

const applyWatermarkRemovalToCanvasPuzzle = async (
  puzzle: CanvasPuzzle,
  selectionPreset?: WatermarkSelectionPreset | null
): Promise<{ imageA: HTMLCanvasElement; imageB: HTMLCanvasElement; applied: boolean }> => {
  if (selectionPreset) {
    const scaledRegionsA = scaleWatermarkRegions(
      selectionPreset.regionsA,
      selectionPreset.sourceWidth,
      selectionPreset.sourceHeight,
      puzzle.imageA.width,
      puzzle.imageA.height
    );
    const scaledRegionsB = scaleWatermarkRegions(
      selectionPreset.regionsB,
      selectionPreset.sourceWidth,
      selectionPreset.sourceHeight,
      puzzle.imageB.width,
      puzzle.imageB.height
    );
    const cleaned = await removeWatermarkWithRegions(
      puzzle.imageA,
      puzzle.imageB,
      scaledRegionsA,
      scaledRegionsB
    );

    return {
      imageA: cleaned.imageA,
      imageB: cleaned.imageB,
      applied: true
    };
  }

  const cleaned = await removeWatermark(puzzle.imageA, puzzle.imageB);
  return {
    imageA: cleaned.imageA,
    imageB: cleaned.imageB,
    applied: true
  };
};

const releaseCanvasPuzzle = (puzzle: CanvasPuzzle | null | undefined) => {
  if (!puzzle) return;
  releaseCanvases(puzzle.imageA, puzzle.imageB);
};

const convertCanvasPuzzleToCompatibilityPuzzle = async (
  puzzle: CanvasPuzzle
): Promise<Puzzle> => {
  // Compatibility boundary: the editor/video pipeline still expects string-backed puzzle images.
  const [imageA, imageB] = await Promise.all([
    canvasToDataUrl(puzzle.imageA, 'image/png'),
    canvasToDataUrl(puzzle.imageB, 'image/png')
  ]);

  return {
    imageA,
    imageB,
    regions: puzzle.regions,
    title: puzzle.title
  };
};

const collectExactThreeDifferencePuzzles = async ({
  videos,
  timestamps,
  format,
  jpegQuality,
  sharedRegion,
  onProgress
}: {
  videos: File[];
  timestamps: ParsedTimestamp[];
  format: 'jpeg' | 'png';
  jpegQuality: number;
  sharedRegion?: SplitterSharedRegion | null;
  onProgress?: (progress: SuperExportProgress) => void;
}): Promise<CollectedExactCanvasPuzzleResult> => {
  const extracted = await extractFrames({
    videos,
    timestamps,
    format,
    jpegQuality,
    onProgress: (progress) => {
      const ratio = progress.total > 0 ? progress.completed / progress.total : 0;
      onProgress?.({
        stage: 'extracting',
        progress: mapProgress(ratio, 0, 0.3),
        label: `Extracting frame ${progress.completed}/${progress.total}`
      });
    }
  });

  const warnings = [...extracted.summary.warnings];
  const validPuzzles: CanvasPuzzle[] = [];

  for (let index = 0; index < extracted.files.length; index += 1) {
    const item = extracted.files[index];
    let split: CanvasSplitResult | null = null;
    let puzzle: CanvasPuzzle | null = null;
    onProgress?.({
      stage: 'processing',
      progress: mapProgress((index + 1) / Math.max(1, extracted.files.length), 0.3, PROCESSING_PROGRESS_END),
      label: `Processing frame ${index + 1}/${extracted.files.length}`
    });

    try {
      split = await resolveFrameSplitToCanvases(item.blob, item.filename, sharedRegion);
      const title = stripExtension(split.baseName || item.filename);
      puzzle = await processExactThreeDifferencePuzzleCanvases(split.imageA, split.imageB, title);
      if (puzzle) {
        validPuzzles.push(puzzle);
        split = null;
        puzzle = null;
      } else {
        warnings.push(`${item.filename}: skipped (did not resolve to exactly 3 differences).`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown split/processing error.';
      warnings.push(`${item.filename}: failed during split/processing (${message})`);
    } finally {
      releaseCanvases(split?.imageA, split?.imageB, puzzle?.imageA, puzzle?.imageB);
    }
  }

  return {
    extractionSummary: extracted.summary,
    extractedFrameCount: extracted.files.length,
    processedFrameCount: extracted.files.length,
    validPuzzles,
    warnings
  };
};

const streamExactThreeDifferencePuzzlesToFolder = async ({
  videos,
  timestamps,
  format,
  jpegQuality,
  splitterDefaults,
  targetDirectory,
  sharedRegion,
  watermarkRemoval,
  onProgress
}: {
  videos: File[];
  timestamps: ParsedTimestamp[];
  format: 'jpeg' | 'png';
  jpegQuality: number;
  splitterDefaults: SplitterDefaults;
  targetDirectory: FileSystemDirectoryHandle;
  sharedRegion?: SplitterSharedRegion | null;
  watermarkRemoval?: SuperWatermarkOptions;
  onProgress?: (progress: SuperExportProgress) => void;
}): Promise<SuperImageExportResult> => {
  const rootFolderName = `${sanitizePrefix(splitterDefaults.filenamePrefix)}-super-image`;
  const warnings: string[] = [];
  const manifest: Array<{
    sequence: number;
    title: string;
    diffCount: number;
    puzzleFilename: string;
    diffFilename: string;
  }> = [];
  const totalRequests = Math.max(1, videos.length * timestamps.length);
  const watermarkEnabled = Boolean(watermarkRemoval?.enabled);
  const watermarkPresetName = watermarkRemoval?.selectionPreset?.name ?? null;
  let processedFrameCount = 0;
  let exportedImagePairCount = 0;
  let watermarkPairsCleaned = 0;
  let lastProgress = 0;

  const emitProgress = (stage: SuperProcessingStage, progress: number, label: string) => {
    const safeProgress = Math.max(lastProgress, clamp(progress, 0, 1));
    lastProgress = safeProgress;
    onProgress?.({
      stage,
      progress: safeProgress,
      label
    });
  };

  const extractionSummary = await extractFramesStream({
    videos,
    timestamps,
    format,
    jpegQuality,
    onProgress: (progress) => {
      const ratio = progress.total > 0 ? progress.completed / progress.total : 0;
      emitProgress(
        'extracting',
        mapProgress(ratio, 0, 0.28),
        `Extracting frame ${progress.completed}/${progress.total}`
      );
    },
    onFrame: async (item) => {
      processedFrameCount += 1;
      emitProgress(
        'processing',
        mapProgress(processedFrameCount / totalRequests, 0.28, watermarkEnabled ? 0.72 : 0.9),
        `Processing frame ${processedFrameCount}/${totalRequests}`
      );

      let split: CanvasSplitResult | null = null;
      let puzzle: CanvasPuzzle | null = null;
      let outputImageA: HTMLCanvasElement | null = null;
      let outputImageB: HTMLCanvasElement | null = null;

      try {
        split = await resolveFrameSplitToCanvases(item.blob, item.filename, sharedRegion);
        const title = stripExtension(split.baseName || item.filename);
        puzzle = await processExactThreeDifferencePuzzleCanvases(split.imageA, split.imageB, title);

        if (!puzzle) {
          warnings.push(`${item.filename}: skipped (did not resolve to exactly 3 differences).`);
          return;
        }

        const sequence = exportedImagePairCount + 1;
        const filenames = buildImageFilenames(sequence, splitterDefaults);
        outputImageA = puzzle.imageA;
        outputImageB = puzzle.imageB;

        if (watermarkEnabled) {
          emitProgress(
            'cleaning',
            mapProgress(processedFrameCount / totalRequests, 0.72, 0.9),
            `Removing watermark ${sequence}`
          );

          try {
            const cleaned = await applyWatermarkRemovalToCanvasPuzzle(
              puzzle,
              watermarkRemoval?.selectionPreset ?? null
            );
            outputImageA = cleaned.imageA;
            outputImageB = cleaned.imageB;
            if (cleaned.applied) {
              watermarkPairsCleaned += 1;
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown watermark removal error.';
            warnings.push(`${filenames.puzzleFilename}: watermark removal failed (${message})`);
          }
        }

        emitProgress(
          'packaging',
          mapProgress(processedFrameCount / totalRequests, watermarkEnabled ? 0.9 : 0.72, 0.98),
          `Saving image pair ${sequence}`
        );

        const puzzleBlob = await canvasToPngBlob(outputImageA);
        await writeBlobToDirectory(targetDirectory, filenames.puzzleFilename, puzzleBlob);
        const diffBlob = await canvasToPngBlob(outputImageB);
        await writeBlobToDirectory(targetDirectory, filenames.diffFilename, diffBlob);

        manifest.push({
          sequence,
          title: puzzle.title || `Puzzle ${sequence}`,
          diffCount: puzzle.regions.length,
          puzzleFilename: filenames.puzzleFilename,
          diffFilename: filenames.diffFilename
        });
        exportedImagePairCount += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown split/processing error.';
        warnings.push(`${item.filename}: failed during split/processing (${message})`);
      } finally {
        releaseCanvases(
          split?.imageA,
          split?.imageB,
          puzzle?.imageA,
          puzzle?.imageB,
          outputImageA,
          outputImageB
        );
      }
    }
  });

  const manifestContent = JSON.stringify(
    {
      totalPuzzles: manifest.length,
      generatedAt: new Date().toISOString(),
      puzzles: manifest
    },
    null,
    2
  );

  await writeBlobToDirectory(
    targetDirectory,
    'manifest.json',
    new Blob([manifestContent], { type: 'application/json' })
  );

  emitProgress('packaging', 1, `Saved folder ${rootFolderName}`);

  return {
    extractionSummary,
    extractedFrameCount: extractionSummary.extractedCount,
    processedFrameCount,
    validPuzzleCount: exportedImagePairCount,
    discardedFrameCount: Math.max(0, processedFrameCount - exportedImagePairCount),
    warnings: [...extractionSummary.warnings, ...warnings],
    exportedImagePairCount,
    outputMode: 'folder',
    outputName: rootFolderName,
    watermarkRemovalEnabled: watermarkEnabled,
    watermarkPairsCleaned,
    watermarkPresetName
  };
};

const runFrameSuperExportOnMainThread = async ({
  videos,
  timestamps,
  format,
  jpegQuality,
  videoSettings,
  splitterDefaults,
  imagesPerVideo,
  sharedRegion,
  watermarkRemoval,
  thumbnail,
  onProgress
}: RunFrameSuperExportOptions): Promise<SuperExportResult> => {
  const exportMode = resolveSuperExportOutputMode(thumbnail);
  const exportVideos = shouldExportSuperVideos(thumbnail);
  const exportThumbnails = shouldExportSuperThumbnails(thumbnail);
  const targetDirectory = (exportVideos ? canUseSuperVideoDirectoryExport() : supportsDirectoryExport())
    ? await requestSuperExportOutputDirectory(splitterDefaults)
    : null;
  const processed = await collectExactThreeDifferencePuzzles({
    videos,
    timestamps,
    format,
    jpegQuality,
    sharedRegion,
    onProgress
  });
  const watermarkEnabled = Boolean(watermarkRemoval?.enabled);
  const thumbnailEnabled = exportThumbnails;
  const watermarkPresetName = watermarkRemoval?.selectionPreset?.name ?? null;
  let watermarkPairsCleaned = 0;
  let exportedThumbnailCount = 0;
  let cleanedPuzzles = processed.validPuzzles;
  try {
    if (watermarkEnabled && processed.validPuzzles.length > 0) {
      const nextPuzzles: CanvasPuzzle[] = [];

      for (let index = 0; index < processed.validPuzzles.length; index += 1) {
        const puzzle = processed.validPuzzles[index];
        const sequence = index + 1;
        const labelName = puzzle.title?.trim() || `Puzzle ${sequence}`;

        onProgress?.({
          stage: 'cleaning',
          progress: mapProgress(
            sequence / Math.max(1, processed.validPuzzles.length),
            PROCESSING_PROGRESS_END,
            CLEANING_PROGRESS_END
          ),
          label: `Removing watermark ${sequence}/${processed.validPuzzles.length}: ${labelName}`
        });

        try {
          const cleaned = await applyWatermarkRemovalToCanvasPuzzle(
            puzzle,
            watermarkRemoval?.selectionPreset ?? null
          );
          nextPuzzles.push({
            ...puzzle,
            imageA: cleaned.imageA,
            imageB: cleaned.imageB
          });
          if (cleaned.applied) {
            watermarkPairsCleaned += 1;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown watermark removal error.';
          processed.warnings.push(`${labelName}: watermark removal failed (${message})`);
          nextPuzzles.push(puzzle);
        }
      }

      cleanedPuzzles = nextPuzzles;
    }

    const randomizedPuzzles = shuffleArray(cleanedPuzzles);
    const batches = chunkArray(randomizedPuzzles, Math.max(1, imagesPerVideo));
    const thumbnailSettings = exportThumbnails && thumbnail
      ? buildSuperExportThumbnailSettings(videoSettings, thumbnail)
      : null;

    for (let index = 0; index < batches.length; index += 1) {
      const canvasBatch = batches[index];
      const exportStart = watermarkEnabled ? CLEANING_PROGRESS_END : PROCESSING_PROGRESS_END;
      const batchStart = exportStart + (index / Math.max(1, batches.length)) * (1 - exportStart);
      const batchEnd = exportStart + ((index + 1) / Math.max(1, batches.length)) * (1 - exportStart);
      const outputFileName = buildBatchVideoFilename(
        videoSettings,
        splitterDefaults,
        index,
        batches.length,
        canvasBatch.length
      );
      const compatibilityBatch = await Promise.all(
        canvasBatch.map((puzzle) => convertCanvasPuzzleToCompatibilityPuzzle(puzzle))
      );
      const thumbnailFileName = buildBatchThumbnailFilename(outputFileName);

      if (exportThumbnails && thumbnailSettings) {
        onProgress?.({
          stage: 'exporting',
          progress: mapProgress(exportVideos ? 0.12 : 0.9, batchStart, batchEnd),
          label: `Rendering thumbnail ${index + 1}/${batches.length}`
        });
        const renderedThumbnail = await renderVideoFramePreview({
          puzzles: compatibilityBatch,
          settings: thumbnailSettings,
          timestamp: 0
        });
        if (targetDirectory) {
          await writeBlobToDirectory(targetDirectory, thumbnailFileName, renderedThumbnail.blob);
        } else {
          triggerBlobDownload(renderedThumbnail.blob, thumbnailFileName);
          await delay(80);
        }
        exportedThumbnailCount += 1;
        if (!exportVideos) {
          onProgress?.({
            stage: 'exporting',
            progress: batchEnd,
            label: `Exported thumbnail ${index + 1}/${batches.length}`
          });
        }
      }

      if (exportVideos && targetDirectory) {
        const writable = await createDirectoryWritable(targetDirectory, outputFileName);
        await streamVideoToWritableWithWebCodecs({
          puzzles: compatibilityBatch,
          settings: videoSettings,
          writable,
          onProgress: (progress, label) => {
            onProgress?.({
              stage: 'exporting',
              progress: mapProgress(exportThumbnails ? 0.18 + progress * 0.82 : progress, batchStart, batchEnd),
              label:
                label ||
                `Exporting video ${index + 1}/${batches.length} (${compatibilityBatch.length} puzzle${
                  compatibilityBatch.length === 1 ? '' : 's'
                })`
            });
          }
        });
      } else if (exportVideos) {
        const rendered = await renderVideoWithWebCodecs({
          puzzles: compatibilityBatch,
          settings: videoSettings,
          onProgress: (progress, label) => {
            onProgress?.({
              stage: 'exporting',
              progress: mapProgress(exportThumbnails ? 0.18 + progress * 0.82 : progress, batchStart, batchEnd),
              label:
                label ||
                `Exporting video ${index + 1}/${batches.length} (${compatibilityBatch.length} puzzle${
                  compatibilityBatch.length === 1 ? '' : 's'
                })`
            });
          }
        });

        triggerBlobDownload(rendered.blob, outputFileName);
        await delay(120);
      }

      canvasBatch.forEach((puzzle) => releaseCanvasPuzzle(puzzle));
    }

    return {
      ...buildBaseResult(processed),
      exportMode,
      exportedVideoCount: exportVideos ? batches.length : 0,
      exportedThumbnailCount,
      batchSizes: batches.map((batch) => batch.length),
      imagesPerVideo: Math.max(1, imagesPerVideo),
      thumbnailEnabled: exportThumbnails,
      watermarkRemovalEnabled: watermarkEnabled,
      watermarkPairsCleaned,
      watermarkPresetName
    };
  } finally {
    cleanedPuzzles.forEach((puzzle) => releaseCanvasPuzzle(puzzle));
  }
};

const convertProcessorPayloadToBinaryPuzzle = (
  payload: Extract<SuperImageProcessorResultPayload, { kind: 'success' }>
): BinaryRenderablePuzzle => ({
  imageABuffer: payload.puzzleBuffer,
  imageBBuffer: payload.diffBuffer,
  mimeType: payload.mimeType || 'image/png',
  regions: payload.regions,
  title: payload.title
});

const estimateBinaryRenderablePuzzleBytes = (puzzle: BinaryRenderablePuzzle) =>
  puzzle.imageABuffer.byteLength + puzzle.imageBBuffer.byteLength;

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Failed to convert image blob to data URL.'));
    reader.readAsDataURL(blob);
  });

const convertBinaryPuzzleToCompatibilityPuzzle = async (
  puzzle: BinaryRenderablePuzzle
): Promise<Puzzle> => {
  const mimeType = puzzle.mimeType || 'image/png';
  const [imageA, imageB] = await Promise.all([
    blobToDataUrl(new Blob([puzzle.imageABuffer], { type: mimeType })),
    blobToDataUrl(new Blob([puzzle.imageBBuffer], { type: mimeType }))
  ]);

  return {
    imageA,
    imageB,
    regions: puzzle.regions,
    title: puzzle.title
  };
};

const isLikelyDecodeError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /decode|codec|imagebitmap|imagedecoder|source image could not be decoded|failed to decode image data/i.test(
    message
  );
};

const collectExactThreeDifferenceBinaryPuzzlesWithSharedPool = async ({
  videos,
  timestamps,
  format,
  jpegQuality,
  sharedRegion,
  watermarkRemoval,
  onProgress,
  abortController,
  job
}: {
  videos: File[];
  timestamps: ParsedTimestamp[];
  format: 'jpeg' | 'png';
  jpegQuality: number;
  sharedRegion?: SplitterSharedRegion | null;
  watermarkRemoval?: SuperWatermarkOptions;
  onProgress?: (progress: SuperExportProgress) => void;
  abortController: AbortController;
  job: MediaJobController | null;
}): Promise<{
  processed: CollectedExactBinaryPuzzleResult;
  watermarkPairsCleaned: number;
  retainedOutputBytes: number;
}> => {
  const warnings: string[] = [];
  const validPuzzles: BinaryRenderablePuzzle[] = [];
  const watermarkEnabled = Boolean(watermarkRemoval?.enabled);
  const totalRequests = Math.max(1, videos.length * timestamps.length);
  const pool = acquireSuperImageProcessingPool();
  let extractionSummary: ExtractFramesSummary | null = null;
  let processedFrameCount = 0;
  let watermarkPairsCleaned = 0;
  let nextFrameOrder = 1;
  let nextCommitOrder = 1;
  let lastProgress = 0;
  let isFlushingCommittedFrames = false;
  let queueBytesInFlight = 0;
  let retainedOutputBytes = 0;
  const orderedFrames = new Map<
    number,
    {
      estimatedBytes: number;
      resolve: () => void;
      reject: (error: Error) => void;
      settled?:
        | { kind: 'resolved'; payload: SuperImageProcessorResultPayload }
        | { kind: 'rejected'; error: Error };
    }
  >();
  const pendingFrameCommits: Promise<void>[] = [];
  const drainWaiters: Array<() => void> = [];
  const jobStartedAt = performance.now();

  const throwIfCanceled = () => {
    if (abortController.signal.aborted) {
      throw createSuperExportCancellationError();
    }
  };

  const maybeResolveDrainWaiters = () => {
    if (queueBytesInFlight > SUPER_IMAGE_LOW_WATERMARK_BYTES) {
      return;
    }
    while (drainWaiters.length > 0) {
      drainWaiters.shift()?.();
    }
  };

  const waitForLowWatermark = async () => {
    if (queueBytesInFlight < SUPER_IMAGE_HIGH_WATERMARK_BYTES) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      if (abortController.signal.aborted) {
        reject(createSuperExportCancellationError());
        return;
      }
      const handleAbort = () => {
        abortController.signal.removeEventListener('abort', handleAbort);
        reject(createSuperExportCancellationError());
      };
      abortController.signal.addEventListener('abort', handleAbort, { once: true });
      drainWaiters.push(() => {
        abortController.signal.removeEventListener('abort', handleAbort);
        resolve();
      });
    });
  };

  const emitProgress = (stage: SuperProcessingStage, progress: number, label: string) => {
    const safeProgress = Math.max(lastProgress, clamp(progress, 0, 1));
    lastProgress = safeProgress;
    onProgress?.({
      stage,
      progress: safeProgress,
      label
    });
    job?.setProgress(safeProgress, label);
  };

  const emitCoordinatorStats = () => {
    if (!job) return;
    const unresolvedFrames = [...orderedFrames.values()].filter((entry) => !entry.settled).length;
    const settledFrames = [...orderedFrames.values()].filter((entry) => entry.settled).length;
    const elapsedSeconds = Math.max(0.001, (performance.now() - jobStartedAt) / 1000);
    job.updateWorkerStats({
      workerId: SUPER_VIDEO_COORDINATOR_ID,
      label: 'Super Video Coordinator',
      runtimeKind: 'coordinator',
      activeWorkers: 1,
      queueSize: unresolvedFrames + settledFrames,
      runningTasks: unresolvedFrames,
      avgTaskMs: 0,
      fps: processedFrameCount / elapsedSeconds,
      bytesInFlight: queueBytesInFlight + retainedOutputBytes,
      stageQueueDepths: {
        decode: queueBytesInFlight >= SUPER_IMAGE_HIGH_WATERMARK_BYTES ? 1 : 0,
        detect: unresolvedFrames + settledFrames,
        render: validPuzzles.length
      },
      metrics: {
        processedFrames: processedFrameCount,
        retainedPuzzles: validPuzzles.length,
        retainedOutputMb: retainedOutputBytes / (1024 * 1024),
        queueMb: queueBytesInFlight / (1024 * 1024)
      }
    });
  };

  const rejectPendingFrames = (error: Error) => {
    orderedFrames.forEach((entry) => entry.reject(error));
    orderedFrames.clear();
    maybeResolveDrainWaiters();
    emitCoordinatorStats();
  };

  const flushCommittedFrames = async () => {
    if (isFlushingCommittedFrames) {
      return;
    }

    isFlushingCommittedFrames = true;
    try {
      while (true) {
        throwIfCanceled();
        const frameEntry = orderedFrames.get(nextCommitOrder);
        if (!frameEntry?.settled) {
          break;
        }

        orderedFrames.delete(nextCommitOrder);
        nextCommitOrder += 1;

        try {
          if (frameEntry.settled.kind === 'rejected') {
            throw frameEntry.settled.error;
          }

          const payload = frameEntry.settled.payload;
          if (payload.kind === 'success') {
            if (payload.watermarkApplied) {
              watermarkPairsCleaned += 1;
            }
            const binaryPuzzle = convertProcessorPayloadToBinaryPuzzle(payload);
            retainedOutputBytes += estimateBinaryRenderablePuzzleBytes(binaryPuzzle);
            validPuzzles.push(binaryPuzzle);
          } else {
            warnings.push(payload.warning);
          }
        } finally {
          queueBytesInFlight = Math.max(0, queueBytesInFlight - frameEntry.estimatedBytes);
          maybeResolveDrainWaiters();
          emitCoordinatorStats();
          frameEntry.resolve();
        }
      }
    } catch (error) {
      const wrappedError =
        error instanceof Error ? error : new Error('Failed to collect Super Video export frames.');
      rejectPendingFrames(wrappedError);
      throw wrappedError;
    } finally {
      isFlushingCommittedFrames = false;
    }
  };

  emitProgress('extracting', 0, 'Preparing Super Export...');
  emitCoordinatorStats();

  extractionSummary = await extractFramesStream({
    videos,
    timestamps,
    format,
    jpegQuality,
    signal: abortController.signal,
    diagnosticsJob: job,
    onProgress: (progress) => {
      throwIfCanceled();
      const ratio = progress.total > 0 ? progress.completed / progress.total : 0;
      emitProgress(
        'extracting',
        mapProgress(ratio, 0, 0.28),
        `Extracting frame ${progress.completed}/${progress.total}`
      );
    },
    onFrame: async (item) => {
      throwIfCanceled();
      processedFrameCount += 1;
      queueBytesInFlight += item.estimatedBytes;
      emitProgress(
        watermarkEnabled ? 'cleaning' : 'processing',
        mapProgress(processedFrameCount / totalRequests, 0.28, watermarkEnabled ? CLEANING_PROGRESS_END : PROCESSING_PROGRESS_END),
        `Processing frame ${processedFrameCount}/${totalRequests}`
      );
      emitCoordinatorStats();

      const frameOrder = nextFrameOrder;
      nextFrameOrder += 1;
      const frameTaskId = `super-video-process:${frameOrder}`;

      const frameCommit = new Promise<void>((resolve, reject) => {
        orderedFrames.set(frameOrder, {
          estimatedBytes: item.estimatedBytes,
          resolve,
          reject
        });
      });
      pendingFrameCommits.push(frameCommit);

      void pool
        .run({
          blob: item.blob,
          filename: item.filename,
          sharedRegion,
          watermarkEnabled,
          watermarkSelectionPreset: watermarkRemoval?.selectionPreset ?? null,
          taskId: frameTaskId,
          taskLabel: `Process frame ${processedFrameCount}`,
          onTaskEvent: (event) => job?.handleTaskEvent(event),
          onStats: (stats) => job?.updateWorkerStats(stats)
        })
        .then((payload) => {
          const frameEntry = orderedFrames.get(frameOrder);
          if (!frameEntry) {
            return;
          }
          frameEntry.settled = {
            kind: 'resolved',
            payload
          };
          emitCoordinatorStats();
          void flushCommittedFrames().catch((error) => {
            rejectPendingFrames(
              error instanceof Error ? error : new Error('Failed to flush Super Video frames.')
            );
          });
        })
        .catch((error) => {
          const frameEntry = orderedFrames.get(frameOrder);
          if (!frameEntry) {
            return;
          }
          frameEntry.settled = {
            kind: 'rejected',
            error: error instanceof Error ? error : new Error('Super Video processor task failed.')
          };
          emitCoordinatorStats();
          void flushCommittedFrames().catch(() => {
            // Pending frame promises are already rejected by rejectPendingFrames.
          });
        });

      if (queueBytesInFlight >= SUPER_IMAGE_HIGH_WATERMARK_BYTES) {
        emitProgress(
          'processing',
          mapProgress(
            processedFrameCount / totalRequests,
            0.28,
            watermarkEnabled ? CLEANING_PROGRESS_END : PROCESSING_PROGRESS_END
          ),
          `Processing queue reached ${Math.round(queueBytesInFlight / (1024 * 1024))} MB. Waiting for drain...`
        );
        await waitForLowWatermark();
      }
    }
  });

  await Promise.all(pendingFrameCommits);
  throwIfCanceled();

  return {
    processed: {
      extractionSummary,
      extractedFrameCount: extractionSummary.extractedCount,
      processedFrameCount,
      validPuzzles,
      warnings: [...extractionSummary.warnings, ...warnings]
    },
    watermarkPairsCleaned,
    retainedOutputBytes
  };
};

const runFrameSuperExportWithSharedPool = async ({
  videos,
  timestamps,
  format,
  jpegQuality,
  videoSettings,
  splitterDefaults,
  imagesPerVideo,
  sharedRegion,
  watermarkRemoval,
  thumbnail,
  onProgress
}: RunFrameSuperExportOptions): Promise<SuperExportResult> => {
  if (activeSuperExportController || activeSuperImageExportController || activeSuperImageExportWorker) {
    throw new Error('Another export is already running.');
  }

  const job = createSuperExportJob();
  const abortController = new AbortController();
  activeSuperExportController = {
    cancel: () => {
      abortController.abort();
      disposeSuperImageProcessingPool();
      cancelVideoExport();
    }
  };

  const emitProgress = (stage: SuperProcessingStage, progress: number, label: string) => {
    onProgress?.({ stage, progress, label });
    job?.setProgress(progress, label);
  };

  try {
    const exportMode = resolveSuperExportOutputMode(thumbnail);
    const exportVideos = shouldExportSuperVideos(thumbnail);
    const exportThumbnails = shouldExportSuperThumbnails(thumbnail);
    const thumbnailEnabled = exportThumbnails;
    const targetDirectory = (exportVideos ? canUseSuperVideoDirectoryExport() : supportsDirectoryExport())
      ? await requestSuperExportOutputDirectory(splitterDefaults)
      : null;
    const { processed, watermarkPairsCleaned } = await collectExactThreeDifferenceBinaryPuzzlesWithSharedPool({
      videos,
      timestamps,
      format,
      jpegQuality,
      sharedRegion,
      watermarkRemoval,
      onProgress,
      abortController,
      job
    });
    disposeSuperImageProcessingPool();
    job?.removeWorkerStats(SUPER_IMAGE_POOL_ID);

    if (processed.validPuzzles.length === 0) {
      const result: SuperExportResult = {
        ...buildBaseResult(processed),
        exportMode,
        exportedVideoCount: 0,
        exportedThumbnailCount: 0,
        batchSizes: [],
        imagesPerVideo: Math.max(1, imagesPerVideo),
        thumbnailEnabled: exportThumbnails,
        watermarkRemovalEnabled: Boolean(watermarkRemoval?.enabled),
        watermarkPairsCleaned,
        watermarkPresetName: watermarkRemoval?.selectionPreset?.name ?? null
      };
      emitProgress('exporting', 1, 'Super Export finished, but no exact 3-difference puzzles were available to export.');
      job?.complete('Super Export finished with no exact 3-difference puzzles');
      return result;
    }

    emitProgress(
      'exporting',
      watermarkRemoval?.enabled ? CLEANING_PROGRESS_END : PROCESSING_PROGRESS_END,
      exportVideos ? 'Preparing export batches...' : 'Preparing thumbnail batches...'
    );

    const batchSize = Math.max(1, imagesPerVideo);
    const thumbnailSettings =
      exportThumbnails && thumbnail ? buildSuperExportThumbnailSettings(videoSettings, thumbnail) : null;
    const randomizedPuzzles = shuffleArray(processed.validPuzzles);
    processed.validPuzzles.length = 0;
    const batches = Array.from({ length: Math.ceil(randomizedPuzzles.length / batchSize) }, (_value, index) => {
      const batch = randomizedPuzzles.slice(index * batchSize, (index + 1) * batchSize);
      return {
        batch,
        batchBytes: batch.reduce((total, puzzle) => total + estimateBinaryRenderablePuzzleBytes(puzzle), 0),
        index
      };
    });
    const totalBatches = batches.length;
    const batchSizes = batches.map(({ batch }) => batch.length);
    const exportStart = watermarkRemoval?.enabled ? CLEANING_PROGRESS_END : PROCESSING_PROGRESS_END;
    const maxBatchConcurrency = shouldSerializeSuperVideoBatches(videoSettings, thumbnail)
      ? 1
      : Math.min(2, Math.max(1, totalBatches));
    const activeBatchStats = new Map<string, { batchBytes: number; puzzleCount: number }>();
    let queuedPuzzles = randomizedPuzzles.length;
    let completedBatches = 0;
    let exportedThumbnailCount = 0;

    const emitCoordinatorStats = () => {
      const activePuzzles = [...activeBatchStats.values()].reduce((sum, batch) => sum + batch.puzzleCount, 0);
      const activeBatchBytes = [...activeBatchStats.values()].reduce((sum, batch) => sum + batch.batchBytes, 0);
      job?.updateWorkerStats({
        workerId: SUPER_VIDEO_COORDINATOR_ID,
        label: 'Super Video Coordinator',
        runtimeKind: 'coordinator',
        activeWorkers: 1,
        queueSize: Math.max(0, queuedPuzzles),
        runningTasks: activeBatchStats.size,
        avgTaskMs: 0,
        bytesInFlight: Math.max(0, activeBatchBytes),
        stageQueueDepths: {
          render: Math.max(0, queuedPuzzles + activePuzzles),
          encode: activeBatchStats.size
        },
        metrics: {
          remainingPuzzles: Math.max(0, queuedPuzzles),
          activeBatches: activeBatchStats.size,
          completedBatches,
          totalBatches
        }
      });
    };

    const batchTasks = batches.map(({ batch, batchBytes, index }) => {
      const taskId = `super-video-batch:${index + 1}`;
      return {
        id: taskId,
        label: `${exportVideos ? 'Super Export' : 'Thumbnail Export'} ${index + 1}/${totalBatches}`,
        weight: Math.max(1, batch.length),
        cancel: () => {
          cancelVideoExport();
        },
        run: async (reportProgress: (progress: number, status?: string) => void) => {
          if (abortController.signal.aborted) {
            throw createSuperExportCancellationError();
          }

          queuedPuzzles = Math.max(0, queuedPuzzles - batch.length);
          activeBatchStats.set(taskId, {
            batchBytes,
            puzzleCount: batch.length
          });
          emitCoordinatorStats();

          let compatibilityBatchPromise: Promise<Puzzle[]> | null = null;
          const getCompatibilityBatch = () => {
            compatibilityBatchPromise ??= Promise.all(batch.map((puzzle) => convertBinaryPuzzleToCompatibilityPuzzle(puzzle)));
            return compatibilityBatchPromise;
          };

          try {
            const outputFileName = buildBatchVideoFilename(
              videoSettings,
              splitterDefaults,
              index,
              totalBatches,
              batch.length
            );
            const thumbnailFileName = buildBatchThumbnailFilename(outputFileName);
            let useCompatibilityFallback = false;
            let thumbnailRendered = false;

            const renderThumbnailBatch = async () => {
              reportProgress(exportVideos ? 0.12 : 0.9, `Rendering thumbnail ${index + 1}/${totalBatches}`);
              const renderedThumbnail = useCompatibilityFallback
                ? await renderVideoFramePreview({
                    puzzles: await getCompatibilityBatch(),
                    settings: thumbnailSettings as VideoSettings,
                    timestamp: 0
                  })
                : await renderVideoFramePreview({
                    source: 'binary',
                    puzzles: batch,
                    settings: thumbnailSettings as VideoSettings,
                    timestamp: 0
                  });
              if (targetDirectory) {
                await writeBlobToDirectory(targetDirectory, thumbnailFileName, renderedThumbnail.blob);
              } else {
                triggerBlobDownload(renderedThumbnail.blob, thumbnailFileName);
                await delay(80);
              }
              exportedThumbnailCount += 1;
              thumbnailRendered = true;
              if (!exportVideos) {
                reportProgress(1, `Exported thumbnail ${index + 1}/${totalBatches}`);
              }
            };

            const renderVideoBatch = async () => {
              if (exportVideos && targetDirectory) {
                const writable = await createDirectoryWritable(targetDirectory, outputFileName);
                await streamVideoToWritableWithWebCodecs(
                  useCompatibilityFallback
                    ? {
                        puzzles: await getCompatibilityBatch(),
                        settings: videoSettings,
                        writable,
                        diagnosticsJob: job,
                        manageDiagnosticsLifecycle: false,
                        onProgress: (progress, label) => {
                          reportProgress(
                            exportThumbnails ? 0.18 + progress * 0.82 : progress,
                            label ||
                              `Exporting video ${index + 1}/${totalBatches} (${batch.length} puzzle${
                                batch.length === 1 ? '' : 's'
                              })`
                          );
                        }
                      }
                    : {
                        source: 'binary',
                        puzzles: batch,
                        settings: videoSettings,
                        writable,
                        diagnosticsJob: job,
                        manageDiagnosticsLifecycle: false,
                        onProgress: (progress, label) => {
                          reportProgress(
                            exportThumbnails ? 0.18 + progress * 0.82 : progress,
                            label ||
                              `Exporting video ${index + 1}/${totalBatches} (${batch.length} puzzle${
                                batch.length === 1 ? '' : 's'
                              })`
                          );
                        }
                      }
                );
                return;
              }

              if (!exportVideos) {
                return;
              }

              const rendered = await renderVideoWithWebCodecs(
                useCompatibilityFallback
                  ? {
                      puzzles: await getCompatibilityBatch(),
                      settings: videoSettings,
                      diagnosticsJob: job,
                      manageDiagnosticsLifecycle: false,
                      onProgress: (progress, label) => {
                        reportProgress(
                          exportThumbnails ? 0.18 + progress * 0.82 : progress,
                          label ||
                            `Exporting video ${index + 1}/${totalBatches} (${batch.length} puzzle${
                              batch.length === 1 ? '' : 's'
                            })`
                        );
                      }
                    }
                  : {
                      source: 'binary',
                      puzzles: batch,
                      settings: videoSettings,
                      diagnosticsJob: job,
                      manageDiagnosticsLifecycle: false,
                      onProgress: (progress, label) => {
                        reportProgress(
                          exportThumbnails ? 0.18 + progress * 0.82 : progress,
                          label ||
                            `Exporting video ${index + 1}/${totalBatches} (${batch.length} puzzle${
                              batch.length === 1 ? '' : 's'
                            })`
                        );
                      }
                    }
              );

              triggerBlobDownload(rendered.blob, outputFileName);
              await delay(120);
            };

            try {
              if (exportThumbnails && thumbnailSettings) {
                await renderThumbnailBatch();
              }
              await renderVideoBatch();
            } catch (error) {
              if (!isLikelyDecodeError(error) || useCompatibilityFallback) {
                throw error;
              }

              useCompatibilityFallback = true;
              reportProgress(
                0.08,
                `Decode fallback for batch ${index + 1}/${totalBatches}. Retrying with compatibility images...`
              );
              if (exportThumbnails && thumbnailSettings && !thumbnailRendered) {
                await renderThumbnailBatch();
              }
              await renderVideoBatch();
            }

            completedBatches += 1;
            return {
              fileName: outputFileName
            };
          } finally {
            activeBatchStats.delete(taskId);
            emitCoordinatorStats();
          }
        }
      };
    });

    emitCoordinatorStats();
    await runBatchExportTasks({
      tasks: batchTasks,
      maxConcurrency: maxBatchConcurrency,
      signal: abortController.signal,
      cancelMessage: createSuperExportCancellationError().message,
      onProgress: (progress, label) => {
        emitProgress(
          'exporting',
          mapProgress(progress, exportStart, 1),
          label || `Exporting ${totalBatches} Super Video batch${totalBatches === 1 ? '' : 'es'}`
        );
      }
    });
    emitCoordinatorStats();

    const result: SuperExportResult = {
      ...buildBaseResult(processed),
      exportMode,
      exportedVideoCount: exportVideos ? totalBatches : 0,
      exportedThumbnailCount,
      batchSizes,
      imagesPerVideo: batchSize,
      thumbnailEnabled: exportThumbnails,
      watermarkRemovalEnabled: Boolean(watermarkRemoval?.enabled),
      watermarkPairsCleaned,
      watermarkPresetName: watermarkRemoval?.selectionPreset?.name ?? null
    };
    emitProgress(
      'exporting',
      1,
      exportVideos
        ? `Exported ${result.exportedVideoCount} video${result.exportedVideoCount === 1 ? '' : 's'}${
            exportThumbnails
              ? ` and ${result.exportedThumbnailCount} thumbnail${result.exportedThumbnailCount === 1 ? '' : 's'}`
              : ''
          }.`
        : `Exported ${result.exportedThumbnailCount} thumbnail${result.exportedThumbnailCount === 1 ? '' : 's'}.`
    );
    job?.complete(
      exportVideos
        ? `Exported ${result.exportedVideoCount} Super Export batch${result.exportedVideoCount === 1 ? '' : 'es'}`
        : `Exported ${result.exportedThumbnailCount} Super Export thumbnail batch${
            result.exportedThumbnailCount === 1 ? '' : 'es'
          }`
    );
    return result;
  } catch (error) {
    if (abortController.signal.aborted || isSuperExportCancellationError(error)) {
      job?.cancel('Super Export canceled');
      throw isSuperExportCancellationError(error) ? error : createSuperExportCancellationError();
    }
    const message = error instanceof Error ? error.message : 'Super Export failed.';
    job?.fail(message, 'Super Export failed');
    throw error instanceof Error ? error : new Error(message);
  } finally {
    activeSuperExportController = null;
    disposeSuperImageProcessingPool();
    job?.removeWorkerStats(SUPER_IMAGE_POOL_ID);
  }
};

export const cancelSuperExport = () => {
  activeSuperExportController?.cancel();
};

export const runFrameSuperExport = async (options: RunFrameSuperExportOptions): Promise<SuperExportResult> => {
  if (supportsSuperImageProcessorPool()) {
    return await runFrameSuperExportWithSharedPool(options);
  }

  return await runFrameSuperExportOnMainThread(options);
};

export const renderSuperExportThumbnailPreview = async ({
  video,
  timestamp,
  format,
  jpegQuality,
  videoSettings,
  sharedRegion,
  thumbnail,
  watermarkRemoval,
  signal
}: RenderSuperExportThumbnailPreviewOptions): Promise<Blob> => {
  throwIfAborted(signal);
  const extracted = await extractFrames({
    videos: [video],
    timestamps: [timestamp],
    format,
    jpegQuality
  });
  const frame = extracted.files[0];
  if (!frame) {
    throw new Error('No frame was available for thumbnail preview.');
  }

  const split = await resolveFrameSplitToCanvases(frame.blob, frame.filename, sharedRegion);
  let imageA = split.imageA;
  let imageB = split.imageB;

  try {
    if (watermarkRemoval?.enabled) {
      const cleaned = await applyWatermarkRemovalToCanvasPuzzle(
        {
          imageA,
          imageB,
          regions: [],
          title: split.baseName
        },
        watermarkRemoval.selectionPreset ?? null
      );
      if (cleaned.imageA !== imageA) {
        releaseCanvas(imageA);
      }
      if (cleaned.imageB !== imageB) {
        releaseCanvas(imageB);
      }
      imageA = cleaned.imageA;
      imageB = cleaned.imageB;
    }

    throwIfAborted(signal);
    const [puzzleImageA, puzzleImageB] = await Promise.all([
      canvasToDataUrl(imageA, 'image/png'),
      canvasToDataUrl(imageB, 'image/png')
    ]);
    throwIfAborted(signal);

    const rendered = await renderVideoFramePreview({
      puzzles: [
        {
          imageA: puzzleImageA,
          imageB: puzzleImageB,
          regions: [],
          title: split.baseName
        }
      ],
      settings: buildSuperExportThumbnailSettings(videoSettings, thumbnail),
      timestamp: 0,
      signal
    });

    return rendered.blob;
  } finally {
    releaseCanvases(imageA, imageB);
  }
};

const runFrameSuperImageExportOnMainThread = async ({
  videos,
  timestamps,
  format,
  jpegQuality,
  splitterDefaults,
  outputMode,
  targetDirectory: preselectedTargetDirectory = null,
  sharedRegion,
  watermarkRemoval,
  onProgress
}: RunFrameSuperImageExportOptions): Promise<SuperImageExportResult> => {
  if (outputMode === 'folder' && supportsDirectoryExport() && preselectedTargetDirectory) {
    return await streamExactThreeDifferencePuzzlesToFolder({
      videos,
      timestamps,
      format,
      jpegQuality,
      splitterDefaults,
      targetDirectory: preselectedTargetDirectory,
      sharedRegion,
      watermarkRemoval,
      onProgress
    });
  }

  const processed = await collectExactThreeDifferencePuzzles({
    videos,
    timestamps,
    format,
    jpegQuality,
    sharedRegion,
    onProgress
  });

  if (processed.validPuzzles.length === 0) {
    return {
      ...buildBaseResult(processed),
      exportedImagePairCount: 0,
      outputMode,
      outputName: null,
      watermarkRemovalEnabled: Boolean(watermarkRemoval?.enabled),
      watermarkPairsCleaned: 0,
      watermarkPresetName: watermarkRemoval?.selectionPreset?.name ?? null
    };
  }

  const rootFolderName = `${sanitizePrefix(splitterDefaults.filenamePrefix)}-super-image`;
  let resolvedOutputMode = outputMode;
  let targetDirectory: FileSystemDirectoryHandle | null = preselectedTargetDirectory;

  if (outputMode === 'folder') {
    if (!supportsDirectoryExport()) {
      processed.warnings.push('Folder export is not supported in this browser. Falling back to zip download.');
      resolvedOutputMode = 'zip';
    } else if (!targetDirectory) {
      processed.warnings.push('No output folder was selected. Falling back to zip download.');
      resolvedOutputMode = 'zip';
    }
  }

  const zip = resolvedOutputMode === 'zip' ? new JSZip() : null;
  const folder = zip ? zip.folder(rootFolderName) ?? zip : null;
  const manifest: Array<{
    sequence: number;
    title: string;
    diffCount: number;
    puzzleFilename: string;
    diffFilename: string;
  }> = [];
  let watermarkPairsCleaned = 0;
  const watermarkEnabled = Boolean(watermarkRemoval?.enabled);
  const watermarkPresetName = watermarkRemoval?.selectionPreset?.name ?? null;

  try {
    for (let index = 0; index < processed.validPuzzles.length; index += 1) {
      const puzzle = processed.validPuzzles[index];
      const sequence = index + 1;
      const filenames = buildImageFilenames(sequence, splitterDefaults);
      let outputImageA = puzzle.imageA;
      let outputImageB = puzzle.imageB;

      if (watermarkEnabled) {
        onProgress?.({
          stage: 'cleaning',
          progress: mapProgress(
            sequence / Math.max(1, processed.validPuzzles.length),
            PACKAGING_PROGRESS_START,
            CLEANING_PROGRESS_END
          ),
          label: `Removing watermark ${sequence}/${processed.validPuzzles.length}`
        });

        try {
          const cleaned = await applyWatermarkRemovalToCanvasPuzzle(
            puzzle,
            watermarkRemoval?.selectionPreset ?? null
          );
          outputImageA = cleaned.imageA;
          outputImageB = cleaned.imageB;
          if (cleaned.applied) {
            watermarkPairsCleaned += 1;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown watermark removal error.';
          processed.warnings.push(`${filenames.puzzleFilename}: watermark removal failed (${message})`);
        }
      }

      onProgress?.({
        stage: 'packaging',
        progress: mapProgress(
          sequence / Math.max(1, processed.validPuzzles.length),
          watermarkEnabled ? CLEANING_PROGRESS_END : PACKAGING_PROGRESS_START,
          PACKAGING_PROGRESS_END
        ),
        label: `Packing image pair ${sequence}/${processed.validPuzzles.length}`
      });

      const [puzzleBlob, diffBlob] = await Promise.all([
        canvasToPngBlob(outputImageA),
        canvasToPngBlob(outputImageB)
      ]);

      if (resolvedOutputMode === 'folder' && targetDirectory) {
        await writeBlobToDirectory(targetDirectory, filenames.puzzleFilename, puzzleBlob);
        await writeBlobToDirectory(targetDirectory, filenames.diffFilename, diffBlob);
      } else if (folder) {
        folder.file(filenames.puzzleFilename, puzzleBlob);
        folder.file(filenames.diffFilename, diffBlob);
      }

      manifest.push({
        sequence,
        title: puzzle.title || `Puzzle ${sequence}`,
        diffCount: puzzle.regions.length,
        puzzleFilename: filenames.puzzleFilename,
        diffFilename: filenames.diffFilename
      });

      releaseCanvases(
        outputImageA !== puzzle.imageA && outputImageA !== puzzle.imageB ? outputImageA : null,
        outputImageB !== puzzle.imageA && outputImageB !== puzzle.imageB ? outputImageB : null
      );
      releaseCanvasPuzzle(puzzle);
    }

    const manifestContent = JSON.stringify(
      {
        totalPuzzles: manifest.length,
        generatedAt: new Date().toISOString(),
        puzzles: manifest
      },
      null,
      2
    );

    if (resolvedOutputMode === 'folder' && targetDirectory) {
      await writeBlobToDirectory(
        targetDirectory,
        'manifest.json',
        new Blob([manifestContent], { type: 'application/json' })
      );
      onProgress?.({
        stage: 'packaging',
        progress: 1,
        label: `Saved folder ${rootFolderName}`
      });

      return {
        ...buildBaseResult(processed),
        exportedImagePairCount: processed.validPuzzles.length,
        outputMode: 'folder',
        outputName: rootFolderName,
        watermarkRemovalEnabled: watermarkEnabled,
        watermarkPairsCleaned,
        watermarkPresetName
      };
    }

    if (folder && zip) {
      folder.file('manifest.json', manifestContent);
    }

    const zipFilename = buildSuperImageZipFilename(splitterDefaults, processed.validPuzzles.length);
    const archive = await (zip ?? new JSZip()).generateAsync({ type: 'blob' }, (metadata) => {
      onProgress?.({
        stage: 'packaging',
        progress: mapProgress(metadata.percent / 100, PACKAGING_PROGRESS_END, 1),
        label: `Building zip folder ${Math.round(metadata.percent)}%`
      });
    });

    triggerBlobDownload(archive, zipFilename);

    return {
      ...buildBaseResult(processed),
      exportedImagePairCount: processed.validPuzzles.length,
      outputMode: 'zip',
      outputName: zipFilename,
      watermarkRemovalEnabled: watermarkEnabled,
      watermarkPairsCleaned,
      watermarkPresetName
    };
  } finally {
    processed.validPuzzles.forEach((puzzle) => releaseCanvasPuzzle(puzzle));
  }
};

const runFrameSuperImageExportWithSharedPool = async ({
  videos,
  timestamps,
  format,
  jpegQuality,
  splitterDefaults,
  outputMode,
  targetDirectory: preselectedTargetDirectory = null,
  sharedRegion,
  watermarkRemoval,
  onProgress
}: RunFrameSuperImageExportOptions): Promise<SuperImageExportResult> => {
  if (activeSuperExportController || activeSuperImageExportController || activeSuperImageExportWorker) {
    throw new Error('Another Super Image export is already running.');
  }

  const job = createSuperImageExportJob();
  const abortController = new AbortController();
  activeSuperImageExportController = {
    cancel: () => {
      abortController.abort();
      disposeSuperImageProcessingPool();
    }
  };

  let resolvedOutputMode = outputMode;
  const preWarnings: string[] = [];
  let targetDirectory = preselectedTargetDirectory;
  if (outputMode === 'folder') {
    if (!supportsDirectoryExport()) {
      preWarnings.push('Folder export is not supported in this browser. Falling back to zip download.');
      resolvedOutputMode = 'zip';
      targetDirectory = null;
    } else if (!targetDirectory) {
      preWarnings.push('No output folder was selected. Falling back to zip download.');
      resolvedOutputMode = 'zip';
    }
  }

  const throwIfCanceled = () => {
    if (abortController.signal.aborted) {
      throw createSuperImageExportCancellationError();
    }
  };

  const rootFolderName = `${sanitizePrefix(splitterDefaults.filenamePrefix)}-super-image`;
  const warnings: string[] = [];
  const watermarkEnabled = Boolean(watermarkRemoval?.enabled);
  const watermarkPresetName = watermarkRemoval?.selectionPreset?.name ?? null;
  const manifest: Array<{
    sequence: number;
    title: string;
    diffCount: number;
    puzzleFilename: string;
    diffFilename: string;
  }> = [];
  const zip = resolvedOutputMode === 'zip' ? new JSZip() : null;
  const zipFolder = zip ? zip.folder(rootFolderName) ?? zip : null;
  const totalRequests = Math.max(1, videos.length * timestamps.length);
  const pool = acquireSuperImageProcessingPool();
  let extractionSummary: ExtractFramesSummary | null = null;
  let processedFrameCount = 0;
  let exportedImagePairCount = 0;
  let watermarkPairsCleaned = 0;
  let nextSequence = 1;
  let nextFrameOrder = 1;
  let nextCommitOrder = 1;
  let lastProgress = 0;
  let isFlushingCommittedFrames = false;
  let bytesInFlight = 0;
  const orderedFrames = new Map<
    number,
    {
      estimatedBytes: number;
      resolve: () => void;
      reject: (error: Error) => void;
      settled?:
        | { kind: 'resolved'; payload: SuperImageProcessorResultPayload }
        | { kind: 'rejected'; error: Error };
    }
  >();
  const pendingFrameCommits: Promise<void>[] = [];
  const watermarkWaiters: Array<() => void> = [];
  const jobStartedAt = performance.now();

  const maybeResolveWatermarkWaiters = () => {
    if (bytesInFlight > SUPER_IMAGE_LOW_WATERMARK_BYTES) {
      return;
    }
    while (watermarkWaiters.length > 0) {
      watermarkWaiters.shift()?.();
    }
  };

  const waitForLowWatermark = async () => {
    if (bytesInFlight < SUPER_IMAGE_HIGH_WATERMARK_BYTES) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      if (abortController.signal.aborted) {
        reject(createSuperImageExportCancellationError());
        return;
      }
      const handleAbort = () => {
        abortController.signal.removeEventListener('abort', handleAbort);
        reject(createSuperImageExportCancellationError());
      };
      abortController.signal.addEventListener('abort', handleAbort, { once: true });
      watermarkWaiters.push(() => {
        abortController.signal.removeEventListener('abort', handleAbort);
        resolve();
      });
    });
  };

  const emitProgress = (stage: SuperProcessingStage, progress: number, label: string) => {
    const safeProgress = Math.max(lastProgress, clamp(progress, 0, 1));
    lastProgress = safeProgress;
    onProgress?.({
      stage,
      progress: safeProgress,
      label
    });
    job?.setProgress(safeProgress, label);
  };

  const emitCoordinatorStats = () => {
    if (!job) return;
    const unresolvedFrames = [...orderedFrames.values()].filter((entry) => !entry.settled).length;
    const settledFrames = [...orderedFrames.values()].filter((entry) => entry.settled).length;
    const elapsedSeconds = Math.max(0.001, (performance.now() - jobStartedAt) / 1000);
    job.updateWorkerStats({
      workerId: SUPER_IMAGE_COORDINATOR_ID,
      label: 'Super Image Coordinator',
      runtimeKind: 'coordinator',
      activeWorkers: 1,
      queueSize: unresolvedFrames + settledFrames,
      runningTasks: unresolvedFrames,
      avgTaskMs: 0,
      fps: processedFrameCount / elapsedSeconds,
      bytesInFlight,
      stageQueueDepths: {
        decode: bytesInFlight >= SUPER_IMAGE_HIGH_WATERMARK_BYTES ? 1 : 0,
        detect: unresolvedFrames,
        package: resolvedOutputMode === 'zip' ? settledFrames : 0,
        write: resolvedOutputMode === 'folder' ? settledFrames : 0
      },
      metrics: {
        processedFrames: processedFrameCount,
        exportedPairs: exportedImagePairCount,
        highWatermarkMb: SUPER_IMAGE_HIGH_WATERMARK_BYTES / (1024 * 1024),
        lowWatermarkMb: SUPER_IMAGE_LOW_WATERMARK_BYTES / (1024 * 1024)
      }
    });
  };

  const rejectPendingFrames = (error: Error) => {
    orderedFrames.forEach((entry) => entry.reject(error));
    orderedFrames.clear();
    maybeResolveWatermarkWaiters();
    emitCoordinatorStats();
  };

  const flushCommittedFrames = async () => {
    if (isFlushingCommittedFrames) {
      return;
    }

    isFlushingCommittedFrames = true;
    try {
      while (true) {
        throwIfCanceled();
        const frameEntry = orderedFrames.get(nextCommitOrder);
        if (!frameEntry?.settled) {
          break;
        }

        orderedFrames.delete(nextCommitOrder);
        nextCommitOrder += 1;

        try {
          if (frameEntry.settled.kind === 'rejected') {
            throw frameEntry.settled.error;
          }

          const payload = frameEntry.settled.payload;
          if (payload.kind === 'success') {
            const sequence = nextSequence;
            nextSequence += 1;
            const filenames = buildImageFilenames(sequence, splitterDefaults);
            const taskStage = resolvedOutputMode === 'folder' ? 'write' : 'package';
            const taskLabel =
              resolvedOutputMode === 'folder'
                ? `Save ${filenames.puzzleFilename}`
                : `Package ${filenames.puzzleFilename}`;
            const taskId = `${taskStage}:${sequence}`;

            if (payload.watermarkApplied) {
              watermarkPairsCleaned += 1;
            }

            job?.handleTaskEvent({
              taskId,
              label: taskLabel,
              stage: taskStage,
              state: 'running',
              workerId: 'super-image-coordinator'
            });

            emitProgress(
              'packaging',
              mapProgress(
                processedFrameCount / totalRequests,
                watermarkEnabled ? CLEANING_PROGRESS_END : PROCESSING_PROGRESS_END,
                PACKAGING_PROGRESS_END
              ),
              resolvedOutputMode === 'folder'
                ? `Saving image pair ${sequence}`
                : `Packing image pair ${sequence}`
            );

            if (resolvedOutputMode === 'folder') {
              if (!targetDirectory) {
                throw new Error('Missing folder target while saving Super Image export files.');
              }
              await writeBlobToDirectory(
                targetDirectory,
                filenames.puzzleFilename,
                new Blob([payload.puzzleBuffer], { type: 'image/png' })
              );
              await writeBlobToDirectory(
                targetDirectory,
                filenames.diffFilename,
                new Blob([payload.diffBuffer], { type: 'image/png' })
              );
            } else if (zipFolder) {
              zipFolder.file(filenames.puzzleFilename, payload.puzzleBuffer);
              zipFolder.file(filenames.diffFilename, payload.diffBuffer);
            }

            manifest.push({
              sequence,
              title: payload.title || `Puzzle ${sequence}`,
              diffCount: payload.diffCount,
              puzzleFilename: filenames.puzzleFilename,
              diffFilename: filenames.diffFilename
            });
            exportedImagePairCount += 1;

            job?.handleTaskEvent({
              taskId,
              label: taskLabel,
              stage: taskStage,
              state: 'done',
              workerId: 'super-image-coordinator'
            });
          } else {
            warnings.push(payload.warning);
          }
        } finally {
          bytesInFlight = Math.max(0, bytesInFlight - frameEntry.estimatedBytes);
          maybeResolveWatermarkWaiters();
          emitCoordinatorStats();
          frameEntry.resolve();
        }
      }
    } catch (error) {
      const wrappedError = error instanceof Error ? error : new Error('Failed to package Super Image export frames.');
      rejectPendingFrames(wrappedError);
      throw wrappedError;
    } finally {
      isFlushingCommittedFrames = false;
    }
  };

  try {
    emitProgress('extracting', 0, 'Preparing Super Image export...');
    emitCoordinatorStats();

    extractionSummary = await extractFramesStream({
      videos,
      timestamps,
      format,
      jpegQuality,
      signal: abortController.signal,
      diagnosticsJob: job,
      onProgress: (progress) => {
        throwIfCanceled();
        const ratio = progress.total > 0 ? progress.completed / progress.total : 0;
        emitProgress(
          'extracting',
          mapProgress(ratio, 0, 0.28),
          `Extracting frame ${progress.completed}/${progress.total}`
        );
      },
      onFrame: async (item) => {
        throwIfCanceled();
        processedFrameCount += 1;
        bytesInFlight += item.estimatedBytes;
        emitProgress(
          watermarkEnabled ? 'cleaning' : 'processing',
          mapProgress(processedFrameCount / totalRequests, 0.28, watermarkEnabled ? 0.72 : PACKAGING_PROGRESS_END),
          `Processing frame ${processedFrameCount}/${totalRequests}`
        );
        emitCoordinatorStats();

        const frameOrder = nextFrameOrder;
        nextFrameOrder += 1;
        const frameTaskId = `process:${frameOrder}`;

        const frameCommit = new Promise<void>((resolve, reject) => {
          orderedFrames.set(frameOrder, {
            estimatedBytes: item.estimatedBytes,
            resolve,
            reject
          });
        });
        pendingFrameCommits.push(frameCommit);

        void pool
          .run({
            blob: item.blob,
            filename: item.filename,
            sharedRegion,
            watermarkEnabled,
            watermarkSelectionPreset: watermarkRemoval?.selectionPreset ?? null,
            taskId: frameTaskId,
            taskLabel: `Process ${item.filename}`,
            onTaskEvent: (event) => job?.handleTaskEvent(event),
            onStats: (stats) => job?.updateWorkerStats(stats)
          })
          .then((payload) => {
            const frameEntry = orderedFrames.get(frameOrder);
            if (!frameEntry) {
              return;
            }
            frameEntry.settled = {
              kind: 'resolved',
              payload
            };
            emitCoordinatorStats();
            void flushCommittedFrames().catch((error) => {
              rejectPendingFrames(error instanceof Error ? error : new Error('Failed to flush processed frames.'));
            });
          })
          .catch((error) => {
            const frameEntry = orderedFrames.get(frameOrder);
            if (!frameEntry) {
              return;
            }
            frameEntry.settled = {
              kind: 'rejected',
              error: error instanceof Error ? error : new Error('Super Image processor task failed.')
            };
            emitCoordinatorStats();
            void flushCommittedFrames().catch(() => {
              // The per-frame promises are already rejected by rejectPendingFrames.
            });
          });

        if (bytesInFlight >= SUPER_IMAGE_HIGH_WATERMARK_BYTES) {
          emitProgress(
            'processing',
            mapProgress(processedFrameCount / totalRequests, 0.28, watermarkEnabled ? 0.72 : PACKAGING_PROGRESS_END),
            `Processing queue reached ${Math.round(bytesInFlight / (1024 * 1024))} MB. Waiting for drain...`
          );
          await waitForLowWatermark();
        }
      }
    });

    await Promise.all(pendingFrameCommits);
    throwIfCanceled();

    if (exportedImagePairCount === 0) {
      emitProgress('packaging', 1, 'Super Image finished, but no exact 3-difference puzzles were available to export.');
      const result: SuperImageExportResult = {
        extractionSummary,
        extractedFrameCount: extractionSummary.extractedCount,
        processedFrameCount,
        validPuzzleCount: 0,
        discardedFrameCount: Math.max(0, processedFrameCount),
        warnings: [...extractionSummary.warnings, ...warnings, ...preWarnings],
        exportedImagePairCount: 0,
        outputMode: resolvedOutputMode,
        outputName: null,
        watermarkRemovalEnabled: watermarkEnabled,
        watermarkPairsCleaned,
        watermarkPresetName
      };
      job?.complete('Super Image export finished with no exact 3-difference puzzles');
      return result;
    }

    const manifestContent = JSON.stringify(
      {
        totalPuzzles: manifest.length,
        generatedAt: new Date().toISOString(),
        puzzles: [...manifest].sort((a, b) => a.sequence - b.sequence)
      },
      null,
      2
    );

    if (resolvedOutputMode === 'folder') {
      if (!targetDirectory) {
        throw new Error('Missing folder target while finalizing Super Image export.');
      }

      job?.handleTaskEvent({
        taskId: 'write:manifest',
        label: 'Write manifest.json',
        stage: 'write',
        state: 'running',
        workerId: 'super-image-coordinator'
      });
      await writeBlobToDirectory(
        targetDirectory,
        'manifest.json',
        new Blob([manifestContent], { type: 'application/json' })
      );
      job?.handleTaskEvent({
        taskId: 'write:manifest',
        label: 'Write manifest.json',
        stage: 'write',
        state: 'done',
        workerId: 'super-image-coordinator'
      });
      emitProgress('packaging', 1, `Saved folder ${rootFolderName}`);

      const result: SuperImageExportResult = {
        extractionSummary,
        extractedFrameCount: extractionSummary.extractedCount,
        processedFrameCount,
        validPuzzleCount: exportedImagePairCount,
        discardedFrameCount: Math.max(0, processedFrameCount - exportedImagePairCount),
        warnings: [...extractionSummary.warnings, ...warnings, ...preWarnings],
        exportedImagePairCount,
        outputMode: 'folder',
        outputName: rootFolderName,
        watermarkRemovalEnabled: watermarkEnabled,
        watermarkPairsCleaned,
        watermarkPresetName
      };
      job?.complete(`Saved folder ${rootFolderName}`);
      return result;
    }

    if (zipFolder && zip) {
      zipFolder.file('manifest.json', manifestContent);
    }

    const zipFilename = buildSuperImageZipFilename(splitterDefaults, exportedImagePairCount);
    job?.handleTaskEvent({
      taskId: 'package:zip',
      label: `Build ${zipFilename}`,
      stage: 'package',
      state: 'running',
      workerId: 'super-image-coordinator'
    });
    const archive = await (zip ?? new JSZip()).generateAsync({ type: 'blob' }, (metadata) => {
      emitProgress(
        'packaging',
        mapProgress(metadata.percent / 100, PACKAGING_PROGRESS_END, 1),
        `Building zip folder ${Math.round(metadata.percent)}%`
      );
      emitCoordinatorStats();
    });
    throwIfCanceled();
    triggerBlobDownload(archive, zipFilename);
    job?.handleTaskEvent({
      taskId: 'package:zip',
      label: `Build ${zipFilename}`,
      stage: 'package',
      state: 'done',
      workerId: 'super-image-coordinator'
    });

    const result: SuperImageExportResult = {
      extractionSummary,
      extractedFrameCount: extractionSummary.extractedCount,
      processedFrameCount,
      validPuzzleCount: exportedImagePairCount,
      discardedFrameCount: Math.max(0, processedFrameCount - exportedImagePairCount),
      warnings: [...extractionSummary.warnings, ...warnings, ...preWarnings],
      exportedImagePairCount,
      outputMode: 'zip',
      outputName: zipFilename,
      watermarkRemovalEnabled: watermarkEnabled,
      watermarkPairsCleaned,
      watermarkPresetName
    };
    job?.complete(`Downloaded ${zipFilename}`);
    return result;
  } catch (error) {
    if (abortController.signal.aborted || isSuperImageExportCancellationError(error)) {
      job?.cancel('Super Image export canceled');
      throw isSuperImageExportCancellationError(error)
        ? error
        : createSuperImageExportCancellationError();
    }
    const message = error instanceof Error ? error.message : 'Super Image export failed.';
    job?.fail(message, 'Super Image export failed');
    throw error instanceof Error ? error : new Error(message);
  } finally {
    activeSuperImageExportController = null;
    if (!abortController.signal.aborted) {
      releaseSuperImageProcessingPool();
    }
  }
};

export const cancelSuperImageExport = () => {
  if (activeSuperImageExportController) {
    activeSuperImageExportController.cancel();
    return;
  }
  if (!activeSuperImageExportWorker) return;
  activeSuperImageExportWorker.postMessage({ type: 'cancel' } satisfies SuperImageExportWorkerRequest);
};

const runFrameSuperImageExportInWorker = async ({
  videos,
  timestamps,
  format,
  jpegQuality,
  splitterDefaults,
  outputMode,
  targetDirectory: preselectedTargetDirectory = null,
  sharedRegion,
  watermarkRemoval,
  onProgress
}: RunFrameSuperImageExportOptions): Promise<SuperImageExportResult> => {
  if (activeSuperExportController || activeSuperImageExportWorker) {
    throw new Error('Another Super Image export is already running.');
  }

  let resolvedOutputMode = outputMode;
  const preWarnings: string[] = [];
  const targetDirectory = preselectedTargetDirectory;

  if (outputMode === 'folder') {
    if (!supportsDirectoryExport()) {
      preWarnings.push('Folder export is not supported in this browser. Falling back to zip download.');
      resolvedOutputMode = 'zip';
    } else if (!targetDirectory) {
      preWarnings.push('No output folder was selected. Falling back to zip download.');
      resolvedOutputMode = 'zip';
    }
  }

  return await new Promise<SuperImageExportResult>((resolve, reject) => {
    const worker = new Worker(new URL('../workers/superImageExport.worker.ts', import.meta.url), {
      type: 'module'
    });
    activeSuperImageExportWorker = worker;
    const job = createSuperImageExportJob();
    job?.setProgress(0, 'Preparing Super Image export');
    let settled = false;
    let writeQueue: Promise<void> = Promise.resolve();

    const cleanup = () => {
      worker.terminate();
      if (activeSuperImageExportWorker === worker) {
        activeSuperImageExportWorker = null;
      }
    };

    const fail = async (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        await writeQueue;
      } catch {
        // ignore pending write failures when already failing
      }
      if (isSuperImageExportCancellationError(error)) {
        job?.cancel('Super Image export canceled');
      } else {
        job?.fail(error.message, 'Super Image export failed');
      }
      reject(error);
    };

    const complete = async (message: SuperImageExportWorkerDoneMessage) => {
      if (settled) return;
      settled = true;
      try {
        await writeQueue;

        if (message.result.outputMode === 'folder' && message.result.outputName) {
          if (!targetDirectory || !message.manifestContent) {
            throw new Error('Missing folder target while finalizing Super Image export.');
          }

          await writeBlobToDirectory(
            targetDirectory,
            'manifest.json',
            new Blob([message.manifestContent], { type: 'application/json' })
          );
        } else if (message.archiveBuffer && message.result.outputName) {
          triggerBlobDownload(
            new Blob([message.archiveBuffer], { type: message.archiveMimeType || 'application/zip' }),
            message.result.outputName
          );
        }

        cleanup();
        job?.setProgress(1, message.result.outputMode === 'folder' ? `Saved folder ${message.result.outputName}` : 'Super Image export complete');
        job?.complete(message.result.outputMode === 'folder' ? `Saved folder ${message.result.outputName}` : 'Super Image export complete');
        resolve({
          ...message.result,
          warnings: [...message.result.warnings, ...preWarnings]
        });
      } catch (error) {
        cleanup();
        reject(error instanceof Error ? error : new Error('Failed to finalize Super Image export.'));
      }
    };

    worker.onmessage = (event: MessageEvent<SuperImageExportWorkerResponse>) => {
      const message = event.data;

      if (message.type === 'progress') {
        onProgress?.({
          stage: message.stage,
          progress: message.progress,
          label: message.label
        });
        job?.setProgress(message.progress, message.label);
        return;
      }

      if (message.type === 'pair') {
        if (!targetDirectory) {
          void fail(new Error('Missing folder target while saving Super Image export files.'));
          return;
        }

        const puzzleBlob = new Blob([message.puzzleBuffer], { type: 'image/png' });
        const diffBlob = new Blob([message.diffBuffer], { type: 'image/png' });
        writeQueue = writeQueue.then(async () => {
          await writeBlobToDirectory(targetDirectory, message.puzzleFilename, puzzleBlob);
          await writeBlobToDirectory(targetDirectory, message.diffFilename, diffBlob);
          if (!settled) {
            worker.postMessage({
              type: 'ack-pair',
              id: message.id
            } satisfies SuperImageExportWorkerRequest);
          }
        });
        writeQueue.catch((error) => {
          void fail(error instanceof Error ? error : new Error('Failed to save Super Image export files.'));
        });
        return;
      }

      if (message.type === 'done') {
        void complete(message);
        return;
      }

      if (message.type === 'cancelled') {
        void fail(new Error('Super Image export canceled.'));
        return;
      }

      if (message.type === 'error') {
        void fail(new Error(message.message));
      }
    };

    worker.onerror = (event) => {
      const detail = event.message ? ` ${event.message}` : '';
      void fail(new Error(`Super Image export worker crashed.${detail}`));
    };

    worker.postMessage({
      type: 'start',
      payload: {
        videos,
        timestamps,
        format,
        jpegQuality,
        splitterDefaults,
        outputMode: resolvedOutputMode,
        sharedRegion,
        watermarkRemoval
      }
    } satisfies SuperImageExportWorkerRequest);
  });
};

export const runFrameSuperImageExport = async (options: RunFrameSuperImageExportOptions): Promise<SuperImageExportResult> => {
  if (supportsSuperImageProcessorPool()) {
    return await runFrameSuperImageExportWithSharedPool(options);
  }

  if (typeof Worker === 'undefined') {
    return await runFrameSuperImageExportOnMainThread(options);
  }

  return await runFrameSuperImageExportInWorker(options);
};
