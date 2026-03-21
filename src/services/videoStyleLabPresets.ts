import { buildDefaultCustomVideoLayout } from '../constants/videoLayoutCustom';
import type { CustomVideoLayout, VideoSettings } from '../types';

export interface VideoStyleLabPresetSettings {
  videoPackagePreset: VideoSettings['videoPackagePreset'];
  visualStyle: VideoSettings['visualStyle'];
  textStyle: VideoSettings['textStyle'];
  headerStyle: VideoSettings['headerStyle'];
  timerStyle: VideoSettings['timerStyle'];
  progressStyle: VideoSettings['progressStyle'];
  progressMotion?: VideoSettings['progressMotion'];
  introCardStyle: VideoSettings['introCardStyle'];
  transitionCardStyle: VideoSettings['transitionCardStyle'];
  outroCardStyle: VideoSettings['outroCardStyle'];
  transitionStyle: VideoSettings['transitionStyle'];
  sceneSettings: VideoSettings['sceneSettings'];
  textTemplates: VideoSettings['textTemplates'];
  generatedBackgroundsEnabled: boolean;
  generatedBackgroundCoverage?: VideoSettings['generatedBackgroundCoverage'];
  generatedBackgroundPackId: string;
  generatedBackgroundShuffleSeed: number;
  imagePanelOutlineColor: string;
  imagePanelOutlineThickness: number;
  useCustomLayout: boolean;
  customLayout: CustomVideoLayout | null;
}

export interface VideoStyleLabPreset {
  id: string;
  name: string;
  settings: VideoStyleLabPresetSettings;
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = 'spotitnow.video-style-lab-presets';

const TEXT_TEMPLATE_KEYS: Array<keyof VideoSettings['textTemplates']> = [
  'introEyebrow',
  'introTitle',
  'introSubtitle',
  'playTitle',
  'playSubtitle',
  'progressLabel',
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

const isSceneSettings = (value: unknown): value is VideoSettings['sceneSettings'] => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as VideoSettings['sceneSettings'];
  return (
    typeof candidate.introEnabled === 'boolean' &&
    isFiniteNumber(candidate.introDuration) &&
    typeof candidate.outroEnabled === 'boolean' &&
    isFiniteNumber(candidate.outroDuration)
  );
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

const isStyleLabPresetSettings = (value: unknown): value is VideoStyleLabPresetSettings => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as VideoStyleLabPresetSettings;
  return (
    typeof candidate.videoPackagePreset === 'string' &&
    typeof candidate.visualStyle === 'string' &&
    typeof candidate.textStyle === 'string' &&
    typeof candidate.headerStyle === 'string' &&
    typeof candidate.timerStyle === 'string' &&
    typeof candidate.progressStyle === 'string' &&
    (candidate.progressMotion === undefined || typeof candidate.progressMotion === 'string') &&
    typeof candidate.introCardStyle === 'string' &&
    typeof candidate.transitionCardStyle === 'string' &&
    typeof candidate.outroCardStyle === 'string' &&
    typeof candidate.transitionStyle === 'string' &&
    isSceneSettings(candidate.sceneSettings) &&
    isTextTemplateMap(candidate.textTemplates) &&
    typeof candidate.generatedBackgroundsEnabled === 'boolean' &&
    (candidate.generatedBackgroundCoverage === undefined ||
      candidate.generatedBackgroundCoverage === 'game_area' ||
      candidate.generatedBackgroundCoverage === 'full_board') &&
    typeof candidate.generatedBackgroundPackId === 'string' &&
    isFiniteNumber(candidate.generatedBackgroundShuffleSeed) &&
    (candidate.imagePanelOutlineColor === undefined || typeof candidate.imagePanelOutlineColor === 'string') &&
    (candidate.imagePanelOutlineThickness === undefined || isFiniteNumber(candidate.imagePanelOutlineThickness)) &&
    typeof candidate.useCustomLayout === 'boolean' &&
    (candidate.customLayout === null || isCustomLayout(candidate.customLayout))
  );
};

const isStyleLabPreset = (value: unknown): value is VideoStyleLabPreset => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const preset = value as VideoStyleLabPreset;
  return (
    typeof preset.id === 'string' &&
    typeof preset.name === 'string' &&
    isStyleLabPresetSettings(preset.settings) &&
    isFiniteNumber(preset.createdAt) &&
    isFiniteNumber(preset.updatedAt)
  );
};

const readRawPresets = (): VideoStyleLabPreset[] => {
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

    return parsed.filter(isStyleLabPreset);
  } catch {
    return [];
  }
};

const writeRawPresets = (presets: VideoStyleLabPreset[]) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
};

export const loadVideoStyleLabPresets = (): VideoStyleLabPreset[] => readRawPresets();

export const replaceVideoStyleLabPresets = (presets: unknown): VideoStyleLabPreset[] => {
  const safePresets = Array.isArray(presets) ? presets.filter(isStyleLabPreset) : [];
  writeRawPresets(safePresets);
  return safePresets;
};

export const saveVideoStyleLabPreset = (preset: VideoStyleLabPreset): VideoStyleLabPreset[] => {
  const existing = readRawPresets();
  const next = existing.filter((entry) => entry.id !== preset.id);
  next.unshift({
    ...preset,
    updatedAt: Date.now()
  });
  writeRawPresets(next);
  return next;
};

export const deleteVideoStyleLabPreset = (presetId: string): VideoStyleLabPreset[] => {
  const next = readRawPresets().filter((entry) => entry.id !== presetId);
  writeRawPresets(next);
  return next;
};

export const applyVideoStyleLabPresetToSettings = (
  settings: VideoSettings,
  preset: VideoStyleLabPreset
): VideoSettings => ({
  ...settings,
  videoPackagePreset: preset.settings.videoPackagePreset,
  visualStyle: preset.settings.visualStyle,
  textStyle: preset.settings.textStyle,
  headerStyle: preset.settings.headerStyle,
  timerStyle: preset.settings.timerStyle,
  progressStyle: preset.settings.progressStyle,
  progressMotion: preset.settings.progressMotion ?? settings.progressMotion,
  introCardStyle: preset.settings.introCardStyle,
  transitionCardStyle: preset.settings.transitionCardStyle,
  outroCardStyle: preset.settings.outroCardStyle,
  transitionStyle: preset.settings.transitionStyle,
  sceneSettings: {
    ...preset.settings.sceneSettings
  },
  textTemplates: {
    ...preset.settings.textTemplates
  },
  generatedBackgroundsEnabled: preset.settings.generatedBackgroundsEnabled,
  generatedBackgroundCoverage: preset.settings.generatedBackgroundCoverage ?? settings.generatedBackgroundCoverage,
  generatedBackgroundPackId: preset.settings.generatedBackgroundPackId,
  generatedBackgroundShuffleSeed: preset.settings.generatedBackgroundShuffleSeed,
  imagePanelOutlineColor:
    typeof preset.settings.imagePanelOutlineColor === 'string'
      ? preset.settings.imagePanelOutlineColor
      : settings.imagePanelOutlineColor,
  imagePanelOutlineThickness:
    typeof preset.settings.imagePanelOutlineThickness === 'number'
      ? preset.settings.imagePanelOutlineThickness
      : settings.imagePanelOutlineThickness,
  useCustomLayout: preset.settings.useCustomLayout,
  customLayout:
    preset.settings.useCustomLayout && preset.settings.customLayout
      ? { ...preset.settings.customLayout }
      : buildDefaultCustomVideoLayout(preset.settings.videoPackagePreset, settings.aspectRatio)
});
