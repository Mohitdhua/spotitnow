export interface Point {
  x: number;
  y: number;
}

export interface Region {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Puzzle {
  imageA: string; // Base64 or URL
  imageB: string; // Base64 or URL
  regions: Region[];
  title?: string;
}

export interface PuzzleSet {
  title: string;
  puzzles: Puzzle[];
  version: number;
}

export interface OverlayTransform {
  x: number; // normalized (0..1) from left
  y: number; // normalized (0..1) from top
  width: number; // normalized width relative to frame
  height: number; // normalized height relative to frame
}

export interface VideoSettings {
  aspectRatio: '16:9' | '9:16' | '1:1' | '4:3';
  visualStyle:
    | 'classic'
    | 'pop'
    | 'neon'
    | 'sunset'
    | 'mint'
    | 'midnight'
    | 'mono'
    | 'retro'
    | 'cyber'
    | 'oceanic'
    | 'ember'
    | 'candy'
    | 'forest'
    | 'aurora'
    | 'slate'
    | 'arcade'
    | 'ivory';
  showDuration: number; // Seconds to show the puzzle before revealing
  revealDuration: number; // Total seconds spent in the reveal phase
  sequentialRevealStep: number; // Seconds between each revealed diff (and blink-start gap)
  blinkSpeed: number; // Seconds per blink cycle when compare overlay is active
  circleThickness: number; // Border thickness for circle-based reveal markers
  revealStyle: 'box' | 'circle' | 'highlight';
  revealVariant:
    | 'box_glow'
    | 'box_dashed'
    | 'box_corners'
    | 'circle_ring'
    | 'circle_dotted'
    | 'circle_ellipse'
    | 'circle_ellipse_dotted'
    | 'circle_red_black'
    | 'highlight_soft';
  revealColor: string;
  outlineColor: string;
  outlineThickness: number;
  transitionStyle: 'fade' | 'slide' | 'none';
  transitionDuration: number; // Seconds
  exportResolution: '480p' | '720p' | '1080p' | '1440p' | '2160p';
  exportBitrateMbps: number;
  exportCodec: 'h264' | 'av1';
  logo?: string; // Base64 or URL
}

export type GameMode =
  | 'upload'
  | 'edit'
  | 'play'
  | 'video_setup'
  | 'video_play'
  | 'overlay_editor';
