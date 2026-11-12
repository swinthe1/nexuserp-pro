import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { getLocale, msg, t, tEnum } from '@/i18n'
import { formatDateWith, formatNumberWith } from '@/i18n/format'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

function nf(_key: string, opts: Intl.NumberFormatOptions) {
  return { format: (n: number) => formatNumberWith(n, opts) }
}

/** How a currency is written next to an amount: lekë in Albanian ("12 340,00 lekë"), the euro sign for euros, otherwise the code. */
export function currencyLabel(code: string) {
  if (code === 'ALL') return getLocale() === 'sq' ? 'lekë' : 'ALL'
  if (code === 'EUR') return '€'
  return code
}

/** Money in the current language's format with the currency after it: "12 340,00 lekë" (sq), "12,340.00 ALL" (en), "1 250,00 €" */
/**
 * The company's own currency: every amount shows it after the number, unless another currency is given.
 * Set by the company provider when the company is chosen.
 */
let moneyCurrency: string | null = null
export function setMoneyCurrency(code: string | null | undefined) { moneyCurrency = code || null }

/**
 * Money, always with its currency after the number ("1 250,50 €"). Without a currency the company's own is
 * used; pass null only where the currency is written next to it by hand (a price table, a template).
 * For numbers that go into an input or a spreadsheet, use formatAmount.
 */
export function formatMoney(value: number | string | null | undefined, currency?: string | null, decimals = 2) {
  if (value === null || value === undefined || value === '') return '—'
  const s = formatAmount(value, decimals)
  const cur = currency === undefined ? moneyCurrency : currency
  return cur ? `${s} ${currencyLabel(cur)}` : s
}

/** A price of one unit: two decimals, or up to four when the price has them (0,3333 €) */
export function formatPrice(value: number | string | null | undefined, currency?: string | null) {
  if (value === null || value === undefined || value === '') return '—'
  const n = Math.round(Number(value) * 1e4) / 1e4
  const d = Math.abs(n * 100 - Math.round(n * 100)) < 1e-6 ? 2 : Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6 ? 3 : 4
  return formatMoney(n, currency, d)
}

/** An amount without its currency: for inputs and spreadsheets only */
export function formatAmount(value: number | string | null | undefined, decimals = 2) {
  if (value === null || value === undefined || value === '') return ''
  let n = typeof value === 'string' ? Number(value) : value
  if (Math.abs(n) < 0.5 / 10 ** decimals) n = 0   // never "-0,00"
  return nf(`m${decimals}`, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n)
}

/** Money in a short form for charts and tiles ("12,3 mijë €") */
export function formatMoneyCompact(value: number | null | undefined, currency?: string | null) {
  if (value === null || value === undefined) return '—'
  const cur = currency === undefined ? moneyCurrency : currency
  const s = nf('c', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
  return cur ? `${s} ${currencyLabel(cur)}` : s
}

/*
 * Units of measure after quantities: "22 copë", "3 pako", "1,250 kg", "500 g", "0,75 l" → "750 ml".
 * A unit can be given by its code (pcs, kg…) or its name (Piece, Kilogram…); an unknown unit is written as it is.
 */
const UNIT_ALIAS: Record<string, string> = {
  pcs: 'pcs', pc: 'pcs', piece: 'pcs', pieces: 'pcs', copë: 'pcs', cope: 'pcs', kom: 'pcs', unit: 'pcs', units: 'pcs', ea: 'pcs',
  kg: 'kg', kilogram: 'kg', kilograms: 'kg', g: 'g', gr: 'g', gram: 'g', grams: 'g',
  l: 'l', lt: 'l', litre: 'l', liter: 'l', litres: 'l', liters: 'l', ml: 'ml', millilitre: 'ml', milliliter: 'ml',
  m: 'm', metre: 'm', meter: 'm', metres: 'm', meters: 'm', cm: 'cm', centimetre: 'cm', centimeter: 'cm', mm: 'mm', millimetre: 'mm', millimeter: 'mm',
  box: 'box', kuti: 'box', dz: 'dz', dozen: 'dz', pack: 'pack', pkg: 'pack', pako: 'pack', h: 'h', hour: 'h', hours: 'h', orë: 'h',
}
const UNIT_WORDS: Record<string, [string, string]> = {
  pcs: [msg('pc|qty'), msg('pcs|qty')], box: [msg('box|qty'), msg('boxes|qty')], dz: [msg('dozen|qty'), msg('dozens|qty')],
  pack: [msg('pack|qty'), msg('packs|qty')], h: [msg('h|qty'), msg('h|qty')],
}
export function unitCode(unit: string | null | undefined) {
  if (!unit) return null
  const k = unit.trim().toLowerCase()
  return UNIT_ALIAS[k] ?? unit.trim()
}
/** The unit as it is written after a quantity, in the current language */
export function unitLabel(unit: string | null | undefined, n = 2) {
  const c = unitCode(unit)
  if (!c) return ''
  const w = UNIT_WORDS[c]
  return w ? t(Math.abs(n) === 1 ? w[0] : w[1]) : c
}

/**
 * Quantities: up to 4 decimals, trailing zeros trimmed. With a unit the unit follows ("22 copë"); weights and
 * volumes under 1 kg or 1 l are shown in g or ml ("500 g"), and over it with three decimals ("1,250 kg").
 */
export function formatQty(value: number | string | null | undefined, unit?: string | null) {
  if (value === null || value === undefined || value === '') return '—'
  let n = typeof value === 'string' ? Number(value) : value
  let c = unitCode(unit)
  if ((c === 'kg' || c === 'l') && n !== 0 && Math.abs(n) < 1) { n = Math.round(n * 1000 * 10) / 10; c = c === 'kg' ? 'g' : 'ml' }
  const decimals = (c === 'kg' || c === 'l' || c === 'm') && !Number.isInteger(n) ? 3 : null
  const s = decimals ? nf('q3', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(n) : nf('q', { maximumFractionDigits: 4 }).format(n)
  return c ? `${s} ${unitLabel(c, n)}` : s
}

export function formatCompact(value: number | null | undefined) {
  if (value === null || value === undefined) return '—'
  return nf('c', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

export function formatDate(value: string | Date | null | undefined, withTime = false) {
  if (!value) return '—'
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return '—'
  return formatDateWith(d, withTime
    ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: 'short', year: 'numeric' })
}

export function todayISO() {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

/** a day as YYYY-MM-DD, some days from another (negative: earlier) */
export function addDaysISO(day: string, days: number) {
  const d = new Date(`${day}T12:00:00`)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** A database enum value as a label in the current language (falls back to readable English). */
export function humanize(value: string | null | undefined) {
  return tEnum(value)
}

/** Month name + year, e.g. "Tetor 2026" / "October 2026" */
export function formatMonth(value: string | Date | null | undefined) {
  if (!value) return '—'
  const d = typeof value === 'string' ? new Date(value.length === 7 ? `${value}-01` : value) : value
  return formatDateWith(d, { month: 'long', year: 'numeric' })
}

export function initials(name: string | null | undefined) {
  if (!name) return '?'
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('')
}

export function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

/** fields on a phone: 16 px text (iPhone zooms into smaller fields) and 40 px height, unless the field sets its own */
export function phoneField(className?: string) {
  const c = className ?? ''
  return cn(/(^|\s)text-(xs|sm|base|lg|xl|[2-9]xl|\[)/.test(c) ? '' : 'max-sm:text-base', /(^|\s)h-/.test(c) ? '' : 'max-sm:min-h-10')
}
