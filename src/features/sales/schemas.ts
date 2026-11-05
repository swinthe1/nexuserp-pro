import { msg } from '@/i18n'
import { z } from 'zod'

const num = (msg: string) => z.coerce.number({ invalid_type_error: msg })
const optUuid = z.string().uuid().nullable().optional()

export const salesLineSchema = z.object({
  key: z.string(),
  variant_id: optUuid,
  description: z.string().trim().min(1, 'Enter a description'),
  quantity: num('Enter a quantity').positive('Must be above 0'),
  unit_price: num('Enter a price'),
  discount_pct: num('Enter a discount').min(0).max(100, 'Max 100%'),
  tax_code_id: optUuid,
  price_source: z.enum(['auto', 'manual']).default('manual'),
  sales_order_line_id: optUuid,
  pack_id: optUuid,
  pack_qty: z.coerce.number().positive().nullable().optional(),
  /** a deduction of an advance invoice: negative, booked to customer advances */
  advance_invoice_id: optUuid,
  account_id: optUuid,
}).refine((l) => l.unit_price >= 0 || !!l.advance_invoice_id, { message: msg('Cannot be negative'), path: ['unit_price'] })
export type SalesLineValues = z.infer<typeof salesLineSchema>

export const salesDocSchema = z.object({
  partner_id: z.string({ required_error: 'Choose a customer', invalid_type_error: 'Choose a customer' }).uuid('Choose a customer'),
  doc_date: z.string().min(1, 'Choose a date'),
  second_date: z.string().optional(),          // quote: valid until · order: requested date · invoice: due date
  currency_code: z.string().length(3),
  exchange_rate: num('Enter a rate').positive('Must be above 0'),
  price_list_id: optUuid,
  payment_term_id: optUuid,
  salesperson_id: optUuid,
  warehouse_id: optUuid,
  customer_reference: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(4000).optional(),
  terms: z.string().trim().max(4000).optional(),
  lines: z.array(salesLineSchema).min(1, 'Add at least one line'),
})
export type SalesDocValues = z.infer<typeof salesDocSchema>

export const leadSchema = z.object({
  title: z.string().trim().min(2, 'What is this lead about?'),
  contact_name: z.string().trim().optional(),
  company_name: z.string().trim().optional(),
  email: z.string().trim().email('Enter a valid email').or(z.literal('')).optional(),
  phone: z.string().trim().optional(),
  source: z.enum(['website', 'referral', 'walk_in', 'campaign', 'cold_call', 'social', 'event', 'other']),
  estimated_value: z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number().nonnegative().nullable()),
  owner_id: optUuid,
  notes: z.string().trim().optional(),
}).refine((l) => l.contact_name || l.company_name || l.email || l.phone, { path: ['contact_name'], message: msg('Add at least a name, company, email or phone') })
export type LeadValues = z.infer<typeof leadSchema>

export const opportunitySchema = z.object({
  name: z.string().trim().min(2, 'Name the opportunity'),
  partner_id: optUuid,
  stage_id: z.string().uuid('Choose a stage'),
  owner_id: optUuid,
  expected_value: num('Enter a value').nonnegative(),
  expected_close_date: z.string().optional(),
  lost_reason: z.string().trim().optional(),
})
export type OpportunityValues = z.infer<typeof opportunitySchema>

export const partnerSchema = z.object({
  code: z.string().trim().max(20).optional(),   // empty = next number from the customer/vendor series
  name: z.string().trim().min(2, 'Enter a name'),
  legal_name: z.string().trim().optional(),
  kind: z.enum(['company', 'individual']),
  is_customer: z.boolean(),
  is_vendor: z.boolean(),
  /** the kind of a supplier: goods, expenses, investments (one or more) */
  vendor_kinds: z.array(z.enum(['goods', 'expenses', 'investments'])).default([]),
  tax_number: z.string().trim().optional(),
  vat_number: z.string().trim().optional(),
  email: z.string().trim().email('Enter a valid email').or(z.literal('')).optional(),
  phone: z.string().trim().optional(),
  website: z.string().trim().optional(),
  currency_code: z.string().length(3).nullable().optional(),
  payment_term_id: optUuid,
  price_list_id: optUuid,
  default_discount_pct: num('Enter a discount').min(0).max(100),
  credit_limit: z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number().nonnegative().nullable()),
  salesperson_id: optUuid,
  notes: z.string().trim().optional(),
  is_active: z.boolean(),
}).refine((p) => p.is_customer || p.is_vendor, { path: ['is_customer'], message: msg('A partner is a customer, a vendor, or both') })
export type PartnerValues = z.infer<typeof partnerSchema>

export const priceListSchema = z.object({
  name: z.string().trim().min(2, 'Name the price list'),
  currency_code: z.string().length(3),
  prices_include_tax: z.boolean(),
  is_default: z.boolean(),
  is_active: z.boolean(),
  valid_from: z.string().optional(),
  valid_to: z.string().optional(),
  items: z.array(z.object({
    variant_id: z.string({ invalid_type_error: 'Choose a product' }).uuid('Choose a product'),
    min_quantity: num('Enter a quantity').positive('Must be above 0'),
    price: num('Enter a price').nonnegative(),
    discount_pct: num('Enter a discount').min(0).max(100),
    valid_from: z.string().optional(),
    valid_to: z.string().optional(),
  })),
}).superRefine((pl, ctx) => {
  const seen = new Set<string>()
  pl.items.forEach((i, idx) => {
    const k = `${i.variant_id}|${i.min_quantity}`
    if (seen.has(k)) ctx.addIssue({ code: 'custom', path: ['items', idx, 'min_quantity'], message: msg('Duplicate quantity break') })
    seen.add(k)
  })
})
export type PriceListValues = z.infer<typeof priceListSchema>
