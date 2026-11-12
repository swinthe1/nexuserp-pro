/**
 * A till sale → ATK's two coupons:
 * - the POS coupon (every line, every payment), sent to ATK;
 * - the citizen coupon (totals only), printed as the QR code that a citizen scans.
 * Both are signed on the till with its own key, so they can be made without internet and sent later.
 */
import { CouponType, encodeCitizenCoupon, encodePosCoupon, PaymentType, toBase64, type CitizenCoupon, type CouponItem, type Payment, type PosCoupon, type TaxGroup, type TaxLetter } from './proto'
import { signText, type TillKey } from './keys'
import { t } from '@/i18n'

export { CouponType }
export const RATE_OF: Record<TaxLetter, number> = { A: 0, C: 0, D: 8, E: 18 }

/** the ATK letter for a VAT rate: A exempt, C 0 %, D 8 %, E 18 % */
export function taxLetter(rate: number, exempt = false): TaxLetter {
  if (exempt) return 'A'
  if (Math.abs(rate) < 1e-9) return 'C'
  if (Math.abs(rate - 8) < 1e-9) return 'D'
  if (Math.abs(rate - 18) < 1e-9) return 'E'
  throw new Error(t('VAT {rate}% has no ATK letter (only 18%, 8%, 0% and exempt)', { rate }))
}

const PAY: Record<string, PaymentType> = { cash: PaymentType.Cash, card: PaymentType.CreditCard, voucher: PaymentType.Voucher, gift_card: PaymentType.Voucher,
  cheque: PaymentType.Cheque, check: PaymentType.Cheque, crypto: PaymentType.CryptoCurrency }

/** the coupon number, unique for the business: store (1–999), till (1–99), then the till's own count */
export function couponIdOf(branchId: number, posId: number, seq: number) {
  if (!Number.isInteger(branchId) || branchId < 1 || branchId > 999) throw new Error(t('The store\'s ATK number must be from 1 to 999'))
  if (!Number.isInteger(posId) || posId < 1 || posId > 99) throw new Error(t('The till\'s ATK number must be from 1 to 99'))
  if (!Number.isInteger(seq) || seq < 1 || seq >= 1e9) throw new Error(t('The till\'s coupon count is out of range'))
  return (branchId * 100 + posId) * 1e9 + seq
}

/** 16 random digits, unique enough for each coupon (the citizen app checks it) */
export function verificationNo() {
  const b = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(b, (x) => String(x % 10)).join('')
}

export interface AtkSaleLine {
  name: string
  /** quantity sold (a return line may come negative: only the size is used) */
  qty: number
  /** unit price with VAT, before the discount (the price on the shelf) */
  price: number
  /** line total with VAT, after every discount */
  total: number
  /** how the discount was given, for the printed coupon: a percentage, or an amount in euro; without it the percentage is worked out */
  discountPct?: number | null
  discountValue?: number | null
  /** the part of a discount on the whole sale that fell on this line, in euro (it is inside "total" already) */
  saleShare?: number | null
  /** VAT % */
  rate: number
  exempt?: boolean
  unit?: string | null
  category?: string | null
}
export interface AtkSale {
  nui: string
  branchId: number
  posId: number
  applicationId: number
  location: string
  operator: string
  couponSeq: number
  type: CouponType
  time: Date
  /** the original coupon of a return or a cancellation */
  referenceNo?: number | null
  lines: AtkSaleLine[]
  /** a return or a cancellation: the coupon it is about, for the paper (Shtojca F) */
  origin?: { coupon: PosCoupon; print?: CouponPrint | null; dailyNo: number | null; refundedBefore: number } | null
  unitNo?: string | null
  /** a discount on the whole sale (already shared out in the lines' totals), for the printed coupon */
  saleDiscount?: { pct?: number | null } | null
  payments: { method: string; amount: number }[]
  change?: number
}

const cents = (v: number) => Math.round(Math.abs(v) * 100)

/**
 * What the printed coupon needs and ATK's coupon does not carry: ATK takes each line's price with the discount in it,
 * the paper shows the shelf price, then the discount with a minus (Kërkesat, neni 25.18). Kept with the coupon for its copies.
 */
