import JSZip from 'jszip';
import { Puzzle, Region, VideoSettings } from '../types';
import {
  SplitterDefaults,
  type SplitterSharedRegion,
  type SuperImageExportMode
} from './appSettings';
import {
  detectDifferencesClientSide,
  detectDifferencesClientSideCanvases,
  type DifferenceDetectionOptions,
  type ProcessedPuzzleCanvasData
} from './imageProcessing';
import { extractFrames, extractFramesStream, type ExtractFramesSummary, type ParsedTimestamp } from './frameExtractor';
import {
  dataUrlToPngBlob,
  readFileAsDataUrl,
  splitCombinedBlobFromSelectionToCanvas,
  splitCombinedBlobSmartToCanvas,
  splitCombinedFileSmart,
  splitCombinedImageFromSelection
} from './imageSplitter';
import {
  removeWatermark,
  removeWatermarkDataUrl,
  removeWatermarkWithRegions,
  scaleWatermarkRegions,
  type WatermarkSelectionPreset
} from './watermarkRemoval';
import type {
  SuperImageProcessorResultPayload,
  SuperImageProcessorWorkerRequest,
  SuperImageProcessorWorkerResponse
} from './superImageProcessorProtocol';
import type {
  SuperImageExportWorkerDoneMessage,
  SuperImageExportWorkerRequest,
  SuperImageExportWorkerResponse
} from './superImageExportProtocol';
import { renderVideoWithWebCodecs } from './videoExport';

export type SuperProcessingStage = 'extracting' | 'processing' | 'cleaning' | 'packaging' | 'exporting';

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
  exportedVideoCount: number;
  batchSizes: number[];
  imagesPerVideo: number;
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

interface CollectedExactPuzzleResult {
  extractionSummary: ExtractFramesSummary;
  extractedFrameCount: number;
  processedFrameCount: number;
  validPuzzles: Puzzle[];
  warnings: string[];
}

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

export const canUseSuperImageDirectoryExport = () => supportsDirectoryExport();

const writeBlobToDirectory = async (
  directory: FileSystemDirectoryHandle,
  filename: string,
  blob: Blob
) => {
  const fileHandle = await directory.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
};

const openSuperImageDirectory = async (rootFolderName: string): Promise<FileSystemDirectoryHandle | null> => {
  const picker = getDirectoryPicker();
  if (!picker) return null;

  try {
    const baseDirectory = await picker({ mode: 'readwrite' });
    return await baseDirectory.getDirectoryHandle(rootFolderName, { create: true });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Super Image export canceled during folder selection.');
    }
    throw error;
  }
};

export const requestSuperImageOutputDirectory = async (
  splitterDefaults: SplitterDefaults
): Promise<FileSystemDirectoryHandle | null> => {
  const rootFolderName = `${sanitizePrefix(splitterDefaults.filenamePrefix)}-super-image`;
  return await openSuperImageDirectory(rootFolderName);
};

const supportsSuperImageProcessorPool = () =>
  typeof Worker !== 'undefined' &&
  typeof OffscreenCanvas !== 'undefined' &&
  typeof createImageBitmap === 'function';

interface SuperImageProcessorPoolTask {
  blob: Blob;
  filename: string;
  sharedRegion?: SplitterSharedRegion | null;
  watermarkEnabled: boolean;
  watermarkSelectionPreset?: WatermarkSelectionPreset | null;
}

interface SuperImageProcessorPool {
  run(task: SuperImageProcessorPoolTask): Promise<SuperImageProcessorResultPayload>;
  destroy(): void;
}

