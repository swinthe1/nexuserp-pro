import { ShieldCheck } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { t } from '@/i18n'
import { describeError } from '@/lib/errors'
import { posApprove } from './api'

type Manager = { member_id: string; name: string }

/** the manager picks their name and types their PIN on the cashier's screen */
export function ManagerPinFields({ managers, member, onMember, pin, onPin, autoFocus }: {
  managers: Manager[]; member: string; onMember: (v: string) => void; pin: string; onPin: (v: string) => void; autoFocus?: boolean
}) {
  return (
    <div className="grid grid-cols-[1fr_120px] gap-2">
      <div className="grid gap-1.5">
        <Label>{t('Manager')}</Label>
        <Select value={member} onValueChange={onMember}>
          <SelectTrigger aria-label={t('Manager')}><SelectValue placeholder={t('Who confirms')} /></SelectTrigger>
          <SelectContent>{managers.map((m) => <SelectItem key={m.member_id} value={m.member_id}>{m.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="mgr-pin">{t('PIN')}</Label>
        <Input id="mgr-pin" type="password" inputMode="numeric" autoComplete="off" maxLength={6} autoFocus={autoFocus && !!member}
          className="text-center text-lg tracking-[0.4em] tabular" value={pin} onChange={(e) => onPin(e.target.value.replace(/\D/g, '').slice(0, 6))} />
      </div>
    </div>
  )
}

export const pinReady = (member: string, pin: string) => !!member && /^\d{4,6}$/.test(pin)

/** a void at the till: one confirmation covers the rest of the sale */
export function ManagerDialog({ registerId, managers, title, description, onCancel, onApproved }: {
  registerId: string; managers: Manager[]; title: string; description: string
  onCancel: () => void; onApproved: (a: { approval: string; name: string }) => void
}) {
  const [member, setMember] = React.useState(managers.length === 1 ? managers[0]!.member_id : '')
  const [pin, setPin] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const submit = async () => {
    if (!pinReady(member, pin) || busy) return
    setBusy(true); setError(null)
    try {
      const r = await posApprove(registerId, member, pin, 'void')
      if (r.error || !r.approval) { setError(t(r.error ?? 'Wrong PIN')); setPin(''); return }
      onApproved({ approval: r.approval, name: r.name ?? '' })
    } catch (e) { setError(describeError(e)) } finally { setBusy(false) }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ShieldCheck className="size-5 text-primary" /> {title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void submit() }}>
          <ManagerPinFields managers={managers} member={member} onMember={setMember} pin={pin} onPin={setPin} autoFocus />
          {error && <p className="text-[13px] text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>{t('Cancel')}</Button>
            <Button type="submit" loading={busy} disabled={!pinReady(member, pin)}>{t('Confirm')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
