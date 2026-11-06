import { useQuery } from '@tanstack/react-query'
import { PageTableExport } from '@/components/page-table-export'
import { AlertTriangle, ArrowRight } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { iso } from '@/features/finance/pages/finance-overview-page'
import { formatNumberWith, t, tn } from '@/i18n'
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn, formatDate, formatMoney, num, todayISO } from '@/lib/utils'

type Vendor = { vendor_id: string; name: string; orders: number; spend: number; on_time_pct: number | null; judged: number; avg_delay_days: number | null
  fill_pct: number | null; rejected_pct: number | null; confirmed_pct: number | null; price_rises: number; late_now: number; last_order: string | null; grade: 'A' | 'B' | 'C' | null }
type Card_ = { from: string; to: string; vendors: Vendor[]; single_source: { variant_id: string; sku: string; name: string; value: number; vendor: string | null }[]; abc_ready: boolean }

const pct = (v: number | null | undefined, d = 1) => (v == null ? '—' : `${formatNumberWith(num(v), { maximumFractionDigits: d })}%`)
const GRADE: Record<'A' | 'B' | 'C', string> = { A: 'border-success/40 bg-success/10 text-success', B: 'border-warning/40 bg-warning/10 text-warning', C: 'border-destructive/40 bg-destructive/10 text-destructive' }

