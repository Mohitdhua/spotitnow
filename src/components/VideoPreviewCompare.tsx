import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Pause, Play, Plus, RotateCcw, SkipForward, Trash2 } from 'lucide-react';
import { Puzzle, VideoSettings } from '../types';
import { renderVideoFramePreview } from '../services/videoExport';
import {
  VideoPlayer,
  type VideoPlayerExternalControlAction,
  type VideoPlayerPlaybackState
} from './VideoPlayer';

type ExportPreviewMoment = 'intro' | 'showing' | 'revealing' | 'transitioning' | 'outro';
type PreviewStatus = 'idle' | 'loading' | 'ready' | 'error';
export type PreviewSetupTab = 'package' | 'theme' | 'audio';
export type PreviewOutputTab = 'text' | 'motion' | 'layout' | 'export';
export type PreviewMobileTab = PreviewSetupTab | PreviewOutputTab;

type WorkspaceOption<T extends string> = {
  value: T;
  label: string;
};

interface PreviewMonitorStageProps {
  puzzles: Puzzle[];
  settings: VideoSettings;
  usesStackedStage: boolean;
  frameShellStyle: React.CSSProperties;
  liveControlAction: VideoPlayerExternalControlAction | null;
  onPlaybackStateChange: (state: VideoPlayerPlaybackState) => void;
  livePreviewStatus: PreviewStatus;
  onLiveRenderReadyChange: (ready: boolean) => void;
  previewStatus: PreviewStatus;
  previewError: string;
  previewUrl: string | null;
}

interface VideoPreviewCompareProps {
  puzzles: Puzzle[];
  settings: VideoSettings;
  heightStyle: string;
  activeMobileTab: PreviewMobileTab;
  activeSetupTab: PreviewSetupTab;
  onSelectSetupTab: (tab: PreviewSetupTab) => void;
  activeOutputTab: PreviewOutputTab;
  onSelectOutputTab: (tab: PreviewOutputTab) => void;
  onBack: () => void;
  onAddPuzzles: () => void;
  onClearBatch: () => void;
  onStart: () => void;
  activeVideoPackageId: string;
  packageOptions: Array<{ id: string; name: string }>;
  onSelectVideoPackage: (packageId: string) => void;
  themeOptions: Array<WorkspaceOption<VideoSettings['visualStyle']>>;
  onVisualStyleChange: (style: VideoSettings['visualStyle']) => void;
  onShowProgressChange: (show: boolean) => void;
  onGeneratedProgressEnabledChange: (enabled: boolean) => void;
  selectedStyleLabel: string;
  selectedProgressStyleLabel: string;
  selectedProgressMotionLabel: string;
  setupPanelChildren?: React.ReactNode;
  outputPanelChildren?: React.ReactNode;
}

interface PreviewFrameProps {
  mode: 'live' | 'export';
  puzzles: Puzzle[];
  settings: VideoSettings;
  liveControlAction: VideoPlayerExternalControlAction | null;
  onPlaybackStateChange: (state: VideoPlayerPlaybackState) => void;
  livePreviewStatus: PreviewStatus;
  onLiveRenderReadyChange: (ready: boolean) => void;
  previewStatus: PreviewStatus;
  previewError: string;
  previewUrl: string | null;
  className: string;
  style?: React.CSSProperties;
}

const PREVIEW_MOMENT_OPTIONS: Array<{ value: ExportPreviewMoment; label: string }> = [
  { value: 'intro', label: 'Intro' },
  { value: 'showing', label: 'Play' },
  { value: 'revealing', label: 'Reveal' },
  { value: 'transitioning', label: 'Transition' },
  { value: 'outro', label: 'Outro' }
];

const SETUP_TABS: Array<{ value: PreviewSetupTab; label: string }> = [
  { value: 'package', label: 'Package' },
  { value: 'theme', label: 'Theme' },
  { value: 'audio', label: 'Audio' }
];

const OUTPUT_TABS: Array<{ value: PreviewOutputTab; label: string }> = [
  { value: 'text', label: 'Text' },
  { value: 'layout', label: 'Layout' },
  { value: 'motion', label: 'Motion' },
  { value: 'export', label: 'Export' }
];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

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

