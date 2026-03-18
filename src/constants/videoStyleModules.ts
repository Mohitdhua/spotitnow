import type {
  VideoHeaderStyle,
  VideoProgressStyle,
  VideoSceneCardStyle,
  VideoSettings,
  VideoTextStyle,
  VideoTimerStyle,
  VideoTransitionStyle
} from '../types';
import type { VideoPackagePresetDefinition } from './videoPackages';
import type { VisualTheme } from './videoThemes';
import {
  DESIGNER_TIMER_STYLE_DEFINITIONS,
  getDesignerTimerDimensions,
  isDesignerTimerStyle
} from '../utils/timerPackShared';

type RadiusToken = 'none' | 'sm' | 'md' | 'lg' | 'xl' | 'full';
type CanvasFontFamily = '"Arial Black", "Segoe UI", sans-serif' | '"Segoe UI", Arial, sans-serif' | '"Consolas", "Courier New", monospace' | '"Georgia", "Times New Roman", serif';
type TextTransformMode = 'upper' | 'lower' | 'none';
type TimerSurfaceTone = 'timer' | 'game' | 'header' | 'light' | 'glass' | 'completion';
export type TimerRenderFamily = 'chip' | 'screen' | 'split' | 'ticket' | 'flip' | 'ring' | 'sticker' | 'marquee' | 'frame' | 'dual';
export type TimerRenderLabelMode = 'none' | 'left' | 'top';
export type TimerRenderOrnament = 'none' | 'inset' | 'double' | 'midline' | 'cutout' | 'lights' | 'brackets' | 'burst' | 'chevron' | 'panel' | 'ring';
export type TimerRenderShadow = 'none' | 'offset' | 'glow';
type HeaderVariant = Exclude<VideoHeaderStyle, 'package'>;
type TimerVariant = Exclude<VideoTimerStyle, 'package'>;
type ProgressVariant = Exclude<VideoProgressStyle, 'package'>;
type SceneCardVariant = Exclude<VideoSceneCardStyle, 'package'>;

export interface VideoStyleOption<T extends string> {
  value: T;
  label: string;
  description: string;
}

export interface ResolvedVideoTextStyle {
  id: VideoTextStyle;
  titleFontClass: string;
  subtitleFontClass: string;
  titleCanvasFamily: CanvasFontFamily;
  subtitleCanvasFamily: CanvasFontFamily;
  titleCanvasWeight: number;
  subtitleCanvasWeight: number;
  titleLetterSpacingEm: number;
  subtitleLetterSpacingEm: number;
  titleTransform: TextTransformMode;
  subtitleTransform: TextTransformMode;
}

export interface ResolvedVideoHeaderStyle {
  id: VideoHeaderStyle;
  variant: HeaderVariant;
}

export interface ResolvedVideoTimerStyle {
  id: VideoTimerStyle;
  variant: TimerVariant;
  shapeClass: string;
  textClass: string;
  canvasFontFamily: CanvasFontFamily;
  canvasFontWeight: number;
  radiusToken: RadiusToken;
  dotKind: 'circle' | 'bar' | 'spark' | 'none';
  paddingScale: number;
  minWidthScale: number;
  surfaceTone: TimerSurfaceTone;
}

export interface TimerRenderProfile {
  family: TimerRenderFamily;
  labelMode: TimerRenderLabelMode;
  labelText: string;
  ornament: TimerRenderOrnament;
  shadow: TimerRenderShadow;
  tiltDeg: number;
}

export interface TimerBoxMetricsInput {
  textWidth: number;
  fontSize: number;
  padX: number;
  padY: number;
  dotSize: number;
  gap: number;
  minWidth: number;
}

export interface TimerBoxMetrics {
  width: number;
  height: number;
  indicatorWidth: number;
}

export interface ResolvedVideoProgressStyle {
  id: VideoProgressStyle;
  variant: ProgressVariant;
  trackClass: string;
  radiusToken: RadiusToken;
  borderWidthScale: number;
}

export interface ResolvedVideoTransitionStyle {
  id: VideoTransitionStyle;
  previewInitial: Record<string, string | number>;
  previewExit: Record<string, string | number>;
  activeScale: number;
  activeOpacityFloor: number;
  cardTranslateMultiplier: number;
  cardScaleBoost: number;
  cardGlowBoost: number;
}

export interface ResolvedVideoStyleModules {
  text: ResolvedVideoTextStyle;
  header: ResolvedVideoHeaderStyle;
  timer: ResolvedVideoTimerStyle;
  progress: ResolvedVideoProgressStyle;
  sceneCards: {
    intro: SceneCardVariant;
    transition: SceneCardVariant;
    outro: SceneCardVariant;
  };
  transition: ResolvedVideoTransitionStyle;
}

const resolveCanvasFontFamily = (className: string, fallback: CanvasFontFamily): CanvasFontFamily => {
  if (className.includes('font-mono')) return '"Consolas", "Courier New", monospace';
  if (className.includes('font-serif')) return '"Georgia", "Times New Roman", serif';
  if (className.includes('font-sans')) return '"Segoe UI", Arial, sans-serif';
  if (className.includes('font-display')) return '"Arial Black", "Segoe UI", sans-serif';
  return fallback;
};

const resolveRadiusTokenFromClass = (className: string): RadiusToken => {
  if (className.includes('rounded-none')) return 'none';
  if (className.includes('rounded-sm')) return 'sm';
  if (className.includes('rounded-md')) return 'md';
  if (className.includes('rounded-lg')) return 'lg';
  if (className.includes('rounded-2xl') || className.includes('rounded-xl')) return 'xl';
  return 'full';
};

const resolveSceneCardVariant = (
  requestedStyle: VideoSceneCardStyle,
  fallbackVariant: SceneCardVariant
): SceneCardVariant => (requestedStyle === 'package' ? fallbackVariant : requestedStyle);

