/**
 * The till's own key for ATK (ECDSA P-256). It is made on this device and never leaves it:
 * - where the browser allows it (https), a WebCrypto key that even this code cannot read out;
 * - on a local server over plain http (no WebCrypto there), a key kept in this device's storage.
 * Each till (POS) has its own key and its own certificate from ATK.
 */
import { p256 } from '@noble/curves/nist.js'
import { csrInfo, csrPem, rawToDer, type CsrSubject } from './der'
import { toBase64 } from './proto'

export type AtkEnv = 'test' | 'production'
export interface TillKey {
  id: string
  register_id: string
  env: AtkEnv
  kind: 'webcrypto' | 'software'
  privateKey: CryptoKey | Uint8Array
  /** uncompressed P-256 point */
  publicKey: Uint8Array
  certificate?: string
  subject: CsrSubject
  created_at: string
}

const DB = 'drispro-atk'
let dbp: Promise<IDBDatabase> | null = null
function db() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('keys')) req.result.createObjectStore('keys', { keyPath: 'id' })
      if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbp
}
function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) {
  return db().then((d) => new Promise<T>((resolve, reject) => {
    const t = d.transaction(store, mode)
    const r = fn(t.objectStore(store))
    t.oncomplete = () => resolve(r.result)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  }))
}

const keyId = (register: string, env: AtkEnv) => `${register}:${env}`
export const getTillKey = (register: string, env: AtkEnv) => run<TillKey | undefined>('keys', 'readonly', (s) => s.get(keyId(register, env)) as IDBRequest<TillKey | undefined>)
const putTillKey = (k: TillKey) => run('keys', 'readwrite', (s) => s.put(k))
export const removeTillKey = (register: string, env: AtkEnv) => run('keys', 'readwrite', (s) => s.delete(keyId(register, env)))

const hasWebCrypto = () => typeof crypto !== 'undefined' && !!crypto.subtle && (typeof window === 'undefined' || window.isSecureContext)

/**
 * A new key for this till. It is kept only once ATK has signed its certificate (saveCertificate),
 * so a registration that fails half-way never loses the key the till is selling with.
 */
export async function newTillKey(register: string, env: AtkEnv, subject: CsrSubject): Promise<TillKey> {
  // ask the browser not to clear this device's storage on its own: the key lives there
  try { await navigator.storage?.persist?.() } catch { /* not everywhere */ }
  let k: TillKey
  if (hasWebCrypto()) {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
    const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
    k = { id: keyId(register, env), register_id: register, env, kind: 'webcrypto', privateKey: pair.privateKey, publicKey: pub, subject, created_at: new Date().toISOString() }
  } else {
    const sk = p256.utils.randomSecretKey()
    k = { id: keyId(register, env), register_id: register, env, kind: 'software', privateKey: sk, publicKey: p256.getPublicKey(sk, false), subject, created_at: new Date().toISOString() }
  }
  return k
}

/** ECDSA P-256 over SHA-256 of the bytes, in ASN.1 DER, as ATK verifies it */
export async function signDer(k: TillKey, data: Uint8Array): Promise<Uint8Array> {
  if (k.kind === 'webcrypto') {
    const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, k.privateKey as CryptoKey, data as BufferSource))
    return rawToDer(raw)
  }
  return p256.sign(data, k.privateKey as Uint8Array, { prehash: true, format: 'der' })
}

/** ATK signs the Base64 text of the coupon, not its bytes: the signature comes back in Base64 */
export async function signText(k: TillKey, text: string) {
  return toBase64(await signDer(k, new TextEncoder().encode(text)))
}

export async function makeCsr(k: TillKey) {
  const info = csrInfo(k.subject, k.publicKey)
  return csrPem(info, await signDer(k, info))
}

export async function saveCertificate(k: TillKey, pem: string) {
  const next = { ...k, certificate: pem }
  await putTillKey(next)
  return next
}

/* the coupon counter of this till: never goes back, even if the server knows a higher one */
export async function nextCouponSeq(register: string, env: AtkEnv, atLeast = 0) {
  const key = `seq:${register}:${env}`
  const d = await db()
  // read and write in one transaction, so two receipts never get the same number
  return new Promise<number>((resolve, reject) => {
    const t = d.transaction('kv', 'readwrite')
    const s = t.objectStore('kv')
    let n = 0
    const g = s.get(key)
    g.onsuccess = () => { n = Math.max(Number(g.result ?? 0), atLeast) + 1; s.put(n, key) }
    t.oncomplete = () => resolve(n)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
}
