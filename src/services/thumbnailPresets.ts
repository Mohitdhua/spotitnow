export type ThumbnailLayoutPreset =
  | 'square_split'
  | 'square_stagger'
  | 'puzzle_hero'
  | 'diff_hero'
  | 'top_bottom';
export type ThumbnailThemePreset = 'arcade_burst' | 'editorial_glow' | 'story_gold' | 'midnight_alert';
export type ThumbnailHeadlineStyle = 'outline' | 'highlight' | 'glow';
export type ThumbnailTextAlign = 'left' | 'center';
export type ThumbnailLogoPosition = 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right';
export type ThumbnailArrowTarget = 'puzzle' | 'diff';
export type ThumbnailExportFormat = 'png' | 'jpeg' | 'webp';
export type ThumbnailExportSize = '1280x720' | '1920x1080';
export type ThumbnailTextTemplate =
  | 'reference_classic'
  | 'reference_midline'
  | 'reference_compact'
  | 'challenge_stack'
  | 'reveal_punch'
  | 'bottom_banner'
  | 'corner_card';
export type ThumbnailBackgroundStyle = 'soft_stage' | 'comic_burst' | 'paper_stack' | 'studio_frame';

export interface ThumbnailTransformBox {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export interface ThumbnailOverlayItem {
  id: string;
  name: string;
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
}

export interface ThumbnailCreatorSettings {
  layout: ThumbnailLayoutPreset;
  theme: ThumbnailThemePreset;
  textTemplate: ThumbnailTextTemplate;
  backgroundStyle: ThumbnailBackgroundStyle;
  eyebrow: string;
  title: string;
  subtitle: string;
  badge: string;
  headlineStyle: ThumbnailHeadlineStyle;
  titleSize: number;
  subtitleSize: number;
  textAlign: ThumbnailTextAlign;
  uppercaseTitle: boolean;
  accentColor: string;
  secondaryAccentColor: string;
  textColor: string;
  backgroundStart: string;
  backgroundEnd: string;
  panelColor: string;
  imageBrightness: number;
  imageContrast: number;
  imageSaturation: number;
  diffImageBrightness: number;
  diffImageContrast: number;
  diffImageSaturation: number;
  backgroundBlur: number;
  backgroundDim: number;
  showArrow: boolean;
  arrowTarget: ThumbnailArrowTarget;
  showBurst: boolean;
  burstText: string;
  logoEnabled: boolean;
  logoSrc: string;
  logoScale: number;
  logoPosition: ThumbnailLogoPosition;
  logoChromaKeyEnabled: boolean;
  logoChromaKeyColor: string;
  logoChromaKeyTolerance: number;
  exportFormat: ThumbnailExportFormat;
  exportQuality: number;
  exportSize: ThumbnailExportSize;
  textBox: ThumbnailTransformBox;
  puzzleCard: ThumbnailTransformBox;
  diffCard: ThumbnailTransformBox;
  overlayImages: ThumbnailOverlayItem[];
}

export interface ThumbnailPreset {
  id: string;
  name: string;
  settings: ThumbnailCreatorSettings;
  createdAt: number;
  updatedAt: number;
}

export const THUMBNAIL_EXPORT_SIZE_MAP: Record<ThumbnailExportSize, { width: number; height: number }> = {
  '1280x720': { width: 1280, height: 720 },
  '1920x1080': { width: 1920, height: 1080 }
};

export const DEFAULT_THUMBNAIL_SETTINGS: ThumbnailCreatorSettings = {
  layout: 'square_split',
  theme: 'editorial_glow',
  textTemplate: 'challenge_stack',
  backgroundStyle: 'soft_stage',
  eyebrow: 'New Puzzle',
  title: 'SPOT THE 3 DIFFERENCES',
  subtitle: 'Can you beat your friends before the reveal?',
  badge: '',
  headlineStyle: 'outline',
  titleSize: 104,
  subtitleSize: 30,
  textAlign: 'left',
  uppercaseTitle: true,
  accentColor: '#F8FAFC',
  secondaryAccentColor: '#FACC15',
  textColor: '#FFFFFF',
  backgroundStart: '#0F172A',
  backgroundEnd: '#334155',
  panelColor: '#FFFFFF',
  imageBrightness: 1,
  imageContrast: 1.08,
  imageSaturation: 1.1,
  diffImageBrightness: 1,
  diffImageContrast: 1.14,
  diffImageSaturation: 1.18,
  backgroundBlur: 12,
  backgroundDim: 0.38,
  showArrow: true,
  arrowTarget: 'diff',
  showBurst: true,
  burstText: '3 DIFFS',
  logoEnabled: false,
  logoSrc: '',
  logoScale: 1,
  logoPosition: 'top_right',
  logoChromaKeyEnabled: false,
  logoChromaKeyColor: '#00FF00',
  logoChromaKeyTolerance: 70,
  exportFormat: 'png',
  exportQuality: 92,
  exportSize: '1280x720',
  textBox: {
    x: 0.26,
    y: 0.2,
    width: 0.42,
    height: 0.28,
    rotation: 0
  },
  puzzleCard: {
    x: 0.265,
    y: 0.61,
    width: 0.37,
    height: 0.37,
    rotation: -2
  },
  diffCard: {
    x: 0.725,
    y: 0.61,
    width: 0.37,
    height: 0.37,
    rotation: 2
  },
  overlayImages: []
};

export const THUMBNAIL_LAYOUT_TEMPLATES: Record<
  ThumbnailLayoutPreset,
  {
    label: string;
    description: string;
  }
> = {
  square_split: {
    label: 'Side By Side',
    description: 'Two square cards balanced across the lower half.'
  },
  square_stagger: {
    label: 'Staggered',
    description: 'Square cards offset diagonally with a little overlap.'
  },
  puzzle_hero: {
    label: 'Puzzle Hero',
    description: 'Large puzzle square with the diff card supporting on the right.'
  },
  diff_hero: {
    label: 'Diff Hero',
    description: 'Large diff square with the puzzle card supporting on the left.'
  },
  top_bottom: {
    label: 'Top + Bottom',
    description: 'One square high, one square low for a sharper diagonal composition.'
  }
};

export const THUMBNAIL_TEXT_TEMPLATES: Record<
  ThumbnailTextTemplate,
  {
    label: string;
    description: string;
  }
> = {
  reference_classic: {
    label: 'Reference Classic',
    description: 'Closest to the sample: huge title top-left with subtitle crossing the split cards.'
  },
  reference_midline: {
    label: 'Reference Midline',
    description: 'Large title with a bold midline subtitle built for challenge copy.'
  },
  reference_compact: {
    label: 'Reference Compact',
    description: 'Same reference energy, but packed tighter for shorter titles.'
  },
  challenge_stack: {
    label: 'Challenge Stack',
    description: 'Big stacked title with a small top tag and subtitle.'
  },
  reveal_punch: {
    label: 'Reveal Punch',
    description: 'Loud title block with a tighter subtitle for reveal-style cards.'
  },
  bottom_banner: {
    label: 'Bottom Banner',
    description: 'Hero title with a banner-style subtitle strip.'
  },
  corner_card: {
    label: 'Corner Card',
    description: 'Compact card layout that fits best in one corner.'
  }
};

export const THUMBNAIL_BACKGROUND_STYLES: Record<
  ThumbnailBackgroundStyle,
  {
    label: string;
    description: string;
  }
> = {
  soft_stage: {
    label: 'Soft Stage',
    description: 'Blurred stage background with clean planted cards.'
  },
  comic_burst: {
    label: 'Comic Burst',
    description: 'Punchy rays and bright accents behind the puzzle cards.'
  },
  paper_stack: {
    label: 'Paper Stack',
    description: 'Warm paper board look with taped card treatment.'
  },
  studio_frame: {
    label: 'Studio Frame',
    description: 'Dark studio frame with strong spotlight contrast.'
  }
};

export const THUMBNAIL_THEME_PRESETS: Record<
  ThumbnailThemePreset,
  {
    label: string;
    description: string;
    patch: Partial<ThumbnailCreatorSettings>;
  }
> = {
  arcade_burst: {
    label: 'Clean Blue',
    description: 'Bright, simple split layout with a clear yellow callout.',
    patch: {
      accentColor: '#F8FAFC',
      secondaryAccentColor: '#FACC15',
      textColor: '#FFFFFF',
      backgroundStart: '#0F172A',
      backgroundEnd: '#1D4ED8',
      panelColor: '#FFFFFF',
      headlineStyle: 'outline'
    }
  },
  editorial_glow: {
    label: 'Slate',
    description: 'Muted background with strong title contrast and calmer framing.',
    patch: {
      accentColor: '#E2E8F0',
      secondaryAccentColor: '#FACC15',
      textColor: '#F8FAFC',
      backgroundStart: '#0F172A',
      backgroundEnd: '#334155',
      panelColor: '#E2E8F0',
      headlineStyle: 'glow'
    }
  },
  story_gold: {
    label: 'Warm Gold',
    description: 'Softer warm tones for lighter puzzle scenes and kid-friendly thumbnails.',
    patch: {
      accentColor: '#FFF7ED',
      secondaryAccentColor: '#F59E0B',
      textColor: '#FFF7ED',
      backgroundStart: '#78350F',
      backgroundEnd: '#C2410C',
      panelColor: '#FFF7ED',
      headlineStyle: 'highlight'
    }
  },
  midnight_alert: {
    label: 'Dark Contrast',
    description: 'Deep contrast for stronger puzzle focus without extra decoration.',
    patch: {
      accentColor: '#E2E8F0',
      secondaryAccentColor: '#FB923C',
      textColor: '#F8FAFC',
      backgroundStart: '#020617',
      backgroundEnd: '#1E293B',
      panelColor: '#E2E8F0',
      headlineStyle: 'outline'
    }
  }
};

const STORAGE_KEY = 'spotitnow.thumbnail-presets';
const HEX_COLOR_PATTERN = /^#(?:[0-9A-Fa-f]{3}){1,2}$/;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const sanitizeText = (value: unknown, fallback = '') =>
  typeof value === 'string' ? value.trim() : fallback;

const sanitizeHexColor = (value: unknown, fallback: string) =>
  typeof value === 'string' && HEX_COLOR_PATTERN.test(value) ? value : fallback;

const sanitizeTheme = (value: unknown): ThumbnailThemePreset =>
  value === 'editorial_glow' ||
  value === 'story_gold' ||
  value === 'midnight_alert' ||
  value === 'arcade_burst'
    ? value
    : DEFAULT_THUMBNAIL_SETTINGS.theme;

const sanitizeTextTemplate = (value: unknown): ThumbnailTextTemplate =>
  value === 'reference_classic' ||
  value === 'reference_midline' ||
  value === 'reference_compact' ||
  value === 'reveal_punch' ||
  value === 'bottom_banner' ||
  value === 'corner_card' ||
  value === 'challenge_stack'
    ? value
    : DEFAULT_THUMBNAIL_SETTINGS.textTemplate;

const sanitizeBackgroundStyle = (value: unknown): ThumbnailBackgroundStyle =>
  value === 'comic_burst' ||
  value === 'paper_stack' ||
  value === 'studio_frame' ||
  value === 'soft_stage'
    ? value
    : DEFAULT_THUMBNAIL_SETTINGS.backgroundStyle;

const sanitizeLayout = (value: unknown): ThumbnailLayoutPreset =>
  value === 'square_split' ||
  value === 'square_stagger' ||
  value === 'puzzle_hero' ||
  value === 'diff_hero' ||
  value === 'top_bottom'
    ? value
    : value === 'split_compare'
      ? 'square_split'
      : value === 'puzzle_spotlight'
        ? 'puzzle_hero'
        : value === 'diff_spotlight'
          ? 'diff_hero'
          : DEFAULT_THUMBNAIL_SETTINGS.layout;

const sanitizeHeadlineStyle = (value: unknown): ThumbnailHeadlineStyle =>
  value === 'highlight' || value === 'glow' || value === 'outline'
    ? value
    : DEFAULT_THUMBNAIL_SETTINGS.headlineStyle;

const sanitizeTextAlign = (value: unknown): ThumbnailTextAlign =>
  value === 'center' ? 'center' : 'left';

const sanitizeLogoPosition = (value: unknown): ThumbnailLogoPosition =>
  value === 'top_left' || value === 'bottom_left' || value === 'bottom_right' || value === 'top_right'
    ? value
    : DEFAULT_THUMBNAIL_SETTINGS.logoPosition;

const sanitizeArrowTarget = (value: unknown): ThumbnailArrowTarget =>
  value === 'puzzle' ? 'puzzle' : 'diff';

const sanitizeExportFormat = (value: unknown): ThumbnailExportFormat =>
  value === 'jpeg' || value === 'webp' || value === 'png' ? value : DEFAULT_THUMBNAIL_SETTINGS.exportFormat;

const sanitizeExportSize = (value: unknown): ThumbnailExportSize =>
  value === '1920x1080' || value === '1280x720' ? value : DEFAULT_THUMBNAIL_SETTINGS.exportSize;

const sanitizeTransformBox = (value: unknown, fallback: ThumbnailTransformBox): ThumbnailTransformBox => {
  if (!value || typeof value !== 'object') return fallback;
  const candidate = value as Partial<ThumbnailTransformBox>;
  return {
    x: clamp(Number(candidate.x) || fallback.x, 0.05, 0.95),
    y: clamp(Number(candidate.y) || fallback.y, 0.05, 0.95),
    width: clamp(Number(candidate.width) || fallback.width, 0.08, 0.9),
    height: clamp(Number(candidate.height) || fallback.height, 0.06, 0.7),
    rotation: clamp(Number(candidate.rotation) || fallback.rotation, -180, 180)
  };
};

const sanitizeOverlayItem = (value: unknown): ThumbnailOverlayItem | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<ThumbnailOverlayItem>;
  const id = typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id.trim() : '';
  const src = typeof candidate.src === 'string' && candidate.src.trim() ? candidate.src : '';
  if (!id || !src) return null;
  return {
    id,
    name: typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name.trim() : 'Overlay',
    src,
    x: clamp(Number(candidate.x) || 0.5, 0.02, 0.98),
    y: clamp(Number(candidate.y) || 0.5, 0.02, 0.98),
    width: clamp(Number(candidate.width) || 0.16, 0.04, 0.8),
    height: clamp(Number(candidate.height) || 0.16, 0.04, 0.8),
    rotation: clamp(Number(candidate.rotation) || 0, -180, 180),
    opacity: clamp(Number(candidate.opacity) || 1, 0.1, 1)
  };
};