export const VIDEO_TEXT_STYLE_OPTIONS: Array<VideoStyleOption<VideoTextStyle>> = [
  { value: 'package', label: 'Package Default', description: 'Use the selected package fonts and pacing.' },
  { value: 'poster', label: 'Poster Bold', description: 'Loud display headline with clean supporting copy.' },
  { value: 'rounded', label: 'Rounded Play', description: 'Friendlier softer type for playful puzzle videos.' },
  { value: 'mono', label: 'Digital Mono', description: 'Arcade-style monospace labels and countdowns.' },
  { value: 'storybook', label: 'Story Serif', description: 'Warm serif copy for cozy editorial or story themes.' },
  { value: 'editorial', label: 'Editorial Mix', description: 'Display title with restrained mono subtitles.' }
];

export const VIDEO_HEADER_STYLE_OPTIONS: Array<VideoStyleOption<VideoHeaderStyle>> = [
  { value: 'package', label: 'Package Default', description: 'Keep the selected package header treatment.' },
  { value: 'plain', label: 'Plain', description: 'Simple title block with no extra framing.' },
  { value: 'panel', label: 'Panel', description: 'Rounded framed header chip behind the title stack.' },
  { value: 'ribbon', label: 'Ribbon', description: 'Banner-style title block with a stronger accent edge.' },
  { value: 'split', label: 'Split', description: 'Keep the title plain and turn the subtitle into a badge.' },
  { value: 'underline', label: 'Underline', description: 'Title stays open with a small accent rule below it.' }
];

type TimerStyleLibraryEntry = {
  value: TimerVariant;
  label: string;
  description: string;
  preset: Omit<ResolvedVideoTimerStyle, 'id'>;
};

