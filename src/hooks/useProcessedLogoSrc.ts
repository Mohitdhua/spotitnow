import { useEffect, useState } from 'react';
import { applyLogoChromaKey } from '../utils/logoProcessing';

interface UseProcessedLogoOptions {
  enabled: boolean;
  color: string;
  tolerance: number;
}

export const useProcessedLogoSrc = (
  src: string | undefined,
  options: UseProcessedLogoOptions
) => {
  const [processedSrc, setProcessedSrc] = useState<string | undefined>(src);

  useEffect(() => {
    let cancelled = false;

    if (!src) {
      setProcessedSrc(undefined);
      return;
    }

    setProcessedSrc(src);

    if (!options.enabled || typeof window === 'undefined') {
      return;
    }

    const image = new Image();
    image.crossOrigin = 'anonymous';

    image.onload = () => {
      if (cancelled) return;

      try {
        const canvas = document.createElement('canvas');
        const width = image.naturalWidth || image.width;
        const height = image.naturalHeight || image.height;
        if (!width || !height) {
          setProcessedSrc(src);
          return;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          setProcessedSrc(src);
          return;
        }

        ctx.drawImage(image, 0, 0, width, height);
        const imageData = ctx.getImageData(0, 0, width, height);
        applyLogoChromaKey(imageData, options);
        ctx.clearRect(0, 0, width, height);
        ctx.putImageData(imageData, 0, 0);

        setProcessedSrc(canvas.toDataURL('image/png'));
      } catch {
        setProcessedSrc(src);
      }
    };

    image.onerror = () => {
      if (!cancelled) setProcessedSrc(src);
    };

    image.src = src;

    return () => {
      cancelled = true;
    };
  }, [src, options.enabled, options.color, options.tolerance]);

  return processedSrc;
};
