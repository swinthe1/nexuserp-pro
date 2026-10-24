# Procurement (Phase 4)

Migration `20261023001500_procurement_engine.sql` adds the purchasing logic on top of the Phase 1 tables. Tests: `supabase/tests/04_procurement.sql` (76 assertions).

## The flow

```
Requisition  draft ─submit_requisition─▶ submitted ─decide_requisition / approval workflow─▶ approved ─create_po_from_requisition─▶ ordered
Replenishment rules ─generate_replenishment─▶ suggestions ─create_pos_from_suggestions─▶ draft POs
                                                    │
Purchase order  draft ─submit_purchase_order─▶ (pending_approval ─▶) approved ─▶ sent
                ─create_receipt_from_po─▶ goods receipt ─post_goods_receipt─▶ partially_received ─▶ received ─▶ closed
                ─create_bill_from_po─▶ vendor bill ─match_vendor_bill / post_vendor_bill─▶ posted
                                                    create_vendor_credit ─▶ vendor credit note
```

Every document is numbered from its own gapless series: `PR-`, `PO-`, `GRN-`, `BILL-` and `VCN-`. Every status change is checked against the status flow.

## Requisitions

- Anyone with `requisitions.write` can ask for catalogue items or free-text items. They can add an estimated cost and a suggested vendor.
- **Submitting** a requisition does one of two things:
  - If an approval workflow for `purchase_requisition` covers its amount, it goes through that workflow.
  - Otherwise it waits for someone with `requisitions.approve` (the procurement manager is notified).
- Nobody can approve their own requisition, except a company admin. A rejection must have a reason, and the requester can edit the requisition and submit it again.
- **Ordering** creates one draft PO per vendor. The vendor for each line is chosen in this order:
  1. the vendor suggested on the line;
  2. the vendor picked when ordering;
  3. the vendor on the item's reorder rule;
  4. the preferred vendor on the item's vendor price;
  5. the cheapest vendor price.
- Lines that end up without a vendor are listed in the error message.

## Pricing — `get_purchase_price(company, vendor, item, qty, currency, date)`

The first match wins:

1. **The vendor's price** (`vendor_products`), with the vendor's item code, minimum order and lead time. The price is converted to the order currency at the company rate.
2. **The last price paid** to this vendor for the item.
3. **The average cost**, or else the standard cost.

The PO editor:
- warns when a quantity is below the vendor's minimum order;
- shows stock on hand and quantities already on order;
- sets the expected date from the longest lead time on the order.

## Approval

- `submit_purchase_order` checks the order first:
  - it has lines;
  - the vendor is active;
  - the warehouse is active;
  - every item can be purchased;
  - the total is above zero.
- It then calls the approval engine:
  - if a workflow applies (for example "POs over 100,000 ALL"), the order waits at `pending_approval`;
  - otherwise it is approved straight away.
- **Withdraw** sends a pending order back to draft and cancels its approval request.
- An order can be cancelled only before anything has been received or billed. After that, it can only be closed.

## Receiving

- `create_receipt_from_po` drafts a goods receipt for everything still due. Quantities already sitting on other draft receipts are left out.
- The warehouse adjusts quantities, lots and bins, then posts the receipt with the Phase 2 `post_goods_receipt`:
  - stock comes in at the PO price × exchange rate;
  - the weighted average cost is updated;
  - the PO moves to partially received or received.

## Three-way match — `match_vendor_bill`, `post_vendor_bill`

Each bill line linked to a PO line gets one of these results:

| Result | When |
|---|---|
| `no_receipt` | goods billed before any of them were received |
| `qty_variance` | billed more than received (services: more than ordered), minus what was already billed, beyond `company_settings.match_qty_tolerance_pct` (default 0 %) |
| `price_variance` | net unit price above the PO price by more than `match_price_tolerance_pct` (default 2 %) |
| `matched` | anything else (a price below the PO is matched, and the difference is recorded) |

A bill with any exception cannot be posted. To post it anyway:
- the user needs `invoicing.write` plus `procurement.approve` or `invoicing.approve`;
- they must give a reason;
- the reason and their name are stored on the bill.

Posting a bill also:
- updates `qty_billed`, and the PO's billing status (an order that is both received and billed closes itself);
- **adjusts stock value for price differences** — when the billed price differs from the receipt cost:
  - the share still in stock is added to stock value as a `revaluation` movement, which moves the average cost;
  - the share already sold is recorded as `expensed_variance`, for the Phase 5 GL postings;
- blocks entering the same vendor invoice number twice for the same vendor (case and spaces ignored);
- sets the due date from the vendor's payment terms.

Vendor credit notes reduce the billed quantities and can never exceed the original bill.

## Replenishment — `generate_replenishment`

For every active reorder rule:

- **Projected stock** = on hand − reserved + on order. "On order" also includes draft and pending POs, so nothing is ordered twice.
- **Suggested quantity:** when projected stock is at or below the minimum, the suggestion fills up to the maximum. It is rounded up to the order multiple and to the vendor's minimum order.
- **Methods:** "buy" suggestions become POs grouped by vendor and warehouse. "Transfer" and "manufacture" suggestions are listed but not ordered (manufacturing arrives in Phase 7).
- **Cancelled orders:** cancelling a PO made from suggestions dismisses those suggestions, so the next run suggests the items again.

## Metrics — `procurement_overview(company, from, to)`

| Metric | Source |
|---|---|
| Spend | Posted bills net of credit notes, excluding VAT, in the base currency |
| Purchase order figures | Order count and value; open order value and late orders; value received but not yet billed |
| Approvals | Pending PO approvals and requisitions |
| Bills | Match exceptions; payables open, due within 7 days and overdue |
| Delivery | On-time delivery % and average lead time (receipt date vs. the PO's expected date) |
| Trends and rankings | 12-month spend; top vendors with on-time % and lead time; top purchased items |

## Integrity: system-only statuses

Statuses that only a posting function may set are now refused when a client writes them directly:
- posted
- done
- approved
- confirmed
- received
- converted
- …and similar statuses across all document types, including the earlier phases.

Before this change, the Supabase API alone could mark a document as posted without running its posting logic. These statuses are now reachable only through the RPCs that do the work.

## UI

| Route | Page |
|---|---|
| `/procurement` | Purchasing overview |
| `/procurement/requisitions` | List; detail page with submit / approve / reject / send back / create orders |
| `/procurement/orders` | List with received % and billing; detail page with submit, withdraw, mark sent, receive goods, enter bill, close, cancel |
| `/procurement/bills` | List with match status; detail page with check match, post, override, credit note |
| `/procurement/replenishment` | Suggestions with editable quantity and vendor; creates POs in bulk |
| `/procurement/vendor-prices` | Vendor price lists (also a tab on each vendor) |
| `/partners?role=vendor` | Vendors. A vendor's page adds **Purchasing** and **Vendor prices** tabs |
