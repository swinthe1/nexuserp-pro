import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { tracksFor } from '@/i18n/help/training'
import { toast } from 'sonner'
import { useAuth } from '@/app/auth-provider'
import { useCompany } from '@/app/company-provider'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

/** the lessons I finished in this company */
export function useMyTraining() {
  const { companyId } = useCompany()
  const { user } = useAuth()
  return useQuery({
    queryKey: ['training', companyId, user?.id],
    enabled: !!companyId && !!user,
    queryFn: async () => new Set((unwrap(await supabase.from('training_progress').select('lesson').eq('company_id', companyId!).eq('user_id', user!.id)) as { lesson: string }[]).map((r) => r.lesson)),
  })
}
export function useMarkLesson() {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (a: { lesson: string; done: boolean }) => unwrap(await supabase.rpc('training_mark', { p_company: companyId!, p_lesson: a.lesson, p_done: a.done })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['training', companyId] }),
    onError: (e) => toast.error(describeError(e)),
  })
}
/** for the owner: who finished which lessons */
export function useTrainingOverview(enabled = true) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: ['training', companyId, 'overview'],
    enabled: !!companyId && enabled,
    queryFn: async () => new Map((unwrap(await supabase.rpc('training_overview', { p_company: companyId! })) as unknown as { user_id: string; lessons: string[] }[]).map((r) => [r.user_id, new Set(r.lessons)])),
  })
}

/** the training paths of the person signed in: for their roles, with only the pages the licence opens */
export function useMyTracks(all = false) {
  const { company, pageAllowed, can, hasFeature } = useCompany()
  return React.useMemo(() => tracksFor(company?.roles ?? [],
    (l) => pageAllowed(l.href) && (!l.perm || can(l.perm)) && (!l.feature || hasFeature(l.feature)), all),
  [company?.roles, pageAllowed, can, hasFeature, all])
}
