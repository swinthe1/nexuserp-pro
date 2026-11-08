import { AlertTriangle, ArrowRight, Cable, CheckCircle2, CircleDollarSign, DatabaseBackup, Fingerprint, KeyRound, Server, ShieldAlert, ShieldCheck, Sparkles, TrendingDown, UserPlus, Users, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateWith, msg, t, tn } from '@/i18n'
import { formatDate, formatMoney } from '@/lib/utils'
import { type Attention, useBackupStatus, usePlatformOverview, useServerStatus } from '../api'
import { alertText } from './server-page'
import { planLabel } from '../dialogs'
import { EventRow } from './events'

/** what each thing that needs attention says, and where it is fixed */
const ATTENTION: Record<Attention['kind'], { icon: LucideIcon; title: string; action: string; tone: 'danger' | 'warn' | 'info'; href: (a: Attention) => string }> = {
  licence_expired: { icon: ShieldAlert, title: msg('The licence has ended'), action: msg('Renew'), tone: 'danger', href: (a) => `/platform/clients/${a.company_id}?tab=licence` },
  licence_ending: { icon: ShieldCheck, title: msg('The licence ends soon'), action: msg('Renew'), tone: 'warn', href: (a) => `/platform/clients/${a.company_id}?tab=licence` },
  link_error: { icon: Cable, title: msg('The live link has an error'), action: msg('Look'), tone: 'danger', href: (a) => `/platform/clients/${a.company_id}?tab=links` },
  link_quiet: { icon: Cable, title: msg('The live link has not sent anything for a day'), action: msg('Look'), tone: 'warn', href: (a) => `/platform/clients/${a.company_id}?tab=links` },
  local_quiet: { icon: Server, title: msg('The local server has not been seen for a day'), action: msg('Look'), tone: 'warn', href: () => '/platform/servers' },
  pending_account: { icon: UserPlus, title: msg('An invited person has no account yet'), action: msg('Make the account'), tone: 'info', href: (a) => `/platform/clients/${a.company_id}?tab=people` },
  seats_full: { icon: Users, title: msg('All the licence’s users are taken'), action: msg('Add users'), tone: 'info', href: (a) => `/platform/clients/${a.company_id}?tab=licence` },
  fiscal_failed: { icon: Fingerprint, title: msg('Fiscalization was refused'), action: msg('Look'), tone: 'danger', href: (a) => `/platform/clients/${a.company_id}` },
  no_sales: { icon: TrendingDown, title: msg('No sales for a week'), action: msg('Call the client'), tone: 'warn', href: (a) => `/platform/clients/${a.company_id}` },
}

function attentionDetail(a: Attention) {
  if (a.kind === 'licence_ending') return tn(a.days ?? 0, 'Ends on {date}, in {n} day', 'Ends on {date}, in {n} days', { date: formatDate(a.at ?? '') })
  if (a.kind === 'licence_expired') return t('Ended on {date}', { date: formatDate(a.at ?? '') })
  if (a.kind === 'link_error') return [a.name, a.detail].filter(Boolean).join(': ')
  if (a.kind === 'link_quiet' || a.kind === 'local_quiet') return a.at ? t('Last seen {date}', { date: formatDate(a.at, true) }) : t('Never seen')
  if (a.kind === 'pending_account') return a.detail ?? ''
  if (a.kind === 'seats_full') return t('{n} users', { n: a.detail ?? '' })
  if (a.kind === 'fiscal_failed') return tn(Number(a.detail ?? 0), '{n} document in the last 7 days', '{n} documents in the last 7 days')
  if (a.kind === 'no_sales') return t('Last sale {date}', { date: formatDate(a.at ?? '', true) })
  return ''
}

