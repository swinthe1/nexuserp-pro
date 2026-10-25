import '@/lib/polyfills'
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { Providers } from '@/app/providers'
import { AppRouter } from '@/app/router'
import './index.css'
import '@/i18n/zod'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Providers>
      <AppRouter />
    </Providers>
  </React.StrictMode>,
)
