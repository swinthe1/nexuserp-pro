import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import * as React from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useCompany } from '@/app/company-provider'
import { NAV, type NavItem } from '@/app/nav'
import { CompanySwitcher } from '@/components/layout/company-switcher'
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

function Item({ item, collapsed, onNavigate, active }: { item: NavItem; collapsed: boolean; onNavigate?: () => void; active: boolean }) {
  const Icon = item.icon
  const link = (
    <NavLink
      to={item.href}
      end={item.href === '/'}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={() =>
        cn(
          'group flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] font-medium text-sidebar-foreground transition-colors hover:bg-secondary hover:text-foreground',
          active && 'bg-card text-foreground shadow-sm ring-1 ring-border',
          collapsed && 'justify-center px-0',
        )
      }
    >
      {() => (
        <>
          <Icon className={cn('size-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground')} />
          {!collapsed && <span className="flex-1 truncate">{t(item.label)}</span>}
        </>
      )}
    </NavLink>
  )
  if (!collapsed) return link
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{t(item.label)}</TooltipContent>
    </Tooltip>
  )
}

export function SidebarNav({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const { can } = useCompany()
  const activeHref = useActiveHref()
  return (
    <nav className="flex flex-col gap-4" aria-label={t('Main menu')}>
      {NAV.map((section) => {
        const items = section.items.filter((i) => can(i.perm))
        if (!items.length) return null
        return (
          <div key={section.label} className="flex flex-col gap-0.5">
            {!collapsed && <div className="px-2 pb-1 text-xs font-medium text-muted-foreground/80">{t(section.label)}</div>}
            {items.map((i) => <Item key={i.href} item={i} collapsed={collapsed} onNavigate={onNavigate} active={i.href === activeHref} />)}
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
