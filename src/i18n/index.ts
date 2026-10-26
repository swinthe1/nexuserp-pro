/**
 * Translations. English source text is the key; Albanian (sq) is the default language.
 *
 *   t('Save')                                  → "Ruaj"
 *   t('{n} items selected', { n: 3 })          → "3 artikuj të zgjedhur"
 *   t('Open|status')                           → a key with a context; English shows "Open"
 *   tn(n, '{n} person', '{n} people')          → plural (Albanian: 1 → singular, else plural)
 *   td(account.name)                           → data that may be a system default ("Main warehouse"); unknown values pass through
 *   tServer(error.message)                     → messages written by the database (errors, notifications, report labels)
 *   msg('Sales')                               → marks a key in module-level constants; call t() on it when rendering
 *   tr('By saving you accept {terms}', { terms: <a>…</a> }) → React nodes
 *
 * Changing the language re-mounts the app under the providers (see LanguageProvider), so plain t() calls
 * anywhere in render code — including column definitions built in components — pick up the new language.
 */
import * as React from 'react'
import { sq } from './sq'
import { formatNumberWith } from './format'
import { serverPatterns } from './sq/server-patterns'

export type Locale = 'sq' | 'en'
export const LOCALES: { key: Locale; label: string; short: string }[] = [
  { key: 'sq', label: 'Shqip', short: 'SQ' },
  { key: 'en', label: 'English', short: 'EN' },
]
const STORAGE_KEY = 'drispro.lang'

function initialLocale(): Locale {
  try {
    const s = localStorage.getItem(STORAGE_KEY)
    if (s === 'sq' || s === 'en') return s
  } catch { /* storage unavailable */ }
  return 'sq'
}

let current: Locale = initialLocale()
const listeners = new Set<() => void>()

export function getLocale(): Locale { return current }
/** BCP 47 tag for the current language. Prefer formatDate/formatMoney/formatDateWith/formatNumberWith: some browsers lack Albanian locale data. */
export function intlLocale(): string { return current === 'sq' ? 'sq-AL' : 'en-GB' }
export { formatDateWith, formatNumberWith } from './format'

export function setLocale(l: Locale) {
  if (l === current) return
  current = l
  try { localStorage.setItem(STORAGE_KEY, l) } catch { /* ignore */ }
  if (typeof document !== 'undefined') document.documentElement.lang = l
  listeners.forEach((fn) => fn())
}

export function subscribeLocale(fn: () => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function useLocale(): Locale {
  return React.useSyncExternalStore(subscribeLocale, getLocale, getLocale)
}

type Params = Record<string, string | number | null | undefined>

function stripContext(key: string) {
  const i = key.lastIndexOf('|')
  return i > 0 ? key.slice(0, i) : key
}

function interpolate(s: string, params?: Params) {
  if (!params) return s
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (params[k] === undefined || params[k] === null ? m : String(params[k])))
}

/** Translate UI text. The key is the English text (optionally "Text|context"). */
export function t(key: string, params?: Params): string {
  const s = current === 'sq' ? (sq[key] ?? stripContext(key)) : stripContext(key)
  return interpolate(s, params)
}

/** Marks text in a module-level constant as a translation key; translate it with t() at render time. */
export function msg<T extends string>(key: T): T { return key }

/** Plural: Albanian and English both use one form for 1 and another for everything else. */
export function tn(n: number, one: string, other: string, params?: Params): string {
  return t(Math.abs(n) === 1 ? one : other, { n: formatInt(n), ...params })
}

function formatInt(n: number) {
  return formatNumberWith(n, { maximumFractionDigits: 4 })
}

/** Data values that may be system defaults (role names, default accounts, units…): translated when known, otherwise unchanged. */
export function td(value: string | null | undefined): string {
  if (value === null || value === undefined) return ''
  if (current === 'en') return value
  return sq[value] ?? sq[`data:${value}`] ?? matchPattern(value) ?? value
}

/** Enum values from the database (bank_transfer, in_transit…): translated label, or a readable English fallback. */
export function tEnum(value: string | null | undefined): string {
  if (!value) return ''
  const key = `enum:${value}`
  if (current === 'sq' && sq[key]) return sq[key]
  const human = value.replace(/_/g, ' ')
  const en = human.charAt(0).toUpperCase() + human.slice(1)
  return current === 'sq' ? (sq[en] ?? en) : en
}

/** Messages written by the database: exact matches first, then templates with placeholders. */
export function tServer(message: string | null | undefined): string {
  if (!message) return ''
  if (current === 'en') return message
  const m = message.replace(/^ERROR:\s*/, '').trim()
  if (sq[m]) return sq[m]
  // a line of parts ("Receipts: 74 · Cash: 620,71 €"): each part on its own, when each one is known
  const parts = m.includes(' · ') ? m.split(' · ').map((x) => sq[x] ?? matchPattern(x)) : null
  if (parts && parts.every(Boolean)) return parts.join(' · ')
  return matchPattern(m) ?? m
}

// pattern results are cached: lists call td()/tServer() for every row
const patternCache = new Map<string, string | null>()
function matchPattern(m: string): string | undefined {
  if (patternCache.has(m)) return patternCache.get(m) ?? undefined
  let out: string | null = null
  for (const p of serverPatterns) {
    const r = p.re.exec(m)
    if (r) {
      out = p.sq.replace(/\{(\d+)\}/g, (_, i: string, offset: number) => translateArg(r[Number(i) + 1] ?? '', offset > 0 && !/[.!?:]\s*$/.test(p.sq.slice(0, offset))))
      break
    }
  }
  if (patternCache.size > 5000) patternCache.clear()
  patternCache.set(m, out)
  return out ?? undefined
}

function translateArg(a: string, midSentence: boolean) {
  // values are often status words or names of system defaults; a status inside a sentence is lower case ("është anuluar")
  const e = sq[`enum:${a}`]
  if (e) return midSentence ? e.charAt(0).toLowerCase() + e.slice(1) : e
  return sq[a] ?? a
}

/** Text with React elements in placeholders. */
export function tr(key: string, parts: Record<string, React.ReactNode>): React.ReactNode {
  const s = t(key)
  const out: React.ReactNode[] = []
  let last = 0
  s.replace(/\{(\w+)\}/g, (m, k: string, idx: number) => {
    out.push(s.slice(last, idx))
    out.push(k in parts ? React.createElement(React.Fragment, { key: `${k}${idx}` }, parts[k]) : m)
    last = idx + m.length
    return m
  })
  out.push(s.slice(last))
  return out
}

if (typeof document !== 'undefined') document.documentElement.lang = current
