import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { CalendarRange, Plus, Trash2 } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { z } from 'zod'
import { Can, useCompany } from '@/app/company-provider'
import { ColumnHeader, DataTable, inFilter } from '@/components/data-table/data-table'
import { PageHeader } from '@/components/page-header'
import { SimpleFormDialog } from '@/components/simple-form-dialog'
import { StatCard } from '@/components/stat-card'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { msg, t, td } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { formatMoney, formatMonth, num, todayISO } from '@/lib/utils'
import { useWarehouses } from '@/features/inventory/api'

type Cost = { id: string; warehouse_id: string | null; month: string; kind: 'internal_rent' | 'allocation' | 'other'; description: string; amount: number; notes: string | null }
const KINDS: Record<Cost['kind'], string> = { internal_rent: msg('Internal rent'), allocation: msg('Share of shared costs'), other: msg('Other internal cost') }

const schema = z.object({
  month: z.string().trim().regex(/^\d{4}-(0[1-9]|1[0-2])$/, msg('Write the month as YYYY-MM')),
  warehouse_id: z.string().uuid().nullable().optional(),
  kind: z.enum(['internal_rent', 'allocation', 'other']),
  description: z.string().trim().min(2, msg('Enter a name')),
  amount: z.coerce.number().positive(),
  notes: z.string().trim().optional(),
})
type Values = z.infer<typeof schema>

/**
 * Internal costs (from the meeting with the staff, #2 option B): what no one is paid, but management needs
 * to see the true profit of a unit — the "rent" of a shop the company owns, a share of the office.
 * They show only in the management view of the profit report; they never reach the books or the taxes.
 */
