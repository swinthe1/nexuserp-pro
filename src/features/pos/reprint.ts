/**
 * A receipt printed again. A fiscal coupon is rebuilt from what was signed and marked "KOPJE E KUPONIT"
 * (Kërkesat, neni 25.18); nothing goes to ATK again. Used by the shift's page and by the till itself.
 */
import type { CouponPrint } from '@/lib/atk/coupon'
import { decodePosCoupon, fromBase64 } from '@/lib/atk/proto'
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { num } from '@/lib/utils'
import type { FiscalHeader } from './fiscal-receipt'
import type { ReceiptData } from './receipt'

type AtkReceipt = { atk: { env: 'test' | 'production'; details: string; qr: string; daily_no?: number | null; reason?: string | null; operator_no?: string | null; block_no?: string | null; print?: CouponPrint | null }
  number: string; device_ref: string | null; order_at: string; nui: string | null; cashier: string | null; fiscal_status: string | null
  register: { code: string; name: string; receipt_header: string | null; receipt_footer: string | null }; header: FiscalHeader }

export async function receiptCopy(orderId: string, a: { registerId: string; paperMm?: number | null; currency: string; companyName: string }): Promise<ReceiptData> {
  const fr = unwrap(await supabase.rpc('atk_receipt', { p_order: orderId })) as unknown as AtkReceipt | null
  if (fr?.atk?.details) {
    return { company: { name: fr.header.legal_name, legal_name: null, tax_number: fr.nui, address: null }, register: { ...fr.register, paper_mm: a.paperMm },
      ref: fr.device_ref ?? fr.number, number: fr.number, date: new Date(fr.order_at), cashier: fr.cashier ?? '', currency: a.currency, lines: [], payments: [], change: 0,
      fiscal: { env: fr.atk.env, nui: fr.nui ?? '', header: fr.header, operator: fr.cashier ?? '', operatorNo: fr.atk.operator_no ?? null,
        coupon: decodePosCoupon(fromBase64(fr.atk.details)), qr: fr.atk.qr, dailyNo: fr.atk.daily_no ?? (Number(fr.device_ref?.split('-').at(-1)) || null), reason: fr.atk.reason ?? null,
        offline: fr.fiscal_status !== 'fiscalized', copy: true, footer: fr.register.receipt_footer, blockNo: fr.atk.block_no ?? null, print: fr.atk.print ?? null } }
  }
  const o = unwrap(await supabase.from('pos_orders').select('number, device_ref, order_at, is_refund, change_given, partner:business_partners(name), lines:pos_order_lines(description, quantity, unit_price, discount_pct, line_total, tax_rate, line_no), payments:pos_payments(method, amount)')
    .eq('id', orderId).single().returns<{ number: string; device_ref: string | null; order_at: string; is_refund: boolean; change_given: number; partner: { name: string } | null
      lines: { description: string; quantity: number; unit_price: number; discount_pct: number; line_total: number; tax_rate: number; line_no: number }[]; payments: { method: string; amount: number }[] }>())
  const reg = unwrap(await supabase.from('pos_registers').select('*').eq('id', a.registerId).single())
  return {
    company: { name: a.companyName, legal_name: null, tax_number: null, address: null }, register: reg,
    ref: o.device_ref ?? o.number, number: o.number, date: new Date(o.order_at), cashier: '', customer: o.partner?.name, isRefund: o.is_refund, currency: a.currency,
    lines: [...o.lines].sort((x, y) => x.line_no - y.line_no).map((l) => ({ name: l.description, qty: num(l.quantity), price: num(l.unit_price), discount: num(l.discount_pct), total: num(l.line_total), rate: num(l.tax_rate) })),
    payments: o.payments.map((p) => ({ method: p.method, amount: num(p.amount) })), change: num(o.change_given),
  }
}
