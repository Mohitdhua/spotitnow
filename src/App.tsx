/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Plus,
  Upload,
  Gamepad2,
  Download,
  Layers,
  PlaySquare,
  Video,
  LoaderCircle,
  Scissors,
  Camera,
  ImagePlus,
  Sparkles,
  Settings,
  Menu,
  X,
  type LucideIcon
} from 'lucide-react';
import { ImageUploader } from './components/ImageUploader';
import { EditorCanvas } from './components/EditorCanvas';
import { GameCanvas } from './components/GameCanvas';
import { VideoSettingsPanel } from './components/VideoSettingsPanel';
import { VideoPlayer } from './components/VideoPlayer'; // Assuming you created this file
import { OverlayVideoEditor } from './components/OverlayVideoEditor';
import { ImageSplitterPanel } from './components/ImageSplitterPanel';
import { ImageUpscalerMode } from './components/ImageUpscalerMode';
import { ProgressBarMode } from './components/ProgressBarMode';
import { FrameExtractorMode } from './components/FrameExtractorMode';
import { WatermarkRemovalMode } from './components/WatermarkRemovalMode';
import { AppSettingsModal } from './components/AppSettingsModal';
import { ProcessingMode, Puzzle, PuzzleSet, GameMode, Region, VideoSettings, VideoModeTransferFrame } from './types';
import { cancelVideoExport, exportVideoWithWebCodecs } from './services/videoExport';
import { cancelOverlayBatchExport, exportOverlayBatchWithWebCodecs } from './services/overlayVideoExport';
import { cancelSuperImageExport } from './services/superExport';
import {
  AppGlobalSettings,
  loadAppGlobalSettings,
  resetAppGlobalSettings,
  saveAppGlobalSettings,
  saveSplitterMode
} from './services/appSettings';
import { saveGameAudioMuted } from './services/gameAudio';
import {
  applyAppSettingsTransferBundle,
  createAppSettingsTransferBundle
} from './services/settingsTransfer';

const TRANSFER_FRAME_SIZE: Record<VideoSettings['aspectRatio'], { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1200, height: 1200 },
  '4:3': { width: 1440, height: 1080 }
};

const loadImageForTransfer = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load transfer image.'));
    image.src = src;
  });

const drawContain = (
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number
) => {
  const sourceWidth = Math.max(1, image.naturalWidth);
  const sourceHeight = Math.max(1, image.naturalHeight);
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const drawX = x + (width - drawWidth) / 2;
  const drawY = y + (height - drawHeight) / 2;
  ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
};

const createSideBySideTransferFrame = async (
  puzzle: Puzzle,
  aspectRatio: VideoSettings['aspectRatio']
): Promise<string> => {
  const [originalImage, modifiedImage] = await Promise.all([
    loadImageForTransfer(puzzle.imageA),
    loadImageForTransfer(puzzle.imageB)
  ]);
  const size = TRANSFER_FRAME_SIZE[aspectRatio];
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to create transfer frame canvas.');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size.width, size.height);

  const padding = Math.round(size.width * 0.008);
  const gap = Math.round(size.width * 0.008);
  const panelWidth = Math.max(1, (size.width - padding * 2 - gap) / 2);
  const panelHeight = Math.max(1, size.height - padding * 2);
  const leftX = padding;
  const rightX = leftX + panelWidth + gap;
  const topY = padding;

  ctx.fillStyle = '#f1f5f9';
  ctx.fillRect(leftX, topY, panelWidth, panelHeight);
  ctx.fillRect(rightX, topY, panelWidth, panelHeight);
  drawContain(ctx, originalImage, leftX, topY, panelWidth, panelHeight);
  drawContain(ctx, modifiedImage, rightX, topY, panelWidth, panelHeight);

  ctx.strokeStyle = '#000000';
  ctx.lineWidth = Math.max(2, Math.round(size.width * 0.002));
  ctx.strokeRect(leftX, topY, panelWidth, panelHeight);
  ctx.strokeRect(rightX, topY, panelWidth, panelHeight);

  return canvas.toDataURL('image/png');
};

type AppMode = GameMode | 'home';

interface QuickNavItem {
  id: AppMode;
  label: string;
  icon: LucideIcon;
  requiresBatch?: boolean;
}

const QUICK_NAV_ITEMS: QuickNavItem[] = [
  { id: 'home', label: 'Home', icon: Gamepad2 },
  { id: 'upload', label: 'Upload', icon: Plus },
  { id: 'video_setup', label: 'Video', icon: Video, requiresBatch: true },
  { id: 'overlay_editor', label: 'Overlay', icon: PlaySquare },
  { id: 'splitter', label: 'Splitter', icon: Scissors },
  { id: 'image_upscaler', label: 'Upscaler', icon: Sparkles },
  { id: 'progress_bar', label: 'Progress', icon: LoaderCircle },
  { id: 'frame_extractor', label: 'Frames', icon: Camera },
  { id: 'watermark_removal', label: 'Watermark', icon: ImagePlus }
];

const KNOWN_APP_MODES: AppMode[] = [
  'home',
  'upload',
  'splitter',
  'image_upscaler',
  'frame_extractor',
  'edit',
  'play',
  'video_setup',
  'video_play',
  'overlay_editor',
  'progress_bar',
  'watermark_removal'
];

const HISTORY_STATE_KEY = '__spotdiff_nav';

const isKnownAppMode = (value: unknown): value is AppMode =>
  typeof value === 'string' && KNOWN_APP_MODES.includes(value as AppMode);

const getModeLabel = (value: AppMode): string => {
  switch (value) {
    case 'home':
      return 'Home';
    case 'upload':
      return 'Upload';
    case 'splitter':
      return 'Image Splitter';
    case 'image_upscaler':
      return 'Image Upscaler';
    case 'frame_extractor':
      return 'Frame Extractor';
    case 'edit':
      return 'Editor';
    case 'play':
      return 'Play';
    case 'video_setup':
      return 'Video Setup';
    case 'video_play':
      return 'Video Preview';
    case 'overlay_editor':
      return 'Overlay Editor';
    case 'progress_bar':
      return 'Progress Bar';
    case 'watermark_removal':
      return 'Watermark Removal';
    default:
      return 'Mode';
  }
};

const INITIAL_MODE_MOUNTED_STATE: Record<AppMode, boolean> = {
  home: true,
  upload: false,
  splitter: false,
  image_upscaler: false,
  frame_extractor: false,
  edit: false,
  play: false,
  video_setup: false,
  video_play: false,
  overlay_editor: false,
  progress_bar: false,
  watermark_removal: false
};

