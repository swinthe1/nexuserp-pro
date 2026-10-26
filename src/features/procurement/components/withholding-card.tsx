import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Landmark, Plus, Undo2 } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { t, td } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { formatDate, formatMoney, num, todayISO } from '@/lib/utils'

export type WhCode = { id: string; code: string; name: string; rate: number; is_active: boolean }
export const useWithholdingCodes = () => {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: ['wht-codes', companyId], enabled: !!companyId, staleTime: 5 * 60_000,
    queryFn: async () => (unwrap(await supabase.rpc('withholding_setup', { p_company: companyId! })) ?? []) as unknown as WhCode[],
  })
}

type Bill = { id: string; subtotal: number; amount_due: number | null; currency_code: string; status: string; document_type: string }

/** On a posted supplier's bill: tax withheld at source (rent, interest, services of individuals…). The supplier gets that much less. */
export function WithholdingCard({ bill }: { bill: Bill }) {
  const { can } = useCompany()
  const qc = useQueryClient()
  const codes = useWithholdingCodes()
  const list = useQuery({
    queryKey: ['wht-bill', bill.id],
    queryFn: async () => unwrap(await supabase.from('withholdings').select('id, wh_date, base, rate, amount, status, cancel_reason, code:withholding_codes(code, name)')
      .eq('bill_id', bill.id).order('created_at')),
  })
  const [open, setOpen] = React.useState(false)
  const [code, setCode] = React.useState<string>('')
  const [base, setBase] = React.useState(String(bill.subtotal))
  const [date, setDate] = React.useState(todayISO())
  const [cancel, setCancel] = React.useState<string | null>(null)
  const [reason, setReason] = React.useState('')
  const k = codes.data?.find((c) => c.id === code)
  const amount = k ? Math.round(num(base) * k.rate) / 100 : 0
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['wht-bill', bill.id] }), qc.invalidateQueries({ queryKey: ['proc'] }), qc.invalidateQueries({ queryKey: ['wht'] })])
  const add = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('withholding_create', { p: { bill_id: bill.id, code_id: code, base: num(base), date } })),
    onSuccess: async () => { await refresh(); setOpen(false); toast.success(t('Tax withheld: {amount}', { amount: formatMoney(amount, bill.currency_code) })) },
    onError: (e) => toast.error(describeError(e)),
  })
  const undo = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('withholding_cancel', { p_id: cancel!, p_reason: reason })),
    onSuccess: async () => { await refresh(); setCancel(null); setReason(''); toast.success(t('Withholding cancelled')) },
    onError: (e) => toast.error(describeError(e)),
  })
  const rows = list.data ?? []
  const editable = can('invoicing.write') && bill.status === 'posted' && bill.document_type === 'vendor_bill'
  if (!rows.length && !editable) return null

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2"><Landmark className="size-4" />{t('Tax withheld at source')}</CardTitle></CardHeader>
      <CardContent className="grid gap-2 text-[13px]">
        {rows.length === 0 && <p className="text-muted-foreground">{t('For rent, interest, royalties or services of individuals, part of the payment goes to the tax office instead of the supplier.')}</p>}
        {rows.map((w) => {
          const c = w.code as unknown as { code: string; name: string } | null
          return (
            <div key={w.id} className={w.status === 'cancelled' ? 'text-muted-foreground line-through' : ''}>
              <div className="flex items-center justify-between gap-2">
                <span>{c ? td(c.name) : ''} · {num(w.rate)} %</span>
                <span className="font-medium tabular-nums">{formatMoney(w.amount)} {bill.currency_code}</span>
              </div>
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{formatDate(w.wh_date)} · {t('on {amount}', { amount: formatMoney(w.base) })}</span>
                {w.status === 'posted' && editable && <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setCancel(w.id)}><Undo2 className="size-3" />{t('Cancel')}</button>}
              </div>
            </div>
          )
        })}
        {editable && num(bill.amount_due) > 0 && (
          <Button variant="outline" size="sm" className="w-fit" onClick={() => { setOpen(true); setBase(String(bill.subtotal)); setCode('') }}>
            <Plus /> {t('Withhold tax')}</Button>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{t('Withhold tax')}</DialogTitle>
            <DialogDescription>{t('The supplier is paid that much less; the tax is owed to the tax office by the 15th (Kosovo) or 20th (Albania) of next month.')}</DialogDescription></DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5"><Label>{t('Kind|withholding')}</Label>
              <Select value={code} onValueChange={setCode}>
                <SelectTrigger aria-label={t('Kind|withholding')}><SelectValue placeholder={t('Choose')} /></SelectTrigger>
                <SelectContent>{(codes.data ?? []).filter((c) => c.is_active).map((c) => <SelectItem key={c.id} value={c.id}>{td(c.name)} · {num(c.rate)} %</SelectItem>)}</SelectContent>
              </Select></div>
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1.5"><Label htmlFor="wh-base">{t('On the amount')}</Label><Input id="wh-base" type="number" step="any" className="text-right" value={base} onChange={(e) => setBase(e.target.value)} /></div>
              <div className="grid gap-1.5"><Label htmlFor="wh-date">{t('Date')}</Label><Input id="wh-date" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></div>
            </div>
            <p className="rounded-md bg-muted/50 px-3 py-2 text-sm">{t('Tax withheld')}: <b className="tabular-nums">{formatMoney(amount, bill.currency_code)}</b>
              <span className="block text-xs text-muted-foreground">{t('The supplier then gets {amount}.', { amount: formatMoney(num(bill.amount_due) - amount, bill.currency_code) })}</span></p>
          </div>
          <DialogFooter><Button disabled={!k || amount <= 0} loading={add.isPending} onClick={() => add.mutate()}>{t('Withhold')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!cancel} onOpenChange={(o) => !o && setCancel(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{t('Cancel the withholding?')}</DialogTitle></DialogHeader>
          <div className="grid gap-1.5"><Label htmlFor="wh-why">{t('Why is it cancelled?')}</Label><Textarea id="wh-why" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          <DialogFooter><Button variant="destructive" disabled={!reason.trim()} loading={undo.isPending} onClick={() => undo.mutate()}>{t('Cancel the withholding')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
