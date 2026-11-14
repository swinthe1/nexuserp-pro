import { Pencil, ArrowRight, Cable, CalendarPlus, Copy, GraduationCap, Pause, Play, Server, ShieldCheck, Trash2} from 'lucide-react'
import * as React from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { toast } from 'sonner'
import { EmptyState } from '@/components/empty-state'
import { MoreMenu } from '@/components/more-menu'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatDateWith, msg, t, tn } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { useQuery } from '@tanstack/react-query'
import { HealthBadge, partLabel, type ServerHealth } from './pages'
import { daysUntil } from '@/lib/license'
import { FEATURES } from '@/lib/plans'
import { ClientDevicesTab } from './devices'
import { ClientUnitsTab } from './units-tab'
import { cn, formatDate } from '@/lib/utils'
import { type ClientDetail, useClientDetail, useUpdateCompany, usePlatformClients, useSetTraining } from '../api'
import { businessTypeLabel } from '../business-types'
import { CloudCopies, DeleteClientDialog, LicenseDialog, licenseState, LiveLinkDialog, linkState, countsText, planLabel } from '../dialogs'
import { ClientActions, useOpenCompany, useRenew } from './client-actions'
import { EventRow } from './events'
import { PeopleTab } from './people-tab'
import { ClientContracts } from './contracts'

const TABS = ['summary', 'contracts', 'licence', 'units', 'devices', 'people', 'links', 'diary', 'danger'] as const
type Tab = (typeof TABS)[number]

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[150px_minmax(0,1fr)] gap-3 py-2 text-[13px]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('min-w-0 break-words', mono && 'font-mono text-xs')}>{value || <span className="text-muted-foreground">—</span>}</dd>
    </div>
  )
}
function Tile({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular">{value}</div>
      {hint && <div className="text-2xs text-muted-foreground">{hint}</div>}
    </div>
  )
}

