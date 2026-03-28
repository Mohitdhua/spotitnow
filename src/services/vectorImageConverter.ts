import ImageTracer, { type ImageTracerOptions, type ImageTracerPaletteColor } from 'imagetracerjs';
import { canvasToBlob } from './canvasRuntime';

export type VectorTracePreset =
  | 'edge_clean_preserve'
  | 'exact_preserve'
  | 'cartoon_clean'
  | 'cartoon'
  | 'poster'
  | 'logo'
  | 'detailed';

export interface VectorTraceOptions {
  preset: VectorTracePreset;
  numberOfColors: number;
  detail: number;
  smoothing: number;
  cleanup: number;
  strokeWidth: number;
  traceResolution: number;
}

export interface VectorTraceResult {
  svg: string;
  sourceWidth: number;
  sourceHeight: number;
  tracedWidth: number;
  tracedHeight: number;
  svgSizeBytes: number;
}

interface PreprocessedTraceImage {
  imageData: ImageData;
  palette: PaletteColor[];
  colorMap: Uint16Array;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const buildRasterPreserveSvg = (src: string, width: number, height: number) =>
  `<svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><image href="${src}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" image-rendering="optimizeQuality" /></svg>`;

const createCanvas = (width: number, height: number) => {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
};

const get2dContext = (canvas: HTMLCanvasElement) => {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Failed to create a 2D canvas context.');
  }
  return ctx;
};

const canvasToDataUrl = (canvas: HTMLCanvasElement, type: 'image/png' | 'image/jpeg' = 'image/png') =>
  canvas.toDataURL(type);

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load image.'));
    image.src = src;
  });

const fitWithin = (width: number, height: number, maxDimension: number) => {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  const safeMaxDimension = Math.max(256, Math.round(maxDimension));

  const largestSide = Math.max(safeWidth, safeHeight);
  if (largestSide <= safeMaxDimension) {
    return {
      width: safeWidth,
      height: safeHeight
    };
  }

  const scale = safeMaxDimension / largestSide;
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale))
  };
};

const createCanvasFromImageData = (imageData: ImageData) => {
  const canvas = createCanvas(imageData.width, imageData.height);
  const ctx = get2dContext(canvas);
  ctx.putImageData(imageData, 0, 0);
  return canvas;
};

type PaletteColor = {
  r: number;
  g: number;
  b: number;
  count: number;
};

const COLOR_BUCKET_SHIFT = 3;
const COLOR_BUCKET_LEVELS = 1 << (8 - COLOR_BUCKET_SHIFT);
const COLOR_BUCKET_COUNT = COLOR_BUCKET_LEVELS * COLOR_BUCKET_LEVELS * COLOR_BUCKET_LEVELS;

const getColorBucketKey = (r: number, g: number, b: number) =>
  ((r >> COLOR_BUCKET_SHIFT) << 10) | ((g >> COLOR_BUCKET_SHIFT) << 5) | (b >> COLOR_BUCKET_SHIFT);

const getColorDistanceSq = (
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number
) => {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return dr * dr + dg * dg + db * db;
};

const buildPaletteHistogram = (imageData: ImageData, sampleStride: number): PaletteColor[] => {
  const counts = new Uint32Array(COLOR_BUCKET_COUNT);
  const sumR = new Uint32Array(COLOR_BUCKET_COUNT);
  const sumG = new Uint32Array(COLOR_BUCKET_COUNT);
  const sumB = new Uint32Array(COLOR_BUCKET_COUNT);
  const { data, width, height } = imageData;

  for (let y = 0; y < height; y += sampleStride) {
    for (let x = 0; x < width; x += sampleStride) {
      const pixelIndex = (y * width + x) * 4;
      if (data[pixelIndex + 3] < 16) {
        continue;
      }
      const r = data[pixelIndex];
      const g = data[pixelIndex + 1];
      const b = data[pixelIndex + 2];
      const key = getColorBucketKey(r, g, b);
      counts[key] += 1;
      sumR[key] += r;
      sumG[key] += g;
      sumB[key] += b;
    }
  }

  const histogram: PaletteColor[] = [];
  for (let index = 0; index < COLOR_BUCKET_COUNT; index += 1) {
    const count = counts[index];
    if (count === 0) continue;
    histogram.push({
      r: Math.round(sumR[index] / count),
      g: Math.round(sumG[index] / count),
      b: Math.round(sumB[index] / count),
      count
    });
  }

  histogram.sort((left, right) => right.count - left.count);
  return histogram;
};

