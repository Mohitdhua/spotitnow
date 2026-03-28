import React, { useEffect, useId, useMemo, useState } from 'react';
import { ArrowLeft, Check, Download, Pause, Play, Square } from 'lucide-react';
import { cancelProgressBarExport, exportProgressBarWithWebCodecs } from '../services/progressBarExport';
import { VideoSettings } from '../types';
import type { ProgressBarRenderMode } from '../services/progressBarExport';
import { DeferredNumberInput } from './DeferredNumberInput';
import {
  PROGRESS_BAR_THEMES,
  resolveProgressBarFillColors,
  resolveProgressBarFillStyle,
  type ProgressBarVisualStyle
} from '../constants/progressBarThemes';
import {
  measureTextProgressSpan,
  resolveSmoothTextProgressFillColors,
  resolveTextProgressFillSpan
} from '../utils/textProgressFill';
import {
  resolveTextProgressBaseAccent,
  resolveTextProgressEffectFrame,
  resolveTextProgressShellStyle
} from '../utils/textProgressEffects';

interface ProgressBarModeProps {
  settings: VideoSettings;
  onSettingsChange: (next: React.SetStateAction<VideoSettings>) => void;
  onBack: () => void;
  hasActiveAppExport?: boolean;
  onExportStateChange?: (state: { isExporting: boolean; progress: number; status: string }) => void;
}

const styleLabel = (style: ProgressBarVisualStyle) =>
  style
    .split('_')
    .map((chunk) => `${chunk.charAt(0).toUpperCase()}${chunk.slice(1)}`)
    .join(' ');

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const resolveTextProgressFillColors = (
  remainingPercent: number,
  style: ProgressBarVisualStyle,
  theme: (typeof PROGRESS_BAR_THEMES)[ProgressBarVisualStyle]
) => {
  return resolveSmoothTextProgressFillColors(
    remainingPercent,
    theme,
    resolveProgressBarFillColors(style, remainingPercent / 100)
  );
};

const resolveTextProgressFontSize = (text: string, width: number, height: number, preferred: number) => {
  const safeText = text.trim() || 'PROGRESS';
  const widthBound = width / Math.max(4.8, safeText.length * 0.68);
  const heightBound = height * 0.78;
  return clamp(Math.min(preferred, widthBound, heightBound), 12, 96);
};

