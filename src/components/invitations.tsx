import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Check, X } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/app/auth-provider'
import { Button } from '@/components/ui/button'
import { t, td } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

type Invitation = { member_id: string; company_id: string; company_name: string; invited_at: string; invited_by: string | null; roles: string[] }

/** Companies that invited me: I accept or refuse here; nobody is put into a company without saying yes */
export function Invitations({ className }: { className?: string }) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['my-invitations', user?.id],
    enabled: !!user,
    refetchInterval: 60_000,
    queryFn: async () => unwrap(await supabase.rpc('my_invitations')) as unknown as Invitation[],
  })
  const answer = useMutation({
    mutationFn: async (a: { id: string; accept: boolean }) => unwrap(await supabase.rpc('answer_invitation', { p_member: a.id, p_accept: a.accept })),
    onSuccess: (_r, a) => {
      toast.success(a.accept ? t('You are now in the company') : t('Invitation refused'))
      void qc.invalidateQueries({ queryKey: ['my-invitations'] })
      void qc.invalidateQueries({ queryKey: ['my-context'] })
    },
    onError: (e) => toast.error(describeError(e)),
  })
  if (!q.data?.length) return null
  return (
    <div className={className}>
      {q.data.map((i) => (
        <div key={i.member_id} className="flex flex-wrap items-center gap-3 border-b border-primary/20 bg-primary/5 px-4 py-2.5 text-[13px]">
          <Building2 className="size-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">
            <b>{i.company_name}</b> {i.invited_by ? t('invited you ({name}) as {roles}', { name: i.invited_by, roles: i.roles.map((r) => td(r)).join(', ') }) : t('invited you as {roles}', { roles: i.roles.map((r) => td(r)).join(', ') })}
          </span>
          <span className="flex gap-2">
            <Button size="sm" loading={answer.isPending && answer.variables?.id === i.member_id && answer.variables.accept} onClick={() => answer.mutate({ id: i.member_id, accept: true })}><Check /> {t('Accept')}</Button>
            <Button size="sm" variant="outline" onClick={() => answer.mutate({ id: i.member_id, accept: false })}><X /> {t('Refuse')}</Button>
          </span>
        </div>
      ))}
    </div>
  )
}
