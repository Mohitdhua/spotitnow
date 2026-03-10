import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { Save, Trash2, Undo, Play, Download, X, Plus, Sparkles, Loader2, Video } from 'lucide-react';
import { Region, Puzzle } from '../types';
import { detectDifferences } from '../services/ai';

interface EditorCanvasProps {
  imageA: string;
  imageB: string;
  initialRegions?: Region[];
  onSave: (puzzle: Puzzle) => void;
  onPlay?: (puzzle: Puzzle) => void;
  onAddToBatch?: (puzzle: Puzzle) => void;
  onExportVideo?: (puzzle: Puzzle) => void;
  batchCount?: number;
  isModal?: boolean;
}

export function EditorCanvas({
  imageA,
  imageB,
  initialRegions = [],
  onSave,
  onPlay,
  onAddToBatch,
  onExportVideo,
  batchCount,
  isModal = false
}: EditorCanvasProps) {
  const [regions, setRegions] = useState<Region[]>(initialRegions);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null);
  const [currentRegion, setCurrentRegion] = useState<Region | null>(null);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  // Redraw canvas whenever regions or current drawing changes
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const img = imageRef.current;

    if (canvas && ctx && img) {
      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw all saved regions
      regions.forEach(region => {
        drawRegion(ctx, region, 'rgba(0, 255, 0, 0.3)', 'rgba(0, 255, 0, 0.8)');
      });

      // Draw current region being drawn
      if (currentRegion) {
        drawRegion(ctx, currentRegion, 'rgba(59, 130, 246, 0.3)', 'rgba(59, 130, 246, 0.8)');
      }
    }
  }, [regions, currentRegion]);

  const drawRegion = (ctx: CanvasRenderingContext2D, region: Region, fillColor: string, strokeColor: string) => {
    const img = imageRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;

    // Convert normalized coordinates back to canvas coordinates
    const x = region.x * canvas.width;
    const y = region.y * canvas.height;
    const w = region.width * canvas.width;
    const h = region.height * canvas.height;

    ctx.fillStyle = fillColor;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2;
    
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
  };

  const getNormalizedPoint = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    
    return { x, y };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDrawing(true);
    const point = getNormalizedPoint(e);
    setStartPoint(point);
    setCurrentRegion({
      id: 'temp',
      x: point.x,
      y: point.y,
      width: 0,
      height: 0
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDrawing || !startPoint) return;

    const currentPoint = getNormalizedPoint(e);
    
    const x = Math.min(startPoint.x, currentPoint.x);
    const y = Math.min(startPoint.y, currentPoint.y);
    const width = Math.abs(currentPoint.x - startPoint.x);
    const height = Math.abs(currentPoint.y - startPoint.y);

    setCurrentRegion({
      id: 'temp',
      x,
      y,
      width,
      height
    });
  };

  const handleMouseUp = () => {
    if (isDrawing && currentRegion && currentRegion.width > 0.01 && currentRegion.height > 0.01) {
      const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2) + Date.now().toString(36);
      setRegions([...regions, { ...currentRegion, id }]);
    }
    setIsDrawing(false);
    setStartPoint(null);
    setCurrentRegion(null);
  };

  const handleUndo = () => {
    setRegions(regions.slice(0, -1));
  };

  const handleClear = () => {
    setRegions([]);
  };

  const handleExport = () => {
    const puzzle: Puzzle = {
      imageA,
      imageB,
      regions,
      title: 'My Spot the Difference Puzzle'
    };
    onSave(puzzle);
  };

  const handleAddToBatch = () => {
    const puzzle: Puzzle = {
      imageA,
      imageB,
      regions,
      title: `Puzzle ${batchCount + 1}`
    };
    onAddToBatch(puzzle);
  };

  const handlePlay = () => {
    const puzzle: Puzzle = {
      imageA,
      imageB,
      regions
    };
    onPlay(puzzle);
  };

  const handleExportVideo = () => {
    if (!onExportVideo) return;
    const puzzle: Puzzle = {
      imageA,
      imageB,
      regions,
      title: `Puzzle ${(batchCount ?? 0) + 1}`
    };
    onExportVideo(puzzle);
  };

  const handleAutoDetect = async () => {
    setIsDetecting(true);
    try {
      const differences = await detectDifferences(imageA, imageB);
      
      const newRegions: Region[] = differences.map(diff => ({
        id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2),
        x: diff.xmin,
        y: diff.ymin,
        width: diff.xmax - diff.xmin,
        height: diff.ymax - diff.ymin
      }));

      setRegions(prev => [...prev, ...newRegions]);
    } catch (error) {
      alert('Failed to detect differences automatically. Please try again or mark them manually.');
    } finally {
      setIsDetecting(false);
    }
  };

  return (
    <div className="flex flex-col h-full w-full max-w-7xl mx-auto p-3 sm:p-6 space-y-4 sm:space-y-6">
      <div className="bg-white p-4 border-4 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] rounded-xl space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <h2 className="text-2xl sm:text-3xl font-black text-black font-display uppercase tracking-tight">Mark Differences</h2>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <button 
              onClick={handleAutoDetect} 
              disabled={isDetecting}
              className="flex items-center gap-2 px-4 py-2 bg-[#F3E8FF] hover:bg-[#E9D5FF] text-black border-2 border-black rounded-lg font-bold transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[1px] hover:translate-x-[1px] hover:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
              title="Auto-detect differences with AI"
            >
              {isDetecting ? (
                <Loader2 size={20} className="animate-spin" strokeWidth={2.5} />
              ) : (
                <Sparkles size={20} strokeWidth={2.5} />
              )}
              <span className="uppercase">{isDetecting ? 'Detecting...' : 'Auto Detect'}</span>
            </button>
            <div className="hidden sm:block w-1 h-8 bg-black mx-1" />
            <button onClick={handleUndo} className="p-2 text-black hover:bg-slate-100 border-2 border-transparent hover:border-black rounded-lg transition-all" title="Undo">
              <Undo size={24} strokeWidth={2.5} />
            </button>
            <button onClick={handleClear} className="p-2 text-[#FF6B6B] hover:bg-[#FFF5F5] border-2 border-transparent hover:border-[#FF6B6B] rounded-lg transition-all" title="Clear All">
              <Trash2 size={24} strokeWidth={2.5} />
            </button>
          </div>
        </div>

        <div className={`grid gap-2 ${isModal ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4'}`}>
          {isModal ? (
            <button 
              onClick={handleExport} 
              disabled={regions.length === 0}
              className={`flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-black uppercase tracking-wide transition-all border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] ${regions.length === 0 ? 'bg-slate-200 text-slate-400 cursor-not-allowed border-slate-400 shadow-none' : 'bg-[#4ECDC4] hover:bg-[#3DBDB4] text-black'}`}
            >
              <Save size={20} strokeWidth={3} />
              <span>Save Changes</span>
            </button>
          ) : (
            <>
              <button 
                onClick={handleAddToBatch}
                disabled={regions.length === 0}
                className={`flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-bold uppercase transition-all border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[1px] hover:translate-x-[1px] hover:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] ${regions.length === 0 ? 'bg-slate-200 text-slate-400 cursor-not-allowed border-slate-400 shadow-none' : 'bg-[#A7F3D0] hover:bg-[#6EE7B7] text-black'}`}
              >
                <Plus size={20} strokeWidth={2.5} />
                <span>Add ({batchCount})</span>
              </button>

              <button 
                onClick={handleExport} 
                disabled={regions.length === 0}
                className={`flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-bold uppercase transition-all border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[1px] hover:translate-x-[1px] hover:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] ${regions.length === 0 ? 'bg-slate-200 text-slate-400 cursor-not-allowed border-slate-400 shadow-none' : 'bg-white hover:bg-slate-50 text-black'}`}
              >
                <Download size={20} strokeWidth={2.5} />
                <span>JSON</span>
              </button>
              {onExportVideo && (
                <button
                  onClick={handleExportVideo}
                  disabled={regions.length === 0}
                  className={`flex items-center justify-center gap-1.5 px-3 py-3 rounded-lg text-xs font-black uppercase tracking-wide transition-all border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[1px] hover:translate-x-[1px] hover:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] ${
                    regions.length === 0
                      ? 'bg-slate-200 text-slate-400 cursor-not-allowed border-slate-400 shadow-none'
                      : 'bg-[#E0E7FF] hover:bg-[#C7D2FE] text-black'
                  }`}
                >
                  <Video size={16} strokeWidth={2.5} />
                  <span>Export Video</span>
                </button>
              )}
              <button 
                onClick={handlePlay} 
                disabled={regions.length === 0}
                className={`flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-black uppercase tracking-wide transition-all border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] ${regions.length === 0 ? 'bg-slate-200 text-slate-400 cursor-not-allowed border-slate-400 shadow-none' : 'bg-[#FFD93D] hover:bg-[#FCD34D] text-black'}`}
              >
                <Play size={20} strokeWidth={3} />
                <span>Play</span>
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-5 sm:gap-8 flex-1 min-h-0 justify-center items-stretch overflow-auto p-1 sm:p-4">
        <div className="relative w-full rounded-xl overflow-hidden shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] border-4 border-black bg-white lg:max-w-[45%]">
          <div className="absolute top-0 left-0 bg-black text-white text-sm px-3 py-1 font-bold uppercase z-10 border-b-2 border-r-2 border-black rounded-br-lg">
            Original
          </div>
          <img src={imageA} alt="Original" className="block w-full max-h-[52vh] sm:max-h-[65vh] object-contain" />
        </div>

        <div className="relative w-full rounded-xl overflow-hidden shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] border-4 border-black group cursor-crosshair bg-white lg:max-w-[45%]">
          <div className="absolute top-0 left-0 bg-[#FF6B6B] text-black text-sm px-3 py-1 font-bold uppercase z-10 border-b-2 border-r-2 border-black rounded-br-lg animate-pulse">
            Draw Here
          </div>
          
          <img 
            ref={imageRef}
            src={imageB} 
            alt="Modified" 
            className="block w-full max-h-[52vh] sm:max-h-[65vh] object-contain pointer-events-none select-none"
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
            className="absolute top-0 left-0 w-full h-full"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          />
        </div>
      </div>
      
      <div className="text-center text-black font-bold text-xs sm:text-sm uppercase tracking-widest bg-[#FFFDF5] p-2 border-2 border-black inline-block mx-auto shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] -rotate-1 max-w-full">
        Click and drag on the right image to mark differences
      </div>
    </div>
  );
}
