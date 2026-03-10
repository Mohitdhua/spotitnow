import React, { DragEvent, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Download, LoaderCircle, RefreshCcw, Sparkles, Trash2, Upload } from 'lucide-react';
import {
  exportUpscaledImage,
  readFileAsDataUrl,
  readImageDimensions,
  upscaleImageDataUrl,
  type ImageUpscaleAiModel,
  type ImageUpscaleEngine,
  type ImageUpscaleOptions
} from '../services/imageUpscaler';

interface ImageUpscalerModeProps {
  onBack: () => void;
}

interface UpscaleItem {
  id: string;
  fileName: string;
  fileSize: number;
  originalDataUrl: string;
  width: number;
  height: number;
  resultDataUrl: string | null;
  resultWidth: number | null;
  resultHeight: number | null;
  resultScaleFactor: 2 | 4 | null;
  resultAiModel: ImageUpscaleAiModel | null;
  resultUsedAiDeblur: boolean | null;
  resultSignature: string | null;
}

type UpscalePreset = 'balanced' | 'crisp' | 'soft';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const cardClass =
  'rounded-[28px] border-4 border-black bg-white p-5 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]';

const actionButtonClass =
  'inline-flex items-center justify-center gap-2 rounded-2xl border-2 border-black px-4 py-3 text-sm font-black uppercase text-black transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500';

const formatFileSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
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

const loadImageCanvas = (src: string): Promise<HTMLCanvasElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth || image.width;
      canvas.height = image.naturalHeight || image.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to create export canvas.'));
        return;
      }
      ctx.drawImage(image, 0, 0);
      resolve(canvas);
    };
    image.onerror = () => reject(new Error('Failed to load processed preview.'));
    image.src = src;
  });

const buildExportFilename = (
  fileName: string,
  scaleFactor: 2 | 4,
  format: 'png' | 'jpeg' | 'webp',
  model?: ImageUpscaleAiModel | null,
  useAiDeblur?: boolean | null
) => {
  const baseName = fileName.replace(/\.[^.]+$/, '');
  const extension = format === 'jpeg' ? 'jpg' : format;
  const modelSuffix = model ? `-${model}` : '';
  const deblurSuffix = useAiDeblur ? '-maxim-deblur' : '';
  return `${baseName}-upscaled${modelSuffix}${deblurSuffix}-x${scaleFactor}.${extension}`;
};

const PRESET_VALUES: Record<UpscalePreset, Pick<ImageUpscaleOptions, 'detailBoost' | 'localContrast' | 'edgeThreshold'>> = {
  balanced: {
    detailBoost: 46,
    localContrast: 28,
    edgeThreshold: 9
  },
  crisp: {
    detailBoost: 64,
    localContrast: 42,
    edgeThreshold: 7
  },
  soft: {
    detailBoost: 28,
    localContrast: 16,
    edgeThreshold: 13
  }
};

