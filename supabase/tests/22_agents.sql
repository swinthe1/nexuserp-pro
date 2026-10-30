-- =============================================================================
-- DrisPRO · field sales agents (runs after 01–21)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

insert into auth.users (email, raw_user_meta_data) values
  ('agim@agent.al', '{"full_name":"Agim Agjenti"}'),
  ('besa@agent.al', '{"full_name":"Besa Shitje"}'),
  ('drita@agent.al', '{"full_name":"Drita Menaxhere"}');
select id as agim from auth.users where email = 'agim@agent.al' \gset
select id as besa from auth.users where email = 'besa@agent.al' \gset
select id as drita from auth.users where email = 'drita@agent.al' \gset

set role authenticated;
select t.login('zoe@platform.io');
select public.platform_create_client(jsonb_build_object('name', 'Agjentët Test', 'country', 'AL', 'owner_email', 'alice@alba.al', 'plan', 'pro', 'max_users', 10,
  'valid_until', (current_date + 365)::text)) as co \gset
select t.login('alice@alba.al');
select public.invite_member(:'co', 'agim@agent.al', array['sales_rep']);
select t.accept_invites();
select public.invite_member(:'co', 'besa@agent.al', array['sales_rep']);
select t.accept_invites();
select public.invite_member(:'co', 'drita@agent.al', array['sales_manager']);
select t.accept_invites();
select id as pcs   from public.units_of_measure where company_id = :'co' and code = 'pcs' \gset
select id as vat20 from public.tax_codes where company_id = :'co' and code = 'VAT20' \gset
select id as wh    from public.warehouses where company_id = :'co' and code = 'WH' \gset
select id as stock from public.warehouse_locations where company_id = :'co' and code = 'WH/STOCK' \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'MILK', 'name', 'Qumësht', 'uom_id', :'pcs',
       'sales_price', 100, 'sales_tax_code_id', :'vat20', 'purchase_tax_code_id', :'vat20')) as p_milk \gset
select id as milk from public.product_variants where product_id = :'p_milk' \gset
insert into public.business_partners (company_id, code, name, is_customer, is_vendor) values (:'co', 'M1', 'Market Lumi', true, true) returning id as c1 \gset
insert into public.business_partners (company_id, code, name, is_customer) values (:'co', 'M2', 'Bar Kalaja', true) returning id as c2 \gset
insert into public.business_partners (company_id, code, name, is_customer) values (:'co', 'M3', 'Dyqani Larg', true) returning id as c3 \gset
insert into public.partner_addresses (company_id, partner_id, line1, city, is_default) values (:'co', :'c1', 'Rr. Kavajës 10', 'Tiranë', true);
insert into public.partner_prices (company_id, partner_id, variant_id, price) values (:'co', :'c1', :'milk', 90);
insert into public.goods_receipts (company_id, receipt_type, vendor_id, warehouse_id, currency_code) values (:'co', 'purchase', :'c1', :'wh', 'ALL') returning id as gr \gset
insert into public.goods_receipt_lines (company_id, receipt_id, variant_id, location_id, quantity, unit_price) values (:'co', :'gr', :'milk', :'stock', 100, 50);
select public.post_goods_receipt(:'gr');
-- an open invoice of Market Lumi from before
insert into public.sales_invoices (company_id, partner_id, currency_code, invoice_date, due_date) values (:'co', :'c1', 'ALL', current_date - 20, current_date - 5) returning id as old1 \gset
insert into public.sales_invoice_lines (company_id, invoice_id, line_no, variant_id, description, quantity, unit_price, tax_code_id) values (:'co', :'old1', 1, :'milk', 'Qumësht', 10, 100, :'vat20');
select public.post_sales_invoice(:'old1');
insert into public.sales_invoices (company_id, partner_id, currency_code, invoice_date, due_date) values (:'co', :'c1', 'ALL', current_date - 3, current_date + 10) returning id as old2 \gset
insert into public.sales_invoice_lines (company_id, invoice_id, line_no, variant_id, description, quantity, unit_price, tax_code_id) values (:'co', :'old2', 1, :'milk', 'Qumësht', 5, 100, :'vat20');
select public.post_sales_invoice(:'old2');
insert into public.payments (company_id, document_type, partner_id, method, amount, currency_code, bank_account_id)
values (:'co', 'customer_payment', :'c3', 'bank_transfer', 5, 'ALL', (select id from public.bank_accounts where company_id = :'co' and account_kind = 'bank' limit 1)) returning id as draft_pay \gset

-- ---------- setup ----------------------------------------------------------------------------------
select t.login('agim@agent.al');
select t.throws(format($q$select public.agent_bootstrap(%L)$q$, :'co'), 'not set up as a field agent', 'a sales rep is not an agent until set up');
select t.throws(format($q$select public.agents_list(%L)$q$, :'co'), 'sales.approve', 'and cannot set agents up');
select t.ok(not public.am_i_agent(:'co'), 'the menu knows it');

