import * as React from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import type { Json, Tables, TablesUpdate, Views } from '@/lib/database.types'
import { describeError, unwrap } from '@/lib/errors'
import { after, byName, fetchAll, fetchPages, supabase } from '@/lib/supabase'
import { rememberUnits } from '@/lib/units'
import { t, tn } from '@/i18n'
import { isNetError, postReceiptOffline, saveDocumentOffline } from '@/lib/offline/step'

/* ------------------------------------------------------------------ keys */
export const invKeys = {
  all: (c: string) => ['inv', c] as const,
  lookups: (c: string, what: string) => ['inv', c, 'lookup', what] as const,
  productStock: (c: string) => ['inv', c, 'product-stock'] as const,
  product: (c: string, id: string) => ['inv', c, 'product', id] as const,
  stockLevels: (c: string) => ['inv', c, 'stock-levels'] as const,
  movements: (c: string, params: unknown) => ['inv', c, 'movements', params] as const,
  lowStock: (c: string) => ['inv', c, 'low-stock'] as const,
  overview: (c: string) => ['inv', c, 'overview'] as const,
  docs: (c: string, kind: DocKind) => ['inv', c, 'docs', kind] as const,
  doc: (c: string, kind: DocKind, id: string) => ['inv', c, 'docs', kind, id] as const,
}

/* --------------------------------------------------------------- lookups */
function useLookup<T>(what: string, fn: (companyId: string) => PromiseLike<{ data: T | null; error: unknown }>) {
  // (lists that can grow past 1,000 rows page through fetchAll inside fn)
  const { companyId } = useCompany()
  return useQuery({
    queryKey: invKeys.lookups(companyId, what),
    enabled: !!companyId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await fn(companyId)
      if (error) throw error
      return (data ?? []) as T
    },
  })
}

const useAllWarehouses = () =>
  useLookup('warehouses', (c) => supabase.from('warehouses').select('id, code, name, warehouse_type, city, is_active').eq('company_id', c).is('deleted_at', null).order('code'))

/** the warehouses this person works in (null = all of them) */
export function useMyWarehouseAccess() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: invKeys.lookups(companyId, 'my-warehouses'), enabled: !!companyId, staleTime: 5 * 60_000,
    queryFn: async () => unwrap(await supabase.rpc('my_warehouse_access', { p_company: companyId })) as string[] | null,
  })
}
/** The warehouses to choose from: only the ones this person works in, unless `all` (transfers, the warehouse list). */
export function useWarehouses(opts?: { all?: boolean }) {
  const q = useAllWarehouses()
  const acc = useMyWarehouseAccess()
  const mine = acc.data
  const data = React.useMemo(() => (!opts?.all && mine?.length && q.data ? q.data.filter((w) => mine.includes(w.id)) : q.data), [q.data, mine, opts?.all])
  return Object.assign({}, q, { data })
}

export type LocationRow = Pick<Tables<'warehouse_locations'>, 'id' | 'code' | 'name' | 'location_type' | 'warehouse_id' | 'parent_id' | 'is_pickable' | 'is_active' | 'barcode'>
export const useLocations = () =>
  useLookup<LocationRow[]>('locations', (c) => supabase.from('warehouse_locations')
    .select('id, code, name, location_type, warehouse_id, parent_id, is_pickable, is_active, barcode')
    .eq('company_id', c).is('deleted_at', null).order('code'))

export const useCategories = () =>
  useLookup('categories', (c) => supabase.from('product_categories').select('*').eq('company_id', c).is('deleted_at', null).order('name'))

export const useUnits = () =>
  useLookup('units', (c) => supabase.from('units_of_measure').select('id, code, name, category, ratio, is_reference, is_active').eq('company_id', c).is('deleted_at', null).order('category').order('ratio'))

export const useTaxCodes = () =>
  useLookup('tax', (c) => supabase.from('tax_codes').select('id, code, name, rate, scope, is_active').eq('company_id', c).is('deleted_at', null).order('rate', { ascending: false }))

export const useVendors = () =>
  useLookup('vendors', async (c) => ({ error: null, data: await fetchAll('id', (x) => after(supabase.from('business_partners').select('id, code, name, tax_number, currency_code')
    .eq('company_id', c).eq('is_vendor', true).is('deleted_at', null), 'id', x).order('id').limit(1000)).then(byName) }))

