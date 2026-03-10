/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from 'react';
import type { WatermarkRegion } from '../services/watermarkRemoval';

interface WatermarkRegionEditorProps {
  title: string;
  subtitle: string;
  imageUrl: string | null;
  width: number;
  height: number;
  regions: WatermarkRegion[];
  selectedRegionId: string | null;
  disabled?: boolean;
  onRegionsChange: (nextRegions: WatermarkRegion[]) => void;
  onSelectedRegionChange: (regionId: string | null) => void;
}

type InteractionState =
  | {
      kind: 'draw';
      startX: number;
      startY: number;
      currentX: number;
      currentY: number;
    }
  | {
      kind: 'move';
      regionId: string;
      pointerStartX: number;
      pointerStartY: number;
      regionStartX: number;
      regionStartY: number;
    };

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const getCanvasPoint = (
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  width: number,
  height: number
) => {
  const rect = canvas.getBoundingClientRect();
  return {
    x: clamp(Math.round(((clientX - rect.left) / Math.max(1, rect.width)) * width), 0, width - 1),
    y: clamp(Math.round(((clientY - rect.top) / Math.max(1, rect.height)) * height), 0, height - 1)
  };
};

const normalizeRect = (
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  width: number,
  height: number
): Pick<WatermarkRegion, 'x' | 'y' | 'width' | 'height'> | null => {
  const x0 = clamp(Math.min(startX, endX), 0, width - 1);
  const y0 = clamp(Math.min(startY, endY), 0, height - 1);
  const x1 = clamp(Math.max(startX, endX), 0, width - 1);
  const y1 = clamp(Math.max(startY, endY), 0, height - 1);
  const rectWidth = x1 - x0 + 1;
  const rectHeight = y1 - y0 + 1;

  if (rectWidth < 4 || rectHeight < 4) {
    return null;
  }

  return {
    x: x0,
    y: y0,
    width: rectWidth,
    height: rectHeight
  };
};

const findRegionAtPoint = (
  regions: WatermarkRegion[],
  x: number,
  y: number
): WatermarkRegion | null => {
  for (let index = regions.length - 1; index >= 0; index -= 1) {
    const region = regions[index];
    if (
      x >= region.x &&
      x < region.x + region.width &&
      y >= region.y &&
      y < region.y + region.height
    ) {
      return region;
    }
  }
  return null;
};

const drawEditor = (
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
  regions: WatermarkRegion[],
  selectedRegionId: string | null,
  draftRect: Pick<WatermarkRegion, 'x' | 'y' | 'width' | 'height'> | null
) => {
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);

  for (let index = 0; index < regions.length; index += 1) {
    const region = regions[index];
    const isSelected = region.id === selectedRegionId;
    ctx.fillStyle = isSelected ? 'rgba(34, 197, 94, 0.18)' : 'rgba(239, 68, 68, 0.16)';
    ctx.strokeStyle = isSelected ? '#16A34A' : '#DC2626';
    ctx.lineWidth = isSelected ? 3 : 2;
    ctx.fillRect(region.x, region.y, region.width, region.height);
    ctx.strokeRect(region.x, region.y, region.width, region.height);

    ctx.fillStyle = isSelected ? '#14532D' : '#7F1D1D';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(`${index + 1}`, region.x + 6, region.y + 18);
  }

  if (draftRect) {
    ctx.fillStyle = 'rgba(14, 165, 233, 0.18)';
    ctx.strokeStyle = '#0284C7';
    ctx.lineWidth = 2;
    ctx.fillRect(draftRect.x, draftRect.y, draftRect.width, draftRect.height);
    ctx.strokeRect(draftRect.x, draftRect.y, draftRect.width, draftRect.height);
  }
};

