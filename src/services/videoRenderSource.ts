import type {
  GeneratedBackgroundPack,
  Puzzle,
  Region,
  VideoAudioCuePoolKey,
  VideoSettings
} from '../types';

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
  sfxPools?: Partial<Record<VideoAudioCuePoolKey, VideoExportAudioAsset[]>>;
  introClip?: VideoExportAudioAsset;
  music?: VideoExportAudioAsset;
}

export type VideoExportWorkerStartPayload = VideoRenderSource & {
  settings: VideoSettings;
  generatedBackgroundPack?: GeneratedBackgroundPack | null;
  puzzleIndexOffset?: number;
  streamOutput?: boolean;
  audioAssets?: VideoExportAudioAssets;
  introVideoFile?: File;
  jobId?: string;
  workerSessionId?: string;
};
