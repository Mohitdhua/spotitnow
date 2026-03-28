import React, { type DragEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Download, LoaderCircle, RefreshCcw, Sparkles, Trash2, Upload } from 'lucide-react';
import { notifyError, notifySuccess } from '../services/notifications';
import {
  rasterizeSvgString,
  readVectorFileAsDataUrl,
  readVectorImageDimensions,
  svgStringToBlob,
  svgStringToObjectUrl,
  traceImageToSvg,
  type VectorTraceOptions,
  type VectorTracePreset,
  type VectorTraceResult
} from '../services/vectorImageConverter';

interface VectorImageConverterModeProps {
  onBack: () => void;
}

interface SourceImageItem {
  fileName: string;
  fileSize: number;
  dataUrl: string;
  width: number;
  height: number;
}

interface VectorResultItem extends VectorTraceResult {
  signature: string;
}

type PngExportMode = 1 | 2 | 4 | '8k';

const cardClass =
  'rounded-[28px] border-4 border-black bg-white p-5 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]';

const actionButtonClass =
  'inline-flex items-center justify-center gap-2 rounded-2xl border-2 border-black px-4 py-3 text-sm font-black uppercase text-black transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500';

const presetDescriptions: Record<VectorTracePreset, string> = {
  edge_clean_preserve: 'Keeps the artwork raster-based, but cleans fuzzy antialias blur near borders by replacing only the soft transition pixels around edges.',
  exact_preserve: 'Keeps the artwork visually identical by wrapping the original image inside an SVG. Use this when you want the same look, not a traced reinterpretation.',
  cartoon_clean: 'Best for cartoon rebuilds: it flattens color regions, traces a clean fill layer, rebuilds a dedicated outline layer, then combines both into one SVG.',
  cartoon: 'Balanced for puzzle art and flat illustrations by flattening similar color regions before tracing, so edges stay cleaner and fills stay calmer.',
  poster: 'More aggressive region cleanup for flatter blocks, stronger shape simplification, and less tiny border noise.',
  logo: 'Best for icons and logos when you want crisp edges without crushing the shape quality.',
  detailed: 'Highest-fidelity preset for preserving more colors and smooth curves while still tracing cleaned color regions instead of raw edge noise.'
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

const formatFileSize = (bytes: number) => {
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

const buildExportFilename = (fileName: string, suffix: string, extension: string) => {
  const baseName = fileName.replace(/\.[^.]+$/, '');
  return `${baseName}-${suffix}.${extension}`;
};

const labelClass = 'block text-xs font-black uppercase tracking-wide text-slate-700';
const rangeClass = 'mt-2 w-full accent-black';

const getPngExportPlan = (sourceWidth: number, sourceHeight: number, mode: PngExportMode) => {
  if (mode === '8k') {
    const longEdge = Math.max(sourceWidth, sourceHeight);
    const safeScale = longEdge > 0 ? 8192 / longEdge : 1;
    return {
      scale: safeScale,
      label: '8K long edge',
      suffix: 'vectorized-8k',
      outputWidth: Math.max(1, Math.round(sourceWidth * safeScale)),
      outputHeight: Math.max(1, Math.round(sourceHeight * safeScale))
    };
  }

  return {
    scale: mode,
    label: `${mode}x scale`,
    suffix: `vectorized-${mode}x`,
    outputWidth: Math.max(1, Math.round(sourceWidth * mode)),
    outputHeight: Math.max(1, Math.round(sourceHeight * mode))
  };
};

export function VectorImageConverterMode({ onBack }: VectorImageConverterModeProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [sourceImage, setSourceImage] = useState<SourceImageItem | null>(null);
  const [preset, setPreset] = useState<VectorTracePreset>('edge_clean_preserve');
  const [numberOfColors, setNumberOfColors] = useState(96);
  const [detail, setDetail] = useState(92);
  const [smoothing, setSmoothing] = useState(1);
  const [cleanup, setCleanup] = useState(5);
  const [strokeWidth, setStrokeWidth] = useState(0.75);
  const [traceResolution, setTraceResolution] = useState(3072);
  const [pngScale, setPngScale] = useState<PngExportMode>('8k');
  const [result, setResult] = useState<VectorResultItem | null>(null);
  const [resultPreviewUrl, setResultPreviewUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState('Load a cartoon image, logo, or flat illustration to convert it into SVG.');
  const [error, setError] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);

  const options = useMemo<VectorTraceOptions>(
    () => ({
      preset,
      numberOfColors,
      detail,
      smoothing,
      cleanup,
      strokeWidth,
      traceResolution
    }),
    [cleanup, detail, numberOfColors, preset, smoothing, strokeWidth, traceResolution]
  );

  const optionSignature = useMemo(() => JSON.stringify(options), [options]);
  const isResultStale = Boolean(result && result.signature !== optionSignature);
  const usingEdgeCleanPreserve = preset === 'edge_clean_preserve';
  const usingExactPreserve = preset === 'exact_preserve';
  const smoothingLabel = preset === 'cartoon_clean' ? 'Region Softening' : 'Pretrace Blur';
  const cleanupLabel = preset === 'cartoon_clean' ? 'Island Cleanup' : 'Noise Cleanup';
  const strokeLabel = preset === 'cartoon_clean' ? 'Outline Weight' : 'Stroke Width';

  useEffect(() => {
    if (!result) {
      setResultPreviewUrl(null);
      return;
    }

    const nextUrl = svgStringToObjectUrl(result.svg);
    setResultPreviewUrl(nextUrl);
    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [result]);

  useEffect(() => {
    if (!result || result.signature === optionSignature || isProcessing) {
      return;
    }
    setStatus('Settings changed. Rebuild the SVG preview to apply the new tracing controls.');
  }, [isProcessing, optionSignature, result]);

  const handleFiles = async (files: FileList | File[] | null) => {
    const rawFiles = Array.isArray(files) ? files : files ? Array.from(files) : [];
    const imageFile = rawFiles.find((file) => file.type.startsWith('image/'));

    if (!imageFile) {
      if (rawFiles.length > 0) {
        notifyError('Please choose an image file.');
      }
      return;
    }

    setIsProcessing(true);
    setError(null);
    setStatus(`Loading ${imageFile.name}...`);

    try {
      const dataUrl = await readVectorFileAsDataUrl(imageFile);
      const dimensions = await readVectorImageDimensions(dataUrl);
      const nextSourceImage = {
        fileName: imageFile.name,
        fileSize: imageFile.size,
        dataUrl,
        width: dimensions.width,
        height: dimensions.height
      } satisfies SourceImageItem;

      setSourceImage(nextSourceImage);
      setResult(null);
      setStatus(`Loaded ${imageFile.name}. Building an SVG preview...`);
      const converted = await convertImage(nextSourceImage, options, optionSignature);
      if (converted) {
        notifySuccess(`Loaded ${imageFile.name} into the vector converter.`);
      }
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : 'Failed to load the selected image.';
      setError(message);
      setStatus(message);
      notifyError(message);
    } finally {
      setIsProcessing(false);
      setIsDragActive(false);
    }
  };

  const convertImage = async (
    targetSource = sourceImage,
    targetOptions = options,
    signature = optionSignature
  ) => {
    if (!targetSource) {
      notifyError('Load an image before tracing it.');
      return false;
    }

    setIsProcessing(true);
    setError(null);
    setStatus(
      targetOptions.preset === 'edge_clean_preserve'
        ? `Cleaning fuzzy edge pixels in ${targetSource.fileName} while preserving the artwork...`
        : targetOptions.preset === 'exact_preserve'
        ? `Wrapping ${targetSource.fileName} into an exact-preserve SVG...`
        : targetOptions.preset === 'cartoon_clean'
        ? `Flattening color regions and rebuilding clean fills + outlines for ${targetSource.fileName}...`
        : `Flattening color regions and tracing ${targetSource.fileName} into clean vector shapes...`
    );

    try {
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });

      const traced = await traceImageToSvg(targetSource.dataUrl, targetOptions);
      setResult({
        ...traced,
        signature
      });
      setStatus(
        `Vector preview ready. ${targetSource.width}x${targetSource.height} source traced through ${traced.tracedWidth}x${traced.tracedHeight}.`
      );
      return true;
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : 'Vector tracing failed.';
      setError(message);
      setStatus(message);
      notifyError(message);
      return false;
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownloadSvg = () => {
    if (!sourceImage || !result) {
      notifyError('There is no vector result to download yet.');
      return;
    }

    triggerBlobDownload(svgStringToBlob(result.svg), buildExportFilename(sourceImage.fileName, 'vectorized', 'svg'));
    notifySuccess('SVG download started.');
  };

  const handleDownloadPng = async () => {
    if (!sourceImage || !result) {
      notifyError('There is no vector result to export yet.');
      return;
    }

    const exportPlan = getPngExportPlan(result.sourceWidth, result.sourceHeight, pngScale);

    setIsProcessing(true);
    setError(null);
    setStatus(`Rendering a ${exportPlan.label} PNG export from the SVG...`);

    try {
      const blob = await rasterizeSvgString(
        result.svg,
        result.sourceWidth,
        result.sourceHeight,
        exportPlan.scale,
        'png'
      );
      triggerBlobDownload(
        blob,
        buildExportFilename(sourceImage.fileName, exportPlan.suffix, 'png')
      );
      setStatus('PNG export is ready.');
      notifySuccess('PNG export started.');
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : 'Failed to export the PNG.';
      setError(message);
      setStatus(message);
      notifyError(message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragActive(false);
    void handleFiles(event.dataTransfer.files);
  };

  const resetTool = () => {
    setSourceImage(null);
    setResult(null);
    setError(null);
    setStatus('Load a cartoon image, logo, or flat illustration to convert it into SVG.');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const pngExportPlan = sourceImage ? getPngExportPlan(sourceImage.width, sourceImage.height, pngScale) : null;

  return (
    <div className="space-y-6">
      <section className={`${cardClass} bg-[linear-gradient(135deg,#DBEAFE_0%,#FDE68A_48%,#FCE7F3_100%)]`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border-2 border-black bg-white px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-slate-700">
              <Sparkles size={12} strokeWidth={2.6} />
              Vector Converter
            </div>
            <h1 className="mt-4 text-3xl font-black uppercase tracking-tight text-slate-900 sm:text-4xl">
              Turn flat artwork into clean SVG shapes
            </h1>
            <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-slate-700 sm:text-base">
              This tool is designed for cartoons, puzzle art, icons, and logos. It can make images like your sample look
              cleaner and scale much better, while preserving far more color and curve detail than the old settings.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={onBack}
              className={`${actionButtonClass} bg-white hover:bg-slate-100`}
            >
              <ArrowLeft size={16} />
              Back
            </button>
            <button
              type="button"
              onClick={() => void convertImage()}
              disabled={!sourceImage || isProcessing}
              className={`${actionButtonClass} bg-[#FDE68A] hover:bg-[#FCD34D]`}
            >
              {isProcessing ? <LoaderCircle size={16} className="animate-spin" /> : <RefreshCcw size={16} />}
              {result ? 'Rebuild SVG' : 'Trace Image'}
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
        <div className="space-y-6">
          <section className={cardClass}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Input</p>
                <h2 className="mt-2 text-2xl font-black uppercase tracking-tight text-slate-900">Source Artwork</h2>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className={`${actionButtonClass} bg-[#DBEAFE] hover:bg-[#BFDBFE]`}
                >
                  <Upload size={16} />
                  Choose Image
                </button>
                <button
                  type="button"
                  onClick={resetTool}
                  disabled={!sourceImage && !result}
                  className={`${actionButtonClass} bg-white hover:bg-slate-100`}
                >
                  <Trash2 size={16} />
                  Clear
                </button>
              </div>
            </div>

            <label
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragActive(true);
              }}
              onDragLeave={() => setIsDragActive(false)}
              onDrop={handleDrop}
              className={`mt-5 flex min-h-[240px] cursor-pointer flex-col items-center justify-center rounded-[24px] border-4 border-dashed px-6 py-10 text-center transition ${
                isDragActive ? 'border-black bg-[#FFF7ED]' : 'border-slate-300 bg-slate-50'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => void handleFiles(event.target.files)}
              />

              {sourceImage ? (
                <div className="w-full space-y-4">
                  <div className="overflow-hidden rounded-[20px] border-4 border-black bg-white">
                    <img
                      src={sourceImage.dataUrl}
                      alt={sourceImage.fileName}
                      className="h-[240px] w-full bg-[linear-gradient(45deg,#f8fafc_25%,#e2e8f0_25%,#e2e8f0_50%,#f8fafc_50%,#f8fafc_75%,#e2e8f0_75%,#e2e8f0_100%)] object-contain"
                    />
                  </div>
                  <div className="grid gap-3 text-left sm:grid-cols-2">
                    <div className="rounded-2xl border-2 border-black bg-[#FFF7ED] p-3">
                      <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Filename</div>
                      <div className="mt-1 truncate text-sm font-black text-slate-900">{sourceImage.fileName}</div>
                    </div>
                    <div className="rounded-2xl border-2 border-black bg-[#EFF6FF] p-3">
                      <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Image Size</div>
                      <div className="mt-1 text-sm font-black text-slate-900">
                        {sourceImage.width} x {sourceImage.height}
                      </div>
                      <div className="mt-1 text-xs font-semibold text-slate-600">{formatFileSize(sourceImage.fileSize)}</div>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-black bg-white text-slate-900">
                    <Upload size={24} strokeWidth={2.8} />
                  </div>
                  <div className="mt-4 text-xl font-black uppercase tracking-tight text-slate-900">
                    Drop a cartoon image here
                  </div>
                  <p className="mt-3 max-w-md text-sm font-semibold leading-6 text-slate-600">
                    PNG, JPG, or WebP files work well. Best results come from flat illustrations, puzzle artwork, icons, and logos.
                  </p>
                </>
              )}
            </label>
          </section>

          <section className={cardClass}>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Settings</p>
            <h2 className="mt-2 text-2xl font-black uppercase tracking-tight text-slate-900">Tracing Controls</h2>
            <p className="mt-2 text-sm font-semibold text-slate-600">{presetDescriptions[preset]}</p>

            <div className="mt-5 grid gap-5">
              <div>
                <label className={labelClass}>Style Preset</label>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {(['edge_clean_preserve', 'exact_preserve', 'cartoon_clean', 'cartoon', 'poster', 'logo', 'detailed'] as VectorTracePreset[]).map((presetOption) => (
                    <button
                      key={presetOption}
                      type="button"
                      onClick={() => setPreset(presetOption)}
                      className={`rounded-2xl border-2 px-4 py-3 text-left text-sm font-black uppercase tracking-wide transition ${
                        preset === presetOption
                          ? 'border-black bg-black text-white'
                          : 'border-black bg-white text-slate-800 hover:bg-[#FFF7ED]'
                      }`}
                    >
                      {presetOption.replace('_', ' ')}
                    </button>
                  ))}
                </div>
              </div>

              {usingEdgeCleanPreserve && (
                <div className="rounded-2xl border-2 border-black bg-[#DBEAFE] p-4 text-sm font-semibold leading-6 text-slate-700">
                  Edge Clean Preserve keeps the same artwork style, but targets the fuzzy blur near black borders and shape edges.
                  It does not redraw the image into new vector shapes.
                </div>
              )}

              {usingExactPreserve && (
                <div className="rounded-2xl border-2 border-black bg-[#DCFCE7] p-4 text-sm font-semibold leading-6 text-slate-700">
                  Exact Preserve does not redraw the art.
                  It keeps the image visually identical and exports it inside an SVG wrapper, so the preview matches the source instead of a traced approximation.
                </div>
              )}

              {preset === 'cartoon_clean' && (
                <div className="rounded-2xl border-2 border-black bg-[#F8FDFF] p-4 text-sm font-semibold leading-6 text-slate-700">
                  Cartoon Clean traces two layers:
                  it rebuilds flat fill shapes first, then traces a separate outline mask above them so curves feel cleaner and borders stop breaking into speckle.
                </div>
              )}

              <div className={`grid gap-5 md:grid-cols-2 ${usingExactPreserve ? 'opacity-55' : ''}`}>
                <div>
                  <label className={labelClass}>Colors: {numberOfColors}</label>
                  <input
                    type="range"
                    min={2}
                    max={128}
                    step={1}
                    value={numberOfColors}
                    onChange={(event) => setNumberOfColors(Number(event.target.value))}
                    disabled={usingExactPreserve}
                    className={rangeClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Shape Detail: {detail}</label>
                  <input
                    type="range"
                    min={1}
                    max={100}
                    step={1}
                    value={detail}
                    onChange={(event) => setDetail(Number(event.target.value))}
                    disabled={usingExactPreserve}
                    className={rangeClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>
                    {usingEdgeCleanPreserve ? 'Edge Softness Cleanup' : smoothingLabel}: {smoothing}
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={4}
                    step={1}
                    value={smoothing}
                    onChange={(event) => setSmoothing(Number(event.target.value))}
                    disabled={usingExactPreserve}
                    className={rangeClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>
                    {usingEdgeCleanPreserve ? 'Edge Cleanup Strength' : cleanupLabel}: {cleanup}
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={12}
                    step={1}
                    value={cleanup}
                    onChange={(event) => setCleanup(Number(event.target.value))}
                    disabled={usingExactPreserve}
                    className={rangeClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>
                    {usingEdgeCleanPreserve ? 'Border Reach' : strokeLabel}: {strokeWidth.toFixed(1)}
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.25}
                    value={strokeWidth}
                    onChange={(event) => setStrokeWidth(Number(event.target.value))}
                    disabled={usingExactPreserve || usingEdgeCleanPreserve}
                    className={rangeClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Trace Resolution: {traceResolution}px</label>
                  <input
                    type="range"
                    min={1024}
                    max={4096}
                    step={256}
                    value={traceResolution}
                    onChange={(event) => setTraceResolution(Number(event.target.value))}
                    disabled={usingExactPreserve || usingEdgeCleanPreserve}
                    className={rangeClass}
                  />
                </div>
              </div>
            </div>
          </section>
        </div>

        <div className="space-y-6">
          <section className={cardClass}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Preview</p>
                <h2 className="mt-2 text-2xl font-black uppercase tracking-tight text-slate-900">Original vs Vector</h2>
              </div>
              {isResultStale ? (
                <div className="rounded-full border-2 border-black bg-[#FDE68A] px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-slate-900">
                  Preview needs rebuild
                </div>
              ) : null}
            </div>

            <div className="mt-5 grid gap-4 xl:grid-cols-2">
              <div className="overflow-hidden rounded-[24px] border-4 border-black bg-white">
                <div className="border-b-4 border-black bg-[#FFF7ED] px-4 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-slate-600">
                  Original
                </div>
                <div className="flex h-[340px] items-center justify-center bg-[linear-gradient(45deg,#f8fafc_25%,#e2e8f0_25%,#e2e8f0_50%,#f8fafc_50%,#f8fafc_75%,#e2e8f0_75%,#e2e8f0_100%)] p-4">
                  {sourceImage ? (
                    <img src={sourceImage.dataUrl} alt="Original upload" className="h-full w-full object-contain" />
                  ) : (
                    <div className="max-w-xs text-center text-sm font-semibold text-slate-500">
                      Load an image to see the before and after preview.
                    </div>
                  )}
                </div>
              </div>

              <div className="overflow-hidden rounded-[24px] border-4 border-black bg-white">
                <div className="border-b-4 border-black bg-[#EFF6FF] px-4 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-slate-600">
                  Vector Preview
                </div>
                <div className="flex h-[340px] items-center justify-center bg-[linear-gradient(45deg,#f8fafc_25%,#e2e8f0_25%,#e2e8f0_50%,#f8fafc_50%,#f8fafc_75%,#e2e8f0_75%,#e2e8f0_100%)] p-4">
                  {isProcessing ? (
                    <div className="flex flex-col items-center gap-3 text-center text-sm font-semibold text-slate-600">
                      <LoaderCircle size={28} className="animate-spin" />
                      Building the SVG preview...
                    </div>
                  ) : resultPreviewUrl ? (
                    <img src={resultPreviewUrl} alt="Vector preview" className="h-full w-full object-contain" />
                  ) : (
                    <div className="max-w-xs text-center text-sm font-semibold text-slate-500">
                      The traced SVG preview will appear here after conversion.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border-2 border-black bg-[#FFF7ED] p-4">
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Source</div>
                <div className="mt-2 text-sm font-black text-slate-900">
                  {sourceImage ? `${sourceImage.width} x ${sourceImage.height}` : 'No image'}
                </div>
              </div>
              <div className="rounded-2xl border-2 border-black bg-[#F0FDF4] p-4">
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Trace Canvas</div>
                <div className="mt-2 text-sm font-black text-slate-900">
                  {result ? `${result.tracedWidth} x ${result.tracedHeight}` : 'Not traced'}
                </div>
              </div>
              <div className="rounded-2xl border-2 border-black bg-[#EFF6FF] p-4">
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">SVG Size</div>
                <div className="mt-2 text-sm font-black text-slate-900">
                  {result ? formatFileSize(result.svgSizeBytes) : 'No SVG yet'}
                </div>
              </div>
              <div className="rounded-2xl border-2 border-black bg-[#FCE7F3] p-4">
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">PNG Export</div>
                <div className="mt-2 text-sm font-black text-slate-900">
                  {pngExportPlan ? `${pngExportPlan.outputWidth} x ${pngExportPlan.outputHeight}` : 'No export set'}
                </div>
                <div className="mt-1 text-xs font-semibold text-slate-600">
                  {pngExportPlan ? pngExportPlan.label : 'Choose a PNG export size'}
                </div>
              </div>
            </div>
          </section>

          <section className={cardClass}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Export</p>
                <h2 className="mt-2 text-2xl font-black uppercase tracking-tight text-slate-900">Download Results</h2>
              </div>

              <div className="flex items-center gap-3">
                <label className={labelClass}>PNG Scale</label>
                <select
                  value={pngScale}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setPngScale(nextValue === '8k' ? '8k' : (Number(nextValue) as 1 | 2 | 4));
                  }}
                  className="rounded-xl border-2 border-black bg-white px-3 py-2 text-sm font-black uppercase text-slate-900"
                >
                  <option value={1}>1x</option>
                  <option value={2}>2x</option>
                  <option value={4}>4x</option>
                  <option value="8k">8K Long Edge</option>
                </select>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleDownloadSvg}
                disabled={!result || isResultStale || isProcessing}
                className={`${actionButtonClass} bg-[#FDE68A] hover:bg-[#FCD34D]`}
              >
                <Download size={16} />
                Download SVG
              </button>
              <button
                type="button"
                onClick={() => void handleDownloadPng()}
                disabled={!result || isResultStale || isProcessing}
                className={`${actionButtonClass} bg-[#DBEAFE] hover:bg-[#BFDBFE]`}
              >
                <Download size={16} />
                Download PNG
              </button>
              <button
                type="button"
                onClick={() => void convertImage()}
                disabled={!sourceImage || isProcessing}
                className={`${actionButtonClass} bg-white hover:bg-slate-100`}
              >
                {isProcessing ? <LoaderCircle size={16} className="animate-spin" /> : <RefreshCcw size={16} />}
                Rebuild
              </button>
            </div>

            <div className="mt-5 rounded-[24px] border-2 border-black bg-[#F8FAFC] p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Status</div>
              <div className="mt-2 text-sm font-semibold leading-6 text-slate-700">{status}</div>
              {error ? <div className="mt-3 text-sm font-black text-red-600">{error}</div> : null}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
