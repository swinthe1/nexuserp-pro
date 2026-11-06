import { formatDateWith, t } from '@/i18n'
import { formatMoney, formatQty } from '@/lib/utils'
import { printHtml } from '@/lib/print'

type Cell = string | number | null | undefined
export type PrintColumn = { header: string; format?: 'money' | 'qty' | 'int' | 'text'; /** short values that must not break (dates, numbers of documents) */ nowrap?: boolean }

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const fmt = (v: Cell, f?: PrintColumn['format']) => {
  if (v === null || v === undefined || v === '') return ''
  if (typeof v === 'number' && (f === 'money' || f === 'qty')) return formatMoney(v)
  if (typeof v === 'number' && f === 'int') return formatQty(Math.round(v))
  return String(v)
}

/**
 * A table straight to the printer (books, reports, lists): the heading, the date it was printed, the
 * rows and an optional total line. Wide tables print on a landscape page; the heading repeats on
 * every page.
 */
export function printTable({ title, subtitle, columns, rows, totals }: {
  title: string; subtitle?: string; columns: PrintColumn[]; rows: Cell[][]; totals?: Cell[] | null
}) {
  // a column whose every value is a number lines up on the right
  const right = columns.map((c, i) => c.format === 'money' || c.format === 'qty' || c.format === 'int'
    || (c.format !== 'text' && rows.length > 0 && rows.every((r) => r[i] === null || r[i] === undefined || r[i] === '' || typeof r[i] === 'number')))
  // a number with no format: whole numbers as they are, others with two decimals
  const auto = (v: Cell): PrintColumn['format'] => (typeof v === 'number' ? (Number.isInteger(v) ? 'int' : 'money') : undefined)
  const td = (v: Cell, i: number) => `<td class="${[right[i] ? 'r' : '', columns[i]!.nowrap ? 'nw' : ''].join(' ').trim()}">${esc(fmt(v, columns[i]!.format ?? auto(v)))}</td>`
  const landscape = columns.length > 7
  const n = columns.length
  // the printable area of the A4 page at 96 dpi, margins of 10 mm
  const [pageW, pageH] = landscape ? [1047, 718] : [718, 1047]
  const printed = t('Printed {date}', { date: formatDateWith(new Date(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) })
  const body = `<h1>${esc(title)}</h1><p class="sub">${subtitle ? `${esc(subtitle)} · ` : ''}${esc(printed)}</p>
<table><thead><tr>${columns.map((c, i) => `<th class="${right[i] || c.nowrap ? 'fit' : ''} ${right[i] ? 'r' : ''}">${esc(c.header)}</th>`).join('')}</tr></thead>
<tbody>${rows.map((r) => `<tr>${columns.map((_, i) => td(r[i], i)).join('')}</tr>`).join('')}</tbody>
${totals ? `<tfoot><tr>${columns.map((_, i) => td(totals[i], i)).join('')}</tr></tfoot>` : ''}</table>`
  const css = `@page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 10mm }
html, body { margin: 0 } body { width: ${pageW}px; font: ${n > 14 ? 7 : n > 10 ? 7.8 : 9}pt/1.25 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #111 }
.nw { white-space: nowrap } th.fit { width: 1% } th { white-space: normal }
h1 { font-size: 13pt; margin: 0 0 2pt } .sub { margin: 0 0 8pt; color: #555; font-size: 8.5pt }
table { width: 100%; border-collapse: collapse } thead { display: table-header-group } tr { page-break-inside: avoid }
th { text-align: left; font-weight: 600; border-bottom: 1pt solid #333; padding: 3pt 4pt; vertical-align: bottom; font-size: 8pt }
td { border-bottom: .5pt solid #ccc; padding: 2.5pt 4pt; vertical-align: top }
tfoot td { border-top: 1pt solid #333; border-bottom: 0; font-weight: 600 }
.r { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap }
th.r, th.fit { white-space: normal }`
  // one A4 page when the table nearly fits: the whole of it a little smaller, never below two thirds
  // one A4 page when the table nearly fits: the letters a little smaller (never below 6 pt), never squeezed
  // one A4 page when the table nearly fits: the letters a little smaller (never below 6 pt), never squeezed;
  // a table too long for one page keeps the largest letters with which it is as wide as the page
  const fit = `<script>(function(){var b=document.body,t=document.querySelector('table'),W=${pageW},H=${pageH},start=${n > 14 ? 7 : n > 10 ? 7.8 : 9},wide=null;
for(var f=start;f>=6;f-=0.4){b.style.fontSize=f+'pt';var w=t.offsetWidth<=W+1;if(w&&wide===null)wide=f;if(w&&b.offsetHeight<=H)return;}
b.style.fontSize=(wide===null?6:wide)+'pt';})()</script>`
  printHtml(body + fit, css, 'document')
}
