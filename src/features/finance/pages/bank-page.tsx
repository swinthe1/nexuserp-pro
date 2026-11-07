import type { ColumnDef } from '@tanstack/react-table'
import { PageTableExport } from '@/components/page-table-export'
import { Ban, BookCheck, BookOpenText, Check, CheckCheck, HandCoins, Landmark, Link2, Plus, Undo2, Upload, Wallet } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Can, useCompany } from '@/app/company-provider'
import { ColumnHeader, DataTable } from '@/components/data-table/data-table'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { SearchSelect } from '@/components/search-select'
import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { describeError } from '@/lib/errors'
import { ErrorState } from '@/components/error-state'
import { useRealtimeInvalidate } from '@/hooks/use-realtime'
import { t, td, tn, tServer } from '@/i18n'
import { cn, formatDate, formatMoney, humanize, num, todayISO } from '@/lib/utils'
import { usePartners } from '@/features/sales/api'
import { type BankFile, parseAmount, parseDate, readBankFile } from '../bank-formats'
import { BankPositionDialog, BankPositionLine } from '../components/bank-position'
import { MoreMenu } from '@/components/more-menu'
import {
  finKeys, useAcceptAllSuggestions, useAcceptSuggestion, useAccountBalances, useAccountDefaults, useAccounts, useAutoMatch, useDismissSuggestion, useBankAccounts, useBookStatementLine, useCreateStatement, useJournals, useMatchCandidates,
  useBankPosition, useReconcileStatement, useSaveBankAccount, useStatement, useStatements, useUpdateStatementLine, type StatementLine, type StatementRow,
} from '../api'

type BankAccount = NonNullable<ReturnType<typeof useBankAccounts>['data']>[number]

/* ------------------------------------------------------------ pasted rows (the amounts and dates read as in statement files) */
export type ParsedLine = { transaction_date: string; description: string; amount: number; reference: string | null; counterparty_name: string | null }
/** date; description; amount [; reference [; counterparty]] — or separate debit/credit columns: date; description; out; in */
export function parseStatement(text: string): { lines: ParsedLine[]; errors: number[] } {
  const rows = text.split(/\r?\n/).map((r) => r.trim()).filter(Boolean)
  const delim = rows[0]?.includes('\t') ? '\t' : (rows[0]?.split(';').length ?? 0) > (rows[0]?.split(',').length ?? 0) ? ';' : ','
  const split = (r: string) => { const out: string[] = []; let cur = ''; let q = false
    for (const ch of r) { if (ch === '"') q = !q; else if (ch === delim && !q) { out.push(cur); cur = '' } else cur += ch }
    out.push(cur); return out.map((c) => c.trim()) }
  const lines: ParsedLine[] = []; const errors: number[] = []
  rows.forEach((r, i) => {
    const c = split(r)
    const date = parseDate(c[0] ?? '')
    if (!date) { if (i > 0) errors.push(i + 1); return }       // the first row may be a header
    let amount = parseAmount(c[2] ?? '')
    let rest = c.slice(3)
    // debit/credit columns: the 4th column is a number too
    if (c.length >= 4 && c[3] !== '' && Number.isFinite(parseAmount(c[3]!)) && /^[\d\s.,()+-]*$/.test(c[3]!)) {
      amount = (Number.isFinite(parseAmount(c[3]!)) ? parseAmount(c[3]!) : 0) - (Number.isFinite(amount) ? Math.abs(amount) : 0)
      rest = c.slice(4)
    }
    if (!Number.isFinite(amount) || amount === 0) { errors.push(i + 1); return }
    lines.push({ transaction_date: date, description: c[1] || t('Bank transaction'), amount: Math.round(amount * 100) / 100, reference: rest[0] || null, counterparty_name: rest[1] || null })
  })
  return { lines, errors }
}

