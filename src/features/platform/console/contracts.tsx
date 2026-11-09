import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, FileSignature, Plus, Printer, RefreshCw, Trash2, XCircle } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { msg, t, tn } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { printHtml } from '@/lib/print'
import { supabase } from '@/lib/supabase'
import { cn, formatDate, formatMoney, num, todayISO } from '@/lib/utils'
import { usePlatformClients } from '../api'

/*
 * Client contracts: what each client pays, how often DrisPRO invoices it, and until when. The invoices are
 * sales invoices of DrisPRO's own company (the billing company); the client's licence follows the contract.
 */
type Line = { description: string; quantity: number; unit_price: number; once: boolean }
type Licence = { plan?: string | null; package?: string | null; max_users?: number | null; max_registers?: number | null; max_warehouses?: number | null }
export type Contract = {
  id: string; number: string; client_company_id: string; client: string; client_nui: string | null; status: 'draft' | 'active' | 'ended' | 'cancelled'
  signed_on: string | null; start_date: string; end_date: string; term_months: number; auto_renew: boolean; every_months: number; invoice_day: number
  payment_days: number; discount_pct: number; currency: string; lines: Line[]; licence: Licence; notes: string | null
  year_value: number; month_value: number; once_value: number; next_invoice: string | null; days_left: number; invoiced: number; open: number; overdue: number
  overdue_days: number | null; drafts: number; renewals: number; end_reason: string | null
  invoices?: { id: string; number: string; date: string; due_date: string | null; status: string; total: number; amount_due: number }[]
  history?: { id: string; number: string; start_date: string; end_date: string; status: string }[]
}
type Billing = { billing_company_id: string | null; billing_company: string | null; tax_code: string; post: boolean; email: boolean; grace_days: number
  tax_codes: { code: string; rate: number }[]; companies: { id: string; name: string }[] }

const KEY = ['platform', 'contracts'] as const
const EVERY: [number, string][] = [[1, msg('Every month')], [3, msg('Every 3 months')], [6, msg('Every 6 months')], [12, msg('Once a year')]]
const everyText = (n: number) => { const e = EVERY.find(([k]) => k === n); return e ? t(e[1]) : t('Every {n} months', { n }) }
const STATUS_TONE: Record<Contract['status'], string> = { draft: 'draft', active: 'active', ended: 'closed', cancelled: 'cancelled' }
const STATUS_TEXT: Record<Contract['status'], string> = { draft: msg('Draft|contract'), active: msg('Active|contract'), ended: msg('Ended|contract'), cancelled: msg('Cancelled|contract') }

function useContracts(company?: string) {
  return useQuery({ queryKey: [...KEY, 'list', company ?? 'all'], refetchInterval: 60_000,
    queryFn: async () => unwrap(await supabase.rpc('platform_contracts', { p_company: (company ?? null) as unknown as string })) as unknown as
      { contracts: Contract[]; totals: { active: number; year_value: number; ending_30: number; drafts: number } } })
}
function useBilling() {
  return useQuery({ queryKey: [...KEY, 'billing'], queryFn: async () => unwrap(await supabase.rpc('platform_billing_settings')) as unknown as Billing })
}

