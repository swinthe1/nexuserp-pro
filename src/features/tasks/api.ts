import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import type { Tables } from '@/lib/database.types'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

export type Task = Tables<'tasks'>
export type TaskList = Tables<'task_lists'>
export type TaskComment = Tables<'task_comments'>
export type TaskCheck = Tables<'task_checklist'>
export type TaskRule = Tables<'task_rules'>
export type TaskTemplate = Tables<'task_templates'>
export type Person = { user_id: string; name: string; is_me: boolean; assignable: boolean }
export type TaskFile = { path: string; name: string; type: string | null }
export const STATUSES = ['todo', 'doing', 'waiting', 'done'] as const
export const PRIORITIES = [0, 1, 2, 3] as const

const key = (c: string) => ['tasks', c] as const
function useInvalidate() {
  const qc = useQueryClient()
  const { companyId } = useCompany()
  return React.useCallback(() => qc.invalidateQueries({ queryKey: key(companyId) }), [qc, companyId])
}
function useAction<A, R>(fn: (a: A) => Promise<R>) {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: fn, onSuccess: () => void invalidate(), onError: (e) => toast.error(describeError(e)) })
}

/** every task I may see that is open, plus what was finished in the last 30 days */
export function useTasks() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...key(companyId), 'all'], enabled: !!companyId,
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 864e5).toISOString()
      return unwrap(await supabase.from('tasks').select('*').eq('company_id', companyId).is('deleted_at', null)
        .or(`status.in.(todo,doing,waiting),completed_at.gte.${since}`).order('due_date', { ascending: true, nullsFirst: false }).order('priority', { ascending: false }).limit(2000))
    },
  })
}
export function useTask(id: string | null) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...key(companyId), 'one', id], enabled: !!companyId && !!id,
    queryFn: async () => unwrap(await supabase.from('tasks').select('*').eq('id', id!).maybeSingle()),
  })
}
/** the tasks tied to one document (an invoice, a customer, a contract) */
export function useLinkedTasks(entityType: string, entityId: string | undefined) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...key(companyId), 'linked', entityType, entityId], enabled: !!companyId && !!entityId,
    queryFn: async () => unwrap(await supabase.from('tasks').select('*').eq('company_id', companyId).eq('entity_type', entityType).eq('entity_id', entityId!)
      .is('deleted_at', null).order('created_at', { ascending: false }).limit(50)),
  })
}
export function useSubtasks(id: string | null) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...key(companyId), 'subs', id], enabled: !!companyId && !!id,
    queryFn: async () => unwrap(await supabase.from('tasks').select('*').eq('parent_id', id!).is('deleted_at', null).order('created_at')),
  })
}
export function useTaskComments(id: string | null) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...key(companyId), 'comments', id], enabled: !!companyId && !!id,
    queryFn: async () => unwrap(await supabase.from('task_comments').select('*').eq('task_id', id!).order('created_at')),
  })
}
export function useChecklist(id: string | null) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...key(companyId), 'check', id], enabled: !!companyId && !!id,
    queryFn: async () => unwrap(await supabase.from('task_checklist').select('*').eq('task_id', id!).order('sort_order').order('created_at')),
  })
}
/** checklist progress for many tasks at once (the cards show 2/5) */
export function useChecklistCounts() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...key(companyId), 'check-counts'], enabled: !!companyId,
    queryFn: async () => {
      const rows = unwrap(await supabase.from('task_checklist').select('task_id, done_at').eq('company_id', companyId).limit(5000)) as { task_id: string; done_at: string | null }[]
      const m = new Map<string, { done: number; total: number }>()
      for (const r of rows) { const c = m.get(r.task_id) ?? { done: 0, total: 0 }; c.total++; if (r.done_at) c.done++; m.set(r.task_id, c) }
      return m
    },
  })
}
export function useWatchers(id: string | null) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...key(companyId), 'watchers', id], enabled: !!companyId && !!id,
    queryFn: async () => (unwrap(await supabase.from('task_watchers').select('user_id').eq('task_id', id!)) as { user_id: string }[]).map((w) => w.user_id),
  })
}
export function usePeople() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...key(companyId), 'people'], enabled: !!companyId, staleTime: 5 * 60_000,
    queryFn: async () => unwrap(await supabase.rpc('task_people', { p_company: companyId })) as unknown as Person[],
  })
}
export function useTaskLists() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...key(companyId), 'lists'], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('task_lists').select('*').eq('company_id', companyId).is('deleted_at', null).is('archived_at', null).order('name')),
  })
}
export function useListMembers(listId: string | null) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...key(companyId), 'members', listId], enabled: !!companyId && !!listId,
    queryFn: async () => (unwrap(await supabase.from('task_list_members').select('user_id').eq('list_id', listId!)) as { user_id: string }[]).map((m) => m.user_id),
  })
}
export function useTaskCounts() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...key(companyId), 'counts'], enabled: !!companyId, refetchInterval: 120_000,
    queryFn: async () => (unwrap(await supabase.rpc('task_counts', { p_company: companyId })) as unknown as { open_mine: number; overdue_mine: number; today_mine: number; overdue_team: number }[])[0]
      ?? { open_mine: 0, overdue_mine: 0, today_mine: 0, overdue_team: 0 },
  })
}

