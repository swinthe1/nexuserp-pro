import { PrintSettingsCard } from '../components/print-settings'
import { CostingMethodField } from '../components/costing-method'
import { Fingerprint, TriangleAlert } from 'lucide-react'
import * as React from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { PageHeader } from '@/components/page-header'
import { StatusBadge } from '@/components/status-badge'
import { ErrorState } from '@/components/error-state'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { NAV } from '@/app/nav'
import { formatDateWith, t, td } from '@/i18n'
import { cn, formatDate } from '@/lib/utils'
import { type CompanyProfile, type CompanySettings, useCompanyProfile, useCompanySettings, useDirty, useLookups, useSaveCompanyProfile, useSaveCompanySettings } from '../api'
import { Field, SaveBar, ToggleRow } from '../components/field'

const monthNames = () => Array.from({ length: 12 }, (_, i) => formatDateWith(new Date(2026, i, 1), { month: 'long' }))
const NONE = '__none'

export function CompanySettingsPage() {
  const [params] = useSearchParams()
  const tab = params.get('tab') ?? 'company'
  return (
    <>
      <PageHeader title={t('Company settings')} description={t('How the company appears on documents, what new documents start with, and the link to the tax office.')} />
      <Tabs defaultValue={tab}>
        <TabsList>
          <TabsTrigger value="company">{t('Company')}</TabsTrigger>
          <TabsTrigger value="rules">{t('Defaults and rules')}</TabsTrigger>
          <TabsTrigger value="print">{t('Printed documents')}</TabsTrigger>
          <TabsTrigger value="fiscal">{t('Fiscalization')}</TabsTrigger>
          <TabsTrigger value="menu">{t('Menu')}</TabsTrigger>
        </TabsList>
        <TabsContent value="company"><CompanyProfileForm /></TabsContent>
        <TabsContent value="rules"><RulesForm /></TabsContent>
        <TabsContent value="print"><PrintSettingsCard /></TabsContent>
        <TabsContent value="fiscal"><FiscalForm /></TabsContent>
        <TabsContent value="menu"><MenuForm /></TabsContent>
      </Tabs>
    </>
  )
}

