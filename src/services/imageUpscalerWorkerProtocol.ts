import type { ImageUpscaleAiModel } from './imageUpscaler';

export interface ImageUpscalerAiWorkerProcessPayload {
  imageBuffer: ArrayBuffer;
  mimeType: string;
  aiModel: ImageUpscaleAiModel;
  scaleFactor: 2 | 4;
  useAiDeblur: boolean;
}

export interface ImageUpscalerAiWorkerProcessMessage {
  type: 'process';
  id: number;
  payload: ImageUpscalerAiWorkerProcessPayload;
}

export interface ImageUpscalerAiWorkerProgressMessage {
  type: 'progress';
  id: number;
  progress: number;
  label: string;
}

export interface ImageUpscalerAiWorkerResultMessage {
  type: 'result';
  id: number;
  payload: {
    imageBuffer: ArrayBuffer;
    mimeType: string;
    width: number;
    height: number;
    deblurScaleApplied: number;
  };
}

export interface ImageUpscalerAiWorkerErrorMessage {
  type: 'error';
  id: number;
  message: string;
}

export type ImageUpscalerAiWorkerRequest = ImageUpscalerAiWorkerProcessMessage;
export type ImageUpscalerAiWorkerResponse =
  | ImageUpscalerAiWorkerProgressMessage
  | ImageUpscalerAiWorkerResultMessage
  | ImageUpscalerAiWorkerErrorMessage;
