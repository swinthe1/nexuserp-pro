-- =============================================================================
-- DrisPRO · Phase 3 CRM & sales tests (runs after 01 and 02)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

insert into auth.users (email, raw_user_meta_data) values
  ('sam@shop.al',   '{"full_name":"Sam Sales Rep"}'),
  ('mia@shop.al',   '{"full_name":"Mia Sales Manager"}'),
  ('otto@shop.al',  '{"full_name":"Otto Warehouse"}'),
  ('fiona@shop.al', '{"full_name":"Fiona Accountant"}');

set role authenticated;
select t.login('alice@alba.al');
select public.create_company('Shitje Test', 'AL') as co \gset
select public.invite_member(:'co', 'sam@shop.al',   array['sales_rep']);
select public.invite_member(:'co', 'mia@shop.al',   array['sales_manager']);
select public.invite_member(:'co', 'otto@shop.al',  array['warehouse_operator']);
select public.invite_member(:'co', 'fiona@shop.al', array['accountant']);

select id as pcs   from public.units_of_measure where company_id = :'co' and code = 'pcs' \gset
select id as vat20 from public.tax_codes where company_id = :'co' and code = 'VAT20' \gset
select id as wh    from public.warehouses where company_id = :'co' and code = 'WH' \gset
select id as stock from public.warehouse_locations where company_id = :'co' and code = 'WH/STOCK' \gset
select id as net30 from public.payment_terms where company_id = :'co' and code = 'NET30' \gset

select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'SHIRT', 'name', 'Linen shirt', 'uom_id', :'pcs', 'sales_price', 2000, 'sales_tax_code_id', :'vat20')) as p_shirt \gset
select id as shirt from public.product_variants where product_id = :'p_shirt' \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'FIT', 'name', 'Tailoring service', 'uom_id', :'pcs', 'product_type', 'service', 'sales_price', 5000, 'sales_tax_code_id', :'vat20')) as p_fit \gset
select id as fit from public.product_variants where product_id = :'p_fit' \gset

insert into public.stock_adjustments (company_id, warehouse_id, reason) values (:'co', :'wh', 'opening') returning id as op \gset
insert into public.stock_adjustment_lines (company_id, adjustment_id, variant_id, location_id, quantity_change, unit_cost) values (:'co', :'op', :'shirt', :'stock', 10, 800);
select public.post_stock_adjustment(:'op');

-- ---------- pricing -------------------------------------------------------------
insert into public.price_lists (company_id, name, currency_code, is_default) values (:'co', 'Retail', 'ALL', true) returning id as retail \gset
insert into public.price_lists (company_id, name, currency_code) values (:'co', 'Wholesale', 'ALL') returning id as wholesale \gset
insert into public.price_list_items (company_id, price_list_id, variant_id, min_quantity, price) values
  (:'co', :'retail', :'shirt', 1, 1900), (:'co', :'wholesale', :'shirt', 1, 1500), (:'co', :'wholesale', :'shirt', 10, 1400);
insert into public.business_partners (company_id, code, name, is_customer, price_list_id, default_discount_pct, payment_term_id)
values (:'co', 'C-A', 'Boutique Ana', true, :'wholesale', 5, :'net30') returning id as cust_a \gset
insert into public.business_partners (company_id, code, name, is_customer) values (:'co', 'C-B', 'Walk-in Bora', true) returning id as cust_b \gset
insert into public.business_partners (company_id, code, name, is_customer) values (:'co', 'C-C', 'Hotel Cela', true) returning id as cust_c \gset
insert into public.partner_prices (company_id, partner_id, variant_id, price) values (:'co', :'cust_c', :'shirt', 1300);

select t.ok((select (unit_price, discount_pct, source) = (1900, 0, 'price_list') from public.get_price(:'co', :'cust_b', :'shirt', 1)), 'default price list applies to customers without one');
select t.ok((select (unit_price, discount_pct, source) = (1500, 5, 'price_list') from public.get_price(:'co', :'cust_a', :'shirt', 5)), 'customer price list + customer default discount');
select t.ok((select unit_price from public.get_price(:'co', :'cust_a', :'shirt', 12)) = 1400, 'quantity break picks the best matching tier');
select t.ok((select (unit_price, source) = (1300, 'customer_price') from public.get_price(:'co', :'cust_c', :'shirt', 1)), 'customer-specific price wins over lists');
select t.ok((select (unit_price, source) = (5000, 'base_price') from public.get_price(:'co', :'cust_b', :'fit', 1)), 'falls back to the product price');
select t.ok(public.next_partner_code(:'co', 'customer') = 'C00001', 'customer codes are generated');

