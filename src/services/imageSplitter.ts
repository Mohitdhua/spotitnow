import { detectDifferencesClientSide, type DifferenceDetectionOptions } from './imageProcessing';
import {
  canvasToBlob,
  canvasToDataUrl,
  createRuntimeCanvas,
  getRuntimeCanvasContext,
  loadRuntimeImageFromSource
} from './canvasRuntime';

interface PixelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DetectionBlob extends PixelBounds {
  area: number;
  touchesEdge: boolean;
}

interface ForegroundMaskData {
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  scale: number;
  mask: Uint8Array;
}

interface AlignmentOffset {
  dx: number;
  dy: number;
  score: number;
}

type SplitAxis = 'vertical' | 'horizontal';

interface SeparatorCandidate {
  axis: SplitAxis;
  start: number;
  end: number;
  confidence: number;
  kind: 'separator' | 'center';
}

interface ExtractedPairCandidate {
  first: HTMLCanvasElement;
  second: HTMLCanvasElement;
  score: number;
}

interface AssistPlacementCandidate {
  x: number;
  y: number;
  patchScore: number;
}

export interface SplitPairData {
  imageA: string;
  imageB: string;
}

export interface SplitPairCanvasData {
  imageA: HTMLCanvasElement;
  imageB: HTMLCanvasElement;
}

export interface SplitRegionSelection extends PixelBounds {}

export interface LinkedSplitPairSelection {
  x: number;
  y: number;
  size: number;
  gap: number;
}

export interface LinkedSplitPairAssistResult {
  selection: LinkedSplitPairSelection;
  dx: number;
  dy: number;
  score: number;
}

export interface SplitCombinedFileResult extends SplitPairData {
  baseName: string;
  sourceName: string;
  sourceWidth: number;
  sourceHeight: number;
  suggestedRegion: SplitRegionSelection;
}

export const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const loadImageFromSource = async (src: string): Promise<HTMLImageElement | ImageBitmap> =>
  await loadRuntimeImageFromSource(src);

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const median = (values: number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
};

const quantile = (values: number[], q: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = clamp(Math.round((sorted.length - 1) * q), 0, sorted.length - 1);
  return sorted[position];
};

const computeSquareScore = (width: number, height: number) => {
  const ratio = width / Math.max(1, height);
  const logDeviation = Math.abs(Math.log(Math.max(0.001, ratio)));
  return clamp(1 - logDeviation / Math.log(1.7), 0, 1);
};

const smoothSignal = (values: number[], radius: number) => {
  if (values.length === 0 || radius <= 0) {
    return [...values];
  }

  const prefix = new Array(values.length + 1).fill(0);
  for (let i = 0; i < values.length; i += 1) {
    prefix[i + 1] = prefix[i] + values[i];
  }

  return values.map((_, index) => {
    const start = Math.max(0, index - radius);
    const end = Math.min(values.length - 1, index + radius);
    const sum = prefix[end + 1] - prefix[start];
    return sum / Math.max(1, end - start + 1);
  });
};

const cropCanvas = (source: HTMLCanvasElement, bounds: PixelBounds): HTMLCanvasElement => {
  const cropped = createRuntimeCanvas(bounds.width, bounds.height) as unknown as HTMLCanvasElement;
  const ctx = getRuntimeCanvasContext(cropped);
  if (!ctx) return source;
  ctx.drawImage(
    source,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    0,
    0,
    bounds.width,
    bounds.height
  );
  return cropped;
};

const normalizeRegionSelection = (
  selection: PixelBounds,
  maxWidth: number,
  maxHeight: number
): SplitRegionSelection => {
  const safeMaxWidth = Math.max(1, Math.floor(maxWidth));
  const safeMaxHeight = Math.max(1, Math.floor(maxHeight));
  const rawX = Number.isFinite(selection.x) ? selection.x : 0;
  const rawY = Number.isFinite(selection.y) ? selection.y : 0;
  const rawWidth = Number.isFinite(selection.width) ? selection.width : safeMaxWidth;
  const rawHeight = Number.isFinite(selection.height) ? selection.height : safeMaxHeight;
  const x = clamp(Math.floor(rawX), 0, safeMaxWidth - 1);
  const y = clamp(Math.floor(rawY), 0, safeMaxHeight - 1);
  const right = clamp(Math.ceil(rawX + Math.max(1, rawWidth)), x + 1, safeMaxWidth);
  const bottom = clamp(Math.ceil(rawY + Math.max(1, rawHeight)), y + 1, safeMaxHeight);

  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y)
  };
};

const normalizeLinkedSplitPairSelection = (
  selection: LinkedSplitPairSelection,
  maxWidth: number,
  maxHeight: number
): LinkedSplitPairSelection => {
  const safeWidth = Math.max(1, Math.floor(maxWidth));
  const safeHeight = Math.max(1, Math.floor(maxHeight));
  const maxSize = Math.max(1, Math.min(safeWidth, safeHeight));
  const size = clamp(Math.round(selection.size || 0), 1, maxSize);
  const maxGap = Math.max(0, safeWidth - size * 2);
  const gap = clamp(Math.round(selection.gap || 0), 0, maxGap);
  const x = clamp(Math.round(selection.x || 0), 0, Math.max(0, safeWidth - (size * 2 + gap)));
  const y = clamp(Math.round(selection.y || 0), 0, Math.max(0, safeHeight - size));

  return {
    x,
    y,
    size,
    gap
  };
};

const createDefaultLinkedSplitPairSelection = (
  sourceWidth: number,
  sourceHeight: number
): LinkedSplitPairSelection => {
  const size = clamp(Math.round(Math.min(sourceWidth * 0.34, sourceHeight * 0.72)), 64, Math.min(sourceWidth, sourceHeight));
  const gap = Math.max(12, Math.round(size * 0.12));
  const totalWidth = size * 2 + gap;

  return normalizeLinkedSplitPairSelection(
    {
      x: Math.round((sourceWidth - totalWidth) / 2),
      y: Math.round((sourceHeight - size) / 2),
      size,
      gap
    },
    sourceWidth,
    sourceHeight
  );
};

const getLinkedSplitPairBounds = (
  selection: LinkedSplitPairSelection,
  sourceWidth: number,
  sourceHeight: number
): { normalizedSelection: LinkedSplitPairSelection; first: PixelBounds; second: PixelBounds } => {
  const normalizedSelection = normalizeLinkedSplitPairSelection(selection, sourceWidth, sourceHeight);
  const { x, y, size, gap } = normalizedSelection;

  return {
    normalizedSelection,
    first: {
      x,
      y,
      width: size,
      height: size
    },
    second: {
      x: x + size + gap,
      y,
      width: size,
      height: size
    }
  };
};

const mergeBounds = (first: PixelBounds, second: PixelBounds): PixelBounds => {
  const x = Math.min(first.x, second.x);
  const y = Math.min(first.y, second.y);
  const right = Math.max(first.x + first.width, second.x + second.width);
  const bottom = Math.max(first.y + first.height, second.y + second.height);

  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y)
  };
};

const expandBounds = (
  bounds: PixelBounds,
  paddingX: number,
  paddingY: number,
  maxWidth: number,
  maxHeight: number
): SplitRegionSelection =>
  normalizeRegionSelection(
    {
      x: bounds.x - paddingX,
      y: bounds.y - paddingY,
      width: bounds.width + paddingX * 2,
      height: bounds.height + paddingY * 2
    },
    maxWidth,
    maxHeight
  );

