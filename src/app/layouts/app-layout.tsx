import * as React from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/app/auth-provider'
import { useCompany } from '@/app/company-provider'
import { CommandPaletteProvider } from '@/components/layout/command-palette'
import { CompanySwitcher } from '@/components/layout/company-switcher'
import { Sidebar, SidebarNav } from '@/components/layout/sidebar'
import { Topbar } from '@/components/layout/topbar'
import { LicenseBanner, SupportBanner } from '@/components/license-banner'
import { OfflineBanner } from '@/components/offline-banner'
import { PageErrorBoundary } from '@/components/page-error-boundary'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { useHotkey } from '@/hooks/use-hotkey'
import { t } from '@/i18n'

const KEY = 'nexus.sidebar.collapsed'

function FullPageSkeleton() {
  return (
    <div className="flex h-dvh">
      <div className="hidden w-[244px] border-r bg-sidebar p-3 lg:block">
        <Skeleton className="mb-6 h-9" />
        {Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} className="mb-2 h-6" />)}
      </div>
      <div className="flex-1 p-6">
        <Skeleton className="mb-6 h-8 w-64" />
        <Skeleton className="h-64" />
      </div>
    </div>
  )
}

export function AppLayout() {
  const { user, loading } = useAuth()
  const { loading: companyLoading, companies, isSuperAdmin } = useCompany()
  const location = useLocation()
  const [collapsed, setCollapsed] = React.useState(() => {
    try { return localStorage.getItem(KEY) === '1' } catch { return false }
  })
  const [mobileOpen, setMobileOpen] = React.useState(false)

  const toggle = React.useCallback(() => {
    setCollapsed((c) => {
      try { localStorage.setItem(KEY, c ? '0' : '1') } catch { /* ignore */ }
      return !c
    })
  }, [])
  useHotkey('[', toggle)

  if (loading) return <FullPageSkeleton />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (companyLoading) return <FullPageSkeleton />
  if (!companies.length) return <Navigate to={isSuperAdmin ? '/platform' : '/onboarding'} replace />

  return (
    <CommandPaletteProvider>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2">
        {t('Skip to content')}
      </a>
      <div className="flex min-h-dvh">
        <Sidebar collapsed={collapsed} onToggle={toggle} />
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-[280px] gap-3 bg-sidebar p-3">
            <SheetTitle className="sr-only">{t('Main menu')}</SheetTitle>
            <div className="pr-8"><CompanySwitcher /></div>
            <div className="overflow-y-auto"><SidebarNav onNavigate={() => setMobileOpen(false)} /></div>
          </SheetContent>
        </Sheet>
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar onOpenMobileNav={() => setMobileOpen(true)} />
          <OfflineBanner />
          <SupportBanner />
          <LicenseBanner />
          <main id="main" className="flex-1 px-4 py-5 sm:px-6 lg:px-8">
            <PageErrorBoundary key={location.pathname}><Outlet /></PageErrorBoundary>
          </main>
        </div>
      </div>
    </CommandPaletteProvider>
  )
}
