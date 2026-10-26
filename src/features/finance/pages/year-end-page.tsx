import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarCheck, CircleAlert, CircleCheck, Lock, LockOpen } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { msg, t } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn, formatDate, formatMoney } from '@/lib/utils'
import { useFiscalYears } from '../api'

type Check = { key: string; count: number; block?: boolean; href: string }
type YearCheck = {
  id: string; name: string; start: string; end: string; status: string; closed_at: string | null; closed_by: string | null; result_closed: number | null
  ended: boolean; next_year: string | null; earlier_open: string | null; revenue: number; expenses: number; result: number
  locked_periods: number; later_closed: boolean; checks: Check[]
}

/** what each check means, in words */
const CHECKS: Record<string, { title: string; ok: string; todo: string }> = {
  draft_entries: { title: msg('Journal entries'), ok: msg('No unposted journal entries'), todo: msg('{n} journal entries are not posted; post or delete them') },
  draft_invoices: { title: msg('Sales invoices'), ok: msg('No sales invoice left as a draft'), todo: msg('{n} sales invoices are still drafts') },
  draft_bills: { title: msg('Purchase invoices'), ok: msg('No purchase invoice left as a draft'), todo: msg('{n} purchase invoices are still drafts') },
  open_receipts: { title: msg('Goods receipts'), ok: msg('All goods received are posted'), todo: msg('{n} goods receipts are not finished') },
  open_deliveries: { title: msg('Deliveries'), ok: msg('All deliveries are finished'), todo: msg('{n} deliveries are not finished') },
  open_pos: { title: msg('Till sessions'), ok: msg('All till sessions are closed'), todo: msg('{n} till sessions are still open') },
  depreciation: { title: msg('Depreciation'), ok: msg('Depreciation is booked to the end of the year'), todo: msg('{n} assets have depreciation not yet booked') },
  payroll: { title: msg('Payroll'), ok: msg('Every month has its payroll'), todo: msg('{n} months have no posted payroll') },
  vat: { title: msg('VAT declarations'), ok: msg('Every month has its VAT declaration'), todo: msg('{n} months have no submitted VAT declaration') },
  bank: { title: msg('Bank statements'), ok: msg('All bank lines are matched'), todo: msg('{n} bank lines are not matched yet') },
  cit: { title: msg('Corporate income tax'), ok: msg('The tax on profit is in the books (or there is no profit)'), todo: msg('The tax on profit is not booked yet') },
}

/** Finance › Year-end close: the checklist, the result of the year, closing and reopening. */
export function YearEndPage() {
  const years = useFiscalYears()
  const [sel, setSel] = React.useState<string | null>(null)
  const list = years.data ?? []
  // the first year that has ended and is still open; otherwise the latest
  const today = new Date().toISOString().slice(0, 10)
  const id = sel ?? [...list].reverse().find((y) => y.status !== 'closed' && y.end_date < today)?.id ?? list[0]?.id ?? null
  return (
    <>
      <PageHeader title={t('Year-end close')} description={t('At the end of the year: check that nothing is left open, see the result, and close the year. Revenue and expenses are carried into the result, and the year can no longer be changed.')} />
      {years.isError ? <ErrorState error={years.error} onRetry={() => void years.refetch()} /> : years.isLoading ? <Skeleton className="h-64" /> : list.length === 0
        ? <EmptyState icon={CalendarCheck} title={t('No fiscal years yet')} description={t('Create them under Finance setup.')} />
        : (
          <div className="grid gap-4">
            <div className="flex flex-wrap gap-2" role="tablist" aria-label={t('Fiscal year')}>
              {list.map((y) => (
                <button key={y.id} type="button" role="tab" aria-selected={id === y.id} onClick={() => setSel(y.id)}
                  className={cn('flex items-center gap-2 rounded-lg border px-3 py-2 text-sm', id === y.id ? 'border-primary bg-primary/5 font-medium' : 'hover:bg-muted/50')}>
                  {y.status === 'closed' ? <Lock className="size-3.5 text-muted-foreground" /> : <LockOpen className="size-3.5 text-muted-foreground" />}
                  {y.start_date.slice(0, 4) === y.end_date.slice(0, 4) ? y.start_date.slice(0, 4) : `${y.start_date.slice(0, 4)}/${y.end_date.slice(2, 4)}`}
                </button>
              ))}
            </div>
            {id && <YearView key={id} id={id} />}
          </div>
        )}
    </>
  )
}

