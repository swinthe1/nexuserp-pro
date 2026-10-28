import {
  ArrowLeft, Banknote, Check, ChevronRight, CircleAlert, CloudOff, DoorClosed, MapPin, MessageCircle, Minus, Navigation, Phone, Plus,
  RefreshCw, Search, Send, ShoppingBag, Store, Wallet, X,
} from 'lucide-react'
import * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { msg, t, tn, tServer } from '@/i18n'
import { describeError } from '@/lib/errors'
import { discard, retry, useOutbox } from '@/lib/offline/outbox'
import { cn, formatDate, formatMoney, formatQty, num } from '@/lib/utils'
import {
  type AgentBoot, type AgentCustomer, type AgentItem, estimatePrice, locate, type Outcome, useAgentBoot, useAgentSend, useItems,
  useRefreshOnSent, useWaiting, waitingArgs,
} from './api'

const WEEKDAYS = [msg('Monday'), msg('Tuesday'), msg('Wednesday'), msg('Thursday'), msg('Friday'), msg('Saturday'), msg('Sunday')]
const OUTCOME: Record<Outcome, string> = {
  order: msg('Order'), payment: msg('Collected|cash'), no_order: msg('No order today'), closed: msg('Closed'), other: msg('Visit note'),
}

type View = { c?: string; v?: 'order' }

