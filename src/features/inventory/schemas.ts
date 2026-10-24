import { msg } from '@/i18n'
import { z } from 'zod'

const gtinCheck = (code: string) => {
  const body = code.slice(0, -1)
  const sum = body.split('').reverse().reduce((s, d, i) => s + Number(d) * (i % 2 === 0 ? 3 : 1), 0)
  return (10 - (sum % 10)) % 10 === Number(code.at(-1))
}

export const symbologySchema = z.enum(['ean13', 'ean8', 'upca', 'code128', 'code39', 'qr', 'datamatrix', 'internal'])

/** Mirrors the database barcode validation so users see the error while typing */
export const barcodeSchema = z.object({
  barcode: z.string().trim(),
  symbology: symbologySchema,
}).superRefine((b, ctx) => {
  if (!b.barcode) return
  const len = { ean13: 13, ean8: 8, upca: 12 }[b.symbology as 'ean13' | 'ean8' | 'upca']
  if (!len) return
  if (!/^\d+$/.test(b.barcode) || b.barcode.length !== len) {
    ctx.addIssue({ code: 'custom', path: ['barcode'], message: { ean13: msg('An EAN-13 barcode has 13 digits'), ean8: msg('An EAN-8 barcode has 8 digits'), upca: msg('A UPC-A barcode has 12 digits') }[b.symbology as 'ean13' | 'ean8' | 'upca'] })
  } else if (!gtinCheck(b.barcode)) {
    ctx.addIssue({ code: 'custom', path: ['barcode'], message: msg('Check digit is wrong') })
  }
})

const optionalNumber = z.preprocess((v) => (v === '' || v === null || v === undefined ? null : Number(v)), z.number().nonnegative().nullable())

export const productSchema = z.object({
  code: z.string().trim().min(1, msg('Enter a product code')).max(40).regex(/^[A-Za-z0-9._\-/]+$/, msg('Letters, numbers and . _ - / only')),
  name: z.string().trim().min(2, msg('Enter a product name')).max(200),
  description: z.string().trim().max(2000).optional(),
  product_type: z.enum(['stockable', 'consumable', 'service']),
  category_id: z.string().uuid().nullable().optional(),
  uom_id: z.string().uuid({ message: msg('Choose a unit') }),
  tracking: z.enum(['none', 'lot', 'serial']),
  track_expiry: z.boolean(),
  is_sellable: z.boolean(),
  is_purchasable: z.boolean(),
  sales_price: z.coerce.number({ invalid_type_error: msg('Enter a price') }).nonnegative(msg('Price cannot be negative')),
  sales_tax_code_id: z.string().uuid().nullable().optional(),
  purchase_tax_code_id: z.string().uuid().nullable().optional(),
  brand: z.string().trim().max(80).optional(),
  weight_kg: optionalNumber,
  volume_m3: optionalNumber,
  hs_code: z.string().trim().max(20).optional(),
  attribute_ids: z.array(z.string()),
  selected_values: z.record(z.array(z.string())),
  variants: z.array(z.object({
    key: z.string(),
    attribute_value_ids: z.array(z.string()),
    label: z.string(),
    sku: z.string().trim().min(1, msg('SKU required')).max(60),
    barcode: z.string().trim(),
    symbology: symbologySchema,
    generate_barcode: z.boolean(),
    sales_price_override: optionalNumber,
  }).superRefine((v, ctx) => {
    const r = barcodeSchema.safeParse({ barcode: v.barcode, symbology: v.symbology })
    if (!r.success) ctx.addIssue({ code: 'custom', path: ['barcode'], message: r.error.issues[0]?.message ?? msg('Invalid barcode') })
  })).min(1),
  reorder_rules: z.array(z.object({
    warehouse_id: z.string().uuid({ message: msg('Choose a warehouse') }),
    min_qty: z.coerce.number().nonnegative(),
    max_qty: z.coerce.number().nonnegative(),
    multiple_qty: z.coerce.number().positive(msg('Must be above 0')),
    preferred_vendor_id: z.string().uuid().nullable().optional(),
  }).refine((r) => r.max_qty >= r.min_qty, { path: ['max_qty'], message: msg('The maximum must be at least the reorder point') })),
}).superRefine((p, ctx) => {
  const skus = new Map<string, number>()
  p.variants.forEach((v, i) => {
    const k = v.sku.toUpperCase()
    if (skus.has(k)) ctx.addIssue({ code: 'custom', path: ['variants', i, 'sku'], message: msg('This code is used twice') })
    skus.set(k, i)
  })
  if (p.product_type !== 'stockable' && p.tracking !== 'none') {
    ctx.addIssue({ code: 'custom', path: ['tracking'], message: msg('Only stocked products can be tracked by lot or serial number') })
  }
  const whs = new Set<string>()
  p.reorder_rules.forEach((r, i) => {
    if (whs.has(r.warehouse_id)) ctx.addIssue({ code: 'custom', path: ['reorder_rules', i, 'warehouse_id'], message: msg('Only one reorder point per warehouse') })
    whs.add(r.warehouse_id)
  })
})
export type ProductFormValues = z.infer<typeof productSchema>

/* ---------- inventory documents ---------- */
const qty = z.coerce.number({ invalid_type_error: msg('Enter a quantity') })
const uuid = (msg: string) => z.string({ required_error: msg, invalid_type_error: msg }).uuid({ message: msg })

