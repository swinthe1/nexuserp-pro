import type { ColumnDef } from '@tanstack/react-table'
import { normalize } from '@/lib/fuzzy'

/**
 * Filters on any column of a list, and colours by what a column holds. A column is text, a number or a
 * date (seen from its values); each kind has its own ways to compare. The same comparisons colour a
 * cell or a whole row ("Borxhi > 1000 in red").
 */
export type Kind = 'text' | 'number' | 'date'
export type Op =
  | 'contains' | 'not_contains' | 'equals' | 'not_equals' | 'starts' | 'ends' | 'in' | 'empty' | 'not_empty'
  | 'eq' | 'ne' | 'gt' | 'ge' | 'lt' | 'le' | 'between'
  | 'today' | 'yesterday' | 'this_week' | 'this_month' | 'last_month' | 'this_year' | 'last_days' | 'on' | 'before' | 'after' | 'range'
export interface Rule { col: string; op: Op; value?: string; value2?: string; values?: string[] }

export const OPS: Record<Kind, Op[]> = {
  // picking from the list of what the column holds comes first; typing a piece of text second
  text: ['in', 'contains', 'not_contains', 'empty', 'not_empty'],
  number: ['eq', 'ne', 'gt', 'ge', 'lt', 'le', 'between', 'empty', 'not_empty'],
  date: ['today', 'yesterday', 'this_week', 'this_month', 'last_month', 'this_year', 'last_days', 'on', 'before', 'after', 'range', 'empty', 'not_empty'],
}
/** the comparisons that need no value typed */
export const NO_VALUE: Op[] = ['empty', 'not_empty', 'today', 'yesterday', 'this_week', 'this_month', 'last_month', 'this_year']
export const TWO_VALUES: Op[] = ['between', 'range']

export interface Getter { id: string; label: string; raw: (row: unknown) => unknown; text: (row: unknown) => string
  /** a cell holding several values ('Pije - Alkolike, Bulmet'): each one on its own in the list to pick from */
  parts?: (row: unknown) => string[] }

type AnyCol = ColumnDef<unknown, unknown> & { accessorKey?: string; accessorFn?: (r: unknown, i: number) => unknown; columns?: AnyCol[] }
const dig = (row: unknown, key: string) => key.split('.').reduce<unknown>((o, k) => (o == null ? o : (o as Record<string, unknown>)[k]), row)

/** how to read each column of a list from a row: its value, and the text a person sees */
export function gettersOf(columns: ColumnDef<never, unknown>[], labelOf: (id: string) => string): Getter[] {
  const out: Getter[] = []
  const walk = (cs: AnyCol[]) => cs.forEach((c) => {
    if (c.columns?.length) return walk(c.columns)
    const id = c.id ?? c.accessorKey
    if (!id || id === '_select' || c.meta?.noExport) return
    const raw = c.accessorFn ? (r: unknown) => c.accessorFn!(r, 0) : c.accessorKey ? (r: unknown) => dig(r, c.accessorKey!) : null
    if (!raw) return
    const shown = c.meta?.exportValue as ((r: unknown) => unknown) | undefined
    const text = (r: unknown) => { const v = shown ? shown(r) : raw(r); return v == null ? '' : typeof v === 'object' ? '' : String(v) }
    const sep = c.meta?.listSep
    out.push({ id, label: labelOf(id) || id, raw, text, parts: sep ? (r) => text(r).split(sep).map((x) => x.trim()).filter(Boolean) : undefined })
  })
  walk(columns as unknown as AnyCol[])
  return out
}

const ISO = /^\d{4}-\d{2}-\d{2}/
const asNum = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v)
  return null
}
const asDate = (v: unknown): string | null => (typeof v === 'string' && ISO.test(v) ? v.slice(0, 10) : null)

