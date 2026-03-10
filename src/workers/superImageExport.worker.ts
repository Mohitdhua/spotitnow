import JSZip from 'jszip';
import type { Region } from '../types';
import type { DifferenceDetectionOptions, ProcessedPuzzleCanvasData } from '../services/imageProcessing';
import { detectDifferencesClientSideCanvases } from '../services/imageProcessing';
import {
  splitCombinedBlobFromSelectionToCanvas,
  splitCombinedBlobSmartToCanvas
} from '../services/imageSplitter';
import { canvasToBlob } from '../services/canvasRuntime';
import { extractFramesStream, type ExtractFramesSummary } from '../services/frameExtractor';
import type { SplitterSharedRegion } from '../services/appSettings';
import {
  removeWatermark,
  removeWatermarkWithRegions,
  scaleWatermarkRegions,
  type WatermarkSelectionPreset
} from '../services/watermarkRemoval';
import type {
  SuperImageExportStage,
  SuperImageExportWorkerDoneMessage,
  SuperImageExportWorkerPairMessage,
  SuperImageExportWorkerRequest,
  SuperImageExportWorkerResponse,
  SuperImageExportWorkerResult,
  SuperImageExportWorkerStartPayload
} from '../services/superImageExportProtocol';

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

const PROCESSING_PROGRESS_END = 0.72;
const PACKAGING_PROGRESS_START = PROCESSING_PROGRESS_END;
const PACKAGING_PROGRESS_END = 0.92;
const CLEANING_PROGRESS_END = 0.84;

let isCancelled = false;
const pendingPairAcks = new Map<number, () => void>();

const postToMain = (message: SuperImageExportWorkerResponse, transfer: Transferable[] = []) => {
  (self as unknown as Worker).postMessage(message, transfer);
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const throwIfCancelled = () => {
  if (isCancelled) {
    throw new Error('__SUPER_IMAGE_EXPORT_CANCELLED__');
  }
};

const resolvePendingPairAck = (id: number) => {
  const resolver = pendingPairAcks.get(id);
  if (!resolver) {
    return;
  }
  pendingPairAcks.delete(id);
  resolver();
};

const resolveAllPendingPairAcks = () => {
  pendingPairAcks.forEach((resolver) => resolver());
  pendingPairAcks.clear();
};

const waitForPairAck = (id: number) =>
  new Promise<void>((resolve) => {
    if (isCancelled) {
      resolve();
      return;
    }
    pendingPairAcks.set(id, resolve);
  });

const sanitizePrefix = (value: string) => {
  const cleaned = value.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '').replace(/\s+/g, '');
  return cleaned || 'puzzle';
};

const stripExtension = (filename: string) => filename.replace(/\.[^/.]+$/, '');

const sanitizeRegions = (regions: Region[]): Region[] =>
  regions.filter((region) => {
    if (region.width <= 0 || region.height <= 0) return false;
    if (region.width < 0.004 || region.height < 0.004) return false;
    if (region.width > 0.95 || region.height > 0.95) return false;
    if (region.width * region.height > 0.35) return false;
    return true;
  });

const mapProgress = (ratio: number, start: number, end: number) =>
  start + clamp(ratio, 0, 1) * (end - start);

const buildImageFilename = (sequence: number, filenamePrefix: string, padDigits: number, isDiff: boolean) => {
  const prefix = sanitizePrefix(filenamePrefix);
  const safePadDigits = Math.max(0, Math.floor(padDigits || 0));
  const serial = safePadDigits > 0 ? String(sequence).padStart(safePadDigits, '0') : String(sequence);
  return `${prefix}${serial}${isDiff ? 'diff' : ''}.png`;
};

const buildImageFilenames = (
  sequence: number,
  splitterDefaults: SuperImageExportWorkerStartPayload['splitterDefaults']
) => ({
  puzzleFilename: buildImageFilename(sequence, splitterDefaults.filenamePrefix, splitterDefaults.filenamePadDigits, false),
  diffFilename: buildImageFilename(sequence, splitterDefaults.filenamePrefix, splitterDefaults.filenamePadDigits, true)
});

