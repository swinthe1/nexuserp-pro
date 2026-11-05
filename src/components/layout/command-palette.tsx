import { useQuery } from '@tanstack/react-query'
import {
  Clock, Languages, CalendarDays, ClipboardPen, Contact, FileBarChart, Globe, Import, MapPinned, Route, UserPlus, Wallet,
  ArrowDownLeft, ArrowLeftRight, Layers, ArrowUpRight, BookOpenText, Boxes, Building, ClipboardList, Landmark, ListTree, Factory, FileCheck2, FileText, ShoppingCart, Kanban, Magnet, Moon, PackageCheck, Plus, Receipt, Ship, ShoppingBag, SlidersHorizontal, Sun, Truck, User, Warehouse,
} from 'lucide-react'
import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { useCompany } from '@/app/company-provider'
import { NAV } from '@/app/nav'
import { useHiddenSections } from '@/components/layout/nav-prefs'
import { useTheme } from '@/app/theme-provider'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from '@/components/ui/command'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useDebounce } from '@/hooks/use-debounce'
import { useHotkey } from '@/hooks/use-hotkey'
import { LOCALES, msg, t, tServer, useLocale } from '@/i18n'
import { chooseLocale } from '@/i18n/language'
import { useAuth } from '@/app/auth-provider'
import { supabase } from '@/lib/supabase'

type Mode = 'all' | 'pages'
const CommandPaletteContext = React.createContext<{ open: (mode?: Mode) => void }>({ open: () => {} })
export const useCommandPalette = () => React.useContext(CommandPaletteContext)

const RESULT_ICON: Record<string, typeof Boxes> = { product: Boxes, partner: User, warehouse: Warehouse, opportunity: Kanban, lead: Magnet, sales_quote: FileText, sales_order: ShoppingBag, delivery: Truck, sales_invoice: Receipt, purchase_order: ShoppingCart, purchase_requisition: ClipboardList, vendor_bill: FileCheck2, account: ListTree, payment: Landmark, journal_entry: BookOpenText, fixed_asset: Building, work_order: Factory, bom: Layers,
  employee: Contact, shipment: Route, delivery_route: MapPinned, channel_order: Globe, vat_declaration: ClipboardPen, payroll_run: Wallet, leave_request: CalendarDays }

const CREATE_ACTIONS = [
  { label: msg('New quote'), href: '/sales/quotes/new', icon: FileText, perm: 'sales.write' },
  { label: msg('New sales order'), href: '/sales/orders/new', icon: ShoppingBag, perm: 'sales.write' },
  { label: msg('New lead'), href: '/crm/leads?open=new', icon: Magnet, perm: 'crm.write' },
  { label: msg('New deal'), href: '/crm/pipeline?open=new', icon: Kanban, perm: 'crm.write' },
  { label: msg('New customer'), href: '/partners/new', icon: User, perm: 'partners.write' },
  { label: msg('New purchase order'), href: '/procurement/orders/new', icon: ShoppingCart, perm: 'procurement.write' },
  { label: msg('New requisition'), href: '/procurement/requisitions/new', icon: ClipboardList, perm: 'requisitions.write' },
  { label: msg('New purchase invoice with goods'), href: '/procurement/invoice/new', icon: PackageCheck, perm: 'invoicing.write' },
  { label: msg('New vendor bill'), href: '/procurement/bills/new', icon: FileCheck2, perm: 'invoicing.write' },
  { label: msg('New vendor'), href: '/partners/new?vendor=1', icon: Factory, perm: 'partners.write' },
  { label: msg('New product'), href: '/inventory/products/new', icon: Boxes, perm: 'inventory.write' },
  { label: msg('New goods receipt'), href: '/inventory/receipts/new', icon: PackageCheck, perm: 'wms.write' },
  { label: msg('New stock adjustment'), href: '/inventory/adjustments/new', icon: SlidersHorizontal, perm: 'inventory.write' },
  { label: msg('New transfer'), href: '/inventory/transfers/new', icon: ArrowLeftRight, perm: 'wms.write' },
  { label: msg('New landed cost'), href: '/inventory/landed-costs/new', icon: Ship, perm: 'procurement.write' },
  { label: msg('Receive a customer payment'), href: '/finance/payments/new?type=customer_payment', icon: ArrowDownLeft, perm: 'invoicing.write' },
  { label: msg('Pay a vendor'), href: '/finance/payments/new?type=vendor_payment', icon: ArrowUpRight, perm: 'invoicing.write' },
  { label: msg('New manual journal entry'), href: '/finance/journal/new', icon: BookOpenText, perm: 'finance.write' },
  { label: msg('New fixed asset'), href: '/finance/assets/new', icon: Building, perm: 'finance.write' },
  { label: msg('New work order'), href: '/manufacturing/orders?new=1', icon: Factory, perm: 'manufacturing.write' },
  { label: msg('New bill of materials'), href: '/manufacturing/boms/new', icon: Layers, perm: 'manufacturing.write' },
  { label: msg('New employee'), href: '/hr/employees/new', icon: Contact, perm: 'hr.write' },
  { label: msg('Request leave'), href: '/hr/me', icon: CalendarDays, perm: 'core.read' },
  { label: msg('Run payroll'), href: '/hr/payroll', icon: Wallet, perm: 'payroll.write' },
  { label: msg('Prepare the VAT return'), href: '/tax/declarations', icon: ClipboardPen, perm: 'tax.write' },
  { label: msg('Plan deliveries'), href: '/logistics/planning', icon: MapPinned, perm: 'logistics.write' },
  { label: msg('Invite a user'), href: '/settings/users?invite=1', icon: UserPlus, perm: 'admin.write' },
  { label: msg('Import data from a file'), href: '/settings/import', icon: Import, perm: 'core.read' },
  { label: msg('Run a report'), href: '/reports', icon: FileBarChart, perm: 'core.read' },
]