function CompanyProfileForm() {
  const { can } = useCompany()
  const profile = useCompanyProfile()
  const save = useSaveCompanyProfile()
  const [v, setV, dirty] = useDirty<CompanyProfile>(profile.data)
  if (profile.isError) return <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />
  if (profile.isLoading || !v) return <Skeleton className="h-96" />
  const ro = !can('admin.write')
  const set = <K extends keyof CompanyProfile>(k: K, val: CompanyProfile[K]) => setV({ ...v, [k]: val })
  const text = (k: keyof CompanyProfile) => ({
    id: `co-${String(k)}`, value: (v[k] as string | null) ?? '', disabled: ro,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, (e.target.value || null) as never),
  })
  const al = v.country_code === 'AL'
  const taxOk = !v.tax_number || (al ? /^[A-Z]\d{8}[A-Z]$/.test(v.tax_number) : /^\d{9}$/.test(v.tax_number))

  const submit = async () => {
    if (!v.name?.trim()) return toast.error(t('Give the company a name.'))
    if (!taxOk) return toast.error(al ? t('The NIPT is a letter, 8 digits and a letter.') : t('The NUI / fiscal number has 9 digits.'))
    await save.mutateAsync({
      name: v.name.trim(), legal_name: v.legal_name, tax_number: v.tax_number?.toUpperCase() ?? null, vat_number: v.vat_number, business_number: v.business_number,
      address_line1: v.address_line1, address_line2: v.address_line2, city: v.city, postal_code: v.postal_code, phone: v.phone, email: v.email,
      website: v.website, timezone: v.timezone, fiscal_year_start_month: v.fiscal_year_start_month,
    })
    toast.success(t('Company details saved'))
  }

  return (
    <>
      <div className="grid gap-4 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader><CardTitle>{t('On documents')}</CardTitle><CardDescription>{t('Printed on invoices, receipts, purchase orders and payslips, and sent to the tax office.')}</CardDescription></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label={t('Trading name')} htmlFor="co-name"><Input {...text('name')} /></Field>
            <Field label={t('Legal name')} htmlFor="co-legal_name" hint={t('As registered with QKB / ARBK.')}><Input {...text('legal_name')} placeholder={t('e.g. Ylli Retail sh.p.k.')} /></Field>
            <Field label={al ? 'NIPT' : t('NUI / fiscal number')} htmlFor="co-tax_number"
              hint={taxOk ? (al ? t('A letter, 8 digits and a letter, e.g. L81234567B.') : t('Nine digits.')) : <span className="text-destructive">{al ? t('Not a valid NIPT.') : t('Not a valid fiscal number.')}</span>}>
              <Input {...text('tax_number')} className="font-mono uppercase" />
            </Field>
            <Field label={t('VAT number')} htmlFor="co-vat_number" hint={al ? t('In Albania the NIPT is also the VAT number; leave this empty.') : t('The VAT registration number from ATK.')}><Input {...text('vat_number')} className="font-mono" /></Field>
            {!al && <Field label={t('Business number (NRB)')} htmlFor="co-business_number"><Input {...text('business_number')} className="font-mono" /></Field>}
            <Separator className="sm:col-span-2" />
            <Field label={t('Address')} htmlFor="co-address_line1" className="sm:col-span-2"><Input {...text('address_line1')} /></Field>
            <Field label={t('Address, second line')} htmlFor="co-address_line2" className="sm:col-span-2"><Input {...text('address_line2')} /></Field>
            <Field label={t('City')} htmlFor="co-city"><Input {...text('city')} /></Field>
            <Field label={t('Postal code')} htmlFor="co-postal_code"><Input {...text('postal_code')} /></Field>
            <Field label={t('Phone')} htmlFor="co-phone"><Input {...text('phone')} /></Field>
            <Field label={t('Email')} htmlFor="co-email"><Input {...text('email')} type="email" /></Field>
            <Field label={t('Website')} htmlFor="co-website" className="sm:col-span-2"><Input {...text('website')} /></Field>
          </CardContent>
        </Card>
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader><CardTitle>{t('Country and books')}</CardTitle><CardDescription>{t('Set when the company was created: tax rules, VAT forms and payroll follow the country.')}</CardDescription></CardHeader>
            <CardContent className="grid gap-3 text-[13px]">
              <div className="flex justify-between"><span className="text-muted-foreground">{t('Country')}</span><span>{al ? t('Albania') : v.country_code === 'XK' ? t('Kosovo') : v.country_code}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{t('Base currency')}</span><span className="font-mono">{v.base_currency}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{t('Created')}</span><span>{formatDate(v.created_at)}</span></div>
              <Separator />
              <Field label={t('Time zone')} htmlFor="co-timezone" hint={t('Decides which day a till receipt or a clock-in belongs to.')}>
                <Select value={v.timezone} onValueChange={(z) => set('timezone', z)} disabled={ro}>
                  <SelectTrigger id="co-timezone"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['Europe/Tirane', 'Europe/Belgrade', 'Europe/Rome', 'Europe/Berlin', 'Europe/London', 'UTC'].map((z) => <SelectItem key={z} value={z}>{z}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t('Financial year starts in')} htmlFor="co-fy">
                <Select value={String(v.fiscal_year_start_month)} onValueChange={(m) => set('fiscal_year_start_month', Number(m))} disabled={ro}>
                  <SelectTrigger id="co-fy"><SelectValue /></SelectTrigger>
                  <SelectContent>{monthNames().map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
            </CardContent>
          </Card>
        </div>
      </div>
      <SaveBar dirty={dirty} saving={save.isPending} onSave={() => void submit()} onReset={() => setV(profile.data)} disabled={ro} />
    </>
  )
}

