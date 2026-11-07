import { formatDateWith, formatNumberWith, t, tEnum } from '@/i18n'
import { printHtml } from '@/lib/print'
import { labelledBarcodeSvg } from '@/lib/barcode'
import type { SessionControls } from './api'
import { fiscalCss, fiscalReceiptHtml, paperOf, type FiscalPrint, type Paper } from './fiscal-receipt'

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const money = (n: number) => formatNumberWith(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const qty = (n: number) => (Number.isInteger(n) ? String(n) : formatNumberWith(n, { maximumFractionDigits: 3 }))
const stamp = (d: Date) => formatDateWith(d, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
/** payment method label (cash, card, voucher, bank_transfer, other) */
const method = (m: string) => tEnum(m)

// 80 mm thermal paper: 72 mm printable, monospace keeps the columns straight on cheap printers
const CSS = `@page{size:80mm auto;margin:3mm 4mm} *{box-sizing:border-box} body{margin:0;font:12px/1.35 ui-monospace,Menlo,Consolas,monospace;color:#000;width:72mm}
 .c{text-align:center} .r{text-align:right} .b{font-weight:700} .big{font-size:16px} hr{border:0;border-top:1px dashed #000;margin:6px 0}
 table{width:100%;border-collapse:collapse} td{vertical-align:top;padding:1px 0} .muted{font-size:11px}`
const css = (mm: Paper) => (mm === 58 ? CSS.replace('size:80mm auto;margin:3mm 4mm', 'size:58mm auto;margin:2mm 2mm').replace('font:12px/1.35', 'font:10px/1.3')
  .replace('width:72mm', 'width:54mm').replace('.big{font-size:16px}', '.big{font-size:13px}').replace('.muted{font-size:11px}', '.muted{font-size:9.5px}') : CSS)

export interface ReceiptData {
  company: { name: string; legal_name: string | null; tax_number: string | null; address: string | null }
  register: { code: string; name: string; receipt_header: string | null; receipt_footer: string | null; paper_mm?: number | null }
  ref: string; number?: string | null; date: Date; cashier: string; customer?: string | null; isRefund?: boolean; offline?: boolean
  lines: { name: string; qty: number; price: number; discount: number; total: number; rate: number }[]
  payments: { method: string; amount: number }[]; change: number; currency: string
  /** loyalty card used on this receipt */
  loyalty?: { holder: string; number: string; discount: number; redeemed?: number; earned?: number; balance?: number } | null
  /** Kosovo: the coupon signed for ATK; the receipt is then the fiscal coupon in ATK's layout */
  fiscal?: FiscalPrint | null
}

export function receiptHtml(r: ReceiptData) {
  if (r.fiscal) return fiscalReceiptHtml(r.fiscal, paperOf(r.register.paper_mm))
  const total = r.lines.reduce((s, l) => s + l.total, 0)
  const byRate = new Map<number, { base: number; tax: number }>()
  for (const l of r.lines) {
    const base = Math.round((l.total / (1 + l.rate / 100)) * 100) / 100
    const v = byRate.get(l.rate) ?? { base: 0, tax: 0 }
    v.base += base; v.tax += l.total - base; byRate.set(l.rate, v)
  }
  const lines = r.lines.map((l) => `<tr><td colspan="2">${esc(l.name)}</td></tr><tr><td class="muted">&nbsp;${esc(qty(l.qty))} × ${money(l.price)}${l.discount ? ` −${l.discount}%` : ''}</td><td class="r">${money(l.total)}</td></tr>`).join('')
  const taxes = [...byRate.entries()].sort((a, b) => b[0] - a[0]).map(([rate, v]) => `<tr><td class="muted">${esc(t('VAT {rate}% on {base}', { rate, base: money(v.base) }))}</td><td class="r muted">${money(v.tax)}</td></tr>`).join('')
  const pays = r.payments.map((p) => `<tr><td>${esc(method(p.method))}</td><td class="r">${money(p.amount)}</td></tr>`).join('')
  return `<div class="c b big">${esc(r.company.name)}</div>
    <div class="c muted">${esc(r.company.legal_name ?? '')}${r.company.tax_number ? `<br>${esc(t('NIPT'))} ${esc(r.company.tax_number)}` : ''}${r.company.address ? `<br>${esc(r.company.address)}` : ''}</div>
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
    ${r.offline ? `<hr><div class="c muted">${esc(t('Recorded offline — sent to the books when the till is back online.'))}</div>` : ''}
    <hr><div class="c muted">${esc(r.register.receipt_footer ?? 'Faleminderit! Thank you!')}</div>`
}
export function printReceipt(r: ReceiptData) {
  const mm = paperOf(r.register.paper_mm)
  printHtml(receiptHtml(r), r.fiscal ? fiscalCss(mm) : css(mm), 'receipt')
}

/** a gift voucher: what it is worth, its code as a barcode, until when */
export function printVoucher(v: { company: string; register: { paper_mm?: number | null }; code: string; amount: number; currency: string; validUntil: string | null; date: Date }) {
  const mm = paperOf(v.register.paper_mm)
  printHtml(`<div class="c b big">${esc(v.company)}</div><hr>
    <div class="c b big">${esc(t('GIFT VOUCHER'))}</div>
    <div class="c b" style="font-size:22px;margin:6px 0">${money(v.amount)} ${esc(v.currency)}</div>
    <div class="c">${labelledBarcodeSvg(v.code, { module: 2, height: 50 })}</div>
    ${v.validUntil ? `<div class="c">${esc(t('Valid until {date}', { date: formatDateWith(new Date(v.validUntil), { day: '2-digit', month: '2-digit', year: 'numeric' }) }))}</div>` : ''}
    <hr><div class="c muted">${esc(t('Pay with it at the till, all at once or in parts. Keep the code safe: whoever has it can spend it.'))}</div>
    <div class="c muted">${esc(stamp(v.date))}</div>`, css(mm), 'receipt')
}

export interface ZData {
  company: string; register: string; number: string; session: string; opened: string; closed: string | null; date: string; currency: string
  orders: number; refunds: number; gross: number; refundsTotal: number; discounts: number; net: number; tax: number
  payments: Record<string, number>; taxes: { rate: number; base: number; tax: number }[]
  opening: number; cashIn: number; cashOut: number
  /** null: the cashier counts blind, the slip she prints does not tell what was expected */
  expected: number | null; counted: number | null; difference: number | null
  /** an X-report: the shift so far, not closed */
  x?: boolean
  items: { name: string; quantity: number; total: number }[]
  /** the count by note and coin, who confirmed it, the till's voids */
  controls?: SessionControls | null
  /** the till's paper, 58 or 80 mm */
  paper?: number | null
}
export function printZReport(z: ZData) {
  const c = z.controls
  const row = (k: string, v: string, cls = '') => `<tr class="${cls}"><td>${esc(k)}</td><td class="r">${esc(v)}</td></tr>`
  const pays = Object.entries(z.payments).filter(([k]) => k !== 'change_given').map(([k, v]) => row(method(k), money(Number(v)))).join('')
  printHtml(`<div class="c b big">${esc(z.x ? t('X-REPORT · {number}', { number: z.number }) : t('Z-REPORT {number}', { number: z.number }))}</div><div class="c muted">${esc(z.company)}<br>${esc(z.register)} · ${esc(t('shift {number}', { number: z.session }))}<br>
    ${esc(stamp(new Date(z.opened)))} → ${esc(z.closed ? stamp(new Date(z.closed)) : '')}</div><hr>
    <table>${row(t('Receipts'), String(z.orders))}${row(t('Refunds|count'), String(z.refunds))}${row(t('Gross sales (with VAT)'), money(z.gross))}${row(t('Refunds (with VAT)'), `−${money(z.refundsTotal)}`)}
    ${row(t('Discounts given (with VAT)'), money(z.discounts))}${row(t('Sales (without VAT)'), money(z.net))}${row(t('VAT'), money(z.tax))}${row(t('Total with VAT {currency}', { currency: z.currency }), money(z.gross - z.refundsTotal), 'b')}</table><hr>
    <div class="b">${esc(t('VAT'))}</div><table>${z.taxes.map((x) => row(t('{rate}% on {base}', { rate: x.rate, base: money(x.base) }), money(x.tax))).join('')}</table><hr>
    <div class="b">${esc(t('Payments'))}</div><table>${pays}${row(t('Change given'), money(Number(z.payments.change_given ?? 0)))}</table><hr>
    <div class="b">${esc(t('Cash drawer'))}</div><table>${row(t('Opening cash'), money(z.opening))}${row(t('Cash in'), money(z.cashIn))}${row(t('Cash out'), `−${money(z.cashOut)}`)}
    ${z.expected == null ? '' : row(t('Expected'), money(z.expected), 'b')}${row(t('Counted'), z.counted == null ? '—' : money(z.counted))}${z.expected == null ? '' : row(t('Difference'), z.difference == null ? '—' : money(z.difference), 'b')}</table>
    ${c?.count?.notes_coins ? `<table>${Object.entries(c.count.notes_coins).sort((a, b) => Number(b[0]) - Number(a[0])).map(([d, n]) => row(`${n} × ${d}`, money(Number(d) * n))).join('')}</table>` : ''}
    ${c?.count?.counted_by ? `<div class="muted">${esc(t('Counted by {name}', { name: c.count.counted_by }))}${c.count.witnessed_by ? ` · ${esc(t('confirmed by {name}', { name: c.count.witnessed_by }))}` : ''}</div>` : ''}<hr>
    ${c && c.voids.count > 0 ? `<div class="b">${esc(t('Till controls'))}</div><table>${row(t('Voids'), `${c.voids.count} · ${money(c.voids.amount)}`)}${c.voids.unconfirmed ? row(t('Without a manager'), String(c.voids.unconfirmed)) : ''}</table><hr>` : ''}
    <div class="b">${esc(t('Best sellers · sales with VAT'))}</div><table>${z.items.slice(0, 10).map((i) => row(`${qty(Number(i.quantity))} × ${i.name}`, money(Number(i.total)))).join('')}</table>
    <hr><div class="c muted">${esc(t('Printed {date}', { date: stamp(new Date()) }))}</div>`, css(paperOf(z.paper)), 'receipt')
}

/** a waiter's takings: what he took at the tables, and (handed over) what the till counted, signed by both */
export function printWaiterSlip(w: { company: string; register: string; session: string; waiter: string; receipts: number; cash: number; card: number; other: number
  owed: number; counted?: number | null; difference?: number | null; receivedBy?: string | null; note?: string | null; at: Date; currency: string; paper?: number | null }) {
  const mm = paperOf(w.paper)
  const row = (k: string, v: string, cls = '') => `<tr class="${cls}"><td>${esc(k)}</td><td class="r">${esc(v)}</td></tr>`
  const handed = w.counted != null
  printHtml(`<div class="c b big">${esc(handed ? t('TAKINGS HANDED OVER') : t('WAITER\'S TAKINGS'))}</div>
    <div class="c muted">${esc(w.company)}<br>${esc(w.register)} · ${esc(t('shift {number}', { number: w.session }))}<br>${esc(stamp(w.at))}</div><hr>
    <div class="b">${esc(w.waiter)}</div>
    <table>${row(t('Receipts'), String(w.receipts))}${row(tEnum('card'), money(w.card))}${w.other ? row(t('Other payments'), money(w.other)) : ''}${row(t('Cash taken'), money(w.cash))}</table><hr>
    <table>${row(t('To hand over'), `${money(w.owed)} ${w.currency}`, 'b')}${handed ? row(t('Handed over'), money(w.counted!), 'b') + row(t('Difference'), money(w.difference ?? 0), 'b') : ''}</table>
    ${w.note ? `<div class="muted">“${esc(w.note)}”</div>` : ''}<hr>
    ${handed ? `<table><tr><td>${esc(t('Waiter'))}<br><br>______________</td><td class="r">${esc(w.receivedBy ?? t('Till'))}<br><br>______________</td></tr></table>` : ''}`, css(mm), 'receipt')
}