export const useCurrencies = () =>
  useLookup('currencies', () => supabase.from('currencies').select('code, name, symbol').eq('is_active', true).order('code'))

export type AttributeWithValues = Tables<'product_attributes'> & { product_attribute_values: Tables<'product_attribute_values'>[] }
export const useAttributes = () =>
  useLookup<AttributeWithValues[]>('attributes', (c) => supabase.from('product_attributes')
    .select('*, product_attribute_values(*)').eq('company_id', c).is('deleted_at', null).order('sort_order')
    .returns<AttributeWithValues[]>())

/** Variants for pickers (sku + name + tracking) */
export type VariantOption = { id: string; sku: string; name: string; product_id: string; tracking: string; avg_cost: number | null; uom_code: string | null; codes?: string | null; item_no?: number | null; barcode?: string | null }
export const useVariantOptions = () =>
  useLookup<VariantOption[]>('variant-options', async (c) => ({ error: null, data: await fetchAll('sku', (x) => after(supabase.from('v_variant_options')
    .select('id, sku, name, product_id, tracking, avg_cost, uom_code, codes, item_no')
    .eq('company_id', c).eq('product_type', 'stockable').eq('is_active', true), 'sku', x).order('sku').limit(1000)
    .returns<VariantOption[]>()).then((rows) => { rememberUnits(rows); return rows }) }))

export const useLots = (variantId?: string) => {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: ['inv', companyId, 'lots', variantId],
    enabled: !!companyId && !!variantId,
    queryFn: async () => unwrap(await supabase.from('lots').select('id, lot_number, expiry_date').eq('variant_id', variantId!).is('deleted_at', null).order('expiry_date', { nullsFirst: false })),
  })
}

/* --------------------------------------------------------------- products */
export type ProductStockRow = Views<'v_product_stock'>

export function useProductStock() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: invKeys.productStock(companyId),
    enabled: !!companyId,
    queryFn: () => fetchAll('sku', (x) => after(supabase.from('v_product_stock').select('*').eq('company_id', companyId), 'sku', x).order('sku').limit(1000))
      .then((rows) => rows.sort((p, q) => (p.product_name ?? '').localeCompare(q.product_name ?? '') || (p.sku ?? '').localeCompare(q.sku ?? ''))),
  })
}

export type ProductDetail = Tables<'products'> & {
  product_variants: (Tables<'product_variants'> & {
    product_barcodes: Tables<'product_barcodes'>[]
    variant_attribute_values: { attribute_value_id: string }[]
    replenishment_rules: Tables<'replenishment_rules'>[]
  })[]
}

export function useProduct(id: string | undefined) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: invKeys.product(companyId, id ?? ''),
    enabled: !!companyId && !!id,
    queryFn: async () => {
      const res = await supabase.from('products')
        .select('*, product_variants(*, product_barcodes(*), variant_attribute_values(attribute_value_id), replenishment_rules(*))')
        .eq('id', id!).single().returns<ProductDetail>()
      const p = unwrap(res)
      // hide soft-deleted children (visible to auditors)
      p.product_variants = p.product_variants
        .filter((v) => !v.deleted_at)
        .map((v) => ({
          ...v,
          product_barcodes: v.product_barcodes.filter((b) => !b.deleted_at),
          replenishment_rules: v.replenishment_rules.filter((r) => !r.deleted_at),
        }))
        .sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.sku.localeCompare(b.sku))
      return p
    },
  })
}

export function useProductStockLevels(productId: string | undefined) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: ['inv', companyId, 'product-levels', productId],
    enabled: !!companyId && !!productId,
    queryFn: async () => unwrap(await supabase.from('v_stock_levels').select('*').eq('product_id', productId!).order('warehouse_code').order('location_code')),
  })
}

export function useCostHistory(productId: string | undefined) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: ['inv', companyId, 'cost-history', productId],
    enabled: !!companyId && !!productId,
    queryFn: async () => {
      const variants = unwrap(await supabase.from('product_variants').select('id').eq('product_id', productId!))
      return unwrap(await supabase.from('item_cost_history')
        .select('id, variant_id, qty_before, avg_cost_before, qty_in, unit_cost_in, avg_cost_after, reason, created_at, movement:stock_movements(movement_date)')
        .in('variant_id', variants.map((v) => v.id)).order('created_at').limit(500))
    },
  })
}

