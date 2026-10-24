import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowDownToLine, ArrowRight, Cable, Copy, Download, GraduationCap, KeyRound, LogOut, MoreHorizontal, Plus, Search, ServerCog, Shapes } from 'lucide-react'
import * as React from 'react'
import { useForm } from 'react-hook-form'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { z } from 'zod'
import { useAuth } from '@/app/auth-provider'
import { useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { startSupportVisit } from '@/components/license-banner'
import { ErrorState } from '@/components/error-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { msg, t, tn } from '@/i18n'
import { LanguageToggle } from '@/i18n/language'
import { describeError } from '@/lib/errors'
import { daysUntil, LICENSE_WARNING_DAYS } from '@/lib/license'
import { formatDate, formatQty as formatInt, todayISO } from '@/lib/utils'
import { generatePassword, type PlatformClient, type SyncConnection, useCreateClient, useCreateSyncKey, usePlatformClients, useSaveLicense, useSetPassword, useSetSelfService, useSetSyncActive, useSetTraining, useSetBusinessType } from './api'
import { BUSINESS_TYPES, businessTypeLabel } from './business-types'

const PLANS = [
  { value: 'basic', label: msg('Basic') },
  { value: 'standard', label: msg('Standard') },
  { value: 'pro', label: msg('Pro') },
]
function planLabel(plan: string | null) {
  if (!plan) return '—'
  if (plan === 'trial') return t('Trial')
  const p = PLANS.find((x) => x.value === plan)
  return p ? t(p.label) : plan
}

function addMonths(iso: string, months: number) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1 + months, d))
  return dt.toISOString().slice(0, 10)
}

type LicenseState = { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary'; rank: number }
function licenseState(c: PlatformClient): LicenseState {
  if (!c.valid_until || !c.status) return { label: t('No licence'), variant: 'destructive', rank: 0 }
  if (c.status === 'suspended') return { label: t('Paused'), variant: 'destructive', rank: 1 }
  const days = daysUntil(c.valid_until)
  if (days < 0) return { label: t('Expired'), variant: 'destructive', rank: 2 }
  if (c.valid_from && daysUntil(c.valid_from) > 0) return { label: t('Starts {date}', { date: formatDate(c.valid_from) }), variant: 'secondary', rank: 4 }
  if (days <= LICENSE_WARNING_DAYS) return { label: days === 0 ? t('Ends today') : tn(days, 'Ends in {n} day', 'Ends in {n} days'), variant: 'warning', rank: 3 }
  return { label: t('Active'), variant: 'success', rank: 5 }
}

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); toast.success(t('Copied')) } catch { toast.error(t('Could not copy. Select the text and copy it by hand.')) }
}

/* ------------------------------------------------------------------ page */

