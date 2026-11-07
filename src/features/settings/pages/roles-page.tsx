import { Check, Copy, Plus, Trash2 } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { matchesPermission, useCompany } from '@/app/company-provider'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ErrorState } from '@/components/error-state'
import { msg, t, td, tn } from '@/i18n'
import { cn } from '@/lib/utils'
import { type RoleRow, useCompanyUsers, useDeleteCustomRole, usePermissionCatalog, useRoles, useSaveCustomRole } from '../api'
import { Field } from '../components/field'

const ACTIONS = [
  { key: 'read', label: msg('See') },
  { key: 'write', label: msg('Change|permission') },
  { key: 'delete', label: msg('Delete') },
  { key: 'approve', label: msg('Approve') },
] as const

type Draft = { id: string | null; name: string; description: string; perms: Set<string> }

const MODULE_LABEL: Record<string, string> = {
  admin: msg('Administration'), audit: msg('Change history'), collab: msg('Comments and files'), core: msg('Basics'), crm: msg('Customer contacts (CRM)'),
  ecommerce: msg('Web shop'), finance: msg('Finance'), hr: msg('People'), inventory: msg('Inventory'), invoicing: msg('Invoicing and payments'),
  logistics: msg('Logistics'), manufacturing: msg('Production'), oms: msg('Replenishment'), partners: msg('Customers and vendors'), payroll: msg('Payroll'),
  pos: msg('Point of sale'), procurement: msg('Purchasing'), reports: msg('Reports'), requisitions: msg('Purchase requests'), sales: msg('Sales'), tax: msg('Tax'),
  wms: msg('Warehouse floor'),
}

export function RolesPage() {
  const { can } = useCompany()
  const roles = useRoles()
  const catalog = usePermissionCatalog()
  const users = useCompanyUsers()
  const [selected, setSelected] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState<Draft | null>(null)
  const write = can('admin.write')

  // permissions beside see/change/delete/approve (what the goods cost)
  const extras = React.useMemo(() => (catalog.data ?? []).filter((p) => !ACTIONS.some((a) => a.key === p.action)).map((p) => ({ key: p.key, module: p.module, description: p.description ?? p.key })), [catalog.data])
  const modules = React.useMemo(() => {
    const m = new Map<string, string>()
    for (const p of catalog.data ?? []) if (!m.has(p.module)) m.set(p.module, p.description ?? p.module)
    return [...m.entries()].map(([key, description]) => ({ key, description }))
  }, [catalog.data])
  const memberCount = React.useMemo(() => {
    const c = new Map<string, number>()
    for (const u of users.data ?? []) for (const id of u.role_ids) c.set(id, (c.get(id) ?? 0) + 1)
    return c
  }, [users.data])

  if (roles.isError || catalog.isError) return <ErrorState error={roles.error ?? catalog.error} onRetry={() => { void roles.refetch(); void catalog.refetch() }} />
  if (roles.isLoading || catalog.isLoading) return <Skeleton className="h-[480px]" />
  const list = (roles.data ?? []).filter((r) => r.is_assignable)
  const role = list.find((r) => r.id === selected) ?? list[0]

  const startDraft = (from: RoleRow | null) => {
    const perms = new Set<string>()
    if (from) for (const m of modules) for (const a of ACTIONS) if (matchesPermission(from.permissions, `${m.key}.${a.key}`)) perms.add(`${m.key}.${a.key}`)
    if (from) for (const x of extras) if (matchesPermission(from.permissions, x.key)) perms.add(x.key)
    setDraft({ id: from?.company_id ? from.id : null, name: from?.company_id ? from.name : from ? t('{name} (custom)', { name: td(from.name) }) : '', description: from?.description ? td(from.description) : '', perms })
  }

  return (
    <>
      <PageHeader title={t('Roles and permissions')} back={{ href: '/settings/users', label: t('Users') }}
        description={t('What each role may see and change in every part of the app. Built-in roles are fixed; copy one into a custom role to change it.')}
        actions={write && <Button onClick={() => startDraft(null)}><Plus /> {t('New custom role')}</Button>} />
      <div className="grid gap-4 grid-cols-[minmax(0,1fr)] lg:grid-cols-[280px_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardContent className="grid gap-0.5 p-2">
            {list.map((r) => (
              <button key={r.id} type="button" onClick={() => { setSelected(r.id); setDraft(null) }}
                className={cn('flex items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-[13px] hover:bg-secondary/70',
                  role?.id === r.id && !draft && 'bg-secondary font-medium')}>
                <span className="min-w-0 truncate">{td(r.name)}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {r.company_id && <Badge variant="outline" className="px-1.5 text-2xs">{t('Custom')}</Badge>}
                  <span className="tabular text-xs text-muted-foreground">{memberCount.get(r.id) ?? 0}</span>
                </span>
              </button>
            ))}
          </CardContent>
        </Card>
        {draft ? (
          <RoleEditor draft={draft} setDraft={setDraft} modules={modules} extras={extras} onDone={(id) => { setDraft(null); if (id) setSelected(id) }} />
        ) : role && (
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
              <div className="min-w-0">
                <CardTitle className="flex items-center gap-2">{td(role.name)}{role.company_id ? <Badge variant="outline">{t('Custom')}</Badge> : <Badge variant="secondary">{t('Built in')}</Badge>}</CardTitle>
                <CardDescription>{role.description ? td(role.description) : t('No description.')} · {tn(memberCount.get(role.id) ?? 0, '{n} person', '{n} people')}</CardDescription>
              </div>
              {write && (
                <div className="flex shrink-0 gap-2">
                  {role.company_id ? (
                    <>
                      <Button variant="outline" size="sm" onClick={() => startDraft(role)}>{t('Edit')}</Button>
                      <DeleteRole role={role} onDeleted={() => setSelected(null)} />
                    </>
                  ) : <Button variant="outline" size="sm" onClick={() => startDraft(role)}><Copy /> {t('Copy as custom role')}</Button>}
                </div>
              )}
            </CardHeader>
            <CardContent className="p-0">
              <Matrix modules={modules} has={(p) => matchesPermission(role.permissions, p)} />
              <Extras extras={extras} has={(p) => matchesPermission(role.permissions, p)} />
            </CardContent>
          </Card>
        )}
      </div>
    </>
  )
}

