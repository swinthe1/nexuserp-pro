/**
 * Dates and numbers in the current language without depending on the browser's locale data
 * (some browsers and kiosk/embedded builds ship without Albanian, and would show "Oct 24, 2026").
 * Albanian: "24 Tet 2026" (the months always with a capital letter: the owner's rule), "e shtunë", "1 234 567,50".
 */
import { getLocale } from './index'

const MONTH_LONG = ['Janar', 'Shkurt', 'Mars', 'Prill', 'Maj', 'Qershor', 'Korrik', 'Gusht', 'Shtator', 'Tetor', 'Nëntor', 'Dhjetor']
const MONTH_SHORT = ['Jan', 'Shk', 'Mar', 'Pri', 'Maj', 'Qer', 'Korr', 'Gush', 'Sht', 'Tet', 'Nën', 'Dhj']
const WEEKDAY_LONG = ['e diel', 'e hënë', 'e martë', 'e mërkurë', 'e enjte', 'e premte', 'e shtunë']
const WEEKDAY_SHORT = ['Die', 'Hën', 'Mar', 'Mër', 'Enj', 'Pre', 'Sht']
// Serbian, Latin script (ekavian, as in Kosovo): "3. novembar 2026", "03.11.2026", "1.234.567,50"
const SR = {
  monthLong: ['januar', 'februar', 'mart', 'april', 'maj', 'jun', 'jul', 'avgust', 'septembar', 'oktobar', 'novembar', 'decembar'],
  monthShort: ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'avg', 'sep', 'okt', 'nov', 'dec'],
  weekdayLong: ['nedelja', 'ponedeljak', 'utorak', 'sreda', 'četvrtak', 'petak', 'subota'],
  weekdayShort: ['Ned', 'Pon', 'Uto', 'Sre', 'Čet', 'Pet', 'Sub'],
}

const dtCache = new Map<string, Intl.DateTimeFormat>()
const nfCache = new Map<string, Intl.NumberFormat>()

/** Like Date#toLocaleString(locale, opts), for the current language. */
export function formatDateWith(d: Date, opts: Intl.DateTimeFormatOptions): string {
  const l = getLocale()
  const key = `${l === 'en' ? 'en' : 'x'}:${JSON.stringify(opts)}`
  let f = dtCache.get(key)
  if (!f) {
    // en-GB has the Albanian and Serbian order (day month year, 24-hour clock); month and weekday names are swapped below
    f = new Intl.DateTimeFormat('en-GB', { hourCycle: 'h23', ...opts })
    dtCache.set(key, f)
  }
  if (l === 'en') return f.format(d)
  const named = opts.month === 'short' || opts.month === 'long' || opts.month === 'narrow'
  const parts = f.formatToParts(d)
  return parts.map((p, i) => {
    if (p.type === 'dayPeriod') return ''
    if (p.type === 'month' && named) {
      const m = d.getMonth()
      if (l === 'sr') return opts.month === 'long' ? SR.monthLong[m] : SR.monthShort[m]
      return opts.month === 'long' ? MONTH_LONG[m] : MONTH_SHORT[m]
    }
    if (p.type === 'weekday') {
      const w = d.getDay()
      const long = l === 'sr' ? SR.weekdayLong : WEEKDAY_LONG
      const short = l === 'sr' ? SR.weekdayShort : WEEKDAY_SHORT
      return opts.weekday === 'long' ? long[w] : opts.weekday === 'narrow' ? short[w]!.charAt(0) : short[w]
    }
    // newer browsers write "3 Nov 2026 at 22:58" in en-GB: the English word goes
    if (p.type === 'literal' && /^\s*at\s*$/.test(p.value)) return ', '
    if (l === 'sr' && p.type === 'literal') {
      // 03/11/2026 → 03.11.2026; "3 November" → "3. novembar"
      if (p.value === '/') return '.'
      if (named && parts[i - 1]?.type === 'day' && parts[i + 1]?.type === 'month') return '. '
    }
    return p.value
  }).join('')
}

/** Like Intl.NumberFormat(locale, opts).format(n), for the current language. */
export function formatNumberWith(n: number, opts: Intl.NumberFormatOptions = {}): string {
  const l = getLocale()
  if (l !== 'en' && opts.notation === 'compact') return compactSq(n, opts.maximumFractionDigits ?? 1, l === 'sr')
  const key = JSON.stringify(opts)
  let f = nfCache.get(key)
  if (!f) { f = new Intl.NumberFormat('en-US', opts); nfCache.set(key, f) }
  const s = f.format(n)
  if (l === 'en') return s
  // Albanian 1,234,567.50 → 1 234 567,50 (non-breaking spaces keep amounts on one line); Serbian → 1.234.567,50
  return s.replace(/[,.]/g, (c) => (c === ',' ? (l === 'sr' ? '.' : ' ') : ','))
}

function compactSq(n: number, digits: number, serbian = false) {
  const abs = Math.abs(n)
  const [div, unit] = abs >= 1e9 ? [1e9, serbian ? ' mlrd.' : ' mld'] : abs >= 1e6 ? [1e6, serbian ? ' mil.' : ' mln'] : abs >= 1e3 ? [1e3, serbian ? ' hilj.' : ' mijë'] : [1, '']
  return formatNumberWith(n / div, { maximumFractionDigits: div === 1 ? digits : digits }) + unit
}
