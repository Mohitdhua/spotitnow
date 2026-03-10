import {
  readSplitterNextSequence,
  setSplitterNextSequence,
  type SplitterDefaults,
  type SplitterSharedRegion
} from './appSettings';
import { extractFrames, type ExtractFramesSummary, type ParsedTimestamp } from './frameExtractor';
import { dataUrlToPngBlob, readFileAsDataUrl, splitCombinedImageFromSelection } from './imageSplitter';

export interface FrameAutoAlignerProgress {
  stage: 'extracting' | 'splitting';
  progress: number;
  label: string;
}

export interface FrameAutoAlignerResult {
  extractionSummary: ExtractFramesSummary;
  extractedFrameCount: number;
  preparedPairCount: number;
  skippedFrameCount: number;
  warnings: string[];
  files: File[];
}

interface RunFrameAutoAlignerOptions {
  videos: File[];
  timestamps: ParsedTimestamp[];
  format: 'jpeg' | 'png';
  jpegQuality: number;
  splitterDefaults: SplitterDefaults;
  sharedRegion: SplitterSharedRegion;
  onProgress?: (progress: FrameAutoAlignerProgress) => void;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const mapProgress = (ratio: number, start: number, end: number) =>
  start + clamp(ratio, 0, 1) * (end - start);

const sanitizePrefix = (value: string) => {
  const cleaned = value.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '').replace(/\s+/g, '');
  return cleaned || 'puzzle';
};

const buildSplitFilename = (
  sequence: number,
  splitterDefaults: SplitterDefaults,
  isDiff: boolean
) => {
  const prefix = sanitizePrefix(splitterDefaults.filenamePrefix);
  const padDigits = Math.max(0, Math.floor(splitterDefaults.filenamePadDigits || 0));
  const serial = padDigits > 0 ? String(sequence).padStart(padDigits, '0') : String(sequence);
  return `${prefix}${serial}${isDiff ? 'diff' : ''}.png`;
};

const buildSplitFilenames = (sequence: number, splitterDefaults: SplitterDefaults) => ({
  puzzleFilename: buildSplitFilename(sequence, splitterDefaults, false),
  diffFilename: buildSplitFilename(sequence, splitterDefaults, true)
});

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

const clampRegionSelection = (
  region: SplitterSharedRegion,
  sourceWidth: number,
  sourceHeight: number
) => {
  const maxWidth = Math.max(1, Math.floor(sourceWidth));
  const maxHeight = Math.max(1, Math.floor(sourceHeight));
  const x = clamp(Math.floor(region.x * sourceWidth), 0, maxWidth - 1);
  const y = clamp(Math.floor(region.y * sourceHeight), 0, maxHeight - 1);
  const right = clamp(Math.ceil((region.x + region.width) * sourceWidth), x + 1, maxWidth);
  const bottom = clamp(Math.ceil((region.y + region.height) * sourceHeight), y + 1, maxHeight);

  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y)
  };
};

export const runFrameAutoAligner = async ({
  videos,
  timestamps,
  format,
  jpegQuality,
  splitterDefaults,
  sharedRegion,
  onProgress
}: RunFrameAutoAlignerOptions): Promise<FrameAutoAlignerResult> => {
  const extracted = await extractFrames({
    videos,
    timestamps,
    format,
    jpegQuality,
    onProgress: (progress) => {
      const ratio = progress.total > 0 ? progress.completed / progress.total : 0;
      onProgress?.({
        stage: 'extracting',
        progress: mapProgress(ratio, 0, 0.42),
        label: progress.label
      });
    }
  });

  const warnings = [...extracted.summary.warnings];
  const files: File[] = [];
  const startingSequence = readSplitterNextSequence();
  let preparedPairCount = 0;

  for (let index = 0; index < extracted.files.length; index += 1) {
    const item = extracted.files[index];
    onProgress?.({
      stage: 'splitting',
      progress: mapProgress((index + 1) / Math.max(1, extracted.files.length), 0.42, 1),
      label: `Preparing split pair ${index + 1}/${extracted.files.length}: ${item.filename}`
    });

    try {
      const sourceFile = new File([item.blob], item.filename, {
        type: item.blob.type || 'image/png',
        lastModified: Date.now()
      });
      const sourceUrl = await readFileAsDataUrl(sourceFile);
      const { width, height } = await readImageSize(sourceUrl);
      const splitSelection = clampRegionSelection(sharedRegion, width, height);
      const split = await splitCombinedImageFromSelection(sourceUrl, splitSelection);
      const filenames = buildSplitFilenames(startingSequence + preparedPairCount, splitterDefaults);
      const [puzzleBlob, diffBlob] = await Promise.all([
        dataUrlToPngBlob(split.imageA),
        dataUrlToPngBlob(split.imageB)
      ]);

      files.push(new File([puzzleBlob], filenames.puzzleFilename, { type: 'image/png' }));
      files.push(new File([diffBlob], filenames.diffFilename, { type: 'image/png' }));
      preparedPairCount += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown split error.';
      warnings.push(`${item.filename}: failed to apply the saved split area (${message})`);
    }
  }

  if (preparedPairCount > 0) {
    setSplitterNextSequence(startingSequence + preparedPairCount);
  }

  return {
    extractionSummary: extracted.summary,
    extractedFrameCount: extracted.files.length,
    preparedPairCount,
    skippedFrameCount: Math.max(0, extracted.files.length - preparedPairCount),
    warnings,
    files
  };
};
