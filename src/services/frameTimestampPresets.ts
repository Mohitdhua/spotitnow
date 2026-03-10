export interface FrameTimestampPreset {
  id: string;
  title: string;
  timestampsText: string;
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = 'spotitnow.frame-timestamp-presets.v1';

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const sanitizeTitle = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const sanitizeTimestampsText = (value: unknown) =>
  typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim() : '';

const isValidPreset = (value: unknown): value is FrameTimestampPreset => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const preset = value as FrameTimestampPreset;
  return (
    typeof preset.id === 'string' &&
    sanitizeTitle(preset.title).length > 0 &&
    sanitizeTimestampsText(preset.timestampsText).length > 0 &&
    isFiniteNumber(preset.createdAt) &&
    isFiniteNumber(preset.updatedAt)
  );
};

const sanitizePreset = (value: unknown): FrameTimestampPreset | null => {
  if (!isValidPreset(value)) {
    return null;
  }

  return {
    id: value.id,
    title: sanitizeTitle(value.title),
    timestampsText: sanitizeTimestampsText(value.timestampsText),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt
  };
};

const readRawPresets = (): FrameTimestampPreset[] => {
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

    return parsed
      .map((preset) => sanitizePreset(preset))
      .filter((preset): preset is FrameTimestampPreset => Boolean(preset));
  } catch {
    return [];
  }
};

const writeRawPresets = (presets: FrameTimestampPreset[]) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
};

export const loadFrameTimestampPresets = (): FrameTimestampPreset[] => readRawPresets();

export const replaceFrameTimestampPresets = (presets: unknown): FrameTimestampPreset[] => {
  const safePresets = Array.isArray(presets)
    ? presets
        .map((preset) => sanitizePreset(preset))
        .filter((preset): preset is FrameTimestampPreset => Boolean(preset))
    : [];

  writeRawPresets(safePresets);
  return safePresets;
};

export const saveFrameTimestampPreset = (
  preset: Omit<FrameTimestampPreset, 'createdAt' | 'updatedAt'> & Partial<Pick<FrameTimestampPreset, 'createdAt'>>
): FrameTimestampPreset[] => {
  const title = sanitizeTitle(preset.title);
  const timestampsText = sanitizeTimestampsText(preset.timestampsText);
  if (!title || !timestampsText) {
    return readRawPresets();
  }

  const now = Date.now();
  const existing = readRawPresets();
  const next = existing.filter((entry) => entry.id !== preset.id);
  next.unshift({
    id: preset.id,
    title,
    timestampsText,
    createdAt: preset.createdAt ?? now,
    updatedAt: now
  });
  writeRawPresets(next);
  return next;
};

export const deleteFrameTimestampPreset = (presetId: string): FrameTimestampPreset[] => {
  const next = readRawPresets().filter((entry) => entry.id !== presetId);
  writeRawPresets(next);
  return next;
};