const createDefaultSplitRegion = (width: number, height: number): SplitRegionSelection => ({
  x: 0,
  y: 0,
  width: Math.max(1, width),
  height: Math.max(1, height)
});

const boundsIntersect = (a: PixelBounds, b: PixelBounds) => {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
};

const createForegroundMask = (source: HTMLCanvasElement): ForegroundMaskData | null => {
  const sourceWidth = source.width;
  const sourceHeight = source.height;
  if (sourceWidth < 2 || sourceHeight < 2) {
    return null;
  }

  const maxDetectionSize = 900;
  const scale = Math.min(1, maxDetectionSize / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const detectCanvas = createRuntimeCanvas(width, height) as unknown as HTMLCanvasElement;
  const detectCtx = getRuntimeCanvasContext(detectCanvas, { willReadFrequently: true });
  if (!detectCtx) return null;
  detectCtx.drawImage(source, 0, 0, width, height);

  const imageData = detectCtx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const borderStep = Math.max(1, Math.floor(Math.min(width, height) / 250));
  const sampledR: number[] = [];
  const sampledG: number[] = [];
  const sampledB: number[] = [];

  const samplePixel = (x: number, y: number) => {
    const idx = (y * width + x) * 4;
    sampledR.push(data[idx]);
    sampledG.push(data[idx + 1]);
    sampledB.push(data[idx + 2]);
  };

  for (let x = 0; x < width; x += borderStep) {
    samplePixel(x, 0);
    samplePixel(x, height - 1);
  }
  for (let y = 0; y < height; y += borderStep) {
    samplePixel(0, y);
    samplePixel(width - 1, y);
  }

  if (sampledR.length === 0) return null;

  const bgR = median(sampledR);
  const bgG = median(sampledG);
  const bgB = median(sampledB);

  const borderDiffs: number[] = [];
  for (let i = 0; i < sampledR.length; i += 1) {
    borderDiffs.push(
      Math.abs(sampledR[i] - bgR) +
        Math.abs(sampledG[i] - bgG) +
        Math.abs(sampledB[i] - bgB)
    );
  }

  const diffThreshold = clamp(quantile(borderDiffs, 0.95) + 16, 16, 120);
  const mask = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      const alpha = data[idx + 3];
      if (alpha < 20) continue;
      const diff =
        Math.abs(data[idx] - bgR) +
        Math.abs(data[idx + 1] - bgG) +
        Math.abs(data[idx + 2] - bgB);
      if (diff > diffThreshold) {
        mask[y * width + x] = 1;
      }
    }
  }

  return {
    width,
    height,
    sourceWidth,
    sourceHeight,
    scale,
    mask
  };
};

const collectForegroundBlobs = (
  mask: Uint8Array,
  width: number,
  height: number,
  minArea: number
): DetectionBlob[] => {
  const visited = new Uint8Array(mask.length);
  const blobs: DetectionBlob[] = [];

  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] === 0 || visited[index] === 1) continue;

    const queue: number[] = [index];
    visited[index] = 1;
    let pointer = 0;
    let area = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let touchesEdge = false;

    while (pointer < queue.length) {
      const current = queue[pointer++];
      const x = current % width;
      const y = Math.floor(current / width);
      area += 1;

      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        touchesEdge = true;
      }

      const neighbors = [current - 1, current + 1, current - width, current + width];
      for (const neighbor of neighbors) {
        if (neighbor < 0 || neighbor >= mask.length) continue;
        const nx = neighbor % width;
        if (Math.abs(nx - x) > 1) continue;
        if (mask[neighbor] === 0 || visited[neighbor] === 1) continue;

        visited[neighbor] = 1;
        queue.push(neighbor);
      }
    }

    if (area >= minArea) {
      blobs.push({
        x: minX,
        y: minY,
        width: Math.max(1, maxX - minX + 1),
        height: Math.max(1, maxY - minY + 1),
        area,
        touchesEdge
      });
    }
  }

  return blobs;
};

const toSourceBounds = (
  blob: PixelBounds,
  maskData: ForegroundMaskData,
  paddingRatio: number
): PixelBounds => {
  const padding = Math.max(1, Math.round(Math.min(maskData.width, maskData.height) * paddingRatio));
  const paddedX = clamp(blob.x - padding, 0, maskData.width - 1);
  const paddedY = clamp(blob.y - padding, 0, maskData.height - 1);
  const paddedRight = clamp(blob.x + blob.width + padding, 1, maskData.width);
  const paddedBottom = clamp(blob.y + blob.height + padding, 1, maskData.height);

  const scale = maskData.scale > 0 ? maskData.scale : 1;
  const x = clamp(Math.floor(paddedX / scale), 0, maskData.sourceWidth - 1);
  const y = clamp(Math.floor(paddedY / scale), 0, maskData.sourceHeight - 1);
  const width = clamp(Math.ceil((paddedRight - paddedX) / scale), 1, maskData.sourceWidth - x);
  const height = clamp(Math.ceil((paddedBottom - paddedY) / scale), 1, maskData.sourceHeight - y);

  return { x, y, width, height };
};

const centerCropToSize = (
  source: HTMLCanvasElement,
  targetWidth: number,
  targetHeight: number
): HTMLCanvasElement => {
  if (source.width === targetWidth && source.height === targetHeight) {
    return source;
  }

  const offsetX = Math.max(0, Math.floor((source.width - targetWidth) / 2));
  const offsetY = Math.max(0, Math.floor((source.height - targetHeight) / 2));
  return cropCanvas(source, {
    x: offsetX,
    y: offsetY,
    width: targetWidth,
    height: targetHeight
  });
};

const normalizeExtractedPairSize = (
  first: HTMLCanvasElement,
  second: HTMLCanvasElement
): { first: HTMLCanvasElement; second: HTMLCanvasElement } => {
  const targetWidth = Math.max(1, Math.min(first.width, second.width));
  const targetHeight = Math.max(1, Math.min(first.height, second.height));

  return {
    first: centerCropToSize(first, targetWidth, targetHeight),
    second: centerCropToSize(second, targetWidth, targetHeight)
  };
};

const toGrayscale = (source: HTMLCanvasElement, width: number, height: number): Uint8Array => {
  const canvas = createRuntimeCanvas(width, height) as unknown as HTMLCanvasElement;
  const ctx = getRuntimeCanvasContext(canvas, { willReadFrequently: true });
  if (!ctx) return new Uint8Array(width * height);

  ctx.drawImage(source, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height).data;
  const gray = new Uint8Array(width * height);

  for (let i = 0, p = 0; i < gray.length; i += 1, p += 4) {
    gray[i] = Math.round(data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114);
  }
  return gray;
};

const sampleGrayPatch = (
  gray: Uint8Array,
  width: number,
  x: number,
  y: number,
  size: number
): Uint8Array => {
  const patch = new Uint8Array(size * size);
  for (let row = 0; row < size; row += 1) {
    const sourceOffset = (y + row) * width + x;
    patch.set(gray.subarray(sourceOffset, sourceOffset + size), row * size);
  }
  return patch;
};

