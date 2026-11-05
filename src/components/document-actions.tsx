import { ChevronDown, Download, FileText, Mail, PenLine, Printer, Share2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/app/auth-provider'
import { useCompany } from '@/app/company-provider'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
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
type MySignature = { id: string; name: string; title: string | null; is_default: boolean; kinds?: string[] }
/** a signature is for every document, or only for the kinds it lists */
const signsFor = (x: MySignature, k: DocKind) => !x.kinds?.length || x.kinds.includes(k)

/** the signatures this person may sign with, and the one they chose last (kept on this device) */
function useSignWith() {
  const { companyId } = useCompany()
  const { user } = useAuth()
  const list = useQuery({
    queryKey: ['my-signatures', companyId], enabled: !!companyId, staleTime: 5 * 60_000,
    queryFn: async () => unwrap(await supabase.rpc('my_signatures', { p_company: companyId! })) as unknown as MySignature[],
  })
  const key = `drispro.sign:${user?.id}:${companyId}`
  const [chosen, setChosen] = React.useState<string | null | undefined>(() => { try { const v = localStorage.getItem(key); return v === null ? undefined : v || null } catch { return undefined } })
  const sigs = list.data ?? []
  // never chosen: the company's default signature; a signature no longer allowed: none
  const current = chosen === undefined ? sigs.find((x) => x.is_default)?.id ?? null : chosen && sigs.some((x) => x.id === chosen) ? chosen : null
  const choose = (v: string | null) => { setChosen(v); try { localStorage.setItem(key, v ?? '') } catch { /* this session only */ } }
  // for one kind of document: the chosen signature when it is for this kind, else the default one that is, else none
  const forKind = (k: DocKind) => {
    const c = sigs.find((x) => x.id === current)
    if (c && signsFor(c, k)) return c.id
    if (chosen === null) return null
    return sigs.find((x) => x.is_default && signsFor(x, k))?.id ?? null
  }
  return { sigs, current, choose, forKind }
}

/** the document with the signature drawn on it, and a line in its history (who, whose, how) */
async function withSignature(d: PrintDoc, k: DocKind, id: string, sig: string | null, how: string): Promise<PrintDoc> {
  if (!sig) return d
  const s = unwrap(await supabase.rpc('document_sign', { p_kind: k, p_id: id, p_signature: sig, p_how: how })) as unknown as PrintDoc['signature']
  return { ...d, signature: s }
}

export function DocumentActions({ kind, id, alt, size = 'default' }: { kind: DocKind; id: string; alt?: { kind: DocKind; label: string }[]; size?: 'default' | 'sm' }) {
  const [busy, setBusy] = React.useState<string | null>(null)
  const [mail, setMail] = React.useState<{ doc: PrintDoc; kind: DocKind } | null>(null)
  const signing = useSignWith()
  const run = async (what: string, k: DocKind, fn: (d: PrintDoc) => Promise<void> | void) => {
    setBusy(what)
    try {
      const d = await fetchPrintDoc(k, id)
      await fn(what === 'mail' ? d : await withSignature(d, k, id, signing.forKind(k), what))
    } catch (e) { toast.error(tServer(describeError(e))) } finally { setBusy(null) }
  }
  const signer = signing.sigs.find((x) => x.id === signing.forKind(kind))
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
        <Button variant="outline" size={size} className="rounded-r-none" loading={busy === 'print'} onClick={() => print(kind)}
          title={signer ? t('Signed by {name}', { name: signer.name }) : undefined}><Printer /> {t('Print')}{signer && <PenLine className="size-3.5 text-primary" aria-label={t('Signed by {name}', { name: signer.name })} />}</Button>
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
            {signing.sigs.length > 0 && <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="flex items-center gap-1.5 text-[11px] font-normal text-muted-foreground"><PenLine className="size-3.5" /> {t('Signed by')}</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={signing.forKind(kind) ?? ''} onValueChange={(v) => signing.choose(v || null)}>
                <DropdownMenuRadioItem value="" onSelect={(e) => e.preventDefault()}>{t('Without a signature')}</DropdownMenuRadioItem>
                {signing.sigs.filter((x) => signsFor(x, kind)).map((x) => <DropdownMenuRadioItem key={x.id} value={x.id} onSelect={(e) => e.preventDefault()}><span>{x.name}{x.title && <span className="text-muted-foreground">{`, ${x.title}`}</span>}</span></DropdownMenuRadioItem>)}
              </DropdownMenuRadioGroup>
            </>}
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
      {mail && (() => { const sid = signing.forKind(mail.kind); const sg = signing.sigs.find((x) => x.id === sid)
        return <EmailDialog doc={mail.doc} kind={mail.kind} id={id} signature={sid} signer={sg ? `${sg.name}${sg.title ? `, ${sg.title}` : ''}` : null} onClose={() => setMail(null)} /> })()}
    </>
  )
}

function EmailDialog({ doc, kind, id, signature, signer, onClose }: { doc: PrintDoc; kind: DocKind; id: string; signature: string | null; signer: string | null; onClose: () => void }) {
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
      const pdf = await pdfBase64(await withSignature(doc, kind, id, signature, 'email'))
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
          {signer && <p className="flex items-center gap-2 text-[13px] text-muted-foreground"><PenLine className="size-4 text-primary" /> {t('Signed by {name}', { name: signer })}</p>}
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
