import {
  ArrowDownLeft, ArrowUpRight, Boxes, CalendarClock, FileText, PackageCheck, Plus, Receipt, ReceiptText, ShoppingBag, Store, UserPlus, type LucideIcon,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useCompany } from '@/app/company-provider'
import { NAV } from '@/app/nav'
import { useHiddenSections } from '@/components/layout/nav-prefs'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { msg, t } from '@/i18n'

type Choice = { label: string; hint: string; href: string; icon: LucideIcon; perm: string; page?: string }

/*
 * "+ New": what happened, in everyday words, straight to the right form.
 * Nobody has to know whether it is a "vendor bill" or a "goods receipt".
 */
const CHOICES = (photo: boolean): Choice[] => [
  { label: msg('I sold something'), hint: msg('An invoice for a customer'), href: '/sales/invoices/new', icon: Receipt, perm: 'invoicing.write' },
  { label: msg('A sale at the till'), hint: msg('Open the till'), href: '/pos', icon: Store, perm: 'pos.write' },
  { label: msg('An offer for a customer'), hint: msg('Prices before they decide'), href: '/sales/quotes/new', icon: FileText, perm: 'sales.write', page: '/sales/quotes' },
  { label: msg('A customer ordered'), hint: msg('An order to prepare or deliver'), href: '/sales/orders/new', icon: ShoppingBag, perm: 'sales.write', page: '/sales/orders' },
  { label: msg('A customer paid me'), hint: msg('Cash or bank, against their invoices'), href: '/finance/payments/new?type=customer_payment', icon: ArrowDownLeft, perm: 'invoicing.write' },
  { label: msg('I bought goods'), hint: photo ? msg('A photo of the supplier’s invoice') : msg('The supplier’s invoice with the goods'),
    href: photo ? '/inventory/read-invoice' : '/procurement/invoice/new', icon: PackageCheck, perm: 'invoicing.write' },
  { label: msg('Goods came, the invoice not yet'), hint: msg('Receive the goods now'), href: '/inventory/receipts/new', icon: PackageCheck, perm: 'wms.write', page: '/inventory/receipts' },
  { label: msg('I paid a supplier'), hint: msg('Cash or bank, against their invoices'), href: '/finance/payments/new?type=vendor_payment', icon: ArrowUpRight, perm: 'invoicing.write' },
  { label: msg('An expense'), hint: msg('Fuel, electricity, phone: a photo of the receipt'), href: '/finance/expenses', icon: ReceiptText, perm: 'invoicing.write' },
  { label: msg('An appointment'), hint: msg('A client for a time'), href: '/appointments', icon: CalendarClock, perm: 'sales.write' },
  { label: msg('A new customer or supplier'), hint: msg('Find it by NUI or name'), href: '/partners/new', icon: UserPlus, perm: 'partners.write' },
  { label: msg('A new item'), hint: msg('Something you sell or keep in stock'), href: '/inventory/products/new', icon: Boxes, perm: 'inventory.write', page: '/inventory/products' },
]

export function NewMenu() {
  const { can, pageAllowed, hasFeature } = useCompany()
  const hidden = useHiddenSections()
  const navigate = useNavigate()
  const items = CHOICES(hasFeature('ai_reads')).filter((c) => {
    const page = c.page ?? c.href.split('?')[0]!
    // the part of the menu it belongs to, when the company switched that part off
    const part = NAV.find((s) => s.items.some((i) => i.href.split('?')[0] === page))?.label
    return can(c.perm) && pageAllowed(page) && !(part && hidden.includes(part)) && !hidden.some((h) => h === page || page.startsWith(`${h}/`))
  })
  if (!items.length) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" className="size-9 shrink-0 rounded-full" aria-label={t('New|create')} title={t('New|create')}><Plus className="size-5" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 p-1.5">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">{t('What happened?')}</DropdownMenuLabel>
        {items.map((c) => (
          <DropdownMenuItem key={c.href} onSelect={() => navigate(c.href)} className="items-start gap-3 py-2">
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><c.icon className="size-4" /></span>
            <span className="grid gap-0.5"><span className="text-sm font-medium">{t(c.label)}</span><span className="text-xs text-muted-foreground">{t(c.hint)}</span></span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