const TIMER_STYLE_LIBRARY: TimerStyleLibraryEntry[] = [
  { value: 'pill', label: 'Pill', description: 'Rounded scoreboard chip with the classic dot timer.', preset: { variant: 'pill', shapeClass: 'rounded-full', textClass: 'font-mono font-bold', canvasFontFamily: '"Consolas", "Courier New", monospace', canvasFontWeight: 900, radiusToken: 'full', dotKind: 'circle', paddingScale: 1, minWidthScale: 1, surfaceTone: 'timer' } },
  { value: 'digital', label: 'Digital', description: 'Monospace HUD timer with a tighter angular shell.', preset: { variant: 'digital', shapeClass: 'rounded-md', textClass: 'font-mono font-black tracking-[0.16em]', canvasFontFamily: '"Consolas", "Courier New", monospace', canvasFontWeight: 900, radiusToken: 'md', dotKind: 'bar', paddingScale: 0.92, minWidthScale: 1.02, surfaceTone: 'game' } },
  { value: 'chunky', label: 'Chunky', description: 'Bigger softer timer built to feel toy-like and bold.', preset: { variant: 'chunky', shapeClass: 'rounded-2xl', textClass: 'font-display font-black', canvasFontFamily: '"Arial Black", "Segoe UI", sans-serif', canvasFontWeight: 900, radiusToken: 'xl', dotKind: 'spark', paddingScale: 1.16, minWidthScale: 1.08, surfaceTone: 'header' } },
  { value: 'ticket', label: 'Ticket', description: 'Badge-style timer with a framed ticket silhouette.', preset: { variant: 'ticket', shapeClass: 'rounded-lg', textClass: 'font-mono font-bold tracking-[0.12em]', canvasFontFamily: '"Consolas", "Courier New", monospace', canvasFontWeight: 800, radiusToken: 'lg', dotKind: 'circle', paddingScale: 1.06, minWidthScale: 1.04, surfaceTone: 'header' } },
  { value: 'minimal', label: 'Minimal', description: 'Cleaner low-noise timer with reduced ornament.', preset: { variant: 'minimal', shapeClass: 'rounded-full', textClass: 'font-sans font-semibold tracking-wide', canvasFontFamily: '"Segoe UI", Arial, sans-serif', canvasFontWeight: 700, radiusToken: 'full', dotKind: 'none', paddingScale: 0.86, minWidthScale: 0.94, surfaceTone: 'light' } },
  { value: 'capsule', label: 'Capsule', description: 'Soft wide capsule with stronger headline weight.', preset: { variant: 'capsule', shapeClass: 'rounded-full', textClass: 'font-sans font-black tracking-wide', canvasFontFamily: '"Segoe UI", Arial, sans-serif', canvasFontWeight: 900, radiusToken: 'full', dotKind: 'circle', paddingScale: 1.05, minWidthScale: 1.05, surfaceTone: 'header' } },
  { value: 'scoreboard', label: 'Scoreboard', description: 'Broadcast badge that feels more like a score tile.', preset: { variant: 'scoreboard', shapeClass: 'rounded-md', textClass: 'font-display font-black tracking-wide', canvasFontFamily: '"Arial Black", "Segoe UI", sans-serif', canvasFontWeight: 900, radiusToken: 'md', dotKind: 'none', paddingScale: 1.08, minWidthScale: 1.12, surfaceTone: 'completion' } },
  { value: 'beacon', label: 'Beacon', description: 'Compact chip with a pulsing sparkle accent.', preset: { variant: 'beacon', shapeClass: 'rounded-full', textClass: 'font-sans font-black tracking-wide', canvasFontFamily: '"Segoe UI", Arial, sans-serif', canvasFontWeight: 900, radiusToken: 'full', dotKind: 'spark', paddingScale: 1.02, minWidthScale: 1, surfaceTone: 'completion' } },
  { value: 'retro_flip', label: 'Retro Flip', description: 'Cabinet-style timer with a harder squared face.', preset: { variant: 'retro_flip', shapeClass: 'rounded-none', textClass: 'font-mono font-black tracking-[0.18em]', canvasFontFamily: '"Consolas", "Courier New", monospace', canvasFontWeight: 900, radiusToken: 'none', dotKind: 'bar', paddingScale: 0.94, minWidthScale: 1.08, surfaceTone: 'game' } },
  { value: 'neon_chip', label: 'Neon Chip', description: 'Arcade-like timer chip that reads tighter and brighter.', preset: { variant: 'neon_chip', shapeClass: 'rounded-md', textClass: 'font-display font-black tracking-[0.08em]', canvasFontFamily: '"Arial Black", "Segoe UI", sans-serif', canvasFontWeight: 900, radiusToken: 'md', dotKind: 'bar', paddingScale: 0.98, minWidthScale: 1.04, surfaceTone: 'game' } },
  { value: 'sticker', label: 'Sticker', description: 'Rounded sticker timer for playful creator styles.', preset: { variant: 'sticker', shapeClass: 'rounded-2xl', textClass: 'font-sans font-black', canvasFontFamily: '"Segoe UI", Arial, sans-serif', canvasFontWeight: 900, radiusToken: 'xl', dotKind: 'circle', paddingScale: 1.14, minWidthScale: 1, surfaceTone: 'completion' } },
  { value: 'jelly', label: 'Jelly', description: 'Squishy candy-like timer with softer playful weight.', preset: { variant: 'jelly', shapeClass: 'rounded-2xl', textClass: 'font-sans font-black tracking-[0.06em]', canvasFontFamily: '"Segoe UI", Arial, sans-serif', canvasFontWeight: 900, radiusToken: 'xl', dotKind: 'spark', paddingScale: 1.1, minWidthScale: 1.02, surfaceTone: 'glass' } },
  { value: 'marquee', label: 'Marquee', description: 'Show-card timer with a punchier display face.', preset: { variant: 'marquee', shapeClass: 'rounded-lg', textClass: 'font-display font-black tracking-[0.1em]', canvasFontFamily: '"Arial Black", "Segoe UI", sans-serif', canvasFontWeight: 900, radiusToken: 'lg', dotKind: 'spark', paddingScale: 1.12, minWidthScale: 1.1, surfaceTone: 'header' } },
  { value: 'glass', label: 'Glass', description: 'Clearer airy pill for lower-noise polished edits.', preset: { variant: 'glass', shapeClass: 'rounded-full', textClass: 'font-sans font-bold tracking-wide', canvasFontFamily: '"Segoe UI", Arial, sans-serif', canvasFontWeight: 700, radiusToken: 'full', dotKind: 'none', paddingScale: 0.98, minWidthScale: 1, surfaceTone: 'glass' } },
  { value: 'notched', label: 'Notched', description: 'Squared timer that feels sharper and utility-first.', preset: { variant: 'notched', shapeClass: 'rounded-none', textClass: 'font-sans font-black tracking-wide', canvasFontFamily: '"Segoe UI", Arial, sans-serif', canvasFontWeight: 900, radiusToken: 'none', dotKind: 'circle', paddingScale: 0.96, minWidthScale: 1.02, surfaceTone: 'header' } },
  { value: 'orbital', label: 'Orbital', description: 'Spacey mono timer with slightly wider framing.', preset: { variant: 'orbital', shapeClass: 'rounded-full', textClass: 'font-mono font-black tracking-[0.14em]', canvasFontFamily: '"Consolas", "Courier New", monospace', canvasFontWeight: 900, radiusToken: 'full', dotKind: 'circle', paddingScale: 1, minWidthScale: 1.1, surfaceTone: 'game' } },
  { value: 'bracelet', label: 'Bracelet', description: 'Slim loop-like timer that sits lightly in the HUD.', preset: { variant: 'bracelet', shapeClass: 'rounded-full', textClass: 'font-sans font-semibold tracking-[0.12em]', canvasFontFamily: '"Segoe UI", Arial, sans-serif', canvasFontWeight: 700, radiusToken: 'full', dotKind: 'none', paddingScale: 0.82, minWidthScale: 0.88, surfaceTone: 'light' } },
  { value: 'tab', label: 'Tab', description: 'Compact tabbed timer with a shorter footprint.', preset: { variant: 'tab', shapeClass: 'rounded-2xl', textClass: 'font-sans font-black tracking-[0.08em]', canvasFontFamily: '"Segoe UI", Arial, sans-serif', canvasFontWeight: 900, radiusToken: 'xl', dotKind: 'bar', paddingScale: 0.96, minWidthScale: 0.96, surfaceTone: 'header' } },
  { value: 'soft_block', label: 'Soft Block', description: 'Padded timer block with a calmer creator feel.', preset: { variant: 'soft_block', shapeClass: 'rounded-xl', textClass: 'font-sans font-black', canvasFontFamily: '"Segoe UI", Arial, sans-serif', canvasFontWeight: 900, radiusToken: 'xl', dotKind: 'none', paddingScale: 1.08, minWidthScale: 1.02, surfaceTone: 'light' } },
  { value: 'badge', label: 'Badge', description: 'Small winner-badge treatment for short-form edits.', preset: { variant: 'badge', shapeClass: 'rounded-lg', textClass: 'font-display font-black tracking-wide', canvasFontFamily: '"Arial Black", "Segoe UI", sans-serif', canvasFontWeight: 900, radiusToken: 'lg', dotKind: 'circle', paddingScale: 1.04, minWidthScale: 0.98, surfaceTone: 'completion' } },
  { value: 'micro', label: 'Micro', description: 'Tiny compact timer for minimal HUD compositions.', preset: { variant: 'micro', shapeClass: 'rounded-full', textClass: 'font-mono font-bold tracking-[0.2em]', canvasFontFamily: '"Consolas", "Courier New", monospace', canvasFontWeight: 700, radiusToken: 'full', dotKind: 'none', paddingScale: 0.74, minWidthScale: 0.8, surfaceTone: 'timer' } },
  { value: 'terminal', label: 'Terminal', description: 'Terminal readout with a harder utilitarian face.', preset: { variant: 'terminal', shapeClass: 'rounded-none', textClass: 'font-mono font-bold tracking-[0.22em]', canvasFontFamily: '"Consolas", "Courier New", monospace', canvasFontWeight: 800, radiusToken: 'none', dotKind: 'bar', paddingScale: 0.84, minWidthScale: 1.02, surfaceTone: 'game' } },
  { value: 'ticket_stub', label: 'Ticket Stub', description: 'Shorter ticket timer with tighter framing.', preset: { variant: 'ticket_stub', shapeClass: 'rounded-md', textClass: 'font-mono font-bold tracking-[0.1em]', canvasFontFamily: '"Consolas", "Courier New", monospace', canvasFontWeight: 800, radiusToken: 'md', dotKind: 'circle', paddingScale: 1, minWidthScale: 1.02, surfaceTone: 'header' } },
  { value: 'chevron', label: 'Chevron', description: 'Fast feeling timer chip with a brighter accent pulse.', preset: { variant: 'chevron', shapeClass: 'rounded-md', textClass: 'font-sans font-black tracking-[0.14em]', canvasFontFamily: '"Segoe UI", Arial, sans-serif', canvasFontWeight: 900, radiusToken: 'md', dotKind: 'spark', paddingScale: 0.98, minWidthScale: 1.06, surfaceTone: 'completion' } },
  { value: 'burst', label: 'Burst', description: 'Party-like timer with more playful impact.', preset: { variant: 'burst', shapeClass: 'rounded-2xl', textClass: 'font-display font-black tracking-[0.06em]', canvasFontFamily: '"Arial Black", "Segoe UI", sans-serif', canvasFontWeight: 900, radiusToken: 'xl', dotKind: 'spark', paddingScale: 1.18, minWidthScale: 1.08, surfaceTone: 'header' } },
  { value: 'frame', label: 'Frame', description: 'Framed numeric timer with almost no ornament.', preset: { variant: 'frame', shapeClass: 'rounded-none', textClass: 'font-sans font-bold tracking-[0.18em]', canvasFontFamily: '"Segoe UI", Arial, sans-serif', canvasFontWeight: 700, radiusToken: 'none', dotKind: 'none', paddingScale: 0.92, minWidthScale: 1.1, surfaceTone: 'light' } },
  { value: 'lozenge', label: 'Lozenge', description: 'Elegant lozenge timer for softer polished themes.', preset: { variant: 'lozenge', shapeClass: 'rounded-full', textClass: 'font-serif font-black', canvasFontFamily: '"Georgia", "Times New Roman", serif', canvasFontWeight: 900, radiusToken: 'full', dotKind: 'circle', paddingScale: 1.06, minWidthScale: 1.12, surfaceTone: 'header' } },
  { value: 'capsule_duo', label: 'Capsule Duo', description: 'Layered capsule look with a more rhythmic read.', preset: { variant: 'capsule_duo', shapeClass: 'rounded-full', textClass: 'font-sans font-black tracking-wide', canvasFontFamily: '"Segoe UI", Arial, sans-serif', canvasFontWeight: 900, radiusToken: 'full', dotKind: 'bar', paddingScale: 1.02, minWidthScale: 1.08, surfaceTone: 'completion' } },
  { value: 'racer', label: 'Racer', description: 'Longer strip timer built for quicker pacing.', preset: { variant: 'racer', shapeClass: 'rounded-none', textClass: 'font-display font-black tracking-[0.12em]', canvasFontFamily: '"Arial Black", "Segoe UI", sans-serif', canvasFontWeight: 900, radiusToken: 'none', dotKind: 'bar', paddingScale: 0.9, minWidthScale: 1.14, surfaceTone: 'game' } },
  { value: 'slab', label: 'Slab', description: 'Heavier slab timer with a bold countdown block.', preset: { variant: 'slab', shapeClass: 'rounded-md', textClass: 'font-display font-black tracking-[0.04em]', canvasFontFamily: '"Arial Black", "Segoe UI", sans-serif', canvasFontWeight: 900, radiusToken: 'md', dotKind: 'none', paddingScale: 1.1, minWidthScale: 1.1, surfaceTone: 'timer' } },
  ...DESIGNER_TIMER_STYLE_DEFINITIONS.map((definition) => ({
    value: definition.id,
    label: definition.label,
    description: definition.description,
    preset: {
      variant: definition.id,
      shapeClass: definition.widthFactor > 1.4 ? 'rounded-xl' : 'rounded-full',
      textClass: 'font-display font-black tracking-[0.04em]',
      canvasFontFamily: '"Arial Black", "Segoe UI", sans-serif' as const,
      canvasFontWeight: 900,
      radiusToken: definition.widthFactor > 1.4 ? ('xl' as const) : ('full' as const),
      dotKind: 'none' as const,
      paddingScale: 1,
      minWidthScale: 1,
      surfaceTone: 'timer' as const
    }
  }))
];

