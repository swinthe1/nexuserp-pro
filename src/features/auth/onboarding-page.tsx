import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { Navigate, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { z } from 'zod'
import { useAuth } from '@/app/auth-provider'
import { useCompany } from '@/app/company-provider'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { t } from '@/i18n'
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

export function OnboardingPage() {
  const { user, loading } = useAuth()
  const { companies, switchCompany } = useCompany()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { name: '', legalName: '', country: 'AL', taxNumber: '' } })

  if (!loading && !user) return <Navigate to="/login" replace />
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
              <FormItem><FormLabel>{t('Trading name')}</FormLabel><FormControl><Input autoFocus placeholder="Dyqani Ylli" {...field} /></FormControl><FormMessage /></FormItem> // i18n-ignore
            )} />
            <FormField control={form.control} name="legalName" render={({ field }) => (
              <FormItem><FormLabel optional>{t('Legal name')}</FormLabel><FormControl><Input placeholder="Ylli sh.p.k." {...field} /></FormControl><FormMessage /></FormItem> // i18n-ignore
            )} />
            <FormField control={form.control} name="country" render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Country')}</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="AL">{t('Albania — ALL, VAT 20 / 6 / 0%')}</SelectItem>
                    <SelectItem value="XK">{t('Kosovo — EUR, VAT 18 / 8 / 0%')}</SelectItem>
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
