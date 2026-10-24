import { PackageCheck, RefreshCw, Search, Truck } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn, formatDate, formatQty, num } from '@/lib/utils'
import { useWarehouses } from '@/features/inventory/api'
import { useDeliverOrder, useFulfillmentQueue, useReserveOrder, type QueueLine } from '../api'
import { msg, t, td, tn } from '@/i18n'
import { useRealtimeInvalidate } from '@/hooks/use-realtime'
import { ErrorState } from '@/components/error-state'

const STATES: { value: QueueLine['state']; label: string; hint: string }[] = [
  { value: 'in_delivery', label: msg('On a delivery'), hint: msg('being picked or waiting to leave') },
  { value: 'ready', label: msg('Ready to ship'), hint: msg('fully reserved') },
  { value: 'can_reserve', label: msg('Can reserve'), hint: msg('free stock covers it') },
  { value: 'awaiting_stock', label: msg('Waiting for stock'), hint: msg('covered by open purchase orders') },
  { value: 'short', label: msg('Short'), hint: msg('not covered by stock or orders') },
]
const STATE_LABEL = Object.fromEntries(STATES.map((s) => [s.value, s.label])) as Record<string, string>

export function FulfillmentPage() {
  const { can, companyId } = useCompany()
  useRealtimeInvalidate('sales_orders', companyId, [['oms', companyId]])
  useRealtimeInvalidate('deliveries', companyId, [['oms', companyId]])
  const navigate = useNavigate()
  const warehouses = useWarehouses()
  const [warehouse, setWarehouse] = React.useState('all')
  const [state, setState] = React.useState<string>('all')
  const [q, setQ] = React.useState('')
  const queue = useFulfillmentQueue(warehouse === 'all' ? null : warehouse)
  const reserve = useReserveOrder()
  const deliver = useDeliverOrder()
  const lines = queue.data ?? []
  const count = (s: string) => lines.filter((l) => l.state === s).length
  const needle = q.trim().toLowerCase()
  const shown = lines.filter((l) => (state === 'all' || l.state === state)
    && (!needle || [l.partner, l.order_number, l.sku, l.name].some((x) => x?.toLowerCase().includes(needle))))
  // order-level: every line ready → can create the delivery (lines already on an open delivery don't count)
  const orderReady = React.useMemo(() => {
    const m = new Map<string, boolean>()
    lines.forEach((l) => { if (l.state !== 'in_delivery') m.set(l.sales_order_id, (m.get(l.sales_order_id) ?? true) && l.state === 'ready') })
    return m
  }, [lines])
  const anyReserved = (id: string) => lines.some((l) => l.sales_order_id === id && l.state !== 'in_delivery' && num(l.reserved) > 0)
  const canWrite = can('sales.write')

  return (
    <>
      <PageHeader title={t('Order desk')} description={t('Every open order line with what is reserved, free and on the way. Reserve what stock allows, ship what is ready, and send the rest to replenishment.')}
        actions={<>
          <Select value={warehouse} onValueChange={setWarehouse}>
            <SelectTrigger className="w-[190px]" aria-label={t('Warehouse')}><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">{t('All warehouses')}</SelectItem>{(warehouses.data ?? []).map((w) => <SelectItem key={w.id} value={w.id}>{td(w.name)}</SelectItem>)}</SelectContent>
          </Select>
          {can('procurement.read') && <Button variant="outline" asChild><Link to="/procurement/replenishment"><RefreshCw /> {t('Plan replenishment')}</Link></Button>}
        </>} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {STATES.map((s) => (
          <button key={s.value} type="button" onClick={() => setState(state === s.value ? 'all' : s.value)} className="text-left" aria-pressed={state === s.value}>
            <div className={cn('h-full rounded-lg', state === s.value && 'ring-2 ring-ring')}>
              <StatCard label={t(s.label)} value={queue.isLoading ? '…' : count(s.value)} hint={t(s.hint)} loading={queue.isLoading}
                tone={s.value === 'short' && count(s.value) ? 'destructive' : s.value === 'awaiting_stock' && count(s.value) ? 'warning' : 'default'} />
            </div>
          </button>
        ))}
      </div>
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Customer, order or item')} className="h-8 pl-8 text-[13px]" aria-label={t('Search lines')} />
          </div>
          <Select value={state} onValueChange={setState}>
            <SelectTrigger className="h-8 w-[170px]" aria-label={t('State')}><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">{t('Every state')}</SelectItem>{STATES.map((s) => <SelectItem key={s.value} value={s.value}>{t(s.label)}</SelectItem>)}</SelectContent>
          </Select>
          <span className="ml-auto text-[13px] text-muted-foreground">{tn(shown.length, '{n} line', '{n} lines')}</span>
        </div>
        <CardContent className="overflow-x-auto p-0">
          {queue.isLoading ? <Skeleton className="m-4 h-48" /> : queue.isError ? <ErrorState error={queue.error} onRetry={() => void queue.refetch()} /> : !shown.length ? (
            <EmptyState title={lines.length ? t('No lines match') : t('No open order lines')} description={lines.length ? t('Change the filters.') : t('Confirmed orders that still have something to deliver show up here.')} />
          ) : (
            <Table className="min-w-[1100px]">
              <TableHeader><TableRow className="hover:bg-transparent">
                <TableHead>{t('Order')}</TableHead><TableHead>{t('Item')}</TableHead>
                <TableHead className="text-right">{t('Ordered')}</TableHead><TableHead className="text-right">{t('Delivered')}</TableHead>
                <TableHead className="text-right">{t('Reserved')}</TableHead><TableHead className="text-right">{t('To deliver')}</TableHead>
                <TableHead className="text-right">{t('Free stock')}</TableHead><TableHead className="text-right">{t('Incoming')}</TableHead>
                <TableHead>{t('Next receipt')}</TableHead><TableHead>{t('State')}</TableHead><TableHead className="w-44" />
              </TableRow></TableHeader>
              <TableBody>
                {shown.map((l, i) => {
                  const first = i === 0 || shown[i - 1]!.sales_order_id !== l.sales_order_id
                  return (
                    <TableRow key={l.line_id} className={cn('hover:bg-transparent', !first && 'border-t-0')}>
                      <TableCell className="align-top">
                        {first && <>
                          <Link to={`/sales/orders/${l.sales_order_id}`} className="font-medium text-primary hover:underline">{l.order_number}</Link>
                          <div className="text-xs text-muted-foreground">{l.partner} · {l.requested_date ? t('wanted by {date}', { date: formatDate(l.requested_date) }) : formatDate(l.order_date)}</div>
                        </>}
                      </TableCell>
                      <TableCell><div className="font-medium">{l.sku}</div><div className="text-xs text-muted-foreground">{l.name}</div></TableCell>
                      <TableCell className="text-right tabular">{formatQty(l.ordered)}</TableCell>
                      <TableCell className="text-right tabular">{num(l.delivered) ? formatQty(l.delivered) : '—'}</TableCell>
                      <TableCell className="text-right tabular">{num(l.reserved) ? formatQty(l.reserved) : '—'}</TableCell>
                      <TableCell className="text-right tabular font-medium">{formatQty(l.outstanding)}</TableCell>
                      <TableCell className={cn('text-right tabular', num(l.available) < 0 && 'text-destructive')} title={num(l.available) < 0 ? t('More is reserved than is on hand') : undefined}>{formatQty(l.available)}</TableCell>
                      <TableCell className="text-right tabular">{num(l.incoming) ? formatQty(l.incoming) : '—'}</TableCell>
                      <TableCell className="text-[13px]">{l.next_receipt ? formatDate(l.next_receipt) : '—'}</TableCell>
                      <TableCell>{l.state === 'in_delivery'
                        ? <Link to={`/sales/orders/${l.sales_order_id}`} className="whitespace-nowrap text-[13px] text-primary hover:underline">{t(STATE_LABEL[l.state] ?? l.state)}</Link>
                        : <StatusBadge status={l.state} label={t(STATE_LABEL[l.state] ?? l.state)} />}</TableCell>
                      <TableCell className="text-right">
                        {first && canWrite && (
                          orderReady.get(l.sales_order_id) || anyReserved(l.sales_order_id) ? (
                            <Button size="sm" variant={orderReady.get(l.sales_order_id) ? 'default' : 'outline'} loading={deliver.isPending && deliver.variables === l.sales_order_id}
                              onClick={async () => { const id = await deliver.mutateAsync(l.sales_order_id); toast.success(t('Delivery created')); navigate(`/sales/deliveries/${id}`) }}>
                              <Truck /> {orderReady.get(l.sales_order_id) ? t('Create delivery') : t('Deliver reserved')}
                            </Button>
                          ) : lines.some((x) => x.sales_order_id === l.sales_order_id && x.state === 'can_reserve') ? (
                            <Button size="sm" variant="outline" loading={reserve.isPending && reserve.variables === l.sales_order_id}
                              onClick={async () => { const n = await reserve.mutateAsync(l.sales_order_id); toast.success(n ? t('{qty} reserved', { qty: formatQty(n) }) : t('Nothing more could be reserved')) }}>
                              <PackageCheck /> {t('Reserve')}
                            </Button>
                          ) : null
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  )
}
