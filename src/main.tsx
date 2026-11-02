import '@/lib/polyfills'
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { Providers } from '@/app/providers'
import { AppRouter } from '@/app/router'
import './index.css'
import { applyScannerManifest } from '@/features/scanner/mode'
import '@/i18n/zod'

// on a handheld in scanner mode, installing gives the "DrisPRO Skaner" app
applyScannerManifest()

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Providers>
      <AppRouter />
    </Providers>
  </React.StrictMode>,
)
