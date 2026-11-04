import { useMutation, useQueryClient } from '@tanstack/react-query'
import { PencilLine } from 'lucide-react'
import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { t, tServer } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

/**
 * "Rihape për ndryshim": a completed invoice back to a draft, to correct and complete again. For a
 * finance manager, with a reason; the entry is reversed and the goods go back out, and the history
 * keeps who and why. The server refuses when the invoice can no longer change (paid, notes on it,
 * month closed, VAT declared, fiscalized, of an order) and says what to do instead.
 */
export function ReopenButton({ kind, id, number }: { kind: 'vendor_bill' | 'sales_invoice'; id: string; number: string }) {
  const { can } = useCompany()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [open, setOpen] = React.useState(false)
  const [reason, setReason] = React.useState('')
  const reopen = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc(kind === 'vendor_bill' ? 'reopen_vendor_bill' : 'reopen_sales_invoice',
      kind === 'vendor_bill' ? { p_bill: id, p_reason: reason } : { p_invoice: id, p_reason: reason } as never)) as unknown as { id: string; href: string },
    onSuccess: async (r) => {
      setOpen(false); setReason('')
      await qc.invalidateQueries()
      toast.success(t('{number} is a draft again: correct it, then complete it', { number }))
      navigate(r.href)
    },
    onError: (e) => toast.error(tServer(describeError(e))),
  })
  if (!(can('invoicing.approve') || can('finance.approve'))) return null
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} title={t('Back to a draft, to correct it and complete it again')}><PencilLine /> {t('Reopen to change')}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('Reopen {number} to change it?', { number })}</DialogTitle>
            <DialogDescription>
              {kind === 'vendor_bill'
                ? t('The accounting entry is reversed and the goods it brought in go back out at the same cost. The invoice keeps its number; you correct it and complete it again. The history keeps who reopened it and why.')
                : t('The accounting entry is reversed. The invoice keeps its number; you correct it and post it again. The history keeps who reopened it and why.')}
            </DialogDescription>
          </DialogHeader>
          <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); reopen.mutate() }}>
            <div className="grid gap-1.5"><Label htmlFor="ro-why">{t('Why is it reopened?')}</Label>
              <Textarea id="ro-why" autoFocus rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('e.g. the price on line 3 was 2,40, not 2,50')} /></div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{t('Cancel')}</Button>
              <Button type="submit" loading={reopen.isPending} disabled={reason.trim().length < 3}><PencilLine /> {t('Reopen')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
