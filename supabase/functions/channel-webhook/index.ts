// NexusERP Pro · channel-webhook (Supabase Edge Function, Deno)
//
// Receives "order created" webhooks from a web shop, checks the signature,
// maps the platform's order to the normalised payload of
// public.ingest_channel_order (see migration 20261024001920) and imports it.
// Importing is idempotent per channel and external order id, so the shop may
// retry freely.
//
//   POST /functions/v1/channel-webhook?channel=<sales_channels.id>
//
// Secrets (supabase secrets set …):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   provided by the platform
//   CHANNEL_WEBHOOK_SECRET_<channel id, dashes removed>   the shop's webhook secret
//   (or CHANNEL_WEBHOOK_SECRET as a fallback for a single shop)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10'

type Normalised = {
  id: string
  number?: string
  created_at?: string
  currency?: string
  prices_include_tax?: boolean
  customer?: { email?: string; name?: string; phone?: string }
  shipping_address?: { line1?: string; city?: string; postal_code?: string; country?: string }
  lines: { sku: string; quantity: number; price: number }[]
  shipping?: number
  payment?: 'cod' | 'paid'
}

const enc = new TextEncoder()

async function hmac(secret: string, body: string, algo: 'SHA-256') {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: algo }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(body)))
}
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))
const hex = (u: Uint8Array) => [...u].map((b) => b.toString(16).padStart(2, '0')).join('')
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

/** WooCommerce: X-WC-Webhook-Signature = base64(HMAC-SHA256(body)); Shopify: X-Shopify-Hmac-Sha256, same scheme; others: X-Signature = hex */
async function verify(req: Request, body: string, secret: string) {
  const mac = await hmac(secret, body, 'SHA-256')
  const woo = req.headers.get('x-wc-webhook-signature')
  const shop = req.headers.get('x-shopify-hmac-sha256')
  const generic = req.headers.get('x-signature')
  if (woo) return safeEqual(woo, b64(mac))
  if (shop) return safeEqual(shop, b64(mac))
  if (generic) return safeEqual(generic.toLowerCase().replace(/^sha256=/, ''), hex(mac))
  return false
}

// deno-lint-ignore no-explicit-any
function fromWooCommerce(o: any): Normalised {
  return {
    id: String(o.id),
    number: o.number ? `#${o.number}` : undefined,
    created_at: o.date_created_gmt ? `${o.date_created_gmt}Z` : o.date_created,
    currency: o.currency,
    prices_include_tax: !!o.prices_include_tax,
    customer: { email: o.billing?.email, name: [o.billing?.first_name, o.billing?.last_name].filter(Boolean).join(' ') || undefined, phone: o.billing?.phone },
    shipping_address: { line1: [o.shipping?.address_1, o.shipping?.address_2].filter(Boolean).join(', ') || undefined, city: o.shipping?.city,
                        postal_code: o.shipping?.postcode, country: o.shipping?.country },
    // deno-lint-ignore no-explicit-any
    lines: (o.line_items ?? []).map((l: any) => ({ sku: l.sku, quantity: Number(l.quantity),
      price: o.prices_include_tax ? (Number(l.total) + Number(l.total_tax)) / Number(l.quantity) : Number(l.total) / Number(l.quantity) })),
    shipping: Number(o.shipping_total ?? 0) + (o.prices_include_tax ? Number(o.shipping_tax ?? 0) : 0),
    payment: o.payment_method === 'cod' ? 'cod' : 'paid',
  }
}

// deno-lint-ignore no-explicit-any
function fromShopify(o: any): Normalised {
  return {
    id: String(o.id),
    number: o.name,
    created_at: o.created_at,
    currency: o.currency,
    prices_include_tax: !!o.taxes_included,
    customer: { email: o.email ?? o.customer?.email, name: [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(' ') || undefined, phone: o.phone ?? o.customer?.phone },
    shipping_address: { line1: [o.shipping_address?.address1, o.shipping_address?.address2].filter(Boolean).join(', ') || undefined, city: o.shipping_address?.city,
                        postal_code: o.shipping_address?.zip, country: o.shipping_address?.country_code },
    // deno-lint-ignore no-explicit-any
    lines: (o.line_items ?? []).map((l: any) => ({ sku: l.sku, quantity: Number(l.quantity), price: Number(l.price) })),
    // deno-lint-ignore no-explicit-any
    shipping: (o.shipping_lines ?? []).reduce((t: number, s: any) => t + Number(s.price), 0),
    // deno-lint-ignore no-explicit-any
    payment: (o.payment_gateway_names ?? []).some((g: string) => /cash on delivery|cod/i.test(g)) ? 'cod' : 'paid',
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const channel = new URL(req.url).searchParams.get('channel')
  if (!channel) return Response.json({ error: 'channel query parameter is required' }, { status: 400 })
  const body = await req.text()
  const secret = Deno.env.get(`CHANNEL_WEBHOOK_SECRET_${channel.replace(/-/g, '')}`) ?? Deno.env.get('CHANNEL_WEBHOOK_SECRET')
  if (!secret || !(await verify(req, body, secret))) return Response.json({ error: 'invalid signature' }, { status: 401 })

  let raw: unknown
  try { raw = JSON.parse(body) } catch { return Response.json({ error: 'body is not JSON' }, { status: 400 }) }
  // WooCommerce pings the endpoint with {"webhook_id": …} when the webhook is saved
  if (raw && typeof raw === 'object' && 'webhook_id' in raw && !('id' in raw)) return Response.json({ ok: true })

  const payload: Normalised = req.headers.has('x-wc-webhook-signature') ? fromWooCommerce(raw)
    : req.headers.has('x-shopify-hmac-sha256') ? fromShopify(raw)
    : raw as Normalised
  if (!payload?.id || !Array.isArray(payload.lines)) return Response.json({ error: 'not an order' }, { status: 422 })

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const { data, error } = await db.rpc('ingest_channel_order', { p_channel: channel, p_payload: payload })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  // a failed import is stored with its reason (and can be retried in the app); the shop should not retry it
  return Response.json(data, { status: 200 })
})
