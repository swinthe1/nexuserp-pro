import { Pencil, Plus, Trash2 } from 'lucide-react'
import * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { z } from 'zod'
import { Can, useCompany } from '@/app/company-provider'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { PageHeader } from '@/components/page-header'
import { SimpleFormDialog } from '@/components/simple-form-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ContractSetup } from '../components/contract-setup'
import { t, td } from '@/i18n'
import { formatDateWith } from '@/i18n/format'
import { formatQty } from '@/lib/utils'
import { useCostCenters } from '@/features/finance/api'
import {
  useDeleteMaster, useDepartments, useEmployees, useHolidays, useLeaveTypes, usePositions, useSaveMaster,
  type Department, type Holiday, type LeaveType, type Position,
} from '../api'

const NONE = '__none'
const opt = (s: string | null | undefined) => (s && s !== NONE ? s : null)

export function HrSetupPage() {
  const { can } = useCompany()
  const [params] = useSearchParams()
  return (
    <>
      <PageHeader back={{ href: '/hr', label: t('People') }} title={t('HR setup')} description={t('Departments, job positions, leave types, public holidays and contract models.')} />
      <Tabs defaultValue={params.get('tab') ?? 'departments'}>
        <TabsList><TabsTrigger value="departments">{t('Departments')}</TabsTrigger><TabsTrigger value="positions">{t('Positions')}</TabsTrigger>
          <TabsTrigger value="leave">{t('Leave types')}</TabsTrigger><TabsTrigger value="holidays">{t('Public holidays')}</TabsTrigger>
          {can('payroll.read') && <TabsTrigger value="contracts">{t('Contracts|hr')}</TabsTrigger>}</TabsList>
        <TabsContent value="departments"><Departments /></TabsContent>
        <TabsContent value="positions"><Positions /></TabsContent>
        <TabsContent value="leave"><LeaveTypes /></TabsContent>
        <TabsContent value="holidays"><Holidays /></TabsContent>
        {can('payroll.read') && <TabsContent value="contracts"><ContractSetup /></TabsContent>}
      </Tabs>
    </>
  )
}

function Shell({ title, description, add, children }: { title: string; description: string; add: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 py-3">
        <div><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></div>
        <Can perm="hr.write">{add}</Can>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">{children}</CardContent>
    </Card>
  )
}
function RowActions({ onEdit, onDelete, what }: { onEdit: () => void; onDelete: () => Promise<unknown>; what: string }) {
  const { can } = useCompany()
  if (!can('hr.write')) return null
  return (
    <div className="flex justify-end gap-1">
      <Button size="icon-sm" variant="ghost" aria-label={t('Edit {name}', { name: what })} onClick={onEdit}><Pencil /></Button>
      <ConfirmDialog trigger={<Button size="icon-sm" variant="ghost" aria-label={t('Delete {name}', { name: what })}><Trash2 /></Button>} title={t('Delete {name}?', { name: what })}
        description={t('It can only be deleted while nothing uses it.')} confirmLabel={t('Delete')} destructive onConfirm={onDelete} />
    </div>
  )
}

const depSchema = z.object({ code: z.string().optional().nullable(), name: z.string().trim().min(1, 'Name it'), manager_id: z.string().nullable().optional(), cost_center_id: z.string().nullable().optional() })
function Departments() {
  const deps = useDepartments(); const emps = useEmployees(); const ccs = useCostCenters()
  const save = useSaveMaster('departments'); const del = useDeleteMaster('departments')
  const [edit, setEdit] = React.useState<Department | 'new' | null>(null)
  const d = edit && edit !== 'new' ? edit : null
  return (
    <Shell title={t('Departments')} description={t('Salaries are booked on the department\'s cost center unless the employee has their own.')} add={<Button size="sm" onClick={() => setEdit('new')}><Plus /> {t('New department')}</Button>}>
      <Table><TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Code')}</TableHead><TableHead>{t('Name')}</TableHead><TableHead>{t('Manager')}</TableHead><TableHead>{t('Cost center')}</TableHead><TableHead className="w-[1%]" /></TableRow></TableHeader>
        <TableBody>{(deps.data ?? []).map((x) => (
          <TableRow key={x.id}><TableCell className="text-muted-foreground">{x.code ?? '—'}</TableCell><TableCell className="font-medium">{td(x.name)}</TableCell>
            <TableCell>{emps.data?.find((e) => e.id === x.manager_id)?.full_name ?? '—'}</TableCell>
            <TableCell>{td(ccs.data?.find((c) => c.id === x.cost_center_id)?.name) || '—'}</TableCell>
            <TableCell><RowActions what={td(x.name)} onEdit={() => setEdit(x)} onDelete={() => del.mutateAsync(x.id)} /></TableCell></TableRow>))}</TableBody></Table>
      <SimpleFormDialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)} title={d ? t('Edit department') : t('New department')} schema={depSchema} submitLabel={t('Save')}
        defaultValues={{ code: d?.code ?? '', name: d?.name ?? '', manager_id: d?.manager_id ?? NONE, cost_center_id: d?.cost_center_id ?? NONE }}
        fields={[{ name: 'code', label: t('Code'), half: true, optional: true, uppercase: true }, { name: 'name', label: t('Name'), half: true },
          { name: 'manager_id', label: t('Manager'), type: 'select', options: [{ value: NONE, label: t('None') }, ...(emps.data ?? []).map((e) => ({ value: e.id, label: e.full_name }))] },
          { name: 'cost_center_id', label: t('Cost center'), type: 'select', options: [{ value: NONE, label: t('None') }, ...(ccs.data ?? []).map((c) => ({ value: c.id, label: `${c.code} ${td(c.name)}` }))] }]}
        onSubmit={async (v) => { await save.mutateAsync({ id: d?.id, code: v.code || null, name: v.name, manager_id: opt(v.manager_id), cost_center_id: opt(v.cost_center_id) }); toast.success(t('Department saved')) }} />
    </Shell>
  )
}

