import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';

interface ParsedTimestamp {
  seconds: number;
  display: string;
}

interface ExtractFramesSummary {
  extractedCount: number;
  skippedCount: number;
  failedCount: number;
  warnings: string[];
}

interface WorkerStartMessage {
  type: 'start';
  payload: {
    videos: File[];
    timestamps: ParsedTimestamp[];
    format: 'jpeg' | 'png';
    jpegQuality: number;
  };
}

interface WorkerCancelMessage {
  type: 'cancel';
}

interface WorkerResumeMessage {
  type: 'resume';
}

type WorkerMessage = WorkerStartMessage | WorkerCancelMessage | WorkerResumeMessage;

type WorkerResponse =
  | { type: 'progress'; completed: number; total: number; label: string }
  | { type: 'file'; filename: string; mimeType: string; buffer: ArrayBuffer }
  | { type: 'done'; summary: ExtractFramesSummary }
  | { type: 'cancelled' }
  | { type: 'error'; message: string };

let isCanceled = false;
let pendingResumeResolver: (() => void) | null = null;

const postToMain = (message: WorkerResponse, transfer: Transferable[] = []) => {
  (self as any).postMessage(message, transfer);
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const throwIfCanceled = () => {
  if (isCanceled) {
    throw new Error('__FRAME_EXTRACTOR_CANCELED__');
  }
};

const waitForResume = () =>
  new Promise<void>((resolve) => {
    if (isCanceled) {
      resolve();
      return;
    }
    pendingResumeResolver = resolve;
  });

const resolvePendingResume = () => {
  pendingResumeResolver?.();
  pendingResumeResolver = null;
};

const pad = (value: number, length = 2) => String(value).padStart(length, '0');

const formatTimestampDisplay = (secondsInput: number): string => {
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

const formatTimestampForFilename = (seconds: number): string => formatTimestampDisplay(seconds).replace(/[:.]/g, '-');

const stripExtension = (filename: string): string => filename.replace(/\.[^/.]+$/, '');

const sanitizeFilenameSegment = (value: string): string =>
  value
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

const extractFramesInWorker = async ({
  videos,
  timestamps,
  format,
  jpegQuality
}: WorkerStartMessage['payload']) => {
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
  const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const total = videos.length * timestamps.length;
  let completed = 0;
  const baseNameCounter = new Map<string, number>();

  for (const file of videos) {
    throwIfCanceled();
    const rawBaseName = sanitizeFilenameSegment(stripExtension(file.name)) || 'video';
    const duplicateIndex = baseNameCounter.get(rawBaseName) || 0;
    baseNameCounter.set(rawBaseName, duplicateIndex + 1);
    const baseName = duplicateIndex ? `${rawBaseName}_${duplicateIndex + 1}` : rawBaseName;

    try {
      const input = new Input({
        source: new BlobSource(file),
        formats: ALL_FORMATS
      });
      const track = await input.getPrimaryVideoTrack();
      if (!track) {
        throw new Error('No video track found.');
      }

      const sink = new CanvasSink(track, { alpha: true });
      let durationSeconds = 0;
      try {
        durationSeconds = await track.computeDuration();
      } catch {
        durationSeconds = 0;
      }

      for (const timestamp of timestamps) {
        throwIfCanceled();
        const hasKnownDuration = Number.isFinite(durationSeconds) && durationSeconds > 0;
        const isOutOfRange = hasKnownDuration && timestamp.seconds > durationSeconds;

        if (isOutOfRange) {
          summary.skippedCount += 1;
          summary.warnings.push(
            `${file.name}: skipped ${timestamp.display} (video duration ${formatTimestampDisplay(durationSeconds)}).`
          );
        } else {
          try {
            const safeTimestamp = hasKnownDuration
              ? clamp(timestamp.seconds, 0, Math.max(0, durationSeconds - 0.001))
              : Math.max(0, timestamp.seconds);
            const wrapped = await sink.getCanvas(safeTimestamp);
            const sourceCanvas = (wrapped?.canvas as OffscreenCanvas | undefined) ?? null;
            if (!sourceCanvas) {
              throw new Error('Unable to decode the requested frame in the worker.');
            }

            const exportCanvas = new OffscreenCanvas(
              Math.max(1, sourceCanvas.width || 1),
              Math.max(1, sourceCanvas.height || 1)
            );
            const ctx = exportCanvas.getContext('2d');
            if (!ctx) {
              throw new Error('Unable to prepare worker frame canvas.');
            }

            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(sourceCanvas, 0, 0, exportCanvas.width, exportCanvas.height);

            const blob = await exportCanvas.convertToBlob({
              type: mimeType,
              quality: format === 'jpeg' ? clamp(jpegQuality, 0.5, 1) : undefined
            });
            const buffer = await blob.arrayBuffer();

            postToMain(
              {
                type: 'file',
                filename: `${baseName}_frame_${formatTimestampForFilename(timestamp.seconds)}.${extension}`,
                mimeType: blob.type || mimeType,
                buffer
              },
              [buffer]
            );
            summary.extractedCount += 1;
            await waitForResume();
            throwIfCanceled();
          } catch (error) {
            summary.failedCount += 1;
            const message = error instanceof Error ? error.message : 'Unknown extraction error.';
            summary.warnings.push(`${file.name}: failed ${timestamp.display} (${message})`);
          }
        }

        completed += 1;
        postToMain({
          type: 'progress',
          completed,
          total,
          label: `Extracting ${completed}/${total}: ${file.name}`
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown extraction error.';
      for (const timestamp of timestamps) {
        summary.failedCount += 1;
        summary.warnings.push(`${file.name}: failed ${timestamp.display} (${message})`);
        completed += 1;
        postToMain({
          type: 'progress',
          completed,
          total,
          label: `Extracting ${completed}/${total}: ${file.name}`
        });
      }
    }
  }

  if (summary.extractedCount === 0) {
    throw new Error('No frames were extracted. Check timestamps against video durations.');
  }

  postToMain({
    type: 'done',
    summary
  });
};

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;

  if (message.type === 'cancel') {
    isCanceled = true;
    resolvePendingResume();
    return;
  }

  if (message.type === 'resume') {
    resolvePendingResume();
    return;
  }

  if (message.type !== 'start') return;
  isCanceled = false;

  try {
    await extractFramesInWorker(message.payload);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Frame extraction failed.';
    if (errorMessage === '__FRAME_EXTRACTOR_CANCELED__' || isCanceled) {
      postToMain({ type: 'cancelled' });
    } else {
      postToMain({ type: 'error', message: errorMessage });
    }
  } finally {
    isCanceled = false;
  }
};