const TIMER_STYLE_PRESET_MAP = Object.fromEntries(
  TIMER_STYLE_LIBRARY.map((entry) => [entry.value, entry.preset])
) as Record<TimerVariant, Omit<ResolvedVideoTimerStyle, 'id'>>;

export const VIDEO_TIMER_STYLE_OPTIONS: Array<VideoStyleOption<VideoTimerStyle>> = [
  { value: 'package', label: 'Package Default', description: 'Use the package timer shape and type pairing.' },
  ...TIMER_STYLE_LIBRARY.map(({ value, label, description }) => ({ value, label, description }))
];

export const VIDEO_PROGRESS_STYLE_OPTIONS: Array<VideoStyleOption<VideoProgressStyle>> = [
  { value: 'package', label: 'Package Default', description: 'Use the package progress rail and fill treatment.' },
  { value: 'pill', label: 'Pill', description: 'Smooth rounded progress capsule with theme gradients.' },
  { value: 'segmented', label: 'Segmented', description: 'Game-show style striped fill for more energy.' },
  { value: 'blocks', label: 'Blocks', description: 'Chunky stepped meter with bolder visual rhythm.' },
  { value: 'glow', label: 'Glow', description: 'Accent-heavy rail with brighter reactive fill.' },
  { value: 'minimal', label: 'Minimal', description: 'Slim understated progress rail with one accent tone.' },
  {
    value: 'text_fill',
    label: 'Text Fill',
    description: 'Turns your progress phrase into a draining text-shaped progress meter.'
  }
];

