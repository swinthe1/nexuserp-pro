import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import type { Tables } from '@/lib/database.types'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

export const hrKeys = { all: (c: string) => ['hr', c] as const }
function useInvalidate() {
  const qc = useQueryClient()
  const { companyId } = useCompany()
  return React.useCallback(() => Promise.all([
    qc.invalidateQueries({ queryKey: hrKeys.all(companyId) }),
    qc.invalidateQueries({ queryKey: ['fin', companyId] }),
    qc.invalidateQueries({ queryKey: ['notifications'] }),
  ]), [qc, companyId])
}
function useAction<A, R>(fn: (a: A) => Promise<R>) {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: fn, onSuccess: () => void invalidate(), onError: (e) => toast.error(describeError(e)) })
}
function useCo() {
  const { companyId } = useCompany()
  return { companyId, key: hrKeys.all(companyId) }
}

/* ------------------------------------------------------------------ master data */
export type Department = Tables<'departments'>
export type Position = Tables<'job_positions'>
export type LeaveType = Tables<'leave_types'>
export type Holiday = Tables<'public_holidays'>

export function useDepartments() {
  const { companyId, key } = useCo()
  return useQuery({ queryKey: [...key, 'departments'], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('departments').select('*').eq('company_id', companyId).is('deleted_at', null).order('name')) })
}
export function usePositions() {
  const { companyId, key } = useCo()
  return useQuery({ queryKey: [...key, 'positions'], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('job_positions').select('*').eq('company_id', companyId).is('deleted_at', null).order('title')) })
}
export function useLeaveTypes() {
  const { companyId, key } = useCo()
  return useQuery({ queryKey: [...key, 'leave-types'], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('leave_types').select('*').eq('company_id', companyId).is('deleted_at', null).order('name')) })
}
export function useHolidays() {
  const { companyId, key } = useCo()
  return useQuery({ queryKey: [...key, 'holidays'], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('public_holidays').select('*').eq('company_id', companyId).order('holiday_date')) })
}
type MasterTable = 'departments' | 'job_positions' | 'leave_types' | 'public_holidays'
export function useSaveMaster(table: MasterTable) {
  const { companyId } = useCompany()
  return useAction(async ({ id, ...v }: Record<string, unknown> & { id?: string }) => id
    ? unwrap(await supabase.from(table).update(v as never).eq('id', id))
    : unwrap(await supabase.from(table).insert({ ...v, company_id: companyId } as never)))
}
export function useDeleteMaster(table: MasterTable) {
  return useAction(async (id: string) => unwrap(await supabase.from(table).delete().eq('id', id)))
}

/* ------------------------------------------------------------------ people */
export type EmployeeRow = Omit<Tables<'employees'>, 'full_name'> & {
  full_name: string
  department: { name: string } | null
  position: { title: string } | null
  manager: { full_name: string } | null
}
const EMP_SELECT = '*, department:departments!employees_company_id_department_id_fkey(name), position:job_positions!employees_company_id_position_id_fkey(title)'
export function useEmployees() {
  const { companyId, key } = useCo()
  return useQuery({ queryKey: [...key, 'employees'], enabled: !!companyId,
    queryFn: async () => {
      const rows = unwrap(await supabase.from('employees').select(EMP_SELECT).eq('company_id', companyId).is('deleted_at', null)
        .order('last_name').returns<EmployeeRow[]>())
      // PostgREST cannot embed a table in itself: managers are looked up here
      const byId = new Map(rows.map((r) => [r.id, r.full_name]))
      return rows.map((r) => ({ ...r, manager: r.manager_id ? { full_name: byId.get(r.manager_id) ?? '' } : null }))
    } })
}
export function useEmployee(id: string | undefined) {
  const { companyId, key } = useCo()
  return useQuery({ queryKey: [...key, 'employee', id], enabled: !!companyId && !!id,
    queryFn: async () => unwrap(await supabase.from('employees').select(EMP_SELECT).eq('id', id!).single().returns<EmployeeRow>()) })
}
/** The logged-in user's own employee record (RLS self-service) */
export function useMyEmployee() {
  const { companyId, key } = useCo()
  return useQuery({ queryKey: [...key, 'me'], enabled: !!companyId,
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser()
      const uid = auth.user?.id
      if (!uid) return null
      const rows = unwrap(await supabase.from('employees').select(EMP_SELECT).eq('company_id', companyId).eq('user_id', uid).is('deleted_at', null).limit(1).returns<EmployeeRow[]>())
      return rows[0] ?? null
    } })
}
export function useSaveEmployee() {
  const { companyId } = useCompany()
  return useAction(async ({ id, ...v }: Record<string, unknown> & { id?: string }) => {
    if (id) { unwrap(await supabase.from('employees').update(v as never).eq('id', id)); return id }
    const row = unwrap(await supabase.from('employees').insert({ ...v, company_id: companyId } as never).select('id').single())
    return (row as { id: string }).id
  })
}

