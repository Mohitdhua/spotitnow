import React, { DragEvent, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Crop, Download, Image as ImageIcon, Layers, Plus, RefreshCcw, Trash2, Upload } from 'lucide-react';
import {
  assistLinkedSplitPairPlacement,
  dataUrlToPngBlob,
  splitCombinedImageFromLinkedSelection,
  splitCombinedImageFromSelection,
  type LinkedSplitPairAssistResult,
  type LinkedSplitPairSelection,
  type SplitRegionSelection
} from '../services/imageSplitter';
import {
  clearSplitterSharedPair,
  clearSplitterSharedRegion,
  createSplitterSetupSnapshot,
  parseSplitterSetupSnapshot,
  readSplitterMode,
  readSplitterNextSequence,
  readSplitterSharedPair,
  readSplitterSharedRegion,
  setSplitterNextSequence,
  saveSplitterMode,
  saveSplitterSharedPair,
  saveSplitterSharedRegion,
  type SplitterModePreference,
  type SplitterSharedRegion
} from '../services/appSettings';

interface SplitPreviewPair {
  id: string;
  sequence: number;
  baseName: string;
  sourceName: string;
  sourcePreviewUrl: string;
  sourceWidth: number;
  sourceHeight: number;
  suggestedRegion: SplitRegionSelection;
  imageA?: string;
  imageB?: string;
  manualRegion?: SplitRegionSelection;
  manualPairSelection?: LinkedSplitPairSelection;
  splitMode: 'pending' | 'manual_area' | 'manual_pair';
}

interface ManualEditorState {
  pairId: string;
  sourceName: string;
  sourcePreviewUrl: string;
  sourceWidth: number;
  sourceHeight: number;
  suggestedRegion: SplitRegionSelection;
  region: SplitRegionSelection;
}

interface ManualPairEditorState {
  pairId: string;
  sourceName: string;
  sourcePreviewUrl: string;
  sourceWidth: number;
  sourceHeight: number;
  suggestedSelection: LinkedSplitPairSelection;
  selection: LinkedSplitPairSelection;
  assistResult: LinkedSplitPairAssistResult | null;
}

interface NormalizedLinkedSplitPairSelection {
  x: number;
  y: number;
  size: number;
  gap: number;
}

interface ImageSplitterPanelProps {
  onBatchProcess: (files: File[]) => void;
  defaultMode: SplitterModePreference;
  namingDefaults?: {
    filenamePrefix: string;
    filenamePadDigits: number;
  };
}

let fallbackNextSequence = 483;

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

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const clampSequence = (value: number) => Math.max(1, Math.floor(value));

const readNextSequence = (): number => {
  try {
    const safe = clampSequence(readSplitterNextSequence());
    fallbackNextSequence = safe;
    return safe;
  } catch {
    // Ignore storage read issues and use in-memory fallback.
  }

  return fallbackNextSequence;
};

const writeNextSequence = (value: number) => {
  const safe = clampSequence(value);
  fallbackNextSequence = safe;
  try {
    setSplitterNextSequence(safe);
  } catch {
    // Ignore storage write issues and keep in-memory fallback.
  }
};

const takeNextSequence = (): number => {
  const next = readNextSequence();
  writeNextSequence(next + 1);
  return next;
};

const sanitizePrefix = (value: string) => {
  const cleaned = value.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '').replace(/\s+/g, '');
  return cleaned || 'puzzle';
};

const buildSplitFilename = (
  sequence: number,
  namingDefaults: ImageSplitterPanelProps['namingDefaults'],
  isDiff: boolean
) => {
  const prefix = sanitizePrefix(namingDefaults?.filenamePrefix ?? 'puzzle');
  const padDigits = Math.max(0, Math.floor(namingDefaults?.filenamePadDigits ?? 0));
  const serial = padDigits > 0 ? String(sequence).padStart(padDigits, '0') : String(sequence);
  return `${prefix}${serial}${isDiff ? 'diff' : ''}.png`;
};

const buildSplitFilenames = (
  sequence: number,
  namingDefaults: ImageSplitterPanelProps['namingDefaults']
) => ({
  puzzleFilename: buildSplitFilename(sequence, namingDefaults, false),
  diffFilename: buildSplitFilename(sequence, namingDefaults, true)
});

const buildBaseName = (sourceName: string) => sourceName.substring(0, sourceName.lastIndexOf('.')) || sourceName;

const revokePreviewUrl = (item: SplitPreviewPair) => {
  URL.revokeObjectURL(item.sourcePreviewUrl);
};

const normalizeImageFiles = (files: FileList | File[] | null): { raw: File[]; images: File[] } => {
  const raw = Array.isArray(files) ? files : files ? Array.from(files) : [];
  return {
    raw,
    images: raw.filter((file) => file.type.startsWith('image/'))
  };
};

const clampValue = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const createFallbackSplitRegion = (sourceWidth: number, sourceHeight: number): SplitRegionSelection => ({
  x: 0,
  y: 0,
  width: Math.max(1, Math.floor(sourceWidth)),
  height: Math.max(1, Math.floor(sourceHeight))
});

const clampRegionSelection = (
  selection: SplitRegionSelection,
  sourceWidth: number,
  sourceHeight: number
): SplitRegionSelection => {
  const maxWidth = Math.max(1, Math.floor(sourceWidth));
  const maxHeight = Math.max(1, Math.floor(sourceHeight));
  const x = clampValue(Math.floor(selection.x), 0, maxWidth - 1);
  const y = clampValue(Math.floor(selection.y), 0, maxHeight - 1);
  const right = clampValue(Math.ceil(selection.x + Math.max(1, selection.width)), x + 1, maxWidth);
  const bottom = clampValue(Math.ceil(selection.y + Math.max(1, selection.height)), y + 1, maxHeight);

  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y)
  };
};

const createRegionFromDrag = (
  start: { x: number; y: number },
  end: { x: number; y: number },
  sourceWidth: number,
  sourceHeight: number
): SplitRegionSelection => {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);

  return clampRegionSelection(
    {
      x,
      y,
      width,
      height
    },
    sourceWidth,
    sourceHeight
  );
};

const normalizeSplitRegion = (
  selection: SplitRegionSelection,
  sourceWidth: number,
  sourceHeight: number
): SplitterSharedRegion => ({
  x: selection.x / Math.max(1, sourceWidth),
  y: selection.y / Math.max(1, sourceHeight),
  width: selection.width / Math.max(1, sourceWidth),
  height: selection.height / Math.max(1, sourceHeight)
});

const denormalizeSplitRegion = (
  normalized: SplitterSharedRegion,
  sourceWidth: number,
  sourceHeight: number
): SplitRegionSelection =>
  clampRegionSelection(
    {
      x: normalized.x * sourceWidth,
      y: normalized.y * sourceHeight,
      width: normalized.width * sourceWidth,
      height: normalized.height * sourceHeight
    },
    sourceWidth,
    sourceHeight
  );

const clampLinkedSplitPairSelection = (
  selection: LinkedSplitPairSelection,
  sourceWidth: number,
  sourceHeight: number
): LinkedSplitPairSelection => {
  const safeWidth = Math.max(1, Math.floor(sourceWidth));
  const safeHeight = Math.max(1, Math.floor(sourceHeight));
  const maxSize = Math.max(1, Math.min(safeWidth, safeHeight));
  const size = clampValue(Math.round(selection.size), 1, maxSize);
  const maxGap = Math.max(0, safeWidth - size * 2);
  const gap = clampValue(Math.round(selection.gap), 0, maxGap);
  const x = clampValue(Math.round(selection.x), 0, Math.max(0, safeWidth - (size * 2 + gap)));
  const y = clampValue(Math.round(selection.y), 0, Math.max(0, safeHeight - size));

  return {
    x,
    y,
    size,
    gap
  };
};

const createDefaultLinkedSplitPairSelection = (
  sourceWidth: number,
  sourceHeight: number
): LinkedSplitPairSelection => {
  const size = clampValue(
    Math.round(Math.min(sourceWidth * 0.34, sourceHeight * 0.72)),
    64,
    Math.max(64, Math.min(sourceWidth, sourceHeight))
  );
  const gap = Math.max(12, Math.round(size * 0.12));

  return clampLinkedSplitPairSelection(
    {
      x: Math.round((sourceWidth - (size * 2 + gap)) / 2),
      y: Math.round((sourceHeight - size) / 2),
      size,
      gap
    },
    sourceWidth,
    sourceHeight
  );
};

