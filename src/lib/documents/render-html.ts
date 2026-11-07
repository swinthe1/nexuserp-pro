/** A printed document as an A4 HTML page (printing goes through printHtml). */
import { getLocale, t, td } from '@/i18n'
import { formatDate, formatMoney } from '@/lib/utils'
import { BANK_KINDS, METHOD, amountInWords, docTitle, isVoucher, partnerLabel, type PrintDoc, settingsOf, showPrices, textKey, unitWithVat } from './model'

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
const nf = (n: number | null | undefined, d = 2) => n == null ? '' : Number(n).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d })
const qf = (n: number | null | undefined) => n == null ? '' : Number(n).toLocaleString('de-DE', { maximumFractionDigits: 4 })
const pf = (n: number | null | undefined) => n == null || Number(n) === 0 ? '' : `${Number(n).toLocaleString('de-DE', { maximumFractionDigits: 2 })}%`

export function docCss(accent: string) {
  return `@page{size:A4;margin:14mm 12mm 14mm 12mm}
*{box-sizing:border-box}body{font-family:Inter,'Segoe UI',Arial,sans-serif;font-size:10.5px;color:#1a1d24;margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.top{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;padding-bottom:12px;border-bottom:2px solid ${accent}}
.top.rev{flex-direction:row-reverse}.co{display:flex;gap:12px;align-items:flex-start}.co img{max-height:var(--logo-h,64px);max-width:calc(var(--logo-h,64px) * 2.7);object-fit:contain}
.co b{font-size:14px;display:block;margin-bottom:2px}.muted{color:#5b6170}.co div div{line-height:1.45}
.pk{font-size:8.5px;color:#5b6170;white-space:nowrap}
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
.sign{display:grid;grid-template-columns:1fr 1fr;gap:60px;margin-top:38px}.sign div{border-top:1px solid #8a8f9c;padding-top:4px;text-align:center;color:#5b6170;font-size:9.5px;position:relative}.sign div.nostroke{border-top:0}.sign.has-stamp{margin-top:84px}
.stamp{position:absolute;left:50%;bottom:100%;transform:translateX(-50%);max-height:80px;max-width:160px;object-fit:contain;margin-bottom:-14px;mix-blend-mode:multiply}.has-sig .stamp{transform:translateX(-18%)}
.sigimg{position:absolute;left:50%;bottom:100%;transform:translateX(-62%);max-height:56px;max-width:170px;object-fit:contain;margin-bottom:-8px;mix-blend-mode:multiply;z-index:1}.signer{display:block;color:#1f2430;font-size:9.5px;margin-top:1px}
.foot{margin-top:18px;padding-top:6px;border-top:1px solid #e6e8ee;font-size:9px;color:#6b7080;display:flex;justify-content:space-between;gap:12px}
.amount{font-size:22px;font-weight:700;color:${accent}}.vbox{border:1px solid #d9dce3;border-radius:6px;padding:12px 14px;margin-top:14px;line-height:1.7}
tr{page-break-inside:avoid}
/* the simple layout: ink and hairlines, four columns */
.t-s .top{border-bottom:1px solid #1a1d24}.t-s .title h1{color:#1a1d24;font-size:24px;font-weight:700}
.t-s .meta{display:grid;grid-template-columns:1.2fr 1fr;gap:18px;margin:16px 0 12px;line-height:1.55}.t-s .lbl{font-size:9px;text-transform:uppercase;letter-spacing:.6px;color:#5b6170;font-weight:600;margin-bottom:2px}.t-s .meta b{font-size:12.5px}
.t-s table.l th{background:none;color:#5b6170;font-size:9px;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #1a1d24;padding:6px 4px}
.t-s table.l td{padding:7px 4px;border-bottom:1px solid #eceef2}.t-s table.l tr:nth-child(even) td{background:none}.t-s .code{display:block;font-size:8.5px;color:#7a8090}
.t-s .bottom{grid-template-columns:1fr 230px}.t-s .tot{border:0;padding:0}.t-s .tot .big{border-top:1px solid #1a1d24;color:#1a1d24}.t-s .vatline{font-size:9px;color:#5b6170;line-height:1.6}
/* the detailed layout: a band in the colour, three boxes, every figure of every line */
.t-d .band{display:flex;justify-content:space-between;align-items:center;gap:18px;background:${accent};color:#fff;border-radius:8px;padding:14px 16px}.t-d .band.rev{flex-direction:row-reverse}
.t-d .band .co{align-items:center}.t-d .band .co img{background:#fff;border-radius:6px;padding:4px}.t-d .band .co b{font-size:15px}.t-d .band .title{text-align:right}.t-d .band.rev .title{text-align:left}
.t-d .band h1{margin:0;font-size:22px;letter-spacing:.3px;color:#fff}.t-d .band .no{font-size:13px;font-weight:600;opacity:.95}.t-d .band .dt{font-size:10px;opacity:.85}
.t-d .strip{font-size:9px;color:#5b6170;padding:6px 2px 0;line-height:1.5}
.t-d .boxes{grid-template-columns:1.15fr 1fr 1fr;gap:10px}.t-d .box{background:#fafbfc}
.t-d table.l th{font-size:8.5px;padding:5px 4px}.t-d table.l td{padding:4px 4px;font-size:9.5px}.t-d .sub{font-size:8.5px;color:#5b6170}
.t-d .sum{font-size:9px;color:#5b6170;margin-top:4px;text-align:right}
.t-d .bottom{grid-template-columns:1fr 260px}.t-d .pay{border:1px solid #d9dce3;border-radius:6px;padding:8px 10px;margin-top:10px}.t-d .pay .lbl{font-size:9px;text-transform:uppercase;letter-spacing:.6px;color:${accent};font-weight:600;margin-bottom:4px}
.t-d table.b{width:100%;border-collapse:collapse;font-size:9px}.t-d table.b th{text-align:left;color:#5b6170;font-weight:500;border-bottom:1px solid #d9dce3;padding:2px 4px}.t-d table.b td{padding:2px 4px}
.t-d .due{margin-top:6px;background:${accent};color:#fff;border-radius:6px;padding:8px 11px;display:flex;justify-content:space-between;font-size:13px;font-weight:700}
`
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
    [t('Instalments'), d.instalments?.length ? d.instalments.map((x) => `${formatDate(x.due_date)}: ${formatMoney(x.amount)}`).join(' · ') : null],
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
  const top = `<div class="top${s.logo_position === 'right' ? ' rev' : ''}" style="--logo-h:${s.logo_size === 's' ? 44 : s.logo_size === 'l' ? 88 : 64}px">${companyBlock(d)}<div class="title"><h1>${esc(docTitle(d))}</h1><div class="no">${esc(d.number)}</div></div></div>`
  const words = s.show_words && getLocale() === 'sq' ? `<div class="words">${esc(t('In words'))}: ${esc(amountInWords(isVoucher(d) ? d.total : d.total, d.currency))}</div>` : ''
  const docText = d.company.settings?.texts?.[textKey(d)]
  const notes = [d.terms, d.notes, docText].filter(Boolean).map((x) => `<div class="notes">${esc(x)}</div>`).join('')
  const banks = s.show_banks && d.company.banks.length && BANK_KINDS.includes(d.kind)
    ? `<div class="banks"><b>${esc(t('Bank accounts'))}:</b>${s.banks_layout === 'row' ? ' ' : '<br>'}${d.company.banks.map((b) => esc(`${b.bank} · ${b.iban}${b.swift && s.show_swift ? ` · SWIFT ${b.swift}` : ''}${b.currency !== d.company.base_currency ? ` (${b.currency})` : ''}`)).join(s.banks_layout === 'row' ? ' &nbsp;|&nbsp; ' : '<br>')}</div>` : ''
  const fiscal = d.fiscal?.fic ? `<div class="fiscal">NIVF: ${esc(d.fiscal.iic)} · NSLF: ${esc(d.fiscal.fic)}${d.fiscal.tcr ? ` · TCR: ${esc(d.fiscal.tcr)}` : ''}${d.fiscal.business_unit ? ` · ${esc(t('Business unit'))}: ${esc(d.fiscal.business_unit)}` : ''}${d.fiscal.operator ? ` · ${esc(t('Operator'))}: ${esc(d.fiscal.operator)}` : ''}</div>` : ''
  const [signL, signR] = isVoucher(d) ? [d.kind === 'receipt_voucher' ? t('Received by') : t('Paid by'), d.kind === 'receipt_voucher' ? t('Paid by') : t('Received by')]
    : d.kind === 'goods_receipt' ? [t('Delivered by'), t('Received by')] : [t('Issued by'), t('Received by')]
  const stamp = s.show_stamp && d.company.stamp && !isVoucher(d) && d.kind !== 'goods_receipt' ? `<img class="stamp" src="${esc(d.company.stamp)}" alt="">` : ''
  const sig = d.signature ? `<img class="sigimg" src="${esc(d.signature.image)}" alt="">` : ''
  const signer = d.signature ? `<span class="signer">${esc(d.signature.name)}${d.signature.title ? `, ${esc(d.signature.title)}` : ''}</span>` : ''
  const sign = s.show_signatures || d.signature
    ? `<div class="sign${stamp || sig ? ' has-stamp' : ''}${sig ? ' has-sig' : ''}"><div>${stamp}${sig}${esc(signL)}${signer}</div><div>${s.show_signatures ? esc(signR) : ''}</div></div>`
    : stamp ? `<div class="sign has-stamp"><div class="nostroke">${stamp}</div><div class="nostroke"></div></div>` : ''
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

  if (s.template === 'simple') return { body: `<div class="t-s">${simpleBody(d, { top, words, notes, banks, fiscal, sign, foot })}</div>`, css: docCss(s.accent) } // i18n-ignore
  if (s.template === 'detailed') return { body: `<div class="t-d">${detailedBody(d, { words, notes, fiscal, sign, foot })}</div>`, css: docCss(s.accent) } // i18n-ignore

  const codes = s.show_codes, disc = s.show_discount && prices && d.lines.some((l) => Number(l.discount) > 0)
  const vatCols = d.kind !== 'goods_receipt'   // a goods received note shows cost, without VAT
  const lots = d.lines.some((l) => l.lot)
  const head = `<tr><th class="c" style="width:26px">#</th>${codes ? `<th>${esc(t('Code'))}</th>` : ''}<th>${esc(t('Description'))}</th>${lots ? `<th>${esc(t('Lot'))}</th>` : ''}
    <th>${esc(t('Unit'))}</th><th class="r">${esc(t('Qty'))}</th>
    ${prices ? `<th class="r">${esc(vatCols ? t('Price') : t('Cost'))}</th>${disc ? `<th class="r">${esc(t('Disc.'))}</th>` : ''}${vatCols ? `<th class="r">${esc(t('VAT'))}</th>` : ''}<th class="r">${esc(vatCols ? t('Without VAT') : t('Value'))}</th>${vatCols ? `<th class="r">${esc(t('With VAT'))}</th>` : ''}` : ''}</tr>`
  const rows = d.lines.map((l, i) => `<tr><td class="c">${i + 1}</td>${codes ? `<td>${esc(l.code)}</td>` : ''}<td>${esc(l.description)}</td>${lots ? `<td>${esc(l.lot)}</td>` : ''}
    <td>${esc(l.uom ? td(l.uom) : '')}</td><td class="r">${esc(qf(l.qty))}${l.pack ? `<div class="pk">${esc(l.pack)}</div>` : ''}</td>
    ${prices ? `<td class="r">${esc(nf(l.price, Math.max(dec, 2)))}</td>${disc ? `<td class="r">${esc(pf(l.discount))}</td>` : ''}${vatCols ? `<td class="r">${esc(pf(l.tax_rate) || '0%')}</td>` : ''}<td class="r">${esc(nf(l.net, dec))}</td>${vatCols ? `<td class="r">${esc(nf(l.total, dec))}</td>` : ''}` : ''}</tr>`).join('')
  const vat = prices && vatCols && d.vat.length ? `<table class="v"><thead><tr><th>${esc(t('VAT rate'))}</th><th>${esc(t('Base'))}</th><th>${esc(t('VAT'))}</th></tr></thead><tbody>
      ${d.vat.map((v) => `<tr><td>${esc(pf(v.rate) || '0%')}</td><td>${esc(nf(v.base, dec))}</td><td>${esc(nf(v.tax, dec))}</td></tr>`).join('')}</tbody></table>` : '<div></div>'
  const tot = prices && !vatCols ? `<div class="tot"><div class="big"><span>${esc(t('Value'))}</span><span>${esc(nf(d.total, dec))} ${esc(d.currency)}</span></div></div>`
    : prices ? `<div class="tot">
      ${d.discount_total ? `<div><span>${esc(t('Discount'))}</span><span>${esc(nf(d.discount_total, dec))}</span></div>` : ''}
      <div><span>${esc(t('Without VAT'))}</span><span>${esc(nf(d.subtotal, dec))}</span></div>
      <div><span>${esc(t('VAT'))}</span><span>${esc(nf(d.tax_total, dec))}</span></div>
      <div class="big"><span>${esc(t('Total'))}</span><span>${esc(nf(d.total, dec))} ${esc(d.currency)}</span></div>
      ${(d.kind === 'sales_invoice' || d.kind === 'advance_invoice') && d.paid ? `<div><span>${esc(t('Paid'))}</span><span>${esc(nf(d.paid, dec))}</span></div><div><b>${esc(t('Still to pay'))}</b><b>${esc(nf(d.due, dec))}</b></div>` : ''}
      ${d.currency !== d.company.base_currency && d.total_base ? `<div class="sm"><span>${esc(t('In {currency}', { currency: d.company.base_currency }))}</span><span>${esc(nf(d.total_base, dec))}</span></div>` : ''}
    </div>` : `<div class="tot"><div><span>${esc(t('Lines'))}</span><span>${d.lines.length}</span></div><div><span>${esc(t('Total quantity'))}</span><span>${esc(qf(d.lines.reduce((a, l) => a + Number(l.qty), 0)))}</span></div></div>`
  const body = `${top}<div class="boxes">${partner}${det}</div>
    <table class="l"><thead>${head}</thead><tbody>${rows}</tbody></table>
    <div class="bottom">${vat}${tot}</div>${prices && vatCols ? words : ''}${notes}${banks}${fiscal}${sign}${foot}`
  return { body, css: docCss(s.accent) }
}

