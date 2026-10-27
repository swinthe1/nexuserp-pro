import { PartnerCards } from '@/features/finance/pages/cards-page'
import { PortalLinks } from '@/features/portal/portal-links'
import { zodResolver } from '@hookform/resolvers/zod'
import type { ColumnDef } from '@tanstack/react-table'
import { FileText, Pencil, Plus, ShoppingCart, Star, Trash2, Upload } from 'lucide-react'
import * as React from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { registryFill } from '@/lib/registry'
import { SearchSelect } from '@/components/search-select'
import { RegistryLine } from '../components/registry-card'
import { AskDetailsButton } from '../components/ask-details'
import { toast } from 'sonner'
import { z } from 'zod'
import { Can, useCompany } from '@/app/company-provider'
import { ActivityTimeline } from '@/components/activity-timeline'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { ColumnHeader, DataTable, inFilter } from '@/components/data-table/data-table'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { SimpleFormDialog, type FieldSpec } from '@/components/simple-form-dialog'
import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import type { Tables } from '@/lib/database.types'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { formatDate, formatMoney, humanize, num } from '@/lib/utils'
import { useCurrencies } from '@/features/inventory/api'
import { VariantPicker } from '@/features/inventory/components/pickers'
import { useDeleteRecord, useMembers, usePartner, usePartnerActivity, usePartners, usePaymentTerms, usePriceLists, useSaveRecord, type PartnerDetail } from '../api'
import { partnerSchema, type PartnerValues } from '../schemas'
import { VendorPurchasing } from '@/features/procurement/components/vendor-purchasing'
import { VendorPricesTable } from '@/features/procurement/pages/vendor-prices-page'
import { ErrorState } from '@/components/error-state'
import { t, td } from '@/i18n'

type PartnerRow = NonNullable<ReturnType<typeof usePartners>['data']>[number]
const roleLabel = (r: string) => (r === 'both' ? t('Customer and vendor') : r === 'customer' ? t('Customer') : t('Vendor'))

export function PartnersPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const role = params.get('role')
  const partners = usePartners()
  const columns = React.useMemo<ColumnDef<PartnerRow>[]>(() => [
    { accessorKey: 'code', header: ({ column }) => <ColumnHeader column={column} title={t('Code')} />, meta: { label: t('Code') }, cell: ({ getValue }) => <span className="text-muted-foreground">{getValue() as string}</span> },
    {
      accessorKey: 'name', enableHiding: false, header: ({ column }) => <ColumnHeader column={column} title={t('Name')} />, meta: { label: t('Name') },
      cell: ({ row: { original: p } }) => <span className="font-medium">{p.name}{!p.is_active && <Badge variant="secondary" className="ml-2">{t('Inactive')}</Badge>}</span>,
    },
    {
      id: 'role', accessorFn: (p) => (p.is_customer && p.is_vendor ? 'both' : p.is_customer ? 'customer' : 'vendor'), filterFn: inFilter, header: t('Type'), meta: { label: t('Type'), exportValue: (p) => roleLabel(p.is_customer && p.is_vendor ? 'both' : p.is_customer ? 'customer' : 'vendor') },
      cell: ({ getValue }) => roleLabel(getValue() as string),
    },
    { accessorKey: 'tax_number', header: t('NIPT / NUI'), meta: { label: t('NIPT / NUI') }, cell: ({ getValue }) => (getValue() as string) || '—' },
    { accessorKey: 'email', header: t('Email'), meta: { label: t('Email') }, cell: ({ getValue }) => (getValue() as string) || '—' },
    { accessorKey: 'phone', header: t('Phone'), meta: { label: t('Phone') }, cell: ({ getValue }) => (getValue() as string) || '—' },
    { id: 'price_list', accessorFn: (p) => td((p.price_list as { name: string } | null)?.name ?? ''), filterFn: inFilter, header: t('Price list'), meta: { label: t('Price list') }, cell: ({ getValue }) => (getValue() as string) || <span className="text-muted-foreground">{t('Default')}</span> },
    { id: 'salesperson', accessorFn: (p) => (p.salesperson as { full_name: string | null } | null)?.full_name ?? '', filterFn: inFilter, header: t('Salesperson'), meta: { label: t('Salesperson') } },
    { accessorKey: 'credit_limit', header: ({ column }) => <ColumnHeader column={column} title={t('Credit limit')} />, meta: { label: t('Credit limit'), align: 'right' }, cell: ({ getValue }) => getValue() == null ? '—' : <span className="tabular">{formatMoney(getValue() as number)}</span> },
  ], [])
  const lists = [...new Set((partners.data ?? []).map((p) => (p.price_list as { name: string } | null)?.name).filter(Boolean).map((n) => td(n)))] as string[]
  const newButton = <Can perm="partners.write"><Button variant="outline" asChild><Link to="/settings/import?kind=partners"><Upload /> {t('Import')}</Link></Button><Button asChild><Link to={role === 'vendor' ? '/partners/new?vendor=1' : '/partners/new'}><Plus /> {role === 'vendor' ? t('New vendor') : t('New customer')}</Link></Button></Can>
  return (
    <>
      <PageHeader title={role === 'vendor' ? t('Vendors') : role === 'customer' ? t('Customers') : t('Customers and vendors')}
        description={t('Customers and vendors share one record: contacts, addresses, payment terms, special prices and vendor prices.')} actions={newButton} />
      <DataTable key={role ?? 'all'} tableKey="partners" columns={columns}
        initialFilters={role ? [{ id: 'role', value: role === 'vendor' ? ['vendor', 'both'] : ['customer', 'both'] }] : undefined} data={partners.data} isLoading={partners.isLoading} error={partners.error}
        getRowId={(p) => p.id} exportName="partners" searchPlaceholder={t('Name, code, NIPT, email…')} initialHidden={['phone']}
        onRowClick={(p) => navigate(`/partners/${p.id}`)}
        facets={[
          { columnId: 'role', title: t('Type'), options: [{ value: 'customer', label: t('Customer') }, { value: 'vendor', label: t('Vendor') }, { value: 'both', label: t('Both') }] },
          { columnId: 'price_list', title: t('Price list'), options: lists.map((l) => ({ value: l, label: l })) },
        ]}
        empty={role === 'vendor'
          ? { title: t('No vendors yet'), description: t('Add the companies you buy from.'), action: newButton }
          : { title: t('No customers yet'), description: t('Add your first customer, or convert a lead.'), action: newButton }} />
    </>
  )
}

