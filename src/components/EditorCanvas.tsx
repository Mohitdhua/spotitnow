import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { Save, Trash2, Undo, Play, Download, X, Plus, Sparkles, Loader2 } from 'lucide-react';
import { Region, Puzzle } from '../types';
import { detectDifferences } from '../services/ai';

interface EditorCanvasProps {
  imageA: string;
  imageB: string;
  onSave: (puzzle: Puzzle) => void;
  onPlay: (puzzle: Puzzle) => void;
  onAddToBatch: (puzzle: Puzzle) => void;
  batchCount: number;
}

export function EditorCanvas({ imageA, imageB, onSave, onPlay, onAddToBatch, batchCount }: EditorCanvasProps) {
  const [regions, setRegions] = useState<Region[]>([]);
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
    <div className="flex flex-col h-full w-full max-w-6xl mx-auto p-4 space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-slate-800">Mark Differences</h2>
        <div className="flex space-x-2">
          <button 
            onClick={handleAutoDetect} 
            disabled={isDetecting}
            className="flex items-center space-x-2 px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg font-medium transition-colors border border-indigo-200"
            title="Auto-detect differences with AI"
          >
            {isDetecting ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Sparkles size={18} />
            )}
            <span>{isDetecting ? 'Detecting...' : 'Auto Detect'}</span>
          </button>
          <div className="w-px h-6 bg-slate-300 mx-2" />
          <button onClick={handleUndo} className="p-2 text-slate-600 hover:bg-slate-100 rounded-full" title="Undo">
            <Undo size={20} />
          </button>
          <button onClick={handleClear} className="p-2 text-red-500 hover:bg-red-50 rounded-full" title="Clear All">
            <Trash2 size={20} />
          </button>
          <div className="w-px h-6 bg-slate-300 mx-2" />
          
          <button 
            onClick={handleAddToBatch}
            disabled={regions.length === 0}
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-colors ${regions.length === 0 ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200'}`}
          >
            <Plus size={18} />
            <span>Add to Batch ({batchCount})</span>
          </button>

          <button 
            onClick={handleExport} 
            disabled={regions.length === 0}
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-colors ${regions.length === 0 ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}
          >
            <Download size={18} />
            <span>{batchCount > 0 ? 'Download All' : 'Save JSON'}</span>
          </button>
          <button 
            onClick={handlePlay} 
            disabled={regions.length === 0}
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-medium shadow-md transition-colors ${regions.length === 0 ? 'bg-indigo-300 text-white cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 text-white'}`}
          >
            <Play size={18} />
            <span>Play Now</span>
          </button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-8 flex-1 min-h-0 justify-center items-start overflow-auto p-4">
        {/* Original Image (Reference) */}
        <div className="relative rounded-xl overflow-hidden shadow-lg border border-slate-200 max-w-[45%]">
          <div className="absolute top-2 left-2 bg-black/50 text-white text-xs px-2 py-1 rounded backdrop-blur-sm z-10">
            Original
          </div>
          <img src={imageA} alt="Original" className="block max-h-[70vh] w-auto h-auto" />
        </div>

        {/* Modified Image (Editor) */}
        <div className="relative rounded-xl overflow-hidden shadow-lg border border-slate-200 max-w-[45%] group cursor-crosshair">
          <div className="absolute top-2 left-2 bg-indigo-600/80 text-white text-xs px-2 py-1 rounded backdrop-blur-sm z-10 pointer-events-none">
            Draw Here
          </div>
          
          <img 
            ref={imageRef}
            src={imageB} 
            alt="Modified" 
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
            className="absolute top-0 left-0 w-full h-full"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          />
        </div>
      </div>
      
      <div className="text-center text-slate-500 text-sm">
        Click and drag on the right image to mark differences.
      </div>
    </div>
  );
}