export type Contract = Tables<'employment_contracts'>
export function useContracts(employeeId: string | undefined) {
  const { companyId, key } = useCo()
  return useQuery({ queryKey: [...key, 'contracts', employeeId], enabled: !!companyId && !!employeeId,
    queryFn: async () => unwrap(await supabase.from('employment_contracts').select('*').eq('employee_id', employeeId!).is('deleted_at', null).order('start_date', { ascending: false })) })
}
export function useSaveContract() {
  const { companyId } = useCompany()
  return useAction(async ({ id, ...v }: Record<string, unknown> & { id?: string }) => id
    ? unwrap(await supabase.from('employment_contracts').update(v as never).eq('id', id))
    : unwrap(await supabase.from('employment_contracts').insert({ ...v, company_id: companyId } as never)))
}

/** Logins of co-members, for linking an employee to a user */
export function useProfiles() {
  const { companyId, key } = useCo()
  return useQuery({ queryKey: [...key, 'profiles'], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('profiles').select('id, full_name, email').order('full_name')) })
}

/* ------------------------------------------------------------------ overview */
export type HrOverview = {
  headcount: number; joiners_90d: number; leavers_90d: number; on_leave_today: number; pending_leave: number; present_today: number
  contracts_ending_60d: { employee: string; employee_id: string; end_date: string }[]
  by_department: { department: string; count: number }[]
  payroll_trend: { period: string; gross: number; net: number; employer_cost: number; employees: number }[] | null
  upcoming_leave: { employee: string; type: string; start: string; end: string; days: number }[]
}
export function useHrOverview() {
  const { companyId, key } = useCo()
  return useQuery({ queryKey: [...key, 'overview'], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('hr_overview', { p_company: companyId })) as unknown as HrOverview })
}

