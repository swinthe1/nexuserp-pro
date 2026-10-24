# CRM & sales (Phase 3)

Migration `20261023001400_sales_engine.sql` adds the business logic on top of the Phase 1 tables. Tests: `supabase/tests/03_sales_flow.sql` (57 assertions).

## The flow

```
Lead ──convert_lead──▶ Customer + Opportunity ──(stages)──▶ Won / Lost
                                   │
                                   ▼
                     Quote ──convert_quote_to_order──▶ Sales order
                     draft → sent → accepted/rejected/expired → converted
                                                          │ confirm_sales_order
                                                          ▼
                     draft → (pending_approval) → confirmed ─▶ partially_delivered ─▶ delivered ─▶ closed
                                                   │ reserves stock (FEFO)
                                                   ▼
                     create_delivery_from_order ─▶ Delivery (draft/ready) ─post_delivery─▶ done (stock out, COGS at WAC)
                     create_invoice_from_order  ─▶ Invoice (draft) ─post_sales_invoice─▶ posted (fiscal queue for AL/XK)
                     create_credit_note         ─▶ Credit note, capped at what is left to credit
```

Every document gets its number from the gapless per-company, per-year series (`LD-`, `OPP-`, `QT-`, `SO-`, `DO-`, `INV-`, `CN-`), and every status change is checked against `status_transitions`.

## Pricing — `get_price(company, partner, variant, qty, date, price_list, currency)`

The first match wins:

1. **Customer price** (`partner_prices`): a fixed price and/or a discount for this customer. It can have quantity breaks and a validity window.
2. **Price list**: the list chosen on the document, else the customer's list, else the company's default list. The highest `min_quantity` that is ≤ qty applies, and the list must be in validity and in the document currency.
3. **Product sales price**.

The customer's `default_discount_pct` is added when the matched rule has no discount of its own. The editor re-prices "automatic" lines when the customer, price list, currency or quantity changes. A price typed by hand is kept.

## Validations on confirmation (`tg_sales_order_confirm`)

| Check | Who can override |
|---|---|
| At least one line; active customer; every product sellable | — |
| Line discount ≤ `company_settings.max_discount_pct` (default 15 %) | users with `sales.approve` |
| Customer exposure (open invoices + open orders + this order) ≤ credit limit | users with `sales.approve` |

`confirm_sales_order` goes through the approval engine first, so a workflow on `sales_order` can stop an order at `pending_approval`.

## Inventory integration

- **Confirming an order reserves stock** in the shipping warehouse, oldest-expiry lots first. Partial reservations are allowed, and the rest is backordered.
- To retry later, use `reserve_sales_order`, or the **Reserve stock** button.
- `sales_order_availability` returns, per line: ordered, reserved, delivered, to reserve, free, and incoming.
- **Deliveries** are created from reserved bins first, then from free stock. A delivery can't ship more than is on hand.
- Posting a delivery consumes the reservation, moves stock to the customer location, and snapshots the WAC unit cost as COGS.
- **Cancelling or closing** an order releases its reservations.

## Invoicing

- From an order, the invoice quantity is: delivered quantity for goods, or ordered quantity for services, minus what is already invoiced or sitting on a draft invoice.
- Posting:
  - needs an open fiscal period;
  - updates `qty_invoiced` and the order's `invoice_status`;
  - closes orders that are fully delivered and fully invoiced;
  - for AL/XK companies, queues a `fiscalization_records` row (the fiscal service itself arrives in Phase 8).
- The due date follows the payment terms.

## Metrics — `sales_overview(company, from, to)`

| Metric | Source |
|---|---|
| Revenue | Posted invoices, net of credit notes, excluding VAT, in base currency |
| COGS | Posted deliveries |
| Orders | Confirmed orders |
| Other | Quote conversion, win/loss, backlog (open order value not yet delivered), overdue receivables, pipeline by stage (value and weighted), 12-month revenue, top customers, top products, revenue by salesperson |

## UI

| Route | Page |
|---|---|
| `/sales` | Sales overview with period selector |
| `/crm/pipeline` | Kanban (drag between stages, optimistic, lost reason on drop) or list; deal sheet with quotes |
| `/crm/leads` | Leads list, lead sheet, convert dialog (new or existing customer, duplicate hint) |
| `/sales/quotes`, `/sales/orders`, `/sales/invoices` | Lists with facets and CSV/PDF export; one document page per kind with the actions allowed in its status |
| `/sales/deliveries` | Pick bin/lot, partial quantities, ready → post |
| `/sales/price-lists` | Lists with quantity breaks and live margin against average cost |
| `/partners` | Customer record: balance, credit headroom, documents, contacts, addresses, special prices |
