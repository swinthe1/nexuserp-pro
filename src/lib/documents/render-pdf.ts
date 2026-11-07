/** The same document as a PDF (A4), for downloading and for email attachments. */
import { getLocale, t, td } from '@/i18n'
import { formatDate, formatMoney } from '@/lib/utils'
import { BANK_KINDS, METHOD, amountInWords, docTitle, isVoucher, partnerLabel, type PrintDoc, settingsOf, showPrices, textKey, unitWithVat } from './model'

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

/** a picture with its transparent parts kept (a signature drawn over the stamp) */
async function alphaPng(src: string): Promise<{ data: string; w: number; h: number } | null> {
  try {
    const img = new Image()
    img.src = src
    await img.decode()
    const c = document.createElement('canvas')
    const scale = Math.min(1, 480 / Math.max(img.naturalWidth, img.naturalHeight))
    c.width = Math.max(1, Math.round(img.naturalWidth * scale)); c.height = Math.max(1, Math.round(img.naturalHeight * scale))
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    return { data: c.toDataURL('image/png'), w: c.width, h: c.height }
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

  // ---- header: logo + company, title + number (the detailed layout: in a band of the colour)
  const tpl = isVoucher(d) ? 'standard' : s.template ?? 'standard'
  const ink: [number, number, number] = [26, 29, 36]
  const right = s.logo_position === 'right'
  const logo = d.company.logo ? await logoPng(d.company.logo) : null
  const align = right ? 'right' : 'left'
  const coLines = [
    [d.company.tax_number && `${t('NIPT/NUI')} ${d.company.tax_number}`, d.company.vat_number && `${t('VAT no.')} ${d.company.vat_number}`].filter(Boolean).join(' · '),
    d.company.address ?? '', [d.company.phone, d.company.email, d.company.website].filter(Boolean).join(' · '),
  ].filter(Boolean)
  if (tpl === 'detailed') {
    const bh = 26
    pdf.setFillColor(...A); pdf.roundedRect(L, y - 4, R - L, bh, 2, 2, 'F')
    let cx = right ? R - 4 : L + 4
    if (logo) {
      const h = s.logo_size === 's' ? 11 : s.logo_size === 'l' ? 18 : 14, w = Math.min(h * 2.7, (logo.w / logo.h) * h)
      pdf.setFillColor(255, 255, 255); pdf.roundedRect(right ? R - 4 - w - 2 : L + 3, y - 4 + (bh - h) / 2 - 1, w + 2, h + 2, 1.2, 1.2, 'F')
      pdf.addImage(logo.data, 'JPEG', right ? R - 4 - w - 1 : L + 4, y - 4 + (bh - h) / 2, w, h, undefined, 'FAST')
      cx = right ? R - w - 9 : L + w + 9
    }
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12.5); pdf.setTextColor(255, 255, 255)
    pdf.text(d.company.legal_name || d.company.name, cx, y + bh / 2 - 2.5, { align })
    pdf.setFontSize(17); pdf.text(docTitle(d), right ? L + 4 : R - 4, y + 4, { align: right ? 'left' : 'right' })
    pdf.setFontSize(10.5); pdf.text(d.number, right ? L + 4 : R - 4, y + 10, { align: right ? 'left' : 'right' })
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.text(formatDate(d.date), right ? L + 4 : R - 4, y + 15, { align: right ? 'left' : 'right' })
    y += bh
    pdf.setFontSize(7.5); pdf.setTextColor(...gray)
    const strip = pdf.splitTextToSize(coLines.join(' · '), R - L)
    pdf.text(strip, L, y); y += strip.length * 3.3 + 3
  } else {
    let cx = right ? R : L
    if (logo) {
      const h = s.logo_size === 's' ? 13 : s.logo_size === 'l' ? 25 : 18, w = Math.min(h * 2.7, (logo.w / logo.h) * h)
      pdf.addImage(logo.data, 'JPEG', right ? R - w : L, y, w, h, undefined, 'FAST')
      cx = right ? R - w - 4 : L + w + 4
    }
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12); pdf.setTextColor(...ink)
    pdf.text(d.company.legal_name || d.company.name, cx, y + 4, { align })
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(...gray)
    coLines.forEach((line, i) => pdf.text(line, cx, y + 9 + i * 3.6, { align }))
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(tpl === 'simple' ? 19 : 17); pdf.setTextColor(...(tpl === 'simple' ? ink : A))
    pdf.text(docTitle(d), right ? L : R, y + 5, { align: right ? 'left' : 'right' })
    pdf.setFontSize(11); pdf.setTextColor(...ink)
    pdf.text(d.number, right ? L : R, y + 11, { align: right ? 'left' : 'right' })
    y = Math.max(y + 22, y + 9 + coLines.length * 3.6 + 2)
    if (tpl === 'simple') { pdf.setDrawColor(...ink); pdf.setLineWidth(0.3) } else { pdf.setDrawColor(...A); pdf.setLineWidth(0.6) }
    pdf.line(L, y, R, y)
    y += 5
  }

  // ---- the customer and the document's details: plain text (simple), two boxes (standard), three boxes (detailed)
  const p = d.partner
  const pLines = p ? [p.legal_name || p.name, p.tax_number ? `${t('NIPT/NUI')} ${p.tax_number}${p.vat_number ? ` · ${t('VAT no.')} ${p.vat_number}` : ''}` : '',
    p.address ?? '', [p.code, p.phone, p.email].filter(Boolean).join(' · '), tpl !== 'detailed' && d.deliver_to ? `${t('Deliver to')}: ${d.deliver_to}` : ''].filter(Boolean) : []
  let det: [string, string][] = ([
    [t('Date'), formatDate(d.date)], [t('Due date'), d.due_date ? formatDate(d.due_date) : ''], [t('Valid until'), d.valid_until ? formatDate(d.valid_until) : ''],
    [t('Wanted by'), d.requested_date ? formatDate(d.requested_date) : ''], [t('Expected on'), d.expected_date ? formatDate(d.expected_date) : ''],
    [t('Payment terms'), d.payment_term ?? ''],
    ...(d.instalments ?? []).map((x, i) => [i === 0 ? t('Instalments') : '', `${formatDate(x.due_date)}: ${formatMoney(x.amount)}`] as [string, string]), [t('Order'), d.order ?? ''], [t('Corrects invoice'), d.original ?? ''], [t('Your reference'), d.reference ?? ''],
    [t('Warehouse'), tpl === 'detailed' ? '' : d.warehouse ?? ''], [t('Salesperson'), d.salesperson ?? ''], [t('Buyer'), d.buyer ?? ''],
    [t('Carrier'), tpl === 'detailed' ? '' : [d.carrier, d.tracking].filter(Boolean).join(' · ')], [t('Currency'), d.currency !== d.company.base_currency ? d.currency : ''],
  ] as [string, string][]).filter(([, v]) => v)
  if (tpl === 'simple') det = det.filter(([k]) => [t('Date'), t('Due date'), t('Valid until'), t('Payment terms'), t('Order'), t('Your reference'), t('Currency'), t('Expected on')].includes(k))
  const boxes = tpl === 'detailed' ? 3 : 2
  const gap = tpl === 'detailed' ? 4 : 5
  const boxW = (R - L - gap * (boxes - 1)) / boxes
  const ship = tpl === 'detailed' ? [d.ship_to || d.deliver_to || p?.address || '—', d.carrier ? `${t('Carrier')}: ${[d.carrier, d.tracking].filter(Boolean).join(' · ')}` : '',
    d.packages ? `${t('Packages')}: ${d.packages}` : '', d.weight ? `${t('Weight')}: ${qf(d.weight)} kg` : '', d.incoterm ? `${t('Delivery terms')}: ${d.incoterm}` : '', d.warehouse ? `${t('Warehouse')}: ${d.warehouse}` : ''].filter(Boolean) : []
  const boxH = Math.max(6 + pLines.length * 4.2, 4 + det.length * 4.2, 6 + ship.length * 4.2) + 2
  const detX = L + (boxW + gap) * (boxes - 1)
  if (tpl !== 'simple') {
    pdf.setDrawColor(217, 220, 227); pdf.setLineWidth(0.25)
    for (let i = 0; i < boxes; i++) pdf.roundedRect(L + (boxW + gap) * i, y, boxW, boxH, 1.5, 1.5)
  }
  if (p) {
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7); pdf.setTextColor(...(tpl === 'simple' ? gray : A)); pdf.text(partnerLabel(d).toUpperCase(), L + (tpl === 'simple' ? 0 : 3), y + 4.5)
    pLines.forEach((line, i) => {
      pdf.setFont('helvetica', i === 0 ? 'bold' : 'normal'); pdf.setFontSize(i === 0 ? 10 : 8.5); pdf.setTextColor(...ink)
      pdf.text(pdf.splitTextToSize(line, boxW - 6)[0], L + (tpl === 'simple' ? 0 : 3), y + 9 + i * 4.2)
    })
  }
  if (tpl === 'detailed') {
    const x0 = L + boxW + gap
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7); pdf.setTextColor(...A); pdf.text(t('Delivery address').toUpperCase(), x0 + 3, y + 4.5)
    ship.forEach((line, i) => { pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(...(i === 0 ? ink : gray)); pdf.text(pdf.splitTextToSize(line, boxW - 6)[0], x0 + 3, y + 9 + i * 4.2) })
  }
  const keyW = tpl === 'detailed' ? 28 : 32
  det.forEach(([k, v], i) => {
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(...gray); pdf.text(k, detX + 3, y + 5 + i * 4.2)
    pdf.setTextColor(...ink); pdf.text(pdf.splitTextToSize(v, boxW - keyW - 6)[0], detX + 3 + keyW, y + 5 + i * 4.2)
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
    const codes = s.show_codes, disc = (tpl === 'detailed' || s.show_discount) && prices && d.lines.some((l) => Number(l.discount) > 0)
    const vatCols = d.kind !== 'goods_receipt'
    const lots = d.lines.some((l) => l.lot)
    let head: string[], body: string[][], firstNum: number
    const columnStyles: Record<number, { halign: 'right' | 'center' | 'left'; cellWidth?: number }> = {}
    if (tpl === 'simple') {
      head = [t('Description'), t('Qty'), ...(prices ? [t('Price with VAT'), t('Total')] : [])]
      body = d.lines.map((l) => [codes && l.code ? `${l.description}\n${l.code}` : l.description, `${qf(l.qty)} ${l.uom ? td(l.uom) : ''}`.trim(),
        ...(prices ? [nf(unitWithVat(l), Math.max(dec, 2)), nf(l.total, dec)] : [])])
      firstNum = 1
    } else if (tpl === 'detailed') {
      head = ['#', ...(codes ? [t('Code')] : []), t('Description'), ...(lots ? [t('Lot')] : []), t('Unit'), t('Qty'),
        ...(prices ? [vatCols ? t('Price without VAT') : t('Cost'), ...(disc ? [t('Disc.')] : []), vatCols ? t('Base') : t('Value'), ...(vatCols ? [`${t('VAT')} %`, t('VAT amount'), t('Total')] : [])] : [])]
      body = d.lines.map((l, i) => [String(i + 1), ...(codes ? [l.code ?? ''] : []), l.description, ...(lots ? [l.lot ?? ''] : []), l.uom ? td(l.uom) : '', l.pack ? `${qf(l.qty)}\n${l.pack}` : qf(l.qty),
        ...(prices ? [nf(l.price, Math.max(dec, 2)), ...(disc ? [pf(l.discount)] : []), nf(l.net, dec), ...(vatCols ? [pf(l.tax_rate) || '0%', nf(l.tax, dec), nf(l.total, dec)] : [])] : [])])
      firstNum = head.indexOf(t('Qty')); columnStyles[0] = { halign: 'center', cellWidth: 7 }
    } else {
      head = ['#', ...(codes ? [t('Code')] : []), t('Description'), ...(lots ? [t('Lot')] : []), t('Unit'), t('Qty'),
        ...(prices ? [vatCols ? t('Price') : t('Cost'), ...(disc ? [t('Disc.')] : []), ...(vatCols ? [t('VAT')] : []), vatCols ? t('Without VAT') : t('Value'), ...(vatCols ? [t('With VAT')] : [])] : [])]
      body = d.lines.map((l, i) => [String(i + 1), ...(codes ? [l.code ?? ''] : []), l.description, ...(lots ? [l.lot ?? ''] : []), l.uom ? td(l.uom) : '', l.pack ? `${qf(l.qty)}\n${l.pack}` : qf(l.qty),
        ...(prices ? [nf(l.price, Math.max(dec, 2)), ...(disc ? [pf(l.discount)] : []), ...(vatCols ? [pf(l.tax_rate) || '0%'] : []), nf(l.net, dec), ...(vatCols ? [nf(l.total, dec)] : [])] : [])])
      firstNum = head.indexOf(t('Qty')); columnStyles[0] = { halign: 'center', cellWidth: 7 }
    }
    for (let i = firstNum; i < head.length; i++) columnStyles[i] = { halign: 'right' }
    autoTable(pdf, {
      startY: y, margin: { left: L, right: W - R }, theme: tpl === 'simple' ? 'plain' : 'striped', head: [head], body,
      styles: { fontSize: tpl === 'detailed' ? 7.6 : tpl === 'simple' ? 9 : 8.3, cellPadding: tpl === 'simple' ? 2 : 1.5, overflow: 'linebreak' },
      headStyles: tpl === 'simple' ? { textColor: gray, fontStyle: 'bold', fontSize: 7.5, lineWidth: { bottom: 0.3 }, lineColor: ink } : { fillColor: A, textColor: 255, fontStyle: 'bold' },
      bodyStyles: tpl === 'simple' ? { lineWidth: { bottom: 0.1 }, lineColor: [230, 232, 238] } : {},
      alternateRowStyles: tpl === 'simple' ? {} : { fillColor: [247, 248, 250] }, columnStyles,
      // headings line up with their numbers
      didParseCell: (c) => { if (c.section === 'head' && columnStyles[c.column.index]) c.cell.styles.halign = columnStyles[c.column.index].halign },
    })
    y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5
    if (tpl === 'detailed') {
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(...gray)
      pdf.text(`${t('Lines')}: ${d.lines.length} · ${t('Total quantity')}: ${qf(d.lines.reduce((a, l) => a + Number(l.qty), 0))}`, R, y - 1.5, { align: 'right' }); y += 2
    }
    if (y > 245) { pdf.addPage(); y = 16 }

    // VAT summary (left) and totals (right)
    const totX = R - 70
    if (prices && vatCols && d.vat.length && tpl === 'simple') {
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(...gray)
      d.vat.forEach((v, i) => pdf.text(`${t('VAT')} ${pf(v.rate) || '0%'} · ${t('Base')} ${nf(v.base, dec)} · ${t('VAT')} ${nf(v.tax, dec)}`, L, y + 1 + i * 4))
    } else if (prices && vatCols && d.vat.length) {
      const full = tpl === 'detailed'
      autoTable(pdf, {
        startY: y, margin: { left: L, right: W - totX + 6 }, theme: 'plain', styles: { fontSize: 8, cellPadding: 1 },
        headStyles: { textColor: gray, fontStyle: 'normal' }, columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
        didParseCell: (c) => { if (c.section === 'head' && c.column.index > 0) c.cell.styles.halign = 'right' },
        head: [[t('VAT rate'), t('Base'), t('VAT'), ...(full ? [t('Total')] : [])]],
        body: d.vat.map((v) => [pf(v.rate) || '0%', nf(v.base, dec), nf(v.tax, dec), ...(full ? [nf(Number(v.base) + Number(v.tax), dec)] : [])]),
      })
    }
    const invoiceLike = d.kind === 'sales_invoice' || d.kind === 'advance_invoice'
    const owes = invoiceLike && !!d.paid
    const rows: [string, string, boolean?][] = prices && !vatCols ? [[t('Value'), `${nf(d.total, dec)} ${d.currency}`, true]] : prices ? (tpl === 'simple' ? [
      [t('Without VAT'), nf(d.subtotal, dec)], [t('VAT'), nf(d.tax_total, dec)], [t('Total'), `${nf(d.total, dec)} ${d.currency}`, true],
      ...(owes ? [[t('Still to pay'), nf(d.due, dec)] as [string, string]] : []),
    ] : [
      ...(d.discount_total && tpl === 'detailed' ? [[t('Before discount'), nf(Number(d.subtotal ?? 0) + Number(d.discount_total), dec)] as [string, string]] : []),
      ...(d.discount_total ? [[t('Discount'), nf(d.discount_total, dec)] as [string, string]] : []),
      [t('Without VAT'), nf(d.subtotal, dec)], [t('VAT'), nf(d.tax_total, dec)], [t('Total'), `${nf(d.total, dec)} ${d.currency}`, true],
      ...(owes ? [[t('Paid'), nf(d.paid, dec)] as [string, string], ...(tpl === 'detailed' ? [] : [[t('Still to pay'), nf(d.due, dec), true] as [string, string, boolean]])] : []),
    ]) : [[t('Lines'), String(d.lines.length)], [t('Total quantity'), qf(d.lines.reduce((a, l) => a + Number(l.qty), 0))]]
    let ty = y + 1
    rows.forEach(([k, v, strong]) => {
      const lineCol = tpl === 'simple' ? ink : A
      if (strong) { pdf.setDrawColor(...lineCol); pdf.setLineWidth(0.4); pdf.line(totX, ty - 3.4, R, ty - 3.4) }
      pdf.setFont('helvetica', strong ? 'bold' : 'normal'); pdf.setFontSize(strong ? 11 : 9); pdf.setTextColor(...(strong ? lineCol : ink))
      pdf.text(k, totX, ty); pdf.text(v, R, ty, { align: 'right' }); ty += strong ? 6 : 4.6
    })
    // the detailed layout ends its totals with what is left to pay, in the colour
    if (tpl === 'detailed' && prices && vatCols && (invoiceLike || d.kind === 'proforma')) {
      pdf.setFillColor(...A); pdf.roundedRect(totX - 2, ty - 3, R - totX + 2, 8, 1.2, 1.2, 'F')
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10.5); pdf.setTextColor(255, 255, 255)
      pdf.text(t('Still to pay'), totX + 1, ty + 2.3); pdf.text(`${nf(owes ? d.due : d.total, dec)} ${d.currency}`, R - 2, ty + 2.3, { align: 'right' }); ty += 10
    }
    y = Math.max(ty, (pdf as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y, tpl === 'simple' ? y + d.vat.length * 4 + 2 : 0) + 3
    if (prices && vatCols && words) { pdf.setFont('helvetica', 'italic'); pdf.setFontSize(9); pdf.setTextColor(26, 29, 36); pdf.text(pdf.splitTextToSize(words, R - L), L, y); y += 6 }
  }

  // notes, bank accounts, codes
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(26, 29, 36)
  for (const n of [d.terms, d.notes, d.company.settings?.texts?.[textKey(d)]].filter(Boolean) as string[]) {
    const lines = pdf.splitTextToSize(n, R - L); if (y + lines.length * 4 > 270) { pdf.addPage(); y = 16 }
    pdf.text(lines, L, y); y += lines.length * 4 + 2
  }
  const showBanks = s.show_banks && d.company.banks.length && BANK_KINDS.includes(d.kind)
  if (tpl === 'detailed' && prices && (showBanks || ['sales_invoice', 'advance_invoice', 'proforma'].includes(d.kind))) {
    if (y > 245) { pdf.addPage(); y = 16 }
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7.5); pdf.setTextColor(...A); pdf.text(t('How to pay').toUpperCase(), L, y); y += 1.5
    if (showBanks) {
      autoTable(pdf, {
        startY: y, margin: { left: L, right: W - R - 0 + 70 }, theme: 'plain', styles: { fontSize: 8, cellPadding: 1 }, headStyles: { textColor: gray, fontStyle: 'normal' },
        head: [[t('Bank'), 'IBAN', ...(s.show_swift ? ['SWIFT'] : []), t('Currency')]],
        body: d.company.banks.map((b) => [b.bank, b.iban, ...(s.show_swift ? [b.swift ?? ''] : []), b.currency]),
      })
      y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 3
    } else y += 3
    if (['sales_invoice', 'advance_invoice', 'proforma'].includes(d.kind)) {
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(...ink)
      pdf.text(`${t('Payment reference')}: ${d.number}${d.due_date ? ` · ${t('Due date')}: ${formatDate(d.due_date)}` : ''}`, L, y); y += 5
    }
  } else if (showBanks) {
    const bankText = (b: PrintDoc['company']['banks'][number]) => `${b.bank} · ${b.iban}${b.swift && s.show_swift ? ` · SWIFT ${b.swift}` : ''}${b.currency !== d.company.base_currency ? ` (${b.currency})` : ''}`
    pdf.setFont('helvetica', 'bold'); pdf.text(`${t('Bank accounts')}:`, L, y); pdf.setFont('helvetica', 'normal')
    if (s.banks_layout === 'row') {
      const lines = pdf.splitTextToSize(d.company.banks.map(bankText).join('   |   '), R - L - 30)
      pdf.text(lines, L + 30, y); y += lines.length * 4 + 2
    } else {
      d.company.banks.forEach((b, i) => pdf.text(bankText(b), L + 30, y + i * 4))
      y += d.company.banks.length * 4 + 2
    }
  }
  if (d.fiscal?.fic) {
    pdf.setFontSize(7.5); pdf.setTextColor(...gray)
    const f = pdf.splitTextToSize(`NIVF: ${d.fiscal.iic} · NSLF: ${d.fiscal.fic}${d.fiscal.tcr ? ` · TCR: ${d.fiscal.tcr}` : ''}`, R - L)
    pdf.text(f, L, y); y += f.length * 3.4 + 2
  }
  const stamp = s.show_stamp && d.company.stamp && !isVoucher(d) && d.kind !== 'goods_receipt' ? await logoPng(d.company.stamp) : null
  const sig = d.signature ? await alphaPng(d.signature.image) : null
  if (!s.show_signatures && stamp && !sig) {
    y += 6; if (y + 28 > 272) { pdf.addPage(); y = 20 }
    const h = 24, w = Math.min(50, (stamp.w / stamp.h) * h); pdf.addImage(stamp.data, 'JPEG', L, y, w, h, undefined, 'FAST'); y += h + 2
  }
  if (s.show_signatures || sig) {
    const [sl, sr] = isVoucher(d) ? [d.kind === 'receipt_voucher' ? t('Received by') : t('Paid by'), d.kind === 'receipt_voucher' ? t('Paid by') : t('Received by')]
      : d.kind === 'goods_receipt' ? [t('Delivered by'), t('Received by')] : [t('Issued by'), t('Received by')]
    y = Math.max(y + (stamp || sig ? 30 : 14), 0); if (y > 268) { pdf.addPage(); y = 40 }
    if (stamp) { const h = 24, w = Math.min(50, (stamp.w / stamp.h) * h); pdf.addImage(stamp.data, 'JPEG', L + 35 - w / 2 + (sig ? 9 : 0), y - h + 4, w, h, undefined, 'FAST') }
    // the signature over the line, on top of the stamp, as a pen would
    if (sig) { const h = 17, w = Math.min(56, (sig.w / sig.h) * h); pdf.addImage(sig.data, 'PNG', L + 35 - w / 2 - 6, y - h + 2.5, w, h, undefined, 'FAST') }
    pdf.setDrawColor(138, 143, 156); pdf.setLineWidth(0.25)
    pdf.line(L, y, L + 70, y); if (s.show_signatures) pdf.line(R - 70, y, R, y)
    pdf.setFontSize(8.5); pdf.setTextColor(...gray); pdf.text(sl, L + 35, y + 4, { align: 'center' }); if (s.show_signatures) pdf.text(sr, R - 35, y + 4, { align: 'center' })
    if (d.signature) { pdf.setTextColor(31, 36, 48); pdf.text(`${d.signature.name}${d.signature.title ? `, ${d.signature.title}` : ''}`, L + 35, y + 8, { align: 'center' }) }
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