function RulesForm() {
  const { can } = useCompany()
  const settings = useCompanySettings()
  const lookups = useLookups()
  const save = useSaveCompanySettings()
  const [v, setV, dirty] = useDirty<CompanySettings>(settings.data)
  if (settings.isError || lookups.isError) return <ErrorState error={settings.error ?? lookups.error} onRetry={() => { void settings.refetch(); void lookups.refetch() }} />
  if (settings.isLoading || !v || !lookups.data) return <Skeleton className="h-96" />
  const ro = !can('admin.write')
  const set = <K extends keyof CompanySettings>(k: K, val: CompanySettings[K]) => setV({ ...v, [k]: val })
  const numberInput = (k: 'max_discount_pct' | 'match_qty_tolerance_pct' | 'match_price_tolerance_pct' | 'amount_decimals' | 'quantity_decimals', step = '0.01') => ({
    id: `st-${k}`, type: 'number', step, min: 0, disabled: ro, value: String(v[k] ?? ''), className: 'tabular',
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, (e.target.value === '' ? 0 : Number(e.target.value)) as never),
  })
  const taxSelect = (k: 'default_sales_tax_code_id' | 'default_purchase_tax_code_id', scope: string) => (
    <Select value={v[k] ?? NONE} onValueChange={(id) => set(k, id === NONE ? null : id)} disabled={ro}>
      <SelectTrigger id={`st-${k}`}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{t('None')}</SelectItem>
        {lookups.data.taxCodes.filter((c) => c.scope === 'both' || c.scope === scope).map((c) => <SelectItem key={c.id} value={c.id}>{c.code} · {td(c.name)}</SelectItem>)}
      </SelectContent>
    </Select>
  )
  const submit = async () => {
    await save.mutateAsync({
      default_warehouse_id: v.default_warehouse_id, default_sales_tax_code_id: v.default_sales_tax_code_id, default_purchase_tax_code_id: v.default_purchase_tax_code_id,
      allow_negative_stock: v.allow_negative_stock, max_discount_pct: v.max_discount_pct, credit_check_enabled: v.credit_check_enabled,
      match_qty_tolerance_pct: v.match_qty_tolerance_pct, match_price_tolerance_pct: v.match_price_tolerance_pct,
      amount_decimals: v.amount_decimals, quantity_decimals: v.quantity_decimals, invoice_footer: v.invoice_footer,
    })
    toast.success(t('Defaults and rules saved'))
  }
  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t('Defaults for new documents')}</CardTitle><CardDescription>{t('People can change them on each document.')}</CardDescription></CardHeader>
          <CardContent className="grid gap-4">
            <Field label={t('Warehouse')} htmlFor="st-wh" hint={t('Orders, goods receipts and the web shop use it when nothing else is chosen.')}>
              <Select value={v.default_warehouse_id ?? NONE} onValueChange={(id) => set('default_warehouse_id', id === NONE ? null : id)} disabled={ro}>
                <SelectTrigger id="st-wh"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('None')}</SelectItem>
                  {lookups.data.warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.code} · {td(w.name)}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('VAT on sales')} htmlFor="st-default_sales_tax_code_id">{taxSelect('default_sales_tax_code_id', 'sales')}</Field>
              <Field label={t('VAT on purchases')} htmlFor="st-default_purchase_tax_code_id">{taxSelect('default_purchase_tax_code_id', 'purchase')}</Field>
            </div>
            <Field label={t('Invoice footer')} htmlFor="st-footer" hint={t('Bank details or a thank-you line, printed under every invoice.')}>
              <Textarea id="st-footer" rows={3} value={v.invoice_footer ?? ''} disabled={ro} onChange={(e) => set('invoice_footer', e.target.value || null)} />
            </Field>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t('Rules')}</CardTitle><CardDescription>{t('Checks the system makes when people confirm documents.')}</CardDescription></CardHeader>
          <CardContent>
            <ToggleRow title={t('Allow negative stock')} description={t('Deliveries and till sales may take stock below zero; the cost is settled when goods arrive. Off is safer.')}
              control={<Switch checked={v.allow_negative_stock} disabled={ro} onCheckedChange={(c) => set('allow_negative_stock', c)} aria-label={t('Allow negative stock')} />} />
            <Separator />
            <ToggleRow title={t('Check customer credit limits')} description={t('Confirming an order that takes a customer over their limit needs approval.')}
              control={<Switch checked={v.credit_check_enabled} disabled={ro} onCheckedChange={(c) => set('credit_check_enabled', c)} aria-label={t('Check customer credit limits')} />} />
            <Separator />
            <div className="grid gap-4 py-3 sm:grid-cols-3">
              <Field label={t('Highest discount, %')} htmlFor="st-max_discount_pct" hint={t('More than this needs a manager.')}><Input {...numberInput('max_discount_pct')} /></Field>
              <Field label={t('Allowed quantity difference on bills, %')} htmlFor="st-match_qty_tolerance_pct"><Input {...numberInput('match_qty_tolerance_pct')} /></Field>
              <Field label={t('Allowed price difference on bills, %')} htmlFor="st-match_price_tolerance_pct" hint={t('Compared with the order and the goods received.')}><Input {...numberInput('match_price_tolerance_pct')} /></Field>
            </div>
            <Separator />
            <div className="py-3"><CostingMethodField value={settings.data?.costing_method ?? 'weighted_average'} /></div>
            <Separator />
            <div className="grid gap-4 py-3 sm:grid-cols-2">
              <Field label={t('Decimals for amounts')} htmlFor="st-amount_decimals"><Input {...numberInput('amount_decimals', '1')} max={4} /></Field>
              <Field label={t('Decimals for quantities')} htmlFor="st-quantity_decimals"><Input {...numberInput('quantity_decimals', '1')} max={6} /></Field>
            </div>
          </CardContent>
        </Card>
      </div>
      <SaveBar dirty={dirty} saving={save.isPending} onSave={() => void submit()} onReset={() => setV(settings.data)} disabled={ro} />
    </>
  )
}

