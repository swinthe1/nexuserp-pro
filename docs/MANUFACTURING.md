# Manufacturing (Phase 7)

Migration `20261023001800_manufacturing_engine.sql` adds the production logic on top of the Phase 1 tables (`work_centers`, `boms`, `bom_lines`, `bom_operations`, `work_orders`, `work_order_materials`, `work_order_operations`, `work_order_consumptions`, `production_outputs`, `lot_genealogy`). Tests: `supabase/tests/07_manufacturing.sql` (59 assertions).

Production uses the same stock ledger as every other module (`app.post_stock_move`, weighted average cost). Material leaves stock into the virtual *production* location and finished goods come back out of it, so stock, valuation and the general ledger stay in step. Work in progress has its own account, so the inventory-to-GL check still holds while orders are open.

Permissions: `manufacturing.read` to see the module, `manufacturing.write` to change BOMs and run work orders. The demo user is the `production_manager` role.

## Bills of materials (`/manufacturing/boms`)

A BOM belongs to one product variant and makes a **batch** of a given quantity. A variant can have several versions; the one marked *default* is used when a work order names only the product. A BOM is either `manufacture` (made on a work order) or `kit` (exploded at sale and never produced). Saving a BOM marks its product as manufactured.

- **Lines** are components with a quantity per batch, a scrap percentage and an optional operation they are used at.
- **Multi-level.** A component can be a manufactured product with its own default BOM. That makes it a sub-assembly, and every function below walks down through it. Saving a BOM that contains itself at any depth is rejected.
- **Operations** run in sequence on a work center, with setup minutes and run minutes per unit. The work center's efficiency stretches or shortens the time.

| Function | Returns |
|---|---|
| `bom_explode(bom, qty)` | The full tree for a quantity: depth, path, quantity needed including scrap, which lines are sub-assemblies, unit and extended cost, stock on hand and available, tracking |
| `bom_cost(bom, qty, rollup)` | Material, labour, overhead, total and unit cost. With `rollup`, sub-assemblies are costed from their own BOMs; without it, at their current stock cost |
| `bom_where_used(variant)` | Every BOM that uses a component, directly or through sub-assemblies |

Component cost is the weighted average cost, or the product's standard cost when there is no stock yet. Labour and overhead come from the work center's cost per hour and overhead per hour times the operation minutes.

The BOM page has four tabs: **Structure** (the exploded tree for a chosen quantity, with shortages in red), **Cost**, **Components & operations** (the editor) and **Where used**.

## Work orders (`/manufacturing/orders`)

The list has a table and a board view (`?view=board`). Statuses:

```
draft ──release──► released ──first booking──► in_progress ──last output──► completed ──close──► closed
  │                    │                                    └──finish early──┘
  └──────cancel────────┴──► cancelled   (only while nothing is booked)
```

`released`, `in_progress`, `completed` and `closed` are system statuses: only the functions below can set them. Once material or time is booked, the product, BOM and quantity are locked. Cost, quantity and operation-actual columns can never be written by the client.

| Step | Function | What happens |
|---|---|---|
| Create | `create_work_order(p)` | Takes a BOM or product, quantity, warehouse, dates, priority and optionally a sales order. Copies the materials (with scrap) and operations from the BOM and stores the planned material, labour and overhead cost. With `make_subassemblies`, it creates a child work order for every sub-assembly that is short, recursively. |
| Release | `release_work_order(wo)` | Checks availability across all materials (`material_availability`) and returns the shortages. Releasing with shortages is allowed; the screen shows them. Back to draft is possible while nothing is booked. |
| Use materials | `consume_materials(wo, items)` | Books chosen quantities, with lots picked on the screen or taken first-expiry-first (FEFO). Passing no items backflushes everything still due. More than is in stock is refused, naming the bin and the shortfall. |
| Return unused | `return_materials(wo, items)` | Gives material back to stock at the cost it was taken at. Never more than was used. |
| Report work | `record_operation(op, minutes, finish)` | Books actual minutes, labour and overhead on an operation. |
| Report output | `produce(wo, qty, lot, expiry, scrap, backflush)` | Receives finished goods into the output location, optionally creating the lot (best-before date required for lot-tracked items with expiry). With backflush, materials and operations are booked first in proportion to *(produced + scrapped + this quantity) / planned*. Manual consumption already booked counts toward that. The last output finishes all operations and completes the order. |
| Finish early | `complete_work_order(wo)` | Completes an order that will produce less than planned. |
| Close | `close_work_order(wo)` | Settles the cost (below). Refused while sub-assembly orders are still open. |
| Cancel | `cancel_work_order(wo)` | Only for draft or released orders with nothing booked. Cancels its untouched sub-assembly orders as well. |

