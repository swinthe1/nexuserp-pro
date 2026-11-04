import { normalize } from '@/lib/fuzzy'

/**
 * The columns of a supplier's file: which is the barcode, the code, the name, the quantity, the price.
 * Suppliers write them every way ("Barkodi", "EAN", "Shifra", "Šifra", "Emërtimi", "Naziv", "Sasia",
 * "Kol.", "Çmimi pa TVSH", "Cena", "Rabat %"), often under a few rows of title, and sometimes with no
 * header at all: then the content decides (13 digits is a barcode, the longest text is the name…).
 */
export type Role = 'barcode' | 'code' | 'name' | 'qty' | 'price' | 'price_vat' | 'discount' | 'vat' | 'total' | 'total_vat' | 'skip'
export const ROLES: Role[] = ['barcode', 'code', 'name', 'qty', 'price', 'price_vat', 'discount', 'vat', 'total', 'total_vat', 'skip']

const WORDS: [Role, RegExp][] = [
  // the order matters: "çmimi me tvsh" is a price with VAT, not the VAT
  ['barcode', /\b(barkod|bar kod|barcode|bar code|ean|gtin|upc)/],
  // the VAT's amount is not needed: the price and the rate are enough
  ['skip', /\b(vlera|shuma|iznos|amount|iznos)\b\s+(e\s+)?(tvsh|vat|pdv)\b/],
  ['total_vat', /\b(vlera|totali|total|shuma|iznos|vrednost|amount)\b.*\b(me|with|sa|incl)\b.*\b(tvsh|vat|pdv)/],
  ['total', /\b(vlera|totali|total|shuma|iznos|vrednost|amount)\b/],
  ['price_vat', /\b(cmim|cmimi|qmim|qmimi|price|cena|cijena)\w*\b.*\b(me|with|sa|incl)\b.*\b(tvsh|vat|pdv)/],
  ['price', /\b(cmim|cmimi|qmim|qmimi|price|cena|cijena)\w*/],
  ['discount', /\b(rabat|rabati|zbritje|zbritja|discount|popust|rab)\b/],
  ['vat', /\b(tvsh|vat|pdv|tax)\b/],
  ['qty', /\b(sasi|sasia|sasija|kol|kolicina|kolicine|qty|quantity|cope|copa|pcs|komada|kom)\b/],
  ['code', /\b(shifr|shifra|shifer|sifra|kod|kodi|code|sku|art|artikull nr|ref|plu)\b/],
  ['name', /\b(emertim|emertimi|emri|pershkrim|pershkrimi|artikull|artikulli|produkt|produkti|name|description|naziv|opis|malli)\w*/],
]

export function roleOfHeader(h: string): Role | null {
  const n = normalize(h)
  if (!n) return null
  for (const [r, re] of WORDS) if (re.test(n)) return r
  return null
}

/**
 * A number as suppliers write it: 1.234,56 · 1,234.56 · 1234,5 · 12 € · -3. In a file that writes its
 * decimals with a comma (0,72), "1.200" is twelve hundred.
 */
export function toNum(s: string | null | undefined, commaDecimal = false): number | null {
  let x = String(s ?? '').replace(/[\s €$£%]|EUR|ALL|LEK|L$/gi, '')
  if (!x || !/\d/.test(x)) return null
  const lastDot = x.lastIndexOf('.'), lastComma = x.lastIndexOf(',')
  if (lastDot >= 0 && lastComma >= 0) x = lastComma > lastDot ? x.replace(/\./g, '').replace(',', '.') : x.replace(/,/g, '')
  else if (lastComma >= 0) x = (x.match(/,/g)!.length > 1) ? x.replace(/,/g, '') : x.replace(',', '.')
  else if ((x.match(/\./g)?.length ?? 0) > 1 || (commaDecimal && /^-?\d{1,3}\.\d{3}$/.test(x))) x = x.replace(/\./g, '')
  const v = Number(x)
  return Number.isFinite(v) ? v : null
}

const isBarcode = (s: string) => /^\d{8,14}$/.test(s.replace(/\s/g, ''))

/** the header row: the first of the top rows where at least two cells read as column names */
export function findHeader(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const known = new Set(rows[i]!.map(roleOfHeader).filter(Boolean))
    if (known.size >= 2) return i
  }
  return -1
}