const buildTracePalette = (imageData: ImageData, desiredColorCount: number): PaletteColor[] => {
  const pixelCount = imageData.width * imageData.height;
  const sampleStride = Math.max(1, Math.floor(Math.sqrt(pixelCount / 24000)));
  const histogram = buildPaletteHistogram(imageData, sampleStride);
  if (histogram.length === 0) {
    return [{ r: 255, g: 255, b: 255, count: 1 }];
  }

  const paletteSize = Math.min(Math.max(2, Math.round(desiredColorCount)), histogram.length);
  if (histogram.length <= paletteSize) {
    return histogram.slice(0, paletteSize);
  }

  const centroids: PaletteColor[] = [{ ...histogram[0] }];
  while (centroids.length < paletteSize) {
    let bestPoint = histogram[centroids.length % histogram.length];
    let bestScore = -1;
    for (const point of histogram) {
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (const centroid of centroids) {
        nearestDistance = Math.min(
          nearestDistance,
          getColorDistanceSq(point.r, point.g, point.b, centroid.r, centroid.g, centroid.b)
        );
      }
      const score = nearestDistance * Math.sqrt(point.count);
      if (score > bestScore) {
        bestScore = score;
        bestPoint = point;
      }
    }
    centroids.push({ ...bestPoint });
  }

  for (let iteration = 0; iteration < 6; iteration += 1) {
    const sumR = new Float64Array(centroids.length);
    const sumG = new Float64Array(centroids.length);
    const sumB = new Float64Array(centroids.length);
    const sumWeight = new Float64Array(centroids.length);

    for (const point of histogram) {
      let bestIndex = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let centroidIndex = 0; centroidIndex < centroids.length; centroidIndex += 1) {
        const centroid = centroids[centroidIndex];
        const distance = getColorDistanceSq(point.r, point.g, point.b, centroid.r, centroid.g, centroid.b);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = centroidIndex;
        }
      }

      const weight = point.count;
      sumR[bestIndex] += point.r * weight;
      sumG[bestIndex] += point.g * weight;
      sumB[bestIndex] += point.b * weight;
      sumWeight[bestIndex] += weight;
    }

    for (let centroidIndex = 0; centroidIndex < centroids.length; centroidIndex += 1) {
      const weight = sumWeight[centroidIndex];
      if (weight <= 0) continue;
      centroids[centroidIndex] = {
        r: Math.round(sumR[centroidIndex] / weight),
        g: Math.round(sumG[centroidIndex] / weight),
        b: Math.round(sumB[centroidIndex] / weight),
        count: Math.round(weight)
      };
    }
  }

  return centroids;
};

const findNearestPaletteIndex = (r: number, g: number, b: number, palette: PaletteColor[]) => {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < palette.length; index += 1) {
    const color = palette[index];
    const distance = getColorDistanceSq(r, g, b, color.r, color.g, color.b);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
};

const snapImageToPalette = (imageData: ImageData, palette: PaletteColor[]) => {
  const pixelCount = imageData.width * imageData.height;
  const colorMap = new Uint16Array(pixelCount);
  const cache = new Int16Array(COLOR_BUCKET_COUNT);
  cache.fill(-1);
  const { data } = imageData;

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const dataIndex = pixelIndex * 4;
    const alpha = data[dataIndex + 3];
    if (alpha < 16) {
      colorMap[pixelIndex] = 0;
      continue;
    }
    const r = data[dataIndex];
    const g = data[dataIndex + 1];
    const b = data[dataIndex + 2];
    const cacheKey = getColorBucketKey(r, g, b);
    let paletteIndex = cache[cacheKey];
    if (paletteIndex === -1) {
      paletteIndex = findNearestPaletteIndex(r, g, b, palette);
      cache[cacheKey] = paletteIndex;
    }
    colorMap[pixelIndex] = paletteIndex;
  }

  return colorMap;
};

const smoothColorMap = (
  sourceMap: Uint16Array,
  width: number,
  height: number,
  palette: PaletteColor[],
  mergeDistanceThreshold: number,
  passes: number
) => {
  if (passes <= 0 || width < 3 || height < 3) {
    return sourceMap;
  }

  let current = sourceMap;
  let next = new Uint16Array(sourceMap);
  const mergeDistanceThresholdSq = mergeDistanceThreshold * mergeDistanceThreshold;

  for (let pass = 0; pass < passes; pass += 1) {
    next.set(current);
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const index = y * width + x;
        const currentColorIndex = current[index];
        const seenColors: number[] = [];
        const seenCounts: number[] = [];

        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            const neighborColorIndex = current[(y + offsetY) * width + (x + offsetX)];
            const seenIndex = seenColors.indexOf(neighborColorIndex);
            if (seenIndex >= 0) {
              seenCounts[seenIndex] += 1;
            } else {
              seenColors.push(neighborColorIndex);
              seenCounts.push(1);
            }
          }
        }

        let dominantColorIndex = currentColorIndex;
        let dominantCount = 0;
        let currentCount = 0;
        for (let seenIndex = 0; seenIndex < seenColors.length; seenIndex += 1) {
          const colorIndex = seenColors[seenIndex];
          const count = seenCounts[seenIndex];
          if (colorIndex === currentColorIndex) {
            currentCount = count;
          }
          if (count > dominantCount) {
            dominantColorIndex = colorIndex;
            dominantCount = count;
          }
        }

        if (dominantColorIndex === currentColorIndex || dominantCount < 5 || currentCount > 2) {
          continue;
        }

        const currentColor = palette[currentColorIndex];
        const dominantColor = palette[dominantColorIndex];
        if (
          getColorDistanceSq(
            currentColor.r,
            currentColor.g,
            currentColor.b,
            dominantColor.r,
            dominantColor.g,
            dominantColor.b
          ) <= mergeDistanceThresholdSq
        ) {
          next[index] = dominantColorIndex;
        }
      }
    }

    const previous = current;
    current = next;
    next = previous;
  }

  return current;
};

