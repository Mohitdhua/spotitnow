import type { VideoProgressMotion } from '../types';
import { resolveVideoPuzzleEntryDuration } from './videoTransitionMotion';

export type VideoProgressMotionPhase =
  | 'intro'
  | 'showing'
  | 'revealing'
  | 'transitioning'
  | 'outro'
  | 'finished';

export interface VideoProgressMotionState {
  fillRatio: number;
  fillPercent: number;
  countdownRatio: number;
  sweepActive: boolean;
  sweepProgress: number;
  sweepOpacity: number;
  pulseScale: number;
  pulseGlowOpacity: number;
  pulseOverlayOpacity: number;
  pulseBrightness: number;
}

interface ResolveVideoProgressMotionInput {
  mode: VideoProgressMotion;
  phase: VideoProgressMotionPhase;
  phaseDuration: number;
  timeLeft: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lerp = (start: number, end: number, progress: number) => start + (end - start) * progress;
const smoothstep = (value: number) => value * value * (3 - 2 * value);
const pulseWave = (progress: number) => 0.5 - 0.5 * Math.cos(progress * Math.PI * 2);

const resolveProgressPulseState = (countdownRatio: number, phaseElapsed: number) => {
  const urgency = smoothstep(1 - clamp(countdownRatio, 0, 1));
  const cycleDuration = lerp(1.8, 0.45, urgency);
  const cycleProgress = cycleDuration <= 0 ? 0 : (phaseElapsed % cycleDuration) / cycleDuration;
  const wave = pulseWave(cycleProgress);

  return {
    pulseScale: 1 + lerp(0.012, 0.04, urgency) * wave,
    pulseGlowOpacity: lerp(0.08, 0.42, urgency) * (0.3 + wave * 0.7),
    pulseOverlayOpacity: lerp(0.04, 0.28, urgency) * wave,
    pulseBrightness: lerp(0.03, 0.16, urgency) * wave
  };
};

export const resolveVideoProgressIntroDuration = (phaseDuration: number) => {
  if (!Number.isFinite(phaseDuration) || phaseDuration <= 0) {
    return 0;
  }

  return resolveVideoPuzzleEntryDuration(phaseDuration);
};

export const resolveVideoProgressMotionState = ({
  mode,
  phase,
  phaseDuration,
  timeLeft
}: ResolveVideoProgressMotionInput): VideoProgressMotionState => {
  const safeDuration = Math.max(0, phaseDuration);
  const countdownRatio =
    safeDuration <= 0
      ? 0
      : clamp(timeLeft / Math.max(0.1, safeDuration), 0, 1);
  const phaseElapsed = clamp(safeDuration - timeLeft, 0, safeDuration);
  const pulseState =
    phase === 'showing' && safeDuration > 0
      ? resolveProgressPulseState(countdownRatio, phaseElapsed)
      : {
          pulseScale: 1,
          pulseGlowOpacity: 0,
          pulseOverlayOpacity: 0,
          pulseBrightness: 0
        };

  const baseState: VideoProgressMotionState = {
    fillRatio: countdownRatio,
    fillPercent: countdownRatio * 100,
    countdownRatio,
    sweepActive: false,
    sweepProgress: 0,
    sweepOpacity: 0,
    ...pulseState
  };

  if (phase !== 'showing' || mode === 'countdown' || safeDuration <= 0) {
    return baseState;
  }

  const introDuration = resolveVideoProgressIntroDuration(safeDuration);
  if (introDuration <= 0) {
    return baseState;
  }

  const introProgress = clamp(phaseElapsed / introDuration, 0, 1);

  if (mode === 'intro_fill') {
    if (phaseElapsed <= introDuration) {
      const fillRatio = smoothstep(introProgress);
      return {
        ...baseState,
        fillRatio,
        fillPercent: fillRatio * 100
      };
    }

    const remainingDuration = Math.max(0.001, safeDuration - introDuration);
    const drainProgress = clamp((phaseElapsed - introDuration) / remainingDuration, 0, 1);
    const fillRatio = 1 - smoothstep(drainProgress);
    return {
      ...baseState,
      fillRatio,
      fillPercent: fillRatio * 100
    };
  }

  const sweepProgress = smoothstep(introProgress);
  return {
    ...baseState,
    sweepActive: phaseElapsed < introDuration,
    sweepProgress,
    sweepOpacity: Math.sin(introProgress * Math.PI) * 0.22
  };
};