/* ------------------------------------------------------------------ leave */
export type LeaveRow = Tables<'leave_requests'> & { employee: { full_name: string; number: string } | null; type: { name: string; is_paid: boolean } | null }
const LEAVE_SELECT = '*, employee:employees!leave_requests_company_id_employee_id_fkey(full_name, number), type:leave_types!leave_requests_company_id_leave_type_id_fkey(name, is_paid)'
export function useLeaveRequests(employeeId?: string) {
  const { companyId, key } = useCo()
  return useQuery({ queryKey: [...key, 'leave', employeeId ?? 'all'], enabled: !!companyId,
    queryFn: async () => {
      let q = supabase.from('leave_requests').select(LEAVE_SELECT).eq('company_id', companyId).is('deleted_at', null)
      if (employeeId) q = q.eq('employee_id', employeeId)
      return unwrap(await q.order('start_date', { ascending: false }).returns<LeaveRow[]>())
    } })
}
export type Balance = { employee_id: string; employee: string; leave_type_id: string; leave_type: string; entitlement: number; taken: number; pending: number; remaining: number }
export function useLeaveBalances(year: number, employeeId?: string | null) {
  const { companyId, key } = useCo()
  return useQuery({ queryKey: [...key, 'balances', year, employeeId ?? 'all'], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('leave_balances', { p_company: companyId, p_year: year, p_employee: employeeId ?? undefined })) as Balance[] })
}
export function useCreateLeave() {
  const { companyId } = useCompany()
  return useAction(async (v: { employee_id: string; leave_type_id: string; start_date: string; end_date: string; reason?: string | null; submit: boolean }) => {
    const row = unwrap(await supabase.from('leave_requests').insert({ company_id: companyId, employee_id: v.employee_id, leave_type_id: v.leave_type_id,
      start_date: v.start_date, end_date: v.end_date, reason: v.reason || null } as never).select('id, days').single()) as { id: string; days: number }
    if (v.submit) {
      const { error } = await supabase.rpc('submit_leave_request', { p_id: row.id })
      if (error) { await supabase.from('leave_requests').update({ status: 'cancelled' } as never).eq('id', row.id); throw error }
    }
    return row
  })
}
export const useSubmitLeave = () => useAction(async (id: string) => unwrap(await supabase.rpc('submit_leave_request', { p_id: id })))
/** Approve / reject: the row shows the new status at once and goes back if the server refuses. */
export function useDecideLeave() {
  const qc = useQueryClient()
  const { companyId } = useCompany()
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (a: { id: string; approve: boolean; note?: string }) =>
      unwrap(await supabase.rpc('decide_leave_request', { p_id: a.id, p_approve: a.approve, p_note: a.note || undefined })),
    onMutate: async (a) => {
      const filters = { predicate: (q: { queryKey: readonly unknown[] }) => q.queryKey[0] === 'hr' && q.queryKey[1] === companyId && (q.queryKey[2] === 'leave' || q.queryKey[2] === 'team-leave') }
      await qc.cancelQueries(filters)
      const snapshot = qc.getQueriesData<{ id: string; status: string }[]>(filters)
      const status = a.approve ? 'approved' : 'rejected'
      for (const [k, rows] of snapshot) if (Array.isArray(rows)) qc.setQueryData(k, rows.map((r) => (r.id === a.id ? { ...r, status } : r)))
      return { snapshot }
    },
    onError: (e, _a, ctx) => { ctx?.snapshot.forEach(([k, v]) => qc.setQueryData(k, v)); toast.error(describeError(e)) },
    onSettled: () => void invalidate(),
  })
}
export const useCancelLeave = () => useAction(async (id: string) => unwrap(await supabase.rpc('cancel_leave_request', { p_id: id })))

/* ------------------------------------------------------------------ attendance */
export type AttendanceDay = { d: number; c: '' | 'P' | 'L' | 'U' | 'H' | 'W' | 'A'; h: number; t: string | null }
export type AttendanceRow = { employee_id: string; number: string; employee: string; department: string | null; days: AttendanceDay[]
  worked_hours: number; overtime_hours: number; present_days: number; leave_days: number; absent_days: number; working_days: number }
