/**
 * The devices: every computer, browser and phone has its own licence (a till, administration or a phone),
 * approved by the Super Admin only. A new device shows a pairing code; here it is typed and given to a client.
 * The console shows them all (requests first) and each client's, with the client's check (off / warn / on);
 * the Super Admin approves, blocks, renames, changes what a device is, or removes it (its place is freed).
 */
import type { ColumnDef } from '@tanstack/react-table'
import { AlertTriangle, Ban, Check, CheckCheck, KeyRound, Monitor, MonitorSmartphone, Pencil, ScreenShare, Settings2, Smartphone, Trash2 } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ColumnHeader, DataTable } from '@/components/data-table/data-table'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { msg, t, tServer } from '@/i18n'
import { describeError } from '@/lib/errors'
import { cn, formatDate } from '@/lib/utils'
import { devicePairFind, supportStart, useDeviceDelete, useDeviceGuard, useDeviceGuardSet, useDeviceLimits, useDevicePairApprove, useDeviceSet, usePlatformClients, usePlatformDevices, useSupportSessions, useSupportSettings, type DeviceGuard, type DeviceLimits, type DevicePairing, type PlatformDevice, type SupportSession } from '../api'

const STATUS: Record<PlatformDevice['status'], { label: string; tone: 'success' | 'warning' | 'destructive' }> = {
  active: { label: msg('Licensed'), tone: 'success' }, pending: { label: msg('Waiting for approval'), tone: 'warning' }, blocked: { label: msg('Blocked|device'), tone: 'destructive' },
}
const KIND = (k: string) => (k === 'till' ? t('Till|device') : k === 'mobile' ? t('Phone|device') : t('Administration|device'))
const KINDS = ['till', 'office', 'mobile'] as const
/** seen in the last 7 hours: the program checks every 6 */
const recent = (at: string | null) => !!at && Date.now() - Date.parse(at) < 7 * 3600_000

