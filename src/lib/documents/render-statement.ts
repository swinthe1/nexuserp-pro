/**
 * Statements: a table with a heading — the partner's card, open items (IOS), a compensation, the item card.
 * Same look as the documents (company block, colour, footer), as HTML to print and as PDF.
 */
import { t } from '@/i18n'
import { formatDate } from '@/lib/utils'
import { docCss } from './render-html'
import { PRINT_DEFAULTS, type PrintDoc, type PrintParty } from './model'

export type StatementCol = { label: string; align?: 'right' | 'center'; width?: number }
export type Statement = {
  title: string; number?: string; subtitle?: string
  company: PrintDoc['company']; partner?: PrintParty | null; partnerLabel?: string
  info: [string, string][]
  /** several tables, each with a heading of its own (a compensation has two) */
  tables: { heading?: string; columns: StatementCol[]; rows: string[][]; strong?: number[] }[]
  summary: [string, string, boolean?][]
  texts?: string[]
  signatures?: [string, string] | null
  printed_by?: string | null; printed_at: string
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
export const nf = (n: number | string | null | undefined, d = 2) => n == null || n === '' ? '' : Number(n).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d })
export const qf = (n: number | string | null | undefined) => n == null || n === '' ? '' : Number(n).toLocaleString('de-DE', { maximumFractionDigits: 4 })
const settings = (st: Statement) => ({ ...PRINT_DEFAULTS, ...(st.company.settings ?? {}) })

