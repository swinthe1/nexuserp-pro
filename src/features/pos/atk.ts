/**
 * The till's side of ATK (Kosovo): is this till registered on this device, and signing each sale.
 * Everything here works without internet: the key and the certificate live on the device, and the
 * till's ATK numbers come with the till's data (kept on the device too).
 */
import * as React from 'react'
import { renderSVG } from 'uqr'
import { buildCoupons, CouponType, signCoupons, type SignedCoupon } from '@/lib/atk/coupon'
import { getTillKey, nextCouponSeq, type AtkEnv, type TillKey } from '@/lib/atk/keys'
import { toBase64 } from '@/lib/atk/proto'
import type { FiscalHeader, FiscalPrint } from './fiscal-receipt'
import { t } from '@/i18n'
import { supabase } from '@/lib/supabase'

export type AtkTill = {
  required: boolean
  env?: AtkEnv
  nui?: string | null
  business?: string
  branch_id?: number | null
  pos_id?: number | null
  application_id?: number | null
  location?: string | null
  certified?: boolean
  public_key?: string | null
  last_seq?: number
  missing?: string[]
  exempt_taxes?: string[]
  /** ATK's unit code of each item that is not CP (copë) */
  units?: Record<string, string>
  /** ATK's category code of each item that is not the company's own */
  types?: Record<string, string>
  default_type?: string
  /** what the coupon prints at its head */
  header?: FiscalHeader
  /** the cashier's number in the staff list */
  operator_no?: string | null
  /** false for a taxpayer not registered for VAT: no VAT on its coupons (a server not updated yet sends none) */
  vat_registered?: boolean
}


export type AtkState =
  | { status: 'off' }
  | { status: 'loading' }
  | { status: 'ready'; key: TillKey }
  | { status: 'blocked'; reason: 'setup' | 'not_registered' | 'other_device'; missing: string[] }

/** whether this device can sign for this till */
export function useAtkState(registerId: string, atk: AtkTill | undefined): AtkState {
  const [state, setState] = React.useState<AtkState>({ status: atk?.required ? 'loading' : 'off' })
  React.useEffect(() => {
    let alive = true
    if (!atk?.required || !atk.env) { setState({ status: 'off' }); return }
    if (atk.missing?.length) { setState({ status: 'blocked', reason: 'setup', missing: atk.missing }); return }
    void getTillKey(registerId, atk.env).then((key) => {
      if (!alive) return
      if (!key?.certificate) setState({ status: 'blocked', reason: atk.certified ? 'other_device' : 'not_registered', missing: [] })
      else if (!atk.certified || toBase64(key.publicKey) !== atk.public_key) setState({ status: 'blocked', reason: atk.certified ? 'other_device' : 'not_registered', missing: [] })
      else setState({ status: 'ready', key })
    }, () => alive && setState({ status: 'blocked', reason: 'not_registered', missing: [] }))
    return () => { alive = false }
  }, [registerId, atk])
  return state
}

export interface AtkSaleInput {
  registerId: string
  atk: AtkTill
  key: TillKey
  operator: string
  time: Date
  lines: { name: string; qty: number; price: number; total: number; rate: number; variant_id: string; tax_code_id?: string | null
    /** how the line's own discount was given (for the paper), and its share of a discount on the whole sale, in euro */
    discountPct?: number | null; discountValue?: number | null; saleShare?: number | null }[]
  /** a discount on the whole sale given as a percentage (for the paper) */
  saleDiscountPct?: number | null
  payments: { method: string; amount: number }[]
  change: number
  /** a refund: the coupon of the original sale */
  returnOf?: number | null
  isReturn?: boolean
  /** a cancellation of the whole coupon, with its reason (ATK's "Kupon i Anulimit") */
  cancelReason?: string | null
  /** the till's count of the day, printed on the coupon */
  dailyNo?: number | null
  offline?: boolean
  footer?: string | null
  /** a coupon from the fiscal receipt book, registered after the till was down: the book's number */
  blockNo?: string | null
}

/** the same item at the same price and discount is one line on a fiscal coupon (Kërkesat, neni 25.18) */
function mergeLines(lines: AtkSaleInput['lines']) {
  const out: AtkSaleInput['lines'] = []
  const at = new Map<string, number>()
  for (const l of lines) {
    const k = `${l.variant_id}|${l.price}|${l.rate}|${l.qty ? Math.round(l.total / l.qty * 10000) : 0}|${l.discountValue ? "v" : "p"}|${l.saleShare ? "s" : ""}`
    const i = at.get(k)
    if (i === undefined) { at.set(k, out.length); out.push({ ...l }) }
    else {
      const m = out[i]!
      m.qty = Math.round((m.qty + l.qty) * 10000) / 10000; m.total = Math.round((m.total + l.total) * 100) / 100
      if (l.discountValue) m.discountValue = Math.round(((m.discountValue ?? 0) + l.discountValue) * 100) / 100
      if (l.saleShare) m.saleShare = Math.round(((m.saleShare ?? 0) + l.saleShare) * 100) / 100
    }
  }
  return out
}

