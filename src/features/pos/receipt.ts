import { formatDateWith, formatNumberWith, t, tEnum } from '@/i18n'
import { printHtml } from '@/lib/print'
import type { SessionControls } from './api'
import { qrSvg, type ReceiptFiscal } from './atk'
import { RATE_OF } from '@/lib/atk/coupon'

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const money = (n: number) => formatNumberWith(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const qty = (n: number) => (Number.isInteger(n) ? String(n) : formatNumberWith(n, { maximumFractionDigits: 3 }))
const stamp = (d: Date) => formatDateWith(d, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
/** payment method label (cash, card, voucher, bank_transfer, other) */
const method = (m: string) => tEnum(m)

// 80 mm thermal paper: 72 mm printable, monospace keeps the columns straight on cheap printers
const CSS = `@page{size:80mm auto;margin:3mm 4mm} *{box-sizing:border-box} body{margin:0;font:12px/1.35 ui-monospace,Menlo,Consolas,monospace;color:#000;width:72mm}
 .c{text-align:center} .r{text-align:right} .b{font-weight:700} .big{font-size:16px} hr{border:0;border-top:1px dashed #000;margin:6px 0}
 table{width:100%;border-collapse:collapse} td{vertical-align:top;padding:1px 0} .muted{font-size:11px}
 .qr{margin:4px 0} .qr svg{width:46mm;height:46mm}`

export interface ReceiptData {
  company: { name: string; legal_name: string | null; tax_number: string | null; address: string | null }
  register: { code: string; name: string; receipt_header: string | null; receipt_footer: string | null }
  ref: string; number?: string | null; date: Date; cashier: string; customer?: string | null; isRefund?: boolean; offline?: boolean
  lines: { name: string; qty: number; price: number; discount: number; total: number; rate: number }[]
  payments: { method: string; amount: number }[]; change: number; currency: string
  /** loyalty card used on this receipt */
  loyalty?: { holder: string; number: string; discount: number; redeemed?: number; earned?: number; balance?: number } | null
  /** Kosovo: the coupon signed for ATK (its VAT, its number, the QR code) */
  fiscal?: ReceiptFiscal | null
}

export function receiptHtml(r: ReceiptData) {
  const total = r.lines.reduce((s, l) => s + l.total, 0)
  const byRate = new Map<number, { base: number; tax: number }>()
  for (const l of r.lines) {
    const base = Math.round((l.total / (1 + l.rate / 100)) * 100) / 100
    const v = byRate.get(l.rate) ?? { base: 0, tax: 0 }
    v.base += base; v.tax += l.total - base; byRate.set(l.rate, v)
  }
  const lines = r.lines.map((l) => `<tr><td colspan="2">${esc(l.name)}</td></tr><tr><td class="muted">&nbsp;${esc(qty(l.qty))} × ${money(l.price)}${l.discount ? ` −${l.discount}%` : ''}</td><td class="r">${money(l.total)}</td></tr>`).join('')
  const f = r.fiscal
  // a fiscal receipt shows the VAT exactly as the signed coupon gives it to ATK
  const taxes = f
    // ATK takes a return's sums as they are; on paper they carry the sign of the refund, like its total
    ? f.groups.map((g) => { const k = f.isReturn ? -1 : 1; return `<tr><td class="muted">${esc(g.taxRate)} · ${esc(g.taxRate === 'A' ? t('Exempt from VAT') : t('VAT {rate}% on {base}', { rate: RATE_OF[g.taxRate], base: money(k * g.totalForTax / 100) }))}</td><td class="r muted">${money(k * g.totalTax / 100)}</td></tr>` }).join('')
    : [...byRate.entries()].sort((a, b) => b[0] - a[0]).map(([rate, v]) => `<tr><td class="muted">${esc(t('VAT {rate}% on {base}', { rate, base: money(v.base) }))}</td><td class="r muted">${money(v.tax)}</td></tr>`).join('')
  const fiscal = f ? `<hr><div class="c b">${esc(f.isReturn ? t('FISCAL RETURN COUPON') : t('FISCAL COUPON'))}</div>
    <table class="muted"><tr><td>${esc(t('Coupon no.'))}</td><td class="r">${esc(f.couponId)}</td></tr>${f.referenceNo ? `<tr><td>${esc(t('Original coupon'))}</td><td class="r">${esc(f.referenceNo)}</td></tr>` : ''}
    <tr><td>${esc(t('Verification code'))}</td><td class="r">${esc(f.verificationNo)}</td></tr></table>
    <div class="c qr">${qrSvg(f.qr)}</div><div class="c muted">${esc(t('Scan the code to check this coupon at ATK'))}</div>
    ${f.env === 'test' ? `<div class="c b">${esc(t('TEST · not a valid fiscal coupon'))}</div>` : ''}` : ''
  const pays = r.payments.map((p) => `<tr><td>${esc(method(p.method))}</td><td class="r">${money(p.amount)}</td></tr>`).join('')
  return `<div class="c b big">${esc(r.company.name)}</div>
    <div class="c muted">${esc(r.company.legal_name ?? '')}${r.company.tax_number ? `<br>${esc(f ? t('NUI') : t('NIPT'))} ${esc(r.company.tax_number)}` : ''}${r.company.address ? `<br>${esc(r.company.address)}` : ''}</div>
    ${r.register.receipt_header ? `<div class="c muted">${esc(r.register.receipt_header)}</div>` : ''}
    <hr><div>${r.isRefund ? `<b>${esc(t('REFUND'))}</b><br>` : ''}${esc(t('Receipt {number}', { number: r.number ?? r.ref }))}${r.number && r.number !== r.ref ? `<br><span class="muted">${esc(t('Till ref {ref}', { ref: r.ref }))}</span>` : ''}<br>
    ${esc(stamp(r.date))} · ${esc(r.register.name)}<br>${esc(t('Cashier: {name}', { name: r.cashier }))}${r.customer ? `<br>${esc(t('Customer: {name}', { name: r.customer }))}` : ''}</div><hr>
    <table>${lines}</table><hr>
    <table><tr class="b big"><td>${esc(t('TOTAL {currency}', { currency: r.currency }))}</td><td class="r">${money(total)}</td></tr>${taxes}</table><hr>
    <table>${pays}${r.change > 0 ? `<tr class="b"><td>${esc(t('Change'))}</td><td class="r">${money(r.change)}</td></tr>` : ''}</table>
    ${r.loyalty ? `<hr><div>${esc(t('Card {number}', { number: '•••• ' + r.loyalty.number.slice(-4) }))} · ${esc(r.loyalty.holder)}</div><table>
      ${r.loyalty.discount > 0 ? `<tr><td>${esc(t('You saved with the card'))}</td><td class="r b">${money(r.loyalty.discount)}</td></tr>` : ''}
      ${r.loyalty.redeemed ? `<tr><td>${esc(t('Points spent'))}</td><td class="r">−${esc(r.loyalty.redeemed)}</td></tr>` : ''}
      ${r.loyalty.earned ? `<tr><td>${esc(t('Points earned'))}</td><td class="r">+${esc(r.loyalty.earned)}</td></tr>` : ''}
      ${r.loyalty.balance != null ? `<tr><td>${esc(t('Points on the card'))}</td><td class="r b">${esc(r.loyalty.balance)}</td></tr>` : ''}</table>` : ''}
    ${fiscal}
    ${r.offline ? `<hr><div class="c muted">${esc(f ? t('Made without internet: the coupon is signed and goes to ATK when the till is back online.') : t('Recorded offline — sent to the books when the till is back online.'))}</div>` : ''}
    <hr><div class="c muted">${esc(r.register.receipt_footer ?? 'Faleminderit! Thank you!')}</div>`
}
export function printReceipt(r: ReceiptData) { printHtml(receiptHtml(r), CSS, 'receipt') }

export interface ZData {
  company: string; register: string; number: string; session: string; opened: string; closed: string | null; date: string; currency: string
  orders: number; refunds: number; gross: number; refundsTotal: number; discounts: number; net: number; tax: number
  payments: Record<string, number>; taxes: { rate: number; base: number; tax: number }[]
  opening: number; cashIn: number; cashOut: number; expected: number; counted: number | null; difference: number | null
  items: { name: string; quantity: number; total: number }[]
  /** the count by note and coin, who confirmed it, the till's voids */
  controls?: SessionControls | null
}
export function printZReport(z: ZData) {
  const c = z.controls
  const row = (k: string, v: string, cls = '') => `<tr class="${cls}"><td>${esc(k)}</td><td class="r">${esc(v)}</td></tr>`
  const pays = Object.entries(z.payments).filter(([k]) => k !== 'change_given').map(([k, v]) => row(method(k), money(Number(v)))).join('')
  printHtml(`<div class="c b big">${esc(t('Z-REPORT {number}', { number: z.number }))}</div><div class="c muted">${esc(z.company)}<br>${esc(z.register)} · ${esc(t('shift {number}', { number: z.session }))}<br>
    ${esc(stamp(new Date(z.opened)))} → ${esc(z.closed ? stamp(new Date(z.closed)) : '')}</div><hr>
    <table>${row(t('Receipts'), String(z.orders))}${row(t('Refunds|count'), String(z.refunds))}${row(t('Gross sales (with VAT)'), money(z.gross))}${row(t('Refunds (with VAT)'), `−${money(z.refundsTotal)}`)}
    ${row(t('Discounts given (with VAT)'), money(z.discounts))}${row(t('Sales (without VAT)'), money(z.net))}${row(t('VAT'), money(z.tax))}${row(t('Total with VAT {currency}', { currency: z.currency }), money(z.gross - z.refundsTotal), 'b')}</table><hr>
    <div class="b">${esc(t('VAT'))}</div><table>${z.taxes.map((x) => row(t('{rate}% on {base}', { rate: x.rate, base: money(x.base) }), money(x.tax))).join('')}</table><hr>
    <div class="b">${esc(t('Payments'))}</div><table>${pays}${row(t('Change given'), money(Number(z.payments.change_given ?? 0)))}</table><hr>
    <div class="b">${esc(t('Cash drawer'))}</div><table>${row(t('Opening cash'), money(z.opening))}${row(t('Cash in'), money(z.cashIn))}${row(t('Cash out'), `−${money(z.cashOut)}`)}
    ${row(t('Expected'), money(z.expected), 'b')}${row(t('Counted'), z.counted == null ? '—' : money(z.counted))}${row(t('Difference'), z.difference == null ? '—' : money(z.difference), 'b')}</table>
    ${c?.count?.notes_coins ? `<table>${Object.entries(c.count.notes_coins).sort((a, b) => Number(b[0]) - Number(a[0])).map(([d, n]) => row(`${n} × ${d}`, money(Number(d) * n))).join('')}</table>` : ''}
    ${c?.count?.counted_by ? `<div class="muted">${esc(t('Counted by {name}', { name: c.count.counted_by }))}${c.count.witnessed_by ? ` · ${esc(t('confirmed by {name}', { name: c.count.witnessed_by }))}` : ''}</div>` : ''}<hr>
    ${c && c.voids.count > 0 ? `<div class="b">${esc(t('Till controls'))}</div><table>${row(t('Voids'), `${c.voids.count} · ${money(c.voids.amount)}`)}${c.voids.unconfirmed ? row(t('Without a manager'), String(c.voids.unconfirmed)) : ''}</table><hr>` : ''}
    <div class="b">${esc(t('Best sellers · sales with VAT'))}</div><table>${z.items.slice(0, 10).map((i) => row(`${qty(Number(i.quantity))} × ${i.name}`, money(Number(i.total)))).join('')}</table>
    <hr><div class="c muted">${esc(t('Printed {date}', { date: stamp(new Date()) }))}</div>`, CSS, 'receipt')
}
