import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Clock,
  Download,
  Eye,
  Film,
  Image as ImageIcon,
  Layout,
  Monitor,
  Play,
  Save,
  Smartphone,
  Square,
  Trash2,
  Upload
} from 'lucide-react';
import { CustomVideoLayout, Puzzle, VideoSettings } from '../types';
import { BASE_STAGE_SIZE } from '../constants/videoLayoutSpec';
import { buildDefaultCustomVideoLayout } from '../constants/videoLayoutCustom';
import { VIDEO_PACKAGE_PRESETS, VIDEO_REVEAL_BEHAVIOR_OPTIONS } from '../constants/videoPackages';
import { VideoPreviewCompare } from './VideoPreviewCompare';
import { useProcessedLogoSrc } from '../hooks/useProcessedLogoSrc';
import { clampLogoZoom } from '../utils/logoProcessing';
import {
  applyVideoSceneCopyPresetToSettings,
  deleteVideoSceneCopyPreset,
  loadVideoSceneCopyPresets,
  saveVideoSceneCopyPreset,
  type VideoSceneCopyPreset
} from '../services/videoSceneCopyPresets';
import { loadSavedVideoCustomLayout, saveVideoCustomLayout } from '../services/videoLayoutStorage';

interface VideoSettingsPanelProps {
  settings: VideoSettings;
  puzzles: Puzzle[];
  onSettingsChange: (settings: VideoSettings) => void;
  onExport: () => void | Promise<void>;
  isExporting: boolean;
  exportProgress: number;
  exportStatus: string;
  onStart: () => void;
  onBack: () => void;
}

type VisualStyleCard = {
  value: VideoSettings['visualStyle'];
  label: string;
  hint: string;
  swatch: string;
  meter: string;
};