export function WatermarkRegionEditor({
  title,
  subtitle,
  imageUrl,
  width,
  height,
  regions,
  selectedRegionId,
  disabled = false,
  onRegionsChange,
  onSelectedRegionChange
}: WatermarkRegionEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const interactionRef = useRef<InteractionState | null>(null);
  const draftRegionsRef = useRef<WatermarkRegion[] | null>(null);

  const redraw = (
    nextRegions: WatermarkRegion[] = regions,
    nextSelectedRegionId: string | null = selectedRegionId,
    draftRect: Pick<WatermarkRegion, 'x' | 'y' | 'width' | 'height'> | null = null
  ) => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || width <= 0 || height <= 0) {
      return;
    }

    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    drawEditor(context, image, width, height, nextRegions, nextSelectedRegionId, draftRect);
  };

  useEffect(() => {
    if (!imageUrl || width <= 0 || height <= 0) {
      imageRef.current = null;
      return;
    }

    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      imageRef.current = image;
      redraw();
    };
    image.src = imageUrl;

    return () => {
      if (imageRef.current === image) {
        imageRef.current = null;
      }
    };
  }, [imageUrl, width, height]);

  useEffect(() => {
    if (!interactionRef.current) {
      redraw();
    }
  }, [regions, selectedRegionId, width, height]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const canvas = canvasRef.current;
      const interaction = interactionRef.current;
      if (!canvas || !interaction) {
        return;
      }

      const point = getCanvasPoint(canvas, event.clientX, event.clientY, width, height);

      if (interaction.kind === 'draw') {
        interaction.currentX = point.x;
        interaction.currentY = point.y;
        redraw(
          regions,
          selectedRegionId,
          normalizeRect(
            interaction.startX,
            interaction.startY,
            interaction.currentX,
            interaction.currentY,
            width,
            height
          )
        );
        return;
      }

      const draftRegions = draftRegionsRef.current ?? regions;
      const deltaX = point.x - interaction.pointerStartX;
      const deltaY = point.y - interaction.pointerStartY;
      const nextRegions = draftRegions.map((region) =>
        region.id !== interaction.regionId
          ? region
          : {
              ...region,
              x: clamp(interaction.regionStartX + deltaX, 0, Math.max(0, width - region.width)),
              y: clamp(interaction.regionStartY + deltaY, 0, Math.max(0, height - region.height))
            }
      );
      draftRegionsRef.current = nextRegions;
      redraw(nextRegions, interaction.regionId);
    };

    const handlePointerUp = () => {
      const interaction = interactionRef.current;
      if (!interaction) {
        return;
      }

      if (interaction.kind === 'draw') {
        const nextRect = normalizeRect(
          interaction.startX,
          interaction.startY,
          interaction.currentX,
          interaction.currentY,
          width,
          height
        );
        if (nextRect) {
          const nextRegion: WatermarkRegion = {
            id: `watermark-region-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            ...nextRect
          };
          const nextRegions = [...regions, nextRegion];
          onRegionsChange(nextRegions);
          onSelectedRegionChange(nextRegion.id);
        } else {
          redraw();
        }
      } else if (draftRegionsRef.current) {
        onRegionsChange(draftRegionsRef.current);
        onSelectedRegionChange(interaction.regionId);
      }

      interactionRef.current = null;
      draftRegionsRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [height, onRegionsChange, onSelectedRegionChange, regions, selectedRegionId, width]);

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled || !imageUrl || width <= 0 || height <= 0) {
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    event.preventDefault();
    const point = getCanvasPoint(canvas, event.clientX, event.clientY, width, height);
    const hitRegion = findRegionAtPoint(regions, point.x, point.y);

    if (hitRegion) {
      interactionRef.current = {
        kind: 'move',
        regionId: hitRegion.id,
        pointerStartX: point.x,
        pointerStartY: point.y,
        regionStartX: hitRegion.x,
        regionStartY: hitRegion.y
      };
      draftRegionsRef.current = regions.map((region) => ({ ...region }));
      onSelectedRegionChange(hitRegion.id);
      redraw(regions, hitRegion.id);
      return;
    }

    interactionRef.current = {
      kind: 'draw',
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y
    };
    onSelectedRegionChange(null);
  };

  return (
    <div className="overflow-hidden rounded-2xl border-2 border-black bg-white">
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
            className={`h-auto w-full rounded-xl border border-black bg-white ${
              disabled ? 'cursor-default' : 'cursor-crosshair'
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
