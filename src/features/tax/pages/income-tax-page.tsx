import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookCheck, ListChecks, Plus, Save, Trash2 } from 'lucide-react'
import * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { StatementActions } from '@/components/statement-actions'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { t, td } from '@/i18n'
import type { PrintDoc } from '@/lib/documents/model'
import { nf } from '@/lib/documents/render-statement'
import type { Statement } from '@/lib/documents/render-statement'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn, formatDate, formatMoney, num } from '@/lib/utils'
import { useAccounts } from '@/features/finance/api'

type Adj = { label: string; amount: number }
type Sheet = {
  year: number; from: string; to: string; currency: string; country: string; year_status: string | null
  revenue: number; expenses: number; profit: number; booked_tax: number
  nondeductible: { code: string; name: string; amount: number }[]; nondeductible_total: number
  adjustments: Adj[]; adjustments_total: number; losses: number; taxable: number
  suggested_rate: number; rate_note: string; rate: number; rate_set: boolean; tax: number
  advances: number; advances_books: number; advances_set: boolean; payable: number; notes: string | null
  journal_entry_id: string | null; booked_at: string | null; booked_amount: number | null
  company: PrintDoc['company']; printed_by: string | null; printed_at: string
}

/** Tax › Corporate income tax: the yearly worksheet from the books to the tax, and its entry. */
export function IncomeTaxPage() {
  const [params, setParams] = useSearchParams()
  const year = Number(params.get('year')) || new Date().getFullYear() - (new Date().getMonth() < 9 ? 1 : 0)
  return (
    <>
      <PageHeader title={t('Corporate income tax')} description={t('From the profit in the books to the tax of the year: expenses the tax office does not accept are added back, other differences and losses of earlier years are taken into account.')} />
      <div className="mb-4 flex items-end gap-2">
        <div className="grid gap-1.5"><Label htmlFor="cit-year">{t('Year')}</Label>
          <Input id="cit-year" type="number" min="2000" max="2100" className="w-28" value={year} onChange={(e) => { const n = new URLSearchParams(params); n.set('year', e.target.value); setParams(n, { replace: true }) }} /></div>
      </div>
      {year >= 2000 && year <= 2100 && <Worksheet key={year} year={year} />}
    </>
  )
}

