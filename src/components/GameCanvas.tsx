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
  const [timeLeft, setTimeLeft] = useState(90);
  const [clickFeedback, setClickFeedback] = useState<{ x: number, y: number, type: 'success' | 'error', id: number } | null>(null);
  const [gameOver, setGameOver] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [isFailed, setIsFailed] = useState(false);
  const [zoom, setZoom] = useState(1);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Reset state when puzzle changes
  useEffect(() => {
    setFoundRegions(new Set());
    setMissedRegions(new Set());
    setMistakes(0);
    setTimeLeft(90);
    setGameOver(false);
    setShowModal(false);
    setIsFailed(false);
    setClickFeedback(null);
  }, [puzzle]);

  // Timer
  useEffect(() => {
    if (gameOver) return;
    
    if (timeLeft <= 0) {
      setIsFailed(true);
      setGameOver(true);
      setShowModal(true);
      return;
    }

    const interval = setInterval(() => {
      setTimeLeft(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [timeLeft, gameOver]);

  // Check win condition
  useEffect(() => {
    if (isFailed) return; // Don't trigger win if failed
    
    if (foundRegions.size === puzzle.regions.length && !gameOver) {
      setGameOver(true);
      
      confetti({
        particleCount: 150,
        spread: 80,
        origin: { y: 0.6 },
        colors: ['#FFD700', '#FFA500', '#FF4500', '#00CED1', '#1E90FF']
      });
    }
  }, [foundRegions, puzzle.regions.length, gameOver, isFailed]);

  // Handle navigation after win
  useEffect(() => {
    if (gameOver && !isFailed && foundRegions.size === puzzle.regions.length && !showModal) {
      if (hasNextLevel && onNextLevel) {
        // Auto advance after delay
        const timer = setTimeout(() => {
          onNextLevel();
        }, 2000);
        return () => clearTimeout(timer);
      } else {
        // Final level or single game
        setShowModal(true);
      }
    }
  }, [gameOver, isFailed, hasNextLevel, onNextLevel, foundRegions.size, puzzle.regions.length, showModal]);

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
      
      // Reduce time on mistake? Optional, but adds pressure. 
      // For now, just keeping the mistake counter logic.
      if (newMistakes >= 5) { // Reduced max mistakes to 5 for 90s game
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
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#FFFDF5] p-4 lg:p-8 overflow-hidden">
      {/* Game Container - 16:9 Aspect Ratio */}
      <div className="relative w-full max-w-[1600px] aspect-video bg-white border-4 border-black shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] rounded-2xl overflow-hidden flex flex-col">
        
        {/* HUD Header */}
        <div className="h-20 bg-[#FFD93D] border-b-4 border-black flex items-center justify-between px-6 shrink-0 z-20">
          <div className="flex items-center space-x-4">
            <button 
              onClick={onExit}
              className="p-2 bg-white border-2 border-black rounded-lg hover:bg-black hover:text-white transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[1px] hover:translate-x-[1px] hover:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
            >
              <ArrowLeft size={24} strokeWidth={3} />
            </button>
            <div className="flex flex-col">
              <h2 className="text-2xl font-black font-display uppercase leading-none tracking-tight text-black">
                {puzzle.title || `Puzzle`}
              </h2>
              <span className="text-xs font-bold uppercase tracking-widest opacity-70 text-black">
                Level {foundRegions.size} / {puzzle.regions.length} Found
              </span>
            </div>
          </div>

          {/* Timer & Score */}
          <div className="flex items-center space-x-6">
            <div className="flex flex-col items-end">
              <div className="flex items-center space-x-2 bg-black px-4 py-1 rounded-full border-2 border-black">
                <div className={`w-3 h-3 rounded-full ${timeLeft <= 10 ? 'bg-[#FF6B6B] animate-pulse' : 'bg-[#4ECDC4]'}`} />
                <span className={`font-mono text-xl font-bold ${timeLeft <= 10 ? 'text-[#FF6B6B]' : 'text-white'}`}>
                  {formatTime(timeLeft)}
                </span>
              </div>
              <div className="w-32 h-3 bg-white border-2 border-black rounded-full mt-1 overflow-hidden shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                <motion.div 
                  className="h-full bg-[#FF6B6B]"
                  initial={{ width: "100%" }}
                  animate={{ width: `${(timeLeft / 90) * 100}%` }}
                  transition={{ ease: "linear", duration: 1 }}
                />
              </div>
            </div>

            <div className="flex items-center space-x-2 bg-white border-2 border-black px-4 py-2 rounded-xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
              <XCircle size={24} className="text-[#FF6B6B] fill-current stroke-black stroke-2" />
              <span className="font-black text-2xl font-mono text-black">{mistakes}</span>
            </div>
          </div>
        </div>

        {/* Game Area */}
        <div className="flex-1 relative bg-[#4ECDC4] overflow-hidden flex items-center justify-center p-4">
          {/* Background Pattern */}
          <div className="absolute inset-0 opacity-10" 
               style={{ backgroundImage: 'radial-gradient(circle, #000 2px, transparent 2px)', backgroundSize: '24px 24px' }} 
          />

          <div className="relative w-full h-full flex gap-4 items-center justify-center" ref={containerRef}>
            {/* Original Image */}
            <div className="relative h-full flex-1 bg-white border-4 border-black rounded-xl overflow-hidden shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] group">
              <div className="absolute top-0 left-0 bg-black text-white px-4 py-1 font-black uppercase tracking-wider border-b-4 border-r-4 border-black rounded-br-xl z-10 text-sm">
                Original
              </div>
              <img 
                src={puzzle.imageA} 
                alt="Original" 
                className="w-full h-full object-contain pointer-events-none select-none bg-white"
              />
            </div>

            {/* Interactive Image */}
            <div 
              className="relative h-full flex-1 bg-white border-4 border-black rounded-xl overflow-hidden shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] cursor-crosshair group active:cursor-grabbing"
              onClick={handleCanvasClick}
            >
              <div className="absolute top-0 left-0 bg-[#FF6B6B] text-black px-4 py-1 font-black uppercase tracking-wider border-b-4 border-r-4 border-black rounded-br-xl z-10 animate-pulse text-sm">
                Spot Differences
              </div>
              
              <div className="relative w-full h-full">
                <img 
                  ref={imageRef}
                  src={puzzle.imageB} 
                  alt="Find Differences" 
                  className="w-full h-full object-contain select-none bg-white pointer-events-none"
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
                
                {/* Feedback Animations */}
                <AnimatePresence>
                  {clickFeedback && (
                    <motion.div
                      key={clickFeedback.id}
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 1.5, opacity: 0 }}
                      className={`fixed w-16 h-16 -ml-8 -mt-8 rounded-full border-4 border-black flex items-center justify-center z-50 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] ${
                        clickFeedback.type === 'success' 
                          ? 'bg-[#4ECDC4] text-black' 
                          : 'bg-[#FF6B6B] text-black'
                      }`}
                      style={{ 
                        left: clickFeedback.x, 
                        top: clickFeedback.y,
                      }}
                    >
                      {clickFeedback.type === 'success' ? <CheckCircle size={32} strokeWidth={3} /> : <XCircle size={32} strokeWidth={3} />}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>

        {/* Progress Footer */}
        <div className="h-16 bg-white border-t-4 border-black flex items-center justify-between px-6 shrink-0 z-20">
          <div className="flex items-center space-x-4">
            <span className="font-black uppercase text-sm tracking-wider text-black">Progress:</span>
            <div className="flex space-x-2">
              {puzzle.regions.map((region, idx) => (
                <motion.div
                  key={region.id}
                  initial={false}
                  animate={{
                    scale: foundRegions.has(region.id) ? 1.2 : 1,
                    backgroundColor: foundRegions.has(region.id) ? '#4ECDC4' : '#E2E8F0',
                    borderColor: foundRegions.has(region.id) ? '#000' : '#CBD5E1'
                  }}
                  className={`w-4 h-4 rounded-full border-2 ${
                    foundRegions.has(region.id) ? 'border-black' : 'border-slate-300'
                  }`}
                />
              ))}
            </div>
          </div>
          <div className="font-black uppercase text-sm tracking-wider text-slate-400">
            {foundRegions.size} / {puzzle.regions.length} Found
          </div>
        </div>
      </div>

      {/* Level Complete / Game Over Modal */}
      <AnimatePresence>
        {showModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 backdrop-blur-sm p-4"
          >
            <motion.div 
              initial={{ scale: 0.8, rotate: -2 }}
              animate={{ scale: 1, rotate: 0 }}
              className={`p-12 rounded-3xl border-8 border-black shadow-[16px_16px_0px_0px_rgba(255,255,255,1)] text-center max-w-lg w-full relative overflow-hidden ${
                isFailed ? 'bg-[#FF6B6B]' : 'bg-[#FFD93D]'
              }`}
            >
              <div className="absolute top-0 left-0 w-full h-4 bg-white/20 -skew-y-2 transform origin-top-left" />
              
              <motion.div 
                animate={!isFailed ? { rotate: [0, 10, -10, 0] } : {}}
                transition={{ repeat: Infinity, duration: 2 }}
                className="inline-block mb-6 bg-white p-6 rounded-full border-4 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
              >
                {isFailed ? (
                  <XCircle size={64} className="text-[#FF6B6B] fill-current stroke-black stroke-2" />
                ) : (
                  <CheckCircle size={64} className="text-[#4ECDC4] fill-current stroke-black stroke-2" />
                )}
              </motion.div>
              
              <h2 className="text-5xl font-black font-display uppercase mb-2 text-black leading-none tracking-tight">
                {isFailed ? 'Game Over!' : 'Level Complete!'}
              </h2>
              <p className="text-xl font-bold text-black/80 mb-8 font-mono">
                {isFailed ? 'Better luck next time!' : `You found all differences!`}
              </p>
              
              <div className="flex flex-col space-y-4">
                {hasNextLevel && !isFailed ? (
                  <button 
                    onClick={() => {
                      if (onNextLevel) onNextLevel();
                    }}
                    className="w-full py-4 bg-black text-white text-xl font-black uppercase tracking-wider rounded-xl hover:scale-105 transition-transform shadow-[8px_8px_0px_0px_rgba(255,255,255,1)] flex items-center justify-center space-x-3"
                  >
                    <span>Next Level</span>
                    <Play size={24} strokeWidth={3} />
                  </button>
                ) : (
                  <div className="flex space-x-4">
                    <button 
                      onClick={onExit}
                      className="flex-1 py-4 bg-white text-black text-lg font-black uppercase tracking-wider rounded-xl hover:bg-slate-50 transition-colors border-4 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
                    >
                      Menu
                    </button>
                    <button 
                      onClick={() => {
                        // Reset logic handled by parent or effect
                        setGameOver(false);
                        setIsFailed(false);
                        setFoundRegions(new Set());
                        setMissedRegions(new Set());
                        setMistakes(0);
                        setTimeLeft(90);
                        setShowModal(false);
                      }}
                      className="flex-1 py-4 bg-black text-white text-lg font-black uppercase tracking-wider rounded-xl hover:bg-slate-900 transition-colors border-4 border-black shadow-[4px_4px_0px_0px_rgba(255,255,255,1)]"
                    >
                      Retry
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
