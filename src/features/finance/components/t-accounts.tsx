import { BookOpenCheck, Lock } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ErrorState } from '@/components/error-state'
import { t, tn, td, tServer } from '@/i18n'
import { cn, formatDate, formatMoney, num } from '@/lib/utils'
import { useEntriesForSource, type JournalEntryRow, type JournalLineRow } from '../api'

/**
 * T-account view: one "T" per account touched by the entries — debits on the
 * left, credits on the right, balance underneath. Below, the entries as journal
 * lines with a link to each one.
 */
export function TAccounts({ entries }: { entries: JournalEntryRow[] }) {
  const accounts = React.useMemo(() => {
    const m = new Map<string, { code: string; name: string; type: string; debits: { amount: number; label: string }[]; credits: { amount: number; label: string }[] }>()
    for (const e of entries) {
      for (const l of e.lines) {
        const key = l.account_id
        if (!m.has(key)) m.set(key, { code: l.account?.code ?? '', name: l.account?.name ?? '', type: l.account?.account_type ?? '', debits: [], credits: [] })
        const acc = m.get(key)!
        const label = [e.number, l.partner?.name ?? tServer(l.description)].filter(Boolean).join(' · ')
        if (num(l.debit)) acc.debits.push({ amount: num(l.debit), label })
        if (num(l.credit)) acc.credits.push({ amount: num(l.credit), label })
      }
    }
    return [...m.values()].sort((a, b) => a.code.localeCompare(b.code))
  }, [entries])

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {accounts.map((a) => {
        const dr = a.debits.reduce((s, x) => s + x.amount, 0)
        const cr = a.credits.reduce((s, x) => s + x.amount, 0)
        const rows = Math.max(a.debits.length, a.credits.length)
        return (
          <div key={a.code} className="rounded-lg border bg-card text-[13px]">
            <div className="border-b px-3 py-2 text-center">
              <span className="font-mono font-semibold">{a.code}</span> <span className="text-muted-foreground">{td(a.name)}</span>
            </div>
            <div className="grid grid-cols-2">
              <div className="border-r">
                <div className="px-3 pt-1.5 text-2xs font-medium text-muted-foreground">{t('Debit')}</div>
                {Array.from({ length: rows }).map((_, i) => (
                  <div key={i} className="flex h-7 items-center justify-end px-3 tabular" title={a.debits[i]?.label}>{a.debits[i] ? formatMoney(a.debits[i]!.amount) : ''}</div>
                ))}
              </div>
              <div>
                <div className="px-3 pt-1.5 text-2xs font-medium text-muted-foreground">{t('Credit')}</div>
                {Array.from({ length: rows }).map((_, i) => (
                  <div key={i} className="flex h-7 items-center justify-end px-3 tabular" title={a.credits[i]?.label}>{a.credits[i] ? formatMoney(a.credits[i]!.amount) : ''}</div>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 border-t bg-muted/40 text-xs">
              <div className="border-r px-3 py-1.5 text-right tabular font-medium">{dr > cr ? formatMoney(dr - cr) : ''}</div>
              <div className="px-3 py-1.5 text-right tabular font-medium">{cr > dr ? formatMoney(cr - dr) : ''}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function JournalLinesTable({ lines, compact }: { lines: JournalLineRow[]; compact?: boolean }) {
  const sorted = [...lines].sort((a, b) => a.line_no - b.line_no)
  const dr = sorted.reduce((s, l) => s + num(l.debit), 0)
  const cr = sorted.reduce((s, l) => s + num(l.credit), 0)
  return (
    <Table>
      <TableHeader><TableRow className="hover:bg-transparent">
        <TableHead>{t('Account')}</TableHead>{!compact && <TableHead>{t('Partner · cost center')}</TableHead>}<TableHead>{t('Description')}</TableHead>
        <TableHead className="text-right">{t('Debit')}</TableHead><TableHead className="text-right">{t('Credit')}</TableHead>
      </TableRow></TableHeader>
      <TableBody>
        {sorted.map((l) => (
          <TableRow key={l.id} className="hover:bg-transparent">
            <TableCell className={cn(num(l.credit) > 0 && 'pl-8')}>
              <Link to={`/finance/accounts/${l.account_id}`} className="hover:underline"><span className="font-mono">{l.account?.code}</span> {td(l.account?.name)}</Link>
            </TableCell>
            {!compact && <TableCell className="text-[13px] text-muted-foreground">{[l.partner?.name, l.cost_center?.code].filter(Boolean).join(' · ') || '—'}</TableCell>}
            <TableCell className="text-[13px] text-muted-foreground">{tServer(l.description)}{l.currency_code && l.amount_currency != null && <span className="ml-1">({formatMoney(l.amount_currency)} {l.currency_code})</span>}</TableCell>
            <TableCell className="text-right tabular">{num(l.debit) ? formatMoney(l.debit) : ''}</TableCell>
            <TableCell className="text-right tabular">{num(l.credit) ? formatMoney(l.credit) : ''}</TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={compact ? 2 : 3} className="text-right text-[13px] font-medium">{t('Total')}</TableCell>
          <TableCell className="text-right tabular font-semibold">{formatMoney(dr)}</TableCell>
          <TableCell className="text-right tabular font-semibold">{formatMoney(cr)}</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  )
}

/** "Accounting" tab for operational documents: the entries they posted, as T-accounts and journal lines */
export function AccountingTab({ sourceType, sourceId, emptyHint }: { sourceType: string | string[]; sourceId: string; emptyHint?: string }) {
  const { can } = useCompany()
  const q = useEntriesForSource(sourceType, sourceId)
  const [view, setView] = React.useState<'t' | 'lines'>('t')
  if (!can('finance.read')) return <EmptyState icon={Lock} title={t('Only finance users can see the accounting')} description={t('Ask a finance manager if you need to see how this document was recorded in the accounts.')} />
  if (q.isLoading) return <Skeleton className="h-48" />
  if (q.isError) return <ErrorState compact error={q.error} onRetry={() => void q.refetch()} />
  const entries = q.data ?? []
  if (!entries.length) return <EmptyState icon={BookOpenCheck} title={t('Nothing recorded in the accounts yet')} description={emptyHint ?? t('The accounting entry is created when the document is posted.')} />
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted-foreground">{tn(entries.length, '{n} accounting entry was created automatically from this document.', '{n} accounting entries were created automatically from this document.')}</p>
        <div className="flex rounded-md border p-0.5" role="group" aria-label={t('View')}>
          <Button size="sm" variant={view === 't' ? 'secondary' : 'ghost'} className="h-7" onClick={() => setView('t')} aria-pressed={view === 't'}>{t('T-accounts')}</Button>
          <Button size="sm" variant={view === 'lines' ? 'secondary' : 'ghost'} className="h-7" onClick={() => setView('lines')} aria-pressed={view === 'lines'}>{t('Entry lines')}</Button>
        </div>
      </div>
      {view === 't' ? <TAccounts entries={entries} /> : entries.map((e) => (
        <Card key={e.id}>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 py-3">
            <CardTitle className="flex items-center gap-2"><Link className="hover:underline" to={`/finance/journal/${e.id}`}>{e.number}</Link> <StatusBadge status={e.status} /></CardTitle>
            <span className="text-[13px] text-muted-foreground">{td(e.journal?.name)} · {formatDate(e.entry_date)} · {tServer(e.memo)}</span>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0"><JournalLinesTable lines={e.lines} /></CardContent>
        </Card>
      ))}
      <div className="flex flex-wrap gap-3 text-[13px]">
        {entries.map((e) => <Link key={e.id} to={`/finance/journal/${e.id}`} className="text-primary hover:underline">{t('Open {doc}', { doc: e.number })}</Link>)}
      </div>
    </div>
  )
}
