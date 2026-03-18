import React, { DragEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Camera,
  Download,
  ImagePlus,
  Layers3,
  RefreshCcw,
  RotateCw,
  Save,
  Trash2,
  Type,
  Upload
} from 'lucide-react';
import { useProcessedLogoSrc } from '../hooks/useProcessedLogoSrc';
import { readFileAsDataUrl } from '../services/imageSplitter';
import {
  DEFAULT_THUMBNAIL_SETTINGS,
  deleteThumbnailPreset,
  loadThumbnailPresets,
  saveThumbnailPreset,
  sanitizeThumbnailCreatorSettings,
  THUMBNAIL_BACKGROUND_STYLES,
  THUMBNAIL_EXPORT_SIZE_MAP,
  THUMBNAIL_LAYOUT_TEMPLATES,
  THUMBNAIL_TEXT_TEMPLATES,
  THUMBNAIL_THEME_PRESETS,
  type ThumbnailBackgroundStyle,
  type ThumbnailCreatorSettings,
  type ThumbnailExportFormat,
  type ThumbnailLayoutPreset,
  type ThumbnailOverlayItem,
  type ThumbnailPreset,
  type ThumbnailTextTemplate,
  type ThumbnailThemePreset,
  type ThumbnailTransformBox
} from '../services/thumbnailPresets';

interface ThumbnailCreatorModeProps {
  onBack?: () => void;
  defaultLogo?: string;
  defaultLogoChromaKeyEnabled?: boolean;
  defaultLogoChromaKeyColor?: string;
  defaultLogoChromaKeyTolerance?: number;
  embedded?: boolean;
  externalPairs?: ThumbnailCreatorExternalPair[];
  activeExternalPairId?: string | null;
  onActiveExternalPairChange?: (pairId: string) => void;
}

export interface ThumbnailCreatorExternalPair {
  id: string;
  baseName: string;
  puzzleFileName: string;
  diffFileName: string;
  puzzleSrc: string;
  diffSrc: string;
}

type ThumbnailPair = ThumbnailCreatorExternalPair;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CardPlacement extends Rect {
  rotation: number;
}

interface ThumbnailRenderAssets {
  puzzleImage: HTMLImageElement;
  diffImage: HTMLImageElement;
  overlayImages: HTMLImageElement[];
}

type SelectedLayer =
  | { kind: 'text' }
  | { kind: 'puzzle_card' }
  | { kind: 'diff_card' }
  | { kind: 'overlay'; id: string }
  | null;
type GestureMode = 'move' | 'scale' | 'rotate';

interface GestureState {
  selected: SelectedLayer;
  mode: GestureMode;
  startClientX: number;
  startClientY: number;
  startTransform: ThumbnailTransformBox;
  stageLeft: number;
  stageTop: number;
  stageWidth: number;
  stageHeight: number;
}

type EditorTool = 'source' | 'text' | 'background' | 'cards' | 'overlays' | 'export';

const cardClass =
  'rounded-[24px] border-2 border-slate-900 bg-white p-4 sm:p-5 shadow-[0_18px_45px_rgba(15,23,42,0.08)]';
const compactCardClass =
  'rounded-[20px] border-2 border-slate-900 bg-white p-3 shadow-[0_16px_36px_rgba(15,23,42,0.08)]';
const compactActionButtonClass =
  'inline-flex items-center justify-center gap-2 rounded-lg border-2 border-slate-900 px-3 py-2 text-xs font-bold text-slate-900 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50';
const compactInputClass =
  'mt-1 w-full rounded-lg border-2 border-slate-900 bg-white px-2.5 py-2 text-sm font-semibold text-slate-900 outline-none';
const rangeClass = 'mt-2 h-3 w-full rounded-full accent-slate-900';
const themeOrder: ThumbnailThemePreset[] = ['arcade_burst', 'editorial_glow', 'story_gold', 'midnight_alert'];
const layoutOrder: ThumbnailLayoutPreset[] = ['square_split', 'square_stagger', 'puzzle_hero', 'diff_hero', 'top_bottom'];
const textTemplateOrder: ThumbnailTextTemplate[] = [
  'reference_classic',
  'reference_midline',
  'reference_compact',
  'challenge_stack',
  'reveal_punch',
  'bottom_banner',
  'corner_card'
];
const backgroundStyleOrder: ThumbnailBackgroundStyle[] = ['soft_stage', 'comic_burst', 'paper_stack', 'studio_frame'];
const exportFormatOptions: Array<{ value: ThumbnailExportFormat; label: string }> = [
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPG' },
  { value: 'webp', label: 'WebP' }
];

const DEFAULT_TEXT_BOXES: Record<ThumbnailTextTemplate, ThumbnailTransformBox> = {
  reference_classic: { x: 0.33, y: 0.2, width: 0.62, height: 0.3, rotation: 0 },
  reference_midline: { x: 0.36, y: 0.21, width: 0.68, height: 0.28, rotation: 0 },
  reference_compact: { x: 0.29, y: 0.2, width: 0.5, height: 0.25, rotation: 0 },
  challenge_stack: { x: 0.27, y: 0.22, width: 0.42, height: 0.28, rotation: 0 },
  reveal_punch: { x: 0.29, y: 0.24, width: 0.38, height: 0.26, rotation: -2 },
  bottom_banner: { x: 0.5, y: 0.18, width: 0.56, height: 0.24, rotation: 0 },
  corner_card: { x: 0.22, y: 0.24, width: 0.3, height: 0.24, rotation: -3 }
};

const DEFAULT_LAYOUT_BOXES: Record<
  ThumbnailLayoutPreset,
  { textBox?: ThumbnailTransformBox; puzzleCard: ThumbnailTransformBox; diffCard: ThumbnailTransformBox }
> = {
  square_split: {
    textBox: { x: 0.33, y: 0.2, width: 0.62, height: 0.3, rotation: 0 },
    puzzleCard: { x: 0.29, y: 0.67, width: 0.35, height: 0.35, rotation: 0 },
    diffCard: { x: 0.71, y: 0.67, width: 0.35, height: 0.35, rotation: 0 }
  },
  square_stagger: {
    textBox: { x: 0.34, y: 0.2, width: 0.6, height: 0.28, rotation: 0 },
    puzzleCard: { x: 0.31, y: 0.7, width: 0.34, height: 0.34, rotation: -3 },
    diffCard: { x: 0.69, y: 0.57, width: 0.34, height: 0.34, rotation: 3 }
  },
  puzzle_hero: {
    textBox: { x: 0.31, y: 0.2, width: 0.5, height: 0.28, rotation: 0 },
    puzzleCard: { x: 0.33, y: 0.66, width: 0.4, height: 0.4, rotation: 0 },
    diffCard: { x: 0.77, y: 0.58, width: 0.25, height: 0.25, rotation: 0 }
  },
  diff_hero: {
    textBox: { x: 0.3, y: 0.2, width: 0.5, height: 0.28, rotation: 0 },
    puzzleCard: { x: 0.23, y: 0.58, width: 0.25, height: 0.25, rotation: 0 },
    diffCard: { x: 0.67, y: 0.66, width: 0.4, height: 0.4, rotation: 0 }
  },
  top_bottom: {
    textBox: { x: 0.33, y: 0.18, width: 0.56, height: 0.26, rotation: 0 },
    puzzleCard: { x: 0.28, y: 0.74, width: 0.31, height: 0.31, rotation: 0 },
    diffCard: { x: 0.73, y: 0.5, width: 0.31, height: 0.31, rotation: 0 }
  }
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const createPairId = (baseName: string) => `${baseName}-${Math.random().toString(36).slice(2, 8)}`;
const createOverlayId = () => `overlay-${Math.random().toString(36).slice(2, 9)}`;
const sameLayer = (left: SelectedLayer, right: SelectedLayer) => {
  if (!left || !right) return left === right;
  if (left.kind !== right.kind) return false;
  return left.kind !== 'overlay' || right.kind !== 'overlay' || left.id === right.id;
};

const constrainTransform = (
  selected: SelectedLayer,
  next: ThumbnailTransformBox
): ThumbnailTransformBox => {
  const limits =
    selected?.kind === 'text'
      ? { minWidth: 0.18, minHeight: 0.14, maxWidth: 0.84, maxHeight: 0.46 }
      : selected?.kind === 'overlay'
        ? { minWidth: 0.05, minHeight: 0.05, maxWidth: 0.6, maxHeight: 0.6 }
        : { minWidth: 0.18, minHeight: 0.2, maxWidth: 0.68, maxHeight: 0.74 };
  const width = clamp(next.width, limits.minWidth, limits.maxWidth);
  const height = clamp(next.height, limits.minHeight, limits.maxHeight);
  const marginX = Math.min(0.49, Math.max(width / 2, 0.04));
  const marginY = Math.min(0.49, Math.max(height / 2, 0.04));
  return {
    ...next,
    width,
    height,
    x: clamp(next.x, marginX, 1 - marginX),
    y: clamp(next.y, marginY, 1 - marginY),
    rotation: clamp(next.rotation, -180, 180)
  };
};

const parseFilename = (filename: string) => {
  const name = filename.substring(0, filename.lastIndexOf('.')) || filename;
  if (name.toLowerCase().endsWith('diff')) {
    return { base: name.substring(0, name.length - 4), type: 'diff' as const };
  }
  return { base: name, type: 'base' as const };
};

const formatFileSize = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
};

const triggerBlobDownload = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

const loadImageElement = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load preview asset.'));
    image.src = src;
  });

