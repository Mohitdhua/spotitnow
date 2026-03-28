import { ArrowLeft, Download, Image as ImageIcon, RefreshCw, Upload, Wand2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { notifyError, notifySuccess } from '../services/notifications';
import type { Puzzle } from '../types';

type ThumbnailStyleId = 'challenge_banner' | 'sharp_eyes';

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
  borderWidth: number;
  cornerRadius: number;
}

const THUMBNAIL_WIDTH = 1280;
const THUMBNAIL_HEIGHT = 720;
const EMPTY_SLOT: ImageSlotState = { src: null, name: '', source: 'empty' };
const DEFAULT_LAYOUT_CONTROLS: ThumbnailLayoutControls = {
  panelGap: 16,
  borderWidth: 6,
  cornerRadius: 28
};

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

const drawImageCover = (
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number
) => {
  const imageWidth = Math.max(1, image.naturalWidth || image.width);
  const imageHeight = Math.max(1, image.naturalHeight || image.height);
  const scale = Math.max(width / imageWidth, height / imageHeight);
  const drawWidth = imageWidth * scale;
  const drawHeight = imageHeight * scale;
  const drawX = x + (width - drawWidth) / 2;
  const drawY = y + (height - drawHeight) / 2;
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
    drawImageCover(ctx, image, panel.x, panel.y, panel.width, panel.height);
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

const renderFailureState = (ctx: CanvasRenderingContext2D) => {
  ctx.clearRect(0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
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

  const panelY = 144;
  const panelGap = clamp(controls.panelGap, 0, 48);
  const panelLeft = 28;
  const panelWidth = (THUMBNAIL_WIDTH - panelLeft * 2 - panelGap) / 2;
  const panelHeight = THUMBNAIL_HEIGHT - panelY - 18;
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
      placeholderAccent: '#22C55E'
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
      placeholderAccent: '#FB7185'
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

  const panelY = 176;
  const panelGap = clamp(controls.panelGap, 0, 48);
  const panelLeft = 28;
  const panelWidth = (THUMBNAIL_WIDTH - panelLeft * 2 - panelGap) / 2;
  const panelHeight = THUMBNAIL_HEIGHT - panelY - 28;
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
      placeholderAccent: '#38BDF8'
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
      placeholderAccent: '#F97316'
    }
  );

  ctx.lineWidth = Math.max(4, panelBorderWidth + 2);
  ctx.strokeStyle = '#111111';
  const outerInset = Math.max(2, ctx.lineWidth / 2);
  ctx.strokeRect(outerInset, outerInset, THUMBNAIL_WIDTH - outerInset * 2, THUMBNAIL_HEIGHT - outerInset * 2);
};