export function useAttendanceMonth(month: string, department: string | null) {
  const { companyId, key } = useCo()
  return useQuery({ queryKey: [...key, 'attendance', month, department], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('attendance_month', { p_company: companyId, p_month: month, p_department: department ?? undefined })) as unknown as AttendanceRow[] })
}
export function useAttendanceRecords(employeeId: string | undefined, from: string, to: string) {
  const { companyId, key } = useCo()
  return useQuery({ queryKey: [...key, 'att-records', employeeId, from, to], enabled: !!companyId && !!employeeId,
    queryFn: async () => unwrap(await supabase.from('attendance_records').select('*').eq('employee_id', employeeId!)
      .gte('work_date', from).lte('work_date', to).order('work_date', { ascending: false })) })
}
export function useSaveAttendance() {
  const { companyId } = useCompany()
  return useAction(async ({ id, ...v }: Record<string, unknown> & { id?: string }) => id
    ? unwrap(await supabase.from('attendance_records').update(v as never).eq('id', id))
    : unwrap(await supabase.from('attendance_records').insert({ ...v, company_id: companyId } as never)))
}
export const useDeleteAttendance = () => useAction(async (id: string) => unwrap(await supabase.from('attendance_records').delete().eq('id', id)))
/** Clock in / out: today's row changes at once; the server's answer replaces it. */
export function useClock() {
  const qc = useQueryClient()
  const { companyId } = useCompany()
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('clock_attendance', {})) as unknown as { action: 'in' | 'out'; at: string },
    onMutate: async () => {
      const filters = { predicate: (q: { queryKey: readonly unknown[] }) => q.queryKey[0] === 'hr' && q.queryKey[1] === companyId && q.queryKey[2] === 'att-records' }
      await qc.cancelQueries(filters)
      const snapshot = qc.getQueriesData<Tables<'attendance_records'>[]>(filters)
      const now = new Date().toISOString()
      const d = new Date(); const today = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
      for (const [k, rows] of snapshot) {
        if (!Array.isArray(rows)) continue
        const open = rows.find((r) => r.work_date === today && r.check_in && !r.check_out)
        qc.setQueryData(k, open
          ? rows.map((r) => (r.id === open.id ? { ...r, check_out: now } : r))
          : [{ id: 'optimistic', work_date: today, check_in: now, check_out: null, hours_worked: 0 } as unknown as Tables<'attendance_records'>, ...rows])
      }
      return { snapshot }
    },
    onError: (e, _a, ctx) => { ctx?.snapshot.forEach(([k, v]) => qc.setQueryData(k, v)); toast.error(describeError(e)) },
    onSettled: () => void invalidate(),
  })
}

/* ------------------------------------------------------------------ payroll */
export type PayrollRun = Tables<'payroll_runs'>
export function usePayrollRuns() {
  const { companyId, key } = useCo()
  return useQuery({ queryKey: [...key, 'runs'], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('payroll_runs').select('*').eq('company_id', companyId).is('deleted_at', null).order('period_start', { ascending: false })) })
}
export function usePayrollRun(id: string | undefined) {
  const { companyId, key } = useCo()
  return useQuery({ queryKey: [...key, 'run', id], enabled: !!companyId && !!id,
    queryFn: async () => unwrap(await supabase.from('payroll_runs').select('*').eq('id', id!).single()) })
}
export type PayslipRow = Tables<'payslips'> & {
  employee: { full_name: string; number: string; personal_number: string | null; iban: string | null; department: { name: string } | null; position: { title: string } | null } | null
  lines: Tables<'payslip_lines'>[]
  run?: { number: string; period_start: string; period_end: string; pay_date: string; status: string; country_rules: string } | null
}
const SLIP_SELECT = '*, employee:employees!payslips_company_id_employee_id_fkey(full_name, number, personal_number, iban, department:departments!employees_company_id_department_id_fkey(name), position:job_positions!employees_company_id_position_id_fkey(title)), lines:payslip_lines(*), run:payroll_runs!payslips_company_id_payroll_run_id_fkey(number, period_start, period_end, pay_date, status, country_rules)'
export function usePayslips(runId: string | undefined) {
  const { companyId, key } = useCo()
  return useQuery({ queryKey: [...key, 'slips', runId], enabled: !!companyId && !!runId,
    queryFn: async () => unwrap(await supabase.from('payslips').select(SLIP_SELECT).eq('payroll_run_id', runId!).returns<PayslipRow[]>()) })
}
export function useEmployeePayslips(employeeId: string | undefined) {
  const { companyId, key } = useCo()
  return useQuery({ queryKey: [...key, 'emp-slips', employeeId], enabled: !!companyId && !!employeeId,
    queryFn: async () => {
      const rows = unwrap(await supabase.from('payslips').select(SLIP_SELECT).eq('employee_id', employeeId!).returns<PayslipRow[]>())
      if (rows.some((r) => !r.run)) {
        // self-service: employees cannot read payroll runs (company totals); only their own payslips' periods
        type Period = { payslip_id: string; run_number: string; period_start: string; period_end: string; pay_date: string; status: string }
        const rpc = supabase.rpc.bind(supabase) as unknown as (fn: string) => Promise<{ data: Period[] | null; error: null | { message: string } }>
        const { data } = await rpc('my_payslip_periods')
        const byId = new Map((data ?? []).map((p) => [p.payslip_id, p]))
        for (const r of rows) {
          const p = byId.get(r.id)
          if (!r.run && p) r.run = { number: p.run_number, period_start: p.period_start, period_end: p.period_end, pay_date: p.pay_date, status: p.status, country_rules: '' }
        }
      }
      return rows.sort((a, b) => (b.run?.period_start ?? '').localeCompare(a.run?.period_start ?? ''))
    } })
}
export type RunItem = Tables<'payroll_run_items'> & { employee: { full_name: string } | null }
export function useRunItems(runId: string | undefined) {
  const { companyId, key } = useCo()
  return useQuery({ queryKey: [...key, 'items', runId], enabled: !!companyId && !!runId,
    queryFn: async () => unwrap(await supabase.from('payroll_run_items').select('*, employee:employees!payroll_run_items_company_id_employee_id_fkey(full_name)')
      .eq('payroll_run_id', runId!).returns<RunItem[]>()) })
}
export function useSaveRunItem() {
  const { companyId } = useCompany()
  return useAction(async (v: { payroll_run_id: string; employee_id: string; code: string; name: string; amount: number }) =>
    unwrap(await supabase.from('payroll_run_items').insert({ ...v, company_id: companyId } as never)))
}
export const useDeleteRunItem = () => useAction(async (id: string) => unwrap(await supabase.from('payroll_run_items').delete().eq('id', id)))
export type RegisterRow = { line_no: number; employee_id: string; personal_number: string | null; last_name: string; first_name: string; job_title: string | null
  department: string | null; paid_days: number; gross: number; contribution_base: number; ss_employee: number; health_employee: number; ss_employer: number
  health_employer: number; taxable: number; income_tax: number; net: number; employer_cost: number; iban: string | null }
