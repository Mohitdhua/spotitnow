import type {
  EditorTimelineClip,
  EditorTimelineClipChange,
  EditorTimelineClipKind,
  EditorTimelineState,
  EditorTimelineTrack,
  EditorTimelineTrackKind
} from './types';

export const TIMELINE_HEADER_WIDTH = 224;
export const TIMELINE_RULER_HEIGHT = 46;
export const TIMELINE_MIN_CLIP_DURATION = 0.25;

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const timeToPixels = (time: number, pixelsPerSecond: number) => time * pixelsPerSecond;

export const pixelsToTime = (pixels: number, pixelsPerSecond: number) => pixels / Math.max(1, pixelsPerSecond);

export const getTrackBaseHeight = (kind: EditorTimelineTrackKind) => {
  switch (kind) {
    case 'video':
      return 84;
    case 'audio':
      return 64;
    case 'text':
      return 54;
    case 'effects':
      return 44;
    case 'overlay':
    default:
      return 72;
  }
};

export const getTrackRenderHeight = (
  track: EditorTimelineTrack,
  options?: { isSelected?: boolean; isCollapsed?: boolean }
) => {
  if (options?.isCollapsed) {
    return 42;
  }
  return getTrackBaseHeight(track.kind) + (options?.isSelected ? 8 : 0);
};

export const getDetailLevel = (pixelsPerSecond: number) => {
  if (pixelsPerSecond < 34) return 'minimal';
  if (pixelsPerSecond < 88) return 'compact';
  return 'detailed';
};

export const getRulerStep = (pixelsPerSecond: number) => {
  if (pixelsPerSecond < 20) return 10;
  if (pixelsPerSecond < 36) return 5;
  if (pixelsPerSecond < 64) return 2;
  if (pixelsPerSecond < 120) return 1;
  if (pixelsPerSecond < 220) return 0.5;
  return 0.25;
};

export const formatTimelineTime = (seconds: number) => {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remainingSeconds = safe - minutes * 60;
  if (safe >= 60 || remainingSeconds % 1 === 0) {
    return `${minutes}:${remainingSeconds.toFixed(remainingSeconds % 1 === 0 ? 0 : 2).padStart(remainingSeconds >= 10 ? 2 : 4, '0')}`;
  }
  return `${safe.toFixed(2)}s`;
};

export const getVisibleClips = (
  clips: EditorTimelineClip[],
  visibleStart: number,
  visibleEnd: number,
  overscanSeconds = 1.5
) =>
  clips.filter((clip) => {
    const clipStart = clip.start;
    const clipEnd = clip.start + clip.duration;
    return clipEnd >= visibleStart - overscanSeconds && clipStart <= visibleEnd + overscanSeconds;
  });

const sortClipsByStart = (clips: EditorTimelineClip[]) =>
  [...clips].sort((left, right) => left.start - right.start || left.duration - right.duration);

const getFreeSegments = (track: EditorTimelineTrack, clipId: string, timelineDuration: number) => {
  if (track.allowOverlap) {
    return [{ start: 0, end: Math.max(0, timelineDuration) }];
  }

  const clips = sortClipsByStart(track.clips.filter((clip) => clip.id !== clipId && !clip.hidden));
  const segments: Array<{ start: number; end: number }> = [];
  let cursor = 0;

  clips.forEach((clip) => {
    if (clip.start > cursor) {
      segments.push({ start: cursor, end: clip.start });
    }
    cursor = Math.max(cursor, clip.start + clip.duration);
  });

  if (cursor < timelineDuration) {
    segments.push({ start: cursor, end: timelineDuration });
  }

  return segments.length ? segments : [{ start: 0, end: 0 }];
};

export const resolveClipMove = ({
  state,
  trackId,
  clipId,
  proposedStart,
  duration
}: {
  state: EditorTimelineState;
  trackId: string;
  clipId: string;
  proposedStart: number;
  duration: number;
}) => {
  const track = state.tracks.find((entry) => entry.id === trackId);
  const timelineDuration = Math.max(duration, state.duration);

  if (!track || track.allowOverlap) {
    return clamp(proposedStart, 0, Math.max(0, timelineDuration - duration));
  }

  const segments = getFreeSegments(track, clipId, timelineDuration)
    .map((segment) => ({
      start: segment.start,
      end: Math.max(segment.start, segment.end - duration)
    }))
    .filter((segment) => segment.end >= segment.start);

  if (!segments.length) {
    return 0;
  }

  const directMatch = segments.find((segment) => proposedStart >= segment.start && proposedStart <= segment.end);
  if (directMatch) {
    return clamp(proposedStart, directMatch.start, directMatch.end);
  }

  return segments.reduce((closest, segment) => {
    const next = clamp(proposedStart, segment.start, segment.end);
    return Math.abs(next - proposedStart) < Math.abs(closest - proposedStart) ? next : closest;
  }, segments[0].start);
};

