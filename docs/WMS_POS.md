# Warehouse floor & point of sale (Phase 6)

Migration `20261023001700_wms_pos_engine.sql` adds the warehouse and till logic on top of the Phase 1 tables. Tests: `supabase/tests/06_wms_pos.sql` (66 assertions).

Both modules go through the same stock ledger as everything else (`app.post_stock_move`, weighted average cost), so stock, valuation and the general ledger stay in step. The demo checks that GL inventory still equals the stock valuation after a day of trading and warehouse work.

## Warehouse floor (`/wms`)

Every screen is built around one scan field. It works with a keyboard-wedge scanner (the scanner types the code and presses Enter), with the phone camera (where the browser supports `BarcodeDetector`) and with the keyboard. Good scans beep, bad ones buzz, and focus returns to the field after every scan. A scanned code is resolved in this order:

1. bin label or bin code;
2. product barcode or SKU, including pack barcodes that count several units per scan;
3. lot number.

On the overview, number keys 1–7 open the screens.

| Screen | What happens |
|---|---|
| **Receive** | Scan the PO, receipt or delivery-note number, then scan each item. Lot-tracked items ask for the lot and expiry; `ensure_lot` creates a new lot from the scanner. Short or over deliveries are shown before posting. Posting is the same `post_goods_receipt` as the office screen. |
| **Put away** | A receipt that leaves goods in a location that can't be picked from (`WH/RECEIVING`, quality) creates a putaway task automatically. `create_putaway_task` sweeps any location into a new task. `suggest_putaway` ranks bins: bins that already hold the item, then bins with the same category, then empty bins. Scanning any bin label puts the quantity there; the suggestions are only shortcuts. |
| **Pick** | `create_pick_list` covers one or more open deliveries from one warehouse, ordered along the bins. The picker scans the bin and then each item; another bin or lot can be scanned instead of the one suggested. Progress is kept on the device, so a refresh does not lose it. `complete_pick_list` shrinks each delivery to what was picked, and the sales order keeps the shortfall as a backorder. A delivery with nothing picked is cancelled. Deliveries that were picked become *ready*. |
| **Ship** | `confirm_shipment` records carrier, tracking number, parcels and weight, then posts the delivery: stock leaves and cost of goods sold is booked. A packing slip prints from the same screen. |
| **Move** | Scan the source bin, then the items, then the destination bin. `move_stock` posts one internal transfer, also between warehouses, and never moves reserved stock. |
| **Cycle counts** | `create_cycle_count` takes a snapshot of a warehouse, some bins or a category; counts are blind by default. Scans count up, and a typed quantity sets the count. Items found where the system had none get a new line. `submit_cycle_count` refuses to finish while lines are uncounted, unless "count missing as zero" is ticked. `post_cycle_count` needs `inventory.write`. It compares each count with what the bin held **when that line was counted**: anything picked or moved during the count is not undone. The differences become one `count` stock adjustment, which goes through approval when a workflow applies. |
| **Lots & expiry** | `lots_expiring` lists lots by days left. `lot_trace(lot)` is the recall view: every movement of the lot, where it is now, and which customers or tills received it, with a CSV recall list. Picking, putaway and the till use the lot that expires first (FEFO), and expired lots are never reserved. |

## Point of sale (`/pos`)

**Registers.** A register sells from one stock location and keeps its cash in one drawer account; the demo uses 5311 *Cash in POS drawers*. It can use its own price list and default customer, and has its own receipt header and footer. `pos_catalog(register)` returns what the till needs:

- tax-inclusive prices from the price list;
- barcodes, including pack barcodes;
- product type, tracking and stock at the register's location.

**Opening.** `open_pos_session` needs a connection. It asks for the float counted into the drawer, and the float is booked from the cash box (531) to the drawer.

### The cashier screen (`/pos/till/:register`)

The till runs full screen, outside the app shell. Everything can be done from the keyboard.

