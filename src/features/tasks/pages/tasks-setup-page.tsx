import { Pencil, Play, Plus, Repeat, Rocket, Sparkles, Trash2, X } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { Can, useCompany } from '@/app/company-provider'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { msg, t } from '@/i18n'
import { formatDate, num } from '@/lib/utils'
import {
  useApplyTemplate, useDeleteRule, useDeleteTemplate, usePeople, useRunAutomations, useSaveRule, useSaveTaskSettings, useSaveTemplate, useTaskLists,
  useTaskRules, useTaskSettings, useTaskTemplates, type TaskRule, type TaskTemplate, type TemplateItem,
} from '../api'
import { PersonSelect } from '../components/task-sheet'
import { Avatar, PRIORITY_LABEL, todayISO } from '../components/task-bits'

export function TasksSetupPage() {
  return (
    <>
      <PageHeader title={t('Repeating and automatic tasks')} back={{ href: '/tasks', label: t('Tasks|menu') }}
        description={t('Tasks that come back on their own, sets of tasks you start with one click, and tasks the program makes from what happens.')} />
      <Tabs defaultValue="repeat">
        <TabsList><TabsTrigger value="repeat">{t('Repeating')}</TabsTrigger><TabsTrigger value="templates">{t('Templates')}</TabsTrigger><TabsTrigger value="auto">{t('Automatic')}</TabsTrigger></TabsList>
        <TabsContent value="repeat"><Rules /></TabsContent>
        <TabsContent value="templates"><Templates /></TabsContent>
        <TabsContent value="auto"><Automations /></TabsContent>
      </Tabs>
    </>
  )
}

/* ------------------------------------------------------------------ repeating */
const FREQ: Record<string, string> = { daily: msg('Every day'), workdays: msg('Every working day'), weekly: msg('Every week'), monthly: msg('Every month') }
const DAYS = [msg('Mon'), msg('Tue'), msg('Wed'), msg('Thu'), msg('Fri'), msg('Sat'), msg('Sun')]
function ruleWords(r: Pick<TaskRule, 'freq' | 'weekdays' | 'month_day'>) {
  if (r.freq === 'weekly' && r.weekdays.length) return `${t(FREQ.weekly!)}: ${r.weekdays.map((d) => t(DAYS[d - 1]!)).join(', ')}`
  if (r.freq === 'monthly') return r.month_day === 0 ? t('Every month, on the last day') : t('Every month, on day {n}', { n: r.month_day ?? 1 })
  return t(FREQ[r.freq]!)
}
function Rules() {
  const rules = useTaskRules()
  const people = usePeople()
  const del = useDeleteRule()
  const save = useSaveRule()
  const [edit, setEdit] = React.useState<TaskRule | 'new' | null>(null)
  const pmap = new Map((people.data ?? []).map((p) => [p.user_id, p]))
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 py-3">
        <div><CardTitle>{t('Repeating tasks')}</CardTitle><CardDescription>{t('E.g. opening the shop every morning, counting the cash on Saturday, the VAT return on the 15th. Each one is made on its day, with its checklist.')}</CardDescription></div>
        <Button size="sm" onClick={() => setEdit('new')}><Plus /> {t('New repeating task')}</Button>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <Table><TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Task')}</TableHead><TableHead>{t('When')}</TableHead><TableHead>{t('Person|task')}</TableHead><TableHead>{t('Next|time')}</TableHead><TableHead>{t('On')}</TableHead><TableHead className="w-[1%]" /></TableRow></TableHeader>
          <TableBody>
            {(rules.data ?? []).map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium"><span className="flex items-center gap-1.5"><Repeat className="size-3.5 text-muted-foreground" />{r.title}</span>
                  {!!r.checklist.length && <span className="text-xs text-muted-foreground">{t('{n} steps', { n: r.checklist.length })}</span>}</TableCell>
                <TableCell>{ruleWords(r)}</TableCell>
                <TableCell><span className="flex items-center gap-2"><Avatar person={pmap.get(r.assignee_id ?? '')} size={20} />{pmap.get(r.assignee_id ?? '')?.name ?? t('Nobody yet')}</span></TableCell>
                <TableCell className="tabular">{formatDate(r.next_on)}</TableCell>
                <TableCell><Switch checked={r.active} aria-label={t('On')} onCheckedChange={(v) => save.mutate({ id: r.id, title: r.title, freq: r.freq, next_on: r.next_on, active: v })} /></TableCell>
                <TableCell><div className="flex gap-1"><Button size="icon-sm" variant="ghost" aria-label={t('Edit {name}', { name: r.title })} onClick={() => setEdit(r)}><Pencil /></Button>
                  <ConfirmDialog trigger={<Button size="icon-sm" variant="ghost" aria-label={t('Delete {name}', { name: r.title })}><Trash2 /></Button>} title={t('Delete {name}?', { name: r.title })}
                    description={t('No new tasks are made from it. The ones already made stay.')} confirmLabel={t('Delete')} destructive onConfirm={() => del.mutateAsync(r.id)} /></div></TableCell>
              </TableRow>))}
            {!rules.isLoading && !rules.data?.length && <TableRow className="hover:bg-transparent"><TableCell colSpan={6} className="py-8 text-center text-[13px] text-muted-foreground">{t('No repeating tasks yet.')}</TableCell></TableRow>}
          </TableBody></Table>
      </CardContent>
      {edit && <RuleDialog rule={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </Card>
  )
}

