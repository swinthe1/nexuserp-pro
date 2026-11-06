import { CalendarClock, ClipboardPen, FileSpreadsheet, Fingerprint, Plus } from 'lucide-react'
import { PageTableExport } from '@/components/page-table-export'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { Can, useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ErrorState } from '@/components/error-state'
import { useRealtimeInvalidate } from '@/hooks/use-realtime'
import { t } from '@/i18n'
import { cn, formatDate, formatMoney, num } from '@/lib/utils'
import { monthLabel, monthRange, previousMonth, thisMonth, useDeclarations, useFiscalOverview, useTaxCalendar, useVatPreview } from '../api'
import { NewDeclarationDialog, TieOut } from '../components/tax-ui'

export function TaxOverviewPage() {
  const { company, companyId } = useCompany()
  useRealtimeInvalidate('vat_declarations', companyId, [['tax', companyId]])
  const cur = company?.base_currency
  const ym = thisMonth()
  const { from, to } = monthRange(ym)
  const pv = useVatPreview(from, to)
  const cal = useTaxCalendar(3)
  const decl = useDeclarations()
  const fiscal = useFiscalOverview()
  const [newOpen, setNewOpen] = React.useState(false)
  const p = pv.data
  const net = p ? num(p.output_vat) - num(p.input_vat) : 0
  const authority = company?.country_code === 'XK' ? 'ATK' : 'DPT'
  const calendar = [...(cal.data ?? [])].sort((a, b) => b.due_date.localeCompare(a.due_date))
  const ledgerOk = p && Math.abs(num(p.ledger.output_difference)) < 0.01 && Math.abs(num(p.ledger.input_difference)) < 0.01

  return (
    <>
      <PageHeader title={t('Tax overview|menu')} description={t('VAT for {month} so far, what is due to the {authority} and when, and how fiscalization is going.', { month: monthLabel(ym), authority })}
        actions={<><PageTableExport />{<>
          <Button variant="outline" asChild><Link to={`/tax/books?month=${ym}`}><FileSpreadsheet /> {t('Open the books')}</Link></Button>
          <Can perm="tax.write"><Button onClick={() => setNewOpen(true)}><Plus /> {t('New declaration')}</Button></Can>
        </>}</>} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={`${t('Output VAT')} · ${monthLabel(ym)}`} value={formatMoney(p?.output_vat, cur)} loading={pv.isLoading}
          hint={p ? (p.counts.pos_days ? t('{n} sales, {days} till days', { n: p.counts.sales, days: p.counts.pos_days }) : t('{n} sales', { n: p.counts.sales })) : undefined} href={`/tax/books?book=sales&month=${ym}`} />
        <StatCard label={t('Input VAT')} value={formatMoney(p?.input_vat, cur)} loading={pv.isLoading}
          hint={p ? t('{n} purchases', { n: p.counts.purchases }) : undefined} href={`/tax/books?book=purchase&month=${ym}`} />
        <StatCard label={net >= 0 ? t('VAT to pay so far') : t('VAT credit so far')} value={formatMoney(Math.abs(net), cur)} loading={pv.isLoading}
          tone={net > 0 ? 'warning' : 'default'}
          hint={p?.credit_brought_forward ? t('Before the {amount} credit from last month', { amount: formatMoney(p.credit_brought_forward) }) : t('Sales VAT minus purchase VAT, before any credit from last month')} />
        <StatCard label={t('Books against accounting')} value={pv.isLoading ? '' : ledgerOk ? t('They match') : t('Check')} loading={pv.isLoading} tone={ledgerOk ? 'default' : 'warning'}
          hint={ledgerOk ? t('VAT in the books equals VAT booked on 4456 / 4457') : t('Open the books to see the difference')} href={`/tax/books?month=${ym}`} />
      </div>

      <div className="mt-4 grid gap-4 grid-cols-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader className="pb-2"><CardTitle>{t('Deadlines')}</CardTitle>
            <CardDescription>{company?.country_code === 'XK'
              ? t('VAT return by the 20th, and salary tax with pension contributions by the 15th of the next month.')
              : t('VAT return by the 14th, and the payroll declaration by the 20th of the next month.')}</CardDescription></CardHeader>
          <CardContent className="overflow-x-auto p-0">
            {cal.isLoading ? <Skeleton className="m-4 h-40" /> : cal.isError ? <ErrorState compact error={cal.error} onRetry={() => void cal.refetch()} /> : !calendar.length ? <EmptyState icon={CalendarClock} compact title={t('Nothing due yet')} /> : (
              <Table>
                <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Obligation')}</TableHead><TableHead>{t('Period')}</TableHead><TableHead>{t('Due')}</TableHead>
                  <TableHead>{t('Status')}</TableHead><TableHead className="text-right">{t('Amount')}</TableHead></TableRow></TableHeader>
                <TableBody>{calendar.map((c) => {
                  const late = c.status === 'overdue'
                  return (
                    <TableRow key={`${c.obligation}-${c.period_start}`}>
                      <TableCell className="font-medium">{c.obligation === 'vat' ? t('VAT return') : t('Payroll declaration')}</TableCell>
                      <TableCell>{monthLabel(c.period_start.slice(0, 7))}</TableCell>
                      <TableCell className={cn('tabular', late && 'text-destructive')}>{formatDate(c.due_date)}</TableCell>
                      <TableCell>
                        {c.document_id
                          ? <Link to={c.obligation === 'vat' ? `/tax/declarations/${c.document_id}` : `/hr/payroll/${c.document_id}`} className="inline-flex items-center gap-1.5 hover:underline">
                              <StatusBadge status={c.status} /><span className="text-xs text-muted-foreground">{c.document_number}</span></Link>
                          : <StatusBadge status={c.status} label={c.status === 'open' ? t('Not started') : undefined} />}
                      </TableCell>
                      <TableCell className="text-right tabular">{c.amount !== null ? formatMoney(c.amount) : '—'}</TableCell>
                    </TableRow>
                  )
                })}</TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <div className="grid content-start gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle>{t('Accounting check')}</CardTitle><CardDescription>{t('This month\'s books compared with the VAT booked in accounting.')}</CardDescription></CardHeader>
            <CardContent className="grid gap-3">
              {!p ? <Skeleton className="h-24" /> : <>
                <TieOut label={t('Output VAT')} book={num(p.output_vat) - num(p.ledger.credit_notes_moved) - num(p.ledger.open_pos_vat)} ledger={num(p.ledger.output_vat)} diff={num(p.ledger.output_difference)}
                  note={num(p.ledger.open_pos_vat) ? t('{amount} of till VAT is in open shifts; it is booked with the Z-report.', { amount: formatMoney(p.ledger.open_pos_vat) }) : undefined} />
                <TieOut label={t('Input VAT')} book={num(p.input_vat) - num(p.ledger.credit_notes_moved)} ledger={num(p.ledger.input_vat)} diff={num(p.ledger.input_difference)} />
              </>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row items-start justify-between space-y-0 pb-2">
              <div><CardTitle>{t('Fiscalization')}</CardTitle>
                <CardDescription>{fiscal.data?.enabled ? (fiscal.data.environment === 'production' ? t('Live mode') : t('Test mode')) : t('Not turned on for this company')}</CardDescription></div>
              <Button variant="ghost" size="sm" asChild><Link to="/tax/fiscalization"><Fingerprint /> {t('Open')}</Link></Button>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-[13px]">
              {fiscal.isLoading ? <Skeleton className="col-span-2 h-16" /> : <>
                <Kpi label={t('Waiting')} value={fiscal.data?.pending ?? 0} warn={!!fiscal.data?.pending} />
                <Kpi label={t('Failed')} value={fiscal.data?.failed ?? 0} bad={!!fiscal.data?.failed} />
                <Kpi label={t('Fiscalized today')} value={fiscal.data?.fiscalized_today ?? 0} />
                <Kpi label={t('Issued offline')} value={fiscal.data?.subsequent ?? 0} />
              </>}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="mt-4">
        <CardHeader className="flex-row items-start justify-between space-y-0 pb-2">
          <div><CardTitle>{t('Declarations')}</CardTitle><CardDescription>{t('Monthly VAT returns. Submitting one books it and closes the month for VAT.')}</CardDescription></div>
          <Button variant="ghost" size="sm" asChild><Link to="/tax/declarations"><ClipboardPen /> {t('All declarations')}</Link></Button>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {decl.isLoading ? <Skeleton className="m-4 h-24" /> : !decl.data?.length
            ? <EmptyState compact icon={ClipboardPen} title={t('No declarations yet')} description={t('Create the declaration for {month} from its books.', { month: monthLabel(previousMonth()) })} />
            : (
              <Table>
                <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Number')}</TableHead><TableHead>{t('Period')}</TableHead><TableHead>{t('Status')}</TableHead>
                  <TableHead className="text-right">{t('Output VAT')}</TableHead><TableHead className="text-right">{t('Input VAT')}</TableHead><TableHead className="text-right">{t('To pay')}</TableHead>
                  <TableHead className="text-right">{t('Credit carried')}</TableHead></TableRow></TableHeader>
                <TableBody>{decl.data.slice(0, 5).map((d) => (
                  <TableRow key={d.id}>
                    <TableCell><Link to={`/tax/declarations/${d.id}`} className="font-medium text-primary hover:underline">{d.number}</Link></TableCell>
                    <TableCell>{monthLabel(d.period_start.slice(0, 7))}</TableCell>
                    <TableCell><StatusBadge status={d.status} /></TableCell>
                    <TableCell className="text-right tabular">{formatMoney(d.output_vat)}</TableCell>
                    <TableCell className="text-right tabular">{formatMoney(d.input_vat)}</TableCell>
                    <TableCell className="text-right tabular font-medium">{formatMoney(d.payable)}</TableCell>
                    <TableCell className="text-right tabular text-muted-foreground">{num(d.carry_forward) ? formatMoney(d.carry_forward) : '—'}</TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            )}
        </CardContent>
      </Card>
      <NewDeclarationDialog open={newOpen} onOpenChange={setNewOpen} />
    </>
  )
}

function Kpi({ label, value, warn, bad }: { label: string; value: number; warn?: boolean; bad?: boolean }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn('tabular text-lg font-semibold', warn && 'text-warning', bad && 'text-destructive')}>{value}</div>
    </div>
  )
}
