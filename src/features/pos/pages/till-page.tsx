import { PageHelpButton, TourHost } from '@/components/help'
import {
  ArrowLeft, BadgePercent, Banknote, Camera, Check, CloudOff, CreditCard, Ellipsis, Landmark, ListOrdered, LogOut, Minus, Plus, Printer, ReceiptText, RotateCcw, ScanLine, Search, Ticket, Trash2,
  UserRound, Wallet, X,
} from 'lucide-react'
import * as React from 'react'
import { bestPromo } from '../promotions'
import { openCashDrawer } from '@/lib/print'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '@/app/auth-provider'
import { useCompany } from '@/app/company-provider'
import { CameraScanner, hasCamera, scanFeedback } from '@/components/scan-input'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { usePhone } from '@/hooks/use-phone'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { formatDateWith, msg, t, td, tEnum, tn } from '@/i18n'
import { cn, formatMoney, num, todayISO } from '@/lib/utils'
import { lookupReceipt, useCashMove, useCloseSession, useOpenSession, useSessionSummary, useTill, type CatalogItem, type ReceiptLookup, type TillData } from '../api'
import { enqueue, nextDeviceRef, syncNow, useOnSynced, useSyncState, type QueuedSale } from '../offline'
import { printReceipt, printZReport, type ReceiptData } from '../receipt'
import { SyncPanel } from './pos-home-page'
import { phoneKey, quoteLoyalty, type TillCardRow, type TillProgram } from '@/features/loyalty/api'

/* ------------------------------------------------------------------ money helpers (same rounding as the database) */
const r2 = (v: number) => Math.sign(v) * Math.round(Math.abs(v) * 100 + 1e-7) / 100
const lineTotal = (l: { qty: number; price: number; discount: number }) => r2(l.qty * l.price * (1 - l.discount / 100))
const MAX_DISCOUNT = 10
const NOTES = [100, 200, 500, 1000, 2000, 5000, 10000]
const METHODS = [
  { id: 'cash', label: msg('enum:cash'), icon: Banknote, key: 'F5' },
  { id: 'card', label: msg('enum:card'), icon: CreditCard, key: 'F6' },
  { id: 'bank_transfer', label: msg('enum:bank_transfer'), icon: Landmark, key: 'F7' },
  { id: 'voucher', label: msg('enum:voucher'), icon: Ticket, key: 'F8' },
] as const
type Method = (typeof METHODS)[number]['id']

type Line = { key: string; variant_id: string; name: string; sku: string; price: number; qty: number; discount: number; rate: number; barcode: string | null }
type PricedLine = Line & { card?: boolean; promo?: { id: string; name: string } }
export type Tender = { method: Method; amount: number }
type AppliedCard = { id: string; number: string; holder: string; program: TillProgram; points: number; monthUsed: number }
type Redeem = { points: number; amount: number; pct: Record<string, number> }

function cardUsable(p: TillProgram) {
  const today = todayISO()
  return p.applies_here && (!p.valid_from || p.valid_from <= today) && (!p.valid_until || p.valid_until >= today)
}
function toApplied(row: TillCardRow, programs: TillProgram[]): AppliedCard | null {
  const program = programs.find((p) => p.id === row[4])
  return program ? { id: row[0], number: row[1], holder: row[3], program, points: num(row[5]), monthUsed: num(row[6]) } : null
}
type Done = { ref: string; number: string | null; total: number; change: number; receipt: ReceiptData; offline: boolean }

const prefGet = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d } catch { return d } }
const prefSet = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* ignore */ } }

/* ================================================================== route */
export function TillPage() {
  const { registerId } = useParams()
  const { user, loading } = useAuth()
  const till = useTill(registerId)
  if (loading) return <TillSkeleton />
  if (!user) return <Navigate to="/login" replace state={{ from: `/pos/till/${registerId}` }} />
  if (till.loading && !till.data) return <TillSkeleton />
  if (!till.data) return (
    <Centered>
      <CloudOff className="mx-auto size-8 text-muted-foreground" />
      <h1 className="mt-3 text-lg font-semibold">{t('This till has not been used on this device yet')}</h1>
      <p className="mt-1 text-[13px] text-muted-foreground">{till.error ?? t('Connect to the internet once so the till can download products and prices; after that it keeps selling without internet.')}</p>
      <div className="mt-4 flex justify-center gap-2"><Button variant="outline" asChild><Link to="/pos">{t('Back')}</Link></Button><Button onClick={() => void till.reload()}>{t('Try again')}</Button></div>
    </Centered>
  )
  if (!till.data.session) return <OpenTill data={till.data} offline={till.offline} onOpened={() => void till.reload()} />
  return <Till data={till.data} offline={till.offline} patch={till.patch} reload={till.reload} />
}

export function TillSkeleton() {
  return <div className="flex h-dvh gap-4 bg-background p-4"><Skeleton className="flex-1" /><Skeleton className="w-[420px]" /></div>
}
export function Centered({ children }: { children: React.ReactNode }) {
  return <div className="grid min-h-dvh place-items-center bg-background p-6"><div className="w-full max-w-md text-center">{children}</div></div>
}

export function OpenTill({ data, offline, onOpened }: { data: TillData; offline: boolean; onOpened: () => void }) {
  const open = useOpenSession()
  const [cash, setCash] = React.useState('')
  return (
    <Centered>
      <div className="rounded-xl border bg-card p-6 text-left shadow-sm">
        <div className="text-[13px] text-muted-foreground">{data.company.name}</div>
        <h1 className="mt-0.5 text-xl font-semibold">{t('Open {name}', { name: data.register.name })}</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">{t('Count the cash you are putting in the drawer. It is the starting point for the cash count at closing.')}</p>
        <form className="mt-5 grid gap-3" onSubmit={async (e) => { e.preventDefault(); await open.mutateAsync({ register: data.register.id, cash: num(cash) }); toast.success(t('Till open')); onOpened() }}>
          <Label htmlFor="float">{t('Cash in the drawer ({currency})', { currency: data.company.base_currency })}</Label>
          <Input id="float" autoFocus inputMode="decimal" className="h-14 text-right text-2xl font-semibold tabular" value={cash} onChange={(e) => setCash(e.target.value.replace(/[^\d.,]/g, '').replace(',', '.'))} placeholder="0.00" />
          {offline && <p className="text-[13px] text-warning">{t('You are offline. Opening a till needs internet; selling afterwards does not.')}</p>}
          <div className="mt-2 flex gap-2"><Button type="button" variant="outline" asChild><Link to="/pos">{t('Back')}</Link></Button><Button type="submit" className="flex-1" size="lg" loading={open.isPending} disabled={offline}>{t('Open till')}</Button></div>
        </form>
      </div>
    </Centered>
  )
}