const isMomentAvailable = (
  moment: ExportPreviewMoment,
  puzzleIndex: number,
  puzzleCount: number,
  settings: VideoSettings
) => {
  if (moment === 'intro') {
    return resolveIntroDuration(settings) > 0;
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
  const introDuration = resolveIntroDuration(settings);
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

const PreviewFrame: React.FC<PreviewFrameProps> = ({
  mode,
  puzzles,
  settings,
  liveControlAction,
  onPlaybackStateChange,
  livePreviewStatus,
  onLiveRenderReadyChange,
  previewStatus,
  previewError,
  previewUrl,
  className,
  style
}) => {
  const showLiveRendering = mode === 'live' && livePreviewStatus === 'loading';

  return (
    <div className={className} style={style} data-preview-frame={mode}>
      {mode === 'live' ? (
        puzzles.length > 0 ? (
          <>
            <div className={showLiveRendering ? 'invisible h-full w-full' : 'h-full w-full'}>
              <span className="absolute left-2 top-2 z-10 h-3 w-3 rounded-full border border-black bg-[#EF4444] shadow-[0_0_0_2px_rgba(255,255,255,0.95)] animate-pulse" />
              <VideoPlayer
                puzzles={puzzles}
                settings={settings}
                embedded
                hidePlaybackControls
                externalControlAction={liveControlAction}
                onPlaybackStateChange={onPlaybackStateChange}
                onRenderReadyChange={onLiveRenderReadyChange}
                onExit={() => {}}
              />
            </div>
            {showLiveRendering ? (
              <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-[11px] font-black uppercase text-slate-600">
                Rendering...
              </div>
            ) : null}
          </>
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-center text-[11px] font-black uppercase text-slate-600">
            Add puzzles for live preview.
          </div>
        )
      ) : puzzles.length === 0 ? (
        <div className="flex h-full items-center justify-center px-4 text-center text-[11px] font-black uppercase text-slate-600">
          Add puzzles for export preview.
        </div>
      ) : previewStatus === 'error' ? (
        <div className="flex h-full items-center justify-center px-4 text-center">
          <div>
            <div className="text-[11px] font-black uppercase text-red-600">Preview failed</div>
            <div className="mt-2 text-[10px] font-bold uppercase text-slate-600">{previewError}</div>
          </div>
        </div>
      ) : previewUrl ? (
        <img src={previewUrl} alt="Export frame preview" className="block h-full w-full bg-white object-contain" />
      ) : (
        <div className="flex h-full items-center justify-center px-4 text-center text-[11px] font-black uppercase text-slate-600">
          {previewStatus === 'loading' ? 'Rendering...' : 'Preparing...'}
        </div>
      )}
    </div>
  );
};

const PreviewMonitorStage = React.memo(
  ({
    puzzles,
    settings,
    usesStackedStage,
    frameShellStyle,
    liveControlAction,
    onPlaybackStateChange,
    livePreviewStatus,
    onLiveRenderReadyChange,
    previewStatus,
    previewError,
    previewUrl
  }: PreviewMonitorStageProps) => (
    <div className="flex h-full w-full items-center justify-center overflow-hidden">
      <div className="inline-flex max-w-full flex-none items-center justify-center">
        <div
          className={`flex items-start justify-center gap-1 ${
            usesStackedStage ? 'flex-col' : 'flex-row'
          }`}
        >
          <div className="flex min-w-0 flex-none flex-col items-center">
            <PreviewFrame
              mode="live"
              puzzles={puzzles}
              settings={settings}
              liveControlAction={liveControlAction}
              onPlaybackStateChange={onPlaybackStateChange}
              livePreviewStatus={livePreviewStatus}
              onLiveRenderReadyChange={onLiveRenderReadyChange}
              previewStatus={previewStatus}
              previewError={previewError}
              previewUrl={previewUrl}
              className="relative flex-none overflow-hidden"
              style={frameShellStyle}
            />
          </div>

          <div className="flex min-w-0 flex-none flex-col items-center">
            <PreviewFrame
              mode="export"
              puzzles={puzzles}
              settings={settings}
              liveControlAction={liveControlAction}
              onPlaybackStateChange={onPlaybackStateChange}
              livePreviewStatus={livePreviewStatus}
              onLiveRenderReadyChange={onLiveRenderReadyChange}
              previewStatus={previewStatus}
              previewError={previewError}
              previewUrl={previewUrl}
              className="relative flex-none overflow-hidden"
              style={frameShellStyle}
            />
          </div>
        </div>
      </div>
    </div>
  )
);

PreviewMonitorStage.displayName = 'PreviewMonitorStage';

export const VideoPreviewCompare: React.FC<VideoPreviewCompareProps> = ({
  puzzles,
  settings,
  heightStyle,
  activeMobileTab,
  activeSetupTab,
  onSelectSetupTab,
  activeOutputTab,
  onSelectOutputTab,
  onBack,
  onAddPuzzles,
  onClearBatch,
  onStart,
  activeVideoPackageId,
  packageOptions,
  onSelectVideoPackage,
  themeOptions,
  onVisualStyleChange,
  onShowProgressChange,
  onGeneratedProgressEnabledChange,
  selectedStyleLabel,
  selectedProgressStyleLabel,
  selectedProgressMotionLabel,
  setupPanelChildren,
  outputPanelChildren
}) => {
  const [previewMoment, setPreviewMoment] = useState<ExportPreviewMoment>(() =>
    resolveIntroDuration(settings) > 0 ? 'intro' : 'showing'
  );
  const [previewPuzzleIndex, setPreviewPuzzleIndex] = useState(0);
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>('idle');
  const [previewError, setPreviewError] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [livePreviewStatus, setLivePreviewStatus] = useState<PreviewStatus>(() =>
    puzzles.length > 0 ? 'ready' : 'idle'
  );
  const [committedPreviewSettings, setCommittedPreviewSettings] = useState(settings);
  const [livePlaybackState, setLivePlaybackState] = useState<VideoPlayerPlaybackState>(() => ({
    hasPuzzles: puzzles.length > 0,
    isPlaying: puzzles.length > 0,
    phase: resolveIntroDuration(settings) > 0 ? 'intro' : 'showing',
    puzzleIndex: 0
  }));
  const [liveControlAction, setLiveControlAction] = useState<VideoPlayerExternalControlAction | null>(null);
  const livePreviewSettings = settings;
  const lastLiveAspectRatioRef = useRef<VideoSettings['aspectRatio']>(settings.aspectRatio);
  const lastPreviewAspectRatioRef = useRef<VideoSettings['aspectRatio']>(settings.aspectRatio);
  const previewUrlRef = useRef<string | null>(null);

  const maxPuzzleIndex = Math.max(0, puzzles.length - 1);
  const handleLiveRenderReadyChange = useCallback((ready: boolean) => {
    setLivePreviewStatus((current) => {
      const nextStatus = ready ? 'ready' : 'loading';
      return current === nextStatus ? current : nextStatus;
    });
  }, []);

  useEffect(() => {
    setPreviewPuzzleIndex((current) => Math.min(current, maxPuzzleIndex));
  }, [maxPuzzleIndex]);

  useEffect(() => {
    if (puzzles.length === 0) {
      setLivePreviewStatus('idle');
      lastLiveAspectRatioRef.current = settings.aspectRatio;
      return;
    }

    if (lastLiveAspectRatioRef.current !== settings.aspectRatio) {
      lastLiveAspectRatioRef.current = settings.aspectRatio;
      setLivePreviewStatus('loading');
    }
  }, [puzzles.length, settings.aspectRatio]);

  useEffect(() => {
    const nextMoment = resolveValidMoment(previewMoment, previewPuzzleIndex, puzzles.length, settings);
    if (nextMoment !== previewMoment) {
      setPreviewMoment(nextMoment);
    }
  }, [previewMoment, previewPuzzleIndex, puzzles.length, settings]);

  useEffect(() => {
    if (puzzles.length > 0) return;
    setLivePlaybackState({
      hasPuzzles: false,
      isPlaying: false,
      phase: resolveIntroDuration(settings) > 0 ? 'intro' : 'showing',
      puzzleIndex: 0
    });
  }, [puzzles.length, settings]);

  useEffect(() => {
    previewUrlRef.current = previewUrl;
  }, [previewUrl]);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  useEffect(() => {
    setCommittedPreviewSettings(settings);
  }, [settings]);

  const safeMoment = resolveValidMoment(previewMoment, previewPuzzleIndex, puzzles.length, settings);
  const committedMoment = resolveValidMoment(
    previewMoment,
    previewPuzzleIndex,
    puzzles.length,
    committedPreviewSettings
  );
  const previewTimestamp = useMemo(
    () => getPreviewTimestamp(committedPreviewSettings, puzzles.length, previewPuzzleIndex, committedMoment),
    [committedPreviewSettings, puzzles.length, previewPuzzleIndex, committedMoment]
  );

  useEffect(() => {
    if (puzzles.length === 0) {
      return;
    }

    if (lastPreviewAspectRatioRef.current !== settings.aspectRatio) {
      lastPreviewAspectRatioRef.current = settings.aspectRatio;
      setPreviewStatus('loading');
      setPreviewError('');
      setPreviewUrl((current) => {
        if (current) {
          URL.revokeObjectURL(current);
        }
        return null;
      });
    }
  }, [puzzles.length, settings.aspectRatio]);

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
      if (!previewUrlRef.current) {
        setPreviewStatus('loading');
      }
      setPreviewError('');

      try {
        const result = await renderVideoFramePreview({
          puzzles,
          settings: committedPreviewSettings,
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
    }, 80);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [committedPreviewSettings, previewTimestamp, puzzles]);

  const usesStackedStage = settings.aspectRatio === '16:9';
  const previewAspectRatio = settings.aspectRatio === '16:9' ? 16 / 9 : 9 / 16;
  const frameShellStyle = useMemo<React.CSSProperties>(
    () => ({
      aspectRatio: `${previewAspectRatio}`,
      height: heightStyle,
      width: 'auto',
      maxWidth: '100%',
      minWidth: 0,
      flex: '0 0 auto'
    }),
    [heightStyle, previewAspectRatio]
  );
  const mobileFrameStyle = useMemo<React.CSSProperties>(
    () => ({
      aspectRatio: `${previewAspectRatio}`,
      height: '100%',
      width: 'auto',
      maxWidth: '100%',
      maxHeight: '100%',
      marginInline: 'auto'
    }),
    [previewAspectRatio]
  );
  const mobilePreviewRailStyle = useMemo<React.CSSProperties>(
    () => ({
      height: '30dvh',
      gridTemplateColumns: usesStackedStage ? 'minmax(0, 1fr)' : 'repeat(2, minmax(0, 1fr))',
      gridTemplateRows: usesStackedStage ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)'
    }),
    [usesStackedStage]
  );
  const selectClass =
    'h-10 w-full rounded-xl border-2 border-black bg-white px-4 text-sm font-black text-slate-900 outline-none';
  const issueLiveControl = (kind: VideoPlayerExternalControlAction['kind']) => {
    setLiveControlAction((current) => ({ kind, nonce: (current?.nonce ?? 0) + 1 }));
  };
  const showingSetupPanel =
    activeMobileTab === 'package' || activeMobileTab === 'theme' || activeMobileTab === 'audio';

  return (
    <section className="h-full min-h-0 bg-white">
      <div className="flex h-full min-h-0 flex-col bg-[#F6F2E8] sm:hidden">
        <div className="shrink-0 border-b border-black/15 bg-[#F6F2E8] px-1.5 py-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onBack}
              aria-label="Back"
              className="inline-flex h-10 w-10 items-center justify-center rounded-[14px] border-2 border-black bg-white text-slate-900"
            >
              <ArrowLeft size={17} strokeWidth={2.8} />
            </button>
            <button
              type="button"
              onClick={() => issueLiveControl('toggle-play')}
              aria-label={livePlaybackState.isPlaying ? 'Pause preview' : 'Play preview'}
              disabled={puzzles.length === 0}
              className={`inline-flex h-10 w-10 items-center justify-center rounded-[14px] border-2 border-black ${
                puzzles.length === 0 ? 'bg-slate-100 text-slate-400' : 'bg-white text-slate-700'
              }`}
            >
              {livePlaybackState.isPlaying ? <Pause size={16} strokeWidth={2.8} /> : <Play size={16} strokeWidth={2.8} />}
            </button>
            <button
              type="button"
              onClick={() => issueLiveControl('skip')}
              aria-label="Next preview puzzle"
              disabled={puzzles.length === 0}
              className={`inline-flex h-10 w-10 items-center justify-center rounded-[14px] border-2 border-black ${
                puzzles.length === 0 ? 'bg-slate-100 text-slate-400' : 'bg-white text-slate-700'
              }`}
            >
              <SkipForward size={16} strokeWidth={2.8} />
            </button>
            <div className="flex h-10 min-w-0 flex-1 items-center justify-between gap-2 rounded-[14px] border-2 border-black bg-white px-3">
              <span
                data-mobile-puzzle-count
                className="min-w-0 truncate text-[11px] font-black uppercase tracking-[0.12em] text-slate-900"
              >
                {puzzles.length} Puzzle{puzzles.length === 1 ? '' : 's'}
              </span>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={onAddPuzzles}
                  aria-label="Add more puzzles"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-[10px] border-2 border-black bg-[#A7F3D0] text-slate-900"
                >
                  <Plus size={14} strokeWidth={3} />
                </button>
                <button
                  type="button"
                  onClick={onClearBatch}
                  aria-label="Clear batch"
                  disabled={puzzles.length === 0}
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-[10px] border-2 border-black ${
                    puzzles.length === 0
                      ? 'bg-slate-100 text-slate-400'
                      : 'bg-[#FECACA] text-slate-900'
                  }`}
                >
                  <Trash2 size={13} strokeWidth={2.8} />
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={onStart}
              disabled={puzzles.length === 0}
              className={`inline-flex h-10 items-center justify-center gap-2 rounded-[14px] border-2 border-black px-4 text-[11px] font-black uppercase tracking-[0.14em] ${
                puzzles.length === 0 ? 'bg-slate-200 text-slate-500' : 'bg-[#CBD5E1] text-slate-900'
              }`}
            >
              <Play size={14} strokeWidth={2.8} />
              Start
            </button>
          </div>
        </div>

        <div className="shrink-0 border-b border-black/15 bg-white px-2 py-1.5">
          <div className="grid items-center justify-items-center gap-[2px]" style={mobilePreviewRailStyle}>
            <PreviewFrame
              mode="live"
              puzzles={puzzles}
              settings={livePreviewSettings}
              liveControlAction={liveControlAction}
              onPlaybackStateChange={setLivePlaybackState}
              livePreviewStatus={livePreviewStatus}
              onLiveRenderReadyChange={handleLiveRenderReadyChange}
              previewStatus={previewStatus}
              previewError={previewError}
              previewUrl={previewUrl}
              className="relative max-w-full overflow-hidden"
              style={mobileFrameStyle}
            />
            <PreviewFrame
              mode="export"
              puzzles={puzzles}
              settings={livePreviewSettings}
              liveControlAction={liveControlAction}
              onPlaybackStateChange={setLivePlaybackState}
              livePreviewStatus={livePreviewStatus}
              onLiveRenderReadyChange={handleLiveRenderReadyChange}
              previewStatus={previewStatus}
              previewError={previewError}
              previewUrl={previewUrl}
              className="relative max-w-full overflow-hidden"
              style={mobileFrameStyle}
            />
          </div>
        </div>

        <div className="shrink-0 border-b-2 border-black bg-[#FFFDF8] px-2 py-3">
          <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {SETUP_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => onSelectSetupTab(tab.value)}
                className={`shrink-0 rounded-full border-2 border-black px-3 py-1.5 text-[10px] font-black uppercase ${
                  activeMobileTab === tab.value ? 'bg-[#FFD93D]' : 'bg-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
            {OUTPUT_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => onSelectOutputTab(tab.value)}
                className={`shrink-0 rounded-full border-2 border-black px-3 py-1.5 text-[10px] font-black uppercase ${
                  activeMobileTab === tab.value ? 'bg-[#FFD93D]' : 'bg-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-[#FFFDF8] px-2 py-4">
          {showingSetupPanel ? setupPanelChildren : outputPanelChildren}
        </div>
      </div>

      <div className="hidden h-full min-h-0 sm:grid xl:grid-cols-[370px_minmax(0,1fr)_370px]">
        <aside className="video-panel-scroll min-h-0 overflow-y-auto border-r border-black/15 bg-[#FFFDF8]">
          <div className="sticky top-0 z-10 border-b border-black/15 bg-[#FFFDF8] px-3 py-3">
            <div className="text-[8px] font-black uppercase tracking-[0.18em] text-slate-500">Setup</div>
            <div className="mt-1.5 grid grid-cols-3 gap-1.5">
              {SETUP_TABS.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => onSelectSetupTab(tab.value)}
                  className={`rounded-md border-2 border-black px-2 py-1.5 text-[8px] font-black uppercase ${
                    activeSetupTab === tab.value ? 'bg-[#FFD93D]' : 'bg-white hover:bg-slate-100'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3 px-3 py-3">
            <div className="space-y-1.5">
              <div className="text-[8px] font-black uppercase tracking-[0.18em] text-slate-500">Package</div>
              <select
                value={activeVideoPackageId}
                onChange={(event) => onSelectVideoPackage(event.target.value)}
                className={selectClass}
              >
                {packageOptions.map((videoPackage) => (
                  <option key={videoPackage.id} value={videoPackage.id}>
                    {videoPackage.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5 border-t border-black/15 pt-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[8px] font-black uppercase tracking-[0.18em] text-slate-500">Theme</div>
                <button
                  type="button"
                  onClick={() => onSelectSetupTab('theme')}
                  className="text-[8px] font-black uppercase tracking-[0.14em] text-slate-600 hover:text-black"
                >
                  Edit
                </button>
              </div>
              <select
                value={settings.visualStyle}
                onChange={(event) => onVisualStyleChange(event.target.value as VideoSettings['visualStyle'])}
                className={selectClass}
              >
                {themeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5 border-t border-black/15 pt-3">
              <div className="text-[8px] font-black uppercase tracking-[0.18em] text-slate-500">Current</div>
              <div className="flex flex-wrap gap-1.5">
                <span className="rounded-md border border-black bg-[#DBEAFE] px-2 py-1 text-[8px] font-black uppercase">
                  {selectedStyleLabel}
                </span>
                <span className="rounded-md border border-black bg-white px-2 py-1 text-[8px] font-black uppercase">
                  {selectedProgressStyleLabel}
                </span>
                <span className="rounded-md border border-black bg-[#E0F2FE] px-2 py-1 text-[8px] font-black uppercase">
                  {selectedProgressMotionLabel}
                </span>
              </div>
            </div>

            {setupPanelChildren ? (
              <div className="video-setup-panel-content space-y-4 border-t border-black/15 pt-3">{setupPanelChildren}</div>
            ) : null}
          </div>
        </aside>

        <div className="flex min-h-0 flex-col border-r border-black/15 bg-white">
          <div className="border-b border-black/20 px-3 py-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => issueLiveControl('replay')}
                  disabled={puzzles.length === 0}
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-md border-2 border-black ${
                    puzzles.length === 0 ? 'cursor-not-allowed bg-slate-200 text-slate-500' : 'bg-white hover:bg-slate-100'
                  }`}
                  title="Replay live preview"
                >
                  <RotateCcw size={15} strokeWidth={2.8} />
                </button>
                <button
                  type="button"
                  onClick={() => issueLiveControl('toggle-play')}
                  disabled={puzzles.length === 0}
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-md border-2 border-black ${
                    puzzles.length === 0 ? 'cursor-not-allowed bg-slate-200 text-slate-500' : 'bg-white hover:bg-slate-100'
                  }`}
                  title={livePlaybackState.isPlaying ? 'Pause live preview' : 'Play live preview'}
                >
                  {livePlaybackState.isPlaying ? <Pause size={15} strokeWidth={2.8} /> : <Play size={15} strokeWidth={2.8} />}
                </button>
                <button
                  type="button"
                  onClick={() => issueLiveControl('skip')}
                  disabled={puzzles.length === 0}
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-md border-2 border-black ${
                    puzzles.length === 0 ? 'cursor-not-allowed bg-slate-200 text-slate-500' : 'bg-white hover:bg-slate-100'
                  }`}
                  title="Skip live preview"
                >
                  <SkipForward size={15} strokeWidth={2.8} />
                </button>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {PREVIEW_MOMENT_OPTIONS.map((option) => {
                  const disabled = !isMomentAvailable(option.value, previewPuzzleIndex, puzzles.length, settings);
                  const selected = safeMoment === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setPreviewMoment(option.value)}
                      disabled={disabled}
                      className={`rounded-md border-2 border-black px-2.5 py-2 text-[8px] font-black uppercase ${
                        selected
                          ? 'bg-[#FFD93D]'
                          : disabled
                            ? 'cursor-not-allowed bg-slate-200 text-slate-400'
                            : 'bg-white hover:bg-slate-100'
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>

              <div className="min-w-[180px] flex-1 max-w-[240px]">
                <select
                  aria-label="Preview puzzle"
                  value={previewPuzzleIndex}
                  onChange={(event) => setPreviewPuzzleIndex(Number(event.target.value))}
                  disabled={puzzles.length === 0}
                  className={selectClass}
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
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden px-0 py-1">
            <PreviewMonitorStage
              puzzles={puzzles}
              settings={livePreviewSettings}
              usesStackedStage={usesStackedStage}
              frameShellStyle={frameShellStyle}
              liveControlAction={liveControlAction}
              onPlaybackStateChange={setLivePlaybackState}
              livePreviewStatus={livePreviewStatus}
              onLiveRenderReadyChange={handleLiveRenderReadyChange}
              previewStatus={previewStatus}
              previewError={previewError}
              previewUrl={previewUrl}
            />
          </div>
        </div>

        <aside className="video-panel-scroll min-h-0 overflow-y-auto bg-[#FFFDF8]">
          <style>{`
            .video-panel-scroll {
              scrollbar-width: none;
              -ms-overflow-style: none;
            }
            .video-panel-scroll::-webkit-scrollbar {
              width: 0;
              height: 0;
            }
            .video-setup-panel-content [class*="grid-cols"] {
              grid-template-columns: minmax(0, 1fr) !important;
            }
            .video-output-panel-content [class*="grid-cols"] {
              grid-template-columns: minmax(0, 1fr) !important;
            }
          `}</style>
          <div className="sticky top-0 z-10 border-b border-black/15 bg-[#FFFDF8] px-3 py-3">
              <div className="text-[8px] font-black uppercase tracking-[0.18em] text-slate-500">Output</div>
              <div className="mt-1.5 grid grid-cols-4 gap-1.5">
                {OUTPUT_TABS.map((tab) => (
                  <button
                    key={tab.value}
                    type="button"
                    onClick={() => onSelectOutputTab(tab.value)}
                    className={`rounded-md border-2 border-black px-2 py-1.5 text-[8px] font-black uppercase ${
                      activeOutputTab === tab.value ? 'bg-[#FFD93D]' : 'bg-white hover:bg-slate-100'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
          </div>

          <div className="space-y-3 px-3 py-3">
            <div className="space-y-1.5">
              <div className="text-[8px] font-black uppercase tracking-[0.18em] text-slate-500">Progress</div>
              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => onShowProgressChange(!settings.showProgress)}
                  className={`rounded-md border-2 border-black px-2 py-2 text-[8px] font-black uppercase ${
                    settings.showProgress ? 'bg-[#A7F3D0]' : 'bg-white hover:bg-slate-100'
                  }`}
                >
                  {settings.showProgress ? 'Visible' : 'Hidden'}
                </button>
                <button
                  type="button"
                  onClick={() => onGeneratedProgressEnabledChange(!settings.generatedProgressEnabled)}
                  className={`rounded-md border-2 border-black px-2 py-2 text-[8px] font-black uppercase ${
                    settings.generatedProgressEnabled ? 'bg-[#FDE68A]' : 'bg-white hover:bg-slate-100'
                  }`}
                >
                  {settings.generatedProgressEnabled ? 'Generated' : 'Package'}
                </button>
              </div>
            </div>

            {outputPanelChildren ? (
              <div className="video-output-panel-content space-y-4 border-t border-black/15 pt-3">{outputPanelChildren}</div>
            ) : null}
          </div>
        </aside>
      </div>
    </section>
  );
};