-- ---------- leads & pipeline -------------------------------------------------------
select t.login('sam@shop.al');
insert into public.leads (company_id, title, contact_name, company_name, email, source, estimated_value)
values (:'co', 'Uniforms for Hotel Dajti', 'Erion Leka', 'Hotel Dajti sh.p.k.', 'erion@dajti.al', 'referral', 250000) returning id as lead, number as lead_no \gset
select t.ok(:'lead_no' = 'KON-2026-00001', 'leads are numbered');
select public.convert_lead(:'lead') as conv \gset
select (:'conv'::jsonb ->> 'opportunity_id') as opp, (:'conv'::jsonb ->> 'partner_id') as dajti \gset
select t.ok((select status from public.leads where id = :'lead') = 'converted', 'lead converted');
select t.ok((select (name, is_customer) = ('Hotel Dajti sh.p.k.', true) from public.business_partners where id = :'dajti'), 'conversion created the customer');
select t.ok((select (status, expected_value, probability) = ('open', 250000.00, 10.00) from public.opportunities where id = :'opp'), 'opportunity opens in the first stage');
select t.throws(format($q$select public.convert_lead(%L)$q$, :'lead'), 'only open leads', 'a lead converts once');

select id as st_won from public.crm_pipeline_stages where company_id = :'co' and is_won \gset
select id as st_new from public.crm_pipeline_stages where company_id = :'co' and name = 'New' \gset
select id as st_lost from public.crm_pipeline_stages where company_id = :'co' and is_lost \gset
insert into public.opportunities (company_id, name, partner_id, stage_id, expected_value, currency_code)
values (:'co', 'Spring collection', :'cust_b', :'st_new', 40000, 'ALL') returning id as opp2 \gset
update public.opportunities set stage_id = :'st_lost', lost_reason = 'Budget' where id = :'opp2';
select t.ok((select (status, probability) = ('lost', 0.00) from public.opportunities where id = :'opp2'), 'moving to a lost stage closes the opportunity');
update public.opportunities set stage_id = :'st_new' where id = :'opp2';
select t.ok((select status from public.opportunities where id = :'opp2') = 'open', 'lost opportunities can be reopened');
update public.opportunities set stage_id = :'st_won' where id = :'opp2';
select t.throws(format($q$update public.opportunities set stage_id = %L where id = %L$q$, :'st_new', :'opp2'), 'invalid status transition', 'won opportunities stay won');

-- ---------- quote → order ------------------------------------------------------------
insert into public.sales_quotes (company_id, partner_id, opportunity_id, currency_code, payment_term_id, valid_until)
values (:'co', :'cust_a', :'opp', 'ALL', :'net30', current_date + 14) returning id as q, number as q_no \gset
insert into public.sales_quote_lines (company_id, quote_id, line_no, variant_id, description, quantity, unit_price, discount_pct, tax_code_id) values
  (:'co', :'q', 1, :'shirt', 'Linen shirt', 12, 1400, 5, :'vat20'),
  (:'co', :'q', 2, :'fit',   'Tailoring',   1, 5000, 0, :'vat20');
select t.ok((select (subtotal, tax_total, total) = (20960.00, 4192.00, 25152.00) from public.sales_quotes where id = :'q'),
            'quote totals: 12×1400 −5% + 5000, VAT 20%');
select t.throws(format($q$select public.convert_quote_to_order(%L)$q$, :'q'), 'only sent or accepted', 'draft quotes cannot become orders');
update public.sales_quotes set status = 'sent' where id = :'q';
select public.convert_quote_to_order(:'q') as so \gset
select t.ok((select status from public.sales_quotes where id = :'q') = 'converted', 'quote marked converted');
select t.ok((select status from public.opportunities where id = :'opp') = 'won', 'winning the quote wins the opportunity');
select t.ok((select (count(*), sum(line_total)) = (2::bigint, 25152.00) from public.sales_order_lines where sales_order_id = :'so'), 'order copies the quote lines');
select t.ok((select number from public.sales_orders where id = :'so') like 'PSH-2026-%', 'orders are numbered');

