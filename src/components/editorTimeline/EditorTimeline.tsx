import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
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

const TRACK_ACCENTS = {
  video: '#5B8DEF',
  audio: '#4CB782',
  text: '#D7A44C',
  effects: '#9B7AE0',
  overlay: '#5FA6C7'
} as const;

const CLIP_TONES = {
  video: 'rgba(77, 120, 201, 0.92)',
  audio: 'rgba(67, 152, 113, 0.92)',
  text: 'rgba(184, 136, 69, 0.94)',
  effect: 'rgba(128, 103, 184, 0.94)',
  overlay: 'rgba(84, 138, 158, 0.92)'
} as const;

const SNAP_THRESHOLD_PX = 10;

const getClipBodyMetrics = (clip: EditorTimelineClip, trackHeight: number) => {
  if (clip.type === 'effect') {
    const height = Math.max(14, Math.min(20, trackHeight - 14));
    const top = Math.round((trackHeight - height) / 2);
    return { top, height };
  }

  if (clip.type === 'audio') {
    return { top: 6, height: Math.max(24, trackHeight - 12) };
  }

  if (clip.type === 'text') {
    return { top: 6, height: Math.max(22, trackHeight - 12) };
  }

  return { top: 5, height: Math.max(28, trackHeight - 10) };
};

const compareTracks = (left: EditorTimelineTrack, right: EditorTimelineTrack) => left.order - right.order;