export function PartnerPage() {
  const { id } = useParams()
  const partner = usePartner(id)
  if (id && partner.isLoading) return <Skeleton className="mx-auto h-[420px] max-w-5xl" />
  if (id && partner.isError) return <ErrorState error={partner.error} onRetry={() => void partner.refetch()} />
  if (id && !partner.data) return <EmptyState title={t('Customer or vendor not found')} description={t('It may have been deleted.')} action={<Button asChild variant="outline"><Link to="/partners">{t('Customers and vendors')}</Link></Button>} />
  return <PartnerView key={partner.data?.id ?? 'new'} partner={partner.data} />
}

function PartnerView({ partner }: { partner?: PartnerDetail }) {
  const [params] = useSearchParams()
  const { can } = useCompany()
  if (!partner) {
    return (
      <div className="mx-auto max-w-5xl">
        <PageHeader back={{ href: '/partners', label: t('Customers and vendors') }} title={params.get('vendor') ? t('New vendor') : t('New customer')} />
        <PartnerForm />
      </div>
    )
  }
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader back={{ href: '/partners', label: t('Customers and vendors') }} title={partner.name}
        meta={<>{partner.is_customer && <Badge variant="outline">{t('Customer')}</Badge>}{partner.is_vendor && <Badge variant="outline">{t('Vendor')}</Badge>}{!partner.is_active && <Badge variant="secondary">{t('Inactive')}</Badge>}</>}
        description={[partner.code, partner.tax_number && `NIPT ${partner.tax_number}`, partner.email, partner.phone].filter(Boolean).join(' · ')}
        actions={<>
          <Can perm="partners.write"><AskDetailsButton partnerId={partner.id} /></Can>
          {partner.is_vendor && <Can perm="procurement.write"><Button variant={partner.is_customer ? 'outline' : 'default'} asChild><Link to={`/procurement/orders/new?vendor=${partner.id}`}><ShoppingCart /> {t('New purchase order')}</Link></Button></Can>}
          {partner.is_customer && <Can perm="sales.write">
            <Button variant="outline" asChild><Link to={`/sales/quotes/new?customer=${partner.id}`}><FileText /> {t('New quote')}</Link></Button>
            <Button asChild><Link to={`/sales/orders/new?customer=${partner.id}`}><ShoppingCart /> {t('New order')}</Link></Button>
          </Can>}
        </>} />
      <RegistryLine partnerId={partner.id} />
      <Tabs defaultValue={partner.is_customer ? 'overview' : 'purchasing'}>
        <TabsList>
          {partner.is_customer && <TabsTrigger value="overview">{t('Overview')}</TabsTrigger>}
          <TabsTrigger value="details">{t('Details')}</TabsTrigger>
          <TabsTrigger value="contacts">{t('Contacts and addresses')}</TabsTrigger>
          {partner.is_customer && <TabsTrigger value="prices">{t('Special prices')}</TabsTrigger>}
          {partner.is_customer && can('sales.read') && <TabsTrigger value="portal">{t('B2B portal')}</TabsTrigger>}
          {can('invoicing.read') && <TabsTrigger value="card">{t('Card')}</TabsTrigger>}
          {partner.is_vendor && <TabsTrigger value="purchasing">{t('Purchasing')}</TabsTrigger>}
          {partner.is_vendor && <TabsTrigger value="vendor-prices">{t('Vendor prices')}</TabsTrigger>}
          <TabsTrigger value="activity">{t('Activity')}</TabsTrigger>
        </TabsList>
        {partner.is_customer && <TabsContent value="overview"><PartnerOverview partner={partner} /></TabsContent>}
        <TabsContent value="details"><PartnerForm partner={partner} /></TabsContent>
        <TabsContent value="contacts"><ContactsAndAddresses partner={partner} /></TabsContent>
        {partner.is_customer && <TabsContent value="prices"><SpecialPrices partner={partner} /></TabsContent>}
        {partner.is_customer && can('sales.read') && <TabsContent value="portal"><PortalLinks partner={partner} /></TabsContent>}
        {can('invoicing.read') && <TabsContent value="card"><PartnerCards partnerId={partner.id} isCustomer={partner.is_customer} isVendor={partner.is_vendor} /></TabsContent>}
        {partner.is_vendor && <TabsContent value="purchasing"><VendorPurchasing vendorId={partner.id} /></TabsContent>}
        {partner.is_vendor && <TabsContent value="vendor-prices"><VendorPricesTable vendorId={partner.id} /></TabsContent>}
        <TabsContent value="activity" className="max-w-2xl"><ActivityTimeline table="business_partners" id={partner.id} /></TabsContent>
      </Tabs>
    </div>
  )
}

