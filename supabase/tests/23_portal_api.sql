-- =============================================================================
-- DrisPRO · B2B portal and public API (runs after 01–22)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

insert into auth.users (email, raw_user_meta_data) values ('shitja@b2b.al', '{"full_name":"Shitja B2B"}');
set role authenticated;
select t.login('zoe@platform.io');
select public.platform_create_client(jsonb_build_object('name', 'Portali Test', 'country', 'AL', 'owner_email', 'alice@alba.al', 'plan', 'pro', 'max_users', 10,
  'valid_until', (current_date + 365)::text)) as co \gset
select t.login('alice@alba.al');
select public.invite_member(:'co', 'shitja@b2b.al', array['sales_rep']);
select t.accept_invites();
select id as pcs   from public.units_of_measure where company_id = :'co' and code = 'pcs' \gset
select id as vat20 from public.tax_codes where company_id = :'co' and code = 'VAT20' \gset
select id as wh    from public.warehouses where company_id = :'co' and code = 'WH' \gset
select id as stock from public.warehouse_locations where company_id = :'co' and code = 'WH/STOCK' \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'OIL', 'name', 'Vaj ulliri', 'uom_id', :'pcs',
       'sales_price', 1000, 'sales_tax_code_id', :'vat20', 'purchase_tax_code_id', :'vat20')) as p_oil \gset
select id as oil from public.product_variants where product_id = :'p_oil' \gset
select sku as oil_sku from public.product_variants where id = :'oil' \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'SALT', 'name', 'Kripë', 'uom_id', :'pcs',
       'sales_price', 50, 'sales_tax_code_id', :'vat20', 'purchase_tax_code_id', :'vat20')) as p_salt \gset
select id as salt from public.product_variants where product_id = :'p_salt' \gset
insert into public.business_partners (company_id, code, name, is_customer, is_vendor) values (:'co', 'K1', 'Supermarket Drini', true, true) returning id as c1 \gset
insert into public.business_partners (company_id, code, name, is_customer) values (:'co', 'K2', 'Bar Tjetër', true) returning id as c2 \gset
insert into public.partner_prices (company_id, partner_id, variant_id, price) values (:'co', :'c1', :'oil', 800);
insert into public.goods_receipts (company_id, receipt_type, vendor_id, warehouse_id, currency_code) values (:'co', 'purchase', :'c1', :'wh', 'ALL') returning id as gr \gset
insert into public.goods_receipt_lines (company_id, receipt_id, variant_id, location_id, quantity, unit_price) values (:'co', :'gr', :'oil', :'stock', 30, 500);
select public.post_goods_receipt(:'gr');
insert into public.sales_invoices (company_id, partner_id, currency_code, invoice_date, due_date) values (:'co', :'c1', 'ALL', current_date - 30, current_date - 10) returning id as inv \gset
insert into public.sales_invoice_lines (company_id, invoice_id, line_no, variant_id, description, quantity, unit_price, tax_code_id) values (:'co', :'inv', 1, :'oil', 'Vaj', 1, 1000, :'vat20');
select public.post_sales_invoice(:'inv');
insert into public.sales_invoices (company_id, partner_id, currency_code) values (:'co', :'c2', 'ALL') returning id as inv2 \gset
insert into public.sales_invoice_lines (company_id, invoice_id, line_no, variant_id, description, quantity, unit_price, tax_code_id) values (:'co', :'inv2', 1, :'oil', 'Vaj', 1, 1000, :'vat20');
select public.post_sales_invoice(:'inv2');

-- ---------- portal links -------------------------------------------------------------------------
select t.login('shitja@b2b.al');
select t.throws(format($q$select public.portal_link_create(%L)$q$, :'c1'), 'sales.approve', 'a sales rep cannot open portal links');
select t.login('alice@alba.al');
select public.portal_link_create(:'c1', '{"label":"Zyra e Drinit"}') ->> 'key' as k1 \gset
select public.portal_link_create(:'c1', '{"pin":"4321","can_order":false}') ->> 'key' as k2 \gset
select t.throws(format($q$select public.portal_link_create(%L, '{"pin":"12"}')$q$, :'c1'), '4 to 8 digits', 'a PIN is 4 to 8 digits');
reset role;
select t.ok(not exists (select 1 from public.portal_links where key_hash = :'k1'), 'only a hash of the link is kept');

