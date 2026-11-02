import { ListChecks } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'
import { useLinkedTasks, usePeople, useTaskCounts, useTasks } from '../api'
import { Avatar, DueChip, isLate, isOpen, PriorityFlag, todayISO } from './task-bits'
import { QuickAdd } from './quick-add'

/** the tasks of one document, and a line to add one (it is tied to this document) */
export function LinkedTasks({ entityType, entityId, label, className }: { entityType: string; entityId: string | undefined; label: string | null; className?: string }) {
  const rows = useLinkedTasks(entityType, entityId)
  const people = usePeople()
  const pmap = new Map((people.data ?? []).map((p) => [p.user_id, p]))
  if (!entityId) return null
  const open = (rows.data ?? []).filter(isOpen)
  return (
    <Card className={className}>
      <CardHeader className="py-3"><CardTitle className="flex items-center gap-2"><ListChecks className="size-4 text-primary" /> {t('Tasks|menu')}</CardTitle>
        <CardDescription>{open.length ? t('{n} open|tasks', { n: open.length }) : t('Something to do about this? Write it here and give it to someone.')}</CardDescription></CardHeader>
      <CardContent className="grid gap-2 pb-4">
        {(rows.data ?? []).slice(0, 8).map((x) => (
          <Link key={x.id} to={`/tasks?id=${x.id}&scope=all`} className="flex items-center gap-2 rounded-md px-1 py-1 text-[13px] hover:bg-muted">
            <PriorityFlag p={x.priority} />
            <span className={cn('min-w-0 flex-1 truncate', !isOpen(x) && 'text-muted-foreground line-through')}>{x.title}</span>
            <DueChip task={x} /><Avatar person={pmap.get(x.assignee_id ?? '')} size={20} />
          </Link>))}
        <QuickAdd defaults={{ entity_type: entityType, entity_id: entityId, entity_label: label }} placeholder={t('A task about this… e.g. Call on Friday @Ilir')} />
      </CardContent>
    </Card>
  )
}

/** the dashboard card: my tasks for today and the late ones */
export function MyTasksCard() {
  const counts = useTaskCounts()
  const tasks = useTasks()
  const people = usePeople()
  const me = people.data?.find((p) => p.is_me)?.user_id
  const today = todayISO()
  const mine = (tasks.data ?? []).filter((x) => x.assignee_id === me && isOpen(x) && !!x.due_date && x.due_date <= today)
    .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? '') || b.priority - a.priority)
  const c = counts.data
  if (!c || (!c.open_mine && !c.overdue_team)) return null
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0 pb-2">
        <div><CardTitle className="flex items-center gap-2"><ListChecks className="size-4 text-primary" /> {t('My tasks today')}</CardTitle>
          <CardDescription>{t('{today} for today · {late} late · {open} open in all', { today: c.today_mine, late: c.overdue_mine, open: c.open_mine })}</CardDescription></div>
        <Link to="/tasks" className="text-[13px] font-medium text-primary hover:underline">{t('All tasks')}</Link>
      </CardHeader>
      <CardContent className="grid gap-1 pb-4">
        {mine.slice(0, 6).map((x) => (
          <Link key={x.id} to={`/tasks?id=${x.id}`} className="flex items-center gap-2 rounded-md px-1 py-1.5 text-[13px] hover:bg-muted">
            <PriorityFlag p={x.priority} /><span className={cn('min-w-0 flex-1 truncate', isLate(x) && 'text-destructive')}>{x.title}</span><DueChip task={x} />
          </Link>))}
        {!mine.length && <p className="text-[13px] text-muted-foreground">{t('Nothing due today.')}</p>}
        {c.overdue_team > 0 && <Link to="/tasks?view=team" className="mt-1 text-xs text-warning hover:underline">{t('{n} late tasks in the team', { n: c.overdue_team })}</Link>}
      </CardContent>
    </Card>
  )
}
