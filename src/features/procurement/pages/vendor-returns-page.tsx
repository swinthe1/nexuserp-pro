import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { AlertTriangle, ArrowLeft, Plus, Printer, Undo2 } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Can, useCompany } from '@/app/company-provider'
import { ColumnHeader, DataTable, inFilter } from '@/components/data-table/data-table'
import { PageHeader } from '@/components/page-header'
import { SearchSelect } from '@/components/search-select'
import { StatCard } from '@/components/stat-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { msg, t, tn } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { formatDate, formatMoney, num } from '@/lib/utils'
import { ReturnDialog } from '@/features/inventory/components/receipt-after'
import { useActiveVendors } from '../api'
import { printVendorReturn } from '../vendor-return-print'

type Ret = { id: string; number: string; return_date: string; reason: string; total_cost: number; vendor_id: string | null; vendor: string | null
  receipt_id: string; receipt_number: string | null; warehouse: string | null; vendor_credit_id: string | null; credit_number: string | null
  credit_state: 'none' | 'draft' | 'posted'; days_waiting: number | null; lines: number }
type Source = { id: string; number: string; receipt_date: string; vendor_delivery_note: string | null; warehouse: string | null; total_value: number | null; bills: string | null; lines_left: number }

const LATE = 15
const STATE: Record<Ret['credit_state'], string> = { none: msg('Waiting for the credit note'), draft: msg('Credit note in draft'), posted: msg('Credit note booked') }

