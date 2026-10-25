import { CloudOff, CloudUpload, RotateCw, Trash2, TriangleAlert } from 'lucide-react'
import * as React from 'react'
import { useCompany } from '@/app/company-provider'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { formatDateWith, t, tn } from '@/i18n'
import { discard, flush, retry, useOutbox } from '@/lib/offline/outbox'

/**
 * A thin bar under the top bar: no internet, and/or work saved on this device that is still to be sent.
 * Opens the list of that work (send again, or drop an item the server refused).
 */
export function OfflineBanner() {
  const { companyId } = useCompany()
  const box = useOutbox(companyId)
  const [open, setOpen] = React.useState(false)
  const pending = box.items.filter((i) => i.status === 'pending').length
  const failed = box.items.filter((i) => i.status === 'failed').length
  if (box.online && !pending && !failed) return null
  return (
    <>
      <div role="status" className={`flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b px-4 py-1.5 text-[13px] print:hidden ${failed ? 'border-destructive/30 bg-destructive/10' : 'border-warning/30 bg-warning/10'}`}>
        {!box.online ? <CloudOff className="size-4 text-warning" /> : failed ? <TriangleAlert className="size-4 text-destructive" /> : <CloudUpload className="size-4 text-warning" />}
        <span>
          {!box.online ? t('No internet. Screens you opened show their last data; tables, counts, receipts and drafts are saved here and sent when the connection is back.')
            : failed ? tn(failed, '{n} item saved offline was not accepted. Check it.', '{n} items saved offline were not accepted. Check them.')
            : box.syncing ? t('Sending what was saved offline…') : tn(pending, '{n} item waiting to be sent', '{n} items waiting to be sent')}
        </span>
        {(pending > 0 || failed > 0) && <button type="button" className="font-medium text-primary hover:underline" onClick={() => setOpen(true)}>{t('Show')}</button>}
      </div>
      <OutboxSheet open={open} onOpenChange={setOpen} />
    </>
  )
}

export function OutboxSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { companyId } = useCompany()
  const box = useOutbox(companyId)
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-3 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t('Saved on this device')}</SheetTitle>
          <SheetDescription>{t('Work done without internet. It is sent in order as soon as there is a connection; nothing here is lost when the page is closed.')}</SheetDescription>
        </SheetHeader>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={!box.online || box.syncing} onClick={() => void flush()}><RotateCw className={box.syncing ? 'animate-spin' : ''} /> {t('Send now')}</Button>
          {box.lastSync && <span className="text-xs text-muted-foreground">{t('Last sent {time}', { time: formatDateWith(new Date(box.lastSync), { hour: '2-digit', minute: '2-digit' }) })}</span>}
        </div>
        <ul className="-mx-2 flex-1 divide-y overflow-y-auto">
          {!box.items.length && <li className="px-2 py-8 text-center text-[13px] text-muted-foreground">{t('Everything has been sent.')}</li>}
          {box.items.map((i) => (
            <li key={i.id} className="flex items-start gap-3 px-2 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium">{i.label}</div>
                <div className="text-xs text-muted-foreground">{formatDateWith(new Date(i.created_at), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  {i.status === 'pending' && ` · ${t('waiting')}`}</div>
                {i.error && <div className="mt-0.5 text-xs text-destructive">{i.error}</div>}
              </div>
              {i.status === 'failed' && <>
                <Button size="icon" variant="ghost" aria-label={t('Try again')} onClick={() => void retry(i.id)}><RotateCw /></Button>
                <Button size="icon" variant="ghost" aria-label={t('Drop it')} onClick={() => { if (confirm(t('Drop this item? It will not be sent.'))) void discard(i.id) }}><Trash2 /></Button>
              </>}
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  )
}
