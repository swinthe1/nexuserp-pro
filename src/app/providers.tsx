import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as React from 'react'
import { toast } from 'sonner'
import { AuthProvider } from '@/app/auth-provider'
import { CompanyProvider } from '@/app/company-provider'
import { MfaGate } from '@/components/mfa-gate'
import { ThemeProvider } from '@/app/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { PwaPrompts } from '@/components/pwa-prompts'
import { OfflineSync } from '@/app/offline-sync'
import { LanguageSync, LocaleBoundary } from '@/i18n/language'
import { describeError } from '@/lib/errors'

function makeClient() {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        // background refetch failures shouldn't spam; only surface when there's data on screen already
        if (query.state.data !== undefined) toast.error(describeError(error))
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _v, _c, mutation) => {
        if (!mutation.options.onError) toast.error(describeError(error))
      },
    }),
    defaultOptions: {
      // without internet a save fails at once with a clear message (the outbox handles the work that can wait)
      mutations: { networkMode: 'always' },
      queries: { staleTime: 30_000, retry: (n, err) => n < 2 && !String((err as { code?: string })?.code ?? '').startsWith('4'), refetchOnWindowFocus: false },
    },
  })
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(makeClient)
  return (
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <AuthProvider>
          <MfaGate>
          <CompanyProvider>
            <TooltipProvider delayDuration={300}>
              <LanguageSync />
              <OfflineSync />
              <LocaleBoundary>{children}</LocaleBoundary>
              <Toaster />
              <PwaPrompts />
            </TooltipProvider>
          </CompanyProvider>
          </MfaGate>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
