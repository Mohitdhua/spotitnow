/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  canvasToBlob,
  canvasToDataUrl,
  createRuntimeCanvas,
  getRuntimeCanvasContext,
  isRuntimeCanvas,
  loadRuntimeImageFromSource
} from './canvasRuntime';

export type WatermarkImageInput =
  | string
  | Blob
  | HTMLImageElement
  | HTMLCanvasElement
  | OffscreenCanvas
  | ImageBitmap;

export interface WatermarkRemovalOptions {
  threshold?: number;
  maskExpansion?: number;
  maxWatermarkCoverage?: number;
  canvasA?: HTMLCanvasElement | OffscreenCanvas;
  canvasB?: HTMLCanvasElement | OffscreenCanvas;
  preset?: WatermarkPreset | null;
  customMaskA?: Uint8Array;
  customMaskB?: Uint8Array;
  heatmapBias?: number;
  templateBias?: number;
}

export interface WatermarkRemovalCanvasResult {
  imageA: HTMLCanvasElement;
  imageB: HTMLCanvasElement;
  coverageA: number;
  coverageB: number;
}

export interface WatermarkRemovalResult {
  imageAData: string;
  imageBData: string;
  processedAt: number;
  threshold: number;
  coverageA: number;
  coverageB: number;
}

export interface WatermarkRegion {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WatermarkSelectionPreset {
  id: string;
  name: string;
  sourceWidth: number;
  sourceHeight: number;
  regionsA: WatermarkRegion[];
  regionsB: WatermarkRegion[];
  createdAt: number;
  updatedAt: number;
}

export interface WatermarkTemplate {
  width: number;
  height: number;
  alphaMap: number[];
  occupancyMap: number[];
  sampleCount: number;
}

export interface WatermarkHeatmap {
  width: number;
  height: number;
  valuesA: number[];
  valuesB: number[];
  sampleCount: number;
}

export interface WatermarkPreset {
  id: string;
  name: string;
  threshold: number;
  maskExpansion: number;
  maxWatermarkCoverage: number;
  templateA: WatermarkTemplate | null;
  templateB: WatermarkTemplate | null;
  heatmap: WatermarkHeatmap | null;
  createdAt: number;
  updatedAt: number;
}

export interface WatermarkReferencePair {
  imageA: WatermarkImageInput;
  imageB: WatermarkImageInput;
}

export interface WatermarkMaskPayload {
  width: number;
  height: number;
  maskA: Uint8Array;
  maskB: Uint8Array;
  coverageA: number;
  coverageB: number;
}

export interface WatermarkRemovalDetailedResult
  extends WatermarkRemovalCanvasResult,
    WatermarkMaskPayload {
  templateA: WatermarkTemplate | null;
  templateB: WatermarkTemplate | null;
}

export interface WatermarkReferenceAnalysisResult {
  width: number;
  height: number;
  sampleCount: number;
  heatmap: WatermarkHeatmap | null;
  templateA: WatermarkTemplate | null;
  templateB: WatermarkTemplate | null;
}

type LoadedWatermarkImage = HTMLImageElement | HTMLCanvasElement | OffscreenCanvas | ImageBitmap;
type RuntimeWatermarkCanvas = HTMLCanvasElement | OffscreenCanvas;

interface ResolvedWatermarkRemovalOptions {
  threshold: number;
  maskExpansion: number;
  maxWatermarkCoverage: number;
  canvasA?: RuntimeWatermarkCanvas;
  canvasB?: RuntimeWatermarkCanvas;
  preset: WatermarkPreset | null;
  customMaskA?: Uint8Array;
  customMaskB?: Uint8Array;
  heatmapBias: number;
  templateBias: number;
}

interface MetricStats {
  mean: number;
  std: number;
}

interface ImageMetrics {
  grayscale: Float32Array;
  saturation: Float32Array;
  signedContrast: Float32Array;
  contrastMagnitude: Float32Array;
  edgeMagnitude: Float32Array;
  contrastStats: MetricStats;
  edgeStats: MetricStats;
}

interface SignalAccumulator {
  signedSum: number;
  contrastSum: number;
  edgeSum: number;
  saturationSum: number;
}

interface ComponentStats {
  id: number;
  area: number;
  differenceSum: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  signalA: SignalAccumulator;
  signalB: SignalAccumulator;
}

interface ComponentGroup {
  members: ComponentStats[];
  memberIds: number[];
  memberCount: number;
  area: number;
  differenceSum: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  signalA: SignalAccumulator;
  signalB: SignalAccumulator;
}

const DEFAULT_THRESHOLD = 24;
const DEFAULT_MASK_EXPANSION = 1;
const DEFAULT_MAX_WATERMARK_COVERAGE = 0.08;
const TEMPLATE_WIDTH = 96;
const TEMPLATE_HEIGHT = 32;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const createCanvas = (
  width: number,
  height: number,
  canvas?: RuntimeWatermarkCanvas
): HTMLCanvasElement => {
  return createRuntimeCanvas(width, height, canvas) as unknown as HTMLCanvasElement;
};

const getRequiredContext = (
  canvas: HTMLCanvasElement,
  settings?: CanvasRenderingContext2DSettings
): CanvasRenderingContext2D => {
  return getRuntimeCanvasContext(canvas, settings) as CanvasRenderingContext2D;
};

const resolveOptions = (
  options: WatermarkRemovalOptions = {}
): ResolvedWatermarkRemovalOptions => ({
  threshold: clamp(Math.round(options.threshold ?? DEFAULT_THRESHOLD), 0, 765),
  maskExpansion: clamp(Math.round(options.maskExpansion ?? DEFAULT_MASK_EXPANSION), 0, 4),
  maxWatermarkCoverage: clamp(
    options.maxWatermarkCoverage ?? DEFAULT_MAX_WATERMARK_COVERAGE,
    0.01,
    0.2
  ),
  canvasA: options.canvasA,
  canvasB: options.canvasB,
  preset: options.preset ?? null,
  customMaskA: options.customMaskA,
  customMaskB: options.customMaskB,
  heatmapBias: clamp(options.heatmapBias ?? 0.22, 0, 1),
  templateBias: clamp(options.templateBias ?? 0.26, 0, 1)
});

const createSignalAccumulator = (): SignalAccumulator => ({
  signedSum: 0,
  contrastSum: 0,
  edgeSum: 0,
  saturationSum: 0
});

const addSignal = (
  target: SignalAccumulator,
  source: SignalAccumulator
): SignalAccumulator => ({
  signedSum: target.signedSum + source.signedSum,
  contrastSum: target.contrastSum + source.contrastSum,
  edgeSum: target.edgeSum + source.edgeSum,
  saturationSum: target.saturationSum + source.saturationSum
});

const loadImageFromUrl = async (url: string): Promise<HTMLImageElement | ImageBitmap> =>
  await loadRuntimeImageFromSource(url);

const waitForImageElement = (image: HTMLImageElement): Promise<HTMLImageElement> => {
  if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
    return Promise.resolve(image);
  }

  return new Promise((resolve, reject) => {
    const handleLoad = () => {
      cleanup();
      resolve(image);
    };
    const handleError = () => {
      cleanup();
      reject(new Error('Failed to load image'));
    };
    const cleanup = () => {
      image.removeEventListener('load', handleLoad);
      image.removeEventListener('error', handleError);
    };

    image.addEventListener('load', handleLoad);
    image.addEventListener('error', handleError);
  });
};

