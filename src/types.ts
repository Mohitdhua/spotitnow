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

export interface VideoSettings {
  aspectRatio: '16:9' | '9:16' | '1:1' | '4:3';
  showDuration: number; // Seconds to show the puzzle before revealing
  revealDuration: number; // Seconds to show the revealed differences
  revealStyle: 'box' | 'circle' | 'highlight';
  revealColor: string;
  transitionStyle: 'fade' | 'slide' | 'none';
  transitionDuration: number; // Seconds
}

export type GameMode = 'upload' | 'edit' | 'play' | 'video_setup' | 'video_play';
