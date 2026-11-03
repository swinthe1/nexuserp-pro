/**
 * The fiscal coupon on paper, as ATK lays it out (Kërkesat specifike…, neni 25.18 and Shtojca F; UA 01/2026, neni 7):
 * the taxpayer and the store at the head, the worker, the lines with their VAT letter and discounts with a minus,
 * the total, the payments, the VAT by rate, the total without VAT, the coupon's numbers, the QR code, the RKS MF logo,
 * "e-kuponi" and the free text. Everything comes from the coupon as it was signed, so a copy prints the same.
 */
import { formatDateWith, formatNumberWith, t } from '@/i18n'
import { CouponType, PaymentType, type PosCoupon } from '@/lib/atk/proto'
import { RATE_OF } from '@/lib/atk/coupon'
import { qrSvg } from './atk'
import { RKS_LOGO } from './rks-logo'

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
/** a total in cents, with the euro sign */
const eur = (cents: number) => `${formatNumberWith(cents / 100, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
/** a unit price in ten-thousandths: two decimals at least, four at most */
const unitPrice = (p: number) => formatNumberWith(p / 10000, { minimumFractionDigits: 2, maximumFractionDigits: 4 })
const qtyText = (q: number) => formatNumberWith(Math.round(q * 1000) / 1000, { maximumFractionDigits: 3 })

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
}

const PAY: Record<number, string> = { [PaymentType.Cash]: 'CASH', [PaymentType.CreditCard]: 'CARD', [PaymentType.Voucher]: 'VOUCHER', [PaymentType.Cheque]: 'CHEQUE',
  [PaymentType.CryptoCurrency]: 'CRYPTO', [PaymentType.Other]: 'OTHER' }
const payName = (k: number) => ({ CASH: t('CASH|fiscal'), CARD: t('CARD|fiscal'), VOUCHER: t('VOUCHER|fiscal'), CHEQUE: t('CHEQUE|fiscal'),
  CRYPTO: t('CRYPTO|fiscal'), OTHER: t('OTHER|fiscal') } as Record<string, string>)[PAY[k] ?? 'OTHER']!

export const FISCAL_CSS = `@page{size:80mm auto;margin:3mm 4mm} *{box-sizing:border-box} body{margin:0;font:11.5px/1.35 Arial,Helvetica,sans-serif;color:#000;width:72mm}
 .c{text-align:center} .r{text-align:right} .b{font-weight:700} .big{font-size:15px} .title{font-size:17px;font-weight:700;letter-spacing:.5px}
 .rule{border-top:2px dotted #000;margin:5px 0} hr{border:0;border-top:1px solid #000;margin:4px 0}
 table{width:100%;border-collapse:collapse} td{vertical-align:top;padding:1px 0} th{font-weight:400;font-size:10px;text-align:left;padding:1px 0;border-bottom:1px solid #000}
 .sm{font-size:10px} .qr{margin:4px 0 2px} .qr svg{width:40mm;height:40mm} .logo{height:10mm;width:auto;margin:2px auto 0;display:block}
 .ek{font-style:italic;font-weight:700;font-size:13px;font-family:Georgia,serif} .mark{border:1.5px solid #000;padding:1px 4px;font-weight:700;display:inline-block;margin:2px 0}`

export function fiscalReceiptHtml(f: FiscalPrint) {
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
  const lines = c.items.map((i) => {
    const gross = Math.round(i.price * i.quantity / 100)      // cents, before the discount
    const net = Math.round(i.total / 100)                      // cents, after it
    const off = gross - net
    const pct = gross > 0 && off > 0 ? Math.round(off / gross * 10000) / 100 : 0
    return `<tr><td>${esc(i.name)}</td><td class="r">${esc(qtyText(i.quantity))} X ${esc(unitPrice(i.price))}</td><td class="r">${eur(gross)} ${esc(i.taxRate)}</td></tr>`
      + (off > 0 ? `<tr class="sm"><td colspan="2">&nbsp;${esc(t('Discount {pct}%|fiscal', { pct: formatNumberWith(pct, { maximumFractionDigits: 2 }) }))}</td><td class="r">−${eur(off)}</td></tr>` : '')
  }).join('')
  const pays = c.payments.map((p) => `<tr><td>${esc(payName(p.type))}</td><td class="r">${eur(p.amount)}</td></tr>`).join('')
  const taxes = c.taxGroups.map((g) => `<tr><td>${esc(g.taxRate === 'A' ? t('VAT A exempt|fiscal') : t('VAT {letter} {rate}%|fiscal', { letter: g.taxRate, rate: RATE_OF[g.taxRate] }))}</td><td class="r">${eur(g.totalTax)}</td></tr>`).join('')
  const when = formatDateWith(new Date(c.time * 1000), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const sefId = `${c.branchId}-${f.nui}-${c.posId}`
  return `<div class="c">${head}</div><div class="rule"></div>
    <div class="r sm">${esc(t('WORKER: {name}', { name: f.operator }))}${f.operatorNo ? ` · ${esc(t('NO. {no}|worker', { no: f.operatorNo }))}` : ''}</div>
    <div class="c title">${esc(kind)}</div>
    ${f.copy ? `<div class="c"><span class="mark">${esc(t('COPY OF THE COUPON|fiscal'))}</span></div>` : ''}
    ${c.referenceNo ? `<div class="c sm">${esc(t('Original coupon: {no}|fiscal', { no: String(c.referenceNo) }))}</div>` : ''}
    ${f.reason ? `<div class="sm">${esc(t('Reason for the cancellation: {reason}', { reason: f.reason }))}</div>` : ''}
    <table><tr><th>${esc(t('ITEM|fiscal'))}</th><th class="r">${esc(t('QTY X PRICE|fiscal'))}</th><th class="r">${esc(t('AMOUNT|fiscal'))}</th></tr>${lines}</table>
    ${c.totalDiscount > 0 ? `<table class="sm"><tr><td>${esc(t('Discounts|fiscal'))}</td><td class="r">−${eur(c.totalDiscount)}</td></tr></table>` : ''}
    <hr><table><tr class="b big"><td>${esc(c.type === CouponType.Sale ? t('TOTAL TO PAY|fiscal') : t('TOTAL|fiscal'))}</td><td class="r">${eur(c.total)}</td></tr></table>
    <table><tr><td class="sm">${esc(t('PAYMENT METHOD|fiscal'))}</td><td></td></tr>${pays}${f.change ? `<tr><td>${esc(t('Change|fiscal'))}</td><td class="r">${eur(f.change)}</td></tr>` : ''}
    ${taxes}<tr><td>${esc(t('TOTAL WITHOUT VAT|fiscal'))}</td><td class="r">${eur(c.totalNoTax)}</td></tr></table>
    <div class="r sm">${esc(t('ITEMS - {n}|fiscal', { n: c.items.length }))}</div><hr>
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
