import React from 'react';
import { motion } from 'motion/react';
import { Play, Monitor, Smartphone, Square, Layout, Clock, Eye, Palette, MoveRight, ArrowLeft } from 'lucide-react';
import { VideoSettings } from '../types';

interface VideoSettingsPanelProps {
  settings: VideoSettings;
  onSettingsChange: (settings: VideoSettings) => void;
  onStart: () => void;
  onBack: () => void;
}

export const VideoSettingsPanel: React.FC<VideoSettingsPanelProps> = ({
  settings,
  onSettingsChange,
  onStart,
  onBack
}) => {
  const updateSetting = <K extends keyof VideoSettings>(key: K, value: VideoSettings[K]) => {
    onSettingsChange({ ...settings, [key]: value });
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
                    max="30"
                    value={settings.showDuration}
                    onChange={(e) => updateSetting('showDuration', Number(e.target.value))}
                    className="w-full h-4 bg-slate-200 rounded-full appearance-none cursor-pointer border-2 border-black accent-black"
                  />
                </div>

                <div>
                  <div className="flex justify-between mb-2 font-bold">
                    <span>Reveal Differences</span>
                    <span className="bg-black text-white px-2 rounded">{settings.revealDuration}s</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="15"
                    value={settings.revealDuration}
                    onChange={(e) => updateSetting('revealDuration', Number(e.target.value))}
                    className="w-full h-4 bg-slate-200 rounded-full appearance-none cursor-pointer border-2 border-black accent-black"
                  />
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
                        onClick={() => updateSetting('revealStyle', style as any)}
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

                <div>
                  <label className="block font-bold mb-2 uppercase text-sm">Reveal Color</label>
                  <div className="flex space-x-3">
                    {['#FF6B6B', '#4ECDC4', '#FFD93D', '#000000', '#FFFFFF'].map((color) => (
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