function RuleDialog({ rule, onClose }: { rule: TaskRule | null; onClose: () => void }) {
  const people = usePeople()
  const lists = useTaskLists()
  const save = useSaveRule()
  const [v, setV] = React.useState({
    title: rule?.title ?? '', description: rule?.description ?? '', assignee_id: rule?.assignee_id ?? people.data?.find((p) => p.is_me)?.user_id ?? null,
    list_id: rule?.list_id ?? null, priority: rule?.priority ?? 1, freq: rule?.freq ?? 'workdays', weekdays: rule?.weekdays ?? [1], month_day: rule?.month_day ?? 1,
    next_on: rule?.next_on ?? todayISO(), checklist: (rule?.checklist ?? []).join('\n'),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader><DialogTitle>{rule ? t('Edit repeating task') : t('New repeating task')}</DialogTitle>
          <DialogDescription>{t('The task is made on each of its days, with the steps below as its checklist.')}</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label htmlFor="rl-title">{t('Task')}</Label><Input id="rl-title" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder={t('e.g. Opening the shop')} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label>{t('How often')}</Label>
              <Select value={v.freq} onValueChange={(x) => setV({ ...v, freq: x })}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(FREQ).map(([k, l]) => <SelectItem key={k} value={k}>{t(l)}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-1.5"><Label htmlFor="rl-next">{t('First (next) time')}</Label><Input id="rl-next" type="date" value={v.next_on} onChange={(e) => setV({ ...v, next_on: e.target.value })} /></div>
          </div>
          {v.freq === 'weekly' && <div className="flex flex-wrap gap-1.5">{DAYS.map((d, i) => { const on = v.weekdays.includes(i + 1)
            return <Button key={d} type="button" size="sm" variant={on ? 'default' : 'outline'} aria-pressed={on}
              onClick={() => setV({ ...v, weekdays: on ? v.weekdays.filter((x) => x !== i + 1) : [...v.weekdays, i + 1].sort() })}>{t(d)}</Button> })}</div>}
          {v.freq === 'monthly' && <div className="grid gap-1.5"><Label htmlFor="rl-md">{t('Day of the month (0 = the last day)')}</Label>
            <Input id="rl-md" type="number" min={0} max={31} className="w-28 text-right tabular" value={v.month_day} onChange={(e) => setV({ ...v, month_day: Math.max(0, Math.min(31, num(e.target.value))) })} /></div>}
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label>{t('Person|task')}</Label><PersonSelect people={people.data ?? []} value={v.assignee_id} onChange={(x) => setV({ ...v, assignee_id: x })} /></div>
            <div className="grid gap-1.5"><Label>{t('Priority')}</Label>
              <Select value={String(v.priority)} onValueChange={(x) => setV({ ...v, priority: Number(x) })}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{[3, 2, 1, 0].map((p) => <SelectItem key={p} value={String(p)}>{t(PRIORITY_LABEL[p]!)}</SelectItem>)}</SelectContent></Select></div>
          </div>
          <div className="grid gap-1.5"><Label>{t('List')}</Label>
            <Select value={v.list_id ?? 'none'} onValueChange={(x) => setV({ ...v, list_id: x === 'none' ? null : x })}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="none">{t('No list')}</SelectItem>{(lists.data ?? []).map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-1.5"><Label htmlFor="rl-steps">{t('Steps (one per line)')}</Label>
            <Textarea id="rl-steps" rows={4} value={v.checklist} onChange={(e) => setV({ ...v, checklist: e.target.value })} placeholder={t('Lights on\nScale checked\nPrices on the shelf')} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={save.isPending} disabled={!v.title.trim() || !v.next_on || (v.freq === 'weekly' && !v.weekdays.length)} onClick={async () => {
            await save.mutateAsync({ id: rule?.id, title: v.title.trim(), description: v.description.trim() || null, assignee_id: v.assignee_id, list_id: v.list_id, priority: v.priority,
              freq: v.freq, weekdays: v.freq === 'weekly' ? v.weekdays : [], month_day: v.freq === 'monthly' ? v.month_day : null, next_on: v.next_on,
              checklist: v.checklist.split('\n').map((x) => x.trim()).filter(Boolean) })
            toast.success(t('Saved')); onClose()
          }}>{t('Save')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ templates */
function Templates() {
  const tpls = useTaskTemplates()
  const del = useDeleteTemplate()
  const [edit, setEdit] = React.useState<TaskTemplate | 'new' | null>(null)
  const [start, setStart] = React.useState<TaskTemplate | null>(null)
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 py-3">
        <div><CardTitle>{t('Templates')}</CardTitle><CardDescription>{t('A set of tasks you start with one click, e.g. a new employee: open the account, training at the till, the contract.')}</CardDescription></div>
        <Can perm="tasks.write"><Button size="sm" onClick={() => setEdit('new')}><Plus /> {t('New template')}</Button></Can>
      </CardHeader>
      <CardContent className="grid gap-2 pb-4">
        {(tpls.data ?? []).map((x) => (
          <div key={x.id} className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2">
            <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium">{x.name}</span>
              <span className="text-xs text-muted-foreground">{(x.items as TemplateItem[]).map((i) => i.title).join(' · ')}</span></span>
            <Can perm="tasks.write"><Button size="sm" onClick={() => setStart(x)}><Rocket /> {t('Start|lesson')}</Button>
              <Button size="icon-sm" variant="ghost" aria-label={t('Edit {name}', { name: x.name })} onClick={() => setEdit(x)}><Pencil /></Button>
              <ConfirmDialog trigger={<Button size="icon-sm" variant="ghost" aria-label={t('Delete {name}', { name: x.name })}><Trash2 /></Button>} title={t('Delete {name}?', { name: x.name })}
                description={t('Tasks already made from it stay.')} confirmLabel={t('Delete')} destructive onConfirm={() => del.mutateAsync(x.id)} /></Can>
          </div>))}
        {!tpls.isLoading && !tpls.data?.length && <p className="py-6 text-center text-[13px] text-muted-foreground">{t('No templates yet.')}</p>}
      </CardContent>
      {edit && <TemplateDialog tpl={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {start && <StartDialog tpl={start} onClose={() => setStart(null)} />}
    </Card>
  )
}

function TemplateDialog({ tpl, onClose }: { tpl: TaskTemplate | null; onClose: () => void }) {
  const save = useSaveTemplate()
  const [name, setName] = React.useState(tpl?.name ?? '')
  const [items, setItems] = React.useState<TemplateItem[]>((tpl?.items as TemplateItem[]) ?? [{ title: '', due_in_days: 0 }])
  const set = (i: number, v: Partial<TemplateItem>) => setItems(items.map((x, j) => (j === i ? { ...x, ...v } : x)))
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader><DialogTitle>{tpl ? t('Edit template') : t('New template')}</DialogTitle><DialogDescription>{t('Each line is a task; "days" counts from the day you start the template.')}</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label htmlFor="tp-name">{t('Name')}</Label><Input id="tp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('e.g. New employee')} /></div>
          <div className="grid gap-2">
            {items.map((x, i) => (
              <div key={i} className="grid grid-cols-[1fr_90px_auto] items-center gap-2">
                <Input value={x.title} onChange={(e) => set(i, { title: e.target.value })} placeholder={t('Task {n}', { n: i + 1 })} aria-label={t('Task {n}', { n: i + 1 })} />
                <Input type="number" min={0} className="text-right tabular" value={x.due_in_days} onChange={(e) => set(i, { due_in_days: Math.max(0, num(e.target.value)) })} aria-label={t('Days after the start')} />
                <Button size="icon-sm" variant="ghost" aria-label={t('Remove')} disabled={items.length === 1} onClick={() => setItems(items.filter((_, j) => j !== i))}><X /></Button>
              </div>))}
            <Button size="sm" variant="outline" className="justify-self-start" onClick={() => setItems([...items, { title: '', due_in_days: items.at(-1)?.due_in_days ?? 0 }])}><Plus /> {t('Add a task')}</Button>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={save.isPending} disabled={!name.trim() || !items.some((x) => x.title.trim())} onClick={async () => {
            await save.mutateAsync({ id: tpl?.id, name: name.trim(), items: items.filter((x) => x.title.trim()).map((x) => ({ ...x, title: x.title.trim() })) })
            toast.success(t('Saved')); onClose()
          }}>{t('Save')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function StartDialog({ tpl, onClose }: { tpl: TaskTemplate; onClose: () => void }) {
  const people = usePeople()
  const lists = useTaskLists()
  const apply = useApplyTemplate()
  const [v, setV] = React.useState({ start: todayISO(), assignee: null as string | null, list: null as string | null })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{t('Start {name}', { name: tpl.name })}</DialogTitle><DialogDescription>{t('{n} tasks are made, dated from the start day.', { n: (tpl.items as TemplateItem[]).length })}</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label htmlFor="st-from">{t('Start day')}</Label><Input id="st-from" type="date" value={v.start} onChange={(e) => setV({ ...v, start: e.target.value })} /></div>
          <div className="grid gap-1.5"><Label>{t('Person|task')}</Label><PersonSelect people={people.data ?? []} value={v.assignee} onChange={(x) => setV({ ...v, assignee: x })} /></div>
          <div className="grid gap-1.5"><Label>{t('List')}</Label>
            <Select value={v.list ?? 'none'} onValueChange={(x) => setV({ ...v, list: x === 'none' ? null : x })}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="none">{t('No list')}</SelectItem>{(lists.data ?? []).map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent></Select></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={apply.isPending} disabled={!v.start} onClick={async () => { const n = await apply.mutateAsync({ template: tpl.id, ...v }); toast.success(t('{n} tasks made', { n })); onClose() }}><Rocket /> {t('Start|lesson')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ automatic */
const AUTOS: { key: string; title: string; what: string; who: string; days?: { label: string; def: number } }[] = [
  { key: 'late_invoice', title: msg('Late invoices'), what: msg('Call the customer about an unpaid invoice.'), who: msg('Whoever sells to that customer, else the sales manager'), days: { label: msg('days late'), def: 15 } },
  { key: 'cash_diff', title: msg('Till differences'), what: msg('Explain a difference found when the till was closed.'), who: msg('The cashier of that shift'), days: { label: msg('more than (in money)'), def: 5 } },
  { key: 'po_confirm', title: msg('Orders not confirmed'), what: msg('Ask the vendor to confirm a purchase order sent some days ago.'), who: msg('The buyer of that order, else the purchasing manager'), days: { label: msg('days after it was sent'), def: 2 } },
  { key: 'late_po', title: msg('Late purchase orders'), what: msg('Call the vendor about goods that did not come on the promised day, or order them elsewhere.'), who: msg('The buyer of that order, else the purchasing manager'), days: { label: msg('days late'), def: 1 } },
  { key: 'store_check', title: msg('Daily checks not done'), what: msg('Fill in a check list of the shop (opening, hygiene, temperatures…) an hour after its time.'), who: msg('The store manager') },
  { key: 'low_stock', title: msg('Low stock'), what: msg('Order goods that fell under their minimum.'), who: msg('The purchasing or stock manager') },
  { key: 'lot_expiry', title: msg('Lots about to expire'), what: msg('Lower the price or take off the shelf goods that expire soon.'), who: msg('The stock manager or the warehouse'), days: { label: msg('days before'), def: 14 } },
  { key: 'contract_end', title: msg('Contracts ending'), what: msg('Extend or close a fixed-term contract.'), who: msg('The HR manager'), days: { label: msg('days before'), def: 30 } },
  { key: 'tax_deadline', title: msg('Tax deadlines'), what: msg('Prepare the VAT return or the payroll declaration.'), who: msg('The accountant'), days: { label: msg('days before'), def: 5 } },
  { key: 'new_lead', title: msg('New contacts'), what: msg('Contact someone who came in as a lead a day ago and is still new.'), who: msg('The owner of the lead, else the sales manager') },
]
function Automations() {
  const s = useTaskSettings()
  const save = useSaveTaskSettings()
  const run = useRunAutomations()
  const { can } = useCompany()
  const a = s.data?.task_automations ?? {}
  const set = (k: string, v: { on?: boolean; days?: number }) => save.mutate({ task_automations: { ...a, [k]: { ...a[k], ...v } } })
  const admin = can('admin.write')
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-2 space-y-0 py-3">
          <div><CardTitle className="flex items-center gap-2"><Sparkles className="size-4 text-primary" /> {t('Tasks the program makes')}</CardTitle>
            <CardDescription>{t('Checked every hour. One task per thing: no second task while the first one is still open. All are off until you switch them on.')}</CardDescription></div>
          {admin && <Button size="sm" variant="outline" loading={run.isPending} onClick={async () => { const n = await run.mutateAsync(); toast.success(n ? t('{n} tasks made', { n }) : t('Nothing new to do')) }}><Play /> {t('Check now')}</Button>}
        </CardHeader>
        <CardContent className="grid gap-2 pb-4">
          {AUTOS.map((x) => (
            <div key={x.key} className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5">
              <Switch checked={!!a[x.key]?.on} disabled={!admin} aria-label={t(x.title)} onCheckedChange={(on) => set(x.key, { on })} />
              <div className="min-w-0 flex-1"><div className="text-[13px] font-medium">{t(x.title)}{a[x.key]?.on && <Badge variant="success" className="ml-2">{t('On')}</Badge>}</div>
                <div className="text-xs text-muted-foreground">{t(x.what)} {t('For: {who}.', { who: t(x.who) })}</div></div>
              {x.days && <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Input type="number" min={0} max={365} disabled={!admin} className="h-8 w-20 text-right tabular" defaultValue={a[x.key]?.days ?? x.days.def}
                  onBlur={(e) => { const d = Math.max(0, Math.min(365, num(e.target.value))); if (d !== (a[x.key]?.days ?? x.days!.def)) set(x.key, { days: d }) }} />{t(x.days.label)}</label>}
            </div>))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="py-3"><CardTitle>{t('Reminders')}</CardTitle>
          <CardDescription>{t('At 7 in the morning everyone hears about the tasks due today and tomorrow, in the program and on the phone. By email too, if you switch it on below.')}</CardDescription></CardHeader>
        <CardContent className="flex items-center gap-3 pb-4">
          <Switch id="tk-digest" checked={!!s.data?.task_digest_email} disabled={!admin} onCheckedChange={(v) => save.mutate({ task_digest_email: v })} />
          <Label htmlFor="tk-digest" className="font-normal">{t('Every morning, an email to each person with their tasks for today and the late ones')}</Label>
        </CardContent>
      </Card>
    </div>
  )
}
