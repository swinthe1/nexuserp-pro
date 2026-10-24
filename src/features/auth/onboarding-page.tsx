import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import type * as React from 'react'
import { useForm } from 'react-hook-form'
import { Clock, LogOut, ShieldAlert } from 'lucide-react'
import { Navigate, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { z } from 'zod'
import { useAuth } from '@/app/auth-provider'
import { type BlockedCompany, useCompany } from '@/app/company-provider'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { t } from '@/i18n'
import { LanguageToggle } from '@/i18n/language'
import { formatDate } from '@/lib/utils'
import { describeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

const schema = z.object({
  name: z.string().trim().min(2, 'Enter the company name'),
  legalName: z.string().trim().optional(),
  country: z.enum(['AL', 'XK']),
  taxNumber: z.string().trim()
    .regex(/^$|^[A-Z][0-9]{8}[A-Z]$|^[0-9]{9}$/, 'NIPT looks like L91234567A; NUI is 9 digits')
    .optional(),
})
type Values = z.infer<typeof schema>

function blockedText(b: BlockedCompany) {
  if (b.reason === 'suspended') return t('Access to {company} is paused by your provider.', { company: b.name })
  if (b.reason === 'not_started') return t('The licence for {company} has not started yet.', { company: b.name })
  if (b.reason === 'expired' && b.valid_until) return t('The licence for {company} ended on {date}.', { company: b.name, date: formatDate(b.valid_until) })
  return t('{company} has no active licence.', { company: b.name })
}

/** Shown instead of the app when the person has no company to work in. */
function AccessScreen({ icon: Icon, title, children }: { icon: typeof Clock; title: string; children: React.ReactNode }) {
  const { signOut, user } = useAuth()
  const qc = useQueryClient()
  return (
    <div className="relative flex min-h-dvh items-center justify-center bg-sidebar px-6 py-12">
      <LanguageToggle className="absolute right-4 top-4" />
      <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-sm">
        <Icon className="size-6 text-muted-foreground" />
        <h1 className="mt-3 text-xl font-semibold tracking-[-0.01em]">{title}</h1>
        <div className="mt-2 space-y-2 text-sm text-muted-foreground">{children}</div>
        <p className="mt-4 text-xs text-muted-foreground">{t('Signed in as {email}', { email: user?.email ?? '' })}</p>
        <div className="mt-5 flex gap-2">
          <Button variant="outline" onClick={() => void qc.invalidateQueries({ queryKey: ['my-context'] })}>{t('Check again')}</Button>
          <Button variant="ghost" onClick={() => void signOut()}><LogOut /> {t('Sign out')}</Button>
        </div>
      </div>
    </div>
  )
}

export function OnboardingPage() {
  const { user, loading } = useAuth()
  const { companies, switchCompany, isSuperAdmin, selfService, blocked, loading: ctxLoading } = useCompany()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { name: '', legalName: '', country: 'XK', taxNumber: '' } })

  if (!loading && !user) return <Navigate to="/login" replace />
  if (loading || ctxLoading) return <div className="min-h-dvh bg-sidebar" />
  // clients are created from the platform page, together with their admin and licence
  if (isSuperAdmin) return <Navigate to="/platform?new=1" replace />
  if (!selfService) {
    if (companies.length) return <Navigate to="/" replace />
    if (blocked.length) {
      return (
        <AccessScreen icon={Clock} title={t('Your company is on hold')}>
          {blocked.map((b) => <p key={b.id}>{blockedText(b)}</p>)}
          <p>{t('Your data is kept safe. Contact your provider to renew the licence, then sign in again.')}</p>
        </AccessScreen>
      )
    }
    return (
      <AccessScreen icon={ShieldAlert} title={t('No company yet')}>
        <p>{t('Your account is not linked to a company. Ask your company\'s administrator to invite this email address, then click Check again.')}</p>
      </AccessScreen>
    )
  }
  const country = form.watch('country')

  const onSubmit = form.handleSubmit(async (v) => {
    const { data, error } = await supabase.rpc('create_company', {
      p_name: v.name, p_country_code: v.country, p_tax_number: v.taxNumber || undefined, p_legal_name: v.legalName || undefined,
    })
    if (error) return form.setError('name', { message: describeError(error) })
    await qc.invalidateQueries({ queryKey: ['my-context'] })
    await switchCompany(data)
    toast.success(t('{name} is ready', { name: v.name }), { description: t('We set up a main warehouse, VAT codes, units and a financial year.') })
    navigate('/')
  })

  return (
    <div className="flex min-h-dvh items-center justify-center bg-sidebar px-6 py-12">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-sm">
        <h1 className="text-xl font-semibold tracking-[-0.01em]">{companies.length ? t('Add a company') : t('Set up your company')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("You'll be its admin. You can invite colleagues afterwards.")}</p>
        <Form {...form}>
          <form onSubmit={onSubmit} className="mt-6 grid gap-4" noValidate>
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem><FormLabel>{t('Trading name')}</FormLabel><FormControl><Input autoFocus placeholder="Dyqani Drita" {...field} /></FormControl><FormMessage /></FormItem> // i18n-ignore
            )} />
            <FormField control={form.control} name="legalName" render={({ field }) => (
              <FormItem><FormLabel optional>{t('Legal name')}</FormLabel><FormControl><Input placeholder={form.watch('country') === 'XK' ? 'Drita L.L.C.' : 'Drita sh.p.k.'} {...field} /></FormControl><FormMessage /></FormItem> // i18n-ignore
            )} />
            <FormField control={form.control} name="country" render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Country')}</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="XK">{t('Kosovo — EUR, VAT 18 / 8 / 0%')}</SelectItem>
                    <SelectItem value="AL">{t('Albania — ALL, VAT 20 / 6 / 0%')}</SelectItem>
                  </SelectContent>
                </Select>
                <FormDescription>{t('Sets the main currency, VAT codes and fiscalization rules.')}</FormDescription>
              </FormItem>
            )} />
            <FormField control={form.control} name="taxNumber" render={({ field }) => (
              <FormItem><FormLabel optional>{country === 'AL' ? 'NIPT' : 'NUI'}</FormLabel><FormControl><Input placeholder={country === 'AL' ? 'L91234567A' : '811234567'} {...field} onChange={(e) => field.onChange(e.target.value.toUpperCase())} /></FormControl><FormMessage /></FormItem>
            )} />
            <div className="mt-2 flex gap-2">
              {companies.length > 0 && <Button type="button" variant="outline" onClick={() => navigate(-1)}>{t('Cancel')}</Button>}
              <Button type="submit" className="flex-1" loading={form.formState.isSubmitting}>{t('Create company')}</Button>
            </div>
          </form>
        </Form>
      </div>
    </div>
  )
}
