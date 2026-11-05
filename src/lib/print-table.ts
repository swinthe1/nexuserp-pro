import { formatDateWith, t } from '@/i18n'
import { formatMoney, formatQty } from '@/lib/utils'
import { printHtml } from '@/lib/print'

type Cell = string | number | null | undefined
export type PrintColumn = { header: string; format?: 'money' | 'qty' | 'int' | 'text' }

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
  const td = (v: Cell, i: number) => `<td class="${right[i] ? 'r' : ''}">${esc(fmt(v, columns[i]!.format ?? auto(v)))}</td>`
  const landscape = columns.length > 7
  const printed = t('Printed {date}', { date: formatDateWith(new Date(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) })
  const body = `<h1>${esc(title)}</h1><p class="sub">${subtitle ? `${esc(subtitle)} · ` : ''}${esc(printed)}</p>
<table><thead><tr>${columns.map((c, i) => `<th class="${right[i] ? 'r' : ''}">${esc(c.header)}</th>`).join('')}</tr></thead>
<tbody>${rows.map((r) => `<tr>${columns.map((_, i) => td(r[i], i)).join('')}</tr>`).join('')}</tbody>
${totals ? `<tfoot><tr>${columns.map((_, i) => td(totals[i], i)).join('')}</tr></tfoot>` : ''}</table>`
  const css = `@page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 12mm }
body { font: 9pt/1.3 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #111 }
h1 { font-size: 13pt; margin: 0 0 2pt } .sub { margin: 0 0 8pt; color: #555; font-size: 8.5pt }
table { width: 100%; border-collapse: collapse } thead { display: table-header-group } tr { page-break-inside: avoid }
th { text-align: left; font-weight: 600; border-bottom: 1pt solid #333; padding: 3pt 4pt; vertical-align: bottom; font-size: 8pt }
td { border-bottom: .5pt solid #ccc; padding: 2.5pt 4pt; vertical-align: top }
tfoot td { border-top: 1pt solid #333; border-bottom: 0; font-weight: 600 }
.r { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap }`
  printHtml(body, css, 'document')
}
