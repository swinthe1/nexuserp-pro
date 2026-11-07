/**
 * The meeting point of the console and the client's program: a broadcast channel on the cloud's realtime
 * server, named by the computer's own unguessable channel. The same small protocol as the program's
 * hidden help page (desktop/support.html), so neither depends on the realtime client library's version.
 */
import { supabaseAnonKey, supabaseUrl } from '@/lib/supabase'

export type SignalHandler = (event: string, payload: Record<string, unknown>) => void

export class SupportSignal {
  private ws: WebSocket | null = null
  private ref = 0
  private joinRef: string | null = null
  private hb: number | undefined
  private closed = false
  private wait = 1000
  private readonly topic: string
  constructor(channel: string, private readonly on: SignalHandler, private readonly onState: (s: 'connecting' | 'joined' | 'lost') => void) {
    this.topic = `realtime:support-${channel}`
    this.connect()
  }
  private connect() {
    if (this.closed) return
    this.onState('connecting')
    const url = `${supabaseUrl.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${encodeURIComponent(supabaseAnonKey)}&vsn=1.0.0`
    const ws = new WebSocket(url)
    this.ws = ws
    ws.onopen = () => {
      this.wait = 1000
      this.joinRef = String(++this.ref)
      this.raw({ topic: this.topic, event: 'phx_join', ref: this.joinRef, join_ref: this.joinRef,
        payload: { config: { broadcast: { self: false, ack: false }, presence: { key: '' }, postgres_changes: [], private: false }, access_token: supabaseAnonKey } })
      window.clearInterval(this.hb)
      this.hb = window.setInterval(() => this.raw({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++this.ref) }), 25_000)
    }
    ws.onmessage = (m) => {
      let d: { topic?: string; event?: string; ref?: string; payload?: { status?: string; event?: string; payload?: Record<string, unknown> } }
      try { d = JSON.parse(String(m.data)) } catch { return }
      if (d.topic !== this.topic) return
      if (d.event === 'phx_reply' && d.ref === this.joinRef && d.payload?.status === 'ok') this.onState('joined')
      else if (d.event === 'broadcast' && d.payload?.event) this.on(d.payload.event, d.payload.payload ?? {})
      else if (d.event === 'phx_error' || d.event === 'phx_close') ws.close()
    }
    ws.onclose = () => {
      window.clearInterval(this.hb)
      if (this.ws === ws) this.ws = null
      if (this.closed) return
      this.onState('lost')
      window.setTimeout(() => this.connect(), this.wait)
      this.wait = Math.min(this.wait * 2, 15_000)
    }
    ws.onerror = () => { try { ws.close() } catch { /* closing */ } }
  }
  private raw(m: unknown) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)) }
  send(event: string, payload: Record<string, unknown>) {
    this.raw({ topic: this.topic, event: 'broadcast', payload: { type: 'broadcast', event, payload }, ref: String(++this.ref), join_ref: this.joinRef })
  }
  close() {
    this.closed = true
    window.clearInterval(this.hb)
    try { this.ws?.close() } catch { /* closed */ }
    this.ws = null
  }
}