const TextFillProgressPreview: React.FC<{
  style: ProgressBarVisualStyle;
  theme: (typeof PROGRESS_BAR_THEMES)[ProgressBarVisualStyle];
  label: string;
  remainingRatio: number;
  width: number;
  height: number;
  animationSeconds: number;
}> = ({ style, theme, label, remainingRatio, width, height, animationSeconds }) => {
  const svgId = useId().replace(/:/g, '');
  const safeLabel = label.trim() || 'PROGRESS';
  const fillColors = resolveTextProgressFillColors(remainingRatio * 100, style, theme);
  const shellStyle = resolveTextProgressShellStyle(style, fillColors);
  const fontSize = Math.max(
    12,
    Math.round(
      resolveTextProgressFontSize(safeLabel, width, height, Math.max(16, height * 0.56)) *
        shellStyle.fontScale
    )
  );
  const textSpan = measureTextProgressSpan(
    safeLabel,
    width,
    fontSize,
    '"Arial Black", "Segoe UI", sans-serif',
    900
  );
  const fillSpan = resolveTextProgressFillSpan(textSpan, remainingRatio);
  const strokeWidth = Math.max(2, Math.round(fontSize * 0.08 * shellStyle.strokeScale));
  const textEffects = resolveTextProgressEffectFrame({
    style,
    width,
    height,
    fillX: fillSpan.left,
    fillWidth: fillSpan.fillWidth,
    spanWidth: fillSpan.width,
    fillRatio: fillSpan.fillRatio,
    animationSeconds,
    fillColors
  });
  const baseAccent = resolveTextProgressBaseAccent(style, fillColors);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="block h-full w-full overflow-visible" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`${svgId}-gradient`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={fillColors.start} />
          <stop offset="58%" stopColor={fillColors.middle} />
          <stop offset="100%" stopColor={fillColors.end} />
        </linearGradient>
        <clipPath id={`${svgId}-clip`}>
          <text
            x={width / 2}
            y={height * 0.68}
            textAnchor="middle"
            fontFamily='"Arial Black", "Segoe UI", sans-serif'
            fontWeight="900"
            fontSize={fontSize}
          >
            {safeLabel}
          </text>
        </clipPath>
      </defs>
      <text
        x={width / 2}
        y={height * 0.68}
        textAnchor="middle"
        fontFamily='"Arial Black", "Segoe UI", sans-serif'
        fontWeight="900"
        fontSize={fontSize}
        fill={shellStyle.fill}
        stroke={shellStyle.stroke}
        strokeWidth={strokeWidth}
        paintOrder="stroke fill"
      >
        {safeLabel}
      </text>
      <g clipPath={`url(#${svgId}-clip)`}>
        <rect x={fillSpan.left} y="0" width={fillSpan.fillWidth} height={height} fill={`url(#${svgId}-gradient)`} />
        {baseAccent && (
          <rect x={fillSpan.left} y="0" width={fillSpan.fillWidth} height={height} fill={baseAccent} opacity={0.08} />
        )}
        {textEffects.bands.map((band, index) => (
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
        {textEffects.orbs.map((orb, index) => (
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
      </g>
    </svg>
  );
};

export const ProgressBarMode: React.FC<ProgressBarModeProps> = ({
  settings,
  onSettingsChange,
  onBack,
  hasActiveAppExport = false,
  onExportStateChange
}) => {
  const styleOptions = useMemo(
    () => Object.keys(PROGRESS_BAR_THEMES) as ProgressBarVisualStyle[],
    []
  );
  const [selectedStyles, setSelectedStyles] = useState<ProgressBarVisualStyle[]>([
    settings.generatedProgressStyle
  ]);
  const [previewStyle, setPreviewStyle] = useState<ProgressBarVisualStyle>(
    settings.generatedProgressStyle
  );
  const [durationSeconds, setDurationSeconds] = useState(8);
  const [previewTime, setPreviewTime] = useState(0);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(true);
  const [renderMode, setRenderMode] = useState<ProgressBarRenderMode>(
    settings.generatedProgressRenderMode
  );
  const [progressLabel, setProgressLabel] = useState(
    settings.textTemplates.progressLabel || 'SPOT THE 3 DIFFERENCES'
  );
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStatus, setExportStatus] = useState('');

  useEffect(() => {
    if (!styleOptions.includes(previewStyle)) {
      setPreviewStyle(styleOptions[0]);
    }
  }, [previewStyle, styleOptions]);

  useEffect(() => {
    if (styleOptions.includes(settings.generatedProgressStyle)) {
      setPreviewStyle(settings.generatedProgressStyle);
    }
  }, [settings.generatedProgressStyle, styleOptions]);

  useEffect(() => {
    if (!styleOptions.includes(settings.generatedProgressStyle)) {
      return;
    }
    setSelectedStyles((current) =>
      current.includes(settings.generatedProgressStyle)
        ? current
        : [settings.generatedProgressStyle, ...current]
    );
  }, [settings.generatedProgressStyle, styleOptions]);

  useEffect(() => {
    setRenderMode(settings.generatedProgressRenderMode);
  }, [settings.generatedProgressRenderMode]);

  useEffect(() => {
    setProgressLabel(settings.textTemplates.progressLabel || 'SPOT THE 3 DIFFERENCES');
  }, [settings.textTemplates.progressLabel]);

  useEffect(() => {
    if (!isPreviewPlaying) return;
    const duration = Math.max(0.5, durationSeconds);
    let rafId = 0;
    let previous = performance.now();
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
  }, [durationSeconds, isPreviewPlaying]);

  useEffect(() => {
    const duration = Math.max(0.5, durationSeconds);
    setPreviewTime((current) => Math.min(current, duration));
  }, [durationSeconds]);

  useEffect(() => {
    onExportStateChange?.({
      isExporting,
      progress: isExporting ? exportProgress : 0,
      status: isExporting ? exportStatus : ''
    });
  }, [exportProgress, exportStatus, isExporting, onExportStateChange]);

  const previewTheme = PROGRESS_BAR_THEMES[previewStyle];
  const previewDuration = Math.max(0.5, durationSeconds);
  const previewProgress = clamp(previewTime / previewDuration, 0, 1);
  const remainingRatio = 1 - previewProgress;
  const remainingSeconds = Math.max(0, previewDuration - previewTime);

  const applyGeneratedPreviewStyle = (style: ProgressBarVisualStyle) => {
    setPreviewStyle(style);
    onSettingsChange((current) => ({
      ...current,
      generatedProgressEnabled: true,
      generatedProgressStyle: style
    }));
  };

  const applyGeneratedRenderMode = (mode: ProgressBarRenderMode) => {
    setRenderMode(mode);
    onSettingsChange((current) => ({
      ...current,
      generatedProgressEnabled: true,
      generatedProgressRenderMode: mode
    }));
  };

  const applyProgressLabel = (label: string) => {
    setProgressLabel(label);
    onSettingsChange((current) => ({
      ...current,
      generatedProgressEnabled: true,
      textTemplates: {
        ...current.textTemplates,
        progressLabel: label
      }
    }));
  };

  const toggleStyleSelection = (style: ProgressBarVisualStyle) => {
    setSelectedStyles((current) => {
      if (current.includes(style)) {
        const next = current.filter((value) => value !== style);
        if (!next.length) return current;
        if (!next.includes(previewStyle)) {
          applyGeneratedPreviewStyle(next[0]);
        }
        return next;
      }
      return [...current, style];
    });
  };

  const handleExport = async () => {
    if (!selectedStyles.length) {
      alert('Select at least one progress bar style.');
      return;
    }
    if (hasActiveAppExport && !isExporting) {
      alert('Another export is already running. Please wait or cancel it first.');
      return;
    }
    if (isExporting) return;

    const sortedStyles = [...selectedStyles];
    const total = sortedStyles.length;

    try {
      setIsExporting(true);
      setExportProgress(0);
      setExportStatus('Preparing progress-bar export...');

      for (let index = 0; index < sortedStyles.length; index += 1) {
        const style = sortedStyles[index];
        await exportProgressBarWithWebCodecs({
          style,
          durationSeconds: previewDuration,
          renderMode,
          progressLabel,
          settings: {
            exportResolution: settings.exportResolution,
            exportBitrateMbps: settings.exportBitrateMbps,
            exportCodec: settings.exportCodec
          },
          onProgress: (progress, status) => {
            const overall = (index + clamp(progress, 0, 1)) / total;
            setExportProgress(overall);
            const label = status || 'Encoding';
            setExportStatus(`${styleLabel(style)} (${index + 1}/${total}) - ${label}`);
          }
        });
      }

      setExportProgress(1);
      setExportStatus('Progress-bar export complete');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Progress-bar export failed.';
      if (message === 'Export canceled') {
        setExportProgress(0);
        setExportStatus('Export canceled');
      } else {
        setExportStatus('');
        alert(message);
      }
    } finally {
      setIsExporting(false);
    }
  };

  const handleCancelExport = () => {
    cancelProgressBarExport();
  };

  return (
    <div className="w-full max-w-5xl mx-auto p-4 sm:p-6">
      <div className="bg-white border-4 border-black rounded-2xl shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
        <div className="bg-[#B7F7D2] p-4 sm:p-6 border-b-4 border-black flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3 sm:items-center">
            <button
              onClick={onBack}
              className="p-2 bg-white border-2 border-black rounded-lg hover:bg-black hover:text-white transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
            >
              <ArrowLeft size={22} strokeWidth={3} />
            </button>
            <div>
              <h2 className="text-2xl sm:text-3xl font-black font-display uppercase tracking-tight text-black">
                Progress Bar Mode
              </h2>
              <p className="text-sm font-bold text-slate-700">
                Export classic bars or text-fill countdowns for selected styles. Preview choices sync into the active video package as a generated progress source.
              </p>
            </div>
          </div>
          <div className="self-start px-3 py-1 bg-black text-white rounded-lg text-xs font-black uppercase sm:self-auto">
            {selectedStyles.length} Style{selectedStyles.length === 1 ? '' : 's'} Selected
          </div>
        </div>

        <div className="p-4 sm:p-6 md:p-8 space-y-6 sm:space-y-8">
          <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-6">
            <div className="space-y-4 p-4 sm:p-6 bg-[#F8FDFF] border-4 border-black rounded-xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-lg font-black uppercase">Live Preview</h3>
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                  <button
                    onClick={() => setIsPreviewPlaying((value) => !value)}
                    className="inline-flex items-center gap-2 px-3 py-2 bg-white border-2 border-black rounded-lg text-xs font-black uppercase hover:bg-slate-100"
                  >
                    {isPreviewPlaying ? <Pause size={14} /> : <Play size={14} />}
                    <span>{isPreviewPlaying ? 'Pause' : 'Play'}</span>
                  </button>
                  <select
                    value={previewStyle}
                    onChange={(event) => applyGeneratedPreviewStyle(event.target.value as ProgressBarVisualStyle)}
                    className="w-full px-3 py-2 bg-white border-2 border-black rounded-lg text-xs font-black uppercase sm:w-auto"
                  >
                    {selectedStyles.map((style) => (
                      <option key={style} value={style}>
                        {styleLabel(style)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div
                className="rounded-xl border-4 border-black p-5 space-y-4"
                style={{
                  background: `linear-gradient(140deg, ${previewTheme.rootBg} 0%, ${previewTheme.gameBg} 100%)`
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="text-sm font-black uppercase" style={{ color: previewTheme.headerText }}>
                    {styleLabel(previewStyle)} Progress
                  </div>
                  <div
                    className="px-3 py-1 rounded-lg border-2 border-black text-xs font-black tabular-nums"
                    style={{ backgroundColor: previewTheme.timerBg, color: previewTheme.timerText }}
                  >
                    {remainingSeconds.toFixed(1)}s
                  </div>
                </div>

                {renderMode === 'text_fill' ? (
                  <div
                    className="w-full h-16 border-2 border-black overflow-hidden rounded-xl bg-white/55 px-3 py-2"
                    style={{
                      borderColor: previewTheme.progressTrackBorder
                    }}
                  >
                    <TextFillProgressPreview
                      style={previewStyle}
                      theme={previewTheme}
                      label={progressLabel}
                      remainingRatio={remainingRatio}
                      width={720}
                      height={56}
                      animationSeconds={previewTime}
                    />
                  </div>
                ) : (
                  <div
                    className="w-full h-8 border-2 border-black overflow-hidden"
                    style={{
                      background: previewTheme.progressTrackBg,
                      borderColor: previewTheme.progressTrackBorder,
                      borderRadius: previewTheme.progressTrackClass.includes('rounded-none') ? 0 : 9999
                    }}
                  >
                    <div
                      className="h-full transition-[width] duration-75"
                      style={{
                        width: `${Math.max(0, Math.min(100, remainingRatio * 100))}%`,
                        background: resolveProgressBarFillStyle(previewStyle, remainingRatio, previewTheme),
                        boxShadow: previewTheme.progressFillGlow || 'none'
                      }}
                    />
                  </div>
                )}

                <div className="text-center text-xs font-black uppercase tracking-wide" style={{ color: previewTheme.headerSubText }}>
                  {Math.round(remainingRatio * 100)}% Left
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs font-black uppercase">
                  <span>Preview Position</span>
                  <span className="tabular-nums">{previewTime.toFixed(2)}s / {previewDuration.toFixed(2)}s</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={previewDuration}
                  step={0.01}
                  value={previewTime}
                  onChange={(event) => setPreviewTime(Number(event.target.value))}
                  className="w-full h-4 border-2 border-black rounded-full accent-black"
                />
              </div>
            </div>

            <div className="space-y-5 p-4 sm:p-6 bg-[#FFFDF5] border-4 border-black rounded-xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
              <h3 className="text-lg font-black uppercase border-b-4 border-black pb-2">Duration + Export</h3>

              <div className="space-y-3">
                <label className="block font-bold uppercase text-sm">Bar Type</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => applyGeneratedRenderMode('bar')}
                    className={`py-2 px-2 rounded-lg border-2 border-black font-bold text-xs uppercase transition-all ${
                      renderMode === 'bar'
                        ? 'bg-[#4ECDC4] text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
                        : 'bg-white hover:bg-slate-100'
                    }`}
                  >
                    Standard Bar
                  </button>
                  <button
                    onClick={() => applyGeneratedRenderMode('text_fill')}
                    className={`py-2 px-2 rounded-lg border-2 border-black font-bold text-xs uppercase transition-all ${
                      renderMode === 'text_fill'
                        ? 'bg-[#FFD93D] text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
                        : 'bg-white hover:bg-slate-100'
                    }`}
                  >
                    Text Fill
                  </button>
                </div>
                {renderMode === 'text_fill' && (
                  <div className="space-y-2">
                    <label className="block font-bold uppercase text-sm">Progress Phrase</label>
                    <textarea
                      value={progressLabel}
                      onChange={(event) => applyProgressLabel(event.target.value)}
                      rows={2}
                      className="w-full resize-none rounded-lg border-2 border-black bg-white px-3 py-2 font-bold uppercase"
                      placeholder="SPOT THE 3 DIFFERENCES"
                    />
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-600">
                      Text Fill drains from right to left and shifts to warning colors near the end.
                    </p>
                  </div>
                )}
              </div>

              <div>
                <div className="flex justify-between mb-2 font-bold">
                  <span>Duration (Seconds)</span>
                  <span className="bg-black text-white px-2 rounded tabular-nums">{previewDuration.toFixed(1)}s</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="120"
                  step="0.5"
                  value={durationSeconds}
                  onChange={(event) => setDurationSeconds(Number(event.target.value))}
                  className="w-full h-4 bg-slate-200 rounded-full appearance-none cursor-pointer border-2 border-black accent-black"
                />
                <DeferredNumberInput
                  min="0.5"
                  max="120"
                  step="0.5"
                  value={durationSeconds}
                  onValueChange={(value) => setDurationSeconds(clamp(value, 0.5, 120))}
                  className="mt-3 w-full px-3 py-2 bg-white border-2 border-black rounded-lg font-bold"
                />
              </div>

              <div>
                <label className="block font-bold mb-2 uppercase text-sm">Resolution</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(['720p', '1080p', '1440p', '2160p'] as const).map((value) => (
                    <button
                      key={value}
                      onClick={() =>
                        onSettingsChange((current) => ({
                          ...current,
                          exportResolution: value
                        }))
                      }
                      className={`py-2 px-2 rounded-lg border-2 border-black font-bold text-xs uppercase transition-all ${
                        settings.exportResolution === value
                          ? 'bg-[#4ECDC4] text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
                          : 'bg-white hover:bg-slate-100'
                      }`}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block font-bold mb-2 uppercase text-sm">Codec</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(['h264', 'av1'] as const).map((codec) => (
                    <button
                      key={codec}
                      onClick={() =>
                        onSettingsChange((current) => ({
                          ...current,
                          exportCodec: codec
                        }))
                      }
                      className={`py-2 px-2 rounded-lg border-2 border-black font-bold text-xs uppercase transition-all ${
                        settings.exportCodec === codec
                          ? 'bg-[#FFD93D] text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
                          : 'bg-white hover:bg-slate-100'
                      }`}
                    >
                      {codec.toUpperCase()}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                  Transparent background is best supported with AV1 (WebM).
                </p>
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
                  onChange={(event) =>
                    onSettingsChange((current) => ({
                      ...current,
                      exportBitrateMbps: Number(event.target.value)
                    }))
                  }
                  className="w-full h-4 bg-slate-200 rounded-full appearance-none cursor-pointer border-2 border-black accent-black"
                />
              </div>

              <div className="space-y-2">
                <button
                  onClick={handleExport}
                  disabled={isExporting || selectedStyles.length === 0}
                  className={`w-full px-4 py-3 border-4 border-black rounded-xl text-sm font-black uppercase tracking-wide flex items-center justify-center gap-2 transition-all ${
                    isExporting || selectedStyles.length === 0
                      ? 'bg-slate-300 text-slate-700 cursor-not-allowed'
                      : 'bg-white text-black hover:bg-[#A7F3D0] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]'
                  }`}
                >
                  <Download size={18} strokeWidth={3} />
                  <span>Download Selected ({selectedStyles.length})</span>
                </button>
                {isExporting && (
                  <button
                    onClick={handleCancelExport}
                    className="w-full px-4 py-2 border-2 border-black rounded-lg text-xs font-black uppercase bg-white hover:bg-red-50"
                  >
                    Cancel Export
                  </button>
                )}
                {(isExporting || exportStatus) && (
                  <div className="space-y-2">
                    <div className="text-[11px] font-black uppercase text-slate-700">{exportStatus || 'Working...'}</div>
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
          </div>

          <div className="space-y-4 p-4 sm:p-6 bg-[#EEF9FF] border-4 border-black rounded-xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-lg font-black uppercase">Progress Bar Types</h3>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                <button
                  onClick={() => {
                    setSelectedStyles(styleOptions);
                    if (!styleOptions.includes(previewStyle)) {
                      applyGeneratedPreviewStyle(styleOptions[0]);
                    }
                  }}
                  className="px-3 py-2 bg-white border-2 border-black rounded-lg text-xs font-black uppercase hover:bg-slate-100"
                >
                  Select All
                </button>
                <button
                  onClick={() => {
                    setSelectedStyles([previewStyle]);
                  }}
                  className="px-3 py-2 bg-white border-2 border-black rounded-lg text-xs font-black uppercase hover:bg-slate-100"
                >
                  Keep Preview Only
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {styleOptions.map((style) => {
                const theme = PROGRESS_BAR_THEMES[style];
                const isSelected = selectedStyles.includes(style);
                return (
                  <button
                    key={style}
                    onClick={() => toggleStyleSelection(style)}
                    onDoubleClick={() => applyGeneratedPreviewStyle(style)}
                    className={`p-3 border-2 border-black rounded-xl text-left transition-all ${
                      isSelected
                        ? 'bg-[#A7F3D0] shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
                        : 'bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-black uppercase">{styleLabel(style)}</div>
                      {isSelected ? <Check size={16} strokeWidth={3} /> : <Square size={14} strokeWidth={3} />}
                    </div>
                    {renderMode === 'text_fill' ? (
                      <div className="h-10 rounded-lg border-2 border-black bg-white/80 px-2 py-1">
                        <TextFillProgressPreview
                          style={style}
                          theme={theme}
                          label={progressLabel}
                          remainingRatio={0.72}
                          width={220}
                          height={34}
                          animationSeconds={1.6}
                        />
                      </div>
                    ) : (
                      <div
                        className="h-4 border-2 border-black overflow-hidden"
                        style={{
                          background: theme.progressTrackBg,
                          borderColor: theme.progressTrackBorder,
                          borderRadius: theme.progressTrackClass.includes('rounded-none') ? 0 : 9999
                        }}
                      >
                        <div
                          className="h-full"
                          style={{
                            width: '72%',
                            background: resolveProgressBarFillStyle(style, 0.72, theme),
                            boxShadow: theme.progressFillGlow || 'none'
                          }}
                        />
                      </div>
                    )}
                    <div className="mt-2 text-[10px] font-bold uppercase text-slate-600">Double-click to preview</div>
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
