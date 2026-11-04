import { zodResolver } from '@hookform/resolvers/zod'
import { ChevronRight, Plus } from 'lucide-react'
import * as React from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { z } from 'zod'
import { Can, useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { describeError } from '@/lib/errors'
import { ErrorState } from '@/components/error-state'
import { msg, t, td, tServer } from '@/i18n'
import { cn, formatDate, formatMoney, humanize, num, todayISO } from '@/lib/utils'
import { SOURCE_HREF, sourceLabel, useAccountBalances, useAccountLedger, useAccounts, useSaveAccount, type Account } from '../api'

const yearStart = () => `${new Date().getFullYear()}-01-01`
const TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const
const SUBTYPES: Record<string, string[]> = {
  asset: ['cash', 'bank', 'receivable', 'inventory', 'current_asset', 'fixed_asset', 'accumulated_depreciation', 'non_current_asset', 'tax'],
  liability: ['payable', 'tax', 'current_liability', 'long_term_liability'],
  equity: ['equity', 'retained_earnings'],
  revenue: ['revenue', 'other_income'],
  expense: ['cogs', 'expense', 'depreciation', 'other_expense'],
}
const SUBTYPE_LABEL: Record<string, string> = { cogs: msg('Cost of goods sold'), tax: msg('Taxes'), current_asset: msg('Other current asset'), current_liability: msg('Other current liability') }
export const subtypeLabel = (k: string) => (SUBTYPE_LABEL[k] ? t(SUBTYPE_LABEL[k]) : humanize(k))
/** Balance shown with the account's natural sign: assets/expenses debit-positive, the rest credit-positive */
export const natural = (type: string, v: number) => (type === 'asset' || type === 'expense' ? v : -v)

export function AccountsPage() {
  const navigate = useNavigate()
  const accounts = useAccounts()
  const balances = useAccountBalances(yearStart(), todayISO())
  const [edit, setEdit] = React.useState<Account | 'new' | null>(null)
  const [q, setQ] = React.useState('')
  const [hideEmpty, setHideEmpty] = React.useState(false)
  const bal = React.useMemo(() => new Map((balances.data ?? []).map((b) => [b.account_id, b])), [balances.data])

  const rows = React.useMemo(() => {
    const list = accounts.data ?? []
    const childrenOf = new Map<string | null, Account[]>()
    list.forEach((a) => { const k = a.parent_id ?? null; childrenOf.set(k, [...(childrenOf.get(k) ?? []), a]) })
    const out: { a: Account; depth: number; closing: number; ytd: number }[] = []
    const total = (a: Account): { closing: number; ytd: number } => {
      const own = bal.get(a.id)
      let closing = num(own?.closing); let ytd = num(own?.debit) - num(own?.credit)
      for (const c of childrenOf.get(a.id) ?? []) { const sub = total(c); closing += sub.closing; ytd += sub.ytd }
      return { closing, ytd }
    }
    const walk = (parent: string | null, depth: number) => {
      for (const a of (childrenOf.get(parent) ?? []).sort((x, y) => x.code.localeCompare(y.code))) {
        out.push({ a, depth, ...total(a) })
        walk(a.id, depth + 1)
      }
    }
    walk(null, 0)
    const term = q.trim().toLowerCase()
    return out.filter((r) => (!term || r.a.code.startsWith(term) || r.a.name.toLowerCase().includes(term) || td(r.a.name).toLowerCase().includes(term)) && (!hideEmpty || !r.a.is_postable || r.closing !== 0 || r.ytd !== 0))
  }, [accounts.data, bal, q, hideEmpty])

  return (
    <>
      <PageHeader title={t('Chart of accounts')} description={t('Accounts numbered by class, as in the national accounting standards. Balances are from the start of the year; open an account to see its movements.')}
        actions={<Can perm="finance.write"><Button onClick={() => setEdit('new')}><Plus /> {t('New account')}</Button></Can>} />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Code or name…')} className="max-w-xs" aria-label={t('Search accounts')} />
        <label className="flex items-center gap-2 text-[13px]"><Switch checked={hideEmpty} onCheckedChange={setHideEmpty} /> {t('Only accounts with movements')}</label>
      </div>
      <Card>
        <CardContent className="overflow-x-auto p-0">
          {accounts.isLoading ? <Skeleton className="m-4 h-64" /> : accounts.isError ? <ErrorState error={accounts.error} onRetry={() => void accounts.refetch()} /> : !rows.length ? (
            <EmptyState title={q ? t('No account matches “{q}”', { q }) : t('No accounts with movements this year')} description={t('Try another code or name, or show all accounts.')} />
          ) : (
            <Table className="min-w-[760px]">
              <TableHeader><TableRow className="hover:bg-transparent">
                <TableHead className="w-[45%]">{t('Account')}</TableHead><TableHead>{t('Type')}</TableHead><TableHead className="text-right">{t('Movement this year')}</TableHead><TableHead className="text-right">{t('Balance')}</TableHead><TableHead className="w-10" />
              </TableRow></TableHeader>
              <TableBody>
                {rows.map(({ a, depth, closing, ytd }) => (
                  <TableRow key={a.id} className={cn('cursor-pointer', !a.is_postable && 'bg-muted/40 font-semibold')} onClick={() => a.is_postable ? navigate(`/finance/accounts/${a.id}`) : undefined}>
                    <TableCell style={{ paddingLeft: 16 + depth * 20 }}>
                      <span className="font-mono">{a.code}</span> <span className={cn(!a.is_active && 'text-muted-foreground line-through')}>{td(a.name)}</span>
                      {a.is_reconcilable && <Badge variant="outline" className="ml-2">{t('open items')}</Badge>}
                    </TableCell>
                    <TableCell className="text-[13px] text-muted-foreground">{subtypeLabel(a.account_subtype)}</TableCell>
                    <TableCell className="text-right tabular text-muted-foreground">{ytd ? formatMoney(natural(a.account_type, ytd)) : '—'}</TableCell>
                    <TableCell className={cn('text-right tabular', a.is_postable && a.account_subtype !== 'accumulated_depreciation' && natural(a.account_type, closing) < 0 && 'text-destructive')}>{closing ? formatMoney(natural(a.account_type, closing)) : '—'}</TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}><Can perm="finance.write"><Button size="sm" variant="ghost" onClick={() => setEdit(a)}>{t('Edit')}</Button></Can></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <AccountDialog key={edit === 'new' ? 'new' : edit?.id ?? 'none'} open={!!edit} account={edit === 'new' ? undefined : edit ?? undefined} accounts={accounts.data ?? []} onClose={() => setEdit(null)} />
    </>
  )
}

const accountSchema = z.object({
  code: z.string().trim().min(1, 'Enter a code').max(20).regex(/^[0-9A-Za-z.-]+$/, 'Digits and letters only'),
  name: z.string().trim().min(2, 'Enter a name'),
  account_type: z.enum(TYPES),
  account_subtype: z.string().min(1),
  parent_id: z.string().uuid().nullable().optional(),
  is_postable: z.boolean(),
  is_reconcilable: z.boolean(),
  is_active: z.boolean(),
  cash_flow_category: z.enum(['operating', 'investing', 'financing']).nullable().optional(),
})
type AccountValues = z.infer<typeof accountSchema>

function AccountDialog({ open, account, accounts, onClose }: { open: boolean; account?: Account; accounts: Account[]; onClose: () => void }) {
  const save = useSaveAccount()
  const form = useForm<AccountValues>({
    resolver: zodResolver(accountSchema),
    defaultValues: {
      code: account?.code ?? '', name: account?.name ?? '', account_type: (account?.account_type as AccountValues['account_type']) ?? 'expense',
      account_subtype: account?.account_subtype ?? 'expense', parent_id: account?.parent_id ?? null, is_postable: account?.is_postable ?? true,
      is_reconcilable: account?.is_reconcilable ?? false, is_active: account?.is_active ?? true,
      cash_flow_category: (account?.cash_flow_category as AccountValues['cash_flow_category']) ?? 'operating',
    },
  })
  const type = form.watch('account_type')
  const submit = form.handleSubmit(async (v) => {
    try { await save.mutateAsync({ id: account?.id, ...v, parent_id: v.parent_id ?? null, cash_flow_category: v.cash_flow_category ?? null }); toast.success(t('Account saved')); onClose() }
    catch (e) { const m = describeError(e); if (/duplicate|accounts_code_key/i.test(m)) form.setError('code', { message: t('This code is already used') }); else toast.error(m) }
  })
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{account ? t('Edit {name}', { name: account.code }) : t('New account')}</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} className="grid grid-cols-2 gap-3">
            <FormField control={form.control} name="code" render={({ field }) => (<FormItem><FormLabel>{t('Code')}</FormLabel><FormControl><Input className="font-mono" disabled={!!account} {...field} /></FormControl><FormMessage /></FormItem>)} />
            <FormField control={form.control} name="parent_id" render={({ field }) => (
              <FormItem><FormLabel optional>{t('Group')}</FormLabel>
                <Select value={field.value ?? '__none'} onValueChange={(v) => field.onChange(v === '__none' ? null : v)}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent><SelectItem value="__none">{t('None')}</SelectItem>{accounts.filter((a) => !a.is_postable && a.id !== account?.id).map((a) => <SelectItem key={a.id} value={a.id}>{a.code} {td(a.name)}</SelectItem>)}</SelectContent></Select></FormItem>
            )} />
            <FormField control={form.control} name="name" render={({ field }) => (<FormItem className="col-span-2"><FormLabel>{t('Name')}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
            <FormField control={form.control} name="account_type" render={({ field }) => (
              <FormItem><FormLabel>{t('Type')}</FormLabel>
                <Select value={field.value} onValueChange={(v) => { field.onChange(v); form.setValue('account_subtype', SUBTYPES[v]![0]!) }} disabled={!!account}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>{TYPES.map((k) => <SelectItem key={k} value={k}>{humanize(k)}</SelectItem>)}</SelectContent></Select></FormItem>
            )} />
            <FormField control={form.control} name="account_subtype" render={({ field }) => (
              <FormItem><FormLabel>{t('Kind')}</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>{(SUBTYPES[type] ?? []).map((k) => <SelectItem key={k} value={k}>{subtypeLabel(k)}</SelectItem>)}</SelectContent></Select>
                <FormDescription>{t('Decides where it appears in the financial statements.')}</FormDescription></FormItem>
            )} />
            <FormField control={form.control} name="cash_flow_category" render={({ field }) => (
              <FormItem className="col-span-2"><FormLabel optional>{t('Cash flow section')}</FormLabel>
                <Select value={field.value ?? '__none'} onValueChange={(v) => field.onChange(v === '__none' ? null : v)}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent><SelectItem value="__none">{t('None (cash itself)')}</SelectItem><SelectItem value="operating">{t('Operating')}</SelectItem><SelectItem value="investing">{t('Investing')}</SelectItem><SelectItem value="financing">{t('Financing')}</SelectItem></SelectContent></Select></FormItem>
            )} />
            {([['is_postable', msg('Can be used in entries'), msg('Off for group headings')], ['is_reconcilable', msg('Track open items'), msg('Receivables, payables, bank')], ['is_active', msg('Active'), msg('Inactive accounts cannot be used in entries')]] as const).map(([n, l, d]) => (
              <FormField key={n} control={form.control} name={n} render={({ field }) => (
                <FormItem className="flex flex-row items-start gap-2 space-y-0"><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl><div><FormLabel>{t(l)}</FormLabel><FormDescription>{t(d)}</FormDescription></div></FormItem>
              )} />
            ))}
            <DialogFooter className="col-span-2"><Button type="button" variant="ghost" onClick={onClose}>{t('Cancel')}</Button><Button type="submit" loading={save.isPending}>{t('Save')}</Button></DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

export function AccountLedgerPage() {
  const { id } = useParams()
  const { company } = useCompany()
  const accounts = useAccounts()
  const [from, setFrom] = React.useState(yearStart())
  const [to, setTo] = React.useState(todayISO())
  const ledger = useAccountLedger(id, from, to)
  const a = accounts.data?.find((x) => x.id === id)
  if (accounts.isLoading) return <Skeleton className="h-64" />
  if (accounts.isError) return <ErrorState error={accounts.error} onRetry={() => void accounts.refetch()} />
  if (!a) return <EmptyState title={t('Account not found')} action={<Button variant="outline" asChild><Link to="/finance/accounts">{t('Back to the chart of accounts')}</Link></Button>} />
  let running = ledger.data?.opening ?? 0
  return (
    <div className="w-full">
      <PageHeader back={{ href: '/finance/accounts', label: t('Chart of accounts') }} title={<><span className="font-mono">{a.code}</span> {td(a.name)}</>}
        meta={<Badge variant="outline">{subtypeLabel(a.account_subtype)}</Badge>}
        description={a.account_type === 'asset' || a.account_type === 'expense' ? t('Amounts in {cur}. Debits increase this account.', { cur: company?.base_currency ?? '' }) : t('Amounts in {cur}. Credits increase this account.', { cur: company?.base_currency ?? '' })}
        actions={<>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-[150px]" aria-label={t('From')} />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-[150px]" aria-label={t('To')} />
        </>} />
      <Card>
        <CardContent className="overflow-x-auto p-0">
          {ledger.isLoading ? <Skeleton className="m-4 h-64" /> : ledger.isError ? <ErrorState error={ledger.error} onRetry={() => void ledger.refetch()} /> : (
            <Table className="min-w-[900px]">
              <TableHeader><TableRow className="hover:bg-transparent">
                <TableHead>{t('Date')}</TableHead><TableHead>{t('Entry')}</TableHead><TableHead>{t('Source')}</TableHead><TableHead>{t('Description')}</TableHead>
                <TableHead className="text-right">{t('Debit')}</TableHead><TableHead className="text-right">{t('Credit')}</TableHead><TableHead className="text-right">{t('Balance')}</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                <TableRow className="bg-muted/40 hover:bg-muted/40"><TableCell colSpan={6} className="text-[13px] font-medium">{t('Opening balance on {date}', { date: formatDate(from) })}</TableCell>
                  <TableCell className="text-right tabular font-medium">{formatMoney(natural(a.account_type, ledger.data?.opening ?? 0))}</TableCell></TableRow>
                {ledger.data?.rows.map((l) => {
                  running += num(l.debit) - num(l.credit)
                  const href = l.entry.source_doc_type ? SOURCE_HREF[l.entry.source_doc_type] : undefined
                  return (
                    <TableRow key={l.id}>
                      <TableCell className="text-[13px]">{formatDate(l.entry.entry_date)}</TableCell>
                      <TableCell><Link className="text-primary hover:underline" to={`/finance/journal/${l.entry_id}`}>{l.entry.number}</Link></TableCell>
                      <TableCell className="text-[13px]">{href && l.entry.source_doc_id ? <Link className="hover:underline" to={href + l.entry.source_doc_id}>{sourceLabel(l.entry.source_doc_type)} {l.entry.reference}</Link> : l.entry.reference ?? '—'}</TableCell>
                      <TableCell className="max-w-[260px] truncate text-[13px] text-muted-foreground">{[l.partner?.name, tServer(l.description ?? l.entry.memo)].filter(Boolean).join(' · ')}</TableCell>
                      <TableCell className="text-right tabular">{num(l.debit) ? formatMoney(l.debit) : ''}</TableCell>
                      <TableCell className="text-right tabular">{num(l.credit) ? formatMoney(l.credit) : ''}</TableCell>
                      <TableCell className="text-right tabular">{formatMoney(natural(a.account_type, running))}</TableCell>
                    </TableRow>
                  )
                })}
                {!ledger.data?.rows.length && <TableRow><TableCell colSpan={7} className="py-8 text-center text-[13px] text-muted-foreground">{t('No movements in this period.')}</TableCell></TableRow>}
                <TableRow className="bg-muted/40 hover:bg-muted/40"><TableCell colSpan={6} className="text-[13px] font-medium"><ChevronRight className="mr-1 inline size-3.5" />{t('Closing balance on {date}', { date: formatDate(to) })}</TableCell>
                  <TableCell className="text-right tabular font-semibold">{formatMoney(natural(a.account_type, ledger.data?.closing ?? 0))}</TableCell></TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
