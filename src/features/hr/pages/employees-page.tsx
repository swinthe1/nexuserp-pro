import type { ColumnDef } from '@tanstack/react-table'
import { Pencil, Plus, Settings2, Upload } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Can, useCompany } from '@/app/company-provider'
import { ColumnHeader, DataTable, inFilter } from '@/components/data-table/data-table'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { SearchSelect } from '@/components/search-select'
import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DeductionsCard } from '../components/deductions-card'
import { ErrorState } from '@/components/error-state'
import { msg, t, td } from '@/i18n'
import { formatDateWith } from '@/i18n/format'
import { cn, formatDate, formatMoney, formatMonth, formatQty, humanize, num, todayISO } from '@/lib/utils'
import { useCostCenters } from '@/features/finance/api'
import {
  useAttendanceRecords, useContracts, useDepartments, useEmployee, useEmployeePayslips, useEmployees, useLeaveBalances, useLeaveRequests,
  usePositions, useProfiles, useSaveContract, useSaveEmployee, type Contract, type EmployeeRow,
} from '../api'
import { PayslipDialog } from '../components/payslip'

/* ================================================================== list */
export function EmployeesPage() {
  const navigate = useNavigate()
  const emps = useEmployees()
  const deps = useDepartments()
  const pos = usePositions()
  const cols = React.useMemo<ColumnDef<EmployeeRow>[]>(() => [
    { accessorKey: 'full_name', enableHiding: false, header: ({ column }) => <ColumnHeader column={column} title={t('Name')} />, meta: { label: t('Name') },
      cell: ({ row: { original: e } }) => <span><span className="font-medium">{e.full_name}</span> <span className="text-xs text-muted-foreground">{e.number}</span></span> },
    { id: 'department', accessorFn: (e) => e.department?.name ?? '—', filterFn: inFilter, header: ({ column }) => <ColumnHeader column={column} title={t('Department')} />, meta: { label: t('Department') }, cell: ({ getValue }) => td(getValue() as string) },
    { id: 'position', accessorFn: (e) => e.position?.title ?? '—', filterFn: inFilter, header: t('Position'), meta: { label: t('Position') }, cell: ({ getValue }) => td(getValue() as string) },
    { id: 'manager', accessorFn: (e) => e.manager?.full_name ?? '', header: t('Manager'), meta: { label: t('Manager') } },
    { accessorKey: 'hire_date', header: ({ column }) => <ColumnHeader column={column} title={t('Hired')} />, meta: { label: t('Hired') }, cell: ({ getValue }) => formatDate(getValue() as string) },
    { accessorKey: 'employment_type', filterFn: inFilter, header: t('Type'), meta: { label: t('Type') }, cell: ({ getValue }) => humanize(getValue() as string) },
    { accessorKey: 'employment_status', filterFn: inFilter, header: t('Status'), meta: { label: t('Status') }, cell: ({ getValue }) => <StatusBadge status={getValue() as string} /> },
    { accessorKey: 'email', header: t('Email'), meta: { label: t('Email') } },
    { accessorKey: 'phone', header: t('Phone'), meta: { label: t('Phone') } },
    { accessorKey: 'personal_number', header: t('Personal no.'), meta: { label: t('Personal number') } },
  ], [])
  return (
    <>
      <PageHeader title={t('Employees')} description={t('Everyone who works here, with their department, manager and contract.')}
        actions={<>
          <Button variant="outline" asChild><Link to="/hr/setup"><Settings2 /> {t('HR setup')}</Link></Button>
          <Can perm="hr.write"><Button variant="outline" asChild><Link to="/settings/import?kind=employees"><Upload /> {t('Import')}</Link></Button><Button asChild><Link to="/hr/employees/new"><Plus /> {t('New employee')}</Link></Button></Can>
        </>} />
      <DataTable tableKey="hr.employees" columns={cols} data={emps.data} isLoading={emps.isLoading} error={emps.error} getRowId={(r) => r.id} exportName="employees"
        searchPlaceholder={t('Name, number, email…')} onRowClick={(r) => navigate(`/hr/employees/${r.id}`)} initialHidden={['email', 'phone', 'personal_number']}
        initialFilters={[{ id: 'employment_status', value: ['active', 'on_leave'] }]}
        facets={[
          { columnId: 'department', title: t('Department'), options: [...(deps.data ?? []).map((d) => ({ value: d.name, label: td(d.name) })), { value: '—', label: t('No department') }] },
          { columnId: 'position', title: t('Position'), options: (pos.data ?? []).map((p) => ({ value: p.title, label: td(p.title) })) },
          { columnId: 'employment_status', title: t('Status'), options: ['active', 'on_leave', 'terminated'].map((s) => ({ value: s, label: humanize(s) })) },
        ]}
        empty={{ title: t('No employees yet'), description: t('Add people one by one, or import a list from a file.'), action: <Can perm="hr.write"><Button size="sm" asChild><Link to="/hr/employees/new"><Plus /> {t('New employee')}</Link></Button></Can> }} />
    </>
  )
}

