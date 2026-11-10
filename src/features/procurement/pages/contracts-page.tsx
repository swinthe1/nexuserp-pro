import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { FileText, Paperclip, Plus } from 'lucide-react'
import * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Can, useCompany } from '@/app/company-provider'
import { ColumnHeader, DataTable, inFilter } from '@/components/data-table/data-table'
import { PageHeader } from '@/components/page-header'
import { SearchSelect } from '@/components/search-select'
import { StatCard } from '@/components/stat-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { msg, t } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { formatDate, todayISO } from '@/lib/utils'
import { useActiveVendors } from '../api'
import { contractTerms, type Contract } from '../contracts'

const STATUS: Record<Contract['status'], string> = { draft: msg('Draft'), active: msg('In force'), ended: msg('Ended') }
const daysTo = (d: string | null) => (d ? Math.round((new Date(`${d}T00:00:00`).getTime() - new Date(`${todayISO()}T00:00:00`).getTime()) / 864e5) : null)

/**
 * Supplier contracts (from the meeting with the staff): the terms (payment, rebate, delivery, taking
 * back expired goods), the dates, the signed file, and a reminder to the buyers before the end. The
 * purchase invoice of that supplier shows the terms in force.
 */
/** the supplier contracts; with a vendor (on the vendor's card) only that vendor's, without the page header */
export function ContractsPage({ vendorId }: { vendorId?: string } = {}) {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  const vendors = useActiveVendors()
  const [params, setParams] = useSearchParams()
  const key = ['proc', companyId, 'contracts']
  const q = useQuery({ queryKey: key, enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('supplier_contracts' as never).select('*').eq('company_id', companyId!).is('deleted_at', null).order('start_date', { ascending: false })) as unknown as Contract[] })
  const rows = (q.data ?? []).filter((r) => !vendorId || r.vendor_id === vendorId)
  const open = params.get('c')
  const editing = open === 'new' ? 'new' : rows.find((r) => r.id === open) ?? null
  const setOpen = (id: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (id) n.set('c', id); else n.delete('c'); return n }, { replace: true })
  const vendorName = (id: string) => (vendors.data ?? []).find((v) => v.id === id)?.name ?? ''
  const active = rows.filter((r) => r.status === 'active')
  const ending = active.filter((r) => { const d = daysTo(r.end_date); return d != null && d >= 0 && d <= r.remind_days })

  const cols = React.useMemo<ColumnDef<Contract>[]>(() => [
    { accessorKey: 'number', header: ({ column }) => <ColumnHeader column={column} title={t('Number')} />, meta: { label: t('Number') }, cell: ({ row: { original: r } }) =>
      <span className="font-medium">{r.number}{r.file_path && <Paperclip className="ml-1 inline size-3.5 text-muted-foreground" />}</span> },
    { id: 'vendor', accessorFn: (r) => vendorName(r.vendor_id), filterFn: inFilter, header: ({ column }) => <ColumnHeader column={column} title={t('Supplier')} />, meta: { label: t('Supplier') } },
    { accessorKey: 'title', header: t('Subject'), meta: { label: t('Subject') } },
    { id: 'terms', accessorFn: (r) => contractTerms(r), header: t('Terms'), meta: { label: t('Terms') }, cell: ({ getValue }) => <span className="text-[12.5px] text-muted-foreground">{getValue() as string}</span> },
    { accessorKey: 'start_date', header: ({ column }) => <ColumnHeader column={column} title={t('From|date')} />, meta: { label: t('From|date') }, cell: ({ getValue }) => formatDate(getValue() as string) },
    { accessorKey: 'end_date', header: ({ column }) => <ColumnHeader column={column} title={t('To|date')} />, meta: { label: t('To|date') }, cell: ({ row: { original: r } }) => {
      const d = daysTo(r.end_date)
      return r.end_date ? <span className={d != null && d >= 0 && d <= r.remind_days && r.status === 'active' ? 'font-medium text-warning' : ''}>{formatDate(r.end_date)}</span> : <span className="text-muted-foreground">{t('No end')}</span>
    } },
    { id: 'status', accessorFn: (r) => r.status, filterFn: inFilter, header: t('Status'), meta: { label: t('Status') },
      cell: ({ row: { original: r } }) => <Badge variant={r.status === 'active' ? 'outline' : 'secondary'}>{t(STATUS[r.status])}</Badge> },
  ], [vendors.data]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {vendorId ? <div className="mb-3 flex justify-end"><Can perm="procurement.write"><Button size="sm" onClick={() => setOpen('new')}><Plus /> {t('New contract')}</Button></Can></div>
        : <PageHeader title={t('Supplier contracts|menu')}
        description={t('The terms agreed with each supplier, the dates and the signed contract. The buyers are reminded before a contract ends, and the purchase invoice shows the terms in force.')}
        actions={<Can perm="procurement.write"><Button onClick={() => setOpen('new')}><Plus /> {t('New contract')}</Button></Can>} />}
      {!vendorId && <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label={t('In force')} value={String(active.length)} />
        <StatCard label={t('Ending soon')} value={String(ending.length)} tone={ending.length ? 'warning' : 'default'} />
        <StatCard label={t('Suppliers with a contract')} value={String(new Set(active.map((r) => r.vendor_id)).size)} />
      </div>}
      <DataTable tableKey={vendorId ? 'procurement.contracts.vendor' : 'procurement.contracts'} initialHidden={vendorId ? ['vendor'] : undefined} columns={cols} data={rows} isLoading={q.isLoading} error={q.error} getRowId={(r) => r.id} onRowClick={(r) => setOpen(r.id)}
        searchPlaceholder={t('Number, supplier, subject…')} exportName={t('supplier-contracts')} initialFilters={[{ id: 'status', value: ['active', 'draft'] }]}
        facets={[{ columnId: 'status', title: t('Status'), options: (Object.keys(STATUS) as Contract['status'][]).map((s) => ({ value: s, label: t(STATUS[s]) })) }]}
        empty={{ title: t('No contracts yet'), description: t('Add the contract of a supplier with its terms and the signed file.') }} />
      {editing && <ContractDialog contract={editing === 'new' ? null : editing} vendorId={vendorId} onClose={() => { setOpen(null); void qc.invalidateQueries({ queryKey: key }) }} />}
    </>
  )
}

