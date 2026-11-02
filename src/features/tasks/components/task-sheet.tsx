import { Bell, BellOff, Camera, CheckSquare, ExternalLink, Image as ImageIcon, Paperclip, Plus, Send, Trash2, X } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '@/app/auth-provider'
import { useCompany } from '@/app/company-provider'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { t } from '@/i18n'
import { cn, formatDate } from '@/lib/utils'
import {
  fileUrl, useAddCheck, useAddComment, useChecklist, useCreateTask, useDeleteCheck, useDeleteTask, usePeople, useSubtasks, useTask, useTaskComments,
  useTaskLists, useToggleCheck, useUpdateTask, useWatch, useWatchers, type Person, type TaskComment, type TaskFile,
} from '../api'
import { Avatar, DueChip, ENTITY_LABEL, entityHref, PRIORITY_LABEL, SourceMark, STATUS_DOT, STATUS_LABEL } from './task-bits'

export function TaskSheet({ id, onClose, onOpen }: { id: string | null; onClose: () => void; onOpen: (id: string) => void }) {
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto p-0 sm:max-w-xl">
        {id && <TaskBody key={id} id={id} onClose={onClose} onOpen={onOpen} />}
      </SheetContent>
    </Sheet>
  )
}

function TaskBody({ id, onClose, onOpen }: { id: string; onClose: () => void; onOpen: (id: string) => void }) {
  const q = useTask(id)
  const people = usePeople()
  const lists = useTaskLists()
  const update = useUpdateTask()
  const del = useDeleteTask()
  const { user } = useAuth()
  const { can } = useCompany()
  const task = q.data
  const [title, setTitle] = React.useState('')
  const [desc, setDesc] = React.useState('')
  React.useEffect(() => { if (task) { setTitle(task.title); setDesc(task.description ?? '') } }, [task?.id, task?.title, task?.description]) // eslint-disable-line react-hooks/exhaustive-deps
  if (q.isLoading) return <div className="grid gap-3 p-6"><Skeleton className="h-8 w-2/3" /><Skeleton className="h-40" /></div>
  if (!task) return <div className="p-6 text-[13px] text-muted-foreground">{t('This task is not there any more, or you cannot see it.')}</div>
  const pmap = new Map((people.data ?? []).map((p) => [p.user_id, p]))
  const mine = task.assignee_id === user?.id || task.created_by === user?.id
  const canEdit = mine || can('tasks.write')
  const canDelete = task.created_by === user?.id || can('tasks.write')
  const save = (v: Parameters<typeof update.mutate>[0]) => update.mutate(v)
  const href = entityHref(task.entity_type, task.entity_id, task.entity_label)
  return (
    <>
      <SheetHeader className="border-b px-5 py-4 text-left">
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="tabular">{task.number}</span><SourceMark task={task} />
          {task.is_private && <Badge variant="secondary">{t('Private')}</Badge>}</div>
        <SheetTitle className="sr-only">{task.title}</SheetTitle>
        <SheetDescription className="sr-only">{t('Task details')}</SheetDescription>
        <Textarea value={title} rows={1} disabled={!canEdit} aria-label={t('Title')}
          className="min-h-0 resize-none border-0 bg-transparent px-0 py-0 text-lg font-semibold leading-snug shadow-none focus-visible:ring-0"
          onChange={(e) => setTitle(e.target.value.replace(/\n/g, ' '))} onBlur={() => { if (title.trim() && title.trim() !== task.title) save({ id: task.id, title: title.trim() }) }} />
      </SheetHeader>

      <div className="grid gap-5 px-5 py-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('Status')}>
            <Select value={task.status} disabled={!canEdit} onValueChange={(v) => save({ id: task.id, status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{['todo', 'doing', 'waiting', 'done', 'cancelled'].map((s) => <SelectItem key={s} value={s}><span className="flex items-center gap-2"><span className={cn('size-2 rounded-full', STATUS_DOT[s])} />{t(STATUS_LABEL[s]!)}</span></SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label={t('Person|task')}>
            <PersonSelect people={people.data ?? []} value={task.assignee_id} disabled={!canEdit || task.is_private} onChange={(v) => save({ id: task.id, assignee_id: v })} />
          </Field>
          <Field label={t('Due')}>
            <Input type="date" value={task.due_date ?? ''} disabled={!canEdit} onChange={(e) => save({ id: task.id, due_date: e.target.value || null, ...(e.target.value ? {} : { due_time: null }) })} />
          </Field>
          <Field label={t('Priority')}>
            <Select value={String(task.priority)} disabled={!canEdit} onValueChange={(v) => save({ id: task.id, priority: Number(v) })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{[3, 2, 1, 0].map((p) => <SelectItem key={p} value={String(p)}>{t(PRIORITY_LABEL[p]!)}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label={t('List')}>
            <Select value={task.list_id ?? 'none'} disabled={!canEdit} onValueChange={(v) => save({ id: task.id, list_id: v === 'none' ? null : v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="none">{t('No list')}</SelectItem>{(lists.data ?? []).map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label={t('Time|clock')}>
            <Input type="time" value={task.due_time?.slice(0, 5) ?? ''} disabled={!canEdit || !task.due_date} onChange={(e) => save({ id: task.id, due_time: e.target.value || null })} />
          </Field>
        </div>

        {(task.entity_type || task.entity_label) && (
          <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-[13px]">
            <span><span className="text-muted-foreground">{t(ENTITY_LABEL[task.entity_type ?? ''] ?? 'Document')}: </span><span className="font-medium">{task.entity_label ?? '—'}</span></span>
            {href && <Button size="sm" variant="ghost" asChild><Link to={href} onClick={onClose}><ExternalLink /> {t('Open')}</Link></Button>}
          </div>
        )}

        <Field label={t('Description')}>
          <Textarea value={desc} rows={3} disabled={!canEdit} placeholder={t('What exactly needs doing, and how you know it is done.')}
            onChange={(e) => setDesc(e.target.value)} onBlur={() => { if (desc !== (task.description ?? '')) save({ id: task.id, description: desc.trim() || null }) }} />
        </Field>

        <Checklist taskId={task.id} canEdit={canEdit} />
        {!task.parent_id && <Subtasks parent={task} people={people.data ?? []} canEdit={canEdit} onOpen={onOpen} />}
        <Activity taskId={task.id} people={pmap} watcher={user?.id ?? ''} />

        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
          <span>{t('Made by {name} on {date}', { name: pmap.get(task.created_by ?? '')?.name ?? t('the program'), date: formatDate(task.created_at) })}
            {task.completed_at && <> · {t('Done on {date}', { date: formatDate(task.completed_at) })}</>}</span>
          {canDelete && <ConfirmDialog trigger={<Button size="sm" variant="ghost" className="text-destructive"><Trash2 /> {t('Delete')}</Button>}
            title={t('Delete this task?')} description={t('It disappears from every list. Its history stays for the administrator.')} confirmLabel={t('Delete')} destructive
            onConfirm={async () => { await del.mutateAsync(task.id); onClose() }} />}
        </div>
      </div>
    </>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="grid gap-1.5"><Label className="text-xs text-muted-foreground">{label}</Label>{children}</div>
}

export function PersonSelect({ people, value, onChange, disabled }: { people: Person[]; value: string | null; onChange: (v: string | null) => void; disabled?: boolean }) {
  return (
    <Select value={value ?? 'none'} disabled={disabled} onValueChange={(v) => onChange(v === 'none' ? null : v)}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="none">{t('Nobody yet')}</SelectItem>
        {people.map((p) => <SelectItem key={p.user_id} value={p.user_id} disabled={!p.assignable && p.user_id !== value}>
          <span className="flex items-center gap-2"><Avatar person={p} size={18} />{p.name}{p.is_me && <span className="text-muted-foreground">({t('me')})</span>}</span></SelectItem>)}
      </SelectContent>
    </Select>
  )
}

/* ------------------------------------------------------------------ the checklist */
function Checklist({ taskId, canEdit }: { taskId: string; canEdit: boolean }) {
  const items = useChecklist(taskId)
  const add = useAddCheck()
  const toggle = useToggleCheck()
  const remove = useDeleteCheck()
  const [text, setText] = React.useState('')
  const rows = items.data ?? []
  const done = rows.filter((r) => r.done_at).length
  if (!rows.length && !canEdit) return null
  return (
    <section className="grid gap-2">
      <div className="flex items-center justify-between"><h3 className="flex items-center gap-1.5 text-[13px] font-semibold"><CheckSquare className="size-4 text-primary" /> {t('Checklist')}</h3>
        {!!rows.length && <span className="text-xs tabular text-muted-foreground">{done}/{rows.length}</span>}</div>
      {!!rows.length && <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-success transition-all" style={{ width: `${(done / rows.length) * 100}%` }} /></div>}
      <ul className="grid gap-0.5">
        {rows.map((r) => (
          <li key={r.id} className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-muted/60">
            <input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" checked={!!r.done_at} disabled={!canEdit} aria-label={r.title}
              onChange={(e) => toggle.mutate({ id: r.id, done: e.target.checked })} />
            <span className={cn('flex-1 text-[13px]', r.done_at && 'text-muted-foreground line-through')}>{r.title}</span>
            {canEdit && <button type="button" className="opacity-0 transition-opacity group-hover:opacity-100" aria-label={t('Remove')} onClick={() => remove.mutate(r.id)}><X className="size-3.5 text-muted-foreground" /></button>}
          </li>))}
      </ul>
      {canEdit && <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!text.trim()) return; add.mutate({ task_id: taskId, title: text.trim(), sort_order: rows.length }); setText('') }}>
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Add a step…')} className="h-8 text-[13px]" aria-label={t('Add a step…')} />
        <Button size="sm" variant="outline" type="submit" disabled={!text.trim()}><Plus /></Button>
      </form>}
    </section>
  )
}

/* ------------------------------------------------------------------ sub-tasks */
function Subtasks({ parent, people, canEdit, onOpen }: { parent: { id: string; assignee_id: string | null; list_id: string | null; is_private: boolean }; people: Person[]; canEdit: boolean; onOpen: (id: string) => void }) {
  const subs = useSubtasks(parent.id)
  const create = useCreateTask()
  const update = useUpdateTask()
  const [text, setText] = React.useState('')
  const pmap = new Map(people.map((p) => [p.user_id, p]))
  const rows = subs.data ?? []
  if (!rows.length && !canEdit) return null
  return (
    <section className="grid gap-2">
      <h3 className="text-[13px] font-semibold">{t('Sub-tasks')}{!!rows.length && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{rows.filter((r) => r.status === 'done').length}/{rows.length}</span>}</h3>
      <ul className="grid gap-0.5">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-muted/60">
            <input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" checked={r.status === 'done'} aria-label={r.title}
              onChange={(e) => update.mutate({ id: r.id, status: e.target.checked ? 'done' : 'todo' })} />
            <button type="button" className={cn('flex-1 truncate text-left text-[13px] hover:underline', r.status === 'done' && 'text-muted-foreground line-through')} onClick={() => onOpen(r.id)}>{r.title}</button>
            <DueChip task={r} /><Avatar person={pmap.get(r.assignee_id ?? '')} size={20} />
          </li>))}
      </ul>
      {canEdit && <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!text.trim()) return
        create.mutate({ title: text.trim(), parent_id: parent.id, assignee_id: parent.assignee_id, list_id: parent.list_id, is_private: parent.is_private }); setText('') }}>
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Add a sub-task…')} className="h-8 text-[13px]" aria-label={t('Add a sub-task…')} />
        <Button size="sm" variant="outline" type="submit" disabled={!text.trim()}><Plus /></Button>
      </form>}
    </section>
  )
}

/* ------------------------------------------------------------------ comments, photos and the history */
function eventText(c: TaskComment, people: Map<string, Person>): string | null {
  const e = (c.event ?? {}) as Record<string, unknown>
  const parts: string[] = []
  if (e.created) parts.push(e.source === 'auto' ? t('made this task from what happened in the program') : e.source === 'recurring' ? t('made this repeating task') : t('made this task'))
  const st = e.status as [string, string] | undefined
  if (st) parts.push(t('moved it from {a} to {b}', { a: t(STATUS_LABEL[st[0]] ?? st[0]), b: t(STATUS_LABEL[st[1]] ?? st[1]) }))
  const as = e.assignee as [string | null, string | null] | undefined
  if (as) parts.push(as[1] ? t('gave it to {name}', { name: people.get(as[1])?.name ?? '?' }) : t('took the person off'))
  const due = e.due as [string | null, string | null] | undefined
  if (due) parts.push(due[1] ? t('set the due date to {date}', { date: formatDate(due[1]) }) : t('took the due date off'))
  const pr = e.priority as [number, number] | undefined
  if (pr) parts.push(t('set the priority to {p}', { p: t(PRIORITY_LABEL[pr[1]] ?? '') }))
  return parts.length ? parts.join(', ') : null
}

function Activity({ taskId, people, watcher }: { taskId: string; people: Map<string, Person>; watcher: string }) {
  const rows = useTaskComments(taskId)
  const watchers = useWatchers(taskId)
  const watch = useWatch()
  const add = useAddComment()
  const [body, setBody] = React.useState('')
  const [files, setFiles] = React.useState<File[]>([])
  const fileRef = React.useRef<HTMLInputElement>(null)
  const camRef = React.useRef<HTMLInputElement>(null)
  const following = (watchers.data ?? []).includes(watcher)
  const pick = (list: FileList | null) => {
    const next = [...files, ...Array.from(list ?? [])].slice(0, 6)
    if (next.some((f) => f.size > 15 * 1024 * 1024)) { toast.error(t('The file is larger than 15 MB')); return }
    setFiles(next)
  }
  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold">{t('Comments and history')}</h3>
        <Button size="sm" variant="ghost" onClick={() => watch.mutate({ task_id: taskId, user_id: watcher, on: !following })}>
          {following ? <><BellOff /> {t('Stop following')}</> : <><Bell /> {t('Follow')}</>}</Button>
      </div>
      <ol className="grid gap-3">
        {(rows.data ?? []).map((c) => {
          const who = people.get(c.created_by ?? '')
          if (c.kind === 'event') {
            const txt = eventText(c, people)
            return txt && <li key={c.id} className="flex gap-2 text-xs text-muted-foreground"><span className="mt-1 size-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
              <span><span className="font-medium text-foreground/80">{who?.name ?? t('The program')}</span> {txt} · {formatDate(c.created_at, true)}</span></li>
          }
          return (
            <li key={c.id} className="flex gap-2.5">
              <Avatar person={who} size={26} />
              <div className="min-w-0 flex-1 rounded-lg bg-muted/50 px-3 py-2">
                <div className="mb-0.5 text-xs text-muted-foreground"><span className="font-medium text-foreground">{who?.name ?? '—'}</span> · {formatDate(c.created_at, true)}</div>
                {c.body && <p className="whitespace-pre-wrap text-[13px]">{c.body}</p>}
                {!!(c.files as TaskFile[]).length && <div className="mt-2 flex flex-wrap gap-2">{(c.files as TaskFile[]).map((f) => <FileThumb key={f.path} f={f} />)}</div>}
              </div>
            </li>)
        })}
      </ol>
      <form className="grid gap-2" onSubmit={async (e) => { e.preventDefault(); if (!body.trim() && !files.length) return
        await add.mutateAsync({ task_id: taskId, body, files }); setBody(''); setFiles([]) }}>
        <Textarea value={body} rows={2} onChange={(e) => setBody(e.target.value)} placeholder={t('Write a comment… the person on the task and the followers hear about it')} aria-label={t('Comment')} />
        {!!files.length && <div className="flex flex-wrap gap-1.5">{files.map((f, i) => <Badge key={i} variant="secondary" className="gap-1">{f.name}
          <button type="button" aria-label={t('Remove')} onClick={() => setFiles(files.filter((_, j) => j !== i))}><X className="size-3" /></button></Badge>)}</div>}
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-1">
            <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { pick(e.target.files); e.target.value = '' }} />
            <input ref={fileRef} type="file" multiple accept="image/*,application/pdf,.xlsx,.docx" className="hidden" onChange={(e) => { pick(e.target.files); e.target.value = '' }} />
            <Button type="button" size="sm" variant="ghost" onClick={() => camRef.current?.click()}><Camera /> {t('Photo')}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => fileRef.current?.click()}><Paperclip /> {t('File')}</Button>
          </div>
          <Button size="sm" type="submit" loading={add.isPending} disabled={!body.trim() && !files.length}><Send /> {t('Send|message')}</Button>
        </div>
      </form>
    </section>
  )
}

function FileThumb({ f }: { f: TaskFile }) {
  const [url, setUrl] = React.useState<string | null>(null)
  const img = (f.type ?? '').startsWith('image/')
  React.useEffect(() => { if (img) void fileUrl(f.path).then(setUrl).catch(() => undefined) }, [f.path, img])
  const open = async () => { try { window.open(url ?? await fileUrl(f.path), '_blank', 'noopener') } catch { toast.error(t('The file could not be opened')) } }
  return img
    ? <button type="button" onClick={() => void open()} className="overflow-hidden rounded-md border bg-background" aria-label={f.name}>
        {url ? <img src={url} alt={f.name} className="h-20 w-28 object-cover" /> : <span className="grid h-20 w-28 place-items-center"><ImageIcon className="size-5 text-muted-foreground" /></span>}</button>
    : <Button type="button" size="sm" variant="outline" onClick={() => void open()}><Paperclip /> {f.name}</Button>
}
