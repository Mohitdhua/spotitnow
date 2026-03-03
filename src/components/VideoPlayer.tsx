import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Pause, Play, SkipForward, RotateCcw, CheckCircle } from 'lucide-react';
import { Puzzle, VideoSettings } from '../types';

interface VideoPlayerProps {
  puzzles: Puzzle[];
  settings: VideoSettings;
  onExit: () => void;
}

type Phase = 'showing' | 'revealing' | 'transitioning' | 'finished';

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
  }
};

const BASE_STAGE_SIZE: Record<VideoSettings['aspectRatio'], { width: number; height: number }> = {
  '16:9': { width: 1600, height: 900 },
  '9:16': { width: 900, height: 1600 },
  '1:1': { width: 1200, height: 1200 },
  '4:3': { width: 1440, height: 1080 }
};

type MeterOrientation = 'horizontal' | 'vertical';

interface HudLayoutConfig {
  headerHeight: number;
  titlePosition: React.CSSProperties;
  titleAlignItems: 'flex-start' | 'center' | 'flex-end';
  titleGap: number;
  titleFontSize: number;
  subtitleFontSize: number;
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
  classic: HUD_PRESETS.rightStack,
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
  ivory: { ...HUD_PRESETS.bottomRail, titleFontClass: 'font-sans', subtitleFontClass: 'font-sans', titleFontSize: 18, subtitleFontSize: 8, timerFontSize: 20, progressWidth: 220, progressHeight: 7 }
};