const removeTinyColorIslands = (
  colorMap: Uint16Array,
  width: number,
  height: number,
  palette: PaletteColor[],
  minIslandSize: number
) => {
  if (minIslandSize <= 1) {
    return colorMap;
  }

  const visited = new Uint8Array(colorMap.length);
  const queue: number[] = [];

  for (let startIndex = 0; startIndex < colorMap.length; startIndex += 1) {
    if (visited[startIndex]) continue;

    const startColorIndex = colorMap[startIndex];
    let queueCursor = 0;
    let componentSize = 0;
    let componentPixels: number[] = [startIndex];
    const borderCounts = new Map<number, number>();
    queue.length = 0;
    queue.push(startIndex);
    visited[startIndex] = 1;

    while (queueCursor < queue.length) {
      const currentIndex = queue[queueCursor++];
      componentSize += 1;
      if (componentSize === minIslandSize + 1) {
        componentPixels = [];
      }

      const x = currentIndex % width;
      const y = Math.floor(currentIndex / width);

      if (x > 0) {
        const neighborIndex = currentIndex - 1;
        const neighborColorIndex = colorMap[neighborIndex];
        if (neighborColorIndex === startColorIndex) {
          if (!visited[neighborIndex]) {
            visited[neighborIndex] = 1;
            queue.push(neighborIndex);
            if (componentSize <= minIslandSize) {
              componentPixels.push(neighborIndex);
            }
          }
        } else {
          borderCounts.set(neighborColorIndex, (borderCounts.get(neighborColorIndex) ?? 0) + 1);
        }
      }
      if (x + 1 < width) {
        const neighborIndex = currentIndex + 1;
        const neighborColorIndex = colorMap[neighborIndex];
        if (neighborColorIndex === startColorIndex) {
          if (!visited[neighborIndex]) {
            visited[neighborIndex] = 1;
            queue.push(neighborIndex);
            if (componentSize <= minIslandSize) {
              componentPixels.push(neighborIndex);
            }
          }
        } else {
          borderCounts.set(neighborColorIndex, (borderCounts.get(neighborColorIndex) ?? 0) + 1);
        }
      }
      if (y > 0) {
        const neighborIndex = currentIndex - width;
        const neighborColorIndex = colorMap[neighborIndex];
        if (neighborColorIndex === startColorIndex) {
          if (!visited[neighborIndex]) {
            visited[neighborIndex] = 1;
            queue.push(neighborIndex);
            if (componentSize <= minIslandSize) {
              componentPixels.push(neighborIndex);
            }
          }
        } else {
          borderCounts.set(neighborColorIndex, (borderCounts.get(neighborColorIndex) ?? 0) + 1);
        }
      }
      if (y + 1 < height) {
        const neighborIndex = currentIndex + width;
        const neighborColorIndex = colorMap[neighborIndex];
        if (neighborColorIndex === startColorIndex) {
          if (!visited[neighborIndex]) {
            visited[neighborIndex] = 1;
            queue.push(neighborIndex);
            if (componentSize <= minIslandSize) {
              componentPixels.push(neighborIndex);
            }
          }
        } else {
          borderCounts.set(neighborColorIndex, (borderCounts.get(neighborColorIndex) ?? 0) + 1);
        }
      }
    }

    if (componentSize > minIslandSize || componentPixels.length === 0 || borderCounts.size === 0) {
      continue;
    }

    let replacementColorIndex = startColorIndex;
    let replacementBorderCount = -1;
    let replacementDistance = Number.POSITIVE_INFINITY;
    const startColor = palette[startColorIndex];

    for (const [candidateColorIndex, borderCount] of borderCounts.entries()) {
      const candidateColor = palette[candidateColorIndex];
      const distance = getColorDistanceSq(
        startColor.r,
        startColor.g,
        startColor.b,
        candidateColor.r,
        candidateColor.g,
        candidateColor.b
      );
      if (
        borderCount > replacementBorderCount ||
        (borderCount === replacementBorderCount && distance < replacementDistance)
      ) {
        replacementColorIndex = candidateColorIndex;
        replacementBorderCount = borderCount;
        replacementDistance = distance;
      }
    }

    if (replacementColorIndex !== startColorIndex) {
      for (const pixelIndex of componentPixels) {
        colorMap[pixelIndex] = replacementColorIndex;
      }
    }
  }

  return colorMap;
};

