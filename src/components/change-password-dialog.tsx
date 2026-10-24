import * as React from 'react'
import { toast } from 'sonner'
import { useAuth } from '@/app/auth-provider'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { t } from '@/i18n'
import { describeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

/** The signed-in person changes their own password (current one first, so a borrowed device is not enough). */
export function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { user } = useAuth()
  const [current, setCurrent] = React.useState('')
  const [next, setNext] = React.useState('')
  const [repeat, setRepeat] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => { if (open) { setCurrent(''); setNext(''); setRepeat(''); setError(null) } }, [open])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (next.length < 8 || !/[0-9]/.test(next)) { setError(t('Use at least 8 characters, including a number.')); return }
    if (next !== repeat) { setError(t('The two new passwords are not the same.')); return }
    setBusy(true)
    try {
      const check = await supabase.auth.signInWithPassword({ email: user?.email ?? '', password: current })
      if (check.error) { setError(t('The current password is not correct.')); return }
      const { error: err } = await supabase.auth.updateUser({ password: next })
      if (err) throw err
      toast.success(t('Password changed'))
      onOpenChange(false)
    } catch (err) {
      setError(describeError(err))
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('Change password')}</DialogTitle>
          <DialogDescription>{t('Use at least 8 characters, including a number.')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3" noValidate>
          <div className="grid gap-1.5"><label htmlFor="cp-current" className="text-sm font-medium">{t('Current password')}</label>
            <Input id="cp-current" type="password" autoComplete="current-password" autoFocus value={current} onChange={(e) => setCurrent(e.target.value)} /></div>
          <div className="grid gap-1.5"><label htmlFor="cp-new" className="text-sm font-medium">{t('New password')}</label>
            <Input id="cp-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></div>
          <div className="grid gap-1.5"><label htmlFor="cp-repeat" className="text-sm font-medium">{t('Repeat the new password')}</label>
            <Input id="cp-repeat" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} /></div>
          {error && <p className="text-[13px] text-destructive">{error}</p>}
          <DialogFooter className="mt-1">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('Cancel')}</Button>
            <Button type="submit" loading={busy}>{t('Change password')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
