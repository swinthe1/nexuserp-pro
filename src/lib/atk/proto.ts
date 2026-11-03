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
