import { ChevronRight, PanelLeftClose, PanelLeftOpen, Search, Star } from 'lucide-react'
import * as React from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useCompany } from '@/app/company-provider'
import { moduleLook } from '@/app/modules'
import { NAV, type NavItem } from '@/app/nav'
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

/*
 * The short menu: a person whose job is one part (the till, the warehouse, field sales) sees the pages
 * of the work they do, not every page they may open. Whoever sees the numbers (reports, finance) or runs
 * the company sees the whole menu. One click shows everything; the choice is kept on this device.
 */
const FULL_KEY = 'drispro.menu.full'
function useFullMenu() {
  const [full, setFull] = React.useState(() => { try { return localStorage.getItem(FULL_KEY) === '1' } catch { return false } })
  const set = (v: boolean) => { setFull(v); try { localStorage.setItem(FULL_KEY, v ? '1' : '0') } catch { /* private window */ } }
  return [full, set] as const
}
const writes = (perm: string) => perm.split('|').map((p) => p.replace(/\.read$/, '.write'))


/** a part's icon: one quiet colour for all, the brand colour for the part you are in */
function SectionIcon({ label, className, active }: { label: string; className?: string; active?: boolean }) {
  const Icon = moduleLook(label).icon
  return <Icon aria-hidden className={cn('size-[18px] shrink-0', active ? 'text-primary' : 'text-muted-foreground', className)} strokeWidth={1.75} />
}

function SectionFlyout({ label, title, items, activeHref, onNavigate }: { label: string; title?: string; items: NavItem[]; activeHref: string | null; onNavigate?: () => void }) {
  const [open, setOpen] = React.useState(false)
  const timer = React.useRef<number | undefined>(undefined)
  const show = () => { window.clearTimeout(timer.current); setOpen(true) }
  const hide = () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setOpen(false), 160) }
  const active = items.some((i) => i.href === activeHref)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={t(title ?? label)} onMouseEnter={show} onMouseLeave={hide}
          className={cn('flex h-9 w-full items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground',
            active && 'bg-secondary ring-1 ring-primary/40', open && !active && 'bg-secondary text-foreground')}>
          <SectionIcon label={label} active={active} className="size-5" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" sideOffset={10} className="w-60 p-1.5" onMouseEnter={show} onMouseLeave={hide}
        onOpenAutoFocus={(e) => e.preventDefault()} onCloseAutoFocus={(e) => e.preventDefault()}>
        <p className="px-2 pb-1 pt-1 text-xs font-medium text-muted-foreground">{t(title ?? label)}</p>
        <div className="flex flex-col gap-0.5">
          {items.map((i) => (
            <NavLink key={i.href} to={i.href} onClick={() => { setOpen(false); onNavigate?.() }}
              className={cn('flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] font-medium hover:bg-secondary',
                i.href === activeHref ? 'bg-secondary text-foreground' : 'text-popover-foreground')}>
              <i.icon className={cn('size-4 shrink-0', i.href === activeHref ? 'text-primary' : 'text-muted-foreground')} />
              <span className="truncate">{t(i.label)}</span>
            </NavLink>
          ))}
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
          'group/item relative flex min-w-0 flex-1 basis-auto items-center rounded-md text-sidebar-foreground transition-colors hover:bg-primary/[0.08] hover:text-foreground',
          sub ? 'min-h-8 gap-2.5 py-1.5 pl-[30px] pr-7 text-[13px] leading-snug' : 'h-9 gap-2.5 px-2 text-[13.5px] font-medium',
          active && 'bg-primary/[0.14] font-medium text-white',
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
    // an item without its own group heading belongs to the one above it
    .map((s) => { let g: string | undefined; return { ...s, items: s.items.map((i): NavItem => { g = i.group ?? g; return { ...i, group: g } }) } })
    .filter((s) => ALWAYS_SHOWN.has(s.label) || !hidden.includes(s.label))
    .map((s) => ({ ...s, items: s.items.filter((i) => !i.hideInMenu && can(i.perm) && pageAllowed(i.href) && !hidden.includes(i.href) && mine(i)) }))
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
    // an item without its own group heading belongs to the one above it
    .map((s) => { let g: string | undefined; return { ...s, items: s.items.map((i): NavItem => { g = i.group ?? g; return { ...i, group: g } }) } })
    .filter((s) => ALWAYS_SHOWN.has(s.label) || !hidden.includes(s.label))
    .map((s) => ({ ...s, items: s.items.filter((i) => !i.hideInMenu && can(i.perm) && pageAllowed(i.href) && !hidden.includes(i.href) && mine(i)) }))
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
        {overview?.items.map((i) => <Item key={i.href} item={i} collapsed onNavigate={onNavigate} active={i.href === activeHref} />)}
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
          {section.items.map((i) => <Item key={i.href} item={i} collapsed={false} onNavigate={onNavigate} active={i.href === activeHref} />)}
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
        return (
          <div key={section.label} className={cn('flex flex-col', (section.label === 'Reports|menu' || (section.label === 'Company' && !sections.some((x) => x.label === 'Reports|menu'))) && 'mt-2 border-t border-sidebar-border pt-3')}>
            <button type="button" aria-expanded={expanded} aria-controls={id}
              onClick={() => toggleSection(section.label)}
              className={cn('flex h-9 items-center gap-2.5 rounded-md px-2 text-[13.5px] font-medium text-sidebar-foreground hover:bg-primary/[0.08] hover:text-foreground',
                expanded && 'text-white')}>
              <SectionIcon label={section.label} active={section.label === activeSection} />
              <span className="flex-1 truncate text-left">{t(section.title ?? section.label)}</span>
              <ChevronRight className={cn('size-3.5 text-muted-foreground/70 transition-transform', expanded && 'rotate-90')} />
            </button>
            {expanded && (
              <div id={id} className="flex flex-col gap-px pb-2 pt-0.5">
                {section.items.map((i, k) => {
                  // headings inside a long part only; a short one reads fine as it is
                  const heading = section.items.length > 7 && i.group && i.group !== section.items[k - 1]?.group ? i.group : null
                  return (
                    <React.Fragment key={i.href}>
                      {heading && <div className={cn('pb-0.5 pl-[30px] text-2xs font-medium text-primary/70', k > 0 && 'pt-2.5')}>{t(heading)}</div>}
                      <Item item={i} sub collapsed={false} onNavigate={onNavigate} active={i.href === activeHref} {...pinProps(i)} />
                    </React.Fragment>
                  )
                })}
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

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <aside
      className={cn(
        'sidebar-navy sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 lg:flex print:!hidden',
        collapsed ? 'w-[60px]' : 'w-[244px]',
      )}
    >
      <div className={cn('flex h-[52px] items-center px-2.5', collapsed && 'justify-center')}>
        <CompanySwitcher collapsed={collapsed} />
      </div>
      <div className="flex-1 overflow-y-auto px-2.5 pb-4 pt-2">
        <SidebarNav collapsed={collapsed} />
      </div>
      <div className={cn('border-t border-sidebar-border p-2.5', collapsed && 'flex justify-center')}>
        <button
          onClick={onToggle}
          className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] text-muted-foreground hover:bg-secondary hover:text-foreground"
          aria-label={collapsed ? t('Expand the menu') : t('Collapse the menu')}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <><PanelLeftClose className="size-4" /> {t('Collapse|menu')}</>}
        </button>
      </div>
    </aside>
  )
}