const buildSuperImageZipFilename = (
  splitterDefaults: SuperImageExportWorkerStartPayload['splitterDefaults'],
  puzzleCount: number
) => {
  const prefix = sanitizePrefix(splitterDefaults.filenamePrefix);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${prefix}-super-image-${puzzleCount}puzzle${puzzleCount === 1 ? '' : 's'}-${stamp}.zip`;
};

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

const readBlobImageSize = async (blob: Blob): Promise<{ width: number; height: number }> => {
  if (typeof createImageBitmap !== 'function') {
    throw new Error('ImageBitmap is unavailable in this worker.');
  }

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
};

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
    const split = await splitCombinedBlobSmartToCanvas(frameBlob);
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
    const cleaned = await removeWatermarkWithRegions(puzzle.imageA, puzzle.imageB, scaledRegionsA, scaledRegionsB);

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

const postPairAndWait = async (
  id: number,
  sequence: number,
  puzzleFilename: string,
  diffFilename: string,
  puzzleBuffer: ArrayBuffer,
  diffBuffer: ArrayBuffer
) => {
  const message: SuperImageExportWorkerPairMessage = {
    type: 'pair',
    id,
    sequence,
    puzzleFilename,
    diffFilename,
    puzzleBuffer,
    diffBuffer
  };
  postToMain(message, [puzzleBuffer, diffBuffer]);
  await waitForPairAck(id);
  throwIfCancelled();
};

const runExport = async (payload: SuperImageExportWorkerStartPayload): Promise<SuperImageExportWorkerDoneMessage> => {
  const { videos, timestamps, format, jpegQuality, splitterDefaults, outputMode, sharedRegion, watermarkRemoval } =
    payload;
  const rootFolderName = `${sanitizePrefix(splitterDefaults.filenamePrefix)}-super-image`;
  const watermarkEnabled = Boolean(watermarkRemoval?.enabled);
  const watermarkPresetName = watermarkRemoval?.selectionPreset?.name ?? null;
  const totalRequests = Math.max(1, videos.length * timestamps.length);
  const warnings: string[] = [];
  const manifest: Array<{
    sequence: number;
    title: string;
    diffCount: number;
    puzzleFilename: string;
    diffFilename: string;
  }> = [];
  const zip = outputMode === 'zip' ? new JSZip() : null;
  const zipFolder = zip ? zip.folder(rootFolderName) ?? zip : null;
  let processedFrameCount = 0;
  let exportedImagePairCount = 0;
  let watermarkPairsCleaned = 0;
  let pairMessageId = 1;
  let lastProgress = 0;
  let extractionSummary: ExtractFramesSummary | null = null;

  const emitProgress = (stage: SuperImageExportStage, progress: number, label: string) => {
    const safeProgress = Math.max(lastProgress, clamp(progress, 0, 1));
    lastProgress = safeProgress;
    postToMain({
      type: 'progress',
      stage,
      progress: safeProgress,
      label
    });
  };

  extractionSummary = await extractFramesStream({
    videos,
    timestamps,
    format,
    jpegQuality,
    onProgress: (progress) => {
      throwIfCancelled();
      const ratio = progress.total > 0 ? progress.completed / progress.total : 0;
      emitProgress('extracting', mapProgress(ratio, 0, 0.28), progress.label);
    },
    onFrame: async (item) => {
      throwIfCancelled();
      processedFrameCount += 1;
      emitProgress(
        watermarkEnabled ? 'cleaning' : 'processing',
        mapProgress(processedFrameCount / totalRequests, 0.28, watermarkEnabled ? 0.72 : PACKAGING_PROGRESS_END),
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
            mapProgress(processedFrameCount / totalRequests, PROCESSING_PROGRESS_END, CLEANING_PROGRESS_END),
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
          mapProgress(
            processedFrameCount / totalRequests,
            watermarkEnabled ? CLEANING_PROGRESS_END : PROCESSING_PROGRESS_END,
            PACKAGING_PROGRESS_END
          ),
          outputMode === 'folder'
            ? `Saving image pair ${sequence}: ${filenames.puzzleFilename}`
            : `Packing image pair ${sequence}: ${filenames.puzzleFilename}`
        );

        const [puzzleBlob, diffBlob] = await Promise.all([
          canvasToBlob(outputImageA, 'image/png'),
          canvasToBlob(outputImageB, 'image/png')
        ]);
        const [puzzleBuffer, diffBuffer] = await Promise.all([puzzleBlob.arrayBuffer(), diffBlob.arrayBuffer()]);

        if (outputMode === 'folder') {
          const nextPairMessageId = pairMessageId;
          pairMessageId += 1;
          await postPairAndWait(
            nextPairMessageId,
            sequence,
            filenames.puzzleFilename,
            filenames.diffFilename,
            puzzleBuffer,
            diffBuffer
          );
        } else if (zipFolder) {
          zipFolder.file(filenames.puzzleFilename, puzzleBuffer);
          zipFolder.file(filenames.diffFilename, diffBuffer);
        }

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

  const result: SuperImageExportWorkerResult = {
    extractionSummary,
    extractedFrameCount: extractionSummary.extractedCount,
    processedFrameCount,
    validPuzzleCount: exportedImagePairCount,
    discardedFrameCount: Math.max(0, processedFrameCount - exportedImagePairCount),
    warnings: [...extractionSummary.warnings, ...warnings],
    exportedImagePairCount,
    outputMode,
    outputName: outputMode === 'folder' ? rootFolderName : null,
    watermarkRemovalEnabled: watermarkEnabled,
    watermarkPairsCleaned,
    watermarkPresetName
  };

  if (exportedImagePairCount === 0) {
    emitProgress('packaging', 1, 'Super Image finished, but no exact 3-difference puzzles were available to export.');
    return {
      type: 'done',
      result: {
        ...result,
        outputName: null
      }
    };
  }

  if (outputMode === 'folder') {
    emitProgress('packaging', 1, `Saved folder ${rootFolderName}`);
    return {
      type: 'done',
      result: {
        ...result,
        outputName: rootFolderName
      },
      manifestContent
    };
  }

  if (zipFolder && zip) {
    zipFolder.file('manifest.json', manifestContent);
  }

  const zipFilename = buildSuperImageZipFilename(splitterDefaults, exportedImagePairCount);
  const archiveBuffer = await (zip ?? new JSZip()).generateAsync({ type: 'arraybuffer' }, (metadata) => {
    emitProgress(
      'packaging',
      mapProgress(metadata.percent / 100, PACKAGING_PROGRESS_END, 1),
      `Building zip folder ${Math.round(metadata.percent)}%`
    );
  });

  return {
    type: 'done',
    result: {
      ...result,
      outputMode: 'zip',
      outputName: zipFilename
    },
    manifestContent,
    archiveBuffer,
    archiveMimeType: 'application/zip'
  };
};

self.onmessage = async (event: MessageEvent<SuperImageExportWorkerRequest>) => {
  const message = event.data;

  if (message.type === 'cancel') {
    isCancelled = true;
    resolveAllPendingPairAcks();
    return;
  }

  if (message.type === 'ack-pair') {
    resolvePendingPairAck(message.id);
    return;
  }

  if (message.type !== 'start') {
    return;
  }

  isCancelled = false;

  try {
    const response = await runExport(message.payload);
    const transferables: Transferable[] = [];
    if (response.archiveBuffer) {
      transferables.push(response.archiveBuffer);
    }
    postToMain(response, transferables);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : 'Super Image export failed.';
    if (messageText === '__SUPER_IMAGE_EXPORT_CANCELLED__' || isCancelled) {
      postToMain({ type: 'cancelled' });
    } else {
      postToMain({ type: 'error', message: messageText });
    }
  } finally {
    isCancelled = false;
    resolveAllPendingPairAcks();
  }
};
