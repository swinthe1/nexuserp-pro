import { LayoutDashboard, Menu, Package, Plus, Store } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useCompany } from '@/app/company-provider'
import { NewMenu } from '@/components/layout/new-menu'
import { useHiddenSections } from '@/components/layout/nav-prefs'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'

/**
 * On a phone: the five things used most, at the thumb (the panel, the till, the items, something new,
 * the whole menu). Hidden on larger screens, where the side menu is always there.
 */
export function BottomBar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { can, pageAllowed } = useCompany()
  const hidden = useHiddenSections()
  const shows = (href: string, perm: string) => can(perm) && pageAllowed(href) && !hidden.includes(href)
  const item = 'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium'
  const link = ({ isActive }: { isActive: boolean }) => cn(item, isActive ? 'text-primary' : 'text-muted-foreground')
  return (
    <nav aria-label={t('Main menu')} className="fixed inset-x-0 bottom-0 z-40 flex border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden print:hidden">
      <NavLink to="/" end className={link}><LayoutDashboard className="size-5" />{t('Dashboard')}</NavLink>
      {shows('/pos', 'pos.read') && <NavLink to="/pos" className={link}><Store className="size-5" />{t('Till|menu')}</NavLink>}
      <div className={cn(item)}>
        <NewMenu trigger={<button type="button" className="-mt-5 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg" aria-label={t('New|create')}><Plus className="size-6" /></button>} />
      </div>
      {shows('/inventory/products', 'inventory.read') && <NavLink to="/inventory/products" className={link}><Package className="size-5" />{t('Items|menu')}</NavLink>}
      <button type="button" onClick={onOpenMenu} className={cn(item, 'text-muted-foreground')}><Menu className="size-5" />{t('Menu')}</button>
    </nav>
  )
}
