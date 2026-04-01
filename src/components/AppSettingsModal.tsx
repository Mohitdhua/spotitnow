import React, { useEffect, useRef, useState } from 'react';
import { Download, RotateCcw, Save, Settings, Upload, X } from 'lucide-react';
import {
  AppGlobalSettings,
  DEFAULT_APP_GLOBAL_SETTINGS,
  DEFAULT_SPLITTER_SETUP,
  FrameExtractorDefaults,
  readSplitterNextSequence,
  setSplitterNextSequence,
  type SplitterModePreference
} from '../services/appSettings';
import { CustomVideoLayout, VideoSettings } from '../types';
import { VIDEO_PACKAGE_PRESETS, VIDEO_REVEAL_BEHAVIOR_OPTIONS } from '../constants/videoPackages';
import { VIDEO_TRANSITION_STYLE_OPTIONS } from '../constants/videoStyleModules';
import { TimestampPresetPicker } from './TimestampPresetPicker';
import { DeferredNumberInput } from './DeferredNumberInput';
import { loadGameAudioMuted } from '../services/gameAudio';
import { loadWatermarkPresets } from '../services/watermarkPresets';
import type { WatermarkSelectionPreset } from '../services/watermarkRemoval';
import { loadSavedVideoCustomLayout } from '../services/videoLayoutStorage';

interface AppSettingsModalProps {
  isOpen: boolean;
  settings: AppGlobalSettings;
  onSave: (settings: AppGlobalSettings, options?: { gameAudioMuted?: boolean }) => void;
  onExportSettings: (settings: AppGlobalSettings, options?: { gameAudioMuted?: boolean }) => Promise<string> | string;
  onImportSettings: (file: File) => Promise<{ gameAudioMuted: boolean; message: string }> | { gameAudioMuted: boolean; message: string };
  onClose: () => void;
  onResetDefaults: () => void;
}

const VISUAL_STYLE_OPTIONS: VideoSettings['visualStyle'][] = [
  'random',
  'classic',
  'pop',
  'neon',
  'sunset',
  'mint',
  'midnight',
  'mono',
  'retro',
  'cyber',
  'oceanic',
  'ember',
  'candy',
  'forest',
  'aurora',
  'slate',
  'arcade',
  'ivory',
  'storybook'
];

const REVEAL_VARIANTS: VideoSettings['revealVariant'][] = [
  'box_classic',
  'box_minimal',
  'box_glow',
  'box_dashed',
  'box_corners',
  'circle_classic',
  'circle_crosshair',
  'circle_ring',
  'circle_dotted',
  'circle_ellipse',
  'circle_ellipse_dotted',
  'circle_red_black',
  'highlight_soft',
  'highlight_classic'
];

const labelize = (value: string) =>
  value
    .split('_')
    .map((token) => `${token.charAt(0).toUpperCase()}${token.slice(1)}`)
    .join(' ');

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const SPLITTER_MODE_OPTIONS: Array<{ value: SplitterModePreference; label: string }> = [
  { value: 'shared_area', label: 'Shared Area' },
  { value: 'manual_pair', label: 'Manual Pair' }
];

const TEXT_TEMPLATE_FIELDS: Array<{
  key: keyof VideoSettings['textTemplates'];
  label: string;
  rows?: number;
  span?: 'full';
}> = [
  { key: 'introEyebrow', label: 'Intro Eyebrow' },
  { key: 'introTitle', label: 'Intro Title' },
  { key: 'introSubtitle', label: 'Intro Subtitle', rows: 2, span: 'full' },
  { key: 'playTitle', label: 'Play Title' },
  { key: 'playSubtitle', label: 'Play Subtitle' },
  { key: 'progressLabel', label: 'Progress Phrase', rows: 2, span: 'full' },
  { key: 'revealTitle', label: 'Reveal Title' },
  { key: 'transitionEyebrow', label: 'Transition Eyebrow' },
  { key: 'transitionTitle', label: 'Transition Title' },
  { key: 'transitionSubtitle', label: 'Transition Subtitle', rows: 2, span: 'full' },
  { key: 'completionEyebrow', label: 'Completion Eyebrow' },
  { key: 'completionTitle', label: 'Completion Title' },
  { key: 'completionSubtitle', label: 'Completion Subtitle', rows: 2, span: 'full' },
  { key: 'puzzleBadgeLabel', label: 'Puzzle Badge Label' }
];

