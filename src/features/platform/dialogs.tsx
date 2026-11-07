import { zodResolver } from '@hookform/resolvers/zod'
import { Cable, Copy, Download, GraduationCap, Network, Plus, Store, Trash2, UserPlus, X } from 'lucide-react'
import * as React from 'react'
import { supabase, supabaseAnonKey, supabaseUrl } from '@/lib/supabase'
import { useFieldArray, useForm } from 'react-hook-form'
import { AgentLogSheet } from '@/features/settings/components/agent-log'
import { toast } from 'sonner'
import { z } from 'zod'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { msg, t, td, tEnum, tn } from '@/i18n'
import { describeError } from '@/lib/errors'
import { daysUntil, LICENSE_WARNING_DAYS } from '@/lib/license'
import { cn, formatDate, formatQty as formatInt, todayISO } from '@/lib/utils'
import { generatePassword, type PlatformClient, type SyncConnection, useCreateClient, useCreateSyncKey, useSaveLicense, useSetPassword, useSetSyncActive, useSetTraining, useSetBusinessType, useSetMultiUnit, useDeleteClient, useCreateAccount } from './api'
import { Checkbox } from '@/components/ui/checkbox'
import { BUSINESS_TYPES, businessTypeLabel } from './business-types'
import { Label } from '@/components/ui/label'
import { FEATURES, PAID_MODULES, PLAN_FEATURES, PLAN_STORES, packageOf, type Feature, type PackageKey } from '@/lib/plans'
import { PackagePicker, packageDefaults, packageLimits, type PackageValue } from './package-fields'

export const PLANS = [
  { value: 'basic', label: msg('Basic') },
  { value: 'standard', label: msg('Standard') },
  { value: 'pro', label: msg('Pro') },
]
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function PlanIncludesWatch({ form }: { form: any }) {
  const plan = (form.watch('plan') as string | undefined) ?? 'pro'
  return <PlanIncludes plan={plan} />
}

/** What a plan includes, under the plan picker. */
export function PlanIncludes({ plan }: { plan: string }) {
  const included = PLAN_FEATURES[plan] ?? PLAN_FEATURES.pro
  const stores = PLAN_STORES[plan]
  return (
    <div className="col-span-2 -mt-1 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{t('Till, stock, buying, selling, VAT, cash and bank')}</span>
      {included.length > 0 && <> + {included.map((f) => t(FEATURES.find((x) => x.key === f)!.label)).join(', ')}</>}
      {'. '}{stores ? tn(stores, 'Up to {n} store or warehouse.', 'Up to {n} stores or warehouses.') : t('Any number of stores and warehouses.')}
    </div>
  )
}

export function planLabel(plan: string | null, pkg?: string | null) {
  if (!plan) return '—'
  if (plan === 'package') { const p = packageOf(pkg); return p ? t(p.label) : t('Package') }
  if (plan === 'trial') return t('Trial')
  const p = PLANS.find((x) => x.value === plan)
  return p ? t(p.label) : plan
}

export function addMonths(iso: string, months: number) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1 + months, d))
  return dt.toISOString().slice(0, 10)
}

export type LicenseState = { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary'; rank: number }
export function licenseState(c: PlatformClient): LicenseState {
  if (!c.valid_until || !c.status) return { label: t('No licence'), variant: 'destructive', rank: 0 }
  if (c.status === 'suspended') return { label: t('Paused'), variant: 'destructive', rank: 1 }
  const days = daysUntil(c.valid_until)
  if (days < 0) return { label: t('Expired'), variant: 'destructive', rank: 2 }
  if (c.valid_from && daysUntil(c.valid_from) > 0) return { label: t('Starts {date}', { date: formatDate(c.valid_from) }), variant: 'secondary', rank: 4 }
  if (days <= LICENSE_WARNING_DAYS) return { label: days === 0 ? t('Ends today') : tn(days, 'Ends in {n} day', 'Ends in {n} days'), variant: 'warning', rank: 3 }
  return { label: t('Active'), variant: 'success', rank: 5 }
}

export async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); toast.success(t('Copied')) } catch { toast.error(t('Could not copy. Select the text and copy it by hand.')) }
}

/* ------------------------------------------------------------------ the windows of the console */

/* ------------------------------------------------------------------ new client */

const UNIT_KINDS = ['store', 'warehouse', 'production'] as const

const clientSchema = z.object({
  name: z.string().trim().min(2, 'Enter the company name'),
  legal_name: z.string().trim().optional(),
  country: z.enum(['XK', 'AL']),
  tax_number: z.string().trim().regex(/^$|^[A-Z][0-9]{8}[A-Z]$|^[0-9]{9}$/, 'NIPT looks like L91234567A; NUI is 9 digits').optional(),
  business_type: z.string().min(1),
  owner_name: z.string().trim().optional(),
  owner_email: z.string().trim().email('Enter a valid email address'),
  owner_password: z.string().min(8, 'Use at least 8 characters'),
  plan: z.string().min(1),
  max_users: z.coerce.number().int('Enter a whole number').min(1, 'At least 1 user'),
  valid_from: z.string().min(1, 'Choose a date'),
  valid_until: z.string().min(1, 'Choose a date'),
  notes: z.string().optional(),
  multi_unit: z.boolean(),
  unit_kind: z.string(),
  units: z.array(z.object({ code: z.string().trim(), name: z.string().trim(), kind: z.string(), city: z.string().trim() })),
}).refine((v) => v.valid_until >= v.valid_from, { path: ['valid_until'], message: msg('The end date is before the start date') })
  .refine((v) => !v.multi_unit || v.units.filter((u) => u.name).length >= 2, { path: ['units'], message: msg('Write at least two units, or choose one unit') })
type ClientValues = z.infer<typeof clientSchema>