type Parts = { top?: string; words: string; notes: string; banks?: string; fiscal: string; sign: string; foot: string }

/** the plainest: who, when, and per line only the description, quantity, price and total (with VAT) */
function simpleBody(d: PrintDoc, x: Parts) {
  const s = settingsOf(d), prices = showPrices(d), dec = d.company.decimals ?? 2, p = d.partner
  const det = details(d).filter(([k]) => [t('Date'), t('Due date'), t('Valid until'), t('Payment terms'), t('Order'), t('Your reference'), t('Currency'), t('Expected on')].includes(k))
  const meta = `<div class="meta"><div>${p ? `<div class="lbl">${esc(partnerLabel(d))}</div><b>${esc(p.legal_name || p.name)}</b>
      ${p.tax_number ? `<div>${esc(t('NIPT/NUI'))} ${esc(p.tax_number)}</div>` : ''}${p.address ? `<div>${esc(p.address)}</div>` : ''}` : ''}</div>
    <div class="kv">${det.map(([k, v]) => `<span>${esc(k)}</span><span>${esc(v)}</span>`).join('')}</div></div>`
  const head = `<tr><th>${esc(t('Description'))}</th><th class="r">${esc(t('Qty'))}</th>${prices ? `<th class="r">${esc(t('Price with VAT'))}</th><th class="r">${esc(t('Total'))}</th>` : ''}</tr>`
  const rows = d.lines.map((l) => `<tr><td>${esc(l.description)}${s.show_codes && l.code ? `<span class="code">${esc(l.code)}</span>` : ''}</td>
    <td class="r">${esc(qf(l.qty))} ${esc(l.uom ? td(l.uom) : '')}</td>${prices ? `<td class="r">${esc(nf(unitWithVat(l), Math.max(dec, 2)))}</td><td class="r">${esc(nf(l.total, dec))}</td>` : ''}</tr>`).join('')
  const vatLine = prices && d.vat.length ? `<div class="vatline">${esc(t('VAT'))}: ${d.vat.map((v) => esc(`${pf(v.rate) || '0%'} · ${t('Base')} ${nf(v.base, dec)} · ${t('VAT')} ${nf(v.tax, dec)}`)).join('<br>')}</div>` : '<div></div>'
  const tot = prices ? `<div class="tot"><div><span>${esc(t('Without VAT'))}</span><span>${esc(nf(d.subtotal, dec))}</span></div><div><span>${esc(t('VAT'))}</span><span>${esc(nf(d.tax_total, dec))}</span></div>
      <div class="big"><span>${esc(t('Total'))}</span><span>${esc(nf(d.total, dec))} ${esc(d.currency)}</span></div>
      ${(d.kind === 'sales_invoice' || d.kind === 'advance_invoice') && d.paid ? `<div><span>${esc(t('Still to pay'))}</span><b>${esc(nf(d.due, dec))}</b></div>` : ''}</div>` : '<div></div>'
  return `${x.top}${meta}<table class="l"><thead>${head}</thead><tbody>${rows}</tbody></table><div class="bottom">${vatLine}${tot}</div>${prices ? x.words : ''}${x.notes}${x.banks}${x.fiscal}${x.sign}${x.foot}`
}

