import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Pause, Play, Shuffle } from 'lucide-react';
import {
  resolveVideoStyleModules,
  VIDEO_TIMER_STYLE_OPTIONS
} from '../constants/videoStyleModules';
import { VIDEO_PACKAGE_PRESETS } from '../constants/videoPackages';
import { VISUAL_THEMES } from '../constants/videoThemes';
import type { VideoSettings } from '../types';
import { isDesignerTimerStyle } from '../utils/timerPackShared';
import { VideoTimerDisplay } from './VideoTimerDisplay';

type TimerModeSettings = Pick<VideoSettings, 'visualStyle' | 'videoPackagePreset' | 'timerStyle'>;

interface TimerModeProps {
  settings: TimerModeSettings;
  onSettingsChange: (patch: Partial<TimerModeSettings>) => void;
  onBack: () => void;
}

const styleLabel = (style: VideoSettings['visualStyle']) =>
  style
    .split('_')
    .map((chunk) => `${chunk.charAt(0).toUpperCase()}${chunk.slice(1)}`)
    .join(' ');

export const TimerMode: React.FC<TimerModeProps> = ({
  settings,
  onSettingsChange,
  onBack
}) => {
  const visualStyleOptions = useMemo(() => {
    const themeKeys = Object.keys(VISUAL_THEMES).filter(
      (style) => style !== 'random'
    ) as Exclude<VideoSettings['visualStyle'], 'random'>[];
    return ['random', ...themeKeys];
  }, []);
  const [previewDuration, setPreviewDuration] = useState(8);
  const [previewTime, setPreviewTime] = useState(0);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(true);
  const customTimerStyleCount = VIDEO_TIMER_STYLE_OPTIONS.filter((option) => option.value !== 'package').length;
  const designerTimerOptions = useMemo(
    () => VIDEO_TIMER_STYLE_OPTIONS.filter((option) => option.value !== 'package' && isDesignerTimerStyle(option.value)),
    []
  );

  const packagePreset = VIDEO_PACKAGE_PRESETS[settings.videoPackagePreset] ?? VIDEO_PACKAGE_PRESETS.gameshow;
  const previewVisualStyle =
    settings.visualStyle === 'random' ? packagePreset.defaultVisualStyle : settings.visualStyle;
  const previewTheme = VISUAL_THEMES[previewVisualStyle];
  const previewModules = useMemo(
    () =>
      resolveVideoStyleModules(
        {
          textStyle: 'package',
          headerStyle: 'package',
          timerStyle: settings.timerStyle,
          progressStyle: 'package',
          introCardStyle: 'package',
          transitionCardStyle: 'package',
          outroCardStyle: 'package',
          transitionStyle: 'fade'
        },
        packagePreset
      ),
    [packagePreset, settings.timerStyle]
  );

  const timerModulesByStyle = useMemo(() => {
    const entries = VIDEO_TIMER_STYLE_OPTIONS.map((option) => [
      option.value,
      resolveVideoStyleModules(
        {
          textStyle: 'package',
          headerStyle: 'package',
          timerStyle: option.value,
          progressStyle: 'package',
          introCardStyle: 'package',
          transitionCardStyle: 'package',
          outroCardStyle: 'package',
          transitionStyle: 'fade'
        },
        packagePreset
      )
    ]);

    return Object.fromEntries(entries) as Record<VideoSettings['timerStyle'], ReturnType<typeof resolveVideoStyleModules>>;
  }, [packagePreset]);

  useEffect(() => {
    if (!isPreviewPlaying) return;
    let rafId = 0;
    let previous = performance.now();
    const duration = Math.max(0.5, previewDuration);
    const tick = (now: number) => {
      const delta = (now - previous) / 1000;
      previous = now;
      setPreviewTime((current) => {
        const next = current + delta;
        return next > duration ? 0 : next;
      });
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPreviewPlaying, previewDuration]);

  useEffect(() => {
    setPreviewTime((current) => Math.min(current, Math.max(0.5, previewDuration)));
  }, [previewDuration]);

  const remainingSeconds = Math.max(0, previewDuration - previewTime);
  const displaySeconds = `${Math.max(0, Math.ceil(remainingSeconds))}s`;
  const previewProgress = previewDuration > 0 ? remainingSeconds / previewDuration : 0;
  const timerPreviewTitleColor = previewTheme.headerText;
  const timerPreviewSubColor = previewTheme.headerSubText;

  const randomizeTimerStyle = () => {
    const customOptions = VIDEO_TIMER_STYLE_OPTIONS.filter((option) => option.value !== 'package');
    const next =
      customOptions[Math.abs(Date.now() + previewDuration * 100) % customOptions.length];
    onSettingsChange({ timerStyle: next.value });
  };

  const renderTimerChip = (
    timerStyle: VideoSettings['timerStyle'],
    secondsLabel: string,
    compact = false
  ) => {
    const modules = timerModulesByStyle[timerStyle];
    return (
      <VideoTimerDisplay
        style={modules.timer}
        visualTheme={previewTheme}
        valueText={secondsLabel}
        fontSize={compact ? 12 : 20}
        padX={compact ? 11 : 16}
        padY={compact ? 8 : 10}
        dotSize={compact ? 8 : 10}
        gap={compact ? 7 : 8}
        minWidth={compact ? 78 : 108}
        durationSeconds={previewDuration}
        remainingSeconds={remainingSeconds}
        progress={previewProgress}
        surfaceTone="default"
      />
    );
  };

  return (
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
      <div className="overflow-hidden rounded-2xl border-4 border-black bg-white shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
        <div className="flex flex-col gap-3 border-b-4 border-black bg-[#DBEAFE] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="flex items-start gap-3 sm:items-center">
            <button
              onClick={onBack}
              className="rounded-lg border-2 border-black bg-white p-2 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all hover:bg-black hover:text-white"
            >
              <ArrowLeft size={22} strokeWidth={3} />
            </button>
            <div>
              <h2 className="text-2xl font-black uppercase tracking-tight text-black sm:text-3xl">
                Timer Mode
              </h2>
              <p className="text-sm font-bold text-slate-700">
                Browse and apply the timer pack that also works in Video Mode, preview, and export.
              </p>
            </div>
          </div>
          <div className="self-start rounded-lg bg-black px-3 py-1 text-xs font-black uppercase text-white sm:self-auto">
            {customTimerStyleCount} Variations + Default
          </div>
        </div>

        <div className="space-y-6 p-4 sm:p-6 md:p-8">
          <div className="grid gap-6 lg:grid-cols-[1.28fr_0.72fr]">
            <div className="space-y-4 rounded-xl border-4 border-black bg-[#F8FDFF] p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-lg font-black uppercase">Live Timer Preview</h3>
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                  <button
                    onClick={() => setIsPreviewPlaying((value) => !value)}
                    className="inline-flex items-center gap-2 rounded-lg border-2 border-black bg-white px-3 py-2 text-xs font-black uppercase hover:bg-slate-100"
                  >
                    {isPreviewPlaying ? <Pause size={14} /> : <Play size={14} />}
                    <span>{isPreviewPlaying ? 'Pause' : 'Play'}</span>
                  </button>
                  <button
                    onClick={randomizeTimerStyle}
                    className="inline-flex items-center gap-2 rounded-lg border-2 border-black bg-white px-3 py-2 text-xs font-black uppercase hover:bg-slate-100"
                  >
                    <Shuffle size={14} />
                    Random Style
                  </button>
                </div>
              </div>

              <div
                className="space-y-4 rounded-xl border-4 border-black p-6"
                style={{ background: `linear-gradient(140deg, ${previewTheme.rootBg} 0%, ${previewTheme.gameBg} 100%)` }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-wide" style={{ color: timerPreviewSubColor }}>
                      {styleLabel(previewVisualStyle)} Theme
                    </div>
                    <div className="text-sm font-black uppercase" style={{ color: timerPreviewTitleColor }}>
                      {VIDEO_TIMER_STYLE_OPTIONS.find((option) => option.value === settings.timerStyle)?.label ?? 'Timer'}
                    </div>
                  </div>
                  <div className="rounded-full border-2 border-black bg-white px-3 py-1 text-[10px] font-black uppercase">
                    {packagePreset.label}
                  </div>
                </div>

                <div className="flex min-h-[180px] items-center justify-center rounded-xl border-2 border-black bg-white/30 p-4">
                  {renderTimerChip(settings.timerStyle, displaySeconds)}
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs font-black uppercase">
                    <span>Preview Position</span>
                    <span className="tabular-nums">
                      {previewTime.toFixed(2)}s / {previewDuration.toFixed(2)}s
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0.5, previewDuration)}
                    step={0.01}
                    value={previewTime}
                    onChange={(event) => setPreviewTime(Number(event.target.value))}
                    className="h-4 w-full rounded-full border-2 border-black accent-black"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-5 rounded-xl border-4 border-black bg-[#FFFDF5] p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] sm:p-6">
              <h3 className="border-b-4 border-black pb-2 text-lg font-black uppercase">Preview Controls</h3>

              <div>
                <div className="mb-2 flex justify-between font-bold">
                  <span>Duration</span>
                  <span className="rounded bg-black px-2 text-white tabular-nums">{previewDuration.toFixed(1)}s</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="60"
                  step="0.5"
                  value={previewDuration}
                  onChange={(event) => setPreviewDuration(Number(event.target.value))}
                  className="h-4 w-full cursor-pointer rounded-full border-2 border-black bg-slate-200 accent-black"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold uppercase">Theme</label>
                <select
                  value={settings.visualStyle}
                  onChange={(event) => onSettingsChange({ visualStyle: event.target.value as VideoSettings['visualStyle'] })}
                  className="w-full rounded-lg border-2 border-black bg-white px-3 py-2 text-sm font-bold"
                >
                  {visualStyleOptions.map((style) => (
                    <option key={style} value={style}>
                      {styleLabel(style)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold uppercase">Package</label>
                <select
                  value={settings.videoPackagePreset}
                  onChange={(event) => onSettingsChange({ videoPackagePreset: event.target.value as VideoSettings['videoPackagePreset'] })}
                  className="w-full rounded-lg border-2 border-black bg-white px-3 py-2 text-sm font-bold"
                >
                  {Object.entries(VIDEO_PACKAGE_PRESETS).map(([value, preset]) => (
                    <option key={value} value={value}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="rounded-xl border-2 border-black bg-[#F8FDFF] p-3 text-[10px] font-bold uppercase text-slate-600">
                Selecting a timer here updates the shared video timer style, so the same choice appears in Video Mode, live playback, and final export.
              </div>
            </div>
          </div>

          <div className="space-y-4 rounded-xl border-4 border-black bg-[#EEF9FF] p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-black uppercase">Designer Timer Pack</h3>
                <p className="text-[10px] font-bold uppercase text-slate-600">
                  Ten new timer presets tuned for puzzle videos, readable mobile layouts, and export-safe motion.
                </p>
              </div>
              <div className="rounded-lg border-2 border-black bg-white px-3 py-1 text-[10px] font-black uppercase">
                {designerTimerOptions.length} new presets
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {designerTimerOptions.map((option) => {
                const selected = settings.timerStyle === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => onSettingsChange({ timerStyle: option.value })}
                    className={`rounded-xl border-2 border-black p-4 text-left transition-all ${
                      selected
                        ? 'bg-[#FFF8D8] shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]'
                        : 'bg-white hover:-translate-y-0.5 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-black uppercase text-slate-900">{option.label}</div>
                        <div className="mt-1 text-[10px] font-bold uppercase text-slate-600">{option.description}</div>
                      </div>
                      <div
                        className={`rounded-full border-2 border-black px-2 py-1 text-[9px] font-black uppercase ${
                          selected ? 'bg-[#A7F3D0]' : 'bg-white'
                        }`}
                      >
                        {selected ? 'Active' : 'Use'}
                      </div>
                    </div>

                    <div
                      className="mt-4 rounded-xl border-2 border-black p-4 text-center"
                      style={{ background: `linear-gradient(140deg, ${previewTheme.rootBg} 0%, ${previewTheme.gameBg} 100%)` }}
                    >
                      {renderTimerChip(option.value, '07s', true)}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-4 rounded-xl border-4 border-black bg-[#EEF9FF] p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-lg font-black uppercase">Timer Variations</h3>
              <div className="rounded-lg border-2 border-black bg-white px-3 py-1 text-[10px] font-black uppercase">
                {customTimerStyleCount} reusable variations
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {VIDEO_TIMER_STYLE_OPTIONS.map((option) => {
                const selected = settings.timerStyle === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => onSettingsChange({ timerStyle: option.value })}
                    className={`rounded-xl border-2 border-black p-4 text-left transition-all ${
                      selected
                        ? 'bg-[#FFF8D8] shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]'
                        : 'bg-white hover:-translate-y-0.5 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-black uppercase text-slate-900">{option.label}</div>
                        <div className="mt-1 text-[10px] font-bold uppercase text-slate-600">{option.description}</div>
                      </div>
                      <div
                        className={`rounded-full border-2 border-black px-2 py-1 text-[9px] font-black uppercase ${
                          selected ? 'bg-[#A7F3D0]' : 'bg-white'
                        }`}
                      >
                        {selected ? 'Active' : 'Use'}
                      </div>
                    </div>

                    <div
                      className="mt-4 rounded-xl border-2 border-black p-4 text-center"
                      style={{ background: `linear-gradient(140deg, ${previewTheme.rootBg} 0%, ${previewTheme.gameBg} 100%)` }}
                    >
                      {renderTimerChip(option.value, '07s', true)}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
