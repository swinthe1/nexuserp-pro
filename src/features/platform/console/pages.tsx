import { ServerDownload } from '@/features/auth/desktop-download'
import { CalendarPlus, Cable, CircleDollarSign, ExternalLink, Server } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Switch } from '@/components/ui/switch'
import { describeError } from '@/lib/errors'
import { tServer } from '@/i18n'
import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { useAuth } from '@/app/auth-provider'
import { EmptyState } from '@/components/empty-state'
import { MoreMenu } from '@/components/more-menu'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { SearchSelect } from '@/components/search-select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { msg, t, tn } from '@/i18n'
import { unwrap } from '@/lib/errors'
import { daysUntil } from '@/lib/license'
import { supabase } from '@/lib/supabase'
import { cn, formatDate, formatMoney } from '@/lib/utils'
import { type PlatformClient, usePlatformClients, usePlatformEvents } from '../api'
import { BackupCard } from '../backup-card'
import { DesktopReleaseCard } from '../desktop-release-card'
import { countsText, LicenseDialog, licenseState, LiveLinkDialog, linkState, planLabel } from '../dialogs'
import { PricingDialog } from '../pricing-dialog'
import { useRenew } from './client-actions'
import { UsersBar } from './clients-page'
import { EVENT, EventRow } from './events'

const ClientLink = ({ c }: { c: { id: string; name: string } }) => <Link to={`/platform/clients/${c.id}`} className="font-medium hover:text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{c.name}</Link>

/* ------------------------------------------------------------------ licences */
export function LicencesPage() {
  const clients = usePlatformClients()
  const { renew, pending } = useRenew()
  const [view, setView] = React.useState<'soon' | 'ended' | 'paused' | 'all'>('soon')
  const [editing, setEditing] = React.useState<PlatformClient | null>(null)
  const all = (clients.data?.clients ?? []).filter((c) => c.valid_until)
  const rows = all.filter((c) => {
    const d = daysUntil(c.valid_until!)
    if (view === 'soon') return c.status === 'active' && d >= 0 && d <= 60
    if (view === 'ended') return c.status === 'active' && d < 0
    if (view === 'paused') return c.status === 'suspended'
    return true
  }).sort((a, b) => a.valid_until!.localeCompare(b.valid_until!))
  const count = (v: typeof view) => all.filter((c) => { const d = daysUntil(c.valid_until!)
    return v === 'soon' ? c.status === 'active' && d >= 0 && d <= 60 : v === 'ended' ? c.status === 'active' && d < 0 : v === 'paused' ? c.status === 'suspended' : true }).length
  return (
    <>
      <PageHeader icon={false} title={t('Licences')} description={t('Every licence by its end date. Renew in one click; the change is written in the diary.')} />
      <Tabs value={view} onValueChange={(v) => setView(v as typeof view)} className="mb-4">
        <TabsList>
          <TabsTrigger value="soon">{t('Ending in 60 days')} <span className="ml-1 text-xs text-muted-foreground">{count('soon')}</span></TabsTrigger>
          <TabsTrigger value="ended">{t('Ended')} <span className="ml-1 text-xs text-muted-foreground">{count('ended')}</span></TabsTrigger>
          <TabsTrigger value="paused">{t('Paused')} <span className="ml-1 text-xs text-muted-foreground">{count('paused')}</span></TabsTrigger>
          <TabsTrigger value="all">{t('All')} <span className="ml-1 text-xs text-muted-foreground">{count('all')}</span></TabsTrigger>
        </TabsList>
      </Tabs>
      <Card><CardContent className="overflow-x-auto p-0">
        {clients.isLoading ? <Skeleton className="m-4 h-48" /> : clients.isError ? <ErrorState error={clients.error} onRetry={() => void clients.refetch()} /> : !rows.length
          ? <EmptyState compact title={view === 'soon' ? t('No licence ends in the next 60 days') : t('Nothing here')} />
          : (
            <Table className="min-w-[860px]">
              <TableHeader><TableRow className="hover:bg-transparent">
                <TableHead>{t('Client')}</TableHead><TableHead>{t('Plan')}</TableHead><TableHead className="text-right">{t('Users')}</TableHead>
                <TableHead>{t('Valid until')}</TableHead><TableHead>{t('Licence')}</TableHead><TableHead className="w-[300px]" />
              </TableRow></TableHeader>
              <TableBody>
                {rows.map((c) => { const s = licenseState(c); const d = daysUntil(c.valid_until!)
                  return (
                    <TableRow key={c.id}>
                      <TableCell><ClientLink c={c} />{c.admins[0] && <div className="text-xs text-muted-foreground">{c.admins[0]}</div>}</TableCell>
                      <TableCell>{planLabel(c.plan, c.package)}</TableCell>
                      <TableCell className="text-right"><UsersBar used={c.users} max={c.max_users} /></TableCell>
                      <TableCell><div className="tabular">{formatDate(c.valid_until!)}</div>
                        <div className={cn('text-xs', d < 0 ? 'text-destructive' : d <= 14 ? 'text-warning' : 'text-muted-foreground')}>
                          {d < 0 ? tn(-d, 'ended {n} day ago', 'ended {n} days ago') : d === 0 ? t('ends today') : tn(d, 'in {n} day', 'in {n} days')}</div></TableCell>
                      <TableCell><Badge variant={s.variant}>{s.label}</Badge></TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1.5">
                          <Button size="sm" disabled={pending} onClick={() => renew(c, 12)}><CalendarPlus /> {t('One more year')}</Button>
                          <MoreMenu size="sm" items={[
                            { label: t('+1 month'), icon: CalendarPlus, onSelect: () => renew(c, 1), disabled: pending },
                            { label: t('Change|edit'), onSelect: () => setEditing(c) },
                          ]} />
                        </div>
                      </TableCell>
                    </TableRow>
                  ) })}
              </TableBody>
            </Table>
          )}
      </CardContent></Card>
      <LicenseDialog client={editing} onClose={() => setEditing(null)} />
    </>
  )
}

