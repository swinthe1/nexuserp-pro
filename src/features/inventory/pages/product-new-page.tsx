import { zodResolver } from '@hookform/resolvers/zod'
import { Plus, Sparkles, Trash2, X } from 'lucide-react'
import * as React from 'react'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { FormSection } from '@/components/form-section'
import { PageHeader } from '@/components/page-header'
import { SearchSelect } from '@/components/search-select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { describeError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { useAttributes, useCategories, useCreateProduct, useTaxCodes, useUnits, useWarehouses, type AttributeWithValues } from '../api'
import { VendorPicker } from '../components/pickers'
import { productSchema, type ProductFormValues } from '../schemas'
import { t, td, tn, tr } from '@/i18n'

const skuPart = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase()

/** cartesian product of the selected attribute values */
function buildMatrix(attrs: AttributeWithValues[], selected: Record<string, string[]>) {
  const lists = attrs
    .map((a) => a.product_attribute_values.filter((v) => selected[a.id]?.includes(v.id)).sort((x, y) => x.sort_order - y.sort_order))
    .filter((l) => l.length > 0)
  if (!lists.length) return [] as { ids: string[]; labels: string[] }[]
  return lists.reduce<{ ids: string[]; labels: string[] }[]>(
    (acc, list) => acc.flatMap((c) => list.map((v) => ({ ids: [...c.ids, v.id], labels: [...c.labels, v.value] }))),
    [{ ids: [], labels: [] }],
  )
}

