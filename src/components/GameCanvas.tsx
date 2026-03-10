import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, CheckCircle, Play, Volume2, VolumeX, XCircle } from 'lucide-react';
import { Puzzle, Region } from '../types';
import confetti from 'canvas-confetti';
import {
  loadGameAudioMuted,
  playGameSound,
  primeGameAudio,
  saveGameAudioMuted
} from '../services/gameAudio';

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
  const [soundMuted, setSoundMuted] = useState(() => loadGameAudioMuted());
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const lastCountdownTickRef = useRef<number | null>(null);

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
    lastCountdownTickRef.current = null;
  }, [puzzle]);

  // Timer
  useEffect(() => {
    if (gameOver) return;
    
    if (timeLeft <= 0) {
      playGameSound('lose');
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
      playGameSound('win');
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

  useEffect(() => {
    if (gameOver || timeLeft > 10 || timeLeft <= 0) {
      if (timeLeft > 10 || timeLeft <= 0) {
        lastCountdownTickRef.current = null;
      }
      return;
    }

    if (lastCountdownTickRef.current === timeLeft) return;

    lastCountdownTickRef.current = timeLeft;
    playGameSound('countdown');
  }, [gameOver, timeLeft]);

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

    void primeGameAudio();

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
      playGameSound('success');
    } else {
      const newMistakes = mistakes + 1;
      setMistakes(newMistakes);
      setClickFeedback({ x: e.clientX, y: e.clientY, type: 'error', id: Date.now() });
      
      // Reduce time on mistake? Optional, but adds pressure. 
      // For now, just keeping the mistake counter logic.
      if (newMistakes >= 5) { // Reduced max mistakes to 5 for 90s game
        playGameSound('lose');
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
      } else {
        playGameSound('error');
      }
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const toggleSound = () => {
    const nextMuted = !soundMuted;
    setSoundMuted(nextMuted);
    saveGameAudioMuted(nextMuted);

    if (!nextMuted) {
      void primeGameAudio();
      playGameSound('success');
    }
  };

  return (
    <div className="flex min-h-[100dvh] w-full flex-col items-center justify-center overflow-x-hidden bg-[#FFFDF5] p-3 sm:p-4 lg:p-8">
      {/* Game Container - 16:9 Aspect Ratio */}
      <div className="relative flex w-full max-w-[1600px] min-h-[calc(100dvh-1.5rem)] flex-col overflow-hidden rounded-2xl border-4 border-black bg-white shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] lg:min-h-0 lg:aspect-video">
        
        {/* HUD Header */}
        <div className="z-20 shrink-0 border-b-4 border-black bg-[#FFD93D] px-4 py-4 sm:px-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 items-start gap-3 sm:gap-4">
            <button 
              onClick={onExit}
              className="p-2 bg-white border-2 border-black rounded-lg hover:bg-black hover:text-white transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[1px] hover:translate-x-[1px] hover:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
            >
              <ArrowLeft size={24} strokeWidth={3} />
            </button>
            <div className="min-w-0">
              <h2 className="break-words pr-2 text-lg font-black font-display uppercase leading-none tracking-tight text-black sm:text-2xl">
                {puzzle.title || `Puzzle`}
              </h2>
              <span className="mt-1 block text-[10px] font-bold uppercase tracking-widest opacity-70 text-black sm:text-xs">
                Level {foundRegions.size} / {puzzle.regions.length} Found
              </span>
            </div>
          </div>

          {/* Timer & Score */}
            <div className="flex w-full flex-wrap items-center justify-between gap-3 md:w-auto md:justify-end md:gap-6">
            <div className="flex min-w-[180px] flex-1 flex-col md:flex-none md:items-end">
              <div className="flex items-center space-x-2 rounded-full border-2 border-black bg-black px-3 py-1 sm:px-4">
                <div className={`w-3 h-3 rounded-full ${timeLeft <= 10 ? 'bg-[#FF6B6B] animate-pulse' : 'bg-[#4ECDC4]'}`} />
                <span className={`font-mono text-lg font-bold sm:text-xl ${timeLeft <= 10 ? 'text-[#FF6B6B]' : 'text-white'}`}>
                  {formatTime(timeLeft)}
                </span>
              </div>
              <div className="mt-1 h-3 w-full max-w-[200px] overflow-hidden rounded-full border-2 border-black bg-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] md:w-32">
                <motion.div 
                  className="h-full bg-[#FF6B6B]"
                  initial={{ width: "100%" }}
                  animate={{ width: `${(timeLeft / 90) * 100}%` }}
                  transition={{ ease: "linear", duration: 1 }}
                />
              </div>
            </div>

            <div className="flex items-center space-x-2 rounded-xl border-2 border-black bg-white px-3 py-2 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] sm:px-4">
              <XCircle size={24} className="text-[#FF6B6B] fill-current stroke-black stroke-2" />
              <span className="font-mono text-xl font-black text-black sm:text-2xl">{mistakes}</span>
            </div>

            <button
              type="button"
              onClick={toggleSound}
              className={`inline-flex items-center gap-2 rounded-xl border-2 border-black px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-colors sm:px-4 ${
                soundMuted ? 'bg-white text-slate-700 hover:bg-slate-100' : 'bg-[#A7F3D0] text-black hover:bg-[#86EFAC]'
              }`}
              title={soundMuted ? 'Enable sound effects' : 'Mute sound effects'}
            >
              {soundMuted ? <VolumeX size={18} strokeWidth={2.8} /> : <Volume2 size={18} strokeWidth={2.8} />}
              <span>{soundMuted ? 'Sound Off' : 'Sound On'}</span>
            </button>
          </div>
        </div>
        </div>

        {/* Game Area */}
        <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-[#4ECDC4] p-3 sm:p-4">
          {/* Background Pattern */}
          <div className="absolute inset-0 opacity-10" 
               style={{ backgroundImage: 'radial-gradient(circle, #000 2px, transparent 2px)', backgroundSize: '24px 24px' }} 
          />

          <div className="relative flex h-full w-full flex-col items-stretch justify-center gap-3 overflow-auto lg:flex-row lg:items-center lg:gap-4">
            {/* Original Image */}
            <div className="group relative min-h-[220px] w-full overflow-hidden rounded-xl border-4 border-black bg-white shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] sm:min-h-[300px] lg:h-full lg:flex-1">
              <div className="absolute top-0 left-0 z-10 rounded-br-xl border-r-4 border-b-4 border-black bg-black px-3 py-1 text-xs font-black uppercase tracking-wider text-white sm:px-4 sm:text-sm">
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
              className="group relative min-h-[220px] w-full cursor-crosshair overflow-hidden rounded-xl border-4 border-black bg-white shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] active:cursor-grabbing sm:min-h-[300px] lg:h-full lg:flex-1"
              onClick={handleCanvasClick}
            >
              <div className="absolute top-0 left-0 z-10 animate-pulse rounded-br-xl border-r-4 border-b-4 border-black bg-[#FF6B6B] px-3 py-1 text-xs font-black uppercase tracking-wider text-black sm:px-4 sm:text-sm">
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
                      className={`fixed z-50 flex h-12 w-12 -ml-6 -mt-6 items-center justify-center rounded-full border-4 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] sm:h-16 sm:w-16 sm:-ml-8 sm:-mt-8 ${
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
        <div className="z-20 shrink-0 border-t-4 border-black bg-white px-4 py-3 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
            <span className="font-black uppercase text-sm tracking-wider text-black">Progress:</span>
            <div className="flex flex-wrap gap-2">
              {puzzle.regions.map((region) => (
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
          <div className="font-black uppercase text-sm tracking-wider text-slate-400 sm:text-right">
            {foundRegions.size} / {puzzle.regions.length} Found
          </div>
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
              className={`relative w-full max-w-lg overflow-hidden rounded-3xl border-4 border-black p-6 text-center shadow-[16px_16px_0px_0px_rgba(255,255,255,1)] sm:border-8 sm:p-12 ${
                isFailed ? 'bg-[#FF6B6B]' : 'bg-[#FFD93D]'
              }`}
            >
              <div className="absolute top-0 left-0 w-full h-4 bg-white/20 -skew-y-2 transform origin-top-left" />
              
              <motion.div 
                animate={!isFailed ? { rotate: [0, 10, -10, 0] } : {}}
                transition={{ repeat: Infinity, duration: 2 }}
                className="mb-4 inline-block rounded-full border-4 border-black bg-white p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] sm:mb-6 sm:p-6"
              >
                {isFailed ? (
                  <XCircle size={48} className="fill-current stroke-black stroke-2 text-[#FF6B6B] sm:h-16 sm:w-16" />
                ) : (
                  <CheckCircle size={48} className="fill-current stroke-black stroke-2 text-[#4ECDC4] sm:h-16 sm:w-16" />
                )}
              </motion.div>
              
              <h2 className="mb-2 text-3xl font-black font-display uppercase leading-none tracking-tight text-black sm:text-5xl">
                {isFailed ? 'Game Over!' : 'Level Complete!'}
              </h2>
              <p className="mb-6 font-mono text-base font-bold text-black/80 sm:mb-8 sm:text-xl">
                {isFailed ? 'Better luck next time!' : `You found all differences!`}
              </p>
              
              <div className="flex flex-col space-y-4">
                {hasNextLevel && !isFailed ? (
                  <button 
                    onClick={() => {
                      if (onNextLevel) onNextLevel();
                    }}
                    className="flex w-full items-center justify-center space-x-3 rounded-xl bg-black py-4 text-base font-black uppercase tracking-wider text-white transition-transform hover:scale-105 shadow-[8px_8px_0px_0px_rgba(255,255,255,1)] sm:text-xl"
                  >
                    <span>Next Level</span>
                    <Play size={24} strokeWidth={3} />
                  </button>
                ) : (
                  <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
                    <button 
                      onClick={onExit}
                      className="flex-1 rounded-xl border-4 border-black bg-white py-4 text-base font-black uppercase tracking-wider text-black transition-colors hover:bg-slate-50 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] sm:text-lg"
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
                      className="flex-1 rounded-xl border-4 border-black bg-black py-4 text-base font-black uppercase tracking-wider text-white transition-colors hover:bg-slate-900 shadow-[4px_4px_0px_0px_rgba(255,255,255,1)] sm:text-lg"
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