const rebuildImageDataFromPalette = (
  colorMap: Uint16Array,
  width: number,
  height: number,
  palette: PaletteColor[],
  sourceData: Uint8ClampedArray
) => {
  const nextData = new Uint8ClampedArray(sourceData.length);
  for (let pixelIndex = 0; pixelIndex < colorMap.length; pixelIndex += 1) {
    const dataIndex = pixelIndex * 4;
    if (sourceData[dataIndex + 3] < 16) {
      nextData[dataIndex] = sourceData[dataIndex];
      nextData[dataIndex + 1] = sourceData[dataIndex + 1];
      nextData[dataIndex + 2] = sourceData[dataIndex + 2];
      nextData[dataIndex + 3] = sourceData[dataIndex + 3];
      continue;
    }
    const color = palette[colorMap[pixelIndex]];
    nextData[dataIndex] = color.r;
    nextData[dataIndex + 1] = color.g;
    nextData[dataIndex + 2] = color.b;
    nextData[dataIndex + 3] = 255;
  }
  return new ImageData(nextData, width, height);
};

const preprocessImageForTracing = (imageData: ImageData, options: VectorTraceOptions): PreprocessedTraceImage => {
  const palette = buildTracePalette(imageData, options.numberOfColors);
  const snappedColorMap = snapImageToPalette(imageData, palette);
  const detailScale = clamp(options.detail / 100, 0.2, 1);
  const cleanupScale = clamp(options.traceResolution / 2048, 0.85, 2);
  const mergeDistanceThreshold =
    options.preset === 'logo'
      ? 32
      : options.preset === 'poster'
        ? 42
        : options.preset === 'detailed'
          ? 46
          : 52;
  const smoothedColorMap = smoothColorMap(
    snappedColorMap,
    imageData.width,
    imageData.height,
    palette,
    mergeDistanceThreshold,
    options.preset === 'poster' || options.cleanup >= 8 ? 2 : 1
  );
  const minIslandSize = Math.max(
    options.preset === 'logo' ? 4 : 6,
    Math.round(((options.cleanup + 1) * (options.cleanup + 2)) / detailScale * cleanupScale)
  );
  const cleanedColorMap = removeTinyColorIslands(
    smoothedColorMap,
    imageData.width,
    imageData.height,
    palette,
    minIslandSize
  );
  return {
    imageData: rebuildImageDataFromPalette(
      cleanedColorMap,
      imageData.width,
      imageData.height,
      palette,
      imageData.data
    ),
    palette,
    colorMap: cleanedColorMap
  };
};

const hasTransparentPixels = (imageData: ImageData) => {
  const { data } = imageData;
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] < 250) {
      return true;
    }
  }
  return false;
};

const buildImageTracerPalette = (
  palette: PaletteColor[],
  includeTransparentBackground = false
): ImageTracerPaletteColor[] => {
  const mapped = palette.map((color) => ({
    r: color.r,
    g: color.g,
    b: color.b,
    a: 255
  }));

  return includeTransparentBackground
    ? [{ r: 255, g: 255, b: 255, a: 0 }, ...mapped]
    : mapped;
};

const buildDarkLineMask = (sourceImageData: ImageData) => {
  const blurredCanvas = blurMaskCanvas(sourceImageData, 0.9);
  const blurredData = get2dContext(blurredCanvas).getImageData(0, 0, sourceImageData.width, sourceImageData.height);
  const mask = new Uint8ClampedArray(sourceImageData.data.length);

  for (let index = 0; index < sourceImageData.data.length; index += 4) {
    const r = sourceImageData.data[index];
    const g = sourceImageData.data[index + 1];
    const b = sourceImageData.data[index + 2];
    const a = sourceImageData.data[index + 3];
    const blurR = blurredData.data[index];
    const blurG = blurredData.data[index + 1];
    const blurB = blurredData.data[index + 2];
    const luma = r * 0.299 + g * 0.587 + b * 0.114;
    const blurLuma = blurR * 0.299 + blurG * 0.587 + blurB * 0.114;
    const lumaDelta = Math.abs(luma - blurLuma);
    const edgeWeight = clamp((lumaDelta - 3) / 16, 0, 1);
    const maxChannel = Math.max(r, g, b);
    const minChannel = Math.min(r, g, b);
    const saturation = (maxChannel - minChannel) / 255;
    const inkTone = clamp((152 - luma) / 152, 0, 1);
    const darkBias = clamp((blurLuma - luma + 8) / 30, 0, 1);
    const darkBase = edgeWeight * Math.max(inkTone * 0.92, darkBias) * (0.72 + saturation * 0.28);
    const darkValue =
      darkBase > 0.48 ? 1 : darkBase > 0.26 ? clamp(0.42 + darkBase * 0.9, 0, 1) : clamp(darkBase * 0.55, 0, 1);
    const darkByte = Math.round(darkValue * 255);

    mask[index] = darkByte;
    mask[index + 1] = darkByte;
    mask[index + 2] = darkByte;
    mask[index + 3] = a;
  }

  return new ImageData(mask, sourceImageData.width, sourceImageData.height);
};

