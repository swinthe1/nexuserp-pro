/**
 * A printed document: what document_print returns, the company's print settings, and the words
 * every layout needs (titles, amount in words). The HTML print and the PDF are both drawn from this.
 */
import { msg, t } from '@/i18n'
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

export type DocKind = 'sales_invoice' | 'sales_quote' | 'proforma_quote' | 'sales_order' | 'proforma' | 'delivery' | 'payment' | 'purchase_order' | 'goods_receipt'

export type PrintSettings = {
  /** main colour of titles and lines */
  accent?: string
  logo_position?: 'left' | 'right'
  show_codes?: boolean
  show_discount?: boolean
  show_banks?: boolean
  show_signatures?: boolean
  show_words?: boolean
  /** a delivery note shows prices (otherwise only quantities) */
  delivery_prices?: boolean
  footer?: string
  /** a text printed under each kind of document (terms of a quote, a note on invoices…) */
  texts?: Partial<Record<string, string>>
}
export const PRINT_DEFAULTS: Required<Omit<PrintSettings, 'footer' | 'texts'>> = {
  accent: '#1f3a8a', logo_position: 'left', show_codes: true, show_discount: true, show_banks: true, show_signatures: true, show_words: true, delivery_prices: false,
}

export type PrintLine = {
  code: string | null; description: string; uom: string | null; qty: number; price: number | null; discount: number | null
  tax_rate: number; net: number; tax: number; total: number; lot?: string | null; pack?: string | null; delivered?: number; location?: string | null; expected?: string | null
}
export type PrintParty = { name: string; legal_name?: string | null; code?: string | null; tax_number?: string | null; vat_number?: string | null; phone?: string | null; email?: string | null; address?: string | null }
export type PrintDoc = {
  kind: 'sales_invoice' | 'credit_note' | 'sales_quote' | 'proforma' | 'sales_order' | 'delivery' | 'receipt_voucher' | 'payment_voucher' | 'purchase_order' | 'goods_receipt'
  number: string; date: string; due_date?: string | null; valid_until?: string | null; requested_date?: string | null; expected_date?: string | null
  currency: string; rate?: number; status?: string; notes?: string | null; terms?: string | null; reference?: string | null; payment_term?: string | null
  salesperson?: string | null; buyer?: string | null; by?: string | null; order?: string | null; original?: string | null; warehouse?: string | null
  carrier?: string | null; tracking?: string | null; packages?: number | null; weight?: number | null; incoterm?: string | null; deliver_to?: string | null; ship_to?: string | null
  method?: string; account?: string | null; cash?: boolean; unallocated?: number; receipt_type?: string
  allocations?: { number: string; reference: string | null; date: string; amount: number }[]
  subtotal?: number; discount_total?: number; tax_total?: number; total: number; total_base?: number; paid?: number; due?: number
  partner_id?: string | null; partner: PrintParty | null
  lines: PrintLine[]; vat: { rate: number; base: number; tax: number }[]
  fiscal?: { iic: string | null; fic: string | null; tcr: string | null; business_unit: string | null; operator: string | null; qr_url: string | null } | null
  company: PrintParty & { website?: string | null; business_number?: string | null; country: string; base_currency: string; logo: string | null; footer: string | null
    settings: PrintSettings; decimals: number; banks: { bank: string; iban: string; swift: string | null; currency: string }[] }
  printed_by: string | null; printed_at: string
}

export async function fetchPrintDoc(kind: DocKind, id: string) {
  return unwrap(await supabase.rpc('document_print', { p_kind: kind, p_id: id })) as unknown as PrintDoc
}

export const settingsOf = (d: PrintDoc): Required<Omit<PrintSettings, 'footer' | 'texts'>> & PrintSettings => ({ ...PRINT_DEFAULTS, ...(d.company.settings ?? {}) })

const TITLE: Record<PrintDoc['kind'], string> = {
  sales_invoice: msg('Invoice'), credit_note: msg('Credit note'), sales_quote: msg('Offer'), proforma: msg('Pro forma invoice'),
  sales_order: msg('Order confirmation'), delivery: msg('Delivery note'), receipt_voucher: msg('Cash receipt'), payment_voucher: msg('Payment voucher'),
  purchase_order: msg('Purchase order'), goods_receipt: msg('Goods received note'),
}
export const docTitle = (d: PrintDoc) => d.kind === 'receipt_voucher' && d.cash === false ? t('Payment received') : d.kind === 'payment_voucher' && d.cash === false ? t('Payment made') : t(TITLE[d.kind])
export const partnerLabel = (d: PrintDoc) =>
  ['purchase_order', 'goods_receipt', 'payment_voucher'].includes(d.kind) ? t('Supplier') : d.kind === 'receipt_voucher' ? t('Received from') : t('Customer')
