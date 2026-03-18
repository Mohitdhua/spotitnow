import { useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { EditorTimelineVisibleRange, EditorTimelineZoomState } from './types';
import { TIMELINE_HEADER_WIDTH, clamp } from './utils';

interface UseTimelineViewportOptions {
  duration: number;
  initialPixelsPerSecond?: number;
  minPixelsPerSecond?: number;
  maxPixelsPerSecond?: number;
}

interface TimelineViewportState {
  scrollRef: RefObject<HTMLDivElement | null>;
  zoom: EditorTimelineZoomState;
  setPixelsPerSecond: (value: number) => void;
  contentWidth: number;
  timeAreaWidth: number;
  visibleRange: EditorTimelineVisibleRange;
  zoomAtClientX: (clientX: number, nextPixelsPerSecond: number) => void;
}

export function useTimelineViewport({
  duration,
  initialPixelsPerSecond = 78,
  minPixelsPerSecond = 18,
  maxPixelsPerSecond = 260
}: UseTimelineViewportOptions): TimelineViewportState {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pixelsPerSecond, setPixelsPerSecondState] = useState(initialPixelsPerSecond);
  const [metrics, setMetrics] = useState({
    scrollLeft: 0,
    scrollTop: 0,
    viewportWidth: 1,
    viewportHeight: 1
  });

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;

    const sync = () => {
      setMetrics({
        scrollLeft: node.scrollLeft,
        scrollTop: node.scrollTop,
        viewportWidth: node.clientWidth,
        viewportHeight: node.clientHeight
      });
    };

    sync();
    node.addEventListener('scroll', sync, { passive: true });
    const resizeObserver = new ResizeObserver(sync);
    resizeObserver.observe(node);

    return () => {
      node.removeEventListener('scroll', sync);
      resizeObserver.disconnect();
    };
  }, []);

  const setPixelsPerSecond = (value: number) => {
    setPixelsPerSecondState(clamp(value, minPixelsPerSecond, maxPixelsPerSecond));
  };

  const timeAreaWidth = Math.max(640, duration * pixelsPerSecond + 240);
  const contentWidth = TIMELINE_HEADER_WIDTH + timeAreaWidth;

  const visibleRange = useMemo<EditorTimelineVisibleRange>(() => {
    const visibleTimelineWidth = Math.max(1, metrics.viewportWidth - TIMELINE_HEADER_WIDTH);
    return {
      start: metrics.scrollLeft / Math.max(1, pixelsPerSecond),
      end: (metrics.scrollLeft + visibleTimelineWidth) / Math.max(1, pixelsPerSecond),
      scrollLeft: metrics.scrollLeft,
      scrollTop: metrics.scrollTop,
      viewportWidth: metrics.viewportWidth,
      viewportHeight: metrics.viewportHeight
    };
  }, [metrics.scrollLeft, metrics.scrollTop, metrics.viewportHeight, metrics.viewportWidth, pixelsPerSecond]);

  const zoomAtClientX = (clientX: number, nextPixelsPerSecond: number) => {
    const node = scrollRef.current;
    if (!node) {
      setPixelsPerSecond(nextPixelsPerSecond);
      return;
    }

    const boundedPixelsPerSecond = clamp(nextPixelsPerSecond, minPixelsPerSecond, maxPixelsPerSecond);
    const rect = node.getBoundingClientRect();
    const timelineOffsetX = Math.max(0, clientX - rect.left - TIMELINE_HEADER_WIDTH);
    const anchorTime = (node.scrollLeft + timelineOffsetX) / Math.max(1, pixelsPerSecond);

    setPixelsPerSecondState(boundedPixelsPerSecond);

    requestAnimationFrame(() => {
      const nextScrollLeft = Math.max(0, anchorTime * boundedPixelsPerSecond - timelineOffsetX);
      node.scrollLeft = nextScrollLeft;
    });
  };

  return {
    scrollRef,
    zoom: {
      pixelsPerSecond,
      minPixelsPerSecond,
      maxPixelsPerSecond
    },
    setPixelsPerSecond,
    contentWidth,
    timeAreaWidth,
    visibleRange,
    zoomAtClientX
  };
}
