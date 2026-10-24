/**
 * Dates and numbers in the current language without depending on the browser's locale data
 * (some browsers and kiosk/embedded builds ship without Albanian, and would show "Oct 24, 2026").
 * Albanian: "24 tet 2026", "e shtunë", "1 234 567,50".
 */
import { getLocale } from './index'

const MONTH_LONG = ['janar', 'shkurt', 'mars', 'prill', 'maj', 'qershor', 'korrik', 'gusht', 'shtator', 'tetor', 'nëntor', 'dhjetor']
const MONTH_SHORT = ['jan', 'shk', 'mar', 'pri', 'maj', 'qer', 'korr', 'gush', 'sht', 'tet', 'nën', 'dhj']
const WEEKDAY_LONG = ['e diel', 'e hënë', 'e martë', 'e mërkurë', 'e enjte', 'e premte', 'e shtunë']
const WEEKDAY_SHORT = ['Die', 'Hën', 'Mar', 'Mër', 'Enj', 'Pre', 'Sht']

const dtCache = new Map<string, Intl.DateTimeFormat>()
const nfCache = new Map<string, Intl.NumberFormat>()

/** Like Date#toLocaleString(locale, opts), for the current language. */
export function formatDateWith(d: Date, opts: Intl.DateTimeFormatOptions): string {
  const sq = getLocale() === 'sq'
  const key = `${sq ? 'sq' : 'en'}:${JSON.stringify(opts)}`
  let f = dtCache.get(key)
  if (!f) {
    // en-GB has the Albanian order (day month year, 24-hour clock); month and weekday names are swapped below
    f = new Intl.DateTimeFormat('en-GB', { hourCycle: 'h23', ...opts })
    dtCache.set(key, f)
  }
  if (!sq) return f.format(d)
  return f.formatToParts(d).map((p) => {
    if (p.type === 'dayPeriod') return ''
    if (p.type === 'month' && (opts.month === 'short' || opts.month === 'long' || opts.month === 'narrow')) {
      const m = d.getMonth()
      return opts.month === 'long' ? MONTH_LONG[m] : MONTH_SHORT[m]
    }
    if (p.type === 'weekday') return opts.weekday === 'long' ? WEEKDAY_LONG[d.getDay()] : opts.weekday === 'narrow' ? WEEKDAY_SHORT[d.getDay()]!.charAt(0) : WEEKDAY_SHORT[d.getDay()]
    return p.value
  }).join('')
}

/** Like Intl.NumberFormat(locale, opts).format(n), for the current language. */
export function formatNumberWith(n: number, opts: Intl.NumberFormatOptions = {}): string {
  const sq = getLocale() === 'sq'
  if (sq && opts.notation === 'compact') return compactSq(n, opts.maximumFractionDigits ?? 1)
  const key = JSON.stringify(opts)
  let f = nfCache.get(key)
  if (!f) { f = new Intl.NumberFormat('en-US', opts); nfCache.set(key, f) }
  const s = f.format(n)
  // 1,234,567.50 → 1 234 567,50 (non-breaking spaces keep amounts on one line)
  return sq ? s.replace(/[,.]/g, (c) => (c === ',' ? ' ' : ',')) : s
}

function compactSq(n: number, digits: number) {
  const abs = Math.abs(n)
  const [div, unit] = abs >= 1e9 ? [1e9, ' mld'] : abs >= 1e6 ? [1e6, ' mln'] : abs >= 1e3 ? [1e3, ' mijë'] : [1, '']
  return formatNumberWith(n / div, { maximumFractionDigits: div === 1 ? digits : digits }) + unit
}
