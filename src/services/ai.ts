import {detectDifferencesClientSide, type DifferenceDetectionOptions} from './imageProcessing';

export interface DetectedDifference {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}

const offlineFallbackPrimary: DifferenceDetectionOptions = {
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

const offlineFallbackSensitive: DifferenceDetectionOptions = {
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

const sanitizeLocalResults = (regions: Awaited<ReturnType<typeof detectDifferencesClientSide>>['regions']) =>
  regions.filter((region) => {
    if (region.width <= 0 || region.height <= 0) return false;
    if (region.width < 0.004 || region.height < 0.004) return false;
    if (region.width > 0.95 || region.height > 0.95) return false;
    if (region.width * region.height > 0.35) return false;
    return true;
  });

const detectDifferencesOffline = async (imageA: string, imageB: string): Promise<DetectedDifference[]> => {
  const primary = await detectDifferencesClientSide(imageA, imageB, offlineFallbackPrimary);
  let regions = sanitizeLocalResults(primary.regions);

  if (regions.length === 0 || regions.length === 1) {
    const secondary = await detectDifferencesClientSide(imageA, imageB, offlineFallbackSensitive);
    const sensitiveRegions = sanitizeLocalResults(secondary.regions);
    if (sensitiveRegions.length > regions.length) {
      regions = sensitiveRegions;
    }
  }

  return regions.map((region) => ({
    ymin: region.y,
    xmin: region.x,
    ymax: region.y + region.height,
    xmax: region.x + region.width
  }));
};

export async function detectDifferences(imageA: string, imageB: string): Promise<DetectedDifference[]> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return await detectDifferencesOffline(imageA, imageB);
  }

  const base = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
  const url = `${base}/api/detect-differences`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({imageA, imageB}),
    });

    if (!response.ok) {
      return await detectDifferencesOffline(imageA, imageB);
    }

    const data = (await response.json()) as {differences?: DetectedDifference[]};
    return Array.isArray(data?.differences) ? data.differences : [];
  } catch {
    return await detectDifferencesOffline(imageA, imageB);
  }
}
