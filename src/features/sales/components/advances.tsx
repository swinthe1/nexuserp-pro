import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { HandCoins, MinusCircle } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { t } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn, formatDate, formatMoney, num, todayISO } from '@/lib/utils'

type Advance = { id: string; number: string | null; date: string; status: string; total: number; subtotal: number; currency: string; paid: number; order_id: string | null; left: number
  deducted_in: { id: string; number: string | null; status: string; amount: number }[] }

export function useAdvances(args: { orderId?: string | null; partnerId?: string | null }) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: ['advances', companyId, args.orderId ?? null, args.partnerId ?? null], enabled: !!companyId && !!(args.orderId || args.partnerId),
    queryFn: async () => (unwrap(await supabase.rpc('advance_invoices', { p_company: companyId!, p_order: (args.orderId ?? null) as string, p_partner: (args.partnerId ?? null) as string })) ?? []) as unknown as Advance[],
  })
}

/** On an order: invoice part of it in advance (the customer pays before delivery). */
export function AdvanceButton({ order }: { order: { id: string; total: number; currency_code: string } }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [open, setOpen] = React.useState(false)
  const [mode, setMode] = React.useState<'percent' | 'amount'>('percent')
  const [value, setValue] = React.useState('30')
  const [date, setDate] = React.useState(todayISO())
  const gross = mode === 'percent' ? Math.round(num(order.total) * num(value)) / 100 : num(value)
  const create = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('advance_invoice_create', { p: { order_id: order.id, date, ...(mode === 'percent' ? { percent: num(value) } : { amount: num(value) }) } })) as string,
    onSuccess: (id) => { void qc.invalidateQueries({ queryKey: ['sales'] }); toast.success(t('Draft advance invoice created — check it and post it')); navigate(`/sales/invoices/${id}`) },
    onError: (e) => toast.error(describeError(e)),
  })
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}><HandCoins /> {t('Advance invoice')}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{t('Advance invoice')}</DialogTitle>
            <DialogDescription>{t('For a payment before delivery. Its VAT is due now; the final invoice deducts it, so the customer pays only the rest.')}</DialogDescription></DialogHeader>
          <div className="grid gap-3">
            <div className="inline-flex w-fit rounded-lg bg-muted p-1 text-sm">
              {(['percent', 'amount'] as const).map((m) => (
                <button key={m} type="button" aria-pressed={mode === m} onClick={() => { setMode(m); setValue(m === 'percent' ? '30' : String(Math.round(num(order.total) * 30) / 100)) }}
                  className={cn('rounded-md px-3 py-1.5 font-medium', mode === m ? 'bg-background shadow-sm' : 'text-muted-foreground')}>{m === 'percent' ? t('Part of the order (%)') : t('Amount')}</button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1.5"><Label htmlFor="adv-v">{mode === 'percent' ? '%' : t('Amount with VAT')}</Label>
                <Input id="adv-v" type="number" step="any" min="0" className="text-right" value={value} onChange={(e) => setValue(e.target.value)} /></div>
              <div className="grid gap-1.5"><Label htmlFor="adv-d">{t('Date')}</Label><Input id="adv-d" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></div>
            </div>
            <p className="rounded-md bg-muted/50 px-3 py-2 text-sm">{t('Advance with VAT')}: <b className="tabular-nums">{formatMoney(gross, order.currency_code)}</b>
              <span className="block text-xs text-muted-foreground">{t('of the order total with VAT {total}', { total: formatMoney(order.total, order.currency_code) })}</span></p>
          </div>
          <DialogFooter><Button disabled={gross <= 0 || gross > num(order.total)} loading={create.isPending} onClick={() => create.mutate()}>{t('Create the advance invoice')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** The advances of an order (on the order), or the ones a draft invoice can deduct (on the invoice). */
export function AdvancesCard({ orderId, partnerId, draftInvoiceId, onDeducted }: { orderId?: string | null; partnerId?: string | null; draftInvoiceId?: string; onDeducted?: () => void }) {
  const { can } = useCompany()
  const list = useAdvances({ orderId, partnerId: orderId ? null : partnerId })
  const rows = (list.data ?? []).filter((a) => !draftInvoiceId || (a.status === 'posted' && num(a.left) > 0))
  const deduct = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('invoice_add_advances', { p_invoice: draftInvoiceId!, p_any: true })) as number,
    onSuccess: (n) => { if (n) { toast.success(t('Advances deducted')); onDeducted?.() } else toast.info(t('Nothing to deduct')) },
    onError: (e) => toast.error(describeError(e)),
  })
  if (!rows.length) return null
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2"><HandCoins className="size-4" />{draftInvoiceId ? t('Advances to deduct') : t('Advance invoices')}</CardTitle></CardHeader>
      <CardContent className="grid gap-2 text-[13px]">
        {rows.map((a) => (
          <div key={a.id}>
            <div className="flex items-center justify-between gap-2">
              <Link className="text-primary hover:underline" to={`/sales/invoices/${a.id}`}>{a.number ?? t('Draft')}</Link>
              <span className="tabular-nums font-medium">{formatMoney(a.total, a.currency)} <span className="text-xs font-normal text-muted-foreground">{t('with VAT')}</span></span>
            </div>
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{formatDate(a.date)} {a.status !== 'posted' && <StatusBadge status={a.status} />}</span>
              {a.status === 'posted' && <span>{num(a.left) > 0 ? t('{amount} without VAT left to deduct', { amount: formatMoney(a.left) }) : t('fully deducted')}</span>}
            </div>
          </div>
        ))}
        {draftInvoiceId && can('invoicing.write') && (
          <Button variant="outline" size="sm" className="w-fit" loading={deduct.isPending} onClick={() => deduct.mutate()}><MinusCircle /> {t('Deduct them from this invoice')}</Button>
        )}
        {draftInvoiceId && <p className="text-xs text-muted-foreground">{t('Save the invoice first if you changed its lines.')}</p>}
      </CardContent>
    </Card>
  )
}
