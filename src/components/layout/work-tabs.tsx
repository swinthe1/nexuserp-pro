import { LayoutDashboard, MoreHorizontal, X } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { type Location, type RouteObject, UNSAFE_NavigationContext, useLocation, useNavigate, useNavigationType, useRoutes } from 'react-router-dom'
import { useAuth } from '@/app/auth-provider'
import { useCompany } from '@/app/company-provider'
import { moduleLook } from '@/app/modules'
import { NAV } from '@/app/nav'
import { PageFallback } from '@/app/require-perm'
import { PageErrorBoundary } from '@/components/page-error-boundary'
import { PlanLocked } from '@/components/plan-locked'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'

/**
 * Work tabs: each page opened from the menu, the search or the "+" opens in a tab of its own above the
 * page. The tabs left behind stay as they were (a half-filled invoice, the filters of a list, where it
 * was scrolled) until they are closed. A link inside a page opens in the same tab, as before.
 *
 * Every tab draws its own copy of the app's pages for its own address; only the tab in front is shown,
 * hears the keyboard and may change the address.
 */

/* ------------------------------------------------------------------ the pages, set by the router */
let ROUTES: RouteObject[] = []
export function registerTabRoutes(r: RouteObject[]) { ROUTES = r }

/** false in a tab that is behind another: its pages stop listening to the keyboard */
const TabActive = React.createContext(true)
export const useTabActive = () => React.useContext(TabActive)

/** the page in front (the tab shown), for exports and anything that reads the page */
export function activePage(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  return document.querySelector<HTMLElement>('[data-tab-pane][data-active]') ?? document.querySelector('main')
}

/** a place in the app whose links open a tab of their own (the menu, the top bar, the search, the "+") */
export const TAB_OPENER = { 'data-tab-opener': '' } as const

const MAX_TABS = 8
const ON_KEY = 'drispro.tabs.on'
export function readTabsOn() { try { return localStorage.getItem(ON_KEY) !== '0' } catch { return true } }
export function writeTabsOn(on: boolean) { try { localStorage.setItem(ON_KEY, on ? '1' : '0') } catch { /* private window */ }; window.dispatchEvent(new Event('drispro-tabs')) }
function useTabsOn() {
  const [on, setOn] = React.useState(readTabsOn)
  const [wide, setWide] = React.useState(() => typeof window === 'undefined' || window.matchMedia('(min-width: 1024px)').matches)
  React.useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const w = () => setWide(mq.matches)
    const o = () => setOn(readTabsOn())
    mq.addEventListener('change', w); window.addEventListener('drispro-tabs', o)
    return () => { mq.removeEventListener('change', w); window.removeEventListener('drispro-tabs', o) }
  }, [])
  // on a phone there is no room: one page at a time, as before
  return on && wide
}

type Tab = { id: string; location: Location; title: string | null; mounted: boolean; dirty: boolean; scroll: number; used: number }
const pathOf = (l: Pick<Location, 'pathname' | 'search'>) => l.pathname + l.search
const locationOf = (path: string, id: string): Location => {
  const u = new URL(path, 'http://x')
  return { pathname: u.pathname, search: u.search, hash: u.hash, state: null, key: `t-${id}` }
}
/** the dashboard is the home under the tabs, never a tab of its own */
const HOME = 'home'
const isHome = (pathname: string) => pathname === '/'
const homeTab = (location?: Location): Tab => ({ id: HOME, location: location ?? locationOf('/', HOME), title: null, mounted: !!location, dirty: false, scroll: 0, used: 0 })
let seq = 0
const newId = () => `${Date.now().toString(36)}${(seq++).toString(36)}`

/** the menu's name for an address: the longest menu link that matches it */
function menuLabel(pathname: string): { label: string | null; section: string | undefined; exact: boolean } {
  let best: { label: string; section: string; len: number; exact: boolean } | null = null
  for (const s of NAV) for (const i of s.items) {
    const p = i.href.split('?')[0]!
    const ok = p === '/' ? pathname === '/' : pathname === p || pathname.startsWith(`${p}/`)
    if (ok && (!best || p.length > best.len)) best = { label: i.label, section: s.label, len: p.length, exact: p === pathname }
  }
  return { label: best ? t(best.label) : null, section: best?.section, exact: !!best?.exact }
}

