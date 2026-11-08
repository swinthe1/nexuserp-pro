import { ArrowDown, ArrowDownLeft, ArrowLeftRight, ArrowUp, ArrowUpDown, ArrowUpRight, BookOpen, Boxes, Check, FileCheck2, FileText, PackageCheck, Plus, Receipt, ReceiptText, Search, Settings2, ShoppingBag, ShoppingCart, SlidersHorizontal, UserPlus, UserRound, X, type LucideIcon } from 'lucide-react'
import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { moduleLook } from '@/app/modules'
import { useCompany } from '@/app/company-provider'
import { NAV } from '@/app/nav'
import { useHiddenSections } from '@/components/layout/nav-prefs'
import { MAX_SHORTCUTS, useTopShortcuts } from '@/components/layout/nav-prefs'
import { useMenuSections } from '@/components/layout/sidebar'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { msg, t } from '@/i18n'
import { cn } from '@/lib/utils'

/** one thing a shortcut can open: a page of the menu, or a "+" form (a new invoice, a payment…) */
export type ShortcutChoice = { id: string; label: string; icon: LucideIcon; hue: string; group: string; kind: 'new' | 'page' }

/** a new document straight away, by its own name (the form opens empty) */
const NEW_DOCS: { label: string; href: string; icon: LucideIcon; perm: string; page: string }[] = [
  { label: msg('New sales invoice'), href: '/sales/invoices/new', icon: Receipt, perm: 'invoicing.write', page: '/sales/invoices' },
  { label: msg('New purchase invoice'), href: '/procurement/invoice/new', icon: FileCheck2, perm: 'invoicing.write', page: '/procurement/bills' },
  { label: msg('New quote'), href: '/sales/quotes/new', icon: FileText, perm: 'sales.write', page: '/sales/quotes' },
  { label: msg('New sales order'), href: '/sales/orders/new', icon: ShoppingBag, perm: 'sales.write', page: '/sales/orders' },
  { label: msg('New purchase order'), href: '/procurement/orders/new', icon: ShoppingCart, perm: 'procurement.write', page: '/procurement/orders' },
  { label: msg('New goods receipt'), href: '/inventory/receipts/new', icon: PackageCheck, perm: 'inventory.write', page: '/inventory/receipts' },
  { label: msg('New transfer'), href: '/inventory/transfers/new', icon: ArrowLeftRight, perm: 'inventory.write', page: '/inventory/transfers' },
  { label: msg('New stock adjustment'), href: '/inventory/adjustments/new', icon: SlidersHorizontal, perm: 'inventory.write', page: '/inventory/adjustments' },
  { label: msg('New price levelling'), href: '/inventory/levelling/new', icon: ArrowUpDown, perm: 'inventory.write', page: '/inventory/levelling' },
  { label: msg('New payment from a customer'), href: '/finance/payments/new?type=customer_payment', icon: ArrowDownLeft, perm: 'invoicing.write', page: '/finance/payments' },
  { label: msg('New payment to a supplier'), href: '/finance/payments/new?type=vendor_payment', icon: ArrowUpRight, perm: 'invoicing.write', page: '/finance/payments' },
  { label: msg('New expense'), href: '/finance/expenses', icon: ReceiptText, perm: 'invoicing.write', page: '/finance/expenses' },
  { label: msg('New item'), href: '/inventory/products/new', icon: Boxes, perm: 'inventory.write', page: '/inventory/products' },
  { label: msg('New customer or supplier'), href: '/partners/new', icon: UserPlus, perm: 'partners.write', page: '/partners' },
  { label: msg('New journal entry'), href: '/finance/journal/new', icon: BookOpen, perm: 'finance.write', page: '/finance/journal' },
  { label: msg('New employee'), href: '/hr/employees/new', icon: UserRound, perm: 'hr.write', page: '/hr/employees' },
]

/** the new documents this person may make: their part of the menu is on and they may write there */
function useNewDocs() {
  const { can, pageAllowed } = useCompany()
  const hidden = useHiddenSections()
  return React.useMemo(() => NEW_DOCS.filter((d) => {
    const sec = NAV.find((s) => s.items.some((i) => i.href.split('?')[0] === d.page))
    return can(d.perm) && pageAllowed(d.page) && !(sec && hidden.includes(sec.label)) && !hidden.includes(d.page)
  }), [can, pageAllowed, hidden])
}

/** everything this person may put in the top bar: a new document first, then every page of the menu by its part */
export function useShortcutChoices(): ShortcutChoice[] {
  const sections = useMenuSections()
  const creates = useNewDocs()
  return React.useMemo(() => {
    const out: ShortcutChoice[] = creates.map((c) => ({ id: c.href, label: t(c.label), icon: c.icon, hue: '152 68%', group: t('New document'), kind: 'new' }))
    const seen = new Set(out.map((x) => x.id))
    for (const s of sections) {
      const look = moduleLook(s.label)
      for (const i of s.items) {
        if (seen.has(i.href)) continue
        seen.add(i.href)
        out.push({ id: i.href, label: t(i.label), icon: i.icon, hue: look.hue, group: t(s.title ?? s.label), kind: 'page' })
      }
    }
    return out
  }, [sections, creates])
}

