import { formatQty } from '@/lib/utils'

/*
 * Which unit each item is counted in, remembered from the item list the program loads (variant options), so a
 * quantity can be written with its unit anywhere the item is known: formatQtyOf(12, variantId) → "12 copë".
 */
const units = new Map<string, string>()
export function rememberUnits(rows: { id: string; uom_code?: string | null }[]) {
  for (const r of rows) if (r.uom_code) units.set(r.id, r.uom_code)
}
export function unitOfVariant(variantId: string | null | undefined) {
  return variantId ? units.get(variantId) ?? null : null
}
/** A quantity of an item, with the item's unit */
export function formatQtyOf(value: number | string | null | undefined, variantId: string | null | undefined) {
  return formatQty(value, unitOfVariant(variantId))
}