const evaluateGrayPatchDifference = (
  referencePatch: Uint8Array,
  gray: Uint8Array,
  grayWidth: number,
  candidateX: number,
  candidateY: number,
  size: number,
  stride: number,
  shiftPenalty: number
): number => {
  let diffSum = 0;
  let count = 0;

  for (let y = 0; y < size; y += stride) {
    const patchRow = y * size;
    const grayRow = (candidateY + y) * grayWidth + candidateX;
    for (let x = 0; x < size; x += stride) {
      diffSum += Math.abs(referencePatch[patchRow + x] - gray[grayRow + x]);
      count += 1;
    }
  }

  if (count === 0) {
    return Number.POSITIVE_INFINITY;
  }

  return diffSum / count + shiftPenalty;
};

const upsertAssistPlacementCandidate = (
  candidates: AssistPlacementCandidate[],
  nextCandidate: AssistPlacementCandidate,
  maxCount: number
) => {
  const existingIndex = candidates.findIndex(
    (candidate) =>
      Math.abs(candidate.x - nextCandidate.x) <= 1 && Math.abs(candidate.y - nextCandidate.y) <= 1
  );

  if (existingIndex >= 0) {
    if (nextCandidate.patchScore < candidates[existingIndex].patchScore) {
      candidates[existingIndex] = nextCandidate;
    }
  } else {
    candidates.push(nextCandidate);
  }

  candidates.sort((left, right) => left.patchScore - right.patchScore);
  if (candidates.length > maxCount) {
    candidates.length = maxCount;
  }
};

const scoreLinkedSplitPairDetectorPass = (
  regionCount: number,
  totalAreaRatio: number,
  largestAreaRatio: number,
  alignmentDx: number,
  alignmentDy: number
) => {
  const countPenalty =
    regionCount === 0
      ? 90
      : Math.abs(regionCount - 3) * 18 + (regionCount > 6 ? (regionCount - 6) * 14 : 0);
  const totalAreaPenalty =
    totalAreaRatio > 0.16 ? (totalAreaRatio - 0.16) * 480 : totalAreaRatio * 24;
  const largestRegionPenalty =
    largestAreaRatio > 0.08 ? (largestAreaRatio - 0.08) * 520 : largestAreaRatio * 18;
  const alignmentPenalty = (Math.abs(alignmentDx) + Math.abs(alignmentDy)) * 0.8;
  const exactThreeBonus = regionCount === 3 ? -18 : 0;

  return countPenalty + totalAreaPenalty + largestRegionPenalty + alignmentPenalty + exactThreeBonus;
};

const scoreLinkedSplitPairAssistCandidate = async (
  firstCanvas: HTMLCanvasElement,
  secondCanvas: HTMLCanvasElement,
  patchScore: number
): Promise<number> => {
  const firstSrc = firstCanvas.toDataURL('image/png');
  const secondSrc = secondCanvas.toDataURL('image/png');
  const canvasArea = Math.max(1, firstCanvas.width * firstCanvas.height);
  const detectorPasses: DifferenceDetectionOptions[] = [
    {
      diffThreshold: 42,
      blurRadius: 1,
      minAreaRatio: 0.0007,
      maxRegionAreaRatio: 0.08,
      maxRegions: 8,
      regionPaddingPx: 8,
      mergeDistancePx: 16,
      borderIgnoreRatio: 0.01,
      enableAlignment: true,
      maxAlignmentShiftRatio: 0.06,
      minAlignmentOverlapRatio: 0.68
    },
    {
      diffThreshold: 54,
      blurRadius: 1,
      minAreaRatio: 0.0009,
      maxRegionAreaRatio: 0.075,
      maxRegions: 7,
      regionPaddingPx: 8,
      mergeDistancePx: 14,
      borderIgnoreRatio: 0.015,
      enableAlignment: true,
      maxAlignmentShiftRatio: 0.06,
      minAlignmentOverlapRatio: 0.68
    },
    {
      diffThreshold: 66,
      blurRadius: 2,
      minAreaRatio: 0.0012,
      maxRegionAreaRatio: 0.07,
      maxRegions: 6,
      regionPaddingPx: 10,
      mergeDistancePx: 18,
      borderIgnoreRatio: 0.02,
      enableAlignment: true,
      maxAlignmentShiftRatio: 0.06,
      minAlignmentOverlapRatio: 0.68
    },
    {
      diffThreshold: 78,
      blurRadius: 2,
      minAreaRatio: 0.0015,
      maxRegionAreaRatio: 0.06,
      maxRegions: 5,
      regionPaddingPx: 10,
      mergeDistancePx: 18,
      borderIgnoreRatio: 0.025,
      enableAlignment: true,
      maxAlignmentShiftRatio: 0.06,
      minAlignmentOverlapRatio: 0.68
    }
  ];

  let bestDetectorScore = Number.POSITIVE_INFINITY;
  let exactThreeHitCount = 0;

  for (const pass of detectorPasses) {
    try {
      const processed = await detectDifferencesClientSide(firstSrc, secondSrc, pass);
      const totalAreaRatio =
        processed.regions.reduce((sum, region) => sum + region.width * region.height, 0) / canvasArea;
      const largestAreaRatio =
        processed.regions.reduce(
          (largest, region) => Math.max(largest, (region.width * region.height) / canvasArea),
          0
        );
      if (processed.regions.length === 3) {
        exactThreeHitCount += 1;
      }

      const detectorScore = scoreLinkedSplitPairDetectorPass(
        processed.regions.length,
        totalAreaRatio,
        largestAreaRatio,
        processed.alignment.dx,
        processed.alignment.dy
      );
      if (detectorScore < bestDetectorScore) {
        bestDetectorScore = detectorScore;
      }
    } catch {
      // Ignore failed passes and keep scoring with the others.
    }
  }

  if (!Number.isFinite(bestDetectorScore)) {
    bestDetectorScore = 120;
  }

  const repeatBonus = exactThreeHitCount * 9;
  return bestDetectorScore + patchScore * 0.55 - repeatBonus;
};

