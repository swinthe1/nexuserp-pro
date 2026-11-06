import '@/lib/polyfills'
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { Providers } from '@/app/providers'
import { AppRouter } from '@/app/router'
import './index.css'
import '@/app/zoom'
import { applyScannerManifest } from '@/features/scanner/mode'
import '@/i18n/zod'
import { installErrorReporting } from '@/lib/error-report'

// on a handheld in scanner mode, installing gives the "DrisPRO Skaner" app
applyScannerManifest()
installErrorReporting()

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Providers>
      <AppRouter />
    </Providers>
  </React.StrictMode>,
)