export function PlatformPage() {
  const { user, loading, signOut } = useAuth()
  const { isSuperAdmin, loading: ctxLoading, companies, switchCompany } = useCompany()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const clients = usePlatformClients(isSuperAdmin)
  const selfService = useSetSelfService()
  const [query, setQuery] = React.useState('')
  const [creating, setCreating] = React.useState(params.get('new') === '1')
  const [editing, setEditing] = React.useState<PlatformClient | null>(null)
  const [password, setPassword] = React.useState<{ email: string } | null>(null)
  const [live, setLive] = React.useState<string | null>(null)
  const [typing, setTyping] = React.useState<PlatformClient | null>(null)

  if (!loading && !user) return <Navigate to="/login" replace />
  if (loading || ctxLoading) return <div className="min-h-dvh bg-background" />
  if (!isSuperAdmin) return <Navigate to="/" replace />

  const list = clients.data?.clients ?? []
  const q = query.trim().toLowerCase()
  const shown = list
    .filter((c) => !q || [c.name, c.legal_name, c.tax_number, ...c.admins].some((v) => v?.toLowerCase().includes(q)))
    .sort((a, b) => licenseState(a).rank - licenseState(b).rank || a.name.localeCompare(b.name))
  const counts = list.reduce((acc, c) => {
    const s = licenseState(c)
    if (s.rank === 5 || s.rank === 4) acc.active++
    else if (s.rank === 3) acc.soon++
    else acc.off++
    return acc
  }, { active: 0, soon: 0, off: 0 })

  const openCompany = async (id: string, path = '/') => { startSupportVisit(id); await switchCompany(id); navigate(path) }

  return (
    <div className="min-h-dvh bg-background">
      <header className="flex h-14 items-center gap-3 border-b bg-sidebar px-4 sm:px-6">
        <img src="/favicon.svg" alt="" className="size-7" />
        <span className="text-sm font-semibold">NexusERP Pro</span>
        <span className="hidden text-sm text-muted-foreground sm:inline">{t('Platform')}</span>
        <div className="ml-auto flex items-center gap-2">
          <LanguageToggle />
          {companies.length > 0 && <Button variant="outline" size="sm" onClick={() => navigate('/')}>{t('Open the app')} <ArrowRight /></Button>}
          <Button variant="ghost" size="sm" onClick={() => void signOut()} aria-label={t('Sign out')}><LogOut /><span className="hidden sm:inline">{t('Sign out')}</span></Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-[-0.01em]">{t('Clients and licences')}</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {t('Create each client company with its administrator and licence. Only you see this page; clients cannot create companies themselves.')}
            </p>
          </div>
          <Button onClick={() => setCreating(true)}><Plus /> {t('New client')}</Button>
        </div>

        <div className="mb-4 grid grid-cols-3 gap-3">
          <Count value={counts.active} label={t('Active')} />
          <Count value={counts.soon} label={tn(LICENSE_WARNING_DAYS, 'Ending within {n} day', 'Ending within {n} days')} tone={counts.soon ? 'warning' : undefined} />
          <Count value={counts.off} label={t('Expired or paused')} tone={counts.off ? 'destructive' : undefined} />
        </div>

        <div className="rounded-lg border bg-card">
          <div className="flex items-center gap-2 border-b p-3">
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Search name, NUI/NIPT or email')} className="pl-8" aria-label={t('Search clients')} />
            </div>
            <span className="ml-auto text-xs text-muted-foreground">{tn(list.length, '{n} client', '{n} clients')}</span>
          </div>
          {clients.isLoading ? (
            <div className="space-y-2 p-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : clients.error ? (
            <ErrorState error={clients.error} onRetry={() => void clients.refetch()} compact />
          ) : !shown.length ? (
            <EmptyState icon={ServerCog} compact
              title={list.length ? t('No client matches the search') : t('No clients yet')}
              description={list.length ? undefined : t('Add the first client: their company, the administrator account and the licence period.')}
              action={list.length ? undefined : <Button onClick={() => setCreating(true)}><Plus /> {t('New client')}</Button>} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Client')}</TableHead>
                    <TableHead>{t('Administrator')}</TableHead>
                    <TableHead className="text-right">{t('Users')}</TableHead>
                    <TableHead>{t('Plan')}</TableHead>
                    <TableHead>{t('Valid until')}</TableHead>
                    <TableHead>{t('Last activity')}</TableHead>
                    <TableHead className="w-10"><span className="sr-only">{t('Actions')}</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((c) => {
                    const s = licenseState(c)
                    const full = c.max_users != null && c.users >= c.max_users
                    return (
                      <TableRow key={c.id}>
                        <TableCell>
                          <span className="block font-medium">{c.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {c.country_code === 'XK' ? t('Kosovo') : t('Albania')}{c.tax_number ? ` · ${c.tax_number}` : ''} · {t(businessTypeLabel(c.business_type))}
                          </span>
                          {(c.is_training || (c.sync ?? []).some((x) => x.is_active)) && (
                            <span className="mt-1 flex flex-wrap gap-1">
                              {c.is_training && <Badge variant="warning">{t('Training')}</Badge>}
                              {(c.sync ?? []).filter((x) => x.is_active).map((x) => <Badge key={x.id} variant={linkState(x).variant}>{linkState(x).label}</Badge>)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-[13px]">{c.admins[0] ?? <span className="text-muted-foreground">—</span>}
                          {c.admins.length > 1 && <span className="text-xs text-muted-foreground"> +{c.admins.length - 1}</span>}</TableCell>
                        <TableCell className={full ? 'text-right tabular text-warning' : 'text-right tabular'}>{formatInt(c.users)} / {c.max_users ?? '—'}</TableCell>
                        <TableCell>{planLabel(c.plan)}</TableCell>
                        <TableCell>
                          <div className="flex flex-col items-start gap-1">
                            <Badge variant={s.variant}>{s.label}</Badge>
                            {c.valid_until && <span className="text-xs text-muted-foreground">{formatDate(c.valid_until)}</span>}
                          </div>
                        </TableCell>
                        <TableCell className="text-[13px] text-muted-foreground">{c.last_activity ? formatDate(c.last_activity, true) : t('Never')}</TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={t('Actions for {name}', { name: c.name })}><MoreHorizontal /></Button></DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={() => setEditing(c)}>{t('Change licence')}</DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => setTyping(c)}><Shapes /> {t('Type of business')}</DropdownMenuItem>
                              <DropdownMenuItem disabled={!c.admins.length} onSelect={() => setPassword({ email: c.admins[0] ?? '' })}><KeyRound /> {t('Set a new password')}</DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onSelect={() => void openCompany(c.id, '/settings/migration')}><ArrowDownToLine /> {t('Move data from the old program')}</DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => setLive(c.id)}><Cable /> {t('Live link and training')}</DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => void openCompany(c.id)}><ArrowRight /> {t('Open this company')}</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        <div className="mt-6 flex items-start justify-between gap-4 rounded-lg border bg-card p-4">
          <div>
            <p className="text-sm font-medium">{t('Open sign-up')}</p>
            <p className="mt-0.5 max-w-xl text-[13px] text-muted-foreground">
              {t('When on, anyone can create an account and a company with a 30-day trial. Keep it off to decide every client yourself; invited staff can always sign up.')}
            </p>
          </div>
          <Switch checked={!!clients.data?.self_service} disabled={selfService.isPending || clients.isLoading}
            aria-label={t('Open sign-up')}
            onCheckedChange={(on) => selfService.mutate(on, {
              onSuccess: () => toast.success(on ? t('Anyone can sign up now') : t('Sign-up is by invitation only')),
              onError: (e) => toast.error(describeError(e)),
            })} />
        </div>
      </main>

      <NewClientDialog open={creating} onOpenChange={(o) => { setCreating(o); if (!o && params.get('new')) setParams({}, { replace: true }) }} />
      <LicenseDialog client={editing} onClose={() => setEditing(null)} />
      <PasswordDialog target={password} onClose={() => setPassword(null)} />
      <BusinessTypeDialog client={typing} onClose={() => setTyping(null)} />
      <LiveLinkDialog client={list.find((x) => x.id === live) ?? null} onClose={() => setLive(null)} />
    </div>
  )
}

function Count({ value, label, tone }: { value: number; label: string; tone?: 'warning' | 'destructive' }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <span className={tone === 'warning' ? 'block text-2xl font-semibold tabular text-warning' : tone === 'destructive' ? 'block text-2xl font-semibold tabular text-destructive' : 'block text-2xl font-semibold tabular'}>{formatInt(value)}</span>
      <span className="block text-xs text-muted-foreground">{label}</span>
    </div>
  )
}

/* ------------------------------------------------------------------ new client */

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
}).refine((v) => v.valid_until >= v.valid_from, { path: ['valid_until'], message: msg('The end date is before the start date') })
type ClientValues = z.infer<typeof clientSchema>

function NewClientDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const create = useCreateClient()
  const [done, setDone] = React.useState<ClientValues | null>(null)
  const defaults = React.useCallback((): ClientValues => ({
    name: '', legal_name: '', country: 'XK', tax_number: '', business_type: 'retail', owner_name: '', owner_email: '', owner_password: generatePassword(),
    plan: 'standard', max_users: 5, valid_from: todayISO(), valid_until: addMonths(todayISO(), 12), notes: '',
  }), [])
  const form = useForm<ClientValues>({ resolver: zodResolver(clientSchema), defaultValues: defaults() })
  React.useEffect(() => { if (open) { form.reset(defaults()); setDone(null) } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const country = form.watch('country')

  const submit = form.handleSubmit(async (v) => {
    try {
      await create.mutateAsync({ ...v, owner_email: v.owner_email.toLowerCase() })
      setDone(v)
    } catch (e) {
      const m = describeError(e)
      form.setError(/tax|NIPT|NUI/i.test(m) ? 'tax_number' : /password|fjalëkalim/i.test(m) ? 'owner_password' : /email/i.test(m) ? 'owner_email' : 'name', { message: m })
    }
  })

  const welcome = done ? [
    t('Your NexusERP account is ready.'),
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
              <DialogDescription>{t('Creates the company with its warehouse, VAT codes and financial year, the administrator account and the licence.')}</DialogDescription>
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

                <FormField control={form.control} name="business_type" render={({ field }) => (
                  <FormItem className="col-span-2"><FormLabel>{t('Type of business')}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>{BUSINESS_TYPES.map((b) => <SelectItem key={b.value} value={b.value}>{t(b.label)}</SelectItem>)}</SelectContent>
                    </Select>
                    <FormDescription>{t(BUSINESS_TYPES.find((b) => b.value === field.value)?.hint ?? '')}</FormDescription>
                  </FormItem>
                )} />

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
                <LicenseFields form={form} />
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
function LicenseFields({ form }: { form: any }) {
  const extend = (months: number) => {
    const until: string = form.getValues('valid_until')
    const base = until && until > todayISO() ? until : todayISO()
    form.setValue('valid_until', addMonths(base, months), { shouldValidate: true, shouldDirty: true })
  }
  return (
    <>
      <FormField control={form.control} name="plan" render={({ field }: { field: { value: string; onChange: (v: string) => void } }) => (
        <FormItem className="col-span-1"><FormLabel>{t('Plan')}</FormLabel>
          <Select value={field.value} onValueChange={field.onChange}>
            <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
            <SelectContent>
              {PLANS.map((p) => <SelectItem key={p.value} value={p.value}>{t(p.label)}</SelectItem>)}
              {field.value === 'trial' && <SelectItem value="trial">{t('Trial')}</SelectItem>}
            </SelectContent>
          </Select>
        </FormItem>
      )} />
      <FormField control={form.control} name="max_users" render={({ field }: { field: object }) => (
        <FormItem className="col-span-1"><FormLabel>{t('Maximum users')}</FormLabel><FormControl><Input type="number" min={1} step={1} className="tabular" {...field} /></FormControl><FormMessage /></FormItem>
      )} />
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

function LicenseDialog({ client, onClose }: { client: PlatformClient | null; onClose: () => void }) {
  const save = useSaveLicense()
  const form = useForm<LicenseValues>({ resolver: zodResolver(licenseSchema) })
  React.useEffect(() => {
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
      await save.mutateAsync({ company: client.id, ...v })
      toast.success(t('Licence saved for {name}', { name: client.name }))
      onClose()
    } catch (e) { form.setError('plan', { message: describeError(e) }) }
  })

  return (
    <Dialog open={!!client} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('Licence for {name}', { name: client?.name ?? '' })}</DialogTitle>
          <DialogDescription>{t('Outside the licence period, or while paused, the client\'s people cannot open the company. Their data is kept.')}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} className="grid grid-cols-2 gap-3" noValidate>
            <LicenseFields form={form} />
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

/* ------------------------------------------------------------------ new password */

function PasswordDialog({ target, onClose }: { target: { email: string } | null; onClose: () => void }) {
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

function linkState(x: SyncConnection): { label: string; variant: 'success' | 'warning' | 'secondary' | 'destructive' } {
  if (!x.is_active) return { label: t('Link off'), variant: 'secondary' }
  if (!x.last_seen_at) return { label: t('Not connected yet'), variant: 'secondary' }
  if (x.last_error) return { label: t('Link has errors'), variant: 'destructive' }
  const minutes = (Date.now() - new Date(x.last_seen_at).getTime()) / 60000
  return minutes <= 3 ? { label: t('Live|link'), variant: 'success' } : { label: t('No signal'), variant: 'warning' }
}

function countsText(c: Record<string, unknown> | null) {
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

function LiveLinkDialog({ client, onClose }: { client: PlatformClient | null; onClose: () => void }) {
  const createKey = useCreateSyncKey()
  const setActive = useSetSyncActive()
  const setTraining = useSetTraining()
  const [name, setName] = React.useState('Logmicro')
  const [config, setConfig] = React.useState<string | null>(null)
  React.useEffect(() => { if (client) { setConfig(null); setName('Logmicro') } }, [client?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const make = async () => {
    if (!client) return
    try {
      const r = await createKey.mutateAsync({ company: client.id, name })
      setConfig(JSON.stringify({
        url: import.meta.env.VITE_SUPABASE_URL, anon_key: import.meta.env.VITE_SUPABASE_ANON_KEY, sync_key: r.key,
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
                    <div className="mt-2">
                      <Button size="sm" variant="outline" disabled={setActive.isPending} onClick={() => setActive.mutate({ id: x.id, active: !x.is_active })}>
                        {x.is_active ? t('Switch off') : t('Switch on')}
                      </Button>
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

function BusinessTypeDialog({ client, onClose }: { client: PlatformClient | null; onClose: () => void }) {
  const save = useSetBusinessType()
  const [type, setType] = React.useState('general')
  const [applyMenu, setApplyMenu] = React.useState(true)
  React.useEffect(() => { if (client) { setType(client.business_type ?? 'general'); setApplyMenu(true) } }, [client])
  const hint = BUSINESS_TYPES.find((b) => b.value === type)?.hint
  const submit = () => {
    if (!client) return
    save.mutate({ company: client.id, type, applyMenu }, {
      onSuccess: () => { toast.success(t('{name} is now: {type}', { name: client.name, type: t(businessTypeLabel(type)) })); onClose() },
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
          <Button onClick={submit} loading={save.isPending}>{t('Save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
