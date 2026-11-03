/**
 * Just enough DER for ATK's onboarding: the till's certificate request (PKCS#10, ECDSA P-256 with SHA-256)
 * and turning a WebCrypto signature (r‖s) into the ASN.1 form ATK verifies.
 */

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}
function len(n: number) {
  if (n < 0x80) return Uint8Array.of(n)
  const b: number[] = []
  for (let x = n; x > 0; x >>= 8) b.unshift(x & 0xff)
  return Uint8Array.of(0x80 | b.length, ...b)
}
const tlv = (tag: number, ...content: Uint8Array[]) => { const c = concat(...content); return concat(Uint8Array.of(tag), len(c.length), c) }
const seq = (...c: Uint8Array[]) => tlv(0x30, ...c)
const set = (...c: Uint8Array[]) => tlv(0x31, ...c)
function oid(s: string) {
  const [a, b, ...rest] = s.split('.').map(Number)
  const out = [a! * 40 + b!]
  for (const n of rest) {
    const chunk: number[] = []
    let x = n
    do { chunk.unshift(x & 0x7f); x >>= 7 } while (x > 0)
    for (let i = 0; i < chunk.length - 1; i++) chunk[i]! |= 0x80
    out.push(...chunk)
  }
  return tlv(0x06, Uint8Array.from(out))
}
/** DER INTEGER from unsigned big-endian bytes */
function uint(b: Uint8Array) {
  let i = 0
  while (i < b.length - 1 && b[i] === 0) i++
  const v = b.subarray(i)
  return tlv(0x02, v[0]! & 0x80 ? concat(Uint8Array.of(0), v) : v)
}
const printable = /^[A-Za-z0-9 '()+,\-./:=?]*$/
/** as Go's x509 writes names: PrintableString when it can, UTF8String otherwise */
const text = (s: string) => tlv(printable.test(s) ? 0x13 : 0x0c, new TextEncoder().encode(s))

const OID = {
  country: '2.5.4.6', locality: '2.5.4.7', organization: '2.5.4.10', unit: '2.5.4.11', commonName: '2.5.4.3',
  ecPublicKey: '1.2.840.10045.2.1', p256: '1.2.840.10045.3.1.7', ecdsaSha256: '1.2.840.10045.4.3.2',
}

/** ECDSA signature r‖s (64 bytes, WebCrypto) → ASN.1 SEQUENCE { r INTEGER, s INTEGER } */
export function rawToDer(sig: Uint8Array) {
  if (sig.length !== 64) throw new Error('A P-256 signature has 64 bytes')
  return seq(uint(sig.subarray(0, 32)), uint(sig.subarray(32)))
}

export interface CsrSubject { nui: string; posId: string; branchId: string; businessName: string; country?: string }

/**
 * The CertificationRequestInfo to sign, with the same subject as ATK's examples:
 * C = RKS, L = branch, O = NUI, OU = POS, CN = business name (Go's order: C, L, O, OU, CN).
 * publicKey: the uncompressed point (65 bytes, 0x04‖X‖Y).
 */
export function csrInfo(s: CsrSubject, publicKey: Uint8Array) {
  if (publicKey.length !== 65 || publicKey[0] !== 4) throw new Error('The public key must be an uncompressed P-256 point')
  const rdn = (o: string, v: string) => set(seq(oid(o), text(v)))
  const name = seq(rdn(OID.country, s.country ?? 'RKS'), rdn(OID.locality, s.branchId), rdn(OID.organization, s.nui),
    rdn(OID.unit, s.posId), rdn(OID.commonName, s.businessName))
  const spki = seq(seq(oid(OID.ecPublicKey), oid(OID.p256)), tlv(0x03, Uint8Array.of(0), publicKey))
  return seq(tlv(0x02, Uint8Array.of(0)), name, spki, Uint8Array.of(0xa0, 0x00))
}

/** the whole request in PEM, from the info and its DER signature */
export function csrPem(info: Uint8Array, derSignature: Uint8Array) {
  const req = seq(info, seq(oid(OID.ecdsaSha256)), tlv(0x03, Uint8Array.of(0), derSignature))
  let b = ''
  for (const x of req) b += String.fromCharCode(x)
  const body = btoa(b).replace(/.{1,64}/g, '$&\n')
  return `-----BEGIN CERTIFICATE REQUEST-----\n${body}-----END CERTIFICATE REQUEST-----\n`
}
