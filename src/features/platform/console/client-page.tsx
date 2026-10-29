import { ArrowRight, Cable, CalendarPlus, Copy, GraduationCap, KeyRound, Pause, Play, Server, ShieldCheck, Trash2, UserPlus } from 'lucide-react'
import * as React from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { toast } from 'sonner'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatDateWith, t, td, tn } from '@/i18n'
import { describeError } from '@/lib/errors'
import { daysUntil } from '@/lib/license'
import { FEATURES } from '@/lib/plans'
import { cn, formatDate } from '@/lib/utils'
import { type ClientDetail, useClientDetail, usePlatformClients, useSetTraining } from '../api'
import { businessTypeLabel } from '../business-types'
import { CloudCopies, CreateAccountDialog, DeleteClientDialog, LicenseDialog, licenseState, LiveLinkDialog, linkState, countsText, PasswordDialog, planLabel } from '../dialogs'
import { ClientActions, useOpenCompany, useRenew } from './client-actions'
import { EventRow } from './events'

const TABS = ['summary', 'licence', 'people', 'links', 'diary', 'danger'] as const
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
  const { renew, pending } = useRenew()

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
          <Badge variant="outline">{planLabel(c.plan)}</Badge>
          {d.company.is_training && <Badge variant="warning">{t('Training')}</Badge>}
        </div>}
        description={[d.company.country_code === 'XK' ? t('Kosovo') : t('Albania'), d.company.tax_number && `NUI ${d.company.tax_number}`, t(businessTypeLabel(d.company.business_type)),
          t('client since {date}', { date: formatDate(d.company.created_at) })].filter(Boolean).join(' · ')}
        actions={<>
          {c.valid_until && <Button variant="outline" loading={pending} onClick={() => renew(c, 12)}><CalendarPlus /> {t('One more year')}</Button>}
          <Button onClick={() => void open(c.id)}>{t('Open this company')} <ArrowRight /></Button>
          <ClientActions c={c} button={<Button variant="outline" size="icon" aria-label={t('More')}>⋯</Button>} />
        </>} />

      <Tabs value={tab} onValueChange={(v) => setParams(v === 'summary' ? {} : { tab: v }, { replace: true })} className="mb-4">
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="summary">{t('Summary')}</TabsTrigger>
          <TabsTrigger value="licence">{t('Licence')}</TabsTrigger>
          <TabsTrigger value="people">{t('People')} <span className="ml-1 text-xs text-muted-foreground">{d.members.length}</span></TabsTrigger>
          <TabsTrigger value="links">{t('Links and server')}</TabsTrigger>
          <TabsTrigger value="diary">{t('Diary')}</TabsTrigger>
          <TabsTrigger value="danger">{t('Danger zone')}</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === 'summary' && <Summary d={d} />}
      {tab === 'licence' && <LicenceTab d={d} c={c} />}
      {tab === 'people' && <PeopleTab d={d} />}
      {tab === 'links' && <LinksTab d={d} c={c} />}
      {tab === 'diary' && <Card><CardContent className="p-4">{d.events.length ? <ul className="divide-y">{d.events.map((e) => <EventRow key={e.id} e={e} showClient={false} />)}</ul>
        : <p className="py-8 text-center text-[13px] text-muted-foreground">{t('Nothing yet. From now on every change is written here.')}</p>}</CardContent></Card>}
      {tab === 'danger' && <DangerTab d={d} c={c} />}
    </>
  )
}

function Summary({ d }: { d: ClientDetail }) {
  const u = d.usage
  const chart = u.activity_by_day.map((x) => ({ day: formatDateWith(new Date(`${x.day}T00:00:00`), { day: 'numeric', month: 'short' }), n: x.n }))
  const admins = d.members.filter((m) => m.is_admin)
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader><CardTitle>{t('The company')}</CardTitle></CardHeader>
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
            <Tile label={t('Units')} value={u.warehouses} hint={d.licence?.max_warehouses ? t('of {n}', { n: d.licence.max_warehouses }) : undefined} />
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
    </div>
  )
}

