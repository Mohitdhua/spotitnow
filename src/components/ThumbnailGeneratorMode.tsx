import { ArrowLeft, ChevronLeft, ChevronRight, Download, FileText, Image as ImageIcon, RefreshCw, Upload, Wand2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { notifyError, notifySuccess } from '../services/notifications';
import type { Puzzle } from '../types';

type ThumbnailStyleId = 'challenge_banner' | 'sharp_eyes' | 'minimalist' | 'brutalist';
type ThumbnailExportQualityId = '720p' | '1080p' | '1440p' | '4k';

interface ThumbnailGeneratorModeProps {
  currentPuzzle: Puzzle | null;
  batch: Puzzle[];
  onBack: () => void;
}

interface ThumbnailStylePreset {
  id: ThumbnailStyleId;
  label: string;
  description: string;
  defaultHeadline: string;
  accentStart: string;
  accentEnd: string;
}

interface ImageSlotState {
  src: string | null;
  name: string;
  source: 'empty' | 'upload' | 'workspace';
}

interface PanelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ThumbnailLayoutControls {
  panelGap: number;
  sideInset: number;
  bottomInset: number;
  borderWidth: number;
  cornerRadius: number;
  imageFit: 'cover' | 'contain';
  imageZoom: number;
  imageOffsetX: number;
  imageOffsetY: number;
}

interface ThumbnailExportPreset {
  id: ThumbnailExportQualityId;
  label: string;
  width: number;
  height: number;
}

const THUMBNAIL_WIDTH = 1280;
const THUMBNAIL_HEIGHT = 720;
const EMPTY_SLOT: ImageSlotState = { src: null, name: '', source: 'empty' };
const DEFAULT_LAYOUT_CONTROLS: ThumbnailLayoutControls = {
  panelGap: 5,
  sideInset: 16,
  bottomInset: 8,
  borderWidth: 6,
  cornerRadius: 28,
  imageFit: 'contain',
  imageZoom: 1,
  imageOffsetX: 0,
  imageOffsetY: 0
};
const EXPORT_QUALITY_PRESETS: Record<ThumbnailExportQualityId, ThumbnailExportPreset> = {
  '720p': {
    id: '720p',
    label: '720p',
    width: 1280,
    height: 720
  },
  '1080p': {
    id: '1080p',
    label: '1080p',
    width: 1920,
    height: 1080
  },
  '1440p': {
    id: '1440p',
    label: '1440p',
    width: 2560,
    height: 1440
  },
  '4k': {
    id: '4k',
    label: '4K',
    width: 3840,
    height: 2160
  }
};
const EXPORT_QUALITY_ORDER: ThumbnailExportQualityId[] = ['720p', '1080p', '1440p', '4k'];

const STYLE_PRESETS: Record<ThumbnailStyleId, ThumbnailStylePreset> = {
  challenge_banner: {
    id: 'challenge_banner',
    label: 'Challenge Banner',
    description: 'Black headline strip, louder contrast, and game-show energy like your first sample.',
    defaultHeadline: 'Visual Challenge',
    accentStart: '#00F57A',
    accentEnd: '#FFE60D'
  },
  sharp_eyes: {
    id: 'sharp_eyes',
    label: 'Sharp Eyes',
    description: 'Cleaner yellow field, giant outlined text, and a simpler poster feel like your second sample.',
    defaultHeadline: 'Sharp Eyes',
    accentStart: '#FFFFFF',
    accentEnd: '#FFF7BF'
  },
  minimalist: {
    id: 'minimalist',
    label: 'Minimalist',
    description: 'Editorial spacing, quiet neutrals, and refined framing for a cleaner premium look.',
    defaultHeadline: 'Focus',
    accentStart: '#F8FAFC',
    accentEnd: '#CBD5E1'
  },
  brutalist: {
    id: 'brutalist',
    label: 'Raw Power',
    description: 'Heavy poster blocks, loud contrast, and thick shadows with a tougher thumbnail attitude.',
    defaultHeadline: 'RAW POWER',
    accentStart: '#F97316',
    accentEnd: '#111111'
  }
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(`Failed to read "${file.name}".`));
    reader.readAsDataURL(file);
  });

const readFileAsText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error(`Failed to read "${file.name}".`));
    reader.readAsText(file);
  });

const parseHeadlineEntries = (rawText: string) =>
  rawText
    .split(/[\n\r,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

const loadImageElement = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load image.'));
    image.src = src;
  });

const addRoundedRectPath = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) => {
  const safeRadius = clamp(radius, 0, Math.min(width, height) / 2);
  ctx.beginPath();
  if (safeRadius <= 0) {
    ctx.rect(x, y, width, height);
    return;
  }

  ctx.moveTo(x + safeRadius, y);
  ctx.arcTo(x + width, y, x + width, y + height, safeRadius);
  ctx.arcTo(x + width, y + height, x, y + height, safeRadius);
  ctx.arcTo(x, y + height, x, y, safeRadius);
  ctx.arcTo(x, y, x + width, y, safeRadius);
  ctx.closePath();
};

const drawImageFramed = (
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
  controls: Pick<ThumbnailLayoutControls, 'imageFit' | 'imageZoom' | 'imageOffsetX' | 'imageOffsetY'>
) => {
  const imageWidth = Math.max(1, image.naturalWidth || image.width);
  const imageHeight = Math.max(1, image.naturalHeight || image.height);
  const baseScale =
    controls.imageFit === 'contain'
      ? Math.min(width / imageWidth, height / imageHeight)
      : Math.max(width / imageWidth, height / imageHeight);
  const scale = baseScale * clamp(controls.imageZoom, 0.75, 2.4);
  const drawWidth = imageWidth * scale;
  const drawHeight = imageHeight * scale;
  const slackX = width - drawWidth;
  const slackY = height - drawHeight;
  const drawX = x + slackX / 2 + (clamp(controls.imageOffsetX, -100, 100) / 100) * (Math.abs(slackX) / 2);
  const drawY = y + slackY / 2 + (clamp(controls.imageOffsetY, -100, 100) / 100) * (Math.abs(slackY) / 2);
  ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
};

const fitFontSize = (
  ctx: CanvasRenderingContext2D,
  text: string,
  width: number,
  maxSize: number,
  minSize: number,
  fontFamily: string
) => {
  for (let size = maxSize; size >= minSize; size -= 2) {
    ctx.font = `900 ${size}px ${fontFamily}`;
    if (ctx.measureText(text).width <= width) {
      return size;
    }
  }

  return minSize;
};