const searchLinkedSplitPairAssistOffset = async (
  source: HTMLCanvasElement,
  selection: LinkedSplitPairSelection
): Promise<LinkedSplitPairAssistResult> => {
  const { normalizedSelection, first, second } = getLinkedSplitPairBounds(
    selection,
    source.width,
    source.height
  );
  const scale = Math.min(1, 160 / Math.max(1, normalizedSelection.size));
  const scaledWidth = Math.max(64, Math.round(source.width * scale));
  const scaledHeight = Math.max(64, Math.round(source.height * scale));
  const gray = toGrayscale(source, scaledWidth, scaledHeight);
  const scaledFirstX = clamp(Math.round(first.x * scale), 0, Math.max(0, scaledWidth - 1));
  const scaledFirstY = clamp(Math.round(first.y * scale), 0, Math.max(0, scaledHeight - 1));
  const scaledSecondX = clamp(Math.round(second.x * scale), 0, Math.max(0, scaledWidth - 1));
  const scaledSecondY = clamp(Math.round(second.y * scale), 0, Math.max(0, scaledHeight - 1));
  const scaledSize = clamp(
    Math.round(normalizedSelection.size * scale),
    24,
    Math.max(24, Math.min(scaledWidth, scaledHeight))
  );
  const safeFirstX = clamp(scaledFirstX, 0, Math.max(0, scaledWidth - scaledSize));
  const safeFirstY = clamp(scaledFirstY, 0, Math.max(0, scaledHeight - scaledSize));
  const safeSecondX = clamp(scaledSecondX, 0, Math.max(0, scaledWidth - scaledSize));
  const safeSecondY = clamp(scaledSecondY, 0, Math.max(0, scaledHeight - scaledSize));
  const referencePatch = sampleGrayPatch(gray, scaledWidth, safeFirstX, safeFirstY, scaledSize);
  const stride = scaledSize >= 96 ? 3 : 2;
  const minCandidateX = clamp(safeFirstX + scaledSize, 0, Math.max(0, scaledWidth - scaledSize));
  const maxCandidateX = Math.max(minCandidateX, scaledWidth - scaledSize);
  const maxShiftX = Math.max(10, Math.round(scaledSize * 1.4));
  const maxShiftY = Math.max(8, Math.round(scaledSize * 0.32));
  const searchStartX = clamp(safeSecondX - maxShiftX, minCandidateX, maxCandidateX);
  const searchEndX = clamp(safeSecondX + maxShiftX, minCandidateX, maxCandidateX);
  const searchStartY = clamp(safeSecondY - maxShiftY, 0, Math.max(0, scaledHeight - scaledSize));
  const searchEndY = clamp(safeSecondY + maxShiftY, 0, Math.max(0, scaledHeight - scaledSize));

  const evaluateAt = (candidateX: number, candidateY: number): number =>
    evaluateGrayPatchDifference(
      referencePatch,
      gray,
      scaledWidth,
      candidateX,
      candidateY,
      scaledSize,
      stride,
      (Math.abs(candidateX - safeSecondX) + Math.abs(candidateY - safeSecondY)) * 0.18
    );

  const candidates: AssistPlacementCandidate[] = [];
  const considerCandidate = (candidateX: number, candidateY: number) => {
    if (
      candidateX < minCandidateX ||
      candidateX > maxCandidateX ||
      candidateY < 0 ||
      candidateY > scaledHeight - scaledSize
    ) {
      return;
    }

    upsertAssistPlacementCandidate(
      candidates,
      {
        x: candidateX,
        y: candidateY,
        patchScore: evaluateAt(candidateX, candidateY)
      },
      10
    );
  };

  considerCandidate(safeSecondX, safeSecondY);

  const coarseStep = Math.max(2, Math.round(scaledSize * 0.06));
  for (let candidateY = searchStartY; candidateY <= searchEndY; candidateY += coarseStep) {
    for (let candidateX = searchStartX; candidateX <= searchEndX; candidateX += coarseStep) {
      considerCandidate(candidateX, candidateY);
    }
  }

  const wideStep = Math.max(3, Math.round(scaledSize * 0.08));
  for (let candidateY = 0; candidateY <= Math.max(0, scaledHeight - scaledSize); candidateY += wideStep) {
    for (let candidateX = minCandidateX; candidateX <= maxCandidateX; candidateX += wideStep) {
      considerCandidate(candidateX, candidateY);
    }
  }

  const refinementSeeds = [...candidates];
  for (const seed of refinementSeeds) {
    for (let candidateY = seed.y - coarseStep; candidateY <= seed.y + coarseStep; candidateY += 1) {
      for (let candidateX = seed.x - coarseStep; candidateX <= seed.x + coarseStep; candidateX += 1) {
        considerCandidate(candidateX, candidateY);
      }
    }
  }

  const scaleX = source.width / scaledWidth;
  const scaleY = source.height / scaledHeight;
  const firstCanvas = cropCanvas(source, first);
  let bestFinalCandidate: AssistPlacementCandidate | null = null;
  let bestFinalScore = Number.POSITIVE_INFINITY;

  for (const candidate of candidates.slice(0, 6)) {
    const sourceSecondX = clamp(
      Math.round(candidate.x * scaleX),
      normalizedSelection.x + normalizedSelection.size,
      Math.max(
        normalizedSelection.x + normalizedSelection.size,
        source.width - normalizedSelection.size
      )
    );
    const sourceSecondY = clamp(
      Math.round(candidate.y * scaleY),
      0,
      Math.max(0, source.height - normalizedSelection.size)
    );
    const secondCanvas = cropCanvas(source, {
      x: sourceSecondX,
      y: sourceSecondY,
      width: normalizedSelection.size,
      height: normalizedSelection.size
    });
    const finalScore = await scoreLinkedSplitPairAssistCandidate(
      firstCanvas,
      secondCanvas,
      candidate.patchScore
    );
    if (finalScore < bestFinalScore) {
      bestFinalScore = finalScore;
      bestFinalCandidate = candidate;
    }
  }

  const winner = bestFinalCandidate ?? candidates[0] ?? { x: safeSecondX, y: safeSecondY, patchScore: evaluateAt(safeSecondX, safeSecondY) };
  const adjustedSecondX = clamp(
    Math.round(winner.x * scaleX),
    normalizedSelection.x + normalizedSelection.size,
    Math.max(
      normalizedSelection.x + normalizedSelection.size,
      source.width - normalizedSelection.size
    )
  );
  const adjustedGap = clamp(
    adjustedSecondX - normalizedSelection.x - normalizedSelection.size,
    0,
    Math.max(0, source.width - normalizedSelection.x - normalizedSelection.size * 2)
  );
  const dx = adjustedSecondX - second.x;
  const dy = Math.round(winner.y * scaleY) - second.y;

  return {
    selection: normalizeLinkedSplitPairSelection(
      {
        ...normalizedSelection,
        gap: adjustedGap
      },
      source.width,
      source.height
    ),
    dx,
    dy,
    score: Number((bestFinalCandidate ? bestFinalScore : winner.patchScore).toFixed(2))
  };
};

const estimateBestAlignmentOffset = (
  first: HTMLCanvasElement,
  second: HTMLCanvasElement
): AlignmentOffset => {
  const targetWidth = Math.max(1, Math.min(first.width, second.width));
  const targetHeight = Math.max(1, Math.min(first.height, second.height));
  const sampleScale = Math.min(1, 280 / Math.max(targetWidth, targetHeight));
  const sampleWidth = Math.max(48, Math.round(targetWidth * sampleScale));
  const sampleHeight = Math.max(48, Math.round(targetHeight * sampleScale));
  const grayA = toGrayscale(first, sampleWidth, sampleHeight);
  const grayB = toGrayscale(second, sampleWidth, sampleHeight);
  const maxShift = Math.max(3, Math.floor(Math.min(sampleWidth, sampleHeight) * 0.08));
  const minOverlapRatio = 0.58;

  const evaluateShift = (dx: number, dy: number): number => {
    const xStart = Math.max(0, dx);
    const xEnd = Math.min(sampleWidth, sampleWidth + dx);
    const yStart = Math.max(0, dy);
    const yEnd = Math.min(sampleHeight, sampleHeight + dy);
    const overlapWidth = xEnd - xStart;
    const overlapHeight = yEnd - yStart;
    if (overlapWidth <= 1 || overlapHeight <= 1) return Number.POSITIVE_INFINITY;

    const overlapPixels = overlapWidth * overlapHeight;
    const overlapRatio = overlapPixels / (sampleWidth * sampleHeight);
    if (overlapRatio < minOverlapRatio) return Number.POSITIVE_INFINITY;

    let diffSum = 0;
    let count = 0;
    const stride = 2;

    for (let y = yStart; y < yEnd; y += stride) {
      const rowA = y * sampleWidth;
      const rowB = (y - dy) * sampleWidth;
      for (let x = xStart; x < xEnd; x += stride) {
        const aIndex = rowA + x;
        const bIndex = rowB + (x - dx);
        diffSum += Math.abs(grayA[aIndex] - grayB[bIndex]);
        count += 1;
      }
    }

    if (!count) return Number.POSITIVE_INFINITY;
    const meanDiff = diffSum / count;
    const shiftPenalty = (Math.abs(dx) + Math.abs(dy)) * 0.5;
    return meanDiff + shiftPenalty;
  };

  let bestDx = 0;
  let bestDy = 0;
  let bestScore = evaluateShift(0, 0);

  for (let dy = -maxShift; dy <= maxShift; dy += 2) {
    for (let dx = -maxShift; dx <= maxShift; dx += 2) {
      const score = evaluateShift(dx, dy);
      if (score < bestScore) {
        bestScore = score;
        bestDx = dx;
        bestDy = dy;
      }
    }
  }

  for (let dy = bestDy - 2; dy <= bestDy + 2; dy += 1) {
    for (let dx = bestDx - 2; dx <= bestDx + 2; dx += 1) {
      const score = evaluateShift(dx, dy);
      if (score < bestScore) {
        bestScore = score;
        bestDx = dx;
        bestDy = dy;
      }
    }
  }

  const scaleX = targetWidth / sampleWidth;
  const scaleY = targetHeight / sampleHeight;
  return {
    dx: Math.round(bestDx * scaleX),
    dy: Math.round(bestDy * scaleY),
    score: bestScore
  };
};

