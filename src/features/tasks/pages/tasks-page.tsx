import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Columns3, List as ListIcon, ListChecks, Search, Settings2, Users } from 'lucide-react'
import { PageTableExport } from '@/components/page-table-export'
import * as React from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/app/auth-provider'
import { useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useRealtimeInvalidate } from '@/hooks/use-realtime'
import { t } from '@/i18n'
import { cn, formatMonth } from '@/lib/utils'
import { useChecklistCounts, usePeople, useTaskLists, useTasks, useUpdateTask, type Person, type Task } from '../api'
import { ListsDialog } from '../components/lists-dialog'
import { QuickAdd } from '../components/quick-add'
import { addDaysISO, Avatar, DueChip, isLate, isOpen, PriorityFlag, SourceMark, STATUS_DOT, STATUS_LABEL, todayISO } from '../components/task-bits'
import { TaskSheet } from '../components/task-sheet'

type View = 'list' | 'board' | 'calendar' | 'team'

export function TasksPage() {
  const [params, setParams] = useSearchParams()
  const { companyId, can } = useCompany()
  const { user } = useAuth()
  const tasks = useTasks()
  const people = usePeople()
  const lists = useTaskLists()
  const checks = useChecklistCounts()
  useRealtimeInvalidate('tasks', companyId, [['tasks', companyId]])
  useRealtimeInvalidate('task_comments', companyId, [['tasks', companyId, 'comments']])
  const view = (params.get('view') as View) ?? 'list'
  const scope = params.get('scope') ?? 'mine'
  const openId = params.get('id')
  const [q, setQ] = React.useState('')
  const [listsOpen, setListsOpen] = React.useState(false)
  const set = (k: string, v: string | null) => setParams((p) => { if (v == null) p.delete(k); else p.set(k, v); return p }, { replace: k !== 'id' })
  const me = user?.id ?? ''
  const pmap = React.useMemo(() => new Map((people.data ?? []).map((p) => [p.user_id, p])), [people.data])
  const manager = can('tasks.write') || can('tasks.read')
  const term = q.trim().toLowerCase()
  const rows = (tasks.data ?? []).filter((x) => !x.parent_id || scope !== 'mine' || x.assignee_id === me).filter((x) => {
    if (scope === 'mine' && x.assignee_id !== me) return false
    if (scope === 'given' && !(x.created_by === me && x.assignee_id !== me)) return false
    if (scope.startsWith('list:') && x.list_id !== scope.slice(5)) return false
    if (scope.startsWith('person:') && x.assignee_id !== scope.slice(7)) return false
    if (term && !(`${x.title} ${x.number ?? ''} ${x.entity_label ?? ''} ${(x.tags ?? []).join(' ')}`.toLowerCase().includes(term))) return false
    return true
  })
  const listName = (id: string | null) => (lists.data ?? []).find((l) => l.id === id)?.name
  const defaults: Partial<Task> = scope.startsWith('list:') ? { list_id: scope.slice(5) } : scope.startsWith('person:') ? { assignee_id: scope.slice(7) } : {}
  return (
    <>
      <PageHeader title={t('Tasks|menu')} description={t('What needs doing, by whom and by when. Tasks also come from the program itself: late invoices, till differences, contracts ending.')}
        actions={<><PageTableExport />{<>
          <Button variant="outline" onClick={() => setListsOpen(true)}><ListChecks /> {t('Lists')}</Button>
          {(can('tasks.write') || can('admin.write')) && <Button variant="outline" asChild><Link to="/tasks/setup"><Settings2 /> {t('Repeating and automatic')}</Link></Button>}
        </>}</>} />

      <QuickAdd className="mb-4" defaults={defaults} onCreated={(x) => { if (view === 'list' && x.assignee_id !== me && scope === 'mine') set('id', x.id) }} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border bg-card p-0.5" role="tablist" aria-label={t('View')}>
          {([['list', ListIcon, t('List')], ['board', Columns3, t('Board')], ['calendar', CalendarDays, t('Calendar')], ...(manager ? [['team', Users, t('Team')]] : [])] as [View, typeof ListIcon, string][]).map(([k, Icon, label]) => (
            <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => set('view', k === 'list' ? null : k)}
              className={cn('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors', view === k && 'bg-primary/10 text-primary')}>
              <Icon className="size-4" />{label}</button>))}
        </div>
        <Select value={scope} onValueChange={(v) => set('scope', v === 'mine' ? null : v)}>
          <SelectTrigger className="h-9 w-auto min-w-44" aria-label={t('Whose tasks')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="mine">{t('My tasks')}</SelectItem>
            <SelectItem value="given">{t('Tasks I gave')}</SelectItem>
            <SelectItem value="all">{t('All I can see')}</SelectItem>
            {!!lists.data?.length && <SelectGroup><SelectLabel>{t('Lists')}</SelectLabel>{lists.data.map((l) => <SelectItem key={l.id} value={`list:${l.id}`}>{l.name}</SelectItem>)}</SelectGroup>}
            {manager && <SelectGroup><SelectLabel>{t('People')}</SelectLabel>{(people.data ?? []).filter((p) => !p.is_me).map((p) => <SelectItem key={p.user_id} value={`person:${p.user_id}`}>{p.name}</SelectItem>)}</SelectGroup>}
          </SelectContent>
        </Select>
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search tasks…')} className="h-9 pl-8" aria-label={t('Search tasks…')} />
        </div>
      </div>

      {tasks.isLoading ? <Skeleton className="h-80" /> : tasks.isError ? <ErrorState error={tasks.error} onRetry={() => void tasks.refetch()} />
        : view === 'board' ? <Board rows={rows} pmap={pmap} checks={checks.data} onOpen={(id) => set('id', id)} listName={listName} />
        : view === 'calendar' ? <Calendar rows={rows} pmap={pmap} onOpen={(id) => set('id', id)} />
        : view === 'team' ? <Team rows={tasks.data ?? []} people={people.data ?? []} onPick={(p) => setParams((x) => { x.set('scope', `person:${p}`); x.delete('view'); return x })} />
        : <Grouped rows={rows} pmap={pmap} checks={checks.data} onOpen={(id) => set('id', id)} listName={listName} showPerson={scope !== 'mine'} />}

      <TaskSheet id={openId} onClose={() => set('id', null)} onOpen={(id) => set('id', id)} />
      {listsOpen && <ListsDialog onClose={() => setListsOpen(false)} />}
    </>
  )
}

