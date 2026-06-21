import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// IMPORTANT: GITHUB_PAGES_BASE must match "/<repo-name>/" for project pages
// (e.g. https://username.github.io/laos-field-gis/ -> base: '/laos-field-gis/').
// Set via the GITHUB_PAGES_BASE env var in CI (see .github/workflows/deploy.yml)
// so local dev (`npm run dev`) still serves from '/'.
const base = process.env.GITHUB_PAGES_BASE || '/';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'Laos Field GIS',
        short_name: 'LaoGIS',
        description:
          'Offline-first mapping app with automatic Laos regional detection, UTM 47N/48N projection, and topographic basemaps.',
        theme_color: '#14171a',
        background_color: '#14171a',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Cache OpenTopoMap tiles for offline field use (spec: offline workspace).
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/[a-c]\.tile\.opentopomap\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'opentopomap-tiles',
              expiration: { maxEntries: 4000, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules')) {
            if (id.includes('leaflet')) return 'leaflet';
            if (
              id.includes('shpjs') ||
              id.includes('togeojson') ||
              id.includes('jszip') ||
              id.includes('papaparse') ||
              id.includes('proj4')
            ) {
              return 'gis-io';
            }
          }
          return undefined;
        },
      },
    },
  },
});
