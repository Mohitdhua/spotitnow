import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Clock,
  Download,
  Eye,
  Film,
  Image as ImageIcon,
  Layout,
  Music,
  Monitor,
  Palette,
  Play,
  RefreshCcw,
  Save,
  Smartphone,
  Sparkles,
  Upload,
  Volume2
} from 'lucide-react';
import {
  CustomVideoLayout,
  GeneratedBackgroundMotifFamily,
  GeneratedBackgroundPaletteId,
  Puzzle,
  type VideoAudioCuePoolKey,
  VideoSettings,
  VideoUserPackage
} from '../types';
import { BASE_STAGE_SIZE } from '../constants/videoLayoutSpec';
import { buildDefaultCustomVideoLayout } from '../constants/videoLayoutCustom';
import { VIDEO_PACKAGE_PRESETS, VIDEO_REVEAL_BEHAVIOR_OPTIONS } from '../constants/videoPackages';
import {
  type VideoStyleOption,
  VIDEO_HEADER_STYLE_OPTIONS,
  VIDEO_PROGRESS_STYLE_OPTIONS,
  VIDEO_SCENE_CARD_STYLE_OPTIONS,
  VIDEO_TEXT_STYLE_OPTIONS,
  VIDEO_TIMER_STYLE_OPTIONS,
  VIDEO_TRANSITION_STYLE_OPTIONS
} from '../constants/videoStyleModules';
import { PROGRESS_BAR_THEMES } from '../constants/progressBarThemes';
import { VideoPreviewCompare, type PreviewOutputTab, type PreviewSetupTab } from './VideoPreviewCompare';
import { GeneratedBackgroundCanvas } from './GeneratedBackgroundCanvas';
import { DeferredNumberInput } from './DeferredNumberInput';
import { ConfirmDialog } from '../app/components/ConfirmDialog';
import { TextPromptDialog } from '../app/components/TextPromptDialog';
import { clampLogoZoom } from '../utils/logoProcessing';
import {
  deleteGeneratedBackgroundPack,
  loadGeneratedBackgroundPacks,
  renameGeneratedBackgroundPack,
  saveGeneratedBackgroundPack
} from '../services/backgroundPacks';
import {
  createGeneratedBackgroundPack,
  GENERATED_BACKGROUND_FAMILY_OPTIONS,
  GENERATED_BACKGROUND_PACK_SIZE,
  GENERATED_BACKGROUND_PALETTE_OPTIONS,
  resolveGeneratedBackgroundForIndex
} from '../services/generatedBackgrounds';
import { loadSavedVideoCustomLayout, saveVideoCustomLayout } from '../services/videoLayoutStorage';
import { useProcessedLogoSrc } from '../hooks/useProcessedLogoSrc';
import {
  deleteStoredAudioAsset,
  deleteStoredAudioAssets,
  saveAudioAssetFromFile
} from '../services/audioAssetStore';
import { saveImageAssetFromFile } from '../services/imageAssetStore';
import {
  deleteStoredVideoAsset,
  isStoredVideoAssetSource,
  saveVideoAssetFromFile
} from '../services/videoAssetStore';
import { readVideoFileMetadata } from '../services/frameExtractor';
import { getVideoExportPlan } from '../services/videoExport';
import {
  VIDEO_AUDIO_CUE_POOL_MAX_VOLUME,
  VIDEO_AUDIO_POOL_DEFINITIONS
} from '../utils/videoAudioPools';

interface VideoSettingsPanelProps {
  settings: VideoSettings;
  puzzles: Puzzle[];
  videoPackages: VideoUserPackage[];
  activeVideoPackageId: string;
  onSettingsChange: (settings: React.SetStateAction<VideoSettings>) => void;
  onAspectRatioChange: (aspectRatio: VideoSettings['aspectRatio']) => void;
  onSelectVideoPackage: (packageId: string) => void;
  onCreateVideoPackage: () => void;
  onDuplicateVideoPackage: () => void;
  onRenameVideoPackage: (packageId: string) => void;
  onDeleteVideoPackage: (packageId: string) => void;
  onExportVideoPackage: () => void | Promise<void>;
  onImportVideoPackage: () => void;
  onExport: () => void | Promise<void>;
  onRestartExport?: () => void | Promise<void>;
  exportRecovery?: {
    title: string;
    detail: string;
    remainingOutputs: number;
    completedOutputs: number;
    totalOutputs: number;
    lastError: string | null;
  } | null;
  onCancelExport: () => void;
  isExporting: boolean;
  exportProgress: number;
  exportStatus: string;
  onStart: () => void;
  onBack: () => void;
  backgroundPacksSessionId?: number;
}

type VisualStyleCard = {
  value: VideoSettings['visualStyle'];
  label: string;
  hint: string;
  swatch: string;
  meter: string;
};

type MotifFocus = 'balanced' | 'party' | 'paper' | 'comic' | 'calm';
type PaletteFocus = 'mixed' | 'warm' | 'cool' | 'night';

type TextTemplateField = {
  key: keyof VideoSettings['textTemplates'];
  label: string;
  rows?: number;
  span?: 'full';
};

type SceneCopyTemplatePreset = {
  id: string;
  name: string;
  description: string;
  templates: VideoSettings['textTemplates'];
};

type SceneTemplateVariant = {
  label: string;
  patch: Partial<VideoSettings['textTemplates']>;
};

const ASPECT_RATIO_OPTIONS: Array<{
  value: VideoSettings['aspectRatio'];
  label: string;
  subLabel: string;
  icon: React.ComponentType<{ size?: string | number; strokeWidth?: string | number }>;
}> = [
  { value: '16:9', label: '16:9', subLabel: 'Landscape', icon: Monitor },
  { value: '9:16', label: '9:16', subLabel: 'Portrait', icon: Smartphone }
];

const VISUAL_STYLE_OPTIONS: VisualStyleCard[] = [
  { value: 'random', label: 'Random', hint: 'New theme per puzzle', swatch: 'linear-gradient(135deg, #FFD93D 0%, #4ECDC4 35%, #FB7185 68%, #8B5CF6 100%)', meter: 'linear-gradient(90deg, #22D3EE 0%, #8B5CF6 35%, #F97316 70%, #22C55E 100%)' },
  { value: 'classic', label: 'Classic', hint: 'Game-show default', swatch: '#A7F3D0', meter: 'linear-gradient(90deg, #FF6B6B 0%, #FF8E53 100%)' },
  { value: 'pop', label: 'Pop', hint: 'Punchy contrast', swatch: '#FFE69B', meter: 'repeating-linear-gradient(45deg, #1D4ED8 0 8px, #3B82F6 8px 16px)' },
  { value: 'neon', label: 'Neon', hint: 'Arcade glow', swatch: '#D9FBFF', meter: 'linear-gradient(90deg, #12F7FF 0%, #9B5DE5 50%, #F15BB5 100%)' },
  { value: 'sunset', label: 'Sunset', hint: 'Warm gradient', swatch: '#FFD7B5', meter: 'linear-gradient(90deg, #FDE047 0%, #FB7185 55%, #F97316 100%)' },
  { value: 'mint', label: 'Mint', hint: 'Fresh greens', swatch: '#B7F7D2', meter: 'repeating-linear-gradient(90deg, #34D399 0 10px, #10B981 10px 20px, #059669 20px 30px)' },
  { value: 'midnight', label: 'Midnight', hint: 'Deep blue HUD', swatch: '#BFDBFE', meter: 'linear-gradient(90deg, #38BDF8 0%, #2563EB 60%, #1D4ED8 100%)' },
  { value: 'mono', label: 'Mono', hint: 'Monochrome', swatch: '#E5E7EB', meter: 'repeating-linear-gradient(90deg, #111111 0 12px, #4B5563 12px 24px)' },
  { value: 'retro', label: 'Retro', hint: 'Arcade cabinet', swatch: '#FDE68A', meter: 'repeating-linear-gradient(90deg, #F59E0B 0 14px, #B45309 14px 28px)' },
  { value: 'cyber', label: 'Cyber', hint: 'Electric HUD', swatch: '#CFFAFE', meter: 'linear-gradient(180deg, #22D3EE 0%, #0EA5E9 100%)' },
  { value: 'oceanic', label: 'Oceanic', hint: 'Sea tones', swatch: '#BAE6FD', meter: 'linear-gradient(90deg, #38BDF8 0%, #2563EB 100%)' },
  { value: 'ember', label: 'Ember', hint: 'Hot red-orange', swatch: '#FECACA', meter: 'linear-gradient(90deg, #F97316 0%, #DC2626 100%)' },
  { value: 'candy', label: 'Candy', hint: 'Pastel mix', swatch: '#FBCFE8', meter: 'linear-gradient(90deg, #F472B6 0%, #C084FC 100%)' },
  { value: 'forest', label: 'Forest', hint: 'Natural green', swatch: '#BBF7D0', meter: 'repeating-linear-gradient(90deg, #22C55E 0 10px, #15803D 10px 20px)' },
  { value: 'aurora', label: 'Aurora', hint: 'Northern lights', swatch: '#DDD6FE', meter: 'linear-gradient(90deg, #22D3EE 0%, #8B5CF6 50%, #EC4899 100%)' },
  { value: 'slate', label: 'Slate', hint: 'Steel UI', swatch: '#CBD5E1', meter: 'repeating-linear-gradient(90deg, #64748B 0 12px, #334155 12px 24px)' },
  { value: 'arcade', label: 'Arcade', hint: 'Cabinet vibe', swatch: '#FEF08A', meter: 'repeating-linear-gradient(45deg, #A3E635 0 10px, #22D3EE 10px 20px, #F97316 20px 30px)' },
  { value: 'ivory', label: 'Ivory', hint: 'Calm minimal', swatch: '#FEFCE8', meter: 'linear-gradient(90deg, #A8A29E 0%, #57534E 100%)' },
  { value: 'storybook', label: 'Storybook', hint: 'Golden board', swatch: '#F7E3A8', meter: 'linear-gradient(90deg, #D9C08B 0%, #8B6D33 65%, #5A4320 100%)' }
];

const REVEAL_COLORS = ['#FF0000', '#FF6B6B', '#4ECDC4', '#FFD93D', '#000000', '#FFFFFF'];
const OUTLINE_COLORS = ['#000000', '#FFFFFF', '#FF0000', '#FFD93D', '#4ECDC4'];
const IMAGE_PANEL_OUTLINE_SWATCHES = ['#CEC3A5', '#14B8A6', '#111827', '#FFFFFF', '#FACC15', '#FB7185'];
const AUDIO_POOL_BADGE_CLASSES: Record<VideoAudioCuePoolKey, string> = {
  progress_fill_intro: 'bg-[#DBEAFE] text-sky-900',
  puzzle_play: 'bg-[#DCFCE7] text-emerald-900',
  low_time_warning: 'bg-[#FDE68A] text-amber-900',
  marker_reveal: 'bg-[#E0F2FE] text-cyan-900',
  blink: 'bg-[#FCE7F3] text-pink-900',
  transition: 'bg-[#FECACA] text-rose-900'
};
const AUDIO_POOL_SELECTION_LABELS: Record<VideoAudioCuePoolKey, string> = {
  progress_fill_intro: 'Cycle by puzzle',
  puzzle_play: 'Cycle by puzzle',
  low_time_warning: 'Cycle by puzzle',
  marker_reveal: 'Random per reveal',
  blink: 'Random per blink',
  transition: 'Random per transition'
};

const TEXT_TEMPLATE_GROUPS: Array<{
  title: string;
  description: string;
  actionLabel: string;
  fields: TextTemplateField[];
}> = [
  {
    title: 'Intro Template',
    description: 'What viewers read before the first puzzle appears.',
    actionLabel: 'Generate Intro',
    fields: [
      { key: 'introEyebrow', label: 'Eyebrow' },
      { key: 'introTitle', label: 'Title' },
      { key: 'introSubtitle', label: 'Subtitle', rows: 2, span: 'full' }
    ]
  },
  {
    title: 'Play Template',
    description: 'Core gameplay copy around the puzzle panels and reveal.',
    actionLabel: 'Generate Play',
    fields: [
      { key: 'playTitle', label: 'Play Title' },
      { key: 'playSubtitle', label: 'Play Subtitle', rows: 2 },
      { key: 'progressLabel', label: 'Progress Phrase', rows: 2, span: 'full' },
      { key: 'revealTitle', label: 'Reveal Title' },
      { key: 'puzzleBadgeLabel', label: 'Puzzle Badge' }
    ]
  },
  {
    title: 'Transition Template',
    description: 'Copy used while moving from one puzzle to the next.',
    actionLabel: 'Generate Transition',
    fields: [
      { key: 'transitionEyebrow', label: 'Eyebrow' },
      { key: 'transitionTitle', label: 'Title' },
      { key: 'transitionSubtitle', label: 'Subtitle', rows: 2, span: 'full' }
    ]
  },
  {
    title: 'Outro Template',
    description: 'Final call-to-action and completion message.',
    actionLabel: 'Generate Outro',
    fields: [
      { key: 'completionEyebrow', label: 'Eyebrow' },
      { key: 'completionTitle', label: 'Title' },
      { key: 'completionSubtitle', label: 'Subtitle', rows: 2, span: 'full' }
    ]
  }
];

const SCENE_COPY_TEMPLATE_PRESETS: SceneCopyTemplatePreset[] = [
  {
    id: 'playful-party',
    name: 'Playful Party',
    description: 'Bright creator-friendly copy with challenge energy.',
    templates: {
      introEyebrow: 'Ready to play?',
      introTitle: 'Find all the hidden differences',
      introSubtitle: '{puzzleCount} puzzles. 3 sneaky changes in every scene.',
      playTitle: 'Spot the differences',
      playSubtitle: 'Puzzle {current} of {total}',
      progressLabel: 'SPOT THE 3 DIFFERENCES',
      revealTitle: 'Here are the answers',
      transitionEyebrow: 'Next puzzle',
      transitionTitle: 'Round {next}',
      transitionSubtitle: 'Fresh scene. Same mission. Catch all 3 changes.',
      completionEyebrow: 'Nice work',
      completionTitle: 'You finished all {puzzleCount} puzzles',
      completionSubtitle: 'Comment your score and challenge a friend to beat it.',
      puzzleBadgeLabel: 'Puzzle'
    }
  },
  {
    id: 'arcade-hud',
    name: 'Arcade HUD',
    description: 'Faster game-show copy with a scoreboard feel.',
    templates: {
      introEyebrow: 'Mission start',
      introTitle: 'Can you clear every puzzle?',
      introSubtitle: 'Track down all 3 changes before time runs out.',
      playTitle: 'Difference scan active',
      playSubtitle: 'Stage {current} / {total}',
      progressLabel: 'SCAN FOR ALL 3',
      revealTitle: 'Targets located',
      transitionEyebrow: 'Loading next stage',
      transitionTitle: 'Puzzle {next}',
      transitionSubtitle: '{remaining} puzzle{remaining} left after this one.',
      completionEyebrow: 'Run complete',
      completionTitle: 'All stages cleared',
      completionSubtitle: 'Replay and see if you can finish faster next time.',
      puzzleBadgeLabel: 'Stage'
    }
  },
  {
    id: 'storybook-cozy',
    name: 'Storybook Cozy',
    description: 'Softer editorial wording for warm or cute themes.',
    templates: {
      introEyebrow: 'A tiny challenge',
      introTitle: 'Can you spot the little changes?',
      introSubtitle: 'Each picture hides three small surprises.',
      playTitle: 'Look closely',
      playSubtitle: 'Puzzle {current} of {total}',
      progressLabel: 'LOOK CLOSELY',
      revealTitle: 'Let us reveal them',
      transitionEyebrow: 'Turn the page',
      transitionTitle: 'Puzzle {next}',
      transitionSubtitle: 'Another scene is waiting with 3 more hidden changes.',
      completionEyebrow: 'Well spotted',
      completionTitle: 'Every difference was found',
      completionSubtitle: 'Share this round with someone who loves visual puzzles.',
      puzzleBadgeLabel: 'Scene'
    }
  },
  {
    id: 'short-social',
    name: 'Short Social',
    description: 'Tighter, cleaner lines for fast short-form videos.',
    templates: {
      introEyebrow: 'Quick challenge',
      introTitle: 'Spot all 3 differences',
      introSubtitle: 'Pause if you need more time.',
      playTitle: 'Find them now',
      playSubtitle: 'Round {current} of {total}',
      progressLabel: 'FIND ALL 3 NOW',
      revealTitle: 'Answer check',
      transitionEyebrow: 'Keep going',
      transitionTitle: 'Next round',
      transitionSubtitle: 'New scene. Same mission. Find all 3.',
      completionEyebrow: 'Finished',
      completionTitle: 'That was all {puzzleCount} puzzles',
      completionSubtitle: 'Drop your score in the comments.',
      puzzleBadgeLabel: 'Round'
    }
  }
];

