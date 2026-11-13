// node deploy/worker/tunnels.test.mjs — the tunnel round against a pretend Cloudflare
import assert from 'node:assert/strict'
import { tunnelRound } from './tunnels.mjs'

const state = { tunnels: [], dns: [], calls: [] }
const json = (result, ok = true, status = 200, errors = []) => ({ ok: ok && status < 400, status, json: async () => ({ success: ok, result, errors }) })
async function fakeFetch(url, init) {
  const u = new URL(url); const p = u.pathname.replace('/client/v4', ''); const m = init.method
  state.calls.push(`${m} ${p}`)
  assert.equal(init.headers.Authorization, 'Bearer cf-token')
  let x
  if (m === 'GET' && (x = p.match(/^\/accounts\/acc\/cfd_tunnel$/))) return json(state.tunnels.filter((t) => t.name === u.searchParams.get('name')))
  if (m === 'POST' && p === '/accounts/acc/cfd_tunnel') { const t = { id: 'a'.repeat(31) + state.tunnels.length, name: JSON.parse(init.body).name }; state.tunnels.push(t); return json(t) }
  if (m === 'PUT' && (x = p.match(/^\/accounts\/acc\/cfd_tunnel\/(\w+)\/configurations$/))) { const t = state.tunnels.find((t) => t.id === x[1]); t.config = JSON.parse(init.body).config; return json({}) }
  if (m === 'GET' && (x = p.match(/^\/accounts\/acc\/cfd_tunnel\/(\w+)\/token$/))) return json('tok-' + x[1])
  if (m === 'DELETE' && (x = p.match(/^\/accounts\/acc\/cfd_tunnel\/(\w+)\/connections$/))) return json({})
  if (m === 'DELETE' && (x = p.match(/^\/accounts\/acc\/cfd_tunnel\/(\w+)$/))) { state.tunnels = state.tunnels.filter((t) => t.id !== x[1]); return json({}) }
  if (m === 'GET' && p === '/zones/zone/dns_records') return json(state.dns.filter((d) => d.name === u.searchParams.get('name')))
  if (m === 'POST' && p === '/zones/zone/dns_records') { const d = { id: 'd' + state.dns.length, ...JSON.parse(init.body) }; state.dns.push(d); return json(d) }
  if (m === 'PUT' && (x = p.match(/^\/zones\/zone\/dns_records\/(\w+)$/))) { Object.assign(state.dns.find((d) => d.id === x[1]), JSON.parse(init.body)); return json({}) }
  if (m === 'DELETE' && (x = p.match(/^\/zones\/zone\/dns_records\/(\w+)$/))) { state.dns = state.dns.filter((d) => d.id !== x[1]); return json({}) }
  return json(null, false, 404, [{ code: 7000, message: 'No route' }])
}
const cloudflare = { token: 'cf-token', account: 'acc', zone: 'zone' }
let jobs = []; const done = []
const rpc = async (fn, a) => { if (fn === 'postier_tunnel_claim') return { cloudflare, jobs }; done.push(a); return null }

// a new one
jobs = [{ company_id: 'c1', hostname: 'lider-market.drispro.com', status: 'requested', tunnel_id: null, name: 'drispro-nxs-1' }]
await tunnelRound(rpc, () => {}, fakeFetch)
assert.equal(state.tunnels.length, 1)
assert.deepEqual(state.tunnels[0].config.ingress[0], { hostname: 'lider-market.drispro.com', service: 'http://drispro-web:80' })
assert.equal(state.dns[0].content, `${state.tunnels[0].id}.cfargotunnel.com`)
assert.equal(state.dns[0].proxied, true)
assert.equal(done[0].p_ok, true); assert.equal(done[0].p_token, 'tok-' + state.tunnels[0].id)
// asked again (a lost answer): the same tunnel and address, nothing doubled
done.length = 0
await tunnelRound(rpc, () => {}, fakeFetch)
assert.equal(state.tunnels.length, 1); assert.equal(state.dns.length, 1); assert.equal(done[0].p_ok, true)
// turned off: the address and the tunnel go
done.length = 0
jobs = [{ company_id: 'c1', hostname: 'lider-market.drispro.com', status: 'remove', tunnel_id: state.tunnels[0].id, name: 'drispro-nxs-1' }]
await tunnelRound(rpc, () => {}, fakeFetch)
assert.equal(state.tunnels.length, 0); assert.equal(state.dns.length, 0); assert.equal(done[0].p_ok, true)
// Cloudflare refuses: the failure is said, the round goes on
done.length = 0
jobs = [{ company_id: 'c2', hostname: 'x.drispro.com', status: 'requested', tunnel_id: null, name: 'drispro-nxs-2' }]
await tunnelRound(rpc, () => {}, async (url, init) => (init.method === 'POST' ? json(null, false, 403, [{ code: 10000, message: 'Authentication error' }]) : fakeFetch(url, init)))
assert.equal(done[0].p_ok, false); assert.match(done[0].p_error, /403 10000 Authentication error/)
console.log('tunnels: 4 cases passed')
