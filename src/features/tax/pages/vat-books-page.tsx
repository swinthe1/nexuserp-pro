import { FileSpreadsheet } from 'lucide-react'
import * as React from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { ExportMenu } from '@/components/export-menu'
import { PageHeader } from '@/components/page-header'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { XlsxColumn } from '@/lib/export'
import { ErrorState } from '@/components/error-state'
import { getLocale, t, tn, tServer } from '@/i18n'
import { cn, formatDate, formatMoney, num } from '@/lib/utils'
import { type BookRow, type LayoutCol, layoutLabel, monthLabel, monthRange, previousMonth, useCompanyTaxProfile, useVatBook, useVatLayout } from '../api'
import { MonthPicker } from '../components/tax-ui'

export function VatBooksPage() {
  const [params, setParams] = useSearchParams()
  const { company } = useCompany()
  const book = params.get('book') === 'purchase' ? 'purchase' : 'sales'
  const ym = params.get('month') ?? (params.get('from') ? params.get('from')!.slice(0, 7) : previousMonth())
  const range = params.get('from') && params.get('to') ? { from: params.get('from')!, to: params.get('to')! } : monthRange(ym)
  const layout = useVatLayout()
  const data = useVatBook(book, range.from, range.to)
  const profile = useCompanyTaxProfile()
  const xk = company?.country_code === 'XK'
  const cols: LayoutCol[] = (book === 'sales' ? layout.data?.sales_cols : layout.data?.purchase_cols) ?? []
  // the official Albanian titles come from the layout; English shows the English name
  const bookTitle = (b: 'sales' | 'purchase') => getLocale() === 'sq'
    ? ((b === 'sales' ? layout.data?.sales_title : layout.data?.purchase_title) ?? (b === 'sales' ? t('Sales book') : t('Purchase book')))
    : (b === 'sales' ? t('Sales book') : t('Purchase book'))
  const title = bookTitle(book)
  const rows = data.data ?? []
  const totals = React.useMemo(() => {
    const sum: Record<string, number> = { total: 0 }
    for (const r of rows) { sum.total! += num(r.total); for (const c of cols) sum[c.key] = (sum[c.key] ?? 0) + num(r.cols?.[c.key]) }
    return sum
  }, [rows, cols])
  const set = (k: string, v: string) => setParams((p) => { p.set(k, v); if (k === 'month') { p.delete('from'); p.delete('to') } return p })
  const taxLabel = xk ? 'NUI' : 'NIPT'
  const showFiscal = book === 'sales'
  const colLabel = (c: LayoutCol) => (xk ? `[${c.key}] ` : '') + layoutLabel(c)
  const periodText = params.get('from') ? `${formatDate(range.from)} – ${formatDate(range.to)}` : monthLabel(ym)

  const exportCols: XlsxColumn<BookRow>[] = [
    { header: t('No.|register'), value: (r) => r.line_no, format: 'int', width: 5 },
    { header: t('Date'), value: (r) => formatDate(r.doc_date), width: 11 },
    { header: t('Number'), value: (r) => tServer(r.number) },
    { header: book === 'sales' ? t('Note') : t('Vendor invoice / DUD'), value: (r) => r.ref },
    ...(showFiscal ? [{ header: xk ? t('Fiscal code') : t('NIVF'), value: (r: BookRow) => r.fiscal_code, format: 'text' as const }] : []),
    { header: book === 'sales' ? t('Buyer') : t('Seller'), value: (r) => tServer(r.partner) },
    { header: taxLabel, value: (r) => r.tax_number, format: 'text' },
    ...cols.map((c): XlsxColumn<BookRow> => ({ header: colLabel(c), value: (r) => r.cols?.[c.key] ?? null, format: 'money' })),
    { header: t('Total with VAT'), value: (r) => num(r.total), format: 'money' },
  ]
  const exportTotals: Record<string, number | string> = { [t('No.|register')]: t('Total'), [t('Total with VAT')]: totals.total ?? 0 }
  for (const c of cols) exportTotals[colLabel(c)] = totals[c.key] ?? 0

  return (
    <>
      <PageHeader title={t('Sales and purchase books')}
        description={xk ? t('Columns are numbered like the fields of the ATK VAT return. Credit notes you issue go in the purchase book ([53]–[56]); credit notes you receive go in the sales book ([16]–[19]).')
                        : t('Every final document of the period by VAT type, in the layout of the DPT books. Credit notes are negative; till sales are daily totals per till.')}
        actions={<>
          <MonthPicker value={ym} onChange={(v) => set('month', v)} />
          <ExportMenu rows={rows} columns={exportCols} filename={`${book === 'sales' ? t('sales-book|file') : t('purchase-book|file')}-${ym}`} title={title}
            subtitle={`${profile.data?.legal_name ?? profile.data?.name ?? company?.name ?? ''} · ${taxLabel} ${profile.data?.tax_number ?? '—'} · ${periodText}`}
            xlsx={{ title: [profile.data?.legal_name ?? profile.data?.name ?? '', `${taxLabel} ${profile.data?.tax_number ?? '—'}`, `${title} · ${periodText}`], totals: exportTotals }} />
        </>} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border p-0.5" role="tablist" aria-label={t('Book')}>
          {(['sales', 'purchase'] as const).map((b) => (
            <button key={b} role="tab" aria-selected={book === b} onClick={() => set('book', b)}
              className={cn('h-8 rounded px-3 text-[13px] font-medium transition-colors', book === b ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground')}>
              {bookTitle(b)}
            </button>
          ))}
        </div>
        <span className="text-[13px] text-muted-foreground">{periodText} · {tn(rows.length, '{n} line', '{n} lines')} · {t('amounts in {currency}', { currency: company?.base_currency ?? '' })}</span>
      </div>

      <Card className="overflow-hidden">
        {data.isLoading || layout.isLoading ? <Skeleton className="m-4 h-64" /> : data.error ? (
          <ErrorState error={data.error} onRetry={() => void data.refetch()} />
        ) : !rows.length ? (
          <EmptyState icon={FileSpreadsheet} title={t('Nothing in the {book} for {period}', { book: title, period: periodText })} description={t('Only final invoices, purchase invoices, till receipts and customs declarations appear here.')} />
        ) : (
          <div className="max-h-[calc(100dvh-260px)] overflow-auto">
            <table className="w-full border-separate border-spacing-0 text-[13px]">
              <thead className="sticky top-0 z-10 bg-card">
                <tr className="align-bottom">
                  <Th className="w-10 text-right">{t('No.|register')}</Th>
                  <Th>{t('Date')}</Th>
                  <Th>{t('Number')}</Th>
                  <Th>{book === 'sales' ? t('Note') : t('Vendor invoice / DUD')}</Th>
                  {showFiscal && <Th>{xk ? t('Fiscal code') : t('NIVF')}</Th>}
                  <Th className="min-w-[180px]">{book === 'sales' ? t('Buyer') : t('Seller')}</Th>
                  <Th>{taxLabel}</Th>
                  {cols.map((c) => (
                    <Th key={c.key} className={cn('min-w-[112px] text-right', c.vat && 'bg-muted/40')}>
                      {xk && <span className="block font-mono text-xs text-foreground">[{c.key}]</span>}
                      <span className="block leading-tight text-foreground">{layoutLabel(c)}</span>
                    </Th>
                  ))}
                  <Th className="text-right">{t('Total with VAT')}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.line_no}`} className={cn('hover:bg-muted/40', r.doc_type === 'credit_note' || r.doc_type === 'vendor_credit' ? 'text-muted-foreground' : '')}>
                    <Td className="text-right tabular text-muted-foreground">{r.line_no}</Td>
                    <Td className="whitespace-nowrap tabular">{formatDate(r.doc_date)}</Td>
                    <Td className="whitespace-nowrap">{r.href ? <Link to={r.href} className="font-medium text-primary hover:underline">{tServer(r.number)}</Link> : tServer(r.number)}</Td>
                    <Td className="whitespace-nowrap text-muted-foreground">{r.ref ?? ''}</Td>
                    {showFiscal && <Td className="max-w-[140px] truncate font-mono text-xs text-muted-foreground" title={r.fiscal_code ?? ''}>{r.fiscal_code ? `${r.fiscal_code.slice(0, 8)}…` : ''}</Td>}
                    <Td className="max-w-[240px] truncate">{tServer(r.partner)}</Td>
                    <Td className="whitespace-nowrap tabular text-muted-foreground">{r.tax_number ?? ''}</Td>
                    {cols.map((c) => {
                      const v = r.cols?.[c.key]
                      return <Td key={c.key} className={cn('text-right tabular', c.vat && 'bg-muted/40', num(v) < 0 && 'text-destructive')}>{v === undefined || v === null ? '' : formatMoney(v)}</Td>
                    })}
                    <Td className="text-right tabular font-medium">{formatMoney(r.total)}</Td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="sticky bottom-0 bg-card">
                <tr className="font-semibold">
                  <Td className="border-t-2" colSpan={showFiscal ? 7 : 6}>{t('Total')}</Td>
                  {cols.map((c) => <Td key={c.key} className={cn('border-t-2 text-right tabular', c.vat && 'bg-muted/40')}>{totals[c.key] ? formatMoney(totals[c.key]) : ''}</Td>)}
                  <Td className="border-t-2 text-right tabular">{formatMoney(totals.total)}</Td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={cn('border-b px-3 py-2 text-left text-xs font-medium text-muted-foreground', className)}>{children}</th>
}
function Td({ children, className, colSpan, title }: { children?: React.ReactNode; className?: string; colSpan?: number; title?: string }) {
  return <td colSpan={colSpan} title={title} className={cn('border-b px-3 py-1.5', className)}>{children}</td>
}
