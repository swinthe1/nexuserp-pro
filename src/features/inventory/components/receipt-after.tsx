import { DocumentActions } from '@/components/document-actions'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, Tag, Undo2 } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { t } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { formatDate, formatMoney, formatQty, num } from '@/lib/utils'

type Line = { id: string; variant_id: string; quantity: number; unit_cost: number | null }
type Receipt = { id: string; status: string; receipt_type: string; purchase_order_id: string | null; vendor_id: string | null; lines: Line[] }
type VendorReturn = { id: string; number: string; return_date: string; reason: string; total_cost: number; vendor_credit_id: string | null
  lines: { receipt_line_id: string; quantity: number }[] }

/** After a purchase receipt is posted: bill it (when it has no order) and send goods back to the vendor. */
export function ReceiptAfterActions({ doc, nameOf }: { doc: Receipt; nameOf: (variantId: string) => string }) {
  const { can, company } = useCompany()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [returning, setReturning] = React.useState(false)
  const returns = useQuery({
    queryKey: ['vendor-returns', doc.id],
    queryFn: async () => unwrap(await supabase.from('vendor_returns')
      .select('id, number, return_date, reason, total_cost, vendor_credit_id, lines:vendor_return_lines(receipt_line_id, quantity)')
      .eq('receipt_id', doc.id).order('created_at')) as unknown as VendorReturn[],
  })
  const bill = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('create_bill_from_receipt', { p_receipt: doc.id })) as string,
    onSuccess: (id) => { toast.success(t('Draft bill created')); navigate(`/procurement/bills/${id}`) },
    onError: (e) => toast.error(describeError(e)),
  })
  const credit = useMutation({
    mutationFn: async (ret: string) => unwrap(await supabase.rpc('vendor_credit_from_return', { p_return: ret })) as string,
    onSuccess: (id) => { void qc.invalidateQueries({ queryKey: ['vendor-returns', doc.id] }); toast.success(t('Draft credit note created')); navigate(`/procurement/bills/${id}`) },
    onError: (e) => toast.error(describeError(e)),
  })
  if (doc.status !== 'done') return null
  const purchase = doc.receipt_type === 'purchase'
  const returned = new Map<string, number>()
  for (const r of returns.data ?? []) for (const l of r.lines) returned.set(l.receipt_line_id, (returned.get(l.receipt_line_id) ?? 0) + num(l.quantity))

  return (
    <div className="mb-4 grid gap-3">
      <div className="flex flex-wrap gap-2">
        <DocumentActions id={doc.id} kind="goods_receipt" size="sm" />
        {doc.lines.length > 0 && <Button size="sm" variant="outline" asChild><Link to={`/inventory/labels?receipt=${doc.id}`}><Tag /> {t('Labels')}</Link></Button>}
        {purchase && !doc.purchase_order_id && doc.vendor_id && can('invoicing.write') && (
          <Button size="sm" variant="outline" loading={bill.isPending} onClick={() => bill.mutate()}><FileText /> {t('Create the vendor bill')}</Button>
        )}
        {purchase && can('inventory.write') && (
          <Button size="sm" variant="outline" onClick={() => setReturning(true)}><Undo2 /> {t('Return to the vendor')}</Button>
        )}
      </div>
      {(returns.data?.length ?? 0) > 0 && (
        <ul className="divide-y rounded-lg border text-[13px]">
          {returns.data!.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
              <span className="font-medium">{r.number}</span>
              <span className="text-muted-foreground">{formatDate(r.return_date)} · {r.reason}</span>
              <span className="ml-auto tabular-nums">{formatMoney(r.total_cost, company?.base_currency)}</span>
              {r.vendor_credit_id ? <Button size="sm" variant="ghost" asChild><Link to={`/procurement/bills/${r.vendor_credit_id}`}>{t('Credit note')}</Link></Button>
                : can('invoicing.write') && <Button size="sm" variant="outline" loading={credit.isPending && credit.variables === r.id} onClick={() => credit.mutate(r.id)}>{t('Create the credit note')}</Button>}
            </li>
          ))}
        </ul>
      )}
      {returning && <ReturnDialog doc={doc} nameOf={nameOf} returned={returned} onClose={() => setReturning(false)} />}
    </div>
  )
}

function ReturnDialog({ doc, nameOf, returned, onClose }: { doc: Receipt; nameOf: (v: string) => string; returned: Map<string, number>; onClose: () => void }) {
  const qc = useQueryClient()
  const [qty, setQty] = React.useState<Record<string, string>>({})
  const [reason, setReason] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const send = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('return_to_vendor', {
      p_receipt: doc.id, p_reason: reason.trim(),
      p_lines: Object.entries(qty).filter(([, v]) => num(v) > 0).map(([id, v]) => ({ receipt_line_id: id, quantity: num(v) })) as never,
    })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['vendor-returns', doc.id] }); void qc.invalidateQueries({ queryKey: ['stock'] })
      toast.success(t('The goods left the stock. Create the credit note when the vendor confirms it.')); onClose()
    },
    onError: (e) => setError(describeError(e)),
  })
  const any = Object.values(qty).some((v) => num(v) > 0)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('Return to the vendor')}</DialogTitle>
          <DialogDescription>{t('The goods leave the stock at the cost they came in at, and the order expects them again. Then the credit note for them is prepared.')}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] overflow-y-auto">
          <Table>
            <TableHeader><TableRow><TableHead>{t('Product')}</TableHead><TableHead className="text-right">{t('Received')}</TableHead>
              <TableHead className="text-right">{t('Already returned')}</TableHead><TableHead className="w-32 text-right">{t('Return now')}</TableHead></TableRow></TableHeader>
            <TableBody>
              {doc.lines.map((l) => {
                const left = num(l.quantity) - (returned.get(l.id) ?? 0)
                return (
                  <TableRow key={l.id}>
                    <TableCell className="text-[13px]">{nameOf(l.variant_id)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatQty(l.quantity)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatQty(returned.get(l.id) ?? 0)}</TableCell>
                    <TableCell><Input type="number" min="0" step="any" max={left} disabled={left <= 0} className="h-8 text-right" aria-label={t('Return now')}
                      value={qty[l.id] ?? ''} onChange={(e) => { setQty((q) => ({ ...q, [l.id]: e.target.value })); setError(null) }} /></TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
        <div className="grid gap-1.5"><Label htmlFor="ret-why">{t('Why')}</Label>
          <Input id="ret-why" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('e.g. damaged packaging')} /></div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button disabled={!any || !reason.trim()} loading={send.isPending} onClick={() => send.mutate()}><Undo2 /> {t('Send back')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