/* ------------------------------------------------------------------ the list */
export function ContractsPage() {
  const q = useContracts()
  const billing = useBilling()
  const navigate = useNavigate()
  const [editBilling, setEditBilling] = React.useState(false)
  const d = q.data
  const eur = (v: number) => formatMoney(v, 'EUR')
  return (
    <div className="grid gap-4">
      <PageHeader title={t('Contracts')} description={t('What each client pays, how often DrisPRO invoices it and until when. The invoices are made by DrisPRO\'s own company; the licence follows the contract.')}
        actions={<><Button variant="outline" onClick={() => setEditBilling(true)}>{t('Billing')}</Button><Button onClick={() => navigate('/platform/contracts/new')}><Plus /> {t('New contract')}</Button></>} />
      {billing.data && !billing.data.billing_company_id && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-[13px]">
          <span className="flex-1">{t('Choose DrisPRO\'s own company first: its invoices go out from there, with its numbers, VAT and receivables.')}</span>
          <Button size="sm" onClick={() => setEditBilling(true)}>{t('Choose the company')}</Button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t('Active contracts')} value={d?.totals.active ?? 0} loading={q.isLoading} />
        <StatCard label={t('A year, without VAT')} value={eur(num(d?.totals.year_value))} hint={t('{amount} a month', { amount: eur(num(d?.totals.year_value) / 12) })} loading={q.isLoading} />
        <StatCard label={t('Ending in 30 days')} value={d?.totals.ending_30 ?? 0} tone={d?.totals.ending_30 ? 'warning' : 'default'} hint={t('and not renewing by themselves')} loading={q.isLoading} />
        <StatCard label={t('Drafts')} value={d?.totals.drafts ?? 0} hint={t('not active yet')} loading={q.isLoading} />
      </div>
      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.isLoading ? <Skeleton className="h-64" /> : !d?.contracts.length
        ? <EmptyState icon={FileSignature} title={t('No contracts yet')} description={t('A contract says what the client pays each month and for how long. Make the first one.')}
            action={<Button onClick={() => navigate('/platform/contracts/new')}><Plus /> {t('New contract')}</Button>} />
        : <ContractsTable rows={d.contracts} />}
      {editBilling && billing.data && <BillingDialog b={billing.data} onClose={() => setEditBilling(false)} />}
    </div>
  )
}