const WaveformPreview = React.memo(function WaveformPreview({ waveform }: { waveform: number[] }) {
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full opacity-65">
      {waveform.map((point, index) => {
        const x = waveform.length <= 1 ? 50 : (index / (waveform.length - 1)) * 100;
        const height = clamp(point * 80, 10, 80);
        const y = (100 - height) / 2;
        return (
          <line
            key={index}
            x1={x}
            y1={y}
            x2={x}
            y2={100 - y}
            stroke="rgba(255,255,255,0.58)"
            strokeWidth="1.25"
            strokeLinecap="round"
          />
        );
      })}
    </svg>
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
  const detailAllowed = width > 64;
  const showCompact = detailLevel !== 'minimal' && detailAllowed;
  const showDetailed = detailLevel === 'detailed' && width > 180;
  const showTrimHandles = isEditable && selected && width > 64;
  const clipTone = clip.color || CLIP_TONES[clip.type];

  return (
    <button
      type="button"
      title={`${clip.label} • ${formatTimelineTime(clip.start)} to ${formatTimelineTime(clip.start + clip.duration)}`}
      className={`group absolute overflow-hidden rounded-md border text-left transition-[border-color,box-shadow,transform] ${
        selected
          ? 'border-white/80 shadow-[0_0_0_1px_rgba(255,255,255,0.38),0_8px_18px_rgba(0,0,0,0.26)]'
          : 'border-black/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] hover:border-black/55 hover:shadow-[0_6px_14px_rgba(0,0,0,0.18)]'
      }`}
      style={{
        left,
        width: Math.max(18, width),
        top,
        height,
        background: `linear-gradient(180deg, rgba(255,255,255,0.14), rgba(255,255,255,0.03)), ${clipTone}`
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
      <div className="absolute inset-y-0 left-0 w-1 bg-black/18" />
      <div className="absolute inset-x-0 top-0 h-px bg-white/18" />
      <div className="absolute inset-0 opacity-70">
        {clip.type === 'audio' && clip.waveform && <WaveformPreview waveform={clip.waveform} />}
        {clip.previewUrl && showDetailed && (
          <div
            className="absolute inset-0 opacity-[0.12]"
            style={{
              backgroundImage: `url(${clip.previewUrl})`,
              backgroundPosition: 'center',
              backgroundSize: 'cover'
            }}
          />
        )}
      </div>

      <div className="relative flex h-full min-w-0 flex-col justify-between px-2.5 py-1.5">
        {showCompact ? (
          <>
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-black/18 text-white/90">
                <Icon size={11} strokeWidth={2.3} />
              </span>
              <span className="truncate text-[11px] font-semibold text-white">{clip.label}</span>
            </div>
            {showDetailed ? (
              <div className="flex min-w-0 items-end justify-between gap-2 text-[10px] font-medium text-white/78">
                <div className="truncate">{clip.subtitle ?? formatTimelineTime(clip.duration)}</div>
                <div className="shrink-0 tabular-nums text-white/68">
                  {formatTimelineTime(clip.start)} - {formatTimelineTime(clip.start + clip.duration)}
                </div>
              </div>
            ) : (
              <div className="truncate text-[10px] font-medium text-white/76">{clip.subtitle ?? formatTimelineTime(clip.duration)}</div>
            )}
          </>
        ) : (
          <div className="flex h-full items-center justify-center">
            <Icon size={12} strokeWidth={2.4} className="text-white/92" />
          </div>
        )}
      </div>

      {showTrimHandles && (
        <>
          <div
            className="absolute left-0 top-0 h-full w-2 cursor-col-resize border-r border-white/32 bg-black/12 opacity-0 transition group-hover:opacity-100"
            onPointerDown={(event) => {
              event.stopPropagation();
              onTrimStartPointerDown(event);
            }}
          />
          <div
            className="absolute right-0 top-0 h-full w-2 cursor-col-resize border-l border-white/32 bg-black/12 opacity-0 transition group-hover:opacity-100"
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
      className={`overflow-hidden rounded-2xl border border-black/20 bg-[#23262b] text-white shadow-[0_14px_32px_rgba(15,23,42,0.14)] ${className ?? ''}`}
    >
      <div className="border-b border-white/8 bg-[#2c3036] px-4 py-3 sm:px-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/58">Timeline</div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-white/72">
              <span>{orderedTracks.length} tracks</span>
              <span className="text-white/30">/</span>
              <span>{totalClipCount} clips</span>
              <span className="text-white/30">/</span>
              <span>{formatTimelineTime(timeline.duration)} total range</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-md border border-white/10 bg-black/10 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-white/62">
              {detailLevel === 'minimal' ? 'overview' : detailLevel === 'compact' ? 'standard' : 'detail'}
            </span>
            <div className="flex items-center overflow-hidden rounded-md border border-white/10 bg-black/10">
              <button
                type="button"
                className="border-r border-white/10 px-3 py-2 text-white/78 transition hover:bg-white/6"
                onClick={() => zoomAtClientX(TIMELINE_HEADER_WIDTH + visibleRange.viewportWidth / 2, zoom.pixelsPerSecond * 0.88)}
              >
                <Minus size={14} strokeWidth={2.5} />
              </button>
              <div className="min-w-[96px] px-3 text-center text-[11px] font-medium uppercase tracking-[0.12em] text-white/68">
                {zoom.pixelsPerSecond.toFixed(0)} px/s
              </div>
              <button
                type="button"
                className="border-l border-white/10 px-3 py-2 text-white/78 transition hover:bg-white/6"
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
        className="max-h-[520px] overflow-auto bg-[#1d2025]"
        onWheel={handleWheel}
      >
        <div style={{ width: TIMELINE_HEADER_WIDTH + timeAreaWidth, minWidth: '100%' }}>
          <div className="sticky top-0 z-40 flex border-b border-white/8 bg-[rgba(44,48,54,0.95)] backdrop-blur">
            <div
              className="sticky left-0 z-50 flex shrink-0 items-center justify-between border-r border-white/8 bg-[#2f3339] px-4"
              style={{ width: TIMELINE_HEADER_WIDTH, height: TIMELINE_RULER_HEIGHT }}
            >
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45">Tracks</div>
                <div className="text-sm font-semibold text-white/84">Editor</div>
              </div>
              <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/40">
                {formatTimelineTime(playheadTime)}
              </div>
            </div>
            <div
              className="relative shrink-0 border-l border-white/5 bg-[#30343a]"
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
                    <div className={`h-full w-px ${isMajor ? 'bg-white/14' : 'bg-white/7'}`} />
                    <div className="absolute left-2 top-1.5 text-[10px] font-medium text-white/52">
                      {formatTimelineTime(tick)}
                    </div>
                  </div>
                );
              })}
              {visibleMarkers.map((marker) => {
                const left = timeToPixels(marker.time, zoom.pixelsPerSecond);
                return (
                  <div key={marker.id} className="absolute inset-y-0" style={{ left }}>
                    <div className="absolute top-0 h-full w-px bg-white/20" />
                    <div
                      className="absolute left-2 top-5 rounded-sm border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-black"
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
                  className="pointer-events-none absolute inset-y-0 z-20 w-px bg-cyan-300 shadow-[0_0_0_1px_rgba(103,232,249,0.28)]"
                  style={{ left: dragGuideLeft }}
                />
              )}
              <div className="pointer-events-none absolute inset-y-0 z-30" style={{ left: playheadLeft }}>
                <div className="absolute top-0 h-full w-px bg-[#ef4444] shadow-[0_0_0_1px_rgba(239,68,68,0.35)]" />
                <div className="absolute left-[-22px] top-1 rounded-sm border border-[#7f1d1d] bg-[#ef4444] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-white">
                  {formatTimelineTime(playheadTime)}
                </div>
              </div>
            </div>
          </div>

          {trackRows.length === 0 ? (
            <div className="flex min-h-[280px] items-center justify-center p-6">
              {emptyState ?? (
                <div className="max-w-xl rounded-2xl border border-white/10 bg-[#2b3036] px-6 py-8 text-center">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-white/50">No Tracks Yet</div>
                  <div className="mt-2 text-xl font-semibold text-white/90">Load media to start editing</div>
                  <p className="mt-3 text-sm text-white/62">
                    Video, audio, overlays, titles, and effects will appear here with trim and snap controls.
                  </p>
                </div>
              )}
            </div>
          ) : (
            trackRows.map(({ track, collapsed, isSelected, height }, rowIndex) => {
              const effectiveTrack = effectiveTimeline.tracks.find((entry) => entry.id === track.id) ?? track;
              const TrackIcon = TRACK_KIND_ICONS[track.kind];
              const trackAccent = TRACK_ACCENTS[track.kind];
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
              const laneBackground = collapsed ? '#191c21' : rowIndex % 2 === 0 ? '#20242a' : '#25292f';

              return (
                <div key={track.id} className="flex border-b border-white/5">
                  <div
                    className={`sticky left-0 z-20 flex shrink-0 flex-col justify-center border-r border-white/8 px-4 ${
                      isSelected ? 'bg-[#343940]' : 'bg-[#2a2e34]'
                    }`}
                    style={{
                      width: TIMELINE_HEADER_WIDTH,
                      height,
                      boxShadow: `inset 3px 0 0 ${trackAccent}`
                    }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <button
                        type="button"
                        className="flex min-w-0 items-center gap-3 text-left"
                        onClick={() => {
                          onSelectTrack?.(track);
                          onPlayheadChange(
                            track.clips[0] ? clamp(track.clips[0].start, 0, timeline.duration) : playheadTime
                          );
                        }}
                      >
                        <span
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/10 bg-black/10"
                          style={{ color: trackAccent }}
                        >
                          <TrackIcon size={15} strokeWidth={2.3} />
                        </span>
                        <span className="min-w-0">
                          <div className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">
                            {track.kind}
                          </div>
                          <div className="truncate text-sm font-semibold text-white/88">{track.label}</div>
                          <div className="truncate text-[11px] text-white/56">
                            {track.clips.length} clip{track.clips.length === 1 ? '' : 's'}
                            {track.emptyLabel ? ` • ${track.emptyLabel}` : ''}
                          </div>
                        </span>
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-white/10 bg-black/10 p-2 text-white/72 transition hover:bg-white/8"
                        onClick={() => toggleTrackCollapse(track.id)}
                      >
                        {collapsed ? <ChevronRight size={14} strokeWidth={2.5} /> : <ChevronDown size={14} strokeWidth={2.5} />}
                      </button>
                    </div>

                    {!collapsed && (
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] font-medium uppercase tracking-[0.12em] text-white/48">
                        {isSelected && <span style={{ color: trackAccent }}>selected</span>}
                        {track.locked && (
                          <span className="inline-flex items-center gap-1">
                            <Lock size={10} strokeWidth={2.5} />
                            locked
                          </span>
                        )}
                        {track.muted && (
                          <span className="inline-flex items-center gap-1">
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
                    className="relative shrink-0 overflow-hidden"
                    style={{ width: timeAreaWidth, height, background: laneBackground }}
                    onPointerDown={(event) => {
                      if (event.button !== 0 || event.target !== event.currentTarget) return;
                      onSelectTrack?.(track);
                      onPlayheadChange(getTimeFromClientX(event.clientX));
                    }}
                  >
                    {!collapsed && <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/6" />}
                    {!collapsed && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-black/22" />}

                    {visibleTicks.map((tick) => {
                      const left = timeToPixels(tick, zoom.pixelsPerSecond);
                      const isMajor = Math.round((tick / rulerStep) * 10) % 5 === 0;
                      return (
                        <div
                          key={`${track.id}-grid-${tick}`}
                          className="pointer-events-none absolute inset-y-0 w-px"
                          style={{
                            left,
                            backgroundColor: isMajor ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.04)'
                          }}
                        />
                      );
                    })}

                    {visibleMarkers.map((marker) => (
                      <div
                        key={`${track.id}-marker-${marker.id}`}
                        className="pointer-events-none absolute inset-y-0 w-px"
                        style={{
                          left: timeToPixels(marker.time, zoom.pixelsPerSecond),
                          backgroundColor: marker.color ?? 'rgba(255,255,255,0.18)'
                        }}
                      />
                    ))}

                    {transitions.map((transition) => {
                      const left = timeToPixels(transition.at, zoom.pixelsPerSecond);
                      return (
                        <div key={transition.id} className="pointer-events-none absolute z-20" style={{ left, top: Math.max(8, height / 2 - 8) }}>
                          <div className="h-3.5 w-3.5 rotate-45 rounded-[2px] border border-white/20 bg-white/14" />
                          {detailLevel !== 'minimal' && (
                            <div className="absolute left-4 top-[-2px] whitespace-nowrap text-[9px] font-medium uppercase tracking-[0.12em] text-white/46">
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
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] font-medium uppercase tracking-[0.16em] text-white/28">
                        {track.emptyLabel ?? 'Empty track'}
                      </div>
                    )}

                    {dragGuideLeft != null && (
                      <div
                        className="pointer-events-none absolute inset-y-0 z-30 w-px bg-cyan-300 shadow-[0_0_0_1px_rgba(103,232,249,0.3)]"
                        style={{ left: dragGuideLeft }}
                      />
                    )}

                    <div className="pointer-events-none absolute inset-y-0 z-40" style={{ left: playheadLeft }}>
                      <div className="h-full w-px bg-[#ef4444] shadow-[0_0_0_1px_rgba(239,68,68,0.28)]" />
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
