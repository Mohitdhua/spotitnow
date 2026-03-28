import React, { useState, useRef, useEffect } from 'react';
import { Upload, Image as ImageIcon, X, Layers, AlertTriangle, FileWarning, Check, Trash2, Wand2, BrainCircuit, MousePointer2, Download, Play, Edit, Video, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ProcessingMode, Puzzle, Region, PuzzleSet } from '../types';
import { detectDifferencesClientSide, type DifferenceDetectionOptions } from '../services/imageProcessing';
import { detectDifferences } from '../services/ai';
import { cancelImageDetectionWorker, runImageDetectionBatchInWorker } from '../services/imageDetectionWorker';
import { EditorCanvas } from './EditorCanvas';

interface ImageUploaderProps {
  onImagesSelected: (imageA: string, imageB: string, regions?: Region[]) => void;
  onBatchSelected?: (puzzles: Puzzle[]) => void;
  onExportVideo?: (puzzles: Puzzle[]) => void;
  injectedFiles?: File[];
  injectedProcessingMode?: ProcessingMode | null;
  injectedFilesSessionId?: number;
  onInjectedFilesHandled?: () => void;
}

interface IncompletePair {
  id: string;
  baseName: string;
  missingType: 'base' | 'diff';
  existingFile: File;
}

interface PendingSplitPair {
  baseName: string;
  imageA: string;
  imageB: string;
}

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

