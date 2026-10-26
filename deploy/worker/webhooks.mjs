// DrisPRO · webhooks: tells the companies' other programs what happened, signed with their secret.
//   POST <their address>   Content-Type: application/json
//   X-DrisPRO-Event: invoice.posted
//   X-DrisPRO-Delivery: <id of this message>
//   X-DrisPRO-Timestamp: <unix seconds>
//   X-DrisPRO-Signature: sha256=<hex HMAC-SHA256 of "<timestamp>.<body>" with the secret>
import crypto from 'node:crypto'
import dns from 'node:dns/promises'
import net from 'node:net'

// in the cloud, the companies' addresses may not point inside our own network
function privateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  }
  const x = ip.toLowerCase()
  return x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80') || x.startsWith('::ffff:') && privateAddress(x.slice(7))
}

export async function checkAddress(url, cloud) {
  const u = new URL(url)
  if (!['https:', 'http:'].includes(u.protocol)) throw new Error('Only http and https addresses')
  if (!cloud) return
  if (u.protocol !== 'https:') throw new Error('The address must start with https://')
  const host = u.hostname.replace(/^\[|\]$/g, '')
  const ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((r) => r.address)
  if (!ips.length || ips.some(privateAddress)) throw new Error('This address is not allowed (a private network)')
}

export function sign(secret, timestamp, body) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
}

/** Sends one delivery. Resolves { ok, status, error }. */
export async function deliver(d, cloud) {
  try {
    await checkAddress(d.url, cloud)
    const body = JSON.stringify(d.payload)
    const ts = Math.floor(Date.now() / 1000)
    const r = await fetch(d.url, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'DrisPRO-Webhooks/1.0', 'X-DrisPRO-Event': d.event, 'X-DrisPRO-Delivery': d.id,
        'X-DrisPRO-Timestamp': String(ts), 'X-DrisPRO-Signature': sign(d.secret, ts, body) },
      body,
    })
    const text = (await r.text().catch(() => '')).slice(0, 200)
    return r.status >= 200 && r.status < 300 ? { ok: true, status: r.status } : { ok: false, status: r.status, error: `${r.status} ${text}`.trim() }
  } catch (e) {
    return { ok: false, status: null, error: String(e?.cause?.code || e?.message || e) }
  }
}