const isImageElement = (value: unknown): value is HTMLImageElement =>
  typeof HTMLImageElement !== 'undefined' && value instanceof HTMLImageElement;

const isCanvasElement = (value: unknown): value is HTMLCanvasElement =>
  isRuntimeCanvas(value);

const isImageBitmapElement = (value: unknown): value is ImageBitmap =>
  typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap;

const resolveWatermarkImageInput = async (
  input: WatermarkImageInput
): Promise<LoadedWatermarkImage> => {
  if (typeof input === 'string') {
    return loadImageFromUrl(input);
  }

  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    if (typeof createImageBitmap === 'function') {
      return await createImageBitmap(input);
    }
    const objectUrl = URL.createObjectURL(input);
    try {
      return await loadImageFromUrl(objectUrl);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  if (isImageElement(input)) {
    return waitForImageElement(input);
  }

  if (isCanvasElement(input) || isImageBitmapElement(input)) {
    return input;
  }

  throw new Error('Unsupported image input');
};

const getImageDimensions = (
  image: LoadedWatermarkImage
): { width: number; height: number } => {
  if (isImageElement(image)) {
    return {
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height
    };
  }

  return {
    width: image.width,
    height: image.height
  };
};

const buildGrayscaleMap = (imageData: ImageData): Float32Array => {
  const grayscale = new Float32Array(imageData.width * imageData.height);
  const data = imageData.data;

  for (let index = 0, pixel = 0; index < grayscale.length; index += 1, pixel += 4) {
    grayscale[index] = 0.299 * data[pixel] + 0.587 * data[pixel + 1] + 0.114 * data[pixel + 2];
  }

  return grayscale;
};

const buildSaturationMap = (imageData: ImageData): Float32Array => {
  const saturation = new Float32Array(imageData.width * imageData.height);
  const data = imageData.data;

  for (let index = 0, pixel = 0; index < saturation.length; index += 1, pixel += 4) {
    const r = data[pixel] / 255;
    const g = data[pixel + 1] / 255;
    const b = data[pixel + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    saturation[index] = max === 0 ? 0 : (max - min) / max;
  }

  return saturation;
};

const boxBlur = (
  values: Float32Array,
  width: number,
  height: number,
  radius: number
): Float32Array => {
  if (radius <= 0) {
    return values.slice();
  }

  const horizontal = new Float32Array(width * height);
  const output = new Float32Array(width * height);
  const windowSize = radius * 2 + 1;

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width;
    let sum = 0;

    for (let offset = -radius; offset <= radius; offset += 1) {
      sum += values[rowOffset + clamp(offset, 0, width - 1)];
    }

    for (let x = 0; x < width; x += 1) {
      horizontal[rowOffset + x] = sum / windowSize;

      const removeIndex = rowOffset + clamp(x - radius, 0, width - 1);
      const addIndex = rowOffset + clamp(x + radius + 1, 0, width - 1);
      sum += values[addIndex] - values[removeIndex];
    }
  }

  for (let x = 0; x < width; x += 1) {
    let sum = 0;

    for (let offset = -radius; offset <= radius; offset += 1) {
      sum += horizontal[clamp(offset, 0, height - 1) * width + x];
    }

    for (let y = 0; y < height; y += 1) {
      output[y * width + x] = sum / windowSize;

      const removeIndex = clamp(y - radius, 0, height - 1) * width + x;
      const addIndex = clamp(y + radius + 1, 0, height - 1) * width + x;
      sum += horizontal[addIndex] - horizontal[removeIndex];
    }
  }

  return output;
};

const detectEdges = (
  grayscale: Float32Array,
  width: number,
  height: number
): Float32Array => {
  const edges = new Float32Array(width * height);

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const sample = (px: number, py: number) => grayscale[py * width + px];

      const gx =
        -1 * sample(x - 1, y - 1) +
        1 * sample(x + 1, y - 1) +
        -2 * sample(x - 1, y) +
        2 * sample(x + 1, y) +
        -1 * sample(x - 1, y + 1) +
        1 * sample(x + 1, y + 1);

      const gy =
        -1 * sample(x - 1, y - 1) +
        -2 * sample(x, y - 1) +
        -1 * sample(x + 1, y - 1) +
        1 * sample(x - 1, y + 1) +
        2 * sample(x, y + 1) +
        1 * sample(x + 1, y + 1);

      edges[y * width + x] = Math.sqrt(gx * gx + gy * gy);
    }
  }

  return edges;
};

const computeStats = (values: Float32Array): MetricStats => {
  if (values.length === 0) {
    return { mean: 0, std: 0 };
  }

  let sum = 0;
  for (let index = 0; index < values.length; index += 1) {
    sum += values[index];
  }

  const mean = sum / values.length;
  let variance = 0;

  for (let index = 0; index < values.length; index += 1) {
    const delta = values[index] - mean;
    variance += delta * delta;
  }

  return {
    mean,
    std: Math.sqrt(variance / values.length)
  };
};

const buildImageMetrics = (imageData: ImageData): ImageMetrics => {
  const width = imageData.width;
  const height = imageData.height;
  const grayscale = buildGrayscaleMap(imageData);
  const saturation = buildSaturationMap(imageData);
  const blurRadius = clamp(Math.round(Math.min(width, height) / 140), 3, 16);
  const blurred = boxBlur(grayscale, width, height, blurRadius);
  const edgeMagnitude = detectEdges(grayscale, width, height);
  const signedContrast = new Float32Array(width * height);
  const contrastMagnitude = new Float32Array(width * height);

  for (let index = 0; index < signedContrast.length; index += 1) {
    const delta = grayscale[index] - blurred[index];
    signedContrast[index] = delta;
    contrastMagnitude[index] = Math.abs(delta);
  }

  return {
    grayscale,
    saturation,
    signedContrast,
    contrastMagnitude,
    edgeMagnitude,
    contrastStats: computeStats(contrastMagnitude),
    edgeStats: computeStats(edgeMagnitude)
  };
};

const extractDifferenceScores = (
  dataA: Uint8ClampedArray,
  dataB: Uint8ClampedArray
): Uint16Array => {
  const pixelCount = dataA.length / 4;
  const differenceScores = new Uint16Array(pixelCount);

  for (let pixelIndex = 0, dataIndex = 0; pixelIndex < pixelCount; pixelIndex += 1, dataIndex += 4) {
    differenceScores[pixelIndex] =
      Math.abs(dataA[dataIndex] - dataB[dataIndex]) +
      Math.abs(dataA[dataIndex + 1] - dataB[dataIndex + 1]) +
      Math.abs(dataA[dataIndex + 2] - dataB[dataIndex + 2]);
  }

  return differenceScores;
};

