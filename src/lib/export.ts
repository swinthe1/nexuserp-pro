import { formatDateWith, t } from '@/i18n'
import { formatAmount, formatMoney, formatQty } from '@/lib/utils'
export interface ExportColumn<T> {
  header: string
  value: (row: T) => string | number | null | undefined
}

function escapeCsv(v: unknown) {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * What happens to every exported file besides the download: the app keeps a copy for the person
 * ("Eksportet e mia"). Set once by the app; a failure there never stops the download.
 */
type Recorder = (blob: Blob, filename: string, rows: number | null) => void
let recorder: Recorder | null = null
let pendingRows: number | null = null
export function setExportRecorder(fn: Recorder | null) { recorder = fn }

export function download(blob: Blob, filename: string) {
  try { recorder?.(blob, filename, pendingRows) } catch { /* the copy is a convenience */ }
  pendingRows = null
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * The name of an exported file, in the reader's language: what was exported (the title the person
 * sees: "Transferet", "Libri i shitjeve · Nëntor 2026") and when it is for (the period in the code
 * name, as 01.11.2026, otherwise today). The code names (sales-book-2026-11) only give the dates.
 */
const PERIOD = /(\d{4})-(\d{2})(?:-(\d{2}))?/g
export function exportFileName(name: string, title?: string | null) {
  const clean = (x: string) => x.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s*[·•]\s*/g, ' - ').replace(/\s+/g, ' ').replace(/[\s.-]+$/, '').trim()
  const dates = [...name.matchAll(PERIOD)].map((m) => (m[3] ? `${m[3]}.${m[2]}.${m[1]}` : `${m[2]}.${m[1]}`))
  const human = title?.trim() ? clean(title) : ''
  // without a title the name itself, made readable (a code name stays as it is, minus its dates)
  const base = human || clean(name.replace(PERIOD, ' ').replace(/[-_]+/g, ' ')) || t('Export')
  const d = new Date()
  const today = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
  // a title that already says the year (a month, a period) needs no date after it
  const when = /\b(19|20)\d{2}\b/.test(human) ? '' : dates.length ? dates.join(' - ') : today
  return `${base}${when ? ` ${when}` : ''}`.slice(0, 150)
}

/** A table (first row the headings) as a CSV file Excel opens with ë and ç intact. */
export function downloadCsv(name: string, rows: (string | number | null | undefined)[][]) {
  download(new Blob(['\ufeff' + rows.map((r) => r.map(escapeCsv).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }), `${name}.csv`)
}

export function exportCsv<T>(rows: T[], columns: ExportColumn<T>[], filename: string, title?: string) {
  pendingRows = rows.length
  downloadCsv(exportFileName(filename, title), [columns.map((c) => c.header), ...rows.map((r) => columns.map((c) => c.value(r)))])
}

export async function exportPdf<T>(rows: T[], columns: ExportColumn<T>[], filename: string, title: string, subtitle?: string,
  totals?: Record<string, number | string | null | undefined>) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const n = columns.length
  const doc = new jsPDF({ orientation: n > 6 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' })
  const margin = 24
  doc.setFontSize(13)
  doc.text(title, margin, 34)
  doc.setFontSize(8.5)
  doc.setTextColor(110)
  doc.text(subtitle ?? t('Exported {date} · {n} rows', { date: formatDateWith(new Date(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }), n: rows.length }), margin, 48)
  // numbers as people read them, lined up on the right; the font gets smaller as the columns grow, so a book fits the page
  const fmtOf = (c: ExportColumn<T>) => (c as { format?: string }).format
  const cell = (c: ExportColumn<T>, v: unknown) => {
    if (v === null || v === undefined || v === '') return ''
    const f = fmtOf(c)
    if (typeof v === 'number' && f === 'money') return formatMoney(v)
    if (typeof v === 'number' && f === 'qty') return formatQty(v)
    if (typeof v === 'number' && f === 'int') return formatQty(Math.round(v))
    if (typeof v === 'number' && !Number.isInteger(v)) return formatAmount(v)
    return String(v)
  }
  const numeric = columns.map((c, i) => ['money', 'qty', 'int'].includes(fmtOf(c) ?? '') || (fmtOf(c) !== 'text' && rows.length > 0 && rows.every((r) => { const v = columns[i]!.value(r); return v == null || v === '' || typeof v === 'number' })))
  const fontSize = n > 14 ? 6 : n > 10 ? 6.8 : n > 7 ? 7.5 : 8.5
  autoTable(doc, {
    startY: 58,
    margin: { left: margin, right: margin, top: 30, bottom: 26 },
    head: [columns.map((c) => c.header)],
    body: rows.map((r) => columns.map((c) => cell(c, c.value(r)))),
    foot: totals ? [columns.map((c) => cell(c, totals[c.header]))] : undefined,
    showFoot: 'lastPage',
    tableWidth: 'auto',
    styles: { fontSize, cellPadding: n > 10 ? 2 : 3, overflow: 'linebreak', valign: 'top' },
    headStyles: { fillColor: [43, 89, 195], fontSize: fontSize - 0.3, valign: 'bottom' },
    footStyles: { fillColor: [235, 238, 245], textColor: 20, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [246, 247, 250] },
    columnStyles: Object.fromEntries(numeric.flatMap((isNum, i) => (isNum ? [[i, { halign: 'right' as const }]] : []))),
    didParseCell: (d) => { if (numeric[d.column.index]) d.cell.styles.halign = 'right' },
    didDrawPage: () => {
      doc.setFontSize(7); doc.setTextColor(140)
      doc.text(`${doc.getCurrentPageInfo().pageNumber}`, doc.internal.pageSize.getWidth() - margin, doc.internal.pageSize.getHeight() - 12, { align: 'right' })
    },
  })
  pendingRows = rows.length
  download(doc.output('blob') as Blob, `${exportFileName(filename, title)}.pdf`)
}

// ---------------------------------------------------------------------------------------------
// Excel (.xlsx) without a spreadsheet library: one worksheet, inline strings, number formats
// ---------------------------------------------------------------------------------------------
export interface XlsxColumn<T> extends ExportColumn<T> {
  /** money / qty → #,##0.00; int → #,##0; text forces a text cell (tax numbers, codes) */
  format?: 'money' | 'qty' | 'int' | 'text' | 'date'
  width?: number
}
export interface XlsxOptions {
  sheet?: string
  /** lines written above the header (company, period, form name) */
  title?: string[]
  /** the file's name when the sheet carries no title row (a file for the bank) */
  fileTitle?: string
  /** a bold totals row under the data: column header → value */
  totals?: Record<string, number | string | null | undefined>
}

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const colName = (i: number) => { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26) } return s }

