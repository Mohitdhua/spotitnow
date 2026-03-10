/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Download, ImagePlus, LoaderCircle, Save, Trash2 } from 'lucide-react';
import { WatermarkRegionEditor } from './WatermarkRegionEditor';
import {
  createWatermarkSelectionPreset,
  exportProcessedImage,
  removeWatermarkWithRegions,
  scaleWatermarkRegions,
  type WatermarkRegion,
  type WatermarkSelectionPreset
} from '../services/watermarkRemoval';
import {
  deleteWatermarkPreset as deleteStoredWatermarkPreset,
  loadWatermarkPresets,
  saveWatermarkPreset
} from '../services/watermarkPresets';

interface WatermarkRemovalModeProps {
  onBack: () => void;
}

interface ImageSlot {
  dataUrl: string;
  fileName: string;
  fileSize: number;
}

interface ImageDimensions {
  width: number;
  height: number;
}

type RegionField = 'x' | 'y' | 'width' | 'height';

const DIFF_NAME_PATTERN = /(diff|difference|spot[-_\s]?diff|modified|changed)/i;
const PUZZLE_IMAGE_LABEL = 'Puzzle Image (A)';
const DIFF_IMAGE_LABEL = 'Diff Image (B)';
const cardClass =
  'rounded-[28px] border-4 border-black bg-white p-5 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]';
const tealButtonClass =
  'inline-flex items-center justify-center gap-2 rounded-2xl border-2 border-black bg-[#4ECDC4] px-4 py-3 text-sm font-black uppercase text-black transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500';
const pinkButtonClass =
  'inline-flex items-center justify-center gap-2 rounded-2xl border-2 border-black bg-[#FFB6C1] px-4 py-3 text-sm font-black uppercase text-black transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500';
const yellowButtonClass =
  'inline-flex items-center justify-center gap-2 rounded-2xl border-2 border-black bg-[#FDE68A] px-4 py-3 text-sm font-black uppercase text-black transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500';
