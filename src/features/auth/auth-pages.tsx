import { zodResolver } from '@/lib/zod-resolver'
import { Eye, EyeOff } from 'lucide-react'
import * as React from 'react'
import { useForm } from 'react-hook-form'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { z } from 'zod/v3'
import { useAuth } from '@/app/auth-provider'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { t, tServer } from '@/i18n'
import { describeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { getTill } from '@/lib/shared-till'
import { DevicePairing } from './device-pairing'
import { PinLogin, finishPinSignIn } from './pin-login'

/** Sign-in errors from the auth service, in plain words. */
function authError(e: unknown): string {
  const m = (e as { message?: string } | null)?.message ?? ''
  if (/invalid login credentials/i.test(m)) return t('Email or password is incorrect')
  if (/email not confirmed/i.test(m)) return t('Confirm your email first: open the link we sent you.')
  if (/already registered|already been registered|user already exists/i.test(m)) return t('An account with this email already exists. Sign in instead.')
  if (/rate limit|too many/i.test(m)) return t('Too many attempts. Wait a minute and try again.')
  if (/password should be at least/i.test(m)) return t('Use at least 8 characters')
  if (/invitation only|database error saving new user|signups not allowed/i.test(m)) return t('This email has no invitation. Ask your company\'s administrator to invite you, then try again.')
  return describeError(e)
}

function Heading({ title, sub }: { title: string; sub: React.ReactNode }) {
  return (
    <div className="mb-7">
      <h2 className="text-2xl font-semibold tracking-[-0.02em]">{title}</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{sub}</p>
    </div>
  )
}

const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
})

export function LoginPage() {
  const [till] = React.useState(getTill)
  // the platform's administrator signs in at /login?admin (nothing on the page points there: clients never see it)
  const [mode, setMode] = React.useState<'till' | 'user' | 'admin'>(() => (new URLSearchParams(window.location.search).has('admin') ? 'admin' : till ? 'till' : 'user'))
  const toUser = React.useCallback(() => setMode('user'), [])
  if (till && mode === 'till') return <PinLogin till={till} onEmail={toUser} />
  if (mode === 'admin') return <EmailLogin onBack={toUser} />
  return <UserPinLogin onTill={till ? () => setMode('till') : undefined} />
}

/** everyone signs in with a user name and a PIN of 6 digits; the company's administrator gives them */
function UserPinLogin({ onTill }: { onTill?: () => void }) {
  const navigate = useNavigate()
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/'
  const [username, setUsername] = React.useState(() => { try { return localStorage.getItem('drispro.last-username') ?? '' } catch { return '' } })
  const [pin, setPin] = React.useState('')
  const [show, setShow] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  // the client lets only licensed devices work and this one has none (or its licence ran out)
  const [needDevice, setNeedDevice] = React.useState(() => new URLSearchParams(window.location.search).has('device'))
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!username.trim() || pin.length !== 6 || busy) return
    setBusy(true); setError(null)
    try {
      const { data, error: err } = await supabase.rpc('login_with_pin', { p_username: username.trim(), p_pin: pin })
      if (err) throw err
      const r = data as unknown as { error?: string; request?: string; secret?: string; device?: boolean }
      if (r.device) { setNeedDevice(true); setPin(''); return }
      if (r.error) { setError(tServer(r.error)); setPin(''); return }
      await finishPinSignIn(r.request!, r.secret!)
      try { localStorage.setItem('drispro.last-username', username.trim().toLowerCase()) } catch { /* private window */ }
      navigate(from, { replace: true })
    } catch (x) { setError(tServer(describeError(x))); setPin('') } finally { setBusy(false) }
  }
  return (
    <>
      <Heading title={t('Welcome back')} sub={t('Sign in with your user name and PIN. The administrator of your company gives them.')} />
      {needDevice ? <div className="mb-4"><DevicePairing onLicensed={() => setNeedDevice(false)} /></div> : null}
      <form onSubmit={(e) => void submit(e)} className="grid gap-4" noValidate>
        <div className="grid gap-1.5">
          <label htmlFor="li-user" className="text-sm font-medium">{t('User name')}</label>
          <Input id="li-user" autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus={!username} className="h-11"
            value={username} onChange={(e) => { setUsername(e.target.value.replace(/\s/g, '')); setError(null) }} placeholder={t('e.g. arben.krasniqi')} />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="li-pin" className="text-sm font-medium">{t('PIN')}</label>
          <div className="relative">
            <Input id="li-pin" type={show ? 'text' : 'password'} inputMode="numeric" autoComplete="current-password" autoFocus={!!username}
              className="h-11 pr-11 text-lg tracking-[0.4em]" value={pin} maxLength={6}
              onChange={(e) => { setPin(e.target.value.replace(/\D/g, '').slice(0, 6)); setError(null) }} />
            <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? t('Hide the PIN') : t('Show the PIN')} aria-pressed={show}
              className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          <p className={error ? 'text-[13px] text-destructive' : 'text-xs text-muted-foreground'}>{error ?? t('6 digits. Forgot it? The administrator of your company gives a new one.')}</p>
        </div>
        <Button type="submit" size="lg" loading={busy} disabled={!username.trim() || pin.length !== 6} className="mt-1 h-11 w-full text-[15px]">{t('Sign in')}</Button>
      </form>
      {onTill ? <div className="mt-8 text-xs text-muted-foreground">
        <button type="button" onClick={onTill} className="hover:text-foreground hover:underline">{t('Pick my name on this till')}</button>
      </div> : null}
    </>
  )
}