const createSuperImageProcessorPool = (size: number): SuperImageProcessorPool => {
  const safeSize = clamp(Math.floor(size) || 1, 1, 4);
  const workers = Array.from(
    { length: safeSize },
    () =>
      new Worker(new URL('../workers/superImageProcessor.worker.ts', import.meta.url), {
        type: 'module'
      })
  );
  const idleWorkers = [...workers];
  const taskQueue: Array<{
    id: number;
    workerRequest: SuperImageProcessorWorkerRequest;
    transferables: Transferable[];
    resolve: (payload: SuperImageProcessorResultPayload) => void;
    reject: (error: Error) => void;
  }> = [];
  const activeTasks = new Map<
    number,
    {
      worker: Worker;
      resolve: (payload: SuperImageProcessorResultPayload) => void;
      reject: (error: Error) => void;
    }
  >();
  let nextTaskId = 1;
  let destroyed = false;

  const failAll = (error: Error) => {
    if (destroyed) {
      return;
    }

    destroyed = true;
    workers.forEach((worker) => worker.terminate());
    idleWorkers.length = 0;

    for (const task of taskQueue.splice(0)) {
      task.reject(error);
    }

    activeTasks.forEach((task) => task.reject(error));
    activeTasks.clear();
  };

  const dispatch = () => {
    if (destroyed) {
      return;
    }

    while (idleWorkers.length > 0 && taskQueue.length > 0) {
      const worker = idleWorkers.shift();
      const task = taskQueue.shift();
      if (!worker || !task) {
        return;
      }

      activeTasks.set(task.id, {
        worker,
        resolve: task.resolve,
        reject: task.reject
      });
      worker.postMessage(task.workerRequest, task.transferables);
    }
  };

  workers.forEach((worker) => {
    worker.onmessage = (event: MessageEvent<SuperImageProcessorWorkerResponse>) => {
      if (destroyed) {
        return;
      }

      const message = event.data;
      const activeTask = activeTasks.get(message.id);
      if (!activeTask) {
        return;
      }

      activeTasks.delete(message.id);
      idleWorkers.push(worker);

      if (message.type === 'result') {
        activeTask.resolve(message.payload);
        dispatch();
        return;
      }

      failAll(new Error(message.message));
    };

    worker.onerror = (event) => {
      const detail = event.message ? ` ${event.message}` : '';
      failAll(new Error(`Super image processor worker crashed.${detail}`));
    };
  });

  return {
    run: async ({ blob, filename, sharedRegion, watermarkEnabled, watermarkSelectionPreset }) => {
      if (destroyed) {
        throw new Error('Super image processor pool is no longer available.');
      }

      const frameBuffer = await blob.arrayBuffer();
      return await new Promise<SuperImageProcessorResultPayload>((resolve, reject) => {
        const id = nextTaskId;
        nextTaskId += 1;

        taskQueue.push({
          id,
          workerRequest: {
            type: 'process',
            id,
            payload: {
              frameBuffer,
              mimeType: blob.type || 'image/png',
              filename,
              sharedRegion,
              watermarkEnabled,
              watermarkSelectionPreset
            }
          },
          transferables: [frameBuffer],
          resolve,
          reject
        });
        dispatch();
      });
    },
    destroy: () => {
      if (destroyed) {
        return;
      }

      destroyed = true;
      workers.forEach((worker) => worker.terminate());
      idleWorkers.length = 0;
      taskQueue.length = 0;
      activeTasks.clear();
    }
  };
};

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

const buildBaseResult = (processed: CollectedExactPuzzleResult): SuperBaseResult => ({
  extractionSummary: processed.extractionSummary,
  extractedFrameCount: processed.extractedFrameCount,
  processedFrameCount: processed.processedFrameCount,
  validPuzzleCount: processed.validPuzzles.length,
  discardedFrameCount: Math.max(0, processed.processedFrameCount - processed.validPuzzles.length),
  warnings: processed.warnings
});

const applyWatermarkRemovalToPuzzle = async (
  puzzle: Puzzle,
  selectionPreset?: WatermarkSelectionPreset | null
): Promise<{ imageA: string; imageB: string; applied: boolean }> => {
  if (selectionPreset) {
    const { width, height } = await readImageSize(puzzle.imageA);
    const scaledRegionsA = scaleWatermarkRegions(
      selectionPreset.regionsA,
      selectionPreset.sourceWidth,
      selectionPreset.sourceHeight,
      width,
      height
    );
    const scaledRegionsB = scaleWatermarkRegions(
      selectionPreset.regionsB,
      selectionPreset.sourceWidth,
      selectionPreset.sourceHeight,
      width,
      height
    );
    const cleaned = await removeWatermarkWithRegions(
      puzzle.imageA,
      puzzle.imageB,
      scaledRegionsA,
      scaledRegionsB
    );

    return {
      imageA: cleaned.imageA.toDataURL('image/png'),
      imageB: cleaned.imageB.toDataURL('image/png'),
      applied: true
    };
  }

  const cleaned = await removeWatermarkDataUrl(puzzle.imageA, puzzle.imageB);
  return {
    imageA: cleaned.imageAData,
    imageB: cleaned.imageBData,
    applied: true
  };
};

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