export function ImageUpscalerMode({ onBack }: ImageUpscalerModeProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const progressSnapshotRef = useRef({
    progress: -1,
    label: '',
    timestamp: 0
  });
  const [items, setItems] = useState<UpscaleItem[]>([]);
  const [engine, setEngine] = useState<ImageUpscaleEngine>('fast_enhance');
  const [aiModel, setAiModel] = useState<ImageUpscaleAiModel>('medium');
  const [useAiDeblur, setUseAiDeblur] = useState(false);
  const [scaleFactor, setScaleFactor] = useState<2 | 4>(2);
  const [detailBoost, setDetailBoost] = useState(PRESET_VALUES.balanced.detailBoost);
  const [localContrast, setLocalContrast] = useState(PRESET_VALUES.balanced.localContrast);
  const [edgeThreshold, setEdgeThreshold] = useState(PRESET_VALUES.balanced.edgeThreshold);
  const [exportFormat, setExportFormat] = useState<'png' | 'jpeg' | 'webp'>('png');
  const [exportQuality, setExportQuality] = useState(92);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [processingLabel, setProcessingLabel] = useState('');
  const [status, setStatus] = useState('Load one or more images to upscale in this standalone mode.');
  const [error, setError] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);

  const options = useMemo<ImageUpscaleOptions>(
    () => ({
      engine,
      scaleFactor,
      aiModel,
      useAiDeblur,
      detailBoost,
      localContrast,
      edgeThreshold
    }),
    [engine, scaleFactor, aiModel, useAiDeblur, detailBoost, localContrast, edgeThreshold]
  );
  const optionSignature = useMemo(() => JSON.stringify(options), [options]);
  const readyCount = items.filter((item) => item.resultDataUrl).length;
  const staleCount = items.filter((item) => item.resultDataUrl && item.resultSignature !== optionSignature).length;
  const progressPercent = Math.round(processingProgress * 100);

  const applyPreset = (preset: UpscalePreset) => {
    const values = PRESET_VALUES[preset];
    setDetailBoost(values.detailBoost);
    setLocalContrast(values.localContrast);
    setEdgeThreshold(values.edgeThreshold);
  };

  const resetProcessingFeedback = (label = '') => {
    progressSnapshotRef.current = {
      progress: -1,
      label: '',
      timestamp: 0
    };
    setProcessingProgress(0);
    setProcessingLabel(label);
  };

  const updateProcessingFeedback = (progress: number, label: string, statusMessage?: string) => {
    const normalizedProgress = clamp(progress, 0, 1);
    const nextLabel = label.trim();
    const timestamp =
      typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
    const last = progressSnapshotRef.current;

    if (
      normalizedProgress < 1 &&
      nextLabel === last.label &&
      Math.abs(normalizedProgress - last.progress) < 0.005 &&
      timestamp - last.timestamp < 50
    ) {
      return;
    }

    progressSnapshotRef.current = {
      progress: normalizedProgress,
      label: nextLabel,
      timestamp
    };
    setProcessingProgress(normalizedProgress);
    setProcessingLabel(nextLabel);
    if (statusMessage) {
      setStatus(statusMessage);
    }
  };

  const resetOutputs = () => {
    setItems((current) =>
      current.map((item) => ({
        ...item,
          resultDataUrl: null,
          resultWidth: null,
          resultHeight: null,
          resultScaleFactor: null,
          resultAiModel: null,
          resultUsedAiDeblur: null,
          resultSignature: null
        }))
    );
  };

  const handleFiles = async (files: FileList | File[] | null) => {
    if (isProcessing) return;

    const raw = Array.isArray(files) ? files : files ? Array.from(files) : [];
    const imageFiles = raw.filter((file) => file.type.startsWith('image/'));
    if (!imageFiles.length) {
      if (raw.length) {
        alert('Select image files only.');
      }
      return;
    }

    setIsProcessing(true);
    setError(null);
    resetProcessingFeedback('Preparing image load');
    setStatus(`Loading ${imageFiles.length} image${imageFiles.length === 1 ? '' : 's'}...`);

    try {
      const loaded: UpscaleItem[] = [];
      for (let index = 0; index < imageFiles.length; index += 1) {
        const file = imageFiles[index];
        updateProcessingFeedback(
          index / imageFiles.length,
          `Loading ${file.name}`,
          `Loading ${index + 1} of ${imageFiles.length}: ${file.name}`
        );
        const dataUrl = await readFileAsDataUrl(file);
        const dimensions = await readImageDimensions(dataUrl);
        loaded.push({
          id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`,
          fileName: file.name,
          fileSize: file.size,
          originalDataUrl: dataUrl,
          width: dimensions.width,
          height: dimensions.height,
          resultDataUrl: null,
          resultWidth: null,
          resultHeight: null,
          resultScaleFactor: null,
          resultAiModel: null,
          resultUsedAiDeblur: null,
          resultSignature: null
        });
        updateProcessingFeedback(
          (index + 1) / imageFiles.length,
          `Loaded ${file.name}`,
          `Loading ${index + 1} of ${imageFiles.length}: ${file.name}`
        );
      }

      setItems((current) => [...current, ...loaded]);
      updateProcessingFeedback(1, 'Image load complete');
      setStatus(
        `Loaded ${loaded.length} image${loaded.length === 1 ? '' : 's'}. Adjust settings, then run upscale.`
      );
    } catch (loadError) {
      console.error('Failed to load images for upscaling', loadError);
      setError('One or more images could not be loaded.');
      setStatus('Load failed. Try another image.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUpscaleAll = async () => {
    if (!items.length || isProcessing) return;

    setIsProcessing(true);
    setError(null);
    resetProcessingFeedback('Preparing upscale');
    setStatus(`Upscaling ${items.length} image${items.length === 1 ? '' : 's'}...`);

    try {
      const nextItems = [...items];
      for (let index = 0; index < nextItems.length; index += 1) {
        const item = nextItems[index];
        const itemBaseProgress = index / nextItems.length;
        const itemWeight = 1 / nextItems.length;
        updateProcessingFeedback(
          itemBaseProgress,
          `Preparing ${item.fileName}`,
          `Upscaling ${index + 1} of ${nextItems.length}: ${item.fileName}`
        );
        const result = await upscaleImageDataUrl(item.originalDataUrl, options, (itemProgress, label) => {
          const overallProgress = itemBaseProgress + itemProgress * itemWeight;
          updateProcessingFeedback(
            overallProgress,
            `${item.fileName}: ${label}`,
            `Upscaling ${index + 1} of ${nextItems.length}: ${item.fileName}`
          );
        });
        nextItems[index] = {
          ...item,
          resultDataUrl: result.canvas.toDataURL('image/png'),
          resultWidth: result.width,
          resultHeight: result.height,
          resultScaleFactor: options.scaleFactor,
          resultAiModel: options.engine === 'ai_super_resolution' ? options.aiModel : null,
          resultUsedAiDeblur: options.engine === 'ai_super_resolution' ? options.useAiDeblur : null,
          resultSignature: optionSignature
        };
        setItems([...nextItems]);
        updateProcessingFeedback(
          (index + 1) / nextItems.length,
          `${item.fileName}: complete`,
          `Upscaling ${index + 1} of ${nextItems.length}: ${item.fileName}`
        );
      }

      updateProcessingFeedback(1, 'Upscale complete');
      setStatus(
        `Upscale complete for ${nextItems.length} image${nextItems.length === 1 ? '' : 's'}.`
      );
    } catch (processError) {
      console.error('Failed to upscale images', processError);
      setError('Upscaling failed on one or more images.');
      setStatus('Upscale failed. Reduce settings or try a smaller image.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownloadItem = async (item: UpscaleItem) => {
    if (!item.resultDataUrl || isProcessing) return;

    try {
      const canvas = await loadImageCanvas(item.resultDataUrl);
      const blob = await exportUpscaledImage(
        canvas,
        exportFormat,
        exportQuality / 100
      );
      triggerBlobDownload(
        blob,
        buildExportFilename(
          item.fileName,
          item.resultScaleFactor ?? scaleFactor,
          exportFormat,
          item.resultAiModel,
          item.resultUsedAiDeblur
        )
      );
    } catch (downloadError) {
      console.error(`Failed to export upscaled image "${item.fileName}"`, downloadError);
      alert(`Could not export ${item.fileName}.`);
    }
  };

  const handleDownloadAll = async () => {
    if (isProcessing) return;
    const readyItems = items.filter((item) => item.resultDataUrl);
    if (!readyItems.length) return;

    setIsProcessing(true);
    resetProcessingFeedback('Preparing downloads');
    setStatus(`Preparing ${readyItems.length} download${readyItems.length === 1 ? '' : 's'}...`);
    try {
      for (let index = 0; index < readyItems.length; index += 1) {
        const item = readyItems[index];
        updateProcessingFeedback(
          index / readyItems.length,
          `Preparing ${item.fileName}`,
          `Downloading ${index + 1} of ${readyItems.length}: ${item.fileName}`
        );
        const canvas = await loadImageCanvas(item.resultDataUrl as string);
        const blob = await exportUpscaledImage(canvas, exportFormat, exportQuality / 100);
        triggerBlobDownload(
          blob,
          buildExportFilename(
            item.fileName,
            item.resultScaleFactor ?? scaleFactor,
            exportFormat,
            item.resultAiModel,
            item.resultUsedAiDeblur
          )
        );
        updateProcessingFeedback(
          (index + 1) / readyItems.length,
          `Downloaded ${item.fileName}`,
          `Downloading ${index + 1} of ${readyItems.length}: ${item.fileName}`
        );
      }
      updateProcessingFeedback(1, 'Downloads complete');
      setStatus(`Downloaded ${readyItems.length} upscaled image${readyItems.length === 1 ? '' : 's'}.`);
    } catch (downloadError) {
      console.error('Failed to download upscaled images', downloadError);
      setError('One or more images could not be exported.');
      setStatus('Download failed.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRemoveItem = (id: string) => {
    if (isProcessing) return;
    setItems((current) => current.filter((item) => item.id !== id));
  };

  const handleClearAll = () => {
    if (isProcessing) return;
    setItems([]);
    setError(null);
    setStatus('Load one or more images to upscale in this standalone mode.');
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(false);
    handleFiles(Array.from(event.dataTransfer.files));
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    if (!isProcessing) {
      setIsDragActive(true);
    }
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const nextTarget = event.relatedTarget;
    if (!nextTarget || !event.currentTarget.contains(nextTarget as Node)) {
      setIsDragActive(false);
    }
  };

  return (
    <div className="w-full max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="bg-white border-4 border-black rounded-2xl shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
        <div className="bg-[#D9F99D] p-4 sm:p-6 border-b-4 border-black flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <button
              onClick={onBack}
              className="p-2 bg-white border-2 border-black rounded-lg hover:bg-black hover:text-white transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
            >
              <ArrowLeft size={22} strokeWidth={3} />
            </button>
            <div>
              <h2 className="text-2xl sm:text-3xl font-black font-display uppercase tracking-tight text-black">
                Image Upscaler
              </h2>
              <p className="text-sm font-bold text-slate-700">
                Standalone browser-side upscale mode. Upload images here, process them here, export them here.
              </p>
            </div>
          </div>
          <div className="self-start rounded-xl border-2 border-black bg-white px-3 py-2 text-xs font-black uppercase text-slate-700 lg:self-auto">
            {items.length} image{items.length === 1 ? '' : 's'} loaded
          </div>
        </div>

        <div className="p-4 sm:p-6 md:p-8 space-y-6">
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.2fr)_360px] gap-6">
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={`rounded-[28px] border-4 border-dashed border-black p-6 text-center transition-colors ${
                isDragActive ? 'bg-[#FEF3C7]' : 'bg-[#FFFDF5]'
              }`}
            >
              <div className="flex flex-col items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-black bg-[#FDE68A] shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                  <Sparkles size={30} strokeWidth={2.6} />
                </div>
                <div className="space-y-1">
                  <p className="text-lg font-black uppercase text-slate-900">Separate Upscale Workspace</p>
                  <p className="text-sm font-bold text-slate-600">
                    This mode is isolated from splitter, watermark, and upload. Drop images here or choose files.
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2 text-[11px] font-black uppercase text-slate-700">
                  <span className="rounded-full border-2 border-black bg-white px-2 py-1">PNG</span>
                  <span className="rounded-full border-2 border-black bg-white px-2 py-1">JPG</span>
                  <span className="rounded-full border-2 border-black bg-white px-2 py-1">WEBP</span>
                  <span className="rounded-full border-2 border-black bg-white px-2 py-1">x2 / x4</span>
                </div>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isProcessing}
                  className={`${actionButtonClass} bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:bg-slate-50`}
                >
                  <Upload size={18} strokeWidth={2.8} />
                  <span>Select Images</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    handleFiles(event.target.files);
                    event.target.value = '';
                  }}
                />
              </div>
            </div>

            <div className="space-y-4">
              <div className={cardClass}>
                <div className="mb-4 border-b-2 border-black pb-3">
                  <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">Upscale Engine</div>
                  <h3 className="mt-1 text-lg font-black uppercase text-slate-900">Standalone Settings</h3>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setEngine('fast_enhance')}
                    disabled={isProcessing}
                    className={`rounded-2xl border-2 border-black px-3 py-3 text-[11px] font-black uppercase ${
                      engine === 'fast_enhance' ? 'bg-[#FDE68A]' : 'bg-white hover:bg-slate-100'
                    }`}
                  >
                    Fast Enhance
                  </button>
                  <button
                    onClick={() => setEngine('ai_super_resolution')}
                    disabled={isProcessing}
                    className={`rounded-2xl border-2 border-black px-3 py-3 text-[11px] font-black uppercase ${
                      engine === 'ai_super_resolution' ? 'bg-[#4ECDC4]' : 'bg-white hover:bg-slate-100'
                    }`}
                  >
                    AI Super-Resolution
                  </button>
                </div>

                <div className="mt-4 space-y-4">
                  <label className="block">
                    <div className="mb-2 flex items-center justify-between text-[11px] font-black uppercase text-slate-600">
                      <span>Scale</span>
                      <span>x{scaleFactor}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {[2, 4].map((factor) => (
                        <button
                          key={factor}
                          onClick={() => setScaleFactor(factor as 2 | 4)}
                          disabled={isProcessing}
                          className={`rounded-2xl border-2 border-black px-3 py-3 text-sm font-black uppercase ${
                            scaleFactor === factor ? 'bg-[#4ECDC4]' : 'bg-white'
                          }`}
                        >
                          x{factor}
                        </button>
                      ))}
                    </div>
                  </label>

                  {engine === 'fast_enhance' ? (
                    <>
                      <div className="grid grid-cols-3 gap-2">
                        {(['balanced', 'crisp', 'soft'] as UpscalePreset[]).map((preset) => (
                          <button
                            key={preset}
                            onClick={() => applyPreset(preset)}
                            disabled={isProcessing}
                            className={`rounded-2xl border-2 border-black px-3 py-2 text-[11px] font-black uppercase ${
                              preset === 'balanced'
                                ? 'bg-[#FDE68A]'
                                : preset === 'crisp'
                                  ? 'bg-[#BFDBFE]'
                                  : 'bg-[#E2E8F0]'
                            }`}
                          >
                            {preset}
                          </button>
                        ))}
                      </div>

                      <label className="block">
                        <div className="mb-2 flex items-center justify-between text-[11px] font-black uppercase text-slate-600">
                          <span>Detail Boost</span>
                          <span>{detailBoost}</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={detailBoost}
                          onChange={(event) => setDetailBoost(Number(event.target.value))}
                          disabled={isProcessing}
                          className="w-full"
                        />
                      </label>

                      <label className="block">
                        <div className="mb-2 flex items-center justify-between text-[11px] font-black uppercase text-slate-600">
                          <span>Local Contrast</span>
                          <span>{localContrast}</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={localContrast}
                          onChange={(event) => setLocalContrast(Number(event.target.value))}
                          disabled={isProcessing}
                          className="w-full"
                        />
                      </label>

                      <label className="block">
                        <div className="mb-2 flex items-center justify-between text-[11px] font-black uppercase text-slate-600">
                          <span>Edge Threshold</span>
                          <span>{edgeThreshold}</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={32}
                          step={1}
                          value={edgeThreshold}
                          onChange={(event) => setEdgeThreshold(Number(event.target.value))}
                          disabled={isProcessing}
                          className="w-full"
                        />
                      </label>
                    </>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        {(
                          [
                            { value: 'slim', label: 'Slim', tone: 'bg-[#E2E8F0]' },
                            { value: 'medium', label: 'Medium', tone: 'bg-[#BFDBFE]' },
                            { value: 'thick', label: 'Thick', tone: 'bg-[#C4B5FD]' }
                          ] satisfies Array<{ value: ImageUpscaleAiModel; label: string; tone: string }>
                        ).map((model) => (
                          <button
                            key={model.value}
                            onClick={() => setAiModel(model.value)}
                            disabled={isProcessing}
                            className={`rounded-2xl border-2 border-black px-3 py-3 text-[11px] font-black uppercase ${
                              aiModel === model.value ? model.tone : 'bg-white hover:bg-slate-100'
                            }`}
                          >
                            {model.label}
                          </button>
                        ))}
                      </div>

                      <button
                        onClick={() => setUseAiDeblur((current) => !current)}
                        disabled={isProcessing}
                        className={`w-full rounded-2xl border-2 border-black px-4 py-3 text-left text-[11px] font-black uppercase ${
                          useAiDeblur ? 'bg-[#A7F3D0]' : 'bg-white hover:bg-slate-100'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span>MAXIM Deblur</span>
                          <span>{useAiDeblur ? 'On' : 'Off'}</span>
                        </div>
                      </button>

                      <div className="rounded-2xl border-2 border-black bg-[#EEF9FF] px-4 py-4 text-xs font-bold text-slate-700">
                        {aiModel === 'slim' && (
                          <span>Slim is the fastest AI model and the lightest browser option.</span>
                        )}
                        {aiModel === 'medium' && (
                          <span>Medium is the balanced AI model and is the best default quality/speed tradeoff.</span>
                        )}
                        {aiModel === 'thick' && (
                          <span>Thick pushes stronger edge reconstruction, but it is much slower and heavier.</span>
                        )}
                        {useAiDeblur && (
                          <span className="block mt-2">MAXIM Deblur will run first to clean blur before the selected ESRGAN model upscales the image.</span>
                        )}
                        {!useAiDeblur && (
                          <span className="block mt-2">Turn on MAXIM Deblur if the source looks soft when zoomed or the linework is smeared before upscaling.</span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className={cardClass}>
                <div className="mb-4 border-b-2 border-black pb-3">
                  <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">Export</div>
                  <h3 className="mt-1 text-lg font-black uppercase text-slate-900">Output Format</h3>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {(['png', 'jpeg', 'webp'] as const).map((format) => (
                    <button
                      key={format}
                      onClick={() => setExportFormat(format)}
                      disabled={isProcessing}
                      className={`rounded-2xl border-2 border-black px-3 py-2 text-[11px] font-black uppercase ${
                        exportFormat === format ? 'bg-[#FDE68A]' : 'bg-white'
                      }`}
                    >
                      {format}
                    </button>
                  ))}
                </div>

                {exportFormat !== 'png' && (
                  <label className="mt-4 block">
                    <div className="mb-2 flex items-center justify-between text-[11px] font-black uppercase text-slate-600">
                      <span>Quality</span>
                      <span>{exportQuality}%</span>
                    </div>
                    <input
                      type="range"
                      min={50}
                      max={100}
                      step={1}
                      value={exportQuality}
                      onChange={(event) => setExportQuality(clamp(Number(event.target.value), 50, 100))}
                      disabled={isProcessing}
                      className="w-full"
                    />
                  </label>
                )}

                <div className="mt-4 grid gap-2">
                  <button
                    onClick={handleUpscaleAll}
                    disabled={isProcessing || items.length === 0}
                    className={`${actionButtonClass} bg-[#4ECDC4]`}
                  >
                    {isProcessing ? <LoaderCircle size={18} className="animate-spin" /> : <Sparkles size={18} />}
                    <span>{engine === 'ai_super_resolution' ? 'Run AI Upscale' : 'Run Upscale'}</span>
                  </button>
                  <button
                    onClick={handleDownloadAll}
                    disabled={isProcessing || readyCount === 0}
                    className={`${actionButtonClass} bg-[#FDE68A]`}
                  >
                    <Download size={18} />
                    <span>Download All</span>
                  </button>
                  <button
                    onClick={resetOutputs}
                    disabled={isProcessing || readyCount === 0}
                    className={`${actionButtonClass} bg-white`}
                  >
                    <RefreshCcw size={18} />
                    <span>Clear Results</span>
                  </button>
                  <button
                    onClick={handleClearAll}
                    disabled={isProcessing || items.length === 0}
                    className={`${actionButtonClass} bg-[#FCA5A5]`}
                  >
                    <Trash2 size={18} />
                    <span>Clear Images</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border-2 border-black bg-[#FFF7ED] px-4 py-3 text-sm font-bold text-slate-700">
            {status}
            {readyCount > 0 ? ` Ready: ${readyCount}.` : ''}
            {staleCount > 0 ? ` ${staleCount} result${staleCount === 1 ? ' is' : 's are'} stale after setting changes.` : ''}
          </div>

          {isProcessing && (
            <div className="rounded-2xl border-2 border-black bg-white px-4 py-4">
              <div className="flex items-center justify-between gap-3 text-[11px] font-black uppercase text-slate-700">
                <span className="min-w-0 truncate">{processingLabel || status}</span>
                <span>{progressPercent}%</span>
              </div>
              <div className="mt-3 h-5 overflow-hidden rounded-full border-2 border-black bg-[#E2E8F0]">
                <div
                  className="h-full bg-[repeating-linear-gradient(90deg,#4ECDC4_0_14px,#14B8A6_14px_28px)] transition-[width] duration-150"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-2xl border-2 border-black bg-[#FEE2E2] px-4 py-3 text-sm font-bold text-slate-700">
              {error}
            </div>
          )}

          {items.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {items.map((item) => {
                const isReady = Boolean(item.resultDataUrl);
                const isStale = isReady && item.resultSignature !== optionSignature;
                return (
                  <div key={item.id} className={cardClass}>
                    <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b-2 border-black pb-3">
                      <div className="min-w-0">
                        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">Image</div>
                        <h3 className="mt-1 truncate text-lg font-black text-slate-900">{item.fileName}</h3>
                        <div className="mt-1 text-xs font-bold text-slate-600">
                          {item.width}x{item.height} | {formatFileSize(item.fileSize)}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {isReady && (
                          <span className={`rounded-full border-2 border-black px-2 py-1 text-[10px] font-black uppercase ${isStale ? 'bg-[#FDE68A]' : 'bg-[#DCFCE7]'}`}>
                            {isStale ? 'Needs Refresh' : 'Ready'}
                          </span>
                        )}
                        <button
                          onClick={() => handleDownloadItem(item)}
                          disabled={!isReady || isProcessing}
                          className={`${actionButtonClass} bg-[#FDE68A] px-3 py-2 text-xs`}
                        >
                          <Download size={14} />
                          <span>Download</span>
                        </button>
                        <button
                          onClick={() => handleRemoveItem(item.id)}
                          disabled={isProcessing}
                          className={`${actionButtonClass} bg-white px-3 py-2 text-xs`}
                        >
                          <Trash2 size={14} />
                          <span>Remove</span>
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                      <div className="space-y-2">
                        <div className="text-[11px] font-black uppercase text-slate-600">Original</div>
                        <div className="overflow-hidden rounded-2xl border-2 border-black bg-[#F8FAFC]">
                          <img src={item.originalDataUrl} alt={item.fileName} className="h-64 w-full object-contain" />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[11px] font-black uppercase text-slate-600">Upscaled</div>
                          {item.resultWidth && item.resultHeight && (
                            <div className="text-[11px] font-black uppercase text-slate-500">
                              {item.resultWidth}x{item.resultHeight}
                            </div>
                          )}
                        </div>
                        <div className="flex h-64 items-center justify-center overflow-hidden rounded-2xl border-2 border-black bg-[#F8FAFC]">
                          {item.resultDataUrl ? (
                            <img src={item.resultDataUrl} alt={`${item.fileName} upscaled`} className="h-full w-full object-contain" />
                          ) : (
                            <div className="px-4 text-center text-[11px] font-black uppercase text-slate-500">
                              Run upscale to generate the standalone output.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-[28px] border-4 border-dashed border-black bg-[#FFFDF5] px-6 py-10 text-center">
              <div className="text-lg font-black uppercase text-slate-900">No Images Loaded</div>
              <p className="mt-2 text-sm font-bold text-slate-600">
                Start here if you want upscale to live as a separate tool. Nothing from other modes is reused.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
