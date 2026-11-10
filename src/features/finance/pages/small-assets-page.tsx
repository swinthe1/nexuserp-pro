import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { Plus, Printer, ScanLine } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { z } from 'zod/v3'
import { Can, useCompany } from '@/app/company-provider'
import { ColumnHeader, DataTable, inFilter } from '@/components/data-table/data-table'
import { PageHeader } from '@/components/page-header'
import { ScanInput, scanFeedback } from '@/components/scan-input'
import { SimpleFormDialog } from '@/components/simple-form-dialog'
import { StatCard } from '@/components/stat-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { msg, t, td } from '@/i18n'
import { barsSvg, encode } from '@/lib/barcode'
import { describeError, unwrap } from '@/lib/errors'
import { printHtml } from '@/lib/print'
import { supabase } from '@/lib/supabase'
import { formatDate, formatMoney, formatQty, num, todayISO } from '@/lib/utils'
import { useWarehouses } from '@/features/inventory/api'
import { useMembers } from '@/features/sales/api'

type Asset = { id: string; code: string; name: string; category: string | null; warehouse_id: string | null; holder_id: string | null; quantity: number; unit_value: number
  acquired_on: string | null; serial_no: string | null; status: 'in_use' | 'in_store' | 'broken' | 'written_off'; notes: string | null; counted_at: string | null }
const STATUS: Record<Asset['status'], string> = { in_use: msg('In use'), in_store: msg('In storage'), broken: msg('Broken'), written_off: msg('Written off') }

const schema = z.object({
  name: z.string().trim().min(2, msg('Enter a name')),
  code: z.string().trim().max(30).optional(),
  category: z.string().trim().optional(),
  warehouse_id: z.string().uuid().nullable().optional(),
  holder_id: z.string().uuid().nullable().optional(),
  quantity: z.coerce.number().positive(),
  unit_value: z.coerce.number().nonnegative(),
  acquired_on: z.string().optional(),
  serial_no: z.string().trim().optional(),
  status: z.enum(['in_use', 'in_store', 'broken', 'written_off']),
})
type Values = z.infer<typeof schema>

/**
 * The small inventory (from the meeting with the staff): what the company owns and does not sell,
 * without depreciation (fridges' shelves, scales, chairs, tools): where each one is, who has it,
 * what it is worth; a label with a barcode, and the yearly count by scanning.
 */
