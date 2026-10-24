import { CalendarPlus, Clock, LogIn, LogOut, UserRound } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { t, td, tn } from '@/i18n'
import { formatDateWith } from '@/i18n/format'
import { formatDate, formatMoney, formatMonth, formatQty, num, todayISO } from '@/lib/utils'
import { ErrorState } from '@/components/error-state'
import { useRealtimeInvalidate } from '@/hooks/use-realtime'
import { useCompany } from '@/app/company-provider'
import { useAttendanceRecords, useClock, useDecideLeave, useEmployeePayslips, useLeaveBalances, useLeaveRequests, useMyEmployee, useMyTeamLeave } from '../api'
import { NewLeaveDialog } from '../components/leave-dialog'
import { PayslipDialog } from '../components/payslip'
import { LeaveDialog } from './leave-page'

const time = (v: string | null | undefined) => v ? formatDateWith(new Date(v), { hour: '2-digit', minute: '2-digit' }) : '—'

export function MePage() {
  const me = useMyEmployee()
  if (me.isLoading) return <Skeleton className="h-96" />
  if (me.isError) return <ErrorState error={me.error} onRetry={() => void me.refetch()} />
  if (!me.data) return (
    <>
      <PageHeader title={t('My workplace')} />
      <EmptyState icon={UserRound} title={t('Your login is not linked to an employee yet')}
        description={t('Ask HR to link your login to your employee card. Then you can clock in, ask for leave and see your payslips here.')} />
    </>
  )
  return <MyWorkplace employeeId={me.data.id} name={me.data.full_name} subtitle={[me.data.position?.title, me.data.department?.name].filter(Boolean).join(' · ')} />
}

