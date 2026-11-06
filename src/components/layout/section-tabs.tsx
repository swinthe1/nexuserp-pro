import { NavLink, useLocation } from 'react-router-dom'
import { useActiveHref, useMenuSections } from '@/components/layout/sidebar'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'

/**
 * The pages that share one entry of the menu (e.g. invoices, quotes, orders, deliveries), as tabs at the top
 * of each of them. Only on the lists themselves: a document opened from a list has its own way back.
 */
export function SectionTabs() {
  const sections = useMenuSections()
  const activeHref = useActiveHref()
  const { pathname } = useLocation()
  if (!activeHref) return null
  const section = sections.find((s) => s.items.some((i) => i.href === activeHref))
  const item = section?.items.find((i) => i.href === activeHref)
  if (!section || !item?.hub) return null
  const own = [item.href, ...(item.match ?? [])].map((h) => h.split('?')[0])
  if (!own.includes(pathname)) return null
  const tabs = section.items.filter((i) => i.hub === item.hub)
  if (tabs.length < 2) return null
  return (
    <nav aria-label={t(item.hub)} className="-mt-1 mb-4 border-b print:hidden">
      {/* many tabs go onto a second row: never a sideways scrollbar */}
      <div className="flex flex-wrap items-end gap-x-1">
        {tabs.map((i) => {
          const on = i.href === activeHref
          return (
            <NavLink key={i.href} to={i.href} aria-current={on ? 'page' : undefined}
              className={cn('-mb-px inline-flex h-9 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-[13.5px] font-medium transition-colors',
                on ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground')}>
              <i.icon className={cn('size-4', on ? 'text-primary' : 'text-muted-foreground')} strokeWidth={1.75} />
              {t(i.label)}
            </NavLink>
          )
        })}
      </div>
    </nav>
  )
}
