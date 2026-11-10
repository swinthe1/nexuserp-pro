import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { AlertTriangle, Plus, Printer, Undo2 } from 'lucide-react'
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { msg, t, td, tn } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn, formatDate, formatMoney, formatQty, num } from '@/lib/utils'
import { useActiveUnit } from '@/app/active-unit'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useWarehouses } from '@/features/inventory/api'
import { itemCodes } from '@/lib/item-codes'
import { useActiveVendors } from '../api'
import { printVendorReturn } from '../vendor-return-print'

type Ret = { id: string; number: string; return_date: string; reason: string; total_cost: number; vendor_id: string | null; vendor: string | null
  receipt_id: string | null; receipt_number: string | null; warehouse: string | null; vendor_credit_id: string | null; credit_number: string | null
  credit_state: 'none' | 'draft' | 'posted'; days_waiting: number | null; lines: number }
type Item = { variant_id: string; name: string; sku: string; item_no: number | null; barcode: string | null; uom: string | null
  returnable: number; on_hand: number; nearest_expiry: string | null; last_received: string | null }

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
      cell: ({ row: { original: r } }) => r.receipt_id ? <Link to={`/inventory/receipts/${r.receipt_id}`} className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{r.receipt_number}</Link>
        : <span className="text-[12.5px] text-muted-foreground">{r.receipt_number ?? '—'}</span> },
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
        searchPlaceholder={t('Number, supplier, why…')} exportName="vendor-returns" onRowClick={(r) => (r.receipt_id ? navigate(`/inventory/receipts/${r.receipt_id}`) : void printVendorReturn(r.id))}
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

