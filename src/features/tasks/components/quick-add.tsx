import { CalendarClock, Flag, Lock, Plus, Tag, UserRound } from 'lucide-react'
import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { t } from '@/i18n'
import { cn, formatDate } from '@/lib/utils'
import { useCreateTask, usePeople, type Task } from '../api'
import { parseQuick } from '../quick'
import { PRIORITY_LABEL } from './task-bits'

/** one line, Enter: the task is made. Words like "nesër", "@Ilir", "!lartë" fill in the rest */
export const QuickAdd = React.forwardRef<HTMLInputElement, {
  defaults?: Partial<Task>; onCreated?: (t: Task) => void; className?: string; placeholder?: string
}>(function QuickAdd({ defaults, onCreated, className, placeholder }, ref) {
  const people = usePeople()
  const create = useCreateTask()
  const [line, setLine] = React.useState('')
  const [priv, setPriv] = React.useState(false)
  const p = React.useMemo(() => parseQuick(line, people.data ?? []), [line, people.data])
  const me = people.data?.find((x) => x.is_me)
  const who = people.data?.find((x) => x.user_id === p.assignee_id)
  const submit = async () => {
    if (!p.title) return
    const task = await create.mutateAsync({
      ...defaults, title: p.title, due_date: p.due_date ?? defaults?.due_date ?? null, priority: p.priority ?? defaults?.priority ?? 1,
      assignee_id: priv ? me?.user_id ?? null : p.assignee_id ?? defaults?.assignee_id ?? me?.user_id ?? null, tags: p.tags, is_private: priv,
    })
    setLine(''); onCreated?.(task)
  }
  return (
    <div className={cn('grid gap-1.5', className)}>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <div className="relative flex-1">
          <Plus className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input ref={ref} value={line} onChange={(e) => setLine(e.target.value)} className="h-10 pl-9" aria-label={t('New task')}
            placeholder={placeholder ?? t('New task… e.g. Order coffee tomorrow @Ilir !high')} />
        </div>
        <Button type="button" variant={priv ? 'secondary' : 'ghost'} size="icon" className="h-10 w-10" aria-pressed={priv} aria-label={t('Private: only I see it')} title={t('Private: only I see it')}
          onClick={() => setPriv(!priv)}><Lock className={cn(priv && 'text-primary')} /></Button>
        <Button type="submit" className="h-10" loading={create.isPending} disabled={!p.title}>{t('Add')}</Button>
      </form>
      {line.trim() && (p.due_date || who || p.priority != null || p.tags.length > 0 || priv || p.unknown) && (
        <div className="flex flex-wrap gap-1.5 text-xs">
          {p.due_date && <Badge variant="secondary" className="gap-1"><CalendarClock className="size-3" />{formatDate(p.due_date)}</Badge>}
          {who && !priv && <Badge variant="secondary" className="gap-1"><UserRound className="size-3" />{who.name}</Badge>}
          {p.priority != null && <Badge variant="secondary" className="gap-1"><Flag className="size-3" />{t(PRIORITY_LABEL[p.priority]!)}</Badge>}
          {p.tags.map((x) => <Badge key={x} variant="secondary" className="gap-1"><Tag className="size-3" />{x}</Badge>)}
          {priv && <Badge variant="secondary" className="gap-1"><Lock className="size-3" />{t('Private')}</Badge>}
          {p.unknown && !who && <Badge variant="warning" className="gap-1"><UserRound className="size-3" />{t('Nobody you can give tasks to is called {name}', { name: p.unknown })}</Badge>}
        </div>
      )}
    </div>
  )
})
