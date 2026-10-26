/** A printed document as an A4 HTML page (printing goes through printHtml). */
import { getLocale, t } from '@/i18n'
import { formatDate } from '@/lib/utils'
import { METHOD, amountInWords, docTitle, isVoucher, partnerLabel, type PrintDoc, settingsOf, showPrices, textKey } from './model'

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
const nf = (n: number | null | undefined, d = 2) => n == null ? '' : Number(n).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d })
const qf = (n: number | null | undefined) => n == null ? '' : Number(n).toLocaleString('de-DE', { maximumFractionDigits: 4 })
const pf = (n: number | null | undefined) => n == null || Number(n) === 0 ? '' : `${Number(n).toLocaleString('de-DE', { maximumFractionDigits: 2 })}%`

export function docCss(accent: string) {
  return `@page{size:A4;margin:14mm 12mm 14mm 12mm}
*{box-sizing:border-box}body{font-family:Inter,'Segoe UI',Arial,sans-serif;font-size:10.5px;color:#1a1d24;margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.top{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;padding-bottom:12px;border-bottom:2px solid ${accent}}
.top.rev{flex-direction:row-reverse}.co{display:flex;gap:12px;align-items:flex-start}.co img{max-height:64px;max-width:170px;object-fit:contain}
.co b{font-size:14px;display:block;margin-bottom:2px}.muted{color:#5b6170}.co div div{line-height:1.45}
.title{text-align:right}.top.rev .title{text-align:left}.title h1{margin:0;font-size:20px;color:${accent};letter-spacing:.2px}.title .no{font-size:13px;font-weight:600;margin-top:2px}
.boxes{display:grid;grid-template-columns:1.2fr 1fr;gap:14px;margin:14px 0}.box{border:1px solid #d9dce3;border-radius:6px;padding:9px 11px;line-height:1.5}
.box .lbl{font-size:9px;text-transform:uppercase;letter-spacing:.6px;color:${accent};font-weight:600;margin-bottom:3px}.box b{font-size:12px}
.kv{display:grid;grid-template-columns:auto 1fr;gap:1px 10px}.kv span:nth-child(odd){color:#5b6170}
table.l{width:100%;border-collapse:collapse;margin-top:4px}table.l th{background:${accent};color:#fff;font-weight:600;font-size:9.5px;text-align:left;padding:6px 6px}
table.l td{padding:5px 6px;border-bottom:1px solid #e6e8ee;vertical-align:top}table.l tr:nth-child(even) td{background:#f7f8fa}
.r{text-align:right;white-space:nowrap}.c{text-align:center}.sm{font-size:9px;color:#5b6170}
.bottom{display:grid;grid-template-columns:1fr 250px;gap:18px;margin-top:12px;align-items:start}
table.v{border-collapse:collapse;width:100%}table.v th{font-size:9px;color:#5b6170;text-align:right;font-weight:500;padding:3px 6px;border-bottom:1px solid #d9dce3}
table.v th:first-child,table.v td:first-child{text-align:left}table.v td{padding:3px 6px;text-align:right}
.tot{border:1px solid #d9dce3;border-radius:6px;padding:8px 11px}.tot div{display:flex;justify-content:space-between;padding:2px 0}
.tot .big{border-top:1.5px solid ${accent};margin-top:4px;padding-top:6px;font-size:14px;font-weight:700;color:${accent}}
.words{margin-top:10px;font-style:italic}.notes{margin-top:10px;white-space:pre-wrap;line-height:1.5}
.banks{margin-top:10px;font-size:9.5px;line-height:1.5}.fiscal{margin-top:8px;font-size:9px;color:#5b6170;word-break:break-all}
.sign{display:grid;grid-template-columns:1fr 1fr;gap:60px;margin-top:38px}.sign div{border-top:1px solid #8a8f9c;padding-top:4px;text-align:center;color:#5b6170;font-size:9.5px}
.foot{margin-top:18px;padding-top:6px;border-top:1px solid #e6e8ee;font-size:9px;color:#6b7080;display:flex;justify-content:space-between;gap:12px}
.amount{font-size:22px;font-weight:700;color:${accent}}.vbox{border:1px solid #d9dce3;border-radius:6px;padding:12px 14px;margin-top:14px;line-height:1.7}
tr{page-break-inside:avoid}`
}

