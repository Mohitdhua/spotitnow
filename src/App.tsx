/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Upload, Gamepad2, Download, Layers } from 'lucide-react';
import { ImageUploader } from './components/ImageUploader';
import { EditorCanvas } from './components/EditorCanvas';
import { GameCanvas } from './components/GameCanvas';
import { Puzzle, PuzzleSet, GameMode, Region } from './types';

export default function App() {
  const [mode, setMode] = useState<GameMode | 'home'>('home');
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [batch, setBatch] = useState<Puzzle[]>([]);
  const [playIndex, setPlayIndex] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);

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

  const handleNextLevel = () => {
    if (playIndex < batch.length - 1) {
      setPlayIndex(prev => prev + 1);
      setPuzzle(batch[playIndex + 1]);
    } else {
      setMode('home');
    }
  };

  const handleExit = () => {
    if (batch.length > 0 && mode !== 'play' && !window.confirm('You have unsaved puzzles in your batch. Are you sure you want to exit? All progress will be lost.')) {
      return;
    }
    setMode('home');
    setBatch([]);
    setPuzzle(null);
    setPlayIndex(0);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-indigo-100 selection:text-indigo-900">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div 
            className="flex items-center space-x-2 cursor-pointer" 
            onClick={handleExit}
          >
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white">
              <Gamepad2 size={20} />
            </div>
            <span className="font-bold text-xl tracking-tight text-slate-900">SpotDiff</span>
          </div>
          
          <div className="flex items-center space-x-4">
            {batch.length > 0 && mode === 'upload' && (
              <div className="flex items-center space-x-2 px-3 py-1 bg-emerald-50 text-emerald-700 rounded-full text-sm font-medium border border-emerald-200">
                <Layers size={16} />
                <span>Batch: {batch.length} puzzles</span>
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
                className="text-sm font-medium text-indigo-600 hover:text-indigo-800 transition-colors flex items-center space-x-1"
              >
                <Download size={16} />
                <span>Download Batch</span>
              </button>
            )}
            {mode !== 'home' && (
              <button 
                onClick={handleExit}
                className="text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors"
              >
                Exit to Menu
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto min-h-[calc(100vh-4rem)]">
        <AnimatePresence mode="wait">
          {mode === 'home' && (
            <motion.div 
              key="home"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex flex-col items-center justify-center min-h-[80vh] p-6 space-y-12"
            >
              <div className="text-center space-y-4 max-w-2xl">
                <h1 className="text-5xl font-extrabold tracking-tight text-slate-900">
                  Create & Play <br/>
                  <span className="text-indigo-600">Spot the Difference</span>
                </h1>
                <p className="text-xl text-slate-500 leading-relaxed">
                  Upload your own images, mark the differences, and challenge your friends. 
                  Everything runs locally in your browser.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-3xl">
                <button 
                  onClick={() => {
                    setBatch([]);
                    setMode('upload');
                  }}
                  className="group relative flex flex-col items-center p-8 bg-white rounded-2xl shadow-sm border-2 border-slate-100 hover:border-indigo-500 hover:shadow-xl transition-all duration-300 text-left"
                >
                  <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                    <Plus size={32} />
                  </div>
                  <h3 className="text-2xl font-bold text-slate-900 mb-2">Create New Puzzle</h3>
                  <p className="text-slate-500 text-center">Upload two images and mark the differences yourself.</p>
                </button>

                <label className="group relative flex flex-col items-center p-8 bg-white rounded-2xl shadow-sm border-2 border-slate-100 hover:border-emerald-500 hover:shadow-xl transition-all duration-300 text-left cursor-pointer">
                  <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                    <Upload size={32} />
                  </div>
                  <h3 className="text-2xl font-bold text-slate-900 mb-2">Load Puzzle</h3>
                  <p className="text-slate-500 text-center">Import a .json puzzle file to play instantly.</p>
                  <input 
                    type="file" 
                    accept=".json" 
                    onChange={handleLoadPuzzle}
                    className="hidden" 
                  />
                </label>
              </div>
            </motion.div>
          )}

          {mode === 'upload' && (
            <motion.div 
              key="upload"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="h-full relative"
            >
              <div className="text-center pt-8 pb-2">
                {batch.length > 0 ? (
                  <h2 className="text-2xl font-bold text-slate-800">Add Puzzle #{batch.length + 1} to Batch</h2>
                ) : (
                  <h2 className="text-2xl font-bold text-slate-800">Upload Images</h2>
                )}
              </div>
              <ImageUploader 
                onImagesSelected={handleImagesSelected} 
                onBatchSelected={handleBatchSelected}
              />
              {isProcessing && (
                <div className="absolute inset-0 bg-white/80 flex items-center justify-center z-50 backdrop-blur-sm">
                  <div className="flex flex-col items-center space-y-4">
                    <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
                    <p className="text-indigo-600 font-medium text-lg">Analyzing images & generating puzzle...</p>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {mode === 'edit' && puzzle && (
            <motion.div 
              key="edit"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="h-full"
            >
              <EditorCanvas 
                imageA={puzzle.imageA} 
                imageB={puzzle.imageB} 
                onSave={handleSavePuzzle}
                onPlay={handlePlayPuzzle}
                onAddToBatch={handleAddToBatch}
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
        </AnimatePresence>
      </main>
    </div>
  );
}