/** A new return: the supplier and the unit, then the items that go back and how many (whatever receipts they came on) */
export function NewReturnDialog({ vendor: start, onClose }: { vendor: string | null; onClose: () => void }) {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  const { unit } = useActiveUnit()
  const vendors = useActiveVendors()
  const whs = useWarehouses()
  const [vendor, setVendor] = React.useState<string | null>(start)
  const [wh, setWh] = React.useState<string | null>(unit?.id ?? null)
  React.useEffect(() => { if (!wh && whs.data?.length === 1) setWh(whs.data[0]!.id) }, [whs.data, wh])
  const [qty, setQty] = React.useState<Record<string, string>>({})
  const [find, setFind] = React.useState('')
  const [soon, setSoon] = React.useState(false)
  const [reason, setReason] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const { can } = useCompany()
  // the return lowers the stock, and with its credit note booked at once also the debt to the supplier and the VAT
  const [book, setBook] = React.useState(true)
  const items = useQuery({
    queryKey: ['vendor-returns', 'items', companyId, vendor, wh], enabled: !!companyId && !!vendor && !!wh,
    queryFn: async () => unwrap(await supabase.rpc('vendor_returnable_items', { p_company: companyId!, p_vendor: vendor!, p_warehouse: wh! })) as unknown as Item[],
  })
  const today = new Date().toISOString().slice(0, 10)
  const in30 = (() => { const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10) })()
  const f = find.trim().toLowerCase()
  const shown = (items.data ?? []).filter((i) => (!soon || (i.nearest_expiry && i.nearest_expiry <= in30))
    && (!f || `${i.name} ${i.sku} ${i.item_no ?? ''} ${i.barcode ?? ''}`.toLowerCase().includes(f)))
  const chosen = Object.entries(qty).filter(([, v]) => num(v) > 0)
  const send = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('return_items_to_vendor', { p_company: companyId!, p_vendor: vendor!, p_warehouse: wh!, p_reason: reason.trim(),
      p_lines: chosen.map(([id, v]) => ({ variant_id: id, quantity: num(v) })) as never })) as unknown as string,
    onSuccess: async (id) => {
      void qc.invalidateQueries({ queryKey: ['inv'] })
      if (book && can('invoicing.write')) {
        try {
          const cn = unwrap(await supabase.rpc('vendor_credit_from_return', { p_return: id })) as string
          unwrap(await supabase.rpc('post_vendor_bill', { p_id: cn }))
          toast.success(t('Returned: the stock, the debt to the supplier and the VAT book are lowered.'))
        } catch (e) {
          toast.warning(t('Returned and out of the stock; the credit note stayed in draft: {why}', { why: describeError(e) }))
        }
      } else toast.success(t('The goods left the stock. Create the credit note when the vendor confirms it.'))
      void qc.invalidateQueries({ queryKey: ['vendor-returns'] }); void qc.invalidateQueries({ queryKey: ['proc'] })
      onClose(); void printVendorReturn(id)
    },
    onError: (e) => setError(describeError(e)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('New return to the supplier')}</DialogTitle>
          <DialogDescription>{t('Only the items that go back, e.g. those near or past their date, from whatever deliveries they came. Each leaves the stock at the cost it came in at.')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5"><Label>{t('Supplier')}</Label>
            <SearchSelect value={vendor} onChange={(v) => { setVendor(v); setQty({}) }} placeholder={t('Choose the supplier')}
              options={(vendors.data ?? []).map((v) => ({ value: v.id, label: v.name, hint: v.tax_number ?? undefined }))} /></div>
          <div className="grid gap-1.5"><Label>{t('From the unit')}</Label>
            <SearchSelect value={wh} onChange={(v) => { setWh(v); setQty({}) }} placeholder={t('Choose the unit')}
              options={(whs.data ?? []).map((w) => ({ value: w.id, label: td(w.name), hint: w.code }))} /></div>
        </div>
        {vendor && wh && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Input className="h-9 max-w-xs" value={find} onChange={(e) => setFind(e.target.value)} placeholder={t('Name, number, barcode or code')} />
              <label className="inline-flex items-center gap-2 text-[13px]"><Switch checked={soon} onCheckedChange={setSoon} />{t('Only those expiring within 30 days')}</label>
            </div>
            {items.isLoading ? <Skeleton className="h-40" /> : !items.data?.length
              ? <p className="text-[13px] text-muted-foreground">{t('This supplier delivered nothing to this unit that can still go back.')}</p>
              : (
                <div className="max-h-[45vh] overflow-y-auto rounded-md border">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>{t('Item')}</TableHead><TableHead>{t('Nearest date')}</TableHead><TableHead className="text-right">{t('In stock')}</TableHead>
                      <TableHead className="text-right">{t('Can go back')}</TableHead><TableHead className="w-32 text-right">{t('Return now')}</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {shown.map((i) => {
                        const max = Math.min(num(i.returnable), Math.max(num(i.on_hand), 0))
                        const bad = num(qty[i.variant_id]) > max
                        return (
                          <TableRow key={i.variant_id}>
                            <TableCell><div className="text-[13px] font-medium">{i.name}</div><div className="text-xs text-muted-foreground">{itemCodes(i)}</div></TableCell>
                            <TableCell className={cn('whitespace-nowrap text-[13px]', i.nearest_expiry && i.nearest_expiry < today ? 'font-medium text-destructive' : i.nearest_expiry && i.nearest_expiry <= in30 ? 'text-warning' : 'text-muted-foreground')}>
                              {i.nearest_expiry ? formatDate(i.nearest_expiry) : '—'}</TableCell>
                            <TableCell className="text-right tabular text-[13px]">{formatQty(i.on_hand, i.uom ?? undefined)}</TableCell>
                            <TableCell className="text-right tabular text-[13px]">{formatQty(i.returnable, i.uom ?? undefined)}</TableCell>
                            <TableCell><Input type="number" min="0" step="any" max={max} disabled={max <= 0} aria-label={t('Return now')}
                              className={cn('h-8 text-right', bad && 'border-destructive')} value={qty[i.variant_id] ?? ''}
                              onChange={(e) => { setQty((q) => ({ ...q, [i.variant_id]: e.target.value })); setError(null) }} /></TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            {can('invoicing.write') && (
              <label className="flex items-start gap-2.5 rounded-md border bg-muted/30 px-3 py-2 text-[13px]">
                <Switch className="mt-0.5" checked={book} onCheckedChange={setBook} />
                <span><span className="font-medium">{t('Book the credit note now')}</span>
                  <span className="block text-xs text-muted-foreground">{t('The debt to the supplier and the purchase VAT go down together with the stock. Off: only the stock; the credit note is booked when the supplier sends it.')}</span></span>
              </label>
            )}
            <div className="grid gap-1.5"><Label htmlFor="nr-why">{t('Why')}</Label>
              <Input id="nr-why" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('e.g. near the expiry date, as agreed with the supplier')} /></div>
          </>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button disabled={!chosen.length || !reason.trim()} loading={send.isPending} onClick={() => send.mutate()}>
            <Undo2 /> {chosen.length ? tn(chosen.length, 'Send back {n} item', 'Send back {n} items') : t('Send back')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