/* ------------------------------------------------------------- overview */
function PartnerOverview({ partner }: { partner: PartnerDetail }) {
  const { company } = useCompany()
  const act = usePartnerActivity(partner.id)
  const base = company?.base_currency ?? 'ALL'
  const posted = (act.data?.invoices ?? []).filter((i) => i.status === 'posted')
  const sign = (i: { document_type: string }) => (i.document_type === 'credit_note' ? -1 : 1)
  // amounts in different currencies are never added together: one total per currency
  const perCurrency = (rows: typeof posted, f: (i: (typeof posted)[number]) => number) => {
    const m = new Map<string, number>()
    for (const i of rows) m.set(i.currency_code ?? base, (m.get(i.currency_code ?? base) ?? 0) + f(i))
    return m
  }
  const show = (m: Map<string, number>) => [...m].filter(([, v]) => Math.abs(v) >= 0.005).map(([c, v]) => `${formatMoney(v)} ${c}`).join(' + ') || `${formatMoney(0)} ${base}`
  const openBy = perCurrency(posted, (i) => sign(i) * num(i.amount_due))
  const open = openBy.get(base) ?? 0
  const overdueBy = perCurrency(posted.filter((i) => i.document_type !== 'credit_note' && i.payment_status !== 'paid' && i.due_date < new Date().toISOString().slice(0, 10)), (i) => num(i.amount_due))
  const overdue = [...overdueBy.values()].reduce((s, v) => s + v, 0)
  const openOrders = (act.data?.orders ?? []).filter((o) => ['pending_approval', 'confirmed', 'partially_delivered'].includes(o.status))
  const limit = partner.credit_limit
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label={t('Still to pay')} value={show(openBy)} hint={overdue > 0 ? <span className="text-destructive">{t('{amount} overdue', { amount: show(overdueBy) })}</span> : t('Nothing overdue')} />
        <Metric label={t('Open orders')} value={openOrders.length} hint={t('{amount} not fully invoiced yet', { amount: formatMoney(openOrders.reduce((s, o) => s + num(o.total), 0)) })} />
        <Metric label={t('Credit limit')} value={limit == null ? t('No limit') : `${formatMoney(limit)} ${base}`}
          hint={limit != null ? t('{amount} still available', { amount: formatMoney(Math.max(0, limit - open - openOrders.reduce((s, o) => s + num(o.total), 0))) }) : t('Orders are never blocked for credit')} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <DocList title={t('Orders')} empty={t('No orders yet.')} rows={(act.data?.orders ?? []).map((o) => ({ id: o.id, href: `/sales/orders/${o.id}`, number: o.number, date: o.order_date, status: o.status, amount: `${formatMoney(o.total)} ${o.currency_code}` }))} />
        <DocList title={t('Invoices')} empty={t('No invoices yet.')} rows={(act.data?.invoices ?? []).map((i) => ({ id: i.id, href: `/sales/invoices/${i.id}`, number: i.number, date: i.invoice_date, status: i.status === 'posted' ? i.payment_status : i.status, amount: `${formatMoney(sign(i) * num(i.total))} ${i.currency_code}` }))} />
      </div>
      {!!act.data?.opportunities.length && (
        <DocList title={t('Deals')} empty="" rows={act.data.opportunities.map((o) => ({ id: o.id, href: `/crm/pipeline?open=${o.id}`, number: o.name, date: null, status: o.status, amount: `${formatMoney(o.expected_value)} ${o.currency_code}` }))} />
      )}
    </div>
  )
}

