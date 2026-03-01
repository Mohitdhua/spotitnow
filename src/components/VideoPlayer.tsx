import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Pause, Play, SkipForward, RotateCcw, CheckCircle, XCircle } from 'lucide-react';
import { Puzzle, VideoSettings } from '../types';

interface VideoPlayerProps {
  puzzles: Puzzle[];
  settings: VideoSettings;
  onExit: () => void;
}

type Phase = 'showing' | 'revealing' | 'transitioning' | 'finished';

export const VideoPlayer: React.FC<VideoPlayerProps> = ({ puzzles, settings, onExit }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('showing');
  const [timeLeft, setTimeLeft] = useState(settings.showDuration);
  const [isPlaying, setIsPlaying] = useState(true);
  
  const currentPuzzle = puzzles[currentIndex];
  const containerRef = useRef<HTMLDivElement>(null);

  // Timer Logic
  useEffect(() => {
    if (!isPlaying || phase === 'finished') return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 0.1) {
          handlePhaseComplete();
          return 0;
        }
        return prev - 0.1;
      });
    }, 100);

    return () => clearInterval(timer);
  }, [isPlaying, phase, currentIndex]);

  const handlePhaseComplete = () => {
    if (phase === 'showing') {
      setPhase('revealing');
      setTimeLeft(settings.revealDuration);
    } else if (phase === 'revealing') {
      if (currentIndex < puzzles.length - 1) {
        setPhase('transitioning');
        setTimeLeft(settings.transitionDuration);
      } else {
        setPhase('finished');
      }
    } else if (phase === 'transitioning') {
      setCurrentIndex((prev) => prev + 1);
      setPhase('showing');
      setTimeLeft(settings.showDuration);
    }
  };

  const handleSkip = () => {
    if (phase === 'showing') {
      setPhase('revealing');
      setTimeLeft(settings.revealDuration);
    } else if (phase === 'revealing') {
      handlePhaseComplete();
    }
  };

  const handleReplay = () => {
    setCurrentIndex(0);
    setPhase('showing');
    setTimeLeft(settings.showDuration);
    setIsPlaying(true);
  };

  // Calculate container style based on aspect ratio
  const getAspectRatioStyle = () => {
    switch (settings.aspectRatio) {
      case '16:9': return 'aspect-video max-w-full';
      case '9:16': return 'aspect-[9/16] max-h-full';
      case '1:1': return 'aspect-square max-h-full';
      case '4:3': return 'aspect-[4/3] max-w-full';
      default: return 'aspect-video';
    }
  };

  const formatTime = (seconds: number) => {
    return seconds.toFixed(1);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#FFFDF5] p-4 lg:p-8 overflow-hidden">
      {/* Game Container - Responsive Aspect Ratio */}
      <div 
        ref={containerRef}
        className={`relative w-full max-w-[1600px] bg-white border-4 border-black shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] rounded-2xl overflow-hidden flex flex-col ${getAspectRatioStyle()}`}
        style={{ 
          width: settings.aspectRatio === '9:16' ? 'auto' : '100%', 
          height: settings.aspectRatio === '9:16' ? '100%' : 'auto' 
        }}
      >
        
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
                {phase === 'showing' ? 'Find Differences' : phase === 'revealing' ? 'Revealing...' : 'Next Puzzle'}
              </h2>
              <span className="text-xs font-bold uppercase tracking-widest opacity-70 text-black">
                Puzzle {currentIndex + 1} / {puzzles.length}
              </span>
            </div>
          </div>

          {/* Timer & Controls */}
          <div className="flex items-center space-x-6">
            <div className="flex flex-col items-end">
              <div className="flex items-center space-x-2 bg-black px-4 py-1 rounded-full border-2 border-black">
                <div className={`w-3 h-3 rounded-full ${timeLeft <= 2 ? 'bg-[#FF6B6B] animate-pulse' : 'bg-[#4ECDC4]'}`} />
                <span className={`font-mono text-xl font-bold ${timeLeft <= 2 ? 'text-[#FF6B6B]' : 'text-white'}`}>
                  {formatTime(timeLeft)}s
                </span>
              </div>
              <div className="w-32 h-3 bg-white border-2 border-black rounded-full mt-1 overflow-hidden shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                <motion.div 
                  className="h-full bg-[#FF6B6B]"
                  style={{ 
                    width: `${
                      phase === 'showing' 
                        ? ((settings.showDuration - timeLeft) / settings.showDuration) * 100 
                        : phase === 'revealing'
                        ? ((settings.revealDuration - timeLeft) / settings.revealDuration) * 100
                        : 0
                    }%` 
                  }}
                />
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <button 
                onClick={() => setIsPlaying(!isPlaying)} 
                className="p-2 bg-white border-2 border-black rounded-lg hover:bg-slate-100 transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
              >
                {isPlaying ? <Pause size={24} strokeWidth={3} /> : <Play size={24} strokeWidth={3} />}
              </button>
              <button 
                onClick={handleSkip} 
                className="p-2 bg-white border-2 border-black rounded-lg hover:bg-slate-100 transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
              >
                <SkipForward size={24} strokeWidth={3} />
              </button>
            </div>
          </div>
        </div>

        {/* Game Area */}
        <div className="flex-1 relative bg-[#4ECDC4] overflow-hidden flex items-center justify-center p-4">
          {/* Background Pattern */}
          <div className="absolute inset-0 opacity-10" 
               style={{ backgroundImage: 'radial-gradient(circle, #000 2px, transparent 2px)', backgroundSize: '24px 24px' }} 
          />

          <AnimatePresence mode="wait">
            {phase !== 'finished' && (
              <motion.div
                key={currentPuzzle.imageA + currentIndex}
                initial={settings.transitionStyle === 'slide' ? { x: '100%' } : { opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={settings.transitionStyle === 'slide' ? { x: '-100%' } : { opacity: 0 }}
                transition={{ duration: settings.transitionDuration }}
                className="relative w-full h-full flex gap-4 items-center justify-center"
              >
                {/* Original Image */}
                <div className="relative h-full flex-1 bg-white border-4 border-black rounded-xl overflow-hidden shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] group">
                  <div className="absolute top-0 left-0 bg-black text-white px-4 py-1 font-black uppercase tracking-wider border-b-4 border-r-4 border-black rounded-br-xl z-10 text-sm">
                    Original
                  </div>
                  <img 
                    src={currentPuzzle.imageA} 
                    alt="Original" 
                    className="w-full h-full object-contain pointer-events-none select-none bg-white"
                  />
                </div>

                {/* Interactive Image (Video Mode) */}
                <div className="relative h-full flex-1 bg-white border-4 border-black rounded-xl overflow-hidden shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] group">
                  <div className="absolute top-0 left-0 bg-[#FF6B6B] text-black px-4 py-1 font-black uppercase tracking-wider border-b-4 border-r-4 border-black rounded-br-xl z-10 animate-pulse text-sm">
                    Spot Differences
                  </div>
                  
                  <div className="relative w-full h-full">
                    <img 
                      src={currentPuzzle.imageB} 
                      alt="Find Differences" 
                      className="w-full h-full object-contain select-none bg-white pointer-events-none"
                    />
                    
                    {/* Reveal Overlay */}
                    <AnimatePresence>
                      {phase === 'revealing' && currentPuzzle.regions.map((region, idx) => (
                        <motion.div
                          key={region.id}
                          initial={{ opacity: 0, scale: 1.5 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: idx * 0.5, duration: 0.5 }}
                          className="absolute z-20"
                          style={{
                            left: `${region.x * 100}%`,
                            top: `${region.y * 100}%`,
                            width: `${region.width * 100}%`,
                            height: `${region.height * 100}%`,
                          }}
                        >
                          {settings.revealStyle === 'box' && (
                            <div className="w-full h-full border-4" style={{ borderColor: settings.revealColor }} />
                          )}
                          {settings.revealStyle === 'circle' && (
                            <div className="w-full h-full border-4 rounded-full scale-125" style={{ borderColor: settings.revealColor }} />
                          )}
                          {settings.revealStyle === 'highlight' && (
                            <div className="w-full h-full opacity-50" style={{ backgroundColor: settings.revealColor }} />
                          )}
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Playback Complete Overlay */}
          {phase === 'finished' && (
            <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-50 backdrop-blur-sm">
              <motion.div 
                initial={{ scale: 0.8, rotate: -2 }}
                animate={{ scale: 1, rotate: 0 }}
                className="p-12 rounded-3xl border-8 border-black shadow-[16px_16px_0px_0px_rgba(255,255,255,1)] text-center max-w-lg w-full bg-[#FFD93D] relative overflow-hidden"
              >
                <div className="absolute top-0 left-0 w-full h-4 bg-white/20 -skew-y-2 transform origin-top-left" />
                
                <div className="inline-block mb-6 bg-white p-6 rounded-full border-4 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                  <CheckCircle size={64} className="text-[#4ECDC4] fill-current stroke-black stroke-2" />
                </div>
                
                <h2 className="text-5xl font-black font-display uppercase mb-2 text-black leading-none tracking-tight">
                  Playback Complete!
                </h2>
                <p className="text-xl font-bold text-black/80 mb-8 font-mono">
                  All puzzles shown.
                </p>
                
                <div className="flex space-x-4">
                  <button 
                    onClick={onExit}
                    className="flex-1 py-4 bg-white text-black text-lg font-black uppercase tracking-wider rounded-xl hover:bg-slate-50 transition-colors border-4 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
                  >
                    Exit
                  </button>
                  <button 
                    onClick={handleReplay}
                    className="flex-1 py-4 bg-black text-white text-lg font-black uppercase tracking-wider rounded-xl hover:bg-slate-900 transition-colors border-4 border-black shadow-[4px_4px_0px_0px_rgba(255,255,255,1)] flex items-center justify-center space-x-2"
                  >
                    <RotateCcw size={20} />
                    <span>Replay</span>
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </div>

        {/* Progress Footer */}
        <div className="h-16 bg-white border-t-4 border-black flex items-center justify-between px-6 shrink-0 z-20">
          <div className="flex items-center space-x-4">
            <span className="font-black uppercase text-sm tracking-wider text-black">Status:</span>
            <div className="px-4 py-1 bg-black text-white rounded-full font-bold uppercase text-xs tracking-wider">
              {phase}
            </div>
          </div>
          <div className="font-black uppercase text-sm tracking-wider text-slate-400">
            {currentIndex + 1} / {puzzles.length} Puzzles
          </div>
        </div>
      </div>
    </div>
  );
};