export const VIDEO_SCENE_CARD_STYLE_OPTIONS: Array<VideoStyleOption<VideoSceneCardStyle>> = [
  { value: 'package', label: 'Package Default', description: 'Use the intro, transition, or outro card from the package.' },
  { value: 'standard', label: 'Standard', description: 'Bright neutral card with simple framing.' },
  { value: 'scoreboard', label: 'Scoreboard', description: 'Broadcast-style dark card with HUD glow.' },
  { value: 'storybook', label: 'Storybook', description: 'Warm illustrated card with golden trim.' },
  { value: 'spotlight', label: 'Spotlight', description: 'Dimmer cinematic card that feels stage-lit.' },
  { value: 'celebration', label: 'Celebration', description: 'Higher-energy party card with brighter accents.' }
];

export const VIDEO_TRANSITION_STYLE_OPTIONS: Array<VideoStyleOption<VideoTransitionStyle>> = [
  { value: 'fade', label: 'Fade', description: 'Soft dissolve between puzzle scenes.' },
  { value: 'slide', label: 'Slide', description: 'Move the puzzle panels laterally into place.' },
  { value: 'zoom', label: 'Zoom', description: 'Push the scene in and out for more depth.' },
  { value: 'pop', label: 'Pop', description: 'Bounce into the next scene with more energy.' },
  { value: 'wipe', label: 'Wipe', description: 'Sharper directional motion for faster pacing.' },
  { value: 'none', label: 'None', description: 'Disable extra puzzle motion during transitions.' }
];

export const applyTextTransform = (text: string, mode: TextTransformMode) => {
  if (mode === 'upper') return text.toUpperCase();
  if (mode === 'lower') return text.toLowerCase();
  return text;
};

export const radiusTokenToClass = (radiusToken: RadiusToken) => {
  if (radiusToken === 'none') return 'rounded-none';
  if (radiusToken === 'sm') return 'rounded-sm';
  if (radiusToken === 'md') return 'rounded-md';
  if (radiusToken === 'lg') return 'rounded-lg';
  if (radiusToken === 'xl') return 'rounded-2xl';
  return 'rounded-full';
};

export const radiusTokenToPx = (radiusToken: RadiusToken, height: number, scale = 1) => {
  if (radiusToken === 'none') return 0;
  if (radiusToken === 'sm') return Math.round(5 * scale);
  if (radiusToken === 'md') return Math.round(8 * scale);
  if (radiusToken === 'lg') return Math.round(10 * scale);
  if (radiusToken === 'xl') return Math.round(14 * scale);
  return Math.round(height / 2);
};

export const buildTimerBackground = (
  style: ResolvedVideoTimerStyle,
  visualTheme: VisualTheme
) => {
  if (style.surfaceTone === 'game') {
    return visualTheme.gameBg;
  }
  if (style.surfaceTone === 'header') {
    return visualTheme.headerBg;
  }
  if (style.surfaceTone === 'light') {
    return 'linear-gradient(180deg, #FFFFFF 0%, #F8FAFC 100%)';
  }
  if (style.surfaceTone === 'glass') {
    return 'linear-gradient(180deg, rgba(255,255,255,0.86) 0%, rgba(255,255,255,0.62) 100%)';
  }
  if (style.surfaceTone === 'completion') {
    return visualTheme.completionBg;
  }
  return visualTheme.timerBg;
};

export const buildProgressFillDefinition = (
  style: ResolvedVideoProgressStyle,
  visualTheme: VisualTheme
) => {
  if (style.variant === 'minimal') {
    return `linear-gradient(90deg, ${visualTheme.timerDot} 0%, ${visualTheme.timerDot} 100%)`;
  }
  if (style.variant === 'segmented') {
    return `repeating-linear-gradient(90deg, ${visualTheme.headerBg} 0 14px, ${visualTheme.timerDot} 14px 24px, ${visualTheme.completionBg} 24px 34px)`;
  }
  if (style.variant === 'blocks') {
    return `repeating-linear-gradient(90deg, ${visualTheme.timerDot} 0 18px, ${visualTheme.headerBg} 18px 22px, ${visualTheme.progressTrackBg} 22px 34px, ${visualTheme.completionBg} 34px 38px)`;
  }
  if (style.variant === 'glow') {
    return `linear-gradient(90deg, ${visualTheme.headerBg} 0%, ${visualTheme.timerDot} 52%, ${visualTheme.completionBg} 100%)`;
  }
  if (style.variant === 'text_fill') {
    return `linear-gradient(90deg, ${visualTheme.timerDot} 0%, ${visualTheme.headerBg} 55%, ${visualTheme.completionBg} 100%)`;
  }
  return visualTheme.progressFill;
};

