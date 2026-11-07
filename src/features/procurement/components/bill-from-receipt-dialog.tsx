/**
 * The supplier's invoice for goods received without an order: its number and date are asked here, because
 * they go to the purchase VAT book (the receipt's own number and date are not the invoice's).
 */
import { useMutation } from '@tanstack/react-query'
import { FileText } from 'lucide-react'
import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { t, tServer } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { todayISO } from '@/lib/utils'

export function BillFromReceiptDialog({ receipt, number: receiptNumber, onClose }: { receipt: string; number?: string; onClose: () => void }) {
  const navigate = useNavigate()
  const [number, setNumber] = React.useState('')
  const [date, setDate] = React.useState(todayISO())
  const make = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('create_bill_from_receipt', { p_receipt: receipt, p_number: number.trim(), p_date: date })) as string,
    onSuccess: (id) => { toast.success(t('Draft bill created')); onClose(); navigate(`/procurement/bills/${id}`) },
    onError: (e) => toast.error(tServer(describeError(e))),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{t('The supplier’s invoice')}</DialogTitle>
          <DialogDescription>{receiptNumber ? t('For the goods of {number}. Write the number and date as they are on the invoice: they go to the purchase book.', { number: receiptNumber })
            : t('Write the number and date as they are on the invoice: they go to the purchase book.')}</DialogDescription></DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (number.trim()) make.mutate() }}>
          <div className="grid gap-1.5"><Label htmlFor="bill-no">{t('Invoice number')}</Label><Input id="bill-no" autoFocus value={number} onChange={(e) => setNumber(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="bill-date">{t('Invoice date')}</Label><Input id="bill-date" type="date" value={date} onChange={(e) => setDate(e.target.value || todayISO())} /></div>
          <DialogFooter><Button type="button" variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
            <Button type="submit" disabled={!number.trim()} loading={make.isPending}><FileText /> {t('Enter the invoice')}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
