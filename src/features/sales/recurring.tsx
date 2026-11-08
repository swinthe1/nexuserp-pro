import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { Mail, Pause, Play, Plus, Repeat, Trash2 } from 'lucide-react'
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useTaxCodes } from '@/features/inventory/api'
import { fetchPrintDoc, fileName, docTitle } from '@/lib/documents/model'
import { pdfBase64 } from '@/lib/documents/render-pdf'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { formatDate, formatMoney, num, todayISO } from '@/lib/utils'
import { t, td, tn, tServer } from '@/i18n'

export type RecurringPlan = {
  id: string; name: string; partner_id: string; partner_name: string; every_months: number; day_of_month: number; next_date: string
  end_date: string | null; post: boolean; is_active: boolean; currency_code: string; total: number; made_count: number
  last_invoice_id: string | null; last_invoice_number: string | null; last_run_at: string | null; last_error: string | null; source_invoice_id: string | null
  email_customer?: boolean; partner_email?: string | null
}
type PlanLine = { variant_id?: string | null; description: string; quantity: number; unit_price: number; discount_pct: number; tax_code_id?: string | null
  account_id?: string | null; cost_center_id?: string | null; uom_id?: string | null }
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

type ToSend = { invoice_id: string; number: string; invoice_date: string; partner_name: string; email: string | null; plan_name: string }
function useToSend() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: ['recurring', companyId, 'to-send'],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('recurring_to_send', { p_company: companyId! })) as unknown as ToSend[],
  })
}

