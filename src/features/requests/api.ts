import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { msg } from '@/i18n'
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

export type RequestKind = 'add' | 'remove' | 'change' | 'merge' | 'bug'
export type RequestStatus = 'new' | 'accepted' | 'in_progress' | 'done' | 'rejected'

export const KINDS: { key: RequestKind; label: string }[] = [
  { key: 'add', label: msg('Add|request') },
  { key: 'remove', label: msg('Remove|request') },
  { key: 'change', label: msg('Change|request') },
  { key: 'merge', label: msg('Join|request') },
  { key: 'bug', label: msg('Mistake|request') },
]
export const STATUSES: { key: RequestStatus; label: string; variant: 'info' | 'default' | 'warning' | 'success' | 'destructive' }[] = [
  { key: 'new', label: msg('New|request'), variant: 'info' },
  { key: 'accepted', label: msg('Accepted|request'), variant: 'default' },
  { key: 'in_progress', label: msg('In progress|request'), variant: 'warning' },
  { key: 'done', label: msg('Done|request'), variant: 'success' },
  { key: 'rejected', label: msg('Rejected|request'), variant: 'destructive' },
]

export type ChangeRequest = {
  id: string; number: number; kind: RequestKind; body: string; detail: string | null
  page_path: string | null; page_title: string | null; target: string | null
  status: RequestStatus; done_version: string | null; reply: string | null
  duplicate_of: string | null; duplicate_number: number | null
  author_name: string | null; mine: boolean; votes: number; voted: boolean; own_company: boolean
  company: string | null; screenshot: string | null; version: string | null; screen: string | null
  created_at: string; updated_at: string
}

export const reqNo = (n: number) => `K-${String(n).padStart(4, '0')}`

export function useRequestsOn() {
  return useQuery({ queryKey: ['change-requests-on'], staleTime: 5 * 60_000,
    queryFn: async () => unwrap(await supabase.rpc('change_requests_on' as never)) as unknown as boolean })
}

export function useRequests() {
  return useQuery({ queryKey: ['change-requests'],
    queryFn: async () => unwrap(await supabase.rpc('change_requests_list' as never)) as unknown as ChangeRequest[] })
}

export type NewRequest = { company_id: string; kind: RequestKind; body: string; detail?: string | null; page_path: string; page_title: string
  target?: string | null; picture?: Blob | null }

export function useSubmitRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ picture, ...r }: NewRequest) => {
      let screenshot: string | null = null
      if (picture) {
        const ext = picture.type === 'image/png' ? 'png' : 'jpg'
        const path = `${r.company_id}/requests/${crypto.randomUUID()}.${ext}`
        const up = await supabase.storage.from('attachments').upload(path, picture, { contentType: picture.type || 'image/jpeg', upsert: false })
        if (!up.error) screenshot = path
      }
      return unwrap(await supabase.rpc('change_request_submit' as never, { p: {
        ...r, screenshot, version: typeof __BUILD__ === 'string' ? __BUILD__ : null, screen: `${window.innerWidth}×${window.innerHeight}`,
      } } as never)) as unknown as { id: string; number: number }
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['change-requests'] }),
  })
}

export function useVote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.rpc('change_request_vote' as never, { p_id: id } as never)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['change-requests'] }),
  })
}

export function useWithdraw() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.rpc('change_request_withdraw' as never, { p_id: id } as never)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['change-requests'] }),
  })
}

export function useUpdateRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...p }: { id: string; status?: RequestStatus; done_version?: string; reply?: string; duplicate_of?: string | null }) =>
      unwrap(await supabase.rpc('change_request_update' as never, { p_id: id, p } as never)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['change-requests'] }),
  })
}

export function useSetRequestsOn() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (on: boolean) => unwrap(await supabase.rpc('platform_set_requests_on' as never, { p_on: on } as never)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['change-requests-on'] }),
  })
}

/** the AI writes the request out in detail; waits up to 90 seconds for the answer */
export async function writeOutInDetail(companyId: string, p: { kind: RequestKind; body: string; page_title: string; page_path: string; target?: string | null; lang: string }) {
  const id = unwrap(await supabase.rpc('change_request_detail_start' as never, { p_company: companyId, p } as never)) as unknown as string
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, i < 5 ? 700 : 1200))
    const r = unwrap(await supabase.rpc('change_request_detail_result' as never, { p_id: id } as never)) as unknown as { status: string; text: string | null; error: string | null }
    if (r.status === 'done') return (r.text ?? '').trim()
    if (r.status === 'failed') throw new Error('Agent Dris could not answer now')
  }
  throw new Error('Agent Dris did not answer in time, try again')
}

export async function pictureUrl(path: string) {
  const r = await supabase.storage.from('attachments').createSignedUrl(path, 600)
  if (r.error) throw r.error
  return r.data.signedUrl
}
