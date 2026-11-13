import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Eye, FileText, Mail, Pencil, Plus, Printer, Trash2 } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Can, useCompany } from '@/app/company-provider'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { msg, t, tServer } from '@/i18n'
import type { PrintDoc } from '@/lib/documents/model'
import { renderStatementHtml, renderStatementPdf, type Statement } from '@/lib/documents/render-statement'
import { describeError, unwrap } from '@/lib/errors'
import { printHtml } from '@/lib/print'
import { supabase } from '@/lib/supabase'
import { formatDate, todayISO } from '@/lib/utils'

const BUCKET = 'company-assets'
const MAX_FILE = 5 * 1024 * 1024
const KINDS = ['business_certificate', 'fiscal_certificate', 'vat_certificate', 'licence', 'lease', 'bank', 'statute', 'other'] as const
type Kind = typeof KINDS[number]
const KIND: Record<Kind, string> = {
  business_certificate: msg('Business certificate'), fiscal_certificate: msg('Fiscal number certificate'), vat_certificate: msg('VAT certificate'),
  licence: msg('Licence or permit'), lease: msg('Lease contract'), bank: msg('Bank confirmation'), statute: msg('Statute or founding act'), other: msg('Other document'),
}
const UNIT_KIND: Record<string, string> = { store: msg('Store|unit kind'), warehouse: msg('Warehouse|unit kind'), production: msg('Production|unit kind'), transit: msg('Transit|unit kind') }
type Doc = { id: string; kind: Kind; title: string; valid_until: string | null; note: string | null; storage_path: string; file_name: string; mime_type: string | null; size_bytes: number | null; created_at: string }
type Sheet = {
  company: PrintDoc['company']
  business: { name: string; legal_name: string | null; tax_number: string | null; vat_number: string | null; business_number: string | null; address: string | null; city: string | null
    postal_code: string | null; phone: string | null; email: string | null; website: string | null }
  units: { code: string; name: string; kind: string; address: string | null; city: string | null; unit_no: string | null; manager: string | null; tills: number }[]
  printed_by: string | null; printed_at: string
}
const SHEET_FILE = () => `${t('Business information')}.pdf`
const daysTo = (d: string | null) => (d ? Math.round((new Date(`${d}T00:00:00`).getTime() - new Date(`${todayISO()}T00:00:00`).getTime()) / 864e5) : null)
const sizeText = (n: number | null) => (n == null ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)
const mailable = (d: Doc) => ['application/pdf', 'image/jpeg', 'image/png'].includes(d.mime_type ?? '')

