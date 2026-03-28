import React, { useState, useEffect, useRef, useMemo, useId, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Pause, Play, SkipForward, RotateCcw, CheckCircle, Send } from 'lucide-react';
import { Puzzle, type VideoAudioCuePoolKey, VideoSettings } from '../types';
import { BASE_STAGE_SIZE, CLASSIC_HUD_SPEC, TRANSITION_TUNING } from '../constants/videoLayoutSpec';
import { type HudAnchorSpec } from '../constants/videoHudLayoutSpec';
import { resolveVideoLayoutSettings } from '../constants/videoLayoutCustom';
import { VIDEO_PACKAGE_PRESETS, resolvePackageImageArrangement } from '../constants/videoPackages';
import {
  applyTextTransform,
  buildProgressFillDefinition,
  radiusTokenToPx,
  resolveVideoStyleModules
} from '../constants/videoStyleModules';
import {
  PROGRESS_BAR_THEMES,
  resolveProgressBarFillColors,
  resolveProgressBarFillStyle
} from '../constants/progressBarThemes';
import { GeneratedBackgroundCanvas } from './GeneratedBackgroundCanvas';
import { VideoTimerDisplay } from './VideoTimerDisplay';
import { loadGeneratedBackgroundPacks } from '../services/backgroundPacks';
import { resolveGeneratedBackgroundForIndex } from '../services/generatedBackgrounds';
import { resolveVisualThemeStyle } from '../constants/videoThemes';
import { clampLogoZoom } from '../utils/logoProcessing';
import { createIsolatedVideoFramePreviewRenderer } from '../services/videoExport';
import { resolveSmoothTextProgressFillColors } from '../utils/textProgressFill';
import {
  resolveTextProgressBaseAccent,
  resolveTextProgressEffectFrame,
  resolveTextProgressShellStyle
} from '../utils/textProgressEffects';
import { resolveVideoProgressMotionState } from '../utils/videoProgressMotion';
import {
  revealTypewriterText,
  VIDEO_TRANSITION_LABEL,
  resolveVideoPuzzleEntryState,
  resolveVideoTransitionPhaseDuration,
  resolveVideoTransitionSequenceState
} from '../utils/videoTransitionMotion';
import { decodeAudioBufferFromSource } from '../utils/audioDecode';
import { useProcessedLogoSrc } from '../hooks/useProcessedLogoSrc';
import { loadVideoAssetBlob } from '../services/videoAssetStore';
import {
  VIDEO_AUDIO_CUE_POOL_MAX_VOLUME,
  VIDEO_AUDIO_POOL_KEYS,
  resolveVideoAudioCyclePoolIndex,
  resolveVideoAudioEventPoolIndex
} from '../utils/videoAudioPools';
import {
  resolveLowTimeWarningCueWindow,
  resolveProgressFillIntroCueWindow,
  resolvePuzzlePlayCueWindow,
  type VideoAudioPlaybackAutomation
} from '../utils/videoAudioCueScheduling';
import {
  clampFinalCommentPromptPosition,
  splitFinalCommentPromptIntoLines,
  shouldShowFinalCommentPrompt
} from '../utils/finalCommentPrompt';

type Phase = 'intro' | 'showing' | 'revealing' | 'transitioning' | 'outro' | 'finished';

export interface VideoPlayerExternalControlAction {
  kind: 'toggle-play' | 'skip' | 'replay';
  nonce: number;
}

export interface VideoPlayerPlaybackState {
  hasPuzzles: boolean;
  isPlaying: boolean;
  phase: Phase;
  puzzleIndex: number;
}

interface VideoPlayerProps {
  puzzles: Puzzle[];
  settings: VideoSettings;
  onExit: () => void;
  onSendToEditor?: () => void;
  embedded?: boolean;
  hidePlaybackControls?: boolean;
  externalControlAction?: VideoPlayerExternalControlAction | null;
  onPlaybackStateChange?: (state: VideoPlayerPlaybackState) => void;
  backgroundPacksSessionId?: number;
}

export interface VisualTheme {
  rootBg: string;
  headerBg: string;
  headerText: string;
  headerSubText: string;
  gameBg: string;
  imagePanelBg: string;
  patternColor: string;
  playHoverBg: string;
  skipHoverBg: string;
  timerBg: string;
  timerText: string;
  timerDot: string;
  timerBorder: string;
  timerShapeClass: string;
  timerTextClass: string;
  progressTrackBg: string;
  progressTrackBorder: string;
  progressTrackClass: string;
  progressFill: string;
  progressFillClass: string;
  progressFillGlow?: string;
  completionBg: string;
  completionIcon: string;
}

export const VISUAL_THEMES: Record<VideoSettings['visualStyle'], VisualTheme> = {
  random: {
    rootBg: '#FFFDF5',
    headerBg: '#FFD93D',
    headerText: '#000000',
    headerSubText: '#1F2937',
    gameBg: '#4ECDC4',
    imagePanelBg: '#E6F7F3',
    patternColor: '#000000',
    playHoverBg: '#4ECDC4',
    skipHoverBg: '#FFD93D',
    timerBg: '#000000',
    timerText: '#FFFFFF',
    timerDot: '#4ECDC4',
    timerBorder: '#000000',
    timerShapeClass: 'rounded-full',
    timerTextClass: 'font-mono font-bold',
    progressTrackBg: '#FFFFFF',
    progressTrackBorder: '#000000',
    progressTrackClass: 'rounded-full',
    progressFill: 'linear-gradient(90deg, #FF6B6B 0%, #FF8E53 100%)',
    progressFillClass: '',
    completionBg: '#FFD93D',
    completionIcon: '#4ECDC4'
  },
  classic: {
    rootBg: '#FFFDF5',
    headerBg: '#FFD93D',
    headerText: '#000000',
    headerSubText: '#1F2937',
    gameBg: '#4ECDC4',
    imagePanelBg: '#E6F7F3',
    patternColor: '#000000',
    playHoverBg: '#4ECDC4',
    skipHoverBg: '#FFD93D',
    timerBg: '#000000',
    timerText: '#FFFFFF',
    timerDot: '#4ECDC4',
    timerBorder: '#000000',
    timerShapeClass: 'rounded-full',
    timerTextClass: 'font-mono font-bold',
    progressTrackBg: '#FFFFFF',
    progressTrackBorder: '#000000',
    progressTrackClass: 'rounded-full',
    progressFill: 'linear-gradient(90deg, #FF6B6B 0%, #FF8E53 100%)',
    progressFillClass: '',
    completionBg: '#FFD93D',
    completionIcon: '#4ECDC4'
  },
  pop: {
    rootBg: '#FFF7E8',
    headerBg: '#FF8A5B',
    headerText: '#000000',
    headerSubText: '#1F2937',
    gameBg: '#FDE68A',
    imagePanelBg: '#FFF1D6',
    patternColor: '#1D4ED8',
    playHoverBg: '#FF8A5B',
    skipHoverBg: '#A7F3D0',
    timerBg: '#000000',
    timerText: '#FFEFD5',
    timerDot: '#FFD93D',
    timerBorder: '#000000',
    timerShapeClass: 'rounded-full',
    timerTextClass: 'font-mono font-bold',
    progressTrackBg: '#FFFFFF',
    progressTrackBorder: '#000000',
    progressTrackClass: 'rounded-full',
    progressFill: 'repeating-linear-gradient(45deg, #1D4ED8 0 8px, #3B82F6 8px 16px)',
    progressFillClass: '',
    completionBg: '#FF8A5B',
    completionIcon: '#4ECDC4'
  },
  neon: {
    rootBg: '#090B1A',
    headerBg: '#C4FF4D',
    headerText: '#111827',
    headerSubText: '#111827',
    gameBg: '#111827',
    imagePanelBg: '#060A16',
    patternColor: '#12F7FF',
    playHoverBg: '#12F7FF',
    skipHoverBg: '#F15BB5',
    timerBg: '#050510',
    timerText: '#12F7FF',
    timerDot: '#F15BB5',
    timerBorder: '#12F7FF',
    timerShapeClass: 'rounded-md',
    timerTextClass: 'font-mono font-black tracking-wide',
    progressTrackBg: '#0F172A',
    progressTrackBorder: '#12F7FF',
    progressTrackClass: 'rounded-md',
    progressFill: 'linear-gradient(90deg, #12F7FF 0%, #9B5DE5 50%, #F15BB5 100%)',
    progressFillClass: 'animate-pulse',
    progressFillGlow: '0 0 10px rgba(18, 247, 255, 0.75)',
    completionBg: '#C4FF4D',
    completionIcon: '#111827'
  },
  sunset: {
    rootBg: '#FFF1E6',
    headerBg: '#FDBA74',
    headerText: '#3F1D0D',
    headerSubText: '#7C2D12',
    gameBg: '#FED7AA',
    imagePanelBg: '#FFE7CF',
    patternColor: '#7C2D12',
    playHoverBg: '#FDBA74',
    skipHoverBg: '#FB7185',
    timerBg: '#7C2D12',
    timerText: '#FDE68A',
    timerDot: '#FB7185',
    timerBorder: '#7C2D12',
    timerShapeClass: 'rounded-2xl',
    timerTextClass: 'font-mono font-bold tracking-wide',
    progressTrackBg: '#FFFBEB',
    progressTrackBorder: '#7C2D12',
    progressTrackClass: 'rounded-2xl',
    progressFill: 'linear-gradient(90deg, #FDE047 0%, #FB7185 55%, #F97316 100%)',
    progressFillClass: '',
    completionBg: '#FDBA74',
    completionIcon: '#7C2D12'
  },
  mint: {
    rootBg: '#F2FFF8',
    headerBg: '#7EE8C8',
    headerText: '#064E3B',
    headerSubText: '#065F46',
    gameBg: '#D9FBE8',
    imagePanelBg: '#EEFCF4',
    patternColor: '#116149',
    playHoverBg: '#34D399',
    skipHoverBg: '#A7F3D0',
    timerBg: '#064E3B',
    timerText: '#A7F3D0',
    timerDot: '#34D399',
    timerBorder: '#065F46',
    timerShapeClass: 'rounded-lg',
    timerTextClass: 'font-mono font-bold',
    progressTrackBg: '#ECFDF5',
    progressTrackBorder: '#065F46',
    progressTrackClass: 'rounded-lg',
    progressFill: 'repeating-linear-gradient(90deg, #34D399 0 10px, #10B981 10px 20px, #059669 20px 30px)',
    progressFillClass: '',
    completionBg: '#7EE8C8',
    completionIcon: '#065F46'
  },
  midnight: {
    rootBg: '#0B1020',
    headerBg: '#93C5FD',
    headerText: '#0F172A',
    headerSubText: '#1E3A8A',
    gameBg: '#172554',
    imagePanelBg: '#0E1A34',
    patternColor: '#38BDF8',
    playHoverBg: '#60A5FA',
    skipHoverBg: '#22D3EE',
    timerBg: '#111827',
    timerText: '#93C5FD',
    timerDot: '#22D3EE',
    timerBorder: '#60A5FA',
    timerShapeClass: 'rounded-sm',
    timerTextClass: 'font-mono font-bold tracking-wider',
    progressTrackBg: '#0F172A',
    progressTrackBorder: '#60A5FA',
    progressTrackClass: 'rounded-sm',
    progressFill: 'linear-gradient(90deg, #38BDF8 0%, #2563EB 60%, #1D4ED8 100%)',
    progressFillClass: '',
    progressFillGlow: '0 0 8px rgba(56, 189, 248, 0.6)',
    completionBg: '#93C5FD',
    completionIcon: '#1E3A8A'
  },
  mono: {
    rootBg: '#F4F4F4',
    headerBg: '#E5E5E5',
    headerText: '#111111',
    headerSubText: '#374151',
    gameBg: '#D6D6D6',
    imagePanelBg: '#ECECEC',
    patternColor: '#111111',
    playHoverBg: '#D1D5DB',
    skipHoverBg: '#9CA3AF',
    timerBg: '#111111',
    timerText: '#F5F5F5',
    timerDot: '#6B7280',
    timerBorder: '#111111',
    timerShapeClass: 'rounded-none',
    timerTextClass: 'font-mono font-black tracking-[0.2em]',
    progressTrackBg: '#FFFFFF',
    progressTrackBorder: '#111111',
    progressTrackClass: 'rounded-none',
    progressFill: 'repeating-linear-gradient(90deg, #111111 0 12px, #4B5563 12px 24px)',
    progressFillClass: '',
    completionBg: '#E5E5E5',
    completionIcon: '#111111'
  },
  retro: {
    rootBg: '#FFF7D1',
    headerBg: '#F59E0B',
    headerText: '#4A1D0B',
    headerSubText: '#6B2D0E',
    gameBg: '#FCD34D',
    imagePanelBg: '#FDECC7',
    patternColor: '#92400E',
    playHoverBg: '#F59E0B',
    skipHoverBg: '#F97316',
    timerBg: '#7C2D12',
    timerText: '#FDE68A',
    timerDot: '#FBBF24',
    timerBorder: '#7C2D12',
    timerShapeClass: 'rounded-md',
    timerTextClass: 'font-mono font-black tracking-[0.1em]',
    progressTrackBg: '#FFF7ED',
    progressTrackBorder: '#7C2D12',
    progressTrackClass: 'rounded-sm',
    progressFill: 'repeating-linear-gradient(90deg, #F59E0B 0 14px, #B45309 14px 28px)',
    progressFillClass: '',
    completionBg: '#F59E0B',
    completionIcon: '#4A1D0B'
  },
  cyber: {
    rootBg: '#05070F',
    headerBg: '#22D3EE',
    headerText: '#0F172A',
    headerSubText: '#0F172A',
    gameBg: '#020617',
    imagePanelBg: '#0A1325',
    patternColor: '#22D3EE',
    playHoverBg: '#22D3EE',
    skipHoverBg: '#A78BFA',
    timerBg: '#020617',
    timerText: '#67E8F9',
    timerDot: '#A78BFA',
    timerBorder: '#22D3EE',
    timerShapeClass: 'rounded-sm',
    timerTextClass: 'font-mono font-black tracking-[0.15em]',
    progressTrackBg: '#0F172A',
    progressTrackBorder: '#22D3EE',
    progressTrackClass: 'rounded-sm',
    progressFill: 'linear-gradient(180deg, #22D3EE 0%, #0EA5E9 100%)',
    progressFillClass: '',
    progressFillGlow: '0 0 12px rgba(34, 211, 238, 0.7)',
    completionBg: '#22D3EE',
    completionIcon: '#0F172A'
  },
  oceanic: {
    rootBg: '#E0F2FE',
    headerBg: '#38BDF8',
    headerText: '#083344',
    headerSubText: '#0E7490',
    gameBg: '#7DD3FC',
    imagePanelBg: '#D7F4FF',
    patternColor: '#0369A1',
    playHoverBg: '#38BDF8',
    skipHoverBg: '#0EA5E9',
    timerBg: '#0C4A6E',
    timerText: '#DBEAFE',
    timerDot: '#67E8F9',
    timerBorder: '#0C4A6E',
    timerShapeClass: 'rounded-full',
    timerTextClass: 'font-mono font-bold',
    progressTrackBg: '#E0F2FE',
    progressTrackBorder: '#0C4A6E',
    progressTrackClass: 'rounded-full',
    progressFill: 'linear-gradient(90deg, #38BDF8 0%, #2563EB 100%)',
    progressFillClass: '',
    completionBg: '#38BDF8',
    completionIcon: '#083344'
  },
  ember: {
    rootBg: '#FFF1F2',
    headerBg: '#FB7185',
    headerText: '#4C0519',
    headerSubText: '#9F1239',
    gameBg: '#FCA5A5',
    imagePanelBg: '#FFE4E6',
    patternColor: '#9F1239',
    playHoverBg: '#FB7185',
    skipHoverBg: '#F97316',
    timerBg: '#7F1D1D',
    timerText: '#FECACA',
    timerDot: '#FDBA74',
    timerBorder: '#7F1D1D',
    timerShapeClass: 'rounded-md',
    timerTextClass: 'font-mono font-black',
    progressTrackBg: '#FFF1F2',
    progressTrackBorder: '#7F1D1D',
    progressTrackClass: 'rounded-md',
    progressFill: 'linear-gradient(90deg, #F97316 0%, #DC2626 100%)',
    progressFillClass: '',
    progressFillGlow: '0 0 10px rgba(220, 38, 38, 0.45)',
    completionBg: '#FB7185',
    completionIcon: '#4C0519'
  },
  candy: {
    rootBg: '#FDF2F8',
    headerBg: '#F472B6',
    headerText: '#500724',
    headerSubText: '#9D174D',
    gameBg: '#FBCFE8',
    imagePanelBg: '#FCE7F3',
    patternColor: '#BE185D',
    playHoverBg: '#F472B6',
    skipHoverBg: '#C084FC',
    timerBg: '#831843',
    timerText: '#FCE7F3',
    timerDot: '#C084FC',
    timerBorder: '#831843',
    timerShapeClass: 'rounded-2xl',
    timerTextClass: 'font-display font-black tracking-wide',
    progressTrackBg: '#FDF2F8',
    progressTrackBorder: '#831843',
    progressTrackClass: 'rounded-full',
    progressFill: 'linear-gradient(90deg, #F472B6 0%, #C084FC 100%)',
    progressFillClass: '',
    completionBg: '#F472B6',
    completionIcon: '#500724'
  },
  forest: {
    rootBg: '#ECFDF5',
    headerBg: '#22C55E',
    headerText: '#052E16',
    headerSubText: '#14532D',
    gameBg: '#86EFAC',
    imagePanelBg: '#DCFCE7',
    patternColor: '#166534',
    playHoverBg: '#22C55E',
    skipHoverBg: '#15803D',
    timerBg: '#14532D',
    timerText: '#DCFCE7',
    timerDot: '#4ADE80',
    timerBorder: '#14532D',
    timerShapeClass: 'rounded-md',
    timerTextClass: 'font-mono font-bold',
    progressTrackBg: '#ECFDF5',
    progressTrackBorder: '#14532D',
    progressTrackClass: 'rounded-md',
    progressFill: 'repeating-linear-gradient(90deg, #22C55E 0 10px, #15803D 10px 20px)',
    progressFillClass: '',
    completionBg: '#22C55E',
    completionIcon: '#052E16'
  },
  aurora: {
    rootBg: '#F5F3FF',
    headerBg: '#8B5CF6',
    headerText: '#FAFAFF',
    headerSubText: '#E9D5FF',
    gameBg: '#C4B5FD',
    imagePanelBg: '#EDE9FE',
    patternColor: '#6D28D9',
    playHoverBg: '#8B5CF6',
    skipHoverBg: '#22D3EE',
    timerBg: '#312E81',
    timerText: '#DDD6FE',
    timerDot: '#22D3EE',
    timerBorder: '#312E81',
    timerShapeClass: 'rounded-xl',
    timerTextClass: 'font-display font-black tracking-wide',
    progressTrackBg: '#EDE9FE',
    progressTrackBorder: '#312E81',
    progressTrackClass: 'rounded-full',
    progressFill: 'linear-gradient(90deg, #22D3EE 0%, #8B5CF6 50%, #EC4899 100%)',
    progressFillClass: '',
    progressFillGlow: '0 0 10px rgba(139, 92, 246, 0.4)',
    completionBg: '#8B5CF6',
    completionIcon: '#FAFAFF'
  },
  slate: {
    rootBg: '#F1F5F9',
    headerBg: '#475569',
    headerText: '#F8FAFC',
    headerSubText: '#CBD5E1',
    gameBg: '#94A3B8',
    imagePanelBg: '#E2E8F0',
    patternColor: '#1E293B',
    playHoverBg: '#64748B',
    skipHoverBg: '#334155',
    timerBg: '#0F172A',
    timerText: '#E2E8F0',
    timerDot: '#94A3B8',
    timerBorder: '#1E293B',
    timerShapeClass: 'rounded-sm',
    timerTextClass: 'font-mono font-black tracking-[0.12em]',
    progressTrackBg: '#E2E8F0',
    progressTrackBorder: '#1E293B',
    progressTrackClass: 'rounded-sm',
    progressFill: 'repeating-linear-gradient(90deg, #64748B 0 12px, #334155 12px 24px)',
    progressFillClass: '',
    completionBg: '#475569',
    completionIcon: '#F8FAFC'
  },
  arcade: {
    rootBg: '#111827',
    headerBg: '#FDE047',
    headerText: '#111827',
    headerSubText: '#1F2937',
    gameBg: '#1F2937',
    imagePanelBg: '#0F172A',
    patternColor: '#22D3EE',
    playHoverBg: '#A3E635',
    skipHoverBg: '#F97316',
    timerBg: '#111827',
    timerText: '#FDE047',
    timerDot: '#22D3EE',
    timerBorder: '#FDE047',
    timerShapeClass: 'rounded-none',
    timerTextClass: 'font-mono font-black tracking-[0.18em]',
    progressTrackBg: '#0F172A',
    progressTrackBorder: '#FDE047',
    progressTrackClass: 'rounded-none',
    progressFill: 'repeating-linear-gradient(45deg, #A3E635 0 10px, #22D3EE 10px 20px, #F97316 20px 30px)',
    progressFillClass: '',
    progressFillGlow: '0 0 12px rgba(253, 224, 71, 0.45)',
    completionBg: '#FDE047',
    completionIcon: '#111827'
  },
  ivory: {
    rootBg: '#FAFAF9',
    headerBg: '#E7E5E4',
    headerText: '#292524',
    headerSubText: '#57534E',
    gameBg: '#D6D3D1',
    imagePanelBg: '#F5F5F4',
    patternColor: '#78716C',
    playHoverBg: '#D6D3D1',
    skipHoverBg: '#A8A29E',
    timerBg: '#44403C',
    timerText: '#FAFAF9',
    timerDot: '#D6D3D1',
    timerBorder: '#44403C',
    timerShapeClass: 'rounded-full',
    timerTextClass: 'font-sans font-semibold tracking-wide',
    progressTrackBg: '#FAFAF9',
    progressTrackBorder: '#57534E',
    progressTrackClass: 'rounded-full',
    progressFill: 'linear-gradient(90deg, #A8A29E 0%, #57534E 100%)',
    progressFillClass: '',
    completionBg: '#E7E5E4',
    completionIcon: '#292524'
  },
  storybook: {
    rootBg: '#1A2830',
    headerBg: '#D8B149',
    headerText: '#2E2414',
    headerSubText: '#5A4320',
    gameBg: '#204759',
    imagePanelBg: '#E9E2CF',
    patternColor: '#000000',
    playHoverBg: '#C9A540',
    skipHoverBg: '#B08C32',
    timerBg: '#4A3C24',
    timerText: '#F7E8C2',
    timerDot: '#FCD34D',
    timerBorder: '#2E2414',
    timerShapeClass: 'rounded-2xl',
    timerTextClass: 'font-mono font-black',
    progressTrackBg: '#8B6D33',
    progressTrackBorder: '#2E2414',
    progressTrackClass: 'rounded-full',
    progressFill: 'linear-gradient(90deg, #D9C08B 0%, #8B6D33 65%, #5A4320 100%)',
    progressFillClass: '',
    completionBg: '#D8B149',
    completionIcon: '#2E2414'
  }
};

