# channel-webhook

This Edge Function receives "order created" webhooks from a web shop and imports each order as a sales order, using `public.ingest_channel_order`.

- **Endpoint:** `POST /functions/v1/channel-webhook?channel=<sales channel id>`. The channel id is on the channel page under Web shop.
- **Signature:** WooCommerce sends `X-WC-Webhook-Signature` and Shopify sends `X-Shopify-Hmac-Sha256`; both are a base64 HMAC-SHA256 of the body. Any other sender uses `X-Signature`, a hex HMAC-SHA256. A request with a missing or wrong signature gets `401`.
- **Secret:** store the shop's webhook secret with the Supabase CLI. Credentials stay in Supabase secrets or Vault, never in tables.
  ```bash
  supabase secrets set CHANNEL_WEBHOOK_SECRET_<channel id without dashes>=<secret>
  ```
  For a single shop you can set `CHANNEL_WEBHOOK_SECRET` instead.
- **Mapping:** WooCommerce and Shopify orders are converted to the normalised payload documented in migration `20261024001920`. Other senders can post that payload directly.
- **Idempotent:** an order is imported once per channel and external id. If the shop retries, it gets back `{"status":"duplicate"}`.
- **Failures:** an unknown SKU or a missing customer is stored as a failed channel order, with the reason. The function still answers `200`, so the shop does not keep retrying. Fix the cause, then click **Retry** under Web shop.

Deploy:

```bash
supabase functions deploy channel-webhook --no-verify-jwt
```

`--no-verify-jwt` is needed because shops cannot send a Supabase JWT; the HMAC signature authenticates the request instead.

The function only imports orders. Pushing stock and products back to the shop is a separate connector. For now, **Sync stock now** computes what it would send.