function LicenceTab({ d, c }: { d: ClientDetail; c: NonNullable<ReturnType<typeof usePlatformClients>['data']>['clients'][number] }) {
  const [editing, setEditing] = React.useState(false)
  const { renew, pause, pending } = useRenew()
  const l = d.licence
  const history = d.events.filter((e) => e.kind.startsWith('licence_'))
  if (!l) return <EmptyState title={t('No licence')} action={<Button onClick={() => setEditing(true)}><ShieldCheck /> {t('Give a licence')}</Button>} />
  const days = daysUntil(l.valid_until)
  const modules = (l.extra_features ?? []).map((f) => FEATURES.find((x) => x.key === f)?.label ?? f)
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
            <Field label={t('Plan')} value={planLabel(l.plan)} />
            <Field label={t('Added modules')} value={modules.length ? modules.map((m) => t(m)).join(', ') : null} />
            <Field label={t('Users')} value={<UsersBarInline used={d.users} max={l.max_users} />} />
            <Field label={t('Units')} value={l.max_warehouses ? t('up to {n}', { n: l.max_warehouses }) : t('as the plan')} />
            <Field label={t('Valid')} value={`${formatDate(l.valid_from)} – ${formatDate(l.valid_until)}`} />
            <Field label={t('Where it runs')} value={l.deployment === 'local' ? t('Local server only') : l.deployment === 'cloud' ? t('Cloud only') : t('Cloud or local')} />
            <Field label={t('Licence code')} value={l.code && <button type="button" className="inline-flex items-center gap-1.5 font-mono text-xs hover:text-primary"
              onClick={() => { void navigator.clipboard?.writeText(l.code!); toast.success(t('Code copied')) }}>{l.code} <Copy className="size-3" /></button>} />
            <Field label={t('Notes')} value={l.notes} />
            <Field label={t('Last changed')} value={formatDate(l.updated_at, true)} />
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button loading={pending} onClick={() => renew(c, 12)}><CalendarPlus /> {t('One more year')}</Button>
            <Button variant="outline" disabled={pending} onClick={() => renew(c, 1)}>{t('One more month')}</Button>
            {l.status === 'suspended'
              ? <Button variant="outline" disabled={pending} onClick={() => pause(c, false)}><Play /> {t('Resume the licence')}</Button>
              : <Button variant="outline" disabled={pending} onClick={() => pause(c, true)}><Pause /> {t('Pause the licence')}</Button>}
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

function PeopleTab({ d }: { d: ClientDetail }) {
  const [pw, setPw] = React.useState<string | null>(null)
  const [account, setAccount] = React.useState<{ member_id: string; email: string; company: string } | null>(null)
  return (
    <Card>
      <CardContent className="overflow-x-auto p-0">
        <Table className="min-w-[760px]">
          <TableHeader><TableRow className="hover:bg-transparent">
            <TableHead>{t('Person')}</TableHead><TableHead>{t('Roles')}</TableHead><TableHead>{t('Status')}</TableHead><TableHead>{t('Last signed in')}</TableHead><TableHead className="w-48" />
          </TableRow></TableHeader>
          <TableBody>
            {d.members.map((m) => (
              <TableRow key={m.member_id}>
                <TableCell><div className="font-medium">{m.name ?? m.email}{m.is_admin && <Badge variant="outline" className="ml-2 border-primary/40 text-primary">{t('Administrator')}</Badge>}
                  {m.external_accountant && <Badge variant="outline" className="ml-1">{t('Outside accountant')}</Badge>}</div>
                  <div className="text-xs text-muted-foreground">{m.email}</div></TableCell>
                <TableCell><div className="flex flex-wrap gap-1">{m.roles.map((r) => <Badge key={r} variant="secondary">{td(r)}</Badge>)}</div></TableCell>
                <TableCell><Badge variant={m.status === 'active' ? 'success' : m.status === 'invited' ? 'warning' : 'secondary'}>{m.status === 'active' ? t('Active') : m.status === 'invited' ? t('Invited') : t('Suspended')}</Badge></TableCell>
                <TableCell className="text-[13px] text-muted-foreground">{m.last_sign_in_at ? formatDate(m.last_sign_in_at, true) : t('Never')}</TableCell>
                <TableCell className="text-right">
                  {m.user_id
                    ? <Button variant="ghost" size="sm" onClick={() => setPw(m.email)}><KeyRound /> {t('New password')}</Button>
                    : <Button size="sm" onClick={() => setAccount({ member_id: m.member_id, email: m.email, company: d.company.name })}><UserPlus /> {t('Make the account')}</Button>}
                </TableCell>
              </TableRow>
            ))}
            {!d.members.length && <TableRow><TableCell colSpan={5} className="py-8 text-center text-[13px] text-muted-foreground">{t('Nobody yet')}</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
      <PasswordDialog target={pw ? { email: pw } : null} onClose={() => setPw(null)} />
      {account && <CreateAccountDialog target={account} onClose={() => setAccount(null)} />}
    </Card>
  )
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
          {l?.has_server ? (
            <dl className="divide-y">
              <Field label={t('Version')} value={l.local_version} />
              <Field label={t('Address')} value={l.local_url} mono />
              <Field label={t('Last seen')} value={l.local_seen_at ? formatDate(l.local_seen_at, true) : t('Never')} />
            </dl>
          ) : <p className="text-[13px] text-muted-foreground">{t('With the licence code, the client can also install a local server; it shows here when it checks in.')}</p>}
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
