import type { ColumnDef } from '@tanstack/react-table'
import { Check, FileSpreadsheet, Plus, Printer, RefreshCw, RotateCcw, Send, X } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Can, useCompany } from '@/app/company-provider'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { ColumnHeader, DataTable, inFilter } from '@/components/data-table/data-table'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { ErrorState } from '@/components/error-state'
import { useRealtimeInvalidate } from '@/hooks/use-realtime'
import { getLocale, t, tServer } from '@/i18n'
import { cn, formatDate, formatMoney, humanize, num } from '@/lib/utils'
import {
  type Declaration, type FormLine, type VatPreview, layoutLabel, monthLabel, useCompanyTaxProfile, useDecideDeclaration, useDeclaration, useDeclarations,
  useRefreshDeclaration, useReopenDeclaration, useSubmitDeclaration, useVatLayout,
} from '../api'
import { NewDeclarationDialog, TieOut } from '../components/tax-ui'

export function DeclarationsPage() {
  const navigate = useNavigate()
  const decl = useDeclarations()
  const { company, companyId } = useCompany()
  useRealtimeInvalidate('vat_declarations', companyId, [['tax', companyId]])
  const [newOpen, setNewOpen] = React.useState(false)
  const cols = React.useMemo<ColumnDef<Declaration>[]>(() => [
    { accessorKey: 'number', enableHiding: false, header: ({ column }) => <ColumnHeader column={column} title={t('Number')} />, meta: { label: t('Number') },
      cell: ({ getValue }) => <span className="font-medium">{getValue() as string}</span> },
    { accessorKey: 'period_start', header: ({ column }) => <ColumnHeader column={column} title={t('Period')} />, meta: { label: t('Period'), exportValue: (d) => monthLabel(d.period_start.slice(0, 7)) },
      cell: ({ row: { original: d } }) => monthLabel(d.period_start.slice(0, 7)) },
    { accessorKey: 'status', filterFn: inFilter, header: t('Status'), meta: { label: t('Status') }, cell: ({ getValue }) => <StatusBadge status={getValue() as string} /> },
    { accessorKey: 'output_vat', header: t('Output VAT'), meta: { label: t('Output VAT'), align: 'right' }, cell: ({ getValue }) => <span className="tabular">{formatMoney(getValue() as number)}</span> },
    { accessorKey: 'input_vat', header: t('Input VAT'), meta: { label: t('Input VAT'), align: 'right' }, cell: ({ getValue }) => <span className="tabular">{formatMoney(getValue() as number)}</span> },
    { accessorKey: 'credit_brought_forward', header: t('Credit from last month'), meta: { label: t('Credit from last month'), align: 'right' },
      cell: ({ getValue }) => <span className="tabular text-muted-foreground">{num(getValue()) ? formatMoney(getValue() as number) : '—'}</span> },
    { accessorKey: 'payable', header: t('To pay'), meta: { label: t('To pay'), align: 'right' }, cell: ({ getValue }) => <span className="tabular font-medium">{formatMoney(getValue() as number)}</span> },
    { accessorKey: 'carry_forward', header: t('Credit carried'), meta: { label: t('Credit carried'), align: 'right' },
      cell: ({ getValue }) => <span className="tabular">{num(getValue()) ? formatMoney(getValue() as number) : '—'}</span> },
    { accessorKey: 'submitted_at', header: t('Submitted'), meta: { label: t('Submitted') }, cell: ({ getValue }) => getValue() ? formatDate(getValue() as string) : '—' },
    { accessorKey: 'submission_reference', header: t('Reference'), meta: { label: t('Reference') }, cell: ({ getValue }) => <span className="text-muted-foreground">{(getValue() as string) ?? '—'}</span> },
  ], [])
  return (
    <>
      <PageHeader title={t('VAT declarations')}
        description={t('Monthly VAT returns to the {authority}, filled from the books. Amounts in {currency}.', { authority: company?.country_code === 'XK' ? 'ATK' : 'DPT', currency: company?.base_currency ?? 'ALL' })}
        actions={<Can perm="tax.write"><Button onClick={() => setNewOpen(true)}><Plus /> {t('New declaration')}</Button></Can>} />
      <DataTable tableKey="tax.declarations" columns={cols} data={decl.data} isLoading={decl.isLoading} error={decl.error} getRowId={(r) => r.id}
        exportName="vat-declarations" searchPlaceholder={t('Number, reference…')} onRowClick={(r) => navigate(`/tax/declarations/${r.id}`)}
        facets={[{ columnId: 'status', title: t('Status'), options: ['draft', 'submitted', 'accepted', 'rejected'].map((s) => ({ value: s, label: humanize(s) })) }]}
        empty={{ title: t('No declarations yet'), description: t('Create the first one from a month of the books.'), action: <Can perm="tax.write"><Button size="sm" onClick={() => setNewOpen(true)}><Plus /> {t('New declaration')}</Button></Can> }} />
      <NewDeclarationDialog open={newOpen} onOpenChange={setNewOpen} />
    </>
  )
}