function FiscalForm() {
  const { can, company } = useCompany()
  const settings = useCompanySettings()
  const lookups = useLookups()
  const save = useSaveCompanySettings()
  const [v, setV, dirty] = useDirty<CompanySettings>(settings.data)
  if (settings.isError || lookups.isError) return <ErrorState error={settings.error ?? lookups.error} onRetry={() => { void settings.refetch(); void lookups.refetch() }} />
  if (settings.isLoading || !v || !lookups.data) return <Skeleton className="h-96" />
  const ro = !(can('admin.write') || can('tax.write'))
  const al = company?.country_code === 'AL'
  const set = <K extends keyof CompanySettings>(k: K, val: CompanySettings[K]) => setV({ ...v, [k]: val })
  const submit = async () => {
    await save.mutateAsync({
      fiscalization_enabled: v.fiscalization_enabled, fiscal_environment: v.fiscal_environment,
      fiscal_business_unit_code: v.fiscal_business_unit_code, fiscal_software_code: v.fiscal_software_code, fiscal_maintainer_code: v.fiscal_maintainer_code,
    })
    toast.success(t('Fiscalization settings saved'))
  }
  return (
    <>
      <div className="grid gap-4 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Fingerprint className="size-4" /> {al ? t('Fiscalization with the tax office (CIS)') : t('Fiscal devices and ATK')}</CardTitle>
            <CardDescription>
              {al ? t('Every invoice and till receipt is registered with the General Directorate of Taxation and carries its NIVF code and verification QR.')
                  : t('Every till receipt is registered through a certified fiscal device and carries its verification code.')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ToggleRow title={t('Fiscalize documents')} description={t('Confirmed invoices and paid receipts are sent to the tax office.')}
              control={<Switch checked={v.fiscalization_enabled} disabled={ro} onCheckedChange={(c) => set('fiscalization_enabled', c)} aria-label={t('Fiscalize documents')} />} />
            <Separator />
            <div className="grid gap-4 py-3 sm:grid-cols-2">
              <Field label={t('Mode')} htmlFor="fs-env" hint={v.fiscal_environment === 'test' ? t('Test: the answer is simulated, nothing reaches the tax office.') : undefined}>
                <Select value={v.fiscal_environment} onValueChange={(e) => set('fiscal_environment', e)} disabled={ro}>
                  <SelectTrigger id="fs-env"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="test">{t('Test')}</SelectItem><SelectItem value="production">{t('Live')}</SelectItem></SelectContent>
                </Select>
              </Field>
              <Field label={al ? t('Business unit code') : t('Business unit')} htmlFor="fs-bu" hint={al ? t('From the self-care portal, e.g. xb123cd456.') : undefined}>
                <Input id="fs-bu" className="font-mono" disabled={ro} value={v.fiscal_business_unit_code ?? ''} onChange={(e) => set('fiscal_business_unit_code', e.target.value || null)} />
              </Field>
              <Field label={t('Software code')} htmlFor="fs-sw" hint={al ? t('Issued to the certified software.') : undefined}>
                <Input id="fs-sw" className="font-mono" disabled={ro} value={v.fiscal_software_code ?? ''} onChange={(e) => set('fiscal_software_code', e.target.value || null)} />
              </Field>
              {al && (
                <Field label={t('Maintainer code')} htmlFor="fs-mm">
                  <Input id="fs-mm" className="font-mono" disabled={ro} value={v.fiscal_maintainer_code ?? ''} onChange={(e) => set('fiscal_maintainer_code', e.target.value || null)} />
                </Field>
              )}
            </div>
            {v.fiscal_environment === 'production' && (
              <p className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[13px]">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
                {t('Live mode needs the fiscalization service set up with the company certificate. Until then, documents sent to the tax office fail with “connector not configured”.')}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{al ? t('Cash registers (TCR)') : t('Fiscal devices')}</CardTitle><CardDescription>{t('Registered tills. Each till carries its code.')}</CardDescription></CardHeader>
          <CardContent className="grid gap-2 p-0 pb-3">
            {!lookups.data.tcrs.length && <p className="px-6 text-[13px] text-muted-foreground">{t('None registered yet. Add the code on the till in Point of sale.')}</p>}
            {lookups.data.tcrs.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 px-6 py-1.5 text-[13px]">
                <span className="min-w-0"><span className="block truncate">{r.name}</span><span className="font-mono text-xs text-muted-foreground">{r.tcr_code} · {r.business_unit_code}</span></span>
                <StatusBadge status={r.status} />
              </div>
            ))}
            <Link to="/tax/fiscalization" className="px-6 pt-1 text-[13px] text-primary hover:underline">{t('Open the fiscalization monitor')}</Link>
          </CardContent>
        </Card>
      </div>
      <SaveBar dirty={dirty} saving={save.isPending} onSave={() => void submit()} onReset={() => setV(settings.data)} disabled={ro} />
    </>
  )
}

/** Parts of the menu the company does not use, hidden for everyone (pages stay reachable by search). */
function MenuForm() {
  const settings = useCompanySettings()
  const save = useSaveCompanySettings()
  const { can } = useCompany()
  const writable = can('admin.write')
  if (settings.isLoading) return <Skeleton className="h-64" />
  if (settings.error) return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
  // one list for both: a part of the menu by its name, a single page by its address
  const hidden = settings.data?.hidden_menu_sections ?? []
  const sections = NAV.filter((s) => s.label !== 'Overview' && s.label !== 'Company')
  const toggle = (key: string, shown: boolean, name: string) => {
    const next = shown ? hidden.filter((h) => h !== key) : [...hidden, key]
    void save.mutateAsync({ hidden_menu_sections: next }).then(() =>
      toast.success(shown ? t('{part} is back in the menu', { part: name }) : t('{part} is hidden from the menu', { part: name })))
  }
  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>{t('Parts of the menu')}</CardTitle>
        <CardDescription>{t('Switch off what this company does not use, for example Manufacturing in a shop. It disappears from everyone\'s menu; nothing is deleted and you can switch it back on at any time. Each person can also pin the pages they use most with the star.')}</CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        {sections.map((s) => {
          const on = !hidden.includes(s.label)
          const pages = s.items.filter((i, n, all) => all.findIndex((x) => x.href === i.href) === n)
          return (
            <div key={s.label} className="py-1">
              <ToggleRow title={t(s.label)}
                description={on ? t('{n} of {total} pages shown', { n: pages.filter((i) => !hidden.includes(i.href)).length, total: pages.length }) : t('Hidden')}
                control={<Switch checked={on} disabled={!writable || save.isPending} aria-label={t(s.label)} onCheckedChange={(v) => toggle(s.label, v, t(s.label))} />} />
              {on && (
                <div className="flex flex-wrap gap-1.5 pb-3">
                  {pages.map((i) => {
                    const shown = !hidden.includes(i.href)
                    return (
                      <button key={i.href} type="button" disabled={!writable || save.isPending} aria-pressed={shown}
                        onClick={() => toggle(i.href, !shown, t(i.label))}
                        className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60',
                          shown ? 'border-primary/30 bg-accent text-accent-foreground' : 'border-dashed text-muted-foreground line-through decoration-muted-foreground/50 hover:text-foreground')}>
                        <i.icon className="size-3.5" />{t(i.label)}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
        <p className="pt-3 text-xs text-muted-foreground">{t('Click a page to hide it or bring it back. When the platform sets the type of business, the menu starts from what that business uses.')}</p>
      </CardContent>
    </Card>
  )
}