/** builds and signs the coupon of a sale; the payload part goes to the server with the sale */
export async function signAtkSale(s: AtkSaleInput): Promise<{ payload: Record<string, unknown>; receipt: FiscalPrint; signed: SignedCoupon }> {
  const a = s.atk
  const cancel = !!s.cancelReason
  if ((s.isReturn || cancel) && !s.returnOf) throw new Error(t('This receipt was made before the till was registered with ATK, so ATK cannot take a return of it here'))
  const exempt = new Set(a.exempt_taxes ?? [])
  // a taxpayer not registered for VAT charges none: every line goes under the 0 % letter (C), never the exempt one
  const noVat = a.vat_registered === false
  const seq = await nextCouponSeq(s.registerId, a.env!, a.last_seq ?? 0)
  const built = buildCoupons({
    nui: a.nui ?? '', branchId: a.branch_id!, posId: a.pos_id!, applicationId: a.application_id!, location: a.location ?? '', operator: s.operator,
    couponSeq: seq, type: cancel ? CouponType.Cancel : s.isReturn ? CouponType.Return : CouponType.Sale, time: s.time, referenceNo: s.returnOf ?? null,
    saleDiscount: s.saleDiscountPct ? { pct: s.saleDiscountPct } : null,
    lines: mergeLines(s.lines).map((l) => ({ name: l.name, qty: l.qty, price: l.price, total: l.total, rate: noVat ? 0 : l.rate, exempt: !noVat && !!l.tax_code_id && exempt.has(l.tax_code_id),
      discountPct: l.discountPct ?? null, discountValue: l.discountValue ?? null, saleShare: l.saleShare ?? null,
      unit: a.units?.[l.variant_id] ?? 'CP', category: a.types?.[l.variant_id] ?? a.default_type ?? 'TT' })),
    payments: s.payments, change: s.change,
  })
  const signed = await signCoupons(s.key, built)
  return {
    signed,
    payload: { env: a.env, coupon_id: signed.couponId, seq, pos_id: a.pos_id, branch_id: a.branch_id, verification_no: signed.verificationNo,
      details: signed.details, signature: signed.signature, qr: signed.qr, type: built.pos.type, reference_no: s.returnOf ?? null,
      total: signed.total, tax: signed.totalTax, daily_no: s.dailyNo ?? null, reason: s.cancelReason ?? null, operator_no: a.operator_no ?? null, block_no: s.blockNo ?? null,
      print: built.print },
    receipt: { env: a.env!, nui: a.nui ?? '', header: { ...(a.header ?? { legal_name: a.business ?? '', store: null, store_address: null, city: a.location ?? null, phone: null, vat_number: null }), ...(noVat ? { vat_number: null } : {}) },
      operator: s.operator, operatorNo: a.operator_no ?? null, coupon: built.pos, qr: signed.qr, dailyNo: s.dailyNo ?? null, reason: s.cancelReason ?? null,
      offline: !!s.offline, change: Math.round(Math.max(s.change, 0) * 100), footer: s.footer ?? null, blockNo: s.blockNo ?? null, print: built.print },
  }
}

/**
 * After a sale, before its coupon is printed: the coupon goes to ATK first when the till is online (Kërkesat, neni 26.5).
 * Waits up to a few seconds for the server to hand it to ATK; a coupon ATK has not taken by then prints marked OFFLINE.
 */
export async function waitForAtk(registerId: string, couponId: number, ms = 8000): Promise<{ status: string | null; error: string | null; refused: number }> {
  const until = Date.now() + ms
  let last: { status: string | null; error: string | null; refused: number } = { status: null, error: null, refused: 0 }
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 600))
    try {
      const { data } = await supabase.rpc('atk_coupon_status', { p_register: registerId, p_coupon: couponId })
      const d = data as unknown as { status: string | null; error: string | null; refused: number } | null
      if (d) last = { status: d.status, error: d.error, refused: Number(d.refused ?? 0) }
      if (last.status === 'fiscalized' || last.status === 'failed') return last
    } catch { /* keep waiting */ }
  }
  return last
}

/** the QR code of a receipt, as an SVG that prints sharp on a thermal printer */
export const qrSvg = (text: string) => renderSVG(text, { ecc: 'M', border: 1, pixelSize: 3 })