export function OverviewPage() {
  const q = usePlatformOverview()
  const backups = useBackupStatus()
  const server = useServerStatus(1)
  const d = q.data
  const srvAlerts = server.data?.alerts ?? []
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  const chart = (d?.new_by_month ?? []).map((m) => ({ month: formatDateWith(new Date(`${m.month}-01T00:00:00`), { month: 'short' }), n: m.n }))
  const lastCopy = backups.data?.last_ok?.at
  const copyOld = lastCopy ? Date.now() - new Date(lastCopy).getTime() > 36 * 3600_000 : true
  const plans = Object.entries(d?.by_plan ?? {}).sort((a, b) => b[1] - a[1])
  const planTotal = plans.reduce((s, [, n]) => s + n, 0)
  return (
    <>
      <PageHeader icon={false} title={t('Overview')} description={t('How the platform stands today: the clients, their licences, the servers and what needs you.')} />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard icon={Users} hue="152 68%" label={t('Active clients')} loading={q.isLoading} value={d?.active ?? 0} href="/platform/clients"
          hint={d ? t('of {n} · {training} in training · {paused} paused', { n: d.clients, training: d.training, paused: d.suspended }) : undefined} />
        <StatCard icon={KeyRound} hue="204 82%" label={t('Users')} loading={q.isLoading} value={d?.users ?? 0} href="/platform/clients"
          hint={d ? t('of {n} places in the licences', { n: d.seats }) : undefined} />
        <StatCard icon={CircleDollarSign} hue="158 82%" label={t('Income a month, from licences (without VAT)')} loading={q.isLoading}
          value={d?.income_month != null ? formatMoney(d.income_month) : '—'} href="/platform/prices"
          hint={d && !d.priced ? t('Set the prices to see it') : t('By the price list, active clients only')} />
        <StatCard icon={ShieldCheck} hue="32 90%" label={t('Licences ending in 30 days')} loading={q.isLoading} value={(d?.ending ?? 0) + (d?.expired ?? 0)} href="/platform/licences"
          tone={d?.expired ? 'destructive' : d?.ending ? 'warning' : 'default'} hint={d ? t('{n} already ended', { n: d.expired }) : undefined} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard icon={Server} hue="262 60%" label={t('Local servers online')} loading={q.isLoading} value={d ? `${d.local_online} / ${d.local_servers}` : ''} href="/platform/servers"
          hint={d && Object.keys(d.local_versions).length ? Object.entries(d.local_versions).map(([v, n]) => `${v}: ${n}`).join(' · ') : t('None yet')} />
        <StatCard icon={Cable} hue="188 78%" label={t('Live links')} loading={q.isLoading} value={d?.links.active ?? 0} href="/platform/links"
          tone={d?.links.errors ? 'destructive' : 'default'} hint={d ? t('{e} with an error · {q} quiet for a day', { e: d.links.errors, q: d.links.quiet }) : undefined} />
        <StatCard icon={Sparkles} hue="292 55%" label={t('Read from photos this month')} loading={q.isLoading} value={d?.reads_month.total ?? 0}
          tone={d?.reads_month.failed ? 'warning' : 'default'} hint={d ? t('{n} not read', { n: d.reads_month.failed }) : undefined} />
        <StatCard icon={DatabaseBackup} hue="152 68%" label={t('Last database copy')} loading={backups.isLoading} value={lastCopy ? formatDate(lastCopy, true) : t('None yet')}
          tone={copyOld ? 'warning' : 'default'} href="/platform/backups" hint={backups.data ? t('{n} copies this week', { n: backups.data.copies_week }) : undefined} />
      </div>

      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card>
          <CardHeader><CardTitle>{t('Needs you')}</CardTitle><CardDescription>{t('The most urgent first. Each one opens where it is fixed.')}</CardDescription></CardHeader>
          <CardContent className="pt-0">
            {/* the server itself first: when it is in trouble, everyone is */}
            {srvAlerts.length > 0 && (
              <ul className="mb-2 divide-y rounded-lg border border-destructive/30">
                {srvAlerts.map((a, i) => (
                  <li key={i} className="flex items-center gap-3 px-3 py-2.5">
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-destructive/10 text-destructive"><Server className="size-4" /></span>
                    <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-medium">{t('Server (VPS)')} · <span className="font-normal">{alertText(a)}</span></div>
                      {a.detail && <div className="truncate text-xs text-muted-foreground">{a.detail}</div>}</div>
                    <Button variant="outline" size="sm" asChild className="shrink-0"><Link to="/platform/server">{t('Look')}</Link></Button>
                  </li>
                ))}
              </ul>
            )}
            {q.isLoading ? <Skeleton className="h-40" /> : !d?.attention.length ? (srvAlerts.length ? null : (
              <div className="flex items-center gap-3 rounded-lg border border-success/30 bg-success/5 p-4 text-sm"><CheckCircle2 className="size-5 text-success" />{t('Nothing waits for you. Everything runs.')}</div>
            )) : (
              <ul className="divide-y rounded-lg border">
                {d.attention.slice(0, 12).map((a, i) => {
                  const x = ATTENTION[a.kind]
                  const Icon = x?.icon ?? AlertTriangle
                  return (
                    <li key={i} className="flex items-center gap-3 px-3 py-2.5">
                      <span className={x?.tone === 'danger' ? 'grid size-8 shrink-0 place-items-center rounded-lg bg-destructive/10 text-destructive'
                        : x?.tone === 'warn' ? 'grid size-8 shrink-0 place-items-center rounded-lg bg-warning/10 text-warning' : 'grid size-8 shrink-0 place-items-center rounded-lg bg-info/10 text-info'}>
                        <Icon className="size-4" /></span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium">{a.company_name} · <span className="font-normal">{x ? t(x.title) : a.kind}</span></div>
                        <div className="truncate text-xs text-muted-foreground">{attentionDetail(a)}</div>
                      </div>
                      {x && <Button variant="outline" size="sm" asChild className="shrink-0"><Link to={x.href(a)}>{t(x.action)}</Link></Button>}
                    </li>
                  )
                })}
              </ul>
            )}
            {(d?.attention.length ?? 0) > 12 && <p className="mt-2 text-xs text-muted-foreground">{t('and {n} more', { n: d!.attention.length - 12 })}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div><CardTitle>{t('Latest on the platform')}</CardTitle><CardDescription>{t('Who did what, from the diary')}</CardDescription></div>
            <Button variant="ghost" size="sm" asChild><Link to="/platform/diary">{t('The diary')} <ArrowRight /></Link></Button>
          </CardHeader>
          <CardContent className="pt-0">
            {q.isLoading ? <Skeleton className="h-40" /> : !d?.events.length ? <p className="py-6 text-center text-[13px] text-muted-foreground">{t('Nothing yet. From now on every change is written here.')}</p>
              : <ul className="divide-y">{d.events.slice(0, 8).map((e) => <EventRow key={e.id} e={e} />)}</ul>}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card>
          <CardHeader><CardTitle>{t('New clients by month')}</CardTitle><CardDescription>{t('The last twelve months, without training companies')}</CardDescription></CardHeader>
          <CardContent>
            {q.isLoading ? <Skeleton className="h-56" /> : (
              <div className="h-56">
                <ResponsiveContainer>
                  <BarChart data={chart} margin={{ left: -24, right: 4 }}>
                    <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                    <Tooltip cursor={{ fill: 'hsl(var(--muted))' }} contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                      formatter={(v: number) => [v, t('New clients')]} />
                    <Bar dataKey="n" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t('Clients by plan')}</CardTitle><CardDescription>{t('Without training companies')}</CardDescription></CardHeader>
          <CardContent className="grid gap-3">
            {q.isLoading ? <Skeleton className="h-32" /> : plans.map(([p, n]) => (
              <div key={p}>
                <div className="mb-1 flex justify-between text-[13px]"><span className="font-medium">{p === '-' ? t('No licence') : planLabel(p)}</span><span className="tabular text-muted-foreground">{n}</span></div>
                <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${planTotal ? (n / planTotal) * 100 : 0}%` }} /></div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