const INTRO_TEMPLATE_VARIANTS: SceneTemplateVariant[] = [
  {
    label: 'Challenge Hook',
    patch: {
      introEyebrow: 'Ready?',
      introTitle: 'Spot all 3 differences',
      introSubtitle: 'Every puzzle hides 3 tiny changes. See how many you catch.'
    }
  },
  {
    label: 'Fast Social',
    patch: {
      introEyebrow: 'Quick challenge',
      introTitle: 'Can you beat this puzzle set?',
      introSubtitle: 'No cheating. No zooming. Just your eyes and the timer.'
    }
  },
  {
    label: 'Cute Playful',
    patch: {
      introEyebrow: 'Tiny changes ahead',
      introTitle: 'Find the sneaky little differences',
      introSubtitle: '{puzzleCount} playful scenes are waiting for you.'
    }
  },
  {
    label: 'Story Warm',
    patch: {
      introEyebrow: 'Look closely',
      introTitle: 'A few details have changed',
      introSubtitle: 'Take your time and enjoy the search.'
    }
  }
];

const PLAY_TEMPLATE_VARIANTS: SceneTemplateVariant[] = [
  {
    label: 'Classic Game',
    patch: {
      playTitle: 'Spot the differences',
      playSubtitle: 'Puzzle {current} of {total}',
      progressLabel: 'SPOT THE DIFFERENCES',
      revealTitle: 'Answers revealed',
      puzzleBadgeLabel: 'Puzzle'
    }
  },
  {
    label: 'Arcade Scan',
    patch: {
      playTitle: 'Difference scan active',
      playSubtitle: 'Stage {current} / {total}',
      progressLabel: 'DIFFERENCE SCAN ACTIVE',
      revealTitle: 'Targets found',
      puzzleBadgeLabel: 'Stage'
    }
  },
  {
    label: 'Playful Cute',
    patch: {
      playTitle: 'Find the little changes',
      playSubtitle: 'There are 3 hiding in this scene',
      progressLabel: 'FIND THE LITTLE CHANGES',
      revealTitle: 'Here they are',
      puzzleBadgeLabel: 'Scene'
    }
  },
  {
    label: 'Minimal Social',
    patch: {
      playTitle: 'Can you find all 3?',
      playSubtitle: 'Round {current} of {total}',
      progressLabel: 'CAN YOU FIND ALL 3?',
      revealTitle: 'Answer check',
      puzzleBadgeLabel: 'Round'
    }
  }
];

const TRANSITION_TEMPLATE_VARIANTS: SceneTemplateVariant[] = [
  {
    label: 'Next Round',
    patch: {
      transitionEyebrow: 'Next puzzle',
      transitionTitle: 'Round {next}',
      transitionSubtitle: '{remaining} puzzles left after this one.'
    }
  },
  {
    label: 'Arcade Load',
    patch: {
      transitionEyebrow: 'Loading',
      transitionTitle: 'Stage {next}',
      transitionSubtitle: 'Fresh scene incoming. Get ready to scan again.'
    }
  },
  {
    label: 'Soft Story',
    patch: {
      transitionEyebrow: 'Turn the page',
      transitionTitle: 'Puzzle {next}',
      transitionSubtitle: 'Another picture is ready with 3 more hidden changes.'
    }
  },
  {
    label: 'Fast Social',
    patch: {
      transitionEyebrow: 'Keep going',
      transitionTitle: 'Next round',
      transitionSubtitle: 'New scene. Same mission. Find all 3.'
    }
  }
];

const OUTRO_TEMPLATE_VARIANTS: SceneTemplateVariant[] = [
  {
    label: 'Comment CTA',
    patch: {
      completionEyebrow: 'Finished',
      completionTitle: 'You cleared all {puzzleCount} puzzles',
      completionSubtitle: 'Comment how many you spotted before the reveal.'
    }
  },
  {
    label: 'Replay CTA',
    patch: {
      completionEyebrow: 'Nice run',
      completionTitle: 'That was the full set',
      completionSubtitle: 'Replay and see if you can finish faster next time.'
    }
  },
  {
    label: 'Challenge CTA',
    patch: {
      completionEyebrow: 'Well spotted',
      completionTitle: 'Every scene is done',
      completionSubtitle: 'Send this to a friend and challenge them to beat your score.'
    }
  },
  {
    label: 'Subscribe CTA',
    patch: {
      completionEyebrow: 'More puzzles soon',
      completionTitle: 'Thanks for playing',
      completionSubtitle: 'Follow for the next spot-the-difference challenge.'
    }
  }
];

const MOTIF_FOCUS_OPTIONS: Array<{ value: MotifFocus; label: string; description: string }> = [
  { value: 'balanced', label: 'Balanced', description: 'A broad mix of decorative backdrops for general puzzle videos.' },
  { value: 'party', label: 'Party', description: 'Confetti, bursts, spark trails, and high-energy celebration motifs.' },
  { value: 'paper', label: 'Paper Cut', description: 'Layered collage, ribbons, blobs, and calmer handcrafted depth.' },
  { value: 'comic', label: 'Comic', description: 'Halftone dots, doodles, stickers, and punchier editorial energy.' },
  { value: 'calm', label: 'Calm Motion', description: 'Waves, soft blobs, and lighter motion behind the panels.' }
];

const PALETTE_FOCUS_OPTIONS: Array<{ value: PaletteFocus; label: string; description: string }> = [
  { value: 'mixed', label: 'Mixed', description: 'Uses the full color library.' },
  { value: 'warm', label: 'Warm', description: 'Sunrise, amber, and candy-led tones.' },
  { value: 'cool', label: 'Cool', description: 'Mint, ocean, and airy palettes.' },
  { value: 'night', label: 'Night', description: 'Midnight-heavy packs with brighter contrast.' }
];

const ASPECT_RATIOS: VideoSettings['aspectRatio'][] = ['16:9', '9:16'];
const GENERATED_BACKGROUND_COVERAGE_OPTIONS: Array<{
  value: VideoSettings['generatedBackgroundCoverage'];
  label: string;
}> = [
  { value: 'game_area', label: 'Below Header' },
  { value: 'full_board', label: 'Full Board' }
];

const BOX_VARIANTS: Array<{ value: VideoSettings['revealVariant']; label: string; hint: string }> = [
  { value: 'box_classic', label: 'Classic', hint: 'Clean double-line frame' },
  { value: 'box_minimal', label: 'Minimal', hint: 'Thin understated rectangle' },
  { value: 'box_glow', label: 'Glow', hint: 'Neon edge + shadow' },
  { value: 'box_dashed', label: 'Dashed', hint: 'Segmented outline' },
  { value: 'box_corners', label: 'Corners', hint: 'Bracket corners only' }
];

const CIRCLE_VARIANTS: Array<{ value: VideoSettings['revealVariant']; label: string; hint: string }> = [
  { value: 'circle_classic', label: 'Classic', hint: 'Double clean ring' },
  { value: 'circle_crosshair', label: 'Crosshair', hint: 'Ring with subtle guides' },
  { value: 'circle_ring', label: 'Ring', hint: 'Solid ring marker' },
  { value: 'circle_dotted', label: 'Dotted', hint: 'Dotted circle ring' },
  { value: 'circle_ellipse', label: 'Ellipse', hint: 'Oval marker' },
  { value: 'circle_ellipse_dotted', label: 'Ellipse Dotted', hint: 'Dotted oval marker' },
  { value: 'circle_red_black', label: 'Red + Black', hint: 'Alternating segments' }
];

const HIGHLIGHT_VARIANTS: Array<{ value: VideoSettings['revealVariant']; label: string; hint: string }> = [
  { value: 'highlight_classic', label: 'Classic', hint: 'Crisp border with gentle fill' },
  { value: 'highlight_soft', label: 'Soft', hint: 'Soft glow wash highlight' }
];

const EXPORT_RESOLUTION_OPTIONS: Array<{
  value: VideoSettings['exportResolution'];
  label: string;
  subLabel: string;
}> = [
  { value: '480p', label: '480p', subLabel: 'SD' },
  { value: '720p', label: '720p', subLabel: 'HD' },
  { value: '1080p', label: '1080p', subLabel: 'Full HD' },
  { value: '1440p', label: '1440p', subLabel: '2K' },
  { value: '2160p', label: '4K', subLabel: 'UHD' }
];

type LayoutPanelKey = 'frame' | 'logo' | 'title' | 'timer' | 'progress';
type DeferredLayoutSliderKey =
  | 'headerHeight'
  | 'contentPadding'
  | 'gamePadding'
  | 'panelGap'
  | 'panelRadius'
  | 'logoLeft'
  | 'logoTop'
  | 'logoSize'
  | 'titleLeft'
  | 'titleTop'
  | 'titleFontSize'
  | 'subtitleSize'
  | 'subtitleGap'
  | 'timerLeft'
  | 'timerTop'
  | 'timerFontSize'
  | 'timerMinWidth'
  | 'timerPadX'
  | 'timerPadY'
  | 'timerDotSize'
  | 'timerGap'
  | 'progressLeft'
  | 'progressTop'
  | 'progressWidth'
  | 'progressHeight'
  | 'progressRadius';

const sliderClass = 'w-full h-3 border-2 border-black rounded-full accent-black';

const GENERATED_PROGRESS_STYLE_OPTIONS = Object.keys(PROGRESS_BAR_THEMES) as Array<VideoSettings['generatedProgressStyle']>;

const VIDEO_PROGRESS_MOTION_OPTIONS: Array<{
  value: VideoSettings['progressMotion'];
  label: string;
  hint: string;
}> = [
  { value: 'countdown', label: 'Countdown', hint: 'Drains during the play phase.' },
  { value: 'intro_fill', label: 'Intro Fill', hint: 'Fills in first, then counts down.' },
  { value: 'intro_sweep', label: 'Intro Sweep', hint: 'Runs an entry sweep before countdown.' }
];

const formatGeneratedProgressStyleLabel = (style: VideoSettings['generatedProgressStyle']) =>
  style
    .split('_')
    .map((chunk) => `${chunk.charAt(0).toUpperCase()}${chunk.slice(1)}`)
    .join(' ');

const pickGeneratedValue = <T extends string,>(
  current: T,
  options: Array<{ value: T }>,
  seedOffset = 0,
  excluded: readonly string[] = []
) => {
  const allowedOptions = options.filter((option) => !excluded.includes(option.value));
  const candidates = allowedOptions.filter((option) => option.value !== current);
  const pool = candidates.length ? candidates : allowedOptions;
  const safePool = pool.length ? pool : options;
  return safePool[Math.abs(Date.now() + seedOffset) % safePool.length].value;
};

const resolveFamilies = (focus: MotifFocus): GeneratedBackgroundMotifFamily[] => {
  switch (focus) {
    case 'party':
      return ['confetti_field', 'starburst', 'spark_trails', 'sticker_scatter'];
    case 'paper':
      return ['paper_cut', 'ribbon_swoop', 'blob_garden', 'layered_waves'];
    case 'comic':
      return ['comic_dots', 'doodle_parade', 'sticker_scatter', 'starburst'];
    case 'calm':
      return ['layered_waves', 'paper_cut', 'blob_garden', 'spark_trails'];
    case 'balanced':
    default:
      return GENERATED_BACKGROUND_FAMILY_OPTIONS.map((entry) => entry.value);
  }
};

const resolvePaletteIds = (focus: PaletteFocus): GeneratedBackgroundPaletteId[] => {
  switch (focus) {
    case 'warm':
      return ['sunrise', 'amber', 'candy'];
    case 'cool':
      return ['mint', 'ocean', 'sunrise'];
    case 'night':
      return ['midnight', 'candy', 'ocean'];
    case 'mixed':
    default:
      return GENERATED_BACKGROUND_PALETTE_OPTIONS.map((entry) => entry.value);
  }
};