export function AppSettingsModal({
  isOpen,
  settings,
  onSave,
  onExportSettings,
  onImportSettings,
  onClose,
  onResetDefaults
}: AppSettingsModalProps) {
  const [draft, setDraft] = useState<AppGlobalSettings>(settings);
  const [splitterCounterInput, setSplitterCounterInput] = useState(1);
  const [watermarkPresets, setWatermarkPresets] = useState<WatermarkSelectionPreset[]>([]);
  const [savedVideoLayout, setSavedVideoLayout] = useState<CustomVideoLayout | null>(null);
  const [gameAudioMuted, setGameAudioMuted] = useState(false);
  const [transferMessage, setTransferMessage] = useState('');
  const [transferTone, setTransferTone] = useState<'idle' | 'success' | 'error'>('idle');
  const [isTransferBusy, setIsTransferBusy] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setDraft(settings);
    setSplitterCounterInput(readSplitterNextSequence());
    setWatermarkPresets(loadWatermarkPresets());
    setSavedVideoLayout(loadSavedVideoCustomLayout());
    setGameAudioMuted(loadGameAudioMuted());
  }, [isOpen, settings]);

  useEffect(() => {
    if (!isOpen) return;
    setTransferMessage('');
    setTransferTone('idle');
  }, [isOpen]);

  if (!isOpen) return null;

  const updateVideo = <K extends keyof VideoSettings>(key: K, value: VideoSettings[K]) => {
    setDraft((current) => ({
      ...current,
      videoDefaults: {
        ...current.videoDefaults,
        [key]: value
      }
    }));
  };
  const updateVideoSceneSettings = (patch: Partial<VideoSettings['sceneSettings']>) => {
    setDraft((current) => ({
      ...current,
      videoDefaults: {
        ...current.videoDefaults,
        sceneSettings: {
          ...current.videoDefaults.sceneSettings,
          ...patch
        }
      }
    }));
  };
  const updateVideoTextTemplates = (patch: Partial<VideoSettings['textTemplates']>) => {
    setDraft((current) => ({
      ...current,
      videoDefaults: {
        ...current.videoDefaults,
        textTemplates: {
          ...current.videoDefaults.textTemplates,
          ...patch
        }
      }
    }));
  };
  const updateFrameExtractorDefaults = (patch: Partial<FrameExtractorDefaults>) => {
    setDraft((current) => ({
      ...current,
      frameExtractorDefaults: {
        ...current.frameExtractorDefaults,
        ...patch
      }
    }));
  };
  const hasSavedVideoLayout = Boolean(savedVideoLayout);
  const setTransferFeedback = (tone: 'success' | 'error', message: string) => {
    setTransferTone(tone);
    setTransferMessage(message);
  };
  const applySavedLayoutToDraft = () => {
    if (!savedVideoLayout) {
      setTransferFeedback('error', 'Save a custom video layout first, then import it here as the default.');
      return;
    }

    setDraft((current) => ({
      ...current,
      videoDefaults: {
        ...current.videoDefaults,
        useCustomLayout: true,
        customLayout: {
          ...savedVideoLayout
        }
      }
    }));
    setTransferFeedback('success', 'Saved video layout copied into the global defaults draft.');
  };
  const handleExport = async () => {
    setIsTransferBusy(true);

    try {
      const message = await onExportSettings(draft, { gameAudioMuted });
      setTransferFeedback('success', message || 'Settings backup downloaded.');
    } catch (error) {
      setTransferFeedback('error', error instanceof Error ? error.message : 'Settings export failed.');
    } finally {
      setIsTransferBusy(false);
    }
  };
  const handleImportChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    setIsTransferBusy(true);

    try {
      const result = await onImportSettings(file);
      setGameAudioMuted(result.gameAudioMuted);
      setTransferFeedback('success', result.message);
    } catch (error) {
      setTransferFeedback('error', error instanceof Error ? error.message : 'Settings import failed.');
    } finally {
      setIsTransferBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/55 backdrop-blur-sm p-3 sm:p-6 overflow-y-auto">
      <div className="max-w-5xl mx-auto bg-white border-4 border-black rounded-2xl shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
        <div className="bg-[#C7D2FE] border-b-4 border-black px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-black text-white rounded-lg border-2 border-black flex items-center justify-center">
              <Settings size={20} strokeWidth={2.8} />
            </div>
            <div>
              <h2 className="text-2xl font-black uppercase tracking-tight">App Defaults</h2>
              <p className="text-xs font-bold uppercase text-slate-700">
                Configure shared defaults, backups, and reusable presets across the app.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close settings"
            className="p-2 border-2 border-black rounded-lg bg-white hover:bg-slate-100"
            title="Close settings"
          >
            <X size={18} strokeWidth={2.8} />
          </button>
        </div>

        <div className="p-4 sm:p-6 space-y-6">
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleImportChange}
            className="hidden"
          />

          <section className="p-4 border-4 border-black rounded-xl bg-[#EEF2FF] shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-black uppercase">Backup + Sync</div>
                <div className="mt-1 text-[11px] font-bold uppercase tracking-wide text-slate-600">
                  Export one JSON backup with app defaults, splitter setup, splitter presets, timestamp presets,
                  watermark presets, video packages, saved background packs, the saved video layout snapshot, and
                  game sound preference.
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleExport}
                  disabled={isTransferBusy}
                  className="px-4 py-2 border-2 border-black rounded-lg bg-white hover:bg-slate-100 text-xs font-black uppercase inline-flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <Download size={14} strokeWidth={2.8} />
                  <span>Export Settings</span>
                </button>
                <button
                  type="button"
                  onClick={() => importInputRef.current?.click()}
                  disabled={isTransferBusy}
                  className="px-4 py-2 border-2 border-black rounded-lg bg-black text-white hover:bg-slate-900 text-xs font-black uppercase inline-flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <Upload size={14} strokeWidth={2.8} />
                  <span>Import Settings</span>
                </button>
              </div>
            </div>

            {transferMessage ? (
              <div
                className={`rounded-lg border-2 border-black px-3 py-2 text-[11px] font-black uppercase ${
                  transferTone === 'error' ? 'bg-[#FECACA] text-red-900' : 'bg-[#D1FAE5] text-emerald-900'
                }`}
              >
                {transferMessage}
              </div>
            ) : null}
          </section>

          <section className="p-4 border-4 border-black rounded-xl bg-[#F8FDFF] shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] space-y-4">
            <div className="text-sm font-black uppercase">Video Defaults</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
              <label className="text-xs font-black uppercase">
                Package
                <select
                  value={draft.videoDefaults.videoPackagePreset}
                  onChange={(event) =>
                    updateVideo('videoPackagePreset', event.target.value as VideoSettings['videoPackagePreset'])
                  }
                  className="mt-1 w-full p-2 border-2 border-black rounded-lg bg-white font-bold"
                >
                  {(
                    Object.entries(VIDEO_PACKAGE_PRESETS) as Array<
                      [VideoSettings['videoPackagePreset'], (typeof VIDEO_PACKAGE_PRESETS)[VideoSettings['videoPackagePreset']]]
                    >
                  ).map(([presetKey, preset]) => (
                    <option key={presetKey} value={presetKey}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs font-black uppercase">
                Aspect Ratio
                <select
                  value={draft.videoDefaults.aspectRatio}
                  onChange={(event) => updateVideo('aspectRatio', event.target.value as VideoSettings['aspectRatio'])}
                  className="mt-1 w-full p-2 border-2 border-black rounded-lg bg-white font-bold"
                >
                  {(['16:9', '9:16'] as const).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs font-black uppercase">
                Theme
                <select
                  value={draft.videoDefaults.visualStyle}
                  onChange={(event) => updateVideo('visualStyle', event.target.value as VideoSettings['visualStyle'])}
                  className="mt-1 w-full p-2 border-2 border-black rounded-lg bg-white font-bold"
                >
                  {VISUAL_STYLE_OPTIONS.map((style) => (
                    <option key={style} value={style}>
                      {labelize(style)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs font-black uppercase">
                Reveal Style
                <select
                  value={draft.videoDefaults.revealStyle}
                  onChange={(event) => updateVideo('revealStyle', event.target.value as VideoSettings['revealStyle'])}
                  className="mt-1 w-full p-2 border-2 border-black rounded-lg bg-white font-bold"
                >
                  {(['box', 'circle', 'highlight'] as const).map((option) => (
                    <option key={option} value={option}>
                      {labelize(option)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs font-black uppercase">
                Reveal Behavior
                <select
                  value={draft.videoDefaults.revealBehavior}
                  onChange={(event) =>
                    updateVideo('revealBehavior', event.target.value as VideoSettings['revealBehavior'])
                  }
                  className="mt-1 w-full p-2 border-2 border-black rounded-lg bg-white font-bold"
                >
                  {VIDEO_REVEAL_BEHAVIOR_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs font-black uppercase">
                Reveal Variant
                <select
                  value={draft.videoDefaults.revealVariant}
                  onChange={(event) => updateVideo('revealVariant', event.target.value as VideoSettings['revealVariant'])}
                  className="mt-1 w-full p-2 border-2 border-black rounded-lg bg-white font-bold"
                >
                  {REVEAL_VARIANTS.map((option) => (
                    <option key={option} value={option}>
                      {labelize(option)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <label className="text-xs font-black uppercase">
                Show (s)
                <DeferredNumberInput
                  min={1}
                  max={90}
                  step={0.5}
                  value={draft.videoDefaults.showDuration}
                  onValueChange={(value) => updateVideo('showDuration', clamp(value, 1, 90))}
                  className="mt-1 w-full p-2 border-2 border-black rounded-lg font-bold"
                />
              </label>
              <label className="text-xs font-black uppercase">
                Reveal (s)
                <DeferredNumberInput
                  min={1}
                  max={60}
                  step={0.5}
                  value={draft.videoDefaults.revealDuration}
                  onValueChange={(value) => updateVideo('revealDuration', clamp(value, 1, 60))}
                  className="mt-1 w-full p-2 border-2 border-black rounded-lg font-bold"
                />
              </label>
              <label className="text-xs font-black uppercase">
                Reveal Step (s)
                <DeferredNumberInput
                  min={0.5}
                  max={10}
                  step={0.5}
                  value={draft.videoDefaults.sequentialRevealStep}
                  onValueChange={(value) => updateVideo('sequentialRevealStep', clamp(value, 0.5, 10))}
                  className="mt-1 w-full p-2 border-2 border-black rounded-lg font-bold"
                />
              </label>
              <label className="text-xs font-black uppercase">
                Blink Speed (s)
                <DeferredNumberInput
                  min={0.2}
                  max={5}
                  step={0.1}
                  value={draft.videoDefaults.blinkSpeed}
                  onValueChange={(value) => updateVideo('blinkSpeed', clamp(value, 0.2, 5))}
                  className="mt-1 w-full p-2 border-2 border-black rounded-lg font-bold"
                />
              </label>
              <label className="text-xs font-black uppercase">
                Transition (s)
                <DeferredNumberInput
                  min={0}
                  max={5}
                  step={0.5}
                  value={draft.videoDefaults.transitionDuration}
                  onValueChange={(value) => updateVideo('transitionDuration', clamp(value, 0, 5))}
                  className="mt-1 w-full p-2 border-2 border-black rounded-lg font-bold"
                />
              </label>
              <label className="text-xs font-black uppercase">
                Intro
                <div className="mt-1 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      updateVideoSceneSettings({ introEnabled: !draft.videoDefaults.sceneSettings.introEnabled })
                    }
                    className={`px-3 py-2 border-2 border-black rounded-lg font-bold ${
                      draft.videoDefaults.sceneSettings.introEnabled ? 'bg-[#A7F3D0]' : 'bg-white'
                    }`}
                  >
                    {draft.videoDefaults.sceneSettings.introEnabled ? 'On' : 'Off'}
                  </button>
                  <DeferredNumberInput
                    min={0.5}
                    max={180}
                    step={0.5}
                    value={draft.videoDefaults.sceneSettings.introDuration}
                    onValueChange={(value) =>
                      updateVideoSceneSettings({
                        introDuration: clamp(value, 0.5, 180)
                      })
                    }
                    className="w-full p-2 border-2 border-black rounded-lg font-bold"
                  />
                </div>
              </label>
              <label className="text-xs font-black uppercase">
                Outro
                <div className="mt-1 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      updateVideoSceneSettings({ outroEnabled: !draft.videoDefaults.sceneSettings.outroEnabled })
                    }
                    className={`px-3 py-2 border-2 border-black rounded-lg font-bold ${
                      draft.videoDefaults.sceneSettings.outroEnabled ? 'bg-[#A7F3D0]' : 'bg-white'
                    }`}
                  >
                    {draft.videoDefaults.sceneSettings.outroEnabled ? 'On' : 'Off'}
                  </button>
                  <DeferredNumberInput
                    min={0.5}
                    max={180}
                    step={0.5}
                    value={draft.videoDefaults.sceneSettings.outroDuration}
                    onValueChange={(value) =>
                      updateVideoSceneSettings({
                        outroDuration: clamp(value, 0.5, 180)
                      })
                    }
                    className="w-full p-2 border-2 border-black rounded-lg font-bold"
                  />
                </div>
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <label className="text-xs font-black uppercase">
                Circle Thickness
                <DeferredNumberInput
                  min={1}
                  max={30}
                  value={draft.videoDefaults.circleThickness}
                  onValueChange={(value) => updateVideo('circleThickness', clamp(value, 1, 30))}
                  className="mt-1 w-full p-2 border-2 border-black rounded-lg font-bold"
                />
              </label>
              <label className="text-xs font-black uppercase">
                Outline Thickness
                <DeferredNumberInput
                  min={0}
                  max={20}
                  value={draft.videoDefaults.outlineThickness}
                  onValueChange={(value) => updateVideo('outlineThickness', clamp(value, 0, 20))}
                  className="mt-1 w-full p-2 border-2 border-black rounded-lg font-bold"
                />
              </label>
              <label className="text-xs font-black uppercase">
                Resolution
                <select
                  value={draft.videoDefaults.exportResolution}
                  onChange={(event) =>
                    updateVideo('exportResolution', event.target.value as VideoSettings['exportResolution'])
                  }
                  className="mt-1 w-full p-2 border-2 border-black rounded-lg bg-white font-bold"
                >
                  {(['480p', '720p', '1080p', '1440p', '2160p'] as const).map((option) => (
                    <option key={option} value={option}>
                      {option.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-black uppercase">
                Codec
                <select
                  value={draft.videoDefaults.exportCodec}
                  onChange={(event) => updateVideo('exportCodec', event.target.value as VideoSettings['exportCodec'])}
                  className="mt-1 w-full p-2 border-2 border-black rounded-lg bg-white font-bold"
                >
                  {(['h264', 'av1'] as const).map((option) => (
                    <option key={option} value={option}>
                      {option.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-black uppercase">
                Bitrate (Mbps)
                <DeferredNumberInput
                  min={1}
                  max={80}
                  step={0.5}
                  value={draft.videoDefaults.exportBitrateMbps}
                  onValueChange={(value) => updateVideo('exportBitrateMbps', clamp(value, 1, 80))}
                  className="mt-1 w-full p-2 border-2 border-black rounded-lg font-bold"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <label className="text-xs font-black uppercase">
                Reveal Color
                <input
                  type="color"
                  value={draft.videoDefaults.revealColor}
                  onChange={(event) => updateVideo('revealColor', event.target.value)}
                  className="mt-1 w-full h-10 p-1 border-2 border-black rounded-lg bg-white"
                />
              </label>
              <label className="text-xs font-black uppercase">
                Outline Color
                <input
                  type="color"
                  value={draft.videoDefaults.outlineColor}
                  onChange={(event) => updateVideo('outlineColor', event.target.value)}
                  className="mt-1 w-full h-10 p-1 border-2 border-black rounded-lg bg-white"
                />
              </label>
              <label className="text-xs font-black uppercase">
                Blink Compare
                <button
                  type="button"
                  onClick={() => updateVideo('enableBlinking', !draft.videoDefaults.enableBlinking)}
                  className={`mt-1 w-full h-10 border-2 border-black rounded-lg font-black uppercase ${
                    draft.videoDefaults.enableBlinking ? 'bg-[#A7F3D0]' : 'bg-white'
                  }`}
                >
                  {draft.videoDefaults.enableBlinking ? 'On' : 'Off'}
                </button>
              </label>
              <label className="text-xs font-black uppercase">
                Transition Style
                <select
                  value={draft.videoDefaults.transitionStyle}
                  onChange={(event) =>
                    updateVideo('transitionStyle', event.target.value as VideoSettings['transitionStyle'])
                  }
                  className="mt-1 w-full p-2 border-2 border-black rounded-lg bg-white font-bold"
                >
                  {VIDEO_TRANSITION_STYLE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="space-y-3 rounded-xl border-2 border-black bg-white p-4">
              <div>
                <div className="text-xs font-black uppercase text-slate-900">Scene Text Templates</div>
                <div className="mt-1 text-[11px] font-bold uppercase tracking-wide text-slate-600">
                  Use placeholders like {'{current}'}, {'{total}'}, and {'{puzzleCount}'}.
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {TEXT_TEMPLATE_FIELDS.map((field) => (
                  <label
                    key={field.key}
                    className={`text-[11px] font-black uppercase ${field.span === 'full' ? 'sm:col-span-2' : ''}`}
                  >
                    {field.label}
                    {field.rows && field.rows > 1 ? (
                      <textarea
                        rows={field.rows}
                        value={draft.videoDefaults.textTemplates[field.key]}
                        onChange={(event) =>
                          updateVideoTextTemplates({
                            [field.key]: event.target.value
                          } as Partial<VideoSettings['textTemplates']>)
                        }
                        className="mt-1 w-full rounded-lg border-2 border-black bg-white p-2 text-sm font-bold normal-case"
                      />
                    ) : (
                      <input
                        type="text"
                        value={draft.videoDefaults.textTemplates[field.key]}
                        onChange={(event) =>
                          updateVideoTextTemplates({
                            [field.key]: event.target.value
                          } as Partial<VideoSettings['textTemplates']>)
                        }
                        className="mt-1 w-full rounded-lg border-2 border-black bg-white p-2 text-sm font-bold normal-case"
                      />
                    )}
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div className="space-y-3 rounded-xl border-2 border-black bg-white p-4">
                <div>
                  <div className="text-xs font-black uppercase text-slate-900">Layout Defaults</div>
                  <div className="mt-1 text-[11px] font-bold uppercase tracking-wide text-slate-600">
                    Set the default package baseline, then optionally reuse the latest saved custom layout snapshot.
                  </div>
                </div>
                <label className="text-xs font-black uppercase">
                  Use Custom Layout
                  <button
                    type="button"
                    onClick={() =>
                      updateVideo('useCustomLayout', !(draft.videoDefaults.useCustomLayout === true))
                    }
                    className={`mt-1 w-full rounded-lg border-2 border-black px-3 py-2 font-black uppercase ${
                      draft.videoDefaults.useCustomLayout ? 'bg-[#A7F3D0]' : 'bg-white'
                    }`}
                  >
                    {draft.videoDefaults.useCustomLayout ? 'On' : 'Off'}
                  </button>
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={applySavedLayoutToDraft}
                    disabled={!hasSavedVideoLayout}
                    className="px-3 py-2 border-2 border-black rounded-lg bg-[#FDE68A] disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed text-[11px] font-black uppercase"
                  >
                    Apply Saved Layout
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        videoDefaults: {
                          ...current.videoDefaults,
                          useCustomLayout: false
                        }
                      }))
                    }
                    className="px-3 py-2 border-2 border-black rounded-lg bg-white hover:bg-slate-100 text-[11px] font-black uppercase"
                  >
                    Use Package Layout
                  </button>
                </div>
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-600">
                  {hasSavedVideoLayout ? 'Saved layout detected and ready to reuse.' : 'No saved custom layout found yet.'}
                </div>
              </div>

              <div className="space-y-3 rounded-xl border-2 border-black bg-white p-4">
                <div>
                  <div className="text-xs font-black uppercase text-slate-900">Logo + Gameplay</div>
                  <div className="mt-1 text-[11px] font-bold uppercase tracking-wide text-slate-600">
                    Extra defaults that were previously only available inside individual tools.
                  </div>
                </div>
                <label className="block text-xs font-black uppercase">
                  Logo Zoom ({draft.videoDefaults.logoZoom.toFixed(2)}x)
                  <input
                    type="range"
                    min={0.5}
                    max={4}
                    step={0.05}
                    value={draft.videoDefaults.logoZoom}
                    onChange={(event) =>
                      updateVideo('logoZoom', clamp(Number(event.target.value) || 1, 0.5, 4))
                    }
                    className="mt-2 w-full h-3 border-2 border-black rounded-full accent-black"
                  />
                </label>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="text-xs font-black uppercase">
                    Logo Chroma Key
                    <button
                      type="button"
                      onClick={() => updateVideo('logoChromaKeyEnabled', !draft.videoDefaults.logoChromaKeyEnabled)}
                      className={`mt-1 w-full rounded-lg border-2 border-black px-3 py-2 font-black uppercase ${
                        draft.videoDefaults.logoChromaKeyEnabled ? 'bg-[#DBEAFE]' : 'bg-white'
                      }`}
                    >
                      {draft.videoDefaults.logoChromaKeyEnabled ? 'On' : 'Off'}
                    </button>
                  </label>
                  <label className="text-xs font-black uppercase">
                    Game Sounds
                    <button
                      type="button"
                      onClick={() => setGameAudioMuted((current) => !current)}
                      className={`mt-1 w-full rounded-lg border-2 border-black px-3 py-2 font-black uppercase ${
                        gameAudioMuted ? 'bg-[#FECACA]' : 'bg-[#A7F3D0]'
                      }`}
                    >
                      {gameAudioMuted ? 'Muted' : 'Enabled'}
                    </button>
                  </label>
                  <label className="text-xs font-black uppercase">
                    Chroma Color
                    <input
                      type="color"
                      value={draft.videoDefaults.logoChromaKeyColor}
                      onChange={(event) => updateVideo('logoChromaKeyColor', event.target.value)}
                      disabled={!draft.videoDefaults.logoChromaKeyEnabled}
                      className="mt-1 w-full h-10 p-1 border-2 border-black rounded-lg bg-white disabled:opacity-50"
                    />
                  </label>
                  <label className="text-xs font-black uppercase">
                    Chroma Tolerance
                    <DeferredNumberInput
                      min={0}
                      max={255}
                      value={draft.videoDefaults.logoChromaKeyTolerance}
                      onValueChange={(value) => updateVideo('logoChromaKeyTolerance', clamp(value, 0, 255))}
                      disabled={!draft.videoDefaults.logoChromaKeyEnabled}
                      className="mt-1 w-full p-2 border-2 border-black rounded-lg font-bold disabled:opacity-50"
                    />
                  </label>
                </div>
              </div>
            </div>
          </section>

          <section className="p-4 border-4 border-black rounded-xl bg-[#FFF7ED] shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] space-y-3">
            <div>
              <div className="text-sm font-black uppercase">Frame Extractor Defaults</div>
              <div className="mt-1 text-[11px] font-bold uppercase tracking-wide text-slate-600">
                Super Export now follows the current video package and video mode settings. These defaults only cover extraction output and watermark cleanup.
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="text-xs font-black uppercase">
                Format
                <select
                  value={draft.frameExtractorDefaults.format}
                  onChange={(event) =>
                    updateFrameExtractorDefaults({
                      format: event.target.value === 'png' ? 'png' : 'jpeg'
                    })
                  }
                  className="mt-1 w-full p-2 border-2 border-black rounded-lg bg-white font-bold"
                >
                  <option value="png">PNG (Lossless)</option>
                  <option value="jpeg">JPEG (Compressed)</option>
                </select>
              </label>

              <label className="text-xs font-black uppercase sm:col-span-2">
                JPEG Quality ({Math.round(draft.frameExtractorDefaults.jpegQuality * 100)}%)
                <input
                  type="range"
                  min={0.5}
                  max={1}
                  step={0.01}
                  value={draft.frameExtractorDefaults.jpegQuality}
                  onChange={(event) =>
                    updateFrameExtractorDefaults({
                      jpegQuality: clamp(Number(event.target.value) || 0.92, 0.5, 1)
                    })
                  }
                  className="mt-2 w-full h-3 border-2 border-black rounded-full accent-black"
                />
              </label>
            </div>

            <label className="block text-xs font-black uppercase">
              Super Export Images Per Video ({draft.frameExtractorDefaults.superExportImagesPerVideo})
              <input
                type="range"
                min={1}
                max={20}
                step={1}
                value={draft.frameExtractorDefaults.superExportImagesPerVideo}
                onChange={(event) =>
                  updateFrameExtractorDefaults({
                    superExportImagesPerVideo: clamp(Math.floor(Number(event.target.value) || 5), 1, 20)
                  })
                }
                className="mt-2 w-full h-3 border-2 border-black rounded-full accent-black"
              />
            </label>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="text-xs font-black uppercase">
                Super Image Output
                <select
                  value={draft.frameExtractorDefaults.superImageExportMode}
                  onChange={(event) =>
                    updateFrameExtractorDefaults({
                      superImageExportMode: event.target.value === 'folder' ? 'folder' : 'zip'
                    })
                  }
                  className="mt-1 w-full rounded-lg border-2 border-black bg-white p-2 font-bold"
                >
                  <option value="zip">Zip Download</option>
                  <option value="folder">Folder Picker</option>
                </select>
                <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                  Folder mode uses the browser directory picker when available.
                </div>
              </label>

              <label className="text-xs font-black uppercase">
                Watermark Removal
                <button
                  type="button"
                  onClick={() =>
                    updateFrameExtractorDefaults({
                      superExportWatermarkRemoval: !draft.frameExtractorDefaults.superExportWatermarkRemoval
                    })
                  }
                  className={`mt-1 w-full rounded-lg border-2 border-black px-3 py-2 font-black uppercase ${
                    draft.frameExtractorDefaults.superExportWatermarkRemoval ? 'bg-[#A7F3D0]' : 'bg-white'
                  }`}
                >
                  {draft.frameExtractorDefaults.superExportWatermarkRemoval ? 'On' : 'Off'}
                </button>
              </label>

              <label className="text-xs font-black uppercase">
                Watermark Preset
                <select
                  value={draft.frameExtractorDefaults.superExportWatermarkPresetId}
                  onChange={(event) =>
                    updateFrameExtractorDefaults({
                      superExportWatermarkPresetId: event.target.value
                    })
                  }
                  className="mt-1 w-full rounded-lg border-2 border-black bg-white p-2 font-bold"
                >
                  <option value="">Auto Detect</option>
                  {watermarkPresets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="block text-xs font-black uppercase">
              Default Timestamps
              <textarea
                rows={4}
                value={draft.frameExtractorDefaults.timestampsText}
                onChange={(event) =>
                  updateFrameExtractorDefaults({
                    timestampsText: event.target.value
                  })
                }
                className="mt-1 w-full p-2 border-2 border-black rounded-lg bg-white font-mono text-sm"
              />
            </label>
            <TimestampPresetPicker
              value={draft.frameExtractorDefaults.timestampsText}
              onChange={(nextValue) =>
                updateFrameExtractorDefaults({
                  timestampsText: nextValue
                })
              }
              storageRefreshKey={transferMessage}
            />
          </section>

          <section className="p-4 border-4 border-black rounded-xl bg-[#ECFCCB] shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] space-y-3">
            <div className="text-sm font-black uppercase">Image Splitter Defaults</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <label className="text-xs font-black uppercase">
                Filename Prefix
                <input
                  type="text"
                  value={draft.splitterDefaults.filenamePrefix}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      splitterDefaults: {
                        ...current.splitterDefaults,
                        filenamePrefix: event.target.value
                      }
                    }))
                  }
                  className="mt-1 w-full p-2 border-2 border-black rounded-lg bg-white font-bold"
                  placeholder="puzzle"
                />
              </label>
              <label className="text-xs font-black uppercase">
                Number Padding
                <DeferredNumberInput
                  min={0}
                  max={8}
                  value={draft.splitterDefaults.filenamePadDigits}
                  onValueChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      splitterDefaults: {
                        ...current.splitterDefaults,
                        filenamePadDigits: clamp(value, 0, 8)
                      }
                    }))
                  }
                  className="mt-1 w-full p-2 border-2 border-black rounded-lg bg-white font-bold"
                />
              </label>
              <div className="text-xs font-black uppercase">
                Default Splitter Mode
                <div className="mt-1 grid grid-cols-2 gap-2">
                  {SPLITTER_MODE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          splitterDefaults: {
                            ...current.splitterDefaults,
                            defaultMode: option.value
                          }
                        }))
                      }
                      className={`p-2 border-2 border-black rounded-lg text-[11px] font-black uppercase ${
                        draft.splitterDefaults.defaultMode === option.value
                          ? option.value === 'manual_pair'
                            ? 'bg-[#4ECDC4]'
                            : 'bg-[#FDE68A]'
                          : 'bg-white hover:bg-slate-100'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="text-xs font-black uppercase">
                Next Split Number
                <div className="mt-1 flex gap-2">
                  <DeferredNumberInput
                    min={1}
                    value={splitterCounterInput}
                    onValueChange={(value) => setSplitterCounterInput(Math.max(1, Math.floor(value)))}
                    className="w-full p-2 border-2 border-black rounded-lg bg-white font-bold"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setSplitterNextSequence(splitterCounterInput);
                    }}
                    className="px-3 border-2 border-black rounded-lg bg-white hover:bg-slate-100 text-xs font-black uppercase"
                  >
                    Set
                  </button>
                </div>
              </label>
            </div>
          </section>
        </div>

        <div className="px-4 sm:px-6 py-4 border-t-4 border-black bg-[#FFFDF5] flex flex-wrap items-center justify-between gap-2">
          <button
            onClick={() => {
              setDraft(DEFAULT_APP_GLOBAL_SETTINGS);
              setGameAudioMuted(false);
              setSplitterNextSequence(DEFAULT_SPLITTER_SETUP.nextSequence);
              setSplitterCounterInput(DEFAULT_SPLITTER_SETUP.nextSequence);
              setTransferMessage('');
              setTransferTone('idle');
              onResetDefaults();
            }}
            className="px-4 py-2 border-2 border-black rounded-lg bg-white hover:bg-red-50 text-xs font-black uppercase inline-flex items-center gap-2"
          >
            <RotateCcw size={14} strokeWidth={2.8} />
            <span>Reset Defaults</span>
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 border-2 border-black rounded-lg bg-white hover:bg-slate-100 text-xs font-black uppercase"
            >
              Cancel
            </button>
            <button
              onClick={() => onSave(draft, { gameAudioMuted })}
              className="px-4 py-2 border-2 border-black rounded-lg bg-black text-white hover:bg-slate-900 text-xs font-black uppercase inline-flex items-center gap-2"
            >
              <Save size={14} strokeWidth={2.8} />
              <span>Save + Apply</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