const extractDifferenceComponents = (
  differenceScores: Uint16Array,
  width: number,
  height: number,
  threshold: number,
  metricsA: ImageMetrics,
  metricsB: ImageMetrics
): { components: ComponentStats[]; labels: Int32Array } => {
  const totalPixels = width * height;
  const labels = new Int32Array(totalPixels);
  const queue = new Int32Array(totalPixels);
  const components: ComponentStats[] = [];
  const offsets = [
    -width - 1,
    -width,
    -width + 1,
    -1,
    1,
    width - 1,
    width,
    width + 1
  ];

  for (let start = 0; start < totalPixels; start += 1) {
    if (differenceScores[start] <= threshold || labels[start] !== 0) continue;

    const componentId = components.length + 1;
    let head = 0;
    let tail = 0;

    queue[tail] = start;
    tail += 1;
    labels[start] = componentId;

    let area = 0;
    let differenceSum = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    const signalA = createSignalAccumulator();
    const signalB = createSignalAccumulator();

    while (head < tail) {
      const index = queue[head];
      head += 1;

      area += 1;
      differenceSum += differenceScores[index];
      const x = index % width;
      const y = Math.floor(index / width);

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      signalA.signedSum += metricsA.signedContrast[index];
      signalA.contrastSum += metricsA.contrastMagnitude[index];
      signalA.edgeSum += metricsA.edgeMagnitude[index];
      signalA.saturationSum += metricsA.saturation[index];

      signalB.signedSum += metricsB.signedContrast[index];
      signalB.contrastSum += metricsB.contrastMagnitude[index];
      signalB.edgeSum += metricsB.edgeMagnitude[index];
      signalB.saturationSum += metricsB.saturation[index];

      for (const offset of offsets) {
        const neighbor = index + offset;
        if (neighbor < 0 || neighbor >= totalPixels) continue;

        const neighborX = neighbor % width;
        const neighborY = Math.floor(neighbor / width);
        if (Math.abs(neighborX - x) > 1 || Math.abs(neighborY - y) > 1) continue;
        if (differenceScores[neighbor] <= threshold || labels[neighbor] !== 0) continue;

        labels[neighbor] = componentId;
        queue[tail] = neighbor;
        tail += 1;
      }
    }

    components.push({
      id: componentId,
      area,
      differenceSum,
      minX,
      minY,
      maxX,
      maxY,
      signalA,
      signalB
    });
  }

  return { components, labels };
};

const getComponentWidth = (component: ComponentStats): number =>
  component.maxX - component.minX + 1;

const getComponentHeight = (component: ComponentStats): number =>
  component.maxY - component.minY + 1;

const getComponentBoundingArea = (component: ComponentStats): number =>
  getComponentWidth(component) * getComponentHeight(component);

const getComponentCenterX = (component: ComponentStats): number =>
  (component.minX + component.maxX) * 0.5;

const getComponentCenterY = (component: ComponentStats): number =>
  (component.minY + component.maxY) * 0.5;

const getSignalProfile = (
  signal: SignalAccumulator,
  area: number
): {
  meanContrast: number;
  meanEdge: number;
  meanSaturation: number;
  signConsistency: number;
} => ({
  meanContrast: signal.contrastSum / Math.max(1, area),
  meanEdge: signal.edgeSum / Math.max(1, area),
  meanSaturation: signal.saturationSum / Math.max(1, area),
  signConsistency: signal.contrastSum > 0 ? Math.abs(signal.signedSum) / signal.contrastSum : 0
});

const scoreSignalProfile = (
  profile: ReturnType<typeof getSignalProfile>,
  metrics: ImageMetrics
): number => {
  const contrastThreshold = Math.max(4, metrics.contrastStats.mean + metrics.contrastStats.std * 0.9);
  const edgeThreshold = Math.max(6, metrics.edgeStats.mean + metrics.edgeStats.std * 0.55);
  const contrastScore = clamp(profile.meanContrast / contrastThreshold, 0, 1.6);
  const edgeScore = clamp(profile.meanEdge / edgeThreshold, 0, 1.5);
  const saturationScore = clamp(1 - profile.meanSaturation * 0.8, 0, 1);
  const polarityScore = clamp(profile.signConsistency, 0, 1);

  return (
    contrastScore * 0.4 +
    edgeScore * 0.24 +
    saturationScore * 0.14 +
    polarityScore * 0.22
  );
};

const isWatermarkLikeComponent = (
  component: ComponentStats,
  width: number,
  height: number
): boolean => {
  const imageArea = width * height;
  const componentWidth = getComponentWidth(component);
  const componentHeight = getComponentHeight(component);
  const boundingArea = getComponentBoundingArea(component);
  const density = component.area / Math.max(1, boundingArea);

  if (component.area < Math.max(4, Math.floor(imageArea * 0.000002))) return false;
  if (component.area > Math.floor(imageArea * 0.012)) return false;
  if (boundingArea > Math.floor(imageArea * 0.018)) return false;
  if (componentWidth > width * 0.5 || componentHeight > height * 0.22) return false;
  if (density < 0.015 || density > 0.95) return false;

  return true;
};

const canGroupComponents = (
  first: ComponentStats,
  second: ComponentStats
): boolean => {
  const maxHeight = Math.max(getComponentHeight(first), getComponentHeight(second));
  const horizontalGap =
    first.maxX < second.minX
      ? second.minX - first.maxX - 1
      : second.maxX < first.minX
        ? first.minX - second.maxX - 1
        : 0;
  const verticalDelta = Math.abs(getComponentCenterY(first) - getComponentCenterY(second));
  const maxGapX = Math.max(6, Math.round(maxHeight * 3.2));
  const maxGapY = Math.max(5, Math.round(maxHeight * 1.25));

  return verticalDelta <= maxGapY && horizontalGap <= maxGapX;
};

const groupComponents = (components: ComponentStats[]): ComponentGroup[] => {
  if (components.length === 0) {
    return [];
  }

  const groups: ComponentGroup[] = [];
  const visited = new Uint8Array(components.length);
  const queue = new Int32Array(components.length);

  for (let startIndex = 0; startIndex < components.length; startIndex += 1) {
    if (visited[startIndex] === 1) continue;

    let head = 0;
    let tail = 0;
    queue[tail] = startIndex;
    tail += 1;
    visited[startIndex] = 1;

    let group: ComponentGroup = {
      members: [],
      memberIds: [],
      memberCount: 0,
      area: 0,
      differenceSum: 0,
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: 0,
      maxY: 0,
      signalA: createSignalAccumulator(),
      signalB: createSignalAccumulator()
    };

    while (head < tail) {
      const componentIndex = queue[head];
      head += 1;
      const component = components[componentIndex];

      group.members.push(component);
      group.memberIds.push(component.id);
      group.memberCount += 1;
      group.area += component.area;
      group.differenceSum += component.differenceSum;
      group.minX = Math.min(group.minX, component.minX);
      group.minY = Math.min(group.minY, component.minY);
      group.maxX = Math.max(group.maxX, component.maxX);
      group.maxY = Math.max(group.maxY, component.maxY);
      group.signalA = addSignal(group.signalA, component.signalA);
      group.signalB = addSignal(group.signalB, component.signalB);

      for (let candidateIndex = 0; candidateIndex < components.length; candidateIndex += 1) {
        if (visited[candidateIndex] === 1) continue;
        if (!canGroupComponents(component, components[candidateIndex])) continue;

        visited[candidateIndex] = 1;
        queue[tail] = candidateIndex;
        tail += 1;
      }
    }

    groups.push(group);
  }

  return groups;
};

const getGroupWidth = (group: ComponentGroup): number => group.maxX - group.minX + 1;

const getGroupHeight = (group: ComponentGroup): number => group.maxY - group.minY + 1;

const getGroupBoundingArea = (group: ComponentGroup): number =>
  getGroupWidth(group) * getGroupHeight(group);

const getGroupAlignmentScore = (group: ComponentGroup): number => {
  if (group.memberCount <= 1) {
    return 0.45;
  }

  let meanCenterY = 0;
  for (const component of group.members) {
    meanCenterY += getComponentCenterY(component);
  }
  meanCenterY /= group.memberCount;

  let variance = 0;
  for (const component of group.members) {
    const delta = getComponentCenterY(component) - meanCenterY;
    variance += delta * delta;
  }

  const std = Math.sqrt(variance / group.memberCount);
  return clamp(1 - std / Math.max(1, getGroupHeight(group) * 0.65), 0, 1);
};