function MyWorkplace({ employeeId, name, subtitle }: { employeeId: string; name: string; subtitle: string }) {
  const today = todayISO()
  const weekAgo = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10)
  const att = useAttendanceRecords(employeeId, weekAgo, today)
  const clock = useClock()
  const year = new Date().getFullYear()
  const bal = useLeaveBalances(year, employeeId)
  const leave = useLeaveRequests(employeeId)
  const slips = useEmployeePayslips(employeeId)
  const [newLeave, setNewLeave] = React.useState(false)
  const [openLeave, setOpenLeave] = React.useState<string | null>(null)
  const [openSlip, setOpenSlip] = React.useState<string | null>(null)
  const todays = (att.data ?? []).filter((a) => a.work_date === today)
  const clockedIn = todays.some((a) => a.check_in && !a.check_out)
  const hoursToday = todays.reduce((s, a) => s + num(a.hours_worked), 0)
  const annual = bal.data?.[0]
  const leaveRow = leave.data?.find((l) => l.id === openLeave)
  const slip = slips.data?.find((s) => s.id === openSlip)
  const { companyId } = useCompany()
  useRealtimeInvalidate('leave_requests', companyId, [['hr', companyId, 'leave'], ['hr', companyId, 'balances']])
  return (
    <>
      <PageHeader title={t('Hello, {name}', { name: name.split(' ')[0] ?? '' })} description={subtitle || t('Your hours, leave and payslips.')}
        actions={<Button variant="outline" onClick={() => setNewLeave(true)}><CalendarPlus /> {t('Ask for leave')}</Button>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2"><Clock className="size-4" /> {t('Today')}</CardTitle>
            <CardDescription>{formatDateWith(new Date(), { weekday: 'long', day: 'numeric', month: 'long' })}</CardDescription></CardHeader>
          <CardContent className="grid gap-3">
            <div className="text-[13px]">{todays.length
              ? todays.map((a) => <div key={a.id} className="flex justify-between"><span>{t('In {time}', { time: time(a.check_in) })}</span><span>{a.check_out ? t('Out {time}', { time: time(a.check_out) }) : t('Still at work')}</span></div>)
              : <span className="text-muted-foreground">{t('You have not clocked in today.')}</span>}
              {hoursToday > 0 && <div className="mt-1 text-muted-foreground">{t('{h} h worked', { h: formatQty(hoursToday.toFixed(2)) })}</div>}</div>
            <Button size="lg" variant={clockedIn ? 'outline' : 'default'} loading={clock.isPending}
              onClick={async () => { const r = await clock.mutateAsync(); toast.success(r.action === 'in' ? t('Clocked in at {time}', { time: time(r.at) }) : t('Clocked out at {time}', { time: time(r.at) })) }}>
              {clockedIn ? <><LogOut /> {t('Clock out')}</> : <><LogIn /> {t('Clock in')}</>}</Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle>{t('Leave {year}', { year })}</CardTitle><CardDescription>{t('Working days left')}</CardDescription></CardHeader>
          <CardContent className="grid gap-2">
            {bal.isLoading ? <Skeleton className="h-16" /> : !bal.data?.length ? <p className="text-[13px] text-muted-foreground">{t('No leave days set for you yet.')}</p> : bal.data.map((b) => (
              <div key={b.leave_type_id}>
                <div className="flex items-baseline justify-between"><span className="text-[13px]">{td(b.leave_type)}</span>
                  <span className="tabular text-2xl font-semibold">{formatQty(b.remaining)}<span className="ml-1 text-sm font-normal text-muted-foreground">{t('of {n}', { n: formatQty(b.entitlement) })}</span></span></div>
                <div className="mt-1 h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, (num(b.remaining) / Math.max(num(b.entitlement), 1)) * 100))}%` }} /></div>
                {num(b.pending) > 0 && <div className="mt-1 text-xs text-muted-foreground">{tn(num(b.pending), '{n} day waiting for approval', '{n} days waiting for approval')}</div>}
              </div>))}
            {annual && num(annual.remaining) <= 0 && <p className="text-xs text-muted-foreground">{t('You can still ask for unpaid leave.')}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle>{t('Last payslip')}</CardTitle><CardDescription>{t('Appears once the month\'s payroll is final')}</CardDescription></CardHeader>
          <CardContent>
            {slips.isLoading ? <Skeleton className="h-16" /> : !slips.data?.length ? <p className="text-[13px] text-muted-foreground">{t('No payslips yet.')}</p> : (
              <button type="button" className="w-full rounded-md text-left hover:bg-muted/40" onClick={() => setOpenSlip(slips.data![0]!.id)}>
                <div className="text-[13px] text-muted-foreground">{slips.data[0]!.run && formatMonth(`${slips.data[0]!.run.period_start}T00:00:00`)}</div>
                <div className="tabular text-2xl font-semibold">{formatMoney(slips.data[0]!.net_salary)}</div>
                <div className="text-xs text-muted-foreground">{t('net · gross {amount}', { amount: formatMoney(slips.data[0]!.gross_salary) })}</div>
              </button>)}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="py-3"><CardTitle>{t('My leave requests')}</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <Table><TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Dates')}</TableHead><TableHead>{t('Type')}</TableHead><TableHead className="text-right">{t('Days')}</TableHead><TableHead>{t('Status')}</TableHead></TableRow></TableHeader>
              <TableBody>{(leave.data ?? []).map((l) => (
                <TableRow key={l.id} className="cursor-pointer" onClick={() => setOpenLeave(l.id)}>
                  <TableCell className="tabular">{formatDate(l.start_date)} – {formatDate(l.end_date)}</TableCell><TableCell>{td(l.type?.name)}</TableCell>
                  <TableCell className="text-right tabular">{formatQty(l.days)}</TableCell><TableCell><StatusBadge status={l.status} /></TableCell></TableRow>))}
                {!leave.isLoading && !leave.data?.length && <TableRow><TableCell colSpan={4} className="py-6 text-center text-[13px] text-muted-foreground">{t('No requests yet. Use “Ask for leave” above.')}</TableCell></TableRow>}
              </TableBody></Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="py-3"><CardTitle>{t('My payslips')}</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <Table><TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Month')}</TableHead><TableHead className="text-right">{t('Gross')}</TableHead><TableHead className="text-right">{t('Net')}</TableHead></TableRow></TableHeader>
              <TableBody>{(slips.data ?? []).map((s) => (
                <TableRow key={s.id} className="cursor-pointer" onClick={() => setOpenSlip(s.id)}>
                  <TableCell>{s.run && formatMonth(`${s.run.period_start}T00:00:00`)}</TableCell>
                  <TableCell className="text-right tabular">{formatMoney(s.gross_salary)}</TableCell><TableCell className="text-right tabular font-medium">{formatMoney(s.net_salary)}</TableCell></TableRow>))}
                {!slips.isLoading && !slips.data?.length && <TableRow><TableCell colSpan={3} className="py-6 text-center text-[13px] text-muted-foreground">{t('No payslips yet.')}</TableCell></TableRow>}
              </TableBody></Table>
          </CardContent>
        </Card>
      </div>
      <TeamLeave />
      {newLeave && <NewLeaveDialog employeeId={employeeId} onClose={() => setNewLeave(false)} />}
      {leaveRow && <LeaveDialog self leave={leaveRow} onClose={() => setOpenLeave(null)} />}
      {slip && <PayslipDialog slip={slip} onClose={() => setOpenSlip(null)} />}
    </>
  )
}

/** For managers: requests from the people who report to them */
function TeamLeave() {
  const team = useMyTeamLeave()
  const decide = useDecideLeave()
  const [rejecting, setRejecting] = React.useState<string | null>(null)
  const [note, setNote] = React.useState('')
  // a manager's notification links to /hr/me#team
  React.useEffect(() => { if (team.data?.length && location.hash === '#team') document.getElementById('team')?.scrollIntoView({ behavior: 'smooth' }) }, [team.data])
  if (!team.data?.length) return null
  const waiting = team.data.filter((r) => r.status === 'submitted')
  return (
    <Card id="team" className="mt-4 scroll-mt-20">
      <CardHeader className="py-3">
        <CardTitle>{t('Your team\'s leave')}</CardTitle>
        <CardDescription>{waiting.length ? tn(waiting.length, '{n} request waits for your decision.', '{n} requests wait for your decision.') : t('Nothing waits for you. Upcoming approved leave is listed below.')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-0 p-0">
        {team.data.map((r) => (
          <div key={r.id} className="flex flex-col gap-2 border-t px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-[13px]">
              <span className="font-medium">{r.employee}</span> · {td(r.leave_type)} · <span className="tabular">{formatDate(r.start_date)} – {formatDate(r.end_date)}</span> ({tn(num(r.days), '{n} day', '{n} days')})
              <span className="block text-xs text-muted-foreground">{r.reason ? `“${r.reason}” · ` : ''}{r.remaining !== null ? t('{n} days left after this', { n: formatQty(r.remaining) }) : t('No yearly limit')}</span>
            </div>
            {r.status === 'submitted' ? (
              rejecting === r.id ? (
                <div className="flex shrink-0 gap-2">
                  <Input autoFocus aria-label={t('Reason for rejecting')} placeholder={t('Why not?')} value={note} onChange={(e) => setNote(e.target.value)} className="h-8 w-44" />
                  <Button size="sm" variant="destructive" loading={decide.isPending} onClick={() => void decide.mutateAsync({ id: r.id, approve: false, note }).then(() => { toast.success(t('Leave rejected')); setRejecting(null); setNote('') })}>{t('Reject')}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setRejecting(null)}>{t('Cancel')}</Button>
                </div>
              ) : (
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" variant="outline" onClick={() => { setRejecting(r.id); setNote('') }}>{t('Reject')}</Button>
                  <Button size="sm" loading={decide.isPending && decide.variables?.id === r.id} onClick={() => void decide.mutateAsync({ id: r.id, approve: true }).then(() => toast.success(t('Leave approved for {name}', { name: r.employee })))}>{t('Approve leave')}</Button>
                </div>
              )
            ) : <StatusBadge status={r.status} />}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