const drawPlaceholderPanel = (
  ctx: CanvasRenderingContext2D,
  panel: PanelRect,
  title: string,
  body: string,
  accent: string
) => {
  const gradient = ctx.createLinearGradient(panel.x, panel.y, panel.x + panel.width, panel.y + panel.height);
  gradient.addColorStop(0, '#FFFFFF');
  gradient.addColorStop(1, '#E2E8F0');
  ctx.fillStyle = gradient;
  ctx.fillRect(panel.x, panel.y, panel.width, panel.height);

  ctx.strokeStyle = 'rgba(15,23,42,0.08)';
  ctx.lineWidth = 2;
  for (let offset = -panel.height; offset < panel.width; offset += 28) {
    ctx.beginPath();
    ctx.moveTo(panel.x + offset, panel.y);
    ctx.lineTo(panel.x + offset + panel.height, panel.y + panel.height);
    ctx.stroke();
  }

  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(panel.x + panel.width * 0.18, panel.y + panel.height * 0.2, Math.min(panel.width, panel.height) * 0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(panel.x + panel.width * 0.82, panel.y + panel.height * 0.78, Math.min(panel.width, panel.height) * 0.06, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#0F172A';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 30px Arial Black, Impact, sans-serif';
  ctx.fillText(title, panel.x + panel.width / 2, panel.y + panel.height / 2 - 18);
  ctx.font = '700 16px Arial, sans-serif';
  ctx.fillText(body, panel.x + panel.width / 2, panel.y + panel.height / 2 + 20);
};

const drawImagePanel = (
  ctx: CanvasRenderingContext2D,
  panel: PanelRect,
  image: HTMLImageElement | null,
  options: {
    radius: number;
    borderColor: string;
    borderWidth: number;
    background: string;
    shadowColor: string;
    placeholderTitle: string;
    placeholderBody: string;
    placeholderAccent: string;
    imageFit: ThumbnailLayoutControls['imageFit'];
    imageZoom: number;
    imageOffsetX: number;
    imageOffsetY: number;
  }
) => {
  ctx.save();
  ctx.shadowColor = options.shadowColor;
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 7;
  ctx.shadowOffsetY = 7;
  ctx.fillStyle = options.background;
  addRoundedRectPath(ctx, panel.x, panel.y, panel.width, panel.height, options.radius);
  ctx.fill();
  ctx.restore();

  ctx.save();
  addRoundedRectPath(ctx, panel.x, panel.y, panel.width, panel.height, options.radius);
  ctx.clip();
  ctx.fillStyle = options.background;
  ctx.fillRect(panel.x, panel.y, panel.width, panel.height);

  if (image) {
    drawImageFramed(ctx, image, panel.x, panel.y, panel.width, panel.height, {
      imageFit: options.imageFit,
      imageZoom: options.imageZoom,
      imageOffsetX: options.imageOffsetX,
      imageOffsetY: options.imageOffsetY
    });
  } else {
    drawPlaceholderPanel(ctx, panel, options.placeholderTitle, options.placeholderBody, options.placeholderAccent);
  }
  ctx.restore();

  ctx.save();
  ctx.lineWidth = options.borderWidth;
  ctx.strokeStyle = options.borderColor;
  addRoundedRectPath(ctx, panel.x, panel.y, panel.width, panel.height, options.radius);
  ctx.stroke();
  ctx.restore();
};

const renderFailureState = (
  ctx: CanvasRenderingContext2D,
  dimensions: { width: number; height: number } = { width: THUMBNAIL_WIDTH, height: THUMBNAIL_HEIGHT }
) => {
  const { width, height } = dimensions;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.restore();

  ctx.save();
  ctx.scale(width / THUMBNAIL_WIDTH, height / THUMBNAIL_HEIGHT);
  ctx.fillStyle = '#FFF7ED';
  ctx.fillRect(0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
  ctx.strokeStyle = '#111111';
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, THUMBNAIL_WIDTH - 8, THUMBNAIL_HEIGHT - 8);
  ctx.fillStyle = '#111111';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 52px Arial Black, Impact, sans-serif';
  ctx.fillText('Preview Failed', THUMBNAIL_WIDTH / 2, THUMBNAIL_HEIGHT / 2 - 28);
  ctx.font = '700 22px Arial, sans-serif';
  ctx.fillText('Try replacing the uploaded image and render again.', THUMBNAIL_WIDTH / 2, THUMBNAIL_HEIGHT / 2 + 24);
  ctx.restore();
};

const createSlotFromPuzzleImage = (src: string, fallbackName: string): ImageSlotState => ({
  src,
  name: fallbackName,
  source: 'workspace'
});

const sanitizeFileBaseName = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'thumbnail';

const findPuzzleIndex = (batch: Puzzle[], currentPuzzle: Puzzle | null) => {
  if (!currentPuzzle) return 0;
  const index = batch.findIndex(
    (item) => item.imageA === currentPuzzle.imageA && item.imageB === currentPuzzle.imageB
  );
  return index >= 0 ? index : 0;
};

const renderChallengeBanner = (
  ctx: CanvasRenderingContext2D,
  headline: string,
  puzzleImage: HTMLImageElement | null,
  diffImage: HTMLImageElement | null,
  controls: ThumbnailLayoutControls
) => {
  const background = ctx.createLinearGradient(0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
  background.addColorStop(0, '#FFE300');
  background.addColorStop(1, '#FFD218');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);

  ctx.fillStyle = '#0B1110';
  ctx.fillRect(0, 0, THUMBNAIL_WIDTH, 122);

  ctx.fillStyle = '#F8E110';
  ctx.fillRect(0, 122, THUMBNAIL_WIDTH, 8);

  const safeHeadline = (headline.trim() || STYLE_PRESETS.challenge_banner.defaultHeadline).toUpperCase();
  const fontSize = fitFontSize(
    ctx,
    safeHeadline,
    THUMBNAIL_WIDTH - 120,
    102,
    58,
    'Impact, Haettenschweiler, Arial Narrow Bold, sans-serif'
  );

  const textGradient = ctx.createLinearGradient(80, 0, THUMBNAIL_WIDTH - 80, 0);
  textGradient.addColorStop(0, '#00F57A');
  textGradient.addColorStop(0.55, '#AFFF12');
  textGradient.addColorStop(1, '#FFE60D');

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${fontSize}px Impact, Haettenschweiler, Arial Narrow Bold, sans-serif`;
  ctx.fillStyle = textGradient;
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 6;
  ctx.fillText(safeHeadline, THUMBNAIL_WIDTH / 2, 64);
  ctx.restore();

  const panelY = Math.max(130, Math.ceil(64 + fontSize * 0.5 + 5));
  const panelGap = clamp(controls.panelGap, 0, 48);
  const panelLeft = clamp(controls.sideInset, 0, 72);
  const panelWidth = (THUMBNAIL_WIDTH - panelLeft * 2 - panelGap) / 2;
  const panelHeight = THUMBNAIL_HEIGHT - panelY - clamp(controls.bottomInset, 0, 72);
  const panelBorderWidth = clamp(controls.borderWidth, 0, 24);
  const cornerRadius = clamp(controls.cornerRadius, 0, 60);

  drawImagePanel(
    ctx,
    { x: panelLeft, y: panelY, width: panelWidth, height: panelHeight },
    puzzleImage,
    {
      radius: cornerRadius,
      borderColor: '#111111',
      borderWidth: panelBorderWidth,
      background: '#FFF8D4',
      shadowColor: 'rgba(0,0,0,0.2)',
      placeholderTitle: 'PUZZLE IMAGE',
      placeholderBody: 'Upload the main puzzle side',
      placeholderAccent: '#22C55E',
      imageFit: controls.imageFit,
      imageZoom: controls.imageZoom,
      imageOffsetX: controls.imageOffsetX,
      imageOffsetY: controls.imageOffsetY
    }
  );

  drawImagePanel(
    ctx,
    { x: panelLeft + panelWidth + panelGap, y: panelY, width: panelWidth, height: panelHeight },
    diffImage,
    {
      radius: cornerRadius,
      borderColor: '#111111',
      borderWidth: panelBorderWidth,
      background: '#FFF8D4',
      shadowColor: 'rgba(0,0,0,0.2)',
      placeholderTitle: 'PUZZLE DIFF IMAGE',
      placeholderBody: 'Upload the answer side',
      placeholderAccent: '#FB7185',
      imageFit: controls.imageFit,
      imageZoom: controls.imageZoom,
      imageOffsetX: controls.imageOffsetX,
      imageOffsetY: controls.imageOffsetY
    }
  );

  ctx.lineWidth = Math.max(4, panelBorderWidth + 2);
  ctx.strokeStyle = '#111111';
  const outerInset = Math.max(2, ctx.lineWidth / 2);
  ctx.strokeRect(outerInset, outerInset, THUMBNAIL_WIDTH - outerInset * 2, THUMBNAIL_HEIGHT - outerInset * 2);
};

const renderSharpEyes = (
  ctx: CanvasRenderingContext2D,
  headline: string,
  puzzleImage: HTMLImageElement | null,
  diffImage: HTMLImageElement | null,
  controls: ThumbnailLayoutControls
) => {
  const background = ctx.createLinearGradient(0, 0, 0, THUMBNAIL_HEIGHT);
  background.addColorStop(0, '#FFE100');
  background.addColorStop(1, '#FFD31B');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);

  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath();
  ctx.ellipse(THUMBNAIL_WIDTH * 0.5, 84, 340, 48, 0, 0, Math.PI * 2);
  ctx.fill();

  const safeHeadline = (headline.trim() || STYLE_PRESETS.sharp_eyes.defaultHeadline).toUpperCase();
  const fontSize = fitFontSize(ctx, safeHeadline, THUMBNAIL_WIDTH - 120, 114, 64, 'Arial Black, Impact, sans-serif');

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${fontSize}px Arial Black, Impact, sans-serif`;
  ctx.lineJoin = 'round';
  ctx.lineWidth = 18;
  ctx.strokeStyle = '#050505';
  ctx.strokeText(safeHeadline, THUMBNAIL_WIDTH / 2, 84);
  const fillGradient = ctx.createLinearGradient(0, 30, 0, 130);
  fillGradient.addColorStop(0, '#FFFFFF');
  fillGradient.addColorStop(1, '#FFFDF2');
  ctx.fillStyle = fillGradient;
  ctx.fillText(safeHeadline, THUMBNAIL_WIDTH / 2, 84);
  ctx.restore();

  const panelY = Math.ceil(84 + fontSize * 0.5 + 5);
  const panelGap = clamp(controls.panelGap, 0, 48);
  const panelLeft = clamp(controls.sideInset, 0, 72);
  const panelWidth = (THUMBNAIL_WIDTH - panelLeft * 2 - panelGap) / 2;
  const panelHeight = THUMBNAIL_HEIGHT - panelY - clamp(controls.bottomInset, 0, 72);
  const panelBorderWidth = clamp(controls.borderWidth, 0, 24);
  const cornerRadius = clamp(controls.cornerRadius, 0, 60);

  drawImagePanel(
    ctx,
    { x: panelLeft, y: panelY, width: panelWidth, height: panelHeight },
    puzzleImage,
    {
      radius: cornerRadius,
      borderColor: '#111111',
      borderWidth: panelBorderWidth,
      background: '#DDF7FA',
      shadowColor: 'rgba(0,0,0,0.2)',
      placeholderTitle: 'PUZZLE IMAGE',
      placeholderBody: 'Load the puzzle side here',
      placeholderAccent: '#38BDF8',
      imageFit: controls.imageFit,
      imageZoom: controls.imageZoom,
      imageOffsetX: controls.imageOffsetX,
      imageOffsetY: controls.imageOffsetY
    }
  );

  drawImagePanel(
    ctx,
    { x: panelLeft + panelWidth + panelGap, y: panelY, width: panelWidth, height: panelHeight },
    diffImage,
    {
      radius: cornerRadius,
      borderColor: '#111111',
      borderWidth: panelBorderWidth,
      background: '#DDF7FA',
      shadowColor: 'rgba(0,0,0,0.2)',
      placeholderTitle: 'PUZZLE DIFF IMAGE',
      placeholderBody: 'Load the answer side here',
      placeholderAccent: '#F97316',
      imageFit: controls.imageFit,
      imageZoom: controls.imageZoom,
      imageOffsetX: controls.imageOffsetX,
      imageOffsetY: controls.imageOffsetY
    }
  );

  ctx.lineWidth = Math.max(4, panelBorderWidth + 2);
  ctx.strokeStyle = '#111111';
  const outerInset = Math.max(2, ctx.lineWidth / 2);
  ctx.strokeRect(outerInset, outerInset, THUMBNAIL_WIDTH - outerInset * 2, THUMBNAIL_HEIGHT - outerInset * 2);
};

const renderMinimalist = (
  ctx: CanvasRenderingContext2D,
  headline: string,
  puzzleImage: HTMLImageElement | null,
  diffImage: HTMLImageElement | null,
  controls: ThumbnailLayoutControls
) => {
  const background = ctx.createLinearGradient(0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
  background.addColorStop(0, '#F8FAFC');
  background.addColorStop(1, '#E2E8F0');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);

  const safeHeadline = (headline.trim() || STYLE_PRESETS.minimalist.defaultHeadline).toUpperCase();
  const fontSize = fitFontSize(ctx, safeHeadline, THUMBNAIL_WIDTH - 120, 94, 50, 'Arial Black, Arial, sans-serif');

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${fontSize}px Arial Black, Arial, sans-serif`;
  ctx.fillStyle = '#0F172A';
  ctx.shadowColor = 'rgba(15,23,42,0.1)';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 4;
  ctx.fillText(safeHeadline, THUMBNAIL_WIDTH / 2, 72);
  ctx.restore();

  const panelY = Math.max(126, Math.ceil(72 + fontSize * 0.5 + 5));
  const panelGap = clamp(controls.panelGap, 0, 48);
  const panelLeft = clamp(controls.sideInset, 0, 72);
  const panelWidth = (THUMBNAIL_WIDTH - panelLeft * 2 - panelGap) / 2;
  const panelHeight = THUMBNAIL_HEIGHT - panelY - clamp(controls.bottomInset, 0, 72);
  const panelBorderWidth = clamp(controls.borderWidth, 1, 8);
  const cornerRadius = clamp(controls.cornerRadius, 10, 28);

  drawImagePanel(
    ctx,
    { x: panelLeft, y: panelY, width: panelWidth, height: panelHeight },
    puzzleImage,
    {
      radius: cornerRadius,
      borderColor: '#334155',
      borderWidth: panelBorderWidth,
      background: '#FFFFFF',
      shadowColor: 'rgba(15,23,42,0.08)',
      placeholderTitle: 'PUZZLE',
      placeholderBody: 'Load the main puzzle side',
      placeholderAccent: '#94A3B8',
      imageFit: controls.imageFit,
      imageZoom: controls.imageZoom,
      imageOffsetX: controls.imageOffsetX,
      imageOffsetY: controls.imageOffsetY
    }
  );

  drawImagePanel(
    ctx,
    { x: panelLeft + panelWidth + panelGap, y: panelY, width: panelWidth, height: panelHeight },
    diffImage,
    {
      radius: cornerRadius,
      borderColor: '#334155',
      borderWidth: panelBorderWidth,
      background: '#FFFFFF',
      shadowColor: 'rgba(15,23,42,0.08)',
      placeholderTitle: 'ANSWER',
      placeholderBody: 'Load the answer side here',
      placeholderAccent: '#94A3B8',
      imageFit: controls.imageFit,
      imageZoom: controls.imageZoom,
      imageOffsetX: controls.imageOffsetX,
      imageOffsetY: controls.imageOffsetY
    }
  );

  ctx.lineWidth = Math.max(3, panelBorderWidth);
  ctx.strokeStyle = '#334155';
  const outerInset = Math.max(2, ctx.lineWidth / 2);
  ctx.strokeRect(outerInset, outerInset, THUMBNAIL_WIDTH - outerInset * 2, THUMBNAIL_HEIGHT - outerInset * 2);
};

const renderBrutalist = (
  ctx: CanvasRenderingContext2D,
  headline: string,
  puzzleImage: HTMLImageElement | null,
  diffImage: HTMLImageElement | null,
  controls: ThumbnailLayoutControls
) => {
  const background = ctx.createLinearGradient(0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
  background.addColorStop(0, '#1C1917');
  background.addColorStop(1, '#111111');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);

  ctx.fillStyle = '#FF7A00';
  ctx.fillRect(0, 0, THUMBNAIL_WIDTH, 10);

  const safeHeadline = (headline.trim() || STYLE_PRESETS.brutalist.defaultHeadline).toUpperCase();
  const fontSize = fitFontSize(ctx, safeHeadline, THUMBNAIL_WIDTH - 120, 100, 52, 'Impact, Arial Black, sans-serif');

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${fontSize}px Impact, Arial Black, sans-serif`;
  ctx.fillStyle = '#FF7A00';
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 6;
  ctx.fillText(safeHeadline, THUMBNAIL_WIDTH / 2, 76);
  ctx.restore();

  const panelY = Math.max(132, Math.ceil(76 + fontSize * 0.5 + 5));
  const panelGap = clamp(controls.panelGap, 0, 48);
  const panelLeft = clamp(controls.sideInset, 0, 72);
  const panelWidth = (THUMBNAIL_WIDTH - panelLeft * 2 - panelGap) / 2;
  const panelHeight = THUMBNAIL_HEIGHT - panelY - clamp(controls.bottomInset, 0, 72);
  const panelBorderWidth = clamp(controls.borderWidth + 2, 4, 14);
  const cornerRadius = clamp(controls.cornerRadius, 8, 24);

  drawImagePanel(
    ctx,
    { x: panelLeft, y: panelY, width: panelWidth, height: panelHeight },
    puzzleImage,
    {
      radius: cornerRadius,
      borderColor: '#FF7A00',
      borderWidth: panelBorderWidth,
      background: '#FFF4E5',
      shadowColor: 'rgba(0,0,0,0.42)',
      placeholderTitle: 'PUZZLE',
      placeholderBody: 'Load the main puzzle side',
      placeholderAccent: '#FF6B00',
      imageFit: controls.imageFit,
      imageZoom: controls.imageZoom,
      imageOffsetX: controls.imageOffsetX,
      imageOffsetY: controls.imageOffsetY
    }
  );

  drawImagePanel(
    ctx,
    { x: panelLeft + panelWidth + panelGap, y: panelY, width: panelWidth, height: panelHeight },
    diffImage,
    {
      radius: cornerRadius,
      borderColor: '#FF7A00',
      borderWidth: panelBorderWidth,
      background: '#FFF4E5',
      shadowColor: 'rgba(0,0,0,0.42)',
      placeholderTitle: 'ANSWER',
      placeholderBody: 'Load the answer side here',
      placeholderAccent: '#FFE45E',
      imageFit: controls.imageFit,
      imageZoom: controls.imageZoom,
      imageOffsetX: controls.imageOffsetX,
      imageOffsetY: controls.imageOffsetY
    }
  );

  ctx.lineWidth = Math.max(4, panelBorderWidth);
  ctx.strokeStyle = '#FFF4E5';
  const outerInset = Math.max(2, ctx.lineWidth / 2);
  ctx.strokeRect(outerInset, outerInset, THUMBNAIL_WIDTH - outerInset * 2, THUMBNAIL_HEIGHT - outerInset * 2);
};

const renderThumbnailScene = (
  ctx: CanvasRenderingContext2D,
  styleId: ThumbnailStyleId,
  headline: string,
  puzzleImage: HTMLImageElement | null,
  diffImage: HTMLImageElement | null,
  controls: ThumbnailLayoutControls,
  dimensions: { width: number; height: number } = { width: THUMBNAIL_WIDTH, height: THUMBNAIL_HEIGHT }
) => {
  const { width, height } = dimensions;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.restore();

  ctx.save();
  ctx.scale(width / THUMBNAIL_WIDTH, height / THUMBNAIL_HEIGHT);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (styleId === 'challenge_banner') {
    renderChallengeBanner(ctx, headline, puzzleImage, diffImage, controls);
  } else if (styleId === 'sharp_eyes') {
    renderSharpEyes(ctx, headline, puzzleImage, diffImage, controls);
  } else if (styleId === 'minimalist') {
    renderMinimalist(ctx, headline, puzzleImage, diffImage, controls);
  } else if (styleId === 'brutalist') {
    renderBrutalist(ctx, headline, puzzleImage, diffImage, controls);
  }
  ctx.restore();
};

const SlotPreview = ({
  title,
  subtitle,
  slot,
  onUpload,
  onClear,
  compact = false
}: {
  title: string;
  subtitle: string;
  slot: ImageSlotState;
  onUpload: () => void;
  onClear: () => void;
  compact?: boolean;
}) => (
  <div
    className={`border-black bg-white ${
      compact
        ? 'rounded-[22px] border-2 p-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]'
        : 'rounded-[26px] border-4 p-4 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]'
    }`}
  >
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">{subtitle}</div>
        <h3 className={`mt-2 font-black uppercase tracking-tight text-slate-900 ${compact ? 'text-lg' : 'text-xl'}`}>{title}</h3>
      </div>
      <div
        className={`rounded-full border-2 border-black px-3 py-1 text-[10px] font-black uppercase ${
          slot.source === 'workspace'
            ? 'bg-[#DBEAFE] text-slate-900'
            : slot.source === 'upload'
              ? 'bg-[#DCFCE7] text-slate-900'
              : 'bg-white text-slate-500'
        }`}
      >
        {slot.source === 'workspace' ? 'Selected Puzzle' : slot.source === 'upload' ? 'Uploaded' : 'Empty'}
      </div>
    </div>

    <div
      className={`mt-4 overflow-hidden border-black bg-[linear-gradient(145deg,#F8FAFC_0%,#E2E8F0_100%)] ${
        compact ? 'aspect-[16/10] rounded-[18px] border-2' : 'aspect-[4/3] rounded-[22px] border-4'
      }`}
    >
      {slot.src ? (
        <img src={slot.src} alt={title} className="h-full w-full object-contain" />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-center text-slate-500">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border-2 border-black bg-white text-slate-700">
            <ImageIcon size={24} strokeWidth={2.5} />
          </div>
          <div className="text-sm font-black uppercase tracking-wide text-slate-700">{title}</div>
          <div className="max-w-[14rem] text-xs font-semibold text-slate-500">{subtitle}</div>
        </div>
      )}
    </div>

    <div className={`mt-4 min-h-11 rounded-2xl border-2 border-black bg-[#FFFDF5] px-3 py-3 font-semibold text-slate-700 ${compact ? 'text-xs' : 'text-sm'}`}>
      {slot.name || 'No image selected yet.'}
    </div>

    <div className={`mt-4 gap-3 ${compact ? 'grid grid-cols-2' : 'flex flex-wrap'}`}>
      <button
        type="button"
        onClick={onUpload}
        className={`inline-flex items-center justify-center gap-2 rounded-xl border-2 border-black bg-[#FDE68A] px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-900 hover:bg-[#FCD34D] ${compact ? 'w-full' : ''}`}
      >
        <Upload size={14} strokeWidth={2.5} />
        {slot.src ? 'Replace Image' : 'Upload Image'}
      </button>
      <button
        type="button"
        onClick={onClear}
        disabled={!slot.src}
        className={`inline-flex items-center justify-center gap-2 rounded-xl border-2 border-black bg-white px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 ${compact ? 'w-full' : ''}`}
      >
        <X size={14} strokeWidth={2.5} />
        Clear
      </button>
    </div>
  </div>
);

const slotSourceMeta = (slot: ImageSlotState) => {
  if (slot.source === 'workspace') {
    return {
      label: 'Workspace',
      className: 'bg-[#DBEAFE] text-slate-900'
    };
  }

  if (slot.source === 'upload') {
    return {
      label: 'Override',
      className: 'bg-[#DCFCE7] text-slate-900'
    };
  }

  return {
    label: 'Empty',
    className: 'bg-white text-slate-500'
  };
};

const PairSelectionCard = ({
  title,
  subtitle,
  puzzleSlot,
  diffSlot,
  batchIndex,
  batchLength,
  onPrev,
  onNext,
  onLoadWorkspacePair,
  onSwap,
  compact = false
}: {
  title: string;
  subtitle: string;
  puzzleSlot: ImageSlotState;
  diffSlot: ImageSlotState;
  batchIndex: number;
  batchLength: number;
  onPrev: () => void;
  onNext: () => void;
  onLoadWorkspacePair: () => void;
  onSwap: () => void;
  compact?: boolean;
}) => {
  const puzzleMeta = slotSourceMeta(puzzleSlot);
  const diffMeta = slotSourceMeta(diffSlot);

  return (
    <section
      className={`border-black bg-white ${
        compact
          ? 'rounded-[22px] border-2 p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]'
          : 'rounded-[28px] border-4 p-5 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">{subtitle}</div>
          <h3 className={`mt-2 truncate font-black uppercase tracking-tight text-slate-900 ${compact ? 'text-lg' : 'text-2xl'}`}>{title}</h3>
        </div>
        <div className="shrink-0 rounded-full border-2 border-black bg-[#FFF7ED] px-3 py-1 text-[10px] font-black uppercase text-slate-900">
          {batchLength > 0 ? `${batchIndex + 1} / ${batchLength}` : 'Single'}
        </div>
      </div>

      <div className={`mt-4 ${compact ? 'grid grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] gap-2' : 'grid grid-cols-[3rem_minmax(0,1fr)_3rem] gap-3'}`}>
        <button
          type="button"
          onClick={onPrev}
          disabled={batchLength <= 1}
          className={`inline-flex items-center justify-center rounded-[14px] border-2 border-black ${
            compact ? 'h-10' : 'h-12'
          } ${batchLength <= 1 ? 'bg-slate-100 text-slate-400' : 'bg-white text-slate-900'}`}
        >
          <ChevronLeft size={compact ? 16 : 18} strokeWidth={2.8} />
        </button>
        <div className={`inline-flex min-w-0 items-center justify-center rounded-[14px] border-2 border-black bg-[#F8FAFC] px-3 text-center font-black uppercase text-slate-900 ${compact ? 'h-10 text-[10px] tracking-[0.14em]' : 'h-12 text-xs tracking-[0.18em]'}`}>
          Pair Selector
        </div>
        <button
          type="button"
          onClick={onNext}
          disabled={batchLength <= 1}
          className={`inline-flex items-center justify-center rounded-[14px] border-2 border-black ${
            compact ? 'h-10' : 'h-12'
          } ${batchLength <= 1 ? 'bg-slate-100 text-slate-400' : 'bg-white text-slate-900'}`}
        >
          <ChevronRight size={compact ? 16 : 18} strokeWidth={2.8} />
        </button>
      </div>

      <div className={`mt-4 grid grid-cols-2 ${compact ? 'gap-2' : 'gap-4'}`}>
        {[
          { label: 'Puzzle Image', slot: puzzleSlot, meta: puzzleMeta },
          { label: 'Diff Image', slot: diffSlot, meta: diffMeta }
        ].map(({ label, slot, meta }) => (
          <div key={label} className={`rounded-[18px] border-2 border-black bg-[#FFFDF5] p-2 ${compact ? '' : 'p-3'}`}>
            <div className="flex items-center justify-between gap-2">
              <div className={`font-black uppercase tracking-[0.14em] text-slate-900 ${compact ? 'text-[10px]' : 'text-xs'}`}>{label}</div>
              <div className={`rounded-full border-2 border-black px-2 py-1 text-[9px] font-black uppercase ${meta.className}`}>{meta.label}</div>
            </div>

            <div className={`mt-2 overflow-hidden rounded-[14px] border-2 border-black bg-[linear-gradient(145deg,#F8FAFC_0%,#E2E8F0_100%)] ${compact ? 'aspect-[4/3]' : 'aspect-[16/10]'}`}>
              {slot.src ? (
                <img src={slot.src} alt={label} className="h-full w-full object-contain" />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center text-slate-500">
                  <ImageIcon size={compact ? 18 : 22} strokeWidth={2.5} />
                  <div className={`font-black uppercase text-slate-700 ${compact ? 'text-[10px]' : 'text-xs'}`}>No Image</div>
                </div>
              )}
            </div>

            <div className={`mt-2 truncate rounded-xl border-2 border-black bg-white px-2 py-2 font-semibold text-slate-700 ${compact ? 'text-[10px]' : 'text-xs'}`}>
              {slot.name || 'No image selected yet.'}
            </div>
          </div>
        ))}
      </div>

      <div className={`mt-4 ${compact ? 'grid grid-cols-2 gap-2' : 'flex flex-wrap gap-3'}`}>
        <button
          type="button"
          onClick={onLoadWorkspacePair}
          className={`inline-flex items-center justify-center gap-2 rounded-xl border-2 border-black bg-[#DBEAFE] px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-900 hover:bg-[#BFDBFE] ${compact ? 'w-full' : ''}`}
        >
          <ImageIcon size={14} strokeWidth={2.5} />
          Load Workspace Pair
        </button>
        <button
          type="button"
          onClick={onSwap}
          disabled={!puzzleSlot.src && !diffSlot.src}
          className={`inline-flex items-center justify-center gap-2 rounded-xl border-2 border-black bg-white px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 ${compact ? 'w-full' : ''}`}
        >
          <RefreshCw size={14} strokeWidth={2.5} />
          Swap Pair
        </button>
      </div>
    </section>
  );
};

const BatchPairSelectionGrid = ({
  batch,
  activeIndex,
  selectedIndexSet,
  onPreview,
  onToggleSelection,
  onSelectAll,
  onClearSelection,
  compact = false
}: {
  batch: Puzzle[];
  activeIndex: number;
  selectedIndexSet: Set<number>;
  onPreview: (index: number) => void;
  onToggleSelection: (index: number) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  compact?: boolean;
}) => {
  if (batch.length <= 1) {
    return null;
  }

  const selectedCount = selectedIndexSet.size;

  return (
    <section
      className={`border-black bg-white ${
        compact
          ? 'rounded-[22px] border-2 p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]'
          : 'rounded-[28px] border-4 p-5 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Batch Selection</div>
          <h3 className={`mt-2 font-black uppercase tracking-tight text-slate-900 ${compact ? 'text-lg' : 'text-2xl'}`}>Choose Multiple Thumbnail Pairs</h3>
        </div>
        <div className="shrink-0 rounded-full border-2 border-black bg-[#FFF7ED] px-3 py-1 text-[10px] font-black uppercase text-slate-900">
          {selectedCount} / {batch.length}
        </div>
      </div>

      <div className={`mt-4 ${compact ? 'grid grid-cols-2 gap-2' : 'flex flex-wrap gap-3'}`}>
        <button
          type="button"
          onClick={onSelectAll}
          className={`inline-flex items-center justify-center gap-2 rounded-xl border-2 border-black bg-[#DBEAFE] px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-900 hover:bg-[#BFDBFE] ${compact ? 'w-full' : ''}`}
        >
          Select All
        </button>
        <button
          type="button"
          onClick={onClearSelection}
          disabled={selectedCount === 0}
          className={`inline-flex items-center justify-center gap-2 rounded-xl border-2 border-black bg-white px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 ${compact ? 'w-full' : ''}`}
        >
          Clear Selection
        </button>
      </div>

      <div className={`mt-4 ${compact ? 'grid gap-3' : 'grid gap-4 md:grid-cols-2'}`}>
        {batch.map((item, index) => {
          const isSelected = selectedIndexSet.has(index);
          const isActive = index === activeIndex;
          const title = item.title?.trim() || `Puzzle ${index + 1}`;

          return (
            <div
              key={`${title}-${index}`}
              className={`rounded-[20px] border-2 p-3 ${
                isSelected ? 'border-black bg-[#FEF3C7]' : 'border-black bg-white'
              } ${isActive ? 'shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]' : ''}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-black uppercase tracking-wide text-slate-900">{title}</div>
                  <div className="mt-1 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">
                    {isActive ? 'Current Preview' : 'Batch Pair'}
                  </div>
                </div>
                <div className={`rounded-full border-2 border-black px-2 py-1 text-[9px] font-black uppercase ${isSelected ? 'bg-[#DBEAFE] text-slate-900' : 'bg-white text-slate-500'}`}>
                  {isSelected ? 'Selected' : 'Skipped'}
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="overflow-hidden rounded-[14px] border-2 border-black bg-[linear-gradient(145deg,#F8FAFC_0%,#E2E8F0_100%)] aspect-[4/3]">
                  <img src={item.imageA} alt={`${title} puzzle`} className="h-full w-full object-contain" />
                </div>
                <div className="overflow-hidden rounded-[14px] border-2 border-black bg-[linear-gradient(145deg,#F8FAFC_0%,#E2E8F0_100%)] aspect-[4/3]">
                  <img src={item.imageB} alt={`${title} diff`} className="h-full w-full object-contain" />
                </div>
              </div>

              <div className={`mt-3 ${compact ? 'grid grid-cols-2 gap-2' : 'flex gap-3'}`}>
                <button
                  type="button"
                  onClick={() => onPreview(index)}
                  className={`inline-flex items-center justify-center gap-2 rounded-xl border-2 border-black bg-white px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-900 hover:bg-slate-100 ${compact ? 'w-full' : ''}`}
                >
                  Preview Pair
                </button>
                <button
                  type="button"
                  onClick={() => onToggleSelection(index)}
                  className={`inline-flex items-center justify-center gap-2 rounded-xl border-2 border-black px-4 py-3 text-xs font-black uppercase tracking-wide ${
                    isSelected ? 'bg-[#FFD93D] text-slate-900 hover:bg-[#FACC15]' : 'bg-white text-slate-700 hover:bg-slate-100'
                  } ${compact ? 'w-full' : ''}`}
                >
                  {isSelected ? 'Selected' : 'Add To Batch'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};

const ControlSlider = ({
  label,
  valueLabel,
  min,
  max,
  step,
  value,
  onChange
}: {
  label: string;
  valueLabel: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}) => (
  <div>
    <div className="mb-2 flex items-center justify-between text-xs font-black uppercase text-slate-800">
      <span>{label}</span>
      <span>{valueLabel}</span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      className="h-4 w-full rounded-full border-2 border-black accent-black"
    />
  </div>
);

const ImageFramingControls = ({
  layoutControls,
  onChange,
  onReset
}: {
  layoutControls: ThumbnailLayoutControls;
  onChange: (patch: Partial<ThumbnailLayoutControls>) => void;
  onReset: () => void;
}) => (
  <div className="rounded-[18px] border-2 border-black bg-[#F8FAFC] p-4">
    <div className="flex items-center justify-between gap-3">
      <div>
        <div className="text-xs font-black uppercase tracking-wide text-slate-900">Image Framing</div>
        <p className="mt-1 text-xs font-semibold leading-5 text-slate-600">
          Keep the pair aligned while you choose between full-frame fill or the original ratio.
        </p>
      </div>
      <button
        type="button"
        onClick={onReset}
        className="inline-flex shrink-0 items-center justify-center rounded-xl border-2 border-black bg-white px-3 py-2 text-[10px] font-black uppercase tracking-wide text-slate-700 hover:bg-slate-100"
      >
        Reset
      </button>
    </div>

    <div className="mt-4 grid grid-cols-2 gap-2">
      <button
        type="button"
        onClick={() => onChange({ imageFit: 'cover' })}
        className={`rounded-[16px] border-2 px-3 py-3 text-left ${
          layoutControls.imageFit === 'cover' ? 'border-black bg-[#FEF3C7]' : 'border-black bg-white'
        }`}
      >
        <div className="text-xs font-black uppercase text-slate-900">Fill Frame</div>
        <div className="mt-1 text-[10px] font-semibold leading-4 text-slate-500">Covers the panel and crops the extra edges.</div>
      </button>
      <button
        type="button"
        onClick={() => onChange({ imageFit: 'contain' })}
        className={`rounded-[16px] border-2 px-3 py-3 text-left ${
          layoutControls.imageFit === 'contain' ? 'border-black bg-[#FEF3C7]' : 'border-black bg-white'
        }`}
      >
        <div className="text-xs font-black uppercase text-slate-900">Original Ratio</div>
        <div className="mt-1 text-[10px] font-semibold leading-4 text-slate-500">Shows the whole image without stretching it.</div>
      </button>
    </div>

    <div className="mt-4 space-y-4">
      <ControlSlider
        label="Zoom"
        valueLabel={`${Math.round(layoutControls.imageZoom * 100)}%`}
        min={75}
        max={240}
        step={1}
        value={Math.round(layoutControls.imageZoom * 100)}
        onChange={(value) => onChange({ imageZoom: value / 100 })}
      />
      <ControlSlider
        label="Horizontal"
        valueLabel={`${layoutControls.imageOffsetX > 0 ? '+' : ''}${layoutControls.imageOffsetX}`}
        min={-100}
        max={100}
        step={1}
        value={layoutControls.imageOffsetX}
        onChange={(value) => onChange({ imageOffsetX: value })}
      />
      <ControlSlider
        label="Vertical"
        valueLabel={`${layoutControls.imageOffsetY > 0 ? '+' : ''}${layoutControls.imageOffsetY}`}
        min={-100}
        max={100}
        step={1}
        value={layoutControls.imageOffsetY}
        onChange={(value) => onChange({ imageOffsetY: value })}
      />
    </div>
  </div>
);

const PanelLayoutControls = ({
  layoutControls,
  onChange
}: {
  layoutControls: ThumbnailLayoutControls;
  onChange: (patch: Partial<ThumbnailLayoutControls>) => void;
}) => (
  <div className="space-y-4">
    <ControlSlider
      label="Panel Gap"
      valueLabel={`${layoutControls.panelGap}px`}
      min={0}
      max={48}
      step={1}
      value={layoutControls.panelGap}
      onChange={(value) => onChange({ panelGap: value })}
    />
    <ControlSlider
      label="Side Gap"
      valueLabel={`${layoutControls.sideInset}px`}
      min={0}
      max={72}
      step={1}
      value={layoutControls.sideInset}
      onChange={(value) => onChange({ sideInset: value })}
    />
    <ControlSlider
      label="Bottom Gap"
      valueLabel={`${layoutControls.bottomInset}px`}
      min={0}
      max={72}
      step={1}
      value={layoutControls.bottomInset}
      onChange={(value) => onChange({ bottomInset: value })}
    />
    <ControlSlider
      label="Border Thickness"
      valueLabel={`${layoutControls.borderWidth}px`}
      min={0}
      max={24}
      step={1}
      value={layoutControls.borderWidth}
      onChange={(value) => onChange({ borderWidth: value })}
    />
    <ControlSlider
      label="Corner Roundness"
      valueLabel={`${layoutControls.cornerRadius}px`}
      min={0}
      max={60}
      step={1}
      value={layoutControls.cornerRadius}
      onChange={(value) => onChange({ cornerRadius: value })}
    />
  </div>
);

export function ThumbnailGeneratorMode({ currentPuzzle, batch, onBack }: ThumbnailGeneratorModeProps) {
  const puzzleInputRef = useRef<HTMLInputElement | null>(null);
  const diffInputRef = useRef<HTMLInputElement | null>(null);
  const headlineInputRef = useRef<HTMLInputElement | null>(null);
  const desktopCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mobileCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderRequestRef = useRef(0);
  const autoLoadedCurrentPuzzleRef = useRef(false);
  const [activeBatchIndex, setActiveBatchIndex] = useState(() => findPuzzleIndex(batch, currentPuzzle));
  const [styleId, setStyleId] = useState<ThumbnailStyleId>('challenge_banner');
  const [headline, setHeadline] = useState(STYLE_PRESETS.challenge_banner.defaultHeadline);
  const [puzzleSlot, setPuzzleSlot] = useState<ImageSlotState>(EMPTY_SLOT);
  const [diffSlot, setDiffSlot] = useState<ImageSlotState>(EMPTY_SLOT);
  const [headlineEntries, setHeadlineEntries] = useState<string[]>([]);
  const [headlineFileName, setHeadlineFileName] = useState('');
  const [layoutControls, setLayoutControls] = useState<ThumbnailLayoutControls>(DEFAULT_LAYOUT_CONTROLS);
  const [exportQualityId, setExportQualityId] = useState<ThumbnailExportQualityId>('1080p');
  const [activeMobileTab, setActiveMobileTab] = useState<'style' | 'images' | 'export'>('style');
  const [selectedBatchIndices, setSelectedBatchIndices] = useState<number[]>(() => batch.map((_, index) => index));

  const preset = STYLE_PRESETS[styleId];
  const exportPreset = EXPORT_QUALITY_PRESETS[exportQualityId];
  const activeBatchPuzzle = batch[activeBatchIndex] ?? currentPuzzle;
  const currentPuzzleName = (currentPuzzle?.title || '').trim() || 'selected-puzzle';
  const activeThumbnailName = (activeBatchPuzzle?.title || '').trim() || currentPuzzleName;
  const hasHeadlineFile = headlineEntries.length > 0;
  const batchSelectionKey = batch
    .map((item, index) => `${index}:${item.title ?? ''}:${item.imageA.length}:${item.imageB.length}`)
    .join('|');
  const selectedBatchIndexSet = new Set(selectedBatchIndices);
  const updateLayoutControls = (patch: Partial<ThumbnailLayoutControls>) => {
    setLayoutControls((current) => ({
      ...current,
      ...patch
    }));
  };
  const resetImageFraming = () => {
    updateLayoutControls({
      imageFit: DEFAULT_LAYOUT_CONTROLS.imageFit,
      imageZoom: DEFAULT_LAYOUT_CONTROLS.imageZoom,
      imageOffsetX: DEFAULT_LAYOUT_CONTROLS.imageOffsetX,
      imageOffsetY: DEFAULT_LAYOUT_CONTROLS.imageOffsetY
    });
  };

  const loadBatchPuzzleIntoSlots = (index: number, options?: { announce?: boolean }) => {
    const targetPuzzle = batch[index] ?? (index === 0 ? currentPuzzle : null);
    if (!targetPuzzle) {
      notifyError('There is no selected puzzle in the workspace yet.');
      return;
    }

    const targetName = (targetPuzzle.title || '').trim() || `puzzle-${index + 1}`;
    setActiveBatchIndex(index);
    setPuzzleSlot(createSlotFromPuzzleImage(targetPuzzle.imageA, `${targetName}-puzzle`));
    setDiffSlot(createSlotFromPuzzleImage(targetPuzzle.imageB, `${targetName}-diff`));
    if (headlineEntries.length > 0) {
      setHeadline(headlineEntries[index % headlineEntries.length] ?? headlineEntries[0] ?? headline);
    }

    if (options?.announce) {
      notifySuccess(`Loaded ${targetName} into the thumbnail generator.`);
    }
  };

  const loadCurrentPuzzleIntoSlots = (options?: { announce?: boolean }) => {
    loadBatchPuzzleIntoSlots(findPuzzleIndex(batch, currentPuzzle), options);
  };

  useEffect(() => {
    setActiveBatchIndex(findPuzzleIndex(batch, currentPuzzle));
    autoLoadedCurrentPuzzleRef.current = false;
  }, [batch, currentPuzzle]);

  useEffect(() => {
    setSelectedBatchIndices(batch.map((_, index) => index));
  }, [batchSelectionKey]);

  useEffect(() => {
    if (!currentPuzzle || autoLoadedCurrentPuzzleRef.current) return;
    loadCurrentPuzzleIntoSlots();
    autoLoadedCurrentPuzzleRef.current = true;
  }, [batch, currentPuzzle]);

  useEffect(() => {
    const contexts = [desktopCanvasRef.current, mobileCanvasRef.current]
      .map((canvas) => canvas?.getContext('2d') ?? null)
      .filter((ctx): ctx is CanvasRenderingContext2D => Boolean(ctx));
    if (!contexts.length) return;

    const requestId = renderRequestRef.current + 1;
    renderRequestRef.current = requestId;
    let disposed = false;

    const render = async () => {
      const [puzzleImage, diffImage] = await Promise.all([
        puzzleSlot.src ? loadImageElement(puzzleSlot.src).catch(() => null) : Promise.resolve(null),
        diffSlot.src ? loadImageElement(diffSlot.src).catch(() => null) : Promise.resolve(null)
      ]);

      if (disposed || renderRequestRef.current !== requestId) {
        return;
      }

      contexts.forEach((ctx) => {
        renderThumbnailScene(ctx, styleId, headline, puzzleImage, diffImage, layoutControls);
      });
    };

    void render().catch(() => {
      if (disposed || renderRequestRef.current !== requestId) {
        return;
      }
      contexts.forEach((ctx) => {
        renderFailureState(ctx);
      });
    });

    return () => {
      disposed = true;
    };
  }, [diffSlot.src, headline, layoutControls, puzzleSlot.src, styleId]);

  const handleStyleSelect = (nextStyleId: ThumbnailStyleId) => {
    if (nextStyleId === styleId) return;

    const nextPreset = STYLE_PRESETS[nextStyleId];
    if (!headline.trim() || headline.trim().toUpperCase() === preset.defaultHeadline.toUpperCase()) {
      setHeadline(nextPreset.defaultHeadline);
    }
    setStyleId(nextStyleId);
  };

  const handleImagePicked = async (slot: 'puzzle' | 'diff', fileList: FileList | null) => {
    const file = fileList?.[0];
    if (!file) return;

    try {
      const nextSrc = await readFileAsDataUrl(file);
      const nextSlot: ImageSlotState = {
        src: nextSrc,
        name: file.name,
        source: 'upload'
      };

      if (slot === 'puzzle') {
        setPuzzleSlot(nextSlot);
      } else {
        setDiffSlot(nextSlot);
      }
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Could not read the selected image.');
    }
  };

  const handleSwapImages = () => {
    setPuzzleSlot(diffSlot);
    setDiffSlot(puzzleSlot);
  };

  const handleHeadlineFilePicked = async (fileList: FileList | null) => {
    const file = fileList?.[0];
    if (!file) return;

    try {
      const rawText = await readFileAsText(file);
      const nextEntries = parseHeadlineEntries(rawText);
      if (!nextEntries.length) {
        notifyError('The headline file did not contain any usable titles.');
        return;
      }

      setHeadlineEntries(nextEntries);
      setHeadlineFileName(file.name);
      setHeadline(nextEntries[activeBatchIndex % nextEntries.length] ?? nextEntries[0]);
      notifySuccess(`Loaded ${nextEntries.length} headline${nextEntries.length === 1 ? '' : 's'} from ${file.name}.`);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Could not read the headline file.');
    }
  };

  const handleClearHeadlineFile = () => {
    setHeadlineEntries([]);
    setHeadlineFileName('');
  };

  const handleStepThumbnail = (direction: -1 | 1) => {
    if (batch.length <= 1) return;
    const nextIndex = (activeBatchIndex + direction + batch.length) % batch.length;
    loadBatchPuzzleIntoSlots(nextIndex);
  };

  const handlePreviewBatchPair = (index: number) => {
    loadBatchPuzzleIntoSlots(index, { announce: true });
  };

  const handleToggleBatchSelection = (index: number) => {
    setSelectedBatchIndices((current) =>
      current.includes(index) ? current.filter((item) => item !== index) : [...current, index].sort((a, b) => a - b)
    );
  };

  const handleSelectAllBatchPairs = () => {
    setSelectedBatchIndices(batch.map((_, index) => index));
  };

  const handleClearBatchSelection = () => {
    setSelectedBatchIndices([]);
  };

  const handleDownload = async () => {
    if (!puzzleSlot.src || !diffSlot.src) {
      notifyError('Upload both a puzzle image and a puzzle diff image before exporting.');
      return;
    }

    try {
      const offscreenCanvas = document.createElement('canvas');
      offscreenCanvas.width = exportPreset.width;
      offscreenCanvas.height = exportPreset.height;
      const ctx = offscreenCanvas.getContext('2d');
      if (!ctx) {
        notifyError('Failed to initialize the export canvas.');
        return;
      }

      const [puzzleImage, diffImage] = await Promise.all([
        loadImageElement(puzzleSlot.src),
        loadImageElement(diffSlot.src)
      ]);

      renderThumbnailScene(ctx, styleId, headline, puzzleImage, diffImage, layoutControls, {
        width: exportPreset.width,
        height: exportPreset.height
      });

      const blob = await new Promise<Blob | null>((resolve) => offscreenCanvas.toBlob(resolve, 'image/png'));
      if (!blob) {
        notifyError('Failed to create the thumbnail PNG.');
        return;
      }

      const fileName = `${activeThumbnailName.replace(/\s+/g, '-').toLowerCase()}-${styleId}-${exportPreset.id}.png`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      notifySuccess('Thumbnail PNG downloaded.');
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Failed to export the thumbnail PNG.');
    }
  };

  const handleBatchExport = async () => {
    if (!batch.length) {
      notifyError('There is no puzzle batch available to export.');
      return;
    }

    const exportIndices = selectedBatchIndices.filter((index) => index >= 0 && index < batch.length);
    if (!exportIndices.length) {
      notifyError('Select at least one puzzle pair for batch thumbnails.');
      return;
    }

    try {
      const offscreenCanvas = document.createElement('canvas');
      offscreenCanvas.width = exportPreset.width;
      offscreenCanvas.height = exportPreset.height;
      const ctx = offscreenCanvas.getContext('2d');
      if (!ctx) {
        notifyError('Failed to initialize the batch thumbnail canvas.');
        return;
      }

      const safeHeadline = headline.trim() || preset.defaultHeadline;

      for (let exportOrder = 0; exportOrder < exportIndices.length; exportOrder += 1) {
        const index = exportIndices[exportOrder];
        const item = batch[index];
        const batchHeadline =
          headlineEntries.length > 0 ? headlineEntries[index % headlineEntries.length] ?? safeHeadline : safeHeadline;
        const [puzzleImage, diffImage] = await Promise.all([
          loadImageElement(item.imageA),
          loadImageElement(item.imageB)
        ]);

        renderThumbnailScene(ctx, styleId, batchHeadline, puzzleImage, diffImage, layoutControls, {
          width: exportPreset.width,
          height: exportPreset.height
        });

        const blob = await new Promise<Blob | null>((resolve) => offscreenCanvas.toBlob(resolve, 'image/png'));
        if (!blob) {
          throw new Error(`Failed to create thumbnail ${exportOrder + 1}.`);
        }

        const fileBaseName = sanitizeFileBaseName(item.title?.trim() || `puzzle-${index + 1}`);
        const fileName = `${fileBaseName}-${styleId}-${exportPreset.id}.png`;
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = fileName;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);

        await new Promise((resolve) => window.setTimeout(resolve, 120));
      }

      notifySuccess(`Started ${exportIndices.length} thumbnail download${exportIndices.length === 1 ? '' : 's'} for the selected batch.`);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Batch thumbnail export failed.');
    }
  };

  const mobileShellStyle = {
    height: 'calc(100dvh - var(--mobile-bottom-nav-offset, 0px))'
  };

  const mobilePreviewRailStyle = {
    height: '30dvh'
  };

  const mobilePreviewFrameStyle = {
    aspectRatio: `${THUMBNAIL_WIDTH} / ${THUMBNAIL_HEIGHT}`,
    width: 'min(100%, calc((30dvh - 1rem) * 16 / 9))',
    height: 'auto',
    maxWidth: '100%',
    marginInline: 'auto'
  };

  return (
    <>
      <div className="flex min-h-0 flex-col bg-[#F6F2E8] sm:hidden" style={mobileShellStyle}>
        <div className="shrink-0 border-b border-black/15 bg-[#F6F2E8] px-2 py-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onBack}
              aria-label="Back"
              className="inline-flex h-10 w-10 items-center justify-center rounded-[14px] border-2 border-black bg-white text-slate-900"
            >
              <ArrowLeft size={17} strokeWidth={2.8} />
            </button>
            <div className="flex h-10 min-w-0 flex-1 items-center justify-between gap-2 rounded-[14px] border-2 border-black bg-white px-3">
              <div className="min-w-0">
                <div className="text-[9px] font-black uppercase tracking-[0.18em] text-[#2563EB]">Thumbnail Mode</div>
                <div className="truncate text-[11px] font-black uppercase tracking-[0.12em] text-slate-900">{preset.label}</div>
              </div>
              <div className="shrink-0 rounded-full border border-black bg-[#FFF7ED] px-2 py-1 text-[9px] font-black uppercase text-slate-900">
                {exportPreset.label}
              </div>
            </div>
            <button
              type="button"
              onClick={handleDownload}
              disabled={!puzzleSlot.src || !diffSlot.src}
              className={`inline-flex h-10 items-center justify-center gap-2 rounded-[14px] border-2 border-black px-3 text-[10px] font-black uppercase tracking-[0.14em] ${
                !puzzleSlot.src || !diffSlot.src ? 'bg-slate-200 text-slate-500' : 'bg-[#FDE68A] text-slate-900'
              }`}
            >
              <Download size={14} strokeWidth={2.8} />
              PNG
            </button>
          </div>
        </div>

        <div className="shrink-0 border-b border-black/15 bg-white px-2 py-2">
          <div className="grid items-center justify-items-center" style={mobilePreviewRailStyle}>
            <div className="relative max-w-full" style={mobilePreviewFrameStyle}>
              <canvas
                ref={mobileCanvasRef}
                width={THUMBNAIL_WIDTH}
                height={THUMBNAIL_HEIGHT}
                className="block h-auto w-full max-w-full bg-white"
              />
            </div>
          </div>

          <div className="mt-2 grid grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] gap-2">
            <button
              type="button"
              onClick={() => handleStepThumbnail(-1)}
              disabled={batch.length <= 1}
              className={`inline-flex h-10 items-center justify-center rounded-[14px] border-2 border-black ${
                batch.length <= 1 ? 'bg-slate-100 text-slate-400' : 'bg-white text-slate-900'
              }`}
            >
              <ChevronLeft size={16} strokeWidth={2.8} />
            </button>
            <div className="inline-flex h-10 min-w-0 items-center justify-center rounded-[14px] border-2 border-black bg-white px-3 text-[10px] font-black uppercase tracking-[0.14em] text-slate-900">
              {batch.length > 0 ? `${activeBatchIndex + 1} / ${batch.length}` : 'Single Preview'}
            </div>
            <button
              type="button"
              onClick={() => handleStepThumbnail(1)}
              disabled={batch.length <= 1}
              className={`inline-flex h-10 items-center justify-center rounded-[14px] border-2 border-black ${
                batch.length <= 1 ? 'bg-slate-100 text-slate-400' : 'bg-white text-slate-900'
              }`}
            >
              <ChevronRight size={16} strokeWidth={2.8} />
            </button>
          </div>
        </div>

        <div className="shrink-0 border-b-2 border-black bg-[#FFFDF8] px-2 py-3">
          <div className="grid grid-cols-3 gap-2">
            {(['style', 'images', 'export'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveMobileTab(tab)}
                className={`rounded-full border-2 border-black px-3 py-2 text-[10px] font-black uppercase ${
                  activeMobileTab === tab ? 'bg-[#FFD93D]' : 'bg-white'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-[#FFFDF8] px-2 py-3">
          {activeMobileTab === 'style' ? (
            <div className="space-y-3">
              <section className="rounded-[22px] border-2 border-black bg-white p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Styles</div>
                    <h2 className="mt-2 text-xl font-black uppercase tracking-tight text-slate-900">Thumbnail Look</h2>
                  </div>
                  <div className="rounded-full border-2 border-black bg-[#FFF7ED] px-3 py-1 text-[10px] font-black uppercase text-slate-900">
                    {exportPreset.width} x {exportPreset.height}
                  </div>
                </div>

                <div className="mt-4 grid gap-3">
                  {(Object.values(STYLE_PRESETS) as ThumbnailStylePreset[]).map((style) => (
                    <button
                      key={style.id}
                      type="button"
                      onClick={() => handleStyleSelect(style.id)}
                      className={`rounded-[18px] border-2 p-4 text-left shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] ${
                        style.id === styleId ? 'border-black bg-[#FEF3C7]' : 'border-black bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-base font-black uppercase text-slate-900">{style.label}</div>
                          <div className="mt-1 text-xs font-semibold leading-5 text-slate-600">{style.description}</div>
                        </div>
                        <div
                          className="h-10 w-10 shrink-0 rounded-2xl border-2 border-black"
                          style={{ background: `linear-gradient(135deg, ${style.accentStart} 0%, ${style.accentEnd} 100%)` }}
                        />
                      </div>
                    </button>
                  ))}
                </div>
              </section>

              <section className="rounded-[22px] border-2 border-black bg-white p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                <div className="flex items-center gap-2 text-slate-900">
                  <Wand2 size={18} strokeWidth={2.7} />
                  <div className="text-sm font-black uppercase tracking-wide">Headline</div>
                </div>
                <input
                  type="text"
                  value={headline}
                  onChange={(event) => setHeadline(event.target.value)}
                  placeholder={preset.defaultHeadline}
                  className="mt-3 w-full rounded-2xl border-2 border-black bg-white px-4 py-3 text-base font-black uppercase tracking-wide text-slate-900 outline-none placeholder:text-slate-400"
                />
                <button
                  type="button"
                  onClick={() => setHeadline(preset.defaultHeadline)}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border-2 border-black bg-white px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-700 hover:bg-slate-100"
                >
                  <RefreshCw size={14} strokeWidth={2.5} />
                  Reset Title
                </button>

                <div className="mt-3 rounded-[18px] border-2 border-black bg-[#F8FAFC] p-3">
                  <div className="flex items-center gap-2 text-slate-900">
                    <FileText size={16} strokeWidth={2.5} />
                    <div className="text-xs font-black uppercase tracking-wide">Headline File</div>
                  </div>
                  <p className="mt-2 text-xs font-semibold leading-5 text-slate-600">
                    Upload a `.txt` or `.csv` file. Separate headlines with commas or new lines, and batch export will auto-use them.
                  </p>
                  <div className="mt-3 rounded-2xl border-2 border-black bg-white px-3 py-3 text-xs font-semibold text-slate-700">
                    {hasHeadlineFile
                      ? `${headlineEntries.length} headline${headlineEntries.length === 1 ? '' : 's'} loaded from ${headlineFileName}.`
                      : 'No headline file loaded yet.'}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => headlineInputRef.current?.click()}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl border-2 border-black bg-[#DBEAFE] px-4 py-3 text-[11px] font-black uppercase tracking-wide text-slate-900 hover:bg-[#BFDBFE]"
                    >
                      <Upload size={14} strokeWidth={2.5} />
                      Upload File
                    </button>
                    <button
                      type="button"
                      onClick={handleClearHeadlineFile}
                      disabled={!hasHeadlineFile}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl border-2 border-black bg-white px-4 py-3 text-[11px] font-black uppercase tracking-wide text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <X size={14} strokeWidth={2.5} />
                      Clear File
                    </button>
                  </div>
                </div>
              </section>
            </div>
          ) : null}

          {activeMobileTab === 'images' ? (
            <div className="space-y-3">
              <PairSelectionCard
                title={activeThumbnailName}
                subtitle="Thumbnail Pair"
                puzzleSlot={puzzleSlot}
                diffSlot={diffSlot}
                batchIndex={activeBatchIndex}
                batchLength={Math.max(batch.length, currentPuzzle ? 1 : 0)}
                onPrev={() => handleStepThumbnail(-1)}
                onNext={() => handleStepThumbnail(1)}
                onLoadWorkspacePair={() => loadCurrentPuzzleIntoSlots({ announce: true })}
                onSwap={handleSwapImages}
                compact
              />

              <BatchPairSelectionGrid
                batch={batch}
                activeIndex={activeBatchIndex}
                selectedIndexSet={selectedBatchIndexSet}
                onPreview={handlePreviewBatchPair}
                onToggleSelection={handleToggleBatchSelection}
                onSelectAll={handleSelectAllBatchPairs}
                onClearSelection={handleClearBatchSelection}
                compact
              />

              <section className="rounded-[22px] border-2 border-black bg-white p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Overrides</div>
                  <h2 className="mt-2 text-xl font-black uppercase tracking-tight text-slate-900">Replace Either Side</h2>
                </div>
                <div className="mt-3 rounded-[18px] border-2 border-black bg-[linear-gradient(135deg,#FFF7ED_0%,#FEFCE8_100%)] p-4 text-sm font-semibold leading-6 text-slate-700">
                  Use the pair above as the base selection, then replace only the puzzle side or only the diff side if you want a mixed thumbnail.
                </div>
              </section>

              <div className="grid gap-3">
                <SlotPreview
                  title="Override Puzzle Side"
                  subtitle="Replace the main puzzle image only"
                  slot={puzzleSlot}
                  onUpload={() => puzzleInputRef.current?.click()}
                  onClear={() => setPuzzleSlot(EMPTY_SLOT)}
                  compact
                />
                <SlotPreview
                  title="Override Diff Side"
                  subtitle="Replace the answer image only"
                  slot={diffSlot}
                  onUpload={() => diffInputRef.current?.click()}
                  onClear={() => setDiffSlot(EMPTY_SLOT)}
                  compact
                />
              </div>
            </div>
          ) : null}

          {activeMobileTab === 'export' ? (
            <div className="space-y-3">
              <section className="rounded-[22px] border-2 border-black bg-white p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                <div className="text-sm font-black uppercase tracking-wide text-slate-900">Export Controls</div>
                <p className="mt-2 text-sm font-semibold text-slate-600">These controls change the actual exported PNG.</p>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  {EXPORT_QUALITY_ORDER.map((qualityId) => {
                    const quality = EXPORT_QUALITY_PRESETS[qualityId];
                    return (
                      <button
                        key={quality.id}
                        type="button"
                        onClick={() => setExportQualityId(quality.id)}
                        className={`rounded-[16px] border-2 p-3 text-left ${
                          exportQualityId === quality.id ? 'border-black bg-[#FEF3C7]' : 'border-black bg-white'
                        }`}
                      >
                        <div className="text-xs font-black uppercase text-slate-900">{quality.label}</div>
                        <div className="mt-1 text-[10px] font-bold uppercase text-slate-500">
                          {quality.width} x {quality.height}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-4 space-y-4">
                  <ImageFramingControls
                    layoutControls={layoutControls}
                    onChange={updateLayoutControls}
                    onReset={resetImageFraming}
                  />
                  <PanelLayoutControls layoutControls={layoutControls} onChange={updateLayoutControls} />
                </div>
              </section>

              <section className="rounded-[22px] border-2 border-black bg-white p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                <div className="grid gap-3">
                  <button
                    type="button"
                    onClick={handleDownload}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border-2 border-black bg-[#FDE68A] px-5 py-3 text-xs font-black uppercase tracking-wide text-slate-900 hover:bg-[#FCD34D]"
                  >
                    <Download size={14} strokeWidth={2.5} />
                    Download Thumbnail PNG
                  </button>
                  {batch.length > 1 ? (
                    <button
                      type="button"
                      onClick={handleBatchExport}
                      disabled={selectedBatchIndices.length === 0}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl border-2 border-black bg-[#DBEAFE] px-5 py-3 text-xs font-black uppercase tracking-wide text-slate-900 hover:bg-[#BFDBFE] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                    >
                      <Download size={14} strokeWidth={2.5} />
                      Download {selectedBatchIndices.length || 0} Batch PNGs
                    </button>
                  ) : null}
                </div>

                <div className="mt-4 rounded-[18px] border-2 border-black bg-[#FFFDF5] p-4 text-sm font-semibold leading-6 text-slate-600">
                  Export renders a fresh PNG at {exportPreset.width} x {exportPreset.height}. No extra frame or page styling is added during download.
                </div>
              </section>
            </div>
          ) : null}
        </div>
      </div>

      <div className="hidden space-y-6 sm:block">
      <section className="rounded-[28px] border-4 border-black bg-white p-4 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] sm:p-6">
        <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-2 rounded-xl border-2 border-black bg-white px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-700 hover:bg-slate-100"
            >
              <ArrowLeft size={14} strokeWidth={2.5} />
              Back
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="inline-flex items-center gap-2 rounded-xl border-2 border-black bg-[#FDE68A] px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-900 hover:bg-[#FCD34D]"
            >
              <Download size={14} strokeWidth={2.5} />
              Export PNG
            </button>
            {batch.length > 1 ? (
              <button
                type="button"
                onClick={handleBatchExport}
                disabled={selectedBatchIndices.length === 0}
                className="inline-flex items-center gap-2 rounded-xl border-2 border-black bg-[#DBEAFE] px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-900 hover:bg-[#BFDBFE] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
              >
                <Download size={14} strokeWidth={2.5} />
                Export {selectedBatchIndices.length || 0} Batch PNGs
              </button>
            ) : null}
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-6">
          <section className="rounded-[28px] border-4 border-black bg-white p-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Styles</div>
                <h2 className="mt-2 text-2xl font-black uppercase tracking-tight text-slate-900">Style Presets</h2>
              </div>
              <div className="rounded-2xl border-2 border-black bg-[#FFF7ED] px-4 py-3 text-xs font-black uppercase text-slate-900">
                {exportPreset.width} x {exportPreset.height} PNG
              </div>
            </div>

            <div className="mt-6 grid gap-3">
              {(Object.values(STYLE_PRESETS) as ThumbnailStylePreset[]).map((style) => (
                <button
                  key={style.id}
                  type="button"
                  onClick={() => handleStyleSelect(style.id)}
                  className={`rounded-[22px] border-4 p-4 text-left shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] transition-transform hover:-translate-y-1 ${
                    style.id === styleId ? 'border-black bg-[#FEF3C7]' : 'border-black bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-lg font-black uppercase text-slate-900">{style.label}</div>
                      <div className="mt-2 text-sm font-semibold text-slate-600">{style.description}</div>
                    </div>
                    <div
                      className="h-11 w-11 shrink-0 rounded-2xl border-2 border-black"
                      style={{
                        background: `linear-gradient(135deg, ${style.accentStart} 0%, ${style.accentEnd} 100%)`
                      }}
                    />
                  </div>
                </button>
              ))}
            </div>

            <div className="mt-6 rounded-[24px] border-4 border-black bg-[#FFFDF5] p-4">
              <div className="flex items-center gap-2 text-slate-900">
                <Wand2 size={18} strokeWidth={2.7} />
                <div className="text-sm font-black uppercase tracking-wide">Headline</div>
              </div>
              <input
                type="text"
                value={headline}
                onChange={(event) => setHeadline(event.target.value)}
                placeholder={preset.defaultHeadline}
                className="mt-3 w-full rounded-2xl border-2 border-black bg-white px-4 py-3 text-lg font-black uppercase tracking-wide text-slate-900 outline-none placeholder:text-slate-400"
              />
              <div className="mt-3 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => setHeadline(preset.defaultHeadline)}
                  className="inline-flex items-center gap-2 rounded-xl border-2 border-black bg-white px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-700 hover:bg-slate-100"
                >
                  <RefreshCw size={14} strokeWidth={2.5} />
                  Reset Title
                </button>
                <button
                  type="button"
                  onClick={handleSwapImages}
                  disabled={!puzzleSlot.src && !diffSlot.src}
                  className="inline-flex items-center gap-2 rounded-xl border-2 border-black bg-white px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RefreshCw size={14} strokeWidth={2.5} />
                  Swap Sides
                </button>
              </div>

              <div className="mt-4 rounded-[20px] border-2 border-black bg-[#F8FAFC] p-4">
                <div className="flex items-center gap-2 text-slate-900">
                  <FileText size={16} strokeWidth={2.5} />
                  <div className="text-xs font-black uppercase tracking-wide">Headline File</div>
                </div>
                <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
                  Upload a `.txt` or `.csv` file with headlines separated by commas or new lines. Batch export will rotate through them automatically.
                </p>
                <div className="mt-3 rounded-2xl border-2 border-black bg-white px-4 py-3 text-sm font-semibold text-slate-700">
                  {hasHeadlineFile
                    ? `${headlineEntries.length} headline${headlineEntries.length === 1 ? '' : 's'} loaded from ${headlineFileName}.`
                    : 'No headline file loaded yet.'}
                </div>
                <div className="mt-3 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => headlineInputRef.current?.click()}
                    className="inline-flex items-center gap-2 rounded-xl border-2 border-black bg-[#DBEAFE] px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-900 hover:bg-[#BFDBFE]"
                  >
                    <Upload size={14} strokeWidth={2.5} />
                    Upload Headline File
                  </button>
                  <button
                    type="button"
                    onClick={handleClearHeadlineFile}
                    disabled={!hasHeadlineFile}
                    className="inline-flex items-center gap-2 rounded-xl border-2 border-black bg-white px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <X size={14} strokeWidth={2.5} />
                    Clear File
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-6 rounded-[24px] border-4 border-black bg-[#F8FAFC] p-4">
              <div className="text-sm font-black uppercase tracking-wide text-slate-900">Export Controls</div>
              <p className="mt-2 text-sm font-semibold text-slate-600">
                These controls change the actual exported PNG, not just the UI around it.
              </p>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {EXPORT_QUALITY_ORDER.map((qualityId) => {
                  const quality = EXPORT_QUALITY_PRESETS[qualityId];
                  return (
                    <button
                      key={quality.id}
                      type="button"
                      onClick={() => setExportQualityId(quality.id)}
                      className={`rounded-[18px] border-2 p-4 text-left ${
                        exportQualityId === quality.id ? 'border-black bg-[#FEF3C7]' : 'border-black bg-white'
                      }`}
                    >
                      <div className="text-sm font-black uppercase text-slate-900">{quality.label}</div>
                      <div className="mt-1 text-xs font-bold uppercase text-slate-500">
                        {quality.width} x {quality.height}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 space-y-4">
                <ImageFramingControls
                  layoutControls={layoutControls}
                  onChange={updateLayoutControls}
                  onReset={resetImageFraming}
                />
                <PanelLayoutControls layoutControls={layoutControls} onChange={updateLayoutControls} />
              </div>
            </div>
          </section>

          <section className="rounded-[28px] border-4 border-black bg-white p-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Source Pair</div>
                <h2 className="mt-2 text-2xl font-black uppercase tracking-tight text-slate-900">Pick The Pair</h2>
              </div>
              <div className="rounded-2xl border-2 border-black bg-[#FFF7ED] px-4 py-3 text-xs font-black uppercase text-slate-900">
                {batch.length > 0 ? `${activeBatchIndex + 1} / ${batch.length}` : 'Single Pair'}
              </div>
            </div>

            <div className="mt-4 rounded-[24px] border-4 border-black bg-[linear-gradient(135deg,#FFF7ED_0%,#FEFCE8_100%)] p-4 text-sm font-semibold text-slate-700">
              The thumbnail is built from a pair. Browse the batch like the rest of the app, keep the pair together, and only replace a single side below when you want a custom mix.
            </div>

            <div className="mt-6">
              <PairSelectionCard
                title={activeThumbnailName}
                subtitle="Thumbnail Pair"
                puzzleSlot={puzzleSlot}
                diffSlot={diffSlot}
                batchIndex={activeBatchIndex}
                batchLength={Math.max(batch.length, currentPuzzle ? 1 : 0)}
                onPrev={() => handleStepThumbnail(-1)}
                onNext={() => handleStepThumbnail(1)}
                onLoadWorkspacePair={() => loadCurrentPuzzleIntoSlots({ announce: true })}
                onSwap={handleSwapImages}
              />
            </div>

            <div className="mt-6">
              <BatchPairSelectionGrid
                batch={batch}
                activeIndex={activeBatchIndex}
                selectedIndexSet={selectedBatchIndexSet}
                onPreview={handlePreviewBatchPair}
                onToggleSelection={handleToggleBatchSelection}
                onSelectAll={handleSelectAllBatchPairs}
                onClearSelection={handleClearBatchSelection}
              />
            </div>

            <div className="mt-6 rounded-[24px] border-4 border-black bg-[#FFFDF5] p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Overrides</div>
              <h3 className="mt-2 text-xl font-black uppercase tracking-tight text-slate-900">Replace One Side If Needed</h3>
              <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">
                Keep the selected pair as the base, then override only the puzzle image or only the diff image when you want a mixed thumbnail.
              </p>
            </div>

            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              <SlotPreview
                title="Override Puzzle Side"
                subtitle="Replace the main puzzle image only"
                slot={puzzleSlot}
                onUpload={() => puzzleInputRef.current?.click()}
                onClear={() => setPuzzleSlot(EMPTY_SLOT)}
              />
              <SlotPreview
                title="Override Diff Side"
                subtitle="Replace the answer-side image only"
                slot={diffSlot}
                onUpload={() => diffInputRef.current?.click()}
                onClear={() => setDiffSlot(EMPTY_SLOT)}
              />
            </div>

          </section>
        </div>

        <section className="rounded-[28px] border-4 border-black bg-white p-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Preview</div>
              <h2 className="mt-2 text-2xl font-black uppercase tracking-tight text-slate-900">Exact Export Preview</h2>
              <p className="mt-2 max-w-2xl text-sm font-semibold text-slate-600">
                This preview is the same canvas we export. The UI only scales it to fit the page, but the PNG content is exactly what you see here.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => handleStepThumbnail(-1)}
                disabled={batch.length <= 1}
                className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl border-2 border-black ${
                  batch.length <= 1 ? 'bg-slate-100 text-slate-400' : 'bg-white text-slate-900'
                }`}
              >
                <ChevronLeft size={18} strokeWidth={2.7} />
              </button>
              <div className="rounded-2xl border-2 border-black bg-white px-4 py-3 text-xs font-black uppercase text-slate-900">
                {batch.length > 0 ? `${activeBatchIndex + 1} / ${batch.length}` : 'Single Preview'}
              </div>
              <button
                type="button"
                onClick={() => handleStepThumbnail(1)}
                disabled={batch.length <= 1}
                className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl border-2 border-black ${
                  batch.length <= 1 ? 'bg-slate-100 text-slate-400' : 'bg-white text-slate-900'
                }`}
              >
                <ChevronRight size={18} strokeWidth={2.7} />
              </button>
              <div className="rounded-2xl border-2 border-black bg-[#F8FAFC] px-4 py-3 text-xs font-black uppercase text-slate-700">
                {preset.label}
              </div>
            </div>
          </div>

          <div className="mt-6">
            <div className="bg-transparent p-0">
              <canvas
                ref={desktopCanvasRef}
                width={THUMBNAIL_WIDTH}
                height={THUMBNAIL_HEIGHT}
                className="block h-auto w-full bg-white"
              />
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-2xl border-2 border-black bg-[#FFF7ED] px-4 py-3">
              <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Style</div>
              <div className="mt-2 text-sm font-black uppercase text-slate-900">{preset.label}</div>
            </div>
            <div className="rounded-2xl border-2 border-black bg-[#E0F2FE] px-4 py-3">
              <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Image Fit</div>
              <div className="mt-2 text-sm font-black uppercase text-slate-900">
                {layoutControls.imageFit === 'cover' ? 'Fill Frame' : 'Original Ratio'}
              </div>
            </div>
            <div className="rounded-2xl border-2 border-black bg-[#F0FDF4] px-4 py-3">
              <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Border / Gaps</div>
              <div className="mt-2 text-sm font-black uppercase text-slate-900">
                {layoutControls.borderWidth}px / {layoutControls.panelGap}px / {layoutControls.sideInset}px / {layoutControls.bottomInset}px
              </div>
            </div>
            <div className="rounded-2xl border-2 border-black bg-[#EFF6FF] px-4 py-3">
              <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Zoom</div>
              <div className="mt-2 text-sm font-black uppercase text-slate-900">{Math.round(layoutControls.imageZoom * 100)}%</div>
            </div>
            <div className="rounded-2xl border-2 border-black bg-[#F5F3FF] px-4 py-3">
              <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Export Size</div>
              <div className="mt-2 text-sm font-black uppercase text-slate-900">
                {exportPreset.label} / {exportPreset.width} x {exportPreset.height}
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-[24px] border-4 border-black bg-[#FFFDF5] p-5">
            <div className="text-sm font-black uppercase tracking-wide text-slate-900">Export Facts</div>
            <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">
              Export renders a fresh PNG at {exportPreset.width} x {exportPreset.height}. There is no extra yellow frame, shadow, or fancy page styling
              added during download beyond what is already drawn inside the thumbnail itself.
            </p>
            <button
              type="button"
              onClick={handleDownload}
              className="mt-4 inline-flex items-center gap-2 rounded-xl border-2 border-black bg-[#FDE68A] px-5 py-3 text-xs font-black uppercase tracking-wide text-slate-900 hover:bg-[#FCD34D]"
            >
              <Download size={14} strokeWidth={2.5} />
              Download Thumbnail PNG
            </button>
            {batch.length > 1 ? (
              <button
                type="button"
                onClick={handleBatchExport}
                disabled={selectedBatchIndices.length === 0}
                className="mt-4 ml-3 inline-flex items-center gap-2 rounded-xl border-2 border-black bg-[#DBEAFE] px-5 py-3 text-xs font-black uppercase tracking-wide text-slate-900 hover:bg-[#BFDBFE] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
              >
                <Download size={14} strokeWidth={2.5} />
                Download {selectedBatchIndices.length || 0} Batch PNGs
              </button>
            ) : null}
          </div>
        </section>
      </section>
      </div>
      <input
        ref={puzzleInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          void handleImagePicked('puzzle', event.target.files);
          event.currentTarget.value = '';
        }}
      />
      <input
        ref={diffInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          void handleImagePicked('diff', event.target.files);
          event.currentTarget.value = '';
        }}
      />
      <input
        ref={headlineInputRef}
        type="file"
        accept=".txt,.csv,text/plain"
        className="hidden"
        onChange={(event) => {
          void handleHeadlineFilePicked(event.target.files);
          event.currentTarget.value = '';
        }}
      />
    </>
  );
}
