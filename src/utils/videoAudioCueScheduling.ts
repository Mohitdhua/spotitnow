import { resolveVideoProgressIntroDuration } from './videoProgressMotion';

export const VIDEO_AUDIO_FIXED_CUE_MAX_DURATION_SECONDS = 4;
export const VIDEO_AUDIO_PUZZLE_PLAY_END_GAP_SECONDS = 4;
export const VIDEO_AUDIO_FIXED_FADE_SECONDS = 1;
export const VIDEO_AUDIO_LOW_TIME_WARNING_LEAD_SECONDS = 5;

export interface VideoAudioPlaybackAutomation {
  gainStart: number;
  gainEnd: number;
  playbackRateStart: number;
  playbackRateEnd: number;
  duration: number;
}

export interface VideoAudioCueWindow {
  delaySeconds: number;
  maxDuration: number;
  fadeOutDuration: number;
  automation?: VideoAudioPlaybackAutomation;
}

const clampDuration = (value: number) =>
  Number.isFinite(value) ? Math.max(0, value) : 0;

const resolveFadeOutDuration = (maxDuration: number) =>
  Math.min(VIDEO_AUDIO_FIXED_FADE_SECONDS, clampDuration(maxDuration));

export const resolveProgressFillIntroCueWindow = (
  showDuration: number,
  clipDuration: number
): VideoAudioCueWindow | null => {
  const introDuration = Math.min(
    resolveVideoProgressIntroDuration(showDuration),
    VIDEO_AUDIO_FIXED_CUE_MAX_DURATION_SECONDS
  );
  const maxDuration = Math.min(clampDuration(clipDuration), clampDuration(introDuration));
  if (maxDuration <= 0) {
    return null;
  }

  return {
    delaySeconds: 0,
    maxDuration,
    fadeOutDuration: resolveFadeOutDuration(maxDuration)
  };
};

export const resolvePuzzlePlayCueWindow = (
  showDuration: number,
  progressFillDuration: number,
  urgencyRampEnabled: boolean
): VideoAudioCueWindow | null => {
  const delaySeconds = Math.min(
    clampDuration(progressFillDuration),
    clampDuration(showDuration)
  );
  const stopTime = Math.max(delaySeconds, showDuration - VIDEO_AUDIO_PUZZLE_PLAY_END_GAP_SECONDS);
  const maxDuration = clampDuration(stopTime - delaySeconds);
  if (maxDuration <= 0) {
    return null;
  }

  const fadeOutDuration = resolveFadeOutDuration(maxDuration);
  const automationDuration = Math.max(0, maxDuration - fadeOutDuration);

  return {
    delaySeconds,
    maxDuration,
    fadeOutDuration,
    automation:
      urgencyRampEnabled && automationDuration > 0
        ? {
            gainStart: 1,
            gainEnd: 1.18,
            playbackRateStart: 1,
            playbackRateEnd: 1.12,
            duration: automationDuration
          }
        : undefined
  };
};

export const resolveLowTimeWarningCueWindow = (
  showDuration: number
): VideoAudioCueWindow | null => {
  const delaySeconds = Math.max(
    0,
    clampDuration(showDuration) - VIDEO_AUDIO_LOW_TIME_WARNING_LEAD_SECONDS
  );
  const maxDuration = clampDuration(showDuration - delaySeconds);
  if (maxDuration <= 0) {
    return null;
  }

  return {
    delaySeconds,
    maxDuration,
    fadeOutDuration: 0
  };
};