const ASPECT_RATIO_OPTIONS: Array<{
  value: VideoSettings['aspectRatio'];
  label: string;
  subLabel: string;
  icon: React.ComponentType<{ size?: string | number; strokeWidth?: string | number }>;
}> = [
  { value: '16:9', label: '16:9', subLabel: 'Landscape', icon: Monitor },
  { value: '9:16', label: '9:16', subLabel: 'Portrait', icon: Smartphone },
  { value: '1:1', label: '1:1', subLabel: 'Square', icon: Square },
  { value: '4:3', label: '4:3', subLabel: 'Classic', icon: Layout }
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

const TEXT_TEMPLATE_FIELDS: Array<{
  key: keyof VideoSettings['textTemplates'];
  label: string;
  span?: 'full';
}> = [
  { key: 'introEyebrow', label: 'Intro Eyebrow' },
  { key: 'introTitle', label: 'Intro Title' },
  { key: 'introSubtitle', label: 'Intro Subtitle', span: 'full' },
  { key: 'playTitle', label: 'Play Title' },
  { key: 'playSubtitle', label: 'Play Subtitle' },
  { key: 'revealTitle', label: 'Reveal Title' },
  { key: 'transitionEyebrow', label: 'Transition Eyebrow' },
  { key: 'transitionTitle', label: 'Transition Title' },
  { key: 'transitionSubtitle', label: 'Transition Subtitle', span: 'full' },
  { key: 'completionEyebrow', label: 'Completion Eyebrow' },
  { key: 'completionTitle', label: 'Completion Title' },
  { key: 'completionSubtitle', label: 'Completion Subtitle', span: 'full' },
  { key: 'puzzleBadgeLabel', label: 'Puzzle Badge Label' }
];

type PanelTab = 'package' | 'theme' | 'text' | 'motion' | 'layout' | 'export';
type LayoutPanelKey = 'frame' | 'logo' | 'title' | 'timer' | 'progress';

const sliderClass = 'w-full h-3 border-2 border-black rounded-full accent-black';

const buildSceneCopyPreset = (
  name: string,
  settings: VideoSettings,
  customLayout: CustomVideoLayout,
  existingId?: string,
  createdAt?: number
): VideoSceneCopyPreset => {
  const now = Date.now();
  return {
    id: existingId ?? `scene-copy-preset-${now}`,
    name: name.trim() || `Scene Copy ${new Date(now).toLocaleString()}`,
    textTemplates: {
      ...settings.textTemplates
    },
    linkedPackagePreset: settings.videoPackagePreset,
    useCustomLayout: settings.useCustomLayout === true,
    customLayout: settings.useCustomLayout === true ? { ...customLayout } : null,
    createdAt: createdAt ?? now,
    updatedAt: now
  };
};

const getSceneCopyLayoutLabel = (preset: VideoSceneCopyPreset) => {
  const packageLabel = VIDEO_PACKAGE_PRESETS[preset.linkedPackagePreset]?.label ?? preset.linkedPackagePreset;
  return preset.useCustomLayout ? `${packageLabel} custom layout` : `${packageLabel} package layout`;
};

export const VideoSettingsPanel: React.FC<VideoSettingsPanelProps> = ({
  settings,
  puzzles,
  onSettingsChange,
  onExport,
  isExporting,
  exportProgress,
  exportStatus,
  onStart,
  onBack
}) => {
  const [activeTab, setActiveTab] = useState<PanelTab>('package');
  const [layoutPanels, setLayoutPanels] = useState<Record<LayoutPanelKey, boolean>>({
    frame: true,
    logo: true,
    title: true,
    timer: false,
    progress: false
  });
  const [sceneCopyPresets, setSceneCopyPresets] = useState<VideoSceneCopyPreset[]>([]);
  const [selectedSceneCopyPresetId, setSelectedSceneCopyPresetId] = useState('');
  const [sceneCopyPresetName, setSceneCopyPresetName] = useState('');

  const toggleLayoutPanel = (panel: LayoutPanelKey) => {
    setLayoutPanels((previous) => ({
      ...previous,
      [panel]: !previous[panel]
    }));
  };

  const updateSetting = <K extends keyof VideoSettings>(key: K, value: VideoSettings[K]) => {
    onSettingsChange({ ...settings, [key]: value });
  };
  const updateSceneSettings = (patch: Partial<VideoSettings['sceneSettings']>) => {
    onSettingsChange({
      ...settings,
      sceneSettings: {
        ...settings.sceneSettings,
        ...patch
      }
    });
  };
  const updateTextTemplates = (patch: Partial<VideoSettings['textTemplates']>) => {
    onSettingsChange({
      ...settings,
      textTemplates: {
        ...settings.textTemplates,
        ...patch
      }
    });
  };
  const applyVideoPackagePreset = (presetKey: VideoSettings['videoPackagePreset']) => {
    const preset = VIDEO_PACKAGE_PRESETS[presetKey];
    onSettingsChange({
      ...settings,
      videoPackagePreset: presetKey,
      visualStyle: preset.defaultVisualStyle,
      revealBehavior: preset.defaultRevealBehavior,
      useCustomLayout: false,
      customLayout: buildDefaultCustomVideoLayout(presetKey, settings.aspectRatio)
    });
  };

  const selectedStyleOption =
    VISUAL_STYLE_OPTIONS.find((option) => option.value === settings.visualStyle) ?? VISUAL_STYLE_OPTIONS[0];
  const selectedPackagePreset =
    VIDEO_PACKAGE_PRESETS[settings.videoPackagePreset] ?? VIDEO_PACKAGE_PRESETS.gameshow;
  const selectedRevealBehaviorOption =
    VIDEO_REVEAL_BEHAVIOR_OPTIONS.find((option) => option.value === settings.revealBehavior) ??
    VIDEO_REVEAL_BEHAVIOR_OPTIONS[0];

  const customLayoutSeed = useMemo(
    () => buildDefaultCustomVideoLayout(settings.videoPackagePreset, settings.aspectRatio),
    [settings.videoPackagePreset, settings.aspectRatio]
  );
  const customLayout = settings.customLayout ?? customLayoutSeed;
  const selectedSceneCopyPreset = useMemo(
    () => sceneCopyPresets.find((preset) => preset.id === selectedSceneCopyPresetId) ?? null,
    [sceneCopyPresets, selectedSceneCopyPresetId]
  );
  const previewStage = BASE_STAGE_SIZE[settings.aspectRatio];
  const livePreviewHeightStyle =
    activeTab === 'text'
      ? settings.aspectRatio === '9:16'
        ? 'clamp(320px, 56vh, 560px)'
        : settings.aspectRatio === '1:1'
          ? 'clamp(220px, 42vw, 420px)'
          : 'clamp(180px, 30vw, 320px)'
      : settings.aspectRatio === '9:16'
        ? 'clamp(420px, 72vh, 720px)'
        : settings.aspectRatio === '1:1'
          ? 'clamp(260px, 56vw, 620px)'
          : 'clamp(220px, 46vw, 500px)';
  const processedLogoSrc = useProcessedLogoSrc(settings.logo, {
    enabled: settings.logoChromaKeyEnabled,
    color: settings.logoChromaKeyColor,
    tolerance: settings.logoChromaKeyTolerance
  });
  const logoZoom = clampLogoZoom(settings.logoZoom);

  useEffect(() => {
    setSceneCopyPresets(loadVideoSceneCopyPresets());
  }, []);

  useEffect(() => {
    if (selectedSceneCopyPreset) {
      setSceneCopyPresetName(selectedSceneCopyPreset.name);
    }
  }, [selectedSceneCopyPreset]);

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

  const handleApplySelectedSceneCopyPreset = () => {
    if (!selectedSceneCopyPreset) {
      return;
    }

    onSettingsChange(applyVideoSceneCopyPresetToSettings(settings, selectedSceneCopyPreset));
  };

  const handleSaveSceneCopyPreset = () => {
    const preset = buildSceneCopyPreset(sceneCopyPresetName, settings, customLayout);
    const nextPresets = saveVideoSceneCopyPreset(preset);
    setSceneCopyPresets(nextPresets);
    setSelectedSceneCopyPresetId(preset.id);
    setSceneCopyPresetName(preset.name);
  };

  const handleUpdateSelectedSceneCopyPreset = () => {
    if (!selectedSceneCopyPreset) {
      return;
    }

    const nextPreset = buildSceneCopyPreset(
      sceneCopyPresetName,
      settings,
      customLayout,
      selectedSceneCopyPreset.id,
      selectedSceneCopyPreset.createdAt
    );
    const nextPresets = saveVideoSceneCopyPreset(nextPreset);
    setSceneCopyPresets(nextPresets);
    setSelectedSceneCopyPresetId(nextPreset.id);
    setSceneCopyPresetName(nextPreset.name);
  };

  const handleDeleteSelectedSceneCopyPreset = () => {
    if (!selectedSceneCopyPreset) {
      return;
    }

    const nextPresets = deleteVideoSceneCopyPreset(selectedSceneCopyPreset.id);
    setSceneCopyPresets(nextPresets);
    setSelectedSceneCopyPresetId('');
    setSceneCopyPresetName('');
  };

  const handleLogoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (readerEvent) => {
      if (readerEvent.target?.result) {
        updateSetting('logo', readerEvent.target.result as string);
      }
    };
    reader.readAsDataURL(file);
  };

  const renderStylePreviewTile = (option: VisualStyleCard) => {
    const isSelected = settings.visualStyle === option.value;
    return (
      <button
        key={option.value}
        type="button"
        onClick={() => updateSetting('visualStyle', option.value)}
        className={`text-left border-2 border-black rounded-xl p-3 transition-all ${
          isSelected
            ? 'bg-[#FFF5CC] shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] translate-x-[1px] translate-y-[1px]'
            : 'bg-white hover:bg-slate-50 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5'
        }`}
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <div>
            <div className="font-black uppercase text-sm leading-none">{option.label}</div>
            <div className="text-[10px] font-bold uppercase text-slate-600 mt-1">{option.hint}</div>
          </div>
          <div
            className={`px-2 py-1 rounded-full border-2 border-black text-[9px] font-black uppercase ${
              isSelected ? 'bg-[#4ECDC4] text-black' : 'bg-white text-slate-500'
            }`}
          >
            {isSelected ? 'Active' : 'Use'}
          </div>
        </div>
        <div className="rounded-lg border-2 border-black overflow-hidden" style={{ background: option.swatch }}>
          <div className="h-5 border-b-2 border-black bg-white/70 px-2 flex items-center justify-between">
            <span className="text-[8px] font-black uppercase">Spot It</span>
            <span className="text-[8px] font-black">07s</span>
          </div>
          <div className="p-2">
            <div className="h-1.5 rounded-full border border-black bg-white/70 overflow-hidden">
              <div className="h-full" style={{ width: '65%', background: option.meter }} />
            </div>
          </div>
        </div>
      </button>
    );
  };

  return (
    <div className="w-full max-w-[1360px] mx-auto p-3 sm:p-4 md:p-6">
      <div className="bg-[#FFFDF3] border-4 border-black rounded-3xl shadow-[10px_10px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
        <div className="bg-[#FFD93D] border-b-4 border-black p-4 sm:p-5 md:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3 sm:items-center">
            <button
              onClick={onBack}
              className="w-12 h-12 inline-flex items-center justify-center rounded-xl border-2 border-black bg-white hover:bg-black hover:text-white transition-colors"
            >
              <ArrowLeft size={24} strokeWidth={3} />
            </button>
            <div className="min-w-0">
              <div className="text-xs md:text-sm font-black uppercase tracking-wider text-slate-700">Video Mode</div>
              <h2 className="text-xl sm:text-2xl md:text-3xl font-black uppercase leading-none">Production Setup</h2>
            </div>
          </div>

            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
            <div className="px-4 py-2 bg-black text-white rounded-xl border-2 border-black text-xs font-black uppercase tracking-wider">
              {puzzles.length} Puzzle{puzzles.length === 1 ? '' : 's'}
            </div>
            <button
              onClick={onStart}
              disabled={puzzles.length === 0}
              className={`w-full justify-center px-6 py-3 rounded-xl border-4 border-black text-sm font-black uppercase tracking-wide inline-flex items-center gap-2 sm:w-auto ${
                puzzles.length === 0
                  ? 'bg-slate-300 text-slate-700 cursor-not-allowed'
                  : 'bg-black text-white hover:bg-slate-900 shadow-[4px_4px_0px_0px_rgba(255,255,255,1)]'
              }`}
            >
              <Play size={18} strokeWidth={3} />
              Start Video
            </button>
          </div>
          </div>
        </div>

        <div className="p-4 md:p-6 space-y-6">
          <VideoPreviewCompare puzzles={puzzles} settings={settings} heightStyle={livePreviewHeightStyle} />

          <section className="bg-white border-4 border-black rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] p-4 md:p-5">
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-2">
              {([
                { value: 'package', label: 'Package' },
                { value: 'theme', label: 'Theme' },
                { value: 'text', label: 'Text' },
                { value: 'motion', label: 'Motion' },
                { value: 'layout', label: 'Layout' },
                { value: 'export', label: 'Export' }
              ] as Array<{ value: PanelTab; label: string }>).map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => setActiveTab(tab.value)}
                  className={`py-2 border-2 border-black rounded-lg text-xs font-black uppercase ${
                    activeTab === tab.value
                      ? 'bg-[#FFD93D] shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] translate-x-[1px] translate-y-[1px]'
                      : 'bg-white hover:bg-slate-100'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </section>

          {activeTab === 'package' && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <div className="space-y-6">
                <div className="bg-white border-4 border-black rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] p-4 md:p-5 space-y-4">
                  <div className="flex items-center gap-2">
                    <Film size={20} strokeWidth={3} />
                    <h3 className="text-lg font-black uppercase">Video Package</h3>
                  </div>

                  <div className="p-4 border-2 border-black rounded-xl bg-[#F8FDFF]">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="text-[10px] font-black uppercase text-slate-600">Current Package</div>
                        <div className="text-lg font-black uppercase leading-none mt-1">{selectedPackagePreset.label}</div>
                        <div className="text-[10px] font-bold uppercase text-slate-600 mt-2">
                          {selectedPackagePreset.description}
                        </div>
                      </div>
                      <span className="px-3 py-1 rounded-full border-2 border-black bg-white text-[10px] font-black uppercase">
                        Layout + HUD
                      </span>
                    </div>

                    <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="p-3 border-2 border-black rounded-xl bg-white">
                        <div className="text-[10px] font-black uppercase text-slate-600">Images</div>
                        <div className="text-xs font-black uppercase mt-1">{selectedPackagePreset.layoutSummary.images}</div>
                      </div>
                      <div className="p-3 border-2 border-black rounded-xl bg-white">
                        <div className="text-[10px] font-black uppercase text-slate-600">Title</div>
                        <div className="text-xs font-black uppercase mt-1">{selectedPackagePreset.layoutSummary.title}</div>
                      </div>
                      <div className="p-3 border-2 border-black rounded-xl bg-white">
                        <div className="text-[10px] font-black uppercase text-slate-600">Timer</div>
                        <div className="text-xs font-black uppercase mt-1">{selectedPackagePreset.layoutSummary.timer}</div>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {selectedPackagePreset.recommendedAspectRatios.map((ratio) => (
                        <span
                          key={ratio}
                          className="px-2 py-1 rounded-full border-2 border-black bg-white text-[10px] font-black uppercase"
                        >
                          {ratio}
                        </span>
                      ))}
                      <span className="px-2 py-1 rounded-full border-2 border-black bg-[#FFE9A8] text-[10px] font-black uppercase">
                        Theme: {selectedStyleOption.label}
                      </span>
                      <span className="px-2 py-1 rounded-full border-2 border-black bg-[#E0F2FE] text-[10px] font-black uppercase">
                        Reveal: {selectedRevealBehaviorOption.label}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {(
                      Object.entries(VIDEO_PACKAGE_PRESETS) as Array<
                        [VideoSettings['videoPackagePreset'], (typeof VIDEO_PACKAGE_PRESETS)[VideoSettings['videoPackagePreset']]]
                      >
                    ).map(([presetKey, preset]) => {
                      const isSelected = settings.videoPackagePreset === presetKey;
                      return (
                        <button
                          key={presetKey}
                          type="button"
                          onClick={() => applyVideoPackagePreset(presetKey)}
                          className={`p-3 border-2 border-black rounded-xl text-left ${
                            isSelected
                              ? 'bg-[#FFD93D] shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] translate-x-[1px] translate-y-[1px]'
                              : 'bg-white hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-black uppercase text-sm">{preset.label}</div>
                            <span className="text-[9px] font-black uppercase px-2 py-1 rounded-full border-2 border-black bg-white">
                              {isSelected ? 'Active' : 'Use'}
                            </span>
                          </div>
                          <div className="text-[10px] font-bold uppercase text-slate-600 mt-2">{preset.description}</div>
                          <div className="mt-3 grid grid-cols-1 gap-1 text-[10px] font-black uppercase text-slate-700">
                            <div>Images: {preset.layoutSummary.images}</div>
                            <div>Title: {preset.layoutSummary.title}</div>
                            <div>Timer: {preset.layoutSummary.timer}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="bg-white border-4 border-black rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] p-4 md:p-5 space-y-4">
                  <div className="flex items-center gap-2">
                    <Layout size={20} strokeWidth={3} />
                    <h3 className="text-lg font-black uppercase">Canvas Layout</h3>
                  </div>

                  <div>
                    <label className="block text-xs font-black uppercase mb-2">Aspect Ratio</label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {ASPECT_RATIO_OPTIONS.map((ratio) => (
                        <button
                          key={ratio.value}
                          type="button"
                          onClick={() => updateSetting('aspectRatio', ratio.value)}
                          className={`p-3 border-2 border-black rounded-xl text-left ${
                            settings.aspectRatio === ratio.value
                              ? 'bg-[#4ECDC4] shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] translate-x-[1px] translate-y-[1px]'
                              : 'bg-white hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <ratio.icon size={16} strokeWidth={2.8} />
                            <span className="font-black text-sm">{ratio.label}</span>
                          </div>
                          <div className="text-[10px] font-bold uppercase text-slate-700 mt-1">{ratio.subLabel}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="p-3 border-2 border-black rounded-xl bg-[#F8FDFF] text-[10px] font-bold uppercase text-slate-700">
                    Packages control image position, title placement, timer styling, and progress placement. Use the
                    layout tab only when you want to fine tune a package.
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <div className="bg-white border-4 border-black rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] p-4 md:p-5 space-y-4">
                  <div className="flex items-center gap-2">
                    <Eye size={20} strokeWidth={3} />
                    <h3 className="text-lg font-black uppercase">Package Guide</h3>
                  </div>

                  <div className="space-y-3">
                    <div className="p-3 border-2 border-black rounded-xl bg-[#FFF5CC]">
                      <div className="text-xs font-black uppercase">What Changes Here</div>
                      <div className="text-[10px] font-bold uppercase text-slate-600 mt-1">
                        Image split direction, title position, timer position, progress rail, and card presentation.
                      </div>
                    </div>
                    <div className="p-3 border-2 border-black rounded-xl bg-[#F8FDFF]">
                      <div className="text-xs font-black uppercase">What Does Not Change</div>
                      <div className="text-[10px] font-bold uppercase text-slate-600 mt-1">
                        Background colors, accent colors, and textures stay in the theme tab.
                      </div>
                    </div>
                    <div className="p-3 border-2 border-black rounded-xl bg-[#F8FDFF]">
                      <div className="text-xs font-black uppercase">Need Pixel Control?</div>
                      <div className="text-[10px] font-bold uppercase text-slate-600 mt-1">
                        Switch to layout designer only after you pick the closest package.
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setActiveTab('layout')}
                    className="w-full px-4 py-3 rounded-xl border-2 border-black bg-white hover:bg-slate-100 text-xs font-black uppercase"
                  >
                    Open Layout Designer
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'layout' && (
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
                        <div className="text-[10px] font-bold uppercase text-slate-600">
                          Works when a brand logo is uploaded. Adjusting these values turns on custom layout.
                        </div>
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
                        <div><div className="flex justify-between text-xs font-black"><span>Timer Size</span><span>{Math.round(customLayout.timerFontSize)}</span></div><input type="range" min="10" max="96" value={customLayout.timerFontSize} onChange={(event) => updateCustomLayout({ timerFontSize: Number(event.target.value) })} className={sliderClass} /></div>
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
          )}

          {activeTab === 'theme' && (
            <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-6">
              <div className="space-y-6">
                <div className="bg-white border-4 border-black rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] p-4 md:p-5 space-y-4">
                  <div className="flex items-center gap-2">
                    <Layout size={20} strokeWidth={3} />
                    <h3 className="text-lg font-black uppercase">Visual Theme</h3>
                  </div>

                  <div className="p-4 rounded-xl border-2 border-black bg-[#F8FDFF]">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="text-[10px] font-black uppercase text-slate-600">Current Theme</div>
                        <div className="text-lg font-black uppercase leading-none mt-1">{selectedStyleOption.label}</div>
                        <div className="text-[10px] font-bold uppercase text-slate-600 mt-2">{selectedStyleOption.hint}</div>
                      </div>
                      <span className="px-3 py-1 rounded-full border-2 border-black bg-white text-[10px] font-black uppercase">
                        Colors + Backgrounds
                      </span>
                    </div>
                    <div className="mt-3 h-2 rounded-full border border-black overflow-hidden bg-white">
                      <div className="h-full" style={{ width: '72%', background: selectedStyleOption.meter }} />
                    </div>
                  </div>

                  <div className="max-h-[520px] overflow-y-auto pr-1">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {VISUAL_STYLE_OPTIONS.map((option) => renderStylePreviewTile(option))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <div className="bg-white border-4 border-black rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] p-4 md:p-5 space-y-4">
                  <div className="flex items-center gap-2">
                    <Film size={20} strokeWidth={3} />
                    <h3 className="text-lg font-black uppercase">Theme Guide</h3>
                  </div>

                  <div className="space-y-3">
                    <div className="p-3 border-2 border-black rounded-xl bg-[#FFF5CC]">
                      <div className="text-xs font-black uppercase">Theme Changes</div>
                      <div className="text-[10px] font-bold uppercase text-slate-600 mt-1">
                        Background fills, header colors, timer colors, borders, and accents.
                      </div>
                    </div>
                    <div className="p-3 border-2 border-black rounded-xl bg-[#F8FDFF]">
                      <div className="text-xs font-black uppercase">Package Stays Locked</div>
                      <div className="text-[10px] font-bold uppercase text-slate-600 mt-1">
                        Theme selection will not move the images, title, timer, or progress bar.
                      </div>
                    </div>
                    <div className="p-3 border-2 border-black rounded-xl bg-[#F8FDFF]">
                      <div className="text-xs font-black uppercase">Random Theme</div>
                      <div className="text-[10px] font-bold uppercase text-slate-600 mt-1">
                        Applies a different saved theme palette per puzzle while keeping the package layout unchanged.
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-white border-4 border-black rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] p-4 md:p-5 space-y-4">
                  <div className="flex items-center gap-2">
                    <ImageIcon size={20} strokeWidth={3} />
                    <h3 className="text-lg font-black uppercase">Branding</h3>
                  </div>

                  <div className="p-3 border-2 border-black rounded-xl bg-[#F8FDFF] flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                    <div className="w-16 h-16 border-2 border-black rounded-lg bg-white flex items-center justify-center overflow-hidden">
                      {settings.logo ? (
                        <img
                          src={processedLogoSrc ?? settings.logo}
                          alt="Logo preview"
                          className="w-full h-full object-contain"
                          style={{
                            transform: `scale(${logoZoom})`,
                            transformOrigin: 'center'
                          }}
                        />
                      ) : (
                        <ImageIcon size={26} className="text-slate-300" />
                      )}
                    </div>
                    <div className="w-full flex-1">
                      <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-2 bg-black text-white rounded-lg text-xs font-black uppercase hover:bg-slate-800">
                        <Upload size={14} />
                        Upload Logo
                        <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                      </label>
                      <div className="text-[10px] font-bold uppercase text-slate-600 mt-2">Upload here, then fine-tune position and size in the Layout tab.</div>
                    </div>
                    {settings.logo && (
                      <button
                        type="button"
                        onClick={() => updateSetting('logo', undefined)}
                        className="px-3 py-2 border-2 border-black rounded-lg text-xs font-black uppercase bg-white hover:bg-red-50"
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="p-3 border-2 border-black rounded-xl bg-[#FFF5CC]">
                      <div className="flex justify-between text-xs font-black uppercase">
                        <span>Logo Zoom</span>
                        <span>{logoZoom.toFixed(2)}x</span>
                      </div>
                      <input
                        type="range"
                        min="0.5"
                        max="4"
                        step="0.05"
                        value={settings.logoZoom}
                        onChange={(event) => updateSetting('logoZoom', Number(event.target.value))}
                        className={`${sliderClass} mt-2`}
                      />
                      <div className="text-[10px] font-bold uppercase text-slate-600 mt-2">
                        Scales the artwork inside the logo position box.
                      </div>
                    </div>

                    <div className="p-3 border-2 border-black rounded-xl bg-[#F8FDFF] space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-xs font-black uppercase">Chroma Key</div>
                          <div className="text-[10px] font-bold uppercase text-slate-600 mt-1">
                            Remove a solid color like green or blue from the logo.
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => updateSetting('logoChromaKeyEnabled', !settings.logoChromaKeyEnabled)}
                          className={`px-3 py-2 border-2 border-black rounded-lg text-xs font-black uppercase ${
                            settings.logoChromaKeyEnabled ? 'bg-[#A7F3D0]' : 'bg-white hover:bg-slate-100'
                          }`}
                        >
                          {settings.logoChromaKeyEnabled ? 'On' : 'Off'}
                        </button>
                      </div>

                      <div className="grid grid-cols-[auto_1fr] items-center gap-3">
                        <label className="text-[10px] font-black uppercase">Key Color</label>
                        <input
                          type="color"
                          value={settings.logoChromaKeyColor}
                          onChange={(event) => updateSetting('logoChromaKeyColor', event.target.value)}
                          className="h-10 w-full border-2 border-black rounded-lg bg-white"
                          disabled={!settings.logoChromaKeyEnabled}
                        />
                      </div>

                      <div>
                        <div className="flex justify-between text-[10px] font-black uppercase">
                          <span>Tolerance</span>
                          <span>{Math.round(settings.logoChromaKeyTolerance)}</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="255"
                          step="1"
                          value={settings.logoChromaKeyTolerance}
                          onChange={(event) => updateSetting('logoChromaKeyTolerance', Number(event.target.value))}
                          className={`${sliderClass} mt-2`}
                          disabled={!settings.logoChromaKeyEnabled}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'text' && (
            <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr] gap-6">
              <div className="space-y-6">
                <div className="bg-white border-4 border-black rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] p-4 md:p-5 space-y-4">
                  <div className="flex items-center gap-2">
                    <Film size={20} strokeWidth={3} />
                    <h3 className="text-lg font-black uppercase">Scene Copy</h3>
                  </div>

                  <div className="rounded-xl border-2 border-black bg-[#F8FDFF] p-3 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
                      <label className="block">
                        <span className="block text-[10px] font-black uppercase text-slate-600 mb-1">Saved Preset</span>
                        <select
                          value={selectedSceneCopyPresetId}
                          onChange={(event) => setSelectedSceneCopyPresetId(event.target.value)}
                          className="w-full rounded-lg border-2 border-black bg-white px-3 py-2 text-sm font-bold"
                        >
                          <option value="">No preset selected</option>
                          {sceneCopyPresets.map((preset) => (
                            <option key={preset.id} value={preset.id}>
                              {preset.name}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="block">
                        <span className="block text-[10px] font-black uppercase text-slate-600 mb-1">Preset Name</span>
                        <input
                          type="text"
                          value={sceneCopyPresetName}
                          onChange={(event) => setSceneCopyPresetName(event.target.value)}
                          placeholder="Scene Copy preset name"
                          className="w-full rounded-lg border-2 border-black bg-white px-3 py-2 text-sm font-bold"
                        />
                      </label>
                    </div>

                    <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
                      <button
                        type="button"
                        onClick={handleApplySelectedSceneCopyPreset}
                        disabled={!selectedSceneCopyPreset}
                        className={`px-3 py-2 rounded-lg border-2 border-black text-[11px] font-black uppercase ${
                          selectedSceneCopyPreset ? 'bg-[#FDE68A] hover:bg-[#FCD34D]' : 'bg-slate-200 text-slate-500 cursor-not-allowed'
                        }`}
                      >
                        Apply Selected
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveSceneCopyPreset}
                        className="px-3 py-2 rounded-lg border-2 border-black bg-[#A7F3D0] text-[11px] font-black uppercase hover:bg-[#86EFAC] inline-flex items-center justify-center gap-2"
                      >
                        <Save size={14} strokeWidth={3} />
                        Save New
                      </button>
                      <button
                        type="button"
                        onClick={handleUpdateSelectedSceneCopyPreset}
                        disabled={!selectedSceneCopyPreset}
                        className={`px-3 py-2 rounded-lg border-2 border-black text-[11px] font-black uppercase ${
                          selectedSceneCopyPreset ? 'bg-[#DBEAFE] hover:bg-[#BFDBFE]' : 'bg-slate-200 text-slate-500 cursor-not-allowed'
                        }`}
                      >
                        Update Selected
                      </button>
                      <button
                        type="button"
                        onClick={handleDeleteSelectedSceneCopyPreset}
                        disabled={!selectedSceneCopyPreset}
                        className={`px-3 py-2 rounded-lg border-2 border-black text-[11px] font-black uppercase inline-flex items-center justify-center gap-2 ${
                          selectedSceneCopyPreset ? 'bg-[#FECACA] hover:bg-[#FCA5A5]' : 'bg-slate-200 text-slate-500 cursor-not-allowed'
                        }`}
                      >
                        <Trash2 size={14} strokeWidth={3} />
                        Delete
                      </button>
                    </div>

                    <div className="rounded-lg border-2 border-black bg-white px-3 py-2 text-[10px] font-bold uppercase text-slate-600">
                      Presets save these copy fields and the current linked layout together.
                      {selectedSceneCopyPreset ? ` Linked layout: ${getSceneCopyLayoutLabel(selectedSceneCopyPreset)}.` : ''}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {TEXT_TEMPLATE_FIELDS.map((field) => (
                      <label
                        key={field.key}
                        className={`text-xs font-black uppercase ${field.span === 'full' ? 'sm:col-span-2' : ''}`}
                      >
                        {field.label}
                        <input
                          type="text"
                          value={settings.textTemplates[field.key]}
                          onChange={(event) =>
                            updateTextTemplates({ [field.key]: event.target.value } as Partial<VideoSettings['textTemplates']>)
                          }
                          className="mt-1 w-full p-2 border-2 border-black rounded-lg font-bold"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <div className="bg-white border-4 border-black rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] p-4 md:p-5 space-y-4">
                  <div className="flex items-center gap-2">
                    <Eye size={20} strokeWidth={3} />
                    <h3 className="text-lg font-black uppercase">Text Guide</h3>
                  </div>

                  <div className="p-3 border-2 border-black rounded-xl bg-[#FFF5CC] text-[10px] font-bold uppercase text-slate-700">
                    These fields drive preview and export together. Edit once here and both outputs use the same copy.
                  </div>

                  <div className="space-y-3">
                    <div className="p-3 border-2 border-black rounded-xl bg-[#F8FDFF] text-[10px] font-bold uppercase text-slate-700">
                      Use placeholders like <span className="text-black">{'{puzzleCount}'}</span>,{' '}
                      <span className="text-black">{'{current}'}</span>, <span className="text-black">{'{next}'}</span>,{' '}
                      <span className="text-black">{'{total}'}</span>, and <span className="text-black">{'{remaining}'}</span>.
                    </div>
                    <div className="p-3 border-2 border-black rounded-xl bg-[#F8FDFF] text-[10px] font-bold uppercase text-slate-700">
                      Puzzle badge label is mainly visible in the gameshow package. Play subtitle is used during live play and reveal.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'motion' && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <div className="space-y-6">
                <div className="bg-white border-4 border-black rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] p-4 md:p-5 space-y-4">
                  <div className="flex items-center gap-2">
                    <Clock size={20} strokeWidth={3} />
                    <h3 className="text-lg font-black uppercase">Playback Timing</h3>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <div className="flex justify-between mb-1 text-xs font-black uppercase"><span>Show Puzzle</span><span>{settings.showDuration}s</span></div>
                      <input type="range" min="1" max="90" value={settings.showDuration} onChange={(event) => updateSetting('showDuration', Number(event.target.value))} className={sliderClass} />
                    </div>
                    <div>
                      <div className="flex justify-between mb-1 text-xs font-black uppercase"><span>Total Reveal</span><span>{settings.revealDuration}s</span></div>
                      <input type="range" min="1" max="60" step="0.5" value={settings.revealDuration} onChange={(event) => updateSetting('revealDuration', Number(event.target.value))} className={sliderClass} />
                    </div>
                    <div>
                      <div className="flex justify-between mb-1 text-xs font-black uppercase"><span>Reveal Step</span><span>{settings.sequentialRevealStep}s</span></div>
                      <input type="range" min="0.5" max="10" step="0.5" value={settings.sequentialRevealStep} onChange={(event) => updateSetting('sequentialRevealStep', Number(event.target.value))} className={sliderClass} />
                    </div>
                    <div>
                      <div className="flex justify-between mb-1 text-xs font-black uppercase"><span>Transition</span><span>{settings.transitionDuration}s</span></div>
                      <input type="range" min="0" max="5" step="0.5" value={settings.transitionDuration} onChange={(event) => updateSetting('transitionDuration', Number(event.target.value))} className={sliderClass} />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="p-3 border-2 border-black rounded-xl bg-[#F8FDFF] space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-black uppercase">Intro Card</span>
                        <button
                          type="button"
                          onClick={() => updateSceneSettings({ introEnabled: !settings.sceneSettings.introEnabled })}
                          className={`px-3 py-1 rounded-lg border-2 border-black text-xs font-black uppercase ${
                            settings.sceneSettings.introEnabled ? 'bg-[#A7F3D0]' : 'bg-white hover:bg-slate-100'
                          }`}
                        >
                          {settings.sceneSettings.introEnabled ? 'On' : 'Off'}
                        </button>
                      </div>
                      <div>
                        <div className="flex justify-between mb-1 text-xs font-black uppercase">
                          <span>Intro Duration</span>
                          <span>{settings.sceneSettings.introDuration}s</span>
                        </div>
                        <input
                          type="range"
                          min="0.5"
                          max="6"
                          step="0.5"
                          value={settings.sceneSettings.introDuration}
                          onChange={(event) => updateSceneSettings({ introDuration: Number(event.target.value) })}
                          disabled={!settings.sceneSettings.introEnabled}
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
                          max="6"
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
                      <div className="flex justify-between mb-1 text-xs font-black uppercase"><span>Blink Speed</span><span>{settings.enableBlinking ? `${settings.blinkSpeed}s` : 'Off'}</span></div>
                      <input type="range" min="0.2" max="2" step="0.1" value={settings.blinkSpeed} onChange={(event) => updateSetting('blinkSpeed', Number(event.target.value))} disabled={!settings.enableBlinking} className={`${sliderClass} disabled:opacity-40 disabled:cursor-not-allowed`} />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-black uppercase mb-2">Transition Style</label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {(['fade', 'slide', 'none'] as const).map((style) => (
                        <button
                          key={style}
                          type="button"
                          onClick={() => updateSetting('transitionStyle', style)}
                          className={`py-2 border-2 border-black rounded-lg text-xs font-black uppercase ${
                            settings.transitionStyle === style
                              ? 'bg-[#FFD93D] shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] translate-x-[1px] translate-y-[1px]'
                              : 'bg-white hover:bg-slate-100'
                          }`}
                        >
                          {style}
                        </button>
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
                      {VIDEO_REVEAL_BEHAVIOR_OPTIONS.map((option) => (
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
                            ? BOX_VARIANTS
                            : settings.revealStyle === 'circle'
                            ? CIRCLE_VARIANTS
                            : HIGHLIGHT_VARIANTS
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
                      <div className="flex justify-between mb-1 text-xs font-black uppercase"><span>Circle Thickness</span><span>{settings.circleThickness}px</span></div>
                      <input type="range" min="2" max="14" step="1" value={settings.circleThickness} onChange={(event) => updateSetting('circleThickness', Number(event.target.value))} className={sliderClass} />
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
                    <div className="flex justify-between mb-1 text-xs font-black uppercase"><span>Outline Thickness</span><span>{settings.outlineThickness}px</span></div>
                    <input type="range" min="0" max="8" step="1" value={settings.outlineThickness} onChange={(event) => updateSetting('outlineThickness', Number(event.target.value))} className={sliderClass} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'export' && (
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
                  {isExporting ? 'Exporting...' : 'Export Video'}
                </button>

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
          )}
        </div>
      </div>
    </div>
  );
};