export const receiptSchema = z.object({
  id: z.string().optional(),
  warehouse_id: uuid(msg('Choose a warehouse')),
  receipt_type: z.enum(['purchase', 'customer_return', 'other']),
  purchase_order_id: z.string().uuid().nullable().optional(),
  vendor_id: z.string().uuid().nullable().optional(),
  receipt_date: z.string().min(1, msg('Choose a date')),
  vendor_delivery_note: z.string().trim().max(80).optional(),
  currency_code: z.string().length(3).nullable().optional(),
  exchange_rate: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : Number(v)), z.number().positive(msg('Rate must be above 0')).nullable()),
  is_import: z.boolean(),
  origin_country: z.string().trim().max(2).optional(),
  customs_declaration_number: z.string().trim().max(60).optional(),
  customs_declaration_date: z.string().optional(),
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(z.object({
    po_line_id: z.string().uuid().nullable().optional(),
    variant_id: uuid(msg('Choose a product')),
    location_id: uuid(msg('Choose a location')),
    lot_id: z.string().uuid().nullable().optional(),
    quantity: qty.positive(msg('Must be above 0')),
    unit_price: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : Number(v)), z.number().nonnegative().nullable()),
    qc_status: z.enum(['pending', 'accepted', 'rejected']),
  })).min(1, msg('Add at least one line')),
}).superRefine((r, ctx) => {
  r.lines.forEach((l, i) => {
    if (!l.po_line_id && l.unit_price === null) ctx.addIssue({ code: 'custom', path: ['lines', i, 'unit_price'], message: msg('Enter the unit price') })
  })
  if (r.is_import && !r.customs_declaration_number) {
    ctx.addIssue({ code: 'custom', path: ['customs_declaration_number'], message: msg('Enter the customs declaration number') })
  }
})
export type ReceiptFormValues = z.infer<typeof receiptSchema>

export const adjustmentSchema = z.object({
  id: z.string().optional(),
  warehouse_id: uuid(msg('Choose a warehouse')),
  adjustment_date: z.string().min(1),
  reason: z.enum(['opening', 'correction', 'damage', 'loss', 'theft', 'found', 'expiry', 'count']),
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(z.object({
    variant_id: uuid(msg('Choose a product')),
    location_id: uuid(msg('Choose a location')),
    lot_id: z.string().uuid().nullable().optional(),
    quantity_change: qty.refine((n) => n !== 0, msg('Cannot be zero')),
    unit_cost: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : Number(v)), z.number().nonnegative().nullable()),
  })).min(1, msg('Add at least one line')),
}).superRefine((a, ctx) => {
  a.lines.forEach((l, i) => {
    if (a.reason === 'opening' && l.quantity_change > 0 && l.unit_cost === null) {
      ctx.addIssue({ code: 'custom', path: ['lines', i, 'unit_cost'], message: msg('Opening stock needs a cost') })
    }
  })
})
export type AdjustmentFormValues = z.infer<typeof adjustmentSchema>

export const transferSchema = z.object({
  id: z.string().optional(),
  from_warehouse_id: uuid(msg('Choose the source warehouse')),
  to_warehouse_id: uuid(msg('Choose the destination warehouse')),
  transfer_date: z.string().min(1),
  notes: z.string().trim().max(2000).optional(),
  is_request: z.boolean().optional(),
  lines: z.array(z.object({
    variant_id: uuid(msg('Choose a product')),
    from_location_id: uuid(msg('Choose a location')),
    to_location_id: uuid(msg('Choose a location')),
    lot_id: z.string().uuid().nullable().optional(),
    quantity: qty.positive(msg('Must be above 0')),
  })).min(1, msg('Add at least one line')),
}).superRefine((t, ctx) => {
  t.lines.forEach((l, i) => {
    if (l.from_location_id && l.from_location_id === l.to_location_id) {
      ctx.addIssue({ code: 'custom', path: ['lines', i, 'to_location_id'], message: msg('Same as the source shelf') })
    }
  })
})
export type TransferFormValues = z.infer<typeof transferSchema>

export const landedCostSchema = z.object({
  id: z.string().optional(),
  landed_cost_date: z.string().min(1),
  allocation_method: z.enum(['value', 'quantity', 'weight', 'volume', 'equal']),
  notes: z.string().trim().max(2000).optional(),
  // customs declaration (DUD): import VAT is recoverable input VAT, not stock value
  customs_declaration_number: z.string().trim().max(60).optional(),
  customs_declaration_date: z.string().optional(),
  customs_value: z.coerce.number().min(0, msg('Cannot be negative')).optional(),
  import_vat_rate: z.coerce.number().min(0).max(100).optional(),
  import_vat: z.coerce.number().min(0, msg('Cannot be negative')).optional(),
  receipt_ids: z.array(z.string().uuid()).min(1, msg('Choose at least one receipt')),
  charges: z.array(z.object({
    charge_type: z.enum(['freight', 'customs', 'insurance', 'handling', 'storage', 'other']),
    description: z.string().trim().max(200).optional(),
    amount: z.coerce.number().positive(msg('Must be above 0')),
  })).min(1, msg('Add at least one charge')),
})
export type LandedCostFormValues = z.infer<typeof landedCostSchema>
