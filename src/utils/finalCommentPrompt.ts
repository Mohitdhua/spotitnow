import type { VideoSettings } from '../types';

export const FINAL_COMMENT_PROMPT_DURATION_SECONDS = 5;
export const FINAL_COMMENT_PROMPT_MAX_WORDS_PER_LINE = 5;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const hasFinalCommentPrompt = (
  settings: Pick<VideoSettings, 'skipLastPuzzleReveal' | 'finalCommentPromptText'>
) => settings.skipLastPuzzleReveal === true && settings.finalCommentPromptText.trim().length > 0;

export const splitFinalCommentPromptIntoLines = (
  text: string,
  maxWordsPerLine = FINAL_COMMENT_PROMPT_MAX_WORDS_PER_LINE
) => {
  const safeLineSize = Math.max(1, Math.floor(maxWordsPerLine));

  return text
    .split(/\r?\n/)
    .flatMap((segment) => {
      const words = segment.trim().split(/\s+/).filter(Boolean);
      if (!words.length) return [];

      const lines: string[] = [];
      for (let index = 0; index < words.length; index += safeLineSize) {
        lines.push(words.slice(index, index + safeLineSize).join(' '));
      }
      return lines;
    });
};

export const shouldShowFinalCommentPrompt = (
  settings: Pick<VideoSettings, 'skipLastPuzzleReveal' | 'finalCommentPromptText'>,
  totalDurationSeconds: number,
  elapsedSeconds: number
) => {
  if (!hasFinalCommentPrompt(settings)) return false;
  const safeTotalDuration = Math.max(0, totalDurationSeconds);
  const safeElapsed = clamp(elapsedSeconds, 0, safeTotalDuration);
  return safeElapsed >= Math.max(0, safeTotalDuration - FINAL_COMMENT_PROMPT_DURATION_SECONDS);
};

export const clampFinalCommentPromptPosition = (value: number, fallback: number) => {
  if (!Number.isFinite(value)) return fallback;
  return clamp(value, 0, 100);
};