export function ManagementCostsPage() {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  const whs = useWarehouses()
  const key = ['fin', companyId, 'management-costs']
  const q = useQuery({ queryKey: key, enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('management_costs').select('id, warehouse_id, month, kind, description, amount, notes')
      .eq('company_id', companyId!).is('deleted_at', null).order('month', { ascending: false }).order('description')) as unknown as Cost[] })
  const [edit, setEdit] = React.useState<Cost | 'new' | null>(null)
  const [repeat, setRepeat] = React.useState<Cost | null>(null)
  const save = useMutation({
    mutationFn: async (v: Values & { id?: string }) => {
      const row = { month: `${v.month}-01`, warehouse_id: v.warehouse_id || null, kind: v.kind, description: v.description, amount: v.amount, notes: v.notes || null }
      if (v.id) unwrap(await supabase.from('management_costs').update(row).eq('id', v.id))
      else unwrap(await supabase.from('management_costs').insert({ ...row, company_id: companyId! }))
    },
    onSuccess: () => { toast.success(t('Saved')); void qc.invalidateQueries({ queryKey: key }) },
  })
  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('management_costs').delete().eq('id', id)),
    onSuccess: () => { toast.success(t('Removed')); void qc.invalidateQueries({ queryKey: key }) },
    onError: (e) => toast.error(describeError(e)),
  })
  const whName = (id: string | null) => (id ? td((whs.data ?? []).find((w) => w.id === id)?.name ?? '') : t('Whole company'))
  const rows = q.data ?? []
  const month = todayISO().slice(0, 7)
  const year = month.slice(0, 4)

  const cols = React.useMemo<ColumnDef<Cost>[]>(() => [
    { id: 'month', accessorFn: (r) => r.month.slice(0, 7), header: ({ column }) => <ColumnHeader column={column} title={t('Month')} />, meta: { label: t('Month'), exportValue: (r) => r.month.slice(0, 7) },
      cell: ({ row: { original: r } }) => formatMonth(r.month.slice(0, 7)) },
    { id: 'unit', accessorFn: (r) => whName(r.warehouse_id), filterFn: inFilter, header: t('Unit|store'), meta: { label: t('Unit|store') } },
    { id: 'kind', accessorFn: (r) => r.kind, filterFn: inFilter, header: t('Kind|cost'), meta: { label: t('Kind|cost'), exportValue: (r) => t(KINDS[r.kind]) }, cell: ({ row: { original: r } }) => t(KINDS[r.kind]) },
    { accessorKey: 'description', header: ({ column }) => <ColumnHeader column={column} title={t('Description')} />, meta: { label: t('Description') }, cell: ({ getValue }) => <span className="font-medium">{getValue() as string}</span> },
    { accessorKey: 'amount', header: ({ column }) => <ColumnHeader column={column} title={t('Amount')} />, meta: { label: t('Amount'), align: 'right' }, cell: ({ getValue }) => <span className="tabular">{formatMoney(num(getValue()))}</span> },
    { id: 'act', enableHiding: false, header: '', meta: { label: '' }, cell: ({ row: { original: r } }) => (
      <Can perm="finance.write"><div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        <Button size="xs" variant="ghost" onClick={() => setRepeat(r)}><CalendarRange /> {t('Repeat')}</Button>
        <Button size="icon-sm" variant="ghost" aria-label={t('Remove')} onClick={() => remove.mutate(r.id)}><Trash2 /></Button>
      </div></Can>
    ) },
  ], [whs.data]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <PageHeader back={{ href: '/reports/profit', label: t('Profit report') }} title={t('Internal costs|menu')}
        description={t('Costs no one is paid, for management only: the rent of a shop the company owns, a share of the office. They show in the management view of the profit report and never reach the books or the taxes.')}
        actions={<Can perm="finance.write"><Button onClick={() => setEdit('new')}><Plus /> {t('Add a cost')}</Button></Can>} />
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label={t('This month')} value={formatMoney(rows.filter((r) => r.month.startsWith(month)).reduce((s, r) => s + num(r.amount), 0))} />
        <StatCard label={t('This year')} value={formatMoney(rows.filter((r) => r.month.startsWith(year)).reduce((s, r) => s + num(r.amount), 0))} />
        <div className="flex items-center rounded-lg border px-4 text-[13px]"><Link className="font-medium text-primary hover:underline" to="/reports/profit?view=management&by=unit">{t('See them in the profit report')}</Link></div>
      </div>
      <DataTable tableKey="finance.management-costs" columns={cols} data={rows} isLoading={q.isLoading} error={q.error} getRowId={(r) => r.id}
        searchPlaceholder={t('Description, unit…')} exportName={t('internal-costs')} onRowClick={(r) => setEdit(r)}
        facets={[
          { columnId: 'kind', title: t('Kind|cost'), options: (Object.keys(KINDS) as Cost['kind'][]).map((k) => ({ value: k, label: t(KINDS[k]) })) },
          { columnId: 'unit', title: t('Unit|store'), options: [...new Set(rows.map((r) => whName(r.warehouse_id)))].map((v) => ({ value: v, label: v })) },
        ]}
        empty={{ title: t('No internal costs yet'), description: t('Add the monthly rent of a shop the company owns, then repeat it for the months of the year.') }} />
      <SimpleFormDialog<Values> open={!!edit} onOpenChange={(o) => !o && setEdit(null)} schema={schema}
        title={edit === 'new' ? t('Add a cost') : edit ? edit.description : ''}
        defaultValues={edit && edit !== 'new' ? { month: edit.month.slice(0, 7), warehouse_id: edit.warehouse_id, kind: edit.kind, description: edit.description, amount: num(edit.amount), notes: edit.notes ?? '' }
          : { month, warehouse_id: null, kind: 'internal_rent', description: '', amount: 0, notes: '' }}
        fields={[
          { name: 'description', label: t('Description'), placeholder: t('e.g. Rent of the shop in the centre') },
          { name: 'kind', label: t('Kind|cost'), type: 'select', half: true, options: (Object.keys(KINDS) as Cost['kind'][]).map((k) => ({ value: k, label: t(KINDS[k]) })) },
          { name: 'warehouse_id', label: t('Unit|store'), type: 'select', half: true, optional: true, placeholder: t('Whole company'), options: (whs.data ?? []).map((w) => ({ value: w.id, label: td(w.name) })) },
          { name: 'month', label: t('Month'), half: true, placeholder: t('YYYY-MM|month format') },
          { name: 'amount', label: t('Amount'), type: 'number', half: true },
          { name: 'notes', label: t('Notes'), optional: true },
        ]}
        submitLabel={t('Save')} onSubmit={(v) => save.mutateAsync({ ...v, id: edit && edit !== 'new' ? edit.id : undefined })} />
      {repeat && <RepeatDialog cost={repeat} onClose={() => { setRepeat(null); void qc.invalidateQueries({ queryKey: key }) }} />}
    </>
  )
}

function RepeatDialog({ cost, onClose }: { cost: Cost; onClose: () => void }) {
  const [until, setUntil] = React.useState(`${cost.month.slice(0, 4)}-12`)
  const run = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('management_costs_repeat', { p_id: cost.id, p_until: `${until}-01` })) as number,
    onSuccess: (n) => { toast.success(n ? t('{n} months added', { n }) : t('Those months have it already')); onClose() },
    onError: (e) => toast.error(describeError(e)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>{t('Repeat every month')}</DialogTitle>
          <DialogDescription>{t('{name}, {amount} a month, from {month} until the month chosen. Months that have it already are skipped.', { name: cost.description, amount: formatMoney(num(cost.amount)), month: formatMonth(cost.month.slice(0, 7)) })}</DialogDescription></DialogHeader>
        <div className="grid gap-1.5"><Label htmlFor="mc-until">{t('Until')}</Label><Input id="mc-until" type="month" value={until} min={cost.month.slice(0, 7)} onChange={(e) => setUntil(e.target.value)} /></div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button><Button loading={run.isPending} disabled={!until || until <= cost.month.slice(0, 7)} onClick={() => run.mutate()}>{t('Repeat')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
