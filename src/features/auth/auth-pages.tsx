import { zodResolver } from '@hookform/resolvers/zod'
import * as React from 'react'
import { useForm } from 'react-hook-form'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { z } from 'zod'
import { useAuth } from '@/app/auth-provider'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { t } from '@/i18n'
import { describeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { getTill } from '@/lib/shared-till'
import { PinLogin } from './pin-login'

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
    <div className="mb-6">
      <h1 className="text-xl font-semibold tracking-[-0.01em]">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{sub}</p>
    </div>
  )
}

const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
})

export function LoginPage() {
  const [till] = React.useState(getTill)
  const [withEmail, setWithEmail] = React.useState(false)
  const toEmail = React.useCallback(() => setWithEmail(true), [])
  if (till && !withEmail) return <PinLogin till={till} onEmail={toEmail} />
  return <EmailLogin />
}

function EmailLogin() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/'
  const form = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } })

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
      <Heading title={t('Sign in')} sub={t('Accounts are made by the DrisPRO administrator. Ask your company\'s administrator if you do not have one.')} />
      <Form {...form}>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <FormField control={form.control} name="email" render={({ field }) => (
            <FormItem><FormLabel>{t('Work email')}</FormLabel><FormControl><Input type="email" autoComplete="email" autoFocus {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="password" render={({ field }) => (
            <FormItem>
              <div className="flex items-center justify-between">
                <FormLabel>{t('Password')}</FormLabel>
                <Link to="/forgot-password" className="text-xs text-muted-foreground hover:text-foreground">{t('Forgot password?')}</Link>
              </div>
              <FormControl><Input type="password" autoComplete="current-password" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <Button type="submit" loading={form.formState.isSubmitting} className="mt-1">{t('Sign in')}</Button>
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
            <FormItem><FormLabel>{t('Work email')}</FormLabel><FormControl><Input type="email" autoFocus {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <Button type="submit" loading={form.formState.isSubmitting}>{t('Send reset link')}</Button>
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
            <FormItem><FormLabel>{t('New password')}</FormLabel><FormControl><Input type="password" autoComplete="new-password" autoFocus {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <Button type="submit" loading={form.formState.isSubmitting}>{t('Update password')}</Button>
        </form>
      </Form>
    </>
  )
}