type Ctx = {
  on: boolean
  tabs: Tab[]
  activeId: string | null
  activate: (id: string) => void
  close: (id: string) => void
  closeOthers: (id: string) => void
  closeAll: () => void
  setTitle: (id: string, title: string) => void
  setDirty: (id: string, dirty: boolean) => void
}
const TabsCtx = React.createContext<Ctx | null>(null)
const useTabs = () => React.useContext(TabsCtx)

/* ------------------------------------------------------------------ the tabs and the address */
export function WorkTabsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const { companyId } = useCompany()
  const on = useTabsOn()
  const location = useLocation()
  const navType = useNavigationType()
  const navigate = useNavigate()
  const store = `drispro.tabs.${user?.id ?? ''}.${companyId ?? ''}`

  const [tabs, setTabs] = React.useState<Tab[]>(() => restore(store, location))
  const [activeId, setActiveId] = React.useState<string | null>(() => tabs.find((x) => pathOf(x.location) === pathOf(location))?.id ?? tabs[0]?.id ?? null)
  const tabsRef = React.useRef(tabs); tabsRef.current = tabs
  const activeRef = React.useRef(activeId); activeRef.current = activeId
  const switching = React.useRef<string | null>(null)

  // where the last click or key press happened: in the menu or the top bar, a new tab opens
  const last = React.useRef<{ opener: boolean; at: number }>({ opener: false, at: 0 })
  React.useEffect(() => {
    const mark = (e: Event) => { const el = e.target as Element | null; last.current = { opener: !!el?.closest?.('[data-tab-opener]'), at: Date.now() } }
    document.addEventListener('pointerdown', mark, true)
    document.addEventListener('keydown', mark, true)
    return () => { document.removeEventListener('pointerdown', mark, true); document.removeEventListener('keydown', mark, true) }
  }, [])

  // another company: its own tabs
  const storeRef = React.useRef(store)
  React.useEffect(() => {
    if (storeRef.current === store) return
    storeRef.current = store
    const fresh = restore(store, location)
    setTabs(fresh); setActiveId(fresh.find((x) => pathOf(x.location) === pathOf(location))?.id ?? fresh[0]?.id ?? null)
  }, [store]) // eslint-disable-line react-hooks/exhaustive-deps

  // the address changed: a tab was picked, a page opened from the menu (a new tab), or a link inside the page
  React.useLayoutEffect(() => {
    const path = pathOf(location)
    if (switching.current === path) { switching.current = null; return }
    switching.current = null
    const fromMenu = on && navType !== 'POP' && last.current.opener && Date.now() - last.current.at < 4000
    last.current = { opener: false, at: 0 }
    const now = Date.now()
    const cur = tabsRef.current
    const active = cur.find((x) => x.id === activeRef.current)
    if (!on) {
      // one page at a time: the one tab follows the address
      const id = active?.id ?? newId()
      setTabs([{ id, location, title: null, mounted: true, dirty: false, scroll: 0, used: now }]); setActiveId(id)
      return
    }
    if (active && pathOf(active.location) === path && active.location.key === location.key) return
    // the dashboard: back home, the tabs stay as they are
    if (isHome(location.pathname)) {
      saveScroll(active)
      setTabs((ts) => (ts.some((x) => x.id === HOME) ? ts : [homeTab(), ...ts]).map((x) => (x.id === HOME ? { ...x, location, mounted: true, used: now } : x)))
      setActiveId(HOME); restoreScroll(cur.find((x) => x.id === HOME)?.scroll ?? 0)
      return
    }
    // a link on the dashboard opens a tab, so the dashboard stays the dashboard
    if (fromMenu || !active || active.id === HOME) {
      const same = cur.find((x) => pathOf(x.location) === path)
      if (same) {
        saveScroll(active)
        setTabs((ts) => ts.map((x) => (x.id === same.id ? { ...x, location, mounted: true, used: now } : x)))
        setActiveId(same.id); restoreScroll(same.scroll)
        return
      }
      saveScroll(active)
      const id = newId()
      let next = [...cur, { id, location, title: null, mounted: true, dirty: false, scroll: 0, used: now }]
      // too many: the one not used the longest (and without changes) gives way
      if (next.filter((x) => x.id !== HOME).length > MAX_TABS) {
        const drop = next.filter((x) => x.id !== id && x.id !== HOME && !x.dirty).sort((a, b) => a.used - b.used)[0]
        if (drop) next = next.filter((x) => x.id !== drop.id)
      }
      setTabs(next); setActiveId(id); window.scrollTo(0, 0)
      return
    }
    // a link inside the page: the same tab goes there
    setTabs((ts) => ts.map((x) => (x.id === active.id ? { ...x, location, mounted: true, dirty: pathOf(x.location) === path ? x.dirty : false, used: now } : x)))
  }, [location, on]) // eslint-disable-line react-hooks/exhaustive-deps

  // remembered for the next visit (only the addresses and names)
  React.useEffect(() => {
    try { localStorage.setItem(store, JSON.stringify({ tabs: tabs.filter((x) => x.id !== HOME).map((x) => ({ id: x.id, path: pathOf(x.location), title: x.title })), active: activeId })) } catch { /* private window */ }
  }, [tabs, activeId, store])

  const activate = React.useCallback((id: string) => {
    const cur = tabsRef.current
    const tab = cur.find((x) => x.id === id)
    if (!tab || id === activeRef.current) return
    saveScroll(cur.find((x) => x.id === activeRef.current))
    setTabs((ts) => ts.map((x) => (x.id === id ? { ...x, mounted: true, used: Date.now() } : x)))
    setActiveId(id)
    switching.current = pathOf(tab.location)
    navigate(pathOf(tab.location), { replace: true, state: tab.location.state })
    restoreScroll(tab.scroll)
  }, [navigate])

  const close = React.useCallback((id: string) => {
    const cur = tabsRef.current
    if (!cur.some((x) => x.id === id)) return
    if (id === HOME) return
    const rest = cur.filter((x) => x.id !== id)
    if (id !== activeRef.current) { setTabs(rest); return }
    // the neighbour comes to the front; after the last tab, the dashboard
    const idx = cur.filter((x) => x.id !== HOME).findIndex((x) => x.id === id)
    const others = rest.filter((x) => x.id !== HOME)
    const next = others[idx] ?? others[idx - 1] ?? rest.find((x) => x.id === HOME) ?? homeTab()
    if (!rest.some((x) => x.id === next.id)) rest.unshift(next)
    setTabs(rest.map((x) => (x.id === next.id ? { ...x, mounted: true } : x))); setActiveId(next.id)
    switching.current = pathOf(next.location)
    navigate(pathOf(next.location), { replace: true, state: next.location.state })
    restoreScroll(next.scroll)
  }, [navigate])
  const closeOthers = React.useCallback((id: string) => {
    if (id !== activeRef.current) activate(id)
    setTabs((ts) => ts.filter((x) => x.id === id || x.id === HOME))
  }, [activate])
  const closeAll = React.useCallback(() => {
    const home = tabsRef.current.find((x) => x.id === HOME) ?? homeTab()
    setTabs([{ ...home, mounted: true }]); setActiveId(HOME)
    switching.current = '/'; navigate('/', { replace: true }); window.scrollTo(0, 0)
  }, [navigate])
  const setTitle = React.useCallback((id: string, title: string) => setTabs((ts) => ts.map((x) => (x.id === id && x.title !== title ? { ...x, title } : x))), [])
  const setDirty = React.useCallback((id: string, dirty: boolean) => setTabs((ts) => ts.map((x) => (x.id === id && x.dirty !== dirty ? { ...x, dirty } : x))), [])

  // something saved in the tab in front: what was typed there is no longer at risk
  const qc = useQueryClient()
  React.useEffect(() => qc.getMutationCache().subscribe((ev) => {
    if (ev.type === 'updated' && ev.action.type === 'success' && activeRef.current) {
      const id = activeRef.current
      setTabs((ts) => ts.map((x) => (x.id === id && x.dirty ? { ...x, dirty: false } : x)))
    }
  }), [qc])

  // the keyboard: Alt+1…9 picks a tab, Alt+W closes the one in front
  React.useEffect(() => {
    if (!on) return
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return
      const n = Number(e.key)
      if (n >= 1 && n <= 9) { const tab = tabsRef.current.filter((x) => x.id !== HOME)[n - 1]; if (tab) { e.preventDefault(); activate(tab.id) } return }
      if ((e.key ?? "").toLowerCase() === 'w' && activeRef.current && activeRef.current !== HOME) { e.preventDefault(); window.dispatchEvent(new CustomEvent('drispro-close-tab', { detail: activeRef.current })) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [on, activate])

  const value = React.useMemo<Ctx>(() => ({ on, tabs, activeId, activate, close, closeOthers, closeAll, setTitle, setDirty }),
    [on, tabs, activeId, activate, close, closeOthers, closeAll, setTitle, setDirty])
  return <TabsCtx.Provider value={value}>{children}</TabsCtx.Provider>
}

function restore(store: string, location: Location): Tab[] {
  const now = Date.now()
  let saved: { tabs: { id: string; path: string; title: string | null }[]; active: string | null } | null = null
  try { saved = readTabsOn() ? JSON.parse(localStorage.getItem(store) ?? 'null') : null } catch { saved = null }
  const list: Tab[] = (saved?.tabs ?? []).filter((x) => x.id !== HOME && !isHome(new URL(x.path, 'http://x').pathname)).slice(0, MAX_TABS)
    .map((x, i) => ({ id: x.id, location: locationOf(x.path, x.id), title: x.title, mounted: false, dirty: false, scroll: 0, used: now - 1000 + i }))
  if (isHome(location.pathname)) return [homeTab(location), ...list]
  const here = list.find((x) => pathOf(x.location) === pathOf(location))
  if (here) return [homeTab(), ...list.map((x) => (x.id === here.id ? { ...x, location, mounted: true, used: now } : x))]
  const id = newId()
  const next = [...list, { id, location, title: null, mounted: true, dirty: false, scroll: 0, used: now }]
  return [homeTab(), ...(next.length > MAX_TABS ? next.slice(next.length - MAX_TABS) : next)]
}
function saveScroll(tab: Tab | undefined) { if (tab) tab.scroll = window.scrollY }
function restoreScroll(y: number) { requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, y))) }

