import {
  ArrowLeft, ArrowRightLeft, ChefHat, CreditCard, Ellipsis, ListOrdered, Minus, NotebookPen, Plus, Printer, ReceiptText, Search, Send, Settings2, ShoppingBag, Trash2, Undo2, Users, X,
} from 'lucide-react'
import * as React from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '@/app/auth-provider'
import { useCompany } from '@/app/company-provider'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { usePhone } from '@/hooks/use-phone'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateWith, t, td, tn } from '@/i18n'
import { openCashDrawer, printHtml } from '@/lib/print'
import { cn, formatMoney, num } from '@/lib/utils'
import { type CatalogItem, type TillData, useTill } from '@/features/pos/api'
import { nextDeviceRef } from '@/features/pos/offline'
import { printReceipt, type ReceiptData } from '@/features/pos/receipt'
import { Centered, OpenTill, PayDialog, type Tender, TillSkeleton } from '@/features/pos/pages/till-page'
import {
  type Floor, type FloorOrder, type SentTickets, type Tab, type TabLine,
  useAddItems, useChangeLine, useCloseEmpty, useFloor, useMoveTab, useOpenTab, usePayTab, useSend, useSetGuests, useTab, useVoidLine,
} from './api'
import { RoomSetupDialog } from './room-setup'
import { OfflineBanner } from '@/components/offline-banner'
import { tableBox } from './floor-plan'
import { quoteLoyalty, type Quote } from '@/features/loyalty/api'
import { describeError } from '@/lib/errors'

const r2 = (v: number) => Math.sign(v) * Math.round(Math.abs(v) * 100 + 1e-7) / 100
const lineSum = (l: { quantity: number; unit_price: number }) => r2(num(l.quantity) * num(l.unit_price))
const prefGet = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d } catch { return d } }
const prefSet = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* ignore */ } }
const minutesSince = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000)) : 0)
const ago = (iso: string | null) => { const m = minutesSince(iso); return m < 60 ? t('{m} min', { m }) : t('{h} h {m} min', { h: Math.floor(m / 60), m: m % 60 }) }
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const TICKET_CSS = `@page{size:80mm auto;margin:3mm 4mm} body{margin:0;font:14px/1.35 ui-monospace,Menlo,Consolas,monospace;color:#000;width:72mm}
  .big{font-size:20px;font-weight:700} .c{text-align:center} hr{border:0;border-top:1px dashed #000;margin:6px 0} .n{font-size:13px;padding-left:4mm} table{width:100%;border-collapse:collapse} td{padding:1px 0;vertical-align:top}`

function printKitchen(s: SentTickets) {
  const when = formatDateWith(new Date(s.at), { hour: '2-digit', minute: '2-digit' })
  const body = s.tickets.map((tk, i) => `${i ? '<div style="page-break-before:always"></div>' : ''}<div class="c big">${esc(tk.station || t('Kitchen'))}</div>
    <div class="c big">${esc(s.table ? t('Table {name}', { name: s.table }) : s.label || s.number)}</div><div class="c">${esc(when)} · ${esc(s.waiter)}</div><hr>
    <table>${tk.lines.map((l) => `<tr><td class="big">${esc(num(l.quantity))} ×</td><td class="big">${esc(l.name)}</td></tr>${l.note ? `<tr><td></td><td class="n">» ${esc(l.note)}</td></tr>` : ''}`).join('')}</table>`).join('')
  if (body) printHtml(body, TICKET_CSS, 'kitchen')
}
function printBill(company: TillData['company'], tab: Tab) {
  const lines = tab.lines.filter((l) => l.status !== 'void' && !l.paid)
  const total = lines.reduce((s, l) => s + lineSum(l), 0)
  printHtml(`<div class="c big">${esc(company.name)}</div><div class="c">${esc(tab.table ? t('Table {name}', { name: tab.table }) : tab.label || tab.number)} · ${esc(tn(tab.guests, '{n} guest', '{n} guests'))}</div><hr>
    <table>${lines.map((l) => `<tr><td>${esc(num(l.quantity))} × ${esc(l.name)}</td><td style="text-align:right">${esc(formatMoney(lineSum(l)))}</td></tr>`).join('')}</table><hr>
    <table><tr class="big"><td>${esc(t('Total'))}</td><td style="text-align:right">${esc(formatMoney(total))}</td></tr></table>
    ${tab.guests > 1 ? `<div>${esc(t('Per guest {amount}', { amount: formatMoney(total / tab.guests) }))}</div>` : ''}
    <hr><div class="c">${esc(t('This is not a fiscal receipt.'))}</div>`, TICKET_CSS, 'receipt')
}

/* ================================================================== route */
export function FloorPage() {
  const { registerId } = useParams()
  const { user, loading } = useAuth()
  const till = useTill(registerId)
  if (loading) return <TillSkeleton />
  if (!user) return <Navigate to="/login" replace state={{ from: `/pos/floor/${registerId}` }} />
  if (till.loading && !till.data) return <TillSkeleton />
  if (!till.data) return <Centered><p className="text-[13px] text-muted-foreground">{till.error ?? t('The floor needs internet.')}</p><Button className="mt-4" onClick={() => void till.reload()}>{t('Try again')}</Button></Centered>
  if (!till.data.session) return <OpenTill data={till.data} offline={till.offline} onOpened={() => void till.reload()} />
  return <Restaurant data={till.data} />
}

type Draft = { key: string; variant_id: string; name: string; price: number; quantity: number; note: string }

