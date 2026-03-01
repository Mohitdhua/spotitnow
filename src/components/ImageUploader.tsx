import React, { useState, useRef } from 'react';
import { Upload, Image as ImageIcon, X, Layers, AlertTriangle, FileWarning, Check, Trash2, Wand2, BrainCircuit, MousePointer2, Download, Play, Edit } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Puzzle, Region, PuzzleSet } from '../types';
import { detectDifferencesClientSide } from '../services/imageProcessing';
import { detectDifferences } from '../services/ai';
import { EditorCanvas } from './EditorCanvas';

interface ImageUploaderProps {
  onImagesSelected: (imageA: string, imageB: string, regions?: Region[]) => void;
  onBatchSelected?: (puzzles: Puzzle[]) => void;
}

interface IncompletePair {
  id: string;
  baseName: string;
  missingType: 'base' | 'diff';
  existingFile: File;
}

type ProcessingMode = 'manual' | 'auto' | 'ai';

export function ImageUploader({ onImagesSelected, onBatchSelected }: ImageUploaderProps) {
  const [dragActive, setDragActive] = useState(false);
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [showOptionsModal, setShowOptionsModal] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewPuzzles, setReviewPuzzles] = useState<Puzzle[]>([]);
  const [incompletePairs, setIncompletePairs] = useState<IncompletePair[]>([]);
  const [processing, setProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<string>("");
  
  // Temporary storage for valid pairs before final submission
  const validPairsRef = useRef<Map<string, { base: File, diff: File }>>(new Map());

  const fileInputRef = useRef<HTMLInputElement>(null);
  const batchInputRef = useRef<HTMLInputElement>(null);
  const missingFileInputRef = useRef<HTMLInputElement>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [editingPuzzleIndex, setEditingPuzzleIndex] = useState<number | null>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const parseFilename = (filename: string) => {
    const name = filename.substring(0, filename.lastIndexOf('.')) || filename;
    // Check if ends with 'diff' (case insensitive)
    if (name.toLowerCase().endsWith('diff')) {
      return { base: name.substring(0, name.length - 4), type: 'diff' as const };
    }
    return { base: name, type: 'base' as const };
  };

  const readFileAsBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const processFiles = async (files: FileList | File[]) => {
    setProcessing(true);
    setProcessingStatus("Analyzing files...");
    const fileArray = Array.from(files);
    
    const pairs = new Map<string, { base?: File, diff?: File }>();

    // Group files
    fileArray.forEach(file => {
      const { base, type } = parseFilename(file.name);
      if (!pairs.has(base)) {
        pairs.set(base, {});
      }
      const pair = pairs.get(base)!;
      if (type === 'base') pair.base = file;
      else pair.diff = file;
    });

    const valid = new Map<string, { base: File, diff: File }>();
    const incomplete: IncompletePair[] = [];

    pairs.forEach((pair, baseName) => {
      if (pair.base && pair.diff) {
        valid.set(baseName, { base: pair.base, diff: pair.diff });
      } else {
        incomplete.push({
          id: baseName,
          baseName,
          missingType: pair.base ? 'diff' : 'base',
          existingFile: pair.base || pair.diff!
        });
      }
    });

    validPairsRef.current = valid;

    if (incomplete.length > 0) {
      setIncompletePairs(incomplete);
      setShowBatchModal(true);
      setProcessing(false);
    } else if (valid.size > 0) {
      // Instead of finalizing immediately, show options modal
      setProcessing(false);
      setShowOptionsModal(true);
    } else {
      // Fallback for simple 2-file upload without naming convention if exactly 2 files
      if (fileArray.length === 2 && !onBatchSelected) {
        // For single pair without naming convention, we treat it as a valid pair manually
        const tempMap = new Map();
        tempMap.set('puzzle', { base: fileArray[0], diff: fileArray[1] });
        validPairsRef.current = tempMap;
        setProcessing(false);
        setShowOptionsModal(true);
      } else {
        alert('No valid puzzle pairs found. Please ensure files are named "name.png" and "namediff.png".');
        setProcessing(false);
      }
    }
  };

  const handleProcessingChoice = (mode: ProcessingMode) => {
    setShowOptionsModal(false);
    finalizeBatch(validPairsRef.current, mode);
  };

  const finalizeBatch = async (pairs: Map<string, { base: File, diff: File }>, mode: ProcessingMode) => {
    setProcessing(true);
    
    // If single pair and not batch mode, handle specially to pass to onImagesSelected
    if (!onBatchSelected && pairs.size === 1) {
      const pair = pairs.values().next().value;
      try {
        setProcessingStatus("Processing image pair...");
        const imageA = await readFileAsBase64(pair.base);
        const imageB = await readFileAsBase64(pair.diff);
        
        let regions: Region[] = [];
        
        if (mode === 'auto') {
          setProcessingStatus("Auto-detecting differences...");
          const result = await detectDifferencesClientSide(imageA, imageB);
          // Use the resized images from result for better accuracy with regions
          onImagesSelected(result.imageA, result.imageB, result.regions);
          setProcessing(false);
          return;
        } else if (mode === 'ai') {
          setProcessingStatus("Asking AI to find differences...");
          const aiRegions = await detectDifferences(imageA, imageB);
          // Convert AI regions to our Region format
          regions = aiRegions.map(r => ({
            id: Math.random().toString(36).substring(2),
            x: r.xmin,
            y: r.ymin,
            width: r.xmax - r.xmin,
            height: r.ymax - r.ymin
          }));
        }
        
        // For manual or AI (AI returns regions but uses original images)
        onImagesSelected(imageA, imageB, regions);
      } catch (err) {
        console.error("Error processing single pair", err);
        alert("Failed to process images.");
      }
      setProcessing(false);
      validPairsRef.current.clear();
      return;
    }

    if (!onBatchSelected) return;

    const puzzles: Puzzle[] = [];
    let processed = 0;
    const total = pairs.size;
    
    for (const [baseName, pair] of pairs.entries()) {
      try {
        setProcessingStatus(`Processing puzzle ${processed + 1} of ${total}...`);
        const imageA = await readFileAsBase64(pair.base);
        const imageB = await readFileAsBase64(pair.diff);
        
        let regions: Region[] = [];
        let finalImageA = imageA;
        let finalImageB = imageB;

        if (mode === 'auto') {
          const result = await detectDifferencesClientSide(imageA, imageB);
          regions = result.regions;
          finalImageA = result.imageA;
          finalImageB = result.imageB;
        } else if (mode === 'ai') {
          const aiRegions = await detectDifferences(imageA, imageB);
          regions = aiRegions.map(r => ({
            id: Math.random().toString(36).substring(2),
            x: r.xmin,
            y: r.ymin,
            width: r.xmax - r.xmin,
            height: r.ymax - r.ymin
          }));
        }
        
        puzzles.push({
          imageA: finalImageA,
          imageB: finalImageB,
          regions: regions,
          title: baseName
        });
        processed++;
      } catch (err) {
        console.error(`Failed to process files for ${baseName}`, err);
      }
    }

    setReviewPuzzles(puzzles);
    setProcessing(false);
    setShowBatchModal(false);
    setIncompletePairs([]);
    validPairsRef.current.clear();
    setShowReviewModal(true);
  };

  const handleExport = () => {
    const puzzleSet: PuzzleSet = {
      title: 'Exported Puzzles',
      version: 1,
      puzzles: reviewPuzzles
    };
    const blob = new Blob([JSON.stringify(puzzleSet)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.href = url;
    downloadAnchorNode.download = "puzzles.json";
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
    URL.revokeObjectURL(url);
  };

  const handleConfirmBatch = () => {
    if (onBatchSelected) {
      onBatchSelected(reviewPuzzles);
      setShowReviewModal(false);
    }
  };

  const handleRemovePuzzle = (index: number) => {
    const newPuzzles = [...reviewPuzzles];
    newPuzzles.splice(index, 1);
    setReviewPuzzles(newPuzzles);
    if (newPuzzles.length === 0) {
      setShowReviewModal(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
    }
  };

  const resolveMissingFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !resolvingId) return;

    const pair = incompletePairs.find(p => p.id === resolvingId);
    if (!pair) return;

    const valid = validPairsRef.current;
    valid.set(pair.baseName, {
      base: pair.missingType === 'base' ? file : pair.existingFile,
      diff: pair.missingType === 'diff' ? file : pair.existingFile
    });

    const newIncomplete = incompletePairs.filter(p => p.id !== resolvingId);
    setIncompletePairs(newIncomplete);
    setResolvingId(null);

    if (newIncomplete.length === 0) {
      // All resolved, show options
      setShowBatchModal(false);
      setShowOptionsModal(true);
    }
  };

  const discardPair = (id: string) => {
    const newIncomplete = incompletePairs.filter(p => p.id !== id);
    setIncompletePairs(newIncomplete);
    if (newIncomplete.length === 0 && validPairsRef.current.size > 0) {
      // All incomplete discarded, but we have valid ones -> show options
      setShowBatchModal(false);
      setShowOptionsModal(true);
    } else if (newIncomplete.length === 0) {
      setShowBatchModal(false);
      setProcessing(false);
    }
  };

  const handleEditPuzzle = (index: number) => {
    setEditingPuzzleIndex(index);
  };

  const handleSaveEditedPuzzle = (editedPuzzle: Puzzle) => {
    if (editingPuzzleIndex === null) return;
    
    const newPuzzles = [...reviewPuzzles];
    newPuzzles[editingPuzzleIndex] = editedPuzzle;
    setReviewPuzzles(newPuzzles);
    setEditingPuzzleIndex(null);
  };

  return (
    <div className="w-full max-w-2xl mx-auto p-6">
      <div 
        className={`relative border-4 border-dashed rounded-2xl p-12 text-center transition-all duration-200 ${
          dragActive ? 'border-[#FF6B6B] bg-[#FFF5F5]' : 'border-black hover:border-[#FF6B6B] hover:bg-white'
        }`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <div className="flex flex-col items-center space-y-6">
          <div className="w-24 h-24 bg-[#FFD93D] text-black rounded-full flex items-center justify-center mb-4 border-4 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            <Layers size={48} strokeWidth={2.5} />
          </div>
          <h3 className="text-3xl font-black text-black font-display uppercase tracking-tight">
            Drag & Drop Images
          </h3>
          <p className="text-slate-700 font-bold max-w-md mx-auto border-2 border-black p-2 bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] -rotate-1">
            Upload single pairs or batch files. <br/>
            <span className="text-xs text-slate-500 font-mono mt-1 block">
              Batch: <code>name.png</code> + <code>namediff.png</code>
            </span>
          </p>
          
          <div className="flex gap-4 mt-8">
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="px-6 py-3 bg-white border-2 border-black text-black rounded-xl font-bold hover:bg-slate-50 transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] flex items-center space-x-2"
            >
              <ImageIcon size={20} strokeWidth={2.5} />
              <span>SELECT FILES</span>
            </button>
            {onBatchSelected && (
              <button 
                onClick={() => batchInputRef.current?.click()}
                className="px-6 py-3 bg-[#4ECDC4] border-2 border-black text-black rounded-xl font-bold hover:bg-[#3DBDB4] transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] flex items-center space-x-2"
              >
                <Layers size={20} strokeWidth={2.5} />
                <span>BATCH SELECT</span>
              </button>
            )}
          </div>
        </div>

        <input 
          ref={fileInputRef}
          type="file" 
          accept="image/*" 
          multiple
          className="hidden" 
          onChange={handleFileSelect}
        />
        <input 
          ref={batchInputRef}
          type="file" 
          accept="image/*" 
          multiple
          className="hidden" 
          onChange={handleFileSelect}
        />
        <input 
          ref={missingFileInputRef}
          type="file" 
          accept="image/*" 
          className="hidden" 
          onChange={resolveMissingFile}
        />
      </div>

      {/* Conflict Resolution Modal */}
      <AnimatePresence>
        {showBatchModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white rounded-2xl border-4 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] max-w-lg w-full overflow-hidden flex flex-col max-h-[80vh]"
            >
              <div className="p-6 border-b-4 border-black flex justify-between items-center bg-[#FFD93D]">
                <div className="flex items-center space-x-3 text-black">
                  <AlertTriangle size={28} strokeWidth={3} />
                  <h3 className="text-xl font-black font-display uppercase">Incomplete Pairs</h3>
                </div>
              </div>
              
              <div className="p-6 overflow-y-auto flex-1 space-y-4 bg-white">
                <p className="text-slate-700 font-medium border-l-4 border-black pl-4 py-2 bg-slate-50">
                  Some puzzles are missing files. Please resolve them to continue.
                </p>

                <div className="space-y-4">
                  {incompletePairs.map(pair => (
                    <div key={pair.id} className="flex items-center justify-between p-4 bg-white rounded-xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                      <div className="flex items-center space-x-3 overflow-hidden">
                        <div className="w-12 h-12 bg-slate-100 rounded-lg border-2 border-black flex items-center justify-center flex-shrink-0 text-slate-500">
                          <FileWarning size={24} strokeWidth={2.5} />
                        </div>
                        <div className="min-w-0">
                          <div className="font-bold text-black truncate">{pair.baseName}</div>
                          <div className="text-xs text-[#FF6B6B] font-bold uppercase tracking-wide">
                            Missing: {pair.missingType === 'base' ? 'Original' : 'Difference'}
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex space-x-2 flex-shrink-0">
                        <button 
                          onClick={() => {
                            setResolvingId(pair.id);
                            missingFileInputRef.current?.click();
                          }}
                          className="p-2 bg-[#A7F3D0] border-2 border-black text-black rounded-lg hover:bg-[#6EE7B7] transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[1px] hover:translate-x-[1px] hover:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
                          title="Select Missing File"
                        >
                          <Upload size={20} strokeWidth={2.5} />
                        </button>
                        <button 
                          onClick={() => discardPair(pair.id)}
                          className="p-2 bg-[#FF6B6B] border-2 border-black text-black rounded-lg hover:bg-[#FF5252] transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[1px] hover:translate-x-[1px] hover:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
                          title="Discard Puzzle"
                        >
                          <Trash2 size={20} strokeWidth={2.5} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-6 border-t-4 border-black bg-slate-50 flex justify-end space-x-3">
                <button 
                  onClick={() => {
                    setIncompletePairs([]);
                    setShowBatchModal(false);
                    if (validPairsRef.current.size > 0) {
                      setShowOptionsModal(true);
                    }
                  }}
                  className="px-6 py-3 bg-white border-2 border-black text-black rounded-xl font-bold hover:bg-slate-50 transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                >
                  DISCARD ALL
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Processing Options Modal */}
      <AnimatePresence>
        {showOptionsModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white rounded-2xl border-4 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] max-w-lg w-full overflow-hidden"
            >
              <div className="p-6 border-b-4 border-black text-center bg-[#4ECDC4]">
                <h3 className="text-2xl font-black text-black font-display uppercase">Detection Method</h3>
                <p className="text-black font-medium mt-1">How should we find the differences?</p>
              </div>
              
              <div className="p-6 space-y-4 bg-white">
                <button 
                  onClick={() => handleProcessingChoice('manual')}
                  className="w-full flex items-center p-4 bg-white hover:bg-slate-50 border-2 border-black rounded-xl transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] group text-left"
                >
                  <div className="w-14 h-14 bg-slate-200 text-black border-2 border-black rounded-lg flex items-center justify-center mr-4 group-hover:bg-white transition-all">
                    <MousePointer2 size={28} strokeWidth={2.5} />
                  </div>
                  <div>
                    <div className="font-black text-lg text-black uppercase">Manual Selection</div>
                    <div className="text-sm text-slate-600 font-medium">I'll mark them myself</div>
                  </div>
                </button>

                <button 
                  onClick={() => handleProcessingChoice('auto')}
                  className="w-full flex items-center p-4 bg-[#E0E7FF] hover:bg-[#C7D2FE] border-2 border-black rounded-xl transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] group text-left"
                >
                  <div className="w-14 h-14 bg-indigo-200 text-indigo-900 border-2 border-black rounded-lg flex items-center justify-center mr-4 group-hover:bg-white transition-all">
                    <Wand2 size={28} strokeWidth={2.5} />
                  </div>
                  <div>
                    <div className="font-black text-lg text-black uppercase">Auto Detection (Fast)</div>
                    <div className="text-sm text-slate-600 font-medium">Instant client-side algorithm</div>
                  </div>
                </button>

                <button 
                  onClick={() => handleProcessingChoice('ai')}
                  className="w-full flex items-center p-4 bg-[#F3E8FF] hover:bg-[#E9D5FF] border-2 border-black rounded-xl transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] group text-left"
                >
                  <div className="w-14 h-14 bg-purple-200 text-purple-900 border-2 border-black rounded-lg flex items-center justify-center mr-4 group-hover:bg-white transition-all">
                    <BrainCircuit size={28} strokeWidth={2.5} />
                  </div>
                  <div>
                    <div className="font-black text-lg text-black uppercase">AI Analysis (Smart)</div>
                    <div className="text-sm text-slate-600 font-medium">Gemini AI reasoning</div>
                  </div>
                </button>
              </div>

              <div className="p-4 bg-slate-50 border-t-4 border-black text-center">
                <button 
                  onClick={() => setShowOptionsModal(false)}
                  className="text-slate-500 hover:text-black font-bold text-sm uppercase tracking-wider"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Review Modal */}
      <AnimatePresence>
        {showReviewModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white rounded-2xl border-4 border-black shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] max-w-5xl w-full overflow-hidden flex flex-col max-h-[85vh]"
            >
              <div className="p-6 border-b-4 border-black flex justify-between items-center bg-[#FFD93D]">
                <div>
                  <h3 className="text-2xl font-black text-black font-display uppercase">Review Puzzles</h3>
                  <p className="text-black font-medium text-sm">Check detected differences and confirm.</p>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="px-4 py-1 bg-black text-[#FFD93D] border-2 border-black shadow-[2px_2px_0px_0px_rgba(255,255,255,0.5)] rounded-full text-sm font-bold">
                    {reviewPuzzles.length} PUZZLES
                  </span>
                </div>
              </div>
              
              <div className="p-6 overflow-y-auto flex-1 grid grid-cols-1 md:grid-cols-2 gap-6 bg-[#FFFDF5]">
                {reviewPuzzles.map((puzzle, idx) => (
                  <div key={idx} className="bg-white p-4 rounded-xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex flex-col space-y-3 group hover:translate-y-[-2px] hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] transition-all">
                    <div className="flex justify-between items-start">
                      <h4 className="font-bold text-black truncate pr-2 font-display text-lg" title={puzzle.title}>
                        {puzzle.title || `Puzzle ${idx + 1}`}
                      </h4>
                      <div className="flex space-x-2">
                        <button 
                          onClick={() => handleEditPuzzle(idx)}
                          className="text-black hover:text-[#4ECDC4] transition-colors p-1 border-2 border-transparent hover:border-black hover:bg-black rounded"
                          title="Edit Puzzle"
                        >
                          <Edit size={20} strokeWidth={2.5} />
                        </button>
                        <button 
                          onClick={() => handleRemovePuzzle(idx)}
                          className="text-black hover:text-[#FF6B6B] transition-colors p-1 border-2 border-transparent hover:border-black hover:bg-black rounded"
                          title="Remove Puzzle"
                        >
                          <Trash2 size={20} strokeWidth={2.5} />
                        </button>
                      </div>
                    </div>
                    
                    <div className="flex space-x-2 h-32">
                      <div className="flex-1 relative rounded-lg overflow-hidden border-2 border-black bg-slate-100">
                        <img src={puzzle.imageA} alt="Original" className="w-full h-full object-contain" />
                        <div className="absolute bottom-1 left-1 bg-black text-white text-[10px] px-1.5 py-0.5 font-bold uppercase">Original</div>
                      </div>
                      <div className="flex-1 relative rounded-lg overflow-hidden border-2 border-black bg-slate-100">
                        <img src={puzzle.imageB} alt="Modified" className="w-full h-full object-contain" />
                        <div className="absolute bottom-1 left-1 bg-[#FF6B6B] text-black border border-black text-[10px] px-1.5 py-0.5 font-bold uppercase">Modified</div>
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between text-xs text-black font-bold pt-2 border-t-2 border-slate-100">
                      <div className="flex items-center">
                        <span className="w-3 h-3 rounded-full bg-[#4ECDC4] border border-black mr-2"></span>
                        {puzzle.regions?.length || 0} DIFFERENCES
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-6 border-t-4 border-black bg-white flex justify-between items-center">
                <button 
                  onClick={() => setShowReviewModal(false)}
                  className="text-slate-500 hover:text-black font-bold px-4 py-2 uppercase tracking-wide"
                >
                  Cancel
                </button>
                
                <div className="flex space-x-4">
                  <button 
                    onClick={handleExport}
                    className="px-6 py-3 bg-white border-2 border-black text-black rounded-xl font-bold hover:bg-slate-50 transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] flex items-center space-x-2"
                  >
                    <Download size={20} strokeWidth={2.5} />
                    <span>EXPORT JSON</span>
                  </button>
                  
                  <button 
                    onClick={handleConfirmBatch}
                    className="px-8 py-3 bg-[#4ECDC4] text-black border-2 border-black rounded-xl font-black hover:bg-[#3DBDB4] transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] flex items-center space-x-2 text-lg"
                  >
                    <Play size={24} strokeWidth={3} />
                    <span>START GAME</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Editor Modal */}
      <AnimatePresence>
        {editingPuzzleIndex !== null && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white rounded-2xl border-4 border-black shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] w-full h-full max-w-7xl overflow-hidden flex flex-col"
            >
              <div className="p-4 border-b-4 border-black flex justify-between items-center bg-[#FF6B6B]">
                <h3 className="text-2xl font-black text-black font-display uppercase">Edit Puzzle</h3>
                <button 
                  onClick={() => setEditingPuzzleIndex(null)}
                  className="p-2 bg-white border-2 border-black hover:bg-slate-100 rounded-lg text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all"
                >
                  <X size={24} strokeWidth={3} />
                </button>
              </div>
              
              <div className="flex-1 overflow-hidden bg-[#FFFDF5]">
                <EditorCanvas 
                  imageA={reviewPuzzles[editingPuzzleIndex].imageA}
                  imageB={reviewPuzzles[editingPuzzleIndex].imageB}
                  initialRegions={reviewPuzzles[editingPuzzleIndex].regions}
                  onSave={(editedPuzzle) => handleSaveEditedPuzzle({
                    ...editedPuzzle,
                    title: reviewPuzzles[editingPuzzleIndex].title
                  })}
                  onPlay={() => {}} // Not needed in this context
                  onAddToBatch={() => {}} // Not needed in this context
                  batchCount={0}
                  isModal={true}
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {processing && (
        <div className="fixed inset-0 bg-white/90 flex items-center justify-center z-50 backdrop-blur-sm border-4 border-black m-4 rounded-3xl">
          <div className="flex flex-col items-center space-y-6">
            <div className="w-20 h-20 border-8 border-black border-t-[#FF6B6B] rounded-full animate-spin" />
            <p className="text-black font-black text-2xl font-display uppercase tracking-wider">{processingStatus || "Processing..."}</p>
          </div>
        </div>
      )}
    </div>
  );
}
