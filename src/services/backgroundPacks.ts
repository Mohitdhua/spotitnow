import type { GeneratedBackgroundPack, GeneratedBackgroundPaletteId, GeneratedBackgroundPattern, GeneratedBackgroundSceneKind } from '../types';
import { createStarterGeneratedBackgroundPack } from './generatedBackgrounds';

const BACKGROUND_PACKS_KEY = 'spotitnow.generated-background-packs.v1';
const BACKGROUND_PACKS_LEGACY_KEYS = ['spotdiff.generated-background-packs.v1'];

const SCENE_KINDS: GeneratedBackgroundSceneKind[] = [
  'arcade',
  'studio',
  'forest',
  'city',
  'seaside',
  'dreamscape'
];

const PALETTE_IDS: GeneratedBackgroundPaletteId[] = ['sunrise', 'mint', 'midnight', 'candy', 'ocean', 'amber'];
const PATTERNS: GeneratedBackgroundPattern[] = ['dots', 'grid', 'sparkle', 'waves'];
const ASPECT_RATIOS: Array<GeneratedBackgroundPack['aspectRatio']> = ['16:9', '9:16', '1:1', '4:3'];

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object';

const readStoredValue = () => {
  if (typeof window === 'undefined') return null;
  const keys = [BACKGROUND_PACKS_KEY, ...BACKGROUND_PACKS_LEGACY_KEYS];
  for (const key of keys) {
    const value = window.localStorage.getItem(key);
    if (value !== null) {
      return value;
    }
  }
  return null;
};

const writeStoredValue = (packs: GeneratedBackgroundPack[]) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(BACKGROUND_PACKS_KEY, JSON.stringify(packs));
  BACKGROUND_PACKS_LEGACY_KEYS.forEach((key) => window.localStorage.removeItem(key));
};

const sanitizePack = (value: unknown): GeneratedBackgroundPack | null => {
  if (!isObjectRecord(value)) return null;
  const backgrounds = Array.isArray(value.backgrounds)
    ? value.backgrounds
        .map((background, index) => {
          if (!isObjectRecord(background)) return null;
          const sceneKind = SCENE_KINDS.includes(background.sceneKind as GeneratedBackgroundSceneKind)
            ? (background.sceneKind as GeneratedBackgroundSceneKind)
            : 'arcade';
          const paletteId = PALETTE_IDS.includes(background.paletteId as GeneratedBackgroundPaletteId)
            ? (background.paletteId as GeneratedBackgroundPaletteId)
            : 'sunrise';
          const pattern = PATTERNS.includes(background.pattern as GeneratedBackgroundPattern)
            ? (background.pattern as GeneratedBackgroundPattern)
            : 'dots';
          return {
            id:
              typeof background.id === 'string' && background.id.trim()
                ? background.id.trim()
                : `${String(value.id ?? 'background-pack')}-background-${index + 1}`,
            name:
              typeof background.name === 'string' && background.name.trim()
                ? background.name.trim()
                : `Background ${index + 1}`,
            seed: Math.max(1, Math.floor(Number(background.seed) || index + 1)),
            sceneKind,
            paletteId,
            horizon: Math.min(0.9, Math.max(0.2, Number(background.horizon) || 0.52)),
            density: Math.min(1, Math.max(0.1, Number(background.density) || 0.5)),
            accentScale: Math.min(1, Math.max(0.1, Number(background.accentScale) || 0.5)),
            pattern
          };
        })
        .filter((entry): entry is GeneratedBackgroundPack['backgrounds'][number] => Boolean(entry))
    : [];

  if (!backgrounds.length) {
    return null;
  }

  const aspectRatio = ASPECT_RATIOS.includes(value.aspectRatio as GeneratedBackgroundPack['aspectRatio'])
    ? (value.aspectRatio as GeneratedBackgroundPack['aspectRatio'])
    : '16:9';
  const createdAt = Math.max(1, Math.floor(Number(value.createdAt) || Date.now()));
  const updatedAt = Math.max(createdAt, Math.floor(Number(value.updatedAt) || createdAt));
  const id =
    typeof value.id === 'string' && value.id.trim()
      ? value.id.trim()
      : `background-pack-${createdAt}`;

  return {
    id,
    name:
      typeof value.name === 'string' && value.name.trim()
        ? value.name.trim()
        : `Background Pack ${new Date(createdAt).toLocaleDateString()}`,
    description: typeof value.description === 'string' ? value.description.trim() : '',
    aspectRatio,
    createdAt,
    updatedAt,
    backgrounds,
    coverBackgroundId:
      typeof value.coverBackgroundId === 'string' && backgrounds.some((entry) => entry.id === value.coverBackgroundId)
        ? value.coverBackgroundId
        : backgrounds[0].id
  };
};

const ensureStarterPack = (packs: GeneratedBackgroundPack[]) => {
  if (packs.length > 0) {
    return packs;
  }
  return [createStarterGeneratedBackgroundPack()];
};

export const loadGeneratedBackgroundPacks = (): GeneratedBackgroundPack[] => {
  const starter = ensureStarterPack([]);
  if (typeof window === 'undefined') return starter;

  try {
    const raw = readStoredValue();
    if (!raw) return starter;
    const parsed = JSON.parse(raw);
    const packs = Array.isArray(parsed)
      ? parsed
          .map((entry) => sanitizePack(entry))
          .filter((entry): entry is GeneratedBackgroundPack => Boolean(entry))
      : [];
    const safePacks = ensureStarterPack(packs);
    if (safePacks !== packs) {
      writeStoredValue(safePacks);
    }
    return safePacks;
  } catch {
    return starter;
  }
};

export const saveGeneratedBackgroundPack = (pack: GeneratedBackgroundPack) => {
  const current = loadGeneratedBackgroundPacks().filter((entry) => entry.id !== pack.id);
  const safePack = sanitizePack(pack);
  if (!safePack) {
    throw new Error('Invalid background pack.');
  }
  const next = [safePack, ...current];
  writeStoredValue(next);
  return next;
};

export const deleteGeneratedBackgroundPack = (packId: string) => {
  const next = loadGeneratedBackgroundPacks().filter((entry) => entry.id !== packId);
  const safeNext = ensureStarterPack(next);
  writeStoredValue(safeNext);
  return safeNext;
};

export const replaceGeneratedBackgroundPacks = (value: unknown) => {
  const packs = Array.isArray(value)
    ? value
        .map((entry) => sanitizePack(entry))
        .filter((entry): entry is GeneratedBackgroundPack => Boolean(entry))
    : [];
  const safePacks = ensureStarterPack(packs);
  writeStoredValue(safePacks);
  return safePacks;
};
