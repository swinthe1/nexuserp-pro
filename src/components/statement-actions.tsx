import { ChevronDown, Download, Mail, Printer, Share2 } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { t, tServer } from '@/i18n'
import { renderStatementHtml, renderStatementPdf, type Statement, statementFile } from '@/lib/documents/render-statement'
import { describeError, unwrap } from '@/lib/errors'
import { printHtml } from '@/lib/print'
import { supabase } from '@/lib/supabase'

/** Print, PDF, email and share of a statement (card, open items, compensation). */
export function StatementActions({ build, email, disabled, size = 'default' }: {
  build: () => Promise<Statement>; email?: { entityType: string; entityId: string | null }; disabled?: boolean; size?: 'default' | 'sm'
}) {
  const [busy, setBusy] = React.useState<string | null>(null)
  const [mail, setMail] = React.useState<Statement | null>(null)
  const run = async (what: string, fn: (s: Statement) => Promise<void> | void) => {
    setBusy(what)
    try { await fn(await build()) } catch (e) { toast.error(tServer(describeError(e))) } finally { setBusy(null) }
  }
  const canShare = typeof navigator !== 'undefined' && 'canShare' in navigator
  return (
    <>
      <div className="inline-flex">
        <Button variant="outline" size={size} className="rounded-r-none" disabled={disabled} loading={busy === 'print'}
          onClick={() => void run('print', (s) => { const { body, css } = renderStatementHtml(s); printHtml(body, css, 'document') })}><Printer /> {t('Print')}</Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size={size} disabled={disabled} className="rounded-l-none border-l-0 px-2" aria-label={t('More ways to send it')}>
              {busy && busy !== 'print' ? <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <ChevronDown />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void run('pdf', async (s) => { (await renderStatementPdf(s)).save(statementFile(s)) })}><Download /> {t('Download PDF')}</DropdownMenuItem>
            {email && <DropdownMenuItem onSelect={() => void run('mail', (s) => setMail(s))}><Mail /> {t('Send by email')}</DropdownMenuItem>}
            {canShare && <DropdownMenuItem onSelect={() => void run('share', async (s) => {
              const file = new File([(await renderStatementPdf(s)).output('blob') as Blob], statementFile(s), { type: 'application/pdf' })
              if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: s.title }).catch(() => undefined)
              else { (await renderStatementPdf(s)).save(statementFile(s)); toast.info(t('The PDF was downloaded; attach it to the message.')) }
            })}><Share2 /> {t('Share (WhatsApp, Viber…)')}</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {mail && email && <StatementEmail st={mail} entity={email} onClose={() => setMail(null)} />}
    </>
  )
}

function StatementEmail({ st, entity, onClose }: { st: Statement; entity: { entityType: string; entityId: string | null }; onClose: () => void }) {
  const { companyId } = useCompany()
  const [to, setTo] = React.useState(st.partner?.email ?? '')
  const [subject, setSubject] = React.useState(`${st.title}${st.number ? ` ${st.number}` : ''} · ${st.company.name}`)
  const [text, setText] = React.useState(t('Hello,\n\nPlease find attached {what}.\n\nKind regards,\n{company}', { what: st.title.toLowerCase(), company: st.company.name }))
  const [sending, setSending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const send = async () => {
    setSending(true); setError(null)
    try {
      const pdf = (await renderStatementPdf(st)).output('datauristring').split(',')[1]
      unwrap(await supabase.rpc('pdf_email', { p_company: companyId!, p_to: to.trim(), p_subject: subject, p_message: text, p_pdf: pdf,
        p_filename: statementFile(st), p_entity_type: entity.entityType, p_entity_id: entity.entityId as string }))
      toast.success(t('Sent to {to}. It goes out within a minute.', { to: to.trim() })); onClose()
    } catch (e) { setError(tServer(describeError(e))) } finally { setSending(false) }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{t('Send by email')}</DialogTitle><DialogDescription>{t('The document goes as a PDF attachment from the company mailbox.')}</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label htmlFor="sm-to">{t('To')}</Label><Input id="sm-to" type="email" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="sm-subject">{t('Subject')}</Label><Input id="sm-subject" value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="sm-text">{t('Message')}</Label><Textarea id="sm-text" rows={6} value={text} onChange={(e) => setText(e.target.value)} /></div>
          {error && <p className="text-sm text-destructive">{error}{/mailbox|kutin|e-mailin e kompanis/i.test(error) ? <> · <Link className="underline" to="/settings/automation">{t('Set it up')}</Link></> : null}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={sending} disabled={!to.trim()} onClick={() => void send()}><Mail /> {t('Send')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