const renderThumbnailScene = (
  ctx: CanvasRenderingContext2D,
  styleId: ThumbnailStyleId,
  headline: string,
  puzzleImage: HTMLImageElement | null,
  diffImage: HTMLImageElement | null,
  controls: ThumbnailLayoutControls
) => {
  ctx.clearRect(0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (styleId === 'challenge_banner') {
    renderChallengeBanner(ctx, headline, puzzleImage, diffImage, controls);
  } else {
    renderSharpEyes(ctx, headline, puzzleImage, diffImage, controls);
  }
};

const SlotPreview = ({
  title,
  subtitle,
  slot,
  onUpload,
  onClear
}: {
  title: string;
  subtitle: string;
  slot: ImageSlotState;
  onUpload: () => void;
  onClear: () => void;
}) => (
  <div className="rounded-[26px] border-4 border-black bg-white p-4 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">{subtitle}</div>
        <h3 className="mt-2 text-xl font-black uppercase tracking-tight text-slate-900">{title}</h3>
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

    <div className="mt-4 aspect-[4/3] overflow-hidden rounded-[22px] border-4 border-black bg-[linear-gradient(145deg,#F8FAFC_0%,#E2E8F0_100%)]">
      {slot.src ? (
        <img src={slot.src} alt={title} className="h-full w-full object-cover" />
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

    <div className="mt-4 min-h-11 rounded-2xl border-2 border-black bg-[#FFFDF5] px-3 py-3 text-sm font-semibold text-slate-700">
      {slot.name || 'No image selected yet.'}
    </div>

    <div className="mt-4 flex flex-wrap gap-3">
      <button
        type="button"
        onClick={onUpload}
        className="inline-flex items-center gap-2 rounded-xl border-2 border-black bg-[#FDE68A] px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-900 hover:bg-[#FCD34D]"
      >
        <Upload size={14} strokeWidth={2.5} />
        {slot.src ? 'Replace Image' : 'Upload Image'}
      </button>
      <button
        type="button"
        onClick={onClear}
        disabled={!slot.src}
        className="inline-flex items-center gap-2 rounded-xl border-2 border-black bg-white px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <X size={14} strokeWidth={2.5} />
        Clear
      </button>
    </div>
  </div>
);

export function ThumbnailGeneratorMode({ currentPuzzle, batch, onBack }: ThumbnailGeneratorModeProps) {
  const puzzleInputRef = useRef<HTMLInputElement | null>(null);
  const diffInputRef = useRef<HTMLInputElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderRequestRef = useRef(0);
  const autoLoadedCurrentPuzzleRef = useRef(false);
  const [styleId, setStyleId] = useState<ThumbnailStyleId>('challenge_banner');
  const [headline, setHeadline] = useState(STYLE_PRESETS.challenge_banner.defaultHeadline);
  const [puzzleSlot, setPuzzleSlot] = useState<ImageSlotState>(EMPTY_SLOT);
  const [diffSlot, setDiffSlot] = useState<ImageSlotState>(EMPTY_SLOT);
  const [layoutControls, setLayoutControls] = useState<ThumbnailLayoutControls>(DEFAULT_LAYOUT_CONTROLS);

  const preset = STYLE_PRESETS[styleId];
  const currentPuzzleName = (currentPuzzle?.title || '').trim() || 'selected-puzzle';

  const loadCurrentPuzzleIntoSlots = (options?: { announce?: boolean }) => {
    if (!currentPuzzle) {
      notifyError('There is no selected puzzle in the workspace yet.');
      return;
    }

    setPuzzleSlot(createSlotFromPuzzleImage(currentPuzzle.imageA, `${currentPuzzleName}-puzzle`));
    setDiffSlot(createSlotFromPuzzleImage(currentPuzzle.imageB, `${currentPuzzleName}-diff`));

    if (options?.announce) {
      notifySuccess('Selected puzzle loaded into the thumbnail generator.');
    }
  };

  useEffect(() => {
    if (!currentPuzzle || autoLoadedCurrentPuzzleRef.current) return;
    loadCurrentPuzzleIntoSlots();
    autoLoadedCurrentPuzzleRef.current = true;
  }, [currentPuzzle]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

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

      renderThumbnailScene(ctx, styleId, headline, puzzleImage, diffImage, layoutControls);
    };

    void render().catch(() => {
      if (disposed || renderRequestRef.current !== requestId) {
        return;
      }
      renderFailureState(ctx);
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

  const handleDownload = async () => {
    if (!puzzleSlot.src || !diffSlot.src) {
      notifyError('Upload both a puzzle image and a puzzle diff image before exporting.');
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      notifyError('Preview canvas is not ready yet.');
      return;
    }

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) {
      notifyError('Failed to create the thumbnail PNG.');
      return;
    }

    const fileName = `${currentPuzzleName.replace(/\s+/g, '-').toLowerCase()}-${styleId}.png`;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    notifySuccess('Thumbnail PNG downloaded.');
  };

  const handleBatchExport = async () => {
    if (!batch.length) {
      notifyError('There is no puzzle batch available to export.');
      return;
    }

    try {
      const offscreenCanvas = document.createElement('canvas');
      offscreenCanvas.width = THUMBNAIL_WIDTH;
      offscreenCanvas.height = THUMBNAIL_HEIGHT;
      const ctx = offscreenCanvas.getContext('2d');
      if (!ctx) {
        notifyError('Failed to initialize the batch thumbnail canvas.');
        return;
      }

      const safeHeadline = headline.trim() || preset.defaultHeadline;

      for (let index = 0; index < batch.length; index += 1) {
        const item = batch[index];
        const [puzzleImage, diffImage] = await Promise.all([
          loadImageElement(item.imageA),
          loadImageElement(item.imageB)
        ]);

        renderThumbnailScene(ctx, styleId, safeHeadline, puzzleImage, diffImage, layoutControls);

        const blob = await new Promise<Blob | null>((resolve) => offscreenCanvas.toBlob(resolve, 'image/png'));
        if (!blob) {
          throw new Error(`Failed to create thumbnail ${index + 1}.`);
        }

        const fileBaseName = sanitizeFileBaseName(item.title?.trim() || `puzzle-${index + 1}`);
        const fileName = `${fileBaseName}-${styleId}.png`;
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

      notifySuccess(`Started ${batch.length} thumbnail download${batch.length === 1 ? '' : 's'} for the current batch.`);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Batch thumbnail export failed.');
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border-4 border-black bg-white p-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#2563EB]">Thumbnail Generator</div>
            <h1 className="mt-3 text-3xl font-black uppercase tracking-tight text-slate-900 sm:text-4xl">
              Build bold puzzle thumbnails from separate puzzle and diff uploads
            </h1>
            <p className="mt-3 text-sm font-semibold text-slate-600 sm:text-base">
              This tool keeps the two images explicit: one slot for the puzzle image and one slot for the puzzle diff image.
              You can start from the current selected puzzle or replace either side with a new upload.
            </p>
          </div>

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
                className="inline-flex items-center gap-2 rounded-xl border-2 border-black bg-[#DBEAFE] px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-900 hover:bg-[#BFDBFE]"
              >
                <Download size={14} strokeWidth={2.5} />
                Export Batch PNGs
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-6">
          <section className="rounded-[28px] border-4 border-black bg-white p-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Styles</div>
                <h2 className="mt-2 text-2xl font-black uppercase tracking-tight text-slate-900">Two Presets</h2>
              </div>
              <div className="rounded-2xl border-2 border-black bg-[#FFF7ED] px-4 py-3 text-xs font-black uppercase text-slate-900">
                1280 x 720 PNG
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
            </div>

            <div className="mt-6 rounded-[24px] border-4 border-black bg-[#F8FAFC] p-4">
              <div className="text-sm font-black uppercase tracking-wide text-slate-900">Export Controls</div>
              <p className="mt-2 text-sm font-semibold text-slate-600">
                These sliders change the actual exported PNG, not just the UI around it.
              </p>

              <div className="mt-4 space-y-4">
                <div>
                  <div className="mb-2 flex items-center justify-between text-xs font-black uppercase text-slate-800">
                    <span>Panel Gap</span>
                    <span>{layoutControls.panelGap}px</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={48}
                    step={1}
                    value={layoutControls.panelGap}
                    onChange={(event) =>
                      setLayoutControls((current) => ({
                        ...current,
                        panelGap: Number(event.target.value)
                      }))
                    }
                    className="w-full h-4 border-2 border-black rounded-full accent-black"
                  />
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between text-xs font-black uppercase text-slate-800">
                    <span>Border Thickness</span>
                    <span>{layoutControls.borderWidth}px</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={24}
                    step={1}
                    value={layoutControls.borderWidth}
                    onChange={(event) =>
                      setLayoutControls((current) => ({
                        ...current,
                        borderWidth: Number(event.target.value)
                      }))
                    }
                    className="w-full h-4 border-2 border-black rounded-full accent-black"
                  />
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between text-xs font-black uppercase text-slate-800">
                    <span>Corner Roundness</span>
                    <span>{layoutControls.cornerRadius}px</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={60}
                    step={1}
                    value={layoutControls.cornerRadius}
                    onChange={(event) =>
                      setLayoutControls((current) => ({
                        ...current,
                        cornerRadius: Number(event.target.value)
                      }))
                    }
                    className="w-full h-4 border-2 border-black rounded-full accent-black"
                  />
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-[28px] border-4 border-black bg-white p-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Source Pair</div>
                <h2 className="mt-2 text-2xl font-black uppercase tracking-tight text-slate-900">Load Images</h2>
              </div>
              <button
                type="button"
                onClick={() => loadCurrentPuzzleIntoSlots({ announce: true })}
                disabled={!currentPuzzle}
                className="inline-flex items-center gap-2 rounded-xl border-2 border-black bg-[#DBEAFE] px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-900 hover:bg-[#BFDBFE] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ImageIcon size={14} strokeWidth={2.5} />
                Use Selected Puzzle
              </button>
            </div>

            <div className="mt-4 rounded-[24px] border-4 border-black bg-[linear-gradient(135deg,#FFF7ED_0%,#FEFCE8_100%)] p-4 text-sm font-semibold text-slate-700">
              {currentPuzzle
                ? 'Current workspace puzzle is ready to load. Replace either side after loading if you want to mix a new puzzle image or a new diff image.'
                : 'No workspace puzzle is selected right now, so start by uploading both image types below.'}
            </div>

            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              <SlotPreview
                title="Puzzle Image"
                subtitle="Main visual the audience will compare"
                slot={puzzleSlot}
                onUpload={() => puzzleInputRef.current?.click()}
                onClear={() => setPuzzleSlot(EMPTY_SLOT)}
              />
              <SlotPreview
                title="Puzzle Diff Image"
                subtitle="Answer-side image with the changes"
                slot={diffSlot}
                onUpload={() => diffInputRef.current?.click()}
                onClear={() => setDiffSlot(EMPTY_SLOT)}
              />
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
            <div className="rounded-2xl border-2 border-black bg-[#F8FAFC] px-4 py-3 text-xs font-black uppercase text-slate-700">
              {preset.label}
            </div>
          </div>

          <div className="mt-6 rounded-[24px] border-4 border-black bg-[#F8FAFC] p-4">
            <div className="rounded-[20px] border-2 border-dashed border-slate-400 bg-white p-2">
              <canvas ref={canvasRef} width={THUMBNAIL_WIDTH} height={THUMBNAIL_HEIGHT} className="block h-auto w-full bg-white" />
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border-2 border-black bg-[#FFF7ED] px-4 py-3">
              <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Style</div>
              <div className="mt-2 text-sm font-black uppercase text-slate-900">{preset.label}</div>
            </div>
            <div className="rounded-2xl border-2 border-black bg-[#F0FDF4] px-4 py-3">
              <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Border / Gap</div>
              <div className="mt-2 text-sm font-black uppercase text-slate-900">
                {layoutControls.borderWidth}px / {layoutControls.panelGap}px
              </div>
            </div>
            <div className="rounded-2xl border-2 border-black bg-[#EFF6FF] px-4 py-3">
              <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Batch Ready</div>
              <div className="mt-2 text-sm font-black uppercase text-slate-900">
                {batch.length > 1 ? `${batch.length} puzzles` : 'Single export'}
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-[24px] border-4 border-black bg-[#FFFDF5] p-5">
            <div className="text-sm font-black uppercase tracking-wide text-slate-900">Export Facts</div>
            <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">
              Export uses this exact canvas at {THUMBNAIL_WIDTH} x {THUMBNAIL_HEIGHT}. There is no extra yellow frame, shadow, or fancy page styling
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
                className="mt-4 ml-3 inline-flex items-center gap-2 rounded-xl border-2 border-black bg-[#DBEAFE] px-5 py-3 text-xs font-black uppercase tracking-wide text-slate-900 hover:bg-[#BFDBFE]"
              >
                <Download size={14} strokeWidth={2.5} />
                Download Batch PNGs
              </button>
            ) : null}
          </div>
        </section>
      </section>
    </div>
  );
}