const KIND_LABEL: Record<string, string> = {
  product: msg('Product'), partner: msg('Customer or vendor'), warehouse: msg('Warehouse'), opportunity: msg('Deal'), lead: msg('Lead|kind'),
  sales_quote: msg('Quote'), sales_order: msg('Sales order'), delivery: msg('Delivery'), sales_invoice: msg('Customer invoice'),
  purchase_order: msg('Purchase order'), purchase_requisition: msg('Requisition'), vendor_bill: msg('Vendor bill'), account: msg('Account'),
  payment: msg('Payment'), journal_entry: msg('Journal entry'), fixed_asset: msg('Fixed asset'), work_order: msg('Work order'), bom: msg('Bill of materials'),
  employee: msg('Employee'), shipment: msg('Shipment'), delivery_route: msg('Route'), channel_order: msg('Web order'), vat_declaration: msg('VAT declaration'),
  payroll_run: msg('Payroll'), leave_request: msg('Leave request'),
}

/** Lower case without accents, so "fature" finds "Faturë" and "cmim" finds "Çmim". */
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

function matches(q: string, ...parts: (string | undefined)[]) {
  if (!q) return true
  const hay = fold(parts.filter(Boolean).join(' '))
  return fold(q).split(/\s+/).every((w) => hay.includes(w))
}

