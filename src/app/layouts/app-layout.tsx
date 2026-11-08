import * as React from 'react'
import { UnitPicker } from '@/components/layout/unit-picker'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/app/auth-provider'
import { useCompany } from '@/app/company-provider'
import { CommandPaletteProvider } from '@/components/layout/command-palette'
import { CompanySwitcher } from '@/components/layout/company-switcher'
import { Sidebar, SidebarNav } from '@/components/layout/sidebar'
import { Topbar } from '@/components/layout/topbar'
import { ClassicShell } from '@/components/layout/classic-shell'
import { SectionTabs } from '@/components/layout/section-tabs'
import { useTheme } from '@/app/theme-provider'
import { SimpleTopbar } from '@/features/simple/simple-shell'
import { ScannerTopbar } from '@/features/scanner/scanner-home'
import { isScannerMode } from '@/features/scanner/mode'
import { Invitations } from '@/components/invitations'
import { TourHost } from '@/components/help'
import { TrainingNudge } from '@/features/training/nudge'
import { LicenseBanner, LiveLinkBanner, SupportBanner, TrainingBanner } from '@/components/license-banner'
import { OfflineBanner } from '@/components/offline-banner'
import { PageErrorBoundary } from '@/components/page-error-boundary'
import { PlanLocked } from '@/components/plan-locked'
import { GuardHost } from '@/components/guard'
import { LoginSetupGate } from '@/features/auth/login-setup'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { BottomBar } from '@/components/layout/bottom-bar'
import { WorkPanes, WorkTabBar, WorkTabsProvider } from '@/components/layout/work-tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { useHotkey } from '@/hooks/use-hotkey'
import { ExportsRecorder } from '@/features/exports/recorder'
import { t } from '@/i18n'

const KEY = 'drispro.sidebar.collapsed'

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
  const { loading: companyLoading, companies, isSuperAdmin, pageAllowed, simple } = useCompany()
  const location = useLocation()
  const [collapsed, setCollapsed] = React.useState(() => {
    try { return localStorage.getItem(KEY) === '1' } catch { return false }
  })
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const { look } = useTheme()

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

  // the handheld app (DrisPRO Skaner): no side menu, one way back to its start screen
  if (isScannerMode()) {
    return (
      <div className="flex min-h-dvh flex-col">
        <ScannerTopbar />
        <OfflineBanner />
        <Invitations />
        <LicenseBanner />
        <main id="main" className="flex-1 px-3 py-3 sm:px-5">
          <PageErrorBoundary key={location.pathname}>{pageAllowed(location.pathname) ? <Outlet /> : <PlanLocked path={location.pathname} />}</PageErrorBoundary>
          <GuardHost /><LoginSetupGate /><ExportsRecorder />
        </main>
      </div>
    )
  }

  if (simple) {
    return (
      <CommandPaletteProvider>
        <div className="flex min-h-dvh flex-col">
          <SimpleTopbar />
          <OfflineBanner />
          <TrainingBanner />
          <Invitations />
          <TrainingNudge />
          <LicenseBanner />
          <main id="main" className="flex-1 px-4 py-5 sm:px-6 lg:px-8">
            <SectionTabs />
            <PageErrorBoundary key={location.pathname}>{pageAllowed(location.pathname) ? <Outlet /> : <PlanLocked path={location.pathname} />}</PageErrorBoundary>
            <GuardHost /><LoginSetupGate /><ExportsRecorder />
            <TourHost />
          </main>
        </div>
      </CommandPaletteProvider>
    )
  }

  const mobileNav = (
    <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
      <SheetContent side="left" className="sidebar-mono w-[280px] gap-3 border-sidebar-border bg-[hsl(var(--sidebar-panel))] p-3 text-sidebar-foreground">
        <SheetTitle className="sr-only">{t('Main menu')}</SheetTitle>
        <div className="pr-8"><CompanySwitcher /></div>
        <UnitPicker />
        <div className="overflow-y-auto"><SidebarNav onNavigate={() => setMobileOpen(false)} /></div>
      </SheetContent>
    </Sheet>
  )

  // the classic look: a Windows program with a menu bar, a toolbar, a tree and a status bar
  if (look === 'classic') {
    return (
      <CommandPaletteProvider>
        <WorkTabsProvider>
        <ClassicShell onOpenMobileNav={() => setMobileOpen(true)}>
          {mobileNav}
          <OfflineBanner />
          <TrainingBanner />
          <LiveLinkBanner />
          <SupportBanner />
          <Invitations />
          <TrainingNudge />
          <LicenseBanner />
          <WorkTabBar className="static" />
          <main id="main" className="flex-1 px-3 py-3 sm:px-4">
            <SectionTabs />
            <WorkPanes />
            <GuardHost /><LoginSetupGate /><ExportsRecorder />
            <TourHost />
          </main>
        </ClassicShell>
        </WorkTabsProvider>
      </CommandPaletteProvider>
    )
  }

  return (
    <CommandPaletteProvider>
      <WorkTabsProvider>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2">
        {t('Skip to content')}
      </a>
      <div className="flex min-h-dvh">
        <Sidebar collapsed={collapsed} onToggle={toggle} />
        {mobileNav}
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar onOpenMobileNav={() => setMobileOpen(true)} />
          <WorkTabBar />
          <OfflineBanner />
          <TrainingBanner />
          <LiveLinkBanner />
          <SupportBanner />
          <Invitations />
          <TrainingNudge />
          <LicenseBanner />
          <main id="main" className="flex-1 px-4 py-5 pb-24 sm:px-6 md:pb-5 lg:px-8">
            <SectionTabs />
            <WorkPanes />
            <GuardHost /><LoginSetupGate /><ExportsRecorder />
            <TourHost />
          </main>
        </div>
      </div>
      <BottomBar onOpenMenu={() => setMobileOpen(true)} />
      </WorkTabsProvider>
    </CommandPaletteProvider>
  )
}
