import type { ColumnDef, ColumnFiltersState, PaginationState, SortingState } from '@tanstack/react-table'
import { Archive } from 'lucide-react'
import * as React from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useCompany } from '@/app/company-provider'
import { ColumnHeader, DataTable } from '@/components/data-table/data-table'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useDebounce } from '@/hooks/use-debounce'
import { formatDateWith, msg, t, td, tn } from '@/i18n'
import { cn, formatCompact, formatDate, formatMoney, formatQty, num, todayISO } from '@/lib/utils'
import { type BalanceRow, type HistoryDoc, type HistoryPayment, useHistoryBalances, useHistoryDocument, useHistoryDocuments, useHistoryPayments, useHistorySummary } from './api'

const KIND: Record<string, { label: string; variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline' }> = {
  sale: { label: msg('Sale'), variant: 'default' },
  pos_sale: { label: msg('Till receipt'), variant: 'default' },
  sale_return: { label: msg('Customer return'), variant: 'warning' },
  purchase: { label: msg('Purchase'), variant: 'success' },
  purchase_return: { label: msg('Return to supplier'), variant: 'warning' },
  transfer: { label: msg('Transfer'), variant: 'secondary' },
  count: { label: msg('Stock count'), variant: 'secondary' },
  other: { label: msg('Other'), variant: 'outline' },
}
const PAY_KIND: Record<string, string> = { cash: msg('Cash book'), bank: msg('Bank'), payment: msg('Payment') }
const tooltipStyle = { background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }
const axisTick = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' }
const yearAgo = () => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); d.setDate(1); return d.toISOString().slice(0, 10) }

export function HistoryPage() {
  const { can } = useCompany()
  const summary = useHistorySummary('1900-01-01', '2999-12-31')
  const s = summary.data
  return (
    <>
      <PageHeader title={t('History from the old program')}
        description={s?.documents
          ? t('{n} documents from {from} to {to}. Kept as an archive: it does not change stock, the books or anything sent to the tax authority.', { n: num(s.documents).toLocaleString('sq'), from: formatDate(s.first_date), to: formatDate(s.last_date) })
          : t('Sales, receipts, purchases, payments and accounting from the program used before, kept as an archive.')} />
      {summary.isLoading ? <Skeleton className="h-40" /> : summary.error ? <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
        : !s?.documents && !s?.payments && !s?.accounts_months ? (
          <EmptyState icon={Archive} title={t('No history yet')} description={t('Run "Nis-Historikun.bat" on the server of the old program. It sends the history here in pieces and can be stopped and resumed.')} />
        ) : (
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">{t('Overview')}</TabsTrigger>
              <TabsTrigger value="documents">{t('Documents')}</TabsTrigger>
              <TabsTrigger value="payments">{t('Payments and cash')}</TabsTrigger>
              {can('finance.read') && <TabsTrigger value="accounts">{t('Accounting')}</TabsTrigger>}
            </TabsList>
            <TabsContent value="overview" className="mt-4"><Overview /></TabsContent>
            <TabsContent value="documents" className="mt-4"><Documents /></TabsContent>
            <TabsContent value="payments" className="mt-4"><Payments /></TabsContent>
            {can('finance.read') && <TabsContent value="accounts" className="mt-4"><Accounts /></TabsContent>}
          </Tabs>
        )}
    </>
  )
}

function Range({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="grid gap-1.5"><Label htmlFor="h-from">{t('From')}</Label><Input id="h-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></div>
      <div className="grid gap-1.5"><Label htmlFor="h-to">{t('To')}</Label><Input id="h-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></div>
    </div>
  )
}