/** what a column holds, from its first values */
export function kindOf(g: Getter, rows: readonly unknown[]): Kind {
  let n = 0, num = 0, date = 0
  for (const r of rows) {
    const v = g.raw(r)
    if (v == null || v === '') continue
    n++
    if (asDate(v)) date++
    else if (asNum(v) != null) num++
    if (n >= 60) break
  }
  if (!n) return 'text'
  if (date >= n * 0.8) return 'date'
  if (num >= n * 0.8) return 'number'
  return 'text'
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
function dateSpan(op: Op, value?: string, value2?: string): [string, string] | null {
  const now = new Date(), y = now.getFullYear(), m = now.getMonth()
  switch (op) {
    case 'today': return [iso(now), iso(now)]
    case 'yesterday': { const d = new Date(now); d.setDate(d.getDate() - 1); return [iso(d), iso(d)] }
    case 'this_week': { const d = new Date(now); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return [iso(d), iso(now)] }
    case 'this_month': return [iso(new Date(y, m, 1)), iso(new Date(y, m + 1, 0))]
    case 'last_month': return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))]
    case 'this_year': return [`${y}-01-01`, `${y}-12-31`]
    case 'last_days': { const n = Number(value) || 7; const d = new Date(now); d.setDate(d.getDate() - n + 1); return [iso(d), iso(now)] }
    case 'on': return value ? [value, value] : null
    case 'before': return value ? ['0000-01-01', iso(new Date(new Date(value).getTime() - 86_400_000))] : null
    case 'after': return value ? [iso(new Date(new Date(value).getTime() + 86_400_000)), '9999-12-31'] : null
    case 'range': return value || value2 ? [value || '0000-01-01', value2 || '9999-12-31'] : null
    default: return null
  }
}
/** a number typed the way people type it: 1.234,5 or 1234.5 */
export const typedNum = (s?: string) => {
  if (s == null || s.trim() === '') return null
  let x = s.replace(/\s/g, '')
  if (x.includes(',') && x.includes('.')) x = x.lastIndexOf(',') > x.lastIndexOf('.') ? x.replace(/\./g, '').replace(',', '.') : x.replace(/,/g, '')
  else x = x.replace(',', '.')
  const v = Number(x)
  return Number.isFinite(v) ? v : null
}

/** does a row pass the rule; a rule not filled in yet lets everything through */
export function test(rule: Rule, g: Getter, kind: Kind, row: unknown): boolean {
  const raw = g.raw(row)
  const empty = raw == null || raw === '' || (Array.isArray(raw) && !raw.length)
  if (rule.op === 'empty') return empty
  if (rule.op === 'not_empty') return !empty
  if (kind === 'number') {
    const v = asNum(raw), a = typedNum(rule.value), b = typedNum(rule.value2)
    if (a == null && !(rule.op === 'between' && b != null)) return true
    if (v == null) return false
    switch (rule.op) {
      case 'eq': return Math.abs(v - a!) < 1e-9
      case 'ne': return Math.abs(v - a!) >= 1e-9
      case 'gt': return v > a!
      case 'ge': return v >= a!
      case 'lt': return v < a!
      case 'le': return v <= a!
      case 'between': return (a == null || v >= a) && (b == null || v <= b)
      default: return true
    }
  }
  if (kind === 'date') {
    const span = dateSpan(rule.op, rule.value, rule.value2)
    if (!span) return true
    const d = asDate(raw)
    return !!d && d >= span[0] && d <= span[1]
  }
  const text = normalize(g.text(row)), want = normalize(rule.value)
  if (rule.op === 'in') {
    if (!rule.values?.length) return true
    if (g.parts) { const have = g.parts(row); return have.length ? rule.values.some((v) => have.includes(v)) : rule.values.includes('') }
    return rule.values.includes(g.text(row))
  }
  if (!want) return true
  switch (rule.op) {
    case 'contains': return text.includes(want)
    case 'not_contains': return !text.includes(want)
    case 'equals': return text === want
    case 'not_equals': return text !== want
    case 'starts': return text.startsWith(want)
    case 'ends': return text.endsWith(want)
    default: return true
  }
}

/** a rule a person has finished writing (one still empty is not shown as a filter) */
export const ruleIsSet = (r: Rule) => NO_VALUE.includes(r.op) || (r.op === 'in' ? !!r.values?.length : !!(r.value?.trim() || r.value2?.trim()))

// ------------------------------------------------------------------ colours
/** the colours a column or a rule can take: readable in the light and the dark theme */
export const COLOURS = {
  red: { cell: 'bg-red-500/10 text-red-800 dark:text-red-300', dot: 'bg-red-500' },
  orange: { cell: 'bg-orange-500/10 text-orange-800 dark:text-orange-300', dot: 'bg-orange-500' },
  yellow: { cell: 'bg-yellow-400/20 text-yellow-900 dark:text-yellow-200', dot: 'bg-yellow-400' },
  green: { cell: 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300', dot: 'bg-emerald-500' },
  teal: { cell: 'bg-teal-500/10 text-teal-800 dark:text-teal-300', dot: 'bg-teal-500' },
  blue: { cell: 'bg-blue-500/10 text-blue-800 dark:text-blue-300', dot: 'bg-blue-500' },
  violet: { cell: 'bg-violet-500/10 text-violet-800 dark:text-violet-300', dot: 'bg-violet-500' },
  grey: { cell: 'bg-muted text-muted-foreground', dot: 'bg-slate-400' },
} as const
export type Colour = keyof typeof COLOURS
/** a column's colour, and its colours by what it holds (the first that fits wins; "row" colours the whole row) */
export interface ColumnStyle { colour?: Colour; bold?: boolean; when?: (Rule & { colour: Colour; row?: boolean })[] }
