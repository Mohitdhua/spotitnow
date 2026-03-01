/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Upload, Gamepad2, Download, Layers, PlaySquare, Video } from 'lucide-react';
import { ImageUploader } from './components/ImageUploader';
import { EditorCanvas } from './components/EditorCanvas';
import { GameCanvas } from './components/GameCanvas';
import { VideoSettingsPanel } from './components/VideoSettingsPanel';
import { VideoPlayer } from './components/VideoPlayer'; // Assuming you created this file
import { Puzzle, PuzzleSet, GameMode, Region, VideoSettings } from './types';

export default function App() {
  const [mode, setMode] = useState<GameMode | 'home'>('home');
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [batch, setBatch] = useState<Puzzle[]>([]);
  const [playIndex, setPlayIndex] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Default Video Settings
  const [videoSettings, setVideoSettings] = useState<VideoSettings>({
    aspectRatio: '16:9',
    showDuration: 5,
    revealDuration: 3,
    revealStyle: 'box',
    revealColor: '#FF6B6B',
    transitionStyle: 'fade',
    transitionDuration: 1
  });

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

  const handleExit = () => {
    if (batch.length > 0 && mode !== 'play' && mode !== 'video_play' && !window.confirm('You have unsaved puzzles in your batch. Are you sure you want to exit? All progress will be lost.')) {
      return;
    }
    setMode('home');
    setBatch([]);
    setPuzzle(null);
    setPlayIndex(0);
  };

  return (
    <div className="min-h-screen bg-[#FFFDF5] text-slate-900 font-sans selection:bg-black selection:text-white">
      <header className="bg-white border-b-4 border-black sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 h-20 flex items-center justify-between">
          <div 
            className="flex items-center space-x-3 cursor-pointer group" 
            onClick={handleExit}
          >
            <div className="w-10 h-10 bg-black rounded-lg flex items-center justify-center text-white transform group-hover:rotate-12 transition-transform border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,0.2)]">
              <Gamepad2 size={24} strokeWidth={2.5} />
            </div>
            <span className="font-black text-2xl tracking-tighter text-black font-display uppercase">SpotDiff</span>
          </div>
          
          <div className="flex items-center space-x-4">
            {batch.length > 0 && mode === 'upload' && (
              <div className="flex items-center space-x-2 px-4 py-2 bg-[#A7F3D0] text-black rounded-lg text-sm font-bold border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
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
                className="px-4 py-2 bg-[#FDE68A] hover:bg-[#FCD34D] text-black rounded-lg text-sm font-bold border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[1px] hover:translate-x-[1px] hover:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] transition-all flex items-center space-x-2"
              >
                <Download size={18} strokeWidth={2.5} />
                <span>DOWNLOAD</span>
              </button>
            )}
            {mode !== 'home' && (
              <button 
                onClick={handleExit}
                className="px-4 py-2 bg-white hover:bg-slate-50 text-black rounded-lg text-sm font-bold border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[1px] hover:translate-x-[1px] hover:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] transition-all"
              >
                EXIT
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto min-h-[calc(100vh-5rem)] p-4 sm:p-8">
        <AnimatePresence mode="wait">
          {mode === 'home' && (
            <motion.div 
              key="home"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex flex-col items-center justify-center min-h-[70vh] space-y-12"
            >
              <div className="text-center space-y-6 max-w-4xl relative">
                {/* Decorative elements */}
                <div className="absolute -top-12 -left-12 w-24 h-24 bg-[#FF6B6B] rounded-full border-4 border-black opacity-20 animate-bounce delay-100 hidden md:block" />
                <div className="absolute -bottom-12 -right-12 w-32 h-32 bg-[#4ECDC4] rounded-full border-4 border-black opacity-20 animate-bounce delay-300 hidden md:block" />
                
                <h1 className="text-6xl md:text-8xl font-black tracking-tighter text-black font-display leading-[0.9]">
                  SPOT THE <br/>
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#FF6B6B] to-[#FFD93D] drop-shadow-[4px_4px_0px_rgba(0,0,0,1)]" style={{ WebkitTextStroke: '3px black' }}>DIFFERENCE</span>
                </h1>
                <p className="text-xl md:text-2xl text-slate-700 font-medium max-w-2xl mx-auto border-2 border-black bg-white p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] -rotate-1">
                  Create custom puzzles, challenge friends, and test your observation skills. 
                  <span className="font-bold"> No login required.</span>
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full max-w-4xl px-4">
                <button 
                  onClick={() => {
                    setBatch([]);
                    setMode('upload');
                  }}
                  className="group relative flex flex-col items-center p-8 bg-[#FFD93D] rounded-xl border-4 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] transition-all text-left overflow-hidden"
                >
                  <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-10 transition-opacity" />
                  <div className="w-20 h-20 bg-black text-[#FFD93D] rounded-xl flex items-center justify-center mb-6 border-4 border-black shadow-[4px_4px_0px_0px_rgba(255,255,255,0.5)] group-hover:rotate-6 transition-transform">
                    <Plus size={40} strokeWidth={3} />
                  </div>
                  <h3 className="text-3xl font-black text-black mb-2 font-display uppercase tracking-tight">Create New</h3>
                  <p className="text-black font-bold text-center border-t-2 border-black pt-4 mt-2 w-full">Upload images & mark differences</p>
                </button>

                <label className="group relative flex flex-col items-center p-8 bg-[#4ECDC4] rounded-xl border-4 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] transition-all text-left cursor-pointer overflow-hidden">
                  <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-10 transition-opacity" />
                  <div className="w-20 h-20 bg-black text-[#4ECDC4] rounded-xl flex items-center justify-center mb-6 border-4 border-black shadow-[4px_4px_0px_0px_rgba(255,255,255,0.5)] group-hover:-rotate-6 transition-transform">
                    <Upload size={40} strokeWidth={3} />
                  </div>
                  <h3 className="text-3xl font-black text-black mb-2 font-display uppercase tracking-tight">Load Puzzle</h3>
                  <p className="text-black font-bold text-center border-t-2 border-black pt-4 mt-2 w-full">Import JSON file to play</p>
                  <input 
                    type="file" 
                    accept=".json" 
                    onChange={handleLoadPuzzle}
                    className="hidden" 
                  />
                </label>
              </div>
              
              {/* Video Mode Button - Only show if we have puzzles loaded or just as a feature? 
                  Actually, user loads puzzles then plays. 
                  But if they load a batch, they might want to choose mode.
                  For now, let's add a "Video Mode" button that prompts to load a file if none exists.
              */}
              <div className="w-full max-w-4xl px-4">
                 <button 
                  onClick={() => {
                    // If batch exists, go to setup. Else prompt load.
                    // Actually, let's just make a "Video Mode" card that acts like Load Puzzle but sets a flag?
                    // Or simpler: Just add a button to go to Video Setup if batch is present.
                    // But if no batch, we can't setup.
                    // Let's add a "Video Mode" button that triggers file upload for video mode specifically.
                    document.getElementById('video-upload')?.click();
                  }}
                  className="w-full group relative flex items-center justify-between p-6 bg-white rounded-xl border-4 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] transition-all cursor-pointer overflow-hidden"
                >
                  <div className="flex items-center space-x-6">
                    <div className="w-16 h-16 bg-black text-white rounded-xl flex items-center justify-center border-4 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,0.2)]">
                      <Video size={32} strokeWidth={3} />
                    </div>
                    <div className="text-left">
                      <h3 className="text-2xl font-black text-black font-display uppercase tracking-tight">Video Mode</h3>
                      <p className="text-slate-600 font-bold">Watch puzzles play automatically</p>
                    </div>
                  </div>
                  <div className="bg-black text-white px-6 py-2 rounded-lg font-black uppercase tracking-wider transform group-hover:scale-105 transition-transform">
                    Load & Play
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
              <div className="text-center mb-8">
                <h2 className="text-4xl font-black text-black font-display uppercase tracking-tight inline-block bg-[#FF6B6B] px-6 py-2 border-4 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] -rotate-1">
                  {batch.length > 0 ? `Puzzle #${batch.length + 1}` : 'Upload Images'}
                </h2>
              </div>
              <div className="bg-white border-4 border-black rounded-2xl shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] p-6 md:p-8">
                <ImageUploader 
                  onImagesSelected={handleImagesSelected} 
                  onBatchSelected={handleBatchSelected}
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

          {mode === 'video_setup' && (
            <motion.div
              key="video_setup"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="h-full flex items-center justify-center"
            >
              <VideoSettingsPanel
                settings={videoSettings}
                onSettingsChange={setVideoSettings}
                onStart={() => setMode('video_play')}
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
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