const posSchema = z.object({ title: z.string().trim().min(1, 'Name it'), department_id: z.string().nullable().optional(), description: z.string().optional().nullable() })
function Positions() {
  const pos = usePositions(); const deps = useDepartments()
  const save = useSaveMaster('job_positions'); const del = useDeleteMaster('job_positions')
  const [edit, setEdit] = React.useState<Position | 'new' | null>(null)
  const p = edit && edit !== 'new' ? edit : null
  return (
    <Shell title={t('Positions')} description={t('Job titles, shown on payslips and the payroll list for the tax office.')} add={<Button size="sm" onClick={() => setEdit('new')}><Plus /> {t('New position')}</Button>}>
      <Table><TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Title')}</TableHead><TableHead>{t('Department')}</TableHead><TableHead>{t('Description')}</TableHead><TableHead className="w-[1%]" /></TableRow></TableHeader>
        <TableBody>{(pos.data ?? []).map((x) => (
          <TableRow key={x.id}><TableCell className="font-medium">{td(x.title)}</TableCell><TableCell>{td(deps.data?.find((d) => d.id === x.department_id)?.name) || '—'}</TableCell>
            <TableCell className="text-muted-foreground">{x.description ?? ''}</TableCell>
            <TableCell><RowActions what={x.title} onEdit={() => setEdit(x)} onDelete={() => del.mutateAsync(x.id)} /></TableCell></TableRow>))}</TableBody></Table>
      <SimpleFormDialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)} title={p ? t('Edit position') : t('New position')} schema={posSchema} submitLabel={t('Save')}
        defaultValues={{ title: p?.title ?? '', department_id: p?.department_id ?? NONE, description: p?.description ?? '' }}
        fields={[{ name: 'title', label: t('Title') },
          { name: 'department_id', label: t('Department'), type: 'select', options: [{ value: NONE, label: t('None') }, ...(deps.data ?? []).map((d) => ({ value: d.id, label: td(d.name) }))] },
          { name: 'description', label: t('Description'), optional: true }]}
        onSubmit={async (v) => { await save.mutateAsync({ id: p?.id, title: v.title, department_id: opt(v.department_id), description: v.description || null }); toast.success(t('Position saved')) }} />
    </Shell>
  )
}

