export type EditorTimelineTrackKind = 'video' | 'audio' | 'text' | 'effects' | 'overlay';

export type EditorTimelineClipKind = 'video' | 'audio' | 'text' | 'effect' | 'overlay';

export type EditorTimelineTransitionKind = 'cut' | 'crossfade' | 'wipe';

export interface EditorTimelineEffectMeta {
  id: string;
  label: string;
  tone?: string;
}

export interface EditorTimelineClip {
  id: string;
  trackId: string;
  type: EditorTimelineClipKind;
  label: string;
  start: number;
  duration: number;
  sourceIn: number;
  sourceOut: number;
  color: string;
  subtitle?: string;
  previewUrl?: string | null;
  waveform?: number[];
  effects?: EditorTimelineEffectMeta[];
  editable?: boolean;
  locked?: boolean;
  muted?: boolean;
  hidden?: boolean;
  allowOverlap?: boolean;
}

export interface EditorTimelineTrack {
  id: string;
  label: string;
  kind: EditorTimelineTrackKind;
  order: number;
  clips: EditorTimelineClip[];
  accepts?: EditorTimelineClipKind[];
  allowOverlap?: boolean;
  locked?: boolean;
  muted?: boolean;
  hidden?: boolean;
  collapsed?: boolean;
  emptyLabel?: string;
}

export interface EditorTimelineTransition {
  id: string;
  trackId: string;
  at: number;
  duration: number;
  kind: EditorTimelineTransitionKind;
  label: string;
  clipIds?: [string, string];
}

export interface EditorTimelineMarker {
  id: string;
  time: number;
  label: string;
  color?: string;
}

export interface EditorTimelineVisibleRange {
  start: number;
  end: number;
  scrollLeft: number;
  scrollTop: number;
  viewportWidth: number;
  viewportHeight: number;
}

export interface EditorTimelineZoomState {
  pixelsPerSecond: number;
  minPixelsPerSecond: number;
  maxPixelsPerSecond: number;
}

export interface EditorTimelineState {
  duration: number;
  tracks: EditorTimelineTrack[];
  transitions: EditorTimelineTransition[];
  markers: EditorTimelineMarker[];
}

export interface EditorTimelineClipChange {
  clipId: string;
  fromTrackId: string;
  toTrackId: string;
  start: number;
  duration: number;
  action: 'move' | 'trim-start' | 'trim-end' | 'move-track';
}
