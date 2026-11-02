import { Archive, Pencil, Plus } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { useAuth } from '@/app/auth-provider'
import { useCompany } from '@/app/company-provider'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { t } from '@/i18n'
import { cn, formatDate } from '@/lib/utils'
import { useArchiveList, useListMembers, usePeople, useSaveList, useTaskLists, useTasks, type TaskList } from '../api'
import { Avatar, isOpen } from './task-bits'

const COLORS: Record<string, string> = { green: 'bg-emerald-500', blue: 'bg-sky-500', violet: 'bg-violet-500', orange: 'bg-orange-500', pink: 'bg-pink-500', teal: 'bg-teal-500', gray: 'bg-slate-400' }

export function ListsDialog({ onClose }: { onClose: () => void }) {
  const lists = useTaskLists()
  const tasks = useTasks()
  const archive = useArchiveList()
  const { user } = useAuth()
  const { can } = useCompany()
  const [edit, setEdit] = React.useState<TaskList | 'new' | null>(null)
  if (edit) return <ListForm list={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{t('Lists and projects')}</DialogTitle>
          <DialogDescription>{t('A list groups tasks and the people who work on them, e.g. "Opening the shop". A project also has dates and shows how far along it is.')}</DialogDescription></DialogHeader>
        <ul className="grid max-h-[50vh] gap-1 overflow-y-auto">
          {(lists.data ?? []).map((l) => {
            const all = (tasks.data ?? []).filter((x) => x.list_id === l.id)
            const done = all.filter((x) => !isOpen(x)).length
            const mine = l.created_by === user?.id || can('tasks.write')
            return (
              <li key={l.id} className="flex items-center gap-3 rounded-lg border px-3 py-2">
                <span className={cn('size-2.5 shrink-0 rounded-full', COLORS[l.color])} />
                <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{l.name}</span>
                  <span className="text-xs text-muted-foreground">{l.kind === 'project' ? t('Project') : t('List')}{l.is_private && ` · ${t('Private')}`}
                    {l.end_date && ` · ${t('until {date}', { date: formatDate(l.end_date) })}`} · {t('{done} of {n} done', { done, n: all.length })}</span>
                  {l.kind === 'project' && !!all.length && <span className="mt-1 block h-1 overflow-hidden rounded-full bg-muted"><span className="block h-full bg-success" style={{ width: `${(done / all.length) * 100}%` }} /></span>}</span>
                {mine && <>
                  <Button size="icon-sm" variant="ghost" aria-label={t('Edit {name}', { name: l.name })} onClick={() => setEdit(l)}><Pencil /></Button>
                  <ConfirmDialog trigger={<Button size="icon-sm" variant="ghost" aria-label={t('Archive {name}', { name: l.name })}><Archive /></Button>}
                    title={t('Archive {name}?', { name: l.name })} description={t('The list disappears from the menus. Its tasks stay.')} confirmLabel={t('Archive')} onConfirm={() => archive.mutateAsync(l.id)} />
                </>}
              </li>)
          })}
          {!lists.data?.length && <p className="py-6 text-center text-[13px] text-muted-foreground">{t('No lists yet.')}</p>}
        </ul>
        <DialogFooter><Button variant="outline" onClick={onClose}>{t('Close')}</Button><Button onClick={() => setEdit('new')}><Plus /> {t('New list')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ListForm({ list, onClose }: { list: TaskList | null; onClose: () => void }) {
  const people = usePeople()
  const current = useListMembers(list?.id ?? null)
  const save = useSaveList()
  const [v, setV] = React.useState({ name: list?.name ?? '', color: list?.color ?? 'green', kind: list?.kind ?? 'list', start_date: list?.start_date ?? '', end_date: list?.end_date ?? '', is_private: list?.is_private ?? false })
  const [members, setMembers] = React.useState<string[] | null>(null)
  React.useEffect(() => { if (current.data && members == null) setMembers(current.data) }, [current.data, members])
  const chosen = members ?? (list ? [] : [])
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{list ? t('Edit list') : t('New list')}</DialogTitle><DialogDescription>{t('The members see every task on the list, whoever it is for.')}</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label htmlFor="ls-name">{t('Name')}</Label><Input id="ls-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder={t('e.g. Opening the shop')} /></div>
          <div className="flex flex-wrap items-center gap-2"><Label className="mr-1">{t('Colour')}</Label>
            {Object.entries(COLORS).map(([k, c]) => <button key={k} type="button" aria-label={k} aria-pressed={v.color === k} onClick={() => setV({ ...v, color: k })}
              className={cn('size-6 rounded-full ring-offset-2 ring-offset-background', c, v.color === k && 'ring-2 ring-foreground')} />)}</div>
          <div className="flex items-center gap-2"><Switch id="ls-proj" checked={v.kind === 'project'} onCheckedChange={(x) => setV({ ...v, kind: x ? 'project' : 'list' })} /><Label htmlFor="ls-proj" className="font-normal">{t('A project, with start and end dates')}</Label></div>
          {v.kind === 'project' && <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label htmlFor="ls-from">{t('Starts on')}</Label><Input id="ls-from" type="date" value={v.start_date} onChange={(e) => setV({ ...v, start_date: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="ls-to">{t('Ends on')}</Label><Input id="ls-to" type="date" value={v.end_date} onChange={(e) => setV({ ...v, end_date: e.target.value })} /></div></div>}
          <div className="flex items-center gap-2"><Switch id="ls-priv" checked={v.is_private} onCheckedChange={(x) => setV({ ...v, is_private: x })} /><Label htmlFor="ls-priv" className="font-normal">{t('Only the members see it')}</Label></div>
          <div className="grid gap-1.5"><Label>{t('Members')}</Label>
            <div className="grid max-h-48 gap-0.5 overflow-y-auto rounded-md border p-1">
              {(people.data ?? []).filter((p) => !p.is_me).map((p) => (
                <label key={p.user_id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[13px] hover:bg-muted">
                  <input type="checkbox" className="size-4" checked={chosen.includes(p.user_id)} onChange={(e) => setMembers(e.target.checked ? [...chosen, p.user_id] : chosen.filter((x) => x !== p.user_id))} />
                  <Avatar person={p} size={20} />{p.name}</label>))}
            </div></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={save.isPending} disabled={!v.name.trim() || (!!v.end_date && !!v.start_date && v.end_date < v.start_date)} onClick={async () => {
            await save.mutateAsync({ id: list?.id, name: v.name.trim(), color: v.color, kind: v.kind, is_private: v.is_private,
              start_date: v.kind === 'project' ? v.start_date || null : null, end_date: v.kind === 'project' ? v.end_date || null : null, members: chosen })
            toast.success(t('Saved')); onClose()
          }}>{t('Save')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
