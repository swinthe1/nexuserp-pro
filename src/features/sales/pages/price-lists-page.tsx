import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { Plus, Star, Trash2 } from 'lucide-react'
import * as React from 'react'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Can, useCompany } from '@/app/company-provider'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { ColumnHeader, DataTable } from '@/components/data-table/data-table'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { Tables } from '@/lib/database.types'
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn, formatDate, formatMoney, num } from '@/lib/utils'
import { useCurrencies, useVariantOptions } from '@/features/inventory/api'
import { VariantPicker } from '@/features/inventory/components/pickers'
import { useDeleteRecord, usePriceList, usePriceLists, useSavePriceList, useSellableVariants } from '../api'
import { priceListSchema, type PriceListValues } from '../schemas'
import { ErrorState } from '@/components/error-state'
import { formatNumberWith, msg, t, td } from '@/i18n'

type ListRow = Tables<'price_lists'> & { items: { count: number }[] }

export function PriceListsPage() {
  const navigate = useNavigate()
  const lists = usePriceLists()
  const columns = React.useMemo<ColumnDef<ListRow>[]>(() => [
    {
      accessorKey: 'name', enableHiding: false, header: ({ column }) => <ColumnHeader column={column} title={t('Name')} />, meta: { label: t('Name') },
      cell: ({ row: { original: p } }) => <span className="inline-flex items-center gap-2 font-medium">{td(p.name)}{p.is_default && <Badge variant="secondary"><Star className="size-3" /> {t('Default')}</Badge>}</span>,
    },
    { accessorKey: 'currency_code', header: t('Currency'), meta: { label: t('Currency') } },
    { id: 'items', accessorFn: (p) => p.items?.[0]?.count ?? 0, header: t('Prices'), meta: { label: t('Prices'), align: 'right' } },
    { accessorKey: 'prices_include_tax', header: t('VAT'), meta: { label: t('Prices include VAT'), exportValue: (p) => (p.prices_include_tax ? t('Included') : t('Not included')) }, cell: ({ getValue }) => (getValue() ? t('Included') : t('Not included')) },
    { id: 'valid', accessorFn: (p) => p.valid_from ?? '', header: t('Valid'), meta: { label: t('Validity') }, cell: ({ row: { original: p } }) => p.valid_from || p.valid_to ? `${p.valid_from ? formatDate(p.valid_from) : '…'} – ${p.valid_to ? formatDate(p.valid_to) : '…'}` : t('Always') },
    { accessorKey: 'is_active', header: t('Status'), meta: { label: t('Active'), exportValue: (p) => (p.is_active ? t('Active') : t('Inactive')) }, cell: ({ getValue }) => getValue() ? <Badge variant="success">{t('Active')}</Badge> : <Badge variant="secondary">{t('Inactive')}</Badge> },
  ], [])
  const newButton = <Can perm="sales.write"><Button asChild><Link to="/sales/price-lists/new"><Plus /> {t('New price list')}</Link></Button></Can>
  return (
    <>
      <PageHeader title={t('Price lists')} description={t('Wholesale, retail or channel prices, with prices by quantity. Give a customer a list and their documents get the right prices automatically.')} actions={newButton} />
      <DataTable tableKey="sales.price-lists" columns={columns} data={lists.data as ListRow[] | undefined} isLoading={lists.isLoading} error={lists.error}
        getRowId={(p) => p.id} exportName="price-lists" onRowClick={(p) => navigate(`/sales/price-lists/${p.id}`)}
        empty={{ title: t('No price lists yet'), description: t('Without one, documents use each product’s own sales price.'), action: newButton }} />
    </>
  )
}

export function PriceListPage() {
  const { id } = useParams()
  const pl = usePriceList(id)
  if (id && pl.isLoading) return <Skeleton className="mx-auto h-[420px] max-w-5xl" />
  if (id && pl.isError) return <ErrorState error={pl.error} onRetry={() => void pl.refetch()} />
  if (id && !pl.data) return <EmptyState title={t('Price list not found')} description={t('It may have been deleted.')} action={<Button asChild variant="outline"><Link to="/sales/price-lists">{t('Price lists')}</Link></Button>} />
  return <PriceListForm key={pl.data?.id ?? 'new'} pl={pl.data} />
}

