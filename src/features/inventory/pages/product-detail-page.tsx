import { ItemCardView } from './item-card-page'
import { zodResolver } from '@hookform/resolvers/zod'
import { Barcode, Maximize2, Pencil, Plus, ScanLine, Tag, Trash2 } from 'lucide-react'
import * as React from 'react'
import { useForm } from 'react-hook-form'
import { Link, useParams } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts'
import { toast } from 'sonner'
import { z } from 'zod'
import { Can, useCompany } from '@/app/company-provider'
import { ActivityTimeline } from '@/components/activity-timeline'
import { LinkedTasks } from '@/features/tasks/components/linked-tasks'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { SearchSelect } from '@/components/search-select'
import { StatCard } from '@/components/stat-card'
import { StockBar } from '@/components/stock-bar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import type { Tables } from '@/lib/database.types'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { useMutation } from '@tanstack/react-query'
import { formatDate, formatMoney, formatQty, humanize, num } from '@/lib/utils'
import {
  useAttributes, useCategories, useCostHistory, usePriceChanges, useProduct, useProductStockLevels, useTaxCodes, useUnits, useUpdateProduct,
  useVariantMutations, useVendors, useWarehouses, type ProductDetail,
} from '../api'
import { UnitsCard } from '../components/unit-stock'
import { CostLayersCard } from '../components/cost-layers-card'
import { PacksCard } from '../components/packs-card'
import { ProductPhoto } from '../components/product-photo'
import { VendorPicker } from '../components/pickers'
import { barcodeSchema } from '../schemas'
import { msg, t, td, tn } from '@/i18n'
import { ErrorState } from '@/components/error-state'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { useBulkProducts } from '../api'

export function ProductDetailPage() {
  const { id } = useParams<{ id: string }>()
  return <ProductView id={id} />
}

/**
 * The item: its numbers, stock, prices, variants, packaging and history. A page of its own, or a
 * window over the item list (inDialog), to look, change and delete without leaving the list.
 */
