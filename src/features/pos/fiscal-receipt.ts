/**
 * The fiscal coupon on paper, as ATK lays it out (Kërkesat specifike…, neni 25.18 and Shtojca F; UA 01/2026, neni 7):
 * the taxpayer and the store at the head, the worker, the lines with their VAT letter and discounts with a minus,
 * the total, the payments, the VAT by rate, the total without VAT, the coupon's numbers, the QR code, the RKS MF logo,
 * "e-kuponi" and the free text. Everything comes from the coupon as it was signed, so a copy prints the same.
 */
import { formatDateWith, formatNumberWith, t } from '@/i18n'
import { CouponType, PaymentType, type PosCoupon } from '@/lib/atk/proto'
import { RATE_OF, type CouponPrint } from '@/lib/atk/coupon'
import { qrSvg } from './atk'
import { RKS_LOGO } from './rks-logo'

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
/** a total in cents, with the euro sign */
const eur = (cents: number) => `${formatNumberWith(cents / 100, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
/** a unit price in ten-thousandths: two decimals at least, four at most */
const unitPrice = (p: number) => formatNumberWith(p / 10000, { minimumFractionDigits: 2, maximumFractionDigits: 4 })
const qtyText = (q: number) => formatNumberWith(Math.round(q * 10000) / 10000, { maximumFractionDigits: 4 })

export type FiscalHeader = { legal_name: string; store: string | null; store_address: string | null; city: string | null; phone: string | null; vat_number: string | null }
export interface FiscalPrint {
  env: 'test' | 'production'
  nui: string
  header: FiscalHeader
  operator: string
  operatorNo?: string | null
  coupon: PosCoupon
  qr: string
  /** the till's count of the day */
  dailyNo?: number | null
  /** a cancellation says why */
  reason?: string | null
  /** made, or printed, before ATK took it */
  offline?: boolean
  /** printed again: "KOPJE E KUPONIT" */
  copy?: boolean
  /** cash given back, in cents */
  change?: number
  footer?: string | null
  /** registered from the fiscal receipt book */
  blockNo?: string | null
  /** the shelf prices and how the discounts were given (ATK's coupon carries the prices with the discount in them) */
  print?: CouponPrint | null
}

const PAY: Record<number, string> = { [PaymentType.Cash]: 'CASH', [PaymentType.CreditCard]: 'CARD', [PaymentType.Voucher]: 'VOUCHER', [PaymentType.Cheque]: 'CHEQUE',
  [PaymentType.CryptoCurrency]: 'CRYPTO', [PaymentType.Other]: 'OTHER' }
const payName = (k: number) => ({ CASH: t('CASH|fiscal'), CARD: t('CARD|fiscal'), VOUCHER: t('VOUCHER|fiscal'), CHEQUE: t('CHEQUE|fiscal'),
  CRYPTO: t('CRYPTO|fiscal'), OTHER: t('OTHER|fiscal') } as Record<string, string>)[PAY[k] ?? 'OTHER']!

/** ATK allows thermal paper 58–100 mm wide; each till says which it has (58 or 80) */
export type Paper = 58 | 80
export const paperOf = (mm: number | null | undefined): Paper => (mm === 58 ? 58 : 80)
export const fiscalCss = (mm: Paper = 80) => mm === 58
  ? FISCAL_CSS.replace('size:80mm auto;margin:3mm 4mm', 'size:58mm auto;margin:2mm 2mm').replace('font:11.5px/1.35', 'font:10px/1.3').replace('width:72mm', 'width:54mm')
      .replace('.title{font-size:17px', '.title{font-size:14px').replace('.big{font-size:15px}', '.big{font-size:13px}').replace('.qr svg{width:40mm;height:40mm}', '.qr svg{width:34mm;height:34mm}')
      .replace('.logo{height:10mm', '.logo{height:8mm')
  : FISCAL_CSS
export const FISCAL_CSS = `@page{size:80mm auto;margin:3mm 4mm} *{box-sizing:border-box} body{margin:0;font:11.5px/1.35 Arial,Helvetica,sans-serif;color:#000;width:72mm}
 .c{text-align:center} .r{text-align:right} .b{font-weight:700} .big{font-size:15px} .title{font-size:17px;font-weight:700;letter-spacing:.5px}
 .rule{border-top:2px dotted #000;margin:5px 0} hr{border:0;border-top:1px solid #000;margin:4px 0}
 table{width:100%;border-collapse:collapse} td{vertical-align:top;padding:1px 0} td+td{padding-left:6px;white-space:nowrap} th+th{padding-left:6px;white-space:nowrap} th{font-weight:400;font-size:10px;text-align:left;padding:1px 0;border-bottom:1px solid #000}
 .sm{font-size:10px} .qr{margin:4px 0 2px} .qr svg{width:40mm;height:40mm} .logo{height:10mm;width:auto;margin:2px auto 0;display:block}
 .ek{font-style:italic;font-weight:700;font-size:13px;font-family:Georgia,serif} .mark{border:1.5px solid #000;padding:1px 4px;font-weight:700;display:inline-block;margin:2px 0}`

export function fiscalReceiptHtml(f: FiscalPrint, paper: Paper = 80) {
  const narrow = paper === 58
  const c = f.coupon
  const h = f.header
  const kind = c.type === CouponType.Return ? t('RETURN COUPON|fiscal') : c.type === CouponType.Cancel ? t('CANCELLATION COUPON|fiscal') : t('FISCAL COUPON|fiscal')
  const head = [
    `<div class="b">${esc(t('TAXPAYER: {name}', { name: h.legal_name }))}</div>`,
    h.store ? `<div>${esc(t('UNIT NAME: {name}', { name: h.store }))}</div>` : '',
    h.store_address ? `<div>${esc(t('UNIT ADDRESS: {address}', { address: h.store_address }))}</div>` : '',
    h.city ? `<div>${esc(t('PLACE: {city}', { city: h.city }))}</div>` : '',
    h.phone ? `<div>${esc(t('PHONE: {phone}', { phone: h.phone }))}</div>` : '',
    `<div class="b">${esc(t('NF-NUI: {nui}', { nui: f.nui }))}</div>`,
    h.vat_number ? `<div class="b">${esc(t('VAT NUMBER: {vat}', { vat: h.vat_number }))}</div>` : '',
  ].join('')
  let subtotal = 0
  const lines = c.items.map((i, k) => {
    const p = f.print?.lines[k]
    const list = p?.list ?? i.price                            // the shelf price (a coupon kept without it: its own price)
    const gross = Math.max(Math.round(list * i.quantity / 100), Math.round(i.total / 100))      // cents, before the discount
    // the line's own discount; a discount on the whole sale comes under the subtotal
    const off = p ? Math.min(p.off, gross) : gross - Math.round(i.total / 100)
    subtotal += gross - off
    const pct = p?.pct ?? (gross > 0 && off > 0 ? Math.round(off / gross * 10000) / 100 : 0)
    const offLabel = p?.value ? t('Discount|fiscal') : t('Discount {pct}%|fiscal', { pct: formatNumberWith(pct, { maximumFractionDigits: 2 }) })
    // on 58 mm paper the name takes its own line, the quantity and the amount go under it
    return (narrow
      ? `<tr><td colspan="3">${esc(i.name)}</td></tr><tr><td colspan="2" class="r">${esc(qtyText(i.quantity))} X ${esc(unitPrice(list))}</td><td class="r">${eur(gross)} ${esc(i.taxRate)}</td></tr>`
      : `<tr><td>${esc(i.name)}</td><td class="r">${esc(qtyText(i.quantity))} X ${esc(unitPrice(list))}</td><td class="r">${eur(gross)} ${esc(i.taxRate)}</td></tr>`)
      + (off > 0 ? `<tr class="sm"><td colspan="2">&nbsp;${esc(offLabel)}</td><td class="r">−${eur(off)}</td></tr>` : '')
  }).join('')
  // a discount on the whole sale: the subtotal, then the discount on it with a minus (Kërkesat, neni 25.18)
  const sale = f.print?.sale
  const saleRows = sale && sale.off > 0
    ? `<hr><table><tr><td>${esc(t('SUBTOTAL|fiscal'))}</td><td class="r">${eur(subtotal)}</td></tr><tr><td>${esc(sale.pct
        ? t('Discount on the total {pct}%|fiscal', { pct: formatNumberWith(sale.pct, { maximumFractionDigits: 2 }) }) : t('Discount on the total|fiscal'))}</td><td class="r">−${eur(sale.off)}</td></tr></table>` : ''
  const stamp = (unix: number) => formatDateWith(new Date(unix * 1000), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const taxName = (letter: string) => (letter === 'A' ? t('VAT A exempt|fiscal') : t('VAT {letter} {rate}%|fiscal', { letter, rate: RATE_OF[letter as keyof typeof RATE_OF] }))
  const itemsHead = `<tr><th>${esc(t('ITEM|fiscal'))}</th><th class="r">${esc(t('QTY X PRICE|fiscal'))}</th><th class="r">${esc(t('AMOUNT|fiscal'))}</th></tr>`
  // a return or a cancellation names the coupon it is about: its daily number and its time (Shtojca F)
  const o = c.type === CouponType.Sale ? null : f.print?.orig ?? null
  const origLine = o ? `<div class="c sm">${esc(t('FISCAL COUPON NO. {no}  DATE: {date}|fiscal', { no: o.no ? String(o.no).padStart(4, '0') : String(c.referenceNo), date: stamp(o.time) }))}</div>` : ''
  // a return shows the original coupon first, then what comes back with a minus, the total returned and what is left
  const origBlock = c.type === CouponType.Return && o?.items?.length ? `<table>${itemsHead}${o.items.map(([name, qty, list, gross, off, letter]) =>
      `<tr><td>${esc(name)}</td><td class="r">${esc(qtyText(qty))} X ${esc(unitPrice(list))}</td><td class="r">${eur(gross)} ${esc(letter)}</td></tr>`
      + (off > 0 ? `<tr class="sm"><td colspan="2">&nbsp;${esc(t('Discount|fiscal'))}</td><td class="r">−${eur(off)}</td></tr>` : '')).join('')}</table>
    ${o.sale && o.sale.off > 0 ? `<table class="sm"><tr><td>${esc(o.sale.pct ? t('Discount on the total {pct}%|fiscal', { pct: formatNumberWith(o.sale.pct, { maximumFractionDigits: 2 }) }) : t('Discount on the total|fiscal'))}</td><td class="r">−${eur(o.sale.off)}</td></tr></table>` : ''}
    <hr><table><tr class="b"><td>${esc(t('TOTAL TO PAY|fiscal'))}</td><td class="r">${eur(o.total ?? 0)}</td></tr></table>
    <table><tr><td class="sm">${esc(t('PAYMENT METHOD|fiscal'))}</td><td class="r sm">${esc((o.payments ?? []).map(([k]) => payName(k)).join(', '))}</td></tr>
    ${(o.taxGroups ?? []).map((g) => `<tr><td>${esc(taxName(g.taxRate))}</td><td class="r">${eur(g.totalTax)}</td></tr>`).join('')}
    <tr><td>${esc(t('TOTAL WITHOUT VAT|fiscal'))}</td><td class="r">${eur(o.totalNoTax ?? 0)}</td></tr></table>
    <div class="rule"></div><div class="c">${esc(t('RETURN OF THE ITEMS|fiscal'))}</div><div class="rule"></div>` : ''
  const returnLines = origBlock ? c.items.map((i, k) => {
    const list = f.print?.lines[k]?.list ?? i.price
    return `<tr><td>${esc(i.name)}</td><td class="r">${esc(qtyText(i.quantity))} X ${esc(unitPrice(list))}</td><td class="r">−${eur(Math.round(i.total / 100))} ${esc(i.taxRate)}</td></tr>`
  }).join('') : ''
  const pays = c.payments.map((p) => `<tr><td>${esc(payName(p.type))}</td><td class="r">${eur(p.amount)}</td></tr>`).join('')
  const taxes = c.taxGroups.map((g) => `<tr><td>${esc(taxName(g.taxRate))}</td><td class="r">${eur(g.totalTax)}</td></tr>`).join('')
  const when = stamp(c.time)
  // the SEF's identification number: the unit's number, the NUI, the till (Kërkesat, neni 25.18)
  const sefId = `${f.print?.unitNo || c.branchId}-${f.nui}-${c.posId}`
  // the body: a return as Shtojca F (the original coupon, the items back, the total returned, what is left); the rest as a coupon
  const body = origBlock
    ? `${origBlock}<table>${returnLines}</table>
    <hr><table><tr><td>${esc(t('TOTAL RETURNED|fiscal'))}</td><td class="r">−${eur(c.total)}</td></tr>
    <tr class="b big"><td>${esc(t('TOTAL LEFT|fiscal'))}</td><td class="r">${eur(o?.left ?? 0)}</td></tr></table>
    <div class="r sm">${esc(t('ITEMS RETURNED - {n}|fiscal', { n: c.items.length }))}</div><hr>`
    : `<table>${itemsHead}${lines}</table>
    ${saleRows}
    <hr><table><tr class="b big"><td>${esc(c.type === CouponType.Return ? t('TOTAL|fiscal') : t('TOTAL TO PAY|fiscal'))}</td><td class="r">${eur(c.total)}</td></tr></table>
    <table><tr><td class="sm">${esc(t('PAYMENT METHOD|fiscal'))}</td><td></td></tr>${pays}${f.change ? `<tr><td>${esc(t('Change|fiscal'))}</td><td class="r">${eur(f.change)}</td></tr>` : ''}
    ${taxes}<tr><td>${esc(t('TOTAL WITHOUT VAT|fiscal'))}</td><td class="r">${eur(c.totalNoTax)}</td></tr></table>
    <div class="r sm">${esc(t('ITEMS - {n}|fiscal', { n: c.items.length }))}</div><hr>`
  return `<div class="c">${head}</div><div class="rule"></div>
    <div class="r sm">${esc(t('WORKER: {name}', { name: f.operator }))}${f.operatorNo ? ` · ${esc(t('NO. {no}|worker', { no: f.operatorNo }))}` : ''}</div>
    <div class="c title">${esc(kind)}</div>
    ${f.copy ? `<div class="c"><span class="mark">${esc(t('COPY OF THE COUPON|fiscal'))}</span></div>` : ''}
    ${origLine || (c.referenceNo ? `<div class="c sm">${esc(t('Original coupon: {no}|fiscal', { no: String(c.referenceNo) }))}</div>` : '')}
    ${f.blockNo ? `<div class="c sm b">${esc(t('From the fiscal receipt book, no. {no}', { no: f.blockNo }))}</div>` : ''}
    ${f.reason ? `<div class="sm">${esc(t('Reason for the cancellation: {reason}', { reason: f.reason }))}</div>` : ''}
    ${body}
    <table class="sm"><tr><td colspan="2">${esc(String(c.couponId).padStart(10, '0'))}</td></tr>
    <tr><td>${esc(t('DATE AND TIME|fiscal'))}</td><td class="r">${esc(when)}</td></tr>
    <tr><td>${esc(t('SEF ID NUMBER|fiscal'))}</td><td class="r">${esc(sefId)}</td></tr></table>
    <div class="sm b">${esc(t('NUIKF: {no}', { no: c.verificationNo }))}</div>
    ${f.dailyNo ? `<div class="c sm">${esc(t('DAILY FISCAL COUPON NO. {n}', { n: String(f.dailyNo).padStart(4, '0') }))}</div>` : ''}
    <div class="c qr">${qrSvg(f.qr)}</div>
    <img class="logo" src="${RKS_LOGO}" alt="RKS MF">
    <div class="c ek">e-kuponi</div>
    ${f.offline ? `<div class="c"><span class="mark">OFFLINE</span></div>` : ''}
    ${f.env === 'test' ? `<div class="c b sm">${esc(t('TEST · not a valid fiscal coupon'))}</div>` : ''}
    ${f.footer ? `<div class="c sm">${esc(f.footer)}</div>` : ''}`
}
