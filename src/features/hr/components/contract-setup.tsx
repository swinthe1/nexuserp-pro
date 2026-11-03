import { FileText, Pencil, Plus, Printer, Trash2 } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { Can, useCompany } from '@/app/company-provider'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { t, useLocale } from '@/i18n'
import { PLACEHOLDERS } from '@/i18n/contracts/models'
import { formatDate, formatMoney, humanize, todayISO } from '@/lib/utils'
import { useCompanyProfile, useCompanySettings, useSaveCompanySettings } from '@/features/settings/api'
import { openSignedCopy, useContractTemplates, useDeleteContractTemplate, useMyContracts, useSaveContractTemplate, type ContractTemplate } from '../api'
import { countryOf, defaultModel, printContract } from '../contract-doc'

const KINDS = ['contract', 'annex', 'notice'] as const
const KIND_LABEL: Record<string, string> = { contract: 'Contract', annex: 'Annex', notice: 'Notice of ending' }

/** HR setup → Contracts: who signs for the company, and the company's own models */
export function ContractSetup() {
  const settings = useCompanySettings()
  const save = useSaveCompanySettings()
  const templates = useContractTemplates()
  const del = useDeleteContractTemplate()
  const [v, setV] = React.useState<{ contract_signatory: string; contract_signatory_title: string; contract_place: string } | null>(null)
  const [edit, setEdit] = React.useState<ContractTemplate | 'new' | null>(null)
  React.useEffect(() => {
    if (settings.data && !v) setV({ contract_signatory: settings.data.contract_signatory ?? '', contract_signatory_title: settings.data.contract_signatory_title ?? '', contract_place: settings.data.contract_place ?? '' })
  }, [settings.data, v])
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader className="py-3"><CardTitle>{t('Who signs for the company')}</CardTitle>
          <CardDescription>{t('Printed under every contract, annex and notice.')}</CardDescription></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="grid gap-1.5"><Label htmlFor="cs-name">{t('Name')}</Label><Input id="cs-name" value={v?.contract_signatory ?? ''} onChange={(e) => setV((s) => s && { ...s, contract_signatory: e.target.value })} placeholder={t('e.g. Fatmir Krasniqi')} /></div>
          <div className="grid gap-1.5"><Label htmlFor="cs-title">{t('Position')}</Label><Input id="cs-title" value={v?.contract_signatory_title ?? ''} onChange={(e) => setV((s) => s && { ...s, contract_signatory_title: e.target.value })} placeholder={t('e.g. Director')} /></div>
          <div className="grid gap-1.5"><Label htmlFor="cs-place">{t('Place of signing')}</Label><Input id="cs-place" value={v?.contract_place ?? ''} onChange={(e) => setV((s) => s && { ...s, contract_place: e.target.value })} placeholder={t('e.g. Prishtinë')} /></div>
          <Can perm="admin.write"><Button className="justify-self-start" loading={save.isPending} disabled={!v} onClick={async () => {
            await save.mutateAsync({ contract_signatory: v!.contract_signatory.trim() || null, contract_signatory_title: v!.contract_signatory_title.trim() || null, contract_place: v!.contract_place.trim() || null })
            toast.success(t('Saved'))
          }}>{t('Save')}</Button></Can>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 py-3">
          <div><CardTitle>{t('Contract models')}</CardTitle>
            <CardDescription>{t('DrisPRO carries a model for Kosovo and for Albania that follows the labour law. Make your own when your lawyer wants other wording.')}</CardDescription></div>
          <Can perm="payroll.write"><Button size="sm" onClick={() => setEdit('new')}><Plus /> {t('New model')}</Button></Can>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table><TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Name')}</TableHead><TableHead>{t('For')}</TableHead><TableHead>{t('Type')}</TableHead><TableHead className="w-[1%]" /></TableRow></TableHeader>
            <TableBody>
              <TableRow className="hover:bg-transparent"><TableCell className="text-muted-foreground">{t('DrisPRO models (contract, annex, notice)')}</TableCell><TableCell>{t('All')}</TableCell><TableCell>—</TableCell><TableCell /></TableRow>
              {(templates.data ?? []).map((x) => (
                <TableRow key={x.id} className="hover:bg-transparent">
                  <TableCell className="font-medium">{x.name}</TableCell><TableCell>{t(KIND_LABEL[x.kind])}</TableCell><TableCell>{x.contract_type ? humanize(x.contract_type) : t('Any')}</TableCell>
                  <TableCell><Can perm="payroll.write"><div className="flex gap-1">
                    <Button size="icon-sm" variant="ghost" aria-label={t('Edit {name}', { name: x.name })} onClick={() => setEdit(x)}><Pencil /></Button>
                    <ConfirmDialog trigger={<Button size="icon-sm" variant="ghost" aria-label={t('Delete {name}', { name: x.name })}><Trash2 /></Button>}
                      title={t('Delete {name}?', { name: x.name })} description={t('Contracts already written from it keep their text.')} confirmLabel={t('Delete')} destructive onConfirm={() => del.mutateAsync(x.id)} />
                  </div></Can></TableCell>
                </TableRow>))}
            </TableBody></Table>
        </CardContent>
      </Card>
      {edit && <TemplateDialog template={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  )
}

function TemplateDialog({ template, onClose }: { template: ContractTemplate | null; onClose: () => void }) {
  const { company } = useCompany()
  const locale = useLocale()
  const country = countryOf(company?.country_code ?? 'AL')
  const save = useSaveContractTemplate()
  const [v, setV] = React.useState({
    name: template?.name ?? '', kind: template?.kind ?? 'contract', contract_type: template?.contract_type ?? '',
    body: template?.body ?? defaultModel(country, 'contract', 'indefinite'),
  })
  const area = React.useRef<HTMLTextAreaElement>(null)
  const insert = (key: string) => {
    const el = area.current; const tag = `{{${key}}}`
    if (!el) { setV((s) => ({ ...s, body: s.body + tag })); return }
    const a = el.selectionStart, b = el.selectionEnd
    setV((s) => ({ ...s, body: s.body.slice(0, a) + tag + s.body.slice(b) }))
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + tag.length, a + tag.length) })
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[94vh] max-w-4xl overflow-y-auto">
        <DialogHeader><DialogTitle>{template ? t('Edit model') : t('New model')}</DialogTitle>
          <DialogDescription>{t('Plain text. A blank line starts a paragraph, a line starting with "Neni" is a heading, the first line is the title. Click a field to put it where the cursor is.')}</DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="grid gap-1.5"><Label htmlFor="tp-name">{t('Name')}</Label><Input id="tp-name" value={v.name} onChange={(e) => setV((s) => ({ ...s, name: e.target.value }))} placeholder={t('e.g. Contract for shop staff')} /></div>
          <div className="grid gap-1.5"><Label>{t('For')}</Label>
            <Select value={v.kind} onValueChange={(k) => setV((s) => ({ ...s, kind: k, body: template ? s.body : defaultModel(country, k as 'contract', 'indefinite') }))}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{KINDS.map((k) => <SelectItem key={k} value={k}>{t(KIND_LABEL[k])}</SelectItem>)}</SelectContent></Select></div>
          {v.kind === 'contract' && <div className="grid gap-1.5"><Label>{t('Type')}</Label>
            <Select value={v.contract_type || 'any'} onValueChange={(x) => setV((s) => ({ ...s, contract_type: x === 'any' ? '' : x }))}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="any">{t('Any')}</SelectItem>{['indefinite', 'fixed_term', 'seasonal', 'service'].map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}</SelectContent></Select></div>}
        </div>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
          <Textarea ref={area} rows={26} className="font-mono text-[12.5px] leading-relaxed" value={v.body} onChange={(e) => setV((s) => ({ ...s, body: e.target.value }))} aria-label={t('The model text')} />
          <div className="grid max-h-[520px] content-start gap-1 overflow-y-auto rounded-md border p-2">
            <p className="px-1 pb-1 text-xs font-medium text-muted-foreground">{t('Fields')}</p>
            {PLACEHOLDERS.map((p) => (
              <button key={p.key} type="button" onClick={() => insert(p.key)} className="rounded px-1.5 py-1 text-left text-xs hover:bg-muted">
                <span className="font-mono text-primary">{`{{${p.key}}}`}</span><span className="block text-muted-foreground">{locale === 'sq' ? p.sq : p.en}</span>
              </button>))}
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={save.isPending} disabled={!v.name.trim() || !v.body.trim()} onClick={async () => {
            await save.mutateAsync({ id: template?.id, name: v.name.trim(), kind: v.kind, contract_type: v.kind === 'contract' ? v.contract_type || null : null, body: v.body })
            toast.success(t('Model saved')); onClose()
          }}>{t('Save')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** My workplace → my contracts: the text to print and the signed copy */
export function MyContracts({ employeeId }: { employeeId: string | undefined }) {
  const list = useMyContracts(employeeId)
  const profile = useCompanyProfile()
  const settings = useCompanySettings()
  if (!list.data?.length) return null
  return (
    <Card className="mt-4">
      <CardHeader className="py-3"><CardTitle>{t('My contracts')}</CardTitle></CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <Table><TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Number')}</TableHead><TableHead>{t('From')}</TableHead><TableHead>{t('To')}</TableHead>
          <TableHead className="text-right">{t('Gross per month')}</TableHead><TableHead>{t('Status')}</TableHead><TableHead className="w-[1%]" /></TableRow></TableHeader>
          <TableBody>{list.data.map((c) => (
            <TableRow key={c.id} className="hover:bg-transparent">
              <TableCell className="font-medium">{c.number}{c.kind === 'annex' && <Badge variant="secondary" className="ml-1.5">{t('Annex')}</Badge>}</TableCell>
              <TableCell>{formatDate(c.start_date)}</TableCell><TableCell>{c.end_date ? formatDate(c.end_date) : t('No end date')}</TableCell>
              <TableCell className="text-right tabular">{formatMoney(c.gross_salary, c.currency_code)}</TableCell><TableCell><StatusBadge status={c.status} /></TableCell>
              <TableCell><div className="flex gap-1">
                {c.body && profile.data && <Button size="icon-sm" variant="ghost" aria-label={t('Print')} onClick={() => printContract({ contract: c, company: profile.data!, settings: settings.data ?? null, today: todayISO() }, c.body!)}><Printer /></Button>}
                {c.signed_file && <Button size="icon-sm" variant="ghost" aria-label={t('Signed copy')} onClick={() => void openSignedCopy(c.signed_file!)}><FileText /></Button>}
              </div></TableCell>
            </TableRow>))}</TableBody></Table>
      </CardContent>
    </Card>
  )
}