/** Every change of an item's selling price: made here, or levelled in the old program. Newest first. */
export function usePriceChanges(productId: string | undefined) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: ['inv', companyId, 'price-changes', productId],
    enabled: !!companyId && !!productId,
    queryFn: async () => {
      const variants = unwrap(await supabase.from('product_variants').select('id').eq('product_id', productId!))
      return unwrap(await supabase.from('price_changes')
        .select('id, variant_id, changed_on, old_price, new_price, quantity, value_change, price_list, doc_number, source, created_at, warehouse:warehouses(name), by:profiles(full_name)')
        .in('variant_id', variants.map((v) => v.id)).order('changed_on', { ascending: false }).order('created_at', { ascending: false }).limit(300))
    },
  })
}

/** Pictures of the given products, as data: URLs keyed by product id (up to 60 at once). */
export function useProductImages(productIds: string[]) {
  const { companyId } = useCompany()
  const ids = [...new Set(productIds)].sort().slice(0, 60)
  return useQuery({
    queryKey: ['inv', companyId, 'images', ids.join(',')],
    enabled: !!companyId && ids.length > 0,
    staleTime: 10 * 60_000,
    queryFn: async () => (unwrap(await supabase.rpc('product_images_get', { p_company: companyId!, p_products: ids })) ?? {}) as Record<string, string>,
  })
}

/** Put a picture on a product (a data: URL), or take it off (null). */
export function useSetProductImage(productId: string) {
  const qc = useQueryClient()
  const { companyId } = useCompany()
  return useMutation({
    mutationFn: async (data: string | null) => unwrap(await supabase.rpc('product_image_set', { p_product: productId, p_data: data as string })),
    onSuccess: (_r, data) => {
      toast.success(data ? t('Picture saved') : t('Picture removed'))
      void qc.invalidateQueries({ queryKey: ['inv', companyId, 'images'] })
      void qc.invalidateQueries({ queryKey: invKeys.product(companyId ?? '', productId) })
    },
    onError: (e) => toast.error(describeError(e)),
  })
}

function useInvalidateInventory() {
  const qc = useQueryClient()
  const { companyId } = useCompany()
  return () => qc.invalidateQueries({ queryKey: invKeys.all(companyId) })
}

export interface CreateProductPayload {
  code: string
  name: string
  description?: string
  product_type: 'stockable' | 'consumable' | 'service'
  category_id?: string | null
  uom_id: string
  tracking: 'none' | 'lot' | 'serial'
  track_expiry: boolean
  is_sellable: boolean
  is_purchasable: boolean
  sales_price: number
  sales_tax_code_id?: string | null
  purchase_tax_code_id?: string | null
  brand?: string
  manufacturer?: string
  weight_kg?: number | null
  volume_m3?: number | null
  hs_code?: string
  variants: {
    sku: string
    attribute_value_ids: string[]
    barcodes: { barcode: string; symbology: string }[]
    generate_barcode: boolean
    sales_price_override?: number | null
  }[]
  reorder_rules: { warehouse_id: string; min_qty: number; max_qty: number; multiple_qty: number; preferred_vendor_id?: string | null }[]
}

export function useCreateProduct() {
  const { companyId } = useCompany()
  const invalidate = useInvalidateInventory()
  return useMutation({
    mutationFn: async (p: CreateProductPayload) =>
      unwrap(await supabase.rpc('create_product', { p: { ...p, company_id: companyId } as unknown as Json })),
    onSuccess: () => void invalidate(),
  })
}

export function useUpdateProduct(id: string) {
  const invalidate = useInvalidateInventory()
  return useMutation({
    mutationFn: async (patch: TablesUpdate<'products'>) => unwrap(await supabase.from('products').update(patch).eq('id', id).select().single()),
    onSuccess: () => { toast.success(t('Product saved')); void invalidate() },
  })
}