const normalizeLinkedSplitPairLayout = (
  selection: LinkedSplitPairSelection,
  sourceWidth: number,
  sourceHeight: number
): NormalizedLinkedSplitPairSelection => {
  const normalized = clampLinkedSplitPairSelection(selection, sourceWidth, sourceHeight);
  const sizeBase = Math.max(1, Math.min(sourceWidth, sourceHeight));

  return {
    x: normalized.x / Math.max(1, sourceWidth),
    y: normalized.y / Math.max(1, sourceHeight),
    size: normalized.size / sizeBase,
    gap: normalized.gap / Math.max(1, sourceWidth)
  };
};

const denormalizeLinkedSplitPairLayout = (
  normalized: NormalizedLinkedSplitPairSelection,
  sourceWidth: number,
  sourceHeight: number
): LinkedSplitPairSelection => {
  const sizeBase = Math.max(1, Math.min(sourceWidth, sourceHeight));
  return clampLinkedSplitPairSelection(
    {
      x: normalized.x * sourceWidth,
      y: normalized.y * sourceHeight,
      size: normalized.size * sizeBase,
      gap: normalized.gap * sourceWidth
    },
    sourceWidth,
    sourceHeight
  );
};

const getLinkedSplitPairBounds = (selection: LinkedSplitPairSelection) => ({
  first: {
    x: selection.x,
    y: selection.y,
    width: selection.size,
    height: selection.size
  },
  second: {
    x: selection.x + selection.size + selection.gap,
    y: selection.y,
    width: selection.size,
    height: selection.size
  }
});

const pointInBounds = (
  point: { x: number; y: number },
  bounds: { x: number; y: number; width: number; height: number }
) =>
  point.x >= bounds.x &&
  point.x <= bounds.x + bounds.width &&
  point.y >= bounds.y &&
  point.y <= bounds.y + bounds.height;

const readImageSize = (src: string): Promise<{ width: number; height: number }> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () =>
      resolve({
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height
      });
    image.onerror = () => reject(new Error('Failed to load image metadata'));
    image.src = src;
  });

const isSplitReady = (item: SplitPreviewPair): item is SplitPreviewPair & { imageA: string; imageB: string } =>
  Boolean(item.imageA && item.imageB);