type MeterOrientation = 'horizontal' | 'vertical';

interface HudLayoutConfig {
  headerHeight: number;
  logoPosition?: React.CSSProperties;
  titlePosition: React.CSSProperties;
  titleAlignItems: 'flex-start' | 'center' | 'flex-end';
  titleGap: number;
  titleFontSize: number;
  subtitleFontSize: number;
  subtitleGap?: number;
  subtitleLetterSpacingEm: number;
  titleFontClass: string;
  subtitleFontClass: string;
  logoSize: number;
  timerPosition: React.CSSProperties;
  timerPadX: number;
  timerPadY: number;
  timerDotSize: number;
  timerGap: number;
  timerFontSize: number;
  timerMinWidth: number;
  timerJustify: React.CSSProperties['justifyContent'];
  progressPosition: React.CSSProperties;
  progressWidth: number;
  progressHeight: number;
  progressRadius: number;
  progressOrientation: MeterOrientation;
}

const anchorToCss = (anchor: HudAnchorSpec): React.CSSProperties => {
  const style: React.CSSProperties = {};
  const transforms: string[] = [];
  if (anchor.centerX) {
    style.left = '50%';
    transforms.push('translateX(-50%)');
  } else if (anchor.left !== undefined) {
    style.left = anchor.left;
  } else if (anchor.right !== undefined) {
    style.right = anchor.right;
  }

  if (anchor.centerY) {
    style.top = '50%';
    transforms.push('translateY(-50%)');
  } else if (anchor.top !== undefined) {
    style.top = anchor.top;
  } else if (anchor.bottom !== undefined) {
    style.bottom = anchor.bottom;
  }

  if (anchor.right !== undefined && !anchor.centerX && style.right === undefined) {
    style.right = anchor.right;
  }
  if (anchor.bottom !== undefined && !anchor.centerY && style.bottom === undefined) {
    style.bottom = anchor.bottom;
  }
  if (transforms.length > 0) {
    style.transform = transforms.join(' ');
  }
  return style;
};

const fillTemplate = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) => String(values[key] ?? ''));

const resolveTextProgressFillColors = (
  remainingPercent: number,
  theme: VisualTheme,
  dynamicColors?: ReturnType<typeof resolveProgressBarFillColors>
) => {
  return resolveSmoothTextProgressFillColors(remainingPercent, theme, dynamicColors);
};

const resolveTextProgressFontSize = (text: string, width: number, height: number, preferred: number) => {
  const safeText = text.trim() || 'PROGRESS';
  const widthBound = width / Math.max(4.8, safeText.length * 0.68);
  const heightBound = height * 0.78;
  return Math.max(12, Math.min(preferred, widthBound, heightBound));
};

let textProgressMeasureCanvas: HTMLCanvasElement | null = null;

const measureTextProgressSpan = (
  text: string,
  width: number,
  fontSize: number,
  fontFamily: string,
  fontWeight: number | string
) => {
  if (typeof document === 'undefined') {
    return { left: 0, width };
  }
  textProgressMeasureCanvas ??= document.createElement('canvas');
  const ctx = textProgressMeasureCanvas.getContext('2d');
  if (!ctx) {
    return { left: 0, width };
  }
  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  const metrics = ctx.measureText(text.trim() || 'PROGRESS');
  const measuredWidth = Math.max(
    metrics.width,
    (metrics.actualBoundingBoxLeft || 0) + (metrics.actualBoundingBoxRight || 0)
  );
  const boundedWidth = Math.max(1, Math.min(width, measuredWidth));
  return {
    left: (width - boundedWidth) / 2,
    width: boundedWidth
  };
};

const resolveIntroDuration = (settings: VideoSettings) => {
  if (settings.introVideoEnabled && settings.introVideoSrc) {
    const clipDuration = Number(settings.introVideoDuration);
    if (Number.isFinite(clipDuration) && clipDuration > 0) {
      return clipDuration;
    }
    const fallbackDuration = Number(settings.sceneSettings.introDuration);
    return Number.isFinite(fallbackDuration) ? Math.max(0, fallbackDuration) : 0;
  }

  return settings.sceneSettings.introEnabled ? Math.max(0, settings.sceneSettings.introDuration) : 0;
};

const shouldSkipLastPuzzleReveal = (
  settings: VideoSettings,
  puzzleIndex: number,
  puzzleCount: number
) =>
  settings.skipLastPuzzleReveal === true &&
  puzzleCount > 0 &&
  puzzleIndex === puzzleCount - 1;

const getRevealPhaseDurationForPuzzle = (
  settings: VideoSettings,
  puzzleIndex: number,
  puzzleCount: number
) =>
  shouldSkipLastPuzzleReveal(settings, puzzleIndex, puzzleCount)
    ? 0
    : Math.max(0.5, settings.revealDuration);

const getInitialPhase = (hasPuzzles: boolean, settings: VideoSettings): Phase => {
  if (!hasPuzzles) return 'finished';
  return resolveIntroDuration(settings) > 0 ? 'intro' : 'showing';
};

const resolveGeneratedBackgroundPlaybackTime = ({
  phase,
  puzzleIndex,
  puzzleCount,
  timeLeft,
  settings
}: {
  phase: Phase;
  puzzleIndex: number;
  puzzleCount: number;
  timeLeft: number;
  settings: VideoSettings;
}) => {
  const safePuzzleCount = Math.max(0, puzzleCount);
  const safeIndex = Math.min(Math.max(puzzleIndex, 0), Math.max(0, safePuzzleCount - 1));
  const introDuration = resolveIntroDuration(settings);
  const outroDuration = settings.sceneSettings.outroEnabled ? settings.sceneSettings.outroDuration : 0;
  const showingDuration = settings.showDuration;
  const transitionDuration = resolveVideoTransitionPhaseDuration(settings.transitionDuration);

  let elapsed = 0;

  if (introDuration > 0) {
    if (phase === 'intro') {
      return Math.max(0, introDuration - timeLeft);
    }
    elapsed += introDuration;
  }

  for (let index = 0; index < safeIndex; index += 1) {
    elapsed += showingDuration + getRevealPhaseDurationForPuzzle(settings, index, safePuzzleCount);
    if (index < safePuzzleCount - 1) {
      elapsed += transitionDuration;
    }
  }

  const currentRevealPhaseDuration = getRevealPhaseDurationForPuzzle(settings, safeIndex, safePuzzleCount);

  if (phase === 'showing') {
    return elapsed + Math.max(0, showingDuration - timeLeft);
  }
  if (phase === 'revealing') {
    return elapsed + showingDuration + Math.max(0, currentRevealPhaseDuration - timeLeft);
  }
  if (phase === 'transitioning') {
    return elapsed + showingDuration + currentRevealPhaseDuration + Math.max(0, transitionDuration - timeLeft);
  }
  if (phase === 'outro') {
    return elapsed + showingDuration + currentRevealPhaseDuration + Math.max(0, outroDuration - timeLeft);
  }
  if (phase === 'finished') {
    return elapsed + showingDuration + currentRevealPhaseDuration + outroDuration;
  }
  return elapsed;
};

