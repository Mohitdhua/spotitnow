import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Clock3,
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
import { OverlayTransform, VideoSettings } from '../types';
import type {
  OverlayBackgroundFill,
  OverlayBaseInput,
  OverlayBatchPhotoInput,
  OverlayChromaKey,
  OverlayCrop,
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
  base: OverlayBaseInput;
  batchPhotos: OverlayBatchPhotoInput[];
  overlays: OverlayMediaClipInput[];
}

interface OverlayVideoEditorProps {
  settings: OverlayExportSettings;
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

  const [batchPhotos, setBatchPhotos] = useState<BatchPhotoDraft[]>([]);
  const [overlays, setOverlays] = useState<OverlayDraft[]>([]);
  const [activeClip, setActiveClip] = useState<ActiveClipRef | null>(null);
  const [applyTransformToAllPhotos, setApplyTransformToAllPhotos] = useState(true);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [timelineDragState, setTimelineDragState] = useState<TimelineDragState | null>(null);

  const [previewTime, setPreviewTime] = useState(0);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [isPreviewColorPickerActive, setIsPreviewColorPickerActive] = useState(false);

  const previewRef = useRef<HTMLDivElement>(null);
  const baseVideoRef = useRef<HTMLVideoElement | null>(null);
  const overlayVideoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const previewColorSampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageSamplingCacheRef = useRef<Record<string, HTMLImageElement>>({});

