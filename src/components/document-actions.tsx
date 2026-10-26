import { ChevronDown, Download, FileText, Mail, Printer, Share2 } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { t, tServer } from '@/i18n'
import { docTitle, type DocKind, fetchPrintDoc, fileName, type PrintDoc } from '@/lib/documents/model'
import { renderDocHtml } from '@/lib/documents/render-html'
import { pdfBase64, renderDocPdf } from '@/lib/documents/render-pdf'
import { describeError, unwrap } from '@/lib/errors'
import { printHtml } from '@/lib/print'
import { supabase } from '@/lib/supabase'
import { formatMoney } from '@/lib/utils'

/** Print, PDF, email and share of one document. `alt` adds printing the same document as another (an order as a pro forma). */
export function DocumentActions({ kind, id, alt, size = 'default' }: { kind: DocKind; id: string; alt?: { kind: DocKind; label: string }[]; size?: 'default' | 'sm' }) {
  const [busy, setBusy] = React.useState<string | null>(null)
  const [mail, setMail] = React.useState<{ doc: PrintDoc; kind: DocKind } | null>(null)
  const run = async (what: string, k: DocKind, fn: (d: PrintDoc) => Promise<void> | void) => {
    setBusy(what)
    try { await fn(await fetchPrintDoc(k, id)) } catch (e) { toast.error(tServer(describeError(e))) } finally { setBusy(null) }
  }
  const print = (k: DocKind) => run('print', k, (d) => { const { body, css } = renderDocHtml(d); printHtml(body, css, 'document') })
  const pdf = (k: DocKind) => run('pdf', k, async (d) => { (await renderDocPdf(d)).save(fileName(d)) })
  const canShare = typeof navigator !== 'undefined' && 'canShare' in navigator
  const share = (k: DocKind) => run('share', k, async (d) => {
    const blob = (await renderDocPdf(d)).output('blob') as Blob
    const file = new File([blob], fileName(d), { type: 'application/pdf' })
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: `${docTitle(d)} ${d.number}` }).catch(() => undefined)
    else { (await renderDocPdf(d)).save(fileName(d)); toast.info(t('The PDF was downloaded; attach it to the message.')) }
  })
  return (
    <>
      <div className="inline-flex">
        <Button variant="outline" size={size} className="rounded-r-none" loading={busy === 'print'} onClick={() => print(kind)}><Printer /> {t('Print')}</Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size={size} className="rounded-l-none border-l-0 px-2" aria-label={t('More ways to send it')}>
              {busy && busy !== 'print' ? <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <ChevronDown />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void pdf(kind)}><Download /> {t('Download PDF')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void run('mail', kind, (d) => setMail({ doc: d, kind }))}><Mail /> {t('Send by email')}</DropdownMenuItem>
            {canShare && <DropdownMenuItem onSelect={() => void share(kind)}><Share2 /> {t('Share (WhatsApp, Viber…)')}</DropdownMenuItem>}
            {alt?.length ? <DropdownMenuSeparator /> : null}
            {alt?.map((a) => (
              <React.Fragment key={a.kind}>
                <DropdownMenuItem onSelect={() => void print(a.kind)}><FileText /> {t('Print as {what}', { what: a.label })}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void run('mail', a.kind, (d) => setMail({ doc: d, kind: a.kind }))}><Mail /> {t('Email as {what}', { what: a.label })}</DropdownMenuItem>
              </React.Fragment>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {mail && <EmailDialog doc={mail.doc} kind={mail.kind} id={id} onClose={() => setMail(null)} />}
    </>
  )
}

function EmailDialog({ doc, kind, id, onClose }: { doc: PrintDoc; kind: DocKind; id: string; onClose: () => void }) {
  const title = docTitle(doc)
  const [to, setTo] = React.useState(doc.partner?.email ?? '')
  const [subject, setSubject] = React.useState(`${title} ${doc.number} · ${doc.company.name}`)
  const [text, setText] = React.useState(() => t('Hello,\n\nPlease find attached {what} {number} for {amount}.\n\nKind regards,\n{company}', {
    what: title.toLowerCase(), number: doc.number, amount: formatMoney(doc.total, doc.currency), company: doc.company.name,
  }))
  const [sending, setSending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const send = async () => {
    setSending(true); setError(null)
    try {
      const pdf = await pdfBase64(doc)
      unwrap(await supabase.rpc('document_email', { p_kind: kind, p_id: id, p_to: to.trim(), p_subject: subject, p_message: text, p_pdf: pdf, p_filename: fileName(doc) }))
      toast.success(t('Sent to {to}. It goes out within a minute.', { to: to.trim() }))
      onClose()
    } catch (e) { setError(tServer(describeError(e))) } finally { setSending(false) }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('Send {what} {number}', { what: title.toLowerCase(), number: doc.number })}</DialogTitle>
          <DialogDescription>{t('The document goes as a PDF attachment from the company mailbox.')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label htmlFor="dm-to">{t('To')}</Label><Input id="dm-to" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="emri@firma.com" />{/* i18n-ignore */}</div>
          <div className="grid gap-1.5"><Label htmlFor="dm-subject">{t('Subject')}</Label><Input id="dm-subject" value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="dm-text">{t('Message')}</Label><Textarea id="dm-text" rows={7} value={text} onChange={(e) => setText(e.target.value)} /></div>
          <p className="flex items-center gap-2 text-[13px] text-muted-foreground"><FileText className="size-4" /> {fileName(doc)}</p>
          {error && <p className="text-sm text-destructive">{error}{/mailbox/i.test(error) || /kutin/i.test(error) ? <> · <Link className="underline" to="/settings/automation">{t('Set it up')}</Link></> : null}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={sending} disabled={!to.trim()} onClick={() => void send()}><Mail /> {t('Send')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
