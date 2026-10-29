import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { t } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

type Details = { first_name: string | null; last_name: string | null; phone: string | null; email: string }

/**
 * First name, last name and phone of a person. The person changes their own; the company's administrator
 * those of the company's people; the Super Admin anyone's. The email stays: it is the sign-in.
 */
export function ProfileDialog({ userId, self, onClose, companyId: forCompany }: { userId: string; self?: boolean; onClose: () => void
  /** the company the person belongs to, when it is not the one open (the platform console) */
  companyId?: string }) {
  const { companyId: openCompany } = useCompany()
  const companyId = forCompany ?? openCompany
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['member-profile', userId],
    queryFn: async () => unwrap(await supabase.rpc('member_profile_get', { p_company: companyId!, p_user: userId })) as unknown as Details,
  })
  const [f, setF] = React.useState({ first: '', last: '', phone: '' })
  React.useEffect(() => { if (q.data) setF({ first: q.data.first_name ?? '', last: q.data.last_name ?? '', phone: q.data.phone ?? '' }) }, [q.data])
  const save = useMutation({
    mutationFn: async () => {
      unwrap(await supabase.rpc('member_profile_save', { p_company: companyId!, p_user: userId, p_first_name: f.first, p_last_name: f.last, p_phone: f.phone }))
      // one's own new name shows at once in the menus and on the till
      if (self) await supabase.auth.refreshSession()
    },
    onSuccess: () => {
      toast.success(t('Details saved'))
      void qc.invalidateQueries({ queryKey: ['member-profile', userId] })
      void qc.invalidateQueries({ predicate: (x) => x.queryKey.includes('users') || x.queryKey[0] === 'platform' })
      onClose()
    },
    onError: (e) => toast.error(describeError(e)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{self ? t('My details') : t('Change details')}</DialogTitle>
          <DialogDescription>{q.data?.email ? t('Signs in with {email}. The email stays the same.', { email: q.data.email }) : ' '}</DialogDescription>
        </DialogHeader>
        {q.isLoading ? <Skeleton className="h-40" /> : q.isError ? <p className="text-sm text-destructive">{describeError(q.error)}</p> : (
          <form id="profile-form" className="grid gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5"><Label htmlFor="pf-first">{t('First name')}</Label>
                <Input id="pf-first" autoFocus value={f.first} onChange={(e) => setF({ ...f, first: e.target.value })} autoComplete="given-name" /></div>
              <div className="grid gap-1.5"><Label htmlFor="pf-last">{t('Last name')}</Label>
                <Input id="pf-last" value={f.last} onChange={(e) => setF({ ...f, last: e.target.value })} autoComplete="family-name" /></div>
            </div>
            <div className="grid gap-1.5"><Label htmlFor="pf-phone">{t('Phone')}</Label>
              <Input id="pf-phone" type="tel" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="+383 44 123 456" autoComplete="tel" /></div>
          </form>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
          <Button type="submit" form="profile-form" loading={save.isPending} disabled={!f.first.trim() || q.isLoading}>{t('Save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