function PriceListForm({ pl }: { pl?: Tables<'price_lists'> & { items: Tables<'price_list_items'>[] } }) {
  const navigate = useNavigate()
  const { company, can } = useCompany()
  const currencies = useCurrencies()
  const variants = useVariantOptions()
  const sellable = useSellableVariants()
  const save = useSavePriceList()
  const del = useDeleteRecord('price_lists')
  const writable = can('sales.write')
  const form = useForm<PriceListValues>({
    resolver: zodResolver(priceListSchema),
    defaultValues: pl ? {
      name: pl.name, currency_code: pl.currency_code, prices_include_tax: pl.prices_include_tax, is_default: pl.is_default, is_active: pl.is_active,
      valid_from: pl.valid_from ?? '', valid_to: pl.valid_to ?? '',
      items: [...pl.items].sort((a, b) => a.variant_id.localeCompare(b.variant_id) || a.min_quantity - b.min_quantity)
        .map((i) => ({ variant_id: i.variant_id, min_quantity: i.min_quantity, price: i.price, discount_pct: i.discount_pct, valid_from: i.valid_from ?? '', valid_to: i.valid_to ?? '' })),
    } : { name: '', currency_code: company?.base_currency ?? 'ALL', prices_include_tax: false, is_default: false, is_active: true, valid_from: '', valid_to: '', items: [] },
  })
  const items = useFieldArray({ control: form.control, name: 'items' })
  const watched = useWatch({ control: form.control, name: 'items' })
  const cur = useWatch({ control: form.control, name: 'currency_code' })
  const withTax = useWatch({ control: form.control, name: 'prices_include_tax' })
  const cost = React.useMemo(() => new Map((variants.data ?? []).map((v) => [v.id, v.avg_cost])), [variants.data])
  const basePrice = React.useMemo(() => new Map((sellable.data ?? []).map((v) => [v.id, v.sales_price])), [sellable.data])
  // each item's VAT rate: a list with VAT is compared with cost (and filled in) at the price with VAT taken out / put in
  const rates = useQuery({ queryKey: ['price-list-rates', company?.id], enabled: !!company?.id, staleTime: 5 * 60_000,
    queryFn: async () => unwrap(await supabase.from('product_variants').select('id, products!inner(sales_tax_code:tax_codes!products_company_id_sales_tax_code_id_fkey(rate))')
      .eq('company_id', company!.id).is('deleted_at', null).limit(5000)) as unknown as { id: string; products: { sales_tax_code: { rate: number } | null } }[] })
  const rateOf = React.useCallback((id: string) => num(rates.data?.find((r) => r.id === id)?.products.sales_tax_code?.rate), [rates.data])

  const submit = form.handleSubmit(async (v) => {
    const newId = await save.mutateAsync({
      header: { id: pl?.id, name: v.name, list_type: 'sales', currency_code: v.currency_code, prices_include_tax: v.prices_include_tax, is_default: v.is_default, is_active: v.is_active, valid_from: v.valid_from || null, valid_to: v.valid_to || null },
      items: v.items.map((i) => ({ variant_id: i.variant_id, min_quantity: i.min_quantity, price: i.price, discount_pct: i.discount_pct, valid_from: i.valid_from || null, valid_to: i.valid_to || null })),
    })
    toast.success(t('Price list saved'))
    if (!pl) navigate(`/sales/price-lists/${newId}`, { replace: true })
  }, () => toast.error(t('Fix the highlighted fields first')))

  return (
    <Form {...form}>
      <div className="mx-auto max-w-5xl">
        <PageHeader back={{ href: '/sales/price-lists', label: t('Price lists') }} title={pl?.name ? td(pl.name) : t('New price list')}
          actions={writable && <>
            {pl && <ConfirmDialog trigger={<Button variant="ghost" size="sm" className="text-destructive"><Trash2 /> {t('Delete')}</Button>} title={t('Delete {name}?', { name: td(pl.name) })}
              description={t('Customers using it go back to the default list. Documents already priced keep their prices.')} confirmLabel={t('Delete')} destructive
              onConfirm={async () => { await del.mutateAsync(pl.id); navigate('/sales/price-lists') }} />}
            <Button onClick={() => void submit()} loading={save.isPending}>{t('Save')}</Button>
          </>} />
        <Card>
          <CardContent className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem className="sm:col-span-2"><FormLabel>{t('Name')}</FormLabel><FormControl><Input placeholder={t('Wholesale')} disabled={!writable} {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="currency_code" render={({ field }) => (
              <FormItem><FormLabel>{t('Currency')}</FormLabel>
                <Select value={field.value} onValueChange={field.onChange} disabled={!writable}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>{(currencies.data ?? []).map((c) => <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>)}</SelectContent>
                </Select></FormItem>
            )} />
            <div className="grid grid-cols-2 gap-2">
              <FormField control={form.control} name="valid_from" render={({ field }) => (<FormItem><FormLabel optional>{t('From')}</FormLabel><FormControl><Input type="date" disabled={!writable} {...field} /></FormControl></FormItem>)} />
              <FormField control={form.control} name="valid_to" render={({ field }) => (<FormItem><FormLabel optional>{t('To')}</FormLabel><FormControl><Input type="date" disabled={!writable} {...field} /></FormControl></FormItem>)} />
            </div>
            {([
              ['is_default', msg('Default list'), msg('Used for customers without a list of their own.')],
              ['prices_include_tax', msg('Prices include VAT'), msg('For retail lists where the shelf price is final.')],
              ['is_active', msg('Active'), msg('Inactive lists are not used for prices.')],
            ] as const).map(([name, label, desc]) => (
              <FormField key={name} control={form.control} name={name} render={({ field }) => (
                <FormItem className="flex flex-row items-start gap-3 space-y-0 rounded-md border p-3 sm:col-span-2 lg:col-span-1">
                  <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} disabled={!writable} /></FormControl>
                  <div><FormLabel>{t(label)}</FormLabel><FormDescription>{t(desc)}</FormDescription></div>
                </FormItem>
              )} />
            ))}
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader className="flex-row items-center justify-between space-y-0 py-3">
            <CardTitle>{t('Prices')}</CardTitle>
            {writable && <Button size="sm" variant="outline" onClick={() => items.append({ variant_id: undefined as unknown as string, min_quantity: 1, price: 0, discount_pct: 0, valid_from: '', valid_to: '' })}><Plus /> {t('Add price')}</Button>}
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            {items.fields.length ? (
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="min-w-[220px]">{t('Product')}</TableHead><TableHead className="w-[110px] text-right">{t('From qty')}</TableHead>
                  <TableHead className="w-[140px] text-right">{withTax ? t('Price ({currency}, with VAT)', { currency: cur }) : t('Price ({currency}, without VAT)', { currency: cur })}</TableHead><TableHead className="w-[100px] text-right">{t('Discount %')}</TableHead>
                  <TableHead className="text-right">{t('Standard price (without VAT)')}</TableHead><TableHead className="text-right">{t('Margin')}</TableHead><TableHead className="w-10" />
                </TableRow></TableHeader>
                <TableBody>
                  {items.fields.map((f, i) => {
                    const it = watched[i]
                    const c = it?.variant_id ? cost.get(it.variant_id) : null
                    const net = num(it?.price) * (1 - num(it?.discount_pct) / 100) / (withTax && it?.variant_id ? 1 + rateOf(it.variant_id) / 100 : 1)
                    const margin = c != null && net > 0 && cur === company?.base_currency ? ((net - num(c)) / net) * 100 : null
                    return (
                      <TableRow key={f.id}>
                        <TableCell><FormField control={form.control} name={`items.${i}.variant_id`} render={({ field, fieldState }) => (
                          <FormItem><VariantPicker value={field.value} onChange={(v) => { field.onChange(v); if (v && !num(form.getValues(`items.${i}.price`))) form.setValue(`items.${i}.price`, Math.round(num(basePrice.get(v)) * (withTax ? 1 + rateOf(v) / 100 : 1) * 100) / 100) }} disabled={!writable} aria-invalid={!!fieldState.error} /><FormMessage /></FormItem>
                        )} /></TableCell>
                        <TableCell><FormField control={form.control} name={`items.${i}.min_quantity`} render={({ field }) => <FormItem><FormControl><Input type="number" step="any" className="text-right tabular" disabled={!writable} {...field} /></FormControl><FormMessage /></FormItem>} /></TableCell>
                        <TableCell><FormField control={form.control} name={`items.${i}.price`} render={({ field }) => <FormItem><FormControl><Input type="number" step="any" className="text-right tabular" disabled={!writable} {...field} /></FormControl><FormMessage /></FormItem>} /></TableCell>
                        <TableCell><FormField control={form.control} name={`items.${i}.discount_pct`} render={({ field }) => <FormItem><FormControl><Input type="number" step="any" className="text-right tabular" disabled={!writable} {...field} /></FormControl><FormMessage /></FormItem>} /></TableCell>
                        <TableCell className="text-right tabular text-muted-foreground">{it?.variant_id ? formatMoney(basePrice.get(it.variant_id)) : '—'}</TableCell>
                        <TableCell className={cn('text-right tabular', margin != null && margin < 10 && 'text-destructive')}>{margin == null ? '—' : `${formatNumberWith(margin, { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`}</TableCell>
                        <TableCell>{writable && <Button type="button" variant="ghost" size="icon" aria-label={t('Remove price')} onClick={() => items.remove(i)}><Trash2 /></Button>}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            ) : <EmptyState compact title={t('No prices yet')} description={t('Products without a price here use their standard sales price.')} />}
          </CardContent>
          <p className="px-4 py-3 text-xs text-muted-foreground">{t('For a lower price on bigger quantities, add the same product again with a higher “from qty”. The margin is calculated on the current average cost.')}</p>
        </Card>
      </div>
    </Form>
  )
}
