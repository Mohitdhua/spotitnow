import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  Image,
  Layers,
  Lock,
  Minus,
  Music2,
  Plus,
  Sparkles,
  Type,
  Video,
  VolumeX
} from 'lucide-react';
import type { EditorTimelineClip, EditorTimelineClipChange, EditorTimelineState, EditorTimelineTrack } from './types';
import { useTimelineViewport } from './useTimelineViewport';
import {
  TIMELINE_HEADER_WIDTH,
  TIMELINE_RULER_HEIGHT,
  applyTimelineClipChange,
  buildSnapTimes,
  canTrackAcceptClip,
  clamp,
  findClosestSnapTime,
  formatTimelineTime,
  getDetailLevel,
  getRulerStep,
  getTrackRenderHeight,
  getVisibleClips,
  pixelsToTime,
  resolveClipMove,
  resolveClipTrim,
  timeToPixels
} from './utils';

type ClipInteractionMode = 'move' | 'trim-start' | 'trim-end';

interface DragInteractionState {
  pointerId: number;
  mode: ClipInteractionMode;
  clipId: string;
  clipType: EditorTimelineClip['type'];
  fromTrackId: string;
  startTrackId: string;
  startTime: number;
  startDuration: number;
  startClientX: number;
  startScrollLeft: number;
  snapTimes: number[];
  liveChange: EditorTimelineClipChange;
  guideTime: number | null;
}

interface ScrubInteractionState {
  pointerId: number;
}

interface EditorTimelineProps {
  timeline: EditorTimelineState;
  playheadTime: number;
  selectedClipId?: string | null;
  selectedTrackId?: string | null;
  className?: string;
  emptyState?: React.ReactNode;
  onPlayheadChange: (time: number) => void;
  onClipChange?: (change: EditorTimelineClipChange) => void;
  onSelectClip?: (clip: EditorTimelineClip, track: EditorTimelineTrack) => void;
  onSelectTrack?: (track: EditorTimelineTrack) => void;
}

const TRACK_KIND_ICONS = {
  video: Video,
  audio: Music2,
  text: Type,
  effects: Sparkles,
  overlay: Layers
} as const;

const CLIP_KIND_ICONS = {
  video: Video,
  audio: Music2,
  text: Type,
  effect: Sparkles,
  overlay: Image
} as const;

const TRACK_TONES = {
  video: 'from-[#16213d] via-[#1a2f5c] to-[#0f1730]',
  audio: 'from-[#14203a] via-[#173457] to-[#10233d]',
  text: 'from-[#2d1b11] via-[#402216] to-[#24140d]',
  effects: 'from-[#251738] via-[#321a4d] to-[#180f28]',
  overlay: 'from-[#102731] via-[#143847] to-[#0e1f28]'
} as const;

const CLIP_TONES = {
  video: 'rgba(59, 130, 246, 0.92)',
  audio: 'rgba(20, 184, 166, 0.92)',
  text: 'rgba(245, 158, 11, 0.94)',
  effect: 'rgba(168, 85, 247, 0.94)',
  overlay: 'rgba(236, 72, 153, 0.92)'
} as const;

const SNAP_THRESHOLD_PX = 10;

const getClipBodyMetrics = (clip: EditorTimelineClip, trackHeight: number) => {
  if (clip.type === 'effect') {
    const height = Math.max(18, Math.min(28, trackHeight - 16));
    const top = Math.round((trackHeight - height) / 2);
    return { top, height };
  }

  if (clip.type === 'audio') {
    return { top: 10, height: Math.max(34, trackHeight - 20) };
  }

  if (clip.type === 'text') {
    return { top: 9, height: Math.max(30, trackHeight - 18) };
  }

  return { top: 7, height: Math.max(38, trackHeight - 14) };
};

const compareTracks = (left: EditorTimelineTrack, right: EditorTimelineTrack) => left.order - right.order;

const WaveformPreview = React.memo(function WaveformPreview({ waveform }: { waveform: number[] }) {
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full opacity-80">
      {waveform.map((point, index) => {
        const x = waveform.length <= 1 ? 50 : (index / (waveform.length - 1)) * 100;
        const height = clamp(point * 84, 12, 84);
        const y = (100 - height) / 2;
        return (
          <line
            key={index}
            x1={x}
            y1={y}
            x2={x}
            y2={100 - y}
            stroke="rgba(255,255,255,0.82)"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        );
      })}
    </svg>
  );
});

