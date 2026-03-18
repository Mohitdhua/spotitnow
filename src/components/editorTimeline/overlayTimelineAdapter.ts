import type {
  OverlayBackgroundFill,
  OverlayChromaKey,
  OverlayCrop,
  OverlayEditorMode,
  OverlayLinkedPairExportMode,
  OverlayTimeline
} from '../../services/overlayVideoExport';
import type { EditorTimelineClip, EditorTimelineState, EditorTimelineTrack, EditorTimelineTransition } from './types';
import { createWaveformSeed } from './utils';

interface OverlayTimelineBaseSource {
  mode: 'video' | 'photo' | 'color';
  duration: number;
  previewUrl?: string | null;
  label?: string;
}

interface OverlayTimelineMediaClip {
  id: string;
  name: string;
  kind: 'image' | 'video';
  url: string;
  timeline: OverlayTimeline;
  crop: OverlayCrop;
  background: OverlayBackgroundFill;
  chromaKey: OverlayChromaKey;
}

interface OverlayTimelineLinkedPair {
  id: string;
  name: string;
  puzzleUrl: string;
  diffUrl: string;
  start: number;
  end: number;
}

interface OverlayTimelineSoundtrack {
  name: string;
  start: number;
  trimStart: number;
  durationSeconds: number;
  loop: boolean;
}

export interface OverlayEditorTimelineInput {
  duration: number;
  editorMode: OverlayEditorMode;
  linkedPairOutputMode: 'video' | 'thumbnail';
  linkedPairExportMode: OverlayLinkedPairExportMode;
  selectedLinkedPairId?: string | null;
  base: OverlayTimelineBaseSource;
  batchPhotos: OverlayTimelineMediaClip[];
  overlays: OverlayTimelineMediaClip[];
  linkedPairs: OverlayTimelineLinkedPair[];
  soundtrack?: OverlayTimelineSoundtrack | null;
}

const cropIsAdjusted = (crop: OverlayCrop) =>
  Math.abs(crop.x) > 0.001 ||
  Math.abs(crop.y) > 0.001 ||
  Math.abs(crop.width - 1) > 0.001 ||
  Math.abs(crop.height - 1) > 0.001;

const makeClipDuration = (timeline: OverlayTimeline) => Math.max(0.25, timeline.end - timeline.start);

const packClipsIntoTracks = ({
  clips,
  baseId,
  baseLabel,
  kind,
  accepts,
  order,
  emptyLabel
}: {
  clips: EditorTimelineClip[];
  baseId: string;
  baseLabel: string;
  kind: EditorTimelineTrack['kind'];
  accepts: EditorTimelineTrack['accepts'];
  order: number;
  emptyLabel?: string;
}) => {
  const sorted = [...clips].sort((left, right) => left.start - right.start || left.duration - right.duration);
  const lanes: EditorTimelineClip[][] = [];

  sorted.forEach((clip) => {
    const laneIndex = lanes.findIndex((lane) => {
      const lastClip = lane[lane.length - 1];
      return !lastClip || lastClip.start + lastClip.duration <= clip.start + 0.001;
    });

    if (laneIndex === -1) {
      lanes.push([clip]);
      return;
    }

    lanes[laneIndex].push(clip);
  });

  return (lanes.length ? lanes : [[]]).map((lane, index) => ({
    id: `${baseId}-${index + 1}`,
    label: lanes.length > 1 ? `${baseLabel} ${index + 1}` : baseLabel,
    kind,
    order: order + index,
    accepts,
    clips: lane.map((clip) => ({ ...clip, trackId: `${baseId}-${index + 1}` })),
    emptyLabel
  }));
};

const buildTrackTransitions = (trackId: string, clips: EditorTimelineClip[], label: string): EditorTimelineTransition[] => {
  const sorted = [...clips].sort((left, right) => left.start - right.start);
  const transitions: EditorTimelineTransition[] = [];

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const current = sorted[index];
    const next = sorted[index + 1];
    const currentEnd = current.start + current.duration;
    const gap = next.start - currentEnd;

    if (gap > 0.35) continue;

    transitions.push({
      id: `${trackId}-transition-${index + 1}`,
      trackId,
      at: gap <= 0.05 ? next.start : currentEnd + gap / 2,
      duration: Math.max(0.16, Math.min(0.45, Math.abs(gap) + 0.16)),
      kind: gap <= 0.05 ? 'cut' : 'crossfade',
      label,
      clipIds: [current.id, next.id]
    });
  }

  return transitions;
};

