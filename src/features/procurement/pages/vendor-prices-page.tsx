import { zodResolver } from '@hookform/resolvers/zod'
import type { ColumnDef } from '@tanstack/react-table'
import { Plus, Star } from 'lucide-react'
import * as React from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { Can, useCompany } from '@/app/company-provider'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { ColumnHeader, DataTable, inFilter } from '@/components/data-table/data-table'
import { PageHeader } from '@/components/page-header'
import { SearchSelect } from '@/components/search-select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { t } from '@/i18n'
import { describeError } from '@/lib/errors'
import { formatMoney, formatQty } from '@/lib/utils'
import { useCurrencies } from '@/features/inventory/api'
import { VariantPicker } from '@/features/inventory/components/pickers'
import { useActiveVendors, useDeleteVendorProduct, useSaveVendorProduct, useVendorProducts, type VendorProductRow } from '../api'
import { vendorProductSchema, type VendorProductValues } from '../schemas'

/** Vendor price list: per vendor and item — price, currency, minimum order, lead time, preferred vendor */
export function VendorPricesPage() {
  return (
    <>
      <PageHeader title={t('Vendor prices')} description={t('What each vendor charges, their minimum order and delivery time. Orders and replenishment use these prices and pick the preferred vendor.')} />
      <VendorPricesTable />
    </>
  )
}

export function VendorPricesTable({ vendorId }: { vendorId?: string }) {
  const rows = useVendorProducts(vendorId)
  const del = useDeleteVendorProduct()
  const { can } = useCompany()
  const [edit, setEdit] = React.useState<VendorProductRow | 'new' | null>(null)
  const columns = React.useMemo<ColumnDef<VendorProductRow>[]>(() => [
    { id: 'sku', accessorFn: (r) => r.variant?.sku ?? '', enableHiding: false, header: ({ column }) => <ColumnHeader column={column} title={t('Item')} />, meta: { label: t('SKU') },
      cell: ({ row: { original: r } }) => <div><div className="font-medium">{r.variant?.sku}</div><div className="text-xs text-muted-foreground">{r.variant?.name}</div></div> },
    ...(vendorId ? [] : [{ id: 'vendor', accessorFn: (r: VendorProductRow) => r.vendor?.name ?? '', filterFn: inFilter, header: ({ column }) => <ColumnHeader column={column} title={t('Vendor')} />, meta: { label: t('Vendor') },
      cell: ({ row: { original: r } }: { row: { original: VendorProductRow } }) => <span className="inline-flex items-center gap-1.5">{r.vendor?.name}{r.is_preferred && <Star className="size-3.5 fill-current text-warning" aria-label={t('Preferred')} />}</span> } as ColumnDef<VendorProductRow>]),
    { accessorKey: 'vendor_sku', header: t("Vendor's code"), meta: { label: t("Vendor's code") }, cell: ({ getValue }) => (getValue() as string) || '—' },
    { accessorKey: 'price', header: ({ column }) => <ColumnHeader column={column} title={t('Price (without VAT)')} />, meta: { label: t('Price (without VAT)'), align: 'right' }, cell: ({ row: { original: r } }) => <span className="tabular">{formatMoney(r.price)} <span className="text-muted-foreground">{r.currency_code}</span></span> },
    { accessorKey: 'min_order_qty', header: t('Minimum order'), meta: { label: t('Minimum order'), align: 'right' }, cell: ({ getValue }) => formatQty(getValue() as number) },
    { accessorKey: 'lead_time_days', header: t('Delivery time'), meta: { label: t('Delivery time (days)'), align: 'right' }, cell: ({ getValue }) => t('{n} days', { n: getValue() as number }) },
    ...(vendorId ? [{ accessorKey: 'is_preferred', header: t('Preferred'), meta: { label: t('Preferred') }, cell: ({ getValue }: { getValue: () => unknown }) => getValue() ? <Badge variant="warning"><Star className="size-3" /> {t('Preferred')}</Badge> : null } as ColumnDef<VendorProductRow>] : []),
  ], [vendorId])
  const vendors = [...new Set((rows.data ?? []).map((r) => r.vendor?.name).filter(Boolean))] as string[]
  const addButton = <Can perm="procurement.write"><Button size={vendorId ? 'sm' : 'default'} variant={vendorId ? 'outline' : 'default'} onClick={() => setEdit('new')}><Plus /> {t('Add price')}</Button></Can>
  return (
    <>
      <DataTable tableKey={vendorId ? 'partner.vendor-prices' : 'procurement.vendor-prices'} columns={columns} data={rows.data} isLoading={rows.isLoading} error={rows.error}
        getRowId={(r) => r.id} exportName="vendor-prices" searchPlaceholder={t('SKU, vendor, vendor code…')} toolbar={addButton}
        onRowClick={can('procurement.write') ? (r) => setEdit(r) : undefined}
        facets={vendorId ? [] : [{ columnId: 'vendor', title: t('Vendor'), options: vendors.map((v) => ({ value: v, label: v })) }]}
        empty={{ title: t('No vendor prices yet'), description: t('Record what vendors charge so orders price themselves and replenishment knows whom to buy from.'), action: addButton }} />
      <VendorPriceDialog key={edit === 'new' ? 'new' : edit?.id ?? 'none'} open={!!edit} row={edit === 'new' ? undefined : edit ?? undefined}
        vendorId={vendorId} onClose={() => setEdit(null)}
        onDelete={edit && edit !== 'new' ? () => del.mutateAsync(edit.id).then(() => setEdit(null)) : undefined} />
    </>
  )
}

