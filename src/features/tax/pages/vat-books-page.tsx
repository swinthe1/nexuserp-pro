import { FileSpreadsheet, Printer, Search, X } from 'lucide-react'
import * as React from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { ExportMenu } from '@/components/export-menu'
import { PageHeader } from '@/components/page-header'
import { MultiPick } from '@/components/multi-pick'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { printTable } from '@/lib/print-table'
import { Skeleton } from '@/components/ui/skeleton'
import type { XlsxColumn } from '@/lib/export'
import { ErrorState } from '@/components/error-state'
import { formatDateWith, getLocale, t, tn, tServer } from '@/i18n'
import { cn, formatDate, formatMoney, num } from '@/lib/utils'
import { type BookRow, type LayoutCol, layoutLabel, monthLabel, monthRange, previousMonth, useCompanyTaxProfile, useVatBook, useVatLayout } from '../api'
import { atkHead, atkLayout, atkValues, exportAtkBook } from '../atk-book-xlsx'
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
  const all = data.data ?? []
  // the book's filters: a search, the partners, invoices or credit notes, the VAT columns that have an amount
  const [q, setQ] = React.useState('')
  const [partners, setPartners] = React.useState<string[]>([])
  const [kind, setKind] = React.useState<'all' | 'docs' | 'credits'>('all')
  const [withCols, setWithCols] = React.useState<string[]>([])
  const isCredit = (r: BookRow) => r.doc_type === 'credit_note' || r.doc_type === 'vendor_credit' || num(r.total) < 0
  const rows = React.useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return all.filter((r) => (!partners.length || partners.includes(r.partner ?? ''))
      && (kind === 'all' || (kind === 'credits') === isCredit(r))
      && (!withCols.length || withCols.some((k) => num(r.cols?.[k]) !== 0))
      && (!words.length || words.every((w) => `${tServer(r.number)} ${r.ref ?? ''} ${tServer(r.partner)} ${r.partner === 'Retail customers' ? t('Physical buyer') : ''} ${r.tax_number ?? ''} ${r.fiscal_code ?? ''}`.toLowerCase().includes(w))))
  }, [all, q, partners, kind, withCols]) // eslint-disable-line react-hooks/exhaustive-deps
  const filtering = !!(q.trim() || partners.length || kind !== 'all' || withCols.length)
  const partnerOptions = React.useMemo(() => [...new Set(all.map((r) => r.partner ?? '').filter(Boolean))].sort((a, b) => a.localeCompare(b))
    .map((p) => ({ value: p, label: xk && p === 'Retail customers' ? t('Physical buyer') : tServer(p) })), [all, xk])
  const totals = React.useMemo(() => {
    const sum: Record<string, number> = { total: 0 }
    for (const r of rows) { sum.total! += num(r.total); for (const c of cols) sum[c.key] = (sum[c.key] ?? 0) + num(r.cols?.[c.key]) }
    return sum
  }, [rows, cols])
  // on the screen the columns with nothing in them this period step aside, so the book fits; the
  // export and the print keep every column of the official layout
  const [allCols, setAllCols] = React.useState(false)
  const filled = cols.filter((c) => all.some((r) => num(r.cols?.[c.key]) !== 0))
  const shown = allCols ? cols : filled
  const set = (k: string, v: string) => setParams((p) => { p.set(k, v); if (k === 'month') { p.delete('from'); p.delete('to') } return p })
  const taxLabel = xk ? 'NUI' : 'NIPT'
  // Kosovo: no fiscal code in the book; a sale to a person carries "Blerës fizik" and the number 1 where the NUI goes (ATK's rule)
  const showFiscal = book === 'sales' && !xk
  const partnerOf = (r: BookRow) => (xk && r.partner === 'Retail customers' ? t('Physical buyer') : tServer(r.partner))
  const taxOf = (r: BookRow) => r.tax_number || (xk && book === 'sales' ? '1' : null)
  const numberOf = (r: BookRow) => (book === 'purchase' && r.ref ? tServer(r.ref) : tServer(r.number))
  // Kosovo: the book on the screen in ATK's own layout (the groups, the boxes of the return, VAT by ATK's formulas)
  const atk = xk ? atkLayout(book) : null
  const head = atkHead(book)
  const atkRows = React.useMemo(() => (atk ? rows.map((r) => atkValues(atk, r)) : []), [atk, rows])
  const atkTotals = atk ? atk.cols.map((_, i) => atkRows.reduce((a, v) => a + (v[i] ?? 0), 0)) : []
  const atkShown = atk ? atk.cols.map((_, i) => i).filter((i) => allCols || atkRows.some((v) => Math.abs(v[i] ?? 0) > 0.004)) : []
  const atkHidden = atk ? atk.cols.length - atkShown.length : 0
  const colLabel = (c: LayoutCol) => (xk ? `[${c.key}] ` : '') + layoutLabel(c)
  const periodText = params.get('from') ? `${formatDate(range.from)} – ${formatDate(range.to)}` : monthLabel(ym)

  // Excel keeps every column of the official layout; the paper and the PDF only the columns with something
  // in them this period (as on the screen), so the book fits an A4 page
  const bookCols = (which: LayoutCol[], paper: boolean): XlsxColumn<BookRow>[] => [
    { header: t('No.|register'), value: (r) => r.line_no, format: 'int', width: 5 },
    { header: t('Date'), value: (r) => (paper ? formatDateWith(new Date(`${r.doc_date}T12:00:00`), { day: '2-digit', month: '2-digit', year: 'numeric' }) : formatDate(r.doc_date)), width: 11 },
    { header: t('Number'), value: (r) => tServer(r.number) },
    { header: book === 'sales' ? t('Note') : t('Vendor invoice / DUD'), value: (r) => (r.ref ? tServer(r.ref) : r.ref) },
    ...(showFiscal ? [{ header: xk ? t('Fiscal code') : t('NIVF'), value: (r: BookRow) => r.fiscal_code, format: 'text' as const }] : []),
    { header: book === 'sales' ? t('Buyer') : t('Seller'), value: (r) => partnerOf(r) },
    { header: taxLabel, value: (r) => taxOf(r), format: 'text' },
    ...which.map((c): XlsxColumn<BookRow> => ({ header: colLabel(c), value: (r) => r.cols?.[c.key] ?? null, format: 'money' })),
    { header: t('Total with VAT'), value: (r) => num(r.total), format: 'money' },
  ]
  const exportCols = bookCols(cols, false)
  const paperCols = bookCols(shown, true)
  const nowrapCols = new Set([t('No.|register'), t('Date'), t('Number'), taxLabel, book === 'sales' ? t('Note') : t('Vendor invoice / DUD')])
  const exportTotals: Record<string, number | string> = { [t('No.|register')]: t('Total'), [t('Total with VAT')]: totals.total ?? 0 }
  for (const c of cols) exportTotals[colLabel(c)] = totals[c.key] ?? 0

  return (
    <>
      <PageHeader title={t('Sales and purchase books')}
        description={xk ? t('Columns are numbered like the fields of the ATK VAT return. Credit notes you issue go in the purchase book ([53]–[56]); credit notes you receive go in the sales book ([16]–[19]).')
                        : t('Every final document of the period by VAT type, in the layout of the DPT books. Credit notes are negative; till sales are daily totals per till.')}
        actions={<>
          <MonthPicker value={ym} onChange={(v) => set('month', v)} />
          <Button variant="outline" size="sm" disabled={!rows.length} onClick={() => printTable({ title, subtitle: `${profile.data?.legal_name ?? profile.data?.name ?? company?.name ?? ''} · ${taxLabel} ${profile.data?.tax_number ?? '—'} · ${periodText}`,
            columns: paperCols.map((c) => ({ header: c.header, format: c.format === 'money' ? 'money' : c.format === 'int' ? 'int' : 'text', nowrap: nowrapCols.has(c.header) })),
            rows: rows.map((r) => paperCols.map((c) => c.value(r))), totals: paperCols.map((c) => exportTotals[c.header] ?? null) })}><Printer /> {t('Print')}</Button>
          {/* the file as ATK's own sample: its headings, its boxes, its formulas */}
          {xk && <Button variant="outline" size="sm" disabled={!rows.length} title={t('The Excel file in the layout of ATK’s sample book')}
            onClick={() => void exportAtkBook(book, rows, `${book === 'sales' ? t('sales-book|file') : t('purchase-book|file')}-${ym}`,
              numberOf, partnerOf, taxOf)}><FileSpreadsheet /> {t('Excel, ATK layout')}</Button>}
          <ExportMenu rows={rows} columns={exportCols} pdfColumns={paperCols} filename={`${book === 'sales' ? t('sales-book|file') : t('purchase-book|file')}-${ym}`} title={title}
            subtitle={`${profile.data?.legal_name ?? profile.data?.name ?? company?.name ?? ''} · ${taxLabel} ${profile.data?.tax_number ?? '—'} · ${periodText}`}
            xlsx={{ title: [profile.data?.legal_name ?? profile.data?.name ?? '', `${taxLabel} ${profile.data?.tax_number ?? '—'}`, `${title} · ${periodText}`], totals: exportTotals }} />
        </>} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex max-w-full overflow-x-auto rounded-md border p-0.5" role="tablist" aria-label={t('Book')}>
          {(['sales', 'purchase'] as const).map((b) => (
            <button key={b} role="tab" aria-selected={book === b} onClick={() => set('book', b)}
              className={cn('h-8 rounded px-3 text-[13px] font-medium transition-colors', book === b ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground')}>
              {bookTitle(b)}
            </button>
          ))}
        </div>
        <span className="text-[13px] text-muted-foreground">{periodText} · {filtering ? t('{n} of {total} lines', { n: rows.length, total: all.length }) : tn(rows.length, '{n} line', '{n} lines')} · {t('amounts in {currency}', { currency: company?.base_currency ?? '' })}</span>
        {(atk ? atkHidden > 0 || allCols : cols.length > filled.length) && rows.length > 0 && (
          <button type="button" className="ml-auto text-[13px] text-primary hover:underline" onClick={() => setAllCols((x) => !x)}>
            {allCols ? t('Hide the empty columns') : tn(atk ? atkHidden : cols.length - filled.length, 'Show the {n} empty column too', 'Show the {n} empty columns too')}
          </button>
        )}
      </div>

      {all.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative w-64 max-w-full"><Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="h-9 pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Number, partner, {tax}…', { tax: taxLabel })} aria-label={t('Search')} /></div>
          <MultiPick label={book === 'sales' ? t('Buyer') : t('Seller')} value={partners} onChange={setPartners} options={partnerOptions} />
          <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
            <SelectTrigger className="h-9 w-48" aria-label={t('Documents')}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('All documents')}</SelectItem>
              <SelectItem value="docs">{t('Invoices only')}</SelectItem>
              <SelectItem value="credits">{t('Credit notes only')}</SelectItem>
            </SelectContent>
          </Select>
          <MultiPick label={t('With an amount in')} value={withCols} onChange={setWithCols} options={filled.map((c) => ({ value: c.key, label: colLabel(c) }))} />
          {filtering && <Button variant="ghost" size="sm" onClick={() => { setQ(''); setPartners([]); setKind('all'); setWithCols([]) }}><X /> {t('Clear filters')}</Button>}
        </div>
      )}

      <Card className="overflow-hidden">
        {data.isLoading || layout.isLoading ? <Skeleton className="m-4 h-64" /> : data.error ? (
          <ErrorState error={data.error} onRetry={() => void data.refetch()} />
        ) : all.length > 0 && !rows.length ? (
          <EmptyState icon={Search} title={t('Nothing matches these filters')} description={t('Clear the search or filters to see everything.')} />
        ) : !rows.length ? (
          <EmptyState icon={FileSpreadsheet} title={t('Nothing in the {book} for {period}', { book: title, period: periodText })} description={t('Only final invoices, purchase invoices, till receipts and customs declarations appear here.')} />
        ) : (
          atk ? (
          <div className="max-h-[calc(100dvh-260px)] overflow-auto">
            <table className="w-full border-separate border-spacing-0 text-[13px]">
              <thead className="sticky top-0 z-10 bg-card">
                <tr className="text-center align-middle">
                  <Th rowSpan={2} className="w-10 text-center">{head.no}</Th>
                  <Th colSpan={2} className="text-center font-semibold text-foreground">{head.invoice}</Th>
                  <Th colSpan={3} className="text-center font-semibold text-foreground">{head.party}</Th>
                  {(() => { let at = 0; return atk.groups.map((g) => { const from = at; at += g.span; const n = atkShown.filter((i) => i >= from && i < from + g.span).length
                    return n ? <Th key={g.h} colSpan={n} className="text-center font-semibold text-foreground">{g.h}</Th> : null }) })()}
                  {atkShown.includes(atk.cols.length - 1) && <Th rowSpan={2} className="min-w-[84px] bg-muted/40 text-center text-foreground">{atk.cols[atk.cols.length - 1]!.h}</Th>}
                </tr>
                <tr className="text-center align-middle">
                  <Th className="text-center">{head.date}</Th><Th className="text-center">{head.number}</Th>
                  <Th className="min-w-[110px] text-center">{head.name}</Th>
                  <Th className="text-center">{head.fiscal}</Th>
                  <Th className="text-center">{head.vat}</Th>
                  {atkShown.filter((i) => i < atk.cols.length - 1).map((i) => <Th key={i} className={cn('min-w-[84px] text-center leading-tight text-foreground', atk.cols[i]!.f && 'bg-muted/40')}>{atk.cols[i]!.h}</Th>)}
                </tr>
                <tr className="bg-muted text-center">
                  <Th colSpan={6} className="bg-muted py-1 text-center">{head.boxes}</Th>
                  {atkShown.map((i) => <Th key={i} className="whitespace-nowrap bg-muted py-1 text-center font-mono text-foreground">{atk.cols[i]!.box}</Th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, n) => (
                  <tr key={`${r.line_no}`} className={cn('hover:bg-muted/40', isCredit(r) && 'text-muted-foreground')}>
                    <Td className="text-right tabular text-muted-foreground">{n + 1}</Td>
                    <Td className="whitespace-nowrap tabular">{formatDate(r.doc_date)}</Td>
                    <Td className="whitespace-nowrap">{r.href ? <Link to={r.href} className="font-medium text-primary hover:underline">{numberOf(r)}</Link> : numberOf(r)}</Td>
                    <Td className="min-w-[110px] leading-tight">{partnerOf(r)}</Td>
                    <Td className="whitespace-nowrap tabular text-muted-foreground">{taxOf(r) ?? ''}</Td>
                    <Td />
                    {atkShown.map((i) => { const v = atkRows[n]?.[i] ?? 0
                      return <Td key={i} className={cn('text-right tabular', atk.cols[i]!.f && 'bg-muted/40', v < -0.004 && 'text-destructive')}>{Math.abs(v) > 0.004 ? formatMoney(v) : ''}</Td> })}
                  </tr>
                ))}
              </tbody>
              <tfoot className="sticky bottom-0 bg-card">
                <tr className="font-semibold">
                  <Td className="border-t-2" colSpan={6}>{t('Total')}</Td>
                  {atkShown.map((i) => <Td key={i} className={cn('border-t-2 text-right tabular', atk.cols[i]!.f && 'bg-muted/40')}>{Math.abs(atkTotals[i] ?? 0) > 0.004 ? formatMoney(atkTotals[i]) : ''}</Td>)}
                </tr>
              </tfoot>
            </table>
          </div>
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
                  <Th className="min-w-[110px]">{book === 'sales' ? t('Buyer') : t('Seller')}</Th>
                  <Th>{taxLabel}</Th>
                  {shown.map((c) => (
                    <Th key={c.key} className={cn('min-w-[72px] text-right', c.vat && 'bg-muted/40')}>
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
                    <Td className="whitespace-nowrap text-muted-foreground">{r.ref ? tServer(r.ref) : ''}</Td>
                    {showFiscal && <Td className="max-w-[140px] truncate font-mono text-xs text-muted-foreground" title={r.fiscal_code ?? ''}>{r.fiscal_code ? `${r.fiscal_code.slice(0, 8)}…` : ''}</Td>}
                    <Td className="min-w-[110px] leading-tight">{tServer(r.partner)}</Td>
                    <Td className="whitespace-nowrap tabular text-muted-foreground">{r.tax_number ?? ''}</Td>
                    {shown.map((c) => {
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
                  {shown.map((c) => <Td key={c.key} className={cn('border-t-2 text-right tabular', c.vat && 'bg-muted/40')}>{totals[c.key] ? formatMoney(totals[c.key]) : ''}</Td>)}
                  <Td className="border-t-2 text-right tabular">{formatMoney(totals.total)}</Td>
                </tr>
              </tfoot>
            </table>
          </div>
          )
        )}
      </Card>
    </>
  )
}

function Th({ children, className, colSpan, rowSpan }: { children?: React.ReactNode; className?: string; colSpan?: number; rowSpan?: number }) {
  return <th colSpan={colSpan} rowSpan={rowSpan} className={cn('border-b px-2 py-2 text-left text-xs font-medium text-muted-foreground', className)}>{children}</th>
}
function Td({ children, className, colSpan, title }: { children?: React.ReactNode; className?: string; colSpan?: number; title?: string }) {
  return <td colSpan={colSpan} title={title} className={cn('border-b px-2 py-1.5', className)}>{children}</td>
}