function ContractDialog({ contract, vendorId, onClose }: { contract: Contract | null; vendorId?: string; onClose: () => void }) {
  const { companyId, can } = useCompany()
  const vendors = useActiveVendors()
  const editable = can('procurement.write')
  const [f, setF] = React.useState(() => ({
    vendor_id: contract?.vendor_id ?? vendorId ?? null as string | null, number: contract?.number ?? '', title: contract?.title ?? '', start_date: contract?.start_date ?? todayISO(), end_date: contract?.end_date ?? '',
    payment_days: contract?.payment_days == null ? '' : String(contract.payment_days), rebate_pct: contract?.rebate_pct == null ? '' : String(contract.rebate_pct), rebate_terms: contract?.rebate_terms ?? '',
    delivery_days: contract?.delivery_days == null ? '' : String(contract.delivery_days), min_order: contract?.min_order == null ? '' : String(contract.min_order),
    returns_expired: contract?.returns_expired ?? false, returns_terms: contract?.returns_terms ?? '', other_terms: contract?.other_terms ?? '', remind_days: String(contract?.remind_days ?? 30),
    status: contract?.status ?? 'active' as Contract['status'], notes: contract?.notes ?? '', file_path: contract?.file_path ?? null as string | null, file_name: contract?.file_name ?? null as string | null,
  }))
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }))
  const [file, setFile] = React.useState<File | null>(null)
  const nullNum = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')))
  const save = useMutation({
    mutationFn: async () => {
      let file_path = f.file_path, file_name = f.file_name
      if (file) {
        const ext = (file.name.split('.').pop() ?? 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'pdf'
        file_path = `${companyId}/contracts/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
        const up = await supabase.storage.from('attachments').upload(file_path, file, { contentType: file.type || undefined, upsert: false })
        if (up.error) throw up.error
        file_name = file.name
      }
      const row = { company_id: companyId, vendor_id: f.vendor_id, number: f.number.trim(), title: f.title.trim() || null, start_date: f.start_date, end_date: f.end_date || null,
        payment_days: nullNum(f.payment_days), rebate_pct: nullNum(f.rebate_pct), rebate_terms: f.rebate_terms.trim() || null, delivery_days: nullNum(f.delivery_days), min_order: nullNum(f.min_order),
        returns_expired: f.returns_expired, returns_terms: f.returns_terms.trim() || null, other_terms: f.other_terms.trim() || null, remind_days: Number(f.remind_days) || 30,
        status: f.status, notes: f.notes.trim() || null, file_path, file_name }
      if (contract) unwrap(await supabase.from('supplier_contracts' as never).update(row as never).eq('id', contract.id))
      else unwrap(await supabase.from('supplier_contracts' as never).insert(row as never))
    },
    onSuccess: () => { toast.success(t('Saved')); onClose() },
    onError: (e) => toast.error(describeError(e)),
  })
  const openFile = async () => {
    if (!f.file_path) return
    const r = await supabase.storage.from('attachments').createSignedUrl(f.file_path, 600)
    if (r.error) { toast.error(describeError(r.error)); return }
    window.open(r.data.signedUrl, '_blank', 'noopener')
  }
  const ready = !!f.vendor_id && !!f.number.trim() && !!f.start_date && (!f.end_date || f.end_date >= f.start_date)
  const field = (label: string, el: React.ReactNode, wide = false) => <div className={wide ? 'grid gap-1.5 sm:col-span-2' : 'grid gap-1.5'}><Label className="text-[12.5px]">{label}</Label>{el}</div>

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{contract ? `${t('Contract')} ${contract.number}` : t('New contract')}</DialogTitle>
          <DialogDescription>{t('Only the supplier, the number and the start are needed; the rest as the contract says.')}</DialogDescription></DialogHeader>
        <fieldset disabled={!editable} className="grid gap-3 sm:grid-cols-2">
          {field(t('Supplier'), <SearchSelect value={f.vendor_id} onChange={(v) => set({ vendor_id: v })} options={(vendors.data ?? []).map((v) => ({ value: v.id, label: v.name, hint: v.tax_number ?? undefined }))} placeholder={t('Choose the supplier')} />, true)}
          {field(t('Number'), <Input value={f.number} onChange={(e) => set({ number: e.target.value })} placeholder="K-2026/01" />)}
          {field(t('Subject'), <Input value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder={t('e.g. Supply of dairy products')} />)}
          {field(t('From|date'), <Input type="date" value={f.start_date} onChange={(e) => set({ start_date: e.target.value })} />)}
          {field(t('To|date'), <Input type="date" value={f.end_date} min={f.start_date} onChange={(e) => set({ end_date: e.target.value })} />)}
          {field(t('Payment in days'), <Input inputMode="numeric" value={f.payment_days} onChange={(e) => set({ payment_days: e.target.value })} placeholder="30" />)}
          {field(t('Delivery in days'), <Input inputMode="numeric" value={f.delivery_days} onChange={(e) => set({ delivery_days: e.target.value })} placeholder="2" />)}
          {field(t('Rebate %'), <Input inputMode="decimal" value={f.rebate_pct} onChange={(e) => set({ rebate_pct: e.target.value })} placeholder="3" />)}
          {field(t('Minimum order'), <Input inputMode="decimal" value={f.min_order} onChange={(e) => set({ min_order: e.target.value })} />)}
          {field(t('When the rebate applies'), <Input value={f.rebate_terms} onChange={(e) => set({ rebate_terms: e.target.value })} placeholder={t('e.g. on the year\'s purchases above 50 000 €')} />, true)}
          <label className="flex items-center gap-2 text-[13px] sm:col-span-2"><Switch checked={f.returns_expired} onCheckedChange={(on) => set({ returns_expired: on })} /> {t('Takes back expired goods')}</label>
          {f.returns_expired && field(t('How expired goods go back'), <Input value={f.returns_terms} onChange={(e) => set({ returns_terms: e.target.value })} placeholder={t('e.g. credit note within 30 days, at the purchase price')} />, true)}
          {field(t('Other terms'), <Textarea rows={2} value={f.other_terms} onChange={(e) => set({ other_terms: e.target.value })} />, true)}
          {field(t('Remind before the end (days)'), <Input inputMode="numeric" value={f.remind_days} onChange={(e) => set({ remind_days: e.target.value })} />)}
          {field(t('Status'), <select className="h-9 rounded-md border bg-background px-2 text-[13px]" value={f.status} onChange={(e) => set({ status: e.target.value as Contract['status'] })}>
            {(Object.keys(STATUS) as Contract['status'][]).map((s) => <option key={s} value={s}>{t(STATUS[s])}</option>)}</select>)}
          <div className="grid gap-1.5 sm:col-span-2"><Label className="text-[12.5px]">{t('The signed contract')}</Label>
            <div className="flex flex-wrap items-center gap-2">
              {f.file_path && !file && <Button type="button" size="sm" variant="outline" onClick={() => void openFile()}><FileText /> {f.file_name ?? t('Open')}</Button>}
              <Input type="file" accept=".pdf,image/*,.doc,.docx" className="max-w-xs" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div></div>
        </fieldset>
        <DialogFooter><Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          {editable && <Button disabled={!ready} loading={save.isPending} onClick={() => save.mutate()}>{t('Save')}</Button>}</DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
