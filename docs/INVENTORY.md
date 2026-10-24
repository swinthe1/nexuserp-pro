# Inventory & advanced costing (Phase 2)

## How stock moves

All stock changes go through one database function, `app.post_stock_move()`. Every posting document calls it: receipts, adjustments and transfers today, and deliveries, POS and production later.

- Stock always moves **from** one location **to** another. Virtual locations stand in for the outside world: supplier, customer, adjustment, scrap and production. Quantities are therefore always conserved.
- `stock_movements` is the append-only ledger. `stock_levels` (per variant × bin × lot) and `item_costs` (the average cost per variant) are projections of it. Clients can read them but never write them.
- **Available = on hand − reserved.** This is a generated column.
- Negative stock is refused unless the company setting `allow_negative_stock` is on.
- Lot- or serial-tracked products require a lot on every movement. Expiry is stored on the lot. Reservations pick the earliest-expiring lot first (FEFO).

## Weighted average cost

The `item_costs` row of the variant is locked (`FOR UPDATE`) during every posting. Concurrent postings of the same item are therefore serialised, and the average stays exact.

| Movement | Effect on cost |
|---|---|
| Inbound (receipt, opening stock, adjustment in, return) | `new avg = (qty × avg + qty_in × cost_in) / (qty + qty_in)` |
| Outbound (issue, adjustment out, scrap) | Valued at the current average. The last unit out takes the exact remaining value, so no rounding residue is left behind. |
| Internal (transfer, bin move) | No change |
| Landed cost | Increases value only, so the average goes up |
| Receipt while stock is negative | The incoming units first cover the deficit at the incoming cost. The difference is recorded as an explicit `revaluation` movement, so the ledger still adds up. |

The history of every recalculation is kept in `item_cost_history`, and the product page charts it.

## Imported goods

1. **Receipt.** The receipt carries the currency, the **customs exchange rate**, the customs declaration number (DUD) and the country of origin.
   - Goods are valued at the PO price × customs rate.
   - Import VAT is never added to the cost of stock.
   - The receipt waits in "pending clearance".
2. **Landed cost.** After clearance, freight, customs duty, insurance and handling are entered as a landed cost and allocated by value, quantity, weight, volume or equally.
3. **Allocation.** Each receipt line's share is split two ways:
   - the part for goods **still in stock** is capitalised into the average cost;
   - the part for goods **already sold** is recorded as expensed. In Phase 5 it goes to COGS.
4. **Cleared.** The import receipt is then marked cleared.

## Reorder points and alerts

A reorder point is a replenishment rule per variant × warehouse, with these settings:

- the reorder point (min);
- the order-up-to level (max);
- the pack size;
- the preferred vendor.

When available stock falls to the reorder point, an alert opens and inventory and purchasing managers are notified, in real time. The alert closes automatically when stock recovers.

The suggested order is `max − available − already on order`, rounded up to the pack size.

## Approvals

When an adjustment is posted, its value is checked against the company's approval workflows. A write-off above the threshold waits for the approver. Requesters cannot approve their own documents.

## Verification

- `supabase/tests/02_inventory_engine.sql` contains 69 assertions. They cover:
  - the WAC formulas, FX import costing and landed cost capitalisation;
  - the negative-stock settlement, lots, transfers, alerts and reservations;
  - approvals, permissions and the atomic draft saves.
- They also check the invariants: the quantity in `item_costs` equals Σ `stock_levels` and Σ signed movements, and the value equals Σ signed movement values.
- The UI was exercised end to end in Chromium against PostgREST over the migrated database:
  - creating and posting a receipt;
  - a manager approving a write-off, then the requester posting it;
  - search with ⌘K.
- No console or API errors were recorded.