// pages opened from the palette, newest first, so the empty palette offers them again
const RECENT_KEY = 'drispro.palette.recent'
type Recent = { href: string; label: string; kind?: string }
function readRecent(): Recent[] {
  try { return (JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as Recent[]).slice(0, 6) } catch { return [] }
}
function pushRecent(r: Recent) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([r, ...readRecent().filter((x) => x.href !== r.href)].slice(0, 6))) } catch { /* ignore */ }
}

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  // 'pages': only the menu (the sidebar's “Find a page”), no products, customers or documents
  const [mode, setMode] = React.useState<Mode>('all')
  const [query, setQuery] = React.useState('')
  const q = useDebounce(query.trim(), 200)
  const navigate = useNavigate()
  const { can, companyId, pageAllowed } = useCompany()
  const { resolved, setTheme } = useTheme()
  const { user } = useAuth()
  const locale = useLocale()
  const [recent, setRecent] = React.useState<Recent[]>(readRecent)

  useHotkey('k', () => { setMode('all'); setOpen((o) => !o) }, { mod: true })
  useHotkey('/', () => { setMode('all'); setOpen(true) })

  const search = useQuery({
    queryKey: ['global-search', companyId, q],
    enabled: open && mode === 'all' && !!companyId && q.length >= 2,
    staleTime: 10_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('global_search', { p_company: companyId, p_query: q })
      if (error) throw error
      return data
    },
  })

  const go = (href: string, remember?: Omit<Recent, 'href'>) => {
    if (remember) { pushRecent({ href, ...remember }); setRecent(readRecent()) }
    setOpen(false)
    setQuery('')
    navigate(href)
  }

  const hiddenMenu = useHiddenSections()
  const navItems = NAV.flatMap((s) => s.items.map((i) => ({ ...i, section: s.label, sectionTitle: s.title ?? s.label })))
    .filter((i) => can(i.perm) && pageAllowed(i.href)
      && (i.section === 'Overview' || i.section === 'Company' || !hiddenMenu.includes(i.section)) && !hiddenMenu.includes(i.href) && !(i.part && hiddenMenu.includes(i.part)))
    // a page once, where this business sees it first
    .filter((i, n, all) => all.findIndex((x) => x.href === i.href) === n && matches(query, i.label, t(i.label), i.section, t(i.section), t(i.sectionTitle), ...(i.hub ? [i.hub, t(i.hub)] : []), ...(i.keywords ?? [])))
  const actions = mode === 'pages' ? [] : CREATE_ACTIONS.filter((a) => can(a.perm) && pageAllowed(a.href) && matches(query, a.label, t(a.label)))
  const navPages = navItems.length > 0 && (
    <CommandGroup heading={t('Go to')}>
      {navItems.map((i) => (
        <CommandItem key={i.href} value={`nav-${i.href}`} onSelect={() => go(i.href)}>
          <i.icon /> {t(i.label)}
          <CommandShortcut>{t(i.sectionTitle)}</CommandShortcut>
        </CommandItem>
      ))}
    </CommandGroup>
  )
  const showRecent = mode === 'all' && !query && recent.length > 0
  const results = mode === 'all' ? search.data ?? [] : []

  return (
    <CommandPaletteContext.Provider value={{ open: (m = 'all') => { setMode(m); setOpen(true) } }}>
      {children}
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery('') }}>
        <DialogContent className="top-[18%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0" hideClose>
          <DialogTitle className="sr-only">{t('Search and commands')}</DialogTitle>
          <Command shouldFilter={false} loop>
            <CommandInput value={query} onValueChange={setQuery} placeholder={mode === 'pages' ? t('Find a page…') : t('Search products, documents, customers, or type what you want to do…')} />
            <CommandList>
              <CommandEmpty>{mode === 'pages' ? t('No page matches “{q}”.', { q: query }) : search.isFetching ? t('Searching…') : search.isError ? t('Search is not available right now.') : t('Nothing matches “{q}”.', { q: query })}</CommandEmpty>
              {showRecent && (
                <CommandGroup heading={t('Recently opened')}>
                  {recent.map((r) => (
                    <CommandItem key={`recent-${r.href}`} value={`recent-${r.href}`} onSelect={() => go(r.href)}>
                      <Clock /> <span className="truncate">{r.label}</span>
                      {r.kind && <CommandShortcut>{t(KIND_LABEL[r.kind] ?? r.kind)}</CommandShortcut>}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {/* a page whose name matches comes before products and documents */}
              {(query || mode === 'pages') && navPages}
              {results.length > 0 && (
                <CommandGroup heading={t('Results')}>
                  {results.map((r) => {
                    const Icon = RESULT_ICON[r.kind ?? ''] ?? FileText
                    return (
                      <CommandItem key={`${r.kind}-${r.id}`} value={`${r.kind}-${r.id}`} onSelect={() => r.href && go(r.href, { label: r.title ?? '', kind: r.kind ?? undefined })}>
                        <Icon />
                        <span className="truncate">{r.title}</span>
                        <span className="truncate text-xs text-muted-foreground">{tServer(r.subtitle)}</span>
                        <CommandShortcut>{t(KIND_LABEL[r.kind ?? ''] ?? '') || null}</CommandShortcut>
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              )}
              {actions.length > 0 && (
                <CommandGroup heading={t('Create')}>
                  {actions.map((a) => (
                    <CommandItem key={a.href} value={a.href} onSelect={() => go(a.href)}>
                      <Plus /> {t(a.label)}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {!query && mode === 'all' && navPages}
              {mode === 'all' && matches(query, 'theme dark light mode language shqip english srpski jezik gjuha pamja tema', t('Appearance'), t('Language')) && (
                <CommandGroup heading={t('Preferences')}>
                  <CommandItem value="theme" onSelect={() => { setTheme(resolved === 'dark' ? 'light' : 'dark'); setOpen(false) }}>
                    {resolved === 'dark' ? <Sun /> : <Moon />} {resolved === 'dark' ? t('Switch to the light look') : t('Switch to the dark look')}
                  </CommandItem>
                  {LOCALES.filter((l) => l.key !== locale).map((l) => (
                    <CommandItem key={l.key} value={`lang-${l.key}`} onSelect={() => { setOpen(false); chooseLocale(l.key, user?.id) }}>
                      <Languages /> <span lang={l.key}>{l.key === 'sq' ? 'Kalo në shqip' : l.key === 'sr' ? 'Prebaci na srpski' : 'Switch to English'}</span>{/* i18n-ignore */}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
            <div className="flex items-center gap-3 border-t px-3 py-2 text-2xs text-muted-foreground">
              <span><kbd className="font-sans">↑↓</kbd> {t('move')}</span>
              <span><kbd className="font-sans">↵</kbd> {t('open|verb')}</span>
              <span><kbd className="font-sans">esc</kbd> {t('close|verb')}</span>
              {mode === 'all' && <span className="ml-auto hidden sm:inline">{t('Scan a barcode to jump to its product')}</span>}
            </div>
          </Command>
        </DialogContent>
      </Dialog>
    </CommandPaletteContext.Provider>
  )
}
