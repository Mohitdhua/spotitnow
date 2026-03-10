import type { Puzzle, Region, VideoSettings } from '../types';

export interface BinaryRenderablePuzzle {
  imageABuffer: ArrayBuffer;
  imageBBuffer: ArrayBuffer;
  mimeType: string;
  regions: Region[];
  title?: string;
}

export interface LegacyVideoRenderSource {
  source: 'legacy';
  puzzles: Puzzle[];
}

export interface BinaryVideoRenderSource {
  source: 'binary';
  puzzles: BinaryRenderablePuzzle[];
}

export type VideoRenderSource = LegacyVideoRenderSource | BinaryVideoRenderSource;

export type VideoExportWorkerStartPayload = VideoRenderSource & {
  settings: VideoSettings;
  streamOutput?: boolean;
  jobId?: string;
  workerSessionId?: string;
};