/* ------------------------------------------------------------------ the pages of the tabs */
export function WorkPanes() {
  const ctx = useTabs()
  const location = useLocation()
  const { pageAllowed } = useCompany()
  if (!ctx) return <SinglePane location={location} pageAllowed={pageAllowed} />
  // the tab in front comes first, so anything that looks for "the page" finds it
  const shown = ctx.tabs.filter((x) => x.mounted)
  const ordered = [...shown.filter((x) => x.id === ctx.activeId), ...shown.filter((x) => x.id !== ctx.activeId)]
  return <>{ordered.map((tab) => <Pane key={tab.id} tab={tab} active={tab.id === ctx.activeId} pageAllowed={pageAllowed} />)}</>
}

function SinglePane({ location, pageAllowed }: { location: Location; pageAllowed: (p: string) => boolean }) {
  const element = useRoutes(ROUTES, location)
  return <PageErrorBoundary key={location.pathname}><React.Suspense fallback={<PageFallback />}>{pageAllowed(location.pathname) ? element : <PlanLocked path={location.pathname} />}</React.Suspense></PageErrorBoundary>
}

const Pane = React.memo(function Pane({ tab, active, pageAllowed }: { tab: Tab; active: boolean; pageAllowed: (p: string) => boolean }) {
  const ctx = useTabs()!
  const nav = React.useContext(UNSAFE_NavigationContext)
  // a tab behind another does not move the address (a late answer from the server, a timer)
  const still = React.useMemo(() => ({ ...nav, navigator: { ...nav.navigator, push: () => {}, replace: () => {}, go: () => {} } }), [nav])
  const element = useRoutes(ROUTES, tab.location)
  const box = React.useRef<HTMLDivElement>(null)

  // the tab's name: the page's own heading (a document's number), else the menu's name
  React.useEffect(() => {
    if (!active || !box.current) return
    const el = box.current
    let raf = 0
    const read = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { const h = el.querySelector('h1')?.textContent?.trim(); if (h) ctx.setTitle(tab.id, h.slice(0, 60)) }) }
    read()
    const mo = new MutationObserver(read)
    mo.observe(el, { childList: true, subtree: true, characterData: true })
    return () => { mo.disconnect(); cancelAnimationFrame(raf) }
  }, [active, tab.id, tab.location.key]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <TabActive.Provider value={active}>
      <UNSAFE_NavigationContext.Provider value={active ? nav : still}>
        <div ref={box} data-tab-pane={tab.id} data-active={active ? '' : undefined} hidden={!active}
          onInputCapture={() => { if (!tab.dirty) ctx.setDirty(tab.id, true) }}>
          <PageErrorBoundary key={tab.location.pathname}>
            <React.Suspense fallback={<PageFallback />}>{pageAllowed(tab.location.pathname) ? element : <PlanLocked path={tab.location.pathname} />}</React.Suspense>
          </PageErrorBoundary>
        </div>
      </UNSAFE_NavigationContext.Provider>
    </TabActive.Provider>
  )
}, (a, b) => a.tab === b.tab && a.active === b.active && a.pageAllowed === b.pageAllowed)