export async function exportXlsx<T>(rows: T[], columns: XlsxColumn<T>[], filename: string, opts: XlsxOptions = {}) {
  const count = rows.length
  const { zipSync, strToU8 } = await import('fflate')
  // styles: 0 normal · 1 bold · 2 #,##0.00 · 3 #,##0 · 4 bold #,##0.00 · 5 title · 6 date
  const styleFor = (c: XlsxColumn<T>, bold = false) => c.format === 'int' ? 3 : c.format === 'date' ? 6 : c.format === 'text' ? (bold ? 1 : 0) : bold ? 4 : 2
  const cell = (ref: string, v: unknown, c: XlsxColumn<T> | null, bold = false) => {
    if (v === null || v === undefined || v === '') return ''
    const num = typeof v === 'number' ? v : (c && c.format && c.format !== 'text' && c.format !== 'date' && /^-?\d+(\.\d+)?$/.test(String(v)) ? Number(v) : null)
    if (num !== null && Number.isFinite(num) && c?.format !== 'text') return `<c r="${ref}" s="${c ? styleFor(c, bold) : bold ? 4 : 2}"><v>${num}</v></c>`
    return `<c r="${ref}" t="inlineStr" s="${bold ? 1 : 0}"><is><t xml:space="preserve">${xmlEscape(String(v))}</t></is></c>`
  }
  const out: string[] = []
  let r = 0
  for (const line of opts.title ?? []) { r += 1; out.push(`<row r="${r}"><c r="A${r}" t="inlineStr" s="5"><is><t xml:space="preserve">${xmlEscape(line)}</t></is></c></row>`) }
  if (opts.title?.length) r += 1
  r += 1
  const headerRow = r
  out.push(`<row r="${r}">${columns.map((c, i) => `<c r="${colName(i)}${r}" t="inlineStr" s="1"><is><t xml:space="preserve">${xmlEscape(c.header)}</t></is></c>`).join('')}</row>`)
  for (const row of rows) {
    r += 1
    out.push(`<row r="${r}">${columns.map((c, i) => cell(`${colName(i)}${r}`, c.value(row), c)).join('')}</row>`)
  }
  if (opts.totals) {
    r += 1
    out.push(`<row r="${r}">${columns.map((c, i) => cell(`${colName(i)}${r}`, opts.totals?.[c.header], i === 0 ? null : c, true)).join('')}</row>`)
  }
  const widths = columns.map((c, i) => {
    const longest = Math.max(c.header.length, ...rows.slice(0, 200).map((row) => String(c.value(row) ?? '').length))
    return `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? Math.min(Math.max(longest + 2, 8), 48)}" customWidth="1"/>`
  }).join('')
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths}</cols><sheetData>${out.join('')}</sheetData></worksheet>`
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="dd.mm.yyyy"/></numFmts>
<fonts count="3"><font><sz val="10"/><name val="Calibri"/></font><font><b/><sz val="10"/><name val="Calibri"/></font><font><b/><sz val="12"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="7"><xf/><xf fontId="1" applyFont="1"/><xf numFmtId="164" applyNumberFormat="1"/><xf numFmtId="3" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" applyNumberFormat="1" applyFont="1"/><xf fontId="2" applyFont="1"/><xf numFmtId="165" applyNumberFormat="1"/></cellXfs></styleSheet>`
  const sheetName = xmlEscape((opts.sheet ?? 'Sheet1').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31))
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': strToU8(styles),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  }
  pendingRows = count
  download(new Blob([zipSync(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${exportFileName(filename, opts.fileTitle ?? opts.title?.[0] ?? opts.sheet)}.xlsx`)
}