-- ---------- confirmation checks ---------------------------------------------------------
select t.throws(format($q$update public.business_partners set credit_limit = 99999999 where id = %L$q$, :'cust_a'), 'sales manager', 'a sales rep cannot raise a credit limit');
select t.login('mia@shop.al');
update public.business_partners set credit_limit = 10000 where id = :'cust_a';
select t.login('sam@shop.al');
select t.throws(format($q$select public.confirm_sales_order(%L)$q$, :'so'), 'credit limit exceeded', 'credit limit blocks a sales rep');
select t.ok((select status from public.sales_orders where id = :'so') = 'draft', 'blocked order stays draft');

insert into public.sales_orders (company_id, partner_id, warehouse_id, currency_code) values (:'co', :'cust_b', :'wh', 'ALL') returning id as so_disc \gset
insert into public.sales_order_lines (company_id, sales_order_id, line_no, variant_id, description, quantity, unit_price, discount_pct, tax_code_id)
values (:'co', :'so_disc', 1, :'shirt', 'Shirt', 1, 1900, 20, :'vat20');
select t.throws(format($q$select public.confirm_sales_order(%L)$q$, :'so_disc'), 'exceeds the 15', 'discount above the cap needs a manager');

select t.login('mia@shop.al');
select t.ok(public.confirm_sales_order(:'so') = 'confirmed', 'sales manager confirms despite the credit limit');
select t.ok((select (qty_reserved) from public.sales_order_lines where sales_order_id = :'so' and line_no = 1) = 10, 'confirmation reserved the 10 in stock');
select t.ok((select (to_reserve, available) = (2.0000, 0.0000) from public.sales_order_availability(:'so') where sku = 'SHIRT'), 'remaining 2 are backordered');
select t.ok((select sum(reserved) from public.stock_levels where variant_id = :'shirt') = 10, 'stock levels show the reservation');

-- ---------- permissions -------------------------------------------------------------------
select t.login('sam@shop.al');
select t.throws(format($q$select public.create_invoice_from_order(%L)$q$, :'so'), 'permission denied', 'sales reps cannot invoice');
select t.throws(format($q$select public.post_delivery(%L)$q$, gen_random_uuid()), 'not found', 'unknown delivery');

-- ---------- deliveries ---------------------------------------------------------------------
select t.login('otto@shop.al');
select public.create_delivery_from_order(:'so') as d1 \gset
select t.ok((select sum(quantity) from public.delivery_lines where delivery_id = :'d1') = 10, 'delivery picks the reserved quantity');
select t.ok((select number from public.deliveries where id = :'d1') like 'FD-2026-%', 'deliveries are numbered');
select public.post_delivery(:'d1');
select t.ok((select (status, total_cost) = ('done', 8000.00) from public.deliveries where id = :'d1'), 'delivery posted at average cost (COGS 10 × 800)');
select t.ok((select status from public.sales_orders where id = :'so') = 'partially_delivered', 'order partially delivered');
select t.ok((select sum(reserved) from public.stock_levels where variant_id = :'shirt') = 0, 'reservation consumed by the delivery');
select t.ok((select qty_on_hand from public.item_costs where variant_id = :'shirt') = 0, 'stock left the warehouse');
select t.throws(format($q$select public.post_delivery(%L)$q$, :'d1'), 'already done', 'deliveries post once');

reset role;
insert into public.goods_receipts (company_id, warehouse_id) values (:'co', :'wh') returning id as gr \gset
insert into public.goods_receipt_lines (company_id, receipt_id, variant_id, location_id, quantity, unit_cost) values (:'co', :'gr', :'shirt', :'stock', 5, 900);
set role authenticated;
select t.login('alice@alba.al');
select public.post_goods_receipt(:'gr');
select t.login('mia@shop.al');
select t.ok(public.reserve_sales_order(:'so') = 2, 'backorder reserved once stock arrives');
select t.login('otto@shop.al');
select public.create_delivery_from_order(:'so') as d2 \gset
select public.post_delivery(:'d2');
select t.ok((select total_cost from public.deliveries where id = :'d2') = 1800.00, 'second delivery costed at the new average (2 × 900)');
select t.ok((select status from public.sales_orders where id = :'so') = 'delivered', 'order fully delivered');
select t.throws(format($q$select public.create_delivery_from_order(%L)$q$, :'so'), 'delivered', 'nothing left to deliver');

