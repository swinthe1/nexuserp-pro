import { formatDateWith, t } from '@/i18n'
export interface ExportColumn<T> {
  header: string
  value: (row: T) => string | number | null | undefined
}

function escapeCsv(v: unknown) {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function exportCsv<T>(rows: T[], columns: ExportColumn<T>[], filename: string) {
  const lines = [columns.map((c) => escapeCsv(c.header)).join(',')]
  for (const r of rows) lines.push(columns.map((c) => escapeCsv(c.value(r))).join(','))
  // BOM so Excel opens UTF-8 (ë, ç) correctly
  download(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `${filename}.csv`)
}

export async function exportPdf<T>(rows: T[], columns: ExportColumn<T>[], filename: string, title: string, subtitle?: string) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ orientation: columns.length > 6 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' })
  doc.setFontSize(14)
  doc.text(title, 40, 40)
  doc.setFontSize(9)
  doc.setTextColor(110)
  doc.text(subtitle ?? t('Exported {date} · {n} rows', { date: formatDateWith(new Date(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }), n: rows.length }), 40, 56)
  autoTable(doc, {
    startY: 70,
    head: [columns.map((c) => c.header)],
    body: rows.map((r) => columns.map((c) => {
      const v = c.value(r)
      return v === null || v === undefined ? '' : String(v)
    })),
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [43, 89, 195] },
    alternateRowStyles: { fillColor: [246, 247, 250] },
  })
  doc.save(`${filename}.pdf`)
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
  /** a bold totals row under the data: column header → value */
  totals?: Record<string, number | string | null | undefined>
}

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const colName = (i: number) => { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26) } return s }

export async function exportXlsx<T>(rows: T[], columns: XlsxColumn<T>[], filename: string, opts: XlsxOptions = {}) {
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
  download(new Blob([zipSync(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${filename}.xlsx`)
}