function DevicesTable({ rows, loading, error, showClient, tableKey }: { rows: PlatformDevice[] | undefined; loading: boolean; error: unknown; showClient: boolean; tableKey: string }) {
  const set = useDeviceSet()
  const del = useDeviceDelete()
  const [editing, setEditing] = React.useState<PlatformDevice | null>(null)
  const navigate = useNavigate()
  const [calling, setCalling] = React.useState<string | null>(null)
  const connect = async (d: PlatformDevice) => {
    setCalling(d.id)
    try { const r = await supportStart(d.id); navigate(`/platform/support/${r.session}`, { state: r }) }
    catch (e) { toast.error(tServer(describeError(e))) } finally { setCalling(null) }
  }
  const act = (d: PlatformDevice, status: PlatformDevice['status']) => set.mutateAsync({ id: d.id, status })
    .then(() => toast.success(status === 'active' ? t('{pc} is licensed', { pc: d.label }) : t('{pc} is blocked', { pc: d.label })))
    .catch((e) => toast.error(describeError(e)))
  const columns = React.useMemo<ColumnDef<PlatformDevice>[]>(() => [
    ...(showClient ? [{ accessorKey: 'company', meta: { label: t('Client') }, header: ({ column }) => <ColumnHeader column={column} title={t('Client')} />,
      cell: ({ row }) => <Link className="font-medium text-primary hover:underline" to={`/platform/clients/${row.original.company_id}?tab=devices`}>{row.original.company}</Link> } as ColumnDef<PlatformDevice>] : []),
    { accessorKey: 'label', meta: { label: t('Computer') }, header: ({ column }) => <ColumnHeader column={column} title={t('Computer')} />,
      cell: ({ row: { original: d } }) => <span className="flex items-center gap-2">
        {d.kind === 'till' ? <MonitorSmartphone className="size-4 shrink-0 text-primary" /> : d.kind === 'mobile' ? <Smartphone className="size-4 shrink-0 text-muted-foreground" /> : <Monitor className="size-4 shrink-0 text-muted-foreground" />}
        <span><span className="font-medium">{d.label}</span> · {d.name}<span className="block text-[11.5px] text-muted-foreground">{KIND(d.kind)}{d.register ? ` · ${d.register}` : ''}</span></span></span> },
    { accessorKey: 'status', meta: { label: t('State') }, header: ({ column }) => <ColumnHeader column={column} title={t('State')} />,
      cell: ({ row: { original: d } }) => <span><Badge variant={STATUS[d.status].tone}>{t(STATUS[d.status].label)}</Badge>
        {d.migrated && <span className="block text-[11px] text-muted-foreground">{t('registered after the update')}</span>}
        {d.clone_suspect && <span className="mt-0.5 flex items-center gap-1 text-[11px] text-destructive"><AlertTriangle className="size-3" />{t('its key was seen on another machine')}</span>}
        {d.status === 'active' && d.lease_until && <span className="block text-[11px] text-muted-foreground">{t('works until {date} without DrisPRO', { date: formatDate(d.lease_until) })}</span>}</span> },
    { accessorKey: 'hostname', meta: { label: t('In Windows') }, header: ({ column }) => <ColumnHeader column={column} title={t('In Windows')} />,
      cell: ({ row: { original: d } }) => <span className="text-[12.5px]">{d.hostname ?? (d.user_agent ? browserOf(d.user_agent) : '—')}{d.os_user && <span className="text-muted-foreground"> · {d.os_user}</span>}
        <span className="block text-[11px] text-muted-foreground">{[d.os, d.app_version && `DrisPRO ${d.app_version}`, d.mode === 'local' ? t('local server') : null].filter(Boolean).join(' · ')}</span></span> },
    { accessorKey: 'last_seen_at', meta: { label: t('Last check') }, header: ({ column }) => <ColumnHeader column={column} title={t('Last check')} />,
      cell: ({ row: { original: d } }) => <span className="flex items-center gap-1.5 text-[12.5px]"><span className={cn('size-2 rounded-full', recent(d.last_seen_at) ? 'bg-success' : 'bg-muted-foreground/40')} />
        {d.last_seen_at ? formatDate(d.last_seen_at, true) : '—'}</span> },
    { accessorKey: 'created_at', meta: { label: t('Activated') }, header: ({ column }) => <ColumnHeader column={column} title={t('Activated')} />,
      cell: ({ row: { original: d } }) => <span className="text-[12.5px]">{formatDate(d.created_at, true)}{d.approved_by && <span className="block text-[11px] text-muted-foreground">{t('approved by {who}', { who: d.approved_by })}</span>}</span> },
    { id: 'actions', meta: { label: '', noExport: true }, header: () => null, enableSorting: false,
      cell: ({ row: { original: d } }) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {d.status === 'active' && <Button size="sm" variant="outline" loading={calling === d.id} title={t('See and use this computer, once the person there allows it')}
            onClick={() => void connect(d)}><ScreenShare /> {t('Connect|support')}</Button>}
          {d.status !== 'active' && <Button size="sm" onClick={() => void act(d, 'active')}><Check /> {d.status === 'pending' ? t('Approve') : t('Unblock')}</Button>}
          {d.status !== 'blocked' && <Button size="sm" variant="outline" onClick={() => void act(d, 'blocked')}><Ban /> {t('Block')}</Button>}
          <Button size="icon" variant="ghost" className="size-8" aria-label={t('Change')} onClick={() => setEditing(d)}><Pencil className="size-4" /></Button>
          <Button size="icon" variant="ghost" className="size-8" aria-label={t('Remove')} onClick={() => {
            if (window.confirm(t('Remove {pc}? The program on that computer asks to be activated again.', { pc: `${d.label} · ${d.name}` })))
              void del.mutateAsync(d.id).then(() => toast.success(t('{pc} removed', { pc: d.label }))).catch((e) => toast.error(describeError(e)))
          }}><Trash2 className="size-4" /></Button>
        </div>) },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [showClient, calling])
  return (
    <>
      <DataTable tableKey={tableKey} columns={columns} data={rows} isLoading={loading} error={error} getRowId={(d) => d.id} exportName={t('Computers')}
        searchPlaceholder={t('Client, computer, Windows name…')} empty={{ title: t('No computers here'), description: t('Each computer appears once the DrisPRO program is activated on it.') }} />
      {editing && <EditDevice d={editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function EditDevice({ d, onClose }: { d: PlatformDevice; onClose: () => void }) {
  const set = useDeviceSet()
  const [name, setName] = React.useState(d.name)
  const [kind, setKind] = React.useState(d.kind)
  const [note, setNote] = React.useState(d.note ?? '')
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{d.label} · {d.company}</DialogTitle>
          <DialogDescription>{[d.hostname, d.os_user, d.os].filter(Boolean).join(' · ')}</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label htmlFor="dv-name">{t('Name')}</Label><Input id="dv-name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t('The device is')}>
            {KINDS.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
                className={cn('rounded-lg border-2 px-3 py-2 text-left text-[13px] font-medium', kind === k ? 'border-primary bg-primary/5' : 'hover:bg-muted')}>{KIND(k)}</button>))}
          </div>
          <div className="grid gap-1.5"><Label htmlFor="dv-note" optional>{t('Internal notes')}</Label><Textarea id="dv-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={set.isPending} onClick={() => void set.mutateAsync({ id: d.id, name: name.trim(), kind, note: note.trim() || null }).then(() => { toast.success(t('Saved')); onClose() })
            .catch((e) => toast.error(describeError(e)))}>{t('Save')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** "Kompjuterët": every computer of every client, the requests first */
export function DevicesPage() {
  const q = usePlatformDevices()
  const [tab, setTab] = React.useState<'pending' | 'all' | 'blocked'>('all')
  const all = q.data?.devices ?? []
  const rows = tab === 'all' ? all : all.filter((d) => d.status === tab)
  React.useEffect(() => { if (q.data && q.data.pending > 0) setTab('pending') }, [q.data?.pending]) // eslint-disable-line react-hooks/exhaustive-deps
  const [pairing, setPairing] = React.useState(false)
  return (
    <>
      <PageHeader title={t('Devices')} description={t('Every computer, browser and phone has its own licence: a till, administration or a phone. Only you approve them: a new device shows a code, you type it here and give it to its client.')}
        actions={<Button onClick={() => setPairing(true)}><KeyRound /> {t('Approve a device by its code')}</Button>} />
      {pairing && <PairDialog onClose={() => setPairing(false)} />}
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <StatCard label={t('Waiting for approval')} value={String(q.data?.pending ?? 0)} />
        <StatCard label={t('Tills')} value={String(all.filter((d) => d.kind === 'till' && d.status === 'active').length)} />
        <StatCard label={t('Administration and phones')} value={String(all.filter((d) => d.kind !== 'till' && d.status === 'active').length)} />
        <StatCard label={t('Checked in the last 7 hours')} value={String(all.filter((d) => recent(d.last_seen_at)).length)} />
      </div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="mb-3">
        <TabsList><TabsTrigger value="pending">{t('Waiting for approval')}{q.data?.pending ? ` (${q.data.pending})` : ''}</TabsTrigger>
          <TabsTrigger value="all">{t('All')}</TabsTrigger><TabsTrigger value="blocked">{t('Blocked|device')}</TabsTrigger></TabsList>
      </Tabs>
      <DevicesTable key={tab} rows={rows} loading={q.isLoading} error={q.error} showClient tableKey={`platform.devices.${tab}`} />
      <SupportSessions />
    </>
  )
}

const SESSION: Record<SupportSession['status'], { label: string; tone: 'success' | 'warning' | 'destructive' | 'secondary' }> = {
  requested: { label: msg('Asked'), tone: 'warning' }, accepted: { label: msg('Watching'), tone: 'success' }, ended: { label: msg('Ended|support'), tone: 'secondary' },
  declined: { label: msg('Refused'), tone: 'destructive' }, expired: { label: msg('No answer'), tone: 'secondary' }, failed: { label: msg('Did not connect'), tone: 'destructive' },
}
/** help at a distance: who saw which computer, when, for how long; and how the computers reach each other */
export function SupportSessions({ company }: { company?: string }) {
  const q = useSupportSessions(company)
  const [settings, setSettings] = React.useState(false)
  const rows = (q.data ?? []).slice(0, 15)
  return (
    <Card className="mt-6">
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div><CardTitle>{t('Help at a distance')}</CardTitle>
          <CardDescription>{t('"Connect" on a licensed computer asks the person there to let you see the screen. Every request and answer is kept here and in the diary.')}</CardDescription></div>
        {!company && <Button variant="outline" size="sm" onClick={() => setSettings(true)}><Settings2 /> {t('Connection settings')}</Button>}
      </CardHeader>
      <CardContent className="pt-0">
        {rows.length === 0
          ? <p className="text-[13px] text-muted-foreground">{t('No sessions yet.')}</p>
          : <div className="overflow-x-auto"><table className="w-full text-[13px]">
              <thead><tr className="border-b text-left text-[12px] text-muted-foreground">
                <th className="py-2 pr-3 font-medium">{t('When')}</th>{!company && <th className="py-2 pr-3 font-medium">{t('Client')}</th>}
                <th className="py-2 pr-3 font-medium">{t('Computer')}</th><th className="py-2 pr-3 font-medium">{t('By')}</th>
                <th className="py-2 pr-3 font-medium">{t('State')}</th><th className="py-2 text-right font-medium">{t('Minutes')}</th></tr></thead>
              <tbody>{rows.map((s) => (
                <tr key={s.id} className="border-b last:border-0">
                  <td className="py-2 pr-3 tabular">{formatDate(s.requested_at, true)}</td>
                  {!company && <td className="py-2 pr-3">{s.company}</td>}
                  <td className="py-2 pr-3">{s.device} · {s.device_name}</td>
                  <td className="py-2 pr-3">{s.by ?? '—'}</td>
                  <td className="py-2 pr-3"><Badge variant={SESSION[s.status].tone}>{t(SESSION[s.status].label)}</Badge>
                    {s.ended_by === 'client' && s.status === 'ended' && <span className="ml-1.5 text-[11.5px] text-muted-foreground">{t('stopped at the computer')}</span>}</td>
                  <td className="py-2 text-right tabular">{s.status === 'ended' || s.status === 'failed' ? (s.minutes ?? '—') : '—'}</td>
                </tr>))}</tbody>
            </table></div>}
      </CardContent>
      {settings && <ConnectionSettings onClose={() => setSettings(false)} />}
    </Card>
  )
}

/** STUN finds the way through most networks; a TURN server (e.g. coturn on the VPS) carries the picture when nothing else gets through */
function ConnectionSettings({ onClose }: { onClose: () => void }) {
  const s = useSupportSettings()
  const [stun, setStun] = React.useState('')
  const [turn, setTurn] = React.useState('')
  const [user, setUser] = React.useState('')
  const [pass, setPass] = React.useState('')
  React.useEffect(() => { if (s.data) { setStun(s.data.stun_url); setTurn(s.data.turn_url ?? ''); setUser(s.data.turn_username ?? '') } }, [s.data])
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{t('Connection settings')}</DialogTitle>
          <DialogDescription>{t('How the console and the client\'s computer reach each other. Without a TURN server some networks (strict firewalls, mobile internet) do not let the picture through.')}</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label htmlFor="sp-stun">STUN</Label><Input id="sp-stun" value={stun} onChange={(e) => setStun(e.target.value)} placeholder="stun:stun.l.google.com:19302" />{/* i18n-ignore */}</div>
          <div className="grid gap-1.5"><Label htmlFor="sp-turn" optional>TURN</Label><Input id="sp-turn" value={turn} onChange={(e) => setTurn(e.target.value)} placeholder="turn:turn.drispro.com:3478" />{/* i18n-ignore */}</div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label htmlFor="sp-user" optional>{t('User')}</Label><Input id="sp-user" value={user} onChange={(e) => setUser(e.target.value)} autoComplete="off" /></div>
            <div className="grid gap-1.5"><Label htmlFor="sp-pass" optional>{t('Password')}</Label><Input id="sp-pass" type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password"
              placeholder={s.data?.has_turn_credential ? t('kept; write to change') : ''} /></div>
          </div>
        </div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={s.save.isPending} onClick={() => void s.save.mutateAsync({ stun_url: stun.trim(), turn_url: turn.trim(), turn_username: user.trim(), ...(pass ? { turn_credential: pass } : {}) })
            .then(() => { toast.success(t('Saved')); onClose() }).catch((e) => toast.error(tServer(describeError(e))))}><CheckCheck /> {t('Save')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** a client's computers, with its limits and whether every computer waits for approval */
export function ClientDevicesTab({ company }: { company: string }) {
  const q = usePlatformDevices(company)
  const limits = q.data?.limits
  const rows = q.data?.devices ?? []
  const used = (k: 'till' | 'office') => rows.filter((d) => d.kind === k && d.status === 'active').length
  const [edit, setEdit] = React.useState(false)
  const [pairing, setPairing] = React.useState(false)
  return (
    <div className="grid gap-4">
      {pairing && <PairDialog company={company} onClose={() => setPairing(false)} />}
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div><CardTitle>{t('Licences for computers')}</CardTitle>
            <CardDescription>{t('Every new device of this client waits for your approval; the limits say how many you sold.')}</CardDescription></div>
          <div className="flex gap-2"><Button size="sm" onClick={() => setPairing(true)}><KeyRound /> {t('Approve a device by its code')}</Button>
            <Button variant="outline" size="sm" onClick={() => setEdit(true)}><Pencil /> {t('Change limits')}</Button></div>
        </CardHeader>
        <CardContent className="grid gap-3 pt-0 sm:grid-cols-3">
          <Limit label={t('Tills')} used={used('till')} max={limits?.till ?? null} hint={limits?.max_till_devices == null && limits?.max_registers ? t('as many as its tills') : undefined} />
          <Limit label={t('Administration|device')} used={used('office')} max={limits?.office ?? null} />
          <GuardChoice company={company} />
        </CardContent>
      </Card>
      <DevicesTable rows={rows} loading={q.isLoading} error={q.error} showClient={false} tableKey="platform.client.devices" />
      <SupportSessions company={company} />
      {edit && limits && <LimitsDialog company={company} limits={limits} onClose={() => setEdit(false)} />}
    </div>
  )
}

function Limit({ label, used, max, hint }: { label: string; used: number; max: number | null; hint?: string }) {
  const full = max != null && used >= max
  return (
    <div className="rounded-md border p-3">
      <div className="text-[12.5px] text-muted-foreground">{label}</div>
      <div className={cn('text-xl font-semibold tabular', full && 'text-warning')}>{used} <span className="text-[13px] font-normal text-muted-foreground">{max == null ? t('no limit') : t('of {n}', { n: max })}</span></div>
      {hint && <div className="text-[11.5px] text-muted-foreground">{hint}</div>}
    </div>
  )
}

function LimitsDialog({ company, limits, onClose }: { company: string; limits: DeviceLimits; onClose: () => void }) {
  const save = useDeviceLimits()
  const [till, setTill] = React.useState(limits.max_till_devices == null ? '' : String(limits.max_till_devices))
  const [office, setOffice] = React.useState(limits.max_office_devices == null ? '' : String(limits.max_office_devices))
  const n = (v: string) => (v.trim() === '' ? null : Math.max(0, Math.floor(Number(v))))
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>{t('Limits for computers')}</DialogTitle>
          <DialogDescription>{t('Empty: tills as many as the client\'s tills, administration without a limit.')}</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5"><Label htmlFor="lim-till">{t('Tills')}</Label><Input id="lim-till" type="number" min={0} className="tabular" value={till} onChange={(e) => setTill(e.target.value)}
            placeholder={limits.max_registers ? String(limits.max_registers) : t('No limit')} /></div>
          <div className="grid gap-1.5"><Label htmlFor="lim-office">{t('Administration|device')}</Label><Input id="lim-office" type="number" min={0} className="tabular" value={office} onChange={(e) => setOffice(e.target.value)} placeholder={t('No limit')} /></div>
        </div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={save.isPending} onClick={() => void save.mutateAsync({ company, max_till_devices: n(till), max_office_devices: n(office) }).then(() => { toast.success(t('Saved')); onClose() })
            .catch((e) => toast.error(describeError(e)))}><CheckCheck /> {t('Save')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const browserOf = (ua: string) => {
  const b = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : t('Browser')
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : ''
  return [b, os].filter(Boolean).join(' · ')
}

const GUARDS: { v: DeviceGuard; label: string; hint: string }[] = [
  { v: 'off', label: msg('Any device'), hint: msg('As before: people sign in from any computer, browser or phone.') },
  { v: 'warn', label: msg('Warn'), hint: msg('A device without licence still works, and is told it needs one: the time to license them all.') },
  { v: 'on', label: msg('Only licensed devices'), hint: msg('People of this client sign in and work only from its licensed devices; any other is stopped.') },
]
/** per client: whether only its licensed devices may work */
function GuardChoice({ company }: { company: string }) {
  const q = useDeviceGuard(company)
  const set = useDeviceGuardSet()
  const choose = (g: DeviceGuard) => {
    if (g === 'on' && !window.confirm(t('Only licensed devices from now on: a computer, browser or phone of this client without its licence stops at once. Go on?'))) return
    void set.mutateAsync({ company, guard: g }).then(() => { toast.success(t('Saved')); void q.refetch() }).catch((e) => toast.error(describeError(e)))
  }
  return (
    <div className="grid gap-2 rounded-md border p-3 text-[13px] sm:col-span-1">
      <span className="font-medium">{t('Which devices may work')}</span>
      <div className="grid gap-1.5" role="radiogroup" aria-label={t('Which devices may work')}>
        {GUARDS.map((g) => (
          <button key={g.v} type="button" role="radio" aria-checked={q.data === g.v} disabled={set.isPending || q.isLoading} onClick={() => choose(g.v)}
            className={cn('rounded-md border-2 px-2.5 py-1.5 text-left', q.data === g.v ? 'border-primary bg-primary/5' : 'hover:bg-muted')}>
            <span className="font-medium">{t(g.label)}</span><span className="block text-[11.5px] text-muted-foreground">{t(g.hint)}</span>
          </button>))}
      </div>
    </div>
  )
}

/** the Super Admin types a device's pairing code, sees what it is, gives it to a client */
function PairDialog({ company: fixed, onClose }: { company?: string; onClose: () => void }) {
  const clients = usePlatformClients(!fixed)
  const approve = useDevicePairApprove()
  const [code, setCode] = React.useState('')
  const [found, setFound] = React.useState<DevicePairing | null>(null)
  const [finding, setFinding] = React.useState(false)
  const [company, setCompany] = React.useState(fixed ?? '')
  const [kind, setKind] = React.useState<'till' | 'office' | 'mobile'>('office')
  const [name, setName] = React.useState('')
  const find = async () => {
    setFinding(true)
    try { const r = await devicePairFind(code); setFound(r); setKind(r.kind); setName(r.info.name || r.info.hostname || '') }
    catch (e) { toast.error(tServer(describeError(e))) } finally { setFinding(false) }
  }
  const list = (clients.data?.clients ?? []) as { id: string; name: string }[]
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{t('Approve a device by its code')}</DialogTitle>
          <DialogDescription>{t('The device shows a code of 6 letters, valid for 15 minutes. Type it here.')}</DialogDescription></DialogHeader>
        {!found ? (
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void find() }}>
            <Input aria-label={t('Pairing code')} autoFocus autoCapitalize="characters" spellCheck={false} maxLength={8} className="h-11 font-mono text-lg tracking-[0.3em] uppercase"
              value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} placeholder="ABC234" />
            <Button type="submit" className="h-11" loading={finding} disabled={code.length < 6}>{t('Find')}</Button>
          </form>
        ) : (
          <div className="grid gap-3">
            <div className="rounded-md border bg-muted/40 p-3 text-[12.5px]">
              <div className="font-mono text-base font-semibold tracking-widest">{found.code}</div>
              <div>{[found.info.hostname, found.info.os, found.info.version && `DrisPRO ${found.info.version}`].filter(Boolean).join(' · ') || (found.info.user_agent ? browserOf(found.info.user_agent) : '—')}</div>
              <div className="text-muted-foreground">{[found.ip, found.info.server, formatDate(found.created_at, true)].filter(Boolean).join(' · ')}</div>
            </div>
            {!fixed && (
              <div className="grid gap-1.5"><Label htmlFor="pd-client">{t('Client')}</Label>
                <select id="pd-client" className="h-10 rounded-md border bg-background px-2 text-sm" value={company} onChange={(e) => setCompany(e.target.value)}>
                  <option value="">{t('Choose the client')}</option>
                  {list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select></div>
            )}
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t('The device is')}>
              {KINDS.map((k) => (
                <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
                  className={cn('rounded-lg border-2 px-3 py-2 text-left text-[13px] font-medium', kind === k ? 'border-primary bg-primary/5' : 'hover:bg-muted')}>{KIND(k)}</button>))}
            </div>
            <div className="grid gap-1.5"><Label htmlFor="pd-name">{t('Name')}</Label><Input id="pd-name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('e.g. Till 2, Arben\'s phone')} /></div>
          </div>
        )}
        <DialogFooter><Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          {found && <Button loading={approve.isPending} disabled={!company} onClick={() => void approve.mutateAsync({ code: found.code, company, kind, name: name.trim() })
            .then((d) => { toast.success(t('{pc} is licensed', { pc: `${d.label} · ${d.name}` })); onClose() }).catch((e) => toast.error(tServer(describeError(e))))}><Check /> {t('Approve')}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