/** Bulk activate / deactivate / delete with optimistic list update */
export function useBulkProducts() {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  const key = invKeys.productStock(companyId)
  return useMutation({
    mutationFn: async ({ action, productIds }: { action: 'activate' | 'deactivate' | 'delete'; productIds: string[] }) => {
      if (action === 'delete') unwrap(await supabase.from('products').delete().in('id', productIds))
      else unwrap(await supabase.from('products').update({ is_active: action === 'activate' }).in('id', productIds))
      if (action !== 'delete') unwrap(await supabase.from('product_variants').update({ is_active: action === 'activate' }).in('product_id', productIds))
    },
    onMutate: async ({ action, productIds }) => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<ProductStockRow[]>(key)
      qc.setQueryData<ProductStockRow[]>(key, (rows) => action === 'delete'
        ? rows?.filter((r) => !productIds.includes(r.product_id ?? ''))
        : rows?.map((r) => (productIds.includes(r.product_id ?? '') ? { ...r, is_active: action === 'activate' } : r)))
      return { prev }
    },
    onError: (e, _v, ctx) => { qc.setQueryData(key, ctx?.prev); toast.error(describeError(e)) },
    onSuccess: (_d, v) => toast.success(v.action === 'delete' ? tn(v.productIds.length, '{n} product deleted', '{n} products deleted')
      : v.action === 'activate' ? tn(v.productIds.length, '{n} product activated', '{n} products activated')
      : tn(v.productIds.length, '{n} product deactivated', '{n} products deactivated')),
    onSettled: () => void qc.invalidateQueries({ queryKey: invKeys.all(companyId) }),
  })
}

export function useVariantMutations(productId: string) {
  const { companyId } = useCompany()
  const invalidate = useInvalidateInventory()
  const opts = { onSuccess: () => void invalidate() }
  return {
    addVariant: useMutation({
      mutationFn: async (v: { sku: string; name: string; sales_price_override: number | null; attribute_value_ids: string[] }) => {
        const row = unwrap(await supabase.from('product_variants').insert({
          company_id: companyId, product_id: productId, sku: v.sku, name: v.name, sales_price_override: v.sales_price_override,
        }).select('id').single())
        if (v.attribute_value_ids.length) {
          unwrap(await supabase.from('variant_attribute_values').insert(v.attribute_value_ids.map((a) => ({ company_id: companyId, variant_id: row.id, attribute_value_id: a }))))
        }
        return row
      },
      ...opts,
    }),
    updateVariant: useMutation({
      mutationFn: async ({ id, ...patch }: TablesUpdate<'product_variants'> & { id: string }) =>
        unwrap(await supabase.from('product_variants').update(patch).eq('id', id)),
      ...opts,
    }),
    addBarcode: useMutation({
      mutationFn: async (b: { variant_id: string; barcode?: string; symbology: string; generate?: boolean }) => {
        const code = b.generate ? unwrap(await supabase.rpc('generate_internal_barcode', { p_company: companyId })) : b.barcode!
        unwrap(await supabase.from('product_barcodes').insert({ company_id: companyId, variant_id: b.variant_id, barcode: code, symbology: b.generate ? 'ean13' : b.symbology }))
        return code
      },
      ...opts,
    }),
    removeBarcode: useMutation({
      mutationFn: async (id: string) => unwrap(await supabase.from('product_barcodes').delete().eq('id', id)),
      ...opts,
    }),
    saveRule: useMutation({
      mutationFn: async (r: { id?: string; variant_id: string; warehouse_id: string; min_qty: number; max_qty: number; multiple_qty: number; preferred_vendor_id: string | null }) => {
        const { id, ...rest } = r
        if (id) return unwrap(await supabase.from('replenishment_rules').update(rest).eq('id', id))
        return unwrap(await supabase.from('replenishment_rules').insert({ ...rest, company_id: companyId }))
      },
      ...opts,
    }),
    removeRule: useMutation({
      mutationFn: async (id: string) => unwrap(await supabase.from('replenishment_rules').delete().eq('id', id)),
      ...opts,
    }),
  }
}

/* ---------------------------------------------------------------- stock */
export function useStockLevels() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: invKeys.stockLevels(companyId),
    enabled: !!companyId,
    queryFn: () => fetchAll('id', (x) => after(supabase.from('v_stock_levels').select('*').eq('company_id', companyId), 'id', x).order('id').limit(1000))
      .then((rows) => rows.sort((p, q) => (p.sku ?? '').localeCompare(q.sku ?? ''))),
  })
}

