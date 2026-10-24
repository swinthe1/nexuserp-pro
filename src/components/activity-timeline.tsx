import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleDot, MessageSquare, PencilLine, Plus, Stamp, Trash2, Undo2 } from 'lucide-react'
import * as React from 'react'
import { useCompany } from '@/app/company-provider'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { supabase } from '@/lib/supabase'
import { cn, formatDate, humanize } from '@/lib/utils'
import { t, tServer } from '@/i18n'

const HIDDEN = new Set(['updated_at', 'updated_by', 'created_at', 'created_by', 'id', 'company_id'])

function describeAudit(action: string | null, fields: string[] | null) {
  switch (action) {
    case 'INSERT': return t('Created')
    case 'SOFT_DELETE': return t('Deleted')
    case 'RESTORE': return t('Restored')
    case 'UPDATE': {
      const f = (fields ?? []).filter((x) => !HIDDEN.has(x))
      if (!f.length) return t('Updated')
      const list = f.slice(0, 4).map(humanize).map((s) => s.toLowerCase()).join(', ')
      return f.length > 4 ? t('Changed {fields} and {n} more', { fields: list, n: f.length - 4 }) : t('Changed {fields}', { fields: list })
    }
    default: return humanize(action)
  }
}

const ICON = { INSERT: Plus, UPDATE: PencilLine, SOFT_DELETE: Trash2, RESTORE: Undo2 } as const

/** Merged audit trail + comments + status changes + approvals for one record */
export function ActivityTimeline({ table, id, allowComments = true }: { table: string; id: string; allowComments?: boolean }) {
  const { companyId, can } = useCompany()
  const qc = useQueryClient()
  const [comment, setComment] = React.useState('')
  const key = ['history', table, id]
  const history = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_record_history', { p_table: table, p_id: id })
      if (error) throw error
      // status changes are logged both as audit + activity: keep the readable activity
      return data.filter((h) => !(h.kind === 'audit' && h.action === 'UPDATE' && h.changed_fields?.includes('status')))
    },
  })
  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('entity_activities').insert({
        company_id: companyId, entity_type: table, entity_id: id, activity_type: 'comment', body: comment.trim(),
      })
      if (error) throw error
    },
    onSuccess: () => { setComment(''); void qc.invalidateQueries({ queryKey: key }) },
  })

  return (
    <div className="flex flex-col gap-4">
      {allowComments && can('collab.write') && (
        <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (comment.trim()) add.mutate() }}>
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t('Add a note for your team…')} rows={2} />
          <div className="flex justify-end">
            <Button size="sm" type="submit" disabled={!comment.trim()} loading={add.isPending}>{t('Add note')}</Button>
          </div>
        </form>
      )}
      {history.isLoading && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
      {history.data?.length === 0 && <p className="text-sm text-muted-foreground">{t('No activity yet.')}</p>}
      <ol className="relative flex flex-col gap-4 border-l pl-5">
        {history.data?.map((h, i) => {
          const Icon = h.kind === 'comment' ? MessageSquare : h.kind === 'approval' ? Stamp
            : h.kind === 'audit' ? ICON[(h.action ?? 'UPDATE') as keyof typeof ICON] ?? PencilLine : CircleDot
          const title = h.kind === 'audit' ? describeAudit(h.action, h.changed_fields) : (h.title ? tServer(h.title) : humanize(h.kind))
          return (
            <li key={`${h.occurred_at}-${i}`} className="relative">
              <span className={cn('absolute -left-[29px] top-0 flex size-[18px] items-center justify-center rounded-full border bg-card',
                h.kind === 'status_change' && 'border-primary/40 text-primary', h.kind === 'approval' && 'border-success/40 text-success')}>
                <Icon className="size-2.5" />
              </span>
              <div className="text-[13px]">
                <span className="font-medium">{title}</span>
                <span className="text-muted-foreground"> · {h.actor_name ?? t('System')} · {formatDate(h.occurred_at, true)}</span>
              </div>
              {h.body && <p className="mt-1 whitespace-pre-wrap rounded-md bg-muted/60 px-2.5 py-1.5 text-[13px]">{h.kind === 'comment' ? h.body : tServer(h.body)}</p>}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
