export interface VideoTransitionSequenceState {
  progress: number;
  outgoingOpacity: number;
  outgoingScale: number;
  overlayOpacity: number;
  titleProgress: number;
  titleOpacity: number;
  subtitleOpacity: number;
  titleTranslateY: number;
}

export interface VideoPuzzleEntryState {
  active: boolean;
  progress: number;
  opacity: number;
  scale: number;
}

export const VIDEO_TRANSITION_LABEL = 'NEXT PUZZLE';

interface ResolveTimedMotionInput {
  phaseDuration: number;
  timeLeft: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const smoothstep = (value: number) => value * value * (3 - 2 * value);
const easeOutBack = (value: number) => {
  const c1 = 1.35;
  const c3 = c1 + 1;
  const shifted = value - 1;
  return 1 + c3 * shifted * shifted * shifted + c1 * shifted * shifted;
};

const CONFIGURED_TRANSITION_ACTIVE_END_RATIO = 0.62;
const TYPEWRITER_START_RATIO = 0.18 / CONFIGURED_TRANSITION_ACTIVE_END_RATIO;
const TYPEWRITER_END_RATIO = 1;
const FADE_IN_RATIO = 0.3 / CONFIGURED_TRANSITION_ACTIVE_END_RATIO;
const TITLE_OPACITY_START_RATIO = 0.1 / CONFIGURED_TRANSITION_ACTIVE_END_RATIO;
const TITLE_OPACITY_RANGE_RATIO = 0.14 / CONFIGURED_TRANSITION_ACTIVE_END_RATIO;
const SUBTITLE_OPACITY_START_RATIO = 0.56 / CONFIGURED_TRANSITION_ACTIVE_END_RATIO;
const SUBTITLE_OPACITY_RANGE_RATIO = 0.18 / CONFIGURED_TRANSITION_ACTIVE_END_RATIO;
const TITLE_LIFT_START_RATIO = 0.12 / CONFIGURED_TRANSITION_ACTIVE_END_RATIO;
const TITLE_LIFT_RANGE_RATIO = 0.18 / CONFIGURED_TRANSITION_ACTIVE_END_RATIO;

export const resolveVideoTransitionTypewriterWindow = (phaseDuration: number) => {
  const safeDuration = Math.max(0, phaseDuration);
  return {
    start: safeDuration * TYPEWRITER_START_RATIO,
    end: safeDuration * TYPEWRITER_END_RATIO
  };
};

export const resolveVideoTransitionPhaseDuration = (phaseDuration: number) =>
  Math.max(0, phaseDuration) * CONFIGURED_TRANSITION_ACTIVE_END_RATIO;

export const countTypewriterGlyphs = (text: string) =>
  Array.from(text).reduce((count, character) => (character.trim().length > 0 ? count + 1 : count), 0);

export const revealTypewriterText = (text: string, progress: number) => {
  const glyphBudget = Math.ceil(countTypewriterGlyphs(text) * clamp(progress, 0, 1));
  let visibleGlyphs = 0;
  let output = '';

  for (const character of Array.from(text)) {
    const isGlyph = character.trim().length > 0;
    if (isGlyph && visibleGlyphs >= glyphBudget) {
      break;
    }
    output += character;
    if (isGlyph) {
      visibleGlyphs += 1;
    }
  }

  return {
    text: output,
    visibleGlyphs,
    totalGlyphs: countTypewriterGlyphs(text)
  };
};

export const resolveVideoTransitionSequenceState = ({
  phaseDuration,
  timeLeft
}: ResolveTimedMotionInput): VideoTransitionSequenceState => {
  const safeDuration = Math.max(0.001, phaseDuration);
  const progress = clamp((safeDuration - timeLeft) / safeDuration, 0, 1);
  const fadeProgress = smoothstep(clamp(progress / FADE_IN_RATIO, 0, 1));
  const titleProgress = smoothstep(clamp((progress - TYPEWRITER_START_RATIO) / (TYPEWRITER_END_RATIO - TYPEWRITER_START_RATIO), 0, 1));
  const titleOpacity = smoothstep(clamp((progress - TITLE_OPACITY_START_RATIO) / TITLE_OPACITY_RANGE_RATIO, 0, 1));
  const subtitleOpacity = smoothstep(
    clamp((progress - SUBTITLE_OPACITY_START_RATIO) / SUBTITLE_OPACITY_RANGE_RATIO, 0, 1)
  );
  const titleLift = 1 - smoothstep(clamp((progress - TITLE_LIFT_START_RATIO) / TITLE_LIFT_RANGE_RATIO, 0, 1));

  return {
    progress,
    outgoingOpacity: 1 - fadeProgress * 0.84,
    outgoingScale: 1 - fadeProgress * 0.035,
    overlayOpacity: 0.08 + fadeProgress * 0.28,
    titleProgress,
    titleOpacity,
    subtitleOpacity,
    titleTranslateY: titleLift * 24
  };
};

export const resolveVideoPuzzleEntryDuration = (phaseDuration: number) => {
  if (!Number.isFinite(phaseDuration) || phaseDuration <= 0) {
    return 0;
  }

  return clamp(Math.min(0.75, Math.max(0.42, phaseDuration * 0.14)), 0, phaseDuration);
};

export const resolveVideoPuzzleEntryState = ({
  phaseDuration,
  timeLeft
}: ResolveTimedMotionInput): VideoPuzzleEntryState => {
  const entryDuration = resolveVideoPuzzleEntryDuration(phaseDuration);
  if (entryDuration <= 0) {
    return {
      active: false,
      progress: 1,
      opacity: 1,
      scale: 1
    };
  }

  const progress = clamp((phaseDuration - timeLeft) / entryDuration, 0, 1);
  const opacity = smoothstep(clamp(progress / 0.5, 0, 1));
  const scale = 0.84 + 0.16 * easeOutBack(progress);

  return {
    active: progress < 1,
    progress,
    opacity,
    scale
  };
};
