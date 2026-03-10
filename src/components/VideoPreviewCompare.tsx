import React, { useEffect, useMemo, useState } from 'react';
import { Puzzle, VideoSettings } from '../types';
import { renderVideoFramePreview } from '../services/videoExport';
import { VideoPlayer } from './VideoPlayer';

type ExportPreviewMoment = 'intro' | 'showing' | 'revealing' | 'transitioning' | 'outro';
type PreviewStatus = 'idle' | 'loading' | 'ready' | 'error';

interface VideoPreviewCompareProps {
  puzzles: Puzzle[];
  settings: VideoSettings;
  heightStyle: string;
}

const PREVIEW_MOMENT_OPTIONS: Array<{ value: ExportPreviewMoment; label: string }> = [
  { value: 'intro', label: 'Intro' },
  { value: 'showing', label: 'Play' },
  { value: 'revealing', label: 'Reveal' },
  { value: 'transitioning', label: 'Transition' },
  { value: 'outro', label: 'Outro' }
];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const isMomentAvailable = (
  moment: ExportPreviewMoment,
  puzzleIndex: number,
  puzzleCount: number,
  settings: VideoSettings
) => {
  if (moment === 'intro') {
    return settings.sceneSettings.introEnabled && settings.sceneSettings.introDuration > 0;
  }
  if (moment === 'outro') {
    return settings.sceneSettings.outroEnabled && settings.sceneSettings.outroDuration > 0;
  }
  if (moment === 'transitioning') {
    return settings.transitionDuration > 0 && puzzleIndex < puzzleCount - 1;
  }
  return puzzleCount > 0;
};

const resolveValidMoment = (
  moment: ExportPreviewMoment,
  puzzleIndex: number,
  puzzleCount: number,
  settings: VideoSettings
): ExportPreviewMoment => {
  if (isMomentAvailable(moment, puzzleIndex, puzzleCount, settings)) {
    return moment;
  }

  for (const fallback of ['showing', 'revealing', 'transitioning', 'intro', 'outro'] as const) {
    if (isMomentAvailable(fallback, puzzleIndex, puzzleCount, settings)) {
      return fallback;
    }
  }

  return 'showing';
};

const getPreviewTimestamp = (
  settings: VideoSettings,
  puzzleCount: number,
  puzzleIndex: number,
  moment: ExportPreviewMoment
) => {
  const introDuration = settings.sceneSettings.introEnabled ? Math.max(0, settings.sceneSettings.introDuration) : 0;
  const outroDuration = settings.sceneSettings.outroEnabled ? Math.max(0, settings.sceneSettings.outroDuration) : 0;
  const showDuration = Math.max(0.1, settings.showDuration);
  const revealDuration = Math.max(0.5, settings.revealDuration);
  const transitionDuration = Math.max(0, settings.transitionDuration);
  const safePuzzleCount = Math.max(1, puzzleCount);
  const safePuzzleIndex = clamp(puzzleIndex, 0, safePuzzleCount - 1);
  const puzzleStart = introDuration + safePuzzleIndex * (showDuration + revealDuration + transitionDuration);

  if (moment === 'intro') {
    return introDuration > 0 ? introDuration * 0.5 : 0;
  }

  if (moment === 'showing') {
    return puzzleStart + Math.min(showDuration * 0.5, Math.max(0.04, showDuration - 0.04));
  }

  if (moment === 'revealing') {
    return puzzleStart + showDuration + Math.min(revealDuration * 0.65, Math.max(0.08, revealDuration - 0.08));
  }

  if (moment === 'transitioning') {
    return puzzleStart + showDuration + revealDuration + Math.min(transitionDuration * 0.5, Math.max(0.04, transitionDuration - 0.04));
  }

  const outroStart =
    introDuration +
    safePuzzleCount * showDuration +
    safePuzzleCount * revealDuration +
    Math.max(0, safePuzzleCount - 1) * transitionDuration;

  return outroDuration > 0 ? outroStart + outroDuration * 0.5 : puzzleStart + showDuration + revealDuration * 0.5;
};