const scoreTextCluster = (
  group: ComponentGroup,
  width: number,
  height: number
): number => {
  const groupWidth = group.maxX - group.minX + 1;
  const groupHeight = group.maxY - group.minY + 1;
  const boundingArea = getGroupBoundingArea(group);
  const density = group.area / Math.max(1, boundingArea);
  const aspectRatio = groupWidth / Math.max(1, groupHeight);
  const componentScore = clamp(group.memberCount / 6, 0, 1);
  const aspectScore = clamp((aspectRatio - 1.4) / 6.2, 0, 1);
  const alignmentScore = getGroupAlignmentScore(group);
  const densityScore = clamp(1 - Math.abs(density - 0.24) / 0.24, 0, 1);
  const widthScore = clamp((groupWidth / Math.max(1, width)) * 4.5, 0, 1);

  let score =
    componentScore * 0.24 +
    aspectScore * 0.22 +
    alignmentScore * 0.2 +
    densityScore * 0.18 +
    widthScore * 0.16;

  if (density < 0.02 || density > 0.82) {
    score *= 0.5;
  }

  if (boundingArea > width * height * 0.12) {
    score *= 0.35;
  }

  if (aspectRatio < 1.6) {
    score *= 0.45;
  }

  if (group.memberCount === 1 && aspectRatio < 3) {
    score *= 0.35;
  }

  if (groupHeight > height * 0.18) {
    score *= 0.25;
  }

  return score;
};

const scoreWatermarkSide = (
  group: ComponentGroup,
  metrics: ImageMetrics,
  side: 'A' | 'B',
  threshold: number
): number => {
  const profile = getSignalProfile(side === 'A' ? group.signalA : group.signalB, group.area);
  const signalScore = scoreSignalProfile(profile, metrics);
  const differenceScore = clamp(
    (group.differenceSum / Math.max(1, group.area)) / Math.max(1, threshold),
    0,
    1.4
  );

  return signalScore * 0.82 + differenceScore * 0.18;
};

interface ScoredWatermarkGroup {
  group: ComponentGroup;
  textScore: number;
  heatmapScoreA: number;
  heatmapScoreB: number;
  templateScoreA: number;
  templateScoreB: number;
  scoreA: number;
  scoreB: number;
  combinedScoreA: number;
  combinedScoreB: number;
  dominantSide: 'A' | 'B';
  dominantScore: number;
  scoreGap: number;
  strictCandidate: boolean;
  relaxedCandidate: boolean;
}

const dilateMask = (
  mask: Uint8Array,
  width: number,
  height: number,
  iterations: number
): Uint8Array => {
  let current = mask;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const next = new Uint8Array(width * height);

    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const index = y * width + x;
        if (
          current[index] > 0 ||
          current[index - width - 1] > 0 ||
          current[index - width] > 0 ||
          current[index - width + 1] > 0 ||
          current[index - 1] > 0 ||
          current[index + 1] > 0 ||
          current[index + width - 1] > 0 ||
          current[index + width] > 0 ||
          current[index + width + 1] > 0
        ) {
          next[index] = 255;
        }
      }
    }

    current = next;
  }

  return current;
};

const filterMaskComponentsByArea = (
  mask: Uint8Array,
  width: number,
  height: number,
  minArea: number
): Uint8Array => {
  if (minArea <= 1) {
    return mask;
  }

  const output = new Uint8Array(mask.length);
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);

  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] === 0 || visited[start] === 1) continue;

    let head = 0;
    let tail = 0;
    const pixels: number[] = [];

    visited[start] = 1;
    queue[tail] = start;
    tail += 1;

    while (head < tail) {
      const index = queue[head];
      head += 1;
      pixels.push(index);
      const x = index % width;
      const y = Math.floor(index / width);

      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const neighborX = x + dx;
          const neighborY = y + dy;
          if (neighborX < 0 || neighborX >= width || neighborY < 0 || neighborY >= height) {
            continue;
          }

          const neighbor = neighborY * width + neighborX;
          if (mask[neighbor] === 0 || visited[neighbor] === 1) continue;

          visited[neighbor] = 1;
          queue[tail] = neighbor;
          tail += 1;
        }
      }
    }

    if (pixels.length < minArea) {
      continue;
    }

    for (const pixelIndex of pixels) {
      output[pixelIndex] = 255;
    }
  }

  return output;
};

const clearMaskOverlap = (maskA: Uint8Array, maskB: Uint8Array): void => {
  for (let index = 0; index < maskA.length; index += 1) {
    if (maskA[index] > 0 && maskB[index] > 0) {
      maskA[index] = 0;
      maskB[index] = 0;
    }
  }
};

const getMaskBounds = (
  mask: Uint8Array,
  width: number,
  height: number
): { minX: number; minY: number; maxX: number; maxY: number } | null => {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] === 0) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  if (maxX < minX || maxY < minY) {
    return null;
  }

  return { minX, minY, maxX, maxY };
};

const resampleScalarField = (
  values: ArrayLike<number>,
  srcWidth: number,
  srcHeight: number,
  targetWidth: number,
  targetHeight: number,
  normalizer: number
): number[] => {
  const output = new Array<number>(targetWidth * targetHeight).fill(0);

  for (let targetY = 0; targetY < targetHeight; targetY += 1) {
    const sourceY0 = Math.floor((targetY * srcHeight) / targetHeight);
    const sourceY1 = Math.max(sourceY0 + 1, Math.ceil(((targetY + 1) * srcHeight) / targetHeight));

    for (let targetX = 0; targetX < targetWidth; targetX += 1) {
      const sourceX0 = Math.floor((targetX * srcWidth) / targetWidth);
      const sourceX1 = Math.max(sourceX0 + 1, Math.ceil(((targetX + 1) * srcWidth) / targetWidth));
      let sum = 0;
      let samples = 0;

      for (let y = sourceY0; y < sourceY1; y += 1) {
        for (let x = sourceX0; x < sourceX1; x += 1) {
          sum += values[y * srcWidth + x];
          samples += 1;
        }
      }

      output[targetY * targetWidth + targetX] =
        samples > 0 ? sum / samples / Math.max(1, normalizer) : 0;
    }
  }

  return output;
};

const extractGroupLocalMask = (
  group: ComponentGroup,
  labels: Int32Array,
  width: number,
  height: number
): { mask: Uint8Array; width: number; height: number } | null => {
  const localWidth = group.maxX - group.minX + 1;
  const localHeight = group.maxY - group.minY + 1;
  if (localWidth <= 0 || localHeight <= 0) {
    return null;
  }

  const memberIds = new Set(group.memberIds);
  const localMask = new Uint8Array(localWidth * localHeight);

  for (let y = group.minY; y <= group.maxY; y += 1) {
    const rowOffset = y * width;
    for (let x = group.minX; x <= group.maxX; x += 1) {
      const label = labels[rowOffset + x];
      if (!memberIds.has(label)) continue;
      localMask[(y - group.minY) * localWidth + (x - group.minX)] = 255;
    }
  }

  return {
    mask: localMask,
    width: localWidth,
    height: localHeight
  };
};

