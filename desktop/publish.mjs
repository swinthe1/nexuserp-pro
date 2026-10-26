// Hands freshly built installers to the DrisPRO cloud, so the sign-in page offers them to everyone
// and the installed programs update themselves.
//   DRISPRO_PUBLISH_KEY=dpk_… node publish.mjs            (Windows: the .exe)
//   DRISPRO_PUBLISH_KEY=dpk_… node publish.mjs mac        (Mac: the .dmg to download and the .zip to update from)
// Run after electron-builder, from desktop/. The key is made once on the Platform page (Publish by itself).
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const API = (process.env.DRISPRO_API || 'https://api.erp.dris-ks.com').replace(/\/+$/, '')
const ANON = process.env.DRISPRO_ANON || 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsImlhdCI6MTc5Mjg0NTY2MCwiZXhwIjo0OTQ4NTE5MjYwLCJyb2xlIjoiYW5vbiJ9.b6G9lu0yfVwPpWlddYYql4Hf0oelvnyrF-JH_xl3jd0'
const KEY = process.env.DRISPRO_PUBLISH_KEY
if (!KEY) { console.log('No DRISPRO_PUBLISH_KEY: the installer is built but not published.'); process.exit(0) }

const version = JSON.parse(readFileSync('package.json', 'utf8')).version
const system = process.argv[2] === 'mac' ? 'mac' : 'windows'
const files = system === 'mac'
  ? [{ platform: 'mac', name: `DrisPRO-${version}.dmg` }, { platform: 'mac-update', name: `DrisPRO-${version}-mac.zip` }]
  : [{ platform: 'windows', name: `DrisPRO-Setup-${version}.exe` }]

const rpc = async (fn, body) => {
  const r = await fetch(`${API}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const text = await r.text()
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

const ticket = await rpc('desktop_publish_ticket', { p_key: KEY })
const published = (platform) => (ticket.by_platform?.[platform] ?? (platform === 'windows' ? ticket.versions : []))
for (const f of files) {
  if (published(f.platform).includes(version) && process.env.FORCE !== '1') { console.log(`${f.name}: version ${version} is already published.`); continue }
  const file = readFileSync(`dist/${f.name}`)
  const sha = createHash('sha256').update(file).digest('hex')
  const PART = 45 * 1024 * 1024
  const parts = Math.max(1, Math.ceil(file.length / PART))
  for (let i = 0; i < parts; i++) {
    const path = `${f.platform}/${version}/${f.name}.part${String(i).padStart(3, '0')}`
    const r = await fetch(`${API}/storage/v1/object/downloads/${path}`, {
      method: 'POST',
      headers: { apikey: ANON, Authorization: `Bearer ${ticket.token}`, 'x-upsert': 'true', 'Content-Type': 'application/octet-stream', 'cache-control': 'max-age=31536000' },
      body: file.subarray(i * PART, (i + 1) * PART),
    })
    if (!r.ok) throw new Error(`upload ${f.name} part ${i}: ${r.status} ${(await r.text()).slice(0, 300)}`)
    console.log(`${f.name}: part ${i + 1}/${parts} uploaded`)
  }
  const body = { p_key: KEY, p_version: version, p_file_name: f.name, p_size: file.length, p_parts: parts, p_sha256: sha, p_notes: process.env.NOTES || null }
  // a server not yet updated knows only the Windows program, without a platform
  await rpc('desktop_publish_with_key', f.platform === 'windows' ? body : { ...body, p_platform: f.platform })
  console.log(`Published ${f.name} (${Math.round(file.length / 1048576)} MB).`)
}
