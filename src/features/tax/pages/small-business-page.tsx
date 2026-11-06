import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageTableExport } from '@/components/page-table-export'
import { TriangleAlert } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Can, useCompany } from '@/app/company-provider'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { msg, t } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn, formatDate, formatMoney } from '@/lib/utils'

type Quarter = { quarter: number; from: string; to: string; income: number; purchases: number; documents: number; tax: number | null; due: string; closed: boolean }
type Data = { year: number; rate: number | null; quarters: Quarter[]; income: number; tax: number | null; limit: number; over_limit: boolean; currency: string; country: string }

const RATES = [
  { value: '3', label: '3%', hint: msg('Trade, transport, farming and similar') },
  { value: '9', label: '9%', hint: msg('Services, professions, entertainment') },
]

/** Tax › Small business: the quarterly tax on gross income of a business not registered for VAT. */
export function SmallBusinessPage() {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const now = new Date().getFullYear()
  const year = Number(params.get('year') ?? now)
  const q = useQuery({ queryKey: ['small-business', companyId, year], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('small_business_tax', { p_company: companyId!, p_year: year })) as unknown as Data })
  const setRate = useMutation({
    mutationFn: async (rate: number | null) => unwrap(await supabase.rpc('set_small_business_rate', { p_company: companyId!, p_rate: rate as number })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['small-business', companyId] }),
    onError: (e) => toast.error(describeError(e)),
  })
  const d = q.data
  // a business registered for VAT does not pay this tax: say so before anything else
  const vat = useQuery({ queryKey: ['company-vat-number', companyId], enabled: !!companyId, staleTime: 10 * 60_000,
    queryFn: async () => unwrap(await supabase.from('companies').select('vat_number').eq('id', companyId!).single()).vat_number as string | null })
  return (
    <>
      <PageHeader title={t('Small business tax')}
        description={t('A business not registered for VAT pays a tax on its gross income every quarter: 3% for trade, transport and farming, 9% for services and professions. The income comes from the same documents as the sales book.')}
        actions={<><PageTableExport />{<>
          <Select value={String(year)} onValueChange={(v) => setParams({ year: v })}>
            <SelectTrigger className="w-28" aria-label={t('Year')}><SelectValue /></SelectTrigger>
            <SelectContent>{[now, now - 1, now - 2].map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
          </Select>
        </>}</>} />
      {vat.data && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-info/40 bg-info/5 px-4 py-3 text-sm">
          <span className="flex-1">{t('This business is registered for VAT (number {n}), so it does not pay the small business tax: it declares VAT every month.', { n: vat.data })}</span>
          <Button variant="outline" size="sm" asChild><Link to="/tax/declarations">{t('VAT declarations')}</Link></Button>
        </div>
      )}
      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !d ? <Skeleton className="h-72" /> : <div className="grid gap-4">
        <Card><CardContent className="grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
          <div>
            <div className="font-medium">{t('The rate of this business')}</div>
            <div className="text-[13px] text-muted-foreground">{d.rate == null ? t('Choose the rate for the kind of work the business does.') : RATES.find((r) => Number(r.value) === Number(d.rate))?.hint ? t(RATES.find((r) => Number(r.value) === Number(d.rate))!.hint) : ''}</div>
          </div>
          <Can perm="tax.write">
            <div className="flex flex-wrap gap-1.5">
              {RATES.map((r) => (
                <button key={r.value} type="button" disabled={setRate.isPending} onClick={() => setRate.mutate(Number(r.value))}
                  className={cn('rounded-full border px-4 py-1.5 text-sm', Number(d.rate) === Number(r.value) ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted')}>
                  {r.label} <span className="hidden text-xs opacity-80 sm:inline">· {t(r.hint)}</span></button>
              ))}
              {d.rate != null && <button type="button" onClick={() => setRate.mutate(null)} className="rounded-full px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-muted">{t('Registered for VAT')}</button>}
            </div>
          </Can>
        </CardContent></Card>

        {d.over_limit && <div className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-[13px]">
          <TriangleAlert className="size-4 shrink-0 text-warning" />
          {t('The income of {year} is above {limit}: the business must register for VAT and keep the full books.', { year: d.year, limit: formatMoney(d.limit) })}</div>}

        <Card className="overflow-hidden"><Table>
          <TableHeader><TableRow>
            <TableHead>{t('Quarter')}</TableHead><TableHead className="text-right">{t('Documents')}</TableHead>
            <TableHead className="text-right">{t('Gross income (with VAT)')}</TableHead><TableHead className="hidden text-right sm:table-cell">{t('Purchases (with VAT)')}</TableHead>
            <TableHead className="text-right">{t('Tax')}</TableHead><TableHead className="hidden text-right sm:table-cell">{t('Due by')}</TableHead><TableHead />
          </TableRow></TableHeader>
          <TableBody>{d.quarters.map((x) => (
            <TableRow key={x.quarter}>
              <TableCell className="font-medium">{t('Q{n}', { n: x.quarter })} <span className="text-xs font-normal text-muted-foreground">{formatDate(x.from)} – {formatDate(x.to)}</span></TableCell>
              <TableCell className="text-right tabular">{x.documents}</TableCell>
              <TableCell className="text-right tabular">{formatMoney(x.income)}</TableCell>
              <TableCell className="hidden text-right tabular text-muted-foreground sm:table-cell">{formatMoney(x.purchases)}</TableCell>
              <TableCell className="text-right font-semibold tabular">{x.tax == null ? '—' : formatMoney(x.tax)}</TableCell>
              <TableCell className={cn('hidden text-right sm:table-cell', x.closed && x.tax ? 'font-medium' : 'text-muted-foreground')}>{formatDate(x.due)}</TableCell>
              <TableCell className="text-right"><Link className="text-[13px] text-primary hover:underline" to={`/tax/books?from=${x.from}&to=${x.to}`}>{t('Sales book')}</Link></TableCell>
            </TableRow>
          ))}</TableBody>
          <TableFooter><TableRow>
            <TableCell>{t('Year {year}', { year: d.year })}</TableCell><TableCell />
            <TableCell className="text-right tabular">{formatMoney(d.income)}</TableCell><TableCell className="hidden sm:table-cell" />
            <TableCell className="text-right tabular">{d.tax == null ? '—' : formatMoney(d.tax)}</TableCell><TableCell className="hidden sm:table-cell" /><TableCell />
          </TableRow></TableFooter>
        </Table></Card>
        <p className="text-xs text-muted-foreground">{t('The tax is declared and paid by the 15th of the month after the quarter. Check the rates against the law in force; amounts in {currency}.', { currency: d.currency })}</p>
      </div>}
    </>
  )
}