function companyBlock(d: PrintDoc) {
  const c = d.company
  const ids = [c.tax_number && `${t('NIPT/NUI')} ${c.tax_number}`, c.vat_number && `${t('VAT no.')} ${c.vat_number}`, c.business_number && `${t('Business no.')} ${c.business_number}`].filter(Boolean)
  return `<div class="co">${c.logo ? `<img src="${esc(c.logo)}" alt="">` : ''}<div><b>${esc(c.legal_name || c.name)}</b>
    ${ids.length ? `<div class="muted">${esc(ids.join(' · '))}</div>` : ''}
    ${c.address ? `<div class="muted">${esc(c.address)}</div>` : ''}
    <div class="muted">${esc([c.phone, c.email, c.website].filter(Boolean).join(' · '))}</div></div></div>`
}

function details(d: PrintDoc): [string, string][] {
  const rows: [string, string | null | undefined][] = [
    [t('Date'), formatDate(d.date)],
    [t('Due date'), d.due_date ? formatDate(d.due_date) : null],
    [t('Valid until'), d.valid_until ? formatDate(d.valid_until) : null],
    [t('Wanted by'), d.requested_date ? formatDate(d.requested_date) : null],
    [t('Expected on'), d.expected_date ? formatDate(d.expected_date) : null],
    [t('Payment terms'), d.payment_term],
    [t('Order'), d.order],
    [t('Corrects invoice'), d.original],
    [t('Your reference'), d.reference],
    [t('Warehouse'), d.warehouse],
    [t('Salesperson'), d.salesperson],
    [t('Buyer'), d.buyer],
    [t('Carrier'), [d.carrier, d.tracking].filter(Boolean).join(' · ') || null],
    [t('Packages'), d.packages ? String(d.packages) : null],
    [t('Delivery terms'), d.incoterm],
    [t('Currency'), d.currency !== d.company.base_currency ? `${d.currency}${d.rate && d.rate !== 1 ? ` · ${t('rate')} ${d.rate}` : ''}` : null],
  ]
  return rows.filter((r): r is [string, string] => !!r[1])
}