function sheetStatement(s: Sheet): Statement {
  const b = s.business
  const row = (k: string, v: string | null | undefined): [string, string][] => (v ? [[k, v]] : [])
  return {
    title: t('Business information'), company: s.company,
    info: [...row(t('Registered name'), b.legal_name || b.name), ...row(t('Trade name'), b.legal_name && b.legal_name !== b.name ? b.name : null), ...row(t('NIPT/NUI'), b.tax_number),
      ...row(t('VAT no.'), b.vat_number), ...row(t('Business number'), b.business_number), ...row(t('Address'), [b.address, [b.postal_code, b.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')),
      ...row(t('Phone'), b.phone), ...row(t('Email'), b.email), ...row(t('Website'), b.website)],
    tables: [{ heading: t('Units and their addresses'),
      columns: [{ label: t('Code') }, { label: t('Unit|store') }, { label: t('Kind|unit') }, { label: t('Address') }, { label: t('Town') }, { label: t('Unit number') }, { label: t('Tills'), align: 'right' }],
      rows: s.units.map((u) => [u.code, u.name, t(UNIT_KIND[u.kind] ?? u.kind), u.address ?? '', u.city ?? '', u.unit_no ?? '', u.tills ? String(u.tills) : '']) }],
    summary: [], printed_by: s.printed_by, printed_at: s.printed_at,
  }
}

async function blobBase64(b: Blob) {
  const bytes = new Uint8Array(await b.arrayBuffer())
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/**
 * The business's own documents (request K-0012): the certificates and other papers a business is asked for,
 * kept as files, with a sheet of the business's data and its units. Printed or sent by email in one go, for a
 * visit of the tax administration, a bank or a tender.
 */
export function BusinessDocumentsPage() {
  const { companyId, can } = useCompany()
  const qc = useQueryClient()
  const key = ['settings', companyId, 'business-documents']
  const docs = useQuery({ queryKey: key, enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('company_documents').select('*').eq('company_id', companyId!).order('kind').order('created_at', { ascending: false })) as unknown as Doc[] })
  const sheet = useQuery({ queryKey: ['settings', companyId, 'business-sheet'], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('business_sheet', { p_company: companyId! })) as unknown as Sheet })
  const [editing, setEditing] = React.useState<Doc | 'new' | null>(null)
  const [mail, setMail] = React.useState(false)
  const [removing, setRemoving] = React.useState<Doc | null>(null)
  const rows = docs.data ?? []
  const s = sheet.data

  const open = async (d: Doc, download = false) => {
    const r = await supabase.storage.from(BUCKET).createSignedUrl(d.storage_path, 600, download ? { download: d.file_name } : undefined)
    if (r.error) { toast.error(tServer(describeError(r.error))); return }
    window.open(r.data.signedUrl, '_blank', 'noopener')
  }
  const remove = useMutation({
    mutationFn: async (d: Doc) => {
      unwrap(await supabase.from('company_documents').delete().eq('id', d.id))
      await supabase.storage.from(BUCKET).remove([d.storage_path])
    },
    onSuccess: () => { toast.success(t('Removed')); setRemoving(null); void qc.invalidateQueries({ queryKey: key }) },
    onError: (e) => toast.error(tServer(describeError(e))),
  })
  const b = s?.business
  const missing = b ? [!b.tax_number && t('NIPT/NUI'), !b.address && t('Address'), !b.city && t('Town'), !b.phone && t('Phone')].filter(Boolean) as string[] : []

  return (
    <>
      <PageHeader title={t('Business documents|menu')}
        description={t('The papers your business is asked for, in one place: the certificates as files, and a sheet with the business\'s data and its units. Print them or send them by email in one go.')}
        actions={<><Button variant="outline" disabled={!s} onClick={() => setMail(true)}><Mail /> {t('Send by email')}</Button>
          <Can perm="admin.write"><Button onClick={() => setEditing('new')}><Plus /> {t('Add a document')}</Button></Can></>} />

      <Card className="mb-4">
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
          <div><CardTitle>{t('Business information')}</CardTitle>
            <CardDescription>{t('Made by the program from the company\'s data and its units. Change them at Company settings and at the units.')}</CardDescription></div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={!s} onClick={() => { const { body, css } = renderStatementHtml(sheetStatement(s!)); printHtml(body, css, 'document') }}><Printer /> {t('Print')}</Button>
            <Button variant="outline" size="sm" disabled={!s} onClick={async () => (await renderStatementPdf(sheetStatement(s!))).save(SHEET_FILE())}><Download /> {t('Download PDF')}</Button>
          </div>
        </CardHeader>
        <CardContent>
          {sheet.error ? <p className="text-sm text-destructive">{tServer(describeError(sheet.error))}</p> : !s ? <div className="h-24 animate-pulse rounded-md bg-muted" /> : (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
                {([[t('Registered name'), b!.legal_name || b!.name], [t('NIPT/NUI'), b!.tax_number], [t('VAT no.'), b!.vat_number], [t('Business number'), b!.business_number],
                  [t('Address'), [b!.address, b!.city].filter(Boolean).join(', ')], [t('Phone'), b!.phone], [t('Email'), b!.email]] as [string, string | null][]).filter(([, v]) => v).map(([k, v]) =>
                  <React.Fragment key={k}><dt className="text-muted-foreground">{k}</dt><dd className="font-medium">{v}</dd></React.Fragment>)}
              </dl>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead><tr className="border-b text-left text-muted-foreground"><th className="py-1 pr-3 font-medium">{t('Unit|store')}</th><th className="py-1 pr-3 font-medium">{t('Address')}</th>
                    <th className="py-1 pr-3 font-medium">{t('Unit number')}</th><th className="py-1 text-right font-medium">{t('Tills')}</th></tr></thead>
                  <tbody>{s.units.map((u) => <tr key={u.code} className="border-b last:border-0">
                    <td className="py-1.5 pr-3"><span className="font-medium">{u.name}</span> <span className="text-muted-foreground">· {t(UNIT_KIND[u.kind] ?? u.kind)}</span></td>
                    <td className="py-1.5 pr-3">{[u.address, u.city].filter(Boolean).join(', ') || <span className="text-warning">{t('No address')}</span>}</td>
                    <td className="py-1.5 pr-3 tabular">{u.unit_no ?? ''}</td><td className="py-1.5 text-right tabular">{u.tills || ''}</td></tr>)}</tbody>
                </table>
              </div>
            </div>)}
          {missing.length > 0 && <p className="mt-3 text-[13px] text-warning">{t('Not filled in yet: {what}.', { what: missing.join(', ') })} <Link className="underline" to="/settings">{t('Company settings|menu')}</Link></p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t('Documents')}</CardTitle>
          <CardDescription>{t('PDF or a photo, up to 5 MB each. Give the date until which a document holds and it is marked here before it runs out.')}</CardDescription></CardHeader>
        <CardContent>
          {docs.error ? <p className="text-sm text-destructive">{tServer(describeError(docs.error))}</p> : docs.isLoading ? <div className="h-20 animate-pulse rounded-md bg-muted" />
            : rows.length === 0 ? <div className="rounded-lg border border-dashed p-6 text-center">
              <FileText className="mx-auto mb-2 size-6 text-muted-foreground" />
              <p className="font-medium">{t('No documents yet')}</p>
              <p className="mx-auto mt-1 max-w-md text-[13px] text-muted-foreground">{t('Start with the business certificate: scan it or take a photo, and add it here.')}</p>
              <Can perm="admin.write"><Button className="mt-3" size="sm" onClick={() => setEditing('new')}><Plus /> {t('Add a document')}</Button></Can></div>
            : <ul className="divide-y">{rows.map((d) => { const left = daysTo(d.valid_until)
              return <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-medium">{d.title}</div>
                  <div className="truncate text-[12.5px] text-muted-foreground">{[t(KIND[d.kind] ?? KIND.other), d.file_name, sizeText(d.size_bytes)].filter(Boolean).join(' · ')}</div>
                </div>
                {d.valid_until && (left! < 0 ? <Badge variant="destructive">{t('Ran out on {date}', { date: formatDate(d.valid_until) })}</Badge>
                  : left! <= 30 ? <Badge variant="outline" className="border-warning text-warning">{t('Holds until {date}', { date: formatDate(d.valid_until) })}</Badge>
                  : <span className="text-[12.5px] text-muted-foreground">{t('Holds until {date}', { date: formatDate(d.valid_until) })}</span>)}
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" aria-label={t('Open')} title={t('Open')} onClick={() => void open(d)}><Eye /></Button>
                  <Button variant="ghost" size="icon" aria-label={t('Download')} title={t('Download')} onClick={() => void open(d, true)}><Download /></Button>
                  {can('admin.write') && <Button variant="ghost" size="icon" aria-label={t('Change')} title={t('Change')} onClick={() => setEditing(d)}><Pencil /></Button>}
                  {can('admin.write') && <Button variant="ghost" size="icon" aria-label={t('Remove')} title={t('Remove')} onClick={() => setRemoving(d)}><Trash2 /></Button>}
                </div>
              </li> })}</ul>}
        </CardContent>
      </Card>

      {editing && <DocDialog doc={editing === 'new' ? null : editing} onClose={(saved) => { setEditing(null); if (saved) void qc.invalidateQueries({ queryKey: key }) }} />}
      {mail && s && <MailDialog sheet={s} docs={rows} onClose={() => setMail(false)} />}
      {removing && <Dialog open onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t('Remove "{title}"?', { title: removing.title })}</DialogTitle>
            <DialogDescription>{t('The file is deleted from the program and cannot be brought back. The paper itself stays with you.')}</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="ghost" onClick={() => setRemoving(null)}>{t('Keep it')}</Button>
            <Button variant="destructive" loading={remove.isPending} onClick={() => remove.mutate(removing)}>{t('Remove')}</Button></DialogFooter>
        </DialogContent></Dialog>}
    </>
  )
}

function DocDialog({ doc, onClose }: { doc: Doc | null; onClose: (saved: boolean) => void }) {
  const { companyId } = useCompany()
  const [kind, setKind] = React.useState<Kind>(doc?.kind ?? 'business_certificate')
  const [title, setTitle] = React.useState(doc?.title ?? '')
  const [until, setUntil] = React.useState(doc?.valid_until ?? '')
  const [note, setNote] = React.useState(doc?.note ?? '')
  const [file, setFile] = React.useState<File | null>(null)
  const tooBig = !!file && file.size > MAX_FILE
  const save = useMutation({
    mutationFn: async () => {
      const row: Record<string, unknown> = { kind, title: title.trim() || t(KIND[kind]), valid_until: until || null, note: note.trim() || null }
      let old: string | null = null
      if (file) {
        const ext = (file.name.split('.').pop() ?? 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'pdf'
        const path = `${companyId}/business-docs/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
        const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false })
        if (up.error) throw up.error
        Object.assign(row, { storage_path: path, file_name: file.name, mime_type: file.type || null, size_bytes: file.size })
        old = doc?.storage_path ?? null
      }
      if (doc) unwrap(await supabase.from('company_documents').update(row as never).eq('id', doc.id))
      else unwrap(await supabase.from('company_documents').insert({ ...row, company_id: companyId } as never))
      if (old) await supabase.storage.from(BUCKET).remove([old])
    },
    onSuccess: () => { toast.success(t('Saved')); onClose(true) },
    onError: (e) => toast.error(tServer(describeError(e))),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose(false)}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{doc ? t('Change the document') : t('Add a document')}</DialogTitle>
          <DialogDescription>{t('Choose what it is and the file. The name is filled in by itself when you leave it empty.')}</DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="bd-kind">{t('What it is')}</Label>
            <select id="bd-kind" className="h-9 rounded-md border bg-background px-2 text-[13px]" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              {KINDS.map((k) => <option key={k} value={k}>{t(KIND[k])}</option>)}</select></div>
          <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="bd-title">{t('Name')}</Label>
            <Input id="bd-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t(KIND[kind])} /></div>
          <div className="grid gap-1.5"><Label htmlFor="bd-until">{t('Holds until')}</Label>
            <Input id="bd-until" type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="bd-file">{doc ? t('Replace the file') : t('File')}</Label>
            <Input id="bd-file" type="file" accept=".pdf,image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
          {tooBig && <p className="text-[13px] text-destructive sm:col-span-2">{t('This file is larger than 5 MB. Scan it at a lower quality or as black and white.')}</p>}
          <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="bd-note">{t('Note')}</Label>
            <Textarea id="bd-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </div>
        <DialogFooter><Button variant="ghost" onClick={() => onClose(false)}>{t('Cancel')}</Button>
          <Button disabled={(!doc && !file) || tooBig} loading={save.isPending} onClick={() => save.mutate()}>{t('Save')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function MailDialog({ sheet, docs, onClose }: { sheet: Sheet; docs: Doc[]; onClose: () => void }) {
  const { companyId } = useCompany()
  const name = sheet.business.legal_name || sheet.business.name
  const [withSheet, setWithSheet] = React.useState(true)
  const [chosen, setChosen] = React.useState<string[]>(() => docs.filter(mailable).map((d) => d.id))
  const [to, setTo] = React.useState('')
  const [subject, setSubject] = React.useState(t('Documents of the business {name}', { name }))
  const [text, setText] = React.useState(t('Hello,\n\nPlease find attached the documents of our business.\n\nKind regards,\n{company}', { company: name }))
  const [sending, setSending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const picked = docs.filter((d) => chosen.includes(d.id))
  const total = picked.reduce((n, d) => n + (d.size_bytes ?? 0), 0)
  const tooBig = total > 10 * 1024 * 1024
  const send = async () => {
    setSending(true); setError(null)
    try {
      const files: { name: string; mime: string; data: string }[] = []
      if (withSheet) files.push({ name: SHEET_FILE(), mime: 'application/pdf', data: (await renderStatementPdf(sheetStatement(sheet))).output('datauristring').split(',')[1]! })
      for (const d of picked) {
        const r = await supabase.storage.from(BUCKET).download(d.storage_path)
        if (r.error) throw r.error
        files.push({ name: d.file_name, mime: d.mime_type!, data: await blobBase64(r.data) })
      }
      unwrap(await supabase.rpc('business_documents_email', { p_company: companyId!, p_to: to.trim(), p_subject: subject, p_message: text, p_files: files as never }))
      toast.success(t('Sent to {to}. It goes out within a minute.', { to: to.trim() })); onClose()
    } catch (e) { setError(tServer(describeError(e))) } finally { setSending(false) }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
        <DialogHeader><DialogTitle>{t('Send by email')}</DialogTitle>
          <DialogDescription>{t('The chosen documents go as attachments of one message from the company mailbox.')}</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5 rounded-lg border p-3">
            <label className="flex items-center gap-2 text-[13px]"><Checkbox checked={withSheet} onCheckedChange={(v) => setWithSheet(v === true)} /> <span className="font-medium">{t('Business information')}</span> <span className="text-muted-foreground">· PDF</span>{/* i18n-ignore */}</label>
            {docs.map((d) => <label key={d.id} className="flex items-center gap-2 text-[13px]">
              <Checkbox disabled={!mailable(d)} checked={chosen.includes(d.id)} onCheckedChange={(v) => setChosen((c) => (v === true ? [...c, d.id] : c.filter((x) => x !== d.id)))} />
              <span className="min-w-0 truncate">{d.title}</span> <span className="shrink-0 text-muted-foreground">· {mailable(d) ? sizeText(d.size_bytes) : t('only PDF, JPG and PNG go by email')}</span></label>)}
          </div>
          {tooBig && <p className="text-[13px] text-destructive">{t('The chosen files are over 10 MB together. Send them in two messages.')}</p>}
          <div className="grid gap-1.5"><Label htmlFor="bm-to">{t('To')}</Label><Input id="bm-to" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="emri@firma.com" />{/* i18n-ignore */}</div>
          <div className="grid gap-1.5"><Label htmlFor="bm-subject">{t('Subject')}</Label><Input id="bm-subject" value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="bm-text">{t('Message')}</Label><Textarea id="bm-text" rows={6} value={text} onChange={(e) => setText(e.target.value)} /></div>
          {error && <p className="text-sm text-destructive">{error}{/mailbox|kutin|e-mailin e kompanis/i.test(error) ? <> · <Link className="underline" to="/settings/automation">{t('Set it up')}</Link></> : null}</p>}
        </div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button disabled={!to.trim() || (!withSheet && picked.length === 0) || tooBig} loading={sending} onClick={() => void send()}><Mail /> {t('Send')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