export function DeclarationPage() {
  const { id } = useParams()
  const d = useDeclaration(id)
  const layout = useVatLayout()
  const profile = useCompanyTaxProfile()
  const { company } = useCompany()
  const refresh = useRefreshDeclaration()
  const submit = useSubmitDeclaration()
  const decide = useDecideDeclaration()
  const reopen = useReopenDeclaration()
  const [refund, setRefund] = React.useState('')
  const [submitOpen, setSubmitOpen] = React.useState(false)
  const [rejectOpen, setRejectOpen] = React.useState(false)
  React.useEffect(() => { if (d.data) setRefund(num(d.data.refund_requested) ? String(d.data.refund_requested) : '') }, [d.data?.refund_requested]) // eslint-disable-line react-hooks/exhaustive-deps

  if (d.isLoading || layout.isLoading) return <div className="grid gap-4"><Skeleton className="h-10 w-72" /><Skeleton className="h-[520px]" /></div>
  if (d.isError) return <ErrorState error={d.error} onRetry={() => void d.refetch()} />
  if (!d.data) return <EmptyState title={t('Declaration not found')} action={<Button variant="outline" asChild><Link to="/tax/declarations">{t('Back to declarations')}</Link></Button>} />
  const decl = d.data
  const det = decl.details as VatPreview
  const boxes = det?.boxes ?? {}
  const xk = decl.country_code === 'XK'
  const period = monthLabel(decl.period_start.slice(0, 7))
  const ym = decl.period_start.slice(0, 7)
  const credit = num(det?.credit)
  const taxLabel = xk ? 'NUI' : 'NIPT'
  const formTitle = getLocale() === 'sq' ? (layout.data?.form_title ?? '') : (xk ? t('VAT return (ATK)') : t('VAT return (DPT)'))

  return (
    <>
      <PageHeader title={`${t('VAT declaration')} · ${period}`} meta={<><StatusBadge status={decl.status} /><span className="text-[13px] text-muted-foreground">{decl.number}</span></>}
        back={{ href: '/tax/declarations', label: t('Declarations') }}
        description={`${formTitle} · ${profile.data?.legal_name ?? profile.data?.name ?? company?.name ?? ''} · ${taxLabel} ${profile.data?.tax_number ?? '—'} · ${formatDate(decl.period_start)} – ${formatDate(decl.period_end)}`}
        actions={<>
          <Button variant="outline" asChild><Link to={`/tax/books?month=${ym}`}><FileSpreadsheet /> {t('Books')}</Link></Button>
          <Button variant="outline" onClick={() => window.print()}><Printer /> {t('Print')}</Button>
          <Can perm="tax.write">
            {decl.status === 'draft' && <>
              <Button variant="outline" loading={refresh.isPending} onClick={() => refresh.mutate({ id: decl.id })}><RefreshCw /> {t('Recalculate')}</Button>
              <Button onClick={() => setSubmitOpen(true)}><Send /> {t('Submit declaration')}</Button>
            </>}
            {decl.status === 'submitted' && <>
              <Button variant="outline" onClick={() => setRejectOpen(true)}><X /> {t('Mark rejected')}</Button>
              <ConfirmDialog trigger={<Button><Check /> {t('Mark accepted')}</Button>} title={t('Mark as accepted?')}
                description={t('Record that the {authority} accepted the return for {period}. The figures stay as submitted.', { authority: xk ? 'ATK' : 'DPT', period })} confirmLabel={t('Mark accepted')}
                onConfirm={() => decide.mutateAsync({ id: decl.id, accepted: true })} />
            </>}
            {decl.status === 'rejected' && <Button loading={reopen.isPending} onClick={() => reopen.mutate(decl.id)}><RotateCcw /> {t('Reopen as draft')}</Button>}
          </Can>
        </>} />

      {decl.status === 'draft' && (
        <div className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[13px] print:hidden">
          {t('Draft: the figures are taken again from the books when you press Recalculate or submit. Submitting books the declaration and closes {period} for VAT, so no invoice can be added to it afterwards.', { period })}
        </div>
      )}

      <div className="grid gap-4 grid-cols-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="overflow-hidden">
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[620px] border-separate border-spacing-0 text-[13px]">
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th className="w-20 border-b px-3 py-2 text-left font-medium">{xk ? t('Field') : t('Row')}</th>
                  <th className="border-b px-3 py-2 text-left font-medium">{t('Description')}</th>
                  <th className="w-36 border-b px-3 py-2 text-right font-medium">{t('Taxable value')}</th>
                  <th className="w-36 border-b px-3 py-2 text-right font-medium">{t('VAT')}</th>
                </tr>
              </thead>
              <tbody>
                {(layout.data?.form ?? []).map((l, i) => l.section
                  ? <tr key={i}><td colSpan={4} className="border-b bg-muted/50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {layoutLabel({ label: l.section, sq: l.sq })}</td></tr>
                  : <FormRow key={i} line={l} boxes={boxes} />)}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <div className="grid content-start gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle>{t('Result')}</CardTitle><CardDescription>{credit > 0 ? t('Purchase VAT is more than sales VAT this month.') : t('What is owed for the month.')}</CardDescription></CardHeader>
            <CardContent className="grid gap-1.5 text-[13px]">
              <Line label={t('Output VAT')} value={decl.output_vat} />
              <Line label={t('Input VAT')} value={num(decl.input_vat) ? -num(decl.input_vat) : 0} />
              <Line label={t('Credit from last month')} value={num(decl.credit_brought_forward) ? -num(decl.credit_brought_forward) : 0} hint={det?.previous && num(decl.credit_brought_forward) ? t('from {number}', { number: det.previous.number }) : undefined} />
              <div className="my-1 border-t" />
              <Line label={t('VAT to pay')} value={decl.payable} strong />
              {credit > 0 && <Line label={t('Credit')} value={credit} />}
              {num(decl.refund_requested) > 0 && <Line label={t('Refund requested')} value={decl.refund_requested} />}
              <Line label={t('Credit carried to next month')} value={decl.carry_forward} />
              {decl.status === 'draft' && credit > 0 && (
                <Can perm="tax.write">
                  <div className="mt-2 grid gap-1.5 rounded-md border p-2.5 print:hidden">
                    <Label htmlFor="refund">{t('Refund to request')}</Label>
                    <div className="flex gap-2">
                      <Input id="refund" inputMode="decimal" value={refund} placeholder="0.00" onChange={(e) => setRefund(e.target.value)} className="h-8" />
                      <Button size="sm" variant="outline" loading={refresh.isPending} onClick={() => refresh.mutate({ id: decl.id, refund: num(refund) })}>{t('Apply')}</Button>
                    </div>
                    <p className="text-xs text-muted-foreground">{t('Up to {amount}. The rest is carried to next month.', { amount: formatMoney(credit) })}</p>
                  </div>
                </Can>
              )}
            </CardContent>
          </Card>

          {det?.ledger && (
            <Card>
              <CardHeader className="pb-2"><CardTitle>{t('Accounting check')}</CardTitle><CardDescription>{t('VAT in the books compared with the VAT booked in accounting for the period.')}</CardDescription></CardHeader>
              <CardContent className="grid gap-3">
                <TieOut label={t('Output VAT')} book={num(det.output_vat) - num(det.ledger.credit_notes_moved) - num(det.ledger.open_pos_vat)} ledger={num(det.ledger.output_vat)}
                  diff={num(det.ledger.output_difference)}
                  note={num(det.ledger.open_pos_vat) ? t('{amount} of till VAT is in open shifts; it is booked with the Z-report.', { amount: formatMoney(det.ledger.open_pos_vat) }) : undefined} />
                <TieOut label={t('Input VAT')} book={num(det.input_vat) - num(det.ledger.credit_notes_moved)} ledger={num(det.ledger.input_vat)} diff={num(det.ledger.input_difference)} />
                {num(det.ledger.credit_notes_moved) > 0 && (
                  <p className="text-xs text-muted-foreground">{t('{amount} of credit-note VAT sits on the other side of the form ([16]–[19], [53]–[56]); accounting keeps it on its own side, so it is left out of the comparison.', { amount: formatMoney(det.ledger.credit_notes_moved) })}</p>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2"><CardTitle>{t('Filing')}</CardTitle></CardHeader>
            <CardContent className="grid gap-1.5 text-[13px]">
              <Meta label={t('Status')}><StatusBadge status={decl.status} /></Meta>
              <Meta label={t('Submitted')}>{decl.submitted_at ? formatDate(decl.submitted_at, true) : '—'}</Meta>
              <Meta label={t('Reference')}>{decl.submission_reference ?? '—'}</Meta>
              {decl.decided_at && <Meta label={t('Decided|date')}>{formatDate(decl.decided_at, true)}</Meta>}
              {decl.decision_note && <Meta label={t('Note')}>{tServer(decl.decision_note)}</Meta>}
              <Meta label={t('Accounting entry')}>{decl.journal_entry_id ? <Link to={`/finance/journal/${decl.journal_entry_id}`} className="text-primary hover:underline">{t('Open accounting entry')}</Link> : '—'}</Meta>
              <p className="mt-1 text-xs text-muted-foreground">{t('Submitting moves the month\'s sales and purchase VAT to account 4455; the balance is what is paid or carried.')}</p>
            </CardContent>
          </Card>
        </div>
      </div>

      <SubmitDialog open={submitOpen} onOpenChange={setSubmitOpen} period={period} payable={num(decl.payable)} carry={num(decl.carry_forward)} authority={xk ? 'ATK' : 'DPT'}
        busy={submit.isPending} onSubmit={(ref) => submit.mutate({ id: decl.id, reference: ref }, { onSuccess: () => setSubmitOpen(false) })} />
      <RejectDialog open={rejectOpen} onOpenChange={setRejectOpen} busy={decide.isPending}
        onReject={(note) => decide.mutate({ id: decl.id, accepted: false, note }, { onSuccess: () => setRejectOpen(false) })} />
    </>
  )
}

function FormRow({ line, boxes }: { line: FormLine; boxes: Record<string, number> }) {
  const base = line.base ? boxes[line.base] : undefined
  const vat = line.vat ? boxes[line.vat] : undefined
  const cell = (v: number | undefined, has: boolean) => !has ? '' : num(v) === 0 ? <span className="text-muted-foreground/50">—</span> : formatMoney(v)
  return (
    <tr className={cn(line.total && 'bg-muted/30 font-semibold')}>
      <td className="border-b px-3 py-1.5 align-top font-mono text-xs text-muted-foreground">{line.code}</td>
      <td className="border-b px-3 py-1.5">
        <div className="leading-snug">{layoutLabel(line)}</div>
      </td>
      <td className="border-b px-3 py-1.5 text-right align-top tabular">{cell(base, !!line.base)}</td>
      <td className="border-b px-3 py-1.5 text-right align-top tabular">{cell(vat, !!line.vat)}</td>
    </tr>
  )
}

function Line({ label, value, strong, hint }: { label: string; value: number | string | null; strong?: boolean; hint?: string }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-2', strong && 'text-base font-semibold')}>
      <span className={cn(!strong && 'text-muted-foreground')}>{label}{hint && <span className="ml-1 text-xs">({hint})</span>}</span>
      <span className="tabular">{formatMoney(value)}</span>
    </div>
  )
}
function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-baseline justify-between gap-3"><span className="text-muted-foreground">{label}</span><span className="text-right">{children}</span></div>
}

function SubmitDialog({ open, onOpenChange, period, payable, carry, authority, busy, onSubmit }: {
  open: boolean; onOpenChange: (o: boolean) => void; period: string; payable: number; carry: number; authority: string; busy: boolean; onSubmit: (ref: string) => void
}) {
  const [ref, setRef] = React.useState('')
  React.useEffect(() => { if (open) setRef('') }, [open])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Submit the declaration for {period}?', { period })}</DialogTitle>
          <DialogDescription>
            {payable > 0 ? t('{amount} is to be paid to the {authority}.', { amount: formatMoney(payable), authority }) : t('No VAT to pay; {amount} is carried to next month.', { amount: formatMoney(carry) })} {t('The declaration is booked and {period} is closed for VAT.', { period })}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="ref">{t('Filing reference')}</Label>
          <Input id="ref" value={ref} onChange={(e) => setRef(e.target.value)} placeholder={t('e.g. the {authority} e-filing receipt number', { authority })} />
          <p className="text-xs text-muted-foreground">{t('Optional. You can file first and enter it now, or leave it empty.')}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('Cancel')}</Button>
          <Button loading={busy} onClick={() => onSubmit(ref.trim())}><Send /> {t('Submit declaration')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RejectDialog({ open, onOpenChange, busy, onReject }: { open: boolean; onOpenChange: (o: boolean) => void; busy: boolean; onReject: (note: string) => void }) {
  const [note, setNote] = React.useState('')
  React.useEffect(() => { if (open) setNote('') }, [open])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Mark as rejected?')}</DialogTitle>
          <DialogDescription>{t('The booking is reversed and the month opens again for VAT. Reopen the declaration as a draft to correct and submit it again.')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="note">{t('Why it was rejected')}</Label>
          <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('Cancel')}</Button>
          <Button variant="destructive" loading={busy} onClick={() => onReject(note.trim())}>{t('Mark rejected')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