const dangerButtonClass =
  'inline-flex items-center justify-center gap-2 rounded-2xl border-2 border-black bg-[#FCA5A5] px-4 py-3 text-sm font-black uppercase text-black transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500';

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const formatFileSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[index]}`;
};

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve((event.target?.result as string) ?? '');
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });

const readImageDimensions = (imageUrl: string): Promise<ImageDimensions> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error('Failed to read image dimensions.'));
    image.src = imageUrl;
  });

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

const sortPuzzlePairFiles = (files: File[]): File[] => {
  if (files.length !== 2) return files;
  const [first, second] = files;
  const firstLooksLikeDiff = DIFF_NAME_PATTERN.test(first.name);
  const secondLooksLikeDiff = DIFF_NAME_PATTERN.test(second.name);
  if (firstLooksLikeDiff === secondLooksLikeDiff) return files;
  return firstLooksLikeDiff ? [second, first] : [first, second];
};

const getExportFilename = (fileName: string, format: 'png' | 'jpeg' | 'webp'): string => {
  const baseName = fileName.replace(/\.[^.]+$/, '');
  const extension = format === 'jpeg' ? 'jpg' : format;
  return `${baseName}-cleaned.${extension}`;
};

const clampRegionToBounds = (
  region: WatermarkRegion,
  width: number,
  height: number
): WatermarkRegion => {
  const x = clamp(Math.round(region.x), 0, Math.max(0, width - 1));
  const y = clamp(Math.round(region.y), 0, Math.max(0, height - 1));
  return {
    ...region,
    x,
    y,
    width: clamp(Math.round(region.width), 1, Math.max(1, width - x)),
    height: clamp(Math.round(region.height), 1, Math.max(1, height - y))
  };
};

const updateRegionList = (
  regions: WatermarkRegion[],
  regionId: string | null,
  patch: Partial<Pick<WatermarkRegion, RegionField>>,
  dimensions: ImageDimensions
): WatermarkRegion[] => {
  if (!regionId) return regions;
  return regions.map((region) =>
    region.id !== regionId
      ? region
      : clampRegionToBounds(
          { ...region, ...patch },
          dimensions.width,
          dimensions.height
        )
  );
};

const createSelectionSignature = (regionsA: WatermarkRegion[], regionsB: WatermarkRegion[]): string =>
  JSON.stringify({
    regionsA: regionsA.map(({ id, x, y, width, height }) => ({ id, x, y, width, height })),
    regionsB: regionsB.map(({ id, x, y, width, height }) => ({ id, x, y, width, height }))
  });

function RegionInspector({
  title,
  subtitle,
  regions,
  selectedRegion,
  dimensions,
  onFieldChange,
  onDeleteSelected,
  onClearAll
}: {
  title: string;
  subtitle: string;
  regions: WatermarkRegion[];
  selectedRegion: WatermarkRegion | null;
  dimensions: ImageDimensions | null;
  onFieldChange: (field: RegionField, value: string) => void;
  onDeleteSelected: () => void;
  onClearAll: () => void;
}) {
  return (
    <div className={cardClass}>
      <div className="mb-4 border-b-2 border-black pb-3">
        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">{title}</div>
        <h2 className="mt-1 text-lg font-black uppercase text-slate-900">{subtitle}</h2>
      </div>
      <div className="space-y-3">
        <div className="rounded-2xl border-2 border-black bg-[#F8FAFC] px-4 py-3 text-[11px] font-black uppercase text-slate-600">
          {regions.length} region{regions.length === 1 ? '' : 's'} selected{dimensions ? ` | ${dimensions.width}x${dimensions.height}` : ''}
        </div>
        {selectedRegion ? (
          <div className="grid grid-cols-2 gap-3">
            {(['x', 'y', 'width', 'height'] as const).map((field) => (
              <label key={field} className="rounded-2xl border-2 border-black bg-white px-3 py-3 text-[11px] font-black uppercase text-slate-600">
                <span>{field}</span>
                <input
                  type="number"
                  min={field === 'width' || field === 'height' ? 1 : 0}
                  value={selectedRegion[field]}
                  onChange={(event) => onFieldChange(field, event.target.value)}
                  className="mt-2 w-full rounded-xl border-2 border-black px-3 py-2 text-sm font-black text-slate-900 outline-none"
                />
              </label>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border-2 border-dashed border-black bg-[#F8FAFC] px-4 py-5 text-[11px] font-black uppercase text-slate-500">
            Click a region to edit it. Drag on the image to draw a new region.
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <button onClick={onDeleteSelected} disabled={!selectedRegion} className={dangerButtonClass}>
            <Trash2 size={16} />
            Delete Selected
          </button>
          <button onClick={onClearAll} disabled={regions.length === 0} className={yellowButtonClass}>
            Clear All
          </button>
        </div>
      </div>
    </div>
  );
}

export function WatermarkRemovalMode({ onBack }: WatermarkRemovalModeProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [imageA, setImageA] = useState<ImageSlot | null>(null);
  const [imageB, setImageB] = useState<ImageSlot | null>(null);
  const [imageDimensions, setImageDimensions] = useState<ImageDimensions | null>(null);
  const [regionsA, setRegionsA] = useState<WatermarkRegion[]>([]);
  const [regionsB, setRegionsB] = useState<WatermarkRegion[]>([]);
  const [selectedRegionAId, setSelectedRegionAId] = useState<string | null>(null);
  const [selectedRegionBId, setSelectedRegionBId] = useState<string | null>(null);
  const [processedImageADataUrl, setProcessedImageADataUrl] = useState<string | null>(null);
  const [processedImageBDataUrl, setProcessedImageBDataUrl] = useState<string | null>(null);
  const [coverageA, setCoverageA] = useState<number | null>(null);
  const [coverageB, setCoverageB] = useState<number | null>(null);
  const [presets, setPresets] = useState<WatermarkSelectionPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [presetName, setPresetName] = useState('');
  const [exportFormat, setExportFormat] = useState<'png' | 'jpeg' | 'webp'>('png');
  const [jpegQuality, setJpegQuality] = useState(92);
  const [lastAppliedSignature, setLastAppliedSignature] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState('Load two puzzle images to begin.');
  const [error, setError] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);

  const selectedPreset = useMemo(() => presets.find((preset) => preset.id === selectedPresetId) ?? null, [presets, selectedPresetId]);
  const selectedRegionA = useMemo(() => regionsA.find((region) => region.id === selectedRegionAId) ?? null, [regionsA, selectedRegionAId]);
  const selectedRegionB = useMemo(() => regionsB.find((region) => region.id === selectedRegionBId) ?? null, [regionsB, selectedRegionBId]);
  const loadedCount = Number(Boolean(imageA)) + Number(Boolean(imageB));
  const totalInputSize = (imageA?.fileSize ?? 0) + (imageB?.fileSize ?? 0);
  const hasImages = Boolean(imageA && imageB && imageDimensions);
  const hasSelections = regionsA.length + regionsB.length > 0;
  const hasProcessedPair = Boolean(processedImageADataUrl && processedImageBDataUrl);
  const currentSelectionSignature = useMemo(() => createSelectionSignature(regionsA, regionsB), [regionsA, regionsB]);
  const needsRefresh = hasProcessedPair && lastAppliedSignature !== currentSelectionSignature;

  useEffect(() => {
    setPresets(loadWatermarkPresets());
  }, []);

  useEffect(() => {
    if (selectedPreset) setPresetName(selectedPreset.name);
  }, [selectedPreset]);

  const resetProcessedOutputs = () => {
    setProcessedImageADataUrl(null);
    setProcessedImageBDataUrl(null);
    setCoverageA(null);
    setCoverageB(null);
    setLastAppliedSignature('');
  };

  const loadFiles = async (files: File[]) => {
    if (isProcessing) return;
    const imageFiles = files.filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length !== 2) {
      setError('Select exactly two images.');
      setStatus('Two images are required.');
      return;
    }
    try {
      const orderedFiles = sortPuzzlePairFiles(imageFiles);
      setError(null);
      setStatus('Loading puzzle images...');
      const [dataUrlA, dataUrlB] = await Promise.all([
        readFileAsDataUrl(orderedFiles[0]),
        readFileAsDataUrl(orderedFiles[1])
      ]);
      const [dimensionsA, dimensionsB] = await Promise.all([
        readImageDimensions(dataUrlA),
        readImageDimensions(dataUrlB)
      ]);
      if (dimensionsA.width !== dimensionsB.width || dimensionsA.height !== dimensionsB.height) {
        throw new Error('Images must have the same resolution.');
      }
      setImageA({ dataUrl: dataUrlA, fileName: orderedFiles[0].name, fileSize: orderedFiles[0].size });
      setImageB({ dataUrl: dataUrlB, fileName: orderedFiles[1].name, fileSize: orderedFiles[1].size });
      setImageDimensions(dimensionsA);
      setRegionsA([]);
      setRegionsB([]);
      setSelectedRegionAId(null);
      setSelectedRegionBId(null);
      resetProcessedOutputs();
      setStatus('Puzzle Image (A) is the base image and Diff Image (B) is the changed image. Draw rectangles over each watermark.');
    } catch (loadError) {
      console.error('Failed to load watermark pair:', loadError);
      setError(loadError instanceof Error ? loadError.message : 'Failed to load the selected images.');
      setStatus('Image load failed.');
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = event.currentTarget.files;
    const files: File[] = fileList ? Array.from(fileList) : [];
    event.currentTarget.value = '';
    if (files.length > 0) await loadFiles(files);
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(false);
    const fileList = event.dataTransfer.files;
    const files: File[] = fileList ? Array.from(fileList) : [];
    if (files.length > 0) await loadFiles(files);
  };

  const handleRegionFieldChange = (side: 'A' | 'B', field: RegionField, rawValue: string) => {
    if (!imageDimensions) return;
    const nextValue = Number.parseInt(rawValue, 10);
    if (!Number.isFinite(nextValue)) return;
    if (side === 'A') {
      setRegionsA((current) => updateRegionList(current, selectedRegionAId, { [field]: nextValue }, imageDimensions));
      return;
    }
    setRegionsB((current) => updateRegionList(current, selectedRegionBId, { [field]: nextValue }, imageDimensions));
  };

  const handleDeleteSelectedRegion = (side: 'A' | 'B') => {
    if (side === 'A') {
      if (!selectedRegionAId) return;
      setRegionsA((current) => current.filter((region) => region.id !== selectedRegionAId));
      setSelectedRegionAId(null);
      return;
    }
    if (!selectedRegionBId) return;
    setRegionsB((current) => current.filter((region) => region.id !== selectedRegionBId));
    setSelectedRegionBId(null);
  };

  const handleClearRegions = (side: 'A' | 'B') => {
    if (side === 'A') {
      setRegionsA([]);
      setSelectedRegionAId(null);
      return;
    }
    setRegionsB([]);
    setSelectedRegionBId(null);
  };

  const handleApplyPreset = () => {
    if (!selectedPreset || !imageDimensions) return;
    setRegionsA(
      scaleWatermarkRegions(
        selectedPreset.regionsA,
        selectedPreset.sourceWidth,
        selectedPreset.sourceHeight,
        imageDimensions.width,
        imageDimensions.height
      )
    );
    setRegionsB(
      scaleWatermarkRegions(
        selectedPreset.regionsB,
        selectedPreset.sourceWidth,
        selectedPreset.sourceHeight,
        imageDimensions.width,
        imageDimensions.height
      )
    );
    setSelectedRegionAId(null);
    setSelectedRegionBId(null);
    resetProcessedOutputs();
    setStatus(`Preset "${selectedPreset.name}" applied to the current image pair.`);
  };

  const handleSaveNewPreset = () => {
    if (!imageDimensions) {
      setError('Load a pair of images before saving a preset.');
      return;
    }
    const preset = createWatermarkSelectionPreset(
      presetName,
      imageDimensions.width,
      imageDimensions.height,
      regionsA,
      regionsB
    );
    const nextPresets = saveWatermarkPreset(preset);
    setPresets(nextPresets);
    setSelectedPresetId(preset.id);
    setPresetName(preset.name);
    setStatus(`Preset "${preset.name}" saved.`);
    setError(null);
  };

  const handleUpdateSelectedPreset = () => {
    if (!selectedPreset || !imageDimensions) {
      setError('Select a preset to update.');
      return;
    }
    const nextPreset = {
      ...createWatermarkSelectionPreset(
        presetName,
        imageDimensions.width,
        imageDimensions.height,
        regionsA,
        regionsB,
        selectedPreset.id
      ),
      createdAt: selectedPreset.createdAt
    };
    const nextPresets = saveWatermarkPreset(nextPreset);
    setPresets(nextPresets);
    setSelectedPresetId(nextPreset.id);
    setPresetName(nextPreset.name);
    setStatus(`Preset "${nextPreset.name}" updated.`);
    setError(null);
  };

  const handleDeleteSelectedPreset = () => {
    if (!selectedPreset) return;
    const nextPresets = deleteStoredWatermarkPreset(selectedPreset.id);
    setPresets(nextPresets);
    setSelectedPresetId('');
    setPresetName('');
    setStatus(`Preset "${selectedPreset.name}" deleted.`);
  };

  const handleProcess = async () => {
    if (!imageA || !imageB || !hasSelections || isProcessing) return;
    setIsProcessing(true);
    setError(null);
    setStatus('Swapping the selected watermark regions between both images...');
    try {
      const result = await removeWatermarkWithRegions(imageA.dataUrl, imageB.dataUrl, regionsA, regionsB);
      setProcessedImageADataUrl(result.imageA.toDataURL('image/png'));
      setProcessedImageBDataUrl(result.imageB.toDataURL('image/png'));
      setCoverageA(result.coverageA);
      setCoverageB(result.coverageB);
      setLastAppliedSignature(currentSelectionSignature);
      setStatus('Watermark regions replaced on both images.');
    } catch (processError) {
      console.error('Failed to remove watermark:', processError);
      setError(
        processError instanceof Error
          ? processError.message
          : 'Failed to remove the selected watermark regions.'
      );
      setStatus('Watermark removal failed.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExportBoth = async () => {
    if (!imageA || !imageB || !processedImageADataUrl || !processedImageBDataUrl) return;
    try {
      setError(null);
      setStatus('Exporting cleaned images...');
      const quality = jpegQuality / 100;
      const [blobA, blobB] = await Promise.all([
        exportProcessedImage(processedImageADataUrl, exportFormat, quality),
        exportProcessedImage(processedImageBDataUrl, exportFormat, quality)
      ]);
      triggerBlobDownload(blobA, getExportFilename(imageA.fileName, exportFormat));
      triggerBlobDownload(blobB, getExportFilename(imageB.fileName, exportFormat));
      setStatus('Cleaned images exported.');
    } catch (exportError) {
      console.error('Failed to export images:', exportError);
      setError('Failed to export the cleaned images.');
      setStatus('Export failed.');
    }
  };

  const handleClearAll = () => {
    setImageA(null);
    setImageB(null);
    setImageDimensions(null);
    setRegionsA([]);
    setRegionsB([]);
    setSelectedRegionAId(null);
    setSelectedRegionBId(null);
    resetProcessedOutputs();
    setError(null);
    setStatus('Load two puzzle images to begin.');
  };

  return (
    <div className="min-h-full bg-[#F7F7FB]">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border-4 border-black bg-white text-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
              aria-label="Back"
            >
              <ArrowLeft size={20} />
            </button>
            <div>
              <div className="inline-flex rounded-full border-2 border-black bg-[#FDE68A] px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-slate-700">
                Manual Watermark Swap
              </div>
              <h1 className="mt-2 text-3xl font-black uppercase tracking-tight text-slate-900 sm:text-4xl">
                Mark The Watermark Areas And Swap Them
              </h1>
            </div>
          </div>
          <div className="rounded-2xl border-4 border-black bg-white px-4 py-3 text-right shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">Pair Status</div>
            <div className="mt-1 text-sm font-black uppercase text-slate-900">{loadedCount}/2 images loaded</div>
            <div className="text-[11px] font-black uppercase text-slate-500">{formatFileSize(totalInputSize)}</div>
          </div>
        </div>

        <div className="rounded-[28px] border-4 border-black bg-[#D9F99D] px-5 py-4 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
          <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-700">Workflow</div>
          <p className="mt-2 text-sm font-black uppercase leading-6 text-slate-900">
            1. Load the puzzle image as Image A and the diff image as Image B. 2. Draw rectangles directly over each watermark.
            3. Save the selection as a preset if you want. 4. Click remove watermark to copy only
            the marked pixels from the opposite image.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-6">
            <div className={cardClass}>
              <div className="mb-4 border-b-2 border-black pb-3">
                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">Upload</div>
                <h2 className="mt-1 text-lg font-black uppercase text-slate-900">Load Puzzle Pair</h2>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileUpload}
                className="hidden"
              />
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDragActive(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  setIsDragActive(false);
                }}
                onDrop={handleDrop}
                className={`cursor-pointer rounded-[24px] border-4 border-dashed border-black px-5 py-8 text-center transition-colors ${isDragActive ? 'bg-[#DBEAFE]' : 'bg-[#F8FAFC]'}`}
              >
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border-2 border-black bg-white">
                  <ImagePlus size={24} />
                </div>
                <p className="mt-4 text-sm font-black uppercase text-slate-900">Drop two images here</p>
                <p className="mt-2 text-[11px] font-black uppercase text-slate-500">
                  Or click to choose the puzzle image and diff image
                </p>
              </div>
              <div className="mt-4 space-y-3 text-[11px] font-black uppercase text-slate-600">
                <div className="rounded-2xl border-2 border-black bg-[#F8FAFC] px-4 py-3">
                  {PUZZLE_IMAGE_LABEL}: {imageA ? imageA.fileName : 'Not loaded'}
                </div>
                <div className="rounded-2xl border-2 border-black bg-[#F8FAFC] px-4 py-3">
                  {DIFF_IMAGE_LABEL}: {imageB ? imageB.fileName : 'Not loaded'}
                </div>
              </div>
            </div>

            <RegionInspector
              title={PUZZLE_IMAGE_LABEL}
              subtitle="Puzzle/Base Image Regions"
              regions={regionsA}
              selectedRegion={selectedRegionA}
              dimensions={imageDimensions}
              onFieldChange={(field, value) => handleRegionFieldChange('A', field, value)}
              onDeleteSelected={() => handleDeleteSelectedRegion('A')}
              onClearAll={() => handleClearRegions('A')}
            />

            <RegionInspector
              title={DIFF_IMAGE_LABEL}
              subtitle="Diff Image Regions"
              regions={regionsB}
              selectedRegion={selectedRegionB}
              dimensions={imageDimensions}
              onFieldChange={(field, value) => handleRegionFieldChange('B', field, value)}
              onDeleteSelected={() => handleDeleteSelectedRegion('B')}
              onClearAll={() => handleClearRegions('B')}
            />

            <div className={cardClass}>
              <div className="mb-4 border-b-2 border-black pb-3">
                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">Presets</div>
                <h2 className="mt-1 text-lg font-black uppercase text-slate-900">Save And Reuse Selections</h2>
              </div>
              <div className="space-y-3">
                <select
                  value={selectedPresetId}
                  onChange={(event) => setSelectedPresetId(event.target.value)}
                  className="w-full rounded-2xl border-2 border-black bg-white px-4 py-3 text-sm font-black text-slate-900 outline-none"
                >
                  <option value="">No preset selected</option>
                  {presets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={presetName}
                  onChange={(event) => setPresetName(event.target.value)}
                  placeholder="Preset name"
                  className="w-full rounded-2xl border-2 border-black bg-white px-4 py-3 text-sm font-black text-slate-900 outline-none placeholder:text-slate-400"
                />
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={handleApplyPreset} disabled={!selectedPreset || !imageDimensions} className={yellowButtonClass}>
                    Apply Preset
                  </button>
                  <button onClick={handleSaveNewPreset} disabled={!imageDimensions || !hasSelections} className={tealButtonClass}>
                    <Save size={16} />
                    Save New
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={handleUpdateSelectedPreset}
                    disabled={!selectedPreset || !imageDimensions || !hasSelections}
                    className={pinkButtonClass}
                  >
                    Update Selected
                  </button>
                  <button onClick={handleDeleteSelectedPreset} disabled={!selectedPreset} className={dangerButtonClass}>
                    <Trash2 size={16} />
                    Delete Preset
                  </button>
                </div>
                <p className="rounded-2xl border-2 border-black bg-[#F8FAFC] px-4 py-3 text-[11px] font-black uppercase text-slate-600">
                  Presets are saved in local storage and scale to the current image size.
                </p>
              </div>
            </div>

            <div className={cardClass}>
              <div className="mb-4 border-b-2 border-black pb-3">
                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">Export</div>
                <h2 className="mt-1 text-lg font-black uppercase text-slate-900">Output Files</h2>
              </div>
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  {(['png', 'jpeg', 'webp'] as const).map((format) => (
                    <button
                      key={format}
                      onClick={() => setExportFormat(format)}
                      className={`rounded-2xl border-2 border-black px-3 py-3 text-xs font-black uppercase transition-colors ${exportFormat === format ? 'bg-[#4ECDC4] text-black' : 'bg-white text-slate-700 hover:bg-slate-100'}`}
                    >
                      {format.toUpperCase()}
                    </button>
                  ))}
                </div>
                {exportFormat === 'jpeg' && (
                  <label className="block rounded-2xl border-2 border-black bg-[#F8FAFC] px-4 py-3 text-[11px] font-black uppercase text-slate-600">
                    JPEG Quality: {jpegQuality}%
                    <input
                      type="range"
                      min="70"
                      max="100"
                      value={jpegQuality}
                      onChange={(event) => setJpegQuality(parseInt(event.target.value, 10))}
                      className="mt-2 w-full"
                    />
                  </label>
                )}
                <button onClick={handleExportBoth} disabled={!hasProcessedPair || needsRefresh} className={pinkButtonClass}>
                  <Download size={16} />
                  Export Both Images
                </button>
              </div>
            </div>

            <div className={cardClass}>
              <div className="mb-4 border-b-2 border-black pb-3">
                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">Run</div>
                <h2 className="mt-1 text-lg font-black uppercase text-slate-900">Remove Watermark</h2>
              </div>
              <div className="space-y-3">
                <button onClick={handleProcess} disabled={!hasImages || !hasSelections || isProcessing} className={`${tealButtonClass} w-full`}>
                  {isProcessing ? (
                    <>
                      <LoaderCircle size={16} className="animate-spin" />
                      Swapping Pixels
                    </>
                  ) : (
                    'Remove Watermark'
                  )}
                </button>
                <button onClick={handleClearAll} disabled={loadedCount === 0 || isProcessing} className={`${dangerButtonClass} w-full`}>
                  <Trash2 size={16} />
                  Clear Pair
                </button>
                <div className="rounded-2xl border-2 border-black bg-[#F8FAFC] px-4 py-3 text-[11px] font-black uppercase text-slate-600">
                  Selected coverage: A {coverageA === null ? 'n/a' : `${(coverageA * 100).toFixed(2)}%`} | B {coverageB === null ? 'n/a' : `${(coverageB * 100).toFixed(2)}%`}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className={cardClass}>
              <div className="mb-4 flex flex-col gap-3 border-b-2 border-black pb-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">Editors</div>
                  <h2 className="mt-1 text-lg font-black uppercase text-slate-900">Draw Directly On The Real Images</h2>
                </div>
                <div className="rounded-2xl border-2 border-black bg-[#DBEAFE] px-4 py-3 text-[11px] font-black uppercase text-slate-700">
                  Drag on empty space to draw. Drag inside a region to move it.
                </div>
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                <WatermarkRegionEditor
                  title={PUZZLE_IMAGE_LABEL}
                  subtitle={`Select the watermark area to replace from ${DIFF_IMAGE_LABEL}`}
                  imageUrl={imageA?.dataUrl ?? null}
                  width={imageDimensions?.width ?? 0}
                  height={imageDimensions?.height ?? 0}
                  regions={regionsA}
                  selectedRegionId={selectedRegionAId}
                  disabled={!hasImages || isProcessing}
                  onRegionsChange={setRegionsA}
                  onSelectedRegionChange={setSelectedRegionAId}
                />
                <WatermarkRegionEditor
                  title={DIFF_IMAGE_LABEL}
                  subtitle={`Select the watermark area to replace from ${PUZZLE_IMAGE_LABEL}`}
                  imageUrl={imageB?.dataUrl ?? null}
                  width={imageDimensions?.width ?? 0}
                  height={imageDimensions?.height ?? 0}
                  regions={regionsB}
                  selectedRegionId={selectedRegionBId}
                  disabled={!hasImages || isProcessing}
                  onRegionsChange={setRegionsB}
                  onSelectedRegionChange={setSelectedRegionBId}
                />
              </div>
            </div>

            {error && (
              <div className="rounded-[28px] border-4 border-black bg-[#FCA5A5] px-5 py-4 text-sm font-black uppercase text-slate-900 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
                {error}
              </div>
            )}

            <div className="rounded-[28px] border-4 border-black bg-white px-5 py-4 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">Status</div>
                  <p className="mt-1 text-sm font-black uppercase text-slate-900">{status}</p>
                </div>
                {needsRefresh && (
                  <div className="rounded-2xl border-2 border-black bg-[#FDE68A] px-4 py-3 text-[11px] font-black uppercase text-slate-700">
                    Regions changed. Run remove watermark again before exporting.
                  </div>
                )}
              </div>
            </div>

            <div className={cardClass}>
              <div className="mb-4 border-b-2 border-black pb-3">
                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">Results</div>
                <h2 className="mt-1 text-lg font-black uppercase text-slate-900">Cleaned Images</h2>
              </div>
              {hasProcessedPair ? (
                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="rounded-2xl border-2 border-black bg-[#F8FAFC] p-3">
                    <div className="mb-3 text-[11px] font-black uppercase text-slate-600">{imageA?.fileName ?? PUZZLE_IMAGE_LABEL}</div>
                    <img
                      src={processedImageADataUrl ?? undefined}
                      alt="Cleaned puzzle image"
                      className="h-auto w-full rounded-xl border border-black bg-white"
                    />
                  </div>
                  <div className="rounded-2xl border-2 border-black bg-[#F8FAFC] p-3">
                    <div className="mb-3 text-[11px] font-black uppercase text-slate-600">{imageB?.fileName ?? DIFF_IMAGE_LABEL}</div>
                    <img
                      src={processedImageBDataUrl ?? undefined}
                      alt="Cleaned diff image"
                      className="h-auto w-full rounded-xl border border-black bg-white"
                    />
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border-2 border-dashed border-black bg-[#F8FAFC] px-5 py-12 text-center text-[11px] font-black uppercase text-slate-500">
                  Load the puzzle image as A and the diff image as B, mark the watermark regions, then click remove watermark.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