export function ContractsTable({ rows }: { rows: Contract[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full text-[13px]">
        <thead className="border-b bg-muted/40 text-left text-[12px] text-muted-foreground"><tr>
          <th className="px-3 py-2 font-medium">{t('Client')}</th><th className="px-3 py-2 font-medium">{t('Contract')}</th>
          <th className="px-3 py-2 font-medium">{t('Period')}</th><th className="px-3 py-2 text-right font-medium">{t('A month')}</th>
          <th className="px-3 py-2 font-medium">{t('Invoiced')}</th><th className="px-3 py-2 text-right font-medium">{t('Open')}</th><th className="px-3 py-2 font-medium">{t('Status')}</th>
        </tr></thead>
        <tbody className="divide-y">
          {rows.map((c) => (
            <tr key={c.id} className="hover:bg-muted/30">
              <td className="px-3 py-2"><Link to={`/platform/contracts/${c.id}`} className="font-medium hover:underline">{c.client}</Link>
                {c.client_nui && <span className="block text-[12px] text-muted-foreground">{t('NUI {n}', { n: c.client_nui })}</span>}</td>
              <td className="px-3 py-2 font-mono text-[12.5px]">{c.number}</td>
              <td className="px-3 py-2 whitespace-nowrap">{formatDate(c.start_date)} – {formatDate(c.end_date)}
                <span className={cn('block text-[12px]', c.status === 'active' && c.days_left <= 30 && !c.auto_renew ? 'font-medium text-warning' : 'text-muted-foreground')}>
                  {c.status === 'active' ? (c.auto_renew ? t('renews by itself') : t('{n} days left', { n: c.days_left })) : ''}</span></td>
              <td className="px-3 py-2 text-right tabular">{formatMoney(c.month_value, c.currency)}{c.once_value > 0 && <span className="block text-[12px] text-muted-foreground">{t('+{amount} once', { amount: formatMoney(c.once_value, c.currency) })}</span>}</td>
              <td className="px-3 py-2">{everyText(c.every_months)}{c.next_invoice && <span className="block text-[12px] text-muted-foreground">{t('next {date}', { date: formatDate(c.next_invoice) })}</span>}</td>
              <td className={cn('px-3 py-2 text-right tabular', c.overdue > 0 && 'font-medium text-destructive')}>{c.open > 0 ? formatMoney(c.open, c.currency) : '—'}
                {c.overdue > 0 && <span className="block text-[12px]">{t('{n} days late', { n: c.overdue_days ?? 0 })}</span>}</td>
              <td className="px-3 py-2"><StatusBadge status={STATUS_TONE[c.status]} label={t(STATUS_TEXT[c.status])} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BillingDialog({ b, onClose }: { b: Billing; onClose: () => void }) {
  const qc = useQueryClient()
  const [v, setV] = React.useState({ billing_company_id: b.billing_company_id ?? '', tax_code: b.tax_code, post: b.post, email: b.email, grace_days: String(b.grace_days) })
  const save = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('platform_billing_save', { p: { ...v, grace_days: Number(v.grace_days) || 0 } as never })),
    onSuccess: () => { toast.success(t('Saved')); void qc.invalidateQueries({ queryKey: KEY }); onClose() },
    onError: (e) => toast.error(describeError(e)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{t('Billing')}</DialogTitle>
          <DialogDescription>{t('DrisPRO\'s invoices to its clients are sales invoices of this company: its numbering, VAT, receivables and payments.')}</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label>{t('DrisPRO\'s own company')}</Label>
            <Select value={v.billing_company_id} onValueChange={(x) => setV({ ...v, billing_company_id: x })}>
              <SelectTrigger><SelectValue placeholder={t('Choose the company')} /></SelectTrigger>
              <SelectContent>{b.companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select></div>
          <div className="grid gap-1.5"><Label>{t('VAT on the invoices')}</Label>
            <Select value={v.tax_code} onValueChange={(x) => setV({ ...v, tax_code: x })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{(b.tax_codes.length ? b.tax_codes : [{ code: v.tax_code, rate: 18 }]).map((x) => <SelectItem key={x.code} value={x.code}>{x.code} · {num(x.rate)}%</SelectItem>)}</SelectContent>
            </Select></div>
          <label className="flex items-center justify-between gap-3 text-[13px]"><span>{t('Post the invoices at once (otherwise they wait as drafts to be checked)')}</span>
            <Switch checked={v.post} onCheckedChange={(x) => setV({ ...v, post: x })} /></label>
          <label className="flex items-center justify-between gap-3 text-[13px]"><span>{t('E-mail each invoice to the client')}</span>
            <Switch checked={v.email} onCheckedChange={(x) => setV({ ...v, email: x })} /></label>
          <div className="grid gap-1.5"><Label htmlFor="grace">{t('Days the licence runs after the contract ends')}</Label>
            <Input id="grace" inputMode="numeric" className="w-24" value={v.grace_days} onChange={(e) => setV({ ...v, grace_days: e.target.value.replace(/\D/g, '') })} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>{t('Cancel')}</Button><Button loading={save.isPending} disabled={!v.billing_company_id} onClick={() => save.mutate()}>{t('Save')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ one contract: edit, activate, renew, end, its invoices */
const blankLine = (): Line => ({ description: '', quantity: 1, unit_price: 0, once: false })
export function ContractPage() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const isNew = id === 'new'
  const navigate = useNavigate()
  const qc = useQueryClient()
  const clients = usePlatformClients()
  const q = useQuery({ queryKey: [...KEY, 'one', id], enabled: !isNew && !!id,
    queryFn: async () => unwrap(await supabase.rpc('platform_contract_get', { p_id: id! })) as unknown as Contract })
  const c = q.data
  const [v, setV] = React.useState<Omit<Contract, 'id' | 'number' | 'client' | 'client_nui' | 'status' | 'year_value' | 'month_value' | 'once_value' | 'next_invoice' | 'days_left' | 'invoiced' | 'open' | 'overdue' | 'overdue_days' | 'drafts' | 'renewals' | 'end_reason'> | null>(null)
  React.useEffect(() => {
    if (isNew && !v) setV({ client_company_id: params.get('client') ?? '', signed_on: todayISO(), start_date: todayISO(), end_date: '', term_months: 12, auto_renew: true,
      every_months: 1, invoice_day: 1, payment_days: 15, discount_pct: 0, currency: 'EUR', notes: '', licence: {},
      lines: [{ description: 'DrisPRO', quantity: 1, unit_price: 0, once: false }, { description: t('Installation and training'), quantity: 1, unit_price: 0, once: true }] })
    if (c && !v) setV({ client_company_id: c.client_company_id, signed_on: c.signed_on, start_date: c.start_date, end_date: c.end_date, term_months: c.term_months,
      auto_renew: c.auto_renew, every_months: c.every_months, invoice_day: c.invoice_day, payment_days: c.payment_days, discount_pct: num(c.discount_pct),
      currency: c.currency, notes: c.notes ?? '', licence: c.licence ?? {}, lines: c.lines })
  }, [isNew, c, v, params])
  const refresh = () => { setV(null); void qc.invalidateQueries({ queryKey: KEY }) }
  const save = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('platform_contract_save', { p: { ...v, id: isNew ? null : id, end_date: isNew ? null : v!.end_date } as never })) as unknown as string,
    onSuccess: (newId) => { toast.success(t('Saved')); if (isNew) navigate(`/platform/contracts/${newId}`, { replace: true }); refresh() },
    onError: (e) => toast.error(describeError(e)),
  })
  const act = useMutation({
    mutationFn: async (f: () => PromiseLike<{ error: unknown }>) => { const r = await f(); if (r.error) throw r.error },
    onSuccess: () => { toast.success(t('Done')); refresh() },
    onError: (e) => toast.error(describeError(e)),
  })
  const [ending, setEnding] = React.useState(false)
  const [renewing, setRenewing] = React.useState(false)

  if (!isNew && q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  if (!v) return <Skeleton className="h-96" />
  const closed = c && (c.status === 'ended' || c.status === 'cancelled')
  const cur = v.currency
  const monthly = v.lines.filter((l) => !l.once).reduce((s, l) => s + num(l.quantity) * num(l.unit_price), 0) * (1 - num(v.discount_pct) / 100)
  const once = v.lines.filter((l) => l.once).reduce((s, l) => s + num(l.quantity) * num(l.unit_price), 0) * (1 - num(v.discount_pct) / 100)
  const setLine = (i: number, p: Partial<Line>) => setV({ ...v, lines: v.lines.map((l, j) => (j === i ? { ...l, ...p } : l)) })
  const client = clients.data?.clients.find((x) => x.id === v.client_company_id)
  const ready = !!v.client_company_id && v.lines.length > 0 && v.lines.every((l) => l.description.trim() && num(l.quantity) > 0)
  return (
    <div className="grid gap-4">
      <PageHeader title={isNew ? t('New contract') : `${c?.number ?? ''} · ${c?.client ?? ''}`}
        description={c ? <span className="flex flex-wrap items-center gap-2"><StatusBadge status={STATUS_TONE[c.status]} label={t(STATUS_TEXT[c.status])} />
          {c.status === 'active' && <span>{c.auto_renew ? t('renews by itself on {date}', { date: formatDate(c.end_date) }) : t('ends on {date}', { date: formatDate(c.end_date) })}</span>}
          {c.end_reason && <span className="text-muted-foreground">· {c.end_reason}</span>}</span> : t('What the client pays each month, how often it is invoiced and for how long.')}
        actions={<>
          {c && <Button variant="outline" onClick={() => printContract(c)}><Printer /> {t('Print')}</Button>}
          {c?.status === 'active' && <Button variant="outline" onClick={() => setRenewing(true)}><RefreshCw /> {t('Renew')}</Button>}
          {c && !closed && <Button variant="outline" onClick={() => setEnding(true)}><XCircle /> {c.status === 'draft' ? t('Cancel the draft') : t('End')}</Button>}
          {!closed && <Button variant={c?.status === 'draft' ? 'outline' : 'default'} loading={save.isPending} disabled={!ready} onClick={() => save.mutate()}>{t('Save')}</Button>}
          {c?.status === 'draft' && <ConfirmDialog trigger={<Button><FileSignature /> {t('Activate')}</Button>} title={t('Activate the contract?')}
            description={t('The client becomes a customer of DrisPRO\'s company, the invoices start on {date} {every}, the one-time items are invoiced now and the licence runs to {end}.',
              { date: formatDate(c.start_date), every: everyText(c.every_months).toLowerCase(), end: formatDate(c.end_date) })}
            confirmLabel={t('Activate')} onConfirm={() => act.mutateAsync(() => supabase.rpc('platform_contract_activate', { p_id: c.id }))} />}
        </>} />

      {c && c.status !== 'draft' && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label={t('A year, without VAT')} value={formatMoney(c.year_value, cur)} hint={t('{amount} a month', { amount: formatMoney(c.month_value, cur) })} />
          <StatCard label={t('Invoiced, with VAT')} value={formatMoney(c.invoiced, cur)} hint={c.drafts ? tn(c.drafts, '{n} draft to check', '{n} drafts to check') : undefined} />
          <StatCard label={t('Still to pay')} value={formatMoney(c.open, cur)} tone={c.overdue > 0 ? 'destructive' : 'default'} hint={c.overdue > 0 ? t('{amount} late, {n} days', { amount: formatMoney(c.overdue, cur), n: c.overdue_days ?? 0 }) : t('Nothing late')} />
          <StatCard label={t('Next invoice')} value={c.next_invoice ? formatDate(c.next_invoice) : '—'} hint={everyText(c.every_months)} />
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>{t('The contract')}</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="grid gap-1.5 sm:col-span-2"><Label>{t('Client')}</Label>
            <Select value={v.client_company_id} disabled={!isNew} onValueChange={(x) => setV({ ...v, client_company_id: x })}>
              <SelectTrigger><SelectValue placeholder={t('Choose the client')} /></SelectTrigger>
              <SelectContent>{(clients.data?.clients ?? []).map((x) => <SelectItem key={x.id} value={x.id}>{x.name}{x.tax_number ? ` · ${x.tax_number}` : ''}</SelectItem>)}</SelectContent>
            </Select>
            {client && <span className="text-[12px] text-muted-foreground">{t('Licence today: {plan}, until {date}', { plan: client.plan ?? '—', date: formatDate(client.valid_until) })}</span>}</div>
          <div className="grid gap-1.5"><Label htmlFor="signed">{t('Signed on')}</Label><Input id="signed" type="date" disabled={!!closed} value={v.signed_on ?? ''} onChange={(e) => setV({ ...v, signed_on: e.target.value })} /></div>
          <div className="grid gap-1.5"><Label htmlFor="start">{t('Starts on')}</Label><Input id="start" type="date" disabled={c?.status !== undefined && c.status !== 'draft'} value={v.start_date} onChange={(e) => setV({ ...v, start_date: e.target.value })} /></div>
          <div className="grid gap-1.5"><Label>{t('Lasts')}</Label>
            <Select value={String(v.term_months)} disabled={!!closed} onValueChange={(x) => setV({ ...v, term_months: Number(x) })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{[12, 24, 36, 6, 3, 1].map((m) => <SelectItem key={m} value={String(m)}>{m % 12 === 0 ? tn(m / 12, '{n} year', '{n} years') : tn(m, '{n} month', '{n} months')}</SelectItem>)}</SelectContent>
            </Select></div>
          {!isNew && <div className="grid gap-1.5"><Label htmlFor="end">{t('Ends on')}</Label><Input id="end" type="date" disabled={!!closed} value={v.end_date} onChange={(e) => setV({ ...v, end_date: e.target.value })} /></div>}
          <div className="grid gap-1.5"><Label>{t('Invoiced')}</Label>
            <Select value={String(v.every_months)} disabled={!!closed} onValueChange={(x) => setV({ ...v, every_months: Number(x) })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{EVERY.map(([k, l]) => <SelectItem key={k} value={String(k)}>{t(l)}</SelectItem>)}</SelectContent>
            </Select></div>
          <div className="grid gap-1.5"><Label htmlFor="day">{t('On day of the month')}</Label><Input id="day" inputMode="numeric" disabled={!!closed} value={v.invoice_day} onChange={(e) => setV({ ...v, invoice_day: Math.min(28, Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1)) })} /></div>
          <div className="grid gap-1.5"><Label htmlFor="pay">{t('Paid within (days)')}</Label><Input id="pay" inputMode="numeric" disabled={!!closed} value={v.payment_days} onChange={(e) => setV({ ...v, payment_days: Number(e.target.value.replace(/\D/g, '')) || 0 })} /></div>
          <div className="grid gap-1.5"><Label htmlFor="disc">{t('Discount %')}</Label><Input id="disc" inputMode="decimal" disabled={!!closed} value={v.discount_pct} onChange={(e) => setV({ ...v, discount_pct: Number(e.target.value.replace(',', '.')) || 0 })} /></div>
          <label className="flex items-center gap-2 self-end pb-2 text-[13px] sm:col-span-2"><Switch checked={v.auto_renew} disabled={!!closed} onCheckedChange={(x) => setV({ ...v, auto_renew: x })} />
            {t('Renews by itself for one more term at the end')}</label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t('What the client pays')}</CardTitle>
          <CardDescription>{t('Monthly lines are invoiced {every}, without VAT; the program adds the VAT. One-time lines (installation, training, a server) are invoiced once, when the contract is activated.', { every: everyText(v.every_months).toLowerCase() })}</CardDescription></CardHeader>
        <CardContent className="grid gap-2">
          <div className="hidden gap-2 px-1 text-[12px] text-muted-foreground sm:grid sm:grid-cols-[1fr_5rem_8rem_7rem_2.5rem]">
            <span>{t('Description')}</span><span className="text-right">{t('Quantity')}</span><span className="text-right">{t('Price')}</span><span>{t('Once')}</span><span /></div>
          {v.lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_5rem_8rem] items-center gap-2 sm:grid-cols-[1fr_5rem_8rem_7rem_2.5rem]">
              <Input value={l.description} disabled={!!closed} aria-label={t('Description')} placeholder={t('e.g. DrisPRO Standard, extra user, extra till')} onChange={(e) => setLine(i, { description: e.target.value })} />
              <Input className="text-right" inputMode="decimal" disabled={!!closed} aria-label={t('Quantity')} value={l.quantity} onChange={(e) => setLine(i, { quantity: Number(e.target.value.replace(',', '.')) || 0 })} />
              <div className="relative"><Input className="pr-14 text-right" inputMode="decimal" disabled={!!closed} aria-label={t('Price')} value={l.unit_price} onChange={(e) => setLine(i, { unit_price: Number(e.target.value.replace(',', '.')) || 0 })} />
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">{l.once ? '€' : t('€/month')}</span></div>
              <label className="flex items-center gap-2 text-[13px]"><Checkbox checked={l.once} disabled={!!closed} onCheckedChange={(x) => setLine(i, { once: x === true })} />{t('Once')}</label>
              {!closed && <Button variant="ghost" size="icon" aria-label={t('Remove')} onClick={() => setV({ ...v, lines: v.lines.filter((_, j) => j !== i) })}><Trash2 /></Button>}
            </div>
          ))}
          {!closed && <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => setV({ ...v, lines: [...v.lines, blankLine()] })}><Plus /> {t('Add a line')}</Button>}
          <div className="mt-2 grid gap-1 justify-self-end text-right text-[13px]">
            <span>{t('A month')}: <b className="tabular">{formatMoney(monthly, cur)}</b> · {t('a year')}: <b className="tabular">{formatMoney(monthly * 12, cur)}</b> <span className="text-muted-foreground">({t('without VAT')})</span></span>
            {once > 0 && <span>{t('Once')}: <b className="tabular">{formatMoney(once, cur)}</b></span>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t('The licence by the contract')}</CardTitle>
          <CardDescription>{t('The licence runs to the end of the contract (plus the grace days). Leave a field empty to keep what the licence has.')}</CardDescription></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          {([['max_users', msg('Users')], ['max_registers', msg('Tills')], ['max_warehouses', msg('Units|places')]] as const).map(([k, l]) => (
            <div key={k} className="grid gap-1.5"><Label htmlFor={k}>{t(l)}</Label>
              <Input id={k} inputMode="numeric" disabled={!!closed} value={v.licence[k] ?? ''} placeholder={t('as it is')}
                onChange={(e) => setV({ ...v, licence: { ...v.licence, [k]: e.target.value === '' ? null : Number(e.target.value.replace(/\D/g, '')) } })} /></div>
          ))}
          <div className="grid gap-1.5 sm:col-span-3"><Label htmlFor="notes">{t('Notes')}</Label><Textarea id="notes" rows={2} disabled={!!closed} value={v.notes ?? ''} onChange={(e) => setV({ ...v, notes: e.target.value })} /></div>
        </CardContent>
      </Card>

      {c?.invoices && c.invoices.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t('Invoices of the contract')}</CardTitle>
            <CardDescription>{t('Sales invoices of DrisPRO\'s company. Payments, reminders and the PDF are there.')}</CardDescription></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-[13px]">
              <thead className="border-b text-left text-[12px] text-muted-foreground"><tr><th className="px-4 py-2 font-medium">{t('Number')}</th><th className="px-4 py-2 font-medium">{t('Date')}</th>
                <th className="px-4 py-2 font-medium">{t('Due')}</th><th className="px-4 py-2 text-right font-medium">{t('Total with VAT')}</th><th className="px-4 py-2 text-right font-medium">{t('Still to pay')}</th><th className="px-4 py-2 font-medium">{t('Status')}</th></tr></thead>
              <tbody className="divide-y">
                {c.invoices.map((i) => {
                  const late = i.status === 'posted' && num(i.amount_due) > 0 && i.due_date && i.due_date < todayISO()
                  return (
                    <tr key={i.id}><td className="px-4 py-2 font-mono text-[12.5px]">{i.number}</td><td className="px-4 py-2">{formatDate(i.date)}</td>
                      <td className={cn('px-4 py-2', late && 'font-medium text-destructive')}>{formatDate(i.due_date)}</td>
                      <td className="px-4 py-2 text-right tabular">{formatMoney(i.total, cur)}</td>
                      <td className={cn('px-4 py-2 text-right tabular', late && 'font-medium text-destructive')}>{i.status === 'posted' ? formatMoney(i.amount_due, cur) : '—'}</td>
                      <td className="px-4 py-2"><StatusBadge status={i.status} /></td></tr>
                  )
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
      {c?.history && c.history.length > 0 && (
        <p className="text-[13px] text-muted-foreground">{t('Other contracts of this client:')} {c.history.map((h, i) => (
          <React.Fragment key={h.id}>{i > 0 && ', '}<Link className="text-primary hover:underline" to={`/platform/contracts/${h.id}`}>{h.number}</Link> ({formatDate(h.start_date)} – {formatDate(h.end_date)})</React.Fragment>))}</p>
      )}

      {ending && c && <EndDialog c={c} onClose={(ok) => { setEnding(false); if (ok) refresh() }} />}
      {renewing && c && <RenewDialog c={c} onClose={(ok) => { setRenewing(false); if (ok) refresh() }} />}
    </div>
  )
}

function EndDialog({ c, onClose }: { c: Contract; onClose: (ok: boolean) => void }) {
  const [reason, setReason] = React.useState('')
  const [on, setOn] = React.useState(todayISO())
  const end = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('platform_contract_end', { p_id: c.id, p_reason: reason, p_on: c.status === 'active' ? on : (null as unknown as string) })),
    onSuccess: () => { toast.success(t('Done')); onClose(true) },
    onError: (e) => toast.error(describeError(e)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose(false)}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{c.status === 'draft' ? t('Cancel the draft') : t('End the contract')}</DialogTitle>
          <DialogDescription>{c.status === 'draft' ? t('Nothing has been invoiced from it.') : t('No more invoices are made. The licence runs to the end date plus the grace days; invoices already made stay to be paid.')}</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          {c.status === 'active' && <div className="grid gap-1.5"><Label htmlFor="on">{t('Ends on')}</Label><Input id="on" type="date" value={on} onChange={(e) => setOn(e.target.value)} /></div>}
          <div className="grid gap-1.5"><Label htmlFor="why">{t('Reason')}</Label><Textarea id="why" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onClose(false)}>{t('Back')}</Button><Button variant="destructive" disabled={!reason.trim()} loading={end.isPending} onClick={() => end.mutate()}>{c.status === 'draft' ? t('Cancel the draft') : t('End')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RenewDialog({ c, onClose }: { c: Contract; onClose: (ok: boolean) => void }) {
  const [pct, setPct] = React.useState('0')
  const renew = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('platform_contract_renew', { p_id: c.id, p_price_pct: Number(pct.replace(',', '.')) || 0 })),
    onSuccess: () => { toast.success(t('Renewed')); onClose(true) },
    onError: (e) => toast.error(describeError(e)),
  })
  const p = Number(pct.replace(',', '.')) || 0
  return (
    <Dialog open onOpenChange={(o) => !o && onClose(false)}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{t('Renew the contract')}</DialogTitle>
          <DialogDescription>{t('One more term of {n} months: the invoices go on and the licence is extended.', { n: c.term_months })}</DialogDescription></DialogHeader>
        <div className="grid gap-1.5"><Label htmlFor="pct">{t('Price change, %')}</Label><Input id="pct" inputMode="decimal" className="w-28" value={pct} onChange={(e) => setPct(e.target.value)} />
          <span className="text-[12.5px] text-muted-foreground">{t('A month: {from} → {to}', { from: formatMoney(c.month_value, c.currency), to: formatMoney(c.month_value * (1 + p / 100), c.currency) })}</span></div>
        <DialogFooter><Button variant="outline" onClick={() => onClose(false)}>{t('Back')}</Button><Button loading={renew.isPending} onClick={() => renew.mutate()}><CalendarClock /> {t('Renew')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ on the client's page */
export function ClientContracts({ companyId }: { companyId: string }) {
  const q = useContracts(companyId)
  const navigate = useNavigate()
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-muted-foreground">{t('What the client pays and until when. The licence follows the active contract.')}</p>
        <Button size="sm" onClick={() => navigate(`/platform/contracts/new?client=${companyId}`)}><Plus /> {t('New contract')}</Button>
      </div>
      {q.isLoading ? <Skeleton className="h-24" /> : q.data?.contracts.length ? <ContractsTable rows={q.data.contracts} /> : <EmptyState compact icon={FileSignature} title={t('No contract yet')} />}
    </div>
  )
}

/* ------------------------------------------------------------------ the contract on paper */
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!))
function printContract(c: Contract) {
  const cur = c.currency
  const rows = c.lines.map((l, i) => `<tr><td class="n">${i + 1}</td><td>${esc(l.description)}</td><td class="r">${esc(num(l.quantity))}</td>
    <td class="r">${esc(formatMoney(l.unit_price, cur))}${l.once ? '' : ` / ${esc(t('month'))}`}</td><td class="r">${esc(formatMoney(num(l.quantity) * num(l.unit_price), cur))}</td></tr>`).join('')
  const body = `
    <h1>${esc(t('Service contract'))} ${esc(c.number)}</h1>
    <p class="muted">${esc(t('Signed on {date}', { date: formatDate(c.signed_on) }))}</p>
    <table class="info"><tbody>
      <tr><th>${esc(t('Client'))}</th><td>${esc(c.client)}${c.client_nui ? ` · ${esc(t('NUI {n}', { n: c.client_nui }))}` : ''}</td></tr>
      <tr><th>${esc(t('Period'))}</th><td>${esc(formatDate(c.start_date))} – ${esc(formatDate(c.end_date))}${c.auto_renew ? ` · ${esc(t('renews by itself for one more term'))}` : ''}</td></tr>
      <tr><th>${esc(t('Invoiced'))}</th><td>${esc(everyText(c.every_months))} · ${esc(t('on day {d} of the month', { d: c.invoice_day }))} · ${esc(t('paid within {n} days', { n: c.payment_days }))}</td></tr>
      ${num(c.discount_pct) ? `<tr><th>${esc(t('Discount'))}</th><td>${esc(num(c.discount_pct))}%</td></tr>` : ''}
    </tbody></table>
    <table class="lines"><thead><tr><th class="n">#</th><th>${esc(t('Description'))}</th><th class="r">${esc(t('Quantity'))}</th><th class="r">${esc(t('Price'))}</th><th class="r">${esc(t('Amount'))}</th></tr></thead>
      <tbody>${rows}</tbody></table>
    <p class="tot">${esc(t('A month')) }: <b>${esc(formatMoney(c.month_value, cur))}</b> · ${esc(t('a year'))}: <b>${esc(formatMoney(c.year_value, cur))}</b> (${esc(t('without VAT'))})${c.once_value > 0 ? ` · ${esc(t('Once'))}: <b>${esc(formatMoney(c.once_value, cur))}</b>` : ''}</p>
    <p class="muted">${esc(t('Prices are without VAT; VAT is added on each invoice.'))}</p>
    ${c.notes ? `<p class="pre">${esc(c.notes)}</p>` : ''}
    <div class="sign"><div>${esc(t('For DrisPRO'))}</div><div>${esc(t('For the client'))}</div></div>`
  const css = `@page { size: A4; margin: 16mm } body { font: 11px/1.45 system-ui, sans-serif; color: #111 } h1 { font-size: 17px; margin: 0 0 4px } .muted { color: #666 }
    table { width: 100%; border-collapse: collapse; font-size: inherit; margin-top: 12px } th { text-align: left; color: #555; font-size: 10px; padding: 4px } td { padding: 4px; vertical-align: top }
    .info th { width: 22%; border-bottom: 1px solid #ddd } .info td { border-bottom: 1px solid #ddd } .lines th { border-bottom: 1.5px solid #222 } .lines td { border-bottom: 1px solid #e3e3e3 }
    .n { width: 20px; color: #888 } .r { text-align: right; white-space: nowrap } .tot { margin-top: 10px; text-align: right } .pre { white-space: pre-wrap }
    .sign { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 50px } .sign div { border-top: 1px solid #222; padding-top: 4px; color: #555 }`
  printHtml(body, css)
}
