/** The cards and statements as data (from the server) and as printable statements. */
import { msg, t } from '@/i18n'
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'
import type { PrintDoc, PrintParty } from './model'
import { nf, qf, type Statement } from './render-statement'

type Common = { company: PrintDoc['company']; partner: PrintParty; partner_id: string; currency: string; printed_by: string | null; printed_at: string }
export type Side = 'customer' | 'vendor'
export type CardRow = { date: string; entry: string; source_type: string | null; source_id: string | null; document: string; reference: string | null; memo: string | null
  due: string | null; debit: number; credit: number; balance: number }
export type PartnerCard = Common & { side: Side; from: string; to: string; opening: number; debit: number; credit: number; closing: number; rows: CardRow[] }
export type OpenRow = { kind: 'invoice' | 'credit_note' | 'debit_note' | 'advance'; id: string; number: string; reference: string | null; date: string; due: string | null; currency: string; total: number; open: number; late: boolean }
export type OpenItems = Common & { side: Side; date: string; rows: OpenRow[]; totals: Record<string, number> }
export type CompPrint = Common & { number: string; date: string; status: string; amount: number; notes: string | null; cancel_reason: string | null
  invoices: { number: string; date: string; total: number; amount: number }[]; bills: { number: string; reference: string | null; date: string; total: number; amount: number }[] }
export type ItemCardRow = { id: string; at: string; date: string; type: string; reference: string | null; source_type: string | null; source_id: string | null
  partner: string | null; warehouse: string | null; lot: string | null; qty_in: number; qty_out: number; unit_cost: number; value_in: number; value_out: number; qty: number; value: number }
export type ItemCard = { variant_id: string; sku: string; name: string; warehouse: string | null; from: string; to: string; uom: string | null; currency: string
  opening_qty: number; opening_value: number; closing_qty: number; closing_value: number; rows: ItemCardRow[]
  company: PrintDoc['company']; printed_by: string | null; printed_at: string }

export const fetchPartnerCard = async (partner: string, side: Side, from: string, to: string) =>
  unwrap(await supabase.rpc('partner_card', { p_partner: partner, p_side: side, p_from: from, p_to: to })) as unknown as PartnerCard
export const fetchOpenItems = async (partner: string, side: Side, date: string) =>
  unwrap(await supabase.rpc('open_items_statement', { p_partner: partner, p_side: side, p_date: date })) as unknown as OpenItems
export const fetchCompensation = async (id: string) => unwrap(await supabase.rpc('compensation_print', { p_id: id })) as unknown as CompPrint
export const fetchItemCard = async (variant: string, warehouse: string | null, from: string, to: string) =>
  unwrap(await supabase.rpc('item_card', { p_variant: variant, p_warehouse: warehouse as string, p_from: from, p_to: to })) as unknown as ItemCard

export const SOURCE: Record<string, string> = {
  sales_invoice: msg('Invoice'), credit_note: msg('Credit note'), debit_note: msg('Debit note'), vendor_debit: msg('Supplier’s debit note'), customer_payment: msg('Receipt|payment'), vendor_payment: msg('Payment'),
  vendor_bill: msg('Vendor bill'), vendor_credit: msg('Vendor credit'), compensation: msg('Compensation'), pos_order: msg('POS receipt'),
}
export const MOVEMENT: Record<string, string> = {
  receipt: msg('Goods in'), purchase_return: msg('Return to supplier'), delivery: msg('Delivery'), sales_return: msg('Customer return'), pos_sale: msg('Till sale'),
  pos_return: msg('Till return'), transfer: msg('Transfer'), adjustment_in: msg('Adjustment +'), adjustment_out: msg('Adjustment −'), production_consume: msg('Used in production'),
  production_output: msg('Produced'), scrap: msg('Scrap'), landed_cost: msg('Landed cost'), opening: msg('Opening stock'), revaluation: msg('Revaluation'),
}
const sideParty = (s: Side) => s === 'vendor' ? t('Supplier') : t('Customer')
/** the balance as it is read: what the customer owes us / what we owe the supplier */
export const sideBalance = (s: Side, n: number) => s === 'vendor' ? -n : n