/* ================================================================== detail */
export function EmployeePage() {
  const { id } = useParams()
  const e = useEmployee(id)
  if (id && e.isLoading) return <Skeleton className="h-96" />
  if (id && e.isError) return <ErrorState error={e.error} onRetry={() => void e.refetch()} />
  if (id && !e.data) return <EmptyState title={t('Employee not found')} description={t('It may have been removed, or you cannot see it.')} action={<Button variant="outline" size="sm" asChild><Link to="/hr/employees">{t('Back to employees')}</Link></Button>} />
  return <EmployeeForm key={e.data?.updated_at ?? 'new'} emp={e.data ?? undefined} />
}

const blank = (s: string | null | undefined) => s ?? ''
function EmployeeForm({ emp }: { emp?: EmployeeRow }) {
  const navigate = useNavigate()
  const { can } = useCompany()
  const deps = useDepartments()
  const pos = usePositions()
  const emps = useEmployees()
  const ccs = useCostCenters()
  const profiles = useProfiles()
  const save = useSaveEmployee()
  const editable = can('hr.write')
  const [v, setV] = React.useState(() => ({
    first_name: blank(emp?.first_name), last_name: blank(emp?.last_name), personal_number: blank(emp?.personal_number), date_of_birth: blank(emp?.date_of_birth),
    gender: emp?.gender ?? null as string | null, email: blank(emp?.email), phone: blank(emp?.phone), address: blank(emp?.address),
    department_id: emp?.department_id ?? null as string | null, position_id: emp?.position_id ?? null as string | null, manager_id: emp?.manager_id ?? null as string | null,
    hire_date: emp?.hire_date ?? todayISO(), termination_date: blank(emp?.termination_date), employment_status: emp?.employment_status ?? 'active',
    employment_type: emp?.employment_type ?? 'full_time', bank_name: blank(emp?.bank_name), iban: blank(emp?.iban), cost_center_id: emp?.cost_center_id ?? null as string | null,
    user_id: emp?.user_id ?? null as string | null,
  }))
  const set = <K extends keyof typeof v>(k: K) => (x: (typeof v)[K]) => setV((s) => ({ ...s, [k]: x }))
  const valid = v.first_name.trim() && v.last_name.trim() && v.hire_date && (!v.termination_date || v.termination_date >= v.hire_date)
  const submit = async () => {
    const id = await save.mutateAsync({
      id: emp?.id, first_name: v.first_name.trim(), last_name: v.last_name.trim(), personal_number: v.personal_number.trim().toUpperCase() || null,
      date_of_birth: v.date_of_birth || null, gender: v.gender, email: v.email.trim() || null, phone: v.phone.trim() || null, address: v.address.trim() || null,
      department_id: v.department_id, position_id: v.position_id, manager_id: v.manager_id, hire_date: v.hire_date, termination_date: v.termination_date || null,
      employment_status: v.employment_status, employment_type: v.employment_type, bank_name: v.bank_name.trim() || null,
      iban: v.iban.replace(/\s+/g, '').toUpperCase() || null, cost_center_id: v.cost_center_id, user_id: v.user_id,
    })
    toast.success(emp ? t('Employee saved') : t('Employee added'))
    if (!emp) navigate(`/hr/employees/${id}`, { replace: true })
  }
  const field = (k: keyof typeof v, label: string, type = 'text', span = '') => (
    <div className={cn('grid gap-1.5', span)}><Label htmlFor={`emp-${k}`}>{t(label)}</Label>
      <Input id={`emp-${k}`} type={type} value={v[k] as string} disabled={!editable} onChange={(e) => set(k)(e.target.value as never)} /></div>
  )
  const profileForm = (
    <Card>
      <CardContent className="grid gap-4 p-4 sm:grid-cols-3">
        {field('first_name', msg('First name'))}{field('last_name', msg('Last name'))}{field('personal_number', msg('Personal number'))}
        {field('date_of_birth', msg('Date of birth'), 'date')}
        <div className="grid gap-1.5"><Label>{t('Gender')}</Label>
          <Select value={v.gender ?? ''} onValueChange={set('gender')} disabled={!editable}><SelectTrigger><SelectValue placeholder={t('Not set')} /></SelectTrigger>
            <SelectContent><SelectItem value="female">{t('Female')}</SelectItem><SelectItem value="male">{t('Male')}</SelectItem><SelectItem value="other">{t('Other')}</SelectItem></SelectContent></Select></div>
        {field('phone', msg('Phone'), 'tel')}
        {field('email', msg('Email'), 'email')}{field('address', msg('Address'), 'text', 'sm:col-span-2')}
        <div className="grid gap-1.5"><Label>{t('Department')}</Label><SearchSelect value={v.department_id} onChange={set('department_id')} disabled={!editable} clearable placeholder={t('None')}
          options={(deps.data ?? []).map((d) => ({ value: d.id, label: td(d.name) }))} /></div>
        <div className="grid gap-1.5"><Label>{t('Position')}</Label><SearchSelect value={v.position_id} onChange={set('position_id')} disabled={!editable} clearable placeholder={t('None')}
          options={(pos.data ?? []).map((p) => ({ value: p.id, label: td(p.title) }))} /></div>
        <div className="grid gap-1.5"><Label>{t('Manager')}</Label><SearchSelect value={v.manager_id} onChange={set('manager_id')} disabled={!editable} clearable placeholder={t('None')}
          options={(emps.data ?? []).filter((x) => x.id !== emp?.id).map((x) => ({ value: x.id, label: x.full_name, hint: x.number }))} /></div>
        {field('hire_date', msg('Hired on'), 'date')}{field('termination_date', msg('Left on'), 'date')}
        <div className="grid gap-1.5"><Label>{t('Status')}</Label>
          <Select value={v.employment_status} onValueChange={set('employment_status')} disabled={!editable}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{['active', 'on_leave', 'terminated'].map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}</SelectContent></Select></div>
        <div className="grid gap-1.5"><Label>{t('Employment type')}</Label>
          <Select value={v.employment_type} onValueChange={set('employment_type')} disabled={!editable}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{['full_time', 'part_time', 'contract', 'intern'].map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}</SelectContent></Select></div>
        {field('bank_name', msg('Bank'))}{field('iban', msg('IBAN'))}
        <div className="grid gap-1.5"><Label>{t('Cost center')}</Label><SearchSelect value={v.cost_center_id} onChange={set('cost_center_id')} disabled={!editable} clearable placeholder={t('From the department')}
          options={(ccs.data ?? []).map((c) => ({ value: c.id, label: `${c.code} ${td(c.name)}` }))} /></div>
        <div className="grid gap-1.5 sm:col-span-2"><Label>{t('Login')}</Label><SearchSelect value={v.user_id} onChange={set('user_id')} disabled={!editable} clearable placeholder={t('No login: no self-service')}
          options={(profiles.data ?? []).map((p) => ({ value: p.id, label: p.full_name ?? p.email ?? p.id, hint: p.email ?? undefined }))} />
          <p className="text-xs text-muted-foreground">{t('With a linked login the person can clock in, ask for leave and see their own payslips.')}</p></div>
      </CardContent>
    </Card>
  )
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader back={{ href: '/hr/employees', label: t('Employees') }} title={emp ? emp.full_name : t('New employee')}
        meta={emp && <><span className="text-[13px] text-muted-foreground">{emp.number}</span><StatusBadge status={emp.employment_status} /></>}
        description={emp ? [td(emp.position?.title), td(emp.department?.name), t('since {date}', { date: formatDate(emp.hire_date) })].filter(Boolean).join(' · ') : t('Add the contract and pay after saving.')}
        actions={editable && <Button loading={save.isPending} disabled={!valid} onClick={() => void submit()}>{emp ? t('Save changes') : t('Add employee')}</Button>} />
      {!emp ? profileForm : (
        <Tabs defaultValue="profile">
          <TabsList><TabsTrigger value="profile">{t('Profile')}</TabsTrigger><TabsTrigger value="contract">{t('Contract')}</TabsTrigger>
            <TabsTrigger value="leave">{t('Leave')}</TabsTrigger><TabsTrigger value="attendance">{t('Attendance')}</TabsTrigger>
            {can('payroll.read') && <TabsTrigger value="payslips">{t('Payslips')}</TabsTrigger>}
            {can('payroll.read') && <TabsTrigger value="deductions">{t('Deductions')}</TabsTrigger>}</TabsList>
          <TabsContent value="profile">{profileForm}</TabsContent>
          <TabsContent value="contract"><ContractCard employeeId={emp.id} /></TabsContent>
          <TabsContent value="leave"><EmployeeLeave employeeId={emp.id} /></TabsContent>
          <TabsContent value="attendance"><EmployeeAttendance employeeId={emp.id} /></TabsContent>
          {can('payroll.read') && <TabsContent value="payslips"><EmployeePayslips employeeId={emp.id} /></TabsContent>}
          {can('payroll.read') && <TabsContent value="deductions"><DeductionsCard employeeId={emp.id} /></TabsContent>}
        </Tabs>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ contract */
function ContractCard({ employeeId }: { employeeId: string }) {
  const { can, company } = useCompany()
  const contracts = useContracts(employeeId)
  const [edit, setEdit] = React.useState<Contract | 'new' | null>(null)
  if (!can('payroll.read') && !can('hr.read')) return null
  const active = contracts.data?.find((c) => c.status === 'active')
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 py-3">
        <div><CardTitle>{t('Contracts')}</CardTitle><CardDescription>{t('Payroll uses the active contract: one per person.')}</CardDescription></div>
        <Can perm="payroll.write"><Button size="sm" variant={active ? 'outline' : 'default'} onClick={() => setEdit('new')}><Plus /> {t('New contract')}</Button></Can>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        {contracts.isLoading ? <Skeleton className="m-4 h-20" /> : !contracts.data?.length ? contracts.isError ? <ErrorState compact error={contracts.error} onRetry={() => void contracts.refetch()} /> : <p className="px-4 pb-4 text-[13px] text-muted-foreground">{t('No contract yet. Payroll skips people without one.')}</p> : (
          <Table>
            <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Type')}</TableHead><TableHead>{t('From')}</TableHead><TableHead>{t('To')}</TableHead>
              <TableHead className="text-right">{t('Gross per month')}</TableHead><TableHead className="text-right">{t('Hours / week')}</TableHead>
              {company?.country_code === 'XK' && <TableHead>{t('Employer')}</TableHead>}<TableHead>{t('Status')}</TableHead><TableHead className="w-[1%]" /></TableRow></TableHeader>
            <TableBody>{contracts.data.map((c) => (
              <TableRow key={c.id} className="hover:bg-transparent">
                <TableCell>{humanize(c.contract_type)}</TableCell><TableCell>{formatDate(c.start_date)}</TableCell><TableCell>{c.end_date ? formatDate(c.end_date) : t('No end date')}</TableCell>
                <TableCell className="text-right tabular font-medium">{formatMoney(c.gross_salary, c.currency_code)}</TableCell>
                <TableCell className="text-right tabular">{formatQty(c.working_hours_per_week)}</TableCell>
                {company?.country_code === 'XK' && <TableCell>{c.is_primary_employer ? t('Main employer') : <Badge variant="secondary">{t('Second job · 10% tax')}</Badge>}</TableCell>}
                <TableCell><StatusBadge status={c.status} /></TableCell>
                <TableCell><Can perm="payroll.write"><Button size="icon-sm" variant="ghost" aria-label={t('Edit contract')} onClick={() => setEdit(c)}><Pencil /></Button></Can></TableCell>
              </TableRow>))}</TableBody>
          </Table>
        )}
      </CardContent>
      {edit && <ContractDialog employeeId={employeeId} contract={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </Card>
  )
}

function ContractDialog({ employeeId, contract, onClose }: { employeeId: string; contract: Contract | null; onClose: () => void }) {
  const { company } = useCompany()
  const save = useSaveContract()
  const [v, setV] = React.useState({
    contract_type: contract?.contract_type ?? 'indefinite', start_date: contract?.start_date ?? todayISO(), end_date: contract?.end_date ?? '',
    gross_salary: contract ? String(contract.gross_salary) : '', working_hours_per_week: contract ? String(contract.working_hours_per_week) : '40',
    is_primary_employer: contract?.is_primary_employer ?? true, status: contract?.status ?? 'active',
  })
  const set = <K extends keyof typeof v>(k: K) => (x: (typeof v)[K]) => setV((s) => ({ ...s, [k]: x }))
  const valid = num(v.gross_salary) > 0 && v.start_date && (!v.end_date || v.end_date >= v.start_date) && num(v.working_hours_per_week) > 0
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{contract ? t('Edit contract') : t('New contract')}</DialogTitle>
          <DialogDescription>{t('Monthly gross pay in {currency}. End the current contract before starting another.', { currency: contract?.currency_code ?? company?.base_currency ?? '' })}</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 grid gap-1.5"><Label>{t('Type')}</Label>
            <Select value={v.contract_type} onValueChange={set('contract_type')}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{['indefinite', 'fixed_term', 'seasonal', 'service'].map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-1.5"><Label htmlFor="ct-from">{t('From')}</Label><Input id="ct-from" type="date" value={v.start_date} onChange={(e) => set('start_date')(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="ct-to">{t('To')}</Label><Input id="ct-to" type="date" value={v.end_date} onChange={(e) => set('end_date')(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="ct-gross">{t('Gross per month')}</Label><Input id="ct-gross" type="number" step="any" className="text-right tabular" value={v.gross_salary} onChange={(e) => set('gross_salary')(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="ct-h">{t('Hours per week')}</Label><Input id="ct-h" type="number" step="any" className="text-right tabular" value={v.working_hours_per_week} onChange={(e) => set('working_hours_per_week')(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label>{t('Status')}</Label>
            <Select value={v.status} onValueChange={set('status')}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{['draft', 'active', 'ended'].map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}</SelectContent></Select></div>
          {company?.country_code === 'XK' && <div className="flex items-center justify-between gap-2 pt-6"><Label htmlFor="ct-prim">{t('Main employer')}</Label>
            <Switch id="ct-prim" checked={v.is_primary_employer} onCheckedChange={set('is_primary_employer')} /></div>}
        </div>
        {company?.country_code === 'XK' && !v.is_primary_employer && <p className="text-xs text-muted-foreground">{t('A second job is taxed at a flat 10%, with no tax-free amount.')}</p>}
        <DialogFooter><Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={save.isPending} disabled={!valid} onClick={async () => {
            await save.mutateAsync({ id: contract?.id, employee_id: employeeId, contract_type: v.contract_type, start_date: v.start_date, end_date: v.end_date || null,
              gross_salary: num(v.gross_salary), working_hours_per_week: num(v.working_hours_per_week), is_primary_employer: v.is_primary_employer, status: v.status,
              ...(contract ? {} : { currency_code: company?.base_currency ?? 'ALL' }) })
            toast.success(t('Contract saved')); onClose()
          }}>{t('Save contract')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ leave / attendance / payslips tabs */
function EmployeeLeave({ employeeId }: { employeeId: string }) {
  const year = new Date().getFullYear()
  const bal = useLeaveBalances(year, employeeId)
  const leave = useLeaveRequests(employeeId)
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {(bal.data ?? []).map((b) => (
          <Card key={b.leave_type_id}><CardContent className="p-4">
            <div className="text-[13px] text-muted-foreground">{td(b.leave_type)} {year}</div>
            <div className="tabular text-2xl font-semibold">{formatQty(b.remaining)} <span className="text-sm font-normal text-muted-foreground">{t('days left')}</span></div>
            <div className="text-xs text-muted-foreground">{t('{total} per year · {taken} taken', { total: formatQty(b.entitlement), taken: formatQty(b.taken) })}{num(b.pending) ? ` · ${t('{n} waiting', { n: formatQty(b.pending) })}` : ''}</div>
          </CardContent></Card>))}
      </div>
      <Card><CardContent className="overflow-x-auto p-0">
        <Table><TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Request')}</TableHead><TableHead>{t('Type')}</TableHead><TableHead>{t('Dates')}</TableHead><TableHead className="text-right">{t('Days')}</TableHead><TableHead>{t('Status')}</TableHead></TableRow></TableHeader>
          <TableBody>{(leave.data ?? []).map((l) => (
            <TableRow key={l.id}><TableCell><Link className="text-primary hover:underline" to={`/hr/leave?id=${l.id}`}>{l.number}</Link></TableCell><TableCell>{td(l.type?.name)}</TableCell>
              <TableCell className="tabular">{formatDate(l.start_date)} – {formatDate(l.end_date)}</TableCell><TableCell className="text-right tabular">{formatQty(l.days)}</TableCell>
              <TableCell><StatusBadge status={l.status} /></TableCell></TableRow>))}
            {!leave.isLoading && !leave.data?.length && <TableRow><TableCell colSpan={5} className="py-6 text-center text-[13px] text-muted-foreground">{t('No leave requested.')}</TableCell></TableRow>}
          </TableBody></Table>
      </CardContent></Card>
    </div>
  )
}

function EmployeeAttendance({ employeeId }: { employeeId: string }) {
  const to = todayISO()
  const from = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)
  const rec = useAttendanceRecords(employeeId, from, to)
  const time = (x: string | null) => x ? formatDateWith(new Date(x), { hour: '2-digit', minute: '2-digit' }) : '—'
  return (
    <Card><CardHeader className="py-3"><CardTitle>{t('Last 30 days')}</CardTitle></CardHeader><CardContent className="overflow-x-auto p-0">
      <Table><TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Day')}</TableHead><TableHead>{t('In')}</TableHead><TableHead>{t('Out')}</TableHead><TableHead className="text-right">{t('Hours')}</TableHead><TableHead className="text-right">{t('Overtime')}</TableHead><TableHead>{t('Source')}</TableHead></TableRow></TableHeader>
        <TableBody>{(rec.data ?? []).map((a) => (
          <TableRow key={a.id}><TableCell>{formatDate(a.work_date)}</TableCell><TableCell className="tabular">{time(a.check_in)}</TableCell><TableCell className="tabular">{time(a.check_out)}</TableCell>
            <TableCell className="text-right tabular">{a.hours_worked != null ? formatQty(a.hours_worked) : '—'}</TableCell>
            <TableCell className="text-right tabular">{num(a.overtime_hours) ? formatQty(a.overtime_hours) : '—'}</TableCell><TableCell className="text-muted-foreground">{humanize(a.source)}</TableCell></TableRow>))}
          {!rec.isLoading && !rec.data?.length && <TableRow><TableCell colSpan={6} className="py-6 text-center text-[13px] text-muted-foreground">{t('No attendance recorded in the last 30 days.')}</TableCell></TableRow>}
        </TableBody></Table>
    </CardContent></Card>
  )
}

function EmployeePayslips({ employeeId }: { employeeId: string }) {
  const slips = useEmployeePayslips(employeeId)
  const [open, setOpen] = React.useState<string | null>(null)
  const current = slips.data?.find((s) => s.id === open)
  return (
    <Card><CardContent className="overflow-x-auto p-0">
      <Table><TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Month')}</TableHead><TableHead>{t('Payroll')}</TableHead><TableHead className="text-right">{t('Gross')}</TableHead><TableHead className="text-right">{t('Income tax')}</TableHead><TableHead className="text-right">{t('Net')}</TableHead><TableHead>{t('Status')}</TableHead></TableRow></TableHeader>
        <TableBody>{(slips.data ?? []).map((s) => (
          <TableRow key={s.id} className="cursor-pointer" onClick={() => setOpen(s.id)}>
            <TableCell>{s.run && formatMonth(`${s.run.period_start}T00:00:00`)}</TableCell>
            <TableCell><Link to={`/hr/payroll/${s.payroll_run_id}`} className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{s.run?.number}</Link></TableCell>
            <TableCell className="text-right tabular">{formatMoney(s.gross_salary)}</TableCell><TableCell className="text-right tabular">{formatMoney(s.income_tax)}</TableCell>
            <TableCell className="text-right tabular font-medium">{formatMoney(s.net_salary)}</TableCell><TableCell><StatusBadge status={s.run?.status} /></TableCell></TableRow>))}
          {!slips.isLoading && !slips.data?.length && <TableRow><TableCell colSpan={6} className="py-6 text-center text-[13px] text-muted-foreground">{t('No payslips yet.')}</TableCell></TableRow>}
        </TableBody></Table>
      {current && <PayslipDialog slip={current} onClose={() => setOpen(null)} />}
    </CardContent></Card>
  )
}