const PERSISTENT_MODES: AppMode[] = [
  'upload',
  'splitter',
  'image_upscaler',
  'frame_extractor',
  'edit',
  'video_setup',
  'overlay_editor',
  'progress_bar',
  'watermark_removal'
];

const isPersistentMode = (value: AppMode) => PERSISTENT_MODES.includes(value);

export default function App() {
  const [appDefaults, setAppDefaults] = useState<AppGlobalSettings>(() => loadAppGlobalSettings());
  const [mode, setMode] = useState<AppMode>('home');
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [batch, setBatch] = useState<Puzzle[]>([]);
  const [playIndex, setPlayIndex] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isExportingVideo, setIsExportingVideo] = useState(false);
  const [videoExportProgress, setVideoExportProgress] = useState(0);
  const [videoExportStatus, setVideoExportStatus] = useState('');
  const [isOverlayExporting, setIsOverlayExporting] = useState(false);
  const [overlayExportProgress, setOverlayExportProgress] = useState(0);
  const [overlayExportStatus, setOverlayExportStatus] = useState('');
  const [isSuperImageExporting, setIsSuperImageExporting] = useState(false);
  const [superImageExportProgress, setSuperImageExportProgress] = useState(0);
  const [superImageExportStatus, setSuperImageExportStatus] = useState('');
  const [incomingVideoFrames, setIncomingVideoFrames] = useState<VideoModeTransferFrame[]>([]);
  const [incomingVideoFramesSessionId, setIncomingVideoFramesSessionId] = useState(0);
  const [injectedUploadFiles, setInjectedUploadFiles] = useState<File[] | null>(null);
  const [injectedUploadProcessingMode, setInjectedUploadProcessingMode] = useState<ProcessingMode | null>(null);
  const [injectedUploadFilesSessionId, setInjectedUploadFilesSessionId] = useState(0);
  const isHandlingPopStateRef = useRef(false);
  const [modeMountedState, setModeMountedState] = useState<Record<AppMode, boolean>>(INITIAL_MODE_MOUNTED_STATE);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMobileHeaderOpen, setIsMobileHeaderOpen] = useState(false);
  const [frameDefaultsSessionId, setFrameDefaultsSessionId] = useState(0);
  const [splitterDefaultsSessionId, setSplitterDefaultsSessionId] = useState(0);
  
  // Default Video Settings
  const [videoSettings, setVideoSettings] = useState<VideoSettings>(() => appDefaults.videoDefaults);

  const createRawVideoFramesPayload = useCallback(
    async (sourcePuzzles: Puzzle[]): Promise<VideoModeTransferFrame[]> => {
      const showDurationSeconds = Math.max(0.1, videoSettings.showDuration);
      const revealDurationSeconds = Math.max(0.5, videoSettings.revealDuration);
      const transitionDurationSeconds = Math.max(0, videoSettings.transitionDuration);
      let timelineCursorMs = 0;

      const frames: VideoModeTransferFrame[] = [];
      for (let index = 0; index < sourcePuzzles.length; index += 1) {
        const item = sourcePuzzles[index];
        const clipDurationSeconds =
          showDurationSeconds +
          revealDurationSeconds +
          (index < sourcePuzzles.length - 1 ? transitionDurationSeconds : 0);
        const title = (item.title || '').trim() || `Puzzle ${index + 1}`;
        let compositeImage = item.imageB;
        try {
          compositeImage = await createSideBySideTransferFrame(item, videoSettings.aspectRatio);
        } catch {
          // Fallback to modified image if composite generation fails.
        }
        const frame: VideoModeTransferFrame = {
          id: `video-mode-frame-${Date.now()}-${index}`,
          clipId: `puzzle-${index + 1}`,
          name: `${title}.png`,
          image: compositeImage,
          frame: index,
          timeMs: Math.round(timelineCursorMs),
          durationMs: Math.max(100, Math.round(clipDurationSeconds * 1000)),
          position: {
            x: 0,
            y: 0,
            width: 1,
            height: 1
          },
          rotation: 0,
          scale: 1
        };
        timelineCursorMs += clipDurationSeconds * 1000;
        frames.push(frame);
      }
      return frames;
    },
    [
      videoSettings.aspectRatio,
      videoSettings.showDuration,
      videoSettings.revealDuration,
      videoSettings.transitionDuration
    ]
  );

  const handleSendRawFramesToOverlayEditor = useCallback(async () => {
    if (!batch.length) {
      alert('Add at least one puzzle first.');
      return;
    }
    const payload = await createRawVideoFramesPayload(batch);
    setIncomingVideoFrames(payload);
    setIncomingVideoFramesSessionId((current) => current + 1);
    setMode('overlay_editor');
  }, [batch, createRawVideoFramesPayload]);

  const handleImagesSelected = (imageA: string, imageB: string, regions: Region[] = []) => {
    const newPuzzle: Puzzle = {
      imageA,
      imageB,
      regions,
      title: 'Auto-Generated Puzzle'
    };

    setPuzzle(newPuzzle);
    
    // If regions are detected (which they should be now), go straight to play mode
    if (regions.length > 0) {
      setBatch([newPuzzle]);
      setPlayIndex(0);
      setMode('play');
    } else {
      // Fallback to edit if no regions found (shouldn't happen with new logic)
      setMode('edit');
    }
  };

  const handleBatchSelected = (newPuzzles: Puzzle[]) => {
    const updatedBatch = [...batch, ...newPuzzles];
    setBatch(updatedBatch);
    
    if (batch.length === 0 && newPuzzles.length > 0) {
      setPuzzle(newPuzzles[0]);
      setMode('play'); // Auto-play first puzzle
      setPlayIndex(0);
    } else {
      alert(`Added ${newPuzzles.length} puzzles to batch!`);
    }
  };

  const handleOpenVideoModeWithPuzzles = useCallback((newPuzzles: Puzzle[]) => {
    if (!newPuzzles.length) {
      alert('Add at least one puzzle first.');
      return;
    }
    setBatch(newPuzzles);
    setPuzzle(newPuzzles[0]);
    setPlayIndex(0);
    setMode('video_setup');
  }, []);

  const handleSavePuzzle = (updatedPuzzle: Puzzle) => {
    // If we have a batch, save the whole batch including this one
    // If it's just one, save just one
    const finalBatch = [...batch, updatedPuzzle];
    
    if (finalBatch.length === 1) {
      downloadJSON(updatedPuzzle, 'puzzle.json');
    } else {
      const puzzleSet: PuzzleSet = {
        title: 'My Puzzle Batch',
        version: 1,
        puzzles: finalBatch
      };
      downloadJSON(puzzleSet, 'puzzle-batch.json');
    }
  };

  const handleAddToBatch = (newPuzzle: Puzzle) => {
    setBatch([...batch, newPuzzle]);
    setPuzzle(null);
    setMode('upload');
  };

  const handleOpenUploadWithInjectedFiles = useCallback((files: File[], processingMode: ProcessingMode | null = null) => {
    if (!files.length) {
      alert('No split images available for batch processing.');
      return;
    }
    setBatch([]);
    setPuzzle(null);
    setPlayIndex(0);
    setInjectedUploadFiles(files);
    setInjectedUploadProcessingMode(processingMode);
    setInjectedUploadFilesSessionId((current) => current + 1);
    setMode('upload');
  }, []);

  const handleInjectedFilesHandled = useCallback(() => {
    setInjectedUploadFiles(null);
    setInjectedUploadProcessingMode(null);
  }, []);

  const downloadJSON = (data: any, filename: string) => {
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a); // Required for some browsers/environments
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handlePlayPuzzle = (readyPuzzle: Puzzle) => {
    // If playing from editor, it's a single puzzle test
    setBatch([readyPuzzle]);
    setPlayIndex(0);
    setPuzzle(readyPuzzle);
    setMode('play');
  };

  const handleOpenVideoModeFromEditor = useCallback((readyPuzzle: Puzzle) => {
    setBatch((current) => {
      const existingIndex = current.findIndex(
        (item) => item.imageA === readyPuzzle.imageA && item.imageB === readyPuzzle.imageB
      );
      if (existingIndex >= 0) {
        const next = [...current];
        next[existingIndex] = readyPuzzle;
        return next;
      }
      return [...current, readyPuzzle];
    });
    setPuzzle(readyPuzzle);
    setPlayIndex(0);
    setMode('video_setup');
  }, []);

  const handleLoadPuzzle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          if (event.target?.result) {
            const json = JSON.parse(event.target.result as string);
            
            // Check if it's a batch (PuzzleSet) or single Puzzle
            if (json.puzzles && Array.isArray(json.puzzles)) {
              setBatch(json.puzzles);
              setPlayIndex(0);
              setPuzzle(json.puzzles[0]);
              // Ask user mode preference if batch loaded? For now default to play, but maybe show options?
              // Let's stick to 'play' default, but add button in Home to switch to Video Setup if batch exists.
              setMode('play');
            } else if (Array.isArray(json)) {
              // Handle raw array of puzzles
              setBatch(json);
              setPlayIndex(0);
              setPuzzle(json[0]);
              setMode('play');
            } else if (json.imageA && json.imageB) {
              // Single puzzle
              setBatch([json]);
              setPlayIndex(0);
              setPuzzle(json);
              setMode('play');
            } else {
              alert('Invalid puzzle file format');
            }
          }
        } catch (err) {
          alert('Failed to parse puzzle file');
        }
      };
      reader.readAsText(file);
    }
  };

  const handleNextLevel = useCallback(() => {
    if (playIndex < batch.length - 1) {
      setPlayIndex(prev => prev + 1);
      setPuzzle(batch[playIndex + 1]);
    } else {
      setMode('home');
    }
  }, [playIndex, batch]);

  const handleGoHome = useCallback(() => {
    setMode('home');
  }, []);

  const handleQuickNavigate = useCallback(
    (targetMode: AppMode) => {
      if (targetMode === 'video_setup' && batch.length === 0) {
        alert('Load or create at least one puzzle before opening Video Setup.');
        return;
      }
      if (targetMode === 'video_play' && batch.length === 0) {
        alert('Load or create at least one puzzle before starting video preview.');
        return;
      }
      if (targetMode === 'play' && !puzzle && batch.length === 0) {
        alert('Load or create a puzzle first.');
        return;
      }
      if (targetMode === 'video_setup') {
        setPlayIndex(0);
        if (batch[0]) {
          setPuzzle(batch[0]);
        }
      }
      setMode(targetMode);
    },
    [batch, puzzle]
  );

  const handleExit = () => {
    if (batch.length > 0 && mode !== 'play' && mode !== 'video_play' && !window.confirm('You have unsaved puzzles in your batch. Are you sure you want to exit? All progress will be lost.')) {
      return;
    }
    setMode('home');
    setBatch([]);
    setPuzzle(null);
    setPlayIndex(0);
    setInjectedUploadFiles(null);
    setModeMountedState(INITIAL_MODE_MOUNTED_STATE);
  };

  const handleExportVideo = useCallback(async () => {
    if (batch.length === 0) {
      alert('Add or load at least one puzzle before exporting.');
      return;
    }
    if (isOverlayExporting || isSuperImageExporting) {
      alert('Another export is already running. Please wait or cancel it first.');
      return;
    }
    if (isExportingVideo) return;

    try {
      setIsExportingVideo(true);
      setVideoExportProgress(0);
      setVideoExportStatus('Preparing export...');

      await exportVideoWithWebCodecs({
        puzzles: batch,
        settings: videoSettings,
        onProgress: (progress, label) => {
          setVideoExportProgress(progress);
          if (label) setVideoExportStatus(label);
        }
      });

      setVideoExportProgress(1);
      setVideoExportStatus('Export complete');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Export failed. Please try different codec/resolution settings.';
      if (message === 'Export canceled') {
        setVideoExportStatus('Export canceled');
        setVideoExportProgress(0);
      } else {
        setVideoExportStatus('');
        alert(message);
      }
    } finally {
      setIsExportingVideo(false);
    }
  }, [batch, videoSettings, isExportingVideo, isOverlayExporting, isSuperImageExporting]);

  const handleCancelVideoExport = useCallback(() => {
    cancelVideoExport();
  }, []);

  const handleOverlayBatchExport = useCallback(
    async (payload: {
      editorMode?: 'standard' | 'linked_pairs';
      base: {
        mode: 'video' | 'photo' | 'color';
        color: string;
        aspectRatio: number;
        durationSeconds: number;
        videoFile?: File;
        photoFile?: File;
      };
      batchPhotos: Array<{
        id: string;
        name: string;
        kind: 'image';
        file: File;
        transform: { x: number; y: number; width: number; height: number };
        crop: { x: number; y: number; width: number; height: number };
        background: { enabled: boolean; color: string };
        chromaKey: { enabled: boolean; color: string; similarity: number; smoothness: number };
        timeline: { start: number; end: number };
      }>;
      overlays: Array<{
        id: string;
        name: string;
        kind: 'image' | 'video';
        file: File;
        transform: { x: number; y: number; width: number; height: number };
        crop: { x: number; y: number; width: number; height: number };
        background: { enabled: boolean; color: string };
        chromaKey: { enabled: boolean; color: string; similarity: number; smoothness: number };
        timeline: { start: number; end: number };
      }>;
      linkedPairs?: Array<{
        id: string;
        name: string;
        puzzleFile: File;
        diffFile: File;
      }>;
      linkedPairLayout?: {
        x: number;
        y: number;
        size: number;
        gap: number;
      };
      linkedPairStyle?: {
        outlineColor: string;
        outlineWidth: number;
        cornerRadius: number;
      };
      linkedPairExportMode?: 'single_video' | 'one_per_pair';
    }) => {
      if (isExportingVideo || isSuperImageExporting) {
        alert('Another export is already running. Please wait or cancel it first.');
        return;
      }
      if (isOverlayExporting) return;

      try {
        setIsOverlayExporting(true);
        setOverlayExportProgress(0);
        setOverlayExportStatus('Preparing batch export...');

        await exportOverlayBatchWithWebCodecs({
          editorMode: payload.editorMode,
          base: payload.base,
          batchPhotos: payload.batchPhotos,
          overlays: payload.overlays,
          linkedPairs: payload.linkedPairs,
          linkedPairLayout: payload.linkedPairLayout,
          linkedPairStyle: payload.linkedPairStyle,
          linkedPairExportMode: payload.linkedPairExportMode,
          settings: {
            exportResolution: videoSettings.exportResolution,
            exportBitrateMbps: videoSettings.exportBitrateMbps,
            exportCodec: videoSettings.exportCodec
          },
          onProgress: (progress, status) => {
            setOverlayExportProgress(progress);
            if (status) setOverlayExportStatus(status);
          }
        });

        setOverlayExportProgress(1);
        setOverlayExportStatus('Batch export complete');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Overlay batch export failed.';
        if (message === 'Export canceled') {
          setOverlayExportStatus('Export canceled');
          setOverlayExportProgress(0);
        } else {
          setOverlayExportStatus('');
          alert(message);
        }
      } finally {
        setIsOverlayExporting(false);
      }
    },
    [
      isOverlayExporting,
      isExportingVideo,
      isSuperImageExporting,
      videoSettings.exportResolution,
      videoSettings.exportBitrateMbps,
      videoSettings.exportCodec
    ]
  );

  const handleCancelOverlayExport = useCallback(() => {
    cancelOverlayBatchExport();
  }, []);

  const handleCancelSuperImageExport = useCallback(() => {
    cancelSuperImageExport();
  }, []);

  const handleCancelActiveExport = useCallback(() => {
    if (isOverlayExporting) {
      handleCancelOverlayExport();
      return;
    }
    if (isExportingVideo) {
      handleCancelVideoExport();
      return;
    }
    if (isSuperImageExporting) {
      handleCancelSuperImageExport();
    }
  }, [
    isOverlayExporting,
    isExportingVideo,
    isSuperImageExporting,
    handleCancelOverlayExport,
    handleCancelVideoExport,
    handleCancelSuperImageExport
  ]);

  const isAnyExporting = isExportingVideo || isOverlayExporting || isSuperImageExporting;
  const activeExportProgress = isOverlayExporting
    ? overlayExportProgress
    : isExportingVideo
      ? videoExportProgress
      : superImageExportProgress;
  const activeExportLabel = isOverlayExporting
    ? overlayExportStatus || 'Exporting Batch Videos'
    : isExportingVideo
      ? videoExportStatus || 'Exporting Video'
      : superImageExportStatus || 'Exporting Super Images';
  const activeExportFillColor = isOverlayExporting ? '#10B981' : isExportingVideo ? '#6366F1' : '#F59E0B';
  const currentModeLabel = getModeLabel(mode);

  const handleSuperImageExportStateChange = useCallback(
    (next: { isExporting: boolean; progress: number; status: string }) => {
      setIsSuperImageExporting(next.isExporting);
      setSuperImageExportProgress(next.isExporting ? next.progress : 0);
      setSuperImageExportStatus(next.isExporting ? next.status : '');
    },
    []
  );

  useEffect(() => {
    setIsMobileHeaderOpen(false);
  }, [mode]);

  const handleOverlayEditorSettingsChange = (patch: Partial<Pick<VideoSettings, 'exportResolution' | 'exportBitrateMbps' | 'exportCodec'>>) => {
    setVideoSettings((current) => ({
      ...current,
      ...patch
    }));
  };

  const handleSaveAppDefaults = useCallback((nextSettings: AppGlobalSettings, options?: { gameAudioMuted?: boolean }) => {
    setAppDefaults(nextSettings);
    saveAppGlobalSettings(nextSettings);
    saveSplitterMode(nextSettings.splitterDefaults.defaultMode);
    saveGameAudioMuted(options?.gameAudioMuted ?? false);
    setVideoSettings(nextSettings.videoDefaults);
    setFrameDefaultsSessionId((current) => current + 1);
    setSplitterDefaultsSessionId((current) => current + 1);
    setIsSettingsOpen(false);
  }, []);

  const handleResetAppDefaults = useCallback(() => {
    const resetSettings = resetAppGlobalSettings();
    setAppDefaults(resetSettings);
    saveSplitterMode(resetSettings.splitterDefaults.defaultMode);
    saveGameAudioMuted(false);
    setVideoSettings(resetSettings.videoDefaults);
    setFrameDefaultsSessionId((current) => current + 1);
    setSplitterDefaultsSessionId((current) => current + 1);
  }, []);

  const handleExportAppDefaults = useCallback(
    (nextSettings: AppGlobalSettings, options?: { gameAudioMuted?: boolean }) => {
      const bundle = createAppSettingsTransferBundle({
        appSettings: nextSettings,
        gameAudioMuted: options?.gameAudioMuted
      });
      const timestamp = bundle.exportedAt.replace(/[:.]/g, '-');
      downloadJSON(bundle, `spotitnow-settings-${timestamp}.json`);
      return 'Settings backup downloaded.';
    },
    []
  );

  const handleImportAppDefaults = useCallback(async (file: File) => {
    const raw = await file.text();
    const result = applyAppSettingsTransferBundle(raw);
    setAppDefaults(result.appSettings);
    setVideoSettings(result.appSettings.videoDefaults);
    setFrameDefaultsSessionId((current) => current + 1);
    setSplitterDefaultsSessionId((current) => current + 1);

    const layoutSummary = result.hasSavedVideoLayout ? 'saved layout included' : 'no saved layout';

    return {
      gameAudioMuted: result.gameAudioMuted,
      message: `Imported settings, ${result.timestampPresetCount} timestamp presets, ${result.watermarkPresetCount} watermark presets, ${result.sceneCopyPresetCount} scene copy presets, ${layoutSummary}.`
    };
  }, []);

  useEffect(() => {
    if (!isPersistentMode(mode)) return;
    setModeMountedState((current) => {
      if (current[mode]) return current;
      return { ...current, [mode]: true };
    });
  }, [mode]);

  const shouldRenderMode = (targetMode: AppMode) => mode === targetMode || modeMountedState[targetMode];

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const state = window.history.state as { [HISTORY_STATE_KEY]?: boolean; mode?: unknown } | null;
    if (state?.[HISTORY_STATE_KEY] === true && state.mode === mode) return;
    window.history.replaceState({ [HISTORY_STATE_KEY]: true, mode }, '', window.location.href);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isHandlingPopStateRef.current) {
      isHandlingPopStateRef.current = false;
      return;
    }
    const state = window.history.state as { [HISTORY_STATE_KEY]?: boolean; mode?: unknown } | null;
    if (state?.[HISTORY_STATE_KEY] === true && state.mode === mode) return;
    window.history.pushState({ [HISTORY_STATE_KEY]: true, mode }, '', window.location.href);
  }, [mode]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handlePopState = (event: PopStateEvent) => {
      const state = event.state as { [HISTORY_STATE_KEY]?: boolean; mode?: unknown } | null;
      if (state?.[HISTORY_STATE_KEY] !== true) {
        isHandlingPopStateRef.current = true;
        setMode('home');
        return;
      }

      let nextMode: AppMode = isKnownAppMode(state.mode) ? state.mode : 'home';

      if ((nextMode === 'video_setup' || nextMode === 'video_play') && batch.length === 0) {
        nextMode = 'home';
      }
      if (nextMode === 'play' && !puzzle && batch.length === 0) {
        nextMode = 'home';
      }
      if ((nextMode === 'play' || nextMode === 'video_setup') && !puzzle && batch[0]) {
        setPuzzle(batch[0]);
        setPlayIndex(0);
      }

      isHandlingPopStateRef.current = true;
      setMode((current) => (current === nextMode ? current : nextMode));
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [batch, puzzle]);

  return (
    <div className="min-h-screen bg-[#FFFDF5] text-slate-900 font-sans selection:bg-black selection:text-white">
      <header className="bg-white/95 backdrop-blur border-b-2 border-black sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-3">
          <div className="sm:hidden">
            <div className="flex items-center justify-between gap-3">
              <button
                className="flex min-w-0 items-center gap-3 text-left"
                onClick={() => {
                  setIsMobileHeaderOpen(false);
                  handleGoHome();
                }}
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 border-black bg-black text-white shadow-sm">
                  <Gamepad2 size={20} strokeWidth={2.2} />
                </div>
                <div className="min-w-0">
                  <span className="block truncate text-lg font-extrabold tracking-tight text-slate-900">SpotDiff</span>
                  <span className="mt-1 inline-flex items-center rounded-md border border-black bg-[#FEF3C7] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
                    {currentModeLabel}
                  </span>
                </div>
              </button>

              <div className="flex shrink-0 items-center gap-2">
                {isAnyExporting && (
                  <div className="rounded-lg border-2 border-black bg-white px-2.5 py-2 text-xs font-semibold tabular-nums">
                    {Math.round(activeExportProgress * 100)}%
                  </div>
                )}
                <button
                  onClick={() => {
                    setIsMobileHeaderOpen(false);
                    setIsSettingsOpen(true);
                  }}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border-2 border-black bg-[#DBEAFE] text-slate-800"
                  title="Open app defaults"
                  aria-label="Open settings"
                >
                  <Settings size={18} strokeWidth={2.5} />
                </button>
                <button
                  onClick={() => setIsMobileHeaderOpen((current) => !current)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border-2 border-black bg-white text-slate-900"
                  aria-expanded={isMobileHeaderOpen}
                  aria-label={isMobileHeaderOpen ? 'Close mobile menu' : 'Open mobile menu'}
                >
                  {isMobileHeaderOpen ? <X size={18} strokeWidth={2.5} /> : <Menu size={18} strokeWidth={2.5} />}
                </button>
              </div>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              {batch.length > 0 && mode === 'upload' && (
                <div className="inline-flex items-center gap-2 rounded-lg border-2 border-black bg-[#A7F3D0] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-900">
                  <Layers size={14} strokeWidth={2.5} />
                  <span>Batch {batch.length}</span>
                </div>
              )}
              {isAnyExporting && (
                <div className="min-w-0 rounded-lg border-2 border-black bg-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
                  {activeExportLabel}
                </div>
              )}
            </div>

            <AnimatePresence initial={false}>
              {isMobileHeaderOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -8, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: 'auto' }}
                  exit={{ opacity: 0, y: -8, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="mt-3 space-y-3 rounded-2xl border-2 border-black bg-[#FFFDF5] p-3">
                    {isAnyExporting && (
                      <div className="rounded-xl border-2 border-black bg-white p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-2 text-slate-700">
                            <LoaderCircle size={14} className="shrink-0 animate-spin text-indigo-600" />
                            <span className="truncate text-[10px] font-semibold uppercase tracking-wide">{activeExportLabel}</span>
                          </div>
                          <span className="text-xs font-semibold tabular-nums">{Math.round(activeExportProgress * 100)}%</span>
                        </div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full border border-black bg-slate-100">
                          <div
                            className="h-full transition-all"
                            style={{
                              width: `${Math.max(0, Math.min(100, activeExportProgress * 100))}%`,
                              backgroundColor: activeExportFillColor
                            }}
                          />
                        </div>
                        <button
                          onClick={() => {
                            setIsMobileHeaderOpen(false);
                            handleCancelActiveExport();
                          }}
                          className="mt-3 w-full rounded-lg border-2 border-black bg-white px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-700 hover:bg-red-50"
                        >
                          Cancel Export
                        </button>
                      </div>
                    )}

                    {(batch.length > 0 && mode === 'upload') || (mode !== 'home' && !isAnyExporting) ? (
                      <div className="grid grid-cols-1 gap-2">
                        {batch.length > 0 && mode === 'upload' && (
                          <button
                            onClick={() => {
                              setIsMobileHeaderOpen(false);
                              const puzzleSet: PuzzleSet = {
                                title: 'My Puzzle Batch',
                                version: 1,
                                puzzles: batch
                              };
                              downloadJSON(puzzleSet, 'puzzle-batch.json');
                            }}
                            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border-2 border-black bg-[#FDE68A] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-black hover:bg-[#FCD34D]"
                          >
                            <Download size={16} strokeWidth={2.5} />
                            Save Batch JSON
                          </button>
                        )}
                        {mode !== 'home' && !isAnyExporting && (
                          <button
                            onClick={() => {
                              setIsMobileHeaderOpen(false);
                              handleExit();
                            }}
                            className="w-full rounded-lg border-2 border-black bg-white px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-700 hover:bg-slate-100"
                          >
                            Exit Current Mode
                          </button>
                        )}
                      </div>
                    ) : null}

                    <div className="border-t-2 border-black pt-3">
                      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Modes</div>
                      <div className="grid grid-cols-2 gap-2">
                        {QUICK_NAV_ITEMS.map((item) => {
                          const Icon = item.icon;
                          const isActive = mode === item.id;
                          const isDisabled = Boolean(item.requiresBatch && batch.length === 0);
                          return (
                            <button
                              key={item.id}
                              onClick={() => {
                                setIsMobileHeaderOpen(false);
                                handleQuickNavigate(item.id);
                              }}
                              disabled={isDisabled}
                              className={`w-full rounded-xl border-2 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide transition-all ${
                                isActive
                                  ? 'border-black bg-black text-white'
                                  : isDisabled
                                  ? 'cursor-not-allowed border-slate-300 bg-slate-200 text-slate-400'
                                  : 'border-black bg-white text-slate-700 hover:bg-slate-100'
                              }`}
                              title={isDisabled ? 'Load or create puzzles to enable this mode.' : `Open ${item.label}`}
                            >
                              <span className="inline-flex items-center gap-2">
                                <Icon size={14} strokeWidth={2.5} />
                                <span>{item.label}</span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="hidden space-y-3 sm:block">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <button className="flex min-w-0 items-center gap-3 text-left cursor-pointer group" onClick={handleGoHome}>
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border-2 border-black bg-black text-white shadow-sm">
                    <Gamepad2 size={20} strokeWidth={2.2} />
                  </div>
                  <div className="min-w-0">
                    <span className="block text-lg font-extrabold tracking-tight text-slate-900 sm:text-xl">SpotDiff</span>
                  </div>
                  <span className="inline-flex items-center rounded-md border border-black bg-[#FEF3C7] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
                    {currentModeLabel}
                  </span>
                </button>

                <div className="flex w-full flex-wrap items-stretch gap-2 sm:w-auto sm:items-center sm:justify-end">
                  {isAnyExporting && (
                    <div className="flex w-full flex-wrap items-stretch gap-2 sm:w-auto sm:items-center">
                      <div className="hidden lg:block min-w-[280px] rounded-xl border-2 border-black bg-white px-4 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 text-slate-700">
                            <LoaderCircle size={16} className="animate-spin text-indigo-600" />
                            <span className="text-xs font-semibold uppercase tracking-wide">{activeExportLabel}</span>
                          </div>
                          <span className="text-sm font-semibold tabular-nums">{Math.round(activeExportProgress * 100)}%</span>
                        </div>
                        <div className="mt-1 h-2 overflow-hidden rounded-full border border-black bg-slate-100">
                          <div
                            className="h-full transition-all"
                            style={{
                              width: `${Math.max(0, Math.min(100, activeExportProgress * 100))}%`,
                              backgroundColor: activeExportFillColor
                            }}
                          />
                        </div>
                      </div>
                      <div className="rounded-lg border-2 border-black bg-white px-3 py-2 text-xs font-semibold tabular-nums lg:hidden">
                        {Math.round(activeExportProgress * 100)}%
                      </div>
                      <button
                        onClick={handleCancelActiveExport}
                        className="rounded-lg border-2 border-black bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-all hover:bg-red-50 sm:px-4 sm:text-sm"
                      >
                        CANCEL
                      </button>
                    </div>
                  )}
                  {batch.length > 0 && mode === 'upload' && (
                    <div className="flex items-center gap-2 rounded-lg border-2 border-black bg-[#A7F3D0] px-3 py-2 text-xs font-semibold text-emerald-900 sm:px-4 sm:text-sm">
                      <Layers size={18} strokeWidth={2.5} />
                      <span>BATCH: {batch.length}</span>
                    </div>
                  )}
                  {batch.length > 0 && mode === 'upload' && (
                    <button
                      onClick={() => {
                        const puzzleSet: PuzzleSet = {
                          title: 'My Puzzle Batch',
                          version: 1,
                          puzzles: batch
                        };
                        downloadJSON(puzzleSet, 'puzzle-batch.json');
                      }}
                      className="inline-flex items-center gap-2 rounded-lg border-2 border-black bg-[#FDE68A] px-3 py-2 text-xs font-semibold text-black transition-all hover:bg-[#FCD34D] sm:px-4 sm:text-sm"
                    >
                      <Download size={18} strokeWidth={2.5} />
                      <span>DOWNLOAD</span>
                    </button>
                  )}
                  <button
                    onClick={() => setIsSettingsOpen(true)}
                    className="inline-flex items-center gap-2 rounded-lg border-2 border-black bg-[#DBEAFE] px-3 py-2 text-xs font-semibold text-slate-800 transition-all hover:bg-[#BFDBFE] sm:px-4 sm:text-sm"
                    title="Open app defaults"
                  >
                    <Settings size={16} strokeWidth={2.5} />
                    <span>SETTINGS</span>
                  </button>
                  {mode !== 'home' && !isAnyExporting && (
                    <button
                      onClick={handleExit}
                      className="rounded-lg border-2 border-black bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-all hover:bg-slate-100 sm:px-4 sm:text-sm"
                    >
                      EXIT
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {QUICK_NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = mode === item.id;
                const isDisabled = Boolean(item.requiresBatch && batch.length === 0);
                return (
                  <button
                    key={item.id}
                    onClick={() => handleQuickNavigate(item.id)}
                    disabled={isDisabled}
                    className={`shrink-0 rounded-lg border-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide inline-flex items-center gap-2 transition-all ${
                      isActive
                        ? 'border-black bg-black text-white'
                        : isDisabled
                        ? 'cursor-not-allowed border-slate-300 bg-slate-200 text-slate-400'
                        : 'border-black bg-white text-slate-700 hover:bg-slate-100'
                    }`}
                    title={isDisabled ? 'Load or create puzzles to enable this mode.' : `Open ${item.label}`}
                  >
                    <Icon size={14} strokeWidth={2.5} />
                    <span className="leading-tight">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto min-h-[calc(100dvh-6rem)] p-3 sm:p-6">
        <AnimatePresence>
          {mode === 'home' && (
            <motion.div 
              key="home"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              <section className="bg-white border-2 border-black rounded-2xl shadow-sm p-6 sm:p-8">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#2563EB]">SpotDiff Studio</p>
                <h1 className="mt-3 text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
                  Create and export spot-the-difference content at scale
                </h1>
                <p className="mt-3 text-sm sm:text-base text-slate-600 max-w-3xl">
                  Manage puzzle workflows, generate media outputs, and move between tools without losing progress.
                </p>

                <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <button
                    onClick={() => {
                      setBatch([]);
                      setMode('upload');
                    }}
                    className="text-left rounded-xl border-2 border-black bg-[#FFD93D] text-slate-900 p-5 hover:bg-[#FACC15] transition-colors"
                  >
                    <div className="inline-flex w-10 h-10 rounded-lg bg-black text-white items-center justify-center mb-4">
                      <Plus size={20} strokeWidth={2.5} />
                    </div>
                    <h3 className="text-lg font-bold">Create New Puzzle</h3>
                    <p className="mt-1 text-sm text-slate-700">Upload an image pair and mark differences.</p>
                  </button>

                  <label className="text-left rounded-xl border-2 border-black bg-[#4ECDC4] p-5 hover:bg-[#38BDB3] transition-colors cursor-pointer">
                    <div className="inline-flex w-10 h-10 rounded-lg bg-black text-white items-center justify-center mb-4">
                      <Upload size={20} strokeWidth={2.5} />
                    </div>
                    <h3 className="text-lg font-bold text-slate-900">Load Puzzle JSON</h3>
                    <p className="mt-1 text-sm text-slate-800">Continue from a previously exported puzzle set.</p>
                    <input type="file" accept=".json" onChange={handleLoadPuzzle} className="hidden" />
                  </label>
                </div>
              </section>

              <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button
                  onClick={() => {
                    document.getElementById('video-upload')?.click();
                  }}
                  className="rounded-xl border-2 border-black bg-white p-5 text-left hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-slate-900">Video Mode</h3>
                      <p className="mt-1 text-sm text-slate-600">Load puzzles and preview video playback flow.</p>
                    </div>
                    <div className="w-9 h-9 rounded-lg bg-slate-100 text-slate-700 border border-black flex items-center justify-center">
                      <Video size={18} />
                    </div>
                  </div>
                  <input
                    id="video-upload"
                    type="file"
                    accept=".json"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (event) => {
                          if (event.target?.result) {
                            const json = JSON.parse(event.target.result as string);
                            if (json.puzzles || Array.isArray(json) || (json.imageA && json.imageB)) {
                              const newBatch = json.puzzles || (Array.isArray(json) ? json : [json]);
                              setBatch(newBatch);
                              setMode('video_setup');
                            }
                          }
                        };
                        reader.readAsText(file);
                      }
                    }}
                    className="hidden"
                  />
                </button>

                <button
                  onClick={() => {
                    setIncomingVideoFrames([]);
                    setMode('overlay_editor');
                  }}
                  className="rounded-xl border-2 border-black bg-[#FDE68A] p-5 text-left hover:bg-[#FCD34D] transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-slate-900">Overlay Editor</h3>
                      <p className="mt-1 text-sm text-slate-600">Compose overlays over a base clip and batch export.</p>
                    </div>
                    <div className="w-9 h-9 rounded-lg bg-white text-slate-700 border border-black flex items-center justify-center">
                      <PlaySquare size={18} />
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => setMode('splitter')}
                  className="rounded-xl border-2 border-black bg-[#FFE4E6] p-5 text-left hover:bg-[#FECDD3] transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-slate-900">Image Splitter</h3>
                      <p className="mt-1 text-sm text-slate-600">Split combined images and route output to batch flow.</p>
                    </div>
                    <div className="w-9 h-9 rounded-lg bg-white text-slate-700 border border-black flex items-center justify-center">
                      <Scissors size={18} />
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => setMode('image_upscaler')}
                  className="rounded-xl border-2 border-black bg-[#E0F2FE] p-5 text-left hover:bg-[#BAE6FD] transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-slate-900">Image Upscaler</h3>
                      <p className="mt-1 text-sm text-slate-600">Run standalone browser-side upscale and detail enhancement without touching any other tool.</p>
                    </div>
                    <div className="w-9 h-9 rounded-lg bg-white text-slate-700 border border-black flex items-center justify-center">
                      <Sparkles size={18} />
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => setMode('progress_bar')}
                  className="rounded-xl border-2 border-black bg-[#DBEAFE] p-5 text-left hover:bg-[#BFDBFE] transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-slate-900">Progress Bar Mode</h3>
                      <p className="mt-1 text-sm text-slate-600">Generate reusable animated bars with export presets.</p>
                    </div>
                    <div className="w-9 h-9 rounded-lg bg-white text-slate-700 border border-black flex items-center justify-center">
                      <LoaderCircle size={18} />
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => setMode('frame_extractor')}
                  className="rounded-xl border-2 border-black bg-[#DCFCE7] p-5 text-left hover:bg-[#BBF7D0] transition-colors md:col-span-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-slate-900">Frame Extractor</h3>
                      <p className="mt-1 text-sm text-slate-600">Extract still frames from multiple videos using shared timestamps.</p>
                    </div>
                    <div className="w-9 h-9 rounded-lg bg-white text-slate-700 border border-black flex items-center justify-center">
                      <Camera size={18} />
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => setMode('watermark_removal')}
                  className="rounded-xl border-2 border-black bg-[#F3E8FF] p-5 text-left hover:bg-[#E9D5FF] transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-slate-900">Watermark Removal</h3>
                      <p className="mt-1 text-sm text-slate-600">Mark the watermark areas on both puzzle images, swap those exact pixels, and save the selection as a reusable preset.</p>
                    </div>
                    <div className="w-9 h-9 rounded-lg bg-white text-slate-700 border border-black flex items-center justify-center">
                      <ImagePlus size={18} />
                    </div>
                  </div>
                </button>
              </section>
            </motion.div>
          )}

          {shouldRenderMode('splitter') && (
            <motion.div
              key={`splitter-${splitterDefaultsSessionId}`}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className={mode === 'splitter' ? 'h-full' : 'hidden h-full'}
            >
              <ImageSplitterPanel
                onBatchProcess={(files) => handleOpenUploadWithInjectedFiles(files)}
                defaultMode={appDefaults.splitterDefaults.defaultMode}
                namingDefaults={appDefaults.splitterDefaults}
              />
            </motion.div>
          )}

          {shouldRenderMode('image_upscaler') && (
            <motion.div
              key="image_upscaler"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className={mode === 'image_upscaler' ? 'h-full' : 'hidden h-full'}
            >
              <ImageUpscalerMode
                onBack={() => setMode('home')}
              />
            </motion.div>
          )}

          {shouldRenderMode('progress_bar') && (
            <motion.div
              key="progress_bar"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className={mode === 'progress_bar' ? 'h-full' : 'hidden h-full'}
            >
              <ProgressBarMode
                settings={{
                  visualStyle: videoSettings.visualStyle,
                  exportResolution: videoSettings.exportResolution,
                  exportBitrateMbps: videoSettings.exportBitrateMbps,
                  exportCodec: videoSettings.exportCodec
                }}
                onSettingsChange={(patch) => {
                  setVideoSettings((current) => ({
                    ...current,
                    ...patch
                  }));
                }}
                onBack={() => setMode('home')}
              />
            </motion.div>
          )}

          {shouldRenderMode('watermark_removal') && (
            <motion.div
              key="watermark_removal"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className={mode === 'watermark_removal' ? 'h-full' : 'hidden h-full'}
            >
              <WatermarkRemovalMode
                onBack={() => setMode('home')}
              />
            </motion.div>
          )}

          {shouldRenderMode('frame_extractor') && (
            <motion.div
              key="frame_extractor"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className={mode === 'frame_extractor' ? 'h-full' : 'hidden h-full'}
            >
              <FrameExtractorMode
                onBack={() => setMode('home')}
                defaults={appDefaults.frameExtractorDefaults}
                splitterDefaults={appDefaults.splitterDefaults}
                videoSettings={videoSettings}
                defaultsSessionId={frameDefaultsSessionId}
                onSendToBatchAuto={(files) => handleOpenUploadWithInjectedFiles(files, 'auto')}
                hasActiveAppExport={isAnyExporting}
                onSuperImageExportStateChange={handleSuperImageExportStateChange}
              />
            </motion.div>
          )}

          {shouldRenderMode('upload') && (
            <motion.div 
              key="upload"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className={mode === 'upload' ? 'h-full relative' : 'hidden h-full relative'}
            >
              <div className="text-center mb-6 sm:mb-8">
                <h2 className="text-2xl sm:text-4xl font-black text-black font-display uppercase tracking-tight inline-block bg-[#FF6B6B] px-4 sm:px-6 py-2 border-4 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] -rotate-1">
                  {batch.length > 0 ? `Puzzle #${batch.length + 1}` : 'Upload Images'}
                </h2>
              </div>
              <div className="bg-white border-4 border-black rounded-2xl shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] p-6 md:p-8">
                <ImageUploader 
                  onImagesSelected={handleImagesSelected}
                  onBatchSelected={handleBatchSelected}
                  onExportVideo={handleOpenVideoModeWithPuzzles}
                  injectedFiles={injectedUploadFiles ?? undefined}
                  injectedProcessingMode={injectedUploadProcessingMode}
                  injectedFilesSessionId={injectedUploadFilesSessionId}
                  onInjectedFilesHandled={handleInjectedFilesHandled}
                />
              </div>
              {isProcessing && (
                <div className="absolute inset-0 bg-white/90 flex items-center justify-center z-50 backdrop-blur-sm rounded-2xl border-4 border-black">
                  <div className="flex flex-col items-center space-y-6">
                    <div className="w-20 h-20 border-8 border-black border-t-[#FF6B6B] rounded-full animate-spin" />
                    <p className="text-black font-black text-2xl font-display uppercase tracking-wider">Generating Puzzle...</p>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {shouldRenderMode('edit') && puzzle && (
            <motion.div 
              key="edit"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className={mode === 'edit' ? 'h-full' : 'hidden h-full'}
            >
              <EditorCanvas 
                imageA={puzzle.imageA} 
                imageB={puzzle.imageB} 
                onSave={handleSavePuzzle}
                onPlay={handlePlayPuzzle}
                onAddToBatch={handleAddToBatch}
                onExportVideo={handleOpenVideoModeFromEditor}
                batchCount={batch.length}
              />
            </motion.div>
          )}

          {mode === 'play' && puzzle && (
            <motion.div 
              key="play"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="h-full"
            >
              <GameCanvas 
                key={puzzle.title + playIndex}
                puzzle={puzzle} 
                onExit={handleExit}
                onNextLevel={handleNextLevel}
                hasNextLevel={playIndex < batch.length - 1}
              />
            </motion.div>
          )}

          {shouldRenderMode('overlay_editor') && (
            <motion.div
              key="overlay_editor"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className={mode === 'overlay_editor' ? 'h-full' : 'hidden h-full'}
            >
              <OverlayVideoEditor
                settings={{
                  exportResolution: videoSettings.exportResolution,
                  exportBitrateMbps: videoSettings.exportBitrateMbps,
                  exportCodec: videoSettings.exportCodec
                }}
                puzzles={batch}
                defaultPuzzleClipDurationSeconds={
                  Math.max(0.5, videoSettings.showDuration) +
                  Math.max(0.5, videoSettings.revealDuration) +
                  Math.max(0, videoSettings.transitionDuration)
                }
                incomingVideoFrames={incomingVideoFrames}
                incomingVideoFramesSessionId={incomingVideoFramesSessionId}
                onSettingsChange={handleOverlayEditorSettingsChange}
                onExport={handleOverlayBatchExport}
                isExporting={isOverlayExporting}
                onBack={() => setMode('home')}
              />
            </motion.div>
          )}

          {shouldRenderMode('video_setup') && (
            <motion.div
              key="video_setup"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className={mode === 'video_setup' ? 'h-full flex items-center justify-center' : 'hidden h-full'}
            >
              <VideoSettingsPanel
                settings={videoSettings}
                puzzles={batch}
                onSettingsChange={setVideoSettings}
                onExport={handleExportVideo}
                isExporting={isExportingVideo}
                exportProgress={videoExportProgress}
                exportStatus={videoExportStatus}
                onStart={() => {
                  if (batch.length === 0) {
                    alert('Add or load at least one puzzle first.');
                    return;
                  }
                  setMode('video_play');
                }}
                onBack={() => setMode('home')}
              />
            </motion.div>
          )}

          {mode === 'video_play' && batch.length > 0 && (
            <motion.div
              key="video_play"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black" // Full screen overlay
            >
              <VideoPlayer
                puzzles={batch}
                settings={videoSettings}
                onExit={() => setMode('video_setup')}
                onSendToEditor={handleSendRawFramesToOverlayEditor}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <AppSettingsModal
        isOpen={isSettingsOpen}
        settings={appDefaults}
        onClose={() => setIsSettingsOpen(false)}
        onSave={handleSaveAppDefaults}
        onExportSettings={handleExportAppDefaults}
        onImportSettings={handleImportAppDefaults}
        onResetDefaults={handleResetAppDefaults}
      />
    </div>
  );
}
