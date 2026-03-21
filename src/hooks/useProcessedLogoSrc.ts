import { useEffect, useState } from 'react';
import { loadImageAssetBlob, isStoredImageAssetSource } from '../services/imageAssetStore';
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
  const [processedSrc, setProcessedSrc] = useState<string | undefined>(() =>
    isStoredImageAssetSource(src) ? undefined : src
  );

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    const resolveSource = async () => {
      if (!src) {
        setProcessedSrc(undefined);
        return;
      }

      let resolvedSrc = src;
      try {
        if (isStoredImageAssetSource(src)) {
          const blob = await loadImageAssetBlob(src);
          if (!blob) {
            setProcessedSrc(undefined);
            return;
          }
          objectUrl = URL.createObjectURL(blob);
          resolvedSrc = objectUrl;
        }

        if (!options.enabled || typeof window === 'undefined') {
          if (!cancelled) {
            setProcessedSrc(resolvedSrc);
          }
          return;
        }

        if (!cancelled) {
          setProcessedSrc(resolvedSrc);
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
              setProcessedSrc(resolvedSrc);
              return;
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) {
              setProcessedSrc(resolvedSrc);
              return;
            }

            ctx.drawImage(image, 0, 0, width, height);
            const imageData = ctx.getImageData(0, 0, width, height);
            applyLogoChromaKey(imageData, options);
            ctx.clearRect(0, 0, width, height);
            ctx.putImageData(imageData, 0, 0);

            setProcessedSrc(canvas.toDataURL('image/png'));
          } catch {
            setProcessedSrc(resolvedSrc);
          }
        };

        image.onerror = () => {
          if (!cancelled) {
            setProcessedSrc(resolvedSrc);
          }
        };

        image.src = resolvedSrc;
      } catch {
        if (!cancelled) {
          setProcessedSrc(isStoredImageAssetSource(src) ? undefined : src);
        }
      }
    };

    void resolveSource();

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [src, options.enabled, options.color, options.tolerance]);

  return processedSrc;
};