export function renderStatementHtml(st: Statement): { body: string; css: string } {
  const s = settings(st)
  const c = st.company
  const ids = [c.tax_number && `${t('NIPT/NUI')} ${c.tax_number}`, c.vat_number && `${t('VAT no.')} ${c.vat_number}`].filter(Boolean).join(' · ')
  const top = `<div class="top${s.logo_position === 'right' ? ' rev' : ''}"><div class="co">${c.logo ? `<img src="${esc(c.logo)}" alt="">` : ''}<div><b>${esc(c.legal_name || c.name)}</b>
      ${ids ? `<div class="muted">${esc(ids)}</div>` : ''}${c.address ? `<div class="muted">${esc(c.address)}</div>` : ''}
      <div class="muted">${esc([c.phone, c.email].filter(Boolean).join(' · '))}</div></div></div>
    <div class="title"><h1>${esc(st.title)}</h1>${st.number ? `<div class="no">${esc(st.number)}</div>` : ''}${st.subtitle ? `<div class="muted">${esc(st.subtitle)}</div>` : ''}</div></div>`
  const p = st.partner
  const partner = p ? `<div class="box"><div class="lbl">${esc(st.partnerLabel ?? t('Partner'))}</div><b>${esc(p.legal_name || p.name)}</b>
      ${p.tax_number ? `<div>${esc(t('NIPT/NUI'))} ${esc(p.tax_number)}</div>` : ''}${p.address ? `<div>${esc(p.address)}</div>` : ''}
      <div class="muted">${esc([p.code, p.phone, p.email].filter(Boolean).join(' · '))}</div></div>` : '<div></div>'
  const info = `<div class="box"><div class="kv">${st.info.map(([k, v]) => `<span>${esc(k)}</span><span>${esc(v)}</span>`).join('')}</div></div>`
  const tables = st.tables.map((tb) => `${tb.heading ? `<h3 style="margin:14px 0 4px;font-size:12px">${esc(tb.heading)}</h3>` : ''}
    <table class="l"><thead><tr>${tb.columns.map((col) => `<th class="${col.align === 'right' ? 'r' : col.align === 'center' ? 'c' : ''}">${esc(col.label)}</th>`).join('')}</tr></thead>
    <tbody>${tb.rows.map((r, i) => `<tr${tb.strong?.includes(i) ? ' style="font-weight:600"' : ''}>${r.map((v, j) => `<td class="${tb.columns[j]?.align === 'right' ? 'r' : tb.columns[j]?.align === 'center' ? 'c' : ''}">${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`).join('')
  const sum = st.summary.length ? `<div class="bottom"><div></div><div class="tot">${st.summary.map(([k, v, strong]) => `<div${strong ? ' class="big"' : ''}><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}</div></div>` : ''
  const texts = (st.texts ?? []).filter(Boolean).map((x) => `<div class="notes">${esc(x)}</div>`).join('')
  const sign = st.signatures ? `<div class="sign"><div>${esc(st.signatures[0])}</div><div>${esc(st.signatures[1])}</div></div>` : ''
  const foot = `<div class="foot"><span>${esc(c.footer || '')}</span><span>${esc(t('Printed {date}', { date: formatDate(st.printed_at, true) }))}${st.printed_by ? ` · ${esc(st.printed_by)}` : ''}</span></div>`
  return { body: `${top}<div class="boxes">${partner}${info}</div>${tables}${sum}${texts}${sign}${foot}`, css: docCss(s.accent) } // i18n-ignore
}

const hex = (h: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim()); const v = m ? parseInt(m[1], 16) : 0x1f3a8a
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

export async function renderStatementPdf(st: Statement) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const s = settings(st)
  const A = hex(s.accent)
  const gray: [number, number, number] = [91, 97, 112]
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
  const W = 210, L = 12, R = W - 12
  let y = 14
  const right = s.logo_position === 'right'
  let cx = right ? R : L
  if (st.company.logo) {
    try {
      const img = new Image(); img.src = st.company.logo; await img.decode()
      const k = Math.min(1, 360 / Math.max(img.naturalWidth, img.naturalHeight))
      const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(img.naturalWidth * k)); cv.height = Math.max(1, Math.round(img.naturalHeight * k))
      const g = cv.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(img, 0, 0, cv.width, cv.height)
      const h = 18, w = Math.min(48, (cv.width / cv.height) * h)
      pdf.addImage(cv.toDataURL('image/jpeg', 0.92), 'JPEG', right ? R - w : L, y, w, h, undefined, 'FAST')
      cx = right ? R - w - 4 : L + w + 4
    } catch { /* no logo */ }
  }
  const align = right ? 'right' : 'left'
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12); pdf.setTextColor(26, 29, 36)
  pdf.text(st.company.legal_name || st.company.name, cx, y + 4, { align })
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(...gray)
  const coLines = [[st.company.tax_number && `${t('NIPT/NUI')} ${st.company.tax_number}`, st.company.vat_number && `${t('VAT no.')} ${st.company.vat_number}`].filter(Boolean).join(' · '),
    st.company.address ?? '', [st.company.phone, st.company.email].filter(Boolean).join(' · ')].filter(Boolean)
  coLines.forEach((line, i) => pdf.text(line, cx, y + 9 + i * 3.6, { align }))
  const tx = right ? L : R, ta = right ? 'left' : 'right'
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(16); pdf.setTextColor(...A); pdf.text(st.title, tx, y + 5, { align: ta })
  pdf.setFontSize(10); pdf.setTextColor(26, 29, 36); if (st.number) pdf.text(st.number, tx, y + 11, { align: ta })
  if (st.subtitle) { pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(...gray); pdf.text(st.subtitle, tx, y + (st.number ? 15.5 : 11), { align: ta }) }
  y = Math.max(y + 22, y + 9 + coLines.length * 3.6 + 2)
  pdf.setDrawColor(...A); pdf.setLineWidth(0.6); pdf.line(L, y, R, y); y += 5

  const boxW = (R - L - 5) / 2
  const p = st.partner
  const pLines = p ? [p.legal_name || p.name, p.tax_number ? `${t('NIPT/NUI')} ${p.tax_number}` : '', p.address ?? '', [p.code, p.phone, p.email].filter(Boolean).join(' · ')].filter(Boolean) : []
  const boxH = Math.max(p ? 6 + pLines.length * 4.2 : 0, 4 + st.info.length * 4.2) + 2
  pdf.setDrawColor(217, 220, 227); pdf.setLineWidth(0.25)
  if (p) {
    pdf.roundedRect(L, y, boxW, boxH, 1.5, 1.5)
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7); pdf.setTextColor(...A); pdf.text((st.partnerLabel ?? t('Partner')).toUpperCase(), L + 3, y + 4.5)
    pLines.forEach((line, i) => { pdf.setFont('helvetica', i === 0 ? 'bold' : 'normal'); pdf.setFontSize(i === 0 ? 10 : 8.5); pdf.setTextColor(26, 29, 36); pdf.text(pdf.splitTextToSize(line, boxW - 6)[0], L + 3, y + 9 + i * 4.2) })
  }
  pdf.roundedRect(L + boxW + 5, y, boxW, boxH, 1.5, 1.5)
  st.info.forEach(([k, v], i) => {
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(...gray); pdf.text(k, L + boxW + 8, y + 5 + i * 4.2)
    pdf.setTextColor(26, 29, 36); pdf.text(pdf.splitTextToSize(v, boxW - 44)[0], L + boxW + 44, y + 5 + i * 4.2)
  })
  y += boxH + 5

  for (const tb of st.tables) {
    if (tb.heading) { pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.setTextColor(26, 29, 36); pdf.text(tb.heading, L, y + 1); y += 3 }
    const columnStyles: Record<number, { halign: 'right' | 'center' }> = {}
    tb.columns.forEach((col, i) => { if (col.align) columnStyles[i] = { halign: col.align } })
    autoTable(pdf, {
      startY: y, margin: { left: L, right: W - R }, theme: 'striped', head: [tb.columns.map((c) => c.label)], body: tb.rows,
      styles: { fontSize: 8, cellPadding: 1.4, overflow: 'linebreak' }, headStyles: { fillColor: A, textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [247, 248, 250] }, columnStyles,
      didParseCell: (c) => {
        if (columnStyles[c.column.index]) c.cell.styles.halign = columnStyles[c.column.index].halign
        if (c.section === 'body' && tb.strong?.includes(c.row.index)) c.cell.styles.fontStyle = 'bold'
      },
    })
    y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6
  }
  if (y > 250) { pdf.addPage(); y = 16 }
  const totX = R - 75
  st.summary.forEach(([k, v, strong]) => {
    pdf.setFont('helvetica', strong ? 'bold' : 'normal'); pdf.setFontSize(strong ? 11 : 9); pdf.setTextColor(...(strong ? A : [26, 29, 36] as [number, number, number]))
    if (strong) { pdf.setDrawColor(...A); pdf.setLineWidth(0.4); pdf.line(Math.min(totX, R - pdf.getTextWidth(v) - pdf.getTextWidth(k) - 5), y - 3.4, R, y - 3.4) }
    // a long label moves left so it never runs into its amount
    const lx = Math.min(totX, R - pdf.getTextWidth(v) - pdf.getTextWidth(k) - 5)
    pdf.text(k, lx, y); pdf.text(v, R, y, { align: 'right' }); y += strong ? 6 : 4.6
  })
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(26, 29, 36)
  for (const n of (st.texts ?? []).filter(Boolean)) {
    const lines = pdf.splitTextToSize(n, R - L); if (y + lines.length * 4 > 270) { pdf.addPage(); y = 16 }
    pdf.text(lines, L, y + 2); y += lines.length * 4 + 3
  }
  if (st.signatures) {
    y += 14; if (y > 272) { pdf.addPage(); y = 30 }
    pdf.setDrawColor(138, 143, 156); pdf.setLineWidth(0.25); pdf.line(L, y, L + 70, y); pdf.line(R - 70, y, R, y)
    pdf.setFontSize(8.5); pdf.setTextColor(...gray); pdf.text(st.signatures[0], L + 35, y + 4, { align: 'center' }); pdf.text(st.signatures[1], R - 35, y + 4, { align: 'center' })
  }
  const pages = pdf.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i); pdf.setFontSize(7.5); pdf.setTextColor(107, 112, 128)
    if (st.company.footer) pdf.text(pdf.splitTextToSize(st.company.footer, 120)[0], L, 289)
    pdf.text(`${st.number ?? st.title} · ${t('page {n} of {total}', { n: i, total: pages })}`, R, 289, { align: 'right' })
  }
  return pdf
}

export const statementFile = (st: Statement) => `${st.title}${st.number ? ` ${st.number}` : ''}${st.partner ? ` ${st.partner.name}` : ''}`.replace(/[\\/:*?"<>|]+/g, '-') + '.pdf'