/* ------------------------------------------------------------------ the tab bar */
export function WorkTabBar({ className }: { className?: string }) {
  const ctx = useTabs()
  const [asking, setAsking] = React.useState<string | null>(null)
  // a right click on a tab: close it, the others, or all of them
  const [menu, setMenu] = React.useState<{ id: string; x: number; y: number } | null>(null)
  React.useEffect(() => {
    if (!menu) return
    const off = () => setMenu(null)
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null) }
    window.addEventListener('pointerdown', off); window.addEventListener('blur', off); window.addEventListener('resize', off); window.addEventListener('keydown', key)
    return () => { window.removeEventListener('pointerdown', off); window.removeEventListener('blur', off); window.removeEventListener('resize', off); window.removeEventListener('keydown', key) }
  }, [menu])
  const strip = React.useRef<HTMLDivElement>(null)
  const requestClose = React.useCallback((id: string) => {
    const tab = ctx?.tabs.find((x) => x.id === id)
    if (tab?.dirty) setAsking(id); else ctx?.close(id)
  }, [ctx])
  React.useEffect(() => {
    const on = (e: Event) => requestClose((e as CustomEvent<string>).detail)
    window.addEventListener('drispro-close-tab', on)
    return () => window.removeEventListener('drispro-close-tab', on)
  }, [requestClose])
  // the tab in front is always in sight
  React.useEffect(() => {
    strip.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [ctx?.activeId])
  if (!ctx?.on) return null
  const visible = ctx.tabs.filter((x) => x.id !== HOME)
  // only the dashboard open: no bar
  if (!visible.length) return null
  const askingTab = ctx.tabs.find((x) => x.id === asking)
  return (
    <div data-work-tabs="" className={cn('sticky top-[52px] z-20 flex h-10 items-end gap-1 border-b border-foreground/20 bg-background [background-image:linear-gradient(hsl(var(--foreground)/0.075),hsl(var(--foreground)/0.075))] px-2 pt-1 dark:border-border dark:bg-muted dark:[background-image:none] print:hidden', className)}>
      <div ref={strip} role="tablist" aria-label={t('Open pages')} className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {visible.map((tab, i) => {
          const active = tab.id === ctx.activeId
          const m = menuLabel(tab.location.pathname)
          const look = moduleLook(m.section)
          const Icon = tab.location.pathname === '/' ? LayoutDashboard : look.icon
          // a page of the menu goes by the menu's name; a document by its own heading (its number)
          const title = (m.exact ? m.label : null) ?? tab.title ?? m.label ?? t('Page')
          return (
            <div key={tab.id} role="tab" aria-selected={active} tabIndex={active ? 0 : -1} title={`${title}${i < 9 ? ` (Alt+${i + 1})` : ''}`}
              onClick={() => ctx.activate(tab.id)}
              onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); requestClose(tab.id) } }}
              onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ id: tab.id, x: Math.min(e.clientX, window.innerWidth - 240), y: e.clientY }) }}
              onMouseDown={(e) => { if (e.button === 1) e.preventDefault() }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ctx.activate(tab.id) } }}
              style={{ ['--mod' as string]: look.hue }}
              className={cn('group relative flex h-[31px] min-w-[130px] max-w-[230px] shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-t-lg border border-b-0 pl-3 pr-1 text-[12.5px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                active ? 'z-10 -mb-px h-[33px] border-foreground/25 bg-background font-semibold text-foreground shadow-[inset_0_3px_0_hsl(var(--primary))] dark:border-border'
                  : 'border-foreground/20 bg-[hsl(var(--background)/0.72)] text-foreground/75 shadow-[0_1px_2px_hsl(var(--foreground)/0.08)] hover:bg-background hover:text-foreground dark:border-border/80 dark:bg-card/70 dark:text-muted-foreground')}>
              <Icon className="size-3.5 shrink-0" style={{ color: 'hsl(var(--mod) 42%)' }} />
              <span className="min-w-0 flex-1 truncate">{title}</span>
              {tab.dirty && <span aria-label={t('Has changes')} className="size-1.5 shrink-0 rounded-full bg-warning" />}
              <button type="button" aria-label={t('Close {name}', { name: title })} tabIndex={-1}
                onClick={(e) => { e.stopPropagation(); requestClose(tab.id) }}
                className={cn('flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground',
                  active ? 'opacity-100' : 'opacity-50 group-hover:opacity-100')}>
                <X className="size-3.5" />
              </button>
            </div>
          )
        })}
      </div>
      {menu && (
        <div role="menu" aria-label={t('Tab options')} onPointerDown={(e) => e.stopPropagation()} style={{ left: menu.x, top: menu.y }}
          className="fixed z-50 w-56 rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-md">
          {([
            [t('Close this tab'), () => requestClose(menu.id), false],
            [t('Close the other tabs'), () => ctx.closeOthers(menu.id), visible.length < 2],
            [t('Close all tabs'), () => ctx.closeAll(), false],
          ] as [string, () => void, boolean][]).map(([label, run, off]) => (
            <button key={label} type="button" role="menuitem" disabled={off} onClick={() => { setMenu(null); run() }}
              className="flex w-full items-center rounded-sm px-2 py-1.5 text-left outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-50">{label}</button>
          ))}
        </div>
      )}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label={t('Tab options')} className="mb-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground">
                <MoreHorizontal className="size-4" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{t('Tab options')}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-64">
          {visible.map((tab) => {
            const m = menuLabel(tab.location.pathname)
            return <DropdownMenuItem key={tab.id} onSelect={() => ctx.activate(tab.id)} className={cn(tab.id === ctx.activeId && 'font-medium')}>
              <span className="truncate">{(m.exact ? m.label : null) ?? tab.title ?? m.label ?? t('Page')}</span></DropdownMenuItem>
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={visible.length < 2} onSelect={() => ctx.activeId && ctx.closeOthers(ctx.activeId)}>{t('Close the other tabs')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => ctx.closeAll()}>{t('Close all tabs')}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => writeTabsOn(false)}>{t('Work without tabs')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={!!askingTab} onOpenChange={(o) => !o && setAsking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Close {name}?', { name: (askingTab && menuLabel(askingTab.location.pathname).exact ? menuLabel(askingTab.location.pathname).label : null) ?? askingTab?.title ?? t('Page') })}</AlertDialogTitle>
            <AlertDialogDescription>{t('Something was typed in this tab. What was not saved is lost when it closes.')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Keep it open')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (asking) ctx.close(asking); setAsking(null) }}>{t('Close the tab')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