const compareMaskToTemplate = (
  group: ComponentGroup,
  labels: Int32Array,
  width: number,
  height: number,
  template: WatermarkTemplate | null
): number => {
  if (!template) {
    return 0;
  }

  const extracted = extractGroupLocalMask(group, labels, width, height);
  if (!extracted) {
    return 0;
  }

  const sampledMask = resampleScalarField(
    extracted.mask,
    extracted.width,
    extracted.height,
    template.width,
    template.height,
    255
  );

  let dot = 0;
  let magMask = 0;
  let magTemplate = 0;

  for (let index = 0; index < sampledMask.length; index += 1) {
    const maskValue = sampledMask[index];
    const templateValue = Math.max(
      template.occupancyMap[index] ?? 0,
      template.alphaMap[index] ?? 0
    );
    dot += maskValue * templateValue;
    magMask += maskValue * maskValue;
    magTemplate += templateValue * templateValue;
  }

  if (magMask === 0 || magTemplate === 0) {
    return 0;
  }

  return clamp(dot / Math.sqrt(magMask * magTemplate), 0, 1);
};

const getHeatmapValuesForSide = (
  heatmap: WatermarkHeatmap,
  side: 'A' | 'B'
): number[] => (side === 'A' ? heatmap.valuesA : heatmap.valuesB);

const computeHeatmapScore = (
  group: ComponentGroup,
  width: number,
  height: number,
  heatmap: WatermarkHeatmap | null,
  side: 'A' | 'B'
): number => {
  if (!heatmap) {
    return 0;
  }

  const heatmapValues = getHeatmapValuesForSide(heatmap, side);
  if (heatmapValues.length === 0) {
    return 0;
  }

  const scaleX = heatmap.width / Math.max(1, width);
  const scaleY = heatmap.height / Math.max(1, height);
  const x0 = clamp(Math.floor(group.minX * scaleX), 0, heatmap.width - 1);
  const y0 = clamp(Math.floor(group.minY * scaleY), 0, heatmap.height - 1);
  const x1 = clamp(Math.ceil((group.maxX + 1) * scaleX), 1, heatmap.width);
  const y1 = clamp(Math.ceil((group.maxY + 1) * scaleY), 1, heatmap.height);

  let sum = 0;
  let samples = 0;

  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      sum += heatmapValues[y * heatmap.width + x] ?? 0;
      samples += 1;
    }
  }

  return samples > 0 ? clamp(sum / samples, 0, 1) : 0;
};

const measureMaskCoverage = (mask: Uint8Array): number => {
  let covered = 0;
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] > 0) covered += 1;
  }
  return covered / Math.max(1, mask.length);
};

const isStrictWatermarkCandidate = (entry: ScoredWatermarkGroup): boolean => {
  if (entry.textScore < 0.54 && entry.templateScoreA < 0.72 && entry.templateScoreB < 0.72) {
    return false;
  }
  if (Math.max(entry.combinedScoreA, entry.combinedScoreB) < 0.64) {
    return false;
  }
  if (entry.scoreGap < 0.08 && entry.dominantScore < 0.94) {
    return false;
  }
  return true;
};

const isRelaxedWatermarkCandidate = (entry: ScoredWatermarkGroup): boolean => {
  if (entry.textScore < 0.48 && entry.templateScoreA < 0.64 && entry.templateScoreB < 0.64) {
    return false;
  }
  if (Math.max(entry.combinedScoreA, entry.combinedScoreB) < 0.58) {
    return false;
  }
  if (entry.scoreGap < 0.12 && entry.dominantScore < 1.02) {
    return false;
  }
  return true;
};

const isSideRecoveryCandidate = (
  entry: ScoredWatermarkGroup,
  side: 'A' | 'B'
): boolean => {
  const sideCombined = side === 'A' ? entry.combinedScoreA : entry.combinedScoreB;
  const otherCombined = side === 'A' ? entry.combinedScoreB : entry.combinedScoreA;
  const sideTemplate = side === 'A' ? entry.templateScoreA : entry.templateScoreB;
  const sideHeatmap = side === 'A' ? entry.heatmapScoreA : entry.heatmapScoreB;

  if (entry.textScore < 0.42 && sideTemplate < 0.58 && sideHeatmap < 0.6) {
    return false;
  }
  if (sideCombined < 0.54) {
    return false;
  }
  if (sideCombined + 0.08 < otherCombined && sideTemplate < 0.7 && sideHeatmap < 0.72) {
    return false;
  }

  return true;
};