export function ProductView({ id, inDialog, onDeleted }: { id: string | undefined; inDialog?: boolean; onDeleted?: () => void }) {
  const { company } = useCompany()
  const product = useProduct(id)
  const levels = useProductStockLevels(id)
  const units = useUnits()
  const taxes = useTaxCodes()
  const p = product.data

  if (product.isLoading) {
    return <div className="grid gap-4"><Skeleton className="h-10 w-80" /><div className="grid gap-3 sm:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div><Skeleton className="h-72" /></div>
  }
  if (product.isError) return <ErrorState error={product.error} onRetry={() => void product.refetch()} />
  if (!p) return <EmptyState title={t('Product not found')} description={t('It may have been deleted, or it belongs to another company.')} />

  const rows = levels.data ?? []
  const onHand = rows.reduce((s, r) => s + num(r.on_hand), 0)
  const reserved = rows.reduce((s, r) => s + num(r.reserved), 0)
  const value = rows.reduce((s, r) => s + num(r.stock_value), 0)
  const avg = onHand > 0 ? value / onHand : num(rows[0]?.avg_cost)
  // every value says its price: the cost (purchase, without VAT, as in the books) and the selling price with VAT (as on the shelf)
  const rate = (id: string | null | undefined) => num(taxes.data?.find((x) => x.id === id)?.rate)
  const buyVat = 1 + rate(p.purchase_tax_code_id ?? p.sales_tax_code_id) / 100
  const sellGross = num(p.sales_price) * (1 + rate(p.sales_tax_code_id) / 100)
  const lowVariants = p.product_variants.filter((v) => v.replenishment_rules.some((r) => {
    const avail = rows.filter((x) => x.variant_id === v.id && x.warehouse_id === r.warehouse_id).reduce((s, x) => s + num(x.available), 0)
    return avail <= num(r.min_qty)
  })).length

  return (
    <>
      <PageHeader
        back={inDialog ? undefined : { href: '/inventory/products', label: t('Products') }}
        title={<span className="flex min-w-0 items-center gap-3"><ProductPhoto productId={p.id} name={p.name} hasImage={p.image_path === 'db'} /><span className="truncate">{p.name}</span></span>}
        meta={<>
          <Badge variant="outline">{p.code}</Badge>
          {!p.is_active && <Badge variant="secondary">{t('Suspended|item')}</Badge>}
          {p.tracking !== 'none' && <Badge variant="default">{p.tracking === 'lot' ? t('Tracked by lot') : t('Tracked by serial number')}</Badge>}
        </>}
        description={p.description ?? undefined}
        actions={<>
          {p.product_type !== 'service' && <Button variant="outline" asChild><Link to={`/inventory/labels?items=${p.product_variants.map((v) => v.id).join(',')}`}><Tag /> {t('Labels')}</Link></Button>}
          <Can perm="inventory.write"><EditProductSheet product={p} /></Can>
          {inDialog && <>
            <Can perm="inventory.delete"><DeleteProductButton productId={p.id} name={p.name} onDeleted={onDeleted} /></Can>
            <Button variant="ghost" size="icon" asChild title={t('Open the full page')} aria-label={t('Open the full page')}><Link to={`/inventory/products/${p.id}`}><Maximize2 /></Link></Button>
          </>}
        </>}
      />

      {p.product_type === 'stockable' && (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard label={t('On hand')} value={formatQty(onHand)} hint={t('{qty} reserved', { qty: formatQty(reserved) })} loading={levels.isLoading} />
          <StatCard label={t('Available')} value={formatQty(onHand - reserved)} tone={onHand - reserved < 0 ? 'destructive' : lowVariants ? 'warning' : 'default'}
            hint={lowVariants ? tn(lowVariants, '{n} variant at or below the reorder point', '{n} variants at or below the reorder point') : t('All variants are above the reorder point')} loading={levels.isLoading} />
          <StatCard label={t('Average cost, without VAT')} value={formatMoney(avg)} hint={t('With VAT {amount} · weighted, updated on every receipt', { amount: formatMoney(avg * buyVat) })} loading={levels.isLoading} />
          <StatCard label={t('Value at purchase price, without VAT')} value={formatMoney(value, company?.base_currency)} hint={t('With VAT {amount}', { amount: formatMoney(value * buyVat) })} loading={levels.isLoading} />
          <StatCard label={t('Value at selling price, with VAT')} value={formatMoney(onHand * sellGross, company?.base_currency)} hint={t('Selling price with VAT {price}', { price: formatMoney(sellGross) })} loading={levels.isLoading} />
        </div>
      )}

      <Tabs defaultValue={p.product_type === 'stockable' ? 'stock' : 'variants'}>
        <TabsList>
          {p.product_type === 'stockable' && <TabsTrigger value="stock">{t('Stock')}</TabsTrigger>}
          <TabsTrigger value="prices">{t('Price history')}</TabsTrigger>
          {p.product_type !== 'service' && <TabsTrigger value="packs">{t('Packaging')}</TabsTrigger>}
          <TabsTrigger value="variants">{t('Variants & barcodes')} <Badge variant="secondary">{p.product_variants.length}</Badge></TabsTrigger>
          {p.product_type === 'stockable' && <TabsTrigger value="reorder">{t('Reorder points')}</TabsTrigger>}
          {p.product_type === 'stockable' && <TabsTrigger value="card">{t('Item card')}</TabsTrigger>}
          <TabsTrigger value="activity">{t('Activity')}</TabsTrigger>
        </TabsList>

        <TabsContent value="stock" className="grid gap-4 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_380px]">
          <Card>
            <CardHeader><CardTitle>{t('Where it is')}</CardTitle><CardDescription>{t('On hand by warehouse, bin and lot')}</CardDescription></CardHeader>
            <CardContent className="p-0">
              {rows.length === 0 ? <EmptyState compact title={t('No stock yet')} description={t('Receive goods or post opening stock to see it here.')} /> : (
                <Table>
                  <TableHeader><TableRow className="hover:bg-transparent">
                    <TableHead>{t('Variant')}</TableHead><TableHead>{t('Location')}</TableHead><TableHead>{t('Lot')}</TableHead>
                    <TableHead>{t('Available')}</TableHead><TableHead className="text-right">{t('Value at cost')}</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-[13px]">{r.sku}</TableCell>
                        <TableCell className="text-[13px]">{td(r.warehouse_name)} <span className="text-muted-foreground">· {r.location_code}</span></TableCell>
                        <TableCell className="text-[13px]">{r.lot_number ?? '—'}{r.expiry_date && <span className="ml-1 text-muted-foreground">{t('expires {date}', { date: formatDate(r.expiry_date) })}</span>}</TableCell>
                        <TableCell><StockBar onHand={r.on_hand} reserved={r.reserved} className="max-w-[220px]" /></TableCell>
                        <TableCell className="text-right tabular">{formatMoney(r.stock_value)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter><TableRow className="hover:bg-transparent">
                    <TableCell colSpan={3}>{t('Total')}</TableCell>
                    <TableCell className="tabular">{t('{available} available of {total}', { available: formatQty(onHand - reserved), total: formatQty(onHand) })}</TableCell>
                    <TableCell className="text-right tabular">{formatMoney(value)}</TableCell>
                  </TableRow></TableFooter>
                </Table>
              )}
            </CardContent>
          </Card>
          <div className="grid content-start gap-4">
            <UnitsCard variants={p.product_variants} />
            <CostHistoryCard productId={p.id} variants={p.product_variants} />
            <CostLayersCard variantIds={p.product_variants.map((v) => v.id)} />
          </div>
        </TabsContent>

        <TabsContent value="prices"><PriceHistoryCard productId={p.id} variants={p.product_variants} /></TabsContent>
        <TabsContent value="variants"><VariantsTab product={p} /></TabsContent>
        <TabsContent value="packs"><PacksCard product={{ id: p.id, sales_price: p.sales_price, uom_code: units.data?.find((u) => u.id === p.uom_id)?.code }} /></TabsContent>
        <TabsContent value="reorder"><ReorderTab product={p} /></TabsContent>
        <TabsContent value="card"><ProductItemCard variants={p.product_variants} /></TabsContent>
        <TabsContent value="activity" className="grid max-w-2xl gap-4"><LinkedTasks entityType="products" entityId={p.id} label={p.name} /><ActivityTimeline table="products" id={p.id} /></TabsContent>
      </Tabs>
    </>
  )
}

function CostHistoryCard({ productId, variants }: { productId: string; variants: ProductDetail['product_variants'] }) {
  const history = useCostHistory(productId)
  const [variantId, setVariantId] = React.useState(variants[0]?.id ?? '')
  const data = (history.data ?? []).filter((h) => h.variant_id === variantId)
    .map((h) => ({ at: h.movement?.movement_date ?? h.created_at, avg: num(h.avg_cost_after), cost: h.qty_in > 0 ? num(h.unit_cost_in) : null, reason: humanize(h.reason) }))
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((h) => ({ ...h, date: formatDate(h.at) }))
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div><CardTitle>{t('Average cost')}</CardTitle><CardDescription>{t('Recalculated on each receipt and landed cost')}</CardDescription></div>
        {variants.length > 1 && (
          <Select value={variantId} onValueChange={setVariantId}>
            <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
            <SelectContent>{variants.map((v) => <SelectItem key={v.id} value={v.id}>{v.sku}</SelectItem>)}</SelectContent>
          </Select>
        )}
      </CardHeader>
      <CardContent>
        {history.isLoading ? <Skeleton className="h-48" /> : data.length < 1 ? (
          <p className="py-16 text-center text-[13px] text-muted-foreground">{t('No receipts yet.')}</p>
        ) : (
          <div className="h-52">
            <ResponsiveContainer>
              <LineChart data={data} margin={{ left: -12, right: 8, top: 8 }}>
                <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} width={56} />
                <ChartTooltip contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                  formatter={(v: number, n: string) => [formatMoney(v), n === 'avg' ? t('Average cost') : t('Cost of goods received')]} />
                <Line type="stepAfter" dataKey="avg" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="cost" stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" strokeWidth={0} dot={{ r: 3 }} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** each change of the selling price, newest first: when, where, from what to what, and what it did to the value of the stock */
function PriceHistoryCard({ productId, variants }: { productId: string; variants: ProductDetail['product_variants'] }) {
  const history = usePriceChanges(productId)
  const sku = (id: string) => variants.find((v) => v.id === id)?.sku ?? ''
  const rows = history.data ?? []
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Price history')}</CardTitle>
        <CardDescription>{t('Every change of the selling price, with the stock at that moment and what the change did to its value.')}</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {history.isLoading ? <div className="p-4"><Skeleton className="h-40" /></div> : !rows.length ? (
          <EmptyState compact title={t('No price changes yet')} description={t('A change of the selling price appears here, and so do the price levellings of the old program.')} />
        ) : (
          <Table>
            <TableHeader><TableRow className="hover:bg-transparent">
              <TableHead>{t('Date')}</TableHead>
              {variants.length > 1 && <TableHead>{t('Variant')}</TableHead>}
              <TableHead>{t('Where')}</TableHead>
              <TableHead className="text-right">{t('Old price')}</TableHead>
              <TableHead className="text-right">{t('New price')}</TableHead>
              <TableHead className="text-right">{t('Change|price')}</TableHead>
              <TableHead className="text-right">{t('Stock then')}</TableHead>
              <TableHead className="text-right">{t('Change in value')}</TableHead>
              <TableHead>{t('Document')}</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => {
                const oldP = r.old_price == null ? null : num(r.old_price)
                const newP = num(r.new_price)
                const pct = oldP ? ((newP - oldP) / oldP) * 100 : null
                return (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-[13px]">{formatDate(r.changed_on)}</TableCell>
                    {variants.length > 1 && <TableCell className="text-[13px]">{sku(r.variant_id)}</TableCell>}
                    <TableCell className="text-[13px]">{r.warehouse?.name ? td(r.warehouse.name) : t('All stores')}
                      {r.price_list && <span className="block text-xs text-muted-foreground">{r.price_list}</span>}</TableCell>
                    <TableCell className="text-right tabular text-[13px] text-muted-foreground">{oldP == null ? '—' : formatMoney(oldP)}</TableCell>
                    <TableCell className="text-right tabular text-[13px] font-medium">{formatMoney(newP)}</TableCell>
                    <TableCell className={`text-right tabular text-[13px] ${pct == null ? '' : pct > 0 ? 'text-success' : pct < 0 ? 'text-destructive' : ''}`}>
                      {pct == null ? '—' : `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`}</TableCell>
                    <TableCell className="text-right tabular text-[13px]">{r.quantity == null ? '—' : formatQty(r.quantity)}</TableCell>
                    <TableCell className="text-right tabular text-[13px]">{r.value_change == null ? '—' : formatMoney(r.value_change)}</TableCell>
                    <TableCell className="text-[13px]">{r.source === 'logmicro'
                      ? <>{r.doc_number ?? '—'} <span className="text-xs text-muted-foreground">· {t('old program')}</span></>
                      : <span className="text-muted-foreground">{r.by?.full_name ?? t('Changed here')}</span>}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ edit */
const editSchema = z.object({
  name: z.string().trim().min(2, msg('Enter a product name')),
  description: z.string().trim().optional(),
  category_id: z.string().nullable(),
  sales_price: z.coerce.number().nonnegative(),
  sales_tax_code_id: z.string().nullable(),
  purchase_tax_code_id: z.string().nullable(),
  is_sellable: z.boolean(),
  is_purchasable: z.boolean(),
  is_active: z.boolean(),
  brand: z.string().trim().optional(),
  manufacturer: z.string().trim().optional(),
  hs_code: z.string().trim().optional(),
  weight_kg: z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number().nonnegative().nullable()),
  volume_m3: z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number().nonnegative().nullable()),
  max_temperature: z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number().min(-40).max(30).nullable()),
  scale_plu: z.string().trim().regex(/^\d{0,6}$/, msg('The PLU is a number of up to 6 digits')).optional(),
  min_shelf_days: z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number().int().min(1).max(3650).nullable()),
})

function DeleteProductButton({ productId, name, onDeleted }: { productId: string; name: string; onDeleted?: () => void }) {
  const bulk = useBulkProducts()
  return (
    <ConfirmDialog
      trigger={<Button variant="outline" className="text-destructive"><Trash2 /> {t('Delete')}</Button>}
      title={t('Delete {name}?', { name })}
      description={t('They disappear from lists and pickers. Stock history is kept, and an admin can restore them from the audit log.')}
      confirmLabel={t('Delete')}
      destructive
      onConfirm={() => bulk.mutateAsync({ action: 'delete', productIds: [productId] }).then(() => onDeleted?.())}
    />
  )
}

function EditProductSheet({ product }: { product: ProductDetail }) {
  const [open, setOpen] = React.useState(false)
  const categories = useCategories()
  const taxes = useTaxCodes()
  const update = useUpdateProduct(product.id)
  // the price is typed with VAT, as on the shelf; a change goes through a levelling (NIV-) with the old and the new price
  const rateOf = (id: string | null) => num((taxes.data ?? []).find((x) => x.id === id)?.rate)
  const grossNow = Math.round(num(product.sales_price) * (1 + rateOf(product.sales_tax_code_id) / 100) * 100) / 100
  const level = useMutation({ mutationFn: async (a: { variant: string; price: number }) => unwrap(await supabase.rpc('price_level_quick', { p_variant: a.variant, p_price: a.price })) as unknown as { number: string } })
  const form = useForm<z.infer<typeof editSchema>>({
    resolver: zodResolver(editSchema),
    values: {
      name: product.name, description: product.description ?? '', category_id: product.category_id, sales_price: grossNow,
      sales_tax_code_id: product.sales_tax_code_id, purchase_tax_code_id: product.purchase_tax_code_id, is_sellable: product.is_sellable,
      is_purchasable: product.is_purchasable, is_active: product.is_active, brand: product.brand ?? '', manufacturer: (product as { manufacturer?: string | null }).manufacturer ?? '', hs_code: product.hs_code ?? '',
      weight_kg: product.weight_kg, volume_m3: product.volume_m3, max_temperature: product.max_temperature,
      scale_plu: (product as { scale_plu?: string | null }).scale_plu ?? '',
      min_shelf_days: (product as { min_shelf_days?: number | null }).min_shelf_days ?? null,
    },
  })
  const onSubmit = form.handleSubmit(async (v) => {
    // the PLU goes only when it changed: a server not yet updated has no such column, and the rest still saves
    const { scale_plu, min_shelf_days, sales_price: gross, ...rest } = v
    const net = Math.round((num(gross) / (1 + rateOf(v.sales_tax_code_id) / 100)) * 1e6) / 1e6
    const priceChanged = Math.abs(num(gross) - grossNow) >= 0.005 || (v.sales_tax_code_id !== product.sales_tax_code_id && Math.abs(net - num(product.sales_price)) >= 0.0001)
    const plu = scale_plu || null
    const pluChanged = plu !== ((product as { scale_plu?: string | null }).scale_plu ?? null)
    const shelfChanged = (min_shelf_days ?? null) !== ((product as { min_shelf_days?: number | null }).min_shelf_days ?? null)
    await update.mutateAsync({ ...rest, description: v.description || null, brand: v.brand || null, manufacturer: v.manufacturer || null, hs_code: v.hs_code || null, ...(pluChanged ? { scale_plu: plu } : {}),
      ...(shelfChanged ? { min_shelf_days: min_shelf_days ?? null } : {}) })
    if (priceChanged) {
      // the product's own price: a variant without a price of its own carries it
      const variant = (product.product_variants ?? []).find((x) => x.sales_price_override == null && !x.deleted_at) ?? product.product_variants?.[0]
      if (variant) {
        const r = await level.mutateAsync({ variant: variant.id, price: net })
        toast.success(t('New price saved with levelling {number}', { number: r.number }))
      }
    }
    setOpen(false)
  })
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild><Button variant="outline"><Pencil /> {t('Edit')}</Button></SheetTrigger>
      <SheetContent>
        <SheetHeader><SheetTitle>{t('Edit {name}', { name: product.code })}</SheetTitle></SheetHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
            <div className="grid flex-1 content-start gap-4 overflow-y-auto px-5 py-4">
              <FormField control={form.control} name="name" render={({ field }) => (<FormItem><FormLabel>{t('Name')}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="description" render={({ field }) => (<FormItem><FormLabel optional>{t('Description')}</FormLabel><FormControl><Textarea rows={2} {...field} /></FormControl></FormItem>)} />
              <FormField control={form.control} name="category_id" render={({ field }) => (
                <FormItem><FormLabel optional>{t('Category')}</FormLabel><FormControl>
                  <SearchSelect value={field.value} onChange={field.onChange} clearable placeholder={t('No category')} options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
                </FormControl></FormItem>
              )} />
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="sales_price" render={({ field }) => (<FormItem><FormLabel>{t('Sales price with VAT')}</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                  <FormDescription>{t('A new price is saved with a levelling document.')}</FormDescription><FormMessage /></FormItem>)} />
                <FormField control={form.control} name="sales_tax_code_id" render={({ field }) => (
                  <FormItem><FormLabel>{t('Sales VAT')}</FormLabel>
                    <Select value={field.value ?? ''} onValueChange={field.onChange}><FormControl><SelectTrigger><SelectValue placeholder={t('VAT')} /></SelectTrigger></FormControl>
                      <SelectContent>{(taxes.data ?? []).filter((x) => x.scope !== 'purchase').map((x) => <SelectItem key={x.id} value={x.id}>{td(x.name)}</SelectItem>)}</SelectContent></Select>
                  </FormItem>
                )} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="weight_kg" render={({ field }) => (<FormItem><FormLabel optional>{t('Weight (kg)')}</FormLabel><FormControl><Input type="number" step="any" value={field.value ?? ''} onChange={field.onChange} /></FormControl></FormItem>)} />
                <FormField control={form.control} name="volume_m3" render={({ field }) => (<FormItem><FormLabel optional>{t('Volume (m³)')}</FormLabel><FormControl><Input type="number" step="any" value={field.value ?? ''} onChange={field.onChange} /></FormControl></FormItem>)} />
                <FormField control={form.control} name="brand" render={({ field }) => (<FormItem><FormLabel optional>{t('Brand')}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>)} />
                <FormField control={form.control} name="manufacturer" render={({ field }) => (<FormItem><FormLabel optional>{t('Producer')}</FormLabel><FormControl><Input placeholder={t('e.g. Zott')} {...field} /></FormControl></FormItem>)} />
                <FormField control={form.control} name="hs_code" render={({ field }) => (<FormItem><FormLabel optional>{t('HS code')}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>)} />
                <FormField control={form.control} name="scale_plu" render={({ field }) => (<FormItem><FormLabel optional>{t('PLU on the scale')}</FormLabel><FormControl><Input inputMode="numeric" {...field} placeholder={t('e.g. 1234')} /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={form.control} name="min_shelf_days" render={({ field }) => (<FormItem className="col-span-2"><FormLabel optional>{t('Days it must still have at receiving')}</FormLabel>
                  <FormControl><Input type="number" step="1" className="w-32" placeholder={t('e.g. 10')} value={field.value ?? ''} onChange={field.onChange} /></FormControl>
                  <FormDescription>{t('Goods that expire sooner are refused at receiving; a manager can still accept them. Empty: the company\'s default.')}</FormDescription><FormMessage /></FormItem>)} />
                <FormField control={form.control} name="max_temperature" render={({ field }) => (<FormItem className="col-span-2"><FormLabel optional>{t('Kept cold, at most (°C)')}</FormLabel>
                  <FormControl><Input type="number" step="0.5" className="w-32" placeholder={t('e.g. 4')} value={field.value ?? ''} onChange={field.onChange} /></FormControl>
                  <FormDescription>{t('Meat, dairy, frozen goods: the receiver writes the temperature at the door, and a warmer delivery is refused.')}</FormDescription></FormItem>)} />
              </div>
              {(['is_sellable', 'is_purchasable', 'is_active'] as const).map((n) => (
                <FormField key={n} control={form.control} name={n} render={({ field }) => (
                  <label className="flex items-center justify-between text-sm">{n === 'is_sellable' ? t('Can be sold') : n === 'is_purchasable' ? t('Can be purchased') : t('Active')}<Switch checked={field.value} onCheckedChange={field.onChange} /></label>
                )} />
              ))}
              <p className="text-xs text-muted-foreground">{t('Unit, type and tracking can\'t change after creation because stock history depends on them.')}</p>
            </div>
            <div className="flex justify-end gap-2 border-t px-5 py-3">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>{t('Cancel')}</Button>
              <Button type="submit" loading={update.isPending}>{t('Save changes')}</Button>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  )
}

/* -------------------------------------------------------------- variants */
function VariantsTab({ product }: { product: ProductDetail }) {
  const { can } = useCompany()
  const m = useVariantMutations(product.id)
  const attributes = useAttributes()
  const valueName = new Map((attributes.data ?? []).flatMap((a) => a.product_attribute_values.map((v) => [v.id, `${a.name}: ${v.value}`] as const)))
  const editable = can('inventory.write')

  return (
    <div className="grid gap-3">
      <div className="overflow-hidden rounded-lg border bg-card">
        <Table>
          <TableHeader><TableRow className="hover:bg-transparent">
            <TableHead>SKU</TableHead><TableHead>{t('Attributes')}</TableHead><TableHead>{t('Barcodes')}</TableHead>
            <TableHead className="text-right">{t('Price')}</TableHead><TableHead className="w-24">{t('Active')}</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {product.product_variants.map((v) => (
              <TableRow key={v.id} className="hover:bg-transparent">
                <TableCell><div className="font-medium">{v.sku}</div><div className="text-xs text-muted-foreground">{v.name}</div></TableCell>
                <TableCell className="text-[13px] text-muted-foreground">
                  {v.variant_attribute_values.map((a) => valueName.get(a.attribute_value_id)).filter(Boolean).join(' · ') || '—'}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1">
                    {v.product_barcodes.map((b) => (
                      <Badge key={b.id} variant="outline" className="gap-1 tabular">
                        <Barcode className="size-3 text-muted-foreground" />{b.barcode}{num(b.quantity) > 1 && <span className="text-muted-foreground">×{formatQty(b.quantity)}</span>}
                        {editable && <button className="rounded hover:text-destructive" aria-label={t('Remove barcode {code}', { code: b.barcode })} onClick={() => m.removeBarcode.mutate(b.id)}><Trash2 className="size-3" /></button>}
                      </Badge>
                    ))}
                    {editable && <AddBarcodeDialog variantId={v.id} onAdd={m.addBarcode.mutateAsync} />}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular">{formatMoney(v.sales_price_override ?? product.sales_price)}</TableCell>
                <TableCell>
                  <Switch checked={v.is_active} disabled={!editable} onCheckedChange={(on) => m.updateVariant.mutate({ id: v.id, is_active: on })} aria-label={t('{code} active', { code: v.sku })} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {editable && <AddVariantDialog product={product} onAdd={m.addVariant.mutateAsync} />}
    </div>
  )
}

function AddBarcodeDialog({ variantId, onAdd }: { variantId: string; onAdd: (b: { variant_id: string; barcode?: string; symbology: string; generate?: boolean }) => Promise<string> }) {
  const [open, setOpen] = React.useState(false)
  const [barcode, setBarcode] = React.useState('')
  const [symbology, setSymbology] = React.useState<'ean13' | 'ean8' | 'upca' | 'code128' | 'qr'>('ean13')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const submit = async (generate: boolean) => {
    if (!generate) {
      const r = barcodeSchema.safeParse({ barcode, symbology })
      if (!r.success || !barcode.trim()) return setError(r.success ? t('Enter or scan a barcode') : t(r.error.issues[0]!.message))
    }
    setBusy(true)
    try {
      const code = await onAdd({ variant_id: variantId, barcode: barcode.trim(), symbology, generate })
      toast.success(t('Barcode {code} added', { code }))
      setOpen(false); setBarcode(''); setError(null)
    } catch (e) { setError(describeError(e)) } finally { setBusy(false) }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="ghost" size="xs"><Plus /> {t('Barcode')}</Button></DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{t('Add barcode')}</DialogTitle></DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void submit(false) }}>
          <div className="grid grid-cols-[1fr_110px] gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="bc">{t('Barcode')}</Label>
              <div className="relative"><ScanLine className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="bc" className="pl-8 tabular" autoFocus value={barcode} onChange={(e) => { setBarcode(e.target.value); setError(null) }} placeholder={t('Scan or type')} aria-invalid={!!error} /></div>
            </div>
            <div className="grid gap-1.5">
              <Label>{t('Type')}</Label>
              <Select value={symbology} onValueChange={(v) => setSymbology(v as typeof symbology)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{['ean13', 'ean8', 'upca', 'code128', 'qr'].map((s) => <SelectItem key={s} value={s}>{s.toUpperCase()}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          {error && <p className="text-xs font-medium text-destructive">{error}</p>}
          <DialogFooter className="sm:justify-between">
            <Button type="button" variant="ghost" onClick={() => void submit(true)} disabled={busy}>{t('Generate in-store code')}</Button>
            <Button type="submit" loading={busy}>{t('Add barcode')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AddVariantDialog({ product, onAdd }: { product: ProductDetail; onAdd: (v: { sku: string; name: string; sales_price_override: number | null; attribute_value_ids: string[] }) => Promise<unknown> }) {
  const attributes = useAttributes()
  const [open, setOpen] = React.useState(false)
  const [sku, setSku] = React.useState('')
  const [picked, setPicked] = React.useState<Record<string, string>>({})
  const [price, setPrice] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const labels = (attributes.data ?? []).map((a) => a.product_attribute_values.find((v) => v.id === picked[a.id])?.value).filter(Boolean)
  const submit = async () => {
    if (!sku.trim()) return toast.error(t('Enter a SKU'))
    setBusy(true)
    try {
      await onAdd({ sku: sku.trim().toUpperCase(), name: [product.name, ...labels].join(' / '), sales_price_override: price ? Number(price) : null, attribute_value_ids: Object.values(picked) })
      toast.success(t('Variant {code} added', { code: sku.toUpperCase() }))
      setOpen(false); setSku(''); setPicked({}); setPrice('')
    } catch (e) { toast.error(describeError(e)) } finally { setBusy(false) }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline" size="sm" className="justify-self-start"><Plus /> {t('Add variant')}</Button></DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{t('Add a variant to {name}', { name: product.name })}</DialogTitle></DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void submit() }}>
          <div className="grid gap-1.5"><Label htmlFor="v-sku">SKU</Label><Input id="v-sku" autoFocus value={sku} onChange={(e) => setSku(e.target.value.toUpperCase())} /></div>
          {(attributes.data ?? []).map((a) => (
            <div key={a.id} className="grid gap-1.5">
              <Label>{a.name}</Label>
              <Select value={picked[a.id] ?? ''} onValueChange={(v) => setPicked({ ...picked, [a.id]: v })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{a.product_attribute_values.map((v) => <SelectItem key={v.id} value={v.id}>{v.value}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          ))}
          <div className="grid gap-1.5"><Label htmlFor="v-price">{t('Price override')}</Label><Input id="v-price" type="number" step="0.01" placeholder={t('Same as the product ({price})', { price: formatMoney(product.sales_price) })} value={price} onChange={(e) => setPrice(e.target.value)} /></div>
          <DialogFooter><Button type="submit" loading={busy}>{t('Add variant')}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* --------------------------------------------------------- reorder points */
function ReorderTab({ product }: { product: ProductDetail }) {
  const { can } = useCompany()
  const warehouses = useWarehouses()
  const vendors = useVendors()
  const m = useVariantMutations(product.id)
  const editable = can('oms.write')
  const vendorName = new Map((vendors.data ?? []).map((v) => [v.id, v.name]))
  const whName = new Map((warehouses.data ?? []).map((w) => [w.id, td(w.name)]))
  const rules = product.product_variants.flatMap((v) => v.replenishment_rules.map((r) => ({ ...r, sku: v.sku })))

  return (
    <div className="grid gap-3">
      <p className="text-[13px] text-muted-foreground">{t('When available stock in a warehouse falls to the reorder point, an alert opens and inventory and purchasing managers are notified. Suggested order quantity tops up to “order up to”, rounded to the pack size.')}</p>
      <div className="overflow-hidden rounded-lg border bg-card">
        <Table>
          <TableHeader><TableRow className="hover:bg-transparent">
            <TableHead>{t('Variant')}</TableHead><TableHead>{t('Warehouse')}</TableHead><TableHead className="text-right">{t('Reorder at')}</TableHead>
            <TableHead className="text-right">{t('Order up to')}</TableHead><TableHead className="text-right">{t('Pack of')}</TableHead><TableHead>{t('Preferred vendor')}</TableHead><TableHead className="w-20" />
          </TableRow></TableHeader>
          <TableBody>
            {rules.length === 0 && <TableRow className="hover:bg-transparent"><TableCell colSpan={7}><EmptyState compact title={t('No reorder points')} description={t('Add one to get low-stock alerts for this product.')} /></TableCell></TableRow>}
            {rules.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.sku}</TableCell>
                <TableCell>{whName.get(r.warehouse_id) ?? '—'}</TableCell>
                <TableCell className="text-right tabular">{formatQty(r.min_qty)}</TableCell>
                <TableCell className="text-right tabular">{formatQty(r.max_qty)}</TableCell>
                <TableCell className="text-right tabular">{formatQty(r.multiple_qty)}</TableCell>
                <TableCell>{r.preferred_vendor_id ? vendorName.get(r.preferred_vendor_id) : '—'}</TableCell>
                <TableCell className="whitespace-nowrap text-right">
                  {editable && <>
                    <RuleDialog product={product} rule={r} onSave={m.saveRule.mutateAsync} />
                    <Button variant="ghost" size="icon-sm" aria-label={t('Remove reorder point')} onClick={() => m.removeRule.mutate(r.id)}><Trash2 /></Button>
                  </>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {editable && <RuleDialog product={product} onSave={m.saveRule.mutateAsync} />}
    </div>
  )
}

const ruleSchema = z.object({
  variant_id: z.string().uuid({ message: msg('Choose a variant') }),
  warehouse_id: z.string().uuid({ message: msg('Choose a warehouse') }),
  min_qty: z.coerce.number().nonnegative(),
  max_qty: z.coerce.number().nonnegative(),
  multiple_qty: z.coerce.number().positive(msg('Must be above 0')),
  preferred_vendor_id: z.string().uuid().nullable(),
}).refine((r) => r.max_qty >= r.min_qty, { path: ['max_qty'], message: msg('Must be at least the reorder point') })

function RuleDialog({ product, rule, onSave }: {
  product: ProductDetail
  rule?: Tables<'replenishment_rules'>
  onSave: (r: z.infer<typeof ruleSchema> & { id?: string }) => Promise<unknown>
}) {
  const [open, setOpen] = React.useState(false)
  const warehouses = useWarehouses()
  const form = useForm<z.infer<typeof ruleSchema>>({
    resolver: zodResolver(ruleSchema),
    values: rule
      ? { variant_id: rule.variant_id, warehouse_id: rule.warehouse_id, min_qty: rule.min_qty, max_qty: rule.max_qty, multiple_qty: rule.multiple_qty, preferred_vendor_id: rule.preferred_vendor_id }
      : { variant_id: product.product_variants[0]?.id ?? '', warehouse_id: warehouses.data?.[0]?.id ?? '', min_qty: 5, max_qty: 20, multiple_qty: 1, preferred_vendor_id: null },
  })
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await onSave({ ...v, id: rule?.id })
      toast.success(t('Reorder point saved'))
      setOpen(false)
    } catch (e) {
      form.setError('warehouse_id', { message: (e as { code?: string }).code === '23505' ? t('This variant already has a reorder point for this warehouse') : describeError(e) })
    }
  })
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {rule ? <Button variant="ghost" size="icon-sm" aria-label={t('Edit reorder point')}><Pencil /></Button>
          : <Button variant="outline" size="sm" className="justify-self-start"><Plus /> {t('Add reorder point')}</Button>}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{rule ? t('Edit reorder point') : t('New reorder point')}</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="grid gap-3">
            <FormField control={form.control} name="variant_id" render={({ field }) => (
              <FormItem><FormLabel>{t('Variant')}</FormLabel>
                <Select value={field.value} onValueChange={field.onChange} disabled={!!rule}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>{product.product_variants.map((v) => <SelectItem key={v.id} value={v.id}>{v.sku}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="warehouse_id" render={({ field }) => (
              <FormItem><FormLabel>{t('Warehouse')}</FormLabel>
                <Select value={field.value} onValueChange={field.onChange} disabled={!!rule}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>{(warehouses.data ?? []).map((w) => <SelectItem key={w.id} value={w.id}>{td(w.name)}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>
            )} />
            <div className="grid grid-cols-3 gap-2">
              <FormField control={form.control} name="min_qty" render={({ field }) => (<FormItem><FormLabel>{t('Reorder at')}</FormLabel><FormControl><Input type="number" step="any" {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="max_qty" render={({ field }) => (<FormItem><FormLabel>{t('Order up to')}</FormLabel><FormControl><Input type="number" step="any" {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="multiple_qty" render={({ field }) => (<FormItem><FormLabel>{t('Pack of')}</FormLabel><FormControl><Input type="number" step="any" {...field} /></FormControl><FormMessage /></FormItem>)} />
            </div>
            <FormField control={form.control} name="preferred_vendor_id" render={({ field }) => (
              <FormItem><FormLabel optional>{t('Preferred vendor')}</FormLabel><FormControl><VendorPicker value={field.value} onChange={field.onChange} /></FormControl></FormItem>
            )} />
            <DialogFooter><Button type="submit" loading={form.formState.isSubmitting}>{t('Save reorder point')}</Button></DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function ProductItemCard({ variants }: { variants: { id: string; sku: string; name: string }[] }) {
  const [v, setV] = React.useState(variants[0]?.id ?? '')
  return (
    <div className="grid gap-3">
      {variants.length > 1 && (
        <Select value={v} onValueChange={setV}>
          <SelectTrigger className="w-80" aria-label={t('Variant')}><SelectValue /></SelectTrigger>
          <SelectContent>{variants.map((x) => <SelectItem key={x.id} value={x.id}>{x.sku} · {x.name}</SelectItem>)}</SelectContent>
        </Select>
      )}
      {v && <ItemCardView key={v} variantId={v} />}
    </div>
  )
}
