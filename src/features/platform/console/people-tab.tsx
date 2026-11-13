import { Copy, IdCard, KeyRound, MoreHorizontal, Play, Shield, UserMinus, UserPlus, UserX, Wand2 } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { t, td, tServer } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'
import { ProfileDialog } from '@/features/settings/components/profile-dialog'
import { type ClientDetail, type ClientMember, type CompanyRole, generatePin, useCompanyRoles, useMemberRoles, useMemberStatus } from '../api'
import { PasswordDialog } from '../dialogs'

/** The roles to choose, as ticks, with what each one may do */
function RolePicker({ roles, value, onChange }: { roles: CompanyRole[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="grid max-h-[40vh] gap-1 overflow-y-auto rounded-lg border p-2">
      {roles.map((r) => (
        <label key={r.key} className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/50">
          <Checkbox className="mt-0.5" checked={value.includes(r.key)} onCheckedChange={(on) => onChange(on ? [...value, r.key] : value.filter((k) => k !== r.key))} />
          <span className="min-w-0"><span className="block text-[13px] font-medium">{td(r.name)}</span>
            {r.description && <span className="block text-xs text-muted-foreground">{td(r.description)}</span>}</span>
        </label>
      ))}
    </div>
  )
}

const PIN_EMAIL = /@pin\.dris-ks\.com$/
const suggestUser = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').slice(0, 30)

/** A person for the client, as the company itself adds one: a user name and a 6-digit PIN, and their roles. */
function AddPersonDialog({ company, companyName, open, onClose }: { company: string; companyName: string; open: boolean; onClose: () => void }) {
  const roles = useCompanyRoles(open ? company : undefined)
  const qc = useQueryClient()
  const [f, setF] = React.useState({ name: '', username: '', pin: '', roles: [] as string[] })
  const userTouched = React.useRef(false)
  const [done, setDone] = React.useState<{ username: string; pin: string } | null>(null)
  const [err, setErr] = React.useState<string | null>(null)
  React.useEffect(() => { if (open) { setF({ name: '', username: '', pin: generatePin(), roles: [] }); setDone(null); setErr(null); userTouched.current = false } }, [open])
  const add = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('platform_member_create' as never, { p_company: company, p_name: f.name.trim(), p_username: f.username.trim(),
      p_pin: f.pin, p_role_keys: f.roles } as never)) as unknown as { username: string },
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['platform'] }); setDone({ username: r.username, pin: f.pin }) },
    onError: (x) => setErr(tServer(describeError(x))),
  })
  const copyAll = () => { void navigator.clipboard?.writeText(`${t('Address')}: ${window.location.origin}\n${t('User name')}: ${done!.username}\n${t('PIN')}: ${done!.pin}`); toast.success(t('Copied')) }
  const okUser = /^[a-z0-9][a-z0-9._-]{2,29}$/.test(f.username)
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{done ? t('The person is added') : t('Add a person to {name}', { name: companyName })}</DialogTitle>
          <DialogDescription>{done ? t('Hand over the user name and the PIN. They sign in with them on the first page of DrisPRO.')
            : t('Everyone in a company signs in with a user name and a 6-digit PIN.')}</DialogDescription>
        </DialogHeader>
        {done ? (
          <div className="grid gap-2 rounded-lg border bg-muted/40 p-3 font-mono text-[13px]">
            <div>{t('User name')}: {done.username}</div>
            <div>{t('PIN')}: {done.pin}</div>
          </div>
        ) : (
          <form id="add-person" className="grid gap-3" onSubmit={(e) => { e.preventDefault(); setErr(null); add.mutate() }}>
            <div className="grid gap-1.5"><Label htmlFor="ap-name">{t('Full name')}</Label>
              <Input id="ap-name" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value, username: userTouched.current ? f.username : suggestUser(e.target.value) })} /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5"><Label htmlFor="ap-user">{t('User name')}</Label>
                <Input id="ap-user" className="font-mono" spellCheck={false} autoCapitalize="none" value={f.username} aria-invalid={!!f.username && !okUser}
                  onChange={(e) => { userTouched.current = true; setF({ ...f, username: e.target.value.toLowerCase().replace(/\s/g, '') }) }} /></div>
              <div className="grid gap-1.5"><Label htmlFor="ap-pin">{t('PIN')}</Label>
                <div className="flex gap-2"><Input id="ap-pin" inputMode="numeric" maxLength={6} className="font-mono" value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, '') })} />
                  <Button type="button" variant="outline" size="icon" onClick={() => setF({ ...f, pin: generatePin() })} aria-label={t('Make a new PIN')}><Wand2 /></Button></div></div>
            </div>
            <div className="grid gap-1.5"><Label>{t('Roles')}</Label>{roles.data && <RolePicker roles={roles.data} value={f.roles} onChange={(r) => setF({ ...f, roles: r })} />}</div>
            {err && <p className="text-[13px] text-destructive">{err}</p>}
          </form>
        )}
        <DialogFooter>
          {done ? <>
            <Button variant="outline" onClick={copyAll}><Copy /> {t('Copy the details')}</Button>
            <Button onClick={onClose}>{t('Done')}</Button>
          </> : <>
            <Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
            <Button type="submit" form="add-person" loading={add.isPending} disabled={!f.name.trim() || !okUser || !/^\d{6}$/.test(f.pin) || !f.roles.length}><UserPlus /> {t('Add the person')}</Button>
          </>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** A new user name or a new PIN for a person of the client; a locked-out person is let in again too. */
function LoginDialog({ m, onClose }: { m: ClientMember | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [v, setV] = React.useState({ username: '', pin: '' })
  const [done, setDone] = React.useState<{ username: string; pin: string } | null>(null)
  React.useEffect(() => { if (m) { setV({ username: m.username ?? suggestUser(m.name ?? m.email.split('@')[0] ?? ''), pin: generatePin() }); setDone(null) } }, [m])
  const save = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('platform_member_login' as never, { p_member: m!.member_id, p_username: v.username.trim() || null, p_pin: v.pin || null } as never)) as unknown as { username: string },
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['platform'] }); setDone({ username: r.username, pin: v.pin }) },
    onError: (x) => toast.error(tServer(describeError(x))),
  })
  const okUser = /^[a-z0-9][a-z0-9._-]{2,29}$/.test(v.username)
  return (
    <Dialog open={!!m} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{t('User name and PIN of {name}', { name: m?.name ?? '' })}</DialogTitle>
          <DialogDescription>{done ? t('Saved. Hand over the new details; the old PIN no longer opens DrisPRO.') : t('A new PIN also lets in a person locked out after wrong PINs.')}</DialogDescription></DialogHeader>
        {done ? (
          <div className="grid gap-2 rounded-lg border bg-muted/40 p-3 font-mono text-[13px]"><div>{t('User name')}: {done.username}</div>{done.pin && <div>{t('PIN')}: {done.pin}</div>}</div>
        ) : (
          <div className="grid gap-3">
            <div className="grid gap-1.5"><Label htmlFor="ml-user">{t('User name')}</Label>
              <Input id="ml-user" className="font-mono" spellCheck={false} value={v.username} aria-invalid={!okUser} onChange={(e) => setV({ ...v, username: e.target.value.toLowerCase().replace(/\s/g, '') })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="ml-pin">{t('New PIN')}</Label>
              <div className="flex gap-2"><Input id="ml-pin" inputMode="numeric" maxLength={6} className="font-mono" value={v.pin} placeholder={t('empty: the PIN stays')} onChange={(e) => setV({ ...v, pin: e.target.value.replace(/\D/g, '') })} />
                <Button type="button" variant="outline" size="icon" onClick={() => setV({ ...v, pin: generatePin() })} aria-label={t('Make a new PIN')}><Wand2 /></Button></div></div>
          </div>
        )}
        <DialogFooter>
          {done ? <Button onClick={onClose}>{t('Done')}</Button> : <>
            <Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
            <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!okUser || (!!v.pin && !/^\d{6}$/.test(v.pin)) || (!m?.user_id && !v.pin)}><KeyRound /> {t('Save')}</Button></>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RolesDialog({ company, m, onClose }: { company: string; m: ClientMember | null; onClose: () => void }) {
  const roles = useCompanyRoles(m ? company : undefined)
  const save = useMemberRoles()
  const [v, setV] = React.useState<string[]>([])
  React.useEffect(() => { if (m) setV(m.role_keys ?? []) }, [m])
  return (
    <Dialog open={!!m} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{t('Roles of {name}', { name: m?.name ?? m?.email ?? '' })}</DialogTitle>
          <DialogDescription>{t('What the person may do in this company: everything their roles allow.')}</DialogDescription></DialogHeader>
        {roles.data && <RolePicker roles={roles.data} value={v} onChange={setV} />}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={save.isPending} disabled={!v.length} onClick={() => save.mutate({ member: m!.member_id, roles: v },
            { onSuccess: () => { toast.success(t('Roles saved')); onClose() }, onError: (e) => toast.error(describeError(e)) })}><Shield /> {t('Save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function PeopleTab({ d }: { d: ClientDetail }) {
  const [adding, setAdding] = React.useState(false)
  const [pw, setPw] = React.useState<string | null>(null)
  const [login, setLogin] = React.useState<ClientMember | null>(null)
  const [details, setDetails] = React.useState<string | null>(null)
  const [roles, setRoles] = React.useState<ClientMember | null>(null)
  const [removing, setRemoving] = React.useState<ClientMember | null>(null)
  const status = useMemberStatus()
  const setStatus = (m: ClientMember, s: 'active' | 'suspended' | 'removed', ok: string) =>
    status.mutate({ member: m.member_id, status: s }, { onSuccess: () => { toast.success(ok); setRemoving(null) }, onError: (e) => toast.error(describeError(e)) })
  const max = (d.licence?.max_users as number | undefined) ?? null
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div><CardTitle>{t('People')}</CardTitle>
          <CardDescription>{max != null ? t('{n} of {max} places in the licence are taken', { n: d.users, max }) : t('{n} people', { n: d.members.length })}</CardDescription></div>
        <Button onClick={() => setAdding(true)}><UserPlus /> {t('Add a person')}</Button>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <Table className="min-w-[760px]">
          <TableHeader><TableRow className="hover:bg-transparent">
            <TableHead>{t('Person')}</TableHead><TableHead>{t('Roles')}</TableHead><TableHead>{t('Status')}</TableHead><TableHead>{t('Last signed in')}</TableHead><TableHead className="w-12" />
          </TableRow></TableHeader>
          <TableBody>
            {d.members.map((m) => (
              <TableRow key={m.member_id}>
                <TableCell><div className="font-medium">{m.name ?? m.email}{m.is_admin && <Badge variant="outline" className="ml-2 border-primary/40 text-primary">{t('Administrator')}</Badge>}
                  {m.external_accountant && <Badge variant="outline" className="ml-1">{t('Outside accountant')}</Badge>}</div>
                  <div className="text-xs text-muted-foreground">{m.username ? <span className="font-mono">{m.username}</span> : PIN_EMAIL.test(m.email) ? t('no user name yet') : m.email}</div></TableCell>
                <TableCell><div className="flex flex-wrap gap-1">{m.roles.map((r) => <Badge key={r} variant="secondary">{td(r)}</Badge>)}</div></TableCell>
                <TableCell><Badge variant={m.status === 'active' ? 'success' : m.status === 'invited' ? 'warning' : 'secondary'}>{m.status === 'active' ? t('Active') : m.status === 'invited' ? t('Invited') : t('Suspended')}</Badge></TableCell>
                <TableCell className="text-[13px] text-muted-foreground">{m.last_sign_in_at ? formatDate(m.last_sign_in_at, true) : t('Never')}</TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={t('Actions for {name}', { name: m.name ?? m.email })}><MoreHorizontal /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      {!m.user_id && <DropdownMenuItem onSelect={() => setLogin(m)}><UserPlus /> {t('Give a user name and PIN')}</DropdownMenuItem>}
                      {m.user_id && <DropdownMenuItem onSelect={() => setDetails(m.user_id)}><IdCard /> {t('Change details')}</DropdownMenuItem>}
                      <DropdownMenuItem onSelect={() => setRoles(m)}><Shield /> {t('Change roles')}</DropdownMenuItem>
                      {m.user_id && !m.platform_admin && <DropdownMenuItem onSelect={() => setLogin(m)}><KeyRound /> {t('User name and PIN')}</DropdownMenuItem>}
                      {m.user_id && m.platform_admin && <DropdownMenuItem onSelect={() => setPw(m.email)}><KeyRound /> {t('Set a new password')}</DropdownMenuItem>}
                      <DropdownMenuSeparator />
                      {m.status === 'active' && <DropdownMenuItem onSelect={() => setStatus(m, 'suspended', t('{name} can no longer sign in to this company', { name: m.name ?? m.email }))}><UserX /> {t('Suspend access')}</DropdownMenuItem>}
                      {m.status === 'suspended' && <DropdownMenuItem onSelect={() => setStatus(m, 'active', t('Access restored'))}><Play /> {t('Restore access')}</DropdownMenuItem>}
                      <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setRemoving(m)}><UserMinus /> {t('Remove from company')}</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
            {!d.members.length && <TableRow><TableCell colSpan={5} className="py-8 text-center text-[13px] text-muted-foreground">{t('Nobody yet')}</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
      <AddPersonDialog company={d.company.id} companyName={d.company.name} open={adding} onClose={() => setAdding(false)} />
      <RolesDialog company={d.company.id} m={roles} onClose={() => setRoles(null)} />
      <PasswordDialog target={pw ? { email: pw } : null} onClose={() => setPw(null)} />
      <LoginDialog m={login} onClose={() => setLogin(null)} />
      {details && <ProfileDialog userId={details} companyId={d.company.id} onClose={() => setDetails(null)} />}
      <Dialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t('Remove {name}?', { name: removing?.name ?? removing?.email })}</DialogTitle>
            <DialogDescription>{t('They lose access to this company straight away. Documents they created keep their name. You can invite them again later.')}</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>{t('Keep')}</Button>
            <Button variant="destructive" loading={status.isPending} onClick={() => setStatus(removing!, 'removed', t('Removed from the company'))}>{t('Remove from company')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
