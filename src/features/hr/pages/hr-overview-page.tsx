import { CalendarDays, Plus, Settings2, Wallet } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Can, useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/error-state'
import { t, td, tServer } from '@/i18n'
import { formatDateWith } from '@/i18n/format'
import { formatCompact, formatDate, formatMoney, num } from '@/lib/utils'
import { useHrOverview } from '../api'

const tooltipStyle = { background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }
const axisTick = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' }
const monthLabel = (p: string) => formatDateWith(new Date(`${p}-01T00:00:00`), { month: 'short', year: '2-digit' })

export function HrOverviewPage() {
  const { company, can } = useCompany()
  const ov = useHrOverview()
  const d = ov.data
  const max = Math.max(1, ...(d?.by_department ?? []).map((x) => num(x.count)))
  const trend = (d?.payroll_trend ?? []).map((x) => ({ ...x, label: monthLabel(x.period), gross: num(x.gross), employer_cost: num(x.employer_cost), net: num(x.net) }))
  if (ov.isError) return <><PageHeader title={t('People overview')} /><ErrorState error={ov.error} onRetry={() => void ov.refetch()} /></>
  return (
    <>
      <PageHeader title={t('People')} description={t('Who works here, who is away today, and what salaries cost.')}
        actions={<>
          <Button variant="outline" asChild><Link to="/hr/setup"><Settings2 /> {t('HR setup')}</Link></Button>
          <Can perm="hr.write"><Button asChild><Link to="/hr/employees/new"><Plus /> {t('New employee')}</Link></Button></Can>
        </>} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('Employees')} value={d?.headcount ?? 0} loading={ov.isLoading} href="/hr/employees"
          hint={t('{joined} joined · {left} left in the last 90 days', { joined: d?.joiners_90d ?? 0, left: d?.leavers_90d ?? 0 })} />
        <StatCard label={t('At work today')} value={d?.present_today ?? 0} loading={ov.isLoading} href="/hr/attendance" hint={t('Clocked in at least once today')} />
        <StatCard label={t('On leave today')} value={d?.on_leave_today ?? 0} loading={ov.isLoading} href="/hr/leave" hint={t('Approved leave that includes today')} />
        <StatCard label={t('Leave to decide')} value={d?.pending_leave ?? 0} loading={ov.isLoading} tone={d?.pending_leave ? 'warning' : 'default'}
          href="/hr/leave?status=submitted" hint={t('Requests waiting for a manager or HR')} />
      </div>

      <div className="mt-4 grid gap-4 grid-cols-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader className="pb-2"><CardTitle>{t('Salary cost')}</CardTitle>
            <CardDescription>{t('Final monthly payrolls in {currency}: gross pay plus employer contributions, and what employees received.', { currency: company?.base_currency ?? 'ALL' })}</CardDescription></CardHeader>
          <CardContent>
            {ov.isLoading ? <Skeleton className="h-56" /> : !can('payroll.read') ? <p className="py-16 text-center text-[13px] text-muted-foreground">{t('You need access to payroll to see these figures.')}</p>
              : !trend.length ? <EmptyState compact icon={Wallet} title={t('No final payroll yet')} description={t('Run the first monthly payroll to see the cost here.')}
                  action={<Button size="sm" variant="outline" asChild><Link to="/hr/payroll">{t('Open payroll')}</Link></Button>} /> : (
              <div className="h-56"><ResponsiveContainer><ComposedChart data={trend} margin={{ left: -6, right: 6 }}>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatCompact(v)} width={52} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'hsl(var(--muted))' }}
                  formatter={(v: number, k: string) => [formatMoney(v), k === 'employer_cost' ? t('Employer cost') : k === 'net' ? t('Net pay') : t('Gross')]} />
                <Bar dataKey="employer_cost" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} isAnimationActive={false} maxBarSize={44} />
                <Line dataKey="net" stroke="hsl(var(--muted-foreground))" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
              </ComposedChart></ResponsiveContainer></div>
            )}
            {!!trend.length && <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-primary" /> {t('Employer cost')}</span>
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 bg-muted-foreground" /> {t('Net pay')}</span></div>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle>{t('By department')}</CardTitle><CardDescription>{t('Current employees')}</CardDescription></CardHeader>
          <CardContent className="grid gap-2.5">
            {ov.isLoading ? <Skeleton className="h-40" /> : (d?.by_department ?? []).map((x) => (
              <div key={x.department} className="grid gap-1 text-[13px]">
                <div className="flex justify-between"><span>{tServer(td(x.department))}</span><span className="tabular text-muted-foreground">{x.count}</span></div>
                <div className="h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-primary/70" style={{ width: `${(num(x.count) / max) * 100}%` }} /></div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle>{t('Away in the next 30 days')}</CardTitle><CardDescription>{t('Approved leave')}</CardDescription></CardHeader>
          <CardContent className="p-0 pb-2">
            {ov.isLoading ? <Skeleton className="m-4 h-24" /> : !d?.upcoming_leave.length
              ? <p className="px-4 pb-3 text-[13px] text-muted-foreground">{t('Nobody has leave booked in the next 30 days.')}</p>
              : d.upcoming_leave.map((l, i) => (
                <div key={i} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 border-b px-4 py-2 text-[13px] last:border-0">
                  <span className="flex min-w-0 items-center gap-2"><CalendarDays className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate"><span className="font-medium">{l.employee}</span> · {td(l.type)}</span></span>
                  <span className="shrink-0 tabular text-muted-foreground">{formatDate(l.start)} – {formatDate(l.end)} · {t('{n} d', { n: num(l.days) })}</span>
                </div>))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle>{t('Contracts ending')}</CardTitle><CardDescription>{t('Fixed-term contracts that end in the next 60 days')}</CardDescription></CardHeader>
          <CardContent className="p-0 pb-2">
            {ov.isLoading ? <Skeleton className="m-4 h-24" /> : !d?.contracts_ending_60d.length
              ? <p className="px-4 pb-3 text-[13px] text-muted-foreground">{t('No contract ends in the next 60 days.')}</p>
              : d.contracts_ending_60d.map((c) => (
                <Link key={c.employee_id} to={`/hr/employees/${c.employee_id}`} className="flex justify-between gap-3 border-b px-4 py-2 text-[13px] last:border-0 hover:bg-muted/40">
                  <span className="font-medium">{c.employee}</span><span className="tabular text-muted-foreground">{t('ends {date}', { date: formatDate(c.end_date) })}</span>
                </Link>))}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
