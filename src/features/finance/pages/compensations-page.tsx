import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftRight, Ban, Plus, Wand2 } from 'lucide-react'
import * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Can, useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { SearchSelect } from '@/components/search-select'
import { StatementActions } from '@/components/statement-actions'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { t, tServer } from '@/i18n'
import { compensationStatement, fetchCompensation, fetchOpenItems, type OpenRow } from '@/lib/documents/statements'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn, formatDate, formatMoney, num, todayISO } from '@/lib/utils'
import { usePartners } from '@/features/sales/api'
import type { Json } from '@/lib/database.types'

type Row = { id: string; number: string; status: string; comp_date: string; amount: number; currency_code: string; partner: { name: string } | null }

/** Finance › Compensations: a customer's debt set against our debt to the same partner (kompensim). */
export function CompensationsPage() {
  const { companyId } = useCompany()
  const [params, setParams] = useSearchParams()
  // from a partner's reconciliation card: ?new=<partner>
  const [adding, setAdding] = React.useState(() => !!params.get('new'))
  const list = useQuery({
    queryKey: ['compensations', companyId], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('compensations').select('id, number, status, comp_date, amount, currency_code, partner:business_partners(name)')
      .eq('company_id', companyId!).order('comp_date', { ascending: false }).order('number', { ascending: false }).limit(500)) as unknown as Row[],
  })
  const open = params.get('c')
  return (
    <>
      <PageHeader title={t('Compensations')} description={t('When a partner is both customer and supplier, what they owe us and what we owe them are set against each other. Both invoices are settled by that amount and the books record it.')}
        actions={<Can perm="invoicing.write"><Button onClick={() => setAdding(true)}><Plus /> {t('New compensation')}</Button></Can>} />
      {list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : !list.data ? <Skeleton className="h-40" /> : list.data.length === 0
        ? <EmptyState icon={ArrowLeftRight} title={t('No compensation yet')} description={t('Start one from a partner who has open invoices on both sides.')} />
        : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader><TableRow><TableHead>{t('Number')}</TableHead><TableHead>{t('Date')}</TableHead><TableHead>{t('Partner')}</TableHead>
                <TableHead>{t('Status')}</TableHead><TableHead className="text-right">{t('Amount with VAT')}</TableHead></TableRow></TableHeader>
              <TableBody>
                {list.data.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => setParams({ c: r.id })}>
                    <TableCell className="font-medium">{r.number}</TableCell><TableCell>{formatDate(r.comp_date)}</TableCell><TableCell>{r.partner?.name}</TableCell>
                    <TableCell><StatusBadge status={r.status} /></TableCell><TableCell className="text-right tabular-nums">{formatMoney(r.amount, r.currency_code)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      {adding && <NewCompensation partnerId={params.get('new')} onClose={() => setAdding(false)} onDone={(id) => { setAdding(false); setParams({ c: id }) }} />}
      {open && <CompensationDialog id={open} onClose={() => setParams({})} />}
    </>
  )
}

type Pick = { on: boolean; amount: string }

function NewCompensation({ onClose, onDone, partnerId }: { onClose: () => void; onDone: (id: string) => void; partnerId?: string | null }) {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  const partners = usePartners()
  const [partner, setPartner] = React.useState<string | null>(partnerId ?? null)
  const [date, setDate] = React.useState(todayISO())
  const [notes, setNotes] = React.useState('')
  const [picks, setPicks] = React.useState<Record<string, Pick>>({})
  const [error, setError] = React.useState<string | null>(null)
  const items = useQuery({
    queryKey: ['comp-open', partner, date], enabled: !!partner,
    queryFn: async () => {
      const [ar, ap] = await Promise.all([fetchOpenItems(partner!, 'customer', date), fetchOpenItems(partner!, 'vendor', date)])
      return { ar: ar.rows.filter((r) => r.kind === 'invoice' && r.open > 0), ap: ap.rows.filter((r) => r.kind === 'invoice' && r.open > 0) }
    },
  })
  React.useEffect(() => setPicks({}), [partner, date])
  const sum = (rows: OpenRow[] | undefined) => (rows ?? []).reduce((s, r) => s + (picks[r.id]?.on ? num(picks[r.id].amount) : 0), 0)
  const ar = sum(items.data?.ar), ap = sum(items.data?.ap)
  const currencies = new Set([...(items.data?.ar ?? []), ...(items.data?.ap ?? [])].filter((r) => picks[r.id]?.on).map((r) => r.currency))
  // fill both sides with the smaller total, oldest first
  const auto = () => {
    if (!items.data) return
    const cur = items.data.ar[0]?.currency ?? items.data.ap[0]?.currency
    const arRows = items.data.ar.filter((r) => r.currency === cur), apRows = items.data.ap.filter((r) => r.currency === cur)
    let target = Math.min(arRows.reduce((s, r) => s + r.open, 0), apRows.reduce((s, r) => s + r.open, 0))
    const fill = (rows: OpenRow[], left: number) => {
      const out: Record<string, Pick> = {}
      for (const r of rows) { if (left <= 0.004) break; const a = Math.min(r.open, left); out[r.id] = { on: true, amount: String(Math.round(a * 100) / 100) }; left -= a }
      return out
    }
    target = Math.round(target * 100) / 100
    setPicks({ ...fill(arRows, target), ...fill(apRows, target) })
  }
  const create = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('compensation_create', { p: {
      company_id: companyId, partner_id: partner, date, notes,
      lines: [...(items.data?.ar ?? []).filter((r) => picks[r.id]?.on).map((r) => ({ sales_invoice_id: r.id, amount: num(picks[r.id].amount) })),
        ...(items.data?.ap ?? []).filter((r) => picks[r.id]?.on).map((r) => ({ vendor_bill_id: r.id, amount: num(picks[r.id].amount) }))],
    } as unknown as Json })) as { id: string; number: string },
    onSuccess: (r) => { for (const k of ['compensations', 'partner-card', 'open-items', 'sales', 'proc', 'fin']) void qc.invalidateQueries({ queryKey: [k] }); toast.success(t('Compensation {number} posted', { number: r.number })); onDone(r.id) },
    onError: (e) => setError(tServer(describeError(e))),
  })
  const side = (title: string, rows: OpenRow[] | undefined, total: number) => (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-baseline justify-between"><h3 className="text-sm font-medium">{title}</h3><span className="text-sm tabular-nums">{formatMoney(total)}</span></div>
      <div className="max-h-[40vh] overflow-y-auto rounded-lg border">
        {(rows ?? []).length === 0 ? <p className="p-4 text-center text-[13px] text-muted-foreground">{t('Nothing open')}</p> : (
          <ul className="divide-y">
            {rows!.map((r) => {
              const p = picks[r.id]
              return (
                <li key={r.id} className="flex items-center gap-2 px-2.5 py-2 text-[13px]">
                  <Checkbox checked={!!p?.on} onCheckedChange={(v) => setPicks((x) => ({ ...x, [r.id]: { on: !!v, amount: x[r.id]?.amount || String(r.open) } }))} aria-label={r.number} />
                  <span className="min-w-0 flex-1"><span className="font-medium">{r.number}</span>{r.reference && <span className="text-muted-foreground"> · {r.reference}</span>}
                    <span className="block text-[11px] text-muted-foreground">{formatDate(r.date)} · {t('open {amount}, with VAT', { amount: formatMoney(r.open, r.currency) })}</span></span>
                  <Input inputMode="decimal" className="h-8 w-24 text-right tabular-nums" disabled={!p?.on} value={p?.amount ?? ''} aria-label={t('Amount')}
                    onChange={(e) => setPicks((x) => ({ ...x, [r.id]: { on: true, amount: e.target.value } }))} />
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
  const both = (partners.data ?? []).filter((x) => x.is_customer && x.is_vendor)
  const ok = !!partner && ar > 0 && Math.abs(ar - ap) < 0.005 && currencies.size === 1
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t('New compensation')}</DialogTitle>
          <DialogDescription>{t('Choose the partner, then the invoices on both sides; the two sides must be equal.')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
          <div className="grid gap-1.5"><Label>{t('Partner')}</Label>
            <SearchSelect value={partner} onChange={setPartner} placeholder={t('A partner who is both customer and supplier')}
              options={both.map((x) => ({ value: x.id, label: x.name, hint: x.code ?? undefined }))} emptyText={t('No partner is both customer and supplier')} /></div>
          <div className="grid gap-1.5"><Label htmlFor="cp-date">{t('Date')}</Label><Input id="cp-date" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></div>
        </div>
        {partner && (items.isPending ? <Skeleton className="h-40" /> : (
          <>
            <div className="flex justify-end"><Button size="sm" variant="outline" onClick={auto}><Wand2 /> {t('Fill in by itself')}</Button></div>
            <div className="grid gap-4 md:grid-cols-2">
              {side(t('They owe us (our invoices)'), items.data?.ar, ar)}
              {side(t('We owe them (their invoices)'), items.data?.ap, ap)}
            </div>
            <p className={cn('text-sm', Math.abs(ar - ap) < 0.005 ? 'text-muted-foreground' : 'text-destructive')}>
              {Math.abs(ar - ap) < 0.005 ? (ar > 0 ? t('Both sides: {amount}', { amount: formatMoney(ar) }) : t('Tick the invoices to set against each other.'))
                : t('The sides differ by {amount}', { amount: formatMoney(Math.abs(ar - ap)) })}
            </p>
          </>
        ))}
        <div className="grid gap-1.5"><Label htmlFor="cp-notes">{t('Note')}</Label><Textarea id="cp-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button disabled={!ok} loading={create.isPending} onClick={() => { setError(null); create.mutate() }}><ArrowLeftRight /> {t('Post the compensation')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CompensationDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useCompany()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['compensation', id], queryFn: () => fetchCompensation(id) })
  const [reason, setReason] = React.useState('')
  const [cancelling, setCancelling] = React.useState(false)
  const cancel = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('compensation_cancel', { p_id: id, p_reason: reason })),
    onSuccess: () => { for (const k of ['compensations', 'partner-card', 'open-items', 'sales', 'proc', 'fin']) void qc.invalidateQueries({ queryKey: [k] }); void qc.invalidateQueries({ queryKey: ['compensation', id] }); setCancelling(false); toast.success(t('Compensation cancelled')) },
    onError: (e) => toast.error(tServer(describeError(e))),
  })
  const c = q.data
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{c ? `${t('Compensation')} ${c.number}` : t('Compensation')}</DialogTitle>
          <DialogDescription>{c ? `${c.partner.name} · ${formatDate(c.date)} · ${formatMoney(c.amount, c.currency)}` : ''}</DialogDescription>
        </DialogHeader>
        {!c ? <Skeleton className="h-40" /> : (
          <div className="grid gap-4 text-[13px]">
            {c.status === 'cancelled' && <p className="rounded-md bg-destructive/10 px-3 py-2 text-destructive">{t('Cancelled')}: {c.cancel_reason}</p>}
            <div className="grid gap-4 sm:grid-cols-2">
              <div><h3 className="mb-1 font-medium">{t('They owe us (our invoices)')}</h3>
                <ul className="divide-y rounded-lg border">{c.invoices.map((i) => <li key={i.number} className="flex justify-between px-3 py-1.5"><span>{i.number} · {formatDate(i.date)}</span><span className="tabular-nums">{formatMoney(i.amount)}</span></li>)}</ul></div>
              <div><h3 className="mb-1 font-medium">{t('We owe them (their invoices)')}</h3>
                <ul className="divide-y rounded-lg border">{c.bills.map((b) => <li key={b.number} className="flex justify-between px-3 py-1.5"><span>{b.number}{b.reference ? ` · ${b.reference}` : ''}</span><span className="tabular-nums">{formatMoney(b.amount)}</span></li>)}</ul></div>
            </div>
            {c.notes && <p className="text-muted-foreground">{c.notes}</p>}
            {cancelling && (
              <div className="grid gap-1.5"><Label htmlFor="cp-why">{t('Why is it cancelled?')}</Label><Input id="cp-why" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
            )}
          </div>
        )}
        <DialogFooter className="gap-2 sm:justify-between">
          <div>{c && c.status === 'posted' && can('invoicing.write') && (cancelling
            ? <Button variant="destructive" disabled={!reason.trim()} loading={cancel.isPending} onClick={() => cancel.mutate()}><Ban /> {t('Cancel the compensation')}</Button>
            : <Button variant="ghost" className="text-destructive" onClick={() => setCancelling(true)}><Ban /> {t('Cancel the compensation')}</Button>)}</div>
          <div className="flex gap-2">
            {c && <StatementActions build={async () => compensationStatement(c)} email={{ entityType: 'compensations', entityId: id }} />}
            <Button onClick={onClose}>{t('Close')}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