export function ClientPage() {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const tab = (TABS.includes(params.get('tab') as Tab) ? params.get('tab') : 'summary') as Tab
  const q = useClientDetail(id)
  const list = usePlatformClients()
  const c = list.data?.clients.find((x) => x.id === id)
  const open = useOpenCompany()

  if (q.isLoading || list.isLoading) return <Skeleton className="h-96" />
  if (q.isError || !c) {
    return /not found/i.test(String((q.error as { message?: string } | null)?.message ?? '')) || (!q.isError && !c)
      ? <EmptyState title={t('This client is not on the platform any more')} action={<Button variant="outline" asChild><Link to="/platform/clients">{t('Back to the clients')}</Link></Button>} />
      : <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  }
  const d = q.data!
  const s = licenseState(c)
  return (
    <>
      <PageHeader icon={false} back={{ href: '/platform/clients', label: t('Clients') }} title={d.company.name}
        meta={<div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={s.variant}>{s.label}</Badge>
          <Badge variant="outline">{planLabel(c.plan, c.package)}</Badge>
          {d.company.is_training && <Badge variant="warning">{t('Training')}</Badge>}
          {c.app_url && <a href={c.app_url} target="_blank" rel="noreferrer" className="text-[12.5px] font-medium text-primary hover:underline">{c.app_url.replace(/^https:\/\//, '')}</a>}
        </div>}
        description={[d.company.country_code === 'XK' ? t('Kosovo') : t('Albania'), d.company.tax_number && `NUI ${d.company.tax_number}`, t(businessTypeLabel(d.company.business_type)),
          t('client since {date}', { date: formatDate(d.company.created_at) })].filter(Boolean).join(' · ')}
        actions={<>
          <Button onClick={() => void open(c.id)}>{t('Open this company')} <ArrowRight /></Button>
          <ClientActions c={c} button={<Button variant="outline" size="icon" aria-label={t('More')}>⋯</Button>} />
        </>} />

      <Tabs value={tab} onValueChange={(v) => setParams(v === 'summary' ? {} : { tab: v }, { replace: true })} className="mb-4">
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="summary">{t('Summary')}</TabsTrigger>
          <TabsTrigger value="contracts">{t('Contracts')}</TabsTrigger>
          <TabsTrigger value="licence">{t('Licence')}</TabsTrigger>
          <TabsTrigger value="units">{t('Units|places')} <span className="ml-1 text-xs text-muted-foreground">{c.units ?? ''}</span></TabsTrigger>
          <TabsTrigger value="devices">{t('Computers')}{c.devices?.pending ? <span className="ml-1 rounded-full bg-warning px-1.5 text-[11px] font-semibold text-warning-foreground">{c.devices.pending}</span> : null}</TabsTrigger>
          <TabsTrigger value="people">{t('People')} <span className="ml-1 text-xs text-muted-foreground">{d.members.length}</span></TabsTrigger>
          <TabsTrigger value="links">{t('Links and server')}</TabsTrigger>
          <TabsTrigger value="diary">{t('Diary')}</TabsTrigger>
          <TabsTrigger value="danger">{t('Danger zone')}</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === 'summary' && <Summary d={d} />}
      {tab === 'contracts' && <ClientContracts companyId={c.id} />}
      {tab === 'licence' && <LicenceTab d={d} c={c} />}
      {tab === 'people' && <PeopleTab d={d} />}
      {tab === 'units' && <ClientUnitsTab company={c.id} />}
      {tab === 'devices' && <ClientDevicesTab company={c.id} />}
      {tab === 'links' && <LinksTab d={d} c={c} />}
      {tab === 'diary' && <Card><CardContent className="p-4">{d.events.length ? <ul className="divide-y">{d.events.map((e) => <EventRow key={e.id} e={e} showClient={false} />)}</ul>
        : <p className="py-8 text-center text-[13px] text-muted-foreground">{t('Nothing yet. From now on every change is written here.')}</p>}</CardContent></Card>}
      {tab === 'danger' && <DangerTab d={d} c={c} />}
    </>
  )
}

function Summary({ d }: { d: ClientDetail }) {
  const [editing, setEditing] = React.useState(false)
  const u = d.usage
  const chart = u.activity_by_day.map((x) => ({ day: formatDateWith(new Date(`${x.day}T00:00:00`), { day: 'numeric', month: 'short' }), n: x.n }))
  const admins = d.members.filter((m) => m.is_admin)
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0"><CardTitle>{t('The company')}</CardTitle>
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}><Pencil /> {t('Change details')}</Button></CardHeader>
        <CardContent className="pt-0">
          <dl className="divide-y">
            <Field label={t('Legal name')} value={d.company.legal_name} />
            <Field label="NUI / NIPT" value={d.company.tax_number} />{/* i18n-ignore */}
            <Field label={t('VAT number')} value={d.company.vat_number} />
            <Field label={t('Business number')} value={d.company.business_number} />
            <Field label={t('Address')} value={d.company.address} />
            <Field label={t('Phone')} value={d.company.phone} />
            <Field label={t('Email')} value={d.company.email} />
            <Field label={t('Currency')} value={d.company.base_currency} />
            <Field label={t('Administrators')} value={admins.length ? admins.map((a) => a.name ? `${a.name} (${a.email})` : a.email).join(', ') : null} />
          </dl>
        </CardContent>
      </Card>
      <div className="grid content-start gap-4">
        <Card>
          <CardHeader><CardTitle>{t('How they use it')}</CardTitle><CardDescription>{u.last_activity ? t('Last activity {date}', { date: formatDate(u.last_activity, true) }) : t('No activity yet')}</CardDescription></CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 pt-0 sm:grid-cols-4">
            <Tile label={t('Users')} value={`${d.users} / ${d.licence?.max_users ?? '—'}`} />
            <Tile label={t('Units|places')} value={u.warehouses} hint={d.licence?.max_warehouses ? t('of {n}', { n: d.licence.max_warehouses }) : undefined} />
            <Tile label={t('Items')} value={u.products} />
            <Tile label={t('Partners')} value={u.partners} />
            <Tile label={t('Sales invoices')} value={u.invoices} hint={t('{n} this month', { n: u.invoices_month })} />
            <Tile label={t('Purchase invoices')} value={u.bills} />
            <Tile label={t('Till receipts this month')} value={u.pos_month} />
            <Tile label={t('Read from photos this month')} value={u.reads_month} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t('Activity, the last 30 days')}</CardTitle><CardDescription>{t('Changes saved each day')}</CardDescription></CardHeader>
          <CardContent>
            <div className="h-32">
              <ResponsiveContainer>
                <BarChart data={chart} margin={{ left: 0, right: 0 }}>
                  <XAxis dataKey="day" tickLine={false} axisLine={false} interval={6} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <Tooltip cursor={{ fill: 'hsl(var(--muted))' }} contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} formatter={(v: number) => [v, t('Changes')]} />
                  <Bar dataKey="n" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
      <CompanyDialog d={d} open={editing} onClose={() => setEditing(false)} />
    </div>
  )
}