export function useLowStock() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: invKeys.lowStock(companyId),
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('v_low_stock').select('*').eq('company_id', companyId).order('triggered_at', { ascending: false, nullsFirst: false })),
  })
}

export interface WarehouseStock {
  id: string
  code: string
  name: string
  type: string
  value: number
  items: number
  items_without_cost: number
  items_negative: number
  low_stock: number
}
/** Stock value and item counts for every active store / warehouse. */
export function useStockByWarehouse(enabled = true) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: ['inv', companyId, 'by-warehouse'],
    enabled: !!companyId && enabled,
    queryFn: async () => unwrap(await supabase.rpc('stock_by_warehouse', { p_company: companyId! })) as unknown as WarehouseStock[],
  })
}

export function useAcknowledgeAlert() {
  const invalidate = useInvalidateInventory()
  return useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.rpc('acknowledge_stock_alert', { p_id: id })),
    onSuccess: () => void invalidate(),
  })
}

export function useInventoryOverview() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: invKeys.overview(companyId),
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('inventory_overview', { p_company: companyId })) as unknown as InventoryOverview,
  })
}
export interface InventoryOverview {
  stock_value: number
  /** the same stock at the selling price with VAT */
  sales_value?: number
  active_skus: number
  low_stock: number
  negative_lines: number
  pending_clearance: number
  movements_today: number
  value_by_category: { name: string; value: number }[]
  movements_by_day: { day: string; value_in: number; value_out: number }[]
}

/* ------------------------------------------------------------- movements */
export interface MovementParams {
  pageIndex: number
  pageSize: number
  sort: { id: string; desc: boolean } | null
  search: string
  types: string[]
  directions: string[]
  productId?: string
}

export function useMovements(p: MovementParams) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: invKeys.movements(companyId, p),
    enabled: !!companyId,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let q = supabase.from('v_stock_movements').select('*', { count: 'exact' }).eq('company_id', companyId)
      if (p.productId) q = q.eq('product_id', p.productId)
      if (p.types.length) q = q.in('movement_type', p.types)
      if (p.directions.length) q = q.in('direction', p.directions)
      if (p.search.trim()) {
        const s = p.search.trim().replace(/[,()]/g, ' ')
        q = q.or(`sku.ilike.%${s}%,variant_name.ilike.%${s}%,reference.ilike.%${s}%,lot_number.ilike.%${s}%`)
      }
      q = q.order(p.sort?.id ?? 'movement_date', { ascending: p.sort ? !p.sort.desc : false })
      const from = p.pageIndex * p.pageSize
      const { data, error, count } = await q.range(from, from + p.pageSize - 1)
      if (error) throw error
      return { rows: data, count: count ?? 0 }
    },
  })
}

/* ------------------------------------------------------------- documents */
export type DocKind = 'receipts' | 'adjustments' | 'transfers' | 'landed-costs'

export const DOC_TABLE: Record<DocKind, 'goods_receipts' | 'stock_adjustments' | 'stock_transfers' | 'landed_costs'> = {
  receipts: 'goods_receipts',
  adjustments: 'stock_adjustments',
  transfers: 'stock_transfers',
  'landed-costs': 'landed_costs',
}

const LIST_SELECT: Record<DocKind, string> = {
  receipts: 'id, number, status, receipt_date, receipt_type, is_import, clearance_status, fiscal_status, currency_code, total_value, vendor:business_partners(name), warehouse:warehouses(name), purchase_order:purchase_orders(number), lines:goods_receipt_lines(count)',
  adjustments: 'id, number, status, adjustment_date, reason, total_value, notes, warehouse:warehouses(name), lines:stock_adjustment_lines(count)',
  transfers: 'id, number, status, transfer_date, is_request, has_difference, shipped_at, from:warehouses!stock_transfers_company_id_from_warehouse_id_fkey(name), to:warehouses!stock_transfers_company_id_to_warehouse_id_fkey(name), lines:stock_transfer_lines(count)',
  'landed-costs': 'id, number, status, landed_cost_date, allocation_method, total_amount, notes, receipts:landed_cost_receipts(receipt:goods_receipts(number))',
}

const DATE_COL: Record<DocKind, string> = {
  receipts: 'receipt_date', adjustments: 'adjustment_date', transfers: 'transfer_date', 'landed-costs': 'landed_cost_date',
}

