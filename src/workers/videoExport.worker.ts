import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSource,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  WebMOutputFormat,
  canEncodeVideo
} from 'mediabunny';
import { Puzzle, Region, type VideoAudioCuePoolKey, VideoSettings } from '../types';
import { VISUAL_THEMES, resolveVisualThemeStyle, type VisualTheme } from '../constants/videoThemes';
import { BASE_STAGE_SIZE, CLASSIC_HUD_SPEC, TRANSITION_TUNING } from '../constants/videoLayoutSpec';
import { type HudAnchorSpec } from '../constants/videoHudLayoutSpec';
import { resolveVideoLayoutSettings } from '../constants/videoLayoutCustom';
import { VIDEO_PACKAGE_PRESETS, resolvePackageImageArrangement } from '../constants/videoPackages';
import {
  applyTextTransform,
  buildProgressFillDefinition,
  buildTimerBackground,
  measureResolvedTimerBox,
  radiusTokenToPx,
  resolveTimerRenderProfile,
  resolveVideoStyleModules
} from '../constants/videoStyleModules';
import {
  PROGRESS_BAR_THEMES,
  resolveProgressBarFillColors,
  resolveProgressBarFillStyle
} from '../constants/progressBarThemes';
import { drawGeneratedBackground, resolveGeneratedBackgroundForIndex } from '../services/generatedBackgrounds';
import { isStoredImageAssetSource, loadImageAssetBlob } from '../services/imageAssetStore';
import { decodeRuntimeImageBitmapFromBlob } from '../services/canvasRuntime';
import { clampLogoZoom } from '../utils/logoProcessing';
import { resolveSmoothTextProgressFillColors } from '../utils/textProgressFill';
import {
  resolveTextProgressBaseAccent,
  resolveTextProgressEffectFrame,
  resolveTextProgressShellStyle
} from '../utils/textProgressEffects';
import { drawTextProgressCanvasEffects } from '../utils/textProgressCanvasEffects';
import { resolveVideoProgressMotionState } from '../utils/videoProgressMotion';
import {
  revealTypewriterText,
  VIDEO_TRANSITION_LABEL,
  resolveVideoPuzzleEntryState,
  resolveVideoTransitionSequenceState
} from '../utils/videoTransitionMotion';
import { isDesignerTimerStyle } from '../utils/timerPackShared';
import {
  VIDEO_AUDIO_CUE_POOL_MAX_VOLUME,
  resolveVideoAudioCyclePoolIndex,
  resolveVideoAudioEventPoolIndex
} from '../utils/videoAudioPools';
import {
  resolveLowTimeWarningCueWindow,
  resolveProgressFillIntroCueWindow,
  resolvePuzzlePlayCueWindow,
  type VideoAudioPlaybackAutomation
} from '../utils/videoAudioCueScheduling';
import type { MediaTaskEventMessage, MediaWorkerStatsMessage } from '../services/mediaTelemetry';
import type {
  BinaryRenderablePuzzle,
  VideoExportAudioAsset,
  VideoExportAudioAssets,
  VideoExportWorkerStartPayload,
  VideoRenderSource
} from '../services/videoRenderSource';
import { drawDesignerTimerPreset } from './videoTimerPackCanvas';

type FramePhase = 'intro' | 'showing' | 'revealing' | 'transitioning' | 'outro';
type SceneCardKind = 'intro' | 'transition' | 'outro';

interface TimelineSegment {
  puzzleIndex: number;
  phase: FramePhase;
  start: number;
  duration: number;
  end: number;
}

interface ExportAudioCueEvent {
  timestamp: number;
  kind: VideoAudioCuePoolKey;
  phase: FramePhase;
  puzzleIndex: number;
  eventIndex: number;
  selectionMode: 'cycle' | 'event';
  maxDuration?: number;
  fadeOutDuration?: number;
  automation?: VideoAudioPlaybackAutomation;
}

interface RenderScene {
  segment: TimelineSegment;
  phaseElapsed: number;
  timeLeft: number;
  progressPercent: number;
  countdownPercent: number;
  revealedRegionCount: number;
  blinkOverlayActive: boolean;
  blinkOverlayVisible: boolean;
  title: string;
  subtitle: string;
  cardEyebrow: string;
}

interface IntroVideoResource {
  sink: CanvasSink;
  duration: number;
}

type RenderablePuzzle = Puzzle | BinaryRenderablePuzzle;
type RenderSourceKind = VideoRenderSource['source'];

type ExportVideoOptions =
  | {
      source: 'legacy';
      puzzles: Puzzle[];
      settings: VideoSettings;
      generatedBackgroundPack?: VideoExportWorkerStartPayload['generatedBackgroundPack'];
      audioAssets?: VideoExportAudioAssets;
      introVideoFile?: File;
      streamOutput?: boolean;
      onProgress?: (progress: number, status?: string) => void;
    }
  | {
      source: 'binary';
      puzzles: BinaryRenderablePuzzle[];
      settings: VideoSettings;
      generatedBackgroundPack?: VideoExportWorkerStartPayload['generatedBackgroundPack'];
      audioAssets?: VideoExportAudioAssets;
      introVideoFile?: File;
      streamOutput?: boolean;
      onProgress?: (progress: number, status?: string) => void;
    };

type PreviewFrameOptions =
  | {
      source?: 'legacy';
      puzzles: Puzzle[];
      settings: VideoSettings;
      timestamp: number;
      generatedBackgroundPack?: VideoExportWorkerStartPayload['generatedBackgroundPack'];
      introVideoFile?: File;
    }
  | {
      source: 'binary';
      puzzles: BinaryRenderablePuzzle[];
      settings: VideoSettings;
      timestamp: number;
      generatedBackgroundPack?: VideoExportWorkerStartPayload['generatedBackgroundPack'];
      introVideoFile?: File;
    };

interface WorkerStartMessage {
  type: 'start';
  payload: VideoExportWorkerStartPayload;
}

interface WorkerPreviewFrameMessage {
  type: 'preview-frame';
  requestId?: number;
  payload: PreviewFrameOptions;
}

interface WorkerCancelMessage {
  type: 'cancel';
  requestId?: number;
}

type WorkerMessage = WorkerStartMessage | WorkerPreviewFrameMessage | WorkerCancelMessage;

type WorkerResponse =
  | { type: 'progress'; progress: number; status?: string }
  | { type: 'stream-chunk'; position: number; data: ArrayBuffer }
  | { type: 'stream-done'; mimeType: string; fileName: string }
  | { type: 'preview-frame-done'; buffer: ArrayBuffer; mimeType: string; requestId?: number }
  | { type: 'done'; buffer: ArrayBuffer; mimeType: string; fileName: string }
  | { type: 'error'; message: string; requestId?: number }
  | { type: 'cancelled'; requestId?: number }
  | MediaTaskEventMessage
  | MediaWorkerStatsMessage;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  radius?: number;
}

interface MarkerBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LoadedPuzzleImages {
  original: ImageBitmap;
  modified: ImageBitmap;
}

interface VideoExportTelemetryState {
  startedAt: number;
  lastStatsAt: number;
  renderedFrames: number;
  totalRenderMs: number;
  totalEncodeMs: number;
  cacheEntries: number;
  hotPuzzleCount: number;
}

let isCanceled = false;
let currentWorkerSessionId = 'primary';

const getVideoWorkerId = () => `video-export-worker:${currentWorkerSessionId}`;
const getScopedTaskId = (taskId: string) => `${getVideoWorkerId()}:${taskId}`;

const FPS = 30;

const RESOLUTION_HEIGHT: Record<VideoSettings['exportResolution'], number> = {
  '480p': 480,
  '720p': 720,
  '1080p': 1080,
  '1440p': 1440,
  '2160p': 2160
};

const FORMAT_BY_CODEC = {
  h264: {
    codec: 'avc' as const,
    audioCodec: 'aac' as const,
    format: new Mp4OutputFormat(),
    extension: 'mp4',
    mimeType: 'video/mp4'
  },
  av1: {
    codec: 'av1' as const,
    audioCodec: 'opus' as const,
    format: new WebMOutputFormat(),
    extension: 'webm',
    mimeType: 'video/webm'
  }
};

const AUDIO_BITRATE = 128_000;
const AUDIO_SAMPLE_RATE = 48_000;
const AUDIO_CHANNELS = 2;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lerp = (start: number, end: number, progress: number) => start + (end - start) * progress;
const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);
const formatCountdownSeconds = (seconds: number) =>
  `${Math.max(0, Math.ceil(seconds - 0.001))}s`;
const fillTemplate = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) => String(values[key] ?? ''));

const clamp01 = (value: number) => clamp(value, 0, 1);

const resolvePhaseLevel = (levels: VideoSettings['musicPhaseLevels'] | undefined, phase: FramePhase) =>
  clamp01(
    phase === 'intro'
      ? levels?.intro ?? 1
      : phase === 'showing'
      ? levels?.showing ?? 1
      : phase === 'revealing'
      ? levels?.revealing ?? 1
      : phase === 'transitioning'
      ? levels?.transitioning ?? 1
      : levels?.outro ?? 1
  );

const resampleInterleaved = (
  asset: VideoExportAudioAsset,
  targetSampleRate: number,
  targetChannels: number
) => {
  const sourceChannels = Math.max(1, asset.channels);
  const sourceFrames = Math.floor(asset.data.length / sourceChannels);
  if (!Number.isFinite(asset.sampleRate) || asset.sampleRate <= 0 || sourceFrames <= 0) {
    return null;
  }

  const rateRatio = asset.sampleRate / targetSampleRate;
  const targetFrames = Math.max(1, Math.round(sourceFrames / rateRatio));
  const output = new Float32Array(targetFrames * targetChannels);

  const readSample = (frame: number, channel: number) => {
    if (sourceChannels === targetChannels) {
      return asset.data[frame * sourceChannels + channel] ?? 0;
    }
    if (sourceChannels === 1) {
      return asset.data[frame] ?? 0;
    }
    if (targetChannels === 1) {
      let sum = 0;
      for (let ch = 0; ch < sourceChannels; ch += 1) {
        sum += asset.data[frame * sourceChannels + ch] ?? 0;
      }
      return sum / sourceChannels;
    }
    if (channel < sourceChannels) {
      return asset.data[frame * sourceChannels + channel] ?? 0;
    }
    return asset.data[frame * sourceChannels] ?? 0;
  };

  for (let frame = 0; frame < targetFrames; frame += 1) {
    const sourcePos = frame * rateRatio;
    const index0 = Math.min(sourceFrames - 1, Math.max(0, Math.floor(sourcePos)));
    const index1 = Math.min(sourceFrames - 1, index0 + 1);
    const t = sourcePos - index0;
    for (let channel = 0; channel < targetChannels; channel += 1) {
      const sample0 = readSample(index0, channel);
      const sample1 = readSample(index1, channel);
      output[frame * targetChannels + channel] = sample0 + (sample1 - sample0) * t;
    }
  }

  return {
    data: output,
    frames: targetFrames,
    channels: targetChannels,
    duration: targetFrames / targetSampleRate
  };
};

type ResampledAudioAsset = NonNullable<ReturnType<typeof resampleInterleaved>>;
type ResolvedSfxPools = Partial<Record<VideoAudioCuePoolKey, ResampledAudioAsset[]>>;

const mixInterleaved = (
  target: Float32Array,
  source: Float32Array,
  sourceFrames: number,
  targetChannels: number,
  startFrame: number,
  gain: number
) => {
  if (gain <= 0) return;
  const totalFrames = Math.floor(target.length / targetChannels);
  for (let frame = 0; frame < sourceFrames; frame += 1) {
    const targetFrame = startFrame + frame;
    if (targetFrame < 0 || targetFrame >= totalFrames) continue;
    const targetIndex = targetFrame * targetChannels;
    const sourceIndex = frame * targetChannels;
    for (let channel = 0; channel < targetChannels; channel += 1) {
      target[targetIndex + channel] = clamp(
        target[targetIndex + channel] + source[sourceIndex + channel] * gain,
        -2,
        2
      );
    }
  }
};

const mixInterleavedWindow = (
  target: Float32Array,
  source: Float32Array,
  sourceFrames: number,
  targetChannels: number,
  startFrame: number,
  gain: number,
  maxFrames?: number,
  fadeOutFrames = 0,
  automation?: VideoAudioPlaybackAutomation
) => {
  if (gain <= 0) return;
  const maxOutputFrames =
    typeof maxFrames === 'number' && Number.isFinite(maxFrames)
      ? Math.max(0, Math.min(sourceFrames, maxFrames))
      : sourceFrames;
  if (maxOutputFrames <= 0) return;

  const totalFrames = Math.floor(target.length / targetChannels);
  const effectiveFadeOutFrames =
    fadeOutFrames > 0 ? Math.min(Math.max(0, fadeOutFrames), maxOutputFrames) : 0;
  const automationFrames =
    automation && automation.duration > 0
      ? Math.min(
          Math.max(0, Math.round(automation.duration * AUDIO_SAMPLE_RATE)),
          Math.max(0, maxOutputFrames - effectiveFadeOutFrames)
        )
      : 0;
  const playbackRateStart = automation?.playbackRateStart ?? 1;
  const playbackRateEnd = automation?.playbackRateEnd ?? playbackRateStart;
  const gainStart = automation?.gainStart ?? 1;
  const gainEnd = automation?.gainEnd ?? gainStart;
  let sourceFramePosition = 0;

  for (let frame = 0; frame < maxOutputFrames; frame += 1) {
    if (sourceFramePosition >= sourceFrames) {
      break;
    }
    const targetFrame = startFrame + frame;
    const targetIndex = targetFrame * targetChannels;
    const rampProgress =
      automationFrames > 1
        ? clamp(frame / (automationFrames - 1), 0, 1)
        : automationFrames === 1
        ? 1
        : 0;
    const easedRampProgress = rampProgress * rampProgress * (3 - 2 * rampProgress);
    const playbackRate =
      automationFrames > 0
        ? lerp(playbackRateStart, playbackRateEnd, easedRampProgress)
        : playbackRateStart;
    const gainMultiplier =
      automationFrames > 0
        ? lerp(gainStart, gainEnd, easedRampProgress)
        : gainStart;
    const fadeGain =
      effectiveFadeOutFrames > 0 && frame >= maxOutputFrames - effectiveFadeOutFrames
        ? (maxOutputFrames - frame) / effectiveFadeOutFrames
        : 1;
    const frameGain = gain * gainMultiplier * fadeGain;
    const baseSourceFrame = Math.min(sourceFrames - 1, Math.floor(sourceFramePosition));
    const nextSourceFrame = Math.min(sourceFrames - 1, baseSourceFrame + 1);
    const frameMix = sourceFramePosition - baseSourceFrame;
    if (targetFrame >= 0 && targetFrame < totalFrames) {
      for (let channel = 0; channel < targetChannels; channel += 1) {
        const baseSample = source[baseSourceFrame * targetChannels + channel] ?? 0;
        const nextSample = source[nextSourceFrame * targetChannels + channel] ?? baseSample;
        target[targetIndex + channel] = clamp(
          target[targetIndex + channel] +
            (baseSample + (nextSample - baseSample) * frameMix) * frameGain,
          -2,
          2
        );
      }
    }
    sourceFramePosition += Math.max(0.001, playbackRate);
  }
};

const applySoftLimiter = (buffer: Float32Array, enabled: boolean) => {
  if (!enabled) return;
  const drive = 1.6;
  const norm = Math.tanh(drive);
  for (let index = 0; index < buffer.length; index += 1) {
    const sample = buffer[index] * drive;
    buffer[index] = Math.tanh(sample) / norm;
  }
};

const resolveResampledSfxPools = (
  audioAssets: VideoExportAudioAssets | undefined
): ResolvedSfxPools => {
  const pools: ResolvedSfxPools = {};
  const sourcePools = audioAssets?.sfxPools;
  if (!sourcePools) return pools;

  for (const [key, pool] of Object.entries(sourcePools) as Array<
    [VideoAudioCuePoolKey, VideoExportAudioAsset[] | undefined]
  >) {
    const resampled = (pool ?? [])
      .map((asset) => resampleInterleaved(asset, AUDIO_SAMPLE_RATE, AUDIO_CHANNELS))
      .filter((asset): asset is ResampledAudioAsset => Boolean(asset));
    if (resampled.length > 0) {
      pools[key] = resampled;
    }
  }

  return pools;
};

const resolveScheduledPoolAsset = (
  pools: ResolvedSfxPools,
  settings: VideoSettings,
  event: Pick<ExportAudioCueEvent, 'kind' | 'puzzleIndex' | 'eventIndex' | 'selectionMode'>
) => {
  const configuredSources = settings.audioCuePools[event.kind].sources;
  const assets = pools[event.kind];
  if (!configuredSources.length || !assets?.length) return null;

  const index =
    event.selectionMode === 'cycle'
      ? resolveVideoAudioCyclePoolIndex(configuredSources, event.eventIndex, event.kind)
      : resolveVideoAudioEventPoolIndex(configuredSources, event.puzzleIndex, event.eventIndex, event.kind);
  if (index == null) return null;
  return assets[index] ?? null;
};

const buildExportAudioCueEvents = (
  timeline: TimelineSegment[],
  settings: VideoSettings,
  puzzles: RenderablePuzzle[],
  pools: ResolvedSfxPools
): ExportAudioCueEvent[] => {
  if (!settings.soundEffectsEnabled) {
    return [];
  }

  const events: ExportAudioCueEvent[] = [];
  const revealPhaseDuration = Math.max(0.5, settings.revealDuration);
  const blinkCycleDuration = Math.max(0.2, settings.blinkSpeed);
  const hasPool = (key: VideoAudioCuePoolKey) =>
    settings.audioCuePools[key].enabled && (pools[key]?.length ?? 0) > 0;

  timeline.forEach((segment) => {
    if (segment.phase === 'showing') {
      const shouldPlayProgressFill =
        settings.progressMotion === 'intro_fill' && hasPool('progress_fill_intro');
      let progressFillDuration = 0;

      if (shouldPlayProgressFill) {
        const progressEventBase: ExportAudioCueEvent = {
          timestamp: segment.start,
          kind: 'progress_fill_intro',
          phase: segment.phase,
          puzzleIndex: segment.puzzleIndex,
          eventIndex: segment.puzzleIndex,
          selectionMode: 'cycle'
        };
        const progressAsset = resolveScheduledPoolAsset(pools, settings, progressEventBase);
        const progressWindow = progressAsset
          ? resolveProgressFillIntroCueWindow(settings.showDuration, progressAsset.duration)
          : null;
        if (progressWindow) {
          events.push({
            ...progressEventBase,
            maxDuration: progressWindow.maxDuration,
            fadeOutDuration: progressWindow.fadeOutDuration
          });
          progressFillDuration = progressWindow.maxDuration;
        }
      }

      const puzzlePlayWindow = resolvePuzzlePlayCueWindow(
        settings.showDuration,
        progressFillDuration,
        settings.puzzlePlayUrgencyRampEnabled
      );
      if (hasPool('puzzle_play') && puzzlePlayWindow) {
        events.push({
          timestamp: segment.start + puzzlePlayWindow.delaySeconds,
          kind: 'puzzle_play',
          phase: segment.phase,
          puzzleIndex: segment.puzzleIndex,
          eventIndex: segment.puzzleIndex,
          selectionMode: 'cycle',
          maxDuration: puzzlePlayWindow.maxDuration,
          fadeOutDuration: puzzlePlayWindow.fadeOutDuration,
          automation: puzzlePlayWindow.automation
        });
      }

      const lowTimeWindow = resolveLowTimeWarningCueWindow(settings.showDuration);
      if (hasPool('low_time_warning') && lowTimeWindow) {
        events.push({
          timestamp: segment.start + lowTimeWindow.delaySeconds,
          kind: 'low_time_warning',
          phase: segment.phase,
          puzzleIndex: segment.puzzleIndex,
          eventIndex: segment.puzzleIndex,
          selectionMode: 'cycle',
          maxDuration: lowTimeWindow.maxDuration,
          fadeOutDuration: lowTimeWindow.fadeOutDuration
        });
      }
    }

    if (segment.phase === 'revealing') {
      const puzzle = puzzles[segment.puzzleIndex];
      const revealRegionCount = puzzle?.regions?.length ?? 0;
      if (revealRegionCount > 0) {
        const revealStepSeconds = Math.min(
          Math.max(0.5, settings.sequentialRevealStep),
          revealPhaseDuration / Math.max(1, revealRegionCount + 1)
        );

        if (hasPool('marker_reveal')) {
          for (let index = 0; index < revealRegionCount; index += 1) {
            events.push({
              timestamp: segment.start + index * revealStepSeconds,
              kind: 'marker_reveal',
              phase: segment.phase,
              puzzleIndex: segment.puzzleIndex,
              eventIndex: index,
              selectionMode: 'event'
            });
          }
        }

        if (hasPool('blink') && settings.enableBlinking !== false) {
          const blinkStartTime =
            revealRegionCount > 0
              ? Math.max(0, (revealRegionCount - 1) * revealStepSeconds + blinkCycleDuration)
              : 0;
          let blinkIndex = 0;
          for (
            let blinkTime = blinkStartTime;
            blinkTime < segment.duration;
            blinkTime += blinkCycleDuration
          ) {
            events.push({
              timestamp: segment.start + blinkTime,
              kind: 'blink',
              phase: segment.phase,
              puzzleIndex: segment.puzzleIndex,
              eventIndex: blinkIndex,
              selectionMode: 'event'
            });
            blinkIndex += 1;
          }
        }
      }
    }

    if (segment.phase === 'transitioning' && hasPool('transition')) {
      events.push({
        timestamp: segment.start,
        kind: 'transition',
        phase: segment.phase,
        puzzleIndex: segment.puzzleIndex,
        eventIndex: segment.puzzleIndex,
        selectionMode: 'cycle'
      });
    }
  });

  return events.sort((left, right) => left.timestamp - right.timestamp);
};

