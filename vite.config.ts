import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // a new version waits until the person chooses to reload (see src/components/pwa-prompts.tsx),
      // so nobody loses a half-filled form or a sale in progress
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'favicon-32.png', 'apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'DrisPRO',
        short_name: 'DrisPRO',
        description: 'Shitje, magazinë, blerje, prodhim, financë dhe paga në një vend.',
        lang: 'sq',
        dir: 'ltr',
        theme_color: '#0E8A5F',
        background_color: '#ffffff',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone'],
        orientation: 'any',
        start_url: '/',
        scope: '/',
        categories: ['business', 'productivity', 'finance'],
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
        shortcuts: [
          { name: 'Arka', short_name: 'Arka', url: '/pos', icons: [{ src: '/pwa-192.png', sizes: '192x192' }] },
          { name: 'Porosi e re shitjeje', short_name: 'Shitje', url: '/sales/orders/new', icons: [{ src: '/pwa-192.png', sizes: '192x192' }] },
          { name: 'Puna në magazinë', short_name: 'Magazina', url: '/wms', icons: [{ src: '/pwa-192.png', sizes: '192x192' }] },
          { name: 'Miratimet', short_name: 'Miratime', url: '/approvals', icons: [{ src: '/pwa-192.png', sizes: '192x192' }] },
        ],
      },
      workbox: {
        // phone notifications (public/push-sw.js)
        importScripts: ['push-sw.js'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/(rest|auth|storage|functions|realtime|mcp)\//],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // the local server's address is read fresh each time (kept for offline)
        globIgnores: ['drispro-config.js'],
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          // the typeface, so the app looks the same offline
          { urlPattern: /^https:\/\/fonts\.googleapis\.com\//, handler: 'StaleWhileRevalidate', options: { cacheName: 'google-fonts-css' } },
          { urlPattern: /^https:\/\/fonts\.gstatic\.com\//, handler: 'CacheFirst',
            options: { cacheName: 'google-fonts', expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 }, cacheableResponse: { statuses: [0, 200] } } },
          { urlPattern: ({ url }) => url.pathname === '/drispro-config.js', handler: 'NetworkFirst', options: { cacheName: 'drispro-config', networkTimeoutSeconds: 3 } },
          // business data is never cached by the service worker: it is private and must be current
        ],
      },
    }),
  ],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/src/i18n/sq/')) return 'i18n-sq' // the Albanian dictionary changes with the text, not with the code
          if (/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(id)) return 'react'
          if (/node_modules\/(@tanstack|@supabase)\//.test(id)) return 'data'
          // charts and PDF stay out of manual chunks: they load with the pages that use them
          return undefined
        },
      },
    },
  },
})
