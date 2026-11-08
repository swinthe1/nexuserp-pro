import { useQuery } from '@tanstack/react-query'
import { CircleCheck } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { useCompany } from '@/app/company-provider'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { t, td } from '@/i18n'
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn, formatMoney, formatQty, num, todayISO } from '@/lib/utils'

type Signal = { kind: string; level: number; user_id?: string; name?: string; sku?: string; warehouse?: string; warehouse_id?: string; n?: number; value?: number; pct?: number; peer?: number }
type Cashier = { user_id: string; name: string; receipts: number; sales: number; voids: number; void_amount: number; void_pct: number | null; cleared: number
  refunds_nr: number; refunds_nr_amount: number; discount_amount: number; discount_pct: number | null; cash_diff: number; shorts: number }
type Waiter = { user_id: string; name: string; handovers: number; diff: number; voided: number }
type Lost = { variant_id: string; sku: string; name: string; warehouse: string; qty_lost: number; value_lost: number }
type Watch = { signals: Signal[]; cashiers: Cashier[]; waiters: Waiter[]; items: Lost[]; negative: { warehouse_id: string; name: string; items: number }[] }

const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d) }
type Preset = '7' | '30' | 'month' | 'custom'

function useLossWatch(from: string, to: string) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: ['loss-watch', companyId, from, to],
    enabled: !!companyId && !!from && !!to && from <= to,
    queryFn: async () => unwrap(await supabase.rpc('loss_watch', { p_company: companyId!, p_from: from, p_to: to })) as unknown as Watch,
  })
}

/** what a signal says, in the owner's words */
function describe(s: Signal): { title: string; detail: string; link?: { to: string; label: string } } {
  const name = s.name ?? ''
  const money = (v: number | undefined) => formatMoney(Math.abs(num(v)))
  switch (s.kind) {
    case 'voids': return {
      title: t('{name} takes items off the sale more than the other cashiers', { name }),
      detail: t('{n} items taken off, {amount} ({pct}% of the sales). The cashiers in the middle: {peer}%.', { n: num(s.n), amount: money(s.value), pct: formatQty(num(s.pct)), peer: formatQty(num(s.peer)) }) }
    case 'cleared': return {
      title: t('{name} cleared {n} whole sales before payment', { name, n: num(s.n) }),
      detail: t('A customer who changes their mind is normal; many cleared sales are worth a look at the camera.') }
    case 'refunds': return {
      title: t('{name}: {n} refunds without a receipt', { name, n: num(s.n) }),
      detail: t('{amount} given back without a receipt. It is the easiest way to take money out of a till: check it with the camera and with the customer.', { amount: money(s.value) }) }
    case 'discounts': return {
      title: t('{name} gives discounts by hand more than the others', { name }),
      detail: t('{amount} in discounts typed at the till ({pct}% of the sales). The cashiers in the middle: {peer}%.', { amount: money(s.value), pct: formatQty(num(s.pct)), peer: formatQty(num(s.peer)) }) }
    case 'cash_short': return {
      title: t('The till comes out short for {name}', { name }),
      detail: t('{amount} short in all; {n} shifts closed with money missing.', { amount: money(s.value), n: num(s.n) }),
      link: { to: '/pos/review', label: t('Reconciling the tills|menu') } }
    case 'waiter_short': return {
      title: t('Waiter {name} handed over less than owed', { name }),
      detail: t('{amount} short in all at the handovers.', { amount: money(s.value) }) }
    case 'waiter_voids': return {
      title: t('Waiter {name} cancels items after the kitchen or the bar had them', { name }),
      detail: t('{n} items cancelled; the waiters in the middle: {peer}.', { n: num(s.n), peer: formatQty(num(s.peer)) }) }
    case 'stock_loss': return {
      title: t('{item} is missing in {unit}', { item: name, unit: td(s.warehouse ?? '') }),
      detail: t('{qty} pieces, {amount} at cost, found by the counts.', { qty: formatQty(num(s.n)), amount: money(s.value) }),
      link: { to: '/inventory/shrinkage', label: t('Shrinkage|menu') } }
    case 'negative': return {
      title: t('{n} items below zero in {unit}', { n: num(s.n), unit: td(s.warehouse ?? '') }),
      detail: t('Usually goods sold that were never received, or sold as another item. The daily count takes these first.'),
      link: { to: '/wms/counts', label: t('Cycle counts|menu') } }
    default: return { title: s.kind, detail: '' }
  }
}