/** Every return to a supplier in one place: what went back, and whether the supplier's credit note came */
export function VendorReturnsPage() {
  const { companyId, company } = useCompany()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const list = useQuery({
    queryKey: ['vendor-returns', 'all', companyId], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('vendor_returns_list', { p_company: companyId! })) as unknown as Ret[],
  })
  const credit = useMutation({
    mutationFn: async (ret: string) => unwrap(await supabase.rpc('vendor_credit_from_return', { p_return: ret })) as string,
    onSuccess: (id) => { void qc.invalidateQueries({ queryKey: ['vendor-returns'] }); toast.success(t('Draft credit note created')); navigate(`/procurement/bills/${id}`) },
    onError: (e) => toast.error(describeError(e)),
  })
  const rows = list.data ?? []
  const waiting = rows.filter((r) => r.credit_state !== 'posted')
  const late = waiting.filter((r) => num(r.days_waiting) > LATE)
  const month = new Date().toISOString().slice(0, 7)
  const thisMonth = rows.filter((r) => r.return_date.startsWith(month))
  const newFor = params.get('new') ? params.get('vendor') ?? '' : null
  const openNew = (vendor?: string | null) => setParams((p) => { const n = new URLSearchParams(p); n.set('new', '1'); if (vendor) n.set('vendor', vendor); else n.delete('vendor'); return n })
  const closeNew = () => setParams((p) => { const n = new URLSearchParams(p); n.delete('new'); n.delete('vendor'); return n })

  const cols = React.useMemo<ColumnDef<Ret>[]>(() => [
    { accessorKey: 'number', header: ({ column }) => <ColumnHeader column={column} title={t('Number')} />, meta: { label: t('Number') }, cell: ({ getValue }) => <span className="font-medium">{getValue() as string}</span> },
    { accessorKey: 'return_date', header: ({ column }) => <ColumnHeader column={column} title={t('Date')} />, meta: { label: t('Date') }, cell: ({ getValue }) => formatDate(getValue() as string) },
    { id: 'vendor', accessorFn: (r) => r.vendor ?? '', filterFn: inFilter, header: ({ column }) => <ColumnHeader column={column} title={t('Supplier')} />, meta: { label: t('Supplier') },
      cell: ({ row: { original: r } }) => r.vendor_id ? <Link to={`/partners/${r.vendor_id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>{r.vendor}</Link> : '—' },
    { accessorKey: 'reason', header: t('Why'), meta: { label: t('Why') }, cell: ({ getValue }) => <span className="text-muted-foreground">{getValue() as string}</span> },
    { id: 'receipt', accessorFn: (r) => r.receipt_number ?? '', header: t('From the goods receipt'), meta: { label: t('From the goods receipt') },
      cell: ({ row: { original: r } }) => <Link to={`/inventory/receipts/${r.receipt_id}`} className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{r.receipt_number}</Link> },
    { id: 'warehouse', accessorFn: (r) => r.warehouse ?? '', filterFn: inFilter, header: t('Unit|store'), meta: { label: t('Unit|store') } },
    { accessorKey: 'total_cost', header: ({ column }) => <ColumnHeader column={column} title={t('At cost, without VAT')} />, meta: { label: t('At cost, without VAT'), align: 'right' },
      cell: ({ getValue }) => formatMoney(num(getValue())) },
    { id: 'credit_state', accessorFn: (r) => r.credit_state, filterFn: inFilter, header: t('Credit note'), meta: { label: t('Credit note'), exportValue: (r) => t(STATE[r.credit_state]) },
      cell: ({ row: { original: r } }) => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <Badge variant={r.credit_state === 'posted' ? 'success' : num(r.days_waiting) > LATE ? 'destructive' : 'warning'}>{t(STATE[r.credit_state])}</Badge>
          {r.credit_state !== 'posted' && r.days_waiting != null && <span className="text-xs text-muted-foreground">{tn(r.days_waiting, '{n} day', '{n} days')}</span>}
        </span>) },
    { id: 'actions', enableHiding: false, header: '', meta: { noExport: true },
      cell: ({ row: { original: r } }) => (
        <span className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" onClick={() => void printVendorReturn(r.id)}><Printer /> {t('Return note')}</Button>
          {r.vendor_credit_id ? <Button size="sm" variant="outline" asChild><Link to={`/procurement/bills/${r.vendor_credit_id}`}>{r.credit_number ?? t('Credit note')}</Link></Button>
            : <Can perm="invoicing.write"><Button size="sm" variant="outline" loading={credit.isPending && credit.variables === r.id} onClick={() => credit.mutate(r.id)}>{t('Create the credit note')}</Button></Can>}
        </span>) },
  ], [credit.isPending, credit.variables]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <PageHeader title={t('Returns to suppliers|menu')}
        description={t('Goods sent back to the supplier: they leave the stock at their cost on the day; the money and the VAT change when the supplier\'s credit note is booked.')}
        actions={<Can perm="inventory.write"><Button onClick={() => openNew()}><Plus /> {t('New return')}</Button></Can>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label={t('Returned this month, at cost')} value={formatMoney(thisMonth.reduce((s, r) => s + num(r.total_cost), 0), company?.base_currency)}
          hint={tn(thisMonth.length, '{n} return', '{n} returns')} loading={list.isLoading} />
        <StatCard label={t('Waiting for the credit note')} value={formatMoney(waiting.reduce((s, r) => s + num(r.total_cost), 0), company?.base_currency)}
          hint={tn(waiting.length, '{n} return', '{n} returns')} tone={waiting.length ? 'warning' : 'default'} loading={list.isLoading} />
        <StatCard label={t('Waiting more than {n} days', { n: LATE })} value={String(late.length)} tone={late.length ? 'warning' : 'default'}
          hint={late.length ? t('Ask the supplier for the credit note') : t('None late')} loading={list.isLoading} />
      </div>
      {!!late.length && (
        <p className="mb-3 flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[13px]">
          <AlertTriangle className="size-4 shrink-0 text-warning" />
          {t('{n} returns have been waiting more than {days} days for the credit note: {list}', { n: late.length, days: LATE, list: late.slice(0, 4).map((r) => `${r.number} (${r.vendor ?? ''})`).join(', ') + (late.length > 4 ? '…' : '') })}
        </p>
      )}
      <DataTable tableKey="procurement.vendor-returns" columns={cols} data={list.data} isLoading={list.isLoading} error={list.error} getRowId={(r) => r.id}
        searchPlaceholder={t('Number, supplier, why…')} exportName="vendor-returns" onRowClick={(r) => navigate(`/inventory/receipts/${r.receipt_id}`)}
        facets={[
          { columnId: 'credit_state', title: t('Credit note'), options: (['none', 'draft', 'posted'] as const).map((v) => ({ value: v, label: t(STATE[v]) })) },
          { columnId: 'vendor', title: t('Supplier'), options: [...new Set(rows.map((r) => r.vendor ?? '').filter(Boolean))].sort().map((v) => ({ value: v, label: v })) },
        ]}
        empty={{ title: t('No returns yet'), description: t('Send goods back from here: choose the supplier, the goods receipt and the quantities.'),
          action: <Can perm="inventory.write"><Button size="sm" onClick={() => openNew()}><Plus /> {t('New return')}</Button></Can> }} />
      {newFor !== null && <NewReturnDialog vendor={newFor || null} onClose={closeNew} />}
    </>
  )
}

/** A new return: the supplier, then one of the goods receipts it delivered, then the quantities */
export function NewReturnDialog({ vendor: start, onClose }: { vendor: string | null; onClose: () => void }) {
  const { companyId } = useCompany()
  const vendors = useActiveVendors()
  const [vendor, setVendor] = React.useState<string | null>(start)
  const [receipt, setReceipt] = React.useState<Source | null>(null)
  const sources = useQuery({
    queryKey: ['vendor-returns', 'sources', companyId, vendor], enabled: !!companyId && !!vendor,
    queryFn: async () => unwrap(await supabase.rpc('vendor_return_sources', { p_company: companyId!, p_vendor: vendor! })) as unknown as Source[],
  })
  const doc = useQuery({
    queryKey: ['vendor-returns', 'receipt', receipt?.id], enabled: !!receipt,
    queryFn: async () => {
      const lines = unwrap(await supabase.from('goods_receipt_lines').select('id, variant_id, quantity, unit_cost').eq('receipt_id', receipt!.id).order('created_at')) as unknown as { id: string; variant_id: string; quantity: number; unit_cost: number | null }[]
      const back = unwrap(await supabase.from('vendor_return_lines').select('receipt_line_id, quantity').in('receipt_line_id', lines.map((l) => l.id).length ? lines.map((l) => l.id) : ['00000000-0000-0000-0000-000000000000'])) as unknown as { receipt_line_id: string; quantity: number }[]
      const vs = unwrap(await supabase.from('product_variants').select('id, sku, name').in('id', [...new Set(lines.map((l) => l.variant_id))])) as unknown as { id: string; sku: string; name: string }[]
      const returned = new Map<string, number>()
      for (const b of back) returned.set(b.receipt_line_id, (returned.get(b.receipt_line_id) ?? 0) + num(b.quantity))
      return { lines, returned, names: new Map(vs.map((v) => [v.id, `${v.sku} · ${v.name}`])) }
    },
  })
  if (receipt && doc.data) {
    return <ReturnDialog doc={{ id: receipt.id, lines: doc.data.lines }} nameOf={(v) => doc.data!.names.get(v) ?? v} returned={doc.data.returned}
      onClose={onClose} onDone={(id) => { void printVendorReturn(id) }} />
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('New return to the supplier')}</DialogTitle>
          <DialogDescription>{t('Choose the supplier and the goods receipt the goods came with; then how much goes back and why.')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5"><Label>{t('Supplier')}</Label>
          <SearchSelect value={vendor} onChange={(v) => { setVendor(v); setReceipt(null) }} placeholder={t('Choose the supplier')}
            options={(vendors.data ?? []).map((v) => ({ value: v.id, label: v.name, hint: v.tax_number ?? undefined }))} /></div>
        {vendor && (
          <div className="grid gap-1.5">
            <Label>{t('Goods receipt')}</Label>
            {sources.isLoading ? <p className="text-[13px] text-muted-foreground">{t('Loading…')}</p>
              : !sources.data?.length ? <p className="text-[13px] text-muted-foreground">{t('This supplier has no goods receipt with goods left to return in the last year.')}</p>
              : (
                <ul className="max-h-[50vh] divide-y overflow-y-auto rounded-md border">
                  {sources.data.map((s) => (
                    <li key={s.id}>
                      <button type="button" disabled={doc.isFetching} onClick={() => setReceipt(s)}
                        className="flex w-full flex-wrap items-center gap-x-4 gap-y-0.5 px-3 py-2.5 text-left text-[13px] hover:bg-muted">
                        <span className="font-medium">{s.number}</span>
                        <span className="text-muted-foreground">{formatDate(s.receipt_date)}{s.warehouse ? ` · ${s.warehouse}` : ''}</span>
                        {s.bills && <span className="text-muted-foreground">{t('Purchase invoice')}: {s.bills}</span>}
                        {s.vendor_delivery_note && <span className="text-muted-foreground">{t('Delivery note:')} {s.vendor_delivery_note}</span>}
                        <span className="ml-auto tabular-nums">{s.total_value != null ? formatMoney(s.total_value) : ''}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
          </div>
        )}
        {receipt && doc.isLoading && <p className="flex items-center gap-2 text-[13px] text-muted-foreground"><ArrowLeft className="size-3.5" /> {t('Loading…')}</p>}
        <div className="flex justify-end"><Button variant="ghost" onClick={onClose}><Undo2 /> {t('Cancel')}</Button></div>
      </DialogContent>
    </Dialog>
  )
}
