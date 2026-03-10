import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Clock3,
  Columns2,
  Download,
  ImagePlus,
  Layers,
  Move,
  Palette,
  Pause,
  Play,
  RotateCcw,
  Scissors,
  Sparkles,
  Trash2,
  Upload,
  Video
} from 'lucide-react';
import { OverlayTransform, Puzzle, VideoModeTransferFrame, VideoSettings } from '../types';
import type {
  OverlayBackgroundFill,
  OverlayBaseInput,
  OverlayBatchPhotoInput,
  OverlayChromaKey,
  OverlayCrop,
  OverlayEditorMode,
  OverlayLinkedPairExportMode,
  OverlayLinkedPairInput,
  OverlayLinkedPairLayout,
  OverlayLinkedPairStyle,
  OverlayMediaClipInput,
  OverlayTimeline
} from '../services/overlayVideoExport';

type OverlayExportSettings = Pick<VideoSettings, 'exportResolution' | 'exportBitrateMbps' | 'exportCodec'>;

interface DragState {
  pointerId: number;
  mode: 'move' | 'resize';
  startClientX: number;
  startClientY: number;
  startTransform: OverlayTransform;
  previewWidth: number;
  previewHeight: number;
}

interface TimelineDragState {
  pointerId: number;
  source: 'batch' | 'overlay';
  id: string;
  mode: 'move' | 'trimStart' | 'trimEnd';
  startClientX: number;
  startTimeline: OverlayTimeline;
  laneWidth: number;
}

type BaseMode = OverlayBaseInput['mode'];

interface DraftMediaBase {
  id: string;
  name: string;
  kind: 'image' | 'video';
  file: File;
  url: string;
  hash: string;
  aspectRatio: number;
  durationSeconds: number;
  transform: OverlayTransform;
  crop: OverlayCrop;
  background: OverlayBackgroundFill;
  chromaKey: OverlayChromaKey;
  timeline: OverlayTimeline;
}

interface BatchPhotoDraft extends DraftMediaBase {
  kind: 'image';
}

type OverlayDraft = DraftMediaBase;

interface LinkedPairDraft extends OverlayLinkedPairInput {
  puzzleUrl: string;
  diffUrl: string;
  sortKey: string;
}

interface LinkedPairDragState {
  pointerId: number;
  mode: 'move' | 'resize';
  startClientX: number;
  startClientY: number;
  startLayout: OverlayLinkedPairLayout;
  previewWidth: number;
  previewHeight: number;
  previewMinDimension: number;
}

interface ActiveClipRef {
  source: 'batch' | 'overlay';
  id: string;
}

interface PreviewChromaMediaProps {
  item: DraftMediaBase;
  previewTime: number;
  registerVideoRef?: (node: HTMLVideoElement | null) => void;
}

interface OverlayVideoEditorExportPayload {
  editorMode: OverlayEditorMode;
  base: OverlayBaseInput;
  batchPhotos: OverlayBatchPhotoInput[];
  overlays: OverlayMediaClipInput[];
  linkedPairs?: OverlayLinkedPairInput[];
  linkedPairLayout?: OverlayLinkedPairLayout;
  linkedPairStyle?: OverlayLinkedPairStyle;
  linkedPairExportMode?: OverlayLinkedPairExportMode;
}

interface OverlayVideoEditorProps {
  settings: OverlayExportSettings;
  puzzles?: Puzzle[];
  incomingVideoFrames?: VideoModeTransferFrame[];
  incomingVideoFramesSessionId?: number;
  defaultPuzzleClipDurationSeconds?: number;
  onSettingsChange: (patch: Partial<OverlayExportSettings>) => void;
  onExport: (payload: OverlayVideoEditorExportPayload) => void | Promise<void>;
  onBack: () => void;
  isExporting: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const ASPECT_RATIO_PRESETS = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
  '4:3': 4 / 3
} as const;

type AspectRatioPreset = 'auto' | keyof typeof ASPECT_RATIO_PRESETS;

const ASPECT_RATIO_PRESET_OPTIONS: Array<{ value: AspectRatioPreset; label: string }> = [
  { value: 'auto', label: 'Auto (Match Base)' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: '1:1', label: '1:1' },
  { value: '4:3', label: '4:3' }
];

const getAspectRatioFromPreset = (preset: AspectRatioPreset, sourceAspectRatio: number) => {
  if (preset === 'auto') return sourceAspectRatio;
  return ASPECT_RATIO_PRESETS[preset];
};

const getHeightFromWidth = (width: number, imageAspectRatio: number, frameAspectRatio: number) => {
  const safeImageAspect = Math.max(0.1, imageAspectRatio);
  const safeFrameAspect = Math.max(0.1, frameAspectRatio);
  return (width * safeFrameAspect) / safeImageAspect;
};

const normalizeTransformForMedia = (
  template: OverlayTransform,
  mediaAspectRatio: number,
  frameAspectRatio: number
): OverlayTransform => {
  const width = clamp(template.width, 0.05, 0.98);
  const height = clamp(getHeightFromWidth(width, mediaAspectRatio, frameAspectRatio), 0.04, 0.98);
  const x = clamp(template.x, 0, Math.max(0, 1 - width));
  const y = clamp(template.y, 0, Math.max(0, 1 - height));

  return {
    x,
    y,
    width,
    height
  };
};

const getDefaultTransform = (aspectRatio: number, frameAspectRatio: number): OverlayTransform => {
  let width = 0.26;
  let height = getHeightFromWidth(width, aspectRatio, frameAspectRatio);

  if (height > 0.44) {
    const scale = 0.44 / height;
    width *= scale;
    height *= scale;
  }

  width = clamp(width, 0.08, 0.9);
  height = clamp(height, 0.08, 0.9);

  return {
    x: (1 - width) / 2,
    y: (1 - height) / 2,
    width,
    height
  };
};

const normalizeCrop = (crop: OverlayCrop): OverlayCrop => {
  const x = clamp(Number.isFinite(crop.x) ? crop.x : 0, 0, 0.98);
  const y = clamp(Number.isFinite(crop.y) ? crop.y : 0, 0, 0.98);
  const width = clamp(Number.isFinite(crop.width) ? crop.width : 1, 0.02, 1 - x);
  const height = clamp(Number.isFinite(crop.height) ? crop.height : 1, 0.02, 1 - y);
  return { x, y, width, height };
};

const normalizeTimeline = (timeline: OverlayTimeline): OverlayTimeline => {
  const start = clamp(Number.isFinite(timeline.start) ? timeline.start : 0, 0, 60 * 60 * 3);
  const rawEnd = Number.isFinite(timeline.end) ? timeline.end : start + 0.5;
  const end = clamp(Math.max(rawEnd, start + 0.05), 0.05, 60 * 60 * 3);
  return { start, end };
};

const defaultCrop = (): OverlayCrop => ({
  x: 0,
  y: 0,
  width: 1,
  height: 1
});

const defaultBackground = (): OverlayBackgroundFill => ({
  enabled: false,
  color: '#ffffff'
});

const defaultChroma = (): OverlayChromaKey => ({
  enabled: false,
  color: '#00ff00',
  similarity: 0.2,
  smoothness: 0.25
});

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');

const computeFileHash = async (file: File): Promise<string> => {
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const data = await file.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', data);
      return toHex(digest);
    }
  } catch {
    // Fall through to fallback id.
  }
  return `${file.name}::${file.size}::${file.lastModified}`;
};

const readImageAspectRatio = (url: string) =>
  new Promise<number>((resolve) => {
    const image = new Image();
    image.onload = () => {
      const ratio = image.naturalWidth > 0 && image.naturalHeight > 0 ? image.naturalWidth / image.naturalHeight : 1;
      resolve(ratio);
    };
    image.onerror = () => resolve(1);
    image.src = url;
  });

const readVideoMetadata = (url: string) =>
  new Promise<{ aspectRatio: number; duration: number }>((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.src = url;
    const handleDone = () => {
      const width = video.videoWidth || 1920;
      const height = video.videoHeight || 1080;
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      resolve({
        aspectRatio: width / Math.max(1, height),
        duration
      });
      video.src = '';
    };
    video.onloadedmetadata = handleDone;
    video.onerror = handleDone;
  });

const getCroppedStyle = (crop: OverlayCrop): React.CSSProperties => {
  const normalized = normalizeCrop(crop);
  const widthPercent = (1 / normalized.width) * 100;
  const heightPercent = (1 / normalized.height) * 100;
  const offsetX = (normalized.x / normalized.width) * 100;
  const offsetY = (normalized.y / normalized.height) * 100;
  return {
    width: `${widthPercent}%`,
    height: `${heightPercent}%`,
    transform: `translate(-${offsetX}%, -${offsetY}%)`,
    transformOrigin: 'top left',
    objectFit: 'cover'
  };
};

const sanitizeFileBaseName = (value: string) =>
  value
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'puzzle';

const getImageExtensionFromMimeType = (mimeType: string) => {
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('webp')) return 'webp';
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg';
  if (mimeType.includes('gif')) return 'gif';
  return 'png';
};

const createFileFromImageSource = async (source: string, fileBaseName: string) => {
  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`Failed to fetch image source for "${fileBaseName}".`);
  }
  const blob = await response.blob();
  const mimeType = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/png';
  const ext = getImageExtensionFromMimeType(mimeType);
  const safeBaseName = sanitizeFileBaseName(fileBaseName);
  return new File([blob], `${safeBaseName}.${ext}`, { type: mimeType });
};

const loadImageElement = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load puzzle image.'));
    image.src = url;
  });

const drawImageContain = (
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number
) => {
  const imageWidth = Math.max(1, image.naturalWidth);
  const imageHeight = Math.max(1, image.naturalHeight);
  const scale = Math.min(width / imageWidth, height / imageHeight);
  const drawWidth = imageWidth * scale;
  const drawHeight = imageHeight * scale;
  const drawX = x + (width - drawWidth) / 2;
  const drawY = y + (height - drawHeight) / 2;
  ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
};

const createPuzzleCompositeFile = async (puzzle: Puzzle, index: number, frameAspectRatio: number): Promise<File> => {
  const [original, modified] = await Promise.all([loadImageElement(puzzle.imageA), loadImageElement(puzzle.imageB)]);
  const safeAspectRatio = clamp(frameAspectRatio, 0.3, 4);
  const height = safeAspectRatio >= 1 ? 1080 : 1920;
  const width = Math.max(2, Math.round(height * safeAspectRatio));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Unable to initialize puzzle compositor canvas.');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  const padding = Math.round(width * 0.015);
  const gap = Math.round(width * 0.012);
  const panelWidth = Math.max(1, (width - padding * 2 - gap) / 2);
  const panelHeight = Math.max(1, height - padding * 2);
  const leftPanelX = padding;
  const rightPanelX = padding + panelWidth + gap;
  const panelY = padding;

  ctx.fillStyle = '#f1f5f9';
  ctx.fillRect(leftPanelX, panelY, panelWidth, panelHeight);
  ctx.fillRect(rightPanelX, panelY, panelWidth, panelHeight);
  drawImageContain(ctx, original, leftPanelX, panelY, panelWidth, panelHeight);
  drawImageContain(ctx, modified, rightPanelX, panelY, panelWidth, panelHeight);

  ctx.strokeStyle = '#000000';
  ctx.lineWidth = Math.max(2, Math.round(width * 0.002));
  ctx.strokeRect(leftPanelX, panelY, panelWidth, panelHeight);
  ctx.strokeRect(rightPanelX, panelY, panelWidth, panelHeight);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((nextBlob) => {
      if (nextBlob) resolve(nextBlob);
      else reject(new Error('Failed to render puzzle frame.'));
    }, 'image/png');
  });

  const baseName = sanitizeFileBaseName((puzzle.title || '').trim() || `puzzle_${index + 1}`);
  return new File([blob], `${baseName}.png`, { type: 'image/png' });
};

const parseHexColor = (value: string): { r: number; g: number; b: number } => {
  const normalized = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(normalized)) {
    return {
      r: Number.parseInt(`${normalized[1]}${normalized[1]}`, 16),
      g: Number.parseInt(`${normalized[2]}${normalized[2]}`, 16),
      b: Number.parseInt(`${normalized[3]}${normalized[3]}`, 16)
    };
  }
  if (/^#[0-9a-f]{6}$/.test(normalized)) {
    return {
      r: Number.parseInt(normalized.slice(1, 3), 16),
      g: Number.parseInt(normalized.slice(3, 5), 16),
      b: Number.parseInt(normalized.slice(5, 7), 16)
    };
  }
  return { r: 0, g: 255, b: 0 };
};

const applyChromaKeyToCanvas = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  chromaKey: OverlayChromaKey
) => {
  const keyColor = parseHexColor(chromaKey.color);
  const similarity = clamp(chromaKey.similarity, 0, 1);
  const smoothness = clamp(chromaKey.smoothness, 0, 1);
  const softEdge = Math.max(0.0001, smoothness * 0.25);
  const minThreshold = Math.max(0, similarity - softEdge);
  const maxThreshold = Math.min(1, similarity + softEdge);

  const frame = ctx.getImageData(0, 0, width, height);
  const data = frame.data;

  for (let index = 0; index < data.length; index += 4) {
    const dr = data[index] - keyColor.r;
    const dg = data[index + 1] - keyColor.g;
    const db = data[index + 2] - keyColor.b;
    const distance = Math.sqrt(dr * dr + dg * dg + db * db) / 441.67295593;

    if (distance <= minThreshold) {
      data[index + 3] = 0;
      continue;
    }

    if (distance >= maxThreshold) continue;

    const alphaScale = (distance - minThreshold) / Math.max(0.0001, maxThreshold - minThreshold);
    data[index + 3] = Math.round(data[index + 3] * alphaScale);
  }

  ctx.putImageData(frame, 0, 0);
};

const rgbToHex = (r: number, g: number, b: number) =>
  `#${[r, g, b]
    .map((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0'))
    .join('')}`;

const parsePuzzlePairFilename = (filename: string) => {
  const name = filename.substring(0, filename.lastIndexOf('.')) || filename;
  if (name.toLowerCase().endsWith('diff')) {
    return { base: name.substring(0, name.length - 4), type: 'diff' as const };
  }
  return { base: name, type: 'base' as const };
};

