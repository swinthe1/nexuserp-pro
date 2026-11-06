import type { ColumnDef } from '@tanstack/react-table'
import { PageTableExport } from '@/components/page-table-export'
import { Bot, Plus, Trash2, Undo2 } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Can, useCompany } from '@/app/company-provider'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { ColumnHeader, DataTable, inFilter } from '@/components/data-table/data-table'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { SearchSelect } from '@/components/search-select'
import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ErrorState } from '@/components/error-state'
import { t, td, tServer } from '@/i18n'
import { cn, formatDate, formatMoney, humanize, num, todayISO } from '@/lib/utils'
import {
  SOURCE_HREF, sourceLabel, useAccounts, useCostCenters, useDeleteJournalEntry, useJournalEntries, useJournalEntry, useJournals,
  usePostJournalEntry, useReverseJournalEntry, useSaveJournalEntry,
} from '../api'
import { JournalLinesTable, TAccounts } from '../components/t-accounts'
import { usePartners } from '@/features/sales/api'

type Row = { id: string; number: string; status: string; entry_date: string; reference: string | null; memo: string | null
  source_doc_type: string | null; source_doc_id: string | null; is_automatic: boolean; total_debit: number; journal: { code: string; name: string } | null; reporting_ledger?: string }

export function JournalEntriesPage() {
  const navigate = useNavigate()
  const [from, setFrom] = React.useState(`${new Date().getFullYear()}-01-01`)
  const [to, setTo] = React.useState(todayISO())
  const entries = useJournalEntries(from, to)
  const journals = useJournals()
  const columns = React.useMemo<ColumnDef<Row>[]>(() => [
    { accessorKey: 'entry_date', header: ({ column }) => <ColumnHeader column={column} title={t('Date')} />, meta: { label: t('Date') }, cell: ({ getValue }) => formatDate(getValue() as string) },
    { accessorKey: 'number', enableHiding: false, header: ({ column }) => <ColumnHeader column={column} title={t('Number')} />, meta: { label: t('Number') }, cell: ({ getValue }) => <span className="font-medium">{getValue() as string}</span> },
    { id: 'journal', accessorFn: (r) => r.journal?.code ?? '', filterFn: inFilter, header: t('Journal'), meta: { label: t('Journal') }, cell: ({ row: { original: r } }) => <span title={td(r.journal?.name)}>{r.journal?.code}</span> },
    { accessorKey: 'memo', header: t('Description'), meta: { label: t('Description') }, cell: ({ row: { original: r } }) => <span className="block max-w-[340px] truncate">{r.memo ? tServer(r.memo) : r.reference ?? '—'}</span> },
    {
      id: 'source', accessorFn: (r) => (r.is_automatic ? r.source_doc_type ?? 'automatic' : 'manual'), filterFn: inFilter, header: t('Source'), meta: { label: t('Source') },
      cell: ({ row: { original: r } }) => r.is_automatic
        ? <span className="inline-flex items-center gap-1 text-[13px]"><Bot className="size-3.5 text-muted-foreground" />{r.source_doc_type ? sourceLabel(r.source_doc_type) : t('Automatic')}</span>
        : <Badge variant="outline">{t('Manual')}</Badge>,
    },
    { accessorKey: 'status', filterFn: inFilter, header: t('Status'), meta: { label: t('Status') }, cell: ({ getValue }) => <StatusBadge status={getValue() as string} /> },
    { id: 'ledger', accessorFn: (r) => (r.reporting_ledger === 'MANAGEMENT' ? 'management' : 'statutory'), filterFn: inFilter, header: t('Ledger'), meta: { label: t('Ledger') },
      cell: ({ getValue }) => (getValue() === 'management' ? <Badge variant="warning">{t('Management')}</Badge> : <span className="text-muted-foreground">{t('Statutory')}</span>) },
    { accessorKey: 'total_debit', header: ({ column }) => <ColumnHeader column={column} title={t('Amount')} />, meta: { label: t('Amount'), align: 'right' }, cell: ({ getValue }) => <span className="tabular">{formatMoney(getValue() as number)}</span> },
  ], [])
  const sources = [...new Set((entries.data ?? []).map((r) => (r.is_automatic ? r.source_doc_type ?? 'automatic' : 'manual')))]
  return (
    <>
      <PageHeader title={t('Journal entries|menu')} description={t('Everything recorded in the accounts. Automatic entries come from documents and link back to them; manual entries are for accruals, opening balances and corrections.')}
        actions={<>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-[150px]" aria-label={t('From')} />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-[150px]" aria-label={t('To')} />
          <Can perm="finance.write"><Button asChild><Link to="/finance/journal/new"><Plus /> {t('Manual entry')}</Link></Button></Can>
        </>} />
      <DataTable tableKey="finance.journal" columns={columns} data={entries.data as Row[] | undefined} isLoading={entries.isLoading} error={entries.error}
        getRowId={(r) => r.id} exportName={t('accounting-entries')} searchPlaceholder={t('Number, description, reference…')} onRowClick={(r) => navigate(`/finance/journal/${r.id}`)}
        facets={[
          { columnId: 'journal', title: t('Journal'), options: (journals.data ?? []).map((j) => ({ value: j.code, label: `${j.code} · ${td(j.name)}` })) },
          { columnId: 'source', title: t('Source'), options: sources.map((s) => ({ value: s, label: s === 'manual' ? t('Manual') : s === 'automatic' ? t('Automatic') : sourceLabel(s) })) },
          { columnId: 'status', title: t('Status'), options: ['draft', 'posted', 'reversed'].map((s) => ({ value: s, label: humanize(s) })) },
          { columnId: 'ledger', title: t('Ledger'), options: [{ value: 'statutory', label: t('Statutory') }, { value: 'management', label: t('Management') }] },
        ]}
        empty={{ title: t('No accounting entries in this period') }} />
    </>
  )
}

