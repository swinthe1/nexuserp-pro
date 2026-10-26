import { msg } from '@/i18n'

/** The calls of the DrisPRO API (shown in the app and on the public /api page). */
export const CALLS: { fn: string; scope: string; what: string; body: string }[] = [
  { fn: 'api_products', scope: 'catalog.read', what: msg('Products, 200 at a time (up to 500); “next” is the SKU to continue after. With p_updated_since, only what changed (also switched-off ones).'), body: '{"p_updated_since":"2026-10-01T00:00:00Z","p_after":null,"p_limit":200}' }, // i18n-ignore
  { fn: 'api_stock', scope: 'catalog.read', what: msg('Stock per warehouse: on hand, reserved, available.'), body: '{"p_skus":["33173","33174"],"p_warehouse":null}' }, // i18n-ignore
  { fn: 'api_prices', scope: 'catalog.read', what: msg('The price a customer gets, by their code (their own price, their price list or the list price).'), body: '{"p_partner_code":"1001","p_skus":["33173"],"p_quantity":1}' }, // i18n-ignore
  { fn: 'api_partners', scope: 'partners.read', what: msg('Customers and vendors with what customers owe, paged by code.'), body: '{"p_updated_since":null,"p_after":null}' }, // i18n-ignore
  { fn: 'api_partner_upsert', scope: 'partners.write', what: msg('Create or update by code, with the same columns as the spreadsheet import.'), body: '{"p_rows":[{"code":"1001","name":"Viva Fresh","role":"customer","tax_number":"810000011"}]}' }, // i18n-ignore
  { fn: 'api_order_create', scope: 'orders.write', what: msg('A sales order at the company’s prices. The same external_id never makes a second order. “confirm”: true confirms it at once.'), body: '{"p":{"external_id":"WEB-1001","partner_code":"1001","confirm":true,"lines":[{"sku":"33173","quantity":2}],"note":"…"}}' }, // i18n-ignore
  { fn: 'api_order_get', scope: 'orders.read', what: msg('An order by its number or external_id: status, delivered and invoiced quantities.'), body: '{"p_external_id":"WEB-1001"}' }, // i18n-ignore
  { fn: 'api_invoices', scope: 'invoices.read', what: msg('Posted invoices and what is still open, paged by number.'), body: '{"p_since":"2026-10-01","p_partner_code":null}' }, // i18n-ignore
]

/** What a webhook can tell (the same list as app.webhook_events on the server). */
export const WEBHOOK_EVENTS: { key: string; what: string }[] = [
  { key: 'invoice.posted', what: msg('A sales invoice was posted') },
  { key: 'credit_note.posted', what: msg('A credit note was posted') },
  { key: 'payment.received', what: msg('A customer paid') },
  { key: 'payment.sent', what: msg('A vendor was paid') },
  { key: 'order.created', what: msg('A sales order was made (also from the web shop or the B2B portal)') },
  { key: 'order.confirmed', what: msg('A sales order was confirmed') },
  { key: 'bill.posted', what: msg('A vendor bill was posted') },
  { key: 'stock.low', what: msg('An item fell under its minimum') },
  { key: 'partner.created', what: msg('A new customer or vendor') },
  { key: 'appointment.created', what: msg('An appointment was booked') },
  { key: 'appointment.cancelled', what: msg('An appointment was cancelled') },
  { key: 'membership.sold', what: msg('A membership was sold') },
]

export const WEBHOOK_EXAMPLE = `{
  "id": "5b0c…",
  "event": "invoice.posted",
  "created_at": "2026-10-27T09:14:03Z",
  "company_id": "82893c66-…",
  "data": {
    "id": "95aae474-…", "number": "INV-2026-00042", "date": "2026-10-27", "due_date": "2026-11-10",
    "partner": { "id": "…", "code": "1001", "name": "Viva Fresh", "tax_number": "810000011" },
    "currency": "EUR", "net": 100.00, "vat": 18.00, "total": 118.00, "amount_due": 118.00
  }
}` // i18n-ignore

export const VERIFY_NODE = `import crypto from 'node:crypto'

// req.rawBody: the body exactly as received
function fromDrisPRO(req, secret) {
  const ts = req.headers['x-drispro-timestamp']
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(ts + '.' + req.rawBody).digest('hex')
  const fresh = Math.abs(Date.now() / 1000 - Number(ts)) < 300   // not older than 5 minutes
  return fresh && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(req.headers['x-drispro-signature'] || ''))
}` // i18n-ignore

export const VERIFY_PHP = `<?php
$body = file_get_contents('php://input');
$ts = $_SERVER['HTTP_X_DRISPRO_TIMESTAMP'] ?? '';
$expected = 'sha256=' . hash_hmac('sha256', $ts . '.' . $body, getenv('DRISPRO_WEBHOOK_SECRET'));
if (!hash_equals($expected, $_SERVER['HTTP_X_DRISPRO_SIGNATURE'] ?? '') || abs(time() - (int)$ts) > 300) {
  http_response_code(401); exit;
}
$event = json_decode($body, true);   // $event['event'], $event['data']
http_response_code(200);` // i18n-ignore