function Worksheet({ year }: { year: number }) {
  const { companyId, can } = useCompany()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['cit', companyId, year], enabled: !!companyId, staleTime: 0,
    queryFn: async () => unwrap(await supabase.rpc('cit_worksheet', { p_company: companyId!, p_year: year })) as unknown as Sheet })
  const w = q.data
  const [form, setForm] = React.useState<{ rate: string; adjustments: { label: string; amount: string }[]; losses: string; advances: string; notes: string } | null>(null)
  const [accounts, setAccounts] = React.useState(false)
  React.useEffect(() => {
    if (w && !form) setForm({ rate: w.rate_set ? String(w.rate) : '', adjustments: w.adjustments.map((a) => ({ label: a.label, amount: String(a.amount) })),
      losses: w.losses ? String(w.losses) : '', advances: w.advances_set ? String(w.advances) : '', notes: w.notes ?? '' })
  }, [w, form])
  const payload = () => ({ rate: form?.rate === '' ? null : num(form?.rate), losses: num(form?.losses), advances: form?.advances === '' ? null : num(form?.advances), notes: form?.notes ?? '',
    adjustments: (form?.adjustments ?? []).filter((a) => a.label.trim() && num(a.amount) !== 0).map((a) => ({ label: a.label.trim(), amount: num(a.amount) })) })
  const save = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('cit_save', { p_company: companyId!, p_year: year, p: payload() })) as unknown as Sheet,
    onSuccess: (d) => { qc.setQueryData(['cit', companyId, year], d); toast.success(t('Saved')) },
    onError: (e) => toast.error(describeError(e)),
  })
  const book = useMutation({
    mutationFn: async () => {
      await supabase.rpc('cit_save', { p_company: companyId!, p_year: year, p: payload() })
      return unwrap(await supabase.rpc('cit_book', { p_company: companyId!, p_year: year })) as unknown as Sheet
    },
    onSuccess: (d) => { qc.setQueryData(['cit', companyId, year], d); void qc.invalidateQueries({ queryKey: ['year-end'] }); toast.success(t('The tax of {year} is in the books: {amount}', { year, amount: formatMoney(d.tax, d.currency) })) },
    onError: (e) => toast.error(describeError(e)),
  })
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  if (!w || !form) return <Skeleton className="h-96" />
  const editable = can('tax.write') && w.year_status !== 'closed'

  // the figures as they will be after saving what is typed
  const adjTotal = form.adjustments.reduce((s, a) => s + num(a.amount), 0)
  const taxable = Math.max(0, w.profit + w.nondeductible_total + adjTotal - num(form.losses))
  const rate = form.rate === '' ? w.suggested_rate : num(form.rate)
  const tax = Math.round(taxable * rate) / 100
  const adv = form.advances === '' ? w.advances_books : num(form.advances)
  const changed = w.booked_amount != null && Math.abs(num(w.booked_amount) - tax) > 0.005
  const set = (p: Partial<typeof form>) => setForm({ ...form, ...p })
  const cur = w.currency

  const line = (label: React.ReactNode, value: number, opts: { strong?: boolean; sign?: string; hint?: React.ReactNode } = {}) => (
    <div className={cn('flex items-baseline justify-between gap-4 py-1.5', opts.strong && 'border-t pt-2.5 font-semibold')}>
      <span>{label}{opts.hint && <span className="block text-xs font-normal text-muted-foreground">{opts.hint}</span>}</span>
      <span className="shrink-0 tabular-nums">{opts.sign ?? ''}{formatMoney(value)}</span>
    </div>
  )

  const statement = async (): Promise<Statement> => {
    const rows = [
      [t('Revenue'), nf(w.revenue)], [t('Expenses'), nf(-w.expenses)], [t('Profit in the books'), nf(w.profit)],
      ...w.nondeductible.map((n) => [`+ ${n.code} ${td(n.name)}`, nf(n.amount)]),
      ...payload().adjustments.map((a) => [`${a.amount >= 0 ? '+' : '−'} ${a.label}`, nf(a.amount)]),
      [t('− Losses of earlier years used'), nf(-num(form.losses))], [t('Taxable profit'), nf(taxable)],
      [t('Rate %'), `${rate} %`], [t('Tax of the year'), nf(tax)], [t('− Advances paid during the year'), nf(-adv)],
    ]
    const strong = [t('Profit in the books'), t('Taxable profit'), t('Tax of the year')].map((l) => rows.findIndex((r) => r[0] === l))
    // the PDF font has no minus sign; and no "−0,00"
    for (const r of rows) { r[0] = r[0].replace(/\u2212/g, '-'); r[1] = r[1].replace(/^-0,00$/, '0,00') }
    return {
    title: t('Corporate income tax'), subtitle: String(year), company: w.company, partner: null,
    info: [[t('Year'), String(year)], [t('Period'), `${formatDate(w.from)} – ${formatDate(w.to)}`], [t('Currency'), cur]],
    tables: [{ columns: [{ label: t('Description') }, { label: t('Amount'), align: 'right' }], strong, rows }],
    summary: [[tax - adv >= 0 ? t('To pay') : t('Paid too much'), `${nf(Math.abs(tax - adv))} ${cur}`, true]],
    texts: [form.notes], signatures: [t('Prepared by'), t('Approved by')], printed_by: w.printed_by, printed_at: w.printed_at,
    }
  }

  return (
    <div className="grid gap-4 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="rounded-lg border bg-card p-4 text-sm">
        {line(t('Revenue'), w.revenue)}
        {line(t('Expenses'), w.expenses, { sign: '−', hint: t('without the income tax itself') })}
        {line(t('Profit in the books'), w.profit, { strong: true })}

        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="font-medium">{t('+ Expenses that are not deductible')}</span>
          {can('tax.write') && <Button variant="ghost" size="sm" onClick={() => setAccounts(true)}><ListChecks /> {t('Choose accounts')}</Button>}
        </div>
        {w.nondeductible.length === 0 && <p className="text-xs text-muted-foreground">{t('Fines, representation above the limit, private expenses… Mark their accounts and their amounts are added here.')}</p>}
        {w.nondeductible.map((n) => line(<span className="text-muted-foreground">{n.code} {td(n.name)}</span>, n.amount, { sign: '+' }))}

        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="font-medium">{t('± Other differences')}</span>
          {editable && <Button variant="ghost" size="sm" onClick={() => set({ adjustments: [...form.adjustments, { label: '', amount: '' }] })}><Plus /> {t('Add')}</Button>}
        </div>
        {form.adjustments.map((a, i) => (
          <div key={i} className="flex items-center gap-2 py-1">
            <Input className="h-8 flex-1" placeholder={t('What it is')} value={a.label} disabled={!editable} aria-label={t('Difference {n}', { n: i + 1 })}
              onChange={(e) => set({ adjustments: form.adjustments.map((x, k) => k === i ? { ...x, label: e.target.value } : x) })} />
            <Input className="h-8 w-32 text-right" type="number" step="any" placeholder="+ / −" value={a.amount} disabled={!editable} aria-label={t('Amount of difference {n}', { n: i + 1 })}
              onChange={(e) => set({ adjustments: form.adjustments.map((x, k) => k === i ? { ...x, amount: e.target.value } : x) })} />
            {editable && <Button variant="ghost" size="icon-sm" aria-label={t('Remove')} onClick={() => set({ adjustments: form.adjustments.filter((_, k) => k !== i) })}><Trash2 /></Button>}
          </div>
        ))}
        <div className="mt-3 flex items-center justify-between gap-4 py-1">
          <Label htmlFor="cit-loss">{t('− Losses of earlier years used')}</Label>
          <Input id="cit-loss" type="number" step="any" min="0" className="h-8 w-36 text-right" value={form.losses} disabled={!editable} onChange={(e) => set({ losses: e.target.value })} />
        </div>
        {line(t('Taxable profit'), taxable, { strong: true })}
        <div className="flex items-center justify-between gap-4 py-1.5">
          <span>{t('Rate %')}<span className="block text-xs text-muted-foreground">{t('Usual: {note}', { note: t(w.rate_note) })}</span></span>
          <Input type="number" step="0.1" min="0" max="100" className="h-8 w-24 text-right" placeholder={String(w.suggested_rate)} value={form.rate} disabled={!editable}
            aria-label={t('Rate %')} onChange={(e) => set({ rate: e.target.value })} />
        </div>
        {line(t('Tax of the year'), tax, { strong: true })}
        <div className="flex items-center justify-between gap-4 py-1.5">
          <span>{t('− Advances paid during the year')}<span className="block text-xs text-muted-foreground">{t('From the books: {amount}', { amount: formatMoney(w.advances_books) })}</span></span>
          <Input type="number" step="any" min="0" className="h-8 w-36 text-right" placeholder={String(w.advances_books)} value={form.advances} disabled={!editable}
            aria-label={t('Advances paid')} onChange={(e) => set({ advances: e.target.value })} />
        </div>
        <div className={cn('mt-2 flex items-baseline justify-between gap-4 border-t-2 pt-3 text-base font-semibold', tax - adv < 0 && 'text-emerald-700 dark:text-emerald-400')}>
          <span>{tax - adv >= 0 ? t('To pay') : t('Paid too much')}</span><span className="tabular-nums">{formatMoney(Math.abs(tax - adv), cur)}</span>
        </div>
        <div className="mt-4 grid gap-1.5"><Label htmlFor="cit-notes">{t('Notes')}</Label>
          <Textarea id="cit-notes" rows={2} value={form.notes} disabled={!editable} onChange={(e) => set({ notes: e.target.value })} /></div>
      </div>

      <div className="grid content-start gap-4">
        <div className="grid gap-2 rounded-lg border bg-card p-4 text-sm">
          {w.booked_at ? (
            <p>{t('In the books since {date}: {amount}.', { date: formatDate(w.booked_at), amount: formatMoney(w.booked_amount, cur) })}
              {changed && <span className="mt-1 block font-medium text-amber-700 dark:text-amber-400">{t('The figures changed since; book it again.')}</span>}</p>
          ) : <p className="text-muted-foreground">{t('Not in the books yet. Booking puts the tax as an expense of {year} and as owed to the tax office.', { year })}</p>}
          {w.year_status === 'closed' && <p className="text-muted-foreground">{t('The year is closed; reopen it to change the tax.')}</p>}
          {editable && <div className="flex flex-wrap gap-2">
            <Button variant="outline" loading={save.isPending} onClick={() => save.mutate()}><Save /> {t('Save')}</Button>
            <ConfirmDialog title={t('Book the tax of {year}?', { year })} description={t('{amount} as the income tax expense of {year}, owed to the tax office. Booking again replaces the earlier entry.', { amount: formatMoney(tax, cur), year })}
              confirmLabel={t('Book it')} onConfirm={() => book.mutateAsync()} trigger={<Button loading={book.isPending}><BookCheck /> {t('Book it')}</Button>} />
          </div>}
          <StatementActions build={statement} />
        </div>
        <p className="text-xs text-muted-foreground">{t('The rate and the rules change with the law. This sheet helps prepare the annual return; check it with your accountant before filing.')}</p>
      </div>

      <NondeductibleDialog open={accounts} onOpenChange={setAccounts} onChanged={() => void q.refetch()} />
    </div>
  )
}

