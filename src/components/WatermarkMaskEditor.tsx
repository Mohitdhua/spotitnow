/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from 'react';

export type WatermarkBrushMode = 'erase_watermark' | 'protect_original';

interface WatermarkMaskEditorProps {
  title: string;
  subtitle: string;
  imageUrl: string | null;
  width: number;
  height: number;
  mask: Uint8Array | null;
  heatmap: number[] | null;
  brushMode: WatermarkBrushMode;
  brushSize: number;
  showMaskOverlay: boolean;
  showHeatmapOverlay: boolean;
  disabled?: boolean;
  onMaskChange?: (nextMask: Uint8Array) => void;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const drawOverlay = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  mask: Uint8Array | null,
  heatmap: number[] | null,
  showMaskOverlay: boolean,
  showHeatmapOverlay: boolean
) => {
  if (showHeatmapOverlay && heatmap && heatmap.length === width * height) {
    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = width;
    overlayCanvas.height = height;
    const overlayContext = overlayCanvas.getContext('2d');
    if (!overlayContext) {
      return;
    }
    const heatmapImage = ctx.createImageData(width, height);
    for (let index = 0, dataIndex = 0; index < heatmap.length; index += 1, dataIndex += 4) {
      const value = clamp(heatmap[index] ?? 0, 0, 1);
      if (value <= 0.01) continue;
      heatmapImage.data[dataIndex] = 255;
      heatmapImage.data[dataIndex + 1] = Math.round(180 * (1 - value));
      heatmapImage.data[dataIndex + 2] = 32;
      heatmapImage.data[dataIndex + 3] = Math.round(value * 150);
    }
    overlayContext.putImageData(heatmapImage, 0, 0);
    ctx.drawImage(overlayCanvas, 0, 0);
  }

  if (showMaskOverlay && mask && mask.length === width * height) {
    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = width;
    overlayCanvas.height = height;
    const overlayContext = overlayCanvas.getContext('2d');
    if (!overlayContext) {
      return;
    }
    const maskImage = ctx.createImageData(width, height);
    for (let index = 0, dataIndex = 0; index < mask.length; index += 1, dataIndex += 4) {
      if (mask[index] === 0) continue;
      maskImage.data[dataIndex] = 16;
      maskImage.data[dataIndex + 1] = 196;
      maskImage.data[dataIndex + 2] = 255;
      maskImage.data[dataIndex + 3] = 140;
    }
    overlayContext.putImageData(maskImage, 0, 0);
    ctx.drawImage(overlayCanvas, 0, 0);
  }
};

export function WatermarkMaskEditor({
  title,
  subtitle,
  imageUrl,
  width,
  height,
  mask,
  heatmap,
  brushMode,
  brushSize,
  showMaskOverlay,
  showHeatmapOverlay,
  disabled = false,
  onMaskChange
}: WatermarkMaskEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const draftMaskRef = useRef<Uint8Array | null>(null);
  const isDraggingRef = useRef(false);
  const brushModeRef = useRef(brushMode);
  const brushSizeRef = useRef(brushSize);
  const onMaskChangeRef = useRef(onMaskChange);

  brushModeRef.current = brushMode;
  brushSizeRef.current = brushSize;
  onMaskChangeRef.current = onMaskChange;

  const redraw = (nextMask?: Uint8Array | null) => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || width <= 0 || height <= 0) {
      return;
    }

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
    drawOverlay(
      ctx,
      width,
      height,
      nextMask ?? mask,
      heatmap,
      showMaskOverlay,
      showHeatmapOverlay
    );
  };

  useEffect(() => {
    if (!imageUrl || width <= 0 || height <= 0) {
      imageRef.current = null;
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }

    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      imageRef.current = image;
      redraw(draftMaskRef.current ?? mask);
    };
    image.src = imageUrl;

    return () => {
      if (imageRef.current === image) {
        imageRef.current = null;
      }
    };
  }, [imageUrl, width, height]);

  useEffect(() => {
    if (!isDraggingRef.current) {
      redraw(mask);
    }
  }, [mask, heatmap, showMaskOverlay, showHeatmapOverlay, width, height]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!isDraggingRef.current) {
        return;
      }

      const canvas = canvasRef.current;
      const draftMask = draftMaskRef.current;
      if (!canvas || !draftMask) {
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const x = Math.round(((event.clientX - rect.left) / Math.max(1, rect.width)) * width);
      const y = Math.round(((event.clientY - rect.top) / Math.max(1, rect.height)) * height);
      const radius = Math.max(1, Math.round(brushSizeRef.current));
      const nextValue = brushModeRef.current === 'erase_watermark' ? 255 : 0;

      for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
        for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
          if (offsetX * offsetX + offsetY * offsetY > radius * radius) continue;
          const targetX = clamp(x + offsetX, 0, width - 1);
          const targetY = clamp(y + offsetY, 0, height - 1);
          draftMask[targetY * width + targetX] = nextValue;
        }
      }

      redraw(draftMask);
    };

    const handlePointerUp = () => {
      if (!isDraggingRef.current) {
        return;
      }

      isDraggingRef.current = false;
      const draftMask = draftMaskRef.current;
      if (draftMask && onMaskChangeRef.current) {
        onMaskChangeRef.current(new Uint8Array(draftMask));
      }
      draftMaskRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [width, height]);

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled || !mask || !onMaskChange || width <= 0 || height <= 0) {
      return;
    }

    event.preventDefault();
    draftMaskRef.current = new Uint8Array(mask);
    isDraggingRef.current = true;
    const canvas = canvasRef.current;
    const draftMask = draftMaskRef.current;
    if (!canvas || !draftMask) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const x = Math.round(((event.clientX - rect.left) / Math.max(1, rect.width)) * width);
    const y = Math.round(((event.clientY - rect.top) / Math.max(1, rect.height)) * height);
    const radius = Math.max(1, Math.round(brushSizeRef.current));
    const nextValue = brushModeRef.current === 'erase_watermark' ? 255 : 0;

    for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
      for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
        if (offsetX * offsetX + offsetY * offsetY > radius * radius) continue;
        const targetX = clamp(x + offsetX, 0, width - 1);
        const targetY = clamp(y + offsetY, 0, height - 1);
        draftMask[targetY * width + targetX] = nextValue;
      }
    }

    redraw(draftMask);
  };

  return (
    <div className="rounded-2xl border-2 border-black bg-white overflow-hidden">
      <div className="border-b-2 border-black px-4 py-3">
        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">
          {title}
        </div>
        <div className="mt-1 text-[11px] font-bold uppercase text-slate-500">{subtitle}</div>
      </div>
      <div className="bg-[#F8FAFC] p-3">
        {imageUrl ? (
          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            className={`w-full h-auto rounded-xl border border-black bg-white ${
              disabled ? 'cursor-default' : brushMode === 'erase_watermark' ? 'cursor-crosshair' : 'cursor-cell'
            }`}
          />
        ) : (
          <div className="flex min-h-72 items-center justify-center rounded-xl border border-dashed border-black bg-white text-xs font-black uppercase text-slate-500">
            Load a puzzle image first
          </div>
        )}
      </div>
    </div>
  );
}