function Metric({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return <div className="rounded-lg border bg-card p-4"><div className="text-[13px] text-muted-foreground">{label}</div><div className="tabular mt-1 text-xl font-semibold">{value}</div>{hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}</div>
}

function DocList({ title, rows, empty }: { title: string; empty: string; rows: { id: string; href: string; number: string; date: string | null; status: string; amount: string }[] }) {
  return (
    <Card>
      <CardHeader className="py-3"><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent className="p-0">
        {rows.length ? (
          <ul className="divide-y">
            {rows.map((r) => (
              <li key={r.id}><Link to={r.href} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-4 py-2 text-[13px] hover:bg-secondary/60">
                <span><span className="font-medium">{r.number}</span>{r.date && <span className="ml-2 text-muted-foreground">{formatDate(r.date)}</span>}</span>
                <StatusBadge status={r.status} /><span className="tabular w-32 text-right">{r.amount}</span>
              </Link></li>
            ))}
          </ul>
        ) : <p className="px-4 pb-4 text-[13px] text-muted-foreground">{empty}</p>}
      </CardContent>
    </Card>
  )
}

/* ---------------------------------------------------------------- form */
function PartnerForm({ partner }: { partner?: PartnerDetail }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { company, companyId, can } = useCompany()
  const terms = usePaymentTerms()
  const lists = usePriceLists()
  const members = useMembers()
  const currencies = useCurrencies()
  const save = useSaveRecord('business_partners')
  const writable = can('partners.write')
  const vendor = !!params.get('vendor')
  const form = useForm<PartnerValues>({
    resolver: zodResolver(partnerSchema),
    defaultValues: {
      code: partner?.code ?? '', name: partner?.name ?? '', legal_name: partner?.legal_name ?? '', kind: (partner?.kind as PartnerValues['kind']) ?? 'company',
      is_customer: partner?.is_customer ?? !vendor, is_vendor: partner?.is_vendor ?? vendor, tax_number: partner?.tax_number ?? '', vat_number: partner?.vat_number ?? '',
      email: partner?.email ?? '', phone: partner?.phone ?? '', website: partner?.website ?? '', currency_code: partner?.currency_code ?? null,
      payment_term_id: partner?.payment_term_id ?? null, price_list_id: partner?.price_list_id ?? null, default_discount_pct: partner?.default_discount_pct ?? 0,
      credit_limit: partner?.credit_limit ?? null, salesperson_id: partner?.salesperson_id ?? null, notes: partner?.notes ?? '', is_active: partner?.is_active ?? true,
    },
  })
  const submit = form.handleSubmit(async (v) => {
    try {
      let code = v.code
      if (!code) code = unwrap(await supabase.rpc('next_partner_code', { p_company: companyId, p_kind: v.is_customer ? 'customer' : 'vendor' }))
      const blank = (s?: string | null) => (s ? s : null)
      const row = await save.mutateAsync({
        id: partner?.id, ...v, code, legal_name: blank(v.legal_name), tax_number: blank(v.tax_number), vat_number: blank(v.vat_number), email: blank(v.email),
        phone: blank(v.phone), website: blank(v.website), notes: blank(v.notes), currency_code: v.currency_code ?? null, payment_term_id: v.payment_term_id ?? null,
        price_list_id: v.price_list_id ?? null, salesperson_id: v.salesperson_id ?? null,
      })
      toast.success(partner ? t('Saved') : t('{name} added', { name: v.name }))
      if (!partner) navigate(`/partners/${row.id}`, { replace: true })
    } catch (e) { toast.error(describeError(e)) }
  })
  const isCustomer = form.watch('is_customer')
  return (
    <Form {...form}>
      <form onSubmit={submit} className="grid gap-4">
        {!partner && writable && <Card><CardContent className="grid gap-1.5 p-4">
          <span className="text-sm font-medium">{t('Find it in the business register (ARBK)')}</span>
          <SearchSelect value={null} onChange={() => {}} options={[]} placeholder={t('NUI or name of the business')} emptyText={t('Type the NUI or at least 3 letters of the name.')}
            remote={registryFill((b) => {
              const o = { shouldDirty: true }
              form.setValue('name', b.trade_name || b.name, o); form.setValue('legal_name', b.name, o); form.setValue('tax_number', b.nui, o)
              form.setValue('kind', b.legal_form === 'Biznes individual' && !b.trade_name ? 'individual' : 'company', o)
              if (b.phone) form.setValue('phone', b.phone, o)
              if (b.email) form.setValue('email', b.email, o)
              if (!form.getValues('notes')) form.setValue('notes', [b.legal_form, b.activity, b.city].filter(Boolean).join(' · '), o)
              if (!b.active) toast.warning(t('{name} is {status} in the business register', { name: b.name, status: b.status ?? '' }))
            })} />
          <span className="text-xs text-muted-foreground">{t('The official name, NUI and details are filled in from the register.')}</span>
        </CardContent></Card>}
        <Card>
          <CardHeader><CardTitle>{t('Basic details')}</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FormField control={form.control} name="name" render={({ field }) => (<FormItem className="lg:col-span-2"><FormLabel>{t('Name')}</FormLabel><FormControl><Input disabled={!writable} {...field} /></FormControl><FormMessage /></FormItem>)} />
            <FormField control={form.control} name="code" render={({ field }) => (<FormItem><FormLabel optional>{t('Code')}</FormLabel><FormControl><Input placeholder={t('Assigned automatically')} disabled={!writable} {...field} /></FormControl></FormItem>)} />
            <FormField control={form.control} name="kind" render={({ field }) => (
              <FormItem><FormLabel>{t('Type')}</FormLabel>
                <Select value={field.value} onValueChange={field.onChange} disabled={!writable}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent><SelectItem value="company">{t('Business')}</SelectItem><SelectItem value="individual">{t('Individual')}</SelectItem></SelectContent></Select></FormItem>
            )} />
            <FormField control={form.control} name="tax_number" render={({ field }) => (<FormItem><FormLabel optional>{t('NIPT / NUI')}</FormLabel><FormControl><Input className="uppercase" disabled={!writable} {...field} /></FormControl><FormDescription>{t('Required on fiscal invoices to businesses.')}</FormDescription></FormItem>)} />
            <FormField control={form.control} name="legal_name" render={({ field }) => (<FormItem><FormLabel optional>{t('Legal name')}</FormLabel><FormControl><Input placeholder="… sh.p.k." disabled={!writable} {...field} /></FormControl></FormItem>)} /> {/* i18n-ignore */}
            <FormField control={form.control} name="email" render={({ field }) => (<FormItem><FormLabel optional>{t('Email')}</FormLabel><FormControl><Input type="email" disabled={!writable} {...field} /></FormControl><FormMessage /></FormItem>)} />
            <FormField control={form.control} name="phone" render={({ field }) => (<FormItem><FormLabel optional>{t('Phone')}</FormLabel><FormControl><Input type="tel" disabled={!writable} {...field} /></FormControl></FormItem>)} />
            <FormField control={form.control} name="website" render={({ field }) => (<FormItem><FormLabel optional>{t('Website')}</FormLabel><FormControl><Input disabled={!writable} {...field} /></FormControl></FormItem>)} />
            <div className="flex flex-wrap gap-6 sm:col-span-2 lg:col-span-3">
              {(['is_customer', 'is_vendor', 'is_active'] as const).map((n) => (
                <FormField key={n} control={form.control} name={n} render={({ field }) => (
                  <FormItem className="flex items-center gap-2 space-y-0"><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} disabled={!writable} /></FormControl>
                    <FormLabel>{{ is_customer: t('Customer'), is_vendor: t('Vendor'), is_active: t('Active') }[n]}</FormLabel>{n === 'is_customer' && <FormMessage />}</FormItem>
                )} />
              ))}
            </div>
          </CardContent>
        </Card>
        {isCustomer && (
          <Card>
            <CardHeader><CardTitle>{t('Sales terms')}</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <FormField control={form.control} name="price_list_id" render={({ field }) => (
                <FormItem><FormLabel optional>{t('Price list')}</FormLabel>
                  <Select value={field.value ?? '__none'} onValueChange={(v) => field.onChange(v === '__none' ? null : v)} disabled={!writable}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent><SelectItem value="__none">{t('Default list')}</SelectItem>{(lists.data ?? []).map((l) => <SelectItem key={l.id} value={l.id}>{td(l.name)}</SelectItem>)}</SelectContent></Select></FormItem>
              )} />
              <FormField control={form.control} name="default_discount_pct" render={({ field }) => (
                <FormItem><FormLabel>{t('Standard discount %')}</FormLabel><FormControl><Input type="number" step="any" className="tabular" disabled={!writable} {...field} /></FormControl>
                  <FormDescription>{t('Applied to every line unless a special price says otherwise.')}</FormDescription><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="payment_term_id" render={({ field }) => (
                <FormItem><FormLabel optional>{t('Payment terms')}</FormLabel>
                  <Select value={field.value ?? ''} onValueChange={field.onChange} disabled={!writable}><FormControl><SelectTrigger><SelectValue placeholder={t('Immediate')} /></SelectTrigger></FormControl>
                    <SelectContent>{(terms.data ?? []).map((x) => <SelectItem key={x.id} value={x.id}>{td(x.name)}</SelectItem>)}</SelectContent></Select></FormItem>
              )} />
              <FormField control={form.control} name="credit_limit" render={({ field }) => (
                <FormItem><FormLabel optional>{t('Credit limit ({currency})', { currency: company?.base_currency ?? '' })}</FormLabel><FormControl><Input type="number" step="any" className="tabular" placeholder={t('No limit')} disabled={!writable} {...field} value={field.value ?? ''} /></FormControl>
                  <FormDescription>{t('Orders above it need a sales manager to confirm.')}</FormDescription><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="currency_code" render={({ field }) => (
                <FormItem><FormLabel optional>{t('Invoice currency')}</FormLabel>
                  <Select value={field.value ?? '__none'} onValueChange={(v) => field.onChange(v === '__none' ? null : v)} disabled={!writable}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent><SelectItem value="__none">{t('Company currency')}</SelectItem>{(currencies.data ?? []).map((c) => <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>)}</SelectContent></Select></FormItem>
              )} />
              <FormField control={form.control} name="salesperson_id" render={({ field }) => (
                <FormItem><FormLabel optional>{t('Salesperson')}</FormLabel>
                  <Select value={field.value ?? ''} onValueChange={field.onChange} disabled={!writable}><FormControl><SelectTrigger><SelectValue placeholder={t('Unassigned')} /></SelectTrigger></FormControl>
                    <SelectContent>{(members.data ?? []).map((m) => <SelectItem key={m.id} value={m.id}>{m.full_name ?? m.email}</SelectItem>)}</SelectContent></Select></FormItem>
              )} />
            </CardContent>
          </Card>
        )}
        <Card><CardContent className="p-4">
          <FormField control={form.control} name="notes" render={({ field }) => (<FormItem><FormLabel optional>{t('Internal notes')}</FormLabel><FormControl><Textarea rows={3} disabled={!writable} {...field} /></FormControl></FormItem>)} />
        </CardContent></Card>
        {writable && <div className="flex justify-end"><Button type="submit" loading={save.isPending}>{partner ? t('Save changes') : t('Add')}</Button></div>}
      </form>
    </Form>
  )
}

/* ------------------------------------------------- contacts & addresses */
const contactSchema = z.object({
  name: z.string().trim().min(2, 'Enter a name'), job_title: z.string().trim().optional(),
  email: z.string().trim().email('Enter a valid email').or(z.literal('')).optional(), phone: z.string().trim().optional(), is_primary: z.boolean(),
})
type ContactValues = z.infer<typeof contactSchema>
const contactFields = (): FieldSpec<ContactValues>[] => [
  { name: 'name', label: t('Name') }, { name: 'job_title', label: t('Job title'), optional: true, half: true }, { name: 'phone', label: t('Phone'), optional: true, half: true },
  { name: 'email', label: t('Email'), optional: true }, { name: 'is_primary', label: t('Main contact'), type: 'switch' },
]
const addressSchema = z.object({
  label: z.string().trim().optional(), address_type: z.enum(['billing', 'shipping', 'both']), line1: z.string().trim().min(2, 'Enter the street'),
  city: z.string().trim().min(2, 'Enter the city'), postal_code: z.string().trim().optional(), country_code: z.enum(['AL', 'XK', 'MK', 'ME', 'IT', 'DE', 'GR']), is_default: z.boolean(),
})
type AddressValues = z.infer<typeof addressSchema>
const addressFields = (): FieldSpec<AddressValues>[] => [
  { name: 'label', label: t('Label'), optional: true, placeholder: t('Main warehouse'), half: true },
  { name: 'address_type', label: t('Used for'), type: 'select', half: true, options: [{ value: 'both', label: t('Invoices and deliveries') }, { value: 'billing', label: t('Invoices') }, { value: 'shipping', label: t('Deliveries') }] },
  { name: 'line1', label: t('Street') }, { name: 'city', label: t('City'), half: true }, { name: 'postal_code', label: t('Postal code'), optional: true, half: true },
  { name: 'country_code', label: t('Country'), type: 'select', half: true, options: [{ value: 'AL', label: t('Albania') }, { value: 'XK', label: t('Kosovo') }, { value: 'MK', label: t('North Macedonia') }, { value: 'ME', label: t('Montenegro') }, { value: 'IT', label: t('Italy') }, { value: 'DE', label: t('Germany') }, { value: 'GR', label: t('Greece') }] },
  { name: 'is_default', label: t('Default address'), type: 'switch', half: true },
]

function ContactsAndAddresses({ partner }: { partner: PartnerDetail }) {
  const { can } = useCompany()
  const saveContact = useSaveRecord('partner_contacts')
  const delContact = useDeleteRecord('partner_contacts')
  const saveAddress = useSaveRecord('partner_addresses')
  const delAddress = useDeleteRecord('partner_addresses')
  const [editContact, setEditContact] = React.useState<Tables<'partner_contacts'> | 'new' | null>(null)
  const [editAddress, setEditAddress] = React.useState<Tables<'partner_addresses'> | 'new' | null>(null)
  const writable = can('partners.write')
  const c = editContact === 'new' ? null : editContact
  const a = editAddress === 'new' ? null : editAddress
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 py-3"><CardTitle>{t('Contacts')}</CardTitle>{writable && <Button size="sm" variant="outline" onClick={() => setEditContact('new')}><Plus /> {t('Add')}</Button>}</CardHeader>
        <CardContent className="p-0">
          {partner.contacts.length ? <ul className="divide-y">{partner.contacts.map((x) => (
            <li key={x.id} className="flex items-start justify-between gap-2 px-4 py-2.5 text-[13px]">
              <div><div className="font-medium">{x.name}{x.is_primary && <Star className="ml-1 inline size-3 fill-current text-warning" aria-label={t('Main contact')} />}</div>
                <div className="text-muted-foreground">{[x.job_title, x.email, x.phone].filter(Boolean).join(' · ')}</div></div>
              {writable && <div className="flex"><Button size="icon" variant="ghost" aria-label={t('Edit contact')} onClick={() => setEditContact(x)}><Pencil /></Button>
                <ConfirmDialog trigger={<Button size="icon" variant="ghost" aria-label={t('Remove contact')}><Trash2 /></Button>} title={t('Remove {name}?', { name: x.name })} description={t('The contact is removed from this customer or vendor.')} confirmLabel={t('Remove')} destructive onConfirm={() => delContact.mutateAsync(x.id)} /></div>}
            </li>))}</ul> : <p className="px-4 pb-4 text-[13px] text-muted-foreground">{t('No contacts yet.')}</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 py-3"><CardTitle>{t('Addresses')}</CardTitle>{writable && <Button size="sm" variant="outline" onClick={() => setEditAddress('new')}><Plus /> {t('Add')}</Button>}</CardHeader>
        <CardContent className="p-0">
          {partner.addresses.length ? <ul className="divide-y">{partner.addresses.map((x) => (
            <li key={x.id} className="flex items-start justify-between gap-2 px-4 py-2.5 text-[13px]">
              <div><div className="font-medium">{x.label || humanize(x.address_type)}{x.is_default && <Badge variant="secondary" className="ml-2">{t('Default')}</Badge>}</div>
                <div className="text-muted-foreground">{x.line1}, {[x.postal_code, x.city].filter(Boolean).join(' ')}, {x.country_code}</div></div>
              {writable && <div className="flex"><Button size="icon" variant="ghost" aria-label={t('Edit address')} onClick={() => setEditAddress(x)}><Pencil /></Button>
                <ConfirmDialog trigger={<Button size="icon" variant="ghost" aria-label={t('Remove address')}><Trash2 /></Button>} title={t('Remove this address?')} description={t('Documents that already used it keep it.')} confirmLabel={t('Remove')} destructive onConfirm={() => delAddress.mutateAsync(x.id)} /></div>}
            </li>))}</ul> : <p className="px-4 pb-4 text-[13px] text-muted-foreground">{t('No addresses yet.')}</p>}
        </CardContent>
      </Card>
      <SimpleFormDialog open={!!editContact} onOpenChange={(o) => !o && setEditContact(null)} title={c ? t('Edit contact') : t('New contact')} schema={contactSchema}
        defaultValues={{ name: c?.name ?? '', job_title: c?.job_title ?? '', email: c?.email ?? '', phone: c?.phone ?? '', is_primary: c?.is_primary ?? !partner.contacts.length }}
        fields={contactFields()} submitLabel={c ? t('Save') : t('Add contact')}
        onSubmit={(v) => saveContact.mutateAsync({ id: c?.id, partner_id: partner.id, ...v, email: v.email || null, phone: v.phone || null, job_title: v.job_title || null })} />
      <SimpleFormDialog open={!!editAddress} onOpenChange={(o) => !o && setEditAddress(null)} title={a ? t('Edit address') : t('New address')} schema={addressSchema}
        defaultValues={{ label: a?.label ?? '', address_type: (a?.address_type as AddressValues['address_type']) ?? 'both', line1: a?.line1 ?? '', city: a?.city ?? '', postal_code: a?.postal_code ?? '', country_code: (a?.country_code as AddressValues['country_code']) ?? 'AL', is_default: a?.is_default ?? !partner.addresses.length }}
        fields={addressFields()} submitLabel={a ? t('Save') : t('Add address')}
        onSubmit={(v) => saveAddress.mutateAsync({ id: a?.id, partner_id: partner.id, ...v, label: v.label || null, postal_code: v.postal_code || null })} />
    </div>
  )
}

/* ------------------------------------------------------- special prices */
function SpecialPrices({ partner }: { partner: PartnerDetail }) {
  const { can, company } = useCompany()
  const save = useSaveRecord('partner_prices')
  const del = useDeleteRecord('partner_prices')
  const [edit, setEdit] = React.useState<PartnerDetail['prices'][number] | 'new' | null>(null)
  const writable = can('sales.write')
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 py-3">
        <div><CardTitle>{t('Special prices')}</CardTitle><p className="mt-1 text-xs text-muted-foreground">{t('Agreed prices or discounts for this customer. They come before the price list.')}</p></div>
        {writable && <Button size="sm" variant="outline" onClick={() => setEdit('new')}><Plus /> {t('Add')}</Button>}
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        {partner.prices.length ? (
          <Table>
            <TableHeader><TableRow><TableHead>{t('Product')}</TableHead><TableHead className="text-right">{t('From qty')}</TableHead><TableHead className="text-right">{t('Price')}</TableHead><TableHead className="text-right">{t('Discount')}</TableHead><TableHead>{t('Valid')}</TableHead><TableHead className="w-20" /></TableRow></TableHeader>
            <TableBody>
              {partner.prices.map((p) => (
                <TableRow key={p.id}>
                  <TableCell><div className="font-medium">{p.variant.sku}</div><div className="text-xs text-muted-foreground">{p.variant.name}</div></TableCell>
                  <TableCell className="text-right tabular">{num(p.min_quantity)}</TableCell>
                  <TableCell className="text-right tabular">{p.price == null ? <span className="text-muted-foreground">{t('List price')}</span> : `${formatMoney(p.price)} ${company?.base_currency}`}</TableCell>
                  <TableCell className="text-right tabular">{num(p.discount_pct) ? `${num(p.discount_pct)}%` : '—'}</TableCell>
                  <TableCell className="text-[13px] text-muted-foreground">{p.valid_from || p.valid_to ? `${p.valid_from ? formatDate(p.valid_from) : '…'} – ${p.valid_to ? formatDate(p.valid_to) : '…'}` : t('Always')}</TableCell>
                  <TableCell>{writable && <div className="flex justify-end"><Button size="icon" variant="ghost" aria-label={t('Edit price')} onClick={() => setEdit(p)}><Pencil /></Button>
                    <ConfirmDialog trigger={<Button size="icon" variant="ghost" aria-label={t('Remove price')}><Trash2 /></Button>} title={t('Remove this special price?')} description={t('New documents go back to the price list.')} confirmLabel={t('Remove')} destructive onConfirm={() => del.mutateAsync(p.id)} /></div>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : <EmptyState compact title={t('No special prices')} description={t('This customer pays their price list, less their standard discount.')} />}
      </CardContent>
      <PriceDialog key={edit === 'new' ? 'new' : edit?.id ?? 'none'} open={!!edit} initial={edit === 'new' ? undefined : edit ?? undefined} onClose={() => setEdit(null)}
        onSave={(v) => save.mutateAsync({ id: edit !== 'new' ? edit?.id : undefined, partner_id: partner.id, ...v })} />
    </Card>
  )
}

function PriceDialog({ open, initial, onClose, onSave }: { open: boolean; initial?: Tables<'partner_prices'>; onClose: () => void; onSave: (v: Record<string, unknown>) => Promise<unknown> }) {
  const [variant, setVariant] = React.useState<string | null>(initial?.variant_id ?? null)
  const [mode, setMode] = React.useState<'price' | 'discount'>(initial && initial.price == null ? 'discount' : 'price')
  const [price, setPrice] = React.useState(initial?.price?.toString() ?? '')
  const [disc, setDisc] = React.useState(initial?.discount_pct?.toString() ?? '0')
  const [minQty, setMinQty] = React.useState(initial?.min_quantity?.toString() ?? '1')
  const [from, setFrom] = React.useState(initial?.valid_from ?? '')
  const [to, setTo] = React.useState(initial?.valid_to ?? '')
  const [busy, setBusy] = React.useState(false)
  const valid = !!variant && num(minQty) > 0 && (mode === 'price' ? price !== '' && num(price) >= 0 : num(disc) > 0 && num(disc) <= 100)
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{initial ? t('Edit special price') : t('New special price')}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label>{t('Product')}</Label><VariantPicker value={variant} onChange={setVariant} /></div>
          <div className="flex rounded-md border p-0.5" role="radiogroup" aria-label={t('Kind of agreement')}>
            <Button type="button" size="sm" className="h-7 flex-1" variant={mode === 'price' ? 'secondary' : 'ghost'} onClick={() => setMode('price')} aria-pressed={mode === 'price'}>{t('Fixed price')}</Button>
            <Button type="button" size="sm" className="h-7 flex-1" variant={mode === 'discount' ? 'secondary' : 'ghost'} onClick={() => setMode('discount')} aria-pressed={mode === 'discount'}>{t('Discount on the list price')}</Button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {mode === 'price' && <div className="grid gap-1.5"><Label htmlFor="pp-price">{t('Price')}</Label><Input id="pp-price" type="number" step="any" className="tabular" value={price} onChange={(e) => setPrice(e.target.value)} /></div>}
            <div className="grid gap-1.5"><Label htmlFor="pp-disc">{t('Discount %')}</Label><Input id="pp-disc" type="number" step="any" className="tabular" value={disc} onChange={(e) => setDisc(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label htmlFor="pp-min">{t('From quantity')}</Label><Input id="pp-min" type="number" step="any" className="tabular" value={minQty} onChange={(e) => setMinQty(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label htmlFor="pp-from">{t('Valid from')}</Label><Input id="pp-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label htmlFor="pp-to">{t('Valid to')}</Label><Input id="pp-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button disabled={!valid} loading={busy} onClick={async () => {
            setBusy(true)
            try {
              await onSave({ variant_id: variant, price: mode === 'price' ? num(price) : null, discount_pct: num(disc), min_quantity: num(minQty), valid_from: from || null, valid_to: to || null })
              toast.success(t('Special price saved')); onClose()
            } catch (e) { toast.error(describeError(e)) } finally { setBusy(false) }
          }}>{t('Save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
