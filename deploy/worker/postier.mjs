#!/usr/bin/env node
// DrisPRO · the postier: sends what waits in the outbox and runs the timed work.
// No packages: Node 18+ only (SMTP over net/tls, WhatsApp and the API over fetch).
//
//   API_URL        the DrisPRO API (cloud: https://api.erp.dris-ks.com, local: http://nexus-web)
//   SERVICE_KEY    the service key of that API
//   MODE           cloud | local
//   LICENCE, SERVER_ID, LICENCE_SERVER   local only: WhatsApp goes through the cloud with the licence
//   ANTHROPIC_API_KEY  cloud only: reading supplier invoices (see readers in this file)
//   ONCE=1         one round and exit (tests)
import net from 'node:net'
import tls from 'node:tls'
import os from 'node:os'
import crypto from 'node:crypto'

const API = (process.env.API_URL || '').replace(/\/+$/, '')
const KEY = process.env.SERVICE_KEY || ''
const MODE = process.env.MODE === 'local' ? 'local' : 'cloud'
const LICENCE = process.env.LICENCE || ''
const SERVER_ID = process.env.SERVER_ID || ''
const LICENCE_SERVER = (process.env.LICENCE_SERVER || 'https://api.erp.dris-ks.com').replace(/\/+$/, '')
const ONCE = process.env.ONCE === '1'
// the cloud's public key (anon role: it can only call the public licence functions)
const CLOUD_ANON_KEY = process.env.CLOUD_ANON_KEY || 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsImlhdCI6MTc5Mjg0NTY2MCwiZXhwIjo0OTQ4NTE5MjYwLCJyb2xlIjoiYW5vbiJ9.b6G9lu0yfVwPpWlddYYql4Hf0oelvnyrF-JH_xl3jd0'
const log = (...a) => console.log(new Date().toISOString().replace('T', ' ').slice(0, 19), ...a)
if (!API || !KEY) { console.error('API_URL and SERVICE_KEY are needed'); process.exit(1) }

/* ------------------------------------------------------------------ the API */
async function rpc(fn, args = {}, base = API, key = KEY) {
  const r = await fetch(`${base}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(args),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

/* ------------------------------------------------------------------ SMTP */
class Smtp {
  constructor(cfg) { this.cfg = cfg; this.buf = ''; this.waiters = [] }
  async connect() {
    const { host, port, security } = this.cfg
    const opts = { host, port, servername: host, timeout: 30000 }
    this.sock = security === 'tls' ? tls.connect(opts) : net.connect(opts)
    this.attach(this.sock)
    await new Promise((ok, bad) => { this.sock.once(security === 'tls' ? 'secureConnect' : 'connect', ok); this.sock.once('error', bad) })
    await this.expect(220)
    let ehlo = await this.cmd(`EHLO ${os.hostname() || 'drispro'}`, 250)
    if (security === 'starttls') {
      if (!/STARTTLS/i.test(ehlo)) throw new Error('The mail server does not offer STARTTLS; choose SSL/TLS or "none"')
      await this.cmd('STARTTLS', 220)
      this.sock.removeAllListeners('data')
      this.sock = tls.connect({ socket: this.sock, servername: host })
      this.attach(this.sock)
      await new Promise((ok, bad) => { this.sock.once('secureConnect', ok); this.sock.once('error', bad) })
      ehlo = await this.cmd(`EHLO ${os.hostname() || 'drispro'}`, 250)
    }
    if (this.cfg.user) {
      if (/AUTH[^\n]*PLAIN/i.test(ehlo)) {
        await this.cmd('AUTH PLAIN ' + Buffer.from(`\0${this.cfg.user}\0${this.cfg.pass || ''}`).toString('base64'), 235)
      } else {
        await this.cmd('AUTH LOGIN', 334)
        await this.cmd(Buffer.from(this.cfg.user).toString('base64'), 334)
        await this.cmd(Buffer.from(this.cfg.pass || '').toString('base64'), 235)
      }
    }
  }
  attach(sock) {
    sock.setEncoding('utf8')
    sock.on('data', (d) => { this.buf += d; this.flush() })
    sock.on('error', (e) => { const w = this.waiters.shift(); if (w) w.bad(e) })
    sock.on('timeout', () => { sock.destroy(new Error('The mail server did not answer in time')) })
  }
  flush() {
    // a reply ends with a line "NNN text" (a dash after the code means more lines follow)
    for (;;) {
      const m = this.buf.match(/^(?:\d{3}-[^\r\n]*\r?\n)*(\d{3})(?: [^\r\n]*)?\r?\n/)
      if (!m) return
      this.buf = this.buf.slice(m[0].length)
      const w = this.waiters.shift()
      if (w) w.ok({ code: Number(m[1]), text: m[0] })
    }
  }
  read() { return new Promise((ok, bad) => { this.waiters.push({ ok, bad }); this.flush() }) }
  async expect(code) {
    const r = await this.read()
    if (r.code !== code) throw new Error(r.text.trim().replace(/\s+/g, ' ').slice(0, 300))
    return r.text
  }
  async cmd(line, code) { this.sock.write(line + '\r\n'); return this.expect(code) }
  async send({ from, fromName, to, replyTo, subject, text, html }) {
    await this.cmd(`MAIL FROM:<${from}>`, 250)
    for (const r of to) await this.cmd(`RCPT TO:<${r}>`, 250)
    await this.cmd('DATA', 354)
    const b = 'b_' + crypto.randomBytes(12).toString('hex')
    const enc = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`)
    const b64 = (s) => Buffer.from(s || '').toString('base64').replace(/.{76}/g, '$&\r\n')
    const domain = from.split('@')[1] || 'drispro'
    const head = [
      `From: ${fromName ? `${enc(fromName.replace(/"/g, ''))} ` : ''}<${from}>`,
      `To: ${to.join(', ')}`,
      replyTo ? `Reply-To: ${replyTo}` : null,
      `Subject: ${enc(subject || '')}`,
      `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
      `Message-ID: <${crypto.randomUUID()}@${domain}>`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${b}"`,
    ].filter(Boolean)
    const body = [
      ...head, '',
      `--${b}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64(text || ''),
      ...(html ? [`--${b}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64(html)] : []),
      `--${b}--`, '',
    ].join('\r\n')
    this.sock.write(body.replace(/\r\n\./g, '\r\n..') + '\r\n.\r\n')
    const r = await this.expect(250)
    return r.trim().slice(4, 120)
  }
  async quit() { try { this.sock.write('QUIT\r\n'); await Promise.race([this.read(), new Promise((r) => setTimeout(r, 2000))]) } catch { /* closing anyway */ } this.sock.destroy() }
}