export function ImageUploader({
  onImagesSelected,
  onBatchSelected,
  onExportVideo,
  injectedFiles,
  injectedProcessingMode,
  injectedFilesSessionId,
  onInjectedFilesHandled
}: ImageUploaderProps) {
  const [dragActive, setDragActive] = useState(false);
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [showOptionsModal, setShowOptionsModal] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewPuzzles, setReviewPuzzles] = useState<Puzzle[]>([]);
  const [incompletePairs, setIncompletePairs] = useState<IncompletePair[]>([]);
  const [processing, setProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<string>("");
  const [pendingSplitPairs, setPendingSplitPairs] = useState<PendingSplitPair[]>([]);
  
  // Temporary storage for valid pairs before final submission
  const validPairsRef = useRef<Map<string, { base: File, diff: File }>>(new Map());

  const fileInputRef = useRef<HTMLInputElement>(null);
  const batchInputRef = useRef<HTMLInputElement>(null);
  const missingFileInputRef = useRef<HTMLInputElement>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [editingPuzzleIndex, setEditingPuzzleIndex] = useState<number | null>(null);
  const [keepExactThreeOnly, setKeepExactThreeOnly] = useState(false);

  useEffect(() => {
    if (!injectedFilesSessionId || !injectedFiles?.length) return;
    processFiles(injectedFiles, injectedProcessingMode ?? undefined);
    onInjectedFilesHandled?.();
  }, [injectedFilesSessionId, injectedFiles, injectedProcessingMode, onInjectedFilesHandled]);

  useEffect(() => {
    return () => {
      cancelImageDetectionWorker();
    };
  }, []);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const parseFilename = (filename: string) => {
    const name = filename.substring(0, filename.lastIndexOf('.')) || filename;
    // Check if ends with 'diff' (case insensitive)
    if (name.toLowerCase().endsWith('diff')) {
      return { base: name.substring(0, name.length - 4), type: 'diff' as const };
    }
    return { base: name, type: 'base' as const };
  };

  const readFileAsBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const loadImageFromSource = (src: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Failed to load image for splitting'));
      image.src = src;
    });

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

  const cropCanvas = (source: HTMLCanvasElement, bounds: PixelBounds): HTMLCanvasElement => {
    const cropped = document.createElement('canvas');
    cropped.width = Math.max(1, bounds.width);
    cropped.height = Math.max(1, bounds.height);
    const ctx = cropped.getContext('2d');
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

    const detectCanvas = document.createElement('canvas');
    detectCanvas.width = width;
    detectCanvas.height = height;
    const detectCtx = detectCanvas.getContext('2d', { willReadFrequently: true });
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
    const width = clamp(
      Math.ceil((paddedRight - paddedX) / scale),
      1,
      maskData.sourceWidth - x
    );
    const height = clamp(
      Math.ceil((paddedBottom - paddedY) / scale),
      1,
      maskData.sourceHeight - y
    );

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
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return new Uint8Array(width * height);

    ctx.drawImage(source, 0, 0, width, height);
    const data = ctx.getImageData(0, 0, width, height).data;
    const gray = new Uint8Array(width * height);

    for (let i = 0, p = 0; i < gray.length; i += 1, p += 4) {
      // Standard luma transform (BT.601)
      gray[i] = Math.round(data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114);
    }
    return gray;
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

    const trimPairBorders = (
      left: HTMLCanvasElement,
      right: HTMLCanvasElement
    ): { first: HTMLCanvasElement; second: HTMLCanvasElement } => {
      const minDimension = Math.min(left.width, left.height, right.width, right.height);
      if (minDimension < 80) {
        return { first: left, second: right };
      }

      const trimRatio = 0.035;
      const trimX = Math.max(2, Math.round(minDimension * trimRatio));
      const trimY = Math.max(2, Math.round(minDimension * trimRatio));
      const targetWidth = Math.max(1, Math.min(left.width, right.width) - trimX * 2);
      const targetHeight = Math.max(1, Math.min(left.height, right.height) - trimY * 2);

      if (targetWidth < 32 || targetHeight < 32) {
        return { first: left, second: right };
      }

      return {
        first: centerCropToSize(left, targetWidth, targetHeight),
        second: centerCropToSize(right, targetWidth, targetHeight)
      };
    };

    return trimPairBorders(aligned.first, aligned.second);
  };

  const detectFramedBounds = (source: HTMLCanvasElement): PixelBounds | null => {
    const maskData = createForegroundMask(source);
    if (!maskData) return null;

    const minArea = Math.max(64, Math.floor(maskData.width * maskData.height * 0.01));
    const blobs = collectForegroundBlobs(maskData.mask, maskData.width, maskData.height, minArea);
    if (blobs.length === 0) return null;

    const sorted = [...blobs].sort((a, b) => {
      if (a.touchesEdge !== b.touchesEdge) {
        return a.touchesEdge ? 1 : -1;
      }
      return b.area - a.area;
    });

    return toSourceBounds(sorted[0], maskData, 0.02);
  };

  const detectFramedPairBounds = (
    source: HTMLCanvasElement
  ): { first: PixelBounds; second: PixelBounds } | null => {
    const maskData = createForegroundMask(source);
    if (!maskData) return null;

    const imageArea = maskData.width * maskData.height;
    const minArea = Math.max(64, Math.floor(imageArea * 0.004));
    const blobs = collectForegroundBlobs(maskData.mask, maskData.width, maskData.height, minArea);
    if (blobs.length < 2) return null;

    const candidates = blobs
      .filter((blob) => {
        const ratio = blob.width / Math.max(1, blob.height);
        const areaRatio = blob.area / imageArea;
        return ratio > 0.35 && ratio < 3 && areaRatio > 0.04;
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
        const edgePenalty = (first.touchesEdge ? 0.12 : 0) + (second.touchesEdge ? 0.12 : 0);
        const score = areaRatio * 2.5 + separationScore + areaScore - edgePenalty;

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

  const splitCombinedImage = async (imageSrc: string): Promise<{ imageA: string; imageB: string }> => {
    const image = await loadImageFromSource(imageSrc);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;

    if (width < 2 || height < 2) {
      throw new Error('Image is too small to split.');
    }

    const splitHorizontally = width >= height;
    const segmentWidth = splitHorizontally ? Math.floor(width / 2) : width;
    const segmentHeight = splitHorizontally ? height : Math.floor(height / 2);

    if (segmentWidth < 1 || segmentHeight < 1) {
      throw new Error('Unable to split image with current dimensions.');
    }

    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = width;
    sourceCanvas.height = height;
    const sourceCtx = sourceCanvas.getContext('2d');
    if (!sourceCtx) {
      throw new Error('Canvas is not available for extraction.');
    }
    sourceCtx.drawImage(image, 0, 0, width, height);

    const pairBounds = detectFramedPairBounds(sourceCanvas);
    if (pairBounds) {
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

      const extractedFirst = cropCanvas(sourceCanvas, firstBounds);
      const extractedSecond = cropCanvas(sourceCanvas, secondBounds);
      const normalizedPair = refineExtractedPairAlignment(extractedFirst, extractedSecond);

      return {
        imageA: normalizedPair.first.toDataURL('image/png'),
        imageB: normalizedPair.second.toDataURL('image/png')
      };
    }

    const firstCanvas = document.createElement('canvas');
    firstCanvas.width = segmentWidth;
    firstCanvas.height = segmentHeight;
    const firstCtx = firstCanvas.getContext('2d');

    const secondCanvas = document.createElement('canvas');
    secondCanvas.width = segmentWidth;
    secondCanvas.height = segmentHeight;
    const secondCtx = secondCanvas.getContext('2d');

    if (!firstCtx || !secondCtx) {
      throw new Error('Canvas is not available for splitting.');
    }

    if (splitHorizontally) {
      firstCtx.drawImage(image, 0, 0, segmentWidth, height, 0, 0, segmentWidth, segmentHeight);
      secondCtx.drawImage(
        image,
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
      firstCtx.drawImage(image, 0, 0, width, segmentHeight, 0, 0, segmentWidth, segmentHeight);
      secondCtx.drawImage(
        image,
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

    const firstBounds = detectFramedBounds(firstCanvas);
    const secondBounds = detectFramedBounds(secondCanvas);
    const extractedFirst = firstBounds ? cropCanvas(firstCanvas, firstBounds) : firstCanvas;
    const extractedSecond = secondBounds ? cropCanvas(secondCanvas, secondBounds) : secondCanvas;
    const normalizedPair = refineExtractedPairAlignment(extractedFirst, extractedSecond);

    return {
      imageA: normalizedPair.first.toDataURL('image/png'),
      imageB: normalizedPair.second.toDataURL('image/png')
    };
  };

  const handleSplitFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (processing) return;
    const fileList = e.currentTarget.files;
    const files: File[] = fileList ? Array.from(fileList) : [];
    if (!files.length) return;

    setProcessing(true);
    setProcessingStatus('Splitting and extracting framed images...');
    setPendingSplitPairs([]);
    validPairsRef.current.clear();

    try {
      const extractedPairs: PendingSplitPair[] = [];
      let failedCount = 0;

      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        setProcessingStatus(`Splitting combined image ${i + 1} of ${files.length}...`);
        try {
          const imageSrc = await readFileAsBase64(file);
          const split = await splitCombinedImage(imageSrc);
          const baseName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
          extractedPairs.push({
            baseName,
            imageA: split.imageA,
            imageB: split.imageB
          });
        } catch (error) {
          failedCount += 1;
          console.error(`Failed to split combined image "${file.name}"`, error);
        }
      }

      if (extractedPairs.length === 0) {
        alert('Could not split any combined images. Use clear side-by-side or top-bottom pairs.');
        return;
      }

      setPendingSplitPairs(extractedPairs);
      setShowOptionsModal(true);

      if (failedCount > 0) {
        alert(`Processed ${extractedPairs.length} combined images. Skipped ${failedCount} file(s).`);
      }
    } catch (err) {
      console.error('Failed to split combined image', err);
      alert('Could not split the combined image. Use a clear side-by-side or top-bottom pair.');
    } finally {
      setProcessing(false);
      e.target.value = '';
    }
  };

  const processFiles = async (files: FileList | File[], requestedMode?: ProcessingMode) => {
    if (processing) return;
    setProcessing(true);
    setProcessingStatus("Analyzing files...");
    setPendingSplitPairs([]);
    const fileArray = Array.from(files);
    
    const pairs = new Map<string, { base?: File, diff?: File }>();

    // Group files
    fileArray.forEach(file => {
      const { base, type } = parseFilename(file.name);
      if (!pairs.has(base)) {
        pairs.set(base, {});
      }
      const pair = pairs.get(base)!;
      if (type === 'base') pair.base = file;
      else pair.diff = file;
    });

    const valid = new Map<string, { base: File, diff: File }>();
    const incomplete: IncompletePair[] = [];

    pairs.forEach((pair, baseName) => {
      if (pair.base && pair.diff) {
        valid.set(baseName, { base: pair.base, diff: pair.diff });
      } else {
        incomplete.push({
          id: baseName,
          baseName,
          missingType: pair.base ? 'diff' : 'base',
          existingFile: pair.base || pair.diff!
        });
      }
    });

    validPairsRef.current = valid;

    if (incomplete.length > 0) {
      setIncompletePairs(incomplete);
      setShowBatchModal(true);
      setProcessing(false);
    } else if (valid.size > 0) {
      setProcessing(false);
      if (requestedMode) {
        finalizeBatch(valid, requestedMode);
      } else {
        setShowOptionsModal(true);
      }
    } else {
      // Fallback for simple 2-file upload without naming convention if exactly 2 files
      if (fileArray.length === 2 && !onBatchSelected) {
        // For single pair without naming convention, we treat it as a valid pair manually
        const tempMap = new Map<string, { base: File; diff: File }>();
        tempMap.set('puzzle', { base: fileArray[0], diff: fileArray[1] });
        validPairsRef.current = tempMap;
        setProcessing(false);
        if (requestedMode) {
          finalizeBatch(tempMap, requestedMode);
        } else {
          setShowOptionsModal(true);
        }
      } else {
        alert('No valid puzzle pairs found. Please ensure files are named "name.png" and "namediff.png".');
        setProcessing(false);
      }
    }
  };

  const handleProcessingChoice = (mode: ProcessingMode) => {
    if (processing) return;
    setShowOptionsModal(false);
    if (pendingSplitPairs.length > 0) {
      finalizeSplitPairs(pendingSplitPairs, mode);
      return;
    }
    finalizeBatch(validPairsRef.current, mode);
  };

  const sanitizeRegions = (regions: Region[]): Region[] =>
    regions.filter((region) => {
      if (region.width <= 0 || region.height <= 0) return false;
      if (region.width < 0.004 || region.height < 0.004) return false;
      if (region.width > 0.95 || region.height > 0.95) return false;
      if (region.width * region.height > 0.35) return false;
      return true;
    });

  const sanitizeUltraFastRegions = (regions: Region[]): Region[] =>
    sanitizeRegions(regions).filter((region) => {
      if (region.width < 0.011 || region.height < 0.011) return false;
      if (region.width * region.height < 0.00055) return false;
      return true;
    });

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
  const ultraFastDetectionOptions: DifferenceDetectionOptions = {
    diffThreshold: 88,
    dilationPasses: 1,
    minAreaRatio: 0.00038,
    mergeDistancePx: 4,
    blurRadius: 0,
    borderIgnoreRatio: 0.03,
    maxRegionAreaRatio: 0.18,
    maxRegions: 7,
    regionPaddingPx: 2,
    enableAlignment: false,
    processingMaxDimension: 520
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

  const processSplitPairWithMode = async (
    pair: PendingSplitPair,
    mode: ProcessingMode
  ): Promise<Puzzle> => {
    let finalImageA = pair.imageA;
    let finalImageB = pair.imageB;
    let regions: Region[] = [];

    if (mode === 'ultra') {
      const result = await detectDifferencesClientSide(pair.imageA, pair.imageB, ultraFastDetectionOptions);
      finalImageA = result.imageA;
      finalImageB = result.imageB;
      regions = sanitizeUltraFastRegions(result.regions);
    } else if (mode === 'auto') {
      const result = await detectDifferencesClientSide(pair.imageA, pair.imageB, splitAutoDefault);
      let bestResult = result;
      if (result.regions.length === 0 || result.regions.length === 1) {
        const sensitiveResult = await detectDifferencesClientSide(
          pair.imageA,
          pair.imageB,
          splitAutoSensitive
        );
        if (sensitiveResult.regions.length > 0 && sensitiveResult.regions.length <= 12) {
          bestResult = sensitiveResult;
        }
      }

      finalImageA = bestResult.imageA;
      finalImageB = bestResult.imageB;
      regions = sanitizeRegions(bestResult.regions);
    } else if (mode === 'ai') {
      try {
        const aiRegions = await detectDifferences(pair.imageA, pair.imageB);
        regions = sanitizeRegions(
          aiRegions.map((region) => ({
            id: Math.random().toString(36).substring(2),
            x: region.xmin,
            y: region.ymin,
            width: region.xmax - region.xmin,
            height: region.ymax - region.ymin
          }))
        );
      } catch {
        regions = [];
      }

      if (regions.length === 0) {
        const fallback = await detectDifferencesClientSide(
          pair.imageA,
          pair.imageB,
          splitAutoSensitive
        );
        finalImageA = fallback.imageA;
        finalImageB = fallback.imageB;
        regions = sanitizeRegions(fallback.regions);
      }
    }

    return {
      imageA: finalImageA,
      imageB: finalImageB,
      regions,
      title: pair.baseName
    };
  };

  const processClientDetectionBatch = async (
    entries: Array<{ id: string; title: string; imageA: string; imageB: string }>,
    mode: Extract<ProcessingMode, 'ultra' | 'auto'>
  ): Promise<Puzzle[]> => {
    if (!entries.length) return [];

    const options = mode === 'ultra' ? ultraFastDetectionOptions : splitAutoDefault;
    const fallbackOptions = mode === 'auto' ? splitAutoSensitive : null;
    const modePrefix = mode === 'ultra' ? 'Ultra-fast' : 'Background';

    const results = await runImageDetectionBatchInWorker({
      tasks: entries.map((entry) => ({
        id: entry.id,
        imageA: entry.imageA,
        imageB: entry.imageB,
        options,
        fallbackOptions
      })),
      onProgress: ({ label }) => {
        setProcessingStatus(`${modePrefix} ${label.toLowerCase()}`);
      }
    });

    const resultMap = new Map(results.map((entry) => [entry.id, entry.result]));
    return entries.reduce<Puzzle[]>((accumulator, entry) => {
        const result = resultMap.get(entry.id);
        if (!result) {
          return accumulator;
        }
        accumulator.push({
          imageA: result.imageA ?? entry.imageA,
          imageB: result.imageB ?? entry.imageB,
          regions: mode === 'ultra' ? sanitizeUltraFastRegions(result.regions) : sanitizeRegions(result.regions),
          title: entry.title
        } satisfies Puzzle);
        return accumulator;
      }, []);
  };

  const finalizeSplitPairs = async (pairs: PendingSplitPair[], mode: ProcessingMode) => {
    if (!pairs.length) return;
    setProcessing(true);

    try {
      if (mode === 'ultra' || mode === 'auto') {
        setProcessingStatus(
          `${mode === 'ultra' ? 'Ultra-fast' : 'Background'} processing split images on this page...`
        );
        const puzzles = await processClientDetectionBatch(
          pairs.map((pair, index) => ({
            id: `split-${index}-${pair.baseName}`,
            title: pair.baseName,
            imageA: pair.imageA,
            imageB: pair.imageB
          })),
          mode
        );

        if (puzzles.length === 0) {
          alert('Failed to process split images.');
          return;
        }

        if (onBatchSelected) {
          setReviewPuzzles(puzzles);
          setShowReviewModal(true);
        } else {
          const firstPuzzle = puzzles[0];
          onImagesSelected(firstPuzzle.imageA, firstPuzzle.imageB, firstPuzzle.regions);
        }
        return;
      }

      const puzzles: Puzzle[] = [];
      let failedCount = 0;

      for (let i = 0; i < pairs.length; i += 1) {
        const pair = pairs[i];
        const progressLabel = `Processing split image ${i + 1} of ${pairs.length}...`;
        setProcessingStatus(progressLabel);
        try {
          const puzzle = await processSplitPairWithMode(pair, mode);
          puzzles.push(puzzle);
        } catch (err) {
          failedCount += 1;
          console.error(`Error processing split pair "${pair.baseName}"`, err);
        }
      }

      if (puzzles.length === 0) {
        alert('Failed to process split images.');
        return;
      }

      if (onBatchSelected) {
        setReviewPuzzles(puzzles);
        setShowReviewModal(true);
      } else {
        const firstPuzzle = puzzles[0];
        onImagesSelected(firstPuzzle.imageA, firstPuzzle.imageB, firstPuzzle.regions);
      }

      if (failedCount > 0) {
        alert(`Processed ${puzzles.length} split image(s). Skipped ${failedCount} image(s).`);
      }
    } catch (err) {
      console.error('Failed to process split image batch', err);
      alert('Failed to process split images.');
    } finally {
      setPendingSplitPairs([]);
      setProcessing(false);
      validPairsRef.current.clear();
    }
  };

  const finalizeBatch = async (pairs: Map<string, { base: File, diff: File }>, mode: ProcessingMode) => {
    setProcessing(true);
    
    // If single pair and not batch mode, handle specially to pass to onImagesSelected
    if (!onBatchSelected && pairs.size === 1) {
      const pair = pairs.values().next().value;
      try {
        setProcessingStatus("Processing image pair...");
        const imageA = await readFileAsBase64(pair.base);
        const imageB = await readFileAsBase64(pair.diff);
        
        let regions: Region[] = [];
        
        if (mode === 'ultra') {
          const puzzles = await processClientDetectionBatch(
            [{ id: 'single-ultra', title: 'Draft Puzzle', imageA, imageB }],
            'ultra'
          );
          const firstPuzzle = puzzles[0];
          if (!firstPuzzle) {
            throw new Error('Failed to detect differences.');
          }
          onImagesSelected(firstPuzzle.imageA, firstPuzzle.imageB, firstPuzzle.regions);
          setProcessing(false);
          return;
        } else if (mode === 'auto') {
          const puzzles = await processClientDetectionBatch(
            [{ id: 'single-auto', title: 'Draft Puzzle', imageA, imageB }],
            'auto'
          );
          const firstPuzzle = puzzles[0];
          if (!firstPuzzle) {
            throw new Error('Failed to detect differences.');
          }
          onImagesSelected(firstPuzzle.imageA, firstPuzzle.imageB, firstPuzzle.regions);
          setProcessing(false);
          return;
        } else if (mode === 'ai') {
          setProcessingStatus("Asking AI to find differences...");
          const aiRegions = await detectDifferences(imageA, imageB);
          // Convert AI regions to our Region format
          regions = aiRegions.map(r => ({
            id: Math.random().toString(36).substring(2),
            x: r.xmin,
            y: r.ymin,
            width: r.xmax - r.xmin,
            height: r.ymax - r.ymin
          }));
        }
        
        // For manual or AI (AI returns regions but uses original images)
        onImagesSelected(imageA, imageB, regions);
      } catch (err) {
        console.error("Error processing single pair", err);
        alert("Failed to process images.");
      }
      setProcessing(false);
      validPairsRef.current.clear();
      return;
    }

    if (!onBatchSelected) return;

    const puzzles: Puzzle[] = [];
    let processed = 0;
    const total = pairs.size;

    if (mode === 'ultra' || mode === 'auto') {
      try {
        setProcessingStatus(`Preparing ${total} puzzle${total === 1 ? '' : 's'} for background detection...`);
        const entries: Array<{ id: string; title: string; imageA: string; imageB: string }> = [];

        for (const [baseName, pair] of pairs.entries()) {
          setProcessingStatus(`Preparing puzzle ${entries.length + 1} of ${total}...`);
          const imageA = await readFileAsBase64(pair.base);
          const imageB = await readFileAsBase64(pair.diff);
          entries.push({
            id: baseName,
            title: baseName,
            imageA,
            imageB
          });
        }

        const detectedPuzzles = await processClientDetectionBatch(entries, mode);
        setReviewPuzzles(detectedPuzzles);
        setProcessing(false);
        setShowBatchModal(false);
        setIncompletePairs([]);
        setPendingSplitPairs([]);
        validPairsRef.current.clear();
        setShowReviewModal(true);
        return;
      } catch (err) {
        console.error('Failed to process puzzle batch in background', err);
        alert('Failed to process images.');
        setProcessing(false);
        validPairsRef.current.clear();
        return;
      }
    }
    
    for (const [baseName, pair] of pairs.entries()) {
      try {
        setProcessingStatus(`Processing puzzle ${processed + 1} of ${total}...`);
        const imageA = await readFileAsBase64(pair.base);
        const imageB = await readFileAsBase64(pair.diff);
        
        let regions: Region[] = [];
        let finalImageA = imageA;
        let finalImageB = imageB;

        if (mode === 'ai') {
          const aiRegions = await detectDifferences(imageA, imageB);
          regions = aiRegions.map(r => ({
            id: Math.random().toString(36).substring(2),
            x: r.xmin,
            y: r.ymin,
            width: r.xmax - r.xmin,
            height: r.ymax - r.ymin
          }));
        }
        
        puzzles.push({
          imageA: finalImageA,
          imageB: finalImageB,
          regions: regions,
          title: baseName
        });
        processed++;
      } catch (err) {
        console.error(`Failed to process files for ${baseName}`, err);
      }
    }

    setReviewPuzzles(puzzles);
    setProcessing(false);
    setShowBatchModal(false);
    setIncompletePairs([]);
    setPendingSplitPairs([]);
    validPairsRef.current.clear();
    setShowReviewModal(true);
  };

  const handleExport = () => {
    const puzzlesToExport = activeReviewPuzzles;
    if (!puzzlesToExport.length) return;
    const puzzleSet: PuzzleSet = {
      title: 'Exported Puzzles',
      version: 1,
      puzzles: puzzlesToExport
    };
    const blob = new Blob([JSON.stringify(puzzleSet)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.href = url;
    downloadAnchorNode.download = "puzzles.json";
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
    URL.revokeObjectURL(url);
  };

  const toPngBlob = async (src: string): Promise<Blob> => {
    const image = await loadImageFromSource(src);
    const width = Math.max(1, image.naturalWidth || image.width);
    const height = Math.max(1, image.naturalHeight || image.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not available');
    ctx.drawImage(image, 0, 0, width, height);

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Failed to encode image as PNG'));
          return;
        }
        resolve(blob);
      }, 'image/png');
    });
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

  const handleExportImagePairs = async () => {
    const puzzlesToExport = activeReviewPuzzles;
    if (!puzzlesToExport.length) return;

    let exported = 0;
    let failed = 0;

    for (let i = 0; i < puzzlesToExport.length; i += 1) {
      const puzzle = puzzlesToExport[i];
      const sequence = i + 1;
      const baseName = `puzzle${sequence}`;

      try {
        const [blobA, blobB] = await Promise.all([toPngBlob(puzzle.imageA), toPngBlob(puzzle.imageB)]);
        triggerBlobDownload(blobA, `${baseName}.png`);
        await delay(60);
        triggerBlobDownload(blobB, `${baseName}diff.png`);
        await delay(60);
        exported += 1;
      } catch (err) {
        failed += 1;
        console.error(`Failed to export image pair for "${baseName}"`, err);
      }
    }

    if (failed > 0) {
      alert(`Exported ${exported} image pair(s). Failed for ${failed} pair(s).`);
    }
  };

  const handleConfirmBatch = () => {
    if (onBatchSelected && activeReviewPuzzles.length > 0) {
      onBatchSelected(activeReviewPuzzles);
      setShowReviewModal(false);
    }
  };

  const handleExportVideoFromReview = () => {
    if (!onExportVideo || activeReviewPuzzles.length === 0) return;
    onExportVideo(activeReviewPuzzles);
    setShowReviewModal(false);
  };

  const handleRemovePuzzle = (index: number) => {
    const newPuzzles = [...reviewPuzzles];
    newPuzzles.splice(index, 1);
    setReviewPuzzles(newPuzzles);
    if (newPuzzles.length === 0) {
      setShowReviewModal(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (processing) return;
    
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (processing) return;
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
    }
  };

  const resolveMissingFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !resolvingId) return;

    const pair = incompletePairs.find(p => p.id === resolvingId);
    if (!pair) return;

    const valid = validPairsRef.current;
    valid.set(pair.baseName, {
      base: pair.missingType === 'base' ? file : pair.existingFile,
      diff: pair.missingType === 'diff' ? file : pair.existingFile
    });

    const newIncomplete = incompletePairs.filter(p => p.id !== resolvingId);
    setIncompletePairs(newIncomplete);
    setResolvingId(null);

    if (newIncomplete.length === 0) {
      // All resolved, show options
      setShowBatchModal(false);
      setShowOptionsModal(true);
    }
  };

  const discardPair = (id: string) => {
    const newIncomplete = incompletePairs.filter(p => p.id !== id);
    setIncompletePairs(newIncomplete);
    if (newIncomplete.length === 0 && validPairsRef.current.size > 0) {
      // All incomplete discarded, but we have valid ones -> show options
      setShowBatchModal(false);
      setShowOptionsModal(true);
    } else if (newIncomplete.length === 0) {
      setShowBatchModal(false);
      setProcessing(false);
    }
  };

  const handleEditPuzzle = (index: number) => {
    setEditingPuzzleIndex(index);
  };

  const handleSaveEditedPuzzle = (editedPuzzle: Puzzle) => {
    if (editingPuzzleIndex === null) return;
    
    const newPuzzles = [...reviewPuzzles];
    newPuzzles[editingPuzzleIndex] = editedPuzzle;
    setReviewPuzzles(newPuzzles);
    setEditingPuzzleIndex(null);
  };

  const activeReviewEntries = reviewPuzzles
    .map((puzzle, index) => ({ puzzle, index }))
    .filter((entry) => !keepExactThreeOnly || entry.puzzle.regions.length === 3);
  const activeReviewPuzzles = activeReviewEntries.map((entry) => entry.puzzle);
  const filteredOutCount = reviewPuzzles.length - activeReviewPuzzles.length;

  return (
    <div className="w-full max-w-2xl mx-auto p-4 sm:p-6">
      <div 
        className={`relative border-4 border-dashed rounded-2xl p-6 sm:p-10 md:p-12 text-center transition-all duration-200 ${
          dragActive ? 'border-[#FF6B6B] bg-[#FFF5F5]' : 'border-black hover:border-[#FF6B6B] hover:bg-white'
        }`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <div className="flex flex-col items-center space-y-5 sm:space-y-6">
          <div className="mb-2 flex h-16 w-16 items-center justify-center rounded-full border-4 border-black bg-[#FFD93D] text-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] sm:mb-4 sm:h-24 sm:w-24">
            <Layers size={32} strokeWidth={2.5} className="sm:h-12 sm:w-12" />
          </div>
          <h3 className="text-2xl sm:text-3xl font-black text-black font-display uppercase tracking-tight">
            Drag & Drop Images
          </h3>
          <p className="text-sm sm:text-base text-slate-700 font-bold max-w-md mx-auto border-2 border-black p-2 bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] -rotate-1">
            Upload single pairs or batch files. <br/>
            <span className="text-xs text-slate-500 font-mono mt-1 block">
              Batch: <code>name.png</code> + <code>namediff.png</code>
            </span>
          </p>
          
          <div className="mt-6 flex w-full flex-col gap-3 sm:mt-8 sm:flex-row sm:justify-center sm:gap-4">
            <button 
              disabled={processing}
              onClick={() => fileInputRef.current?.click()}
              className={`w-full justify-center px-6 py-3 border-2 border-black rounded-xl font-bold transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex items-center space-x-2 sm:w-auto ${
                processing
                  ? 'cursor-not-allowed bg-slate-200 text-slate-500 shadow-none'
                  : 'bg-white text-black hover:bg-slate-50 hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
              }`}
            >
              <ImageIcon size={20} strokeWidth={2.5} />
              <span>{processing ? 'PROCESSING...' : 'SELECT FILES'}</span>
            </button>
            {onBatchSelected && (
              <button 
                disabled={processing}
                onClick={() => batchInputRef.current?.click()}
                className={`w-full justify-center px-6 py-3 border-2 border-black rounded-xl font-bold transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex items-center space-x-2 sm:w-auto ${
                  processing
                    ? 'cursor-not-allowed bg-slate-200 text-slate-500 shadow-none'
                    : 'bg-[#4ECDC4] text-black hover:bg-[#3DBDB4] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
                }`}
              >
                <Layers size={20} strokeWidth={2.5} />
                <span>{processing ? 'WORKING IN BACKGROUND' : 'BATCH SELECT'}</span>
              </button>
            )}
          </div>
        </div>

        <input 
          ref={fileInputRef}
          type="file" 
          accept="image/*" 
          multiple
          className="hidden" 
          onChange={handleFileSelect}
        />
        <input 
          ref={batchInputRef}
          type="file" 
          accept="image/*" 
          multiple
          className="hidden" 
          onChange={handleFileSelect}
        />
        <input 
          ref={missingFileInputRef}
          type="file" 
          accept="image/*" 
          className="hidden" 
          onChange={resolveMissingFile}
        />
      </div>

      {/* Conflict Resolution Modal */}
      <AnimatePresence>
        {showBatchModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white rounded-2xl border-4 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] max-w-lg w-full overflow-hidden flex flex-col max-h-[80vh]"
            >
              <div className="p-4 sm:p-6 border-b-4 border-black flex flex-col items-start gap-3 sm:flex-row sm:justify-between sm:items-center bg-[#FFD93D]">
                <div className="flex items-center space-x-3 text-black">
                  <AlertTriangle size={28} strokeWidth={3} />
                  <h3 className="text-xl font-black font-display uppercase">Incomplete Pairs</h3>
                </div>
              </div>
              
              <div className="p-6 overflow-y-auto flex-1 space-y-4 bg-white">
                <p className="text-slate-700 font-medium border-l-4 border-black pl-4 py-2 bg-slate-50">
                  Some puzzles are missing files. Please resolve them to continue.
                </p>

                <div className="space-y-4">
                  {incompletePairs.map(pair => (
                    <div key={pair.id} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between p-4 bg-white rounded-xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                      <div className="flex items-center space-x-3 overflow-hidden min-w-0">
                        <div className="w-12 h-12 bg-slate-100 rounded-lg border-2 border-black flex items-center justify-center flex-shrink-0 text-slate-500">
                          <FileWarning size={24} strokeWidth={2.5} />
                        </div>
                        <div className="min-w-0">
                          <div className="font-bold text-black truncate">{pair.baseName}</div>
                          <div className="text-xs text-[#FF6B6B] font-bold uppercase tracking-wide">
                            Missing: {pair.missingType === 'base' ? 'Original' : 'Difference'}
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex w-full justify-end space-x-2 sm:w-auto sm:flex-shrink-0">
                        <button 
                          onClick={() => {
                            setResolvingId(pair.id);
                            missingFileInputRef.current?.click();
                          }}
                          className="p-2 bg-[#A7F3D0] border-2 border-black text-black rounded-lg hover:bg-[#6EE7B7] transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[1px] hover:translate-x-[1px] hover:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
                          title="Select Missing File"
                        >
                          <Upload size={20} strokeWidth={2.5} />
                        </button>
                        <button 
                          onClick={() => discardPair(pair.id)}
                          className="p-2 bg-[#FF6B6B] border-2 border-black text-black rounded-lg hover:bg-[#FF5252] transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[1px] hover:translate-x-[1px] hover:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
                          title="Discard Puzzle"
                        >
                          <Trash2 size={20} strokeWidth={2.5} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-4 sm:p-6 border-t-4 border-black bg-slate-50 flex flex-col gap-3 sm:flex-row sm:justify-end sm:space-x-0">
                <button 
                  onClick={() => {
                    setIncompletePairs([]);
                    setShowBatchModal(false);
                    if (validPairsRef.current.size > 0) {
                      setShowOptionsModal(true);
                    }
                  }}
                  className="w-full px-6 py-3 bg-white border-2 border-black text-black rounded-xl font-bold hover:bg-slate-50 transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] sm:w-auto"
                >
                  DISCARD ALL
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Processing Options Modal */}
      <AnimatePresence>
        {showOptionsModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white rounded-2xl border-4 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] max-w-lg w-full overflow-hidden"
            >
              <div className="p-6 border-b-4 border-black text-center bg-[#4ECDC4]">
                <h3 className="text-2xl font-black text-black font-display uppercase">Detection Method</h3>
                <p className="text-black font-medium mt-1">How should we find the differences?</p>
                {pendingSplitPairs.length > 0 && (
                  <p className="text-black font-bold text-xs uppercase tracking-wide mt-2">
                    Split Queue: {pendingSplitPairs.length} image{pendingSplitPairs.length === 1 ? '' : 's'}
                  </p>
                )}
              </div>
              
              <div className="p-6 space-y-4 bg-white">
                <button 
                  onClick={() => handleProcessingChoice('manual')}
                  className="w-full flex items-center p-4 bg-white hover:bg-slate-50 border-2 border-black rounded-xl transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] group text-left"
                >
                  <div className="w-14 h-14 bg-slate-200 text-black border-2 border-black rounded-lg flex items-center justify-center mr-4 group-hover:bg-white transition-all">
                    <MousePointer2 size={28} strokeWidth={2.5} />
                  </div>
                  <div>
                    <div className="font-black text-lg text-black uppercase">Manual Selection</div>
                    <div className="text-sm text-slate-600 font-medium">I'll mark them myself</div>
                  </div>
                </button>

                <button 
                  onClick={() => handleProcessingChoice('ultra')}
                  className="w-full flex items-center p-4 bg-[#FEF3C7] hover:bg-[#FDE68A] border-2 border-black rounded-xl transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] group text-left"
                >
                  <div className="w-14 h-14 bg-amber-200 text-amber-900 border-2 border-black rounded-lg flex items-center justify-center mr-4 group-hover:bg-white transition-all">
                    <Zap size={28} strokeWidth={2.5} />
                  </div>
                  <div>
                    <div className="font-black text-lg text-black uppercase">Ultra Fast</div>
                    <div className="text-sm text-slate-600 font-medium">Skip alignment and keep only larger obvious changes for perfectly aligned pairs</div>
                  </div>
                </button>

                <button 
                  onClick={() => handleProcessingChoice('auto')}
                  className="w-full flex items-center p-4 bg-[#E0E7FF] hover:bg-[#C7D2FE] border-2 border-black rounded-xl transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] group text-left"
                >
                  <div className="w-14 h-14 bg-indigo-200 text-indigo-900 border-2 border-black rounded-lg flex items-center justify-center mr-4 group-hover:bg-white transition-all">
                    <Wand2 size={28} strokeWidth={2.5} />
                  </div>
                  <div>
                    <div className="font-black text-lg text-black uppercase">Auto Detection (Fast)</div>
                    <div className="text-sm text-slate-600 font-medium">Balanced client-side detect with alignment and cleanup</div>
                  </div>
                </button>

                <button 
                  onClick={() => handleProcessingChoice('ai')}
                  className="w-full flex items-center p-4 bg-[#F3E8FF] hover:bg-[#E9D5FF] border-2 border-black rounded-xl transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] group text-left"
                >
                  <div className="w-14 h-14 bg-purple-200 text-purple-900 border-2 border-black rounded-lg flex items-center justify-center mr-4 group-hover:bg-white transition-all">
                    <BrainCircuit size={28} strokeWidth={2.5} />
                  </div>
                  <div>
                    <div className="font-black text-lg text-black uppercase">AI Analysis (Smart)</div>
                    <div className="text-sm text-slate-600 font-medium">Gemini AI reasoning</div>
                  </div>
                </button>
              </div>

              <div className="p-4 bg-slate-50 border-t-4 border-black text-center">
                <button 
                  onClick={() => {
                    setShowOptionsModal(false);
                    setPendingSplitPairs([]);
                  }}
                  className="text-slate-500 hover:text-black font-bold text-sm uppercase tracking-wider"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Review Modal */}
      <AnimatePresence>
        {showReviewModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white rounded-2xl border-4 border-black shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] max-w-5xl w-full overflow-hidden flex flex-col max-h-[85vh]"
            >
              <div className="p-4 sm:p-6 border-b-4 border-black flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between bg-[#FFD93D]">
                <div>
                  <h3 className="text-xl sm:text-2xl font-black text-black font-display uppercase">Review Puzzles</h3>
                  <p className="text-black font-medium text-sm">Check detected differences and confirm.</p>
                </div>
                <div className="flex flex-col gap-2 sm:items-end">
                  <button
                    type="button"
                    onClick={() => setKeepExactThreeOnly((current) => !current)}
                    className={`inline-flex items-center gap-2 rounded-full border-2 border-black px-3 py-1.5 text-[11px] font-black uppercase tracking-wide transition-colors ${
                      keepExactThreeOnly ? 'bg-[#4ECDC4] text-black' : 'bg-white text-slate-700 hover:bg-slate-100'
                    }`}
                    title="Keep only puzzles with exactly 3 differences"
                  >
                    <span
                      className={`h-3 w-3 rounded-full border border-black ${keepExactThreeOnly ? 'bg-black' : 'bg-transparent'}`}
                    />
                    Only 3 Diffs
                  </button>
                  <span className="px-4 py-1 bg-black text-[#FFD93D] border-2 border-black shadow-[2px_2px_0px_0px_rgba(255,255,255,0.5)] rounded-full text-sm font-bold">
                    {keepExactThreeOnly ? `${activeReviewPuzzles.length} OF ${reviewPuzzles.length}` : reviewPuzzles.length} PUZZLES
                  </span>
                </div>
              </div>
              
              <div className="p-6 overflow-y-auto flex-1 grid grid-cols-1 md:grid-cols-2 gap-6 bg-[#FFFDF5]">
                {keepExactThreeOnly && filteredOutCount > 0 ? (
                  <div className="md:col-span-2 rounded-2xl border-2 border-black bg-[#FFF7ED] px-4 py-3 text-sm font-bold text-slate-700">
                    Keeping only exact 3-difference puzzles. {filteredOutCount} puzzle{filteredOutCount === 1 ? '' : 's'} hidden.
                  </div>
                ) : null}

                {activeReviewEntries.length ? activeReviewEntries.map(({ puzzle, index }) => (
                  <div key={`${puzzle.title ?? 'puzzle'}-${index}`} className="bg-white p-4 rounded-xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex flex-col space-y-3 group hover:translate-y-[-2px] hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] transition-all">
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="min-w-0 font-bold text-black truncate pr-2 font-display text-base sm:text-lg" title={puzzle.title}>
                        {puzzle.title || `Puzzle ${index + 1}`}
                      </h4>
                      <div className="flex flex-shrink-0 space-x-2">
                        <button 
                          onClick={() => handleEditPuzzle(index)}
                          className="text-black hover:text-[#4ECDC4] transition-colors p-1 border-2 border-transparent hover:border-black hover:bg-black rounded"
                          title="Edit Puzzle"
                        >
                          <Edit size={20} strokeWidth={2.5} />
                        </button>
                        <button 
                          onClick={() => handleRemovePuzzle(index)}
                          className="text-black hover:text-[#FF6B6B] transition-colors p-1 border-2 border-transparent hover:border-black hover:bg-black rounded"
                          title="Remove Puzzle"
                        >
                          <Trash2 size={20} strokeWidth={2.5} />
                        </button>
                      </div>
                    </div>
                    
                    <div className="flex h-28 sm:h-32 space-x-2">
                      <div className="flex-1 relative rounded-lg overflow-hidden border-2 border-black bg-slate-100">
                        <img src={puzzle.imageA} alt="Original" className="w-full h-full object-contain" />
                        <div className="absolute bottom-1 left-1 bg-black text-white text-[10px] px-1.5 py-0.5 font-bold uppercase">Puzzle</div>
                      </div>
                      <div className="flex-1 relative rounded-lg overflow-hidden border-2 border-black bg-slate-100">
                        <img src={puzzle.imageB} alt="Modified" className="w-full h-full object-contain" />
                        <div className="absolute bottom-1 left-1 bg-[#FF6B6B] text-black border border-black text-[10px] px-1.5 py-0.5 font-bold uppercase">Puzzle Diff</div>
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between text-xs text-black font-bold pt-2 border-t-2 border-slate-100">
                      <div className="flex items-center">
                        <span className="w-3 h-3 rounded-full bg-[#4ECDC4] border border-black mr-2"></span>
                        {puzzle.regions?.length || 0} DIFFERENCES
                      </div>
                    </div>
                  </div>
                )) : (
                  <div className="md:col-span-2 rounded-[20px] border-4 border-black bg-white p-6 text-center shadow-[5px_5px_0px_0px_rgba(0,0,0,1)]">
                    <div className="text-lg font-black uppercase text-slate-900">No exact 3-diff puzzles</div>
                    <div className="mt-2 text-sm font-semibold text-slate-600">
                      Turn off the toggle to review the full batch, or keep it on to only continue with exact 3-difference matches.
                    </div>
                  </div>
                )}
              </div>

              <div className="p-4 sm:p-6 border-t-4 border-black bg-white flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <button 
                  onClick={() => setShowReviewModal(false)}
                  className="text-slate-500 hover:text-black font-bold px-4 py-2 uppercase tracking-wide"
                >
                  Cancel
                </button>
                
                <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:space-x-0">
                  <button 
                    onClick={handleExport}
                    disabled={activeReviewPuzzles.length === 0}
                    className={`w-full justify-center px-6 py-3 border-2 border-black rounded-xl font-bold transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex items-center space-x-2 sm:w-auto ${
                      activeReviewPuzzles.length === 0
                        ? 'cursor-not-allowed bg-slate-200 text-slate-400 shadow-none border-slate-300'
                        : 'bg-white text-black hover:bg-slate-50 hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
                    }`}
                  >
                    <Download size={20} strokeWidth={2.5} />
                    <span>EXPORT JSON</span>
                  </button>
                  <button
                    onClick={handleExportImagePairs}
                    disabled={activeReviewPuzzles.length === 0}
                    className={`w-full justify-center px-4 py-2 border-2 border-black rounded-xl font-black text-xs uppercase tracking-wide transition-all shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] flex items-center space-x-2 sm:w-auto ${
                      activeReviewPuzzles.length === 0
                        ? 'cursor-not-allowed bg-slate-200 text-slate-400 shadow-none border-slate-300'
                        : 'bg-white text-black hover:bg-[#FDE68A] hover:translate-y-[1px] hover:translate-x-[1px] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
                    }`}
                  >
                    <ImageIcon size={16} strokeWidth={2.5} />
                    <span>EXPORT IMAGES</span>
                  </button>
                  {onExportVideo && (
                    <button
                      onClick={handleExportVideoFromReview}
                      disabled={activeReviewPuzzles.length === 0}
                      className={`w-full justify-center px-4 py-2 border-2 border-black rounded-xl font-black text-xs uppercase tracking-wide transition-all shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] flex items-center space-x-2 sm:w-auto ${
                        activeReviewPuzzles.length === 0
                          ? 'cursor-not-allowed bg-slate-200 text-slate-400 shadow-none border-slate-300'
                          : 'bg-white text-black hover:bg-[#E0E7FF] hover:translate-y-[1px] hover:translate-x-[1px] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
                      }`}
                    >
                      <Video size={16} strokeWidth={2.5} />
                      <span>EXPORT VIDEO</span>
                    </button>
                  )}
                   
                  <button 
                    onClick={handleConfirmBatch}
                    disabled={activeReviewPuzzles.length === 0}
                    className={`w-full justify-center px-8 py-3 border-2 border-black rounded-xl font-black transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex items-center space-x-2 text-base sm:text-lg sm:w-auto ${
                      activeReviewPuzzles.length === 0
                        ? 'cursor-not-allowed bg-slate-200 text-slate-400 shadow-none border-slate-300'
                        : 'bg-[#4ECDC4] text-black hover:bg-[#3DBDB4] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
                    }`}
                  >
                    <Play size={24} strokeWidth={3} />
                    <span>START GAME</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Editor Modal */}
      <AnimatePresence>
        {editingPuzzleIndex !== null && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white rounded-2xl border-4 border-black shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] w-full h-full max-w-7xl overflow-hidden flex flex-col"
            >
              <div className="p-4 border-b-4 border-black flex items-center justify-between gap-3 bg-[#FF6B6B]">
                <h3 className="text-xl sm:text-2xl font-black text-black font-display uppercase">Edit Puzzle</h3>
                <button 
                  onClick={() => setEditingPuzzleIndex(null)}
                  className="p-2 bg-white border-2 border-black hover:bg-slate-100 rounded-lg text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all"
                >
                  <X size={24} strokeWidth={3} />
                </button>
              </div>
              
              <div className="flex-1 overflow-hidden bg-[#FFFDF5]">
                <EditorCanvas 
                  imageA={reviewPuzzles[editingPuzzleIndex].imageA}
                  imageB={reviewPuzzles[editingPuzzleIndex].imageB}
                  initialRegions={reviewPuzzles[editingPuzzleIndex].regions}
                  onSave={(editedPuzzle) => handleSaveEditedPuzzle({
                    ...editedPuzzle,
                    title: reviewPuzzles[editingPuzzleIndex].title
                  })}
                  onPlay={() => {}} // Not needed in this context
                  onAddToBatch={() => {}} // Not needed in this context
                  batchCount={0}
                  isModal={true}
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {processing && (
        <div className="fixed bottom-5 right-5 z-[55] w-[min(24rem,calc(100vw-1.5rem))] rounded-[24px] border-4 border-black bg-white p-4 shadow-[10px_10px_0px_0px_rgba(0,0,0,1)] sm:bottom-6 sm:right-6 sm:p-5">
          <div className="flex items-start gap-4">
            <div className="mt-0.5 flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border-2 border-black bg-[#FFF7ED]">
              <div className="h-9 w-9 rounded-full border-[5px] border-black border-t-[#FF6B6B] animate-spin" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-[#2563EB]">Background Processing</div>
              <p className="mt-2 text-sm font-black uppercase leading-5 text-slate-900 sm:text-base">
                {processingStatus || "Processing..."}
              </p>
              <p className="mt-2 text-xs font-semibold leading-5 text-slate-600">
                Detection is running without taking over the whole screen. This page can stay open while the batch finishes.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