function Restaurant({ data }: { data: TillData }) {
  const { user } = useAuth()
  const { can } = useCompany()
  const floor = useFloor(data.register.id)
  const openTab = useOpenTab()
  const [tabId, setTabId] = React.useState<string | null>(null)
  const [area, setArea] = React.useState<string | null>(null)
  const [setup, setSetup] = React.useState(false)
  const [kitchenPrint, setKitchenPrint] = React.useState(() => prefGet('pos.kitchenprint', '1') === '1')
  const [, tick] = React.useReducer((x: number) => x + 1, 0)
  React.useEffect(() => { const i = setInterval(tick, 30_000); return () => clearInterval(i) }, [])
  const cashier = (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? ''
  const areas = floor.data?.areas ?? []
  const current = areas.find((a) => a.id === area) ?? areas[0]
  const phone = usePhone()
  const takeaway = () => { const label = prompt(t('Name for the takeaway order (optional)')) ?? undefined; void open(null, label) }
  const toggleTickets = () => setKitchenPrint((a) => { prefSet('pos.kitchenprint', a ? '0' : '1'); return !a })
  const areaNav = !tabId && areas.length > 1 && (
    <nav className={cn('flex gap-1 overflow-x-auto', phone ? 'shrink-0 border-b bg-card px-3 py-2' : 'ml-3')} aria-label={t('Areas')}>
      {areas.map((a) => (
        <button key={a.id} type="button" onClick={() => setArea(a.id)}
          className={cn('h-9 shrink-0 rounded-full px-3.5 text-[13px] font-medium', current?.id === a.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}>{a.name}</button>
      ))}
    </nav>
  )

  const open = async (table: string | null, label?: string) => {
    const id = await openTab.mutateAsync({ register: data.register.id, table, guests: 1, label })
    setTabId(id)
  }

  return (
    <div className="flex h-dvh flex-col bg-muted/30 text-foreground">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-card px-3">
        {tabId
          ? <Button variant="ghost" size="icon" aria-label={t('Back to the floor')} onClick={() => setTabId(null)}><ArrowLeft /></Button>
          : <Button variant="ghost" size="icon" asChild aria-label={t('Leave the floor')}><Link to="/pos"><ArrowLeft /></Link></Button>}
        <div className="min-w-0 flex-1 sm:flex-none">
          <div className="truncate text-sm font-semibold">{data.register.name}</div>
          <div className="truncate text-xs text-muted-foreground">{data.session!.number} · {cashier}</div>
        </div>
        {!phone && areaNav}
        {phone ? (
          <div className="ml-auto flex items-center gap-1">
            {!tabId && <Button variant="outline" size="icon" aria-label={t('Takeaway')} onClick={takeaway}><ShoppingBag /></Button>}
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={t('More')}><Ellipsis /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuItem asChild><a href={`/pos/kitchen/${data.register.warehouse_id}`} target="_blank" rel="noreferrer"><ChefHat /> {t('Kitchen screen')}</a></DropdownMenuItem>
                <DropdownMenuCheckboxItem checked={kitchenPrint} onCheckedChange={toggleTickets}><Printer className="mr-2 size-4" /> {t('Print a kitchen ticket when items are sent')}</DropdownMenuCheckboxItem>
                {can('pos.approve') && <DropdownMenuItem onSelect={() => setSetup(true)}><Settings2 /> {t('Set up the room')}</DropdownMenuItem>}
                <DropdownMenuItem asChild><Link to={`/pos/till/${data.register.id}`}><ReceiptText /> {t('Till and shift')}</Link></DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : (
        <div className="ml-auto flex items-center gap-1.5">
          {!tabId && <Button variant="outline" size="sm" onClick={takeaway}><ShoppingBag /> {t('Takeaway')}</Button>}
          <Button variant="ghost" size="sm" asChild><a href={`/pos/kitchen/${data.register.warehouse_id}`} target="_blank" rel="noreferrer"><ChefHat /> {t('Kitchen screen')}</a></Button>
          <Button variant="ghost" size="sm" aria-pressed={kitchenPrint} onClick={toggleTickets}
            title={t('Print a kitchen ticket when items are sent')}><Printer /> {kitchenPrint ? t('Tickets on') : t('Tickets off')}</Button>
          {can('pos.approve') && <Button variant="ghost" size="sm" onClick={() => setSetup(true)}><Settings2 /> {t('Set up the room')}</Button>}
          <Button variant="outline" size="sm" asChild><Link to={`/pos/till/${data.register.id}`}>{t('Till and shift')}</Link></Button>
        </div>
        )}
      </header>
      {phone && areaNav}
      <OfflineBanner />

      {tabId
        ? <TabScreen key={tabId} data={data} tabId={tabId} floor={floor.data} kitchenPrint={kitchenPrint} onClose={() => setTabId(null)} onMoved={setTabId} cashier={cashier} />
        : <FloorView floor={floor.data} loading={floor.isLoading || (!floor.data && floor.fetchStatus === 'paused')} areaId={current?.id} onOpen={(table) => void open(table)} onOpenTab={setTabId}
            onSetup={can('pos.approve') ? () => setSetup(true) : undefined} />}
      {setup && <RoomSetupDialog warehouseId={data.register.warehouse_id} onClose={() => setSetup(false)} />}
    </div>
  )
}

/* ------------------------------------------------------------------ floor */
function FloorView({ floor, loading, areaId, onOpen, onOpenTab, onSetup }: {
  floor: Floor | undefined; loading: boolean; areaId: string | undefined; onOpen: (table: string) => void; onOpenTab: (id: string) => void; onSetup?: () => void
}) {
  const phone = usePhone()
  // on a phone the plan is too small to tap: the list comes first
  const [view, setView] = React.useState<'map' | 'list'>(() => (prefGet(phone ? 'pos.floorview.phone' : 'pos.floorview', phone ? 'list' : 'map') === 'list' ? 'list' : 'map'))
  React.useEffect(() => { prefSet(phone ? 'pos.floorview.phone' : 'pos.floorview', view) }, [view, phone])
  if (loading) return <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 p-4">{Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="h-32" />)}</div>
  const area = floor?.areas.find((a) => a.id === areaId)
  const byTable = new Map((floor?.orders ?? []).filter((o) => o.table_id).map((o) => [o.table_id!, o]))
  const takeaway = (floor?.orders ?? []).filter((o) => !o.table_id)
  if (!floor?.areas.length) return (
    <Centered>
      <Users className="mx-auto size-8 text-muted-foreground" />
      <h1 className="mt-3 text-lg font-semibold">{t('No tables yet')}</h1>
      <p className="mt-1 text-[13px] text-muted-foreground">{t('Add the rooms of this place and their tables, and where the kitchen and the bar receive orders.')}</p>
      {onSetup ? <Button className="mt-4" onClick={onSetup}><Settings2 /> {t('Set up the room')}</Button> : <p className="mt-3 text-[13px]">{t('Ask a manager to set up the room.')}</p>}
    </Centered>
  )
  const placed = (area?.tables ?? []).filter((tb) => tb.x != null && tb.y != null)
  const showMap = placed.length > 0 && view === 'map'
  const loose = showMap ? (area?.tables ?? []).filter((tb) => !placed.includes(tb)) : area?.tables ?? []
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
      {placed.length > 0 && (
        <div className="mb-3 flex justify-end gap-1" role="group" aria-label={t('How the tables are shown')}>
          <Button size="sm" variant={view === 'map' ? 'default' : 'outline'} onClick={() => setView('map')}>{t('Floor plan')}</Button>
          <Button size="sm" variant={view === 'list' ? 'default' : 'outline'} onClick={() => setView('list')}>{t('List')}</Button>
        </div>
      )}
      {showMap && (
        <div className="relative mx-auto mb-4 aspect-[16/10] w-full max-w-6xl rounded-xl border bg-[radial-gradient(circle,hsl(var(--border))_1px,transparent_1px)] [background-size:20px_20px]">
          {placed.map((tb) => {
            const o = byTable.get(tb.id)
            const box = tableBox(tb)
            return (
              <button key={tb.id} type="button" onClick={() => (o ? onOpenTab(o.id) : onOpen(tb.id))}
                style={{ left: `${tb.x}%`, top: `${tb.y}%`, width: `${box.w}%`, height: `${box.h}%` }}
                className={cn('absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center overflow-hidden border-2 px-1 text-center leading-tight transition-colors',
                  tb.shape === 'round' ? 'rounded-full' : 'rounded-lg',
                  o ? (o.ready > 0 ? 'border-success bg-success/10' : o.new > 0 ? 'border-warning bg-warning/10' : 'border-primary bg-primary/10') : 'border-dashed border-foreground/30 bg-card hover:border-primary/60')}
                aria-label={o ? t('Table {name}, {amount}', { name: tb.name, amount: formatMoney(o.total) }) : t('Table {name}, free', { name: tb.name })}>
                <span className="text-sm font-semibold sm:text-base">{tb.name}</span>
                {o && <span className="text-[11px] font-medium tabular sm:text-xs">{formatMoney(o.total)}</span>}
                {o && <span className="hidden text-[10px] text-muted-foreground sm:block">{ago(o.opened_at)}</span>}
              </button>
            )
          })}
        </div>
      )}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 max-sm:grid-cols-2 max-sm:gap-2">
        {loose.map((tb) => {
          const o = byTable.get(tb.id)
          return (
            <button key={tb.id} type="button" onClick={() => (o ? onOpenTab(o.id) : onOpen(tb.id))}
              className={cn('flex h-32 flex-col justify-between rounded-xl border-2 p-3 text-left max-sm:h-28 transition-[border-color,transform] active:scale-[0.98]',
                o ? 'border-primary/40 bg-primary/5 hover:border-primary' : 'border-dashed bg-card hover:border-primary/50')}>
              <div className="flex items-start justify-between gap-2">
                <span className="text-xl font-semibold tracking-[-0.01em]">{tb.name}</span>
                <span className="flex items-center gap-1 text-xs text-muted-foreground"><Users className="size-3.5" />{o ? o.guests : tb.seats}</span>
              </div>
              {o ? <TableStatus o={o} /> : <span className="text-[13px] text-muted-foreground">{t('Free')}</span>}
            </button>
          )
        })}
      </div>
      {takeaway.length > 0 && (
        <>
          <h2 className="mb-2 mt-6 text-sm font-semibold">{t('Takeaway and bar orders')}</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3 max-sm:grid-cols-2 max-sm:gap-2">
            {takeaway.map((o) => (
              <button key={o.id} type="button" onClick={() => onOpenTab(o.id)} className="flex h-28 flex-col justify-between rounded-xl border-2 border-primary/40 bg-primary/5 p-3 text-left hover:border-primary">
                <span className="truncate text-base font-semibold">{o.label || o.number}</span>
                <TableStatus o={o} />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
function TableStatus({ o }: { o: FloorOrder }) {
  return (
    <div className="grid gap-1">
      <span className="text-lg font-semibold tabular">{formatMoney(o.total)}</span>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
        <span>{ago(o.opened_at)}</span>
        {o.waiter && <span className="truncate">{o.waiter.split(' ')[0]}</span>}
        {o.new > 0 && <span className="font-medium text-warning">{tn(o.new, '{n} not sent', '{n} not sent')}</span>}
        {o.ready > 0 && <span className="font-medium text-success">{tn(o.ready, '{n} ready', '{n} ready')}</span>}
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------ one order */
function TabScreen({ data, tabId, floor, kitchenPrint, onClose, onMoved, cashier }: {
  data: TillData; tabId: string; floor: Floor | undefined; kitchenPrint: boolean; onClose: () => void; onMoved: (id: string) => void; cashier: string
}) {
  const { can } = useCompany()
  const tab = useTab(tabId)
  const add = useAddItems()
  const send = useSend()
  const change = useChangeLine()
  const voidLine = useVoidLine()
  const guests = useSetGuests()
  const closeEmpty = useCloseEmpty()
  const [drafts, setDrafts] = React.useState<Draft[]>([])
  const [query, setQuery] = React.useState('')
  const [category, setCategory] = React.useState('__all')
  const [dialog, setDialog] = React.useState<null | 'pay' | 'move' | { note: string } | { void: TabLine }>(null)
  const [busy, setBusy] = React.useState(false)
  const cur = data.company.base_currency
  const phone = usePhone()
  // on a phone: the menu fills the screen, the order is its own screen
  const [pane, setPane] = React.useState<'menu' | 'order'>('menu')

  const categories = React.useMemo(() => [...new Set(data.catalog.map((c) => c.category).filter(Boolean))].sort() as string[], [data.catalog])
  const visible = React.useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return data.catalog.filter((c) => (category === '__all' || c.category === category) && words.every((w) => c.name.toLowerCase().includes(w) || c.sku.toLowerCase().includes(w)))
  }, [data.catalog, query, category])

  const addDraft = (c: CatalogItem) => setDrafts((ds) => {
    const i = ds.findIndex((d) => d.variant_id === c.variant_id && !d.note)
    if (i >= 0) { const n = [...ds]; n[i] = { ...n[i]!, quantity: n[i]!.quantity + 1 }; return n }
    return [...ds, { key: crypto.randomUUID(), variant_id: c.variant_id, name: c.name, price: c.price, quantity: 1, note: '' }]
  })
  const lines = tab.data?.lines ?? []
  const open = lines.filter((l) => l.status !== 'void' && !l.paid)
  const due = r2(open.reduce((s, l) => s + lineSum(l), 0) + drafts.reduce((s, d) => s + r2(d.quantity * d.price), 0))
  const paidSum = r2(lines.filter((l) => l.paid).reduce((s, l) => s + lineSum(l), 0))

  /** drafts → order → kitchen; returns false when nothing could be sent */
  const sendAll = async () => {
    if (busy) return false
    setBusy(true)
    try {
      if (drafts.length) await add.mutateAsync({ tab: tabId, items: drafts.map((d) => ({ variant_id: d.variant_id, quantity: d.quantity, note: d.note || null, name: d.name, price: d.price })) })
      setDrafts([])
      const res = await send.mutateAsync(tabId)
      if (res.tickets.length) {
        toast.success(tn(res.tickets.reduce((s, x) => s + x.lines.length, 0), '{n} item sent', '{n} items sent'))
        if (kitchenPrint) printKitchen(res)
      }
      return true
    } catch { return false } finally { setBusy(false) }
  }
  const leave = async () => {
    if (drafts.length && !confirm(t('Send the new items before leaving? Cancel keeps you on this order.'))) return
    if (drafts.length && !(await sendAll())) return
    onClose()
  }

  if (tab.isLoading) return <div className="flex flex-1 gap-4 p-4"><Skeleton className="flex-1" /><Skeleton className="w-[420px] max-sm:hidden" /></div>
  if (!tab.data) return <Centered><p className="text-[13px] text-muted-foreground">{tab.fetchStatus === 'paused' ? t('This order is not on this device yet. It opens when the connection is back.') : t('This order is closed.')}</p><Button className="mt-3" onClick={onClose}>{t('Back to the floor')}</Button></Centered>
  const o = tab.data
  const title = o.table ? t('Table {name}', { name: o.table }) : o.label || o.number
  const newCount = drafts.reduce((s, d) => s + d.quantity, 0)
  const unsent = drafts.length > 0 || open.some((l) => l.status === 'new')

  return (
    <div className="flex min-h-0 flex-1">
      {/* catalog */}
      <section className={cn('flex min-w-0 flex-1 flex-col gap-3 p-3', phone && pane === 'order' && 'hidden')}>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Search the menu')} aria-label={t('Search the menu')}
            className="h-12 w-full rounded-xl border-2 bg-card pl-11 pr-4 text-base outline-none focus:border-primary focus:ring-4 focus:ring-primary/15" />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {['__all', ...categories].map((c) => (
            <button key={c} type="button" onClick={() => setCategory(c)}
              className={cn('h-10 shrink-0 rounded-full border px-4 text-[13px] font-medium', category === c ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-muted')}>
              {c === '__all' ? t('Everything') : td(c)}
            </button>
          ))}
        </div>
        <div className="grid min-h-0 flex-1 auto-rows-[88px] grid-cols-[repeat(auto-fill,minmax(140px,1fr))] content-start gap-2 overflow-y-auto pr-1 max-sm:auto-rows-[80px] max-sm:grid-cols-3 max-sm:pr-0">
          {visible.slice(0, 160).map((c) => (
            <button key={c.variant_id} type="button" onClick={() => addDraft(c)}
              className="flex flex-col justify-between rounded-lg border bg-card p-2.5 text-left transition-[border-color,transform] hover:border-primary/50 active:scale-[0.98]">
              <span className="line-clamp-2 text-[13px] font-medium leading-tight">{c.name}</span>
              <span className="text-base font-semibold tabular">{formatMoney(c.price)}</span>
            </button>
          ))}
        </div>
        {phone && (
          <div className="-mx-3 -mb-3 grid grid-cols-[1fr_auto] gap-2 border-t bg-card p-3">
            <Button variant="outline" className="h-14 justify-between" onClick={() => setPane('order')}>
              <span className="flex items-center gap-2"><ListOrdered /> {title}{newCount > 0 && <span className="rounded-full bg-warning px-2 text-xs font-semibold text-warning-foreground">+{newCount}</span>}</span>
              <span className="text-base font-semibold tabular">{formatMoney(due)}</span>
            </Button>
            <Button className="h-14 px-5" loading={busy} disabled={!unsent} variant={unsent ? 'default' : 'secondary'} onClick={() => void sendAll()}><Send /> {t('Send')}</Button>
          </div>
        )}
      </section>

      {/* the order */}
      <aside className={cn('flex shrink-0 flex-col bg-card', phone ? (pane === 'order' ? 'w-full' : 'hidden') : 'w-[400px] border-l xl:w-[440px]')}>
        <div className="flex items-center gap-3 border-b px-4 py-3">
          {phone && <Button variant="outline" size="icon" aria-label={t('Add from the menu')} onClick={() => setPane('menu')}><Plus /></Button>}
          <div className="min-w-0 flex-1">
            <div className="truncate text-lg font-semibold">{title}</div>
            <div className="truncate text-xs text-muted-foreground">{o.number} · {o.waiter || cashier} · {ago(o.opened_at)}</div>
          </div>
          <div className="flex items-center gap-1" aria-label={t('Guests')}>
            <Button size="icon" variant="outline" className="size-8" aria-label={t('One guest less')} onClick={() => guests.mutate({ tab: tabId, guests: Math.max(1, o.guests - 1) })}><Minus /></Button>
            <span className="flex w-10 items-center justify-center gap-1 text-sm font-semibold tabular"><Users className="size-3.5 text-muted-foreground" />{o.guests}</span>
            <Button size="icon" variant="outline" className="size-8" aria-label={t('One guest more')} onClick={() => guests.mutate({ tab: tabId, guests: o.guests + 1 })}><Plus /></Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {!lines.length && !drafts.length && <p className="p-8 text-center text-[13px] text-muted-foreground">{t('Tap the menu to add what the table orders.')}</p>}
          {drafts.length > 0 && (
            <div className="border-b bg-warning/5">
              <div className="px-4 pt-2 text-xs font-medium text-warning">{t('New, not sent yet')}</div>
              {drafts.map((d) => (
                <div key={d.key} className="grid grid-cols-[1fr_auto] gap-x-3 px-4 py-2">
                  <div className="min-w-0"><div className="truncate text-[13px] font-medium">{d.name}</div>
                    {d.note && <div className="truncate text-xs text-primary">» {d.note}</div>}</div>
                  <div className="text-right text-[15px] font-semibold tabular">{formatMoney(r2(d.quantity * d.price))}</div>
                  <div className="col-span-2 mt-1.5 flex items-center gap-1.5">
                    <Button size="icon" variant="outline" className="size-9" aria-label={t('One less')} onClick={() => setDrafts((ds) => ds.map((x) => (x.key === d.key ? { ...x, quantity: x.quantity - 1 } : x)).filter((x) => x.quantity > 0))}><Minus /></Button>
                    <span className="w-8 text-center text-sm font-semibold tabular">{d.quantity}</span>
                    <Button size="icon" variant="outline" className="size-9" aria-label={t('One more')} onClick={() => setDrafts((ds) => ds.map((x) => (x.key === d.key ? { ...x, quantity: x.quantity + 1 } : x)))}><Plus /></Button>
                    <Button size="sm" variant="ghost" onClick={() => setDialog({ note: d.key })}><NotebookPen /> {d.note ? t('Change note') : t('Note')}</Button>
                    <Button size="icon" variant="ghost" className="ml-auto size-9 text-destructive" aria-label={t('Remove line')} onClick={() => setDrafts((ds) => ds.filter((x) => x.key !== d.key))}><Trash2 /></Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {lines.map((l) => (
            <div key={l.id} className={cn('grid grid-cols-[1fr_auto] gap-x-3 border-b px-4 py-2', (l.paid || l.status === 'void') && 'opacity-50')}>
              <div className="min-w-0">
                <div className={cn('truncate text-[13px] font-medium', l.status === 'void' && 'line-through')}>{num(l.quantity)} × {l.name}</div>
                <div className="flex flex-wrap items-center gap-x-2 text-xs">
                  {l.note && <span className="text-primary">» {l.note}</span>}
                  <LineChip line={l} />
                </div>
              </div>
              <div className="flex items-start gap-1">
                <span className="text-right text-[15px] font-semibold tabular">{formatMoney(lineSum(l))}</span>
                {!l.paid && l.status !== 'void' && (l.status === 'new' || can('pos.approve')) && (
                  <button type="button" className="mt-0.5 text-muted-foreground hover:text-destructive" aria-label={t('Cancel {item}', { item: l.name })}
                    onClick={() => (l.status === 'new' ? change.mutate({ line: l.id, quantity: 0 }) : setDialog({ void: l }))}><X className="size-4" /></button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t px-4 py-3">
          {paidSum > 0 && <div className="flex justify-between text-[13px] text-muted-foreground"><span>{t('Paid already')}</span><span className="tabular">{formatMoney(paidSum)}</span></div>}
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-sm font-medium">{t('To pay')}</span>
            <span className="text-[30px] font-semibold leading-none tracking-[-0.02em] tabular">{formatMoney(due)} <span className="text-sm font-normal text-muted-foreground">{cur}</span></span>
          </div>
          {o.guests > 1 && due > 0 && <div className="text-right text-xs text-muted-foreground">{t('Per guest {amount}', { amount: formatMoney(due / o.guests) })}</div>}
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Button variant="outline" onClick={() => setDialog('move')}><ArrowRightLeft /> {t('Move')}</Button>
            <Button variant="outline" disabled={!open.length} onClick={() => printBill(data.company, o)}><ReceiptText /> {t('Print the bill')}</Button>
            {!open.length && !drafts.length
              ? <Button variant="outline" loading={closeEmpty.isPending} onClick={() => closeEmpty.mutate(tabId, { onSuccess: onClose })}><Undo2 /> {t('Free the table')}</Button>
              : <Button variant="outline" onClick={() => void leave()}>{t('Floor')}</Button>}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Button size="lg" variant={drafts.length || open.some((l) => l.status === 'new') ? 'default' : 'secondary'} className="h-14" loading={busy}
              disabled={!drafts.length && !open.some((l) => l.status === 'new')} onClick={() => void sendAll()}><Send /> {t('Send')}</Button>
            <Button size="lg" className="h-14" disabled={due <= 0 || busy} onClick={async () => { if (drafts.length && !(await sendAll())) return; setDialog('pay') }}>
              {t('Pay {amount}', { amount: formatMoney(due) })}</Button>
          </div>
        </div>
      </aside>

      {typeof dialog === 'object' && dialog && 'note' in dialog && (
        <NoteDialog initial={drafts.find((d) => d.key === dialog.note)?.note ?? ''} onClose={(v) => {
          if (v !== undefined) setDrafts((ds) => ds.map((d) => (d.key === dialog.note ? { ...d, note: v } : d)))
          setDialog(null)
        }} />
      )}
      {typeof dialog === 'object' && dialog && 'void' in dialog && (
        <VoidDialog line={dialog.void} onClose={() => setDialog(null)} onVoid={(reason) => voidLine.mutateAsync({ line: dialog.void.id, reason }).then(() => setDialog(null))} />
      )}
      {dialog === 'move' && <MoveDialog floor={floor} current={o.table_id} onClose={() => setDialog(null)} tabId={tabId} onMoved={(id) => { setDialog(null); onMoved(id) }} />}
      {dialog === 'pay' && tab.data && <PayTabDialog data={data} tab={tab.data} cashier={cashier} onClose={() => setDialog(null)} onClosedTab={onClose} />}
    </div>
  )
}

function LineChip({ line }: { line: TabLine }) {
  if (line.paid) return <span className="text-muted-foreground">{t('paid')}</span>
  const map: Record<string, [string, string]> = {
    new: [t('not sent'), 'text-warning'], sent: [t('in the kitchen · {time}', { time: ago(line.sent_at) }), 'text-muted-foreground'],
    ready: [t('ready'), 'font-medium text-success'], served: [t('served'), 'text-muted-foreground'], void: [t('cancelled'), 'text-destructive'],
  }
  const [label, cls] = map[line.status] ?? ['', '']
  return <span className={cls}>{label}</span>
}

function NoteDialog({ initial, onClose }: { initial: string; onClose: (v?: string) => void }) {
  const [v, setV] = React.useState(initial)
  const quick = [t('no sugar'), t('no ice'), t('medium'), t('well done'), t('takeaway'), t('allergy')]
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{t('Note for the kitchen')}</DialogTitle></DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); onClose(v.trim()) }}>
          <Input autoFocus value={v} onChange={(e) => setV(e.target.value)} maxLength={120} aria-label={t('Note for the kitchen')} />
          <div className="flex flex-wrap gap-1.5">{quick.map((q) => <Button key={q} type="button" size="sm" variant="outline" onClick={() => setV((x) => (x ? `${x}, ${q}` : q))}>{q}</Button>)}</div>
          <DialogFooter><Button type="button" variant="ghost" onClick={() => onClose()}>{t('Cancel')}</Button><Button type="submit">{t('Save')}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function VoidDialog({ line, onClose, onVoid }: { line: TabLine; onClose: () => void; onVoid: (reason: string) => Promise<void> }) {
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{t('Cancel {item}', { item: line.name })}</DialogTitle>
          <DialogDescription>{t('The kitchen has this item already. The reason stays in the order history.')}</DialogDescription></DialogHeader>
        <Input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('e.g. the guest changed their mind')} aria-label={t('Reason')} />
        <DialogFooter><Button variant="ghost" onClick={onClose} disabled={busy}>{t('Keep it')}</Button>
          <Button variant="destructive" loading={busy} disabled={!reason.trim()} onClick={async () => { setBusy(true); try { await onVoid(reason) } finally { setBusy(false) } }}>{t('Cancel the item')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function MoveDialog({ floor, current, tabId, onClose, onMoved }: { floor: Floor | undefined; current: string | null; tabId: string; onClose: () => void; onMoved: (id: string) => void }) {
  const move = useMoveTab()
  const busy = new Set((floor?.orders ?? []).map((o) => o.table_id).filter(Boolean))
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{t('Move to another table')}</DialogTitle>
          <DialogDescription>{t('Choosing a table that is taken joins the two orders into one bill.')}</DialogDescription></DialogHeader>
        <div className="grid max-h-[60dvh] gap-4 overflow-y-auto">
          {(floor?.areas ?? []).map((a) => (
            <div key={a.id}><div className="mb-1.5 text-xs font-medium text-muted-foreground">{a.name}</div>
              <div className="grid grid-cols-4 gap-2">
                {a.tables.filter((tb) => tb.id !== current).map((tb) => (
                  <Button key={tb.id} variant={busy.has(tb.id) ? 'secondary' : 'outline'} className="h-14 flex-col gap-0" disabled={move.isPending}
                    onClick={() => move.mutate({ tab: tabId, table: tb.id }, { onSuccess: (id) => { toast.success(busy.has(tb.id) ? t('Orders joined on {name}', { name: tb.name }) : t('Moved to {name}', { name: tb.name })); onMoved(id) } })}>
                    <span className="text-base font-semibold">{tb.name}</span>
                    <span className="text-[11px] font-normal text-muted-foreground">{busy.has(tb.id) ? t('join') : t('free')}</span>
                  </Button>
                ))}
              </div></div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ paying, all of it or some items */
type CardState = { quote: Quote; redeem: boolean }
function PayTabDialog({ data, tab, cashier, onClose, onClosedTab }: { data: TillData; tab: Tab; cashier: string; onClose: () => void; onClosedTab: () => void }) {
  const pay = usePayTab()
  const open = tab.lines.filter((l) => l.status !== 'void' && !l.paid)
  const [qty, setQty] = React.useState<Record<string, number>>(() => Object.fromEntries(open.map((l) => [l.id, num(l.quantity)])))
  const [step, setStep] = React.useState<'choose' | 'pay'>('choose')
  const [cardCode, setCardCode] = React.useState('')
  const [card, setCard] = React.useState<CardState | null>(null)
  const [cardBusy, setCardBusy] = React.useState(false)
  const [cardError, setCardError] = React.useState<string | null>(null)
  const [manual, setManual] = React.useState('')
  const chosen = open.filter((l) => (qty[l.id] ?? 0) > 0)
  const everything = open.every((l) => (qty[l.id] ?? 0) === num(l.quantity))
  const manualPct = card ? 0 : Math.min(Math.max(num(manual), 0), 100)

  // the card's price for what is paid now (asked again when the choice changes)
  const quoteFor = React.useCallback(async (code: string, redeem: boolean, lines = chosen) => {
    const ql = lines.map((l) => ({ variant_id: l.variant_id, quantity: qty[l.id] ?? 0, unit_price: num(l.unit_price), manual_pct: 0 }))
    let q = await quoteLoyalty(data.register.id, code, ql, 0)
    if (q.usable && redeem && num(q.points_balance) > 0) q = await quoteLoyalty(data.register.id, code, ql, num(q.points_balance))
    return q
  }, [chosen, qty, data.register.id])
  const chosenKey = chosen.map((l) => `${l.id}:${qty[l.id]}`).join(',')
  React.useEffect(() => {
    if (!card) return
    let live = true
    void quoteFor(card.quote.card_number, card.redeem).then((q) => { if (live) setCard((c) => (c ? { ...c, quote: q } : c)) }).catch(() => {})
    return () => { live = false }
  }, [chosenKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const applyCard = async (redeem = false, code = card?.quote.card_number ?? cardCode) => {
    if (!code.trim()) return
    setCardBusy(true); setCardError(null)
    try {
      const q = await quoteFor(code.trim(), redeem)
      if (!q.usable) { setCardError(t(q.reason ?? 'This card cannot be used')); setCard(null) }
      else {
        setCard({ quote: q, redeem })
        if (redeem && !(q.redeem_points > 0)) setCardError(t('Not enough points to spend on this sale (at least {n})', { n: q.min_redeem_points }))
      }
    } catch (e) { setCardError(navigator.onLine ? describeError(e) : t('The card needs internet')) } finally { setCardBusy(false) }
  }

  const pctOf = (_l: TabLine, i: number) => (card ? num(card.quote.lines[i]?.pct) : manualPct)
  const gross = (l: TabLine) => r2((qty[l.id] ?? 0) * num(l.unit_price))
  const net = (l: TabLine, i: number) => r2(gross(l) * (1 - pctOf(l, i) / 100))
  const total = r2(chosen.reduce((s, l, i) => s + net(l, i), 0))
  const discount = r2(chosen.reduce((s, l, i) => s + gross(l) - net(l, i), 0))

  const paid = async (tenders: Tender[]) => {
    const client_uuid = crypto.randomUUID()
    const device_ref = await nextDeviceRef(data.register.code)
    const res = await pay.mutateAsync({
      tab_id: tab.id, session_id: data.session!.id, client_uuid, device_ref, payments: tenders.map((x) => ({ method: x.method, amount: x.amount })),
      split: everything ? undefined : chosen.map((l) => ({ line_id: l.id, quantity: qty[l.id]! })),
      discounts: chosen.map((l, i) => ({ line_id: l.id, variant_id: l.variant_id, discount_pct: pctOf(l, i), manual_pct: card ? 0 : manualPct })).filter((d) => d.discount_pct > 0),
      loyalty: card ? { card_id: card.quote.card_id, redeem_points: card.redeem ? num(card.quote.redeem_points) : 0 } : null,
      total,
    })
    const earned = card && card.quote.kind === 'points' ? Math.floor(total * num(card.quote.points_per_unit)) : 0
    const spent = card?.redeem ? num(card.quote.redeem_points) : 0
    const receipt: ReceiptData = {
      company: data.company, register: data.register, ref: device_ref, number: res.number, date: new Date(), cashier,
      customer: tab.table ? t('Table {name}', { name: tab.table }) : tab.label, currency: data.company.base_currency,
      lines: chosen.map((l, i) => ({ name: l.name, qty: qty[l.id]!, price: num(l.unit_price), discount: pctOf(l, i), total: net(l, i), rate: data.catalog.find((c) => c.variant_id === l.variant_id)?.tax_rate ?? 0 })),
      payments: tenders.map((x) => ({ method: x.method, amount: x.amount })), change: num(res.change),
      loyalty: card ? { holder: card.quote.holder_name, number: card.quote.card_number, discount: discount, redeemed: spent || undefined, earned: earned || undefined,
                        balance: card.quote.kind === 'points' ? num(card.quote.points_balance) - spent + earned : undefined } : null,
    }
    if (tenders.some((x) => x.method === 'cash')) openCashDrawer()
    printReceipt(receipt)
    toast.success(num(res.change) > 0 ? t('Paid · change {amount}', { amount: formatMoney(res.change) }) : t('Paid'),
      res.offline ? { description: t('Saved on this device; it is sent when the connection is back.') } : undefined)
    onClose()
    if (res.closed) onClosedTab()
  }

  if (step === 'pay') return <PayDialog total={total} currency={data.company.base_currency} onCancel={() => setStep('choose')} onPaid={paid} />
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{t('What is paid now?')}</DialogTitle>
          <DialogDescription>{t('Everything is ticked. To split the bill, untick or lower what another guest pays.')}</DialogDescription></DialogHeader>
        <div className="max-h-[40dvh] overflow-y-auto rounded-md border">
          {open.map((l) => {
            const q = qty[l.id] ?? 0
            const ci = chosen.indexOf(l)
            const pct = ci >= 0 ? pctOf(l, ci) : 0
            return (
              <div key={l.id} className="flex items-center gap-3 border-b px-3 py-2 last:border-0">
                <Checkbox checked={q > 0} onCheckedChange={(on) => setQty((s) => ({ ...s, [l.id]: on ? num(l.quantity) : 0 }))} aria-label={l.name} />
                <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-medium">{l.name}</div>
                  <div className="text-xs text-muted-foreground tabular">{formatMoney(l.unit_price)}{pct > 0 && <span className="text-success"> · −{pct}%</span>}</div></div>
                {num(l.quantity) > 1 && (
                  <div className="flex items-center gap-1">
                    <Button size="icon" variant="outline" className="size-8" aria-label={t('One less')} onClick={() => setQty((s) => ({ ...s, [l.id]: Math.max(0, q - 1) }))}><Minus /></Button>
                    <span className="w-12 text-center text-sm tabular">{q}/{num(l.quantity)}</span>
                    <Button size="icon" variant="outline" className="size-8" aria-label={t('One more')} onClick={() => setQty((s) => ({ ...s, [l.id]: Math.min(num(l.quantity), q + 1) }))}><Plus /></Button>
                  </div>
                )}
                <span className="w-20 text-right text-[13px] font-semibold tabular">{formatMoney(ci >= 0 ? net(l, ci) : 0)}</span>
              </div>
            )
          })}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setQty(Object.fromEntries(open.map((l) => [l.id, num(l.quantity)])))}>{t('All')}</Button>
          <Button variant="outline" size="sm" onClick={() => setQty(Object.fromEntries(open.map((l) => [l.id, 0])))}>{t('None')}</Button>
        </div>

        {/* discount card, or a discount given by hand */}
        <div className="grid gap-2 rounded-md border p-3">
          {card ? (
            <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
              <span><CreditCard className="mr-1 inline size-4 text-muted-foreground" /><b>{card.quote.holder_name}</b> · {card.quote.kind === 'points'
                ? tn(num(card.quote.points_balance), '{n} point', '{n} points') : t('{pct}% off', { pct: num(card.quote.program_pct) })}</span>
              <span className="flex gap-1.5">
                {card.quote.kind === 'points' && num(card.quote.points_balance) > 0 && (
                  <Button size="sm" variant={card.redeem ? 'default' : 'outline'} loading={cardBusy} onClick={() => void applyCard(!card.redeem)}>
                    {card.redeem && card.quote.redeem_points > 0 ? t('{n} points: −{amount}', { n: card.quote.redeem_points, amount: formatMoney(card.quote.redeem_amount) }) : t('Spend points')}
                  </Button>)}
                <Button size="sm" variant="ghost" onClick={() => { setCard(null); setCardCode(''); setCardError(null) }}>{t('Remove the card')}</Button>
              </span>
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-[1fr_auto_120px]">
              <Input value={cardCode} onChange={(e) => setCardCode(e.target.value)} placeholder={t('Discount card or phone')} aria-label={t('Discount card or phone')}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void applyCard() } }} />
              <Button variant="outline" loading={cardBusy} disabled={!cardCode.trim()} onClick={() => void applyCard()}><CreditCard /> {t('Apply')}</Button>
              <div className="relative">
                <Input type="number" min="0" max="100" step="any" value={manual} onChange={(e) => setManual(e.target.value)} placeholder={t('Discount')} aria-label={t('Discount in percent')} className="pr-7 text-right" />
                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
              </div>
            </div>
          )}
          {cardError && <p className="text-[13px] text-destructive">{cardError}</p>}
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <span className="text-sm">{everything ? t('Whole bill') : t('Part of the bill')} · <b className="tabular">{formatMoney(total)}</b>
            {discount > 0 && <span className="text-success"> ({t('{amount} off', { amount: formatMoney(discount) })})</span>}</span>
          <Button size="lg" disabled={total <= 0} onClick={() => setStep('pay')}>{t('Pay {amount}', { amount: formatMoney(total) })}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
