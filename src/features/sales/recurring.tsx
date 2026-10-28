import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { Pause, Play, Repeat, Trash2 } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { DataTable } from '@/components/data-table/data-table'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { formatDate, formatMoney, todayISO } from '@/lib/utils'
import { t, tn, tServer } from '@/i18n'

export type RecurringPlan = {
  id: string; name: string; partner_id: string; partner_name: string; every_months: number; day_of_month: number; next_date: string
  end_date: string | null; post: boolean; is_active: boolean; currency_code: string; total: number; made_count: number
  last_invoice_id: string | null; last_invoice_number: string | null; last_run_at: string | null; last_error: string | null; source_invoice_id: string | null
}
const EVERY = [1, 2, 3, 6, 12] as const
const everyLabel = (n: number) => (n === 1 ? t('Every month') : n === 12 ? t('Every year') : t('Every {n} months', { n }))

function useRecurring() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: ['recurring', companyId],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('recurring_list', { p_company: companyId! })) as unknown as RecurringPlan[],
  })
}
function useRecurringChange() {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { id: string; patch: Record<string, unknown> }) => unwrap(await supabase.rpc('recurring_update', { p_id: v.id, p_patch: v.patch as never })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['recurring', companyId] }),
    onError: (e) => toast.error(describeError(e)),
  })
}

