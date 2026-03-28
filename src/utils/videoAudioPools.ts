import type { VideoAudioCuePool, VideoAudioCuePoolKey, VideoAudioCuePools } from '../types';

export const VIDEO_AUDIO_CUE_POOL_MAX_VOLUME = 1.5;

const clampPoolVolume = (value: number) =>
  Math.min(VIDEO_AUDIO_CUE_POOL_MAX_VOLUME, Math.max(0, value));

export const VIDEO_AUDIO_POOL_KEYS: VideoAudioCuePoolKey[] = [
  'progress_fill_intro',
  'puzzle_play',
  'low_time_warning',
  'marker_reveal',
  'blink',
  'transition'
];

export const VIDEO_AUDIO_POOL_DEFINITIONS: Array<{
  key: VideoAudioCuePoolKey;
  label: string;
  description: string;
}> = [
  {
    key: 'progress_fill_intro',
    label: 'Progress Fill Intro',
    description: 'Plays at puzzle start while the progress intro fill kicks in.'
  },
  {
    key: 'puzzle_play',
    label: 'Puzzle Play',
    description: 'One track is assigned per puzzle. When the pool is smaller than the puzzle count, it reshuffles and wraps.'
  },
  {
    key: 'low_time_warning',
    label: 'Low Time Warning',
    description: 'Starts 5 seconds before puzzle time ends and takes over from puzzle play audio.'
  },
  {
    key: 'marker_reveal',
    label: 'Marker Reveal',
    description: 'Random pick each time a marker is revealed.'
  },
  {
    key: 'blink',
    label: 'Blink Animation',
    description: 'Random pick each time the blink animation fires.'
  },
  {
    key: 'transition',
    label: 'Transition',
    description: 'Random pick when moving from one puzzle to the next.'
  }
];

const createDefaultPool = (): VideoAudioCuePool => ({
  enabled: true,
  volume: 1,
  sources: []
});

export const createDefaultVideoAudioCuePools = (): VideoAudioCuePools => ({
  progress_fill_intro: createDefaultPool(),
  puzzle_play: createDefaultPool(),
  low_time_warning: createDefaultPool(),
  marker_reveal: createDefaultPool(),
  blink: createDefaultPool(),
  transition: createDefaultPool()
});

const normalizeSources = (value: unknown) =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [];

export const sanitizeVideoAudioCuePools = (
  input: unknown,
  fallback: VideoAudioCuePools
): VideoAudioCuePools => {
  const safeFallback = fallback ?? createDefaultVideoAudioCuePools();
  const defaults = createDefaultVideoAudioCuePools();
  const candidate = input && typeof input === 'object' ? (input as Partial<Record<VideoAudioCuePoolKey, unknown>>) : {};

  const next = { ...defaults } as VideoAudioCuePools;
  VIDEO_AUDIO_POOL_KEYS.forEach((key) => {
    const rawPool = candidate[key];
    const poolRecord = rawPool && typeof rawPool === 'object' ? (rawPool as Partial<VideoAudioCuePool>) : {};
    next[key] = {
      enabled: typeof poolRecord.enabled === 'boolean' ? poolRecord.enabled : safeFallback[key]?.enabled ?? defaults[key].enabled,
      volume:
        Number.isFinite(Number(poolRecord.volume))
          ? clampPoolVolume(Number(poolRecord.volume))
          : clampPoolVolume(safeFallback[key]?.volume ?? defaults[key].volume),
      sources: normalizeSources(poolRecord.sources).length > 0 ? normalizeSources(poolRecord.sources) : safeFallback[key]?.sources ?? defaults[key].sources
    };
  });
  return next;
};

const hashString = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const createSeededRandom = (seed: number) => {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

const shuffleIndices = (size: number, seed: number) => {
  const order = Array.from({ length: size }, (_, index) => index);
  const random = createSeededRandom(seed);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const nextIndex = Math.floor(random() * (index + 1));
    [order[index], order[nextIndex]] = [order[nextIndex], order[index]];
  }
  return order;
};

const buildPoolSeed = (sources: string[], salt: string) => hashString(`${salt}|${sources.join('|')}`);

export const resolveVideoAudioCyclePoolIndex = (
  sources: string[],
  assignmentIndex: number,
  salt: string
) => {
  if (!sources.length || assignmentIndex < 0) return null;
  const cycle = Math.floor(assignmentIndex / sources.length);
  const offset = assignmentIndex % sources.length;
  const order = shuffleIndices(sources.length, buildPoolSeed(sources, `${salt}|cycle:${cycle}`));
  return order[offset] ?? null;
};

export const resolveVideoAudioEventPoolIndex = (
  sources: string[],
  puzzleIndex: number,
  eventIndex: number,
  salt: string
) => {
  if (!sources.length) return null;
  const seed = buildPoolSeed(sources, `${salt}|puzzle:${puzzleIndex}|event:${eventIndex}`);
  return seed % sources.length;
};