const applyAlignmentOffset = (
  first: HTMLCanvasElement,
  second: HTMLCanvasElement,
  offset: AlignmentOffset
): { first: HTMLCanvasElement; second: HTMLCanvasElement } => {
  const width = Math.min(first.width, second.width);
  const height = Math.min(first.height, second.height);
  if (width < 2 || height < 2) {
    return { first, second };
  }

  const dx = clamp(offset.dx, -Math.floor(width * 0.15), Math.floor(width * 0.15));
  const dy = clamp(offset.dy, -Math.floor(height * 0.15), Math.floor(height * 0.15));
  const xStart = Math.max(0, dx);
  const yStart = Math.max(0, dy);
  const xEnd = Math.min(width, width + dx);
  const yEnd = Math.min(height, height + dy);
  const overlapWidth = xEnd - xStart;
  const overlapHeight = yEnd - yStart;
  const overlapRatio = (overlapWidth * overlapHeight) / (width * height);

  if (overlapWidth < 2 || overlapHeight < 2 || overlapRatio < 0.6) {
    return { first, second };
  }

  const alignedFirst = cropCanvas(first, {
    x: xStart,
    y: yStart,
    width: overlapWidth,
    height: overlapHeight
  });

  const alignedSecond = cropCanvas(second, {
    x: xStart - dx,
    y: yStart - dy,
    width: overlapWidth,
    height: overlapHeight
  });

  return {
    first: alignedFirst,
    second: alignedSecond
  };
};

const refineExtractedPairAlignment = (
  first: HTMLCanvasElement,
  second: HTMLCanvasElement
): { first: HTMLCanvasElement; second: HTMLCanvasElement } => {
  const normalized = normalizeExtractedPairSize(first, second);
  const offset = estimateBestAlignmentOffset(normalized.first, normalized.second);
  const aligned = applyAlignmentOffset(normalized.first, normalized.second, offset);
  const minDimension = Math.min(aligned.first.width, aligned.first.height, aligned.second.width, aligned.second.height);
  if (minDimension < 80) return aligned;

  const trimRatio = 0.035;
  const trimX = Math.max(2, Math.round(minDimension * trimRatio));
  const trimY = Math.max(2, Math.round(minDimension * trimRatio));
  const targetWidth = Math.max(1, Math.min(aligned.first.width, aligned.second.width) - trimX * 2);
  const targetHeight = Math.max(1, Math.min(aligned.first.height, aligned.second.height) - trimY * 2);
  if (targetWidth < 32 || targetHeight < 32) return aligned;

  return {
    first: centerCropToSize(aligned.first, targetWidth, targetHeight),
    second: centerCropToSize(aligned.second, targetWidth, targetHeight)
  };
};

const detectFramedBounds = (source: HTMLCanvasElement): PixelBounds | null => {
  const maskData = createForegroundMask(source);
  if (!maskData) return null;

  const minArea = Math.max(64, Math.floor(maskData.width * maskData.height * 0.01));
  const blobs = collectForegroundBlobs(maskData.mask, maskData.width, maskData.height, minArea);
  if (blobs.length === 0) return null;

  const imageArea = maskData.width * maskData.height;
  const scoreBlob = (blob: DetectionBlob) => {
    const areaScore = blob.area / Math.max(1, imageArea);
    const densityScore = blob.area / Math.max(1, blob.width * blob.height);
    const squareScore = computeSquareScore(blob.width, blob.height);
    return squareScore * 3 + areaScore + densityScore * 0.5 - (blob.touchesEdge ? 0.45 : 0);
  };

  const sorted = [...blobs].sort((a, b) => scoreBlob(b) - scoreBlob(a));

  return toSourceBounds(sorted[0], maskData, 0.02);
};

const detectFramedPairBounds = (
  source: HTMLCanvasElement,
  existingMaskData?: ForegroundMaskData | null
): { first: PixelBounds; second: PixelBounds } | null => {
  const maskData = existingMaskData ?? createForegroundMask(source);
  if (!maskData) return null;

  const imageArea = maskData.width * maskData.height;
  const minArea = Math.max(64, Math.floor(imageArea * 0.004));
  const blobs = collectForegroundBlobs(maskData.mask, maskData.width, maskData.height, minArea);
  if (blobs.length < 2) return null;

  const candidates = blobs
    .filter((blob) => {
      const ratio = blob.width / Math.max(1, blob.height);
      const areaRatio = blob.area / imageArea;
      return ratio > 0.55 && ratio < 1.8 && areaRatio > 0.025;
    })
    .sort((a, b) => b.area - a.area)
    .slice(0, 12);

  if (candidates.length < 2) return null;

  let bestPair: [DetectionBlob, DetectionBlob] | null = null;
  let bestScore = -Infinity;

  for (let i = 0; i < candidates.length - 1; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const first = candidates[i];
      const second = candidates[j];
      if (boundsIntersect(first, second)) continue;

      const areaRatio = Math.min(first.area, second.area) / Math.max(first.area, second.area);
      const firstCenterX = first.x + first.width / 2;
      const firstCenterY = first.y + first.height / 2;
      const secondCenterX = second.x + second.width / 2;
      const secondCenterY = second.y + second.height / 2;
      const centerDistance = Math.hypot(firstCenterX - secondCenterX, firstCenterY - secondCenterY);
      const separationScore = centerDistance / Math.max(maskData.width, maskData.height);
      const horizontalDistance = Math.abs(firstCenterX - secondCenterX);
      const verticalDistance = Math.abs(firstCenterY - secondCenterY);
      const horizontalLayout = horizontalDistance >= verticalDistance;
      const primaryDistance = horizontalLayout ? horizontalDistance : verticalDistance;
      const primarySize = horizontalLayout ? maskData.width : maskData.height;
      const secondaryOverlap = horizontalLayout
        ? Math.max(
            0,
            Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y)
          ) / Math.max(1, Math.min(first.height, second.height))
        : Math.max(
            0,
            Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x)
          ) / Math.max(1, Math.min(first.width, second.width));

      if (primaryDistance / Math.max(1, primarySize) < 0.2) continue;
      if (secondaryOverlap < 0.3) continue;

      const areaScore = (first.area + second.area) / imageArea;
      const squareScore = (computeSquareScore(first.width, first.height) + computeSquareScore(second.width, second.height)) / 2;
      if (squareScore < 0.3) continue;

      const densityScore =
        (first.area / Math.max(1, first.width * first.height) + second.area / Math.max(1, second.width * second.height)) / 2;
      const edgePenalty = (first.touchesEdge ? 0.12 : 0) + (second.touchesEdge ? 0.12 : 0);
      const score = areaRatio * 2.2 + separationScore + areaScore + squareScore * 3 + densityScore * 0.5 - edgePenalty;

      if (score > bestScore) {
        bestScore = score;
        bestPair = [first, second];
      }
    }
  }

  if (!bestPair || bestScore < 0.55) {
    return null;
  }

  return {
    first: toSourceBounds(bestPair[0], maskData, 0.02),
    second: toSourceBounds(bestPair[1], maskData, 0.02)
  };
};