export const METHOD: Record<string, string> = {
  cash: msg('In cash'), card: msg('By card'), cheque: msg('By cheque'), bank_transfer: msg('By bank transfer'), offset: msg('By offset'), other: msg('Other way'),
}
export const isVoucher = (d: PrintDoc) => d.kind === 'receipt_voucher' || d.kind === 'payment_voucher'
/** documents without prices on paper: a delivery note (unless the company wants them) */
export const showPrices = (d: PrintDoc) => d.kind !== 'delivery' || !!settingsOf(d).delivery_prices
export const fileName = (d: PrintDoc) => `${docTitle(d)} ${d.number}`.replace(/[\\/:*?"<>|]+/g, '-') + '.pdf'
/** the key of the per-document text in the settings */
export const textKey = (d: PrintDoc) => ({ credit_note: 'sales_invoice', receipt_voucher: 'payment', payment_voucher: 'payment' } as Record<string, string>)[d.kind] ?? d.kind

/* --------------------------------------------------------------- amount in words (Albanian) */
const ONES = ['zero', 'një', 'dy', 'tre', 'katër', 'pesë', 'gjashtë', 'shtatë', 'tetë', 'nëntë', 'dhjetë', 'njëmbëdhjetë', 'dymbëdhjetë', 'trembëdhjetë',
  'katërmbëdhjetë', 'pesëmbëdhjetë', 'gjashtëmbëdhjetë', 'shtatëmbëdhjetë', 'tetëmbëdhjetë', 'nëntëmbëdhjetë']
const TENS = ['', '', 'njëzet', 'tridhjetë', 'dyzet', 'pesëdhjetë', 'gjashtëdhjetë', 'shtatëdhjetë', 'tetëdhjetë', 'nëntëdhjetë']
function below1000(n: number): string {
  const h = Math.floor(n / 100), r = n % 100
  const parts: string[] = []
  if (h) parts.push(`${ONES[h]}qind`)
  if (r) parts.push(r < 20 ? ONES[r] : TENS[Math.floor(r / 10)] + (r % 10 ? ` e ${ONES[r % 10]}` : ''))
  return parts.join(' e ')
}
export function numberWordsSq(n: number): string {
  n = Math.floor(Math.abs(n))
  if (n === 0) return 'zero'
  const parts: string[] = []
  const bil = Math.floor(n / 1e9), mil = Math.floor(n / 1e6) % 1000, th = Math.floor(n / 1000) % 1000, rest = n % 1000
  if (bil) parts.push(`${below1000(bil)} ${bil === 1 ? 'miliard' : 'miliardë'}`)
  if (mil) parts.push(`${below1000(mil)} ${mil === 1 ? 'milion' : 'milionë'}`)
  if (th) parts.push(`${below1000(th)} mijë`)
  if (rest) parts.push(below1000(rest))
  return parts.join(' e ')
}
const CUR: Record<string, [string, string | null]> = { EUR: ['euro', 'cent'], ALL: ['lekë', null], USD: ['dollarë', 'cent'], CHF: ['franga zvicerane', 'centime'], GBP: ['paund', 'peni'] }
/** “Njëqind e njëzet euro e 50 cent” */
export function amountInWords(amount: number, currency: string): string {
  const [main, sub] = CUR[currency] ?? [currency, null]
  const abs = Math.abs(amount)
  let whole = Math.floor(abs + 1e-9)
  let cents = Math.round((abs - whole) * 100)
  if (cents === 100) { whole += 1; cents = 0 }
  const w = numberWordsSq(whole)
  const s = `${w.charAt(0).toUpperCase()}${w.slice(1)} ${main}`
  return (amount < 0 ? 'Minus ' + s.charAt(0).toLowerCase() + s.slice(1) : s) + (cents ? sub ? ` e ${cents} ${sub}` : ` e ${cents}/100` : '')
}