const selectWatermarkMasks = (
  components: ComponentStats[],
  labels: Int32Array,
  width: number,
  height: number,
  metricsA: ImageMetrics,
  metricsB: ImageMetrics,
  options: ResolvedWatermarkRemovalOptions
): { maskA: Uint8Array; maskB: Uint8Array; coverageA: number; coverageB: number } => {
  const candidateComponents = components.filter((component) =>
    isWatermarkLikeComponent(component, width, height)
  );
  const groups = groupComponents(candidateComponents);
  const selectedIdsA = new Set<number>();
  const selectedIdsB = new Set<number>();
  const totalPixels = width * height;
  let selectedCoverageA = 0;
  let selectedCoverageB = 0;

  const scoredGroups: ScoredWatermarkGroup[] = groups
    .map((group) => {
      const scoreA = scoreWatermarkSide(group, metricsA, 'A', options.threshold);
      const scoreB = scoreWatermarkSide(group, metricsB, 'B', options.threshold);
      const textScore = scoreTextCluster(group, width, height);
      const heatmapScoreA = computeHeatmapScore(
        group,
        width,
        height,
        options.preset?.heatmap ?? null,
        'A'
      );
      const heatmapScoreB = computeHeatmapScore(
        group,
        width,
        height,
        options.preset?.heatmap ?? null,
        'B'
      );
      const templateScoreA = compareMaskToTemplate(
        group,
        labels,
        width,
        height,
        options.preset?.templateA ?? null
      );
      const templateScoreB = compareMaskToTemplate(
        group,
        labels,
        width,
        height,
        options.preset?.templateB ?? null
      );
      const combinedScoreA =
        textScore * 0.62 +
        clamp(scoreA / 1.05, 0, 1.25) * 0.38 +
        heatmapScoreA * options.heatmapBias +
        templateScoreA * options.templateBias;
      const combinedScoreB =
        textScore * 0.62 +
        clamp(scoreB / 1.05, 0, 1.25) * 0.38 +
        heatmapScoreB * options.heatmapBias +
        templateScoreB * options.templateBias;
      const dominantSide = combinedScoreA >= combinedScoreB ? 'A' : 'B';
      const dominantScore = Math.max(combinedScoreA, combinedScoreB);

      const entry: ScoredWatermarkGroup = {
        group,
        textScore,
        heatmapScoreA,
        heatmapScoreB,
        templateScoreA,
        templateScoreB,
        scoreA,
        scoreB,
        combinedScoreA,
        combinedScoreB,
        dominantSide,
        dominantScore,
        scoreGap: Math.abs(combinedScoreA - combinedScoreB),
        strictCandidate: false,
        relaxedCandidate: false
      };
      entry.strictCandidate = isStrictWatermarkCandidate(entry);
      entry.relaxedCandidate = isRelaxedWatermarkCandidate(entry);
      return entry;
    });

  const rankedGroups = scoredGroups
    .filter((entry) => entry.strictCandidate || entry.relaxedCandidate)
    .sort((first, second) => {
      if (Number(second.strictCandidate) !== Number(first.strictCandidate)) {
        return Number(second.strictCandidate) - Number(first.strictCandidate);
      }
      return second.dominantScore - first.dominantScore;
    });

  for (const entry of rankedGroups) {
    const groupCoverage = entry.group.area / Math.max(1, totalPixels);

    if (entry.dominantSide === 'A') {
      if (selectedCoverageA + groupCoverage > options.maxWatermarkCoverage) continue;
      selectedCoverageA += groupCoverage;
      for (const componentId of entry.group.memberIds) {
        selectedIdsA.add(componentId);
      }
      continue;
    }

    if (selectedCoverageB + groupCoverage > options.maxWatermarkCoverage) continue;
    selectedCoverageB += groupCoverage;
    for (const componentId of entry.group.memberIds) {
      selectedIdsB.add(componentId);
    }
  }

  const recoverSide = (side: 'A' | 'B') => {
    const targetCoverage = side === 'A' ? selectedCoverageA : selectedCoverageB;
    const otherCoverage = side === 'A' ? selectedCoverageB : selectedCoverageA;
    if (targetCoverage > 0 && targetCoverage >= otherCoverage * 0.15) {
      return;
    }

    const selectedIds = side === 'A' ? selectedIdsA : selectedIdsB;
    const oppositeIds = side === 'A' ? selectedIdsB : selectedIdsA;
    const recoveryCandidates = scoredGroups
      .filter(
        (entry) =>
          !entry.group.memberIds.some(
            (componentId) => selectedIds.has(componentId) || oppositeIds.has(componentId)
          )
      )
      .filter((entry) => isSideRecoveryCandidate(entry, side))
      .sort((first, second) => {
        const firstScore = side === 'A' ? first.combinedScoreA : first.combinedScoreB;
        const secondScore = side === 'A' ? second.combinedScoreA : second.combinedScoreB;
        return secondScore - firstScore;
      });

    for (const entry of recoveryCandidates) {
      const groupCoverage = entry.group.area / Math.max(1, totalPixels);

      if (side === 'A') {
        if (selectedCoverageA + groupCoverage > options.maxWatermarkCoverage) continue;
        selectedCoverageA += groupCoverage;
      } else {
        if (selectedCoverageB + groupCoverage > options.maxWatermarkCoverage) continue;
        selectedCoverageB += groupCoverage;
      }

      for (const componentId of entry.group.memberIds) {
        selectedIds.add(componentId);
      }

      const updatedCoverage = side === 'A' ? selectedCoverageA : selectedCoverageB;
      if (updatedCoverage >= Math.max(0.00035, otherCoverage * 0.25)) {
        break;
      }
    }
  };

  recoverSide('A');
  recoverSide('B');

  let maskA = new Uint8Array(totalPixels);
  let maskB = new Uint8Array(totalPixels);

  for (let index = 0; index < labels.length; index += 1) {
    const label = labels[index];
    if (selectedIdsA.has(label)) {
      maskA[index] = 255;
    }
    if (selectedIdsB.has(label)) {
      maskB[index] = 255;
    }
  }

  if (options.maskExpansion > 0) {
    maskA = dilateMask(maskA, width, height, options.maskExpansion);
    maskB = dilateMask(maskB, width, height, options.maskExpansion);
  }

  const minMaskArea = Math.max(6, Math.floor(totalPixels * 0.0000025));
  maskA = filterMaskComponentsByArea(maskA, width, height, minMaskArea);
  maskB = filterMaskComponentsByArea(maskB, width, height, minMaskArea);
  clearMaskOverlap(maskA, maskB);

  let coverageA = measureMaskCoverage(maskA);
  let coverageB = measureMaskCoverage(maskB);

  if (coverageA > options.maxWatermarkCoverage) {
    maskA = new Uint8Array(totalPixels);
    coverageA = 0;
  }

  if (coverageB > options.maxWatermarkCoverage) {
    maskB = new Uint8Array(totalPixels);
    coverageB = 0;
  }

  return { maskA, maskB, coverageA, coverageB };
};

const applyReplacementMask = (
  source: ImageData,
  replacement: ImageData,
  mask: Uint8Array
): ImageData => {
  const output = new Uint8ClampedArray(source.data);

  for (let pixelIndex = 0, dataIndex = 0; pixelIndex < mask.length; pixelIndex += 1, dataIndex += 4) {
    if (mask[pixelIndex] === 0) {
      output[dataIndex + 3] = 255;
      continue;
    }

    output[dataIndex] = replacement.data[dataIndex];
    output[dataIndex + 1] = replacement.data[dataIndex + 1];
    output[dataIndex + 2] = replacement.data[dataIndex + 2];
    output[dataIndex + 3] = 255;
  }

  return new ImageData(output, source.width, source.height);
};

const normalizeRegion = (
  region: WatermarkRegion,
  width: number,
  height: number
): WatermarkRegion | null => {
  const x = clamp(Math.round(region.x), 0, Math.max(0, width - 1));
  const y = clamp(Math.round(region.y), 0, Math.max(0, height - 1));
  const maxWidth = Math.max(0, width - x);
  const maxHeight = Math.max(0, height - y);
  const normalizedWidth = clamp(Math.round(region.width), 0, maxWidth);
  const normalizedHeight = clamp(Math.round(region.height), 0, maxHeight);

  if (normalizedWidth <= 0 || normalizedHeight <= 0) {
    return null;
  }

  return {
    id: region.id,
    x,
    y,
    width: normalizedWidth,
    height: normalizedHeight
  };
};

export const normalizeWatermarkRegions = (
  regions: WatermarkRegion[],
  width: number,
  height: number
): WatermarkRegion[] =>
  regions
    .map((region) => normalizeRegion(region, width, height))
    .filter((region): region is WatermarkRegion => Boolean(region));

export const createMaskFromRegions = (
  regions: WatermarkRegion[],
  width: number,
  height: number
): Uint8Array => {
  const mask = new Uint8Array(width * height);
  const normalizedRegions = normalizeWatermarkRegions(regions, width, height);

  for (const region of normalizedRegions) {
    const endY = region.y + region.height;
    const endX = region.x + region.width;

    for (let y = region.y; y < endY; y += 1) {
      const rowOffset = y * width;
      for (let x = region.x; x < endX; x += 1) {
        mask[rowOffset + x] = 255;
      }
    }
  }

  return mask;
};

export const scaleWatermarkRegions = (
  regions: WatermarkRegion[],
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number
): WatermarkRegion[] => {
  const scaleX = sourceWidth > 0 ? targetWidth / sourceWidth : 1;
  const scaleY = sourceHeight > 0 ? targetHeight / sourceHeight : 1;

  return normalizeWatermarkRegions(
    regions.map((region) => ({
      ...region,
      x: Math.round(region.x * scaleX),
      y: Math.round(region.y * scaleY),
      width: Math.max(1, Math.round(region.width * scaleX)),
      height: Math.max(1, Math.round(region.height * scaleY))
    })),
    targetWidth,
    targetHeight
  );
};

export const createWatermarkSelectionPreset = (
  name: string,
  sourceWidth: number,
  sourceHeight: number,
  regionsA: WatermarkRegion[],
  regionsB: WatermarkRegion[],
  existingId?: string
): WatermarkSelectionPreset => {
  const now = Date.now();

  return {
    id: existingId ?? `watermark-selection-${now}`,
    name: name.trim() || `Selection ${new Date(now).toLocaleString()}`,
    sourceWidth,
    sourceHeight,
    regionsA: normalizeWatermarkRegions(regionsA, sourceWidth, sourceHeight),
    regionsB: normalizeWatermarkRegions(regionsB, sourceWidth, sourceHeight),
    createdAt: now,
    updatedAt: now
  };
};

