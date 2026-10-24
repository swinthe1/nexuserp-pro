# Logistics, order management and e-commerce (Phase 8)

Migrations:
- `20261024001920_logistics_ecommerce_engine.sql`: logistics and e-commerce.
- `20261024001930_oms_automation.sql`: replenishment automation and the fulfilment queue.

Tests: `supabase/tests/10_logistics_oms.sql` (40 assertions).

## Logistics

Pages: `/logistics` (overview), `/logistics/planning` (dispatch board), `/logistics/routes`, `/logistics/shipments`, and `/logistics/setup` (carriers, vehicles, drivers).

Roles:
- **Logistics manager** (new): runs logistics.
- **Warehouse operators:** can now record dispatches and stops (`logistics.write`).

### Flow

```
delivery (picked) → shipment → route stop (own fleet) or carrier hand-off
                 → in transit → delivered | failed (re-scheduled or cancelled)
```

- **Shipments.** `create_shipment(delivery, {carrier_id, ship_date, packages, weight_kg, cod_amount, tracking_number, notes})` makes a shipment from a picked delivery.
  - The weight defaults to the product weights × quantities.
  - The address is the delivery's shipping address, or else the customer's default shipping address.
- **Stock leaves when the shipment leaves.** When a shipment goes in transit, the delivery is posted (stock out, cost of goods sold) if the warehouse has not posted it already.
- **Tracking.** Every status change writes a row to `shipment_events`. The shipment page shows them as the tracking timeline.
- **External carriers.** `ship_with_carrier(shipment, carrier, tracking)` hands the shipment over with a tracking number. Later updates come from `update_shipment(shipment, status, note, location)` (the office, or the carrier connector when one exists). A failed delivery needs a reason; a failed shipment can be scheduled again.

### Routes (own fleet)

| Function | What it does |
|---|---|
| `create_route` | Takes a date, vehicle and driver. Refuses a vehicle or driver already on another route that day. |
| `assign_to_route(route, shipments[])` | Adds the shipments as stops at the end, grouped by city. Refuses them if their weight would exceed the vehicle's capacity. |
| `reorder_route(route, stop_ids[])` / `remove_from_route(shipment)` | Change the stop order, or take a shipment off the route. |
| `start_route(route)` | Every shipment on the route goes in transit, which posts the deliveries. |
| `record_stop(stop, outcome, note, cod_collected)` | Delivered, with whether the cash on delivery was collected; failed, with a reason; or skipped, which counts as failed. |
| `complete_route(route, km)` | Closes the route with the distance driven. |

- **Dispatch board.** `dispatch_queue(company, warehouse?)` lists picked deliveries waiting for a shipment and shipments waiting for a route, with weight and city.
- **Overview.** `logistics_overview(company, from, to)` reports what is waiting for dispatch, in transit and on routes today; delivered and failed counts; on-time and first-attempt rates; cash on delivery to settle; and breakdowns by carrier and by day.

### Cash on delivery

- The driver records the cash collected at the stop.
- `settle_cod(shipments[], cash_or_bank_account, date)` creates one customer receipt per shipment, allocated to that order's open invoices, and posts it like any receipt (Dr cash or bank / Cr receivables). It needs `invoicing.write`.

## Order management

Pages: `/oms` (replenishment, with the automation settings) and `/oms/fulfillment` (open order lines).

### Replenishment suggestions

- `generate_replenishment(company, warehouse?)` compares, for each product with a minimum and maximum in a warehouse:

  ```
  available = on hand − reserved − open customer demand not yet reserved + incoming (open POs and transfers)
  ```

  When available falls below the minimum, it suggests ordering up to the maximum, and at least the vendor's minimum order quantity.
- The preferred vendor and price come from the vendor price lists (Phase 4).
- **Transfer rules.** If another warehouse holds stock above its own minimum, the suggestion pulls from that warehouse first. `create_transfers_from_suggestions(ids[])` turns those suggestions into draft transfers.

### Automated purchase orders

- `run_replenishment(company, action)` runs the suggestions and then applies the company's action:
  - `suggest`: suggestions only;
  - `draft_po`: draft purchase orders, one per vendor and warehouse;
  - `submit_po`: the draft POs, submitted for approval, when the person running it may submit them.

  Every run is logged in `replenishment_runs` with its counts, and procurement is notified.
- `set_replenishment_automation(company, enabled, action, hour)` saves the settings. It needs `procurement.write`.
- **Schedule.** `run_scheduled_replenishment()` runs hourly through pg_cron (`5 * * * *`) when pg_cron is available.
  - Each company is run at its chosen local hour.
  - Scheduled runs only ever create drafts; people submit them.
  - A company that already had a scheduled run in the last 50 minutes is skipped.

### Fulfilment queue

`fulfillment_queue(company, warehouse?)` lists every open order line with ordered, delivered, reserved, available, short and expected quantities, and the date the next receipt is expected. Each line gets a state:
- `in_delivery`: an open delivery already covers the line;
- `ready`: fully reserved;
- `can_reserve`: free stock covers it, but it is not reserved yet;
- `awaiting_stock`: covered only once incoming receipts arrive;
- `short`: not covered even with what is incoming.

## E-commerce (placeholders for the connectors)

Pages: `/ecommerce` (channels) and `/ecommerce/:id` (orders, product links, stock sync log). Sales managers have `ecommerce.write`.

- **Ingesting orders.** `ingest_channel_order(channel, payload)` takes a normalised order:
  - `external_id`, customer, lines by SKU, shipping and payment.
  - It is idempotent on the channel and `external_id`.
  - It matches the customer by email or creates one, matches SKUs through `channel_product_links`, and creates a confirmed sales order.
  - Orders that cannot be matched are stored as `failed` with the reason. `retry_channel_order(id)` tries again after the product is linked.
- **Products and stock.**
  - `link_channel_products(channel)` links products by SKU.
  - `sync_channel_stock(channel)` computes the available quantity per linked product and logs what would be pushed.
- **Webhook.** The Edge Function `supabase/functions/channel-webhook` checks the channel's shared secret and maps a Shopify or WooCommerce order to the normalised payload. It then calls `ingest_channel_order` with the service role. See its README.

Pushing stock and fetching catalogues need each platform's API credentials, so those calls are stubs that only log.
