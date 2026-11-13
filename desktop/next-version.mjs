// Every build of the program reaches the installed computers: if this version number is already published
// (desktop/ changed but package.json was not raised), the build takes the next free patch number, so the
// computers see a newer version and ask to install it. Run before electron-builder, from desktop/.
//   DRISPRO_PUBLISH_KEY=dpk_… node next-version.mjs [mac]
import { readFileSync, writeFileSync } from 'node:fs'

const API = (process.env.DRISPRO_API || 'https://api.drispro.com').replace(/\/+$/, '')
const ANON = process.env.DRISPRO_ANON || (readFileSync("publish.mjs", "utf8").match(/eyJ[\w.-]+/)?.[0] ?? "")
const KEY = process.env.DRISPRO_PUBLISH_KEY
if (!KEY) { console.log('No DRISPRO_PUBLISH_KEY: the version stays as it is.'); process.exit(0) }

const platform = process.argv[2] === 'mac' ? 'mac-update' : 'windows'
const r = await fetch(`${API}/rest/v1/rpc/desktop_publish_ticket`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_key: KEY }) })
if (!r.ok) { console.log(`Could not read the published versions (${r.status}): the version stays as it is.`); process.exit(0) }
const ticket = await r.json()
const published = new Set(ticket.by_platform?.[platform] ?? (platform === 'windows' ? ticket.versions ?? [] : []))
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
let [a, b, c] = pkg.version.split('.').map(Number)
const start = pkg.version
while (published.has(`${a}.${b}.${c}`)) c++
pkg.version = `${a}.${b}.${c}`
if (pkg.version !== start) {
  writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n')
  console.log(`${start} is already published: this build is ${pkg.version}.`)
} else console.log(`Version ${pkg.version}.`)