const buildEffectClips = (items: OverlayTimelineMediaClip[], prefix: string, color: string): EditorTimelineClip[] => {
  const effectClips: EditorTimelineClip[] = [];

  items.forEach((item) => {
    const effects = [
      item.chromaKey.enabled ? 'Chroma Key' : null,
      item.background.enabled ? 'Fill Matte' : null,
      cropIsAdjusted(item.crop) ? 'Crop Window' : null
    ].filter(Boolean) as string[];

    effects.forEach((effectLabel, index) => {
      effectClips.push({
        id: `${prefix}-effect-${item.id}-${index + 1}`,
        trackId: `${prefix}-effects`,
        type: 'effect',
        label: effectLabel,
        subtitle: item.name,
        start: item.timeline.start,
        duration: makeClipDuration(item.timeline),
        sourceIn: 0,
        sourceOut: makeClipDuration(item.timeline),
        color,
        editable: false
      });
    });
  });

  return effectClips;
};

export const buildOverlayEditorTimeline = ({
  duration,
  editorMode,
  linkedPairOutputMode,
  linkedPairExportMode,
  selectedLinkedPairId,
  base,
  batchPhotos,
  overlays,
  linkedPairs,
  soundtrack
}: OverlayEditorTimelineInput): EditorTimelineState => {
  const tracks: EditorTimelineTrack[] = [];
  const transitions: EditorTimelineTransition[] = [];
  let orderCursor = 0;

  tracks.push({
    id: 'base-canvas',
    label: 'Base Canvas',
    kind: 'video',
    order: orderCursor++,
    accepts: ['video'],
    locked: true,
    clips: [
      {
        id: 'base-canvas-clip',
        trackId: 'base-canvas',
        type: base.mode === 'video' ? 'video' : 'overlay',
        label:
          base.mode === 'video'
            ? base.label ?? 'Base Video'
            : base.mode === 'photo'
              ? base.label ?? 'Base Photo'
              : base.label ?? 'Solid Canvas',
        subtitle:
          base.mode === 'video'
            ? 'Primary source'
            : base.mode === 'photo'
              ? 'Still frame canvas'
              : 'Color background',
        start: 0,
        duration: Math.max(0.5, base.duration),
        sourceIn: 0,
        sourceOut: Math.max(0.5, base.duration),
        color: base.mode === 'video' ? '#2563EB' : '#64748B',
        previewUrl: base.previewUrl ?? null,
        editable: false,
        locked: true
      }
    ]
  });

  if (editorMode === 'standard') {
    const batchClips = batchPhotos.map((item, index) => ({
      id: `batch-${item.id}`,
      trackId: 'batch-lane',
      type: 'video' as const,
      label: item.name,
      subtitle: `Puzzle clip ${index + 1}`,
      start: item.timeline.start,
      duration: makeClipDuration(item.timeline),
      sourceIn: 0,
      sourceOut: makeClipDuration(item.timeline),
      color: item.kind === 'video' ? '#2563EB' : '#3B82F6',
      previewUrl: item.url,
      editable: true
    } satisfies EditorTimelineClip));

    const batchTracks = packClipsIntoTracks({
      clips: batchClips,
      baseId: 'batch-track',
      baseLabel: 'Puzzle Clips',
      kind: 'video',
      accepts: ['video'],
      order: orderCursor,
      emptyLabel: 'Import puzzle clips'
    });
    orderCursor += batchTracks.length;
    tracks.push(...batchTracks);
    batchTracks.forEach((track) => {
      transitions.push(...buildTrackTransitions(track.id, track.clips, 'Cut'));
    });
  } else if (linkedPairs.length) {
    const selectedPair =
      linkedPairs.find((pair) => pair.id === selectedLinkedPairId) ??
      linkedPairs[0];

    const linkedPairClips =
      linkedPairOutputMode === 'video' && linkedPairExportMode === 'single_video'
        ? linkedPairs.map((pair, index) => ({
            id: `pair-${pair.id}`,
            trackId: 'linked-pairs',
            type: 'video' as const,
            label: pair.name,
            subtitle: `Pair ${index + 1}`,
            start: pair.start,
            duration: Math.max(0.5, pair.end - pair.start),
            sourceIn: 0,
            sourceOut: Math.max(0.5, pair.end - pair.start),
            color: '#F59E0B',
            previewUrl: pair.puzzleUrl,
            editable: false
          }))
        : selectedPair
          ? [
              {
                id: `pair-${selectedPair.id}`,
                trackId: 'linked-pairs',
                type: 'video' as const,
                label: selectedPair.name,
                subtitle: linkedPairOutputMode === 'thumbnail' ? 'Thumbnail composition' : 'Selected pair output',
                start: 0,
                duration: Math.max(0.5, base.duration),
                sourceIn: 0,
                sourceOut: Math.max(0.5, base.duration),
                color: '#F59E0B',
                previewUrl: selectedPair.puzzleUrl,
                editable: false
              }
            ]
          : [];

    if (linkedPairClips.length) {
      const linkedPairTracks = packClipsIntoTracks({
        clips: linkedPairClips,
        baseId: 'linked-pairs-track',
        baseLabel: linkedPairOutputMode === 'thumbnail' ? 'Thumbnail Pair' : 'Linked Pairs',
        kind: 'video',
        accepts: ['video'],
        order: orderCursor,
        emptyLabel: 'Import linked pairs'
      });
      orderCursor += linkedPairTracks.length;
      tracks.push(...linkedPairTracks);
      linkedPairTracks.forEach((track) => {
        transitions.push(...buildTrackTransitions(track.id, track.clips, 'Transition'));
      });
    }
  }

  const overlayClips = overlays.map((item, index) => ({
    id: `overlay-${item.id}`,
    trackId: 'overlay-lane',
    type: 'overlay' as const,
    label: item.name,
    subtitle: `Layer ${index + 1}`,
    start: item.timeline.start,
    duration: makeClipDuration(item.timeline),
    sourceIn: 0,
    sourceOut: makeClipDuration(item.timeline),
    color: item.kind === 'video' ? '#0EA5E9' : '#EC4899',
    previewUrl: item.url,
    editable: true,
    effects: [
      item.chromaKey.enabled ? { id: `${item.id}-chroma`, label: 'Chroma', tone: '#93C5FD' } : null,
      item.background.enabled ? { id: `${item.id}-fill`, label: 'Fill', tone: '#FCA5A5' } : null
    ].filter(Boolean) as EditorTimelineClip['effects']
  } satisfies EditorTimelineClip));

  const overlayTracks = packClipsIntoTracks({
    clips: overlayClips,
    baseId: 'overlay-track',
    baseLabel: 'Overlays',
    kind: 'overlay',
    accepts: ['overlay'],
    order: orderCursor,
    emptyLabel: 'Drop logos, stickers, screenshots, or video layers'
  });
  orderCursor += overlayTracks.length;
  tracks.push(...overlayTracks);

  const effectClips = [
    ...buildEffectClips(batchPhotos, 'batch', '#8B5CF6'),
    ...buildEffectClips(overlays, 'overlay', '#A855F7')
  ];

  if (effectClips.length) {
    const effectTracks = packClipsIntoTracks({
      clips: effectClips,
      baseId: 'effects-track',
      baseLabel: 'Effects',
      kind: 'effects',
      accepts: ['effect'],
      order: orderCursor,
      emptyLabel: 'Chroma, fills, and crop adjustments'
    });
    orderCursor += effectTracks.length;
    tracks.push(...effectTracks);
  }

  if (soundtrack) {
    const availableDuration = Math.max(0.5, soundtrack.durationSeconds - soundtrack.trimStart);
    const start = Math.max(0, Math.min(duration, soundtrack.start));
    const clipDuration = soundtrack.loop
      ? Math.max(0.5, duration - start)
      : Math.max(0.5, Math.min(duration - start, availableDuration));

    tracks.push({
      id: 'soundtrack-track',
      label: 'Soundtrack',
      kind: 'audio',
      order: orderCursor++,
      accepts: ['audio'],
      allowOverlap: true,
      clips: [
        {
          id: 'soundtrack-clip',
          trackId: 'soundtrack-track',
          type: 'audio',
          label: soundtrack.name,
          subtitle: soundtrack.loop ? 'Looped audio bed' : 'Reference audio clip',
          start,
          duration: clipDuration,
          sourceIn: soundtrack.trimStart,
          sourceOut: soundtrack.trimStart + clipDuration,
          color: '#14B8A6',
          waveform: createWaveformSeed(soundtrack.name, 58),
          editable: false
        }
      ]
    });
  }

  const markers =
    editorMode === 'linked_pairs'
      ? linkedPairs.slice(0, 8).map((pair, index) => ({
          id: `linked-pair-marker-${pair.id}`,
          time: linkedPairOutputMode === 'video' && linkedPairExportMode === 'single_video' ? pair.start : 0,
          label: `Pair ${index + 1}`,
          color: '#FDE68A'
        }))
      : batchPhotos.slice(0, 8).map((item, index) => ({
          id: `batch-marker-${item.id}`,
          time: item.timeline.start,
          label: `Clip ${index + 1}`,
          color: '#93C5FD'
        }));

  return {
    duration,
    tracks,
    transitions,
    markers
  };
};