-- ---------- invoicing -----------------------------------------------------------------------
select t.login('fiona@shop.al');
select public.create_invoice_from_order(:'so') as inv \gset
select t.ok((select (count(*), sum(quantity)) = (2::bigint, 13.0000) from public.sales_invoice_lines where invoice_id = :'inv'), 'invoice covers delivered goods + the service');
select t.ok((select (due_date - invoice_date) from public.sales_invoices where id = :'inv') = 30, 'due date from payment terms (NET30)');
select public.post_sales_invoice(:'inv');
select t.ok((select (status, fiscal_status, total) = ('posted', 'pending', 25152.00) from public.sales_invoices where id = :'inv'), 'invoice posted and queued for fiscalization');
select t.ok(exists (select 1 from public.fiscalization_records where source_doc_id = :'inv' and status = 'pending' and country_code = 'AL'), 'fiscalization record created');
select t.ok((select (status, invoice_status) = ('closed', 'invoiced') from public.sales_orders where id = :'so'), 'delivered + invoiced order closes itself');
select t.throws(format($q$select public.create_invoice_from_order(%L)$q$, :'so'), 'Nothing to invoice', 'a closed order with everything invoiced has nothing more to invoice');

select public.create_credit_note(:'inv') as cn \gset
select t.ok((select number from public.sales_invoices where id = :'cn') like 'NK-2026-%', 'credit notes have their own series');
update public.sales_invoice_lines set quantity = 2 where invoice_id = :'cn' and line_no = 1;
delete from public.sales_invoice_lines where invoice_id = :'cn' and line_no = 2;
select public.post_sales_invoice(:'cn');
select t.ok((select qty_invoiced from public.sales_order_lines where sales_order_id = :'so' and line_no = 1) = 10, 'credit note reduces invoiced quantity');
select public.create_credit_note(:'inv') as cn2 \gset
select t.throws(format($q$select public.post_sales_invoice(%L)$q$, :'cn2'), 'exceed the original', 'cannot credit more than was invoiced');

-- ---------- cancellation releases stock --------------------------------------------------
select t.login('mia@shop.al');
insert into public.sales_orders (company_id, partner_id, warehouse_id, currency_code) values (:'co', :'cust_b', :'wh', 'ALL') returning id as so3 \gset
insert into public.sales_order_lines (company_id, sales_order_id, line_no, variant_id, description, quantity, unit_price, tax_code_id)
values (:'co', :'so3', 1, :'shirt', 'Shirt', 2, 1900, :'vat20');
select public.confirm_sales_order(:'so3');
select t.ok((select sum(reserved) from public.stock_levels where variant_id = :'shirt') = 2, 'second order reserved 2');
update public.sales_orders set status = 'cancelled', cancel_reason = 'Customer changed mind' where id = :'so3';
select t.ok((select sum(reserved) from public.stock_levels where variant_id = :'shirt') = 0, 'cancelling releases the reservation');
select t.throws(format($q$update public.sales_order_lines set quantity = 5 where sales_order_id = %L$q$, :'so3'), 'cannot be modified', 'cancelled order lines are frozen');

-- ---------- performance ----------------------------------------------------------------------
select public.sales_overview(:'co', current_date - 30, current_date) as ov \gset
select t.ok((:'ov'::jsonb ->> 'revenue')::numeric = 20960 - 2 * 1330, 'revenue = invoices − credit notes (net of VAT)');
select t.ok((:'ov'::jsonb ->> 'cogs')::numeric = 9800, 'COGS from posted deliveries');
select t.ok((:'ov'::jsonb ->> 'won')::int = 2 and (:'ov'::jsonb ->> 'quotes_converted')::int = 1, 'win and conversion counts');
select t.ok(jsonb_array_length(:'ov'::jsonb -> 'revenue_by_month') = 12, '12-month revenue trend');
reset role;

-- quantity conservation still holds after deliveries
select t.ok(not exists (
  select 1 from public.item_costs ic where ic.company_id = :'co'
     and ic.qty_on_hand <> coalesce((select sum(on_hand) from public.stock_levels sl where sl.variant_id = ic.variant_id), 0)),
  'quantity conservation after sales deliveries');

\set QUIET off
select count(*) as assertions_passed from t.results;