export const VideoPlayer: React.FC<VideoPlayerProps> = ({ puzzles, settings, onExit }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('showing');
  const [timeLeft, setTimeLeft] = useState(settings.showDuration);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isBlinkOverlayVisible, setIsBlinkOverlayVisible] = useState(false);
  const [imageViewportSize, setImageViewportSize] = useState({ width: 0, height: 0 });
  const [imageBNaturalSize, setImageBNaturalSize] = useState({ width: 0, height: 0 });
  const [viewportSize, setViewportSize] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1600,
    height: typeof window !== 'undefined' ? window.innerHeight : 900
  }));
  
  const currentPuzzle = puzzles[currentIndex];
  const containerRef = useRef<HTMLDivElement>(null);
  const interactiveViewportRef = useRef<HTMLDivElement>(null);

  // Timer Logic
  useEffect(() => {
    if (!isPlaying || phase === 'finished') return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 0.1) {
          handlePhaseComplete();
          return 0;
        }
        return prev - 0.1;
      });
    }, 100);

    return () => clearInterval(timer);
  }, [isPlaying, phase, currentIndex]);

  const handlePhaseComplete = () => {
    if (phase === 'showing') {
      setPhase('revealing');
      setTimeLeft(revealPhaseDuration);
    } else if (phase === 'revealing') {
      if (currentIndex < puzzles.length - 1) {
        setPhase('transitioning');
        setTimeLeft(settings.transitionDuration);
      } else {
        setPhase('finished');
      }
    } else if (phase === 'transitioning') {
      setCurrentIndex((prev) => prev + 1);
      setPhase('showing');
      setTimeLeft(settings.showDuration);
    }
  };

  const handleSkip = () => {
    if (phase === 'showing') {
      setPhase('revealing');
      setTimeLeft(revealPhaseDuration);
    } else if (phase === 'revealing') {
      handlePhaseComplete();
    }
  };

  const handleReplay = () => {
    setCurrentIndex(0);
    setPhase('showing');
    setTimeLeft(settings.showDuration);
    setIsPlaying(true);
  };

  const isVerticalLayout = settings.aspectRatio === '9:16' || settings.aspectRatio === '1:1';
  const styleSupportedAspectRatio = settings.aspectRatio === '16:9' || settings.aspectRatio === '9:16';
  const visualStyle = styleSupportedAspectRatio ? settings.visualStyle : 'classic';
  const visualTheme = VISUAL_THEMES[visualStyle];
  const hudLayout = HUD_LAYOUTS[visualStyle];
  const blinkCycleDuration = Math.max(0.2, settings.blinkSpeed);
  const revealPhaseDuration = Math.max(0.5, settings.revealDuration);
  const revealRegionCount = currentPuzzle.regions.length;
  const revealStepSeconds = Math.min(
    Math.max(0.5, settings.sequentialRevealStep),
    revealPhaseDuration / Math.max(1, revealRegionCount + 1)
  );
  const revealBlinkStartTime = revealRegionCount * revealStepSeconds;
  const revealElapsed = phase === 'revealing' ? Math.max(0, revealPhaseDuration - timeLeft) : 0;
  const revealedRegionCount =
    phase === 'revealing' && revealRegionCount > 0
      ? Math.min(revealRegionCount, Math.floor(revealElapsed / revealStepSeconds) + 1)
      : 0;
  const isBlinkOverlayActive =
    phase === 'revealing' &&
    revealRegionCount > 0 &&
    revealElapsed >= revealBlinkStartTime;

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
    phase === 'showing'
      ? settings.showDuration
      : phase === 'revealing'
      ? revealPhaseDuration
      : phase === 'transitioning'
      ? settings.transitionDuration
      : 0;

  const progressPercent =
    phaseDuration <= 0
      ? 0
      : Math.min(100, Math.max(0, ((phaseDuration - timeLeft) / phaseDuration) * 100));

  const progressFillStyle =
    hudLayout.progressOrientation === 'horizontal'
      ? {
          width: `${progressPercent}%`,
          height: '100%',
          background: visualTheme.progressFill,
          boxShadow: visualTheme.progressFillGlow
        }
      : {
          width: '100%',
          height: `${progressPercent}%`,
          background: visualTheme.progressFill,
          boxShadow: visualTheme.progressFillGlow
        };

  const stageMetrics = useMemo(() => {
    const baseSize = BASE_STAGE_SIZE[settings.aspectRatio];
    const horizontalPadding = 24;
    const topReserved = 92;
    const bottomReserved = phase === 'finished' ? 24 : 122;

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
  }, [settings.aspectRatio, viewportSize, phase]);

  useEffect(() => {
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
  }, []);

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
    return seconds.toFixed(1);
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

  const renderRevealOverlays = () => (
    <AnimatePresence>
      {phase === 'revealing' &&
        currentPuzzle.regions.slice(0, revealedRegionCount).map((region) => {
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

          return (
            <motion.div
              key={region.id}
              initial={{ opacity: 0, scale: 1.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.28 }}
              className="absolute z-20"
              style={{
                left: `${(useSquareCircleFrame ? circleLeft : boxLeft) * 100}%`,
                top: `${(useSquareCircleFrame ? circleTop : boxTop) * 100}%`,
                width: `${(useSquareCircleFrame ? circleSize : expandedWidth) * 100}%`,
                height: `${(useSquareCircleFrame ? circleSize : expandedHeight) * 100}%`,
                minWidth: '24px',
                minHeight: '24px'
              }}
            >
              {settings.revealStyle === 'box' && effectiveRevealVariant === 'box_glow' && (
                <div
                  className="w-full h-full rounded-md border-4"
                  style={{
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
                <div
                  className="w-full h-full rounded-md border-2"
                  style={{
                    borderColor: hexToRgba(settings.revealColor, 0.8),
                    background: `linear-gradient(135deg, ${hexToRgba(settings.revealColor, 0.3)} 0%, ${hexToRgba(settings.revealColor, 0.55)} 100%)`,
                    boxShadow: `${outlineStroke > 0 ? `0 0 0 ${outlineStroke}px ${settings.outlineColor}, ` : ''}0 0 10px ${hexToRgba(settings.revealColor, 0.4)}`
                  }}
                />
              )}
            </motion.div>
          );
        })}
    </AnimatePresence>
  );

  return (
    <div
      className="flex flex-col items-center justify-center min-h-[100dvh] overflow-hidden relative"
      style={{ backgroundColor: visualTheme.rootBg }}
    >
      
      {/* External Back Button - Top Left */}
      <div className="absolute top-6 left-6 z-50">
        <button 
          onClick={onExit}
          className="p-3 bg-white border-4 border-black rounded-xl hover:bg-black hover:text-white transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
        >
          <ArrowLeft size={24} strokeWidth={3} />
        </button>
      </div>

      {/* External Playback Controls - Bottom Center */}
      {phase !== 'finished' && (
        <div className="absolute bottom-4 sm:bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center space-x-4 sm:space-x-6">
          <button 
            onClick={() => setIsPlaying(!isPlaying)} 
            className="p-3 sm:p-4 bg-white border-4 border-black rounded-full transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] group hover:bg-[var(--hover-bg)]"
            style={{ '--hover-bg': visualTheme.playHoverBg } as React.CSSProperties}
          >
            {isPlaying ? <Pause size={28} strokeWidth={3} className="group-hover:scale-110 transition-transform"/> : <Play size={28} strokeWidth={3} className="ml-1 group-hover:scale-110 transition-transform"/>}
          </button>
          <button 
            onClick={handleSkip} 
            className="p-3 sm:p-4 bg-white border-4 border-black rounded-full transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] group hover:bg-[var(--hover-bg)]"
            style={{ '--hover-bg': visualTheme.skipHoverBg } as React.CSSProperties}
          >
            <SkipForward size={28} strokeWidth={3} className="group-hover:scale-110 transition-transform"/>
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
          className="absolute top-0 left-0 bg-white border-4 border-black shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] rounded-2xl overflow-hidden flex flex-col"
          style={{
            width: `${stageMetrics.baseWidth}px`,
            height: `${stageMetrics.baseHeight}px`,
            transform: `scale(${stageMetrics.scale})`,
            transformOrigin: 'top left'
          }}
        >
        
        {/* HUD Header */}
        <div
          className="relative border-b-4 border-black shrink-0 z-20"
          style={{ backgroundColor: visualTheme.headerBg, height: `${hudLayout.headerHeight}px` }}
        >
          <div
            className="absolute flex items-center"
            style={{ ...hudLayout.titlePosition, gap: `${hudLayout.titleGap}px` }}
          >
            {settings.logo && (
              <div
                className="bg-white border-2 border-black rounded-lg overflow-hidden flex items-center justify-center shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] shrink-0"
                style={{ width: `${hudLayout.logoSize}px`, height: `${hudLayout.logoSize}px` }}
              >
                <img src={settings.logo} alt="Logo" className="w-full h-full object-contain" />
              </div>
            )}

            <div className="flex flex-col" style={{ alignItems: hudLayout.titleAlignItems }}>
              <h2
                className={`font-black uppercase leading-none tracking-tight ${hudLayout.titleFontClass}`}
                style={{ color: visualTheme.headerText, fontSize: `${hudLayout.titleFontSize}px` }}
              >
                {phase === 'showing' ? 'Find Differences' : phase === 'revealing' ? (isBlinkOverlayActive ? 'Blink Compare' : 'Revealing...') : 'Next Puzzle'}
              </h2>
              <span
                className={`font-bold uppercase opacity-80 leading-none ${hudLayout.subtitleFontClass}`}
                style={{
                  color: visualTheme.headerSubText,
                  fontSize: `${hudLayout.subtitleFontSize}px`,
                  letterSpacing: `${hudLayout.subtitleLetterSpacingEm}em`
                }}
              >
                Puzzle {currentIndex + 1} / {puzzles.length}
              </span>
            </div>
          </div>

          <div className="absolute" style={hudLayout.timerPosition}>
            <div
              className={`flex items-center border-2 ${visualTheme.timerShapeClass}`}
              style={{
                gap: `${hudLayout.timerGap}px`,
                padding: `${hudLayout.timerPadY}px ${hudLayout.timerPadX}px`,
                minWidth: `${hudLayout.timerMinWidth}px`,
                justifyContent: hudLayout.timerJustify,
                backgroundColor: visualTheme.timerBg,
                borderColor: visualTheme.timerBorder
              }}
            >
              <div
                className={`rounded-full ${timeLeft <= 2 ? 'animate-pulse' : ''}`}
                style={{
                  width: `${hudLayout.timerDotSize}px`,
                  height: `${hudLayout.timerDotSize}px`,
                  backgroundColor: timeLeft <= 2 ? '#FF6B6B' : visualTheme.timerDot
                }}
              />
              <span
                className={`${visualTheme.timerTextClass} leading-none`}
                style={{
                  color: timeLeft <= 2 ? '#FF6B6B' : visualTheme.timerText,
                  fontSize: `${hudLayout.timerFontSize}px`
                }}
              >
                {formatTime(timeLeft)}s
              </span>
            </div>
          </div>

          <div className="absolute" style={hudLayout.progressPosition}>
            <div
              className={`overflow-hidden border-2 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] ${visualTheme.progressTrackClass} ${
                hudLayout.progressOrientation === 'vertical' ? 'flex items-end' : ''
              }`}
              style={{
                width: `${hudLayout.progressWidth}px`,
                height: `${hudLayout.progressHeight}px`,
                borderRadius: `${hudLayout.progressRadius}px`,
                backgroundColor: visualTheme.progressTrackBg,
                borderColor: visualTheme.progressTrackBorder
              }}
            >
              <motion.div className={visualTheme.progressFillClass} style={progressFillStyle} />
            </div>
          </div>
        </div>

        {/* Game Area */}
        <div
          className="flex-1 relative overflow-hidden flex items-center justify-center p-2"
          style={{ backgroundColor: visualTheme.gameBg }}
        >
          {/* Background Pattern */}
          <div className="absolute inset-0 opacity-10" 
               style={{ backgroundImage: `radial-gradient(circle, ${visualTheme.patternColor} 2px, transparent 2px)`, backgroundSize: '24px 24px' }} 
          />

          <AnimatePresence mode="wait">
            {phase !== 'finished' && (
              <motion.div
                key={currentPuzzle.imageA + currentIndex}
                initial={settings.transitionStyle === 'slide' ? { x: '100%' } : { opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={settings.transitionStyle === 'slide' ? { x: '-100%' } : { opacity: 0 }}
                transition={{ duration: settings.transitionDuration }}
                className={`relative w-full h-full flex gap-2 items-center justify-center ${isVerticalLayout ? 'flex-col' : 'flex-row'}`}
              >
                {/* Original Image */}
                <div
                  className="relative flex-1 border-4 border-black rounded-xl overflow-hidden shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] group w-full h-full"
                  style={{ backgroundColor: visualTheme.imagePanelBg }}
                >
                  <img
                    src={currentPuzzle.imageA}
                    alt="Original"
                    className="w-full h-full object-cover pointer-events-none select-none"
                  />
                </div>

                {/* Interactive Image (Video Mode) */}
                <div
                  className="relative flex-1 border-4 border-black rounded-xl overflow-hidden shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] group w-full h-full"
                  style={{ backgroundColor: visualTheme.imagePanelBg }}
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
                    {isBlinkOverlayActive && isBlinkOverlayVisible && (
                      <img
                        src={currentPuzzle.imageA}
                        alt="Blink compare"
                        className="absolute inset-0 w-full h-full object-cover pointer-events-none select-none"
                      />
                    )}
                    <div
                      className="absolute pointer-events-none"
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
              </motion.div>
            )}
          </AnimatePresence>

        </div>
        </div>
      </div>

      {/* Playback Complete Overlay */}
      {phase === 'finished' && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-[60] backdrop-blur-sm p-3 sm:p-6">
          <motion.div 
            initial={{ scale: 0.8, rotate: -2 }}
            animate={{ scale: 1, rotate: 0 }}
            className="p-6 sm:p-8 lg:p-12 rounded-3xl border-4 sm:border-8 border-black shadow-[10px_10px_0px_0px_rgba(255,255,255,1)] sm:shadow-[16px_16px_0px_0px_rgba(255,255,255,1)] text-center max-w-lg w-full max-h-full overflow-y-auto relative"
            style={{ backgroundColor: visualTheme.completionBg }}
          >
            <div className="absolute top-0 left-0 w-full h-4 bg-white/20 -skew-y-2 transform origin-top-left" />
            
            <div className="inline-block mb-4 sm:mb-6 bg-white p-4 sm:p-6 rounded-full border-4 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
              <CheckCircle size={56} className="fill-current stroke-black stroke-2" style={{ color: visualTheme.completionIcon }} />
            </div>
            
            <h2 className="text-3xl sm:text-5xl font-black font-display uppercase mb-2 text-black leading-none tracking-tight">
              Playback Complete!
            </h2>
            <p className="text-base sm:text-xl font-bold text-black/80 mb-6 sm:mb-8 font-mono">
              All puzzles shown.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
              <button 
                onClick={onExit}
                className="flex-1 py-3 sm:py-4 bg-white text-black text-base sm:text-lg font-black uppercase tracking-wider rounded-xl hover:bg-slate-50 transition-colors border-4 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
              >
                Exit
              </button>
              <button 
                onClick={handleReplay}
                className="flex-1 py-3 sm:py-4 bg-black text-white text-base sm:text-lg font-black uppercase tracking-wider rounded-xl hover:bg-slate-900 transition-colors border-4 border-black shadow-[4px_4px_0px_0px_rgba(255,255,255,1)] flex items-center justify-center space-x-2"
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