const buildExportAudioMixSample = (
  timeline: TimelineSegment[],
  settings: VideoSettings,
  audioAssets: VideoExportAudioAssets | undefined,
  totalDuration: number,
  puzzles: RenderablePuzzle[]
): AudioSample | null => {
  const hasMusic = settings.backgroundMusicEnabled && audioAssets?.music;
  const hasIntroClip = Boolean(audioAssets?.introClip);
  const sfxPools = resolveResampledSfxPools(audioAssets);
  const cueEvents = settings.soundEffectsEnabled
    ? buildExportAudioCueEvents(timeline, settings, puzzles, sfxPools)
    : [];
  const hasSfx = cueEvents.length > 0;
  if (!hasSfx && !hasMusic && !hasIntroClip) return null;

  const totalFrames = Math.max(1, Math.ceil(totalDuration * AUDIO_SAMPLE_RATE));
  const mix = new Float32Array(totalFrames * AUDIO_CHANNELS);
  let introClipAsset = audioAssets?.introClip
    ? resampleInterleaved(audioAssets.introClip, AUDIO_SAMPLE_RATE, AUDIO_CHANNELS)
    : null;

  if (hasSfx) {
    cueEvents.forEach((event) => {
      const phaseGain = resolvePhaseLevel(settings.sfxPhaseLevels, event.phase);
      const cueVolume = clamp(
        settings.audioCuePools[event.kind]?.volume ?? 1,
        0,
        VIDEO_AUDIO_CUE_POOL_MAX_VOLUME
      );
      const gain = clamp01(settings.soundEffectsVolume) * phaseGain * cueVolume;
      if (gain <= 0) return;

      const timestamp = clamp(event.timestamp, 0, totalDuration);
      const startFrame = Math.round(timestamp * AUDIO_SAMPLE_RATE);
      const asset = resolveScheduledPoolAsset(sfxPools, settings, event);
      if (!asset) return;
      const maxFrames =
        typeof event.maxDuration === 'number'
          ? Math.max(0, Math.round(event.maxDuration * AUDIO_SAMPLE_RATE))
          : undefined;
      const fadeOutFrames =
        typeof event.fadeOutDuration === 'number'
          ? Math.max(0, Math.round(event.fadeOutDuration * AUDIO_SAMPLE_RATE))
          : 0;
      mixInterleavedWindow(
        mix,
        asset.data,
        asset.frames,
        AUDIO_CHANNELS,
        startFrame,
        gain,
        maxFrames,
        fadeOutFrames,
        event.automation
      );
    });
  }

  if (introClipAsset) {
    const introDuration = resolveIntroDuration(settings);
    const maxFrames = introDuration > 0
      ? Math.min(introClipAsset.frames, Math.ceil(introDuration * AUDIO_SAMPLE_RATE))
      : introClipAsset.frames;
    mixInterleaved(mix, introClipAsset.data, maxFrames, AUDIO_CHANNELS, 0, 1);
  }

  if (hasMusic && audioAssets?.music) {
    const musicResampled = resampleInterleaved(audioAssets.music, AUDIO_SAMPLE_RATE, AUDIO_CHANNELS);
    if (musicResampled) {
      const musicGain = new Float32Array(totalFrames);
      const baseVolume = clamp01(settings.backgroundMusicVolume);
      timeline.forEach((segment) => {
        const level = baseVolume * resolvePhaseLevel(settings.musicPhaseLevels, segment.phase);
        const startFrame = Math.max(0, Math.round(segment.start * AUDIO_SAMPLE_RATE));
        const endFrame = Math.min(totalFrames, Math.round(segment.end * AUDIO_SAMPLE_RATE));
        for (let frame = startFrame; frame < endFrame; frame += 1) {
          musicGain[frame] = level;
        }
      });

      const fadeInFrames = Math.round(Math.max(0, settings.backgroundMusicFadeIn) * AUDIO_SAMPLE_RATE);
      const fadeOutFrames = Math.round(Math.max(0, settings.backgroundMusicFadeOut) * AUDIO_SAMPLE_RATE);
      if (fadeInFrames > 0) {
        for (let frame = 0; frame < Math.min(fadeInFrames, totalFrames); frame += 1) {
          musicGain[frame] *= frame / fadeInFrames;
        }
      }
      if (fadeOutFrames > 0) {
        for (let frame = 0; frame < Math.min(fadeOutFrames, totalFrames); frame += 1) {
          const index = totalFrames - 1 - frame;
          if (index < 0) break;
          musicGain[index] *= frame / fadeOutFrames;
        }
      }

      if (settings.backgroundMusicDuckingAmount > 0 && cueEvents.length > 0) {
        const duckFactor = new Float32Array(totalFrames);
        duckFactor.fill(1);
        const duckDepth = clamp01(settings.backgroundMusicDuckingAmount);
        const minGain = 1 - duckDepth;
        const attackFrames = Math.max(1, Math.round(0.04 * AUDIO_SAMPLE_RATE));
        const holdFrames = Math.max(1, Math.round(0.08 * AUDIO_SAMPLE_RATE));
        const releaseFrames = Math.max(1, Math.round(0.22 * AUDIO_SAMPLE_RATE));

        cueEvents.forEach((event) => {
          const centerFrame = Math.round(clamp(event.timestamp, 0, totalDuration) * AUDIO_SAMPLE_RATE);
          const attackStart = Math.max(0, centerFrame - attackFrames);
          const holdEnd = Math.min(totalFrames, centerFrame + holdFrames);
          const releaseEnd = Math.min(totalFrames, holdEnd + releaseFrames);

          for (let frame = attackStart; frame < centerFrame; frame += 1) {
            const t = (frame - attackStart) / Math.max(1, centerFrame - attackStart);
            const factor = 1 - duckDepth * t;
            duckFactor[frame] = Math.min(duckFactor[frame], factor);
          }
          for (let frame = centerFrame; frame < holdEnd; frame += 1) {
            duckFactor[frame] = Math.min(duckFactor[frame], minGain);
          }
          for (let frame = holdEnd; frame < releaseEnd; frame += 1) {
            const t = (frame - holdEnd) / Math.max(1, releaseEnd - holdEnd);
            const factor = minGain + duckDepth * t;
            duckFactor[frame] = Math.min(duckFactor[frame], factor);
          }
        });

        for (let frame = 0; frame < totalFrames; frame += 1) {
          musicGain[frame] *= duckFactor[frame];
        }
      }

      const musicFrames = musicResampled.frames;
      const musicData = musicResampled.data;
      const loop = settings.backgroundMusicLoop;
      const offsetFrames = Math.round(Math.max(0, settings.backgroundMusicOffsetSec) * AUDIO_SAMPLE_RATE);

      for (let frame = 0; frame < totalFrames; frame += 1) {
        const gain = musicGain[frame];
        if (gain <= 0) continue;
        const musicFrame = frame + offsetFrames;
        if (!loop && musicFrame >= musicFrames) continue;
        const sourceFrame = loop ? musicFrame % musicFrames : musicFrame;
        const sourceIndex = sourceFrame * AUDIO_CHANNELS;
        const targetIndex = frame * AUDIO_CHANNELS;
        for (let channel = 0; channel < AUDIO_CHANNELS; channel += 1) {
          mix[targetIndex + channel] = clamp(
            mix[targetIndex + channel] + musicData[sourceIndex + channel] * gain,
            -2,
            2
          );
        }
      }
    }
  }

  applySoftLimiter(mix, settings.audioLimiterEnabled);

  return new AudioSample({
    data: mix,
    format: 'f32',
    numberOfChannels: AUDIO_CHANNELS,
    sampleRate: AUDIO_SAMPLE_RATE,
    timestamp: 0
  });
};

const hexToRgba = (hex: string, alpha: number) => {
  if (!hex.startsWith('#')) return hex;
  const normalized =
    hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  const r = Number.parseInt(normalized.slice(1, 3), 16);
  const g = Number.parseInt(normalized.slice(3, 5), 16);
  const b = Number.parseInt(normalized.slice(5, 7), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return hex;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const extractHexColors = (input: string): string[] =>
  (input.match(/#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})/g) ?? []).map((value) =>
    value.length === 4
      ? `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`
      : value
  );

const createRepeatingStripePattern = (
  ctx: CanvasRenderingContext2D,
  colors: string[]
): CanvasPattern | null => {
  const tileSize = 24;
  const patternCanvas = new OffscreenCanvas(tileSize, tileSize);
  const patternCtx = patternCanvas.getContext('2d');
  if (!patternCtx) return null;

  patternCtx.fillStyle = colors[0];
  patternCtx.fillRect(0, 0, tileSize, tileSize);
  patternCtx.translate(tileSize / 2, tileSize / 2);
  patternCtx.rotate(-Math.PI / 4);
  const stripeWidth = 8;
  const stripeLength = tileSize * 2;
  for (let index = -3; index < colors.length + 3; index += 1) {
    const color = colors[(index + colors.length) % colors.length];
    patternCtx.fillStyle = color;
    patternCtx.fillRect(index * stripeWidth, -stripeLength / 2, stripeWidth, stripeLength);
  }
  return ctx.createPattern(patternCanvas, 'repeat');
};

const resolveProgressFill = (
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  fillDefinition: string,
  fallbackColor: string
): CanvasGradient | CanvasPattern | string => {
  const colors = extractHexColors(fillDefinition);
  if (colors.length === 0) return fallbackColor;

  if (fillDefinition.includes('repeating-linear-gradient')) {
    return createRepeatingStripePattern(ctx, colors) ?? colors[0];
  }

  const angleMatch = fillDefinition.match(/(-?\d+(?:\.\d+)?)deg/);
  const angleDeg = angleMatch ? Number.parseFloat(angleMatch[1]) : 90;
  const normalizedAngle = ((angleDeg % 360) + 360) % 360;
  const horizontal = normalizedAngle === 90 || normalizedAngle === 270;
  const vertical = normalizedAngle === 0 || normalizedAngle === 180;

  const gradient = horizontal
    ? ctx.createLinearGradient(rect.x, rect.y, rect.x + rect.width, rect.y)
    : vertical
    ? ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.height)
    : ctx.createLinearGradient(rect.x, rect.y, rect.x + rect.width, rect.y + rect.height);

  const denominator = Math.max(1, colors.length - 1);
  colors.forEach((color, index) => {
    gradient.addColorStop(index / denominator, color);
  });
  return gradient;
};

const roundRectPath = (ctx: CanvasRenderingContext2D, rect: Rect) => {
  const radius = clamp(rect.radius ?? 0, 0, Math.min(rect.width, rect.height) / 2);
  ctx.beginPath();
  ctx.moveTo(rect.x + radius, rect.y);
  ctx.lineTo(rect.x + rect.width - radius, rect.y);
  ctx.quadraticCurveTo(rect.x + rect.width, rect.y, rect.x + rect.width, rect.y + radius);
  ctx.lineTo(rect.x + rect.width, rect.y + rect.height - radius);
  ctx.quadraticCurveTo(
    rect.x + rect.width,
    rect.y + rect.height,
    rect.x + rect.width - radius,
    rect.y + rect.height
  );
  ctx.lineTo(rect.x + radius, rect.y + rect.height);
  ctx.quadraticCurveTo(rect.x, rect.y + rect.height, rect.x, rect.y + rect.height - radius);
  ctx.lineTo(rect.x, rect.y + radius);
  ctx.quadraticCurveTo(rect.x, rect.y, rect.x + radius, rect.y);
  ctx.closePath();
};

const drawRoundedRect = (
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  options: {
    fill?: string | CanvasGradient | CanvasPattern;
    stroke?: string | CanvasGradient | CanvasPattern;
    lineWidth?: number;
  }
) => {
  roundRectPath(ctx, rect);
  if (options.fill) {
    ctx.fillStyle = options.fill;
    ctx.fill();
  }
  if (options.stroke && (options.lineWidth ?? 0) > 0) {
    ctx.lineWidth = options.lineWidth ?? 1;
    ctx.strokeStyle = options.stroke;
    ctx.stroke();
  }
};

const resolveTextProgressFillColors = (
  remainingPercent: number,
  visualTheme: VisualTheme,
  dynamicColors?: ReturnType<typeof resolveProgressBarFillColors>
) => {
  return resolveSmoothTextProgressFillColors(remainingPercent, visualTheme, dynamicColors);
};

const resolveTextProgressFontSize = (text: string, width: number, height: number, preferred: number) => {
  const safeText = text.trim() || 'PROGRESS';
  const widthBound = width / Math.max(4.8, safeText.length * 0.68);
  const heightBound = height * 0.78;
  return clamp(Math.min(preferred, widthBound, heightBound), 12, 256);
};

const drawTextProgressLabel = (
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  label: string,
  fillPercent: number,
  colorPercent: number,
  styleModules: ReturnType<typeof resolveVideoStyleModules>,
  visualTheme: VisualTheme,
  scale: number,
  generatedStyle: VideoSettings['generatedProgressStyle'] | null,
  animationSeconds: number,
  dynamicFillColors?: ReturnType<typeof resolveProgressBarFillColors>,
  sweep?: {
    active: boolean;
    progress: number;
    opacity: number;
  }
) => {
  const safeLabel = label.trim() || 'PROGRESS';
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const x = rect.x;
  const y = rect.y;
  const textRect: Rect = { x, y, width, height, radius: 0 };
  const fillColors = resolveTextProgressFillColors(colorPercent, visualTheme, dynamicFillColors);
  const shellStyle = resolveTextProgressShellStyle(generatedStyle, fillColors);
  const fontSize = Math.max(
    12,
    Math.round(
      resolveTextProgressFontSize(safeLabel, width, height, Math.max(18, height * 1.24, width, 28 * scale)) *
        shellStyle.fontScale
    )
  );
  const textX = x + width / 2;
  const textY = y + height * 0.68;
  const strokeWidth = Math.max(2, Math.round(fontSize * 0.08 * shellStyle.strokeScale));
  const shellFill = shellStyle.fill;
  const shellStroke = shellStyle.stroke;
  const textCanvas = new OffscreenCanvas(Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height)));
  const textCtx = textCanvas.getContext('2d');

  if (!textCtx) {
    return;
  }

  textCtx.clearRect(0, 0, width, height);
  textCtx.textAlign = 'center';
  textCtx.textBaseline = 'alphabetic';
  textCtx.font = `${styleModules.text.titleCanvasWeight} ${fontSize}px ${styleModules.text.titleCanvasFamily}`;
  const metrics = textCtx.measureText(safeLabel);
  const textSpanWidth = Math.max(
    1,
    Math.min(width, Math.max(metrics.width, (metrics.actualBoundingBoxLeft || 0) + (metrics.actualBoundingBoxRight || 0)))
  );
  const fillX = Math.max(0, (width - textSpanWidth) / 2);
  const fillWidth = Math.max(0, Math.min(textSpanWidth, (textSpanWidth * clamp(fillPercent, 0, 100)) / 100));
  const fillRatio = textSpanWidth > 0 ? fillWidth / textSpanWidth : 0;
  const textProgressEffects = resolveTextProgressEffectFrame({
    style: generatedStyle,
    width,
    height,
    fillX,
    fillWidth,
    spanWidth: textSpanWidth,
    fillRatio,
    animationSeconds,
    fillColors
  });
  const textProgressBaseAccent = resolveTextProgressBaseAccent(generatedStyle, fillColors);
  textCtx.fillStyle = '#000000';
  textCtx.fillText(safeLabel, width / 2, height * 0.68);
  textCtx.globalCompositeOperation = 'source-in';
  const gradient = textCtx.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, fillColors.start);
  gradient.addColorStop(0.58, fillColors.middle);
  gradient.addColorStop(1, fillColors.end);
  textCtx.fillStyle = gradient;
  textCtx.fillRect(fillX, 0, fillWidth, height);
  drawTextProgressCanvasEffects(
    textCtx,
    textProgressEffects,
    fillX,
    fillWidth,
    height,
    textProgressBaseAccent
  );
  if (sweep?.active && sweep.opacity > 0) {
    const sweepWidth = Math.max(18, textSpanWidth * 0.18);
    const sweepCenterX = fillX + textSpanWidth * sweep.progress;
    const sweepX = sweepCenterX - sweepWidth / 2;
    const sweepGradient = textCtx.createLinearGradient(sweepX, 0, sweepX + sweepWidth, 0);
    sweepGradient.addColorStop(0, 'rgba(255,255,255,0)');
    sweepGradient.addColorStop(0.3, 'rgba(255,255,255,0.06)');
    sweepGradient.addColorStop(0.5, 'rgba(255,255,255,0.28)');
    sweepGradient.addColorStop(0.7, 'rgba(255,255,255,0.06)');
    sweepGradient.addColorStop(1, 'rgba(255,255,255,0)');
    textCtx.save();
    textCtx.globalAlpha = clamp(sweep.opacity, 0, 1);
    textCtx.fillStyle = sweepGradient;
    textCtx.fillRect(sweepX, 0, sweepWidth, height);
    textCtx.restore();
  }

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `${styleModules.text.titleCanvasWeight} ${fontSize}px ${styleModules.text.titleCanvasFamily}`;
  ctx.lineWidth = strokeWidth;
  ctx.strokeStyle = shellStroke;
  ctx.fillStyle = shellFill;
  ctx.strokeText(safeLabel, textX, textY);
  ctx.fillText(safeLabel, textX, textY);
  ctx.drawImage(textCanvas, textRect.x, textRect.y, textRect.width, textRect.height);
  ctx.restore();
};