export function JournalEntryPage() {
  const { id } = useParams()
  if (!id) return <ManualEntryForm />
  return <JournalEntryView id={id} />
}

function JournalEntryView({ id }: { id: string }) {
  const navigate = useNavigate()
  const je = useJournalEntry(id)
  const post = usePostJournalEntry()
  const reverse = useReverseJournalEntry()
  const del = useDeleteJournalEntry()
  if (je.isLoading) return <Skeleton className="mx-auto h-96 max-w-6xl" />
  if (je.isError) return <ErrorState error={je.error} onRetry={() => void je.refetch()} />
  const e = je.data
  if (!e) return <EmptyState title={t('Accounting entry not found')} description={t('It may have been deleted.')} action={<Button variant="outline" asChild><Link to="/finance/journal">{t('Back to accounting entries')}</Link></Button>} />
  if (e.status === 'draft' && !e.is_automatic) return <ManualEntryForm entry={e} />
  const href = e.source_doc_type && e.source_doc_id ? SOURCE_HREF[e.source_doc_type] : undefined
  return (
    <div className="w-full">
      <PageHeader back={{ href: '/finance/journal', label: t('Accounting entries') }} title={e.number}
        meta={<><StatusBadge status={e.status} />{e.reporting_ledger === 'MANAGEMENT' && <Badge variant="warning">{t('Management ledger')}</Badge>}{e.is_automatic ? <Badge variant="secondary"><Bot className="size-3" /> {t('Automatic')}</Badge> : <Badge variant="outline">{t('Manual')}</Badge>}</>}
        description={[td(e.journal?.name), formatDate(e.entry_date), tServer(e.memo)].filter(Boolean).join(' · ')}
        actions={<><PageTableExport />{<Can perm="finance.write">
          {e.status === 'posted' && !e.is_automatic && (
            <ConfirmDialog trigger={<Button variant="outline"><Undo2 /> {t('Reverse')}</Button>} title={t('Reverse {doc}?', { doc: e.number })}
              description={t('A new entry with debits and credits swapped is posted today, and this one is marked as reversed.')} confirmLabel={t('Reverse')}
              onConfirm={async () => { const r = await reverse.mutateAsync({ id: e.id }); toast.success(t('Reversal posted')); navigate(`/finance/journal/${r}`) }} />
          )}
          {e.status === 'draft' && <><Button variant="ghost" className="text-destructive" onClick={async () => { await del.mutateAsync(e.id); navigate('/finance/journal') }}><Trash2 /> {t('Delete')}</Button>
            <Button onClick={() => post.mutate(e.id, { onSuccess: () => toast.success(t('Posted|toast')) })}>{t('Post')}</Button></>}
        </Can>}</>} />
      <div className="mb-4 grid gap-3 text-[13px] sm:grid-cols-4">
        <Fact k={t('Source')}>{href ? <Link className="text-primary hover:underline" to={href + e.source_doc_id}>{sourceLabel(e.source_doc_type)} {e.reference}</Link> : e.is_automatic ? e.reference ?? '—' : t('Manual entry')}</Fact>
        <Fact k={t('Amount')}>{formatMoney(e.total_debit)}</Fact>
        <Fact k={t('Posted on')}>{e.posted_at ? (e.poster?.full_name ? t('{date} by {name}', { date: formatDate(e.posted_at, true), name: e.poster.full_name }) : formatDate(e.posted_at, true)) : '—'}</Fact>
        <Fact k={t('Reversal')}>{e.reversal_of_id ? <Link className="text-primary hover:underline" to={`/finance/journal/${e.reversal_of_id}`}>{t('Reverses another entry')}</Link>
          : e.reversed_by_id ? <Link className="text-primary hover:underline" to={`/finance/journal/${e.reversed_by_id}`}>{t('Reversed: see the reversal')}</Link> : '—'}</Fact>
      </div>
      <Tabs defaultValue="lines">
        <TabsList><TabsTrigger value="lines">{t('Entry lines')}</TabsTrigger><TabsTrigger value="t">{t('T-accounts')}</TabsTrigger></TabsList>
        <TabsContent value="lines"><Card><CardContent className="overflow-x-auto p-0"><JournalLinesTable lines={e.lines} /></CardContent></Card></TabsContent>
        <TabsContent value="t"><TAccounts entries={[e]} /></TabsContent>
      </Tabs>
    </div>
  )
}