/* ------------------------------------------------------------------ one row */
function Row({ task, pmap, checks, onOpen, listName, showPerson }: {
  task: Task; pmap: Map<string, Person>; checks?: Map<string, { done: number; total: number }>; onOpen: (id: string) => void; listName: (id: string | null) => string | undefined; showPerson: boolean
}) {
  const update = useUpdateTask()
  const c = checks?.get(task.id)
  const done = task.status === 'done'
  return (
    <li className="group flex items-center gap-3 border-b px-3 py-2.5 last:border-b-0 hover:bg-muted/40">
      <input type="checkbox" className="size-[18px] shrink-0 cursor-pointer rounded-full accent-[hsl(var(--success))]" checked={done} aria-label={t('Done|task')}
        onChange={(e) => update.mutate({ id: task.id, status: e.target.checked ? 'done' : 'todo' })} />
      <button type="button" className="flex min-w-0 flex-1 flex-col items-start text-left" onClick={() => onOpen(task.id)}>
        <span className="flex w-full min-w-0 items-center gap-1.5">
          <PriorityFlag p={task.priority} /><SourceMark task={task} />
          <span className={cn('truncate text-[14px]', done && 'text-muted-foreground line-through')}>{task.title}</span>
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {task.status !== 'todo' && !done && <span className="inline-flex items-center gap-1"><span className={cn('size-1.5 rounded-full', STATUS_DOT[task.status])} />{t(STATUS_LABEL[task.status]!)}</span>}
          {c && <span className="tabular">☑ {c.done}/{c.total}</span>}
          {task.entity_label && <span className="truncate">{task.entity_label}</span>}
          {task.list_id && <span>{listName(task.list_id)}</span>}
          {(task.tags ?? []).map((x) => <span key={x}>#{x}</span>)}
        </span>
      </button>
      <DueChip task={task} className="hidden sm:inline-flex" />
      {showPerson && <Avatar person={pmap.get(task.assignee_id ?? '')} />}
    </li>
  )
}

/* ------------------------------------------------------------------ list, grouped by when */
function Grouped({ rows, ...rest }: { rows: Task[]; pmap: Map<string, Person>; checks?: Map<string, { done: number; total: number }>; onOpen: (id: string) => void; listName: (id: string | null) => string | undefined; showPerson: boolean }) {
  const today = todayISO(), tomorrow = addDaysISO(today, 1), week = addDaysISO(today, 7)
  const open = rows.filter(isOpen)
  const groups: [string, string, Task[], boolean][] = [
    ['late', t('Late'), open.filter(isLate), false],
    ['today', t('Today'), open.filter((x) => x.due_date === today), false],
    ['tomorrow', t('Tomorrow'), open.filter((x) => x.due_date === tomorrow), false],
    ['week', t('This week'), open.filter((x) => !!x.due_date && x.due_date > tomorrow && x.due_date <= week), false],
    ['later', t('Later'), open.filter((x) => !!x.due_date && x.due_date > week), false],
    ['none', t('No due date'), open.filter((x) => !x.due_date), false],
    ['done', t('Done in the last 30 days'), rows.filter((x) => x.status === 'done').sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? '')), true],
  ]
  const [closed, setClosed] = React.useState<Record<string, boolean>>({ done: true })
  if (!rows.length) return <EmptyState icon={ListChecks} title={t('Nothing to do here')} description={t('Write a task in the line above. Words like "tomorrow", "@name" and "!high" fill in the date, the person and the priority.')} />
  return (
    <div className="grid gap-4">
      {groups.filter(([, , g]) => g.length).map(([k, label, g]) => (
        <section key={k}>
          <button type="button" className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold" onClick={() => setClosed((c) => ({ ...c, [k]: !c[k] }))} aria-expanded={!closed[k]}>
            <ChevronDown className={cn('size-4 transition-transform', closed[k] && '-rotate-90')} />
            <span className={cn(k === 'late' && 'text-destructive', k === 'today' && 'text-warning')}>{label}</span><span className="font-normal text-muted-foreground">{g.length}</span>
          </button>
          {!closed[k] && <ul className="overflow-hidden rounded-xl border bg-card">{g.map((x) => <Row key={x.id} task={x} {...rest} />)}</ul>}
        </section>))}
    </div>
  )
}