const COMPANY_FIELDS = [
  ['name', msg('Name')], ['legal_name', msg('Legal name')], ['tax_number', msg('NUI')], ['vat_number', msg('VAT number')],
  ['business_number', msg('Business number')], ['address_line1', msg('Address')], ['city', msg('City')], ['phone', msg('Phone')],
  ['email', msg('Email')], ['website', msg('Website')],
] as const

/** The client's own details, corrected from the console */
function CompanyDialog({ d, open, onClose }: { d: ClientDetail; open: boolean; onClose: () => void }) {
  const save = useUpdateCompany()
  const [v, setV] = React.useState<Record<string, string>>({})
  React.useEffect(() => { if (open) setV(Object.fromEntries(COMPANY_FIELDS.map(([k]) => [k, String((d.company as Record<string, unknown>)[k] ?? '')]))) }, [open, d])
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{t('Details of {name}', { name: d.company.name })}</DialogTitle>
          <DialogDescription>{t('They show on the client\'s invoices and documents. What changes is written in the diary.')}</DialogDescription></DialogHeader>
        <form id="company-form" className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault()
          save.mutate({ company: d.company.id, values: v }, { onSuccess: () => { toast.success(t('Details saved')); onClose() }, onError: (x) => toast.error(describeError(x)) }) }}>
          {COMPANY_FIELDS.map(([k, label]) => (
            <div key={k} className={cn('grid gap-1.5', (k === 'name' || k === 'legal_name' || k === 'address_line1') && 'sm:col-span-2')}>
              <Label htmlFor={`co-${k}`}>{t(label)}</Label>
              <Input id={`co-${k}`} value={v[k] ?? ''} onChange={(e) => setV({ ...v, [k]: e.target.value })} type={k === 'email' ? 'email' : k === 'phone' ? 'tel' : 'text'} />
            </div>
          ))}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
          <Button type="submit" form="company-form" loading={save.isPending} disabled={(v.name ?? '').trim().length < 2}>{t('Save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function LicenceTab({ d, c }: { d: ClientDetail; c: NonNullable<ReturnType<typeof usePlatformClients>['data']>['clients'][number] }) {
  const [editing, setEditing] = React.useState(false)
  const { renew, pause, pending } = useRenew()
  const l = d.licence
  const history = d.events.filter((e) => e.kind.startsWith('licence_'))
  if (!l) return <EmptyState title={t('No licence')} action={<Button onClick={() => setEditing(true)}><ShieldCheck /> {t('Give a licence')}</Button>} />
  const days = daysUntil(l.valid_until)
  const packaged = l.plan === 'package'
  const modules = ((packaged ? c.modules : l.extra_features) ?? []).map((f) => FEATURES.find((x) => x.key === f)?.label ?? f)
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div><CardTitle>{t('The licence')}</CardTitle>
            <CardDescription>{l.status === 'suspended' ? t('Paused: nobody can sign in') : days < 0 ? t('Ended {n} days ago', { n: -days }) : tn(days, '{n} day left', '{n} days left')}</CardDescription></div>
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}><ShieldCheck /> {t('Change licence')}</Button>
        </CardHeader>
        <CardContent className="pt-0">
          <dl className="divide-y">
            <Field label={packaged ? t('Package') : t('Plan')} value={planLabel(l.plan, c.package)} />
            <Field label={packaged ? t('Modules') : t('Added modules')} value={modules.length ? modules.map((m) => t(m)).join(', ') : null} />
            <Field label={t('Users')} value={<UsersBarInline used={d.users} max={l.max_users} />} />
            <Field label={t('Units|places')} value={l.max_warehouses ? t('up to {n}', { n: l.max_warehouses }) : packaged ? t('No limit') : t('as the plan')} />
            {packaged && <Field label={t('Tills')} value={c.max_registers ? t('{a} of {b}', { a: c.tills ?? 0, b: c.max_registers }) : t('No limit')} />}
            <Field label={t('Valid')} value={`${formatDate(l.valid_from)} – ${formatDate(l.valid_until)}`} />
            <Field label={t('Where it runs')} value={l.deployment === 'local' ? t('Local server only') : l.deployment === 'cloud' ? t('Cloud only') : t('Cloud or local')} />
            <Field label={t('Licence code')} value={l.code && <button type="button" className="inline-flex items-center gap-1.5 font-mono text-xs hover:text-primary"
              onClick={() => { void navigator.clipboard?.writeText(l.code!); toast.success(t('Code copied')) }}>{l.code} <Copy className="size-3" /></button>} />
            <Field label={t('Notes')} value={l.notes} />
            <Field label={t('Last changed')} value={formatDate(l.updated_at, true)} />
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button loading={pending} onClick={() => renew(c, 12)}><CalendarPlus /> {t('One more year')}</Button>
            <MoreMenu items={[
              { label: t('One more month'), icon: CalendarPlus, onSelect: () => renew(c, 1), disabled: pending },
              l.status === 'suspended'
                ? { label: t('Resume the licence'), icon: Play, onSelect: () => pause(c, false), disabled: pending }
                : { label: t('Pause the licence'), icon: Pause, onSelect: () => pause(c, true), disabled: pending, destructive: true },
            ]} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t('History of the licence')}</CardTitle><CardDescription>{t('Every change, with who made it')}</CardDescription></CardHeader>
        <CardContent className="pt-0">
          {history.length ? <ul className="divide-y">{history.map((e) => <EventRow key={e.id} e={e} showClient={false} />)}</ul>
            : <p className="py-6 text-center text-[13px] text-muted-foreground">{t('No changes written yet.')}</p>}
        </CardContent>
      </Card>
      <LicenseDialog client={editing ? c : null} onClose={() => setEditing(false)} />
    </div>
  )
}
function UsersBarInline({ used, max }: { used: number; max: number }) {
  return <div className="flex items-center gap-3"><span className="tabular">{used} / {max}</span><span className="h-1.5 w-32 overflow-hidden rounded-full bg-muted"><span className={cn('block h-full rounded-full', used >= max ? 'bg-warning' : 'bg-primary')} style={{ width: `${Math.min(100, (used / max) * 100)}%` }} /></span></div>
}

