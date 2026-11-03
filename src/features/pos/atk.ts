/**
 * The till's side of ATK (Kosovo): is this till registered on this device, and signing each sale.
 * Everything here works without internet: the key and the certificate live on the device, and the
 * till's ATK numbers come with the till's data (kept on the device too).
 */
import * as React from 'react'
import { renderSVG } from 'uqr'
import { buildCoupons, CouponType, signCoupons, type SignedCoupon } from '@/lib/atk/coupon'
import { getTillKey, nextCouponSeq, type AtkEnv, type TillKey } from '@/lib/atk/keys'
import { toBase64, type TaxGroup } from '@/lib/atk/proto'
import { t } from '@/i18n'

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
  units?: Record<string, string>
}

/** printed on the receipt */
export type ReceiptFiscal = { env: AtkEnv; couponId: number; verificationNo: string; qr: string; nui: string; groups: TaxGroup[]; isReturn: boolean; referenceNo?: number | null }

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
  lines: { name: string; qty: number; price: number; total: number; rate: number; variant_id: string; tax_code_id?: string | null }[]
  payments: { method: string; amount: number }[]
  change: number
  /** a refund: the coupon of the original sale */
  returnOf?: number | null
  isReturn?: boolean
}

/** builds and signs the coupon of a sale; the payload part goes to the server with the sale */
export async function signAtkSale(s: AtkSaleInput): Promise<{ payload: Record<string, unknown>; receipt: ReceiptFiscal; signed: SignedCoupon }> {
  const a = s.atk
  if (s.isReturn && !s.returnOf) throw new Error(t('This receipt was made before the till was registered with ATK, so ATK cannot take a return of it here'))
  const exempt = new Set(a.exempt_taxes ?? [])
  const seq = await nextCouponSeq(s.registerId, a.env!, a.last_seq ?? 0)
  const built = buildCoupons({
    nui: a.nui ?? '', branchId: a.branch_id!, posId: a.pos_id!, applicationId: a.application_id!, location: a.location ?? '', operator: s.operator,
    couponSeq: seq, type: s.isReturn ? CouponType.Return : CouponType.Sale, time: s.time, referenceNo: s.returnOf ?? null,
    lines: s.lines.map((l) => ({ name: l.name, qty: l.qty, price: l.price, total: l.total, rate: l.rate, exempt: !!l.tax_code_id && exempt.has(l.tax_code_id),
      unit: a.units?.[l.variant_id] ?? null })),
    payments: s.payments, change: s.change,
  })
  const signed = await signCoupons(s.key, built)
  return {
    signed,
    payload: { env: a.env, coupon_id: signed.couponId, seq, pos_id: a.pos_id, branch_id: a.branch_id, verification_no: signed.verificationNo,
      details: signed.details, signature: signed.signature, qr: signed.qr, type: built.pos.type, reference_no: s.returnOf ?? null,
      total: signed.total, tax: signed.totalTax },
    receipt: { env: a.env!, couponId: signed.couponId, verificationNo: signed.verificationNo, qr: signed.qr, nui: a.nui ?? '', groups: signed.taxGroups,
      isReturn: !!s.isReturn, referenceNo: s.returnOf ?? null },
  }
}

/** the QR code of a receipt, as an SVG that prints sharp on a thermal printer */
export const qrSvg = (text: string) => renderSVG(text, { ecc: 'M', border: 1, pixelSize: 3 })
