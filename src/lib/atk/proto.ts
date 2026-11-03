/**
 * The ATK fiscal coupon in Protobuf (proto3), written by hand from ATK's models.proto
 * (github.com/fiskalizimi/pos-golang, package atk). Only what DrisPRO sends is here: no reader.
 *
 * proto3 rules kept here: a field with its zero value is not written; fields go in number order;
 * repeated messages are written one after the other with the same field number.
 */

export enum CouponType { Sale = 1, Cancel = 2, Return = 3 }
export enum PaymentType { Cash = 1, CreditCard = 2, Voucher = 3, Cheque = 4, CryptoCurrency = 5, Other = 6 }

/** ATK's VAT letters: A exempt, C 0 %, D 8 %, E 18 % */
export type TaxLetter = 'A' | 'C' | 'D' | 'E'

export interface CouponItem {
  name: string
  /** unit price with VAT, in ten-thousandths of a euro (1.00 € = 10000) */
  price: number
  unit: string
  quantity: number
  /** line total with VAT, in ten-thousandths of a euro like the price (ATK's documentation since 8 June 2026) */
  total: number
  taxRate: TaxLetter
  type: string
}
export interface Payment { type: PaymentType; amount: number }
/** totals in cents: totalForTax is the amount without VAT, totalTax the VAT on it */
export interface TaxGroup { taxRate: TaxLetter; totalForTax: number; totalTax: number }

export interface PosCoupon {
  businessId: bigint | number
  couponId: bigint | number
  branchId: bigint | number
  location: string
  operatorId: string
  posId: bigint | number
  applicationId: bigint | number
  verificationNo: string
  type: CouponType
  /** unix seconds */
  time: number
  items: CouponItem[]
  payments: Payment[]
  total: number
  taxGroups: TaxGroup[]
  totalTax: number
  totalNoTax: number
  referenceNo: bigint | number
  totalDiscount: number
}
export type CitizenCoupon = Pick<PosCoupon, 'businessId' | 'couponId' | 'branchId' | 'posId' | 'verificationNo' | 'type' | 'time' | 'total' | 'taxGroups' | 'totalTax' | 'totalNoTax'>

class Writer {
  private bytes: number[] = []
  private varint(v: bigint) {
    // negative int64 is written as its 64-bit two's complement (10 bytes), as protobuf does
    let x = v < 0n ? v + (1n << 64n) : v
    while (x > 0x7fn) { this.bytes.push(Number(x & 0x7fn) | 0x80); x >>= 7n }
    this.bytes.push(Number(x))
  }
  private tag(field: number, wire: number) { this.varint(BigInt((field << 3) | wire)) }
  /** uint64, int64 and enums */
  int(field: number, v: bigint | number) {
    const b = typeof v === 'bigint' ? v : BigInt(Math.trunc(v))
    if (b === 0n) return this
    this.tag(field, 0); this.varint(b)
    return this
  }
  string(field: number, v: string) {
    if (!v) return this
    const b = new TextEncoder().encode(v)
    this.tag(field, 2); this.varint(BigInt(b.length)); this.bytes.push(...b)
    return this
  }
  float(field: number, v: number) {
    if (v === 0) return this
    const b = new Uint8Array(4)
    new DataView(b.buffer).setFloat32(0, v, true)
    this.tag(field, 5); this.bytes.push(...b)
    return this
  }
  message(field: number, m: Uint8Array) {
    // an empty message is still written when it is an element of a repeated field
    this.tag(field, 2); this.varint(BigInt(m.length)); this.bytes.push(...m)
    return this
  }
  finish() { return Uint8Array.from(this.bytes) }
}

const taxGroup = (g: TaxGroup) => new Writer().string(1, g.taxRate).int(2, g.totalForTax).int(3, g.totalTax).finish()
const item = (i: CouponItem) => new Writer().string(1, i.name).int(2, i.price).string(3, i.unit).float(4, i.quantity)
  .int(5, i.total).string(6, i.taxRate).string(7, i.type).finish()
const payment = (p: Payment) => new Writer().int(1, p.type).int(2, p.amount).finish()

export function encodePosCoupon(c: PosCoupon): Uint8Array {
  const w = new Writer().int(1, c.businessId).int(2, c.couponId).int(3, c.branchId).string(4, c.location).string(5, c.operatorId)
    .int(6, c.posId).int(7, c.applicationId).string(8, c.verificationNo).int(9, c.type).int(10, c.time)
  c.items.forEach((i) => w.message(11, item(i)))
  c.payments.forEach((p) => w.message(12, payment(p)))
  w.int(13, c.total)
  c.taxGroups.forEach((g) => w.message(14, taxGroup(g)))
  // 18 (TransactionNo) is given by ATK, never by the till
  return w.int(15, c.totalTax).int(16, c.totalNoTax).int(17, c.referenceNo).int(19, c.totalDiscount).finish()
}

