import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { describeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { enqueue, hasPending } from './outbox'

export const isNetError = (e: unknown) =>
  !navigator.onLine || /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(String((e as { message?: string })?.message ?? e))

export interface Step<R> {
  /** steps of one chain go in order (one count, one receipt, one table) */
  chain: string
  fn: string
  args: Record<string, unknown>
  /** what the person sees in the list of waiting work */
  label: string
  /** what to refresh when it is through */
  invalidate: unknown[][]
  /** apply it to the screen without internet, and give what the server would have answered */
  local: () => R
  /** the server's answer as the result (default: as it is) */
  online?: (data: unknown) => R
}

/**
 * A save that also works without internet: online (and nothing of the same chain still waiting)
 * it goes straight to the server; otherwise it is applied on the screen and kept in the outbox.
 */
export function useOfflineStep<A, R>(build: (a: A) => Step<R>, opts: { quiet?: boolean } = {}) {
  const qc = useQueryClient()
  const { companyId } = useCompany()
  return useMutation({
    mutationFn: async (a: A): Promise<R & { offline?: boolean }> => {
      const s = build(a)
      if (navigator.onLine && !hasPending(s.chain)) {
        const { data, error } = await supabase.rpc(s.fn as never, s.args as never)
        if (!error) {
          for (const k of s.invalidate) void qc.invalidateQueries({ queryKey: k })
          return (s.online ? s.online(data) : data) as R & { offline?: boolean }
        }
        if (!isNetError(error)) throw error
      }
      await enqueue({ company_id: companyId ?? '', fn: s.fn, args: s.args, label: s.label, chain: s.chain, invalidate: s.invalidate })
      const r = s.local()
      return (r && typeof r === 'object' ? { ...r, offline: true } : r) as R & { offline?: boolean }
    },
    onError: opts.quiet ? undefined : (e) => toast.error(describeError(e)),
  })
}

/** ids of documents made on this device and not on the server yet (this session) */
const localIds = new Set<string>()
export const isOfflineId = (id: string | null | undefined) => !!id && localIds.has(id)

/**
 * Save a draft document (save_document), also without internet: kept in the outbox and sent later.
 * A new document made offline gets the id of the step that creates it; steps after it (save again,
 * post) use that id and the server points them at the real document.
 */
export async function saveDocumentOffline(opts: {
  companyId: string; table: string; header: Record<string, unknown>; children: Record<string, unknown>; label: string; invalidate: unknown[][]
  onOnline?: (id: string) => void
}): Promise<string> {
  const header: Record<string, unknown> = { ...opts.header, company_id: opts.companyId }
  const existing = (header.id as string | undefined) || undefined
  const chain = existing ? `doc:${existing}` : undefined
  if (navigator.onLine && !(chain && hasPending(chain))) {
    const { data, error } = await supabase.rpc('save_document', { p_table: opts.table, p_header: header as never, p_children: opts.children as never })
    if (!error) { opts.onOnline?.(data as string); return data as string }
    if (!isNetError(error)) throw error
  }
  const op = crypto.randomUUID ? crypto.randomUUID() : String(Date.now())
  const id = existing ?? op
  if (!existing) delete header.id
  await enqueue({ company_id: opts.companyId, fn: 'offline_call', args: { p_op: op, p_fn: 'save_document', p_args: { p_table: opts.table, p_header: header, p_children: opts.children } },
                  label: opts.label, chain: `doc:${id}`, invalidate: opts.invalidate })
  if (!existing) localIds.add(id)
  return id
}

/** Post a goods receipt; without internet it waits behind the receipt's save. */
export async function postReceiptOffline(opts: { companyId: string; id: string; label: string; invalidate: unknown[][] }) {
  const chain = `doc:${opts.id}`
  if (navigator.onLine && !hasPending(chain) && !isOfflineId(opts.id)) {
    const { data, error } = await supabase.rpc('post_goods_receipt', { p_id: opts.id })
    if (!error) return { offline: false, detail: data }
    if (!isNetError(error)) throw error
  }
  await enqueue({ company_id: opts.companyId, fn: 'offline_call', args: { p_op: crypto.randomUUID(), p_fn: 'post_goods_receipt', p_args: { p_id: opts.id } },
                  label: opts.label, chain, invalidate: opts.invalidate })
  return { offline: true, detail: null }
}