set role anon;
select set_config('request.jwt.claim.sub', '', false);
select public.portal_home(:'k1') as home \gset
select t.ok((:'home'::jsonb -> 'customer' ->> 'name') = 'Supermarket Drini', 'the link opens the customer''s portal without an account');
select t.ok((:'home'::jsonb ->> 'owed')::numeric = 1200 and (:'home'::jsonb ->> 'overdue')::numeric = 1200, 'with what they owe and what is overdue');
select t.ok(jsonb_array_length(:'home'::jsonb -> 'invoices') = 1, 'and only their own invoices');
select t.ok((public.portal_home('b2b_nothing') ->> 'error') = 'closed', 'a made-up link opens nothing');
select public.portal_catalog(:'k1') as cat \gset
select t.ok((select (i ->> 'price')::numeric = 800 and i ->> 'stock' = 'in' from jsonb_array_elements(:'cat'::jsonb -> 'items') i where i ->> 'id' = :'oil'),
  'the catalogue shows their own price and whether it is in stock');
select t.ok((select i ->> 'stock' = 'out' and (i ->> 'gross')::numeric = 60 from jsonb_array_elements(:'cat'::jsonb -> 'items') i where i ->> 'id' = :'salt'),
  'out of stock, and the price with VAT');
select t.ok((public.portal_catalog(:'k1', null, 'kri') -> 'items' -> 0 ->> 'id') = :'salt', 'search works');

-- the PIN
select t.ok((public.portal_home(:'k2') ->> 'error') = 'pin', 'a link with a PIN asks for it');
select t.ok((public.portal_home(:'k2', '0000') ->> 'error') = 'wrong_pin', 'a wrong PIN is refused');
select t.ok((public.portal_home(:'k2', '4321') -> 'customer' ->> 'name') = 'Supermarket Drini', 'the right one opens');
select public.portal_home(:'k2', '0000') a, public.portal_home(:'k2', '0001') b, public.portal_home(:'k2', '0002') c, public.portal_home(:'k2', '0003') d \gset x_
select t.ok((public.portal_home(:'k2', '0004') ->> 'error') = 'locked', 'five wrong PINs lock the link');
select t.ok((public.portal_home(:'k2', '4321') ->> 'error') = 'locked', 'even for the right PIN, for 15 minutes');

-- an order
select gen_random_uuid() as o1 \gset
select public.portal_order(:'k1', null, jsonb_build_object('id', :'o1', 'note', 'Para drekës',
  'lines', jsonb_build_array(jsonb_build_object('variant_id', :'oil', 'quantity', 3)))) as r1 \gset
select t.ok((:'r1'::jsonb ->> 'status') = 'draft', 'a portal order waits for the sales team to confirm it');
select t.ok((:'r1'::jsonb ->> 'total')::numeric = 2880, 'at the customer''s price with VAT');
select public.portal_order(:'k1', null, jsonb_build_object('id', :'o1', 'lines', jsonb_build_array(jsonb_build_object('variant_id', :'oil', 'quantity', 3)))) as r1b \gset
select t.ok((:'r1b'::jsonb ->> 'replay')::boolean, 'sent twice it is one order');
select t.throws(format($q$select public.portal_order(%L, null, jsonb_build_object('id', gen_random_uuid(), 'lines', jsonb_build_array(jsonb_build_object('variant_id', %L, 'quantity', -1))))$q$, :'k1', :'oil'),
  'more than zero', 'no negative quantities');
select t.ok((public.portal_document(:'k1', null, 'order', :'o1') -> 'lines' -> 0 ->> 'quantity')::numeric = 3, 'they see the order they sent');
select t.throws(format($q$select public.portal_document(%L, null, 'invoice', %L)$q$, :'k1', :'inv2'), 'not found', 'but never another customer''s invoice');
reset role;
select t.ok((select channel = 'b2b' and created_by = (select id from auth.users where email = 'alice@alba.al') from public.sales_orders where id = :'o1'),
  'marked as from the portal, made in the name of who opened the link');