export function ProductNewPage() {
  const navigate = useNavigate()
  const { company } = useCompany()
  const units = useUnits()
  const categories = useCategories()
  const taxes = useTaxCodes()
  const attributes = useAttributes()
  const warehouses = useWarehouses()
  const create = useCreateProduct()

  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      code: '', name: '', description: '', product_type: 'stockable', category_id: null, uom_id: '', tracking: 'none',
      track_expiry: false, is_sellable: true, is_purchasable: true, sales_price: 0, sales_tax_code_id: null,
      purchase_tax_code_id: null, brand: '', weight_kg: null, volume_m3: null, hs_code: '',
      attribute_ids: [], selected_values: {},
      variants: [{ key: 'default', attribute_value_ids: [], label: t('Default'), sku: '', barcode: '', symbology: 'ean13', generate_barcode: false, sales_price_override: null }],
      reorder_rules: [],
    },
  })
  const variants = useFieldArray({ control: form.control, name: 'variants' })
  const rules = useFieldArray({ control: form.control, name: 'reorder_rules' })
  const [code, attributeIds, selectedValues, productType, tracking] = useWatch({
    control: form.control, name: ['code', 'attribute_ids', 'selected_values', 'product_type', 'tracking'],
  })

  // sensible defaults once lookups load
  React.useEffect(() => {
    if (!form.getValues('uom_id') && units.data?.length) form.setValue('uom_id', units.data.find((u) => u.code === 'pcs')?.id ?? units.data[0]!.id)
  }, [units.data, form])
  React.useEffect(() => {
    const std = taxes.data?.find((x) => x.scope !== 'purchase' && Number(x.rate) > 0)
    if (std && !form.getValues('sales_tax_code_id')) { form.setValue('sales_tax_code_id', std.id); form.setValue('purchase_tax_code_id', std.id) }
  }, [taxes.data, form])

  // regenerate the variant matrix when attributes change, keeping edits the user made
  const chosenAttrs = React.useMemo(
    () => (attributes.data ?? []).filter((a) => attributeIds.includes(a.id)),
    [attributes.data, attributeIds],
  )
  const matrixKey = JSON.stringify([attributeIds, selectedValues])
  React.useEffect(() => {
    const combos = buildMatrix(chosenAttrs, selectedValues)
    const current = new Map(form.getValues('variants').map((v) => [v.key, v]))
    const base = (code || 'SKU').toUpperCase()
    const next = combos.length
      ? combos.map((c) => {
          const key = c.ids.join('|')
          return current.get(key) ?? {
            key, attribute_value_ids: c.ids, label: c.labels.join(' / '),
            sku: [base, ...c.labels.map(skuPart)].join('-'), barcode: '', symbology: 'ean13' as const, generate_barcode: true, sales_price_override: null,
          }
        })
      : [current.get('default') ?? { key: 'default', attribute_value_ids: [], label: t('Default'), sku: base, barcode: '', symbology: 'ean13' as const, generate_barcode: false, sales_price_override: null }]
    variants.replace(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matrixKey, chosenAttrs])

  // keep the default SKU in sync with the product code until the user edits it
  React.useEffect(() => {
    const vs = form.getValues('variants')
    if (vs.length === 1 && vs[0]!.key === 'default') form.setValue('variants.0.sku', (code || '').toUpperCase())
  }, [code, form])

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const id = await create.mutateAsync({
        code: v.code, name: v.name, description: v.description, product_type: v.product_type, category_id: v.category_id,
        uom_id: v.uom_id, tracking: v.tracking, track_expiry: v.track_expiry, is_sellable: v.is_sellable, is_purchasable: v.is_purchasable,
        sales_price: v.sales_price, sales_tax_code_id: v.sales_tax_code_id, purchase_tax_code_id: v.purchase_tax_code_id,
        brand: v.brand, weight_kg: v.weight_kg, volume_m3: v.volume_m3, hs_code: v.hs_code,
        variants: v.variants.map((x) => ({
          sku: x.sku, attribute_value_ids: x.attribute_value_ids, sales_price_override: x.sales_price_override,
          generate_barcode: x.generate_barcode && !x.barcode,
          barcodes: x.barcode ? [{ barcode: x.barcode, symbology: x.symbology }] : [],
        })),
        reorder_rules: v.product_type === 'stockable' ? v.reorder_rules.map((r) => ({ ...r, preferred_vendor_id: r.preferred_vendor_id ?? null })) : [],
      })
      toast.success(t('{name} created', { name: v.name }), { description: tn(v.variants.length, '{n} variant', '{n} variants') })
      navigate(`/inventory/products/${id}`)
    } catch (e) {
      const code = (e as { code?: string }).code
      if (code === '23505' || String((e as { message?: string }).message ?? '').includes('code is already used')) form.setError('code', { message: t('This code is already used by another product') })
      else toast.error(describeError(e))
    }
  })

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="mx-auto max-w-5xl">
        <PageHeader
          title={t('New product')}
          back={{ href: '/inventory/products', label: t('Products') }}
          actions={<>
            <Button type="button" variant="outline" onClick={() => navigate('/inventory/products')}>{t('Cancel')}</Button>
            <Button type="submit" loading={form.formState.isSubmitting}>{t('Create product')}</Button>
          </>}
        />
        <div className="rounded-lg border bg-card px-5">
          <FormSection title={t('Basic details')} description={t('Code and name appear on documents, labels and the POS.')}>
            <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
              <FormField control={form.control} name="code" render={({ field }) => (
                <FormItem><FormLabel>{t('Code')}</FormLabel><FormControl><Input autoFocus placeholder={t('TEE-BASIC')} {...field} onChange={(e) => field.onChange(e.target.value.toUpperCase())} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>{t('Name')}</FormLabel><FormControl><Input placeholder={t('T-Shirt Basic')} {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField control={form.control} name="product_type" render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Type')}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="stockable">{t('Stockable — tracked & valued')}</SelectItem>
                      <SelectItem value="consumable">{t('Consumable — not tracked')}</SelectItem>
                      <SelectItem value="service">{t('Service')}</SelectItem>
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
              <FormField control={form.control} name="category_id" render={({ field }) => (
                <FormItem>
                  <FormLabel optional>{t('Category')}</FormLabel>
                  <FormControl>
                    <SearchSelect value={field.value} onChange={field.onChange} clearable placeholder={t('No category')}
                      options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name, hint: c.code ?? undefined }))} />
                  </FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="uom_id" render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Unit')}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue placeholder={t('Unit')} /></SelectTrigger></FormControl>
                    <SelectContent>{(units.data ?? []).filter((u) => u.is_active).map((u) => <SelectItem key={u.id} value={u.id}>{td(u.name)} ({u.code})</SelectItem>)}</SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem><FormLabel optional>{t('Description')}</FormLabel><FormControl><Textarea rows={2} {...field} /></FormControl></FormItem>
            )} />
          </FormSection>

          <FormSection title={t('Price & VAT')} description={t('Prices are in {currency} without VAT. The till shows them with VAT.', { currency: company?.base_currency ?? '' })}>
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField control={form.control} name="sales_price" render={({ field }) => (
                <FormItem><FormLabel>{t('Sales price')}</FormLabel><FormControl><Input type="number" step="0.01" min="0" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              {(['sales_tax_code_id', 'purchase_tax_code_id'] as const).map((name) => (
                <FormField key={name} control={form.control} name={name} render={({ field }) => (
                  <FormItem>
                    <FormLabel>{name === 'sales_tax_code_id' ? t('VAT on sales') : t('VAT on purchases')}</FormLabel>
                    <Select value={field.value ?? ''} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue placeholder={t('VAT code')} /></SelectTrigger></FormControl>
                      <SelectContent>
                        {(taxes.data ?? []).filter((x) => x.is_active && x.scope !== (name === 'sales_tax_code_id' ? 'purchase' : 'sales'))
                          .map((x) => <SelectItem key={x.id} value={x.id}>{td(x.name)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
              ))}
            </div>
            <div className="flex flex-wrap gap-6">
              <FormField control={form.control} name="is_sellable" render={({ field }) => (
                <label className="flex items-center gap-2 text-sm"><Switch checked={field.value} onCheckedChange={field.onChange} /> {t('Can be sold')}</label>
              )} />
              <FormField control={form.control} name="is_purchasable" render={({ field }) => (
                <label className="flex items-center gap-2 text-sm"><Switch checked={field.value} onCheckedChange={field.onChange} /> {t('Can be purchased')}</label>
              )} />
            </div>
          </FormSection>

          {productType === 'stockable' && (
            <FormSection title={t('Tracking')} description={t('Lots carry expiry dates and give recall traceability. Serial numbers track single units.')}>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField control={form.control} name="tracking" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Track by')}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="none">{t('Quantity only')}</SelectItem>
                        <SelectItem value="lot">{t('Lot / batch')}</SelectItem>
                        <SelectItem value="serial">{t('Serial number')}</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                {tracking !== 'none' && (
                  <FormField control={form.control} name="track_expiry" render={({ field }) => (
                    <FormItem className="self-end pb-2">
                      <label className="flex items-center gap-2 text-sm"><Switch checked={field.value} onCheckedChange={field.onChange} /> {t('Track expiry dates')}</label>
                    </FormItem>
                  )} />
                )}
              </div>
            </FormSection>
          )}

          <FormSection title={t('Variants')} description={t('Pick attributes like size or colour to generate one SKU per combination. Leave empty for a single SKU.')}>
            <AttributePicker attributes={attributes.data ?? []} form={form} />
            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>{t('Variant')}</TableHead>
                    <TableHead className="w-[200px]">SKU</TableHead>
                    <TableHead className="w-[230px]">{t('Barcode')}</TableHead>
                    <TableHead className="w-[120px] text-right">{t('Price')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {variants.fields.map((f, i) => (
                    <TableRow key={f.id} className="hover:bg-transparent">
                      <TableCell className="text-[13px]">{f.key === 'default' ? t('Default') : f.label}</TableCell>
                      <TableCell>
                        <FormField control={form.control} name={`variants.${i}.sku`} render={({ field }) => (
                          <FormItem><FormControl><Input className="h-8" {...field} onChange={(e) => field.onChange(e.target.value.toUpperCase())} /></FormControl><FormMessage /></FormItem>
                        )} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <FormField control={form.control} name={`variants.${i}.barcode`} render={({ field }) => (
                            <FormItem className="flex-1"><FormControl><Input className="h-8 tabular" placeholder={form.watch(`variants.${i}.generate_barcode`) ? t('Automatic (200…)') : t('EAN-13')} {...field} /></FormControl><FormMessage /></FormItem>
                          )} />
                          <FormField control={form.control} name={`variants.${i}.generate_barcode`} render={({ field }) => (
                            <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground" title={t('Generate an in-store EAN-13 if no barcode is entered')}>
                              <Checkbox checked={field.value} onCheckedChange={(v) => field.onChange(!!v)} /> {t('Auto')}
                            </label>
                          )} />
                        </div>
                      </TableCell>
                      <TableCell>
                        <FormField control={form.control} name={`variants.${i}.sales_price_override`} render={({ field }) => (
                          <FormItem><FormControl><Input className="h-8 text-right" type="number" step="0.01" placeholder={t('Same')} value={field.value ?? ''} onChange={field.onChange} /></FormControl></FormItem>
                        )} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </FormSection>

          {productType === 'stockable' && (
            <FormSection title={t('Reorder points')} description={t('When available stock in a warehouse drops to the reorder point, inventory and purchasing managers get an alert. Applied to every variant.')}>
              {rules.fields.map((f, i) => (
                <div key={f.id} className="grid items-start gap-2 sm:grid-cols-[1fr_100px_100px_90px_1fr_auto]">
                  <FormField control={form.control} name={`reorder_rules.${i}.warehouse_id`} render={({ field }) => (
                    <FormItem><FormLabel className={cn(i > 0 && 'sm:sr-only')}>{t('Warehouse')}</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl><SelectTrigger><SelectValue placeholder={t('Warehouse')} /></SelectTrigger></FormControl>
                        <SelectContent>{(warehouses.data ?? []).map((w) => <SelectItem key={w.id} value={w.id}>{td(w.name)}</SelectItem>)}</SelectContent>
                      </Select><FormMessage /></FormItem>
                  )} />
                  {(['min_qty', 'max_qty', 'multiple_qty'] as const).map((n) => (
                    <FormField key={n} control={form.control} name={`reorder_rules.${i}.${n}`} render={({ field }) => (
                      <FormItem><FormLabel className={cn(i > 0 && 'sm:sr-only')}>{n === 'min_qty' ? t('Reorder at') : n === 'max_qty' ? t('Order up to') : t('Pack of')}</FormLabel>
                        <FormControl><Input type="number" step="any" min="0" {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                  ))}
                  <FormField control={form.control} name={`reorder_rules.${i}.preferred_vendor_id`} render={({ field }) => (
                    <FormItem><FormLabel className={cn(i > 0 && 'sm:sr-only')}>{t('Preferred vendor')}</FormLabel><FormControl><VendorPicker value={field.value} onChange={field.onChange} /></FormControl></FormItem>
                  )} />
                  <Button type="button" variant="ghost" size="icon" className={cn(i === 0 && 'sm:mt-[22px]')} onClick={() => rules.remove(i)} aria-label={t('Remove rule')}><Trash2 /></Button>
                </div>
              ))}
              <div>
                <Button type="button" variant="outline" size="sm" disabled={!warehouses.data?.length}
                  onClick={() => rules.append({ warehouse_id: warehouses.data!.find((w) => !form.getValues('reorder_rules').some((r) => r.warehouse_id === w.id))?.id ?? '', min_qty: 5, max_qty: 20, multiple_qty: 1, preferred_vendor_id: null })}>
                  <Plus /> {t('Add reorder point')}
                </Button>
              </div>
            </FormSection>
          )}

          <FormSection title={t('Logistics & customs')} description={t('Weight and volume let landed costs (freight, customs) be allocated fairly. HS code is used on import declarations.')}>
            <div className="grid gap-4 sm:grid-cols-4">
              <FormField control={form.control} name="weight_kg" render={({ field }) => (
                <FormItem><FormLabel optional>{t('Weight (kg)')}</FormLabel><FormControl><Input type="number" step="any" min="0" value={field.value ?? ''} onChange={field.onChange} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="volume_m3" render={({ field }) => (
                <FormItem><FormLabel optional>{t('Volume (m³)')}</FormLabel><FormControl><Input type="number" step="any" min="0" value={field.value ?? ''} onChange={field.onChange} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="hs_code" render={({ field }) => (
                <FormItem><FormLabel optional>{t('HS code')}</FormLabel><FormControl><Input placeholder="6109 10 00" {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="brand" render={({ field }) => (
                <FormItem><FormLabel optional>{t('Brand')}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
            </div>
          </FormSection>
        </div>
        <FormDescription className="mt-3">{t('Opening stock is added afterwards with a stock adjustment (reason: opening) or a goods receipt.')}</FormDescription>
      </form>
    </Form>
  )
}

function AttributePicker({ attributes, form }: { attributes: AttributeWithValues[]; form: ReturnType<typeof useForm<ProductFormValues>> }) {
  const ids = form.watch('attribute_ids')
  const selected = form.watch('selected_values')
  const available = attributes.filter((a) => !ids.includes(a.id) && a.product_attribute_values.length)
  if (!attributes.length) {
    return <p className="text-[13px] text-muted-foreground">{tr('No attributes yet. Add sizes, colours or flavours in {link}.', { link: <Link className="text-primary hover:underline" to="/inventory/setup">{t('Inventory setup')}</Link> })}</p>
  }
  return (
    <div className="grid gap-3">
      {ids.map((id) => {
        const a = attributes.find((x) => x.id === id)
        if (!a) return null
        const vals = selected[id] ?? []
        return (
          <div key={id} className="flex flex-wrap items-center gap-1.5 rounded-md border p-2">
            <span className="mr-1 w-20 text-[13px] font-medium">{a.name}</span>
            {a.product_attribute_values.filter((v) => !v.deleted_at).sort((x, y) => x.sort_order - y.sort_order).map((v) => {
              const on = vals.includes(v.id)
              return (
                <button key={v.id} type="button"
                  onClick={() => form.setValue('selected_values', { ...selected, [id]: on ? vals.filter((x) => x !== v.id) : [...vals, v.id] })}
                  className={cn('inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[13px] transition-colors', on ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-secondary')}
                  aria-pressed={on}
                >
                  {v.color_hex && <span className="size-3 rounded-full border" style={{ background: v.color_hex }} />}
                  {v.value}
                </button>
              )
            })}
            <Button type="button" variant="ghost" size="icon-sm" className="ml-auto" aria-label={t('Remove {name}', { name: a.name })}
              onClick={() => {
                form.setValue('attribute_ids', ids.filter((x) => x !== id))
                form.setValue('selected_values', Object.fromEntries(Object.entries(selected).filter(([k]) => k !== id)))
              }}><X /></Button>
          </div>
        )
      })}
      {available.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Sparkles className="size-4 text-muted-foreground" />
          {available.map((a) => (
            <Badge key={a.id} variant="outline" className="cursor-pointer hover:bg-secondary" onClick={() => {
              form.setValue('attribute_ids', [...ids, a.id])
              form.setValue('selected_values', { ...selected, [a.id]: a.product_attribute_values.filter((v) => !v.deleted_at).map((v) => v.id) })
            }}>
              <Plus className="size-3" /> {a.name}
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}