/* --------------------------------------------------------------- bank page */
export function BankPage() {
  const navigate = useNavigate()
  const { company } = useCompany()
  const banks = useBankAccounts()
  const statements = useStatements()
  const balances = useAccountBalances('1900-01-01', todayISO())
  const [edit, setEdit] = React.useState<BankAccount | 'new' | null>(null)
  const [importFor, setImportFor] = React.useState<string | null | undefined>(undefined)
  const glBal = new Map((balances.data ?? []).map((b) => [b.account_id, num(b.closing)]))
  const position = useBankPosition()
  const posOf = (id: string) => position.data?.find((a) => a.id === id)
  const [why, setWhy] = React.useState<string | null>(null)
  const whyAcc = why ? posOf(why) : undefined
  const cols = React.useMemo<ColumnDef<StatementRow>[]>(() => [
    { accessorKey: 'statement_date', header: ({ column }) => <ColumnHeader column={column} title={t('Date')} />, meta: { label: t('Date') }, cell: ({ getValue }) => formatDate(getValue() as string) },
    { id: 'bank', accessorFn: (r) => td(r.bank?.name ?? ''), header: t('Account'), meta: { label: t('Account') } },
    { accessorKey: 'reference', header: t('Reference'), meta: { label: t('Reference') }, cell: ({ getValue }) => (getValue() as string) ?? '—' },
    { id: 'lines', accessorFn: (r) => r.lines[0]?.count ?? 0, header: t('Lines'), meta: { label: t('Lines'), align: 'right' } },
    { accessorKey: 'opening_balance', header: t('Opening'), meta: { label: t('Opening balance'), align: 'right' }, cell: ({ getValue }) => <span className="tabular">{formatMoney(getValue() as number)}</span> },
    { accessorKey: 'closing_balance', header: t('Closing'), meta: { label: t('Closing balance'), align: 'right' }, cell: ({ getValue }) => <span className="tabular">{formatMoney(getValue() as number)}</span> },
    { accessorKey: 'status', header: t('Status'), meta: { label: t('Status') }, cell: ({ getValue }) => <StatusBadge status={getValue() as string} /> },
  ], [])

  return (
    <>
      <PageHeader title={t('Bank and cash')} description={t('Balances come from the accounts. Import a bank statement to match it with your payments.')}
        actions={<Can perm="finance.write">
          <Button variant="outline" onClick={() => setEdit('new')}><Plus /> {t('Add account')}</Button>
          <Button onClick={() => setImportFor(null)} disabled={!banks.data?.length}><Upload /> {t('Import statement')}</Button>
        </Can>} />
      {banks.isError && <Card className="mb-3"><ErrorState compact error={banks.error} onRetry={() => void banks.refetch()} /></Card>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {banks.isLoading && <Skeleton className="h-28" />}
        {(banks.data ?? []).map((b) => {
          const last = statements.data?.find((s) => s.bank_account_id === b.id)
          return (
            <Card key={b.id} className={cn(!b.is_active && 'opacity-60')}>
              <CardContent className="grid gap-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {b.account_kind === 'cash' ? <Wallet className="size-4 text-muted-foreground" /> : b.account_kind === 'owner' ? <HandCoins className="size-4 text-muted-foreground" /> : <Landmark className="size-4 text-muted-foreground" />}
                    <div><div className="font-medium">{td(b.name)}</div><div className="text-xs text-muted-foreground">{[b.bank_name, b.iban].filter(Boolean).join(' · ') || t('Account {code}', { code: b.account?.code ?? '' })}</div></div>
                  </div>
                  <Can perm="finance.write"><Button size="sm" variant="ghost" onClick={() => setEdit(b)}>{t('Edit')}</Button></Can>
                </div>
                {b.account_kind === 'owner' ? <>
                  {/* the owner's money: what the company owes him for what he paid (the account is a debt, so its balance is a credit) */}
                  <div className="tabular text-2xl font-semibold tracking-[-0.02em]">{formatMoney(-(glBal.get(b.account_id) ?? 0))} <span className="text-sm font-normal text-muted-foreground">{company?.base_currency}</span></div>
                  <div className="-mt-1 text-xs text-muted-foreground">{t('What the company owes the owner for what he paid from his own money')}</div>
                </> : <div className="tabular text-2xl font-semibold tracking-[-0.02em]">{formatMoney(glBal.get(b.account_id))} <span className="text-sm font-normal text-muted-foreground">{company?.base_currency}</span></div>}
                {b.currency_code !== company?.base_currency && <div className="-mt-1 text-xs text-muted-foreground">{t('Value of the {cur} balance in the accounts, at the rates it was recorded', { cur: b.currency_code })}</div>}
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <Link className="hover:underline" to={`/finance/accounts/${b.account_id}`}>{t('Account {code}', { code: b.account?.code ?? '' })}</Link>
                  <span>{last ? t('Last statement {date} · closing {amount}', { date: formatDate(last.statement_date), amount: formatMoney(last.closing_balance) }) : t('No statements yet')}</span>
                </div>
                {b.account_kind !== 'owner' && <BankPositionLine a={posOf(b.id)} onOpen={() => setWhy(b.id)} />}
                {b.account_kind === 'cash' && <Button size="sm" variant="outline" className="justify-self-start" asChild><Link to={`/finance/cash-book?account=${b.account_id}`}><BookOpenText /> {t('Cash book|ledger')}</Link></Button>}
                {!['cash', 'owner'].includes(b.account_kind) && <Can perm="finance.write"><Button size="sm" variant="outline" className="justify-self-start" onClick={() => setImportFor(b.id)}><Upload /> {t('Import statement')}</Button></Can>}
              </CardContent>
            </Card>
          )
        })}
      </div>
      <h2 className="mb-2 mt-6 text-sm font-semibold">{t('Statements')}</h2>
      <DataTable tableKey="finance.statements" columns={cols} data={statements.data} isLoading={statements.isLoading} error={statements.error} getRowId={(r) => r.id}
        exportName={t('bank-statements')} searchPlaceholder={t('Reference, account…')} onRowClick={(r) => navigate(`/finance/bank/statements/${r.id}`)}
        empty={{ title: t('No statements imported'), description: t('Paste the export from your e-banking to start matching.') }} />
      <BankAccountDialog account={edit} onClose={() => setEdit(null)} />
      {whyAcc?.statement && <BankPositionDialog a={whyAcc} onClose={() => setWhy(null)} />}
      {importFor !== undefined && <ImportStatementDialog bankId={importFor} banks={banks.data ?? []} lastClosing={(id) => statements.data?.find((s) => s.bank_account_id === id)?.closing_balance}
        onClose={() => setImportFor(undefined)} onCreated={(id) => navigate(`/finance/bank/statements/${id}`)} />}
    </>
  )
}

function BankAccountDialog({ account, onClose }: { account: BankAccount | 'new' | null; onClose: () => void }) {
  const { company } = useCompany()
  const accounts = useAccounts()
  const journals = useJournals()
  const save = useSaveBankAccount()
  const a = account === 'new' ? null : account
  const [v, setV] = React.useState<Record<string, unknown>>({})
  React.useEffect(() => {
    if (account) setV(a ? { ...a } : { name: '', account_kind: 'bank', currency_code: company?.base_currency ?? 'ALL', bank_name: '', iban: '', swift: '', account_id: null, journal_id: null, is_active: true })
  }, [account]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: string) => (x: unknown) => setV((s) => ({ ...s, [k]: x }))
  const owner = v.account_kind === 'owner'
  // the owner's money is a debt of the company to him (455) or his equity; the others are cash and bank accounts
  const glOptions = (accounts.data ?? []).filter((x) => x.is_postable && (owner ? ['liability', 'equity'].includes(x.account_type) : x.account_type === 'asset' && ['cash', 'bank'].includes(x.account_subtype))).map((x) => ({ value: x.id, label: `${x.code} ${td(x.name)}` }))
  const setKind = (k: string) => setV((s) => {
    const toOwner = k === 'owner', wasOwner = s.account_kind === 'owner'
    if (toOwner === wasOwner) return { ...s, account_kind: k }
    const acc455 = (accounts.data ?? []).find((x) => x.code === '455')?.id ?? null
    const gen = (journals.data ?? []).find((j) => j.code === 'GEN')?.id ?? null
    return { ...s, account_kind: k, account_id: toOwner ? acc455 : null, journal_id: toOwner ? gen : null, ...(toOwner ? { bank_name: '', iban: '', swift: '' } : {}) }
  })
  const submit = async () => {
    const { id, account: _acc, company_id: _c, created_at: _ca, updated_at: _u, created_by: _cb, updated_by: _ub, deleted_at: _d, ...rest } = v as Record<string, unknown>
    try { await save.mutateAsync({ id: id as string | undefined, ...rest, iban: rest.iban || null, bank_name: rest.bank_name || null, swift: rest.swift || null }); toast.success(t('Account saved')); onClose() }
    catch (e) { toast.error(describeError(e)) }
  }
  return (
    <Dialog open={!!account} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{a ? t('Edit {name}', { name: td(a.name) }) : t('Add a bank or cash account')}</DialogTitle><DialogDescription>{t('Each one is recorded in its own account in the chart of accounts; payments and statements use it.')}</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 grid gap-1.5"><Label htmlFor="ba-name">{t('Name')}</Label><Input id="ba-name" value={String(v.name ?? '')} onChange={(e) => set('name')(e.target.value)} placeholder={t('e.g. Raiffeisen EUR')} /></div>
          <div className="grid gap-1.5"><Label>{t('Kind')}</Label>
            <Select value={String(v.account_kind ?? 'bank')} onValueChange={setKind}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{['bank', 'cash', 'card', 'ewallet'].map((k) => <SelectItem key={k} value={k}>{humanize(k)}</SelectItem>)}
                <SelectItem value="owner">{t('The owner’s own money')}</SelectItem></SelectContent></Select></div>
          <div className="grid gap-1.5"><Label htmlFor="ba-cur">{t('Currency')}</Label><Input id="ba-cur" maxLength={3} disabled={!!a} value={String(v.currency_code ?? '')} onChange={(e) => set('currency_code')(e.target.value.toUpperCase())} /></div>
          {owner && <p className="col-span-2 rounded-md bg-muted px-3 py-2 text-[12px] text-muted-foreground">{t('For what the owner pays from his own pocket: it is not booked to the cash box or the bank, but as a debt of the company to the owner (455), which the company pays back to him later.')}</p>}
          {!owner && <>
          <div className="grid gap-1.5"><Label htmlFor="ba-bank">{t('Bank')}</Label><Input id="ba-bank" value={String(v.bank_name ?? '')} onChange={(e) => set('bank_name')(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="ba-swift">SWIFT</Label><Input id="ba-swift" value={String(v.swift ?? '')} onChange={(e) => set('swift')(e.target.value.toUpperCase())} /></div>
          <div className="col-span-2 grid gap-1.5"><Label htmlFor="ba-iban">IBAN</Label><Input id="ba-iban" value={String(v.iban ?? '')} onChange={(e) => set('iban')(e.target.value.toUpperCase().replace(/\s/g, ''))} /></div>
          </>}
          <div className="col-span-2 grid gap-1.5"><Label>{t('Account in the chart of accounts')}</Label><SearchSelect value={v.account_id as string | null} onChange={set('account_id')} options={glOptions} placeholder={owner ? t('The owner’s account') : t('Cash or bank account')} /></div>
          <div className="grid gap-1.5"><Label>{t('Journal')}</Label>
            <Select value={String(v.journal_id ?? '')} onValueChange={set('journal_id')}><SelectTrigger><SelectValue placeholder={t('Bank (BNK)')} /></SelectTrigger>
              <SelectContent>{(journals.data ?? []).filter((j) => (owner ? ['general'] : ['bank', 'cash']).includes(j.journal_type)).map((j) => <SelectItem key={j.id} value={j.id}>{j.code} · {td(j.name)}</SelectItem>)}</SelectContent></Select></div>
          <div className="flex items-end justify-between gap-2 pb-2"><Label htmlFor="ba-active">{t('Active')}</Label><Switch id="ba-active" checked={!!v.is_active} onCheckedChange={set('is_active')} /></div>
        </div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button><Button loading={save.isPending} disabled={!v.name || !v.account_id || String(v.currency_code ?? '').length !== 3} onClick={submit}>{t('Save')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const SAMPLE = `Date;Description;Amount;Reference
2026-10-20;Transfer from customer;12000,00;INV-0042
2026-10-21;Bank fee October;-350,00;`

function ImportStatementDialog({ bankId, banks, lastClosing, onClose, onCreated }: {
  bankId: string | null; banks: BankAccount[]; lastClosing: (id: string) => number | undefined; onClose: () => void; onCreated: (id: string) => void
}) {
  const create = useCreateStatement()
  const auto = useAutoMatch()
  const [bank, setBank] = React.useState<string>(bankId ?? banks.find((b) => b.account_kind === 'bank')?.id ?? banks[0]?.id ?? '')
  const [date, setDate] = React.useState(todayISO())
  const [reference, setReference] = React.useState('')
  const [opening, setOpening] = React.useState(() => String(lastClosing(bank) ?? 0))
  const [text, setText] = React.useState('')
  const [file, setFile] = React.useState<(BankFile & { name: string }) | null>(null)
  const [fileError, setFileError] = React.useState<string | null>(null)
  const typed = React.useMemo(() => parseStatement(text), [text])
  const parsed = file ?? typed
  const sum = parsed.lines.reduce((s, l) => s + l.amount, 0)
  const closing = file?.closing ?? Math.round((num(opening) + sum) * 100) / 100
  const onFile = async (f: File | undefined) => {
    if (!f) return
    setFileError(null)
    try {
      const r = await readBankFile(f)
      if (!r.lines.length) { setFile(null); setFileError(t('No transactions found in {name}. Export the statement from e-banking as XML (CAMT.053), MT940, Excel or CSV.', { name: f.name })); return }
      setFile({ ...r, name: f.name })
      // the account of the statement, by its IBAN
      const clean = (x: string | null | undefined) => (x ?? '').replace(/\s/g, '').toUpperCase()
      const own = r.iban && banks.find((b) => clean(b.iban) === clean(r.iban))
      if (own) setBank(own.id)
      if (r.opening != null) setTimeout(() => setOpening(String(r.opening)), 0)
      if (r.date) setDate(r.date)
      if (r.reference) setReference(r.reference)
    } catch (e) { setFile(null); setFileError(describeError(e)) }
  }
  React.useEffect(() => { setOpening(String(lastClosing(bank) ?? 0)) }, [bank]) // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { const last = parsed.lines.at(-1)?.transaction_date; if (last) setDate(parsed.lines.reduce((m, l) => (l.transaction_date > m ? l.transaction_date : m), last)) }, [parsed.lines])
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{t('Import a bank statement')}</DialogTitle>
          <DialogDescription>{t('Paste rows from your e-banking export: date, description, amount (negative for money out) and an optional reference. Separate columns for money in and out work too.')}</DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="grid gap-1.5 sm:col-span-2"><Label>{t('Account')}</Label>
            <Select value={bank} onValueChange={setBank}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{banks.map((b) => <SelectItem key={b.id} value={b.id}>{td(b.name)} · {b.currency_code}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-1.5"><Label htmlFor="st-date">{t('Statement date')}</Label><Input id="st-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="st-ref">{t('Reference')}</Label><Input id="st-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder={t('No. 10/2026')} /></div>
        </div>
        <div className="grid gap-2 rounded-md border border-dashed p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" asChild><label className="cursor-pointer"><Upload /> {t('Choose the statement file')}
              <input type="file" className="sr-only" accept=".xml,.sta,.mt940,.txt,.940,.csv,.xlsx" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = '' }} /></label></Button>
            <span className="text-xs text-muted-foreground">{t('XML (CAMT.053), MT940, Excel or CSV from e-banking')}</span>
          </div>
          {file && <div className="flex items-center justify-between gap-2 text-[13px]"><span>{file.name} · {file.format === 'camt' ? 'CAMT' : file.format === 'mt940' ? 'MT940' : t('table')}{file.iban ? ` · ${file.iban}` : ''}</span>
            <Button type="button" size="xs" variant="ghost" onClick={() => setFile(null)}>{t('Remove')}</Button></div>}
          {fileError && <p className="text-[13px] text-destructive">{fileError}</p>}
        </div>
        {!file && <Textarea rows={6} className="font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} placeholder={SAMPLE} aria-label={t('Statement rows')} />}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
          <div className="flex items-center gap-2"><Label htmlFor="st-open" className="text-muted-foreground">{t('Opening balance')}</Label>
            <Input id="st-open" type="number" step="any" className="h-8 w-36 text-right tabular" value={opening} onChange={(e) => setOpening(e.target.value)} /></div>
          <span className="text-muted-foreground">{tn(parsed.lines.length, '{n} line', '{n} lines')} · {t('net')} <span className="tabular text-foreground">{formatMoney(sum)}</span></span>
          <span className="text-muted-foreground">{t('Closing balance')} <span className="tabular font-medium text-foreground">{formatMoney(closing)}</span></span>
          {file?.closing != null && Math.abs(num(opening) + sum - file.closing) > 0.005 && <span className="text-destructive">{t('Opening + lines differ from the closing balance in the file')}</span>}
          {parsed.errors.length > 0 && parsed.errors[0]! > 0 && <span className="text-destructive">{t('Rows {rows} could not be read', { rows: parsed.errors.slice(0, 6).join(', ') + (parsed.errors.length > 6 ? '…' : '') })}</span>}
        </div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={create.isPending} disabled={!bank || !parsed.lines.length} onClick={async () => {
            const id = await create.mutateAsync({ header: { bank_account_id: bank, statement_date: date, reference: reference || null, opening_balance: num(opening), closing_balance: closing }, lines: parsed.lines })
            toast.success(tn(parsed.lines.length, '{n} line imported', '{n} lines imported')); onClose(); onCreated(id)
            // match at once: recorded payments first, then the invoices and bills the money pays
            void auto.mutateAsync(id).then((r) => { if (r.matched + r.settled + r.suggested) toast.success(matchMessage(r)) }).catch(() => {})
          }}>{parsed.lines.length ? tn(parsed.lines.length, 'Import {n} line', 'Import {n} lines') : t('Import lines')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ----------------------------------------------------------- statement page */
export function StatementPage() {
  const { id } = useParams()
  const { companyId } = useCompany()
  const st = useStatement(id)
  useRealtimeInvalidate('payments', companyId, [finKeys.doc(companyId, 'statement', id ?? ''), [...finKeys.all(companyId), 'match-candidates']])
  const balances = useAccountBalances('1900-01-01', st.data?.statement_date ?? todayISO(), null, !!st.data)
  const autoMatch = useAutoMatch()
  const reconcile = useReconcileStatement()
  const update = useUpdateStatementLine()
  const [matchLine, setMatchLine] = React.useState<StatementLine | null>(null)
  const [bookLine, setBookLine] = React.useState<StatementLine | null>(null)
  const [filter, setFilter] = React.useState<'all' | 'unmatched' | 'suggested'>('all')
  const acceptAll = useAcceptAllSuggestions()
  if (st.isLoading) return <Skeleton className="h-96" />
  if (st.isError) return <ErrorState error={st.error} onRetry={() => void st.refetch()} />
  if (!st.data) return <EmptyState title={t('Statement not found')} action={<Button variant="outline" asChild><Link to="/finance/bank">{t('Back to bank and cash')}</Link></Button>} />
  const s = st.data
  const open = s.status === 'open'
  const lines = s.lines.filter((l) => filter === 'all' || (l.match_status === 'unmatched' && (filter === 'unmatched' || !!l.suggestion)))
  const suggested = s.lines.filter((l) => l.match_status === 'unmatched' && l.suggestion).length
  const sum = s.lines.reduce((t, l) => t + num(l.amount), 0)
  const unmatched = s.lines.filter((l) => l.match_status === 'unmatched').length
  const matched = s.lines.length - unmatched
  const gl = num(balances.data?.find((b) => b.account_id === s.bank?.account_id)?.closing)
  const diff = Math.round((num(s.closing_balance) - gl) * 100) / 100
  const balanced = Math.abs(num(s.opening_balance) + sum - num(s.closing_balance)) < 0.005
  const recordHref = (l: StatementLine) => `/finance/payments/new?type=${num(l.amount) > 0 ? 'customer_payment' : 'vendor_payment'}&amount=${Math.abs(num(l.amount))}&date=${l.transaction_date}&bank=${s.bank_account_id}&ref=${encodeURIComponent(l.reference ?? '')}${l.partner_id ? `&partner=${l.partner_id}` : ''}`

  return (
    <>
      <PageHeader back={{ href: '/finance/bank', label: t('Bank and cash') }} title={`${td(s.bank?.name)} · ${formatDate(s.statement_date)}`} meta={<StatusBadge status={s.status} />}
        description={s.reference ?? undefined}
        actions={<><PageTableExport />{open && <Can perm="finance.write">
          {suggested > 0 && <Button variant="outline" loading={acceptAll.isPending} onClick={async () => {
            const r = await acceptAll.mutateAsync(s.id)
            toast.success(tn(r.accepted, '{n} suggestion accepted', '{n} suggestions accepted') + (r.failed ? ` · ${tn(r.failed, '{n} could not be settled', '{n} could not be settled')}` : ''))
          }}><CheckCheck /> {t('Accept all ({n})', { n: suggested })}</Button>}
          {/* one button: match what can be matched, then close the statement when nothing is left */}
          <Button loading={autoMatch.isPending || reconcile.isPending} disabled={!balanced} onClick={async () => {
            if (unmatched) {
              const r = await autoMatch.mutateAsync(s.id)
              const fresh = (await st.refetch()).data
              const left = fresh?.lines.filter((l) => l.match_status === 'unmatched').length ?? unmatched
              if (left) {
                setFilter('unmatched')
                toast.info(tn(left, '{n} line still to match, record or ignore', '{n} lines still to match, record or ignore'),
                  { description: r.matched + r.settled + r.suggested ? matchMessage(r) : t('No new matches found') })
                return
              }
            }
            await reconcile.mutateAsync(s.id)
            toast.success(t('Statement reconciled'))
          }}><BookCheck /> {t('Finish statement')}</Button>
        </Can>}</>} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Fact label={t('Opening + lines')} value={formatMoney(num(s.opening_balance) + sum)} hint={balanced ? t('Equals the closing balance {amount}', { amount: formatMoney(s.closing_balance) }) : t('The closing balance says {amount}', { amount: formatMoney(s.closing_balance) })} bad={!balanced} />
        <Fact label={t('Matched|payment')} value={t('{done} of {total}', { done: matched, total: s.lines.length })} hint={unmatched ? tn(unmatched, '{n} line still to match, record or ignore', '{n} lines still to match, record or ignore') : t('Every line is accounted for')} bad={false} />
        <Fact label={t('Balance in the accounts on {date}', { date: formatDate(s.statement_date) })} value={formatMoney(gl)} hint={t('Account of {name} in the chart of accounts', { name: td(s.bank?.name) })} bad={false} />
        <Fact label={t('Statement vs accounts')} value={formatMoney(diff)} hint={diff ? t('Items not yet recorded, or timing differences') : t('Bank and accounts agree')} bad={!!diff} />
      </div>
      <Card className="mt-4">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 py-3">
          <CardTitle>{t('Lines')}</CardTitle>
          <div className="flex max-w-full overflow-x-auto rounded-md border p-0.5" role="group" aria-label={t('Filter')}>
            <Button size="sm" className="h-7" variant={filter === 'all' ? 'secondary' : 'ghost'} onClick={() => setFilter('all')}>{t('All')}</Button>
            <Button size="sm" className="h-7" variant={filter === 'unmatched' ? 'secondary' : 'ghost'} onClick={() => setFilter('unmatched')}>{t('To do ({n})', { n: unmatched })}</Button>
            {suggested > 0 && <Button size="sm" className="h-7" variant={filter === 'suggested' ? 'secondary' : 'ghost'} onClick={() => setFilter('suggested')}>{t('To check ({n})', { n: suggested })}</Button>}
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader><TableRow className="hover:bg-transparent">
              <TableHead>{t('Date')}</TableHead><TableHead>{t('Description')}</TableHead><TableHead className="text-right">{t('Amount')}</TableHead><TableHead>{t('Matched to')}</TableHead><TableHead className="w-[1%]" />
            </TableRow></TableHeader>
            <TableBody>
              {lines.map((l) => (
                <TableRow key={l.id} className="hover:bg-transparent">
                  <TableCell className="whitespace-nowrap text-[13px]">{formatDate(l.transaction_date)}</TableCell>
                  <TableCell><div>{tServer(l.description)}</div><div className="text-xs text-muted-foreground">{[l.reference, l.counterparty_name].filter(Boolean).join(' · ')}</div></TableCell>
                  <TableCell className={cn('text-right tabular', num(l.amount) > 0 && 'text-success')}>{formatMoney(l.amount)}</TableCell>
                  <TableCell className="text-[13px]">
                    {l.match_status === 'matched' ? (
                      l.matched_payment_id ? <Link className="inline-flex items-center gap-1 text-primary hover:underline" to={`/finance/payments/${l.matched_payment_id}`}><Check className="size-3.5" />{l.payment?.number} · {l.payment?.partner?.name}</Link>
                        : l.journal_entry_id ? <Link className="inline-flex items-center gap-1 text-primary hover:underline" to={`/finance/journal/${l.journal_entry_id}`}><Check className="size-3.5" />{t('Recorded to an account')}{l.partner ? ` · ${l.partner.name}` : ''}</Link>
                        : <span className="inline-flex items-center gap-1 text-muted-foreground"><Check className="size-3.5" />{t('Accounting entry')}</span>
                    ) : l.match_status === 'ignored' ? <Badge variant="secondary">{t('Ignored')}</Badge>
                      : l.suggestion ? <Suggestion line={l} open={open} />
                      : <span className="text-warning">{t('Not matched')}</span>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    {open && <Can perm="finance.write">
                      {l.match_status === 'unmatched' ? (<>
                        <span className="inline-flex items-center gap-1">
                          <Button size="sm" variant="outline" onClick={() => setMatchLine(l)}><Link2 /> {t('Match')}</Button>
                          <MoreMenu size="sm" items={[
                            { label: num(l.amount) > 0 ? t('Receipt|payment') : t('Payment'), to: recordHref(l) },
                            { label: t('Record to account'), onSelect: () => setBookLine(l) },
                            { label: t('Ignore: not a real transaction'), icon: Ban, separate: true, onSelect: () => update.mutate({ id: l.id, match_status: 'ignored' }) },
                          ]} />
                        </span>
                      </>) : !l.journal_entry_id && (
                        <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: l.id, match_status: 'unmatched', matched_payment_id: null, matched_journal_line_id: null })}><Undo2 /> {t('Undo')}</Button>
                      )}
                    </Can>}
                  </TableCell>
                </TableRow>
              ))}
              {!lines.length && <TableRow><TableCell colSpan={5} className="py-8 text-center text-[13px] text-muted-foreground">{t('Nothing left to do on this statement.')}</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {matchLine && s.bank && <MatchDialog line={matchLine} bankId={s.bank.id} currency={s.bank.currency_code} onClose={() => setMatchLine(null)} />}
      {bookLine && <BookDialog line={bookLine} onClose={() => setBookLine(null)} />}
    </>
  )
}

type Suggested = { partner_id?: string; docs?: { id: string; number: string; amount: number }[]; account_id?: string; account?: string; memo?: string
  reason: 'number' | 'numbers' | 'account' | 'account_all' | 'learned' | 'name' | 'combination' | 'oldest' | 'amount' | 'learned_account' | 'fees'; error?: string }
/** what a line probably pays, waiting for one tap */
function Suggestion({ line, open }: { line: StatementLine; open: boolean }) {
  const { can } = useCompany()
  const accept = useAcceptSuggestion()
  const dismiss = useDismissSuggestion()
  const sg = line.suggestion as unknown as Suggested
  const why = {
    number: t('its number is in the text'), numbers: t('their numbers are in the text'), account: t('from their account'), account_all: t('all their open invoices'),
    learned: t('the payer you chose before'), name: t('the name and amount fit'), combination: t('their invoices that add up to it'), oldest: t('less than they owe: the oldest first'),
    amount: t('the only one with this amount'), learned_account: t('as you recorded it before'), fees: t('looks like a bank charge'),
  }[sg.reason]
  const what = sg.account ? <b>{sg.account.replace(/^(\S+) (.*)$/, (_, c: string, n: string) => `${c} ${td(n)}`)}</b>
    : <b>{(sg.docs ?? []).map((d) => (sg.reason === 'oldest' && d.amount ? `${d.number} (${formatMoney(d.amount)})` : d.number)).join(', ')}</b>
  return (
    <div className="grid gap-1">
      <span className="text-[13px]">{t('Probably')} {what} <span className="text-muted-foreground">· {why}</span></span>
      {sg.error && <span className="text-xs text-destructive">{tServer(sg.error)}</span>}
      {open && can('finance.write') && <span className="flex gap-1">
        <Button size="xs" loading={accept.isPending} onClick={() => accept.mutate(line.id, { onSuccess: () => toast.success(sg.account ? t('Recorded') : t('Payment recorded and matched')) })}><Check /> {t('Accept')}</Button>
        <Button size="xs" variant="ghost" disabled={dismiss.isPending} onClick={() => dismiss.mutate(line.id)}>{t('Not this')}</Button>
      </span>}
    </div>
  )
}
function matchMessage(r: { matched: number; settled: number; suggested: number }) {
  return [r.matched && tn(r.matched, '{n} line matched to a payment', '{n} lines matched to payments'), r.settled && tn(r.settled, '{n} invoice settled from the bank', '{n} invoices settled from the bank'),
          r.suggested && tn(r.suggested, '{n} suggestion to check', '{n} suggestions to check')].filter(Boolean).join(' · ')
}

function Fact({ label, value, hint, bad }: { label: string; value: React.ReactNode; hint: string; bad: boolean }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-[13px] text-muted-foreground">{label}</div>
      <div className={cn('tabular text-xl font-semibold', bad && 'text-destructive')}>{value}</div>
      <div className="text-xs text-muted-foreground">{hint}</div>
    </div>
  )
}

function MatchDialog({ line, bankId, currency, onClose }: { line: StatementLine; bankId: string; currency: string; onClose: () => void }) {
  const { company } = useCompany()
  const cands = useMatchCandidates(bankId, num(line.amount))
  const update = useUpdateStatementLine()
  const [q, setQ] = React.useState('')
  const signed = (p: { document_type: string; amount: number; amount_base: number | null; currency_code: string }) =>
    (p.document_type === 'customer_payment' ? 1 : -1) * (p.currency_code === currency ? num(p.amount) : num(p.amount_base))
  const list = (cands.data ?? []).filter((p) => !q || `${p.number} ${p.partner?.name} ${p.reference}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(Math.abs(signed(a) - num(line.amount)) > 0.005) - Number(Math.abs(signed(b) - num(line.amount)) > 0.005)
      || Math.abs(new Date(a.payment_date).getTime() - new Date(line.transaction_date).getTime()) - Math.abs(new Date(b.payment_date).getTime() - new Date(line.transaction_date).getTime()))
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{t('Match to a payment')}</DialogTitle>
          <DialogDescription>{formatDate(line.transaction_date)} · {tServer(line.description)} · <span className="tabular">{formatMoney(line.amount)} {currency}</span>. {t('Payments with the same amount are listed first.')}</DialogDescription></DialogHeader>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search number, partner, reference')} aria-label={t('Search payments')} />
        <div className="max-h-80 overflow-y-auto rounded-md border">
          {cands.isLoading ? <Skeleton className="m-3 h-24" /> : cands.isError ? <ErrorState compact error={cands.error} onRetry={() => void cands.refetch()} /> : !list.length ? <p className="p-4 text-[13px] text-muted-foreground">{t('No posted payments on this account. Record the payment first, or record the line to an account directly.')}</p> : list.map((p) => {
            const exact = Math.abs(signed(p) - num(line.amount)) < 0.005
            return (
              <button key={p.id} type="button" className="flex w-full items-center justify-between gap-3 border-b px-3 py-2 text-left text-[13px] last:border-0 hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none"
                onClick={async () => {
                  if (!exact && !window.confirm(t('The amounts differ: the line is {line}, the payment {payment}. Match them anyway?', { line: formatMoney(line.amount), payment: formatMoney(signed(p)) }))) return
                  await update.mutateAsync({ id: line.id, match_status: 'matched', matched_payment_id: p.id }); toast.success(t('Matched to {doc}', { doc: p.number })); onClose()
                }}>
                <span><span className="font-medium">{p.number}</span> <span className="text-muted-foreground">{p.partner?.name} · {formatDate(p.payment_date)}{p.reference ? ` · ${p.reference}` : ''}</span></span>
                <span className={cn('tabular', exact ? 'font-semibold text-success' : 'text-muted-foreground')}>{formatMoney(signed(p))} {p.currency_code !== currency ? company?.base_currency : ''}</span>
              </button>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function BookDialog({ line, onClose }: { line: StatementLine; onClose: () => void }) {
  const accounts = useAccounts()
  const defaults = useAccountDefaults()
  const partners = usePartners()
  const book = useBookStatementLine()
  const [account, setAccount] = React.useState<string | null>(null)
  const [partner, setPartner] = React.useState<string | null>(line.partner_id)
  const [memo, setMemo] = React.useState(line.description)
  React.useEffect(() => {
    // bank charges are the usual suspect for small outflows
    if (!account && defaults.data && num(line.amount) < 0 && Math.abs(num(line.amount)) < 5000) {
      const guess = defaults.data.find((d) => d.key === 'bank_charges')?.account_id
      if (guess) setAccount(guess)
    }
  }, [defaults.data]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{t('Record to an account')}</DialogTitle>
          <DialogDescription>{t('For fees, interest, loan repayments or owner transfers. A bank entry of {amount} is recorded.', { amount: formatMoney(line.amount) })}</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label>{t('Account')}</Label>
            <SearchSelect value={account} onChange={setAccount} placeholder={t('Choose the account')}
              options={(accounts.data ?? []).filter((a) => a.is_postable && a.is_active).map((a) => ({ value: a.id, label: `${a.code} ${td(a.name)}`, keywords: [a.account_type, a.name] }))} /></div>
          <div className="grid gap-1.5"><Label>{t('Partner (optional)')}</Label>
            <SearchSelect value={partner} onChange={setPartner} clearable placeholder={t('None')} options={(partners.data ?? []).map((p) => ({ value: p.id, label: p.name, hint: p.code }))} /></div>
          <div className="grid gap-1.5"><Label htmlFor="bk-memo">{t('Description')}</Label><Input id="bk-memo" value={memo} onChange={(e) => setMemo(e.target.value)} /></div>
        </div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={book.isPending} disabled={!account} onClick={async () => { await book.mutateAsync({ line: line.id, account: account!, memo, partner }); toast.success(t('Recorded')); onClose() }}>{t('Record')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
