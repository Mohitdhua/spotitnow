import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, RotateCcw, ZoomIn, ZoomOut, CheckCircle, XCircle, Play } from 'lucide-react';
import { Puzzle, Region } from '../types';
import confetti from 'canvas-confetti';

interface GameCanvasProps {
  puzzle: Puzzle;
  onExit: () => void;
  onNextLevel?: () => void;
  hasNextLevel?: boolean;
}

export const GameCanvas: React.FC<GameCanvasProps> = ({ puzzle, onExit, onNextLevel, hasNextLevel }) => {
  const [foundRegions, setFoundRegions] = useState<Set<string>>(new Set());
  const [missedRegions, setMissedRegions] = useState<Set<string>>(new Set());
  const [mistakes, setMistakes] = useState(0);
  const [startTime] = useState(Date.now());
  const [elapsedTime, setElapsedTime] = useState(0);
  const [clickFeedback, setClickFeedback] = useState<{ x: number, y: number, type: 'success' | 'error', id: number } | null>(null);
  const [gameOver, setGameOver] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [isFailed, setIsFailed] = useState(false);
  const [zoom, setZoom] = useState(1);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Timer
  useEffect(() => {
    if (gameOver) return;
    const interval = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime, gameOver]);

  // Check win condition
  useEffect(() => {
    if (isFailed) return; // Don't trigger win if failed
    
    if (foundRegions.size === puzzle.regions.length && !gameOver) {
      setGameOver(true);
      setShowModal(true);
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 }
      });
    }
    return () => {
      // Optional: clear confetti if component unmounts quickly
      // confetti.reset(); 
    };
  }, [foundRegions, puzzle.regions.length, gameOver, isFailed]);

  // Draw canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const img = imageRef.current;

    if (canvas && ctx && img) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw found regions
      puzzle.regions.forEach(region => {
        if (foundRegions.has(region.id)) {
          drawRegion(ctx, region, 'rgba(0, 255, 0, 0.2)', 'rgba(0, 255, 0, 0.8)');
        } else if (missedRegions.has(region.id)) {
          // Draw missed regions in Red
          drawRegion(ctx, region, 'rgba(255, 0, 0, 0.2)', 'rgba(255, 0, 0, 0.8)');
        }
      });
    }
  }, [foundRegions, missedRegions, puzzle.regions]);

  const drawRegion = (ctx: CanvasRenderingContext2D, region: Region, fillColor: string, strokeColor: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const x = region.x * canvas.width;
    const y = region.y * canvas.height;
    const w = region.width * canvas.width;
    const h = region.height * canvas.height;

    ctx.fillStyle = fillColor;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 3;
    
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.fill();
    ctx.stroke();
  };

  const handleCanvasClick = (e: React.MouseEvent) => {
    if (gameOver) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = (e.clientX - rect.left) / rect.width;
    const clickY = (e.clientY - rect.top) / rect.height;

    // Check collision
    const found = puzzle.regions.find(region => 
      !foundRegions.has(region.id) &&
      clickX >= region.x && 
      clickX <= region.x + region.width &&
      clickY >= region.y && 
      clickY <= region.y + region.height
    );

    if (found) {
      setFoundRegions(prev => new Set(prev).add(found.id));
      setClickFeedback({ x: e.clientX, y: e.clientY, type: 'success', id: Date.now() });
    } else {
      const newMistakes = mistakes + 1;
      setMistakes(newMistakes);
      setClickFeedback({ x: e.clientX, y: e.clientY, type: 'error', id: Date.now() });
      
      if (newMistakes >= 10) {
        setIsFailed(true);
        setGameOver(true);
        setShowModal(true);
        
        // Identify missed regions
        const missed = new Set<string>();
        puzzle.regions.forEach(r => {
          if (!foundRegions.has(r.id)) {
            missed.add(r.id);
          }
        });
        setMissedRegions(missed);
      }
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col h-full w-full max-w-7xl mx-auto p-4 space-y-4">
      {/* Header / HUD */}
      <div className="flex flex-wrap justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-slate-200">
        <div className="flex items-center space-x-4">
          <button onClick={onExit} className="p-2 hover:bg-slate-100 rounded-full text-slate-600">
            <ArrowLeft size={24} />
          </button>
          <div className="flex flex-col">
            <span className="text-xs text-slate-400 uppercase font-bold tracking-wider">Time</span>
            <span className="text-xl font-mono font-bold text-slate-700">{formatTime(elapsedTime)}</span>
          </div>
        </div>

        {gameOver && !showModal && (
          <button 
            onClick={() => setShowModal(true)}
            className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold shadow-md animate-pulse"
          >
            Continue / Next
          </button>
        )}

        <div className="flex items-center space-x-8">
          <div className="flex flex-col items-center">
            <span className="text-xs text-slate-400 uppercase font-bold tracking-wider">Found</span>
            <span className="text-2xl font-bold text-indigo-600">
              {foundRegions.size} <span className="text-slate-300 text-lg">/ {puzzle.regions.length}</span>
            </span>
          </div>
          <div className="flex flex-col items-center">
            <span className="text-xs text-slate-400 uppercase font-bold tracking-wider">Mistakes</span>
            <span className={`text-2xl font-bold ${mistakes > 0 ? 'text-red-500' : 'text-slate-700'}`}>
              {mistakes}
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button 
            onClick={() => setZoom(z => Math.max(1, z - 0.2))}
            className="p-2 hover:bg-slate-100 rounded-lg text-slate-600"
            disabled={zoom <= 1}
          >
            <ZoomOut size={20} />
          </button>
          <span className="text-sm font-medium w-12 text-center">{Math.round(zoom * 100)}%</span>
          <button 
            onClick={() => setZoom(z => Math.min(3, z + 0.2))}
            className="p-2 hover:bg-slate-100 rounded-lg text-slate-600"
            disabled={zoom >= 3}
          >
            <ZoomIn size={20} />
          </button>
        </div>
      </div>

      {/* Game Area */}
      <div 
        className="flex flex-col lg:flex-row gap-8 flex-1 min-h-0 justify-center items-start overflow-auto p-4 bg-slate-50 rounded-2xl border border-slate-200"
        ref={containerRef}
      >
        {/* Original Image */}
        <div className="relative rounded-xl overflow-hidden shadow-lg border border-slate-200 max-w-[45%] transition-transform duration-200" style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
          <img src={puzzle.imageA} alt="Original" className="block max-h-[70vh] w-auto h-auto pointer-events-none" />
        </div>

        {/* Playable Image */}
        <div 
          className="relative rounded-xl overflow-hidden shadow-lg border border-slate-200 max-w-[45%] cursor-pointer transition-transform duration-200" 
          style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
          onClick={handleCanvasClick}
        >
          <img 
            ref={imageRef}
            src={puzzle.imageB} 
            alt="Find differences here" 
            className="block max-h-[70vh] w-auto h-auto pointer-events-none select-none"
            onLoad={() => {
              const img = imageRef.current;
              const canvas = canvasRef.current;
              if (img && canvas) {
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
              }
            }}
          />
          <canvas
            ref={canvasRef}
            className="absolute top-0 left-0 w-full h-full pointer-events-none"
          />
        </div>
      </div>

      {/* Click Feedback Overlay */}
      <AnimatePresence>
        {clickFeedback && (
          <motion.div
            key={clickFeedback.id}
            initial={{ opacity: 1, scale: 0.5 }}
            animate={{ opacity: 0, scale: 1.5 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            style={{ 
              position: 'fixed', 
              left: clickFeedback.x - 20, 
              top: clickFeedback.y - 20,
              pointerEvents: 'none',
              zIndex: 50
            }}
          >
            {clickFeedback.type === 'success' ? (
              <CheckCircle size={40} className="text-green-500 fill-green-100" />
            ) : (
              <XCircle size={40} className="text-red-500 fill-red-100" />
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Game Over Modal */}
      <AnimatePresence>
        {gameOver && showModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white p-8 rounded-2xl shadow-2xl max-w-md w-full text-center space-y-6"
            >
              {isFailed ? (
                <>
                  <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto text-red-600">
                    <XCircle size={48} />
                  </div>
                  <div>
                    <h2 className="text-3xl font-bold text-slate-900">Too Many Mistakes</h2>
                    <p className="text-slate-500 mt-2">You reached 10 mistakes. The differences have been revealed.</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto text-green-600">
                    <CheckCircle size={48} />
                  </div>
                  <div>
                    <h2 className="text-3xl font-bold text-slate-900">Puzzle Solved!</h2>
                    <p className="text-slate-500 mt-2">You found all {puzzle.regions.length} differences.</p>
                  </div>
                </>
              )}
              
              <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl">
                <div className="text-center">
                  <div className="text-sm text-slate-400 uppercase font-bold">Time</div>
                  <div className="text-xl font-mono font-bold text-slate-700">{formatTime(elapsedTime)}</div>
                </div>
                <div className="text-center">
                  <div className="text-sm text-slate-400 uppercase font-bold">Mistakes</div>
                  <div className={`text-xl font-mono font-bold ${mistakes > 0 ? 'text-red-500' : 'text-slate-700'}`}>{mistakes}</div>
                </div>
              </div>

              {isFailed && (
                <button
                  onClick={() => setShowModal(false)}
                  className="w-full py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-medium transition-colors mb-2"
                >
                  Review Differences
                </button>
              )}

              <div className="flex space-x-3">
                <button 
                  onClick={onExit}
                  className="flex-1 py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-medium transition-colors"
                >
                  {hasNextLevel ? 'Exit Batch' : 'Back to Menu'}
                </button>
                
                {hasNextLevel && onNextLevel ? (
                  <button 
                    onClick={() => {
                      setGameOver(false);
                      setIsFailed(false);
                      setFoundRegions(new Set());
                      setMissedRegions(new Set());
                      setMistakes(0);
                      onNextLevel();
                    }}
                    className="flex-1 py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium transition-colors flex items-center justify-center space-x-2"
                  >
                    <Play size={18} />
                    <span>Next Level</span>
                  </button>
                ) : (
                  <button 
                    onClick={() => {
                      setGameOver(false);
                      setIsFailed(false);
                      setFoundRegions(new Set());
                      setMissedRegions(new Set());
                      setMistakes(0);
                      onExit(); 
                    }}
                    className="flex-1 py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium transition-colors flex items-center justify-center space-x-2"
                  >
                    <RotateCcw size={18} />
                    <span>{isFailed ? 'Try Again' : 'Play Again'}</span>
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
