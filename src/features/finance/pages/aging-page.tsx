import { Download } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Can, useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ErrorState } from '@/components/error-state'
import { msg, t, tn } from '@/i18n'
import { cn, formatDate, formatMoney, num, todayISO } from '@/lib/utils'
import { downloadCsv } from '@/lib/export'
import { useAging, type AgingRow } from '../api'

const BUCKETS = [
  { key: 'not_due', label: msg('Not due') },
  { key: 'd1_30', label: msg('1–30 days') },
  { key: 'd31_60', label: msg('31–60 days') },
  { key: 'd61_90', label: msg('61–90 days') },
  { key: 'd90_plus', label: msg('Over 90 days') },
] as const

export function AgingPage({ kind }: { kind: 'ar' | 'ap' }) {
  const navigate = useNavigate()
  const { company } = useCompany()
  const [asOf, setAsOf] = React.useState(todayISO())
  const aging = useAging(kind, asOf)
  const rows = React.useMemo(() => [...(aging.data ?? [])].sort((a, b) => num(b.total) - num(a.total)), [aging.data])
  const sum = (k: keyof AgingRow) => rows.reduce((s, r) => s + num(r[k]), 0)
  const total = sum('total')
  const overdue = sum('d1_30') + sum('d31_60') + sum('d61_90') + sum('d90_plus')
  const isAR = kind === 'ar'
  const payType = isAR ? 'customer_payment' : 'vendor_payment'
  const partnerHref = (id: string) => `/partners/${id}`

  const exportCsv = () => downloadCsv(`${isAR ? t('receivables') : t('payables')}-${asOf}`, [
    [isAR ? t('Customer') : t('Vendor'), ...BUCKETS.map((b) => t(b.label)), t('Not matched'), t('Total with VAT'), t('Oldest due date'), t('Documents')],
    ...rows.map((r) => [r.partner_name, ...BUCKETS.map((b) => r[b.key]), r.unapplied, r.total, r.oldest_due, r.documents]),
  ])

  return (
    <>
      <PageHeader title={t('Debts|menu')}
        description={isAR ? t('Open customer balances, by how long they are overdue. Receipts not yet matched to an invoice reduce the balance.') : t('Open vendor balances, by how long they are overdue. Payments not yet matched to a bill reduce the balance.')}
        actions={<>
          <div className="flex items-center gap-2"><Label htmlFor="asof" className="text-[13px] text-muted-foreground">{t('On date')}</Label>
            <Input id="asof" type="date" className="w-[150px]" value={asOf} onChange={(e) => setAsOf(e.target.value || todayISO())} /></div>
          <Button variant="outline" onClick={exportCsv} disabled={!rows.length}><Download /> {t('Export')}</Button>
          {!isAR && <Button variant="outline" asChild><Link to="/finance/payment-proposal">{t('Pay several at once')}</Link></Button>}
          <Can perm="invoicing.write"><Button asChild><Link to={`/finance/payments/new?type=${payType}`}>{isAR ? t('Receive a payment') : t('Pay a vendor')}</Link></Button></Can>
        </>} />
      {/* both sides of the debts on one page: what customers owe me, what I owe suppliers */}
      <Tabs value={kind} onValueChange={(v) => navigate(v === 'ar' ? '/finance/receivables' : '/finance/payables', { replace: true })} className="mb-4">
        <TabsList>
          <TabsTrigger value="ar">{t('Receivables|menu')}</TabsTrigger>
          <TabsTrigger value="ap">{t('Payables|menu')}</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={isAR ? t('Total to collect (with VAT)') : t('Total to pay (with VAT)')} value={formatMoney(total)} loading={aging.isLoading} hint={[isAR ? tn(rows.length, '{n} customer', '{n} customers') : tn(rows.length, '{n} vendor', '{n} vendors'), company?.base_currency].filter(Boolean).join(' · ')} />
        <StatCard label={t('Overdue (with VAT)')} value={formatMoney(overdue)} loading={aging.isLoading} tone={overdue ? (isAR ? 'warning' : 'destructive') : 'default'} hint={total ? t('{pct}% of the balance', { pct: ((overdue / total) * 100).toFixed(0) }) : undefined} />
        <StatCard label={t('Over 90 days (with VAT)')} value={formatMoney(sum('d90_plus'))} loading={aging.isLoading} tone={sum('d90_plus') ? 'destructive' : 'default'} hint={isAR ? t('Send a reminder, or consider a provision') : t('Vendors may stop supplying')} />
        <StatCard label={t('Not matched')} value={formatMoney(-sum('unapplied'))} loading={aging.isLoading} hint={isAR ? t('Receipts not matched to an invoice') : t('Payments not matched to a bill')} />
      </div>
      {/* the distribution bar makes the shape of the balance readable at a glance */}
      {total > 0 && (
        <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          {BUCKETS.map((b, i) => { const v = Math.max(sum(b.key), 0); return v ? <div key={b.key} style={{ width: `${(v / Math.max(total, 1)) * 100}%`, opacity: 0.35 + i * 0.16 }} className={i === 0 ? 'bg-success' : 'bg-destructive'} title={`${t(b.label)}: ${formatMoney(v)}`} /> : null })}
        </div>
      )}
      <Card className="mt-4">
        <CardContent className="overflow-x-auto p-0">
          {aging.isLoading ? <Skeleton className="m-4 h-48" /> : aging.isError ? <ErrorState error={aging.error} onRetry={() => void aging.refetch()} /> : !rows.length ? (
            <EmptyState title={isAR ? t('No customer owes you anything') : t('Nothing to pay')} description={isAR ? t('On {date} every invoice is paid.', { date: formatDate(asOf) }) : t('On {date} every vendor bill is paid.', { date: formatDate(asOf) })} />
          ) : (
            <Table>
              <TableHeader><TableRow className="hover:bg-transparent">
                <TableHead>{isAR ? t('Customer') : t('Vendor')}</TableHead>
                {BUCKETS.map((b) => <TableHead key={b.key} className="text-right">{t(b.label)}</TableHead>)}
                <TableHead className="text-right">{t('Not matched')}</TableHead><TableHead className="text-right">{t('Total with VAT')}</TableHead><TableHead>{t('Oldest due date')}</TableHead><TableHead className="w-24" />
              </TableRow></TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.partner_id} className="cursor-pointer" onClick={() => navigate(partnerHref(r.partner_id))}>
                    <TableCell><span className="font-medium">{r.partner_name}</span><span className="ml-2 text-xs text-muted-foreground">{tn(r.documents, '{n} open', '{n} open|plural')}</span></TableCell>
                    {BUCKETS.map((b, i) => <TableCell key={b.key} className={cn('text-right tabular', !num(r[b.key]) && 'text-muted-foreground/50', i >= 3 && num(r[b.key]) > 0 && 'text-destructive')}>{num(r[b.key]) ? formatMoney(r[b.key]) : '—'}</TableCell>)}
                    <TableCell className="text-right tabular text-muted-foreground">{num(r.unapplied) ? formatMoney(r.unapplied) : '—'}</TableCell>
                    <TableCell className="text-right tabular font-medium">{formatMoney(r.total)}</TableCell>
                    <TableCell className={cn('text-[13px]', r.oldest_due && r.oldest_due < asOf && 'text-destructive')}>{formatDate(r.oldest_due)}</TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Can perm="invoicing.write"><Button size="sm" variant="ghost" asChild><Link to={`/finance/payments/new?type=${payType}&partner=${r.partner_id}`}>{isAR ? t('Collect') : t('Pay')}</Link></Button></Can>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter><TableRow className="hover:bg-transparent">
                <TableCell className="font-medium">{t('Total')}</TableCell>
                {BUCKETS.map((b) => <TableCell key={b.key} className="text-right tabular font-semibold">{formatMoney(sum(b.key))}</TableCell>)}
                <TableCell className="text-right tabular">{formatMoney(sum('unapplied'))}</TableCell>
                <TableCell className="text-right tabular font-semibold">{formatMoney(total)}</TableCell><TableCell colSpan={2} />
              </TableRow></TableFooter>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  )
}
