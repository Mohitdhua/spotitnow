import type { Puzzle, VideoModeTransferFrame, VideoSettings } from '../types';

const TRANSFER_FRAME_SIZE: Record<VideoSettings['aspectRatio'], { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 }
};

const loadImageForTransfer = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load transfer image.'));
    image.src = src;
  });

const drawContain = (
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number
) => {
  const sourceWidth = Math.max(1, image.naturalWidth);
  const sourceHeight = Math.max(1, image.naturalHeight);
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const drawX = x + (width - drawWidth) / 2;
  const drawY = y + (height - drawHeight) / 2;
  ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
};

export const createSideBySideTransferFrame = async (
  puzzle: Puzzle,
  aspectRatio: VideoSettings['aspectRatio']
): Promise<string> => {
  const [originalImage, modifiedImage] = await Promise.all([
    loadImageForTransfer(puzzle.imageA),
    loadImageForTransfer(puzzle.imageB)
  ]);
  const size = TRANSFER_FRAME_SIZE[aspectRatio];
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to create transfer frame canvas.');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size.width, size.height);

  const padding = Math.round(size.width * 0.008);
  const gap = Math.round(size.width * 0.008);
  const panelWidth = Math.max(1, (size.width - padding * 2 - gap) / 2);
  const panelHeight = Math.max(1, size.height - padding * 2);
  const leftX = padding;
  const rightX = leftX + panelWidth + gap;
  const topY = padding;

  ctx.fillStyle = '#f1f5f9';
  ctx.fillRect(leftX, topY, panelWidth, panelHeight);
  ctx.fillRect(rightX, topY, panelWidth, panelHeight);
  drawContain(ctx, originalImage, leftX, topY, panelWidth, panelHeight);
  drawContain(ctx, modifiedImage, rightX, topY, panelWidth, panelHeight);

  ctx.strokeStyle = '#000000';
  ctx.lineWidth = Math.max(2, Math.round(size.width * 0.002));
  ctx.strokeRect(leftX, topY, panelWidth, panelHeight);
  ctx.strokeRect(rightX, topY, panelWidth, panelHeight);

  return canvas.toDataURL('image/png');
};

export const createVideoTransferFrames = async (
  puzzles: Puzzle[],
  settings: Pick<VideoSettings, 'aspectRatio' | 'showDuration' | 'revealDuration' | 'transitionDuration'>
): Promise<VideoModeTransferFrame[]> => {
  const showDurationSeconds = Math.max(0.1, settings.showDuration);
  const revealDurationSeconds = Math.max(0.5, settings.revealDuration);
  const transitionDurationSeconds = Math.max(0, settings.transitionDuration);
  let timelineCursorMs = 0;

  const frames: VideoModeTransferFrame[] = [];
  for (let index = 0; index < puzzles.length; index += 1) {
    const item = puzzles[index];
    const clipDurationSeconds =
      showDurationSeconds +
      revealDurationSeconds +
      (index < puzzles.length - 1 ? transitionDurationSeconds : 0);
    const title = (item.title || '').trim() || `Puzzle ${index + 1}`;
    let compositeImage = item.imageB;
    try {
      compositeImage = await createSideBySideTransferFrame(item, settings.aspectRatio);
    } catch {
      // Fall back to the modified image when transfer composition fails.
    }

    frames.push({
      id: `video-mode-frame-${Date.now()}-${index}`,
      clipId: `puzzle-${index + 1}`,
      name: `${title}.png`,
      image: compositeImage,
      frame: index,
      timeMs: Math.round(timelineCursorMs),
      durationMs: Math.max(100, Math.round(clipDurationSeconds * 1000)),
      position: {
        x: 0,
        y: 0,
        width: 1,
        height: 1
      },
      rotation: 0,
      scale: 1
    });
    timelineCursorMs += clipDurationSeconds * 1000;
  }

  return frames;
};