const ltSchema = z.object({ name: z.string().trim().min(1, 'Name it'), days_per_year: z.coerce.number().min(0).max(366), is_paid: z.boolean(), requires_document: z.boolean(), is_active: z.boolean() })
function LeaveTypes() {
  const lt = useLeaveTypes()
  const save = useSaveMaster('leave_types'); const del = useDeleteMaster('leave_types')
  const [edit, setEdit] = React.useState<LeaveType | 'new' | null>(null)
  const lt0 = edit && edit !== 'new' ? edit : null
  return (
    <Shell title={t('Leave types')} description={t('Days per year limits how much leave people can take; 0 means no yearly limit (sick leave, maternity). Unpaid leave reduces pay.')}
      add={<Button size="sm" onClick={() => setEdit('new')}><Plus /> {t('New leave type')}</Button>}>
      <Table><TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Name')}</TableHead><TableHead className="text-right">{t('Days per year')}</TableHead><TableHead>{t('Pay')}</TableHead><TableHead>{t('Document')}</TableHead><TableHead /><TableHead className="w-[1%]" /></TableRow></TableHeader>
        <TableBody>{(lt.data ?? []).map((x) => (
          <TableRow key={x.id}><TableCell className="font-medium">{td(x.name)}</TableCell><TableCell className="text-right tabular">{Number(x.days_per_year) ? formatQty(x.days_per_year) : t('No limit')}</TableCell>
            <TableCell>{x.is_paid ? t('Paid') : <Badge variant="warning">{t('Unpaid')}</Badge>}</TableCell><TableCell>{x.requires_document ? t('Required') : '—'}</TableCell>
            <TableCell>{!x.is_active && <Badge variant="secondary">{t('Inactive')}</Badge>}</TableCell>
            <TableCell><RowActions what={td(x.name)} onEdit={() => setEdit(x)} onDelete={() => del.mutateAsync(x.id)} /></TableCell></TableRow>))}</TableBody></Table>
      <SimpleFormDialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)} title={lt0 ? t('Edit leave type') : t('New leave type')} schema={ltSchema} submitLabel={t('Save')}
        defaultValues={{ name: lt0?.name ?? '', days_per_year: Number(lt0?.days_per_year ?? 0), is_paid: lt0?.is_paid ?? true, requires_document: lt0?.requires_document ?? false, is_active: lt0?.is_active ?? true }}
        fields={[{ name: 'name', label: t('Name') }, { name: 'days_per_year', label: t('Days per year'), type: 'number', description: t('Working days; 0 for no yearly limit') },
          { name: 'is_paid', label: t('Paid'), type: 'switch' }, { name: 'requires_document', label: t('Needs a document'), type: 'switch' }, { name: 'is_active', label: t('Active'), type: 'switch' }]}
        onSubmit={async (v) => { await save.mutateAsync({ id: lt0?.id, ...v }); toast.success(t('Leave type saved')) }} />
    </Shell>
  )
}

const holSchema = z.object({ holiday_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'), name: z.string().trim().min(1, 'Name it') })
function Holidays() {
  const hol = useHolidays()
  const save = useSaveMaster('public_holidays'); const del = useDeleteMaster('public_holidays')
  const [edit, setEdit] = React.useState<Holiday | 'new' | null>(null)
  const h = edit && edit !== 'new' ? edit : null
  const years = [...new Set((hol.data ?? []).map((x) => x.holiday_date.slice(0, 4)))]
  return (
    <Shell title={t('Public holidays')} description={t('Days off on weekdays: they do not count as leave or as working days. When a holiday falls on a weekend, enter the day it moves to.')}
      add={<Button size="sm" onClick={() => setEdit('new')}><Plus /> {t('Add holiday')}</Button>}>
      <Table><TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Date')}</TableHead><TableHead>{t('Day')}</TableHead><TableHead>{t('Holiday')}</TableHead><TableHead className="w-[1%]" /></TableRow></TableHeader>
        <TableBody>{years.map((y) => (
          <React.Fragment key={y}>
            <TableRow className="hover:bg-transparent"><TableCell colSpan={4} className="bg-muted/40 py-1.5 text-xs font-medium text-muted-foreground">{y}</TableCell></TableRow>
            {(hol.data ?? []).filter((x) => x.holiday_date.startsWith(y)).map((x) => (
              <TableRow key={x.id}><TableCell className="tabular">{formatDateWith(new Date(`${x.holiday_date}T00:00:00`), { day: '2-digit', month: 'short' })}</TableCell>
                <TableCell className="text-muted-foreground">{formatDateWith(new Date(`${x.holiday_date}T00:00:00`), { weekday: 'long' })}</TableCell>
                <TableCell>{td(x.name)}</TableCell><TableCell><RowActions what={td(x.name)} onEdit={() => setEdit(x)} onDelete={() => del.mutateAsync(x.id)} /></TableCell></TableRow>))}
          </React.Fragment>))}</TableBody></Table>
      <SimpleFormDialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)} title={h ? t('Edit holiday') : t('Add a public holiday')} schema={holSchema} submitLabel={t('Save')}
        defaultValues={{ holiday_date: h?.holiday_date ?? '', name: h?.name ?? '' }}
        fields={[{ name: 'holiday_date', label: t('Date'), placeholder: t('YYYY-MM-DD'), half: true }, { name: 'name', label: t('Name'), half: true }]}
        onSubmit={async (v) => { await save.mutateAsync({ id: h?.id, ...v }); toast.success(t('Holiday saved')) }} />
    </Shell>
  )
}
