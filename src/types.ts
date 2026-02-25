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

export type GameMode = 'upload' | 'edit' | 'play';