| Key | Action |
|---|---|
| (scan) | Adds the item. Scanning it again increases the quantity. A pack barcode adds the whole pack. |
| `3*` + scan | Sells three |
| type + Enter | Searches by name or SKU. A single match is added. |
| Enter on an empty field, or F12 | Takes payment |
| F2 | Focuses the search |
| F4 | Customer (a business customer's NIPT prints on the receipt) |
| F9 | Refund |
| + / − / Delete / ↑ ↓ | Changes the quantity of the selected line, removes it, or moves the selection |
| F5–F8 in the payment window | Cash, card, transfer, voucher |
| P / Enter after the sale | Prints the receipt / starts the next sale |

**Payments and discounts.**

- **Split payments:** a payment can be split across methods.
- **Quick cash:** the payment window offers *Exact* and the next round notes. A tender that covers what is left finishes the sale immediately and shows the change in large type.
- **Change:** only cash can be more than what is due.
- **Discounts:** line discounts above 10% need `pos.approve`.

**Receipts.** Receipts print on 80 mm paper through a hidden frame, which works offline and is not blocked as a pop-up. Auto-print can be switched on or off per device.

**Refunds.** Scan or type the original receipt number; the device reference also works. The cashier chooses the quantities. The server refuses refunds of more than what is left to refund on that receipt. Items come back into the till's stock at the cost they left with.

**Cash in/out.** Change top-ups and mid-day banking each need a reason, and each is booked between the drawer and the cash box.

### Offline

The till keeps working without a connection.

- **Cache.** Products, prices, barcodes and customers are kept on the device in IndexedDB. The app shell is cached by the service worker, so a till that has been used once on a device opens and sells after a reload with no network. This was tested against the production build.
- **Queue first.** Every sale is written to an IndexedDB queue **before** anything else happens: receipt, stock badge, next sale. A dropped connection, a closed tab or a crash never loses a sale.
- **Receipt numbers.** While offline, receipts are numbered on the device: `T1-261024-0007`. The server number (`POS-2026-…`) is added when the sale syncs, and both are kept.
- **Sync.** The queue syncs on reconnect, every 15 seconds while anything is pending, and on demand. It stops at the first network error and keeps the original order.
- **Safe replays.** `pos_submit_order` is idempotent on the sale's `client_uuid`. Sending the same sale twice returns the first result, so retries never double-count.
- **Closed sessions.** If the session was closed while a sale waited, the sale moves to the register's open session. A sale the server refuses for another reason stays on the device as *failed*, with the reason shown, until it is retried or discarded. The top bar shows *Synced*, *Waiting* or *Offline · n to sync*.

### Stock and accounting

**At each sale.** Stock leaves the register's location immediately (`pos_sale`; refunds post `pos_return`). Cost of goods sold is booked from the stock ledger in the register's journal, and lot-tracked items are taken first-expiry-first. The till is allowed to take stock negative (only the till, through a transaction setting): a busy checkout never stops because the stock on record is wrong. The negative shows up in stock levels for the warehouse to correct.

**At closing.** `close_pos_session(session, counted_cash)` produces the Z-report and two journal entries:

| Entry | Debit | Credit |
|---|---|---|
| **Sales** | Drawer for net cash (cash received less change); card clearing (581) for card; bank for transfers; customer advances for vouchers | Revenue per product category account; VAT per tax code |
| **Cash** | Cash box (531) for the counted cash; cash differences (658) if short | Drawer for the expected cash; cash differences (658) if over |

**The Z-report** (`z_reports`) holds:

- receipts and refunds, gross sales, discounts, net of VAT and VAT;
- the VAT breakdown by rate;
- payments by method and change given;
- opening float, cash in and out, expected and counted cash, and the difference;
- the ten best sellers.

It prints on 80 mm paper and stays on the session page, together with the receipts (each can be reprinted) and an Accounting tab with the session's entries as T-accounts. `pos_session_summary` gives the same figures live while the till is open (an X-report).

## Permissions

| Role | Can |
|---|---|
| `pos_cashier` | Sell, refund, cash in/out, open and close tills (`pos.read`, `pos.write`) |
| `store_manager` (new role) | Everything a cashier can, plus `pos.approve`: discounts above 10%, register setup. Also store stock moves and counting (`wms.write`) |
| `wms.write` | All warehouse-floor screens |
| `inventory.write` | Posting cycle counts |

## Demo data

The demo company has the following:

- **Users:** two cashiers, Mira and Ardit.
- **Registers:** two at the Blloku store, with stock transferred from the main warehouse.
- **Yesterday:** a full day on till 1, with a refund, mid-day banking and the drawer 200 short.
- **This morning:** a balanced session on till 2.
- **Open now:** till 1, with a few sales already.
- **Warehouse:** bins with barcode labels (`LOC-A01`, `LOC-B01`, …), three putaway tasks from receiving, Spar's order released for picking, and a cycle count of `WH/STOCK` half done.

Sign in as `mira@ylli.al` to work the till, or as `besnik@ylli.al` for the warehouse.
