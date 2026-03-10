import type { Region } from '../types';
import type { DifferenceDetectionOptions, ProcessedPuzzleCanvasData } from '../services/imageProcessing';
import { detectDifferencesClientSideCanvases } from '../services/imageProcessing';
import {
  splitCombinedBlobFromSelectionToCanvas,
  splitCombinedBlobSmartToCanvas
} from '../services/imageSplitter';
import { canvasToBlob } from '../services/canvasRuntime';
import {
  removeWatermark,
  removeWatermarkWithRegions,
  scaleWatermarkRegions,
  type WatermarkSelectionPreset
} from '../services/watermarkRemoval';
import type {
  SuperImageProcessorResultPayload,
  SuperImageProcessorTaskMessage,
  SuperImageProcessorWorkerRequest,
  SuperImageProcessorWorkerResponse
} from '../services/superImageProcessorProtocol';
import type { SplitterSharedRegion } from '../services/appSettings';

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

const stripExtension = (filename: string) => filename.replace(/\.[^/.]+$/, '');

const sanitizeRegions = (regions: Region[]): Region[] =>
  regions.filter((region) => {
    if (region.width <= 0 || region.height <= 0) return false;
    if (region.width < 0.004 || region.height < 0.004) return false;
    if (region.width > 0.95 || region.height > 0.95) return false;
    if (region.width * region.height > 0.35) return false;
    return true;
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

const readBlobImageSize = async (blob: Blob): Promise<{ width: number; height: number }> => {
  const bitmap = await createImageBitmap(blob);
  try {
    return {
      width: bitmap.width,
      height: bitmap.height
    };
  } finally {
    bitmap.close();
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
  sharedRegion?: SplitterSharedRegion | null
) => {
  if (!sharedRegion) {
    return await splitCombinedBlobSmartToCanvas(frameBlob);
  }

  try {
    const { width, height } = await readBlobImageSize(frameBlob);
    const splitSelection = clampRegionSelection(sharedRegion, width, height);
    return await splitCombinedBlobFromSelectionToCanvas(frameBlob, splitSelection);
  } catch {
    return await splitCombinedBlobSmartToCanvas(frameBlob);
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

const processTask = async ({
  frameBuffer,
  mimeType,
  filename,
  sharedRegion,
  watermarkEnabled,
  watermarkSelectionPreset
}: SuperImageProcessorTaskMessage['payload']): Promise<SuperImageProcessorResultPayload> => {
  let split: { imageA: HTMLCanvasElement; imageB: HTMLCanvasElement } | null = null;
  let puzzle: CanvasPuzzle | null = null;
  let outputImageA: HTMLCanvasElement | null = null;
  let outputImageB: HTMLCanvasElement | null = null;

  try {
    const frameBlob = new Blob([frameBuffer], { type: mimeType || 'image/png' });
    split = await resolveFrameSplitToCanvases(frameBlob, sharedRegion);
    const title = stripExtension(filename);
    puzzle = await processExactThreeDifferencePuzzleCanvases(split.imageA, split.imageB, title);

    if (!puzzle) {
      return {
        kind: 'skip',
        warning: `${filename}: skipped (did not resolve to exactly 3 differences).`
      };
    }

    outputImageA = puzzle.imageA;
    outputImageB = puzzle.imageB;
    let watermarkApplied = false;

    if (watermarkEnabled) {
      const cleaned = await applyWatermarkRemovalToCanvasPuzzle(puzzle, watermarkSelectionPreset ?? null);
      outputImageA = cleaned.imageA;
      outputImageB = cleaned.imageB;
      watermarkApplied = cleaned.applied;
    }

    const puzzleBlob = await canvasToBlob(outputImageA, 'image/png');
    const diffBlob = await canvasToBlob(outputImageB, 'image/png');
    const puzzleBuffer = await puzzleBlob.arrayBuffer();
    const diffBuffer = await diffBlob.arrayBuffer();

    return {
      kind: 'success',
      title: puzzle.title || title,
      diffCount: puzzle.regions.length,
      puzzleBuffer,
      diffBuffer,
      watermarkApplied
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown split/processing error.';
    return {
      kind: 'error',
      warning: `${filename}: failed during split/processing (${message})`
    };
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
};

self.onmessage = async (event: MessageEvent<SuperImageProcessorWorkerRequest>) => {
  const message = event.data;
  if (message.type !== 'process') {
    return;
  }

  try {
    const payload = await processTask(message.payload);
    const transferables: Transferable[] = [];
    if (payload.kind === 'success') {
      transferables.push(payload.puzzleBuffer, payload.diffBuffer);
    }

    const response: SuperImageProcessorWorkerResponse = {
      type: 'result',
      id: message.id,
      payload
    };
    (self as unknown as Worker).postMessage(response, transferables);
  } catch (error) {
    const response: SuperImageProcessorWorkerResponse = {
      type: 'crash',
      id: message.id,
      message: error instanceof Error ? error.message : 'Super image processor worker crashed.'
    };
    (self as unknown as Worker).postMessage(response);
  }
};