export interface CouponPrint {
  /** one per coupon line: the shelf price in ten-thousandths, the line's own discount in cents, and how it was given */
  lines: { list: number; off: number; pct?: number; value?: boolean }[]
  /** the discount on the whole sale, in cents */
  sale?: { off: number; pct?: number } | null
  /**
   * On a return or a cancellation: the coupon it is about, as Shtojca F prints it above the returned items
   * (its daily number and time, its lines, total, payments and VAT), and what is left of it after this return, in cents.
   */
  orig?: CouponOrigin | null
  /** the unit's registration number, the first part of the SEF's identification number on the paper */
  unitNo?: string | null
}
export interface CouponOrigin {
  no: number | null
  /** unix seconds */
  time: number
  /** name, quantity, shelf price (ten-thousandths), amount before the discount (cents), own discount (cents), VAT letter */
  items?: [string, number, number, number, number, string][]
  sale?: { off: number; pct?: number } | null
  total?: number
  payments?: [number, number][]
  taxGroups?: TaxGroup[]
  totalNoTax?: number
  left?: number
}

/** the coupon a return is about, made small for the paper */
export function originOf(c: PosCoupon, print: CouponPrint | null | undefined, no: number | null, refundedBefore: number, thisReturn: number): CouponOrigin {
  return {
    no, time: c.time, total: c.total, totalNoTax: c.totalNoTax, taxGroups: c.taxGroups, payments: c.payments.map((p) => [p.type, p.amount]),
    items: c.items.slice(0, 150).map((i, k) => {
      const p = print?.lines[k]
      const list = p?.list ?? i.price
      const gross = Math.max(Math.round(list * i.quantity / 100), Math.round(i.total / 100))
      return [i.name.slice(0, 60), i.quantity, list, gross, p ? Math.min(p.off, gross) : gross - Math.round(i.total / 100), i.taxRate]
    }),
    sale: print?.sale ?? null,
    left: Math.max(c.total - Math.round(refundedBefore * 100) - thisReturn, 0),
  }
}


