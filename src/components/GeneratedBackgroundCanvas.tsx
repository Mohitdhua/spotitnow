import React, { useEffect, useRef, useState } from 'react';
import type { GeneratedBackgroundRecipe } from '../types';
import { renderGeneratedBackgroundToCanvas } from '../services/generatedBackgrounds';

interface GeneratedBackgroundCanvasProps {
  spec: GeneratedBackgroundRecipe;
  className?: string;
  showSafeArea?: boolean;
  animate?: boolean;
  paused?: boolean;
  timeSeconds?: number;
}

export function GeneratedBackgroundCanvas({
  spec,
  className = '',
  showSafeArea = false,
  animate = false,
  paused = false,
  timeSeconds
}: GeneratedBackgroundCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationTimeRef = useRef(0);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const node = containerRef.current;
    if (!node) {
      return;
    }

    setSize({
      width: Math.max(1, Math.round(node.clientWidth || 1)),
      height: Math.max(1, Math.round(node.clientHeight || 1))
    });

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const nextWidth = Math.max(1, Math.round(entry.contentRect.width));
      const nextHeight = Math.max(1, Math.round(entry.contentRect.height));
      setSize((current) =>
        current.width === nextWidth && current.height === nextHeight
          ? current
          : { width: nextWidth, height: nextHeight }
      );
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!canvasRef.current || size.width <= 0 || size.height <= 0) {
      return;
    }
    const canvas = canvasRef.current;
    const deviceScale = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const renderWidth = Math.max(1, Math.round(size.width * deviceScale));
    const renderHeight = Math.max(1, Math.round(size.height * deviceScale));
    canvas.width = renderWidth;
    canvas.height = renderHeight;
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;

    let animationFrameId = 0;

    const paint = (effectiveTime: number) => {
      renderGeneratedBackgroundToCanvas(spec, renderWidth, renderHeight, canvas, effectiveTime);
    };

    if (typeof timeSeconds === 'number') {
      animationTimeRef.current = timeSeconds;
      paint(timeSeconds);
      return;
    }

    if (!animate || paused) {
      paint(animationTimeRef.current);
      return;
    }

    const startedAt = performance.now() - animationTimeRef.current * 1000;
    const tick = (now: number) => {
      animationTimeRef.current = (now - startedAt) / 1000;
      paint(animationTimeRef.current);
      animationFrameId = window.requestAnimationFrame(tick);
    };

    animationFrameId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [animate, paused, size.height, size.width, spec, timeSeconds]);

  return (
    <div ref={containerRef} className={`relative overflow-hidden ${className}`}>
      <canvas ref={canvasRef} className="block h-full w-full" />
      {showSafeArea && (
        <>
          <div className="pointer-events-none absolute inset-[10%] rounded-[24px] border-2 border-white/80 shadow-[0_0_0_1px_rgba(0,0,0,0.55)]" />
          <div className="pointer-events-none absolute inset-x-[24%] top-[20%] h-[14%] rounded-full border border-white/70" />
        </>
      )}
    </div>
  );
}
