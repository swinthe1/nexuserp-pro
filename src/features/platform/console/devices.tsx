/**
 * The computers: every installation of the DrisPRO program has its own licence, a till or administration.
 * The console shows them all (requests first) and each client's, with its limits; the Super Admin
 * approves, blocks, renames, changes what a computer is, or removes it.
 */
import type { ColumnDef } from '@tanstack/react-table'
import { Ban, Check, CheckCheck, Monitor, MonitorSmartphone, Pencil, ScreenShare, Settings2, Trash2 } from 'lucide-react'
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
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { msg, t, tServer } from '@/i18n'
import { describeError } from '@/lib/errors'
import { cn, formatDate } from '@/lib/utils'
import { supportStart, useDeviceDelete, useDeviceLimits, useDeviceSet, usePlatformDevices, useSupportSessions, useSupportSettings, type DeviceLimits, type PlatformDevice, type SupportSession } from '../api'

const STATUS: Record<PlatformDevice['status'], { label: string; tone: 'success' | 'warning' | 'destructive' }> = {
  active: { label: msg('Licensed'), tone: 'success' }, pending: { label: msg('Waiting for approval'), tone: 'warning' }, blocked: { label: msg('Blocked|device'), tone: 'destructive' },
}
const KIND = (k: string) => (k === 'till' ? t('Till|device') : t('Administration|device'))
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
        {d.kind === 'till' ? <MonitorSmartphone className="size-4 shrink-0 text-primary" /> : <Monitor className="size-4 shrink-0 text-muted-foreground" />}
        <span><span className="font-medium">{d.label}</span> · {d.name}<span className="block text-[11.5px] text-muted-foreground">{KIND(d.kind)}{d.register ? ` · ${d.register}` : ''}</span></span></span> },
    { accessorKey: 'status', meta: { label: t('State') }, header: ({ column }) => <ColumnHeader column={column} title={t('State')} />,
      cell: ({ row: { original: d } }) => <span><Badge variant={STATUS[d.status].tone}>{t(STATUS[d.status].label)}</Badge>
        {d.migrated && <span className="block text-[11px] text-muted-foreground">{t('registered after the update')}</span>}</span> },
    { accessorKey: 'hostname', meta: { label: t('In Windows') }, header: ({ column }) => <ColumnHeader column={column} title={t('In Windows')} />,
      cell: ({ row: { original: d } }) => <span className="text-[12.5px]">{d.hostname ?? '—'}{d.os_user && <span className="text-muted-foreground"> · {d.os_user}</span>}
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
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t('The computer is')}>
            {(['till', 'office'] as const).map((k) => (
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
  return (
    <>
      <PageHeader title={t('Computers')} description={t('Every computer where the DrisPRO program is installed has its own licence: a till or administration. Within the client\'s limits it is licensed at once; beyond them it waits here for your approval.')} />
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <StatCard label={t('Waiting for approval')} value={String(q.data?.pending ?? 0)} />
        <StatCard label={t('Tills')} value={String(all.filter((d) => d.kind === 'till' && d.status === 'active').length)} />
        <StatCard label={t('Administration|device')} value={String(all.filter((d) => d.kind === 'office' && d.status === 'active').length)} />
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
          <div className="grid gap-1.5"><Label htmlFor="sp-turn" optional>TURN</Label><Input id="sp-turn" value={turn} onChange={(e) => setTurn(e.target.value)} placeholder="turn:turn.dris-ks.com:3478" />{/* i18n-ignore */}</div>
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
  const save = useDeviceLimits()
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div><CardTitle>{t('Licences for computers')}</CardTitle>
            <CardDescription>{t('A computer within these limits is licensed at once; beyond them it waits for your approval.')}</CardDescription></div>
          <Button variant="outline" size="sm" onClick={() => setEdit(true)}><Pencil /> {t('Change limits')}</Button>
        </CardHeader>
        <CardContent className="grid gap-3 pt-0 sm:grid-cols-3">
          <Limit label={t('Tills')} used={used('till')} max={limits?.till ?? null} hint={limits?.max_till_devices == null && limits?.max_registers ? t('as many as its tills') : undefined} />
          <Limit label={t('Administration|device')} used={used('office')} max={limits?.office ?? null} />
          <label className="flex items-start justify-between gap-3 rounded-md border p-3 text-[13px]">
            <span><span className="font-medium">{t('Every computer waits for approval')}</span>
              <span className="block text-muted-foreground">{t('Even within the limits, a new computer works only once you approve it.')}</span></span>
            <Switch checked={limits?.approval === 'request'} disabled={save.isPending || !limits} aria-label={t('Every computer waits for approval')}
              onCheckedChange={(on) => void save.mutateAsync({ company, approval: on ? 'request' : 'auto' }).catch((e) => toast.error(describeError(e)))} />
          </label>
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
