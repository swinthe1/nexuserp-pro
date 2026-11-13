// DrisPRO · the outside addresses of the local servers: one Cloudflare tunnel each, made by the cloud.
// For every server that asked (licence_tunnel), the tunnel is made (or found again), routed to the server's
// own web container, given its name under the domain, and its key handed back; one turned off is removed.
const CF = 'https://api.cloudflare.com/client/v4'

export async function cloudflare(cfg, method, path, body, fetchImpl = fetch) {
  const r = await fetchImpl(`${CF}${path}`, {
    method, headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let j = null
  try { j = await r.json() } catch { /* empty body */ }
  if (!r.ok || (j && j.success === false)) {
    const e = new Error(`Cloudflare ${method} ${path.replace(/\/[0-9a-f]{32}\b/g, '/…')}: ${r.status} ${(j?.errors ?? []).map((x) => `${x.code} ${x.message}`).join('; ')}`.trim())
    e.codes = (j?.errors ?? []).map((x) => x.code)
    throw e
  }
  return j?.result
}

/** makes (or finds) the tunnel, routes it, names it; returns { id, token } */
export async function makeTunnel(cfg, job, fetchImpl = fetch) {
  const acc = `/accounts/${cfg.account}`
  let id = job.tunnel_id
  if (!id) {
    const found = await cloudflare(cfg, 'GET', `${acc}/cfd_tunnel?name=${encodeURIComponent(job.name)}&is_deleted=false`, undefined, fetchImpl)
    id = found?.[0]?.id
  }
  if (!id) id = (await cloudflare(cfg, 'POST', `${acc}/cfd_tunnel`, { name: job.name, config_src: 'cloudflare' }, fetchImpl)).id
  // the local server's own web container (nginx), as the tunnel's container sees it in the same network
  await cloudflare(cfg, 'PUT', `${acc}/cfd_tunnel/${id}/configurations`, {
    config: { ingress: [{ hostname: job.hostname, service: 'http://drispro-web:80' }, { service: 'http_status:404' }] },
  }, fetchImpl)
  const target = `${id}.cfargotunnel.com`
  const recs = await cloudflare(cfg, 'GET', `/zones/${cfg.zone}/dns_records?name=${encodeURIComponent(job.hostname)}`, undefined, fetchImpl)
  const rec = { type: 'CNAME', name: job.hostname, content: target, proxied: true, comment: 'DrisPRO local server' }
  if (recs?.length) await cloudflare(cfg, 'PUT', `/zones/${cfg.zone}/dns_records/${recs[0].id}`, rec, fetchImpl)
  else await cloudflare(cfg, 'POST', `/zones/${cfg.zone}/dns_records`, rec, fetchImpl)
  const token = await cloudflare(cfg, 'GET', `${acc}/cfd_tunnel/${id}/token`, undefined, fetchImpl)
  return { id, token: typeof token === 'string' ? token : token?.token }
}

/** takes the address away and the tunnel with it */
export async function removeTunnel(cfg, job, fetchImpl = fetch) {
  const recs = await cloudflare(cfg, 'GET', `/zones/${cfg.zone}/dns_records?name=${encodeURIComponent(job.hostname)}`, undefined, fetchImpl)
  for (const r of recs ?? []) await cloudflare(cfg, 'DELETE', `/zones/${cfg.zone}/dns_records/${r.id}`, undefined, fetchImpl)
  if (job.tunnel_id) {
    const acc = `/accounts/${cfg.account}`
    await cloudflare(cfg, 'DELETE', `${acc}/cfd_tunnel/${job.tunnel_id}/connections`, undefined, fetchImpl).catch(() => undefined)
    await cloudflare(cfg, 'DELETE', `${acc}/cfd_tunnel/${job.tunnel_id}`, undefined, fetchImpl).catch((e) => { if (!/1003|not found|404/i.test(e.message)) throw e })
  }
}

/** one round: rpc is the cloud API (service key) */
export async function tunnelRound(rpc, log = () => {}, fetchImpl = fetch) {
  const c = await rpc('postier_tunnel_claim')
  const cfg = c?.cloudflare
  let n = 0
  for (const job of c?.jobs ?? []) {
    n++
    try {
      if (job.status === 'remove') {
        await removeTunnel(cfg, job, fetchImpl)
        await rpc('postier_tunnel_done', { p_company: job.company_id, p_ok: true })
        log('tunnel removed', job.hostname)
      } else {
        const t = await makeTunnel(cfg, job, fetchImpl)
        if (!t.token) throw new Error('Cloudflare gave no tunnel key')
        await rpc('postier_tunnel_done', { p_company: job.company_id, p_ok: true, p_tunnel_id: t.id, p_token: t.token })
        log('tunnel ready', job.hostname)
      }
    } catch (e) {
      log('tunnel failed', job.hostname, String(e.message || e))
      await rpc('postier_tunnel_done', { p_company: job.company_id, p_ok: false, p_error: String(e.message || e) }).catch(() => undefined)
    }
  }
  return n
}