const blurMaskCanvas = (mask: ImageData, radiusPx: number) => {
  const baseCanvas = createCanvasFromImageData(mask);
  if (radiusPx <= 0) {
    return baseCanvas;
  }

  const blurred = createCanvas(mask.width, mask.height);
  const ctx = get2dContext(blurred);
  ctx.filter = `blur(${radiusPx.toFixed(2)}px)`;
  ctx.drawImage(baseCanvas, 0, 0);
  ctx.filter = 'none';
  return blurred;
};

const buildEdgeCleanPreserveImageData = (
  sourceImageData: ImageData,
  options: VectorTraceOptions
) => {
  const { width, height, data: sourceData } = sourceImageData;
  const result = new Uint8ClampedArray(sourceData);
  const detailScale = clamp(options.detail / 100, 0.2, 1);
  const cleanupScale = clamp(options.cleanup / 12, 0, 1);
  const blurRadius = 0.78 + clamp(options.smoothing, 0, 4) * 0.16 + (1 - detailScale) * 0.18;
  const blurredCanvas = blurMaskCanvas(sourceImageData, blurRadius);
  const blurredData = get2dContext(blurredCanvas).getImageData(0, 0, width, height).data;
  const darkMask = buildDarkLineMask(sourceImageData);
  const softDarkMaskCanvas = blurMaskCanvas(
    darkMask,
    0.8 + clamp(options.strokeWidth, 0, 2.5) * 0.35 + clamp(options.cleanup, 0, 12) * 0.025
  );
  const darkMaskData = get2dContext(createCanvasFromImageData(darkMask)).getImageData(0, 0, width, height).data;
  const softDarkMaskData = get2dContext(softDarkMaskCanvas).getImageData(0, 0, width, height).data;
  const sharpenAmount = 0.14 + detailScale * 0.22 + cleanupScale * 0.08;
  const contrastAmount = 0.02 + detailScale * 0.03 + cleanupScale * 0.015;
  const darkPullAmount = 6 + cleanupScale * 8 + clamp(options.strokeWidth, 0, 2.5) * 2.8;
  const noiseGate = 1.8 + (1 - detailScale) * 1.1;
  const edgeRange = 12 + (1 - cleanupScale) * 4;

  for (let index = 0; index < sourceData.length; index += 4) {
    const alpha = sourceData[index + 3];
    if (alpha < 16) {
      continue;
    }

    const lineWeight = darkMaskData[index] / 255;
    const softLineWeight = softDarkMaskData[index] / 255;
    if (softLineWeight <= 0.01) {
      continue;
    }

    const sourceR = sourceData[index];
    const sourceG = sourceData[index + 1];
    const sourceB = sourceData[index + 2];
    const blurR = blurredData[index];
    const blurG = blurredData[index + 1];
    const blurB = blurredData[index + 2];
    const luma = sourceR * 0.299 + sourceG * 0.587 + sourceB * 0.114;
    const blurLuma = blurR * 0.299 + blurG * 0.587 + blurB * 0.114;
    const signalDelta = Math.max(
      Math.abs(luma - blurLuma),
      (Math.abs(sourceR - blurR) + Math.abs(sourceG - blurG) + Math.abs(sourceB - blurB)) / 3
    );
    const edgeWeight = clamp((signalDelta - noiseGate) / edgeRange, 0, 1);
    const supportWeight = Math.max(edgeWeight * (0.55 + cleanupScale * 0.15), softLineWeight * 0.78);
    if (supportWeight <= 0.02) {
      continue;
    }

    const detailWeight = supportWeight * (0.4 + edgeWeight * 0.6);
    const detailR = (sourceR - blurR) * sharpenAmount * detailWeight;
    const detailG = (sourceG - blurG) * sharpenAmount * detailWeight;
    const detailB = (sourceB - blurB) * sharpenAmount * detailWeight;
    const contrastLift = (luma - blurLuma) * contrastAmount * supportWeight;
    const darkPull =
      lineWeight * darkPullAmount +
      Math.max(0, blurLuma - luma) * lineWeight * (0.05 + cleanupScale * 0.05);

    result[index] = clamp(sourceR + detailR + contrastLift - darkPull, 0, 255);
    result[index + 1] = clamp(sourceG + detailG + contrastLift - darkPull, 0, 255);
    result[index + 2] = clamp(sourceB + detailB + contrastLift - darkPull, 0, 255);
    result[index + 3] = alpha;
  }

  return new ImageData(result, width, height);
};