export function partnerCardStatement(c: PartnerCard): Statement {
  const dec = c.company.decimals ?? 2
  const rows = [
    [formatDate(c.from), t('Opening balance'), '', '', '', '', nf(sideBalance(c.side, c.opening), dec)],
    ...c.rows.map((r) => [formatDate(r.date), r.source_type && SOURCE[r.source_type] ? t(SOURCE[r.source_type]) : (r.memo ?? ''), r.document, r.reference ?? '',
      nf(r.debit, dec), nf(r.credit, dec), nf(sideBalance(c.side, r.balance), dec)]),
    [formatDate(c.to), t('Closing balance'), '', '', nf(c.debit, dec), nf(c.credit, dec), nf(sideBalance(c.side, c.closing), dec)],
  ]
  return {
    title: c.side === 'vendor' ? t('Supplier card') : t('Customer card'), subtitle: `${formatDate(c.from)} – ${formatDate(c.to)}`,
    company: c.company, partner: c.partner, partnerLabel: sideParty(c.side),
    info: [[t('Period'), `${formatDate(c.from)} – ${formatDate(c.to)}`], [t('Currency'), c.currency],
      [c.side === 'vendor' ? t('We owe') : t('Owes us'), nf(sideBalance(c.side, c.closing), dec)]],
    tables: [{ columns: [{ label: t('Date') }, { label: t('Document') }, { label: t('Number') }, { label: t('Reference') },
      { label: t('Debit'), align: 'right' }, { label: t('Credit'), align: 'right' }, { label: t('Balance'), align: 'right' }], rows, strong: [0, rows.length - 1] }],
    summary: [[t('Opening balance'), nf(sideBalance(c.side, c.opening), dec)], [t('Debit'), nf(c.debit, dec)], [t('Credit'), nf(c.credit, dec)],
      [t('Closing balance'), `${nf(sideBalance(c.side, c.closing), dec)} ${c.currency}`, true]],
    printed_by: c.printed_by, printed_at: c.printed_at,
  }
}

export function openItemsStatement(o: OpenItems): Statement {
  const dec = o.company.decimals ?? 2
  const kind = (k: OpenRow['kind']) => k === 'advance' ? t('Advance / unallocated payment') : k === 'credit_note' ? t('Credit note') : k === 'debit_note' ? t('Debit note') : t('Invoice')
  const totals = Object.entries(o.totals).map(([cur, v]) => [t('Total open'), `${nf(v, dec)} ${cur}`, true] as [string, string, boolean])
  return {
    title: t('Statement of open items'), subtitle: t('at {date}', { date: formatDate(o.date) }),
    company: o.company, partner: o.partner, partnerLabel: sideParty(o.side),
    info: [[t('At|date'), formatDate(o.date)], [t('Documents'), String(o.rows.length)]],
    tables: [{ columns: [{ label: t('Document') }, { label: t('Number') }, { label: t('Their number') }, { label: t('Date') }, { label: t('Due') },
      { label: t('Amount'), align: 'right' }, { label: t('Open|amount'), align: 'right' }],
      rows: o.rows.map((r) => [kind(r.kind), r.number, r.reference ?? '', formatDate(r.date), r.due ? formatDate(r.due) : '', nf(r.total, dec), `${nf(r.open, dec)} ${r.currency}`]) }],
    summary: totals.length ? totals : [[t('Total open'), nf(0, dec), true]],
    texts: [o.side === 'vendor'
      ? t('According to our books, on {date} we owe you the amount above. Please confirm it by signing and returning this statement within 8 days; if your books differ, please send us your statement.', { date: formatDate(o.date) })
      : t('According to our books, on {date} you owe us the amount above. Please confirm it by signing and returning this statement within 8 days; if your books differ, please send us your statement.', { date: formatDate(o.date) }),
      t('We confirm [  ]    We do not confirm [  ]    Our balance: ______________')],
    signatures: [t('For {company}', { company: o.company.name }), t('For {partner}', { partner: o.partner.name })],
    printed_by: o.printed_by, printed_at: o.printed_at,
  }
}