export function SmallAssetsPage() {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  const whs = useWarehouses()
  const people = useMembers()
  const key = ['fin', companyId, 'small-assets']
  const q = useQuery({ queryKey: key, enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('small_assets' as never).select('*').eq('company_id', companyId!).is('deleted_at', null).order('code')) as unknown as Asset[] })
  const [edit, setEdit] = React.useState<Asset | 'new' | null>(null)
  const [counting, setCounting] = React.useState(false)
  const save = useMutation({
    mutationFn: async (v: Values & { id?: string }) => {
      const row = { ...v, code: v.code || undefined, category: v.category || null, acquired_on: v.acquired_on || null, serial_no: v.serial_no || null, company_id: companyId }
      if (v.id) unwrap(await supabase.from('small_assets' as never).update(row as never).eq('id', v.id))
      else unwrap(await supabase.from('small_assets' as never).insert(row as never))
    },
    onSuccess: () => { toast.success(t('Saved')); void qc.invalidateQueries({ queryKey: key }) },
  })
  const whName = (id: string | null) => td((whs.data ?? []).find((w) => w.id === id)?.name ?? '')
  const personName = (id: string | null) => (people.data ?? []).find((p) => p.id === id)?.full_name ?? ''
  const rows = q.data ?? []
  const live = rows.filter((r) => r.status !== 'written_off')
  const year = todayISO().slice(0, 4)

  const cols = React.useMemo<ColumnDef<Asset>[]>(() => [
    { accessorKey: 'code', header: ({ column }) => <ColumnHeader column={column} title={t('Code')} />, meta: { label: t('Code') }, cell: ({ getValue }) => <span className="font-mono text-[12.5px]">{getValue() as string}</span> },
    { accessorKey: 'name', header: ({ column }) => <ColumnHeader column={column} title={t('Name')} />, meta: { label: t('Name') }, cell: ({ row: { original: r } }) => <span className="font-medium">{r.name}{r.serial_no && <span className="ml-1.5 text-[12px] font-normal text-muted-foreground">{r.serial_no}</span>}</span> },
    { accessorKey: 'category', filterFn: inFilter, header: t('Category'), meta: { label: t('Category') } },
    { id: 'unit', accessorFn: (r) => whName(r.warehouse_id), filterFn: inFilter, header: t('Unit|store'), meta: { label: t('Unit|store') } },
    { id: 'holder', accessorFn: (r) => personName(r.holder_id), filterFn: inFilter, header: t('Held by'), meta: { label: t('Held by') } },
    { accessorKey: 'quantity', header: t('Quantity'), meta: { label: t('Quantity'), align: 'right' }, cell: ({ getValue }) => <span className="tabular">{formatQty(num(getValue()))}</span> },
    { id: 'value', accessorFn: (r) => num(r.quantity) * num(r.unit_value), header: ({ column }) => <ColumnHeader column={column} title={t('Value')} />, meta: { label: t('Value'), align: 'right' }, cell: ({ getValue }) => <span className="tabular">{formatMoney(num(getValue()))}</span> },
    { accessorKey: 'acquired_on', header: t('Since'), meta: { label: t('Since') }, cell: ({ getValue }) => formatDate(getValue() as string) },
    { id: 'status', accessorFn: (r) => r.status, filterFn: inFilter, header: t('Status'), meta: { label: t('Status') },
      cell: ({ row: { original: r } }) => <Badge variant={r.status === 'in_use' ? 'outline' : r.status === 'broken' ? 'warning' : 'secondary'}>{t(STATUS[r.status])}</Badge> },
    { accessorKey: 'counted_at', header: t('Last counted'), meta: { label: t('Last counted') },
      cell: ({ getValue }) => { const v = getValue() as string | null; return <span className={v && v.slice(0, 4) === year ? '' : 'text-warning'}>{v ? formatDate(v) : t('Never')}</span> } },
  ], [whs.data, people.data]) // eslint-disable-line react-hooks/exhaustive-deps

  const printLabels = (list: Asset[]) => {
    const body = `<div class="sheet">${list.map((a) => { const b = encode(a.code); return `<div class="lab"><div class="n">${esc(a.name)}</div>${b ? `<div class="b">${barsSvg(b)}</div>` : ''}<div class="c">${esc(a.code)}</div></div>` }).join('')}</div>`
    printHtml(body, `@page { size: A4; margin: 8mm } .sheet { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm }
      .lab { border: .3mm dashed #bbb; padding: 3mm; height: 28mm; display: flex; flex-direction: column; justify-content: space-between; font: 8pt Arial, sans-serif; page-break-inside: avoid }
      .n { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis } .b { height: 12mm } .b svg { width: 100%; height: 100% } .c { text-align: center; font: 9pt monospace; letter-spacing: .5pt }`)
  }

  return (
    <>
      <PageHeader title={t('Small inventory|menu')}
        description={t('What the company owns and does not sell, without depreciation: where each thing is, who has it and what it is worth. A label with a barcode for each, and the yearly count by scanning.')}
        actions={<>
          <Can perm="finance.write"><Button variant="outline" onClick={() => setCounting(true)}><ScanLine /> {t('Count by scanning')}</Button></Can>
          <Can perm="finance.write"><Button onClick={() => setEdit('new')}><Plus /> {t('Add a thing')}</Button></Can>
        </>} />
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t('Things in use')} value={String(live.length)} />
        <StatCard label={t('Their value')} value={formatMoney(live.reduce((s, r) => s + num(r.quantity) * num(r.unit_value), 0))} />
        <StatCard label={t('Counted this year')} value={`${live.filter((r) => r.counted_at?.slice(0, 4) === year).length} / ${live.length}`} />
        <StatCard label={t('Broken')} value={String(rows.filter((r) => r.status === 'broken').length)} />
      </div>
      <DataTable tableKey="finance.small-assets" columns={cols} data={rows} isLoading={q.isLoading} error={q.error} getRowId={(r) => r.id}
        searchPlaceholder={t('Code, name, serial number…')} exportName={t('small-inventory')} onRowClick={(r) => setEdit(r)}
        facets={[
          { columnId: 'status', title: t('Status'), options: (Object.keys(STATUS) as Asset['status'][]).map((s) => ({ value: s, label: t(STATUS[s]) })) },
          { columnId: 'unit', unit: true, title: t('Unit|store'), options: [...new Set(rows.map((r) => whName(r.warehouse_id)).filter(Boolean))].map((v) => ({ value: v, label: v })) },
          { columnId: 'category', title: t('Category'), options: [...new Set(rows.map((r) => r.category ?? '').filter(Boolean))].map((v) => ({ value: v, label: v })) },
        ]}
        bulkActions={(sel) => <Button size="xs" variant="outline" onClick={() => printLabels(sel.map((r) => r.original))}><Printer /> {t('Print labels')}</Button>}
        empty={{ title: t('Nothing recorded yet'), description: t('Add the shelves, scales, chairs and tools of each unit, with who has them.') }} />
      <SimpleFormDialog<Values> open={!!edit} onOpenChange={(o) => !o && setEdit(null)} schema={schema}
        title={edit === 'new' ? t('Add a thing') : edit ? `${edit.code} · ${edit.name}` : ''}
        defaultValues={edit && edit !== 'new' ? { name: edit.name, code: edit.code, category: edit.category ?? '', warehouse_id: edit.warehouse_id, holder_id: edit.holder_id,
          quantity: num(edit.quantity), unit_value: num(edit.unit_value), acquired_on: edit.acquired_on ?? '', serial_no: edit.serial_no ?? '', status: edit.status }
          : { name: '', code: '', category: '', warehouse_id: null, holder_id: null, quantity: 1, unit_value: 0, acquired_on: todayISO(), serial_no: '', status: 'in_use' }}
        fields={[
          { name: 'name', label: t('Name') },
          { name: 'code', label: t('Code'), optional: true, half: true, placeholder: t('Assigned automatically'), uppercase: true },
          { name: 'category', label: t('Category'), optional: true, half: true, placeholder: t('e.g. Furniture, Tools') },
          { name: 'warehouse_id', label: t('Unit|store'), type: 'select', half: true, optional: true, options: (whs.data ?? []).map((w) => ({ value: w.id, label: td(w.name) })) },
          { name: 'holder_id', label: t('Held by'), type: 'select', half: true, optional: true, options: (people.data ?? []).map((p) => ({ value: p.id, label: p.full_name ?? p.email ?? '' })) },
          { name: 'quantity', label: t('Quantity'), type: 'number', half: true },
          { name: 'unit_value', label: t('Value of one'), type: 'number', half: true },
          { name: 'acquired_on', label: t('Since'), half: true, optional: true, placeholder: t('YYYY-MM-DD|date format') },
          { name: 'serial_no', label: t('Serial number'), half: true, optional: true },
          { name: 'status', label: t('Status'), type: 'select', options: (Object.keys(STATUS) as Asset['status'][]).map((s) => ({ value: s, label: t(STATUS[s]) })) },
        ]}
        submitLabel={t('Save')} onSubmit={(v) => save.mutateAsync({ ...v, id: edit && edit !== 'new' ? edit.id : undefined })} />
      {counting && <CountDialog onClose={() => { setCounting(false); void qc.invalidateQueries({ queryKey: key }) }} />}
    </>
  )
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** the yearly count: scan each label in the unit; a thing found in another unit is moved here */
function CountDialog({ onClose }: { onClose: () => void }) {
  const { companyId } = useCompany()
  const whs = useWarehouses()
  const [wh, setWh] = React.useState<string>('')
  const [seen, setSeen] = React.useState<{ code: string; name: string; moved: boolean }[]>([])
  const [status, setStatus] = React.useState<{ tone: 'ok' | 'error' | 'info'; text: string } | null>(null)
  const onScan = async (code: string) => {
    try {
      const r = unwrap(await supabase.rpc('small_asset_count' as never, { p_company: companyId, p_code: code, p_warehouse: wh || null } as never)) as unknown as { found: boolean; name?: string; moved?: boolean; from?: string }
      if (!r.found) { scanFeedback('error'); setStatus({ tone: 'error', text: t('Unknown code “{code}”', { code }) }); return }
      scanFeedback('ok'); setSeen((s) => [{ code: code.toUpperCase(), name: r.name ?? '', moved: !!r.moved }, ...s.filter((x) => x.code !== code.toUpperCase())])
      setStatus({ tone: 'ok', text: r.moved ? t('{name}: was at {from}, now here', { name: r.name ?? '', from: td(r.from ?? '') }) : t('{name}: counted', { name: r.name ?? '' }) })
    } catch (e) { scanFeedback('error'); setStatus({ tone: 'error', text: describeError(e) }) }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{t('Count by scanning')}</DialogTitle><DialogDescription>{t('Choose the unit you are in and scan each label. A thing found here that was recorded elsewhere is moved here.')}</DialogDescription></DialogHeader>
        <Select value={wh} onValueChange={setWh}><SelectTrigger aria-label={t('Unit|store')}><SelectValue placeholder={t('Choose the store')} /></SelectTrigger>
          <SelectContent>{(whs.data ?? []).map((w) => <SelectItem key={w.id} value={w.id}>{td(w.name)}</SelectItem>)}</SelectContent></Select>
        <ScanInput onScan={(c) => void onScan(c)} status={status} placeholder={t('Scan the label')} />
        {seen.length > 0 && <div className="grid max-h-60 gap-1 overflow-y-auto text-[13px]">
          {seen.map((s) => <div key={s.code} className="flex justify-between rounded border px-2 py-1"><span>{s.name}</span><span className="font-mono text-muted-foreground">{s.code}{s.moved ? ' ↦' : ''}</span></div>)}
        </div>}
      </DialogContent>
    </Dialog>
  )
}