function Fact({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="rounded-lg border bg-card px-3 py-2"><div className="text-xs text-muted-foreground">{k}</div><div className="mt-0.5 font-medium">{children}</div></div>
}

type Line = { key: string; account_id: string | null; description: string; debit: string; credit: string; partner_id: string | null; cost_center_id: string | null }
let seq = 0
const blank = (): Line => ({ key: `l${seq++}`, account_id: null, description: '', debit: '', credit: '', partner_id: null, cost_center_id: null })

function ManualEntryForm({ entry }: { entry?: NonNullable<ReturnType<typeof useJournalEntry>['data']> }) {
  const navigate = useNavigate()
  const { can } = useCompany()
  const journals = useJournals()
  const accounts = useAccounts()
  const centers = useCostCenters()
  const partners = usePartners()
  const save = useSaveJournalEntry()
  const post = usePostJournalEntry()
  const [journalId, setJournalId] = React.useState<string | null>(entry?.journal_id ?? null)
  const [date, setDate] = React.useState(entry?.entry_date ?? todayISO())
  const [memo, setMemo] = React.useState(entry?.memo ?? '')
  const [reference, setReference] = React.useState(entry?.reference ?? '')
  // the statutory books, or an internal adjustment seen only in the management view
  const [ledger, setLedger] = React.useState<'STATUTORY' | 'MANAGEMENT'>(entry?.reporting_ledger === 'MANAGEMENT' ? 'MANAGEMENT' : 'STATUTORY')
  const [lines, setLines] = React.useState<Line[]>(() => entry
    ? [...entry.lines].sort((a, b) => a.line_no - b.line_no).map((l) => ({ key: l.id, account_id: l.account_id, description: l.description ?? '', debit: num(l.debit) ? String(l.debit) : '', credit: num(l.credit) ? String(l.credit) : '', partner_id: l.partner_id, cost_center_id: l.cost_center_id }))
    : [blank(), blank()])
  React.useEffect(() => { if (!journalId && journals.data) setJournalId(journals.data.find((j) => j.code === 'GEN')?.id ?? journals.data[0]?.id ?? null) }, [journals.data, journalId])
  const dr = lines.reduce((s, l) => s + num(l.debit), 0)
  const cr = lines.reduce((s, l) => s + num(l.credit), 0)
  const diff = Math.round((dr - cr) * 100) / 100
  const valid = !!journalId && dr > 0 && diff === 0 && lines.every((l) => (!num(l.debit) && !num(l.credit)) || l.account_id)
  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  // a management adjustment touches only income, expense and the management adjustments account; the statutory books never that one
  const postable = (accounts.data ?? []).filter((a) => a.is_postable && a.is_active && (ledger === 'MANAGEMENT' ? ['revenue', 'expense'].includes(a.account_type) || a.is_management : !a.is_management))

  const persist = async () => save.mutateAsync({
    header: { id: entry?.id, journal_id: journalId, entry_date: date, memo: memo || null, reference: reference || null, reporting_ledger: ledger },
    lines: lines.filter((l) => l.account_id && (num(l.debit) || num(l.credit))).map((l, i) => ({
      line_no: i + 1, account_id: l.account_id, debit: num(l.debit), credit: num(l.credit), description: l.description || null,
      partner_id: l.partner_id, cost_center_id: l.cost_center_id,
    })),
  })

  return (
    <div className="w-full">
      <PageHeader back={{ href: '/finance/journal', label: t('Accounting entries') }} title={entry ? entry.number : t('New manual entry')} meta={entry && <StatusBadge status={entry.status} />}
        description={t('For accruals, opening balances, reclassifications and corrections. Documents record their own entries automatically.')}
        actions={can('finance.write') && <>
          <Button variant="outline" loading={save.isPending} onClick={async () => { const id = await persist(); toast.success(t('Draft saved')); if (!entry) navigate(`/finance/journal/${id}`, { replace: true }) }}>{t('Save draft')}</Button>
          <Button disabled={!valid} onClick={async () => { const id = await persist(); await post.mutateAsync(id); toast.success(t('Entry posted')); navigate(`/finance/journal/${id}`, { replace: true }) }}>{t('Post')}</Button>
        </>} />
      <Card>
        <CardContent className="grid gap-4 p-4 sm:grid-cols-4">
          <div className="grid gap-1.5"><Label>{t('Journal')}</Label>
            <Select value={journalId ?? ''} onValueChange={setJournalId}><SelectTrigger><SelectValue placeholder={t('Journal')} /></SelectTrigger>
              <SelectContent>{(journals.data ?? []).map((j) => <SelectItem key={j.id} value={j.id}>{j.code} · {td(j.name)}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-1.5"><Label htmlFor="je-date">{t('Date')}</Label><Input id="je-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="je-ref">{t('Reference')}</Label><Input id="je-ref" value={reference} onChange={(e) => setReference(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label>{t('Ledger')}</Label>
            <Select value={ledger} onValueChange={(v) => setLedger(v as 'STATUTORY' | 'MANAGEMENT')}><SelectTrigger aria-label={t('Ledger')}><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="STATUTORY">{t('Statutory')}</SelectItem><SelectItem value="MANAGEMENT">{t('Management (internal adjustment)')}</SelectItem></SelectContent></Select></div>
          {ledger === 'MANAGEMENT' && <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[13px] sm:col-span-4">{t('Seen only in the management view: cost allocations, imputed rent, internal accruals. It uses income and expense accounts and the management adjustments account; the statutory books and ATK do not see it.')}</p>}
          <div className="grid gap-1.5 sm:col-span-4"><Label htmlFor="je-memo">{t('Description')}</Label><Input id="je-memo" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder={t('e.g. October rent not yet invoiced')} /></div>
        </CardContent>
      </Card>
      <Card className="mt-4">
        <CardHeader className="flex-row items-center justify-between space-y-0 py-3"><CardTitle>{t('Lines')}</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setLines((l) => [...l, blank()])}><Plus /> {t('Add line')}</Button></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table className="min-w-[980px]">
            <TableHeader><TableRow className="hover:bg-transparent">
              <TableHead className="w-[28%]">{t('Account')}</TableHead><TableHead>{t('Description')}</TableHead><TableHead className="w-44">{t('Partner')}</TableHead><TableHead className="w-36">{t('Cost center')}</TableHead>
              <TableHead className="w-32 text-right">{t('Debit')}</TableHead><TableHead className="w-32 text-right">{t('Credit')}</TableHead><TableHead className="w-10" />
            </TableRow></TableHeader>
            <TableBody>
              {lines.map((l, i) => (
                <TableRow key={l.key} className="hover:bg-transparent">
                  <TableCell><SearchSelect value={l.account_id} onChange={(v) => set(i, { account_id: v })} placeholder={t('Account')} options={postable.map((a) => ({ value: a.id, label: a.code, hint: td(a.name), keywords: [a.name, td(a.name)] }))} /></TableCell>
                  <TableCell><Input className="h-9" value={l.description} onChange={(e) => set(i, { description: e.target.value })} aria-label={t('Description, line {n}', { n: i + 1 })} /></TableCell>
                  <TableCell><SearchSelect value={l.partner_id} onChange={(v) => set(i, { partner_id: v })} clearable placeholder="—" options={(partners.data ?? []).map((p) => ({ value: p.id, label: p.name }))} /></TableCell>
                  <TableCell><SearchSelect value={l.cost_center_id} onChange={(v) => set(i, { cost_center_id: v })} clearable placeholder="—" options={(centers.data ?? []).map((c) => ({ value: c.id, label: c.code, hint: c.name }))} /></TableCell>
                  <TableCell><Input type="number" step="any" className="h-9 text-right tabular" value={l.debit} aria-label={t('Debit, line {n}', { n: i + 1 })} onChange={(e) => set(i, { debit: e.target.value, credit: e.target.value ? '' : l.credit })} /></TableCell>
                  <TableCell><Input type="number" step="any" className="h-9 text-right tabular" value={l.credit} aria-label={t('Credit, line {n}', { n: i + 1 })} onChange={(e) => set(i, { credit: e.target.value, debit: e.target.value ? '' : l.debit })} /></TableCell>
                  <TableCell>{lines.length > 2 && <Button size="icon-sm" variant="ghost" aria-label={t('Remove line')} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 /></Button>}</TableCell>
                </TableRow>
              ))}
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={4} className="text-right text-[13px]">
                  {diff === 0 ? (dr > 0 ? <span className="text-success">{t('Balanced')}</span> : t('Enter amounts'))
                    : <button className="text-destructive underline-offset-2 hover:underline" onClick={() => {
                        const i = lines.findIndex((l) => !l.debit && !l.credit && l.account_id) >= 0 ? lines.findIndex((l) => !l.debit && !l.credit && l.account_id) : lines.length - 1
                        set(i, diff > 0 ? { credit: String(diff), debit: '' } : { debit: String(-diff), credit: '' })
                      }}>{t('Out of balance by {amount}. Click to balance it on the last line.', { amount: formatMoney(Math.abs(diff)) })}</button>}
                </TableCell>
                <TableCell className={cn('text-right tabular font-semibold')}>{formatMoney(dr)}</TableCell>
                <TableCell className="text-right tabular font-semibold">{formatMoney(cr)}</TableCell><TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