const roundedRectPath = (ctx: CanvasRenderingContext2D, rect: Rect, radius: number) => {
  const safeRadius = Math.max(0, Math.min(radius, rect.width / 2, rect.height / 2));
  ctx.beginPath();
  ctx.moveTo(rect.x + safeRadius, rect.y);
  ctx.lineTo(rect.x + rect.width - safeRadius, rect.y);
  ctx.quadraticCurveTo(rect.x + rect.width, rect.y, rect.x + rect.width, rect.y + safeRadius);
  ctx.lineTo(rect.x + rect.width, rect.y + rect.height - safeRadius);
  ctx.quadraticCurveTo(rect.x + rect.width, rect.y + rect.height, rect.x + rect.width - safeRadius, rect.y + rect.height);
  ctx.lineTo(rect.x + safeRadius, rect.y + rect.height);
  ctx.quadraticCurveTo(rect.x, rect.y + rect.height, rect.x, rect.y + rect.height - safeRadius);
  ctx.lineTo(rect.x, rect.y + safeRadius);
  ctx.quadraticCurveTo(rect.x, rect.y, rect.x + safeRadius, rect.y);
  ctx.closePath();
};

const drawRoundedFill = (ctx: CanvasRenderingContext2D, rect: Rect, radius: number, fillStyle: string) => {
  ctx.save();
  roundedRectPath(ctx, rect, radius);
  ctx.fillStyle = fillStyle;
  ctx.fill();
  ctx.restore();
};

const drawRoundedStroke = (
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  radius: number,
  strokeStyle: string,
  lineWidth: number
) => {
  ctx.save();
  roundedRectPath(ctx, rect, radius);
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  ctx.restore();
};

const computeCoverFrame = (viewport: Rect, image: HTMLImageElement) => {
  const imageWidth = Math.max(1, image.naturalWidth || image.width);
  const imageHeight = Math.max(1, image.naturalHeight || image.height);
  const scale = Math.max(viewport.width / imageWidth, viewport.height / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return {
    x: viewport.x + (viewport.width - width) / 2,
    y: viewport.y + (viewport.height - height) / 2,
    width,
    height
  };
};

const drawImageCover = (
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  rect: Rect,
  radius: number,
  filter = ''
) => {
  const frame = computeCoverFrame(rect, image);
  ctx.save();
  roundedRectPath(ctx, rect, radius);
  ctx.clip();
  ctx.filter = filter;
  ctx.drawImage(image, frame.x, frame.y, frame.width, frame.height);
  ctx.restore();
};

const splitLines = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number) => {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines: string[] = [];
  let currentLine = words[0];
  for (let index = 1; index < words.length; index += 1) {
    const next = `${currentLine} ${words[index]}`;
    if (ctx.measureText(next).width <= maxWidth) currentLine = next;
    else {
      lines.push(currentLine);
      currentLine = words[index];
    }
  }
  lines.push(currentLine);
  return lines;
};

const fitWrappedText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxFontSize: number,
  minFontSize: number,
  maxLines: number
) => {
  const value = text.trim();
  if (!value) return { lines: [] as string[], fontSize: maxFontSize, lineHeight: maxFontSize * 0.9 };
  for (let fontSize = maxFontSize; fontSize >= minFontSize; fontSize -= 2) {
    ctx.font = `900 ${fontSize}px Outfit, Inter, sans-serif`;
    const lines = splitLines(ctx, value, maxWidth);
    if (lines.length <= maxLines) return { lines, fontSize, lineHeight: fontSize * 0.9 };
  }
  ctx.font = `900 ${minFontSize}px Outfit, Inter, sans-serif`;
  return { lines: splitLines(ctx, value, maxWidth).slice(0, maxLines), fontSize: minFontSize, lineHeight: minFontSize * 0.9 };
};

const getImageFilters = (settings: ThumbnailCreatorSettings) =>
  `brightness(${settings.imageBrightness}) contrast(${settings.imageContrast}) saturate(${settings.imageSaturation})`;