const resolvePhaseAudioLevel = (
  levels: VideoSettings['musicPhaseLevels'] | VideoSettings['sfxPhaseLevels'] | undefined,
  phase: Phase
) => {
  if (!levels) return phase === 'finished' ? 0 : 1;
  if (phase === 'intro') return levels.intro ?? 1;
  if (phase === 'showing') return levels.showing ?? 1;
  if (phase === 'revealing') return levels.revealing ?? 1;
  if (phase === 'transitioning') return levels.transitioning ?? 1;
  if (phase === 'outro') return levels.outro ?? 1;
  return 0;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const INTRO_PREVIEW_FRAME_RATE = 12;

const HUD_PRESETS = {
  rightStack: {
    headerHeight: 64,
    titlePosition: { top: 8, left: 16 },
    titleAlignItems: 'flex-start' as const,
    titleGap: 14,
    titleFontSize: 20,
    subtitleFontSize: 10,
    subtitleLetterSpacingEm: 0.22,
    titleFontClass: 'font-display',
    subtitleFontClass: 'font-sans',
    logoSize: 40,
    timerPosition: { top: 8, right: 14 },
    timerPadX: 12,
    timerPadY: 4,
    timerDotSize: 10,
    timerGap: 8,
    timerFontSize: 30,
    timerMinWidth: 100,
    timerJustify: 'center' as const,
    progressPosition: { top: 42, right: 14 },
    progressWidth: 96,
    progressHeight: 10,
    progressRadius: 999,
    progressOrientation: 'horizontal' as const
  },
  leftStack: {
    headerHeight: 68,
    titlePosition: { top: 10, right: 18 },
    titleAlignItems: 'flex-end' as const,
    titleGap: 12,
    titleFontSize: 19,
    subtitleFontSize: 9,
    subtitleLetterSpacingEm: 0.26,
    titleFontClass: 'font-display',
    subtitleFontClass: 'font-mono',
    logoSize: 34,
    timerPosition: { top: 9, left: 16 },
    timerPadX: 14,
    timerPadY: 5,
    timerDotSize: 9,
    timerGap: 9,
    timerFontSize: 28,
    timerMinWidth: 102,
    timerJustify: 'center' as const,
    progressPosition: { top: 44, left: 16 },
    progressWidth: 120,
    progressHeight: 12,
    progressRadius: 8,
    progressOrientation: 'horizontal' as const
  },
  splitCorners: {
    headerHeight: 72,
    titlePosition: { top: 10, left: '50%', transform: 'translateX(-50%)' },
    titleAlignItems: 'center' as const,
    titleGap: 10,
    titleFontSize: 21,
    subtitleFontSize: 9,
    subtitleLetterSpacingEm: 0.24,
    titleFontClass: 'font-display',
    subtitleFontClass: 'font-mono',
    logoSize: 32,
    timerPosition: { top: 10, left: 16 },
    timerPadX: 11,
    timerPadY: 5,
    timerDotSize: 8,
    timerGap: 8,
    timerFontSize: 26,
    timerMinWidth: 98,
    timerJustify: 'center' as const,
    progressPosition: { top: 10, right: 16 },
    progressWidth: 128,
    progressHeight: 12,
    progressRadius: 6,
    progressOrientation: 'horizontal' as const
  },
  centerStack: {
    headerHeight: 78,
    titlePosition: { top: 9, left: 16 },
    titleAlignItems: 'flex-start' as const,
    titleGap: 10,
    titleFontSize: 20,
    subtitleFontSize: 9,
    subtitleLetterSpacingEm: 0.2,
    titleFontClass: 'font-display',
    subtitleFontClass: 'font-sans',
    logoSize: 36,
    timerPosition: { top: 8, left: '50%', transform: 'translateX(-50%)' },
    timerPadX: 16,
    timerPadY: 5,
    timerDotSize: 9,
    timerGap: 8,
    timerFontSize: 26,
    timerMinWidth: 120,
    timerJustify: 'center' as const,
    progressPosition: { bottom: 8, left: '50%', transform: 'translateX(-50%)' },
    progressWidth: 220,
    progressHeight: 10,
    progressRadius: 999,
    progressOrientation: 'horizontal' as const
  },
  topInline: {
    headerHeight: 70,
    titlePosition: { top: 9, left: 16 },
    titleAlignItems: 'flex-start' as const,
    titleGap: 12,
    titleFontSize: 19,
    subtitleFontSize: 9,
    subtitleLetterSpacingEm: 0.24,
    titleFontClass: 'font-display',
    subtitleFontClass: 'font-mono',
    logoSize: 34,
    timerPosition: { top: 10, right: 16 },
    timerPadX: 10,
    timerPadY: 4,
    timerDotSize: 8,
    timerGap: 7,
    timerFontSize: 24,
    timerMinWidth: 92,
    timerJustify: 'center' as const,
    progressPosition: { top: 12, right: 126 },
    progressWidth: 102,
    progressHeight: 9,
    progressRadius: 999,
    progressOrientation: 'horizontal' as const
  },
  bottomRail: {
    headerHeight: 76,
    titlePosition: { top: 8, left: 16 },
    titleAlignItems: 'flex-start' as const,
    titleGap: 12,
    titleFontSize: 20,
    subtitleFontSize: 9,
    subtitleLetterSpacingEm: 0.22,
    titleFontClass: 'font-display',
    subtitleFontClass: 'font-sans',
    logoSize: 36,
    timerPosition: { top: 9, right: 16 },
    timerPadX: 12,
    timerPadY: 4,
    timerDotSize: 9,
    timerGap: 8,
    timerFontSize: 26,
    timerMinWidth: 98,
    timerJustify: 'center' as const,
    progressPosition: { bottom: 8, left: '50%', transform: 'translateX(-50%)' },
    progressWidth: 300,
    progressHeight: 8,
    progressRadius: 999,
    progressOrientation: 'horizontal' as const
  },
  verticalRight: {
    headerHeight: 78,
    titlePosition: { top: 10, left: 16 },
    titleAlignItems: 'flex-start' as const,
    titleGap: 12,
    titleFontSize: 19,
    subtitleFontSize: 9,
    subtitleLetterSpacingEm: 0.22,
    titleFontClass: 'font-display',
    subtitleFontClass: 'font-mono',
    logoSize: 34,
    timerPosition: { top: 10, right: 18 },
    timerPadX: 10,
    timerPadY: 5,
    timerDotSize: 8,
    timerGap: 8,
    timerFontSize: 24,
    timerMinWidth: 90,
    timerJustify: 'center' as const,
    progressPosition: { top: 10, right: 124 },
    progressWidth: 10,
    progressHeight: 52,
    progressRadius: 6,
    progressOrientation: 'vertical' as const
  },
  verticalLeft: {
    headerHeight: 78,
    titlePosition: { top: 10, right: 16 },
    titleAlignItems: 'flex-end' as const,
    titleGap: 12,
    titleFontSize: 19,
    subtitleFontSize: 9,
    subtitleLetterSpacingEm: 0.24,
    titleFontClass: 'font-display',
    subtitleFontClass: 'font-mono',
    logoSize: 34,
    timerPosition: { top: 10, left: 18 },
    timerPadX: 10,
    timerPadY: 5,
    timerDotSize: 8,
    timerGap: 8,
    timerFontSize: 24,
    timerMinWidth: 92,
    timerJustify: 'center' as const,
    progressPosition: { top: 10, left: 124 },
    progressWidth: 10,
    progressHeight: 52,
    progressRadius: 6,
    progressOrientation: 'vertical' as const
  }
};

const HUD_LAYOUTS: Record<VideoSettings['visualStyle'], HudLayoutConfig> = {
  random: HUD_PRESETS.rightStack,
  classic: {
    ...HUD_PRESETS.rightStack,
    headerHeight: CLASSIC_HUD_SPEC.headerHeight,
    titlePosition: { top: CLASSIC_HUD_SPEC.title.top, left: CLASSIC_HUD_SPEC.title.left },
    titleFontSize: CLASSIC_HUD_SPEC.title.fontSize,
    subtitleFontSize: CLASSIC_HUD_SPEC.title.subtitleSize,
    timerPosition: { top: CLASSIC_HUD_SPEC.timer.top, right: CLASSIC_HUD_SPEC.timer.right },
    timerPadX: CLASSIC_HUD_SPEC.timer.padX,
    timerPadY: CLASSIC_HUD_SPEC.timer.padY,
    timerDotSize: CLASSIC_HUD_SPEC.timer.dotSize,
    timerGap: CLASSIC_HUD_SPEC.timer.gap,
    timerFontSize: CLASSIC_HUD_SPEC.timer.fontSize,
    timerMinWidth: CLASSIC_HUD_SPEC.timer.minWidth
  },
  pop: HUD_PRESETS.rightStack,
  neon: { ...HUD_PRESETS.topInline, titleFontClass: 'font-mono', subtitleFontClass: 'font-mono', titleFontSize: 18, timerFontSize: 22 },
  sunset: { ...HUD_PRESETS.centerStack, titleFontClass: 'font-display', timerFontSize: 24 },
  mint: { ...HUD_PRESETS.leftStack, titleFontClass: 'font-sans', subtitleFontClass: 'font-mono' },
  midnight: { ...HUD_PRESETS.bottomRail, titleFontClass: 'font-display', subtitleFontClass: 'font-mono', progressWidth: 260 },
  mono: { ...HUD_PRESETS.splitCorners, titleFontClass: 'font-mono', subtitleFontClass: 'font-mono', timerFontSize: 22, subtitleLetterSpacingEm: 0.3 },
  retro: { ...HUD_PRESETS.splitCorners, titleFontClass: 'font-display', subtitleFontClass: 'font-mono', titleFontSize: 22, timerFontSize: 25 },
  cyber: { ...HUD_PRESETS.verticalRight, titleFontClass: 'font-mono', subtitleFontClass: 'font-mono', titleFontSize: 18, timerFontSize: 22 },
  oceanic: { ...HUD_PRESETS.bottomRail, titleFontClass: 'font-sans', subtitleFontClass: 'font-mono', progressWidth: 320, progressHeight: 9 },
  ember: { ...HUD_PRESETS.leftStack, titleFontClass: 'font-display', subtitleFontClass: 'font-mono', timerFontSize: 26, timerPadX: 16 },
  candy: { ...HUD_PRESETS.centerStack, titleFontClass: 'font-display', subtitleFontClass: 'font-sans', titleFontSize: 21, progressWidth: 210 },
  forest: { ...HUD_PRESETS.leftStack, titleFontClass: 'font-sans', subtitleFontClass: 'font-mono', timerFontSize: 24, progressWidth: 132 },
  aurora: { ...HUD_PRESETS.topInline, titleFontClass: 'font-display', subtitleFontClass: 'font-mono', progressWidth: 118, timerMinWidth: 110 },
  slate: { ...HUD_PRESETS.rightStack, titleFontClass: 'font-mono', subtitleFontClass: 'font-mono', titleFontSize: 18, timerFontSize: 20, progressWidth: 140, progressHeight: 8 },
  arcade: { ...HUD_PRESETS.verticalLeft, titleFontClass: 'font-mono', subtitleFontClass: 'font-mono', titleFontSize: 20, timerFontSize: 23 },
  ivory: { ...HUD_PRESETS.bottomRail, titleFontClass: 'font-sans', subtitleFontClass: 'font-sans', titleFontSize: 18, subtitleFontSize: 8, timerFontSize: 20, progressWidth: 220, progressHeight: 7 },
  storybook: {
    ...HUD_PRESETS.topInline,
    titleFontClass: 'font-serif',
    subtitleFontClass: 'font-serif',
    titleFontSize: 22,
    subtitleFontSize: 10,
    subtitleLetterSpacingEm: 0.08,
    timerFontSize: 20,
    timerMinWidth: 95,
    progressWidth: 300,
    progressHeight: 20,
    progressRadius: 10
  }
};

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  puzzles,
  settings,
  onExit,
  onSendToEditor,
  embedded = false,
  hidePlaybackControls = false,
  externalControlAction = null,
  onPlaybackStateChange,
  backgroundPacksSessionId = 0
}) => {
  const initialHasPuzzles = puzzles.length > 0;
  const initialPhase = getInitialPhase(initialHasPuzzles, settings);
  const initialIntroDuration = resolveIntroDuration(settings);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>(initialPhase);
  const [timeLeft, setTimeLeft] = useState(
    initialPhase === 'intro'
      ? initialIntroDuration
      : initialPhase === 'finished'
      ? 0
      : settings.showDuration
  );
  const [smoothedTimeLeft, setSmoothedTimeLeft] = useState(
    initialPhase === 'intro'
      ? initialIntroDuration
      : initialPhase === 'finished'
      ? 0
      : settings.showDuration
  );
  const [isPlaying, setIsPlaying] = useState(true);
  const [isBlinkOverlayVisible, setIsBlinkOverlayVisible] = useState(false);
  const [imageViewportSize, setImageViewportSize] = useState({ width: 0, height: 0 });
  const [imageBNaturalSize, setImageBNaturalSize] = useState({ width: 0, height: 0 });
  const [audioAssetVersion, setAudioAssetVersion] = useState(0);
  const [introVideoUrl, setIntroVideoUrl] = useState<string | null>(null);
  const [introVideoReady, setIntroVideoReady] = useState(false);
  const [introVideoError, setIntroVideoError] = useState(false);
  const [introPreviewFrameUrl, setIntroPreviewFrameUrl] = useState<string | null>(null);
  const [introPreviewFrameError, setIntroPreviewFrameError] = useState(false);
  const introVideoRef = useRef<HTMLVideoElement | null>(null);
  const introPreviewRendererRef = useRef<ReturnType<typeof createIsolatedVideoFramePreviewRenderer> | null>(null);
  if (!introPreviewRendererRef.current) {
    introPreviewRendererRef.current = createIsolatedVideoFramePreviewRenderer();
  }
  const introVideoEnabled = settings.introVideoEnabled;
  const introVideoSrc = settings.introVideoSrc;
  const introClipActive = introVideoEnabled && Boolean(introVideoSrc);
  const [viewportSize, setViewportSize] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1600,
    height: typeof window !== 'undefined' ? window.innerHeight : 900
  }));

  const hasPuzzles = initialHasPuzzles;
  const safeCurrentIndex = hasPuzzles
    ? Math.min(Math.max(0, currentIndex), puzzles.length - 1)
    : 0;
  const currentPuzzle = hasPuzzles
    ? puzzles[safeCurrentIndex]
    : { imageA: '', imageB: '', regions: [] };

  const processedLogoSrc = useProcessedLogoSrc(settings.logo, {
    enabled: settings.logoChromaKeyEnabled,
    color: settings.logoChromaKeyColor,
    tolerance: settings.logoChromaKeyTolerance
  });
  const logoZoom = clampLogoZoom(settings.logoZoom);
  const renderedLogoSrc = processedLogoSrc;
  const renderLogoImage = (baseSize: number) => {
    if (!renderedLogoSrc) return null;
    const scaledSize = Math.max(1, Math.round(baseSize * logoZoom));
    return (
      <div
        className="absolute left-1/2 top-1/2 pointer-events-none -translate-x-1/2 -translate-y-1/2"
        style={{ width: `${scaledSize}px`, height: `${scaledSize}px` }}
      >
        <img
          src={renderedLogoSrc}
          alt="Logo"
          className="block h-full w-full max-w-none object-contain"
          style={{
            filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.35))'
          }}
        />
      </div>
    );
  };

  useEffect(() => {
    let isActive = true;
    if (!introVideoEnabled || !introVideoSrc) {
      setIntroVideoUrl((current) => {
        if (current && current.startsWith('blob:')) {
          URL.revokeObjectURL(current);
        }
        return null;
      });
      setIntroVideoReady(false);
      setIntroVideoError(false);
      return;
    }

    const loadIntroVideo = async () => {
      try {
        if (introVideoSrc.startsWith('blob:') || introVideoSrc.startsWith('data:') || introVideoSrc.startsWith('http')) {
          setIntroVideoUrl(introVideoSrc);
          setIntroVideoReady(false);
          setIntroVideoError(false);
          return;
        }
        const blob = await loadVideoAssetBlob(introVideoSrc);
        if (!blob || !isActive) {
          setIntroVideoError(true);
          return;
        }
        const nextUrl = URL.createObjectURL(blob);
        setIntroVideoUrl((current) => {
          if (current && current.startsWith('blob:')) {
            URL.revokeObjectURL(current);
          }
          return nextUrl;
        });
        setIntroVideoReady(false);
        setIntroVideoError(false);
      } catch (error) {
        console.error('Failed to load intro clip for preview', error);
        setIntroVideoReady(false);
        setIntroVideoError(true);
      }
    };

    void loadIntroVideo();
    return () => {
      isActive = false;
    };
  }, [introVideoEnabled, introVideoSrc]);

  useEffect(() => {
    return () => {
      if (introVideoUrl && introVideoUrl.startsWith('blob:')) {
        URL.revokeObjectURL(introVideoUrl);
      }
    };
  }, [introVideoUrl]);

  useEffect(() => {
    return () => {
      if (introPreviewFrameUrl) {
        URL.revokeObjectURL(introPreviewFrameUrl);
      }
    };
  }, [introPreviewFrameUrl]);

  useEffect(() => {
    const renderer = introPreviewRendererRef.current;
    return () => {
      renderer?.dispose();
    };
  }, []);

  useEffect(() => {
    if (phase === 'intro' && introVideoUrl) {
      const video = introVideoRef.current;
      if (video && video.readyState >= 2) {
        setIntroVideoReady(true);
        setIntroVideoError(false);
      } else {
        setIntroVideoReady(false);
        setIntroVideoError(false);
      }
    }
  }, [phase, introVideoUrl]);
  const textProgressId = useId().replace(/:/g, '');
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const interactiveViewportRef = useRef<HTMLDivElement>(null);
  const phaseTransitionLockRef = useRef<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioUnlockedRef = useRef(false);
  const lastShowAudioKeyRef = useRef<string | null>(null);
  const lastMarkerKeyRef = useRef<string | null>(null);
  const lastBlinkVisibleRef = useRef(false);
  const lastTransitionKeyRef = useRef<string | null>(null);
  const lastExternalControlNonceRef = useRef<number | null>(null);
  const audioBuffersRef = useRef<{
    sfxPools: Record<VideoAudioCuePoolKey, AudioBuffer[]>;
    music: AudioBuffer | null;
  }>({
    sfxPools: {
      progress_fill_intro: [],
      puzzle_play: [],
      low_time_warning: [],
      marker_reveal: [],
      blink: [],
      transition: []
    },
    music: null
  });
  const audioNodesRef = useRef<{
    masterGain: GainNode;
    sfxGain: GainNode;
    musicGain: GainNode;
    musicDucker: GainNode;
    limiter: DynamicsCompressorNode;
    limiterEnabled: boolean;
  } | null>(null);
  const musicSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const musicStateRef = useRef<{
    source: AudioBufferSourceNode;
    startedAt: number;
    offset: number;
    duration: number;
    loop: boolean;
  } | null>(null);
  const scheduledSfxTimeoutsRef = useRef<number[]>([]);
  const activeSfxSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  const ensureAudioContext = useCallback(() => {
    if (!audioUnlockedRef.current) {
      return null;
    }
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
    return audioContextRef.current;
  }, []);

  const ensureAudioGraph = useCallback(
    (ctx: AudioContext) => {
      let nodes = audioNodesRef.current;
      if (!nodes) {
        const masterGain = ctx.createGain();
        const sfxGain = ctx.createGain();
        const musicGain = ctx.createGain();
        const musicDucker = ctx.createGain();
        const limiter = ctx.createDynamicsCompressor();

        masterGain.gain.value = 1;
        sfxGain.gain.value = 1;
        musicGain.gain.value = 1;
        musicDucker.gain.value = 1;

        sfxGain.connect(masterGain);
        musicGain.connect(musicDucker);
        musicDucker.connect(masterGain);

        nodes = {
          masterGain,
          sfxGain,
          musicGain,
          musicDucker,
          limiter,
          limiterEnabled: settings.audioLimiterEnabled
        };
        audioNodesRef.current = nodes;
      }

      if (nodes.limiterEnabled !== settings.audioLimiterEnabled) {
        nodes.limiterEnabled = settings.audioLimiterEnabled;
      }

      nodes.masterGain.disconnect();
      nodes.limiter.disconnect();
      if (nodes.limiterEnabled) {
        nodes.masterGain.connect(nodes.limiter);
        nodes.limiter.connect(ctx.destination);
      } else {
        nodes.masterGain.connect(ctx.destination);
      }

      return nodes;
    },
    [settings.audioLimiterEnabled]
  );

  const unlockAudio = useCallback(() => {
    audioUnlockedRef.current = true;
    ensureAudioContext();
  }, [ensureAudioContext]);

  const stopPreviewMusic = useCallback(() => {
    const current = musicStateRef.current;
    if (current?.source) {
      try {
        current.source.stop();
      } catch {
        // ignore stop errors during rapid toggles
      }
      current.source.disconnect();
    }
    musicSourceRef.current = null;
    musicStateRef.current = null;
  }, []);

  const stopScheduledSfx = useCallback(() => {
    scheduledSfxTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    scheduledSfxTimeoutsRef.current = [];
    activeSfxSourcesRef.current.forEach((source) => {
      try {
        source.stop();
      } catch {
        // ignore stop errors during rapid phase changes
      }
      source.disconnect();
    });
    activeSfxSourcesRef.current.clear();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadSfxPools = async () => {
      const nextPools: Record<VideoAudioCuePoolKey, AudioBuffer[]> = {
        progress_fill_intro: [],
        puzzle_play: [],
        low_time_warning: [],
        marker_reveal: [],
        blink: [],
        transition: []
      };

      await Promise.all(
        VIDEO_AUDIO_POOL_KEYS.map(async (key) => {
          const sources = settings.audioCuePools[key].sources;
          if (!sources.length) return;
          const buffers = await Promise.all(sources.map((src) => decodeAudioBufferFromSource(src)));
          nextPools[key] = buffers.filter((buffer): buffer is AudioBuffer => Boolean(buffer));
        })
      );

      if (cancelled) return;
      audioBuffersRef.current.sfxPools = nextPools;
      setAudioAssetVersion((version) => version + 1);
    };
    void loadSfxPools();
    return () => {
      cancelled = true;
    };
  }, [settings.audioCuePools]);

  useEffect(() => {
    let cancelled = false;
    const loadMusic = async () => {
      if (!settings.backgroundMusicSrc) {
        audioBuffersRef.current.music = null;
        setAudioAssetVersion((version) => version + 1);
        return;
      }
      const buffer = await decodeAudioBufferFromSource(settings.backgroundMusicSrc);
      if (cancelled) return;
      audioBuffersRef.current.music = buffer;
      setAudioAssetVersion((version) => version + 1);
    };
    void loadMusic();
    return () => {
      cancelled = true;
    };
  }, [settings.backgroundMusicSrc]);

  const playAudioCue = useCallback(
    (
      kind: VideoAudioCuePoolKey,
      phase: Phase,
      puzzleIndex: number,
      options?: {
        eventIndex?: number;
        selectionMode?: 'cycle' | 'event';
        delaySeconds?: number;
        maxDuration?: number;
        fadeOutDuration?: number;
        automation?: VideoAudioPlaybackAutomation;
      }
    ) => {
      if (!settings.soundEffectsEnabled || !settings.previewSoundEnabled) return;
      const ctx = ensureAudioContext();
      if (!ctx || ctx.state === 'suspended') return;

      const nodes = ensureAudioGraph(ctx);
      const phaseGain = resolvePhaseAudioLevel(settings.sfxPhaseLevels, phase);
      const pool = settings.audioCuePools[kind];
      const poolVolume = Math.min(
        VIDEO_AUDIO_CUE_POOL_MAX_VOLUME,
        Math.max(0, pool.volume ?? 1)
      );
      const masterVolume = clamp01(settings.soundEffectsVolume) * phaseGain * poolVolume;
      if (masterVolume <= 0) return;
      if (!pool.enabled) return 0;
      const buffers = audioBuffersRef.current.sfxPools[kind];
      if (!buffers.length) return 0;

      const eventIndex = options?.eventIndex ?? puzzleIndex;
      const selectionMode = options?.selectionMode ?? 'cycle';
      const selectionSources =
        pool.sources.length === buffers.length
          ? pool.sources
          : buffers.map((_, index) => pool.sources[index] ?? `${kind}-${index}`);
      const selectedIndex =
        selectionMode === 'cycle'
          ? resolveVideoAudioCyclePoolIndex(selectionSources, eventIndex, kind)
          : resolveVideoAudioEventPoolIndex(selectionSources, puzzleIndex, eventIndex, kind);
      if (selectedIndex == null) return 0;

      const customBuffer = buffers[selectedIndex];
      if (!customBuffer) return 0;
      const resolvedMaxDuration =
        typeof options?.maxDuration === 'number' && options.maxDuration > 0
          ? Math.min(customBuffer.duration, options.maxDuration)
          : customBuffer.duration;

      const startCue = () => {
        const liveCtx = ensureAudioContext();
        if (!liveCtx || liveCtx.state === 'suspended') return;
        const liveNodes = ensureAudioGraph(liveCtx);
        const source = liveCtx.createBufferSource();
        const gain = liveCtx.createGain();
        const startTime = liveCtx.currentTime + 0.02;
        const automation = options?.automation;
        source.buffer = customBuffer;
        const automationDuration =
          automation && resolvedMaxDuration > 0
            ? Math.min(resolvedMaxDuration, Math.max(0, automation.duration))
            : 0;
        const startGainMultiplier = automation?.gainStart ?? 1;
        const endGainMultiplier = automation?.gainEnd ?? startGainMultiplier;
        const startPlaybackRate = automation?.playbackRateStart ?? 1;
        const endPlaybackRate = automation?.playbackRateEnd ?? startPlaybackRate;
        const targetGain = masterVolume * startGainMultiplier;
        const rampEndTime = startTime + automationDuration;

        source.playbackRate.setValueAtTime(startPlaybackRate, startTime);
        gain.gain.setValueAtTime(targetGain, startTime);
        if (automationDuration > 0) {
          source.playbackRate.linearRampToValueAtTime(endPlaybackRate, rampEndTime);
          gain.gain.linearRampToValueAtTime(masterVolume * endGainMultiplier, rampEndTime);
        }
        source.connect(gain);
        gain.connect(liveNodes.sfxGain);

        if (typeof options?.maxDuration === 'number' && options.maxDuration > 0) {
          const stopTime = startTime + resolvedMaxDuration;
          const fadeOutDuration = Math.min(
            options.fadeOutDuration ?? 0,
            resolvedMaxDuration
          );
          if (fadeOutDuration > 0) {
            const fadeStart = Math.max(startTime, stopTime - fadeOutDuration);
            gain.gain.setValueAtTime(masterVolume * endGainMultiplier, fadeStart);
            gain.gain.linearRampToValueAtTime(0.0001, stopTime);
          }
        }

        source.onended = () => {
          activeSfxSourcesRef.current.delete(source);
          source.disconnect();
        };
        source.start(startTime);
        if (typeof options?.maxDuration === 'number' && options.maxDuration > 0) {
          const stopTime = startTime + resolvedMaxDuration;
          source.stop(stopTime + 0.02);
        }
        activeSfxSourcesRef.current.add(source);

        if (settings.backgroundMusicEnabled && settings.backgroundMusicDuckingAmount > 0) {
          const duckAmount = clamp01(settings.backgroundMusicDuckingAmount);
          if (duckAmount > 0) {
            const duckGain = liveNodes.musicDucker.gain;
            const now = liveCtx.currentTime;
            const minGain = 1 - duckAmount;
            duckGain.cancelScheduledValues(now);
            duckGain.setValueAtTime(duckGain.value, now);
            duckGain.linearRampToValueAtTime(minGain, now + 0.04);
            duckGain.linearRampToValueAtTime(minGain, now + 0.12);
            duckGain.linearRampToValueAtTime(1, now + 0.32);
          }
        }
      };

      if (options?.delaySeconds && options.delaySeconds > 0) {
        const timeoutId = window.setTimeout(startCue, options.delaySeconds * 1000);
        scheduledSfxTimeoutsRef.current.push(timeoutId);
      } else {
        startCue();
      }

      return resolvedMaxDuration;

    },
    [
      ensureAudioContext,
      ensureAudioGraph,
      settings.audioCuePools,
      settings.backgroundMusicDuckingAmount,
      settings.backgroundMusicEnabled,
      settings.previewSoundEnabled,
      settings.sfxPhaseLevels,
      settings.soundEffectsEnabled,
      settings.soundEffectsVolume
    ]
  );

  const isBlinkingEnabled = settings.enableBlinking !== false;
  const blinkCycleDuration = Math.max(0.2, settings.blinkSpeed);
  const introDuration = resolveIntroDuration(settings);
  const revealPhaseDuration = getRevealPhaseDurationForPuzzle(settings, safeCurrentIndex, puzzles.length);
  const effectiveTransitionDuration = resolveVideoTransitionPhaseDuration(settings.transitionDuration);
  const revealRegionCount = currentPuzzle.regions.length;
  const revealStepSeconds = Math.min(
    Math.max(0.5, settings.sequentialRevealStep),
    Math.max(0.5, revealPhaseDuration) / Math.max(1, revealRegionCount + 1)
  );
  const revealBlinkStartTime =
    revealRegionCount > 0
      ? Math.max(0, (revealRegionCount - 1) * revealStepSeconds + blinkCycleDuration)
      : 0;
  const revealElapsed = phase === 'revealing' ? Math.max(0, revealPhaseDuration - timeLeft) : 0;
  const revealedRegionCount =
    phase === 'revealing' && revealRegionCount > 0
      ? Math.min(revealRegionCount, Math.floor(revealElapsed / revealStepSeconds) + 1)
      : 0;
  const isBlinkOverlayActive =
    isBlinkingEnabled &&
    phase === 'revealing' &&
    revealRegionCount > 0 &&
    revealElapsed >= revealBlinkStartTime;

  useEffect(() => {
    if (!hasPuzzles) return;
    if (currentIndex >= 0 && currentIndex < puzzles.length) return;
    setCurrentIndex(safeCurrentIndex);
  }, [hasPuzzles, currentIndex, puzzles.length, safeCurrentIndex]);

  useEffect(() => {
    setSmoothedTimeLeft(timeLeft);
    if (!isPlaying || phase === 'finished') {
      return;
    }

    let animationFrameId = 0;
    const startedAt = performance.now();
    const baseTimeLeft = timeLeft;

    const tick = (now: number) => {
      setSmoothedTimeLeft(Math.max(0, baseTimeLeft - (now - startedAt) / 1000));
      animationFrameId = window.requestAnimationFrame(tick);
    };

    animationFrameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrameId);
  }, [isPlaying, phase, timeLeft]);

  const handlePhaseComplete = useCallback(() => {
    if (!hasPuzzles) {
      setPhase('finished');
      setTimeLeft(0);
      return;
    }

    if (phase === 'intro') {
      setPhase('showing');
      setTimeLeft(settings.showDuration);
    } else if (phase === 'showing') {
      if (revealPhaseDuration > 0) {
        setPhase('revealing');
        setTimeLeft(revealPhaseDuration);
      } else if (settings.sceneSettings.outroEnabled) {
        setPhase('outro');
        setTimeLeft(settings.sceneSettings.outroDuration);
      } else {
        setPhase('finished');
        setTimeLeft(0);
      }
    } else if (phase === 'revealing') {
      if (safeCurrentIndex < puzzles.length - 1) {
        setPhase('transitioning');
        setTimeLeft(effectiveTransitionDuration);
      } else if (settings.sceneSettings.outroEnabled) {
        setPhase('outro');
        setTimeLeft(settings.sceneSettings.outroDuration);
      } else {
        setPhase('finished');
        setTimeLeft(0);
      }
    } else if (phase === 'transitioning') {
      setCurrentIndex((prev) => Math.min(prev + 1, puzzles.length - 1));
      setPhase('showing');
      setTimeLeft(settings.showDuration);
    } else if (phase === 'outro') {
      setPhase('finished');
      setTimeLeft(0);
    }
  }, [
    hasPuzzles,
    phase,
    puzzles.length,
    revealPhaseDuration,
    safeCurrentIndex,
    settings.sceneSettings.outroDuration,
    settings.sceneSettings.outroEnabled,
    settings.showDuration,
    effectiveTransitionDuration
  ]);

  // Timer Logic
  useEffect(() => {
    if (!isPlaying || phase === 'finished') return;

    const timer = window.setInterval(() => {
      setTimeLeft((prev) => Math.max(0, prev - 0.1));
    }, 100);

    return () => window.clearInterval(timer);
  }, [isPlaying, phase]);

  useEffect(() => {
    if (!isPlaying || phase === 'finished' || timeLeft > 0.001) {
      return;
    }

    const transitionKey = `${phase}:${safeCurrentIndex}`;
    if (phaseTransitionLockRef.current === transitionKey) {
      return;
    }
    phaseTransitionLockRef.current = transitionKey;
    handlePhaseComplete();
  }, [handlePhaseComplete, isPlaying, phase, safeCurrentIndex, timeLeft]);

  useEffect(() => {
    phaseTransitionLockRef.current = null;
  }, [phase, safeCurrentIndex]);

  useEffect(() => {
    return () => {
      stopScheduledSfx();
      stopPreviewMusic();
      audioContextRef.current?.close();
      audioContextRef.current = null;
    };
  }, [stopPreviewMusic, stopScheduledSfx]);

  const handleSkip = () => {
    unlockAudio();
    if (phase === 'intro') {
      setPhase('showing');
      setTimeLeft(settings.showDuration);
    } else if (phase === 'showing') {
      if (revealPhaseDuration > 0) {
        setPhase('revealing');
        setTimeLeft(revealPhaseDuration);
      } else if (settings.sceneSettings.outroEnabled) {
        setPhase('outro');
        setTimeLeft(settings.sceneSettings.outroDuration);
      } else {
        setPhase('finished');
        setTimeLeft(0);
      }
    } else if (phase === 'revealing') {
      handlePhaseComplete();
    } else if (phase === 'outro') {
      setPhase('finished');
      setTimeLeft(0);
    }
  };

  const handleReplay = useCallback(() => {
    unlockAudio();
    const replayPhase = getInitialPhase(hasPuzzles, settings);
    setCurrentIndex(0);
    setPhase(replayPhase);
    setTimeLeft(replayPhase === 'intro' ? introDuration : settings.showDuration);
    setIsPlaying(true);
  }, [hasPuzzles, settings, unlockAudio]);

  const handleTogglePlayback = useCallback(() => {
    unlockAudio();
    setIsPlaying((prev) => !prev);
  }, [unlockAudio]);

  useEffect(() => {
    if (!externalControlAction) return;
    if (lastExternalControlNonceRef.current === externalControlAction.nonce) return;

    lastExternalControlNonceRef.current = externalControlAction.nonce;

    if (externalControlAction.kind === 'skip') {
      handleSkip();
      return;
    }

    if (externalControlAction.kind === 'replay') {
      handleReplay();
      return;
    }

    if (phase === 'finished') {
      handleReplay();
      return;
    }

    handleTogglePlayback();
  }, [externalControlAction, handleReplay, handleTogglePlayback, phase]);

  useEffect(() => {
    onPlaybackStateChange?.({
      hasPuzzles,
      isPlaying,
      phase,
      puzzleIndex: safeCurrentIndex
    });
  }, [hasPuzzles, isPlaying, onPlaybackStateChange, phase, safeCurrentIndex]);

  useEffect(() => {
    if (phase !== 'showing') {
      lastShowAudioKeyRef.current = null;
    }
  }, [phase, safeCurrentIndex]);

  useEffect(() => {
    if (phase !== 'revealing') {
      lastMarkerKeyRef.current = null;
      lastBlinkVisibleRef.current = false;
    }
  }, [phase, safeCurrentIndex]);

  useEffect(() => {
    if (phase !== 'transitioning') {
      lastTransitionKeyRef.current = null;
    }
  }, [phase, safeCurrentIndex]);

  useEffect(() => {
    return () => {
      stopScheduledSfx();
    };
  }, [
    stopScheduledSfx
  ]);

  useEffect(() => {
    if (!isPlaying || phase !== 'showing') return;
    if (!settings.soundEffectsEnabled || !settings.previewSoundEnabled) return;
    if (!audioUnlockedRef.current) return;

    const key = `${safeCurrentIndex}:show-audio`;
    if (lastShowAudioKeyRef.current === key) return;
    lastShowAudioKeyRef.current = key;
    stopScheduledSfx();

    const progressFillPoolEnabled =
      settings.progressMotion === 'intro_fill' &&
      settings.audioCuePools.progress_fill_intro.enabled &&
      audioBuffersRef.current.sfxPools.progress_fill_intro.length > 0;
    const progressFillWindow = progressFillPoolEnabled
      ? resolveProgressFillIntroCueWindow(settings.showDuration, settings.showDuration)
      : null;
    const progressFillDuration = progressFillWindow
      ? playAudioCue('progress_fill_intro', phase, safeCurrentIndex, {
          eventIndex: safeCurrentIndex,
          selectionMode: 'cycle',
          maxDuration: progressFillWindow.maxDuration,
          fadeOutDuration: progressFillWindow.fadeOutDuration
        }) ?? 0
      : 0;
    const puzzlePlayWindow = resolvePuzzlePlayCueWindow(
      settings.showDuration,
      progressFillDuration,
      settings.puzzlePlayUrgencyRampEnabled
    );
    const lowTimeWindow = resolveLowTimeWarningCueWindow(settings.showDuration);
    const shouldPlayLowTimeWarning =
      settings.audioCuePools.low_time_warning.enabled &&
      audioBuffersRef.current.sfxPools.low_time_warning.length > 0;

    if (puzzlePlayWindow) {
      playAudioCue('puzzle_play', phase, safeCurrentIndex, {
        eventIndex: safeCurrentIndex,
        selectionMode: 'cycle',
        delaySeconds: puzzlePlayWindow.delaySeconds,
        maxDuration: puzzlePlayWindow.maxDuration,
        fadeOutDuration: puzzlePlayWindow.fadeOutDuration,
        automation: puzzlePlayWindow.automation
      });
    }

    if (shouldPlayLowTimeWarning && lowTimeWindow) {
      playAudioCue('low_time_warning', phase, safeCurrentIndex, {
        eventIndex: safeCurrentIndex,
        selectionMode: 'cycle',
        delaySeconds: lowTimeWindow.delaySeconds,
        maxDuration: lowTimeWindow.maxDuration,
        fadeOutDuration: lowTimeWindow.fadeOutDuration
      });
    }

    return () => {
      stopScheduledSfx();
    };
  }, [
    isPlaying,
    phase,
    safeCurrentIndex,
    settings.audioCuePools,
    settings.puzzlePlayUrgencyRampEnabled,
    settings.progressMotion,
    settings.previewSoundEnabled,
    settings.showDuration,
    settings.soundEffectsEnabled,
    playAudioCue,
    stopScheduledSfx
  ]);

  useEffect(() => {
    if (!isPlaying || phase !== 'transitioning') return;
    if (!settings.soundEffectsEnabled || !settings.previewSoundEnabled) return;
    if (!audioUnlockedRef.current) return;
    if (effectiveTransitionDuration <= 0) return;

    const key = `${safeCurrentIndex}:transition`;
    if (lastTransitionKeyRef.current === key) return;
    lastTransitionKeyRef.current = key;
    playAudioCue('transition', phase, safeCurrentIndex, {
      eventIndex: safeCurrentIndex,
      selectionMode: 'cycle'
    });
  }, [
    isPlaying,
    phase,
    safeCurrentIndex,
    effectiveTransitionDuration,
    settings.previewSoundEnabled,
    settings.soundEffectsEnabled,
    playAudioCue
  ]);

  useEffect(() => {
    if (!isPlaying || phase !== 'revealing') return;
    if (!settings.soundEffectsEnabled || !settings.previewSoundEnabled) return;
    if (!audioUnlockedRef.current) return;
    if (revealedRegionCount <= 0) return;

    const eventIndex = Math.max(0, revealedRegionCount - 1);
    const key = `${safeCurrentIndex}:marker:${eventIndex}`;
    if (lastMarkerKeyRef.current === key) return;
    lastMarkerKeyRef.current = key;
    playAudioCue('marker_reveal', phase, safeCurrentIndex, {
      eventIndex,
      selectionMode: 'event'
    });
  }, [
    isPlaying,
    phase,
    revealedRegionCount,
    safeCurrentIndex,
    settings.previewSoundEnabled,
    settings.soundEffectsEnabled,
    playAudioCue
  ]);

  useEffect(() => {
    if (!isPlaying) return;
    if (!settings.soundEffectsEnabled || !settings.previewSoundEnabled) return;
    if (!audioUnlockedRef.current) return;
    if (!isBlinkOverlayActive) {
      lastBlinkVisibleRef.current = false;
      return;
    }

    const blinkCueIndex = Math.max(
      0,
      Math.floor((revealElapsed - revealBlinkStartTime) / Math.max(0.2, settings.blinkSpeed))
    );
    if (isBlinkOverlayVisible && !lastBlinkVisibleRef.current) {
      playAudioCue('blink', phase, safeCurrentIndex, {
        eventIndex: blinkCueIndex,
        selectionMode: 'event'
      });
    }
    lastBlinkVisibleRef.current = isBlinkOverlayVisible;
  }, [
    isBlinkOverlayActive,
    isBlinkOverlayVisible,
    isPlaying,
    phase,
    revealBlinkStartTime,
    revealElapsed,
    safeCurrentIndex,
    settings.blinkSpeed,
    settings.previewSoundEnabled,
    settings.soundEffectsEnabled,
    playAudioCue
  ]);

  useEffect(() => {
    if (!embedded || phase !== 'finished' || !hasPuzzles) {
      return;
    }

    const replayTimer = window.setTimeout(() => {
      handleReplay();
    }, 650);

    return () => window.clearTimeout(replayTimer);
  }, [embedded, phase, hasPuzzles, settings, handleReplay]);

  const packagePreset =
    VIDEO_PACKAGE_PRESETS[settings.videoPackagePreset] ??
    VIDEO_PACKAGE_PRESETS.gameshow;
  const isVerticalLayout = resolvePackageImageArrangement(packagePreset, settings.aspectRatio);
  const effectiveVisualStyle = resolveVisualThemeStyle(settings.visualStyle, safeCurrentIndex);
  const customLayoutEnabled = settings.useCustomLayout === true;
  const isClassicStyle =
    packagePreset.surfaceStyle === 'gameshow' && !customLayoutEnabled;
  const isStorybookStyle =
    packagePreset.surfaceStyle === 'storybook' && settings.aspectRatio === '16:9' && !customLayoutEnabled;
  const isWidePuzzleDisplay = isStorybookStyle;
  const visualTheme = VISUAL_THEMES[effectiveVisualStyle];
  const styleModules = useMemo(
    () => resolveVideoStyleModules(settings, packagePreset),
    [packagePreset, settings]
  );
  const selectedBackgroundPack = useMemo(
    () =>
      settings.generatedBackgroundsEnabled
        ? loadGeneratedBackgroundPacks().find((pack) => pack.id === settings.generatedBackgroundPackId) ?? null
        : null,
    [
      backgroundPacksSessionId,
      settings.generatedBackgroundPackId,
      settings.generatedBackgroundsEnabled
    ]
  );
  const currentGeneratedBackground = useMemo(
    () =>
      settings.generatedBackgroundsEnabled
        ? resolveGeneratedBackgroundForIndex(
            selectedBackgroundPack,
            safeCurrentIndex,
            settings.generatedBackgroundShuffleSeed
          )
        : null,
    [
      safeCurrentIndex,
      selectedBackgroundPack,
      settings.generatedBackgroundShuffleSeed,
      settings.generatedBackgroundsEnabled
    ]
  );
  const resolvedLayout = useMemo(
    () => resolveVideoLayoutSettings(settings.videoPackagePreset, settings.aspectRatio, settings),
    [settings.videoPackagePreset, settings.aspectRatio, settings]
  );
  const hudLayout = useMemo<HudLayoutConfig>(() => {
    const chrome = packagePreset.chrome;
    const shared = resolvedLayout.hud;
    const titleAlignItems =
      shared.title.align === 'left'
        ? 'flex-start'
        : shared.title.align === 'center'
        ? 'center'
        : 'flex-end';

    return {
      headerHeight: shared.headerHeight,
      logoPosition: {
        top: resolvedLayout.logo.top,
        left: resolvedLayout.logo.left
      },
      titlePosition: anchorToCss(shared.title),
      titleAlignItems,
      titleGap: chrome.titleGap,
      titleFontSize: shared.title.fontSize,
      subtitleFontSize: shared.title.subtitleSize,
      subtitleGap: shared.title.subtitleGap,
      subtitleLetterSpacingEm: styleModules.text.subtitleLetterSpacingEm,
      titleFontClass: styleModules.text.titleFontClass,
      subtitleFontClass: styleModules.text.subtitleFontClass,
      logoSize: resolvedLayout.logo.size,
      timerPosition: anchorToCss(shared.timer),
      timerPadX: shared.timer.padX,
      timerPadY: shared.timer.padY,
      timerDotSize: shared.timer.dotSize,
      timerGap: shared.timer.gap,
      timerFontSize: shared.timer.fontSize,
      timerMinWidth: shared.timer.minWidth,
      timerJustify: chrome.timerJustify,
      progressPosition: anchorToCss(shared.progress),
      progressWidth: shared.progress.width,
      progressHeight: shared.progress.height,
      progressRadius: shared.progress.radius,
      progressOrientation: shared.progress.orientation
    };
  }, [packagePreset, resolvedLayout, styleModules.text]);
  const frameLayout = resolvedLayout.frame;
  const generatedBackgroundPlaybackTime = useMemo(
    () =>
      resolveGeneratedBackgroundPlaybackTime({
        phase,
        puzzleIndex: safeCurrentIndex,
        puzzleCount: puzzles.length,
        timeLeft: smoothedTimeLeft,
        settings
      }),
    [phase, puzzles.length, safeCurrentIndex, settings, smoothedTimeLeft]
  );
  const totalPlaybackDuration = useMemo(() => {
    const introDuration = resolveIntroDuration(settings);
    const outroDuration = settings.sceneSettings.outroEnabled ? settings.sceneSettings.outroDuration : 0;
    const puzzleCount = Math.max(0, puzzles.length);
    const showingDuration = settings.showDuration;
    const transitionDuration = effectiveTransitionDuration;

    if (puzzleCount <= 0) {
      return introDuration + outroDuration;
    }

    return (
      introDuration +
      puzzles.reduce(
        (total, _puzzle, puzzleIndex) =>
          total + showingDuration + getRevealPhaseDurationForPuzzle(settings, puzzleIndex, puzzleCount),
        0
      ) +
      Math.max(0, puzzleCount - 1) * transitionDuration +
      outroDuration
    );
  }, [
    puzzles.length,
    introDuration,
    settings.sceneSettings.outroDuration,
    settings.sceneSettings.outroEnabled,
    settings.skipLastPuzzleReveal,
    settings.revealDuration,
    settings.showDuration,
    effectiveTransitionDuration
  ]);
  const finalCommentPromptLines = useMemo(
    () => splitFinalCommentPromptIntoLines(settings.finalCommentPromptText),
    [settings.finalCommentPromptText]
  );
  const finalCommentPromptVisible =
    phase !== 'finished' &&
    finalCommentPromptLines.length > 0 &&
    shouldShowFinalCommentPrompt(settings, totalPlaybackDuration, generatedBackgroundPlaybackTime);
  const finalCommentPromptPosition = useMemo(
    () => ({
      left: `${clampFinalCommentPromptPosition(settings.finalCommentPromptX, 50)}%`,
      top: `${clampFinalCommentPromptPosition(settings.finalCommentPromptY, 12)}%`
    }),
    [settings.finalCommentPromptX, settings.finalCommentPromptY]
  );

  useEffect(() => {
    if (!settings.previewSoundEnabled || !settings.backgroundMusicEnabled) {
      stopPreviewMusic();
      return;
    }
    if (!isPlaying || phase === 'finished') {
      stopPreviewMusic();
      return;
    }
    if (!audioUnlockedRef.current) {
      return;
    }

    const ctx = ensureAudioContext();
    if (!ctx || ctx.state === 'suspended') {
      return;
    }

    const buffer = audioBuffersRef.current.music;
    if (!buffer) {
      stopPreviewMusic();
      return;
    }

    const duration = buffer.duration || 0;
    if (duration <= 0.01) {
      stopPreviewMusic();
      return;
    }

    const nodes = ensureAudioGraph(ctx);
    const phaseLevel = resolvePhaseAudioLevel(settings.musicPhaseLevels, phase);
    let targetGain = clamp01(settings.backgroundMusicVolume) * phaseLevel;
    if (settings.backgroundMusicFadeIn > 0) {
      targetGain *= Math.min(1, generatedBackgroundPlaybackTime / settings.backgroundMusicFadeIn);
    }
    if (settings.backgroundMusicFadeOut > 0 && totalPlaybackDuration > 0) {
      const timeToEnd = Math.max(0, totalPlaybackDuration - generatedBackgroundPlaybackTime);
      targetGain *= Math.min(1, timeToEnd / settings.backgroundMusicFadeOut);
    }
    nodes.musicGain.gain.setTargetAtTime(targetGain, ctx.currentTime, 0.08);

    const desiredOffsetBase = Math.max(0, settings.backgroundMusicOffsetSec) + generatedBackgroundPlaybackTime;
    if (!settings.backgroundMusicLoop && desiredOffsetBase >= duration) {
      stopPreviewMusic();
      return;
    }
    const desiredOffset = settings.backgroundMusicLoop
      ? desiredOffsetBase % duration
      : Math.min(desiredOffsetBase, Math.max(0, duration - 0.01));

    const currentState = musicStateRef.current;
    const currentOffset =
      currentState?.source && currentState.loop === settings.backgroundMusicLoop
        ? (ctx.currentTime - currentState.startedAt) + currentState.offset
        : null;
    const drift = currentOffset === null ? Infinity : Math.abs(currentOffset - desiredOffset);
    if (!currentState?.source || drift > 0.25) {
      stopPreviewMusic();
      const source = ctx.createBufferSource();
      const startAt = ctx.currentTime + 0.02;
      source.buffer = buffer;
      source.loop = settings.backgroundMusicLoop;
      source.connect(nodes.musicGain);
      source.start(startAt, desiredOffset);
      source.onended = () => {
        if (musicSourceRef.current === source) {
          musicSourceRef.current = null;
          musicStateRef.current = null;
        }
      };
      musicSourceRef.current = source;
      musicStateRef.current = {
        source,
        startedAt: startAt,
        offset: desiredOffset,
        duration,
        loop: settings.backgroundMusicLoop
      };
    }
  }, [
    audioAssetVersion,
    ensureAudioContext,
    ensureAudioGraph,
    generatedBackgroundPlaybackTime,
    isPlaying,
    phase,
    settings.backgroundMusicEnabled,
    settings.backgroundMusicFadeIn,
    settings.backgroundMusicFadeOut,
    settings.backgroundMusicLoop,
    settings.backgroundMusicOffsetSec,
    settings.backgroundMusicVolume,
    settings.musicPhaseLevels,
    settings.previewSoundEnabled,
    stopPreviewMusic,
    totalPlaybackDuration
  ]);
  const currentPuzzleNumber = hasPuzzles ? safeCurrentIndex + 1 : 0;
  const nextPuzzleNumber = Math.min(puzzles.length, safeCurrentIndex + 2);
  const templateValues = {
    current: currentPuzzleNumber,
    next: nextPuzzleNumber,
    total: puzzles.length,
    puzzleCount: puzzles.length,
    remaining: Math.max(0, puzzles.length - currentPuzzleNumber),
    preset: ''
  };
  const introEyebrow = fillTemplate(settings.textTemplates.introEyebrow, templateValues);
  const introTitle = fillTemplate(settings.textTemplates.introTitle, templateValues);
  const introSubtitle = fillTemplate(settings.textTemplates.introSubtitle, templateValues);
  const playModeTitle = fillTemplate(settings.textTemplates.playTitle, templateValues);
  const playModeSubtitle = fillTemplate(settings.textTemplates.playSubtitle, templateValues);
  const progressLabel = fillTemplate(
    settings.textTemplates.progressLabel || settings.textTemplates.playTitle,
    templateValues
  );
  const revealModeTitle = fillTemplate(settings.textTemplates.revealTitle, templateValues);
  const transitionEyebrow = fillTemplate(settings.textTemplates.transitionEyebrow, templateValues);
  const transitionTitle = fillTemplate(settings.textTemplates.transitionTitle, templateValues);
  const transitionSubtitle = fillTemplate(settings.textTemplates.transitionSubtitle, templateValues);
  const completionEyebrow = fillTemplate(settings.textTemplates.completionEyebrow, templateValues);
  const completionTitle = fillTemplate(settings.textTemplates.completionTitle, templateValues);
  const completionSubtitle = fillTemplate(settings.textTemplates.completionSubtitle, templateValues);
  const puzzleBadgeLabel = fillTemplate(settings.textTemplates.puzzleBadgeLabel, templateValues);
  const headerTitle =
    phase === 'intro'
      ? introTitle
      : phase === 'revealing'
      ? revealModeTitle
      : phase === 'transitioning'
      ? transitionTitle
      : phase === 'outro'
      ? completionTitle
      : playModeTitle;
  const headerSubtitle =
    phase === 'intro'
      ? introSubtitle
      : phase === 'transitioning'
      ? transitionSubtitle
      : phase === 'outro'
      ? completionSubtitle
      : playModeSubtitle;
  const styledHeaderTitle = applyTextTransform(headerTitle, styleModules.text.titleTransform);
  const styledHeaderSubtitle = applyTextTransform(
    headerSubtitle,
    styleModules.text.subtitleTransform
  );
  const styledProgressLabel = applyTextTransform(progressLabel, styleModules.text.titleTransform);
  const styledTransitionTitle = applyTextTransform(
    VIDEO_TRANSITION_LABEL,
    styleModules.text.titleTransform
  );
  const shouldRenderHeaderText = phase === 'showing' || phase === 'revealing';
  const shouldShowHeaderTimer = settings.showTimer !== false && phase === 'showing';
  const shouldShowHeaderProgress = settings.showProgress !== false && phase === 'showing';
  const shouldShowClassicPuzzleBadge = phase === 'showing' || phase === 'revealing';
  const shouldRenderCustomLogo = Boolean(renderedLogoSrc) && customLayoutEnabled;
  const shouldRenderInlineLogo =
    Boolean(renderedLogoSrc) &&
    !customLayoutEnabled &&
    !isClassicStyle &&
    !isStorybookStyle &&
    shouldRenderHeaderText;
  useEffect(() => {
    if (!isBlinkOverlayActive) {
      setIsBlinkOverlayVisible(false);
      return;
    }

    if (!isPlaying) return;

    setIsBlinkOverlayVisible(true);
    const halfCycleMs = Math.max(50, (blinkCycleDuration * 1000) / 2);
    const blinkTimer = window.setInterval(() => {
      setIsBlinkOverlayVisible((prev) => !prev);
    }, halfCycleMs);

    return () => window.clearInterval(blinkTimer);
  }, [isBlinkOverlayActive, isPlaying, blinkCycleDuration, currentIndex]);

  const phaseDuration =
    phase === 'intro'
      ? introDuration
      : phase === 'showing'
      ? settings.showDuration
      : phase === 'revealing'
      ? revealPhaseDuration
      : phase === 'transitioning'
      ? effectiveTransitionDuration
      : phase === 'outro'
      ? settings.sceneSettings.outroDuration
      : 0;
  const visualTimeLeft = isPlaying ? smoothedTimeLeft : timeLeft;
  const phaseElapsed = Math.max(0, phaseDuration - visualTimeLeft);
  const introPreviewTimestamp =
    phase === 'intro' && introClipActive && hasPuzzles
      ? Math.floor(Math.max(0, phaseElapsed) * INTRO_PREVIEW_FRAME_RATE) /
        INTRO_PREVIEW_FRAME_RATE
      : null;
  const showIntroClip = phase === 'intro' && Boolean(introPreviewFrameUrl);
  const introClipAudioEnabled = settings.previewSoundEnabled;
  const generatedBackgroundCoversHeader =
    Boolean(currentGeneratedBackground) &&
    settings.generatedBackgroundCoverage === 'full_board' &&
    !showIntroClip;

  useEffect(() => {
    const video = introVideoRef.current;
    if (!video || !introVideoReady || !introVideoUrl || phase !== 'intro') return;
    const safeDuration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : introDuration;
    const targetTime = Math.min(Math.max(0, phaseElapsed), Math.max(0, safeDuration - 0.04));
    if (!Number.isFinite(targetTime)) return;
    if (Math.abs(video.currentTime - targetTime) > (isPlaying ? 0.2 : 0.03)) {
      try {
        video.currentTime = targetTime;
      } catch {
        // Ignore sync errors while metadata is still loading.
      }
    }
  }, [phase, introVideoUrl, introVideoReady, phaseElapsed, introDuration, isPlaying]);

  useEffect(() => {
    const video = introVideoRef.current;
    if (!video) return;
    const shouldPlay =
      phase === 'intro' &&
      Boolean(introVideoUrl) &&
      introVideoReady &&
      introClipAudioEnabled &&
      isPlaying;
    video.muted = !introClipAudioEnabled;
    if (shouldPlay) {
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          // Ignore autoplay restrictions or transient play errors.
        });
      }
    } else {
      try {
        video.pause();
      } catch {
        // Ignore pause errors for partially loaded clips.
      }
    }
  }, [phase, introVideoUrl, introVideoReady, introClipAudioEnabled, isPlaying]);

  useEffect(() => {
    if (introPreviewTimestamp == null) {
      setIntroPreviewFrameError(false);
      setIntroPreviewFrameUrl((current) => {
        if (current) {
          URL.revokeObjectURL(current);
        }
        return null;
      });
      return;
    }

    const abortController = new AbortController();
    let cancelled = false;

    const loadIntroPreviewFrame = async () => {
      try {
        const renderer = introPreviewRendererRef.current;
        if (!renderer) {
          return;
        }
        const result = await renderer.render({
          puzzles,
          settings,
          timestamp: introPreviewTimestamp,
          signal: abortController.signal
        });
        if (cancelled) {
          return;
        }
        const nextUrl = URL.createObjectURL(result.blob);
        setIntroPreviewFrameUrl((current) => {
          if (current) {
            URL.revokeObjectURL(current);
          }
          return nextUrl;
        });
        setIntroPreviewFrameError(false);
      } catch (error) {
        if (
          cancelled ||
          (error instanceof DOMException && error.name === 'AbortError')
        ) {
          return;
        }
        console.error('Failed to render intro clip frame for preview', error);
        setIntroPreviewFrameError(true);
      }
    };

    void loadIntroPreviewFrame();

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [introPreviewTimestamp, puzzles, settings]);

  const progressPercent =
    phaseDuration <= 0
      ? 0
      : Math.min(100, Math.max(0, ((phaseDuration - visualTimeLeft) / phaseDuration) * 100));
  const countdownPercent =
    phaseDuration <= 0
      ? 0
      : Math.max(0, Math.min(100, (visualTimeLeft / Math.max(0.1, phaseDuration)) * 100));
  const transitionDuration = Math.max(0.001, effectiveTransitionDuration);
  const transitionProgress =
    phase === 'transitioning'
      ? Math.min(1, Math.max(0, (transitionDuration - visualTimeLeft) / transitionDuration))
      : 0;
  const transitionSmooth =
    phase === 'transitioning' ? transitionProgress * transitionProgress * (3 - 2 * transitionProgress) : 0;
  const transitionSequenceState = useMemo(
    () =>
      resolveVideoTransitionSequenceState({
        phaseDuration: effectiveTransitionDuration,
        timeLeft: visualTimeLeft
      }),
    [effectiveTransitionDuration, visualTimeLeft]
  );
  const puzzleEntryState = useMemo(
    () =>
      resolveVideoPuzzleEntryState({
        phaseDuration: settings.showDuration,
        timeLeft: visualTimeLeft
      }),
    [settings.showDuration, visualTimeLeft]
  );
  const transitionCardOpacity =
    phase === 'transitioning'
      ? Math.min(
          1,
          Math.max(
            styleModules.transition.activeOpacityFloor,
            TRANSITION_TUNING.cardOpacityBase +
              transitionSmooth * (TRANSITION_TUNING.cardOpacityPulse - 0.3) -
              transitionProgress * TRANSITION_TUNING.cardOpacityDecay
          )
        )
      : 0;
  const transitionCardTranslateY = Math.round(
    (1 - transitionSmooth) *
      (TRANSITION_TUNING.cardTranslateY + 8) *
      styleModules.transition.cardTranslateMultiplier
  );
  const transitionCardScale =
    TRANSITION_TUNING.cardScaleBase +
    transitionSmooth * (TRANSITION_TUNING.cardScalePulse + 0.04 + styleModules.transition.cardScaleBoost);
  const transitionCardGlowOpacity =
    0.18 + transitionSmooth * (0.34 + styleModules.transition.cardGlowBoost);
  const puzzleTransitionDuration =
    settings.transitionStyle === 'none' ? 0 : Math.max(0, effectiveTransitionDuration);
  const puzzleMotionInitial = styleModules.transition.previewInitial;
  const puzzleMotionExit = styleModules.transition.previewExit;
  const generatedProgressTheme = settings.generatedProgressEnabled
    ? PROGRESS_BAR_THEMES[settings.generatedProgressStyle]
    : null;
  const generatedProgressFillColors = settings.generatedProgressEnabled
    ? resolveProgressBarFillColors(settings.generatedProgressStyle, countdownPercent / 100)
    : null;
  const resolvedProgressFillDefinition =
    settings.generatedProgressEnabled && generatedProgressTheme
      ? resolveProgressBarFillStyle(
          settings.generatedProgressStyle,
          countdownPercent / 100,
          generatedProgressTheme
        )
      : isClassicStyle && styleModules.progress.id === 'package'
      ? CLASSIC_HUD_SPEC.progress.fillGradient
      : buildProgressFillDefinition(styleModules.progress, visualTheme);
  const resolvedProgressGlow =
    settings.generatedProgressEnabled
      ? generatedProgressTheme?.progressFillGlow
      : styleModules.progress.variant === 'glow'
      ? visualTheme.progressFillGlow ?? `0 0 12px ${visualTheme.timerDot}`
      : isClassicStyle
      ? CLASSIC_HUD_SPEC.progress.fillGlowCss
      : undefined;
  const isTextFillProgress = settings.generatedProgressEnabled
    ? settings.generatedProgressRenderMode === 'text_fill'
    : styleModules.progress.variant === 'text_fill';
  const progressMotionState = useMemo(
    () =>
      resolveVideoProgressMotionState({
        mode: settings.progressMotion,
        phase,
        phaseDuration,
        timeLeft: visualTimeLeft
      }),
    [phase, phaseDuration, settings.progressMotion, visualTimeLeft]
  );
  const displayedProgressPercent = Math.max(0, Math.min(100, progressMotionState.fillPercent));
  const typedTransitionTitle = useMemo(
    () =>
      revealTypewriterText(
        styledTransitionTitle,
        phase === 'transitioning' ? transitionSequenceState.titleProgress : 1
      ),
    [phase, styledTransitionTitle, transitionSequenceState.titleProgress]
  );

  const classicCenterTitleFontSize = isVerticalLayout
    ? CLASSIC_HUD_SPEC.centerTitle.fontSizeNarrow
    : CLASSIC_HUD_SPEC.centerTitle.fontSize;
  const classicBadgeValueFontSize = isVerticalLayout
    ? CLASSIC_HUD_SPEC.puzzleBadge.valueSizeNarrow
    : CLASSIC_HUD_SPEC.puzzleBadge.valueSize;
  const progressTrackPosition = isClassicStyle
    ? ({
        left: '50%',
        transform: 'translateX(-50%)',
        bottom: CLASSIC_HUD_SPEC.progress.bottom
      } as React.CSSProperties)
    : hudLayout.progressPosition;
  const progressTrackWidthPx = isClassicStyle
    ? Math.round(BASE_STAGE_SIZE[settings.aspectRatio].width * CLASSIC_HUD_SPEC.progress.widthRatio)
    : hudLayout.progressWidth;
  const progressTrackHeightPx = isClassicStyle
    ? CLASSIC_HUD_SPEC.progress.height
    : hudLayout.progressHeight;
  const progressTextWidthPx = progressTrackWidthPx;
  const progressTextHeightPx = progressTrackHeightPx;
  const progressTrackWidth = `${progressTrackWidthPx}px`;
  const progressTrackHeight = `${progressTrackHeightPx}px`;
  const progressTrackRadius = isClassicStyle
    ? `${settings.generatedProgressEnabled ? Math.max(8, Math.round(CLASSIC_HUD_SPEC.progress.height / 2)) : radiusTokenToPx(styleModules.progress.radiusToken, CLASSIC_HUD_SPEC.progress.height)}px`
    : `${
        settings.generatedProgressEnabled
          ? Math.max(8, Math.round(hudLayout.progressHeight / 2))
          : radiusTokenToPx(styleModules.progress.radiusToken, hudLayout.progressHeight)
      }px`;
  const progressTrackBorderWidth =
    settings.generatedProgressEnabled
      ? `${Math.max(2, Math.round(progressTrackHeightPx * 0.08))}px`
      : isClassicStyle
      ? `${CLASSIC_HUD_SPEC.progress.borderWidth}px`
      : `${Math.max(1, Math.round(2 * styleModules.progress.borderWidthScale))}px`;
  const progressTrackShadow = isClassicStyle
    ? settings.generatedProgressEnabled
      ? generatedProgressTheme?.progressFillGlow ?? 'inset 0 1px 0 rgba(255,255,255,0.24), 0 2px 4px rgba(0,0,0,0.32)'
      : 'inset 0 1px 0 rgba(255,255,255,0.24), 0 2px 4px rgba(0,0,0,0.32)'
    : settings.generatedProgressEnabled && generatedProgressTheme?.progressFillGlow
    ? `0 0 0 2px rgba(0,0,0,0.9), ${generatedProgressTheme.progressFillGlow}`
    : styleModules.progress.variant === 'glow'
    ? `0 0 0 2px rgba(0,0,0,0.9), 0 0 16px ${visualTheme.timerDot}`
    : '2px 2px 0px 0px rgba(0,0,0,1)';
  const progressTrackBackground = isClassicStyle
    ? settings.generatedProgressEnabled && generatedProgressTheme
      ? generatedProgressTheme.progressTrackBg
      : styleModules.progress.id === 'package'
      ? CLASSIC_HUD_SPEC.progress.trackBackground
      : visualTheme.progressTrackBg
    : settings.generatedProgressEnabled && generatedProgressTheme
    ? generatedProgressTheme.progressTrackBg
    : visualTheme.progressTrackBg;
  const progressTrackBorderColor =
    settings.generatedProgressEnabled && generatedProgressTheme
      ? generatedProgressTheme.progressTrackBorder
      : visualTheme.progressTrackBorder;
  const progressPulseBoxShadow =
    progressMotionState.pulseGlowOpacity > 0
      ? `0 0 ${Math.max(
          10,
          Math.round(
            (hudLayout.progressOrientation === 'vertical' ? progressTrackWidthPx : progressTrackHeightPx) *
              (1.15 + progressMotionState.pulseGlowOpacity * 1.8)
          )
        )}px rgba(255,255,255,${(0.08 + progressMotionState.pulseGlowOpacity * 0.26).toFixed(3)})`
      : '';
  const progressFillBoxShadow = [resolvedProgressGlow, progressPulseBoxShadow].filter(Boolean).join(', ');
  const progressFillTransform =
    hudLayout.progressOrientation === 'vertical'
      ? `scaleX(${progressMotionState.pulseScale.toFixed(3)})`
      : `scaleY(${progressMotionState.pulseScale.toFixed(3)})`;
  const progressFillFilter = `brightness(${(1 + progressMotionState.pulseBrightness).toFixed(3)}) saturate(${(
    1 + progressMotionState.pulseBrightness * 0.75
  ).toFixed(3)})`;
  const progressFillStyle =
    hudLayout.progressOrientation === 'horizontal'
      ? {
          width: `${displayedProgressPercent}%`,
          height: '100%',
          background: resolvedProgressFillDefinition,
          boxShadow: progressFillBoxShadow || undefined,
          position: 'relative' as const,
          overflow: 'hidden' as const,
          transformOrigin: 'left center',
          transform: progressFillTransform,
          filter: progressFillFilter
        }
      : {
          width: '100%',
          height: `${displayedProgressPercent}%`,
          background: resolvedProgressFillDefinition,
          boxShadow: progressFillBoxShadow || undefined,
          position: 'relative' as const,
          overflow: 'hidden' as const,
          transformOrigin: 'center bottom',
          transform: progressFillTransform,
          filter: progressFillFilter
        };
  const shouldShowBarProgressSweep = !isTextFillProgress && progressMotionState.sweepActive;
  const progressSweepStyle: React.CSSProperties | undefined = shouldShowBarProgressSweep
    ? hudLayout.progressOrientation === 'vertical'
      ? {
          position: 'absolute',
          left: '0',
          width: '100%',
          height: `${Math.max(16, Math.round(progressTrackHeightPx * 0.22))}px`,
          bottom: `${progressTrackHeightPx * progressMotionState.sweepProgress - Math.max(16, Math.round(progressTrackHeightPx * 0.11))}px`,
          background:
            'linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.06) 30%, rgba(255,255,255,0.28) 50%, rgba(255,255,255,0.06) 70%, rgba(255,255,255,0) 100%)',
          opacity: progressMotionState.sweepOpacity
        }
      : {
          position: 'absolute',
          top: '0',
          height: '100%',
          width: `${Math.max(18, Math.round(progressTrackWidthPx * 0.18))}px`,
          left: `${progressTrackWidthPx * progressMotionState.sweepProgress - Math.max(18, Math.round(progressTrackWidthPx * 0.09))}px`,
          background:
            'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.06) 30%, rgba(255,255,255,0.28) 50%, rgba(255,255,255,0.06) 70%, rgba(255,255,255,0) 100%)',
          opacity: progressMotionState.sweepOpacity
        }
    : undefined;
  const progressPulseOverlayStyle: React.CSSProperties | undefined =
    progressMotionState.pulseOverlayOpacity > 0
      ? hudLayout.progressOrientation === 'vertical'
        ? {
            position: 'absolute',
            inset: '0',
            background:
              'linear-gradient(180deg, rgba(255,255,255,0.82) 0%, rgba(255,255,255,0.24) 28%, rgba(255,255,255,0) 58%)',
            opacity: progressMotionState.pulseOverlayOpacity,
            pointerEvents: 'none'
          }
        : {
            position: 'absolute',
            inset: '0',
            background:
              'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.04) 54%, rgba(255,255,255,0.24) 78%, rgba(255,255,255,0.82) 100%)',
            opacity: progressMotionState.pulseOverlayOpacity,
            pointerEvents: 'none'
          }
      : undefined;
  const textProgressFillColors = useMemo(
    () =>
      resolveTextProgressFillColors(
        countdownPercent,
        generatedProgressTheme ?? visualTheme,
        generatedProgressFillColors
      ),
    [countdownPercent, generatedProgressFillColors, generatedProgressTheme, visualTheme]
  );
  const textProgressFontSize = useMemo(
    () =>
      resolveTextProgressFontSize(
        styledProgressLabel,
        progressTextWidthPx,
        progressTextHeightPx,
        Math.max(
          20,
          progressTextHeightPx * 1.24,
          progressTextWidthPx,
          (isClassicStyle ? classicCenterTitleFontSize : hudLayout.titleFontSize) * 1.08
        )
      ),
    [
      classicCenterTitleFontSize,
      hudLayout.titleFontSize,
      isClassicStyle,
      progressTextHeightPx,
      progressTextWidthPx,
      styledProgressLabel
    ]
  );
  const textProgressStrokeWidth = Math.max(2, Math.round(textProgressFontSize * 0.08));

  const stageMetrics = useMemo(() => {
    const baseSize = BASE_STAGE_SIZE[settings.aspectRatio];
    const horizontalPadding = embedded ? 0 : 24;
    const topReserved = embedded ? 0 : 92;
    const bottomReserved = embedded
      ? 0
      : phase === 'finished'
      ? 24
      : 122;

    const availableWidth = Math.max(320, viewportSize.width - horizontalPadding * 2);
    const availableHeight = Math.max(240, viewportSize.height - topReserved - bottomReserved);
    const scale = Math.max(
      0.15,
      Math.min(availableWidth / baseSize.width, availableHeight / baseSize.height)
    );

    return {
      baseWidth: baseSize.width,
      baseHeight: baseSize.height,
      scale,
      scaledWidth: baseSize.width * scale,
      scaledHeight: baseSize.height * scale
    };
  }, [settings.aspectRatio, viewportSize, phase, embedded, hidePlaybackControls]);

  useEffect(() => {
    if (embedded) {
      const target = viewportRef.current;
      if (!target) return;
      let frameHandle: number | null = null;
      const syncSize = () => {
        const nextWidth = Math.max(1, target.clientWidth);
        const nextHeight = Math.max(1, target.clientHeight);
        setViewportSize((previous) => {
          if (Math.abs(previous.width - nextWidth) < 2 && Math.abs(previous.height - nextHeight) < 2) {
            return previous;
          }
          return {
            width: nextWidth,
            height: nextHeight
          };
        });
      };
      const scheduleSyncSize = () => {
        if (frameHandle !== null) {
          cancelAnimationFrame(frameHandle);
        }
        frameHandle = window.requestAnimationFrame(() => {
          frameHandle = null;
          syncSize();
        });
      };
      syncSize();
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(() => scheduleSyncSize());
      observer.observe(target);
      return () => {
        observer.disconnect();
        if (frameHandle !== null) {
          cancelAnimationFrame(frameHandle);
        }
      };
    }

    if (typeof window === 'undefined') return;
    const handleResize = () => {
      setViewportSize({
        width: window.innerWidth,
        height: window.innerHeight
      });
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [embedded]);

  useEffect(() => {
    setImageBNaturalSize({ width: 0, height: 0 });
  }, [currentPuzzle.imageB]);

  useEffect(() => {
    const target = interactiveViewportRef.current;
    if (!target) return;

    const syncSize = () => {
      setImageViewportSize({
        width: target.clientWidth,
        height: target.clientHeight
      });
    };

    syncSize();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => syncSize());
    observer.observe(target);

    return () => observer.disconnect();
  }, [currentPuzzle.imageB, phase, isVerticalLayout]);

  const imageBCoverFrame = useMemo(() => {
    const viewportWidth = imageViewportSize.width;
    const viewportHeight = imageViewportSize.height;
    const imageWidth = imageBNaturalSize.width;
    const imageHeight = imageBNaturalSize.height;

    if (viewportWidth <= 0 || viewportHeight <= 0 || imageWidth <= 0 || imageHeight <= 0) {
      return {
        x: 0,
        y: 0,
        width: viewportWidth,
        height: viewportHeight
      };
    }

    const scale = Math.max(viewportWidth / imageWidth, viewportHeight / imageHeight);
    const width = imageWidth * scale;
    const height = imageHeight * scale;

    return {
      x: (viewportWidth - width) / 2,
      y: (viewportHeight - height) / 2,
      width,
      height
    };
  }, [imageViewportSize, imageBNaturalSize]);

  useEffect(() => {
    const preload = new Image();
    preload.onload = () => {
      setImageBNaturalSize({
        width: preload.naturalWidth,
        height: preload.naturalHeight
      });
    };
    preload.src = currentPuzzle.imageB;
  }, [currentPuzzle.imageB]);

  const formatTime = (seconds: number) => {
    return String(Math.max(0, Math.ceil(seconds - 0.001)));
  };

  const hexToRgba = (hex: string, alpha: number) => {
    if (!hex.startsWith('#')) return hex;
    const normalized = hex.length === 4
      ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
      : hex;
    const r = Number.parseInt(normalized.slice(1, 3), 16);
    const g = Number.parseInt(normalized.slice(3, 5), 16);
    const b = Number.parseInt(normalized.slice(5, 7), 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return hex;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  const effectiveRevealVariant =
    settings.revealStyle === 'box'
      ? settings.revealVariant.startsWith('box_')
        ? settings.revealVariant
        : 'box_glow'
      : settings.revealStyle === 'circle'
      ? settings.revealVariant.startsWith('circle_')
        ? settings.revealVariant
        : 'circle_dotted'
      : 'highlight_soft';
  const circleStroke = Math.max(2, settings.circleThickness);
  const outlineStroke = Math.max(0, settings.outlineThickness);
  const imagePanelOutlineThickness = 0;
  const usesImagePanelOutline = imagePanelOutlineThickness > 0;
  const effectiveGamePadding = !isStorybookStyle && usesImagePanelOutline ? 0 : frameLayout.gamePadding;
  const imagePanelOutlineShadow =
    imagePanelOutlineThickness > 0
      ? `inset 0 0 0 ${imagePanelOutlineThickness}px ${settings.imagePanelOutlineColor}`
      : '';
  const storybookPanelShadow = [
    imagePanelOutlineShadow,
    '4px 4px 0px 0px rgba(38,30,18,0.55)'
  ]
    .filter(Boolean)
    .join(', ');
  const standardPanelStyle = {
    borderRadius: `${frameLayout.panelRadius}px`,
    boxShadow: imagePanelOutlineShadow || undefined,
    backgroundColor: visualTheme.imagePanelBg
  } as const;
  const storybookPanelStyle = {
    backgroundColor: visualTheme.imagePanelBg,
    boxShadow: storybookPanelShadow
  } as const;
  const renderBlinkOverlay = () => {
    if (!isBlinkOverlayActive || !isBlinkOverlayVisible) return null;

    return (
      <img
        src={currentPuzzle.imageA}
        alt="Blink compare"
        className="absolute pointer-events-none select-none z-10"
        style={{
          left: `${imageBCoverFrame.x}px`,
          top: `${imageBCoverFrame.y}px`,
          width: `${imageBCoverFrame.width}px`,
          height: `${imageBCoverFrame.height}px`
        }}
      />
    );
  };

  const renderRevealOverlays = () => (
    <AnimatePresence>
      {phase === 'revealing' &&
        revealedRegionCount > 0 &&
        (settings.revealBehavior === 'spotlight' ||
          settings.revealBehavior === 'cinematic_sequential') && (
          <motion.div
            key="reveal-scene-dimmer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-10"
            style={{
              backgroundColor:
                settings.revealBehavior === 'cinematic_sequential'
                  ? 'rgba(3,7,18,0.5)'
                  : 'rgba(3,7,18,0.32)'
            }}
          />
        )}
      {phase === 'revealing' &&
        currentPuzzle.regions.slice(0, revealedRegionCount).map((region, index) => {
          const regionKey = region.id || `${region.x}-${region.y}-${region.width}-${region.height}`;
          const isActiveReveal = index === revealedRegionCount - 1;
          const usesPersistentSpotlight =
            settings.revealBehavior === 'spotlight' ||
            settings.revealBehavior === 'cinematic_sequential';
          const isRatioBased =
            region.x <= 1 && region.y <= 1 && region.width <= 1 && region.height <= 1;

          const normalizedRegion = isRatioBased
            ? region
            : {
                ...region,
                x: imageBNaturalSize.width > 0 ? region.x / imageBNaturalSize.width : region.x,
                y: imageBNaturalSize.height > 0 ? region.y / imageBNaturalSize.height : region.y,
                width: imageBNaturalSize.width > 0 ? region.width / imageBNaturalSize.width : region.width,
                height: imageBNaturalSize.height > 0 ? region.height / imageBNaturalSize.height : region.height
              };

          const clampedX = Math.max(0, Math.min(1, normalizedRegion.x));
          const clampedY = Math.max(0, Math.min(1, normalizedRegion.y));
          const clampedWidth = Math.max(0, Math.min(1 - clampedX, normalizedRegion.width));
          const clampedHeight = Math.max(0, Math.min(1 - clampedY, normalizedRegion.height));
          const centerX = clampedX + clampedWidth / 2;
          const centerY = clampedY + clampedHeight / 2;
          const isCircleReveal = settings.revealStyle === 'circle';
          const minMarkerPx = isCircleReveal ? 42 : 36;
          const minWidthNormalized = imageBCoverFrame.width > 0 ? minMarkerPx / imageBCoverFrame.width : 0.05;
          const minHeightNormalized = imageBCoverFrame.height > 0 ? minMarkerPx / imageBCoverFrame.height : 0.05;
          const regionPixelMax = Math.max(
            clampedWidth * imageBCoverFrame.width,
            clampedHeight * imageBCoverFrame.height
          );
          const tinyObjectCutoffPx = 48;
          const largeObjectCutoffPx = 180;
          const smallObjectFactor = isCircleReveal ? 2.2 : 1.95;
          const largeObjectFactor = isCircleReveal ? 1.2 : 1.15;
          const scaleBlend =
            regionPixelMax <= tinyObjectCutoffPx
              ? 0
              : regionPixelMax >= largeObjectCutoffPx
              ? 1
              : (regionPixelMax - tinyObjectCutoffPx) / (largeObjectCutoffPx - tinyObjectCutoffPx);
          const expansionFactor = smallObjectFactor + (largeObjectFactor - smallObjectFactor) * scaleBlend;
          const expandedWidth = Math.min(1, Math.max(clampedWidth * expansionFactor, minWidthNormalized));
          const expandedHeight = Math.min(1, Math.max(clampedHeight * expansionFactor, minHeightNormalized));
          const circleSize = Math.min(1, Math.max(expandedWidth, expandedHeight));
          const rawCircleLeft = centerX - circleSize / 2;
          const rawCircleTop = centerY - circleSize / 2;
          const circleLeft = Math.max(0, Math.min(1 - circleSize, rawCircleLeft));
          const circleTop = Math.max(0, Math.min(1 - circleSize, rawCircleTop));
          const boxLeft = Math.max(0, Math.min(1 - expandedWidth, centerX - expandedWidth / 2));
          const boxTop = Math.max(0, Math.min(1 - expandedHeight, centerY - expandedHeight / 2));
          const isEllipseVariant =
            settings.revealStyle === 'circle' &&
            (effectiveRevealVariant === 'circle_ellipse' || effectiveRevealVariant === 'circle_ellipse_dotted');
          const useSquareCircleFrame = settings.revealStyle === 'circle' && !isEllipseVariant;
          const frameBorderRadius =
            settings.revealStyle === 'circle'
              ? '9999px'
              : effectiveRevealVariant === 'box_dashed'
              ? '0.75rem'
              : '0.5rem';
          const behaviorScale =
            isActiveReveal && settings.revealBehavior === 'zoom_to_diff'
              ? 1.08
              : isActiveReveal && settings.revealBehavior === 'freeze_ring'
              ? 1.03
              : 1;
          const markerGlow =
            usesPersistentSpotlight
              ? `drop-shadow(0 0 ${isActiveReveal ? 16 : 10}px ${hexToRgba(
                  settings.revealColor,
                  isActiveReveal ? 0.5 : 0.26
                )})`
              : isActiveReveal && settings.revealBehavior !== 'marker_only'
              ? `drop-shadow(0 0 12px ${hexToRgba(settings.revealColor, 0.38)})`
              : undefined;

          return (
            <motion.div
              key={regionKey}
              initial={{
                opacity: 0,
                scale: settings.revealBehavior === 'freeze_ring' ? 0.78 : 1.5
              }}
              animate={{ opacity: 1, scale: behaviorScale }}
              transition={{
                duration: settings.revealBehavior === 'cinematic_sequential' ? 0.42 : 0.28,
                ease: [0.22, 1, 0.36, 1]
              }}
              className="absolute z-20"
              style={{
                left: `${(useSquareCircleFrame ? circleLeft : boxLeft) * 100}%`,
                top: `${(useSquareCircleFrame ? circleTop : boxTop) * 100}%`,
                width: `${(useSquareCircleFrame ? circleSize : expandedWidth) * 100}%`,
                height: `${(useSquareCircleFrame ? circleSize : expandedHeight) * 100}%`,
                minWidth: '24px',
                minHeight: '24px',
                filter: markerGlow
              }}
            >
              {usesPersistentSpotlight && (
                <div
                  className="absolute inset-[8%]"
                  style={{
                    borderRadius: frameBorderRadius,
                    background: isActiveReveal
                      ? `radial-gradient(circle, ${hexToRgba(settings.revealColor, 0.3)} 0%, rgba(255,255,255,0.2) 52%, transparent 88%)`
                      : `radial-gradient(circle, rgba(255,255,255,0.16) 0%, ${hexToRgba(
                          settings.revealColor,
                          0.12
                        )} 56%, transparent 88%)`,
                    boxShadow: `0 0 ${isActiveReveal ? 18 : 10}px ${hexToRgba(
                      settings.revealColor,
                      isActiveReveal ? 0.3 : 0.18
                    )}`
                  }}
                />
              )}

              {isActiveReveal &&
                (settings.revealBehavior === 'pulse' ||
                  settings.revealBehavior === 'zoom_to_diff' ||
                  settings.revealBehavior === 'freeze_ring' ||
                  settings.revealBehavior === 'cinematic_sequential') && (
                  <motion.div
                    className="absolute inset-0"
                    animate={{ scale: [1, 1.18, 1.3], opacity: [0.7, 0.25, 0] }}
                    transition={{
                      duration: settings.revealBehavior === 'freeze_ring' ? 0.7 : 1.1,
                      repeat: Number.POSITIVE_INFINITY,
                      ease: 'easeOut'
                    }}
                    style={{
                      borderRadius: frameBorderRadius,
                      border:
                        settings.revealBehavior === 'freeze_ring'
                          ? `${Math.max(3, circleStroke + 1)}px solid ${settings.revealColor}`
                          : `3px solid ${settings.revealColor}`,
                      background:
                        settings.revealBehavior === 'zoom_to_diff'
                          ? `radial-gradient(circle, ${hexToRgba(settings.revealColor, 0.22)} 0%, transparent 72%)`
                          : 'transparent'
                    }}
                  />
                )}

              {isActiveReveal && settings.revealBehavior === 'zoom_to_diff' && (
                <div
                  className="absolute inset-[14%]"
                  style={{
                    borderRadius: frameBorderRadius,
                    background: `linear-gradient(135deg, ${hexToRgba(settings.revealColor, 0.2)} 0%, rgba(255,255,255,0.08) 100%)`,
                    border: `1px solid ${hexToRgba(settings.revealColor, 0.45)}`,
                    backdropFilter: 'blur(3px)'
                  }}
                />
              )}

              {settings.revealStyle === 'box' && effectiveRevealVariant === 'box_glow' && (
                <div
                  className="w-full h-full rounded-md border-4"
                  style={{
                    borderColor: settings.revealColor,
                    boxShadow: outlineStroke > 0 ? `0 0 0 ${outlineStroke}px ${settings.outlineColor}` : undefined
                  }}
                />
              )}

              {settings.revealStyle === 'box' && effectiveRevealVariant === 'box_classic' && (
                <div
                  className="relative w-full h-full rounded-md"
                  style={{
                    borderWidth: `${Math.max(3, circleStroke)}px`,
                    borderStyle: 'solid',
                    borderColor: settings.revealColor,
                    boxShadow: outlineStroke > 0 ? `0 0 0 ${outlineStroke}px ${settings.outlineColor}` : undefined
                  }}
                >
                  <div
                    className="absolute inset-[14%] rounded-[0.35rem] border"
                    style={{
                      borderWidth: `${Math.max(1, circleStroke * 0.45)}px`,
                      borderColor: hexToRgba(settings.revealColor, 0.82)
                    }}
                  />
                </div>
              )}

              {settings.revealStyle === 'box' && effectiveRevealVariant === 'box_minimal' && (
                <div
                  className="w-full h-full rounded-sm"
                  style={{
                    borderWidth: `${Math.max(2, circleStroke * 0.72)}px`,
                    borderStyle: 'solid',
                    borderColor: settings.revealColor,
                    boxShadow: outlineStroke > 0 ? `0 0 0 ${outlineStroke}px ${settings.outlineColor}` : undefined
                  }}
                />
              )}

              {settings.revealStyle === 'box' && effectiveRevealVariant === 'box_dashed' && (
                <div
                  className="w-full h-full rounded-lg border-4 border-dashed"
                  style={{
                    borderColor: settings.revealColor,
                    boxShadow: outlineStroke > 0 ? `0 0 0 ${outlineStroke}px ${settings.outlineColor}` : undefined
                  }}
                />
              )}

              {settings.revealStyle === 'box' && effectiveRevealVariant === 'box_corners' && (
                <div className="relative w-full h-full">
                  <div
                    className="absolute top-0 left-0 w-[34%] h-[34%] border-l-4 border-t-4 rounded-tl-sm"
                    style={{ borderColor: settings.revealColor }}
                  />
                  <div
                    className="absolute top-0 right-0 w-[34%] h-[34%] border-r-4 border-t-4 rounded-tr-sm"
                    style={{ borderColor: settings.revealColor }}
                  />
                  <div
                    className="absolute bottom-0 left-0 w-[34%] h-[34%] border-l-4 border-b-4 rounded-bl-sm"
                    style={{ borderColor: settings.revealColor }}
                  />
                  <div
                    className="absolute bottom-0 right-0 w-[34%] h-[34%] border-r-4 border-b-4 rounded-br-sm"
                    style={{ borderColor: settings.revealColor }}
                  />
                  <div
                    className="absolute inset-0 rounded-md"
                    style={{
                      boxShadow: `inset 0 0 0 1px ${hexToRgba(settings.revealColor, 0.7)}${
                        outlineStroke > 0 ? `, 0 0 0 ${outlineStroke}px ${settings.outlineColor}` : ''
                      }`
                    }}
                  />
                </div>
              )}

              {settings.revealStyle === 'circle' && effectiveRevealVariant === 'circle_classic' && (
                <div
                  className="relative w-full h-full rounded-full"
                  style={{
                    borderWidth: `${circleStroke}px`,
                    borderStyle: 'solid',
                    borderColor: settings.revealColor,
                    boxShadow: outlineStroke > 0 ? `0 0 0 ${outlineStroke}px ${settings.outlineColor}` : undefined
                  }}
                >
                  <div
                    className="absolute inset-[18%] rounded-full border"
                    style={{
                      borderWidth: `${Math.max(1, circleStroke * 0.45)}px`,
                      borderColor: hexToRgba(settings.revealColor, 0.82)
                    }}
                  />
                </div>
              )}

              {settings.revealStyle === 'circle' && effectiveRevealVariant === 'circle_crosshair' && (
                <svg viewBox="0 0 100 100" className="w-full h-full">
                  {outlineStroke > 0 && (
                    <circle
                      cx="50"
                      cy="50"
                      r={Math.max(6, 50 - (circleStroke / 2 + outlineStroke))}
                      fill="none"
                      stroke={settings.outlineColor}
                      strokeWidth={circleStroke + outlineStroke * 2}
                    />
                  )}
                  <circle
                    cx="50"
                    cy="50"
                    r={Math.max(6, 50 - (circleStroke / 2 + outlineStroke))}
                    fill="none"
                    stroke={settings.revealColor}
                    strokeWidth={circleStroke}
                  />
                  {[
                    ['50', '7', '50', '24'],
                    ['50', '76', '50', '93'],
                    ['7', '50', '24', '50'],
                    ['76', '50', '93', '50']
                  ].map(([x1, y1, x2, y2], markerIndex) => (
                    <line
                      key={`${x1}-${y1}-${markerIndex}`}
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke={settings.revealColor}
                      strokeWidth={Math.max(2, circleStroke * 0.72)}
                      strokeLinecap="round"
                    />
                  ))}
                </svg>
              )}

              {settings.revealStyle === 'circle' && effectiveRevealVariant === 'circle_ring' && (
                <div
                  className="w-full h-full rounded-full"
                  style={{
                    borderWidth: `${circleStroke}px`,
                    borderStyle: 'solid',
                    borderColor: settings.revealColor,
                    boxShadow: outlineStroke > 0 ? `0 0 0 ${outlineStroke}px ${settings.outlineColor}` : undefined
                  }}
                />
              )}

              {settings.revealStyle === 'circle' && effectiveRevealVariant === 'circle_dotted' && (
                <svg viewBox="0 0 100 100" className="w-full h-full">
                  {outlineStroke > 0 && (
                    <circle
                      cx="50"
                      cy="50"
                      r={Math.max(6, 50 - (circleStroke / 2 + outlineStroke))}
                      fill="none"
                      stroke={settings.outlineColor}
                      strokeWidth={circleStroke + outlineStroke * 2}
                    />
                  )}
                  <circle
                    cx="50"
                    cy="50"
                    r={Math.max(6, 50 - (circleStroke / 2 + outlineStroke))}
                    fill="none"
                    stroke={settings.revealColor}
                    strokeWidth={circleStroke}
                    strokeLinecap="round"
                    strokeDasharray="1.5 7"
                  />
                </svg>
              )}

              {settings.revealStyle === 'circle' && effectiveRevealVariant === 'circle_ellipse' && (
                <div
                  className="w-full h-full rounded-full"
                  style={{
                    borderWidth: `${circleStroke}px`,
                    borderStyle: 'solid',
                    borderColor: settings.revealColor,
                    boxShadow: outlineStroke > 0 ? `0 0 0 ${outlineStroke}px ${settings.outlineColor}` : undefined
                  }}
                />
              )}

              {settings.revealStyle === 'circle' && effectiveRevealVariant === 'circle_ellipse_dotted' && (
                <svg viewBox="0 0 100 100" className="w-full h-full">
                  {outlineStroke > 0 && (
                    <ellipse
                      cx="50"
                      cy="50"
                      rx={Math.max(8, 50 - (circleStroke / 2 + outlineStroke))}
                      ry={Math.max(6, 42 - (circleStroke / 2 + outlineStroke))}
                      fill="none"
                      stroke={settings.outlineColor}
                      strokeWidth={circleStroke + outlineStroke * 2}
                    />
                  )}
                  <ellipse
                    cx="50"
                    cy="50"
                    rx={Math.max(8, 50 - (circleStroke / 2 + outlineStroke))}
                    ry={Math.max(6, 42 - (circleStroke / 2 + outlineStroke))}
                    fill="none"
                    stroke={settings.revealColor}
                    strokeWidth={circleStroke}
                    strokeLinecap="round"
                    strokeDasharray="2 7"
                  />
                </svg>
              )}

              {settings.revealStyle === 'circle' && effectiveRevealVariant === 'circle_red_black' && (
                <svg viewBox="0 0 100 100" className="w-full h-full">
                  {outlineStroke > 0 && (
                    <circle
                      cx="50"
                      cy="50"
                      r={Math.max(6, 50 - (circleStroke / 2 + outlineStroke))}
                      fill="none"
                      stroke={settings.outlineColor}
                      strokeWidth={circleStroke + outlineStroke * 2}
                    />
                  )}
                  <circle
                    cx="50"
                    cy="50"
                    r={Math.max(6, 50 - (circleStroke / 2 + outlineStroke))}
                    fill="none"
                    stroke="#DC2626"
                    strokeWidth={circleStroke}
                    strokeDasharray="10 10"
                  />
                  <circle
                    cx="50"
                    cy="50"
                    r={Math.max(6, 50 - (circleStroke / 2 + outlineStroke))}
                    fill="none"
                    stroke="#111111"
                    strokeWidth={circleStroke}
                    strokeDasharray="10 10"
                    strokeDashoffset="10"
                  />
                </svg>
              )}

              {settings.revealStyle === 'highlight' && (
                <>
                  {effectiveRevealVariant === 'highlight_classic' ? (
                    <div
                      className="relative w-full h-full rounded-md"
                      style={{
                        borderWidth: '2px',
                        borderStyle: 'solid',
                        borderColor: hexToRgba(settings.revealColor, 0.72),
                        background: `linear-gradient(135deg, rgba(255,255,255,0.12) 0%, ${hexToRgba(settings.revealColor, 0.18)} 100%)`,
                        boxShadow: outlineStroke > 0 ? `0 0 0 ${outlineStroke}px ${settings.outlineColor}` : undefined
                      }}
                    >
                      <div
                        className="absolute inset-[10%] rounded-sm border"
                        style={{
                          borderWidth: '1px',
                          borderColor: hexToRgba(settings.revealColor, 0.34)
                        }}
                      />
                    </div>
                  ) : (
                    <div
                      className="w-full h-full rounded-md border-2"
                      style={{
                        borderColor: hexToRgba(settings.revealColor, 0.8),
                        background: `linear-gradient(135deg, ${hexToRgba(settings.revealColor, 0.3)} 0%, ${hexToRgba(settings.revealColor, 0.55)} 100%)`,
                        boxShadow: `${outlineStroke > 0 ? `0 0 0 ${outlineStroke}px ${settings.outlineColor}, ` : ''}0 0 10px ${hexToRgba(settings.revealColor, 0.4)}`
                      }}
                    />
                  )}
                </>
              )}

              {isActiveReveal && settings.revealBehavior === 'cinematic_sequential' && (
                <div
                  className="absolute -top-3 -right-3 w-8 h-8 rounded-full border-2 flex items-center justify-center text-[11px] font-black"
                  style={{
                    backgroundColor: '#FFFFFF',
                    color: '#111827',
                    borderColor: settings.revealColor,
                    boxShadow: `0 0 0 2px ${hexToRgba(settings.revealColor, 0.18)}`
                  }}
                >
                  {index + 1}
                </div>
              )}
            </motion.div>
          );
        })}
    </AnimatePresence>
  );

  const rootClassName = embedded
    ? 'relative flex h-full w-full items-center justify-center overflow-hidden'
    : 'flex flex-col items-center justify-center min-h-[100dvh] overflow-hidden relative';
  const playbackControlsVisible = !hidePlaybackControls && phase !== 'finished';
  const controlsContainerClass = embedded
    ? 'absolute bottom-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-full border-2 border-black bg-white/96 px-2 py-1.5 shadow-[0_4px_0px_0px_rgba(0,0,0,1)]'
    : 'absolute bottom-4 sm:bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center space-x-4 sm:space-x-6';
  const controlButtonClass = embedded
    ? 'flex h-10 w-10 items-center justify-center rounded-full border-2 border-black bg-white transition-all group hover:bg-[var(--hover-bg)]'
    : 'p-3 sm:p-4 bg-white border-4 border-black rounded-full transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] group hover:bg-[var(--hover-bg)]';
  const controlIconSize = embedded ? 20 : 28;
  const renderHeaderLogo = () => {
    if (!shouldRenderCustomLogo || !renderedLogoSrc) return null;
    return (
      <div
        className="absolute flex items-center justify-center shrink-0 overflow-visible"
        style={{
          ...(hudLayout.logoPosition ?? {}),
          width: `${hudLayout.logoSize}px`,
          height: `${hudLayout.logoSize}px`
        }}
      >
        {renderLogoImage(hudLayout.logoSize)}
      </div>
    );
  };
  const renderStyledHeaderBlock = () => {
    if (!shouldRenderHeaderText && !shouldRenderInlineLogo) {
      return null;
    }

    const wrapperVariant = styleModules.header.variant;
    const needsPanel = wrapperVariant === 'panel' || wrapperVariant === 'ribbon';
    const wrapperStyle: React.CSSProperties = {
      alignItems: hudLayout.titleAlignItems
    };

    if (needsPanel) {
      wrapperStyle.padding = wrapperVariant === 'ribbon' ? '9px 14px 8px 18px' : '8px 14px';
      wrapperStyle.border = '2px solid #000000';
      wrapperStyle.borderRadius = '18px';
      wrapperStyle.background = 'rgba(255,255,255,0.22)';
      wrapperStyle.boxShadow = '2px 2px 0px 0px rgba(0,0,0,1)';
      wrapperStyle.backdropFilter = 'blur(5px)';
      wrapperStyle.position = 'relative';
    }

    const subtitleBadgeStyle: React.CSSProperties = {
      display: 'inline-flex',
      alignItems: 'center',
      marginTop: `${hudLayout.subtitleGap ?? 0}px`,
      alignSelf:
        hudLayout.titleAlignItems === 'center'
          ? 'center'
          : hudLayout.titleAlignItems === 'flex-end'
          ? 'flex-end'
          : 'flex-start',
      padding: '4px 10px',
      border: '2px solid #000000',
      borderRadius: '999px',
      backgroundColor: 'rgba(255,255,255,0.7)',
      color: visualTheme.headerSubText,
      fontSize: `${Math.max(10, hudLayout.subtitleFontSize - 1)}px`,
      letterSpacing: `${hudLayout.subtitleLetterSpacingEm}em`
    };

    return (
      <div
        className="absolute flex items-center"
        style={{ ...hudLayout.titlePosition, gap: `${hudLayout.titleGap}px`, zIndex: 20 }}
      >
        {shouldRenderInlineLogo && renderedLogoSrc && (
          <div
            className="relative flex items-center justify-center shrink-0 overflow-visible"
            style={{ width: `${hudLayout.logoSize}px`, height: `${hudLayout.logoSize}px` }}
          >
            {renderLogoImage(hudLayout.logoSize)}
          </div>
        )}

        {shouldRenderHeaderText && (
          <div className="flex flex-col" style={wrapperStyle}>
            {wrapperVariant === 'ribbon' && (
              <div
                className="absolute inset-y-2 left-0 w-[6px] rounded-full"
                style={{ backgroundColor: visualTheme.timerDot }}
              />
            )}
            <h2
              className={`font-black leading-none ${hudLayout.titleFontClass}`}
              style={{
                color: visualTheme.headerText,
                fontSize: `${hudLayout.titleFontSize}px`,
                letterSpacing: `${styleModules.text.titleLetterSpacingEm}em`,
                textTransform: styleModules.text.titleTransform === 'upper' ? 'uppercase' : undefined
              }}
            >
              {styledHeaderTitle}
            </h2>
            {wrapperVariant === 'split' ? (
              <span className={hudLayout.subtitleFontClass} style={subtitleBadgeStyle}>
                {styledHeaderSubtitle}
              </span>
            ) : (
              <span
                className={`font-bold leading-none ${hudLayout.subtitleFontClass}`}
                style={{
                  color: visualTheme.headerSubText,
                  fontSize: `${hudLayout.subtitleFontSize}px`,
                  letterSpacing: `${hudLayout.subtitleLetterSpacingEm}em`,
                  marginTop: `${hudLayout.subtitleGap ?? 0}px`,
                  textTransform:
                    styleModules.text.subtitleTransform === 'upper' ? 'uppercase' : undefined
                }}
              >
                {styledHeaderSubtitle}
              </span>
            )}
            {wrapperVariant === 'underline' && (
              <div
                className="mt-2 h-[4px] rounded-full"
                style={{
                  width: `${Math.max(42, Math.round(hudLayout.titleFontSize * 2.35))}px`,
                  backgroundColor: visualTheme.timerDot,
                  alignSelf:
                    hudLayout.titleAlignItems === 'center'
                      ? 'center'
                      : hudLayout.titleAlignItems === 'flex-end'
                      ? 'flex-end'
                      : 'flex-start'
                }}
              />
            )}
          </div>
        )}
      </div>
    );
  };
  const renderTextProgressDisplay = () => {
    if (!shouldShowHeaderProgress || !isTextFillProgress) {
      return null;
    }

    const gradientId = `${textProgressId}-gradient`;
    const clipId = `${textProgressId}-clip`;
    const sweepGradientId = `${textProgressId}-sweep`;
    const width = progressTextWidthPx;
    const height = progressTextHeightPx;
    const generatedTextProgressStyle = settings.generatedProgressEnabled ? settings.generatedProgressStyle : null;
    const textProgressShellStyle = resolveTextProgressShellStyle(
      generatedTextProgressStyle,
      textProgressFillColors
    );
    const fontSize = Math.max(12, Math.round(textProgressFontSize * textProgressShellStyle.fontScale));
    const strokeWidth = Math.max(2, Math.round(textProgressStrokeWidth * textProgressShellStyle.strokeScale));
    const textY = Math.round(height * 0.68);
    const shellFill = textProgressShellStyle.fill;
    const shellStroke = textProgressShellStyle.stroke;
    const textSpan = measureTextProgressSpan(
      styledProgressLabel,
      width,
      fontSize,
      styleModules.text.titleCanvasFamily,
      styleModules.text.titleCanvasWeight
    );
    const fillX = Math.max(0, Math.min(width, textSpan.left));
    const fillWidth = Math.max(0, Math.min(textSpan.width, (textSpan.width * displayedProgressPercent) / 100));
    const textProgressEffects = resolveTextProgressEffectFrame({
      style: generatedTextProgressStyle,
      width,
      height,
      fillX,
      fillWidth,
      spanWidth: textSpan.width,
      fillRatio: textSpan.width > 0 ? fillWidth / textSpan.width : 0,
      animationSeconds: phaseElapsed,
      fillColors: textProgressFillColors
    });
    const textProgressBaseAccent = resolveTextProgressBaseAccent(
      generatedTextProgressStyle,
      textProgressFillColors
    );
    const shouldShowTextProgressSweep = progressMotionState.sweepActive;
    const textSweepWidth = Math.max(18, Math.round(textSpan.width * 0.18));
    const textSweepX = fillX + textSpan.width * progressMotionState.sweepProgress - textSweepWidth / 2;

    return (
      <div
        className="absolute pointer-events-none z-10"
        style={{ ...progressTrackPosition, width: `${width}px`, height: `${height}px`, overflow: 'visible' }}
      >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="block h-full w-full overflow-visible"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={textProgressFillColors.start} />
              <stop offset="58%" stopColor={textProgressFillColors.middle} />
              <stop offset="100%" stopColor={textProgressFillColors.end} />
            </linearGradient>
            <linearGradient id={sweepGradientId} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(255,255,255,0)" />
              <stop offset="30%" stopColor="rgba(255,255,255,0.06)" />
              <stop offset="50%" stopColor="rgba(255,255,255,0.28)" />
              <stop offset="70%" stopColor="rgba(255,255,255,0.06)" />
              <stop offset="100%" stopColor="rgba(255,255,255,0)" />
            </linearGradient>
            <clipPath id={clipId}>
              <text
                x={width / 2}
                y={textY}
                textAnchor="middle"
                fontFamily={styleModules.text.titleCanvasFamily}
                fontWeight={styleModules.text.titleCanvasWeight}
                fontSize={fontSize}
              >
                {styledProgressLabel}
              </text>
            </clipPath>
          </defs>
          <text
            x={width / 2}
            y={textY}
            textAnchor="middle"
            fontFamily={styleModules.text.titleCanvasFamily}
            fontWeight={styleModules.text.titleCanvasWeight}
            fontSize={fontSize}
            fill={shellFill}
            stroke={shellStroke}
            strokeWidth={strokeWidth}
            paintOrder="stroke fill"
          >
            {styledProgressLabel}
          </text>
          <g clipPath={`url(#${clipId})`}>
            <rect x={fillX} y="0" width={fillWidth} height={height} fill={`url(#${gradientId})`} />
            {textProgressBaseAccent && (
              <rect
                x={fillX}
                y="0"
                width={fillWidth}
                height={height}
                fill={textProgressBaseAccent}
                opacity={0.08}
              />
            )}
            {textProgressEffects.bands.map((band, index) => (
              <rect
                key={`band-${index}`}
                x={band.x - band.width / 2}
                y={band.y - band.height / 2}
                width={band.width}
                height={band.height}
                fill={band.color}
                opacity={band.opacity}
                transform={`rotate(${band.angle} ${band.x} ${band.y})`}
              />
            ))}
            {textProgressEffects.orbs.map((orb, index) => (
              <ellipse
                key={`orb-${index}`}
                cx={orb.cx}
                cy={orb.cy}
                rx={orb.rx}
                ry={orb.ry}
                fill={orb.color}
                opacity={orb.opacity}
              />
            ))}
            {shouldShowTextProgressSweep && (
              <rect
                x={textSweepX}
                y="0"
                width={textSweepWidth}
                height={height}
                fill={`url(#${sweepGradientId})`}
                opacity={progressMotionState.sweepOpacity}
              />
            )}
          </g>
        </svg>
      </div>
    );
  };
  const renderSceneCard = (kind: 'intro' | 'transition' | 'outro') => {
    const variant =
      kind === 'intro'
        ? styleModules.sceneCards.intro
        : kind === 'outro'
        ? styleModules.sceneCards.outro
        : styleModules.sceneCards.transition;
    const eyebrow = applyTextTransform(
      kind === 'intro' ? introEyebrow : kind === 'outro' ? completionEyebrow : transitionEyebrow,
      styleModules.text.subtitleTransform
    );
    const title = applyTextTransform(
      kind === 'intro' ? introTitle : kind === 'outro' ? completionTitle : transitionTitle,
      styleModules.text.titleTransform
    );
    const subtitle =
      applyTextTransform(
        kind === 'intro'
          ? introSubtitle
          : kind === 'outro'
          ? completionSubtitle
          : transitionSubtitle,
        styleModules.text.subtitleTransform
      );
    const Icon = kind === 'intro' ? Play : kind === 'outro' ? CheckCircle : SkipForward;
    const overlayStyle =
      variant === 'storybook'
        ? {
            background: `linear-gradient(180deg, rgba(52,35,14,${kind === 'transition' ? (0.24 + transitionSmooth * 0.44).toFixed(3) : '0.48'}) 0%, rgba(19,11,4,0.74) 100%)`,
            backdropFilter: `blur(${kind === 'transition' ? (1.4 + transitionSmooth * 2.2).toFixed(2) : '4.2'}px)`
          }
        : variant === 'spotlight'
        ? {
            background: `radial-gradient(circle at center, rgba(15,23,42,${kind === 'transition' ? (0.18 + transitionSmooth * 0.2).toFixed(3) : '0.12'}) 0%, rgba(2,6,23,0.88) 72%, rgba(1,4,14,0.96) 100%)`,
            backdropFilter: `blur(${kind === 'transition' ? (1.6 + transitionSmooth * 2.6).toFixed(2) : '4.4'}px)`
          }
        : variant === 'celebration'
        ? {
            background: `radial-gradient(circle at top, rgba(255,255,255,${kind === 'transition' ? (0.22 + transitionSmooth * 0.12).toFixed(3) : '0.26'}) 0%, rgba(17,24,39,0.2) 100%)`,
            backdropFilter: `blur(${kind === 'transition' ? (1 + transitionSmooth * 2).toFixed(2) : '3.4'}px)`
          }
        : variant === 'scoreboard'
        ? {
            background: `radial-gradient(circle at top, rgba(34,211,238,${kind === 'transition' ? (0.16 + transitionSmooth * 0.16).toFixed(3) : '0.14'}) 0%, rgba(8,15,28,0.82) 58%, rgba(2,6,16,0.92) 100%)`,
            backdropFilter: `blur(${kind === 'transition' ? (1.2 + transitionSmooth * 2).toFixed(2) : '4'}px)`
          }
        : {
            background: `linear-gradient(180deg, rgba(255,255,255,${kind === 'transition' ? (0.18 + transitionSmooth * 0.16).toFixed(3) : '0.22'}) 0%, rgba(17,24,39,0.18) 100%)`,
            backdropFilter: `blur(${kind === 'transition' ? (1 + transitionSmooth * 1.6).toFixed(2) : '3'}px)`
          };
    const cardStyle =
      variant === 'storybook'
        ? {
            borderColor: '#4D3E26',
            background: 'linear-gradient(180deg, rgba(248,232,194,0.97) 0%, rgba(216,177,73,0.94) 100%)',
            color: '#2E2414',
            boxShadow: `0 0 0 1px rgba(255,236,188,0.45), 0 24px 72px rgba(57,39,14,0.42), 0 0 36px rgba(229,191,115,${
              kind === 'transition' ? transitionCardGlowOpacity.toFixed(3) : '0.22'
            })`
          }
        : variant === 'spotlight'
        ? {
            borderColor: visualTheme.timerDot,
            background: 'linear-gradient(180deg, rgba(15,23,42,0.96) 0%, rgba(2,6,23,0.98) 100%)',
            color: '#F8FAFC',
            boxShadow: `0 0 0 1px rgba(255,255,255,0.12), 0 26px 80px rgba(0,0,0,0.56), 0 0 36px rgba(255,255,255,${
              kind === 'transition' ? transitionCardGlowOpacity.toFixed(3) : '0.12'
            })`
          }
        : variant === 'celebration'
        ? {
            borderColor: '#111827',
            background: `linear-gradient(180deg, ${visualTheme.headerBg} 0%, ${visualTheme.completionBg} 100%)`,
            color: '#111827',
            boxShadow: `0 24px 72px rgba(15,23,42,0.22), 0 0 0 1px rgba(17,24,39,0.08), 0 0 32px rgba(255,255,255,${
              kind === 'transition' ? transitionCardGlowOpacity.toFixed(3) : '0.18'
            })`
          }
        : variant === 'scoreboard'
        ? {
            borderColor: visualTheme.headerBg,
            background: 'linear-gradient(180deg, rgba(13,20,37,0.96) 0%, rgba(3,7,17,0.98) 100%)',
            color: '#F8FAFC',
            boxShadow: `0 0 0 1px rgba(189,233,255,0.28), 0 26px 80px rgba(0,0,0,0.48), 0 0 42px rgba(90,223,255,${
              kind === 'transition' ? transitionCardGlowOpacity.toFixed(3) : '0.18'
            })`
          }
        : {
            borderColor: '#111827',
            background: 'linear-gradient(180deg, rgba(255,255,255,0.97) 0%, rgba(242,232,213,0.95) 100%)',
            color: '#111827',
            boxShadow: '0 24px 72px rgba(15,23,42,0.18), 0 0 0 1px rgba(17,24,39,0.08)'
          };
    const badgeStyle =
      variant === 'scoreboard'
        ? {
            backgroundColor: hexToRgba(visualTheme.headerBg, 0.16),
            color: visualTheme.headerBg,
            borderColor: hexToRgba(visualTheme.headerBg, 0.7)
          }
        : variant === 'spotlight'
        ? {
            backgroundColor: 'rgba(255,255,255,0.08)',
            color: '#F8FAFC',
            borderColor: 'rgba(255,255,255,0.18)'
          }
        : variant === 'celebration'
        ? {
            backgroundColor: 'rgba(255,255,255,0.62)',
            color: '#111827',
            borderColor: 'rgba(17,24,39,0.18)'
          }
        : variant === 'storybook'
        ? {
            backgroundColor: 'rgba(255,248,230,0.84)',
            color: '#5A4320',
            borderColor: '#8B6D33'
          }
        : {
            backgroundColor: 'rgba(255,255,255,0.78)',
            color: '#475569',
            borderColor: '#CBD5E1'
          };

    return (
      <div className="absolute inset-0 z-40 pointer-events-none overflow-hidden">
        <div className="absolute inset-0" style={overlayStyle} />
        <motion.div
          initial={kind === 'transition' ? false : { opacity: 0, y: 24, scale: 0.96 }}
          animate={
            kind === 'transition'
              ? undefined
              : {
                  opacity: 1,
                  y: 0,
                  scale: 1
                }
          }
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="absolute left-1/2 top-1/2 overflow-hidden rounded-[28px] border-[3px] px-8 py-7 text-center"
          style={{
            transform:
              kind === 'transition'
                ? `translate(-50%, calc(-50% + ${transitionCardTranslateY}px)) scale(${transitionCardScale.toFixed(
                    3
                  )})`
                : 'translate(-50%, -50%)',
            opacity: kind === 'transition' ? transitionCardOpacity : 1,
            minWidth: isVerticalLayout ? '300px' : '520px',
            maxWidth: embedded ? '88%' : '72%',
            ...cardStyle
          }}
        >
          <div className="absolute inset-x-0 top-0 h-2 opacity-90" style={{ backgroundColor: variant === 'standard' ? '#D97706' : visualTheme.headerBg }} />
          <div className="relative flex flex-col items-center">
            <div
              className="mb-4 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[11px] font-black uppercase tracking-[0.28em]"
              style={badgeStyle}
            >
              <Icon size={14} strokeWidth={2.5} />
              <span>{eyebrow}</span>
            </div>
            <p
              className={`text-4xl ${isVerticalLayout ? 'sm:text-5xl' : 'sm:text-6xl'} font-black leading-none ${styleModules.text.titleFontClass}`}
              style={{
                letterSpacing:
                  variant === 'storybook'
                    ? `${Math.max(0, styleModules.text.titleLetterSpacingEm)}em`
                    : `${Math.max(0.02, styleModules.text.titleLetterSpacingEm)}em`
              }}
            >
              {title}
            </p>
            <p
              className={`mt-3 text-sm sm:text-base font-bold tracking-[0.18em] opacity-80 ${styleModules.text.subtitleFontClass}`}
              style={{
                color: variant === 'scoreboard' || variant === 'spotlight' ? '#CBD5E1' : undefined,
                letterSpacing: `${styleModules.text.subtitleLetterSpacingEm}em`
              }}
            >
              {subtitle}
            </p>
            <div className="mt-6 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[11px] font-black uppercase tracking-[0.18em] opacity-80">
              <span>{settings.aspectRatio}</span>
            </div>
          </div>
        </motion.div>
      </div>
    );
  };
  const renderTransitionOverlay = () => (
    <div className="absolute inset-0 z-40 pointer-events-none overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(180deg, rgba(6,11,20,${(
            transitionSequenceState.overlayOpacity * 0.54
          ).toFixed(3)}) 0%, rgba(6,11,20,${(transitionSequenceState.overlayOpacity * 0.78).toFixed(
            3
          )}) 100%)`
        }}
      />
      <div className="absolute inset-0 flex items-center justify-center px-8">
        <div
          className="flex max-w-[82%] flex-col items-center text-center"
          style={{
            opacity: transitionSequenceState.titleOpacity,
            transform: `translateY(${transitionSequenceState.titleTranslateY.toFixed(1)}px)`
          }}
        >
          <div
            className={`font-black leading-[0.94] ${isVerticalLayout ? 'text-5xl sm:text-6xl' : 'text-6xl sm:text-7xl'} ${styleModules.text.titleFontClass}`}
            style={{
              color: '#F8FAFC',
              letterSpacing: `${Math.max(0.02, styleModules.text.titleLetterSpacingEm)}em`,
              textShadow: '0 10px 32px rgba(0,0,0,0.36)'
            }}
          >
            <span>{typedTransitionTitle.text || ' '}</span>
            {typedTransitionTitle.visibleGlyphs < typedTransitionTitle.totalGlyphs && (
              <span className="ml-2 inline-block animate-pulse align-baseline opacity-80">|</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
  const completionCardStyle =
    styleModules.sceneCards.outro === 'storybook'
      ? {
          backgroundColor: '#F3E6C4',
          borderColor: '#4D3E26',
          textColor: '#2E2414',
          shadow: '16px 16px 0px 0px rgba(77,62,38,0.92)'
        }
      : styleModules.sceneCards.outro === 'scoreboard'
      ? {
          backgroundColor: '#09111F',
          borderColor: visualTheme.headerBg,
          textColor: '#F8FAFC',
          shadow: '16px 16px 0px 0px rgba(34,211,238,0.24)'
        }
      : styleModules.sceneCards.outro === 'spotlight'
      ? {
          backgroundColor: '#08111F',
          borderColor: visualTheme.timerDot,
          textColor: '#F8FAFC',
          shadow: '16px 16px 0px 0px rgba(255,255,255,0.12)'
        }
      : styleModules.sceneCards.outro === 'celebration'
      ? {
          backgroundColor: visualTheme.completionBg,
          borderColor: '#111827',
          textColor: '#111827',
          shadow: '16px 16px 0px 0px rgba(15,23,42,0.2)'
        }
      : {
          backgroundColor: '#FFFFFF',
          borderColor: '#111827',
          textColor: '#111827',
          shadow: '16px 16px 0px 0px rgba(15,23,42,0.18)'
        };
  const renderFinalCommentPrompt = () => {
    if (!finalCommentPromptVisible) {
      return null;
    }

    const promptFontSize = Math.max(16, Math.round(24 * stageMetrics.scale));
    const promptLineWidth = Math.max(260, Math.round(stageMetrics.baseWidth * 0.78));
    const promptLetterSpacing = Math.min(
      0.12,
      Math.max(0.02, styleModules.text.subtitleLetterSpacingEm * 0.4)
    );

    return (
      <div
        className="absolute pointer-events-none z-[55] -translate-x-1/2 -translate-y-1/2"
        style={finalCommentPromptPosition}
      >
        <div
          className="flex flex-col items-center gap-2"
          style={{ width: `${promptLineWidth}px`, maxWidth: '82%' }}
        >
          {finalCommentPromptLines.map((line, index) => (
            <div
              key={`${index}-${line}`}
              className={`w-fit max-w-full rounded-2xl border-2 border-white/20 bg-black/78 px-4 py-2 text-center font-black leading-tight text-white shadow-[0_8px_24px_rgba(0,0,0,0.4)] ${styleModules.text.subtitleFontClass}`}
              style={{
                fontSize: `${promptFontSize}px`,
                letterSpacing: `${promptLetterSpacing}em`
              }}
            >
              {line}
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (!hasPuzzles) {
    return (
      <div
        ref={viewportRef}
        className={rootClassName}
        style={{ backgroundColor: embedded ? 'transparent' : visualTheme.rootBg }}
      >
        {!embedded && (
          <div className="absolute top-6 left-6 z-50">
            <button
              onClick={onExit}
              className="p-3 bg-white border-4 border-black rounded-xl hover:bg-black hover:text-white transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
            >
              <ArrowLeft size={24} strokeWidth={3} />
            </button>
          </div>
        )}

        <div className="w-full max-w-lg mx-4 p-8 rounded-2xl border-4 border-black bg-white text-center shadow-[10px_10px_0px_0px_rgba(0,0,0,1)]">
          <h2 className="text-3xl font-black uppercase text-black">No Puzzles</h2>
          <p className="mt-3 text-sm font-bold text-black/70">Nothing to play in video mode.</p>
          {!embedded && (
            <button
              onClick={onExit}
              className="mt-6 px-6 py-3 bg-black text-white text-sm font-black uppercase tracking-wide rounded-xl border-4 border-black hover:bg-slate-900 transition-colors"
            >
              Back
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={viewportRef}
      className={rootClassName}
      style={{ backgroundColor: embedded ? 'transparent' : visualTheme.rootBg }}
    >
      
      {/* External Back Button - Top Left */}
      {!embedded && (
        <div className="absolute top-6 left-6 z-50">
          <button 
            onClick={onExit}
            className="p-3 bg-white border-4 border-black rounded-xl hover:bg-black hover:text-white transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
          >
            <ArrowLeft size={24} strokeWidth={3} />
          </button>
        </div>
      )}
      {!embedded && onSendToEditor && (
        <div className="absolute top-6 right-6 z-50">
          <button
            onClick={onSendToEditor}
            className="inline-flex items-center gap-2 px-4 py-3 bg-white border-4 border-black rounded-xl hover:bg-black hover:text-white transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] text-xs font-black uppercase tracking-wide"
          >
            <Send size={16} strokeWidth={3} />
            <span>Send To Editor</span>
          </button>
        </div>
      )}

      {/* External Playback Controls - Bottom Center */}
      {playbackControlsVisible && (
        <div className={controlsContainerClass}>
          <button 
            onClick={handleTogglePlayback} 
            className={controlButtonClass}
            style={{ '--hover-bg': visualTheme.playHoverBg } as React.CSSProperties}
          >
            {isPlaying ? (
              <Pause size={controlIconSize} strokeWidth={3} className="group-hover:scale-110 transition-transform" />
            ) : (
              <Play size={controlIconSize} strokeWidth={3} className="ml-1 group-hover:scale-110 transition-transform" />
            )}
          </button>
          <button 
            onClick={handleSkip} 
            className={controlButtonClass}
            style={{ '--hover-bg': visualTheme.skipHoverBg } as React.CSSProperties}
          >
            <SkipForward size={controlIconSize} strokeWidth={3} className="group-hover:scale-110 transition-transform"/>
          </button>
        </div>
      )}

      {/* Fixed Stage Container - Scales Uniformly With Screen */}
      <div
        className="relative z-10"
        style={{
          width: `${stageMetrics.scaledWidth}px`,
          height: `${stageMetrics.scaledHeight}px`
        }}
      >
        <div
          ref={containerRef}
          className={`absolute top-0 left-0 rounded-none overflow-hidden flex flex-col ${
            showIntroClip ? 'bg-black border-0' : 'bg-white border-4 border-black'
          }`}
          style={{
            width: `${stageMetrics.baseWidth}px`,
            height: `${stageMetrics.baseHeight}px`,
            transform: `scale(${stageMetrics.scale})`,
            transformOrigin: 'top left',
            backgroundColor: showIntroClip ? '#000000' : isStorybookStyle ? '#E5D19A' : visualTheme.gameBg,
            borderColor: showIntroClip ? 'transparent' : isStorybookStyle ? '#3F301A' : '#000000',
            boxShadow: 'none'
          }}
        >
        {phase === 'intro' && introVideoUrl && (
          <video
            ref={introVideoRef}
            key={introVideoUrl}
            src={introVideoUrl}
            muted={!introClipAudioEnabled}
            playsInline
            preload="auto"
            className="absolute h-0 w-0 opacity-0 pointer-events-none"
            aria-hidden="true"
            onLoadedData={() => {
              setIntroVideoReady(true);
              setIntroVideoError(false);
              const video = introVideoRef.current;
              if (video) {
                try {
                  video.currentTime = 0;
                } catch {
                  // Ignore seek issues until metadata is ready.
                }
              }
            }}
            onCanPlay={() => {
              setIntroVideoReady(true);
              setIntroVideoError(false);
            }}
            onError={() => {
              setIntroVideoReady(false);
              setIntroVideoError(true);
            }}
          />
        )}
        {showIntroClip && introPreviewFrameUrl && (
          <img
            src={introPreviewFrameUrl}
            alt="Intro clip preview"
            className="absolute inset-0 h-full w-full object-cover pointer-events-none z-0"
          />
        )}
        {generatedBackgroundCoversHeader && currentGeneratedBackground && (
          <div className="absolute inset-0 z-0 pointer-events-none">
            <GeneratedBackgroundCanvas
              spec={currentGeneratedBackground}
              className="h-full w-full"
              timeSeconds={generatedBackgroundPlaybackTime}
            />
          </div>
        )}
        {!showIntroClip && (
        <>
        {/* HUD Header */}
        {isStorybookStyle ? (
          <div
            className="relative shrink-0 z-20 border-b-[3px]"
            style={{
              height: `${hudLayout.headerHeight}px`,
              borderColor: '#3F301A',
              background:
                generatedBackgroundCoversHeader
                  ? 'linear-gradient(180deg, rgba(228,201,108,0.84) 0%, rgba(216,177,73,0.8) 38%, rgba(199,154,49,0.84) 100%)'
                  : 'linear-gradient(180deg, #E4C96C 0%, #D8B149 38%, #C79A31 100%)',
              boxShadow: 'inset 0 -2px 0 rgba(69, 53, 23, 0.55), inset 0 2px 0 rgba(255, 244, 203, 0.6)'
            }}
          >
            {shouldRenderHeaderText && (
              <div className="absolute left-4 top-1/2 z-20 -translate-y-1/2">
                <h2
                  className="leading-none lowercase"
                  style={{
                    color: '#2E2414',
                    fontSize: '52px',
                    fontWeight: 800,
                    fontFamily: 'Georgia, "Times New Roman", serif',
                    letterSpacing: '-0.02em',
                    textShadow: '0 1px 0 rgba(255, 240, 190, 0.55)'
                  }}
                >
                  {headerTitle.toLowerCase()}
                </h2>
              </div>
            )}

            {renderHeaderLogo()}

            {shouldShowHeaderProgress && (
              <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 w-[33%]">
                <div
                  className="relative h-[26px] rounded-[14px] border-[3px]"
                  style={{
                    borderColor: '#3F301A',
                    background: 'linear-gradient(180deg, #9A7B3E 0%, #82622C 100%)',
                    boxShadow: 'inset 0 1px 0 rgba(255, 235, 176, 0.5)'
                  }}
                >
                  <motion.div
                    className="absolute top-[3px] bottom-[3px] left-[3px] rounded-[10px]"
                    style={{
                      width: `${Math.max(0, Math.min(100, progressPercent))}%`,
                      background: 'linear-gradient(90deg, #E6D4A6 0%, #C3A35D 60%, #8D6A2A 100%)'
                    }}
                  />
                </div>
              </div>
            )}

            {shouldShowHeaderTimer && (
              <>
                <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-3">
                  <span
                    className="font-black"
                    style={{
                      color: '#2E2414',
                      fontSize: '34px',
                      fontFamily: 'Georgia, "Times New Roman", serif'
                    }}
                  >
                    {safeCurrentIndex + 1}/{puzzles.length}
                  </span>
                  <div
                    className="px-3 py-1 rounded-[14px] border-[3px]"
                    style={{
                      borderColor: '#3F301A',
                      background: 'linear-gradient(180deg, #6E5530 0%, #4A3C24 100%)',
                      color: '#F7E8C2',
                      fontSize: '30px',
                      fontWeight: 900,
                      fontFamily: 'Georgia, "Times New Roman", serif',
                      lineHeight: 1
                    }}
                  >
                    {formatTime(timeLeft)}s
                  </div>
                </div>
              </>
            )}
          </div>
        ) : (
          <div
            className="relative border-b-4 border-black shrink-0 z-20"
            style={{
              backgroundColor: generatedBackgroundCoversHeader
                ? hexToRgba(visualTheme.headerBg, isClassicStyle ? 0.88 : 0.82)
                : visualTheme.headerBg,
              height: `${hudLayout.headerHeight}px`
            }}
          >
            {renderHeaderLogo()}

            {isClassicStyle ? (
              <>
                {shouldShowClassicPuzzleBadge && (
                  <div
                    className="absolute flex items-center border-2"
                    style={{
                      left: `${CLASSIC_HUD_SPEC.puzzleBadge.left}px`,
                      top: `${CLASSIC_HUD_SPEC.puzzleBadge.top}px`,
                      minWidth: `${CLASSIC_HUD_SPEC.puzzleBadge.minWidth}px`,
                      height: `${CLASSIC_HUD_SPEC.puzzleBadge.height}px`,
                      padding: `${CLASSIC_HUD_SPEC.puzzleBadge.padY}px ${CLASSIC_HUD_SPEC.puzzleBadge.padX}px`,
                      borderRadius: `${CLASSIC_HUD_SPEC.puzzleBadge.radius}px`,
                      borderColor: CLASSIC_HUD_SPEC.puzzleBadge.border,
                      background: CLASSIC_HUD_SPEC.puzzleBadge.background,
                      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.55), 0 2px 0 rgba(0,0,0,0.35)',
                      gap: `${CLASSIC_HUD_SPEC.puzzleBadge.gap}px`
                    }}
                  >
                    <span
                      className="font-black leading-none"
                      style={{
                        color: '#111827',
                        fontSize: `${CLASSIC_HUD_SPEC.puzzleBadge.labelSize}px`,
                        letterSpacing: `${Math.max(0.18, styleModules.text.subtitleLetterSpacingEm)}em`,
                        fontFamily: styleModules.text.subtitleCanvasFamily,
                        textTransform:
                          styleModules.text.subtitleTransform === 'upper' ? 'uppercase' : undefined
                      }}
                    >
                      {applyTextTransform(puzzleBadgeLabel, styleModules.text.subtitleTransform)}
                    </span>
                    <span
                      className="font-black leading-none"
                      style={{
                        color: '#020617',
                        fontFamily: styleModules.text.titleCanvasFamily,
                        fontSize: `${classicBadgeValueFontSize}px`,
                        textShadow: '0 1px 0 rgba(255,255,255,0.35)'
                      }}
                    >
                      {safeCurrentIndex + 1}/{puzzles.length}
                    </span>
                  </div>
                )}

                {shouldRenderHeaderText && (
                  <div className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
                    <h2
                      className="font-black leading-none"
                      style={{
                        fontFamily: styleModules.text.titleCanvasFamily,
                        fontSize: `${classicCenterTitleFontSize}px`,
                        letterSpacing: `${Math.max(
                          CLASSIC_HUD_SPEC.centerTitle.letterSpacingEm,
                          styleModules.text.titleLetterSpacingEm
                        )}em`,
                        background: CLASSIC_HUD_SPEC.centerTitle.fillGradient,
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        WebkitTextStroke: `1px ${CLASSIC_HUD_SPEC.centerTitle.strokeColor}`,
                        filter: CLASSIC_HUD_SPEC.centerTitle.glowCss,
                        whiteSpace: 'nowrap',
                        textTransform:
                          styleModules.text.titleTransform === 'upper' ? 'uppercase' : undefined
                      }}
                    >
                      {applyTextTransform(headerTitle, styleModules.text.titleTransform)}
                    </h2>
                  </div>
                )}
              </>
            ) : shouldRenderHeaderText || shouldRenderInlineLogo ? (
              renderStyledHeaderBlock()
            ) : null}

            {shouldShowHeaderTimer && (
              <div className="absolute" style={hudLayout.timerPosition}>
                <VideoTimerDisplay
                  style={styleModules.timer}
                  visualTheme={visualTheme}
                  valueText={`${formatTime(timeLeft)}s`}
                  fontSize={hudLayout.timerFontSize}
                  padX={hudLayout.timerPadX}
                  padY={hudLayout.timerPadY}
                  dotSize={hudLayout.timerDotSize}
                  gap={hudLayout.timerGap}
                  minWidth={hudLayout.timerMinWidth}
                  justifyContent={hudLayout.timerJustify}
                  isAlert={timeLeft <= 2}
                  durationSeconds={phaseDuration}
                  remainingSeconds={timeLeft}
                  progress={countdownPercent / 100}
                />
              </div>
            )}

            {shouldShowHeaderProgress && (
              isTextFillProgress ? (
                renderTextProgressDisplay()
              ) : (
                <>
                  <div className="absolute z-10" style={progressTrackPosition}>
                    <div
                      className={`overflow-hidden ${
                        settings.generatedProgressEnabled ? '' : styleModules.progress.trackClass
                      } ${
                        hudLayout.progressOrientation === 'vertical' ? 'flex items-end' : ''
                      }`}
                      style={{
                        width: progressTrackWidth,
                        height: progressTrackHeight,
                        borderRadius: progressTrackRadius,
                        background: progressTrackBackground,
                        borderColor: progressTrackBorderColor,
                        borderStyle: 'solid',
                        borderWidth: progressTrackBorderWidth,
                        boxShadow: progressTrackShadow
                      }}
                    >
                      <motion.div style={progressFillStyle}>
                        {progressPulseOverlayStyle && <span className="pointer-events-none absolute" style={progressPulseOverlayStyle} />}
                        {progressSweepStyle && <span className="pointer-events-none absolute" style={progressSweepStyle} />}
                      </motion.div>
                    </div>
                  </div>
                </>
              )
            )}
          </div>
        )}

        {/* Game Area */}
        <div
          className="flex-1 relative overflow-hidden flex items-center justify-center"
          style={{
            backgroundColor: generatedBackgroundCoversHeader
              ? 'transparent'
              : isStorybookStyle
              ? '#1F475B'
              : visualTheme.gameBg,
            padding: `${frameLayout.contentPadding}px`
          }}
        >
          {currentGeneratedBackground && !generatedBackgroundCoversHeader && (
            <div className="absolute inset-0">
              <GeneratedBackgroundCanvas
                spec={currentGeneratedBackground}
                className="h-full w-full"
                timeSeconds={generatedBackgroundPlaybackTime}
              />
            </div>
          )}

          {/* Background Pattern */}
          {isStorybookStyle ? (
            <div
              className="absolute inset-0 opacity-35"
              style={{
                background:
                  'linear-gradient(180deg, rgba(255,255,255,0.14) 0%, rgba(0,0,0,0.16) 100%)'
              }}
            />
          ) : (
            <div
              className="absolute inset-0 opacity-[0.07]"
              style={{ backgroundImage: `radial-gradient(circle, ${visualTheme.patternColor} 2px, transparent 2px)`, backgroundSize: '24px 24px' }}
            />
          )}

          <AnimatePresence mode="wait">
            {phase !== 'finished' && phase !== 'intro' && phase !== 'outro' && (
              <motion.div
                key={currentPuzzle.imageA + safeCurrentIndex}
                initial={false}
                animate={{
                  x: 0,
                  y: 0,
                  opacity:
                    phase === 'transitioning'
                      ? transitionSequenceState.outgoingOpacity
                      : phase === 'showing'
                      ? puzzleEntryState.opacity
                      : 1,
                  scale:
                    phase === 'transitioning'
                      ? transitionSequenceState.outgoingScale
                      : phase === 'showing'
                      ? puzzleEntryState.scale
                      : 1,
                  rotate: 0
                }}
                transition={{
                  duration:
                    phase === 'transitioning'
                      ? 0.12
                      : phase === 'showing' && puzzleEntryState.active
                      ? 0.08
                      : 0
                }}
                className="relative w-full h-full"
              >
                {isWidePuzzleDisplay ? (
                  <div className="relative w-full h-full p-3">
                    <div className="relative w-full h-full rounded-2xl border-4 border-[#4D3E26] bg-[#D2C091] shadow-[6px_6px_0px_0px_rgba(38,30,18,0.85)] p-3">
                      <div className="absolute inset-y-3 left-1/2 -translate-x-1/2 w-[3px] bg-[#5A4A2B]/50 pointer-events-none" />
                      <div className="relative grid h-full grid-cols-[minmax(0,1fr)_28px_minmax(0,1fr)] gap-2">
                        <div
                          className="relative rounded-xl overflow-hidden h-full"
                          style={storybookPanelStyle}
                        >
                          <div className="absolute top-2 left-2 z-10 px-2 py-1 border-2 border-[#4D3E26] rounded-md bg-[#F3E6C4] text-[#3B2E1A] text-[10px] font-black uppercase tracking-wide">
                            Original
                          </div>
                          <img
                            src={currentPuzzle.imageA}
                            alt="Original"
                            className="w-full h-full object-cover pointer-events-none select-none"
                          />
                        </div>

                        <div className="flex items-center justify-center">
                          <div className="rotate-90 px-2 py-1 rounded-md border-2 border-[#4D3E26] bg-[#D8B149] text-[9px] font-black uppercase tracking-[0.18em] text-[#3B2E1A] whitespace-nowrap shadow-[1px_1px_0px_0px_rgba(77,62,38,0.8)]">
                            Compare
                          </div>
                        </div>

                        <div
                          className="relative rounded-xl overflow-hidden h-full"
                          style={storybookPanelStyle}
                        >
                          <div className="absolute top-2 left-2 z-10 px-2 py-1 border-2 border-[#4D3E26] rounded-md bg-[#D37872] text-[#23180D] text-[10px] font-black uppercase tracking-wide">
                            Modified
                          </div>
                          <div ref={interactiveViewportRef} className="relative w-full h-full">
                            <img
                              src={currentPuzzle.imageB}
                              alt="Find Differences"
                              className="w-full h-full object-cover select-none pointer-events-none"
                              onLoad={(event) => {
                                const image = event.currentTarget;
                                setImageBNaturalSize({
                                  width: image.naturalWidth,
                                  height: image.naturalHeight
                                });
                              }}
                            />
                            {renderBlinkOverlay()}
                            <div
                              className="absolute pointer-events-none z-20"
                              style={{
                                left: `${imageBCoverFrame.x}px`,
                                top: `${imageBCoverFrame.y}px`,
                                width: `${imageBCoverFrame.width}px`,
                                height: `${imageBCoverFrame.height}px`
                              }}
                            >
                              {renderRevealOverlays()}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    className={`relative w-full h-full flex gap-2 items-center justify-center ${
                      isVerticalLayout ? 'flex-col' : 'flex-row'
                    }`}
                    style={{ padding: `${effectiveGamePadding}px`, gap: `${frameLayout.panelGap}px` }}
                  >
                    <div
                      className="relative flex-1 overflow-hidden w-full h-full"
                      style={standardPanelStyle}
                    >
                      <img
                        src={currentPuzzle.imageA}
                        alt="Original"
                        className="w-full h-full object-cover pointer-events-none select-none"
                      />
                    </div>

                    <div
                      className="relative flex-1 overflow-hidden w-full h-full"
                      style={standardPanelStyle}
                    >
                      <div ref={interactiveViewportRef} className="relative w-full h-full">
                        <img
                          src={currentPuzzle.imageB}
                          alt="Find Differences"
                          className="w-full h-full object-cover select-none pointer-events-none"
                          onLoad={(event) => {
                            const image = event.currentTarget;
                            setImageBNaturalSize({
                              width: image.naturalWidth,
                              height: image.naturalHeight
                            });
                          }}
                        />
                        {renderBlinkOverlay()}
                        <div
                          className="absolute pointer-events-none z-20"
                          style={{
                            left: `${imageBCoverFrame.x}px`,
                            top: `${imageBCoverFrame.y}px`,
                            width: `${imageBCoverFrame.width}px`,
                            height: `${imageBCoverFrame.height}px`
                          }}
                        >
                          {renderRevealOverlays()}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {phase === 'intro' && !showIntroClip && renderSceneCard('intro')}
          {phase === 'intro' && !showIntroClip && introClipActive && (
            <div className="absolute top-4 right-4 z-40 rounded-full border-2 border-black bg-white px-3 py-1 text-[10px] font-black uppercase">
              {introVideoError || introPreviewFrameError ? 'Intro Clip Failed' : 'Intro Clip Loading'}
            </div>
          )}
          {phase === 'transitioning' && renderTransitionOverlay()}
          {phase === 'outro' && renderSceneCard('outro')}
          {renderFinalCommentPrompt()}

        </div>
        </>
        )}
        </div>
      </div>

      {/* Playback Complete Overlay */}
      {phase === 'finished' && !embedded && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-[60] backdrop-blur-sm p-3 sm:p-6">
          <motion.div 
            initial={{ scale: 0.8, rotate: -2 }}
            animate={{ scale: 1, rotate: 0 }}
            className="p-6 sm:p-8 lg:p-12 rounded-3xl border-4 sm:border-8 text-center max-w-lg w-full max-h-full overflow-y-auto relative"
            style={{
              backgroundColor: completionCardStyle.backgroundColor,
              borderColor: completionCardStyle.borderColor,
              boxShadow: completionCardStyle.shadow
            }}
          >
            <div className="absolute top-0 left-0 w-full h-4 bg-white/20 -skew-y-2 transform origin-top-left" />
            
            <div
              className="inline-block mb-4 sm:mb-6 bg-white p-4 sm:p-6 rounded-full border-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
              style={{ borderColor: completionCardStyle.borderColor }}
            >
              <CheckCircle size={56} className="fill-current stroke-black stroke-2" style={{ color: visualTheme.completionIcon }} />
            </div>
            
            <h2
              className="text-3xl sm:text-5xl font-black font-display uppercase mb-2 leading-none tracking-tight"
              style={{ color: completionCardStyle.textColor }}
            >
              {completionTitle}
            </h2>
            <p
              className="text-base sm:text-xl font-bold mb-6 sm:mb-8 font-mono"
              style={{ color: hexToRgba(completionCardStyle.textColor, 0.78) }}
            >
              {completionSubtitle}
            </p>
            
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
              <button 
                onClick={onExit}
                className="flex-1 py-3 sm:py-4 bg-white text-base sm:text-lg font-black uppercase tracking-wider rounded-xl hover:bg-slate-50 transition-colors border-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
                style={{ color: completionCardStyle.textColor, borderColor: completionCardStyle.borderColor }}
              >
                Exit
              </button>
              <button 
                onClick={handleReplay}
                className="flex-1 py-3 sm:py-4 text-base sm:text-lg font-black uppercase tracking-wider rounded-xl transition-colors border-4 flex items-center justify-center space-x-2"
                style={{
                  backgroundColor:
                    packagePreset.outroCardVariant === 'scoreboard' ? visualTheme.headerBg : '#111111',
                  color:
                    packagePreset.outroCardVariant === 'scoreboard' ? '#111827' : '#FFFFFF',
                  borderColor: completionCardStyle.borderColor,
                  boxShadow:
                    packagePreset.outroCardVariant === 'scoreboard'
                      ? '4px 4px 0px 0px rgba(255,255,255,0.22)'
                      : '4px 4px 0px 0px rgba(255,255,255,1)'
                }}
              >
                <RotateCcw size={18} />
                <span>Replay</span>
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};