export const resolveTimerRenderProfile = (
  style: Pick<ResolvedVideoTimerStyle, 'id' | 'variant'>
): TimerRenderProfile => {
  switch (style.id) {
    case 'package':
    case 'pill':
      return { family: 'chip', labelMode: 'none', labelText: '', ornament: 'none', shadow: 'none', tiltDeg: 0 };
    case 'digital':
      return { family: 'screen', labelMode: 'left', labelText: 'SEC', ornament: 'inset', shadow: 'none', tiltDeg: 0 };
    case 'chunky':
      return { family: 'sticker', labelMode: 'none', labelText: '', ornament: 'burst', shadow: 'offset', tiltDeg: -1.5 };
    case 'ticket':
      return { family: 'ticket', labelMode: 'left', labelText: 'TIME', ornament: 'cutout', shadow: 'none', tiltDeg: 0 };
    case 'minimal':
      return { family: 'frame', labelMode: 'none', labelText: '', ornament: 'brackets', shadow: 'none', tiltDeg: 0 };
    case 'capsule':
      return { family: 'dual', labelMode: 'none', labelText: '', ornament: 'double', shadow: 'none', tiltDeg: 0 };
    case 'scoreboard':
      return { family: 'split', labelMode: 'left', labelText: 'TIME', ornament: 'panel', shadow: 'offset', tiltDeg: 0 };
    case 'beacon':
      return { family: 'split', labelMode: 'top', labelText: 'LIVE', ornament: 'panel', shadow: 'glow', tiltDeg: 0 };
    case 'retro_flip':
      return { family: 'flip', labelMode: 'top', labelText: 'COUNT', ornament: 'midline', shadow: 'none', tiltDeg: 0 };
    case 'neon_chip':
      return { family: 'screen', labelMode: 'left', labelText: 'TMR', ornament: 'double', shadow: 'glow', tiltDeg: 0 };
    case 'sticker':
      return { family: 'sticker', labelMode: 'top', labelText: 'GO', ornament: 'double', shadow: 'offset', tiltDeg: -1 };
    case 'jelly':
      return { family: 'sticker', labelMode: 'none', labelText: '', ornament: 'burst', shadow: 'offset', tiltDeg: 1.2 };
    case 'marquee':
      return { family: 'marquee', labelMode: 'top', labelText: 'COUNTDOWN', ornament: 'lights', shadow: 'glow', tiltDeg: 0 };
    case 'glass':
      return { family: 'screen', labelMode: 'none', labelText: '', ornament: 'inset', shadow: 'none', tiltDeg: 0 };
    case 'notched':
      return { family: 'frame', labelMode: 'none', labelText: '', ornament: 'brackets', shadow: 'none', tiltDeg: 0 };
    case 'orbital':
      return { family: 'ring', labelMode: 'top', labelText: 'TIME', ornament: 'ring', shadow: 'glow', tiltDeg: 0 };
    case 'bracelet':
      return { family: 'ring', labelMode: 'top', labelText: 'SEC', ornament: 'double', shadow: 'none', tiltDeg: 0 };
    case 'tab':
      return { family: 'split', labelMode: 'top', labelText: 'TIME', ornament: 'panel', shadow: 'offset', tiltDeg: 0 };
    case 'soft_block':
      return { family: 'screen', labelMode: 'none', labelText: '', ornament: 'inset', shadow: 'none', tiltDeg: 0 };
    case 'badge':
      return { family: 'sticker', labelMode: 'top', labelText: 'TIME', ornament: 'double', shadow: 'offset', tiltDeg: 0 };
    case 'micro':
      return { family: 'frame', labelMode: 'none', labelText: '', ornament: 'double', shadow: 'none', tiltDeg: 0 };
    case 'terminal':
      return { family: 'frame', labelMode: 'left', labelText: 'TMR', ornament: 'brackets', shadow: 'none', tiltDeg: 0 };
    case 'ticket_stub':
      return { family: 'ticket', labelMode: 'left', labelText: 'PASS', ornament: 'cutout', shadow: 'none', tiltDeg: 0 };
    case 'chevron':
      return { family: 'split', labelMode: 'left', labelText: 'GO', ornament: 'chevron', shadow: 'offset', tiltDeg: 0 };
    case 'burst':
      return { family: 'sticker', labelMode: 'none', labelText: '', ornament: 'burst', shadow: 'offset', tiltDeg: -2 };
    case 'frame':
      return { family: 'frame', labelMode: 'none', labelText: '', ornament: 'brackets', shadow: 'none', tiltDeg: 0 };
    case 'lozenge':
      return { family: 'dual', labelMode: 'none', labelText: '', ornament: 'double', shadow: 'none', tiltDeg: 0 };
    case 'capsule_duo':
      return { family: 'dual', labelMode: 'left', labelText: 'TIME', ornament: 'double', shadow: 'none', tiltDeg: 0 };
    case 'racer':
      return { family: 'split', labelMode: 'left', labelText: 'LAP', ornament: 'chevron', shadow: 'glow', tiltDeg: 0 };
    case 'slab':
      return { family: 'split', labelMode: 'top', labelText: 'COUNT', ornament: 'panel', shadow: 'none', tiltDeg: 0 };
    default:
      return { family: 'chip', labelMode: 'none', labelText: '', ornament: 'none', shadow: 'none', tiltDeg: 0 };
  }
};

