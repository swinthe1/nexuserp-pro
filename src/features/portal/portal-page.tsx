import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowLeft, FileText, KeyRound, Lock, Minus, Package, Plus, Printer, Search, Send, ShoppingCart, Trash2, X } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { msg, t, tn, tServer } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { newId } from '@/lib/offline/outbox'
import { supabase } from '@/lib/supabase'
import { cn, formatDate, formatMoney, formatQty, num, todayISO } from '@/lib/utils'

type Home = {
  error?: string
  company: { name: string; phone: string | null; email: string | null; address: string; tax_number: string | null; currency: string }
  customer: { name: string; code: string | null; currency: string }
  can_order: boolean; can_see_invoices: boolean
  owed: number; overdue: number; credit_left: number | null
  invoices: { id: string; number: string; type: string; date: string; due: string | null; total: number; open: number; currency: string; status: string }[]
  orders: { id: string; number: string; date: string; status: string; total: number; currency: string; channel: string; invoice_status: string }[]
  categories: { id: string; name: string }[]
}
type Item = { id: string; product_id: string; sku: string; name: string; uom: string | null; tax: number; price: number | null; discount: number | null; net: number | null; gross: number | null; stock: 'in' | 'low' | 'out' | number | null; image: boolean }
type Catalog = { error?: string; total: number; offset: number; currency: string; items: Item[] }
type Doc = {
  number: string; type: string; date: string; due?: string | null; status?: string; currency: string; subtotal: number; discount: number; tax: number; total: number
  paid?: number; open?: number; note?: string | null
  lines: { description: string; quantity: number; delivered?: number; price: number; discount: number; tax_rate: number; total: number }[]
}
type CartLine = { item: Item; qty: number }

const ORDER_STATUS: Record<string, string> = {
  draft: msg('Waiting for confirmation'), pending_approval: msg('Waiting for confirmation'), confirmed: msg('Confirmed'),
  partially_delivered: msg('Partly delivered'), delivered: msg('Delivered'), closed: msg('Completed'),
}
const ERRORS: Record<string, string> = {
  closed: msg('This link is not valid any more. Ask your supplier for a new one.'),
  locked: msg('Too many wrong PINs. Try again in 15 minutes.'),
  wrong_pin: msg('Wrong PIN'),
  no_orders: msg('Orders cannot be sent from this link.'),
}

const pinKey = (key: string) => `drispro.portal.pin.${key.slice(0, 12)}`
const cartKey = (key: string) => `drispro.portal.cart.${key.slice(0, 12)}`
const read = <T,>(k: string, store: Storage | undefined, fallback: T): T => { try { const v = store?.getItem(k); return v ? JSON.parse(v) as T : fallback } catch { return fallback } }
const write = (k: string, v: unknown, store: Storage | undefined) => { try { if (v == null) store?.removeItem(k); else store?.setItem(k, JSON.stringify(v)) } catch { /* ignore */ } }

