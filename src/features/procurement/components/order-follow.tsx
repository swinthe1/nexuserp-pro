import { useMutation, useQueryClient } from '@tanstack/react-query'
import { PhoneCall, Repeat } from 'lucide-react'
import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { SearchSelect } from '@/components/search-select'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { t } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { formatDate, num, todayISO } from '@/lib/utils'
import { procKeys, useActiveVendors } from '../api'

/** when the goods are due: the date the vendor promised, else the date we asked for */
export const poDue = (o: { promised_date?: string | null; expected_date?: string | null }) => o.promised_date ?? o.expected_date ?? null
export const OPEN_ORDER = ['approved', 'sent', 'partially_received']
export const isLate = (o: { status: string; promised_date?: string | null; expected_date?: string | null }) => {
  const due = poDue(o)
  return OPEN_ORDER.includes(o.status) && !!due && due < todayISO()
}

function useRefresh() {
  const qc = useQueryClient()
  const { companyId } = useCompany()
  return () => Promise.all([qc.invalidateQueries({ queryKey: procKeys.all(companyId) }), qc.invalidateQueries({ queryKey: ['tasks'] })])
}

/** the vendor confirmed the order: the date they promise and their order number */
export function ConfirmOrderDialog({ order, onClose }: {
  order: { id: string; number: string; order_date: string; expected_date: string | null; promised_date: string | null; vendor_reference: string | null; vendorName?: string }
  onClose: () => void
}) {
  const refresh = useRefresh()
  const [date, setDate] = React.useState(order.promised_date ?? order.expected_date ?? '')
  const [ref, setRef] = React.useState(order.vendor_reference ?? '')
  const save = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('po_confirm', { p_id: order.id, p_promised: date || undefined, p_reference: ref.trim() || undefined })),
    onSuccess: () => { toast.success(t('Confirmation recorded'), { description: date ? t('Goods expected on {date}', { date: formatDate(date) }) : undefined }); void refresh(); onClose() },
    onError: (e) => toast.error(describeError(e)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('The vendor confirmed {number}', { number: order.number })}</DialogTitle>
          <DialogDescription>{t('Write the day they promise to deliver. The order counts as late after that day, and the buyer gets a task to call them.')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label htmlFor="pc-date">{t('Delivery promised for')}</Label>
            <Input id="pc-date" type="date" min={order.order_date} value={date} onChange={(e) => setDate(e.target.value)} />
            {order.expected_date && date && date !== order.expected_date && (
              <span className={date > order.expected_date ? 'text-xs text-warning' : 'text-xs text-muted-foreground'}>
                {t('We asked for {date}', { date: formatDate(order.expected_date) })}
              </span>
            )}
          </div>
          <div className="grid gap-1.5"><Label htmlFor="pc-ref" optional>{t('Their order or confirmation number')}</Label>
            <Input id="pc-ref" value={ref} onChange={(e) => setRef(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}><PhoneCall /> {t('Record the confirmation')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** what has not come is ordered again: from the same vendor, or from another one */
export function OrderRestDialog({ order, received, onClose }: {
  order: { id: string; number: string; vendor_id: string; status: string; lines: { variant_id: string | null; description: string; quantity: number; qty_received: number }[] }
  received: boolean
  onClose: () => void
}) {
  const refresh = useRefresh()
  const navigate = useNavigate()
  const vendors = useActiveVendors()
  const [vendor, setVendor] = React.useState(order.vendor_id)
  const [date, setDate] = React.useState('')
  const rest = order.lines.filter((l) => l.variant_id && num(l.quantity) > num(l.qty_received))
  const go = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('po_order_rest', { p_po: order.id, p_vendor: vendor, p_expected: date || undefined })) as unknown as string,
    onSuccess: (id) => { toast.success(t('A new draft order for what is missing'), { description: t('Check it and submit it.') }); void refresh(); onClose(); navigate(`/procurement/orders/${id}`) },
    onError: (e) => toast.error(describeError(e)),
  })
  const same = vendor === order.vendor_id
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('Order what is missing again')}</DialogTitle>
          <DialogDescription>
            {received ? t('{number} is closed: it stops waiting for these goods. A new draft order is made for them.', { number: order.number })
              : t('Nothing has come on {number}, so it is cancelled. A new draft order is made for the same goods.', { number: order.number })}
          </DialogDescription>
        </DialogHeader>
        <ul className="grid gap-1 rounded-md border p-3 text-[13px]">
          {rest.map((l, i) => <li key={i} className="flex justify-between gap-3"><span className="truncate">{l.description}</span><span className="tabular font-medium">{num(l.quantity) - num(l.qty_received)}</span></li>)}
        </ul>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5"><Label>{t('From')}</Label>
            <SearchSelect value={vendor} onChange={(v) => v && setVendor(v)} options={(vendors.data ?? []).filter((v) => v.is_active).map((v) => ({ value: v.id, label: v.name, hint: v.code }))} />
            <span className="text-xs text-muted-foreground">{same ? t('At the prices of this order') : t("At the other vendor's prices")}</span>
          </div>
          <div className="grid gap-1.5"><Label htmlFor="or-date" optional>{t('Expected delivery')}</Label>
            <Input id="or-date" type="date" min={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={go.isPending} disabled={!rest.length} onClick={() => go.mutate()}><Repeat /> {t('Make the new order')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