export function ImageSplitterPanel({ onBatchProcess, defaultMode, namingDefaults }: ImageSplitterPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const setupInputRef = useRef<HTMLInputElement>(null);
  const splitPairsRef = useRef<SplitPreviewPair[]>([]);
  const editorDragStartRef = useRef<{ x: number; y: number } | null>(null);
  const sharedManualRegionRef = useRef<SplitterSharedRegion | null>(null);
  const sharedManualPairRef = useRef<NormalizedLinkedSplitPairSelection | null>(null);
  const hasMountedDefaultModeRef = useRef(false);
  const splitterModeRef = useRef<SplitterModePreference>('shared_area');
  const pairEditorDragRef = useRef<{
    box: 'first' | 'second';
    pointerOffsetX: number;
    pointerOffsetY: number;
  } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState('');
  const [splitPairs, setSplitPairs] = useState<SplitPreviewPair[]>([]);
  const [nextSequence, setNextSequence] = useState(() => readNextSequence());
  const [isDragActive, setIsDragActive] = useState(false);
  const [splitterMode, setSplitterMode] = useState<SplitterModePreference>(() => readSplitterMode());
  const [manualEditor, setManualEditor] = useState<ManualEditorState | null>(null);
  const [manualPairEditor, setManualPairEditor] = useState<ManualPairEditorState | null>(null);
  const [sharedManualRegion, setSharedManualRegion] = useState<SplitterSharedRegion | null>(() => readSplitterSharedRegion());
  const [sharedManualPair, setSharedManualPair] = useState<NormalizedLinkedSplitPairSelection | null>(
    () => readSplitterSharedPair()
  );

  useEffect(() => {
    splitPairsRef.current = splitPairs;
  }, [splitPairs]);

  useEffect(() => {
    sharedManualRegionRef.current = sharedManualRegion;
  }, [sharedManualRegion]);

  useEffect(() => {
    sharedManualPairRef.current = sharedManualPair;
  }, [sharedManualPair]);

  useEffect(() => {
    splitterModeRef.current = splitterMode;
  }, [splitterMode]);

  useEffect(() => {
    if (!hasMountedDefaultModeRef.current) {
      hasMountedDefaultModeRef.current = true;
      return;
    }
    setSplitterMode(defaultMode);
  }, [defaultMode]);

  useEffect(() => {
    saveSplitterMode(splitterMode);
  }, [splitterMode]);

  useEffect(() => {
    if (sharedManualRegion) {
      saveSplitterSharedRegion(sharedManualRegion);
      return;
    }
    clearSplitterSharedRegion();
  }, [sharedManualRegion]);

  useEffect(() => {
    if (sharedManualPair) {
      saveSplitterSharedPair(sharedManualPair);
      return;
    }
    clearSplitterSharedPair();
  }, [sharedManualPair]);

  useEffect(() => {
    return () => {
      splitPairsRef.current.forEach(revokePreviewUrl);
    };
  }, []);

  const readyPairs = splitPairs.filter(isSplitReady);
  const readyPairCount = readyPairs.length;
  const pendingPairCount = splitPairs.length - readyPairCount;
  const totalOutputFiles = readyPairCount * 2;
  const nextFilenames = buildSplitFilenames(nextSequence, namingDefaults);

  const handleSelectCombinedImages = async (files: FileList | File[] | null) => {
    if (isProcessing) return;

    const { raw, images } = normalizeImageFiles(files);
    if (!raw.length) return;
    if (!images.length) {
      alert('Select one or more image files to split.');
      return;
    }

    setIsProcessing(true);
    setStatus(`Loading ${images.length} image${images.length === 1 ? '' : 's'}...`);

    let failed = 0;
    let sharedSelectionFallbacks = 0;
    const extracted: SplitPreviewPair[] = [];
    const activeSharedRegion = sharedManualRegionRef.current;
    const activeSharedPair = sharedManualPairRef.current;
    const activeSplitterMode = splitterModeRef.current;

    for (let i = 0; i < images.length; i += 1) {
      const file = images[i];
      const sourcePreviewUrl = URL.createObjectURL(file);
      setStatus(`Loading ${i + 1} of ${images.length}: ${file.name}`);
      try {
        const { width, height } = await readImageSize(sourcePreviewUrl);
        const sequence = takeNextSequence();
        const sharedSelectionForItem = activeSharedRegion
          ? denormalizeSplitRegion(activeSharedRegion, width, height)
          : null;
        const sharedPairSelectionForItem = activeSharedPair
          ? denormalizeLinkedSplitPairLayout(activeSharedPair, width, height)
          : null;
        let nextImageA: string | undefined;
        let nextImageB: string | undefined;
        let nextSplitMode: SplitPreviewPair['splitMode'] = 'pending';

        if (activeSplitterMode === 'shared_area' && sharedSelectionForItem) {
          try {
            const sharedResult = await splitCombinedImageFromSelection(sourcePreviewUrl, sharedSelectionForItem);
            nextImageA = sharedResult.imageA;
            nextImageB = sharedResult.imageB;
            nextSplitMode = 'manual_area';
          } catch (error) {
            sharedSelectionFallbacks += 1;
            console.error(`Shared split area could not be applied for "${file.name}"`, error);
          }
        }

        if (activeSplitterMode === 'manual_pair' && sharedPairSelectionForItem) {
          try {
            const sharedResult = await splitCombinedImageFromLinkedSelection(
              sourcePreviewUrl,
              sharedPairSelectionForItem
            );
            nextImageA = sharedResult.imageA;
            nextImageB = sharedResult.imageB;
            nextSplitMode = 'manual_pair';
          } catch (error) {
            sharedSelectionFallbacks += 1;
            console.error(`Shared manual pair could not be applied for "${file.name}"`, error);
          }
        }

        extracted.push({
          id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`,
          sequence,
          baseName: buildBaseName(file.name),
          sourceName: file.name,
          sourcePreviewUrl,
          sourceWidth: width,
          sourceHeight: height,
          suggestedRegion: createFallbackSplitRegion(width, height),
          imageA: nextImageA,
          imageB: nextImageB,
          manualRegion: nextSplitMode === 'manual_area' ? sharedSelectionForItem ?? undefined : undefined,
          manualPairSelection:
            nextSplitMode === 'manual_pair' ? sharedPairSelectionForItem ?? undefined : undefined,
          splitMode: nextSplitMode
        });
      } catch (error) {
        failed += 1;
        URL.revokeObjectURL(sourcePreviewUrl);
        console.error(`Failed to split "${file.name}"`, error);
      }
    }

    setSplitPairs((current) => [...current, ...extracted]);
    setNextSequence(readNextSequence());
    setIsProcessing(false);
    setStatus('');

    if (extracted.length === 0) {
      alert('Could not load any selected images.');
      return;
    }
    if (failed > 0) {
      alert(`Loaded ${extracted.length} image(s). Failed for ${failed} image(s).`);
      return;
    }
    if (sharedSelectionFallbacks > 0) {
      alert(
        `Loaded ${extracted.length} image(s). The active shared ${activeSplitterMode === 'manual_pair' ? 'pair layout' : 'area'} could not be reused for ${sharedSelectionFallbacks} image(s), so those are still waiting for a valid setup.`
      );
    }
  };

  const handleDownloadSplitImages = async () => {
    if (!readyPairs.length || isProcessing) return;

    setIsProcessing(true);
    setStatus('Preparing split image downloads...');

    try {
      for (let i = 0; i < readyPairs.length; i += 1) {
        const item = readyPairs[i];
        const filenames = buildSplitFilenames(item.sequence, namingDefaults);
        setStatus(`Downloading ${i + 1} of ${readyPairs.length}: Puzzle ${item.sequence}`);

        const [puzzleBlob, diffBlob] = await Promise.all([
          dataUrlToPngBlob(item.imageA),
          dataUrlToPngBlob(item.imageB)
        ]);

        triggerBlobDownload(puzzleBlob, filenames.puzzleFilename);
        await delay(60);
        triggerBlobDownload(diffBlob, filenames.diffFilename);
        await delay(60);
      }
    } catch (error) {
      console.error('Failed to download split images', error);
      alert('Failed to download one or more split images.');
    } finally {
      setIsProcessing(false);
      setStatus('');
    }
  };

  const handleDownloadPair = async (item: SplitPreviewPair) => {
    if (isProcessing || !isSplitReady(item)) return;

    setIsProcessing(true);
    setStatus(`Preparing Puzzle ${item.sequence} download...`);

    try {
      const filenames = buildSplitFilenames(item.sequence, namingDefaults);
      const [puzzleBlob, diffBlob] = await Promise.all([
        dataUrlToPngBlob(item.imageA),
        dataUrlToPngBlob(item.imageB)
      ]);

      triggerBlobDownload(puzzleBlob, filenames.puzzleFilename);
      await delay(60);
      triggerBlobDownload(diffBlob, filenames.diffFilename);
    } catch (error) {
      console.error(`Failed to download split pair ${item.sequence}`, error);
      alert(`Failed to download Puzzle ${item.sequence}.`);
    } finally {
      setIsProcessing(false);
      setStatus('');
    }
  };

  const handleBatchProcess = async () => {
    if (!readyPairs.length || isProcessing) return;

    setIsProcessing(true);
    setStatus('Preparing files for batch processing...');
    try {
      const files: File[] = [];
      for (let i = 0; i < readyPairs.length; i += 1) {
        const item = readyPairs[i];
        const filenames = buildSplitFilenames(item.sequence, namingDefaults);
        setStatus(`Preparing ${i + 1} of ${readyPairs.length}: Puzzle ${item.sequence}`);

        const [puzzleBlob, diffBlob] = await Promise.all([
          dataUrlToPngBlob(item.imageA),
          dataUrlToPngBlob(item.imageB)
        ]);

        files.push(new File([puzzleBlob], filenames.puzzleFilename, { type: 'image/png' }));
        files.push(new File([diffBlob], filenames.diffFilename, { type: 'image/png' }));
      }
      onBatchProcess(files);
    } finally {
      setIsProcessing(false);
      setStatus('');
    }
  };

  const handleClear = () => {
    editorDragStartRef.current = null;
    pairEditorDragRef.current = null;
    setManualEditor(null);
    setManualPairEditor(null);
    setSplitPairs((current) => {
      current.forEach(revokePreviewUrl);
      return [];
    });
  };

  const handleRemovePair = (id: string) => {
    editorDragStartRef.current = null;
    pairEditorDragRef.current = null;
    setManualEditor((current) => (current?.pairId === id ? null : current));
    setManualPairEditor((current) => (current?.pairId === id ? null : current));
    setSplitPairs((current) => {
      const removed = current.find((item) => item.id === id);
      if (removed) {
        revokePreviewUrl(removed);
      }
      return current.filter((item) => item.id !== id);
    });
  };

  const handleExportSetup = () => {
    const snapshot = createSplitterSetupSnapshot({
      splitterMode,
      nextSequence,
      sharedRegion: sharedManualRegion,
      sharedPair: sharedManualPair
    });
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    triggerBlobDownload(blob, 'spotdiff-image-splitter-setup.json');
  };

  const handleLoadSetup = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file || isProcessing) return;

    try {
      const snapshot = parseSplitterSetupSnapshot(await file.text());
      if (!snapshot) {
        alert('Could not load that setup file. Choose a valid Image Splitter setup JSON file.');
        return;
      }

      editorDragStartRef.current = null;
      pairEditorDragRef.current = null;
      setManualEditor(null);
      setManualPairEditor(null);
      setSplitterMode(snapshot.splitterMode);
      setSharedManualRegion(snapshot.sharedRegion);
      setSharedManualPair(snapshot.sharedPair);
      writeNextSequence(snapshot.nextSequence);
      setNextSequence(readNextSequence());

      const activeSelectionLabel =
        snapshot.splitterMode === 'manual_pair' ? 'shared square pair' : 'shared area';
      const hasActiveSelection =
        snapshot.splitterMode === 'manual_pair' ? Boolean(snapshot.sharedPair) : Boolean(snapshot.sharedRegion);
      const existingImagesMessage =
        splitPairsRef.current.length > 0 ? ' Existing loaded images were kept as-is.' : '';

      alert(
        hasActiveSelection
          ? `Setup loaded.${existingImagesMessage} New uploads will reuse the imported ${activeSelectionLabel}.`
          : `Setup loaded.${existingImagesMessage} The file did not include an active ${activeSelectionLabel}.`
      );
    } catch (error) {
      console.error('Failed to load image splitter setup', error);
      alert('Could not read that setup file.');
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(false);
    handleSelectCombinedImages(Array.from(event.dataTransfer.files));
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

  const resolveEditorRegion = (item: SplitPreviewPair): SplitRegionSelection =>
    clampRegionSelection(
      item.manualRegion ??
        (sharedManualRegion
          ? denormalizeSplitRegion(sharedManualRegion, item.sourceWidth, item.sourceHeight)
          : item.suggestedRegion) ??
        createFallbackSplitRegion(item.sourceWidth, item.sourceHeight),
      item.sourceWidth,
      item.sourceHeight
    );

  const resolvePairEditorSelection = (item: SplitPreviewPair): LinkedSplitPairSelection =>
    clampLinkedSplitPairSelection(
      item.manualPairSelection ??
        (sharedManualPair
          ? denormalizeLinkedSplitPairLayout(sharedManualPair, item.sourceWidth, item.sourceHeight)
          : createDefaultLinkedSplitPairSelection(item.sourceWidth, item.sourceHeight)),
      item.sourceWidth,
      item.sourceHeight
    );

  const closeManualEditor = () => {
    editorDragStartRef.current = null;
    setManualEditor(null);
  };

  const closeManualPairEditor = () => {
    pairEditorDragRef.current = null;
    setManualPairEditor(null);
  };

  const handleOpenAreaEditor = (item: SplitPreviewPair) => {
    if (isProcessing) return;

    setManualPairEditor(null);
    setManualEditor({
      pairId: item.id,
      sourceName: item.sourceName,
      sourcePreviewUrl: item.sourcePreviewUrl,
      sourceWidth: item.sourceWidth,
      sourceHeight: item.sourceHeight,
      suggestedRegion: clampRegionSelection(
        (sharedManualRegion
          ? denormalizeSplitRegion(sharedManualRegion, item.sourceWidth, item.sourceHeight)
          : item.suggestedRegion) ?? createFallbackSplitRegion(item.sourceWidth, item.sourceHeight),
        item.sourceWidth,
        item.sourceHeight
      ),
      region: resolveEditorRegion(item)
    });
  };

  const handleOpenPairEditor = (item: SplitPreviewPair) => {
    if (isProcessing) return;

    const nextSelection = resolvePairEditorSelection(item);
    setManualEditor(null);
    setManualPairEditor({
      pairId: item.id,
      sourceName: item.sourceName,
      sourcePreviewUrl: item.sourcePreviewUrl,
      sourceWidth: item.sourceWidth,
      sourceHeight: item.sourceHeight,
      suggestedSelection: nextSelection,
      selection: nextSelection,
      assistResult: null
    });
  };

  const handleOpenEditor = (item: SplitPreviewPair) => {
    if (splitterMode === 'manual_pair') {
      handleOpenPairEditor(item);
      return;
    }
    handleOpenAreaEditor(item);
  };

  const handleResetManualRegion = () => {
    setManualEditor((current) =>
      current
        ? {
            ...current,
            region: current.suggestedRegion
          }
        : current
    );
  };

  const handleResetManualPair = () => {
    setManualPairEditor((current) =>
      current
        ? {
            ...current,
            selection: current.suggestedSelection,
            assistResult: null
          }
        : current
    );
  };

  const handleUseFullImageRegion = () => {
    setManualEditor((current) =>
      current
        ? {
            ...current,
            region: createFallbackSplitRegion(current.sourceWidth, current.sourceHeight)
          }
        : current
    );
  };

  const handleCenterManualPair = () => {
    setManualPairEditor((current) =>
      current
        ? {
            ...current,
            selection: createDefaultLinkedSplitPairSelection(current.sourceWidth, current.sourceHeight),
            assistResult: null
          }
        : current
    );
  };

  const resolvePointerPoint = (
    event: React.PointerEvent<HTMLDivElement>,
    sourceWidth: number,
    sourceHeight: number
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const normalizedX = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
    const normalizedY = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0;

    return {
      x: clampValue(normalizedX * sourceWidth, 0, sourceWidth),
      y: clampValue(normalizedY * sourceHeight, 0, sourceHeight)
    };
  };

  const handleEditorPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!manualEditor || isProcessing) return;

    event.preventDefault();
    const start = resolvePointerPoint(event, manualEditor.sourceWidth, manualEditor.sourceHeight);
    editorDragStartRef.current = start;
    event.currentTarget.setPointerCapture(event.pointerId);
    setManualEditor((current) =>
      current
        ? {
            ...current,
            region: createRegionFromDrag(start, start, current.sourceWidth, current.sourceHeight)
          }
        : current
    );
  };

  const handleEditorPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!manualEditor || !editorDragStartRef.current) return;

    event.preventDefault();
    const end = resolvePointerPoint(event, manualEditor.sourceWidth, manualEditor.sourceHeight);
    const start = editorDragStartRef.current;
    setManualEditor((current) =>
      current
        ? {
            ...current,
            region: createRegionFromDrag(start, end, current.sourceWidth, current.sourceHeight)
          }
        : current
    );
  };

  const releaseEditorPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    editorDragStartRef.current = null;
  };

  const handleEditorPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!editorDragStartRef.current) return;
    releaseEditorPointer(event);
  };

  const handleEditorPointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!editorDragStartRef.current) return;
    releaseEditorPointer(event);
  };

  const handlePairEditorPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!manualPairEditor || isProcessing) return;

    event.preventDefault();
    const point = resolvePointerPoint(event, manualPairEditor.sourceWidth, manualPairEditor.sourceHeight);
    const bounds = getLinkedSplitPairBounds(manualPairEditor.selection);
    const hitBox = pointInBounds(point, bounds.first)
      ? 'first'
      : pointInBounds(point, bounds.second)
        ? 'second'
        : null;

    if (!hitBox) return;

    pairEditorDragRef.current = {
      box: hitBox,
      pointerOffsetX:
        hitBox === 'first'
          ? point.x - bounds.first.x
          : point.x - bounds.second.x,
      pointerOffsetY:
        hitBox === 'first'
          ? point.y - bounds.first.y
          : point.y - bounds.second.y
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePairEditorPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!manualPairEditor || !pairEditorDragRef.current) return;

    event.preventDefault();
    const dragState = pairEditorDragRef.current;
    const point = resolvePointerPoint(event, manualPairEditor.sourceWidth, manualPairEditor.sourceHeight);
    setManualPairEditor((current) => {
      if (!current) return current;

      const nextX =
        dragState.box === 'first'
          ? point.x - dragState.pointerOffsetX
          : point.x - dragState.pointerOffsetX - current.selection.size - current.selection.gap;
      const nextY = point.y - dragState.pointerOffsetY;

      return {
        ...current,
        selection: clampLinkedSplitPairSelection(
          {
            ...current.selection,
            x: nextX,
            y: nextY
          },
          current.sourceWidth,
          current.sourceHeight
        ),
        assistResult: null
      };
    });
  };

  const releasePairEditorPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    pairEditorDragRef.current = null;
  };

  const handlePairEditorPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pairEditorDragRef.current) return;
    releasePairEditorPointer(event);
  };

  const handlePairEditorPointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pairEditorDragRef.current) return;
    releasePairEditorPointer(event);
  };

  const handleManualPairValueChange = (
    field: 'size' | 'gap',
    value: number
  ) => {
    if (!Number.isFinite(value)) return;
    setManualPairEditor((current) =>
      current
        ? {
            ...current,
            selection: clampLinkedSplitPairSelection(
              {
                ...current.selection,
                [field]: value
              },
              current.sourceWidth,
              current.sourceHeight
            ),
            assistResult: null
          }
        : current
    );
  };

  const handleApplyManualRegion = async () => {
    if (!manualEditor || isProcessing) return;

    const nextRegion = clampRegionSelection(
      manualEditor.region,
      manualEditor.sourceWidth,
      manualEditor.sourceHeight
    );
    const normalizedRegion = normalizeSplitRegion(
      nextRegion,
      manualEditor.sourceWidth,
      manualEditor.sourceHeight
    );

    setIsProcessing(true);
    setStatus(`Applying the shared split area to ${splitPairsRef.current.length} image(s)...`);

    try {
      let failed = 0;
      const nextPairs: SplitPreviewPair[] = [];

      for (let index = 0; index < splitPairsRef.current.length; index += 1) {
        const item = splitPairsRef.current[index];
        const appliedRegion = denormalizeSplitRegion(normalizedRegion, item.sourceWidth, item.sourceHeight);
        setStatus(`Applying the shared split area to ${index + 1} of ${splitPairsRef.current.length}: ${item.sourceName}`);

        try {
          const result = await splitCombinedImageFromSelection(item.sourcePreviewUrl, appliedRegion);
          nextPairs.push({
            ...item,
            imageA: result.imageA,
            imageB: result.imageB,
            manualRegion: appliedRegion,
            manualPairSelection: undefined,
            splitMode: 'manual_area'
          });
        } catch (error) {
          failed += 1;
          console.error(`Failed to apply the shared split area for "${item.sourceName}"`, error);
          nextPairs.push(item);
        }
      }

      setSplitPairs(nextPairs);
      setSharedManualRegion(normalizedRegion);
      closeManualEditor();

      if (failed > 0) {
        alert(
          `Applied the shared area to ${nextPairs.length - failed} image(s). ${failed} image(s) kept their previous split.`
        );
      }
    } catch (error) {
      console.error(`Failed to apply manual split for "${manualEditor.sourceName}"`, error);
      alert('Could not apply the shared split area. Drag a region that contains both framed 1:1 images.');
    } finally {
      setIsProcessing(false);
      setStatus('');
    }
  };

  const handleAssistManualPair = async () => {
    if (!manualPairEditor || isProcessing) return;

    setIsProcessing(true);
    setStatus(`Running assist for ${manualPairEditor.sourceName}...`);

    try {
      const result = await assistLinkedSplitPairPlacement(
        manualPairEditor.sourcePreviewUrl,
        manualPairEditor.selection
      );
      setManualPairEditor((current) =>
        current
          ? {
              ...current,
              selection: clampLinkedSplitPairSelection(
                result.selection,
                current.sourceWidth,
                current.sourceHeight
              ),
              assistResult: result
            }
          : current
      );
    } catch (error) {
      console.error(`Failed to assist manual pair for "${manualPairEditor.sourceName}"`, error);
      alert('Assist could not place the diff box automatically. Adjust the gap and try again.');
    } finally {
      setIsProcessing(false);
      setStatus('');
    }
  };

  const handleApplyManualPair = async () => {
    if (!manualPairEditor || isProcessing) return;

    const nextSelection = clampLinkedSplitPairSelection(
      manualPairEditor.selection,
      manualPairEditor.sourceWidth,
      manualPairEditor.sourceHeight
    );
    const normalizedSelection = normalizeLinkedSplitPairLayout(
      nextSelection,
      manualPairEditor.sourceWidth,
      manualPairEditor.sourceHeight
    );

    setIsProcessing(true);
    setStatus(`Applying the shared square pair to ${splitPairsRef.current.length} image(s)...`);

    try {
      let failed = 0;
      const nextPairs: SplitPreviewPair[] = [];

      for (let index = 0; index < splitPairsRef.current.length; index += 1) {
        const item = splitPairsRef.current[index];
        const appliedSelection = denormalizeLinkedSplitPairLayout(
          normalizedSelection,
          item.sourceWidth,
          item.sourceHeight
        );
        setStatus(
          `Applying the shared square pair to ${index + 1} of ${splitPairsRef.current.length}: ${item.sourceName}`
        );

        try {
          const result = await splitCombinedImageFromLinkedSelection(
            item.sourcePreviewUrl,
            appliedSelection
          );
          nextPairs.push({
            ...item,
            imageA: result.imageA,
            imageB: result.imageB,
            manualRegion: undefined,
            manualPairSelection: appliedSelection,
            splitMode: 'manual_pair'
          });
        } catch (error) {
          failed += 1;
          console.error(`Failed to apply the shared square pair for "${item.sourceName}"`, error);
          nextPairs.push(item);
        }
      }

      setSplitPairs(nextPairs);
      setSharedManualPair(normalizedSelection);
      closeManualPairEditor();

      if (failed > 0) {
        alert(
          `Applied the shared square pair to ${nextPairs.length - failed} image(s). ${failed} image(s) kept their previous split.`
        );
      }
    } catch (error) {
      console.error(`Failed to apply manual pair split for "${manualPairEditor.sourceName}"`, error);
      alert('Could not apply the shared square pair. Keep both squares inside the image and try again.');
    } finally {
      setIsProcessing(false);
      setStatus('');
    }
  };

  const handleClearActiveSharedSelection = () => {
    if (isProcessing) return;
    if (splitterMode === 'manual_pair') {
      if (!sharedManualPairRef.current) return;
      setSharedManualPair(null);
      return;
    }

    if (!sharedManualRegionRef.current) return;
    setSharedManualRegion(null);
  };

  const editorRegionStyle = manualEditor
    ? {
        left: `${(manualEditor.region.x / manualEditor.sourceWidth) * 100}%`,
        top: `${(manualEditor.region.y / manualEditor.sourceHeight) * 100}%`,
        width: `${(manualEditor.region.width / manualEditor.sourceWidth) * 100}%`,
        height: `${(manualEditor.region.height / manualEditor.sourceHeight) * 100}%`
      }
    : null;
  const isEditorRegionValid = manualEditor ? manualEditor.region.width >= 64 && manualEditor.region.height >= 64 : false;
  const manualPairBounds = manualPairEditor ? getLinkedSplitPairBounds(manualPairEditor.selection) : null;
  const manualPairFirstStyle =
    manualPairEditor && manualPairBounds
      ? {
          left: `${(manualPairBounds.first.x / manualPairEditor.sourceWidth) * 100}%`,
          top: `${(manualPairBounds.first.y / manualPairEditor.sourceHeight) * 100}%`,
          width: `${(manualPairBounds.first.width / manualPairEditor.sourceWidth) * 100}%`,
          height: `${(manualPairBounds.first.height / manualPairEditor.sourceHeight) * 100}%`
        }
      : null;
  const manualPairSecondStyle =
    manualPairEditor && manualPairBounds
      ? {
          left: `${(manualPairBounds.second.x / manualPairEditor.sourceWidth) * 100}%`,
          top: `${(manualPairBounds.second.y / manualPairEditor.sourceHeight) * 100}%`,
          width: `${(manualPairBounds.second.width / manualPairEditor.sourceWidth) * 100}%`,
          height: `${(manualPairBounds.second.height / manualPairEditor.sourceHeight) * 100}%`
        }
      : null;
  const isManualPairValid = manualPairEditor ? manualPairEditor.selection.size >= 48 : false;
  const isAreaMode = splitterMode === 'shared_area';
  const hasActiveSharedSelection = isAreaMode ? Boolean(sharedManualRegion) : Boolean(sharedManualPair);

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="inline-block -rotate-1 border-4 border-black bg-[#FDE68A] px-4 py-2 text-2xl font-black font-display uppercase tracking-tight text-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] sm:px-6 sm:text-4xl">
          Image Splitter
        </h2>
      </div>

      <div className="bg-white border-4 border-black rounded-2xl shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] p-4 sm:p-6 md:p-8">
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.95fr)] gap-6">
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={`relative border-4 border-dashed border-black rounded-2xl p-5 sm:p-8 text-center transition-colors ${
              isDragActive ? 'bg-[#FEF3C7]' : 'bg-[#FFFDF5]'
            }`}
          >
            <div className="flex flex-col items-center gap-4">
              <div className="w-16 h-16 rounded-full border-4 border-black bg-[#FDE68A] flex items-center justify-center shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                <ImageIcon size={32} strokeWidth={2.5} />
              </div>
              <div className="space-y-1">
                <p className="font-black text-slate-900 uppercase tracking-wide">Drop combined images here</p>
                <p className="font-bold text-slate-600 text-sm">
                  {isAreaMode
                    ? 'Upload the combined images first. Extraction starts only after you set one shared area for the batch.'
                    : 'Upload the combined images first. Extraction starts only after you set one shared linked-square layout for the batch.'}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 text-[11px] font-black uppercase text-slate-700">
                <span className="px-2 py-1 border-2 border-black rounded-full bg-white">PNG</span>
                <span className="px-2 py-1 border-2 border-black rounded-full bg-white">JPG</span>
                <span className="px-2 py-1 border-2 border-black rounded-full bg-white">Batch Ready</span>
              </div>
              <button
                onClick={() => inputRef.current?.click()}
                disabled={isProcessing}
                className={`px-6 py-3 border-2 border-black text-black rounded-xl font-bold transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] inline-flex items-center gap-2 ${
                  isProcessing
                    ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                    : 'bg-white hover:bg-slate-50 hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
                }`}
              >
                <Upload size={20} strokeWidth={2.5} />
                <span>Select Combined Images</span>
              </button>
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => {
                  handleSelectCombinedImages(event.target.files);
                  event.target.value = '';
                }}
              />
              <input
                ref={setupInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(event) => {
                  handleLoadSetup(event.target.files);
                  event.target.value = '';
                }}
              />
            </div>
          </div>

          <div className="min-w-0 border-4 border-black rounded-2xl bg-[#EEF9FF] p-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-black uppercase text-lg">Workflow Snapshot</div>
                <div className="text-[11px] font-bold uppercase text-slate-600">
                  {isAreaMode
                    ? 'Load first, choose one shared area, then split the full batch once.'
                    : 'Load first, place the shared square pair once, then extract the full batch from those exact boxes.'}
                </div>
              </div>
              <div className="px-3 py-1 border-2 border-black rounded-lg bg-white text-xs font-black uppercase">
                {readyPairCount}/{splitPairs.length} Ready
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setSplitterMode('shared_area')}
                disabled={isProcessing}
                className={`px-3 py-3 border-2 border-black rounded-xl text-[11px] font-black uppercase ${
                  splitterMode === 'shared_area' ? 'bg-[#FDE68A]' : 'bg-white hover:bg-slate-100'
                } ${isProcessing ? 'cursor-not-allowed opacity-60' : ''}`}
              >
                Shared Area
              </button>
              <button
                onClick={() => setSplitterMode('manual_pair')}
                disabled={isProcessing}
                className={`px-3 py-3 border-2 border-black rounded-xl text-[11px] font-black uppercase ${
                  splitterMode === 'manual_pair' ? 'bg-[#4ECDC4]' : 'bg-white hover:bg-slate-100'
                } ${isProcessing ? 'cursor-not-allowed opacity-60' : ''}`}
              >
                Manual Pair
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="p-3 border-2 border-black rounded-xl bg-white">
                <div className="text-[11px] font-black uppercase text-slate-500">Loaded</div>
                <div className="text-2xl font-black">{splitPairs.length}</div>
              </div>
              <div className="p-3 border-2 border-black rounded-xl bg-white">
                <div className="text-[11px] font-black uppercase text-slate-500">Ready</div>
                <div className="text-2xl font-black">{readyPairCount}</div>
              </div>
              <div className="p-3 border-2 border-black rounded-xl bg-white">
                <div className="text-[11px] font-black uppercase text-slate-500">Waiting</div>
                <div className="text-2xl font-black">{pendingPairCount}</div>
              </div>
            </div>

            <div className="p-3 border-2 border-black rounded-xl bg-white space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] font-black uppercase text-slate-500">
                    {isAreaMode ? 'Shared Area' : 'Shared Square Pair'}
                  </div>
                  <div className="text-sm font-black">{hasActiveSharedSelection ? 'Active for all images' : 'Not set'}</div>
                </div>
                {hasActiveSharedSelection && (
                  <button
                    onClick={handleClearActiveSharedSelection}
                    disabled={isProcessing}
                    className={`px-3 py-2 border-2 border-black rounded-lg text-[10px] font-black uppercase inline-flex items-center gap-2 ${
                      isProcessing ? 'bg-slate-200 text-slate-500 cursor-not-allowed' : 'bg-white hover:bg-slate-100'
                    }`}
                  >
                    <RefreshCcw size={12} strokeWidth={2.5} />
                    <span>Clear</span>
                  </button>
                )}
              </div>
              <div className="text-xs font-bold text-slate-600">
                {isAreaMode
                  ? hasActiveSharedSelection
                    ? 'New uploads will reuse the same area until you clear it. Frame Extractor aligner uses this saved area too.'
                    : 'Pick one image, draw the area once, and the whole batch will be split from that shared crop.'
                  : hasActiveSharedSelection
                    ? 'New uploads in this session will reuse the same linked square pair until you clear it.'
                    : 'Pick one image, place the two square boxes once, and the whole batch will be extracted from that shared pair.'}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                onClick={handleExportSetup}
                disabled={isProcessing}
                className={`px-3 py-3 border-2 border-black rounded-xl text-[11px] font-black uppercase inline-flex items-center justify-center gap-2 ${
                  isProcessing ? 'bg-slate-200 text-slate-500 cursor-not-allowed' : 'bg-white hover:bg-slate-100'
                }`}
              >
                <Download size={14} strokeWidth={2.5} />
                <span>Export Setup</span>
              </button>
              <button
                onClick={() => setupInputRef.current?.click()}
                disabled={isProcessing}
                className={`px-3 py-3 border-2 border-black rounded-xl text-[11px] font-black uppercase inline-flex items-center justify-center gap-2 ${
                  isProcessing ? 'bg-slate-200 text-slate-500 cursor-not-allowed' : 'bg-white hover:bg-slate-100'
                }`}
              >
                <Upload size={14} strokeWidth={2.5} />
                <span>Load Setup</span>
              </button>
            </div>

            <div className="p-3 border-2 border-black rounded-xl bg-white text-xs font-bold text-slate-600">
              Export saves the current mode, next numbering, shared area, and manual pair layout. Images are not
              included in the setup file.
            </div>

            <div className="p-3 border-2 border-black rounded-xl bg-white space-y-2">
              <div className="text-[11px] font-black uppercase text-slate-500">Naming Preview</div>
              <div className="font-mono text-xs font-bold text-slate-800 break-all">{nextFilenames.puzzleFilename}</div>
              <div className="font-mono text-xs font-bold text-slate-800 break-all">{nextFilenames.diffFilename}</div>
            </div>

            <div className="p-3 border-2 border-black rounded-xl bg-[#FFF7ED] text-xs font-bold text-slate-700">
              {isAreaMode
                ? 'Uploading no longer runs extraction immediately. Use Set Area For All on one reference image, then apply that crop across the full batch.'
                : 'Manual Pair mode crops the exact two square boxes you place. Assist can nudge the diff box by comparing it against the base box before you apply it to the batch.'}
            </div>
          </div>
        </div>

        {(isProcessing || status) && (
          <div className="mt-4 p-3 border-2 border-black rounded-xl bg-[#FFF7ED] font-bold text-sm">
            {status || 'Processing...'}
          </div>
        )}
      </div>

      {splitPairs.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white border-4 border-black rounded-2xl shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] p-4 sm:p-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
            <div>
              <div className="font-black uppercase text-lg">Loaded Images ({splitPairs.length})</div>
              <div className="text-[11px] font-bold uppercase text-slate-600">
                {readyPairCount} ready | {pendingPairCount} waiting for setup | {totalOutputFiles} output file(s)
              </div>
            </div>
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
              <button
                onClick={() => inputRef.current?.click()}
                disabled={isProcessing}
                className={`w-full justify-center px-4 py-2 border-2 border-black rounded-xl font-black text-xs uppercase tracking-wide shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] sm:w-auto ${
                  isProcessing ? 'bg-slate-200 text-slate-500 cursor-not-allowed' : 'bg-white hover:bg-slate-100'
                }`}
              >
                <span className="inline-flex items-center gap-2">
                  <Plus size={16} strokeWidth={2.5} />
                  Add More
                </span>
              </button>
              <button
                onClick={handleDownloadSplitImages}
                disabled={isProcessing || readyPairCount === 0}
                className={`w-full justify-center px-4 py-2 border-2 border-black rounded-xl font-black text-xs uppercase tracking-wide shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] sm:w-auto ${
                  isProcessing || readyPairCount === 0
                    ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                    : 'bg-[#FDE68A] hover:bg-[#FCD34D]'
                }`}
              >
                <span className="inline-flex items-center gap-2">
                  <Download size={16} strokeWidth={2.5} />
                  Download Images
                </span>
              </button>
              <button
                onClick={handleBatchProcess}
                disabled={isProcessing || readyPairCount === 0}
                className={`w-full justify-center px-4 py-2 border-2 border-black rounded-xl font-black text-xs uppercase tracking-wide shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] sm:w-auto ${
                  isProcessing || readyPairCount === 0
                    ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                    : 'bg-[#4ECDC4] hover:bg-[#3DBDB4]'
                }`}
              >
                <span className="inline-flex items-center gap-2">
                  <Layers size={16} strokeWidth={2.5} />
                  Batch Process
                </span>
              </button>
              <button
                onClick={handleClear}
                disabled={isProcessing}
                className={`w-full justify-center px-4 py-2 border-2 border-black rounded-xl font-black text-xs uppercase tracking-wide shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] sm:w-auto ${
                  isProcessing ? 'bg-slate-200 text-slate-500 cursor-not-allowed' : 'bg-white hover:bg-red-50'
                }`}
              >
                <span className="inline-flex items-center gap-2">
                  <Trash2 size={16} strokeWidth={2.5} />
                  Clear
                </span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            {splitPairs.map((item) => {
              const filenames = buildSplitFilenames(item.sequence, namingDefaults);

              return (
                <div
                  key={item.id}
                  className="min-w-0 border-2 border-black rounded-xl bg-[#FFFDF5] p-4 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                    <div className="min-w-0">
                      <div className="font-black text-sm uppercase">Puzzle {item.sequence}</div>
                      <div className="text-xs font-bold text-slate-600 truncate">{item.sourceName}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-black uppercase">
                        <span
                          className={`px-2 py-1 border-2 border-black rounded-full ${
                            item.splitMode === 'manual_area'
                              ? 'bg-[#FDE68A]'
                              : item.splitMode === 'manual_pair'
                                ? 'bg-[#4ECDC4]'
                                : 'bg-white'
                          }`}
                        >
                          {item.splitMode === 'manual_area'
                            ? 'Shared Area'
                            : item.splitMode === 'manual_pair'
                              ? 'Manual Pair'
                              : 'Waiting For Setup'}
                        </span>
                        {item.manualRegion && (
                          <span className="px-2 py-1 border-2 border-black rounded-full bg-white">
                            {item.manualRegion.width}x{item.manualRegion.height}
                          </span>
                        )}
                        {item.manualPairSelection && (
                          <span className="px-2 py-1 border-2 border-black rounded-full bg-white">
                            {item.manualPairSelection.size}px square
                          </span>
                        )}
                        {item.manualPairSelection && (
                          <span className="px-2 py-1 border-2 border-black rounded-full bg-white">
                            gap {item.manualPairSelection.gap}px
                          </span>
                        )}
                      </div>
                      <div className="mt-2 text-[11px] font-mono font-bold text-slate-700 break-all">
                        {filenames.puzzleFilename}
                      </div>
                      <div className="text-[11px] font-mono font-bold text-slate-700 break-all">
                        {filenames.diffFilename}
                      </div>
                    </div>
                    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                      <button
                        onClick={() => handleOpenEditor(item)}
                        disabled={isProcessing}
                        className={`w-full justify-center px-3 py-2 border-2 border-black rounded-lg text-xs font-black uppercase inline-flex items-center gap-2 sm:w-auto ${
                          isProcessing ? 'bg-slate-200 text-slate-500 cursor-not-allowed' : 'bg-white hover:bg-[#EEF9FF]'
                        }`}
                      >
                        <Crop size={14} strokeWidth={2.5} />
                        <span>{isAreaMode ? 'Set Area For All' : 'Set Pair For All'}</span>
                      </button>
                      <button
                        onClick={() => handleDownloadPair(item)}
                        disabled={isProcessing || !isSplitReady(item)}
                        className={`w-full justify-center px-3 py-2 border-2 border-black rounded-lg text-xs font-black uppercase inline-flex items-center gap-2 sm:w-auto ${
                          isProcessing || !isSplitReady(item)
                            ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                            : 'bg-white hover:bg-[#FDE68A]'
                        }`}
                      >
                        <Download size={14} strokeWidth={2.5} />
                        <span>Pair</span>
                      </button>
                      <button
                        onClick={() => handleRemovePair(item.id)}
                        disabled={isProcessing}
                        className={`p-2 border-2 border-black rounded-md ${
                          isProcessing ? 'bg-slate-200 text-slate-500 cursor-not-allowed' : 'bg-white hover:bg-red-50'
                        }`}
                        title="Remove pair"
                      >
                        <Trash2 size={14} strokeWidth={2.5} />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="relative border-2 border-black rounded-lg overflow-hidden bg-white">
                      <img src={item.sourcePreviewUrl} alt={item.baseName} className="w-full h-40 object-contain" />
                      <div className="absolute bottom-1 left-1 text-[10px] uppercase font-bold px-1 py-0.5 bg-black text-white">
                        Combined Source
                      </div>
                    </div>

                    <div className="relative border-2 border-black rounded-lg overflow-hidden bg-white">
                      {item.imageA ? (
                        <img src={item.imageA} alt={`Puzzle ${item.sequence}`} className="w-full h-40 object-contain" />
                      ) : (
                        <div className="flex h-40 items-center justify-center p-4 text-center text-xs font-black uppercase text-slate-500">
                          {isAreaMode ? 'Waiting For Shared Area' : 'Waiting For Shared Pair'}
                        </div>
                      )}
                      <div className="absolute bottom-1 left-1 text-[10px] uppercase font-bold px-1 py-0.5 bg-black text-white">
                        Puzzle
                      </div>
                    </div>

                    <div className="relative border-2 border-black rounded-lg overflow-hidden bg-white">
                      {item.imageB ? (
                        <img
                          src={item.imageB}
                          alt={`Puzzle ${item.sequence} diff`}
                          className="w-full h-40 object-contain"
                        />
                      ) : (
                        <div className="flex h-40 items-center justify-center p-4 text-center text-xs font-black uppercase text-slate-500">
                          {isAreaMode
                            ? 'Apply The Shared Area To Generate This Output'
                            : 'Apply The Shared Pair To Generate This Output'}
                        </div>
                      )}
                      <div className="absolute bottom-1 left-1 text-[10px] uppercase font-bold px-1 py-0.5 bg-[#FF6B6B] border border-black text-black">
                        Puzzle Diff
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      {manualEditor && editorRegionStyle && (
        <div className="fixed inset-0 z-50 bg-black/70 px-3 py-4 sm:px-4 sm:py-6">
          <div className="mx-auto flex h-full max-w-6xl items-center justify-center">
            <div className="w-full max-h-full overflow-auto rounded-2xl border-4 border-black bg-white shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.3fr)_340px]">
                <div className="border-b-4 border-black p-4 sm:p-5 lg:border-b-0 lg:border-r-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-black text-xl uppercase">Shared Split Area</div>
                      <div className="text-xs font-bold text-slate-600">
                        Drag one rectangle around the part that contains both framed 1:1 images. This area will be
                        reused for every loaded image.
                      </div>
                    </div>
                    <div className="px-3 py-1 border-2 border-black rounded-lg bg-[#FDE68A] text-xs font-black uppercase">
                      {manualEditor.sourceWidth}x{manualEditor.sourceHeight}
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border-4 border-black bg-[#FFFDF5] p-3">
                    <div
                      onPointerDown={handleEditorPointerDown}
                      onPointerMove={handleEditorPointerMove}
                      onPointerUp={handleEditorPointerUp}
                      onPointerCancel={handleEditorPointerCancel}
                      className="relative mx-auto w-full max-w-full select-none touch-none overflow-hidden rounded-xl border-2 border-black bg-black/10 cursor-crosshair"
                      style={{ aspectRatio: `${manualEditor.sourceWidth} / ${manualEditor.sourceHeight}` }}
                    >
                      <img
                        src={manualEditor.sourcePreviewUrl}
                        alt={manualEditor.sourceName}
                        className="pointer-events-none absolute inset-0 h-full w-full object-contain"
                        draggable={false}
                      />
                      <div className="pointer-events-none absolute inset-0 bg-black/10" />
                      <div
                        className="pointer-events-none absolute border-[3px] border-black bg-transparent"
                        style={editorRegionStyle}
                      >
                        <div className="absolute left-0 top-0 -translate-y-full border-2 border-black bg-[#FDE68A] px-2 py-1 text-[10px] font-black uppercase">
                          Split Area
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-[#EEF9FF] p-4 sm:p-5 space-y-4">
                  <div className="border-2 border-black rounded-xl bg-white p-3 space-y-1">
                    <div className="text-[11px] font-black uppercase text-slate-500">Selection</div>
                    <div className="font-black text-base">
                      {manualEditor.region.width} x {manualEditor.region.height}px
                    </div>
                    <div className="text-xs font-bold text-slate-600">
                      Origin: {manualEditor.region.x}, {manualEditor.region.y}
                    </div>
                  </div>

                  <div className="border-2 border-black rounded-xl bg-[#FFF7ED] p-3 text-xs font-bold text-slate-700">
                    The crop does not need to be square. It only needs to cover both square frames. The same area will
                    be scaled onto every selected image, then the splitter will re-run inside it.
                  </div>

                  {!isEditorRegionValid && (
                    <div className="border-2 border-black rounded-xl bg-[#FFE4E6] p-3 text-xs font-bold text-slate-700">
                      Drag a larger area before applying. Tiny selections cannot be split reliably.
                    </div>
                  )}

                  <div className="grid gap-2">
                    <button
                      onClick={handleResetManualRegion}
                      disabled={isProcessing}
                      className={`px-4 py-3 border-2 border-black rounded-xl font-black text-xs uppercase ${
                        isProcessing ? 'bg-slate-200 text-slate-500 cursor-not-allowed' : 'bg-white hover:bg-slate-100'
                      }`}
                    >
                      Use Suggested Area
                    </button>
                    <button
                      onClick={handleUseFullImageRegion}
                      disabled={isProcessing}
                      className={`px-4 py-3 border-2 border-black rounded-xl font-black text-xs uppercase ${
                        isProcessing ? 'bg-slate-200 text-slate-500 cursor-not-allowed' : 'bg-white hover:bg-slate-100'
                      }`}
                    >
                      Use Full Image
                    </button>
                  </div>

                  <div className="grid gap-2 pt-2">
                    <button
                      onClick={handleApplyManualRegion}
                      disabled={isProcessing || !isEditorRegionValid}
                      className={`px-4 py-3 border-2 border-black rounded-xl font-black text-xs uppercase shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] ${
                        isProcessing || !isEditorRegionValid
                          ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                          : 'bg-[#FDE68A] hover:bg-[#FCD34D]'
                      }`}
                    >
                      Apply To All Images
                    </button>
                    <button
                      onClick={closeManualEditor}
                      disabled={isProcessing}
                      className={`px-4 py-3 border-2 border-black rounded-xl font-black text-xs uppercase ${
                        isProcessing ? 'bg-slate-200 text-slate-500 cursor-not-allowed' : 'bg-white hover:bg-slate-100'
                      }`}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {manualPairEditor && manualPairFirstStyle && manualPairSecondStyle && (
        <div className="fixed inset-0 z-50 bg-black/70 px-3 py-4 sm:px-4 sm:py-6">
          <div className="mx-auto flex h-full max-w-6xl items-center justify-center">
            <div className="w-full max-h-full overflow-auto rounded-2xl border-4 border-black bg-white shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.3fr)_360px]">
                <div className="border-b-4 border-black p-4 sm:p-5 lg:border-b-0 lg:border-r-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-black text-xl uppercase">Manual Square Pair</div>
                      <div className="text-xs font-bold text-slate-600">
                        Drag either square to move the linked pair. Both boxes stay 1:1, share the
                        same size, and stay on the same row.
                      </div>
                    </div>
                    <div className="px-3 py-1 border-2 border-black rounded-lg bg-[#4ECDC4] text-xs font-black uppercase">
                      {manualPairEditor.sourceWidth}x{manualPairEditor.sourceHeight}
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border-4 border-black bg-[#FFFDF5] p-3">
                    <div
                      onPointerDown={handlePairEditorPointerDown}
                      onPointerMove={handlePairEditorPointerMove}
                      onPointerUp={handlePairEditorPointerUp}
                      onPointerCancel={handlePairEditorPointerCancel}
                      className="relative mx-auto w-full max-w-full select-none touch-none overflow-hidden rounded-xl border-2 border-black bg-black/10"
                      style={{ aspectRatio: `${manualPairEditor.sourceWidth} / ${manualPairEditor.sourceHeight}` }}
                    >
                      <img
                        src={manualPairEditor.sourcePreviewUrl}
                        alt={manualPairEditor.sourceName}
                        className="pointer-events-none absolute inset-0 h-full w-full object-contain"
                        draggable={false}
                      />
                      <div className="pointer-events-none absolute inset-0 bg-black/10" />
                      <div
                        className="absolute border-[3px] border-black bg-transparent"
                        style={manualPairFirstStyle}
                      >
                        <div className="absolute left-0 top-0 -translate-y-full border-2 border-black bg-[#FDE68A] px-2 py-1 text-[10px] font-black uppercase">
                          Puzzle
                        </div>
                      </div>
                      <div
                        className="absolute border-[3px] border-black bg-transparent"
                        style={manualPairSecondStyle}
                      >
                        <div className="absolute left-0 top-0 -translate-y-full border-2 border-black bg-[#FFB6C1] px-2 py-1 text-[10px] font-black uppercase">
                          Diff
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-[#EEF9FF] p-4 sm:p-5 space-y-4">
                  <div className="border-2 border-black rounded-xl bg-white p-3 space-y-1">
                    <div className="text-[11px] font-black uppercase text-slate-500">Selection</div>
                    <div className="font-black text-base">
                      {manualPairEditor.selection.size}px square
                    </div>
                    <div className="text-xs font-bold text-slate-600">
                      Base origin: {manualPairEditor.selection.x}, {manualPairEditor.selection.y}
                    </div>
                    <div className="text-xs font-bold text-slate-600">
                      Gap: {manualPairEditor.selection.gap}px
                    </div>
                  </div>

                  <div className="border-2 border-black rounded-xl bg-[#FFF7ED] p-3 text-xs font-bold text-slate-700">
                    Manual Pair mode crops the exact two squares you place. Assist compares the diff
                    box against the puzzle box and nudges the diff box horizontally using detected
                    translation data.
                  </div>

                  {manualPairEditor.assistResult && (
                    <div className="border-2 border-black rounded-xl bg-white p-3 text-xs font-bold text-slate-700">
                      Assist shift: dx {manualPairEditor.assistResult.dx >= 0 ? '+' : ''}
                      {manualPairEditor.assistResult.dx}px, dy{' '}
                      {manualPairEditor.assistResult.dy >= 0 ? '+' : ''}
                      {manualPairEditor.assistResult.dy}px, score {manualPairEditor.assistResult.score}.
                      The editor keeps both boxes on the same row, so only the horizontal placement
                      is applied visually.
                    </div>
                  )}

                  {!isManualPairValid && (
                    <div className="border-2 border-black rounded-xl bg-[#FFE4E6] p-3 text-xs font-bold text-slate-700">
                      Increase the square size before applying. Tiny crops are not useful.
                    </div>
                  )}

                  <label className="block border-2 border-black rounded-xl bg-white p-3 space-y-2">
                    <div className="text-[11px] font-black uppercase text-slate-500">Square Size</div>
                    <input
                      type="range"
                      min="48"
                      max={Math.max(48, Math.min(manualPairEditor.sourceWidth, manualPairEditor.sourceHeight))}
                      step="1"
                      value={manualPairEditor.selection.size}
                      onChange={(event) => handleManualPairValueChange('size', Number(event.target.value))}
                      disabled={isProcessing}
                      className="w-full"
                    />
                    <input
                      type="number"
                      min="48"
                      max={Math.max(48, Math.min(manualPairEditor.sourceWidth, manualPairEditor.sourceHeight))}
                      step="1"
                      value={manualPairEditor.selection.size}
                      onChange={(event) => handleManualPairValueChange('size', Number(event.target.value))}
                      disabled={isProcessing}
                      className="w-full rounded-lg border-2 border-black px-3 py-2 text-sm font-black"
                    />
                  </label>

                  <label className="block border-2 border-black rounded-xl bg-white p-3 space-y-2">
                    <div className="text-[11px] font-black uppercase text-slate-500">Gap Between Boxes</div>
                    <input
                      type="range"
                      min="0"
                      max={Math.max(0, manualPairEditor.sourceWidth - manualPairEditor.selection.size * 2)}
                      step="1"
                      value={manualPairEditor.selection.gap}
                      onChange={(event) => handleManualPairValueChange('gap', Number(event.target.value))}
                      disabled={isProcessing}
                      className="w-full"
                    />
                    <input
                      type="number"
                      min="0"
                      max={Math.max(0, manualPairEditor.sourceWidth - manualPairEditor.selection.size * 2)}
                      step="1"
                      value={manualPairEditor.selection.gap}
                      onChange={(event) => handleManualPairValueChange('gap', Number(event.target.value))}
                      disabled={isProcessing}
                      className="w-full rounded-lg border-2 border-black px-3 py-2 text-sm font-black"
                    />
                  </label>

                  <div className="grid gap-2">
                    <button
                      onClick={handleResetManualPair}
                      disabled={isProcessing}
                      className={`px-4 py-3 border-2 border-black rounded-xl font-black text-xs uppercase ${
                        isProcessing ? 'bg-slate-200 text-slate-500 cursor-not-allowed' : 'bg-white hover:bg-slate-100'
                      }`}
                    >
                      Reset Pair
                    </button>
                    <button
                      onClick={handleCenterManualPair}
                      disabled={isProcessing}
                      className={`px-4 py-3 border-2 border-black rounded-xl font-black text-xs uppercase ${
                        isProcessing ? 'bg-slate-200 text-slate-500 cursor-not-allowed' : 'bg-white hover:bg-slate-100'
                      }`}
                    >
                      Center Pair
                    </button>
                    <button
                      onClick={handleAssistManualPair}
                      disabled={isProcessing || !isManualPairValid}
                      className={`px-4 py-3 border-2 border-black rounded-xl font-black text-xs uppercase ${
                        isProcessing || !isManualPairValid
                          ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                          : 'bg-[#DBEAFE] hover:bg-[#BFDBFE]'
                      }`}
                    >
                      Assist Placement
                    </button>
                  </div>

                  <div className="grid gap-2 pt-2">
                    <button
                      onClick={handleApplyManualPair}
                      disabled={isProcessing || !isManualPairValid}
                      className={`px-4 py-3 border-2 border-black rounded-xl font-black text-xs uppercase shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] ${
                        isProcessing || !isManualPairValid
                          ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                          : 'bg-[#4ECDC4] hover:bg-[#3DBDB4]'
                      }`}
                    >
                      Apply To All Images
                    </button>
                    <button
                      onClick={closeManualPairEditor}
                      disabled={isProcessing}
                      className={`px-4 py-3 border-2 border-black rounded-xl font-black text-xs uppercase ${
                        isProcessing ? 'bg-slate-200 text-slate-500 cursor-not-allowed' : 'bg-white hover:bg-slate-100'
                      }`}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
