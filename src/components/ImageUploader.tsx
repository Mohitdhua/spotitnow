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

  return (
    <div className="w-full max-w-2xl mx-auto p-6">
      <div 
        className={`relative border-2 border-dashed rounded-2xl p-12 text-center transition-all duration-200 ${
          dragActive ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 hover:border-indigo-400 hover:bg-slate-50'
        }`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <div className="flex flex-col items-center space-y-4">
          <div className="w-20 h-20 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mb-4">
            <Layers size={40} />
          </div>
          <h3 className="text-xl font-bold text-slate-800">
            Drag & Drop Images
          </h3>
          <p className="text-slate-500 max-w-md mx-auto">
            Upload single pairs or batch files. <br/>
            <span className="text-xs text-slate-400">
              For batch: use <code>name.png</code> and <code>namediff.png</code>
            </span>
          </p>
          
          <div className="flex gap-4 mt-6">
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="px-6 py-3 bg-white border border-slate-300 text-slate-700 rounded-xl font-medium hover:bg-slate-50 transition-colors shadow-sm flex items-center space-x-2"
            >
              <ImageIcon size={18} />
              <span>Select Files</span>
            </button>
            {onBatchSelected && (
              <button 
                onClick={() => batchInputRef.current?.click()}
                className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors shadow-md flex items-center space-x-2"
              >
                <Layers size={18} />
                <span>Batch Select</span>
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
              className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden flex flex-col max-h-[80vh]"
            >
              <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-amber-50">
                <div className="flex items-center space-x-3 text-amber-800">
                  <AlertTriangle size={24} />
                  <h3 className="text-lg font-bold">Incomplete Pairs Detected</h3>
                </div>
              </div>
              
              <div className="p-6 overflow-y-auto flex-1 space-y-4">
                <p className="text-slate-600 text-sm">
                  The following puzzles are missing either the base or difference image. 
                  Please resolve them to continue.
                </p>

                <div className="space-y-3">
                  {incompletePairs.map(pair => (
                    <div key={pair.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200">
                      <div className="flex items-center space-x-3 overflow-hidden">
                        <div className="w-10 h-10 bg-slate-200 rounded-lg flex items-center justify-center flex-shrink-0 text-slate-500">
                          <FileWarning size={20} />
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium text-slate-900 truncate">{pair.baseName}</div>
                          <div className="text-xs text-red-500 font-medium">
                            Missing: {pair.missingType === 'base' ? 'Original Image' : 'Difference Image'}
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex space-x-2 flex-shrink-0">
                        <button 
                          onClick={() => {
                            setResolvingId(pair.id);
                            missingFileInputRef.current?.click();
                          }}
                          className="p-2 bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 transition-colors"
                          title="Select Missing File"
                        >
                          <Upload size={18} />
                        </button>
                        <button 
                          onClick={() => discardPair(pair.id)}
                          className="p-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors"
                          title="Discard Puzzle"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end space-x-3">
                <button 
                  onClick={() => {
                    setIncompletePairs([]);
                    setShowBatchModal(false);
                    // If we have valid pairs, proceed with them
                    if (validPairsRef.current.size > 0) {
                      setShowOptionsModal(true);
                    }
                  }}
                  className="px-4 py-2 text-slate-600 font-medium hover:text-slate-900"
                >
                  Discard All Incomplete
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
              className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 text-center">
                <h3 className="text-2xl font-bold text-slate-800">Choose Detection Method</h3>
                <p className="text-slate-500 mt-2">How would you like to find the differences?</p>
              </div>
              
              <div className="p-6 space-y-4">
                <button 
                  onClick={() => handleProcessingChoice('manual')}
                  className="w-full flex items-center p-4 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl transition-all group text-left"
                >
                  <div className="w-12 h-12 bg-slate-200 text-slate-600 rounded-lg flex items-center justify-center mr-4 group-hover:bg-white group-hover:shadow-sm transition-all">
                    <MousePointer2 size={24} />
                  </div>
                  <div>
                    <div className="font-bold text-slate-900">Manual Selection</div>
                    <div className="text-sm text-slate-500">I want to mark the differences myself</div>
                  </div>
                </button>

                <button 
                  onClick={() => handleProcessingChoice('auto')}
                  className="w-full flex items-center p-4 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-xl transition-all group text-left"
                >
                  <div className="w-12 h-12 bg-indigo-200 text-indigo-600 rounded-lg flex items-center justify-center mr-4 group-hover:bg-white group-hover:shadow-sm transition-all">
                    <Wand2 size={24} />
                  </div>
                  <div>
                    <div className="font-bold text-indigo-900">Auto Detection (Fast)</div>
                    <div className="text-sm text-indigo-700">Use client-side algorithm to find differences instantly</div>
                  </div>
                </button>

                <button 
                  onClick={() => handleProcessingChoice('ai')}
                  className="w-full flex items-center p-4 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-xl transition-all group text-left"
                >
                  <div className="w-12 h-12 bg-purple-200 text-purple-600 rounded-lg flex items-center justify-center mr-4 group-hover:bg-white group-hover:shadow-sm transition-all">
                    <BrainCircuit size={24} />
                  </div>
                  <div>
                    <div className="font-bold text-purple-900">AI Analysis (Smart)</div>
                    <div className="text-sm text-purple-700">Use Gemini AI for advanced reasoning and detection</div>
                  </div>
                </button>
              </div>

              <div className="p-4 bg-slate-50 border-t border-slate-100 text-center">
                <button 
                  onClick={() => setShowOptionsModal(false)}
                  className="text-slate-500 hover:text-slate-800 text-sm font-medium"
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
              className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full overflow-hidden flex flex-col max-h-[85vh]"
            >
              <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                <div>
                  <h3 className="text-xl font-bold text-slate-800">Review Puzzles</h3>
                  <p className="text-slate-500 text-sm">Review detected differences and select puzzles to keep.</p>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="px-3 py-1 bg-indigo-100 text-indigo-700 rounded-full text-sm font-medium">
                    {reviewPuzzles.length} Puzzles
                  </span>
                </div>
              </div>
              
              <div className="p-6 overflow-y-auto flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50/50">
                {reviewPuzzles.map((puzzle, idx) => (
                  <div key={idx} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col space-y-3 group hover:border-indigo-200 transition-all">
                    <div className="flex justify-between items-start">
                      <h4 className="font-medium text-slate-900 truncate pr-2" title={puzzle.title}>
                        {puzzle.title || `Puzzle ${idx + 1}`}
                      </h4>
                      <button 
                        onClick={() => handleRemovePuzzle(idx)}
                        className="text-slate-400 hover:text-red-500 transition-colors p-1"
                        title="Remove Puzzle"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                    
                    <div className="flex space-x-2 h-32">
                      <div className="flex-1 relative rounded-lg overflow-hidden border border-slate-100 bg-slate-100">
                        <img src={puzzle.imageA} alt="Original" className="w-full h-full object-contain" />
                        <div className="absolute bottom-1 left-1 bg-black/50 text-white text-[10px] px-1.5 py-0.5 rounded">Original</div>
                      </div>
                      <div className="flex-1 relative rounded-lg overflow-hidden border border-slate-100 bg-slate-100">
                        <img src={puzzle.imageB} alt="Modified" className="w-full h-full object-contain" />
                        <div className="absolute bottom-1 left-1 bg-black/50 text-white text-[10px] px-1.5 py-0.5 rounded">Modified</div>
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100">
                      <div className="flex items-center">
                        <span className="w-2 h-2 rounded-full bg-indigo-500 mr-2"></span>
                        {puzzle.regions?.length || 0} Differences Detected
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-6 border-t border-slate-100 bg-white flex justify-between items-center">
                <button 
                  onClick={() => setShowReviewModal(false)}
                  className="text-slate-500 hover:text-slate-800 font-medium px-4 py-2"
                >
                  Cancel
                </button>
                
                <div className="flex space-x-3">
                  <button 
                    onClick={handleExport}
                    className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-xl font-medium hover:bg-slate-50 transition-colors shadow-sm flex items-center space-x-2"
                  >
                    <Download size={18} />
                    <span>Export JSON</span>
                  </button>
                  
                  <button 
                    onClick={handleConfirmBatch}
                    className="px-6 py-2 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors shadow-md flex items-center space-x-2"
                  >
                    <Play size={18} />
                    <span>Start Game</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {processing && (
        <div className="fixed inset-0 bg-white/80 flex items-center justify-center z-40">
          <div className="flex flex-col items-center space-y-4">
            <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
            <p className="text-indigo-600 font-medium">{processingStatus || "Processing images..."}</p>
          </div>
        </div>
      )}
    </div>
  );
}