const buildSuperImageZipFilename = (splitterDefaults: SplitterDefaults, puzzleCount: number) => {
  const prefix = sanitizePrefix(splitterDefaults.filenamePrefix);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${prefix}-super-image-${puzzleCount}puzzle${puzzleCount === 1 ? '' : 's'}-${stamp}.zip`;
};

const createFrameFile = (blob: Blob, filename: string) =>
  new File([blob], filename, {
    type: blob.type || 'image/png',
    lastModified: Date.now()
  });

const readBlobImageSize = async (blob: Blob): Promise<{ width: number; height: number }> => {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    try {
      return {
        width: bitmap.width,
        height: bitmap.height
      };
    } finally {
      if (typeof bitmap.close === 'function') {
        bitmap.close();
      }
    }
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    return await readImageSize(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
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

const resolveFrameSplit = async (frameFile: File, sharedRegion?: SplitterSharedRegion | null) => {
  if (!sharedRegion) {
    return splitCombinedFileSmart(frameFile);
  }

  try {
    const sourceUrl = await readFileAsDataUrl(frameFile);
    const { width, height } = await readImageSize(sourceUrl);
    const splitSelection = clampRegionSelection(sharedRegion, width, height);
    const split = await splitCombinedImageFromSelection(sourceUrl, splitSelection);

    return {
      baseName: stripExtension(frameFile.name),
      imageA: split.imageA,
      imageB: split.imageB
    };
  } catch {
    return splitCombinedFileSmart(frameFile);
  }
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
    const split = await splitCombinedBlobSmartToCanvas(frameBlob);
    return {
      baseName,
      imageA: split.imageA,
      imageB: split.imageB
    };
  }
};

const processExactThreeDifferencePuzzle = async (
  imageA: string,
  imageB: string,
  title: string
): Promise<Puzzle | null> => {
  const defaultResult = await detectDifferencesClientSide(imageA, imageB, splitAutoDefault);
  const defaultRegions = sanitizeRegions(defaultResult.regions);
  if (defaultRegions.length === 3) {
    return {
      imageA: defaultResult.imageA,
      imageB: defaultResult.imageB,
      regions: defaultRegions,
      title
    };
  }

  const sensitiveResult = await detectDifferencesClientSide(imageA, imageB, splitAutoSensitive);
  const sensitiveRegions = sanitizeRegions(sensitiveResult.regions);
  if (sensitiveRegions.length === 3) {
    return {
      imageA: sensitiveResult.imageA,
      imageB: sensitiveResult.imageB,
      regions: sensitiveRegions,
      title
    };
  }

  return null;
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
}): Promise<CollectedExactPuzzleResult> => {
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
        label: progress.label
      });
    }
  });

  const warnings = [...extracted.summary.warnings];
  const validPuzzles: Puzzle[] = [];

  for (let index = 0; index < extracted.files.length; index += 1) {
    const item = extracted.files[index];
    onProgress?.({
      stage: 'processing',
      progress: mapProgress((index + 1) / Math.max(1, extracted.files.length), 0.3, PROCESSING_PROGRESS_END),
      label: `Processing frame ${index + 1}/${extracted.files.length}: ${item.filename}`
    });

    try {
      const frameFile = createFrameFile(item.blob, item.filename);
      const split = await resolveFrameSplit(frameFile, sharedRegion);
      const title = stripExtension(split.baseName || item.filename);
      const puzzle = await processExactThreeDifferencePuzzle(split.imageA, split.imageB, title);
      if (puzzle) {
        validPuzzles.push(puzzle);
      } else {
        warnings.push(`${item.filename}: skipped (did not resolve to exactly 3 differences).`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown split/processing error.';
      warnings.push(`${item.filename}: failed during split/processing (${message})`);
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

const streamExactThreeDifferencePuzzlesToFolderWithProcessorPool = async ({
  videos,
  timestamps,
  format,
  jpegQuality,
  maxConcurrentFrames = 1,
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
  maxConcurrentFrames?: number;
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
  const safeMaxConcurrentFrames = clamp(Math.floor(maxConcurrentFrames) || 1, 1, 4);
  let processedFrameCount = 0;
  let exportedImagePairCount = 0;
  let watermarkPairsCleaned = 0;
  let lastProgress = 0;
  let nextSequence = 1;
  let nextFrameOrder = 1;
  let nextCommitOrder = 1;
  let isFlushingCommittedFrames = false;
  const processorPool = createSuperImageProcessorPool(safeMaxConcurrentFrames);
  const orderedFrames = new Map<
    number,
    {
      resolve: () => void;
      reject: (error: Error) => void;
      settled?:
        | { kind: 'resolved'; payload: SuperImageProcessorResultPayload }
        | { kind: 'rejected'; error: Error };
    }
  >();

  const emitProgress = (stage: SuperProcessingStage, progress: number, label: string) => {
    const safeProgress = Math.max(lastProgress, clamp(progress, 0, 1));
    lastProgress = safeProgress;
    onProgress?.({
      stage,
      progress: safeProgress,
      label
    });
  };

  const rejectPendingFrames = (error: Error) => {
    orderedFrames.forEach((entry) => entry.reject(error));
    orderedFrames.clear();
  };

  const flushCommittedFrames = async () => {
    if (isFlushingCommittedFrames) {
      return;
    }

    isFlushingCommittedFrames = true;

    try {
      while (true) {
        const nextFrame = orderedFrames.get(nextCommitOrder);
        if (!nextFrame?.settled) {
          break;
        }

        orderedFrames.delete(nextCommitOrder);
        nextCommitOrder += 1;

        if (nextFrame.settled.kind === 'rejected') {
          throw nextFrame.settled.error;
        }

        const payload = nextFrame.settled.payload;
        if (payload.kind === 'success') {
          const sequence = nextSequence;
          nextSequence += 1;
          const filenames = buildImageFilenames(sequence, splitterDefaults);

          if (payload.watermarkApplied) {
            watermarkPairsCleaned += 1;
          }

          emitProgress(
            'packaging',
            mapProgress(processedFrameCount / totalRequests, watermarkEnabled ? 0.9 : 0.72, 0.98),
            `Saving image pair ${sequence}: ${filenames.puzzleFilename}`
          );

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

          manifest.push({
            sequence,
            title: payload.title || `Puzzle ${sequence}`,
            diffCount: payload.diffCount,
            puzzleFilename: filenames.puzzleFilename,
            diffFilename: filenames.diffFilename
          });
          exportedImagePairCount += 1;
        } else {
          warnings.push(payload.warning);
        }

        nextFrame.resolve();
      }
    } catch (error) {
      const wrappedError = error instanceof Error ? error : new Error('Failed to write super image export files.');
      rejectPendingFrames(wrappedError);
      throw wrappedError;
    } finally {
      isFlushingCommittedFrames = false;
      if ([...orderedFrames.values()].some((entry) => entry.settled)) {
        await flushCommittedFrames();
      }
    }
  };

  try {
    const extractionSummary = await extractFramesStream({
      videos,
      timestamps,
      format,
      jpegQuality,
      onProgress: (progress) => {
        const ratio = progress.total > 0 ? progress.completed / progress.total : 0;
        emitProgress('extracting', mapProgress(ratio, 0, 0.28), progress.label);
      },
      onFrame: async (item) => {
        processedFrameCount += 1;
        emitProgress(
          watermarkEnabled ? 'cleaning' : 'processing',
          mapProgress(processedFrameCount / totalRequests, 0.28, watermarkEnabled ? 0.72 : 0.9),
          `Processing frame ${processedFrameCount}/${totalRequests}: ${item.filename}`
        );

        const frameOrder = nextFrameOrder;
        nextFrameOrder += 1;

        await new Promise<void>((resolve, reject) => {
          orderedFrames.set(frameOrder, {
            resolve,
            reject
          });

          void processorPool
            .run({
              blob: item.blob,
              filename: item.filename,
              sharedRegion,
              watermarkEnabled,
              watermarkSelectionPreset: watermarkRemoval?.selectionPreset ?? null
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
                error: error instanceof Error ? error : new Error('Super image processor task failed.')
              };
              void flushCommittedFrames().catch(() => {
                // The ordered frame promises have already been rejected.
              });
            });
        });
      }
    });

    const manifestContent = JSON.stringify(
      {
        totalPuzzles: manifest.length,
        generatedAt: new Date().toISOString(),
        puzzles: [...manifest].sort((a, b) => a.sequence - b.sequence)
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
  } finally {
    processorPool.destroy();
  }
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
      emitProgress('extracting', mapProgress(ratio, 0, 0.28), progress.label);
    },
    onFrame: async (item) => {
      processedFrameCount += 1;
      emitProgress(
        'processing',
        mapProgress(processedFrameCount / totalRequests, 0.28, watermarkEnabled ? 0.72 : 0.9),
        `Processing frame ${processedFrameCount}/${totalRequests}: ${item.filename}`
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
            `Removing watermark ${sequence}: ${filenames.puzzleFilename}`
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
          `Saving image pair ${sequence}: ${filenames.puzzleFilename}`
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

export const runFrameSuperExport = async ({
  videos,
  timestamps,
  format,
  jpegQuality,
  videoSettings,
  splitterDefaults,
  imagesPerVideo,
  sharedRegion,
  watermarkRemoval,
  onProgress
}: RunFrameSuperExportOptions): Promise<SuperExportResult> => {
  const processed = await collectExactThreeDifferencePuzzles({
    videos,
    timestamps,
    format,
    jpegQuality,
    sharedRegion,
    onProgress
  });
  const watermarkEnabled = Boolean(watermarkRemoval?.enabled);
  const watermarkPresetName = watermarkRemoval?.selectionPreset?.name ?? null;
  let watermarkPairsCleaned = 0;
  let cleanedPuzzles = processed.validPuzzles;

  if (watermarkEnabled && processed.validPuzzles.length > 0) {
    const nextPuzzles: Puzzle[] = [];

    for (let index = 0; index < processed.validPuzzles.length; index += 1) {
      const puzzle = processed.validPuzzles[index];
      const sequence = index + 1;
      const labelName = puzzle.title?.trim() || `Puzzle ${sequence}`;

      onProgress?.({
        stage: 'cleaning',
        progress: mapProgress(sequence / Math.max(1, processed.validPuzzles.length), PROCESSING_PROGRESS_END, CLEANING_PROGRESS_END),
        label: `Removing watermark ${sequence}/${processed.validPuzzles.length}: ${labelName}`
      });

      try {
        const cleaned = await applyWatermarkRemovalToPuzzle(puzzle, watermarkRemoval?.selectionPreset ?? null);
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

  for (let index = 0; index < batches.length; index += 1) {
    const puzzles = batches[index];
    const exportStart = watermarkEnabled ? CLEANING_PROGRESS_END : PROCESSING_PROGRESS_END;
    const batchStart = exportStart + (index / Math.max(1, batches.length)) * (1 - exportStart);
    const batchEnd = exportStart + ((index + 1) / Math.max(1, batches.length)) * (1 - exportStart);

    const rendered = await renderVideoWithWebCodecs({
      puzzles,
      settings: videoSettings,
      onProgress: (progress, label) => {
        onProgress?.({
          stage: 'exporting',
          progress: mapProgress(progress, batchStart, batchEnd),
          label:
            label ||
            `Exporting video ${index + 1}/${batches.length} (${puzzles.length} puzzle${
              puzzles.length === 1 ? '' : 's'
            })`
        });
      }
    });

    triggerBlobDownload(
      rendered.blob,
      buildBatchVideoFilename(videoSettings, splitterDefaults, index, batches.length, puzzles.length)
    );
    await delay(120);
  }

  return {
    ...buildBaseResult(processed),
    exportedVideoCount: batches.length,
    batchSizes: batches.map((batch) => batch.length),
    imagesPerVideo: Math.max(1, imagesPerVideo),
    watermarkRemovalEnabled: watermarkEnabled,
    watermarkPairsCleaned,
    watermarkPresetName
  };
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

  for (let index = 0; index < processed.validPuzzles.length; index += 1) {
    const puzzle = processed.validPuzzles[index];
    const sequence = index + 1;
    const filenames = buildImageFilenames(sequence, splitterDefaults);
    let imageA = puzzle.imageA;
    let imageB = puzzle.imageB;

    if (watermarkEnabled) {
      onProgress?.({
        stage: 'cleaning',
        progress: mapProgress(
          sequence / Math.max(1, processed.validPuzzles.length),
          PACKAGING_PROGRESS_START,
          CLEANING_PROGRESS_END
        ),
        label: `Removing watermark ${sequence}/${processed.validPuzzles.length}: ${filenames.puzzleFilename}`
      });

      try {
        const cleaned = await applyWatermarkRemovalToPuzzle(puzzle, watermarkRemoval?.selectionPreset ?? null);
        imageA = cleaned.imageA;
        imageB = cleaned.imageB;
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
      label: `Packing image pair ${sequence}/${processed.validPuzzles.length}: ${filenames.puzzleFilename}`
    });

    const [puzzleBlob, diffBlob] = await Promise.all([
      dataUrlToPngBlob(imageA),
      dataUrlToPngBlob(imageB)
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
};

export const cancelSuperImageExport = () => {
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
  if (activeSuperImageExportWorker) {
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
  if (typeof Worker === 'undefined') {
    return await runFrameSuperImageExportOnMainThread(options);
  }

  return await runFrameSuperImageExportInWorker(options);
};