/** every detail: the band, three boxes, base and VAT per line, how to pay with the bank accounts in a table */
function detailedBody(d: PrintDoc, x: Parts) {
  const s = settingsOf(d), prices = showPrices(d), dec = d.company.decimals ?? 2, p = d.partner, c = d.company
  const vatCols = d.kind !== 'goods_receipt'
  const band = `<div class="band${s.logo_position === 'right' ? ' rev' : ''}" style="--logo-h:${s.logo_size === 's' ? 36 : s.logo_size === 'l' ? 64 : 48}px">
    <div class="co">${c.logo ? `<img src="${esc(c.logo)}" alt="">` : ''}<div><b>${esc(c.legal_name || c.name)}</b></div></div>
    <div class="title"><h1>${esc(docTitle(d))}</h1><div class="no">${esc(d.number)}</div><div class="dt">${esc(formatDate(d.date))}</div></div></div>`
  const strip = `<div class="strip">${esc([c.tax_number && `${t('NIPT/NUI')} ${c.tax_number}`, c.vat_number && `${t('VAT no.')} ${c.vat_number}`, c.business_number && `${t('Business no.')} ${c.business_number}`,
    c.address, c.phone, c.email, c.website].filter(Boolean).join(' · '))}</div>`
  const party = p ? `<div class="box"><div class="lbl">${esc(partnerLabel(d))}</div><b>${esc(p.legal_name || p.name)}</b>
      ${p.legal_name && p.legal_name !== p.name ? `<div class="sub">${esc(p.name)}</div>` : ''}
      ${p.tax_number ? `<div>${esc(t('NIPT/NUI'))} ${esc(p.tax_number)}</div>` : ''}${p.vat_number ? `<div>${esc(t('VAT no.'))} ${esc(p.vat_number)}</div>` : ''}
      ${p.address ? `<div>${esc(p.address)}</div>` : ''}<div class="muted">${esc([p.code, p.phone, p.email].filter(Boolean).join(' · '))}</div></div>` : '<div class="box"></div>'
  const shipping = [d.carrier && `${t('Carrier')}: ${[d.carrier, d.tracking].filter(Boolean).join(' · ')}`, d.packages && `${t('Packages')}: ${d.packages}`,
    d.weight && `${t('Weight')}: ${qf(d.weight)} kg`, d.incoterm && `${t('Delivery terms')}: ${d.incoterm}`, d.warehouse && `${t('Warehouse')}: ${d.warehouse}`].filter(Boolean) as string[]
  const deliver = `<div class="box"><div class="lbl">${esc(t('Delivery address'))}</div><div>${esc(d.ship_to || d.deliver_to || p?.address || '—')}</div>
      ${shipping.map((v) => `<div class="sub">${esc(v)}</div>`).join('')}</div>`
  const docBox = `<div class="box"><div class="lbl">${esc(t('Document'))}</div><div class="kv">${details(d).filter(([k]) => k !== t('Warehouse') && k !== t('Carrier') && k !== t('Packages') && k !== t('Delivery terms'))
    .map(([k, v]) => `<span>${esc(k)}</span><span>${esc(v)}</span>`).join('')}</div></div>`
  const lots = d.lines.some((l) => l.lot), disc = prices && d.lines.some((l) => Number(l.discount) > 0)
  const head = `<tr><th class="c" style="width:22px">#</th>${s.show_codes ? `<th>${esc(t('Code'))}</th>` : ''}<th>${esc(t('Description'))}</th>${lots ? `<th>${esc(t('Lot'))}</th>` : ''}<th>${esc(t('Unit'))}</th><th class="r">${esc(t('Qty'))}</th>
    ${prices ? `<th class="r">${esc(vatCols ? t('Price without VAT') : t('Cost'))}</th>${disc ? `<th class="r">${esc(t('Disc.'))}</th>` : ''}<th class="r">${esc(vatCols ? t('Base') : t('Value'))}</th>
      ${vatCols ? `<th class="r">${esc(t('VAT'))} %</th><th class="r">${esc(t('VAT amount'))}</th><th class="r">${esc(t('Total'))}</th>` : ''}` : ''}</tr>`
  const rows = d.lines.map((l, i) => `<tr><td class="c">${i + 1}</td>${s.show_codes ? `<td>${esc(l.code)}</td>` : ''}<td>${esc(l.description)}${l.expected ? `<div class="sub">${esc(l.expected)}</div>` : ''}</td>
    ${lots ? `<td>${esc(l.lot)}</td>` : ''}<td>${esc(l.uom ? td(l.uom) : '')}</td><td class="r">${esc(qf(l.qty))}${l.pack ? `<div class="pk">${esc(l.pack)}</div>` : ''}</td>
    ${prices ? `<td class="r">${esc(nf(l.price, Math.max(dec, 2)))}</td>${disc ? `<td class="r">${esc(pf(l.discount))}</td>` : ''}<td class="r">${esc(nf(l.net, dec))}</td>
      ${vatCols ? `<td class="r">${esc(pf(l.tax_rate) || '0%')}</td><td class="r">${esc(nf(l.tax, dec))}</td><td class="r"><b>${esc(nf(l.total, dec))}</b></td>` : ''}` : ''}</tr>`).join('')
  const sum = `<div class="sum">${esc(t('Lines'))}: ${d.lines.length} · ${esc(t('Total quantity'))}: ${esc(qf(d.lines.reduce((a, l) => a + Number(l.qty), 0)))}</div>`
  const vat = prices && vatCols && d.vat.length ? `<table class="v"><thead><tr><th>${esc(t('VAT rate'))}</th><th>${esc(t('Base'))}</th><th>${esc(t('VAT'))}</th><th>${esc(t('Total'))}</th></tr></thead><tbody>
      ${d.vat.map((v) => `<tr><td>${esc(pf(v.rate) || '0%')}</td><td>${esc(nf(v.base, dec))}</td><td>${esc(nf(v.tax, dec))}</td><td>${esc(nf(Number(v.base) + Number(v.tax), dec))}</td></tr>`).join('')}</tbody></table>` : ''
  const showBanks = s.show_banks && c.banks.length && BANK_KINDS.includes(d.kind)
  const isInvoice = d.kind === 'sales_invoice' || d.kind === 'advance_invoice' || d.kind === 'proforma'
  const pay = prices && (showBanks || isInvoice) ? `<div class="pay"><div class="lbl">${esc(t('How to pay'))}</div>
      ${showBanks ? `<table class="b"><thead><tr><th>${esc(t('Bank'))}</th><th>IBAN</th>${s.show_swift ? '<th>SWIFT</th>' : ''}<th>${esc(t('Currency'))}</th></tr></thead><tbody>
        ${c.banks.map((b) => `<tr><td>${esc(b.bank)}</td><td>${esc(b.iban)}</td>${s.show_swift ? `<td>${esc(b.swift ?? '')}</td>` : ''}<td>${esc(b.currency)}</td></tr>`).join('')}</tbody></table>` : ''}
      ${isInvoice ? `<div style="margin-top:5px">${esc(t('Payment reference'))}: <b>${esc(d.number)}</b>${d.due_date ? ` · ${esc(t('Due date'))}: <b>${esc(formatDate(d.due_date))}</b>` : ''}</div>` : ''}
      ${d.instalments?.length ? `<div class="sub" style="margin-top:3px">${esc(t('Instalments'))}: ${esc(d.instalments.map((x) => `${formatDate(x.due_date)}: ${nf(x.amount, dec)}`).join(' · '))}</div>` : ''}</div>` : ''
  const gross = Number(d.subtotal ?? 0) + Number(d.discount_total ?? 0)
  const owes = (d.kind === 'sales_invoice' || d.kind === 'advance_invoice') && d.paid
  const tot = !prices ? `<div class="tot"><div><span>${esc(t('Lines'))}</span><span>${d.lines.length}</span></div><div><span>${esc(t('Total quantity'))}</span><span>${esc(qf(d.lines.reduce((a, l) => a + Number(l.qty), 0)))}</span></div></div>`
    : !vatCols ? `<div class="tot"><div class="big"><span>${esc(t('Value'))}</span><span>${esc(nf(d.total, dec))} ${esc(d.currency)}</span></div></div>`
    : `<div><div class="tot">
      ${d.discount_total ? `<div><span>${esc(t('Before discount'))}</span><span>${esc(nf(gross, dec))}</span></div><div><span>${esc(t('Discount'))}</span><span>−${esc(nf(d.discount_total, dec))}</span></div>` : ''}
      <div><span>${esc(t('Without VAT'))}</span><span>${esc(nf(d.subtotal, dec))}</span></div>
      ${d.vat.map((v) => `<div class="sm"><span>${esc(t('VAT'))} ${esc(pf(v.rate) || '0%')}</span><span>${esc(nf(v.tax, dec))}</span></div>`).join('')}
      <div><span>${esc(t('VAT'))}</span><span>${esc(nf(d.tax_total, dec))}</span></div>
      <div class="big"><span>${esc(t('Total'))}</span><span>${esc(nf(d.total, dec))} ${esc(d.currency)}</span></div>
      ${owes ? `<div><span>${esc(t('Paid'))}</span><span>${esc(nf(d.paid, dec))}</span></div>` : ''}
      ${d.currency !== c.base_currency && d.total_base ? `<div class="sm"><span>${esc(t('In {currency}', { currency: c.base_currency }))}</span><span>${esc(nf(d.total_base, dec))}</span></div>` : ''}
    </div>${isInvoice ? `<div class="due"><span>${esc(t('Still to pay'))}</span><span>${esc(nf(owes ? d.due : d.total, dec))} ${esc(d.currency)}</span></div>` : ''}</div>`
  return `${band}${strip}<div class="boxes">${party}${deliver}${docBox}</div>
    <table class="l"><thead>${head}</thead><tbody>${rows}</tbody></table>${sum}
    <div class="bottom"><div>${vat}${prices && vatCols ? x.words : ''}${pay}</div>${tot}</div>${x.notes}${x.fiscal}${x.sign}${x.foot}`
}