/** The loss watch: what in the tills, the waiters and the counts stands out from the rest */
export function LossWatchPage() {
  const [preset, setPreset] = React.useState<Preset>('7')
  const [from, setFrom] = React.useState(daysAgo(7))
  const [to, setTo] = React.useState(daysAgo(1))
  const pick = (p: Preset) => {
    setPreset(p)
    if (p === '7') { setFrom(daysAgo(7)); setTo(daysAgo(1)) }
    else if (p === '30') { setFrom(daysAgo(30)); setTo(daysAgo(1)) }
    else if (p === 'month') { setFrom(`${todayISO().slice(0, 8)}01`); setTo(todayISO()) }
  }
  const q = useLossWatch(from, to)
  const d = q.data
  const flagged = (user: string, kind: string) => !!d?.signals.some((s) => s.user_id === user && s.kind === kind)
  return (
    <>
      <PageHeader title={t('Loss watch|menu')}
        description={t('What in the tills, the waiters\' handovers and the counts stands out from the rest of the company. A short list of where to look, not fifty reports.')}
        actions={<div className="flex flex-wrap items-center gap-2">
          <Tabs value={preset} onValueChange={(v) => pick(v as Preset)}>
            <TabsList><TabsTrigger value="7">{t('Last 7 days')}</TabsTrigger><TabsTrigger value="30">{t('Last 30 days')}</TabsTrigger>
              <TabsTrigger value="month">{t('This month')}</TabsTrigger><TabsTrigger value="custom">{t('Other dates')}</TabsTrigger></TabsList>
          </Tabs>
          {preset === 'custom' && <>
            <Label htmlFor="lw-from" className="sr-only">{t('From')}</Label>
            <Input id="lw-from" type="date" className="w-[150px]" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Label htmlFor="lw-to" className="sr-only">{t('To')}</Label>
            <Input id="lw-to" type="date" className="w-[150px]" value={to} onChange={(e) => setTo(e.target.value)} />
          </>}
        </div>} />

      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.isLoading || !d ? <Skeleton className="h-80" /> : (
        <div className="grid gap-5">
          <section aria-label={t('What to look at')} className="grid gap-2">
            {!d.signals.length ? (
              <div className="flex items-center gap-3 rounded-xl border bg-card p-4">
                <CircleCheck className="size-6 shrink-0 text-success" />
                <div><div className="font-medium">{t('Nothing stands out in this period')}</div>
                  <div className="text-[13px] text-muted-foreground">{t('No cashier, waiter or item is out of line with the rest.')}</div></div>
              </div>
            ) : d.signals.map((s, i) => {
              const x = describe(s)
              return (
                <div key={i} className={cn('flex gap-3 rounded-xl border bg-card p-4 pl-0', s.level >= 3 && 'border-destructive/40')}>
                  <span aria-hidden className={cn('w-1 shrink-0 rounded-r', s.level >= 3 ? 'bg-destructive' : s.level === 2 ? 'bg-warning' : 'bg-muted-foreground/40')} />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{x.title}</div>
                    <div className="mt-0.5 text-[13px] text-muted-foreground">{x.detail}</div>
                  </div>
                  {x.link && <Link to={x.link.to} className="mr-4 shrink-0 self-center text-[13px] font-medium text-primary hover:underline">{x.link.label}</Link>}
                </div>
              )
            })}
            <p className="text-[12px] text-muted-foreground">{t('A signal is not proof: it shows where to look. Check the camera and talk to the person before deciding anything.')}</p>
          </section>

          {d.cashiers.length > 0 && (
            <section aria-labelledby="lw-cash" className="grid gap-2">
              <h2 id="lw-cash" className="text-[15px] font-semibold">{t('The cashiers side by side')}</h2>
              <Card><CardContent className="overflow-x-auto p-0">
                <Table>
                  <TableHeader><TableRow className="hover:bg-transparent">
                    <TableHead>{t('Cashier')}</TableHead><TableHead className="text-right">{t('Receipts')}</TableHead><TableHead className="text-right">{t('Sales')}</TableHead>
                    <TableHead className="text-right">{t('Taken off the sale')}</TableHead><TableHead className="text-right">{t('Sales cleared')}</TableHead>
                    <TableHead className="text-right">{t('Refunds without a receipt')}</TableHead><TableHead className="text-right">{t('Discounts by hand')}</TableHead>
                    <TableHead className="text-right">{t('Till difference')}</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {d.cashiers.map((c) => (
                      <TableRow key={c.user_id} className="hover:bg-transparent">
                        <TableCell className="font-medium">{c.name}</TableCell>
                        <TableCell className="text-right tabular">{c.receipts}</TableCell>
                        <TableCell className="text-right tabular">{formatMoney(c.sales)}</TableCell>
                        <TableCell className={cn('text-right tabular', flagged(c.user_id, 'voids') && 'font-semibold text-warning')}>
                          {c.voids ? <>{c.voids} · {formatMoney(c.void_amount)}<span className="block text-[11px] text-muted-foreground">{formatQty(num(c.void_pct))}%</span></> : '—'}</TableCell>
                        <TableCell className={cn('text-right tabular', flagged(c.user_id, 'cleared') && 'font-semibold text-warning')}>{c.cleared || '—'}</TableCell>
                        <TableCell className={cn('text-right tabular', flagged(c.user_id, 'refunds') && 'font-semibold text-warning')}>
                          {c.refunds_nr ? <>{c.refunds_nr} · {formatMoney(c.refunds_nr_amount)}</> : '—'}</TableCell>
                        <TableCell className={cn('text-right tabular', flagged(c.user_id, 'discounts') && 'font-semibold text-warning')}>
                          {num(c.discount_amount) ? <>{formatMoney(c.discount_amount)}<span className="block text-[11px] text-muted-foreground">{formatQty(num(c.discount_pct))}%</span></> : '—'}</TableCell>
                        <TableCell className={cn('text-right tabular', num(c.cash_diff) < 0 && 'text-destructive', flagged(c.user_id, 'cash_short') && 'font-semibold')}>
                          {num(c.cash_diff) ? formatMoney(c.cash_diff) : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent></Card>
            </section>
          )}

          {d.waiters.length > 0 && (
            <section aria-labelledby="lw-wait" className="grid gap-2">
              <h2 id="lw-wait" className="text-[15px] font-semibold">{t('The waiters')}</h2>
              <Card><CardContent className="overflow-x-auto p-0">
                <Table>
                  <TableHeader><TableRow className="hover:bg-transparent">
                    <TableHead>{t('Waiter')}</TableHead><TableHead className="text-right">{t('Handovers')}</TableHead>
                    <TableHead className="text-right">{t('Difference at the handovers')}</TableHead><TableHead className="text-right">{t('Items cancelled after the kitchen or bar had them')}</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {d.waiters.map((w) => (
                      <TableRow key={w.user_id} className="hover:bg-transparent">
                        <TableCell className="font-medium">{w.name}</TableCell>
                        <TableCell className="text-right tabular">{w.handovers}</TableCell>
                        <TableCell className={cn('text-right tabular', num(w.diff) < 0 && 'text-destructive')}>{num(w.diff) ? formatMoney(w.diff) : '—'}</TableCell>
                        <TableCell className={cn('text-right tabular', flagged(w.user_id, 'waiter_voids') && 'font-semibold text-warning')}>{w.voided || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent></Card>
            </section>
          )}

          {d.items.length > 0 && (
            <section aria-labelledby="lw-items" className="grid gap-2">
              <h2 id="lw-items" className="text-[15px] font-semibold">{t('What the counts found missing')}</h2>
              <Card><CardContent className="overflow-x-auto p-0">
                <Table>
                  <TableHeader><TableRow className="hover:bg-transparent">
                    <TableHead>{t('Item')}</TableHead><TableHead>{t('Unit')}</TableHead><TableHead className="text-right">{t('Missing')}</TableHead><TableHead className="text-right">{t('Value at cost')}</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {d.items.map((r) => (
                      <TableRow key={`${r.variant_id}-${r.warehouse}`} className="hover:bg-transparent">
                        <TableCell><Link to={`/inventory/item-card?v=${r.variant_id}`} className="font-medium hover:underline">{r.name}</Link><span className="block text-xs text-muted-foreground">{r.sku}</span></TableCell>
                        <TableCell>{td(r.warehouse)}</TableCell>
                        <TableCell className="text-right tabular">{formatQty(num(r.qty_lost))}</TableCell>
                        <TableCell className="text-right font-medium text-destructive tabular">{formatMoney(r.value_lost)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent></Card>
            </section>
          )}
        </div>
      )}
    </>
  )
}
