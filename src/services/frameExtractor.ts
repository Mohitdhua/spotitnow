import { mediaDiagnosticsStore, type MediaJobController } from './mediaDiagnostics';
import type { MediaTaskEventMessage, MediaWorkerStatsMessage } from './mediaTelemetry';

export interface ParsedTimestamp {
  seconds: number;
  display: string;
}

export interface ParsedTimestampResult {
  timestamps: ParsedTimestamp[];
  invalidTokens: string[];
}

export interface VideoFileMetadata {
  durationSeconds: number;
  width: number;
  height: number;
}

export interface ExtractFramesProgress {
  completed: number;
  total: number;
  label: string;
}

export interface ExtractFramesSummary {
  extractedCount: number;
  skippedCount: number;
  failedCount: number;
  warnings: string[];
}

export interface ExtractedFrameFile {
  filename: string;
  blob: Blob;
  width: number;
  height: number;
  estimatedBytes: number;
}

export interface ExtractFramesResult {
  files: ExtractedFrameFile[];
  summary: ExtractFramesSummary;
}

interface ExtractFramesOptions {
  videos: File[];
  timestamps: ParsedTimestamp[];
  format: 'jpeg' | 'png';
  jpegQuality: number;
  onProgress?: (progress: ExtractFramesProgress) => void;
}

interface ExtractFrameDeliveryContext {
  completed: number;
  total: number;
}

interface ExtractFramesStreamOptions extends ExtractFramesOptions {
  onFrame: (file: ExtractedFrameFile, context: ExtractFrameDeliveryContext) => void | Promise<void>;
  signal?: AbortSignal;
  diagnosticsJob?: MediaJobController | null;
}

type FrameExtractorWorkerResponse =
  | { type: 'progress'; completed: number; total: number; label: string }
  | { type: 'file'; filename: string; mimeType: string; buffer: ArrayBuffer; width: number; height: number }
  | { type: 'done'; summary: ExtractFramesSummary }
  | { type: 'cancelled' }
  | { type: 'error'; message: string }
  | MediaTaskEventMessage
  | MediaWorkerStatsMessage;

