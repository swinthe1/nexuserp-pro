import { ChevronRight, PanelLeftClose, PanelLeftOpen, Search, Star } from 'lucide-react'
import * as React from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useCompany } from '@/app/company-provider'
import { NAV, type NavItem } from '@/app/nav'
import { useCommandPalette } from '@/components/layout/command-palette'
import { CompanySwitcher } from '@/components/layout/company-switcher'
import { mostUsed, recordVisit, useFavourites, useHiddenSections, useOpenSections } from '@/components/layout/nav-prefs'
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
    for (const item of NAV.flatMap((s) => s.items)) {
      const [path, query] = item.href.split('?') as [string, string | undefined]
      const pathOk = path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`)
      if (!pathOk) continue
      const q = new URLSearchParams(query ?? '')
      if ([...q.entries()].some(([k, v]) => params.get(k) !== v)) continue
      const score = path.length + (query ? 1000 : 0)
      if (score > bestScore) { best = item.href; bestScore = score }
    }
    return best
  }, [pathname, search])
}

const ALWAYS_SHOWN = new Set(['Overview', 'Company'])

function Item({ item, collapsed, onNavigate, active, pinned, onTogglePin }: {
  item: NavItem; collapsed: boolean; onNavigate?: () => void; active: boolean; pinned?: boolean; onTogglePin?: () => void
}) {
  const Icon = item.icon
  const link = (
    <NavLink
      to={item.href}
      end={item.href === '/'}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={() =>
        cn(
          'group/item flex h-8 min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 text-[13px] font-medium text-sidebar-foreground transition-colors hover:bg-secondary hover:text-foreground',
          active && 'bg-card text-foreground shadow-sm ring-1 ring-border',
          collapsed && 'justify-center px-0',
        )
      }
    >
      {() => (
        <>
          <Icon className={cn('size-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground group-hover/item:text-foreground')} />
          {!collapsed && <span className="flex-1 truncate">{t(item.label)}</span>}
        </>
      )}
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

export function SidebarNav({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const { can, pageAllowed } = useCompany()
  const activeHref = useActiveHref()
  const hidden = useHiddenSections()
  const { favourites, toggle } = useFavourites()
  const { open, set: setOpen } = useOpenSections()
  const palette = useCommandPalette()

  React.useEffect(() => { if (activeHref) recordVisit(activeHref) }, [activeHref])

  const sections = React.useMemo(() => NAV
    .filter((s) => ALWAYS_SHOWN.has(s.label) || !hidden.includes(s.label))
    .map((s) => ({ ...s, items: s.items.filter((i) => can(i.perm) && pageAllowed(i.href)) }))
    .filter((s) => s.items.length), [can, pageAllowed, hidden])
  const byHref = React.useMemo(() => new Map(sections.flatMap((s) => s.items).map((i) => [i.href, i])), [sections])

  // pinned pages first; until something is pinned, the pages used most on this device
  const pinnedItems = favourites.map((h) => byHref.get(h)).filter((i): i is NavItem => !!i)
  const suggested = pinnedItems.length ? [] : mostUsed(5, (h) => byHref.has(h)).map((h) => byHref.get(h)!)
  const quick = pinnedItems.length ? pinnedItems : suggested
  const activeSection = sections.find((s) => s.items.some((i) => i.href === activeHref))?.label
  const openSet = new Set(open ?? [])
  const isOpen = (label: string) => label === activeSection || openSet.has(label)
  const toggleSection = (label: string) => setOpen(openSet.has(label) ? [...openSet].filter((l) => l !== label) : [...openSet, label])
  const pinProps = (i: NavItem) => ({ pinned: favourites.includes(i.href), onTogglePin: () => toggle(i.href) })

  if (collapsed) {
    return (
      <nav className="flex flex-col gap-4" aria-label={t('Main menu')}>
        {quick.length > 0 && (
          <div className="flex flex-col gap-0.5 border-b border-sidebar-border pb-3">
            {quick.map((i) => <Item key={i.href} item={i} collapsed onNavigate={onNavigate} active={i.href === activeHref} />)}
          </div>
        )}
        {sections.map((section) => (
          <div key={section.label} className="flex flex-col gap-0.5">
            {section.items.map((i) => <Item key={i.href} item={i} collapsed onNavigate={onNavigate} active={i.href === activeHref} />)}
          </div>
        ))}
      </nav>
    )
  }

  return (
    <nav className="flex flex-col gap-3" aria-label={t('Main menu')}>
      <button type="button" onClick={palette.open}
        className="flex h-8 items-center gap-2 rounded-md border border-sidebar-border bg-background/60 px-2 text-[13px] text-muted-foreground hover:text-foreground">
        <Search className="size-4" /> <span className="flex-1 text-left">{t('Find a page…')}</span><kbd className="text-2xs">{"Ctrl K"}</kbd>
      </button>

      {quick.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5 px-2 pb-1 text-xs font-medium text-muted-foreground/80">
            {pinnedItems.length ? <><Star className="size-3 fill-current text-warning" /> {t('Favourites')}</> : t('Used most')}
          </div>
          {quick.map((i) => <Item key={`q-${i.href}`} item={i} collapsed={false} onNavigate={onNavigate} active={i.href === activeHref} {...pinProps(i)} />)}
          {!pinnedItems.length && <p className="px-2 pt-1 text-2xs text-muted-foreground">{t('Click the star next to a page to keep it here.')}</p>}
        </div>
      )}

      {sections.map((section) => {
        if (section.label === 'Overview') {
          return (
            <div key={section.label} className="flex flex-col gap-0.5">
              {section.items.map((i) => <Item key={i.href} item={i} collapsed={false} onNavigate={onNavigate} active={i.href === activeHref} />)}
            </div>
          )
        }
        const expanded = isOpen(section.label)
        const id = `nav-${section.label.replace(/\W+/g, '-')}`
        return (
          <div key={section.label} className="flex flex-col gap-0.5">
            <button type="button" aria-expanded={expanded} aria-controls={id}
              disabled={section.label === activeSection}
              onClick={() => toggleSection(section.label)}
              className="flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground/90 hover:bg-secondary hover:text-foreground disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-muted-foreground/90">
              <ChevronRight className={cn('size-3.5 transition-transform', expanded && 'rotate-90')} />
              <span className="flex-1 text-left">{t(section.label)}</span>
              {!expanded && <span className="text-2xs font-normal text-muted-foreground/70">{section.items.length}</span>}
            </button>
            {expanded && (
              <div id={id} className="flex flex-col gap-0.5">
                {section.items.map((i) => <Item key={i.href} item={i} collapsed={false} onNavigate={onNavigate} active={i.href === activeHref} {...pinProps(i)} />)}
              </div>
            )}
          </div>
        )
      })}
    </nav>
  )
}

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <aside
      className={cn(
        'sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 lg:flex print:!hidden',
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
          {collapsed ? <PanelLeftOpen className="size-4" /> : <><PanelLeftClose className="size-4" /> {t('Collapse|menu')} <kbd className="ml-auto text-2xs">[</kbd></>}
        </button>
      </div>
    </aside>
  )
}