const drawProgressSweepOverlay = (
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  orientation: 'horizontal' | 'vertical',
  sweepProgress: number,
  sweepOpacity: number
) => {
  if (rect.width <= 0 || rect.height <= 0 || sweepOpacity <= 0) {
    return;
  }

  ctx.save();
  roundRectPath(ctx, rect);
  ctx.clip();
  ctx.globalAlpha = clamp(sweepOpacity, 0, 1);

  if (orientation === 'vertical') {
    const sweepHeight = Math.max(16, rect.height * 0.22);
    const sweepCenterY = rect.y + rect.height * (1 - sweepProgress);
    const sweepY = sweepCenterY - sweepHeight / 2;
    const gradient = ctx.createLinearGradient(0, sweepY, 0, sweepY + sweepHeight);
    gradient.addColorStop(0, 'rgba(255,255,255,0)');
    gradient.addColorStop(0.3, 'rgba(255,255,255,0.06)');
    gradient.addColorStop(0.5, 'rgba(255,255,255,0.28)');
    gradient.addColorStop(0.7, 'rgba(255,255,255,0.06)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(rect.x, sweepY, rect.width, sweepHeight);
  } else {
    const sweepWidth = Math.max(18, rect.width * 0.18);
    const sweepCenterX = rect.x + rect.width * sweepProgress;
    const sweepX = sweepCenterX - sweepWidth / 2;
    const gradient = ctx.createLinearGradient(sweepX, 0, sweepX + sweepWidth, 0);
    gradient.addColorStop(0, 'rgba(255,255,255,0)');
    gradient.addColorStop(0.3, 'rgba(255,255,255,0.06)');
    gradient.addColorStop(0.5, 'rgba(255,255,255,0.28)');
    gradient.addColorStop(0.7, 'rgba(255,255,255,0.06)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(sweepX, rect.y, sweepWidth, rect.height);
  }

  ctx.restore();
};

const drawProgressPulseOverlay = (
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  orientation: 'horizontal' | 'vertical',
  pulseOpacity: number
) => {
  if (rect.width <= 0 || rect.height <= 0 || pulseOpacity <= 0) {
    return;
  }

  ctx.save();
  roundRectPath(ctx, rect);
  ctx.clip();
  ctx.globalAlpha = clamp(pulseOpacity, 0, 1);

  if (orientation === 'vertical') {
    const pulseHeight = Math.max(18, rect.height * 0.38);
    const gradient = ctx.createLinearGradient(0, rect.y, 0, rect.y + pulseHeight);
    gradient.addColorStop(0, 'rgba(255,255,255,0.84)');
    gradient.addColorStop(0.28, 'rgba(255,255,255,0.22)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(rect.x, rect.y, rect.width, pulseHeight);
  } else {
    const pulseWidth = Math.max(22, rect.width * 0.28);
    const pulseX = rect.x + rect.width - pulseWidth;
    const gradient = ctx.createLinearGradient(pulseX, 0, pulseX + pulseWidth, 0);
    gradient.addColorStop(0, 'rgba(255,255,255,0)');
    gradient.addColorStop(0.45, 'rgba(255,255,255,0.08)');
    gradient.addColorStop(0.78, 'rgba(255,255,255,0.32)');
    gradient.addColorStop(1, 'rgba(255,255,255,0.84)');
    ctx.fillStyle = gradient;
    ctx.fillRect(pulseX, rect.y, pulseWidth, rect.height);
  }

  ctx.restore();
};

const drawProgressPulseGlow = (
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  pulseGlowOpacity: number,
  glowColor: string,
  blurBase: number,
  lineWidth: number,
  strokeColor = 'rgba(255,255,255,0.82)'
) => {
  if (rect.width <= 0 || rect.height <= 0 || pulseGlowOpacity <= 0) {
    return;
  }

  ctx.save();
  roundRectPath(ctx, rect);
  ctx.shadowColor = glowColor;
  ctx.shadowBlur = Math.max(blurBase, Math.round(blurBase * (1 + pulseGlowOpacity * 1.8)));
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  ctx.restore();
};

const drawTimerIndicator = (
  ctx: CanvasRenderingContext2D,
  style: ReturnType<typeof resolveVideoStyleModules>['timer'],
  color: string,
  x: number,
  centerY: number,
  dotSize: number
) => {
  if (style.dotKind === 'none') return 0;
  const indicatorWidth = style.dotKind === 'bar' ? Math.round(dotSize * 1.45) : dotSize;
  ctx.save();
  ctx.fillStyle = color;
  if (style.dotKind === 'bar') {
    drawRoundedRect(
      ctx,
      {
        x,
        y: centerY - Math.max(2, Math.round(dotSize * 0.22)),
        width: indicatorWidth,
        height: Math.max(4, Math.round(dotSize * 0.45)),
        radius: Math.max(2, Math.round(dotSize * 0.2))
      },
      { fill: color }
    );
  } else {
    ctx.translate(x + indicatorWidth / 2, centerY);
    if (style.dotKind === 'spark') {
      ctx.rotate(Math.PI / 4);
    }
    drawRoundedRect(
      ctx,
      {
        x: -dotSize / 2,
        y: -dotSize / 2,
        width: dotSize,
        height: dotSize,
        radius: style.dotKind === 'spark' ? Math.max(2, Math.round(dotSize * 0.22)) : dotSize / 2
      },
      { fill: color }
    );
  }
  ctx.restore();
  return indicatorWidth;
};

const drawTimerTextCentered = (
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  style: ReturnType<typeof resolveVideoStyleModules>['timer'],
  fontSize: number,
  color: string
) => {
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `${style.canvasFontWeight} ${fontSize}px ${style.canvasFontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 1);
  ctx.restore();
};

const drawTimerTextLeft = (
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  style: ReturnType<typeof resolveVideoStyleModules>['timer'],
  fontSize: number,
  color: string
) => {
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `${style.canvasFontWeight} ${fontSize}px ${style.canvasFontFamily}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 1);
  ctx.restore();
};

const drawTimerLabel = (
  ctx: CanvasRenderingContext2D,
  labelText: string,
  rect: Rect,
  color: string,
  fill: string,
  scale: number
) => {
  if (!labelText) return;
  const labelWidth = Math.max(Math.round(rect.width * 0.26), Math.round(48 * scale));
  const labelHeight = Math.max(12, Math.round(12 * scale));
  drawRoundedRect(
    ctx,
    {
      x: rect.x + (rect.width - labelWidth) / 2,
      y: rect.y + Math.max(2, Math.round(4 * scale)),
      width: labelWidth,
      height: labelHeight,
      radius: Math.round(labelHeight / 2)
    },
    { fill, stroke: '#000000', lineWidth: Math.max(1, Math.round(1.25 * scale)) }
  );
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `900 ${Math.max(7, Math.round(7 * scale))}px "Segoe UI", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(labelText, rect.x + rect.width / 2, rect.y + Math.max(2, Math.round(10 * scale)));
  ctx.restore();
};

const drawStyledHeaderTimer = (
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  style: ReturnType<typeof resolveVideoStyleModules>['timer'],
  visualTheme: (typeof VISUAL_THEMES)[VideoSettings['visualStyle']],
  textValue: string,
  headerBackground: string,
  options: {
    padX: number;
    padY: number;
    dotSize: number;
    gap: number;
    fontSize: number;
    scale: number;
  },
  isAlert: boolean,
  durationSeconds: number,
  remainingSeconds: number,
  progress: number
) => {
  if (isDesignerTimerStyle(style.id)) {
    drawDesignerTimerPreset({
      ctx,
      styleId: style.id,
      rect,
      durationSeconds,
      remainingSeconds,
      progress,
      isEndingSoon: isAlert,
      visualTheme
    });
    return;
  }

  const profile = resolveTimerRenderProfile(style);
  const timerBackground = buildTimerBackground(style, visualTheme);
  const timerTextColor = isAlert ? '#FF6B6B' : visualTheme.timerText;
  const accentColor = isAlert ? '#FF6B6B' : visualTheme.timerDot;
  const timerBorderColor = visualTheme.timerBorder;
  const labelFontSize = Math.max(7, Math.round(options.fontSize * 0.28));
  const mainRadius = radiusTokenToPx(style.radiusToken, rect.height, options.scale);

  if (profile.shadow !== 'none') {
    ctx.save();
    ctx.shadowColor = profile.shadow === 'glow' ? accentColor : 'rgba(0, 0, 0, 0.95)';
    ctx.shadowBlur = profile.shadow === 'glow' ? Math.max(6, Math.round(14 * options.scale)) : 0;
    ctx.shadowOffsetX = profile.shadow === 'offset' ? Math.max(2, Math.round(3 * options.scale)) : 0;
    ctx.shadowOffsetY = profile.shadow === 'offset' ? Math.max(2, Math.round(3 * options.scale)) : 0;
    drawRoundedRect(ctx, { ...rect, radius: mainRadius }, { fill: timerBackground, stroke: timerBorderColor, lineWidth: Math.max(2, Math.round(2 * options.scale)) });
    ctx.restore();
  } else {
    drawRoundedRect(ctx, { ...rect, radius: mainRadius }, { fill: timerBackground, stroke: timerBorderColor, lineWidth: Math.max(2, Math.round(2 * options.scale)) });
  }

  if (profile.family === 'chip') {
    const indicatorWidth = drawTimerIndicator(
      ctx,
      style,
      accentColor,
      rect.x + options.padX,
      rect.y + rect.height / 2,
      options.dotSize
    );
    drawTimerTextLeft(
      ctx,
      textValue,
      rect.x + options.padX + indicatorWidth + (style.dotKind === 'none' ? 0 : options.gap),
      rect.y + rect.height / 2,
      style,
      options.fontSize,
      timerTextColor
    );
    return;
  }

  if (profile.family === 'screen') {
    const labelWidth = profile.labelMode === 'left' ? Math.max(26, Math.round(options.fontSize * 1.25)) : 0;
    if (profile.labelMode === 'left') {
      drawRoundedRect(
        ctx,
        { x: rect.x, y: rect.y, width: labelWidth, height: rect.height, radius: Math.max(6, Math.round(8 * options.scale)) },
        { fill: accentColor, stroke: '#000000', lineWidth: Math.max(1, Math.round(1.5 * options.scale)) }
      );
      ctx.save();
      ctx.fillStyle = '#111827';
      ctx.font = `900 ${labelFontSize}px "Segoe UI", Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(profile.labelText, rect.x + labelWidth / 2, rect.y + rect.height / 2 + 1);
      ctx.restore();
    }
    const innerRect: Rect = {
      x: rect.x + labelWidth + Math.max(3, Math.round(4 * options.scale)),
      y: rect.y + Math.max(3, Math.round(4 * options.scale)),
      width: rect.width - labelWidth - Math.max(6, Math.round(8 * options.scale)),
      height: rect.height - Math.max(6, Math.round(8 * options.scale)),
      radius: Math.max(6, Math.round(8 * options.scale))
    };
    drawRoundedRect(
      ctx,
      innerRect,
      {
        fill:
          profile.ornament === 'double'
            ? 'rgba(15,23,42,0.95)'
            : 'rgba(255,255,255,0.18)',
        stroke: 'rgba(0,0,0,0.8)',
        lineWidth: Math.max(1, Math.round(1.5 * options.scale))
      }
    );
    if (profile.ornament === 'double') {
      for (let index = 0; index < 3; index += 1) {
        drawRoundedRect(
          ctx,
          {
            x: innerRect.x + Math.round(6 * options.scale) + index * Math.round(8 * options.scale),
            y: innerRect.y + innerRect.height / 2 - Math.max(1, Math.round(2 * options.scale)),
            width: Math.max(2, Math.round(4 * options.scale)),
            height: Math.max(2, Math.round(4 * options.scale)),
            radius: Math.max(1, Math.round(2 * options.scale))
          },
          { fill: accentColor }
        );
      }
    }
    const indicatorWidth = drawTimerIndicator(
      ctx,
      style,
      accentColor,
      innerRect.x + Math.max(10, Math.round(16 * options.scale)),
      innerRect.y + innerRect.height / 2,
      options.dotSize
    );
    drawTimerTextCentered(
      ctx,
      textValue,
      innerRect.x + innerRect.width / 2 + (style.dotKind === 'none' ? 0 : Math.round(indicatorWidth * 0.35)),
      innerRect.y + innerRect.height / 2,
      style,
      options.fontSize,
      timerTextColor
    );
    return;
  }

  if (profile.family === 'split') {
    if (profile.labelMode === 'top') {
      drawTimerLabel(ctx, profile.labelText, rect, accentColor, '#FFFFFF', options.scale);
    } else {
      const panelWidth = Math.max(28, Math.round(options.fontSize * 1.5));
      ctx.save();
      if (profile.ornament === 'chevron') {
        ctx.beginPath();
        ctx.moveTo(rect.x, rect.y);
        ctx.lineTo(rect.x + panelWidth - Math.round(8 * options.scale), rect.y);
        ctx.lineTo(rect.x + panelWidth, rect.y + rect.height / 2);
        ctx.lineTo(rect.x + panelWidth - Math.round(8 * options.scale), rect.y + rect.height);
        ctx.lineTo(rect.x, rect.y + rect.height);
        ctx.closePath();
        ctx.fillStyle = accentColor;
        ctx.fill();
        ctx.lineWidth = Math.max(1, Math.round(1.5 * options.scale));
        ctx.strokeStyle = '#000000';
        ctx.stroke();
      } else {
        drawRoundedRect(
          ctx,
          { x: rect.x, y: rect.y, width: panelWidth, height: rect.height, radius: Math.max(6, Math.round(8 * options.scale)) },
          { fill: accentColor, stroke: '#000000', lineWidth: Math.max(1, Math.round(1.5 * options.scale)) }
        );
      }
      ctx.fillStyle = '#111827';
      ctx.font = `900 ${labelFontSize}px "Segoe UI", Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(profile.labelText, rect.x + panelWidth / 2 - (profile.ornament === 'chevron' ? Math.round(4 * options.scale) : 0), rect.y + rect.height / 2 + 1);
      ctx.restore();
    }
    if (profile.ornament === 'panel') {
      drawRoundedRect(
        ctx,
        {
          x: rect.x + Math.max(3, Math.round(4 * options.scale)),
          y: rect.y + Math.max(3, Math.round(4 * options.scale)),
          width: rect.width - Math.max(6, Math.round(8 * options.scale)),
          height: rect.height - Math.max(6, Math.round(8 * options.scale)),
          radius: Math.max(6, Math.round(8 * options.scale))
        },
        { stroke: 'rgba(0,0,0,0.55)', lineWidth: Math.max(1, Math.round(1.2 * options.scale)) }
      );
    }
    const indicatorWidth = drawTimerIndicator(
      ctx,
      style,
      accentColor,
      rect.x + Math.max(8, Math.round(12 * options.scale)) + (profile.labelMode === 'left' ? Math.max(28, Math.round(options.fontSize * 1.5)) : 0),
      rect.y + rect.height / 2,
      options.dotSize
    );
    drawTimerTextCentered(
      ctx,
      textValue,
      rect.x + rect.width / 2 + (profile.labelMode === 'left' ? Math.round(options.fontSize * 0.3) : 0),
      rect.y + rect.height / 2 + (profile.labelMode === 'top' ? Math.round(options.fontSize * 0.1) : 0),
      style,
      options.fontSize,
      timerTextColor
    );
    return;
  }

  if (profile.family === 'ticket') {
    const notchRadius = Math.max(5, Math.round(6 * options.scale));
    ctx.save();
    ctx.fillStyle = headerBackground;
    ctx.beginPath();
    ctx.arc(rect.x, rect.y + rect.height / 2, notchRadius, 0, Math.PI * 2);
    ctx.arc(rect.x + rect.width, rect.y + rect.height / 2, notchRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    const labelWidth = Math.max(30, Math.round(options.fontSize * 1.35));
    ctx.save();
    ctx.setLineDash([Math.max(3, Math.round(3 * options.scale)), Math.max(3, Math.round(3 * options.scale))]);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = Math.max(1, Math.round(1.2 * options.scale));
    ctx.beginPath();
    ctx.moveTo(rect.x + labelWidth, rect.y + Math.max(4, Math.round(6 * options.scale)));
    ctx.lineTo(rect.x + labelWidth, rect.y + rect.height - Math.max(4, Math.round(6 * options.scale)));
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.fillStyle = accentColor;
    ctx.font = `900 ${labelFontSize}px "Segoe UI", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(profile.labelText, rect.x + labelWidth / 2, rect.y + rect.height / 2 + 1);
    ctx.restore();
    drawTimerTextCentered(
      ctx,
      textValue,
      rect.x + labelWidth + (rect.width - labelWidth) / 2,
      rect.y + rect.height / 2,
      style,
      options.fontSize,
      timerTextColor
    );
    return;
  }

  if (profile.family === 'flip') {
    const flipRect = { ...rect, radius: Math.max(6, Math.round(8 * options.scale)) };
    drawRoundedRect(ctx, flipRect, { fill: 'rgba(15,23,42,0.98)', stroke: timerBorderColor, lineWidth: Math.max(2, Math.round(2 * options.scale)) });
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(flipRect.x, flipRect.y, flipRect.width, flipRect.height / 2);
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.fillRect(flipRect.x, flipRect.y + flipRect.height / 2, flipRect.width, flipRect.height / 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.26)';
    ctx.lineWidth = Math.max(1, Math.round(1.2 * options.scale));
    ctx.beginPath();
    ctx.moveTo(flipRect.x, flipRect.y + flipRect.height / 2);
    ctx.lineTo(flipRect.x + flipRect.width, flipRect.y + flipRect.height / 2);
    ctx.stroke();
    if (profile.labelText) {
      ctx.fillStyle = accentColor;
      ctx.font = `900 ${labelFontSize}px "Segoe UI", Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(profile.labelText, flipRect.x + flipRect.width / 2, flipRect.y + Math.max(2, Math.round(3 * options.scale)));
    }
    drawTimerTextCentered(ctx, textValue, flipRect.x + flipRect.width / 2, flipRect.y + flipRect.height / 2 + Math.round(options.fontSize * 0.12), style, options.fontSize, timerTextColor);
    return;
  }

  if (profile.family === 'ring') {
    ctx.save();
    ctx.beginPath();
    ctx.arc(rect.x + rect.width / 2, rect.y + rect.height / 2, Math.max(8, rect.width / 2 - Math.max(4, Math.round(6 * options.scale))), 0, Math.PI * 2);
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = Math.max(3, Math.round(3 * options.scale));
    ctx.stroke();
    if (profile.ornament === 'double') {
      ctx.beginPath();
      ctx.arc(rect.x + rect.width / 2, rect.y + rect.height / 2, Math.max(6, rect.width / 2 - Math.max(10, Math.round(12 * options.scale))), 0, Math.PI * 2);
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = Math.max(1, Math.round(1.2 * options.scale));
      ctx.stroke();
    }
    ctx.restore();
    drawTimerLabel(ctx, profile.labelText, rect, accentColor, '#FFFFFF', options.scale);
    drawTimerTextCentered(ctx, textValue, rect.x + rect.width / 2, rect.y + rect.height / 2 + Math.round(options.fontSize * 0.1), style, options.fontSize, timerTextColor);
    return;
  }

  if (profile.family === 'sticker') {
    if (profile.ornament === 'double') {
      drawRoundedRect(
        ctx,
        {
          x: rect.x + Math.max(3, Math.round(3 * options.scale)),
          y: rect.y + Math.max(3, Math.round(3 * options.scale)),
          width: rect.width - Math.max(6, Math.round(6 * options.scale)),
          height: rect.height - Math.max(6, Math.round(6 * options.scale)),
          radius: Math.max(8, Math.round(10 * options.scale))
        },
        { stroke: 'rgba(0,0,0,0.45)', lineWidth: Math.max(1, Math.round(1.2 * options.scale)) }
      );
    }
    for (const orb of [
      { x: rect.x + Math.round(10 * options.scale), y: rect.y + Math.round(8 * options.scale), radius: Math.max(1, Math.round(2 * options.scale)), color: 'rgba(255,255,255,0.55)' },
      { x: rect.x + rect.width - Math.round(12 * options.scale), y: rect.y + rect.height - Math.round(10 * options.scale), radius: Math.max(1, Math.round(2 * options.scale)), color: 'rgba(255,255,255,0.45)' },
      { x: rect.x + rect.width - Math.round(10 * options.scale), y: rect.y + Math.round(12 * options.scale), radius: Math.max(1, Math.round(2 * options.scale)), color: accentColor }
    ]) {
      ctx.beginPath();
      ctx.arc(orb.x, orb.y, orb.radius, 0, Math.PI * 2);
      ctx.fillStyle = orb.color;
      ctx.fill();
    }
    if (profile.labelText) {
      drawTimerLabel(ctx, profile.labelText, rect, accentColor, '#FFFFFF', options.scale);
    }
    const indicatorWidth = drawTimerIndicator(
      ctx,
      style,
      accentColor,
      rect.x + Math.max(10, Math.round(12 * options.scale)),
      rect.y + rect.height / 2,
      options.dotSize
    );
    drawTimerTextCentered(
      ctx,
      textValue,
      rect.x + rect.width / 2 + (style.dotKind === 'none' ? 0 : Math.round(indicatorWidth * 0.3)),
      rect.y + rect.height / 2 + (profile.labelText ? Math.round(options.fontSize * 0.12) : 0),
      style,
      options.fontSize,
      timerTextColor
    );
    return;
  }

  if (profile.family === 'marquee') {
    const bulbs = 7;
    for (let index = 0; index < bulbs; index += 1) {
      const x = rect.x + Math.round((rect.width / (bulbs + 1)) * (index + 1));
      for (const y of [rect.y + Math.max(3, Math.round(4 * options.scale)), rect.y + rect.height - Math.max(3, Math.round(4 * options.scale))]) {
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1.5, Math.round(2 * options.scale)), 0, Math.PI * 2);
        ctx.fillStyle = index % 2 === 0 ? accentColor : '#FFFFFF';
        ctx.fill();
      }
    }
    drawRoundedRect(
      ctx,
      {
        x: rect.x + Math.max(6, Math.round(8 * options.scale)),
        y: rect.y + Math.max(6, Math.round(8 * options.scale)),
        width: rect.width - Math.max(12, Math.round(16 * options.scale)),
        height: rect.height - Math.max(12, Math.round(16 * options.scale)),
        radius: Math.max(6, Math.round(8 * options.scale))
      },
      { fill: 'rgba(255,255,255,0.08)', stroke: 'rgba(0,0,0,0.7)', lineWidth: Math.max(1, Math.round(1.2 * options.scale)) }
    );
    drawTimerLabel(ctx, profile.labelText, rect, accentColor, '#FFFFFF', options.scale);
    drawTimerTextCentered(ctx, textValue, rect.x + rect.width / 2, rect.y + rect.height / 2 + Math.round(options.fontSize * 0.12), style, options.fontSize, timerTextColor);
    return;
  }

  if (profile.family === 'frame') {
    if (profile.ornament === 'double') {
      drawRoundedRect(
        ctx,
        {
          x: rect.x + Math.max(3, Math.round(4 * options.scale)),
          y: rect.y + Math.max(3, Math.round(4 * options.scale)),
          width: rect.width - Math.max(6, Math.round(8 * options.scale)),
          height: rect.height - Math.max(6, Math.round(8 * options.scale)),
          radius: Math.max(6, Math.round(6 * options.scale))
        },
        { stroke: 'rgba(0,0,0,0.55)', lineWidth: Math.max(1, Math.round(1.2 * options.scale)) }
      );
    }
    if (profile.ornament === 'brackets') {
      const bracket = Math.max(6, Math.round(8 * options.scale));
      ctx.save();
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = Math.max(1, Math.round(1.5 * options.scale));
      for (const [startX, startY, horizontal, vertical] of [
        [rect.x + 2, rect.y + bracket, rect.x + 2, rect.y + 2],
        [rect.x + bracket, rect.y + 2, rect.x + 2, rect.y + 2],
        [rect.x + rect.width - bracket, rect.y + 2, rect.x + rect.width - 2, rect.y + 2],
        [rect.x + rect.width - 2, rect.y + bracket, rect.x + rect.width - 2, rect.y + 2],
        [rect.x + 2, rect.y + rect.height - bracket, rect.x + 2, rect.y + rect.height - 2],
        [rect.x + bracket, rect.y + rect.height - 2, rect.x + 2, rect.y + rect.height - 2],
        [rect.x + rect.width - bracket, rect.y + rect.height - 2, rect.x + rect.width - 2, rect.y + rect.height - 2],
        [rect.x + rect.width - 2, rect.y + rect.height - bracket, rect.x + rect.width - 2, rect.y + rect.height - 2]
      ] as Array<[number, number, number, number]>) {
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(horizontal, vertical);
        ctx.stroke();
      }
      ctx.restore();
    }
    const labelOffset = profile.labelMode === 'left' ? Math.max(24, Math.round(options.fontSize * 1.15)) : 0;
    if (profile.labelMode === 'left') {
      ctx.save();
      ctx.fillStyle = accentColor;
      ctx.font = `900 ${labelFontSize}px "Segoe UI", Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(profile.labelText, rect.x + labelOffset / 2, rect.y + rect.height / 2 + 1);
      ctx.restore();
      ctx.beginPath();
      ctx.moveTo(rect.x + labelOffset, rect.y + Math.max(4, Math.round(6 * options.scale)));
      ctx.lineTo(rect.x + labelOffset, rect.y + rect.height - Math.max(4, Math.round(6 * options.scale)));
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = Math.max(1, Math.round(1.2 * options.scale));
      ctx.stroke();
    }
    drawTimerTextCentered(
      ctx,
      textValue,
      rect.x + labelOffset + (rect.width - labelOffset) / 2,
      rect.y + rect.height / 2,
      style,
      options.fontSize,
      timerTextColor
    );
    return;
  }

  if (profile.family === 'dual') {
    const labelWidth = profile.labelMode === 'left' ? Math.max(28, Math.round(options.fontSize * 1.2)) : 0;
    if (profile.labelMode === 'left') {
      drawRoundedRect(
        ctx,
        {
          x: rect.x + Math.max(2, Math.round(3 * options.scale)),
          y: rect.y + Math.max(3, Math.round(4 * options.scale)),
          width: labelWidth,
          height: rect.height - Math.max(6, Math.round(8 * options.scale)),
          radius: Math.max(8, Math.round(10 * options.scale))
        },
        { fill: accentColor, stroke: '#000000', lineWidth: Math.max(1, Math.round(1.2 * options.scale)) }
      );
      ctx.save();
      ctx.fillStyle = '#111827';
      ctx.font = `900 ${labelFontSize}px "Segoe UI", Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(profile.labelText, rect.x + Math.max(2, Math.round(3 * options.scale)) + labelWidth / 2, rect.y + rect.height / 2 + 1);
      ctx.restore();
    }
    drawRoundedRect(
      ctx,
      {
        x: rect.x + labelWidth + Math.max(4, Math.round(6 * options.scale)),
        y: rect.y + Math.max(4, Math.round(5 * options.scale)),
        width: rect.width - labelWidth - Math.max(8, Math.round(12 * options.scale)),
        height: rect.height - Math.max(8, Math.round(10 * options.scale)),
        radius: Math.max(10, Math.round(12 * options.scale))
      },
      { fill: 'rgba(255,255,255,0.2)', stroke: 'rgba(0,0,0,0.75)', lineWidth: Math.max(1, Math.round(1.2 * options.scale)) }
    );
    drawTimerTextCentered(
      ctx,
      textValue,
      rect.x + labelWidth + (rect.width - labelWidth) / 2,
      rect.y + rect.height / 2,
      style,
      options.fontSize,
      timerTextColor
    );
    return;
  }
};

const resolveAnchoredRect = (
  anchor: HudAnchorSpec,
  width: number,
  height: number,
  container: Rect,
  scale: number
): Rect => {
  const left = anchor.left === undefined ? undefined : anchor.left * scale;
  const right = anchor.right === undefined ? undefined : anchor.right * scale;
  const top = anchor.top === undefined ? undefined : anchor.top * scale;
  const bottom = anchor.bottom === undefined ? undefined : anchor.bottom * scale;

  let x = container.x;
  if (anchor.centerX) {
    x = container.x + (container.width - width) / 2;
  } else if (left !== undefined) {
    x = container.x + left;
  } else if (right !== undefined) {
    x = container.x + container.width - right - width;
  }

  let y = container.y;
  if (anchor.centerY) {
    y = container.y + (container.height - height) / 2;
  } else if (top !== undefined) {
    y = container.y + top;
  } else if (bottom !== undefined) {
    y = container.y + container.height - bottom - height;
  }

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height)
  };
};

const throwIfCanceled = () => {
  if (isCanceled) {
    throw new Error('__EXPORT_CANCELED__');
  }
};

const createTelemetryState = (): VideoExportTelemetryState => ({
  startedAt: performance.now(),
  lastStatsAt: 0,
  renderedFrames: 0,
  totalRenderMs: 0,
  totalEncodeMs: 0,
  cacheEntries: 0,
  hotPuzzleCount: 0
});

const emitTaskEvent = (event: MediaTaskEventMessage['event']) => {
  postMessageToMain({
    type: 'task-event',
    event: {
      workerId: getVideoWorkerId(),
      timestamp: Date.now(),
      ...event
    }
  });
};

const emitStats = (
  telemetry: VideoExportTelemetryState,
  {
    queueSize,
    runningTasks,
    remainingFrames,
    force = false
  }: {
    queueSize: number;
    runningTasks: number;
    remainingFrames: number;
    force?: boolean;
  }
) => {
  const now = Date.now();
  if (!force && now - telemetry.lastStatsAt < 250) {
    return;
  }
  telemetry.lastStatsAt = now;
  const elapsedSeconds = Math.max(0.001, (performance.now() - telemetry.startedAt) / 1000);
  const totalTaskMs = telemetry.totalRenderMs + telemetry.totalEncodeMs;
  postMessageToMain({
    type: 'stats',
    stats: {
      workerId: getVideoWorkerId(),
      label: 'Video Export Worker',
      runtimeKind: 'worker',
      activeWorkers: 1,
      queueSize: Math.max(0, queueSize),
      runningTasks: Math.max(0, runningTasks),
      avgTaskMs: telemetry.renderedFrames > 0 ? totalTaskMs / telemetry.renderedFrames : 0,
      fps: telemetry.renderedFrames / elapsedSeconds,
      bytesInFlight: 0,
      stageQueueDepths: {
        render: Math.max(0, remainingFrames),
        encode: runningTasks > 0 ? 1 : 0
      },
      metrics: {
        cacheEntries: telemetry.cacheEntries,
        hotPuzzleCount: telemetry.hotPuzzleCount,
        renderedFrames: telemetry.renderedFrames,
        avgRenderMs: telemetry.renderedFrames > 0 ? telemetry.totalRenderMs / telemetry.renderedFrames : 0,
        avgEncodeMs: telemetry.renderedFrames > 0 ? telemetry.totalEncodeMs / telemetry.renderedFrames : 0
      },
      updatedAt: now
    }
  });
};

const loadImage = async (src: string): Promise<ImageBitmap> => {
  const response = await fetch(src);
  if (!response.ok) {
    throw new Error('Failed to fetch puzzle image for export.');
  }
  const blob = await response.blob();
  throwIfCanceled();
  return await decodeRuntimeImageBitmapFromBlob(blob);
};

const loadLogoImage = async (src: string): Promise<ImageBitmap> => {
  const blob = isStoredImageAssetSource(src)
    ? await loadImageAssetBlob(src)
    : await (async () => {
        const response = await fetch(src);
        if (!response.ok) {
          throw new Error('Failed to fetch logo image for export.');
        }
        return await response.blob();
      })();
  if (!blob) {
    throw new Error('Failed to load logo image for export.');
  }
  throwIfCanceled();

  const baseBitmap = await decodeRuntimeImageBitmapFromBlob(blob);
  const isSvg =
    blob.type.includes('svg') ||
    src.startsWith('data:image/svg+xml') ||
    src.startsWith('data:image/svg+xml;base64,');

  if (!isSvg) {
    return baseBitmap;
  }

  const maxDimension = Math.max(baseBitmap.width, baseBitmap.height);
  if (maxDimension >= 2048 || maxDimension <= 0) {
    return baseBitmap;
  }

  const scale = 2048 / maxDimension;
  const targetWidth = Math.max(1, Math.round(baseBitmap.width * scale));
  const targetHeight = Math.max(1, Math.round(baseBitmap.height * scale));

  try {
    const resizedBitmap = await createImageBitmap(blob, {
      resizeWidth: targetWidth,
      resizeHeight: targetHeight,
      resizeQuality: 'high'
    });
    releaseBitmap(baseBitmap);
    return resizedBitmap;
  } catch {
    return baseBitmap;
  }
};

const prepareIntroVideoResource = async (file: File): Promise<IntroVideoResource> => {
  try {
    const input = new Input({
      source: new BlobSource(file),
      formats: ALL_FORMATS
    });
    const track = await input.getPrimaryVideoTrack();
    if (!track) {
      throw new Error('The intro clip does not contain a video track.');
    }
    const sink = new CanvasSink(track, { alpha: true });
    let duration = 0;
    try {
      duration = await track.computeDuration();
    } catch {
      duration = 0;
    }
    return {
      sink,
      duration
    };
  } catch (error) {
    if (error instanceof Error && error.message === 'The intro clip does not contain a video track.') {
      throw error;
    }
    const detail = error instanceof Error && error.message ? ` ${error.message}` : '';
    throw new Error(
      `Failed to decode the intro clip for export. Re-save it as MP4 (H.264/AAC) or disable the intro clip.${detail}`
    );
  }
};

const drawIntroVideoFrame = async (
  ctx: CanvasRenderingContext2D,
  introVideo: IntroVideoResource,
  phaseElapsed: number,
  width: number,
  height: number
) => {
  const safeDuration = introVideo.duration > 0.01 ? introVideo.duration : Math.max(0.5, phaseElapsed);
  const sampleTimestamp = Math.min(Math.max(0, phaseElapsed), Math.max(0, safeDuration - 1 / FPS));
  const wrapped = await introVideo.sink.getCanvas(sampleTimestamp);
  const canvas = (wrapped?.canvas as OffscreenCanvas | undefined) ?? null;
  if (!canvas) {
    return false;
  }
  drawImageCover(ctx, canvas, { x: 0, y: 0, width, height, radius: 0 });
  return true;
};

const loadBinaryImage = async (buffer: ArrayBuffer, mimeType: string): Promise<ImageBitmap> => {
  throwIfCanceled();
  return await decodeRuntimeImageBitmapFromBlob(new Blob([buffer], { type: mimeType || 'image/png' }));
};

const releaseBitmap = (bitmap: ImageBitmap | null | undefined) => {
  if (!bitmap) return;
  if (typeof bitmap.close === 'function') {
    bitmap.close();
  }
};

const releaseLoadedPuzzleImages = (images: LoadedPuzzleImages | null | undefined) => {
  if (!images) return;
  releaseBitmap(images.original);
  releaseBitmap(images.modified);
};

const createPuzzleAssetCache = (
  source: RenderSourceKind,
  puzzles: RenderablePuzzle[],
  telemetry: VideoExportTelemetryState
) => {
  const loadedImages: Array<LoadedPuzzleImages | null> = new Array(puzzles.length).fill(null);
  const pendingLoads = new Map<number, Promise<LoadedPuzzleImages>>();

  const updateTelemetry = () => {
    telemetry.cacheEntries = loadedImages.filter(Boolean).length;
    telemetry.hotPuzzleCount = loadedImages.reduce((count, entry) => count + (entry ? 1 : 0), 0);
  };

  const ensureLoaded = async (index: number): Promise<LoadedPuzzleImages | null> => {
    if (index < 0 || index >= puzzles.length) {
      return null;
    }

    const existing = loadedImages[index];
    if (existing) {
      updateTelemetry();
      return existing;
    }

    const pending = pendingLoads.get(index);
    if (pending) {
      return await pending;
    }

    const loadPromise = (async () => {
      const puzzle = puzzles[index];
      const [original, modified] =
        source === 'binary'
          ? await Promise.all([
              loadBinaryImage((puzzle as BinaryRenderablePuzzle).imageABuffer, (puzzle as BinaryRenderablePuzzle).mimeType),
              loadBinaryImage((puzzle as BinaryRenderablePuzzle).imageBBuffer, (puzzle as BinaryRenderablePuzzle).mimeType)
            ])
          : await Promise.all([
              loadImage((puzzle as Puzzle).imageA),
              loadImage((puzzle as Puzzle).imageB)
            ]);
      const images = {
        original,
        modified
      };
      loadedImages[index] = images;
      pendingLoads.delete(index);
      updateTelemetry();
      return images;
    })().catch((error) => {
      pendingLoads.delete(index);
      throw error;
    });

    pendingLoads.set(index, loadPromise);
    return await loadPromise;
  };

  const evictOutsideWindow = (keepIndices: Set<number>) => {
    loadedImages.forEach((images, index) => {
      if (!images) return;
      if (keepIndices.has(index) || pendingLoads.has(index)) {
        return;
      }
      releaseLoadedPuzzleImages(images);
      loadedImages[index] = null;
    });
    updateTelemetry();
  };

  const ensureWindow = async (centerIndex: number) => {
    const keepIndices = new Set<number>();
    for (let offset = -1; offset <= 2; offset += 1) {
      const nextIndex = centerIndex + offset;
      if (nextIndex < 0 || nextIndex >= puzzles.length) continue;
      keepIndices.add(nextIndex);
    }
    await Promise.all([...keepIndices].map((index) => ensureLoaded(index)));
    evictOutsideWindow(keepIndices);
  };

  const releaseAll = () => {
    pendingLoads.clear();
    loadedImages.forEach((images, index) => {
      if (!images) return;
      releaseLoadedPuzzleImages(images);
      loadedImages[index] = null;
    });
    updateTelemetry();
  };

  return {
    loadedImages,
    ensureWindow,
    releaseAll
  };
};

const getExportDimensions = (
  aspectRatio: VideoSettings['aspectRatio'],
  resolution: VideoSettings['exportResolution']
) => {
  const baseHeight = RESOLUTION_HEIGHT[resolution];
  const baseStage = BASE_STAGE_SIZE[aspectRatio];
  if (baseStage.width >= baseStage.height) {
    return {
      width: even((baseHeight * baseStage.width) / baseStage.height),
      height: even(baseHeight)
    };
  }
  return {
    width: even(baseHeight),
    height: even((baseHeight * baseStage.height) / baseStage.width)
  };
};

const computeCoverFrame = (
  viewport: Rect,
  image: {
    width: number;
    height: number;
  }
): Rect => {
  const imageWidth = image.width;
  const imageHeight = image.height;

  if (imageWidth <= 0 || imageHeight <= 0) {
    return { ...viewport };
  }

  const scale = Math.max(viewport.width / imageWidth, viewport.height / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;

  return {
    x: viewport.x + (viewport.width - width) / 2,
    y: viewport.y + (viewport.height - height) / 2,
    width,
    height
  };
};

const drawImageCover = (ctx: CanvasRenderingContext2D, image: CanvasImageSource & { width: number; height: number }, panel: Rect) => {
  const coverFrame = computeCoverFrame(panel, image);
  ctx.save();
  roundRectPath(ctx, panel);
  ctx.clip();
  ctx.drawImage(image, coverFrame.x, coverFrame.y, coverFrame.width, coverFrame.height);
  ctx.restore();
  return coverFrame;
};

const computeContainFrame = (viewport: Rect, image: ImageBitmap): Rect => {
  const imageWidth = image.width;
  const imageHeight = image.height;

  if (imageWidth <= 0 || imageHeight <= 0) {
    return { ...viewport };
  }

  const scale = Math.min(viewport.width / imageWidth, viewport.height / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;

  return {
    x: viewport.x + (viewport.width - width) / 2,
    y: viewport.y + (viewport.height - height) / 2,
    width,
    height
  };
};

const drawImageContain = (
  ctx: CanvasRenderingContext2D,
  image: ImageBitmap,
  panel: Rect,
  zoom = 1
) => {
  const containFrame = computeContainFrame(panel, image);
  const safeZoom = clampLogoZoom(zoom);
  const zoomedWidth = containFrame.width * safeZoom;
  const zoomedHeight = containFrame.height * safeZoom;
  const zoomedFrame = {
    x: containFrame.x - (zoomedWidth - containFrame.width) / 2,
    y: containFrame.y - (zoomedHeight - containFrame.height) / 2,
    width: zoomedWidth,
    height: zoomedHeight
  };
  ctx.drawImage(image, zoomedFrame.x, zoomedFrame.y, zoomedFrame.width, zoomedFrame.height);
  return zoomedFrame;
};

const processLogoBitmap = async (logo: ImageBitmap) => logo;

const normalizeRegion = (region: Region, image: ImageBitmap) => {
  const imageWidth = image.width || 1;
  const imageHeight = image.height || 1;
  const ratioBased = region.x <= 1 && region.y <= 1 && region.width <= 1 && region.height <= 1;
  if (ratioBased) return region;

  return {
    ...region,
    x: region.x / imageWidth,
    y: region.y / imageHeight,
    width: region.width / imageWidth,
    height: region.height / imageHeight
  };
};

const getMarkerBounds = (
  region: Region,
  frame: Rect,
  image: ImageBitmap,
  settings: VideoSettings,
  revealVariant: VideoSettings['revealVariant']
): MarkerBounds => {
  const normalized = normalizeRegion(region, image);

  const clampedX = clamp(normalized.x, 0, 1);
  const clampedY = clamp(normalized.y, 0, 1);
  const clampedWidth = clamp(normalized.width, 0, 1 - clampedX);
  const clampedHeight = clamp(normalized.height, 0, 1 - clampedY);
  const centerX = clampedX + clampedWidth / 2;
  const centerY = clampedY + clampedHeight / 2;

  const isCircleReveal = settings.revealStyle === 'circle';
  const minMarkerPx = isCircleReveal ? 42 : 36;
  const minWidthNormalized = frame.width > 0 ? minMarkerPx / frame.width : 0.05;
  const minHeightNormalized = frame.height > 0 ? minMarkerPx / frame.height : 0.05;
  const regionPixelMax = Math.max(clampedWidth * frame.width, clampedHeight * frame.height);
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
  const expandedWidth = clamp(Math.max(clampedWidth * expansionFactor, minWidthNormalized), 0, 1);
  const expandedHeight = clamp(Math.max(clampedHeight * expansionFactor, minHeightNormalized), 0, 1);
  const circleSize = clamp(Math.max(expandedWidth, expandedHeight), 0, 1);
  const rawCircleLeft = centerX - circleSize / 2;
  const rawCircleTop = centerY - circleSize / 2;
  const circleLeft = clamp(rawCircleLeft, 0, 1 - circleSize);
  const circleTop = clamp(rawCircleTop, 0, 1 - circleSize);
  const boxLeft = clamp(centerX - expandedWidth / 2, 0, 1 - expandedWidth);
  const boxTop = clamp(centerY - expandedHeight / 2, 0, 1 - expandedHeight);

  const isEllipseVariant =
    settings.revealStyle === 'circle' &&
    (revealVariant === 'circle_ellipse' || revealVariant === 'circle_ellipse_dotted');

  const useSquareCircleFrame = settings.revealStyle === 'circle' && !isEllipseVariant;
  const markerX = useSquareCircleFrame ? circleLeft : boxLeft;
  const markerY = useSquareCircleFrame ? circleTop : boxTop;
  const markerW = useSquareCircleFrame ? circleSize : expandedWidth;
  const markerH = useSquareCircleFrame ? circleSize : expandedHeight;

  return {
    x: frame.x + markerX * frame.width,
    y: frame.y + markerY * frame.height,
    width: markerW * frame.width,
    height: markerH * frame.height
  };
};

const resolveSceneText = (
  segment: TimelineSegment,
  puzzles: RenderablePuzzle[],
  settings: VideoSettings
) => {
  const currentPuzzleNumber = segment.puzzleIndex + 1;
  const nextPuzzleNumber = Math.min(puzzles.length, segment.puzzleIndex + 2);
  const templateValues = {
    current: currentPuzzleNumber,
    next: nextPuzzleNumber,
    total: puzzles.length,
    puzzleCount: puzzles.length,
    remaining: Math.max(0, puzzles.length - currentPuzzleNumber),
    preset: ''
  };
  const introEyebrow = fillTemplate(settings.textTemplates.introEyebrow, templateValues);
  const introTitle = fillTemplate(settings.textTemplates.introTitle, templateValues);
  const introSubtitle = fillTemplate(settings.textTemplates.introSubtitle, templateValues);
  const playModeTitle = fillTemplate(settings.textTemplates.playTitle, templateValues);
  const playModeSubtitle = fillTemplate(settings.textTemplates.playSubtitle, templateValues);
  const revealModeTitle = fillTemplate(settings.textTemplates.revealTitle, templateValues);
  const transitionEyebrow = fillTemplate(settings.textTemplates.transitionEyebrow, templateValues);
  const transitionTitle = fillTemplate(settings.textTemplates.transitionTitle, templateValues);
  const transitionSubtitle = fillTemplate(settings.textTemplates.transitionSubtitle, templateValues);
  const completionEyebrow = fillTemplate(settings.textTemplates.completionEyebrow, templateValues);
  const completionTitle = fillTemplate(settings.textTemplates.completionTitle, templateValues);
  const completionSubtitle = fillTemplate(settings.textTemplates.completionSubtitle, templateValues);

  return {
    title:
      segment.phase === 'intro'
        ? introTitle
        : segment.phase === 'revealing'
        ? revealModeTitle
        : segment.phase === 'transitioning'
        ? transitionTitle
        : segment.phase === 'outro'
        ? completionTitle
        : playModeTitle,
    subtitle:
      segment.phase === 'intro'
        ? introSubtitle
        : segment.phase === 'transitioning'
        ? transitionSubtitle
        : segment.phase === 'outro'
        ? completionSubtitle
        : playModeSubtitle,
    cardEyebrow:
      segment.phase === 'intro'
        ? introEyebrow
        : segment.phase === 'transitioning'
        ? transitionEyebrow
        : segment.phase === 'outro'
        ? completionEyebrow
        : ''
  };
};

const resolveIntroDuration = (settings: VideoSettings) => {
  if (settings.introVideoEnabled && settings.introVideoSrc) {
    const clipDuration = Number(settings.introVideoDuration);
    if (Number.isFinite(clipDuration) && clipDuration > 0) {
      return clipDuration;
    }
    const fallbackDuration = Number(settings.sceneSettings.introDuration);
    return Number.isFinite(fallbackDuration) ? Math.max(0, fallbackDuration) : 0;
  }

  return settings.sceneSettings.introEnabled
    ? Math.max(0, settings.sceneSettings.introDuration)
    : 0;
};

const buildTimeline = (puzzles: RenderablePuzzle[], settings: VideoSettings): TimelineSegment[] => {
  const showDuration = Math.max(0.1, settings.showDuration);
  const revealDuration = Math.max(0.5, settings.revealDuration);
  const transitionDuration = Math.max(0, settings.transitionDuration);
  const introDuration = resolveIntroDuration(settings);
  const outroDuration = settings.sceneSettings.outroEnabled
    ? Math.max(0, settings.sceneSettings.outroDuration)
    : 0;

  let cursor = 0;
  const timeline: TimelineSegment[] = [];

  if (introDuration > 0) {
    timeline.push({
      puzzleIndex: 0,
      phase: 'intro',
      start: cursor,
      duration: introDuration,
      end: cursor + introDuration
    });
    cursor += introDuration;
  }

  puzzles.forEach((_, puzzleIndex) => {
    timeline.push({
      puzzleIndex,
      phase: 'showing',
      start: cursor,
      duration: showDuration,
      end: cursor + showDuration
    });
    cursor += showDuration;

    timeline.push({
      puzzleIndex,
      phase: 'revealing',
      start: cursor,
      duration: revealDuration,
      end: cursor + revealDuration
    });
    cursor += revealDuration;

    if (puzzleIndex < puzzles.length - 1 && transitionDuration > 0) {
      timeline.push({
        puzzleIndex,
        phase: 'transitioning',
        start: cursor,
        duration: transitionDuration,
        end: cursor + transitionDuration
      });
      cursor += transitionDuration;
    }
  });

  if (outroDuration > 0) {
    timeline.push({
      puzzleIndex: Math.max(0, puzzles.length - 1),
      phase: 'outro',
      start: cursor,
      duration: outroDuration,
      end: cursor + outroDuration
    });
    cursor += outroDuration;
  }

  return timeline;
};

const getSceneAtTime = (
  timestamp: number,
  timeline: TimelineSegment[],
  puzzles: RenderablePuzzle[],
  settings: VideoSettings
): RenderScene => {
  const segment =
    timeline.find((currentSegment) => timestamp >= currentSegment.start && timestamp < currentSegment.end) ??
    timeline[timeline.length - 1];
  const puzzle = puzzles[segment.puzzleIndex];
  const phaseElapsed = clamp(timestamp - segment.start, 0, segment.duration);
  const timeLeft = Math.max(0, segment.duration - phaseElapsed);
  const progressPercent = segment.duration > 0 ? (phaseElapsed / segment.duration) * 100 : 100;
  const countdownPercent = segment.duration > 0 ? (timeLeft / Math.max(0.1, segment.duration)) * 100 : 0;
  const sceneText = resolveSceneText(segment, puzzles, settings);

  let revealedRegionCount = 0;
  let blinkOverlayActive = false;
  let blinkOverlayVisible = false;

  if (segment.phase === 'revealing') {
    const revealPhaseDuration = Math.max(0.5, settings.revealDuration);
    const revealRegionCount = puzzle.regions.length;
    const isBlinkingEnabled = settings.enableBlinking !== false;
    const blinkCycleDuration = Math.max(0.2, settings.blinkSpeed);
    const revealStepSeconds = Math.min(
      Math.max(0.5, settings.sequentialRevealStep),
      revealPhaseDuration / Math.max(1, revealRegionCount + 1)
    );
    const revealBlinkStartTime =
      revealRegionCount > 0
        ? Math.max(0, (revealRegionCount - 1) * revealStepSeconds + blinkCycleDuration)
        : 0;
    const revealElapsed = clamp(phaseElapsed, 0, revealPhaseDuration);

    revealedRegionCount =
      revealRegionCount > 0 ? Math.min(revealRegionCount, Math.floor(revealElapsed / revealStepSeconds) + 1) : 0;

    blinkOverlayActive = isBlinkingEnabled && revealRegionCount > 0 && revealElapsed >= revealBlinkStartTime;
    if (blinkOverlayActive) {
      const halfCycle = Math.max(0.05, Math.max(0.2, settings.blinkSpeed) / 2);
      const blinkElapsed = revealElapsed - revealBlinkStartTime;
      blinkOverlayVisible = Math.floor(blinkElapsed / halfCycle) % 2 === 0;
    }
  }

  return {
    segment,
    phaseElapsed,
    timeLeft,
    progressPercent,
    countdownPercent,
    revealedRegionCount,
    blinkOverlayActive,
    blinkOverlayVisible,
    title: sceneText.title,
    subtitle: sceneText.subtitle,
    cardEyebrow: sceneText.cardEyebrow
  };
};

const fitTextSize = (
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  initialSize: number,
  fontFamily: string,
  fontWeight = 900,
  minSize = 12
) => {
  let size = initialSize;
  ctx.font = `${fontWeight} ${size}px ${fontFamily}`;
  while (size > minSize && ctx.measureText(text).width > maxWidth) {
    size -= 1;
    ctx.font = `${fontWeight} ${size}px ${fontFamily}`;
  }
  return size;
};

const drawSceneCard = (
  ctx: CanvasRenderingContext2D,
  gameRect: Rect,
  scene: RenderScene,
  settings: VideoSettings,
  visualTheme: typeof VISUAL_THEMES[VideoSettings['visualStyle']],
  isVerticalLayout: boolean,
  uiScale: number
) => {
  const kind: SceneCardKind =
    scene.segment.phase === 'intro'
      ? 'intro'
      : scene.segment.phase === 'outro'
      ? 'outro'
      : 'transition';
  const packagePreset =
    VIDEO_PACKAGE_PRESETS[settings.videoPackagePreset] ?? VIDEO_PACKAGE_PRESETS.gameshow;
  const styleModules = resolveVideoStyleModules(settings, packagePreset);
  const variant =
      kind === 'intro'
      ? styleModules.sceneCards.intro
      : kind === 'outro'
      ? styleModules.sceneCards.outro
      : styleModules.sceneCards.transition;
  const transitionProgress = kind === 'transition' ? clamp(scene.progressPercent / 100, 0, 1) : 0;
  const transitionSmooth =
    kind === 'transition'
      ? transitionProgress * transitionProgress * (3 - 2 * transitionProgress)
      : 0;
  const transitionCardOpacity =
    kind === 'transition'
      ? clamp(
          TRANSITION_TUNING.cardOpacityBase +
            transitionSmooth * (TRANSITION_TUNING.cardOpacityPulse - 0.3) -
            transitionProgress * TRANSITION_TUNING.cardOpacityDecay,
          styleModules.transition.activeOpacityFloor,
          1
        )
      : 1;
  const transitionCardTranslateY =
    kind === 'transition'
      ? Math.round(
          (1 - transitionSmooth) *
            (TRANSITION_TUNING.cardTranslateY + 8) *
            styleModules.transition.cardTranslateMultiplier
        )
      : 0;
  const transitionCardScale =
    kind === 'transition'
      ? TRANSITION_TUNING.cardScaleBase +
        transitionSmooth * (TRANSITION_TUNING.cardScalePulse + 0.04 + styleModules.transition.cardScaleBoost)
      : 1;
  const transitionCardGlowOpacity =
    0.18 + transitionSmooth * (0.34 + styleModules.transition.cardGlowBoost);

  ctx.save();
  roundRectPath(ctx, gameRect);
  ctx.clip();

  if (variant === 'storybook') {
    const overlay = ctx.createLinearGradient(gameRect.x, gameRect.y, gameRect.x, gameRect.y + gameRect.height);
    overlay.addColorStop(
      0,
      `rgba(52,35,14,${kind === 'transition' ? (0.24 + transitionSmooth * 0.44).toFixed(3) : '0.48'})`
    );
    overlay.addColorStop(1, 'rgba(19,11,4,0.74)');
    ctx.fillStyle = overlay;
  } else if (variant === 'spotlight') {
    const overlay = ctx.createRadialGradient(
      gameRect.x + gameRect.width / 2,
      gameRect.y + gameRect.height / 2,
      Math.max(1, gameRect.width * 0.08),
      gameRect.x + gameRect.width / 2,
      gameRect.y + gameRect.height / 2,
      Math.max(gameRect.width, gameRect.height)
    );
    overlay.addColorStop(
      0,
      `rgba(15,23,42,${kind === 'transition' ? (0.18 + transitionSmooth * 0.2).toFixed(3) : '0.12'})`
    );
    overlay.addColorStop(0.72, 'rgba(2,6,23,0.88)');
    overlay.addColorStop(1, 'rgba(1,4,14,0.96)');
    ctx.fillStyle = overlay;
  } else if (variant === 'celebration') {
    const overlay = ctx.createRadialGradient(
      gameRect.x + gameRect.width / 2,
      gameRect.y,
      Math.max(1, gameRect.width * 0.03),
      gameRect.x + gameRect.width / 2,
      gameRect.y,
      Math.max(gameRect.width, gameRect.height)
    );
    overlay.addColorStop(
      0,
      `rgba(255,255,255,${kind === 'transition' ? (0.22 + transitionSmooth * 0.12).toFixed(3) : '0.26'})`
    );
    overlay.addColorStop(1, 'rgba(17,24,39,0.2)');
    ctx.fillStyle = overlay;
  } else if (variant === 'scoreboard') {
    const overlay = ctx.createRadialGradient(
      gameRect.x + gameRect.width / 2,
      gameRect.y,
      Math.max(1, gameRect.width * 0.04),
      gameRect.x + gameRect.width / 2,
      gameRect.y,
      Math.max(gameRect.width, gameRect.height)
    );
    overlay.addColorStop(
      0,
      `rgba(34,211,238,${kind === 'transition' ? (0.16 + transitionSmooth * 0.16).toFixed(3) : '0.14'})`
    );
    overlay.addColorStop(0.58, 'rgba(8,15,28,0.82)');
    overlay.addColorStop(1, 'rgba(2,6,16,0.92)');
    ctx.fillStyle = overlay;
  } else {
    const overlay = ctx.createLinearGradient(gameRect.x, gameRect.y, gameRect.x, gameRect.y + gameRect.height);
    overlay.addColorStop(
      0,
      `rgba(255,255,255,${kind === 'transition' ? (0.18 + transitionSmooth * 0.16).toFixed(3) : '0.22'})`
    );
    overlay.addColorStop(1, 'rgba(17,24,39,0.18)');
    ctx.fillStyle = overlay;
  }
  ctx.fillRect(gameRect.x, gameRect.y, gameRect.width, gameRect.height);

  const maxCardWidth = Math.min(gameRect.width * (isVerticalLayout ? 0.88 : 0.72), Math.round(760 * uiScale));
  const minCardWidth = Math.min(maxCardWidth, Math.round((isVerticalLayout ? 300 : 520) * uiScale));
  const cardWidth = Math.max(minCardWidth, Math.min(maxCardWidth, gameRect.width * 0.7));
  const cardHeight = Math.min(gameRect.height * 0.62, Math.max(Math.round(210 * uiScale), Math.round(280 * uiScale)));
  const cardCenterX = gameRect.x + gameRect.width / 2;
  const cardCenterY = gameRect.y + gameRect.height / 2 + transitionCardTranslateY;

  ctx.save();
  ctx.translate(cardCenterX, cardCenterY);
  ctx.scale(transitionCardScale, transitionCardScale);
  ctx.globalAlpha = transitionCardOpacity;
  ctx.shadowColor =
    variant === 'storybook'
      ? `rgba(229,191,115,${kind === 'transition' ? transitionCardGlowOpacity.toFixed(3) : '0.22'})`
      : variant === 'spotlight'
      ? `rgba(255,255,255,${kind === 'transition' ? transitionCardGlowOpacity.toFixed(3) : '0.12'})`
      : variant === 'celebration'
      ? `rgba(255,255,255,${kind === 'transition' ? transitionCardGlowOpacity.toFixed(3) : '0.18'})`
      : variant === 'scoreboard'
      ? `rgba(90,223,255,${kind === 'transition' ? transitionCardGlowOpacity.toFixed(3) : '0.18'})`
      : 'rgba(15,23,42,0.18)';
  ctx.shadowBlur = Math.round((variant === 'standard' ? 18 : 28) * uiScale);
  ctx.shadowOffsetY = Math.round(8 * uiScale);

  const cardRect: Rect = {
    x: -cardWidth / 2,
    y: -cardHeight / 2,
    width: cardWidth,
    height: cardHeight,
    radius: Math.round(28 * uiScale)
  };
  const cardFill =
    variant === 'storybook'
      ? 'rgba(248,232,194,0.97)'
      : variant === 'spotlight'
      ? 'rgba(15,23,42,0.96)'
      : variant === 'celebration'
      ? `linear-gradient(180deg, ${visualTheme.headerBg} 0%, ${visualTheme.completionBg} 100%)`
      : variant === 'scoreboard'
      ? 'rgba(13,20,37,0.96)'
      : 'rgba(255,255,255,0.97)';
  const cardStroke =
    variant === 'storybook'
      ? '#4D3E26'
      : variant === 'spotlight'
      ? visualTheme.timerDot
      : variant === 'scoreboard'
      ? visualTheme.headerBg
      : '#111827';
  drawRoundedRect(ctx, cardRect, {
    fill: typeof cardFill === 'string' && cardFill.startsWith('linear-gradient')
      ? (() => {
          const gradient = ctx.createLinearGradient(cardRect.x, cardRect.y, cardRect.x, cardRect.y + cardRect.height);
          gradient.addColorStop(0, visualTheme.headerBg);
          gradient.addColorStop(1, visualTheme.completionBg);
          return gradient;
        })()
      : cardFill,
    stroke: cardStroke,
    lineWidth: Math.max(2, Math.round(3 * uiScale))
  });

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  drawRoundedRect(
    ctx,
    {
      x: cardRect.x,
      y: cardRect.y,
      width: cardRect.width,
      height: Math.max(6, Math.round(8 * uiScale)),
      radius: cardRect.radius
    },
    {
      fill: variant === 'standard' ? '#D97706' : visualTheme.headerBg
    }
  );

  const badgeFontFamily =
    variant === 'storybook'
      ? '"Georgia", "Times New Roman", serif'
      : styleModules.text.subtitleCanvasFamily;
  const badgeColor =
    variant === 'scoreboard'
      ? visualTheme.headerBg
      : variant === 'storybook'
      ? '#5A4320'
      : variant === 'spotlight'
      ? '#F8FAFC'
      : variant === 'celebration'
      ? '#111827'
      : '#475569';
  const badgeBackground =
    variant === 'scoreboard'
      ? hexToRgba(visualTheme.headerBg, 0.16)
      : variant === 'spotlight'
      ? 'rgba(255,255,255,0.08)'
      : variant === 'celebration'
      ? 'rgba(255,255,255,0.62)'
      : variant === 'storybook'
      ? 'rgba(255,248,230,0.84)'
      : 'rgba(255,255,255,0.78)';
  const badgeBorder =
    variant === 'scoreboard'
      ? hexToRgba(visualTheme.headerBg, 0.7)
      : variant === 'storybook'
      ? '#8B6D33'
      : variant === 'spotlight'
      ? 'rgba(255,255,255,0.18)'
      : 'rgba(17,24,39,0.12)';
  const badgeText = applyTextTransform(scene.cardEyebrow, styleModules.text.subtitleTransform);
  const badgeFontSize = Math.max(10, Math.round(13 * uiScale));
  ctx.font = `${styleModules.text.subtitleCanvasWeight} ${badgeFontSize}px ${badgeFontFamily}`;
  const badgeWidth = Math.max(
    Math.round(140 * uiScale),
    Math.ceil(ctx.measureText(badgeText).width + Math.round(32 * uiScale))
  );
  const badgeHeight = Math.max(30, Math.round(34 * uiScale));
  drawRoundedRect(
    ctx,
    {
      x: -badgeWidth / 2,
      y: cardRect.y + Math.round(28 * uiScale),
      width: badgeWidth,
      height: badgeHeight,
      radius: badgeHeight / 2
    },
    {
      fill: badgeBackground,
      stroke: badgeBorder,
      lineWidth: Math.max(1.5, Math.round(2 * uiScale))
    }
  );
  ctx.fillStyle = badgeColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(badgeText, 0, cardRect.y + Math.round(28 * uiScale) + badgeHeight / 2 + 1);

  const titleFontFamily = variant === 'storybook' ? '"Georgia", "Times New Roman", serif' : styleModules.text.titleCanvasFamily;
  const subtitleFontFamily =
    variant === 'storybook' ? '"Georgia", "Times New Roman", serif' : styleModules.text.subtitleCanvasFamily;
  const titleText = applyTextTransform(scene.title, styleModules.text.titleTransform);
  const subtitleText = applyTextTransform(scene.subtitle, styleModules.text.subtitleTransform);
  const textColor =
    variant === 'storybook'
      ? '#2E2414'
      : variant === 'scoreboard' || variant === 'spotlight'
      ? '#F8FAFC'
      : '#111827';
  const subtitleColor =
    variant === 'scoreboard' || variant === 'spotlight' ? '#CBD5E1' : textColor;
  const maxTextWidth = cardWidth - Math.round(64 * uiScale);
  const titleFontSize = fitTextSize(
    ctx,
    titleText,
    maxTextWidth,
    Math.max(26, Math.round((isVerticalLayout ? 38 : 52) * uiScale)),
    titleFontFamily
  );
  const subtitleFontSize = fitTextSize(
    ctx,
    subtitleText,
    maxTextWidth,
    Math.max(12, Math.round(18 * uiScale)),
    subtitleFontFamily,
    800,
    10
  );
  ctx.fillStyle = textColor;
  ctx.font = `${styleModules.text.titleCanvasWeight} ${titleFontSize}px ${titleFontFamily}`;
  ctx.fillText(titleText, 0, -Math.round(4 * uiScale));
  ctx.fillStyle = subtitleColor;
  ctx.font = `${styleModules.text.subtitleCanvasWeight} ${subtitleFontSize}px ${subtitleFontFamily}`;
  ctx.fillText(subtitleText, 0, Math.round(48 * uiScale));

  const aspectFontSize = Math.max(10, Math.round(12 * uiScale));
  const aspectText = settings.aspectRatio;
  ctx.font = `900 ${aspectFontSize}px "Segoe UI", Arial, sans-serif`;
  const aspectWidth = Math.max(
    Math.round(90 * uiScale),
    Math.ceil(ctx.measureText(aspectText).width + Math.round(24 * uiScale))
  );
  const aspectHeight = Math.max(26, Math.round(30 * uiScale));
  drawRoundedRect(
    ctx,
    {
      x: -aspectWidth / 2,
      y: cardRect.y + cardRect.height - aspectHeight - Math.round(26 * uiScale),
      width: aspectWidth,
      height: aspectHeight,
      radius: aspectHeight / 2
    },
    {
      fill: variant === 'scoreboard' ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.62)',
      stroke: variant === 'scoreboard' ? 'rgba(226,232,240,0.32)' : 'rgba(17,24,39,0.12)',
      lineWidth: Math.max(1.5, Math.round(2 * uiScale))
    }
  );
  ctx.fillStyle = subtitleColor;
  ctx.font = `900 ${aspectFontSize}px "Segoe UI", Arial, sans-serif`;
  ctx.fillText(aspectText, 0, cardRect.y + cardRect.height - aspectHeight / 2 - Math.round(26 * uiScale) + 1);

  ctx.restore();
  ctx.restore();
};

const drawRevealMarker = (
  ctx: CanvasRenderingContext2D,
  markerBounds: MarkerBounds,
  settings: VideoSettings,
  revealVariant: VideoSettings['revealVariant'],
  scale: number
) => {
  const circleStroke = Math.max(2, settings.circleThickness) * scale;
  const outlineStroke = Math.max(0, settings.outlineThickness) * scale;
  const lineStroke = Math.max(2, 4 * scale);
  const x = markerBounds.x;
  const y = markerBounds.y;
  const width = markerBounds.width;
  const height = markerBounds.height;
  const centerX = x + width / 2;
  const centerY = y + height / 2;

  const strokeEllipse = (
    strokeColor: string,
    strokeWidth: number,
    dash: number[] = [],
    dashOffset = 0
  ) => {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, Math.max(2, width / 2), Math.max(2, height / 2), 0, 0, Math.PI * 2);
    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = strokeColor;
    ctx.setLineDash(dash);
    ctx.lineDashOffset = dashOffset;
    ctx.stroke();
    ctx.restore();
  };

  const strokeInsetEllipse = (
    insetRatio: number,
    strokeColor: string,
    strokeWidth: number,
    dash: number[] = [],
    dashOffset = 0
  ) => {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(
      centerX,
      centerY,
      Math.max(2, width / 2 - width * insetRatio),
      Math.max(2, height / 2 - height * insetRatio),
      0,
      0,
      Math.PI * 2
    );
    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = strokeColor;
    ctx.setLineDash(dash);
    ctx.lineDashOffset = dashOffset;
    ctx.stroke();
    ctx.restore();
  };

  const strokeRect = (dash: number[] = []) => {
    ctx.save();
    ctx.setLineDash(dash);
    if (outlineStroke > 0) {
      ctx.lineWidth = lineStroke + outlineStroke * 2;
      ctx.strokeStyle = settings.outlineColor;
      ctx.strokeRect(x, y, width, height);
    }
    ctx.lineWidth = lineStroke;
    ctx.strokeStyle = settings.revealColor;
    ctx.strokeRect(x, y, width, height);
    ctx.restore();
  };

  if (settings.revealStyle === 'box' && revealVariant === 'box_glow') {
    strokeRect();
    return;
  }

  if (settings.revealStyle === 'box' && revealVariant === 'box_classic') {
    strokeRect();
    const inset = Math.max(4 * scale, Math.min(width, height) * 0.14);
    ctx.save();
    if (outlineStroke > 0) {
      ctx.lineWidth = Math.max(1, lineStroke * 0.45) + outlineStroke * 1.5;
      ctx.strokeStyle = settings.outlineColor;
      ctx.strokeRect(x + inset, y + inset, Math.max(1, width - inset * 2), Math.max(1, height - inset * 2));
    }
    ctx.lineWidth = Math.max(1, lineStroke * 0.45);
    ctx.strokeStyle = hexToRgba(settings.revealColor, 0.82);
    ctx.strokeRect(x + inset, y + inset, Math.max(1, width - inset * 2), Math.max(1, height - inset * 2));
    ctx.restore();
    return;
  }

  if (settings.revealStyle === 'box' && revealVariant === 'box_minimal') {
    ctx.save();
    if (outlineStroke > 0) {
      ctx.lineWidth = Math.max(1, 2.5 * scale) + outlineStroke * 2;
      ctx.strokeStyle = settings.outlineColor;
      ctx.strokeRect(x, y, width, height);
    }
    ctx.lineWidth = Math.max(1, 2.5 * scale);
    ctx.strokeStyle = settings.revealColor;
    ctx.strokeRect(x, y, width, height);
    ctx.restore();
    return;
  }

  if (settings.revealStyle === 'box' && revealVariant === 'box_dashed') {
    strokeRect([10 * scale, 8 * scale]);
    return;
  }

  if (settings.revealStyle === 'box' && revealVariant === 'box_corners') {
    const cornerLength = Math.min(width, height) * 0.35;
    const strokeWidth = lineStroke;
    const drawCorner = (fromX: number, fromY: number, toX: number, toY: number, endX: number, endY: number) => {
      if (outlineStroke > 0) {
        ctx.strokeStyle = settings.outlineColor;
        ctx.lineWidth = strokeWidth + outlineStroke * 2;
        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(toX, toY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
      }

      ctx.strokeStyle = settings.revealColor;
      ctx.lineWidth = strokeWidth;
      ctx.beginPath();
      ctx.moveTo(fromX, fromY);
      ctx.lineTo(toX, toY);
      ctx.lineTo(endX, endY);
      ctx.stroke();
    };

    drawCorner(x, y + cornerLength, x, y, x + cornerLength, y);
    drawCorner(x + width - cornerLength, y, x + width, y, x + width, y + cornerLength);
    drawCorner(x, y + height - cornerLength, x, y + height, x + cornerLength, y + height);
    drawCorner(x + width - cornerLength, y + height, x + width, y + height, x + width, y + height - cornerLength);
    return;
  }

  if (settings.revealStyle === 'circle' && revealVariant === 'circle_ring') {
    if (outlineStroke > 0) {
      strokeEllipse(settings.outlineColor, circleStroke + outlineStroke * 2);
    }
    strokeEllipse(settings.revealColor, circleStroke);
    return;
  }

  if (settings.revealStyle === 'circle' && revealVariant === 'circle_classic') {
    if (outlineStroke > 0) {
      strokeEllipse(settings.outlineColor, circleStroke + outlineStroke * 2);
    }
    strokeEllipse(settings.revealColor, circleStroke);
    strokeInsetEllipse(0.18, hexToRgba(settings.revealColor, 0.82), Math.max(1, circleStroke * 0.45));
    return;
  }

  if (settings.revealStyle === 'circle' && revealVariant === 'circle_crosshair') {
    if (outlineStroke > 0) {
      strokeEllipse(settings.outlineColor, circleStroke + outlineStroke * 2);
    }
    strokeEllipse(settings.revealColor, circleStroke);

    const guideStroke = Math.max(1.5, circleStroke * 0.72);
    const verticalInset = Math.max(4 * scale, height * 0.07);
    const verticalLength = Math.max(8 * scale, height * 0.17);
    const horizontalInset = Math.max(4 * scale, width * 0.07);
    const horizontalLength = Math.max(8 * scale, width * 0.17);

    ctx.save();
    ctx.strokeStyle = settings.revealColor;
    ctx.lineWidth = guideStroke;
    ctx.lineCap = 'round';

    ctx.beginPath();
    ctx.moveTo(centerX, y + verticalInset);
    ctx.lineTo(centerX, y + verticalInset + verticalLength);
    ctx.moveTo(centerX, y + height - verticalInset);
    ctx.lineTo(centerX, y + height - verticalInset - verticalLength);
    ctx.moveTo(x + horizontalInset, centerY);
    ctx.lineTo(x + horizontalInset + horizontalLength, centerY);
    ctx.moveTo(x + width - horizontalInset, centerY);
    ctx.lineTo(x + width - horizontalInset - horizontalLength, centerY);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (settings.revealStyle === 'circle' && revealVariant === 'circle_dotted') {
    if (outlineStroke > 0) {
      strokeEllipse(settings.outlineColor, circleStroke + outlineStroke * 2);
    }
    strokeEllipse(settings.revealColor, circleStroke, [2 * scale, 8 * scale]);
    return;
  }

  if (settings.revealStyle === 'circle' && revealVariant === 'circle_ellipse') {
    if (outlineStroke > 0) {
      strokeEllipse(settings.outlineColor, circleStroke + outlineStroke * 2);
    }
    strokeEllipse(settings.revealColor, circleStroke);
    return;
  }

  if (settings.revealStyle === 'circle' && revealVariant === 'circle_ellipse_dotted') {
    if (outlineStroke > 0) {
      strokeEllipse(settings.outlineColor, circleStroke + outlineStroke * 2);
    }
    strokeEllipse(settings.revealColor, circleStroke, [3 * scale, 8 * scale]);
    return;
  }

  if (settings.revealStyle === 'circle' && revealVariant === 'circle_red_black') {
    if (outlineStroke > 0) {
      strokeEllipse(settings.outlineColor, circleStroke + outlineStroke * 2);
    }
    const dashSize = 12 * scale;
    strokeEllipse('#DC2626', circleStroke, [dashSize, dashSize], 0);
    strokeEllipse('#111111', circleStroke, [dashSize, dashSize], dashSize);
    return;
  }

  if (settings.revealStyle === 'highlight') {
    if (revealVariant === 'highlight_classic') {
      const inset = Math.max(3 * scale, Math.min(width, height) * 0.1);
      ctx.save();
      if (outlineStroke > 0) {
        ctx.lineWidth = Math.max(1, outlineStroke * 2);
        ctx.strokeStyle = settings.outlineColor;
        ctx.strokeRect(x, y, width, height);
      }
      ctx.lineWidth = Math.max(2, 2 * scale);
      ctx.strokeStyle = hexToRgba(settings.revealColor, 0.72);
      ctx.fillStyle = hexToRgba(settings.revealColor, 0.18);
      ctx.fillRect(x, y, width, height);
      ctx.strokeRect(x, y, width, height);
      ctx.lineWidth = Math.max(1, 1.25 * scale);
      ctx.strokeStyle = hexToRgba(settings.revealColor, 0.34);
      ctx.strokeRect(x + inset, y + inset, Math.max(1, width - inset * 2), Math.max(1, height - inset * 2));
      ctx.restore();
      return;
    }

    ctx.save();
    if (outlineStroke > 0) {
      ctx.lineWidth = Math.max(1, outlineStroke * 2);
      ctx.strokeStyle = settings.outlineColor;
      ctx.strokeRect(x, y, width, height);
    }
    ctx.lineWidth = Math.max(2, 2 * scale);
    ctx.strokeStyle = hexToRgba(settings.revealColor, 0.8);
    ctx.fillStyle = hexToRgba(settings.revealColor, 0.35);
    ctx.fillRect(x, y, width, height);
    ctx.strokeRect(x, y, width, height);
    ctx.restore();
  }
};

const drawRevealSpotlightFill = (
  ctx: CanvasRenderingContext2D,
  markerBounds: MarkerBounds,
  settings: VideoSettings,
  revealVariant: VideoSettings['revealVariant'],
  isActive: boolean,
  scale: number
) => {
  const inset = Math.max(2, Math.round(Math.min(markerBounds.width, markerBounds.height) * 0.08));
  const innerBounds: MarkerBounds = {
    x: markerBounds.x + inset,
    y: markerBounds.y + inset,
    width: Math.max(1, markerBounds.width - inset * 2),
    height: Math.max(1, markerBounds.height - inset * 2)
  };
  const centerX = innerBounds.x + innerBounds.width / 2;
  const centerY = innerBounds.y + innerBounds.height / 2;
  const isEllipseVariant =
    settings.revealStyle === 'circle' &&
    (revealVariant === 'circle_ellipse' || revealVariant === 'circle_ellipse_dotted');

  ctx.save();
  ctx.shadowColor = hexToRgba(settings.revealColor, isActive ? 0.34 : 0.2);
  ctx.shadowBlur = Math.max(8, Math.round((isActive ? 18 : 10) * scale));
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  if (settings.revealStyle === 'circle') {
    const radiusX = Math.max(2, innerBounds.width / 2);
    const radiusY = Math.max(2, innerBounds.height / 2);
    const gradient = ctx.createRadialGradient(
      centerX,
      centerY,
      Math.max(2, Math.min(radiusX, radiusY) * 0.2),
      centerX,
      centerY,
      Math.max(radiusX, radiusY)
    );
    gradient.addColorStop(0, hexToRgba(settings.revealColor, isActive ? 0.3 : 0.16));
    gradient.addColorStop(0.55, isActive ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.12)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath();
    if (isEllipseVariant) {
      ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
    } else {
      ctx.arc(centerX, centerY, Math.max(2, Math.min(radiusX, radiusY)), 0, Math.PI * 2);
    }
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.restore();
    return;
  }

  const radius = settings.revealStyle === 'highlight' ? Math.round(10 * scale) : Math.round(12 * scale);
  const gradient = ctx.createLinearGradient(
    innerBounds.x,
    innerBounds.y,
    innerBounds.x + innerBounds.width,
    innerBounds.y + innerBounds.height
  );
  gradient.addColorStop(0, isActive ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.12)');
  gradient.addColorStop(1, hexToRgba(settings.revealColor, isActive ? 0.22 : 0.1));
  roundRectPath(ctx, { ...innerBounds, radius });
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.restore();
};

const drawFrame = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  puzzles: RenderablePuzzle[],
  loadedImages: Array<LoadedPuzzleImages | null>,
  brandLogo: ImageBitmap | null,
  settings: VideoSettings,
  generatedBackgroundPack: VideoExportWorkerStartPayload['generatedBackgroundPack'],
  scene: RenderScene,
  timestamp: number
) => {
  const packagePreset =
    VIDEO_PACKAGE_PRESETS[settings.videoPackagePreset] ?? VIDEO_PACKAGE_PRESETS.gameshow;
  const effectiveVisualStyle = resolveVisualThemeStyle(settings.visualStyle, scene.segment.puzzleIndex);
  const visualTheme = VISUAL_THEMES[effectiveVisualStyle];
  const styleModules = resolveVideoStyleModules(settings, packagePreset);
  const accent = visualTheme.timerDot;
  const isVerticalLayout = resolvePackageImageArrangement(packagePreset, settings.aspectRatio);
  const customLayoutEnabled = settings.useCustomLayout === true;
  const isStorybookStyle =
    packagePreset.surfaceStyle === 'storybook' && settings.aspectRatio === '16:9' && !customLayoutEnabled;
  const isClassicStyle =
    packagePreset.surfaceStyle === 'gameshow' && !customLayoutEnabled;
  const uiScale = clamp(Math.min(width, height) / 1080, 0.55, 2.2);

  const panelBackground = visualTheme.imagePanelBg;
  const rootBackground = isStorybookStyle ? '#E5D19A' : visualTheme.gameBg;
  const boardBackground = isStorybookStyle ? '#E5D19A' : visualTheme.gameBg;
  const boardStroke = isStorybookStyle ? '#3F301A' : '#000000';
  const headerBackground = visualTheme.headerBg;
  const gameBackground = visualTheme.gameBg;
  const generatedBackgroundSpec = settings.generatedBackgroundsEnabled
    ? resolveGeneratedBackgroundForIndex(
        generatedBackgroundPack,
        scene.segment.puzzleIndex,
        settings.generatedBackgroundShuffleSeed
      )
    : null;
  const generatedProgressTheme = settings.generatedProgressEnabled
    ? PROGRESS_BAR_THEMES[settings.generatedProgressStyle]
    : null;
  const shouldRenderHeaderText =
    scene.segment.phase === 'showing' || scene.segment.phase === 'revealing';
  const shouldShowHeaderTimer = settings.showTimer !== false && scene.segment.phase === 'showing';
  const shouldShowHeaderProgress = settings.showProgress !== false && scene.segment.phase === 'showing';
  const shouldShowClassicPuzzleBadge =
    scene.segment.phase === 'showing' || scene.segment.phase === 'revealing';
  const shouldRenderCustomLogo = Boolean(brandLogo) && customLayoutEnabled;
  const shouldRenderInlineLogo =
    Boolean(brandLogo) && !customLayoutEnabled && !isClassicStyle && !isStorybookStyle && shouldRenderHeaderText;
  const shouldRenderPuzzlePanels = scene.segment.phase !== 'intro' && scene.segment.phase !== 'outro';
  const countdownPercent = clamp(scene.countdownPercent, 0, 100);
  const generatedProgressFillColors = settings.generatedProgressEnabled
    ? resolveProgressBarFillColors(settings.generatedProgressStyle, countdownPercent / 100)
    : null;
  const progressTrackTheme = generatedProgressTheme ?? visualTheme;
  const progressFillDefinition =
    settings.generatedProgressEnabled && generatedProgressTheme
      ? resolveProgressBarFillStyle(
          settings.generatedProgressStyle,
          countdownPercent / 100,
          generatedProgressTheme
        )
      : isClassicStyle && styleModules.progress.id === 'package'
      ? CLASSIC_HUD_SPEC.progress.fillGradient
      : buildProgressFillDefinition(styleModules.progress, visualTheme);
  const isTextFillProgress = settings.generatedProgressEnabled
    ? settings.generatedProgressRenderMode === 'text_fill'
    : styleModules.progress.variant === 'text_fill';
  const progressMotionState = resolveVideoProgressMotionState({
    mode: settings.progressMotion,
    phase: scene.segment.phase,
    phaseDuration: scene.segment.duration,
    timeLeft: scene.timeLeft
  });
  const progressFillPercent = clamp(progressMotionState.fillPercent, 0, 100);
  const shouldShowProgressSweep = progressMotionState.sweepActive;
  const transitionSequenceState = resolveVideoTransitionSequenceState({
    phaseDuration: settings.transitionDuration,
    timeLeft: scene.timeLeft
  });
  const puzzleEntryState = resolveVideoPuzzleEntryState({
    phaseDuration: settings.showDuration,
    timeLeft: scene.timeLeft
  });
  const transitionProgress =
    scene.segment.phase === 'transitioning' ? clamp(scene.progressPercent / 100, 0, 1) : 0;
  const transitionSmooth =
    scene.segment.phase === 'transitioning'
      ? transitionProgress * transitionProgress * (3 - 2 * transitionProgress)
      : 0;
  const puzzlePanelOpacity =
    scene.segment.phase === 'transitioning'
      ? transitionSequenceState.outgoingOpacity
      : scene.segment.phase === 'showing'
      ? puzzleEntryState.opacity
      : 1;
  const puzzlePanelScale =
    scene.segment.phase === 'transitioning'
      ? transitionSequenceState.outgoingScale
      : scene.segment.phase === 'showing'
      ? puzzleEntryState.scale
      : 1;
  const puzzlePanelRotate = 0;

  const outerPad = 0;
  const board: Rect = {
    x: outerPad,
    y: outerPad,
    width: width - outerPad * 2,
    height: height - outerPad * 2,
    radius: 0
  };
  const baseStage = BASE_STAGE_SIZE[settings.aspectRatio];
  const layoutScale = Math.min(board.width / baseStage.width, board.height / baseStage.height);
  const classicLayoutScale = Math.max(0.55, layoutScale);
  const resolvedLayout = resolveVideoLayoutSettings(settings.videoPackagePreset, settings.aspectRatio, settings);
  const styleHudLayout = resolvedLayout.hud;
  const styleFrameLayout = resolvedLayout.frame;
  const boardStrokeWidth = Math.max(4, 4 * uiScale);
  const headerHeight = isClassicStyle
    ? Math.max(40, Math.round(CLASSIC_HUD_SPEC.headerHeight * classicLayoutScale))
    : isStorybookStyle
    ? Math.round(board.height * 0.14)
    : Math.max(36, Math.round(styleFrameLayout.headerHeight * layoutScale));
  const contentPadding = isClassicStyle
    ? Math.max(6, Math.round(8 * classicLayoutScale))
    : isStorybookStyle
    ? Math.round(14 * uiScale)
    : Math.round(styleFrameLayout.contentPadding * layoutScale);
  const gameAreaRect: Rect = {
    x: board.x,
    y: board.y + headerHeight,
    width: board.width,
    height: board.height - headerHeight
  };
  const panelStageRect: Rect = {
    x: gameAreaRect.x + contentPadding,
    y: gameAreaRect.y + contentPadding,
    width: gameAreaRect.width - contentPadding * 2,
    height: gameAreaRect.height - contentPadding * 2
  };
  const panelGap = isClassicStyle
    ? Math.max(6, Math.round(8 * classicLayoutScale))
    : isStorybookStyle
    ? Math.round(22 * uiScale)
    : Math.round(styleFrameLayout.panelGap * layoutScale);
  const panelRadius = isClassicStyle
    ? Math.max(8, Math.round(12 * classicLayoutScale))
    : isStorybookStyle
    ? Math.round(18 * uiScale)
    : Math.round(styleFrameLayout.panelRadius * layoutScale);
  const imagePanelOutlineWidth = 0;
  const imagePanelOutlineColor = settings.imagePanelOutlineColor || '#CEC3A5';
  const usesImagePanelOutline = imagePanelOutlineWidth > 0;
  const gamePadding = isStorybookStyle
    ? Math.round(8 * uiScale)
    : usesImagePanelOutline
    ? 0
    : isClassicStyle
    ? Math.max(0, Math.round(styleFrameLayout.gamePadding * classicLayoutScale))
    : Math.max(0, Math.round(styleFrameLayout.gamePadding * layoutScale));
  const generatedBackgroundCoversHeader =
    Boolean(generatedBackgroundSpec) && settings.generatedBackgroundCoverage === 'full_board';
  const sceneOverlayRect = generatedBackgroundCoversHeader ? board : gameAreaRect;
  const headerFill = generatedBackgroundCoversHeader
    ? hexToRgba(headerBackground, isClassicStyle ? 0.88 : 0.82)
    : headerBackground;
  const drawHeaderLogo = (rect: Rect) => {
    if (!brandLogo) return;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = Math.max(3, Math.round(6 * uiScale));
    ctx.shadowOffsetY = Math.max(1, Math.round(2 * uiScale));
    drawImageContain(ctx, brandLogo, rect, settings.logoZoom);
    ctx.restore();
  };

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = rootBackground;
  ctx.fillRect(0, 0, width, height);

  if (generatedBackgroundCoversHeader) {
    drawRoundedRect(ctx, board, { fill: boardBackground, stroke: undefined, lineWidth: 0 });
    ctx.save();
    roundRectPath(ctx, board);
    ctx.clip();
    drawGeneratedBackground(ctx, generatedBackgroundSpec!, board, timestamp);
    ctx.restore();
    drawRoundedRect(ctx, board, { fill: undefined, stroke: boardStroke, lineWidth: boardStrokeWidth });
  } else {
    drawRoundedRect(ctx, board, { fill: boardBackground, stroke: boardStroke, lineWidth: boardStrokeWidth });
  }
  drawRoundedRect(
    ctx,
    { x: board.x, y: board.y, width: board.width, height: headerHeight, radius: board.radius },
    { fill: headerFill }
  );
  ctx.fillStyle = boardStroke;
  ctx.fillRect(board.x, board.y + headerHeight - Math.max(3, 3 * uiScale), board.width, Math.max(3, 3 * uiScale));

  const templateValues = {
    current: scene.segment.puzzleIndex + 1,
    next: Math.min(puzzles.length, scene.segment.puzzleIndex + 2),
    total: puzzles.length,
    puzzleCount: puzzles.length,
    remaining: Math.max(0, puzzles.length - (scene.segment.puzzleIndex + 1)),
    preset: ''
  };
  const rawHeaderTextScale = Number(settings.headerTextOverrides?.scale);
  const rawHeaderTextOffsetX = Number(settings.headerTextOverrides?.offsetX);
  const rawHeaderTextOffsetY = Number(settings.headerTextOverrides?.offsetY);
  const headerTextScale = Number.isFinite(rawHeaderTextScale) ? clamp(rawHeaderTextScale, 0.6, 2.4) : 1;
  const headerTextOffsetX = Number.isFinite(rawHeaderTextOffsetX) ? rawHeaderTextOffsetX : 0;
  const headerTextOffsetY = Number.isFinite(rawHeaderTextOffsetY) ? rawHeaderTextOffsetY : 0;
  const puzzleBadgeLabel = fillTemplate(settings.textTemplates.puzzleBadgeLabel, templateValues);
  const progressLabel = applyTextTransform(
    fillTemplate(settings.textTemplates.progressLabel || settings.textTemplates.playTitle, templateValues),
    styleModules.text.titleTransform
  );
  const titleFontSize = Math.max(18, Math.round((isStorybookStyle ? 48 : 34) * uiScale));

  if (isStorybookStyle) {
    const storybookTimerPadX = Math.max(8, Math.round(14 * uiScale * styleModules.timer.paddingScale));
    const storybookTimerPadY = Math.max(4, Math.round(6 * uiScale * styleModules.timer.paddingScale));
    const storybookTimerDotSize = Math.max(5, Math.round(9 * uiScale));
    const storybookTimerGap = Math.max(5, Math.round(8 * uiScale));
    const storybookTimerFontSize = Math.max(14, Math.round(30 * uiScale));
    ctx.font = `${styleModules.timer.canvasFontWeight} ${storybookTimerFontSize}px ${styleModules.timer.canvasFontFamily}`;
    const storybookTimerMetrics = measureResolvedTimerBox(styleModules.timer, {
      textWidth: ctx.measureText(formatCountdownSeconds(scene.timeLeft)).width,
      fontSize: storybookTimerFontSize,
      padX: storybookTimerPadX,
      padY: storybookTimerPadY,
      dotSize: storybookTimerDotSize,
      gap: storybookTimerGap,
      minWidth: Math.round(126 * uiScale)
    });
    const timerBoxWidth = storybookTimerMetrics.width;
    const timerBoxHeight = storybookTimerMetrics.height;
    const timerBoxX = board.x + board.width - contentPadding - timerBoxWidth;
    const timerBoxY = board.y + Math.round((headerHeight - timerBoxHeight) / 2);

    if (shouldShowHeaderProgress) {
      const progressTrackHeight = Math.max(14, Math.round(24 * uiScale));
      const progressTrackWidth = Math.round(board.width * 0.31);
      const progressTrackX = Math.round(board.x + board.width * 0.51 - progressTrackWidth / 2);
      const progressTrackY = Math.round(board.y + (headerHeight - progressTrackHeight) / 2);
      const progressTrackRect: Rect = {
        x: progressTrackX,
        y: progressTrackY,
        width: progressTrackWidth,
        height: progressTrackHeight,
        radius: progressTrackHeight / 2
      };
      if (isTextFillProgress) {
        drawTextProgressLabel(
          ctx,
          progressTrackRect,
          progressLabel,
          progressFillPercent,
          countdownPercent,
          styleModules,
          progressTrackTheme,
          uiScale,
          settings.generatedProgressEnabled ? settings.generatedProgressStyle : null,
          scene.phaseElapsed,
          generatedProgressFillColors,
          {
            active: shouldShowProgressSweep,
            progress: progressMotionState.sweepProgress,
            opacity: progressMotionState.sweepOpacity
          }
        );
      } else {
        drawRoundedRect(ctx, progressTrackRect, {
          fill: settings.generatedProgressEnabled ? progressTrackTheme.progressTrackBg : '#8B6D33',
          stroke: settings.generatedProgressEnabled ? progressTrackTheme.progressTrackBorder : '#3F301A',
          lineWidth: Math.max(2, 3 * uiScale)
        });
        const progressFillRect: Rect = {
          x: progressTrackX + Math.max(2, 3 * uiScale),
          y: progressTrackY + Math.max(2, 3 * uiScale),
          width: ((progressTrackWidth - Math.max(4, 6 * uiScale)) * progressFillPercent) / 100,
          height: progressTrackHeight - Math.max(4, 6 * uiScale),
          radius: (progressTrackHeight - Math.max(4, 6 * uiScale)) / 2
        };
        if (progressFillRect.width > 0) {
          roundRectPath(ctx, progressFillRect);
          ctx.fillStyle = resolveProgressFill(ctx, progressFillRect, progressFillDefinition, accent);
          ctx.fill();
          if (shouldShowProgressSweep) {
            drawProgressSweepOverlay(
              ctx,
              progressFillRect,
              'horizontal',
              progressMotionState.sweepProgress,
              progressMotionState.sweepOpacity
            );
          }
          drawProgressPulseOverlay(
            ctx,
            progressFillRect,
            'horizontal',
            progressMotionState.pulseOverlayOpacity
          );
          drawProgressPulseGlow(
            ctx,
            progressFillRect,
            progressMotionState.pulseGlowOpacity,
            hexToRgba(accent, 0.14 + progressMotionState.pulseGlowOpacity * 0.38),
            Math.max(6, Math.round(10 * uiScale)),
            Math.max(1, Math.round(1.5 * uiScale))
          );
        }
      }
    }

    if (shouldRenderHeaderText) {
      const storybookTitleFontSize = Math.max(18, Math.round(titleFontSize * headerTextScale));
      ctx.fillStyle = '#2E2414';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = `900 ${storybookTitleFontSize}px "Georgia", "Times New Roman", serif`;
      ctx.fillText(
        scene.title.toLowerCase(),
        board.x + contentPadding + headerTextOffsetX,
        board.y + headerHeight / 2 + Math.round(2 * uiScale) + headerTextOffsetY
      );
    }

    if (shouldShowHeaderTimer) {
      ctx.fillStyle = '#2E2414';
      ctx.textAlign = 'right';
      ctx.font = `900 ${Math.max(16, Math.round(34 * uiScale))}px "Georgia", "Times New Roman", serif`;
      ctx.fillText(
        `${scene.segment.puzzleIndex + 1}/${puzzles.length}`,
        timerBoxX - Math.round(12 * uiScale),
        board.y + headerHeight / 2 + 1
      );
    }

    if (shouldShowHeaderTimer) {
      drawStyledHeaderTimer(
        ctx,
        { x: timerBoxX, y: timerBoxY, width: timerBoxWidth, height: timerBoxHeight, radius: Math.round(14 * uiScale) },
        styleModules.timer,
        visualTheme,
        formatCountdownSeconds(scene.timeLeft),
        headerBackground,
        {
          padX: storybookTimerPadX,
          padY: storybookTimerPadY,
          dotSize: storybookTimerDotSize,
          gap: storybookTimerGap,
          fontSize: storybookTimerFontSize,
          scale: uiScale
        },
        scene.timeLeft <= 2,
        scene.segment.duration,
        scene.timeLeft,
        scene.countdownPercent / 100
      );
    }
  } else {
    const headerRect: Rect = { x: board.x, y: board.y, width: board.width, height: headerHeight };
    const timerTextValue = formatCountdownSeconds(scene.timeLeft);

    if (isClassicStyle) {
      const timerPadX = Math.max(
        6,
        Math.round(CLASSIC_HUD_SPEC.timer.padX * classicLayoutScale * styleModules.timer.paddingScale)
      );
      const timerPadY = Math.max(
        2,
        Math.round(CLASSIC_HUD_SPEC.timer.padY * classicLayoutScale * styleModules.timer.paddingScale)
      );
      const timerDotSize = Math.max(4, Math.round(CLASSIC_HUD_SPEC.timer.dotSize * classicLayoutScale));
      const timerGap = Math.max(4, Math.round(CLASSIC_HUD_SPEC.timer.gap * classicLayoutScale));
      const timerFontSize = Math.max(14, Math.round(CLASSIC_HUD_SPEC.timer.fontSize * classicLayoutScale));
      ctx.font = `${styleModules.timer.canvasFontWeight} ${timerFontSize}px ${styleModules.timer.canvasFontFamily}`;
      const classicTimerMetrics = measureResolvedTimerBox(styleModules.timer, {
        textWidth: ctx.measureText(timerTextValue).width,
        fontSize: timerFontSize,
        padX: timerPadX,
        padY: timerPadY,
        dotSize: timerDotSize,
        gap: timerGap,
        minWidth: Math.round(CLASSIC_HUD_SPEC.timer.minWidth * classicLayoutScale)
      });
      const timerBoxWidth = Math.max(30, classicTimerMetrics.width);
      const timerBoxHeight = Math.max(30, classicTimerMetrics.height);
      const timerBoxX = board.x + board.width - contentPadding - timerBoxWidth;
      const timerBoxY = board.y + Math.round(CLASSIC_HUD_SPEC.timer.top * classicLayoutScale);

      const badgePadX = Math.max(8, Math.round(CLASSIC_HUD_SPEC.puzzleBadge.padX * classicLayoutScale));
      const badgeGap = Math.max(4, Math.round(CLASSIC_HUD_SPEC.puzzleBadge.gap * classicLayoutScale));
      const badgeLabelSize = Math.max(
        8,
        Math.round(CLASSIC_HUD_SPEC.puzzleBadge.labelSize * classicLayoutScale)
      );
      const badgeValueSize = Math.max(
        16,
        Math.round(
          (isVerticalLayout
            ? CLASSIC_HUD_SPEC.puzzleBadge.valueSizeNarrow
            : CLASSIC_HUD_SPEC.puzzleBadge.valueSize) * classicLayoutScale
        )
      );
      const badgeHeight = Math.max(30, Math.round(CLASSIC_HUD_SPEC.puzzleBadge.height * classicLayoutScale));
      const badgeX = board.x + Math.round(CLASSIC_HUD_SPEC.puzzleBadge.left * classicLayoutScale);
      const badgeY = board.y + Math.round(CLASSIC_HUD_SPEC.puzzleBadge.top * classicLayoutScale);
      const badgeText = `${scene.segment.puzzleIndex + 1}/${puzzles.length}`;
      const badgeLabelText = applyTextTransform(puzzleBadgeLabel, styleModules.text.subtitleTransform);

      ctx.font = `${styleModules.text.subtitleCanvasWeight} ${badgeLabelSize}px ${styleModules.text.subtitleCanvasFamily}`;
      const badgeLabelWidth = ctx.measureText(badgeLabelText).width;
      ctx.font = `${styleModules.text.titleCanvasWeight} ${badgeValueSize}px ${styleModules.text.titleCanvasFamily}`;
      const badgeValueWidth = ctx.measureText(badgeText).width;
      const badgeWidth = Math.max(
        Math.round(CLASSIC_HUD_SPEC.puzzleBadge.minWidth * classicLayoutScale),
        Math.ceil(badgePadX * 2 + badgeLabelWidth + badgeGap + badgeValueWidth)
      );
      const badgeRect: Rect = {
        x: badgeX,
        y: badgeY,
        width: badgeWidth,
        height: badgeHeight,
        radius: Math.max(8, Math.round(CLASSIC_HUD_SPEC.puzzleBadge.radius * classicLayoutScale))
      };

      if (shouldShowClassicPuzzleBadge) {
        const badgeFill = resolveProgressFill(
          ctx,
          badgeRect,
          CLASSIC_HUD_SPEC.puzzleBadge.background,
          '#FFE88A'
        );
        drawRoundedRect(ctx, badgeRect, {
          fill: badgeFill,
          stroke: CLASSIC_HUD_SPEC.puzzleBadge.border,
          lineWidth: Math.max(2, Math.round(2 * classicLayoutScale))
        });
        ctx.save();
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#111827';
        ctx.textAlign = 'left';
        ctx.font = `${styleModules.text.subtitleCanvasWeight} ${badgeLabelSize}px ${styleModules.text.subtitleCanvasFamily}`;
        ctx.fillText(badgeLabelText, badgeRect.x + badgePadX, badgeRect.y + badgeRect.height / 2 + 1);
        ctx.fillStyle = '#020617';
        ctx.textAlign = 'right';
        ctx.font = `${styleModules.text.titleCanvasWeight} ${badgeValueSize}px ${styleModules.text.titleCanvasFamily}`;
        ctx.fillText(
          badgeText,
          badgeRect.x + badgeRect.width - badgePadX,
          badgeRect.y + badgeRect.height / 2 + 1
        );
        ctx.restore();
      }

      if (shouldRenderHeaderText) {
        const centerTitleText = applyTextTransform(scene.title, styleModules.text.titleTransform);
        let centerTitleSize = Math.max(
          16,
          Math.round(
            (isVerticalLayout
              ? CLASSIC_HUD_SPEC.centerTitle.fontSizeNarrow
              : CLASSIC_HUD_SPEC.centerTitle.fontSize) * classicLayoutScale
          )
        );
        const sidePadding = Math.max(8, Math.round(10 * classicLayoutScale));
        const titleAvailableWidth = Math.max(
          120,
          timerBoxX - sidePadding - (badgeRect.x + badgeRect.width + sidePadding)
        );
        ctx.font = `${styleModules.text.titleCanvasWeight} ${centerTitleSize}px ${styleModules.text.titleCanvasFamily}`;
        const measuredTitleWidth = ctx.measureText(centerTitleText).width;
        if (measuredTitleWidth > titleAvailableWidth) {
          centerTitleSize = Math.max(
            14,
            Math.floor(centerTitleSize * (titleAvailableWidth / Math.max(1, measuredTitleWidth)))
          );
        }
        centerTitleSize = Math.max(14, Math.round(centerTitleSize * headerTextScale));
        ctx.font = `${styleModules.text.titleCanvasWeight} ${centerTitleSize}px ${styleModules.text.titleCanvasFamily}`;
        const scaledTitleWidth = ctx.measureText(centerTitleText).width;
        if (scaledTitleWidth > titleAvailableWidth) {
          centerTitleSize = Math.max(
            14,
            Math.floor(centerTitleSize * (titleAvailableWidth / Math.max(1, scaledTitleWidth)))
          );
        }
        const centerTitleRect: Rect = {
          x: board.x + (board.width - titleAvailableWidth) / 2,
          y: board.y,
          width: titleAvailableWidth,
          height: headerHeight
        };
        const centerTitleFill = resolveProgressFill(
          ctx,
          centerTitleRect,
          CLASSIC_HUD_SPEC.centerTitle.fillGradient,
          '#FFD93D'
        );
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `${styleModules.text.titleCanvasWeight} ${centerTitleSize}px ${styleModules.text.titleCanvasFamily}`;
        ctx.lineWidth = Math.max(1.5, Math.round(2 * classicLayoutScale));
        ctx.strokeStyle = CLASSIC_HUD_SPEC.centerTitle.strokeColor;
        ctx.shadowColor = 'rgba(0, 0, 0, 0.24)';
        ctx.shadowBlur = Math.max(2, Math.round(8 * classicLayoutScale));
        const centerTitleX = board.x + board.width / 2 + headerTextOffsetX;
        const centerTitleY = board.y + headerHeight / 2 + headerTextOffsetY;
        ctx.strokeText(centerTitleText, centerTitleX, centerTitleY);
        ctx.fillStyle = centerTitleFill;
        ctx.fillText(centerTitleText, centerTitleX, centerTitleY);
        ctx.restore();
      }

      if (shouldShowHeaderTimer) {
        drawStyledHeaderTimer(
          ctx,
          {
            x: timerBoxX,
            y: timerBoxY,
            width: timerBoxWidth,
            height: timerBoxHeight,
            radius: radiusTokenToPx(styleModules.timer.radiusToken, timerBoxHeight, classicLayoutScale)
          },
          styleModules.timer,
          visualTheme,
          timerTextValue,
          headerBackground,
          {
            padX: timerPadX,
            padY: timerPadY,
            dotSize: timerDotSize,
            gap: timerGap,
            fontSize: timerFontSize,
            scale: classicLayoutScale
          },
          scene.timeLeft <= 2,
          scene.segment.duration,
          scene.timeLeft,
          scene.countdownPercent / 100
        );

        if (shouldShowHeaderProgress) {
          const progressTrackHeight = Math.max(8, Math.round(CLASSIC_HUD_SPEC.progress.height * classicLayoutScale));
          const progressTrackWidth = Math.round(board.width * CLASSIC_HUD_SPEC.progress.widthRatio);
          const progressTrackX = Math.round(board.x + (board.width - progressTrackWidth) / 2);
          const progressTrackY =
            board.y +
            headerHeight -
            progressTrackHeight -
            Math.max(1, Math.round(CLASSIC_HUD_SPEC.progress.bottom * classicLayoutScale));
          const progressTrackRect: Rect = {
            x: progressTrackX,
            y: progressTrackY,
            width: progressTrackWidth,
            height: progressTrackHeight,
            radius: radiusTokenToPx(styleModules.progress.radiusToken, progressTrackHeight, classicLayoutScale)
          };
          if (isTextFillProgress) {
            drawTextProgressLabel(
              ctx,
              progressTrackRect,
              progressLabel,
              progressFillPercent,
              countdownPercent,
              styleModules,
              progressTrackTheme,
              classicLayoutScale,
              settings.generatedProgressEnabled ? settings.generatedProgressStyle : null,
              scene.phaseElapsed,
              generatedProgressFillColors,
              {
                active: shouldShowProgressSweep,
                progress: progressMotionState.sweepProgress,
                opacity: progressMotionState.sweepOpacity
              }
            );
          } else {
            const classicTrackFill = resolveProgressFill(
              ctx,
              progressTrackRect,
              settings.generatedProgressEnabled
                ? progressTrackTheme.progressTrackBg
                : CLASSIC_HUD_SPEC.progress.trackBackground,
              settings.generatedProgressEnabled ? progressTrackTheme.progressTrackBg : '#141414'
            );
            drawRoundedRect(ctx, progressTrackRect, {
              fill: classicTrackFill,
              stroke: progressTrackTheme.progressTrackBorder,
              lineWidth: Math.max(1, Math.round(CLASSIC_HUD_SPEC.progress.borderWidth * classicLayoutScale))
            });
            const fillInset = Math.max(1, Math.round(CLASSIC_HUD_SPEC.progress.fillInset * classicLayoutScale));
            const progressFillRect: Rect = {
              x: progressTrackX + fillInset,
              y: progressTrackY + fillInset,
              width: ((progressTrackWidth - fillInset * 2) * progressFillPercent) / 100,
              height: Math.max(1, progressTrackHeight - fillInset * 2),
              radius: Math.max(1, (progressTrackHeight - fillInset * 2) / 2)
            };
            if (progressFillRect.width > 0) {
              roundRectPath(ctx, progressFillRect);
              ctx.fillStyle = resolveProgressFill(ctx, progressFillRect, progressFillDefinition, accent);
              ctx.fill();
              if (shouldShowProgressSweep) {
                drawProgressSweepOverlay(
                  ctx,
                  progressFillRect,
                  'horizontal',
                  progressMotionState.sweepProgress,
                  progressMotionState.sweepOpacity
                );
              }
              drawProgressPulseOverlay(
                ctx,
                progressFillRect,
                'horizontal',
                progressMotionState.pulseOverlayOpacity
              );
              drawProgressPulseGlow(
                ctx,
                progressFillRect,
                progressMotionState.pulseGlowOpacity,
                hexToRgba(accent, 0.14 + progressMotionState.pulseGlowOpacity * 0.38),
                Math.max(4, Math.round(8 * uiScale)),
                Math.max(1, Math.round(1.5 * uiScale))
              );
              ctx.save();
              roundRectPath(ctx, progressFillRect);
              ctx.shadowColor =
                settings.generatedProgressEnabled
                  ? progressTrackTheme.progressFillGlow ?? CLASSIC_HUD_SPEC.progress.fillGlowCanvas
                  : styleModules.progress.variant === 'glow'
                  ? visualTheme.progressFillGlow ?? accent
                  : CLASSIC_HUD_SPEC.progress.fillGlowCanvas;
              ctx.shadowBlur = Math.max(4, Math.round(8 * uiScale));
              ctx.strokeStyle = 'rgba(255, 166, 120, 0.8)';
              ctx.lineWidth = Math.max(1, Math.round(1.5 * uiScale));
              ctx.stroke();
              ctx.restore();
            }
          }
        }
      }

      if (shouldShowHeaderProgress && !shouldShowHeaderTimer) {
        const progressTrackHeight = Math.max(8, Math.round(CLASSIC_HUD_SPEC.progress.height * classicLayoutScale));
        const progressTrackWidth = Math.round(board.width * CLASSIC_HUD_SPEC.progress.widthRatio);
        const progressTrackX = Math.round(board.x + (board.width - progressTrackWidth) / 2);
        const progressTrackY =
          board.y +
          headerHeight -
          progressTrackHeight -
          Math.max(1, Math.round(CLASSIC_HUD_SPEC.progress.bottom * classicLayoutScale));
        const progressTrackRect: Rect = {
          x: progressTrackX,
          y: progressTrackY,
          width: progressTrackWidth,
          height: progressTrackHeight,
          radius: radiusTokenToPx(styleModules.progress.radiusToken, progressTrackHeight, classicLayoutScale)
        };
        if (isTextFillProgress) {
          drawTextProgressLabel(
            ctx,
            progressTrackRect,
            progressLabel,
            progressFillPercent,
            countdownPercent,
            styleModules,
            progressTrackTheme,
            classicLayoutScale,
            settings.generatedProgressEnabled ? settings.generatedProgressStyle : null,
            scene.phaseElapsed,
            generatedProgressFillColors,
            {
              active: shouldShowProgressSweep,
              progress: progressMotionState.sweepProgress,
              opacity: progressMotionState.sweepOpacity
            }
          );
        } else {
          const classicTrackFill = resolveProgressFill(
            ctx,
            progressTrackRect,
            settings.generatedProgressEnabled
              ? progressTrackTheme.progressTrackBg
              : CLASSIC_HUD_SPEC.progress.trackBackground,
            settings.generatedProgressEnabled ? progressTrackTheme.progressTrackBg : '#141414'
          );
          drawRoundedRect(ctx, progressTrackRect, {
            fill: classicTrackFill,
            stroke: progressTrackTheme.progressTrackBorder,
            lineWidth: Math.max(1, Math.round(CLASSIC_HUD_SPEC.progress.borderWidth * classicLayoutScale))
          });
          const fillInset = Math.max(1, Math.round(CLASSIC_HUD_SPEC.progress.fillInset * classicLayoutScale));
          const progressFillRect: Rect = {
            x: progressTrackX + fillInset,
            y: progressTrackY + fillInset,
            width: ((progressTrackWidth - fillInset * 2) * progressFillPercent) / 100,
            height: Math.max(1, progressTrackHeight - fillInset * 2),
            radius: Math.max(1, (progressTrackHeight - fillInset * 2) / 2)
          };
          if (progressFillRect.width > 0) {
            roundRectPath(ctx, progressFillRect);
            ctx.fillStyle = resolveProgressFill(ctx, progressFillRect, progressFillDefinition, accent);
            ctx.fill();
            if (shouldShowProgressSweep) {
              drawProgressSweepOverlay(
                ctx,
                progressFillRect,
                'horizontal',
                progressMotionState.sweepProgress,
                progressMotionState.sweepOpacity
              );
            }
            drawProgressPulseOverlay(
              ctx,
              progressFillRect,
              'horizontal',
              progressMotionState.pulseOverlayOpacity
            );
            drawProgressPulseGlow(
              ctx,
              progressFillRect,
              progressMotionState.pulseGlowOpacity,
              hexToRgba(accent, 0.14 + progressMotionState.pulseGlowOpacity * 0.38),
              Math.max(4, Math.round(8 * uiScale)),
              Math.max(1, Math.round(1.5 * uiScale))
            );
            ctx.save();
            roundRectPath(ctx, progressFillRect);
            ctx.shadowColor =
              settings.generatedProgressEnabled
                ? progressTrackTheme.progressFillGlow ?? CLASSIC_HUD_SPEC.progress.fillGlowCanvas
                : styleModules.progress.variant === 'glow'
                ? visualTheme.progressFillGlow ?? accent
                : CLASSIC_HUD_SPEC.progress.fillGlowCanvas;
            ctx.shadowBlur = Math.max(4, Math.round(8 * uiScale));
            ctx.strokeStyle = 'rgba(255, 166, 120, 0.8)';
            ctx.lineWidth = Math.max(1, Math.round(1.5 * uiScale));
            ctx.stroke();
            ctx.restore();
          }
        }
      }
    } else {
      const nonClassicScale = Math.max(0.55, layoutScale);
      const titleFontSizePx = Math.max(
        12,
        Math.round(styleHudLayout.title.fontSize * nonClassicScale * headerTextScale)
      );
      const subtitleFontSizePx = Math.max(
        8,
        Math.round(styleHudLayout.title.subtitleSize * nonClassicScale * headerTextScale)
      );
      const subtitleGapPx = Math.max(
        1,
        Math.round(styleHudLayout.title.subtitleGap * nonClassicScale * Math.max(0.8, headerTextScale))
      );
      const titleOriginBase = resolveAnchoredRect(styleHudLayout.title, 0, 0, headerRect, nonClassicScale);
      const titleOrigin = {
        ...titleOriginBase,
        x: titleOriginBase.x + headerTextOffsetX,
        y: titleOriginBase.y + headerTextOffsetY
      };
      const customLogoSize = Math.max(12, Math.round(resolvedLayout.logo.size * nonClassicScale));

      if (shouldRenderCustomLogo) {
        drawHeaderLogo({
          x: headerRect.x + Math.round(resolvedLayout.logo.left * nonClassicScale),
          y: headerRect.y + Math.round(resolvedLayout.logo.top * nonClassicScale),
          width: customLogoSize,
          height: customLogoSize
        });
      }

      const drawNonClassicHeaderText = () => {
        if (!shouldRenderHeaderText) {
          return;
        }

        const titleText = applyTextTransform(scene.title, styleModules.text.titleTransform);
        const subtitleText = applyTextTransform(scene.subtitle, styleModules.text.subtitleTransform);
        ctx.textBaseline = 'top';
        ctx.font = `${styleModules.text.titleCanvasWeight} ${titleFontSizePx}px ${styleModules.text.titleCanvasFamily}`;
        const titleTextWidth = ctx.measureText(titleText).width;
        ctx.font = `${styleModules.text.subtitleCanvasWeight} ${subtitleFontSizePx}px ${styleModules.text.subtitleCanvasFamily}`;
        const subtitleTextWidth = ctx.measureText(subtitleText).width;
        const subtitleBadgeWidth =
          styleModules.header.variant === 'split'
            ? subtitleTextWidth + Math.round(22 * nonClassicScale)
            : subtitleTextWidth;
        const wrapperPadX =
          styleModules.header.variant === 'panel' || styleModules.header.variant === 'ribbon'
            ? Math.round(14 * nonClassicScale)
            : 0;
        const wrapperPadY =
          styleModules.header.variant === 'panel' || styleModules.header.variant === 'ribbon'
            ? Math.round(8 * nonClassicScale)
            : 0;
        const accentInset =
          styleModules.header.variant === 'ribbon' ? Math.round(10 * nonClassicScale) : 0;
        const underlineHeight =
          styleModules.header.variant === 'underline' ? Math.max(3, Math.round(4 * nonClassicScale)) : 0;
        const titleBlockWidth =
          Math.max(titleTextWidth, subtitleBadgeWidth) + wrapperPadX * 2 + accentInset;
        const titleBlockHeight =
          titleFontSizePx +
          subtitleGapPx +
          (styleModules.header.variant === 'split'
            ? Math.max(18, Math.round(subtitleFontSizePx + 10 * nonClassicScale))
            : subtitleFontSizePx) +
          wrapperPadY * 2 +
          underlineHeight +
          (underlineHeight > 0 ? Math.round(6 * nonClassicScale) : 0);
        const inlineLogoSize =
          shouldRenderInlineLogo && brandLogo
            ? Math.max(14, Math.round(packagePreset.chrome.logoSize * nonClassicScale))
            : 0;
        const inlineLogoGap =
          inlineLogoSize > 0 ? Math.max(4, Math.round(packagePreset.chrome.titleGap * nonClassicScale)) : 0;
        const contentWidth = titleBlockWidth + (inlineLogoSize > 0 ? inlineLogoSize + inlineLogoGap : 0);
        const contentLeft =
          styleHudLayout.title.align === 'left'
            ? titleOrigin.x
            : styleHudLayout.title.align === 'center'
            ? titleOrigin.x - contentWidth / 2
            : titleOrigin.x - contentWidth;
        const textBlockLeft = contentLeft + (inlineLogoSize > 0 ? inlineLogoSize + inlineLogoGap : 0);
        let titleTextX =
          styleHudLayout.title.align === 'left'
            ? textBlockLeft + wrapperPadX + accentInset
            : styleHudLayout.title.align === 'center'
            ? textBlockLeft + titleBlockWidth / 2
            : textBlockLeft + titleBlockWidth - wrapperPadX;

        if (inlineLogoSize > 0) {
          const inlineLogoRect: Rect = {
            x: contentLeft,
            y: titleOrigin.y,
            width: inlineLogoSize,
            height: inlineLogoSize
          };
          drawHeaderLogo(inlineLogoRect);
        }

        if (styleModules.header.variant === 'panel' || styleModules.header.variant === 'ribbon') {
          drawRoundedRect(
            ctx,
            {
              x: textBlockLeft,
              y: titleOrigin.y,
              width: titleBlockWidth,
              height: titleBlockHeight,
              radius: Math.round(18 * nonClassicScale)
            },
            {
              fill: 'rgba(255,255,255,0.22)',
              stroke: '#000000',
              lineWidth: Math.max(1.5, Math.round(2 * nonClassicScale))
            }
          );
          if (styleModules.header.variant === 'ribbon') {
            drawRoundedRect(
              ctx,
              {
                x: textBlockLeft,
                y: titleOrigin.y + Math.round(6 * nonClassicScale),
                width: Math.max(4, Math.round(6 * nonClassicScale)),
                height: Math.max(24, titleBlockHeight - Math.round(12 * nonClassicScale)),
                radius: Math.round(4 * nonClassicScale)
              },
              {
                fill: visualTheme.timerDot
              }
            );
          }
        }

        ctx.textAlign = styleHudLayout.title.align;
        ctx.fillStyle = visualTheme.headerText;
        ctx.font = `${styleModules.text.titleCanvasWeight} ${titleFontSizePx}px ${styleModules.text.titleCanvasFamily}`;
        ctx.fillText(titleText, titleTextX, titleOrigin.y + wrapperPadY);
        const subtitleY = titleOrigin.y + wrapperPadY + titleFontSizePx + subtitleGapPx;

        if (styleModules.header.variant === 'split') {
          const badgeHeight = Math.max(18, Math.round(subtitleFontSizePx + 10 * nonClassicScale));
          let badgeX = titleTextX;
          if (styleHudLayout.title.align === 'left') {
            badgeX = textBlockLeft;
          } else if (styleHudLayout.title.align === 'center') {
            badgeX = textBlockLeft + titleBlockWidth / 2 - subtitleBadgeWidth / 2;
          } else {
            badgeX = textBlockLeft + titleBlockWidth - subtitleBadgeWidth;
          }
          drawRoundedRect(
            ctx,
            {
              x: badgeX,
              y: subtitleY,
              width: subtitleBadgeWidth,
              height: badgeHeight,
              radius: badgeHeight / 2
            },
            {
              fill: 'rgba(255,255,255,0.72)',
              stroke: '#000000',
              lineWidth: Math.max(1.5, Math.round(2 * nonClassicScale))
            }
          );
          ctx.fillStyle = visualTheme.headerSubText;
          ctx.textAlign = 'center';
          ctx.font = `${styleModules.text.subtitleCanvasWeight} ${subtitleFontSizePx}px ${styleModules.text.subtitleCanvasFamily}`;
          ctx.fillText(subtitleText, badgeX + subtitleBadgeWidth / 2, subtitleY + Math.max(2, Math.round(4 * nonClassicScale)));
        } else {
          ctx.fillStyle = visualTheme.headerSubText;
          ctx.textAlign = styleHudLayout.title.align;
          ctx.font = `${styleModules.text.subtitleCanvasWeight} ${subtitleFontSizePx}px ${styleModules.text.subtitleCanvasFamily}`;
          ctx.fillText(subtitleText, titleTextX, subtitleY);
        }

        if (styleModules.header.variant === 'underline') {
          const underlineWidth = Math.max(36, Math.round(titleFontSizePx * 2.35));
          const underlineX =
            styleHudLayout.title.align === 'left'
              ? titleTextX
              : styleHudLayout.title.align === 'center'
              ? titleTextX - underlineWidth / 2
              : titleTextX - underlineWidth;
          drawRoundedRect(
            ctx,
            {
              x: underlineX,
              y: subtitleY + subtitleFontSizePx + Math.max(4, Math.round(6 * nonClassicScale)),
              width: underlineWidth,
              height: Math.max(3, Math.round(4 * nonClassicScale)),
              radius: Math.max(2, Math.round(3 * nonClassicScale))
            },
            {
              fill: visualTheme.timerDot
            }
          );
        }
      };

      const timerPadX = Math.max(
        6,
        Math.round(styleHudLayout.timer.padX * nonClassicScale * styleModules.timer.paddingScale)
      );
      const timerPadY = Math.max(
        2,
        Math.round(styleHudLayout.timer.padY * nonClassicScale * styleModules.timer.paddingScale)
      );
      const timerDotSize = Math.max(4, Math.round(styleHudLayout.timer.dotSize * nonClassicScale));
      const timerGap = Math.max(4, Math.round(styleHudLayout.timer.gap * nonClassicScale));
      const timerFontSize = Math.max(0, Math.round(styleHudLayout.timer.fontSize * nonClassicScale));
      ctx.font = `${styleModules.timer.canvasFontWeight} ${timerFontSize}px ${styleModules.timer.canvasFontFamily}`;
      const nonClassicTimerMetrics = measureResolvedTimerBox(styleModules.timer, {
        textWidth: ctx.measureText(timerTextValue).width,
        fontSize: timerFontSize,
        padX: timerPadX,
        padY: timerPadY,
        dotSize: timerDotSize,
        gap: timerGap,
        minWidth: Math.round(styleHudLayout.timer.minWidth * nonClassicScale)
      });
      const timerBoxWidth = Math.max(24, nonClassicTimerMetrics.width);
      const timerBoxHeight = Math.max(24, nonClassicTimerMetrics.height);
      const timerRect = resolveAnchoredRect(styleHudLayout.timer, timerBoxWidth, timerBoxHeight, headerRect, nonClassicScale);
      if (shouldShowHeaderTimer) {
        drawStyledHeaderTimer(
          ctx,
          {
            ...timerRect,
            radius: radiusTokenToPx(styleModules.timer.radiusToken, timerRect.height, nonClassicScale)
          },
          styleModules.timer,
          visualTheme,
          timerTextValue,
          headerBackground,
          {
            padX: timerPadX,
            padY: timerPadY,
            dotSize: timerDotSize,
            gap: timerGap,
            fontSize: timerFontSize,
            scale: nonClassicScale
          },
          scene.timeLeft <= 2,
          scene.segment.duration,
          scene.timeLeft,
          scene.countdownPercent / 100
        );
      }

      if (shouldShowHeaderProgress) {
        const progressTrackWidth = Math.max(4, Math.round(styleHudLayout.progress.width * nonClassicScale));
        const progressTrackHeight = Math.max(4, Math.round(styleHudLayout.progress.height * nonClassicScale));
        const progressTrackRectBase = resolveAnchoredRect(
          styleHudLayout.progress,
          progressTrackWidth,
          progressTrackHeight,
          headerRect,
          nonClassicScale
        );
        const progressTrackRect: Rect = {
          ...progressTrackRectBase,
          radius: clamp(
            settings.generatedProgressEnabled
              ? Math.max(8, Math.round(progressTrackRectBase.height / 2))
              : radiusTokenToPx(styleModules.progress.radiusToken, progressTrackRectBase.height, nonClassicScale),
            0,
            Math.min(progressTrackRectBase.width, progressTrackRectBase.height) / 2
          )
        };
        if (isTextFillProgress) {
          drawTextProgressLabel(
            ctx,
            progressTrackRect,
            progressLabel,
            progressFillPercent,
            countdownPercent,
            styleModules,
            progressTrackTheme,
            nonClassicScale,
            settings.generatedProgressEnabled ? settings.generatedProgressStyle : null,
            scene.phaseElapsed,
            generatedProgressFillColors,
            {
              active: shouldShowProgressSweep,
              progress: progressMotionState.sweepProgress,
              opacity: progressMotionState.sweepOpacity
            }
          );
        } else {
          drawRoundedRect(ctx, progressTrackRect, {
            fill: progressTrackTheme.progressTrackBg,
            stroke: progressTrackTheme.progressTrackBorder,
            lineWidth: settings.generatedProgressEnabled
              ? Math.max(2, Math.round(progressTrackRect.height * 0.08))
              : Math.max(1.5, Math.round(2 * nonClassicScale * styleModules.progress.borderWidthScale))
          });
          const fillPercent = progressFillPercent / 100;
          const progressFillRect: Rect =
            styleHudLayout.progress.orientation === 'vertical'
              ? {
                  x: progressTrackRect.x,
                  y: progressTrackRect.y + progressTrackRect.height * (1 - fillPercent),
                  width: progressTrackRect.width,
                  height: progressTrackRect.height * fillPercent,
                  radius: progressTrackRect.radius
                }
              : {
                  x: progressTrackRect.x,
                  y: progressTrackRect.y,
                  width: progressTrackRect.width * fillPercent,
                  height: progressTrackRect.height,
                  radius: progressTrackRect.radius
                };
          if (progressFillRect.width > 0 && progressFillRect.height > 0) {
            roundRectPath(ctx, progressFillRect);
            ctx.fillStyle = resolveProgressFill(ctx, progressFillRect, progressFillDefinition, accent);
            ctx.fill();
            if (shouldShowProgressSweep) {
              drawProgressSweepOverlay(
                ctx,
                progressFillRect,
                styleHudLayout.progress.orientation,
                progressMotionState.sweepProgress,
                progressMotionState.sweepOpacity
              );
            }
            drawProgressPulseOverlay(
              ctx,
              progressFillRect,
              styleHudLayout.progress.orientation,
              progressMotionState.pulseOverlayOpacity
            );
            drawProgressPulseGlow(
              ctx,
              progressFillRect,
              progressMotionState.pulseGlowOpacity,
              hexToRgba(accent, 0.14 + progressMotionState.pulseGlowOpacity * 0.38),
              Math.max(6, Math.round(10 * uiScale)),
              Math.max(1, Math.round(1.5 * uiScale))
            );
            if (
              settings.generatedProgressEnabled
                ? Boolean(progressTrackTheme.progressFillGlow)
                : styleModules.progress.variant === 'glow'
            ) {
              ctx.save();
              roundRectPath(ctx, progressFillRect);
              ctx.shadowColor = progressTrackTheme.progressFillGlow ?? accent;
              ctx.shadowBlur = Math.max(6, Math.round(10 * uiScale));
              ctx.strokeStyle = progressTrackTheme.timerDot;
              ctx.lineWidth = Math.max(1, Math.round(1.5 * uiScale));
              ctx.stroke();
              ctx.restore();
            }
          }
        }
      }

      drawNonClassicHeaderText();
    }
  }

  drawRoundedRect(ctx, gameAreaRect, {
    fill: generatedBackgroundCoversHeader ? 'rgba(255,255,255,0)' : isStorybookStyle ? '#1F475B' : gameBackground,
    stroke: undefined,
    lineWidth: 0
  });
  ctx.save();
  roundRectPath(ctx, gameAreaRect);
  ctx.clip();
  if (generatedBackgroundSpec && !generatedBackgroundCoversHeader) {
    drawGeneratedBackground(ctx, generatedBackgroundSpec, gameAreaRect, timestamp);
  }
  if (isStorybookStyle) {
    const gameGradient = ctx.createLinearGradient(
      gameAreaRect.x,
      gameAreaRect.y,
      gameAreaRect.x,
      gameAreaRect.y + gameAreaRect.height
    );
    gameGradient.addColorStop(0, 'rgba(255,255,255,0.12)');
    gameGradient.addColorStop(1, 'rgba(0,0,0,0.18)');
    ctx.fillStyle = gameGradient;
    ctx.fillRect(gameAreaRect.x, gameAreaRect.y, gameAreaRect.width, gameAreaRect.height);
  } else {
    ctx.fillStyle = hexToRgba(visualTheme.patternColor, 0.12);
    const patternSpacing = Math.max(16, Math.round(26 * uiScale));
    const patternRadius = Math.max(1, Math.round(2 * uiScale));
    for (let y = gameAreaRect.y; y <= gameAreaRect.y + gameAreaRect.height; y += patternSpacing) {
      for (let x = gameAreaRect.x; x <= gameAreaRect.x + gameAreaRect.width; x += patternSpacing) {
        ctx.beginPath();
        ctx.arc(x, y, patternRadius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();

  if (shouldRenderPuzzlePanels) {
    const currentImages = loadedImages[scene.segment.puzzleIndex];
    if (!currentImages) {
      throw new Error('Missing puzzle images for frame render.');
    }

    ctx.save();
    roundRectPath(ctx, gameAreaRect);
    ctx.clip();
    if (scene.segment.phase === 'transitioning') {
      const panelCenterX = gameAreaRect.x + gameAreaRect.width / 2;
      const panelCenterY = gameAreaRect.y + gameAreaRect.height / 2;
      ctx.globalAlpha *= puzzlePanelOpacity;
      ctx.translate(panelCenterX, panelCenterY);
      if (puzzlePanelRotate !== 0) {
        ctx.rotate(puzzlePanelRotate);
      }
      ctx.scale(puzzlePanelScale, puzzlePanelScale);
      ctx.translate(-panelCenterX, -panelCenterY);
    }

    let originalPanel: Rect;
    let modifiedPanel: Rect;

    let originalImageViewport: Rect;
    let modifiedImageViewport: Rect;

    if (isStorybookStyle) {
      if (isVerticalLayout) {
        const panelHeight = (panelStageRect.height - panelGap) / 2;
        originalPanel = {
          x: panelStageRect.x + Math.round(8 * uiScale),
          y: panelStageRect.y + Math.round(8 * uiScale),
          width: panelStageRect.width - Math.round(16 * uiScale),
          height: panelHeight - Math.round(12 * uiScale),
          radius: panelRadius
        };
        modifiedPanel = {
          x: originalPanel.x,
          y: originalPanel.y + originalPanel.height + panelGap,
          width: originalPanel.width,
          height: originalPanel.height,
          radius: panelRadius
        };
      } else {
        const panelWidth = (panelStageRect.width - panelGap) / 2;
        originalPanel = {
          x: panelStageRect.x + Math.round(8 * uiScale),
          y: panelStageRect.y + Math.round(8 * uiScale),
          width: panelWidth - Math.round(12 * uiScale),
          height: panelStageRect.height - Math.round(16 * uiScale),
          radius: panelRadius
        };
        modifiedPanel = {
          x: originalPanel.x + originalPanel.width + panelGap,
          y: originalPanel.y,
          width: originalPanel.width,
          height: originalPanel.height,
          radius: panelRadius
        };
      }

      originalImageViewport = originalPanel;
      modifiedImageViewport = modifiedPanel;

      drawRoundedRect(ctx, originalImageViewport, {
        fill: panelBackground
      });
      drawRoundedRect(ctx, modifiedImageViewport, {
        fill: panelBackground
      });
    } else {
      const contentRect: Rect = {
        x: panelStageRect.x + gamePadding,
        y: panelStageRect.y + gamePadding,
        width: Math.max(1, panelStageRect.width - gamePadding * 2),
        height: Math.max(1, panelStageRect.height - gamePadding * 2),
        radius: 0
      };

      if (isVerticalLayout) {
        const panelHeight = Math.max(1, (contentRect.height - panelGap) / 2);
        originalPanel = {
          x: contentRect.x,
          y: contentRect.y,
          width: contentRect.width,
          height: panelHeight,
          radius: panelRadius
        };
        modifiedPanel = {
          x: contentRect.x,
          y: contentRect.y + panelHeight + panelGap,
          width: contentRect.width,
          height: panelHeight,
          radius: panelRadius
        };
      } else {
        const panelWidth = Math.max(1, (contentRect.width - panelGap) / 2);
        originalPanel = {
          x: contentRect.x,
          y: contentRect.y,
          width: panelWidth,
          height: contentRect.height,
          radius: panelRadius
        };
        modifiedPanel = {
          x: contentRect.x + panelWidth + panelGap,
          y: contentRect.y,
          width: panelWidth,
          height: contentRect.height,
          radius: panelRadius
        };
      }

      originalImageViewport = originalPanel;
      modifiedImageViewport = modifiedPanel;
    }

    drawImageCover(ctx, currentImages.original, originalImageViewport);
    const modifiedCoverFrame = drawImageCover(ctx, currentImages.modified, modifiedImageViewport);

    if (scene.blinkOverlayActive && scene.blinkOverlayVisible) {
      ctx.save();
      roundRectPath(ctx, modifiedImageViewport);
      ctx.clip();
      ctx.drawImage(
        currentImages.original,
        modifiedCoverFrame.x,
        modifiedCoverFrame.y,
        modifiedCoverFrame.width,
        modifiedCoverFrame.height
      );
      ctx.restore();
    }

    if (!isStorybookStyle && imagePanelOutlineWidth > 0) {
      drawRoundedRect(ctx, originalPanel, {
        stroke: imagePanelOutlineColor,
        lineWidth: imagePanelOutlineWidth
      });
      drawRoundedRect(ctx, modifiedPanel, {
        stroke: imagePanelOutlineColor,
        lineWidth: imagePanelOutlineWidth
      });
    }

    if (isStorybookStyle && !isVerticalLayout) {
      const separatorX = originalPanel.x + originalPanel.width + panelGap / 2;
      ctx.fillStyle = hexToRgba('#5A4A2B', 0.45);
      ctx.fillRect(
        separatorX - Math.max(1, Math.round(1.5 * uiScale)),
        panelStageRect.y + Math.round(8 * uiScale),
        Math.max(2, Math.round(3 * uiScale)),
        panelStageRect.height - Math.round(16 * uiScale)
      );

      const badgeWidth = Math.max(36, Math.round(44 * uiScale));
      const badgeHeight = Math.max(16, Math.round(120 * uiScale));
      const badgeRect: Rect = {
        x: separatorX - badgeWidth / 2,
        y: panelStageRect.y + panelStageRect.height / 2 - badgeHeight / 2,
        width: badgeWidth,
        height: badgeHeight,
        radius: Math.round(8 * uiScale)
      };
      drawRoundedRect(ctx, badgeRect, {
        fill: '#D8B149',
        stroke: '#4D3E26',
        lineWidth: Math.max(2, 2 * uiScale)
      });
      ctx.save();
      ctx.translate(badgeRect.x + badgeRect.width / 2, badgeRect.y + badgeRect.height / 2);
      ctx.rotate(Math.PI / 2);
      ctx.fillStyle = '#3B2E1A';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `900 ${Math.max(9, Math.round(16 * uiScale))}px "Arial Black", "Segoe UI", sans-serif`;
      ctx.fillText('COMPARE', 0, 0);
      ctx.restore();

      const drawPanelTag = (panel: Rect, label: string, fill: string, text: string) => {
        const tagRect: Rect = {
          x: panel.x + Math.round(8 * uiScale),
          y: panel.y + Math.round(8 * uiScale),
          width: Math.round(95 * uiScale),
          height: Math.round(28 * uiScale),
          radius: Math.round(8 * uiScale)
        };
        drawRoundedRect(ctx, tagRect, { fill, stroke: '#4D3E26', lineWidth: Math.max(2, 2 * uiScale) });
        ctx.fillStyle = text;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `900 ${Math.max(9, Math.round(14 * uiScale))}px "Arial Black", "Segoe UI", sans-serif`;
        ctx.fillText(label, tagRect.x + tagRect.width / 2, tagRect.y + tagRect.height / 2 + 1);
      };

      drawPanelTag(originalPanel, 'ORIGINAL', '#F3E6C4', '#3B2E1A');
      drawPanelTag(modifiedPanel, 'MODIFIED', '#D37872', '#23180D');
    }

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

    if (scene.segment.phase === 'revealing' && scene.revealedRegionCount > 0) {
      const visibleRegions = puzzles[scene.segment.puzzleIndex].regions.slice(0, scene.revealedRegionCount);
      const markerBoundsList = visibleRegions.map((region) =>
        getMarkerBounds(region, modifiedCoverFrame, currentImages.modified, settings, effectiveRevealVariant)
      );
      const usesPersistentSpotlight =
        settings.revealBehavior === 'spotlight' || settings.revealBehavior === 'cinematic_sequential';

      if (usesPersistentSpotlight) {
        ctx.save();
        roundRectPath(ctx, modifiedImageViewport);
        ctx.clip();
        ctx.fillStyle =
          settings.revealBehavior === 'cinematic_sequential'
            ? 'rgba(3,7,18,0.5)'
            : 'rgba(3,7,18,0.32)';
        ctx.fillRect(
          modifiedImageViewport.x,
          modifiedImageViewport.y,
          modifiedImageViewport.width,
          modifiedImageViewport.height
        );
        markerBoundsList.forEach((markerBounds, index) => {
          drawRevealSpotlightFill(
            ctx,
            markerBounds,
            settings,
            effectiveRevealVariant,
            index === markerBoundsList.length - 1,
            uiScale
          );
        });
        ctx.restore();
      }

      markerBoundsList.forEach((markerBounds) => {
        drawRevealMarker(ctx, markerBounds, settings, effectiveRevealVariant, uiScale);
      });
    }

    ctx.restore();
  }

  if (scene.segment.phase === 'intro' || scene.segment.phase === 'outro') {
    drawSceneCard(ctx, sceneOverlayRect, scene, settings, visualTheme, isVerticalLayout, uiScale);
  }

  if (scene.segment.phase === 'transitioning') {
    drawTransitionOverlay(ctx, sceneOverlayRect, scene, settings, visualTheme, isVerticalLayout, uiScale);
  }
};

const drawTransitionOverlay = (
  ctx: CanvasRenderingContext2D,
  gameRect: Rect,
  scene: RenderScene,
  settings: VideoSettings,
  visualTheme: VisualTheme,
  isVerticalLayout: boolean,
  uiScale: number
) => {
  const packagePreset =
    VIDEO_PACKAGE_PRESETS[settings.videoPackagePreset] ?? VIDEO_PACKAGE_PRESETS.gameshow;
  const styleModules = resolveVideoStyleModules(settings, packagePreset);
  const transitionState = resolveVideoTransitionSequenceState({
    phaseDuration: scene.segment.duration,
    timeLeft: scene.timeLeft
  });
  const titleText = applyTextTransform(VIDEO_TRANSITION_LABEL, styleModules.text.titleTransform);
  const typedTitle = revealTypewriterText(titleText, transitionState.titleProgress);
  const visibleTitle = typedTitle.text || ' ';

  ctx.save();
  roundRectPath(ctx, gameRect);
  ctx.clip();

  const overlay = ctx.createLinearGradient(gameRect.x, gameRect.y, gameRect.x, gameRect.y + gameRect.height);
  overlay.addColorStop(0, `rgba(6,11,20,${(transitionState.overlayOpacity * 0.54).toFixed(3)})`);
  overlay.addColorStop(1, `rgba(6,11,20,${(transitionState.overlayOpacity * 0.78).toFixed(3)})`);
  ctx.fillStyle = overlay;
  ctx.fillRect(gameRect.x, gameRect.y, gameRect.width, gameRect.height);

  ctx.translate(
    gameRect.x + gameRect.width / 2,
    gameRect.y + gameRect.height / 2 + transitionState.titleTranslateY
  );
  ctx.globalAlpha = clamp(transitionState.titleOpacity, 0, 1);

  const maxTextWidth = gameRect.width * 0.82;
  const titleFontSize = fitTextSize(
    ctx,
    titleText,
    maxTextWidth,
    Math.max(28, Math.round((isVerticalLayout ? 58 : 76) * uiScale)),
    styleModules.text.titleCanvasFamily,
    styleModules.text.titleCanvasWeight
  );
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${styleModules.text.titleCanvasWeight} ${titleFontSize}px ${styleModules.text.titleCanvasFamily}`;
  ctx.fillStyle = '#F8FAFC';
  ctx.shadowColor = 'rgba(0,0,0,0.36)';
  ctx.shadowBlur = Math.round(28 * uiScale);
  ctx.shadowOffsetY = Math.round(10 * uiScale);
  ctx.fillText(visibleTitle, 0, -Math.round(8 * uiScale));
  ctx.restore();

  if (typedTitle.visibleGlyphs < typedTitle.totalGlyphs) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${styleModules.text.titleCanvasWeight} ${titleFontSize}px ${styleModules.text.titleCanvasFamily}`;
    const titleWidth = ctx.measureText(visibleTitle).width;
    ctx.fillStyle = 'rgba(248,250,252,0.82)';
    ctx.fillRect(
      titleWidth / 2 + Math.max(8, Math.round(10 * uiScale)),
      -Math.round(titleFontSize * 0.42),
      Math.max(2, Math.round(3 * uiScale)),
      Math.max(24, Math.round(titleFontSize * 0.86))
    );
    ctx.restore();
  }

  ctx.restore();
};

const postMessageToMain = (message: WorkerResponse, transfer: Transferable[] = []) => {
  (self as any).postMessage(message, transfer);
};

const renderPreviewFrameInWorker = async ({
  source = 'legacy',
  puzzles,
  settings,
  timestamp,
  generatedBackgroundPack,
  introVideoFile
}: PreviewFrameOptions): Promise<{ buffer: ArrayBuffer; mimeType: string }> => {
  if (!puzzles.length) throw new Error('No puzzles available for preview.');

  const { width, height } = getExportDimensions(settings.aspectRatio, settings.exportResolution);
  const timeline = buildTimeline(puzzles, settings);
  const totalDuration = timeline.length > 0 ? timeline[timeline.length - 1].end : 0;
  const safeTimestamp =
    totalDuration > 0 ? clamp(timestamp, 0, Math.max(0, totalDuration - 1 / FPS)) : 0;
  const scene = getSceneAtTime(safeTimestamp, timeline, puzzles, settings);
  const telemetry = createTelemetryState();
  const puzzleAssetCache = createPuzzleAssetCache(source, puzzles, telemetry);
  const loadedImages = puzzleAssetCache.loadedImages;
  const sceneNeedsImages = scene.segment.phase !== 'intro' && scene.segment.phase !== 'outro';
  const introVideoActive =
    scene.segment.phase === 'intro' && settings.introVideoEnabled && Boolean(introVideoFile);
  let rawLogo: ImageBitmap | null = null;
  let brandLogo: ImageBitmap | null = null;
  let introVideoResource: IntroVideoResource | null = null;

  try {
    if (sceneNeedsImages) {
      await puzzleAssetCache.ensureWindow(scene.segment.puzzleIndex);
    }
    if (settings.logo) {
      rawLogo = await loadLogoImage(settings.logo);
      brandLogo = await processLogoBitmap(rawLogo);
      if (brandLogo !== rawLogo) {
        releaseBitmap(rawLogo);
        rawLogo = null;
      }
    }
    throwIfCanceled();

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Unable to initialize canvas renderer for preview.');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    if (introVideoActive && introVideoFile) {
      introVideoResource = await prepareIntroVideoResource(introVideoFile);
      const drewIntro = await drawIntroVideoFrame(
        ctx as unknown as CanvasRenderingContext2D,
        introVideoResource,
        scene.phaseElapsed,
        width,
        height
      );
      if (!drewIntro) {
        drawFrame(
          ctx as unknown as CanvasRenderingContext2D,
          width,
          height,
          puzzles,
          loadedImages,
          brandLogo,
          settings,
          generatedBackgroundPack,
          scene,
          safeTimestamp
        );
      }
    } else {
      drawFrame(
        ctx as unknown as CanvasRenderingContext2D,
        width,
        height,
        puzzles,
        loadedImages,
        brandLogo,
        settings,
        generatedBackgroundPack,
        scene,
        safeTimestamp
      );
    }
    throwIfCanceled();

    const blob = await canvas.convertToBlob({ type: 'image/png' });
    throwIfCanceled();

    return {
      buffer: await blob.arrayBuffer(),
      mimeType: blob.type || 'image/png'
    };
  } finally {
    puzzleAssetCache.releaseAll();
    releaseBitmap(brandLogo);
    releaseBitmap(rawLogo);
  }
};

const exportVideoInWorker = async ({
  source,
  puzzles,
  settings,
  generatedBackgroundPack,
  audioAssets,
  introVideoFile,
  streamOutput = false,
  onProgress
}: ExportVideoOptions): Promise<
  | { mode: 'buffer'; buffer: ArrayBuffer; fileName: string; mimeType: string }
  | { mode: 'stream'; fileName: string; mimeType: string }
> => {
  if (!puzzles.length) throw new Error('No puzzles available for export.');

  const { width, height } = getExportDimensions(settings.aspectRatio, settings.exportResolution);
  const timeline = buildTimeline(puzzles, settings);
  const totalDuration = timeline.length > 0 ? timeline[timeline.length - 1].end : 0;
  if (totalDuration <= 0) throw new Error('Video duration is zero. Increase show/reveal timings and try again.');

  const totalFrames = Math.max(1, Math.ceil(totalDuration * FPS));
  const bitrate = Math.max(500_000, Math.round(settings.exportBitrateMbps * 1_000_000));
  const codecConfig = FORMAT_BY_CODEC[settings.exportCodec];
  const audioMixSample = buildExportAudioMixSample(timeline, settings, audioAssets, totalDuration, puzzles);
  const telemetry = createTelemetryState();
  const loadAssetsTaskId = getScopedTaskId('video-export-load-assets');
  const encodeTaskId = getScopedTaskId('video-export-encode');
  const renderTaskId = getScopedTaskId('video-export-render');

  const canEncode = await canEncodeVideo(codecConfig.codec, { width, height, bitrate });
  if (!canEncode) {
    throw new Error(
      `Your browser could not encode ${settings.exportCodec.toUpperCase()} at ${settings.exportResolution}. Try a lower resolution/bitrate or switch codec.`
    );
  }
  throwIfCanceled();

  emitTaskEvent({
    taskId: loadAssetsTaskId,
    label: 'Load export assets',
    stage: 'load',
    state: 'running'
  });
  onProgress?.(0, 'Loading puzzle images...');

  const puzzleAssetCache = createPuzzleAssetCache(source, puzzles, telemetry);
  const loadedImages = puzzleAssetCache.loadedImages;
  let rawLogo: ImageBitmap | null = null;
  let brandLogo: ImageBitmap | null = null;
  let introVideoResource: IntroVideoResource | null = null;
  let activePuzzleIndex = -1;

  try {
    if (puzzles.length > 0) {
      await puzzleAssetCache.ensureWindow(0);
    }
    if (settings.logo) {
      rawLogo = await loadLogoImage(settings.logo);
      brandLogo = await processLogoBitmap(rawLogo);
      if (brandLogo !== rawLogo) {
        releaseBitmap(rawLogo);
        rawLogo = null;
      }
    }
    if (settings.introVideoEnabled && introVideoFile) {
      introVideoResource = await prepareIntroVideoResource(introVideoFile);
    }
    emitTaskEvent({
      taskId: loadAssetsTaskId,
      label: 'Load export assets',
      stage: 'load',
      state: 'done'
    });
    emitStats(telemetry, {
      queueSize: Math.max(0, totalFrames),
      runningTasks: 0,
      remainingFrames: totalFrames,
      force: true
    });
    throwIfCanceled();

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Unable to initialize canvas renderer for export.');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const target = streamOutput
      ? new StreamTarget(
          new WritableStream({
            write: async (chunk: { type: 'write'; data: Uint8Array; position: number }) => {
              const payload =
                chunk.data.byteOffset === 0 && chunk.data.byteLength === chunk.data.buffer.byteLength
                  ? chunk.data
                  : chunk.data.slice();
              postMessageToMain(
                {
                  type: 'stream-chunk',
                  position: chunk.position,
                  data: payload.buffer
                },
                [payload.buffer]
              );
            }
          }),
          {
            chunked: true,
            chunkSize: 16 * 1024 * 1024
          }
        )
      : new BufferTarget();
    const output = new Output({
      format: codecConfig.format,
      target
    });
    const videoSource = new CanvasSource(canvas, {
      codec: codecConfig.codec,
      bitrate,
      bitrateMode: 'constant',
      latencyMode: 'quality',
      contentHint: 'detail'
    });
    output.addVideoTrack(videoSource, { frameRate: FPS });
    const audioSource =
      audioMixSample
        ? new AudioSampleSource({
            codec: codecConfig.audioCodec,
            bitrate: AUDIO_BITRATE
          })
        : null;
    if (audioSource) {
      output.addAudioTrack(audioSource);
    }

    emitTaskEvent({
      taskId: encodeTaskId,
      label: 'Encode video output',
      stage: 'encode',
      state: 'running'
    });
    emitTaskEvent({
      taskId: renderTaskId,
      label: 'Render export frames',
      stage: 'render',
      state: 'running'
    });

    onProgress?.(0.1, 'Starting encoder...');
    await output.start();
    throwIfCanceled();

    if (audioSource && audioMixSample) {
      onProgress?.(0.12, 'Synthesizing audio mix...');
      await audioSource.add(audioMixSample);
      audioMixSample.close();
      audioSource.close();
    }

    const progressStep = Math.max(1, Math.floor(totalFrames / 150));
    const renderProgressBase = audioSource ? 0.16 : 0.1;
    const renderProgressSpan = audioSource ? 0.79 : 0.85;
    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
      const timestamp = frameIndex / FPS;
      const scene = getSceneAtTime(timestamp, timeline, puzzles, settings);
      const sceneNeedsImages = scene.segment.phase !== 'intro' && scene.segment.phase !== 'outro';

      if (sceneNeedsImages && scene.segment.puzzleIndex !== activePuzzleIndex) {
        activePuzzleIndex = scene.segment.puzzleIndex;
        await puzzleAssetCache.ensureWindow(activePuzzleIndex);
      }

      const renderStart = performance.now();
      let drewIntro = false;
      if (scene.segment.phase === 'intro' && introVideoResource) {
        drewIntro = await drawIntroVideoFrame(
          ctx as unknown as CanvasRenderingContext2D,
          introVideoResource,
          scene.phaseElapsed,
          width,
          height
        );
      }
      if (!drewIntro) {
        drawFrame(
          ctx as unknown as CanvasRenderingContext2D,
          width,
          height,
          puzzles,
          loadedImages,
          brandLogo,
          settings,
          generatedBackgroundPack,
          scene,
          timestamp
        );
      }
      telemetry.totalRenderMs += Math.max(0, performance.now() - renderStart);
      const encodeStart = performance.now();
      await videoSource.add(timestamp, 1 / FPS);
      telemetry.totalEncodeMs += Math.max(0, performance.now() - encodeStart);
      telemetry.renderedFrames += 1;
      throwIfCanceled();

      if (frameIndex % progressStep === 0 || frameIndex === totalFrames - 1) {
        const exportProgress = renderProgressBase + ((frameIndex + 1) / totalFrames) * renderProgressSpan;
        onProgress?.(exportProgress, `Encoding frame ${frameIndex + 1}/${totalFrames}`);
      }

      emitStats(telemetry, {
        queueSize: Math.max(0, totalFrames - frameIndex - 1),
        runningTasks: 1,
        remainingFrames: Math.max(0, totalFrames - frameIndex - 1)
      });
    }

    emitTaskEvent({
      taskId: renderTaskId,
      label: 'Render export frames',
      stage: 'render',
      state: 'done'
    });

    onProgress?.(0.96, 'Finalizing file...');
    await output.finalize();
    throwIfCanceled();
    emitTaskEvent({
      taskId: encodeTaskId,
      label: 'Encode video output',
      stage: 'encode',
      state: 'done'
    });
    emitStats(telemetry, {
      queueSize: 0,
      runningTasks: 0,
      remainingFrames: 0,
      force: true
    });

    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
      now.getDate()
    ).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(
      2,
      '0'
    )}${String(now.getSeconds()).padStart(2, '0')}`;
    const fileName = `spotitnow-${settings.aspectRatio.replace(':', 'x')}-${settings.exportResolution}-${settings.exportCodec}-${stamp}.${codecConfig.extension}`;

    if (streamOutput) {
      return {
        mode: 'stream',
        fileName,
        mimeType: codecConfig.mimeType
      };
    }

    const buffer = (target as BufferTarget).buffer;
    if (!buffer) throw new Error('Failed to build exported video buffer.');
    return {
      mode: 'buffer',
      buffer,
      fileName,
      mimeType: codecConfig.mimeType
    };
  } finally {
    puzzleAssetCache.releaseAll();
    releaseBitmap(brandLogo);
    releaseBitmap(rawLogo);
  }
};

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;
  const previewRequestId = message.type === 'preview-frame' ? message.requestId : undefined;

  if (message.type === 'cancel') {
    isCanceled = true;
    return;
  }

  if (message.type !== 'start' && message.type !== 'preview-frame') return;

  isCanceled = false;

  try {
    if (message.type === 'preview-frame') {
      const result = await renderPreviewFrameInWorker(message.payload);
      postMessageToMain(
        {
          type: 'preview-frame-done',
          buffer: result.buffer,
          mimeType: result.mimeType,
          requestId: previewRequestId
        },
        [result.buffer]
      );
    } else {
      currentWorkerSessionId = message.payload.workerSessionId || 'primary';
      const result = await exportVideoInWorker(
        message.payload.source === 'binary'
          ? {
              source: 'binary',
              puzzles: message.payload.puzzles,
              settings: message.payload.settings,
              generatedBackgroundPack: message.payload.generatedBackgroundPack,
              audioAssets: message.payload.audioAssets,
              introVideoFile: message.payload.introVideoFile,
              streamOutput: message.payload.streamOutput,
              onProgress: (progress, status) => {
                postMessageToMain({ type: 'progress', progress, status });
              }
            }
          : {
              source: 'legacy',
              puzzles: message.payload.puzzles,
              settings: message.payload.settings,
              generatedBackgroundPack: message.payload.generatedBackgroundPack,
              audioAssets: message.payload.audioAssets,
              introVideoFile: message.payload.introVideoFile,
              streamOutput: message.payload.streamOutput,
              onProgress: (progress, status) => {
                postMessageToMain({ type: 'progress', progress, status });
              }
            }
      );

      if (result.mode === 'stream') {
        postMessageToMain({
          type: 'stream-done',
          fileName: result.fileName,
          mimeType: result.mimeType
        });
      } else {
        postMessageToMain(
          {
            type: 'done',
            buffer: result.buffer,
            fileName: result.fileName,
            mimeType: result.mimeType
          },
          [result.buffer]
        );
      }
    }
  } catch (error) {
    const fallbackMessage =
      message.type === 'preview-frame' ? 'Preview frame render failed.' : 'Video export failed.';
    const messageText = error instanceof Error ? error.message : fallbackMessage;
    if (messageText === '__EXPORT_CANCELED__') {
      postMessageToMain({ type: 'cancelled', requestId: previewRequestId });
    } else {
      postMessageToMain({ type: 'error', message: messageText, requestId: previewRequestId });
    }
  } finally {
    isCanceled = false;
    currentWorkerSessionId = 'primary';
  }
};

