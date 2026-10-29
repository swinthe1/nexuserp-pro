import {
  ArrowRight, Boxes, Cable, Cpu, CircleDollarSign, DatabaseBackup, LayoutDashboard, LogOut, Menu, MonitorDown, Plus, ScrollText,
  Search, Server, Settings2, ShieldCheck, Store, Users, type LucideIcon,
} from 'lucide-react'
import * as React from 'react'
import { Navigate, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/app/auth-provider'
import { useCompany } from '@/app/company-provider'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { msg, t } from '@/i18n'
import { LanguageToggle } from '@/i18n/language'
import { cn } from '@/lib/utils'
import { usePlatformOverview, useServerStatus } from '../api'
import { DemoClientDialog } from '../demo-client-dialog'
import { NewClientDialog } from '../dialogs'
import { ClientSearch } from './client-search'

type Item = { label: string; href: string; icon: LucideIcon; end?: boolean; badge?: 'attention' | 'ending' | 'links' | 'server' }
const NAV: { title?: string; items: Item[] }[] = [
  { items: [{ label: msg('Overview'), href: '/platform', icon: LayoutDashboard, end: true, badge: 'attention' }] },
  { title: msg('Clients'), items: [
    { label: msg('Clients'), href: '/platform/clients', icon: Users },
    { label: msg('Licences'), href: '/platform/licences', icon: ShieldCheck, badge: 'ending' },
  ] },
  { title: msg('Servers and links'), items: [
    { label: msg('Server (VPS)'), href: '/platform/server', icon: Cpu, badge: 'server' },
    { label: msg('Local servers'), href: '/platform/servers', icon: Server },
    { label: msg('Live links'), href: '/platform/links', icon: Cable, badge: 'links' },
    { label: msg('Database copies'), href: '/platform/backups', icon: DatabaseBackup },
    { label: msg('Windows and Mac programs'), href: '/platform/releases', icon: MonitorDown },
  ] },
  { title: msg('Business'), items: [
    { label: msg('Prices'), href: '/platform/prices', icon: CircleDollarSign },
  ] },
  { title: msg('System'), items: [
    { label: msg('Platform diary'), href: '/platform/diary', icon: ScrollText },
    { label: msg('Settings'), href: '/platform/settings', icon: Settings2 },
  ] },
]

/** The console's own windows (new client, demo), opened from anywhere in it */
const ConsoleActions = React.createContext<{ newClient: () => void; demo: () => void }>({ newClient: () => {}, demo: () => {} })
export const useConsoleActions = () => React.useContext(ConsoleActions)

function SideNav({ onNavigate }: { onNavigate?: () => void }) {
  const ov = usePlatformOverview()
  const srv = useServerStatus(1)
  const badge = (b?: Item['badge']) => {
    if (b === 'server') return srv.data?.alerts.length ?? 0
    const d = ov.data
    if (!d || !b) return 0
    if (b === 'attention') return d.attention.filter((a) => a.kind !== 'pending_account' && a.kind !== 'seats_full').length
    if (b === 'ending') return d.ending + d.expired
    return d.links.errors
  }
  return (
    <nav className="flex flex-col gap-1" aria-label={t('Platform menu')}>
      {NAV.map((g, i) => (
        <div key={i} className={cn('flex flex-col gap-px', i > 0 && 'mt-3')}>
          {g.title && <div className="px-2 pb-1 text-2xs font-medium text-primary/70">{t(g.title)}</div>}
          {g.items.map((it) => {
            const n = badge(it.badge)
            return (
              <NavLink key={it.href} to={it.href} end={it.end} onClick={onNavigate}
                className={({ isActive }) => cn('relative flex h-9 items-center gap-2.5 rounded-md px-2 text-[13.5px] font-medium text-sidebar-foreground transition-colors hover:bg-primary/[0.08] hover:text-foreground',
                  isActive && 'bg-primary/[0.14] text-white before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-primary')}>
                {({ isActive }) => <>
                  <it.icon className={cn('size-[18px] shrink-0', isActive ? 'text-primary' : 'text-muted-foreground')} strokeWidth={1.75} />
                  <span className="flex-1 truncate">{t(it.label)}</span>
                  {n > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-warning px-1.5 text-2xs font-semibold text-warning-foreground tabular">{n}</span>}
                </>}
              </NavLink>
            )
          })}
        </div>
      ))}
    </nav>
  )
}

function Brand() {
  return (
    <div className="flex h-[52px] items-center gap-2.5 px-3">
      <img src="/favicon.svg" alt="" className="size-7" />
      <div className="leading-tight">
        <div className="text-sm font-semibold text-white">DrisPRO</div>
        <div className="text-2xs text-muted-foreground">{t('Platform')}</div>
      </div>
    </div>
  )
}

/** The Super Admin's console: its own side menu, the search for a client, and the pages. */
export function PlatformLayout() {
  const { user, loading, signOut } = useAuth()
  const { isSuperAdmin, loading: ctxLoading, companies } = useCompany()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [mobile, setMobile] = React.useState(false)
  const [params, setParams] = useSearchParams()
  const [creating, setCreating] = React.useState(params.get('new') === '1')
  const [demo, setDemo] = React.useState(false)
  const [search, setSearch] = React.useState(false)
  React.useEffect(() => { setMobile(false) }, [pathname])
  // Ctrl K: find a client from anywhere in the console
  React.useEffect(() => {
    const on = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearch(true) } }
    window.addEventListener('keydown', on); return () => window.removeEventListener('keydown', on)
  }, [])

  if (!loading && !user) return <Navigate to="/login" replace />
  if (loading || ctxLoading) return <div className="min-h-dvh bg-background" />
  if (!isSuperAdmin) return <Navigate to="/" replace />

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  const bottom = (
    <div className="flex flex-col gap-1 border-t border-sidebar-border p-2.5">
      {companies.length > 0 && <button type="button" onClick={() => navigate('/')}
        className="flex h-8 items-center gap-2 rounded-md px-2 text-[13px] text-muted-foreground hover:bg-primary/[0.08] hover:text-foreground"><Boxes className="size-4" /> {t('Open the app')} <ArrowRight className="ml-auto size-3.5" /></button>}
      <button type="button" onClick={() => void signOut()}
        className="flex h-8 items-center gap-2 rounded-md px-2 text-[13px] text-muted-foreground hover:bg-primary/[0.08] hover:text-foreground"><LogOut className="size-4" /> {t('Sign out')}</button>
      <div className="truncate px-2 pt-1 text-2xs text-muted-foreground" title={user?.email}>{user?.email}</div>
    </div>
  )
  return (
    <ConsoleActions.Provider value={{ newClient: () => setCreating(true), demo: () => setDemo(true) }}>
      <div className="flex min-h-dvh bg-background">
        <aside className="sidebar-navy sticky top-0 hidden h-dvh w-[244px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
          <Brand />
          <div className="flex-1 overflow-y-auto px-2.5 pb-4 pt-2"><SideNav /></div>
          {bottom}
        </aside>
        <Sheet open={mobile} onOpenChange={setMobile}>
          <SheetContent side="left" className="sidebar-navy flex w-[280px] flex-col gap-0 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground">
            <SheetTitle className="sr-only">{t('Platform menu')}</SheetTitle>
            <Brand />
            <div className="flex-1 overflow-y-auto px-2.5 pb-4 pt-2"><SideNav onNavigate={() => setMobile(false)} /></div>
            {bottom}
          </SheetContent>
        </Sheet>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-[52px] items-center gap-2 border-b bg-card/90 px-3 backdrop-blur sm:px-5">
            <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={() => setMobile(true)} aria-label={t('Open navigation')}><Menu /></Button>
            <button type="button" onClick={() => setSearch(true)}
              className="flex h-9 w-full min-w-0 max-w-md items-center gap-2 rounded-full border border-transparent bg-muted px-3.5 text-[13px] text-muted-foreground transition-colors hover:border-primary/30 hover:bg-card hover:text-foreground">
              <Search className="size-4" /><span className="flex-1 truncate text-left">{t('Find a client: name, NUI or email…')}</span>
              <kbd className="hidden rounded-md border bg-card px-1.5 text-2xs font-semibold sm:inline">{isMac ? '⌘' : 'Ctrl'} K</kbd>{/* i18n-ignore */}
            </button>
            <div className="ml-auto flex items-center gap-2">
              <LanguageToggle className="hidden sm:inline-flex" />
              <Button variant="outline" size="sm" className="max-sm:hidden" onClick={() => setDemo(true)}><Store /> {t('Demo client')}</Button>
              <Button size="sm" onClick={() => setCreating(true)}><Plus /> <span className="max-sm:hidden">{t('New client')}</span></Button>
            </div>
          </header>
          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
            <Outlet />
          </main>
        </div>
      </div>
      <ClientSearch open={search} onOpenChange={setSearch} />
      <DemoClientDialog open={demo} onOpenChange={setDemo} />
      <NewClientDialog open={creating} onOpenChange={(o) => { setCreating(o); if (!o && params.get('new')) setParams({}, { replace: true }) }} />
    </ConsoleActions.Provider>
  )
}