/** the roles of the columns: from the header where there is one, else (and for the rest) from what is in them */
export function detectRoles(rows: string[][], header: number): Role[] {
  const width = Math.max(0, ...rows.map((r) => r.length))
  const roles: (Role | null)[] = Array.from({ length: width }, (_, c) => header >= 0 ? roleOfHeader(rows[header]![c] ?? '') : null)
  // one column for each role (the first wins), the rest are left out
  const seen = new Set<Role>()
  roles.forEach((r, c) => { if (r) { if (seen.has(r)) roles[c] = 'skip'; else seen.add(r) } })
  const data = rows.slice(header + 1, header + 60)
  const stat = Array.from({ length: width }, (_, c) => {
    const cells = data.map((r) => (r[c] ?? '').trim()).filter(Boolean)
    const nums = cells.map((x) => toNum(x)).filter((v): v is number => v != null)
    return {
      filled: cells.length, bar: cells.filter(isBarcode).length, num: nums.length,
      ints: nums.filter((v) => Number.isInteger(v)).length, text: cells.filter((s) => /[a-zà-ž]{3,}/i.test(s)).length,
      len: cells.reduce((s, x) => s + x.length, 0) / Math.max(cells.length, 1),
    }
  })
  const free = (c: number) => roles[c] == null
  const pick = (role: Role, test: (s: (typeof stat)[number], c: number) => boolean, best?: (s: (typeof stat)[number]) => number) => {
    if (seen.has(role)) return
    const cands = stat.map((s, c) => [s, c] as const).filter(([s, c]) => free(c) && s.filled > 0 && test(s, c))
    if (best) cands.sort((a, b) => best(b[0]) - best(a[0]))
    const hit = cands[0]
    if (hit) { roles[hit[1]] = role; seen.add(role) }
  }
  pick('barcode', (s) => s.bar >= s.filled * 0.6)
  pick('name', (s) => s.text >= s.filled * 0.6, (s) => s.len)
  pick('code', (s) => s.text < s.filled * 0.6 && s.num < s.filled * 0.9 && s.len <= 20)
  // the numbers, left to right: the quantity, then the price
  pick('qty', (s) => s.num >= s.filled * 0.8)
  pick('price', (s) => s.num >= s.filled * 0.8)
  return roles.map((r) => r ?? 'skip')
}

export interface FileLine { row: number; barcode: string | null; code: string | null; name: string; qty: number; price: number | null; priceVat: number | null
  discount: number; vat: number | null; total: number | null; totalVat: number | null }

/** the lines of the file with their roles; rows that are not lines (titles, totals, empty) are left out */
export function readLines(rows: string[][], header: number, roles: Role[]): FileLine[] {
  const col = (r: Role) => roles.indexOf(r)
  const get = (row: string[], r: Role) => { const c = col(r); return c >= 0 ? (row[c] ?? '').trim() : '' }
  const out: FileLine[] = []
  const comma = rows.slice(header + 1, header + 200).some((r) => r.some((c) => /^\s*-?[\d.]*\d,\d{1,4}\s*(€|%)?\s*$/.test(c)))
  const n = (s: string) => toNum(s, comma)
  rows.forEach((row, i) => {
    if (i <= header) return
    const name = get(row, 'name'), code = get(row, 'code'), barcode = get(row, 'barcode').replace(/\s/g, '')
    if (!name && !code && !barcode) return
    // a line of totals at the bottom
    if (!code && !barcode && /^(gjithsej|totali|total|shuma|ukupno|sum)\b/i.test(normalize(name))) return
    const total = n(get(row, 'total')), totalVat = n(get(row, 'total_vat'))
    let qty = n(get(row, 'qty'))
    const price = n(get(row, 'price')), priceVat = n(get(row, 'price_vat'))
    if (qty == null && col('qty') < 0 && (price != null || priceVat != null)) qty = 1
    if (qty == null || qty === 0) return
    out.push({ row: i, barcode: barcode || null, code: code || null, name: name || code || barcode, qty, price, priceVat,
      discount: n(get(row, 'discount')) ?? 0, vat: n(get(row, 'vat')), total, totalVat })
  })
  return out
}

/**
 * The unit price without VAT and before the discount, as the invoice line wants it: written so, or with
 * VAT (the VAT taken out), or only the line's value (divided by the quantity, the discount put back).
 */
export function netUnitPrice(l: FileLine, vatRate: number | null): number | null {
  const rate = l.vat ?? vatRate
  const undisc = (x: number) => (l.discount > 0 && l.discount < 100 ? x / (1 - l.discount / 100) : x)
  if (l.price != null) return l.price
  if (l.priceVat != null) return rate == null ? null : l.priceVat / (1 + rate / 100)
  if (l.total != null) return undisc(l.total / l.qty)
  if (l.totalVat != null && rate != null) return undisc(l.totalVat / (1 + rate / 100) / l.qty)
  return null
}

/** what a file's columns look like, to know the same supplier's file next time */
export const columnsSignature = (rows: string[][], header: number) =>
  header >= 0 && rows[header] ? rows[header]!.map((h) => normalize(h)).join('|') : `#${Math.max(0, ...rows.slice(0, 20).map((r) => r.length))}`