function NondeductibleDialog({ open, onOpenChange, onChanged }: { open: boolean; onOpenChange: (o: boolean) => void; onChanged: () => void }) {
  const accounts = useAccounts()
  const [filter, setFilter] = React.useState('')
  const qc = useQueryClient()
  const set = useMutation({
    mutationFn: async (a: { id: string; on: boolean }) => unwrap(await supabase.rpc('account_set_nondeductible', { p_account: a.id, p_on: a.on })),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['fin'] }); onChanged() }, onError: (e) => toast.error(describeError(e)),
  })
  const list = (accounts.data ?? []).filter((a) => a.account_type === 'expense' && a.is_postable && !a.deleted_at)
    .filter((a) => !filter || `${a.code} ${td(a.name)}`.toLowerCase().includes(filter.toLowerCase()))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{t('Expenses that are not deductible')}</DialogTitle>
          <DialogDescription>{t('Mark the expense accounts the tax office does not accept. Their amounts are added back to the profit.')}</DialogDescription></DialogHeader>
        <Input placeholder={t('Search')} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={t('Search')} />
        <div className="max-h-[50vh] divide-y overflow-y-auto rounded-md border">
          {list.map((a) => (
            <label key={a.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span><span className="tabular-nums text-muted-foreground">{a.code}</span> {td(a.name)}</span>
              <Switch checked={!!a.tax_nondeductible} onCheckedChange={(on) => set.mutate({ id: a.id, on })} aria-label={t('{name} not deductible', { name: td(a.name) })} />
            </label>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