const suggestSplitRegionFromCanvas = (
  source: HTMLCanvasElement,
  existingMaskData?: ForegroundMaskData | null
): SplitRegionSelection => {
  const width = source.width;
  const height = source.height;
  const maskData = existingMaskData ?? createForegroundMask(source);
  const padding = Math.max(10, Math.round(Math.min(width, height) * 0.025));

  const pairBounds = detectFramedPairBounds(source, maskData);
  if (pairBounds) {
    return expandBounds(mergeBounds(pairBounds.first, pairBounds.second), padding, padding, width, height);
  }

  const framedBounds = detectFramedBounds(source);
  if (framedBounds) {
    return expandBounds(framedBounds, padding, padding, width, height);
  }

  if (maskData) {
    const minArea = Math.max(32, Math.floor(maskData.width * maskData.height * 0.0015));
    const blobs = collectForegroundBlobs(maskData.mask, maskData.width, maskData.height, minArea);
    if (blobs.length > 0) {
      const mergedBlob = blobs.reduce<PixelBounds>(
        (current, blob) => mergeBounds(current, blob),
        blobs[0]
      );
      return expandBounds(toSourceBounds(mergedBlob, maskData, 0.02), padding, padding, width, height);
    }
  }

  return createDefaultSplitRegion(width, height);
};

const buildForegroundProjection = (maskData: ForegroundMaskData, axis: SplitAxis): number[] => {
  const length = axis === 'vertical' ? maskData.width : maskData.height;
  const projection = new Array(length).fill(0);

  for (let y = 0; y < maskData.height; y += 1) {
    const rowOffset = y * maskData.width;
    for (let x = 0; x < maskData.width; x += 1) {
      if (maskData.mask[rowOffset + x] === 0) continue;
      if (axis === 'vertical') {
        projection[x] += 1;
      } else {
        projection[y] += 1;
      }
    }
  }

  const crossLength = axis === 'vertical' ? maskData.height : maskData.width;
  return projection.map((value) => value / Math.max(1, crossLength));
};

const createCenterSplitCandidate = (source: HTMLCanvasElement, axis: SplitAxis): SeparatorCandidate => {
  const sourceLength = axis === 'vertical' ? source.width : source.height;
  const position = clamp(Math.floor(sourceLength / 2), 1, Math.max(1, sourceLength - 1));
  return {
    axis,
    start: position,
    end: position,
    confidence: 0,
    kind: 'center'
  };
};

const detectSeparatorCandidates = (
  source: HTMLCanvasElement,
  maskData: ForegroundMaskData | null,
  axis: SplitAxis
): SeparatorCandidate[] => {
  if (!maskData) {
    return [createCenterSplitCandidate(source, axis)];
  }

  const sourceLength = axis === 'vertical' ? source.width : source.height;
  const lineCount = axis === 'vertical' ? maskData.width : maskData.height;
  const searchStart = Math.max(2, Math.floor(lineCount * 0.18));
  const searchEnd = Math.min(lineCount - 3, Math.ceil(lineCount * 0.82));
  if (sourceLength < 8 || searchEnd <= searchStart) {
    return [createCenterSplitCandidate(source, axis)];
  }

  const rawProjection = buildForegroundProjection(maskData, axis);
  const smoothed = smoothSignal(rawProjection, Math.max(1, Math.round(lineCount * 0.015)));
  const searchWindow = smoothed.slice(searchStart, searchEnd + 1);
  if (!searchWindow.length) {
    return [createCenterSplitCandidate(source, axis)];
  }

  const baseline = Math.max(0.015, median(searchWindow));
  const valleyThreshold = Math.min(baseline * 0.72, quantile(searchWindow, 0.3) + 0.015);
  const prefix = new Array(smoothed.length + 1).fill(0);
  for (let i = 0; i < smoothed.length; i += 1) {
    prefix[i + 1] = prefix[i] + smoothed[i];
  }

  const scale = maskData.scale > 0 ? maskData.scale : 1;
  const minSideRatio = 0.14;
  const found: SeparatorCandidate[] = [];

  let index = searchStart;
  while (index <= searchEnd) {
    if (smoothed[index] > valleyThreshold) {
      index += 1;
      continue;
    }

    let start = index;
    let end = index;
    let minValue = smoothed[index];
    while (end + 1 <= searchEnd && smoothed[end + 1] <= valleyThreshold * 1.08) {
      end += 1;
      minValue = Math.min(minValue, smoothed[end]);
    }

    const startSource = clamp(Math.floor(start / scale), 1, sourceLength - 1);
    const endSource = clamp(Math.ceil((end + 1) / scale), startSource, sourceLength - 1);
    const firstLength = startSource;
    const secondLength = sourceLength - endSource;

    if (firstLength / sourceLength >= minSideRatio && secondLength / sourceLength >= minSideRatio) {
      const leftDensity = prefix[start] / Math.max(1, start);
      const rightDensity = (prefix[smoothed.length] - prefix[end + 1]) / Math.max(1, smoothed.length - (end + 1));
      const balance =
        leftDensity > 0 && rightDensity > 0 ? Math.min(leftDensity, rightDensity) / Math.max(leftDensity, rightDensity) : 0;
      const centerBias = 1 - Math.abs(((start + end) / 2) / Math.max(1, lineCount - 1) - 0.5) * 2;
      const gapDepth = clamp((baseline - minValue) / Math.max(0.01, baseline), 0, 2);
      const gapWidthRatio = (end - start + 1) / lineCount;
      const confidence = gapDepth * 2.4 + balance * 1.2 + centerBias * 0.5 + Math.min(gapWidthRatio * 6, 0.8);

      found.push({
        axis,
        start: startSource,
        end: endSource,
        confidence,
        kind: 'separator'
      });
    }

    index = end + 1;
  }

  const uniqueCandidates: SeparatorCandidate[] = [];
  for (const candidate of found.sort((a, b) => b.confidence - a.confidence)) {
    const duplicate = uniqueCandidates.some(
      (existing) => existing.axis === candidate.axis && Math.abs(existing.start - candidate.start) < 12 && Math.abs(existing.end - candidate.end) < 12
    );
    if (!duplicate) {
      uniqueCandidates.push(candidate);
    }
    if (uniqueCandidates.length >= 3) {
      break;
    }
  }

  return [createCenterSplitCandidate(source, axis), ...uniqueCandidates];
};