function LinksTab({ d, c }: { d: ClientDetail; c: NonNullable<ReturnType<typeof usePlatformClients>['data']>['clients'][number] }) {
  const [link, setLink] = React.useState(false)
  const l = d.licence
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div><CardTitle>{t('Live links with the old program')}</CardTitle><CardDescription>{t('Sales and stock sent from the program the client still uses')}</CardDescription></div>
          <Button variant="outline" size="sm" onClick={() => setLink(true)}><Cable /> {t('Manage')}</Button>
        </CardHeader>
        <CardContent className="pt-0">
          {!d.sync.length ? <p className="py-6 text-center text-[13px] text-muted-foreground">{t('No live link.')}</p> : (
            <ul className="divide-y rounded-lg border">
              {d.sync.map((x) => { const st = linkState(x); return (
                <li key={x.id} className="grid gap-1 px-3 py-2.5 text-[13px]">
                  <div className="flex items-center gap-2"><span className="font-medium">{x.name}</span><Badge variant={st.variant}>{st.label}</Badge><span className="ml-auto font-mono text-2xs text-muted-foreground">{x.key_prefix}…</span></div>
                  <div className="text-xs text-muted-foreground">{x.last_seen_at ? t('Last seen {date}', { date: formatDate(x.last_seen_at, true) }) : t('Never seen')} · {t('{n} sends', { n: x.pushes })}{x.last_counts ? ` · ${countsText(x.last_counts)}` : ''}</div>
                  {x.last_error && <div className="text-xs text-destructive">{x.last_error}</div>}
                </li>) })}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Server className="size-4" /> {t('Local server')}</CardTitle>
          <CardDescription>{l?.has_server ? t('This client runs DrisPRO on its own server') : t('This client works in the cloud')}</CardDescription></CardHeader>
        <CardContent className="pt-0">
          {l?.has_server ? (<>
            <dl className="divide-y">
              <Field label={t('Version')} value={l.local_version} />
              <Field label={t('Address')} value={l.local_url} mono />
              <Field label={t('Last seen')} value={l.local_seen_at ? formatDate(l.local_seen_at, true) : t('Never')} />
            </dl>
            <ServerHealthBlock company={d.company.id} />
          </>) : <p className="text-[13px] text-muted-foreground">{t('With the licence code, the client can also install a local server; it shows here when it checks in.')}</p>}
          <div className="mt-3"><CloudCopies companyId={d.company.id} /></div>
        </CardContent>
      </Card>
      <LiveLinkDialog client={link ? c : null} onClose={() => setLink(false)} />
    </div>
  )
}

function DangerTab({ d, c }: { d: ClientDetail; c: NonNullable<ReturnType<typeof usePlatformClients>['data']>['clients'][number] }) {
  const training = useSetTraining()
  const [del, setDel] = React.useState(false)
  return (
    <div className="grid max-w-3xl gap-4">
      <Card>
        <CardContent className="flex items-start gap-4 p-5">
          <GraduationCap className="mt-0.5 size-5 shrink-0 text-warning" />
          <div className="flex-1"><div className="font-medium">{t('Training company')}</div>
            <p className="text-[13px] text-muted-foreground">{t('A company to learn on: it is left out of the counts and the income, and everyone sees a "training" sign.')}</p></div>
          <Switch checked={d.company.is_training} disabled={training.isPending} aria-label={t('Training company')}
            onCheckedChange={(on) => training.mutate({ company: d.company.id, on }, { onError: (e) => toast.error(describeError(e)) })} />
        </CardContent>
      </Card>
      <Card className="border-destructive/40">
        <CardContent className="flex items-start gap-4 p-5">
          <Trash2 className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div className="flex-1"><div className="font-medium text-destructive">{t('Delete the client')}</div>
            <p className="text-[13px] text-muted-foreground">{t('Everything of this client is deleted for good. To stop them for a while, pause the licence instead.')}</p></div>
          <Button variant="destructive" onClick={() => setDel(true)}><Trash2 /> {t('Delete')}</Button>
        </CardContent>
      </Card>
      <DeleteClientDialog client={del ? c : null} onClose={() => setDel(false)} />
    </div>
  )
}

/** a local server's health: its state now, each part, the minutes down in 30 days and the last changes */
function ServerHealthBlock({ company }: { company: string }) {
  const q = useQuery({ queryKey: ['platform', 'server-health', company], refetchInterval: 30_000,
    queryFn: async () => unwrap(await supabase.rpc('platform_server_health' as never, { p_company: company } as never)) as unknown as
      { servers: ServerHealth[]; events: { at: string; state: 'ok' | 'warn' | 'silent'; detail: string | null }[]; down_minutes: number } })
  const h = q.data?.servers[0]
  if (!q.data) return null
  if (!h) return <p className="mt-3 text-[13px] text-muted-foreground">{t('The server has not reported its health yet: it does every 5 minutes once it has the newest version.')}</p>
  const uptime = Math.max(0, 100 - (q.data.down_minutes / (30 * 24 * 60)) * 100)
  return (
    <div className="mt-3 grid gap-3 border-t pt-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <HealthBadge h={h} />
        <div className="text-right text-[13px]"><div className="font-semibold tabular">{uptime.toFixed(2)}%</div>
          <div className="text-2xs text-muted-foreground">{t('working in the last 30 days · {n} min down', { n: q.data.down_minutes })}</div></div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(h.services).map(([k, ok]) => <Badge key={k} variant={ok ? 'outline' : 'destructive'}>{ok ? '✓' : '✕'} {partLabel(k)}</Badge>)}
        {h.db_mb != null && <Badge variant="outline">{t('database {mb} MB', { mb: h.db_mb })}</Badge>}
      </div>
      {q.data.events.length > 0 && (
        <ul className="grid gap-1 text-[12.5px]">
          {q.data.events.slice(0, 8).map((e, i) => (
            <li key={i} className="flex gap-2"><span className="w-32 shrink-0 text-muted-foreground">{formatDate(e.at, true)}</span>
              <span className={e.state === 'ok' ? 'text-success' : e.state === 'warn' ? 'text-warning' : 'text-destructive'}>
                {e.state === 'ok' ? t('works again') : e.state === 'silent' ? t('went silent') : t('a part down: {parts}', { parts: (e.detail ?? '').split(', ').map(partLabel).join(', ') })}</span></li>))}
        </ul>
      )}
    </div>
  )
}