The detail page shows the actions for the current status, and has tabs for **Materials**, **Operations**, **Output**, **Cost** (planned vs actual by element), **Planning** (dates and priority), **Accounting** (every journal entry of the order) and **Activity**.

## Costing and postings

Work in progress collects on account **331**. Every entry links back to the work order and is listed in journal **MFG**.

| Event | Debit | Credit | Amount |
|---|---|---|---|
| Material used | 331 WIP | component's inventory account | weighted average cost of the lots taken |
| Material returned | component's inventory account | 331 WIP | the cost it was taken at |
| Work reported | 331 WIP | 7212 labour absorbed, 7213 overhead absorbed | minutes × work-center rates |
| Output received | product's inventory account | 331 WIP | see below |
| Close | 6012 production variance | 331 WIP | whatever is left in WIP (credit when negative) |

**Valuing output.** A partial output is valued at the planned unit cost (planned material + labour + overhead divided by the planned quantity), but never more than WIP currently holds. The last output takes everything left in WIP, so a completed order normally has nothing left to settle. When the order is finished early, or material is returned after the last output, closing books the remainder to 6012. The order keeps `output_value` and `variance_value`, and the cost tab compares them with plan.

Account defaults (`wip`, `labor_absorbed`, `overhead_absorbed`, `production_variance`) are company account defaults, like the other posting accounts.

## Traceability

Each output writes one `lot_genealogy` row for every lot consumed on the order, with the quantity. `lot_genealogy_tree(lot, 'up')` walks down to the raw-material lots and their vendors. `lot_genealogy_tree(lot, 'down')` walks up to every lot made from it, to any depth. The lot page in the warehouse module (`/wms/lots/:id`) shows both as **Made from** and **Used in**, next to the Phase 6 recall trace. Together they let a recall of one green-coffee lot reach the customers of every 250 g pack made from it.

## Planning (`/manufacturing`)

`production_plan(company, warehouse)` lists every manufactured product with:

- free stock (on hand less reserved);
- customer demand from open sales orders;
- demand from other work orders (open sub-assembly needs);
- quantity already being made;
- min / max from replenishment rules;
- projected stock and the suggested quantity, filling up to the maximum when the projection falls below the minimum.

**Plan N** opens a new work order with the suggested quantity. Replenishment (Phase 4) now includes manufactured items: open work orders count as incoming stock, and `create_wos_from_suggestions(ids)` turns *manufacture* suggestions into work orders.

`work_center_load(company, from, to)` sets planned operation minutes against daily capacity for the next two weeks; Sundays have no capacity. `manufacturing_overview` feeds the KPIs: orders on the floor, late orders, WIP value, value produced, planned vs actual on closed orders, and variance.

The plan is not time-phased: it nets current stock against all open demand, not by week. Operations aren't tied to specific component lines for consumption, release does not reserve stock, and output is received by lot, not by serial number per unit.

## Demo (`klodian@ylli.al` / `demo1234`)

The demo is a coffee roastery in Ylli Retail. Green coffee (Brazil and Ethiopia lots from vendor V007) is roasted in 12 kg batches. The roast is packed into 1 kg and 250 g bags, and 250 g bags go into a gift set with a mug. That gives four BOM levels over three work centers: ROAST, PACK and ASSY.

The demo contains three closed orders, one of them with a 313.79 variance from scrap, plus a roast in progress, a released 1 kg pack order and a draft gift-set order with its sub-assembly order. The production plan suggests 60 bags of 250 g.
