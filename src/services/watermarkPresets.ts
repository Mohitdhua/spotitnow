/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WatermarkRegion, WatermarkSelectionPreset } from './watermarkRemoval';

const STORAGE_KEY = 'spotdiff-watermark-selection-presets';

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isValidRegion = (value: unknown): value is WatermarkRegion => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const region = value as WatermarkRegion;
  return (
    typeof region.id === 'string' &&
    isFiniteNumber(region.x) &&
    isFiniteNumber(region.y) &&
    isFiniteNumber(region.width) &&
    isFiniteNumber(region.height)
  );
};

const isValidPreset = (value: unknown): value is WatermarkSelectionPreset => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const preset = value as WatermarkSelectionPreset;
  return (
    typeof preset.id === 'string' &&
    typeof preset.name === 'string' &&
    isFiniteNumber(preset.sourceWidth) &&
    isFiniteNumber(preset.sourceHeight) &&
    isFiniteNumber(preset.createdAt) &&
    isFiniteNumber(preset.updatedAt) &&
    Array.isArray(preset.regionsA) &&
    Array.isArray(preset.regionsB) &&
    preset.regionsA.every(isValidRegion) &&
    preset.regionsB.every(isValidRegion)
  );
};

const readRawPresets = (): WatermarkSelectionPreset[] => {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return [];
    }

    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isValidPreset);
  } catch {
    return [];
  }
};

const writeRawPresets = (presets: WatermarkSelectionPreset[]): void => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
};

export const loadWatermarkPresets = (): WatermarkSelectionPreset[] => readRawPresets();

export const replaceWatermarkPresets = (
  presets: unknown
): WatermarkSelectionPreset[] => {
  const safePresets = Array.isArray(presets) ? presets.filter(isValidPreset) : [];
  writeRawPresets(safePresets);
  return safePresets;
};

export const saveWatermarkPreset = (
  preset: WatermarkSelectionPreset
): WatermarkSelectionPreset[] => {
  const existing = readRawPresets();
  const next = existing.filter((entry) => entry.id !== preset.id);
  next.unshift({
    ...preset,
    updatedAt: Date.now()
  });
  writeRawPresets(next);
  return next;
};

export const deleteWatermarkPreset = (presetId: string): WatermarkSelectionPreset[] => {
  const next = readRawPresets().filter((entry) => entry.id !== presetId);
  writeRawPresets(next);
  return next;
};