const buildSegmentBoundsFromCandidate = (
  source: HTMLCanvasElement,
  candidate: SeparatorCandidate
): { first: PixelBounds; second: PixelBounds } | null => {
  if (candidate.axis === 'vertical') {
    const firstWidth = candidate.start;
    const secondWidth = source.width - candidate.end;
    if (firstWidth < 8 || secondWidth < 8) return null;
    return {
      first: { x: 0, y: 0, width: firstWidth, height: source.height },
      second: { x: candidate.end, y: 0, width: secondWidth, height: source.height }
    };
  }

  const firstHeight = candidate.start;
  const secondHeight = source.height - candidate.end;
  if (firstHeight < 8 || secondHeight < 8) return null;
  return {
    first: { x: 0, y: 0, width: source.width, height: firstHeight },
    second: { x: 0, y: candidate.end, width: source.width, height: secondHeight }
  };
};

const measurePairDifference = (first: HTMLCanvasElement, second: HTMLCanvasElement): number => {
  const width = Math.max(1, Math.min(first.width, second.width));
  const height = Math.max(1, Math.min(first.height, second.height));
  const sampleScale = Math.min(1, 220 / Math.max(width, height));
  const sampleWidth = Math.max(40, Math.round(width * sampleScale));
  const sampleHeight = Math.max(40, Math.round(height * sampleScale));
  const grayA = toGrayscale(first, sampleWidth, sampleHeight);
  const grayB = toGrayscale(second, sampleWidth, sampleHeight);

  let diffSum = 0;
  for (let i = 0; i < grayA.length; i += 1) {
    diffSum += Math.abs(grayA[i] - grayB[i]);
  }
  return diffSum / Math.max(1, grayA.length);
};

const computeAspectPenalty = (source: HTMLCanvasElement) => {
  const ratio = Math.max(source.width / Math.max(1, source.height), source.height / Math.max(1, source.width));
  return Math.max(0, ratio - 2.6) * 8;
};

const computeSquarePenalty = (source: HTMLCanvasElement) => {
  const ratio = source.width / Math.max(1, source.height);
  return Math.abs(Math.log(Math.max(0.001, ratio))) * 22;
};

const evaluateExtractedPair = (
  first: HTMLCanvasElement,
  second: HTMLCanvasElement,
  sourceArea: number,
  confidenceBonus: number
): ExtractedPairCandidate | null => {
  const refined = refineExtractedPairAlignment(first, second);
  const minDimension = Math.min(refined.first.width, refined.first.height, refined.second.width, refined.second.height);
  if (minDimension < 24) return null;

  const firstArea = refined.first.width * refined.first.height;
  const secondArea = refined.second.width * refined.second.height;
  const averageCoverage = (firstArea + secondArea) / (2 * Math.max(1, sourceArea));
  const areaBalance = Math.min(firstArea, secondArea) / Math.max(firstArea, secondArea);
  const score =
    measurePairDifference(refined.first, refined.second) +
    computeAspectPenalty(refined.first) +
    computeAspectPenalty(refined.second) +
    computeSquarePenalty(refined.first) +
    computeSquarePenalty(refined.second) +
    (1 - areaBalance) * 18 +
    (averageCoverage < 0.035 ? (0.035 - averageCoverage) * 320 : 0) -
    confidenceBonus;

  return {
    first: refined.first,
    second: refined.second,
    score
  };
};

const extractCandidateFromPairBounds = (
  source: HTMLCanvasElement,
  pairBounds: { first: PixelBounds; second: PixelBounds }
): ExtractedPairCandidate | null => {
  const centerAX = pairBounds.first.x + pairBounds.first.width / 2;
  const centerAY = pairBounds.first.y + pairBounds.first.height / 2;
  const centerBX = pairBounds.second.x + pairBounds.second.width / 2;
  const centerBY = pairBounds.second.y + pairBounds.second.height / 2;
  const horizontalLayout = Math.abs(centerAX - centerBX) >= Math.abs(centerAY - centerBY);

  const [firstBounds, secondBounds] = horizontalLayout
    ? centerAX <= centerBX
      ? [pairBounds.first, pairBounds.second]
      : [pairBounds.second, pairBounds.first]
    : centerAY <= centerBY
      ? [pairBounds.first, pairBounds.second]
      : [pairBounds.second, pairBounds.first];

  return evaluateExtractedPair(
    cropCanvas(source, firstBounds),
    cropCanvas(source, secondBounds),
    source.width * source.height,
    4
  );
};

const extractCandidateFromSeparator = (
  source: HTMLCanvasElement,
  candidate: SeparatorCandidate
): ExtractedPairCandidate | null => {
  const segmentBounds = buildSegmentBoundsFromCandidate(source, candidate);
  if (!segmentBounds) return null;

  const firstSegment = cropCanvas(source, segmentBounds.first);
  const secondSegment = cropCanvas(source, segmentBounds.second);
  const firstBounds = detectFramedBounds(firstSegment);
  const secondBounds = detectFramedBounds(secondSegment);
  const extractedFirst = firstBounds ? cropCanvas(firstSegment, firstBounds) : firstSegment;
  const extractedSecond = secondBounds ? cropCanvas(secondSegment, secondBounds) : secondSegment;

  return evaluateExtractedPair(
    extractedFirst,
    extractedSecond,
    source.width * source.height,
    candidate.kind === 'separator' ? candidate.confidence * 2.5 : 0
  );
};

