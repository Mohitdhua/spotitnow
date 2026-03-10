import type { SplitterDefaults, SplitterSharedRegion, SuperImageExportMode } from './appSettings';
import type { ExtractFramesSummary, ParsedTimestamp } from './frameExtractor';
import type { WatermarkSelectionPreset } from './watermarkRemoval';

export type SuperImageExportStage = 'extracting' | 'processing' | 'cleaning' | 'packaging' | 'exporting';

export interface SuperImageExportWorkerStartPayload {
  videos: File[];
  timestamps: ParsedTimestamp[];
  format: 'jpeg' | 'png';
  jpegQuality: number;
  splitterDefaults: SplitterDefaults;
  outputMode: SuperImageExportMode;
  sharedRegion?: SplitterSharedRegion | null;
  watermarkRemoval?: {
    enabled: boolean;
    selectionPreset?: WatermarkSelectionPreset | null;
  };
}

export interface SuperImageExportWorkerStartMessage {
  type: 'start';
  payload: SuperImageExportWorkerStartPayload;
}

export interface SuperImageExportWorkerAckPairMessage {
  type: 'ack-pair';
  id: number;
}

export interface SuperImageExportWorkerCancelMessage {
  type: 'cancel';
}

export type SuperImageExportWorkerRequest =
  | SuperImageExportWorkerStartMessage
  | SuperImageExportWorkerAckPairMessage
  | SuperImageExportWorkerCancelMessage;

export interface SuperImageExportWorkerProgressMessage {
  type: 'progress';
  stage: SuperImageExportStage;
  progress: number;
  label: string;
}

export interface SuperImageExportWorkerPairMessage {
  type: 'pair';
  id: number;
  sequence: number;
  puzzleFilename: string;
  diffFilename: string;
  puzzleBuffer: ArrayBuffer;
  diffBuffer: ArrayBuffer;
}

export interface SuperImageExportWorkerResult {
  extractionSummary: ExtractFramesSummary;
  extractedFrameCount: number;
  processedFrameCount: number;
  validPuzzleCount: number;
  discardedFrameCount: number;
  warnings: string[];
  exportedImagePairCount: number;
  outputMode: SuperImageExportMode;
  outputName: string | null;
  watermarkRemovalEnabled: boolean;
  watermarkPairsCleaned: number;
  watermarkPresetName: string | null;
}

export interface SuperImageExportWorkerDoneMessage {
  type: 'done';
  result: SuperImageExportWorkerResult;
  manifestContent?: string;
  archiveBuffer?: ArrayBuffer;
  archiveMimeType?: string;
}

export interface SuperImageExportWorkerCancelledMessage {
  type: 'cancelled';
}

export interface SuperImageExportWorkerErrorMessage {
  type: 'error';
  message: string;
}

export type SuperImageExportWorkerResponse =
  | SuperImageExportWorkerProgressMessage
  | SuperImageExportWorkerPairMessage
  | SuperImageExportWorkerDoneMessage
  | SuperImageExportWorkerCancelledMessage
  | SuperImageExportWorkerErrorMessage;