/** The customer's own page at their supplier: prices, stock, orders, invoices and what they owe. Opened with a private link, no account. */
export function PortalPage() {
  const key = React.useMemo(() => decodeURIComponent(window.location.hash.replace(/^#/, '')), [])
  const [pin, setPin] = React.useState<string | null>(() => read<string | null>(pinKey(key), window.sessionStorage, null))
  const home = useQuery({
    queryKey: ['portal', key, pin, 'home'], enabled: !!key, retry: false, refetchOnWindowFocus: true,
    queryFn: async () => unwrap(await supabase.rpc('portal_home', { p_key: key, p_pin: pin ?? undefined })) as unknown as Home,
  })
  React.useEffect(() => { document.title = home.data?.company?.name ? `${home.data.company.name} · ${t('Orders')}` : 'DrisPRO' }, [home.data])

  if (!key) return <Closed text={t('Open the link your supplier sent you.')} />
  if (home.isPending) return <div className="mx-auto grid max-w-5xl gap-3 p-4"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>
  if (home.isError) return <Closed text={describeError(home.error)} />
  const err = home.data.error
  if (err === 'pin' || err === 'wrong_pin') return <PinGate wrong={err === 'wrong_pin'} onPin={(p) => { write(pinKey(key), p, window.sessionStorage); setPin(p) }} />
  if (err) return <Closed text={t(ERRORS[err] ?? ERRORS.closed)} />
  return <Portal portalKey={key} pin={pin} home={home.data} refresh={() => void home.refetch()} />
}

function Closed({ text }: { text: string }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-muted/40 p-6">
      <div className="max-w-sm rounded-2xl border bg-card p-6 text-center">
        <Lock className="mx-auto mb-3 size-8 text-muted-foreground" />
        <p className="text-sm">{text}</p>
      </div>
    </div>
  )
}

function PinGate({ wrong, onPin }: { wrong: boolean; onPin: (p: string) => void }) {
  const [v, setV] = React.useState('')
  return (
    <div className="grid min-h-dvh place-items-center bg-muted/40 p-6">
      <form className="grid w-full max-w-xs gap-3 rounded-2xl border bg-card p-6" onSubmit={(e) => { e.preventDefault(); if (v) onPin(v) }}>
        <KeyRound className="mx-auto size-8 text-primary" />
        <h1 className="text-center text-lg font-semibold">{t('Enter your PIN')}</h1>
        <p className="text-center text-[13px] text-muted-foreground">{t('Your supplier gave you the PIN together with the link.')}</p>
        <Input autoFocus inputMode="numeric" autoComplete="one-time-code" type="password" maxLength={8} className="h-12 text-center text-xl tracking-[0.5em]"
          aria-label={t('PIN')} value={v} onChange={(e) => setV(e.target.value.replace(/\D/g, ''))} aria-invalid={wrong} />
        {wrong && <p className="text-center text-sm text-destructive">{t('Wrong PIN')}</p>}
        <Button type="submit" className="h-11" disabled={v.length < 4}>{t('Open')}</Button>
      </form>
    </div>
  )
}

type Tab = 'catalog' | 'cart' | 'orders' | 'invoices'

function Portal({ portalKey, pin, home, refresh }: { portalKey: string; pin: string | null; home: Home; refresh: () => void }) {
  const [tab, setTab] = React.useState<Tab>('catalog')
  const [doc, setDoc] = React.useState<{ kind: 'invoice' | 'order'; id: string } | null>(null)
  const [cart, setCart] = React.useState<Record<string, CartLine>>(() => read(cartKey(portalKey), window.localStorage, {}))
  React.useEffect(() => write(cartKey(portalKey), Object.keys(cart).length ? cart : null, window.localStorage), [cart, portalKey])
  const count = Object.values(cart).filter((l) => l.qty > 0).length
  const cur = home.customer.currency
  const setQty = (item: Item, qty: number) => setCart((c) => {
    const n = { ...c }
    if (qty <= 0) delete n[item.id]; else n[item.id] = { item, qty: Math.round(qty * 1000) / 1000 }
    return n
  })

  if (doc) return <DocumentView portalKey={portalKey} pin={pin} home={home} kind={doc.kind} id={doc.id} onBack={() => setDoc(null)} />
  const tabs: { k: Tab; label: string; show: boolean }[] = [
    { k: 'catalog', label: t('Products'), show: true },
    { k: 'cart', label: count ? t('Cart ({n})', { n: count }) : t('Cart'), show: home.can_order },
    { k: 'orders', label: t('My orders'), show: true },
    { k: 'invoices', label: t('Invoices'), show: home.can_see_invoices },
  ]
  return (
    <div className="min-h-dvh bg-muted/30">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-5xl flex-wrap items-end justify-between gap-3 px-4 pb-3 pt-5">
          <div className="min-w-0">
            <p className="text-[13px] text-muted-foreground">{home.company.name}</p>
            <h1 className="truncate text-xl font-semibold">{home.customer.name}</h1>
          </div>
          {home.can_see_invoices && (
            <dl className="flex gap-5 text-right text-[13px]">
              <div><dt className="text-muted-foreground">{home.owed < 0 ? t('Paid in advance') : t('You owe (with VAT)')}</dt><dd className="text-base font-semibold tabular-nums">{formatMoney(Math.abs(home.owed), home.company.currency)}</dd></div>
              {home.overdue > 0 && <div><dt className="text-muted-foreground">{t('Overdue')}</dt><dd className="text-base font-semibold tabular-nums text-destructive">{formatMoney(home.overdue, home.company.currency)}</dd></div>}
            </dl>
          )}
        </div>
        <nav className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-3" aria-label={t('Sections')}>
          {tabs.filter((x) => x.show).map((x) => (
            <button key={x.k} type="button" onClick={() => setTab(x.k)} aria-current={tab === x.k ? 'page' : undefined}
              className={cn('whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium', tab === x.k ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
              {x.label}
            </button>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-4">
        {tab === 'catalog' && <CatalogTab portalKey={portalKey} pin={pin} home={home} cart={cart} setQty={setQty} onCart={() => setTab('cart')} />}
        {tab === 'cart' && <CartTab portalKey={portalKey} pin={pin} cur={cur} cart={cart} setQty={setQty}
          onSent={() => { setCart({}); refresh(); setTab('orders') }} onShop={() => setTab('catalog')} />}
        {tab === 'orders' && <OrdersTab home={home} onOpen={(id) => setDoc({ kind: 'order', id })} />}
        {tab === 'invoices' && <InvoicesTab home={home} onOpen={(id) => setDoc({ kind: 'invoice', id })} />}
      </main>
      <footer className="mx-auto max-w-5xl px-4 pb-8 text-[12px] text-muted-foreground">
        {[home.company.name, home.company.address, home.company.phone, home.company.email].filter(Boolean).join(' · ')}
      </footer>
    </div>
  )
}

function StockBadge({ s }: { s: Item['stock'] }) {
  if (s == null) return null
  if (typeof s === 'number') return <span className={cn('text-[12px]', s <= 0 ? 'text-destructive' : 'text-muted-foreground')}>{t('{n} in stock', { n: formatQty(s) })}</span>
  return <span className={cn('text-[12px]', s === 'out' ? 'text-destructive' : s === 'low' ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400')}>
    {s === 'out' ? t('Out of stock') : s === 'low' ? t('Few left') : t('In stock')}</span>
}

function CatalogTab({ portalKey, pin, home, cart, setQty, onCart }: {
  portalKey: string; pin: string | null; home: Home; cart: Record<string, CartLine>; setQty: (i: Item, q: number) => void; onCart: () => void
}) {
  const [q, setQ] = React.useState('')
  const [term, setTerm] = React.useState('')
  const [cat, setCat] = React.useState<string | null>(null)
  const [pages, setPages] = React.useState(1)
  React.useEffect(() => { const h = setTimeout(() => { setTerm(q.trim()); setPages(1) }, 300); return () => clearTimeout(h) }, [q])
  const data = useQuery({
    queryKey: ['portal', portalKey, pin, 'catalog', term, cat, pages],
    placeholderData: (p) => p,
    queryFn: async () => {
      const all: Item[] = []; let total = 0; let currency = ''
      for (let i = 0; i < pages; i++) {
        const r = unwrap(await supabase.rpc('portal_catalog', { p_key: portalKey, p_pin: pin ?? undefined, p_search: term || undefined, p_category: cat ?? undefined, p_offset: i * 40 })) as unknown as Catalog
        if (r.error) throw new Error(r.error)
        all.push(...r.items); total = r.total; currency = r.currency
      }
      return { items: all, total, currency }
    },
  })
  const withImg = (data.data?.items ?? []).filter((i) => i.image).map((i) => i.product_id)
  const missing = withImg.filter((p) => !images.current.has(p))
  const pics = useQuery({
    queryKey: ['portal', portalKey, 'images', missing.join(',')], enabled: missing.length > 0, staleTime: Infinity,
    queryFn: async () => {
      const out: Record<string, string> = {}
      for (let i = 0; i < missing.length; i += 40) Object.assign(out, unwrap(await supabase.rpc('portal_images', { p_key: portalKey, p_pin: pin ?? '', p_products: missing.slice(i, i + 40) })) as Record<string, string>)
      for (const [k, v] of Object.entries(out)) images.current.set(k, v)
      return out
    },
  })
  void pics.data
  const cur = data.data?.currency ?? home.customer.currency
  const inCart = Object.values(cart).filter((l) => l.qty > 0)
  const total = inCart.reduce((s, l) => s + num(l.item.gross) * l.qty, 0)

  return (
    <div className="pb-20">
      <div className="mb-3 grid gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search by name, code or barcode')} className="h-11 bg-card pl-9" aria-label={t('Search by name, code or barcode')} />
          {q && <Button size="icon" variant="ghost" className="absolute right-1 top-1/2 size-9 -translate-y-1/2" aria-label={t('Clear')} onClick={() => setQ('')}><X /></Button>}
        </div>
        {home.categories.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            <Button size="sm" variant={cat ? 'outline' : 'default'} className="shrink-0" onClick={() => { setCat(null); setPages(1) }}>{t('All')}</Button>
            {home.categories.map((c) => <Button key={c.id} size="sm" variant={cat === c.id ? 'default' : 'outline'} className="shrink-0" onClick={() => { setCat(c.id); setPages(1) }}>{c.name}</Button>)}
          </div>
        )}
      </div>
      {data.isPending ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div>
        : data.isError ? <p className="text-sm text-destructive">{describeError(data.error)}</p>
        : data.data.items.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">{t('No product matches')}</p>
        : (
          <>
            <p className="mb-2 text-[13px] text-muted-foreground">{tn(data.data.total, '{n} product', '{n} products')} · {t('prices with VAT')}</p>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.data.items.map((i) => {
                const qty = cart[i.id]?.qty ?? 0
                const img = images.current.get(i.product_id)
                return (
                  <li key={i.id} className={cn('flex min-w-0 gap-3 rounded-xl border bg-card p-3', qty > 0 && 'border-primary/60')}>
                    <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted">
                      {img ? <img src={img} alt="" className="size-full object-cover" /> : <Package className="size-7 text-muted-foreground/60" />}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <p className="line-clamp-2 text-sm font-medium leading-snug">{i.name}</p>
                      <p className="text-[12px] text-muted-foreground">{i.sku}{i.uom ? ` · ${i.uom}` : ''}</p>
                      <div className="mt-auto flex items-end justify-between gap-2 pt-1.5">
                        <div>
                          <p className="font-semibold tabular-nums">{i.gross == null ? '—' : <>{formatMoney(i.gross, cur)} <span className="text-[12px] font-normal text-muted-foreground">{t('with VAT')}</span></>}</p>
                          {num(i.discount) > 0 && <p className="text-[12px] text-emerald-700 dark:text-emerald-400">−{num(i.discount)}%</p>}
                          <StockBadge s={i.stock} />
                        </div>
                        {home.can_order && i.gross != null && (qty > 0 ? (
                          <div className="flex items-center gap-1">
                            <Button size="icon" variant="outline" className="size-9" aria-label={t('One less')} onClick={() => setQty(i, qty - 1)}><Minus /></Button>
                            <Input inputMode="decimal" className="h-9 w-12 px-1 text-center tabular-nums" aria-label={t('Quantity')} value={String(qty)}
                              onFocus={(e) => e.target.select()} onChange={(e) => setQty(i, num(e.target.value))} />
                            <Button size="icon" variant="outline" className="size-9" aria-label={t('One more')} onClick={() => setQty(i, qty + 1)}><Plus /></Button>
                          </div>
                        ) : <Button size="sm" variant="secondary" onClick={() => setQty(i, 1)}><Plus /> {t('Add')}</Button>)}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
            {data.data.items.length < data.data.total && (
              <div className="mt-4 text-center"><Button variant="outline" loading={data.isFetching} onClick={() => setPages((p) => p + 1)}>{t('Show more')}</Button></div>
            )}
          </>
        )}
      {inCart.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-card/95 p-3 backdrop-blur" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
          <div className="mx-auto flex max-w-5xl items-center gap-3">
            <p className="min-w-0 flex-1 text-sm"><span className="text-muted-foreground">{tn(inCart.length, '{n} product', '{n} products')} · </span><span className="font-semibold tabular-nums">{t('{amount} with VAT', { amount: formatMoney(total, cur) })}</span></p>
            <Button className="h-11" onClick={onCart}><ShoppingCart /> {t('Go to the cart')}</Button>
          </div>
        </div>
      )}
    </div>
  )
}
const images = { current: new Map<string, string>() }

function CartTab({ portalKey, pin, cur, cart, setQty, onSent, onShop }: {
  portalKey: string; pin: string | null; cur: string; cart: Record<string, CartLine>; setQty: (i: Item, q: number) => void; onSent: () => void; onShop: () => void
}) {
  const [note, setNote] = React.useState('')
  const [ref, setRef] = React.useState('')
  const [when, setWhen] = React.useState('')
  const [orderId] = React.useState(() => newId())
  const lines = Object.values(cart).filter((l) => l.qty > 0)
  const net = lines.reduce((s, l) => s + num(l.item.net) * l.qty, 0)
  const total = lines.reduce((s, l) => s + num(l.item.gross) * l.qty, 0)
  const send = useMutation({
    mutationFn: async () => {
      const r = unwrap(await supabase.rpc('portal_order', { p_key: portalKey, p_pin: pin ?? '', p: {
        id: orderId, note, reference: ref, requested_date: when || null, lines: lines.map((l) => ({ variant_id: l.item.id, quantity: l.qty })),
      } })) as { error?: string; number: string; status: string }
      if (r.error) throw new Error(t(ERRORS[r.error] ?? ERRORS.closed))
      return r
    },
    onSuccess: (r) => { toast.success(r.status === 'draft' ? t('Order {number} sent. We will confirm it soon.', { number: r.number }) : t('Order {number} confirmed.', { number: r.number })); onSent() },
    onError: (e) => toast.error(tServer(describeError(e))),
  })
  if (!lines.length) return (
    <div className="py-12 text-center">
      <ShoppingCart className="mx-auto mb-3 size-8 text-muted-foreground" />
      <p className="mb-4 text-sm text-muted-foreground">{t('The cart is empty.')}</p>
      <Button onClick={onShop}>{t('Choose products')}</Button>
    </div>
  )
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px] lg:items-start">
      <ul className="divide-y rounded-xl border bg-card">
        {lines.map((l) => (
          <li key={l.item.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
            <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
              <p className="text-sm font-medium">{l.item.name}</p>
              <p className="text-[12px] text-muted-foreground">{l.item.sku} · {t('{price} with VAT', { price: formatMoney(l.item.gross, cur) })}</p>
            </div>
            <div className="flex items-center gap-1">
              <Button size="icon" variant="outline" className="size-9" aria-label={t('One less')} onClick={() => setQty(l.item, l.qty - 1)}><Minus /></Button>
              <Input inputMode="decimal" className="h-9 w-14 px-1 text-center tabular-nums" aria-label={t('Quantity')} value={String(l.qty)}
                onFocus={(e) => e.target.select()} onChange={(e) => setQty(l.item, num(e.target.value))} />
              <Button size="icon" variant="outline" className="size-9" aria-label={t('One more')} onClick={() => setQty(l.item, l.qty + 1)}><Plus /></Button>
            </div>
            <p className="ml-auto w-28 text-right font-medium tabular-nums">{formatMoney(num(l.item.gross) * l.qty, cur)}</p>
            <Button size="icon" variant="ghost" className="size-9" aria-label={t('Remove')} onClick={() => setQty(l.item, 0)}><Trash2 /></Button>
          </li>
        ))}
      </ul>
      <div className="grid gap-3 rounded-xl border bg-card p-4">
        <dl className="grid gap-1 text-sm">
          <div className="flex justify-between"><dt className="text-muted-foreground">{t('Without VAT')}</dt><dd className="tabular-nums">{formatMoney(net, cur)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">{t('VAT')}</dt><dd className="tabular-nums">{formatMoney(total - net, cur)}</dd></div>
          <div className="flex justify-between border-t pt-1 text-base font-semibold"><dt>{t('Total with VAT')}</dt><dd className="tabular-nums">{formatMoney(total, cur)}</dd></div>
        </dl>
        <div className="grid gap-1.5"><Label htmlFor="p-when">{t('Wanted by')}</Label><Input id="p-when" type="date" value={when} onChange={(e) => setWhen(e.target.value)} /></div>
        <div className="grid gap-1.5"><Label htmlFor="p-ref">{t('Your order number')}</Label><Input id="p-ref" value={ref} maxLength={80} onChange={(e) => setRef(e.target.value)} /></div>
        <div className="grid gap-1.5"><Label htmlFor="p-note">{t('Note')}</Label><Textarea id="p-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <Button className="h-11" loading={send.isPending} onClick={() => send.mutate()}><Send /> {t('Send the order')}</Button>
        <p className="text-[12px] text-muted-foreground">{t('Prices are today’s; the invoice follows the delivery.')}</p>
      </div>
    </div>
  )
}

function OrdersTab({ home, onOpen }: { home: Home; onOpen: (id: string) => void }) {
  if (!home.orders.length) return <p className="py-10 text-center text-sm text-muted-foreground">{t('No orders yet.')}</p>
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {home.orders.map((o) => (
        <li key={o.id}>
          <button type="button" className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 p-3 text-left hover:bg-muted/50" onClick={() => onOpen(o.id)}>
            <span className="font-medium">{o.number}</span>
            <span className="text-[13px] text-muted-foreground">{formatDate(o.date)}</span>
            <Badge variant={['draft', 'pending_approval'].includes(o.status) ? 'warning' : o.status === 'delivered' || o.status === 'closed' ? 'success' : 'secondary'}>
              {t(ORDER_STATUS[o.status] ?? o.status)}</Badge>
            <span className="ml-auto font-medium tabular-nums">{formatMoney(o.total, o.currency)} <span className="text-[12px] font-normal text-muted-foreground">{t('with VAT')}</span></span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function InvoicesTab({ home, onOpen }: { home: Home; onOpen: (id: string) => void }) {
  if (!home.invoices.length) return <p className="py-10 text-center text-sm text-muted-foreground">{t('No invoices yet.')}</p>
  const today = todayISO()
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {home.invoices.map((i) => {
        const late = i.open > 0 && i.due && i.due < today
        return (
          <li key={i.id}>
            <button type="button" className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 p-3 text-left hover:bg-muted/50" onClick={() => onOpen(i.id)}>
              <FileText className="size-4 text-muted-foreground" />
              <span className="font-medium">{i.number}</span>
              <span className="text-[13px] text-muted-foreground">{formatDate(i.date)}{i.type === 'credit_note' && ` · ${t('Credit note')}`}</span>
              <span className="ml-auto text-right">
                <span className="block font-medium tabular-nums">{formatMoney(i.total, i.currency)} <span className="text-[12px] font-normal text-muted-foreground">{t('with VAT')}</span></span>
                <span className={cn('block text-[12px]', i.open > 0 ? late ? 'text-destructive' : 'text-muted-foreground' : 'text-emerald-700 dark:text-emerald-400')}>
                  {i.open > 0 ? (late ? t('{amount} overdue since {date}', { amount: formatMoney(i.open, i.currency), date: formatDate(i.due) }) : t('{amount} open', { amount: formatMoney(i.open, i.currency) })) : t('Paid')}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function DocumentView({ portalKey, pin, home, kind, id, onBack }: { portalKey: string; pin: string | null; home: Home; kind: 'invoice' | 'order'; id: string; onBack: () => void }) {
  const q = useQuery({
    queryKey: ['portal', portalKey, 'doc', kind, id],
    queryFn: async () => unwrap(await supabase.rpc('portal_document', { p_key: portalKey, p_pin: pin ?? '', p_kind: kind, p_id: id })) as unknown as Doc,
  })
  const d = q.data
  return (
    <div className="min-h-dvh bg-muted/30 print:bg-white">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-4 py-3 print:hidden">
        <Button variant="ghost" onClick={onBack}><ArrowLeft /> {t('Back')}</Button>
        <Button variant="outline" onClick={() => window.print()} disabled={!d}><Printer /> {t('Print')}</Button>
      </div>
      <article className="mx-auto max-w-3xl rounded-xl border bg-card p-6 print:border-0 print:p-0">
        {q.isPending ? <Skeleton className="h-64" /> : q.isError ? <p className="text-sm text-destructive">{tServer(describeError(q.error))}</p> : d && (
          <>
            <header className="mb-6 flex flex-wrap justify-between gap-4">
              <div>
                <p className="font-semibold">{home.company.name}</p>
                <p className="text-[13px] text-muted-foreground">{home.company.address}</p>
                {home.company.tax_number && <p className="text-[13px] text-muted-foreground">{t('NIPT')} {home.company.tax_number}</p>}
              </div>
              <div className="text-right">
                <p className="text-lg font-semibold">{d.type === 'order' ? t('Order') : d.type === 'credit_note' ? t('Credit note') : t('Invoice')} {d.number}</p>
                <p className="text-[13px] text-muted-foreground">{formatDate(d.date)}{d.due && ` · ${t('due {date}', { date: formatDate(d.due) })}`}</p>
                {d.status && <p className="text-[13px]">{t(ORDER_STATUS[d.status] ?? d.status)}</p>}
              </div>
            </header>
            <p className="mb-4 text-sm"><span className="text-muted-foreground">{t('For')}: </span><span className="font-medium">{home.customer.name}</span></p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead><tr className="border-b text-left text-[12px] text-muted-foreground">
                  <th className="py-2 font-medium">{t('Product')}</th><th className="py-2 text-right font-medium">{t('Qty')}</th>
                  {d.type === 'order' && <th className="py-2 text-right font-medium">{t('Delivered')}</th>}
                  <th className="py-2 text-right font-medium">{t('Price (without VAT)')}</th><th className="py-2 text-right font-medium">{t('VAT')}</th><th className="py-2 text-right font-medium">{t('Total (with VAT)')}</th>
                </tr></thead>
                <tbody>
                  {d.lines.map((l, n) => (
                    <tr key={n} className="border-b last:border-0">
                      <td className="py-2">{l.description}{num(l.discount) > 0 && <span className="text-muted-foreground"> · −{num(l.discount)}%</span>}</td>
                      <td className="py-2 text-right tabular-nums">{formatQty(l.quantity)}</td>
                      {d.type === 'order' && <td className="py-2 text-right tabular-nums">{formatQty(l.delivered ?? 0)}</td>}
                      <td className="py-2 text-right tabular-nums">{formatMoney(l.price, d.currency)}</td>
                      <td className="py-2 text-right tabular-nums">{num(l.tax_rate)}%</td>
                      <td className="py-2 text-right tabular-nums">{formatMoney(l.total, d.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="ml-auto mt-4 grid max-w-xs gap-1 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">{t('Without VAT')}</dt><dd className="tabular-nums">{formatMoney(d.subtotal, d.currency)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">{t('VAT')}</dt><dd className="tabular-nums">{formatMoney(d.tax, d.currency)}</dd></div>
              <div className="flex justify-between border-t pt-1 font-semibold"><dt>{t('Total with VAT')}</dt><dd className="tabular-nums">{formatMoney(d.total, d.currency)}</dd></div>
              {d.open != null && d.type !== 'order' && <div className="flex justify-between"><dt className="text-muted-foreground">{t('Still to pay (with VAT)')}</dt><dd className="tabular-nums">{formatMoney(d.open, d.currency)}</dd></div>}
            </dl>
            {d.note && <p className="mt-4 text-[13px] text-muted-foreground">{d.note}</p>}
            {d.type !== 'order' && <p className="mt-6 text-[12px] text-muted-foreground print:block">{t('This is a copy for your records. The fiscal invoice is the one handed over with the goods.')}</p>}
          </>
        )}
      </article>
    </div>
  )
}
