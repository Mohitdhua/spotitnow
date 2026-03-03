import React from 'react';
import { Play, Monitor, Smartphone, Square, Layout, Clock, Eye, ArrowLeft, Image as ImageIcon, Upload, Download, Film } from 'lucide-react';
import { VideoSettings } from '../types';

interface VideoSettingsPanelProps {
  settings: VideoSettings;
  onSettingsChange: (settings: VideoSettings) => void;
  onExport: () => void | Promise<void>;
  isExporting: boolean;
  exportProgress: number;
  exportStatus: string;
  onStart: () => void;
  onBack: () => void;
}

export const VideoSettingsPanel: React.FC<VideoSettingsPanelProps> = ({
  settings,
  onSettingsChange,
  onExport,
  isExporting,
  exportProgress,
  exportStatus,
  onStart,
  onBack
}) => {
  const updateSetting = <K extends keyof VideoSettings>(key: K, value: VideoSettings[K]) => {
    onSettingsChange({ ...settings, [key]: value });
  };

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

  const boxVariants: Array<{ value: VideoSettings['revealVariant']; label: string; description: string }> = [
    { value: 'box_glow', label: 'Glow', description: 'Neon edge + shadow glow' },
    { value: 'box_dashed', label: 'Dashed', description: 'Stylish dashed outline' },
    { value: 'box_corners', label: 'Corners', description: 'Bracket-style corners' }
  ];

  const circleVariants: Array<{ value: VideoSettings['revealVariant']; label: string; description: string }> = [
    { value: 'circle_ring', label: 'Ring', description: 'Simple solid ring' },
    { value: 'circle_dotted', label: 'Dotted', description: 'Clean dotted circle ring' },
    { value: 'circle_ellipse', label: 'Elliptical', description: 'Oval reveal marker' },
    { value: 'circle_ellipse_dotted', label: 'Elliptical Dotted', description: 'Dotted oval reveal marker' },
    { value: 'circle_red_black', label: 'Red + Black', description: 'Alternating ring segments' }
  ];

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          updateSetting('logo', event.target.result as string);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  type VisualStyleOption = {
    value: VideoSettings['visualStyle'];
    label: string;
    description: string;
    selectedBg: string;
    previewTimerBg: string;
    previewTimerText: string;
    previewProgress: string;
  };

  const visualStyleOptions: VisualStyleOption[] = [
    {
      value: 'classic',
      label: 'Classic',
      description: 'Bright game-show look with a bold red progress fill.',
      selectedBg: '#A7F3D0',
      previewTimerBg: '#000000',
      previewTimerText: '#FFFFFF',
      previewProgress: 'linear-gradient(90deg, #FF6B6B 0%, #FF8E53 100%)'
    },
    {
      value: 'pop',
      label: 'Pop',
      description: 'Punchy colors with striped progress and playful contrast.',
      selectedBg: '#FFD93D',
      previewTimerBg: '#000000',
      previewTimerText: '#FFEFD5',
      previewProgress: 'repeating-linear-gradient(45deg, #1D4ED8 0 8px, #3B82F6 8px 16px)'
    },
    {
      value: 'neon',
      label: 'Neon',
      description: 'Arcade-inspired cyan and magenta with glow progress.',
      selectedBg: '#D9FBFF',
      previewTimerBg: '#050510',
      previewTimerText: '#12F7FF',
      previewProgress: 'linear-gradient(90deg, #12F7FF 0%, #9B5DE5 50%, #F15BB5 100%)'
    },
    {
      value: 'sunset',
      label: 'Sunset',
      description: 'Warm orange-pink palette with soft gradient timing bar.',
      selectedBg: '#FFD7B5',
      previewTimerBg: '#7C2D12',
      previewTimerText: '#FDE68A',
      previewProgress: 'linear-gradient(90deg, #FDE047 0%, #FB7185 55%, #F97316 100%)'
    },
    {
      value: 'mint',
      label: 'Mint',
      description: 'Fresh green tones and segmented progress movement.',
      selectedBg: '#B7F7D2',
      previewTimerBg: '#064E3B',
      previewTimerText: '#A7F3D0',
      previewProgress: 'repeating-linear-gradient(90deg, #34D399 0 10px, #10B981 10px 20px, #059669 20px 30px)'
    },
    {
      value: 'midnight',
      label: 'Midnight',
      description: 'Late-night blue HUD with icy timer accents.',
      selectedBg: '#BFDBFE',
      previewTimerBg: '#111827',
      previewTimerText: '#93C5FD',
      previewProgress: 'linear-gradient(90deg, #38BDF8 0%, #2563EB 60%, #1D4ED8 100%)'
    },
    {
      value: 'mono',
      label: 'Mono',
      description: 'Monochrome, square-edged UI with blocky progress.',
      selectedBg: '#E5E7EB',
      previewTimerBg: '#111111',
      previewTimerText: '#F5F5F5',
      previewProgress: 'repeating-linear-gradient(90deg, #111111 0 12px, #4B5563 12px 24px)'
    },
    {
      value: 'retro',
      label: 'Retro',
      description: 'Vintage arcade palette with chunky meter bars.',
      selectedBg: '#FDE68A',
      previewTimerBg: '#7C2D12',
      previewTimerText: '#FACC15',
      previewProgress: 'repeating-linear-gradient(90deg, #F59E0B 0 14px, #B45309 14px 28px)'
    },
    {
      value: 'cyber',
      label: 'Cyber',
      description: 'High-contrast HUD with electric cyan readouts.',
      selectedBg: '#CFFAFE',
      previewTimerBg: '#020617',
      previewTimerText: '#22D3EE',
      previewProgress: 'linear-gradient(180deg, #22D3EE 0%, #0EA5E9 100%)'
    },
    {
      value: 'oceanic',
      label: 'Oceanic',
      description: 'Sea-tone visuals with a soft drifting progress rail.',
      selectedBg: '#BAE6FD',
      previewTimerBg: '#0C4A6E',
      previewTimerText: '#DBEAFE',
      previewProgress: 'linear-gradient(90deg, #38BDF8 0%, #2563EB 100%)'
    },
    {
      value: 'ember',
      label: 'Ember',
      description: 'Hot red-orange scheme with intense timer pulse.',
      selectedBg: '#FECACA',
      previewTimerBg: '#7F1D1D',
      previewTimerText: '#FCA5A5',
      previewProgress: 'linear-gradient(90deg, #F97316 0%, #DC2626 100%)'
    },
    {
      value: 'candy',
      label: 'Candy',
      description: 'Sweet pastel dashboard with rounded meter capsules.',
      selectedBg: '#FBCFE8',
      previewTimerBg: '#831843',
      previewTimerText: '#FCE7F3',
      previewProgress: 'linear-gradient(90deg, #F472B6 0%, #C084FC 100%)'
    },
    {
      value: 'forest',
      label: 'Forest',
      description: 'Natural greens and bark tones with dense progress ticks.',
      selectedBg: '#BBF7D0',
      previewTimerBg: '#14532D',
      previewTimerText: '#DCFCE7',
      previewProgress: 'repeating-linear-gradient(90deg, #22C55E 0 10px, #15803D 10px 20px)'
    },
    {
      value: 'aurora',
      label: 'Aurora',
      description: 'Northern-light gradients and glowing status indicators.',
      selectedBg: '#DDD6FE',
      previewTimerBg: '#312E81',
      previewTimerText: '#C4B5FD',
      previewProgress: 'linear-gradient(90deg, #22D3EE 0%, #8B5CF6 50%, #EC4899 100%)'
    },
    {
      value: 'slate',
      label: 'Slate',
      description: 'UI-heavy steel look with compact technical counters.',
      selectedBg: '#CBD5E1',
      previewTimerBg: '#0F172A',
      previewTimerText: '#E2E8F0',
      previewProgress: 'repeating-linear-gradient(90deg, #64748B 0 12px, #334155 12px 24px)'
    },
    {
      value: 'arcade',
      label: 'Arcade',
      description: 'Game cabinet vibe with bold neon strips and blocks.',
      selectedBg: '#FEF08A',
      previewTimerBg: '#111827',
      previewTimerText: '#FDE047',
      previewProgress: 'repeating-linear-gradient(45deg, #A3E635 0 10px, #22D3EE 10px 20px, #F97316 20px 30px)'
    },
    {
      value: 'ivory',
      label: 'Ivory',
      description: 'Minimal clean frame with calm neutral timing widgets.',
      selectedBg: '#FEFCE8',
      previewTimerBg: '#44403C',
      previewTimerText: '#FAFAF9',
      previewProgress: 'linear-gradient(90deg, #A8A29E 0%, #57534E 100%)'
    }
  ];

  const selectedStyleOption =
    visualStyleOptions.find((styleOption) => styleOption.value === settings.visualStyle) ?? visualStyleOptions[0];

  const exportResolutionOptions: Array<{ value: VideoSettings['exportResolution']; label: string; subtitle: string }> = [
    { value: '480p', label: '480p', subtitle: 'SD' },
    { value: '720p', label: '720p', subtitle: 'HD' },
    { value: '1080p', label: '1080p', subtitle: 'Full HD' },
    { value: '1440p', label: '1440p', subtitle: '2K' },
    { value: '2160p', label: '4K', subtitle: 'UHD' }
  ];

  const renderStylePreview = (styleOption: VisualStyleOption, variant: 'compact' | 'large' = 'compact') => {
    const isLarge = variant === 'large';
    return (
      <div
        className={`rounded-xl border-2 border-black overflow-hidden ${isLarge ? 'h-44' : 'h-32'}`}
        style={{ backgroundColor: styleOption.selectedBg }}
      >
        <div className="px-3 py-2 border-b-2 border-black bg-white/80 flex items-center justify-between">
          <div className="font-black text-black uppercase tracking-wide text-[10px]">Spot It Now</div>
          <div
            className="px-2 py-0.5 border-2 border-black rounded-md text-[10px] font-black font-mono tracking-wide"
            style={{
              backgroundColor: styleOption.previewTimerBg,
              color: styleOption.previewTimerText
            }}
          >
            08.4s
          </div>
        </div>

        <div className="p-3 space-y-2">
          <div className="h-2 border-2 border-black rounded-full overflow-hidden bg-white/80">
            <div
              className="h-full"
              style={{
                width: '68%',
                background: styleOption.previewProgress
              }}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className={`relative border-2 border-black rounded-md bg-white/70 overflow-hidden ${isLarge ? 'h-24' : 'h-14'}`}>
              <div
                className="absolute inset-0 opacity-60"
                style={{
                  backgroundImage: 'radial-gradient(circle, rgba(0, 0, 0, 0.22) 1px, transparent 1px)',
                  backgroundSize: '12px 12px'
                }}
              />
              <div className="absolute bottom-1 left-1 bg-black text-white text-[9px] px-1.5 py-0.5 font-bold uppercase">
                Original
              </div>
            </div>
            <div className={`relative border-2 border-black rounded-md bg-white/70 overflow-hidden ${isLarge ? 'h-24' : 'h-14'}`}>
              <div
                className="absolute inset-0 opacity-60"
                style={{
                  backgroundImage: 'radial-gradient(circle, rgba(0, 0, 0, 0.22) 1px, transparent 1px)',
                  backgroundSize: '12px 12px'
                }}
              />
              <div className="absolute bottom-1 left-1 bg-[#FF6B6B] text-black border border-black text-[9px] px-1.5 py-0.5 font-bold uppercase">
                Modified
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="w-full max-w-4xl mx-auto p-6">
      <div className="bg-white border-4 border-black rounded-2xl shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
        <div className="bg-[#FFD93D] p-6 border-b-4 border-black flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <button 
              onClick={onBack}
              className="p-2 bg-white border-2 border-black rounded-lg hover:bg-black hover:text-white transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
            >
              <ArrowLeft size={24} strokeWidth={3} />
            </button>
            <h2 className="text-3xl font-black font-display uppercase tracking-tight text-black">
              Video Mode Setup
            </h2>
          </div>
          <div className="px-4 py-2 bg-black text-white font-bold rounded-lg uppercase tracking-wider text-sm">
            Configure Playback
          </div>
        </div>

        <div className="p-8 space-y-8">
          {/* Aspect Ratio */}
          <div className="space-y-4">
            <label className="flex items-center space-x-2 text-xl font-black uppercase">
              <Monitor size={24} strokeWidth={3} />
              <span>Aspect Ratio</span>
            </label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { value: '16:9', label: 'Landscape', icon: Monitor },
                { value: '9:16', label: 'Portrait', icon: Smartphone },
                { value: '1:1', label: 'Square', icon: Square },
                { value: '4:3', label: 'Classic', icon: Layout },
              ].map((ratio) => (
                <button
                  key={ratio.value}
                  onClick={() => updateSetting('aspectRatio', ratio.value as any)}
                  className={`p-4 rounded-xl border-4 border-black font-bold flex flex-col items-center space-y-2 transition-all ${
                    settings.aspectRatio === ratio.value
                      ? 'bg-[#4ECDC4] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] translate-x-[2px] translate-y-[2px]'
                      : 'bg-white hover:bg-slate-50 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-1'
                  }`}
                >
                  <ratio.icon size={32} strokeWidth={2.5} />
                  <span>{ratio.value}</span>
                  <span className="text-xs font-normal opacity-70 uppercase">{ratio.label}</span>
                </button>
              ))}
            </div>
          </div>

          {(settings.aspectRatio === '16:9' || settings.aspectRatio === '9:16') && (
            <div className="space-y-4">
              <label className="flex items-center space-x-2 text-xl font-black uppercase">
                <Layout size={24} strokeWidth={3} />
                <span>16:9 / 9:16 Visual Style</span>
              </label>
              <div className="bg-white rounded-2xl border-4 border-black shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
                <div className="p-5 border-b-4 border-black bg-[#FFD93D] flex items-center justify-between">
                  <div>
                    <h4 className="text-2xl font-black text-black font-display uppercase">Review Styles</h4>
                    <p className="text-black font-medium text-sm">Choose a look and check live preview before start.</p>
                  </div>
                  <span className="px-4 py-1 bg-black text-[#FFD93D] border-2 border-black rounded-full text-sm font-bold">
                    {visualStyleOptions.length} STYLES
                  </span>
                </div>

                <div className="p-5 bg-[#FFFDF5] space-y-5">
                  <div className="bg-white border-2 border-black rounded-xl p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <div className="text-xs font-bold text-slate-600 uppercase tracking-wide">Selected Style</div>
                        <div className="text-lg font-black uppercase text-black">{selectedStyleOption.label}</div>
                      </div>
                      <div className="px-3 py-1 rounded-full border-2 border-black bg-[#A7F3D0] text-xs font-black uppercase">
                        Active
                      </div>
                    </div>
                    {renderStylePreview(selectedStyleOption, 'large')}
                  </div>

                  <div className="max-h-[460px] overflow-y-auto pr-1">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {visualStyleOptions.map((styleOption) => {
                        const isSelected = settings.visualStyle === styleOption.value;
                        return (
                          <button
                            key={styleOption.value}
                            onClick={() => updateSetting('visualStyle', styleOption.value)}
                            className={`bg-white p-4 rounded-xl border-2 border-black text-left transition-all ${
                              isSelected
                                ? 'shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] translate-x-[1px] translate-y-[1px]'
                                : 'shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[-2px]'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2 mb-3">
                              <div>
                                <div className="font-black uppercase text-black leading-tight">{styleOption.label}</div>
                                <div className="text-[11px] font-bold text-slate-600 uppercase mt-1">{styleOption.description}</div>
                              </div>
                              <div
                                className={`px-2 py-1 rounded-full border-2 border-black text-[10px] font-black uppercase ${
                                  isSelected ? 'bg-[#4ECDC4] text-black' : 'bg-white text-slate-500'
                                }`}
                              >
                                {isSelected ? 'Selected' : 'Choose'}
                              </div>
                            </div>
                            {renderStylePreview(styleOption)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Branding / Logo */}
          <div className="space-y-4">
             <label className="flex items-center space-x-2 text-xl font-black uppercase">
              <ImageIcon size={24} strokeWidth={3} />
              <span>Branding Logo</span>
            </label>
            <div className="flex items-center space-x-4 p-4 bg-[#FFFDF5] border-4 border-black rounded-xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
              <div className="w-16 h-16 bg-white border-2 border-black rounded-lg flex items-center justify-center overflow-hidden">
                {settings.logo ? (
                  <img src={settings.logo} alt="Logo" className="w-full h-full object-contain" />
                ) : (
                  <ImageIcon size={32} className="text-slate-300" />
                )}
              </div>
              <div className="flex-1">
                <label className="cursor-pointer inline-flex items-center space-x-2 px-4 py-2 bg-black text-white font-bold rounded-lg uppercase text-sm hover:bg-slate-800 transition-colors">
                  <Upload size={16} />
                  <span>Upload Logo</span>
                  <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                </label>
                <p className="text-xs text-slate-500 mt-2 font-bold uppercase">
                  Displayed in top-left corner during playback
                </p>
              </div>
              {settings.logo && (
                <button 
                  onClick={() => updateSetting('logo', undefined)}
                  className="px-3 py-1 text-xs font-bold uppercase text-red-500 hover:bg-red-50 rounded border-2 border-transparent hover:border-red-200"
                >
                  Remove
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Timing Settings */}
            <div className="space-y-6 p-6 bg-[#FFFDF5] border-4 border-black rounded-xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
              <h3 className="text-xl font-black uppercase flex items-center space-x-2 border-b-4 border-black pb-2">
                <Clock size={24} strokeWidth={3} />
                <span>Timing (Seconds)</span>
              </h3>
              
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between mb-2 font-bold">
                    <span>Show Puzzle</span>
                    <span className="bg-black text-white px-2 rounded">{settings.showDuration}s</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="90"
                    value={settings.showDuration}
                    onChange={(e) => updateSetting('showDuration', Number(e.target.value))}
                    className="w-full h-4 bg-slate-200 rounded-full appearance-none cursor-pointer border-2 border-black accent-black"
                  />
                </div>

                <div>
                  <div className="flex justify-between mb-2 font-bold">
                    <span>Total Reveal Time</span>
                    <span className="bg-black text-white px-2 rounded">{settings.revealDuration}s</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="60"
                    step="0.5"
                    value={settings.revealDuration}
                    onChange={(e) => updateSetting('revealDuration', Number(e.target.value))}
                    className="w-full h-4 bg-slate-200 rounded-full appearance-none cursor-pointer border-2 border-black accent-black"
                  />
                </div>

                <div>
                  <div className="flex justify-between mb-2 font-bold">
                    <span>Sequential Reveal Step</span>
                    <span className="bg-black text-white px-2 rounded">{settings.sequentialRevealStep}s</span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="10"
                    step="0.5"
                    value={settings.sequentialRevealStep}
                    onChange={(e) => updateSetting('sequentialRevealStep', Number(e.target.value))}
                    className="w-full h-4 bg-slate-200 rounded-full appearance-none cursor-pointer border-2 border-black accent-black"
                  />
                  <p className="mt-2 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                    1 diff every {settings.sequentialRevealStep}s, then blink compare starts.
                  </p>
                </div>

                <div>
                  <div className="flex justify-between mb-2 font-bold">
                    <span>Blink Speed</span>
                    <span className="bg-black text-white px-2 rounded">{settings.blinkSpeed}s</span>
                  </div>
                  <input
                    type="range"
                    min="0.2"
                    max="2"
                    step="0.1"
                    value={settings.blinkSpeed}
                    onChange={(e) => updateSetting('blinkSpeed', Number(e.target.value))}
                    className="w-full h-4 bg-slate-200 rounded-full appearance-none cursor-pointer border-2 border-black accent-black"
                  />
                  <p className="mt-2 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                    Lower = faster blinking, higher = slower blinking.
                  </p>
                </div>

                <div>
                  <div className="flex justify-between mb-2 font-bold">
                    <span>Transition Time</span>
                    <span className="bg-black text-white px-2 rounded">{settings.transitionDuration}s</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="5"
                    step="0.5"
                    value={settings.transitionDuration}
                    onChange={(e) => updateSetting('transitionDuration', Number(e.target.value))}
                    className="w-full h-4 bg-slate-200 rounded-full appearance-none cursor-pointer border-2 border-black accent-black"
                  />
                </div>
              </div>
            </div>

            {/* Visual Style Settings */}
            <div className="space-y-6 p-6 bg-[#FFFDF5] border-4 border-black rounded-xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
              <h3 className="text-xl font-black uppercase flex items-center space-x-2 border-b-4 border-black pb-2">
                <Eye size={24} strokeWidth={3} />
                <span>Visual Style</span>
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="block font-bold mb-2 uppercase text-sm">Reveal Style</label>
                  <div className="flex space-x-2">
                    {['box', 'circle', 'highlight'].map((style) => (
                      <button
                        key={style}
                        onClick={() => updateRevealStyle(style as VideoSettings['revealStyle'])}
                        className={`flex-1 py-2 px-3 rounded-lg border-2 border-black font-bold uppercase text-sm transition-all ${
                          settings.revealStyle === style
                            ? 'bg-[#FF6B6B] text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] translate-x-[1px] translate-y-[1px]'
                            : 'bg-white hover:bg-slate-100'
                        }`}
                      >
                        {style}
                      </button>
                    ))}
                  </div>
                </div>

                {(settings.revealStyle === 'box' || settings.revealStyle === 'circle') && (
                  <div>
                    <label className="block font-bold mb-2 uppercase text-sm">
                      {settings.revealStyle === 'box' ? 'Box Subtype' : 'Circle Subtype'}
                    </label>
                    <div className="grid grid-cols-1 gap-2">
                      {(settings.revealStyle === 'box' ? boxVariants : circleVariants).map((variant) => (
                        <button
                          key={variant.value}
                          onClick={() => updateSetting('revealVariant', variant.value)}
                          className={`w-full flex items-center justify-between py-2 px-3 rounded-lg border-2 border-black text-left transition-all ${
                            settings.revealVariant === variant.value
                              ? 'bg-[#FFD93D] text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] translate-x-[1px] translate-y-[1px]'
                              : 'bg-white hover:bg-slate-100'
                          }`}
                        >
                          <span className="font-black uppercase text-sm">{variant.label}</span>
                          <span className="text-[10px] font-bold uppercase text-slate-600">{variant.description}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {settings.revealStyle === 'circle' && (
                  <div>
                    <label className="block font-bold mb-2 uppercase text-sm">Circle Thickness</label>
                    <div className="flex justify-between mb-2 font-bold text-sm">
                      <span>Stroke</span>
                      <span className="bg-black text-white px-2 rounded">{settings.circleThickness}px</span>
                    </div>
                    <input
                      type="range"
                      min="2"
                      max="14"
                      step="1"
                      value={settings.circleThickness}
                      onChange={(e) => updateSetting('circleThickness', Number(e.target.value))}
                      className="w-full h-4 bg-slate-200 rounded-full appearance-none cursor-pointer border-2 border-black accent-black"
                    />
                  </div>
                )}

                <div>
                  <label className="block font-bold mb-2 uppercase text-sm">Reveal Color</label>
                  <div className="flex space-x-3">
                    {['#FF0000', '#FF6B6B', '#4ECDC4', '#FFD93D', '#000000', '#FFFFFF'].map((color) => (
                      <button
                        key={color}
                        onClick={() => updateSetting('revealColor', color)}
                        className={`w-10 h-10 rounded-full border-4 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-transform hover:scale-110 ${
                          settings.revealColor === color ? 'ring-4 ring-offset-2 ring-slate-400' : ''
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block font-bold mb-2 uppercase text-sm">Outline Color</label>
                  <div className="flex space-x-3">
                    {['#000000', '#FFFFFF', '#FF0000', '#FFD93D', '#4ECDC4'].map((color) => (
                      <button
                        key={color}
                        onClick={() => updateSetting('outlineColor', color)}
                        className={`w-10 h-10 rounded-full border-4 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-transform hover:scale-110 ${
                          settings.outlineColor === color ? 'ring-4 ring-offset-2 ring-slate-400' : ''
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block font-bold mb-2 uppercase text-sm">Outline Thickness</label>
                  <div className="flex justify-between mb-2 font-bold text-sm">
                    <span>Stroke</span>
                    <span className="bg-black text-white px-2 rounded">{settings.outlineThickness}px</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="8"
                    step="1"
                    value={settings.outlineThickness}
                    onChange={(e) => updateSetting('outlineThickness', Number(e.target.value))}
                    className="w-full h-4 bg-slate-200 rounded-full appearance-none cursor-pointer border-2 border-black accent-black"
                  />
                </div>

                <div>
                  <label className="block font-bold mb-2 uppercase text-sm">Transition Style</label>
                  <div className="flex space-x-2">
                    {['fade', 'slide', 'none'].map((style) => (
                      <button
                        key={style}
                        onClick={() => updateSetting('transitionStyle', style as any)}
                        className={`flex-1 py-2 px-3 rounded-lg border-2 border-black font-bold uppercase text-sm transition-all ${
                          settings.transitionStyle === style
                            ? 'bg-[#A7F3D0] text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] translate-x-[1px] translate-y-[1px]'
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
          </div>

          <div className="space-y-6 p-6 bg-[#EEF9FF] border-4 border-black rounded-xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            <h3 className="text-xl font-black uppercase flex items-center space-x-2 border-b-4 border-black pb-2">
              <Film size={24} strokeWidth={3} />
              <span>Video Export (WebCodecs)</span>
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block font-bold mb-2 uppercase text-sm">Resolution</label>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  {exportResolutionOptions.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => updateSetting('exportResolution', option.value)}
                      className={`py-2 px-2 rounded-lg border-2 border-black font-bold transition-all ${
                        settings.exportResolution === option.value
                          ? 'bg-[#4ECDC4] text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] translate-x-[1px] translate-y-[1px]'
                          : 'bg-white hover:bg-slate-100'
                      }`}
                    >
                      <div className="text-sm uppercase leading-none">{option.label}</div>
                      <div className="text-[10px] uppercase opacity-70">{option.subtitle}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block font-bold mb-2 uppercase text-sm">Codec</label>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { value: 'h264', label: 'H.264 (MP4)', hint: 'Most compatible' },
                    { value: 'av1', label: 'AV1 (WebM)', hint: 'Better compression' }
                  ].map((codecOption) => (
                    <button
                      key={codecOption.value}
                      onClick={() => updateSetting('exportCodec', codecOption.value as VideoSettings['exportCodec'])}
                      className={`py-2 px-3 rounded-lg border-2 border-black font-bold uppercase text-sm transition-all text-left ${
                        settings.exportCodec === codecOption.value
                          ? 'bg-[#FFD93D] text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] translate-x-[1px] translate-y-[1px]'
                          : 'bg-white hover:bg-slate-100'
                      }`}
                    >
                      <div>{codecOption.label}</div>
                      <div className="text-[10px] text-slate-600">{codecOption.hint}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex justify-between mb-2 font-bold">
                  <span>Bitrate</span>
                  <span className="bg-black text-white px-2 rounded">{settings.exportBitrateMbps.toFixed(1)} Mbps</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="80"
                  step="0.5"
                  value={settings.exportBitrateMbps}
                  onChange={(e) => updateSetting('exportBitrateMbps', Number(e.target.value))}
                  className="w-full h-4 bg-slate-200 rounded-full appearance-none cursor-pointer border-2 border-black accent-black"
                />
                <p className="mt-2 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                  Higher bitrate = better quality + bigger file size.
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <button
                onClick={onExport}
                disabled={isExporting}
                className={`w-full px-6 py-3 border-4 border-black rounded-xl text-lg font-black uppercase tracking-wide flex items-center justify-center space-x-2 transition-all ${
                  isExporting
                    ? 'bg-slate-300 text-slate-700 cursor-not-allowed'
                    : 'bg-white text-black hover:bg-[#A7F3D0] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[1px] hover:translate-x-[1px] hover:shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]'
                }`}
              >
                <Download size={20} strokeWidth={3} />
                <span>{isExporting ? 'Exporting Video...' : 'Export Video'}</span>
              </button>
              {(isExporting || exportStatus) && (
                <div className="space-y-2">
                  <div className="text-xs font-black uppercase text-slate-700">{exportStatus || 'Working...'}</div>
                  <div className="w-full h-3 rounded-full border-2 border-black overflow-hidden bg-white">
                    <div
                      className="h-full bg-black transition-all"
                      style={{ width: `${Math.max(0, Math.min(100, exportProgress * 100))}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="pt-6 border-t-4 border-black flex justify-end">
            <button
              onClick={onStart}
              className="px-8 py-4 bg-black text-white text-xl font-black uppercase tracking-wider rounded-xl hover:scale-105 transition-transform shadow-[8px_8px_0px_0px_rgba(255,255,255,1)] flex items-center space-x-3 border-4 border-black hover:bg-slate-900"
            >
              <span>Start Video</span>
              <Play size={24} strokeWidth={3} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