const ThumbnailStrip = React.memo(function ThumbnailStrip({
  clip,
  frameCount
}: {
  clip: EditorTimelineClip;
  frameCount: number;
}) {
  return (
    <div className="absolute inset-x-1 bottom-1 flex h-6 gap-1 overflow-hidden rounded-lg">
      {Array.from({ length: frameCount }, (_, index) => (
        <div
          key={`${clip.id}-thumb-${index}`}
          className="relative min-w-0 flex-1 overflow-hidden rounded-md border border-white/10"
          style={{
            background:
              clip.previewUrl
                ? `linear-gradient(135deg, rgba(15,23,42,0.28), rgba(15,23,42,0.06)), url(${clip.previewUrl}) center/cover`
                : 'linear-gradient(135deg, rgba(255,255,255,0.18), rgba(255,255,255,0.04))'
          }}
        >
          <div
            className="absolute inset-0 opacity-70"
            style={{
              backgroundImage: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.22), transparent)',
              backgroundSize: '120% 100%',
              transform: `translateX(${index * 6}%)`
            }}
          />
        </div>
      ))}
    </div>
  );
});

const TimelineClipBlock = React.memo(function TimelineClipBlock({
  clip,
  selected,
  detailLevel,
  left,
  width,
  trackHeight,
  isEditable,
  onMovePointerDown,
  onTrimStartPointerDown,
  onTrimEndPointerDown,
  onSelect
}: {
  clip: EditorTimelineClip;
  selected: boolean;
  detailLevel: ReturnType<typeof getDetailLevel>;
  left: number;
  width: number;
  trackHeight: number;
  isEditable: boolean;
  onMovePointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onTrimStartPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onTrimEndPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onSelect: () => void;
}) {
  const Icon = CLIP_KIND_ICONS[clip.type];
  const { top, height } = getClipBodyMetrics(clip, trackHeight);
  const detailAllowed = width > 54;
  const showCompact = detailLevel !== 'minimal' && detailAllowed;
  const showDetailed = detailLevel === 'detailed' && width > 150;
  const showTrimHandles = isEditable && selected && width > 56;
  const thumbnailFrames = Math.min(7, Math.max(3, Math.floor(width / 66)));

  return (
    <button
      type="button"
      title={`${clip.label} • ${formatTimelineTime(clip.start)} to ${formatTimelineTime(clip.start + clip.duration)}`}
      className={`group absolute overflow-hidden rounded-xl border text-left transition-[transform,box-shadow,border-color] ${
        selected
          ? 'border-white shadow-[0_0_0_2px_rgba(251,191,36,0.9),0_16px_28px_rgba(15,23,42,0.55)]'
          : 'border-white/12 shadow-[0_12px_22px_rgba(15,23,42,0.32)] hover:border-white/35 hover:shadow-[0_16px_28px_rgba(15,23,42,0.4)]'
      }`}
      style={{
        left,
        width: Math.max(18, width),
        top,
        height,
        background: `linear-gradient(180deg, rgba(255,255,255,0.15), rgba(255,255,255,0.04)), ${clip.color || CLIP_TONES[clip.type]}`
      }}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      onPointerDown={(event) => {
        if (!isEditable) return;
        onMovePointerDown(event);
      }}
    >
      <div className="absolute inset-0 opacity-70">
        {(clip.type === 'video' || clip.type === 'overlay') && showDetailed && (
          <ThumbnailStrip clip={clip} frameCount={thumbnailFrames} />
        )}
        {clip.type === 'audio' && clip.waveform && <WaveformPreview waveform={clip.waveform} />}
        {clip.previewUrl && showDetailed && (
          <div
            className="absolute inset-0 opacity-20"
            style={{
              backgroundImage: `url(${clip.previewUrl})`,
              backgroundPosition: 'center',
              backgroundSize: 'cover'
            }}
          />
        )}
      </div>

      <div className="relative flex h-full min-w-0 flex-col justify-between px-3 py-2">
        {showCompact ? (
          <>
            <div className="flex min-w-0 items-center gap-2">
              <span className="rounded-lg bg-black/20 p-1 text-white shadow-[0_1px_0_rgba(255,255,255,0.18)]">
                <Icon size={12} strokeWidth={2.5} />
              </span>
              <span className="truncate text-[11px] font-black uppercase tracking-[0.16em] text-white/90">{clip.label}</span>
            </div>
            {showDetailed ? (
              <div className="flex min-w-0 items-end justify-between gap-2 text-[10px] font-semibold text-white/90">
                <div className="min-w-0">
                  <div className="truncate text-white/85">{clip.subtitle ?? `${formatTimelineTime(clip.duration)} duration`}</div>
                  <div className="truncate text-white/70">
                    {formatTimelineTime(clip.start)} - {formatTimelineTime(clip.start + clip.duration)}
                  </div>
                </div>
                {clip.effects?.length ? (
                  <div className="hidden items-center gap-1 xl:flex">
                    {clip.effects.slice(0, 2).map((effect) => (
                      <span
                        key={effect.id}
                        className="rounded-full border border-white/25 bg-black/20 px-2 py-1 text-[9px] font-black uppercase tracking-[0.15em]"
                        style={{
                          backgroundColor: effect.tone ? `${effect.tone}44` : undefined
                        }}
                      >
                        {effect.label}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="truncate text-[10px] font-bold text-white/80">{clip.subtitle ?? formatTimelineTime(clip.duration)}</div>
            )}
          </>
        ) : (
          <div className="flex h-full items-center justify-center">
            <Icon size={14} strokeWidth={2.5} className="text-white/92" />
          </div>
        )}
      </div>

      {showTrimHandles && (
        <>
          <div
            className="absolute left-0 top-0 h-full w-2.5 cursor-col-resize rounded-l-xl border-r border-white/35 bg-black/18 opacity-0 transition group-hover:opacity-100"
            onPointerDown={(event) => {
              event.stopPropagation();
              onTrimStartPointerDown(event);
            }}
          />
          <div
            className="absolute right-0 top-0 h-full w-2.5 cursor-col-resize rounded-r-xl border-l border-white/35 bg-black/18 opacity-0 transition group-hover:opacity-100"
            onPointerDown={(event) => {
              event.stopPropagation();
              onTrimEndPointerDown(event);
            }}
          />
        </>
      )}
    </button>
  );
});

export function EditorTimeline({
  timeline,
  playheadTime,
  selectedClipId = null,
  selectedTrackId = null,
  className,
  emptyState,
  onPlayheadChange,
  onClipChange,
  onSelectClip,
  onSelectTrack
}: EditorTimelineProps) {
  const { scrollRef, zoom, visibleRange, zoomAtClientX, timeAreaWidth } = useTimelineViewport({
    duration: timeline.duration,
    initialPixelsPerSecond: 74,
    minPixelsPerSecond: 20,
    maxPixelsPerSecond: 280
  });
  const laneRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [collapsedTrackIds, setCollapsedTrackIds] = useState<string[]>(() =>
    timeline.tracks.filter((track) => track.collapsed).map((track) => track.id)
  );
  const [dragState, setDragState] = useState<DragInteractionState | null>(null);
  const [scrubState, setScrubState] = useState<ScrubInteractionState | null>(null);

  useEffect(() => {
    setCollapsedTrackIds((current) => {
      const availableTrackIds = new Set(timeline.tracks.map((track) => track.id));
      const next = current.filter((trackId) => availableTrackIds.has(trackId));
      timeline.tracks.forEach((track) => {
        if (track.collapsed && !next.includes(track.id)) {
          next.push(track.id);
        }
      });
      return next;
    });
  }, [timeline.tracks]);

  const orderedTracks = useMemo(() => [...timeline.tracks].sort(compareTracks), [timeline.tracks]);
  const detailLevel = getDetailLevel(zoom.pixelsPerSecond);
  const rulerStep = getRulerStep(zoom.pixelsPerSecond);

  const effectiveTimeline = useMemo(() => {
    // Keep drag interactions local to the timeline so the full editor does not rerender on every pointer move.
    if (!dragState?.liveChange) return timeline;
    return applyTimelineClipChange(timeline, dragState.liveChange);
  }, [dragState?.liveChange, timeline]);

  const trackRows = useMemo(() => {
    return orderedTracks.map((track) => {
      const collapsed = collapsedTrackIds.includes(track.id);
      const isSelected =
        selectedTrackId === track.id || track.clips.some((clip) => clip.id === selectedClipId);

      return {
        track,
        collapsed,
        isSelected,
        height: getTrackRenderHeight(track, { isCollapsed: collapsed, isSelected })
      };
    });
  }, [collapsedTrackIds, orderedTracks, selectedClipId, selectedTrackId]);

  const visibleTicks = useMemo(() => {
    const firstTick = Math.max(0, Math.floor(visibleRange.start / rulerStep) * rulerStep);
    const ticks: number[] = [];
    for (let tick = firstTick; tick <= visibleRange.end + rulerStep; tick += rulerStep) {
      ticks.push(Number(tick.toFixed(4)));
    }
    return ticks;
  }, [rulerStep, visibleRange.end, visibleRange.start]);

  const visibleMarkers = useMemo(
    () => timeline.markers.filter((marker) => marker.time >= visibleRange.start - 1 && marker.time <= visibleRange.end + 1),
    [timeline.markers, visibleRange.end, visibleRange.start]
  );

  const dragGuideLeft = dragState?.guideTime != null ? timeToPixels(dragState.guideTime, zoom.pixelsPerSecond) : null;
  const playheadLeft = timeToPixels(clamp(playheadTime, 0, timeline.duration), zoom.pixelsPerSecond);

  const toggleTrackCollapse = (trackId: string) => {
    setCollapsedTrackIds((current) =>
      current.includes(trackId) ? current.filter((entry) => entry !== trackId) : [...current, trackId]
    );
  };

  const getTimeFromClientX = (clientX: number) => {
    const scrollNode = scrollRef.current;
    if (!scrollNode) return 0;
    const rect = scrollNode.getBoundingClientRect();
    const timelinePixels = clamp(
      scrollNode.scrollLeft + clientX - rect.left - TIMELINE_HEADER_WIDTH,
      0,
      timeAreaWidth
    );
    return clamp(pixelsToTime(timelinePixels, zoom.pixelsPerSecond), 0, timeline.duration);
  };

  const maybeAutoScroll = (clientX: number, clientY: number) => {
    const scrollNode = scrollRef.current;
    if (!scrollNode) return;
    const rect = scrollNode.getBoundingClientRect();
    const edgeThreshold = 44;

    if (clientX > rect.right - edgeThreshold) {
      const intensity = (clientX - (rect.right - edgeThreshold)) / edgeThreshold;
      scrollNode.scrollLeft += 10 + intensity * 18;
    } else if (clientX < rect.left + edgeThreshold) {
      const intensity = ((rect.left + edgeThreshold) - clientX) / edgeThreshold;
      scrollNode.scrollLeft -= 10 + intensity * 18;
    }

    if (clientY > rect.bottom - edgeThreshold) {
      const intensity = (clientY - (rect.bottom - edgeThreshold)) / edgeThreshold;
      scrollNode.scrollTop += 8 + intensity * 16;
    } else if (clientY < rect.top + edgeThreshold) {
      const intensity = ((rect.top + edgeThreshold) - clientY) / edgeThreshold;
      scrollNode.scrollTop -= 8 + intensity * 16;
    }
  };

  const findTrackForPointer = (clientY: number, fallbackTrackId: string, clipType: EditorTimelineClip['type']) => {
    const hoveredTrack = orderedTracks.find((track) => {
      const lane = laneRefs.current[track.id];
      if (!lane) return false;
      const rect = lane.getBoundingClientRect();
      return clientY >= rect.top && clientY <= rect.bottom;
    });

    if (!hoveredTrack) {
      return fallbackTrackId;
    }

    return canTrackAcceptClip(hoveredTrack, clipType) ? hoveredTrack.id : fallbackTrackId;
  };

  const beginClipInteraction = (
    event: React.PointerEvent<HTMLElement>,
    track: EditorTimelineTrack,
    clip: EditorTimelineClip,
    mode: ClipInteractionMode
  ) => {
    if (event.button !== 0 || !onClipChange || clip.editable === false || track.locked) {
      return;
    }

    const scrollNode = scrollRef.current;
    if (!scrollNode) return;

    event.preventDefault();
    event.stopPropagation();

    const snapTimes = buildSnapTimes({
      state: timeline,
      activeClipId: clip.id,
      activeTrackId: track.id,
      includeGridStep: rulerStep,
      playheadTime
    });

    setDragState({
      pointerId: event.pointerId,
      mode,
      clipId: clip.id,
      clipType: clip.type,
      fromTrackId: track.id,
      startTrackId: track.id,
      startTime: clip.start,
      startDuration: clip.duration,
      startClientX: event.clientX,
      startScrollLeft: scrollNode.scrollLeft,
      snapTimes,
      guideTime: null,
      liveChange: {
        clipId: clip.id,
        fromTrackId: track.id,
        toTrackId: track.id,
        start: clip.start,
        duration: clip.duration,
        action: mode === 'move' ? 'move' : mode
      }
    });
  };

  useEffect(() => {
    if (!dragState || !onClipChange) return;

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== dragState.pointerId) return;

      maybeAutoScroll(event.clientX, event.clientY);

      const scrollNode = scrollRef.current;
      const scrollDelta = scrollNode ? scrollNode.scrollLeft - dragState.startScrollLeft : 0;
      const deltaSeconds = pixelsToTime(event.clientX - dragState.startClientX + scrollDelta, zoom.pixelsPerSecond);
      const snapThresholdSeconds = SNAP_THRESHOLD_PX / Math.max(1, zoom.pixelsPerSecond);
      let nextTrackId = dragState.startTrackId;
      let guideTime: number | null = null;

      if (dragState.mode === 'move') {
        nextTrackId = findTrackForPointer(event.clientY, dragState.startTrackId, dragState.clipType);
        let candidateStart = dragState.startTime + deltaSeconds;

        const snapStart = findClosestSnapTime({
          candidate: candidateStart,
          snapTimes: dragState.snapTimes,
          thresholdSeconds: snapThresholdSeconds
        });
        const snapEnd = findClosestSnapTime({
          candidate: candidateStart + dragState.startDuration,
          snapTimes: dragState.snapTimes,
          thresholdSeconds: snapThresholdSeconds
        });

        if (snapStart != null || snapEnd != null) {
          const startDistance = snapStart == null ? Number.POSITIVE_INFINITY : Math.abs(snapStart - candidateStart);
          const endDistance =
            snapEnd == null ? Number.POSITIVE_INFINITY : Math.abs(snapEnd - (candidateStart + dragState.startDuration));
          if (startDistance <= endDistance && snapStart != null) {
            candidateStart = snapStart;
            guideTime = snapStart;
          } else if (snapEnd != null) {
            candidateStart = snapEnd - dragState.startDuration;
            guideTime = snapEnd;
          }
        }

        const safeStart = resolveClipMove({
          state: timeline,
          trackId: nextTrackId,
          clipId: dragState.clipId,
          proposedStart: candidateStart,
          duration: dragState.startDuration
        });

        setDragState((current) =>
          current
            ? {
                ...current,
                guideTime,
                liveChange: {
                  ...current.liveChange,
                  toTrackId: nextTrackId,
                  start: safeStart,
                  duration: dragState.startDuration,
                  action: nextTrackId === current.fromTrackId ? 'move' : 'move-track'
                }
              }
            : current
        );
        return;
      }

      if (dragState.mode === 'trim-start') {
        let candidateStart = dragState.startTime + deltaSeconds;
        const snappedStart = findClosestSnapTime({
          candidate: candidateStart,
          snapTimes: dragState.snapTimes,
          thresholdSeconds: snapThresholdSeconds
        });
        if (snappedStart != null) {
          candidateStart = snappedStart;
          guideTime = snappedStart;
        }
        const nextTiming = resolveClipTrim({
          state: timeline,
          trackId: dragState.startTrackId,
          clipId: dragState.clipId,
          proposedStart: candidateStart,
          proposedDuration: dragState.startDuration - (candidateStart - dragState.startTime)
        });

        setDragState((current) =>
          current
            ? {
                ...current,
                guideTime,
                liveChange: {
                  ...current.liveChange,
                  start: nextTiming.start,
                  duration: nextTiming.duration,
                  action: 'trim-start'
                }
              }
            : current
        );
        return;
      }

      let candidateEnd = dragState.startTime + dragState.startDuration + deltaSeconds;
      const snappedEnd = findClosestSnapTime({
        candidate: candidateEnd,
        snapTimes: dragState.snapTimes,
        thresholdSeconds: snapThresholdSeconds
      });
      if (snappedEnd != null) {
        candidateEnd = snappedEnd;
        guideTime = snappedEnd;
      }

      const nextTiming = resolveClipTrim({
        state: timeline,
        trackId: dragState.startTrackId,
        clipId: dragState.clipId,
        proposedStart: dragState.startTime,
        proposedDuration: candidateEnd - dragState.startTime
      });

      setDragState((current) =>
        current
          ? {
              ...current,
              guideTime,
              liveChange: {
                ...current.liveChange,
                start: nextTiming.start,
                duration: nextTiming.duration,
                action: 'trim-end'
              }
            }
          : current
      );
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerId !== dragState.pointerId) return;
      const nextChange = dragState.liveChange;
      const didChange =
        nextChange.toTrackId !== dragState.fromTrackId ||
        Math.abs(nextChange.start - dragState.startTime) > 0.001 ||
        Math.abs(nextChange.duration - dragState.startDuration) > 0.001;

      setDragState(null);
      if (didChange) {
        onClipChange(nextChange);
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [dragState, onClipChange, playheadTime, rulerStep, timeline, zoom.pixelsPerSecond, orderedTracks]);

  useEffect(() => {
    if (!scrubState) return;

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== scrubState.pointerId) return;
      maybeAutoScroll(event.clientX, event.clientY);
      onPlayheadChange(getTimeFromClientX(event.clientX));
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerId !== scrubState.pointerId) return;
      setScrubState(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [scrubState, onPlayheadChange]);

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!(event.ctrlKey || event.metaKey || event.altKey)) return;
    event.preventDefault();
    const scaleFactor = event.deltaY > 0 ? 0.9 : 1.1;
    zoomAtClientX(event.clientX, zoom.pixelsPerSecond * scaleFactor);
  };

  const totalClipCount = timeline.tracks.reduce((count, track) => count + track.clips.length, 0);

  return (
    <section
      className={`overflow-hidden rounded-[28px] border border-black/80 bg-[#0e1420] text-white shadow-[10px_10px_0px_0px_rgba(0,0,0,0.95)] ${className ?? ''}`}
    >
      <div className="border-b border-white/10 bg-[linear-gradient(135deg,#121a2d,#0b101a)] px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <div className="text-[11px] font-black uppercase tracking-[0.28em] text-[#7aa2ff]">Editor Timeline</div>
            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-white/72">
              <span>{orderedTracks.length} tracks</span>
              <span className="h-1 w-1 rounded-full bg-white/25" />
              <span>{totalClipCount} clips</span>
              <span className="h-1 w-1 rounded-full bg-white/25" />
              <span>{formatTimelineTime(timeline.duration)} total range</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-white/12 bg-white/5 px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-white/72">
              {detailLevel === 'minimal' ? 'overview' : detailLevel === 'compact' ? 'editor' : 'precision'}
            </span>
            <div className="flex items-center gap-1 rounded-full border border-white/12 bg-white/5 p-1">
              <button
                type="button"
                className="rounded-full border border-white/12 bg-white/8 p-2 text-white/85 transition hover:bg-white/15"
                onClick={() => zoomAtClientX(TIMELINE_HEADER_WIDTH + visibleRange.viewportWidth / 2, zoom.pixelsPerSecond * 0.88)}
              >
                <Minus size={14} strokeWidth={2.5} />
              </button>
              <div className="min-w-[88px] text-center text-[11px] font-black uppercase tracking-[0.18em] text-white/78">
                {zoom.pixelsPerSecond.toFixed(0)} px/s
              </div>
              <button
                type="button"
                className="rounded-full border border-white/12 bg-white/8 p-2 text-white/85 transition hover:bg-white/15"
                onClick={() => zoomAtClientX(TIMELINE_HEADER_WIDTH + visibleRange.viewportWidth / 2, zoom.pixelsPerSecond * 1.12)}
              >
                <Plus size={14} strokeWidth={2.5} />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="max-h-[540px] overflow-auto bg-[radial-gradient(circle_at_top,rgba(37,99,235,0.08),transparent_35%),linear-gradient(180deg,#0b1019,#0e1420)]"
        onWheel={handleWheel}
      >
        <div style={{ width: TIMELINE_HEADER_WIDTH + timeAreaWidth, minWidth: '100%' }}>
          <div className="sticky top-0 z-40 flex border-b border-white/10 bg-[rgba(7,10,17,0.96)] backdrop-blur">
            <div
              className="sticky left-0 z-50 flex h-[46px] shrink-0 items-center justify-between border-r border-white/10 bg-[rgba(9,13,22,0.98)] px-4"
              style={{ width: TIMELINE_HEADER_WIDTH, height: TIMELINE_RULER_HEIGHT }}
            >
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.24em] text-white/50">Tracks</div>
                <div className="text-sm font-black uppercase tracking-[0.12em] text-white">Studio Stack</div>
              </div>
              <GripVertical size={16} strokeWidth={2.4} className="text-white/28" />
            </div>
            <div
              className="relative shrink-0 border-l border-white/5"
              style={{ width: timeAreaWidth, height: TIMELINE_RULER_HEIGHT }}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                onPlayheadChange(getTimeFromClientX(event.clientX));
                setScrubState({ pointerId: event.pointerId });
              }}
            >
              {visibleTicks.map((tick) => {
                const left = timeToPixels(tick, zoom.pixelsPerSecond);
                const isMajor = Math.round((tick / rulerStep) * 10) % 5 === 0;
                return (
                  <div key={`tick-${tick}`} className="absolute inset-y-0" style={{ left }}>
                    <div className={`h-full w-px ${isMajor ? 'bg-white/16' : 'bg-white/8'}`} />
                    <div className="absolute left-2 top-1 text-[10px] font-bold text-white/56">{formatTimelineTime(tick)}</div>
                  </div>
                );
              })}
              {visibleMarkers.map((marker) => {
                const left = timeToPixels(marker.time, zoom.pixelsPerSecond);
                return (
                  <div key={marker.id} className="absolute inset-y-0" style={{ left }}>
                    <div className="absolute top-0 h-full w-px bg-white/20" />
                    <div
                      className="absolute left-2 top-5 rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-[0.18em] text-black"
                      style={{
                        backgroundColor: marker.color ?? '#FDE68A',
                        borderColor: 'rgba(15, 23, 42, 0.95)'
                      }}
                    >
                      {marker.label}
                    </div>
                  </div>
                );
              })}
              {dragGuideLeft != null && (
                <div
                  className="pointer-events-none absolute inset-y-0 z-20 w-px bg-cyan-300 shadow-[0_0_0_1px_rgba(103,232,249,0.32)]"
                  style={{ left: dragGuideLeft }}
                />
              )}
              <div className="pointer-events-none absolute inset-y-0 z-30" style={{ left: playheadLeft }}>
                <div className="absolute top-0 h-full w-px bg-[#facc15] shadow-[0_0_0_1px_rgba(250,204,21,0.5)]" />
                <div className="absolute left-[-28px] top-1 rounded-full border border-black bg-[#facc15] px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-black">
                  {formatTimelineTime(playheadTime)}
                </div>
              </div>
            </div>
          </div>

          {trackRows.length === 0 ? (
            <div className="flex min-h-[280px] items-center justify-center p-6">
              {emptyState ?? (
                <div className="max-w-xl rounded-[24px] border border-dashed border-white/15 bg-white/4 px-6 py-8 text-center">
                  <div className="text-sm font-black uppercase tracking-[0.24em] text-white/50">No Tracks Yet</div>
                  <div className="mt-2 text-2xl font-black uppercase tracking-tight text-white">Load clips to build your timeline</div>
                  <p className="mt-3 text-sm font-semibold text-white/62">
                    Video, audio, overlays, titles, and effects will stack here with trim and snap controls.
                  </p>
                </div>
              )}
            </div>
          ) : (
            trackRows.map(({ track, collapsed, isSelected, height }) => {
              const effectiveTrack = effectiveTimeline.tracks.find((entry) => entry.id === track.id) ?? track;
              const TrackIcon = TRACK_KIND_ICONS[track.kind];
              const visibleClips = getVisibleClips(
                effectiveTrack.clips.filter((clip) => !clip.hidden),
                visibleRange.start,
                visibleRange.end
              );
              const transitions = timeline.transitions.filter(
                (transition) =>
                  transition.trackId === track.id &&
                  transition.at >= visibleRange.start - 1 &&
                  transition.at <= visibleRange.end + 1
              );

              return (
                <div key={track.id} className="flex border-b border-white/8">
                  <div
                    className={`sticky left-0 z-20 flex shrink-0 flex-col justify-center border-r border-white/10 bg-gradient-to-br px-4 ${
                      TRACK_TONES[track.kind]
                    }`}
                    style={{ width: TIMELINE_HEADER_WIDTH, height }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        className="flex min-w-0 items-start gap-3 text-left"
                        onClick={() => {
                          onSelectTrack?.(track);
                          onPlayheadChange(
                            track.clips[0] ? clamp(track.clips[0].start, 0, timeline.duration) : playheadTime
                          );
                        }}
                      >
                        <span className="mt-0.5 rounded-xl border border-white/12 bg-black/18 p-2 text-white/90">
                          <TrackIcon size={14} strokeWidth={2.4} />
                        </span>
                        <span className="min-w-0">
                          <div className="truncate text-xs font-black uppercase tracking-[0.22em] text-white/62">{track.kind}</div>
                          <div className="truncate text-base font-black uppercase tracking-tight text-white">{track.label}</div>
                          <div className="truncate text-[11px] font-semibold text-white/58">
                            {track.clips.length} clip{track.clips.length === 1 ? '' : 's'}
                            {track.emptyLabel ? ` • ${track.emptyLabel}` : ''}
                          </div>
                        </span>
                      </button>
                      <button
                        type="button"
                        className="rounded-xl border border-white/12 bg-black/18 p-2 text-white/78 transition hover:bg-white/10"
                        onClick={() => toggleTrackCollapse(track.id)}
                      >
                        {collapsed ? <ChevronRight size={14} strokeWidth={2.5} /> : <ChevronDown size={14} strokeWidth={2.5} />}
                      </button>
                    </div>

                    {!collapsed && (
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-white/62">
                        {isSelected && <span className="rounded-full border border-[#facc15]/45 bg-[#facc15]/15 px-2 py-1 text-[#fde68a]">selected</span>}
                        {track.locked && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-white/12 bg-black/18 px-2 py-1">
                            <Lock size={10} strokeWidth={2.5} />
                            locked
                          </span>
                        )}
                        {track.muted && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-white/12 bg-black/18 px-2 py-1">
                            <VolumeX size={10} strokeWidth={2.5} />
                            muted
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <div
                    ref={(node) => {
                      laneRefs.current[track.id] = node;
                    }}
                    className={`relative shrink-0 overflow-hidden ${
                      collapsed ? 'bg-[#0b1019]' : 'bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.01))]'
                    }`}
                    style={{ width: timeAreaWidth, height }}
                    onPointerDown={(event) => {
                      if (event.button !== 0 || event.target !== event.currentTarget) return;
                      onSelectTrack?.(track);
                      onPlayheadChange(getTimeFromClientX(event.clientX));
                    }}
                  >
                    {visibleTicks.map((tick) => {
                      const left = timeToPixels(tick, zoom.pixelsPerSecond);
                      return (
                        <div
                          key={`${track.id}-grid-${tick}`}
                          className={`pointer-events-none absolute inset-y-0 w-px ${Math.round((tick / rulerStep) * 10) % 5 === 0 ? 'bg-white/10' : 'bg-white/6'}`}
                          style={{ left }}
                        />
                      );
                    })}

                    {visibleMarkers.map((marker) => (
                      <div
                        key={`${track.id}-marker-${marker.id}`}
                        className="pointer-events-none absolute inset-y-0 w-px bg-white/14"
                        style={{ left: timeToPixels(marker.time, zoom.pixelsPerSecond) }}
                      />
                    ))}

                    {transitions.map((transition) => {
                      const left = timeToPixels(transition.at, zoom.pixelsPerSecond);
                      return (
                        <div key={transition.id} className="pointer-events-none absolute z-20" style={{ left, top: Math.max(10, height / 2 - 12) }}>
                          <div className="h-4 w-4 rotate-45 rounded-[3px] border border-white/28 bg-white/14 shadow-[0_8px_14px_rgba(15,23,42,0.35)]" />
                          {detailLevel !== 'minimal' && (
                            <div className="absolute left-4 top-[-2px] whitespace-nowrap text-[9px] font-black uppercase tracking-[0.14em] text-white/58">
                              {transition.label}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {visibleClips.map((clip) => {
                      const left = timeToPixels(clip.start, zoom.pixelsPerSecond);
                      const width = Math.max(18, timeToPixels(clip.duration, zoom.pixelsPerSecond));

                      return (
                        <TimelineClipBlock
                          key={clip.id}
                          clip={clip}
                          selected={selectedClipId === clip.id}
                          detailLevel={detailLevel}
                          left={left}
                          width={width}
                          trackHeight={height}
                          isEditable={Boolean(onClipChange) && clip.editable !== false && !track.locked}
                          onSelect={() => onSelectClip?.(clip, track)}
                          onMovePointerDown={(event) => beginClipInteraction(event, track, clip, 'move')}
                          onTrimStartPointerDown={(event) => beginClipInteraction(event, track, clip, 'trim-start')}
                          onTrimEndPointerDown={(event) => beginClipInteraction(event, track, clip, 'trim-end')}
                        />
                      );
                    })}

                    {!effectiveTrack.clips.length && !collapsed && (
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] font-black uppercase tracking-[0.2em] text-white/28">
                        {track.emptyLabel ?? 'Empty track'}
                      </div>
                    )}

                    {dragGuideLeft != null && (
                      <div
                        className="pointer-events-none absolute inset-y-0 z-30 w-px bg-cyan-300 shadow-[0_0_0_1px_rgba(103,232,249,0.38)]"
                        style={{ left: dragGuideLeft }}
                      />
                    )}

                    <div className="pointer-events-none absolute inset-y-0 z-40" style={{ left: playheadLeft }}>
                      <div className="h-full w-px bg-[#facc15] shadow-[0_0_0_1px_rgba(250,204,21,0.42)]" />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}
