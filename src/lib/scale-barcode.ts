/**
 * The scale's barcode (EAN-13): 2 digits of prefix, the item's PLU, the weight in grams (or the price in
 * cents), a check digit. e.g. 27 01234 01250 7 = PLU 1234, 1.250 kg.
 */
export type ScaleSetup = { on?: boolean; prefixes?: string[]; plu_digits?: number; value?: 'weight' | 'price' }
export type ScaleRead = { plu: string; weight: number | null; price: number | null }

const checkDigit = (d12: string) => {
  let s = 0
  for (let i = 0; i < 12; i++) s += Number(d12[i]) * (i % 2 ? 3 : 1)
  return (10 - (s % 10)) % 10
}

export function readScaleBarcode(code: string, setup: ScaleSetup | null | undefined): ScaleRead | null {
  if (!setup?.on || !/^\d{13}$/.test(code)) return null
  const prefixes = setup.prefixes?.length ? setup.prefixes : ['21', '22', '23', '24', '25', '26', '27', '28', '29']
  const prefix = prefixes.find((p) => code.startsWith(p))
  if (!prefix || checkDigit(code.slice(0, 12)) !== Number(code[12])) return null
  const n = Math.min(Math.max(setup.plu_digits ?? 5, 3), 6)
  const plu = code.slice(prefix.length, prefix.length + n).replace(/^0+/, '')
  const raw = Number(code.slice(prefix.length + n, 12))
  if (!plu || !(raw > 0)) return null
  return setup.value === 'price' ? { plu, weight: null, price: raw / 100 } : { plu, weight: raw / 1000, price: null }
}