const extractSplitPairCanvasesFromCanvas = (
  sourceCanvas: HTMLCanvasElement,
  sourceMaskData?: ForegroundMaskData | null
): SplitPairCanvasData => {
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  if (width < 2 || height < 2) {
    throw new Error('Image is too small to split.');
  }

  const splitHorizontally = width >= height;
  const segmentWidth = splitHorizontally ? Math.floor(width / 2) : width;
  const segmentHeight = splitHorizontally ? height : Math.floor(height / 2);
  if (segmentWidth < 1 || segmentHeight < 1) {
    throw new Error('Unable to split image with current dimensions.');
  }
  const candidates: ExtractedPairCandidate[] = [];

  const pairBounds = detectFramedPairBounds(sourceCanvas, sourceMaskData);
  if (pairBounds) {
    const framedCandidate = extractCandidateFromPairBounds(sourceCanvas, pairBounds);
    if (framedCandidate) {
      candidates.push(framedCandidate);
    }
  }

  const separatorCandidates = [
    ...detectSeparatorCandidates(sourceCanvas, sourceMaskData, 'vertical'),
    ...detectSeparatorCandidates(sourceCanvas, sourceMaskData, 'horizontal')
  ];

  for (const candidate of separatorCandidates) {
    const extracted = extractCandidateFromSeparator(sourceCanvas, candidate);
    if (extracted) {
      candidates.push(extracted);
    }
  }

  let bestCandidate = candidates.sort((a, b) => a.score - b.score)[0];

  if (!bestCandidate) {
    const firstCanvas = createRuntimeCanvas(segmentWidth, segmentHeight) as unknown as HTMLCanvasElement;
    const firstCtx = getRuntimeCanvasContext(firstCanvas);

    const secondCanvas = createRuntimeCanvas(segmentWidth, segmentHeight) as unknown as HTMLCanvasElement;
    const secondCtx = getRuntimeCanvasContext(secondCanvas);

    if (!firstCtx || !secondCtx) {
      throw new Error('Canvas is not available for splitting.');
    }

    if (splitHorizontally) {
      firstCtx.drawImage(sourceCanvas, 0, 0, segmentWidth, height, 0, 0, segmentWidth, segmentHeight);
      secondCtx.drawImage(
        sourceCanvas,
        width - segmentWidth,
        0,
        segmentWidth,
        height,
        0,
        0,
        segmentWidth,
        segmentHeight
      );
    } else {
      firstCtx.drawImage(sourceCanvas, 0, 0, width, segmentHeight, 0, 0, segmentWidth, segmentHeight);
      secondCtx.drawImage(
        sourceCanvas,
        0,
        height - segmentHeight,
        width,
        segmentHeight,
        0,
        0,
        segmentWidth,
        segmentHeight
      );
    }

    const fallbackCandidate = evaluateExtractedPair(firstCanvas, secondCanvas, width * height, 0);
    if (!fallbackCandidate) {
      throw new Error('Could not extract a valid split pair from the image.');
    }
    bestCandidate = fallbackCandidate;
  }

  return {
    imageA: bestCandidate.first,
    imageB: bestCandidate.second
  };
};

const extractSplitPairFromCanvas = (
  sourceCanvas: HTMLCanvasElement,
  sourceMaskData?: ForegroundMaskData | null
): Promise<SplitPairData> => {
  const result = extractSplitPairCanvasesFromCanvas(sourceCanvas, sourceMaskData);
  return Promise.all([
    canvasToDataUrl(result.imageA, 'image/png'),
    canvasToDataUrl(result.imageB, 'image/png')
  ]).then(([imageA, imageB]) => ({
    imageA,
    imageB
  }));
};

const createSourceCanvasFromImageSource = async (imageSrc: string) => {
  const image = await loadImageFromSource(imageSrc);
  const width = Math.max(
    1,
    'naturalWidth' in image ? image.naturalWidth || image.width : image.width
  );
  const height = Math.max(
    1,
    'naturalHeight' in image ? image.naturalHeight || image.height : image.height
  );

  if (width < 2 || height < 2) {
    throw new Error('Image is too small to split.');
  }

  const sourceCanvas = createRuntimeCanvas(width, height) as unknown as HTMLCanvasElement;
  const sourceCtx = getRuntimeCanvasContext(sourceCanvas);
  if (!sourceCtx) {
    throw new Error('Canvas is not available for extraction.');
  }

  sourceCtx.drawImage(image, 0, 0, width, height);

  return {
    sourceCanvas,
    width,
    height
  };
};

export const splitCombinedImageSmart = async (imageSrc: string): Promise<SplitPairData> => {
  const { sourceCanvas } = await createSourceCanvasFromImageSource(imageSrc);
  const sourceMaskData = createForegroundMask(sourceCanvas);
  return await extractSplitPairFromCanvas(sourceCanvas, sourceMaskData);
};

export const splitCombinedBlobSmartToCanvas = async (blob: Blob): Promise<SplitPairCanvasData> => {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const { sourceCanvas } = await createSourceCanvasFromImageSource(objectUrl);
    const sourceMaskData = createForegroundMask(sourceCanvas);
    return extractSplitPairCanvasesFromCanvas(sourceCanvas, sourceMaskData);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

export const splitCombinedImageFromSelection = async (
  imageSrc: string,
  selection: SplitRegionSelection
): Promise<SplitPairData> => {
  const { sourceCanvas, width, height } = await createSourceCanvasFromImageSource(imageSrc);
  const normalizedSelection = normalizeRegionSelection(selection, width, height);
  return await extractSplitPairFromCanvas(cropCanvas(sourceCanvas, normalizedSelection));
};

export const splitCombinedBlobFromSelectionToCanvas = async (
  blob: Blob,
  selection: SplitRegionSelection
): Promise<SplitPairCanvasData> => {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const { sourceCanvas, width, height } = await createSourceCanvasFromImageSource(objectUrl);
    const normalizedSelection = normalizeRegionSelection(selection, width, height);
    return extractSplitPairCanvasesFromCanvas(cropCanvas(sourceCanvas, normalizedSelection));
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

export const splitCombinedImageFromLinkedSelection = async (
  imageSrc: string,
  selection: LinkedSplitPairSelection
): Promise<SplitPairData> => {
  const { sourceCanvas, width, height } = await createSourceCanvasFromImageSource(imageSrc);
  const bounds = getLinkedSplitPairBounds(selection, width, height);
  const first = cropCanvas(sourceCanvas, bounds.first);
  const second = cropCanvas(sourceCanvas, bounds.second);

  return {
    imageA: await canvasToDataUrl(first, 'image/png'),
    imageB: await canvasToDataUrl(second, 'image/png')
  };
};

export const assistLinkedSplitPairPlacement = async (
  imageSrc: string,
  selection: LinkedSplitPairSelection
): Promise<LinkedSplitPairAssistResult> => {
  const { sourceCanvas, width, height } = await createSourceCanvasFromImageSource(imageSrc);
  const normalizedSelection = normalizeLinkedSplitPairSelection(selection, width, height);
  return searchLinkedSplitPairAssistOffset(sourceCanvas, normalizedSelection);
};

export const splitCombinedFileSmart = async (file: File): Promise<SplitCombinedFileResult> => {
  const src = await readFileAsDataUrl(file);
  const { sourceCanvas, width, height } = await createSourceCanvasFromImageSource(src);
  const sourceMaskData = createForegroundMask(sourceCanvas);
  const result = await extractSplitPairFromCanvas(sourceCanvas, sourceMaskData);
  const baseName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;

  return {
    sourceName: file.name,
    baseName,
    sourceWidth: width,
    sourceHeight: height,
    suggestedRegion: suggestSplitRegionFromCanvas(sourceCanvas, sourceMaskData),
    imageA: result.imageA,
    imageB: result.imageB
  };
};

export const splitCombinedFileSmartToCanvas = async (file: File): Promise<SplitPairCanvasData> => {
  const src = await readFileAsDataUrl(file);
  const { sourceCanvas } = await createSourceCanvasFromImageSource(src);
  const sourceMaskData = createForegroundMask(sourceCanvas);
  return extractSplitPairCanvasesFromCanvas(sourceCanvas, sourceMaskData);
};

export const dataUrlToPngBlob = async (src: string): Promise<Blob> => {
  const image = await loadImageFromSource(src);
  const width = Math.max(1, 'naturalWidth' in image ? image.naturalWidth || image.width : image.width);
  const height = Math.max(1, 'naturalHeight' in image ? image.naturalHeight || image.height : image.height);
  const canvas = createRuntimeCanvas(width, height) as unknown as HTMLCanvasElement;
  const ctx = getRuntimeCanvasContext(canvas);
  if (!ctx) throw new Error('Canvas not available');
  ctx.drawImage(image, 0, 0, width, height);
  return await canvasToBlob(canvas, 'image/png');
};