const getPresetBaseOptions = (preset: VectorTracePreset): Partial<ImageTracerOptions> => {
  switch (preset) {
    case 'edge_clean_preserve':
      return {
        colorsampling: 0,
        colorquantcycles: 1,
        layering: 0,
        linefilter: false,
        rightangleenhance: false,
        roundcoords: 4,
        mincolorratio: 0
      };
    case 'exact_preserve':
      return {
        colorsampling: 0,
        colorquantcycles: 1,
        layering: 0,
        linefilter: false,
        rightangleenhance: false,
        roundcoords: 4,
        mincolorratio: 0
      };
    case 'cartoon_clean':
      return {
        colorsampling: 0,
        colorquantcycles: 1,
        layering: 0,
        linefilter: false,
        rightangleenhance: false,
        roundcoords: 4,
        mincolorratio: 0
      };
    case 'poster':
      return {
        colorsampling: 2,
        colorquantcycles: 4,
        layering: 0,
        linefilter: true,
        rightangleenhance: true,
        roundcoords: 3,
        mincolorratio: 0.0012
      };
    case 'logo':
      return {
        colorsampling: 2,
        colorquantcycles: 5,
        layering: 0,
        linefilter: false,
        rightangleenhance: true,
        roundcoords: 3,
        mincolorratio: 0.0004
      };
    case 'detailed':
      return {
        colorsampling: 2,
        colorquantcycles: 6,
        layering: 0,
        linefilter: true,
        rightangleenhance: false,
        roundcoords: 4,
        mincolorratio: 0.00025
      };
    case 'cartoon':
    default:
      return {
        colorsampling: 2,
        colorquantcycles: 5,
        layering: 0,
        linefilter: true,
        rightangleenhance: false,
        roundcoords: 3,
        mincolorratio: 0.0006
      };
  }
};

const buildTraceOptions = (options: VectorTraceOptions): ImageTracerOptions => {
  const isHighFidelityPreset =
    options.preset === 'detailed' ||
    options.preset === 'cartoon_clean' ||
    options.preset === 'exact_preserve' ||
    options.preset === 'edge_clean_preserve';
  const normalizedDetail = clamp(options.detail, 1, 100) / 100;
  const normalizedStroke = clamp(options.strokeWidth, 0, 2.5);
  const normalizedSmoothing = clamp(options.smoothing, 0, 4);
  const normalizedCleanup = clamp(options.cleanup, 0, 12);
  const resolutionScale = clamp(options.traceResolution / 2048, 0.85, 2);

  const lineThreshold = Math.max(0.05, Number((1.2 - normalizedDetail * 1.05).toFixed(3)));
  const curveThreshold = Math.max(0.05, Number((0.95 - normalizedDetail * 0.85).toFixed(3)));
  const presetOptions = getPresetBaseOptions(options.preset);
  const colorCount = clamp(options.numberOfColors, 2, 128);
  const cleanupFloor =
    options.preset === 'poster' ? 10 : options.preset === 'logo' ? 6 : isHighFidelityPreset ? 7 : 8;
  const cleanupStrength =
    options.preset === 'poster'
      ? 2.25
      : options.preset === 'logo'
        ? 1.5
        : isHighFidelityPreset
          ? 1.9
          : 2.1;
  const pathOmit = Math.max(
    options.preset === 'logo' ? 5 : 7,
    Math.round((cleanupFloor + normalizedCleanup * cleanupStrength) * resolutionScale)
  );
  const blurFloor = options.preset === 'logo' ? 0 : 1;
  const blurRadius = Math.max(blurFloor, normalizedSmoothing);
  const blurDelta =
    options.preset === 'poster'
      ? 42
      : isHighFidelityPreset
        ? 26
        : options.preset === 'logo'
          ? 18
          : 32;

  return {
    ...presetOptions,
    ltres:
      options.preset === 'logo'
        ? Math.max(0.04, Number((lineThreshold * 0.75).toFixed(3)))
        : options.preset === 'poster'
          ? Math.max(0.06, Number((lineThreshold * 0.9).toFixed(3)))
          : lineThreshold,
    qtres:
      options.preset === 'logo'
        ? Math.max(0.04, Number((curveThreshold * 0.72).toFixed(3)))
        : options.preset === 'poster'
          ? Math.max(0.05, Number((curveThreshold * 0.82).toFixed(3)))
          : curveThreshold,
    pathomit: pathOmit,
    numberofcolors: colorCount,
    blurradius: blurRadius,
    blurdelta: blurDelta,
    strokewidth: normalizedStroke,
    scale: 1,
    viewbox: true,
    desc: false,
    roundcoords: isHighFidelityPreset ? 4 : 3
  };
};

const buildCartoonCleanFillTraceOptions = (
  options: VectorTraceOptions,
  preprocessed: PreprocessedTraceImage
): ImageTracerOptions => {
  const baseOptions = buildTraceOptions({
    ...options,
    preset: 'cartoon_clean'
  });

  return {
    ...baseOptions,
    colorsampling: 0,
    colorquantcycles: 1,
    pal: buildImageTracerPalette(preprocessed.palette, hasTransparentPixels(preprocessed.imageData)),
    numberofcolors: preprocessed.palette.length + (hasTransparentPixels(preprocessed.imageData) ? 1 : 0),
    strokewidth: 0,
    linefilter: false,
    rightangleenhance: false,
    blurradius: 0,
    blurdelta: 20,
    pathomit: Math.max(10, baseOptions.pathomit ?? 10),
    roundcoords: 4
  };
};