export const VideoSettingsPanel: React.FC<VideoSettingsPanelProps> = ({
  settings,
  puzzles,
  videoPackages,
  activeVideoPackageId,
  onSettingsChange,
  onAspectRatioChange,
  onSelectVideoPackage,
  onCreateVideoPackage,
  onDuplicateVideoPackage,
  onRenameVideoPackage,
  onDeleteVideoPackage,
  onExportVideoPackage,
  onImportVideoPackage,
  onExport,
  onRestartExport,
  exportRecovery = null,
  onCancelExport,
  isExporting,
  exportProgress,
  exportStatus,
  onStart,
  onBack,
  backgroundPacksSessionId = 0
}) => {
  const [activeSetupTab, setActiveSetupTab] = useState<PreviewSetupTab>('package');
  const [activeOutputTab, setActiveOutputTab] = useState<PreviewOutputTab>('text');
  const [layoutPanels, setLayoutPanels] = useState<Record<LayoutPanelKey, boolean>>({
    frame: true,
    logo: true,
    title: true,
    timer: false,
    progress: false
  });
  const [availableBackgroundPacks, setAvailableBackgroundPacks] = useState(() => loadGeneratedBackgroundPacks());
  const [packName, setPackName] = useState(`Video Pack ${new Date().toLocaleDateString()}`);
  const [packAspectRatio, setPackAspectRatio] = useState<VideoSettings['aspectRatio']>(settings.aspectRatio);
  const [motifFocus, setMotifFocus] = useState<MotifFocus>('balanced');
  const [paletteFocus, setPaletteFocus] = useState<PaletteFocus>('mixed');
  const [layoutSliderDrafts, setLayoutSliderDrafts] = useState<Partial<Record<DeferredLayoutSliderKey, number>>>({});
  const [backgroundBaseSeed, setBackgroundBaseSeed] = useState(() =>
    Math.max(1, Math.floor(Date.now() % 100000))
  );
  const [isRenamePackDialogOpen, setIsRenamePackDialogOpen] = useState(false);
  const [isDeletePackDialogOpen, setIsDeletePackDialogOpen] = useState(false);

  const toggleLayoutPanel = (panel: LayoutPanelKey) => {
    setLayoutPanels((previous) => ({
      ...previous,
      [panel]: !previous[panel]
    }));
  };

  const updateSetting = <K extends keyof VideoSettings>(key: K, value: VideoSettings[K]) => {
    onSettingsChange((previous) => ({ ...previous, [key]: value }));
  };
  type DeferredSliderKey =
    | 'showDuration'
    | 'revealDuration'
    | 'sequentialRevealStep'
    | 'transitionDuration'
    | 'blinkSpeed'
    | 'circleThickness'
    | 'outlineThickness'
    | 'imagePanelOutlineThickness'
    | 'logoZoom';
  const [sliderDrafts, setSliderDrafts] = useState<Partial<Record<DeferredSliderKey, number>>>({});
  const getDeferredSliderValue = <K extends DeferredSliderKey>(key: K) =>
    sliderDrafts[key] ?? Number(settings[key]);
  const updateDeferredSlider = <K extends DeferredSliderKey>(key: K, value: number) => {
    setSliderDrafts((previous) => {
      if (previous[key] === value) {
        return previous;
      }
      return {
        ...previous,
        [key]: value
      };
    });
  };
  const commitDeferredSlider = <K extends DeferredSliderKey>(key: K) => {
    const draftValue = sliderDrafts[key];
    if (typeof draftValue !== 'number') return;
    if (Number(settings[key]) !== draftValue) {
      updateSetting(key, draftValue as VideoSettings[K]);
    }
    setSliderDrafts((previous) => {
      const next = { ...previous };
      delete next[key];
      return next;
    });
  };
  const buildDeferredSliderHandlers = <K extends DeferredSliderKey>(key: K) => ({
    value: getDeferredSliderValue(key),
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      updateDeferredSlider(key, Number(event.target.value));
    },
    onPointerUp: () => commitDeferredSlider(key),
    onMouseUp: () => commitDeferredSlider(key),
    onTouchEnd: () => commitDeferredSlider(key),
    onKeyUp: () => commitDeferredSlider(key),
    onBlur: () => commitDeferredSlider(key)
  });
  const updateSceneSettings = (patch: Partial<VideoSettings['sceneSettings']>) => {
    onSettingsChange((previous) => ({
      ...previous,
      sceneSettings: {
        ...previous.sceneSettings,
        ...patch
      }
    }));
  };
  const updateTextTemplates = (patch: Partial<VideoSettings['textTemplates']>) => {
    onSettingsChange((previous) => ({
      ...previous,
      textTemplates: {
        ...previous.textTemplates,
        ...patch
      }
    }));
  };
  const selectedBackgroundPack = useMemo(
    () =>
      availableBackgroundPacks.find((pack) => pack.id === settings.generatedBackgroundPackId) ??
      availableBackgroundPacks[0] ??
      null,
    [availableBackgroundPacks, settings.generatedBackgroundPackId]
  );
  const selectedVideoPackage = useMemo(
    () =>
      videoPackages.find((videoPackage) => videoPackage.id === activeVideoPackageId) ??
      videoPackages[0] ??
      null,
    [activeVideoPackageId, videoPackages]
  );
  const introClipActive = settings.introVideoEnabled && Boolean(settings.introVideoSrc);
  const introClipDuration = Number(settings.introVideoDuration) || 0;
  const sfxControlsDisabled = !settings.soundEffectsEnabled;
  const musicControlsDisabled = !settings.backgroundMusicEnabled;
  const previewAudioAvailable = settings.soundEffectsEnabled || settings.backgroundMusicEnabled;
  const exportPlan = useMemo(
    () => getVideoExportPlan(puzzles.length, settings.exportPuzzlesPerVideo),
    [puzzles.length, settings.exportPuzzlesPerVideo]
  );
  const splitVideoExportRequested = settings.exportPuzzlesPerVideo > 0;
  const exportPuzzlesPerVideoInput = Math.max(
    1,
    Math.min(
      Math.max(1, puzzles.length || 1),
      Math.floor(settings.exportPuzzlesPerVideo || Math.min(5, Math.max(1, puzzles.length || 5)))
    )
  );
  const exportParallelWorkerLimit = Math.min(4, Math.max(1, exportPlan.outputCount || 1));
  const exportParallelWorkersInput = Math.max(
    1,
    Math.min(exportParallelWorkerLimit, Math.floor(settings.exportParallelWorkers || 1))
  );

  useEffect(() => {
    setAvailableBackgroundPacks(loadGeneratedBackgroundPacks());
  }, [backgroundPacksSessionId]);

  useEffect(() => {
    if (!availableBackgroundPacks.length) return;
    if (
      settings.generatedBackgroundPackId &&
      availableBackgroundPacks.some((pack) => pack.id === settings.generatedBackgroundPackId)
    ) {
      return;
    }
    onSettingsChange({
      ...settings,
      generatedBackgroundPackId: availableBackgroundPacks[0].id
    });
  }, [availableBackgroundPacks, onSettingsChange, settings]);

  const refreshBackgroundPacks = (nextSelectedPackId?: string) => {
    const nextPacks = loadGeneratedBackgroundPacks();
    setAvailableBackgroundPacks(nextPacks);
    const resolvedPackId =
      nextSelectedPackId && nextPacks.some((pack) => pack.id === nextSelectedPackId)
        ? nextSelectedPackId
        : nextPacks.some((pack) => pack.id === settings.generatedBackgroundPackId)
          ? settings.generatedBackgroundPackId
          : nextPacks[0]?.id ?? '';

    if (resolvedPackId !== settings.generatedBackgroundPackId) {
      onSettingsChange({
        ...settings,
        generatedBackgroundPackId: resolvedPackId
      });
    }
  };
  const selectedStyleOption =
    VISUAL_STYLE_OPTIONS.find((option) => option.value === settings.visualStyle) ?? VISUAL_STYLE_OPTIONS[0];
  const selectedRevealBehaviorOption =
    VIDEO_REVEAL_BEHAVIOR_OPTIONS.find((option) => option.value === settings.revealBehavior) ??
    VIDEO_REVEAL_BEHAVIOR_OPTIONS[0];
  const compactRevealBehaviorOptions = useMemo(() => {
    const visibleOptions = new Set(['marker_only', 'pulse', 'spotlight', 'freeze_ring', settings.revealBehavior]);
    return VIDEO_REVEAL_BEHAVIOR_OPTIONS.filter((option) => visibleOptions.has(option.value));
  }, [settings.revealBehavior]);
  const compactBoxVariants = useMemo(() => {
    const visibleVariants = new Set(['box_classic', 'box_glow', 'box_corners', settings.revealVariant]);
    return BOX_VARIANTS.filter((variant) => visibleVariants.has(variant.value));
  }, [settings.revealVariant]);
  const compactCircleVariants = useMemo(() => {
    const visibleVariants = new Set([
      'circle_classic',
      'circle_crosshair',
      'circle_ring',
      'circle_red_black',
      settings.revealVariant
    ]);
    return CIRCLE_VARIANTS.filter((variant) => visibleVariants.has(variant.value));
  }, [settings.revealVariant]);
  const compactHighlightVariants = HIGHLIGHT_VARIANTS;
  const selectedProgressStyleOption =
    VIDEO_PROGRESS_STYLE_OPTIONS.find((option) => option.value === settings.progressStyle) ??
    VIDEO_PROGRESS_STYLE_OPTIONS[0];
  const selectedProgressMotionOption =
    VIDEO_PROGRESS_MOTION_OPTIONS.find((option) => option.value === settings.progressMotion) ??
    VIDEO_PROGRESS_MOTION_OPTIONS[0];
  const selectedIntroCardStyleOption =
    VIDEO_SCENE_CARD_STYLE_OPTIONS.find((option) => option.value === settings.introCardStyle) ??
    VIDEO_SCENE_CARD_STYLE_OPTIONS[0];
  const selectedTransitionCardStyleOption =
    VIDEO_SCENE_CARD_STYLE_OPTIONS.find((option) => option.value === settings.transitionCardStyle) ??
    VIDEO_SCENE_CARD_STYLE_OPTIONS[0];
  const selectedOutroCardStyleOption =
    VIDEO_SCENE_CARD_STYLE_OPTIONS.find((option) => option.value === settings.outroCardStyle) ??
    VIDEO_SCENE_CARD_STYLE_OPTIONS[0];
  const selectedTransitionStyleOption =
    VIDEO_TRANSITION_STYLE_OPTIONS.find((option) => option.value === settings.transitionStyle) ??
    VIDEO_TRANSITION_STYLE_OPTIONS[0];
  const previewPackageOptions = videoPackages.map((videoPackage) => ({
    id: videoPackage.id,
    name: videoPackage.name
  }));
  const previewThemeOptions = VISUAL_STYLE_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label
  }));
  const workspaceSelectClass =
    'h-10 min-w-0 w-full rounded-xl border-2 border-black bg-white px-4 text-sm font-black text-slate-900 outline-none';
  const backgroundPackPreview = useMemo(
    () =>
      settings.generatedBackgroundsEnabled
        ? resolveGeneratedBackgroundForIndex(
            selectedBackgroundPack,
            0,
            settings.generatedBackgroundShuffleSeed
          )
        : null,
    [selectedBackgroundPack, settings.generatedBackgroundShuffleSeed, settings.generatedBackgroundsEnabled]
  );

  const customLayoutSeed = useMemo(
    () => buildDefaultCustomVideoLayout(settings.videoPackagePreset, settings.aspectRatio),
    [settings.videoPackagePreset, settings.aspectRatio]
  );
  const customLayout = settings.customLayout ?? customLayoutSeed;
  const previewStage = BASE_STAGE_SIZE[settings.aspectRatio];
  const livePreviewHeightStyle =
    settings.aspectRatio === '9:16'
      ? 'clamp(420px, 66vh, 680px)'
      : 'clamp(280px, 35vh, 430px)';
  const processedLogoSrc = useProcessedLogoSrc(settings.logo, {
    enabled: settings.logoChromaKeyEnabled,
    color: settings.logoChromaKeyColor,
    tolerance: settings.logoChromaKeyTolerance
  });
  const logoZoom = clampLogoZoom(getDeferredSliderValue('logoZoom'));

  const defaultVariantByStyle: Record<VideoSettings['revealStyle'], VideoSettings['revealVariant']> = {
    box: 'box_glow',
    circle: 'circle_dotted',
    highlight: 'highlight_soft'
  };

  const isVariantCompatible = (
    style: VideoSettings['revealStyle'],
    variant: VideoSettings['revealVariant']
  ) => {
    if (style === 'box') return variant.startsWith('box_');
    if (style === 'circle') return variant.startsWith('circle_');
    return variant.startsWith('highlight_');
  };

  const updateRevealStyle = (style: VideoSettings['revealStyle']) => {
    const nextVariant = isVariantCompatible(style, settings.revealVariant)
      ? settings.revealVariant
      : defaultVariantByStyle[style];

    onSettingsChange({
      ...settings,
      revealStyle: style,
      revealVariant: nextVariant
    });
  };

  const updateCustomLayout = (patch: Partial<CustomVideoLayout>) => {
    onSettingsChange({
      ...settings,
      useCustomLayout: true,
      customLayout: {
        ...customLayout,
        ...patch
      }
    });
  };

  const setCustomLayoutEnabled = (enabled: boolean) => {
    onSettingsChange({
      ...settings,
      useCustomLayout: enabled,
      customLayout: enabled ? customLayout : settings.customLayout
    });
  };

  const handleSaveCustomLayout = () => {
    if (!saveVideoCustomLayout(customLayout)) {
      alert('Could not save custom layout.');
      return;
    }

    alert('Custom layout saved.');
  };

  const handleLoadCustomLayout = () => {
    const savedLayout = loadSavedVideoCustomLayout();
    if (!savedLayout) {
      alert('No saved custom layout found.');
      return;
    }

    onSettingsChange({
      ...settings,
      useCustomLayout: true,
      customLayout: {
        ...customLayoutSeed,
        ...savedLayout
      }
    });
  };

  const handleResetCustomLayout = () => {
    onSettingsChange({
      ...settings,
      useCustomLayout: false,
      customLayout: customLayoutSeed
    });
  };

  const handleLogoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const storedSource = await saveImageAssetFromFile(file);
      updateSetting('logo', storedSource);
    } catch (error) {
      console.error('Failed to store logo image', error);
      alert('Failed to load that logo image.');
    } finally {
      event.target.value = '';
    }
  };

  type AudioSrcKey = 'backgroundMusicSrc';

  const clearAudioSource = (key: AudioSrcKey) => {
    const current = settings[key];
    if (current) {
      void deleteStoredAudioAsset(current);
    }
    updateSetting(key, '');
  };

  const handleAudioUpload =
    (key: AudioSrcKey) => async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      if (!file.type.startsWith('audio/')) {
        alert('Choose an audio file.');
        event.target.value = '';
        return;
      }
      try {
        const previous = settings[key];
        const storedSource = await saveAudioAssetFromFile(file);
        updateSetting(key, storedSource);
        if (previous && previous !== storedSource) {
          await deleteStoredAudioAsset(previous);
        }
      } catch (error) {
        console.error('Failed to load audio file', error);
        alert('Failed to load that audio file.');
      } finally {
        event.target.value = '';
      }
  };

  const updateAudioCuePool = (
    key: VideoAudioCuePoolKey,
    patch: Partial<VideoSettings['audioCuePools'][VideoAudioCuePoolKey]>
  ) => {
    onSettingsChange((previous) => ({
      ...previous,
      audioCuePools: {
        ...previous.audioCuePools,
        [key]: {
          ...previous.audioCuePools[key],
          ...patch
        }
      }
    }));
  };

  const handleAudioPoolUpload =
    (key: VideoAudioCuePoolKey) => async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files ? Array.from(event.target.files as FileList) : [];
      if (!files.length) return;
      const audioFiles = files.filter((file) => file.type.startsWith('audio/'));
      if (!audioFiles.length) {
        alert('Choose audio files.');
        event.target.value = '';
        return;
      }
      try {
        const storedSources = await Promise.all(audioFiles.map((file) => saveAudioAssetFromFile(file)));
        const nextSources = [...settings.audioCuePools[key].sources, ...storedSources];
        updateAudioCuePool(key, { sources: nextSources });
      } catch (error) {
        console.error('Failed to load audio pool files', error);
        alert('Failed to load one or more audio files.');
      } finally {
        event.target.value = '';
      }
    };

  const clearAudioPoolSources = async (key: VideoAudioCuePoolKey) => {
    const currentSources = settings.audioCuePools[key].sources;
    if (currentSources.length > 0) {
      await deleteStoredAudioAssets(currentSources);
    }
    updateAudioCuePool(key, { sources: [] });
  };

  const removeAudioPoolSource = async (key: VideoAudioCuePoolKey, sourceIndex: number) => {
    const currentSources = settings.audioCuePools[key].sources;
    const targetSource = currentSources[sourceIndex];
    if (!targetSource) return;
    await deleteStoredAudioAsset(targetSource);
    updateAudioCuePool(key, {
      sources: currentSources.filter((_, index) => index !== sourceIndex)
    });
  };

  const handleIntroVideoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const hasVideoMime = file.type ? file.type.startsWith('video/') : false;
    const hasVideoExtension = /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(file.name);
    if (!hasVideoMime && !hasVideoExtension) {
      alert('Choose a video file (mp4, mov, webm, m4v, mkv, avi).');
      event.target.value = '';
      return;
    }
    try {
      const previous = settings.introVideoSrc;
      const storedSource =
        import.meta.env.DEV && !window.isSecureContext
          ? URL.createObjectURL(file)
          : await saveVideoAssetFromFile(file);
      let durationSeconds = 0;
      try {
        const metadata = await readVideoFileMetadata(file);
        durationSeconds = Number.isFinite(metadata.durationSeconds) ? metadata.durationSeconds : 0;
      } catch (error) {
        console.warn('Failed to read intro clip metadata', error);
      }

      onSettingsChange((previous) => ({
        ...previous,
        introVideoEnabled: true,
        introVideoSrc: storedSource,
        introVideoDuration: durationSeconds,
        sceneSettings: {
          ...previous.sceneSettings,
          introEnabled: true,
          introDuration:
            durationSeconds > 0 ? durationSeconds : previous.sceneSettings.introDuration
        }
      }));

      if (previous && previous !== storedSource && isStoredVideoAssetSource(previous)) {
        await deleteStoredVideoAsset(previous);
      }
    } catch (error) {
      console.error('Failed to load intro clip', error);
      const message =
        error instanceof Error && error.message.includes('IndexedDB')
          ? 'Video storage is unavailable in this browser. Try another browser or disable private mode.'
          : error instanceof Error && error.name === 'QuotaExceededError'
          ? 'Storage is full. Try a smaller clip.'
          : 'Failed to load that intro clip.';
      alert(message);
    } finally {
      event.target.value = '';
    }
  };

  const clearIntroVideo = async () => {
    if (settings.introVideoSrc && isStoredVideoAssetSource(settings.introVideoSrc)) {
      await deleteStoredVideoAsset(settings.introVideoSrc);
    }
    onSettingsChange((previous) => ({
      ...previous,
      introVideoEnabled: false,
      introVideoSrc: '',
      introVideoDuration: 0
    }));
  };

  const renderModuleGenerator = <T extends string,>(
    label: string,
    value: T,
    options: Array<VideoStyleOption<T>>,
    onChange: (value: T) => void,
    onGenerate: () => void
  ) => {
    return (
      <div className="space-y-3 rounded-2xl border-2 border-black bg-[#FFFDF8] p-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[10px] font-black uppercase text-slate-600">{label}</span>
          <button
            type="button"
            onClick={onGenerate}
            className="rounded-full border-2 border-black bg-[#FFF5CC] px-3 py-1 text-[10px] font-black uppercase hover:bg-[#FDE68A]"
          >
            Generate
          </button>
        </div>
        <select
          value={value}
          onChange={(event) => onChange(event.target.value as T)}
          className={workspaceSelectClass}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
            ))}
          </select>
      </div>
    );
  };

  const renderTextTemplateField = (field: TextTemplateField) => {
    const inputClass =
      'mt-1 w-full rounded-xl border-2 border-black bg-white px-3 py-2 text-sm font-semibold text-slate-900';
    return (
      <label key={field.key} className={`block ${field.span === 'full' ? 'sm:col-span-2' : ''}`}>
        <span className="text-[10px] font-black uppercase text-slate-600">{field.label}</span>
        {field.rows && field.rows > 1 ? (
          <textarea
            rows={field.rows}
            value={settings.textTemplates[field.key]}
            onChange={(event) =>
              updateTextTemplates({
                [field.key]: event.target.value
              } as Partial<VideoSettings['textTemplates']>)
            }
            className={inputClass}
          />
        ) : (
          <input
            type="text"
            value={settings.textTemplates[field.key]}
            onChange={(event) =>
              updateTextTemplates({
                [field.key]: event.target.value
              } as Partial<VideoSettings['textTemplates']>)
            }
            className={inputClass}
          />
        )}
      </label>
    );
  };

  const generateVariantPatch = (variants: SceneTemplateVariant[], seedOffset: number) => {
    const nextVariant =
      variants[Math.abs(Date.now() + seedOffset + settings.generatedBackgroundShuffleSeed) % variants.length];
    updateTextTemplates(nextVariant.patch);
  };

  const applyCopyPreset = (preset: SceneCopyTemplatePreset) => {
    updateTextTemplates(preset.templates);
  };

  const rerollGeneratedBackgroundSeed = () => {
    const nextSeed = ((Date.now() + settings.generatedBackgroundShuffleSeed * 131) % 9999) + 1;
    updateSetting('generatedBackgroundShuffleSeed', nextSeed);
  };

  const resetStyleStackToPackage = () => {
    const packagePreset = VIDEO_PACKAGE_PRESETS[settings.videoPackagePreset] ?? VIDEO_PACKAGE_PRESETS.gameshow;
    onSettingsChange({
      ...settings,
      visualStyle: packagePreset.defaultVisualStyle,
      textStyle: 'package',
      headerStyle: 'package',
      timerStyle: 'package',
      progressStyle: 'package',
      introCardStyle: 'package',
      transitionCardStyle: 'package',
      outroCardStyle: 'package',
      transitionStyle: 'fade'
    });
  };

  const generateUiStack = () => {
    onSettingsChange({
      ...settings,
      textStyle: pickGeneratedValue(settings.textStyle, VIDEO_TEXT_STYLE_OPTIONS, 11, ['package']),
      headerStyle: pickGeneratedValue(settings.headerStyle, VIDEO_HEADER_STYLE_OPTIONS, 23, ['package']),
      timerStyle: pickGeneratedValue(settings.timerStyle, VIDEO_TIMER_STYLE_OPTIONS, 37, ['package']),
      progressStyle: pickGeneratedValue(settings.progressStyle, VIDEO_PROGRESS_STYLE_OPTIONS, 53, ['package'])
    });
  };

  const generateSceneStack = () => {
    onSettingsChange({
      ...settings,
      introCardStyle: pickGeneratedValue(settings.introCardStyle, VIDEO_SCENE_CARD_STYLE_OPTIONS, 71, ['package']),
      transitionCardStyle: pickGeneratedValue(
        settings.transitionCardStyle,
        VIDEO_SCENE_CARD_STYLE_OPTIONS,
        83,
        ['package']
      ),
      outroCardStyle: pickGeneratedValue(settings.outroCardStyle, VIDEO_SCENE_CARD_STYLE_OPTIONS, 97, ['package']),
      transitionStyle: pickGeneratedValue(settings.transitionStyle, VIDEO_TRANSITION_STYLE_OPTIONS, 109)
    });
  };

  const generateWholeVideoStyle = () => {
    const nextCopyPreset =
      SCENE_COPY_TEMPLATE_PRESETS[
        Math.abs(Date.now() + settings.generatedBackgroundShuffleSeed) % SCENE_COPY_TEMPLATE_PRESETS.length
      ];

    onSettingsChange({
      ...settings,
      visualStyle: pickGeneratedValue(settings.visualStyle, VISUAL_STYLE_OPTIONS, 5),
      textStyle: pickGeneratedValue(settings.textStyle, VIDEO_TEXT_STYLE_OPTIONS, 11, ['package']),
      headerStyle: pickGeneratedValue(settings.headerStyle, VIDEO_HEADER_STYLE_OPTIONS, 23, ['package']),
      timerStyle: pickGeneratedValue(settings.timerStyle, VIDEO_TIMER_STYLE_OPTIONS, 37, ['package']),
      progressStyle: pickGeneratedValue(settings.progressStyle, VIDEO_PROGRESS_STYLE_OPTIONS, 53, ['package']),
      introCardStyle: pickGeneratedValue(settings.introCardStyle, VIDEO_SCENE_CARD_STYLE_OPTIONS, 71, ['package']),
      transitionCardStyle: pickGeneratedValue(
        settings.transitionCardStyle,
        VIDEO_SCENE_CARD_STYLE_OPTIONS,
        83,
        ['package']
      ),
      outroCardStyle: pickGeneratedValue(settings.outroCardStyle, VIDEO_SCENE_CARD_STYLE_OPTIONS, 97, ['package']),
      transitionStyle: pickGeneratedValue(settings.transitionStyle, VIDEO_TRANSITION_STYLE_OPTIONS, 109),
      generatedBackgroundsEnabled: true,
      generatedBackgroundShuffleSeed: ((Date.now() + settings.generatedBackgroundShuffleSeed * 131) % 9999) + 1,
      textTemplates: {
        ...nextCopyPreset.templates
      }
    });
  };

  const handleGeneratePack = () => {
    const pack = createGeneratedBackgroundPack({
      name: packName,
      count: GENERATED_BACKGROUND_PACK_SIZE,
      aspectRatio: packAspectRatio,
      baseSeed: backgroundBaseSeed,
      families: resolveFamilies(motifFocus),
      paletteIds: resolvePaletteIds(paletteFocus)
    });
    saveGeneratedBackgroundPack(pack);
    setBackgroundBaseSeed((current) => current + 17);
    refreshBackgroundPacks(pack.id);
    onSettingsChange({
      ...settings,
      generatedBackgroundsEnabled: true,
      generatedBackgroundPackId: pack.id
    });
  };

  const handleRenameSelectedPack = () => {
    if (!selectedBackgroundPack) return;
    setIsRenamePackDialogOpen(true);
  };

  const confirmRenameSelectedPack = (nextName: string) => {
    if (!selectedBackgroundPack || nextName.trim() === selectedBackgroundPack.name) {
      setIsRenamePackDialogOpen(false);
      return;
    }
    setAvailableBackgroundPacks(renameGeneratedBackgroundPack(selectedBackgroundPack.id, nextName.trim()));
    setIsRenamePackDialogOpen(false);
  };

  const handleDeleteSelectedPack = () => {
    if (!selectedBackgroundPack) return;
    setIsDeletePackDialogOpen(true);
  };

  const confirmDeleteSelectedPack = () => {
    if (!selectedBackgroundPack) return;
    setAvailableBackgroundPacks(deleteGeneratedBackgroundPack(selectedBackgroundPack.id));
    setIsDeletePackDialogOpen(false);
    refreshBackgroundPacks();
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#F6F2E8]">
      <div className="sticky top-0 z-20 shrink-0 border-b-2 border-black bg-[#FFD93D] px-2 py-2.5 sm:px-3">
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-2.5 sm:items-center">
            <button
              onClick={onBack}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border-2 border-black bg-white transition-colors hover:bg-black hover:text-white"
            >
              <ArrowLeft size={16} strokeWidth={3} />
            </button>
            <div className="min-w-0">
              <div className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.18em] text-slate-700">Video Mode</div>
              <h2 className="text-[1.35rem] sm:text-[1.55rem] md:text-[1.7rem] font-black uppercase leading-none">Production Setup</h2>
            </div>
          </div>

            <div className="flex w-full flex-col gap-1.5 sm:w-auto sm:flex-row sm:items-center">
            <div className="rounded-xl border-2 border-black bg-black px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-white sm:text-[10px]">
              {puzzles.length} Puzzle{puzzles.length === 1 ? '' : 's'}
            </div>
            <button
              onClick={onStart}
              disabled={puzzles.length === 0}
              className={`inline-flex w-full items-center justify-center gap-1.5 rounded-xl border-4 border-black px-3.5 py-1.5 text-[12px] font-black uppercase tracking-wide sm:w-auto ${
                puzzles.length === 0
                  ? 'bg-slate-300 text-slate-700 cursor-not-allowed'
                  : 'bg-black text-white hover:bg-slate-900 shadow-[4px_4px_0px_0px_rgba(255,255,255,1)]'
              }`}
            >
              <Play size={14} strokeWidth={3} />
              Start Video
            </button>
          </div>
          </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {(() => {
          const packagePanel = activeSetupTab === 'package' && (
            <div className="space-y-4">
              <div className="space-y-4">
                <div className="space-y-3 border-b border-black/15 pb-4">
                  <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-600">Package</div>

                  <label className="block">
                    <span className="block text-[10px] font-black uppercase text-slate-600">Active</span>
                    <select
                      value={activeVideoPackageId}
                      onChange={(event) => onSelectVideoPackage(event.target.value)}
                      className={`mt-1 ${workspaceSelectClass}`}
                    >
                      {videoPackages.map((videoPackage) => (
                        <option key={videoPackage.id} value={videoPackage.id}>
                          {videoPackage.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={onCreateVideoPackage}
                      className="rounded-xl border-2 border-black bg-[#A7F3D0] px-3 py-2 text-[10px] font-black uppercase hover:bg-[#86EFAC]"
                    >
                      New
                    </button>
                    <button
                      type="button"
                      onClick={onDuplicateVideoPackage}
                      className="rounded-xl border-2 border-black bg-[#DBEAFE] px-3 py-2 text-[10px] font-black uppercase hover:bg-[#BFDBFE]"
                    >
                      Duplicate
                    </button>
                    <button
                      type="button"
                      onClick={() => selectedVideoPackage && onRenameVideoPackage(selectedVideoPackage.id)}
                      disabled={!selectedVideoPackage}
                      className={`rounded-xl border-2 border-black px-3 py-2 text-[10px] font-black uppercase ${
                        selectedVideoPackage ? 'bg-[#FDE68A] hover:bg-[#FCD34D]' : 'bg-slate-200 text-slate-500'
                      }`}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      onClick={() => selectedVideoPackage && onDeleteVideoPackage(selectedVideoPackage.id)}
                      disabled={!selectedVideoPackage || selectedVideoPackage.id === 'video-package-default'}
                      className={`rounded-xl border-2 border-black px-3 py-2 text-[10px] font-black uppercase ${
                        selectedVideoPackage && selectedVideoPackage.id !== 'video-package-default'
                          ? 'bg-[#FECACA] hover:bg-[#FCA5A5]'
                          : 'bg-slate-200 text-slate-500'
                      }`}
                    >
                      Delete
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        void onExportVideoPackage();
                      }}
                      disabled={!selectedVideoPackage}
                      className={`inline-flex items-center justify-center gap-2 rounded-xl border-2 border-black px-3 py-2 text-[10px] font-black uppercase ${
                        selectedVideoPackage
                          ? 'bg-[#E9D5FF] hover:bg-[#DDD6FE]'
                          : 'bg-slate-200 text-slate-500'
                      }`}
                    >
                      <Download size={12} strokeWidth={2.5} />
                      Export
                    </button>
                    <button
                      type="button"
                      onClick={onImportVideoPackage}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border-2 border-black bg-[#BFDBFE] px-3 py-2 text-[10px] font-black uppercase hover:bg-[#93C5FD]"
                    >
                      <Upload size={12} strokeWidth={2.5} />
                      Import
                    </button>
                  </div>

                  <div className="space-y-2 border-t border-black/15 pt-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[10px] font-black uppercase text-slate-600">Ratio</div>
                      <button
                        type="button"
                        onClick={() => setActiveOutputTab('layout')}
                        className="rounded-full border border-black px-2.5 py-1 text-[9px] font-black uppercase hover:bg-slate-100"
                      >
                        Layout
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {ASPECT_RATIO_OPTIONS.map((ratio) => (
                        <button
                          key={ratio.value}
                          type="button"
                          onClick={() => onAspectRatioChange(ratio.value)}
                          className={`rounded-xl border-2 border-black px-3 py-2 text-[10px] font-black uppercase ${
                            settings.aspectRatio === ratio.value ? 'bg-[#4ECDC4]' : 'bg-white hover:bg-slate-50'
                          }`}
                        >
                          {ratio.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-600">Package Progress</div>

                  <div className="space-y-1.5">
                    <div className="text-[10px] font-black uppercase text-slate-600">Visibility</div>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { value: true, label: 'On' },
                        { value: false, label: 'Off' }
                      ].map((option) => (
                        <button
                          key={option.label}
                          type="button"
                          onClick={() => updateSetting('showProgress', option.value)}
                          className={`rounded-xl border-2 border-black px-3 py-2 text-[10px] font-black uppercase ${
                            settings.showProgress === option.value ? 'bg-[#A7F3D0]' : 'bg-white hover:bg-slate-100'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5 border-t border-black/15 pt-3">
                    <div className="text-[10px] font-black uppercase text-slate-600">Source</div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => updateSetting('generatedProgressEnabled', false)}
                        className={`rounded-xl border-2 border-black px-3 py-2 text-[10px] font-black uppercase ${
                          !settings.generatedProgressEnabled ? 'bg-[#DBEAFE]' : 'bg-white hover:bg-slate-100'
                        }`}
                      >
                        Package
                      </button>
                      <button
                        type="button"
                        onClick={() => updateSetting('generatedProgressEnabled', true)}
                        className={`rounded-xl border-2 border-black px-3 py-2 text-[10px] font-black uppercase ${
                          settings.generatedProgressEnabled ? 'bg-[#FFD93D]' : 'bg-white hover:bg-slate-100'
                        }`}
                      >
                        Generated
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5 border-t border-black/15 pt-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[10px] font-black uppercase text-slate-600">Progress Bar</div>
                      {settings.generatedProgressEnabled ? (
                        <button
                          type="button"
                          onClick={() =>
                            updateSetting(
                              'progressStyle',
                              pickGeneratedValue(settings.progressStyle, VIDEO_PROGRESS_STYLE_OPTIONS, 53, ['package'])
                            )
                          }
                          className="rounded-full border border-black bg-[#FFF2B3] px-2.5 py-1 text-[9px] font-black uppercase hover:bg-[#FDE68A]"
                        >
                          Generate
                        </button>
                      ) : null}
                    </div>
                    <select
                      value={settings.progressStyle}
                      onChange={(event) => updateSetting('progressStyle', event.target.value as VideoSettings['progressStyle'])}
                      className={workspaceSelectClass}
                    >
                      {VIDEO_PROGRESS_STYLE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {settings.generatedProgressEnabled ? (
                    <div className="space-y-3 border-t border-black/15 pt-3">
                      <div className="space-y-1.5">
                        <div className="text-[10px] font-black uppercase text-slate-600">Generated Theme</div>
                        <select
                          value={settings.generatedProgressStyle}
                          onChange={(event) =>
                            updateSetting('generatedProgressStyle', event.target.value as VideoSettings['generatedProgressStyle'])
                          }
                          className={workspaceSelectClass}
                        >
                          {GENERATED_PROGRESS_STYLE_OPTIONS.map((style) => (
                            <option key={style} value={style}>
                              {formatGeneratedProgressStyleLabel(style)}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-1.5">
                        <div className="text-[10px] font-black uppercase text-slate-600">Generated Type</div>
                        <div className="grid grid-cols-2 gap-2">
                          {[
                            { value: 'bar' as const, label: 'Bar' },
                            { value: 'text_fill' as const, label: 'Text Fill' }
                          ].map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => updateSetting('generatedProgressRenderMode', option.value)}
                              className={`rounded-xl border-2 border-black px-3 py-2 text-[10px] font-black uppercase ${
                                settings.generatedProgressRenderMode === option.value ? 'bg-[#A7F3D0]' : 'bg-white hover:bg-slate-100'
                              }`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div className="space-y-1.5 border-t border-black/15 pt-3">
                    <div className="text-[10px] font-black uppercase text-slate-600">Motion</div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {VIDEO_PROGRESS_MOTION_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => updateSetting('progressMotion', option.value)}
                          className={`rounded-xl border-2 border-black px-2 py-2 text-[8px] font-black uppercase ${
                            settings.progressMotion === option.value ? 'bg-[#FDE68A]' : 'bg-white hover:bg-slate-100'
                          }`}
                          title={option.hint}
                        >
                          {option.label}
                        </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2 border-t border-black/15 pt-3">
                      <div className="text-[10px] font-black uppercase text-slate-600">Logo</div>
                      <div className="flex items-center gap-2">
                        <div className="relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg border-2 border-black bg-white">
                          {processedLogoSrc ? (
                            <img
                              src={processedLogoSrc}
                              alt="Logo preview"
                              className="h-full w-full object-contain"
                            />
                          ) : (
                            <ImageIcon size={18} className="text-slate-300" />
                          )}
                        </div>
                        <div className="flex flex-1 flex-wrap gap-2">
                          <label className="cursor-pointer rounded-lg border-2 border-black bg-black px-3 py-2 text-[10px] font-black uppercase text-white hover:bg-slate-800">
                            Upload
                            <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                          </label>
                          {settings.logo ? (
                            <button
                              type="button"
                              onClick={() => updateSetting('logo', undefined)}
                              className="rounded-lg border-2 border-black bg-white px-3 py-2 text-[10px] font-black uppercase hover:bg-red-50"
                            >
                              Remove
                            </button>
                          ) : null}
                        </div>
                      </div>
                      {settings.logo ? (
                        <div>
                          <div className="flex justify-between text-[10px] font-black uppercase">
                            <span>Zoom</span>
                            <span>{logoZoom.toFixed(2)}x</span>
                          </div>
                          <input
                            type="range"
                            min="0.5"
                            max="4"
                            step="0.05"
                            {...buildDeferredSliderHandlers('logoZoom')}
                            className={`${sliderClass} mt-2`}
                          />
                        </div>
                      ) : null}
                    </div>

                    <div className="space-y-2 border-t border-black/15 pt-3">
                      <div className="text-[10px] font-black uppercase text-slate-600">Intro Clip</div>
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="cursor-pointer rounded-lg border-2 border-black bg-white px-3 py-2 text-[10px] font-black uppercase hover:bg-slate-100">
                          Upload
                          <input type="file" accept="video/*" onChange={handleIntroVideoUpload} className="hidden" />
                        </label>
                        {introClipActive ? (
                          <button
                            type="button"
                            onClick={clearIntroVideo}
                            className="rounded-lg border-2 border-black bg-white px-3 py-2 text-[10px] font-black uppercase hover:bg-red-50"
                          >
                            Remove
                          </button>
                        ) : null}
                        {introClipActive && introClipDuration > 0 ? (
                          <span className="rounded-full border border-black px-2 py-1 text-[9px] font-black uppercase">
                            {introClipDuration.toFixed(2)}s
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
            </div>
          );

          const layoutPanel = activeOutputTab === 'layout' && (
            <div className="space-y-6">
              <div className="bg-white border-4 border-black rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] p-4 md:p-5 space-y-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-lg font-black uppercase">Layout Designer</h3>
                    <p className="text-[10px] font-bold uppercase text-slate-600 mt-1">Precise control for preview + export layout.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCustomLayoutEnabled(!settings.useCustomLayout)}
                    className={`px-3 py-1 rounded-lg border-2 border-black text-xs font-black uppercase ${
                      settings.useCustomLayout ? 'bg-[#A7F3D0]' : 'bg-white hover:bg-slate-100'
                    }`}
                  >
                    {settings.useCustomLayout ? 'Enabled' : 'Disabled'}
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button type="button" onClick={handleSaveCustomLayout} className="px-2 py-2 border-2 border-black rounded-lg text-[10px] font-black uppercase bg-white hover:bg-slate-100">Save</button>
                  <button type="button" onClick={handleLoadCustomLayout} className="px-2 py-2 border-2 border-black rounded-lg text-[10px] font-black uppercase bg-white hover:bg-slate-100">Load</button>
                  <button type="button" onClick={handleResetCustomLayout} className="px-2 py-2 border-2 border-black rounded-lg text-[10px] font-black uppercase bg-white hover:bg-red-50">Reset</button>
                </div>

                <div className="rounded-2xl border-2 border-black bg-[#FFFDF8] p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-black uppercase">Image Panel Outline</div>
                    <input
                      type="color"
                      value={settings.imagePanelOutlineColor}
                      onChange={(event) => updateSetting('imagePanelOutlineColor', event.target.value)}
                      className="h-10 w-16 rounded-lg border-2 border-black bg-white p-1"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between text-xs font-black uppercase">
                      <span>Thickness</span>
                      <span>{getDeferredSliderValue('imagePanelOutlineThickness')}px</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="24"
                      step="1"
                      {...buildDeferredSliderHandlers('imagePanelOutlineThickness')}
                      className="mt-2 h-3 w-full rounded-full border-2 border-black accent-black"
                    />
                  </div>
                  <div className="grid grid-cols-6 gap-2">
                    {IMAGE_PANEL_OUTLINE_SWATCHES.map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => updateSetting('imagePanelOutlineColor', color)}
                        className={`h-8 rounded-lg border-2 border-black ${settings.imagePanelOutlineColor === color ? 'ring-2 ring-slate-500 ring-offset-2' : ''}`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <div className="p-3 border-2 border-black rounded-lg bg-[#F8FDFF]">
                    <button
                      type="button"
                      onClick={() => toggleLayoutPanel('frame')}
                      aria-expanded={layoutPanels.frame}
                      className="w-full flex items-center justify-between gap-2"
                    >
                      <span className="text-[10px] font-black uppercase text-slate-600">Frame</span>
                      <span className="text-[10px] font-black uppercase text-slate-700">{layoutPanels.frame ? 'Hide' : 'Show'}</span>
                    </button>
                    {layoutPanels.frame && (
                      <div className="mt-3 space-y-3">
                        <div><div className="flex justify-between text-xs font-black"><span>Header Height</span><span>{Math.round(customLayout.headerHeight)}</span></div><input type="range" min="36" max="260" value={customLayout.headerHeight} onChange={(event) => updateCustomLayout({ headerHeight: Number(event.target.value) })} className={sliderClass} /></div>
                        <div><div className="flex justify-between text-xs font-black"><span>Content Padding</span><span>{Math.round(customLayout.contentPadding)}</span></div><input type="range" min="0" max="180" value={customLayout.contentPadding} onChange={(event) => updateCustomLayout({ contentPadding: Number(event.target.value) })} className={sliderClass} /></div>
                        <div><div className="flex justify-between text-xs font-black"><span>Game Padding</span><span>{Math.round(customLayout.gamePadding)}</span></div><input type="range" min="0" max="120" value={customLayout.gamePadding} onChange={(event) => updateCustomLayout({ gamePadding: Number(event.target.value) })} className={sliderClass} /></div>
                        <div><div className="flex justify-between text-xs font-black"><span>Panel Gap</span><span>{Math.round(customLayout.panelGap)}</span></div><input type="range" min="0" max="220" value={customLayout.panelGap} onChange={(event) => updateCustomLayout({ panelGap: Number(event.target.value) })} className={sliderClass} /></div>
                        <div><div className="flex justify-between text-xs font-black"><span>Panel Radius</span><span>{Math.round(customLayout.panelRadius)}</span></div><input type="range" min="0" max="220" value={customLayout.panelRadius} onChange={(event) => updateCustomLayout({ panelRadius: Number(event.target.value) })} className={sliderClass} /></div>
                      </div>
                    )}
                  </div>

                  <div className="p-3 border-2 border-black rounded-lg bg-[#F8FDFF]">
                    <button
                      type="button"
                      onClick={() => toggleLayoutPanel('logo')}
                      aria-expanded={layoutPanels.logo}
                      className="w-full flex items-center justify-between gap-2"
                    >
                      <span className="text-[10px] font-black uppercase text-slate-600">Logo</span>
                      <span className="text-[10px] font-black uppercase text-slate-700">{layoutPanels.logo ? 'Hide' : 'Show'}</span>
                    </button>
                    {layoutPanels.logo && (
                      <div className="mt-3 space-y-3">
                        <div><div className="flex justify-between text-xs font-black"><span>Logo X</span><span>{Math.round(customLayout.logoLeft)}</span></div><input type="range" min="0" max={String(previewStage.width)} value={customLayout.logoLeft} onChange={(event) => updateCustomLayout({ logoLeft: Number(event.target.value) })} className={sliderClass} /></div>
                        <div><div className="flex justify-between text-xs font-black"><span>Logo Y</span><span>{Math.round(customLayout.logoTop)}</span></div><input type="range" min="0" max="300" value={customLayout.logoTop} onChange={(event) => updateCustomLayout({ logoTop: Number(event.target.value) })} className={sliderClass} /></div>
                        <div><div className="flex justify-between text-xs font-black"><span>Logo Size</span><span>{Math.round(customLayout.logoSize)}</span></div><input type="range" min="12" max="240" value={customLayout.logoSize} onChange={(event) => updateCustomLayout({ logoSize: Number(event.target.value) })} className={sliderClass} /></div>
                      </div>
                    )}
                  </div>

                  <div className="p-3 border-2 border-black rounded-lg bg-[#F8FDFF]">
                    <button
                      type="button"
                      onClick={() => toggleLayoutPanel('title')}
                      aria-expanded={layoutPanels.title}
                      className="w-full flex items-center justify-between gap-2"
                    >
                      <span className="text-[10px] font-black uppercase text-slate-600">Title</span>
                      <span className="text-[10px] font-black uppercase text-slate-700">{layoutPanels.title ? 'Hide' : 'Show'}</span>
                    </button>
                    {layoutPanels.title && (
                      <div className="mt-3 space-y-3">
                        <div><div className="flex justify-between text-xs font-black"><span>Title X</span><span>{Math.round(customLayout.titleLeft)}</span></div><input type="range" min="0" max={String(previewStage.width)} value={customLayout.titleLeft} onChange={(event) => updateCustomLayout({ titleLeft: Number(event.target.value) })} className={sliderClass} /></div>
                        <div><div className="flex justify-between text-xs font-black"><span>Title Y</span><span>{Math.round(customLayout.titleTop)}</span></div><input type="range" min="0" max="300" value={customLayout.titleTop} onChange={(event) => updateCustomLayout({ titleTop: Number(event.target.value) })} className={sliderClass} /></div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          {(['left', 'center', 'right'] as const).map((align) => (
                            <button key={align} type="button" onClick={() => updateCustomLayout({ titleAlign: align })} className={`py-1 border-2 border-black rounded-lg text-[10px] font-black uppercase ${customLayout.titleAlign === align ? 'bg-[#FFD93D]' : 'bg-white hover:bg-slate-100'}`}>{align}</button>
                          ))}
                        </div>
                        <div><div className="flex justify-between text-xs font-black"><span>Title Size</span><span>{Math.round(customLayout.titleFontSize)}</span></div><input type="range" min="10" max="96" value={customLayout.titleFontSize} onChange={(event) => updateCustomLayout({ titleFontSize: Number(event.target.value) })} className={sliderClass} /></div>
                        <div><div className="flex justify-between text-xs font-black"><span>Subtitle Size</span><span>{Math.round(customLayout.subtitleSize)}</span></div><input type="range" min="8" max="72" value={customLayout.subtitleSize} onChange={(event) => updateCustomLayout({ subtitleSize: Number(event.target.value) })} className={sliderClass} /></div>
                        <div><div className="flex justify-between text-xs font-black"><span>Subtitle Gap</span><span>{Math.round(customLayout.subtitleGap)}</span></div><input type="range" min="0" max="24" value={customLayout.subtitleGap} onChange={(event) => updateCustomLayout({ subtitleGap: Number(event.target.value) })} className={sliderClass} /></div>
                      </div>
                    )}
                  </div>

                  <div className="p-3 border-2 border-black rounded-lg bg-[#F8FDFF]">
                    <button
                      type="button"
                      onClick={() => toggleLayoutPanel('timer')}
                      aria-expanded={layoutPanels.timer}
                      className="w-full flex items-center justify-between gap-2"
                    >
                      <span className="text-[10px] font-black uppercase text-slate-600">Timer</span>
                      <span className="text-[10px] font-black uppercase text-slate-700">{layoutPanels.timer ? 'Hide' : 'Show'}</span>
                    </button>
                    {layoutPanels.timer && (
                      <div className="mt-3 space-y-3">
                        <div><div className="flex justify-between text-xs font-black"><span>Timer X</span><span>{Math.round(customLayout.timerLeft)}</span></div><input type="range" min="0" max={String(previewStage.width)} value={customLayout.timerLeft} onChange={(event) => updateCustomLayout({ timerLeft: Number(event.target.value) })} className={sliderClass} /></div>
                        <div><div className="flex justify-between text-xs font-black"><span>Timer Y</span><span>{Math.round(customLayout.timerTop)}</span></div><input type="range" min="0" max="300" value={customLayout.timerTop} onChange={(event) => updateCustomLayout({ timerTop: Number(event.target.value) })} className={sliderClass} /></div>
                        <div><div className="flex justify-between text-xs font-black"><span>Timer Size</span><span>{Math.round(customLayout.timerFontSize)}</span></div><input type="range" min="0" max="96" value={customLayout.timerFontSize} onChange={(event) => updateCustomLayout({ timerFontSize: Number(event.target.value) })} className={sliderClass} /></div>
                        <div><div className="flex justify-between text-xs font-black"><span>Min Width</span><span>{Math.round(customLayout.timerMinWidth)}</span></div><input type="range" min="24" max={String(previewStage.width)} value={customLayout.timerMinWidth} onChange={(event) => updateCustomLayout({ timerMinWidth: Number(event.target.value) })} className={sliderClass} /></div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div><div className="flex justify-between text-[10px] font-black"><span>Pad X</span><span>{Math.round(customLayout.timerPadX)}</span></div><input type="range" min="2" max="40" value={customLayout.timerPadX} onChange={(event) => updateCustomLayout({ timerPadX: Number(event.target.value) })} className={sliderClass} /></div>
                          <div><div className="flex justify-between text-[10px] font-black"><span>Pad Y</span><span>{Math.round(customLayout.timerPadY)}</span></div><input type="range" min="1" max="24" value={customLayout.timerPadY} onChange={(event) => updateCustomLayout({ timerPadY: Number(event.target.value) })} className={sliderClass} /></div>
                          <div><div className="flex justify-between text-[10px] font-black"><span>Dot</span><span>{Math.round(customLayout.timerDotSize)}</span></div><input type="range" min="2" max="40" value={customLayout.timerDotSize} onChange={(event) => updateCustomLayout({ timerDotSize: Number(event.target.value) })} className={sliderClass} /></div>
                          <div><div className="flex justify-between text-[10px] font-black"><span>Gap</span><span>{Math.round(customLayout.timerGap)}</span></div><input type="range" min="2" max="40" value={customLayout.timerGap} onChange={(event) => updateCustomLayout({ timerGap: Number(event.target.value) })} className={sliderClass} /></div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="p-3 border-2 border-black rounded-lg bg-[#F8FDFF]">
                    <button
                      type="button"
                      onClick={() => toggleLayoutPanel('progress')}
                      aria-expanded={layoutPanels.progress}
                      className="w-full flex items-center justify-between gap-2"
                    >
                      <span className="text-[10px] font-black uppercase text-slate-600">Progress</span>
                      <span className="text-[10px] font-black uppercase text-slate-700">{layoutPanels.progress ? 'Hide' : 'Show'}</span>
                    </button>
                    {layoutPanels.progress && (
                      <div className="mt-3 space-y-3">
                        <div><div className="flex justify-between text-xs font-black"><span>Progress X</span><span>{Math.round(customLayout.progressLeft)}</span></div><input type="range" min="0" max={String(previewStage.width)} value={customLayout.progressLeft} onChange={(event) => updateCustomLayout({ progressLeft: Number(event.target.value) })} className={sliderClass} /></div>
                        <div><div className="flex justify-between text-xs font-black"><span>Progress Y</span><span>{Math.round(customLayout.progressTop)}</span></div><input type="range" min="0" max="300" value={customLayout.progressTop} onChange={(event) => updateCustomLayout({ progressTop: Number(event.target.value) })} className={sliderClass} /></div>
                        <div><div className="flex justify-between text-xs font-black"><span>Width</span><span>{Math.round(customLayout.progressWidth)}</span></div><input type="range" min="4" max={String(previewStage.width)} value={customLayout.progressWidth} onChange={(event) => updateCustomLayout({ progressWidth: Number(event.target.value) })} className={sliderClass} /></div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div><div className="flex justify-between text-[10px] font-black"><span>Height</span><span>{Math.round(customLayout.progressHeight)}</span></div><input type="range" min="4" max="120" value={customLayout.progressHeight} onChange={(event) => updateCustomLayout({ progressHeight: Number(event.target.value) })} className={sliderClass} /></div>
                          <div><div className="flex justify-between text-[10px] font-black"><span>Radius</span><span>{Math.round(customLayout.progressRadius)}</span></div><input type="range" min="0" max="220" value={customLayout.progressRadius} onChange={(event) => updateCustomLayout({ progressRadius: Number(event.target.value) })} className={sliderClass} /></div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {(['horizontal', 'vertical'] as const).map((orientation) => (
                            <button key={orientation} type="button" onClick={() => updateCustomLayout({ progressOrientation: orientation })} className={`py-1 border-2 border-black rounded-lg text-[10px] font-black uppercase ${customLayout.progressOrientation === orientation ? 'bg-[#A7F3D0]' : 'bg-white hover:bg-slate-100'}`}>{orientation}</button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );

          const themePanel = activeSetupTab === 'theme' && (
            <div className="space-y-6">
              <div className="space-y-4 border-b border-black/15 pb-4">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={generateWholeVideoStyle}
                    className="rounded-xl border-2 border-black bg-black px-3 py-2 text-[10px] font-black uppercase text-white hover:bg-slate-900"
                  >
                    Generate Style
                  </button>
                  <button
                    type="button"
                    onClick={resetStyleStackToPackage}
                    className="rounded-xl border-2 border-black bg-white px-3 py-2 text-[10px] font-black uppercase hover:bg-slate-100"
                  >
                    Reset
                  </button>
                </div>

              </div>

              <div className="space-y-3 border-b border-black/15 pb-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-600">Style Stack</div>
                  <button
                    type="button"
                    onClick={generateUiStack}
                    className="rounded-full border border-black bg-[#FFF2B3] px-2.5 py-1 text-[9px] font-black uppercase hover:bg-[#FDE68A]"
                  >
                    Generate
                  </button>
                </div>

                <div className="space-y-3">
                  {renderModuleGenerator(
                    'Text Style',
                    settings.textStyle,
                    VIDEO_TEXT_STYLE_OPTIONS,
                    (value) => updateSetting('textStyle', value),
                    () => updateSetting('textStyle', pickGeneratedValue(settings.textStyle, VIDEO_TEXT_STYLE_OPTIONS, 11, ['package']))
                  )}
                  {renderModuleGenerator(
                    'Header Style',
                    settings.headerStyle,
                    VIDEO_HEADER_STYLE_OPTIONS,
                    (value) => updateSetting('headerStyle', value),
                    () => updateSetting('headerStyle', pickGeneratedValue(settings.headerStyle, VIDEO_HEADER_STYLE_OPTIONS, 23, ['package']))
                  )}
                  {renderModuleGenerator(
                    'Timer Style',
                    settings.timerStyle,
                    VIDEO_TIMER_STYLE_OPTIONS,
                    (value) => updateSetting('timerStyle', value),
                    () => updateSetting('timerStyle', pickGeneratedValue(settings.timerStyle, VIDEO_TIMER_STYLE_OPTIONS, 37, ['package']))
                  )}
                  {renderModuleGenerator(
                    'Progress Style',
                    settings.progressStyle,
                    VIDEO_PROGRESS_STYLE_OPTIONS,
                    (value) => updateSetting('progressStyle', value),
                    () => updateSetting('progressStyle', pickGeneratedValue(settings.progressStyle, VIDEO_PROGRESS_STYLE_OPTIONS, 53, ['package']))
                  )}
                </div>
              </div>

              <div className="space-y-6">
                <div className="bg-white border-4 border-black rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] p-4 md:p-5 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Palette size={20} strokeWidth={3} />
                      <h3 className="text-lg font-black uppercase">Backgrounds</h3>
                    </div>
                    <button
                      type="button"
                      onClick={rerollGeneratedBackgroundSeed}
                      className="rounded-xl border-2 border-black bg-[#FFF5CC] px-4 py-2 text-[10px] font-black uppercase hover:bg-[#FDE68A]"
                    >
                      <span className="inline-flex items-center gap-2">
                        <RefreshCcw size={14} />
                        Reroll Mapping
                      </span>
                    </button>
                  </div>

                  <div className="rounded-2xl border-2 border-black bg-[#FFFDF5] p-4">
                    <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="text-[10px] font-black uppercase text-slate-600">Selected Pack</div>
                        <div className="mt-1 break-words text-base font-black uppercase leading-[0.95] text-slate-900 sm:text-lg">
                          {selectedBackgroundPack?.name ?? 'No pack selected'}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => updateSetting('generatedBackgroundsEnabled', !settings.generatedBackgroundsEnabled)}
                        className={`self-start rounded-full border-2 border-black px-3 py-1 text-[10px] font-black uppercase ${
                          settings.generatedBackgroundsEnabled ? 'bg-[#A7F3D0]' : 'bg-white'
                        }`}
                      >
                        {settings.generatedBackgroundsEnabled ? 'Enabled' : 'Disabled'}
                      </button>
                    </div>

                    <div className="mt-4 space-y-4">
                      <div className="mx-auto w-full max-w-[340px] overflow-hidden rounded-2xl border-2 border-black bg-slate-100">
                        {backgroundPackPreview ? (
                          <div className="aspect-video">
                            <GeneratedBackgroundCanvas spec={backgroundPackPreview} className="h-full w-full" animate />
                          </div>
                        ) : (
                          <div className="flex aspect-video items-center justify-center text-[10px] font-black uppercase text-slate-500">
                            Preview disabled
                          </div>
                        )}
                      </div>

                      <div className="grid min-w-0 gap-4">
                        <div className="rounded-2xl border-2 border-black bg-white p-3">
                          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Playback</div>
                          <div className="mt-3 grid min-w-0 gap-3">
                            <label className="min-w-0 space-y-2">
                              <span className="text-[10px] font-black uppercase text-slate-600">Pack</span>
                              <select
                                value={selectedBackgroundPack?.id ?? ''}
                                onChange={(event) => updateSetting('generatedBackgroundPackId', event.target.value)}
                                className={workspaceSelectClass}
                              >
                                {availableBackgroundPacks.map((pack) => (
                                  <option key={pack.id} value={pack.id}>
                                    {pack.name} ({pack.backgrounds.length})
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label className="min-w-0 space-y-2">
                              <span className="text-[10px] font-black uppercase text-slate-600">Shuffle Seed</span>
                              <DeferredNumberInput
                                min={1}
                                max={9999}
                                value={settings.generatedBackgroundShuffleSeed}
                                onValueChange={(value) =>
                                  updateSetting(
                                    'generatedBackgroundShuffleSeed',
                                    Math.max(1, Math.min(9999, Math.floor(value)))
                                  )
                                }
                                className="min-w-0 w-full rounded-xl border-2 border-black bg-white px-3 py-3 text-sm font-semibold text-slate-900"
                              />
                            </label>

                            <label className="min-w-0 space-y-2">
                              <span className="text-[10px] font-black uppercase text-slate-600">Coverage</span>
                              <select
                                value={settings.generatedBackgroundCoverage}
                                onChange={(event) =>
                                  updateSetting(
                                    'generatedBackgroundCoverage',
                                    event.target.value as VideoSettings['generatedBackgroundCoverage']
                                  )
                                }
                                className={workspaceSelectClass}
                              >
                                {GENERATED_BACKGROUND_COVERAGE_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>
                        </div>

                        <div className="rounded-2xl border-2 border-black bg-white p-3">
                          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Pack Builder</div>
                          <div className="mt-3 grid min-w-0 gap-3">
                            <label className="min-w-0 space-y-2">
                              <span className="text-[10px] font-black uppercase text-slate-600">New Pack Name</span>
                              <input
                                type="text"
                                value={packName}
                                onChange={(event) => setPackName(event.target.value)}
                                className="min-w-0 w-full rounded-xl border-2 border-black bg-white px-3 py-3 text-sm font-semibold text-slate-900"
                              />
                            </label>

                            <label className="min-w-0 space-y-2">
                              <span className="text-[10px] font-black uppercase text-slate-600">Aspect Ratio</span>
                              <select
                                value={packAspectRatio}
                                onChange={(event) => setPackAspectRatio(event.target.value as VideoSettings['aspectRatio'])}
                                className={workspaceSelectClass}
                              >
                                {ASPECT_RATIOS.map((ratio) => (
                                  <option key={ratio} value={ratio}>
                                    {ratio}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label className="min-w-0 space-y-2">
                              <span className="text-[10px] font-black uppercase text-slate-600">Motif Blend</span>
                              <select
                                value={motifFocus}
                                onChange={(event) => setMotifFocus(event.target.value as MotifFocus)}
                                className={workspaceSelectClass}
                              >
                                {MOTIF_FOCUS_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label className="min-w-0 space-y-2">
                              <span className="text-[10px] font-black uppercase text-slate-600">Palette Focus</span>
                              <select
                                value={paletteFocus}
                                onChange={(event) => setPaletteFocus(event.target.value as PaletteFocus)}
                                className={workspaceSelectClass}
                              >
                                {PALETTE_FOCUS_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>
                        </div>

                        <div className="grid gap-3">
                          <button
                            type="button"
                            onClick={handleGeneratePack}
                            className="rounded-xl border-2 border-black bg-black px-3 py-3 text-xs font-black uppercase text-white hover:bg-slate-900"
                          >
                            Generate Pack
                          </button>
                          <button
                            type="button"
                            onClick={() => setBackgroundBaseSeed((current) => current + 97)}
                            className="rounded-xl border-2 border-black bg-white px-3 py-3 text-xs font-black uppercase hover:bg-slate-100"
                          >
                            New Seed {backgroundBaseSeed}
                          </button>
                          <button
                            type="button"
                            onClick={handleRenameSelectedPack}
                            disabled={!selectedBackgroundPack}
                            className="rounded-xl border-2 border-black bg-white px-3 py-3 text-xs font-black uppercase hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Rename Pack
                          </button>
                          <button
                            type="button"
                            onClick={handleDeleteSelectedPack}
                            disabled={!selectedBackgroundPack}
                            className="rounded-xl border-2 border-black bg-[#FECACA] px-3 py-3 text-xs font-black uppercase hover:bg-[#FCA5A5] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Delete Selected Pack
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          );

          const textPanel = activeOutputTab === 'text' && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2 border-b border-black/15 pb-4">
                <button
                  type="button"
                  onClick={() =>
                    applyCopyPreset(
                      SCENE_COPY_TEMPLATE_PRESETS[
                        Math.abs(Date.now() + settings.generatedBackgroundShuffleSeed) %
                          SCENE_COPY_TEMPLATE_PRESETS.length
                      ]
                    )
                  }
                  className="rounded-xl border-2 border-black bg-black px-3 py-2 text-[10px] font-black uppercase text-white hover:bg-slate-900"
                >
                  Generate
                </button>
                {SCENE_COPY_TEMPLATE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyCopyPreset(preset)}
                    className="rounded-xl border-2 border-black bg-white px-3 py-2 text-[10px] font-black uppercase hover:bg-[#FFF8D8]"
                  >
                    {preset.name}
                  </button>
                ))}
              </div>

              <div className="space-y-4">
                {TEXT_TEMPLATE_GROUPS.map((group, index) => (
                  <div key={group.title} className="space-y-3 border-b border-black/15 pb-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-600">{group.title}</div>
                      <button
                        type="button"
                        onClick={() => {
                          if (group.title === 'Intro Template') generateVariantPatch(INTRO_TEMPLATE_VARIANTS, index * 17 + 5);
                          if (group.title === 'Play Template') generateVariantPatch(PLAY_TEMPLATE_VARIANTS, index * 17 + 11);
                          if (group.title === 'Transition Template') generateVariantPatch(TRANSITION_TEMPLATE_VARIANTS, index * 17 + 19);
                          if (group.title === 'Outro Template') generateVariantPatch(OUTRO_TEMPLATE_VARIANTS, index * 17 + 29);
                        }}
                        className="rounded-full border border-black bg-[#FFF2B3] px-2.5 py-1 text-[9px] font-black uppercase hover:bg-[#FDE68A]"
                      >
                        {group.actionLabel}
                      </button>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      {(group.title === 'Intro Template'
                        ? INTRO_TEMPLATE_VARIANTS
                        : group.title === 'Play Template'
                        ? PLAY_TEMPLATE_VARIANTS
                        : group.title === 'Transition Template'
                        ? TRANSITION_TEMPLATE_VARIANTS
                        : OUTRO_TEMPLATE_VARIANTS
                      ).map((variant) => (
                        <button
                          key={variant.label}
                          type="button"
                          onClick={() => updateTextTemplates(variant.patch)}
                          className="rounded-xl border-2 border-black bg-white px-3 py-2 text-left text-[10px] font-black uppercase hover:bg-[#E0F2FE]"
                        >
                          {variant.label}
                        </button>
                      ))}
                    </div>

                    <div className="space-y-3">
                      {group.fields.map((field) => renderTextTemplateField(field))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );

          const motionPanel = activeOutputTab === 'motion' && (
            <div className="space-y-6">
              <div className="space-y-6">
                <div className="bg-white border-4 border-black rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] p-4 md:p-5 space-y-4">
                  <div className="flex items-center gap-2">
                    <Clock size={20} strokeWidth={3} />
                    <h3 className="text-lg font-black uppercase">Playback Timing</h3>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <div className="flex justify-between mb-1 text-xs font-black uppercase"><span>Show Puzzle</span><span>{getDeferredSliderValue('showDuration')}s</span></div>
                      <input type="range" min="1" max="90" {...buildDeferredSliderHandlers('showDuration')} className={sliderClass} />
                    </div>
                    <div>
                      <div className="flex justify-between mb-1 text-xs font-black uppercase"><span>Total Reveal</span><span>{getDeferredSliderValue('revealDuration')}s</span></div>
                      <input type="range" min="1" max="60" step="0.5" {...buildDeferredSliderHandlers('revealDuration')} className={sliderClass} />
                    </div>
                    <div>
                      <div className="flex justify-between mb-1 text-xs font-black uppercase"><span>Reveal Step</span><span>{getDeferredSliderValue('sequentialRevealStep')}s</span></div>
                      <input type="range" min="0.5" max="10" step="0.5" {...buildDeferredSliderHandlers('sequentialRevealStep')} className={sliderClass} />
                    </div>
                    <div>
                      <div className="flex justify-between mb-1 text-xs font-black uppercase"><span>Transition</span><span>{getDeferredSliderValue('transitionDuration')}s</span></div>
                      <input type="range" min="0" max="5" step="0.5" {...buildDeferredSliderHandlers('transitionDuration')} className={sliderClass} />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="p-3 border-2 border-black rounded-xl bg-[#F8FDFF] space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-black uppercase">Intro Card</span>
                        <button
                          type="button"
                          onClick={() =>
                            updateSceneSettings({ introEnabled: !settings.sceneSettings.introEnabled })
                          }
                          disabled={introClipActive}
                          className={`px-3 py-1 rounded-lg border-2 border-black text-xs font-black uppercase disabled:opacity-40 disabled:cursor-not-allowed ${
                            introClipActive || settings.sceneSettings.introEnabled
                              ? 'bg-[#A7F3D0]'
                              : 'bg-white hover:bg-slate-100'
                          }`}
                        >
                          {introClipActive ? 'Clip' : settings.sceneSettings.introEnabled ? 'On' : 'Off'}
                        </button>
                      </div>
                      <div>
                        <div className="flex justify-between mb-1 text-xs font-black uppercase">
                          <span>Intro Duration</span>
                          <span>
                            {introClipActive && introClipDuration > 0
                              ? `${introClipDuration.toFixed(2)}s`
                              : `${settings.sceneSettings.introDuration}s`}
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0.5"
                          max="180"
                          step="0.5"
                          value={settings.sceneSettings.introDuration}
                          onChange={(event) => updateSceneSettings({ introDuration: Number(event.target.value) })}
                          disabled={!settings.sceneSettings.introEnabled || (introClipActive && introClipDuration > 0)}
                          className={`${sliderClass} disabled:opacity-40 disabled:cursor-not-allowed`}
                        />
                      </div>
                    </div>

                    <div className="p-3 border-2 border-black rounded-xl bg-[#F8FDFF] space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-black uppercase">Outro Card</span>
                        <button
                          type="button"
                          onClick={() => updateSceneSettings({ outroEnabled: !settings.sceneSettings.outroEnabled })}
                          className={`px-3 py-1 rounded-lg border-2 border-black text-xs font-black uppercase ${
                            settings.sceneSettings.outroEnabled ? 'bg-[#A7F3D0]' : 'bg-white hover:bg-slate-100'
                          }`}
                        >
                          {settings.sceneSettings.outroEnabled ? 'On' : 'Off'}
                        </button>
                      </div>
                      <div>
                        <div className="flex justify-between mb-1 text-xs font-black uppercase">
                          <span>Outro Duration</span>
                          <span>{settings.sceneSettings.outroDuration}s</span>
                        </div>
                        <input
                          type="range"
                          min="0.5"
                          max="180"
                          step="0.5"
                          value={settings.sceneSettings.outroDuration}
                          onChange={(event) => updateSceneSettings({ outroDuration: Number(event.target.value) })}
                          disabled={!settings.sceneSettings.outroEnabled}
                          className={`${sliderClass} disabled:opacity-40 disabled:cursor-not-allowed`}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="p-3 border-2 border-black rounded-xl bg-[#F8FDFF]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-black uppercase">Blink Compare</span>
                        <button
                          type="button"
                          onClick={() => updateSetting('enableBlinking', !settings.enableBlinking)}
                          className={`px-3 py-1 rounded-lg border-2 border-black text-xs font-black uppercase ${
                            settings.enableBlinking ? 'bg-[#A7F3D0]' : 'bg-white hover:bg-slate-100'
                          }`}
                        >
                          {settings.enableBlinking ? 'On' : 'Off'}
                        </button>
                      </div>
                    </div>
                    <div className="p-3 border-2 border-black rounded-xl bg-[#F8FDFF]">
                      <div className="flex justify-between mb-1 text-xs font-black uppercase"><span>Blink Speed</span><span>{settings.enableBlinking ? `${getDeferredSliderValue('blinkSpeed')}s` : 'Off'}</span></div>
                      <input type="range" min="0.2" max="2" step="0.1" {...buildDeferredSliderHandlers('blinkSpeed')} disabled={!settings.enableBlinking} className={`${sliderClass} disabled:opacity-40 disabled:cursor-not-allowed`} />
                    </div>
                  </div>

                  <div className="rounded-2xl border-2 border-black bg-[#F8FDFF] p-4 space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-black uppercase">Scene Cards And Motion</div>
                        <div className="mt-1 text-[10px] font-bold uppercase text-slate-600">
                          Intro, transition, outro, and motion styling now live directly in Video Mode.
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={generateSceneStack}
                        className="rounded-xl border-2 border-black bg-black px-4 py-2 text-[10px] font-black uppercase text-white hover:bg-slate-900"
                      >
                        Generate Scene Stack
                      </button>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      {renderModuleGenerator(
                        'Intro Card',
                        settings.introCardStyle,
                        VIDEO_SCENE_CARD_STYLE_OPTIONS,
                        (value) => updateSetting('introCardStyle', value),
                        () => updateSetting('introCardStyle', pickGeneratedValue(settings.introCardStyle, VIDEO_SCENE_CARD_STYLE_OPTIONS, 71, ['package']))
                      )}
                      {renderModuleGenerator(
                        'Transition Card',
                        settings.transitionCardStyle,
                        VIDEO_SCENE_CARD_STYLE_OPTIONS,
                        (value) => updateSetting('transitionCardStyle', value),
                        () => updateSetting('transitionCardStyle', pickGeneratedValue(settings.transitionCardStyle, VIDEO_SCENE_CARD_STYLE_OPTIONS, 83, ['package']))
                      )}
                      {renderModuleGenerator(
                        'Outro Card',
                        settings.outroCardStyle,
                        VIDEO_SCENE_CARD_STYLE_OPTIONS,
                        (value) => updateSetting('outroCardStyle', value),
                        () => updateSetting('outroCardStyle', pickGeneratedValue(settings.outroCardStyle, VIDEO_SCENE_CARD_STYLE_OPTIONS, 97, ['package']))
                      )}
                      {renderModuleGenerator(
                        'Transition Motion',
                        settings.transitionStyle,
                        VIDEO_TRANSITION_STYLE_OPTIONS,
                        (value) => updateSetting('transitionStyle', value),
                        () => updateSetting('transitionStyle', pickGeneratedValue(settings.transitionStyle, VIDEO_TRANSITION_STYLE_OPTIONS, 109))
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {[
                        `Motion ${selectedTransitionStyleOption.label}`,
                        `Intro ${selectedIntroCardStyleOption.label}`,
                        `Transition ${selectedTransitionCardStyleOption.label}`,
                        `Outro ${selectedOutroCardStyleOption.label}`
                      ].map((label) => (
                        <span
                          key={label}
                          className="rounded-full border-2 border-black bg-white px-3 py-1 text-[10px] font-black uppercase"
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <div className="bg-white border-4 border-black rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] p-4 md:p-5 space-y-4">
                  <div className="flex items-center gap-2">
                    <Eye size={20} strokeWidth={3} />
                    <h3 className="text-lg font-black uppercase">Reveal Marker Style</h3>
                  </div>

                  <div className="p-3 border-2 border-black rounded-xl bg-[#F8FDFF]">
                    <div className="text-[10px] font-black uppercase text-slate-600">Current Reveal Behavior</div>
                    <div className="text-xs font-black uppercase mt-1">{selectedRevealBehaviorOption.label}</div>
                    <div className="text-[10px] font-bold uppercase text-slate-600 mt-1">
                      {selectedRevealBehaviorOption.description}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-black uppercase mb-2">Reveal Behavior</label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {compactRevealBehaviorOptions.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => updateSetting('revealBehavior', option.value)}
                          className={`p-3 border-2 border-black rounded-xl text-left ${
                            settings.revealBehavior === option.value
                              ? 'bg-[#C7D2FE] shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] translate-x-[1px] translate-y-[1px]'
                              : 'bg-white hover:bg-slate-100'
                          }`}
                        >
                          <div className="text-xs font-black uppercase">{option.label}</div>
                          <div className="text-[10px] font-bold uppercase text-slate-600 mt-1">{option.description}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-black uppercase mb-2">Reveal Style</label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {(['box', 'circle', 'highlight'] as const).map((style) => (
                        <button
                          key={style}
                          type="button"
                          onClick={() => updateRevealStyle(style)}
                          className={`py-2 border-2 border-black rounded-lg text-xs font-black uppercase ${
                            settings.revealStyle === style
                              ? 'bg-[#FF6B6B] shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] translate-x-[1px] translate-y-[1px]'
                              : 'bg-white hover:bg-slate-100'
                          }`}
                        >
                          {style}
                        </button>
                      ))}
                    </div>
                  </div>

                  {(['box', 'circle', 'highlight'] as const).includes(settings.revealStyle) && (
                    <div>
                      <label className="block text-xs font-black uppercase mb-2">
                        {settings.revealStyle === 'box'
                          ? 'Box Variant'
                          : settings.revealStyle === 'circle'
                          ? 'Circle Variant'
                          : 'Highlight Variant'}
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {(
                          settings.revealStyle === 'box'
                            ? compactBoxVariants
                            : settings.revealStyle === 'circle'
                            ? compactCircleVariants
                            : compactHighlightVariants
                        ).map((variant) => (
                          <button
                            key={variant.value}
                            type="button"
                            onClick={() => updateSetting('revealVariant', variant.value)}
                            className={`p-2 border-2 border-black rounded-lg text-left ${
                              settings.revealVariant === variant.value
                                ? 'bg-[#FFD93D] shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] translate-x-[1px] translate-y-[1px]'
                                : 'bg-white hover:bg-slate-100'
                            }`}
                          >
                            <div className="text-xs font-black uppercase">{variant.label}</div>
                            <div className="text-[10px] font-bold uppercase text-slate-600 mt-1">{variant.hint}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {settings.revealStyle === 'circle' && (
                    <div>
                      <div className="flex justify-between mb-1 text-xs font-black uppercase"><span>Circle Thickness</span><span>{getDeferredSliderValue('circleThickness')}px</span></div>
                      <input type="range" min="2" max="14" step="1" {...buildDeferredSliderHandlers('circleThickness')} className={sliderClass} />
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-black uppercase mb-2">Reveal Color</label>
                      <div className="flex flex-wrap gap-2">
                        {REVEAL_COLORS.map((color) => (
                          <button key={color} type="button" onClick={() => updateSetting('revealColor', color)} className={`w-9 h-9 rounded-full border-2 border-black ${settings.revealColor === color ? 'ring-2 ring-slate-500 ring-offset-2' : ''}`} style={{ backgroundColor: color }} />
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-black uppercase mb-2">Outline Color</label>
                      <div className="flex flex-wrap gap-2">
                        {OUTLINE_COLORS.map((color) => (
                          <button key={color} type="button" onClick={() => updateSetting('outlineColor', color)} className={`w-9 h-9 rounded-full border-2 border-black ${settings.outlineColor === color ? 'ring-2 ring-slate-500 ring-offset-2' : ''}`} style={{ backgroundColor: color }} />
                        ))}
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between mb-1 text-xs font-black uppercase"><span>Outline Thickness</span><span>{getDeferredSliderValue('outlineThickness')}px</span></div>
                    <input type="range" min="0" max="8" step="1" {...buildDeferredSliderHandlers('outlineThickness')} className={sliderClass} />
                  </div>
                </div>
              </div>
            </div>
          );

          const audioPanel = activeSetupTab === 'audio' && (
            <div className="space-y-6">
              <div className="space-y-4 border-b border-black/15 pb-5">
                  <div className="flex items-center gap-2">
                    <Volume2 size={18} strokeWidth={3} />
                    <div className="text-xs font-black uppercase">Audio Cues</div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { value: true, label: 'Audio On' },
                      { value: false, label: 'Audio Off' }
                    ].map((option) => (
                      <button
                        key={option.label}
                        type="button"
                        onClick={() => updateSetting('soundEffectsEnabled', option.value)}
                        className={`rounded-xl border-2 border-black px-3 py-2 text-xs font-black uppercase ${
                          settings.soundEffectsEnabled === option.value
                            ? 'bg-[#A7F3D0] shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] translate-x-[1px] translate-y-[1px]'
                            : 'bg-white hover:bg-slate-100'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>

                  <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                    <button
                      type="button"
                      onClick={() => updateSetting('previewSoundEnabled', !settings.previewSoundEnabled)}
                      disabled={!previewAudioAvailable}
                      className={`rounded-xl border-2 border-black px-3 py-3 text-left ${
                        previewAudioAvailable
                          ? settings.previewSoundEnabled
                            ? 'bg-[#C7D2FE] shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
                            : 'bg-white hover:bg-slate-100'
                          : 'bg-slate-200 text-slate-500'
                      }`}
                    >
                      <div className="text-xs font-black uppercase">Preview Audio</div>
                      <div className="mt-1 text-[10px] font-bold uppercase text-slate-600">
                        Uses the same pool logic as export.
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => updateSetting('audioLimiterEnabled', !settings.audioLimiterEnabled)}
                      className={`rounded-xl border-2 border-black px-3 py-3 text-xs font-black uppercase ${
                        settings.audioLimiterEnabled ? 'bg-[#A7F3D0]' : 'bg-white hover:bg-slate-100'
                      }`}
                    >
                      Limiter {settings.audioLimiterEnabled ? 'On' : 'Off'}
                    </button>
                  </div>

                  <div>
                    <div className="flex justify-between mb-1 text-xs font-black uppercase">
                      <span>Master SFX Volume</span>
                      <span>{Math.round(settings.soundEffectsVolume * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={settings.soundEffectsVolume}
                      onChange={(event) => updateSetting('soundEffectsVolume', Number(event.target.value))}
                      disabled={!settings.soundEffectsEnabled}
                      className={`${sliderClass} disabled:opacity-40 disabled:cursor-not-allowed`}
                    />
                  </div>
              </div>

              <div className="space-y-5">
                <div className="flex items-center gap-2">
                  <Music size={20} strokeWidth={3} />
                  <h3 className="text-lg font-black uppercase">Audio Mix</h3>
                </div>

                <div className="space-y-4 border-b border-black/15 pb-5">
                  <div className="flex flex-col gap-2">
                    <div className="text-xs font-black uppercase">Gameplay Cue Pools</div>
                    <div className="text-[11px] font-bold text-slate-600">
                      Every gameplay cue pulls from its own random pool. Puzzle play assigns one track per puzzle and reshuffles when the pool runs short.
                    </div>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-2">
                    {VIDEO_AUDIO_POOL_DEFINITIONS.map((definition) => {
                      const pool = settings.audioCuePools[definition.key];
                      const isPoolInteractive = settings.soundEffectsEnabled;
                      const badgeClass = AUDIO_POOL_BADGE_CLASSES[definition.key];
                      const selectionLabel = AUDIO_POOL_SELECTION_LABELS[definition.key];
                      const triggerNote =
                        definition.key === 'progress_fill_intro'
                          ? 'Only fires when Progress Motion is set to Intro Fill and is capped to the first 4 seconds.'
                          : definition.key === 'low_time_warning'
                          ? 'Starts 5 seconds before timeout and only plays inside the showing phase.'
                          : null;

                      return (
                        <div
                          key={definition.key}
                          className={`rounded-2xl border-2 border-black p-4 space-y-4 ${
                            isPoolInteractive ? 'bg-white' : 'bg-slate-200 text-slate-500'
                          }`}
                        >
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0 space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="text-sm font-black uppercase leading-tight">{definition.label}</div>
                                <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${badgeClass}`}>
                                  {selectionLabel}
                                </span>
                              </div>
                              <div className="text-[11px] font-bold text-slate-600">{definition.description}</div>
                              {triggerNote ? (
                                <div className="text-[10px] font-bold uppercase text-slate-500">{triggerNote}</div>
                              ) : null}
                            </div>
                            <button
                              type="button"
                              onClick={() => updateAudioCuePool(definition.key, { enabled: !pool.enabled })}
                              disabled={!isPoolInteractive}
                              className={`rounded-xl border-2 border-black px-3 py-2 text-[10px] font-black uppercase ${
                                !isPoolInteractive
                                  ? 'bg-slate-200 text-slate-500'
                                  : pool.enabled
                                  ? 'bg-[#A7F3D0]'
                                  : 'bg-white hover:bg-slate-100'
                              }`}
                            >
                              {pool.enabled ? 'Enabled' : 'Disabled'}
                            </button>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <span className="rounded-full border-2 border-black bg-white px-2 py-1 text-[10px] font-black uppercase text-slate-700">
                              {pool.sources.length} Track{pool.sources.length === 1 ? '' : 's'}
                            </span>
                            <span className="rounded-full border-2 border-black bg-white px-2 py-1 text-[10px] font-black uppercase text-slate-700">
                              {pool.enabled ? 'Live In Mix' : 'Muted'}
                            </span>
                          </div>

                          <div>
                            <div className="mb-1 flex justify-between text-[10px] font-black uppercase">
                              <span>Cue Volume</span>
                              <span>{Math.round(pool.volume * 100)}%</span>
                            </div>
                            <input
                              type="range"
                              min="0"
                              max={VIDEO_AUDIO_CUE_POOL_MAX_VOLUME}
                              step="0.01"
                              value={pool.volume}
                              onChange={(event) =>
                                updateAudioCuePool(definition.key, {
                                  volume: Number(event.target.value)
                                })
                              }
                              disabled={!isPoolInteractive}
                              className={`${sliderClass} disabled:cursor-not-allowed disabled:opacity-40`}
                            />
                          </div>

                          {definition.key === 'puzzle_play' ? (
                            <button
                              type="button"
                              onClick={() =>
                                updateSetting(
                                  'puzzlePlayUrgencyRampEnabled',
                                  !settings.puzzlePlayUrgencyRampEnabled
                                )
                              }
                              disabled={!isPoolInteractive}
                              className={`w-full rounded-xl border-2 border-black px-3 py-3 text-left ${
                                !isPoolInteractive
                                  ? 'bg-slate-200 text-slate-500'
                                  : settings.puzzlePlayUrgencyRampEnabled
                                  ? 'bg-[#C7D2FE] shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
                                  : 'bg-white hover:bg-slate-100'
                              }`}
                            >
                              <div className="text-xs font-black uppercase">Urgency Ramp</div>
                              <div className="mt-1 text-[10px] font-bold uppercase text-slate-600">
                                Gradually raises puzzle play speed and volume until the final 1 second fade.
                              </div>
                            </button>
                          ) : null}

                          <div className="flex flex-wrap gap-2">
                            <label
                              className={`inline-flex items-center gap-2 rounded-lg border-2 border-black px-3 py-2 text-[10px] font-black uppercase ${
                                isPoolInteractive
                                  ? 'bg-white hover:bg-slate-100'
                                  : 'bg-slate-200 text-slate-500 cursor-not-allowed'
                              }`}
                            >
                              <Upload size={12} />
                              Add To Pool
                              <input
                                type="file"
                                accept="audio/*"
                                multiple
                                onChange={handleAudioPoolUpload(definition.key)}
                                className="hidden"
                                disabled={!isPoolInteractive}
                              />
                            </label>
                            <button
                              type="button"
                              onClick={() => void clearAudioPoolSources(definition.key)}
                              className="rounded-lg border-2 border-black px-3 py-2 text-[10px] font-black uppercase bg-white hover:bg-red-50 disabled:bg-slate-200 disabled:text-slate-500"
                              disabled={!isPoolInteractive || pool.sources.length === 0}
                            >
                              Clear Pool
                            </button>
                          </div>

                          <div className="space-y-2">
                            {pool.sources.length > 0 ? (
                              pool.sources.map((source, sourceIndex) => (
                                <div
                                  key={`${definition.key}-${sourceIndex}-${source}`}
                                  className="flex items-center justify-between gap-3 rounded-xl border-2 border-black bg-[#F8F5EC] px-3 py-2"
                                >
                                  <div className="min-w-0">
                                    <div className="text-[11px] font-black uppercase">Track {sourceIndex + 1}</div>
                                    <div className="truncate text-[10px] font-bold text-slate-500">{source}</div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => void removeAudioPoolSource(definition.key, sourceIndex)}
                                    className="rounded-lg border-2 border-black bg-white px-2 py-1 text-[10px] font-black uppercase hover:bg-red-50 disabled:bg-slate-200 disabled:text-slate-500"
                                    disabled={!isPoolInteractive}
                                  >
                                    Remove
                                  </button>
                                </div>
                              ))
                            ) : (
                              <div className="rounded-xl border-2 border-dashed border-black/30 bg-white/60 px-3 py-4 text-[10px] font-bold uppercase text-slate-500">
                                No tracks loaded for this cue.
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-black uppercase">Background Music</div>
                    <button
                      type="button"
                      onClick={() => updateSetting('backgroundMusicEnabled', !settings.backgroundMusicEnabled)}
                      className={`rounded-xl border-2 border-black px-3 py-2 text-xs font-black uppercase ${
                        settings.backgroundMusicEnabled ? 'bg-[#A7F3D0]' : 'bg-white hover:bg-slate-100'
                      }`}
                    >
                      {settings.backgroundMusicEnabled ? 'Music On' : 'Music Off'}
                    </button>
                  </div>

                  <div className={`rounded-xl border-2 border-black p-3 ${musicControlsDisabled ? 'bg-slate-200 text-slate-500' : 'bg-white'}`}>
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-black uppercase">Audio File</div>
                      <span className="text-[10px] font-bold uppercase text-slate-600">
                        {settings.backgroundMusicSrc ? 'Loaded' : 'None'}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <label className={`inline-flex items-center gap-2 rounded-lg border-2 border-black px-3 py-2 text-[10px] font-black uppercase ${musicControlsDisabled ? 'bg-slate-200 text-slate-500 cursor-not-allowed' : 'bg-white hover:bg-slate-100'}`}>
                        <Upload size={12} />
                        Upload Music
                        <input type="file" accept="audio/*" onChange={handleAudioUpload('backgroundMusicSrc')} className="hidden" disabled={musicControlsDisabled} />
                      </label>
                      {settings.backgroundMusicSrc && (
                        <button
                          type="button"
                          onClick={() => clearAudioSource('backgroundMusicSrc')}
                          className="rounded-lg border-2 border-black px-3 py-2 text-[10px] font-black uppercase bg-white hover:bg-red-50"
                          disabled={musicControlsDisabled}
                        >
                          Clear
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => updateSetting('backgroundMusicLoop', !settings.backgroundMusicLoop)}
                        className={`rounded-lg border-2 border-black px-3 py-2 text-[10px] font-black uppercase ${
                          settings.backgroundMusicLoop ? 'bg-[#DBEAFE]' : 'bg-white hover:bg-slate-100'
                        }`}
                        disabled={musicControlsDisabled}
                      >
                        Loop {settings.backgroundMusicLoop ? 'On' : 'Off'}
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <div className="flex justify-between mb-1 text-[10px] font-black uppercase">
                        <span>Music Volume</span>
                        <span>{Math.round(settings.backgroundMusicVolume * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={settings.backgroundMusicVolume}
                        onChange={(event) => updateSetting('backgroundMusicVolume', Number(event.target.value))}
                        disabled={musicControlsDisabled}
                        className={`${sliderClass} disabled:opacity-40 disabled:cursor-not-allowed`}
                      />
                    </div>
                    <div>
                      <div className="flex justify-between mb-1 text-[10px] font-black uppercase">
                        <span>Ducking</span>
                        <span>{Math.round(settings.backgroundMusicDuckingAmount * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={settings.backgroundMusicDuckingAmount}
                        onChange={(event) => updateSetting('backgroundMusicDuckingAmount', Number(event.target.value))}
                        disabled={musicControlsDisabled}
                        className={`${sliderClass} disabled:opacity-40 disabled:cursor-not-allowed`}
                      />
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <div className="flex justify-between mb-1 text-[10px] font-black uppercase">
                        <span>Fade In</span>
                        <span>{settings.backgroundMusicFadeIn.toFixed(1)}s</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="10"
                        step="0.1"
                        value={settings.backgroundMusicFadeIn}
                        onChange={(event) => updateSetting('backgroundMusicFadeIn', Number(event.target.value))}
                        disabled={musicControlsDisabled}
                        className={`${sliderClass} disabled:opacity-40 disabled:cursor-not-allowed`}
                      />
                    </div>
                    <div>
                      <div className="flex justify-between mb-1 text-[10px] font-black uppercase">
                        <span>Fade Out</span>
                        <span>{settings.backgroundMusicFadeOut.toFixed(1)}s</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="10"
                        step="0.1"
                        value={settings.backgroundMusicFadeOut}
                        onChange={(event) => updateSetting('backgroundMusicFadeOut', Number(event.target.value))}
                        disabled={musicControlsDisabled}
                        className={`${sliderClass} disabled:opacity-40 disabled:cursor-not-allowed`}
                      />
                    </div>
                    <div>
                      <div className="flex justify-between mb-1 text-[10px] font-black uppercase">
                        <span>Music Offset</span>
                        <span>{settings.backgroundMusicOffsetSec.toFixed(1)}s</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="60"
                        step="0.1"
                        value={settings.backgroundMusicOffsetSec}
                        onChange={(event) => updateSetting('backgroundMusicOffsetSec', Number(event.target.value))}
                        disabled={musicControlsDisabled}
                        className={`${sliderClass} disabled:opacity-40 disabled:cursor-not-allowed`}
                      />
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border-2 border-black bg-white p-4 space-y-4">
                  <div className="text-xs font-black uppercase">Phase Mix Levels</div>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="space-y-3">
                      <div className="text-[10px] font-black uppercase text-slate-600">Music by Phase</div>
                      {([
                        { key: 'intro', label: 'Intro' },
                        { key: 'showing', label: 'Showing' },
                        { key: 'revealing', label: 'Revealing' },
                        { key: 'transitioning', label: 'Transition' },
                        { key: 'outro', label: 'Outro' }
                      ] as const).map((item) => (
                        <div key={`music-${item.key}`}>
                          <div className="flex justify-between mb-1 text-[10px] font-black uppercase">
                            <span>{item.label}</span>
                            <span>{Math.round(settings.musicPhaseLevels[item.key] * 100)}%</span>
                          </div>
                          <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.01"
                            value={settings.musicPhaseLevels[item.key]}
                            onChange={(event) =>
                              updateSetting('musicPhaseLevels', {
                                ...settings.musicPhaseLevels,
                                [item.key]: Number(event.target.value)
                              })
                            }
                            disabled={musicControlsDisabled}
                            className={`${sliderClass} disabled:opacity-40 disabled:cursor-not-allowed`}
                          />
                        </div>
                      ))}
                    </div>

                    <div className="space-y-3">
                      <div className="text-[10px] font-black uppercase text-slate-600">SFX by Phase</div>
                      {([
                        { key: 'intro', label: 'Intro' },
                        { key: 'showing', label: 'Showing' },
                        { key: 'revealing', label: 'Revealing' },
                        { key: 'transitioning', label: 'Transition' },
                        { key: 'outro', label: 'Outro' }
                      ] as const).map((item) => (
                        <div key={`sfx-${item.key}`}>
                          <div className="flex justify-between mb-1 text-[10px] font-black uppercase">
                            <span>{item.label}</span>
                            <span>{Math.round(settings.sfxPhaseLevels[item.key] * 100)}%</span>
                          </div>
                          <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.01"
                            value={settings.sfxPhaseLevels[item.key]}
                            onChange={(event) =>
                              updateSetting('sfxPhaseLevels', {
                                ...settings.sfxPhaseLevels,
                                [item.key]: Number(event.target.value)
                              })
                            }
                            disabled={sfxControlsDisabled}
                            className={`${sliderClass} disabled:opacity-40 disabled:cursor-not-allowed`}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );

          const exportPanel = activeOutputTab === 'export' && (
            <div className="space-y-6">
              <div className="bg-white border-4 border-black rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] p-4 md:p-5 space-y-5">
                <div className="flex items-center gap-2">
                  <Film size={20} strokeWidth={3} />
                  <h3 className="text-lg font-black uppercase">Export</h3>
                </div>

                <div>
                  <label className="block text-xs font-black uppercase mb-2">Resolution</label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                    {EXPORT_RESOLUTION_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => updateSetting('exportResolution', option.value)}
                        className={`py-2 border-2 border-black rounded-lg ${
                          settings.exportResolution === option.value
                            ? 'bg-[#4ECDC4] shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] translate-x-[1px] translate-y-[1px]'
                            : 'bg-white hover:bg-slate-100'
                        }`}
                      >
                        <div className="text-xs font-black uppercase">{option.label}</div>
                        <div className="text-[9px] font-bold uppercase text-slate-600">{option.subLabel}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-black uppercase mb-2">Codec</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {[
                      { value: 'h264', label: 'H.264 (MP4)', hint: 'Best compatibility' },
                      { value: 'av1', label: 'AV1 (WebM)', hint: 'Smaller output' }
                    ].map((codec) => (
                      <button
                        key={codec.value}
                        type="button"
                        onClick={() => updateSetting('exportCodec', codec.value as VideoSettings['exportCodec'])}
                        className={`p-2 border-2 border-black rounded-lg text-left ${
                          settings.exportCodec === codec.value
                            ? 'bg-[#FFD93D] shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] translate-x-[1px] translate-y-[1px]'
                            : 'bg-white hover:bg-slate-100'
                        }`}
                      >
                        <div className="text-xs font-black uppercase">{codec.label}</div>
                        <div className="text-[10px] font-bold uppercase text-slate-600 mt-1">{codec.hint}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex justify-between mb-1 text-xs font-black uppercase"><span>Bitrate</span><span>{settings.exportBitrateMbps.toFixed(1)} Mbps</span></div>
                  <input type="range" min="1" max="80" step="0.5" value={settings.exportBitrateMbps} onChange={(event) => updateSetting('exportBitrateMbps', Number(event.target.value))} className={sliderClass} />
                </div>

                <div className="rounded-xl border-2 border-black bg-[#FFF7D6] p-4 space-y-4">
                  <div>
                    <div className="text-xs font-black uppercase">Output Mode</div>
                    <div className="mt-1 text-[11px] font-bold uppercase text-slate-600">
                      Export one full batch video or split the selected puzzles into multiple videos.
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => updateSetting('exportPuzzlesPerVideo', 0)}
                      className={`rounded-lg border-2 border-black p-3 text-left ${
                        !splitVideoExportRequested
                          ? 'bg-[#A7F3D0] shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] translate-x-[1px] translate-y-[1px]'
                          : 'bg-white hover:bg-slate-100'
                      }`}
                    >
                      <div className="text-xs font-black uppercase">One Video</div>
                      <div className="mt-1 text-[10px] font-bold uppercase text-slate-600">
                        Use all selected puzzles in a single export.
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        updateSetting(
                          'exportPuzzlesPerVideo',
                          Math.min(Math.max(1, puzzles.length || 1), Math.max(1, exportPuzzlesPerVideoInput || 5))
                        )
                      }
                      className={`rounded-lg border-2 border-black p-3 text-left ${
                        splitVideoExportRequested
                          ? 'bg-[#FFD93D] shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] translate-x-[1px] translate-y-[1px]'
                          : 'bg-white hover:bg-slate-100'
                      }`}
                    >
                      <div className="text-xs font-black uppercase">Split Batch</div>
                      <div className="mt-1 text-[10px] font-bold uppercase text-slate-600">
                        Create several videos with a fixed puzzle count in each one.
                      </div>
                    </button>
                  </div>

                  {splitVideoExportRequested && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-[160px_minmax(0,1fr)] gap-3 items-start">
                        <label className="text-xs font-black uppercase">
                          Puzzles Per Video
                          <DeferredNumberInput
                            min={1}
                            max={Math.max(1, puzzles.length || 1)}
                            value={exportPuzzlesPerVideoInput}
                            onValueChange={(value) =>
                              updateSetting(
                                'exportPuzzlesPerVideo',
                                Math.min(
                                  Math.max(1, puzzles.length || 1),
                                  Math.max(1, Math.floor(value))
                                )
                              )
                            }
                            className="mt-1 w-full rounded-lg border-2 border-black bg-white p-2 font-black"
                          />
                        </label>

                        <div className="rounded-lg border-2 border-black bg-white p-3">
                          <div className="text-[11px] font-black uppercase text-slate-900">
                            {exportPlan.totalPuzzles > 0
                              ? exportPlan.outputCount > 1
                                ? `${exportPlan.totalPuzzles} puzzles will export as ${exportPlan.outputCount} videos`
                                : `${exportPlan.totalPuzzles} puzzles currently fit in one video`
                              : 'Add puzzles to preview the export split'}
                          </div>
                          <div className="mt-1 text-[10px] font-bold uppercase text-slate-600">
                            {exportPlan.totalPuzzles > 0
                              ? `Each video will hold up to ${exportPlan.puzzlesPerVideo} puzzle${
                                  exportPlan.puzzlesPerVideo === 1 ? '' : 's'
                                }.`
                              : 'The export button will activate after puzzles are loaded.'}
                          </div>
                          {exportPlan.totalPuzzles > 0 && (
                            <div className="mt-2 text-[10px] font-bold uppercase text-slate-500">
                              Folder save is used when the browser supports it. Otherwise downloads will start one by one.
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="rounded-lg border-2 border-black bg-[#F8FDFF] p-3">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <div className="text-[11px] font-black uppercase text-slate-900">
                              Parallel Export Workers
                            </div>
                            <div className="mt-1 text-[10px] font-bold uppercase text-slate-600">
                              Render multiple split videos at the same time. Use more workers for faster batches.
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {Array.from({ length: exportParallelWorkerLimit }, (_, index) => index + 1).map((count) => (
                              <button
                                key={count}
                                type="button"
                                onClick={() => updateSetting('exportParallelWorkers', count)}
                                className={`min-w-[48px] rounded-lg border-2 border-black px-3 py-2 text-xs font-black uppercase ${
                                  exportParallelWorkersInput === count
                                    ? 'bg-[#A7F3D0] shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] translate-x-[1px] translate-y-[1px]'
                                    : 'bg-white hover:bg-slate-100'
                                }`}
                              >
                                {count}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="mt-2 text-[10px] font-bold uppercase text-slate-500">
                          {exportPlan.outputCount > 1
                            ? `This split can use up to ${exportParallelWorkerLimit} worker${
                                exportParallelWorkerLimit === 1 ? '' : 's'
                              } right now.`
                            : 'Parallel export becomes available when the batch splits into more than one video.'}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="rounded-xl border-2 border-black bg-[#F8FDFF] p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-black uppercase">Skip Final Reveal</div>
                      <div className="mt-1 text-[11px] font-bold uppercase text-slate-600">
                        End the last puzzle without showing the answer so viewers can comment it themselves.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => updateSetting('skipLastPuzzleReveal', !settings.skipLastPuzzleReveal)}
                      className={`px-3 py-2 rounded-lg border-2 border-black text-xs font-black uppercase ${
                        settings.skipLastPuzzleReveal ? 'bg-[#FFD93D]' : 'bg-white hover:bg-slate-100'
                      }`}
                    >
                      {settings.skipLastPuzzleReveal ? 'On' : 'Off'}
                    </button>
                  </div>

                  <div className="text-[10px] font-bold uppercase text-slate-500">
                    {splitVideoExportRequested
                      ? 'In split-batch mode, the last puzzle of each exported video stays unrevealed.'
                      : 'In single-video mode, only the last puzzle in the export stays unrevealed.'}
                  </div>

                  {settings.skipLastPuzzleReveal && (
                    <div className="grid gap-3 rounded-lg border-2 border-black bg-white p-3">
                      <label className="block text-[11px] font-black uppercase text-slate-700">
                        Final 5s Comment Prompt
                        <textarea
                          rows={3}
                          value={settings.finalCommentPromptText}
                          onChange={(event) => updateSetting('finalCommentPromptText', event.target.value)}
                          placeholder="Comment your answers below before the video ends"
                          className="mt-2 w-full rounded-lg border-2 border-black bg-white p-3 text-sm font-bold normal-case"
                        />
                      </label>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block text-[11px] font-black uppercase text-slate-700">
                          Prompt X
                          <div className="mt-1 flex items-center justify-between text-[10px] font-bold uppercase text-slate-500">
                            <span>Left</span>
                            <span>{Math.round(settings.finalCommentPromptX)}%</span>
                            <span>Right</span>
                          </div>
                          <input
                            type="range"
                            min="0"
                            max="100"
                            step="1"
                            value={settings.finalCommentPromptX}
                            onChange={(event) => updateSetting('finalCommentPromptX', Number(event.target.value))}
                            className={sliderClass}
                          />
                        </label>

                        <label className="block text-[11px] font-black uppercase text-slate-700">
                          Prompt Y
                          <div className="mt-1 flex items-center justify-between text-[10px] font-bold uppercase text-slate-500">
                            <span>Top</span>
                            <span>{Math.round(settings.finalCommentPromptY)}%</span>
                            <span>Bottom</span>
                          </div>
                          <input
                            type="range"
                            min="0"
                            max="100"
                            step="1"
                            value={settings.finalCommentPromptY}
                            onChange={(event) => updateSetting('finalCommentPromptY', Number(event.target.value))}
                            className={sliderClass}
                          />
                        </label>
                      </div>

                      <div className="text-[10px] font-bold uppercase text-slate-500">
                        Long text is automatically broken into subtitle-style lines with about 4 to 5 words each and rendered above every other layer.
                      </div>
                    </div>
                  )}
                </div>

                {exportRecovery && !isExporting && (
                  <div className="rounded-xl border-2 border-black bg-[#FFF7D6] p-4 space-y-3">
                    <div>
                      <div className="text-xs font-black uppercase text-slate-900">{exportRecovery.title}</div>
                      <div className="mt-1 text-[11px] font-bold uppercase text-slate-600">
                        {exportRecovery.detail}
                      </div>
                    </div>
                    {exportRecovery.lastError && (
                      <div className="rounded-lg border border-black bg-white px-3 py-2 text-[10px] font-bold uppercase text-slate-600">
                        Last issue: {exportRecovery.lastError}
                      </div>
                    )}
                  </div>
                )}

                <button
                  type="button"
                  onClick={onExport}
                  disabled={isExporting || puzzles.length === 0}
                  className={`w-full py-3 px-4 rounded-xl border-4 border-black text-sm font-black uppercase inline-flex items-center justify-center gap-2 ${
                    isExporting || puzzles.length === 0
                      ? 'bg-slate-300 text-slate-700 cursor-not-allowed'
                      : 'bg-white hover:bg-[#A7F3D0] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]'
                  }`}
                >
                  <Download size={18} strokeWidth={3} />
                  {isExporting
                    ? 'Exporting...'
                    : exportRecovery
                      ? `Resume ${exportRecovery.remainingOutputs} Video${
                          exportRecovery.remainingOutputs === 1 ? '' : 's'
                        }`
                    : exportPlan.outputCount > 1
                      ? `Export ${exportPlan.outputCount} Videos`
                      : 'Export Video'}
                </button>

                {exportRecovery && !isExporting && onRestartExport && (
                  <button
                    type="button"
                    onClick={() => {
                      void onRestartExport();
                    }}
                    className="w-full py-2.5 px-4 rounded-xl border-2 border-black text-xs font-black uppercase inline-flex items-center justify-center gap-2 bg-white hover:bg-slate-100"
                  >
                    Restart All Videos
                  </button>
                )}

                {isExporting && (
                  <button
                    type="button"
                    onClick={onCancelExport}
                    className="w-full py-2.5 px-4 rounded-xl border-2 border-black text-xs font-black uppercase inline-flex items-center justify-center gap-2 bg-white hover:bg-red-50"
                  >
                    Cancel Export
                  </button>
                )}

                {(isExporting || exportStatus) && (
                  <div className="space-y-2">
                    <div className="text-xs font-black uppercase text-slate-700">{exportStatus || 'Working...'}</div>
                    <div className="w-full h-3 rounded-full border-2 border-black overflow-hidden bg-white">
                      <div className="h-full bg-black transition-all" style={{ width: `${Math.max(0, Math.min(100, exportProgress * 100))}%` }} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          );

          return (
            <VideoPreviewCompare
              puzzles={puzzles}
              settings={settings}
              heightStyle={livePreviewHeightStyle}
              activeSetupTab={activeSetupTab}
              onSelectSetupTab={setActiveSetupTab}
              activeOutputTab={activeOutputTab}
              onSelectOutputTab={setActiveOutputTab}
              activeVideoPackageId={activeVideoPackageId}
              packageOptions={previewPackageOptions}
              onSelectVideoPackage={onSelectVideoPackage}
              themeOptions={previewThemeOptions}
              onVisualStyleChange={(style) => updateSetting('visualStyle', style)}
              onShowProgressChange={(show) => updateSetting('showProgress', show)}
              onGeneratedProgressEnabledChange={(enabled) => updateSetting('generatedProgressEnabled', enabled)}
              selectedStyleLabel={selectedStyleOption.label}
              selectedProgressStyleLabel={selectedProgressStyleOption.label}
              selectedProgressMotionLabel={selectedProgressMotionOption.label}
              setupPanelChildren={
                <>
                  {packagePanel}
                  {themePanel}
                  {audioPanel}
                </>
              }
              outputPanelChildren={
                <>
                  {textPanel}
                  {layoutPanel}
                  {motionPanel}
                  {exportPanel}
                </>
              }
            />
          );
        })()}
      </div>

      <TextPromptDialog
        open={isRenamePackDialogOpen}
        title="Rename Background Pack"
        description="Update the generated background pack name without changing the artwork inside it."
        label="Pack name"
        placeholder="Background pack"
        initialValue={selectedBackgroundPack?.name ?? ''}
        confirmLabel="Rename"
        onOpenChange={setIsRenamePackDialogOpen}
        onConfirm={confirmRenameSelectedPack}
      />

      <ConfirmDialog
        open={isDeletePackDialogOpen}
        title="Delete Background Pack?"
        description={selectedBackgroundPack ? `Delete "${selectedBackgroundPack.name}" from saved generated backgrounds?` : ''}
        confirmLabel="Delete"
        tone="danger"
        onOpenChange={setIsDeletePackDialogOpen}
        onConfirm={confirmDeleteSelectedPack}
      />
    </div>
  );
};