/** the person's shortcuts, beside the "+" in the top bar; a click opens the page (in a tab of its own) */
export function ShortcutBar() {
  const { list, set, loaded } = useTopShortcuts()
  const choices = useShortcutChoices()
  const navigate = useNavigate()
  const [editing, setEditing] = React.useState(false)
  const by = React.useMemo(() => new Map(choices.map((c) => [c.id, c])), [choices])
  // a page the person may no longer open is left out (and stays saved, in case it comes back)
  const shown = list.map((id) => by.get(id)).filter((c): c is ShortcutChoice => !!c)
  if (!loaded) return null
  return (
    <div className="flex min-w-0 items-center gap-1 max-md:hidden">
      <div className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="toolbar" aria-label={t('Shortcuts')}>
        {shown.map((c) => (
          <Tooltip key={c.id}>
            <TooltipTrigger asChild>
              <button type="button" onClick={() => navigate(c.id)}
                className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border bg-card px-3 text-[13px] font-medium shadow-sm transition-colors hover:border-primary/40 hover:bg-primary/5 active:scale-[.98]">
                <c.icon className="size-3.5" style={{ color: `hsl(${c.hue} 40%)` }} />
                <span className="max-w-[140px] truncate">{c.label}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>{c.kind === 'new' ? `${c.group}: ${c.label}` : `${c.group} › ${c.label}`}</TooltipContent>
          </Tooltip>
        ))}
      </div>
      {shown.length ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="shrink-0 text-muted-foreground" aria-label={t('Change the shortcuts')} onClick={() => setEditing(true)}><Settings2 /></Button>
          </TooltipTrigger>
          <TooltipContent>{t('Change the shortcuts')}</TooltipContent>
        </Tooltip>
      ) : (
        <Button variant="ghost" size="sm" className="shrink-0 rounded-full border border-dashed text-muted-foreground" onClick={() => setEditing(true)}>
          <Plus /> {t('Add a shortcut')}
        </Button>
      )}
      {editing && <ShortcutsDialog choices={choices} value={list} onClose={() => setEditing(false)} onSave={(next) => { set(next); setEditing(false) }} />}
    </div>
  )
}

function ShortcutsDialog({ choices, value, onClose, onSave }: { choices: ShortcutChoice[]; value: string[]; onClose: () => void; onSave: (next: string[]) => void }) {
  const [picked, setPicked] = React.useState<string[]>(() => value.filter((id) => choices.some((c) => c.id === id)))
  const [q, setQ] = React.useState('')
  const by = React.useMemo(() => new Map(choices.map((c) => [c.id, c])), [choices])
  const full = picked.length >= MAX_SHORTCUTS
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const found = choices.filter((c) => !q.trim() || norm(`${c.label} ${c.group}`).includes(norm(q.trim())))
  const groups = [...new Set(found.map((c) => c.group))]
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX_SHORTCUTS ? p : [...p, id]))
  const move = (i: number, d: -1 | 1) => setPicked((p) => { const n = [...p]; const j = i + d; if (j < 0 || j >= n.length) return p; [n[i], n[j]] = [n[j]!, n[i]!]; return n })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('Shortcuts in the top bar')}</DialogTitle>
          <DialogDescription>{t('Pick what you use most: a page or a new document. Up to {n}, in the order you want.', { n: MAX_SHORTCUTS })}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-[1fr_280px]">
          <div className="min-w-0">
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input autoFocus className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Find a page or a document…')} aria-label={t('Find a page or a document…')} />
            </div>
            <div className="h-[360px] overflow-y-auto rounded-md border">
              {groups.map((g) => (
                <div key={g}>
                  <div className="sticky top-0 z-10 border-b bg-muted/80 px-3 py-1 text-xs font-semibold text-muted-foreground backdrop-blur">{g}</div>
                  {found.filter((c) => c.group === g).map((c) => {
                    const on = picked.includes(c.id)
                    return (
                      <button key={c.id} type="button" onClick={() => toggle(c.id)} disabled={!on && full} aria-pressed={on}
                        className={cn('flex w-full items-center gap-2.5 border-b px-3 py-1.5 text-left text-[13px] last:border-0 disabled:opacity-50', on ? 'bg-primary/5' : 'hover:bg-muted')}>
                        <c.icon className="size-4 shrink-0" style={{ color: `hsl(${c.hue} 40%)` }} />
                        <span className="min-w-0 flex-1 truncate">{c.label}</span>
                        <span className={cn('flex size-5 shrink-0 items-center justify-center rounded border', on ? 'border-primary bg-primary text-primary-foreground' : 'border-input')}>
                          {on && <Check className="size-3.5" />}</span>
                      </button>
                    )
                  })}
                </div>
              ))}
              {!found.length && <p className="p-4 text-center text-[13px] text-muted-foreground">{t('Nothing found')}</p>}
            </div>
          </div>
          <div className="min-w-0">
            <div className="mb-2 flex h-9 items-center justify-between text-[13px]">
              <span className="font-medium">{t('In the top bar')}</span>
              <span className={cn('tabular text-muted-foreground', full && 'text-warning')}>{picked.length}/{MAX_SHORTCUTS}</span>
            </div>
            <div className="h-[360px] overflow-y-auto rounded-md border">
              {picked.length ? picked.map((id, i) => {
                const c = by.get(id)!
                return (
                  <div key={id} className="flex items-center gap-1.5 border-b px-2 py-1.5 text-[13px] last:border-0">
                    <c.icon className="size-4 shrink-0" style={{ color: `hsl(${c.hue} 40%)` }} />
                    <span className="min-w-0 flex-1 truncate">{c.label}</span>
                    <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30" disabled={i === 0} aria-label={t('Move up')} onClick={() => move(i, -1)}><ArrowUp className="size-3.5" /></button>
                    <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30" disabled={i === picked.length - 1} aria-label={t('Move down')} onClick={() => move(i, 1)}><ArrowDown className="size-3.5" /></button>
                    <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive" aria-label={t('Remove {name}', { name: c.label })} onClick={() => toggle(id)}><X className="size-3.5" /></button>
                  </div>
                )
              }) : <p className="p-4 text-center text-[13px] text-muted-foreground">{t('Nothing yet: pick on the left.')}</p>}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button onClick={() => onSave(picked)}>{t('Save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