  const baseVideoUrlRef = useRef<string | null>(null);
  const basePhotoUrlRef = useRef<string | null>(null);
  const batchPhotosRef = useRef<BatchPhotoDraft[]>([]);
  const overlaysRef = useRef<OverlayDraft[]>([]);

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
    overlaysRef.current = overlays;
  }, [overlays]);

  useEffect(() => {
    return () => {
      if (baseVideoUrlRef.current) URL.revokeObjectURL(baseVideoUrlRef.current);
      if (basePhotoUrlRef.current) URL.revokeObjectURL(basePhotoUrlRef.current);
      batchPhotosRef.current.forEach((item) => URL.revokeObjectURL(item.url));
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
  }, [previewAspectRatio]);

  const baseDuration = useMemo(() => {
    if (baseMode === 'video') return Math.max(0.5, baseVideoDuration || 0.5);
    return Math.max(0.5, staticDurationSeconds);
  }, [baseMode, baseVideoDuration, staticDurationSeconds]);

  const timelineDuration = useMemo(() => {
    const maxBatchEnd = batchPhotos.reduce((acc, photo) => Math.max(acc, normalizeTimeline(photo.timeline).end), 0);
    const maxOverlayEnd = overlays.reduce((acc, overlay) => Math.max(acc, normalizeTimeline(overlay.timeline).end), 0);
    return Math.max(1, baseDuration, maxBatchEnd, maxOverlayEnd);
  }, [baseDuration, batchPhotos, overlays]);

  useEffect(() => {
    setPreviewTime((current) => clamp(current, 0, timelineDuration));
  }, [timelineDuration]);

  useEffect(() => {
    if (!activeClip) {
      if (batchPhotos.length > 0) {
        setActiveClip({ source: 'batch', id: batchPhotos[0].id });
      } else if (overlays.length > 0) {
        setActiveClip({ source: 'overlay', id: overlays[0].id });
      }
      return;
    }

    const exists =
      activeClip.source === 'batch'
        ? batchPhotos.some((item) => item.id === activeClip.id)
        : overlays.some((item) => item.id === activeClip.id);

    if (!exists) {
      if (batchPhotos.length > 0) {
        setActiveClip({ source: 'batch', id: batchPhotos[0].id });
      } else if (overlays.length > 0) {
        setActiveClip({ source: 'overlay', id: overlays[0].id });
      } else {
        setActiveClip(null);
      }
    }
  }, [activeClip, batchPhotos, overlays]);

  const activeBatchPhoto = useMemo(
    () => (activeClip?.source === 'batch' ? batchPhotos.find((item) => item.id === activeClip.id) ?? null : null),
    [activeClip, batchPhotos]
  );
  const activeOverlay = useMemo(
    () => (activeClip?.source === 'overlay' ? overlays.find((item) => item.id === activeClip.id) ?? null : null),
    [activeClip, overlays]
  );
  const activeMedia = activeBatchPhoto ?? activeOverlay;

  useEffect(() => {
    if (!activeMedia) setIsPreviewColorPickerActive(false);
  }, [activeMedia]);

  const previewPrimaryPhoto = useMemo(() => {
    if (activeBatchPhoto) return activeBatchPhoto;
    return batchPhotos[0] ?? null;
  }, [activeBatchPhoto, batchPhotos]);

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

  const selectedPhotoPositionLabel = activeMedia
    ? `x:${(activeMedia.transform.x * 100).toFixed(1)}% y:${(activeMedia.transform.y * 100).toFixed(1)}% size:${(
        activeMedia.transform.width * 100
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

  const handleBaseVideoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const nextUrl = URL.createObjectURL(file);
    if (baseVideoUrl) URL.revokeObjectURL(baseVideoUrl);
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

  const handleBatchPhotoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).filter((file) => file.type.startsWith('image/'));
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

      const url = URL.createObjectURL(file);
      const aspectRatio = await readImageAspectRatio(url);
      const templateTransform = activeBatchPhoto?.transform;
      const baseTransform =
        applyTransformToAllPhotos && templateTransform
          ? templateTransform
          : getDefaultTransform(aspectRatio, previewAspectRatio);

      newPhotos.push({
        id: `${Date.now()}-batch-${index}-${file.name}`,
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
        timeline: buildDefaultTimeline(baseDuration)
      });
    }

    if (newPhotos.length > 0) {
      setBatchPhotos((current) => [...current, ...newPhotos]);
      setActiveClip((current) => current ?? { source: 'batch', id: newPhotos[0].id });
    }

    if (skippedDuplicates.length > 0) {
      alert(`${skippedDuplicates.length} duplicate image(s) skipped.`);
    }
  };

  const handleOverlayUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).filter((file) =>
      file.type.startsWith('image/') || file.type.startsWith('video/')
    );
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
    if (batchPhotos.length === 0) {
      alert('Upload at least one batch image.');
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
      }))
    };

    await onExport(payload);
  };

  const timelineTracks = useMemo(() => {
    const tracks: Array<{ source: 'batch' | 'overlay'; item: DraftMediaBase; label: string }> = [];
    batchPhotos.forEach((item, index) => {
      tracks.push({
        source: 'batch',
        item,
        label: `Batch ${index + 1}: ${item.name}`
      });
    });
    overlays.forEach((item, index) => {
      tracks.push({
        source: 'overlay',
        item,
        label: `Overlay ${index + 1}: ${item.name}`
      });
    });
    return tracks;
  }, [batchPhotos, overlays]);

  const canExport =
    batchPhotos.length > 0 &&
    (baseMode !== 'video' || Boolean(baseVideoFile)) &&
    (baseMode !== 'photo' || Boolean(basePhotoFile));

  const previewMaxWidth = previewAspectRatio < 1 ? 460 : undefined;

  const previewFrameStyle: React.CSSProperties = {
    aspectRatio: previewAspectRatio.toString(),
    width: previewMaxWidth ? `min(100%, ${previewMaxWidth}px)` : '100%'
  };

  return (
    <div className="w-full max-w-7xl mx-auto p-4 md:p-6">
      <div className="bg-white border-4 border-black rounded-2xl shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
        <div className="bg-[#A7F3D0] p-4 md:p-6 border-b-4 border-black flex items-center justify-between gap-4">
          <div className="flex items-center space-x-4">
            <button
              onClick={onBack}
              className="p-2 bg-white border-2 border-black rounded-lg hover:bg-black hover:text-white transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
            >
              <ArrowLeft size={24} strokeWidth={3} />
            </button>
            <div>
              <h2 className="text-2xl md:text-3xl font-black font-display uppercase tracking-tight text-black">
                Overlay Editor+
              </h2>
              <p className="text-xs md:text-sm font-bold text-slate-700 uppercase tracking-wide">
                Batch images, crop/bg, extra overlays, chroma key and timeline
              </p>
            </div>
          </div>
          <div className="px-3 py-2 bg-black text-white font-bold rounded-lg uppercase tracking-wider text-xs md:text-sm">
            Worker + WebCodecs
          </div>
        </div>

        <div className="p-4 md:p-6 space-y-6">
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div className="space-y-3 p-4 bg-[#FFFDF5] border-4 border-black rounded-xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
              <div className="flex items-center justify-between">
                <label className="text-lg font-black uppercase tracking-wide flex items-center gap-2">
                  <Video size={18} />
                  Base Source
                </label>
                <span className="text-xs font-black uppercase text-slate-600">{baseMode}</span>
              </div>

              <div className="grid grid-cols-3 gap-2">
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
                  <label className="inline-flex items-center gap-2 px-4 py-2 bg-black text-white rounded-lg text-sm font-black uppercase tracking-wide cursor-pointer">
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
                  <label className="inline-flex items-center gap-2 px-4 py-2 bg-black text-white rounded-lg text-sm font-black uppercase tracking-wide cursor-pointer">
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
              <div className="flex items-center justify-between">
                <label className="text-lg font-black uppercase tracking-wide flex items-center gap-2">
                  <ImagePlus size={18} />
                  Batch Images
                </label>
                <span className="text-xs font-black uppercase text-slate-600">{batchPhotos.length} selected</span>
              </div>
              <label className="inline-flex items-center gap-2 px-4 py-2 bg-black text-white rounded-lg text-sm font-black uppercase tracking-wide cursor-pointer">
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
              <p className="text-[10px] font-black uppercase text-slate-600">
                One output video will be exported per batch image.
              </p>
            </div>

            <div className="space-y-3 p-4 bg-[#FFFDF5] border-4 border-black rounded-xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
              <div className="flex items-center justify-between">
                <label className="text-lg font-black uppercase tracking-wide flex items-center gap-2">
                  <Layers size={18} />
                  Extra Overlays
                </label>
                <span className="text-xs font-black uppercase text-slate-600">{overlays.length} selected</span>
              </div>
              <label className="inline-flex items-center gap-2 px-4 py-2 bg-black text-white rounded-lg text-sm font-black uppercase tracking-wide cursor-pointer">
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

              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => setIsPreviewPlaying((value) => !value)}
                  className="inline-flex items-center gap-2 px-3 py-2 bg-white border-2 border-black rounded-lg text-xs font-black uppercase hover:bg-slate-100"
                >
                  {isPreviewPlaying ? <Pause size={14} /> : <Play size={14} />}
                  <span>{isPreviewPlaying ? 'Pause' : 'Play'}</span>
                </button>
                <div className="flex-1 min-w-[220px]">
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
                <div className="text-xs font-black uppercase bg-white border-2 border-black rounded-lg px-3 py-2 tabular-nums">
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
                  onClick={handleResetActivePosition}
                  disabled={!activeMedia}
                  className="inline-flex items-center gap-2 px-3 py-2 bg-white border-2 border-black rounded-lg text-xs font-black uppercase hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RotateCcw size={14} />
                  <span>Reset Position</span>
                </button>
                <button
                  onClick={() => setApplyTransformToAllPhotos((value) => !value)}
                  className={`px-3 py-2 border-2 border-black rounded-lg text-xs font-black uppercase transition-colors ${
                    applyTransformToAllPhotos ? 'bg-[#A7F3D0]' : 'bg-white hover:bg-slate-100'
                  }`}
                >
                  {applyTransformToAllPhotos ? 'Sync Batch: ON' : 'Sync Batch: OFF'}
                </button>
              </div>
            </div>

            <div className="space-y-4">
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
                Select a batch image or overlay to edit crop, background, chroma key and timeline.
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
                  Add batch photos and overlays to build the timeline.
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4 p-4 bg-[#EEF9FF] border-4 border-black rounded-xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            <h3 className="text-lg font-black uppercase tracking-wide">Export Settings</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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

          <div className="pt-4 border-t-4 border-black flex justify-end">
            <button
              onClick={handleExport}
              disabled={isExporting || !canExport}
              className={`px-8 py-4 border-4 border-black rounded-xl text-lg font-black uppercase tracking-wider transition-all flex items-center gap-2 ${
                isExporting || !canExport
                  ? 'bg-slate-300 text-slate-600 cursor-not-allowed'
                  : 'bg-black text-white hover:bg-slate-900 shadow-[4px_4px_0px_0px_rgba(255,255,255,1)]'
              }`}
            >
              <Download size={20} strokeWidth={3} />
              <span>{isExporting ? 'Exporting...' : `Export ${batchPhotos.length || ''} Videos`}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