export const sanitizeThumbnailCreatorSettings = (
  input?: Partial<ThumbnailCreatorSettings> | null
): ThumbnailCreatorSettings => ({
  layout: sanitizeLayout(input?.layout),
  theme: sanitizeTheme(input?.theme),
  textTemplate: sanitizeTextTemplate(input?.textTemplate),
  backgroundStyle: sanitizeBackgroundStyle(input?.backgroundStyle),
  eyebrow: sanitizeText(input?.eyebrow, DEFAULT_THUMBNAIL_SETTINGS.eyebrow),
  title: sanitizeText(input?.title, DEFAULT_THUMBNAIL_SETTINGS.title),
  subtitle: sanitizeText(input?.subtitle, DEFAULT_THUMBNAIL_SETTINGS.subtitle),
  badge: sanitizeText(input?.badge, DEFAULT_THUMBNAIL_SETTINGS.badge),
  headlineStyle: sanitizeHeadlineStyle(input?.headlineStyle),
  titleSize: clamp(Number(input?.titleSize) || DEFAULT_THUMBNAIL_SETTINGS.titleSize, 56, 180),
  subtitleSize: clamp(Number(input?.subtitleSize) || DEFAULT_THUMBNAIL_SETTINGS.subtitleSize, 16, 72),
  textAlign: sanitizeTextAlign(input?.textAlign),
  uppercaseTitle:
    typeof input?.uppercaseTitle === 'boolean'
      ? input.uppercaseTitle
      : DEFAULT_THUMBNAIL_SETTINGS.uppercaseTitle,
  accentColor: sanitizeHexColor(input?.accentColor, DEFAULT_THUMBNAIL_SETTINGS.accentColor),
  secondaryAccentColor: sanitizeHexColor(
    input?.secondaryAccentColor,
    DEFAULT_THUMBNAIL_SETTINGS.secondaryAccentColor
  ),
  textColor: sanitizeHexColor(input?.textColor, DEFAULT_THUMBNAIL_SETTINGS.textColor),
  backgroundStart: sanitizeHexColor(input?.backgroundStart, DEFAULT_THUMBNAIL_SETTINGS.backgroundStart),
  backgroundEnd: sanitizeHexColor(input?.backgroundEnd, DEFAULT_THUMBNAIL_SETTINGS.backgroundEnd),
  panelColor: sanitizeHexColor(input?.panelColor, DEFAULT_THUMBNAIL_SETTINGS.panelColor),
  imageBrightness: clamp(Number(input?.imageBrightness) || DEFAULT_THUMBNAIL_SETTINGS.imageBrightness, 0.7, 1.5),
  imageContrast: clamp(Number(input?.imageContrast) || DEFAULT_THUMBNAIL_SETTINGS.imageContrast, 0.8, 1.8),
  imageSaturation: clamp(Number(input?.imageSaturation) || DEFAULT_THUMBNAIL_SETTINGS.imageSaturation, 0.5, 2),
  diffImageBrightness: clamp(
    Number(input?.diffImageBrightness) || DEFAULT_THUMBNAIL_SETTINGS.diffImageBrightness,
    0.7,
    1.7
  ),
  diffImageContrast: clamp(
    Number(input?.diffImageContrast) || DEFAULT_THUMBNAIL_SETTINGS.diffImageContrast,
    0.8,
    2
  ),
  diffImageSaturation: clamp(
    Number(input?.diffImageSaturation) || DEFAULT_THUMBNAIL_SETTINGS.diffImageSaturation,
    0.5,
    2.2
  ),
  backgroundBlur: clamp(Number(input?.backgroundBlur) || DEFAULT_THUMBNAIL_SETTINGS.backgroundBlur, 0, 28),
  backgroundDim: clamp(Number(input?.backgroundDim) || DEFAULT_THUMBNAIL_SETTINGS.backgroundDim, 0, 0.72),
  showArrow: typeof input?.showArrow === 'boolean' ? input.showArrow : DEFAULT_THUMBNAIL_SETTINGS.showArrow,
  arrowTarget: sanitizeArrowTarget(input?.arrowTarget),
  showBurst: typeof input?.showBurst === 'boolean' ? input.showBurst : DEFAULT_THUMBNAIL_SETTINGS.showBurst,
  burstText: sanitizeText(input?.burstText, DEFAULT_THUMBNAIL_SETTINGS.burstText),
  logoEnabled: typeof input?.logoEnabled === 'boolean' ? input.logoEnabled : DEFAULT_THUMBNAIL_SETTINGS.logoEnabled,
  logoSrc: typeof input?.logoSrc === 'string' ? input.logoSrc : DEFAULT_THUMBNAIL_SETTINGS.logoSrc,
  logoScale: clamp(Number(input?.logoScale) || DEFAULT_THUMBNAIL_SETTINGS.logoScale, 0.4, 2.4),
  logoPosition: sanitizeLogoPosition(input?.logoPosition),
  logoChromaKeyEnabled:
    typeof input?.logoChromaKeyEnabled === 'boolean'
      ? input.logoChromaKeyEnabled
      : DEFAULT_THUMBNAIL_SETTINGS.logoChromaKeyEnabled,
  logoChromaKeyColor: sanitizeHexColor(
    input?.logoChromaKeyColor,
    DEFAULT_THUMBNAIL_SETTINGS.logoChromaKeyColor
  ),
  logoChromaKeyTolerance: clamp(
    Number(input?.logoChromaKeyTolerance) || DEFAULT_THUMBNAIL_SETTINGS.logoChromaKeyTolerance,
    0,
    255
  ),
  exportFormat: sanitizeExportFormat(input?.exportFormat),
  exportQuality: clamp(Number(input?.exportQuality) || DEFAULT_THUMBNAIL_SETTINGS.exportQuality, 50, 100),
  exportSize: sanitizeExportSize(input?.exportSize),
  textBox: sanitizeTransformBox(input?.textBox, DEFAULT_THUMBNAIL_SETTINGS.textBox),
  puzzleCard: sanitizeTransformBox(input?.puzzleCard, DEFAULT_THUMBNAIL_SETTINGS.puzzleCard),
  diffCard: sanitizeTransformBox(input?.diffCard, DEFAULT_THUMBNAIL_SETTINGS.diffCard),
  overlayImages: Array.isArray(input?.overlayImages)
    ? input.overlayImages
        .map((entry) => sanitizeOverlayItem(entry))
        .filter((entry): entry is ThumbnailOverlayItem => Boolean(entry))
        .slice(0, 12)
    : DEFAULT_THUMBNAIL_SETTINGS.overlayImages
});

