import { ArrowDown, Pencil, Plus, Trash2, Workflow as WorkflowIcon } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { Can, useCompany } from '@/app/company-provider'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { ErrorState } from '@/components/error-state'
import { t, td } from '@/i18n'
import { formatMoney } from '@/lib/utils'
import { type Workflow, useApprovalDocTypes, useCompanyUsers, useDeleteWorkflow, useRoles, useSaveWorkflow, useToggleWorkflow, useWorkflows } from '../api'
import { Field } from '../components/field'

type StepDraft = { name: string; approver: string; min_approvals: number }   // approver = 'role:<id>' | 'user:<id>'
type Draft = { id?: string; name: string; doc_type: string; min_amount: string; priority: string; is_active: boolean; steps: StepDraft[] }

export function WorkflowsPage() {
  const { company } = useCompany()
  const workflows = useWorkflows()
  const docTypes = useApprovalDocTypes()
  const roles = useRoles()
  const users = useCompanyUsers()
  const toggle = useToggleWorkflow()
  const [draft, setDraft] = React.useState<Draft | null>(null)
  const docName = (k: string) => td(docTypes.data?.find((d) => d.key === k)?.name ?? k)
  const approverName = (s: Workflow['steps'][number]) => s.approver_role_id
    ? td(roles.data?.find((r) => r.id === s.approver_role_id)?.name) || t('Role')
    : users.data?.find((u) => u.user_id === s.approver_user_id)?.full_name ?? t('Person')

  const groups = React.useMemo(() => {
    const m = new Map<string, Workflow[]>()
    for (const w of workflows.data ?? []) m.set(w.doc_type, [...(m.get(w.doc_type) ?? []), w])
    return [...m.entries()]
  }, [workflows.data])

  const edit = (w?: Workflow) => setDraft(w ? {
    id: w.id, name: w.name, doc_type: w.doc_type, min_amount: String(w.min_amount ?? 0), priority: String(w.priority), is_active: w.is_active,
    steps: w.steps.map((s) => ({ name: s.name, approver: s.approver_role_id ? `role:${s.approver_role_id}` : `user:${s.approver_user_id}`, min_approvals: s.min_approvals })),
  } : { name: '', doc_type: docTypes.data?.[0]?.key ?? 'purchase_order', min_amount: '0', priority: '100', is_active: true, steps: [{ name: t('Manager'), approver: '', min_approvals: 1 }] })

  return (
    <>
      <PageHeader title={t('Approval workflows')} description={t('Which documents need someone to approve them, from what amount, and who decides at each step.')}
        actions={<Can perm="admin.write"><Button onClick={() => edit()}><Plus /> {t('New workflow')}</Button></Can>} />
      {workflows.isError ? <ErrorState error={workflows.error} onRetry={() => void workflows.refetch()} /> : workflows.isLoading ? <Skeleton className="h-64" /> : !groups.length ? (
        <EmptyState icon={WorkflowIcon} title={t('No approval workflows')} description={t('Without one, documents that can be approved (purchase orders, vendor payments, stock adjustments, purchase requests, leave) are approved as soon as they are sent.')}
          action={<Can perm="admin.write"><Button onClick={() => edit()}><Plus /> {t('New workflow')}</Button></Can>} />
      ) : (
        <div className="grid gap-4">
          <p className="text-[13px] text-muted-foreground">{t('When several workflows fit a document, the highest priority wins, then the highest amount. Amounts are in {currency}.', { currency: company?.base_currency ?? '' })}</p>
          {groups.map(([doc, list]) => (
            <Card key={doc}>
              <CardHeader className="pb-2"><CardTitle>{docName(doc)}</CardTitle></CardHeader>
              <CardContent className="grid gap-3 p-0 pb-2">
                {list.map((w) => (
                  <div key={w.id} className="flex flex-col gap-3 border-t px-6 py-3 first:border-t-0 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium">{w.name}
                        <span className="font-normal text-muted-foreground">{t('from {amount} · priority {priority}', { amount: formatMoney(w.min_amount ?? 0, company?.base_currency), priority: w.priority })}</span>
                        {!w.is_active && <Badge variant="secondary">{t('Off')}</Badge>}
                        {(w.pending[0]?.count ?? 0) > 0 && <Badge variant="warning">{t('{n} waiting', { n: w.pending[0]!.count })}</Badge>}
                      </p>
                      <ol className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                        {w.steps.map((s, i) => (
                          <li key={s.id} className="flex items-center gap-1.5">
                            {i > 0 && <ArrowDown className="size-3 -rotate-90 text-muted-foreground" aria-hidden />}
                            <span className="rounded-md border px-2 py-0.5">{s.name}: {approverName(s)}{s.min_approvals > 1 ? ` ${t('({n} of them)', { n: s.min_approvals })}` : ''}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                    <Can perm="admin.write">
                      <div className="flex shrink-0 items-center gap-2">
                        <Switch checked={w.is_active} aria-label={t('{name} on', { name: w.name })} onCheckedChange={(c) => void toggle.mutateAsync({ id: w.id, is_active: c })} />
                        <Button variant="ghost" size="icon-sm" aria-label={t('Edit {name}', { name: w.name })} onClick={() => edit(w)}><Pencil /></Button>
                        <DeleteWorkflow w={w} />
                      </div>
                    </Can>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {draft && <WorkflowDialog draft={draft} setDraft={setDraft} />}
    </>
  )
}

function DeleteWorkflow({ w }: { w: Workflow }) {
  const del = useDeleteWorkflow()
  return (
    <ConfirmDialog trigger={<Button variant="ghost" size="icon-sm" aria-label={t('Delete {name}', { name: w.name })}><Trash2 /></Button>} title={t('Delete {name}?', { name: w.name })}
      description={t('Documents already waiting keep their approval steps; new ones no longer use this workflow.')} confirmLabel={t('Delete workflow')} destructive
      onConfirm={async () => { await del.mutateAsync(w.id); toast.success(t('Workflow deleted')) }} />
  )
}

function WorkflowDialog({ draft, setDraft }: { draft: Draft; setDraft: (d: Draft | null) => void }) {
  const docTypes = useApprovalDocTypes()
  const roles = useRoles()
  const users = useCompanyUsers()
  const save = useSaveWorkflow()
  const setStep = (i: number, s: Partial<StepDraft>) => setDraft({ ...draft, steps: draft.steps.map((x, j) => (j === i ? { ...x, ...s } : x)) })
  const valid = draft.name.trim() && draft.steps.length && draft.steps.every((s) => s.approver)
  const submit = async () => {
    await save.mutateAsync({
      id: draft.id, name: draft.name.trim(), doc_type: draft.doc_type, min_amount: Number(draft.min_amount) || 0, priority: Number(draft.priority) || 100,
      is_active: draft.is_active,
      steps: draft.steps.map((s) => ({ name: s.name.trim() || undefined, min_approvals: s.min_approvals,
        approver_role_id: s.approver.startsWith('role:') ? s.approver.slice(5) : undefined, approver_user_id: s.approver.startsWith('user:') ? s.approver.slice(5) : undefined })),
    })
    toast.success(draft.id ? t('Workflow saved') : t('Workflow created'))
    setDraft(null)
  }
  return (
    <Dialog open onOpenChange={(o) => !o && setDraft(null)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{draft.id ? t('Edit workflow') : t('New workflow')}</DialogTitle>
          <DialogDescription>{t('Steps run in order. A step is done when enough of its approvers say yes; one “no” sends the document back.')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('Name')} htmlFor="wf-name" className="sm:col-span-2"><Input id="wf-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={t('e.g. Large purchases')} /></Field>
          <Field label={t('Document')} htmlFor="wf-doc">
            <Select value={draft.doc_type} onValueChange={(d) => setDraft({ ...draft, doc_type: d })}>
              <SelectTrigger id="wf-doc"><SelectValue /></SelectTrigger>
              <SelectContent>{docTypes.data?.map((d) => <SelectItem key={d.key} value={d.key}>{td(d.name)}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label={t('From amount')} htmlFor="wf-min" hint={t('Documents of this amount or more.')}><Input id="wf-min" type="number" min={0} className="tabular" value={draft.min_amount} onChange={(e) => setDraft({ ...draft, min_amount: e.target.value })} /></Field>
          <Field label={t('Priority')} htmlFor="wf-pri" hint={t('Higher wins.')}><Input id="wf-pri" type="number" className="tabular" value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })} /></Field>
          <Field label={t('On')} htmlFor="wf-on"><Switch id="wf-on" checked={draft.is_active} onCheckedChange={(c) => setDraft({ ...draft, is_active: c })} /></Field>
        </div>
        <div className="grid gap-2">
          <p className="text-[13px] font-medium">{t('Steps')}</p>
          {draft.steps.map((s, i) => (
            <div key={i} className="grid grid-cols-[1.5rem_1fr] items-start gap-2 rounded-md border p-2 sm:grid-cols-[1.5rem_1fr_1.4fr_5rem_2rem]">
              <span className="pt-2 text-center text-xs tabular text-muted-foreground">{i + 1}</span>
              <Input aria-label={t('Step {n} name', { n: i + 1 })} value={s.name} onChange={(e) => setStep(i, { name: e.target.value })} placeholder={t('Step name')} />
              <Select value={s.approver || undefined} onValueChange={(a) => setStep(i, { approver: a })}>
                <SelectTrigger aria-label={t('Step {n} approver', { n: i + 1 })} className="col-start-2 sm:col-start-auto"><SelectValue placeholder={t('Who approves')} /></SelectTrigger>
                <SelectContent>
                  {roles.data?.filter((r) => r.is_assignable).map((r) => <SelectItem key={r.id} value={`role:${r.id}`}>{t('Anyone with the {role} role', { role: td(r.name) })}</SelectItem>)}
                  {users.data?.filter((u) => u.user_id && u.status === 'active').map((u) => <SelectItem key={u.member_id} value={`user:${u.user_id}`}>{u.full_name ?? u.email}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input aria-label={t('Step {n}: approvals needed', { n: i + 1 })} type="number" min={1} className="col-start-2 tabular sm:col-start-auto" value={s.min_approvals}
                onChange={(e) => setStep(i, { min_approvals: Math.max(1, Number(e.target.value) || 1) })} title={t('Approvals needed')} />
              <Button variant="ghost" size="icon-sm" aria-label={t('Remove step {n}', { n: i + 1 })} disabled={draft.steps.length === 1}
                onClick={() => setDraft({ ...draft, steps: draft.steps.filter((_, j) => j !== i) })}><Trash2 /></Button>
            </div>
          ))}
          <Button variant="outline" size="sm" className="w-fit" onClick={() => setDraft({ ...draft, steps: [...draft.steps, { name: t('Step {n}', { n: draft.steps.length + 1 }), approver: '', min_approvals: 1 }] })}>
            <Plus /> {t('Add a step')}
          </Button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDraft(null)}>{t('Cancel')}</Button>
          <Button disabled={!valid} loading={save.isPending} onClick={() => void submit()}>{draft.id ? t('Save workflow') : t('Create workflow')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
