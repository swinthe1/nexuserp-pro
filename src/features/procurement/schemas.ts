import { z } from 'zod/v3'

const num = (msg: string) => z.coerce.number({ invalid_type_error: msg })
const optUuid = z.string().uuid().nullable().optional()

export const purchaseLineSchema = z.object({
  key: z.string(),
  variant_id: optUuid,
  description: z.string().trim().min(1, 'Enter a description'),
  quantity: num('Enter a quantity').positive('Must be above 0'),
  unit_price: num('Enter a price').nonnegative('Cannot be negative'),
  discount_pct: num('Enter a discount').min(0).max(100, 'Max 100%'),
  tax_code_id: optUuid,
  price_source: z.enum(['auto', 'manual']).default('manual'),
  po_line_id: optUuid,
  receipt_line_id: optUuid,
  requisition_line_id: optUuid,
  pack_id: optUuid,
  pack_qty: z.coerce.number().positive().nullable().optional(),
})
export type PurchaseLineValues = z.infer<typeof purchaseLineSchema>

const docBase = {
  vendor_id: z.string({ required_error: 'Choose a vendor', invalid_type_error: 'Choose a vendor' }).uuid('Choose a vendor'),
  doc_date: z.string().min(1, 'Choose a date'),
  second_date: z.string().optional(),                 // PO: expected delivery · bill: due date
  currency_code: z.string().length(3),
  exchange_rate: num('Enter a rate').positive('Must be above 0'),
  payment_term_id: optUuid,
  notes: z.string().trim().max(4000).optional(),
  lines: z.array(purchaseLineSchema).min(1, 'Add at least one line'),
}

export const purchaseOrderSchema = z.object({
  ...docBase,
  warehouse_id: z.string({ invalid_type_error: 'Choose a warehouse' }).uuid('Choose a warehouse'),
  buyer_id: optUuid,
  vendor_reference: z.string().trim().max(80).optional(),
  incoterm: z.string().nullable().optional(),
})
export type PurchaseOrderValues = z.infer<typeof purchaseOrderSchema>

export const billSchema = z.object({
  ...docBase,
  vendor_invoice_number: z.string().trim().min(1, "Enter the vendor's invoice number").max(60),
})
export type BillValues = z.infer<typeof billSchema>

export const requisitionSchema = z.object({
  warehouse_id: optUuid,
  required_date: z.string().optional(),
  justification: z.string().trim().max(2000).optional(),
  lines: z.array(z.object({
    key: z.string(),
    variant_id: optUuid,
    description: z.string().trim().min(1, 'Describe the item'),
    quantity: num('Enter a quantity').positive('Must be above 0'),
    estimated_unit_cost: num('Enter a cost').nonnegative('Cannot be negative'),
    suggested_vendor_id: optUuid,
  })).min(1, 'Add at least one item'),
})
export type RequisitionValues = z.infer<typeof requisitionSchema>

export const vendorProductSchema = z.object({
  vendor_id: z.string({ invalid_type_error: 'Choose a vendor' }).uuid('Choose a vendor'),
  variant_id: z.string({ invalid_type_error: 'Choose a product' }).uuid('Choose a product'),
  vendor_sku: z.string().trim().max(60).optional(),
  price: num('Enter a price').nonnegative('Cannot be negative'),
  currency_code: z.string().length(3),
  min_order_qty: num('Enter a quantity').positive('Must be above 0'),
  lead_time_days: num('Enter days').int('Whole days').min(0),
  is_preferred: z.boolean(),
})
export type VendorProductValues = z.infer<typeof vendorProductSchema>