const createWatermarkHeatmapFromMasks = (
  maskA: Uint8Array,
  maskB: Uint8Array,
  width: number,
  height: number
): WatermarkHeatmap => ({
  width,
  height,
  valuesA: Array.from(maskA, (value) => (value > 0 ? 1 : 0)),
  valuesB: Array.from(maskB, (value) => (value > 0 ? 1 : 0)),
  sampleCount: 1
});

const createTemplateFromMask = (
  source: ImageData,
  replacement: ImageData,
  mask: Uint8Array
): WatermarkTemplate | null => {
  const bounds = getMaskBounds(mask, source.width, source.height);
  if (!bounds) {
    return null;
  }

  const localWidth = bounds.maxX - bounds.minX + 1;
  const localHeight = bounds.maxY - bounds.minY + 1;
  const localMask = new Uint8Array(localWidth * localHeight);
  const localDelta = new Float32Array(localWidth * localHeight);
  let maxDelta = 0;

  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const globalIndex = y * source.width + x;
      if (mask[globalIndex] === 0) continue;

      const localIndex = (y - bounds.minY) * localWidth + (x - bounds.minX);
      const dataIndex = globalIndex * 4;
      const delta =
        (Math.abs(source.data[dataIndex] - replacement.data[dataIndex]) +
          Math.abs(source.data[dataIndex + 1] - replacement.data[dataIndex + 1]) +
          Math.abs(source.data[dataIndex + 2] - replacement.data[dataIndex + 2])) /
        765;

      localMask[localIndex] = 255;
      localDelta[localIndex] = delta;
      maxDelta = Math.max(maxDelta, delta);
    }
  }

  const occupancyMap = resampleScalarField(
    localMask,
    localWidth,
    localHeight,
    TEMPLATE_WIDTH,
    TEMPLATE_HEIGHT,
    255
  );
  const alphaMap = resampleScalarField(
    localDelta,
    localWidth,
    localHeight,
    TEMPLATE_WIDTH,
    TEMPLATE_HEIGHT,
    1
  ).map((value) => (maxDelta > 0 ? clamp(value / maxDelta, 0, 1) : 0));

  return {
    width: TEMPLATE_WIDTH,
    height: TEMPLATE_HEIGHT,
    occupancyMap,
    alphaMap,
    sampleCount: 1
  };
};

const mergeTemplates = (templates: Array<WatermarkTemplate | null>): WatermarkTemplate | null => {
  const validTemplates = templates.filter((template): template is WatermarkTemplate => Boolean(template));
  if (validTemplates.length === 0) {
    return null;
  }

  const base = validTemplates[0];
  const alphaMap = new Array<number>(base.width * base.height).fill(0);
  const occupancyMap = new Array<number>(base.width * base.height).fill(0);

  for (const template of validTemplates) {
    for (let index = 0; index < alphaMap.length; index += 1) {
      alphaMap[index] += template.alphaMap[index] ?? 0;
      occupancyMap[index] += template.occupancyMap[index] ?? 0;
    }
  }

  const count = validTemplates.length;
  for (let index = 0; index < alphaMap.length; index += 1) {
    alphaMap[index] /= count;
    occupancyMap[index] /= count;
  }

  return {
    width: base.width,
    height: base.height,
    alphaMap,
    occupancyMap,
    sampleCount: count
  };
};

const sanitizeCustomMask = (
  mask: Uint8Array | undefined,
  expectedLength: number
): Uint8Array | undefined => {
  if (!mask) {
    return undefined;
  }

  if (mask.length !== expectedLength) {
    throw new Error('Manual watermark mask size does not match the image resolution.');
  }

  return new Uint8Array(mask);
};

const loadWatermarkPair = async (
  imageAInput: WatermarkImageInput,
  imageBInput: WatermarkImageInput,
  options: ResolvedWatermarkRemovalOptions
) => {
  const [imageA, imageB] = await Promise.all([
    resolveWatermarkImageInput(imageAInput),
    resolveWatermarkImageInput(imageBInput)
  ]);
  const imageADimensions = getImageDimensions(imageA);
  const imageBDimensions = getImageDimensions(imageB);

  if (
    imageADimensions.width !== imageBDimensions.width ||
    imageADimensions.height !== imageBDimensions.height
  ) {
    throw new Error('Both images must have the same resolution');
  }

  const width = imageADimensions.width;
  const height = imageADimensions.height;
  const sourceCanvasA = createCanvas(width, height);
  const sourceCanvasB = createCanvas(width, height);
  const outputCanvasA = createCanvas(width, height, options.canvasA);
  const outputCanvasB = createCanvas(width, height, options.canvasB);
  const sourceContextA = getRequiredContext(sourceCanvasA, { willReadFrequently: true });
  const sourceContextB = getRequiredContext(sourceCanvasB, { willReadFrequently: true });
  const outputContextA = getRequiredContext(outputCanvasA);
  const outputContextB = getRequiredContext(outputCanvasB);

  sourceContextA.drawImage(imageA, 0, 0, width, height);
  sourceContextB.drawImage(imageB, 0, 0, width, height);

  return {
    width,
    height,
    outputCanvasA,
    outputCanvasB,
    outputContextA,
    outputContextB,
    imageDataA: sourceContextA.getImageData(0, 0, width, height),
    imageDataB: sourceContextB.getImageData(0, 0, width, height)
  };
};

export async function removeWatermarkDetailed(
  imageAInput: WatermarkImageInput,
  imageBInput: WatermarkImageInput,
  options: WatermarkRemovalOptions = {}
): Promise<WatermarkRemovalDetailedResult> {
  const resolvedOptions = resolveOptions(options);
  const pair = await loadWatermarkPair(imageAInput, imageBInput, resolvedOptions);
  const pixelCount = pair.width * pair.height;

  let maskA = sanitizeCustomMask(resolvedOptions.customMaskA, pixelCount);
  let maskB = sanitizeCustomMask(resolvedOptions.customMaskB, pixelCount);
  let coverageA = 0;
  let coverageB = 0;

  if (!maskA || !maskB) {
    const metricsA = buildImageMetrics(pair.imageDataA);
    const metricsB = buildImageMetrics(pair.imageDataB);
    const differenceScores = extractDifferenceScores(pair.imageDataA.data, pair.imageDataB.data);
    const { components, labels } = extractDifferenceComponents(
      differenceScores,
      pair.width,
      pair.height,
      resolvedOptions.threshold,
      metricsA,
      metricsB
    );
    const detected = selectWatermarkMasks(
      components,
      labels,
      pair.width,
      pair.height,
      metricsA,
      metricsB,
      resolvedOptions
    );
    maskA = detected.maskA;
    maskB = detected.maskB;
    coverageA = detected.coverageA;
    coverageB = detected.coverageB;
  } else {
    coverageA = measureMaskCoverage(maskA);
    coverageB = measureMaskCoverage(maskB);
  }

  const cleanedImageDataA = applyReplacementMask(pair.imageDataA, pair.imageDataB, maskA);
  const cleanedImageDataB = applyReplacementMask(pair.imageDataB, pair.imageDataA, maskB);
  pair.outputContextA.putImageData(cleanedImageDataA, 0, 0);
  pair.outputContextB.putImageData(cleanedImageDataB, 0, 0);

  return {
    imageA: pair.outputCanvasA,
    imageB: pair.outputCanvasB,
    width: pair.width,
    height: pair.height,
    maskA: new Uint8Array(maskA),
    maskB: new Uint8Array(maskB),
    coverageA,
    coverageB,
    templateA: createTemplateFromMask(pair.imageDataA, pair.imageDataB, maskA),
    templateB: createTemplateFromMask(pair.imageDataB, pair.imageDataA, maskB)
  };
}