/* ================================================================== the till */
function Till({ data, offline, patch, reload }: { data: TillData; offline: boolean; patch: (fn: (d: TillData) => TillData) => void; reload: () => Promise<void> }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { can } = useCompany()
  const sync = useSyncState()
  const cashier = (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? ''
  const cur = data.company.base_currency
  const session = data.session!

  const [lines, setLines] = React.useState<Line[]>([])
  const [card, setCard] = React.useState<AppliedCard | null>(null)
  const [redeem, setRedeem] = React.useState<Redeem | null>(null)
  React.useEffect(() => { setRedeem(null) }, [lines])
  const [selected, setSelected] = React.useState<string | null>(null)
  const [query, setQuery] = React.useState('')
  const [multiplier, setMultiplier] = React.useState<number | null>(null)
  const [category, setCategory] = React.useState<string>('__all')
  const [customer, setCustomer] = React.useState<string | null>(data.register.default_customer_id)
  const [flash, setFlash] = React.useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [dialog, setDialog] = React.useState<null | 'pay' | 'customer' | 'card' | 'refund' | 'cash' | 'close' | 'line' | 'queue'>(null)
  const [done, setDone] = React.useState<Done | null>(null)
  const [camera, setCamera] = React.useState(false)
  const [autoPrint, setAutoPrint] = React.useState(() => prefGet('pos.autoprint', '1') === '1')
  const search = React.useRef<HTMLInputElement>(null)
  // a phone has no scanner gun: giving the field focus would only open the keyboard over the screen
  const phone = usePhone()
  const phoneRef = React.useRef(phone); phoneRef.current = phone
  const [pane, setPane] = React.useState<'products' | 'sale'>('products')
  const focusSearch = React.useCallback(() => setTimeout(() => { if (!phoneRef.current) search.current?.focus() }, 0), [])

  /* ---------- loyalty card: the same rule as the server (app.loyalty_eval) */
  const catOf = React.useMemo(() => new Map(data.catalog.map((c) => [c.variant_id, c.category])), [data.catalog])
  // promotions first: a line the cashier did not discount by hand takes the best one running now
  const [clock, setClock] = React.useState(() => Date.now())
  React.useEffect(() => { const id = setInterval(() => setClock(Date.now()), 60_000); return () => clearInterval(id) }, [])
  const promoted = React.useMemo<PricedLine[]>(() => lines.map((l) => {
    if (l.qty <= 0 || l.discount !== 0 || !data.promotions?.length) return l
    const b = bestPromo(data.promotions, l.variant_id, l.price, l.qty, new Date(clock))
    return b ? { ...l, discount: b.pct, promo: { id: b.id, name: b.name } } : l
  }), [lines, data.promotions, clock])
  const priced = React.useMemo<PricedLine[]>(() => {
    if (!card || !cardUsable(card.program)) return promoted
    const p = card.program
    const excluded = new Set(p.excluded_categories)
    const eligible = (l: Line) => l.qty > 0 && l.discount === 0 && !excluded.has(catOf.get(l.variant_id) ?? '\u0000')
    let pct = num(p.discount_pct)
    if (p.monthly_limit != null) {
      const left = Math.max(num(p.monthly_limit) - card.monthUsed, 0)
      const d = promoted.filter(eligible).reduce((s, l) => s + r2(l.qty * l.price) * pct / 100, 0)
      if (d > left) pct = d > 0 ? Math.floor(pct * left / d * 100) / 100 : 0
    }
    return promoted.map((l) => (eligible(l) ? { ...l, discount: redeem?.pct[l.key] ?? pct, card: true } : l))
  }, [promoted, card, redeem, catOf])
  const cardSaving = priced.filter((l) => l.card).reduce((s, l) => s + r2(l.qty * l.price) - lineTotal(l), 0)

  const total = priced.reduce((s, l) => s + lineTotal(l), 0)
  const vat = priced.reduce((s, l) => { const t = lineTotal(l); return s + (t - r2(t / (1 + l.rate / 100))) }, 0)
  const itemsCount = lines.reduce((s, l) => s + l.qty, 0)
  const customerName = data.customers.find((c) => c.id === customer)?.name ?? null
  // the law's cash limit for this receipt: a business customer, or the walk-in / an individual
  const customerKind = customer && customer !== data.register.default_customer_id ? data.customers.find((c) => c.id === customer)?.kind ?? 'company' : 'individual'
  const limitValue = customerKind === 'individual' ? data.cashLimits?.individual : data.cashLimits?.business
  const cashLimit = limitValue ? { limit: num(limitValue), block: !!data.cashLimits?.block, business: customerKind !== 'individual' } : null

  const findCard = React.useCallback((code: string, d: TillData = data) => {
    const rows = d.loyalty?.cards ?? []
    const v = code.trim()
    const k = phoneKey(v)
    const row = rows.find((r) => r[1] === v) ?? (k && k.length >= 6 ? rows.find((r) => r[2] === k) : undefined)
    return row ? toApplied(row, d.loyalty?.programs ?? []) : null
  }, [data])
  const applyCard = (c: AppliedCard) => {
    if (!cardUsable(c.program)) { scanFeedback('error'); setFlash({ tone: 'error', text: t('{name}: this card is not valid here or today', { name: c.holder }) }); return }
    setCard(c); setRedeem(null); scanFeedback('ok')
    setFlash({ tone: 'ok', text: t('Card of {name} · {rule}', { name: c.holder, rule: c.program.kind === 'points' ? tn(c.points, '{n} point', '{n} points') : t('{pct}% off', { pct: num(c.program.discount_pct) }) }) })
  }
  /** card number or phone: the copy on the device first, then the server (a card made after the till opened) */
  const applyCardCode = async (code: string): Promise<boolean> => {
    let c = findCard(code)
    if (!c && navigator.onLine) {
      try {
        const q = await quoteLoyalty(data.register.id, code, [])
        if (!q.usable) { scanFeedback('error'); setFlash({ tone: 'error', text: t(q.reason ?? 'This card cannot be used') }); return false }
        await reload()
        const program = data.loyalty?.programs.find((p) => p.id === q.program_id)
        c = program ? { id: q.card_id, number: q.card_number, holder: q.holder_name, program, points: num(q.points_balance), monthUsed: 0 } : null
      } catch { c = null }
    }
    if (!c) { scanFeedback('error'); setFlash({ tone: 'error', text: t('No active card with this number or phone') }); return false }
    applyCard(c)
    return true
  }
  const spendPoints = async () => {
    if (!card) return
    try {
      const q = await quoteLoyalty(data.register.id, card.number, lines.map((l) => ({ variant_id: l.variant_id, quantity: l.qty, unit_price: l.price, manual_pct: l.discount })), card.points)
      if (!q.usable) { setFlash({ tone: 'error', text: t(q.reason ?? 'This card cannot be used') }); return }
      setCard({ ...card, points: num(q.points_balance) })
      if (!(q.redeem_points > 0)) { setFlash({ tone: 'error', text: t('Not enough points to spend on this sale (at least {n})', { n: q.min_redeem_points }) }); return }
      setRedeem({ points: q.redeem_points, amount: num(q.redeem_amount), pct: Object.fromEntries(lines.map((l, i) => [l.key, num(q.lines[i]?.pct)])) })
      setFlash({ tone: 'ok', text: t('{n} points take {amount} off', { n: q.redeem_points, amount: formatMoney(q.redeem_amount) }) })
    } catch (e) { setFlash({ tone: 'error', text: navigator.onLine ? describeError(e) : t('Spending points needs internet') }) }
  }

  /* ---------- catalog lookup */
  const byCode = React.useMemo(() => {
    const m = new Map<string, { item: CatalogItem; qty: number }>()
    for (const c of data.catalog) {
      m.set(c.sku.toLowerCase(), { item: c, qty: 1 })
      for (const b of c.barcodes) m.set(b.code.toLowerCase(), { item: c, qty: num(b.qty) || 1 })
    }
    return m
  }, [data.catalog])
  const categories = React.useMemo(() => [...new Set(data.catalog.map((c) => c.category).filter(Boolean))].sort() as string[], [data.catalog])
  const q = query.trim().toLowerCase().replace(/^\d+(?:[.,]\d+)?\*/, '')
  const visible = React.useMemo(() => {
    const words = q.split(/\s+/).filter(Boolean)
    return data.catalog.filter((c) => (category === '__all' || c.category === category)
      && words.every((w) => c.name.toLowerCase().includes(w) || c.sku.toLowerCase().includes(w) || c.barcodes.some((b) => b.code.startsWith(w))))
  }, [data.catalog, q, category])

  const add = React.useCallback((item: CatalogItem, qty = 1, barcode: string | null = null, mult?: number) => {
    const n = (mult ?? multiplier ?? 1) * qty
    setMultiplier(null)
    setLines((ls) => {
      const i = ls.findIndex((l) => l.variant_id === item.variant_id && l.discount === 0)
      if (i >= 0) {
        const next = [...ls]; next[i] = { ...next[i]!, qty: next[i]!.qty + n }
        setSelected(next[i]!.key)
        return next
      }
      const key = crypto.randomUUID()
      setSelected(key)
      return [...ls, { key, variant_id: item.variant_id, name: item.name, sku: item.sku, price: item.price, qty: n, discount: 0, rate: item.tax_rate, barcode }]
    })
    setFlash({ tone: 'ok', text: `${n === 1 ? '' : `${n} × `}${item.name} · ${formatMoney(item.price)}${item.product_type === 'stockable' && item.on_hand - n < 0 ? ` · ${t('stock on record is short, the sale still goes through')}` : ''}` })
    scanFeedback('ok')
  }, [multiplier])

  const submitQuery = (raw: string) => {
    let v = raw.trim()
    if (!v) { if (lines.length) setDialog('pay'); return }
    let n: number | undefined
    const mult = /^(\d+(?:[.,]\d+)?)\*(.*)$/.exec(v)
    if (mult) {
      n = Number(mult[1]!.replace(',', '.'))
      if (!(n > 0)) { setFlash({ tone: 'error', text: t('Quantity must be more than zero') }); return }
      v = mult[2]!.trim()
      if (!v) { setMultiplier(n); setQuery(''); setFlash({ tone: 'ok', text: t('Next item × {n}', { n }) }); return }
    }
    const hit = byCode.get(v.toLowerCase())
    if (hit) { add(hit.item, hit.qty, v, n); setQuery(''); return }
    const scannedCard = !n ? findCard(v) : null
    if (scannedCard && scannedCard.number === v) { applyCard(scannedCard); setQuery(''); return }
    if (visible.length === 1) { add(visible[0]!, 1, null, n); setQuery(''); return }
    if (n) setMultiplier(n)
    scanFeedback('error')
    setFlash({ tone: 'error', text: visible.length ? t('{n} products match “{q}” — tap one', { n: visible.length, q: v }) : t('Nothing matches “{q}”', { q: v }) })
    if (!visible.length) setQuery('')
  }

  const updateLine = (key: string, patchLine: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patchLine } : l)).filter((l) => l.qty > 0))
  const removeLine = (key: string) => { setLines((ls) => ls.filter((l) => l.key !== key)); setSelected(null) }
  const clearSale = () => { setLines([]); setSelected(null); setCustomer(data.register.default_customer_id); setMultiplier(null); setFlash(null); setCard(null); setRedeem(null) }

  /* ---------- finishing a sale: queue first, then everything else */
  const [lastNumbers, setLastNumbers] = React.useState<Record<string, string>>({})
  useOnSynced(React.useCallback((it: QueuedSale) => { if (it.number) setLastNumbers((m) => ({ ...m, [it.client_uuid]: it.number! })) }, []))
  const doneUuid = React.useRef<string | null>(null)

  const finish = async (tenders: Tender[], opts?: { refund?: { of: ReceiptLookup; lines: Line[] } }) => {
    const refund = opts?.refund
    const saleLines: PricedLine[] = refund ? refund.lines : priced
    const usedCard = !refund && card && saleLines.some((l) => l.card) ? card : null
    const saleTotal = saleLines.reduce((s, l) => s + lineTotal(l), 0)
    const paid = tenders.reduce((s, t) => s + t.amount, 0)
    const change = refund ? 0 : r2(paid - saleTotal)
    const client_uuid = crypto.randomUUID()
    const device_ref = await nextDeviceRef(data.register.code)
    const created_at = new Date().toISOString()
    const isOffline = !navigator.onLine || !sync.online
    const payload = {
      client_uuid, session_id: session.id, order_at: created_at, device_ref, offline: isOffline, partner_id: customer, is_refund: !!refund, refund_of_id: refund?.of.id ?? null,
      // a promotion's line counts as discounted already, so the card does not add to it (the server checks the promotion)
      lines: saleLines.map((l) => ({ variant_id: l.variant_id, quantity: l.qty, unit_price: l.price, discount_pct: l.discount, manual_pct: l.card ? 0 : l.discount,
        promotion_id: l.promo?.id ?? null, barcode: l.barcode, description: l.name })),
      payments: tenders.map((t) => ({ method: t.method, amount: t.amount })),
      loyalty: usedCard ? { card_id: usedCard.id, redeem_points: redeem?.points ?? 0 } : null,
    }
    const cardLines = saleLines.filter((l) => l.card)
    const saved = r2(cardLines.reduce((s, l) => s + r2(l.qty * l.price) - lineTotal(l), 0))
    const earned = usedCard?.program.kind === 'points' ? Math.floor(cardLines.reduce((s, l) => s + lineTotal(l), 0) * num(usedCard.program.points_per_unit)) : 0
    const spent = usedCard ? redeem?.points ?? 0 : 0
    await enqueue({ client_uuid, register_id: data.register.id, company_id: data.register.company_id, device_ref, created_at, total: r2(saleTotal), payload, attempts: 0, status: 'pending' })
    // the drawer view of stock follows the sale right away
    patch((d) => ({ ...d, catalog: d.catalog.map((c) => { const sold = saleLines.filter((l) => l.variant_id === c.variant_id).reduce((s, l) => s + l.qty, 0); return sold ? { ...c, on_hand: c.on_hand - sold } : c }) }))
    const receipt: ReceiptData = {
      company: data.company, register: data.register, ref: device_ref, number: null, date: new Date(created_at), cashier, customer: customerName, isRefund: !!refund, offline: isOffline, currency: cur,
      lines: saleLines.map((l) => ({ name: l.name, qty: l.qty, price: l.price, discount: l.discount, total: lineTotal(l), rate: l.rate })),
      payments: tenders.map((t) => ({ method: t.method, amount: t.amount })), change: Math.max(change, 0),
      loyalty: usedCard ? { holder: usedCard.holder, number: usedCard.number, discount: saved, redeemed: spent || undefined, earned: earned || undefined,
                            balance: usedCard.program.kind === 'points' ? usedCard.points - spent + earned : undefined } : null,
    }
    // the copy of the card on this device follows the sale (points, this month's discount)
    if (usedCard) patch((d) => d.loyalty ? { ...d, loyalty: { ...d.loyalty, cards: d.loyalty.cards.map((r) => r[0] === usedCard.id
      ? [r[0], r[1], r[2], r[3], r[4], num(r[5]) - spent + earned, num(r[6]) + saved] as TillCardRow : r) } } : d)
    doneUuid.current = client_uuid
    setDone({ ref: device_ref, number: null, total: r2(saleTotal), change: Math.max(change, 0), receipt, offline: isOffline })
    setDialog(null)
    clearSale()
    // the drawer opens for a sale paid (partly) in cash (Windows program with a network receipt printer)
    if (tenders.some((x) => x.method === 'cash')) openCashDrawer()
    if (autoPrint) printReceipt(receipt)
  }

  /* ---------- keyboard */
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (done) {
        if (e.key === 'Enter' || e.key === 'Escape' || e.key === 'F2') { e.preventDefault(); setDone(null); focusSearch() }
        else if (e.key.toLowerCase() === 'p' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); printReceipt(done.receipt) }
        return
      }
      if (dialog) return
      if (e.key === 'F2') { e.preventDefault(); search.current?.focus(); search.current?.select() }
      else if (e.key === 'F4') { e.preventDefault(); setDialog('customer') }
      else if (e.key === 'F3') { e.preventDefault(); setFlash(null); setDialog('card') }
      else if (e.key === 'F9') { e.preventDefault(); setDialog('refund') }
      else if ((e.key === 'F12' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) && lines.length) { e.preventDefault(); setDialog('pay') }
      else if (e.key === 'Escape') { if (query) setQuery(''); else if (multiplier) setMultiplier(null) }
      else if (!query && selected && document.activeElement === search.current) {
        const l = lines.find((x) => x.key === selected)
        if (!l) return
        if (e.key === '+') { e.preventDefault(); updateLine(l.key, { qty: l.qty + 1 }) }
        else if (e.key === '-') { e.preventDefault(); updateLine(l.key, { qty: l.qty - 1 }) }
        else if (e.key === 'Delete') { e.preventDefault(); removeLine(l.key) }
        else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault()
          const i = lines.findIndex((x) => x.key === selected)
          const j = Math.max(0, Math.min(lines.length - 1, i + (e.key === 'ArrowUp' ? -1 : 1)))
          setSelected(lines[j]!.key)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }) // re-bound every render on purpose: it reads the latest state

  // the search field gets focus back after any click on empty space
  React.useEffect(() => {
    const onUp = (e: PointerEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input,textarea,select,[role=dialog],[role=listbox],[role=combobox]')) return
      if (document.querySelector('[role=dialog]') || phoneRef.current) return
      setTimeout(() => search.current?.focus({ preventScroll: true }), 0)
    }
    window.addEventListener('pointerup', onUp)
    return () => window.removeEventListener('pointerup', onUp)
  }, [])

  const selectedLine = lines.find((l) => l.key === selected) ?? null
  const pending = sync.items.filter((i) => i.register_id === data.register.id)

  return (
    <div className="flex h-dvh flex-col bg-muted/30 text-foreground">
      <TourHost />
      {/* ---------- top bar */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-card px-3">
        <Button variant="ghost" size="icon" asChild aria-label={t('Leave the till')}><Link to="/pos"><ArrowLeft /></Link></Button>
        <div className="min-w-0 max-sm:flex-1">
          <div className="flex items-center gap-1 truncate text-sm font-semibold">{data.register.name}<PageHelpButton /></div>
          <div className="truncate text-xs text-muted-foreground">{session.number} · {cashier}</div>
        </div>
        <button type="button" onClick={() => setDialog('queue')}
          className={cn('ml-2 inline-flex shrink-0 whitespace-nowrap max-sm:ml-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
            !sync.online || offline ? 'bg-warning/15 text-warning' : pending.length ? 'bg-primary/10 text-primary' : 'bg-success/10 text-success')}>
          {!sync.online || offline ? <><CloudOff className="size-3.5" /> {t('Offline')}{pending.length ? ` · ${t('{n} to send', { n: pending.length })}` : ''}</>
            : pending.length ? <>{sync.syncing ? t('Sending') : t('Waiting')} · {pending.length}</> : <><Check className="size-3.5" /> {t('All sent')}</>}
        </button>
        {phone ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={t('More')}><Ellipsis /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuItem onSelect={() => setDialog('refund')}><RotateCcw /> {t('Refund')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDialog('cash')}><Wallet /> {t('Cash in/out')}</DropdownMenuItem>
              <DropdownMenuCheckboxItem checked={autoPrint} onCheckedChange={() => setAutoPrint((a) => { prefSet('pos.autoprint', a ? '0' : '1'); return !a })}>
                <Printer className="mr-2 size-4" /> {t('Print a receipt automatically after each sale')}</DropdownMenuCheckboxItem>
              <DropdownMenuItem onSelect={() => setDialog('close')}><LogOut /> {t('Close till')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => setDialog('refund')}><RotateCcw /> {t('Refund')} <Kbd>F9</Kbd></Button>
          <Button variant="ghost" size="sm" onClick={() => setDialog('cash')}><Wallet /> {t('Cash in/out')}</Button>
          <Button variant="ghost" size="sm" onClick={() => { setAutoPrint((a) => { prefSet('pos.autoprint', a ? '0' : '1'); return !a }) }} aria-pressed={autoPrint}
            title={t('Print a receipt automatically after each sale')}><Printer /> {autoPrint ? t('Auto-print on') : t('Auto-print off')}</Button>
          <Button variant="outline" size="sm" onClick={() => setDialog('close')}><LogOut /> {t('Close till')}</Button>
        </div>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ---------- left: search + products */}
        <section className={cn('flex min-w-0 flex-1 flex-col gap-3 p-3', phone && pane === 'sale' && 'hidden')}>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <ScanLine className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
              <input ref={search} autoFocus={!phone} value={query} onChange={(e) => { setQuery(e.target.value); setFlash(null) }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitQuery(query) } }}
                aria-label={t('Scan or search products')} autoComplete="off" spellCheck={false}
                placeholder={phone ? t('Search products') : t('Scan or search · 3* before a scan sells three · Enter on empty pays')}
                className="h-14 w-full rounded-xl border-2 bg-card pl-11 pr-28 text-lg max-sm:h-12 max-sm:pr-12 max-sm:text-base outline-none transition-colors focus:border-primary focus:ring-4 focus:ring-primary/15" />
              <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
                {multiplier && <span className="rounded-md bg-primary px-2 py-1 text-sm font-semibold text-primary-foreground">× {multiplier}</span>}
                <Kbd>F2</Kbd>
              </div>
            </div>
            {hasCamera && <Button variant="outline" className="h-14 w-14 p-0" aria-label={t('Scan with the camera')} onClick={() => setCamera(true)}><Camera className="size-5" /></Button>}
          </div>
          <div aria-live="polite" className={cn('-mt-1 min-h-5 px-1 text-[13px]', flash?.tone === 'error' ? 'font-medium text-destructive' : 'text-muted-foreground')}>{flash?.text}</div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {['__all', ...categories].map((c) => (
              <button key={c} type="button" onClick={() => setCategory(c)}
                className={cn('h-9 shrink-0 rounded-full border px-3.5 text-[13px] font-medium transition-colors', category === c ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-muted')}>
                {c === '__all' ? t('All products') : td(c)}
              </button>
            ))}
          </div>
          <div className="grid min-h-0 flex-1 auto-rows-[96px] grid-cols-[repeat(auto-fill,minmax(150px,1fr))] content-start gap-2 overflow-y-auto pr-1 max-sm:auto-rows-[84px] max-sm:grid-cols-3 max-sm:pr-0">
            {visible.slice(0, 120).map((c) => (
              <button key={c.variant_id} type="button" onClick={() => add(c)}
                className="flex flex-col justify-between rounded-lg border bg-card p-2.5 text-left transition-[border-color,transform] hover:border-primary/50 active:scale-[0.98]">
                <span className="line-clamp-2 text-[13px] font-medium leading-tight">{c.name}</span>
                <span className="flex items-end justify-between gap-1">
                  <span className="text-base font-semibold tabular" title={t('Price with VAT')}>{formatMoney(c.price)}</span>
                  {c.product_type === 'stockable' && <span className={cn('text-[11px] tabular', c.on_hand <= 0 ? 'text-destructive' : 'text-muted-foreground')} title={t('In stock at this till')}>{num(c.on_hand)}</span>}
                </span>
              </button>
            ))}
            {!visible.length && <div className="col-span-full py-12 text-center text-[13px] text-muted-foreground">{t('No product matches. Clear the search with Esc.')}</div>}
          </div>
          {phone && (
            <div className="-mx-3 -mb-3 grid grid-cols-[1fr_auto] gap-2 border-t bg-card p-3">
              <Button variant="outline" className="h-14 justify-between" onClick={() => setPane('sale')}>
                <span className="flex items-center gap-2"><ListOrdered /> {t('{a} lines · {b} items', { a: lines.length, b: num(itemsCount) })}</span>
                <span className="text-base font-semibold tabular">{formatMoney(total)} <span className="text-[11px] font-normal text-muted-foreground">{t('with VAT|short')}</span></span>
              </Button>
              <Button className="h-14 px-5" disabled={!lines.length} onClick={() => setDialog('pay')}>{t('Pay')}</Button>
            </div>
          )}
        </section>

        {/* ---------- right: the sale */}
        <aside className={cn('flex shrink-0 flex-col bg-card', phone ? (pane === 'sale' ? 'w-full' : 'hidden') : 'w-[400px] border-l xl:w-[440px]')}>
          {phone && (
            <div className="border-b px-3 py-2">
              <Button variant="outline" className="w-full" onClick={() => setPane('products')}><Plus /> {t('Add products')}</Button>
            </div>
          )}
          <button type="button" onClick={() => setDialog('customer')} className="flex items-center gap-2 border-b px-4 py-3 text-left hover:bg-muted/50">
            <UserRound className="size-4 text-muted-foreground" />
            <span className="flex-1 truncate text-[13px]">{customerName ?? t('Walk-in customer')}</span>
            <Kbd>F4</Kbd>
          </button>
          {data.loyalty && (card ? (
            <div className="border-b bg-primary/5 px-4 py-2.5">
              <div className="flex items-center gap-2">
                <BadgePercent className="size-4 text-primary" />
                <span className="flex-1 truncate text-[13px] font-medium">{card.holder} <span className="font-normal text-muted-foreground">· {card.program.name}</span></span>
                <button type="button" className="text-muted-foreground hover:text-destructive" aria-label={t('Remove the card')} onClick={() => { setCard(null); setRedeem(null) }}><X className="size-4" /></button>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground">
                  {!cardUsable(card.program) ? <span className="text-destructive">{t('Not valid in this store or today')}</span>
                    : card.program.kind === 'points' ? tn(card.points, '{n} point', '{n} points') : t('{pct}% off', { pct: num(card.program.discount_pct) })}
                  {cardSaving > 0 && <> · <span className="font-medium text-primary">{t('saves {amount}', { amount: formatMoney(cardSaving) })}</span></>}
                </span>
                {card.program.kind === 'points' && cardUsable(card.program) && (redeem
                  ? <button type="button" className="font-medium text-primary hover:underline" onClick={() => setRedeem(null)}>{t('{n} points used · undo', { n: redeem.points })}</button>
                  : <button type="button" className="font-medium text-primary hover:underline disabled:opacity-50" disabled={!lines.length || card.points < num(card.program.min_redeem_points) || !sync.online}
                      onClick={() => void spendPoints()}>{t('Spend points')}</button>)}
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => { setFlash(null); setDialog('card') }} className="flex items-center gap-2 border-b px-4 py-2.5 text-left hover:bg-muted/50">
              <BadgePercent className="size-4 text-muted-foreground" />
              <span className="flex-1 truncate text-[13px] text-muted-foreground">{t('Loyalty card')}</span>
              <Kbd>F3</Kbd>
            </button>
          ))}
          <div className="min-h-0 flex-1 overflow-y-auto" role="listbox" aria-label={t('Sale lines')}>
            {!lines.length ? (
              <div className="grid h-full place-items-center p-8 text-center">
                <div><ReceiptText className="mx-auto size-8 text-muted-foreground/50" /><p className="mt-2 text-[13px] text-muted-foreground">{t('Scan an item or tap a product to start a sale.')}</p></div>
              </div>
            ) : priced.map((l) => (
              <div key={l.key} role="option" aria-selected={selected === l.key} onClick={() => setSelected(l.key)} onDoubleClick={() => { setSelected(l.key); setDialog('line') }}
                className={cn('grid cursor-pointer grid-cols-[1fr_auto] gap-x-3 border-b px-4 py-2.5', selected === l.key ? 'bg-primary/5 ring-1 ring-inset ring-primary/30' : 'hover:bg-muted/40')}>
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium">{l.name}</div>
                  <div className="text-xs text-muted-foreground tabular">{num(l.qty)} × {formatMoney(l.price)}{l.discount ? <span className="text-primary"> · −{Math.round(l.discount * 100) / 100}%{l.card ? ` ${t('card')}` : ''}{(l as PricedLine).promo ? ` ${(l as PricedLine).promo!.name}` : ''}</span> : null}</div>
                </div>
                <div className="text-right text-[15px] font-semibold tabular">{formatMoney(lineTotal(l))}</div>
                {selected === l.key && (
                  <div className="col-span-2 mt-2 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                    <Button size="icon" variant="outline" className="size-9" aria-label={t('One less')} onClick={() => updateLine(l.key, { qty: l.qty - 1 })}><Minus /></Button>
                    <span className="w-10 text-center text-sm font-semibold tabular">{num(l.qty)}</span>
                    <Button size="icon" variant="outline" className="size-9" aria-label={t('One more')} onClick={() => updateLine(l.key, { qty: l.qty + 1 })}><Plus /></Button>
                    <Button size="sm" variant="ghost" className="ml-1" onClick={() => setDialog('line')}>{t('Quantity, discount…')}</Button>
                    <Button size="icon" variant="ghost" className="ml-auto size-9 text-destructive" aria-label={t('Remove line')} onClick={() => removeLine(l.key)}><Trash2 /></Button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="border-t px-4 py-3">
            <div className="flex justify-between text-[13px] text-muted-foreground"><span>{t('{a} lines · {b} items', { a: lines.length, b: num(itemsCount) })}</span><span className="tabular">{t('incl. VAT {amount}', { amount: formatMoney(vat) })}</span></div>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-sm font-medium">{t('Total with VAT|till')}</span>
              <span className="text-[34px] font-semibold leading-none tracking-[-0.02em] tabular">{formatMoney(total)} <span className="text-sm font-normal text-muted-foreground">{cur}</span></span>
            </div>
            <div className="mt-3 grid grid-cols-[auto_1fr] gap-2">
              <Button variant="outline" size="lg" className="h-14" disabled={!lines.length} onClick={() => { if (lines.length < 3 || confirm(t('Clear this sale?'))) clearSale() }}><X /> {t('Clear')}</Button>
              <Button size="lg" className="h-14 text-lg" disabled={!lines.length} onClick={() => setDialog('pay')}>{t('Pay {amount}', { amount: formatMoney(total) })} <Kbd className="ml-2 border-primary-foreground/30 bg-primary-foreground/10 text-primary-foreground">F12</Kbd></Button>
            </div>
          </div>
        </aside>
      </div>

      {camera && <CameraScanner onClose={() => setCamera(false)} onCode={(c) => { setCamera(false); submitQuery(c) }} />}
      {dialog === 'pay' && <PayDialog total={r2(total)} currency={cur} cashLimit={cashLimit} onCancel={() => { setDialog(null); focusSearch() }} onPaid={(t) => finish(t)} />}
      {dialog === 'card' && <CardDialog onClose={() => { setDialog(null); focusSearch() }} onCode={async (c) => { if (await applyCardCode(c)) { setDialog(null); focusSearch() } }} error={flash?.tone === 'error' ? flash.text : null} />}
      {dialog === 'customer' && <CustomerDialog data={data} value={customer} onClose={(v) => { if (v !== undefined) setCustomer(v); setDialog(null); focusSearch() }} />}
      {dialog === 'line' && selectedLine && <LineDialog line={selectedLine} canDiscount={(d) => d <= MAX_DISCOUNT || can('pos.approve')}
        onClose={(p) => { if (p) updateLine(selectedLine.key, p); setDialog(null); focusSearch() }} onRemove={() => { removeLine(selectedLine.key); setDialog(null); focusSearch() }} />}
      {dialog === 'refund' && <RefundDialog data={data} currency={cur} onClose={() => { setDialog(null); focusSearch() }}
        onRefund={(of, ls, method) => finish([{ method, amount: -r2(ls.reduce((s, l) => s + Math.abs(lineTotal(l)), 0)) }], { refund: { of, lines: ls } })} />}
      {dialog === 'cash' && <CashDialog sessionId={session.id} currency={cur} onClose={() => { setDialog(null); focusSearch() }} />}
      {dialog === 'close' && <CloseDialog data={data} pending={pending.length} onClose={() => { setDialog(null); focusSearch() }}
        onClosed={async (sessionId) => { await reload(); navigate(`/pos/sessions/${sessionId}`) }} />}
      {dialog === 'queue' && (
        <Dialog open onOpenChange={(o) => { if (!o) { setDialog(null); focusSearch() } }}>
          <DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>{t('Sending sales')}</DialogTitle>
            <DialogDescription>{t('Every sale is saved on this device first, then sent. Nothing is lost when the internet drops, and no sale is counted twice.')}</DialogDescription></DialogHeader>
            <SyncPanel compact /></DialogContent>
        </Dialog>
      )}
      {done && <DoneOverlay done={{ ...done, number: doneUuid.current ? lastNumbers[doneUuid.current] ?? null : null }} currency={cur} onNext={() => { setDone(null); focusSearch() }} />}
    </div>
  )
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return <kbd className={cn('hidden rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground lg:inline', className)}>{children}</kbd>
}

/* ================================================================== payment */
export function PayDialog({ total, currency, cashLimit, onCancel, onPaid }: { total: number; currency: string; cashLimit?: { limit: number; block: boolean; business: boolean } | null
  onCancel: () => void; onPaid: (t: Tender[]) => Promise<void> }) {
  const [tenders, setTenders] = React.useState<Tender[]>([])
  const [method, setMethod] = React.useState<Method>('cash')
  const paid = r2(tenders.reduce((s, t) => s + t.amount, 0))
  const remaining = r2(Math.max(total - paid, 0))
  const [amount, setAmount] = React.useState(String(total))
  const [busy, setBusy] = React.useState(false)
  const input = React.useRef<HTMLInputElement>(null)
  React.useEffect(() => { setAmount(remaining ? String(remaining) : ''); input.current?.select() }, [remaining])

  const cashPaid = tenders.filter((t) => t.method === 'cash').reduce((s, t) => s + t.amount, 0)
  const change = r2(paid - total)
  const valid = paid >= total - 0.001 && change <= cashPaid + 0.001

  const complete = async (ts: Tender[]) => {
    if (busy) return
    setBusy(true)
    try { await onPaid(ts) } catch (e) { toast.error(describeError(e)); setBusy(false) }
  }
  /** a tender that covers the rest finishes the sale straight away */
  const addTender = (m: Method, v: number) => {
    if (!(v > 0)) return
    const next = [...tenders, { method: m, amount: r2(v) }]
    const p = r2(next.reduce((s, t) => s + t.amount, 0))
    const cash = next.filter((t) => t.method === 'cash').reduce((s, t) => s + t.amount, 0)
    if (m !== 'cash' && p > total + 0.001) { toast.error(t('Only cash can be more than what is due — change is given in cash')); return }
    // cash that stays (what was given minus the change) above the law's limit
    const nonCash = next.filter((x) => x.method !== 'cash').reduce((s, x) => s + x.amount, 0)
    if (cashLimit?.block && m === 'cash' && Math.min(cash, Math.max(total - nonCash, 0)) > cashLimit.limit + 0.001) {
      toast.error(t('The law allows at most {limit} in cash here. Take the rest by card or bank.', { limit: formatMoney(cashLimit.limit) })); return
    }
    setTenders(next)
    if (p >= total - 0.001 && p - total <= cash + 0.001) void complete(next)
  }
  const quickNotes = React.useMemo(() => {
    const out = new Set<number>([remaining])
    for (const n of NOTES) { const v = Math.ceil(remaining / n) * n; if (v > remaining) out.add(v); if (out.size >= 5) break }
    return [...out].filter((v) => v > 0).slice(0, 5)
  }, [remaining])

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const m = METHODS.find((x) => x.key === e.key)
      if (m) { e.preventDefault(); setMethod(m.id); input.current?.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent className="max-w-xl gap-5">
        <DialogHeader>
          <DialogTitle className="flex items-baseline justify-between gap-3 pr-6">
            <span>{t('Payment')}</span>
            <span className="text-3xl font-semibold tabular">{formatMoney(total)} <span className="text-sm font-normal text-muted-foreground">{currency}</span></span>
          </DialogTitle>
          <DialogDescription>{remaining > 0 ? <>{t('Still to pay')} <b className="tabular text-foreground">{formatMoney(remaining)}</b>. {t('Pick a method (F5–F8), enter what the customer gives, press Enter.')}</> : <>{t('Paid in full')}{change > 0 ? <> · {t('change')} <b className="tabular text-foreground">{formatMoney(change)}</b></> : ''}.</>}</DialogDescription>
        </DialogHeader>
        {cashLimit && total > cashLimit.limit && (
          <p className={cn('rounded-md px-3 py-2 text-[13px]', cashLimit.block ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning')}>
            {cashLimit.business ? t('With a business the law allows at most {limit} in cash a day.', { limit: formatMoney(cashLimit.limit) })
              : t('The law allows at most {limit} in cash with one person a day.', { limit: formatMoney(cashLimit.limit) })}{' '}
            {t('Take the part above it by card or bank.')}
          </p>
        )}
        <div className="grid grid-cols-4 gap-2">
          {METHODS.map((m) => (
            <button key={m.id} type="button" onClick={() => { setMethod(m.id); input.current?.focus() }} aria-pressed={method === m.id}
              className={cn('flex flex-col items-center gap-1 rounded-lg border-2 py-3 text-[13px] font-medium transition-colors', method === m.id ? 'border-primary bg-primary/5 text-primary' : 'hover:bg-muted')}>
              <m.icon className="size-5" />{t(m.label)}<span className="font-mono text-[10px] text-muted-foreground">{m.key}</span>
            </button>
          ))}
        </div>
        {remaining > 0 && (
          <form onSubmit={(e) => { e.preventDefault(); addTender(method, num(amount)) }} className="grid gap-3">
            <div className="flex gap-2">
              <Input ref={input} autoFocus inputMode="decimal" aria-label={t('Amount received')} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, '').replace(',', '.'))}
                className="h-14 flex-1 text-right text-2xl font-semibold tabular" />
              <Button type="submit" size="lg" className="h-14 px-6" disabled={!(num(amount) > 0) || busy}>{t('Add')}</Button>
            </div>
            {method === 'cash' ? (
              <div className="flex flex-wrap gap-2">
                {quickNotes.map((v, i) => (
                  <Button key={v} type="button" variant={i === 0 ? 'secondary' : 'outline'} className="h-11 min-w-[88px] text-base tabular" disabled={busy} onClick={() => addTender('cash', v)}>
                    {i === 0 ? t('Exact') : formatMoney(v, undefined, 0)}
                  </Button>
                ))}
              </div>
            ) : (
              <Button type="button" variant="secondary" className="h-11" disabled={busy} onClick={() => addTender(method, remaining)}>
                {t('{method} for the rest · {amount}', { method: t(METHODS.find((m) => m.id === method)!.label), amount: formatMoney(remaining) })}
              </Button>
            )}
          </form>
        )}
        {tenders.length > 0 && (
          <div className="grid gap-1 rounded-lg bg-muted/50 p-3 text-[13px]">
            {tenders.map((x, i) => (
              <div key={i} className="flex items-center justify-between gap-2">
                <span>{t(METHODS.find((m) => m.id === x.method)!.label)}</span>
                <span className="flex items-center gap-2 tabular">{formatMoney(x.amount)}
                  <button type="button" className="text-muted-foreground hover:text-destructive" aria-label={t('Remove payment')} onClick={() => setTenders((ts) => ts.filter((_, j) => j !== i))}><X className="size-3.5" /></button></span>
              </div>
            ))}
            {change > 0 && <div className="flex justify-between border-t pt-1 font-semibold"><span>{t('Change')}</span><span className="tabular">{formatMoney(change)}</span></div>}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>{t('Back to sale')}</Button>
          {remaining === 0 && <Button size="lg" loading={busy} disabled={!valid} onClick={() => void complete(tenders)}>{t('Complete sale')}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DoneOverlay({ done, currency, onNext }: { done: Done; currency: string; onNext: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-6 backdrop-blur-sm" role="dialog" aria-label={t('Sale complete')}>
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 text-center shadow-lg">
        <div className="mx-auto grid size-12 place-items-center rounded-full bg-success/15 text-success"><Check className="size-6" /></div>
        <div className="mt-4 text-[13px] text-muted-foreground">{done.receipt.isRefund ? t('Refund') : t('Sale')} {done.number ?? done.ref} · {formatMoney(done.total)} {currency}</div>
        {done.change > 0 ? (
          <><div className="mt-4 text-sm font-medium text-muted-foreground">{t('Change to give')}</div>
            <div className="text-6xl font-semibold tracking-[-0.03em] tabular">{formatMoney(done.change)}</div></>
        ) : <div className="mt-4 text-3xl font-semibold">{done.receipt.isRefund ? t('Refund recorded') : t('Paid')}</div>}
        {done.offline && <p className="mt-3 text-[13px] text-warning">{t('Saved on this device. It reaches the books when the till is back online.')}</p>}
        <div className="mt-6 grid grid-cols-2 gap-2">
          <Button variant="outline" size="lg" onClick={() => printReceipt(done.receipt)}><Printer /> {t('Receipt|pos')} <Kbd>P</Kbd></Button>
          <Button size="lg" autoFocus onClick={onNext}>{t('Next sale')} <Kbd className="ml-1 border-primary-foreground/30 bg-primary-foreground/10 text-primary-foreground">{t('Enter|key')}</Kbd></Button>
        </div>
      </div>
    </div>
  )
}

/* ================================================================== small dialogs */
function CardDialog({ onClose, onCode, error }: { onClose: () => void; onCode: (code: string) => Promise<void>; error: string | null }) {
  const [code, setCode] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{t('Loyalty card')}</DialogTitle><DialogDescription>{t('Scan the card, or type its number or the customer\'s phone.')}</DialogDescription></DialogHeader>
        <form className="grid gap-3" onSubmit={async (e) => { e.preventDefault(); if (!code.trim()) return; setBusy(true); try { await onCode(code) } finally { setBusy(false) } }}>
          <Input autoFocus className="h-12 font-mono text-lg" value={code} onChange={(e) => setCode(e.target.value)} placeholder="29… / 044 123 456" aria-label={t('Card number or phone')} />
          {error && <p className="text-[13px] text-destructive">{error}</p>}
          <DialogFooter><Button type="button" variant="ghost" onClick={onClose} disabled={busy}>{t('Cancel')}</Button><Button type="submit" loading={busy} disabled={!code.trim()}>{t('Use the card')}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function CustomerDialog({ data, value, onClose }: { data: TillData; value: string | null; onClose: (v?: string | null) => void }) {
  const [q, setQ] = React.useState('')
  const list = data.customers.filter((c) => !q || `${c.name} ${c.code ?? ''} ${c.tax_number ?? ''}`.toLowerCase().includes(q.toLowerCase())).slice(0, 50)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{t('Customer')}</DialogTitle><DialogDescription>{t('Leave the walk-in customer for anonymous sales. A business customer\'s NIPT prints on the receipt.')}</DialogDescription></DialogHeader>
        <div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus className="h-11 pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Name, code or NIPT')}
            onKeyDown={(e) => { if (e.key === 'Enter' && list[0]) onClose(list[0].id) }} /></div>
        <div className="max-h-72 overflow-y-auto rounded-md border">
          <button type="button" className={cn('w-full border-b px-3 py-2.5 text-left text-[13px] hover:bg-muted', value === null && 'bg-primary/5 font-medium')} onClick={() => onClose(null)}>{t('Walk-in customer')}</button>
          {list.map((c) => (
            <button key={c.id} type="button" className={cn('flex w-full justify-between border-b px-3 py-2.5 text-left text-[13px] last:border-0 hover:bg-muted', value === c.id && 'bg-primary/5 font-medium')} onClick={() => onClose(c.id)}>
              <span>{c.name}</span><span className="text-muted-foreground">{c.tax_number ?? c.code}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function LineDialog({ line, canDiscount, onClose, onRemove }: { line: Line; canDiscount: (d: number) => boolean; onClose: (p?: Partial<Line>) => void; onRemove: () => void }) {
  const [qty, setQty] = React.useState(String(line.qty))
  const [disc, setDisc] = React.useState(String(line.discount || ''))
  const d = num(disc)
  const allowed = canDiscount(d)
  const valid = num(qty) > 0 && d >= 0 && d <= 100 && allowed
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="truncate pr-6">{line.name}</DialogTitle><DialogDescription>{line.sku} · {t('{price} each, with VAT', { price: formatMoney(line.price) })}</DialogDescription></DialogHeader>
        <form className="grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); if (valid) onClose({ qty: num(qty), discount: d }) }}>
          <div className="grid gap-1.5"><Label htmlFor="ln-q">{t('Quantity')}</Label><Input id="ln-q" autoFocus inputMode="decimal" className="h-12 text-right text-lg tabular" value={qty} onChange={(e) => setQty(e.target.value.replace(',', '.'))} onFocus={(e) => e.target.select()} /></div>
          <div className="grid gap-1.5"><Label htmlFor="ln-d">{t('Discount %')}</Label><Input id="ln-d" inputMode="decimal" className="h-12 text-right text-lg tabular" value={disc} onChange={(e) => setDisc(e.target.value.replace(',', '.'))} placeholder="0" /></div>
          <div className="col-span-2 flex flex-wrap gap-1.5">{[5, 10, 15, 20].map((p) => <Button key={p} type="button" variant="outline" size="sm" onClick={() => setDisc(String(p))}>{p}%</Button>)}</div>
          {!allowed && <p className="col-span-2 text-[13px] text-destructive">{t('Discounts above {pct}% need a manager.', { pct: MAX_DISCOUNT })}</p>}
          <div className="col-span-2 flex justify-between text-[13px]"><span className="text-muted-foreground">{t('Line total, with VAT')}</span><span className="font-semibold tabular">{formatMoney(lineTotal({ qty: num(qty), price: line.price, discount: d }))}</span></div>
          <div className="col-span-2 flex gap-2"><Button type="button" variant="ghost" className="text-destructive" onClick={onRemove}><Trash2 /> {t('Remove')}</Button><Button type="submit" className="ml-auto" disabled={!valid}>{t('Apply')}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RefundDialog({ data, currency, onClose, onRefund }: { data: TillData; currency: string; onClose: () => void; onRefund: (of: ReceiptLookup, lines: Line[], method: Method) => Promise<void> }) {
  const [code, setCode] = React.useState('')
  const [found, setFound] = React.useState<ReceiptLookup | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [qty, setQty] = React.useState<Record<number, string>>({})
  const [method, setMethod] = React.useState<Method>('cash')
  const look = async () => {
    setBusy(true)
    try {
      const r = await lookupReceipt(data.register.company_id, code)
      if (!r) { toast.error(t('No receipt {number}', { number: code })); return }
      if (r.is_refund) { toast.error(t('That is a refund receipt; scan the original sale')); return }
      setFound(r)
      setQty(Object.fromEntries(r.lines.map((l, i) => [i, String(left(r, l.variant_id, num(l.quantity)))])))
    } catch (e) { toast.error(navigator.onLine ? describeError(e) : t('Refunds look up the original receipt, which needs internet')) } finally { setBusy(false) }
  }
  const left = (r: ReceiptLookup, variant: string, sold: number) =>
    Math.max(sold - r.refunds.flatMap((x) => x.lines).filter((x) => x.variant_id === variant).reduce((s, x) => s - num(x.quantity), 0), 0)
  const lines: Line[] = found ? found.lines.map((l, i) => ({ key: String(i), variant_id: l.variant_id, name: l.description, sku: '', price: num(l.unit_price), qty: -num(qty[i]), discount: num(l.discount_pct), rate: num(l.tax_rate), barcode: null }))
    .filter((l) => l.qty < 0) : []
  const total = lines.reduce((s, l) => s + Math.abs(lineTotal(l)), 0)
  const tooMuch = found ? found.lines.some((l, i) => num(qty[i]) > left(found, l.variant_id, num(l.quantity))) : false
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{t('Refund')}</DialogTitle><DialogDescription>{t('Scan or type the receipt number. Items come back into the till\'s stock at the cost they left with.')}</DialogDescription></DialogHeader>
        {!found ? (
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (code.trim()) void look() }}>
            <Input autoFocus className="h-12 font-mono" value={code} onChange={(e) => setCode(e.target.value)} placeholder={t('{a} or {b}', { a: 'POS-2026-00012', b: 'T1-261024-0007' })} />
            <Button type="submit" className="h-12" loading={busy}>{t('Find')}</Button>
          </form>
        ) : (
          <div className="grid gap-3">
            <div className="text-[13px] text-muted-foreground">{found.number} · {formatDateWith(new Date(found.order_at), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · {formatMoney(found.total)} {currency}</div>
            <div className="max-h-64 overflow-y-auto rounded-md border">
              {found.lines.map((l, i) => {
                const max = left(found, l.variant_id, num(l.quantity))
                return (
                  <div key={i} className="flex items-center gap-3 border-b px-3 py-2 last:border-0">
                    <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-medium">{l.description}</div>
                      <div className="text-xs text-muted-foreground">{t('{a} sold · {b} can be returned · {price} with VAT', { a: num(l.quantity), b: max, price: formatMoney(l.unit_price) })}</div></div>
                    <Input aria-label={t('Return quantity for {item}', { item: l.description })} inputMode="decimal" className={cn('h-10 w-20 text-right tabular', num(qty[i]) > max && 'border-destructive')}
                      value={qty[i] ?? ''} onChange={(e) => setQty((s) => ({ ...s, [i]: e.target.value.replace(',', '.') }))} />
                  </div>
                )
              })}
            </div>
            <div className="flex gap-2">{METHODS.slice(0, 2).map((m) => <Button key={m.id} type="button" variant={method === m.id ? 'default' : 'outline'} onClick={() => setMethod(m.id)}><m.icon /> {m.id === 'cash' ? t('Give back in cash') : t('Give back to the card')}</Button>)}</div>
            <div className="flex items-baseline justify-between"><span className="text-sm">{t('To give back')}</span><span className="text-2xl font-semibold tabular">{formatMoney(total)}</span></div>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={found ? () => setFound(null) : onClose} disabled={busy}>{found ? t('Another receipt') : t('Cancel')}</Button>
          {found && <Button variant="destructive" loading={busy} disabled={!lines.length || tooMuch}
            onClick={async () => { setBusy(true); try { await onRefund(found, lines, method) } catch (e) { toast.error(describeError(e)); setBusy(false) } }}>{t('Refund {amount}', { amount: formatMoney(total) })}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CashDialog({ sessionId, currency, onClose }: { sessionId: string; currency: string; onClose: () => void }) {
  const move = useCashMove()
  const [type, setType] = React.useState<'cash_in' | 'cash_out'>('cash_out')
  const [amount, setAmount] = React.useState('')
  const [reason, setReason] = React.useState('')
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{t('Cash in or out')}</DialogTitle><DialogDescription>{t('Adding small change, paying a courier from the drawer, taking cash to the bank during the day. Needs internet.')}</DialogDescription></DialogHeader>
        <form className="grid gap-3" onSubmit={async (e) => { e.preventDefault(); await move.mutateAsync({ session: sessionId, type, amount: num(amount), reason }); toast.success(type === 'cash_in' ? t('Cash in recorded') : t('Cash out recorded')); onClose() }}>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant={type === 'cash_in' ? 'default' : 'outline'} onClick={() => setType('cash_in')}>{t('Cash in')}</Button>
            <Button type="button" variant={type === 'cash_out' ? 'default' : 'outline'} onClick={() => setType('cash_out')}>{t('Cash out')}</Button>
          </div>
          <Input autoFocus inputMode="decimal" aria-label={t('Amount in {currency}', { currency })} className="h-12 text-right text-xl tabular" value={amount} onChange={(e) => setAmount(e.target.value.replace(',', '.'))} placeholder={`0.00 ${currency}`} />
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('Reason, e.g. Paid the courier')} aria-label={t('Reason')} />
          <DialogFooter><Button type="button" variant="ghost" onClick={onClose}>{t('Cancel')}</Button><Button type="submit" loading={move.isPending} disabled={!(num(amount) > 0) || !reason.trim()}>{t('Record')}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const DENOMS = [5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 1]
function CloseDialog({ data, pending, onClose, onClosed }: { data: TillData; pending: number; onClose: () => void; onClosed: (sessionId: string) => Promise<void> }) {
  const session = data.session!
  const summary = useSessionSummary(session.id)
  const close = useCloseSession()
  const [counts, setCounts] = React.useState<Record<number, string>>({})
  const [direct, setDirect] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const byNotes = DENOMS.reduce((s, d) => s + d * num(counts[d]), 0)
  const counted = direct !== '' ? num(direct) : byNotes
  const s = summary.data
  const diff = s ? r2(counted - num(s.expected_cash)) : 0
  return (
    <Dialog open onOpenChange={(o) => !o && !close.isPending && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{t('Close {name}', { name: data.register.name })}</DialogTitle>
          <DialogDescription>{t('Count the drawer. Closing prints the Z-report and books the shift\'s sales and cash in accounting.')}</DialogDescription></DialogHeader>
        {pending > 0 && <div className="rounded-md border border-warning/50 bg-warning/5 px-3 py-2 text-[13px]">
          {tn(pending, '{n} sale from this device is still waiting to be sent.', '{n} sales from this device are still waiting to be sent.')} <button type="button" className="font-medium text-primary hover:underline" onClick={() => void syncNow()}>{t('Send now')}</button> {t('before closing, or they move to the next shift.')}</div>}
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="grid content-start gap-1.5 text-[13px]">
            {!s ? <Skeleton className="h-40" /> : <>
              <Row k={t('Receipts')} v={t('{a} · {b} refunds', { a: s.orders, b: s.refunds })} />
              <Row k={t('Sales (with VAT)')} v={formatMoney(num(s.gross) - num(s.refunded))} />
              {Object.entries(s.payments).map(([m, v]) => <Row key={m} k={tEnum(m)} v={formatMoney(v)} />)}
              <Row k={t('Change given')} v={`${num(s.change) ? '−' : ''}${formatMoney(s.change)}`} />
              <div className="my-1 border-t" />
              <Row k={t('Opening cash')} v={formatMoney(session.opening_cash)} />
              <Row k={t('Cash in / out')} v={`${formatMoney(s.cash_in)} / ${num(s.cash_out) ? '−' : ''}${formatMoney(s.cash_out)}`} />
              <Row k={t('Expected in drawer')} v={formatMoney(s.expected_cash)} strong />
              <Row k={t('Counted')} v={formatMoney(counted)} strong />
              <div className={cn('mt-1 flex justify-between rounded-md px-2 py-1.5 font-semibold', diff === 0 ? 'bg-success/10 text-success' : diff < 0 ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning')}>
                <span>{diff === 0 ? t('Drawer balances') : diff < 0 ? t('Short|cash') : t('Over|cash')}</span><span className="tabular">{formatMoney(diff)}</span></div>
            </>}
          </div>
          <div className="grid content-start gap-2">
            <Label>{t('Count by note and coin')}</Label>
            <div className="grid grid-cols-2 gap-1.5">
              {DENOMS.map((d) => (
                <label key={d} className="flex items-center gap-2 text-[13px]"><span className="w-12 text-right tabular text-muted-foreground">{d}</span>
                  <Input inputMode="numeric" className="h-8 tabular" value={counts[d] ?? ''} onChange={(e) => { setDirect(''); setCounts((c) => ({ ...c, [d]: e.target.value.replace(/\D/g, '') })) }} aria-label={t('Count of {value}', { value: d })} /></label>
              ))}
            </div>
            <Label htmlFor="cl-total" className="mt-1">{t('…or the total counted')}</Label>
            <Input id="cl-total" inputMode="decimal" className="h-11 text-right text-lg tabular" value={direct} onChange={(e) => setDirect(e.target.value.replace(',', '.'))} placeholder={formatMoney(byNotes)} />
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('Note for the manager (optional)')} aria-label={t('Notes')} />
          </div>
        </div>
        <DialogFooter><Button variant="ghost" onClick={onClose} disabled={close.isPending}>{t('Keep selling')}</Button>
          <Button loading={close.isPending} disabled={!s} onClick={async () => {
            const zId = await close.mutateAsync({ session: session.id, counted, notes })
            try {
              const z = unwrap(await supabase.from('z_reports').select('*').eq('id', zId).single())
              printZReport({
                company: data.company.name, register: data.register.name, number: z.number, session: session.number, opened: session.opened_at, closed: new Date().toISOString(), date: z.report_date,
                currency: data.company.base_currency, orders: z.order_count, refunds: z.refund_count, gross: num(z.gross_sales), refundsTotal: num(z.refunds_total), discounts: num(z.discounts_total),
                net: num(z.net_sales), tax: num(z.tax_total), payments: z.payments_by_method as Record<string, number>,
                taxes: ((z.tax_breakdown ?? []) as { rate: number; base: number; tax: number }[]).map((x) => ({ rate: num(x.rate), base: num(x.base), tax: num(x.tax) })),
                opening: num(z.opening_cash), cashIn: num(z.cash_in), cashOut: num(z.cash_out), expected: num(z.expected_cash), counted: z.counted_cash, difference: z.cash_difference,
                items: (z.items ?? []) as { name: string; quantity: number; total: number }[],
              })
            } catch { /* the Z-report can be reprinted from the session page */ }
            toast.success(t('Till closed'))
            await onClosed(session.id)
          }}>{t('Close till and print Z-report')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
const Row = ({ k, v, strong }: { k: string; v: string; strong?: boolean }) => (
  <div className={cn('flex justify-between gap-3', strong && 'font-semibold')}><span className="text-muted-foreground">{k}</span><span className="tabular">{v}</span></div>
)