/** the plans' posted invoices waiting to go to the customers: each one as its PDF, from the company mailbox */
function ToSendBar({ rows }: { rows: ToSend[] }) {
  const qc = useQueryClient()
  const { companyId } = useCompany()
  const [busy, setBusy] = React.useState(false)
  const ready = rows.filter((r) => r.email)
  const missing = rows.length - ready.length
  const sendAll = async () => {
    setBusy(true)
    let sent = 0
    try {
      for (const r of ready) {
        const doc = await fetchPrintDoc('sales_invoice', r.invoice_id)
        const title = docTitle(doc)
        const text = t('Hello,\n\nPlease find attached {what} {number} for {amount}.\n\nKind regards,\n{company}', {
          what: title.toLowerCase(), number: doc.number, amount: formatMoney(doc.total, doc.currency), company: doc.company.name })
        unwrap(await supabase.rpc('document_email', { p_kind: 'sales_invoice', p_id: r.invoice_id, p_to: r.email!, p_subject: `${title} ${doc.number} · ${doc.company.name}`,
          p_message: text, p_pdf: await pdfBase64(doc), p_filename: fileName(doc) }))
        sent++
      }
      toast.success(tn(sent, '{n} invoice sent. It goes out within a minute.', '{n} invoices sent. They go out within a minute.'))
    } catch (e) {
      toast.error(tServer(describeError(e)))
    } finally {
      setBusy(false)
      void qc.invalidateQueries({ queryKey: ['recurring', companyId, 'to-send'] })
    }
  }
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
      <Mail className="size-4 text-primary" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{tn(rows.length, '{n} invoice is waiting to go to the customer', '{n} invoices are waiting to go to the customers')}</div>
        <div className="text-xs text-muted-foreground">{rows.slice(0, 4).map((r) => `${r.number} · ${r.partner_name}`).join(', ')}{rows.length > 4 ? ' …' : ''}
          {missing > 0 && <span className="text-warning"> · {tn(missing, '{n} customer has no email on the card', '{n} customers have no email on the card')}</span>}</div>
      </div>
      {ready.length > 0 && <Button size="sm" loading={busy} onClick={() => void sendAll()}><Mail /> {tn(ready.length, 'Send {n}', 'Send {n}')}</Button>}
    </div>
  )
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
  const toSend = useToSend()
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
    { id: 'post', accessorFn: (r) => r.post, header: t('Made as'), meta: { label: t('Made as') },
      cell: ({ row: { original: r } }) => <>{r.post ? t('Posted') : t('Draft')}{r.email_customer && <span className="ml-1.5 inline-flex items-center gap-1 text-xs text-muted-foreground"><Mail className="size-3" /> {t('by email')}</span>}</> },
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
      {writer && (toSend.data?.length ?? 0) > 0 && <ToSendBar rows={toSend.data!} />}
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
  const [email, setEmail] = React.useState(!!plan.email_customer)
  const [confirmDel, setConfirmDel] = React.useState(false)
  const taxes = useTaxCodes()
  const saved = useQuery({ queryKey: ['recurring', plan.id, 'lines'], staleTime: 0,
    queryFn: async () => (unwrap(await supabase.from('recurring_invoices').select('lines').eq('id', plan.id).single()) as { lines: PlanLine[] }).lines })
  const [lines, setLines] = React.useState<PlanLine[] | null>(null)
  React.useEffect(() => { if (saved.data && !lines) setLines(saved.data.map((l) => ({ ...l, quantity: num(l.quantity), unit_price: num(l.unit_price), discount_pct: num(l.discount_pct) }))) }, [saved.data, lines])
  const setLine = (i: number, p: Partial<PlanLine>) => setLines((ls) => ls!.map((l, j) => (j === i ? { ...l, ...p } : l)))
  const rateOf = (id?: string | null) => num(taxes.data?.find((x) => x.id === id)?.rate)
  const total = (lines ?? []).reduce((s, l) => { const sub = Math.round(num(l.quantity) * num(l.unit_price) * (1 - num(l.discount_pct) / 100) * 100) / 100; return s + sub + Math.round(sub * rateOf(l.tax_code_id)) / 100 }, 0)
  const linesOk = !!lines && lines.length > 0 && lines.every((l) => l.description?.trim() && num(l.quantity) > 0 && num(l.unit_price) >= 0 && num(l.discount_pct) >= 0 && num(l.discount_pct) <= 100)
  const save = () => change.mutate({ id: plan.id, patch: { name, every_months: Number(every), day_of_month: Number(day), next_date: next, end_date: end, post, email_customer: email, ...(lines ? { lines } : {}) } },
    { onSuccess: () => { toast.success(t('Saved')); onClose() } })
  const salesTaxes = (taxes.data ?? []).filter((x) => x.scope !== 'purchase' && x.is_active)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
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
          <label className="flex items-start justify-between gap-3 text-sm">
            <span><span className="block">{t('Send them to the customer by email')}</span>
              <span className="text-xs text-muted-foreground">{plan.partner_email
                ? t('Once posted, each one waits here and goes as a PDF to {email} with one click.', { email: plan.partner_email })
                : t('The customer has no email on the card yet: add it there first.')}</span></span>
            <Switch checked={email} onCheckedChange={setEmail} /></label>
          <div className="rounded-md border">
            <div className="flex items-center justify-between px-3 py-2"><span className="text-sm font-medium">{t('Lines')}</span>
              <Button type="button" size="xs" variant="outline" disabled={!lines} onClick={() => setLines((ls) => [...(ls ?? []), { description: '', quantity: 1, unit_price: 0, discount_pct: 0, tax_code_id: salesTaxes.find((x) => num(x.rate) > 0)?.id ?? null }])}><Plus /> {t('Add line')}</Button></div>
            <div className="overflow-x-auto">
              <Table className="min-w-[620px]">
                <TableHeader><TableRow className="hover:bg-transparent">
                  <TableHead>{t('Text on the invoice')}</TableHead><TableHead className="w-20 text-right">{t('Qty')}</TableHead>
                  <TableHead className="w-28 text-right">{t('Unit price (without VAT)')}</TableHead><TableHead className="w-20 text-right">{t('Disc. %')}</TableHead>
                  <TableHead className="w-32">{t('VAT')}</TableHead><TableHead className="w-8" />
                </TableRow></TableHeader>
                <TableBody>
                  {(lines ?? []).map((l, i) => (
                    <TableRow key={i} className="hover:bg-transparent">
                      <TableCell><Input className="h-8 text-[13px]" value={l.description ?? ''} aria-label={t('Description, line {n}', { n: i + 1 })} onChange={(e) => setLine(i, { description: e.target.value })} /></TableCell>
                      <TableCell><Input className="h-8 text-right tabular" inputMode="decimal" value={String(l.quantity)} aria-label={t('Quantity, line {n}', { n: i + 1 })} onChange={(e) => setLine(i, { quantity: e.target.value.replace(',', '.') as unknown as number })} /></TableCell>
                      <TableCell><Input className="h-8 text-right tabular" inputMode="decimal" value={String(l.unit_price)} aria-label={t('Unit price, line {n}', { n: i + 1 })} onChange={(e) => setLine(i, { unit_price: e.target.value.replace(',', '.') as unknown as number })} /></TableCell>
                      <TableCell><Input className="h-8 text-right tabular" inputMode="decimal" value={String(l.discount_pct)} aria-label={t('Discount, line {n}', { n: i + 1 })} onChange={(e) => setLine(i, { discount_pct: e.target.value.replace(',', '.') as unknown as number })} /></TableCell>
                      <TableCell><Select value={l.tax_code_id ?? 'none'} onValueChange={(v) => setLine(i, { tax_code_id: v === 'none' ? null : v })}>
                        <SelectTrigger className="h-8" aria-label={t('VAT, line {n}', { n: i + 1 })}><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="none">{t('No VAT')}</SelectItem>{salesTaxes.map((x) => <SelectItem key={x.id} value={x.id}>{td(x.name)}</SelectItem>)}</SelectContent></Select></TableCell>
                      <TableCell><Button type="button" variant="ghost" size="icon-sm" disabled={(lines ?? []).length < 2} aria-label={t('Remove line {n}', { n: i + 1 })} onClick={() => setLines((ls) => ls!.filter((_, j) => j !== i))}><Trash2 /></Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex justify-between border-t px-3 py-2 text-[13px]"><span className="text-muted-foreground">{t('Write {period} in a text to get the month.')}</span>
              <span>{t('Each (with VAT)')}: <span className="font-semibold tabular">{formatMoney(total)} {plan.currency_code}</span></span></div>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {confirmDel
            ? <Button variant="destructive" loading={change.isPending} onClick={() => change.mutate({ id: plan.id, patch: { delete: true } }, { onSuccess: () => { toast.success(t('Removed')); onClose() } })}>{t('Remove it; the invoices stay')}</Button>
            : <Button variant="ghost" className="text-destructive" onClick={() => setConfirmDel(true)}><Trash2 /> {t('Remove')}</Button>}
          <div className="flex gap-2"><Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button><Button loading={change.isPending} disabled={!linesOk} onClick={save}>{t('Save')}</Button></div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