async function sendEmail(m) {
  if (!m.mail) throw new Error('This company has no mailbox set up (Automations → Email)')
  const c = new Smtp(m.mail)
  try {
    await c.connect()
    return await c.send({ from: m.mail.from, fromName: m.mail.from_name, replyTo: m.mail.reply_to, to: [m.to], subject: m.subject, text: m.text, html: m.html })
  } finally { await c.quit() }
}

/* ------------------------------------------------------------------ WhatsApp */
let waConfig = null
async function whatsapp(m) {
  if (!waConfig) waConfig = await rpc('postier_config')
  const { whatsapp_token: token, whatsapp_phone_id: phone } = waConfig || {}
  if (!token || !phone) throw new Error('WhatsApp is not set up on the DrisPRO cloud yet')
  const t = m.template || {}
  const r = await fetch(`${process.env.WHATSAPP_API || 'https://graph.facebook.com/v21.0'}/${phone}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to: m.to, type: 'template',
      template: { name: t.name, language: { code: t.language || 'sq' },
                  components: [{ type: 'body', parameters: (t.params || []).map((p) => ({ type: 'text', text: String(p ?? '').slice(0, 1000) || '-' })) }] },
    }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j?.error?.message || `WhatsApp ${r.status}`)
  return j?.messages?.[0]?.id ?? null
}

/* ------------------------------------------------------------------ one round */
async function round() {
  const batch = await rpc('postier_claim', { p_limit: 20 })
  const relay = []
  for (const m of batch) {
    try {
      if (m.channel === 'email') {
        const id = await sendEmail(m)
        await rpc('postier_done', { p_id: m.id, p_ok: true, p_provider_id: id })
        log('email sent', m.to, m.subject ?? '')
      } else if (MODE === 'local') {
        relay.push(m)
      } else {
        const id = await whatsapp(m)
        await rpc('postier_done', { p_id: m.id, p_ok: true, p_provider_id: id })
        log('whatsapp sent', m.to, m.template?.name ?? '')
      }
    } catch (e) {
      log('not sent', m.channel, m.to, String(e.message || e))
      await rpc('postier_done', { p_id: m.id, p_ok: false, p_error: String(e.message || e) }).catch(() => {})
    }
  }
  if (relay.length) {
    try {
      if (!LICENCE || !SERVER_ID) throw new Error('This server has no licence yet')
      await rpc('licence_whatsapp_relay', { p_code: LICENCE, p_server: SERVER_ID,
        p_messages: relay.map((m) => ({ id: m.id, to: m.to, text: m.text, template: m.template, purpose: m.purpose })) }, LICENCE_SERVER, CLOUD_ANON_KEY)
      for (const m of relay) await rpc('postier_done', { p_id: m.id, p_ok: true, p_relayed: true })
      log('whatsapp handed to the cloud', relay.length)
    } catch (e) {
      for (const m of relay) await rpc('postier_done', { p_id: m.id, p_ok: false, p_error: 'WhatsApp through the cloud: ' + String(e.message || e) }).catch(() => {})
    }
  }
  return batch.length
}

let lastTick = 0
async function tick() {
  if (Date.now() - lastTick < 5 * 60 * 1000) return
  lastTick = Date.now()
  try {
    const r = await rpc('automation_tick')
    if (r && (r.summaries || r.reminders || r.daily)) log('timed work', JSON.stringify(r))
  } catch (e) { log('timed work failed', String(e.message || e)) }
  waConfig = null
}

log(`postier ${MODE} → ${API}`)
for (;;) {
  try { await tick(); const n = await round(); if (ONCE) break; await new Promise((r) => setTimeout(r, n ? 2000 : 20000)) }
  catch (e) { log('round failed', String(e.message || e)); if (ONCE) process.exit(1); await new Promise((r) => setTimeout(r, 30000)) }
}