const drawBackgroundStyle = (
  ctx: CanvasRenderingContext2D,
  settings: ThumbnailCreatorSettings,
  width: number,
  height: number,
  includeBase = true
) => {
  if (includeBase) {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, settings.backgroundStart);
    gradient.addColorStop(1, settings.backgroundEnd);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  if (settings.backgroundStyle === 'comic_burst') {
    ctx.save();
    ctx.translate(width / 2, height * 0.45);
    for (let index = 0; index < 18; index += 1) {
      ctx.rotate((Math.PI * 2) / 18);
      ctx.fillStyle = index % 2 === 0 ? 'rgba(255,255,255,0.08)' : 'rgba(250,204,21,0.12)';
      ctx.fillRect(-18, -height * 0.58, 36, height * 0.36);
    }
    ctx.restore();
  } else if (settings.backgroundStyle === 'paper_stack') {
    ctx.fillStyle = 'rgba(255,248,220,0.12)';
    for (let x = 28; x < width; x += 44) {
      for (let y = 24; y < height; y += 44) {
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (settings.backgroundStyle === 'studio_frame') {
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(width * 0.04, height * 0.05, width * 0.92, height * 0.88);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 3;
    ctx.strokeRect(width * 0.07, height * 0.08, width * 0.86, height * 0.82);
  }

  const glow = ctx.createRadialGradient(width * 0.32, height * 0.24, 0, width * 0.32, height * 0.24, width * 0.4);
  glow.addColorStop(0, 'rgba(255,255,255,0.18)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
};

const drawRotatedCard = (
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  placement: CardPlacement,
  settings: ThumbnailCreatorSettings,
  label: string
) => {
  const centerX = placement.x + placement.width / 2;
  const centerY = placement.y + placement.height / 2;
  const frameRect = { x: -placement.width / 2, y: -placement.height / 2, width: placement.width, height: placement.height };
  const innerRect = { x: frameRect.x + 8, y: frameRect.y + 8, width: frameRect.width - 16, height: frameRect.height - 16 };
  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate((placement.rotation * Math.PI) / 180);
  ctx.shadowColor = 'rgba(15, 23, 42, 0.18)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 10;
  drawRoundedFill(ctx, frameRect, 28, settings.backgroundStyle === 'paper_stack' ? '#FFFDF5' : 'rgba(255,255,255,0.96)');
  ctx.shadowBlur = 0;
  drawImageCover(ctx, image, innerRect, 22, getImageFilters(settings));
  drawRoundedStroke(ctx, frameRect, 28, '#0F172A', 4);
  drawRoundedStroke(ctx, innerRect, 22, '#0F172A', 2);
  if (settings.backgroundStyle === 'paper_stack') {
    drawRoundedFill(ctx, { x: frameRect.x + 20, y: frameRect.y - 8, width: 56, height: 18 }, 6, 'rgba(250,204,21,0.8)');
    drawRoundedFill(ctx, { x: frameRect.x + frameRect.width - 76, y: frameRect.y - 8, width: 56, height: 18 }, 6, 'rgba(250,204,21,0.8)');
  }
  ctx.font = '900 16px Outfit, Inter, sans-serif';
  const labelWidth = Math.max(78, ctx.measureText(label).width + 20);
  const labelRect = { x: frameRect.x + 14, y: frameRect.y + 14, width: labelWidth, height: 26 };
  drawRoundedFill(ctx, labelRect, 999, 'rgba(255,255,255,0.92)');
  drawRoundedStroke(ctx, labelRect, 999, '#0F172A', 2);
  ctx.fillStyle = '#0F172A';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label.toUpperCase(), labelRect.x + labelRect.width / 2, labelRect.y + labelRect.height / 2 + 1);
  ctx.restore();
};

const drawTextGroup = (ctx: CanvasRenderingContext2D, settings: ThumbnailCreatorSettings, width: number, height: number) => {
  const box = settings.textBox;
  const boxWidth = width * box.width;
  const boxHeight = height * box.height;
  const centerX = width * box.x;
  const centerY = height * box.y;
  const titleText = settings.uppercaseTitle ? settings.title.toUpperCase() : settings.title;
  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate((box.rotation * Math.PI) / 180);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const originX = -boxWidth / 2;
  const originY = -boxHeight / 2;
  const padding = boxWidth * 0.07;
  const contentWidth = boxWidth - padding * 2;
  const isReferenceTemplate =
    settings.textTemplate === 'reference_classic' ||
    settings.textTemplate === 'reference_midline' ||
    settings.textTemplate === 'reference_compact';

  if (settings.textTemplate === 'corner_card') {
    drawRoundedFill(ctx, { x: originX, y: originY, width: boxWidth, height: boxHeight }, 28, 'rgba(15,23,42,0.76)');
    drawRoundedStroke(ctx, { x: originX, y: originY, width: boxWidth, height: boxHeight }, 28, 'rgba(255,255,255,0.18)', 2);
  }

  if (settings.textTemplate === 'reference_classic') {
    drawRoundedFill(ctx, { x: originX + padding, y: originY + boxHeight * 0.54, width: contentWidth, height: boxHeight * 0.2 }, 999, 'rgba(255,255,255,0.08)');
  }

  let cursorY = originY + padding;
  if (settings.eyebrow.trim()) {
    ctx.font = `900 ${boxHeight * (isReferenceTemplate ? 0.095 : 0.11)}px Outfit, Inter, sans-serif`;
    const eyebrowText = settings.eyebrow.trim().toUpperCase();
    const eyebrowWidth = Math.max(boxWidth * (isReferenceTemplate ? 0.18 : 0.28), ctx.measureText(eyebrowText).width + boxWidth * 0.08);
    const eyebrowRect = { x: originX + padding, y: cursorY, width: eyebrowWidth, height: boxHeight * (isReferenceTemplate ? 0.14 : 0.16) };
    drawRoundedFill(
      ctx,
      eyebrowRect,
      999,
      settings.textTemplate === 'bottom_banner' ? 'rgba(255,255,255,0.9)' : isReferenceTemplate ? 'rgba(255,255,255,0.92)' : settings.secondaryAccentColor
    );
    drawRoundedStroke(ctx, eyebrowRect, 999, '#0F172A', 2);
    ctx.fillStyle = '#0F172A';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(eyebrowText, eyebrowRect.x + eyebrowRect.width / 2, eyebrowRect.y + eyebrowRect.height / 2 + 1);
    cursorY += eyebrowRect.height + boxHeight * 0.05;
  }
  const titleFit = fitWrappedText(
    ctx,
    titleText,
    contentWidth,
    boxHeight * (
      settings.textTemplate === 'corner_card'
        ? 0.24
        : settings.textTemplate === 'reference_classic'
          ? 0.31
          : settings.textTemplate === 'reference_midline'
            ? 0.28
            : settings.textTemplate === 'reference_compact'
              ? 0.25
              : 0.28
    ),
    boxHeight * 0.13,
    settings.textTemplate === 'reference_compact' ? 2 : 3
  );
  ctx.font = `900 ${titleFit.fontSize}px Outfit, Inter, sans-serif`;
  titleFit.lines.forEach((line, index) => {
    const y = cursorY + index * titleFit.lineHeight;
    ctx.lineWidth = Math.max(4, titleFit.fontSize * (isReferenceTemplate ? 0.12 : 0.1));
    ctx.strokeStyle = settings.textTemplate === 'bottom_banner' ? '#0F172A' : 'rgba(15,23,42,0.86)';
    ctx.fillStyle = settings.textColor;
    ctx.strokeText(line, originX + padding, y);
    ctx.fillText(line, originX + padding, y);
  });
  cursorY += titleFit.lines.length * titleFit.lineHeight + boxHeight * (isReferenceTemplate ? 0.035 : 0.05);
  if (settings.subtitle.trim()) {
    ctx.font = `800 ${boxHeight * (isReferenceTemplate ? 0.125 : 0.1)}px Inter, sans-serif`;
    const subtitleLines = splitLines(ctx, settings.subtitle.trim(), contentWidth).slice(0, 2);
    if (settings.textTemplate === 'bottom_banner') {
      const bannerHeight = boxHeight * 0.18;
      const bannerY = originY + boxHeight - bannerHeight;
      drawRoundedFill(ctx, { x: originX + padding, y: bannerY, width: contentWidth, height: bannerHeight }, 18, settings.secondaryAccentColor);
      drawRoundedStroke(ctx, { x: originX + padding, y: bannerY, width: contentWidth, height: bannerHeight }, 18, '#0F172A', 2);
      ctx.fillStyle = '#0F172A';
      subtitleLines.forEach((line, index) => {
        ctx.fillText(line, originX + padding + 16, bannerY + 12 + index * boxHeight * 0.09);
      });
    } else if (settings.textTemplate === 'reference_midline') {
      ctx.fillStyle = settings.textColor;
      ctx.lineWidth = Math.max(3, boxHeight * 0.028);
      ctx.strokeStyle = 'rgba(15,23,42,0.88)';
      subtitleLines.forEach((line, index) => {
        const subtitleY = originY + boxHeight * 0.68 + index * boxHeight * 0.12;
        ctx.strokeText(line, originX + padding, subtitleY);
        ctx.fillText(line, originX + padding, subtitleY);
      });
    } else if (settings.textTemplate === 'reference_classic') {
      ctx.fillStyle = settings.textColor;
      ctx.lineWidth = Math.max(3, boxHeight * 0.03);
      ctx.strokeStyle = 'rgba(15,23,42,0.92)';
      subtitleLines.forEach((line, index) => {
        const subtitleY = originY + boxHeight * 0.6 + index * boxHeight * 0.12;
        ctx.strokeText(line, originX + padding, subtitleY);
        ctx.fillText(line, originX + padding, subtitleY);
      });
    } else if (settings.textTemplate === 'reference_compact') {
      drawRoundedFill(ctx, { x: originX + padding, y: originY + boxHeight * 0.66, width: contentWidth * 0.92, height: boxHeight * 0.18 }, 18, 'rgba(255,255,255,0.9)');
      drawRoundedStroke(ctx, { x: originX + padding, y: originY + boxHeight * 0.66, width: contentWidth * 0.92, height: boxHeight * 0.18 }, 18, '#0F172A', 2);
      ctx.fillStyle = '#0F172A';
      subtitleLines.forEach((line, index) => {
        ctx.fillText(line, originX + padding + 14, originY + boxHeight * 0.7 + index * boxHeight * 0.09);
      });
    } else {
      ctx.fillStyle = settings.textColor;
      subtitleLines.forEach((line, index) => {
        ctx.fillText(line, originX + padding, cursorY + index * boxHeight * 0.1);
      });
    }
  }
  ctx.restore();
};

const drawBurst = (ctx: CanvasRenderingContext2D, text: string, width: number) => {
  const radius = width * 0.05;
  const centerX = width * 0.92;
  const centerY = width * 0.075;
  ctx.save();
  ctx.beginPath();
  for (let index = 0; index < 28; index += 1) {
    const currentRadius = index % 2 === 0 ? radius : radius * 0.72;
    const angle = (Math.PI / 14) * index - Math.PI / 2;
    const x = centerX + Math.cos(angle) * currentRadius;
    const y = centerY + Math.sin(angle) * currentRadius;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = '#FACC15';
  ctx.fill();
  ctx.strokeStyle = '#0F172A';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = '#0F172A';
  ctx.font = `900 ${radius * 0.34}px Outfit, Inter, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text.toUpperCase(), centerX, centerY);
  ctx.restore();
};

const renderThumbnailScene = (
  canvas: HTMLCanvasElement,
  settings: ThumbnailCreatorSettings,
  assets: ThumbnailRenderAssets,
  size: { width: number; height: number }
) => {
  const width = Math.max(1, Math.round(size.width));
  const height = Math.max(1, Math.round(size.height));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to initialize thumbnail preview canvas.');

  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  drawBackgroundStyle(ctx, settings, width, height);
  drawImageCover(ctx, assets.puzzleImage, { x: 0, y: 0, width, height }, 0, `${getImageFilters(settings)} blur(${settings.backgroundBlur}px)`);
  ctx.fillStyle = `rgba(2, 6, 23, ${settings.backgroundDim})`;
  ctx.fillRect(0, 0, width, height);
  drawBackgroundStyle(ctx, settings, width, height, false);

  const puzzlePlacement = transformToCardPlacement(settings.puzzleCard, width, height);
  const diffPlacement = transformToCardPlacement(settings.diffCard, width, height);
  drawRotatedCard(ctx, assets.puzzleImage, puzzlePlacement, settings, 'Puzzle');
  drawRotatedCard(
    ctx,
    assets.diffImage,
    diffPlacement,
    {
      ...settings,
      imageBrightness: settings.diffImageBrightness,
      imageContrast: settings.diffImageContrast,
      imageSaturation: settings.diffImageSaturation
    },
    'Diff'
  );

  if (settings.showArrow) {
    ctx.save();
    ctx.strokeStyle = settings.secondaryAccentColor;
    ctx.lineWidth = width * 0.008;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(width * 0.5, height * 0.58);
    ctx.lineTo(width * 0.78, height * 0.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(width * 0.78, height * 0.5);
    ctx.lineTo(width * 0.745, height * 0.47);
    ctx.lineTo(width * 0.75, height * 0.525);
    ctx.closePath();
    ctx.fillStyle = settings.secondaryAccentColor;
    ctx.fill();
    ctx.restore();
  }

  drawTextGroup(ctx, settings, width, height);
  if (settings.showBurst && settings.burstText.trim()) drawBurst(ctx, settings.burstText.trim(), width);

  settings.overlayImages.forEach((item, index) => {
    const image = assets.overlayImages[index];
    const overlayWidth = width * item.width;
    const overlayHeight = height * item.height;
    const overlayX = width * item.x;
    const overlayY = height * item.y;
    ctx.save();
    ctx.translate(overlayX, overlayY);
    ctx.rotate((item.rotation * Math.PI) / 180);
    ctx.globalAlpha = item.opacity;
    ctx.shadowColor = 'rgba(15,23,42,0.18)';
    ctx.shadowBlur = 18;
    ctx.drawImage(image, -overlayWidth / 2, -overlayHeight / 2, overlayWidth, overlayHeight);
    ctx.restore();
  });
};

const buildExportFileName = (baseName: string, format: ThumbnailExportFormat) => {
  const extension = format === 'jpeg' ? 'jpg' : format;
  return `${baseName}-thumbnail.${extension}`;
};

const createOverlayItem = (name: string, src: string): ThumbnailOverlayItem => ({
  id: createOverlayId(),
  name,
  src,
  x: 0.78,
  y: 0.22,
  width: 0.16,
  height: 0.16,
  rotation: 0,
  opacity: 1
});

const getLayerTransform = (settings: ThumbnailCreatorSettings, selected: SelectedLayer): ThumbnailTransformBox | null => {
  if (!selected) return null;
  if (selected.kind === 'text') return settings.textBox;
  if (selected.kind === 'puzzle_card') return settings.puzzleCard;
  if (selected.kind === 'diff_card') return settings.diffCard;
  const overlay = settings.overlayImages.find((item) => item.id === selected.id);
  return overlay ? { x: overlay.x, y: overlay.y, width: overlay.width, height: overlay.height, rotation: overlay.rotation } : null;
};

const applyLayerTransform = (current: ThumbnailCreatorSettings, selected: SelectedLayer, next: ThumbnailTransformBox) => {
  if (!selected) return current;
  const constrained = constrainTransform(selected, next);
  if (selected.kind === 'text') return sanitizeThumbnailCreatorSettings({ ...current, textBox: constrained });
  if (selected.kind === 'puzzle_card') return sanitizeThumbnailCreatorSettings({ ...current, puzzleCard: constrained });
  if (selected.kind === 'diff_card') return sanitizeThumbnailCreatorSettings({ ...current, diffCard: constrained });
  return sanitizeThumbnailCreatorSettings({
    ...current,
    overlayImages: current.overlayImages.map((item) => (item.id === selected.id ? { ...item, ...constrained } : item))
  });
};

const transformToCardPlacement = (
  transform: ThumbnailTransformBox,
  width: number,
  height: number
): CardPlacement => ({
  x: width * transform.x - (width * transform.width) / 2,
  y: height * transform.y - (height * transform.height) / 2,
  width: width * transform.width,
  height: height * transform.height,
  rotation: transform.rotation
});

export function ThumbnailCreatorMode({
  onBack,
  defaultLogo,
  defaultLogoChromaKeyEnabled = false,
  defaultLogoChromaKeyColor = '#00FF00',
  defaultLogoChromaKeyTolerance = 70,
  embedded = false,
  externalPairs,
  activeExternalPairId,
  onActiveExternalPairChange
}: ThumbnailCreatorModeProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const batchInputRef = useRef<HTMLInputElement | null>(null);
  const puzzleInputRef = useRef<HTMLInputElement | null>(null);
  const diffInputRef = useRef<HTMLInputElement | null>(null);
  const overlayInputRef = useRef<HTMLInputElement | null>(null);
  const gestureRef = useRef<GestureState | null>(null);
  const imageCacheRef = useRef<Map<string, Promise<HTMLImageElement>>>(new Map());

  const [localPairs, setLocalPairs] = useState<ThumbnailPair[]>([]);
  const [localActivePairId, setLocalActivePairId] = useState('');
  const [settings, setSettings] = useState<ThumbnailCreatorSettings>(() => sanitizeThumbnailCreatorSettings(DEFAULT_THUMBNAIL_SETTINGS));
  const [presets, setPresets] = useState<ThumbnailPreset[]>(() => loadThumbnailPresets());
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [presetName, setPresetName] = useState('Template One');
  const [selectedLayer, setSelectedLayer] = useState<SelectedLayer>({ kind: 'text' });
  const [activeTool, setActiveTool] = useState<EditorTool>('text');
  const [status, setStatus] = useState('Load a puzzle image pair, pick a text template, and move the layers directly on the preview.');
  const [error, setError] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isInteracting, setIsInteracting] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [exportBytesEstimate, setExportBytesEstimate] = useState(0);
  const [previewCanvasSize, setPreviewCanvasSize] = useState({ width: 0, height: 0 });
  const [renderNonce, setRenderNonce] = useState(0);
  const usesExternalPairs = Array.isArray(externalPairs);
  const pairs = useMemo(() => externalPairs ?? localPairs, [externalPairs, localPairs]);

  const processedDefaultLogo = useProcessedLogoSrc(defaultLogo, {
    enabled: defaultLogoChromaKeyEnabled,
    color: defaultLogoChromaKeyColor,
    tolerance: defaultLogoChromaKeyTolerance
  });

  useEffect(() => {
    if (!pairs.length) {
      if (localActivePairId) setLocalActivePairId('');
      return;
    }

    const hasExternalActivePair =
      usesExternalPairs &&
      activeExternalPairId &&
      pairs.some((entry) => entry.id === activeExternalPairId);
    const desiredPairId = hasExternalActivePair ? activeExternalPairId : localActivePairId;

    if (!desiredPairId || !pairs.some((entry) => entry.id === desiredPairId)) {
      const nextPairId = pairs[0].id;
      setLocalActivePairId(nextPairId);
      if (usesExternalPairs) onActiveExternalPairChange?.(nextPairId);
      return;
    }

    if (hasExternalActivePair && activeExternalPairId !== localActivePairId) {
      setLocalActivePairId(activeExternalPairId);
    }
  }, [activeExternalPairId, localActivePairId, onActiveExternalPairChange, pairs, usesExternalPairs]);

  const activePairId =
    usesExternalPairs && activeExternalPairId && pairs.some((entry) => entry.id === activeExternalPairId)
      ? activeExternalPairId
      : localActivePairId;

  const setActivePairId = useCallback(
    (nextPairId: string) => {
      setLocalActivePairId(nextPairId);
      if (usesExternalPairs) onActiveExternalPairChange?.(nextPairId);
    },
    [onActiveExternalPairChange, usesExternalPairs]
  );

  const activePair = useMemo(() => pairs.find((entry) => entry.id === activePairId) ?? null, [pairs, activePairId]);
  const selectedOverlay = selectedLayer?.kind === 'overlay'
    ? settings.overlayImages.find((item) => item.id === selectedLayer.id) ?? null
    : null;
  const selectedTransform = getLayerTransform(settings, selectedLayer);
  const selectedLayerLabel =
    selectedLayer?.kind === 'text'
      ? 'Text'
      : selectedLayer?.kind === 'puzzle_card'
        ? 'Puzzle Card'
        : selectedLayer?.kind === 'diff_card'
          ? 'Diff Card'
        : selectedOverlay?.name ?? 'Overlay';

  const previewLayers = useMemo(
    () => [
      { key: 'puzzle', layer: { kind: 'puzzle_card' } as SelectedLayer, label: 'Puzzle', shortLabel: 'PZL', transform: settings.puzzleCard },
      { key: 'diff', layer: { kind: 'diff_card' } as SelectedLayer, label: 'Diff', shortLabel: 'DIF', transform: settings.diffCard },
      { key: 'text', layer: { kind: 'text' } as SelectedLayer, label: 'Text', shortLabel: 'TXT', transform: settings.textBox },
      ...settings.overlayImages.map((item) => ({
        key: item.id,
        layer: { kind: 'overlay', id: item.id } as SelectedLayer,
        label: item.name,
        shortLabel: 'OVR',
        transform: item
      }))
    ],
    [settings.diffCard, settings.overlayImages, settings.puzzleCard, settings.textBox]
  );
  const selectedPreviewLayer = previewLayers.find((entry) => sameLayer(selectedLayer, entry.layer)) ?? null;

  const loadCachedImage = (src: string) => {
    const cache = imageCacheRef.current;
    const existing = cache.get(src);
    if (existing) return existing;
    const next = loadImageElement(src).catch((error) => {
      cache.delete(src);
      throw error;
    });
    cache.set(src, next);
    return next;
  };

  const loadRenderAssets = async (pair: ThumbnailPair, currentSettings: ThumbnailCreatorSettings): Promise<ThumbnailRenderAssets> => {
    const overlayImages = await Promise.all(currentSettings.overlayImages.map((item) => loadCachedImage(item.src)));
    const [puzzleImage, diffImage] = await Promise.all([loadCachedImage(pair.puzzleSrc), loadCachedImage(pair.diffSrc)]);
    return { puzzleImage, diffImage, overlayImages };
  };

  const scoreSummary = useMemo(() => {
    const warnings: string[] = [];
    let score = 100;
    if (!activePair) return { score: 0, warnings: ['Load a puzzle pair to start.'] };
    if (settings.title.trim().length > 34) {
      score -= 16;
      warnings.push('Keep the title shorter for stronger small-card readability.');
    }
    if (settings.textBox.width < 0.24) {
      score -= 12;
      warnings.push('The text box is getting narrow. Scale it up on the preview if the title feels cramped.');
    }
    if (settings.overlayImages.length > 3) {
      score -= 10;
      warnings.push('Too many overlay images can make the thumbnail feel crowded.');
    }
    if (settings.diffImageContrast < 1) {
      score -= 6;
      warnings.push('The diff image is low contrast. It may feel flatter than the puzzle card.');
    }
    if (settings.diffImageSaturation > 1.8) {
      score -= 4;
      warnings.push('The diff image saturation is high. It can start to look unnatural.');
    }
    if (settings.showBurst && settings.overlayImages.some((item) => item.x > 0.7 && item.y < 0.35)) {
      score -= 8;
      warnings.push('Top-right overlays may fight with the burst badge.');
    }
    return { score: clamp(score, 0, 100), warnings };
  }, [activePair, settings]);

  const applyTextTemplate = (template: ThumbnailTextTemplate) => {
    const baseLayout = DEFAULT_LAYOUT_BOXES.square_split;
    const templatePatch: Partial<ThumbnailCreatorSettings> =
      template === 'reference_classic'
        ? {
            ...THUMBNAIL_THEME_PRESETS.arcade_burst.patch,
            theme: 'arcade_burst',
            layout: 'square_split',
            textTemplate: template,
            textBox: DEFAULT_TEXT_BOXES[template],
            backgroundStyle: 'soft_stage',
            showArrow: true,
            showBurst: true,
            burstText: settings.burstText || '3 DIFFS',
            puzzleCard: baseLayout.puzzleCard,
            diffCard: baseLayout.diffCard
          }
        : template === 'reference_midline'
          ? {
              ...THUMBNAIL_THEME_PRESETS.arcade_burst.patch,
              theme: 'arcade_burst',
              layout: 'square_split',
              textTemplate: template,
              textBox: DEFAULT_TEXT_BOXES[template],
              backgroundStyle: 'soft_stage',
              showArrow: true,
              showBurst: true,
              puzzleCard: baseLayout.puzzleCard,
              diffCard: baseLayout.diffCard
            }
          : template === 'reference_compact'
            ? {
                ...THUMBNAIL_THEME_PRESETS.arcade_burst.patch,
                theme: 'arcade_burst',
                layout: 'square_split',
                textTemplate: template,
                textBox: DEFAULT_TEXT_BOXES[template],
                backgroundStyle: 'soft_stage',
                showArrow: true,
                showBurst: false,
                puzzleCard: baseLayout.puzzleCard,
                diffCard: baseLayout.diffCard
              }
            : {
                textTemplate: template,
                textBox: DEFAULT_TEXT_BOXES[template]
              };
    setSettings((current) => sanitizeThumbnailCreatorSettings({ ...current, ...templatePatch }));
    setActiveTool('text');
    setSelectedLayer({ kind: 'text' });
  };

  const applyBackgroundStyle = (backgroundStyle: ThumbnailBackgroundStyle) => {
    setSettings((current) =>
      sanitizeThumbnailCreatorSettings({
        ...current,
        backgroundStyle
      })
    );
    setActiveTool('background');
    setSelectedLayer({ kind: 'diff_card' });
  };

  const applyLayoutTemplate = (layout: ThumbnailLayoutPreset) => {
    const nextLayout = DEFAULT_LAYOUT_BOXES[layout];
    setSettings((current) =>
      sanitizeThumbnailCreatorSettings({
        ...current,
        layout,
        textBox: nextLayout.textBox ?? current.textBox,
        puzzleCard: nextLayout.puzzleCard,
        diffCard: nextLayout.diffCard
      })
    );
    setActiveTool('cards');
    setSelectedLayer({ kind: 'diff_card' });
  };

  const startGesture = (event: React.PointerEvent<HTMLDivElement | HTMLButtonElement>, mode: GestureMode, nextSelected: SelectedLayer) => {
    if (!stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const currentTransform = getLayerTransform(settings, nextSelected);
    if (!currentTransform) return;
    event.preventDefault();
    event.stopPropagation();
    setIsInteracting(true);
    setSelectedLayer(nextSelected);
    gestureRef.current = {
      selected: nextSelected,
      mode,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startTransform: currentTransform,
      stageLeft: rect.left,
      stageTop: rect.top,
      stageWidth: rect.width,
      stageHeight: rect.height
    };
  };

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture) return;
      const dx = (event.clientX - gesture.startClientX) / gesture.stageWidth;
      const dy = (event.clientY - gesture.startClientY) / gesture.stageHeight;
      setSettings((current) => {
        const start = gesture.startTransform;
        if (gesture.mode === 'move') {
          return applyLayerTransform(current, gesture.selected, {
            ...start,
            x: start.x + dx,
            y: start.y + dy
          });
        }
        const centerX = start.x * gesture.stageWidth;
        const centerY = start.y * gesture.stageHeight;
        const startX = gesture.startClientX - gesture.stageLeft;
        const startY = gesture.startClientY - gesture.stageTop;
        const currentX = event.clientX - gesture.stageLeft;
        const currentY = event.clientY - gesture.stageTop;
        const startDist = Math.hypot(startX - centerX, startY - centerY);
        const currentDist = Math.hypot(currentX - centerX, currentY - centerY);
        if (gesture.mode === 'scale') {
          const factor = clamp(currentDist / Math.max(startDist, 1), 0.35, 3);
          return applyLayerTransform(current, gesture.selected, {
            ...start,
            width: start.width * factor,
            height: start.height * factor
          });
        }
        const startAngle = Math.atan2(startY - centerY, startX - centerX);
        const currentAngle = Math.atan2(currentY - centerY, currentX - centerX);
        return applyLayerTransform(current, gesture.selected, {
          ...start,
          rotation: start.rotation + ((currentAngle - startAngle) * 180) / Math.PI
        });
      });
    };
    const handleUp = () => {
      gestureRef.current = null;
      setIsInteracting(false);
      setRenderNonce((value) => value + 1);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, []);

  useEffect(() => {
    if (!selectedLayer) return;
    if (selectedLayer.kind === 'text') setActiveTool('text');
    else if (selectedLayer.kind === 'puzzle_card' || selectedLayer.kind === 'diff_card') setActiveTool('cards');
    else setActiveTool('overlays');
  }, [selectedLayer]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const updatePreviewSize = () => {
      const ratio = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 1.5) : 1;
      setPreviewCanvasSize({
        width: Math.max(1, Math.round(stage.clientWidth * ratio)),
        height: Math.max(1, Math.round(stage.clientHeight * ratio))
      });
    };

    updatePreviewSize();
    const observer = new ResizeObserver(updatePreviewSize);
    observer.observe(stage);
    window.addEventListener('resize', updatePreviewSize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updatePreviewSize);
    };
  }, []);

  const buildPairsFromFiles = async (files: File[]) => {
    const imageFiles = files.filter((file) => file.type.startsWith('image/'));
    if (!imageFiles.length) throw new Error('Select image files only.');
    const grouped = new Map<string, { base?: File; diff?: File }>();
    imageFiles.forEach((file) => {
      const { base, type } = parseFilename(file.name);
      if (!grouped.has(base)) grouped.set(base, {});
      const entry = grouped.get(base)!;
      if (type === 'base') entry.base = file;
      else entry.diff = file;
    });
    const validPairs = Array.from(grouped.entries()).filter(([, pair]) => pair.base && pair.diff) as Array<[string, { base: File; diff: File }]>;
    if (!validPairs.length) {
      if (imageFiles.length === 2) return [{ baseName: 'puzzle', base: imageFiles[0], diff: imageFiles[1] }];
      throw new Error('No valid pair found. Use names like scene1.png and scene1diff.png.');
    }
    return validPairs.map(([baseName, pair]) => ({ baseName, base: pair.base, diff: pair.diff }));
  };

  const loadPairsFromFiles = async (files: File[] | FileList | null) => {
    const rawFiles = Array.isArray(files) ? files : files ? Array.from(files) : [];
    if (!rawFiles.length) return;
    setError(null);
    try {
      const validPairs = await buildPairsFromFiles(rawFiles);
      const nextPairs = await Promise.all(
        validPairs.map(async (pair) => ({
          id: createPairId(pair.baseName),
          baseName: pair.baseName,
          puzzleFileName: pair.base.name,
          diffFileName: pair.diff.name,
          puzzleSrc: await readFileAsDataUrl(pair.base),
          diffSrc: await readFileAsDataUrl(pair.diff)
        }))
      );
      setLocalPairs(nextPairs);
      setLocalActivePairId(nextPairs[0]?.id ?? '');
      setActiveTool('source');
      setStatus(nextPairs.length === 1 ? `Loaded ${nextPairs[0].puzzleFileName} and ${nextPairs[0].diffFileName}.` : `Loaded ${nextPairs.length} puzzle pairs.`);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load image pair.');
    }
  };

  const replaceCurrentImage = async (kind: 'puzzle' | 'diff', file: File | null) => {
    if (usesExternalPairs) return;
    if (!file || !activePair) return;
    const nextSrc = await readFileAsDataUrl(file);
    setLocalPairs((current) =>
      current.map((pair) =>
        pair.id === activePair.id
          ? {
              ...pair,
              puzzleSrc: kind === 'puzzle' ? nextSrc : pair.puzzleSrc,
              diffSrc: kind === 'diff' ? nextSrc : pair.diffSrc,
              puzzleFileName: kind === 'puzzle' ? file.name : pair.puzzleFileName,
              diffFileName: kind === 'diff' ? file.name : pair.diffFileName
            }
          : pair
      )
    );
  };

  const addOverlayFromFile = async (file: File | null) => {
    if (!file) return;
    const src = await readFileAsDataUrl(file);
    const overlay = createOverlayItem(file.name.replace(/\.[^.]+$/, ''), src);
    setSettings((current) => sanitizeThumbnailCreatorSettings({ ...current, overlayImages: [...current.overlayImages, overlay] }));
    setActiveTool('overlays');
    setSelectedLayer({ kind: 'overlay', id: overlay.id });
    setStatus(`Added overlay ${overlay.name}. Drag it on the preview to place it.`);
  };

  const addAppLogoOverlay = () => {
    if (!processedDefaultLogo) return;
    const overlay = createOverlayItem('App Logo', processedDefaultLogo);
    setSettings((current) => sanitizeThumbnailCreatorSettings({ ...current, overlayImages: [...current.overlayImages, overlay] }));
    setActiveTool('overlays');
    setSelectedLayer({ kind: 'overlay', id: overlay.id });
  };

  const removeSelectedOverlay = () => {
    if (!selectedOverlay) return;
    setSettings((current) => sanitizeThumbnailCreatorSettings({ ...current, overlayImages: current.overlayImages.filter((item) => item.id !== selectedOverlay.id) }));
    setSelectedLayer({ kind: 'text' });
  };

  const exportThumbnail = async () => {
    if (!activePair) return;
    const mimeType = settings.exportFormat === 'jpeg' ? 'image/jpeg' : settings.exportFormat === 'webp' ? 'image/webp' : 'image/png';
    const quality = settings.exportFormat === 'png' ? undefined : settings.exportQuality / 100;
    const fileName = buildExportFileName(activePair.baseName, settings.exportFormat);
    try {
      const assets = await loadRenderAssets(activePair, settings);
      const size = THUMBNAIL_EXPORT_SIZE_MAP[settings.exportSize];
      const exportCanvas = document.createElement('canvas');
      renderThumbnailScene(exportCanvas, settings, assets, size);
      const blob = await new Promise<Blob | null>((resolve) => exportCanvas.toBlob(resolve, mimeType, quality));
      if (!blob) {
        setError('Failed to export the thumbnail.');
        return;
      }
      triggerBlobDownload(blob, fileName);
      setStatus(`Exported ${fileName}.`);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'Failed to export the thumbnail.');
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !activePair) {
      setPreviewDataUrl(null);
      setExportBytesEstimate(0);
      return;
    }
    let cancelled = false;
    const render = async () => {
      if (!isInteracting) setIsRendering(true);
      try {
        const assets = await loadRenderAssets(activePair, settings);
        if (cancelled) return;
        const exportSize = THUMBNAIL_EXPORT_SIZE_MAP[settings.exportSize];
        const previewSize =
          previewCanvasSize.width > 0 && previewCanvasSize.height > 0
            ? previewCanvasSize
            : exportSize;
        renderThumbnailScene(canvas, settings, assets, previewSize);
        if (!gestureRef.current) setPreviewDataUrl(canvas.toDataURL('image/png'));
        setExportBytesEstimate(Math.round((exportSize.width * exportSize.height * 4) / 3));
      } catch (renderError) {
        if (!cancelled) setError(renderError instanceof Error ? renderError.message : 'Thumbnail preview render failed.');
      } finally {
        if (!cancelled) setIsRendering(false);
      }
    };
    void render();
    return () => {
      cancelled = true;
    };
  }, [activePair, settings, previewCanvasSize, isInteracting, renderNonce]);

  const handleReset = () => {
    setSettings(
      sanitizeThumbnailCreatorSettings({
        ...DEFAULT_THUMBNAIL_SETTINGS,
        textBox: DEFAULT_TEXT_BOXES.challenge_stack,
        ...DEFAULT_LAYOUT_BOXES.square_split
      })
    );
    setActiveTool('text');
    setSelectedLayer({ kind: 'text' });
    setStatus('Template reset to the clean default.');
  };

  const toolItems: Array<{ key: EditorTool; label: string; icon: typeof ImagePlus }> = [
    { key: 'source', label: 'Source', icon: ImagePlus },
    { key: 'text', label: 'Text', icon: Type },
    { key: 'background', label: 'Scene', icon: Layers3 },
    { key: 'cards', label: 'Cards', icon: Camera },
    { key: 'overlays', label: 'Overlay', icon: Upload },
    { key: 'export', label: 'Export', icon: Save }
  ];

  const renderInspector = () => {
    switch (activeTool) {
      case 'source':
        return (
          <div className="space-y-3">
            <div className="rounded-2xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
              {usesExternalPairs
                ? 'Using the linked puzzle pairs from Editor Mode. Pick the active pair here and style/export below.'
                : 'Load `name.png` and `namediff.png`, then replace either side if needed.'}
            </div>
            {!usesExternalPairs && (
              <button onClick={() => batchInputRef.current?.click()} className={`${compactActionButtonClass} w-full bg-[#DBEAFE] hover:bg-[#BFDBFE]`}>
                <ImagePlus size={14} strokeWidth={2.5} />
                Load Puzzle + Diff
              </button>
            )}
            {pairs.length > 1 && (
              <label className="block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">
                Active Pair
                <select value={activePairId} onChange={(event) => setActivePairId(event.target.value)} className={compactInputClass}>
                  {pairs.map((pair) => (
                    <option key={pair.id} value={pair.id}>
                      {pair.baseName}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {activePair ? (
              <div className="space-y-2 rounded-2xl border border-slate-300 bg-white p-3">
                <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{activePair.baseName}</div>
                <div className="text-xs font-medium text-slate-600">{activePair.puzzleFileName}</div>
                <div className="text-xs font-medium text-slate-600">{activePair.diffFileName}</div>
                {!usesExternalPairs && (
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button onClick={() => puzzleInputRef.current?.click()} className={compactActionButtonClass}>Puzzle</button>
                    <button onClick={() => diffInputRef.current?.click()} className={compactActionButtonClass}>Diff</button>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-center text-xs font-medium text-slate-500">
                {usesExternalPairs ? 'No linked pairs available' : 'No pair loaded'}
              </div>
            )}
          </div>
        );
      case 'text':
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {textTemplateOrder.map((key) => {
                const template = THUMBNAIL_TEXT_TEMPLATES[key];
                const selected = settings.textTemplate === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => applyTextTemplate(key)}
                    className={`rounded-xl border-2 border-slate-900 px-3 py-2 text-left ${selected ? 'bg-slate-900 text-white' : 'bg-white hover:bg-slate-50'}`}
                  >
                    <div className="text-[11px] font-black uppercase leading-tight">{template.label}</div>
                    {key.startsWith('reference_') && (
                      <div className={`mt-1 text-[9px] font-bold uppercase tracking-[0.16em] ${selected ? 'text-slate-200' : 'text-slate-500'}`}>
                        Reference
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            <button type="button" onClick={() => setSelectedLayer({ kind: 'text' })} className={`${compactActionButtonClass} w-full ${selectedLayer?.kind === 'text' ? 'bg-[#EDE9FE]' : 'bg-white'}`}>
              <Type size={14} strokeWidth={2.5} />
              Edit Text Box
            </button>
            <label className="block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">
              Top Tag
              <input
                value={settings.eyebrow}
                onChange={(event) => setSettings((current) => sanitizeThumbnailCreatorSettings({ ...current, eyebrow: event.target.value }))}
                className={compactInputClass}
              />
            </label>
            <label className="block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">
              Title
              <textarea
                rows={3}
                value={settings.title}
                onChange={(event) => setSettings((current) => sanitizeThumbnailCreatorSettings({ ...current, title: event.target.value }))}
                className={`${compactInputClass} min-h-[88px] resize-none`}
              />
            </label>
            <label className="block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">
              Subtitle
              <textarea
                rows={2}
                value={settings.subtitle}
                onChange={(event) => setSettings((current) => sanitizeThumbnailCreatorSettings({ ...current, subtitle: event.target.value }))}
                className={`${compactInputClass} min-h-[64px] resize-none`}
              />
            </label>
            <button
              type="button"
              onClick={() => setSettings((current) => sanitizeThumbnailCreatorSettings({ ...current, uppercaseTitle: !current.uppercaseTitle }))}
              className={`w-full rounded-lg border-2 border-slate-900 px-3 py-2 text-xs font-bold ${settings.uppercaseTitle ? 'bg-[#EDE9FE]' : 'bg-white hover:bg-slate-50'}`}
            >
              Uppercase {settings.uppercaseTitle ? 'On' : 'Off'}
            </button>
          </div>
        );
      case 'background':
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {backgroundStyleOrder.map((key) => {
                const style = THUMBNAIL_BACKGROUND_STYLES[key];
                const selected = settings.backgroundStyle === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => applyBackgroundStyle(key)}
                    className={`rounded-xl border-2 border-slate-900 px-3 py-2 text-left ${selected ? 'bg-slate-900 text-white' : 'bg-white hover:bg-slate-50'}`}
                  >
                    <div className="text-[11px] font-black uppercase">{style.label}</div>
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {themeOrder.map((key) => {
                const theme = THUMBNAIL_THEME_PRESETS[key];
                const selected = settings.theme === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSettings((current) => sanitizeThumbnailCreatorSettings({ ...current, ...theme.patch, theme: key }))}
                    className={`rounded-lg border-2 border-slate-900 px-3 py-2 text-[11px] font-black uppercase ${selected ? 'bg-[#DBEAFE]' : 'bg-white hover:bg-slate-50'}`}
                  >
                    {theme.label}
                  </button>
                );
              })}
            </div>
            <label className="block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">
              Background Blur ({Math.round(settings.backgroundBlur)}px)
              <input
                type="range"
                min={2}
                max={24}
                step={1}
                value={settings.backgroundBlur}
                onChange={(event) => setSettings((current) => sanitizeThumbnailCreatorSettings({ ...current, backgroundBlur: Number(event.target.value) }))}
                className={rangeClass}
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSettings((current) => sanitizeThumbnailCreatorSettings({ ...current, showArrow: !current.showArrow }))}
                className={`rounded-lg border-2 border-slate-900 px-3 py-2 text-xs font-bold ${settings.showArrow ? 'bg-[#DBEAFE]' : 'bg-white hover:bg-slate-50'}`}
              >
                Arrow {settings.showArrow ? 'On' : 'Off'}
              </button>
              <button
                type="button"
                onClick={() => setSettings((current) => sanitizeThumbnailCreatorSettings({ ...current, showBurst: !current.showBurst }))}
                className={`rounded-lg border-2 border-slate-900 px-3 py-2 text-xs font-bold ${settings.showBurst ? 'bg-[#FEF3C7]' : 'bg-white hover:bg-slate-50'}`}
              >
                Burst {settings.showBurst ? 'On' : 'Off'}
              </button>
            </div>
            {settings.showBurst && (
              <label className="block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">
                Burst Text
                <input
                  value={settings.burstText}
                  onChange={(event) => setSettings((current) => sanitizeThumbnailCreatorSettings({ ...current, burstText: event.target.value }))}
                  className={compactInputClass}
                />
              </label>
            )}
          </div>
        );
      case 'cards':
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-2">
              {layoutOrder.map((layout) => {
                const template = THUMBNAIL_LAYOUT_TEMPLATES[layout];
                const selected = settings.layout === layout;
                return (
                  <button
                    key={layout}
                    type="button"
                    onClick={() => applyLayoutTemplate(layout)}
                    className={`rounded-xl border-2 border-slate-900 px-3 py-2 text-left ${selected ? 'bg-slate-900 text-white' : 'bg-white hover:bg-slate-50'}`}
                  >
                    <div className="text-[11px] font-black uppercase">{template.label}</div>
                    <div className={`mt-0.5 text-[10px] font-medium ${selected ? 'text-slate-200' : 'text-slate-500'}`}>{template.description}</div>
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSelectedLayer({ kind: 'puzzle_card' })}
                className={`rounded-lg border-2 border-slate-900 px-3 py-2 text-xs font-bold ${selectedLayer?.kind === 'puzzle_card' ? 'bg-[#DBEAFE]' : 'bg-white hover:bg-slate-50'}`}
              >
                Puzzle
              </button>
              <button
                type="button"
                onClick={() => setSelectedLayer({ kind: 'diff_card' })}
                className={`rounded-lg border-2 border-slate-900 px-3 py-2 text-xs font-bold ${selectedLayer?.kind === 'diff_card' ? 'bg-[#FEF3C7]' : 'bg-white hover:bg-slate-50'}`}
              >
                Diff
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() =>
                  setSettings((current) =>
                    sanitizeThumbnailCreatorSettings({
                      ...current,
                      puzzleCard: DEFAULT_LAYOUT_BOXES[current.layout].puzzleCard,
                      diffCard: DEFAULT_LAYOUT_BOXES[current.layout].diffCard,
                      textBox: DEFAULT_LAYOUT_BOXES[current.layout].textBox ?? current.textBox
                    })
                  )
                }
                className={compactActionButtonClass}
              >
                Reset Cards
              </button>
              <button
                type="button"
                onClick={() =>
                  setSettings((current) =>
                    sanitizeThumbnailCreatorSettings({
                      ...current,
                      diffImageBrightness: DEFAULT_THUMBNAIL_SETTINGS.diffImageBrightness,
                      diffImageContrast: DEFAULT_THUMBNAIL_SETTINGS.diffImageContrast,
                      diffImageSaturation: DEFAULT_THUMBNAIL_SETTINGS.diffImageSaturation
                    })
                  )
                }
                className={compactActionButtonClass}
              >
                Reset Diff
              </button>
            </div>
            <label className="block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">
              Diff Brightness ({settings.diffImageBrightness.toFixed(2)})
              <input
                type="range"
                min={0.7}
                max={1.7}
                step={0.02}
                value={settings.diffImageBrightness}
                onChange={(event) => setSettings((current) => sanitizeThumbnailCreatorSettings({ ...current, diffImageBrightness: Number(event.target.value) }))}
                className={rangeClass}
              />
            </label>
            <label className="block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">
              Diff Contrast ({settings.diffImageContrast.toFixed(2)})
              <input
                type="range"
                min={0.8}
                max={2}
                step={0.02}
                value={settings.diffImageContrast}
                onChange={(event) => setSettings((current) => sanitizeThumbnailCreatorSettings({ ...current, diffImageContrast: Number(event.target.value) }))}
                className={rangeClass}
              />
            </label>
            <label className="block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">
              Diff Saturation ({settings.diffImageSaturation.toFixed(2)})
              <input
                type="range"
                min={0.5}
                max={2.2}
                step={0.02}
                value={settings.diffImageSaturation}
                onChange={(event) => setSettings((current) => sanitizeThumbnailCreatorSettings({ ...current, diffImageSaturation: Number(event.target.value) }))}
                className={rangeClass}
              />
            </label>
          </div>
        );
      case 'overlays':
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-2">
              <button onClick={() => overlayInputRef.current?.click()} className={compactActionButtonClass}>
                <Upload size={14} strokeWidth={2.5} />
                Add Overlay
              </button>
              {processedDefaultLogo && <button onClick={addAppLogoOverlay} className={compactActionButtonClass}>Use App Logo</button>}
              <button onClick={removeSelectedOverlay} disabled={!selectedOverlay} className={compactActionButtonClass}>
                <Trash2 size={14} strokeWidth={2.5} />
                Remove Selected
              </button>
            </div>
            {selectedOverlay && (
              <label className="block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">
                Overlay Opacity ({Math.round(selectedOverlay.opacity * 100)}%)
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={selectedOverlay.opacity}
                  onChange={(event) =>
                    setSettings((current) =>
                      sanitizeThumbnailCreatorSettings({
                        ...current,
                        overlayImages: current.overlayImages.map((item) =>
                          item.id === selectedOverlay.id ? { ...item, opacity: Number(event.target.value) } : item
                        )
                      })
                    )
                  }
                  className={rangeClass}
                />
              </label>
            )}
            <div className="max-h-64 space-y-2 overflow-auto pr-1">
              {settings.overlayImages.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-5 text-center text-xs font-medium text-slate-500">
                  No overlays yet
                </div>
              ) : (
                settings.overlayImages.map((item) => {
                  const selected = selectedOverlay?.id === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedLayer({ kind: 'overlay', id: item.id })}
                      className={`w-full rounded-xl border-2 border-slate-900 px-3 py-2 text-left ${selected ? 'bg-slate-900 text-white' : 'bg-white hover:bg-slate-50'}`}
                    >
                      <div className="truncate text-xs font-black uppercase">{item.name}</div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        );
      case 'export':
      default:
        return (
          <div className="space-y-3">
            <label className="block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">
              Preset Name
              <input value={presetName} onChange={(event) => setPresetName(event.target.value)} className={compactInputClass} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  const next = saveThumbnailPreset(presetName, settings, selectedPresetId || undefined);
                  setPresets(next);
                  setSelectedPresetId(next[0].id);
                  setPresetName(next[0].name);
                }}
                className={`${compactActionButtonClass} bg-[#DCFCE7] hover:bg-[#BBF7D0]`}
              >
                <Save size={14} strokeWidth={2.5} />
                Save
              </button>
              <button
                onClick={() => {
                  if (!selectedPresetId) return;
                  const next = deleteThumbnailPreset(selectedPresetId);
                  setPresets(next);
                  setSelectedPresetId('');
                }}
                disabled={!selectedPresetId}
                className={compactActionButtonClass}
              >
                <Trash2 size={14} strokeWidth={2.5} />
                Delete
              </button>
            </div>
            <div className="max-h-44 space-y-2 overflow-auto pr-1">
              {presets.slice(0, 8).map((preset) => {
                const selected = preset.id === selectedPresetId;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      setSelectedPresetId(preset.id);
                      setPresetName(preset.name);
                      setSettings(sanitizeThumbnailCreatorSettings(preset.settings));
                      setSelectedLayer({ kind: 'text' });
                    }}
                    className={`w-full rounded-xl border-2 border-slate-900 px-3 py-2 text-left ${selected ? 'bg-slate-900 text-white' : 'bg-white hover:bg-slate-50'}`}
                  >
                    <div className="text-xs font-black">{preset.name}</div>
                    <div className={`mt-0.5 text-[10px] font-medium ${selected ? 'text-slate-200' : 'text-slate-500'}`}>
                      {THUMBNAIL_TEXT_TEMPLATES[preset.settings.textTemplate].label}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">
                Format
                <select
                  value={settings.exportFormat}
                  onChange={(event) => setSettings((current) => sanitizeThumbnailCreatorSettings({ ...current, exportFormat: event.target.value as ThumbnailExportFormat }))}
                  className={compactInputClass}
                >
                  {exportFormatOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">
                Resolution
                <select
                  value={settings.exportSize}
                  onChange={(event) =>
                    setSettings((current) =>
                      sanitizeThumbnailCreatorSettings({ ...current, exportSize: event.target.value as ThumbnailCreatorSettings['exportSize'] })
                    )
                  }
                  className={compactInputClass}
                >
                  <option value="1280x720">1280x720</option>
                  <option value="1920x1080">1920x1080</option>
                </select>
              </label>
            </div>
            {settings.exportFormat !== 'png' && (
              <label className="block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">
                Quality ({Math.round(settings.exportQuality)}%)
                <input
                  type="range"
                  min={50}
                  max={100}
                  step={1}
                  value={settings.exportQuality}
                  onChange={(event) => setSettings((current) => sanitizeThumbnailCreatorSettings({ ...current, exportQuality: Number(event.target.value) }))}
                  className={rangeClass}
                />
              </label>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button onClick={handleReset} className={compactActionButtonClass}>
                <RefreshCcw size={14} strokeWidth={2.5} />
                Reset
              </button>
              <button onClick={exportThumbnail} disabled={!activePair} className={`${compactActionButtonClass} bg-[#FEF3C7] hover:bg-[#FDE68A]`}>
                <Download size={14} strokeWidth={2.5} />
                Export
              </button>
            </div>
          </div>
        );
    }
  };

  return (
    <div className={embedded ? 'w-full' : 'mx-auto w-full max-w-7xl p-3 sm:p-4 md:p-6'}>
      <div
        className={
          embedded
            ? 'overflow-hidden rounded-2xl border-4 border-black bg-[#F8FAFC] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]'
            : 'overflow-hidden rounded-[24px] border-2 border-slate-900 bg-[#F8FAFC] shadow-[0_18px_45px_rgba(15,23,42,0.08)]'
        }
      >
        <div className="border-b-2 border-slate-900 bg-white p-4 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3">
              {!embedded && onBack && (
                <button onClick={onBack} className="rounded-xl border-2 border-slate-900 bg-white p-3 hover:bg-slate-100" aria-label="Back">
                  <ArrowLeft size={20} strokeWidth={2.6} />
                </button>
              )}
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">
                  {embedded ? 'Pair Thumbnail Workspace' : 'Thumbnail Creator'}
                </div>
                <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950">
                  {embedded ? 'Pair Thumbnail Editor' : 'Compact Thumbnail Editor'}
                </h1>
                <p className="mt-2 max-w-3xl text-sm font-medium text-slate-600">
                  {usesExternalPairs
                    ? 'This workspace uses the linked pairs from Editor Mode. Select a pair in Source, place the layers on the preview, and export a thumbnail directly from here.'
                    : 'A simpler photo-editor style workspace for puzzle thumbnails with direct layer control on the preview.'}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border-2 border-slate-900 bg-white px-3 py-1 text-xs font-bold text-slate-800">16:9 locked</span>
              <span className="rounded-full border-2 border-slate-900 bg-white px-3 py-1 text-xs font-bold text-slate-800">{settings.exportSize}</span>
              <span className="rounded-full border-2 border-slate-900 bg-white px-3 py-1 text-xs font-bold text-slate-800">{activePair ? activePair.baseName : 'No pair loaded'}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 p-4 sm:p-5 xl:grid-cols-[minmax(0,1.55fr)_330px]">
          <section className="space-y-4">
            <div className={`${cardClass} space-y-4`}>
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Preview</div>
                  <div className="mt-1 text-xl font-black text-slate-950">Compact Editor</div>
                  <div className="mt-1 text-sm font-medium text-slate-600">{isRendering ? 'Rendering preview...' : 'Select a layer, then drag to move, use the corners to scale, and the top handle to rotate.'}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!usesExternalPairs && (
                    <button onClick={() => batchInputRef.current?.click()} className={`${compactActionButtonClass} bg-[#DBEAFE] hover:bg-[#BFDBFE]`}><Upload size={14} strokeWidth={2.5} />Load Pair</button>
                  )}
                  <button onClick={exportThumbnail} disabled={!activePair} className={`${compactActionButtonClass} bg-[#FEF3C7] hover:bg-[#FDE68A]`}><Download size={14} strokeWidth={2.5} />Export</button>
                </div>
              </div>

              <div
                onDragEnter={
                  usesExternalPairs
                    ? undefined
                    : (event) => {
                        event.preventDefault();
                        setIsDragActive(true);
                      }
                }
                onDragLeave={
                  usesExternalPairs
                    ? undefined
                    : (event) => {
                        event.preventDefault();
                        setIsDragActive(false);
                      }
                }
                onDragOver={
                  usesExternalPairs
                    ? undefined
                    : (event) => {
                        event.preventDefault();
                      }
                }
                onDrop={
                  usesExternalPairs
                    ? undefined
                    : (event: DragEvent<HTMLDivElement>) => {
                        event.preventDefault();
                        setIsDragActive(false);
                        void loadPairsFromFiles(event.dataTransfer.files);
                      }
                }
                className={`relative overflow-hidden rounded-[22px] border-2 border-slate-900 bg-white ${!usesExternalPairs && isDragActive ? 'ring-4 ring-sky-300' : ''}`}
              >
                <div ref={stageRef} className="relative aspect-video bg-[#0F172A]">
                  <canvas ref={canvasRef} className="h-full w-full" />
                  <div className="pointer-events-none absolute inset-0">
                    <div className="absolute left-[6%] top-[7%] h-[86%] w-[88%] rounded-[18px] border border-dashed border-white/55" />
                    <div className="absolute left-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-700">Safe zone</div>
                  </div>

                  {activePair && (
                    <div className="absolute inset-0">
                      {previewLayers.filter((entry) => entry.layer.kind !== 'text' && !sameLayer(entry.layer, selectedLayer)).map((entry) => (
                        <button
                          key={`hit-${entry.key}`}
                          type="button"
                          aria-label={`Select ${entry.label}`}
                          className="absolute rounded-[20px] bg-transparent transition-shadow hover:shadow-[0_0_0_1px_rgba(255,255,255,0.45)]"
                          style={{
                            left: `${entry.transform.x * 100}%`,
                            top: `${entry.transform.y * 100}%`,
                            width: `${entry.transform.width * 100}%`,
                            height: `${entry.transform.height * 100}%`,
                            transform: `translate(-50%, -50%) rotate(${entry.transform.rotation}deg)`
                          }}
                          onPointerDown={(event) => startGesture(event, 'move', entry.layer)}
                        />
                      ))}

                      {selectedPreviewLayer && (
                        <div
                          className="absolute"
                          style={{
                            left: `${selectedPreviewLayer.transform.x * 100}%`,
                            top: `${selectedPreviewLayer.transform.y * 100}%`,
                            width: `${selectedPreviewLayer.transform.width * 100}%`,
                            height: `${selectedPreviewLayer.transform.height * 100}%`,
                            transform: `translate(-50%, -50%) rotate(${selectedPreviewLayer.transform.rotation}deg)`
                          }}
                        >
                          <div className="relative h-full w-full cursor-move rounded-[18px] border-2 border-sky-300 bg-sky-300/10 shadow-[0_0_0_1px_rgba(125,211,252,0.88),0_18px_34px_rgba(56,189,248,0.22)]" onPointerDown={(event) => startGesture(event, 'move', selectedPreviewLayer.layer)}>
                            <div className="absolute inset-[5px] rounded-[14px] border border-dashed border-sky-200/90" />
                            <div className="absolute left-3 top-3 rounded-full bg-slate-950/90 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-white shadow-[0_8px_18px_rgba(15,23,42,0.24)]">{selectedPreviewLayer.label}</div>
                            <div className="absolute left-1/2 top-0 h-6 w-px -translate-x-1/2 -translate-y-full bg-sky-300/90" />
                            <button type="button" className="absolute left-1/2 top-0 flex h-7 w-7 -translate-x-1/2 -translate-y-[calc(100%+0.2rem)] items-center justify-center rounded-full border-2 border-sky-300 bg-white text-sky-600 shadow-[0_8px_20px_rgba(56,189,248,0.24)]" onPointerDown={(event) => startGesture(event, 'rotate', selectedPreviewLayer.layer)}><RotateCw size={11} /></button>
                            <button type="button" className="absolute -left-2.5 -top-2.5 h-5 w-5 rounded-full border-2 border-sky-300 bg-white shadow-[0_6px_14px_rgba(56,189,248,0.18)]" onPointerDown={(event) => startGesture(event, 'scale', selectedPreviewLayer.layer)} />
                            <button type="button" className="absolute -right-2.5 -top-2.5 h-5 w-5 rounded-full border-2 border-sky-300 bg-white shadow-[0_6px_14px_rgba(56,189,248,0.18)]" onPointerDown={(event) => startGesture(event, 'scale', selectedPreviewLayer.layer)} />
                            <button type="button" className="absolute -left-2.5 -bottom-2.5 h-5 w-5 rounded-full border-2 border-sky-300 bg-white shadow-[0_6px_14px_rgba(56,189,248,0.18)]" onPointerDown={(event) => startGesture(event, 'scale', selectedPreviewLayer.layer)} />
                            <button type="button" className="absolute -right-2.5 -bottom-2.5 h-5 w-5 rounded-full border-2 border-sky-300 bg-white shadow-[0_6px_14px_rgba(56,189,248,0.18)]" onPointerDown={(event) => startGesture(event, 'scale', selectedPreviewLayer.layer)} />
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {!activePair && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/92">
                      <div className="max-w-md px-6 text-center">
                        <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl border-2 border-slate-900 bg-slate-200"><Camera size={24} strokeWidth={2.6} /></div>
                        <div className="mt-4 text-xl font-black text-slate-950">{usesExternalPairs ? 'Add linked pairs first' : 'Drop a puzzle pair'}</div>
                        <div className="mt-2 text-sm font-medium text-slate-600">
                          {usesExternalPairs
                            ? 'Upload linked puzzle pairs in Editor Mode to start styling thumbnails here.'
                            : 'Use `name.png` and `namediff.png`, or drop any exact two-image pair.'}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {activePair && (
                <div className="flex flex-wrap gap-2">
                  {previewLayers.map((entry) => {
                    const selected = sameLayer(selectedLayer, entry.layer);
                    return (
                      <button
                        key={`layer-${entry.key}`}
                        type="button"
                        onClick={() => setSelectedLayer(entry.layer)}
                        className={`rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] ${
                          selected ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {entry.label}
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
                <div className="rounded-2xl border-2 border-slate-900 bg-slate-50 p-3">
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full border-2 border-slate-900 bg-white px-3 py-1 text-xs font-bold text-slate-800">Readability {scoreSummary.score}/100</span>
                    <span className="rounded-full border-2 border-slate-900 bg-white px-3 py-1 text-xs font-bold text-slate-800">{formatFileSize(exportBytesEstimate)}</span>
                    {selectedTransform && <span className="rounded-full border-2 border-slate-900 bg-white px-3 py-1 text-xs font-bold text-slate-800">Selected {selectedLayerLabel}</span>}
                  </div>
                  <div className="mt-3 space-y-2">
                    {scoreSummary.warnings.length > 0 ? scoreSummary.warnings.map((warning) => (
                      <div key={warning} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700">{warning}</div>
                    )) : <div className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700">The current setup looks balanced for a standard YouTube card.</div>}
                  </div>
                </div>
                <div className="rounded-2xl border-2 border-slate-900 bg-white p-3">
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Small Card Check</div>
                  <div className="mt-2 flex items-center justify-center rounded-xl bg-slate-100 p-3">
                    <div className="w-[190px] overflow-hidden rounded-xl border-2 border-slate-900 bg-white">
                      {previewDataUrl ? <img src={previewDataUrl} alt="Small thumbnail preview" className="block w-full" /> : <div className="flex aspect-video items-center justify-center text-[10px] font-bold uppercase text-slate-500">No preview</div>}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
          <aside className="space-y-3">
            <section className={`${compactCardClass} p-2`}>
              <div className="grid grid-cols-6 gap-2">
                {toolItems.map((item) => {
                  const Icon = item.icon;
                  const selected = activeTool === item.key;
                  return (
                    <button key={item.key} type="button" onClick={() => setActiveTool(item.key)} className={`flex flex-col items-center gap-1 rounded-xl border-2 px-2 py-2 text-[10px] font-black uppercase tracking-[0.14em] ${selected ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>
                      <Icon size={15} strokeWidth={2.5} />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className={`${compactCardClass} space-y-3`}>
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-3">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Inspector</div>
                  <div className="text-base font-black text-slate-950">{toolItems.find((item) => item.key === activeTool)?.label}</div>
                </div>
                <div className="rounded-full border border-slate-300 bg-slate-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-600">{selectedPreviewLayer ? selectedPreviewLayer.label : 'Canvas'}</div>
              </div>
              {renderInspector()}
            </section>
          </aside>
        </div>

        <div className="border-t-2 border-slate-900 bg-white px-4 py-3 text-sm font-medium text-slate-700 sm:px-6">
          {error ? <span className="text-red-600">{error}</span> : <span>{status}</span>}
        </div>
      </div>

      {!usesExternalPairs && (
        <>
          <input ref={batchInputRef} type="file" accept="image/*" multiple onChange={(event) => { void loadPairsFromFiles(event.target.files); if (event.target) event.target.value = ''; }} className="hidden" />
          <input ref={puzzleInputRef} type="file" accept="image/*" onChange={(event) => { void replaceCurrentImage('puzzle', event.target.files?.[0] ?? null); if (event.target) event.target.value = ''; }} className="hidden" />
          <input ref={diffInputRef} type="file" accept="image/*" onChange={(event) => { void replaceCurrentImage('diff', event.target.files?.[0] ?? null); if (event.target) event.target.value = ''; }} className="hidden" />
        </>
      )}
      <input ref={overlayInputRef} type="file" accept="image/*" onChange={(event) => { void addOverlayFromFile(event.target.files?.[0] ?? null); if (event.target) event.target.value = ''; }} className="hidden" />
    </div>
  );
}
