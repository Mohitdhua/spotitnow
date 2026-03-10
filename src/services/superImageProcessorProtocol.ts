import type { SplitterSharedRegion } from './appSettings';
import type { WatermarkSelectionPreset } from './watermarkRemoval';

export interface SuperImageProcessorTaskPayload {
  frameBuffer: ArrayBuffer;
  mimeType: string;
  filename: string;
  sharedRegion?: SplitterSharedRegion | null;
  watermarkEnabled: boolean;
  watermarkSelectionPreset?: WatermarkSelectionPreset | null;
}

export interface SuperImageProcessorTaskMessage {
  type: 'process';
  id: number;
  payload: SuperImageProcessorTaskPayload;
}

export interface SuperImageProcessorSuccessPayload {
  kind: 'success';
  title: string;
  diffCount: number;
  puzzleBuffer: ArrayBuffer;
  diffBuffer: ArrayBuffer;
  watermarkApplied: boolean;
}

export interface SuperImageProcessorSkipPayload {
  kind: 'skip';
  warning: string;
}

export interface SuperImageProcessorErrorPayload {
  kind: 'error';
  warning: string;
}

export type SuperImageProcessorResultPayload =
  | SuperImageProcessorSuccessPayload
  | SuperImageProcessorSkipPayload
  | SuperImageProcessorErrorPayload;

export interface SuperImageProcessorResultMessage {
  type: 'result';
  id: number;
  payload: SuperImageProcessorResultPayload;
}

export interface SuperImageProcessorCrashMessage {
  type: 'crash';
  id: number;
  message: string;
}

export type SuperImageProcessorWorkerRequest = SuperImageProcessorTaskMessage;
export type SuperImageProcessorWorkerResponse =
  | SuperImageProcessorResultMessage
  | SuperImageProcessorCrashMessage;