function VendorPriceDialog({ open, row, vendorId, onClose, onDelete }: { open: boolean; row?: VendorProductRow; vendorId?: string; onClose: () => void; onDelete?: () => Promise<unknown> }) {
  const { company } = useCompany()
  const vendors = useActiveVendors()
  const currencies = useCurrencies()
  const save = useSaveVendorProduct()
  const form = useForm<VendorProductValues>({
    resolver: zodResolver(vendorProductSchema),
    defaultValues: {
      vendor_id: row?.vendor_id ?? vendorId ?? (undefined as unknown as string), variant_id: row?.variant_id ?? (undefined as unknown as string),
      vendor_sku: row?.vendor_sku ?? '', price: row?.price ?? 0, currency_code: row?.currency_code ?? company?.base_currency ?? 'ALL',
      min_order_qty: row?.min_order_qty ?? 1, lead_time_days: row?.lead_time_days ?? 0, is_preferred: row?.is_preferred ?? false,
    },
  })
  const submit = form.handleSubmit(async (v) => {
    try {
      await save.mutateAsync({ id: row?.id, ...v, vendor_sku: v.vendor_sku || null })
      toast.success(t('Vendor price saved')); onClose()
    } catch (e) {
      const msg = describeError(e)
      if (/vendor_products_key|duplicate/i.test(msg)) form.setError('variant_id', { message: t('This vendor already has a price for this item — edit that one') })
      else toast.error(msg)
    }
  })
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{row ? t('Edit vendor price') : t('New vendor price')}</DialogTitle><DialogDescription>{t('Used to price purchase orders and to choose the vendor for replenishment.')}</DialogDescription></DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} className="grid grid-cols-2 gap-3">
            {!vendorId && <FormField control={form.control} name="vendor_id" render={({ field }) => (
              <FormItem className="col-span-2"><FormLabel>{t('Vendor')}</FormLabel><FormControl><SearchSelect value={field.value} onChange={(v) => {
                field.onChange(v); const vv = vendors.data?.find((x) => x.id === v); if (vv?.currency_code && !row) form.setValue('currency_code', vv.currency_code)
              }} disabled={!!row} placeholder={t('Choose a vendor')} options={(vendors.data ?? []).filter((v) => v.is_active).map((v) => ({ value: v.id, label: v.name }))} /></FormControl><FormMessage /></FormItem>
            )} />}
            <FormField control={form.control} name="variant_id" render={({ field }) => (
              <FormItem className="col-span-2"><FormLabel>{t('Item')}</FormLabel><FormControl><VariantPicker value={field.value} onChange={(v) => field.onChange(v)} disabled={!!row} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="price" render={({ field }) => (
              <FormItem><FormLabel>{t('Price (without VAT)')}</FormLabel><FormControl><Input type="number" step="any" className="tabular" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="currency_code" render={({ field }) => (
              <FormItem><FormLabel>{t('Currency')}</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>{(currencies.data ?? []).map((c) => <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>)}</SelectContent></Select></FormItem>
            )} />
            <FormField control={form.control} name="min_order_qty" render={({ field }) => (
              <FormItem><FormLabel>{t('Minimum order')}</FormLabel><FormControl><Input type="number" step="any" className="tabular" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="lead_time_days" render={({ field }) => (
              <FormItem><FormLabel>{t('Delivery time (days)')}</FormLabel><FormControl><Input type="number" step="1" className="tabular" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="vendor_sku" render={({ field }) => (
              <FormItem><FormLabel optional>{t("Vendor's item code")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
            )} />
            <FormField control={form.control} name="is_preferred" render={({ field }) => (
              <FormItem className="flex flex-row items-start gap-3 space-y-0 pt-6"><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                <div><FormLabel>{t('Preferred vendor')}</FormLabel><FormDescription>{t('Replenishment orders from them first.')}</FormDescription></div></FormItem>
            )} />
            <DialogFooter className="col-span-2 mt-1 sm:justify-between">
              {onDelete ? <ConfirmDialog trigger={<Button type="button" variant="ghost" className="text-destructive">{t('Remove')}</Button>} title={t('Remove this vendor price?')} description={t('Orders already placed keep their prices.')} confirmLabel={t('Remove')} destructive onConfirm={onDelete} /> : <span />}
              <div className="flex gap-2"><Button type="button" variant="ghost" onClick={onClose}>{t('Cancel')}</Button><Button type="submit" loading={save.isPending}>{t('Save')}</Button></div>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