export const VideoPreviewCompare: React.FC<VideoPreviewCompareProps> = ({
  puzzles,
  settings,
  heightStyle
}) => {
  const [previewMoment, setPreviewMoment] = useState<ExportPreviewMoment>(() =>
    settings.sceneSettings.introEnabled ? 'intro' : 'showing'
  );
  const [previewPuzzleIndex, setPreviewPuzzleIndex] = useState(0);
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>('idle');
  const [previewError, setPreviewError] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const maxPuzzleIndex = Math.max(0, puzzles.length - 1);

  useEffect(() => {
    setPreviewPuzzleIndex((current) => Math.min(current, maxPuzzleIndex));
  }, [maxPuzzleIndex]);

  useEffect(() => {
    const nextMoment = resolveValidMoment(previewMoment, previewPuzzleIndex, puzzles.length, settings);
    if (nextMoment !== previewMoment) {
      setPreviewMoment(nextMoment);
    }
  }, [previewMoment, previewPuzzleIndex, puzzles.length, settings]);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const safeMoment = resolveValidMoment(previewMoment, previewPuzzleIndex, puzzles.length, settings);
  const previewTimestamp = useMemo(
    () => getPreviewTimestamp(settings, puzzles.length, previewPuzzleIndex, safeMoment),
    [settings, puzzles.length, previewPuzzleIndex, safeMoment]
  );

  useEffect(() => {
    if (puzzles.length === 0) {
      setPreviewStatus('idle');
      setPreviewError('');
      setPreviewUrl((current) => {
        if (current) {
          URL.revokeObjectURL(current);
        }
        return null;
      });
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setPreviewStatus('loading');
      setPreviewError('');

      try {
        const result = await renderVideoFramePreview({
          puzzles,
          settings,
          timestamp: previewTimestamp,
          signal: controller.signal
        });
        const nextUrl = URL.createObjectURL(result.blob);

        if (controller.signal.aborted) {
          URL.revokeObjectURL(nextUrl);
          return;
        }

        setPreviewUrl((current) => {
          if (current) {
            URL.revokeObjectURL(current);
          }
          return nextUrl;
        });
        setPreviewStatus('ready');
      } catch (error) {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
          return;
        }

        setPreviewStatus('error');
        setPreviewError(error instanceof Error ? error.message : 'Failed to render export preview.');
      }
    }, 180);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [previewTimestamp, puzzles, settings]);

  const activeMomentLabel =
    PREVIEW_MOMENT_OPTIONS.find((option) => option.value === safeMoment)?.label ?? 'Play';
  const puzzleLabel =
    safeMoment === 'intro' || safeMoment === 'outro'
      ? `${activeMomentLabel} frame`
      : `Puzzle ${previewPuzzleIndex + 1} ${activeMomentLabel.toLowerCase()}`;

  return (
    <section className="bg-white border-4 border-black rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] p-4 md:p-5 space-y-4">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="text-lg font-black uppercase">Preview Compare</h3>
          <p className="text-[10px] font-bold uppercase text-slate-600">
            Left is live playback. Right is a real frame rendered through the export worker.
          </p>
        </div>
        <span className="px-2 py-1 border-2 border-black rounded-full text-[10px] font-black uppercase bg-[#F8FAFC]">
          {settings.aspectRatio} / {settings.exportResolution}
        </span>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="space-y-3">
          <div>
            <div className="text-xs font-black uppercase">Video Preview</div>
            <div className="text-[10px] font-bold uppercase text-slate-600">Interactive playback inside the app</div>
          </div>

          <div className="w-full border-2 border-black rounded-xl overflow-hidden bg-black/5" style={{ height: heightStyle }}>
            {puzzles.length > 0 ? (
              <VideoPlayer puzzles={puzzles} settings={settings} embedded onExit={() => {}} />
            ) : (
              <div className="h-full flex items-center justify-center text-[11px] font-black uppercase text-slate-600 px-4 text-center">
                Add at least one puzzle to see the preview compare.
              </div>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-xs font-black uppercase">Export Look Preview</div>
              <div className="text-[10px] font-bold uppercase text-slate-600">Actual frame styling from the export renderer</div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {PREVIEW_MOMENT_OPTIONS.map((option) => {
                const disabled = !isMomentAvailable(option.value, previewPuzzleIndex, puzzles.length, settings);
                const selected = safeMoment === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setPreviewMoment(option.value)}
                    disabled={disabled}
                    className={`px-3 py-2 border-2 border-black rounded-lg text-[10px] font-black uppercase ${
                      selected
                        ? 'bg-[#FFD93D] shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
                        : disabled
                        ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                        : 'bg-white hover:bg-slate-100'
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_180px] gap-3">
            <label className="block">
              <span className="block text-[10px] font-black uppercase text-slate-600 mb-1">Puzzle</span>
              <select
                value={previewPuzzleIndex}
                onChange={(event) => setPreviewPuzzleIndex(Number(event.target.value))}
                disabled={puzzles.length === 0}
                className="w-full px-3 py-2 border-2 border-black rounded-lg bg-white text-xs font-black uppercase"
              >
                {puzzles.length === 0 ? (
                  <option value={0}>No puzzles</option>
                ) : (
                  puzzles.map((_, index) => (
                    <option key={index} value={index}>
                      Puzzle {index + 1}
                    </option>
                  ))
                )}
              </select>
            </label>

            <div className="border-2 border-black rounded-lg bg-[#F8FDFF] px-3 py-2 flex flex-col justify-center">
              <div className="text-[10px] font-black uppercase text-slate-600">Frame</div>
              <div className="text-xs font-black uppercase text-slate-900">{puzzleLabel}</div>
            </div>
          </div>

          <div className="w-full border-2 border-black rounded-xl overflow-hidden bg-black/5" style={{ height: heightStyle }}>
            {puzzles.length === 0 ? (
              <div className="h-full flex items-center justify-center text-[11px] font-black uppercase text-slate-600 px-4 text-center">
                Add at least one puzzle to render an export-accurate frame.
              </div>
            ) : previewStatus === 'error' ? (
              <div className="h-full flex items-center justify-center px-4 text-center">
                <div>
                  <div className="text-[11px] font-black uppercase text-red-600">Preview failed</div>
                  <div className="mt-2 text-[10px] font-bold uppercase text-slate-600">{previewError}</div>
                </div>
              </div>
            ) : previewUrl ? (
              <img
                src={previewUrl}
                alt="Export frame preview"
                className="h-full w-full object-contain bg-white"
              />
            ) : (
              <div className="h-full flex items-center justify-center text-[11px] font-black uppercase text-slate-600 px-4 text-center">
                {previewStatus === 'loading' ? 'Rendering export frame...' : 'Preparing export preview...'}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