export const resolveClipTrim = ({
  state,
  trackId,
  clipId,
  proposedStart,
  proposedDuration
}: {
  state: EditorTimelineState;
  trackId: string;
  clipId: string;
  proposedStart: number;
  proposedDuration: number;
}) => {
  const track = state.tracks.find((entry) => entry.id === trackId);
  const duration = Math.max(TIMELINE_MIN_CLIP_DURATION, proposedDuration);
  const start = clamp(proposedStart, 0, Math.max(0, state.duration - duration));

  if (!track || track.allowOverlap) {
    return {
      start,
      duration
    };
  }

  const clips = sortClipsByStart(track.clips.filter((clip) => clip.id !== clipId && !clip.hidden));
  const previous = [...clips].reverse().find((clip) => clip.start + clip.duration <= start + 0.001);
  const next = clips.find((clip) => clip.start >= start + 0.001);

  const minStart = previous ? previous.start + previous.duration : 0;
  const maxEnd = next ? next.start : state.duration;

  const safeStart = clamp(start, minStart, Math.max(minStart, maxEnd - TIMELINE_MIN_CLIP_DURATION));
  const safeDuration = clamp(duration, TIMELINE_MIN_CLIP_DURATION, Math.max(TIMELINE_MIN_CLIP_DURATION, maxEnd - safeStart));

  return {
    start: safeStart,
    duration: safeDuration
  };
};

export const buildSnapTimes = ({
  state,
  activeClipId,
  activeTrackId,
  includeGridStep,
  playheadTime
}: {
  state: EditorTimelineState;
  activeClipId: string;
  activeTrackId: string;
  includeGridStep: number;
  playheadTime: number;
}) => {
  const snapTimes = new Set<number>([0, playheadTime, state.duration]);

  state.markers.forEach((marker) => snapTimes.add(marker.time));
  state.transitions.forEach((transition) => snapTimes.add(transition.at));

  state.tracks.forEach((track) => {
    track.clips.forEach((clip) => {
      if (clip.id === activeClipId && track.id === activeTrackId) return;
      snapTimes.add(clip.start);
      snapTimes.add(clip.start + clip.duration);
    });
  });

  const majorStep = Math.max(0.25, includeGridStep);
  for (let tick = 0; tick <= state.duration + majorStep; tick += majorStep) {
    snapTimes.add(Number(tick.toFixed(4)));
  }

  return [...snapTimes].sort((left, right) => left - right);
};

export const findClosestSnapTime = ({
  candidate,
  snapTimes,
  thresholdSeconds
}: {
  candidate: number;
  snapTimes: number[];
  thresholdSeconds: number;
}) => {
  let bestTime: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  snapTimes.forEach((time) => {
    const distance = Math.abs(time - candidate);
    if (distance <= thresholdSeconds && distance < bestDistance) {
      bestDistance = distance;
      bestTime = time;
    }
  });

  return bestTime;
};

export const createWaveformSeed = (label: string, points = 32) => {
  const chars = label.split('').reduce((total, char) => total + char.charCodeAt(0), 0);
  return Array.from({ length: points }, (_, index) => {
    const angle = (chars + index * 17) / 9;
    const wave = Math.sin(angle) * 0.5 + Math.cos(angle / 2.6) * 0.3;
    return clamp(Math.abs(wave) + 0.18, 0.12, 0.98);
  });
};

export const canTrackAcceptClip = (track: EditorTimelineTrack, clipType: EditorTimelineClipKind) =>
  !track.locked && !track.hidden && (!track.accepts || track.accepts.includes(clipType));

export const applyTimelineClipChange = (
  state: EditorTimelineState,
  change: EditorTimelineClipChange
) => {
  const tracks = state.tracks.map((track) => ({
    ...track,
    clips: track.clips.map((clip) =>
      clip.id === change.clipId
        ? {
            ...clip,
            trackId: change.toTrackId,
            start: change.start,
            duration: change.duration
          }
        : clip
    )
  }));

  if (change.fromTrackId === change.toTrackId) {
    return {
      ...state,
      tracks
    };
  }

  const movingClip = tracks
    .flatMap((track) => track.clips)
    .find((clip) => clip.id === change.clipId);

  if (!movingClip) {
    return state;
  }

  return {
    ...state,
    tracks: tracks.map((track) => {
      if (track.id === change.fromTrackId) {
        return {
          ...track,
          clips: track.clips.filter((clip) => clip.id !== change.clipId)
        };
      }
      if (track.id === change.toTrackId) {
        return {
          ...track,
          clips: sortClipsByStart([...track.clips, movingClip])
        };
      }
      return track;
    })
  };
};
