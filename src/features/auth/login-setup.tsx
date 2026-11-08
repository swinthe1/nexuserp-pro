import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { useAuth } from '@/app/auth-provider'
import { useCompany } from '@/app/company-provider'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { t, tServer } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

/** a user name made from a person's name: "Arbën Krasniqi" → "arben.krasniqi" */
export function suggestUsername(name: string) {
  return name.toLowerCase().replace(/ë/g, 'e').replace(/ç/g, 'c').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').slice(0, 30)
}
export const cleanUsername = (v: string) => v.toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 30)
export const cleanPin = (v: string) => v.replace(/\D/g, '').slice(0, 6)
export const usernameOk = (v: string) => /^[a-z0-9][a-z0-9._-]{2,29}$/.test(v)
/** the same rule as the server: 6 digits, not all the same, not a straight run */
export function pinProblem(pin: string): string | null {
  if (!/^\d{6}$/.test(pin)) return t('The PIN is 6 digits')
  if (/^(\d)\1{5}$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) return t('This PIN is too easy to guess: choose another')
  return null
}
/** an account made by the owner has an address nobody writes to: it is not shown */
export const isPinOnlyEmail = (email: string | null | undefined) => !!email && /@pin\.dris-ks\.com$/i.test(email)

export function useMyLogin() {
  const { user } = useAuth()
  return useQuery({ queryKey: ['my-login', user?.id], enabled: !!user, staleTime: 10 * 60_000,
    queryFn: async () => unwrap(await supabase.rpc('my_login')) as unknown as { username: string } | null })
}

/**
 * Everyone signs in with a user name and PIN. A person who still came in with email (before the
 * change) makes theirs now; from then on their email password no longer opens the program.
 */
export function LoginSetupGate() {
  const { isSuperAdmin } = useCompany()
  const mine = useMyLogin()
  if (isSuperAdmin || !mine.isSuccess || mine.data) return null
  return <MyLoginDialog first />
}

export function MyLoginDialog({ first, onClose }: { first?: boolean; onClose?: () => void }) {
  const { user } = useAuth()
  const mine = useMyLogin()
  const qc = useQueryClient()
  const name = (user?.user_metadata?.full_name as string | undefined) ?? ''
  const [username, setUsername] = React.useState(() => mine.data?.username ?? suggestUsername(name))
  const [old, setOld] = React.useState('')
  const [pin, setPin] = React.useState('')
  const [again, setAgain] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const save = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('my_login_set', { p_username: username, p_pin: pin, p_old_pin: first ? undefined : old })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['my-login'] })
      toast.success(first ? t('Done. From now on you sign in with {user} and your PIN.', { user: username }) : t('PIN changed'))
      onClose?.()
    },
    onError: (e) => setError(tServer(describeError(e))),
  })
  const problem = pin.length === 6 ? pinProblem(pin) : null
  const ok = usernameOk(username) && !pinProblem(pin) && pin === again && (first || old.length === 6)
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !first) onClose?.() }}>
      <DialogContent className="max-w-sm" hideClose={first} onEscapeKeyDown={(e) => first && e.preventDefault()} onPointerDownOutside={(e) => first && e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><KeyRound className="size-5 text-primary" /> {first ? t('Your user name and PIN') : t('Change my PIN')}</DialogTitle>
          <DialogDescription>{first
            ? t('DrisPRO no longer uses email to sign in. Choose a user name and a PIN of 6 digits: from now on you sign in with them, on any device.')
            : t('The new PIN works at once, on every device and on the shared till.')}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (ok) save.mutate() }}>
          <div className="grid gap-1.5"><Label htmlFor="ml-user">{t('User name')}</Label>
            <Input id="ml-user" autoCapitalize="none" spellCheck={false} value={username} onChange={(e) => { setUsername(cleanUsername(e.target.value)); setError(null) }} />
            {!usernameOk(username) && username.length > 0 && <p className="text-xs text-muted-foreground">{t('3 to 30 small letters or digits; a dot, a dash or _ also')}</p>}</div>
          {!first && <div className="grid gap-1.5"><Label htmlFor="ml-old">{t('Present PIN')}</Label>
            <Input id="ml-old" type="password" inputMode="numeric" autoComplete="current-password" className="text-center text-xl tracking-[0.4em]" value={old} onChange={(e) => { setOld(cleanPin(e.target.value)); setError(null) }} /></div>}
          <div className="grid gap-1.5"><Label htmlFor="ml-pin">{t('New PIN (6 digits)')}</Label>
            <Input id="ml-pin" type="password" inputMode="numeric" autoComplete="new-password" className="text-center text-xl tracking-[0.4em]" value={pin} onChange={(e) => { setPin(cleanPin(e.target.value)); setError(null) }} />
            {problem && <p className="text-xs text-destructive">{problem}</p>}</div>
          <div className="grid gap-1.5"><Label htmlFor="ml-again">{t('The same PIN again')}</Label>
            <Input id="ml-again" type="password" inputMode="numeric" autoComplete="new-password" className="text-center text-xl tracking-[0.4em]" value={again} onChange={(e) => { setAgain(cleanPin(e.target.value)); setError(null) }} />
            {again.length === 6 && pin !== again && <p className="text-xs text-destructive">{t('The two PINs are not the same')}</p>}</div>
          {error && <p className="text-[13px] text-destructive">{error}</p>}
          <DialogFooter className="mt-1">
            {!first && <Button type="button" variant="ghost" onClick={onClose}>{t('Cancel')}</Button>}
            <Button type="submit" disabled={!ok} loading={save.isPending}>{first ? t('Save and continue') : t('Change the PIN')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