export function encodeCitizenCoupon(c: CitizenCoupon): Uint8Array {
  const w = new Writer().int(1, c.businessId).int(2, c.couponId).int(3, c.branchId).int(4, c.posId).string(5, c.verificationNo)
    .int(6, c.type).int(7, c.time).int(8, c.total)
  c.taxGroups.forEach((g) => w.message(9, taxGroup(g)))
  return w.int(10, c.totalTax).int(11, c.totalNoTax).finish()
}

export function toBase64(b: Uint8Array) {
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(s)
}
export function fromBase64(s: string) {
  const bin = atob(s)
  const b = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i)
  return b
}

/* ------------------------------------------------------------------ reading a POS coupon back (a copy is printed from what was signed) */
class Reader {
  private i = 0
  constructor(private b: Uint8Array) {}
  done() { return this.i >= this.b.length }
  varint(): bigint {
    let r = 0n, s = 0n
    for (;;) {
      const x = this.b[this.i++]
      if (x === undefined) throw new Error('The coupon is cut short')
      r |= BigInt(x & 0x7f) << s
      if (!(x & 0x80)) break
      s += 7n
    }
    return r
  }
  tag() { const t = Number(this.varint()); return { field: t >> 3, wire: t & 7 } }
  bytes() { const n = Number(this.varint()); const v = this.b.subarray(this.i, this.i + n); this.i += n; return v }
  float() { const v = new DataView(this.b.buffer, this.b.byteOffset + this.i, 4).getFloat32(0, true); this.i += 4; return v }
  skip(wire: number) { if (wire === 0) this.varint(); else if (wire === 2) this.bytes(); else if (wire === 5) this.i += 4; else if (wire === 1) this.i += 8; else throw new Error('Unknown field in the coupon') }
}
const int64 = (v: bigint) => Number(v >= 1n << 63n ? v - (1n << 64n) : v)
const text = (b: Uint8Array) => new TextDecoder().decode(b)

function readMessage<T>(b: Uint8Array, init: T, on: (r: Reader, field: number, wire: number, m: T) => boolean): T {
  const r = new Reader(b)
  while (!r.done()) { const { field, wire } = r.tag(); if (!on(r, field, wire, init)) r.skip(wire) }
  return init
}

export function decodePosCoupon(b: Uint8Array): PosCoupon {
  return readMessage(b, { businessId: 0, couponId: 0, branchId: 0, location: '', operatorId: '', posId: 0, applicationId: 0, verificationNo: '', type: CouponType.Sale,
    time: 0, items: [], payments: [], total: 0, taxGroups: [], totalTax: 0, totalNoTax: 0, referenceNo: 0, totalDiscount: 0 } as PosCoupon, (r, f, w, m) => {
    if (w === 0) {
      const v = r.varint()
      const k = ({ 1: 'businessId', 2: 'couponId', 3: 'branchId', 6: 'posId', 7: 'applicationId', 9: 'type', 10: 'time', 13: 'total', 15: 'totalTax', 16: 'totalNoTax', 17: 'referenceNo', 19: 'totalDiscount' } as Record<number, keyof PosCoupon>)[f]
      if (k) (m as unknown as Record<string, number>)[k] = int64(v)
      return true
    }
    if (w !== 2) return false
    const v = r.bytes()
    if (f === 4) m.location = text(v)
    else if (f === 5) m.operatorId = text(v)
    else if (f === 8) m.verificationNo = text(v)
    else if (f === 11) m.items.push(readMessage(v, { name: '', price: 0, unit: '', quantity: 0, total: 0, taxRate: 'A', type: '' } as CouponItem, (ir, fi, wi, it) => {
      if (wi === 5 && fi === 4) { it.quantity = ir.float(); return true }
      if (wi === 0) { const n = int64(ir.varint()); if (fi === 2) it.price = n; else if (fi === 5) it.total = n; return true }
      if (wi !== 2) return false
      const s = text(ir.bytes())
      if (fi === 1) it.name = s; else if (fi === 3) it.unit = s; else if (fi === 6) it.taxRate = s as TaxLetter; else if (fi === 7) it.type = s
      return true
    }))
    else if (f === 12) m.payments.push(readMessage(v, { type: PaymentType.Cash, amount: 0 } as Payment, (pr, fp, wp, p) => {
      if (wp !== 0) return false
      const n = int64(pr.varint()); if (fp === 1) p.type = n; else if (fp === 2) p.amount = n
      return true
    }))
    else if (f === 14) m.taxGroups.push(readMessage(v, { taxRate: 'A', totalForTax: 0, totalTax: 0 } as TaxGroup, (gr, fg, wg, g) => {
      if (wg === 2 && fg === 1) { g.taxRate = text(gr.bytes()) as TaxLetter; return true }
      if (wg !== 0) return false
      const n = int64(gr.varint()); if (fg === 2) g.totalForTax = n; else if (fg === 3) g.totalTax = n
      return true
    }))
    // any other field was read above already
    return true
  })
}