export function renderDocHtml(d: PrintDoc): { body: string; css: string } {
  const s = settingsOf(d)
  const prices = showPrices(d)
  const dec = d.company.decimals ?? 2
  const p = d.partner
  const partner = p ? `<div class="box"><div class="lbl">${esc(partnerLabel(d))}</div><b>${esc(p.legal_name || p.name)}</b>
      ${p.tax_number ? `<div>${esc(t('NIPT/NUI'))} ${esc(p.tax_number)}${p.vat_number ? ` · ${esc(t('VAT no.'))} ${esc(p.vat_number)}` : ''}</div>` : ''}
      ${p.address ? `<div>${esc(p.address)}</div>` : ''}${d.ship_to && d.ship_to !== p.address ? `<div class="sm">${esc(t('Deliver to'))}: ${esc(d.ship_to)}</div>` : ''}
      ${d.deliver_to ? `<div class="sm">${esc(t('Deliver to'))}: ${esc(d.deliver_to)}</div>` : ''}
      <div class="muted">${esc([p.code, p.phone, p.email].filter(Boolean).join(' · '))}</div></div>` : '<div></div>'
  const det = `<div class="box"><div class="kv">${details(d).map(([k, v]) => `<span>${esc(k)}</span><span>${esc(v)}</span>`).join('')}</div></div>`
  const top = `<div class="top${s.logo_position === 'right' ? ' rev' : ''}">${companyBlock(d)}<div class="title"><h1>${esc(docTitle(d))}</h1><div class="no">${esc(d.number)}</div></div></div>`
  const words = s.show_words && getLocale() === 'sq' ? `<div class="words">${esc(t('In words'))}: ${esc(amountInWords(isVoucher(d) ? d.total : d.total, d.currency))}</div>` : ''
  const docText = d.company.settings?.texts?.[textKey(d)]
  const notes = [d.terms, d.notes, docText].filter(Boolean).map((x) => `<div class="notes">${esc(x)}</div>`).join('')
  const banks = s.show_banks && d.company.banks.length && ['sales_invoice', 'proforma', 'sales_quote', 'sales_order'].includes(d.kind)
    ? `<div class="banks"><b>${esc(t('Bank accounts'))}:</b> ${d.company.banks.map((b) => esc(`${b.bank} · ${b.iban}${b.swift ? ` · ${b.swift}` : ''}${b.currency !== d.company.base_currency ? ` (${b.currency})` : ''}`)).join('<br>')}</div>` : ''
  const fiscal = d.fiscal?.fic ? `<div class="fiscal">NIVF: ${esc(d.fiscal.iic)} · NSLF: ${esc(d.fiscal.fic)}${d.fiscal.tcr ? ` · TCR: ${esc(d.fiscal.tcr)}` : ''}${d.fiscal.business_unit ? ` · ${esc(t('Business unit'))}: ${esc(d.fiscal.business_unit)}` : ''}${d.fiscal.operator ? ` · ${esc(t('Operator'))}: ${esc(d.fiscal.operator)}` : ''}</div>` : ''
  const [signL, signR] = isVoucher(d) ? [d.kind === 'receipt_voucher' ? t('Received by') : t('Paid by'), d.kind === 'receipt_voucher' ? t('Paid by') : t('Received by')]
    : d.kind === 'goods_receipt' ? [t('Delivered by'), t('Received by')] : [t('Issued by'), t('Received by')]
  const sign = s.show_signatures ? `<div class="sign"><div>${esc(signL)}</div><div>${esc(signR)}</div></div>` : ''
  const foot = `<div class="foot"><span>${esc(d.company.footer || s.footer || '')}</span><span>${esc(t('Printed {date}', { date: formatDate(d.printed_at, true) }))}${d.printed_by ? ` · ${esc(d.printed_by)}` : ''}</span></div>`

  if (isVoucher(d)) {
    const body = `${top}<div class="boxes">${partner}${det}</div>
      <div class="vbox"><div class="amount">${esc(nf(d.total, dec))} ${esc(d.currency)}</div>${words}
        <div class="kv" style="margin-top:6px"><span>${esc(t('Method'))}</span><span>${esc(t(METHOD[d.method ?? ''] ?? METHOD.bank_transfer))}</span>
        ${d.account ? `<span>${esc(d.cash ? t('Cash box|print') : t('Account'))}</span><span>${esc(d.account)}</span>` : ''}
        ${d.reference ? `<span>${esc(t('Reference'))}</span><span>${esc(d.reference)}</span>` : ''}</div></div>
      ${d.allocations?.length ? `<table class="l" style="margin-top:12px"><thead><tr><th>${esc(t('For document'))}</th><th>${esc(t('Date'))}</th><th class="r">${esc(t('Amount'))}</th></tr></thead><tbody>
        ${d.allocations.map((a) => `<tr><td>${esc(a.number)}${a.reference ? ` <span class="sm">(${esc(a.reference)})</span>` : ''}</td><td>${esc(formatDate(a.date))}</td><td class="r">${esc(nf(a.amount, dec))}</td></tr>`).join('')}
        ${d.unallocated ? `<tr><td colspan="2">${esc(t('In advance'))}</td><td class="r">${esc(nf(d.unallocated, dec))}</td></tr>` : ''}</tbody></table>` : ''}
      ${notes}${sign}${foot}`
    return { body, css: docCss(s.accent) }
  }

  const codes = s.show_codes, disc = s.show_discount && prices && d.lines.some((l) => Number(l.discount) > 0)
  const vatCols = d.kind !== 'goods_receipt'   // a goods received note shows cost, without VAT
  const lots = d.lines.some((l) => l.lot)
  const head = `<tr><th class="c" style="width:26px">#</th>${codes ? `<th>${esc(t('Code'))}</th>` : ''}<th>${esc(t('Description'))}</th>${lots ? `<th>${esc(t('Lot'))}</th>` : ''}
    <th>${esc(t('Unit'))}</th><th class="r">${esc(t('Qty'))}</th>
    ${prices ? `<th class="r">${esc(vatCols ? t('Price') : t('Cost'))}</th>${disc ? `<th class="r">${esc(t('Disc.'))}</th>` : ''}${vatCols ? `<th class="r">${esc(t('VAT'))}</th>` : ''}<th class="r">${esc(vatCols ? t('Without VAT') : t('Value'))}</th>${vatCols ? `<th class="r">${esc(t('With VAT'))}</th>` : ''}` : ''}</tr>`
  const rows = d.lines.map((l, i) => `<tr><td class="c">${i + 1}</td>${codes ? `<td>${esc(l.code)}</td>` : ''}<td>${esc(l.description)}</td>${lots ? `<td>${esc(l.lot)}</td>` : ''}
    <td>${esc(l.uom)}</td><td class="r">${esc(qf(l.qty))}</td>
    ${prices ? `<td class="r">${esc(nf(l.price, Math.max(dec, 2)))}</td>${disc ? `<td class="r">${esc(pf(l.discount))}</td>` : ''}${vatCols ? `<td class="r">${esc(pf(l.tax_rate) || '0%')}</td>` : ''}<td class="r">${esc(nf(l.net, dec))}</td>${vatCols ? `<td class="r">${esc(nf(l.total, dec))}</td>` : ''}` : ''}</tr>`).join('')
  const vat = prices && vatCols && d.vat.length ? `<table class="v"><thead><tr><th>${esc(t('VAT rate'))}</th><th>${esc(t('Base'))}</th><th>${esc(t('VAT'))}</th></tr></thead><tbody>
      ${d.vat.map((v) => `<tr><td>${esc(pf(v.rate) || '0%')}</td><td>${esc(nf(v.base, dec))}</td><td>${esc(nf(v.tax, dec))}</td></tr>`).join('')}</tbody></table>` : '<div></div>'
  const tot = prices && !vatCols ? `<div class="tot"><div class="big"><span>${esc(t('Value'))}</span><span>${esc(nf(d.total, dec))} ${esc(d.currency)}</span></div></div>`
    : prices ? `<div class="tot">
      ${d.discount_total ? `<div><span>${esc(t('Discount'))}</span><span>${esc(nf(d.discount_total, dec))}</span></div>` : ''}
      <div><span>${esc(t('Without VAT'))}</span><span>${esc(nf(d.subtotal, dec))}</span></div>
      <div><span>${esc(t('VAT'))}</span><span>${esc(nf(d.tax_total, dec))}</span></div>
      <div class="big"><span>${esc(t('Total'))}</span><span>${esc(nf(d.total, dec))} ${esc(d.currency)}</span></div>
      ${d.kind === 'sales_invoice' && d.paid ? `<div><span>${esc(t('Paid'))}</span><span>${esc(nf(d.paid, dec))}</span></div><div><b>${esc(t('Still to pay'))}</b><b>${esc(nf(d.due, dec))}</b></div>` : ''}
      ${d.currency !== d.company.base_currency && d.total_base ? `<div class="sm"><span>${esc(t('In {currency}', { currency: d.company.base_currency }))}</span><span>${esc(nf(d.total_base, dec))}</span></div>` : ''}
    </div>` : `<div class="tot"><div><span>${esc(t('Lines'))}</span><span>${d.lines.length}</span></div><div><span>${esc(t('Total quantity'))}</span><span>${esc(qf(d.lines.reduce((a, l) => a + Number(l.qty), 0)))}</span></div></div>`
  const body = `${top}<div class="boxes">${partner}${det}</div>
    <table class="l"><thead>${head}</thead><tbody>${rows}</tbody></table>
    <div class="bottom">${vat}${tot}</div>${prices && vatCols ? words : ''}${notes}${banks}${fiscal}${sign}${foot}`
  return { body, css: docCss(s.accent) }
}
