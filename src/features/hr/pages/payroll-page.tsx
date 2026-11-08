import type { ColumnDef } from '@tanstack/react-table'
import { Banknote, Calculator, Check, Plus, Stamp, Trash2, Undo2, X } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Can, useCompany } from '@/app/company-provider'
import { useAuth } from '@/app/auth-provider'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { ColumnHeader, DataTable, inFilter } from '@/components/data-table/data-table'
import { EmptyState } from '@/components/empty-state'
import { ExportMenu } from '@/components/export-menu'
import { PageHeader } from '@/components/page-header'
import { SearchSelect } from '@/components/search-select'
import { StatCard } from '@/components/stat-card'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { XlsxColumn } from '@/lib/export'
import { ErrorState } from '@/components/error-state'
import { useRealtimeInvalidate } from '@/hooks/use-realtime'
import { t, td, tn } from '@/i18n'
import { formatDateWith } from '@/i18n/format'
import { formatDate, formatMoney, formatMonth, formatQty, humanize, num, todayISO } from '@/lib/utils'
import { useBankAccounts } from '@/features/finance/api'
import { AccountingTab } from '@/features/finance/components/t-accounts'
import {
  useApprovePayroll, usePayrollOtherApprovers, useCalculatePayroll, useCancelPayroll, useCreatePayrollRun, useDeleteRunItem, useEmployees, usePayPayroll, usePayrollRegister,
  usePayrollRun, usePayrollRuns, usePayslips, usePostPayroll, useReopenPayroll, useRunItems, useSaveRunItem, type PayrollRun, type PayslipRow, type RegisterRow,
} from '../api'
import { PayslipDialog } from '../components/payslip'
import { MoreMenu } from '@/components/more-menu'

const monthName = (d: string) => formatMonth(`${d}T00:00:00`)

/* ================================================================== runs */
export function PayrollRunsPage() {
  const navigate = useNavigate()
  const runs = usePayrollRuns()
  const { companyId } = useCompany()
  useRealtimeInvalidate('payroll_runs', companyId, [['hr', companyId, 'runs'], ['hr', companyId, 'run']])
  const [newOpen, setNewOpen] = React.useState(false)
  const cols = React.useMemo<ColumnDef<PayrollRun>[]>(() => [
    { accessorKey: 'number', header: ({ column }) => <ColumnHeader column={column} title={t('Payroll')} />, meta: { label: t('Payroll') }, cell: ({ getValue }) => <span className="font-medium">{getValue() as string}</span> },
    { accessorKey: 'period_start', header: ({ column }) => <ColumnHeader column={column} title={t('Month')} />, meta: { label: t('Month') }, cell: ({ getValue }) => monthName(getValue() as string) },
    { accessorKey: 'status', filterFn: inFilter, header: t('Status'), meta: { label: t('Status') }, cell: ({ getValue }) => <StatusBadge status={getValue() as string} /> },
    { accessorKey: 'employee_count', header: t('People'), meta: { label: t('People'), align: 'right' } },
    { accessorKey: 'total_gross', header: t('Gross'), meta: { label: t('Gross'), align: 'right' }, cell: ({ getValue }) => <span className="tabular">{formatMoney(getValue() as number)}</span> },
    { accessorKey: 'total_net', header: t('Net'), meta: { label: t('Net'), align: 'right' }, cell: ({ getValue }) => <span className="tabular">{formatMoney(getValue() as number)}</span> },
    { accessorKey: 'total_employer_cost', header: t('Employer cost'), meta: { label: t('Employer cost'), align: 'right' }, cell: ({ getValue }) => <span className="tabular font-medium">{formatMoney(getValue() as number)}</span> },
    { accessorKey: 'pay_date', header: t('Pay date'), meta: { label: t('Pay date') }, cell: ({ getValue }) => formatDate(getValue() as string) },
  ], [])
  return (
    <>
      <PageHeader title={t('Payroll')} description={t('One payroll per month: calculate it, have someone else approve it, make it final, then pay.')}
        actions={<Can perm="payroll.write"><Button onClick={() => setNewOpen(true)}><Plus /> {t('New monthly payroll')}</Button></Can>} />
      <DataTable tableKey="hr.payroll" columns={cols} data={runs.data} isLoading={runs.isLoading} error={runs.error} getRowId={(r) => r.id} exportName="payroll-runs"
        onRowClick={(r) => navigate(`/hr/payroll/${r.id}`)}
        facets={[{ columnId: 'status', title: t('Status'), options: ['draft', 'calculated', 'approved', 'posted', 'paid', 'cancelled'].map((s) => ({ value: s, label: humanize(s) })) }]}
        empty={{ title: t('No payroll yet'), description: t('Start with the first month; everyone with an active contract is included.'), action: <Can perm="payroll.write"><Button size="sm" onClick={() => setNewOpen(true)}><Plus /> {t('New monthly payroll')}</Button></Can> }} />
      {newOpen && <NewRunDialog onClose={() => setNewOpen(false)} />}
    </>
  )
}

function NewRunDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const create = useCreatePayrollRun()
  const now = new Date()
  const [y, setY] = React.useState(now.getFullYear())
  const [m, setM] = React.useState(now.getMonth() + 1)
  const defaultPay = (yy: number, mm: number) => { const d = new Date(yy, mm, 10); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-10` }
  const [pay, setPay] = React.useState(defaultPay(y, m))
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{t('New monthly payroll')}</DialogTitle><DialogDescription>{t('Choose the month to pay. You can add bonuses before calculating.')}</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5"><Label>{t('Month')}</Label>
            <Select value={String(m)} onValueChange={(v) => { setM(Number(v)); setPay(defaultPay(y, Number(v))) }}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Array.from({ length: 12 }, (_, i) => i + 1).map((i) => <SelectItem key={i} value={String(i)}>{formatDateWith(new Date(2000, i - 1, 1), { month: 'long' })}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-1.5"><Label htmlFor="pr-y">{t('Year')}</Label><Input id="pr-y" type="number" value={y} onChange={(e) => { setY(Number(e.target.value)); setPay(defaultPay(Number(e.target.value), m)) }} /></div>
          <div className="col-span-2 grid gap-1.5"><Label htmlFor="pr-pay">{t('Pay date')}</Label><Input id="pr-pay" type="date" value={pay} onChange={(e) => setPay(e.target.value)} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={create.isPending} disabled={!pay || y < 2000} onClick={async () => { const id = await create.mutateAsync({ year: y, month: m, pay_date: pay }); navigate(`/hr/payroll/${id}`) }}>{t('Create payroll')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ================================================================== one run */
export function PayrollRunPage() {
  const { id } = useParams()
  const { company } = useCompany()
  const { user } = useAuth()
  const run = usePayrollRun(id)
  const slips = usePayslips(id)
  const calc = useCalculatePayroll()
  const approve = useApprovePayroll()
  const others = usePayrollOtherApprovers()
  const reopen = useReopenPayroll()
  const post = usePostPayroll()
  const cancel = useCancelPayroll()
  const [payOpen, setPayOpen] = React.useState(false)
  const [slipId, setSlipId] = React.useState<string | null>(null)
  if (run.isLoading) return <Skeleton className="h-96" />
  const r = run.data
  if (run.isError) return <ErrorState error={run.error} onRetry={() => void run.refetch()} />
  if (!r) return <EmptyState title={t('Payroll not found')} action={<Button variant="outline" size="sm" asChild><Link to="/hr/payroll">{t('Back to payroll')}</Link></Button>} />
  const cur = company?.base_currency
  const rows = [...(slips.data ?? [])].sort((a, b) => (a.employee?.full_name ?? '').localeCompare(b.employee?.full_name ?? ''))
  const slip = rows.find((s) => s.id === slipId)
  const selfCalculated = r.calculated_by === user?.id
  const alone = others.data === 0          // nobody else may approve payroll here
  const blocked = selfCalculated && !alone
  const editable = ['draft', 'calculated'].includes(r.status)
  return (
    <>
      <PageHeader back={{ href: '/hr/payroll', label: t('Payroll') }} title={`${r.number} · ${monthName(r.period_start)}`} meta={<StatusBadge status={r.status} />}
        description={[r.country_rules === 'XK' ? t('Kosovo rules: pension 5% + 5%, income tax 0 / 8 / 10%') : t('Albanian rules: social 9.5% + 15%, health 1.7% + 1.7%, TAP'), t('pay date {date}', { date: formatDate(r.pay_date) })].join(' · ')}
        actions={<><Can perm="payroll.write">
          <MoreMenu items={[
            { label: t('Back to draft'), icon: Undo2, hidden: !['calculated', 'approved'].includes(r.status), onSelect: async () => { await reopen.mutateAsync(r.id); toast.success(t('Back to draft')) } },
            { label: t('Cancel payroll'), icon: X, destructive: true, separate: true, hidden: !editable, onSelect: async () => { await cancel.mutateAsync(r.id); toast.success(t('Payroll cancelled')) },
              confirm: { title: t('Cancel {number}?', { number: r.number }), description: t('The payroll and its payslips are set aside; nothing was booked.') } },
          ]} />
          {editable && <Button variant={r.status === 'calculated' ? 'outline' : 'default'} loading={calc.isPending}
            onClick={async () => { const x = await calc.mutateAsync(r.id) as { employees: number }; toast.success(tn(x.employees, 'Payroll calculated for {n} person', 'Payroll calculated for {n} people')) }}>
            <Calculator /> {r.status === 'calculated' ? t('Recalculate') : t('Calculate payroll')}</Button>}
          {r.status === 'approved' && <ConfirmDialog trigger={<Button><Check /> {t('Make final and book')}</Button>} title={t('Make {number} final?', { number: r.number })}
            description={t('Salaries and employer contributions are booked as expenses; net pay, contributions and income tax become amounts to pay. Employees can then see their payslips.')}
            confirmLabel={t('Make final and book')} onConfirm={async () => { await post.mutateAsync(r.id); toast.success(t('Payroll booked')) }} />}
          {r.status === 'posted' && <Button onClick={() => setPayOpen(true)}><Banknote /> {t('Pay salaries')}</Button>}
        </Can>{r.status === 'calculated' && <Can perm="payroll.approve"><Button className="ml-2" loading={approve.isPending} disabled={blocked || others.isLoading}
            title={blocked ? t('Someone other than the person who calculated it must approve') : undefined}
            onClick={async () => { await approve.mutateAsync(r.id); toast.success(t('Payroll approved')) }}><Stamp /> {t('Approve payroll')}</Button></Can>}</>} />
      {r.status === 'calculated' && blocked && <p className="-mt-2 mb-4 text-[13px] text-muted-foreground">{t('You calculated this payroll, so someone else has to approve it.')}</p>}
      {r.status === 'calculated' && selfCalculated && alone && <p className="-mt-2 mb-4 text-[13px] text-muted-foreground">{t('Nobody else in the company may approve payroll, so you can approve it yourself. The payroll will show that.')}</p>}
      {r.self_approved && ['approved', 'posted', 'paid'].includes(r.status) && <p className="-mt-2 mb-4 text-[13px] text-muted-foreground">{t('Approved by the person who calculated it, the only one who may approve payroll.')}</p>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label={t('Gross pay')} value={formatMoney(r.total_gross)} hint={tn(num(r.employee_count), '{n} person', '{n} people')} />
        <StatCard label={t('Employee contributions')} value={formatMoney(r.total_employee_contrib)} hint={r.country_rules === 'XK' ? t('Pension 5%') : t('Social and health insurance')} />
        <StatCard label={t('Income tax withheld')} value={formatMoney(r.total_income_tax)} hint={r.country_rules === 'XK' ? t('Tax on salaries') : t('TAP')} />
        <StatCard label={t('Net pay')} value={formatMoney(r.total_net)} hint={r.status === 'paid' ? t('Paid') : t('To pay employees')} />
        <StatCard label={t('Employer cost')} value={formatMoney(r.total_employer_cost)} hint={t('Gross plus {amount} employer contributions', { amount: formatMoney(r.total_employer_contrib) })} />
      </div>

      <Tabs defaultValue="payslips" className="mt-4">
        <TabsList><TabsTrigger value="payslips">{t('Payslips')}</TabsTrigger><TabsTrigger value="extras">{t('Extra earnings')}</TabsTrigger>
          <TabsTrigger value="register">{t('Declaration list')}</TabsTrigger>{r.journal_entry_id && <TabsTrigger value="accounting">{t('Accounting')}</TabsTrigger>}</TabsList>
        <TabsContent value="payslips">
          <Card><CardContent className="overflow-x-auto p-0">
            {slips.isLoading ? <Skeleton className="m-4 h-40" /> : slips.isError ? <ErrorState compact error={slips.error} onRetry={() => void slips.refetch()} /> : !rows.length ? <EmptyState compact title={t('Not calculated yet')} description={t('Calculate the payroll to create a payslip for everyone with an active contract.')} /> : (
              <Table>
                <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Employee')}</TableHead><TableHead className="text-right">{t('Days')}</TableHead><TableHead className="text-right">{t('Gross')}</TableHead>
                  <TableHead className="text-right">{t('Contributions')}</TableHead><TableHead className="text-right">{t('Income tax')}</TableHead><TableHead className="text-right">{t('Net')}</TableHead><TableHead className="text-right">{t('Employer')}</TableHead></TableRow></TableHeader>
                <TableBody>{rows.map((s) => (
                  <TableRow key={s.id} className="cursor-pointer" onClick={() => setSlipId(s.id)}>
                    <TableCell><span className="font-medium">{s.employee?.full_name}</span><div className="text-xs text-muted-foreground">{[td(s.employee?.position?.title), td(s.employee?.department?.name)].filter(Boolean).join(' · ')}</div></TableCell>
                    <TableCell className="text-right tabular">{formatQty(s.paid_days)}/{formatQty(s.working_days)}{num(s.unpaid_leave_days) ? <div className="text-xs text-warning">{t('{n} unpaid', { n: formatQty(s.unpaid_leave_days) })}</div> : null}</TableCell>
                    <TableCell className="text-right tabular">{formatMoney(s.gross_salary)}</TableCell>
                    <TableCell className="text-right tabular">{formatMoney(s.employee_contributions)}</TableCell>
                    <TableCell className="text-right tabular">{formatMoney(s.income_tax)}</TableCell>
                    <TableCell className="text-right tabular font-medium">{formatMoney(s.net_salary)}</TableCell>
                    <TableCell className="text-right tabular text-muted-foreground">{formatMoney(s.employer_contributions)}</TableCell>
                  </TableRow>))}</TableBody>
                <TableFooter><TableRow className="hover:bg-transparent font-medium"><TableCell>{t('Total')}</TableCell><TableCell />
                  <TableCell className="text-right tabular">{formatMoney(r.total_gross)}</TableCell><TableCell className="text-right tabular">{formatMoney(r.total_employee_contrib)}</TableCell>
                  <TableCell className="text-right tabular">{formatMoney(r.total_income_tax)}</TableCell><TableCell className="text-right tabular">{formatMoney(r.total_net, cur)}</TableCell>
                  <TableCell className="text-right tabular">{formatMoney(r.total_employer_contrib)}</TableCell></TableRow></TableFooter>
              </Table>)}
          </CardContent></Card>
        </TabsContent>
        <TabsContent value="extras"><ExtrasCard run={r} editable={editable} /></TabsContent>
        <TabsContent value="register"><RegisterCard run={r} /></TabsContent>
        {r.journal_entry_id && <TabsContent value="accounting">
          <div className="mb-3 flex flex-wrap gap-3 text-[13px]">
            <Link className="text-primary hover:underline" to={`/finance/journal/${r.journal_entry_id}`}>{t('Payroll entry')}</Link>
            {r.payment_journal_entry_id && <Link className="text-primary hover:underline" to={`/finance/journal/${r.payment_journal_entry_id}`}>{t('Salary payment entry')}</Link>}
          </div>
          <AccountingTab sourceType="payroll_run" sourceId={r.id} />
        </TabsContent>}
      </Tabs>
      {slip && <PayslipDialog slip={slip} onClose={() => setSlipId(null)} />}
      {payOpen && <PayDialog run={r} onClose={() => setPayOpen(false)} />}
    </>
  )
}

function PayDialog({ run, onClose }: { run: PayrollRun; onClose: () => void }) {
  const banks = useBankAccounts()
  const pay = usePayPayroll()
  const [bank, setBank] = React.useState<string | null>(null)
  const [date, setDate] = React.useState(run.pay_date ?? todayISO())
  const options = (banks.data ?? []).filter((b) => b.account_kind === 'bank')
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{t('Pay salaries')}</DialogTitle><DialogDescription>{t('Books {amount} of net pay out of the bank account you choose.', { amount: formatMoney(run.total_net) })}</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label>{t('Paid from')}</Label><SearchSelect value={bank} onChange={setBank} placeholder={banks.isLoading ? t('Loading…') : t('Choose a bank account')}
            options={options.map((b) => ({ value: b.id, label: td(b.name), hint: b.currency_code }))} />
            {!banks.isLoading && !options.length && <p className="text-xs text-muted-foreground">{t('You cannot see any bank account. Someone with finance access can pay these salaries.')}</p>}</div>
          <div className="grid gap-1.5"><Label htmlFor="pay-d">{t('Payment date')}</Label><Input id="pay-d" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
          <Button disabled={!bank || !date} loading={pay.isPending} onClick={async () => { await pay.mutateAsync({ id: run.id, bank: bank!, date }); toast.success(t('Salaries paid')); onClose() }}>{t('Pay salaries')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ExtrasCard({ run, editable }: { run: PayrollRun; editable: boolean }) {
  const { can } = useCompany()
  const items = useRunItems(run.id)
  const emps = useEmployees()
  const add = useSaveRunItem()
  const del = useDeleteRunItem()
  const [v, setV] = React.useState({ employee_id: null as string | null, name: '', amount: '' })
  const can_edit = editable && can('payroll.write')
  return (
    <Card>
      <CardHeader className="py-3"><CardTitle>{t('Bonuses and allowances')}</CardTitle>
        <CardDescription>{t('Taxed and insured like salary. Add them before calculating; recalculate after a change.')}</CardDescription></CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <Table><TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Employee')}</TableHead><TableHead>{t('What')}</TableHead><TableHead className="text-right">{t('Amount')}</TableHead><TableHead className="w-[1%]" /></TableRow></TableHeader>
          <TableBody>
            {(items.data ?? []).map((i) => (
              <TableRow key={i.id}><TableCell>{i.employee?.full_name}</TableCell><TableCell>{i.name}</TableCell><TableCell className="text-right tabular">{formatMoney(i.amount)}</TableCell>
                <TableCell>{can_edit && <Button size="icon-sm" variant="ghost" aria-label={t('Remove')} onClick={() => del.mutate(i.id)}><Trash2 /></Button>}</TableCell></TableRow>))}
            {!items.isLoading && !items.data?.length && <TableRow><TableCell colSpan={4} className="py-5 text-center text-[13px] text-muted-foreground">{t('No extra earnings this month.')}</TableCell></TableRow>}
            {can_edit && <TableRow className="hover:bg-transparent">
              <TableCell className="min-w-[200px]"><SearchSelect value={v.employee_id} onChange={(x) => setV({ ...v, employee_id: x })} placeholder={t('Employee')}
                options={(emps.data ?? []).filter((e) => e.employment_status !== 'terminated').map((e) => ({ value: e.id, label: e.full_name }))} /></TableCell>
              <TableCell><Input placeholder={t('e.g. Q4 sales bonus')} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></TableCell>
              <TableCell><Input type="number" step="any" className="w-32 text-right tabular" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></TableCell>
              <TableCell><Button size="sm" disabled={!v.employee_id || !v.name.trim() || num(v.amount) <= 0} loading={add.isPending}
                onClick={async () => { await add.mutateAsync({ payroll_run_id: run.id, employee_id: v.employee_id!, code: 'BONUS', name: v.name.trim(), amount: num(v.amount) }); setV({ employee_id: null, name: '', amount: '' }) }}>
                <Plus /> {t('Add')}</Button></TableCell>
            </TableRow>}
          </TableBody></Table>
      </CardContent>
    </Card>
  )
}

function registerColumns(country: string): XlsxColumn<RegisterRow>[] {
  if (country === 'XK') return [
    { header: t('No.|register'), value: (r) => r.line_no, format: 'int' },
    { header: t('Personal number'), value: (r) => r.personal_number, format: 'text' },
    { header: t('First name'), value: (r) => r.first_name }, { header: t('Last name'), value: (r) => r.last_name },
    { header: t('Gross salary'), value: (r) => num(r.gross), format: 'money' },
    { header: t('Employee pension contribution 5%'), value: (r) => num(r.ss_employee), format: 'money' },
    { header: t('Employer pension contribution 5%'), value: (r) => num(r.ss_employer), format: 'money' },
    { header: t('Taxable salary'), value: (r) => num(r.taxable), format: 'money' },
    { header: t('Tax on salaries'), value: (r) => num(r.income_tax), format: 'money' },
    { header: t('Net salary'), value: (r) => num(r.net), format: 'money' },
  ]
  return [
    { header: t('No.|register'), value: (r) => r.line_no, format: 'int' },
    { header: t('Personal number'), value: (r) => r.personal_number, format: 'text' },
    { header: t('Last name'), value: (r) => r.last_name }, { header: t('First name'), value: (r) => r.first_name },
    { header: t('Position'), value: (r) => td(r.job_title) },
    { header: t('Working days'), value: (r) => num(r.paid_days), format: 'qty' },
    { header: t('Gross salary'), value: (r) => num(r.gross), format: 'money' },
    { header: t('Salary for insurance'), value: (r) => num(r.contribution_base), format: 'money' },
    { header: t('Social insurance, employee 9.5%'), value: (r) => num(r.ss_employee), format: 'money' },
    { header: t('Health insurance, employee 1.7%'), value: (r) => num(r.health_employee), format: 'money' },
    { header: t('Social insurance, employer 15%'), value: (r) => num(r.ss_employer), format: 'money' },
    { header: t('Health insurance, employer 1.7%'), value: (r) => num(r.health_employer), format: 'money' },
    { header: t('TAP'), value: (r) => num(r.income_tax), format: 'money' },
    { header: t('Net salary'), value: (r) => num(r.net), format: 'money' },
    { header: t('IBAN'), value: (r) => r.iban, format: 'text' },
  ]
}

function RegisterCard({ run }: { run: PayrollRun }) {
  const { company } = useCompany()
  const reg = usePayrollRegister(run.id, run.status !== 'draft')
  const cols = registerColumns(run.country_rules)
  const rows = reg.data ?? []
  const sum = (k: keyof RegisterRow) => rows.reduce((a, r) => a + num(r[k]), 0)
  const totals: Record<string, number | string> = { [cols[0]!.header]: t('Total') }
  for (const c of cols) if (c.format === 'money') totals[c.header] = cols.indexOf(c) >= 0 ? rows.reduce((a, r) => a + num(c.value(r)), 0) : 0
  const title = run.country_rules === 'XK' ? t('Payroll list (monthly WP declaration)') : t('Payroll list (E-SIG 025)')
  const period = monthName(run.period_start)
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 py-3">
        <div><CardTitle>{title}</CardTitle><CardDescription>{run.country_rules === 'XK' ? t('One line per employee, in the layout of the monthly ATK declaration.') : t('One line per employee, in the layout of the monthly tax and social insurance declaration.')}</CardDescription></div>
        <ExportMenu rows={rows} columns={cols} filename={`${run.country_rules === 'XK' ? t('payroll-list|file') : t('payroll|file')}-${run.period_start.slice(0, 7)}`}
          title={title} subtitle={`${company?.name ?? ''} · ${period} · ${run.number}`} xlsx={{ totals }} />
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        {run.status === 'draft' ? <p className="px-4 pb-4 text-[13px] text-muted-foreground">{t('Calculate the payroll first.')}</p> : reg.isLoading ? <Skeleton className="m-4 h-32" /> : reg.isError ? <ErrorState compact error={reg.error} onRetry={() => void reg.refetch()} /> : (
          <Table>
            <TableHeader><TableRow className="hover:bg-transparent">{cols.map((c) => <TableHead key={c.header} className={c.format && c.format !== 'text' ? 'text-right' : ''}>{c.header}</TableHead>)}</TableRow></TableHeader>
            <TableBody>{rows.map((r) => <TableRow key={r.employee_id}>{cols.map((c) => {
              const val = c.value(r)
              return <TableCell key={c.header} className={c.format && c.format !== 'text' ? 'text-right tabular' : 'whitespace-nowrap'}>{c.format === 'money' ? formatMoney(val as number) : (val ?? '—')}</TableCell>
            })}</TableRow>)}</TableBody>
            <TableFooter><TableRow className="hover:bg-transparent font-medium">{cols.map((c, i) => <TableCell key={c.header} className={c.format === 'money' ? 'text-right tabular' : ''}>
              {i === 0 ? t('Total') : c.format === 'money' ? formatMoney(totals[c.header] as number) : ''}</TableCell>)}</TableRow></TableFooter>
          </Table>)}
        {run.status !== 'draft' && <p className="border-t px-4 py-2 text-xs text-muted-foreground">{t('Gross {gross} · employer cost {cost}', { gross: formatMoney(sum('gross')), cost: formatMoney(sum('employer_cost')) })}</p>}
      </CardContent>
    </Card>
  )
}

export type { PayslipRow }