export const measureResolvedTimerBox = (
  style: Pick<ResolvedVideoTimerStyle, 'id' | 'variant' | 'dotKind' | 'paddingScale' | 'minWidthScale'>,
  input: TimerBoxMetricsInput
): TimerBoxMetrics => {
  if (isDesignerTimerStyle(style.id)) {
    const size = Math.max(
      48,
      Math.round(
        Math.max(
          input.fontSize * 2.15,
          input.dotSize * 4.5,
          input.padY * 2 + input.fontSize + 18
        )
      )
    );
    const dimensions = getDesignerTimerDimensions(style.id, size);
    return {
      width: dimensions.width,
      height: dimensions.height,
      indicatorWidth: 0
    };
  }

  const profile = resolveTimerRenderProfile(style);
  const indicatorWidth =
    style.dotKind === 'none'
      ? 0
      : style.dotKind === 'bar'
      ? Math.round(input.dotSize * 1.45)
      : input.dotSize;
  const baseWidth = Math.max(
    Math.round(input.minWidth * style.minWidthScale),
    Math.ceil(
      input.padX * 2 +
        input.textWidth +
        (style.dotKind === 'none' ? 0 : indicatorWidth + input.gap)
    )
  );
  let width = baseWidth;
  let height = Math.max(
    Math.round(input.fontSize + input.padY * 2 + 2),
    Math.round(input.dotSize + input.padY * 2 + 2)
  );

  switch (profile.family) {
    case 'screen':
      width += Math.round(input.fontSize * 0.82);
      height += Math.round(input.fontSize * 0.16);
      break;
    case 'split':
      width += Math.round(input.fontSize * (profile.labelMode === 'left' ? 1.55 : 0.5));
      height += profile.labelMode === 'top' ? Math.round(input.fontSize * 0.18) : 0;
      break;
    case 'ticket':
      width += Math.round(input.fontSize * 0.9);
      break;
    case 'flip':
      width += Math.round(input.fontSize * 0.48);
      height += Math.round(input.fontSize * 0.38);
      break;
    case 'ring': {
      const size = Math.max(
        Math.round(input.textWidth + input.padX * 2 + input.fontSize * 0.9),
        height + Math.round(input.fontSize * 0.9)
      );
      return {
        width: size,
        height: size,
        indicatorWidth: 0
      };
    }
    case 'sticker':
      width += Math.round(input.fontSize * 0.55);
      height += Math.round(input.fontSize * 0.22);
      break;
    case 'marquee':
      width += Math.round(input.fontSize * 1.2);
      height += Math.round(input.fontSize * 0.3);
      break;
    case 'frame':
      width += Math.round(input.fontSize * 0.32);
      break;
    case 'dual':
      width += Math.round(input.fontSize * (profile.labelMode === 'left' ? 1.25 : 0.9));
      height += Math.round(input.fontSize * 0.14);
      break;
    case 'chip':
    default:
      break;
  }

  return {
    width,
    height,
    indicatorWidth
  };
};