/* ------------------------------------------------------------------ from an invoice */
export function RepeatInvoiceDialog({ invoice, onClose }: { invoice: { id: string; number: string; date: string }; onClose: () => void }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { companyId } = useCompany()
  const day0 = Math.min(28, new Date(invoice.date || todayISO()).getDate())
  const [name, setName] = React.useState('')
  const [every, setEvery] = React.useState('1')
  const [day, setDay] = React.useState(String(day0))
  const [start, setStart] = React.useState(todayISO())
  const [end, setEnd] = React.useState('')
  const [post, setPost] = React.useState(false)
  const make = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('recurring_from_invoice', {
      p_invoice: invoice.id, p_name: name, p_every: Number(every), p_day: Number(day), p_start: start, p_end: end || undefined, p_post: post })),
    onSuccess: () => {
      toast.success(t('The invoice will repeat'))
      void qc.invalidateQueries({ queryKey: ['recurring', companyId] })
      onClose(); navigate('/sales/recurring')
    },
    onError: (e) => toast.error(describeError(e)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{t('Repeat this invoice')}</DialogTitle>
          <DialogDescription>{t('The same customer, lines and payment terms, made again on the chosen day. Write {period} in a line text to get the month, e.g. "Rent {period}".')}</DialogDescription></DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); make.mutate() }}>
          <div className="grid gap-1.5"><Label htmlFor="rn">{t('Name')}</Label>
            <Input id="rn" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('e.g. Shop rent')} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label>{t('How often')}</Label>
              <Select value={every} onValueChange={setEvery}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{EVERY.map((n) => <SelectItem key={n} value={String(n)}>{everyLabel(n)}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-1.5"><Label htmlFor="rd">{t('On day')}</Label>
              <Input id="rd" type="number" min={1} max={28} value={day} onChange={(e) => setDay(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label htmlFor="rs">{t('From')}</Label>
              <Input id="rs" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label htmlFor="re">{t('Until (optional)')}</Label>
              <Input id="re" type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
          </div>
          <label className="flex items-start justify-between gap-3 rounded-md border p-3 text-sm">
            <span><span className="block font-medium">{t('Post them straight away')}</span>
              <span className="text-xs text-muted-foreground">{t('Off: each one waits as a draft to check. On: posted (and fiscalised) by itself.')}</span></span>
            <Switch checked={post} onCheckedChange={setPost} />
          </label>
          <DialogFooter><Button type="button" variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
            <Button type="submit" loading={make.isPending} disabled={!(Number(day) >= 1 && Number(day) <= 28) || !start}><Repeat /> {t('Repeat')}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ the plans */
export function RecurringPage() {
  const navigate = useNavigate()
  const { can } = useCompany()
  const list = useRecurring()
  const change = useRecurringChange()
  const [edit, setEdit] = React.useState<RecurringPlan | null>(null)
  const writer = can('invoicing.write')

  const columns = React.useMemo<ColumnDef<RecurringPlan>[]>(() => [
    {
      accessorKey: 'name', enableHiding: false, header: t('Name'), meta: { label: t('Name') },
      cell: ({ row: { original: r } }) => <div><div className="font-medium">{r.name}</div><div className="text-xs text-muted-foreground">{r.partner_name}</div></div>,
    },
    { id: 'every', accessorFn: (r) => r.every_months, header: t('How often'), meta: { label: t('How often') }, cell: ({ row: { original: r } }) => <>{everyLabel(r.every_months)} · {t('day {n}', { n: r.day_of_month })}</> },
    {
      id: 'next', accessorFn: (r) => r.next_date, header: t('Next|recurring'), meta: { label: t('Next|recurring') },
      cell: ({ row: { original: r } }) => r.is_active
        ? <div><div>{formatDate(r.next_date)}</div>{r.last_error && <div className="max-w-[260px] text-xs text-destructive">{tServer(r.last_error)}</div>}</div>
        : <span className="text-muted-foreground">{t('Paused|recurring')}</span>,
    },
    { id: 'post', accessorFn: (r) => r.post, header: t('Made as'), meta: { label: t('Made as') }, cell: ({ row: { original: r } }) => (r.post ? t('Posted') : t('Draft')) },
    {
      id: 'last', accessorFn: (r) => r.last_invoice_number ?? '', header: t('Last one'), meta: { label: t('Last one') },
      cell: ({ row: { original: r } }) => r.last_invoice_id
        ? <Link to={`/sales/invoices/${r.last_invoice_id}`} className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{r.last_invoice_number}</Link>
        : <span className="text-muted-foreground">—</span>,
    },
    { accessorKey: 'made_count', header: t('Made|recurring'), meta: { label: t('Made|recurring'), align: 'right' } },
    { accessorKey: 'total', header: t('Each (with VAT)'), meta: { label: t('Each (with VAT)'), align: 'right' }, cell: ({ row: { original: r } }) => <span className="tabular">{formatMoney(r.total)} {r.currency_code}</span> },
    ...(writer ? [{
      id: 'actions', enableHiding: false, meta: { noExport: true },
      cell: ({ row: { original: r } }: { row: { original: RecurringPlan } }) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button size="xs" variant="outline" onClick={() => setEdit(r)}>{t('Edit')}</Button>
          <Button size="xs" variant="ghost" aria-label={r.is_active ? t('Pause') : t('Resume')} onClick={() => change.mutate({ id: r.id, patch: { is_active: !r.is_active } })}>
            {r.is_active ? <Pause /> : <Play />}</Button>
        </div>
      ),
    } as ColumnDef<RecurringPlan>] : []),
  ], [writer, change])

  return (
    <>
      <PageHeader title={t('Recurring invoices')}
        description={t('Rent, subscriptions and maintenance: made by themselves every morning on their day. To start one, open an invoice and choose "Repeat".')} />
      <DataTable tableKey="sales.recurring" columns={columns} data={list.data} isLoading={list.isLoading} error={list.error} getRowId={(r) => r.id}
        searchPlaceholder={t('Name or customer')} exportName="recurring-invoices"
        onRowClick={(r) => r.source_invoice_id && navigate(`/sales/invoices/${r.source_invoice_id}`)}
        empty={{ title: t('No recurring invoices yet'), description: t('Open an invoice that comes back every month and choose "Repeat".'),
                 action: <Button variant="outline" size="sm" asChild><Link to="/sales/invoices">{t('Invoices')}</Link></Button> }} />
      {edit && <EditPlan plan={edit} onClose={() => setEdit(null)} />}
    </>
  )
}

function EditPlan({ plan, onClose }: { plan: RecurringPlan; onClose: () => void }) {
  const change = useRecurringChange()
  const [name, setName] = React.useState(plan.name)
  const [every, setEvery] = React.useState(String(plan.every_months))
  const [day, setDay] = React.useState(String(plan.day_of_month))
  const [next, setNext] = React.useState(plan.next_date)
  const [end, setEnd] = React.useState(plan.end_date ?? '')
  const [post, setPost] = React.useState(plan.post)
  const [confirmDel, setConfirmDel] = React.useState(false)
  const save = () => change.mutate({ id: plan.id, patch: { name, every_months: Number(every), day_of_month: Number(day), next_date: next, end_date: end, post } },
    { onSuccess: () => { toast.success(t('Saved')); onClose() } })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{plan.name}</DialogTitle><DialogDescription>{plan.partner_name} · {tn(plan.made_count, '{n} invoice made', '{n} invoices made')}</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label htmlFor="en">{t('Name')}</Label><Input id="en" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label>{t('How often')}</Label>
              <Select value={every} onValueChange={setEvery}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{EVERY.map((n) => <SelectItem key={n} value={String(n)}>{everyLabel(n)}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-1.5"><Label htmlFor="ed">{t('On day')}</Label><Input id="ed" type="number" min={1} max={28} value={day} onChange={(e) => setDay(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label htmlFor="ex">{t('Next one on')}</Label><Input id="ex" type="date" value={next} onChange={(e) => setNext(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label htmlFor="ee">{t('Until (optional)')}</Label><Input id="ee" type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
          </div>
          <label className="flex items-center justify-between gap-3 text-sm"><span>{t('Post them straight away')}</span><Switch checked={post} onCheckedChange={setPost} /></label>
          <p className="text-xs text-muted-foreground">{t('The lines come from the invoice it started from. To change them, make a new invoice and repeat it, then remove this one.')}</p>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {confirmDel
            ? <Button variant="destructive" loading={change.isPending} onClick={() => change.mutate({ id: plan.id, patch: { delete: true } }, { onSuccess: () => { toast.success(t('Removed')); onClose() } })}>{t('Remove it; the invoices stay')}</Button>
            : <Button variant="ghost" className="text-destructive" onClick={() => setConfirmDel(true)}><Trash2 /> {t('Remove')}</Button>}
          <div className="flex gap-2"><Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button><Button loading={change.isPending} onClick={save}>{t('Save')}</Button></div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
