import { ArrowLeft, ArrowRight, Check, ClipboardCheck, FileText, PackagePlus, Pencil, Plus, RotateCcw, Search, ShoppingCart, Sparkles, Truck, UserRound, Users, Wallet, X, type LucideIcon } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '@/app/auth-provider'
import { useCompany } from '@/app/company-provider'
import { NAV } from '@/app/nav'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { msg, t } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

type Tile = { key: string; icon: LucideIcon; label: string; hint: string; to?: string; action?: () => void; tone: string; group?: string }

/** opens the assistant panel from anywhere (the panel listens for it) */
export const openAssistant = () => window.dispatchEvent(new Event('drispro:assistant'))

const L = {
  sell: msg('Sell'), sellHint: msg('Open the till and sell'),
  invoice: msg('New invoice'), invoiceHint: msg('An invoice for a customer'),
  order: msg('New order'), orderHint: msg('What a customer orders'),
  receive: msg('Receive goods|simple'), receiveHint: msg('Goods that came from a supplier'),
  receivePhoto: msg('Take a photo of the supplier’s invoice'),
  count: msg('Count the stock'), countHint: msg('Count what is on the shelf'),
  find: msg('Find an item'), findHint: msg('Price and how many are left'),
  debts: msg('Who owes us'), debtsHint: msg('Unpaid invoices of customers'),
  customers: msg('Customers'), customersHint: msg('Phone, address and what they bought'),
  ask: msg('Ask'), askHint: msg('Write a question, the assistant answers'),
  me: msg('My work'), meHint: msg('Pay slips, leave and my hours'),
  actions: msg('Quick actions'),
}
const PAGE_TONE = 'bg-secondary text-foreground'