/* ------------------------------------------------------------------ board: drag a card to another column */
function Board({ rows, pmap, checks, onOpen }: { rows: Task[]; pmap: Map<string, Person>; checks?: Map<string, { done: number; total: number }>; onOpen: (id: string) => void; listName: (id: string | null) => string | undefined }) {
  const update = useUpdateTask()
  const [over, setOver] = React.useState<string | null>(null)
  const cols = ['todo', 'doing', 'waiting', 'done'] as const
  return (
    <div className="grid gap-3 overflow-x-auto pb-2 md:grid-cols-4">
      {cols.map((s) => {
        const items = rows.filter((x) => x.status === s)
        return (
          <section key={s} aria-label={t(STATUS_LABEL[s]!)} className={cn('flex min-h-48 flex-col rounded-xl border bg-muted/30 p-2 transition-colors', over === s && 'border-primary bg-primary/5')}
            onDragOver={(e) => { e.preventDefault(); setOver(s) }} onDragLeave={() => setOver(null)}
            onDrop={(e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData('text/task'); if (id) update.mutate({ id, status: s }) }}>
            <h3 className="flex items-center gap-2 px-1.5 pb-2 pt-1 text-[13px] font-semibold"><span className={cn('size-2 rounded-full', STATUS_DOT[s])} />{t(STATUS_LABEL[s]!)}<span className="font-normal text-muted-foreground">{items.length}</span></h3>
            <div className="grid content-start gap-2">
              {items.map((x) => {
                const c = checks?.get(x.id)
                return (
                  <button key={x.id} type="button" draggable onDragStart={(e) => e.dataTransfer.setData('text/task', x.id)} onClick={() => onOpen(x.id)}
                    className={cn('grid gap-1.5 rounded-lg border bg-card p-2.5 text-left shadow-sm transition-shadow hover:shadow-md', isLate(x) && 'border-l-2 border-l-destructive')}>
                    <span className="flex items-start gap-1.5"><PriorityFlag p={x.priority} className="mt-0.5" /><SourceMark task={x} />
                      <span className={cn('text-[13px] leading-snug', x.status === 'done' && 'text-muted-foreground line-through')}>{x.title}</span></span>
                    {x.entity_label && <span className="truncate text-xs text-muted-foreground">{x.entity_label}</span>}
                    <span className="flex items-center justify-between gap-2"><span className="flex items-center gap-2"><DueChip task={x} />{c && <span className="text-xs tabular text-muted-foreground">☑ {c.done}/{c.total}</span>}</span>
                      <Avatar person={pmap.get(x.assignee_id ?? '')} size={20} /></span>
                  </button>)
              })}
            </div>
          </section>)
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ calendar: a month, drag a task to another day */
function Calendar({ rows, pmap, onOpen }: { rows: Task[]; pmap: Map<string, Person>; onOpen: (id: string) => void }) {
  const update = useUpdateTask()
  const today = todayISO()
  const [month, setMonth] = React.useState(today.slice(0, 7))
  const [y, m] = month.split('-').map(Number) as [number, number]
  const first = new Date(y, m - 1, 1)
  const lead = (first.getDay() + 6) % 7
  const start = addDaysISO(`${month}-01`, -lead)
  const days = Array.from({ length: 42 }, (_, i) => addDaysISO(start, i))
  const byDay = new Map<string, Task[]>()
  for (const x of rows) if (x.due_date) byDay.set(x.due_date, [...(byDay.get(x.due_date) ?? []), x])
  const shift = (n: number) => { const d = new Date(y, m - 1 + n, 1); setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`) }
  const names = [t('Mon'), t('Tue'), t('Wed'), t('Thu'), t('Fri'), t('Sat'), t('Sun')]
  const [over, setOver] = React.useState<string | null>(null)
  return (
    <div className="overflow-x-auto">
      <div className="mb-2 flex items-center gap-2">
        <Button size="icon-sm" variant="outline" onClick={() => shift(-1)} aria-label={t('Previous month')}><ChevronLeft /></Button>
        <Button size="icon-sm" variant="outline" onClick={() => shift(1)} aria-label={t('Next month')}><ChevronRight /></Button>
        <h3 className="text-[15px] font-semibold capitalize">{formatMonth(`${month}-01T00:00:00`)}</h3>
        <Button size="sm" variant="ghost" onClick={() => setMonth(today.slice(0, 7))}>{t('Today')}</Button>
      </div>
      <div className="grid min-w-[720px] grid-cols-7 overflow-hidden rounded-xl border bg-card">
        {names.map((n) => <div key={n} className="border-b bg-muted/40 px-2 py-1.5 text-xs font-medium text-muted-foreground">{n}</div>)}
        {days.map((d) => {
          const items = byDay.get(d) ?? []
          const other = d.slice(0, 7) !== month
          return (
            <div key={d} className={cn('min-h-28 border-b border-r p-1.5 [&:nth-child(7n)]:border-r-0', other && 'bg-muted/20', over === d && 'bg-primary/5')}
              onDragOver={(e) => { e.preventDefault(); setOver(d) }} onDragLeave={() => setOver(null)}
              onDrop={(e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData('text/task'); if (id) update.mutate({ id, due_date: d }) }}>
              <div className={cn('mb-1 inline-grid size-6 place-items-center rounded-full text-xs tabular', d === today ? 'bg-primary font-semibold text-primary-foreground' : other ? 'text-muted-foreground/60' : 'text-muted-foreground')}>{Number(d.slice(8))}</div>
              <div className="grid gap-1">
                {items.slice(0, 4).map((x) => (
                  <button key={x.id} type="button" draggable onDragStart={(e) => e.dataTransfer.setData('text/task', x.id)} onClick={() => onOpen(x.id)}
                    className={cn('flex items-center gap-1 truncate rounded-md px-1.5 py-1 text-left text-xs', x.status === 'done' ? 'bg-muted text-muted-foreground line-through' : isLate(x) ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-foreground')}>
                    <Avatar person={pmap.get(x.assignee_id ?? '')} size={14} /><span className="truncate">{x.title}</span></button>))}
                {items.length > 4 && <span className="px-1.5 text-xs text-muted-foreground">{t('+{n} more', { n: items.length - 4 })}</span>}
              </div>
            </div>)
        })}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ team: who has how much, who is late */
function Team({ rows, people, onPick }: { rows: Task[]; people: Person[]; onPick: (user: string) => void }) {
  const today = todayISO(), week = addDaysISO(today, 7), weekAgo = new Date(Date.now() - 7 * 864e5).toISOString()
  const stats = people.map((p) => {
    const mine = rows.filter((x) => x.assignee_id === p.user_id)
    const open = mine.filter(isOpen)
    return { p, open: open.length, late: open.filter(isLate).length, today: open.filter((x) => x.due_date === today).length,
      week: open.filter((x) => !!x.due_date && x.due_date > today && x.due_date <= week).length, done: mine.filter((x) => x.status === 'done' && (x.completed_at ?? '') >= weekAgo).length }
  }).filter((s) => s.open || s.done).sort((a, b) => b.late - a.late || b.open - a.open)
  const max = Math.max(1, ...stats.map((s) => s.open))
  if (!stats.length) return <EmptyState icon={Users} title={t('No open tasks in the team')} />
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Person|task')}</TableHead><TableHead className="w-[30%]">{t('Open|tasks')}</TableHead>
          <TableHead className="text-right">{t('Late')}</TableHead><TableHead className="text-right">{t('Today')}</TableHead><TableHead className="text-right">{t('This week')}</TableHead><TableHead className="text-right">{t('Done in 7 days')}</TableHead></TableRow></TableHeader>
        <TableBody>{stats.map((s) => (
          <TableRow key={s.p.user_id} className="cursor-pointer" onClick={() => onPick(s.p.user_id)}>
            <TableCell><span className="flex items-center gap-2"><Avatar person={s.p} />{s.p.name}</span></TableCell>
            <TableCell><span className="flex items-center gap-2"><span className="h-2 rounded-full bg-primary/70" style={{ width: `${(s.open / max) * 100}%`, minWidth: s.open ? 6 : 0 }} /><span className="tabular text-[13px]">{s.open}</span></span></TableCell>
            <TableCell className={cn('text-right tabular', s.late && 'font-semibold text-destructive')}>{s.late}</TableCell>
            <TableCell className="text-right tabular">{s.today}</TableCell><TableCell className="text-right tabular">{s.week}</TableCell>
            <TableCell className="text-right tabular text-success">{s.done}</TableCell>
          </TableRow>))}</TableBody>
      </Table>
    </div>
  )
}
