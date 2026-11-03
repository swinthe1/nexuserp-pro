// DrisPRO · phone notifications (Web Push, RFC 8030/8291/8292) with Node's own crypto: no packages.
import crypto from 'node:crypto'
import { exact, templates } from './push-texts.mjs'

const b64u = (b) => Buffer.from(b).toString('base64url')
const unb64u = (s) => Buffer.from(String(s).replace(/=+$/, ''), 'base64url')

/** A new key pair for this installation: the public key as the browser wants it, the private one as JWK. */
export function newPushKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const jwk = privateKey.export({ format: 'jwk' })
  const pub = Buffer.concat([Buffer.from([4]), unb64u(jwk.x), unb64u(jwk.y)])
  void publicKey
  return { public: b64u(pub), private: JSON.stringify(jwk) }
}

/* ------------------------------------------------------------------ the person's language */
const PCT = '\u0000'
const patterns = templates
  .slice().sort((a, b) => b[0].replace(/%/g, '').length - a[0].replace(/%/g, '').length)
  .map(([en, sq]) => ({ re: new RegExp('^' + en.replace(/%%/g, PCT).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '(.+?)').replace(new RegExp(PCT, 'g'), '%') + '$', 's'), sq }))
function arg(a, mid) {
  const e = exact[`enum:${a}`]
  if (e) return mid ? e.charAt(0).toLowerCase() + e.slice(1) : e
  return exact[a] ?? a
}
function one(m) {
  if (exact[m]) return exact[m]
  for (const p of patterns) {
    const r = p.re.exec(m)
    if (r) return p.sq.replace(/\{(\d+)\}/g, (_, i, off) => arg(r[Number(i) + 1] ?? '', off > 0 && !/[.!?:]\s*$/.test(p.sq.slice(0, off))))
  }
  return null
}
export function translate(text, locale) {
  // the phone gets Albanian, or English for English and Serbian
  if (!text || locale !== 'sq') return text || ''
  const m = String(text).trim()
  if (exact[m]) return exact[m]
  // a line of parts ("Receipts: 74 · Cash: 620,71 €"): each part on its own, when each one is known
  const parts = m.includes(' · ') ? m.split(' · ').map(one) : null
  if (parts && parts.every(Boolean)) return parts.join(' · ')
  return one(m) ?? (parts ? m.split(' · ').map((x, i) => parts[i] ?? x).join(' · ') : m)
}

/* ------------------------------------------------------------------ sending */
function vapid(endpoint, keys) {
  const aud = new URL(endpoint).origin
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))
  const body = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'mailto:info@dris-ks.com' }))
  const key = crypto.createPrivateKey({ key: JSON.parse(keys.private), format: 'jwk' })
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' })
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${keys.public}`
}

function encrypt(payload, p256dh, authSecret) {
  const uaPublic = unb64u(p256dh)
  const auth = unb64u(authSecret)
  const ecdh = crypto.createECDH('prime256v1')
  const asPublic = ecdh.generateKeys()
  const shared = ecdh.computeSecret(uaPublic)
  const salt = crypto.randomBytes(16)
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32))
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16))
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12))
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce)
  const ct = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()])
  const header = Buffer.alloc(21)
  salt.copy(header, 0); header.writeUInt32BE(4096, 16); header[20] = asPublic.length
  return Buffer.concat([header, asPublic, ct])
}

/** Sends one notification. Resolves { ok } or { ok: false, gone, error }. */
export async function sendPush(m, keys) {
  const title = translate(m.title, m.locale)
  const payload = JSON.stringify({ title, body: translate(m.body, m.locale), url: m.link || '/notifications', tag: m.tag, company: m.company })
  const r = await fetch(m.endpoint, {
    method: 'POST',
    headers: { Authorization: vapid(m.endpoint, keys), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'normal' },
    body: encrypt(payload, m.p256dh, m.auth),
  })
  if (r.ok) return { ok: true }
  const text = (await r.text().catch(() => '')).slice(0, 200)
  return { ok: false, gone: r.status === 404 || r.status === 410, error: `${r.status} ${text}` }
}