select t.ok(exists (select 1 from public.notifications n join auth.users u on u.id = n.user_id where u.email = 'shitja@b2b.al' and n.title like 'Order from the B2B portal%'),
  'the sales team is told');

-- the manager closes the link
set role authenticated;
select t.login('alice@alba.al');
select id as l1 from public.portal_links where partner_id = :'c1' and label = 'Zyra e Drinit' \gset
select public.portal_link_set(:'l1', '{"is_active":false}');
set role anon;
select set_config('request.jwt.claim.sub', '', false);
select t.ok((public.portal_home(:'k1') ->> 'error') = 'closed', 'a switched-off link opens nothing');

-- ---------- API --------------------------------------------------------------------------------
set role authenticated;
select t.login('shitja@b2b.al');
select t.throws(format($q$select public.api_key_create(%L, 'Web', array['catalog.read'])$q$, :'co'), 'admin.write', 'only an administrator makes API keys');
select t.login('alice@alba.al');
select public.api_key_create(:'co', 'Dyqani online', array['catalog.read','orders.write','orders.read']) ->> 'key' as ak \gset
select public.api_key_create(:'co', 'Vetëm katalog', array['catalog.read']) ->> 'key' as ak2 \gset

set role anon;
select set_config('request.jwt.claim.sub', '', false);
select t.throws($$ select public.api_products('nxa_wrong') $$, 'Unknown or switched-off API key', 'a wrong key is refused');
select public.api_products(:'ak') as prods \gset
select t.ok(jsonb_array_length(:'prods'::jsonb -> 'data') = 2, 'the products of the key''s company');
select t.ok((public.api_products(:'ak', null, null, 1) ->> 'next') is not null, 'paged');
select t.ok((public.api_stock(:'ak', array[:'oil_sku']) -> 'data' -> 0 ->> 'available')::numeric = 30, 'stock per warehouse');
select t.ok((public.api_prices(:'ak', 'K1', array[:'oil_sku']) -> 'data' -> 0 ->> 'price')::numeric = 800, 'a customer''s price');
select t.throws(format($q$select public.api_partners(%L)$q$, :'ak'), 'may not partners.read', 'a key only does what it was given');
select public.api_order_create(:'ak', jsonb_build_object('external_id', 'WEB-1001', 'partner_code', 'K2', 'confirm', true,
  'lines', jsonb_build_array(jsonb_build_object('sku', :'oil_sku', 'quantity', 2)))) as ao \gset
select t.ok((:'ao'::jsonb ->> 'status') = 'confirmed' and (:'ao'::jsonb ->> 'total')::numeric = 2400, 'an order from the web shop, confirmed at the company''s price');
select t.ok((public.api_order_create(:'ak', jsonb_build_object('external_id', 'WEB-1001', 'partner_code', 'K2',
  'lines', jsonb_build_array(jsonb_build_object('sku', :'oil_sku', 'quantity', 2)))) ->> 'replay')::boolean, 'the same external id never makes a second order');
select t.ok((public.api_order_get(:'ak', null, 'WEB-1001') ->> 'number') = (:'ao'::jsonb ->> 'number'), 'and its status can be read back');
select t.throws(format($q$select public.api_order_create(%L, jsonb_build_object('partner_code', 'K2', 'lines', jsonb_build_array(jsonb_build_object('sku', %L, 'quantity', 1))))$q$, :'ak2', :'oil_sku'),
  'may not orders.write', 'a catalogue key cannot order');
reset role;
update public.api_keys set window_calls = 120, window_start = now() where key_hash = encode(extensions.digest(:'ak2', 'sha256'), 'hex');
set role anon;
select set_config('request.jwt.claim.sub', '', false);
select t.throws(format($q$select public.api_products(%L)$q$, :'ak2'), 'Too many calls', 'at most 120 calls a minute');

reset role;
select set_config('request.jwt.claim.sub', '', false);
select t.ok((select channel = 'api' and customer_reference = 'WEB-1001' from public.sales_orders where id = (:'ao'::jsonb ->> 'id')::uuid), 'marked as from the API');
\set QUIET off
select count(*) as assertions_passed from t.results;
