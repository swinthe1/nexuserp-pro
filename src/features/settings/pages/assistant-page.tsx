import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, Brain, Building2, MessageSquare, Pencil, Plus, ThumbsDown, Trash2, User } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { msg, t } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'
import { Field } from '../components/field'

type Kind = 'rule' | 'name' | 'procedure' | 'preference' | 'correction'
type Lesson = { id: string; kind: Kind; title: string | null; body: string; source: 'taught' | 'chat' | 'declined'; company: boolean; by: string | null; updated_at: string; can_edit: boolean }
type List = { can_teach_company: boolean; items: Lesson[] }

const KINDS: { key: Exclude<Kind, 'correction'>; label: string; hint: string; example: string }[] = [
  { key: 'rule', label: msg('A rule'), hint: msg('What must always or never happen'), example: msg('Customers more than 30 days late get no goods on credit before they pay.') },
  { key: 'name', label: msg('A word or a name'), hint: msg('What you mean when you say it'), example: msg('When we say "kafe" we mean Kafe turke 200 g (code KAF-200).') },
  { key: 'procedure', label: msg('How we do it'), hint: msg('The steps of a job, with a title'), example: msg('1. Count the cash. 2. Print the Z report. 3. Put the money in the safe and write the amount on the envelope.') },
  { key: 'preference', label: msg('A preference'), hint: msg('How you like the answers'), example: msg('Give me the numbers without VAT, in a short table.') },
]
const KIND_LABEL: Record<Kind, string> = { rule: msg('A rule'), name: msg('A word or a name'), procedure: msg('How we do it'), preference: msg('A preference'), correction: msg('A correction') }
const SOURCE: Record<Lesson['source'], { icon: typeof Pencil; label: string }> = {
  taught: { icon: Pencil, label: msg('Written on this page') },
  chat: { icon: MessageSquare, label: msg('Learned in a conversation') },
  declined: { icon: ThumbsDown, label: msg('From a "No" with its reason') },
}

/** What the agent knows about this company and this person, and where it learned it */
export function AssistantKnowledgePage() {
  const { companyId, hasFeature } = useCompany()
  const qc = useQueryClient()
  const [editing, setEditing] = React.useState<Partial<Lesson> | null>(null)
  const list = useQuery({ queryKey: ['assistant-memory', companyId], queryFn: async () => unwrap(await supabase.rpc('assistant_memory_list', { p_company: companyId })) as unknown as List })
  const del = useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.rpc('assistant_memory_delete', { p_id: id })),
    onSuccess: () => { toast.success(t('Forgotten')); void qc.invalidateQueries({ queryKey: ['assistant-memory', companyId] }) },
    onError: (e) => toast.error(describeError(e)),
  })
  const items = list.data?.items ?? []
  const company = items.filter((i) => i.company), mine = items.filter((i) => !i.company)
  const on = hasFeature('ai_assistant')
  return (
    <>
      <PageHeader title={t('What the agent knows')}
        description={t('Teach the assistant how your business works: its rules, your words and names, how you do a job and how you like the answers. It follows them in every answer and in the morning check. It also learns in the chat and from the reason of a "No". A lesson never gives anyone more permissions.')}
        actions={on ? <Button onClick={() => setEditing({ kind: 'rule', company: list.data?.can_teach_company ?? false })}><Plus />{t('Teach something new')}</Button> : undefined} />
      {!on ? (
        <Card><EmptyState icon={Brain} title={t('The assistant is not in your plan')} description={t('Ask your provider to turn on the Assistant module.')} /></Card>
      ) : list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : list.isLoading ? <Skeleton className="h-64" /> : items.length === 0 ? (
        <Card>
          <EmptyState icon={Brain} title={t('The agent knows only the program for now')}
            description={t('Start with the three things a new worker asks first: which customers to be careful with, what your words mean, and how the day is closed.')}
            action={<Button onClick={() => setEditing({ kind: 'rule', company: list.data?.can_teach_company ?? false })}><Plus />{t('Teach something new')}</Button>} />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Section icon={Building2} title={t('For the whole company')} note={t('Everyone’s assistant follows these.')} items={company} onEdit={setEditing} onDelete={(id) => del.mutate(id)} />
          <Section icon={User} title={t('Only for you')} note={t('Only your assistant follows these; nobody else sees them.')} items={mine} onEdit={setEditing} onDelete={(id) => del.mutate(id)} />
        </div>
      )}
      {editing && <LessonDialog lesson={editing} canCompany={list.data?.can_teach_company ?? false} onClose={() => setEditing(null)} />}
    </>
  )
}