function YearView({ id }: { id: string }) {
  const { can, company } = useCompany()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['year-end', id], staleTime: 0, queryFn: async () => unwrap(await supabase.rpc('year_end_check', { p_year: id })) as unknown as YearCheck })
  const [carry, setCarry] = React.useState(true)
  const [reopen, setReopen] = React.useState(false)
  const [reason, setReason] = React.useState('')
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['year-end'] }), qc.invalidateQueries({ queryKey: ['fin'] })])
  const close = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('year_close', { p_year: id, p_carry: carry })) as unknown as { result: number },
    onSuccess: async (r) => { await refresh(); toast.success(t('The year is closed. Result: {amount}', { amount: formatMoney(r.result, cur) })) },
    onError: (e) => toast.error(describeError(e)),
  })
  const open = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('year_reopen', { p_year: id, p_reason: reason })),
    onSuccess: async () => { await refresh(); setReopen(false); setReason(''); toast.success(t('The year is open again')) },
    onError: (e) => toast.error(describeError(e)),
  })
  const y = q.data
  const cur = company?.base_currency
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  if (!y) return <Skeleton className="h-80" />
  const closed = y.status === 'closed'
  const blocking = y.checks.filter((c) => c.block && c.count > 0)
  const warnings = y.checks.filter((c) => !c.block && c.count > 0)
  const mayClose = can('finance.approve') && !closed && y.ended && blocking.length === 0

  return (
    <div className="grid gap-4 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="grid content-start gap-4">
        {closed && (
          <div className="flex items-start gap-3 rounded-lg border border-emerald-600/30 bg-emerald-50 p-4 text-sm dark:bg-emerald-950/30">
            <Lock className="mt-0.5 size-4 text-emerald-700 dark:text-emerald-400" />
            <div>{y.closed_at ? t('{year} was closed on {date} by {name}. Result: {amount}.', { year: y.name, date: formatDate(y.closed_at), name: y.closed_by ?? '—', amount: formatMoney(y.result_closed, cur) })
              : t('{year} is closed.', { year: y.name })}
              <span className="block text-muted-foreground">{t('Nothing dated in this year can be posted any more. To correct something, reopen it.')}</span></div>
          </div>
        )}
        {!y.ended && !closed && (
          <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-4 text-sm"><CalendarCheck className="mt-0.5 size-4" />
            {t('This year ends on {date}. The list shows what to finish before closing it.', { date: formatDate(y.end) })}</div>
        )}
        {y.earlier_open && !closed && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-50 p-4 text-sm dark:bg-amber-950/30"><CircleAlert className="mt-0.5 size-4 text-amber-600" />
            {t('Earlier years are still open: {years}. Close them first, in order.', { years: y.earlier_open })}</div>
        )}
        {!closed && <div className="rounded-lg border bg-card">
          <div className="border-b px-4 py-3"><h2 className="text-sm font-semibold">{t('Before closing')}</h2>
            <p className="text-xs text-muted-foreground">{t('Red stops the closing; yellow is worth checking but does not stop it.')}</p></div>
          <ul className="divide-y">
            {y.checks.map((c) => {
              const d = CHECKS[c.key]
              if (!d) return null
              const bad = c.count > 0
              return (
                <li key={c.key} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                  {bad ? <CircleAlert className={cn('mt-0.5 size-4 shrink-0', c.block ? 'text-destructive' : 'text-amber-600')} /> : <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />}
                  <div className="min-w-0 flex-1"><span className="font-medium">{t(d.title)}</span>
                    <span className="block text-muted-foreground">{bad ? t(d.todo, { n: c.count }) : t(d.ok)}</span></div>
                  {bad && <Button variant="ghost" size="sm" asChild><Link to={c.href}>{t('Open')}</Link></Button>}
                </li>
              )
            })}
          </ul>
        </div>}
      </div>

      <div className="grid content-start gap-4">
        <div className="rounded-lg border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">{t('Result of {year}', { year: y.name })}</h2>
          <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">{t('Revenue')}</dt><dd className="text-right tabular-nums">{formatMoney(y.revenue)}</dd>
            <dt className="text-muted-foreground">{t('Expenses')}</dt><dd className="text-right tabular-nums">−{formatMoney(y.expenses)}</dd>
            <dt className="border-t pt-2 font-semibold">{y.result >= 0 ? t('Profit') : t('Loss')}</dt>
            <dd className={cn('border-t pt-2 text-right text-base font-semibold tabular-nums', y.result < 0 && 'text-destructive')}>{formatMoney(y.result, cur)}</dd>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">{t('Closing moves this result to account 109 on {date}, so the next year starts with revenue and expenses at zero. The reports of {year} keep showing the year as it was.', { date: formatDate(y.end), year: y.name })}</p>
        </div>

        {!closed ? (
          <div className="grid gap-3 rounded-lg border bg-card p-4">
            <label className="flex items-start gap-2 text-sm"><Checkbox className="mt-0.5" checked={carry} onCheckedChange={(v) => setCarry(v === true)} />
              <span>{t('Carry the result to the results of earlier years (account 108) on 1 January')}<span className="block text-xs text-muted-foreground">{t('Leave it off if the owners will first decide what to do with the profit.')}</span></span></label>
            {blocking.length > 0 && <p className="text-xs font-medium text-destructive">{t('Finish what is marked red first.')}</p>}
            {!can('finance.approve') && <p className="text-xs text-muted-foreground">{t('Only someone who can approve in finance can close the year.')}</p>}
            <ConfirmDialog title={t('Close {year}?', { year: y.name })}
              description={<>{t('The result {amount} goes to the books and every month of {year} is closed.', { amount: formatMoney(y.result, cur), year: y.name })}
                {warnings.length > 0 && <span className="mt-2 block text-amber-700 dark:text-amber-400">{t('Still to check: {list}.', { list: warnings.map((w) => t(CHECKS[w.key]?.title ?? w.key)).join(', ') })}</span>}</>}
              confirmLabel={t('Close the year')} onConfirm={() => close.mutateAsync()}
              trigger={<Button disabled={!mayClose} loading={close.isPending}><Lock /> {t('Close the year')}</Button>} />
          </div>
        ) : can('finance.approve') && (
          <div className="rounded-lg border bg-card p-4">
            <Button variant="outline" disabled={y.later_closed || y.locked_periods > 0} onClick={() => setReopen(true)}><LockOpen /> {t('Reopen the year')}</Button>
            {y.later_closed && <p className="mt-2 text-xs text-muted-foreground">{t('Reopen the later years first.')}</p>}
            {y.locked_periods > 0 && <p className="mt-2 text-xs text-muted-foreground">{t('Some months are locked for good and cannot be reopened.')}</p>}
          </div>
        )}
      </div>

      <Dialog open={reopen} onOpenChange={setReopen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t('Reopen {year}?', { year: y.name })}</DialogTitle>
            <DialogDescription>{t('The closing entries are taken back and the months open again. Close the year again when the correction is done.')}</DialogDescription></DialogHeader>
          <div className="grid gap-1.5"><Label htmlFor="ye-reason">{t('Why is it reopened?')}</Label>
            <Textarea id="ye-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          <DialogFooter><Button disabled={!reason.trim()} loading={open.isPending} onClick={() => open.mutate()}>{t('Reopen')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