/* ------------------------------------------------------------------ local servers */
const vparts = (v: string) => v.split(/[.-]/).map((x) => Number(x) || 0)
const newer = (a: string, b: string) => { const x = vparts(a), y = vparts(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0) } return false }

type Tunnel = { company_id: string; company: string; hostname: string; status: 'requested' | 'ready' | 'failed' | 'remove' | 'off'; error: string | null; updated_at: string }
export function ServersPage() {
  const clients = usePlatformClients()
  const qc = useQueryClient()
  const tunnels = useQuery({ queryKey: ['platform', 'tunnels'], refetchInterval: 30_000,
    queryFn: async () => unwrap(await supabase.rpc('platform_tunnels' as never)) as unknown as { configured: boolean; tunnels: Tunnel[] } })
  const setTunnel = useMutation({
    mutationFn: async (a: { company: string; on: boolean }) => unwrap(await supabase.rpc('platform_tunnel_set' as never, { p_company: a.company, p_on: a.on } as never)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['platform', 'tunnels'] }),
    onError: (e) => toast.error(tServer(describeError(e))),
  })
  const tunnelOf = (id: string) => tunnels.data?.tunnels.find((x) => x.company_id === id)
  // each server says how it is every 5 minutes; silent for 10 minutes = a problem
  const health = useQuery({ queryKey: ['platform', 'server-health'], refetchInterval: 30_000,
    queryFn: async () => unwrap(await supabase.rpc('platform_server_health' as never)) as unknown as { servers: ServerHealth[] } })
  const healthOf = (id: string) => health.data?.servers.find((x) => x.company_id === id)
  const troubled = (health.data?.servers ?? []).filter((x) => x.state !== 'ok')
  const rows = (clients.data?.clients ?? []).filter((c) => c.has_server || c.local_seen_at || c.deployment === 'local')
    .sort((a, b) => (a.local_seen_at ?? '').localeCompare(b.local_seen_at ?? ''))
  const latest = rows.map((c) => c.local_version).filter((v): v is string => !!v).reduce<string | null>((m, v) => (!m || newer(v, m) ? v : m), null)
  const online = (c: PlatformClient) => !!c.local_seen_at && Date.now() - new Date(c.local_seen_at).getTime() < 2 * 3600_000
  return (
    <>
      <PageHeader icon={false} title={t('Local servers')} description={t('Clients who run DrisPRO on their own computer or server. Each one checks its licence regularly; the oldest sign of life comes first.')} />
      {troubled.length > 0 && (
        <div className="mb-4 grid gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3" role="alert">
          {troubled.map((x) => (
            <p key={x.company_id} className="text-sm"><span className="font-medium">{x.company}</span>{' · '}
              {x.state === 'silent' ? t('silent since {time}: the server or its internet is down', { time: formatDate(x.seen_at, true) })
                : t('a part is down: {parts}', { parts: x.down.map(partLabel).join(', ') })}</p>))}
        </div>
      )}
      <ServerDownload className="mb-4" />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">{t('Servers')}</div><div className="text-2xl font-semibold tabular">{rows.length}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">{t('Online now')}</div><div className="text-2xl font-semibold tabular text-success">{rows.filter(online).length}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">{t('Newest version in use')}</div><div className="text-2xl font-semibold tabular">{latest ?? '—'}</div></CardContent></Card>
      </div>
      {tunnels.data && !tunnels.data.configured && <p className="mb-3 rounded-md bg-warning/10 p-3 text-[13px]">{t('The outside addresses (https://name.drispro.com) are made once Cloudflare is set: run Vendos-celesin-Cloudflare.bat once.')}</p>}
      <Card><CardContent className="overflow-x-auto p-0">
        {clients.isLoading ? <Skeleton className="m-4 h-48" /> : clients.isError ? <ErrorState error={clients.error} onRetry={() => void clients.refetch()} /> : !rows.length ? <EmptyState compact icon={Server} title={t('No local server yet')} description={t('When a client installs a local server with its licence code, it shows here.')} /> : (
          <Table className="min-w-[760px]">
            <TableHeader><TableRow className="hover:bg-transparent">
              <TableHead>{t('Client')}</TableHead><TableHead>{t('State')}</TableHead><TableHead>{t('Version')}</TableHead><TableHead>{t('Address')}</TableHead><TableHead>{t('From outside')}</TableHead><TableHead>{t('Last seen')}</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell><ClientLink c={c} /><div className="font-mono text-2xs text-muted-foreground">{c.licence_code}</div></TableCell>
                  <TableCell>{(() => { const h = healthOf(c.id); return h ? <HealthBadge h={h} /> : null })() ?? (!c.local_seen_at ? <Badge variant="secondary">{t('Never seen')}</Badge> : online(c) ? <Badge variant="success">{t('Online')}</Badge>
                    : Date.now() - new Date(c.local_seen_at).getTime() > 24 * 3600_000 ? <Badge variant="destructive">{t('Quiet for over a day')}</Badge> : <Badge variant="warning">{t('Not seen for a while')}</Badge>)}</TableCell>
                  <TableCell>{c.local_version ? <span className="tabular">{c.local_version}</span> : '—'}
                    {c.local_version && latest && newer(latest, c.local_version) && <Badge variant="warning" className="ml-2">{t('Older')}</Badge>}</TableCell>
                  <TableCell className="max-w-[260px] truncate font-mono text-xs text-muted-foreground">{c.local_url ?? '—'}</TableCell>
                  <TableCell>{(() => { const x = tunnelOf(c.id); if (!x) return <span className="text-xs text-muted-foreground">{t('not asked yet')}</span>
                    return (
                      <div className="flex items-center gap-2">
                        <div className="min-w-0">
                          {x.status === 'ready' ? <a href={`https://${x.hostname}`} target="_blank" rel="noreferrer" className="font-mono text-xs text-primary hover:underline">{x.hostname}</a>
                            : <span className="font-mono text-xs text-muted-foreground">{x.hostname}</span>}
                          <div className="text-2xs text-muted-foreground" title={x.error ?? undefined}>{x.status === 'ready' ? t('Works') : x.status === 'requested' ? t('Being made|tunnel') : x.status === 'failed' ? t('Not made: {e}', { e: (x.error ?? '').slice(0, 60) }) : t('Turned off')}</div>
                        </div>
                        <Switch checked={x.status === 'ready' || x.status === 'requested'} disabled={setTunnel.isPending} aria-label={t('Reach from outside')}
                          onCheckedChange={(on) => setTunnel.mutate({ company: c.id, on })} />
                      </div>) })()}</TableCell>
                  <TableCell className="text-[13px] text-muted-foreground">{c.local_seen_at ? formatDate(c.local_seen_at, true) : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent></Card>
    </>
  )
}

export type ServerHealth = { company_id: string; company: string; state: 'ok' | 'warn' | 'silent'; state_since: string; seen_at: string
  down: string[]; services: Record<string, boolean>; version: string | null; db_mb: number | null }
const PARTS: Record<string, string> = { database: msg('Database'), sign_in: msg('Sign-in'), data: msg('Data (API)'), files: msg('Files'), page: msg('Page') }
export const partLabel = (k: string) => (PARTS[k] ? t(PARTS[k]) : k)
/** a server's state as the Platform shows it: works, a part down, or silent */
export function HealthBadge({ h }: { h: ServerHealth }) {
  if (h.state === 'ok') return <span><Badge variant="success">{t('Works')}</Badge><span className="block text-2xs text-muted-foreground">{t('checked {time}', { time: formatDate(h.seen_at, true) })}</span></span>
  if (h.state === 'warn') return <span><Badge variant="warning">{t('A part is down')}</Badge><span className="block text-2xs text-muted-foreground">{h.down.map(partLabel).join(', ')}</span></span>
  return <span><Badge variant="destructive">{t('Silent')}</Badge><span className="block text-2xs text-muted-foreground">{t('since {time}', { time: formatDate(h.seen_at, true) })}</span></span>
}

/* ------------------------------------------------------------------ live links */
export function LinksPage() {
  const clients = usePlatformClients()
  const [manage, setManage] = React.useState<PlatformClient | null>(null)
  const rows = (clients.data?.clients ?? []).flatMap((c) => (c.sync ?? []).map((x) => ({ c, x })))
    .sort((a, b) => Number(!!b.x.last_error) - Number(!!a.x.last_error) || Number(b.x.is_active) - Number(a.x.is_active) || a.c.name.localeCompare(b.c.name))
  return (
    <>
      <PageHeader icon={false} title={t('Live links')} description={t('The links that send sales, stock and prices from a client\'s old program. Links with errors come first.')} />
      <Card><CardContent className="overflow-x-auto p-0">
        {clients.isLoading ? <Skeleton className="m-4 h-48" /> : clients.isError ? <ErrorState error={clients.error} onRetry={() => void clients.refetch()} /> : !rows.length ? <EmptyState compact icon={Cable} title={t('No live link yet')} description={t('A link is made from the client\'s page, under "Links and server".')} /> : (
          <Table className="min-w-[860px]">
            <TableHeader><TableRow className="hover:bg-transparent">
              <TableHead>{t('Client')}</TableHead><TableHead>{t('Link')}</TableHead><TableHead>{t('State')}</TableHead><TableHead>{t('Last seen')}</TableHead><TableHead>{t('Last send')}</TableHead><TableHead className="w-24" />
            </TableRow></TableHeader>
            <TableBody>
              {rows.map(({ c, x }) => { const st = linkState(x); return (
                <TableRow key={x.id}>
                  <TableCell><ClientLink c={c} /></TableCell>
                  <TableCell><div>{x.name}</div><div className="font-mono text-2xs text-muted-foreground">{x.key_prefix}…</div></TableCell>
                  <TableCell><Badge variant={st.variant}>{st.label}</Badge>{x.last_error && <div className="mt-1 max-w-[280px] truncate text-xs text-destructive" title={x.last_error}>{x.last_error}</div>}</TableCell>
                  <TableCell className="text-[13px] text-muted-foreground">{x.last_seen_at ? formatDate(x.last_seen_at, true) : t('Never')}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{countsText(x.last_counts) || '—'}<div>{t('{n} sends', { n: x.pushes })}</div></TableCell>
                  <TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => setManage(c)}>{t('Manage')}</Button></TableCell>
                </TableRow>) })}
            </TableBody>
          </Table>
        )}
      </CardContent></Card>
      <LiveLinkDialog client={manage} onClose={() => setManage(null)} />
    </>
  )
}

/* ------------------------------------------------------------------ copies and programs */
export function BackupsPage() {
  return (
    <>
      <PageHeader icon={false} title={t('Database copies')} description={t('The copies of the whole database the server makes by itself. Check that the last one is recent and that the disk has room.')} />
      <div className="-mt-6"><BackupCard /></div>
    </>
  )
}
export function ReleasesPage() {
  return (
    <>
      <PageHeader icon={false} title={t('Windows and Mac programs')} description={t('The versions of the DrisPRO program the sign-in page offers. A new version appears here by itself once it is built.')} />
      <div className="-mt-6"><DesktopReleaseCard /></div>
    </>
  )
}

/* ------------------------------------------------------------------ prices */
type PriceRow = { plan: string; package?: boolean; price_month: number | null; price_year: number | null; per_user: number | null; users: number; note: string | null }
export function PricesPage() {
  const [open, setOpen] = React.useState(false)
  const q = useQueryPrices(open)
  return (
    <>
      <PageHeader icon={false} title={t('Prices')} description={t('The price of each package and of the older plans, without VAT. Only you see them; the overview counts the income from them.')}
        actions={<Button onClick={() => setOpen(true)}><CircleDollarSign /> {t('Change the prices')}</Button>} />
      <Card><CardContent className="overflow-x-auto p-0">
        {q.isLoading ? <Skeleton className="m-4 h-32" /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
          <Table>
            <TableHeader><TableRow className="hover:bg-transparent">
              <TableHead>{t('Plan')}</TableHead><TableHead className="text-right">{t('A month')}</TableHead><TableHead className="text-right">{t('A year')}</TableHead>
              <TableHead className="text-right">{t('Users included')}</TableHead><TableHead className="text-right">{t('Each user more')}</TableHead><TableHead>{t('Note')}</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {(q.data ?? []).map((p) => (
                <TableRow key={p.plan}>
                  <TableCell className="font-medium">{p.package ? planLabel('package', p.plan) : planLabel(p.plan)}</TableCell>
                  <TableCell className="text-right tabular">{p.price_month != null ? formatMoney(p.price_month) : <span className="text-muted-foreground">{t('on offer')}</span>}</TableCell>
                  <TableCell className="text-right tabular">{p.price_year != null ? formatMoney(p.price_year) : '—'}</TableCell>
                  <TableCell className="text-right tabular">{p.users}</TableCell>
                  <TableCell className="text-right tabular">{p.per_user != null ? formatMoney(p.per_user) : '—'}</TableCell>
                  <TableCell className="text-[13px] text-muted-foreground">{p.note ?? ''}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent></Card>
      <PricingDialog open={open} onOpenChange={setOpen} />
    </>
  )
}
/** the same data the price window uses, so saving there shows here at once */
function useQueryPrices(_editing: boolean) {
  return useQuery({ queryKey: ['public-pricing'], queryFn: async () => unwrap(await supabase.rpc('public_pricing')) as unknown as { plans: PriceRow[] },
    select: (d) => d.plans })
}

/* ------------------------------------------------------------------ the diary */
export function DiaryPage() {
  const clients = usePlatformClients()
  const [company, setCompany] = React.useState<string | null>(null)
  const [kind, setKind] = React.useState<string>('all')
  const q = usePlatformEvents(company, kind === 'all' ? null : kind)
  return (
    <>
      <PageHeader icon={false} title={t('Platform diary')} description={t('Everything done on the platform: clients created and deleted, licences, passwords, links, visits. Kept also after a client is deleted.')} />
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="w-full sm:w-72"><SearchSelect value={company} onChange={setCompany} clearable placeholder={t('All clients')}
          options={(clients.data?.clients ?? []).map((c) => ({ value: c.id, label: c.name }))} /></div>
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className="w-full sm:w-64"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('Everything')}</SelectItem>
            {Object.entries(EVENT).map(([k, v]) => <SelectItem key={k} value={k}>{t(v.label)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <Card><CardContent className="p-4">
        {q.isLoading ? <Skeleton className="h-64" /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data?.length
          ? <p className="py-8 text-center text-[13px] text-muted-foreground">{t('Nothing yet. From now on every change is written here.')}</p>
          : <ul className="divide-y">{q.data.map((e) => <EventRow key={e.id} e={e} />)}</ul>}
      </CardContent></Card>
    </>
  )
}

/* ------------------------------------------------------------------ settings */
export function ConsoleSettingsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  return (
    <>
      <PageHeader icon={false} title={t('Settings')} description={t('How the platform works for everyone.')} />
      <div className="grid max-w-3xl gap-4">
        <Card>
          <CardContent className="p-5">
            <p className="font-medium">{t('Who creates companies')}</p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">{t('Only you, from Clients › New client. Nobody can open a company on their own; the people you invite sign up into the company you made.')}</p>
          </CardContent>
        </Card>
        <MailFallbackCard />
        <Card>
          <CardHeader><CardTitle>{t('The platform administrator')}</CardTitle><CardDescription>{t('Only this account sees the console. Clients never see it.')}</CardDescription></CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-0 text-[13px]">
            <span>{user?.email}</span>
            <Button variant="outline" size="sm" onClick={() => navigate('/platform/diary')}>{t('See what was done')} <ExternalLink /></Button>
          </CardContent>
        </Card>
      </div>
    </>
  )
}

/** Companies without their own mailbox send through the platform's: the switch and what it uses */
function MailFallbackCard() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['platform', 'mail-fallback'],
    queryFn: async () => unwrap(await supabase.rpc('platform_mail_fallback' as never)) as unknown as { on: boolean; company: string | null; from: string | null } })
  const set = useMutation({
    mutationFn: async (on: boolean) => unwrap(await supabase.rpc('platform_set_mail_fallback' as never, { p_on: on } as never)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['platform', 'mail-fallback'] }),
    onError: (e) => toast.error(tServer(describeError(e))),
  })
  if (!q.data) return null
  return (
    <Card>
      <CardHeader><CardTitle>{t('Email for companies without a mailbox')}</CardTitle>
        <CardDescription>{t('A company that has not set up its own mailbox sends invoices and reminders from the platform\'s mailbox, with its own name as the sender and its email for replies. Its own mailbox, when set up, always comes first.')}</CardDescription></CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-0 text-[13px]">
        <span className="text-muted-foreground">{q.data.from ? t('Sends from {from} ({company})', { from: q.data.from, company: q.data.company ?? '' }) : t('The platform\'s own company has no mailbox yet.')}</span>
        <label className="flex items-center gap-2"><Switch checked={q.data.on} disabled={set.isPending} onCheckedChange={(on) => set.mutate(on)} /> {q.data.on ? t('On') : t('Off')}</label>
      </CardContent>
    </Card>
  )
}