export function buildCoupons(s: AtkSale, verification = verificationNo()) {
  if (!/^\d{9}$/.test(s.nui)) throw new Error(t('The company\'s NUI must have 9 digits'))
  if (!s.lines.length) throw new Error(t('A coupon needs at least one line'))
  if ((s.type === CouponType.Return || s.type === CouponType.Cancel) && !s.referenceNo) throw new Error(t('A return or a cancellation needs the original coupon'))
  const couponId = couponIdOf(s.branchId, s.posId, s.couponSeq)
  const items: CouponItem[] = s.lines.map((l) => {
    const qty = Math.abs(l.qty), net = cents(l.total)
    return {
      // ATK (the invitation to the technical test, 12 November 2026): the price of a line is the price WITH its discount,
      // in "price" as in "total"; four decimals, so quantity × price gives the total
      name: l.name.slice(0, 200), price: qty > 0 ? Math.round(net * 100 / qty) : Math.round(Math.abs(l.price) * 10000),
      unit: (l.unit || 'CP').slice(0, 20), quantity: qty,
      // ATK's documentation (8 June 2026): a line's total is in ten-thousandths, like its price; the coupon's totals stay in cents
      total: net * 100, taxRate: taxLetter(l.rate, l.exempt), type: (l.category || 'TT').slice(0, 20),
    }
  })
  // for the paper: the shelf price, each line's own discount, and the sale's discount apart
  const print: CouponPrint = {
    lines: s.lines.map((l) => {
      const all = Math.max(cents(l.qty * l.price) - cents(l.total), 0)
      const off = Math.max(all - Math.min(cents(l.saleShare ?? 0), all), 0)
      return { list: Math.round(Math.abs(l.price) * 10000), off,
        ...(off > 0 && l.discountValue ? { value: true } : off > 0 && l.discountPct ? { pct: l.discountPct } : {}) }
    }),
  }
  const saleOff = s.lines.reduce((n, l) => n + Math.min(cents(l.saleShare ?? 0), Math.max(cents(l.qty * l.price) - cents(l.total), 0)), 0)
  if (saleOff > 0) print.sale = { off: saleOff, ...(s.saleDiscount?.pct ? { pct: s.saleDiscount.pct } : {}) }
  const lineCents = (i: CouponItem) => i.total / 100
  const total = items.reduce((n, i) => n + lineCents(i), 0)
  const discount = s.lines.reduce((n, l) => n + Math.max(cents(l.qty * l.price) - cents(l.total), 0), 0)

  // VAT by letter, from the totals with VAT: the base is rounded, the VAT is what is left, so they always add up
  const gross = new Map<TaxLetter, number>()
  for (const i of items) gross.set(i.taxRate, (gross.get(i.taxRate) ?? 0) + lineCents(i))
  const taxGroups: TaxGroup[] = (['A', 'C', 'D', 'E'] as TaxLetter[]).filter((k) => gross.has(k)).map((k) => {
    const g = gross.get(k)!
    const base = Math.round(g / (1 + RATE_OF[k] / 100))
    return { taxRate: k, totalForTax: base, totalTax: g - base }
  })
  const totalTax = taxGroups.reduce((n, g) => n + g.totalTax, 0)

  // what the customer paid, without the change given back: it adds up to the total
  const pays = new Map<PaymentType, number>()
  let change = cents(s.change ?? 0)
  for (const p of [...s.payments].sort((a, b) => Number(b.method === 'cash') - Number(a.method === 'cash'))) {
    let a = cents(p.amount)
    if (p.method === 'cash' && change) { const c = Math.min(change, a); a -= c; change -= c }
    if (!a) continue
    const t = PAY[p.method] ?? PaymentType.Other
    pays.set(t, (pays.get(t) ?? 0) + a)
  }
  const payments: Payment[] = [...pays.entries()].map(([type, amount]) => ({ type, amount }))
  const paid = payments.reduce((n, p) => n + p.amount, 0)
  if (payments.length && paid !== total) {
    // a cent of rounding goes on the biggest payment
    const big = payments.reduce((a, b) => (b.amount > a.amount ? b : a))
    big.amount += total - paid
  } else if (!payments.length) payments.push({ type: PaymentType.Cash, amount: total })

  const time = Math.floor(s.time.getTime() / 1000)
  const pos: PosCoupon = {
    businessId: Number(s.nui), couponId, branchId: s.branchId, location: s.location.slice(0, 100), operatorId: s.operator.slice(0, 100), posId: s.posId,
    applicationId: s.applicationId, verificationNo: verification, type: s.type, time, items, payments, total, taxGroups,
    totalTax, totalNoTax: total - totalTax, referenceNo: s.referenceNo ?? 0, totalDiscount: discount,
  }
  const citizen: CitizenCoupon = {
    businessId: pos.businessId, couponId, branchId: s.branchId, posId: s.posId, verificationNo: verification, type: s.type, time,
    total, taxGroups, totalTax, totalNoTax: pos.totalNoTax,
  }
  if (s.origin) print.orig = originOf(s.origin.coupon, s.origin.print, s.origin.dailyNo, s.origin.refundedBefore, s.type === CouponType.Cancel ? s.origin.coupon.total : total)
  if (s.unitNo) print.unitNo = s.unitNo
  return { pos, citizen, couponId, verificationNo: verification, print }
}

export interface SignedCoupon {
  couponId: number
  verificationNo: string
  /** Base64 of the POS coupon, as sent to ATK */
  details: string
  signature: string
  /** the text of the QR code: Base64 of the citizen coupon | its signature */
  qr: string
  taxGroups: TaxGroup[]
  total: number
  totalTax: number
}

export async function signCoupons(key: TillKey, c: ReturnType<typeof buildCoupons>): Promise<SignedCoupon> {
  const details = toBase64(encodePosCoupon(c.pos))
  const citizen = toBase64(encodeCitizenCoupon(c.citizen))
  const [signature, citizenSig] = await Promise.all([signText(key, details), signText(key, citizen)])
  return { couponId: c.couponId, verificationNo: c.verificationNo, details, signature, qr: `${citizen}|${citizenSig}`,
    taxGroups: c.pos.taxGroups, total: c.pos.total, totalTax: c.pos.totalTax }
}
