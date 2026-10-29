import { ArrowDownLeft, ArrowUpRight, Printer, Wallet } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { SearchSelect } from '@/components/search-select'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { t, td, tServer } from '@/i18n'
import { cn, formatDate, formatMoney, num, todayISO } from '@/lib/utils'
import { SOURCE_HREF, sourceLabel, useAccountLedger, useAccounts, type LedgerLine } from '../api'

const monthStart = () => todayISO().slice(0, 8) + '01'

type Day = { date: string; rows: LedgerLine[]; inflow: number; outflow: number; close: number }

/**
 * "Libri i arkës": every cash in and out, day by day, with the cash left at the end of each day.
 * Several cash desks: choose which one. Printable for the signature at the end of the month.
 */
export function CashBookPage() {
  const { company } = useCompany()
  const accounts = useAccounts()
  const [params, setParams] = useSearchParams()
  const [from, setFrom] = React.useState(params.get('from') ?? monthStart())
  const [to, setTo] = React.useState(params.get('to') ?? todayISO())
  const cashes = (accounts.data ?? []).filter((a) => a.is_postable && a.account_subtype === 'cash')
  const id = params.get('account') ?? cashes[0]?.id
  const cash = cashes.find((a) => a.id === id)
  const ledger = useAccountLedger(cash?.id, from, to)

  const days = React.useMemo<Day[]>(() => {
    let bal = ledger.data?.opening ?? 0
    const out: Day[] = []
    for (const l of ledger.data?.rows ?? []) {
      let d = out[out.length - 1]
      if (!d || d.date !== l.entry.entry_date) { d = { date: l.entry.entry_date, rows: [], inflow: 0, outflow: 0, close: bal }; out.push(d) }
      d.rows.push(l); d.inflow += num(l.debit); d.outflow += num(l.credit)
      bal += num(l.debit) - num(l.credit); d.close = bal
    }
    return out
  }, [ledger.data])
  const inflow = days.reduce((s, d) => s + d.inflow, 0)
  const outflow = days.reduce((s, d) => s + d.outflow, 0)

  if (accounts.isLoading) return <Skeleton className="h-64" />
  if (accounts.isError) return <ErrorState error={accounts.error} onRetry={() => void accounts.refetch()} />
  if (!cash) return <EmptyState icon={Wallet} title={t('No cash account yet')} description={t('Add a cash account in the chart of accounts.')}
    action={<Button variant="outline" asChild><Link to="/finance/accounts">{t('Chart of accounts')}</Link></Button>} />

  const label = (l: LedgerLine) => [l.partner?.name, tServer(l.description ?? l.entry.memo)].filter(Boolean).join(' · ') || '—'
  const source = (l: LedgerLine) => {
    const href = l.entry.source_doc_type ? SOURCE_HREF[l.entry.source_doc_type] : undefined
    const text = l.entry.reference ? `${sourceLabel(l.entry.source_doc_type)} ${l.entry.reference}` : l.entry.number
    return href && l.entry.source_doc_id ? <Link className="hover:underline" to={href + l.entry.source_doc_id}>{text}</Link>
      : <Link className="hover:underline" to={`/finance/journal/${l.entry_id}`}>{text}</Link>
  }
  const setPeriod = (f: string, tt: string) => { setFrom(f); setTo(tt); const p = new URLSearchParams(params); p.set('from', f); p.set('to', tt); setParams(p, { replace: true }) }

  return (
    <div className="mx-auto grid max-w-5xl grid-cols-[minmax(0,1fr)] gap-4">
      <PageHeader title={t('Cash book|ledger')}
        description={<>{company?.name} · <span className="font-mono">{cash.code}</span> {td(cash.name)} · {formatDate(from)} – {formatDate(to)}. {t('Amounts in {cur}.', { cur: company?.base_currency ?? '' })}</>}
        actions={<Button variant="outline" onClick={() => window.print()} className="print:hidden"><Printer /> {t('Print')}</Button>} />

      <div className="flex flex-wrap items-end gap-2 print:hidden">
        {cashes.length > 1 && (
          <Select value={cash.id} onValueChange={(v) => { const p = new URLSearchParams(params); p.set('account', v); setParams(p, { replace: true }) }}>
            <SelectTrigger className="w-full sm:w-[240px]" aria-label={t('Cash desk')}><SelectValue /></SelectTrigger>
            <SelectContent>{cashes.map((a) => <SelectItem key={a.id} value={a.id}>{a.code} · {td(a.name)}</SelectItem>)}</SelectContent>
          </Select>
        )}
        <Input type="date" value={from} onChange={(e) => e.target.value && setPeriod(e.target.value, to)} className="w-[150px]" aria-label={t('From')} />
        <Input type="date" value={to} onChange={(e) => e.target.value && setPeriod(from, e.target.value)} className="w-[150px]" aria-label={t('To')} />
        <Button variant="ghost" size="sm" onClick={() => setPeriod(todayISO(), todayISO())}>{t('Today')}</Button>
        <Button variant="ghost" size="sm" onClick={() => setPeriod(monthStart(), todayISO())}>{t('This month')}</Button>
      </div>

      {ledger.isLoading ? <Skeleton className="h-64" /> : ledger.isError ? <ErrorState error={ledger.error} onRetry={() => void ledger.refetch()} /> : <>
        {/* the four numbers a cashier and the owner look at */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Sum label={t('Cash at the start')} value={ledger.data?.opening ?? 0} />
          <Sum label={t('Came in')} value={inflow} tone="in" />
          <Sum label={t('Went out')} value={outflow} tone="out" />
          <Sum label={t('Cash at the end')} value={ledger.data?.closing ?? 0} strong />
        </div>

        {!days.length ? <Card><CardContent className="py-10 text-center text-[13px] text-muted-foreground">{t('No movements in this period.')}</CardContent></Card> : <>
          {/* phone: one card per day */}
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:hidden print:hidden">
            {days.map((d) => (
              <Card key={d.date}><CardContent className="p-0">
                <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2 text-[13px] font-medium">
                  <span>{formatDate(d.date)}</span><span className="tabular">{t('End of day')}: {formatMoney(d.close)}</span>
                </div>
                <ul className="divide-y">
                  {d.rows.map((l) => (
                    <li key={l.id} className="flex items-center gap-2 px-3 py-2">
                      {num(l.debit) ? <ArrowDownLeft className="size-4 shrink-0 text-success" /> : <ArrowUpRight className="size-4 shrink-0 text-destructive" />}
                      <div className="min-w-0 flex-1"><div className="truncate text-[13px]">{label(l)}</div><div className="truncate text-xs text-muted-foreground">{source(l)}</div></div>
                      <span className={cn('shrink-0 text-sm font-medium tabular', num(l.debit) ? 'text-success' : 'text-destructive')}>
                        {num(l.debit) ? '+' : '−'}{formatMoney(num(l.debit) || num(l.credit))}</span>
                    </li>
                  ))}
                </ul>
              </CardContent></Card>
            ))}
          </div>

          {/* computer and print: the book itself */}
          <Card className="hidden sm:block print:block print:border-0 print:shadow-none"><CardContent className="overflow-x-auto p-0">
            <Table className="min-w-[760px]">
              <TableHeader><TableRow className="hover:bg-transparent">
                <TableHead className="w-[110px]">{t('Date')}</TableHead><TableHead>{t('Document')}</TableHead><TableHead>{t('Description')}</TableHead>
                <TableHead className="text-right">{t('In')}</TableHead><TableHead className="text-right">{t('Out')}</TableHead><TableHead className="text-right">{t('Cash')}</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                <TableRow className="bg-muted/40 hover:bg-muted/40"><TableCell colSpan={5} className="text-[13px] font-medium">{t('Opening balance on {date}', { date: formatDate(from) })}</TableCell>
                  <TableCell className="text-right font-medium tabular">{formatMoney(ledger.data?.opening ?? 0)}</TableCell></TableRow>
                {days.map((d) => {
                  let run = d.close - d.inflow + d.outflow
                  return (
                    <React.Fragment key={d.date}>
                      {d.rows.map((l, i) => {
                        run += num(l.debit) - num(l.credit)
                        return (
                          <TableRow key={l.id}>
                            <TableCell className="text-[13px]">{i === 0 ? formatDate(d.date) : ''}</TableCell>
                            <TableCell className="text-[13px]">{source(l)}</TableCell>
                            <TableCell className="max-w-[280px] truncate text-[13px] text-muted-foreground">{label(l)}</TableCell>
                            <TableCell className="text-right tabular">{num(l.debit) ? formatMoney(l.debit) : ''}</TableCell>
                            <TableCell className="text-right tabular">{num(l.credit) ? formatMoney(l.credit) : ''}</TableCell>
                            <TableCell className="text-right tabular text-muted-foreground">{formatMoney(run)}</TableCell>
                          </TableRow>
                        )
                      })}
                      <TableRow className="border-b-2 hover:bg-transparent">
                        <TableCell colSpan={3} className="text-right text-xs font-medium text-muted-foreground">{t('Total of {date}', { date: formatDate(d.date) })}</TableCell>
                        <TableCell className="text-right text-[13px] font-medium tabular">{formatMoney(d.inflow)}</TableCell>
                        <TableCell className="text-right text-[13px] font-medium tabular">{formatMoney(d.outflow)}</TableCell>
                        <TableCell className="text-right text-[13px] font-semibold tabular">{formatMoney(d.close)}</TableCell>
                      </TableRow>
                    </React.Fragment>
                  )
                })}
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableCell colSpan={3} className="text-[13px] font-medium">{t('Closing balance on {date}', { date: formatDate(to) })}</TableCell>
                  <TableCell className="text-right font-medium tabular">{formatMoney(inflow)}</TableCell>
                  <TableCell className="text-right font-medium tabular">{formatMoney(outflow)}</TableCell>
                  <TableCell className="text-right font-semibold tabular">{formatMoney(ledger.data?.closing ?? 0)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent></Card>

          {/* signatures, only on paper */}
          <div className="hidden grid-cols-2 gap-16 pt-12 text-[13px] print:grid">
            <div className="border-t pt-1">{t('Cashier')}</div><div className="border-t pt-1">{t('Accountant')}</div>
          </div>
        </>}
      </>}
    </div>
  )
}

function Sum({ label, value, tone, strong }: { label: string; value: number; tone?: 'in' | 'out'; strong?: boolean }) {
  return (
    <Card><CardContent className="p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn('mt-0.5 tabular', strong ? 'text-lg font-semibold' : 'text-base font-medium', tone === 'in' && 'text-success', tone === 'out' && 'text-destructive')}>{formatMoney(value)}</div>
    </CardContent></Card>
  )
}

/** "Kartela e kontos": choose an account and see every entry on it. */
export function AccountCardPage() {
  const accounts = useAccounts()
  const navigate = useNavigate()
  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <PageHeader title={t('Account card')} description={t('Every entry on one account, with its running balance. Choose the account.')} />
      <Card><CardContent className="p-4">
        <SearchSelect value={null} onChange={(v) => v && navigate(`/finance/accounts/${v}`)} placeholder={t('Choose an account')}
          options={(accounts.data ?? []).filter((a) => a.is_postable).map((a) => ({ value: a.id, label: `${a.code} · ${td(a.name)}` }))} />
      </CardContent></Card>
    </div>
  )
}