export function useDocuments<T = Record<string, unknown>>(kind: DocKind) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: invKeys.docs(companyId, kind),
    enabled: !!companyId,
    queryFn: async () => {
      // every document, 1 000 at a time, newest first
      return await fetchPages((from, to) => supabase.from(DOC_TABLE[kind]).select(LIST_SELECT[kind])
        .eq('company_id', companyId!).is('deleted_at', null)
        .order(DATE_COL[kind], { ascending: false }).order('number', { ascending: false }).order('id').range(from, to)) as unknown as T[]
    },
  })
}

const DETAIL_SELECT: Record<DocKind, string> = {
  receipts: '*, lines:goods_receipt_lines(*), purchase_order:purchase_orders(number, currency_code, exchange_rate)',
  adjustments: '*, lines:stock_adjustment_lines(*)',
  transfers: '*, lines:stock_transfer_lines(*)',
  'landed-costs': '*, charges:landed_cost_charges(*), receipts:landed_cost_receipts(*), allocations:landed_cost_allocations(*, line:goods_receipt_lines(quantity, unit_cost, variant:product_variants(sku, name)))',
}

export function useDocument<T>(kind: DocKind, id: string | undefined) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: invKeys.doc(companyId, kind, id ?? ''),
    enabled: !!companyId && !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from(DOC_TABLE[kind]).select(DETAIL_SELECT[kind]).eq('id', id!).single()
      if (error) throw error
      return data as unknown as T
    },
  })
}

/** Atomic save of a draft header + child rows (server: save_document RPC). A goods receipt can also be saved without internet. */
export function useSaveDocument(kind: DocKind) {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ header, children, label }: { header: Record<string, unknown>; children: Record<string, Record<string, unknown>[]>; label?: string }) => {
      if (kind === 'receipts') {
        return saveDocumentOffline({ companyId: companyId!, table: DOC_TABLE[kind], header, children, label: label ?? t('Goods receipt'),
          invalidate: [[...invKeys.docs(companyId, kind)], ['inv', companyId]] })
      }
      const res = await supabase.rpc('save_document', { p_table: DOC_TABLE[kind], p_header: { ...header, company_id: companyId } as unknown as Json, p_children: children as unknown as Json })
      if (res.error && isNetError(res.error)) throw new Error(t('Saving this needs internet.'))
      return unwrap(res)
    },
    onSuccess: (id) => {
      void qc.invalidateQueries({ queryKey: invKeys.docs(companyId, kind) })
      void qc.invalidateQueries({ queryKey: invKeys.doc(companyId, kind, id) })
    },
  })
}

export function usePostDocument(kind: DocKind) {
  const invalidate = useInvalidateInventory()
  const { companyId } = useCompany()
  return useMutation({
    mutationFn: async (id: string): Promise<{ status: string; detail?: Json }> => {
      switch (kind) {
        case 'receipts': {
          const r = await postReceiptOffline({ companyId: companyId!, id, label: t('Goods receipt: receive'), invalidate: [['inv', companyId]] })
          return { status: r.offline ? 'queued' : 'done', detail: r.detail as Json }
        }
        case 'adjustments': return { status: unwrap(await supabase.rpc('post_stock_adjustment', { p_id: id })) }
        case 'transfers': return { status: unwrap(await supabase.rpc('post_stock_transfer', { p_id: id })) }
        case 'landed-costs': {
          const r = unwrap(await supabase.rpc('post_landed_cost', { p_id: id }))
          return { status: 'posted', detail: r }
        }
      }
    },
    onSuccess: () => void invalidate(),
    onError: (e) => toast.error(t('Could not complete the document'), { description: describeError(e) }),
  })
}

export function useCancelDocument(kind: DocKind) {
  const invalidate = useInvalidateInventory()
  return useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from(DOC_TABLE[kind]).update({ status: 'cancelled' }).eq('id', id)),
    onSuccess: () => { toast.success(t('Document cancelled')); void invalidate() },
  })
}

export function useDeleteDocument(kind: DocKind) {
  const invalidate = useInvalidateInventory()
  return useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from(DOC_TABLE[kind]).delete().eq('id', id)),
    onSuccess: () => { toast.success(t('Draft deleted')); void invalidate() },
  })
}

