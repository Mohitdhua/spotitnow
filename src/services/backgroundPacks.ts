import type { GeneratedBackgroundPack, GeneratedBackgroundPaletteId } from '../types';
import {
  GENERATED_BACKGROUND_PACK_SIZE,
  coerceGeneratedBackgroundRecipe,
  createGeneratedBackgroundPack,
  createStarterGeneratedBackgroundPack
} from './generatedBackgrounds';

const BACKGROUND_PACKS_KEY = 'spotitnow.generated-background-packs.v2';
const BACKGROUND_PACKS_LEGACY_KEYS = [
  'spotitnow.generated-background-packs.v1',
  'spotdiff.generated-background-packs.v1'
];

const PALETTE_IDS: GeneratedBackgroundPaletteId[] = ['sunrise', 'mint', 'midnight', 'candy', 'ocean', 'amber'];
const ASPECT_RATIOS: Array<GeneratedBackgroundPack['aspectRatio']> = ['16:9', '9:16'];

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
  const aspectRatio = ASPECT_RATIOS.includes(value.aspectRatio as GeneratedBackgroundPack['aspectRatio'])
    ? (value.aspectRatio as GeneratedBackgroundPack['aspectRatio'])
    : '16:9';
  const createdAt = Math.max(1, Math.floor(Number(value.createdAt) || Date.now()));
  const updatedAt = Math.max(createdAt, Math.floor(Number(value.updatedAt) || createdAt));
  const id =
    typeof value.id === 'string' && value.id.trim()
      ? value.id.trim()
      : `background-pack-${createdAt}`;
  const name =
    typeof value.name === 'string' && value.name.trim()
      ? value.name.trim()
      : `Background Pack ${new Date(createdAt).toLocaleDateString()}`;
  const description = typeof value.description === 'string' ? value.description.trim() : '';
  const fallbackPaletteId = PALETTE_IDS.includes(value.defaultPaletteId as GeneratedBackgroundPaletteId)
    ? (value.defaultPaletteId as GeneratedBackgroundPaletteId)
    : 'sunrise';
  const parsedBackgrounds = Array.isArray(value.backgrounds)
    ? value.backgrounds
        .map((background, index) => coerceGeneratedBackgroundRecipe(background, createdAt + index * 17, 'confetti_field', fallbackPaletteId))
        .filter((entry): entry is GeneratedBackgroundPack['backgrounds'][number] => Boolean(entry))
    : [];
  const fallbackPack = createGeneratedBackgroundPack({
    name,
    description,
    aspectRatio,
    baseSeed: createdAt
  });
  const backgrounds = [...parsedBackgrounds, ...fallbackPack.backgrounds].slice(0, GENERATED_BACKGROUND_PACK_SIZE);

  if (!backgrounds.length) {
    return null;
  }

  return {
    id,
    name,
    description,
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

export const renameGeneratedBackgroundPack = (packId: string, nextName: string) => {
  const safeName = nextName.trim();
  if (!safeName) {
    return loadGeneratedBackgroundPacks();
  }

  const next = loadGeneratedBackgroundPacks().map((entry) =>
    entry.id === packId
      ? {
          ...entry,
          name: safeName,
          updatedAt: Date.now()
        }
      : entry
  );
  const safeNext = replaceGeneratedBackgroundPacks(next);
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