/* ------------------------------------------------------------------ writes */
export type TaskInput = Partial<Omit<Task, 'id' | 'company_id' | 'number' | 'created_at' | 'created_by'>> & { title?: string }
export function useCreateTask() {
  const { companyId } = useCompany()
  return useAction(async (v: TaskInput & { title: string; checklist?: string[] }) => {
    const { checklist, ...row } = v
    const t = unwrap(await supabase.from('tasks').insert({ ...row, company_id: companyId } as never).select('*').single()) as Task
    if (checklist?.length) unwrap(await supabase.from('task_checklist').insert(checklist.map((c, i) => ({ company_id: companyId, task_id: t.id, title: c, sort_order: i })) as never))
    return t
  })
}
export function useUpdateTask() {
  return useAction(async ({ id, ...v }: TaskInput & { id: string }) => unwrap(await supabase.from('tasks').update(v as never).eq('id', id)))
}
export function useDeleteTask() {
  return useAction(async (id: string) => unwrap(await supabase.from('tasks').delete().eq('id', id)))
}
export function useAddCheck() {
  const { companyId } = useCompany()
  return useAction(async (v: { task_id: string; title: string; sort_order: number }) => unwrap(await supabase.from('task_checklist').insert({ ...v, company_id: companyId } as never)))
}
export function useToggleCheck() {
  return useAction(async ({ id, done }: { id: string; done: boolean }) => unwrap(await supabase.from('task_checklist').update({ done_at: done ? new Date().toISOString() : null, done_by: null } as never).eq('id', id)))
}
export function useDeleteCheck() {
  return useAction(async (id: string) => unwrap(await supabase.from('task_checklist').delete().eq('id', id)))
}
export function useWatch() {
  const { companyId } = useCompany()
  return useAction(async ({ task_id, user_id, on }: { task_id: string; user_id: string; on: boolean }) => on
    ? unwrap(await supabase.from('task_watchers').insert({ company_id: companyId, task_id, user_id } as never))
    : unwrap(await supabase.from('task_watchers').delete().eq('task_id', task_id).eq('user_id', user_id)))
}
/** a comment, with photos or files uploaded to the company's private folder first */
export function useAddComment() {
  const { companyId } = useCompany()
  return useAction(async ({ task_id, body, files }: { task_id: string; body: string; files: File[] }) => {
    const saved: TaskFile[] = []
    for (const f of files) {
      const ext = (f.name.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin'
      const path = `${companyId}/tasks/${task_id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const up = await supabase.storage.from('attachments').upload(path, f, { contentType: f.type || undefined, upsert: false })
      if (up.error) throw up.error
      saved.push({ path, name: f.name, type: f.type || null })
    }
    return unwrap(await supabase.from('task_comments').insert({ company_id: companyId, task_id, body: body.trim() || null, files: saved } as never))
  })
}
export async function fileUrl(path: string) {
  const r = await supabase.storage.from('attachments').createSignedUrl(path, 600)
  if (r.error) throw r.error
  return r.data.signedUrl
}
export function useSaveList() {
  const { companyId } = useCompany()
  return useAction(async ({ id, members, ...v }: Partial<TaskList> & { name: string; members?: string[] }) => {
    const l = id
      ? (unwrap(await supabase.from('task_lists').update(v as never).eq('id', id).select('*').single()) as TaskList)
      : (unwrap(await supabase.from('task_lists').insert({ ...v, company_id: companyId } as never).select('*').single()) as TaskList)
    if (members) {
      const now = (unwrap(await supabase.from('task_list_members').select('user_id').eq('list_id', l.id)) as { user_id: string }[]).map((m) => m.user_id)
      const add = members.filter((m) => !now.includes(m)), drop = now.filter((m) => !members.includes(m))
      if (add.length) unwrap(await supabase.from('task_list_members').insert(add.map((user_id) => ({ company_id: companyId, list_id: l.id, user_id })) as never))
      if (drop.length) unwrap(await supabase.from('task_list_members').delete().eq('list_id', l.id).in('user_id', drop))
    }
    return l
  })
}
export function useArchiveList() {
  return useAction(async (id: string) => unwrap(await supabase.from('task_lists').update({ archived_at: new Date().toISOString() } as never).eq('id', id)))
}

/* ------------------------------------------------------------------ repeating tasks, templates, automations */
export function useTaskRules() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...key(companyId), 'rules'], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('task_rules').select('*').eq('company_id', companyId).is('deleted_at', null).order('title')),
  })
}
export function useSaveRule() {
  const { companyId } = useCompany()
  return useAction(async ({ id, ...v }: Partial<TaskRule> & { title: string; freq: string; next_on: string }) => id
    ? unwrap(await supabase.from('task_rules').update(v as never).eq('id', id))
    : unwrap(await supabase.from('task_rules').insert({ ...v, company_id: companyId } as never)))
}
export function useDeleteRule() {
  return useAction(async (id: string) => unwrap(await supabase.from('task_rules').delete().eq('id', id)))
}
export function useTaskTemplates() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...key(companyId), 'templates'], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('task_templates').select('*').eq('company_id', companyId).is('deleted_at', null).order('name')),
  })
}
export type TemplateItem = { title: string; due_in_days: number; assignee?: string | null; checklist?: string[] }
export function useSaveTemplate() {
  const { companyId } = useCompany()
  return useAction(async ({ id, ...v }: { id?: string; name: string; items: TemplateItem[] }) => id
    ? unwrap(await supabase.from('task_templates').update(v as never).eq('id', id))
    : unwrap(await supabase.from('task_templates').insert({ ...v, company_id: companyId } as never)))
}
export function useDeleteTemplate() {
  return useAction(async (id: string) => unwrap(await supabase.from('task_templates').delete().eq('id', id)))
}
export function useApplyTemplate() {
  return useAction(async (v: { template: string; start: string; assignee: string | null; list: string | null }) =>
    unwrap(await supabase.rpc('task_apply_template', { p_template: v.template, p_start: v.start, p_assignee: v.assignee ?? undefined, p_list: v.list ?? undefined })) as unknown as number)
}
export type AutoSettings = Record<string, { on?: boolean; days?: number }>
export function useTaskSettings() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...key(companyId), 'settings'], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('company_settings').select('task_automations, task_digest_email').eq('company_id', companyId).single()) as { task_automations: AutoSettings; task_digest_email: boolean },
  })
}
export function useSaveTaskSettings() {
  const { companyId } = useCompany()
  return useAction(async (v: { task_automations?: AutoSettings; task_digest_email?: boolean }) => unwrap(await supabase.from('company_settings').update(v as never).eq('company_id', companyId)))
}
export function useRunAutomations() {
  const { companyId } = useCompany()
  return useAction(async () => unwrap(await supabase.rpc('tasks_run_now', { p_company: companyId })) as unknown as number)
}
