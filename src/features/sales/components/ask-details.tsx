import { useMutation } from '@tanstack/react-query'
import { Copy, Mail, MessageCircle, Send } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { t } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'

type Req = { token: string; expires_at: string; company: string; partner: string; email: string | null; phone: string | null }

/** "Ask for the details": a link the partner opens to fill in address, phone, e-mail and IBAN. */
export function AskDetailsButton({ partnerId }: { partnerId: string }) {
  const [open, setOpen] = React.useState(false)
  const make = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('partner_info_request', { p_partner: partnerId })) as unknown as Req,
    onSuccess: () => setOpen(true),
    onError: (e) => toast.error(describeError(e)),
  })
  const r = make.data
  const url = r ? `${window.location.origin}/te-dhenat/${r.token}` : ''
  const text = r ? t('Hello {partner}, please check and complete your details for {company} (address, phone, e-mail, IBAN): {url}', { partner: r.partner, company: r.company, url }) : ''
  const phone = (r?.phone ?? '').replace(/\D/g, '').replace(/^0/, '383')
  return (
    <>
      <Button variant="outline" loading={make.isPending} onClick={() => make.mutate()}><Send /> {t('Ask for the details')}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('Ask {partner} for their details', { partner: r?.partner ?? '' })}</DialogTitle>
            <DialogDescription>{t('Send this link. The partner fills in address, phone, e-mail, IBAN and a contact person, and they come to the card by themselves. The link works once, until {date}.', { date: r ? formatDate(r.expires_at) : '' })}</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input readOnly value={url} onFocus={(e) => e.target.select()} aria-label={t('Link')} />
            <Button variant="outline" size="icon" aria-label={t('Copy')} onClick={() => void navigator.clipboard?.writeText(url).then(() => toast.success(t('Copied')))}><Copy /></Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild className="bg-[#25D366] text-[#06301a] hover:bg-[#25D366]/90">
              <a href={`https://wa.me/${phone}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer"><MessageCircle /> {t('Send on WhatsApp')}</a>
            </Button>
            <Button asChild variant="outline">
              <a href={`mailto:${r?.email ?? ''}?subject=${encodeURIComponent(t('Your details for {company}', { company: r?.company ?? '' }))}&body=${encodeURIComponent(text)}`}><Mail /> {t('Send by e-mail')}</a>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
