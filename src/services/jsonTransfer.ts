import type { Puzzle, PuzzleSet } from '../types';

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object';

export const downloadJsonFile = (data: unknown, filename: string) => {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

export const isPuzzleLike = (value: unknown): value is Puzzle =>
  isObjectRecord(value) &&
  typeof value.imageA === 'string' &&
  typeof value.imageB === 'string' &&
  Array.isArray(value.regions);

export const parsePuzzleJsonText = (raw: string): Puzzle[] => {
  const parsed = JSON.parse(raw) as unknown;

  if (Array.isArray(parsed) && parsed.every(isPuzzleLike)) {
    return parsed;
  }

  if (isObjectRecord(parsed) && Array.isArray(parsed.puzzles) && parsed.puzzles.every(isPuzzleLike)) {
    return parsed.puzzles as PuzzleSet['puzzles'];
  }

  if (isPuzzleLike(parsed)) {
    return [parsed];
  }

  throw new Error('Invalid puzzle file format');
};