export function compensationStatement(c: CompPrint): Statement {
  const dec = c.company.decimals ?? 2
  return {
    title: t('Compensation'), number: c.number, subtitle: formatDate(c.date),
    company: c.company, partner: c.partner, partnerLabel: t('Partner'),
    info: [[t('Date'), formatDate(c.date)], [t('Amount'), `${nf(c.amount, dec)} ${c.currency}`], ...(c.status === 'cancelled' ? [[t('Status'), t('Cancelled')] as [string, string]] : [])],
    tables: [
      { heading: t('Their debt to us (our invoices)'), columns: [{ label: t('Invoice') }, { label: t('Date') }, { label: t('Invoice amount'), align: 'right' }, { label: t('Set off'), align: 'right' }],
        rows: c.invoices.map((i) => [i.number, formatDate(i.date), nf(i.total, dec), nf(i.amount, dec)]) },
      { heading: t('Our debt to them (their invoices)'), columns: [{ label: t('Bill') }, { label: t('Their number') }, { label: t('Date') }, { label: t('Invoice amount'), align: 'right' }, { label: t('Set off'), align: 'right' }],
        rows: c.bills.map((b) => [b.number, b.reference ?? '', formatDate(b.date), nf(b.total, dec), nf(b.amount, dec)]) },
    ],
    summary: [[t('Set off on both sides'), `${nf(c.amount, dec)} ${c.currency}`, true]],
    texts: [t('The two parties agree to set off their mutual debts for the amount above. After this compensation both debts are lower by this amount.'),
      c.notes ?? '', c.cancel_reason ? `${t('Cancelled')}: ${c.cancel_reason}` : ''],
    signatures: [t('For {company}', { company: c.company.name }), t('For {partner}', { partner: c.partner.name })],
    printed_by: c.printed_by, printed_at: c.printed_at,
  }
}

export function itemCardStatement(c: ItemCard): Statement {
  const dec = c.company.decimals ?? 2
  const rows = [
    [formatDate(c.from), t('Opening balance'), '', '', '', '', '', qf(c.opening_qty), nf(c.opening_value, dec)],
    ...c.rows.map((r) => [formatDate(r.date), t(MOVEMENT[r.type] ?? r.type), r.reference ?? '', r.partner ?? r.warehouse ?? '',
      r.qty_in ? qf(r.qty_in) : '', r.qty_out ? qf(r.qty_out) : '', nf(r.unit_cost, 4), qf(r.qty), nf(r.value, dec)]),
    [formatDate(c.to), t('Closing balance'), '', '', '', '', '', qf(c.closing_qty), nf(c.closing_value, dec)],
  ]
  return {
    title: t('Item card'), subtitle: `${formatDate(c.from)} – ${formatDate(c.to)}`, company: c.company, partner: null,
    info: [[t('Item'), `${c.sku} · ${c.name}`], [t('Warehouse'), c.warehouse ?? t('All warehouses')], [t('Period'), `${formatDate(c.from)} – ${formatDate(c.to)}`]],
    tables: [{ columns: [{ label: t('Date') }, { label: t('Movement') }, { label: t('Document') }, { label: t('Partner / warehouse') }, { label: t('In'), align: 'right' },
      { label: t('Out'), align: 'right' }, { label: t('Unit cost (without VAT)'), align: 'right' }, { label: t('Quantity'), align: 'right' }, { label: t('Value at cost'), align: 'right' }], rows, strong: [0, rows.length - 1] }],
    summary: [[t('Quantity'), `${qf(c.closing_qty)} ${c.uom ?? ''}`], [t('Value at purchase price, without VAT'), `${nf(c.closing_value, dec)} ${c.currency}`, true]],
    printed_by: c.printed_by, printed_at: c.printed_at,
  }
}