function Section({ icon: Icon, title, note, items, onEdit, onDelete }: {
  icon: typeof Brain; title: string; note: string; items: Lesson[]; onEdit: (l: Lesson) => void; onDelete: (id: string) => void
}) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2"><Icon className="size-4 text-muted-foreground" /><h2 className="text-sm font-semibold">{title}</h2><span className="text-xs text-muted-foreground">{note}</span></div>
      {items.length === 0 ? <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{t('Nothing yet.')}</p> : (
        <div className="space-y-2">
          {items.map((l) => {
            const S = SOURCE[l.source]
            return (
              <Card key={l.id} className="group p-4">
                <div className="flex items-start gap-3">
                  {l.kind === 'procedure' ? <BookOpen className="mt-0.5 size-4 shrink-0 text-primary" /> : <Brain className="mt-0.5 size-4 shrink-0 text-primary" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">{t(KIND_LABEL[l.kind])}</Badge>
                      {l.title && <span className="text-sm font-medium">{l.title}</span>}
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap text-sm">{l.body}</p>
                    <p className="mt-2 flex flex-wrap items-center gap-1.5 text-2xs text-muted-foreground"><S.icon className="size-3" />{t(S.label)}{l.by ? ` · ${l.by}` : ''} · {formatDate(l.updated_at)}</p>
                  </div>
                  {l.can_edit && (
                    <div className="flex shrink-0 gap-1 opacity-70 group-hover:opacity-100">
                      <Button variant="ghost" size="icon-sm" aria-label={t('Change|edit')} title={t('Change|edit')} onClick={() => onEdit(l)}><Pencil /></Button>
                      <Button variant="ghost" size="icon-sm" aria-label={t('Forget')} title={t('Forget')} onClick={() => onDelete(l.id)}><Trash2 /></Button>
                    </div>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </section>
  )
}

function LessonDialog({ lesson, canCompany, onClose }: { lesson: Partial<Lesson>; canCompany: boolean; onClose: () => void }) {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  const [kind, setKind] = React.useState<Kind>(lesson.kind ?? 'rule')
  const [title, setTitle] = React.useState(lesson.title ?? '')
  const [body, setBody] = React.useState(lesson.body ?? '')
  const [forAll, setForAll] = React.useState(!!lesson.company && canCompany)
  const k = KINDS.find((x) => x.key === kind)
  const save = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('assistant_memory_save', {
      p_company: companyId, p_id: lesson.id as string, p_kind: kind, p_title: kind === 'procedure' ? title : '', p_body: body, p_company_wide: forAll })),
    onSuccess: () => { toast.success(t('The agent will follow it')); void qc.invalidateQueries({ queryKey: ['assistant-memory', companyId] }); onClose() },
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{lesson.id ? t('Change the lesson') : t('Teach something new')}</DialogTitle>
          <DialogDescription>{t('Write it the way you would tell a new worker.')}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
          <Field label={t('What is it')} hint={k ? t(k.hint) : undefined}>
            <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {KINDS.map((x) => <SelectItem key={x.key} value={x.key}>{t(x.label)}</SelectItem>)}
                {kind === 'correction' && <SelectItem value="correction">{t('A correction')}</SelectItem>}
              </SelectContent>
            </Select>
          </Field>
          {kind === 'procedure' && (
            <Field label={t('Title')} htmlFor="lesson-title">
              <Input id="lesson-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder={t('e.g. Closing the day at the till')} />
            </Field>
          )}
          <Field label={t('What the agent should know')} htmlFor="lesson-body">
            <Textarea id="lesson-body" rows={kind === 'procedure' ? 8 : 4} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} placeholder={k ? t(k.example) : ''} />
          </Field>
          <label className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
            <span className="text-sm">{t('For the whole company')}
              <span className="block text-xs text-muted-foreground">{canCompany ? t('Off: only your own assistant follows it.') : t('Only a manager teaches the agent for the whole company.')}</span></span>
            <Switch checked={forAll} disabled={!canCompany} onCheckedChange={setForAll} />
          </label>
          {save.isError && <p className="text-sm text-destructive">{describeError(save.error)}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{t('Cancel')}</Button>
            <Button type="submit" disabled={save.isPending || body.trim().length < 3}>{t('Save')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