const readStoredValue = () => {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(STORAGE_KEY);
};

const writeStoredValue = (presets: ThumbnailPreset[]) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
};

const sanitizePreset = (value: unknown): ThumbnailPreset | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<ThumbnailPreset>;
  const id = typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id.trim() : '';
  const name = typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name.trim() : '';
  if (!id || !name) return null;
  const createdAt = Math.max(1, Math.floor(Number(candidate.createdAt) || Date.now()));
  const updatedAt = Math.max(createdAt, Math.floor(Number(candidate.updatedAt) || createdAt));

  return {
    id,
    name,
    settings: sanitizeThumbnailCreatorSettings(candidate.settings),
    createdAt,
    updatedAt
  };
};

export const loadThumbnailPresets = (): ThumbnailPreset[] => {
  try {
    const raw = readStoredValue();
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((entry) => sanitizePreset(entry)).filter((entry): entry is ThumbnailPreset => Boolean(entry));
  } catch {
    return [];
  }
};

export const saveThumbnailPreset = (
  name: string,
  settings: Partial<ThumbnailCreatorSettings>,
  existingId?: string
): ThumbnailPreset[] => {
  const trimmedName = name.trim() || 'Untitled Preset';
  const now = Date.now();
  const normalizedSettings = sanitizeThumbnailCreatorSettings(settings);
  const current = loadThumbnailPresets();
  const nextPreset: ThumbnailPreset = {
    id: existingId?.trim() || `thumb-preset-${now}-${Math.random().toString(36).slice(2, 8)}`,
    name: trimmedName,
    settings: normalizedSettings,
    createdAt:
      current.find((entry) => entry.id === existingId)?.createdAt ??
      now,
    updatedAt: now
  };
  const next = [
    nextPreset,
    ...current.filter((entry) => entry.id !== nextPreset.id)
  ].slice(0, 24);
  writeStoredValue(next);
  return next;
};

export const deleteThumbnailPreset = (presetId: string): ThumbnailPreset[] => {
  const next = loadThumbnailPresets().filter((entry) => entry.id !== presetId);
  writeStoredValue(next);
  return next;
};