const createDefaultLinkedPairLayout = (): OverlayLinkedPairLayout => ({
  x: 0.14,
  y: 0.18,
  size: 0.34,
  gap: 0.04
});

const createDefaultLinkedPairStyle = (): OverlayLinkedPairStyle => ({
  outlineColor: '#000000',
  outlineWidth: 6,
  cornerRadius: 18
});

const getLinkedPairFrameMetrics = (frameAspectRatio: number) => {
  const safeAspect = clamp(frameAspectRatio, 0.3, 4);
  return safeAspect >= 1
    ? { width: safeAspect, height: 1, minDimension: 1, stackDirection: 'horizontal' as const }
    : { width: 1, height: 1 / safeAspect, minDimension: 1, stackDirection: 'vertical' as const };
};

const normalizeLinkedPairLayout = (
  layout: OverlayLinkedPairLayout | undefined,
  frameAspectRatio: number
): OverlayLinkedPairLayout => {
  const metrics = getLinkedPairFrameMetrics(frameAspectRatio);
  const isVertical = metrics.stackDirection === 'vertical';
  const maxSizeByWidth = isVertical ? metrics.width : metrics.width / 2;
  const maxSizeByHeight = isVertical ? metrics.height / 2 : metrics.height;
  const size = clamp(
    Number.isFinite(layout?.size) ? layout?.size ?? 0.34 : 0.34,
    0.08,
    Math.max(0.08, Math.min(1, maxSizeByWidth, maxSizeByHeight))
  );
  const gap = clamp(
    Number.isFinite(layout?.gap) ? layout?.gap ?? 0.04 : 0.04,
    0,
    Math.max(0, 1 - (size * 2) / Math.max(0.0001, isVertical ? metrics.height : metrics.width))
  );
  const x = clamp(
    Number.isFinite(layout?.x) ? layout?.x ?? 0.14 : 0.14,
    0,
    isVertical
      ? Math.max(0, 1 - size / Math.max(0.0001, metrics.width))
      : Math.max(0, 1 - (size * 2) / Math.max(0.0001, metrics.width) - gap)
  );
  const y = clamp(
    Number.isFinite(layout?.y) ? layout?.y ?? 0.18 : 0.18,
    0,
    isVertical
      ? Math.max(0, 1 - (size * 2) / Math.max(0.0001, metrics.height) - gap)
      : Math.max(0, 1 - size / Math.max(0.0001, metrics.height))
  );

  return { x, y, size, gap };
};

const getLinkedPairBounds = (layout: OverlayLinkedPairLayout, frameAspectRatio: number) => {
  const safeLayout = normalizeLinkedPairLayout(layout, frameAspectRatio);
  const metrics = getLinkedPairFrameMetrics(frameAspectRatio);
  const sizePx = safeLayout.size * metrics.minDimension;
  const isVertical = metrics.stackDirection === 'vertical';

  if (isVertical) {
    const gapPx = safeLayout.gap * metrics.height;
    const totalHeightPx = sizePx * 2 + gapPx;
    const panelHeightPct = (sizePx / Math.max(0.0001, totalHeightPx)) * 100;
    const diffTopPct = ((sizePx + gapPx) / Math.max(0.0001, totalHeightPx)) * 100;

    return {
      puzzle: {
        left: '0%',
        top: '0%',
        width: '100%',
        height: `${panelHeightPct}%`
      },
      diff: {
        left: '0%',
        top: `${diffTopPct}%`,
        width: '100%',
        height: `${panelHeightPct}%`
      },
      container: {
        left: `${safeLayout.x * 100}%`,
        top: `${safeLayout.y * 100}%`,
        width: `${(sizePx / metrics.width) * 100}%`,
        height: `${(totalHeightPx / metrics.height) * 100}%`
      }
    };
  }

  const gapPx = safeLayout.gap * metrics.width;
  const totalWidthPx = sizePx * 2 + gapPx;
  const panelWidthPct = (sizePx / Math.max(0.0001, totalWidthPx)) * 100;
  const diffLeftPct = ((sizePx + gapPx) / Math.max(0.0001, totalWidthPx)) * 100;

  return {
    puzzle: {
      left: '0%',
      top: '0%',
      width: `${panelWidthPct}%`,
      height: '100%'
    },
    diff: {
      left: `${diffLeftPct}%`,
      top: '0%',
      width: `${panelWidthPct}%`,
      height: '100%'
    },
    container: {
      left: `${safeLayout.x * 100}%`,
      top: `${safeLayout.y * 100}%`,
      width: `${(totalWidthPx / metrics.width) * 100}%`,
      height: `${(sizePx / metrics.height) * 100}%`
    }
  };
};

