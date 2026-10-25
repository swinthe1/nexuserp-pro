// Hands a freshly built installer to the DrisPRO cloud, so the sign-in page offers it to everyone.
//   DRISPRO_PUBLISH_KEY=dpk_… node publish.mjs            (run after electron-builder, from desktop/)
// The key is made once on the Platform page (The Windows program → Publish by itself).
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const API = (process.env.DRISPRO_API || 'https://api.erp.dris-ks.com').replace(/\/+$/, '')
const ANON = process.env.DRISPRO_ANON || 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsImlhdCI6MTc5Mjg0NTY2MCwiZXhwIjo0OTQ4NTE5MjYwLCJyb2xlIjoiYW5vbiJ9.b6G9lu0yfVwPpWlddYYql4Hf0oelvnyrF-JH_xl3jd0'
const KEY = process.env.DRISPRO_PUBLISH_KEY
if (!KEY) { console.log('No DRISPRO_PUBLISH_KEY: the installer is built but not published.'); process.exit(0) }

const version = JSON.parse(readFileSync('package.json', 'utf8')).version
const name = `DrisPRO-Setup-${version}.exe`
const rpc = async (fn, body) => {
  const r = await fetch(`${API}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const text = await r.text()
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

const ticket = await rpc('desktop_publish_ticket', { p_key: KEY })
if (ticket.versions.includes(version) && process.env.FORCE !== '1') { console.log(`Version ${version} is already published.`); process.exit(0) }

const file = readFileSync(`dist/${name}`)
const sha = createHash('sha256').update(file).digest('hex')
const PART = 45 * 1024 * 1024
const parts = Math.max(1, Math.ceil(file.length / PART))
for (let i = 0; i < parts; i++) {
  const path = `windows/${version}/${name}.part${String(i).padStart(3, '0')}`
  const r = await fetch(`${API}/storage/v1/object/downloads/${path}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${ticket.token}`, 'x-upsert': 'true', 'Content-Type': 'application/octet-stream', 'cache-control': 'max-age=31536000' },
    body: file.subarray(i * PART, (i + 1) * PART),
  })
  if (!r.ok) throw new Error(`upload part ${i}: ${r.status} ${(await r.text()).slice(0, 300)}`)
  console.log(`part ${i + 1}/${parts} uploaded`)
}
await rpc('desktop_publish_with_key', { p_key: KEY, p_version: version, p_file_name: name, p_size: file.length, p_parts: parts, p_sha256: sha, p_notes: process.env.NOTES || null })
console.log(`Published ${name} (${Math.round(file.length / 1048576)} MB): the sign-in page offers it now.`)
