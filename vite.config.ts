import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        injectRegister: false,
        registerType: 'autoUpdate',
        manifestFilename: 'manifest.webmanifest',
        includeAssets: [
          'favicon.svg',
          'apple-touch-icon.png',
          'pwa-192x192.png',
          'pwa-512x512.png',
          'maskable-512x512.png'
        ],
        manifest: {
          id: '/',
          name: 'Puzzle Studio',
          short_name: 'Puzzle Studio',
          description: 'Offline-first spot-the-difference studio for puzzles, thumbnails, editing, and video workflows.',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          orientation: 'any',
          background_color: '#FFFDF5',
          theme_color: '#FFFDF5',
          lang: 'en-US',
          categories: ['productivity', 'graphics', 'photo'],
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any'
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any'
            },
            {
              src: '/maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any maskable'
            }
          ]
        },
        workbox: {
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          navigateFallback: 'index.html',
          navigateFallbackDenylist: [/^\/api\//],
          maximumFileSizeToCacheInBytes: 64 * 1024 * 1024
        },
        devOptions: {
          enabled: true,
          suppressWarnings: true,
          type: 'module'
        }
      })
    ],
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