export async function applyWatermarkMasks(
  imageAInput: WatermarkImageInput,
  imageBInput: WatermarkImageInput,
  maskPayload: Pick<WatermarkMaskPayload, 'maskA' | 'maskB'>,
  options: WatermarkRemovalOptions = {}
): Promise<WatermarkRemovalDetailedResult> {
  return removeWatermarkDetailed(imageAInput, imageBInput, {
    ...options,
    customMaskA: maskPayload.maskA,
    customMaskB: maskPayload.maskB
  });
}

export async function removeWatermarkWithRegions(
  imageAInput: WatermarkImageInput,
  imageBInput: WatermarkImageInput,
  regionsA: WatermarkRegion[],
  regionsB: WatermarkRegion[],
  options: WatermarkRemovalOptions = {}
): Promise<WatermarkRemovalDetailedResult> {
  const resolvedOptions = resolveOptions(options);
  const pair = await loadWatermarkPair(imageAInput, imageBInput, resolvedOptions);
  const maskA = createMaskFromRegions(regionsA, pair.width, pair.height);
  const maskB = createMaskFromRegions(regionsB, pair.width, pair.height);

  return applyWatermarkMasks(
    imageAInput,
    imageBInput,
    {
      maskA,
      maskB
    },
    resolvedOptions
  );
}

export async function removeWatermark(
  imageAInput: WatermarkImageInput,
  imageBInput: WatermarkImageInput,
  options: WatermarkRemovalOptions = {}
): Promise<WatermarkRemovalCanvasResult> {
  const result = await removeWatermarkDetailed(imageAInput, imageBInput, options);
  return {
    imageA: result.imageA,
    imageB: result.imageB,
    coverageA: result.coverageA,
    coverageB: result.coverageB
  };
}

export async function buildWatermarkReferenceAnalysis(
  pairs: WatermarkReferencePair[],
  options: WatermarkRemovalOptions = {}
): Promise<WatermarkReferenceAnalysisResult> {
  if (pairs.length === 0) {
    return {
      width: 0,
      height: 0,
      sampleCount: 0,
      heatmap: null,
      templateA: null,
      templateB: null
    };
  }

  let width = 0;
  let height = 0;
  let usedSamples = 0;
  let valuesA: number[] | null = null;
  let valuesB: number[] | null = null;
  const templatesA: Array<WatermarkTemplate | null> = [];
  const templatesB: Array<WatermarkTemplate | null> = [];

  for (const pair of pairs) {
    const result = await removeWatermarkDetailed(pair.imageA, pair.imageB, {
      ...options,
      preset: null,
      customMaskA: undefined,
      customMaskB: undefined
    });

    if (usedSamples === 0) {
      width = result.width;
      height = result.height;
      valuesA = new Array(width * height).fill(0);
      valuesB = new Array(width * height).fill(0);
    }

    if (result.width !== width || result.height !== height || !valuesA || !valuesB) {
      continue;
    }

    for (let index = 0; index < result.maskA.length; index += 1) {
      valuesA[index] += result.maskA[index] > 0 ? 1 : 0;
      valuesB[index] += result.maskB[index] > 0 ? 1 : 0;
    }

    templatesA.push(result.templateA);
    templatesB.push(result.templateB);
    usedSamples += 1;
  }

  if (usedSamples === 0 || !valuesA || !valuesB) {
    return {
      width: 0,
      height: 0,
      sampleCount: 0,
      heatmap: null,
      templateA: null,
      templateB: null
    };
  }

  return {
    width,
    height,
    sampleCount: usedSamples,
    heatmap: {
      width,
      height,
      valuesA: valuesA.map((value) => value / usedSamples),
      valuesB: valuesB.map((value) => value / usedSamples),
      sampleCount: usedSamples
    },
    templateA: mergeTemplates(templatesA),
    templateB: mergeTemplates(templatesB)
  };
}

export const createWatermarkPresetFromDetailedResult = (
  name: string,
  result: Pick<
    WatermarkRemovalDetailedResult,
    'width' | 'height' | 'maskA' | 'maskB' | 'templateA' | 'templateB'
  >,
  options: WatermarkRemovalOptions = {}
): WatermarkPreset => {
  const resolvedOptions = resolveOptions(options);
  const now = Date.now();

  return {
    id: `watermark-preset-${now}`,
    name: name.trim() || `Preset ${new Date(now).toLocaleString()}`,
    threshold: resolvedOptions.threshold,
    maskExpansion: resolvedOptions.maskExpansion,
    maxWatermarkCoverage: resolvedOptions.maxWatermarkCoverage,
    templateA: result.templateA,
    templateB: result.templateB,
    heatmap: createWatermarkHeatmapFromMasks(result.maskA, result.maskB, result.width, result.height),
    createdAt: now,
    updatedAt: now
  };
};

export const createWatermarkPresetFromReferenceAnalysis = (
  name: string,
  analysis: WatermarkReferenceAnalysisResult,
  options: WatermarkRemovalOptions = {}
): WatermarkPreset => {
  const resolvedOptions = resolveOptions(options);
  const now = Date.now();

  return {
    id: `watermark-preset-${now}`,
    name: name.trim() || `Preset ${new Date(now).toLocaleString()}`,
    threshold: resolvedOptions.threshold,
    maskExpansion: resolvedOptions.maskExpansion,
    maxWatermarkCoverage: resolvedOptions.maxWatermarkCoverage,
    templateA: analysis.templateA,
    templateB: analysis.templateB,
    heatmap: analysis.heatmap,
    createdAt: now,
    updatedAt: now
  };
};

export async function removeWatermarkDataUrl(
  imageAInput: WatermarkImageInput,
  imageBInput: WatermarkImageInput,
  options: WatermarkRemovalOptions = {}
): Promise<WatermarkRemovalResult> {
  const resolvedOptions = resolveOptions(options);
  const result = await removeWatermarkDetailed(imageAInput, imageBInput, resolvedOptions);

  return {
    imageAData: await canvasToDataUrl(result.imageA, 'image/png'),
    imageBData: await canvasToDataUrl(result.imageB, 'image/png'),
    processedAt: Date.now(),
    threshold: resolvedOptions.threshold,
    coverageA: result.coverageA,
    coverageB: result.coverageB
  };
}

export async function exportProcessedImage(
  imageDataUrl: string,
  format: 'png' | 'jpeg' | 'webp',
  jpegQuality: number = 0.92
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';

    image.onload = () => {
      try {
        const canvas = createRuntimeCanvas(image.naturalWidth, image.naturalHeight) as unknown as HTMLCanvasElement;
        const context = getRuntimeCanvasContext(canvas);

        context.drawImage(image, 0, 0);
        canvasToBlob(canvas, `image/${format}`, format === 'jpeg' ? jpegQuality : undefined)
          .then(resolve)
          .catch(reject);
      } catch (error) {
        reject(error);
      }
    };

    image.onerror = () => reject(new Error('Failed to load image for export'));
    image.src = imageDataUrl;
  });
}