type Extra = { key: string; module: string; description: string }

/** the permissions beside see, change, delete and approve: what the goods cost */
function Extras({ extras, has, toggle }: { extras: Extra[]; has: (perm: string) => boolean; toggle?: (perm: string) => void }) {
  if (!extras.length) return null
  return (
    <div className="grid gap-2 border-t px-6 py-3">
      <div className="text-sm font-medium">{t('Other permissions')}</div>
      {extras.map((x) => (
        <label key={x.key} className="flex items-center gap-2 text-[13px]">
          {toggle ? <Checkbox checked={has(x.key)} onCheckedChange={() => toggle(x.key)} />
            : has(x.key) ? <Check className="size-4 text-success" aria-label={t('Allowed')} /> : <span className="w-4 text-center text-muted-foreground/40" aria-label={t('Not allowed')}>·</span>}
          <span><span className="font-medium">{t(MODULE_LABEL[x.module] ?? x.module)}</span> · {td(x.description)}</span>
        </label>
      ))}
    </div>
  )
}

function Matrix({ modules, has, toggle, toggleRow }: {
  modules: { key: string; description: string }[]
  has: (perm: string) => boolean
  toggle?: (perm: string) => void
  toggleRow?: (module: string, on: boolean) => void
}) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-6">{t('Area')}</TableHead>
            {ACTIONS.map((a) => <TableHead key={a.key} className="w-24 text-center">{t(a.label)}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {modules.map((m) => {
            const all = ACTIONS.every((a) => has(`${m.key}.${a.key}`))
            return (
              <TableRow key={m.key}>
                <TableCell className="pl-6">
                  <div className="flex items-center gap-2">
                    {toggleRow && <Checkbox checked={all} onCheckedChange={(c) => toggleRow(m.key, !!c)} aria-label={t('Everything in {area}', { area: t(MODULE_LABEL[m.key] ?? m.key) })} />}
                    <span><span className="font-medium">{MODULE_LABEL[m.key] ? t(MODULE_LABEL[m.key]!) : m.key}</span><span className="block text-xs text-muted-foreground">{td(m.description)}</span></span>
                  </div>
                </TableCell>
                {ACTIONS.map((a) => {
                  const p = `${m.key}.${a.key}`
                  return (
                    <TableCell key={a.key} className="text-center">
                      {toggle
                        ? <Checkbox checked={has(p)} onCheckedChange={() => toggle(p)} aria-label={`${t(a.label)} · ${t(MODULE_LABEL[m.key] ?? m.key)}`} />
                        : has(p) ? <Check className="mx-auto size-4 text-success" aria-label={t('Allowed')} /> : <span className="text-muted-foreground/40" aria-label={t('Not allowed')}>·</span>}
                    </TableCell>
                  )
                })}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function RoleEditor({ draft, setDraft, modules, extras, onDone }: {
  draft: Draft; setDraft: (d: Draft) => void; modules: { key: string; description: string }[]; extras: Extra[]; onDone: (id?: string) => void
}) {
  const save = useSaveCustomRole()
  const toggle = (p: string) => { const s = new Set(draft.perms); if (s.has(p)) s.delete(p); else s.add(p); setDraft({ ...draft, perms: s }) }
  const toggleRow = (m: string, on: boolean) => {
    const s = new Set(draft.perms)
    for (const a of ACTIONS) { if (on) s.add(`${m}.${a.key}`); else s.delete(`${m}.${a.key}`) }
    setDraft({ ...draft, perms: s })
  }
  const submit = async () => {
    if (!draft.name.trim()) return toast.error(t('Give the role a name.'))
    // whole modules are stored as module.*
    const out: string[] = []
    for (const m of modules) {
      const on = ACTIONS.filter((a) => draft.perms.has(`${m.key}.${a.key}`)).map((a) => a.key)
      if (on.length === ACTIONS.length) out.push(`${m.key}.*`)
      else out.push(...on.map((a) => `${m.key}.${a}`))
    }
    for (const x of extras) if (draft.perms.has(x.key) && !out.includes(`${x.module}.*`)) out.push(x.key)
    if (!out.length) return toast.error(t('Give the role at least one permission.'))
    const id = await save.mutateAsync({ id: draft.id, name: draft.name.trim(), description: draft.description.trim(), permissions: out })
    toast.success(draft.id ? t('Role saved') : t('Custom role created'))
    onDone(id)
  }
  return (
    <Card>
      <CardHeader><CardTitle>{draft.id ? t('Edit custom role') : t('New custom role')}</CardTitle>
        <CardDescription>{t('“See” lets people open the pages; “Change” lets them create and edit; “Approve” lets them decide on what others send for approval.')}</CardDescription></CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <Field label={t('Name')} htmlFor="role-name"><Input id="role-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={t('e.g. Shop supervisor')} /></Field>
        <Field label={t('What it is for')} htmlFor="role-desc"><Input id="role-desc" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field>
      </CardContent>
      <Matrix modules={modules} has={(p) => draft.perms.has(p)} toggle={toggle} toggleRow={toggleRow} />
      <Extras extras={extras} has={(p) => draft.perms.has(p)} toggle={toggle} />
      <div className="flex justify-end gap-2 border-t px-6 py-3">
        <Button variant="outline" onClick={() => onDone()}>{t('Cancel')}</Button>
        <Button loading={save.isPending} onClick={() => void submit()}>{draft.id ? t('Save role') : t('Create role')}</Button>
      </div>
    </Card>
  )
}

function DeleteRole({ role, onDeleted }: { role: RoleRow; onDeleted: () => void }) {
  const del = useDeleteCustomRole()
  return (
    <ConfirmDialog trigger={<Button variant="outline" size="sm"><Trash2 /> {t('Delete')}</Button>} title={t('Delete {name}?', { name: td(role.name) })}
      description={t('Take the role away from everyone first. Built-in roles stay.')} confirmLabel={t('Delete role')} destructive
      onConfirm={async () => { await del.mutateAsync(role.id); toast.success(t('Role deleted')); onDeleted() }} />
  )
}