export function usePayrollRegister(runId: string | undefined, enabled: boolean) {
  const { companyId, key } = useCo()
  return useQuery({ queryKey: [...key, 'register', runId], enabled: !!companyId && !!runId && enabled,
    queryFn: async () => unwrap(await supabase.rpc('payroll_register', { p_run: runId! })) as RegisterRow[] })
}
export function useCreatePayrollRun() {
  const { companyId } = useCompany()
  return useAction(async (v: { year: number; month: number; pay_date: string }) =>
    unwrap(await supabase.rpc('create_payroll_run', { p_company: companyId, p_year: v.year, p_month: v.month, p_pay_date: v.pay_date })) as string)
}
export const useCalculatePayroll = () => useAction(async (id: string) => unwrap(await supabase.rpc('calculate_payroll', { p_run: id })))
export const useApprovePayroll = () => useAction(async (id: string) => unwrap(await supabase.rpc('approve_payroll', { p_run: id })))
export const useReopenPayroll = () => useAction(async (id: string) => unwrap(await supabase.rpc('reopen_payroll', { p_run: id })))
export const usePostPayroll = () => useAction(async (id: string) => unwrap(await supabase.rpc('post_payroll', { p_run: id })))
export const useCancelPayroll = () => useAction(async (id: string) => unwrap(await supabase.rpc('cancel_payroll', { p_run: id })))
export const usePayPayroll = () => useAction(async (a: { id: string; bank: string; date: string }) =>
  unwrap(await supabase.rpc('pay_payroll', { p_run: a.id, p_bank_account: a.bank, p_date: a.date })))

/* ------------------------------------------------------------------ managers: the team's leave */
export type TeamLeaveRow = { id: string; number: string; status: string; employee_id: string; employee: string; leave_type: string
  start_date: string; end_date: string; days: number; reason: string | null; created_at: string; remaining: number | null }
export function useMyTeamLeave() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...hrKeys.all(companyId), 'team-leave'],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('my_team_leave')) as unknown as TeamLeaveRow[],
  })
}
