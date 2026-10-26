/** The same document as a PDF (A4), for downloading and for email attachments. */
import { getLocale, t, td } from '@/i18n'
import { formatDate } from '@/lib/utils'
import { METHOD, amountInWords, docTitle, isVoucher, partnerLabel, type PrintDoc, settingsOf, showPrices, textKey } from './model'

const nf = (n: number | null | undefined, d = 2) => n == null ? '' : Number(n).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d })
const qf = (n: number | null | undefined) => n == null ? '' : Number(n).toLocaleString('de-DE', { maximumFractionDigits: 4 })
const pf = (n: number | null | undefined) => n == null || Number(n) === 0 ? '' : `${Number(n).toLocaleString('de-DE', { maximumFractionDigits: 2 })}%`
const hex = (h: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim()); const v = m ? parseInt(m[1], 16) : 0x1f3a8a
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

/** a logo in any format becomes a PNG jsPDF can take, with its size */
async function logoPng(src: string): Promise<{ data: string; w: number; h: number } | null> {
  try {
    const img = new Image()
    img.src = src
    await img.decode()
    const c = document.createElement('canvas')
    const scale = Math.min(1, 360 / Math.max(img.naturalWidth, img.naturalHeight))
    c.width = Math.max(1, Math.round(img.naturalWidth * scale)); c.height = Math.max(1, Math.round(img.naturalHeight * scale))
    const g = c.getContext('2d')!
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height)   // JPEG keeps the PDF small; transparent parts become white
    g.drawImage(img, 0, 0, c.width, c.height)
    return { data: c.toDataURL('image/jpeg', 0.92), w: c.width, h: c.height }
  } catch { return null }
}