type ExtractFramesInternalOptions = ExtractFramesOptions & {
  onFrame?: (file: ExtractedFrameFile, context: ExtractFrameDeliveryContext) => void | Promise<void>;
  collectFiles?: boolean;
  signal?: AbortSignal;
  diagnosticsJob?: MediaJobController | null;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const createFrameExtractionJob = () =>
  import.meta.env.DEV ? mediaDiagnosticsStore.startJob('frame_extract', 'Frame Extraction') : null;
const createCancellationError = () => new Error('Frame extraction canceled.');
const isCancellationError = (error: unknown) => error instanceof Error && error.message === 'Frame extraction canceled.';

const handleFrameWorkerDiagnostics = (job: MediaJobController | null, message: FrameExtractorWorkerResponse) => {
  if (!job) return false;
  if (message.type === 'task-event') {
    job.handleTaskEvent(message.event);
    return true;
  }
  if (message.type === 'stats') {
    job.updateWorkerStats(message.stats);
    return true;
  }
  return false;
};

const buildExtractedFrameFile = (
  filename: string,
  blob: Blob,
  width: number,
  height: number
): ExtractedFrameFile => ({
  filename,
  blob,
  width,
  height,
  estimatedBytes: Math.max(1, width) * Math.max(1, height) * 4
});

const pad = (value: number, length = 2) => String(value).padStart(length, '0');

const splitTimestampTokens = (input: string): string[] =>
  input
    .split(/[\n,;]+/g)
    .map((token) => token.trim())
    .filter(Boolean);

const parseTimestampToken = (token: string): number | null => {
  if (!token) return null;
  if (/^\d+(\.\d+)?$/.test(token)) {
    const seconds = Number(token);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
  }

  const parts = token.split(':').map((chunk) => chunk.trim());
  if (parts.length !== 2 && parts.length !== 3) return null;
  if (parts.some((chunk) => !/^\d+(\.\d+)?$/.test(chunk))) return null;

  if (parts.length === 2) {
    const minutes = Number(parts[0]);
    const seconds = Number(parts[1]);
    if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
    if (minutes < 0 || seconds < 0 || seconds >= 60) return null;
    return minutes * 60 + seconds;
  }

  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  const seconds = Number(parts[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  if (hours < 0 || minutes < 0 || minutes >= 60 || seconds < 0 || seconds >= 60) return null;
  return hours * 3600 + minutes * 60 + seconds;
};

export const formatTimestampDisplay = (secondsInput: number): string => {
  let safeSeconds = Math.max(0, secondsInput);
  let wholeSeconds = Math.floor(safeSeconds);
  let milliseconds = Math.round((safeSeconds - wholeSeconds) * 1000);

  if (milliseconds === 1000) {
    milliseconds = 0;
    wholeSeconds += 1;
    safeSeconds = wholeSeconds;
  }

  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const seconds = Math.floor(wholeSeconds % 60);

  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(milliseconds, 3)}`;
};

const formatTimestampForFilename = (seconds: number): string => {
  const display = formatTimestampDisplay(seconds);
  return display.replace(/[:.]/g, '-');
};

const stripExtension = (filename: string): string => filename.replace(/\.[^/.]+$/, '');

const sanitizeFilenameSegment = (value: string): string =>
  value
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

const createVideoElement = (url: string): HTMLVideoElement => {
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  return video;
};

const formatMediaErrorMessage = (video: HTMLVideoElement, fallback: string): string => {
  const mediaError = video.error;
  if (!mediaError) {
    return fallback;
  }

  const detail = mediaError.message?.trim();
  switch (mediaError.code) {
    case 1:
      return detail ? `Video loading was aborted. ${detail}` : 'Video loading was aborted.';
    case 2:
      return detail
        ? `The video file could not be loaded because of a network or file-read error. ${detail}`
        : 'The video file could not be loaded because of a network or file-read error.';
    case 3:
      return detail
        ? `The browser could read the video but failed to decode its frames. Try re-saving it as MP4 (H.264/AAC). ${detail}`
        : 'The browser could read the video but failed to decode its frames. Try re-saving it as MP4 (H.264/AAC).';
    case 4:
      return detail
        ? `This video format is not supported by the current browser. Try MP4 (H.264/AAC). ${detail}`
        : 'This video format is not supported by the current browser. Try MP4 (H.264/AAC).';
    default:
      return detail ? `${fallback} ${detail}` : fallback;
  }
};

const normalizeFrameExtractionErrorMessage = (error: unknown): string => {
  const fallback = error instanceof Error ? error.message : 'Frame extraction failed.';
  if (!fallback.trim()) {
    return 'Frame extraction failed.';
  }

  if (/decode|codec|unsupported|media_err_decode|source image could not be decoded/i.test(fallback)) {
    return `${fallback} Try re-saving the source as MP4 (H.264/AAC) or loading a different browser-compatible file.`;
  }

  return fallback;
};

const waitForLoadedMetadata = (video: HTMLVideoElement) =>
  new Promise<void>((resolve, reject) => {
    if (video.readyState >= 1) {
      resolve();
      return;
    }

    const cleanup = () => {
      video.removeEventListener('loadedmetadata', handleLoaded);
      video.removeEventListener('error', handleError);
    };

    const handleLoaded = () => {
      cleanup();
      resolve();
    };

    const handleError = () => {
      cleanup();
      reject(new Error(formatMediaErrorMessage(video, 'Failed to read video metadata.')));
    };

    video.addEventListener('loadedmetadata', handleLoaded);
    video.addEventListener('error', handleError);
  });

const getVideoMetadata = (video: HTMLVideoElement): VideoFileMetadata => {
  return {
    durationSeconds: Number.isFinite(video.duration) ? video.duration : 0,
    width: Math.max(1, video.videoWidth || 0),
    height: Math.max(1, video.videoHeight || 0)
  };
};

export const readVideoFileMetadata = async (file: File): Promise<VideoFileMetadata> => {
  const url = URL.createObjectURL(file);
  const video = createVideoElement(url);
  try {
    await waitForLoadedMetadata(video);
    return getVideoMetadata(video);
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
};

const loadVideoElementForExtraction = async (file: File) => {
  const url = URL.createObjectURL(file);
  const video = createVideoElement(url);
  await waitForLoadedMetadata(video);
  const metadata = getVideoMetadata(video);
  return { url, video, metadata };
};

const seekVideo = (video: HTMLVideoElement, targetSeconds: number) =>
  new Promise<void>((resolve, reject) => {
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      reject(new Error('Video duration is not available.'));
      return;
    }

    const safeTarget = clamp(targetSeconds, 0, Math.max(0, video.duration - 0.001));
    if (Math.abs(video.currentTime - safeTarget) < 0.0005 && video.readyState >= 2) {
      resolve();
      return;
    }

    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error('Timed out while seeking the requested frame.'));
    }, 12000);

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('error', handleError);
    };

    const handleSeeked = () => {
      cleanup();
      resolve();
    };

    const handleError = () => {
      cleanup();
      reject(new Error(formatMediaErrorMessage(video, 'Failed while seeking video.')));
    };

    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('error', handleError);
    try {
      video.currentTime = safeTarget;
    } catch (error) {
      cleanup();
      reject(error instanceof Error ? error : new Error('Unable to seek to requested timestamp.'));
    }
  });

const captureCurrentFrame = (
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  format: 'jpeg' | 'png',
  jpegQuality: number
) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.width = Math.max(1, video.videoWidth || 1);
    canvas.height = Math.max(1, video.videoHeight || 1);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('Unable to prepare frame canvas.'));
      return;
    }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    const quality = format === 'jpeg' ? clamp(jpegQuality, 0.1, 1) : undefined;
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Failed to encode extracted frame.'));
          return;
        }
        resolve(blob);
      },
      mimeType,
      quality
    );
  });

export const parseTimestampInput = (input: string): ParsedTimestampResult => {
  const tokens = splitTimestampTokens(input);
  const timestamps: ParsedTimestamp[] = [];
  const invalidTokens: string[] = [];
  const dedupe = new Set<number>();

  for (const token of tokens) {
    const parsed = parseTimestampToken(token);
    if (parsed === null) {
      invalidTokens.push(token);
      continue;
    }
    const roundedMs = Math.round(parsed * 1000);
    if (dedupe.has(roundedMs)) continue;
    dedupe.add(roundedMs);
    const seconds = roundedMs / 1000;
    timestamps.push({
      seconds,
      display: formatTimestampDisplay(seconds)
    });
  }

  return { timestamps, invalidTokens };
};

const extractFramesOnMainThread = async ({
  videos,
  timestamps,
  format,
  jpegQuality,
  onProgress,
  onFrame,
  collectFiles = true,
  signal,
  diagnosticsJob
}: ExtractFramesInternalOptions): Promise<ExtractFramesResult> => {
  const summary: ExtractFramesSummary = {
    extractedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    warnings: []
  };

  if (!videos.length) {
    throw new Error('Add at least one video.');
  }
  if (!timestamps.length) {
    throw new Error('Add at least one valid timestamp.');
  }

  const extension = format === 'jpeg' ? 'jpg' : 'png';
  const total = videos.length * timestamps.length;
  let completed = 0;
  const baseNameCounter = new Map<string, number>();
  const files: ExtractedFrameFile[] = [];
  const job = diagnosticsJob;
  const startedAt = performance.now();
  let completedTasks = 0;
  let totalTaskDurationMs = 0;

  const emitMainThreadStats = (runningTasks: number) => {
    if (!job) return;
    const elapsedSeconds = Math.max(0.001, (performance.now() - startedAt) / 1000);
    job.updateWorkerStats({
      workerId: 'frame-extractor-main',
      label: 'Frame Extractor (Main Thread)',
      runtimeKind: 'worker',
      activeWorkers: 1,
      queueSize: Math.max(0, total - completed - runningTasks),
      runningTasks,
      avgTaskMs: completedTasks > 0 ? totalTaskDurationMs / completedTasks : 0,
      fps: completedTasks / elapsedSeconds,
      bytesInFlight: 0,
      stageQueueDepths: {
        decode: Math.max(0, total - completed - runningTasks)
      },
      metrics: {
        extracted: summary.extractedCount,
        skipped: summary.skippedCount,
        failed: summary.failedCount
      }
    });
  };

  for (const file of videos) {
    if (signal?.aborted) {
      throw createCancellationError();
    }
    const rawBaseName = sanitizeFilenameSegment(stripExtension(file.name)) || 'video';
    const duplicateIndex = baseNameCounter.get(rawBaseName) || 0;
    baseNameCounter.set(rawBaseName, duplicateIndex + 1);
    const baseName = duplicateIndex ? `${rawBaseName}_${duplicateIndex + 1}` : rawBaseName;

    let loadedVideo: HTMLVideoElement | null = null;
    let loadedUrl = '';
    let metadata: VideoFileMetadata | null = null;
    const canvas = document.createElement('canvas');

    try {
      const loaded = await loadVideoElementForExtraction(file);
      loadedVideo = loaded.video;
      loadedUrl = loaded.url;
      metadata = loaded.metadata;

      for (const timestamp of timestamps) {
        if (signal?.aborted) {
          throw createCancellationError();
        }
        const taskId = `${baseName}:${timestamp.display}`;
        const taskLabel = `Decode ${file.name} @ ${timestamp.display}`;
        const isOutOfRange = timestamp.seconds > metadata.durationSeconds;
        if (isOutOfRange) {
          summary.skippedCount += 1;
          summary.warnings.push(
            `${file.name}: skipped ${timestamp.display} (video duration ${formatTimestampDisplay(metadata.durationSeconds)}).`
          );
        } else {
          const taskStart = performance.now();
          job?.handleTaskEvent({
            taskId,
            label: taskLabel,
            stage: 'decode',
            state: 'running',
            workerId: 'frame-extractor-main'
          });
          emitMainThreadStats(1);
          try {
            await seekVideo(loadedVideo, timestamp.seconds);
            const blob = await captureCurrentFrame(loadedVideo, canvas, format, jpegQuality);
            const extractedFile = buildExtractedFrameFile(
              `${baseName}_frame_${formatTimestampForFilename(timestamp.seconds)}.${extension}`,
              blob,
              canvas.width,
              canvas.height
            );
            if (collectFiles) {
              files.push(extractedFile);
            }
            if (onFrame) {
              await onFrame(extractedFile, {
                completed: completed + 1,
                total
              });
            }
            summary.extractedCount += 1;
            completedTasks += 1;
            totalTaskDurationMs += Math.max(0, performance.now() - taskStart);
            job?.handleTaskEvent({
              taskId,
              label: taskLabel,
              stage: 'decode',
              state: 'done',
              workerId: 'frame-extractor-main',
              durationMs: Math.max(0, performance.now() - taskStart),
              bytes: extractedFile.estimatedBytes
            });
          } catch (error) {
            if (isCancellationError(error)) {
              throw error;
            }
            summary.failedCount += 1;
            const message = error instanceof Error ? error.message : 'Unknown extraction error.';
            summary.warnings.push(`${file.name}: failed ${timestamp.display} (${message})`);
            completedTasks += 1;
            totalTaskDurationMs += Math.max(0, performance.now() - taskStart);
            job?.handleTaskEvent({
              taskId,
              label: taskLabel,
              stage: 'decode',
              state: 'failed',
              workerId: 'frame-extractor-main',
              durationMs: Math.max(0, performance.now() - taskStart),
              meta: {
                message
              }
            });
          } finally {
            emitMainThreadStats(0);
          }
        }

        completed += 1;
        onProgress?.({
          completed,
          total,
          label: `Extracting ${completed}/${total}: ${file.name}`
        });
        job?.setProgress(total > 0 ? completed / total : 0, `Extracting ${completed}/${total}: ${file.name}`);
      }
    } finally {
      if (loadedVideo) {
        loadedVideo.pause();
        loadedVideo.removeAttribute('src');
        loadedVideo.load();
      }
      if (loadedUrl) {
        URL.revokeObjectURL(loadedUrl);
      }
    }
  }

  if (summary.extractedCount === 0) {
    throw new Error('No frames were extracted. Check timestamps against video durations.');
  }

  return {
    files,
    summary
  };
};

const extractFramesInWorker = async ({
  videos,
  timestamps,
  format,
  jpegQuality,
  onProgress,
  onFrame,
  collectFiles = true,
  signal,
  diagnosticsJob
}: ExtractFramesInternalOptions): Promise<ExtractFramesResult> => {
  return await new Promise<ExtractFramesResult>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createCancellationError());
      return;
    }
    const worker = new Worker(new URL('../workers/frameExtractor.worker.ts', import.meta.url), {
      type: 'module'
    });
    const files: ExtractedFrameFile[] = [];
    let deliveredCount = 0;
    let isSettled = false;
    const job = diagnosticsJob;

    const cleanup = () => {
      worker.terminate();
      job?.removeWorkerStats('frame-extractor-worker');
      if (signal) {
        signal.removeEventListener('abort', handleAbort);
      }
    };

    const handleAbort = () => {
      if (isSettled) return;
      worker.postMessage({ type: 'cancel' });
    };

    if (signal) {
      signal.addEventListener('abort', handleAbort, { once: true });
    }

    worker.onmessage = (event: MessageEvent<FrameExtractorWorkerResponse>) => {
      const message = event.data;
      if (handleFrameWorkerDiagnostics(job, message)) {
        return;
      }

      if (message.type === 'progress') {
        onProgress?.({
          completed: message.completed,
          total: message.total,
          label: message.label
        });
        job?.setProgress(message.total > 0 ? message.completed / message.total : 0, message.label);
        return;
      }

      if (message.type === 'file') {
        const extractedFile = buildExtractedFrameFile(
          message.filename,
          new Blob([message.buffer], { type: message.mimeType }),
          message.width,
          message.height
        );
        if (collectFiles) {
          files.push(extractedFile);
        }
        deliveredCount += 1;
        void (async () => {
          try {
            if (onFrame) {
              await onFrame(extractedFile, {
                completed: deliveredCount,
                total: videos.length * timestamps.length
              });
            }
            if (!isSettled && !signal?.aborted) {
              worker.postMessage({ type: 'resume' });
            }
          } catch (error) {
            if (isSettled) return;
            isSettled = true;
            cleanup();
            reject(error instanceof Error ? error : new Error('Frame extraction callback failed.'));
          }
        })();
        return;
      }

      if (message.type === 'done') {
        isSettled = true;
        cleanup();
        resolve({
          files,
          summary: message.summary
        });
        return;
      }

      if (message.type === 'cancelled') {
        isSettled = true;
        cleanup();
        reject(createCancellationError());
        return;
      }

      if (message.type === 'error') {
        isSettled = true;
        cleanup();
        reject(new Error(message.message));
      }
    };

    worker.onerror = (event) => {
      isSettled = true;
      cleanup();
      const detail = event.message ? ` ${event.message}` : '';
      reject(new Error(`Frame extractor worker crashed.${detail}`));
    };

    worker.postMessage({
      type: 'start',
      payload: {
        videos,
        timestamps,
        format,
        jpegQuality,
        jobId: job?.jobId
      }
    });
  });
};

export const extractFrames = async (options: ExtractFramesOptions): Promise<ExtractFramesResult> => {
  const diagnosticsJob = createFrameExtractionJob();

  if (typeof Worker === 'undefined') {
    try {
      const result = await extractFramesOnMainThread({
        ...options,
        diagnosticsJob
      });
      diagnosticsJob?.complete('Frame extraction complete');
      return result;
    } catch (error) {
      if (isCancellationError(error)) {
        diagnosticsJob?.cancel('Frame extraction canceled');
      } else {
        diagnosticsJob?.fail(normalizeFrameExtractionErrorMessage(error), 'Frame extraction failed');
      }
      throw error;
    }
  }

  try {
    const result = await extractFramesInWorker({
      ...options,
      diagnosticsJob
    });
    diagnosticsJob?.complete('Frame extraction complete');
    return result;
  } catch (error) {
    if (isCancellationError(error)) {
      diagnosticsJob?.cancel('Frame extraction canceled');
      throw error;
    }
    console.warn('Falling back to main-thread frame extraction.', error);
    try {
      const result = await extractFramesOnMainThread({
        ...options,
        diagnosticsJob
      });
      diagnosticsJob?.complete('Frame extraction complete');
      return result;
    } catch (fallbackError) {
      if (isCancellationError(fallbackError)) {
        diagnosticsJob?.cancel('Frame extraction canceled');
      } else {
        diagnosticsJob?.fail(
          normalizeFrameExtractionErrorMessage(fallbackError),
          'Frame extraction failed'
        );
      }
      throw new Error(normalizeFrameExtractionErrorMessage(fallbackError));
    }
  }
};

export const extractFramesStream = async ({
  onFrame,
  ...options
}: ExtractFramesStreamOptions): Promise<ExtractFramesSummary> => {
  const diagnosticsJob = options.diagnosticsJob ?? null;
  if (typeof Worker === 'undefined') {
    const result = await extractFramesOnMainThread({
      ...options,
      onFrame,
      collectFiles: false,
      diagnosticsJob
    });
    return result.summary;
  }

  try {
    const result = await extractFramesInWorker({
      ...options,
      onFrame,
      collectFiles: false,
      diagnosticsJob
    });
    return result.summary;
  } catch (error) {
    if (isCancellationError(error)) {
      throw error;
    }
    console.warn('Falling back to main-thread streamed frame extraction.', error);
    try {
      const result = await extractFramesOnMainThread({
        ...options,
        onFrame,
        collectFiles: false,
        diagnosticsJob
      });
      return result.summary;
    } catch (fallbackError) {
      throw new Error(normalizeFrameExtractionErrorMessage(fallbackError));
    }
  }
};