const buildCartoonCleanOutlineMask = (
  preprocessed: PreprocessedTraceImage,
  options: VectorTraceOptions
) => {
  const { imageData, colorMap, palette } = preprocessed;
  const { width, height } = imageData;
  const boundaryMap = new Uint8Array(width * height);
  const sourceData = imageData.data;
  const contrastThresholdSq = 24 * 24;
  const outlineRadius = Math.max(1, Math.round(1 + clamp(options.strokeWidth, 0, 2.5) * 0.75));

  for (let index = 0; index < colorMap.length; index += 1) {
    const dataIndex = index * 4;
    if (sourceData[dataIndex + 3] < 16) {
      continue;
    }

    const x = index % width;
    const y = Math.floor(index / width);
    const currentColorIndex = colorMap[index];
    const currentColor = palette[currentColorIndex];
    let shouldOutline = false;

    const inspectNeighbor = (neighborIndex: number | null) => {
      if (neighborIndex === null) {
        shouldOutline = true;
        return;
      }
      const neighborDataIndex = neighborIndex * 4;
      if (sourceData[neighborDataIndex + 3] < 16) {
        shouldOutline = true;
        return;
      }
      const neighborColorIndex = colorMap[neighborIndex];
      if (neighborColorIndex === currentColorIndex) {
        return;
      }
      const neighborColor = palette[neighborColorIndex];
      if (
        getColorDistanceSq(
          currentColor.r,
          currentColor.g,
          currentColor.b,
          neighborColor.r,
          neighborColor.g,
          neighborColor.b
        ) >= contrastThresholdSq
      ) {
        shouldOutline = true;
      }
    };

    inspectNeighbor(x > 0 ? index - 1 : null);
    if (!shouldOutline) inspectNeighbor(x + 1 < width ? index + 1 : null);
    if (!shouldOutline) inspectNeighbor(y > 0 ? index - width : null);
    if (!shouldOutline) inspectNeighbor(y + 1 < height ? index + width : null);

    if (shouldOutline) {
      boundaryMap[index] = 1;
    }
  }

  const dilatedMap = new Uint8Array(boundaryMap.length);
  for (let index = 0; index < boundaryMap.length; index += 1) {
    if (!boundaryMap[index]) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    for (let offsetY = -outlineRadius; offsetY <= outlineRadius; offsetY += 1) {
      const targetY = y + offsetY;
      if (targetY < 0 || targetY >= height) continue;
      for (let offsetX = -outlineRadius; offsetX <= outlineRadius; offsetX += 1) {
        const targetX = x + offsetX;
        if (targetX < 0 || targetX >= width) continue;
        if (Math.abs(offsetX) + Math.abs(offsetY) > outlineRadius + 1) continue;
        dilatedMap[targetY * width + targetX] = 1;
      }
    }
  }

  const outlinePixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < dilatedMap.length; index += 1) {
    const pixelOffset = index * 4;
    if (!dilatedMap[index]) {
      outlinePixels[pixelOffset] = 255;
      outlinePixels[pixelOffset + 1] = 255;
      outlinePixels[pixelOffset + 2] = 255;
      outlinePixels[pixelOffset + 3] = 0;
      continue;
    }
    outlinePixels[pixelOffset] = 12;
    outlinePixels[pixelOffset + 1] = 12;
    outlinePixels[pixelOffset + 2] = 12;
    outlinePixels[pixelOffset + 3] = 255;
  }

  return new ImageData(outlinePixels, width, height);
};

const buildCartoonCleanOutlineTraceOptions = (options: VectorTraceOptions): ImageTracerOptions => {
  const normalizedDetail = clamp(options.detail, 1, 100) / 100;
  const resolutionScale = clamp(options.traceResolution / 2048, 0.85, 2);

  return {
    colorsampling: 0,
    colorquantcycles: 1,
    layering: 0,
    linefilter: false,
    rightangleenhance: false,
    ltres: Math.max(0.025, Number((0.18 - normalizedDetail * 0.11).toFixed(3))),
    qtres: Math.max(0.02, Number((0.14 - normalizedDetail * 0.09).toFixed(3))),
    pathomit: Math.max(12, Math.round((10 + options.cleanup * 2.4) * resolutionScale)),
    numberofcolors: 2,
    pal: [
      { r: 255, g: 255, b: 255, a: 0 },
      { r: 12, g: 12, b: 12, a: 255 }
    ],
    mincolorratio: 0,
    blurradius: 0,
    blurdelta: 20,
    strokewidth: 0,
    scale: 1,
    viewbox: true,
    desc: false,
    roundcoords: 4
  };
};

const pruneInvisibleSvgPaths = (svg: string) =>
  svg.replace(/<path\b[^>]*opacity="0(?:\.0+)?"[^>]*\/>/gi, '');

const unwrapSvgMarkup = (svg: string) => {
  const viewBoxMatch = svg.match(/\bviewBox="([^"]+)"/i);
  const widthMatch = svg.match(/\bwidth="([^"]+)"/i);
  const heightMatch = svg.match(/\bheight="([^"]+)"/i);
  const innerMarkup = svg.replace(/^[\s\S]*?<svg\b[^>]*>/i, '').replace(/<\/svg>\s*$/i, '');

  return {
    viewBox: viewBoxMatch?.[1] ?? '',
    width: widthMatch?.[1] ?? '',
    height: heightMatch?.[1] ?? '',
    innerMarkup
  };
};