export async function renderDocPdf(d: PrintDoc) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const s = settingsOf(d)
  const A = hex(s.accent)
  const dec = d.company.decimals ?? 2
  const prices = showPrices(d)
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
  const W = 210, L = 12, R = W - 12
  const gray: [number, number, number] = [91, 97, 112]
  let y = 14

  // ---- header: logo + company, title + number
  const right = s.logo_position === 'right'
  const logo = d.company.logo ? await logoPng(d.company.logo) : null
  let cx = right ? R : L
  if (logo) {
    const h = 18, w = Math.min(48, (logo.w / logo.h) * h)
    pdf.addImage(logo.data, 'JPEG', right ? R - w : L, y, w, h, undefined, 'FAST')
    cx = right ? R - w - 4 : L + w + 4
  }
  const align = right ? 'right' : 'left'
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12); pdf.setTextColor(26, 29, 36)
  pdf.text(d.company.legal_name || d.company.name, cx, y + 4, { align })
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(...gray)
  const coLines = [
    [d.company.tax_number && `${t('NIPT/NUI')} ${d.company.tax_number}`, d.company.vat_number && `${t('VAT no.')} ${d.company.vat_number}`].filter(Boolean).join(' · '),
    d.company.address ?? '', [d.company.phone, d.company.email, d.company.website].filter(Boolean).join(' · '),
  ].filter(Boolean)
  coLines.forEach((line, i) => pdf.text(line, cx, y + 9 + i * 3.6, { align }))
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(17); pdf.setTextColor(...A)
  pdf.text(docTitle(d), right ? L : R, y + 5, { align: right ? 'left' : 'right' })
  pdf.setFontSize(11); pdf.setTextColor(26, 29, 36)
  pdf.text(d.number, right ? L : R, y + 11, { align: right ? 'left' : 'right' })
  y = Math.max(y + 22, y + 9 + coLines.length * 3.6 + 2)
  pdf.setDrawColor(...A); pdf.setLineWidth(0.6); pdf.line(L, y, R, y)
  y += 5

  // ---- partner and details boxes
  const boxW = (R - L - 5) / 2
  const p = d.partner
  const pLines = p ? [p.legal_name || p.name, p.tax_number ? `${t('NIPT/NUI')} ${p.tax_number}${p.vat_number ? ` · ${t('VAT no.')} ${p.vat_number}` : ''}` : '',
    p.address ?? '', [p.code, p.phone, p.email].filter(Boolean).join(' · '), d.deliver_to ? `${t('Deliver to')}: ${d.deliver_to}` : ''].filter(Boolean) : []
  const det: [string, string][] = ([
    [t('Date'), formatDate(d.date)], [t('Due date'), d.due_date ? formatDate(d.due_date) : ''], [t('Valid until'), d.valid_until ? formatDate(d.valid_until) : ''],
    [t('Wanted by'), d.requested_date ? formatDate(d.requested_date) : ''], [t('Expected on'), d.expected_date ? formatDate(d.expected_date) : ''],
    [t('Payment terms'), d.payment_term ?? ''], [t('Order'), d.order ?? ''], [t('Corrects invoice'), d.original ?? ''], [t('Your reference'), d.reference ?? ''],
    [t('Warehouse'), d.warehouse ?? ''], [t('Salesperson'), d.salesperson ?? ''], [t('Buyer'), d.buyer ?? ''],
    [t('Carrier'), [d.carrier, d.tracking].filter(Boolean).join(' · ')], [t('Currency'), d.currency !== d.company.base_currency ? d.currency : ''],
  ] as [string, string][]).filter(([, v]) => v)
  const boxH = Math.max(6 + pLines.length * 4.2, 4 + det.length * 4.2) + 2
  pdf.setDrawColor(217, 220, 227); pdf.setLineWidth(0.25)
  pdf.roundedRect(L, y, boxW, boxH, 1.5, 1.5); pdf.roundedRect(L + boxW + 5, y, boxW, boxH, 1.5, 1.5)
  if (p) {
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7); pdf.setTextColor(...A); pdf.text(partnerLabel(d).toUpperCase(), L + 3, y + 4.5)
    pLines.forEach((line, i) => {
      pdf.setFont('helvetica', i === 0 ? 'bold' : 'normal'); pdf.setFontSize(i === 0 ? 10 : 8.5); pdf.setTextColor(26, 29, 36)
      pdf.text(pdf.splitTextToSize(line, boxW - 6)[0], L + 3, y + 9 + i * 4.2)
    })
  }
  det.forEach(([k, v], i) => {
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(...gray); pdf.text(k, L + boxW + 8, y + 5 + i * 4.2)
    pdf.setTextColor(26, 29, 36); pdf.text(pdf.splitTextToSize(v, boxW - 40)[0], L + boxW + 40, y + 5 + i * 4.2)
  })
  y += boxH + 5

  const words = s.show_words && getLocale() === 'sq' ? `${t('In words')}: ${amountInWords(d.total, d.currency)}` : ''

  if (isVoucher(d)) {
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(20); pdf.setTextColor(...A)
    pdf.text(`${nf(d.total, dec)} ${d.currency}`, L, y + 6); y += 11
    pdf.setFont('helvetica', 'italic'); pdf.setFontSize(9); pdf.setTextColor(26, 29, 36)
    if (words) { pdf.text(pdf.splitTextToSize(words, R - L), L, y); y += 6 }
    pdf.setFont('helvetica', 'normal')
    const method = t(METHOD[d.method ?? ''] ?? METHOD.bank_transfer)
    pdf.text(`${t('Method')}: ${method}${d.account ? ` · ${d.account}` : ''}${d.reference ? ` · ${t('Reference')}: ${d.reference}` : ''}`, L, y); y += 4
    if (d.allocations?.length) {
      autoTable(pdf, {
        startY: y + 2, margin: { left: L, right: W - R }, theme: 'striped', styles: { fontSize: 8.5, cellPadding: 1.6 },
        headStyles: { fillColor: A, textColor: 255 }, columnStyles: { 2: { halign: 'right' } },
        didParseCell: (c) => { if (c.section === 'head' && c.column.index === 2) c.cell.styles.halign = 'right' },
        head: [[t('For document'), t('Date'), t('Amount')]],
        body: [...d.allocations.map((a) => [`${a.number}${a.reference ? ` (${a.reference})` : ''}`, formatDate(a.date), nf(a.amount, dec)]),
          ...(d.unallocated ? [[t('In advance'), '', nf(d.unallocated, dec)]] : [])],
      })
      y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4
    }
  } else {
    const codes = s.show_codes, disc = s.show_discount && prices && d.lines.some((l) => Number(l.discount) > 0)
    const vatCols = d.kind !== 'goods_receipt'
    const lots = d.lines.some((l) => l.lot)
    const head = ['#', ...(codes ? [t('Code')] : []), t('Description'), ...(lots ? [t('Lot')] : []), t('Unit'), t('Qty'),
      ...(prices ? [vatCols ? t('Price') : t('Cost'), ...(disc ? [t('Disc.')] : []), ...(vatCols ? [t('VAT')] : []), vatCols ? t('Without VAT') : t('Value'), ...(vatCols ? [t('With VAT')] : [])] : [])]
    const body = d.lines.map((l, i) => [String(i + 1), ...(codes ? [l.code ?? ''] : []), l.description, ...(lots ? [l.lot ?? ''] : []), l.uom ? td(l.uom) : '', l.pack ? `${qf(l.qty)}\n${l.pack}` : qf(l.qty),
      ...(prices ? [nf(l.price, Math.max(dec, 2)), ...(disc ? [pf(l.discount)] : []), ...(vatCols ? [pf(l.tax_rate) || '0%'] : []), nf(l.net, dec), ...(vatCols ? [nf(l.total, dec)] : [])] : [])])
    const firstNum = head.indexOf(t('Qty'))
    const columnStyles: Record<number, { halign: 'right' | 'center'; cellWidth?: number }> = { 0: { halign: 'center', cellWidth: 7 } }
    for (let i = firstNum; i < head.length; i++) columnStyles[i] = { halign: 'right' }
    autoTable(pdf, {
      startY: y, margin: { left: L, right: W - R }, theme: 'striped', head: [head], body,
      styles: { fontSize: 8.3, cellPadding: 1.5, overflow: 'linebreak' }, headStyles: { fillColor: A, textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [247, 248, 250] }, columnStyles,
      // headings line up with their numbers
      didParseCell: (c) => { if (c.section === 'head' && columnStyles[c.column.index]) c.cell.styles.halign = columnStyles[c.column.index].halign },
    })
    y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5
    if (y > 245) { pdf.addPage(); y = 16 }

    // VAT summary (left) and totals (right)
    const totX = R - 70
    if (prices && vatCols && d.vat.length) {
      autoTable(pdf, {
        startY: y, margin: { left: L, right: W - totX + 6 }, theme: 'plain', styles: { fontSize: 8, cellPadding: 1 },
        headStyles: { textColor: gray, fontStyle: 'normal' }, columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
        didParseCell: (c) => { if (c.section === 'head' && c.column.index > 0) c.cell.styles.halign = 'right' },
        head: [[t('VAT rate'), t('Base'), t('VAT')]], body: d.vat.map((v) => [pf(v.rate) || '0%', nf(v.base, dec), nf(v.tax, dec)]),
      })
    }
    const rows: [string, string, boolean?][] = prices && !vatCols ? [[t('Value'), `${nf(d.total, dec)} ${d.currency}`, true]] : prices ? [
      ...(d.discount_total ? [[t('Discount'), nf(d.discount_total, dec)] as [string, string]] : []),
      [t('Without VAT'), nf(d.subtotal, dec)], [t('VAT'), nf(d.tax_total, dec)], [t('Total'), `${nf(d.total, dec)} ${d.currency}`, true],
      ...((d.kind === 'sales_invoice' || d.kind === 'advance_invoice') && d.paid ? [[t('Paid'), nf(d.paid, dec)] as [string, string], [t('Still to pay'), nf(d.due, dec), true] as [string, string, boolean]] : []),
    ] : [[t('Lines'), String(d.lines.length)], [t('Total quantity'), qf(d.lines.reduce((a, l) => a + Number(l.qty), 0))]]
    let ty = y + 1
    rows.forEach(([k, v, strong]) => {
      if (strong) { pdf.setDrawColor(...A); pdf.setLineWidth(0.4); pdf.line(totX, ty - 3.4, R, ty - 3.4) }
      pdf.setFont('helvetica', strong ? 'bold' : 'normal'); pdf.setFontSize(strong ? 11 : 9); pdf.setTextColor(...(strong ? A : [26, 29, 36] as [number, number, number]))
      pdf.text(k, totX, ty); pdf.text(v, R, ty, { align: 'right' }); ty += strong ? 6 : 4.6
    })
    y = Math.max(ty, (pdf as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 3
    if (prices && vatCols && words) { pdf.setFont('helvetica', 'italic'); pdf.setFontSize(9); pdf.setTextColor(26, 29, 36); pdf.text(pdf.splitTextToSize(words, R - L), L, y); y += 6 }
  }

  // notes, bank accounts, codes
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(26, 29, 36)
  for (const n of [d.terms, d.notes, d.company.settings?.texts?.[textKey(d)]].filter(Boolean) as string[]) {
    const lines = pdf.splitTextToSize(n, R - L); if (y + lines.length * 4 > 270) { pdf.addPage(); y = 16 }
    pdf.text(lines, L, y); y += lines.length * 4 + 2
  }
  if (s.show_banks && d.company.banks.length && ['sales_invoice', 'advance_invoice', 'proforma', 'sales_quote', 'sales_order'].includes(d.kind)) {
    pdf.setFont('helvetica', 'bold'); pdf.text(`${t('Bank accounts')}:`, L, y); pdf.setFont('helvetica', 'normal')
    d.company.banks.forEach((b, i) => pdf.text(`${b.bank} · ${b.iban}${b.swift ? ` · ${b.swift}` : ''}${b.currency !== d.company.base_currency ? ` (${b.currency})` : ''}`, L + 30, y + i * 4))
    y += d.company.banks.length * 4 + 2
  }
  if (d.fiscal?.fic) {
    pdf.setFontSize(7.5); pdf.setTextColor(...gray)
    const f = pdf.splitTextToSize(`NIVF: ${d.fiscal.iic} · NSLF: ${d.fiscal.fic}${d.fiscal.tcr ? ` · TCR: ${d.fiscal.tcr}` : ''}`, R - L)
    pdf.text(f, L, y); y += f.length * 3.4 + 2
  }
  if (s.show_signatures) {
    const [sl, sr] = isVoucher(d) ? [d.kind === 'receipt_voucher' ? t('Received by') : t('Paid by'), d.kind === 'receipt_voucher' ? t('Paid by') : t('Received by')]
      : d.kind === 'goods_receipt' ? [t('Delivered by'), t('Received by')] : [t('Issued by'), t('Received by')]
    y = Math.max(y + 14, 0); if (y > 272) { pdf.addPage(); y = 30 }
    pdf.setDrawColor(138, 143, 156); pdf.setLineWidth(0.25)
    pdf.line(L, y, L + 70, y); pdf.line(R - 70, y, R, y)
    pdf.setFontSize(8.5); pdf.setTextColor(...gray); pdf.text(sl, L + 35, y + 4, { align: 'center' }); pdf.text(sr, R - 35, y + 4, { align: 'center' })
  }
  // footer on every page
  const pages = pdf.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i); pdf.setFontSize(7.5); pdf.setTextColor(107, 112, 128)
    const foot = d.company.footer || s.footer || ''
    if (foot) pdf.text(pdf.splitTextToSize(foot, 120)[0], L, 289)
    pdf.text(`${d.number} · ${t('page {n} of {total}', { n: i, total: pages })}`, R, 289, { align: 'right' })
  }
  return pdf
}

export async function pdfBase64(d: PrintDoc) {
  const pdf = await renderDocPdf(d)
  return (pdf.output('datauristring') as string).split(',')[1]
}
