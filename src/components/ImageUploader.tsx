import React, { useState, useRef } from 'react';
import { Upload, Image as ImageIcon, X } from 'lucide-react';
import { motion } from 'motion/react';

interface ImageUploaderProps {
  onImagesSelected: (imageA: string, imageB: string) => void;
}

export function ImageUploader({ onImagesSelected }: ImageUploaderProps) {
  const [imageA, setImageA] = useState<string | null>(null);
  const [imageB, setImageB] = useState<string | null>(null);
  const fileInputARef = useRef<HTMLInputElement>(null);
  const fileInputBRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, setImage: (url: string | null) => void) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setImage(event.target.result as string);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleStart = () => {
    if (imageA && imageB) {
      onImagesSelected(imageA, imageB);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 space-y-8">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center space-y-2"
      >
        <h1 className="text-4xl font-bold tracking-tight text-slate-900">Create Your Puzzle</h1>
        <p className="text-slate-500 text-lg">Upload two images to spot the difference.</p>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full max-w-4xl">
        {/* Image A Upload */}
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1 }}
          className="relative group"
        >
          <div 
            onClick={() => !imageA && fileInputARef.current?.click()}
            className={`
              relative flex flex-col items-center justify-center w-full aspect-video 
              border-2 border-dashed rounded-xl transition-all duration-200 cursor-pointer
              ${imageA ? 'border-slate-200 bg-slate-50' : 'border-slate-300 hover:border-indigo-500 hover:bg-indigo-50/50'}
            `}
          >
            {imageA ? (
              <>
                <img src={imageA} alt="Original" className="w-full h-full object-contain rounded-lg p-2" />
                <button 
                  onClick={(e) => { e.stopPropagation(); setImageA(null); }}
                  className="absolute top-2 right-2 p-1 bg-white rounded-full shadow-sm hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"
                >
                  <X size={20} />
                </button>
                <div className="absolute bottom-2 left-2 bg-black/50 text-white text-xs px-2 py-1 rounded backdrop-blur-sm">
                  Original Image
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center space-y-4 text-slate-400">
                <div className="p-4 bg-slate-100 rounded-full group-hover:bg-indigo-100 group-hover:text-indigo-600 transition-colors">
                  <ImageIcon size={32} />
                </div>
                <div className="text-center">
                  <p className="font-medium text-slate-600">Upload Original Image</p>
                  <p className="text-sm text-slate-400">Click to browse</p>
                </div>
              </div>
            )}
            <input 
              type="file" 
              ref={fileInputARef} 
              onChange={(e) => handleFileChange(e, setImageA)} 
              accept="image/*" 
              className="hidden" 
            />
          </div>
        </motion.div>

        {/* Image B Upload */}
        <motion.div 
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2 }}
          className="relative group"
        >
          <div 
            onClick={() => !imageB && fileInputBRef.current?.click()}
            className={`
              relative flex flex-col items-center justify-center w-full aspect-video 
              border-2 border-dashed rounded-xl transition-all duration-200 cursor-pointer
              ${imageB ? 'border-slate-200 bg-slate-50' : 'border-slate-300 hover:border-indigo-500 hover:bg-indigo-50/50'}
            `}
          >
            {imageB ? (
              <>
                <img src={imageB} alt="Modified" className="w-full h-full object-contain rounded-lg p-2" />
                <button 
                  onClick={(e) => { e.stopPropagation(); setImageB(null); }}
                  className="absolute top-2 right-2 p-1 bg-white rounded-full shadow-sm hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"
                >
                  <X size={20} />
                </button>
                <div className="absolute bottom-2 left-2 bg-black/50 text-white text-xs px-2 py-1 rounded backdrop-blur-sm">
                  Modified Image
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center space-y-4 text-slate-400">
                <div className="p-4 bg-slate-100 rounded-full group-hover:bg-indigo-100 group-hover:text-indigo-600 transition-colors">
                  <ImageIcon size={32} />
                </div>
                <div className="text-center">
                  <p className="font-medium text-slate-600">Upload Modified Image</p>
                  <p className="text-sm text-slate-400">Click to browse</p>
                </div>
              </div>
            )}
            <input 
              type="file" 
              ref={fileInputBRef} 
              onChange={(e) => handleFileChange(e, setImageB)} 
              accept="image/*" 
              className="hidden" 
            />
          </div>
        </motion.div>
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <button
          onClick={handleStart}
          disabled={!imageA || !imageB}
          className={`
            flex items-center space-x-2 px-8 py-3 rounded-full font-medium text-lg transition-all duration-200
            ${imageA && imageB 
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200 hover:bg-indigo-700 hover:shadow-xl hover:-translate-y-0.5' 
              : 'bg-slate-200 text-slate-400 cursor-not-allowed'}
          `}
        >
          <Upload size={20} />
          <span>Start Creating</span>
        </button>
      </motion.div>
    </div>
  );
}
