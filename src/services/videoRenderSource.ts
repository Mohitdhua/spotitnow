import type { GeneratedBackgroundPack, Puzzle, Region, VideoSettings } from '../types';

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

export interface VideoExportAudioAsset {
  sampleRate: number;
  channels: number;
  data: Float32Array;
  duration: number;
}

export interface VideoExportAudioAssets {
  countdown?: VideoExportAudioAsset;
  reveal?: VideoExportAudioAsset;
  revealVariants?: VideoExportAudioAsset[];
  marker?: VideoExportAudioAsset;
  blink?: VideoExportAudioAsset;
  play?: VideoExportAudioAsset;
  intro?: VideoExportAudioAsset;
  introClip?: VideoExportAudioAsset;
  transition?: VideoExportAudioAsset;
  outro?: VideoExportAudioAsset;
  music?: VideoExportAudioAsset;
}

export type VideoExportWorkerStartPayload = VideoRenderSource & {
  settings: VideoSettings;
  generatedBackgroundPack?: GeneratedBackgroundPack | null;
  streamOutput?: boolean;
  audioAssets?: VideoExportAudioAssets;
  introVideoFile?: File;
  jobId?: string;
  workerSessionId?: string;
};
