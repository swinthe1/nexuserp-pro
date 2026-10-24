import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { tEnum } from '@/i18n'
import { formatDateWith, formatNumberWith } from '@/i18n/format'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

function nf(_key: string, opts: Intl.NumberFormatOptions) {
  return { format: (n: number) => formatNumberWith(n, opts) }
}

/** Money in the current language's format with the currency code after it: "12 340,00 ALL" (sq), "12,340.00 ALL" (en) */
export function formatMoney(value: number | string | null | undefined, currency?: string, decimals = 2) {
  if (value === null || value === undefined || value === '') return '—'
  const n = typeof value === 'string' ? Number(value) : value
  const s = nf(`m${decimals}`, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n)
  return currency ? `${s} ${currency}` : s
}

/** Quantities: up to 4 decimals, trailing zeros trimmed */
export function formatQty(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return '—'
  const n = typeof value === 'string' ? Number(value) : value
  return nf('q', { maximumFractionDigits: 4 }).format(n)
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

/** A database enum value as a label in the current language (falls back to readable English). */
export function humanize(value: string | null | undefined) {
  return tEnum(value)
}

/** Month name + year, e.g. "tetor 2026" / "October 2026" */
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