/* ------------------------------------------------- transfers between stores */
/** The sending store ships: the goods go on the road (still in stock, same value). */
export function useShipTransfer() {
  const invalidate = useInvalidateInventory()
  return useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.rpc('ship_stock_transfer', { p_id: id })),
    onSuccess: () => void invalidate(),
    onError: (e) => toast.error(t('Could not ship the transfer'), { description: describeError(e) }),
  })
}

export type ReceiveLine = { line_id: string; received: number; action?: 'loss' | 'return' }
/** The receiving store confirms what arrived; differences are a loss, go back, or are added. */
export function useReceiveTransfer() {
  const invalidate = useInvalidateInventory()
  return useMutation({
    mutationFn: async (a: { id: string; lines: ReceiveLine[]; note?: string }) =>
      unwrap(await supabase.rpc('receive_stock_transfer', { p_id: a.id, p_lines: a.lines as unknown as Json, p_note: a.note || undefined })) as unknown as
        { status: string; difference: boolean; lost: number; returned: number; extra: number },
    onSuccess: () => void invalidate(),
    onError: (e) => toast.error(t('Could not receive the transfer'), { description: describeError(e) }),
  })
}

/** Goods on the road and open requests, for the dashboard. */
export function useTransfersOnTheRoad(enabled = true) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...invKeys.all(companyId), 'on-the-road'],
    enabled: !!companyId && enabled,
    queryFn: async () => unwrap(await supabase.rpc('transfers_on_the_road', { p_company: companyId })) as unknown as { count: number; late: number; requests: number; value: number },
  })
}

/** Barcodes of a few items (to scan them while counting a delivery). */
export function useBarcodesOf(variantIds: string[]) {
  const { companyId } = useCompany()
  const ids = [...new Set(variantIds)].sort()
  return useQuery({
    queryKey: [...invKeys.all(companyId), 'barcodes-of', ids.join(',')],
    enabled: !!companyId && ids.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => unwrap(await supabase.from('product_barcodes').select('variant_id, barcode, quantity').in('variant_id', ids).is('deleted_at', null)),
  })
}

/** Stock of one warehouse (what a transfer can take from it). */
export function useWarehouseLevels(warehouseId: string | undefined) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...invKeys.all(companyId), 'wh-levels', warehouseId],
    enabled: !!companyId && !!warehouseId,
    queryFn: () => fetchAll('id', (x) => after(supabase.from('v_stock_levels').select('id, variant_id, location_id, lot_id, available')
      .eq('company_id', companyId).eq('warehouse_id', warehouseId!), 'id', x).order('id').limit(1000)),
  })
}

/** Open purchase orders that can be received */
export function useReceivablePurchaseOrders() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: ['inv', companyId, 'receivable-pos'],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('purchase_orders')
      .select('id, number, vendor_id, warehouse_id, currency_code, exchange_rate, vendor:business_partners(name), lines:purchase_order_lines(id, line_no, variant_id, description, quantity, qty_received, unit_price, discount_pct)')
      .eq('company_id', companyId).in('status', ['approved', 'sent', 'partially_received']).is('deleted_at', null).order('order_date', { ascending: false })),
  })
}

/** Posted receipts that a landed cost can be applied to */
export function usePostedReceipts() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: ['inv', companyId, 'posted-receipts'],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('goods_receipts')
      .select('id, number, receipt_date, is_import, clearance_status, total_value, customs_declaration_number, vendor:business_partners(name)')
      .eq('company_id', companyId).eq('status', 'done').is('deleted_at', null).order('receipt_date', { ascending: false }).limit(200)),
  })
}

/* ----------------------------------------------------------- master data */
type MasterTable = 'warehouses' | 'warehouse_locations' | 'product_categories' | 'units_of_measure' | 'product_attributes' | 'product_attribute_values'

