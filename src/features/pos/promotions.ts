/** Promotions on the till: the same rule as the server (app.promo_applies / app.promo_pct), so they work offline. */
export type TillPromo = {
  id: string; name: string; kind: 'percent' | 'fixed_price' | 'buy_get'; value: number | null; buy_qty: number | null; get_qty: number | null; min_qty: number
  all_items: boolean; variant_ids: string[]; starts_on: string | null; ends_on: string | null; weekdays: number[] | null; time_from: string | null; time_to: string | null
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const hm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`

export function promoPct(k: TillPromo, price: number, qty: number) {
  const q = Math.abs(qty)
  if (q < Number(k.min_qty || 1)) return 0
  if (k.kind === 'percent') return Number(k.value)
  if (k.kind === 'fixed_price') return price > 0 && Number(k.value) < price ? Math.round((1 - Number(k.value) / price) * 1e6) / 1e4 : 0
  const set = Number(k.buy_qty) + Number(k.get_qty)
  return q >= set ? Math.round(Math.floor(q / set) * Number(k.get_qty) / q * 1e6) / 1e4 : 0
}

function applies(k: TillPromo, variant: string, at: Date) {
  const day = ymd(at)
  if (k.starts_on && day < k.starts_on) return false
  if (k.ends_on && day > k.ends_on) return false
  const dow = at.getDay() === 0 ? 7 : at.getDay()
  if (k.weekdays?.length && !k.weekdays.includes(dow)) return false
  const time = hm(at)
  if (k.time_from && time < k.time_from) return false
  if (k.time_to && time > k.time_to) return false
  return k.all_items || k.variant_ids.includes(variant)
}

/** the promotion that gives the most on a line, if any */
export function bestPromo(promos: TillPromo[] | undefined, variant: string, price: number, qty: number, at = new Date()) {
  let best: { id: string; name: string; pct: number } | null = null
  for (const k of promos ?? []) {
    if (!applies(k, variant, at)) continue
    const pct = promoPct(k, price, qty)
    if (pct > 0 && (!best || pct > best.pct)) best = { id: k.id, name: k.name, pct }
  }
  return best
}