export const resolveVideoStyleModules = (
  settings: Pick<
    VideoSettings,
    | 'textStyle'
    | 'headerStyle'
    | 'timerStyle'
    | 'progressStyle'
    | 'introCardStyle'
    | 'transitionCardStyle'
    | 'outroCardStyle'
    | 'transitionStyle'
  >,
  packagePreset: Pick<
    VideoPackagePresetDefinition,
    'chrome' | 'introCardVariant' | 'transitionCardVariant' | 'outroCardVariant'
  >
): ResolvedVideoStyleModules => {
  const packageTitleFontClass = packagePreset.chrome.titleFontClass;
  const packageSubtitleFontClass = packagePreset.chrome.subtitleFontClass;
  const packageTimerShape = packagePreset.chrome.timerShapeClass;
  const packageTimerTextClass = packagePreset.chrome.timerTextClass;
  const packageProgressTrackClass = packagePreset.chrome.progressTrackClass;

  const text: ResolvedVideoTextStyle =
    settings.textStyle === 'package'
      ? {
          id: 'package',
          titleFontClass: packageTitleFontClass,
          subtitleFontClass: packageSubtitleFontClass,
          titleCanvasFamily: resolveCanvasFontFamily(packageTitleFontClass, '"Arial Black", "Segoe UI", sans-serif'),
          subtitleCanvasFamily: resolveCanvasFontFamily(packageSubtitleFontClass, '"Segoe UI", Arial, sans-serif'),
          titleCanvasWeight: 900,
          subtitleCanvasWeight: 700,
          titleLetterSpacingEm: 0.02,
          subtitleLetterSpacingEm: packagePreset.chrome.subtitleLetterSpacingEm,
          titleTransform: 'upper',
          subtitleTransform: 'upper'
        }
      : settings.textStyle === 'poster'
      ? {
          id: 'poster',
          titleFontClass: 'font-display',
          subtitleFontClass: 'font-sans',
          titleCanvasFamily: '"Arial Black", "Segoe UI", sans-serif',
          subtitleCanvasFamily: '"Segoe UI", Arial, sans-serif',
          titleCanvasWeight: 900,
          subtitleCanvasWeight: 800,
          titleLetterSpacingEm: 0.04,
          subtitleLetterSpacingEm: 0.22,
          titleTransform: 'upper',
          subtitleTransform: 'upper'
        }
      : settings.textStyle === 'rounded'
      ? {
          id: 'rounded',
          titleFontClass: 'font-sans',
          subtitleFontClass: 'font-sans',
          titleCanvasFamily: '"Segoe UI", Arial, sans-serif',
          subtitleCanvasFamily: '"Segoe UI", Arial, sans-serif',
          titleCanvasWeight: 900,
          subtitleCanvasWeight: 800,
          titleLetterSpacingEm: 0.015,
          subtitleLetterSpacingEm: 0.16,
          titleTransform: 'upper',
          subtitleTransform: 'upper'
        }
      : settings.textStyle === 'mono'
      ? {
          id: 'mono',
          titleFontClass: 'font-mono',
          subtitleFontClass: 'font-mono',
          titleCanvasFamily: '"Consolas", "Courier New", monospace',
          subtitleCanvasFamily: '"Consolas", "Courier New", monospace',
          titleCanvasWeight: 900,
          subtitleCanvasWeight: 700,
          titleLetterSpacingEm: 0.05,
          subtitleLetterSpacingEm: 0.24,
          titleTransform: 'upper',
          subtitleTransform: 'upper'
        }
      : settings.textStyle === 'storybook'
      ? {
          id: 'storybook',
          titleFontClass: 'font-serif',
          subtitleFontClass: 'font-serif',
          titleCanvasFamily: '"Georgia", "Times New Roman", serif',
          subtitleCanvasFamily: '"Georgia", "Times New Roman", serif',
          titleCanvasWeight: 900,
          subtitleCanvasWeight: 700,
          titleLetterSpacingEm: 0.01,
          subtitleLetterSpacingEm: 0.08,
          titleTransform: 'none',
          subtitleTransform: 'none'
        }
      : {
          id: 'editorial',
          titleFontClass: 'font-display',
          subtitleFontClass: 'font-mono',
          titleCanvasFamily: '"Arial Black", "Segoe UI", sans-serif',
          subtitleCanvasFamily: '"Consolas", "Courier New", monospace',
          titleCanvasWeight: 900,
          subtitleCanvasWeight: 700,
          titleLetterSpacingEm: 0.025,
          subtitleLetterSpacingEm: 0.28,
          titleTransform: 'upper',
          subtitleTransform: 'upper'
        };

  const header: ResolvedVideoHeaderStyle = {
    id: settings.headerStyle,
    variant: settings.headerStyle === 'package' ? 'plain' : settings.headerStyle
  };

  const timer: ResolvedVideoTimerStyle =
    settings.timerStyle === 'package'
      ? {
          id: 'package',
          variant: 'pill',
          shapeClass: packageTimerShape,
          textClass: packageTimerTextClass,
          canvasFontFamily: resolveCanvasFontFamily(packageTimerTextClass, '"Consolas", "Courier New", monospace'),
          canvasFontWeight: 900,
          radiusToken: resolveRadiusTokenFromClass(packageTimerShape),
          dotKind: 'circle',
          paddingScale: 1,
          minWidthScale: 1,
          surfaceTone: 'timer'
        }
      : {
          id: settings.timerStyle,
          ...TIMER_STYLE_PRESET_MAP[settings.timerStyle]
        };

  const progress: ResolvedVideoProgressStyle =
    settings.progressStyle === 'package'
      ? {
          id: 'package',
          variant: 'pill',
          trackClass: packageProgressTrackClass,
          radiusToken: resolveRadiusTokenFromClass(packageProgressTrackClass),
          borderWidthScale: 1
        }
      : settings.progressStyle === 'segmented'
      ? {
          id: 'segmented',
          variant: 'segmented',
          trackClass: 'rounded-full',
          radiusToken: 'full',
          borderWidthScale: 1
        }
      : settings.progressStyle === 'blocks'
      ? {
          id: 'blocks',
          variant: 'blocks',
          trackClass: 'rounded-md',
          radiusToken: 'md',
          borderWidthScale: 1.08
        }
      : settings.progressStyle === 'glow'
      ? {
          id: 'glow',
          variant: 'glow',
          trackClass: 'rounded-full',
          radiusToken: 'full',
          borderWidthScale: 1
        }
      : settings.progressStyle === 'minimal'
      ? {
          id: 'minimal',
          variant: 'minimal',
          trackClass: 'rounded-full',
          radiusToken: 'full',
          borderWidthScale: 0.82
        }
      : settings.progressStyle === 'text_fill'
      ? {
          id: 'text_fill',
          variant: 'text_fill',
          trackClass: 'rounded-none',
          radiusToken: 'none',
          borderWidthScale: 0
        }
      : {
          id: 'pill',
          variant: 'pill',
          trackClass: 'rounded-full',
          radiusToken: 'full',
          borderWidthScale: 1
        };

  const transition: ResolvedVideoTransitionStyle =
    settings.transitionStyle === 'slide'
      ? {
          id: 'slide',
          previewInitial: { x: '100%', opacity: 0 },
          previewExit: { x: '-100%', opacity: 0 },
          activeScale: 0.992,
          activeOpacityFloor: 1,
          cardTranslateMultiplier: 1.1,
          cardScaleBoost: 0.03,
          cardGlowBoost: 0.02
        }
      : settings.transitionStyle === 'zoom'
      ? {
          id: 'zoom',
          previewInitial: { scale: 0.9, opacity: 0 },
          previewExit: { scale: 1.08, opacity: 0 },
          activeScale: 0.958,
          activeOpacityFloor: 0.9,
          cardTranslateMultiplier: 0.7,
          cardScaleBoost: 0.09,
          cardGlowBoost: 0.08
        }
      : settings.transitionStyle === 'pop'
      ? {
          id: 'pop',
          previewInitial: { scale: 0.76, opacity: 0 },
          previewExit: { scale: 1.12, opacity: 0 },
          activeScale: 0.972,
          activeOpacityFloor: 0.94,
          cardTranslateMultiplier: 0.45,
          cardScaleBoost: 0.12,
          cardGlowBoost: 0.1
        }
      : settings.transitionStyle === 'wipe'
      ? {
          id: 'wipe',
          previewInitial: { x: '18%', opacity: 0, scale: 0.98 },
          previewExit: { x: '-18%', opacity: 0, scale: 0.98 },
          activeScale: 0.986,
          activeOpacityFloor: 0.92,
          cardTranslateMultiplier: 1.35,
          cardScaleBoost: 0.04,
          cardGlowBoost: 0.06
        }
      : settings.transitionStyle === 'none'
      ? {
          id: 'none',
          previewInitial: { x: 0, opacity: 1 },
          previewExit: { x: 0, opacity: 1 },
          activeScale: 1,
          activeOpacityFloor: 1,
          cardTranslateMultiplier: 0,
          cardScaleBoost: 0,
          cardGlowBoost: 0
        }
      : {
          id: 'fade',
          previewInitial: { opacity: 0 },
          previewExit: { opacity: 0 },
          activeScale: 1,
          activeOpacityFloor: 0.86,
          cardTranslateMultiplier: 0.8,
          cardScaleBoost: 0.02,
          cardGlowBoost: 0
        };

  return {
    text,
    header,
    timer,
    progress,
    sceneCards: {
      intro: resolveSceneCardVariant(settings.introCardStyle, packagePreset.introCardVariant),
      transition: resolveSceneCardVariant(settings.transitionCardStyle, packagePreset.transitionCardVariant),
      outro: resolveSceneCardVariant(settings.outroCardStyle, packagePreset.outroCardVariant)
    },
    transition
  };
};