/** Every button this person may have: the quick actions, then every page they can open. */
function useCatalog() {
  const { can, hasFeature, pageAllowed } = useCompany()
  return React.useMemo(() => {
    const out: Tile[] = []
    const act = (ok: boolean, tile: Omit<Tile, 'group'>) => { if (ok) out.push({ ...tile, group: L.actions }) }
    act(can('pos.write'), { key: 'sell', icon: ShoppingCart, label: L.sell, hint: L.sellHint, to: '/pos', tone: 'bg-primary text-primary-foreground' })
    act(can('invoicing.write'), { key: 'invoice', icon: FileText, label: L.invoice, hint: L.invoiceHint, to: '/sales/invoices/new', tone: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' })
    act(can('sales.write'), { key: 'order', icon: Truck, label: L.order, hint: L.orderHint, to: '/sales/orders/new', tone: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' })
    act(can('inventory.write'), { key: 'receive', icon: PackagePlus, label: L.receive, hint: hasFeature('ai_reads') ? L.receivePhoto : L.receiveHint,
      to: hasFeature('ai_reads') ? '/inventory/read-invoice' : '/inventory/receipts/new', tone: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' })
    act(can('wms.write'), { key: 'count', icon: ClipboardCheck, label: L.count, hint: L.countHint, to: '/wms/counts', tone: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' })
    act(can('inventory.read'), { key: 'find', icon: Search, label: L.find, hint: L.findHint, to: '/inventory/products', tone: 'bg-violet-500/15 text-violet-700 dark:text-violet-300' })
    act(can('invoicing.read'), { key: 'debts', icon: Wallet, label: L.debts, hint: L.debtsHint, to: '/finance/receivables', tone: 'bg-rose-500/15 text-rose-700 dark:text-rose-300' })
    act(can('partners.read'), { key: 'customers', icon: Users, label: L.customers, hint: L.customersHint, to: '/partners', tone: 'bg-teal-500/15 text-teal-700 dark:text-teal-300' })
    act(hasFeature('ai_assistant'), { key: 'ask', icon: Sparkles, label: L.ask, hint: L.askHint, action: openAssistant, tone: 'bg-primary/15 text-primary' })
    act(true, { key: 'me', icon: UserRound, label: L.me, hint: L.meHint, to: '/hr/me', tone: PAGE_TONE })
    for (const s of NAV) {
      for (const i of s.items) {
        if (i.href === '/' || !can(i.perm) || !pageAllowed(i.href)) continue
        out.push({ key: i.href, icon: i.icon, label: i.label, hint: s.title ?? s.label, to: i.href, tone: PAGE_TONE, group: s.title ?? s.label })
      }
    }
    return out
  }, [can, hasFeature, pageAllowed])
}

/** the buttons chosen by the person's roles, until they arrange their own */
function defaultKeys(catalog: Tile[], can: (p: string) => boolean) {
  const keys = new Set(catalog.map((x) => x.key))
  const order = ['sell', 'invoice', can('invoicing.write') ? '' : 'order', 'receive', 'count', 'find', 'debts', 'customers', 'ask', 'me']
  return order.filter((k) => k && keys.has(k)).slice(0, 6)
}

/** The start of the simple view: the few things this person does, as large buttons they can arrange. */
export function SimpleHome() {
  const { can, company, companyId, refresh } = useCompany()
  const { user } = useAuth()
  const name = ((user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? '').split(/[ @]/)[0]
  const catalog = useCatalog()
  const byKey = React.useMemo(() => new Map(catalog.map((x) => [x.key, x])), [catalog])
  const defaults = React.useMemo(() => defaultKeys(catalog, can), [catalog, can])
  const saved = company?.home_tiles ?? null
  const [editing, setEditing] = React.useState<string[] | null>(null)
  const [adding, setAdding] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const keys = (editing ?? saved ?? defaults).filter((k) => byKey.has(k))
  const tiles = keys.map((k) => byKey.get(k)!)

  const save = async (next: string[] | null) => {
    setBusy(true)
    try {
      unwrap(await supabase.rpc('my_home_tiles_save', { p_company: companyId, p_tiles: next as string[] }))
      await refresh(); setEditing(null); toast.success(t('Your start screen is saved'))
    } catch (e) { toast.error(describeError(e)) } finally { setBusy(false) }
  }
  const move = (i: number, d: -1 | 1) => setEditing((e) => { const a = [...(e ?? keys)]; const j = i + d; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j]!, a[i]!]; return a })
  const remove = (k: string) => setEditing((e) => (e ?? keys).filter((x) => x !== k))
  const add = (k: string) => { setEditing((e) => [...(e ?? keys), k].slice(0, 12)); setAdding(false) }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex flex-wrap items-end gap-3 sm:mb-8">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">{editing ? t('Arrange your buttons') : t('Hello, {name}', { name })}</h1>
          <p className="mt-1 text-base text-muted-foreground">
            {editing ? t('Move them with the arrows, remove with ✕, add with +. Up to 12.') : <>{t('What are you doing now? Tap one.')} <span className="max-sm:hidden">· {company?.name}</span></>}
          </p>
        </div>
        {editing ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => void save(null)} disabled={busy}><RotateCcw /> {t('As they were')}</Button>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={busy}>{t('Cancel')}</Button>
            <Button onClick={() => void save(keys)} loading={busy}><Check /> {t('Save')}</Button>
          </div>
        ) : (
          <Button variant="outline" onClick={() => setEditing(keys)}><Pencil /> {t('Arrange')}</Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        {tiles.map((x, i) => {
          const body = (
            <>
              <span className={cn('grid size-14 place-items-center rounded-2xl sm:size-16', x.tone)}><x.icon className="size-7 sm:size-8" strokeWidth={1.8} /></span>
              <span className="mt-4 block text-lg font-semibold leading-tight sm:text-xl">{t(x.label)}</span>
              <span className="mt-1 block text-sm leading-snug text-muted-foreground">{t(x.hint)}</span>
            </>
          )
          const cls = 'group relative flex min-h-40 flex-col items-start rounded-2xl border bg-card p-4 text-left shadow-sm transition-[transform,box-shadow,border-color] sm:min-h-48 sm:p-6'
          if (editing) {
            return (
              <div key={x.key} className={cn(cls, 'border-dashed border-primary/40')}>
                {body}
                <div className="mt-auto flex w-full items-center gap-1.5 pt-3">
                  <Button variant="outline" size="icon-sm" aria-label={t('Move left')} onClick={() => move(i, -1)} disabled={i === 0}><ArrowLeft /></Button>
                  <Button variant="outline" size="icon-sm" aria-label={t('Move right')} onClick={() => move(i, 1)} disabled={i === tiles.length - 1}><ArrowRight /></Button>
                  <Button variant="outline" size="icon-sm" className="ml-auto text-destructive" aria-label={t('Remove {name}', { name: t(x.label) })} onClick={() => remove(x.key)}><X /></Button>
                </div>
              </div>
            )
          }
          const live = cn(cls, 'active:scale-[0.98] hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')
          return x.to
            ? <Link key={x.key} to={x.to} className={live}>{body}</Link>
            : <button key={x.key} type="button" onClick={x.action} className={live}>{body}</button>
        })}
        {editing && tiles.length < 12 && (
          <button type="button" onClick={() => setAdding(true)}
            className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary sm:min-h-48">
            <Plus className="size-8" /><span className="text-base font-medium">{t('Add a button')}</span>
          </button>
        )}
      </div>
      <AddDialog open={adding} onOpenChange={setAdding} catalog={catalog.filter((x) => !keys.includes(x.key))} onPick={add} />
    </div>
  )
}

function AddDialog({ open, onOpenChange, catalog, onPick }: { open: boolean; onOpenChange: (o: boolean) => void; catalog: Tile[]; onPick: (k: string) => void }) {
  const [q, setQ] = React.useState('')
  React.useEffect(() => { if (open) setQ('') }, [open])
  const needle = q.trim().toLowerCase()
  const shown = catalog.filter((x) => !needle || t(x.label).toLowerCase().includes(needle) || t(x.hint).toLowerCase().includes(needle))
  const groups = [...new Set(shown.map((x) => x.group ?? ''))]
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] max-w-lg overflow-hidden p-0">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle>{t('Add a button')}</DialogTitle>
          <DialogDescription>{t('Choose what you want on your start screen.')}</DialogDescription>
        </DialogHeader>
        <div className="px-5"><Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search…')} /></div>
        <div className="max-h-[55dvh] overflow-y-auto px-3 pb-4">
          {groups.map((g) => (
            <div key={g} className="mt-3">
              <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">{t(g)}</p>
              {shown.filter((x) => (x.group ?? '') === g).map((x) => (
                <button key={x.key} type="button" onClick={() => onPick(x.key)}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-secondary">
                  <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg', x.tone)}><x.icon className="size-4.5" /></span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{t(x.label)}</span>
                  <Plus className="size-4 text-muted-foreground" />
                </button>
              ))}
            </div>
          ))}
          {!shown.length && <p className="px-2 py-6 text-sm text-muted-foreground">{t('Nothing found.')}</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
