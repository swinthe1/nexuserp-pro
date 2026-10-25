import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MonitorSmartphone, Trash2 } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { t, tServer } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { getTill, setTill } from '@/lib/shared-till'
import { supabase } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'

export type MemberExtra = { member_id: string; view_mode: 'auto' | 'simple' | 'full'; simple: boolean; has_pin: boolean; pin_locked: boolean }

export function useMemberExtras() {
  const { companyId } = useCompany()
  return useQuery({ queryKey: ['member-extras', companyId], enabled: !!companyId,
    queryFn: async () => new Map((unwrap(await supabase.rpc('member_extras', { p_company: companyId })) as MemberExtra[]).map((m) => [m.member_id, m])) })
}

export function useSetView() {
  const qc = useQueryClient()
  const { refresh } = useCompany()
  return useMutation({
    mutationFn: async (v: { member: string; mode: MemberExtra['view_mode'] }) => unwrap(await supabase.rpc('member_set_view', { p_member: v.member, p_mode: v.mode })),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['member-extras'] }); void refresh(); toast.success(t('Saved')) },
    onError: (e) => toast.error(describeError(e)),
  })
}

/** The administrator gives a person a PIN for the shared till (or takes it away). */
export function PinDialog({ member, name, hasPin, onClose }: { member: string; name: string; hasPin: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [pin, setPin] = React.useState('')
  const [again, setAgain] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const save = useMutation({
    mutationFn: async (p: string | null) => unwrap(await supabase.rpc('member_set_pin', { p_member: member, p_pin: p as string })),
    onSuccess: (_r, p) => { void qc.invalidateQueries({ queryKey: ['member-extras'] }); toast.success(p ? t('{name} can sign in with the PIN on the shared till', { name }) : t('PIN removed')); onClose() },
    onError: (e) => setError(describeError(e)),
  })
  const ok = /^\d{4,6}$/.test(pin) && pin === again
  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 6)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('PIN of {name}', { name })}</DialogTitle>
          <DialogDescription>{t('4 to 6 digits. On a shared till this person taps their name and types the PIN instead of email and password. Tell it to them in person.')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label htmlFor="pin1">{t('New PIN')}</Label>
            <Input id="pin1" type="password" inputMode="numeric" autoComplete="new-password" autoFocus className="text-center text-2xl tracking-[0.5em]" value={pin} onChange={(e) => { setPin(digits(e.target.value)); setError(null) }} /></div>
          <div className="grid gap-1.5"><Label htmlFor="pin2">{t('The same PIN again')}</Label>
            <Input id="pin2" type="password" inputMode="numeric" autoComplete="new-password" className="text-center text-2xl tracking-[0.5em]" value={again} onChange={(e) => { setAgain(digits(e.target.value)); setError(null) }} /></div>
          {again.length >= 4 && pin !== again && <p className="text-xs text-destructive">{t('The two PINs are not the same')}</p>}
          {error && <p className="text-xs text-destructive">{tServer(error)}</p>}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {hasPin ? <Button variant="ghost" className="text-destructive" onClick={() => save.mutate(null)} disabled={save.isPending}>{t('Remove the PIN')}</Button> : <span />}
          <Button disabled={!ok} loading={save.isPending} onClick={() => save.mutate(pin)}>{t('Save PIN')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** This computer as a shared till, and the list of the company's tills. */
export function SharedTillCard() {
  const { companyId, company, can } = useCompany()
  const qc = useQueryClient()
  const write = can('admin.write')
  const [here, setHere] = React.useState(getTill)
  const [name, setName] = React.useState('')
  const [asking, setAsking] = React.useState(false)
  const list = useQuery({ queryKey: ['shared-devices', companyId], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('shared_devices', { p_company: companyId })) as { id: string; name: string; created_at: string; last_used_at: string | null }[] })
  const register = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('shared_device_register', { p_company: companyId, p_name: name })) as string,
    onSuccess: (token) => {
      const till = { token, name: name.trim(), company: company?.name ?? '' }
      setTill(till); setHere(till); setAsking(false); setName('')
      void qc.invalidateQueries({ queryKey: ['shared-devices'] })
      toast.success(t('This computer is a shared till now. After signing out, people sign in here with their PIN.'))
    },
    onError: (e) => toast.error(describeError(e)),
  })
  const revoke = useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.rpc('shared_device_revoke', { p_id: id })),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['shared-devices'] }) },
    onError: (e) => toast.error(describeError(e)),
  })
  const devices = list.data ?? []
  return (
    <div className="mb-5 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start gap-3">
        <MonitorSmartphone className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{t('Shared till')}</p>
          <p className="mt-0.5 max-w-2xl text-[13px] text-muted-foreground">
            {t('On a computer that several people use, each one taps their name and types a PIN, with no email or password. It locks itself after 10 minutes without use.')}
          </p>
          {here && <p className="mt-1.5 text-[13px]">{t('This computer is the till “{name}”.', { name: here.name })}</p>}
        </div>
        {write && !here && <Button variant="outline" size="sm" onClick={() => setAsking(true)}>{t('Make this computer a shared till')}</Button>}
        {here && <Button variant="ghost" size="sm" onClick={() => { setTill(null); setHere(null) }}>{t('Stop using it as a till')}</Button>}
      </div>
      {devices.length > 0 && (
        <ul className="mt-3 divide-y rounded-md border text-[13px]">
          {devices.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1 truncate font-medium">{d.name}</span>
              <span className="text-xs text-muted-foreground">{d.last_used_at ? t('last used {date}', { date: formatDate(d.last_used_at, true) }) : t('not used yet')}</span>
              {write && <Button variant="ghost" size="icon-sm" aria-label={t('Remove the till {name}', { name: d.name })} onClick={() => revoke.mutate(d.id)}><Trash2 /></Button>}
            </li>
          ))}
        </ul>
      )}
      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('Name of this till')}</DialogTitle>
            <DialogDescription>{t('So you recognise it in the list, e.g. Arka 1 or Kuzhina.')}</DialogDescription>
          </DialogHeader>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Till 1')} maxLength={60} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAsking(false)}>{t('Cancel')}</Button>
            <Button disabled={!name.trim()} loading={register.isPending} onClick={() => register.mutate()}>{t('Make it a till')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