function EmailLogin({ onBack }: { onBack: () => void }) {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/'
  const form = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } })
  const [show, setShow] = React.useState(false)

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await signIn(v.email, v.password)
      navigate(from, { replace: true })
    } catch (e) {
      form.setError('password', { message: authError(e) })
    }
  })

  return (
    <>
      <Heading title={t('Platform administrator')} sub={<button type="button" onClick={onBack} className="text-primary hover:underline">{t('Back to the sign-in with a user name')}</button>} />
      <Form {...form}>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <FormField control={form.control} name="email" render={({ field }) => (
            <FormItem><FormLabel>{t('Work email')}</FormLabel><FormControl><Input type="email" autoComplete="email" inputMode="email" autoFocus className="h-11" placeholder={t('name@company.com')} {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="password" render={({ field }) => (
            <FormItem>
              <div className="flex items-center justify-between">
                <FormLabel>{t('Password')}</FormLabel>
                <Link to="/forgot-password" className="text-xs font-medium text-primary hover:underline">{t('Forgot password?')}</Link>
              </div>
              <div className="relative">
                <FormControl><Input type={show ? 'text' : 'password'} autoComplete="current-password" className="h-11 pr-11" {...field} /></FormControl>
                <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? t('Hide password') : t('Show password')} aria-pressed={show}
                  className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              <FormMessage />
            </FormItem>
          )} />
          <Button type="submit" size="lg" loading={form.formState.isSubmitting} className="mt-2 h-11 w-full text-[15px]">{t('Sign in')}</Button>
        </form>
      </Form>
    </>
  )
}

const passwordSchema = z.object({
  password: z.string().min(8, 'Use at least 8 characters').regex(/[0-9]/, 'Include at least one number'),
})

export function ForgotPasswordPage() {
  const { sendPasswordReset } = useAuth()
  const [sent, setSent] = React.useState(false)
  const form = useForm<{ email: string }>({ resolver: zodResolver(z.object({ email: z.string().trim().email('Enter a valid email address') })), defaultValues: { email: '' } })
  const onSubmit = form.handleSubmit(async (v) => {
    try { await sendPasswordReset(v.email); setSent(true) } catch (e) { form.setError('email', { message: authError(e) }) }
  })
  if (sent) return <Heading title={t('Check your inbox')} sub={t('If an account exists for that email, a reset link is on its way.')} />
  return (
    <>
      <Heading title={t('Reset your password')} sub={<Link to="/login" className="text-primary hover:underline">{t('Back to sign in')}</Link>} />
      <Form {...form}>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <FormField control={form.control} name="email" render={({ field }) => (
            <FormItem><FormLabel>{t('Work email')}</FormLabel><FormControl><Input type="email" autoFocus className="h-11" {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <Button type="submit" size="lg" className="h-11 w-full" loading={form.formState.isSubmitting}>{t('Send reset link')}</Button>
        </form>
      </Form>
    </>
  )
}

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const form = useForm<{ password: string }>({ resolver: zodResolver(passwordSchema), defaultValues: { password: '' } })
  const onSubmit = form.handleSubmit(async (v) => {
    const { error } = await supabase.auth.updateUser({ password: v.password })
    if (error) return form.setError('password', { message: authError(error) })
    toast.success(t('Password updated'))
    navigate('/')
  })
  return (
    <>
      <Heading title={t('Choose a new password')} sub={t('Use at least 8 characters, including a number.')} />
      <Form {...form}>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <FormField control={form.control} name="password" render={({ field }) => (
            <FormItem><FormLabel>{t('New password')}</FormLabel><FormControl><Input type="password" autoComplete="new-password" autoFocus className="h-11" {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <Button type="submit" size="lg" className="h-11 w-full" loading={form.formState.isSubmitting}>{t('Update password')}</Button>
        </form>
      </Form>
    </>
  )
}
