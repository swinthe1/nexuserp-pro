import { ChevronRight, PanelLeftClose, PanelLeftOpen, Search, Star } from 'lucide-react'
import { UnitPicker } from '@/components/layout/unit-picker'
import * as React from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useCompany } from '@/app/company-provider'
import { moduleLook } from '@/app/modules'
import { NAV, type NavItem } from '@/app/nav'
import { menuEntries, type MenuEntry } from '@/components/layout/hubs'
import { useCommandPalette } from '@/components/layout/command-palette'
import { CompanySwitcher } from '@/components/layout/company-switcher'
import { recordVisit, useFavourites, useHiddenSections, useOpenSections } from '@/components/layout/nav-prefs'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'

/**
 * The single most specific nav entry for the current URL: '/sales/orders/123' lights up
 * "Sales orders", not also "Sales overview"; '/partners?role=vendor' lights up "Vendors".
 */
function useActiveHref() {
  const { pathname, search } = useLocation()
  return React.useMemo(() => {
    const params = new URLSearchParams(search)
    let best: string | null = null
    let bestScore = -1
    for (const item of NAV.flatMap((s) => s.items.flatMap((i) => [i, ...(i.match ?? []).map((m) => ({ ...i, href: m, own: i.href }))]))) {
      const [path, query] = item.href.split('?') as [string, string | undefined]
      const pathOk = path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`)
      if (!pathOk) continue
      const q = new URLSearchParams(query ?? '')
      if ([...q.entries()].some(([k, v]) => params.get(k) !== v)) continue
      const score = path.length + (query ? 1000 : 0)
      if (score > bestScore) { best = 'own' in item ? (item.own as string) : item.href; bestScore = score }
    }
    return best
  }, [pathname, search])
}

const ALWAYS_SHOWN = new Set(['Overview', 'Company'])

/** an entry of the menu drawn like a page: the hub's name, its first page's address */
const entryItem = (e: MenuEntry): NavItem => ({ ...e.items[0]!, label: e.label, href: e.href })

/*
 * The short menu: a person whose job is one part (the till, the warehouse, field sales) sees the pages
 * of the work they do, not every page they may open. Whoever sees the numbers (reports, finance) or runs
 * the company sees the whole menu. One click shows everything; the choice is kept on this device.
 */
const FULL_KEY = 'drispro.menu.full'
const FULL_EVENT = 'drispro:menu-full'
const readFull = () => { try { return localStorage.getItem(FULL_KEY) === '1' } catch { return false } }
/** one choice for the whole window: the rail, the panel and the classic menu read the same */
function useFullMenu() {
  const full = React.useSyncExternalStore((cb) => { window.addEventListener(FULL_EVENT, cb); return () => window.removeEventListener(FULL_EVENT, cb) }, readFull)
  const set = (v: boolean) => { try { localStorage.setItem(FULL_KEY, v ? '1' : '0') } catch { /* private window */ } window.dispatchEvent(new Event(FULL_EVENT)) }
  return [full, set] as const
}
const writes = (perm: string) => perm.split('|').map((p) => p.replace(/\.read$/, '.write'))


/** a part's icon: one quiet colour for all, the brand colour for the part you are in */
function SectionIcon({ label, className, active }: { label: string; className?: string; active?: boolean }) {
  const Icon = moduleLook(label).icon
  return <Icon aria-hidden className={cn('size-[18px] shrink-0', active ? 'text-primary' : 'text-muted-foreground', className)} strokeWidth={1.75} />
}

function SectionFlyout({ label, title, items, activeHref, onNavigate }: { label: string; title?: string; items: NavItem[]; activeHref: string | null; onNavigate?: () => void }) {
  const entries = menuEntries(items)
  const [open, setOpen] = React.useState(false)
  const timer = React.useRef<number | undefined>(undefined)
  const show = () => { window.clearTimeout(timer.current); setOpen(true) }
  const hide = () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setOpen(false), 160) }
  const active = items.some((i) => i.href === activeHref)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={t(title ?? label)} onMouseEnter={show} onMouseLeave={hide}
          className={cn('grid size-10 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-[hsl(var(--sidebar-active)/0.6)] hover:text-foreground',
            active && 'bg-[hsl(var(--sidebar-active))] text-foreground', open && !active && 'bg-[hsl(var(--sidebar-active)/0.6)] text-foreground')}>
          <SectionIcon label={label} active={active} className="size-5" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" sideOffset={10} className="w-60 p-1.5" onMouseEnter={show} onMouseLeave={hide}
        onOpenAutoFocus={(e) => e.preventDefault()} onCloseAutoFocus={(e) => e.preventDefault()}>
        <p className="px-2 pb-1 pt-1 text-xs font-medium text-muted-foreground">{t(title ?? label)}</p>
        <div className="flex flex-col gap-0.5">
          {entries.map((e) => { const on = e.items.some((i) => i.href === activeHref); return (
            <NavLink key={e.key} to={e.href} onClick={() => { setOpen(false); onNavigate?.() }}
              className={cn('flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] font-medium hover:bg-secondary',
                on ? 'bg-secondary text-foreground' : 'text-popover-foreground')}>
              <e.icon className={cn('size-4 shrink-0', on ? 'text-primary' : 'text-muted-foreground')} />
              <span className="truncate">{t(e.label)}</span>
            </NavLink>
          ) })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function Item({ item, collapsed, onNavigate, active, pinned, onTogglePin, sub }: {
  item: NavItem; collapsed: boolean; onNavigate?: () => void; active: boolean; pinned?: boolean; onTogglePin?: () => void
  /** a page inside a part: words only, lined up under the part's name */
  sub?: boolean
}) {
  const Icon = item.icon
  const link = (
    <NavLink
      to={item.href}
      end={item.href === '/'}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      title={sub ? t(item.label) : undefined}
      className={
        cn(
          'group/item relative flex min-w-0 flex-1 basis-auto items-center rounded-md text-sidebar-foreground transition-colors hover:bg-[hsl(var(--sidebar-active)/0.55)] hover:text-foreground',
          sub ? 'min-h-8 gap-2.5 py-1.5 pl-[30px] pr-7 text-[13px] leading-snug' : 'h-9 gap-2.5 px-2 text-[13.5px] font-medium',
          active && 'bg-[hsl(var(--sidebar-active))] font-medium text-foreground',
          active && sub && 'before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-primary',
          collapsed && 'h-9 flex-none justify-center px-0',
        )
      }
    >
      <Icon className={cn('shrink-0', sub ? 'size-4' : 'size-[18px]', active ? 'text-primary' : 'text-muted-foreground group-hover/item:text-foreground')} strokeWidth={1.75} />
      {!collapsed && <span className={cn('flex-1', sub ? 'line-clamp-2' : 'truncate')}>{t(item.label)}</span>}
    </NavLink>
  )
  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right">{t(item.label)}</TooltipContent>
      </Tooltip>
    )
  }
  if (!onTogglePin) return link
  return (
    <div className="group/row relative flex items-center">
      {link}
      <button
        type="button"
        onClick={onTogglePin}
        aria-label={pinned ? t('Remove {page} from favourites', { page: t(item.label) }) : t('Add {page} to favourites', { page: t(item.label) })}
        title={pinned ? t('Remove from favourites') : t('Add to favourites')}
        className={cn(
          'absolute right-1 flex size-6 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100',
          pinned && 'text-warning hover:text-warning',
        )}
      >
        <Star className={cn('size-3.5', pinned && 'fill-current')} />
      </button>
    </div>
  )
}

/** the parts of the menu and their pages this person sees, as in the side menu (the classic menu bar uses them too) */
export function useMenuSections() {
  const { can, pageAllowed } = useCompany()
  const hidden = useHiddenSections()
  const [fullMenu] = useFullMenu()
  const focused = !can('reports.read') && !can('finance.read') && !can('admin.read')
  const short = focused && !fullMenu
  const mine = React.useCallback((i: NavItem) => !short || !!i.always || (i.focus ? i.focus.some(can) : writes(i.perm).some(can)), [short, can])
  return React.useMemo(() => NAV
    // the classic menu bar heads each hub's pages with its name
    .map((s) => ({ ...s, items: s.items.map((i): NavItem => ({ ...i, group: i.hub })) }))
    .filter((s) => ALWAYS_SHOWN.has(s.label) || !hidden.includes(s.label))
    .map((s) => ({ ...s, items: s.items.filter((i) => !i.hideInMenu && can(i.perm) && pageAllowed(i.href) && !hidden.includes(i.href) && !(i.part && hidden.includes(i.part)) && mine(i)) }))
    // a page shows once: where it first appears among the parts this business sees
    .map((s, _, all) => ({ ...s, items: s.items.filter((i) => i.also || !all.slice(0, all.indexOf(s)).some((p) => p.items.some((x) => x.href === i.href))) }))
    .filter((s) => s.items.length), [can, pageAllowed, hidden, mine])
}
export { useActiveHref }

export function SidebarNav({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const { can, pageAllowed } = useCompany()
  const activeHref = useActiveHref()
  const hidden = useHiddenSections()
  const { favourites, toggle } = useFavourites()
  const { open, set: setOpen } = useOpenSections()
  const palette = useCommandPalette()
  const [fullMenu, setFullMenu] = useFullMenu()
  const focused = !can('reports.read') && !can('finance.read') && !can('admin.read')
  const short = focused && !fullMenu
  const mine = React.useCallback((i: NavItem) => !short || !!i.always || (i.focus ? i.focus.some(can) : writes(i.perm).some(can)), [short, can])

  React.useEffect(() => { if (activeHref) recordVisit(activeHref) }, [activeHref])

  const sections = React.useMemo(() => NAV
    // the classic menu bar heads each hub's pages with its name
    .map((s) => ({ ...s, items: s.items.map((i): NavItem => ({ ...i, group: i.hub })) }))
    .filter((s) => ALWAYS_SHOWN.has(s.label) || !hidden.includes(s.label))
    .map((s) => ({ ...s, items: s.items.filter((i) => !i.hideInMenu && can(i.perm) && pageAllowed(i.href) && !hidden.includes(i.href) && !(i.part && hidden.includes(i.part)) && mine(i)) }))
    // a page shows once: where it first appears among the parts this business sees
    .map((s, _, all) => ({ ...s, items: s.items.filter((i) => i.also || !all.slice(0, all.indexOf(s)).some((p) => p.items.some((x) => x.href === i.href))) }))
    .filter((s) => s.items.length), [can, pageAllowed, hidden, mine])
  const byHref = React.useMemo(() => new Map(sections.flatMap((s) => s.items).map((i) => [i.href, i])), [sections])

  // only what the person starred; the overview pages are already at the top, so they are not repeated
  const overviewHrefs = new Set(sections.find((s) => s.label === 'Overview')?.items.map((i) => i.href) ?? [])
  const pinnedItems = favourites.map((h) => byHref.get(h)).filter((i): i is NavItem => !!i && !overviewHrefs.has(i.href))
  const quick = pinnedItems
  const activeSection = sections.find((s) => s.items.some((i) => i.href === activeHref))?.label
  const openSet = new Set(open ?? [])
  // the part you are in opens by itself, but a click on its name folds it like any other
  const [foldedActive, setFoldedActive] = React.useState(false)
  React.useEffect(() => { setFoldedActive(false) }, [activeSection])
  const isOpen = (label: string) => (label === activeSection && !foldedActive && !openSet.size) || openSet.has(label)
  const toggleSection = (label: string) => {
    if (isOpen(label)) { setOpen([]); if (label === activeSection) setFoldedActive(true) }
    else { setOpen(label === activeSection ? [] : [label]); setFoldedActive(label !== activeSection) }
  }
  const pinProps = (i: NavItem) => ({ pinned: favourites.includes(i.href), onTogglePin: () => toggle(i.href) })

  if (collapsed) {
    // narrow: the dashboard, the pinned pages, then one icon per section with its pages beside it
    const overview = sections.find((s) => s.label === 'Overview')
    return (
      <nav className="flex flex-col gap-1" aria-label={t('Main menu')}>
        {overview && menuEntries(overview.items).map((e) => <Item key={e.key} item={entryItem(e)} collapsed onNavigate={onNavigate} active={e.items.some((i) => i.href === activeHref)} />)}
        {pinnedItems.length > 0 && (
          <div className="my-1 flex flex-col gap-0.5 border-y border-sidebar-border py-2">
            {pinnedItems.slice(0, 6).map((i) => <Item key={`p-${i.href}`} item={i} collapsed onNavigate={onNavigate} active={i.href === activeHref} />)}
          </div>
        )}
        {sections.filter((s) => s.label !== 'Overview').map((section) => (
          <SectionFlyout key={section.label} label={section.label} title={section.title} items={section.items} activeHref={activeHref} onNavigate={onNavigate} />
        ))}
      </nav>
    )
  }

  return (
    <nav className="flex flex-col gap-1" aria-label={t('Main menu')}>
      <button type="button" onClick={() => palette.open('pages')}
        className="mb-2 flex h-8 items-center gap-2 rounded-md border border-sidebar-border bg-background/60 px-2 text-[13px] text-muted-foreground hover:text-foreground">
        <Search className="size-4" /> <span className="flex-1 text-left">{t('Find a page…')}</span>
      </button>

      {/* the start page and what waits for approval, then the pages starred, then the parts */}
      {sections.filter((x) => x.label === 'Overview').map((section) => (
        <div key={section.label} className="flex flex-col gap-px">
          {menuEntries(section.items).map((e) => <Item key={e.key} item={entryItem(e)} collapsed={false} onNavigate={onNavigate} active={e.items.some((i) => i.href === activeHref)} />)}
        </div>
      ))}
      {quick.length > 0 && (
        <div className="mt-2 flex flex-col gap-px">
          <div className="flex items-center gap-1.5 px-2 pb-1 text-2xs font-medium text-muted-foreground/70">
            <Star className="size-3 fill-current text-warning" /> {t('Favourites')}
          </div>
          {quick.map((i) => <Item key={`q-${i.href}`} item={i} collapsed={false} onNavigate={onNavigate} active={i.href === activeHref} {...pinProps(i)} />)}
        </div>
      )}

      <div className="my-2 border-t border-sidebar-border" />
      {sections.map((section) => {
        if (section.label === 'Overview') return null
        const expanded = isOpen(section.label)
        const id = `nav-${section.label.replace(/\W+/g, '-')}`
        const entries = menuEntries(section.items)
        const divided = section.label === 'Reports|menu' || (section.label === 'Company' && !sections.some((x) => x.label === 'Reports|menu'))
        // a part with one entry (Reports, Settings, Hotel…): its name opens it straight away
        if (entries.length === 1) {
          const e = entries[0]!
          const on = e.items.some((i) => i.href === activeHref)
          return (
            <div key={section.label} className={cn('flex flex-col', divided && 'mt-2 border-t border-sidebar-border pt-3')}>
              <NavLink to={e.href} onClick={onNavigate} aria-current={on ? 'page' : undefined}
                className={cn('flex h-9 items-center gap-2.5 rounded-md px-2 text-[13.5px] font-medium text-sidebar-foreground hover:bg-[hsl(var(--sidebar-active)/0.55)] hover:text-foreground',
                  on && 'bg-[hsl(var(--sidebar-active))] text-foreground')}>
                <SectionIcon label={section.label} active={on} />
                <span className="flex-1 truncate text-left">{t(section.title ?? section.label)}</span>
              </NavLink>
            </div>
          )
        }
        return (
          <div key={section.label} className={cn('flex flex-col', divided && 'mt-2 border-t border-sidebar-border pt-3')}>
            <button type="button" aria-expanded={expanded} aria-controls={id}
              onClick={() => toggleSection(section.label)}
              className={cn('flex h-9 items-center gap-2.5 rounded-md px-2 text-[13.5px] font-medium text-sidebar-foreground hover:bg-[hsl(var(--sidebar-active)/0.55)] hover:text-foreground',
                expanded && 'text-foreground')}>
              <SectionIcon label={section.label} active={section.label === activeSection} />
              <span className="flex-1 truncate text-left">{t(section.title ?? section.label)}</span>
              <ChevronRight className={cn('size-3.5 text-muted-foreground/70 transition-transform', expanded && 'rotate-90')} />
            </button>
            {expanded && (
              <div id={id} className="flex flex-col gap-px pb-2 pt-0.5">
                {entries.map((e) => (
                  <Item key={e.key} item={entryItem(e)} sub collapsed={false} onNavigate={onNavigate}
                    active={e.items.some((i) => i.href === activeHref)} {...pinProps(e.items[0]!)} />
                ))}
              </div>
            )}
          </div>
        )
      })}
      {focused && (
        <button type="button" onClick={() => setFullMenu(!fullMenu)}
          className="mt-1 h-8 rounded-md px-2 text-left text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground">
          {fullMenu ? t('Only my work') : t('Show the whole menu')}
        </button>
      )}
    </nav>
  )
}

/*
 * The side menu, in black and white: a narrow rail with one icon per part of the program, and beside it
 * the pages of the part you are in. A click on another icon shows that part's pages without leaving the
 * page you are on; a part with a single page (Reports, Settings) opens it at once. Folded, only the rail
 * stays and each icon shows its pages beside it on hover.
 */
export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const sections = useMenuSections()
  const activeHref = useActiveHref()
  const navigate = useNavigate()
  const { can } = useCompany()
  const palette = useCommandPalette()
  const { favourites, toggle } = useFavourites()
  const [fullMenu, setFullMenu] = useFullMenu()
  const focused = !can('reports.read') && !can('finance.read') && !can('admin.read')
  React.useEffect(() => { if (activeHref) recordVisit(activeHref) }, [activeHref])

  const activeSection = sections.find((s) => s.items.some((i) => i.href === activeHref))?.label ?? 'Overview'
  // the part whose pages the panel shows: the one you are in, until you pick another on the rail
  const [view, setView] = React.useState(activeSection)
  React.useEffect(() => setView(activeSection), [activeSection])
  const byHref = React.useMemo(() => new Map(sections.flatMap((s) => s.items).map((i) => [i.href, i])), [sections])
  const overviewHrefs = new Set(sections.find((s) => s.label === 'Overview')?.items.map((i) => i.href) ?? [])
  const pinned = favourites.map((h) => byHref.get(h)).filter((i): i is NavItem => !!i && !overviewHrefs.has(i.href))
  const shown = sections.find((s) => s.label === view) ?? sections[0]
  const bottom = (label: string) => label === 'Reports|menu' || label === 'Company'

  const railButton = (section: (typeof sections)[number]) => {
    const entries = menuEntries(section.items)
    const here = section.label === activeSection
    const name = t(section.title ?? section.label)
    if (collapsed) return <SectionFlyout key={section.label} label={section.label} title={section.title} items={section.items} activeHref={activeHref} />
    return (
      <Tooltip key={section.label}>
        <TooltipTrigger asChild>
          <button type="button" aria-label={name} aria-pressed={section.label === view}
            onClick={() => { if (entries.length === 1) navigate(entries[0]!.href); setView(section.label) }}
            className={cn('relative grid size-10 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-[hsl(var(--sidebar-active)/0.6)] hover:text-foreground',
              section.label === view && 'bg-[hsl(var(--sidebar-active))] text-foreground')}>
            <SectionIcon label={section.label} active={here} className="size-5" />
            {here && section.label !== view && <span aria-hidden className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-foreground" />}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{name}</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <aside className="sidebar-mono sticky top-0 hidden h-dvh shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex print:!hidden">
      {/* the rail */}
      <div className={cn('flex w-[60px] shrink-0 flex-col items-center gap-1 py-2.5', !collapsed && 'border-r border-sidebar-border')}>
        {/* folded, the company is chosen here; open, the panel has it and the rail starts with DrisPRO */}
        <div className="mb-2 grid h-10 place-items-center">
          {collapsed ? <CompanySwitcher collapsed />
            : <NavLink to="/" aria-label="DrisPRO" className="grid size-10 place-items-center rounded-xl hover:bg-[hsl(var(--sidebar-active)/0.6)]"><img src="/favicon.svg" alt="" className="size-7" /></NavLink>}{/* i18n-ignore */}
        </div>
        <nav aria-label={t('Main menu')} className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto px-2.5">
          {sections.filter((s) => !bottom(s.label)).map(railButton)}
          {!collapsed && pinned.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" aria-label={t('Favourites')} aria-pressed={view === 'favourites'} onClick={() => setView('favourites')}
                  className={cn('grid size-10 place-items-center rounded-lg text-muted-foreground hover:bg-[hsl(var(--sidebar-active)/0.6)] hover:text-foreground',
                    view === 'favourites' && 'bg-[hsl(var(--sidebar-active))] text-foreground')}><Star className="size-5" strokeWidth={1.75} /></button>
              </TooltipTrigger>
              <TooltipContent side="right">{t('Favourites')}</TooltipContent>
            </Tooltip>
          )}
          <div className="mt-auto flex flex-col items-center gap-1 pt-3">{sections.filter((s) => bottom(s.label)).map(railButton)}</div>
        </nav>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" onClick={onToggle} aria-label={collapsed ? t('Expand the menu') : t('Collapse the menu')}
              className="mt-1 grid size-10 place-items-center rounded-lg text-muted-foreground hover:bg-[hsl(var(--sidebar-active)/0.6)] hover:text-foreground">
              {collapsed ? <PanelLeftOpen className="size-[18px]" strokeWidth={1.75} /> : <PanelLeftClose className="size-[18px]" strokeWidth={1.75} />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{collapsed ? t('Expand the menu') : t('Collapse the menu')}</TooltipContent>
        </Tooltip>
      </div>

      {/* the panel: the company, the unit, then the pages of the part */}
      {!collapsed && (
        <div className="flex w-[232px] min-w-0 flex-col bg-[hsl(var(--sidebar-panel))]">
          <div className="flex h-[56px] items-center px-2.5"><CompanySwitcher /></div>
          <div className="flex flex-col gap-2 px-3">
            <UnitPicker className="w-auto bg-background" />
            <button type="button" onClick={() => palette.open('pages')}
              className="flex h-8 items-center gap-2 rounded-md border border-sidebar-border bg-background px-2 text-[13px] text-muted-foreground hover:text-foreground">
              <Search className="size-4" /> <span className="flex-1 text-left">{t('Find a page…')}</span>
              <kbd className="rounded border border-sidebar-border px-1 font-sans text-[10.5px]">Ctrl K</kbd>{/* i18n-ignore */}
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-4">
            <p className="px-2 pb-1.5 text-[12px] font-medium text-muted-foreground">
              {view === 'favourites' ? t('Favourites') : t(shown?.title ?? shown?.label ?? '')}
            </p>
            <div className="flex flex-col gap-px">
              {view === 'favourites'
                ? pinned.map((i) => <Item key={i.href} item={i} collapsed={false} active={i.href === activeHref} pinned onTogglePin={() => toggle(i.href)} />)
                : shown && menuEntries(shown.items).map((e) => {
                  const on = e.items.some((i) => i.href === activeHref)
                  return (
                    <React.Fragment key={e.key}>
                      <Item item={entryItem(e)} collapsed={false} active={on && (e.items.length === 1 || e.items.length > 10)}
                        pinned={favourites.includes(e.items[0]!.href)} onTogglePin={() => toggle(e.items[0]!.href)} />
                      {/* the pages of the hub you are in, under it */}
                      {on && e.items.length > 1 && e.items.length <= 10 && (
                        <div className="mb-1 flex flex-col gap-px">
                          {e.items.map((i) => {
                            const here = i.href === activeHref
                            return (
                              <NavLink key={i.href} to={i.href} aria-current={here ? 'page' : undefined}
                                className={cn('flex min-h-8 items-center rounded-md py-1 pl-[38px] pr-2 text-[13px] leading-snug text-muted-foreground hover:bg-[hsl(var(--sidebar-active)/0.55)] hover:text-foreground',
                                  here && 'bg-[hsl(var(--sidebar-active))] font-medium text-foreground')}>
                                <span className="line-clamp-2">{t(i.label)}</span>
                              </NavLink>
                            )
                          })}
                        </div>
                      )}
                    </React.Fragment>
                  )
                })}
            </div>
            {view === 'Overview' && pinned.length > 0 && (
              <div className="mt-4 flex flex-col gap-px">
                <p className="flex items-center gap-1.5 px-2 pb-1.5 text-[12px] font-medium text-muted-foreground"><Star className="size-3 fill-current" /> {t('Favourites')}</p>
                {pinned.map((i) => <Item key={`f-${i.href}`} item={i} collapsed={false} active={i.href === activeHref} pinned onTogglePin={() => toggle(i.href)} />)}
              </div>
            )}
          </div>
          {focused && (
            <button type="button" onClick={() => setFullMenu(!fullMenu)}
              className="mx-3 mb-3 h-8 rounded-md px-2 text-left text-xs font-medium text-muted-foreground hover:bg-[hsl(var(--sidebar-active)/0.6)] hover:text-foreground">
              {fullMenu ? t('Only my work') : t('Show the whole menu')}
            </button>
          )}
        </div>
      )}
    </aside>
  )
}