select t.login('drita@agent.al');
select t.throws(format($q$select public.agent_save(jsonb_build_object('company_id', %L, 'user_id', %L, 'warehouse_id', %L, 'safe_id', 'new'))$q$, :'co', :'agim', :'wh'),
  'Only finance can open', 'a sales manager cannot open a cash bag (finance does)');
select t.login('alice@alba.al');
select public.agent_save(jsonb_build_object('company_id', :'co', 'user_id', :'agim', 'warehouse_id', :'wh', 'safe_id', 'new')) as ag \gset
select safe_id as bag from public.sales_agents where id = :'ag' \gset
select t.ok((select holder_id = :'agim' and name like 'Agent · %' from public.safes where id = :'bag'), 'the admin opens the agent with a cash bag they hold');
select t.login('drita@agent.al');
select public.agent_save(jsonb_build_object('company_id', :'co', 'user_id', :'besa', 'warehouse_id', :'wh')) as ag2 \gset
select t.ok(jsonb_array_length(public.agents_list(:'co') -> 'agents') = 2, 'the manager sees both agents');
select public.agent_route_save(:'ag', extract(isodow from current_date)::int, array[:'c2', :'c1']::uuid[]);
select t.ok((select salesperson_id = :'agim' from public.business_partners where id = :'c1'), 'customers on the route become the agent''s');
select t.ok((select string_agg(bp.code, ',' order by r.position) from public.agent_route_stops r join public.business_partners bp on bp.id = r.partner_id where r.agent_id = :'ag') = 'M2,M1',
  'in the order given');

-- ---------- the phone's day ------------------------------------------------------------------------
select t.login('agim@agent.al');
select t.ok(public.am_i_agent(:'co'), 'now he is an agent');
select public.agent_bootstrap(:'co') as boot \gset
select t.ok(jsonb_array_length(:'boot'::jsonb -> 'customers') = 2, 'the phone gets the agent''s customers, not the others');
select t.ok((select (c -> 'open') -> 0 ->> 'id' = :'old1' from jsonb_array_elements(:'boot'::jsonb -> 'customers') c where c ->> 'id' = :'c1'),
  'with their open invoices, oldest due first');
select t.ok((select (i ->> 5)::numeric = 100 from jsonb_array_elements(:'boot'::jsonb -> 'items') i where i ->> 0 = :'milk'), 'and the stock in his warehouse');
select t.ok(jsonb_array_length(:'boot'::jsonb -> 'partner_prices') = 1, 'and the customer prices');

-- ---------- an order -------------------------------------------------------------------------------
select gen_random_uuid() as o1 \gset
select public.agent_order_submit(jsonb_build_object('id', :'o1', 'company_id', :'co', 'partner_id', :'c1', 'lat', 41.3275, 'lng', 19.8187, 'accuracy', 12,
  'set_location', true, 'lines', jsonb_build_array(jsonb_build_object('variant_id', :'milk', 'quantity', 4)))) as r1 \gset
select t.ok((:'r1'::jsonb ->> 'status') = 'confirmed', 'the order is confirmed at once');
select t.ok((select unit_price from public.sales_order_lines where sales_order_id = :'o1') = 90, 'at the customer''s price (the company''s, not the phone''s)');
select t.ok((select channel = 'agent' and salesperson_id = :'agim' from public.sales_orders where id = :'o1'), 'marked as the agent''s');
select public.agent_order_submit(jsonb_build_object('id', :'o1', 'company_id', :'co', 'partner_id', :'c1',
  'lines', jsonb_build_array(jsonb_build_object('variant_id', :'milk', 'quantity', 4)))) as r1b \gset
select t.ok((:'r1b'::jsonb ->> 'replay')::boolean and (select count(*) from public.sales_orders where partner_id = :'c1' and channel = 'agent') = 1,
  'sent again (weak signal) it is not doubled');
select t.ok((select latitude = 41.3275 from public.partner_addresses where partner_id = :'c1'), 'the good GPS fix becomes the customer''s location');
select t.ok((select outcome = 'order' and sales_order_id = :'o1' from public.agent_visits where partner_id = :'c1'), 'and it counts as a visit');

select t.throws(format($q$select public.agent_order_submit(jsonb_build_object('id', gen_random_uuid(), 'company_id', %L, 'partner_id', %L,
  'lines', jsonb_build_array(jsonb_build_object('variant_id', %L, 'quantity', 1))))$q$, :'co', :'c3', :'milk'), 'not on your list', 'not for customers of others');