/** How each vendor serves us: on time, complete, goods refused at the door, price rises */
export function VendorScorecardPage() {
  const { companyId, company } = useCompany()
  const [params, setParams] = useSearchParams()
  const n = new Date()
  const from = params.get('from') ?? iso(new Date(n.getFullYear(), n.getMonth() - 5, 1))
  const to = params.get('to') ?? todayISO()
  const q = useQuery({
    queryKey: ['vendor-scorecard', companyId, from, to], enabled: !!companyId, placeholderData: (p) => p,
    queryFn: async () => unwrap(await supabase.rpc('vendor_scorecard', { p_company: companyId!, p_from: from, p_to: to })) as unknown as Card_,
  })
  const set = (k: string, v: string) => setParams((p) => { const x = new URLSearchParams(p); x.set(k, v); return x }, { replace: true })
  const d = q.data
  const cur = company?.base_currency
  return (
    <>
      <PageHeader actions={<PageTableExport />} title={t('Vendor scorecard')}
        description={t('How each vendor serves us: orders on time and complete, goods refused at the door and price rises. Judged on the orders placed in the period.')} />
      <Card className="mb-4"><CardContent className="flex flex-wrap items-end gap-3 p-3">
        <div className="grid gap-1"><Label htmlFor="vs-from" className="text-xs">{t('From')}</Label><Input id="vs-from" type="date" className="h-8 w-[150px]" value={from} max={to} onChange={(e) => e.target.value && set('from', e.target.value)} /></div>
        <div className="grid gap-1"><Label htmlFor="vs-to" className="text-xs">{t('To')}</Label><Input id="vs-to" type="date" className="h-8 w-[150px]" value={to} min={from} onChange={(e) => e.target.value && set('to', e.target.value)} /></div>
        <p className="ml-auto max-w-md self-center text-xs text-muted-foreground">{t('A: on time at least 95%, complete at least 98%, at most 1% refused. C: on time under 80%, complete under 90% or over 3% refused.')}</p>
      </CardContent></Card>
      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !d ? <Skeleton className="h-96" /> : (
        <div className={cn('grid gap-4', q.isFetching && 'opacity-60')}>
          <Card>
            <CardContent className="overflow-x-auto p-0">
              {!d.vendors.length ? <EmptyState title={t('No orders or bills in this period')} description={t('The scorecard fills up as orders are placed and received.')} /> : (
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>{t('Vendor')}</TableHead><TableHead className="text-center">{t('Grade')}</TableHead>
                    <TableHead className="text-right">{t('Bought (without VAT)')}</TableHead><TableHead className="text-right">{t('Orders')}</TableHead>
                    <TableHead className="text-right">{t('On time')}</TableHead><TableHead className="text-right">{t('Average delay')}</TableHead>
                    <TableHead className="text-right">{t('Complete|delivered in full')}</TableHead><TableHead className="text-right">{t('Refused|share')}</TableHead>
                    <TableHead className="text-right">{t('Confirmed')}</TableHead><TableHead className="text-right">{t('Price rises')}</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {d.vendors.map((v) => (
                      <TableRow key={v.vendor_id}>
                        <TableCell><Link to={`/partners/${v.vendor_id}`} className="font-medium hover:underline">{v.name}</Link>
                          {v.late_now > 0 && <span className="block text-xs text-destructive">{tn(v.late_now, '{n} order late now', '{n} orders late now')}</span>}
                          {v.last_order && <span className="block text-xs text-muted-foreground">{t('Last order {date}', { date: formatDate(v.last_order) })}</span>}</TableCell>
                        <TableCell className="text-center">{v.grade ? <Badge variant="outline" className={cn('w-8 justify-center font-semibold', GRADE[v.grade])}>{v.grade}</Badge>
                          : <span className="text-xs text-muted-foreground" title={t('At least two orders past their date are needed')}>—</span>}</TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular">{formatMoney(v.spend, cur)}</TableCell>
                        <TableCell className="text-right tabular">{v.orders}</TableCell>
                        <TableCell className={cn('text-right tabular', v.on_time_pct != null && v.on_time_pct < 80 && 'text-destructive')}>{pct(v.on_time_pct)}</TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular">{v.avg_delay_days == null ? '—' : tn(Math.round(num(v.avg_delay_days)), '{n} day', '{n} days')}</TableCell>
                        <TableCell className={cn('text-right tabular', v.fill_pct != null && v.fill_pct < 90 && 'text-destructive')}>{pct(v.fill_pct)}</TableCell>
                        <TableCell className={cn('text-right tabular', num(v.rejected_pct) > 3 && 'text-destructive')}>{pct(v.rejected_pct, 2)}</TableCell>
                        <TableCell className="text-right tabular">{pct(v.confirmed_pct, 0)}</TableCell>
                        <TableCell className={cn('text-right tabular', v.price_rises > 0 && 'text-warning')}>{v.price_rises}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
              <div><CardTitle>{t('Main items with only one vendor')}</CardTitle>
                <CardDescription>{t('The A items of the ABC analysis that only one vendor sells us. Find a second vendor for each, so a late or short delivery does not empty the shelf.')}</CardDescription></div>
              <Button variant="outline" size="sm" asChild><Link to="/procurement/vendor-prices">{t('Vendor prices')} <ArrowRight /></Link></Button>
            </CardHeader>
            <CardContent className="p-0">
              {!d.abc_ready ? <EmptyState compact title={t('The ABC analysis has not run yet')} description={t('Run it on the ABC page; this list then shows the main items.')}
                  action={<Button variant="outline" size="sm" asChild><Link to="/inventory/abc">{t('ABC analysis')}</Link></Button>} />
                : !d.single_source.length ? <EmptyState compact title={t('Every main item has at least two vendors')} />
                : (
                  <Table>
                    <TableHeader><TableRow><TableHead>{t('Item')}</TableHead><TableHead>{t('The only vendor')}</TableHead><TableHead className="text-right">{t('Out of stock in the ABC period, at cost')}</TableHead></TableRow></TableHeader>
                    <TableBody>{d.single_source.map((x) => (
                      <TableRow key={x.variant_id}>
                        <TableCell><span className="font-medium">{x.name}</span> <span className="text-muted-foreground">{x.sku}</span></TableCell>
                        <TableCell>{x.vendor ?? <span className="inline-flex items-center gap-1 text-warning"><AlertTriangle className="size-3.5" /> {t('No vendor on its price list')}</span>}</TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular">{formatMoney(x.value, cur)}</TableCell>
                      </TableRow>
                    ))}</TableBody>
                  </Table>
                )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  )
}
