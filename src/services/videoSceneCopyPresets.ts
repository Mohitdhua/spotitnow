import { buildDefaultCustomVideoLayout } from '../constants/videoLayoutCustom';
import type { CustomVideoLayout, VideoSettings } from '../types';

export interface VideoSceneCopyPreset {
  id: string;
  name: string;
  textTemplates: VideoSettings['textTemplates'];
  linkedPackagePreset: VideoSettings['videoPackagePreset'];
  useCustomLayout: boolean;
  customLayout: CustomVideoLayout | null;
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = 'spotitnow.video-scene-copy-presets';

const TEXT_TEMPLATE_KEYS: Array<keyof VideoSettings['textTemplates']> = [
  'introEyebrow',
  'introTitle',
  'introSubtitle',
  'playTitle',
  'playSubtitle',
  'revealTitle',
  'transitionEyebrow',
  'transitionTitle',
  'transitionSubtitle',
  'completionEyebrow',
  'completionTitle',
  'completionSubtitle',
  'puzzleBadgeLabel'
];

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isTextTemplateMap = (value: unknown): value is VideoSettings['textTemplates'] => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return TEXT_TEMPLATE_KEYS.every((key) => typeof (value as VideoSettings['textTemplates'])[key] === 'string');
};

const isCustomLayout = (value: unknown): value is CustomVideoLayout => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as CustomVideoLayout;
  return (
    isFiniteNumber(candidate.headerHeight) &&
    isFiniteNumber(candidate.contentPadding) &&
    isFiniteNumber(candidate.panelGap) &&
    isFiniteNumber(candidate.panelRadius) &&
    isFiniteNumber(candidate.gamePadding) &&
    isFiniteNumber(candidate.logoTop) &&
    isFiniteNumber(candidate.logoLeft) &&
    isFiniteNumber(candidate.logoSize) &&
    isFiniteNumber(candidate.titleTop) &&
    isFiniteNumber(candidate.titleLeft) &&
    (candidate.titleAlign === 'left' || candidate.titleAlign === 'center' || candidate.titleAlign === 'right') &&
    isFiniteNumber(candidate.titleFontSize) &&
    isFiniteNumber(candidate.subtitleSize) &&
    isFiniteNumber(candidate.subtitleGap) &&
    isFiniteNumber(candidate.timerTop) &&
    isFiniteNumber(candidate.timerLeft) &&
    isFiniteNumber(candidate.timerPadX) &&
    isFiniteNumber(candidate.timerPadY) &&
    isFiniteNumber(candidate.timerDotSize) &&
    isFiniteNumber(candidate.timerGap) &&
    isFiniteNumber(candidate.timerFontSize) &&
    isFiniteNumber(candidate.timerMinWidth) &&
    isFiniteNumber(candidate.progressTop) &&
    isFiniteNumber(candidate.progressLeft) &&
    isFiniteNumber(candidate.progressWidth) &&
    isFiniteNumber(candidate.progressHeight) &&
    isFiniteNumber(candidate.progressRadius) &&
    (candidate.progressOrientation === 'horizontal' || candidate.progressOrientation === 'vertical')
  );
};

const isSceneCopyPreset = (value: unknown): value is VideoSceneCopyPreset => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const preset = value as VideoSceneCopyPreset;
  return (
    typeof preset.id === 'string' &&
    typeof preset.name === 'string' &&
    isTextTemplateMap(preset.textTemplates) &&
    typeof preset.linkedPackagePreset === 'string' &&
    typeof preset.useCustomLayout === 'boolean' &&
    (preset.customLayout === null || isCustomLayout(preset.customLayout)) &&
    isFiniteNumber(preset.createdAt) &&
    isFiniteNumber(preset.updatedAt)
  );
};

const readRawPresets = (): VideoSceneCopyPreset[] => {
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

    return parsed.filter(isSceneCopyPreset);
  } catch {
    return [];
  }
};

const writeRawPresets = (presets: VideoSceneCopyPreset[]): void => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
};

export const loadVideoSceneCopyPresets = (): VideoSceneCopyPreset[] => readRawPresets();

export const replaceVideoSceneCopyPresets = (
  presets: unknown
): VideoSceneCopyPreset[] => {
  const safePresets = Array.isArray(presets) ? presets.filter(isSceneCopyPreset) : [];
  writeRawPresets(safePresets);
  return safePresets;
};

export const saveVideoSceneCopyPreset = (
  preset: VideoSceneCopyPreset
): VideoSceneCopyPreset[] => {
  const existing = readRawPresets();
  const next = existing.filter((entry) => entry.id !== preset.id);
  next.unshift({
    ...preset,
    updatedAt: Date.now()
  });
  writeRawPresets(next);
  return next;
};

export const deleteVideoSceneCopyPreset = (presetId: string): VideoSceneCopyPreset[] => {
  const next = readRawPresets().filter((entry) => entry.id !== presetId);
  writeRawPresets(next);
  return next;
};

export const applyVideoSceneCopyPresetToSettings = (
  settings: VideoSettings,
  preset: VideoSceneCopyPreset
): VideoSettings => {
  const linkedLayout =
    preset.useCustomLayout && preset.customLayout
      ? { ...preset.customLayout }
      : buildDefaultCustomVideoLayout(preset.linkedPackagePreset, settings.aspectRatio);

  return {
    ...settings,
    videoPackagePreset: preset.linkedPackagePreset,
    textTemplates: {
      ...preset.textTemplates
    },
    useCustomLayout: preset.useCustomLayout,
    customLayout: linkedLayout
  };
};
