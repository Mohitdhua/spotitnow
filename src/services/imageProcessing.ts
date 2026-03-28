import { Region } from '../types';

import {
  canvasToDataUrl,
  createRuntimeCanvas,
  getRuntimeCanvasContext,
  loadRuntimeImageFromSource,
  type RuntimeImageLike
} from './canvasRuntime';

export interface DetectedImageAlignment {
  dx: number;
  dy: number;
  applied: boolean;
  baselineScore: number;
  bestScore: number;
  overlapRatio: number;
}

export interface ProcessedPuzzleData {
  regions: Region[];
  imageA: string; // Base64, potentially resized
  imageB: string; // Base64, potentially resized
  alignment: DetectedImageAlignment;
}

export interface ProcessedPuzzleCanvasData {
  regions: Region[];
  imageA: HTMLCanvasElement;
  imageB: HTMLCanvasElement;
  alignment: DetectedImageAlignment;
}

export interface DifferenceDetectionOptions {
  diffThreshold?: number;
  dilationPasses?: number;
  minAreaRatio?: number;
  mergeDistancePx?: number;
  blurRadius?: number;
  borderIgnoreRatio?: number;
  maxRegionAreaRatio?: number;
  maxRegions?: number;
  regionPaddingPx?: number;
  enableAlignment?: boolean;
  maxAlignmentShiftRatio?: number;
  minAlignmentOverlapRatio?: number;
  processingMaxDimension?: number;
}

interface AlignmentResult {
  dx: number;
  dy: number;
  baselineScore: number;
  bestScore: number;
  overlapRatio: number;
}

const DEFAULT_DILATION_PASSES = 2;
const DEFAULT_MERGE_DISTANCE_PX = 5;
const DEFAULT_PROCESSING_MAX_DIMENSION = 800;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const createCanvas = (width: number, height: number) => {
  return createRuntimeCanvas(width, height) as unknown as HTMLCanvasElement;
};