const PreviewChromaMedia: React.FC<PreviewChromaMediaProps> = ({ item, previewTime, registerVideoRef }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [mediaReadyTick, setMediaReadyTick] = useState(0);

  useEffect(() => {
    if (item.kind === 'video') return;
    setMediaReadyTick((value) => value + 1);
  }, [item.url, item.kind]);

  useEffect(() => {
    let rafId = 0;
    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const source = item.kind === 'video' ? videoRef.current : imageRef.current;
      if (!source) return;

      const sourceWidth = item.kind === 'video' ? source.videoWidth : source.naturalWidth;
      const sourceHeight = item.kind === 'video' ? source.videoHeight : source.naturalHeight;
      if (!sourceWidth || !sourceHeight) return;

      const width = Math.max(1, Math.floor(canvas.clientWidth));
      const height = Math.max(1, Math.floor(canvas.clientHeight));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const crop = normalizeCrop(item.crop);
      const sx = Math.floor(crop.x * sourceWidth);
      const sy = Math.floor(crop.y * sourceHeight);
      const sw = Math.max(1, Math.floor(crop.width * sourceWidth));
      const sh = Math.max(1, Math.floor(crop.height * sourceHeight));

      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(source, sx, sy, sw, sh, 0, 0, width, height);
      applyChromaKeyToCanvas(ctx, width, height, item.chromaKey);
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [item, previewTime, mediaReadyTick]);

  return (
    <>
      {item.kind === 'video' ? (
        <video
          ref={(node) => {
            videoRef.current = node;
            registerVideoRef?.(node);
          }}
          src={item.url}
          className="absolute inset-0 w-full h-full opacity-0 pointer-events-none select-none"
          muted
          playsInline
          preload="metadata"
          onLoadedData={() => setMediaReadyTick((value) => value + 1)}
        />
      ) : (
        <img
          ref={imageRef}
          src={item.url}
          alt={item.name}
          className="absolute inset-0 w-full h-full opacity-0 pointer-events-none select-none"
          draggable={false}
          onLoad={() => setMediaReadyTick((value) => value + 1)}
        />
      )}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
    </>
  );
};

export const OverlayVideoEditor: React.FC<OverlayVideoEditorProps> = ({
  settings,
  puzzles = [],
  incomingVideoFrames = [],
  incomingVideoFramesSessionId = 0,
  defaultPuzzleClipDurationSeconds = 8,
  onSettingsChange,
  onExport,
  onBack,
  isExporting
}) => {
  const [baseMode, setBaseMode] = useState<BaseMode>('video');
  const [baseVideoFile, setBaseVideoFile] = useState<File | null>(null);
  const [baseVideoUrl, setBaseVideoUrl] = useState<string | null>(null);
  const [baseVideoAspectRatio, setBaseVideoAspectRatio] = useState<number>(16 / 9);
  const [baseVideoDuration, setBaseVideoDuration] = useState<number>(8);

  const [basePhotoFile, setBasePhotoFile] = useState<File | null>(null);
  const [basePhotoUrl, setBasePhotoUrl] = useState<string | null>(null);
  const [basePhotoAspectRatio, setBasePhotoAspectRatio] = useState<number>(16 / 9);

  const [baseColor, setBaseColor] = useState('#ffffff');
  const [frameAspectPreset, setFrameAspectPreset] = useState<AspectRatioPreset>('auto');
  const [staticDurationSeconds, setStaticDurationSeconds] = useState(8);

  const [editorMode, setEditorMode] = useState<OverlayEditorMode>('standard');
  const [batchPhotos, setBatchPhotos] = useState<BatchPhotoDraft[]>([]);
  const [linkedPairs, setLinkedPairs] = useState<LinkedPairDraft[]>([]);
  const [activeLinkedPairId, setActiveLinkedPairId] = useState<string | null>(null);
  const [linkedPairLayout, setLinkedPairLayout] = useState<OverlayLinkedPairLayout>(createDefaultLinkedPairLayout);
  const [linkedPairStyle, setLinkedPairStyle] = useState<OverlayLinkedPairStyle>(createDefaultLinkedPairStyle);
  const [linkedPairExportMode, setLinkedPairExportMode] = useState<OverlayLinkedPairExportMode>('one_per_pair');
  const [overlays, setOverlays] = useState<OverlayDraft[]>([]);
  const [activeClip, setActiveClip] = useState<ActiveClipRef | null>(null);
  const [applyTransformToAllPhotos, setApplyTransformToAllPhotos] = useState(true);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [linkedPairDragState, setLinkedPairDragState] = useState<LinkedPairDragState | null>(null);
  const [timelineDragState, setTimelineDragState] = useState<TimelineDragState | null>(null);

  const [previewTime, setPreviewTime] = useState(0);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [isPreviewColorPickerActive, setIsPreviewColorPickerActive] = useState(false);
  const [isImportingPuzzles, setIsImportingPuzzles] = useState(false);
  const [isImportingVideoFrames, setIsImportingVideoFrames] = useState(false);
  const [videoFrameImportSummary, setVideoFrameImportSummary] = useState<string>('');

  const previewRef = useRef<HTMLDivElement>(null);
  const baseVideoRef = useRef<HTMLVideoElement | null>(null);
  const overlayVideoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const previewColorSampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageSamplingCacheRef = useRef<Record<string, HTMLImageElement>>({});

  const baseVideoUrlRef = useRef<string | null>(null);
  const basePhotoUrlRef = useRef<string | null>(null);
  const batchPhotosRef = useRef<BatchPhotoDraft[]>([]);
  const linkedPairsRef = useRef<LinkedPairDraft[]>([]);
  const overlaysRef = useRef<OverlayDraft[]>([]);
  const lastVideoFramesSessionIdRef = useRef<number>(-1);

  useEffect(() => {
    baseVideoUrlRef.current = baseVideoUrl;
  }, [baseVideoUrl]);
  useEffect(() => {
    basePhotoUrlRef.current = basePhotoUrl;
  }, [basePhotoUrl]);
  useEffect(() => {
    batchPhotosRef.current = batchPhotos;
  }, [batchPhotos]);
  useEffect(() => {
    linkedPairsRef.current = linkedPairs;
  }, [linkedPairs]);
  useEffect(() => {
    overlaysRef.current = overlays;
  }, [overlays]);

  useEffect(() => {
    return () => {
      if (baseVideoUrlRef.current) URL.revokeObjectURL(baseVideoUrlRef.current);
      if (basePhotoUrlRef.current) URL.revokeObjectURL(basePhotoUrlRef.current);
      batchPhotosRef.current.forEach((item) => URL.revokeObjectURL(item.url));
      linkedPairsRef.current.forEach((item) => {
        URL.revokeObjectURL(item.puzzleUrl);
        URL.revokeObjectURL(item.diffUrl);
      });
      overlaysRef.current.forEach((item) => URL.revokeObjectURL(item.url));
    };
  }, []);

  const sourceAspectRatio = useMemo(() => {
    if (baseMode === 'video') return baseVideoAspectRatio;
    if (baseMode === 'photo') return basePhotoAspectRatio;
    return 16 / 9;
  }, [baseMode, basePhotoAspectRatio, baseVideoAspectRatio]);

  const previewAspectRatio = useMemo(
    () => getAspectRatioFromPreset(frameAspectPreset, sourceAspectRatio),
    [frameAspectPreset, sourceAspectRatio]
  );

  useEffect(() => {
    setBatchPhotos((currentPhotos) => {
      if (!currentPhotos.length) return currentPhotos;
      return currentPhotos.map((photo) => ({
        ...photo,
        transform: normalizeTransformForMedia(photo.transform, photo.aspectRatio, previewAspectRatio)
      }));
    });
    setOverlays((currentOverlays) => {
      if (!currentOverlays.length) return currentOverlays;
      return currentOverlays.map((item) => ({
        ...item,
        transform: normalizeTransformForMedia(item.transform, item.aspectRatio, previewAspectRatio)
      }));
    });
    setLinkedPairLayout((currentLayout) => normalizeLinkedPairLayout(currentLayout, previewAspectRatio));
  }, [previewAspectRatio]);

  useEffect(() => {
    if (editorMode === 'linked_pairs' && activeClip?.source === 'batch') {
      setActiveClip(null);
    }
  }, [activeClip, editorMode]);

  const baseDuration = useMemo(() => {
    if (baseMode === 'video') return Math.max(0.5, baseVideoDuration || 0.5);
    return Math.max(0.5, staticDurationSeconds);
  }, [baseMode, baseVideoDuration, staticDurationSeconds]);

  const linkedPairSegmentDuration = useMemo(() => Math.max(0.5, baseDuration), [baseDuration]);

  const linkedPairSegments = useMemo(
    () =>
      linkedPairs.map((pair, index) => ({
        pair,
        start: index * linkedPairSegmentDuration,
        end: (index + 1) * linkedPairSegmentDuration
      })),
    [linkedPairSegmentDuration, linkedPairs]
  );

  const timelineDuration = useMemo(() => {
    const maxBatchEnd =
      editorMode === 'standard'
        ? batchPhotos.reduce((acc, photo) => Math.max(acc, normalizeTimeline(photo.timeline).end), 0)
        : 0;
    const maxOverlayEnd = overlays.reduce((acc, overlay) => Math.max(acc, normalizeTimeline(overlay.timeline).end), 0);
    const maxLinkedPairEnd =
      editorMode === 'linked_pairs' && linkedPairExportMode === 'single_video'
        ? linkedPairSegments.reduce((acc, segment) => Math.max(acc, segment.end), 0)
        : baseDuration;
    return Math.max(1, baseDuration, maxBatchEnd, maxOverlayEnd, maxLinkedPairEnd);
  }, [baseDuration, batchPhotos, editorMode, linkedPairExportMode, linkedPairSegments, overlays]);

  useEffect(() => {
    setPreviewTime((current) => clamp(current, 0, timelineDuration));
  }, [timelineDuration]);

  useEffect(() => {
    if (!activeClip) {
      if (editorMode === 'standard' && batchPhotos.length > 0) {
        setActiveClip({ source: 'batch', id: batchPhotos[0].id });
      } else if (overlays.length > 0) {
        setActiveClip({ source: 'overlay', id: overlays[0].id });
      }
      return;
    }

    const exists =
      activeClip.source === 'batch'
        ? editorMode === 'standard' && batchPhotos.some((item) => item.id === activeClip.id)
        : overlays.some((item) => item.id === activeClip.id);

    if (!exists) {
      if (editorMode === 'standard' && batchPhotos.length > 0) {
        setActiveClip({ source: 'batch', id: batchPhotos[0].id });
      } else if (overlays.length > 0) {
        setActiveClip({ source: 'overlay', id: overlays[0].id });
      } else {
        setActiveClip(null);
      }
    }
  }, [activeClip, batchPhotos, editorMode, overlays]);

  const activeBatchPhoto = useMemo(
    () =>
      editorMode === 'standard' && activeClip?.source === 'batch'
        ? batchPhotos.find((item) => item.id === activeClip.id) ?? null
        : null,
    [activeClip, batchPhotos, editorMode]
  );
  const activeOverlay = useMemo(
    () => (activeClip?.source === 'overlay' ? overlays.find((item) => item.id === activeClip.id) ?? null : null),
    [activeClip, overlays]
  );
  const activeMedia = activeBatchPhoto ?? activeOverlay;

  const selectedLinkedPair = useMemo(
    () => linkedPairs.find((item) => item.id === activeLinkedPairId) ?? linkedPairs[0] ?? null,
    [activeLinkedPairId, linkedPairs]
  );

  useEffect(() => {
    if (!linkedPairs.length) {
      setActiveLinkedPairId(null);
      return;
    }
    if (!activeLinkedPairId || !linkedPairs.some((item) => item.id === activeLinkedPairId)) {
      setActiveLinkedPairId(linkedPairs[0].id);
    }
  }, [activeLinkedPairId, linkedPairs]);

  useEffect(() => {
    if (!activeMedia) setIsPreviewColorPickerActive(false);
  }, [activeMedia]);

  const previewPrimaryPhoto = useMemo(() => {
    if (editorMode !== 'standard') return null;
    if (activeBatchPhoto) return activeBatchPhoto;
    return batchPhotos[0] ?? null;
  }, [activeBatchPhoto, batchPhotos, editorMode]);

  const previewLinkedPair = useMemo(() => {
    if (editorMode !== 'linked_pairs' || linkedPairs.length === 0) return null;
    if (linkedPairExportMode === 'single_video') {
      const matchingSegment =
        linkedPairSegments.find(
          (segment, index) =>
            previewTime >= segment.start &&
            (previewTime < segment.end || index === linkedPairSegments.length - 1)
        ) ?? null;
      return matchingSegment?.pair ?? selectedLinkedPair;
    }
    return selectedLinkedPair;
  }, [editorMode, linkedPairExportMode, linkedPairSegments, linkedPairs.length, previewTime, selectedLinkedPair]);

  const previewEntries = useMemo(() => {
    const entries: Array<{ source: 'batch' | 'overlay'; item: DraftMediaBase }> = [];
    if (previewPrimaryPhoto) {
      entries.push({ source: 'batch', item: previewPrimaryPhoto });
    }
    overlays.forEach((item) => {
      entries.push({ source: 'overlay', item });
    });
    return entries.filter(({ item }) => {
      const timeline = normalizeTimeline(item.timeline);
      return previewTime >= timeline.start && previewTime <= timeline.end;
    });
  }, [previewPrimaryPhoto, overlays, previewTime]);

  const normalizedLinkedPairLayout = useMemo(
    () => normalizeLinkedPairLayout(linkedPairLayout, previewAspectRatio),
    [linkedPairLayout, previewAspectRatio]
  );

  const selectedPhotoPositionLabel = activeMedia
    ? `x:${(activeMedia.transform.x * 100).toFixed(1)}% y:${(activeMedia.transform.y * 100).toFixed(1)}% size:${(
        activeMedia.transform.width * 100
      ).toFixed(1)}%`
    : editorMode === 'linked_pairs' && previewLinkedPair
      ? `pair x:${(normalizedLinkedPairLayout.x * 100).toFixed(1)}% y:${(normalizedLinkedPairLayout.y * 100).toFixed(
          1
        )}% size:${(normalizedLinkedPairLayout.size * 100).toFixed(1)}% gap:${(
          normalizedLinkedPairLayout.gap * 100
        ).toFixed(1)}%`
      : 'No media selected';

  useEffect(() => {
    if (!isPreviewPlaying) return;
    let rafId = 0;
    let previous = performance.now();

    const tick = (now: number) => {
      const delta = (now - previous) / 1000;
      previous = now;
      setPreviewTime((current) => {
        const next = current + delta;
        return next > timelineDuration ? 0 : next;
      });
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPreviewPlaying, timelineDuration]);

  useEffect(() => {
    if (baseMode === 'video' && baseVideoRef.current) {
      const video = baseVideoRef.current;
      const maxSeek = Math.max(0, baseVideoDuration - 0.033);
      const target = clamp(previewTime, 0, maxSeek);
      if (Math.abs(video.currentTime - target) > 0.06) {
        try {
          video.currentTime = target;
        } catch {
          // Ignored; metadata may not be ready yet.
        }
      }
      video.pause();
    }

    overlays.forEach((item) => {
      if (item.kind !== 'video') return;
      const element = overlayVideoRefs.current[item.id];
      if (!element) return;
      const timeline = normalizeTimeline(item.timeline);
      const visible = previewTime >= timeline.start && previewTime <= timeline.end;
      if (!visible) {
        element.pause();
        return;
      }
      const localTime = Math.max(0, previewTime - timeline.start);
      const duration = item.durationSeconds > 0.05 ? item.durationSeconds : 0.05;
      const target = localTime % duration;
      if (Math.abs(element.currentTime - target) > 0.06) {
        try {
          element.currentTime = target;
        } catch {
          // Ignored; metadata may not be ready yet.
        }
      }
      element.pause();
    });
  }, [baseMode, baseVideoDuration, overlays, previewTime]);

  const updateActiveTransform = (nextTransform: OverlayTransform) => {
    if (!activeClip || !activeMedia) return;

    if (activeClip.source === 'batch' && applyTransformToAllPhotos) {
      setBatchPhotos((currentPhotos) =>
        currentPhotos.map((photo) => ({
          ...photo,
          transform: normalizeTransformForMedia(nextTransform, photo.aspectRatio, previewAspectRatio)
        }))
      );
      return;
    }

    if (activeClip.source === 'batch') {
      setBatchPhotos((currentPhotos) =>
        currentPhotos.map((photo) =>
          photo.id === activeClip.id
            ? {
                ...photo,
                transform: normalizeTransformForMedia(nextTransform, photo.aspectRatio, previewAspectRatio)
              }
            : photo
        )
      );
      return;
    }

    setOverlays((currentOverlays) =>
      currentOverlays.map((item) =>
        item.id === activeClip.id
          ? {
              ...item,
              transform: normalizeTransformForMedia(nextTransform, item.aspectRatio, previewAspectRatio)
            }
          : item
      )
    );
  };

  const updateActiveMedia = (updater: (current: DraftMediaBase) => DraftMediaBase) => {
    if (!activeClip) return;
    if (activeClip.source === 'batch') {
      setBatchPhotos((currentPhotos) =>
        currentPhotos.map((photo) => (photo.id === activeClip.id ? (updater(photo) as BatchPhotoDraft) : photo))
      );
      return;
    }

    setOverlays((currentOverlays) =>
      currentOverlays.map((item) => (item.id === activeClip.id ? updater(item) : item))
    );
  };

  const updateLinkedPairLayout = (nextLayout: OverlayLinkedPairLayout) => {
    setLinkedPairLayout(normalizeLinkedPairLayout(nextLayout, previewAspectRatio));
  };

  const updateLinkedPairStyle = (nextStyle: OverlayLinkedPairStyle) => {
    setLinkedPairStyle({
      outlineColor: nextStyle.outlineColor,
      outlineWidth: clamp(nextStyle.outlineWidth, 0, 36),
      cornerRadius: clamp(nextStyle.cornerRadius, 0, 72)
    });
  };

  const updateClipTimeline = (source: 'batch' | 'overlay', id: string, timeline: OverlayTimeline) => {
    const normalized = normalizeTimeline(timeline);
    if (source === 'batch') {
      setBatchPhotos((currentPhotos) =>
        currentPhotos.map((photo) => (photo.id === id ? { ...photo, timeline: normalized } : photo))
      );
      return;
    }
    setOverlays((currentOverlays) =>
      currentOverlays.map((item) => (item.id === id ? { ...item, timeline: normalized } : item))
    );
  };

  const getImageForSampling = (url: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const cached = imageSamplingCacheRef.current[url];
      if (cached && cached.complete && cached.naturalWidth > 0 && cached.naturalHeight > 0) {
        resolve(cached);
        return;
      }

      const image = new Image();
      image.onload = () => {
        imageSamplingCacheRef.current[url] = image;
        resolve(image);
      };
      image.onerror = () => reject(new Error('Failed to load image for color sampling.'));
      image.src = url;
    });

  const sampleColorFromActiveMediaAtPreviewPoint = async (clientX: number, clientY: number): Promise<string | null> => {
    if (!activeMedia || !previewRef.current) return null;

    const previewRect = previewRef.current.getBoundingClientRect();
    if (previewRect.width < 1 || previewRect.height < 1) return null;

    const previewX = (clientX - previewRect.left) / previewRect.width;
    const previewY = (clientY - previewRect.top) / previewRect.height;
    if (previewX < 0 || previewX > 1 || previewY < 0 || previewY > 1) return null;

    const transform = activeMedia.transform;
    const localX = (previewX - transform.x) / Math.max(0.0001, transform.width);
    const localY = (previewY - transform.y) / Math.max(0.0001, transform.height);
    if (localX < 0 || localX > 1 || localY < 0 || localY > 1) return null;

    const crop = normalizeCrop(activeMedia.crop);
    const sourceRatioX = clamp(crop.x + localX * crop.width, 0, 0.999999);
    const sourceRatioY = clamp(crop.y + localY * crop.height, 0, 0.999999);

    const sampleCanvas = previewColorSampleCanvasRef.current ?? document.createElement('canvas');
    previewColorSampleCanvasRef.current = sampleCanvas;
    sampleCanvas.width = 1;
    sampleCanvas.height = 1;
    const ctx = sampleCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.clearRect(0, 0, 1, 1);

    if (activeMedia.kind === 'image') {
      const image = await getImageForSampling(activeMedia.url);
      const sx = Math.floor(sourceRatioX * image.naturalWidth);
      const sy = Math.floor(sourceRatioY * image.naturalHeight);
      ctx.drawImage(image, sx, sy, 1, 1, 0, 0, 1, 1);
    } else {
      const videoNode = overlayVideoRefs.current[activeMedia.id];
      if (!videoNode || videoNode.videoWidth < 1 || videoNode.videoHeight < 1) return null;
      const sx = Math.floor(sourceRatioX * videoNode.videoWidth);
      const sy = Math.floor(sourceRatioY * videoNode.videoHeight);
      ctx.drawImage(videoNode, sx, sy, 1, 1, 0, 0, 1, 1);
    }

    const pixel = ctx.getImageData(0, 0, 1, 1).data;
    return rgbToHex(pixel[0], pixel[1], pixel[2]);
  };

  const handlePreviewColorPick = async (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isPreviewColorPickerActive) return;
    event.preventDefault();
    event.stopPropagation();

    const color = await sampleColorFromActiveMediaAtPreviewPoint(event.clientX, event.clientY);
    if (!color) {
      alert('Click inside the selected media layer in the preview to sample chroma key color.');
      return;
    }

    updateActiveMedia((item) => ({
      ...item,
      chromaKey: {
        ...item.chromaKey,
        enabled: true,
        color
      }
    }));
    setIsPreviewColorPickerActive(false);
  };

  const startTimelineDrag = (
    event: React.PointerEvent<HTMLElement>,
    source: 'batch' | 'overlay',
    id: string,
    mode: TimelineDragState['mode'],
    timeline: OverlayTimeline
  ) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    const lane = target?.closest('[data-timeline-lane="true"]') as HTMLElement | null;
    const laneRect = lane?.getBoundingClientRect();
    if (!laneRect || laneRect.width < 1) return;

    event.preventDefault();
    event.stopPropagation();
    setActiveClip({ source, id });
    setTimelineDragState({
      pointerId: event.pointerId,
      source,
      id,
      mode,
      startClientX: event.clientX,
      startTimeline: normalizeTimeline(timeline),
      laneWidth: laneRect.width
    });
  };

  useEffect(() => {
    if (!dragState || !activeMedia) return;

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== dragState.pointerId) return;
      event.preventDefault();
      const deltaX = (event.clientX - dragState.startClientX) / dragState.previewWidth;
      const deltaY = (event.clientY - dragState.startClientY) / dragState.previewHeight;

      if (dragState.mode === 'move') {
        updateActiveTransform({
          ...activeMedia.transform,
          x: clamp(dragState.startTransform.x + deltaX, 0, 1 - activeMedia.transform.width),
          y: clamp(dragState.startTransform.y + deltaY, 0, 1 - activeMedia.transform.height)
        });
        return;
      }

      const widthFromX = dragState.startTransform.width + deltaX;
      const heightFromY = dragState.startTransform.height + deltaY;
      const widthFromY = (heightFromY * activeMedia.aspectRatio) / Math.max(0.1, previewAspectRatio);
      const useYResize =
        Math.abs(widthFromY - dragState.startTransform.width) > Math.abs(widthFromX - dragState.startTransform.width);
      const widthCandidate = useYResize ? widthFromY : widthFromX;

      const minWidth = 0.05;
      const maxWidthByX = 1 - dragState.startTransform.x;
      const maxHeightByY = 1 - dragState.startTransform.y;
      const maxWidthByY = (maxHeightByY * activeMedia.aspectRatio) / Math.max(0.1, previewAspectRatio);
      const maxWidth = Math.max(minWidth, Math.min(maxWidthByX, maxWidthByY, 0.98));
      const nextWidth = clamp(widthCandidate, minWidth, maxWidth);
      const nextHeight = getHeightFromWidth(nextWidth, activeMedia.aspectRatio, previewAspectRatio);

      updateActiveTransform({
        ...activeMedia.transform,
        width: nextWidth,
        height: nextHeight
      });
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerId !== dragState.pointerId) return;
      setDragState(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [dragState, activeMedia, previewAspectRatio]);

  useEffect(() => {
    if (!linkedPairDragState) return;

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== linkedPairDragState.pointerId) return;
      event.preventDefault();

      const deltaX = (event.clientX - linkedPairDragState.startClientX) / linkedPairDragState.previewWidth;
      const deltaY = (event.clientY - linkedPairDragState.startClientY) / linkedPairDragState.previewHeight;

      if (linkedPairDragState.mode === 'move') {
        updateLinkedPairLayout({
          ...linkedPairDragState.startLayout,
          x: linkedPairDragState.startLayout.x + deltaX,
          y: linkedPairDragState.startLayout.y + deltaY
        });
        return;
      }

      const dominantDelta =
        Math.abs(event.clientX - linkedPairDragState.startClientX) >=
        Math.abs(event.clientY - linkedPairDragState.startClientY)
          ? event.clientX - linkedPairDragState.startClientX
          : event.clientY - linkedPairDragState.startClientY;
      const deltaSize = dominantDelta / Math.max(1, linkedPairDragState.previewMinDimension);

      updateLinkedPairLayout({
        ...linkedPairDragState.startLayout,
        size: linkedPairDragState.startLayout.size + deltaSize
      });
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerId !== linkedPairDragState.pointerId) return;
      setLinkedPairDragState(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [linkedPairDragState, previewAspectRatio]);

  useEffect(() => {
    if (!timelineDragState) return;

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== timelineDragState.pointerId) return;
      event.preventDefault();

      const minDuration = 0.05;
      const startTimeline = normalizeTimeline(timelineDragState.startTimeline);
      const currentDuration = Math.max(minDuration, startTimeline.end - startTimeline.start);
      const deltaSeconds =
        ((event.clientX - timelineDragState.startClientX) / Math.max(1, timelineDragState.laneWidth)) * timelineDuration;

      if (timelineDragState.mode === 'move') {
        const nextStart = clamp(startTimeline.start + deltaSeconds, 0, Math.max(0, timelineDuration - currentDuration));
        updateClipTimeline(timelineDragState.source, timelineDragState.id, {
          start: nextStart,
          end: nextStart + currentDuration
        });
        return;
      }

      if (timelineDragState.mode === 'trimStart') {
        const nextStart = clamp(startTimeline.start + deltaSeconds, 0, startTimeline.end - minDuration);
        updateClipTimeline(timelineDragState.source, timelineDragState.id, {
          start: nextStart,
          end: startTimeline.end
        });
        return;
      }

      const nextEnd = clamp(startTimeline.end + deltaSeconds, startTimeline.start + minDuration, timelineDuration);
      updateClipTimeline(timelineDragState.source, timelineDragState.id, {
        start: startTimeline.start,
        end: nextEnd
      });
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerId !== timelineDragState.pointerId) return;
      setTimelineDragState(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [timelineDragState, timelineDuration]);

  const applyBaseVideoFile = async (file: File) => {
    const nextUrl = URL.createObjectURL(file);
    if (baseVideoUrlRef.current) URL.revokeObjectURL(baseVideoUrlRef.current);
    setBaseVideoFile(file);
    setBaseVideoUrl(nextUrl);
    setBaseMode('video');
    const metadata = await readVideoMetadata(nextUrl);
    setBaseVideoAspectRatio(metadata.aspectRatio);
    if (metadata.duration > 0) {
      setBaseVideoDuration(metadata.duration);
      setPreviewTime((current) => clamp(current, 0, metadata.duration));
    }
  };

  const handleBaseVideoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await applyBaseVideoFile(file);
  };

  const handleBasePhotoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const nextUrl = URL.createObjectURL(file);
    if (basePhotoUrl) URL.revokeObjectURL(basePhotoUrl);
    setBasePhotoFile(file);
    setBasePhotoUrl(nextUrl);
    setBaseMode('photo');
    const aspectRatio = await readImageAspectRatio(nextUrl);
    setBasePhotoAspectRatio(aspectRatio);
  };

  const buildDefaultTimeline = (durationHint: number): OverlayTimeline => ({
    start: 0,
    end: Math.max(0.5, durationHint)
  });

  const createBatchPhotoDraftFromFile = async (
    file: File,
    hash: string,
    indexSeed: number,
    timeline: OverlayTimeline
  ): Promise<BatchPhotoDraft> => {
    const url = URL.createObjectURL(file);
    const aspectRatio = await readImageAspectRatio(url);
    const templateTransform = activeBatchPhoto?.transform;
    const baseTransform =
      applyTransformToAllPhotos && templateTransform
        ? templateTransform
        : getDefaultTransform(aspectRatio, previewAspectRatio);

    return {
      id: `${Date.now()}-batch-${indexSeed}-${file.name}`,
      name: file.name,
      kind: 'image',
      file,
      url,
      hash,
      aspectRatio,
      durationSeconds: 0,
      transform: normalizeTransformForMedia(baseTransform, aspectRatio, previewAspectRatio),
      crop: defaultCrop(),
      background: defaultBackground(),
      chromaKey: defaultChroma(),
      timeline: normalizeTimeline(timeline)
    };
  };

  const importIncomingVideoFramesToBatch = async (frames: VideoModeTransferFrame[]) => {
    if (!frames.length) return;

    setIsImportingVideoFrames(true);
    setVideoFrameImportSummary('');

    const importedPhotos: BatchPhotoDraft[] = [];
    const failedFrames: string[] = [];
    let maxImportedEnd = staticDurationSeconds;

    try {
      for (let index = 0; index < frames.length; index += 1) {
        const frame = frames[index];
        const fallbackName = (frame.name || '').trim() || `raw_frame_${index + 1}`;

        try {
          const file = await createFileFromImageSource(frame.image, fallbackName);
          const hash = await computeFileHash(file);
          const startSeconds = Math.max(0, frame.timeMs / 1000);
          const durationSeconds = Math.max(0.1, frame.durationMs / 1000);
          const timeline = normalizeTimeline({
            start: startSeconds,
            end: startSeconds + durationSeconds
          });
          maxImportedEnd = Math.max(maxImportedEnd, timeline.end);

          const draft = await createBatchPhotoDraftFromFile(
            file,
            `${hash}::${frame.clipId}::${frame.frame}::${index}`,
            index,
            timeline
          );

          const scale = Number.isFinite(frame.scale) && frame.scale > 0 ? frame.scale : 1;
          const width = clamp((frame.position?.width || 1) * scale, 0.05, 1);
          const x = clamp(frame.position?.x ?? 0, 0, Math.max(0, 1 - width));
          const y = clamp(frame.position?.y ?? 0, 0, 0.98);

          draft.transform = normalizeTransformForMedia(
            {
              x,
              y,
              width,
              height: frame.position?.height || 1
            },
            draft.aspectRatio,
            previewAspectRatio
          );
          draft.name = file.name;
          importedPhotos.push(draft);
        } catch {
          failedFrames.push(fallbackName);
        }
      }

      if (importedPhotos.length > 0) {
        setBatchPhotos((current) => [...current, ...importedPhotos]);
        setActiveClip((current) => current ?? { source: 'batch', id: importedPhotos[0].id });
        setBaseMode((current) => (current === 'video' && !baseVideoFile ? 'color' : current));
        setStaticDurationSeconds((current) => Math.max(current, maxImportedEnd));
      }

      const messages: string[] = [];
      if (importedPhotos.length > 0) messages.push(`Imported ${importedPhotos.length} raw frame clip(s) from Video mode.`);
      if (failedFrames.length > 0) messages.push(`${failedFrames.length} frame(s) failed to import.`);
      if (messages.length > 0) setVideoFrameImportSummary(messages.join(' '));
    } finally {
      setIsImportingVideoFrames(false);
    }
  };

  useEffect(() => {
    if (!incomingVideoFrames.length) return;
    if (lastVideoFramesSessionIdRef.current === incomingVideoFramesSessionId) return;
    lastVideoFramesSessionIdRef.current = incomingVideoFramesSessionId;
    void importIncomingVideoFramesToBatch(incomingVideoFrames);
  }, [incomingVideoFrames, incomingVideoFramesSessionId, previewAspectRatio, baseVideoFile, staticDurationSeconds]);

  const handleImportPuzzlesToBatch = async () => {
    if (isImportingPuzzles) return;
    if (!puzzles.length) {
      alert('No puzzles available to import.');
      return;
    }

    setIsImportingPuzzles(true);
    try {
      const knownHashes = new Set(batchPhotosRef.current.map((photo) => photo.hash));
      const importedPhotos: BatchPhotoDraft[] = [];
      const failedTitles: string[] = [];
      const duplicateTitles: string[] = [];
      let timelineCursor = batchPhotosRef.current.reduce(
        (acc, photo) => Math.max(acc, normalizeTimeline(photo.timeline).end),
        0
      );
      const clipDuration = Math.max(0.5, defaultPuzzleClipDurationSeconds || baseDuration);

      for (let index = 0; index < puzzles.length; index += 1) {
        const puzzle = puzzles[index];
        const fallbackTitle = (puzzle.title || '').trim() || `Puzzle ${index + 1}`;
        try {
          const file = await createPuzzleCompositeFile(puzzle, index, previewAspectRatio);
          const hash = await computeFileHash(file);
          if (knownHashes.has(hash)) {
            duplicateTitles.push(fallbackTitle);
            continue;
          }
          knownHashes.add(hash);

          const timeline: OverlayTimeline = {
            start: timelineCursor,
            end: timelineCursor + clipDuration
          };
          timelineCursor = timeline.end;
          importedPhotos.push(await createBatchPhotoDraftFromFile(file, hash, index, timeline));
        } catch {
          failedTitles.push(fallbackTitle);
        }
      }

      if (importedPhotos.length > 0) {
        setBatchPhotos((current) => [...current, ...importedPhotos]);
        setActiveClip((current) => current ?? { source: 'batch', id: importedPhotos[0].id });
      }

      const messages: string[] = [];
      if (importedPhotos.length > 0) messages.push(`Imported ${importedPhotos.length} puzzle clip(s).`);
      if (duplicateTitles.length > 0) messages.push(`${duplicateTitles.length} duplicate puzzle(s) skipped.`);
      if (failedTitles.length > 0) messages.push(`${failedTitles.length} puzzle(s) failed to import.`);
      if (messages.length > 0) alert(messages.join('\n'));
    } finally {
      setIsImportingPuzzles(false);
    }
  };

  const handleBatchPhotoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = event.currentTarget.files;
    const selectedFiles = fileList ? (Array.from(fileList as FileList) as File[]) : [];
    const files = selectedFiles.filter((file) => file.type.startsWith('image/'));
    if (!files.length) return;

    const knownHashes = new Set(batchPhotos.map((photo) => photo.hash));
    const skippedDuplicates: string[] = [];
    const newPhotos: BatchPhotoDraft[] = [];

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const hash = await computeFileHash(file);
      if (knownHashes.has(hash)) {
        skippedDuplicates.push(file.name);
        continue;
      }
      knownHashes.add(hash);
      newPhotos.push(await createBatchPhotoDraftFromFile(file, hash, index, buildDefaultTimeline(baseDuration)));
    }

    if (newPhotos.length > 0) {
      setBatchPhotos((current) => [...current, ...newPhotos]);
      setActiveClip((current) => current ?? { source: 'batch', id: newPhotos[0].id });
    }

    if (skippedDuplicates.length > 0) {
      alert(`${skippedDuplicates.length} duplicate image(s) skipped.`);
    }
  };

  const createLinkedPairDraft = async (
    puzzleFile: File,
    diffFile: File,
    pairName: string,
    sortKey: string,
    indexSeed: number
  ): Promise<LinkedPairDraft> => ({
    id: `${Date.now()}-pair-${indexSeed}-${pairName}`,
    name: pairName,
    puzzleFile,
    diffFile,
    puzzleUrl: URL.createObjectURL(puzzleFile),
    diffUrl: URL.createObjectURL(diffFile),
    sortKey
  });

  const handleLinkedPairUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = event.currentTarget.files;
    const selectedFiles = fileList ? (Array.from(fileList as FileList) as File[]) : [];
    const files = selectedFiles.filter((file) => file.type.startsWith('image/'));
    if (!files.length) return;

    const groupedPairs = new Map<string, { sortKey: string; baseName: string; base?: File; diff?: File }>();
    const duplicateEntries: string[] = [];

    files.forEach((file) => {
      const parsed = parsePuzzlePairFilename(file.name);
      const normalizedKey = parsed.base.trim().toLowerCase();
      if (!normalizedKey) return;
      const existing = groupedPairs.get(normalizedKey) ?? {
        sortKey: parsed.base,
        baseName: parsed.base.trim(),
        base: undefined,
        diff: undefined
      };

      if (parsed.type === 'diff') {
        if (existing.diff) {
          duplicateEntries.push(file.name);
          return;
        }
        existing.diff = file;
      } else {
        if (existing.base) {
          duplicateEntries.push(file.name);
          return;
        }
        existing.base = file;
      }

      groupedPairs.set(normalizedKey, existing);
    });

    const existingPairNames = new Set(linkedPairs.map((item) => item.sortKey.toLowerCase()));
    const incompletePairs: string[] = [];
    const skippedExistingPairs: string[] = [];
    const nextPairs: LinkedPairDraft[] = [];

    const sortedGroups = [...groupedPairs.values()].sort((left, right) =>
      left.sortKey.localeCompare(right.sortKey, undefined, { numeric: true, sensitivity: 'base' })
    );

    for (let index = 0; index < sortedGroups.length; index += 1) {
      const group = sortedGroups[index];
      if (!group.base || !group.diff) {
        incompletePairs.push(group.baseName);
        continue;
      }
      if (existingPairNames.has(group.baseName.toLowerCase())) {
        skippedExistingPairs.push(group.baseName);
        continue;
      }
      existingPairNames.add(group.baseName.toLowerCase());
      nextPairs.push(await createLinkedPairDraft(group.base, group.diff, group.baseName, group.baseName, index));
    }

    if (nextPairs.length > 0) {
      setLinkedPairs((current) => [...current, ...nextPairs]);
      setActiveLinkedPairId((current) => current ?? nextPairs[0].id);
      setActiveClip(null);
    }

    const messages: string[] = [];
    if (nextPairs.length > 0) messages.push(`Added ${nextPairs.length} linked puzzle pair(s).`);
    if (incompletePairs.length > 0) messages.push(`${incompletePairs.length} incomplete pair(s) skipped.`);
    if (skippedExistingPairs.length > 0) messages.push(`${skippedExistingPairs.length} existing pair(s) skipped.`);
    if (duplicateEntries.length > 0) messages.push(`${duplicateEntries.length} duplicate image(s) skipped.`);
    if (messages.length > 0) {
      alert(messages.join('\n'));
    }
  };

  const handleOverlayUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = event.currentTarget.files;
    const selectedFiles = fileList ? (Array.from(fileList as FileList) as File[]) : [];
    const files = selectedFiles.filter((file) => file.type.startsWith('image/') || file.type.startsWith('video/'));
    if (!files.length) return;

    const newOverlays: OverlayDraft[] = [];

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const kind: OverlayDraft['kind'] = file.type.startsWith('video/') ? 'video' : 'image';
      const url = URL.createObjectURL(file);
      const hash = await computeFileHash(file);

      let aspectRatio = 1;
      let durationSeconds = 0;
      if (kind === 'video') {
        const metadata = await readVideoMetadata(url);
        aspectRatio = metadata.aspectRatio;
        durationSeconds = metadata.duration;
      } else {
        aspectRatio = await readImageAspectRatio(url);
      }

      const defaultDuration = kind === 'video' ? Math.max(0.5, Math.min(baseDuration, durationSeconds || 4)) : baseDuration;

      newOverlays.push({
        id: `${Date.now()}-overlay-${index}-${file.name}`,
        name: file.name,
        kind,
        file,
        url,
        hash,
        aspectRatio,
        durationSeconds,
        transform: getDefaultTransform(aspectRatio, previewAspectRatio),
        crop: defaultCrop(),
        background: defaultBackground(),
        chromaKey: defaultChroma(),
        timeline: buildDefaultTimeline(defaultDuration)
      });
    }

    if (newOverlays.length > 0) {
      setOverlays((current) => [...current, ...newOverlays]);
      setActiveClip((current) => current ?? { source: 'overlay', id: newOverlays[0].id });
    }
  };

  const handleRemoveBatchPhoto = (id: string) => {
    setBatchPhotos((current) => {
      const target = current.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return current.filter((item) => item.id !== id);
    });
    setActiveClip((current) => (current?.source === 'batch' && current.id === id ? null : current));
  };

  const handleRemoveOverlay = (id: string) => {
    setOverlays((current) => {
      const target = current.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.url);
      delete overlayVideoRefs.current[id];
      return current.filter((item) => item.id !== id);
    });
    setActiveClip((current) => (current?.source === 'overlay' && current.id === id ? null : current));
  };

  const handleClearBatchPhotos = () => {
    batchPhotos.forEach((item) => URL.revokeObjectURL(item.url));
    setBatchPhotos([]);
    setActiveClip((current) => (current?.source === 'batch' ? null : current));
  };

  const handleRemoveLinkedPair = (id: string) => {
    setLinkedPairs((current) => {
      const target = current.find((item) => item.id === id);
      if (target) {
        URL.revokeObjectURL(target.puzzleUrl);
        URL.revokeObjectURL(target.diffUrl);
      }
      return current.filter((item) => item.id !== id);
    });
    setActiveLinkedPairId((current) => (current === id ? null : current));
  };

  const handleClearLinkedPairs = () => {
    linkedPairs.forEach((item) => {
      URL.revokeObjectURL(item.puzzleUrl);
      URL.revokeObjectURL(item.diffUrl);
    });
    setLinkedPairs([]);
    setActiveLinkedPairId(null);
    setActiveClip((current) => (current?.source === 'overlay' ? current : null));
  };

  const handleClearOverlays = () => {
    overlays.forEach((item) => URL.revokeObjectURL(item.url));
    overlayVideoRefs.current = {};
    setOverlays([]);
    setActiveClip((current) => (current?.source === 'overlay' ? null : current));
  };

  const handleResetActivePosition = () => {
    if (!activeMedia) return;
    updateActiveTransform(getDefaultTransform(activeMedia.aspectRatio, previewAspectRatio));
  };

  const handleExport = async () => {
    if (editorMode === 'linked_pairs' && linkedPairs.length === 0) {
      alert('Upload at least one linked puzzle pair before exporting.');
      return;
    }
    if (editorMode === 'standard' && baseMode !== 'video' && batchPhotos.length === 0) {
      alert('Upload at least one batch image when using a photo/color base.');
      return;
    }
    if (baseMode === 'video' && !baseVideoFile) {
      alert('Upload a base video first.');
      return;
    }
    if (baseMode === 'photo' && !basePhotoFile) {
      alert('Upload a base photo first.');
      return;
    }

    const payload: OverlayVideoEditorExportPayload = {
      editorMode,
      base: {
        mode: baseMode,
        color: baseColor,
        aspectRatio: previewAspectRatio,
        durationSeconds: baseDuration,
        videoFile: baseMode === 'video' ? baseVideoFile ?? undefined : undefined,
        photoFile: baseMode === 'photo' ? basePhotoFile ?? undefined : undefined
      },
      batchPhotos: batchPhotos.map((item) => ({
        id: item.id,
        name: item.name,
        kind: 'image',
        file: item.file,
        transform: item.transform,
        crop: normalizeCrop(item.crop),
        background: item.background,
        chromaKey: item.chromaKey,
        timeline: normalizeTimeline(item.timeline)
      })),
      overlays: overlays.map((item) => ({
        id: item.id,
        name: item.name,
        kind: item.kind,
        file: item.file,
        transform: item.transform,
        crop: normalizeCrop(item.crop),
        background: item.background,
        chromaKey: item.chromaKey,
        timeline: normalizeTimeline(item.timeline)
      })),
      linkedPairs:
        editorMode === 'linked_pairs'
          ? linkedPairs.map((item) => ({
              id: item.id,
              name: item.name,
              puzzleFile: item.puzzleFile,
              diffFile: item.diffFile
            }))
          : [],
      linkedPairLayout: editorMode === 'linked_pairs' ? normalizedLinkedPairLayout : undefined,
      linkedPairStyle: editorMode === 'linked_pairs' ? linkedPairStyle : undefined,
      linkedPairExportMode: editorMode === 'linked_pairs' ? linkedPairExportMode : undefined
    };

    await onExport(payload);
  };

  const timelineTracks = useMemo(() => {
    const tracks: Array<{ source: 'batch' | 'overlay'; item: DraftMediaBase; label: string }> = [];
    if (editorMode === 'standard') {
      batchPhotos.forEach((item, index) => {
        tracks.push({
          source: 'batch',
          item,
          label: `Batch ${index + 1}: ${item.name}`
        });
      });
    }
    overlays.forEach((item, index) => {
      tracks.push({
        source: 'overlay',
        item,
        label: `Overlay ${index + 1}: ${item.name}`
      });
    });
    return tracks;
  }, [batchPhotos, editorMode, overlays]);

  const canExport =
    (editorMode === 'linked_pairs' ? linkedPairs.length > 0 : baseMode === 'video' || batchPhotos.length > 0) &&
    (baseMode !== 'video' || Boolean(baseVideoFile)) &&
    (baseMode !== 'photo' || Boolean(basePhotoFile));

  const exportOutputCount =
    editorMode === 'linked_pairs'
      ? linkedPairs.length > 0
        ? linkedPairExportMode === 'single_video'
          ? 1
          : linkedPairs.length
        : 0
      : batchPhotos.length > 0
        ? batchPhotos.length
        : baseMode === 'video'
          ? 1
          : 0;
  const exportButtonLabel = isExporting
    ? 'Exporting...'
    : exportOutputCount > 0
      ? `Export ${exportOutputCount} Video${exportOutputCount === 1 ? '' : 's'}`
      : 'Export Video';

  const previewMaxWidth = previewAspectRatio < 1 ? 460 : undefined;
  const linkedPairBounds = useMemo(
    () => getLinkedPairBounds(normalizedLinkedPairLayout, previewAspectRatio),
    [normalizedLinkedPairLayout, previewAspectRatio]
  );

  const previewFrameStyle: React.CSSProperties = {
    aspectRatio: previewAspectRatio.toString(),
    width: previewMaxWidth ? `min(100%, ${previewMaxWidth}px)` : '100%'
  };

  return (
    <div className="w-full max-w-7xl mx-auto p-3 sm:p-4 md:p-6">
      <div className="bg-white border-4 border-black rounded-2xl shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
        <div className="bg-[#A7F3D0] border-b-4 border-black p-4 md:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3 sm:items-center sm:gap-4">
            <button
              onClick={onBack}
              className="p-2 bg-white border-2 border-black rounded-lg hover:bg-black hover:text-white transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
            >
              <ArrowLeft size={24} strokeWidth={3} />
            </button>
            <div className="min-w-0">
              <h2 className="text-xl sm:text-2xl md:text-3xl font-black font-display uppercase tracking-tight text-black">
                Overlay Editor+
              </h2>
              <p className="text-xs md:text-sm font-bold text-slate-700 uppercase tracking-wide">
                Batch images, crop/bg, extra overlays, chroma key and timeline
              </p>
            </div>
          </div>
            <div className="flex items-center gap-2 self-start sm:self-auto">
            <div className="px-3 py-2 bg-black text-white font-bold rounded-lg uppercase tracking-wider text-xs md:text-sm">
              Worker + WebCodecs
            </div>
          </div>
          </div>
        </div>

        <div className="p-4 md:p-6 space-y-6">
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div className="space-y-3 p-4 bg-[#FFFDF5] border-4 border-black rounded-xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
              <div className="space-y-2 pb-3 border-b-2 border-black">
                <label className="text-xs font-black uppercase tracking-wide">Creation Mode</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    onClick={() => setEditorMode('standard')}
                    className={`px-3 py-2 border-2 border-black rounded-lg text-xs font-black uppercase ${
                      editorMode === 'standard' ? 'bg-[#A7F3D0]' : 'bg-white hover:bg-slate-100'
                    }`}
                  >
                    Standard Overlay
                  </button>
                  <button
                    onClick={() => setEditorMode('linked_pairs')}
                    className={`px-3 py-2 border-2 border-black rounded-lg text-xs font-black uppercase ${
                      editorMode === 'linked_pairs' ? 'bg-[#FFD93D]' : 'bg-white hover:bg-slate-100'
                    }`}
                  >
                    Linked Puzzle Pairs
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <label className="text-lg font-black uppercase tracking-wide flex items-center gap-2">
                  <Video size={18} />
                  Base Source
                </label>
                <span className="text-xs font-black uppercase text-slate-600">{baseMode}</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <button
                  onClick={() => setBaseMode('video')}
                  className={`px-2 py-2 border-2 border-black rounded-lg text-xs font-black uppercase ${
                    baseMode === 'video' ? 'bg-[#A7F3D0]' : 'bg-white hover:bg-slate-100'
                  }`}
                >
                  Video
                </button>
                <button
                  onClick={() => setBaseMode('photo')}
                  className={`px-2 py-2 border-2 border-black rounded-lg text-xs font-black uppercase ${
                    baseMode === 'photo' ? 'bg-[#A7F3D0]' : 'bg-white hover:bg-slate-100'
                  }`}
                >
                  Photo
                </button>
                <button
                  onClick={() => setBaseMode('color')}
                  className={`px-2 py-2 border-2 border-black rounded-lg text-xs font-black uppercase ${
                    baseMode === 'color' ? 'bg-[#A7F3D0]' : 'bg-white hover:bg-slate-100'
                  }`}
                >
                  Color
                </button>
              </div>

              <div className="space-y-2 pt-1 border-t-2 border-black">
                <label className="block text-xs font-black uppercase">Output Aspect Ratio</label>
                <select
                  value={frameAspectPreset}
                  onChange={(event) => setFrameAspectPreset(event.target.value as AspectRatioPreset)}
                  className="w-full px-3 py-2 border-2 border-black rounded-lg font-bold bg-white"
                >
                  {ASPECT_RATIO_PRESET_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <div className="text-[10px] font-black uppercase text-slate-600">
                  {frameAspectPreset === 'auto'
                    ? `Current: ${sourceAspectRatio.toFixed(3)} (base)`
                    : `Current: ${previewAspectRatio.toFixed(3)}`}
                </div>
              </div>

              {baseMode === 'video' && (
                <div className="space-y-2">
                  <label className="inline-flex w-full items-center justify-center gap-2 px-4 py-2 bg-black text-white rounded-lg text-sm font-black uppercase tracking-wide cursor-pointer sm:w-auto">
                    <Upload size={16} />
                    <span>Upload Base Video</span>
                    <input type="file" accept="video/*" className="hidden" onChange={handleBaseVideoUpload} />
                  </label>
                  <div className="text-[10px] font-black uppercase text-slate-600">
                    {baseVideoFile
                      ? `${baseVideoFile.name} | ${baseVideoDuration.toFixed(2)}s`
                      : 'No base video selected'}
                  </div>
                </div>
              )}

              {baseMode === 'photo' && (
                <div className="space-y-2">
                  <label className="inline-flex w-full items-center justify-center gap-2 px-4 py-2 bg-black text-white rounded-lg text-sm font-black uppercase tracking-wide cursor-pointer sm:w-auto">
                    <Upload size={16} />
                    <span>Upload Base Photo</span>
                    <input type="file" accept="image/*" className="hidden" onChange={handleBasePhotoUpload} />
                  </label>
                  <div className="text-[10px] font-black uppercase text-slate-600">
                    {basePhotoFile ? basePhotoFile.name : 'No base photo selected'}
                  </div>
                  <label className="block text-xs font-black uppercase">Photo/Color Duration: {staticDurationSeconds.toFixed(1)}s</label>
                  <input
                    type="range"
                    min={1}
                    max={60}
                    step={0.5}
                    value={staticDurationSeconds}
                    onChange={(event) => setStaticDurationSeconds(Number(event.target.value))}
                    className="w-full h-4 border-2 border-black rounded-full accent-black"
                  />
                </div>
              )}

              {baseMode === 'color' && (
                <div className="space-y-2">
                  <label className="block text-xs font-black uppercase">Duration: {staticDurationSeconds.toFixed(1)}s</label>
                  <input
                    type="range"
                    min={1}
                    max={60}
                    step={0.5}
                    value={staticDurationSeconds}
                    onChange={(event) => setStaticDurationSeconds(Number(event.target.value))}
                    className="w-full h-4 border-2 border-black rounded-full accent-black"
                  />
                </div>
              )}

              <div className="border-t-2 border-black pt-2">
                <label className="block text-xs font-black uppercase mb-1">Base Background Color</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={baseColor}
                    onChange={(event) => setBaseColor(event.target.value)}
                    className="w-10 h-10 border-2 border-black rounded cursor-pointer bg-white"
                  />
                  <input
                    type="text"
                    value={baseColor}
                    onChange={(event) => setBaseColor(event.target.value)}
                    className="flex-1 px-3 py-2 border-2 border-black rounded-lg font-bold text-sm bg-white"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3 p-4 bg-[#FFFDF5] border-4 border-black rounded-xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
              {editorMode === 'standard' ? (
                <>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <label className="text-lg font-black uppercase tracking-wide flex items-center gap-2">
                      <ImagePlus size={18} />
                      Batch Images
                    </label>
                    <span className="text-xs font-black uppercase text-slate-600">{batchPhotos.length} selected</span>
                  </div>
                  <label className="inline-flex w-full items-center justify-center gap-2 px-4 py-2 bg-black text-white rounded-lg text-sm font-black uppercase tracking-wide cursor-pointer sm:w-auto">
                    <Upload size={16} />
                    <span>Upload Batch Photos</span>
                    <input type="file" accept="image/*" multiple className="hidden" onChange={handleBatchPhotoUpload} />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={handleClearBatchPhotos}
                      disabled={batchPhotos.length === 0}
                      className="px-3 py-2 bg-white border-2 border-black rounded-lg text-xs font-black uppercase hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Clear Batch
                    </button>
                    <button
                      onClick={() => void handleImportPuzzlesToBatch()}
                      disabled={isImportingPuzzles || puzzles.length === 0}
                      className="px-3 py-2 bg-white border-2 border-black rounded-lg text-xs font-black uppercase hover:bg-[#A7F3D0] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isImportingPuzzles ? 'Importing...' : `Import ${puzzles.length} Puzzle${puzzles.length === 1 ? '' : 's'}`}
                    </button>
                    <button
                      onClick={() =>
                        activeClip?.source === 'batch' &&
                        updateActiveMedia((item) => ({
                          ...item,
                          background: {
                            ...item.background,
                            enabled: !item.background.enabled
                          }
                        }))
                      }
                      disabled={activeClip?.source !== 'batch'}
                      className="px-3 py-2 bg-white border-2 border-black rounded-lg text-xs font-black uppercase hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {activeBatchPhoto?.background.enabled ? 'BG: ON' : 'Add BG'}
                    </button>
                    <button
                      onClick={() =>
                        activeClip?.source === 'batch' &&
                        updateActiveMedia((item) => ({
                          ...item,
                          crop: defaultCrop()
                        }))
                      }
                      disabled={activeClip?.source !== 'batch'}
                      className="px-3 py-2 bg-white border-2 border-black rounded-lg text-xs font-black uppercase hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Reset Crop
                    </button>
                  </div>
                  {(isImportingVideoFrames || videoFrameImportSummary) && (
                    <div className="text-[10px] font-black uppercase text-slate-700 bg-[#EEF9FF] border-2 border-black rounded-lg px-3 py-2">
                      {isImportingVideoFrames ? 'Importing raw clips from Video mode...' : videoFrameImportSummary}
                    </div>
                  )}
                  <p className="text-[10px] font-black uppercase text-slate-600">
                    {baseMode === 'video' && batchPhotos.length === 0
                      ? 'No batch image selected: export will render one edited base video.'
                      : 'One output video will be exported per batch image.'}
                  </p>
                </>
              ) : (
                <>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <label className="text-lg font-black uppercase tracking-wide flex items-center gap-2">
                      <Columns2 size={18} />
                      Puzzle Pairs
                    </label>
                    <span className="text-xs font-black uppercase text-slate-600">{linkedPairs.length} paired</span>
                  </div>
                  <label className="inline-flex w-full items-center justify-center gap-2 px-4 py-2 bg-black text-white rounded-lg text-sm font-black uppercase tracking-wide cursor-pointer sm:w-auto">
                    <Upload size={16} />
                    <span>Upload Puzzle + Answer Images</span>
                    <input type="file" accept="image/*" multiple className="hidden" onChange={handleLinkedPairUpload} />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={handleClearLinkedPairs}
                      disabled={linkedPairs.length === 0}
                      className="px-3 py-2 bg-white border-2 border-black rounded-lg text-xs font-black uppercase hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Clear Pairs
                    </button>
                    <button
                      onClick={() => {
                        setLinkedPairLayout(createDefaultLinkedPairLayout());
                        setLinkedPairStyle(createDefaultLinkedPairStyle());
                        setActiveClip(null);
                      }}
                      className="px-3 py-2 bg-white border-2 border-black rounded-lg text-xs font-black uppercase hover:bg-slate-100"
                    >
                      Reset Pair Frame
                    </button>
                  </div>
                  <div className="space-y-3 pt-1 border-t-2 border-black">
                    <div>
                      <label className="block text-xs font-black uppercase mb-1">Linked Gap: {(normalizedLinkedPairLayout.gap * 100).toFixed(1)}%</label>
                      <input
                        type="range"
                        min={0}
                        max={0.3}
                        step={0.005}
                        value={normalizedLinkedPairLayout.gap}
                        onChange={(event) =>
                          updateLinkedPairLayout({
                            ...normalizedLinkedPairLayout,
                            gap: Number(event.target.value)
                          })
                        }
                        className="w-full h-4 border-2 border-black rounded-full accent-black"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-black uppercase mb-1">Export Style</label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <button
                          onClick={() => setLinkedPairExportMode('one_per_pair')}
                          className={`px-3 py-2 border-2 border-black rounded-lg text-xs font-black uppercase ${
                            linkedPairExportMode === 'one_per_pair' ? 'bg-[#A7F3D0]' : 'bg-white hover:bg-slate-100'
                          }`}
                        >
                          One Video Per Pair
                        </button>
                        <button
                          onClick={() => setLinkedPairExportMode('single_video')}
                          className={`px-3 py-2 border-2 border-black rounded-lg text-xs font-black uppercase ${
                            linkedPairExportMode === 'single_video' ? 'bg-[#FFD93D]' : 'bg-white hover:bg-slate-100'
                          }`}
                        >
                          All Pairs In One
                        </button>
                      </div>
                    </div>
                  </div>
                  <p className="text-[10px] font-black uppercase text-slate-600">
                    Images are paired by filename. Files ending in <code>diff</code> become the answer frame; the matching base
                    name becomes the puzzle frame.
                  </p>
                </>
              )}
            </div>

            <div className="space-y-3 p-4 bg-[#FFFDF5] border-4 border-black rounded-xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <label className="text-lg font-black uppercase tracking-wide flex items-center gap-2">
                  <Layers size={18} />
                  Extra Overlays
                </label>
                <span className="text-xs font-black uppercase text-slate-600">{overlays.length} selected</span>
              </div>
              <label className="inline-flex w-full items-center justify-center gap-2 px-4 py-2 bg-black text-white rounded-lg text-sm font-black uppercase tracking-wide cursor-pointer sm:w-auto">
                <Upload size={16} />
                <span>Add Photos/Videos</span>
                <input type="file" accept="image/*,video/*" multiple className="hidden" onChange={handleOverlayUpload} />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleClearOverlays}
                  disabled={overlays.length === 0}
                  className="px-3 py-2 bg-white border-2 border-black rounded-lg text-xs font-black uppercase hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Clear Overlays
                </button>
                <span className="px-3 py-2 bg-[#EEF9FF] border-2 border-black rounded-lg text-[10px] font-black uppercase">
                  Chroma Key + Timeline Supported
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2.8fr)_minmax(320px,1fr)] gap-6">
            <div className="space-y-4 p-4 bg-[#F8FDFF] border-4 border-black rounded-xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-lg font-black uppercase tracking-wide flex items-center gap-2">
                  <Move size={18} />
                  Preview + Positioning
                </h3>
                <span className="text-xs font-black uppercase text-slate-600">{selectedPhotoPositionLabel}</span>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <button
                  onClick={() => setIsPreviewPlaying((value) => !value)}
                  className="inline-flex items-center gap-2 px-3 py-2 bg-white border-2 border-black rounded-lg text-xs font-black uppercase hover:bg-slate-100"
                >
                  {isPreviewPlaying ? <Pause size={14} /> : <Play size={14} />}
                  <span>{isPreviewPlaying ? 'Pause' : 'Play'}</span>
                </button>
                <div className="w-full min-w-0 flex-1">
                  <input
                    type="range"
                    min={0}
                    max={timelineDuration}
                    step={0.01}
                    value={previewTime}
                    onChange={(event) => setPreviewTime(Number(event.target.value))}
                    className="w-full h-4 border-2 border-black rounded-full accent-black"
                  />
                </div>
                <div className="w-full rounded-lg border-2 border-black bg-white px-3 py-2 text-center text-xs font-black uppercase tabular-nums sm:w-auto">
                  {previewTime.toFixed(2)}s / {timelineDuration.toFixed(2)}s
                </div>
              </div>

              <div
                ref={previewRef}
                onPointerDown={handlePreviewColorPick}
                className={`relative w-full mx-auto border-4 border-black rounded-xl overflow-hidden bg-black ${
                  isPreviewColorPickerActive ? 'cursor-crosshair' : ''
                }`}
                style={previewFrameStyle}
              >
                {baseMode === 'video' && baseVideoUrl && (
                  <video ref={baseVideoRef} src={baseVideoUrl} className="absolute inset-0 w-full h-full object-cover" muted playsInline />
                )}
                {baseMode === 'photo' && basePhotoUrl && (
                  <div className="absolute inset-0" style={{ backgroundColor: baseColor }}>
                    <img src={basePhotoUrl} alt="Base" className="w-full h-full object-contain" draggable={false} />
                  </div>
                )}
                {baseMode === 'color' && <div className="absolute inset-0" style={{ backgroundColor: baseColor }} />}
                {baseMode === 'video' && !baseVideoUrl && (
                  <div className="absolute inset-0 flex items-center justify-center text-white font-black uppercase tracking-wide text-sm">
                    Upload a base video
                  </div>
                )}
                {baseMode === 'photo' && !basePhotoUrl && (
                  <div className="absolute inset-0 flex items-center justify-center text-white font-black uppercase tracking-wide text-sm">
                    Upload a base photo
                  </div>
                )}

                {editorMode === 'linked_pairs' && previewLinkedPair && (
                  <div
                    onPointerDown={(event) => {
                      if (isPreviewColorPickerActive) return;
                      const rect = previewRef.current?.getBoundingClientRect();
                      if (!rect) return;
                      event.preventDefault();
                      event.stopPropagation();
                      setActiveClip(null);
                      setActiveLinkedPairId(previewLinkedPair.id);
                      setLinkedPairDragState({
                        pointerId: event.pointerId,
                        mode: 'move',
                        startClientX: event.clientX,
                        startClientY: event.clientY,
                        startLayout: normalizedLinkedPairLayout,
                        previewWidth: Math.max(1, rect.width),
                        previewHeight: Math.max(1, rect.height),
                        previewMinDimension: Math.max(1, Math.min(rect.width, rect.height))
                      });
                    }}
                    className={`absolute ${!activeClip ? 'cursor-move active:cursor-grabbing' : 'cursor-pointer'}`}
                    style={{
                      ...linkedPairBounds.container,
                      touchAction: 'none'
                    }}
                  >
                    {[
                      { key: 'puzzle', label: 'Puzzle', src: previewLinkedPair.puzzleUrl, style: linkedPairBounds.puzzle },
                      { key: 'diff', label: 'Answer', src: previewLinkedPair.diffUrl, style: linkedPairBounds.diff }
                    ].map((panel) => (
                      <div
                        key={panel.key}
                        className="absolute overflow-hidden bg-[#F8FAFC]"
                        style={{
                          ...panel.style,
                          borderStyle: 'solid',
                          borderWidth: `${linkedPairStyle.outlineWidth}px`,
                          borderColor: linkedPairStyle.outlineColor,
                          borderRadius: `${linkedPairStyle.cornerRadius}px`,
                          boxSizing: 'border-box'
                        }}
                      >
                        <div className="absolute top-1 left-1 z-10 px-1.5 py-0.5 rounded bg-black/80 text-white text-[9px] font-black uppercase tracking-wide">
                          {panel.label}
                        </div>
                        <img
                          src={panel.src}
                          alt={`${previewLinkedPair.name} ${panel.label}`}
                          className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none"
                          draggable={false}
                        />
                      </div>
                    ))}
                    <button
                      type="button"
                      onPointerDown={(event) => {
                        const rect = previewRef.current?.getBoundingClientRect();
                        if (!rect) return;
                        event.preventDefault();
                        event.stopPropagation();
                        setActiveClip(null);
                        setActiveLinkedPairId(previewLinkedPair.id);
                        setLinkedPairDragState({
                          pointerId: event.pointerId,
                          mode: 'resize',
                          startClientX: event.clientX,
                          startClientY: event.clientY,
                          startLayout: normalizedLinkedPairLayout,
                          previewWidth: Math.max(1, rect.width),
                          previewHeight: Math.max(1, rect.height),
                          previewMinDimension: Math.max(1, Math.min(rect.width, rect.height))
                        });
                      }}
                      className="absolute -bottom-2 -right-2 z-20 h-6 w-6 rounded-full border-2 border-black bg-white text-[10px] font-black"
                    >
                      <Move size={10} className="mx-auto" />
                    </button>
                  </div>
                )}

                {previewEntries.map(({ source, item }) => {
                  const isActive = activeClip?.source === source && activeClip.id === item.id;
                  const onStartMove = (event: React.PointerEvent<HTMLDivElement>) => {
                    if (isPreviewColorPickerActive) return;
                    if (!isActive) {
                      setActiveClip({ source, id: item.id });
                      return;
                    }
                    const rect = previewRef.current?.getBoundingClientRect();
                    if (!rect) return;
                    event.preventDefault();
                    setDragState({
                      pointerId: event.pointerId,
                      mode: 'move',
                      startClientX: event.clientX,
                      startClientY: event.clientY,
                      startTransform: item.transform,
                      previewWidth: Math.max(1, rect.width),
                      previewHeight: Math.max(1, rect.height)
                    });
                  };

                  return (
                    <div
                      key={item.id}
                      onPointerDown={onStartMove}
                      className={`absolute overflow-hidden ${
                        isActive ? 'border-2 border-[#FFD93D] bg-white/20 cursor-move active:cursor-grabbing' : 'border border-white/70 bg-white/10'
                      }`}
                      style={{
                        left: `${item.transform.x * 100}%`,
                        top: `${item.transform.y * 100}%`,
                        width: `${item.transform.width * 100}%`,
                        height: `${item.transform.height * 100}%`,
                        backgroundColor: item.background.enabled ? item.background.color : undefined,
                        touchAction: 'none'
                      }}
                    >
                      <div className="absolute top-1 left-1 z-10 px-1.5 py-0.5 rounded bg-black/80 text-white text-[9px] font-black uppercase tracking-wide">
                        {source === 'batch' ? 'batch' : item.kind}
                      </div>

                      {item.chromaKey.enabled ? (
                        <PreviewChromaMedia
                          item={item}
                          previewTime={previewTime}
                          registerVideoRef={
                            item.kind === 'video'
                              ? (node) => {
                                  overlayVideoRefs.current[item.id] = node;
                                }
                              : undefined
                          }
                        />
                      ) : item.kind === 'image' ? (
                        <img
                          src={item.url}
                          alt={item.name}
                          className="absolute top-0 left-0 pointer-events-none select-none"
                          style={getCroppedStyle(item.crop)}
                          draggable={false}
                        />
                      ) : (
                        <video
                          ref={(node) => {
                            overlayVideoRefs.current[item.id] = node;
                          }}
                          src={item.url}
                          className="absolute top-0 left-0 pointer-events-none select-none"
                          style={getCroppedStyle(item.crop)}
                          muted
                          playsInline
                          preload="metadata"
                        />
                      )}

                      {isActive && (
                        <button
                          type="button"
                          onPointerDown={(event) => {
                            if (isPreviewColorPickerActive) return;
                            const rect = previewRef.current?.getBoundingClientRect();
                            if (!rect) return;
                            event.preventDefault();
                            event.stopPropagation();
                            setDragState({
                              pointerId: event.pointerId,
                              mode: 'resize',
                              startClientX: event.clientX,
                              startClientY: event.clientY,
                              startTransform: item.transform,
                              previewWidth: Math.max(1, rect.width),
                              previewHeight: Math.max(1, rect.height)
                            });
                          }}
                          className="absolute -bottom-2 -right-2 w-5 h-5 rounded-full bg-[#FFD93D] border-2 border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] cursor-se-resize"
                          aria-label="Resize selected media"
                        />
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => {
                    if (editorMode === 'linked_pairs') {
                      setActiveClip(null);
                      updateLinkedPairLayout(createDefaultLinkedPairLayout());
                      setLinkedPairStyle(createDefaultLinkedPairStyle());
                      return;
                    }
                    handleResetActivePosition();
                  }}
                  disabled={editorMode === 'standard' && !activeMedia}
                  className="inline-flex items-center gap-2 px-3 py-2 bg-white border-2 border-black rounded-lg text-xs font-black uppercase hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RotateCcw size={14} />
                  <span>{editorMode === 'linked_pairs' ? 'Reset Pair Frame' : 'Reset Position'}</span>
                </button>
                {editorMode === 'standard' ? (
                  <button
                    onClick={() => setApplyTransformToAllPhotos((value) => !value)}
                    className={`px-3 py-2 border-2 border-black rounded-lg text-xs font-black uppercase transition-colors ${
                      applyTransformToAllPhotos ? 'bg-[#A7F3D0]' : 'bg-white hover:bg-slate-100'
                    }`}
                  >
                    {applyTransformToAllPhotos ? 'Sync Batch: ON' : 'Sync Batch: OFF'}
                  </button>
                ) : (
                  <span className="px-3 py-2 bg-[#FFF8D6] border-2 border-black rounded-lg text-[10px] font-black uppercase">
                    Drag to move. Drag handle to resize linked squares.
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-4">
              {editorMode === 'standard' ? (
                <div className="space-y-3 p-4 bg-[#FFFDF5] border-4 border-black rounded-xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                  <h3 className="text-lg font-black uppercase tracking-wide">Batch Images</h3>
                  <div className="max-h-52 overflow-y-auto space-y-2 pr-1">
                    {batchPhotos.map((item, index) => (
                      <div
                        key={item.id}
                        className={`p-2 border-2 border-black rounded-lg flex items-center gap-2 ${
                          activeClip?.source === 'batch' && activeClip.id === item.id
                            ? 'bg-[#A7F3D0] shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
                            : 'bg-white'
                        }`}
                      >
                        <button
                          onClick={() => setActiveClip({ source: 'batch', id: item.id })}
                          className="flex-1 min-w-0 flex items-center gap-2 text-left"
                        >
                          <img src={item.url} alt={item.name} className="w-12 h-12 object-cover border-2 border-black rounded-md" />
                          <div className="min-w-0">
                            <div className="text-xs font-black uppercase truncate">{`${index + 1}. ${item.name}`}</div>
                            <div className="text-[10px] font-bold uppercase text-slate-600">
                              {`${item.timeline.start.toFixed(1)}s - ${item.timeline.end.toFixed(1)}s`}
                            </div>
                          </div>
                        </button>
                        <button
                          onClick={() => handleRemoveBatchPhoto(item.id)}
                          className="p-1.5 bg-white border-2 border-black rounded-md hover:bg-red-50"
                          aria-label={`Remove ${item.name}`}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                    {batchPhotos.length === 0 && (
                      <div className="text-xs font-bold uppercase text-slate-500 border-2 border-dashed border-slate-300 rounded-lg p-3 text-center">
                        Upload batch images.
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-3 p-4 bg-[#FFFDF5] border-4 border-black rounded-xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-lg font-black uppercase tracking-wide">Linked Pairs</h3>
                    <span className="text-xs font-black uppercase text-slate-600">{linkedPairs.length} total</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-black uppercase mb-1">Pair X: {(normalizedLinkedPairLayout.x * 100).toFixed(1)}%</label>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.005}
                        value={normalizedLinkedPairLayout.x}
                        onChange={(event) =>
                          updateLinkedPairLayout({
                            ...normalizedLinkedPairLayout,
                            x: Number(event.target.value)
                          })
                        }
                        className="w-full h-4 border-2 border-black rounded-full accent-black"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-black uppercase mb-1">Pair Y: {(normalizedLinkedPairLayout.y * 100).toFixed(1)}%</label>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.005}
                        value={normalizedLinkedPairLayout.y}
                        onChange={(event) =>
                          updateLinkedPairLayout({
                            ...normalizedLinkedPairLayout,
                            y: Number(event.target.value)
                          })
                        }
                        className="w-full h-4 border-2 border-black rounded-full accent-black"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-black uppercase mb-1">Square Size: {(normalizedLinkedPairLayout.size * 100).toFixed(1)}%</label>
                      <input
                        type="range"
                        min={0.08}
                        max={0.48}
                        step={0.005}
                        value={normalizedLinkedPairLayout.size}
                        onChange={(event) =>
                          updateLinkedPairLayout({
                            ...normalizedLinkedPairLayout,
                            size: Number(event.target.value)
                          })
                        }
                        className="w-full h-4 border-2 border-black rounded-full accent-black"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-black uppercase mb-1">Outline Thickness: {linkedPairStyle.outlineWidth.toFixed(0)}px</label>
                      <input
                        type="range"
                        min={0}
                        max={24}
                        step={1}
                        value={linkedPairStyle.outlineWidth}
                        onChange={(event) =>
                          updateLinkedPairStyle({
                            ...linkedPairStyle,
                            outlineWidth: Number(event.target.value)
                          })
                        }
                        className="w-full h-4 border-2 border-black rounded-full accent-black"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-black uppercase mb-1">Corner Roundness: {linkedPairStyle.cornerRadius.toFixed(0)}px</label>
                      <input
                        type="range"
                        min={0}
                        max={48}
                        step={1}
                        value={linkedPairStyle.cornerRadius}
                        onChange={(event) =>
                          updateLinkedPairStyle({
                            ...linkedPairStyle,
                            cornerRadius: Number(event.target.value)
                          })
                        }
                        className="w-full h-4 border-2 border-black rounded-full accent-black"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-black uppercase mb-1">Outline Color</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={linkedPairStyle.outlineColor}
                          onChange={(event) =>
                            updateLinkedPairStyle({
                              ...linkedPairStyle,
                              outlineColor: event.target.value
                            })
                          }
                          className="w-10 h-10 border-2 border-black rounded bg-white"
                        />
                        <input
                          type="text"
                          value={linkedPairStyle.outlineColor}
                          onChange={(event) =>
                            updateLinkedPairStyle({
                              ...linkedPairStyle,
                              outlineColor: event.target.value
                            })
                          }
                          className="flex-1 px-3 py-2 border-2 border-black rounded-lg font-bold text-sm bg-white"
                        />
                      </div>
                    </div>
                    <div className="text-[10px] font-black uppercase text-slate-600 bg-[#EEF9FF] border-2 border-black rounded-lg px-3 py-3">
                      Landscape layouts stay side by side. Vertical layouts stack top and bottom automatically. In single-video export,
                      clicking a pair also seeks the preview to that pair's slot.
                    </div>
                  </div>
                  <div className="max-h-80 overflow-y-auto space-y-2 pr-1">
                    {linkedPairs.map((item, index) => {
                      const isSelected = activeLinkedPairId === item.id && !activeClip;
                      const segment = linkedPairSegments[index];
                      return (
                        <div
                          key={item.id}
                          className={`p-2 border-2 border-black rounded-lg flex items-center gap-2 ${
                            isSelected ? 'bg-[#FFD93D] shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]' : 'bg-white'
                          }`}
                        >
                          <button
                            onClick={() => {
                              setActiveLinkedPairId(item.id);
                              setActiveClip(null);
                              if (linkedPairExportMode === 'single_video' && segment) {
                                setPreviewTime(segment.start);
                              }
                            }}
                            className="flex-1 min-w-0 flex items-center gap-2 text-left"
                          >
                            <div className="flex items-center gap-1">
                              <img src={item.puzzleUrl} alt={`${item.name} puzzle`} className="w-10 h-10 object-cover border-2 border-black rounded-md" />
                              <img src={item.diffUrl} alt={`${item.name} answer`} className="w-10 h-10 object-cover border-2 border-black rounded-md" />
                            </div>
                            <div className="min-w-0">
                              <div className="text-xs font-black uppercase truncate">{`${index + 1}. ${item.name}`}</div>
                              <div className="text-[10px] font-bold uppercase text-slate-600">
                                {linkedPairExportMode === 'single_video' && segment
                                  ? `${segment.start.toFixed(1)}s - ${segment.end.toFixed(1)}s`
                                  : 'full clip duration'}
                              </div>
                            </div>
                          </button>
                          <button
                            onClick={() => handleRemoveLinkedPair(item.id)}
                            className="p-1.5 bg-white border-2 border-black rounded-md hover:bg-red-50"
                            aria-label={`Remove ${item.name}`}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      );
                    })}
                    {linkedPairs.length === 0 && (
                      <div className="text-xs font-bold uppercase text-slate-500 border-2 border-dashed border-slate-300 rounded-lg p-3 text-center">
                        Upload matched puzzle and answer images.
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="space-y-3 p-4 bg-[#FFFDF5] border-4 border-black rounded-xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                <h3 className="text-lg font-black uppercase tracking-wide">Overlays</h3>
                <div className="max-h-52 overflow-y-auto space-y-2 pr-1">
                  {overlays.map((item, index) => (
                    <div
                      key={item.id}
                      className={`p-2 border-2 border-black rounded-lg flex items-center gap-2 ${
                        activeClip?.source === 'overlay' && activeClip.id === item.id
                          ? 'bg-[#A7F3D0] shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
                          : 'bg-white'
                      }`}
                    >
                      <button
                        onClick={() => setActiveClip({ source: 'overlay', id: item.id })}
                        className="flex-1 min-w-0 flex items-center gap-2 text-left"
                      >
                        {item.kind === 'image' ? (
                          <img src={item.url} alt={item.name} className="w-12 h-12 object-cover border-2 border-black rounded-md" />
                        ) : (
                          <div className="w-12 h-12 border-2 border-black rounded-md bg-black text-white flex items-center justify-center">
                            <Video size={16} />
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="text-xs font-black uppercase truncate">{`${index + 1}. ${item.name}`}</div>
                          <div className="text-[10px] font-bold uppercase text-slate-600">
                            {`${item.kind} | ${item.timeline.start.toFixed(1)}s - ${item.timeline.end.toFixed(1)}s`}
                          </div>
                        </div>
                      </button>
                      <button
                        onClick={() => handleRemoveOverlay(item.id)}
                        className="p-1.5 bg-white border-2 border-black rounded-md hover:bg-red-50"
                        aria-label={`Remove ${item.name}`}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                  {overlays.length === 0 && (
                    <div className="text-xs font-bold uppercase text-slate-500 border-2 border-dashed border-slate-300 rounded-lg p-3 text-center">
                      Add extra photo/video overlays.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4 p-4 bg-[#EEF9FF] border-4 border-black rounded-xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-black uppercase tracking-wide flex items-center gap-2">
                <Scissors size={16} />
                Active Media Controls
              </h3>
              <span className="text-xs font-black uppercase text-slate-600">{activeMedia ? activeMedia.name : 'None'}</span>
            </div>

            {!activeMedia && (
              <div className="text-xs font-bold uppercase text-slate-500 border-2 border-dashed border-slate-300 rounded-lg p-3 text-center">
                {editorMode === 'linked_pairs'
                  ? 'Select an overlay to edit it. Linked pair layout is controlled from the linked pairs panel.'
                  : 'Select a batch image or overlay to edit crop, background, chroma key and timeline.'}
              </div>
            )}

            {activeMedia && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-black uppercase mb-1">Crop X: {(activeMedia.crop.x * 100).toFixed(0)}%</label>
                    <input
                      type="range"
                      min={0}
                      max={0.95}
                      step={0.01}
                      value={activeMedia.crop.x}
                      onChange={(event) => {
                        const nextX = Number(event.target.value);
                        updateActiveMedia((item) => {
                          const crop = normalizeCrop({ ...item.crop, x: nextX });
                          return { ...item, crop };
                        });
                      }}
                      className="w-full h-4 border-2 border-black rounded-full accent-black"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-black uppercase mb-1">Crop Y: {(activeMedia.crop.y * 100).toFixed(0)}%</label>
                    <input
                      type="range"
                      min={0}
                      max={0.95}
                      step={0.01}
                      value={activeMedia.crop.y}
                      onChange={(event) => {
                        const nextY = Number(event.target.value);
                        updateActiveMedia((item) => {
                          const crop = normalizeCrop({ ...item.crop, y: nextY });
                          return { ...item, crop };
                        });
                      }}
                      className="w-full h-4 border-2 border-black rounded-full accent-black"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-black uppercase mb-1">
                      Crop Width: {(activeMedia.crop.width * 100).toFixed(0)}%
                    </label>
                    <input
                      type="range"
                      min={0.05}
                      max={1}
                      step={0.01}
                      value={activeMedia.crop.width}
                      onChange={(event) => {
                        const nextWidth = Number(event.target.value);
                        updateActiveMedia((item) => {
                          const crop = normalizeCrop({ ...item.crop, width: nextWidth });
                          return { ...item, crop };
                        });
                      }}
                      className="w-full h-4 border-2 border-black rounded-full accent-black"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-black uppercase mb-1">
                      Crop Height: {(activeMedia.crop.height * 100).toFixed(0)}%
                    </label>
                    <input
                      type="range"
                      min={0.05}
                      max={1}
                      step={0.01}
                      value={activeMedia.crop.height}
                      onChange={(event) => {
                        const nextHeight = Number(event.target.value);
                        updateActiveMedia((item) => {
                          const crop = normalizeCrop({ ...item.crop, height: nextHeight });
                          return { ...item, crop };
                        });
                      }}
                      className="w-full h-4 border-2 border-black rounded-full accent-black"
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="p-3 bg-white border-2 border-black rounded-lg space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black uppercase flex items-center gap-1">
                        <Palette size={12} />
                        Background Fill
                      </span>
                      <button
                        onClick={() =>
                          updateActiveMedia((item) => ({
                            ...item,
                            background: {
                              ...item.background,
                              enabled: !item.background.enabled
                            }
                          }))
                        }
                        className={`px-2 py-1 border-2 border-black rounded-md text-[10px] font-black uppercase ${
                          activeMedia.background.enabled ? 'bg-[#A7F3D0]' : 'bg-white'
                        }`}
                      >
                        {activeMedia.background.enabled ? 'On' : 'Off'}
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={activeMedia.background.color}
                        onChange={(event) =>
                          updateActiveMedia((item) => ({
                            ...item,
                            background: {
                              ...item.background,
                              color: event.target.value
                            }
                          }))
                        }
                        className="w-9 h-9 border-2 border-black rounded bg-white"
                      />
                      <input
                        type="text"
                        value={activeMedia.background.color}
                        onChange={(event) =>
                          updateActiveMedia((item) => ({
                            ...item,
                            background: {
                              ...item.background,
                              color: event.target.value
                            }
                          }))
                        }
                        className="flex-1 px-3 py-2 border-2 border-black rounded-lg font-bold text-sm"
                      />
                    </div>
                  </div>

                  <div className="p-3 bg-white border-2 border-black rounded-lg space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black uppercase flex items-center gap-1">
                        <Sparkles size={12} />
                        Chroma Key
                      </span>
                      <button
                        onClick={() =>
                          updateActiveMedia((item) => ({
                            ...item,
                            chromaKey: {
                              ...item.chromaKey,
                              enabled: !item.chromaKey.enabled
                            }
                          }))
                        }
                        className={`px-2 py-1 border-2 border-black rounded-md text-[10px] font-black uppercase ${
                          activeMedia.chromaKey.enabled ? 'bg-[#A7F3D0]' : 'bg-white'
                        }`}
                      >
                        {activeMedia.chromaKey.enabled ? 'On' : 'Off'}
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={activeMedia.chromaKey.color}
                        onChange={(event) =>
                          updateActiveMedia((item) => ({
                            ...item,
                            chromaKey: {
                              ...item.chromaKey,
                              color: event.target.value
                            }
                          }))
                        }
                        className="w-9 h-9 border-2 border-black rounded bg-white"
                      />
                      <input
                        type="text"
                        value={activeMedia.chromaKey.color}
                        onChange={(event) =>
                          updateActiveMedia((item) => ({
                            ...item,
                            chromaKey: {
                              ...item.chromaKey,
                              color: event.target.value
                            }
                          }))
                        }
                        className="flex-1 px-3 py-2 border-2 border-black rounded-lg font-bold text-sm"
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setIsPreviewColorPickerActive((value) => !value)}
                        className={`px-3 py-2 border-2 border-black rounded-lg text-[10px] font-black uppercase ${
                          isPreviewColorPickerActive ? 'bg-[#FFD93D]' : 'bg-white hover:bg-slate-100'
                        }`}
                      >
                        {isPreviewColorPickerActive ? 'Click Preview To Pick' : 'Pick From Preview'}
                      </button>
                      <span className="text-[10px] font-bold uppercase text-slate-600">
                        Select clip then click exact color in preview.
                      </span>
                    </div>

                    <label className="block text-xs font-black uppercase">
                      Similarity: {activeMedia.chromaKey.similarity.toFixed(2)}
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={activeMedia.chromaKey.similarity}
                      onChange={(event) =>
                        updateActiveMedia((item) => ({
                          ...item,
                          chromaKey: {
                            ...item.chromaKey,
                            similarity: Number(event.target.value)
                          }
                        }))
                      }
                      className="w-full h-4 border-2 border-black rounded-full accent-black"
                    />

                    <label className="block text-xs font-black uppercase">
                      Smoothness: {activeMedia.chromaKey.smoothness.toFixed(2)}
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={activeMedia.chromaKey.smoothness}
                      onChange={(event) =>
                        updateActiveMedia((item) => ({
                          ...item,
                          chromaKey: {
                            ...item.chromaKey,
                            smoothness: Number(event.target.value)
                          }
                        }))
                      }
                      className="w-full h-4 border-2 border-black rounded-full accent-black"
                    />
                  </div>
                </div>
              </div>
            )}

            {activeMedia && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t-2 border-black">
                <div>
                  <label className="block text-xs font-black uppercase mb-1 flex items-center gap-1">
                    <Clock3 size={12} />
                    Timeline Start: {activeMedia.timeline.start.toFixed(2)}s
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={timelineDuration}
                    step={0.01}
                    value={activeMedia.timeline.start}
                    onChange={(event) => {
                      const start = Number(event.target.value);
                      updateActiveMedia((item) => ({
                        ...item,
                        timeline: normalizeTimeline({
                          start,
                          end: Math.max(start + 0.05, item.timeline.end)
                        })
                      }));
                    }}
                    className="w-full h-4 border-2 border-black rounded-full accent-black"
                  />
                </div>
                <div>
                  <label className="block text-xs font-black uppercase mb-1">
                    Timeline End: {activeMedia.timeline.end.toFixed(2)}s
                  </label>
                  <input
                    type="range"
                    min={0.05}
                    max={timelineDuration}
                    step={0.01}
                    value={activeMedia.timeline.end}
                    onChange={(event) => {
                      const end = Number(event.target.value);
                      updateActiveMedia((item) => ({
                        ...item,
                        timeline: normalizeTimeline({
                          start: Math.min(item.timeline.start, end - 0.05),
                          end
                        })
                      }));
                    }}
                    className="w-full h-4 border-2 border-black rounded-full accent-black"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="space-y-3 p-4 bg-[#FFFDF5] border-4 border-black rounded-xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black uppercase tracking-wide">Timeline</h3>
              <span className="text-xs font-black uppercase text-slate-600">{timelineTracks.length} tracks</span>
            </div>
            <p className="text-[10px] font-black uppercase text-slate-600">
              Drag clips to move. Drag clip edges to trim start/end. Click lane to seek playhead.
            </p>
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {timelineTracks.map((track) => {
                const normalized = normalizeTimeline(track.item.timeline);
                const startPct = (normalized.start / timelineDuration) * 100;
                const widthPct = Math.max(0.8, ((normalized.end - normalized.start) / timelineDuration) * 100);
                const playheadPct = (previewTime / timelineDuration) * 100;
                const isActive = activeClip?.source === track.source && activeClip.id === track.item.id;
                return (
                  <div
                    key={`${track.source}-${track.item.id}`}
                    className={`w-full p-2 border-2 border-black rounded-lg text-left ${
                      isActive ? 'bg-[#A7F3D0]' : 'bg-white hover:bg-slate-100'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setActiveClip({ source: track.source, id: track.item.id })}
                      className="w-full text-left"
                    >
                      <div className="text-[10px] font-black uppercase truncate mb-1">{track.label}</div>
                    </button>
                    <div
                      data-timeline-lane="true"
                      className="relative h-10 rounded bg-slate-200 border border-black cursor-pointer"
                      onPointerDown={(event) => {
                        if (event.button !== 0) return;
                        if (event.target !== event.currentTarget) return;
                        const rect = event.currentTarget.getBoundingClientRect();
                        const ratio = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
                        setActiveClip({ source: track.source, id: track.item.id });
                        setPreviewTime(ratio * timelineDuration);
                      }}
                    >
                      <div
                        className={`absolute top-1 bottom-1 rounded border border-black ${
                          isActive ? 'bg-[#FFD93D]' : 'bg-black/85'
                        }`}
                        style={{
                          left: `${startPct}%`,
                          width: `${widthPct}%`
                        }}
                        onPointerDown={(event) =>
                          startTimelineDrag(event, track.source, track.item.id, 'move', normalized)
                        }
                      >
                        <div
                          className="absolute left-0 top-0 bottom-0 w-2 bg-white/80 border-r border-black cursor-ew-resize"
                          onPointerDown={(event) =>
                            startTimelineDrag(event, track.source, track.item.id, 'trimStart', normalized)
                          }
                        />
                        <div
                          className="absolute right-0 top-0 bottom-0 w-2 bg-white/80 border-l border-black cursor-ew-resize"
                          onPointerDown={(event) =>
                            startTimelineDrag(event, track.source, track.item.id, 'trimEnd', normalized)
                          }
                        />
                        <div className="absolute inset-0 px-3 flex items-center justify-between pointer-events-none">
                          <span className="text-[9px] font-black uppercase text-white mix-blend-difference">
                            {normalized.start.toFixed(2)}s
                          </span>
                          <span className="text-[9px] font-black uppercase text-white mix-blend-difference">
                            {normalized.end.toFixed(2)}s
                          </span>
                        </div>
                      </div>
                      <div
                        className="absolute top-[-2px] bottom-[-2px] w-[2px] bg-red-600"
                        style={{ left: `${playheadPct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
              {timelineTracks.length === 0 && (
                <div className="text-xs font-bold uppercase text-slate-500 border-2 border-dashed border-slate-300 rounded-lg p-3 text-center">
                  {editorMode === 'linked_pairs'
                    ? 'Linked pairs render automatically. Add overlays if you want timed extra media.'
                    : 'Add overlays, or add batch images to export multiple outputs.'}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4 p-4 bg-[#EEF9FF] border-4 border-black rounded-xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            <h3 className="text-lg font-black uppercase tracking-wide">Export Settings</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-black uppercase mb-1">Resolution</label>
                <select
                  value={settings.exportResolution}
                  onChange={(event) =>
                    onSettingsChange({
                      exportResolution: event.target.value as OverlayExportSettings['exportResolution']
                    })
                  }
                  className="w-full px-3 py-2 border-2 border-black rounded-lg font-bold bg-white"
                >
                  <option value="480p">480p</option>
                  <option value="720p">720p</option>
                  <option value="1080p">1080p</option>
                  <option value="1440p">1440p</option>
                  <option value="2160p">4K</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-black uppercase mb-1">Codec</label>
                <select
                  value={settings.exportCodec}
                  onChange={(event) =>
                    onSettingsChange({
                      exportCodec: event.target.value as OverlayExportSettings['exportCodec']
                    })
                  }
                  className="w-full px-3 py-2 border-2 border-black rounded-lg font-bold bg-white"
                >
                  <option value="h264">H.264 (MP4)</option>
                  <option value="av1">AV1 (WebM)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-black uppercase mb-1">
                  Bitrate: {settings.exportBitrateMbps.toFixed(1)} Mbps
                </label>
                <input
                  type="range"
                  min={1}
                  max={80}
                  step={0.5}
                  value={settings.exportBitrateMbps}
                  onChange={(event) =>
                    onSettingsChange({
                      exportBitrateMbps: Number(event.target.value)
                    })
                  }
                  className="w-full h-4 border-2 border-black rounded-full accent-black"
                />
              </div>
            </div>
          </div>

          <div className="pt-4 border-t-4 border-black flex justify-stretch sm:justify-end">
            <button
              onClick={handleExport}
              disabled={isExporting || !canExport}
              className={`w-full justify-center px-6 py-4 border-4 border-black rounded-xl text-base sm:text-lg font-black uppercase tracking-wider transition-all flex items-center gap-2 sm:w-auto ${
                isExporting || !canExport
                  ? 'bg-slate-300 text-slate-600 cursor-not-allowed'
                  : 'bg-black text-white hover:bg-slate-900 shadow-[4px_4px_0px_0px_rgba(255,255,255,1)]'
              }`}
            >
              <Download size={20} strokeWidth={3} />
              <span>{exportButtonLabel}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