export function NewClientDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const create = useCreateClient()
  const [done, setDone] = React.useState<ClientValues | null>(null)
  const defaults = React.useCallback((): ClientValues => ({
    name: '', legal_name: '', country: 'XK', tax_number: '', business_type: 'retail', owner_name: '', owner_email: '', owner_password: generatePassword(),
    plan: 'standard', max_users: 5, valid_from: todayISO(), valid_until: addMonths(todayISO(), 12), notes: '',
    multi_unit: false, unit_kind: 'store', units: [{ code: 'N1', name: '', kind: 'store', city: '' }, { code: 'N2', name: '', kind: 'store', city: '' }],
  }), [])
  const form = useForm<ClientValues>({ resolver: zodResolver(clientSchema), defaultValues: defaults() })
  // the package decides the modules and the limits; the type of business follows it
  const [pkg, setPkg] = React.useState<PackageValue>(() => packageDefaults('retail_mini'))
  React.useEffect(() => { if (open) { form.reset(defaults()); setDone(null); setPkg(packageDefaults('retail_mini')) } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const country = form.watch('country')
  const multi = form.watch('multi_unit')
  const unitRows = useFieldArray({ control: form.control, name: 'units' })

  const submit = form.handleSubmit(async (v) => {
    try {
      const units = v.multi_unit ? v.units.filter((u) => u.name).map((u, i) => ({ ...u, code: u.code || `N${i + 1}`, city: u.city || undefined })) : undefined
      const p = packageOf(pkg.key)
      if (!p) { form.setError('name', { message: t('Choose the package') }); return }
      const lim = packageLimits(pkg)
      if (lim.max_stores != null && (units?.length ?? 1) > lim.max_stores) { form.setError('units', { message: t('The package allows {n} units: raise the limit, or write fewer units', { n: lim.max_stores }) }); return }
      await create.mutateAsync({ ...v, owner_email: v.owner_email.toLowerCase(), units, plan: 'package', business_type: p.businessType, package: p.key,
        modules: pkg.modules, max_stores: lim.max_stores, max_tills: lim.max_tills, max_users: lim.max_users })
      setDone(v)
    } catch (e) {
      const m = describeError(e)
      form.setError(/tax|NIPT|NUI/i.test(m) ? 'tax_number' : /password|fjalëkalim/i.test(m) ? 'owner_password' : /email/i.test(m) ? 'owner_email' : 'name', { message: m })
    }
  })

  const welcome = done ? [
    t('Your DrisPRO account is ready.'),
    `${t('Address')}: ${window.location.origin}`,
    `${t('Email')}: ${done.owner_email.toLowerCase()}`,
    `${t('Password')}: ${done.owner_password}`,
    t('Change the password after the first sign-in: click your initials at the top right, then Change password.'),
  ].join('\n') : ''

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-xl overflow-y-auto">
        {done ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('{name} is ready', { name: done.name })}</DialogTitle>
              <DialogDescription>{t('Send these sign-in details to the client. The password is shown only now.')}</DialogDescription>
            </DialogHeader>
            <pre className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3 font-sans text-sm">{welcome}</pre>
            <DialogFooter>
              <Button variant="outline" onClick={() => void copy(welcome)}><Copy /> {t('Copy')}</Button>
              <Button onClick={() => onOpenChange(false)}>{t('Done')}</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t('New client')}</DialogTitle>
              <DialogDescription>{t('Creates the company with its units, VAT codes and financial year, the administrator account and the licence.')}</DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={submit} className="grid grid-cols-2 gap-3" noValidate>
                <p className="col-span-2 text-xs font-medium text-muted-foreground">{t('Company')}</p>
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem className="col-span-2 sm:col-span-1"><FormLabel>{t('Trading name')}</FormLabel><FormControl><Input autoFocus placeholder="Dyqani Drita" {...field} /></FormControl><FormMessage /></FormItem> // i18n-ignore
                )} />
                <FormField control={form.control} name="legal_name" render={({ field }) => (
                  <FormItem className="col-span-2 sm:col-span-1"><FormLabel optional>{t('Legal name')}</FormLabel><FormControl><Input placeholder={country === 'XK' ? 'Drita L.L.C.' : 'Drita sh.p.k.'} {...field} /></FormControl><FormMessage /></FormItem> // i18n-ignore
                )} />
                <FormField control={form.control} name="country" render={({ field }) => (
                  <FormItem className="col-span-2 sm:col-span-1"><FormLabel>{t('Country')}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="XK">{t('Kosovo — EUR, VAT 18 / 8 / 0%')}</SelectItem>
                        <SelectItem value="AL">{t('Albania — ALL, VAT 20 / 6 / 0%')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
                <FormField control={form.control} name="tax_number" render={({ field }) => (
                  <FormItem className="col-span-2 sm:col-span-1"><FormLabel optional>{country === 'AL' ? 'NIPT' : 'NUI'}</FormLabel>
                    <FormControl><Input placeholder={country === 'AL' ? 'L91234567A' : '811234567'} {...field} onChange={(e) => field.onChange(e.target.value.toUpperCase())} /></FormControl><FormMessage /></FormItem>
                )} />

                <p className="col-span-2 mt-2 text-xs font-medium text-muted-foreground">{t('Package: the kind of business, its modules and its limits')}</p>
                <PackagePicker value={pkg} onChange={setPkg} />

                {/* one unit or several: decides how the program treats the client */}
                <p className="col-span-2 mt-2 text-xs font-medium text-muted-foreground">{t('Units of the business')}</p>
                <div className="col-span-2 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t('Units of the business')}>
                  {[{ v: false, icon: Store, title: t('One unit'), text: t('One shop, restaurant or office. The program does not talk about units at all.') },
                    { v: true, icon: Network, title: t('Several units'), text: t('Several shops, restaurants or warehouses under the same NUI. Each has its stock, tills and results.') }].map((o) => (
                    <button key={String(o.v)} type="button" role="radio" aria-checked={multi === o.v} onClick={() => form.setValue('multi_unit', o.v, { shouldValidate: true })}
                      className={cn('flex items-start gap-2.5 rounded-md border p-3 text-left transition-colors', multi === o.v ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted/50')}>
                      <o.icon className={cn('mt-0.5 size-4 shrink-0', multi === o.v ? 'text-primary' : 'text-muted-foreground')} />
                      <span><span className="block text-sm font-medium">{o.title}</span><span className="block text-[12px] leading-snug text-muted-foreground">{o.text}</span></span>
                    </button>
                  ))}
                </div>
                {!multi ? (
                  <FormField control={form.control} name="unit_kind" render={({ field }) => (
                    <FormItem className="col-span-2 sm:col-span-1"><FormLabel>{t('Kind of the unit')}</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>{UNIT_KINDS.map((k) => <SelectItem key={k} value={k}>{tEnum(`wh_${k}`)}</SelectItem>)}</SelectContent>
                      </Select>
                      <FormDescription>{t('It carries the trading name.')}</FormDescription>
                    </FormItem>
                  )} />
                ) : (
                  <div className="col-span-2 grid gap-1.5">
                    <div className="grid grid-cols-[72px_minmax(0,1fr)_118px_minmax(0,0.7fr)_32px] gap-1.5 text-[12px] text-muted-foreground">
                      <span>{t('Code')}</span><span>{t('Name')}</span><span>{t('Kind|unit')}</span><span>{t('Town')}</span><span />
                    </div>
                    {unitRows.fields.map((f, i) => (
                      <div key={f.id} className="grid grid-cols-[72px_minmax(0,1fr)_118px_minmax(0,0.7fr)_32px] gap-1.5">
                        <Input aria-label={t('Code')} {...form.register(`units.${i}.code`)} onChange={(e) => form.setValue(`units.${i}.code`, e.target.value.toUpperCase())} className="font-mono uppercase" />
                        <Input aria-label={t('Name')} placeholder={i === 0 ? t('e.g. Market 1 – Drenas') : undefined} {...form.register(`units.${i}.name`)} />
                        <Select value={form.watch(`units.${i}.kind`)} onValueChange={(v) => form.setValue(`units.${i}.kind`, v)}>
                          <SelectTrigger aria-label={t('Kind|unit')}><SelectValue /></SelectTrigger>
                          <SelectContent>{UNIT_KINDS.map((k) => <SelectItem key={k} value={k}>{tEnum(`wh_${k}`)}</SelectItem>)}</SelectContent>
                        </Select>
                        <Input aria-label={t('Town')} {...form.register(`units.${i}.city`)} />
                        <Button type="button" variant="ghost" size="icon" className="size-9" disabled={unitRows.fields.length <= 2} onClick={() => unitRows.remove(i)} aria-label={t('Remove')}><X /></Button>
                      </div>
                    ))}
                    <div className="flex items-center justify-between gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => unitRows.append({ code: `N${unitRows.fields.length + 1}`, name: '', kind: 'store', city: '' })}><Plus /> {t('Add a unit')}</Button>
                      <span className="text-[12px] text-muted-foreground">{t('The licence allows as many units as written here. The number at ATK and the address are added on each unit later.')}</span>
                    </div>
                    {form.formState.errors.units?.message && <p className="text-[13px] text-destructive">{t(form.formState.errors.units.message)}</p>}
                  </div>
                )}

                <p className="col-span-2 mt-2 text-xs font-medium text-muted-foreground">{t('Administrator of the client')}</p>
                <FormField control={form.control} name="owner_name" render={({ field }) => (
                  <FormItem className="col-span-2 sm:col-span-1"><FormLabel optional>{t('Full name')}</FormLabel><FormControl><Input autoComplete="off" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="owner_email" render={({ field }) => (
                  <FormItem className="col-span-2 sm:col-span-1"><FormLabel>{t('Email')}</FormLabel><FormControl><Input type="email" autoComplete="off" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="owner_password" render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>{t('Password')}</FormLabel>
                    <div className="flex gap-2">
                      <FormControl><Input autoComplete="new-password" className="font-mono" {...field} /></FormControl>
                      <Button type="button" variant="outline" onClick={() => form.setValue('owner_password', generatePassword(), { shouldValidate: true })}>{t('New password')}</Button>
                    </div>
                    <FormDescription>{t('If this email already has an account, it keeps its current password.')}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />

                <p className="col-span-2 mt-2 text-xs font-medium text-muted-foreground">{t('Licence')}</p>
                <LicenseFields form={form} packaged />
                <DialogFooter className="col-span-2 mt-1">
                  <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('Cancel')}</Button>
                  <Button type="submit" loading={form.formState.isSubmitting}>{t('Create client')}</Button>
                </DialogFooter>
              </form>
            </Form>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ licence fields, shared */

type LicenseShape = { plan: string; max_users: number; valid_from: string; valid_until: string; notes?: string | null }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function LicenseFields({ form, packaged }: { form: any; packaged?: boolean }) {
  const extend = (months: number) => {
    const until: string = form.getValues('valid_until')
    const base = until && until > todayISO() ? until : todayISO()
    form.setValue('valid_until', addMonths(base, months), { shouldValidate: true, shouldDirty: true })
  }
  return (
    <>
      {!packaged && <FormField control={form.control} name="plan" render={({ field }: { field: { value: string; onChange: (v: string) => void } }) => (
        <FormItem className="col-span-1"><FormLabel>{t('Plan')}</FormLabel>
          <Select value={field.value} onValueChange={field.onChange}>
            <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
            <SelectContent>
              {PLANS.map((p) => <SelectItem key={p.value} value={p.value}>{t(p.label)}</SelectItem>)}
              {field.value === 'trial' && <SelectItem value="trial">{t('Trial')}</SelectItem>}
            </SelectContent>
          </Select>
        </FormItem>
      )} />}
      {!packaged && <FormField control={form.control} name="max_users" render={({ field }: { field: object }) => (
        <FormItem className="col-span-1"><FormLabel>{t('Maximum users')}</FormLabel><FormControl><Input type="number" min={1} step={1} className="tabular" {...field} /></FormControl><FormMessage /></FormItem>
      )} />}
      <FormField control={form.control} name="valid_from" render={({ field }: { field: object }) => (
        <FormItem className="col-span-1"><FormLabel>{t('Valid from')}</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
      )} />
      <FormField control={form.control} name="valid_until" render={({ field }: { field: object }) => (
        <FormItem className="col-span-1"><FormLabel>{t('Valid until')}</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
      )} />
      <div className="col-span-2 -mt-1 flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => extend(1)}>{t('+1 month')}</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => extend(6)}>{t('+6 months')}</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => extend(12)}>{t('+1 year')}</Button>
      </div>
      {!packaged && <PlanIncludesWatch form={form} />}
      <FormField control={form.control} name="notes" render={({ field }: { field: { value?: string | null } }) => (
        <FormItem className="col-span-2"><FormLabel optional>{t('Internal notes')}</FormLabel>
          <FormControl><Textarea rows={2} placeholder={t('Contract number, price, contact person…')} {...field} value={field.value ?? ''} /></FormControl>
          <FormDescription>{t('Only you see these notes.')}</FormDescription>
        </FormItem>
      )} />
    </>
  )
}

/* ------------------------------------------------------------------ change licence */

const licenseSchema = z.object({
  plan: z.string().min(1),
  max_users: z.coerce.number().int('Enter a whole number').min(1, 'At least 1 user'),
  valid_from: z.string().min(1, 'Choose a date'),
  valid_until: z.string().min(1, 'Choose a date'),
  status: z.enum(['active', 'suspended']),
  notes: z.string().nullable().optional(),
}).refine((v) => v.valid_until >= v.valid_from, { path: ['valid_until'], message: msg('The end date is before the start date') })
type LicenseValues = z.infer<typeof licenseSchema> & LicenseShape

export function LicenseDialog({ client, onClose }: { client: PlatformClient | null; onClose: () => void }) {
  const save = useSaveLicense()
  const form = useForm<LicenseValues>({ resolver: zodResolver(licenseSchema) })
  const plan = form.watch('plan') ?? 'pro'
  const [extras, setExtras] = React.useState<string[]>([])
  const [maxStores, setMaxStores] = React.useState('')
  // the package: the client's own, or none yet (an older plan, kept until a package is chosen)
  const blankPkg = (): PackageValue => ({ key: '', modules: [], stores: '', tills: '', users: '' })
  const [pkg, setPkgRaw] = React.useState<PackageValue>(blankPkg)
  const current = (client?.modules ?? []) as Feature[]
  const setPkg = (v: PackageValue) => {
    if (!client || !v.key) { setPkgRaw(v); return }
    // from an older plan to a package: the client keeps every module he has (he can be trimmed after); the limits never below what he uses
    if (!pkg.key && client.plan !== 'package') {
      const d = packageDefaults(v.key as PackageKey)
      const atLeast = (lim: string, used: number) => (lim === '' ? '' : String(Math.max(Number(lim), used)))
      setPkgRaw({ ...d, modules: current.length ? [...current] : d.modules, stores: atLeast(d.stores, client.units ?? 1), tills: atLeast(d.tills, client.tills ?? 0),
        users: String(Math.max(Number(d.users), client.users)) })
      return
    }
    setPkgRaw(v)
  }
  React.useEffect(() => {
    if (client) {
      setPkgRaw(client.plan === 'package' && client.package ? { key: client.package as PackageKey, modules: (client.modules ?? client.extra_features ?? []) as Feature[],
        stores: client.max_warehouses ? String(client.max_warehouses) : '', tills: client.max_registers ? String(client.max_registers) : '', users: String(client.max_users ?? 5) } : blankPkg())
    }
    if (client) { setExtras(client.extra_features ?? []); setMaxStores(client.max_warehouses ? String(client.max_warehouses) : '') }
    if (client) form.reset({
      plan: client.plan ?? 'standard', max_users: client.max_users ?? 5, valid_from: client.valid_from ?? todayISO(),
      valid_until: client.valid_until ?? addMonths(todayISO(), 12), status: client.status ?? 'active', notes: client.notes ?? '',
    })
  }, [client]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = form.handleSubmit(async (v) => {
    if (!client) return
    if (v.max_users < client.users) {
      form.setError('max_users', { message: tn(client.users, '{n} person already uses this company. Remove people first or keep the limit higher.', '{n} people already use this company. Remove people first or keep the limit higher.') })
      return
    }
    try {
      if (pkg.key) {
        const p = packageOf(pkg.key)!
        const lim = packageLimits(pkg)
        if (lim.max_users < client.users) { toast.error(tn(client.users, '{n} person already uses this company. Remove people first or keep the limit higher.', '{n} people already use this company. Remove people first or keep the limit higher.')); return }
        await save.mutateAsync({ company: client.id, ...v, plan: 'package', max_users: lim.max_users,
          package: { key: p.key, modules: pkg.modules, max_stores: lim.max_stores, max_tills: lim.max_tills, apply_type: p.businessType !== (client.business_type ?? 'general') } })
        toast.success(t('Licence saved for {name}', { name: client.name }))
        onClose()
        return
      }
      const inPlan = PLAN_FEATURES[v.plan] ?? PLAN_FEATURES.pro
      await save.mutateAsync({ company: client.id, ...v, extra_features: extras.filter((f) => !inPlan.includes(f as Feature)), max_warehouses: maxStores ? Number(maxStores) : null })
      toast.success(t('Licence saved for {name}', { name: client.name }))
      onClose()
    } catch (e) { form.setError('plan', { message: describeError(e) }) }
  })

  return (
    <Dialog open={!!client} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('Licence for {name}', { name: client?.name ?? '' })}</DialogTitle>
          <DialogDescription>{t('Outside the licence period, or while paused, the client\'s people cannot open the company. Their data is kept.')}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} className="grid grid-cols-2 gap-3" noValidate>
            <PackagePicker value={pkg} onChange={setPkg} legacy={client && client.plan !== 'package' ? planLabel(client.plan) : null} />
            {pkg.key && client?.plan !== 'package' && <p className="col-span-2 -mt-1 rounded-md bg-muted/60 px-3 py-2 text-[12.5px] text-muted-foreground">
              {t('The client moves from the older plan to this package and keeps every module he has now. Take off what he does not use.')}</p>}
            {pkg.key && client && packageOf(pkg.key)!.businessType !== (client.business_type ?? 'general') && <p className="col-span-2 -mt-1 text-[12.5px] text-warning">
              {t('The kind of business changes too: the client\'s menu starts again from that kind.')}</p>}
            <LicenseFields form={form} packaged={!!pkg.key} />
            {!pkg.key && (PLAN_FEATURES[plan] ?? PLAN_FEATURES.pro).length < FEATURES.length - PAID_MODULES.length && (
              <fieldset className="col-span-2 grid gap-2 rounded-md border p-3">
                <legend className="px-1 text-[13px] font-medium">{t('Extra modules for this client')}</legend>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {FEATURES.filter((f) => f.plan !== 'paid' && !(PLAN_FEATURES[plan] ?? []).includes(f.key)).map((f) => (
                    <label key={f.key} className="flex items-center gap-2 text-[13px]">
                      <Checkbox checked={extras.includes(f.key)} onCheckedChange={(on) => setExtras((x) => on ? [...x, f.key] : x.filter((k) => k !== f.key))} />
                      {t(f.label)}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {!pkg.key && <div className="col-span-2 grid gap-1.5">
              <Label htmlFor="max-stores" optional>{t('Store limit for this client')}</Label>
              <Input id="max-stores" type="number" min={1} step={1} className="tabular" value={maxStores} onChange={(e) => setMaxStores(e.target.value)}
                placeholder={PLAN_STORES[plan] ? t('The plan\u2019s {n}', { n: PLAN_STORES[plan]! }) : t('No limit')} />
            </div>}
            {client && <LicenceCodeCard companyId={client.id} />}
            {!pkg.key && <fieldset className="col-span-2 grid gap-2 rounded-md border p-3">
              <legend className="px-1 text-[13px] font-medium">{t('Modules with a cost per use')}</legend>
              <p className="text-xs text-muted-foreground">{t('In no plan. Turn one on only when the client asked for it and it is in their offer.')}</p>
              {PAID_MODULES.map((f) => (
                <label key={f.key} className="flex items-start gap-2 text-[13px]">
                  <Checkbox className="mt-0.5" checked={extras.includes(f.key)} onCheckedChange={(on) => setExtras((x) => on ? [...x, f.key] : x.filter((k) => k !== f.key))} />
                  <span>{t(f.label)}<span className="block text-xs text-muted-foreground">{f.cost ? t(f.cost) : null}</span></span>
                </label>
              ))}
            </fieldset>}
            {client && (pkg.key ? pkg.modules : extras).includes('ai_reads') && <AiReadsCard companyId={client.id} />}
            {client && (pkg.key ? pkg.modules : extras).includes('ai_assistant') && <AiReadsCard companyId={client.id} chat />}
            <FormField control={form.control} name="status" render={({ field }) => (
              <FormItem className="col-span-2 flex items-center justify-between gap-3 space-y-0 rounded-md border p-3">
                <div>
                  <FormLabel>{t('Pause access')}</FormLabel>
                  <FormDescription>{t('For example while an invoice is unpaid. Turn off to give access back.')}</FormDescription>
                </div>
                <FormControl><Switch checked={field.value === 'suspended'} onCheckedChange={(on) => field.onChange(on ? 'suspended' : 'active')} /></FormControl>
              </FormItem>
            )} />
            <DialogFooter className="col-span-2 mt-1">
              <Button type="button" variant="outline" onClick={onClose}>{t('Cancel')}</Button>
              <Button type="submit" loading={form.formState.isSubmitting}>{t('Save licence')}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ licence code: the program activates with it, cloud or local server */
type LicenceInfo = { code: string; deployment: 'any' | 'cloud' | 'local'; local_server: boolean; local_seen_at: string | null; local_url: string | null; local_version: string | null }
export function LicenceCodeCard({ companyId }: { companyId: string }) {
  const [info, setInfo] = React.useState<LicenceInfo | null>(null)
  const [busy, setBusy] = React.useState(false)
  const call = React.useCallback(async (deployment?: string, free = false) => {
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('platform_licence_info', { p_company: companyId, p_deployment: deployment, p_free_server: free })
      if (error) throw error
      setInfo(data as unknown as LicenceInfo)
    } catch (e) { toast.error(describeError(e)) } finally { setBusy(false) }
  }, [companyId])
  React.useEffect(() => { void call() }, [call])
  return (
    <div className="col-span-2 grid gap-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium">{t('Licence code')}</span>
        {info && <button type="button" className="text-xs text-primary hover:underline" onClick={() => { void navigator.clipboard?.writeText(info.code); toast.success(t('Code copied')) }}>{t('Copy')}</button>}
      </div>
      <div className="font-mono text-lg font-semibold tracking-wider">{info?.code ?? '…'}</div>
      <p className="text-xs text-muted-foreground">{t('The client types it when the DrisPRO program starts the first time, and chooses where the data lives.')}</p>
      <div className="grid gap-1.5">
        <Label>{t('Where it may run')}</Label>
        <Select value={info?.deployment ?? 'any'} disabled={!info || busy} onValueChange={(v) => void call(v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">{t('Cloud or local server (the client chooses)')}</SelectItem>
            <SelectItem value="cloud">{t('Cloud only')}</SelectItem>
            <SelectItem value="local">{t('Local server only')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {info?.local_server && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{t('Local server {url}, last check {time}', { url: info.local_url ?? '', time: info.local_seen_at ? formatDate(info.local_seen_at, true) : '—' })}{info.local_version ? ` · v${info.local_version}` : ''}</span>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { if (confirm(t('Free the code? The current local server stops getting its licence; a new server can use the code.'))) void call(undefined, true) }}>{t('Move to another server')}</Button>
        </div>
      )}
      {info?.local_server && <CloudCopies companyId={companyId} />}
    </div>
  )
}

/* the nightly copies a local server sent to our cloud (encrypted) */
type CloudCopy = { file: string; parts: number; bytes: number; created_at: string }
export function CloudCopies({ companyId }: { companyId: string }) {
  const [rows, setRows] = React.useState<CloudCopy[] | null>(null)
  React.useEffect(() => {
    let live = true
    void supabase.rpc('platform_local_backups', { p_company: companyId }).then(({ data, error }) => { if (live) setRows(error ? [] : ((data as unknown as CloudCopy[]) ?? [])) })
    return () => { live = false }
  }, [companyId])
  if (!rows) return null
  const last = rows[0]
  const old = !last || Date.now() - new Date(last.created_at).getTime() > 36 * 3600 * 1000
  const mb = (b: number) => `${(b / 1048576).toFixed(1)} MB`
  return (
    <div className="grid gap-1 border-t pt-2 text-xs">
      <span className={old ? 'font-medium text-destructive' : 'text-muted-foreground'}>
        {last ? t('Last copy in the cloud: {time} ({size})', { time: formatDate(last.created_at, true), size: mb(last.bytes) }) : t('No copy in the cloud yet')}
      </span>
      {rows.length > 1 && <span className="text-muted-foreground">{t('{count} copies kept', { count: rows.length })}</span>}
    </div>
  )
}

/* supplier invoices read with AI: this month against the limit, the months before with their cost */
type AiUsage = { used: number; limit: number; override: number | null; plan_limit: number; months: { month: string; reads?: number; questions?: number; failed?: number; cost_usd: number }[] }
/* with chat: the assistant's questions instead, counted and limited the same way */
export function AiReadsCard({ companyId, chat = false }: { companyId: string; chat?: boolean }) {
  const [u, setU] = React.useState<AiUsage | null>(null)
  const [val, setVal] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const load = React.useCallback(async () => {
    const { data, error } = chat ? await supabase.rpc('platform_ai_chat_usage', { p_company: companyId }) : await supabase.rpc('platform_ai_usage', { p_company: companyId })
    if (!error && data) { const x = data as unknown as AiUsage; setU(x); setVal(x.override == null ? '' : String(x.override)) }
  }, [companyId, chat])
  React.useEffect(() => { void load() }, [load])
  if (!u) return null
  const save = async () => {
    setBusy(true)
    try {
      const limit = (val === '' ? null : Number(val)) as unknown as number
      const { error } = chat ? await supabase.rpc('platform_set_ai_chat_limit', { p_company: companyId, p_limit: limit }) : await supabase.rpc('platform_set_ai_limit', { p_company: companyId, p_limit: limit })
      if (error) throw error
      toast.success(t('Saved')); await load()
    } catch (e) { toast.error(describeError(e)) } finally { setBusy(false) }
  }
  const pct = u.limit ? Math.min(100, Math.round((u.used / u.limit) * 100)) : 100
  return (
    <div className="col-span-2 grid gap-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium">{chat ? t('Questions to the assistant this month') : t('Invoices read with AI this month')}</span>
        <span className="text-[13px] tabular">{u.used} / {u.limit}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn('h-full rounded-full', pct >= 90 ? 'bg-destructive' : 'bg-primary')} style={{ width: `${pct}%` }} /></div>
      {u.months.length > 0 && (
        <div className="grid gap-0.5 text-xs text-muted-foreground">
          {u.months.slice(0, 4).map((m) => (
            <div key={m.month} className="flex justify-between gap-2"><span>{m.month}</span>
              <span className="tabular">{chat ? tn(m.questions ?? 0, '{n} question', '{n} questions') : tn(m.reads ?? 0, '{n} invoice', '{n} invoices')}{m.failed ? ` · ${t('{n} not read', { n: m.failed })}` : ''} · ${m.cost_usd.toFixed(2)}</span></div>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <div className="grid flex-1 gap-1.5">
          <Label htmlFor={chat ? 'ai-chat-limit' : 'ai-limit'} optional>{t('Another monthly limit for this client')}</Label>
          <Input id={chat ? 'ai-chat-limit' : 'ai-limit'} type="number" min={0} step={1} className="tabular" value={val} onChange={(e) => setVal(e.target.value)} placeholder={t('The plan\u2019s {n}', { n: u.plan_limit })} />
        </div>
        <Button type="button" variant="outline" loading={busy} disabled={val === (u.override == null ? '' : String(u.override))} onClick={() => void save()}>{t('Save')}</Button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ new password */

/** People a client's administrator invited: the platform administrator makes their account. */
export function PendingAccounts({ clients }: { clients: PlatformClient[] }) {
  const rows = clients.flatMap((c) => (c.pending ?? []).map((p) => ({ ...p, company: c.name })))
  const [target, setTarget] = React.useState<(typeof rows)[number] | null>(null)
  // the dialog stays open after the account is made (the row is gone by then) to show the password
  return (
    <>
    {rows.length > 0 && <div className="mb-4 rounded-lg border border-primary/30 bg-card">
      <div className="border-b px-4 py-3">
        <p className="text-sm font-medium">{tn(rows.length, '{n} person waits for an account', '{n} people wait for an account')}</p>
        <p className="text-xs text-muted-foreground">{t('Invited by their company\'s administrator. Make the account and hand over the email and password.')}</p>
      </div>
      <ul className="divide-y">
        {rows.map((r) => (
          <li key={r.member_id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 text-[13px]">
            <div className="min-w-[14rem] flex-1">
              <p className="font-medium">{r.email}</p>
              <p className="text-xs text-muted-foreground">{[r.company, r.roles.map((x) => td(x)).join(', '), formatDate(r.invited_at)].filter(Boolean).join(' · ')}</p>
            </div>
            <Button size="sm" onClick={() => setTarget(r)}><UserPlus /> {t('Make the account')}</Button>
          </li>
        ))}
      </ul>
    </div>}
    {target && <CreateAccountDialog target={target} onClose={() => setTarget(null)} />}
    </>
  )
}

export function CreateAccountDialog({ target, onClose }: { target: { member_id: string; email: string; company: string }; onClose: () => void }) {
  const create = useCreateAccount()
  const [name, setName] = React.useState('')
  const [pw, setPw] = React.useState(generatePassword)
  const [error, setError] = React.useState<string | null>(null)
  const [done, setDone] = React.useState(false)
  const text = `${t('Address')}: ${window.location.origin}\n${t('Email')}: ${target.email}\n${t('Password')}: ${pw}`
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Account for {email}', { email: target.email })}</DialogTitle>
          <DialogDescription>{done ? t('Send these to the person. They can change the password after signing in.') : t('{company} invited this person. They join the company as soon as the account is made.', { company: target.company })}</DialogDescription>
        </DialogHeader>
        {done ? (
          <>
            <pre className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3 font-sans text-sm">{text}</pre>
            <DialogFooter>
              <Button variant="outline" onClick={() => void copy(text)}><Copy /> {t('Copy')}</Button>
              <Button onClick={onClose}>{t('Done')}</Button>
            </DialogFooter>
          </>
        ) : (
          <div className="grid gap-3">
            <div className="grid gap-1.5"><label htmlFor="ca-name" className="text-sm font-medium">{t('Full name')}</label>
              <Input id="ca-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></div>
            <div className="grid gap-1.5"><label htmlFor="ca-pw" className="text-sm font-medium">{t('Password')}</label>
              <div className="flex gap-2">
                <Input id="ca-pw" className="font-mono" value={pw} onChange={(e) => setPw(e.target.value)} />
                <Button type="button" variant="outline" onClick={() => setPw(generatePassword())}>{t('Generate')}</Button>
              </div></div>
            {error && <p className="text-[13px] text-destructive">{error}</p>}
            <DialogFooter className="mt-1">
              <Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
              <Button disabled={pw.length < 8} loading={create.isPending}
                onClick={() => create.mutate({ member: target.member_id, password: pw, name: name.trim() }, { onSuccess: () => setDone(true), onError: (e) => setError(describeError(e)) })}>{t('Make the account')}</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function PasswordDialog({ target, onClose }: { target: { email: string } | null; onClose: () => void }) {
  const setPw = useSetPassword()
  const [email, setEmail] = React.useState('')
  const [pw, setPwValue] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [saved, setSaved] = React.useState(false)
  React.useEffect(() => { if (target) { setEmail(target.email); setPwValue(generatePassword()); setError(null); setSaved(false) } }, [target])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pw.length < 8) { setError(t('Use at least 8 characters')); return }
    try { await setPw.mutateAsync({ email, password: pw }); setSaved(true) } catch (err) { setError(describeError(err)) }
  }
  const text = `${t('Email')}: ${email}\n${t('New password')}: ${pw}`

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Set a new password')}</DialogTitle>
          <DialogDescription>{saved ? t('Send the new password to the person. They can change it after signing in.') : t('For a client who forgot the password. Any email in the client\'s company works.')}</DialogDescription>
        </DialogHeader>
        {saved ? (
          <>
            <pre className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3 font-sans text-sm">{text}</pre>
            <DialogFooter>
              <Button variant="outline" onClick={() => void copy(text)}><Copy /> {t('Copy')}</Button>
              <Button onClick={onClose}>{t('Done')}</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} className="grid gap-3" noValidate>
            <div className="grid gap-1.5"><label htmlFor="pw-email" className="text-sm font-medium">{t('Email')}</label>
              <Input id="pw-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div className="grid gap-1.5"><label htmlFor="pw-new" className="text-sm font-medium">{t('New password')}</label>
              <div className="flex gap-2">
                <Input id="pw-new" className="font-mono" value={pw} onChange={(e) => setPwValue(e.target.value)} />
                <Button type="button" variant="outline" onClick={() => setPwValue(generatePassword())}>{t('Generate')}</Button>
              </div></div>
            {error && <p className="text-[13px] text-destructive">{error}</p>}
            <DialogFooter className="mt-1">
              <Button type="button" variant="outline" onClick={onClose}>{t('Cancel')}</Button>
              <Button type="submit" loading={setPw.isPending}>{t('Save password')}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ live link */

export function linkState(x: SyncConnection): { label: string; variant: 'success' | 'warning' | 'secondary' | 'destructive' } {
  if (!x.is_active) return { label: t('Link off'), variant: 'secondary' }
  if (!x.last_seen_at) return { label: t('Not connected yet'), variant: 'secondary' }
  if (x.last_error) return { label: t('Link has errors'), variant: 'destructive' }
  const minutes = (Date.now() - new Date(x.last_seen_at).getTime()) / 60000
  return minutes <= 3 ? { label: t('Live|link'), variant: 'success' } : { label: t('No signal'), variant: 'warning' }
}

export function countsText(c: Record<string, unknown> | null) {
  if (!c) return ''
  const parts: string[] = []
  const pick = (k: string, label: string) => {
    const v = c[k] as { created?: number; updated?: number; changed?: number } | undefined
    if (!v) return
    const n = (v.created ?? 0) + (v.updated ?? 0) + (v.changed ?? 0)
    if (n) parts.push(`${label} ${n}`)
  }
  pick('products', t('products')); pick('partners', t('partners')); pick('prices', t('prices')); pick('stock', t('stock lines'))
  if (typeof c.documents === 'number' && c.documents) parts.push(`${t('documents')} ${c.documents}`)
  return parts.join(' · ')
}

export function LiveLinkDialog({ client, onClose }: { client: PlatformClient | null; onClose: () => void }) {
  const createKey = useCreateSyncKey()
  const setActive = useSetSyncActive()
  const setTraining = useSetTraining()
  const [name, setName] = React.useState('Logmicro')
  const [config, setConfig] = React.useState<string | null>(null)
  const [logOf, setLogOf] = React.useState<SyncConnection | null>(null)
  React.useEffect(() => { if (client) { setConfig(null); setName('Logmicro') } }, [client?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const make = async () => {
    if (!client) return
    try {
      const r = await createKey.mutateAsync({ company: client.id, name })
      setConfig(JSON.stringify({
        url: supabaseUrl, anon_key: supabaseAnonKey, sync_key: r.key,
        server: '', database: '', main_price_list: '', interval_seconds: 5, active_years: 2,
      }, null, 2))
    } catch (e) { toast.error(describeError(e)) }
  }
  const download = () => {
    if (!config) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([config], { type: 'application/json' }))
    a.download = 'lidhja.json'; a.click(); URL.revokeObjectURL(a.href)
  }

  return (
    <Dialog open={!!client} onOpenChange={(o) => !o && onClose()}>
      <AgentLogSheet connection={logOf} onClose={() => setLogOf(null)} />
      <DialogContent className="max-h-[92dvh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('Live link and training · {name}', { name: client?.name ?? '' })}</DialogTitle>
          <DialogDescription>{t('The agent on the client\'s server sends what changes in the old program every few seconds: products, prices, partners, stock and unpaid invoices. The old program stays the official one.')}</DialogDescription>
        </DialogHeader>
        {client && (
          <div className="grid gap-4">
            <div className="flex items-start justify-between gap-4 rounded-md border p-3">
              <div>
                <p className="flex items-center gap-1.5 text-sm font-medium"><GraduationCap className="size-4 text-warning" /> {t('Training company')}</p>
                <p className="mt-0.5 text-[13px] text-muted-foreground">{t('Staff practise on live data. Nothing is fiscalized and every screen shows that it is practice.')}</p>
              </div>
              <Switch checked={!!client.is_training} disabled={setTraining.isPending} aria-label={t('Training company')}
                onCheckedChange={(on) => setTraining.mutate({ company: client.id, on }, { onError: (e) => toast.error(describeError(e)) })} />
            </div>

            <div className="grid gap-2">
              <p className="text-sm font-medium">{t('Connections')}</p>
              {(client.sync ?? []).length === 0 && <p className="text-[13px] text-muted-foreground">{t('No connection yet. Make a key and give it to the agent on the client\'s server.')}</p>}
              {(client.sync ?? []).map((x) => {
                const st = linkState(x)
                return (
                  <div key={x.id} className="rounded-md border p-3 text-[13px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{x.name} <span className="font-mono text-xs text-muted-foreground">{x.key_prefix}…</span></span>
                      <Badge variant={st.variant}>{st.label}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {x.last_seen_at ? t('Last heard {time} · {n} pushes', { time: formatDate(x.last_seen_at, true), n: formatInt(x.pushes) }) : t('Waiting for the agent')}
                      {countsText(x.last_counts) && <> · {t('last change')}: {countsText(x.last_counts)}</>}
                    </p>
                    {x.last_error && <p className="mt-1 text-xs text-destructive">{x.last_error}</p>}
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" variant="outline" disabled={setActive.isPending} onClick={() => setActive.mutate({ id: x.id, active: !x.is_active })}>
                        {x.is_active ? t('Switch off') : t('Switch on')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setLogOf(x)}>{t('Agent log')}</Button>
                    </div>
                  </div>
                )
              })}
            </div>

            {config ? (
              <div className="grid gap-2 rounded-md border border-warning/40 bg-warning/5 p-3">
                <p className="text-[13px] font-medium">{t('Connection settings for the agent (lidhja.json). The key is shown only now.')}</p>
                <pre className="max-h-48 overflow-auto rounded border bg-background p-2 text-xs">{config}</pre>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => void copy(config)}><Copy /> {t('Copy')}</Button>
                  <Button size="sm" onClick={download}><Download /> {t('Download lidhja.json')}</Button>
                </div>
                <p className="text-xs text-muted-foreground">{t('Put lidhja.json next to the agent on the client\'s server. Anyone with this key can send data into this company, so keep it there only.')}</p>
              </div>
            ) : (
              <div className="flex items-end gap-2">
                <div className="grid flex-1 gap-1.5">
                  <label htmlFor="sync-name" className="text-[13px] font-medium">{t('Name of the new connection')}</label>
                  <Input id="sync-name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <Button onClick={() => void make()} loading={createKey.isPending}><Cable /> {t('Make a key')}</Button>
              </div>
            )}
          </div>
        )}
        <DialogFooter><Button variant="outline" onClick={onClose}>{t('Close')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ type of business */

export function BusinessTypeDialog({ client, onClose }: { client: PlatformClient | null; onClose: () => void }) {
  const save = useSetBusinessType()
  const setUnits = useSetMultiUnit()
  const [type, setType] = React.useState('general')
  const [applyMenu, setApplyMenu] = React.useState(true)
  const isMulti = (c: PlatformClient) => c.multi_unit ?? (c.units ?? 1) > 1
  const [multi, setMulti] = React.useState(false)
  React.useEffect(() => { if (client) { setType(client.business_type ?? 'general'); setApplyMenu(true); setMulti(isMulti(client)) } }, [client])
  const hint = BUSINESS_TYPES.find((b) => b.value === type)?.hint
  const submit = () => {
    if (!client) return
    save.mutate({ company: client.id, type, applyMenu }, {
      onSuccess: async () => {
        if (multi !== isMulti(client) || client.multi_unit == null) {
          try { await setUnits.mutateAsync({ company: client.id, multi }) } catch (e) { toast.error(describeError(e)); return }
        }
        toast.success(t('{name} is now: {type}', { name: client.name, type: t(businessTypeLabel(type)) })); onClose() },
      onError: (e) => toast.error(describeError(e)),
    })
  }
  return (
    <Dialog open={!!client} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Type of business · {name}', { name: client?.name ?? '' })}</DialogTitle>
          <DialogDescription>{t('The type decides which parts of the menu the client starts with. Nothing is deleted; hidden parts stay reachable by search.')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Select value={type} onValueChange={setType}>
              <SelectTrigger aria-label={t('Type of business')}><SelectValue /></SelectTrigger>
              <SelectContent>{BUSINESS_TYPES.map((b) => <SelectItem key={b.value} value={b.value}>{t(b.label)}</SelectItem>)}</SelectContent>
            </Select>
            {hint && <p className="text-[13px] text-muted-foreground">{t(hint)}</p>}
          </div>
          <label className="flex items-start justify-between gap-4 rounded-md border p-3">
            <span>
              <span className="block text-sm font-medium">{t('Set the menu for this type')}</span>
              <span className="block text-[13px] text-muted-foreground">{t('Replaces the parts of the menu the client switched on or off themselves.')}</span>
            </span>
            <Switch checked={applyMenu} onCheckedChange={setApplyMenu} aria-label={t('Set the menu for this type')} />
          </label>
          <label className="flex items-start justify-between gap-4 rounded-md border p-3">
            <span>
              <span className="block text-sm font-medium">{t('Several units')}</span>
              <span className="block text-[13px] text-muted-foreground">{multi
                ? t('Several shops, restaurants or warehouses: the unit shows everywhere it matters. It has {n} now.', { n: client?.units ?? 0 })
                : t('One unit: the program does not talk about units, and a second one cannot be added by mistake.')}</span>
            </span>
            <Switch checked={multi} onCheckedChange={setMulti} aria-label={t('Several units')} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
          <Button onClick={submit} loading={save.isPending}>{t('Save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ delete a client */

export function DeleteClientDialog({ client, onClose }: { client: PlatformClient | null; onClose: () => void }) {
  const del = useDeleteClient()
  const [name, setName] = React.useState('')
  const [users, setUsers] = React.useState(true)
  const [err, setErr] = React.useState<string | null>(null)
  React.useEffect(() => { setName(''); setUsers(true); setErr(null) }, [client])
  // the words must match; full stops, spaces and capitals do not count (sh.p.k. or shpk)
  const same = (x: string) => x.toLowerCase().replace(/[\s.,]+/g, '')
  const ok = !!client && !!name.trim() && same(name) === same(client.name)
  return (
    <Dialog open={!!client} onOpenChange={(o) => { if (!o && !del.isPending) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-destructive">{t('Delete {name} completely', { name: client?.name ?? '' })}</DialogTitle>
          <DialogDescription>{t('Everything of this client is deleted for good: documents, stock, accounting, tills, cards, tables, users\' access, the licence and the live link. It cannot be undone; only a database backup brings it back.')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {client?.status === 'active' && <p className="rounded-md bg-warning/10 px-3 py-2 text-[13px] text-warning">{t('This client still has an active licence. If you only want to stop them, pause the licence instead.')}</p>}
          <label className="flex items-start gap-2 text-[13px]"><Checkbox checked={users} onCheckedChange={(v) => setUsers(!!v)} className="mt-0.5" />
            <span>{t('Also delete the accounts of people who work only for this client')}</span></label>
          <div className="grid gap-1.5">
            <label htmlFor="del-name" className="text-[13px]">{t('Type {name} to confirm', { name: client?.name ?? '' })}</label>
            <Input id="del-name" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          {err && <p className="text-[13px] text-destructive">{err}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={del.isPending}>{t('Cancel')}</Button>
          <Button variant="destructive" disabled={!ok} loading={del.isPending} onClick={() => {
            if (!client) return
            setErr(null)
            del.mutate({ company: client.id, name: name.trim(), deleteUsers: users }, {
              onSuccess: (r) => { toast.success(t('{name} was deleted ({n} records)', { name: client.name, n: r.rows })); onClose() },
              onError: (e) => setErr(describeError(e)),
            })
          }}><Trash2 /> {t('Delete for good')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