const drawSourceToCanvas = (source: CanvasImageSource, width: number, height: number) => {
  const canvas = createCanvas(width, height);
  const ctx = getRuntimeCanvasContext(canvas, { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
};

const cropCanvas = (source: HTMLCanvasElement, x: number, y: number, width: number, height: number) => {
  const canvas = createCanvas(width, height);
  const ctx = getRuntimeCanvasContext(canvas, { willReadFrequently: true });
  ctx.drawImage(source, x, y, width, height, 0, 0, width, height);
  return canvas;
};

const releaseCanvas = (canvas: HTMLCanvasElement | null | undefined) => {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
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

const alignSourceCanvases = (
  canvasA: HTMLCanvasElement,
  canvasB: HTMLCanvasElement,
  dx: number,
  dy: number
) => {
  const overlapWidth = canvasA.width - Math.abs(dx);
  const overlapHeight = canvasA.height - Math.abs(dy);
  if (overlapWidth < 2 || overlapHeight < 2) {
    return {
      canvasA,
      canvasB,
      applied: false
    };
  }

  const startAX = Math.max(0, dx);
  const startAY = Math.max(0, dy);
  const startBX = Math.max(0, -dx);
  const startBY = Math.max(0, -dy);

  return {
    canvasA: cropCanvas(canvasA, startAX, startAY, overlapWidth, overlapHeight),
    canvasB: cropCanvas(canvasB, startBX, startBY, overlapWidth, overlapHeight),
    applied: true
  };
};

const rgbaToGrayscale = (rgba: Uint8ClampedArray): Uint8Array => {
  const gray = new Uint8Array(rgba.length / 4);
  for (let i = 0, p = 0; i < gray.length; i += 1, p += 4) {
    gray[i] = Math.round(rgba[p] * 0.299 + rgba[p + 1] * 0.587 + rgba[p + 2] * 0.114);
  }
  return gray;
};

const estimateAlignment = (
  grayA: Uint8Array,
  grayB: Uint8Array,
  width: number,
  height: number,
  maxShift: number,
  minOverlapRatio: number
): AlignmentResult => {
  const evaluateShift = (dx: number, dy: number, stride: number): { score: number; overlapRatio: number } => {
    const xStart = Math.max(0, dx);
    const xEnd = Math.min(width, width + dx);
    const yStart = Math.max(0, dy);
    const yEnd = Math.min(height, height + dy);
    const overlapWidth = xEnd - xStart;
    const overlapHeight = yEnd - yStart;
    if (overlapWidth <= 1 || overlapHeight <= 1) {
      return { score: Number.POSITIVE_INFINITY, overlapRatio: 0 };
    }

    const overlapRatio = (overlapWidth * overlapHeight) / (width * height);
    if (overlapRatio < minOverlapRatio) {
      return { score: Number.POSITIVE_INFINITY, overlapRatio };
    }

    let sum = 0;
    let count = 0;
    for (let y = yStart; y < yEnd; y += stride) {
      const rowA = y * width;
      const rowB = (y - dy) * width;
      for (let x = xStart; x < xEnd; x += stride) {
        const aIndex = rowA + x;
        const bIndex = rowB + (x - dx);
        sum += Math.abs(grayA[aIndex] - grayB[bIndex]);
        count += 1;
      }
    }

    if (!count) {
      return { score: Number.POSITIVE_INFINITY, overlapRatio };
    }

    const meanDiff = sum / count;
    const shiftPenalty = (Math.abs(dx) + Math.abs(dy)) * 0.2;
    return { score: meanDiff + shiftPenalty, overlapRatio };
  };

  const baseline = evaluateShift(0, 0, 2);
  let bestDx = 0;
  let bestDy = 0;
  let bestScore = baseline.score;
  let bestOverlap = baseline.overlapRatio;

  for (let dy = -maxShift; dy <= maxShift; dy += 2) {
    for (let dx = -maxShift; dx <= maxShift; dx += 2) {
      const result = evaluateShift(dx, dy, 2);
      if (result.score < bestScore) {
        bestScore = result.score;
        bestDx = dx;
        bestDy = dy;
        bestOverlap = result.overlapRatio;
      }
    }
  }

  // Fine search around the best coarse offset.
  for (let dy = bestDy - 2; dy <= bestDy + 2; dy += 1) {
    for (let dx = bestDx - 2; dx <= bestDx + 2; dx += 1) {
      if (dx < -maxShift || dx > maxShift || dy < -maxShift || dy > maxShift) continue;
      const result = evaluateShift(dx, dy, 1);
      if (result.score < bestScore) {
        bestScore = result.score;
        bestDx = dx;
        bestDy = dy;
        bestOverlap = result.overlapRatio;
      }
    }
  }

  const improvement = baseline.score - bestScore;
  const applyShift = improvement > 1.5 && bestOverlap >= minOverlapRatio;

  return {
    dx: applyShift ? bestDx : 0,
    dy: applyShift ? bestDy : 0,
    baselineScore: baseline.score,
    bestScore,
    overlapRatio: bestOverlap
  };
};

export async function detectDifferencesClientSide(
  imageASrc: string,
  imageBSrc: string,
  options: DifferenceDetectionOptions = {}
): Promise<ProcessedPuzzleData> {
  return await processImagesFromSources(imageASrc, imageBSrc, options);
}

export async function detectDifferencesClientSideCanvases(
  imageA: HTMLCanvasElement,
  imageB: HTMLCanvasElement,
  options: DifferenceDetectionOptions = {}
): Promise<ProcessedPuzzleCanvasData> {
  const width = Math.max(1, imageA.width);
  const height = Math.max(1, imageA.height);
  const normalizedImageB =
    imageB.width === width && imageB.height === height
      ? imageB
      : drawSourceToCanvas(imageB, width, height);

  try {
    const processed = processCanvasImages(imageA, normalizedImageB, options);
    if (normalizedImageB !== imageB && processed.imageB !== normalizedImageB) {
      releaseCanvas(normalizedImageB);
    }
    return processed;
  } catch (error) {
    if (normalizedImageB !== imageB) {
      releaseCanvas(normalizedImageB);
    }
    throw error;
  }
}

const getRuntimeImageDimensions = (image: RuntimeImageLike) => ({
  width: Math.max(1, 'naturalWidth' in image ? image.naturalWidth || image.width : image.width),
  height: Math.max(1, 'naturalHeight' in image ? image.naturalHeight || image.height : image.height)
});

const releaseRuntimeImage = (image: RuntimeImageLike) => {
  if ('close' in image && typeof image.close === 'function') {
    image.close();
  }
};

async function processImagesFromSources(
  srcA: string,
  srcB: string,
  options: DifferenceDetectionOptions
): Promise<ProcessedPuzzleData> {
  const [imageA, imageB] = await Promise.all([
    loadRuntimeImageFromSource(srcA),
    loadRuntimeImageFromSource(srcB)
  ]);
  try {
    const { width, height } = getRuntimeImageDimensions(imageA);
    const sourceCanvasA = drawSourceToCanvas(imageA, width, height);
    const sourceCanvasB = drawSourceToCanvas(imageB, width, height);
    const processed = processCanvasImages(sourceCanvasA, sourceCanvasB, options);

    try {
      return {
        regions: processed.regions,
        imageA: processed.imageA === sourceCanvasA ? srcA : await canvasToDataUrl(processed.imageA, 'image/png'),
        imageB: processed.imageB === sourceCanvasB ? srcB : await canvasToDataUrl(processed.imageB, 'image/png'),
        alignment: processed.alignment
      };
    } finally {
      releaseCanvases(sourceCanvasA, sourceCanvasB, processed.imageA, processed.imageB);
    }
  } finally {
    releaseRuntimeImage(imageA);
    releaseRuntimeImage(imageB);
  }
}

function processCanvasImages(
  sourceCanvasA: HTMLCanvasElement,
  sourceCanvasB: HTMLCanvasElement,
  options: DifferenceDetectionOptions
): ProcessedPuzzleCanvasData {
  const width = Math.max(1, sourceCanvasA.width);
  const height = Math.max(1, sourceCanvasA.height);
  let workingCanvasA = sourceCanvasA;
  let workingCanvasB = sourceCanvasB;
  const blurRadius = options.blurRadius ?? 2;
  const processingMaxDimension = Math.max(64, Math.floor(options.processingMaxDimension ?? DEFAULT_PROCESSING_MAX_DIMENSION));
  const maxAlignmentShiftRatio = Math.max(0, Math.min(0.3, options.maxAlignmentShiftRatio ?? 0.1));
  const minAlignmentOverlapRatio = Math.max(0.4, Math.min(0.95, options.minAlignmentOverlapRatio ?? 0.6));
  const shouldRunAlignment = options.enableAlignment !== false && maxAlignmentShiftRatio > 0;
  let alignmentCanvasA: HTMLCanvasElement | null = null;
  let alignmentCanvasB: HTMLCanvasElement | null = null;
  let smallCanvasA: HTMLCanvasElement | null = null;
  let smallCanvasB: HTMLCanvasElement | null = null;
  const alignmentInfo: DetectedImageAlignment = {
    dx: 0,
    dy: 0,
    applied: false,
    baselineScore: 0,
    bestScore: 0,
    overlapRatio: 1
  };

  try {
    if (shouldRunAlignment) {
      const alignmentScale = Math.min(1, DEFAULT_PROCESSING_MAX_DIMENSION / width);
      const alignmentWidth = Math.max(1, Math.floor(width * alignmentScale));
      const alignmentHeight = Math.max(1, Math.floor(height * alignmentScale));
      const maxShift = Math.max(0, Math.floor(Math.min(alignmentWidth, alignmentHeight) * maxAlignmentShiftRatio));

      if (maxShift >= 1) {
        alignmentCanvasA = createCanvas(alignmentWidth, alignmentHeight);
        alignmentCanvasB = createCanvas(alignmentWidth, alignmentHeight);
        const alignmentCtxA = getRuntimeCanvasContext(alignmentCanvasA, { willReadFrequently: true });
        const alignmentCtxB = getRuntimeCanvasContext(alignmentCanvasB, { willReadFrequently: true });

        alignmentCtxA.filter = blurRadius > 0 ? `blur(${blurRadius}px)` : 'none';
        alignmentCtxA.drawImage(sourceCanvasA, 0, 0, alignmentWidth, alignmentHeight);
        alignmentCtxB.filter = blurRadius > 0 ? `blur(${blurRadius}px)` : 'none';
        alignmentCtxB.drawImage(sourceCanvasB, 0, 0, alignmentWidth, alignmentHeight);

        const grayA = rgbaToGrayscale(alignmentCtxA.getImageData(0, 0, alignmentWidth, alignmentHeight).data);
        const grayB = rgbaToGrayscale(alignmentCtxB.getImageData(0, 0, alignmentWidth, alignmentHeight).data);
        const alignment = estimateAlignment(
          grayA,
          grayB,
          alignmentWidth,
          alignmentHeight,
          maxShift,
          minAlignmentOverlapRatio
        );

        const sourceDx = Math.round(alignment.dx * (width / alignmentWidth));
        const sourceDy = Math.round(alignment.dy * (height / alignmentHeight));
        alignmentInfo.dx = sourceDx;
        alignmentInfo.dy = sourceDy;
        alignmentInfo.applied = sourceDx !== 0 || sourceDy !== 0;
        alignmentInfo.baselineScore = alignment.baselineScore;
        alignmentInfo.bestScore = alignment.bestScore;
        alignmentInfo.overlapRatio = alignment.overlapRatio;

        if (alignmentInfo.applied) {
          const aligned = alignSourceCanvases(sourceCanvasA, sourceCanvasB, sourceDx, sourceDy);
          if (aligned.applied) {
            workingCanvasA = aligned.canvasA;
            workingCanvasB = aligned.canvasB;
          } else {
            alignmentInfo.applied = false;
            alignmentInfo.dx = 0;
            alignmentInfo.dy = 0;
          }
        }
      }
    }

    const workingWidth = workingCanvasA.width;
    const workingHeight = workingCanvasA.height;
    const procScale = Math.min(1, processingMaxDimension / workingWidth);
    const procW = Math.max(1, Math.floor(workingWidth * procScale));
    const procH = Math.max(1, Math.floor(workingHeight * procScale));

    smallCanvasA = createCanvas(procW, procH);
    smallCanvasB = createCanvas(procW, procH);
    const smallCtxA = getRuntimeCanvasContext(smallCanvasA, { willReadFrequently: true });
    const smallCtxB = getRuntimeCanvasContext(smallCanvasB, { willReadFrequently: true });

    smallCtxA.filter = blurRadius > 0 ? `blur(${blurRadius}px)` : 'none';
    smallCtxA.drawImage(workingCanvasA, 0, 0, procW, procH);
    const smallDataA = smallCtxA.getImageData(0, 0, procW, procH).data;

    smallCtxB.filter = blurRadius > 0 ? `blur(${blurRadius}px)` : 'none';
    smallCtxB.drawImage(workingCanvasB, 0, 0, procW, procH);
    const smallDataB = smallCtxB.getImageData(0, 0, procW, procH).data;

    const binaryMap = new Uint8Array(procW * procH);
    const diffThreshold = options.diffThreshold ?? 60;
    const borderIgnoreRatio = Math.max(0, Math.min(0.45, options.borderIgnoreRatio ?? 0));
    const ignoreX = Math.floor(procW * borderIgnoreRatio);
    const ignoreY = Math.floor(procH * borderIgnoreRatio);

    for (let y = 0; y < procH; y += 1) {
      if (ignoreY > 0 && (y < ignoreY || y >= procH - ignoreY)) {
        continue;
      }
      for (let x = 0; x < procW; x += 1) {
        if (ignoreX > 0 && (x < ignoreX || x >= procW - ignoreX)) {
          continue;
        }
        const pixelIndex = y * procW + x;
        const dataIndex = pixelIndex * 4;
        const r1 = smallDataA[dataIndex];
        const g1 = smallDataA[dataIndex + 1];
        const b1 = smallDataA[dataIndex + 2];
        const r2 = smallDataB[dataIndex];
        const g2 = smallDataB[dataIndex + 1];
        const b2 = smallDataB[dataIndex + 2];

        const diff = Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
        if (diff > diffThreshold) {
          binaryMap[pixelIndex] = 1;
        }
      }
    }

    const dilationPasses = Math.max(0, Math.floor(options.dilationPasses ?? DEFAULT_DILATION_PASSES));
    const dilatedMap = dilate(binaryMap, procW, procH, dilationPasses);
    let rects = findContours(dilatedMap, procW, procH);
    const mergeDistancePx = Math.max(0, options.mergeDistancePx ?? DEFAULT_MERGE_DISTANCE_PX);
    rects = mergeNearbyRects(rects, mergeDistancePx, procScale);

    const finalRegions: Region[] = [];
    const minArea = (procW * procH) * (options.minAreaRatio ?? 0.001);
    const maxArea = (procW * procH) * (options.maxRegionAreaRatio ?? 1);
    const padding = Math.max(1, Math.round(options.regionPaddingPx ?? 5));
    const candidates: Array<{ region: Region; area: number }> = [];

    rects.forEach(rect => {
      const area = rect.width * rect.height;
      if (area > minArea && area <= maxArea) {
        const x = Math.max(0, rect.x - padding);
        const y = Math.max(0, rect.y - padding);
        const w = Math.min(procW - x, rect.width + padding * 2);
        const h = Math.min(procH - y, rect.height + padding * 2);
        if (w > 0 && h > 0) {
          candidates.push({
            area,
            region: {
              id: Math.random().toString(36).substring(2),
              x: x / procW,
              y: y / procH,
              width: w / procW,
              height: h / procH
            }
          });
        }
      }
    });

    const maxRegions = Math.max(1, options.maxRegions ?? 24);
    candidates
      .sort((a, b) => b.area - a.area)
      .slice(0, maxRegions)
      .forEach((entry) => finalRegions.push(entry.region));

    return {
      regions: finalRegions,
      imageA: workingCanvasA,
      imageB: workingCanvasB,
      alignment: alignmentInfo
    };
  } finally {
    releaseCanvases(alignmentCanvasA, alignmentCanvasB, smallCanvasA, smallCanvasB);
  }
}

function mergeNearbyRects(rects: Rect[], maxGapSourcePx: number, procScale: number): Rect[] {
  let merged = [...rects];
  let changed = true;
  
  while (changed) {
    changed = false;
    const newMerged: Rect[] = [];
    const used = new Array(merged.length).fill(false);
    
    for (let i = 0; i < merged.length; i++) {
      if (used[i]) continue;
      
      let current = { ...merged[i] };
      used[i] = true;
      
      for (let j = i + 1; j < merged.length; j++) {
        if (used[j]) continue;
        
        const other = merged[j];

        if (getRectGapInSourcePixels(current, other, procScale) <= maxGapSourcePx) {
            // Merge
            const minX = Math.min(current.x, other.x);
            const minY = Math.min(current.y, other.y);
            const maxX = Math.max(current.x + current.width, other.x + other.width);
            const maxY = Math.max(current.y + current.height, other.y + other.height);
            
            current.x = minX;
            current.y = minY;
            current.width = maxX - minX;
            current.height = maxY - minY;
            
            used[j] = true;
            changed = true;
        }
      }
      newMerged.push(current);
    }
    merged = newMerged;
  }
  return merged;
}

function getRectGapInSourcePixels(r1: Rect, r2: Rect, procScale: number) {
  const gapX = Math.max(0, r2.x - (r1.x + r1.width), r1.x - (r2.x + r2.width));
  const gapY = Math.max(0, r2.y - (r1.y + r1.height), r1.y - (r2.y + r2.height));
  const processedGap = Math.hypot(gapX, gapY);
  return procScale > 0 ? processedGap / procScale : processedGap;
}

function dilate(data: Uint8Array, width: number, height: number, passes: number): Uint8Array {
  let current = new Uint8Array(data);
  let next = new Uint8Array(data.length);

  for (let p = 0; p < passes; p++) {
    // Initialize next with current values to preserve existing white pixels
    next.set(current);
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (current[idx] === 1) {
          // Expand to neighbors (3x3 kernel)
          // Top
          if (y > 0) {
            next[idx - width] = 1;
            if (x > 0) next[idx - width - 1] = 1;
            if (x < width - 1) next[idx - width + 1] = 1;
          }
          // Bottom
          if (y < height - 1) {
            next[idx + width] = 1;
            if (x > 0) next[idx + width - 1] = 1;
            if (x < width - 1) next[idx + width + 1] = 1;
          }
          // Left/Right
          if (x > 0) next[idx - 1] = 1;
          if (x < width - 1) next[idx + 1] = 1;
        }
      }
    }
    current.set(next);
  }
  return current;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function findContours(data: Uint8Array, width: number, height: number): Rect[] {
  const visited = new Uint8Array(data.length);
  const rects: Rect[] = [];

  // Simple blob detection using BFS
  for (let i = 0; i < data.length; i++) {
    if (data[i] === 1 && visited[i] === 0) {
      let minX = i % width;
      let maxX = minX;
      let minY = Math.floor(i / width);
      let maxY = minY;
      
      const queue = [i];
      visited[i] = 1;
      
      let ptr = 0;
      while(ptr < queue.length) {
        const idx = queue[ptr++];
        const x = idx % width;
        const y = Math.floor(idx / width);
        
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        
        // Neighbors
        const neighbors = [
          idx - 1, idx + 1, idx - width, idx + width,
          idx - width - 1, idx - width + 1, idx + width - 1, idx + width + 1
        ];
        
        for (const n of neighbors) {
          if (n >= 0 && n < data.length && data[n] === 1 && visited[n] === 0) {
            // Check boundary wrapping
            const nx = n % width;
            const cx = idx % width;
            if (Math.abs(nx - cx) > 1) continue;
            
            visited[n] = 1;
            queue.push(n);
          }
        }
      }
      
      rects.push({
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1
      });
    }
  }
  return rects;
}
