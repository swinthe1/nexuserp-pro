import type { ColumnDef } from '@tanstack/react-table'
import { Calculator, MoreHorizontal, ShieldCheck, UserPlus } from 'lucide-react'
import * as React from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Can, useCompany } from '@/app/company-provider'
import { ColumnHeader, DataTable, inFilter } from '@/components/data-table/data-table'
import { PageHeader } from '@/components/page-header'
import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { t, td } from '@/i18n'
import { formatDate, initials } from '@/lib/utils'
import { type CompanyUser, type RoleRow, useCompanyUsers, useInviteAccountant, useInviteMember, useRoles, useMemberWarehouses, useSetMemberRoles, useSetMemberStatus, useSetMemberWarehouses } from '../api'
import { useWarehouses } from '@/features/inventory/api'
import { PinDialog, SharedTillCard, useMemberExtras, useSetView } from '../components/easy-access'

export function UsersPage() {
  const { can } = useCompany()
  const users = useCompanyUsers()
  const roles = useRoles()
  const [params, setParams] = useSearchParams()
  const [inviteOpen, setInviteOpen] = React.useState(params.get('invite') === '1')
  const [editing, setEditing] = React.useState<CompanyUser | null>(null)
  const [removing, setRemoving] = React.useState<CompanyUser | null>(null)
  const setStatus = useSetMemberStatus()
  const write = can('admin.write')
  const extras = useMemberExtras()
  const setView = useSetView()
  const [pinFor, setPinFor] = React.useState<CompanyUser | null>(null)
  const [whFor, setWhFor] = React.useState<CompanyUser | null>(null)
  const memberWh = useMemberWarehouses()
  const whs = useWarehouses({ all: true })

  const roleOptions = React.useMemo(() => (roles.data ?? []).filter((r) => r.is_assignable).map((r) => ({ value: r.name, label: td(r.name) })), [roles.data])
  const cols = React.useMemo<ColumnDef<CompanyUser>[]>(() => [
    { id: 'person', accessorFn: (u) => `${u.full_name ?? ''} ${u.email}`, enableHiding: false, header: ({ column }) => <ColumnHeader column={column} title={t('Person')} />, meta: { label: t('Person'), exportValue: (u) => u.full_name ?? u.email },
      cell: ({ row: { original: u } }) => (
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium">{initials(u.full_name ?? u.email)}</span>
          <span className="min-w-0">
            <span className="block truncate font-medium">{u.full_name ?? u.email}{u.is_self && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{t('(you)')}</span>}
              {u.external_accountant && <Badge variant="outline" className="ml-1.5 border-primary/40 text-primary">{t('Outside accountant · free')}</Badge>}</span>
            <span className="block truncate text-xs text-muted-foreground">{u.email}</span>
          </span>
        </div>
      ) },
    { id: 'roles', accessorFn: (u) => u.role_names.map(td).join(', '), filterFn: (row, _id, value: string[]) => !value?.length || row.original.role_names.some((n) => value.includes(n)),
      header: t('Roles'), meta: { label: t('Roles') },
      cell: ({ row: { original: u } }) => <div className="flex flex-wrap gap-1">{u.role_names.map((n) => <Badge key={n} variant="secondary">{td(n)}</Badge>)}</div> },
    { id: 'warehouses', header: t('Warehouses'), meta: { label: t('Warehouses'), exportValue: (u) => (memberWh.data?.[u.member_id] ?? []).map((id) => whs.data?.find((w) => w.id === id)?.name ?? '').join(', ') || t('All') },
      cell: ({ row: { original: u } }) => {
        const ids = memberWh.data?.[u.member_id]
        return ids?.length ? <div className="flex flex-wrap gap-1">{ids.map((id) => <Badge key={id} variant="outline">{td(whs.data?.find((w) => w.id === id)?.name ?? '…')}</Badge>)}</div>
          : <span className="text-xs text-muted-foreground">{t('All')}</span>
      } },
    { id: 'easy', header: t('Sign-in and view'), meta: { label: t('Sign-in and view'), noExport: true },
      cell: ({ row: { original: u } }) => {
        const x = extras.data?.get(u.member_id)
        if (!x) return null
        return <div className="flex flex-wrap gap-1">
          {x.has_pin && <Badge variant="outline" className={x.pin_locked ? 'border-destructive/40 text-destructive' : ''}>{x.pin_locked ? t('PIN locked') : t('PIN')}</Badge>}
          {x.simple && <Badge variant="outline" className="border-primary/40 text-primary">{t('Simple view')}</Badge>}
        </div>
      } },
    { accessorKey: 'status', filterFn: inFilter, header: t('Status'), meta: { label: t('Status') }, cell: ({ getValue }) => <StatusBadge status={getValue() as string} /> },
    { accessorKey: 'last_sign_in_at', header: ({ column }) => <ColumnHeader column={column} title={t('Last signed in')} />, meta: { label: t('Last signed in') },
      cell: ({ getValue }) => <span className="text-muted-foreground">{getValue() ? formatDate(getValue() as string, true) : t('Never')}</span> },
    { accessorKey: 'joined_at', header: t('Joined'), meta: { label: t('Joined') }, cell: ({ getValue }) => <span className="text-muted-foreground">{formatDate(getValue() as string)}</span> },
    { id: 'employee', header: t('Employee'), meta: { label: t('Employee'), exportValue: (u) => (u.employee_id ? t('Yes') : '') },
      cell: ({ row: { original: u } }) => u.employee_id ? <Link to={`/hr/employees/${u.employee_id}`} className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{t('Employee file')}</Link> : null },
    { id: 'actions', enableHiding: false, header: '', meta: { noExport: true },
      cell: ({ row: { original: u } }) => write && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={t('Actions for {name}', { name: u.full_name ?? u.email })}><MoreHorizontal /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setEditing(u)}>{t('Change roles')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setWhFor(u)}>{t('Warehouses they work in')}</DropdownMenuItem>
            {u.user_id && u.status === 'active' && <DropdownMenuItem onSelect={() => setPinFor(u)}>{extras.data?.get(u.member_id)?.has_pin ? t('Change the PIN') : t('Give a PIN for the shared till')}</DropdownMenuItem>}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t('What they see')}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={extras.data?.get(u.member_id)?.view_mode ?? 'auto'} onValueChange={(v) => setView.mutate({ member: u.member_id, mode: v as 'auto' | 'simple' | 'full' })}>
              <DropdownMenuRadioItem value="auto">{t('Automatic, by their roles')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="simple">{t('Simple: large buttons')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="full">{t('Full: all menus')}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            {!u.is_self && u.status === 'active' && (
              <DropdownMenuItem onSelect={() => void setStatus.mutateAsync({ member: u.member_id, status: 'suspended' }).then(() => toast.success(t('{name} can no longer sign in to this company', { name: u.full_name ?? u.email })))}>
                {t('Suspend access')}
              </DropdownMenuItem>
            )}
            {!u.is_self && u.status === 'suspended' && (
              <DropdownMenuItem onSelect={() => void setStatus.mutateAsync({ member: u.member_id, status: 'active' }).then(() => toast.success(t('Access restored')))}>{t('Restore access')}</DropdownMenuItem>
            )}
            {!u.is_self && (<><DropdownMenuSeparator /><DropdownMenuItem className="text-destructive" onSelect={() => setRemoving(u)}>{t('Remove from company')}</DropdownMenuItem></>)}
          </DropdownMenuContent>
        </DropdownMenu>
      ) },
  ], [write, setStatus, extras.data, setView, memberWh.data, whs.data])

  return (
    <>
      <PageHeader title={t('Users and roles')} description={t('Who can sign in to this company and what each person may do. A person may do everything their roles allow.')}
        actions={<>
          <Button variant="outline" asChild><Link to="/settings/roles"><ShieldCheck /> {t('Roles and permissions')}</Link></Button>
          <Can perm="admin.write"><Button onClick={() => setInviteOpen(true)}><UserPlus /> {t('Invite a person')}</Button></Can>
        </>} />
      <SharedTillCard />
      <OutsideAccountantCard users={users.data ?? []} />
      <DataTable tableKey="settings.users" columns={cols} data={users.data} isLoading={users.isLoading} error={users.error} getRowId={(u) => u.member_id}
        exportName={t('users')} searchPlaceholder={t('Name or email…')}
        facets={[
          { columnId: 'status', title: t('Status'), options: [{ value: 'active', label: t('Active') }, { value: 'invited', label: t('Invited') }, { value: 'suspended', label: t('Suspended') }] },
          { columnId: 'roles', title: t('Role'), options: roleOptions },
        ]}
        empty={{ title: t('Nobody else yet'), description: t('Invite colleagues by email. For people without an account, the DrisPRO administrator makes one.') }} />
      <InviteDialog open={inviteOpen} onOpenChange={(o) => { setInviteOpen(o); if (!o && params.get('invite')) setParams({}, { replace: true }) }} roles={roles.data ?? []} />
      {pinFor && <PinDialog member={pinFor.member_id} name={pinFor.full_name ?? pinFor.email} hasPin={!!extras.data?.get(pinFor.member_id)?.has_pin} onClose={() => setPinFor(null)} />}
      {whFor && <WarehousesDialog user={whFor} current={memberWh.data?.[whFor.member_id] ?? []} onClose={() => setWhFor(null)} />}
      {editing && <RolesDialog user={editing} roles={roles.data ?? []} onClose={() => setEditing(null)} />}
      <Dialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('Remove {name}?', { name: removing?.full_name ?? removing?.email })}</DialogTitle>
            <DialogDescription>{t('They lose access to this company straight away. Documents they created keep their name. You can invite them again later.')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>{t('Keep')}</Button>
            <Button variant="destructive" loading={setStatus.isPending}
              onClick={() => void setStatus.mutateAsync({ member: removing!.member_id, status: 'removed' }).then(() => { toast.success(t('Removed from the company')); setRemoving(null) })}>
              {t('Remove from company')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function RolePicker({ roles, value, onChange }: { roles: RoleRow[]; value: string[]; onChange: (v: string[]) => void }) {
  const groups = [
    { title: t('Built-in roles'), items: roles.filter((r) => r.is_assignable && !r.company_id) },
    { title: t('Custom roles'), items: roles.filter((r) => r.company_id) },
  ].filter((g) => g.items.length)
  return (
    <div className="grid max-h-80 gap-3 overflow-y-auto pr-1">
      {groups.map((g) => (
        <div key={g.title}>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">{g.title}</p>
          <div className="grid gap-1">
            {g.items.map((r) => {
              const checked = value.includes(r.key)
              return (
                <label key={r.id} className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-secondary/60">
                  <Checkbox className="mt-0.5" checked={checked} onCheckedChange={(c) => onChange(c ? [...value, r.key] : value.filter((k) => k !== r.key))} />
                  <span className="min-w-0 text-[13px]"><span className="font-medium">{td(r.name)}</span>
                    {r.description && <span className="block text-xs text-muted-foreground">{td(r.description)}</span>}</span>
                </label>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function InviteDialog({ open, onOpenChange, roles }: { open: boolean; onOpenChange: (o: boolean) => void; roles: RoleRow[] }) {
  const invite = useInviteMember()
  const [email, setEmail] = React.useState('')
  const [picked, setPicked] = React.useState<string[]>([])
  React.useEffect(() => { if (open) { setEmail(''); setPicked([]) } }, [open])
  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) && picked.length > 0
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('Invite a person')}</DialogTitle>
          <DialogDescription>{t('If they already have an account they get access now; otherwise the DrisPRO administrator makes their account and gives you the password.')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5"><Label htmlFor="inv-email">{t('Email')}</Label>
            <Input id="inv-email" type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('name@company.al')} /></div>
          <div className="grid gap-1.5"><Label>{t('Roles')}</Label><RolePicker roles={roles} value={picked} onChange={setPicked} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('Cancel')}</Button>
          <Button disabled={!valid} loading={invite.isPending}
            onClick={() => void invite.mutateAsync({ email: email.trim(), roles: picked }).then(() => { toast.success(t('Invitation sent to {email}', { email: email.trim() })); onOpenChange(false) })}>
            {t('Send invitation')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RolesDialog({ user, roles, onClose }: { user: CompanyUser; roles: RoleRow[]; onClose: () => void }) {
  const save = useSetMemberRoles()
  const keyById = React.useMemo(() => new Map(roles.map((r) => [r.id, r.key])), [roles])
  const idByKey = React.useMemo(() => new Map(roles.map((r) => [r.key, r.id])), [roles])
  const [picked, setPicked] = React.useState<string[]>(() => user.role_ids.map((id) => keyById.get(id)).filter(Boolean) as string[])
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('Roles of {name}', { name: user.full_name ?? user.email })}</DialogTitle>
          <DialogDescription>{t('Changes apply the next time they open a page.')}</DialogDescription>
        </DialogHeader>
        <RolePicker roles={roles} value={picked} onChange={setPicked} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
          <Button disabled={!picked.length} loading={save.isPending}
            onClick={() => void save.mutateAsync({ member: user.member_id, roles: picked.map((k) => idByKey.get(k)!).filter(Boolean) }).then(() => { toast.success(t('Roles saved')); onClose() })}>
            {t('Save roles')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function WarehousesDialog({ user, current, onClose }: { user: CompanyUser; current: string[]; onClose: () => void }) {
  const whs = useWarehouses({ all: true })
  const save = useSetMemberWarehouses()
  const [picked, setPicked] = React.useState<string[]>(current)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Warehouses of {name}', { name: user.full_name ?? user.email })}</DialogTitle>
          <DialogDescription>{t('Tick the shops and warehouses this person works in. They can then receive, sell, count and move goods only there. With none ticked, they work in all.')}</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[50vh] gap-1 overflow-y-auto rounded-md border p-2">
          {(whs.data ?? []).filter((w) => w.is_active).map((w) => (
            <label key={w.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/50">
              <Checkbox checked={picked.includes(w.id)} onCheckedChange={(on) => setPicked((p) => on === true ? [...p, w.id] : p.filter((x) => x !== w.id))} />
              <span>{td(w.name)} <span className="text-xs text-muted-foreground">{w.code}</span></span>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={save.isPending} onClick={() => void save.mutateAsync({ member: user.member_id, warehouses: picked }).then(() => { toast.success(picked.length ? t('Saved: only the ticked warehouses') : t('Saved: all warehouses')); onClose() })}>{t('Save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** One outside accountant per company, free of the licence's user seats */
function OutsideAccountantCard({ users }: { users: CompanyUser[] }) {
  const { can } = useCompany()
  const invite = useInviteAccountant()
  const [email, setEmail] = React.useState('')
  const current = users.find((u) => u.external_accountant && u.status !== 'suspended')
  return (
    <div className="mb-5 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start gap-3">
        <Calculator className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{t('Your accountant, free')}</p>
          <p className="text-[13px] text-muted-foreground">{current
            ? t('{name} keeps your books in DrisPRO and does not take a user place of your licence.', { name: current.full_name ?? current.email })
            : t('Invite the accountant who keeps your books: they work in DrisPRO with the Accountant role and do not take a user place of your licence. If they keep other companies in DrisPRO, they see them all together.')}</p>
        </div>
        {!current && can('admin.write') && (
          <form className="flex w-full gap-2 sm:w-auto" onSubmit={(e) => { e.preventDefault(); void invite.mutateAsync(email.trim()).then(() => { toast.success(t('{email} is your accountant now', { email: email.trim() })); setEmail('') }) }}>
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('The accountant\u2019s email')} aria-label={t('The accountant\u2019s email')} className="sm:w-64" />
            <Button type="submit" loading={invite.isPending}>{t('Invite')}</Button>
          </form>
        )}
      </div>
    </div>
  )
}