select t.throws(format($q$select public.agent_order_submit(jsonb_build_object('id', gen_random_uuid(), 'company_id', %L, 'partner_id', %L,
  'at', (now() - interval '9 days')::text, 'lines', jsonb_build_array(jsonb_build_object('variant_id', %L, 'quantity', 1))))$q$, :'co', :'c1', :'milk'),
  'more than a week ago', 'nor something kept on the phone for too long');

-- a big discount waits for the manager as a draft
select gen_random_uuid() as o2 \gset
select public.agent_order_submit(jsonb_build_object('id', :'o2', 'company_id', :'co', 'partner_id', :'c2',
  'lines', jsonb_build_array(jsonb_build_object('variant_id', :'milk', 'quantity', 2, 'discount_pct', 60)))) as r2 \gset
select t.ok((:'r2'::jsonb ->> 'status') = 'draft' and (:'r2'::jsonb ->> 'held') like '%discount%', 'a discount over the limit keeps the order for the manager');

-- ---------- collecting cash ------------------------------------------------------------------------
select amount_due as due1 from public.sales_invoices where id = :'old1' \gset
select gen_random_uuid() as pay1 \gset
select public.agent_payment_submit(jsonb_build_object('id', :'pay1', 'company_id', :'co', 'partner_id', :'c1', 'amount', :'due1'::numeric + 100)) as p1 \gset
select t.ok((:'p1'::jsonb ->> 'status') = 'posted', 'a sales rep agent posts the cash he collected');
select t.ok((select payment_status from public.sales_invoices where id = :'old1') = 'paid', 'it pays the oldest invoice first');
select t.ok((select amount_paid from public.sales_invoices where id = :'old2') = 100, 'and the rest goes to the next');
select t.ok(app.safe_balance(:'bag') = :'due1'::numeric + 100, 'the money is in his bag');
select public.agent_payment_submit(jsonb_build_object('id', :'pay1', 'company_id', :'co', 'partner_id', :'c1', 'amount', 1)) as p1b \gset
select t.ok((:'p1b'::jsonb ->> 'replay')::boolean and app.safe_balance(:'bag') = :'due1'::numeric + 100, 'sent twice, collected once');
select t.throws(format($q$select public.post_payment(%L)$q$, :'draft_pay'), 'invoicing.write',
  'he still cannot post other payments');
select t.throws(format($q$insert into public.payments (company_id, document_type, partner_id, method, amount, currency_code, bank_account_id) values (%L, 'customer_payment', %L, 'cash', 5, 'ALL', %L)$q$,
  :'co', :'c1', (select bank_account_id from public.safes where id = :'bag')), '', 'nor write payments himself');

-- ---------- a visit without an order ----------------------------------------------------------------
select gen_random_uuid() as v1 \gset
select public.agent_visit_log(jsonb_build_object('id', :'v1', 'company_id', :'co', 'partner_id', :'c2', 'outcome', 'closed', 'note', 'Mbyllur', 'lat', 41.33, 'lng', 19.82));
select public.agent_visit_log(jsonb_build_object('id', :'v1', 'company_id', :'co', 'partner_id', :'c2', 'outcome', 'closed'));
select t.ok((select count(*) from public.agent_visits where id = :'v1') = 1, 'a visit is logged once');
select t.ok(jsonb_array_length(public.agent_my_day(:'co') -> 'orders') = 2 and jsonb_array_length(public.agent_my_day(:'co') -> 'payments') = 1, 'his day: two orders, one collection');

select t.login('besa@agent.al');
select t.throws(format($q$select public.agent_payment_submit(jsonb_build_object('id', gen_random_uuid(), 'company_id', %L, 'partner_id', %L, 'amount', 10))$q$, :'co', :'c1'),
  'not on your list', 'another agent cannot collect from his customers');

-- ---------- the manager's day ----------------------------------------------------------------------
select t.login('drita@agent.al');
select t.ok(exists (select 1 from public.notifications n where n.user_id = :'drita' and n.title like 'Agent order waits%'),
  'the manager is told about the held order');
select public.agents_day(:'co') as day \gset
select t.ok((select (a ->> 'planned')::int = 2 and (a ->> 'planned_visited')::int = 2 and (a ->> 'orders')::int = 2 and (a ->> 'held')::int = 1
                    and (a ->> 'collected')::numeric = :'due1'::numeric + 100
               from jsonb_array_elements(:'day'::jsonb -> 'agents') a where a ->> 'id' = :'ag'), 'the manager sees route, orders, held and cash per agent');
select t.ok((select (v ->> 'distance_m')::numeric < 50 from jsonb_array_elements(:'day'::jsonb -> 'visits') v where v ->> 'outcome' = 'order' and v ->> 'partner_id' = :'c1'),
  'and how far from the customer each visit was');

reset role;
\set QUIET off
select count(*) as assertions_passed from t.results;