/** create / update / delete for simple master-data tables; refreshes every inventory lookup */
export function useMasterData(table: MasterTable) {
  const { companyId } = useCompany()
  const invalidate = useInvalidateInventory()
  const opts = { onSuccess: () => void invalidate() }
  return {
    create: useMutation({
      mutationFn: async (values: Record<string, unknown>) =>
        unwrap(await supabase.from(table).insert({ ...values, company_id: companyId } as never).select('id').single()),
      ...opts,
    }),
    update: useMutation({
      mutationFn: async ({ id, ...values }: Record<string, unknown> & { id: string }) =>
        unwrap(await supabase.from(table).update(values as never).eq('id', id)),
      ...opts,
    }),
    remove: useMutation({
      mutationFn: async (id: string) => unwrap(await supabase.from(table).delete().eq('id', id)),
      onSuccess: () => { toast.success(t('Deleted')); void invalidate() },
    }),
  }
}

/* ------------------------------------------------------------------ new selling prices from the cost */
export type PriceSuggestion = {
  id: string; variant_id: string; product_id: string; sku: string; name: string; category: string | null
  cost_before: number | null; cost_after: number; margin_pct: number; basis: 'markup' | 'margin'; tax_rate: number
  price_now: number | null; price_new: number; gross_now: number | null; gross_new: number; on_hand: number | null
  status: 'pending' | 'accepted' | 'rejected' | 'outdated'; created_at: string; decided_at: string | null; decided_by_name: string | null
}
export function usePriceSuggestions(status: 'pending' | 'all') {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: ['price-suggestions', companyId, status],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('price_suggestions_list', { p_company: companyId!, p_status: status })) as unknown as PriceSuggestion[],
  })
}
export function useDecidePrices() {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { ids: string[]; accept: boolean; gross?: number }) =>
      unwrap(await supabase.rpc('price_suggestions_decide', { p_company: companyId!, p_ids: v.ids, p_accept: v.accept, p_gross: v.gross })) as number,
    onSuccess: (n, v) => {
      toast.success(v.accept ? tn(n, '{n} new price saved', '{n} new prices saved') : tn(n, '{n} suggestion rejected', '{n} suggestions rejected'))
      void qc.invalidateQueries({ queryKey: ['price-suggestions', companyId] })
      void qc.invalidateQueries({ queryKey: invKeys.all(companyId!) })
    },
    onError: (e) => toast.error(describeError(e)),
  })
}
export type PriceRules = { basis: 'markup' | 'margin'; step: number; down: boolean; min_pct: number; categories: { id: string; name: string; pct: number | null }[] }
export function usePriceRules() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: ['price-rules', companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<PriceRules> => {
      const s = unwrap(await supabase.from('company_settings').select('price_margin_basis, price_round_step, price_suggest_down, price_suggest_min_pct').eq('company_id', companyId!).single())
      const cats = unwrap(await supabase.from('product_categories').select('id, name, target_margin_pct').eq('company_id', companyId!).is('deleted_at', null).order('name'))
      return { basis: s.price_margin_basis as 'markup' | 'margin', step: Number(s.price_round_step), down: s.price_suggest_down, min_pct: Number(s.price_suggest_min_pct),
               categories: cats.map((c) => ({ id: c.id, name: c.name, pct: c.target_margin_pct == null ? null : Number(c.target_margin_pct) })) }
    },
  })
}
export function useSavePriceRules() {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (r: PriceRules & { scan: boolean }) => {
      unwrap(await supabase.rpc('price_rules_save', { p_company: companyId!, p_basis: r.basis, p_step: r.step, p_down: r.down, p_min_pct: r.min_pct,
        p_categories: r.categories.map((c) => ({ id: c.id, pct: c.pct == null ? '' : String(c.pct) })) }))
      return r.scan ? (unwrap(await supabase.rpc('price_suggestions_scan', { p_company: companyId! })) as number) : null
    },
    onSuccess: (n) => {
      toast.success(n == null ? t('Rules saved') : tn(n, 'Rules saved · {n} item to review', 'Rules saved · {n} items to review'))
      void qc.invalidateQueries({ queryKey: ['price-rules', companyId] })
      void qc.invalidateQueries({ queryKey: ['price-suggestions', companyId] })
    },
    onError: (e) => toast.error(describeError(e)),
  })
}

/** An item by its barcode or code (the first match), or null */
export async function lookupCode(companyId: string, code: string) {
  const { data, error } = await supabase.rpc('find_variant_by_code', { p_company: companyId, p_code: code })
  if (error) throw error
  const hit = data?.[0]
  return hit?.variant_id ? { ...hit, variant_id: hit.variant_id } : null
}