/** The field agent's phone: today's route, the customer's debt, orders and cash collected — also without internet. */
export function AgentPage() {
  const boot = useAgentBoot()
  useRefreshOnSent()
  const [params, setParams] = useSearchParams()
  const view: View = { c: params.get('c') ?? undefined, v: params.get('v') === 'order' ? 'order' : undefined }
  const go = (v: View) => {
    const p = new URLSearchParams()
    if (v.c) p.set('c', v.c)
    if (v.v) p.set('v', v.v)
    setParams(p)
    window.scrollTo({ top: 0 })
  }

  if (boot.isPending) return <div className="mx-auto grid max-w-xl gap-3"><Skeleton className="h-28" /><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
  if (boot.isError) {
    if (/not set up as a field agent/i.test(describeError(boot.error)) || /not set up as a field agent/i.test(String((boot.error as Error)?.message))) {
      return <EmptyState icon={Store} title={t('You are not set up as a field agent')}
        description={t('The sales manager sets agents up in Sales › Field agents: the warehouse you sell from, your cash bag and your route.')} />
    }
    return <ErrorState error={boot.error} onRetry={() => void boot.refetch()} />
  }
  const b = boot.data
  const customer = view.c ? b.customers.find((c) => c.id === view.c) : undefined
  if (view.c && !customer) return <EmptyState title={t('Customer not found')} action={<Button onClick={() => go({})}>{t('Back to the route')}</Button>} />

  return (
    <div className="mx-auto max-w-xl pb-28">
      {customer && view.v === 'order' ? <OrderScreen boot={b} customer={customer} onBack={() => go({ c: customer.id })} onDone={() => go({ c: customer.id })} />
        : customer ? <CustomerScreen boot={b} customer={customer} onBack={() => go({})} onOrder={() => go({ c: customer.id, v: 'order' })} />
        : <RouteScreen boot={b} refreshing={boot.isFetching} onRefresh={() => void boot.refetch()} onOpen={(id) => go({ c: id })} />}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------------------------
function RouteScreen({ boot, refreshing, onRefresh, onOpen }: { boot: AgentBoot; refreshing: boolean; onRefresh: () => void; onOpen: (id: string) => void }) {
  const { company } = useCompany()
  const waiting = useWaiting()
  const [tab, setTab] = React.useState<'route' | 'all'>('route')
  const [q, setQ] = React.useState('')
  const byId = React.useMemo(() => new Map(boot.customers.map((c) => [c.id, c])), [boot.customers])
  const route = boot.route.filter(([d]) => d === boot.weekday).sort((a, b) => a[2] - b[2]).map(([, id]) => byId.get(id)).filter(Boolean) as AgentCustomer[]
  const seen = new Set([...boot.day.visits.map((v) => v.partner_id), ...waiting.map((w) => String(waitingArgs(w).partner_id))])
  const done = route.filter((c) => seen.has(c.id)).length
  const ordered = boot.day.orders.length + waiting.filter((w) => w.fn === 'agent_order_submit').length
  const collected = boot.day.payments.filter((p) => p.status === 'posted').reduce((s, p) => s + num(p.amount), 0)
  const collectedWaiting = waiting.filter((w) => w.fn === 'agent_payment_submit').reduce((s, w) => s + num(waitingArgs(w).amount), 0)
  const cur = boot.currency ?? company?.base_currency
  const term = q.trim().toLowerCase()
  const list = tab === 'route' && !term ? route
    : boot.customers.filter((c) => !term || c.name.toLowerCase().includes(term) || (c.code ?? '').toLowerCase().includes(term) || (c.address?.city ?? '').toLowerCase().includes(term))

  return (
    <>
      <div className="mb-3 rounded-2xl bg-primary p-4 text-primary-foreground">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm opacity-80">{t(WEEKDAYS[boot.weekday - 1])} · {formatDate(boot.today)}</p>
            <p className="mt-0.5 text-2xl font-semibold">{route.length ? t('{done} of {n} visited', { done, n: route.length }) : t('No route for today')}</p>
          </div>
          <Button size="icon" variant="ghost" className="text-primary-foreground hover:bg-white/15 hover:text-primary-foreground" aria-label={t('Refresh')} onClick={onRefresh}>
            <RefreshCw className={cn(refreshing && 'animate-spin')} />
          </Button>
        </div>
        {route.length > 0 && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/25"><div className="h-full rounded-full bg-white" style={{ width: `${(done / route.length) * 100}%` }} /></div>}
        <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
          <div><dt className="opacity-80">{t('Orders')}</dt><dd className="text-lg font-semibold tabular-nums">{ordered}</dd></div>
          <div><dt className="opacity-80">{t('Collected|cash')}</dt><dd className="text-lg font-semibold tabular-nums">{formatMoney(collected + collectedWaiting, cur, 0)}</dd></div>
          <div><dt className="opacity-80">{t('In your bag')}</dt><dd className="text-lg font-semibold tabular-nums">{boot.agent.safe_id ? formatMoney(num(boot.day.cash ?? boot.agent.cash) + collectedWaiting, cur, 0) : '—'}</dd></div>
        </dl>
      </div>

      <SyncStrip boot={boot} />

      <div className="sticky top-0 z-10 -mx-1 mb-2 bg-background/95 px-1 pb-2 pt-1 backdrop-blur">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search a customer')} className="h-11 pl-9" aria-label={t('Search a customer')} />
        </div>
        {!term && (
          <div className="mt-2 grid grid-cols-2 rounded-lg bg-muted p-1 text-sm">
            {(['route', 'all'] as const).map((k) => (
              <button key={k} type="button" onClick={() => setTab(k)} aria-pressed={tab === k}
                className={cn('rounded-md py-2 font-medium transition-colors', tab === k ? 'bg-background shadow-sm' : 'text-muted-foreground')}>
                {k === 'route' ? t('Today’s route ({n})', { n: route.length }) : t('All my customers ({n})', { n: boot.customers.length })}
              </button>
            ))}
          </div>
        )}
      </div>

      {list.length === 0 ? (
        <EmptyState compact icon={MapPin} title={term ? t('No customer matches') : tab === 'route' ? t('No visits planned for today') : t('No customers yet')}
          description={tab === 'route' && !term ? t('Your customers are under “All my customers”. The manager plans the route for each day.') : undefined} />
      ) : (
        <ol className="grid grid-cols-1 gap-2">
          {list.map((c, i) => <CustomerRow key={c.id} c={c} n={tab === 'route' && !term ? i + 1 : undefined} visited={seen.has(c.id)} onOpen={() => onOpen(c.id)} />)}
        </ol>
      )}
    </>
  )
}

const openTotal = (c: AgentCustomer) => c.open.reduce((s, i) => s + num(i.open), 0) - num(c.advance)
const overdueTotal = (c: AgentCustomer, today: string) => c.open.filter((i) => i.due && i.due < today).reduce((s, i) => s + num(i.open), 0)

function CustomerRow({ c, n, visited, onOpen }: { c: AgentCustomer; n?: number; visited: boolean; onOpen: () => void }) {
  const { company } = useCompany()
  const today = new Date().toISOString().slice(0, 10)
  const due = openTotal(c)
  const late = overdueTotal(c, today)
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring">
        <span className={cn('grid size-9 shrink-0 place-items-center rounded-full text-sm font-semibold',
          visited ? 'bg-emerald-600 text-white' : 'bg-muted text-muted-foreground')}>
          {visited ? <Check className="size-4" /> : n ?? c.name.slice(0, 1)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{c.name}</span>
          <span className="block truncate text-[13px] text-muted-foreground">{[c.address?.line1, c.address?.city].filter(Boolean).join(', ') || c.code}</span>
        </span>
        {due > 0 && (
          <span className="text-right">
            <span className={cn('block text-sm font-semibold tabular-nums', late > 0 && 'text-destructive')}>{formatMoney(due, company?.base_currency, 0)}</span>
            {late > 0 && <span className="block text-[11px] text-destructive">{t('overdue')}</span>}
          </span>
        )}
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </button>
    </li>
  )
}

/** What waits on the phone (and what the server refused). */
function SyncStrip({ boot, partner }: { boot: AgentBoot; partner?: string }) {
  const { companyId } = useCompany()
  const ob = useOutbox(companyId)
  const waiting = useWaiting().filter((w) => !partner || waitingArgs(w).partner_id === partner)
  const failed = waiting.filter((w) => w.status === 'failed')
  const pending = waiting.length - failed.length
  const old = Date.now() - new Date(boot.at).getTime() > 30 * 60_000
  if (!pending && !failed.length && ob.online !== false && !old) return null
  return (
    <div className="mb-3 grid gap-2">
      {(ob.online === false || old) && !partner && (
        <p className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-[13px] text-muted-foreground">
          <CloudOff className="size-4 shrink-0" />
          {ob.online === false ? t('No internet. You can keep working: what you do is kept on the phone and sent later.') : t('Data from {time}.', { time: formatDate(boot.at, true) })}
        </p>
      )}
      {pending > 0 && (
        <p className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[13px]">
          <RefreshCw className={cn('size-4 shrink-0', ob.syncing && 'animate-spin')} />
          {tn(pending, '{n} thing waits to be sent', '{n} things wait to be sent')}
        </p>
      )}
      {failed.map((f) => (
        <div key={f.id} className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-[13px]">
          <p className="flex items-start gap-2 font-medium"><CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />{f.label}</p>
          <p className="ml-6 text-muted-foreground">{f.error ? tServer(f.error) : t('Not accepted')}</p>
          <div className="ml-6 mt-1.5 flex gap-2">
            <Button size="sm" variant="outline" onClick={() => void retry(f.id)}>{t('Try again')}</Button>
            <Button size="sm" variant="ghost" onClick={() => { void discard(f.id); toast.success(t('Removed from the phone')) }}>{t('Remove')}</Button>
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// The customer
// ---------------------------------------------------------------------------------------------
function CustomerScreen({ boot, customer: c, onBack, onOrder }: { boot: AgentBoot; customer: AgentCustomer; onBack: () => void; onOrder: () => void }) {
  const cur = boot.currency
  const [collect, setCollect] = React.useState(false)
  const [note, setNote] = React.useState(false)
  const waiting = useWaiting().filter((w) => waitingArgs(w).partner_id === c.id)
  const due = openTotal(c)
  const late = overdueTotal(c, boot.today)
  const waitingCash = waiting.filter((w) => w.fn === 'agent_payment_submit' && w.status !== 'failed').reduce((s, w) => s + num(waitingArgs(w).amount), 0)
  const creditLeft = c.credit_limit != null ? num(c.credit_limit) - num(c.exposure) : null
  const today = [...boot.day.visits.filter((v) => v.partner_id === c.id && !['order', 'payment'].includes(v.outcome)).map((v) => ({ key: v.id, at: v.at, text: t(OUTCOME[v.outcome]), note: v.note })),
    ...boot.day.orders.filter((o) => o.partner_id === c.id).map((o) => ({ key: o.id, at: '', text: `${o.number} · ${formatMoney(o.total, o.currency)} ${t('with VAT')}`, note: o.status === 'draft' ? t('Waits for the manager') : null })),
    ...boot.day.payments.filter((p) => p.partner_id === c.id).map((p) => ({ key: p.id, at: '', text: `${p.number} · ${formatMoney(p.amount, p.currency)}`, note: t('Collected|cash') }))]
  const dest = c.address?.lat != null ? `${c.address.lat},${c.address.lng}` : [c.address?.line1, c.address?.city].filter(Boolean).join(', ')

  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <Button size="icon" variant="ghost" onClick={onBack} aria-label={t('Back to the route')}><ArrowLeft /></Button>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold">{c.name}</h1>
          <p className="truncate text-[13px] text-muted-foreground">{[c.code, c.tax_number].filter(Boolean).join(' · ')}</p>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <Button variant="outline" className="h-11" asChild disabled={!dest}>
          <a href={dest ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}` : undefined} target="_blank" rel="noreferrer"><Navigation /> {t('Directions')}</a>
        </Button>
        <Button variant="outline" className="h-11" asChild disabled={!c.phone}>
          <a href={c.phone ? `tel:${c.phone.replace(/\s/g, '')}` : undefined}><Phone /> {c.phone ? t('Call') : t('No phone')}</a>
        </Button>
      </div>
      {c.address && <p className="mb-3 flex items-start gap-2 text-[13px] text-muted-foreground"><MapPin className="mt-0.5 size-4 shrink-0" />{[c.address.line1, c.address.city].filter(Boolean).join(', ')}</p>}

      <SyncStrip boot={boot} partner={c.id} />

      <section className="mb-3 rounded-xl border bg-card p-4" aria-labelledby="debt-h">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="debt-h" className="text-sm text-muted-foreground">{due - waitingCash < 0 ? t('Paid in advance') : t('Owes (with VAT)')}</h2>
          <p className={cn('text-2xl font-semibold tabular-nums', late > 0 && 'text-destructive')}>{formatMoney(Math.abs(due - waitingCash), cur)}</p>
        </div>
        {late > 0 && <p className="mt-0.5 text-right text-[13px] text-destructive">{t('{amount} overdue', { amount: formatMoney(late, cur) })}</p>}
        {waitingCash > 0 && <p className="mt-0.5 text-right text-[13px] text-muted-foreground">{t('{amount} collected, waiting to be sent', { amount: formatMoney(waitingCash, cur) })}</p>}
        {creditLeft != null && (
          <p className={cn('mt-2 text-[13px]', creditLeft < 0 ? 'text-destructive' : 'text-muted-foreground')}>
            {creditLeft < 0 ? t('Over the credit limit by {amount}: a new order waits for the manager.', { amount: formatMoney(-creditLeft, cur) })
              : t('Can still buy on credit: {amount}', { amount: formatMoney(creditLeft, cur) })}
          </p>
        )}
        {c.open.length > 0 && (
          <ul className="mt-3 divide-y border-t text-[13px]">
            {c.open.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 py-2">
                <span><span className="font-medium">{i.number}</span> <span className="text-muted-foreground">· {formatDate(i.date)}</span></span>
                <span className={cn('tabular-nums', i.due && i.due < boot.today && 'text-destructive')}>
                  {formatMoney(i.open, i.currency)}{i.due && <span className="block text-right text-[11px] text-muted-foreground">{t('due {date}', { date: formatDate(i.due) })}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {today.length > 0 && (
        <section className="mb-3 rounded-xl border bg-card p-4">
          <h2 className="mb-2 text-sm text-muted-foreground">{t('Today')}</h2>
          <ul className="grid gap-1.5 text-[13px]">
            {today.map((x) => <li key={x.key} className="flex items-start gap-2"><Check className="mt-0.5 size-4 text-emerald-600" /><span>{x.text}{x.note && <span className="text-muted-foreground"> · {x.note}</span>}</span></li>)}
            {waiting.filter((w) => w.status !== 'failed').map((w) => <li key={w.id} className="flex items-start gap-2 text-muted-foreground"><RefreshCw className="mt-0.5 size-4" />{w.label}</li>)}
          </ul>
        </section>
      )}

      {c.orders.length > 0 && (
        <section className="mb-3 rounded-xl border bg-card p-4">
          <h2 className="mb-2 text-sm text-muted-foreground">{t('Last orders, with VAT')}</h2>
          <ul className="divide-y text-[13px]">
            {c.orders.map((o) => (
              <li key={o.id} className="flex justify-between gap-3 py-2"><span><span className="font-medium">{o.number}</span> <span className="text-muted-foreground">· {formatDate(o.date)}</span></span>
                <span className="tabular-nums">{formatMoney(o.total, o.currency)}</span></li>
            ))}
          </ul>
        </section>
      )}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 p-3 backdrop-blur" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        <div className="mx-auto grid max-w-xl grid-cols-[1fr_1fr_auto] gap-2">
          <Button className="h-12" onClick={onOrder}><ShoppingBag /> {t('New order')}</Button>
          <Button className="h-12" variant="outline" onClick={() => setCollect(true)} disabled={!boot.agent.safe_id} title={!boot.agent.safe_id ? t('You have no cash bag yet; ask the manager to set it') : undefined}>
            <Banknote /> {t('Collect')}
          </Button>
          <Button className="h-12" variant="outline" size="icon" aria-label={t('Visit without an order')} onClick={() => setNote(true)}><DoorClosed /></Button>
        </div>
      </div>
      {collect && <CollectDialog boot={boot} customer={c} owed={due - waitingCash} overdue={late} onClose={() => setCollect(false)} />}
      {note && <VisitDialog customer={c} onClose={() => setNote(false)} />}
    </>
  )
}

function VisitDialog({ customer: c, onClose }: { customer: AgentCustomer; onClose: () => void }) {
  const [outcome, setOutcome] = React.useState<Outcome>('no_order')
  const [text, setText] = React.useState('')
  const send = useAgentSend<{ id: string }>('agent_visit_log', () => t('Visit · {name}', { name: c.name }))
  const save = async () => {
    const fix = await locate()
    const r = await send.mutateAsync({ partner_id: c.id, outcome, note: text, set_location: !c.address?.lat, ...(fix ?? {}) })
    toast.success(r.offline ? t('Saved on the phone; it goes when there is internet') : t('Visit saved'))
    onClose()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Visit without an order')}</DialogTitle>
          <DialogDescription>{c.name}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {(['no_order', 'closed', 'other'] as const).map((k) => (
            <button key={k} type="button" onClick={() => setOutcome(k)} aria-pressed={outcome === k}
              className={cn('rounded-lg border px-3 py-3 text-left text-sm font-medium', outcome === k ? 'border-primary bg-primary/5' : 'hover:bg-muted')}>
              {t(OUTCOME[k])}
            </button>
          ))}
          <Label htmlFor="v-note" className="mt-1">{t('Note')}</Label>
          <Textarea id="v-note" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('e.g. the owner is back on Thursday')} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={send.isPending} onClick={() => void save()}>{t('Save the visit')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type PaymentAnswer = { id: string; number: string; amount: number; currency: string; balance: number; unallocated: number; cash: number }

function CollectDialog({ boot, customer: c, owed, overdue, onClose }: { boot: AgentBoot; customer: AgentCustomer; owed: number; overdue: number; onClose: () => void }) {
  const cur = boot.currency
  const [amount, setAmount] = React.useState(overdue > 0 ? String(Math.round(overdue * 100) / 100) : '')
  const [picked, setPicked] = React.useState<string[]>([])
  const [text, setText] = React.useState('')
  const [done, setDone] = React.useState<PaymentAnswer | { offline: true; amount: number } | null>(null)
  const send = useAgentSend<PaymentAnswer>('agent_payment_submit', (p) => t('Collected {amount} · {name}', { amount: formatMoney(num(p.amount), cur), name: c.name }))
  const value = num(amount)
  const save = async () => {
    const fix = await locate()
    const r = await send.mutateAsync({ partner_id: c.id, amount: value, invoices: picked, note: text, ...(fix ?? {}) })
    setDone(r.offline ? { offline: true, amount: value } : r as PaymentAnswer)
  }
  const receiptText = done && !('offline' in done)
    ? t('We received {amount} from {name} (receipt {number}). Still to pay: {balance}. Thank you!', {
      amount: formatMoney(done.amount, done.currency), name: c.name, number: done.number, balance: formatMoney(Math.max(done.balance, 0), cur) })
    : ''
  const phone = (c.phone ?? '').replace(/[^\d]/g, '')

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        {done ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><Check className="size-5 text-emerald-600" /> {t('Collected {amount}', { amount: formatMoney(done.amount, cur) })}</DialogTitle>
              <DialogDescription>
                {'offline' in done ? t('Saved on the phone; it goes when there is internet. The receipt number comes then.')
                  : done.balance < 0 ? t('Receipt {number}. {name} has {amount} paid in advance.', { number: done.number, name: c.name, amount: formatMoney(-done.balance, cur) })
                  : t('Receipt {number}. {name} still owes {balance}.', { number: done.number, name: c.name, balance: formatMoney(done.balance, cur) })}
              </DialogDescription>
            </DialogHeader>
            {!('offline' in done) && done.unallocated > 0 && <p className="text-[13px] text-muted-foreground">{t('{amount} was more than the open invoices; it stays as an advance.', { amount: formatMoney(done.unallocated, cur) })}</p>}
            <DialogFooter className="gap-2">
              {receiptText && (
                <Button variant="outline" asChild>
                  <a href={`https://wa.me/${phone}?text=${encodeURIComponent(receiptText)}`} target="_blank" rel="noreferrer"><MessageCircle /> {t('Send the receipt on WhatsApp')}</a>
                </Button>
              )}
              <Button onClick={onClose}>{t('Done')}</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t('Collect cash')}</DialogTitle>
              <DialogDescription>{t('{name} owes {amount}. The money goes into your bag and pays the oldest invoices first.', { name: c.name, amount: formatMoney(Math.max(owed, 0), cur) })}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="col-amount">{t('Amount')}</Label>
                <Input id="col-amount" inputMode="decimal" type="number" min="0" step="any" className="h-12 text-lg" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
                <div className="flex flex-wrap gap-2">
                  {overdue > 0 && <Button size="sm" variant="secondary" onClick={() => setAmount(String(overdue))}>{t('Overdue')} · {formatMoney(overdue, cur, 0)}</Button>}
                  {owed > 0 && owed !== overdue && <Button size="sm" variant="secondary" onClick={() => setAmount(String(owed))}>{t('All')} · {formatMoney(owed, cur, 0)}</Button>}
                </div>
              </div>
              {c.open.length > 1 && (
                <fieldset className="grid gap-1.5">
                  <legend className="mb-1 text-sm font-medium">{t('Pay these first (optional)')}</legend>
                  {c.open.map((i) => (
                    <label key={i.id} className="flex items-center gap-2 text-[13px]">
                      <Checkbox checked={picked.includes(i.id)} onCheckedChange={(v) => setPicked((p) => v ? [...p, i.id] : p.filter((x) => x !== i.id))} />
                      <span className="flex-1">{i.number} · {formatDate(i.date)}</span><span className="tabular-nums">{formatMoney(i.open, i.currency)}</span>
                    </label>
                  ))}
                </fieldset>
              )}
              <div className="grid gap-1.5"><Label htmlFor="col-note">{t('Note')}</Label><Input id="col-note" value={text} onChange={(e) => setText(e.target.value)} /></div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
              <Button disabled={value <= 0} loading={send.isPending} onClick={() => void save()}><Wallet /> {t('Collect {amount}|cash', { amount: formatMoney(value, cur) })}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------------------------
// A new order
// ---------------------------------------------------------------------------------------------
type Line = { qty: number; discount?: number }
const draftKey = (co: string | null, c: string) => `drispro.agent.order.${co}.${c}`

function OrderScreen({ boot, customer: c, onBack, onDone }: { boot: AgentBoot; customer: AgentCustomer; onBack: () => void; onDone: () => void }) {
  const { companyId } = useCompany()
  const items = useItems(boot)
  const [q, setQ] = React.useState('')
  const [lines, setLines] = React.useState<Record<string, Line>>(() => { try { return JSON.parse(localStorage.getItem(draftKey(companyId, c.id)) ?? '{}') } catch { return {} } })
  const [note, setNote] = React.useState('')
  const [edit, setEdit] = React.useState<AgentItem | null>(null)
  const [review, setReview] = React.useState(false)
  const send = useAgentSend<{ id: string; number: string; status: string; total: number; currency: string; held: string | null }>('agent_order_submit',
    (p) => t('Order · {name} · {n} lines', { name: c.name, n: (p.lines as unknown[]).length }))
  React.useEffect(() => { try { localStorage.setItem(draftKey(companyId, c.id), JSON.stringify(lines)) } catch { /* ignore */ } }, [lines, companyId, c.id])

  const byId = React.useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const chosen = Object.entries(lines).filter(([, l]) => l.qty > 0).map(([id, l]) => ({ item: byId.get(id)!, ...l })).filter((x) => x.item)
  const priced = chosen.map((x) => {
    const p = estimatePrice(boot, c, x.item, x.qty)
    const disc = x.discount ?? p.discount
    const net = x.qty * p.price * (1 - disc / 100)
    return { ...x, price: p.price, disc, net, gross: net * (1 + x.item.tax / 100), exact: p.exact }
  })
  const total = priced.reduce((s, x) => s + x.gross, 0)
  const exact = priced.every((x) => x.exact)
  const term = q.trim().toLowerCase()
  const shown = term ? items.filter((i) => i.name.toLowerCase().includes(term) || i.sku.toLowerCase().includes(term)).slice(0, 60)
    : items.filter((i) => !(lines[i.id]?.qty > 0)).slice(0, 80)
  const set = (id: string, qty: number) => setLines((l) => ({ ...l, [id]: { ...l[id], qty: Math.max(0, Math.round(qty * 1000) / 1000) } }))

  const submit = async () => {
    const fix = await locate()
    const r = await send.mutateAsync({
      partner_id: c.id, note, set_location: !c.address?.lat, ...(fix ?? {}),
      lines: chosen.map((x) => ({ variant_id: x.item.id, quantity: x.qty, ...(x.discount != null ? { discount_pct: x.discount } : {}) })),
    })
    try { localStorage.removeItem(draftKey(companyId, c.id)) } catch { /* ignore */ }
    if (r.offline) toast.success(t('Order saved on the phone; it goes when there is internet'))
    else if (r.held) toast.warning(t('Order {number} waits for the manager: {why}', { number: r.number, why: tServer(r.held) }))
    else toast.success(t('Order {number} sent · {amount} with VAT', { number: r.number, amount: formatMoney(r.total, r.currency) }))
    onDone()
  }

  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <Button size="icon" variant="ghost" onClick={onBack} aria-label={t('Back')}><ArrowLeft /></Button>
        <div className="min-w-0"><h1 className="truncate text-lg font-semibold">{t('New order')}</h1><p className="truncate text-[13px] text-muted-foreground">{c.name}</p></div>
      </div>
      <div className="sticky top-0 z-10 -mx-1 mb-2 bg-background/95 px-1 pb-2 pt-1 backdrop-blur">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search a product or code')} className="h-11 pl-9" aria-label={t('Search a product or code')} />
          {q && <Button size="icon" variant="ghost" className="absolute right-1 top-1/2 size-9 -translate-y-1/2" aria-label={t('Clear')} onClick={() => setQ('')}><X /></Button>}
        </div>
      </div>

      {priced.length > 0 && !term && (
        <section className="mb-3">
          <h2 className="mb-2 text-sm text-muted-foreground">{tn(priced.length, '{n} product in the order', '{n} products in the order')}</h2>
          <ul className="grid grid-cols-1 gap-2">{priced.map((x) => <ItemRow key={x.item.id} item={x.item} qty={x.qty} price={x.price} disc={x.disc} onQty={(n) => set(x.item.id, n)} onEdit={() => setEdit(x.item)} />)}</ul>
        </section>
      )}
      {shown.length > 0 && (
        <ul className="grid grid-cols-1 gap-2" aria-label={t('Products')}>
          {shown.map((i) => {
            const qty = lines[i.id]?.qty ?? 0
            const p = estimatePrice(boot, c, i, Math.max(qty, 1))
            return <ItemRow key={i.id} item={i} qty={qty} price={p.price} disc={lines[i.id]?.discount ?? p.discount} onQty={(n) => set(i.id, n)} onEdit={() => setEdit(i)} />
          })}
        </ul>
      )}
      {term && shown.length === 0 && <EmptyState compact title={t('No product matches')} />}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 p-3 backdrop-blur" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        <div className="mx-auto flex max-w-xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] text-muted-foreground">{exact ? t('Total with VAT') : t('About, with VAT')}</p>
            <p className="text-xl font-semibold tabular-nums">{formatMoney(total, boot.currency)}</p>
          </div>
          <Button className="h-12 px-5" disabled={!priced.length} onClick={() => setReview(true)}><Send /> {t('Review and send')}</Button>
        </div>
      </div>

      {edit && <LineDialog boot={boot} item={edit} line={lines[edit.id]} base={estimatePrice(boot, c, edit, Math.max(lines[edit.id]?.qty ?? 1, 1))}
        onSave={(l) => { setLines((x) => ({ ...x, [edit.id]: l })); setEdit(null) }} onClose={() => setEdit(null)} />}
      {review && (
        <Dialog open onOpenChange={(o) => !o && setReview(false)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{t('Send the order')}</DialogTitle>
              <DialogDescription>{t('{name} · {n} products · {amount} with VAT', { name: c.name, n: priced.length, amount: formatMoney(total, boot.currency) })}</DialogDescription>
            </DialogHeader>
            <ul className="max-h-[40vh] divide-y overflow-y-auto text-[13px]">
              {priced.map((x) => (
                <li key={x.item.id} className="flex justify-between gap-3 py-2">
                  <span>{x.item.name} <span className="text-muted-foreground">× {formatQty(x.qty)}{x.disc > 0 && ` · −${x.disc}%`}</span></span>
                  <span className="tabular-nums">{formatMoney(x.gross, boot.currency)}</span>
                </li>
              ))}
            </ul>
            <div className="grid gap-1.5"><Label htmlFor="o-note">{t('Note for the office')}</Label>
              <Textarea id="o-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('e.g. deliver before 10:00')} /></div>
            {!exact && <p className="text-[13px] text-muted-foreground">{t('The prices are confirmed by the office when the order arrives.')}</p>}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setReview(false)}>{t('Back')}</Button>
              <Button loading={send.isPending} onClick={() => void submit()}><Send /> {t('Send the order')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

function ItemRow({ item, qty, price, disc, onQty, onEdit }: { item: AgentItem; qty: number; price: number; disc: number; onQty: (n: number) => void; onEdit: () => void }) {
  const low = item.available <= 0 || qty > item.available
  return (
    <li className={cn('flex min-w-0 items-center gap-2 rounded-xl border bg-card p-2.5', qty > 0 && 'border-primary/50 bg-primary/[0.03]')}>
      <button type="button" className="min-w-0 flex-1 text-left" onClick={onEdit}>
        <span className="block truncate text-sm font-medium">{item.name}</span>
        <span className="block truncate text-[12px] text-muted-foreground">
          {t('{price} without VAT', { price: formatMoney(price) })}{disc > 0 && <span className="text-emerald-700 dark:text-emerald-400"> −{disc}%</span>} · <span className={cn(low && 'text-amber-700 dark:text-amber-400')}>{t('{n} in stock', { n: formatQty(item.available) })}</span>
        </span>
      </button>
      <div className="flex items-center gap-1">
        {qty > 0 && <Button size="icon" variant="outline" className="size-10" aria-label={t('One less')} onClick={() => onQty(qty - 1)}><Minus /></Button>}
        {qty > 0 && (
          <Input inputMode="decimal" className="h-10 w-14 px-1 text-center tabular-nums" aria-label={t('Quantity')} value={String(qty)}
            onChange={(e) => onQty(num(e.target.value))} onFocus={(e) => e.target.select()} />
        )}
        <Button size="icon" variant={qty > 0 ? 'outline' : 'secondary'} className="size-10" aria-label={t('One more')} onClick={() => onQty(qty + 1)}><Plus /></Button>
      </div>
    </li>
  )
}

function LineDialog({ boot, item, line, base, onSave, onClose }: {
  boot: AgentBoot; item: AgentItem; line: Line | undefined; base: { price: number; discount: number }; onSave: (l: Line) => void; onClose: () => void
}) {
  const [qty, setQty] = React.useState(String(line?.qty ?? 1))
  const [disc, setDisc] = React.useState(line?.discount != null ? String(line.discount) : '')
  const d = disc === '' ? undefined : num(disc)
  const over = d != null && d > boot.max_discount
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{item.name}</DialogTitle>
          <DialogDescription>{item.sku} · {t('{price} without VAT', { price: formatMoney(base.price, boot.currency) })}{item.uom ? ` / ${item.uom}` : ''} · {t('{n} in stock', { n: formatQty(item.available) })}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5"><Label htmlFor="l-qty">{t('Quantity')}</Label><Input id="l-qty" inputMode="decimal" type="number" min="0" step="any" className="h-11" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="l-disc">{t('Discount %')}</Label>
            <Input id="l-disc" inputMode="decimal" type="number" min="0" max="100" step="any" className="h-11" value={disc} placeholder={String(base.discount || 0)} onChange={(e) => setDisc(e.target.value)} /></div>
        </div>
        {over && <p className="text-[13px] text-amber-700 dark:text-amber-400">{t('Over your {n}% limit: the order will wait for the manager.', { n: boot.max_discount })}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button onClick={() => onSave({ qty: Math.max(0, num(qty)), discount: d })}>{t('Save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
