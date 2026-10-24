import { ArrowRight, ClipboardList, Plus } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Can, useCompany } from '@/app/company-provider'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ErrorState } from '@/components/error-state'
import { formatDateWith, msg, t, tn } from '@/i18n'
import { cn, formatCompact, formatMoney, formatQty, num } from '@/lib/utils'
import { useProcurementOverview } from '../api'

const tooltipStyle = { background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }
const axisTick = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' }
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const RANGES = {
  month: { label: msg('This month'), range: () => { const n = new Date(); return [new Date(n.getFullYear(), n.getMonth(), 1), n] } },
  last_month: { label: msg('Last month'), range: () => { const n = new Date(); return [new Date(n.getFullYear(), n.getMonth() - 1, 1), new Date(n.getFullYear(), n.getMonth(), 0)] } },
  quarter: { label: msg('This quarter'), range: () => { const n = new Date(); return [new Date(n.getFullYear(), Math.floor(n.getMonth() / 3) * 3, 1), n] } },
  ytd: { label: msg('Year to date'), range: () => { const n = new Date(); return [new Date(n.getFullYear(), 0, 1), n] } },
} as const
type RangeKey = keyof typeof RANGES

export function ProcurementOverviewPage() {
  const { company } = useCompany()
  const cur = company?.base_currency ?? 'ALL'
  const [rangeKey, setRangeKey] = React.useState<RangeKey>('month')
  const [from, to] = React.useMemo(() => RANGES[rangeKey].range().map(iso) as [string, string], [rangeKey])
  const ov = useProcurementOverview(from, to)
  const d = ov.data
  const months = (d?.spend_by_month ?? []).map((m) => ({ month: formatDateWith(new Date(`${m.month}-01T00:00:00`), { month: 'short' }), spend: num(m.spend) }))
  const waiting = (d?.pending_po_approvals ?? 0) + (d?.pending_requisitions ?? 0)

  return (
    <>
      <PageHeader
        title={t('Purchasing')}
        description={t('Spend counts recorded vendor bills, less credit notes, in {currency} without VAT.', { currency: cur })}
        actions={<>
          <Select value={rangeKey} onValueChange={(v) => setRangeKey(v as RangeKey)}>
            <SelectTrigger className="w-[150px]" aria-label={t('Period')}><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(RANGES).map(([k, r]) => <SelectItem key={k} value={k}>{t(r.label)}</SelectItem>)}</SelectContent>
          </Select>
          <Can perm="requisitions.write"><Button variant="outline" asChild><Link to="/procurement/requisitions/new"><ClipboardList /> {t('New requisition')}</Link></Button></Can>
          <Can perm="procurement.write"><Button asChild><Link to="/procurement/orders/new"><Plus /> {t('New purchase order')}</Link></Button></Can>
        </>}
      />
      {ov.isError && <Card className="mb-3"><ErrorState compact error={ov.error} onRetry={() => void ov.refetch()} /></Card>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('Spend')} value={formatMoney(d?.spend)} loading={ov.isLoading} href="/procurement/bills" hint={tn(d?.bill_count ?? 0, '{n} bill', '{n} bills')} />
        <StatCard label={t('On order')} value={formatMoney(d?.open_po_value)} loading={ov.isLoading} href="/procurement/orders" tone={d?.late_count ? 'warning' : 'default'}
          hint={d?.late_count ? tn(d.late_count, '{n} order past the expected date', '{n} orders past the expected date') : t('Nothing late')} />
        <StatCard label={t('Received, not billed')} value={formatMoney(d?.to_bill_value)} loading={ov.isLoading} hint={t('Bills to expect from vendors')} />
        <StatCard label={t('Bills overdue')} value={formatMoney(d?.ap_overdue)} loading={ov.isLoading} tone={d?.ap_overdue_count ? 'destructive' : 'default'} href="/procurement/bills"
          hint={t('{amount} due in the next 7 days', { amount: formatMoney(d?.ap_due_7) })} />
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('On-time deliveries')} value={d?.on_time_pct == null ? '—' : `${num(d.on_time_pct).toFixed(0)}%`} loading={ov.isLoading}
          hint={d?.avg_lead_days == null ? t('No goods received against orders yet') : t('{n} days from order to receipt', { n: formatQty(Math.round(num(d.avg_lead_days) * 10) / 10) })} />
        <StatCard label={t('Waiting for approval')} value={waiting} loading={ov.isLoading} href="/approvals" tone={waiting ? 'warning' : 'default'}
          hint={[tn(d?.pending_po_approvals ?? 0, '{n} order', '{n} orders'), tn(d?.pending_requisitions ?? 0, '{n} requisition', '{n} requisitions')].join(' · ')} />
        <StatCard label={t('Requisitions to order')} value={d?.approved_requisitions ?? 0} loading={ov.isLoading} href="/procurement/requisitions" hint={t('Approved, no order yet')} />
        <StatCard label={t('Bills with a mismatch')} value={d?.match_exceptions ?? 0} loading={ov.isLoading} href="/procurement/bills" tone={d?.match_exceptions ? 'destructive' : 'default'} hint={t('Quantity or price differs from the order')} />
      </div>

      <div className="mt-4 grid gap-4 grid-cols-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card>
          <CardHeader><CardTitle>{t('Spend by month')}</CardTitle><CardDescription>{t('Last 12 months, {currency}', { currency: cur })}</CardDescription></CardHeader>
          <CardContent>
            {ov.isLoading ? <Skeleton className="h-64" /> : (
              <div className="h-64">
                <ResponsiveContainer>
                  <BarChart data={months} margin={{ left: -8, right: 4 }}>
                    <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" tick={axisTick} tickLine={false} axisLine={false} />
                    <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatCompact(v)} width={52} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'hsl(var(--muted))' }} formatter={(v: number) => [formatMoney(v, cur), t('Spend')]} />
                    <Bar dataKey="spend" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div><CardTitle>{t('Vendors')}</CardTitle><CardDescription>{t('By spend in the period')}</CardDescription></div>
            <Button variant="ghost" size="sm" asChild><Link to="/partners?role=vendor">{t('All')} <ArrowRight /></Link></Button>
          </CardHeader>
          <CardContent className="p-0">
            {ov.isLoading ? <Skeleton className="mx-4 mb-4 h-40" /> : !d?.top_vendors.length ? <p className="px-4 pb-6 text-[13px] text-muted-foreground">{t('No bills in this period.')}</p> : (
              <Table>
                <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Vendor')}</TableHead><TableHead className="text-right">{t('Spend')}</TableHead><TableHead className="text-right">{t('On time')}</TableHead><TableHead className="text-right">{t('Delivery time')}</TableHead></TableRow></TableHeader>
                <TableBody>
                  {d.top_vendors.map((v) => (
                    <TableRow key={v.id}>
                      <TableCell><Link to={`/partners/${v.id}`} className="font-medium hover:underline">{v.name}</Link></TableCell>
                      <TableCell className="text-right tabular">{formatMoney(v.spend)}</TableCell>
                      <TableCell className={cn('text-right tabular', v.on_time_pct != null && num(v.on_time_pct) < 80 && 'text-destructive')}>{v.on_time_pct == null ? '—' : `${num(v.on_time_pct)}%`}</TableCell>
                      <TableCell className="text-right tabular text-muted-foreground">{v.lead_days == null ? '—' : t('{n} days', { n: num(v.lead_days) })}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
      <Card className="mt-4">
        <CardHeader><CardTitle>{t('Top purchased items')}</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ov.isLoading && <Skeleton className="h-24" />}
          {d && !d.top_products.length && <p className="text-[13px] text-muted-foreground">{t('No bills in this period.')}</p>}
          {d?.top_products.map((p) => {
            const max = Math.max(1, ...d.top_products.map((x) => num(x.spend)))
            return (
              <div key={p.sku} className="grid gap-1">
                <div className="flex items-baseline justify-between gap-2 text-[13px]"><span className="truncate font-medium">{p.sku}</span><span className="tabular">{formatMoney(p.spend)}</span></div>
                <div className="truncate text-xs text-muted-foreground">{p.name} · {t('{qty} bought', { qty: formatQty(p.quantity) })}</div>
                <div className="h-1 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${(num(p.spend) / max) * 100}%` }} /></div>
              </div>
            )
          })}
        </CardContent>
      </Card>
    </>
  )
}
