import type { RowPreview } from '@/components/data-table/types'
import { supabase } from '@/lib/supabase'

/**
 * The lines of documents that have no printed layout, for the quick look in their lists: vendor bills,
 * stock transfers and adjustments. Each reads its lines table with the item's name.
 */
type L = NonNullable<Awaited<ReturnType<NonNullable<RowPreview['lines']>>>>
const num = (v: unknown) => (v == null ? null : Number(v))

export const billLines = (id: string) => async (): Promise<L> => {
  const { data, error } = await supabase.from('vendor_bill_lines').select('line_no, description, quantity, unit_price, line_subtotal').eq('bill_id', id).order('line_no')
  if (error) throw error
  return (data ?? []).map((l) => ({ name: l.description, qty: Number(l.quantity), price: num(l.unit_price), total: num(l.line_subtotal) }))
}
export const transferLines = (id: string) => async (): Promise<L> => {
  const { data, error } = await supabase.from('stock_transfer_lines').select('quantity, variant:product_variants(name, sku)').eq('transfer_id', id)
  if (error) throw error
  return (data ?? []).map((l) => { const v = l.variant as unknown as { name: string; sku: string } | null; return { name: v ? `${v.name} · ${v.sku}` : '', qty: Number(l.quantity) } })
}
export const adjustmentLines = (id: string) => async (): Promise<L> => {
  const { data, error } = await supabase.from('stock_adjustment_lines').select('quantity_change, variant:product_variants(name, sku)').eq('adjustment_id', id)
  if (error) throw error
  return (data ?? []).map((l) => { const v = l.variant as unknown as { name: string; sku: string } | null; return { name: v ? `${v.name} · ${v.sku}` : '', qty: Number(l.quantity_change) } })
}
