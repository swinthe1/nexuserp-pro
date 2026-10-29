import { AlertTriangle, CheckCircle2, Cpu, Database, Globe, HardDrive, MemoryStick, Network, RefreshCw, ScrollText, Server, Timer } from 'lucide-react'
import * as React from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDateWith, msg, t, tn } from '@/i18n'
import { cn, formatDate } from '@/lib/utils'
import { type ServerAlert, type ServerStatus, useServerLog, useServerStatus } from '../api'

export const bytes = (b: number | null | undefined) => {
  if (b == null) return '—'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let v = b
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`
}
const rate = (b: number) => `${bytes(b)}/s`
function duration(s: number) {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
  return d ? t('{d} d {h} h', { d, h }) : h ? t('{h} h {m} min', { h, m }) : t('{m} min', { m })
}
const tone = (pct: number, warn = 75, bad = 90) => (pct >= bad ? 'bad' : pct >= warn ? 'warn' : 'ok')

/** what each problem says */
const ALERT: Record<ServerAlert['kind'], string> = {
  monitor_quiet: msg('The server has not reported for over 5 minutes'),
  cpu_high: msg('The processor works at {value}% for 10 minutes'),
  mem_high: msg('Memory is {value}% full'),
  disk_high: msg('The disk {name} is {value}% full'),
  check_failed: msg('{name} does not answer'),
  cert_soon: msg('The SSL certificate of {name} ends in {value} days'),
  container_down: msg('The container {name} is not running'),
  container_unhealthy: msg('The container {name} reports a problem'),
  many_errors: msg('{value} errors in the logs in the last hour'),
}
export const alertText = (a: ServerAlert) => t(ALERT[a.kind] ?? a.kind, { name: a.name ?? '', value: a.value ?? '' })

function Meter({ icon: Icon, label, pct, main, sub }: { icon: typeof Cpu; label: string; pct: number | null; main: string; sub?: string }) {
  const k = pct == null ? 'ok' : tone(pct)
  return (
    <Card>
      <CardContent className="grid gap-2 p-4">
        <div className="flex items-center justify-between text-[13px] font-medium text-muted-foreground"><span>{label}</span><Icon className="size-4" /></div>
        <div className={cn('text-2xl font-bold tabular leading-none', k === 'bad' && 'text-destructive', k === 'warn' && 'text-warning')}>{main}</div>
        {pct != null && <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn('h-full rounded-full', k === 'bad' ? 'bg-destructive' : k === 'warn' ? 'bg-warning' : 'bg-primary')} style={{ width: `${Math.min(100, pct)}%` }} /></div>}
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  )
}

const tip = { background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }
const tick = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' }

export function ServerPage() {
  const [hours, setHours] = React.useState(24)
  const q = useServerStatus(hours)
  const [log, setLog] = React.useState<string | null>(null)
  if (q.isLoading) return <Skeleton className="h-[600px]" />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  const d = q.data!
  const L = d.last
  return (
    <>
      <PageHeader icon={false} title={t('Server (VPS)')}
        description={L ? [L.host.hostname, L.host.os, L.host.kernel && `Linux ${L.host.kernel}`, L.host.docker && `Docker ${L.host.docker}`].filter(Boolean).join(' · ')
          : t('The server reports here every minute: processor, memory, disks, containers and the errors in their logs.')}
        actions={<>
          <Select value={String(hours)} onValueChange={(v) => setHours(Number(v))}>
            <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">{t('Last hour')}</SelectItem><SelectItem value="6">{t('Last 6 hours')}</SelectItem>
              <SelectItem value="24">{t('Last 24 hours')}</SelectItem><SelectItem value="168">{t('Last 7 days')}</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => void q.refetch()} loading={q.isFetching}><RefreshCw /> {t('Refresh')}</Button>
        </>} />

      {!L ? (
        <Card><CardContent className="grid justify-items-center gap-2 p-10 text-center">
          <Server className="size-8 text-muted-foreground" />
          <p className="font-medium">{t('The server has not reported yet')}</p>
          <p className="max-w-lg text-[13px] text-muted-foreground">{t('Run Perditeso-serverin.bat once: it installs the monitor, and a minute later the server shows here.')}</p>
        </CardContent></Card>
      ) : <>
        {d.alerts.length > 0 ? (
          <div className="mb-4 grid gap-2">
            {d.alerts.map((a, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px]">
                <AlertTriangle className="size-4 shrink-0 text-destructive" /><span className="font-medium">{alertText(a)}</span>
                {a.detail && <span className="truncate text-muted-foreground">· {a.detail}</span>}
              </div>
            ))}
          </div>
        ) : (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-success/30 bg-success/5 px-3 py-2 text-[13px]">
            <CheckCircle2 className="size-4 text-success" /> {t('Everything runs. Last report {date}.', { date: formatDate(L.at, true) })}
          </div>
        )}

        <ServerMeters d={d} />
        <ServerCharts d={d} />

        <TopProcesses d={d} />
        <div className="mt-4"><Containers d={d} onLog={setLog} /></div>
        <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-2">
          <Checks d={d} />
          <DbCard d={d} />
        </div>
        <Errors d={d} hours={hours} onLog={setLog} />
      </>}
      <LogDialog container={log} onClose={() => setLog(null)} />
    </>
  )
}

function ServerMeters({ d }: { d: ServerStatus }) {
  const L = d.last!
  const memUsed = L.mem_total - L.mem_available
  const memPct = (memUsed / L.mem_total) * 100
  const s = d.series
  const now = s[s.length - 1]
  const root = L.disks[0]
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      <Meter icon={Cpu} label={t('Processor')} pct={L.cpu_pct} main={`${Math.round(L.cpu_pct)}%`} sub={t('{n} cores · load {a} / {b} / {c}', { n: L.cores, a: L.load1, b: L.load5, c: L.load15 })} />
      <Meter icon={MemoryStick} label={t('Memory')} pct={memPct} main={`${Math.round(memPct)}%`} sub={t('{used} of {total}', { used: bytes(memUsed), total: bytes(L.mem_total) })} />
      {root && <Meter icon={HardDrive} label={t('Disk')} pct={(root.used / root.total) * 100} main={`${Math.round((root.used / root.total) * 100)}%`} sub={t('{free} free of {total}', { free: bytes(root.free), total: bytes(root.total) })} />}
      <Meter icon={MemoryStick} label={t('Swap')} pct={L.swap_total ? (L.swap_used / L.swap_total) * 100 : null} main={L.swap_total ? bytes(L.swap_used) : t('None')} sub={L.swap_total ? t('of {total}', { total: bytes(L.swap_total) }) : undefined} />
      <Meter icon={Network} label={t('Network now')} pct={null} main={now ? `↓ ${rate(now.rx)}` : '—'} sub={now ? `↑ ${rate(now.tx)}` : undefined} />
      <Meter icon={Timer} label={t('Running for')} pct={null} main={duration(L.uptime_s)} sub={L.host.boot ? t('since {date}', { date: formatDate(L.host.boot, true) }) : undefined} />
    </div>
  )
}

function ServerCharts({ d }: { d: ServerStatus }) {
  const long = d.series.length > 1 && new Date(d.series[d.series.length - 1]!.at).getTime() - new Date(d.series[0]!.at).getTime() > 36 * 3600_000
  const data = d.series.map((x) => ({ ...x, label: formatDateWith(new Date(x.at), long ? { day: 'numeric', hour: '2-digit' } : { hour: '2-digit', minute: '2-digit' }) }))
  return (
    <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>{t('Processor and memory')}</CardTitle><CardDescription>{t('In percent, over the chosen time')}</CardDescription></CardHeader>
        <CardContent><div className="h-56"><ResponsiveContainer>
          <AreaChart data={data} margin={{ left: -20, right: 4 }}>
            <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
            <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={false} minTickGap={40} />
            <YAxis domain={[0, 100]} tick={tick} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={tip} formatter={(v: number, n: string) => [`${v}%`, n === 'cpu' ? t('Processor') : t('Memory')]} />
            <Area type="monotone" dataKey="mem" stroke="hsl(204 82% 50%)" fill="hsl(204 82% 50% / 0.12)" strokeWidth={1.5} />
            <Area type="monotone" dataKey="cpu" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.15)" strokeWidth={1.5} />
          </AreaChart>
        </ResponsiveContainer></div></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t('Network')}</CardTitle><CardDescription>{t('Received and sent, a second')}</CardDescription></CardHeader>
        <CardContent><div className="h-56"><ResponsiveContainer>
          <AreaChart data={data} margin={{ left: 4, right: 4 }}>
            <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
            <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={false} minTickGap={40} />
            <YAxis tick={tick} tickLine={false} axisLine={false} tickFormatter={(v: number) => bytes(v)} width={64} />
            <Tooltip contentStyle={tip} formatter={(v: number, n: string) => [rate(v), n === 'rx' ? t('Received') : t('Sent')]} />
            <Area type="monotone" dataKey="rx" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.15)" strokeWidth={1.5} />
            <Area type="monotone" dataKey="tx" stroke="hsl(32 90% 50%)" fill="hsl(32 90% 50% / 0.12)" strokeWidth={1.5} />
          </AreaChart>
        </ResponsiveContainer></div></CardContent>
      </Card>
    </div>
  )
}

/** Coolify's builder: it runs only while an app is built */
const isBuilder = (c: { image: string | null; name: string }) => (c.image ?? '').startsWith('moby/buildkit') || c.name.startsWith('buildx_buildkit')

/** the busiest programs on the whole server, inside a container or not */
function TopProcesses({ d }: { d: ServerStatus }) {
  const top = d.last!.host.top ?? []
  if (!top.length) return null
  return (
    <Card className="mt-4">
      <CardHeader><CardTitle className="flex items-center gap-2"><Cpu className="size-4" /> {t('The busiest processes')}</CardTitle>
        <CardDescription>{t('What used the processor over the last minute, on the whole server. 100% is one core of {n}.', { n: d.last!.cores })}</CardDescription></CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <Table className="min-w-[760px]">
          <TableHeader><TableRow className="hover:bg-transparent">
            <TableHead className="text-right">{t('Processor')}</TableHead><TableHead className="text-right">{t('Memory')}</TableHead><TableHead>{t('Container')}</TableHead><TableHead>{t('Program')}</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {top.map((p) => (
              <TableRow key={p.pid}>
                <TableCell className={cn('text-right font-medium tabular', p.cpu >= 50 && 'text-destructive', p.cpu >= 20 && p.cpu < 50 && 'text-warning')}>{p.cpu}%</TableCell>
                <TableCell className="text-right tabular">{p.mem}%</TableCell>
                <TableCell className="max-w-[220px] truncate text-[13px]">{p.container || <span className="text-muted-foreground">{t('the server itself')}</span>}</TableCell>
                <TableCell className="max-w-[520px] truncate font-mono text-xs" title={p.command}>{p.command}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function Containers({ d, onLog }: { d: ServerStatus; onLog: (c: string) => void }) {
  const hasTail = new Set(d.tails.map((x) => x.container))
  // problems first, then the busiest: who uses the processor is seen at once
  const rank = (c: (typeof d.containers)[number]) => {
    const always = (c.restart_policy === 'always' || c.restart_policy === 'unless-stopped') && !isBuilder(c)
    if (c.health === 'unhealthy' || c.state === 'restarting' || (c.state !== 'running' && always)) return 0
    return c.state === 'running' ? 1 : 2
  }
  const sorted = [...d.containers].sort((a, b) => rank(a) - rank(b) || (b.cpu_pct ?? -1) - (a.cpu_pct ?? -1) || a.name.localeCompare(b.name))
  const cpuTotal = d.containers.reduce((x, c) => x + (c.cpu_pct ?? 0), 0)
  const running = d.containers.filter((c) => c.state === 'running').length
  return (
    <Card>
      <CardHeader><CardTitle>{t('Containers')}</CardTitle><CardDescription>{t('{n} of {total} running · the busiest first · click one to see its log', { n: running, total: d.containers.length })}</CardDescription></CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <Table className="min-w-[760px]">
          <TableHeader><TableRow className="hover:bg-transparent">
            <TableHead>{t('Container')}</TableHead><TableHead>{t('State')}</TableHead><TableHead className="text-right">{t('Processor')}</TableHead>
            <TableHead className="text-right">{t('Memory')}</TableHead><TableHead className="text-right">{t('Restarts')}</TableHead><TableHead className="text-right">{t('Errors')}</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {sorted.map((c) => {
              // a helper that ran once and stopped is not a problem; one meant to run all the time is
              const always = (c.restart_policy === 'always' || c.restart_policy === 'unless-stopped') && !isBuilder(c)
              const bad = c.health === 'unhealthy' || c.state === 'restarting' || (c.state !== 'running' && always)
              const finished = c.state !== 'running' && !bad
              return (
                <TableRow key={c.name} className={cn(hasTail.has(c.name) && 'cursor-pointer', finished && 'text-muted-foreground')} onClick={() => hasTail.has(c.name) && onLog(c.name)}>
                  <TableCell><div className="font-medium">{c.name}</div><div className="max-w-[260px] truncate text-2xs text-muted-foreground">{c.image}</div></TableCell>
                  <TableCell>
                    <Badge variant={bad ? 'destructive' : c.health === 'healthy' ? 'success' : 'secondary'} className={cn(finished && 'opacity-70')}>
                      {finished ? (c.exit_code ? t('Stopped with an error') : t('Finished its work')) : c.state === 'restarting' ? t('Keeps restarting')
                        : c.state !== 'running' ? t('Stopped') : c.health === 'unhealthy' ? t('Unhealthy') : c.health === 'healthy' ? t('Healthy') : t('Running')}</Badge>
                    <div className="mt-0.5 text-2xs text-muted-foreground">{c.status}</div>
                  </TableCell>
                  <TableCell className="text-right tabular">
                    {c.cpu_pct != null ? <div className="flex items-center justify-end gap-2">
                      <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-muted sm:block"><span className={cn('block h-full rounded-full', c.cpu_pct >= 50 ? 'bg-destructive' : c.cpu_pct >= 20 ? 'bg-warning' : 'bg-primary')}
                        style={{ width: `${cpuTotal ? Math.min(100, (c.cpu_pct / cpuTotal) * 100) : 0}%` }} /></span>
                      <span className={cn(c.cpu_pct >= 50 && 'font-semibold text-destructive', c.cpu_pct >= 20 && c.cpu_pct < 50 && 'font-medium text-warning')}>{c.cpu_pct}%</span></div> : '—'}
                  </TableCell>
                  <TableCell className="text-right tabular">{bytes(c.mem_bytes)}</TableCell>
                  <TableCell className={cn('text-right tabular', (c.restarts ?? 0) > 0 && 'text-warning')}>{c.restarts ?? '—'}</TableCell>
                  <TableCell className={cn('text-right tabular', d.error_counts[c.name] && 'font-medium text-destructive')}>{d.error_counts[c.name] ?? 0}</TableCell>
                </TableRow>
              )
            })}
            {!d.containers.length && <TableRow><TableCell colSpan={6} className="py-8 text-center text-[13px] text-muted-foreground">{t('No container reported')}</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function Checks({ d }: { d: ServerStatus }) {
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Globe className="size-4" /> {t('Website and API')}</CardTitle><CardDescription>{t('Checked from the server every minute')}</CardDescription></CardHeader>
      <CardContent className="grid gap-2 pt-0">
        {d.last!.checks.map((c) => (
          <div key={c.url} className="flex items-center gap-3 rounded-lg border px-3 py-2 text-[13px]">
            <span className={cn('size-2 shrink-0 rounded-full', c.ok ? 'bg-success' : 'bg-destructive')} />
            <div className="min-w-0 flex-1"><div className="truncate font-medium">{c.name}</div>
              <div className="text-xs text-muted-foreground">{c.ok ? t('answers in {ms} ms', { ms: c.ms ?? '?' }) : c.error ?? t('does not answer')}</div></div>
            {c.cert_days != null && <Badge variant={c.cert_days < 14 ? 'destructive' : c.cert_days < 30 ? 'warning' : 'outline'}>{t('SSL {n} days', { n: c.cert_days })}</Badge>}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function DbCard({ d }: { d: ServerStatus }) {
  const db = d.database
  const more = d.last!.disks.slice(1)
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Database className="size-4" /> {t('Database')}</CardTitle><CardDescription>{db.version}</CardDescription></CardHeader>
      <CardContent className="grid gap-3 pt-0 text-[13px]">
        {db.error ? <p className="text-destructive">{db.error}</p> : <>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border p-2.5"><div className="text-xs text-muted-foreground">{t('Size')}</div><div className="font-semibold tabular">{bytes(db.size)}</div></div>
            <div className="rounded-lg border p-2.5"><div className="text-xs text-muted-foreground">{t('Connections')}</div><div className="font-semibold tabular">{db.connections} / {db.max_connections}</div><div className="text-2xs text-muted-foreground">{t('{n} working now', { n: db.active ?? 0 })}</div></div>
            <div className="rounded-lg border p-2.5"><div className="text-xs text-muted-foreground">{t('Longest query now')}</div><div className={cn('font-semibold tabular', (db.longest_s ?? 0) > 30 && 'text-warning')}>{t('{n} s', { n: db.longest_s ?? 0 })}</div></div>
            <div className="rounded-lg border p-2.5"><div className="text-xs text-muted-foreground">{t('Read from memory')}</div><div className="font-semibold tabular">{db.cache_hit ?? '—'}%</div></div>
          </div>
          {(db.idle_in_tx ?? 0) > 0 && <p className="text-xs text-warning">{tn(db.idle_in_tx!, '{n} connection waits inside an open transaction', '{n} connections wait inside an open transaction')}</p>}
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">{t('Biggest tables')}</div>
            <ul className="grid gap-0.5">
              {(db.tables ?? []).map((x) => <li key={x.name} className="flex justify-between gap-2"><span className="truncate font-mono text-xs">{x.name}</span><span className="shrink-0 tabular text-xs text-muted-foreground">{bytes(x.size)} · {x.rows.toLocaleString()}</span></li>)}
            </ul>
          </div>
          <div className="text-xs text-muted-foreground">{t('Running since {date}', { date: formatDate(db.started_at ?? '', true) })} · {t('{n} deadlocks', { n: db.deadlocks ?? 0 })}</div>
        </>}
        {more.length > 0 && <div className="grid gap-1 border-t pt-2">{more.map((x) => <div key={x.mount} className="flex justify-between text-xs"><span className="font-mono">{x.mount}</span><span className="tabular text-muted-foreground">{t('{free} free of {total}', { free: bytes(x.free), total: bytes(x.total) })}</span></div>)}</div>}
      </CardContent>
    </Card>
  )
}

function Errors({ d, hours, onLog }: { d: ServerStatus; hours: number; onLog: (c: string) => void }) {
  const [container, setContainer] = React.useState('all')
  const [level, setLevel] = React.useState('all')
  const [text, setText] = React.useState('')
  const names = [...new Set(d.errors.map((e) => e.container))].sort()
  const rows = d.errors.filter((e) => (container === 'all' || e.container === container) && (level === 'all' || e.level === level) && (!text || e.line.toLowerCase().includes(text.toLowerCase())))
  return (
    <Card className="mt-4">
      <CardHeader className="gap-3 sm:flex-row sm:items-end sm:justify-between sm:space-y-0">
        <div><CardTitle className="flex items-center gap-2"><ScrollText className="size-4" /> {t('Errors and warnings in the logs')}</CardTitle>
          <CardDescription>{tn(hours, 'The last {n} hour, newest first. Passwords and keys are hidden.', 'The last {n} hours, newest first. Passwords and keys are hidden.')}</CardDescription></div>
        <div className="flex flex-wrap gap-2">
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Search the text…')} className="w-full sm:w-48" />
          <Select value={container} onValueChange={setContainer}><SelectTrigger className="w-full sm:w-52"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">{t('All containers')}</SelectItem>{names.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent></Select>
          <Select value={level} onValueChange={setLevel}><SelectTrigger className="w-full sm:w-36"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">{t('Errors and warnings')}</SelectItem><SelectItem value="error">{t('Errors only')}</SelectItem><SelectItem value="warn">{t('Warnings only')}</SelectItem></SelectContent></Select>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {!rows.length ? <p className="py-8 text-center text-[13px] text-muted-foreground">{t('No errors in this time. Good.')}</p> : (
          <ul className="max-h-[480px] divide-y overflow-y-auto rounded-lg border font-mono text-xs">
            {rows.map((e) => (
              <li key={e.id} className="grid gap-0.5 px-3 py-2 sm:grid-cols-[130px_170px_minmax(0,1fr)] sm:gap-3">
                <span className="text-muted-foreground">{formatDate(e.at, true)}</span>
                <button type="button" onClick={() => onLog(e.container)} className={cn('truncate text-left hover:underline', e.level === 'error' ? 'text-destructive' : 'text-warning')}>{e.container}</button>
                <span className="break-all">{e.line}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function LogDialog({ container, onClose }: { container: string | null; onClose: () => void }) {
  const q = useServerLog(container)
  const ref = React.useRef<HTMLPreElement>(null)
  React.useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight }, [q.data])
  return (
    <Dialog open={!!container} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl">
        <DialogHeader><DialogTitle className="font-mono text-base">{container}</DialogTitle>
          <DialogDescription>{q.data ? t('The last 150 lines, read {date}. It is read again every 15 minutes.', { date: formatDate(q.data.at, true) }) : ' '}</DialogDescription></DialogHeader>
        {q.isLoading ? <Skeleton className="h-96" /> : !q.data ? <p className="text-[13px] text-muted-foreground">{t('No log of this container yet.')}</p> : (
          <pre ref={ref} className="max-h-[65vh] overflow-auto rounded-lg bg-[hsl(161_55%_8%)] p-3 font-mono text-[11.5px] leading-relaxed text-[hsl(150_20%_86%)]">
            {q.data.lines.split('\n').map((l, i) => <div key={i} className={cn(/\b(error|fatal|panic|exception)\b/i.test(l) && 'text-[hsl(0_85%_72%)]', /\bwarn/i.test(l) && 'text-[hsl(40_95%_65%)]')}>{l}</div>)}
          </pre>
        )}
      </DialogContent>
    </Dialog>
  )
}
