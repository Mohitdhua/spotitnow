import { buildDefaultCustomVideoLayout } from './videoLayoutCustom';
import type { VideoSettings } from '../types';

export type SuperExportThumbnailStylePresetId =
  | 'inherit'
  | 'gameshow_bold'
  | 'creator_panel'
  | 'arcade_flash'
  | 'editorial_clean'
  | 'storybook_banner';

export interface SuperExportThumbnailStylePreset {
  id: SuperExportThumbnailStylePresetId;
  label: string;
  description: string;
}

export const SUPER_EXPORT_THUMBNAIL_STYLE_PRESETS: SuperExportThumbnailStylePreset[] = [
  {
    id: 'inherit',
    label: 'Inherit Video',
    description: 'Use the same package, layout, and styling as the Super Export video.'
  },
  {
    id: 'gameshow_bold',
    label: 'Gameshow Bold',
    description: 'Big centered game-show title with louder classic thumbnail energy.'
  },
  {
    id: 'creator_panel',
    label: 'Creator Panel',
    description: 'Cleaner creator-style panel title with a calmer social-friendly layout.'
  },
  {
    id: 'arcade_flash',
    label: 'Arcade Flash',
    description: 'Retro arcade styling with brighter contrast and punchier HUD framing.'
  },
  {
    id: 'editorial_clean',
    label: 'Editorial Clean',
    description: 'Polished text-first layout with restrained colors and cleaner typography.'
  },
  {
    id: 'storybook_banner',
    label: 'Storybook Banner',
    description: 'Warm illustrated frame with softer serif text and ribbon treatment.'
  }
];

export const SUPER_EXPORT_THUMBNAIL_STYLE_PRESET_IDS = SUPER_EXPORT_THUMBNAIL_STYLE_PRESETS.map(
  (preset) => preset.id
);

const PRESET_OVERRIDES: Record<
  Exclude<SuperExportThumbnailStylePresetId, 'inherit'>,
  Pick<VideoSettings, 'videoPackagePreset' | 'visualStyle' | 'textStyle' | 'headerStyle'>
> = {
  gameshow_bold: {
    videoPackagePreset: 'gameshow',
    visualStyle: 'classic',
    textStyle: 'poster',
    headerStyle: 'package'
  },
  creator_panel: {
    videoPackagePreset: 'shorts_clean',
    visualStyle: 'oceanic',
    textStyle: 'rounded',
    headerStyle: 'panel'
  },
  arcade_flash: {
    videoPackagePreset: 'arcade',
    visualStyle: 'arcade',
    textStyle: 'mono',
    headerStyle: 'split'
  },
  editorial_clean: {
    videoPackagePreset: 'editorial',
    visualStyle: 'ivory',
    textStyle: 'editorial',
    headerStyle: 'underline'
  },
  storybook_banner: {
    videoPackagePreset: 'storybook_plus',
    visualStyle: 'storybook',
    textStyle: 'storybook',
    headerStyle: 'ribbon'
  }
};

export const applySuperExportThumbnailStylePreset = (
  settings: VideoSettings,
  presetId: SuperExportThumbnailStylePresetId
): VideoSettings => {
  if (presetId === 'inherit') {
    return settings;
  }

  const override = PRESET_OVERRIDES[presetId];
  return {
    ...settings,
    ...override,
    useCustomLayout: false,
    customLayout: buildDefaultCustomVideoLayout(override.videoPackagePreset, settings.aspectRatio)
  };
};
