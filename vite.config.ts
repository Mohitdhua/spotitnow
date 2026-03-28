import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    build: {
      // AI upscaling ships as route-lazy TensorFlow chunks; keep warnings focused on
      // unexpectedly large app bundles instead of these intentionally isolated ML runtimes.
      chunkSizeWarningLimit: 700,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return;
            if (id.includes('@tensorflow/tfjs-core')) {
              return 'tf-core';
            }
            if (id.includes('@tensorflow/tfjs-backend-webgl')) {
              return 'tf-backend-webgl';
            }
            if (id.includes('@tensorflow/tfjs-backend-cpu')) {
              return 'tf-backend-cpu';
            }
            if (id.includes('@tensorflow/tfjs-converter')) {
              return 'tf-converter';
            }
            if (id.includes('@tensorflow/tfjs-layers')) {
              return 'tf-layers';
            }
            if (id.includes('@tensorflow/tfjs')) {
              return 'tf-vendor';
            }
            if (id.includes('@upscalerjs/maxim-deblurring')) {
              return 'model-maxim';
            }
            if (id.includes('@upscalerjs/esrgan-medium')) {
              return 'model-esrgan-medium';
            }
            if (id.includes('@upscalerjs/esrgan-slim')) {
              return 'model-esrgan-slim';
            }
            if (id.includes('@upscalerjs/esrgan-thick')) {
              return 'model-esrgan-thick';
            }
            if (id.includes('upscaler')) {
              return 'upscaler-core';
            }
            if (id.includes('mediabunny')) {
              return 'media-vendor';
            }
            if (id.includes('@google/genai')) {
              return 'ai-vendor';
            }
            if (id.includes('@radix-ui') || id.includes('sonner')) {
              return 'ui-vendor';
            }
            if (id.includes('motion') || id.includes('lucide-react') || id.includes('canvas-confetti')) {
              return 'fx-vendor';
            }
            return 'vendor';
          }
        }
      }
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    worker: {
      format: 'es'
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify - file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
