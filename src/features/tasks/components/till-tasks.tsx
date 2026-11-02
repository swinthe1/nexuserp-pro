import { ListTodo } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'
import { usePeople, useTaskCounts, useTasks, useUpdateTask } from '../api'
import { DueChip, isOpen, PriorityFlag } from './task-bits'
import { QuickAdd } from './quick-add'

/** at the till: the cashier's own tasks, ticked off without leaving the sale */
export function TillTasks() {
  const counts = useTaskCounts()
  const tasks = useTasks()
  const people = usePeople()
  const update = useUpdateTask()
  const [open, setOpen] = React.useState(false)
  const me = people.data?.find((p) => p.is_me)?.user_id
  const n = counts.data?.open_mine ?? 0
  const late = counts.data?.overdue_mine ?? 0
  const mine = (tasks.data ?? []).filter((x) => x.assignee_id === me && isOpen(x)).sort((a, b) => (a.due_date ?? '9').localeCompare(b.due_date ?? '9') || b.priority - a.priority)
  if (!n) return null
  return (
    <>
      <Button variant="ghost" size="sm" className={cn('shrink-0 gap-1.5', late && 'text-destructive')} onClick={() => setOpen(true)} aria-label={t('My tasks')}>
        <ListTodo /><span className="tabular">{n}</span></Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader><SheetTitle>{t('My tasks')}</SheetTitle><SheetDescription>{t('Tick what you finished; the person who gave it hears at once.')}</SheetDescription></SheetHeader>
          <div className="grid gap-3 px-4 pb-6 pt-3">
            <ul className="grid gap-1">
              {mine.map((x) => (
                <li key={x.id} className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
                  <input type="checkbox" className="size-5 shrink-0" aria-label={x.title} onChange={(e) => update.mutate({ id: x.id, status: e.target.checked ? 'done' : 'todo' })} />
                  <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[14px]"><PriorityFlag p={x.priority} /><span className="truncate">{x.title}</span></span>
                  <DueChip task={x} />
                </li>))}
            </ul>
            <QuickAdd placeholder={t('Something to remember… e.g. Ask for change tomorrow')} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