const combineSvgLayers = (fillSvg: string, outlineSvg: string, width: number, height: number) => {
  const fillLayer = unwrapSvgMarkup(fillSvg);
  const outlineLayer = unwrapSvgMarkup(pruneInvisibleSvgPaths(outlineSvg));
  const svgWidth = fillLayer.width || String(width);
  const svgHeight = fillLayer.height || String(height);
  const viewBox = fillLayer.viewBox || `0 0 ${width} ${height}`;

  return `<svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="${viewBox}" shape-rendering="geometricPrecision"><g id="vector-fills">${fillLayer.innerMarkup}</g><g id="vector-outlines">${outlineLayer.innerMarkup}</g></svg>`;
};

const traceCartoonCleanSvg = (
  preprocessed: PreprocessedTraceImage,
  options: VectorTraceOptions
) => {
  const fillSvg = ImageTracer.imagedataToSVG(
    preprocessed.imageData,
    buildCartoonCleanFillTraceOptions(options, preprocessed)
  );
  const outlineMask = buildCartoonCleanOutlineMask(preprocessed, options);
  const outlineSvg = ImageTracer.imagedataToSVG(
    outlineMask,
    buildCartoonCleanOutlineTraceOptions(options)
  );

  return combineSvgLayers(fillSvg, outlineSvg, preprocessed.imageData.width, preprocessed.imageData.height);
};

export const readVectorFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });

export const readVectorImageDimensions = async (src: string) => {
  const image = await loadImage(src);
  return {
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height
  };
};

export const traceImageToSvg = async (
  src: string,
  options: VectorTraceOptions
): Promise<VectorTraceResult> => {
  const image = await loadImage(src);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (options.preset === 'exact_preserve') {
    const svg = buildRasterPreserveSvg(src, sourceWidth, sourceHeight);
    return {
      svg,
      sourceWidth,
      sourceHeight,
      tracedWidth: sourceWidth,
      tracedHeight: sourceHeight,
      svgSizeBytes: new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }).size
    };
  }
  if (options.preset === 'edge_clean_preserve') {
    const canvas = createCanvas(sourceWidth, sourceHeight);
    const ctx = get2dContext(canvas);
    ctx.clearRect(0, 0, sourceWidth, sourceHeight);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, sourceWidth, sourceHeight);
    const sourceImageData = ctx.getImageData(0, 0, sourceWidth, sourceHeight);
    const cleanedPreserveImage = buildEdgeCleanPreserveImageData(sourceImageData, options);
    const cleanedDataUrl = canvasToDataUrl(createCanvasFromImageData(cleanedPreserveImage));
    const svg = buildRasterPreserveSvg(cleanedDataUrl, sourceWidth, sourceHeight);

    return {
      svg,
      sourceWidth,
      sourceHeight,
      tracedWidth: sourceWidth,
      tracedHeight: sourceHeight,
      svgSizeBytes: new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }).size
    };
  }
  const fitted = fitWithin(sourceWidth, sourceHeight, options.traceResolution);
  const canvas = createCanvas(fitted.width, fitted.height);
  const ctx = get2dContext(canvas);
  ctx.clearRect(0, 0, fitted.width, fitted.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, fitted.width, fitted.height);
  const sourceImageData = ctx.getImageData(0, 0, fitted.width, fitted.height);
  const preprocessed = preprocessImageForTracing(sourceImageData, options);
  const svg =
    options.preset === 'cartoon_clean'
      ? traceCartoonCleanSvg(preprocessed, options)
      : ImageTracer.imagedataToSVG(preprocessed.imageData, buildTraceOptions(options));

  return {
    svg,
    sourceWidth,
    sourceHeight,
    tracedWidth: fitted.width,
    tracedHeight: fitted.height,
    svgSizeBytes: new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }).size
  };
};

export const svgStringToBlob = (svg: string) =>
  new Blob([svg], {
    type: 'image/svg+xml;charset=utf-8'
  });

export const svgStringToObjectUrl = (svg: string) => URL.createObjectURL(svgStringToBlob(svg));

export const rasterizeSvgString = async (
  svg: string,
  width: number,
  height: number,
  scale = 1,
  format: 'png' | 'jpeg' | 'webp' = 'png',
  quality?: number
) => {
  const objectUrl = svgStringToObjectUrl(svg);

  try {
    const image = await loadImage(objectUrl);
    const outputWidth = Math.max(1, Math.round(width * scale));
    const outputHeight = Math.max(1, Math.round(height * scale));
    if (Math.max(outputWidth, outputHeight) > 8192) {
      throw new Error('The requested PNG export is too large. Lower the export scale or use a smaller source image.');
    }

    const canvas = createCanvas(outputWidth, outputHeight);
    const ctx = get2dContext(canvas);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await canvasToBlob(canvas, `image/${format}`, format === 'jpeg' || format === 'webp' ? quality : undefined);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};