/* ------------------------------------------------------------------ overview */
function Overview() {
  const { company } = useCompany()
  const [from, setFrom] = React.useState(yearAgo())
  const [to, setTo] = React.useState(todayISO())
  const q = useHistorySummary(from, to)
  const d = q.data
  const cur = company?.base_currency
  const months = (d?.by_month ?? []).map((m) => ({ month: formatDateWith(new Date(`${m.month}-01T00:00:00`), { month: 'short', year: '2-digit' }), sales: num(m.sales), purchases: num(m.purchases) }))
  const sales = months.reduce((s, m) => s + m.sales, 0)
  const purchases = months.reduce((s, m) => s + m.purchases, 0)
  const receipts = (d?.by_month ?? []).reduce((s, m) => s + num(m.receipts), 0)
  return (
    <div className="grid gap-4">
      <Range from={from} to={to} setFrom={setFrom} setTo={setTo} />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label={t('Sales (with VAT)')} value={formatMoney(sales, cur)} loading={q.isLoading} hint={tn(receipts, '{n} sale or receipt', '{n} sales and receipts')} />
        <StatCard label={t('Purchases (with VAT)')} value={formatMoney(purchases, cur)} loading={q.isLoading} />
        <StatCard label={t('Average sale (with VAT)')} value={formatMoney(receipts ? sales / receipts : 0, cur)} loading={q.isLoading} />
      </div>
      <Card>
        <CardHeader><CardTitle>{t('Sales and purchases by month')}</CardTitle><CardDescription>{t('With VAT, as on the documents of the old program')}</CardDescription></CardHeader>
        <CardContent>
          {q.isLoading ? <Skeleton className="h-64" /> : (
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={months} margin={{ left: -8, right: 4 }} barGap={2}>
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={axisTick} tickLine={false} axisLine={false} />
                  <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatCompact(v)} width={52} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'hsl(var(--muted))' }} formatter={(v: number, n: string) => [formatMoney(v, cur), n === 'sales' ? t('Sales') : t('Purchases')]} />
                  <Legend formatter={(v: string) => (v === 'sales' ? t('Sales') : t('Purchases'))} wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="sales" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="purchases" fill="hsl(var(--foreground) / 0.35)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>{t('Sales by store')}</CardTitle></CardHeader>
          <CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>{t('Store')}</TableHead><TableHead className="text-right">{t('Receipts')}</TableHead><TableHead className="text-right">{t('Sales with VAT')}</TableHead></TableRow></TableHeader>
            <TableBody>{(d?.by_store ?? []).map((r) => <TableRow key={r.store}><TableCell>{td(r.store)}</TableCell><TableCell className="text-right tabular">{num(r.receipts).toLocaleString('sq')}</TableCell><TableCell className="text-right tabular">{formatMoney(r.sales ?? 0)}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
        <Card><CardHeader><CardTitle>{t('Best-selling products')}</CardTitle></CardHeader>
          <CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>{t('Product')}</TableHead><TableHead className="text-right">{t('Quantity')}</TableHead><TableHead className="text-right">{t('Sales with VAT')}</TableHead></TableRow></TableHeader>
            <TableBody>{(d?.top_products ?? []).map((r) => <TableRow key={`${r.sku}-${r.name}`}><TableCell><span className="text-muted-foreground">{r.sku}</span> {r.name}</TableCell><TableCell className="text-right tabular">{formatQty(r.quantity)}</TableCell><TableCell className="text-right tabular">{formatMoney(r.amount)}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ documents */
function useServerTable(defaultSort: string) {
  const [pagination, setPagination] = React.useState<PaginationState>({ pageIndex: 0, pageSize: 50 })
  const [sorting, setSorting] = React.useState<SortingState>([{ id: defaultSort, desc: true }])
  const [globalFilter, setGlobalFilter] = React.useState('')
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
  const search = useDebounce(globalFilter, 300)
  const reset = () => setPagination((p) => ({ ...p, pageIndex: 0 }))
  return {
    pagination, sorting, search, columnFilters,
    server: (rowCount: number) => ({
      rowCount, pagination, onPaginationChange: setPagination,
      sorting, onSortingChange: (s: SortingState) => { setSorting(s); reset() },
      globalFilter, onGlobalFilterChange: (v: string) => { setGlobalFilter(v); reset() },
      columnFilters, onColumnFiltersChange: (f: ColumnFiltersState) => { setColumnFilters(f); reset() },
    }),
  }
}

function Documents() {
  const [from, setFrom] = React.useState('')
  const [to, setTo] = React.useState('')
  const [open, setOpen] = React.useState<string | null>(null)
  const st = useServerTable('doc_date')
  const kinds = (st.columnFilters.find((f) => f.id === 'kind')?.value as string[] | undefined) ?? []
  const q = useHistoryDocuments({ kind: kinds, from: from || undefined, to: to || undefined, q: st.search || undefined,
    offset: st.pagination.pageIndex * st.pagination.pageSize, limit: st.pagination.pageSize,
    sort: st.sorting[0]?.id === 'total' ? 'total' : 'date', desc: st.sorting[0]?.desc ?? true })
  const columns = React.useMemo<ColumnDef<HistoryDoc>[]>(() => [
    { accessorKey: 'doc_date', header: ({ column }) => <ColumnHeader column={column} title={t('Date')} />, meta: { label: t('Date') }, cell: ({ getValue }) => formatDate(getValue() as string) },
    { accessorKey: 'kind', enableSorting: false, header: t('Kind|history'), meta: { label: t('Kind|history') }, cell: ({ getValue }) => { const k = KIND[getValue() as string] ?? KIND.other!; return <Badge variant={k.variant}>{t(k.label)}</Badge> } },
    { accessorKey: 'number', enableSorting: false, header: t('Number'), meta: { label: t('Number') }, cell: ({ row: { original: d } }) => <div><div className="font-medium">{d.number}</div>{d.doc_type && <div className="text-xs text-muted-foreground">{d.doc_type}</div>}</div> },
    { accessorKey: 'partner_name', enableSorting: false, header: t('Partner'), meta: { label: t('Partner') }, cell: ({ getValue }) => (getValue() as string) || '—' },
    { accessorKey: 'warehouse_code', enableSorting: false, header: t('Store'), meta: { label: t('Store') }, cell: ({ getValue }) => (getValue() as string) || '—' },
    { accessorKey: 'cashier', enableSorting: false, header: t('Cashier'), meta: { label: t('Cashier') }, cell: ({ getValue }) => (getValue() as string) || '—' },
    { accessorKey: 'total', header: ({ column }) => <ColumnHeader column={column} title={t('Total with VAT')} />, meta: { label: t('Total with VAT'), align: 'right' }, cell: ({ getValue }) => <span className="tabular">{formatMoney(getValue() as number)}</span> },
  ], [])
  return (
    <div className="grid gap-3">
      <Range from={from} to={to} setFrom={setFrom} setTo={setTo} />
      <DataTable tableKey="history.documents" columns={columns} data={q.data?.rows} isLoading={q.isLoading} error={q.error} getRowId={(d) => d.id}
        searchPlaceholder={t('Number, customer or supplier')} onRowClick={(d) => setOpen(d.id)} exportName="history-documents"
        facets={[{ columnId: 'kind', title: t('Kind|history'), options: Object.entries(KIND).map(([value, k]) => ({ value, label: t(k.label) })) }]}
        server={st.server(q.data?.total_count ?? 0)}
        empty={{ title: t('No documents match'), description: t('Change the dates or the search.') }}
        footer={() => q.data ? <TableFooter><TableRow className="hover:bg-transparent"><TableCell colSpan={6} className="text-[13px]">{tn(q.data.total_count, '{n} document', '{n} documents')}</TableCell>
          <TableCell className="text-right tabular">{formatMoney(q.data.total_amount)}</TableCell></TableRow></TableFooter> : null} />
      <DocumentSheet id={open} onClose={() => setOpen(null)} />
    </div>
  )
}

function DocumentSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useHistoryDocument(id)
  const d = q.data
  const k = d ? KIND[d.kind] ?? KIND.other! : null
  // sales and purchases carry VAT; transfers and counts are at cost
  const trade = !!d && ['sale', 'pos_sale', 'sale_return', 'purchase', 'purchase_return'].includes(d.kind)
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">{d?.number ?? '…'} {k && <Badge variant={k.variant}>{t(k.label)}</Badge>}</SheetTitle>
          <SheetDescription>{d ? [formatDate(d.doc_date), d.doc_type, d.partner_name, d.warehouse_code && t('store {code}', { code: d.warehouse_code }), d.cashier].filter(Boolean).join(' · ') : ''}</SheetDescription>
        </SheetHeader>
        <div className="px-5 pb-8">
          {q.isLoading ? <Skeleton className="mt-4 h-40" /> : q.error ? <ErrorState error={q.error} /> : d && <>
            <Table className="mt-3">
              <TableHeader><TableRow><TableHead>{t('Product')}</TableHead><TableHead className="text-right">{t('Quantity')}</TableHead><TableHead className="text-right">{t('Price')}</TableHead><TableHead className="text-right">{trade ? t('Total with VAT') : t('Total')}</TableHead></TableRow></TableHeader>
              <TableBody>{d.lines.map((l) => (
                <TableRow key={l.id}><TableCell><div className="text-[13px] font-medium">{l.name}</div><div className="text-xs text-muted-foreground">{l.sku}{num(l.discount_pct) ? ` · −${num(l.discount_pct)}%` : ''}{l.tax_rate != null ? ` · ${t('VAT {rate}%', { rate: num(l.tax_rate) })}` : ''}</div></TableCell>
                  <TableCell className="text-right tabular">{formatQty(l.quantity)}</TableCell><TableCell className="text-right tabular">{l.unit_price == null ? '—' : formatMoney(l.unit_price)}</TableCell>
                  <TableCell className="text-right tabular">{l.total == null ? '—' : formatMoney(l.total)}</TableCell></TableRow>))}</TableBody>
            </Table>
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-[13px]">
              {d.net != null && <><dt className="text-muted-foreground">{t('Without VAT')}</dt><dd className="text-right tabular">{formatMoney(d.net)}</dd></>}
              {d.tax != null && <><dt className="text-muted-foreground">{t('VAT')}</dt><dd className="text-right tabular">{formatMoney(d.tax)}</dd></>}
              {num(d.discount) !== 0 && <><dt className="text-muted-foreground">{t('Discount')}</dt><dd className="text-right tabular">{formatMoney(d.discount)}</dd></>}
              <dt className="font-semibold">{trade ? t('Total with VAT') : t('Total')}</dt><dd className="text-right font-semibold tabular">{formatMoney(d.total)}</dd>
              {d.paid != null && num(d.paid) !== 0 && <><dt className="text-muted-foreground">{t('Paid')}</dt><dd className="text-right tabular">{formatMoney(d.paid)}</dd></>}
              {d.fiscal_code && <><dt className="text-muted-foreground">{t('Fiscal code')}</dt><dd className="truncate text-right font-mono text-xs">{d.fiscal_code}</dd></>}
            </dl>
            {d.description && <p className="mt-3 text-[13px] text-muted-foreground">{d.description}</p>}
          </>}
        </div>
      </SheetContent>
    </Sheet>
  )
}

/* ------------------------------------------------------------------ payments */
function Payments() {
  const { company } = useCompany()
  const [from, setFrom] = React.useState('')
  const [to, setTo] = React.useState('')
  const st = useServerTable('pay_date')
  const kinds = (st.columnFilters.find((f) => f.id === 'kind')?.value as string[] | undefined) ?? []
  const q = useHistoryPayments({ kind: kinds, from: from || undefined, to: to || undefined, q: st.search || undefined,
    offset: st.pagination.pageIndex * st.pagination.pageSize, limit: st.pagination.pageSize })
  const columns = React.useMemo<ColumnDef<HistoryPayment>[]>(() => [
    { accessorKey: 'pay_date', enableSorting: false, header: t('Date'), meta: { label: t('Date') }, cell: ({ getValue }) => formatDate(getValue() as string) },
    { accessorKey: 'kind', enableSorting: false, header: t('Kind|history'), meta: { label: t('Kind|history') }, cell: ({ getValue }) => t(PAY_KIND[getValue() as string] ?? '') },
    { accessorKey: 'number', enableSorting: false, header: t('Number'), meta: { label: t('Number') } },
    { accessorKey: 'book', enableSorting: false, header: t('Cash book or bank'), meta: { label: t('Cash book or bank') }, cell: ({ getValue }) => (getValue() as string) || '—' },
    { accessorKey: 'partner_name', enableSorting: false, header: t('Partner'), meta: { label: t('Partner') }, cell: ({ getValue }) => (getValue() as string) || '—' },
    { accessorKey: 'document', enableSorting: false, header: t('For'), meta: { label: t('For') }, cell: ({ row: { original: p } }) => <span className="text-[13px]">{p.document || p.description || '—'}</span> },
    { accessorKey: 'amount', enableSorting: false, header: t('Amount'), meta: { label: t('Amount'), align: 'right' },
      cell: ({ getValue }) => { const v = num(getValue()); return <span className={cn('tabular', v > 0 ? 'text-success' : 'text-destructive')}>{v > 0 ? '+' : ''}{formatMoney(v)}</span> } },
  ], [])
  return (
    <div className="grid gap-3">
      <Range from={from} to={to} setFrom={setFrom} setTo={setTo} />
      {q.data && <div className="grid gap-3 sm:grid-cols-2">
        <StatCard label={t('Money in')} value={formatMoney(q.data.money_in, company?.base_currency)} />
        <StatCard label={t('Money out')} value={formatMoney(q.data.money_out, company?.base_currency)} />
      </div>}
      <DataTable tableKey="history.payments" columns={columns} data={q.data?.rows} isLoading={q.isLoading} error={q.error} getRowId={(p) => p.id}
        searchPlaceholder={t('Number, partner, invoice or note')} exportName="history-payments"
        facets={[{ columnId: 'kind', title: t('Kind|history'), options: Object.entries(PAY_KIND).map(([value, label]) => ({ value, label: t(label) })) }]}
        server={st.server(q.data?.total_count ?? 0)}
        empty={{ title: t('No payments match'), description: t('Change the dates or the search.') }} />
    </div>
  )
}

/* ------------------------------------------------------------------ accounting */
const MONTHS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12']
function Accounts() {
  const [year, setYear] = React.useState(new Date().getFullYear())
  const q = useHistoryBalances(year)
  const years = q.data?.years ?? []
  React.useEffect(() => { if (years.length && !years.includes(year)) setYear(years[years.length - 1]!) }, [years.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  const rows = q.data?.accounts ?? []
  const net = (r: BalanceRow, m: string) => { const v = r.months[m]; return v ? num(v[0]) - num(v[1]) : 0 }
  const monthName = (m: string) => formatDateWith(new Date(`${year}-${m}-01T00:00:00`), { month: 'short' })
  return (
    <div className="grid gap-3">
      <div className="flex items-end gap-3">
        <div className="grid gap-1.5"><Label>{t('Year')}</Label>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>{(years.length ? years : [year]).map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
          </Select></div>
        <p className="pb-2 text-[13px] text-muted-foreground">{t('Movement of each account per month (debit minus credit), with the balance at the start and the end of the year.')}</p>
      </div>
      {q.isLoading ? <Skeleton className="h-64" /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !rows.length ? (
        <EmptyState compact icon={Archive} title={t('No accounting for {year}', { year })} />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table className="text-[13px]">
            <TableHeader><TableRow>
              <TableHead className="sticky left-0 z-10 min-w-[220px] bg-card">{t('Account')}</TableHead>
              <TableHead className="text-right">{t('Opening')}</TableHead>
              {MONTHS.map((m) => <TableHead key={m} className="text-right">{monthName(m)}</TableHead>)}
              <TableHead className="text-right">{t('Closing')}</TableHead>
            </TableRow></TableHeader>
            <TableBody>{rows.map((r) => {
              const closing = num(r.opening) + num(r.debit) - num(r.credit)
              return (
                <TableRow key={r.code}>
                  <TableCell className="sticky left-0 z-10 bg-card"><span className="tabular text-muted-foreground">{r.code}</span> {r.name}</TableCell>
                  <TableCell className="text-right tabular text-muted-foreground">{fmt(num(r.opening))}</TableCell>
                  {MONTHS.map((m) => <TableCell key={m} className="text-right tabular">{fmt(net(r, m))}</TableCell>)}
                  <TableCell className="text-right font-semibold tabular">{fmt(closing)}</TableCell>
                </TableRow>
              )
            })}</TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
const fmt = (v: number) => (Math.abs(v) < 0.005 ? '—' : formatMoney(v))
