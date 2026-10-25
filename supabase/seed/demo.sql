-- =============================================================================
-- DrisPRO · demo data
--
-- Ylli Retail sh.p.k. (Tiranë): two shops' worth of retail, a warehouse, a
-- small coffee roastery, wholesale to hotels and bars, a web shop, delivery
-- vans, 12 staff with payroll — and its sister company Ylli Kosova L.L.C.
-- The company's own data is written in Albanian; names the database creates
-- by itself (default accounts, stages, leave types…) are translated by the app.
--
-- Load it into an EMPTY database after all migrations, connected as postgres:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seed/demo.sql
--   (or: DATABASE_URL=… npm run db:seed)
-- Works on a Supabase project (creates confirmed auth users with password
-- demo1234) and on the plain-Postgres test stack (supabase/tests/00_supabase_stub.sql).
-- Dates are relative to the day you load it, except the Phase 8 months
-- (July–October 2026) of payroll, VAT and service revenue.
-- See docs/DEMO_DATA.md for the logins and what to try.
-- =============================================================================
\set ON_ERROR_STOP on
do $$ begin
  if exists (select 1 from public.companies where name = 'Ylli Retail sh.p.k.') then
    raise exception 'The demo data is already loaded in this database';
  end if;
end $$;

-- A demo user that can sign in with password demo1234. On Supabase the auth
-- tables need the hashed password, confirmation and an identity row; the
-- plain-Postgres stub only has id, email and metadata. Fills what exists.
create or replace function pg_temp.demo_user(p_email text, p_name text) returns uuid language plpgsql as $f$
declare v uuid; v_hash text;
begin
  select id into v from auth.users where email = p_email;
  if v is not null then return v; end if;
  v := gen_random_uuid();
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'encrypted_password') then
    if to_regprocedure('extensions.crypt(text,text)') is not null then
      execute 'select extensions.crypt($1, extensions.gen_salt(''bf''))' into v_hash using 'demo1234';
    else
      execute 'select crypt($1, gen_salt(''bf''))' into v_hash using 'demo1234';
    end if;
    execute $q$insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                                       created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
               values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, $3, now(),
                       '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', $4), now(), now(), '', '', '', '')$q$
      using v, p_email, v_hash, p_name;
    if to_regclass('auth.identities') is not null then
      if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'identities' and column_name = 'provider_id') then
        execute $q$insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
                   values (gen_random_uuid(), $1, $1::text, jsonb_build_object('sub', $1::text, 'email', $2, 'email_verified', true), 'email', now(), now(), now())$q$
          using v, p_email;
      else
        execute $q$insert into auth.identities (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
                   values ($1::text, $1, jsonb_build_object('sub', $1::text, 'email', $2), 'email', now(), now(), now())$q$
          using v, p_email;
      end if;
    end if;
  else
    execute 'insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, jsonb_build_object(''full_name'', $3))' using v, p_email, p_name;
  end if;
  return v;
end $f$;

select pg_temp.demo_user('arta@ylli.al', 'Arta Hoxha');
select pg_temp.demo_user('besnik@ylli.al', 'Besnik Krasniqi');
select set_config('request.jwt.claim.sub', (select id::text from auth.users where email = 'arta@ylli.al'), false);
select public.create_company('Ylli Retail sh.p.k.', 'AL', null, 'L81234567B') as co \gset
select public.invite_member(:'co', 'besnik@ylli.al', array['inventory_manager']);
select public.create_company('Ylli Kosova L.L.C.', 'XK') as co2 \gset
select public.switch_company(:'co');

select id as pcs from units_of_measure where company_id = :'co' and code = 'pcs' \gset
select id as vat20 from tax_codes where company_id = :'co' and code = 'VAT20' \gset
select id as vat6 from tax_codes where company_id = :'co' and code = 'VAT6' \gset
select id as wh from warehouses where company_id = :'co' and code = 'WH' \gset
select id as stock from warehouse_locations where company_id = :'co' and code = 'WH/STOCK' \gset
insert into warehouses (company_id, code, name, warehouse_type, city) values (:'co', 'TR1', 'Dyqani Tiranë — Blloku', 'store', 'Tiranë') returning id as st \gset
insert into warehouse_locations (company_id, warehouse_id, code, name) values (:'co', :'st', 'TR1/FLOOR', 'Salla e shitjes') returning id as floor \gset
insert into warehouse_locations (company_id, warehouse_id, code, name, is_pickable) values (:'co', :'st', 'TR1/BACK', 'Depoja e pasme', true);
insert into warehouse_locations (company_id, warehouse_id, code, name, location_type, barcode) values (:'co', :'wh', 'WH/A-01', 'Rreshti A, rafti 1', 'internal', 'LOC-A01');

insert into product_categories (company_id, name, code) values (:'co','Veshje','APP'), (:'co','Kafe','COF'), (:'co','Bulmet','DAI'), (:'co','Pije','BEV'), (:'co','Artikuj shtëpiakë','HOM');
insert into business_partners (company_id, code, name, is_vendor, tax_number, currency_code) values
  (:'co','V001','Caffè Milano S.p.A.',true,'IT08123450154','EUR'),
  (:'co','V002','Tekstil Durrës sh.p.k.',true,'K91725004L','ALL'),
  (:'co','V003','Fermat Lushnja',true,'L12345678C','ALL'),
  (:'co','V004','Ujë Glina',true,'J61812007A','ALL');
insert into business_partners (company_id, code, name, is_customer) values (:'co','C001','Hotel Rogner',true), (:'co','C002','Restorant Mullixhiu',true);

insert into product_attributes (company_id, name, sort_order) values (:'co','Madhësia',1) returning id as a_size \gset
insert into product_attributes (company_id, name, display_type, sort_order) values (:'co','Ngjyra','color',2) returning id as a_col \gset
insert into product_attribute_values (company_id, attribute_id, value, sort_order) values (:'co',:'a_size','S',1),(:'co',:'a_size','M',2),(:'co',:'a_size','L',3),(:'co',:'a_size','XL',4);
insert into product_attribute_values (company_id, attribute_id, value, color_hex, sort_order) values (:'co',:'a_col','Blu e errët','#1F2A44',1),(:'co',:'a_col','E bardhë','#F5F5F5',2);

-- products via the same RPC the UI uses
select set_config('t.co', :'co', false), set_config('t.wh', :'wh', false), set_config('t.pcs', :'pcs', false), set_config('t.vat20', :'vat20', false), set_config('t.vat6', :'vat6', false);

do $$
declare
  co uuid := current_setting('t.co')::uuid; wh uuid := current_setting('t.wh')::uuid; pcs uuid := current_setting('t.pcs')::uuid;
  vat20 uuid := current_setting('t.vat20')::uuid; vat6 uuid := current_setting('t.vat6')::uuid;
  cat_app uuid; cat_cof uuid; cat_dai uuid; cat_bev uuid; cat_hom uuid; vars jsonb := '[]'; s record; c record;
begin
  select id into cat_app from product_categories where company_id = co and code = 'APP';
  select id into cat_cof from product_categories where company_id = co and code = 'COF';
  select id into cat_dai from product_categories where company_id = co and code = 'DAI';
  select id into cat_bev from product_categories where company_id = co and code = 'BEV';
  select id into cat_hom from product_categories where company_id = co and code = 'HOM';
  for s in select v.id, v.value from product_attribute_values v join product_attributes a on a.id = v.attribute_id where a.company_id = co and a.name = 'Madhësia' order by v.sort_order loop
    for c in select v.id, v.value from product_attribute_values v join product_attributes a on a.id = v.attribute_id where a.company_id = co and a.name = 'Ngjyra' order by v.sort_order loop
      vars := vars || jsonb_build_object('sku', 'TEE-' || s.value || '-' || case c.value when 'Blu e errët' then 'NAV' else 'WHI' end, 'attribute_value_ids', jsonb_build_array(s.id, c.id), 'generate_barcode', true);
    end loop;
  end loop;
  perform public.create_product(jsonb_build_object('company_id', co, 'code', 'TEE', 'name', 'Bluzë pambuku organik', 'uom_id', pcs, 'category_id', cat_app,
    'sales_price', 1800, 'sales_tax_code_id', vat20, 'purchase_tax_code_id', vat20, 'weight_kg', 0.2, 'variants', vars,
    'reorder_rules', jsonb_build_array(jsonb_build_object('warehouse_id', wh, 'min_qty', 10, 'max_qty', 40))));
  perform public.create_product(jsonb_build_object('company_id', co, 'code', 'ESP-1KG', 'name', 'Kafe espresso kokërr Milano 1 kg', 'uom_id', pcs, 'category_id', cat_cof,
    'sales_price', 3200, 'sales_tax_code_id', vat20, 'weight_kg', 1.05, 'hs_code', '0901 21 00', 'barcodes', jsonb_build_array(jsonb_build_object('barcode', '8001234567897')),
    'reorder_rules', jsonb_build_array(jsonb_build_object('warehouse_id', wh, 'min_qty', 20, 'max_qty', 120, 'multiple_qty', 12))));
  perform public.create_product(jsonb_build_object('company_id', co, 'code', 'MILK-1L', 'name', 'Qumësht i freskët 1 L', 'uom_id', pcs, 'category_id', cat_dai, 'tracking', 'lot', 'track_expiry', true,
    'sales_price', 160, 'sales_tax_code_id', vat20, 'weight_kg', 1.03, 'generate_barcode', true,
    'reorder_rules', jsonb_build_array(jsonb_build_object('warehouse_id', wh, 'min_qty', 48, 'max_qty', 200, 'multiple_qty', 12))));
  perform public.create_product(jsonb_build_object('company_id', co, 'code', 'WATER-05', 'name', 'Ujë burimi 0,5 L', 'uom_id', pcs, 'category_id', cat_bev,
    'sales_price', 50, 'sales_tax_code_id', vat20, 'weight_kg', 0.52, 'generate_barcode', true,
    'reorder_rules', jsonb_build_array(jsonb_build_object('warehouse_id', wh, 'min_qty', 120, 'max_qty', 600, 'multiple_qty', 24))));
  perform public.create_product(jsonb_build_object('company_id', co, 'code', 'MUG-CER', 'name', 'Filxhan qeramike 350 ml', 'uom_id', pcs, 'category_id', cat_hom,
    'sales_price', 900, 'sales_tax_code_id', vat20, 'weight_kg', 0.38, 'generate_barcode', true));
  perform public.create_product(jsonb_build_object('company_id', co, 'code', 'GIFT-WRAP', 'name', 'Paketim dhurate', 'uom_id', pcs, 'product_type', 'service', 'sales_price', 200, 'sales_tax_code_id', vat20));
end $$;

-- helper: post a receipt with given date
create or replace function pg_temp.receive(p_date date, p_vendor text, p_lines jsonb, p_import boolean default false, p_cur text default 'ALL', p_rate numeric default 1, p_dud text default null)
returns uuid language plpgsql as $$
declare co uuid := current_setting('t.co')::uuid; r uuid; l jsonb; loc uuid;
begin
  insert into goods_receipts (company_id, warehouse_id, receipt_date, vendor_id, is_import, currency_code, exchange_rate, customs_declaration_number, origin_country)
  values (co, current_setting('t.wh')::uuid, p_date, (select id from business_partners where company_id = co and code = p_vendor), p_import, p_cur, p_rate, p_dud, case when p_import then 'IT' end)
  returning id into r;
  for l in select * from jsonb_array_elements(p_lines) loop
    insert into goods_receipt_lines (company_id, receipt_id, variant_id, location_id, quantity, unit_price, lot_id)
    values (co, r, (select id from product_variants where company_id = co and sku = l->>'sku'),
            (select id from warehouse_locations where company_id = co and code = coalesce(l->>'loc', 'WH/STOCK')),
            (l->>'qty')::numeric, (l->>'price')::numeric, (select id from lots where company_id = co and lot_number = l->>'lot'));
  end loop;
  perform public.post_goods_receipt(r);
  return r;
end $$;

create or replace function pg_temp.adjust(p_date date, p_reason text, p_lines jsonb, p_wh text default 'WH') returns uuid language plpgsql as $$
declare co uuid := current_setting('t.co')::uuid; a uuid; l jsonb;
begin
  insert into stock_adjustments (company_id, warehouse_id, reason, adjustment_date, notes)
  values (co, (select id from warehouses where company_id = co and code = p_wh), p_reason, p_date, 'Të dhëna demo') returning id into a;
  for l in select * from jsonb_array_elements(p_lines) loop
    insert into stock_adjustment_lines (company_id, adjustment_id, variant_id, location_id, quantity_change, unit_cost, lot_id)
    values (co, a, (select id from product_variants where company_id = co and sku = l->>'sku'),
            (select id from warehouse_locations where company_id = co and code = coalesce(l->>'loc', 'WH/STOCK')), (l->>'qty')::numeric, (l->>'cost')::numeric,
            (select id from lots where company_id = co and lot_number = l->>'lot'));
  end loop;
  perform public.post_stock_adjustment(a);
  return a;
end $$;

insert into lots (company_id, variant_id, lot_number, manufacture_date, expiry_date)
select :'co', id, x.lot, x.mf, x.ex from product_variants, (values ('ML-2610A', current_date - 6, current_date + 6), ('ML-2610B', current_date - 2, current_date + 10)) x(lot, mf, ex)
where company_id = :'co' and sku = 'MILK-1L';

select pg_temp.adjust(current_date - 29, 'opening', '[{"sku":"TEE-S-NAV","qty":12,"cost":620},{"sku":"TEE-M-NAV","qty":18,"cost":620},{"sku":"TEE-L-NAV","qty":14,"cost":620},{"sku":"TEE-M-WHI","qty":9,"cost":600},{"sku":"MUG-CER","qty":40,"cost":310},{"sku":"WATER-05","qty":480,"cost":18}]');
select pg_temp.receive(current_date - 24, 'V002', '[{"sku":"TEE-S-WHI","qty":20,"price":640},{"sku":"TEE-L-WHI","qty":20,"price":640},{"sku":"TEE-XL-NAV","qty":15,"price":660},{"sku":"TEE-XL-WHI","qty":6,"price":660}]');
select pg_temp.receive(current_date - 20, 'V001', '[{"sku":"ESP-1KG","qty":96,"price":9.40}]', true, 'EUR', 100.15, '2026/AL/0912-118734') as imp1 \gset
select pg_temp.receive(current_date - 16, 'V004', '[{"sku":"WATER-05","qty":600,"price":19.5}]');
select pg_temp.receive(current_date - 6, 'V003', '[{"sku":"MILK-1L","qty":144,"price":92,"lot":"ML-2610A"}]');
select pg_temp.adjust(current_date - 14, 'correction', '[{"sku":"ESP-1KG","qty":-58},{"sku":"WATER-05","qty":-610},{"sku":"TEE-M-NAV","qty":-11},{"sku":"MUG-CER","qty":-12}]');

-- landed cost for the import after customs clearance (part already sold)
insert into landed_costs (company_id, allocation_method, landed_cost_date, notes) values (:'co', 'value', current_date - 12, 'Fatura e spedicionit + detyrimi doganor, DUD 2026/AL/0912-118734') returning id as lc \gset
insert into landed_cost_receipts (company_id, landed_cost_id, receipt_id) values (:'co', :'lc', :'imp1');
insert into landed_cost_charges (company_id, landed_cost_id, charge_type, description, amount) values
  (:'co', :'lc', 'freight', 'Milano → Durrës, ngarkesë e përbashkët', 18400), (:'co', :'lc', 'customs', 'Detyrim doganor 10%', 9640), (:'co', :'lc', 'handling', 'Shërbime porti', 2100);
select public.post_landed_cost(:'lc');

select pg_temp.receive(current_date - 3, 'V001', '[{"sku":"ESP-1KG","qty":48,"price":9.60}]', true, 'EUR', 99.80, '2026/AL/1020-121004');
select pg_temp.receive(current_date - 1, 'V003', '[{"sku":"MILK-1L","qty":96,"price":94,"lot":"ML-2610B"}]');
select pg_temp.adjust(current_date - 2, 'correction', '[{"sku":"MILK-1L","qty":-130,"lot":"ML-2610A"},{"sku":"MILK-1L","qty":-30,"lot":"ML-2610B"},{"sku":"ESP-1KG","qty":-50},{"sku":"WATER-05","qty":-160}]');
select pg_temp.adjust(current_date - 1, 'damage', '[{"sku":"MUG-CER","qty":-3}]');

-- transfer to the store
insert into stock_transfers (company_id, from_warehouse_id, to_warehouse_id, transfer_date) values (:'co', :'wh', :'st', current_date - 4) returning id as trf \gset
insert into stock_transfer_lines (company_id, transfer_id, variant_id, from_location_id, to_location_id, quantity)
select :'co', :'trf', v.id, :'stock', :'floor', x.q from product_variants v, (values ('TEE-M-NAV', 4), ('TEE-S-WHI', 6), ('MUG-CER', 10), ('WATER-05', 96)) x(sku, q) where v.company_id = :'co' and v.sku = x.sku;
select public.post_stock_transfer(:'trf');

-- approval rule + a write-off waiting for Besnik
insert into approval_workflows (company_id, name, doc_type, min_amount) values (:'co', 'Nxjerrje nga stoku mbi 10 000 ALL', 'stock_adjustment', 10000) returning id as wf \gset
insert into approval_workflow_steps (company_id, workflow_id, step_order, name, approver_role_id) select :'co', :'wf', 1, 'Miratimi i përgjegjësit të magazinës', id from roles where key = 'inventory_manager';
insert into stock_adjustments (company_id, warehouse_id, reason, adjustment_date, notes) values (:'co', :'wh', 'theft', current_date, 'Mungon pas fundjavës; kallëzim në polici nr. 4471') returning id as theft \gset
insert into stock_adjustment_lines (company_id, adjustment_id, variant_id, location_id, quantity_change) select :'co', :'theft', id, :'stock', -12 from product_variants where company_id = :'co' and sku = 'ESP-1KG';
select public.post_stock_adjustment(:'theft');

-- a draft receipt in progress
insert into goods_receipts (company_id, warehouse_id, vendor_id, vendor_delivery_note) select :'co', :'wh', id, 'FD-7781' from business_partners where company_id = :'co' and code = 'V002' returning id as draft \gset
insert into goods_receipt_lines (company_id, receipt_id, variant_id, location_id, quantity, unit_price) select :'co', :'draft', id, :'stock', 24, 650 from product_variants where company_id = :'co' and sku = 'TEE-M-NAV';

insert into entity_activities (company_id, entity_type, entity_id, activity_type, body)
select :'co', 'products', id, 'comment', 'Furnitori konfirmoi çmimin e ri të kafesë Milano nga nëntori: 9,60 €/kg.' from products where company_id = :'co' and code = 'ESP-1KG';

-- =============================================================================
-- Phase 3 · CRM & sales demo data
-- =============================================================================
select pg_temp.demo_user('dritan@ylli.al', 'Dritan Shehu');
select pg_temp.demo_user('elira@ylli.al', 'Elira Dervishi');
select public.invite_member(:'co', 'dritan@ylli.al', array['sales_rep']);
select public.invite_member(:'co', 'elira@ylli.al',  array['sales_manager']);
update company_members set status = 'active', user_id = u.id from auth.users u
 where company_members.company_id = :'co' and lower(company_members.invited_email) = u.email and company_members.user_id is null;
select id as u_arta from auth.users where email = 'arta@ylli.al' \gset
select id as u_dritan from auth.users where email = 'dritan@ylli.al' \gset
select id as u_elira from auth.users where email = 'elira@ylli.al' \gset
select id as net30 from payment_terms where company_id = :'co' and code = 'NET30' \gset
select id as net15 from payment_terms where company_id = :'co' and code = 'NET15' \gset

-- price lists
insert into price_lists (company_id, name, currency_code, is_default, prices_include_tax) values (:'co', 'Pakicë', 'ALL', true, false) returning id as pl_retail \gset
insert into price_lists (company_id, name, currency_code) values (:'co', 'Shumicë HoReCa', 'ALL') returning id as pl_horeca \gset
insert into price_lists (company_id, name, currency_code) values (:'co', 'Distributorët e Kosovës (EUR)', 'EUR') returning id as pl_eur \gset
insert into price_list_items (company_id, price_list_id, variant_id, min_quantity, price)
select :'co', x.pl::uuid, v.id, x.q, x.p from product_variants v join (values
  (:'pl_horeca', 'ESP-1KG', 1, 2900), (:'pl_horeca', 'ESP-1KG', 12, 2750), (:'pl_horeca', 'WATER-05', 1, 32), (:'pl_horeca', 'WATER-05', 96, 28),
  (:'pl_horeca', 'MUG-CER', 1, 520), (:'pl_horeca', 'MILK-1L', 1, 140),
  (:'pl_eur', 'ESP-1KG', 1, 27.50), (:'pl_eur', 'MUG-CER', 1, 4.90),
  (:'pl_retail', 'ESP-1KG', 1, 3200), (:'pl_retail', 'MUG-CER', 1, 690)
) x(pl, sku, q, p) on v.sku = x.sku where v.company_id = :'co';

-- customers
update business_partners set price_list_id = :'pl_horeca', payment_term_id = :'net30', default_discount_pct = 3, credit_limit = 600000,
       salesperson_id = :'u_dritan', tax_number = 'K01725013D', email = 'purchasing@rogner.al', phone = '+355 4 223 5035'
 where company_id = :'co' and code = 'C001';
update business_partners set price_list_id = :'pl_horeca', payment_term_id = :'net15', credit_limit = 150000, salesperson_id = :'u_dritan',
       tax_number = 'L61507038A', email = 'zyra@mullixhiu.al'
 where company_id = :'co' and code = 'C002';
insert into business_partners (company_id, code, name, kind, is_customer, tax_number, email, phone, price_list_id, payment_term_id, credit_limit, salesperson_id) values
  (:'co', 'C003', 'Bar Komiteti', 'company', true, 'L82314006G', 'info@komiteti.al', '+355 69 205 1122', :'pl_horeca', :'net15', 80000, :'u_elira'),
  (:'co', 'C004', 'Spar Albania — Ring Center', 'company', true, 'K31412029R', 'orders@spar.al', '+355 4 238 0100', null, :'net30', 250000, :'u_elira'),
  (:'co', 'C005', 'Klea Basha', 'individual', true, null, 'klea.basha@gmail.com', '+355 68 444 1290', null, null, null, null),
  (:'co', 'C006', 'Prishtina Coffee Co. L.L.C.', 'company', true, '811234567', 'hello@pricoffee.com', '+383 44 123 456', :'pl_eur', :'net30', 400000, :'u_elira');
update business_partners set currency_code = 'EUR' where company_id = :'co' and code = 'C006';
select id as c_rogner from business_partners where company_id = :'co' and code = 'C001' \gset
select id as c_mullixhiu from business_partners where company_id = :'co' and code = 'C002' \gset
select id as c_komiteti from business_partners where company_id = :'co' and code = 'C003' \gset
select id as c_spar from business_partners where company_id = :'co' and code = 'C004' \gset
select id as c_klea from business_partners where company_id = :'co' and code = 'C005' \gset
insert into partner_contacts (company_id, partner_id, name, job_title, email, phone, is_primary) values
  (:'co', :'c_rogner', 'Gentiana Muça', 'Blerjet ushqim-pije', 'g.muca@rogner.al', '+355 69 400 2210', true),
  (:'co', :'c_rogner', 'Arben Kola', 'Shefi i kuzhinës', null, '+355 69 400 2290', false);
insert into partner_addresses (company_id, partner_id, address_type, label, line1, city, postal_code, is_default) values
  (:'co', :'c_rogner', 'both', 'Hoteli', 'Bulevardi Dëshmorët e Kombit', 'Tiranë', '1001', true),
  (:'co', :'c_spar', 'shipping', 'Rampa e shkarkimit, Ring Center', 'Rruga Kavajës 125', 'Tiranë', '1027', true);
insert into partner_prices (company_id, partner_id, variant_id, price, notes)
select :'co', :'c_rogner', id, 2650, 'Marrëveshje vjetore furnizimi 2026' from product_variants where company_id = :'co' and sku = 'ESP-1KG';
insert into partner_prices (company_id, partner_id, variant_id, discount_pct, min_quantity)
select :'co', :'c_spar', id, 8, 48 from product_variants where company_id = :'co' and sku = 'WATER-05';

-- leads
create temp table seed_leads as select * from (values
  (:'co', 'Kafe për 2 pika të reja', 'Ilir Hysa', 'Mon Chéri Café', 'ilir@moncheri.al', '+355 69 777 1100', 'referral', :'u_dritan', 180000, 'new', now() - interval '1 day'),
  (:'co', 'Filxhanë me logo për dhurata stafi', 'Ornela Gjoni', 'Vodafone Albania', 'o.gjoni@vodafone.al', null, 'website', :'u_elira', 95000, 'contacted', now() - interval '4 days'),
  (:'co', 'Furnizim javor me qumësht dhe ujë', 'Sokol Marku', 'Kopshti i fëmijëve Botanik', null, '+355 68 211 3344', 'cold_call', :'u_dritan', 60000, 'qualified', now() - interval '6 days'),
  (:'co', 'Bluza për maratonën', null, 'Tirana Marathon', 'info@tiranamarathon.al', null, 'event', :'u_elira', 320000, 'new', now() - interval '2 hours'),
  (:'co', 'Espresso për bar shtëpie', 'Blerta Ndreu', null, 'blerta.n@gmail.com', null, 'social', null, 6400, 'lost', now() - interval '12 days')
) x(company_id, title, contact_name, company_name, email, phone, source, owner_id, estimated_value, status, created_at);
insert into leads (company_id, title, contact_name, company_name, email, phone, source, owner_id, estimated_value, created_at)
select company_id::uuid, title, contact_name, company_name, email, phone, source, owner_id::uuid, estimated_value, created_at from seed_leads order by created_at;
update leads l set status = s.status from seed_leads s where l.company_id = :'co' and l.title = s.title and s.status <> 'new';
update leads set lost_reason = 'E bleu në supermarket' where company_id = :'co' and status = 'lost';

-- opportunities
select id as s_new from crm_pipeline_stages where company_id = :'co' and sort_order = (select min(sort_order) from crm_pipeline_stages where company_id = :'co') \gset
create or replace function pg_temp.stage(p_name text) returns uuid language sql as $$ select id from crm_pipeline_stages where company_id = current_setting('t.co')::uuid and name = p_name $$;
insert into opportunities (company_id, name, partner_id, stage_id, owner_id, expected_value, currency_code, expected_close_date) values
  (:'co', 'Spar: raft kafeje dhe uji për tremujorin e katërt', :'c_spar', pg_temp.stage('Qualified'), :'u_elira', 420000, 'ALL', current_date + 20),
  (:'co', 'Rogner: banketet e Krishtlindjeve', :'c_rogner', pg_temp.stage('Proposal'), :'u_dritan', 260000, 'ALL', current_date + 35),
  (:'co', 'Komiteti: kalim te kafeja Milano', :'c_komiteti', pg_temp.stage('Negotiation'), :'u_elira', 140000, 'ALL', current_date + 6),
  (:'co', 'Mullixhiu: filxhanë të rinj qeramike', :'c_mullixhiu', pg_temp.stage('New'), :'u_dritan', 48000, 'ALL', current_date + 45),
  (:'co', 'Klea: abonim kafeje për zyrën', :'c_klea', pg_temp.stage('New'), :'u_dritan', 38400, 'ALL', current_date - 3),
  (:'co', 'Prishtina Coffee: shpërndarja në Kosovë', (select id from business_partners where company_id = :'co' and code = 'C006'), pg_temp.stage('Proposal'), :'u_elira', 1650000, 'ALL', current_date + 60);
insert into opportunities (company_id, name, partner_id, stage_id, owner_id, expected_value, currency_code, expected_close_date, lost_reason) values
  (:'co', 'Spar: ujë me markën e vet', :'c_spar', pg_temp.stage('Negotiation'), :'u_elira', 300000, 'ALL', current_date - 10, null);
update opportunities set stage_id = pg_temp.stage('Lost'), lost_reason = 'Çmimi shumë i lartë' where company_id = :'co' and name = 'Spar: ujë me markën e vet';

-- historical invoices (Jan → last month) for the revenue trend
-- documents to settle with real payments in the finance section (doc, kind, days until paid)
create temp table to_pay (doc uuid, kind text, days int);
create or replace function pg_temp.invoice(p_date date, p_customer text, p_sales uuid, p_lines jsonb, p_paid boolean default true) returns uuid language plpgsql as $$
declare co uuid := current_setting('t.co')::uuid; i uuid; l jsonb; n int := 0; c record;
begin
  select * into c from business_partners where company_id = co and code = p_customer;
  insert into sales_invoices (company_id, partner_id, invoice_date, due_date, currency_code, payment_term_id, salesperson_id)
  values (co, c.id, p_date, p_date + 30, 'ALL', c.payment_term_id, p_sales) returning id into i;
  for l in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    insert into sales_invoice_lines (company_id, invoice_id, line_no, variant_id, description, quantity, unit_price, tax_code_id)
    select co, i, n, v.id, v.name, (l->>'qty')::numeric, (l->>'price')::numeric, p.sales_tax_code_id
      from product_variants v join products p on p.id = v.product_id where v.company_id = co and v.sku = l->>'sku';
  end loop;
  perform public.post_sales_invoice(i);
  if p_paid then insert into to_pay values (i, 'ar', case p_customer when 'C001' then 24 when 'C002' then 12 when 'C004' then 35 else 18 end); end if;
  return i;
end $$;
select set_config('t.dritan', :'u_dritan', false), set_config('t.elira', :'u_elira', false);
do $$
declare m int; d date; dr uuid := current_setting('t.dritan')::uuid; el uuid := current_setting('t.elira')::uuid; k numeric;
begin
  for m in 1 .. extract(month from current_date)::int - 1 loop
    d := make_date(extract(year from current_date)::int, m, 1);
    k := 1 + (m % 4) * 0.15 + m * 0.04;
    perform pg_temp.invoice(d + 4,  'C001', dr, jsonb_build_array(jsonb_build_object('sku','ESP-1KG','qty', round(24*k),'price',2650), jsonb_build_object('sku','WATER-05','qty', round(192*k),'price',28)));
    perform pg_temp.invoice(d + 11, 'C002', dr, jsonb_build_array(jsonb_build_object('sku','ESP-1KG','qty', round(8*k),'price',2900), jsonb_build_object('sku','MILK-1L','qty', round(60*k),'price',140)));
    perform pg_temp.invoice(d + 17, 'C004', el, jsonb_build_array(jsonb_build_object('sku','WATER-05','qty', round(480*k),'price',30), jsonb_build_object('sku','MUG-CER','qty', round(12*k),'price',690)));
    if m % 2 = 0 then perform pg_temp.invoice(d + 22, 'C003', el, jsonb_build_array(jsonb_build_object('sku','ESP-1KG','qty', round(6*k),'price',2900))); end if;
  end loop;
end $$;
-- one last-month invoice still unpaid and overdue
select pg_temp.invoice((date_trunc('month', current_date) - interval '25 days')::date, 'C003', :'u_elira', '[{"sku":"ESP-1KG","qty":5,"price":2900},{"sku":"MUG-CER","qty":6,"price":520}]', false);
update sales_invoices set due_date = invoice_date + 15 where company_id = :'co' and payment_status = 'unpaid' and id not in (select doc from to_pay);

-- Phase 5: customer receipts are real payments (credit limits look at what is still open)
select set_config('request.jwt.claim.sub', :'u_arta', false);
-- bank accounts: the seeded main account gets its real details; a EUR account for Italian suppliers
update bank_accounts set name = 'BKT llogari rrjedhëse', bank_name = 'Banka Kombëtare Tregtare', iban = 'AL35202111090000000001234567', swift = 'NCBAALTX'
 where company_id = :'co' and name = 'Main bank account';
insert into accounts (company_id, code, name, account_type, account_subtype, is_reconcilable, parent_id)
select :'co', '5122', 'Banka — llogaria në EUR', 'asset', 'bank', true, parent_id from accounts where company_id = :'co' and code = '5121';
insert into bank_accounts (company_id, name, account_kind, bank_name, iban, swift, currency_code, account_id, journal_id)
select :'co', 'Raiffeisen EUR', 'bank', 'Raiffeisen Bank Albania', 'AL47212110090000000235698741', 'SGSBALTX', 'EUR', a.id, j.id
  from accounts a, journals j where a.company_id = :'co' and a.code = '5122' and j.company_id = :'co' and j.code = 'BNK';
select id as bkt from bank_accounts where company_id = :'co' and name = 'BKT llogari rrjedhëse' \gset
select id as eur from bank_accounts where company_id = :'co' and name = 'Raiffeisen EUR' \gset
select set_config('t.bkt', :'bkt', false), set_config('t.eur', :'eur', false);


create or replace function pg_temp.settle(p_kind text) returns void language plpgsql as $$
declare co uuid := current_setting('t.co')::uuid; r record; pid uuid; half boolean := true; v_amt numeric;
begin
  for r in
    select t.kind, t.days, i.id, i.partner_id, i.invoice_date as dt, i.total - i.amount_paid as open, i.currency_code as cur, i.number, bp.code
      from to_pay t join sales_invoices i on i.id = t.doc join business_partners bp on bp.id = i.partner_id where t.kind = 'ar' and p_kind = 'ar'
    union all
    select t.kind, t.days, b.id, b.vendor_id, b.bill_date, b.total - b.amount_paid, b.currency_code, b.vendor_invoice_number, bp.code
      from to_pay t join vendor_bills b on b.id = t.doc join business_partners bp on bp.id = b.vendor_id where t.kind = 'ap' and p_kind = 'ap'
    order by 5, 3
  loop
    continue when r.dt + r.days >= current_date or r.open <= 0
               or exists (select 1 from payment_allocations pa where pa.sales_invoice_id = r.id or pa.vendor_bill_id = r.id);
    v_amt := r.open;
    -- Spar pays its latest invoice in two halves
    if r.code = 'C004' and r.kind = 'ar' and r.dt + r.days > current_date - 40 and half then v_amt := round(r.open / 2, -2); half := false; end if;
    insert into payments (company_id, document_type, partner_id, bank_account_id, payment_date, method, amount, reference)
    values (co, case r.kind when 'ar' then 'customer_payment' else 'vendor_payment' end, r.partner_id,
            case when r.cur = 'EUR' then current_setting('t.eur')::uuid else current_setting('t.bkt')::uuid end,
            r.dt + r.days, 'bank_transfer', v_amt, r.number)
    returning id into pid;
    if r.kind = 'ar' then insert into payment_allocations (company_id, payment_id, sales_invoice_id, amount) values (co, pid, r.id, v_amt);
    else insert into payment_allocations (company_id, payment_id, vendor_bill_id, amount) values (co, pid, r.id, v_amt); end if;
    perform public.post_payment(pid);
  end loop;
end $$;
select pg_temp.settle('ar');

-- this month: the full flow, through the same functions the UI calls
select set_config('request.jwt.claim.sub', :'u_dritan', false);
-- 1. quote → order → delivery → invoice (Hotel Rogner, uses the special espresso price)
insert into sales_quotes (company_id, partner_id, currency_code, payment_term_id, salesperson_id, price_list_id, quote_date, valid_until, terms,
                          opportunity_id)
values (:'co', :'c_rogner', 'ALL', :'net30', :'u_dritan', :'pl_horeca', current_date - 9, current_date + 5, 'Dorëzim brenda 3 ditëve pune.', null)
returning id as q1 \gset
insert into sales_quote_lines (company_id, quote_id, line_no, variant_id, description, quantity, unit_price, discount_pct, tax_code_id)
select :'co', :'q1', x.n, v.id, v.name, x.q, x.p, 3, :'vat20' from product_variants v join (values (1, 'ESP-1KG', 12, 2650), (2, 'WATER-05', 96, 28)) x(n, sku, q, p) on v.sku = x.sku where v.company_id = :'co';
update sales_quotes set status = 'sent' where id = :'q1';
select public.convert_quote_to_order(:'q1', :'wh') as so1 \gset
update sales_orders set order_date = current_date - 8, customer_reference = 'PO-ROG-2210' where id = :'so1';
select set_config('request.jwt.claim.sub', :'u_elira', false);
select public.confirm_sales_order(:'so1');
select set_config('request.jwt.claim.sub', :'u_arta', false);
select public.create_delivery_from_order(:'so1') as d1 \gset
select public.post_delivery(:'d1');
select public.create_invoice_from_order(:'so1') as inv1 \gset
select public.post_sales_invoice(:'inv1');

-- 2. confirmed order with stock reserved, waiting for the warehouse (Spar)
select set_config('request.jwt.claim.sub', :'u_elira', false);
insert into sales_orders (company_id, partner_id, warehouse_id, currency_code, payment_term_id, salesperson_id, order_date, requested_date, customer_reference)
values (:'co', :'c_spar', :'wh', 'ALL', :'net30', :'u_elira', current_date - 2, current_date + 1, 'SPAR-PO-55120') returning id as so2 \gset
insert into sales_order_lines (company_id, sales_order_id, line_no, variant_id, description, quantity, unit_price, discount_pct, tax_code_id)
select :'co', :'so2', x.n, v.id, v.name, x.q, x.p, x.d, :'vat20' from product_variants v join (values (1, 'WATER-05', 96, 30, 8), (2, 'MUG-CER', 6, 690, 0), (3, 'TEE-M-WHI', 4, 1800, 0)) x(n, sku, q, p, d) on v.sku = x.sku where v.company_id = :'co';
select public.confirm_sales_order(:'so2');

-- 3. partially delivered order (Mullixhiu ordered more espresso than is free)
select set_config('request.jwt.claim.sub', :'u_dritan', false);
insert into sales_orders (company_id, partner_id, warehouse_id, currency_code, payment_term_id, salesperson_id, price_list_id, order_date)
values (:'co', :'c_mullixhiu', :'wh', 'ALL', :'net15', :'u_dritan', :'pl_horeca', current_date - 5) returning id as so3 \gset
insert into sales_order_lines (company_id, sales_order_id, line_no, variant_id, description, quantity, unit_price, tax_code_id)
select :'co', :'so3', x.n, v.id, v.name, x.q, x.p, :'vat20' from product_variants v join (values (1, 'MILK-1L', 24, 140), (2, 'TEE-XL-WHI', 10, 1800)) x(n, sku, q, p) on v.sku = x.sku where v.company_id = :'co';
select public.confirm_sales_order(:'so3');
select set_config('request.jwt.claim.sub', :'u_arta', false);
select public.create_delivery_from_order(:'so3') as d3 \gset
select public.post_delivery(:'d3');

-- 4. draft order + sent quote + draft quote
select set_config('request.jwt.claim.sub', :'u_dritan', false);
insert into sales_orders (company_id, partner_id, warehouse_id, currency_code, salesperson_id, order_date) values (:'co', :'c_klea', :'wh', 'ALL', :'u_dritan', current_date) returning id as so4 \gset
insert into sales_order_lines (company_id, sales_order_id, line_no, variant_id, description, quantity, unit_price, tax_code_id)
select :'co', :'so4', 1, v.id, v.name, 2, 3200, :'vat20' from product_variants v where v.company_id = :'co' and v.sku = 'ESP-1KG';
insert into sales_quotes (company_id, partner_id, currency_code, salesperson_id, quote_date, valid_until, opportunity_id)
values (:'co', :'c_komiteti', 'ALL', :'u_elira', current_date - 3, current_date + 11, (select id from opportunities where company_id = :'co' and name like 'Komiteti%')) returning id as q2 \gset
insert into sales_quote_lines (company_id, quote_id, line_no, variant_id, description, quantity, unit_price, tax_code_id)
select :'co', :'q2', 1, v.id, v.name, 18, 2750, :'vat20' from product_variants v where v.company_id = :'co' and v.sku = 'ESP-1KG';
update sales_quotes set status = 'sent' where id = :'q2';
insert into sales_quotes (company_id, partner_id, currency_code, salesperson_id, quote_date, valid_until, opportunity_id)
values (:'co', :'c_rogner', 'ALL', :'u_dritan', current_date, current_date + 14, (select id from opportunities where company_id = :'co' and name like 'Rogner%')) returning id as q3 \gset
insert into sales_quote_lines (company_id, quote_id, line_no, variant_id, description, quantity, unit_price, tax_code_id)
select :'co', :'q3', x.n, v.id, v.name, x.q, x.p, :'vat20' from product_variants v join (values (1, 'MUG-CER', 60, 520), (2, 'ESP-1KG', 30, 2650)) x(n, sku, q, p) on v.sku = x.sku where v.company_id = :'co';
-- more of this month's business, sold out of stock through order → delivery → invoice
select set_config('request.jwt.claim.sub', :'u_arta', false);
select pg_temp.receive(current_date - 16, 'V004', '[{"sku":"WATER-05","qty":960,"price":19.5}]');
select pg_temp.receive(current_date - 15, 'V001', '[{"sku":"ESP-1KG","qty":60,"price":9.60}]', true, 'EUR', 99.90, '2026/AL/1008-120551');
create or replace function pg_temp.sell(p_date date, p_customer text, p_sales uuid, p_lines jsonb, p_paid boolean default false) returns uuid language plpgsql as $$
declare co uuid := current_setting('t.co')::uuid; o uuid; d uuid; i uuid; l jsonb; n int := 0; c record;
begin
  select * into c from business_partners where company_id = co and code = p_customer;
  insert into sales_orders (company_id, partner_id, warehouse_id, currency_code, payment_term_id, salesperson_id, price_list_id, order_date)
  values (co, c.id, (select id from warehouses where company_id = co and code = 'WH'), 'ALL', c.payment_term_id, p_sales, c.price_list_id, p_date) returning id into o;
  for l in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    insert into sales_order_lines (company_id, sales_order_id, line_no, variant_id, description, quantity, unit_price, discount_pct, tax_code_id)
    select co, o, n, v.id, v.name, (l->>'qty')::numeric, (l->>'price')::numeric, coalesce((l->>'disc')::numeric, 0), p.sales_tax_code_id
      from product_variants v join products p on p.id = v.product_id where v.company_id = co and v.sku = l->>'sku';
  end loop;
  perform public.confirm_sales_order(o);
  d := public.create_delivery_from_order(o);
  perform public.post_delivery(d);
  i := public.create_invoice_from_order(o);
  update sales_invoices set invoice_date = p_date + 1, due_date = p_date + 1 + coalesce((select due_days from payment_terms where id = c.payment_term_id), 0) where id = i;
  perform public.post_sales_invoice(i);
  if p_paid then insert into to_pay values (i, 'ar', 2); end if;
  return o;
end $$;
select pg_temp.sell(greatest(date_trunc('month', current_date)::date, current_date - 14), 'C004', :'u_elira', '[{"sku":"WATER-05","qty":480,"price":30,"disc":8},{"sku":"MUG-CER","qty":6,"price":690}]', true);
select pg_temp.sell(greatest(date_trunc('month', current_date)::date, current_date - 11), 'C002', :'u_dritan', '[{"sku":"ESP-1KG","qty":10,"price":2900},{"sku":"MILK-1L","qty":24,"price":140}]');
select pg_temp.sell(greatest(date_trunc('month', current_date)::date, current_date - 7), 'C001', :'u_dritan', '[{"sku":"ESP-1KG","qty":24,"price":2650,"disc":3},{"sku":"WATER-05","qty":192,"price":28,"disc":3}]');
select pg_temp.sell(current_date - 1, 'C005', null, '[{"sku":"MUG-CER","qty":2,"price":690},{"sku":"TEE-S-NAV","qty":1,"price":1800}]', true);

-- =============================================================================
-- Phase 4 · Procurement demo data
-- =============================================================================
select set_config('request.jwt.claim.sub', :'u_arta', false);
select pg_temp.demo_user('genta@ylli.al', 'Genta Mema');
select public.invite_member(:'co', 'genta@ylli.al', array['procurement_manager']);
select id as u_genta from auth.users where email = 'genta@ylli.al' \gset
select id as u_besnik from auth.users where email = 'besnik@ylli.al' \gset
insert into exchange_rates (company_id, currency_code, rate_date, rate) values
  (:'co', 'EUR', make_date(extract(year from current_date)::int, 1, 1), 100.45),
  (:'co', 'EUR', current_date - 45, 99.95), (:'co', 'EUR', current_date - 7, 99.80);

insert into business_partners (company_id, code, name, is_vendor, tax_number, currency_code, payment_term_id, email, phone) values
  (:'co', 'V005', 'Qeramika Kavaja sh.p.k.', true, 'K12817004P', 'ALL', :'net30', 'shitje@qeramikakavaja.al', '+355 55 224 410'),
  (:'co', 'V006', 'Pastrimi Pro', true, 'L72214011B', 'ALL', :'net15', 'info@pastrimipro.al', '+355 69 300 4411');
update business_partners set payment_term_id = :'net30', email = 'export@caffemilano.it', phone = '+39 02 8899 1200' where company_id = :'co' and code = 'V001';
update business_partners set payment_term_id = :'net15', email = 'porosi@tekstildurres.al' where company_id = :'co' and code = 'V002';
update business_partners set payment_term_id = :'net15', email = 'shitje@fermatlushnja.al' where company_id = :'co' and code = 'V003';
update business_partners set payment_term_id = :'net30', email = 'b2b@ujeglina.al' where company_id = :'co' and code = 'V004';

-- vendor price lists
insert into vendor_products (company_id, vendor_id, variant_id, vendor_sku, price, currency_code, min_order_qty, lead_time_days, is_preferred)
select :'co', bp.id, v.id, x.vsku, x.price, x.cur, x.moq, x.lead, x.pref
  from (values
    ('V001', 'ESP-1KG', 'MIL-BLEND-1000', 9.60, 'EUR', 24, 21, true),
    ('V003', 'MILK-1L', 'QF-1L', 92, 'ALL', 48, 1, true),
    ('V004', 'WATER-05', 'GL-050-PET', 19.5, 'ALL', 240, 2, true),
    ('V005', 'MUG-CER', 'QK-M350', 300, 'ALL', 24, 10, true),
    ('V002', 'TEE-S-NAV', 'TD-ORG-S-N', 640, 'ALL', 10, 7, true), ('V002', 'TEE-M-NAV', 'TD-ORG-M-N', 640, 'ALL', 10, 7, true),
    ('V002', 'TEE-L-NAV', 'TD-ORG-L-N', 640, 'ALL', 10, 7, true), ('V002', 'TEE-XL-NAV', 'TD-ORG-XL-N', 660, 'ALL', 10, 7, true),
    ('V002', 'TEE-S-WHI', 'TD-ORG-S-W', 640, 'ALL', 10, 7, true), ('V002', 'TEE-M-WHI', 'TD-ORG-M-W', 640, 'ALL', 10, 7, true),
    ('V002', 'TEE-L-WHI', 'TD-ORG-L-W', 640, 'ALL', 10, 7, true), ('V002', 'TEE-XL-WHI', 'TD-ORG-XL-W', 660, 'ALL', 10, 7, true)
  ) x(vendor, sku, vsku, price, cur, moq, lead, pref)
  join business_partners bp on bp.company_id = :'co' and bp.code = x.vendor
  join product_variants v on v.company_id = :'co' and v.sku = x.sku;

insert into approval_workflows (company_id, name, doc_type, min_amount) values (:'co', 'Porositë e blerjes mbi 100 000 ALL', 'purchase_order', 100000) returning id as wf_po \gset
insert into approval_workflow_steps (company_id, workflow_id, step_order, name, approver_role_id) select :'co', :'wf_po', 1, 'Miratimi i pronarit', id from roles where key = 'company_admin';

-- historical bills (before the system went live) for the spend trend
create or replace function pg_temp.hist_bill(p_date date, p_vendor text, p_no text, p_lines jsonb, p_cur text default 'ALL', p_rate numeric default 1) returns uuid language plpgsql as $$
declare co uuid := current_setting('t.co')::uuid; b uuid; l jsonb; n int := 0;
begin
  insert into vendor_bills (company_id, vendor_id, vendor_invoice_number, bill_date, due_date, currency_code, exchange_rate, notes)
  select co, id, p_no, p_date, p_date + 30, p_cur, p_rate, 'Import i gjendjes fillestare' from business_partners where company_id = co and code = p_vendor returning id into b;
  for l in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    insert into vendor_bill_lines (company_id, bill_id, line_no, variant_id, description, quantity, unit_price, tax_code_id)
    select co, b, n, v.id, v.name, (l->>'qty')::numeric, (l->>'price')::numeric, coalesce(p.purchase_tax_code_id, p.sales_tax_code_id)
      from product_variants v join products p on p.id = v.product_id where v.company_id = co and v.sku = l->>'sku';
  end loop;
  perform public.post_vendor_bill(b);
  insert into to_pay values (b, 'ap', case p_vendor when 'V001' then 40 when 'V004' then 20 else 28 end);
  return b;
end $$;
do $$
declare m int; d date; k numeric;
begin
  for m in 1 .. extract(month from current_date)::int - 1 loop
    d := make_date(extract(year from current_date)::int, m, 1);
    k := 1 + (m % 3) * 0.12 + m * 0.03;
    perform pg_temp.hist_bill(d + 3, 'V004', format('GL-%s-%s', m, 118), jsonb_build_array(jsonb_build_object('sku','WATER-05','qty', round(960*k),'price',19.5)));
    perform pg_temp.hist_bill(d + 6, 'V003', format('FL/%s/%s', m, 2201), jsonb_build_array(jsonb_build_object('sku','MILK-1L','qty', round(400*k),'price',92)));
    perform pg_temp.hist_bill(d + 12, 'V001', format('CM-26-%s', 300 + m), jsonb_build_array(jsonb_build_object('sku','ESP-1KG','qty', round(48*k),'price',9.6)), 'EUR', 100.2);
    if m % 3 = 0 then perform pg_temp.hist_bill(d + 15, 'V002', format('TD-%s', 7700 + m), jsonb_build_array(jsonb_build_object('sku','TEE-M-NAV','qty', 60,'price',640))); end if;
  end loop;
end $$;

-- requisitions (Besnik asks, Genta decides and orders)
select set_config('request.jwt.claim.sub', :'u_besnik', false);
insert into purchase_requisitions (company_id, warehouse_id, required_date, justification) values (:'co', :'wh', current_date + 12, 'Espresso për menunë e vjeshtës në të dy dyqanet') returning id as rq1 \gset
insert into purchase_requisition_lines (company_id, requisition_id, variant_id, description, quantity, estimated_unit_cost)
select :'co', :'rq1', id, name, 96, 970 from product_variants where company_id = :'co' and sku = 'ESP-1KG';
select public.submit_requisition(:'rq1');
insert into purchase_requisitions (company_id, warehouse_id, required_date, justification) values (:'co', :'wh', current_date + 5, 'Materiale pastrimi për magazinën dhe dyqanin e Bllokut') returning id as rq2 \gset
insert into purchase_requisition_lines (company_id, requisition_id, description, quantity, estimated_unit_cost, suggested_vendor_id)
select :'co', :'rq2', x.d, x.q, x.c, (select id from business_partners where company_id = :'co' and code = 'V006')
  from (values ('Detergjent dyshemeje 5 L', 6, 1450), ('Lecka mikrofibre (paketë me 10)', 4, 900), ('Qese të forta plehrash (rrotull)', 20, 260)) x(d, q, c);
select public.submit_requisition(:'rq2');
insert into purchase_requisitions (company_id, warehouse_id, required_date, justification) values (:'co', :'st', current_date + 20, 'Filxhanë për vitrinën e Krishtlindjeve në Bllok') returning id as rq3 \gset
insert into purchase_requisition_lines (company_id, requisition_id, variant_id, description, quantity, estimated_unit_cost)
select :'co', :'rq3', id, name, 48, 310 from product_variants where company_id = :'co' and sku = 'MUG-CER';
select public.submit_requisition(:'rq3');
select set_config('request.jwt.claim.sub', :'u_genta', false);
select public.decide_requisition(:'rq1', 'approved');
select public.decide_requisition(:'rq3', 'approved');
select public.create_po_from_requisition(:'rq1') as rq1_orders \gset
select (:'rq1_orders'::jsonb -> 'orders' ->> 0) as po_cm \gset

-- PO from the requisition: Caffè Milano, sent, delivery late
update purchase_orders set order_date = current_date - 26, expected_date = current_date - 4, incoterm = 'DAP', vendor_reference = 'Oferta CM-2026-118' where id = :'po_cm';
select public.submit_purchase_order(:'po_cm');
select set_config('request.jwt.claim.sub', :'u_arta', false);
select public.decide_approval((select id from approval_requests where document_id = :'po_cm' and status = 'pending'), 'approved', 'Në rregull — për menunë e vjeshtës');
select set_config('request.jwt.claim.sub', :'u_genta', false);
update purchase_orders set status = 'sent' where id = :'po_cm';

create or replace function pg_temp.po(p_date date, p_vendor text, p_lines jsonb, p_expected date default null) returns uuid language plpgsql as $$
declare co uuid := current_setting('t.co')::uuid; o uuid;
begin
  o := app.create_purchase_order(co, (select id from business_partners where company_id = co and code = p_vendor),
                                 (select id from warehouses where company_id = co and code = 'WH'), p_lines, null, p_expected, null);
  update purchase_orders set order_date = p_date where id = o;
  return o;
end $$;
create or replace function pg_temp.receive_po(p_po uuid, p_date date, p_qty jsonb default null) returns uuid language plpgsql as $$
declare g uuid; k text; v numeric;
begin
  g := public.create_receipt_from_po(p_po);
  update goods_receipts set receipt_date = p_date where id = g;
  if p_qty is not null then
    for k, v in select * from jsonb_each_text(p_qty) loop
      update goods_receipt_lines gl set quantity = v from product_variants pv where gl.receipt_id = g and pv.id = gl.variant_id and pv.sku = k;
    end loop;
  end if;
  perform public.post_goods_receipt(g);
  return g;
end $$;

-- Tekstil Durrës: received in full, billed, matched, closed
select pg_temp.po(current_date - 19, 'V002', (select jsonb_agg(jsonb_build_object('variant_id', id, 'quantity', 12)) from product_variants where company_id = :'co' and sku in ('TEE-S-WHI','TEE-M-WHI','TEE-L-WHI')), current_date - 12) as po_td \gset
select public.submit_purchase_order(:'po_td');
select set_config('request.jwt.claim.sub', :'u_besnik', false);
select pg_temp.receive_po(:'po_td', current_date - 12);
select set_config('request.jwt.claim.sub', :'u_arta', false);
select public.create_bill_from_po(:'po_td', 'TD-7791', current_date - 11) as b_td \gset
select public.post_vendor_bill(:'b_td');

-- Fermat Lushnja: received, billed 1.5% above the order (within tolerance → stock value updated)
select set_config('request.jwt.claim.sub', :'u_genta', false);
select pg_temp.po(current_date - 3, 'V003', (select jsonb_agg(jsonb_build_object('variant_id', id, 'quantity', 96)) from product_variants where company_id = :'co' and sku = 'MILK-1L'), current_date - 2) as po_fl \gset
select public.submit_purchase_order(:'po_fl');
select set_config('request.jwt.claim.sub', :'u_besnik', false);
insert into lots (company_id, variant_id, lot_number, manufacture_date, expiry_date) select :'co', id, 'ML-2610C', current_date - 2, current_date + 9 from product_variants where company_id = :'co' and sku = 'MILK-1L';
select public.create_receipt_from_po(:'po_fl') as gr_fl \gset
update goods_receipts set receipt_date = current_date - 2 where id = :'gr_fl';
update goods_receipt_lines set lot_id = (select id from lots where company_id = :'co' and lot_number = 'ML-2610C') where receipt_id = :'gr_fl';
select public.post_goods_receipt(:'gr_fl');
select set_config('request.jwt.claim.sub', :'u_arta', false);
select public.create_bill_from_po(:'po_fl', 'FL/10/2290', current_date - 1) as b_fl \gset
update vendor_bill_lines set unit_price = 93.40 where bill_id = :'b_fl';
select public.post_vendor_bill(:'b_fl');

-- Ujë Glina: 600 of 960 delivered; the bill charges all 960 → match exception waiting in drafts
select set_config('request.jwt.claim.sub', :'u_genta', false);
select pg_temp.po(current_date - 8, 'V004', (select jsonb_agg(jsonb_build_object('variant_id', id, 'quantity', 960)) from product_variants where company_id = :'co' and sku = 'WATER-05'), current_date - 5) as po_gl \gset
select public.submit_purchase_order(:'po_gl');
update purchase_orders set status = 'sent' where id = :'po_gl';
select set_config('request.jwt.claim.sub', :'u_besnik', false);
select pg_temp.receive_po(:'po_gl', current_date - 5, '{"WATER-05": 600}');
select set_config('request.jwt.claim.sub', :'u_arta', false);
select public.create_bill_from_po(:'po_gl', 'GL-10-0457', current_date - 4) as b_gl \gset
update vendor_bill_lines set quantity = 960 where bill_id = :'b_gl';
select public.match_vendor_bill(:'b_gl');

-- Tekstil Durrës big restock waiting for Arta's approval (over 100,000 ALL)
select set_config('request.jwt.claim.sub', :'u_genta', false);
select pg_temp.po(current_date - 1, 'V002', (select jsonb_agg(jsonb_build_object('variant_id', id, 'quantity', 30)) from product_variants where company_id = :'co' and sku like 'TEE-%')) as po_big \gset
update purchase_orders set notes = 'Rimbushje për koleksionin e pranverës — të gjitha masat' where id = :'po_big';
select public.submit_purchase_order(:'po_big');

-- Qeramika: requisition 3 still to be ordered; a draft PO for service work
select pg_temp.po(current_date, 'V006', '[{"description":"Pastrim i thellë i dyqanit të Bllokut","quantity":1,"unit_price":18000}]') as po_clean \gset

-- replenishment run
select set_config('request.jwt.claim.sub', :'u_besnik', false);
insert into replenishment_rules (company_id, variant_id, warehouse_id, min_qty, max_qty, multiple_qty)
select :'co', id, :'wh', 30, 96, 24 from product_variants where company_id = :'co' and sku = 'MUG-CER';
insert into replenishment_rules (company_id, variant_id, warehouse_id, min_qty, max_qty, multiple_qty, replenish_method, source_warehouse_id)
select :'co', id, :'st', 48, 144, 24, 'transfer', :'wh' from product_variants where company_id = :'co' and sku = 'WATER-05';
update replenishment_rules set min_qty = 80 where company_id = :'co' and variant_id = (select id from product_variants where company_id = :'co' and sku = 'ESP-1KG');
select set_config('request.jwt.claim.sub', :'u_genta', false);
select public.generate_replenishment(:'co');

-- =============================================================================
-- Phase 5: finance — real payments, a summarised prior year, assets, bank
-- =============================================================================
select set_config('request.jwt.claim.sub', :'u_arta', false);
select public.create_fiscal_year(:'co', extract(year from current_date)::int - 1);

insert into cost_centers (company_id, code, name) values
  (:'co', 'BLK', 'Dyqani Blloku'), (:'co', 'WH', 'Magazina dhe logjistika'), (:'co', 'ADM', 'Administrata');

-- manual journal entry: lines [{a: account code, d: debit, c: credit, cc: cost center, t: text, cur, amt}]
create or replace function pg_temp.je(p_date date, p_memo text, p_lines jsonb, p_ref text default null, p_post boolean default true) returns uuid language plpgsql as $$
declare co uuid := current_setting('t.co')::uuid; e uuid; l jsonb; n int := 0;
begin
  insert into journal_entries (company_id, journal_id, entry_date, memo, reference)
  values (co, (select id from journals where company_id = co and code = 'GEN'), p_date, p_memo, p_ref) returning id into e;
  for l in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    insert into journal_lines (company_id, entry_id, line_no, account_id, debit, credit, cost_center_id, description, currency_code, amount_currency)
    values (co, e, n, (select id from accounts where company_id = co and code = l->>'a'), coalesce((l->>'d')::numeric, 0), coalesce((l->>'c')::numeric, 0),
            (select id from cost_centers where company_id = co and code = l->>'cc'), coalesce(l->>'t', p_memo), l->>'cur', (l->>'amt')::numeric);
  end loop;
  if p_post then update journal_entries set status = 'posted' where id = e; end if;
  return e;
end $$;

-- the prior year, summarised month by month from the previous system
do $$
declare y int := extract(year from current_date)::int - 1; m int; d date; s numeric; k numeric; p numeric;
begin
  perform pg_temp.je(make_date(y, 1, 1), 'Kapitali themeltar i derdhur', '[{"a":"5121","d":3000000},{"a":"101","c":3000000}]', 'Akti i themelimit');
  for m in 1 .. 12 loop
    d := (make_date(y, m, 1) + interval '1 month' - interval '1 day')::date;
    k := 0.85 + (m % 4) * 0.06 + case when m in (7, 8, 12) then 0.25 else 0 end;
    s := round(150000 * k, -2); p := round(s * 0.76, -2);
    perform pg_temp.je(d, format('Shitje dhe blerje %s/%s (përmbledhje)', m, y), jsonb_build_array(
      jsonb_build_object('a','411','d', s * 1.2), jsonb_build_object('a','701','c', s), jsonb_build_object('a','4457','c', s * 0.2),
      jsonb_build_object('a','601','d', p), jsonb_build_object('a','4456','d', p * 0.2), jsonb_build_object('a','401','c', p * 1.2)), format('SUM-%s-%s', y, m));
    perform pg_temp.je(d, format('Shpenzime operative %s/%s (përmbledhje)', m, y), jsonb_build_array(
      jsonb_build_object('a','612','d', 4800, 'cc','BLK', 't','Qira dyqani Blloku'), jsonb_build_object('a','612','d', 2000, 'cc','WH', 't','Qira magazine'),
      jsonb_build_object('a','641','d', 4200, 'cc','BLK'), jsonb_build_object('a','641','d', 2000, 'cc','WH'), jsonb_build_object('a','641','d', 1000, 'cc','ADM'),
      jsonb_build_object('a','644','d', 1080, 'cc','ADM'), jsonb_build_object('a','614','d', 850, 'cc','BLK'), jsonb_build_object('a','614','d', 450, 'cc','WH'),
      jsonb_build_object('a','622','d', 600 + m * 20, 'cc','WH'), jsonb_build_object('a','662','d', 300, 'cc','ADM'),
      jsonb_build_object('a','5121','c', 17280 + m * 20)), format('OPX-%s-%s', y, m));
    perform pg_temp.je(d, format('Arkëtime, pagesa furnitorësh dhe TVSH %s/%s (përmbledhje)', m, y), jsonb_build_array(
      jsonb_build_object('a','5121','d', s * 1.2), jsonb_build_object('a','411','c', s * 1.2),
      jsonb_build_object('a','401','d', p * 1.2), jsonb_build_object('a','5121','c', p * 1.2),
      jsonb_build_object('a','4457','d', s * 0.2), jsonb_build_object('a','4456','c', p * 0.2), jsonb_build_object('a','5121','c', (s - p) * 0.2)), format('BNK-%s-%s', y, m));
  end loop;
  -- this year's running costs (rent, wages, utilities) paid from the bank
  for m in 1 .. extract(month from current_date)::int - 1 loop
    d := (make_date(y + 1, m, 1) + interval '1 month' - interval '1 day')::date;
    perform pg_temp.je(d, format('Qira, paga dhe shërbime komunale %s/%s', m, y + 1), jsonb_build_array(
      jsonb_build_object('a','612','d', 5000, 'cc','BLK', 't','Qira dyqani Blloku'), jsonb_build_object('a','612','d', 2000, 'cc','WH', 't','Qira magazine'),
      jsonb_build_object('a','641','d', 4500, 'cc','BLK'), jsonb_build_object('a','641','d', 2000, 'cc','WH'), jsonb_build_object('a','641','d', 1000, 'cc','ADM'),
      jsonb_build_object('a','644','d', 1125, 'cc','ADM'), jsonb_build_object('a','614','d', 900 + (m % 3) * 80, 'cc','BLK'), jsonb_build_object('a','614','d', 450, 'cc','WH'),
      jsonb_build_object('a','5121','c', 16975 + (m % 3) * 80)), format('OPX-%s-%s', y + 1, m));
  end loop;
  -- fund the EUR account at the start of the year
  perform pg_temp.je(make_date(y + 1, 1, 5), 'Transfertë në llogarinë në EUR', jsonb_build_array(
    jsonb_build_object('a','5122','d', 1004500, 'cur','EUR', 'amt', 10000), jsonb_build_object('a','5121','c', 1004500)), 'TRF-EUR-01');
end $$;

select pg_temp.settle('ar');
select pg_temp.settle('ap');
do $$
declare co uuid := current_setting('t.co')::uuid; pid uuid;
begin
  -- an advance from Klea that is not matched to an invoice yet
  insert into payments (company_id, document_type, partner_id, bank_account_id, payment_date, method, amount, reference, notes)
  values (co, 'customer_payment', (select id from business_partners where company_id = co and code = 'C005'), current_setting('t.bkt')::uuid,
          current_date - 6, 'bank_transfer', 15000, 'Paradhënie për porosinë e dhjetorit', 'Paradhënie — lidhet me faturën kur të faturohet porosia')
  returning id into pid;
  perform public.post_payment(pid);
end $$;


-- fixed assets
do $$
declare co uuid := current_setting('t.co')::uuid; y int := extract(year from current_date)::int; a uuid; bank uuid;
begin
  select id into bank from accounts where company_id = co and code = '5121';
  insert into fixed_assets (company_id, name, category_id, acquisition_date, in_service_date, acquisition_cost, salvage_value, useful_life_months, cost_center_id, serial_number, location_note)
  values (co, 'Furgon shpërndarjeje Fiat Doblò', (select fc.id from fixed_asset_categories fc join accounts x on x.id = fc.asset_account_id where fc.company_id = co and x.code = '215'),
          make_date(y - 1, 3, 10), make_date(y - 1, 3, 15), 780000, 180000, 60, (select id from cost_centers where company_id = co and code = 'WH'), 'ZFA26300006R12345', 'Oborri i magazinës')
  returning id into a; perform public.activate_fixed_asset(a, bank);
  insert into fixed_assets (company_id, name, category_id, acquisition_date, in_service_date, acquisition_cost, salvage_value, useful_life_months, cost_center_id, location_note)
  values (co, 'Rafte dhe banakë — dyqani Blloku', (select fc.id from fixed_asset_categories fc join accounts x on x.id = fc.asset_account_id where fc.company_id = co and x.code = '218'),
          make_date(y - 1, 6, 1), make_date(y - 1, 6, 1), 180000, 0, 84, (select id from cost_centers where company_id = co and code = 'BLK'), 'Dyqani Blloku')
  returning id into a; perform public.activate_fixed_asset(a, bank);
  insert into fixed_assets (company_id, name, category_id, acquisition_date, in_service_date, acquisition_cost, salvage_value, useful_life_months, cost_center_id, depreciation_method, declining_rate_pct, location_note)
  values (co, 'Laptopë (3) për zyrën', (select fc.id from fixed_asset_categories fc join accounts x on x.id = fc.asset_account_id where fc.company_id = co and x.code = '218'),
          make_date(y, 2, 15), make_date(y, 2, 15), 135000, 10000, 36, (select id from cost_centers where company_id = co and code = 'ADM'), 'declining_balance', 40, 'Zyra qendrore')
  returning id into a; perform public.activate_fixed_asset(a, bank);
  insert into fixed_assets (company_id, name, category_id, acquisition_date, in_service_date, acquisition_cost, salvage_value, useful_life_months, cost_center_id, serial_number)
  values (co, 'Terminal kartash Ingenico Move/5000', (select fc.id from fixed_asset_categories fc join accounts x on x.id = fc.asset_account_id where fc.company_id = co and x.code = '213'),
          make_date(y - 1, 1, 20), make_date(y - 1, 1, 20), 48000, 0, 36, (select id from cost_centers where company_id = co and code = 'BLK'), '219-458-771')
  returning id into a; perform public.activate_fixed_asset(a, bank);
  perform public.dispose_fixed_asset(a, make_date(y, 9, 30), 18000, bank);
  insert into fixed_assets (company_id, name, category_id, acquisition_date, in_service_date, acquisition_cost, salvage_value, useful_life_months, cost_center_id, vendor_id)
  values (co, 'Mulli kafeje Mahlkönig E65S', (select fc.id from fixed_asset_categories fc join accounts x on x.id = fc.asset_account_id where fc.company_id = co and x.code = '213'),
          current_date - 3, current_date - 3, 145000, 10000, 60, (select id from cost_centers where company_id = co and code = 'BLK'),
          (select id from business_partners where company_id = co and code = 'V001'));
  perform public.run_depreciation(co, (date_trunc('month', current_date) - interval '1 day')::date);
end $$;

-- bank statements: September reconciled, this month imported and waiting
do $$
declare co uuid := current_setting('t.co')::uuid; bkt uuid := current_setting('t.bkt')::uuid; acc uuid; st uuid; m0 date; m1 date; open numeric; total numeric;
        fee uuid; ref record;
begin
  select account_id into acc from bank_accounts where id = bkt;
  for m0, m1 in select (date_trunc('month', current_date) - interval '1 month')::date, (date_trunc('month', current_date) - interval '1 day')::date
                union all select date_trunc('month', current_date)::date, current_date - 1 loop
    select coalesce(sum(jl.debit - jl.credit), 0) into open from journal_lines jl join journal_entries e on e.id = jl.entry_id
     where jl.account_id = acc and e.status in ('posted','reversed') and e.entry_date < m0;
    insert into bank_statements (company_id, bank_account_id, statement_date, reference, opening_balance, closing_balance)
    values (co, bkt, m1, 'BKT ' || to_char(m1, 'MM/YYYY'), open, open) returning id into st;
    insert into bank_statement_lines (company_id, statement_id, transaction_date, description, reference, amount, counterparty_name)
    select co, st, e.entry_date + case when p.id is not null and p.document_type = 'customer_payment' then 1 else 0 end,
           coalesce(case when p.id is not null then case p.document_type when 'customer_payment' then 'Transfertë hyrëse ' else 'Transfertë dalëse ' end || coalesce(p.reference, '') end, e.memo),
           coalesce(p.number, e.reference), jl.debit - jl.credit, bp.name
      from journal_lines jl join journal_entries e on e.id = jl.entry_id
      left join payments p on p.id = e.source_doc_id and e.source_doc_type in ('customer_payment','vendor_payment')
      left join business_partners bp on bp.id = p.partner_id
     where jl.account_id = acc and e.status = 'posted' and e.entry_date between m0 and m1 and jl.debit <> jl.credit
       and (e.entry_date + case when p.id is not null and p.document_type = 'customer_payment' then 1 else 0 end) <= m1;
    insert into bank_statement_lines (company_id, statement_id, transaction_date, description, amount)
    values (co, st, m1 - case when m1 = current_date - 1 then 2 else 0 end, 'Komision mirëmbajtjeje llogarie', -350);
    if m1 = current_date - 1 then
      -- Komiteti paid its overdue invoice; nobody has recorded it yet
      select i.number, i.total, i.partner_id, bp.name into ref from sales_invoices i join business_partners bp on bp.id = i.partner_id
       where i.company_id = co and i.payment_status = 'unpaid' and bp.code = 'C003' order by i.invoice_date limit 1;
      if ref.number is not null then
        insert into bank_statement_lines (company_id, statement_id, transaction_date, description, reference, amount, counterparty_name, partner_id)
        values (co, st, current_date - 2, 'Transfertë hyrëse — pagesë e ' || ref.number, ref.number, ref.total, ref.name, ref.partner_id);
      end if;
      insert into bank_statement_lines (company_id, statement_id, transaction_date, description, amount) values (co, st, current_date - 1, 'Interes mbi depozitat', 412.50);
    end if;
    select coalesce(sum(amount), 0) into total from bank_statement_lines where statement_id = st;
    update bank_statements set closing_balance = open + total where id = st;
    if m1 < date_trunc('month', current_date) then
      perform public.auto_match_statement(st);
      select id into fee from bank_statement_lines where statement_id = st and match_status = 'unmatched' and description = 'Komision mirëmbajtjeje llogarie';
      perform public.book_statement_line(fee, (select id from accounts where company_id = co and code = '662'), 'Komision bankar ' || to_char(m1, 'MM/YYYY'));
      perform public.reconcile_statement(st);
    end if;
  end loop;
end $$;

-- a draft accrual waiting for review
select pg_temp.je(current_date, 'Përllogaritje: energjia e tetorit (fatura s’ka ardhur ende)',
  '[{"a":"614","d":1400,"cc":"BLK"},{"a":"614","d":800,"cc":"WH"},{"a":"4081","c":2200,"t":"Shërbime komunale të përllogaritura"}]', 'ACR-10', false);

-- last year is closed; this year's first half too
update fiscal_periods set status = 'closed' where company_id = :'co' and end_date < make_date(extract(year from current_date)::int, 7, 1);
update fiscal_years set status = 'closed' where company_id = :'co' and end_date < make_date(extract(year from current_date)::int, 1, 1);

-- =============================================================================
-- Phase 6: warehouse floor + point of sale
-- =============================================================================
select set_config('request.jwt.claim.sub', :'u_arta', false);
select pg_temp.demo_user('mira@ylli.al', 'Mira Leka');
select pg_temp.demo_user('ardit@ylli.al', 'Ardit Gjoka');
select public.invite_member(:'co', 'mira@ylli.al', array['pos_cashier']);
select public.invite_member(:'co', 'ardit@ylli.al', array['pos_cashier']);
update company_members set status = 'active', user_id = u.id from auth.users u
 where company_members.company_id = :'co' and lower(company_members.invited_email) = u.email and company_members.user_id is null;
select id as u_mira from auth.users where email = 'mira@ylli.al' \gset
select id as u_ardit from auth.users where email = 'ardit@ylli.al' \gset

-- more bins in the main warehouse, each with a scannable label
insert into warehouse_locations (company_id, warehouse_id, code, name, location_type, barcode) values
  (:'co', :'wh', 'WH/A-02', 'Rreshti A, rafti 2', 'internal', 'LOC-A02'),
  (:'co', :'wh', 'WH/B-01', 'Rreshti B, rafti 1', 'internal', 'LOC-B01'),
  (:'co', :'wh', 'WH/B-02', 'Rreshti B, rafti 2', 'internal', 'LOC-B02'),
  (:'co', :'wh', 'WH/C-01', 'Dhoma frigoriferike', 'internal', 'LOC-C01');
update warehouse_locations set barcode = 'LOC-STOCK' where company_id = :'co' and code = 'WH/STOCK';
update warehouse_locations set barcode = 'LOC-RECV' where company_id = :'co' and code = 'WH/RECEIVING';
update warehouse_locations set barcode = 'LOC-TR1F' where company_id = :'co' and code = 'TR1/FLOOR';

-- the store gets coffee, milk and T-shirts for the tills
insert into stock_transfers (company_id, from_warehouse_id, to_warehouse_id, transfer_date) values (:'co', :'wh', :'st', current_date - 2) returning id as trf2 \gset
insert into stock_transfer_lines (company_id, transfer_id, variant_id, from_location_id, to_location_id, quantity, lot_id)
select :'co', :'trf2', v.id, :'stock', :'floor', x.q, null from product_variants v, (values ('ESP-1KG', 20), ('TEE-L-NAV', 6), ('TEE-S-NAV', 5), ('TEE-L-WHI', 6), ('MUG-CER', 4)) x(sku, q)
 where v.company_id = :'co' and v.sku = x.sku;
insert into stock_transfer_lines (company_id, transfer_id, variant_id, from_location_id, to_location_id, quantity, lot_id)
select :'co', :'trf2', sl.variant_id, :'stock', :'floor', sl.on_hand, sl.lot_id
  from stock_levels sl join product_variants v on v.id = sl.variant_id where sl.location_id = :'stock' and v.sku = 'MILK-1L' and sl.on_hand > 0;
select public.post_stock_transfer(:'trf2');

-- registers: drawers post to 5311 and are emptied into the cash box (531) at closing
insert into bank_accounts (company_id, name, account_kind, currency_code, account_id, journal_id)
select :'co', 'Sirtarët e arkave — Blloku', 'cash', 'ALL', (select id from accounts where company_id = :'co' and code = '5311'), (select id from journals where company_id = :'co' and code = 'POS');
insert into pos_registers (company_id, code, name, warehouse_id, location_id, cash_account_id, journal_id, receipt_header, receipt_footer)
select :'co', x.code, x.name, :'st', :'floor', (select id from bank_accounts where company_id = :'co' and name = 'Sirtarët e arkave — Blloku'),
       (select id from journals where company_id = :'co' and code = 'POS'), 'Rr. Pjetër Bogdani 12, Blloku, Tiranë · tel. 04 222 1100', 'Faleminderit! Kthimet pranohen brenda 14 ditëve me faturë.'
  from (values ('T1', 'Arka 1 — Blloku'), ('T2', 'Arka 2 — Blloku')) x(code, name);
select id as t1 from pos_registers where company_id = :'co' and code = 'T1' \gset
select id as t2 from pos_registers where company_id = :'co' and code = 'T2' \gset

-- one sale through the same RPC the till calls; cash is handed over rounded up to the next 100
create or replace function pg_temp.pos_sale(p_session uuid, p_items text, p_method text, p_at timestamptz, p_disc numeric default 0, p_customer text default null)
returns jsonb language plpgsql as $$
declare reg uuid; lines jsonb := '[]'::jsonb; it text; v_sku text; q numeric; c record; total numeric := 0; paid numeric; res jsonb;
begin
  select register_id into reg from pos_sessions where id = p_session;
  foreach it in array string_to_array(p_items, ',') loop
    v_sku := split_part(it, ':', 1); q := coalesce(nullif(split_part(it, ':', 2), '')::numeric, 1);
    select * into c from public.pos_catalog(reg) x where x.sku = v_sku;
    lines := lines || jsonb_build_object('variant_id', c.variant_id, 'quantity', q, 'unit_price', c.price, 'discount_pct', p_disc, 'description', c.name);
    total := total + round(q * c.price * (1 - p_disc / 100), 2);
  end loop;
  paid := case when p_method = 'cash' then ceil(total / 100) * 100 else total end;
  res := public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', p_session, 'order_at', p_at, 'lines', lines,
           'partner_id', (select id from business_partners where code = p_customer and company_id = current_setting('t.co')::uuid),
           'payments', jsonb_build_array(jsonb_build_object('method', p_method, 'amount', paid))));
  return res;
end $$;

-- a day of trading: n receipts between 08:30 and 20:00
create or replace function pg_temp.trade(p_session uuid, p_day date, p_n int, p_seed int) returns void language plpgsql as $$
declare i int; baskets text[] := array['ESP-1KG', 'MILK-1L:2', 'WATER-05:6', 'MUG-CER', 'ESP-1KG,MILK-1L:2', 'TEE-L-NAV', 'WATER-05:12',
                                       'MILK-1L,WATER-05:2', 'TEE-S-WHI', 'MUG-CER:2,ESP-1KG', 'WATER-05:3', 'TEE-L-WHI,TEE-S-NAV', 'MILK-1L'];
        methods text[] := array['cash', 'cash', 'card', 'cash', 'card', 'cash', 'card'];
begin
  perform setseed(p_seed / 100.0);
  for i in 1 .. p_n loop
    perform pg_temp.pos_sale(p_session, baskets[1 + floor(random() * array_length(baskets, 1))::int], methods[1 + floor(random() * array_length(methods, 1))::int],
                             p_day + time '08:30' + (i * (690.0 / p_n) || ' minutes')::interval, case when i % 9 = 0 then 5 else 0 end);
  end loop;
end $$;

-- yesterday on till 1 (Mira): a full day, a refund, cash banked mid-day, 200 short at closing
select set_config('request.jwt.claim.sub', :'u_mira', false);
select public.open_pos_session(:'t1', 10000) as s_y \gset
select pg_temp.trade(:'s_y', current_date - 1, 28, 11);
select pg_temp.pos_sale(:'s_y', 'ESP-1KG:2,MUG-CER', 'card', (current_date - 1) + time '10:12', 0, 'C005');
select public.pos_cash_move(:'s_y', 'cash_out', 15000, 'Para të derdhura në BKT në mesditë');
select id as o_ref from pos_orders where session_id = :'s_y' and not is_refund order by order_at limit 1 offset 3 \gset
select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', :'s_y', 'order_at', (current_date - 1) + time '17:40', 'is_refund', true, 'refund_of_id', :'o_ref',
  'lines', (select jsonb_agg(jsonb_build_object('variant_id', variant_id, 'quantity', -quantity, 'unit_price', unit_price, 'discount_pct', discount_pct)) from pos_order_lines where pos_order_id = :'o_ref' and line_no = 1),
  'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', -(select line_total from pos_order_lines where pos_order_id = :'o_ref' and line_no = 1)))));
select public.close_pos_session(:'s_y', (select (pos_session_summary(:'s_y')->>'expected_cash')::numeric - 200), 'Mungesë 200 — ndoshta kusuri u dha dy herë në një pasdite të ngarkuar');
-- move yesterday's session to yesterday (demo only: the functions always stamp "now")
set session_replication_role = replica;
update pos_sessions set opened_at = (current_date - 1) + time '08:05', closed_at = (current_date - 1) + time '20:20' where id = :'s_y';
update z_reports set report_date = current_date - 1, created_at = (current_date - 1) + time '20:20' where session_id = :'s_y';
update journal_entries set entry_date = current_date - 1 where source_doc_type = 'pos_session' and source_doc_id = :'s_y';
update pos_cash_movements set created_at = (current_date - 1) + time '12:10' where session_id = :'s_y';
set session_replication_role = origin;

-- this morning on till 2 (Ardit), closed and balanced
select set_config('request.jwt.claim.sub', :'u_ardit', false);
select public.open_pos_session(:'t2', 5000) as s_m \gset
select pg_temp.trade(:'s_m', current_date, 9, 23);
select public.close_pos_session(:'s_m', (select (pos_session_summary(:'s_m')->>'expected_cash')::numeric), null);

-- till 1 is open now with a few sales already
select set_config('request.jwt.claim.sub', :'u_mira', false);
select public.open_pos_session(:'t1', 10000) as s_now \gset
select pg_temp.pos_sale(:'s_now', 'ESP-1KG,MILK-1L:2', 'cash', now() - interval '50 minutes');
select pg_temp.pos_sale(:'s_now', 'WATER-05:6', 'card', now() - interval '35 minutes');
select pg_temp.pos_sale(:'s_now', 'TEE-L-NAV', 'card', now() - interval '12 minutes');

-- warehouse floor: Spar's order is released for picking, a count of the main bin is half done
select set_config('request.jwt.claim.sub', :'u_arta', false);
select public.create_delivery_from_order(id) as dl_spar from sales_orders where company_id = :'co' and number = 'SO-2026-00002' \gset
select public.create_pick_list(array[:'dl_spar']::uuid[]);
select set_config('request.jwt.claim.sub', :'u_besnik', false);
select public.create_cycle_count(:'wh', array[:'stock']::uuid[], null, true) as cc \gset
select public.count_item(:'cc', v.id, :'stock', x.q, null, true) from product_variants v join (values ('TEE-L-NAV', 14), ('TEE-S-NAV', 10), ('TEE-L-WHI', 14)) x(sku, q) on x.sku = v.sku where v.company_id = :'co';

-- =============================================================================
-- Phase 7: the roastery — green coffee → roasted blend → packs → gift sets
-- =============================================================================
select set_config('request.jwt.claim.sub', :'u_arta', false);
select pg_temp.demo_user('klodian@ylli.al', 'Klodian Meta');
select public.invite_member(:'co', 'klodian@ylli.al', array['production_manager']);
update company_members set status = 'active', user_id = u.id from auth.users u
 where company_members.company_id = :'co' and lower(company_members.invited_email) = u.email and company_members.user_id is null;
select id as u_klodian from auth.users where email = 'klodian@ylli.al' \gset

insert into product_categories (company_id, name, code, inventory_account_id)
select :'co', 'Lëndë të para dhe ambalazh', 'RAW', id from accounts where company_id = :'co' and code = '321';
insert into business_partners (company_id, code, name, is_vendor, tax_number) values (:'co', 'V007', 'Rio Verde Green Coffee', true, 'L72318004P');
insert into warehouse_locations (company_id, warehouse_id, code, name, barcode) values (:'co', :'wh', 'WH/R-01', 'Pjekësja — kafe jeshile', 'LOC-R01');

do $$
declare co uuid := current_setting('t.co')::uuid; kg uuid; pcs uuid; raw uuid; cof uuid; vat20 uuid := current_setting('t.vat20')::uuid;
begin
  select id into kg from units_of_measure where company_id = co and code = 'kg';
  select id into pcs from units_of_measure where company_id = co and code = 'pcs';
  select id into raw from product_categories where company_id = co and code = 'RAW';
  select id into cof from product_categories where company_id = co and code = 'COF';
  perform public.create_product(jsonb_build_object('company_id', co, 'code', 'GREEN-BR', 'name', 'Kafe jeshile Brazil Santos', 'uom_id', kg, 'category_id', raw, 'tracking', 'lot', 'is_sellable', false, 'purchase_tax_code_id', vat20));
  perform public.create_product(jsonb_build_object('company_id', co, 'code', 'GREEN-ET', 'name', 'Kafe jeshile Etiopi Sidamo', 'uom_id', kg, 'category_id', raw, 'tracking', 'lot', 'is_sellable', false, 'purchase_tax_code_id', vat20));
  perform public.create_product(jsonb_build_object('company_id', co, 'code', 'BAG-1KG', 'name', 'Qese me valvul 1 kg', 'uom_id', pcs, 'category_id', raw, 'is_sellable', false, 'purchase_tax_code_id', vat20));
  perform public.create_product(jsonb_build_object('company_id', co, 'code', 'BAG-250', 'name', 'Qese me valvul 250 g', 'uom_id', pcs, 'category_id', raw, 'is_sellable', false, 'purchase_tax_code_id', vat20));
  perform public.create_product(jsonb_build_object('company_id', co, 'code', 'LABEL-HB', 'name', 'Etiketë "Përzierja Ylli"', 'uom_id', pcs, 'category_id', raw, 'is_sellable', false, 'purchase_tax_code_id', vat20));
  perform public.create_product(jsonb_build_object('company_id', co, 'code', 'BOX-GIFT', 'name', 'Kuti dhurate kraft', 'uom_id', pcs, 'category_id', raw, 'is_sellable', false, 'purchase_tax_code_id', vat20));
  perform public.create_product(jsonb_build_object('company_id', co, 'code', 'ROAST-HB', 'name', 'Përzierja Ylli e pjekur (rinfuzë)', 'uom_id', kg, 'category_id', cof, 'tracking', 'lot', 'track_expiry', true, 'is_sellable', false, 'is_purchasable', false));
  perform public.create_product(jsonb_build_object('company_id', co, 'code', 'HB-1KG', 'name', 'Espresso Përzierja Ylli 1 kg', 'uom_id', pcs, 'category_id', cof, 'tracking', 'lot', 'track_expiry', true,
    'is_purchasable', false, 'sales_price', 2900, 'sales_tax_code_id', vat20, 'weight_kg', 1.03, 'generate_barcode', true));
  perform public.create_product(jsonb_build_object('company_id', co, 'code', 'HB-250', 'name', 'Përzierja Ylli 250 g', 'uom_id', pcs, 'category_id', cof, 'tracking', 'lot', 'track_expiry', true,
    'is_purchasable', false, 'sales_price', 850, 'sales_tax_code_id', vat20, 'weight_kg', 0.27, 'generate_barcode', true));
  perform public.create_product(jsonb_build_object('company_id', co, 'code', 'GIFT-SET', 'name', 'Set dhurate me kafe (250 g + filxhan)', 'uom_id', pcs, 'category_id', cof,
    'is_purchasable', false, 'sales_price', 2200, 'sales_tax_code_id', vat20, 'generate_barcode', true));
  -- planning costs for materials not received yet
  update product_variants pv set standard_cost = x.c from (values ('BOX-GIFT', 140)) x(s, c) where pv.company_id = co and pv.sku = x.s;
end $$;

-- green coffee lots from Brazil and Ethiopia, packaging in bulk
insert into lots (company_id, variant_id, lot_number, expiry_date, vendor_id)
select :'co', v.id, x.lot, current_date + x.days, (select id from business_partners where company_id = :'co' and code = 'V007')
  from (values ('GREEN-BR', 'BR-24-118', 300), ('GREEN-BR', 'BR-24-131', 420), ('GREEN-ET', 'ET-24-052', 360)) x(sku, lot, days)
  join product_variants v on v.sku = x.sku and v.company_id = :'co';
select pg_temp.receive(current_date - 21, 'V007', '[{"sku":"GREEN-BR","qty":60,"price":640,"lot":"BR-24-118","loc":"WH/R-01"},{"sku":"GREEN-ET","qty":30,"price":890,"lot":"ET-24-052","loc":"WH/R-01"}]');
select pg_temp.receive(current_date - 6, 'V007', '[{"sku":"GREEN-BR","qty":40,"price":665,"lot":"BR-24-131","loc":"WH/R-01"}]');
select pg_temp.receive(current_date - 20, 'V006', '[{"sku":"BAG-1KG","qty":200,"price":38},{"sku":"BAG-250","qty":300,"price":21},{"sku":"LABEL-HB","qty":500,"price":6}]');

-- work centers and BOMs, made by the production manager
select set_config('request.jwt.claim.sub', :'u_klodian', false);
insert into work_centers (company_id, code, name, warehouse_id, cost_per_hour, overhead_per_hour, capacity_hours_per_day) values
  (:'co', 'ROAST', 'Furra e pjekjes Probat 15 kg', :'wh', 900, 1100, 7),
  (:'co', 'PACK', 'Tavolina e paketimit', :'wh', 650, 180, 8),
  (:'co', 'ASSY', 'Montimi i dhuratave', :'wh', 650, 120, 4);
create or replace function pg_temp.bom(p_code text, p_sku text, p_name text, p_qty numeric, p_lines jsonb, p_ops jsonb) returns uuid language sql as $$
  select public.save_document('boms',
    jsonb_build_object('company_id', current_setting('t.co')::uuid, 'code', p_code, 'name', p_name, 'quantity', p_qty,
                       'variant_id', (select id from product_variants where company_id = current_setting('t.co')::uuid and sku = p_sku)),
    jsonb_build_object(
      'bom_lines', (select jsonb_agg(jsonb_build_object('line_no', n, 'quantity', (l->>'qty')::numeric, 'scrap_pct', coalesce((l->>'scrap')::numeric, 0),
                     'component_variant_id', (select id from product_variants where company_id = current_setting('t.co')::uuid and sku = l->>'sku')) order by n)
                      from jsonb_array_elements(p_lines) with ordinality t(l, n)),
      'bom_operations', coalesce((select jsonb_agg(jsonb_build_object('sequence', o->>'seq', 'name', o->>'name', 'setup_minutes', coalesce((o->>'setup')::numeric, 0),
                     'run_minutes_per_unit', (o->>'run')::numeric, 'instructions', o->>'note',
                     'work_center_id', (select id from work_centers where company_id = current_setting('t.co')::uuid and code = o->>'wc')))
                      from jsonb_array_elements(p_ops) o), '[]'::jsonb)))
$$;
select pg_temp.bom('BOM-ROAST-HB', 'ROAST-HB', 'Pjekja e Përzierjes Ylli, ngarkesë 12 kg', 12,
  '[{"sku":"GREEN-BR","qty":9},{"sku":"GREEN-ET","qty":5.4}]',
  '[{"seq":10,"name":"Pjekja","wc":"ROAST","setup":20,"run":4,"note":"Ngarko 14,4 kg në 200 °C, shkarko në 216 °C (city+). Ftoh 4 min. Humbje peshe rreth 17%."}]') as b_roast \gset
select pg_temp.bom('BOM-HB-1KG', 'HB-1KG', 'Përzierja Ylli, paketë 1 kg', 1,
  '[{"sku":"ROAST-HB","qty":1,"scrap":1},{"sku":"BAG-1KG","qty":1},{"sku":"LABEL-HB","qty":1}]',
  '[{"seq":10,"name":"Peshim, mbushje dhe mbyllje","wc":"PACK","setup":10,"run":1.5}]') as b_1kg \gset
select pg_temp.bom('BOM-HB-250', 'HB-250', 'Përzierja Ylli, paketë 250 g', 1,
  '[{"sku":"ROAST-HB","qty":0.25,"scrap":1},{"sku":"BAG-250","qty":1},{"sku":"LABEL-HB","qty":1}]',
  '[{"seq":10,"name":"Peshim, mbushje dhe mbyllje","wc":"PACK","setup":10,"run":1}]') as b_250 \gset
select pg_temp.bom('BOM-GIFT', 'GIFT-SET', 'Set dhurate për Krishtlindje', 1,
  '[{"sku":"HB-250","qty":1},{"sku":"MUG-CER","qty":1},{"sku":"BOX-GIFT","qty":1}]',
  '[{"seq":10,"name":"Montim dhe paketim","wc":"ASSY","setup":5,"run":3}]') as b_gift \gset

-- history: two roasts, packing runs, then moved back in time (demo only: the functions always stamp "now")
create or replace function pg_temp.backdate_wo(p_wo uuid, p_days int) returns void language plpgsql as $$
declare d interval := make_interval(days => p_days);
begin
  set local session_replication_role = replica;
  update work_orders set planned_start = planned_start - d, planned_end = planned_end - d, actual_start = actual_start - d, actual_end = actual_end - d,
                         released_at = released_at - d, closed_at = closed_at - d, created_at = created_at - d where id = p_wo;
  update work_order_operations set started_at = started_at - d, finished_at = finished_at - d where work_order_id = p_wo;
  update work_order_consumptions set consumed_at = consumed_at - d where work_order_id = p_wo;
  update production_outputs set produced_at = produced_at - d where work_order_id = p_wo;
  update stock_movements set movement_date = movement_date - d where source_doc_type = 'work_order' and source_doc_id = p_wo;
  update journal_entries set entry_date = entry_date - p_days where source_doc_type = 'work_order' and source_doc_id = p_wo;
  update lots set manufacture_date = manufacture_date - p_days where id = (select output_lot_id from work_orders where id = p_wo);
  update entity_activities set occurred_at = occurred_at - d where entity_type = 'work_orders' and entity_id = p_wo;
end $$;

-- roast 1 (12 days ago): 24 kg in two batches, a little over on time
select public.create_work_order(jsonb_build_object('bom_id', :'b_roast', 'quantity', 24, 'component_location_id', (select id from warehouse_locations where company_id = :'co' and code = 'WH/R-01'))) as wo1 \gset
select public.release_work_order(:'wo1');
select public.consume_materials(:'wo1');
select public.record_operation(id, 128, true) from work_order_operations where work_order_id = :'wo1';
select public.produce(:'wo1', 24, 'R-2610-01', current_date + 168, 0, false);
select public.close_work_order(:'wo1');
select pg_temp.backdate_wo(:'wo1', 12);

-- packing runs from that roast (11 and 10 days ago)
select public.create_work_order(jsonb_build_object('bom_id', :'b_1kg', 'quantity', 14)) as wo2 \gset
select public.release_work_order(:'wo2');
select public.produce(:'wo2', 14, 'HB1-2610-01', current_date + 170);
select public.close_work_order(:'wo2');
select pg_temp.backdate_wo(:'wo2', 11);
select public.create_work_order(jsonb_build_object('bom_id', :'b_250', 'quantity', 36)) as wo3 \gset
select public.release_work_order(:'wo3');
select public.produce(:'wo3', 20, 'HB250-2610-01', current_date + 170);
select public.produce(:'wo3', 15, null, null, 1);     -- one bag split on the sealer
select public.complete_work_order(:'wo3');
select public.close_work_order(:'wo3');
select pg_temp.backdate_wo(:'wo3', 10);

-- roast 2 is on the roaster now: green coffee in, first batch done
select public.create_work_order(jsonb_build_object('bom_id', :'b_roast', 'quantity', 24, 'priority', 2,
       'component_location_id', (select id from warehouse_locations where company_id = :'co' and code = 'WH/R-01'))) as wo4 \gset
select public.release_work_order(:'wo4');
select public.consume_materials(:'wo4');
select public.record_operation(id, 62, false) from work_order_operations where work_order_id = :'wo4';
update work_orders set planned_start = now() - interval '3 hours', planned_end = now() + interval '2 hours', actual_start = now() - interval '2 hours' where id = :'wo4';

-- 1 kg packs for Rogner's Christmas order are released, waiting for the roast
select public.create_work_order(jsonb_build_object('bom_id', :'b_1kg', 'quantity', 20, 'priority', 2,
       'planned_start', (current_date + case when extract(isodow from current_date + 1) = 7 then 2 else 1 end) + time '08:00', 'notes', 'Hotel Rogner — banketet e Krishtlindjeve')) as wo5 \gset
select public.release_work_order(:'wo5');

-- gift sets for December: planned, with the 250 g packs it needs as its own order
select public.create_work_order(jsonb_build_object('bom_id', :'b_gift', 'quantity', 40, 'make_subassemblies', true, 'priority', 3,
       'planned_start', (current_date + case when extract(isodow from current_date + 4) = 7 then 5 else 4 end) + time '08:00', 'notes', 'Vitrina e Krishtlindjeve, dyqani Blloku')) as wo6 \gset

-- planning rules: keep packs on the shelf
select set_config('request.jwt.claim.sub', :'u_arta', false);
insert into replenishment_rules (company_id, variant_id, warehouse_id, min_qty, max_qty, multiple_qty, replenish_method)
select :'co', v.id, :'wh', x.mn, x.mx, x.mul, 'manufacture' from product_variants v join (values ('HB-1KG', 10, 30, 1), ('HB-250', 24, 60, 12)) x(sku, mn, mx, mul) on x.sku = v.sku
 where v.company_id = :'co';

-- =============================================================================
-- Phase 8: people & payroll, VAT books and declarations, fiscalization,
--          logistics, web shop, replenishment automation, admin
-- =============================================================================
select set_config('request.jwt.claim.sub', :'u_arta', false);
select pg_temp.demo_user('vjosa@ylli.al', 'Vjosa Dema');
select pg_temp.demo_user('florian@ylli.al', 'Florian Hysa');
select public.invite_member(:'co', 'vjosa@ylli.al', array['hr_manager']);
select public.invite_member(:'co', 'florian@ylli.al', array['logistics_manager']);
select id as u_vjosa from auth.users where email = 'vjosa@ylli.al' \gset
select id as u_florian from auth.users where email = 'florian@ylli.al' \gset
update auth.users set last_sign_in_at = now() - (random() * interval '5 days') where email like '%@ylli.al';
update auth.users set last_sign_in_at = now() - interval '20 minutes' where email = 'arta@ylli.al';

-- fiscal codes registered with the tax administration (test environment)
update company_settings set fiscal_business_unit_code = 'xb123cd456', fiscal_software_code = 'ss123ss123', fiscal_maintainer_code = 'mm123mm123',
       auto_replenish_enabled = true, auto_replenish_action = 'draft_po' where company_id = :'co';
update pos_registers set fiscal_tcr_code = case code when 'T1' then 'pq123rs456' else 'pq123rs457' end where company_id = :'co';
insert into fiscal_tcrs (company_id, tcr_code, business_unit_code, name, register_id, valid_from)
select :'co', fiscal_tcr_code, 'xb123cd456', name, id, '2026-01-01' from pos_registers where company_id = :'co';
update fiscalization_records f set request_payload = app.fiscal_payload(f.company_id, f.source_doc_type, f.source_doc_id),
       iic = upper(md5(app.fiscal_payload(f.company_id, f.source_doc_type, f.source_doc_id) ->> 'iic_input')),
       tcr_code = app.fiscal_payload(f.company_id, f.source_doc_type, f.source_doc_id) ->> 'tcr', business_unit_code = 'xb123cd456', software_code = 'ss123ss123'
 where f.company_id = :'co';

-- weights and addresses for delivery planning
update product_variants v set weight_kg = x.kg from (values ('WATER-05', 0.52), ('MILK-1L', 1.05), ('ESP-1KG', 1.05), ('HB-1KG', 1.05), ('HB-250', 0.27),
                                                            ('MUG-CER', 0.40), ('GIFT-SET', 0.85)) x(sku, kg)
 where v.company_id = :'co' and v.sku = x.sku;
update product_variants set weight_kg = 0.2 where company_id = :'co' and sku like 'TEE-%';
insert into partner_addresses (company_id, partner_id, address_type, line1, city, postal_code, is_default, latitude, longitude)
select :'co', p.id, 'shipping', x.l, x.c, x.z, true, x.lat, x.lon from business_partners p join (values
  ('C002', 'Rruga Mustafa Matohiti 12', 'Tiranë', '1001', 41.3237, 19.8228), ('C003', 'Rruga Abdi Toptani 4', 'Tiranë', '1001', 41.3268, 19.8222),
  ('C005', 'Lagjia 13, Rruga Taulantia 21', 'Durrës', '2001', 41.3130, 19.4460)) x(code, l, c, z, lat, lon) on x.code = p.code
 where p.company_id = :'co' and not exists (select 1 from partner_addresses a where a.partner_id = p.id and a.deleted_at is null);
update partner_addresses set latitude = 41.3275, longitude = 19.8187, postal_code = '1001' where company_id = :'co' and line1 like 'Bulevardi%';
update partner_addresses set latitude = 41.3176, longitude = 19.7910, postal_code = '1023' where company_id = :'co' and line1 like 'Rruga Kavajës%';

-- ---------- service revenue: private-label roasting for Prishtina (exported, 0 %), machine service for Rogner ----------
select set_config('request.jwt.claim.sub', :'u_arta', false);
do $$
declare co uuid := current_setting('t.co')::uuid; m int; d date; i uuid; k numeric;
begin
  for m in 7 .. 10 loop
    d := make_date(2026, m, 1);
    k := 1 + (m - 7) * 0.05;
    -- Prishtina Coffee: roasting and packing its own-label coffee, invoiced in EUR, exported (0 %)
    insert into sales_invoices (company_id, partner_id, invoice_date, due_date, currency_code, exchange_rate, salesperson_id)
    values (co, (select id from business_partners where company_id = co and code = 'C006'), d + 5, d + 35, 'EUR',
            coalesce((select rate from exchange_rates where company_id = co and currency_code = 'EUR' and rate_date <= d + 5 order by rate_date desc limit 1), 100),
            current_setting('t.elira')::uuid) returning id into i;
    insert into sales_invoice_lines (company_id, invoice_id, line_no, description, quantity, unit_price, tax_code_id, account_id) values
      (co, i, 1, 'Pjekje dhe paketim me markën e klientit, kg', round(1500 * k), 4.6, (select id from tax_codes where company_id = co and code = 'VAT0'), (select id from accounts where company_id = co and code = '704')),
      (co, i, 2, 'Zhvillim përzierjeje dhe kontroll cilësie', 1, 1200, (select id from tax_codes where company_id = co and code = 'VAT0'), (select id from accounts where company_id = co and code = '704'));
    perform public.post_sales_invoice(i);
    if m < 10 then insert into to_pay values (i, 'ar', 18); end if;
    -- Hotel Rogner: espresso machine rental and maintenance contract
    insert into sales_invoices (company_id, partner_id, invoice_date, due_date, currency_code, salesperson_id)
    values (co, (select id from business_partners where company_id = co and code = 'C001'), d + 1, d + 31, 'ALL', current_setting('t.dritan')::uuid) returning id into i;
    insert into sales_invoice_lines (company_id, invoice_id, line_no, description, quantity, unit_price, tax_code_id, account_id) values
      (co, i, 1, 'Qira makinash espresso (6 makina)', 6, 38000, (select id from tax_codes where company_id = co and code = 'VAT20'), (select id from accounts where company_id = co and code = '704')),
      (co, i, 2, 'Mirëmbajtje dhe asistencë për baristat', 1, 95000, (select id from tax_codes where company_id = co and code = 'VAT20'), (select id from accounts where company_id = co and code = '704'));
    perform public.post_sales_invoice(i);
    if m < 10 then insert into to_pay values (i, 'ar', 24); end if;
  end loop;
end $$;
select pg_temp.settle('ar');

-- ---------- people -----------------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', :'u_vjosa', false);
insert into cost_centers (company_id, code, name) select :'co', x.c, x.n from (values ('CC-LOG', 'Logjistika')) x(c, n)
 where not exists (select 1 from cost_centers where company_id = :'co' and code = x.c);
insert into departments (company_id, code, name) values (:'co', 'MGT', 'Drejtimi'), (:'co', 'SAL', 'Shitjet'), (:'co', 'STO', 'Dyqani Blloku'),
  (:'co', 'WHS', 'Magazina'), (:'co', 'PRD', 'Pjekësja'), (:'co', 'LOG', 'Logjistika'), (:'co', 'OFF', 'Zyra');
insert into job_positions (company_id, title, department_id)
select :'co', x.t, (select id from departments where company_id = :'co' and code = x.d) from (values
  ('Drejtor ekzekutiv','MGT'), ('Specialist burimesh njerëzore dhe pagash','OFF'), ('Menaxher shitjesh','SAL'), ('Agjent shitjesh','SAL'), ('Arkëtar','STO'),
  ('Përgjegjës magazine','WHS'), ('Përgjegjës i pjekjes','PRD'), ('Specialist blerjesh','OFF'), ('Koordinator logjistike','LOG'), ('Shofer','LOG'), ('Ndihmës në pjekje','PRD')) x(t, d);
do $$
declare co uuid := current_setting('t.co')::uuid; r record; v_emp uuid;
begin
  for r in select * from (values
    ('Arta','Hoxha','arta@ylli.al','J70412011H','1979-04-12','2019-03-01','MGT','Drejtor ekzekutiv',320000,null,'AL47 2121 1009 0000 0002 3569 8741'),
    ('Vjosa','Dema','vjosa@ylli.al','K85307023M','1988-05-30','2021-09-01','OFF','Specialist burimesh njerëzore dhe pagash',120000,'Arta','AL35 2021 1109 0000 0000 0123 4567'),
    ('Elira','Dervishi','elira@ylli.al','K90118045T','1990-01-18','2020-02-01','SAL','Menaxher shitjesh',150000,'Arta','AL86 2081 1008 0000 0010 2345 6789'),
    ('Dritan','Shehu','dritan@ylli.al','L95214077S','1995-02-14','2022-04-04','SAL','Agjent shitjesh',90000,'Elira','AL90 2081 1008 0000 0010 9988 7766'),
    ('Mira','Leka','mira@ylli.al','M01628012L','2000-06-28','2024-05-06','STO','Arkëtar',55000,'Elira','AL21 2121 1009 0000 0002 7712 0045'),
    ('Ardit','Gjoka','ardit@ylli.al','M02911056G','2002-09-11','2025-03-03','STO','Arkëtar',52000,'Elira','AL64 2121 1009 0000 0002 7712 0099'),
    ('Besnik','Krasniqi','besnik@ylli.al','J82107034K','1982-10-07','2019-06-03','WHS','Përgjegjës magazine',95000,'Arta','AL52 2021 1109 0000 0000 5544 3322'),
    ('Klodian','Meta','klodian@ylli.al','K86802019N','1986-08-02','2021-01-11','PRD','Përgjegjës i pjekjes',110000,'Arta','AL17 2081 1008 0000 0010 4433 2211'),
    ('Genta','Mema','genta@ylli.al','L91421063P','1991-04-21','2022-10-03','OFF','Specialist blerjesh',100000,'Arta','AL73 2121 1009 0000 0002 1100 2299'),
    ('Florian','Hysa','florian@ylli.al','K89113078R','1989-11-13','2023-02-01','LOG','Koordinator logjistike',85000,'Arta','AL28 2021 1109 0000 0000 7788 9900'),
    ('Ermal','Basha',null,'M00724031B','2000-07-24','2026-08-17','LOG','Shofer',62000,'Florian','AL39 2081 1008 0000 0010 6677 8899'),
    ('Sara','Prifti',null,'M03306088D','2003-03-06','2026-10-05','PRD','Ndihmës në pjekje',56000,'Klodian','AL44 2121 1009 0000 0002 9900 1122')
  ) x(fn, ln, email, nid, dob, hired, dep, pos, gross, mgr, iban) loop
    insert into public.employees (company_id, user_id, first_name, last_name, personal_number, date_of_birth, gender, email, phone, hire_date,
                                  department_id, position_id, iban, bank_name, manager_id, cost_center_id)
    values (co, (select id from auth.users where email = r.email), r.fn, r.ln, r.nid, r.dob::date,
            case when r.fn in ('Arta','Vjosa','Elira','Mira','Genta','Sara') then 'female' else 'male' end,
            coalesce(r.email, lower(r.fn) || '.' || lower(r.ln) || '@ylli.al'), '+355 69 ' || (200 + length(r.ln) * 37) || ' ' || (1000 + length(r.fn) * 311),
            r.hired::date, (select id from public.departments where company_id = co and code = r.dep),
            (select id from public.job_positions where company_id = co and title = r.pos), r.iban,
            case when r.iban like 'AL__ 2121%' then 'Raiffeisen Bank' when r.iban like 'AL__ 2081%' then 'BKT' else 'Credins Bank' end,
            (select id from public.employees where company_id = co and first_name = r.mgr), (select id from public.cost_centers where company_id = co and code = 'CC-LOG' and r.dep = 'LOG'))
    returning id into v_emp;
    insert into public.employment_contracts (company_id, employee_id, contract_type, start_date, end_date, gross_salary, currency_code)
    values (co, v_emp, case when r.fn = 'Ermal' then 'fixed_term' else 'indefinite' end, r.hired::date,
            case when r.fn = 'Ermal' then current_date + 40 end, r.gross, 'ALL');
  end loop;
end $$;
update departments d set manager_id = e.id from employees e where e.company_id = d.company_id and d.company_id = :'co'
   and ((d.code = 'MGT' and e.first_name = 'Arta') or (d.code = 'SAL' and e.first_name = 'Elira') or (d.code = 'WHS' and e.first_name = 'Besnik')
     or (d.code = 'PRD' and e.first_name = 'Klodian') or (d.code = 'LOG' and e.first_name = 'Florian') or (d.code = 'STO' and e.first_name = 'Elira')
     or (d.code = 'OFF' and e.first_name = 'Vjosa'));

-- leave: past, upcoming, waiting for a decision
create or replace function pg_temp.leave(p_first text, p_type text, p_from date, p_to date, p_status text, p_reason text default null) returns uuid language plpgsql as $$
declare v uuid; co uuid := current_setting('t.co')::uuid;
begin
  insert into public.leave_requests (company_id, employee_id, leave_type_id, start_date, end_date, reason)
  values (co, (select id from public.employees where company_id = co and first_name = p_first),
          (select id from public.leave_types where company_id = co and name = p_type), p_from, p_to, p_reason) returning id into v;
  if p_status in ('submitted','approved','rejected') then perform public.submit_leave_request(v); end if;
  if p_status in ('approved','rejected') then perform public.decide_leave_request(v, p_status = 'approved'); end if;
  return v;
end $$;
select pg_temp.leave('Dritan', 'Annual leave', '2026-08-10', '2026-08-14', 'approved', 'Pushime verore');
select pg_temp.leave('Klodian', 'Sick leave', '2026-09-01', '2026-09-02', 'approved', 'Grip, me raport mjekësor');
select pg_temp.leave('Ardit', 'Unpaid leave', '2026-09-14', '2026-09-15', 'approved', 'Provime në universitet');
select pg_temp.leave('Besnik', 'Annual leave', '2026-07-20', '2026-07-31', 'approved', 'Udhëtim familjar');
select pg_temp.leave('Genta', 'Annual leave', '2026-10-21', '2026-10-23', 'approved');
select pg_temp.leave('Mira', 'Annual leave', '2026-10-26', '2026-10-30', 'approved', 'Dasmë');
select set_config('request.jwt.claim.sub', :'u_elira', false);
select pg_temp.leave('Elira', 'Annual leave', '2026-11-16', '2026-11-20', 'submitted', 'Fundjavë e gjatë në Vjenë');
select set_config('request.jwt.claim.sub', :'u_besnik', false);
select pg_temp.leave('Besnik', 'Annual leave', '2026-12-21', '2026-12-24', 'submitted', 'Krishtlindje');
select set_config('request.jwt.claim.sub', :'u_dritan', false);
select pg_temp.leave('Dritan', 'Annual leave', '2026-11-02', '2026-11-03', 'submitted');
select set_config('request.jwt.claim.sub', :'u_vjosa', false);

-- attendance: every working day of this month up to yesterday, and this morning
insert into attendance_records (company_id, employee_id, work_date, check_in, check_out, overtime_hours, source)
select :'co', e.id, d::date,
       (d::date + time '07:45' + (abs(hashtext(e.id::text || d::text)) % 40) * interval '1 minute') at time zone 'Europe/Tirane',
       case when d::date < current_date then
         (d::date + time '16:00' + (abs(hashtext(d::text || e.id::text)) % 50) * interval '1 minute'
            + case when abs(hashtext(e.first_name || d::text)) % 9 = 0 then interval '2 hours' else interval '0' end) at time zone 'Europe/Tirane' end,
       case when d::date < current_date and abs(hashtext(e.first_name || d::text)) % 9 = 0 then 2 else 0 end,
       case when e.first_name in ('Mira','Ardit') then 'terminal' else 'mobile' end
  from employees e cross join generate_series(date_trunc('month', current_date), current_date, interval '1 day') d
 where e.company_id = :'co' and extract(isodow from d) < 6 and d::date >= e.hire_date
   and not exists (select 1 from public_holidays h where h.company_id = :'co' and h.holiday_date = d::date)
   and not exists (select 1 from leave_requests r where r.employee_id = e.id and r.status = 'approved' and d::date between r.start_date and r.end_date)
   and not (e.first_name = 'Arta' and d::date = current_date);

-- payroll: July–September calculated by HR, approved by the director, posted and paid
create or replace function pg_temp.payroll(p_y int, p_m int) returns uuid language plpgsql as $$
declare v uuid; co uuid := current_setting('t.co')::uuid;
begin
  perform set_config('request.jwt.claim.sub', (select id::text from auth.users where email = 'vjosa@ylli.al'), false);
  v := public.create_payroll_run(co, p_y, p_m, (make_date(p_y, p_m, 1) + interval '1 month 9 days')::date);
  if p_m = 9 then
    insert into public.payroll_run_items (company_id, payroll_run_id, employee_id, code, name, amount)
    select co, v, id, 'BONUS', 'Bonus shitjesh për tremujorin e tretë', case first_name when 'Elira' then 25000 else 15000 end from public.employees where company_id = co and first_name in ('Elira','Dritan');
  end if;
  perform public.calculate_payroll(v);
  perform set_config('request.jwt.claim.sub', (select id::text from auth.users where email = 'arta@ylli.al'), false);
  perform public.approve_payroll(v);
  perform public.post_payroll(v);
  perform public.pay_payroll(v, (select id from public.bank_accounts where company_id = co and name = 'BKT llogari rrjedhëse'),
                             (make_date(p_y, p_m, 1) + interval '1 month 9 days')::date);
  return v;
end $$;
select pg_temp.payroll(2026, 7);
select pg_temp.payroll(2026, 8);
select pg_temp.payroll(2026, 9);
-- contributions and income tax of July to September paid to the tax office by the 20th
select set_config('request.jwt.claim.sub', :'u_arta', false);
do $$
declare co uuid := current_setting('t.co')::uuid; r record; v uuid;
begin
  for r in select * from public.payroll_runs where company_id = co and status = 'paid' and period_start in ('2026-07-01', '2026-08-01', '2026-09-01') loop
    insert into public.journal_entries (company_id, journal_id, entry_date, reference, memo)
    values (co, (select id from public.journals where company_id = co and code = 'BNK'), (r.period_start + interval '1 month 19 days')::date,
            'DPT ' || to_char(r.period_start, 'MM/YYYY'), 'Kontributet dhe TAP për ' || to_char(r.period_start, 'MM/YYYY'))
    returning id into v;
    insert into public.journal_lines (company_id, entry_id, line_no, account_id, debit, credit, description) values
      (co, v, 1, (select id from public.accounts where company_id = co and code = '431'), r.total_employee_contrib + r.total_employer_contrib, 0, 'Kontribute shoqërore dhe shëndetësore'),
      (co, v, 2, (select id from public.accounts where company_id = co and code = '442'), r.total_income_tax, 0, 'Tatimi i mbajtur në burim (TAP)'),
      (co, v, 3, (select id from public.accounts where company_id = co and code = '5121'), 0, r.total_employee_contrib + r.total_employer_contrib + r.total_income_tax, 'Pagesë në tatime');
    update public.journal_entries set status = 'posted' where id = v;
  end loop;
end $$;
select set_config('request.jwt.claim.sub', :'u_vjosa', false);
select public.create_payroll_run(:'co', 2026, 10, '2026-11-10') as prl_oct \gset
select public.calculate_payroll(:'prl_oct');
select set_config('request.jwt.claim.sub', :'u_arta', false);

-- a custom role
select public.save_custom_role(:'co', null, 'Përgjegjës dyqani', 'Drejton dyqanin e Bllokut: arkat, stokun dhe raportet e shitjeve',
                               array['core.read','collab.*','pos.*','inventory.read','wms.read','sales.read','partners.read','reports.read']);

-- ---------- logistics ---------------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', :'u_florian', false);
insert into carriers (company_id, code, name, carrier_type, phone) values (:'co', 'OWN', 'Flota Ylli', 'own_fleet', '+355 69 400 1000') returning id as car_own \gset
insert into carriers (company_id, code, name, carrier_type, tracking_url_template, phone) values
  (:'co', 'PSH', 'Posta Shqiptare', 'external', 'https://www.postashqiptare.al/track?id={tracking}', '+355 4 222 4000') returning id as car_psh \gset
insert into carriers (company_id, code, name, carrier_type, tracking_url_template) values
  (:'co', 'DHL', 'DHL Express', 'external', 'https://www.dhl.com/al-en/home/tracking.html?tracking-id={tracking}') returning id as car_dhl \gset
insert into vehicles (company_id, plate_number, name, vehicle_type, capacity_kg, capacity_m3, driver_employee_id) values
  (:'co', 'AA 482 TR', 'Fiat Ducato', 'van', 1200, 10, (select id from employees where company_id = :'co' and first_name = 'Ermal')) returning id as van1 \gset
insert into vehicles (company_id, plate_number, name, vehicle_type, capacity_kg, capacity_m3, driver_employee_id) values
  (:'co', 'AB 119 TR', 'Renault Kangoo', 'van', 600, 3.6, (select id from employees where company_id = :'co' and first_name = 'Florian')) returning id as van2 \gset

-- orders for the delivery days (as the sales manager), picked by the warehouse
create or replace function pg_temp.so(p_cust text, p_lines jsonb) returns uuid language plpgsql as $$
declare co uuid := current_setting('t.co')::uuid; v uuid; l jsonb; n int := 0;
begin
  perform set_config('request.jwt.claim.sub', (select id::text from auth.users where email = 'elira@ylli.al'), false);
  insert into public.sales_orders (company_id, partner_id, warehouse_id, currency_code, shipping_address_id)
  select co, p.id, (select id from public.warehouses where company_id = co and code = 'WH'), 'ALL',
         (select a.id from public.partner_addresses a where a.partner_id = p.id and a.deleted_at is null order by a.is_default desc limit 1)
    from public.business_partners p where p.company_id = co and p.code = p_cust returning id into v;
  for l in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    insert into public.sales_order_lines (company_id, sales_order_id, line_no, variant_id, description, quantity, unit_price, tax_code_id)
    select co, v, n, pv.id, pv.name, (l ->> 'q')::numeric, coalesce(pv.sales_price_override, p.sales_price), p.sales_tax_code_id
      from public.product_variants pv join public.products p on p.id = pv.product_id where pv.company_id = co and pv.sku = l ->> 's';
  end loop;
  perform public.confirm_sales_order(v);
  return v;
end $$;
create or replace function pg_temp.ready(p_so uuid) returns uuid language plpgsql as $$
declare d uuid;
begin
  d := public.create_delivery_from_order(p_so);
  update public.deliveries set status = 'ready', picked_at = now() where id = d;
  return d;
end $$;
-- this week's water and milk went straight to the shelf
select set_config('request.jwt.claim.sub', :'u_besnik', false);
insert into goods_receipts (company_id, warehouse_id, vendor_id, receipt_date, notes)
values (:'co', :'wh', (select id from business_partners where company_id = :'co' and code = 'V004'), current_date - 2, 'Furnizim javor, direkt në raft') returning id as gr_w \gset
insert into lots (company_id, variant_id, lot_number, manufacture_date, expiry_date)
select :'co', id, 'ML-' || to_char(current_date - 2, 'YYMMDD'), current_date - 2, current_date + 12 from product_variants where company_id = :'co' and sku = 'MILK-1L'
returning id as milk_lot \gset
insert into goods_receipt_lines (company_id, receipt_id, variant_id, location_id, quantity, unit_cost, lot_id)
select :'co', :'gr_w', v.id, :'stock', x.q, x.c, case when x.sku = 'MILK-1L' then :'milk_lot'::uuid end
  from product_variants v join (values ('WATER-05', 960, 21), ('MILK-1L', 60, 88)) x(sku, q, c) on x.sku = v.sku
 where v.company_id = :'co';
select public.post_goods_receipt(:'gr_w');
select pg_temp.ready(pg_temp.so('C002', '[{"s":"WATER-05","q":96},{"s":"MILK-1L","q":12}]')) as d_y1 \gset
select pg_temp.ready(pg_temp.so('C003', '[{"s":"MILK-1L","q":12},{"s":"ESP-1KG","q":2}]')) as d_y2 \gset
select pg_temp.ready(pg_temp.so('C005', '[{"s":"MUG-CER","q":2},{"s":"HB-250","q":4}]')) as d_y3 \gset
select pg_temp.ready(pg_temp.so('C001', '[{"s":"ESP-1KG","q":6},{"s":"WATER-05","q":240}]')) as d_t1 \gset
select pg_temp.ready(pg_temp.so('C004', '[{"s":"WATER-05","q":192},{"s":"HB-250","q":6}]')) as d_t2 \gset
select pg_temp.ready(pg_temp.so('C002', '[{"s":"WATER-05","q":48},{"s":"MILK-1L","q":6}]')) as d_t3 \gset
select pg_temp.ready(pg_temp.so('C003', '[{"s":"MILK-1L","q":6}]')) as d_n1 \gset
select pg_temp.ready(pg_temp.so('C004', '[{"s":"WATER-05","q":96}]')) as d_n2 \gset
select pg_temp.so('C001', '[{"s":"HB-1KG","q":2}]') as so_open \gset
select public.create_delivery_from_order(:'so_open');

select set_config('request.jwt.claim.sub', :'u_florian', false);
-- yesterday's route (Kangoo, Florian): done; Bar Komiteti paid cash on delivery; Durrës customer was out
select public.create_shipment(:'d_y1') as sh_y1 \gset
select public.create_shipment(:'d_y2', jsonb_build_object('cod_amount', (select total from sales_orders where id = (select sales_order_id from deliveries where id = :'d_y2')))) as sh_y2 \gset
select public.create_shipment(:'d_y3', jsonb_build_object('cod_amount', (select total from sales_orders where id = (select sales_order_id from deliveries where id = :'d_y3')))) as sh_y3 \gset
select public.create_route(:'co', current_date, :'wh', :'van2', null, array[:'sh_y1', :'sh_y2', :'sh_y3']::uuid[]) as rt_y \gset
update delivery_routes set planned_distance_km = 92 where id = :'rt_y';
select public.start_route(:'rt_y');
select public.record_stop(id, 'delivered', 'E mori menaxheri i barit', false) from route_stops where shipment_id = :'sh_y1';
select public.record_stop(id, 'delivered', 'Paguar në dorë', true) from route_stops where shipment_id = :'sh_y2';
select public.record_stop(id, 'failed', 'Klienti nuk ishte në shtëpi; telefoni i fikur') from route_stops where shipment_id = :'sh_y3';
select public.complete_route(:'rt_y', 97);
-- push it back a day (dates only)
set session_replication_role = replica;
update delivery_routes set route_date = current_date - 1, started_at = started_at - interval '1 day', completed_at = completed_at - interval '1 day' where id = :'rt_y';
update route_stops set actual_arrival = actual_arrival - interval '1 day' + (sequence * interval '47 minutes') where route_id = :'rt_y';
update shipments set ship_date = current_date - 1, delivered_at = delivered_at - interval '1 day' + interval '2 hours' where route_id = :'rt_y' or id = :'sh_y3';
update shipment_events set event_at = event_at - interval '1 day' + (abs(hashtext(id::text)) % 300) * interval '1 minute' where shipment_id in (:'sh_y1', :'sh_y2', :'sh_y3');
update deliveries set done_at = done_at - interval '1 day' where id in (:'d_y1', :'d_y2', :'d_y3');
set session_replication_role = origin;
-- the failed parcel goes to Durrës with the post office
select public.update_shipment(:'sh_y3', 'scheduled', 'Klienti kërkoi dërgim me postë');
select public.ship_with_carrier(:'sh_y3', :'car_psh', 'RR204517865AL');
select public.update_shipment(:'sh_y3', 'note', 'Mbërriti në qendrën e sortimit në Durrës', 'Durrës');

-- today's route (Ducato, Ermal): out on the road, first stop done
select public.create_shipment(:'d_t1') as sh_t1 \gset
select public.create_shipment(:'d_t2') as sh_t2 \gset
select public.create_shipment(:'d_t3') as sh_t3 \gset
select public.create_route(:'co', current_date, :'wh', :'van1', null, array[:'sh_t1', :'sh_t2', :'sh_t3']::uuid[]) as rt_t \gset
update delivery_routes set planned_distance_km = 38 where id = :'rt_t';
select public.start_route(:'rt_t');
select public.record_stop(id, 'delivered', 'Dorëzuar te hyrja e pasme e hotelit', false) from route_stops where shipment_id = :'sh_t1';

-- tomorrow: planned on the Kangoo
select public.create_shipment(:'d_n1') as sh_n1 \gset
select public.create_shipment(:'d_n2') as sh_n2 \gset
select public.create_route(:'co', current_date + 1, :'wh', :'van2', null, array[:'sh_n1', :'sh_n2']::uuid[]) as rt_n \gset
update delivery_routes set planned_distance_km = 24 where id = :'rt_n';

-- older deliveries went with the post office
select public.create_shipment(d.id, jsonb_build_object('carrier_id', :'car_psh', 'ship_date', d.done_at::date)) from deliveries d
 where d.company_id = :'co' and d.status = 'done' and not exists (select 1 from shipments s where s.delivery_id = d.id) and d.number in ('DO-2026-00003', 'DO-2026-00005');
set session_replication_role = replica;
update shipments s set status = 'delivered', tracking_number = 'RR2045' || (10000 + abs(hashtext(s.id::text)) % 89999) || 'AL', attempts = 1,
       delivered_at = d.done_at + interval '1 day 3 hours', ship_date = d.done_at::date
  from deliveries d where d.id = s.delivery_id and s.company_id = :'co' and s.status = 'draft' and d.number in ('DO-2026-00003', 'DO-2026-00005');
insert into shipment_events (company_id, shipment_id, event_at, status, note, source)
select s.company_id, s.id, x.at, x.st, x.note, x.src from shipments s
  cross join lateral (values (s.ship_date + time '15:10', 'in_transit', 'Dorëzuar te Posta Shqiptare', 'office'),
                             (s.ship_date + time '21:40', 'in_transit', 'Qendra e sortimit Tiranë', 'carrier'),
                             (s.delivered_at, 'delivered', 'Dorëzuar', 'carrier')) x(at, st, note, src)
 where s.company_id = :'co' and s.carrier_id = :'car_psh' and s.status = 'delivered';
set session_replication_role = origin;

-- the cash from Bar Komiteti goes to the cash box
select set_config('request.jwt.claim.sub', :'u_arta', false);
select public.create_invoice_from_order(sales_order_id) as inv_cod from deliveries where id = :'d_y2' \gset
select public.post_sales_invoice(:'inv_cod');
select public.settle_cod(array[:'sh_y2']::uuid[], (select id from bank_accounts where company_id = :'co' and name = 'Cash box'));

-- ---------- web shop ----------------------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', :'u_elira', false);
insert into sales_channels (company_id, name, channel_type, store_url, warehouse_id, price_list_id, is_active, settings)
values (:'co', 'shop.ylli.al', 'woocommerce', 'https://shop.ylli.al', :'wh', null, true, '{"prices_include_tax": true, "webhook": "orders/created"}') returning id as ch \gset
select public.link_channel_products(:'ch');
select public.ingest_channel_order(:'ch', '{"id":"wc-10481","number":"#10481","created_at":"2026-10-22T19:12:00+02:00","customer":{"email":"ana.berisha@gmail.com","name":"Ana Berisha","phone":"+355 68 455 1200"},
  "shipping_address":{"line1":"Rruga e Elbasanit 77","city":"Tiranë","postal_code":"1010"},"lines":[{"sku":"HB-250","quantity":3,"price":980},{"sku":"MUG-CER","quantity":2,"price":890}],"shipping":300,"payment":"cod"}');
select public.ingest_channel_order(:'ch', '{"id":"wc-10482","number":"#10482","created_at":"2026-10-23T08:40:00+02:00","customer":{"email":"g.hoxha@outlook.com","name":"Gent Hoxha"},
  "shipping_address":{"line1":"Rruga Ismail Qemali 9","city":"Tiranë"},"lines":[{"sku":"HB-1KG","quantity":1,"price":3400}],"shipping":0,"payment":"paid"}');
select public.ingest_channel_order(:'ch', '{"id":"wc-10483","number":"#10483","created_at":"2026-10-23T21:05:00+02:00","customer":{"email":"ana.berisha@gmail.com","name":"Ana Berisha"},
  "lines":[{"sku":"GIFT-XMAS","quantity":1,"price":4900}],"shipping":300,"payment":"cod"}');
select public.ingest_channel_order(:'ch', '{"id":"wc-10484","number":"#10484","created_at":"2026-10-24T09:15:00+02:00","customer":{"email":"elona.k@yahoo.com","name":"Elona Kurti","phone":"+355 69 300 8899"},
  "shipping_address":{"line1":"Lagjia 4, Rruga Durrah 2","city":"Durrës"},"lines":[{"sku":"TEE-M-NAV","quantity":2,"price":2280},{"sku":"HB-250","quantity":1,"price":980}],"shipping":300,"payment":"paid"}');
select public.sync_channel_stock(:'ch');

-- ---------- replenishment run (suggestions only, so the Phase 4 suggestions stay for the demo) ----------------
select set_config('request.jwt.claim.sub', (select id::text from auth.users where email = 'genta@ylli.al'), false);
select public.run_replenishment(:'co', 'suggest');

-- ---------- VAT: August accepted, September submitted; fiscal queue processed ---------------------------------
select set_config('request.jwt.claim.sub', :'u_arta', false);
select public.process_fiscal_queue(:'co');
-- two receipts the CIS did not answer for (shown in the monitor)
update fiscalization_records set status = 'failed', fic = null, fiscalized_at = null, attempt_count = 3, last_attempt_at = now() - interval '25 minutes',
       error_code = 'T999', error_message = 'Skadoi koha e pritjes për përgjigjen e CIS (3 përpjekje)'
 where id in (select id from fiscalization_records where company_id = :'co' and source_doc_type = 'pos_order' order by created_at desc limit 2);
update pos_orders set fiscal_status = 'failed' where id in (select source_doc_id from fiscalization_records where company_id = :'co' and status = 'failed');
select public.create_vat_declaration(:'co', 2026, 7) as vd7 \gset
select public.submit_vat_declaration(:'vd7', 'DPT-TVSH-2026-07-116204');
select public.decide_vat_declaration(:'vd7', true, 'Pranuar nga DPT');
select public.create_vat_declaration(:'co', 2026, 8) as vd8 \gset
select public.submit_vat_declaration(:'vd8', 'DPT-TVSH-2026-08-118427');
select public.decide_vat_declaration(:'vd8', true, 'Pranuar nga DPT');
select public.create_vat_declaration(:'co', 2026, 9) as vd9 \gset
select public.submit_vat_declaration(:'vd9', 'DPT-TVSH-2026-09-120933');
set session_replication_role = replica;
update vat_declarations set submitted_at = '2026-08-12 09:40+02', decided_at = '2026-08-19 11:00+02' where id = :'vd7';
update vat_declarations set submitted_at = '2026-09-11 10:20+02', decided_at = '2026-09-18 09:00+02' where id = :'vd8';
update vat_declarations set submitted_at = '2026-10-12 16:05+02' where id = :'vd9';
set session_replication_role = origin;

-- ---------- Kosovo company: a small trading month, payroll and the ATK return -----------------------------------
select set_config('request.jwt.claim.sub', :'u_arta', false);
select set_config('t.co2', :'co2', false);
update company_settings set fiscal_business_unit_code = 'PR-0001', fiscal_software_code = 'NXP-1' where company_id = :'co2';
insert into business_partners (company_id, code, name, kind, is_customer, tax_number, email) values
  (:'co2', 'K001', 'Hotel Sirius', 'company', true, '810123456', 'blerje@sirius-ks.com'), (:'co2', 'K002', 'Kafeteria Dit e Nat', 'company', true, '810654321', null),
  (:'co2', 'K003', 'Viva Fresh Store', 'company', true, '811999888', 'procurement@vivafresh.com');
insert into business_partners (company_id, code, name, kind, is_vendor, tax_number) values
  (:'co2', 'F001', 'Ylli Retail sh.p.k. (AL)', 'company', true, 'L81234567B'), (:'co2', 'F002', 'Qira Prishtina L.L.C.', 'company', true, '810777666'),
  (:'co2', 'F003', 'Google Ireland Ltd', 'company', true, null), (:'co2', 'F004', 'Fermeri Gjilan', 'individual', true, null);
do $$
declare co uuid := current_setting('t.co2')::uuid; v uuid; r record; n int;
begin
  for r in select * from (values
    ('K001', '2026-09-03', 'Kafe kokërr 1 kg', 40, 22.5, 'VAT18'), ('K001', '2026-09-03', 'Servisim i makinës espresso', 1, 180, 'VAT18'),
    ('K002', '2026-09-09', 'Kafe kokërr 1 kg', 12, 24, 'VAT18'), ('K002', '2026-09-09', 'Qumësht 1 L', 60, 0.95, 'VAT8'),
    ('K003', '2026-09-17', 'Përzierja Ylli 250 g', 120, 6.4, 'VAT18'), ('K003', '2026-09-17', 'Ujë në shishe 0,5 L', 480, 0.28, 'VAT8'),
    ('K001', '2026-09-24', 'Trajnim për bariste (arsim, i përjashtuar)', 1, 300, 'EXEMPT'), ('K003', '2026-09-28', 'Kafe kokërr 1 kg', 24, 22, 'VAT18')
  ) x(c, d, descr, q, p, t) loop
    select id into v from public.sales_invoices where company_id = co and partner_id = (select id from public.business_partners where company_id = co and code = r.c)
       and invoice_date = r.d::date and status = 'draft';
    if v is null then
      insert into public.sales_invoices (company_id, partner_id, currency_code, invoice_date, due_date)
      values (co, (select id from public.business_partners where company_id = co and code = r.c), 'EUR', r.d::date, r.d::date + 30) returning id into v;
    end if;
    select coalesce(max(line_no), 0) + 1 into n from public.sales_invoice_lines where invoice_id = v;
    insert into public.sales_invoice_lines (company_id, invoice_id, line_no, description, quantity, unit_price, tax_code_id)
    values (co, v, n, r.descr, r.q, r.p, (select id from public.tax_codes where company_id = co and code = r.t));
  end loop;
  for v in select id from public.sales_invoices where company_id = co and status = 'draft' order by invoice_date loop perform public.post_sales_invoice(v); end loop;
  -- bills: rent, stock from the Albanian sister company (import handled by customs, here domestic VAT 0), cloud services (reverse charge), farmer milk
  for r in select * from (values
    ('F002', 'QP-2026-09', '2026-09-01', 'Qiraja e dyqanit, shtator', 1, 850, 'VAT18', '612'),
    ('F001', 'INV-AL-2026-0412', '2026-09-05', 'Kafe kokërr (brenda grupit, eksport me normë 0)', 200, 14, 'EXEMPT', '602'),
    ('F003', 'IE-5310-2209', '2026-09-30', 'Google Workspace, shtator', 1, 96, 'VAT18-RC', '602'),
    ('F004', 'FG-09', '2026-09-20', 'Qumësht i freskët nga ferma', 300, 0.55, 'VAT8', '602')
  ) x(vnd, no, d, descr, q, p, t, acc) loop
    insert into public.vendor_bills (company_id, vendor_id, vendor_invoice_number, bill_date, due_date, currency_code)
    values (co, (select id from public.business_partners where company_id = co and code = r.vnd), r.no, r.d::date, r.d::date + 15, 'EUR') returning id into v;
    insert into public.vendor_bill_lines (company_id, bill_id, line_no, description, account_id, quantity, unit_price, tax_code_id)
    values (co, v, 1, r.descr, (select id from public.accounts where company_id = co and code = r.acc), r.q, r.p, (select id from public.tax_codes where company_id = co and code = r.t));
    perform public.post_vendor_bill(v);
  end loop;
end $$;
-- a credit note to Viva Fresh (2 broken cases)
select public.create_credit_note(id) as xk_cn from sales_invoices where company_id = :'co2' and invoice_date = '2026-09-17' \gset
delete from sales_invoice_lines where invoice_id = :'xk_cn' and description like 'Ujë në shishe%';
update sales_invoice_lines set quantity = 6 where invoice_id = :'xk_cn';
update sales_invoices set invoice_date = '2026-09-22', due_date = '2026-09-22' where id = :'xk_cn';
select public.post_sales_invoice(:'xk_cn');
select public.process_fiscal_queue(:'co2');
-- people in Prishtina
insert into departments (company_id, code, name) values (:'co2', 'PRN', 'Dega Prishtinë') returning id as xk_dep \gset
do $$
declare co uuid := current_setting('t.co2')::uuid; r record; v uuid;
begin
  for r in select * from (values ('Blerim','Gashi','1234567890','2023-01-09', 1100, true), ('Drita','Berisha','1234567891','2024-03-01', 720, true),
                                 ('Faton','Hoti','1234567892','2025-06-02', 480, true), ('Liridona','Kelmendi','1234567893','2026-02-01', 400, false)) x(fn, ln, nid, h, g, prim) loop
    insert into public.employees (company_id, first_name, last_name, personal_number, hire_date, department_id)
    values (co, r.fn, r.ln, r.nid, r.h::date, (select id from public.departments where company_id = co and code = 'PRN')) returning id into v;
    insert into public.employment_contracts (company_id, employee_id, start_date, gross_salary, currency_code, is_primary_employer)
    values (co, v, r.h::date, r.g, 'EUR', r.prim);
  end loop;
end $$;
select public.create_payroll_run(:'co2', 2026, 9, '2026-10-05') as xk_prl \gset
select public.calculate_payroll(:'xk_prl');
select set_config('request.jwt.claim.sub', :'u_vjosa', false);
select set_config('request.jwt.claim.sub', :'u_arta', false);
update payroll_runs set calculated_by = :'u_vjosa' where id = :'xk_prl';
select public.approve_payroll(:'xk_prl');
select public.post_payroll(:'xk_prl');
select public.create_vat_declaration(:'co2', 2026, 9) as xk_vd \gset
select public.submit_vat_declaration(:'xk_vd', 'ATK-EDI-2026-09-004512');

-- decided leave requests are not "waiting" any more in people's inboxes
update notifications n set read_at = now() - interval '1 hour'
  from leave_requests r where n.entity_type = 'leave_requests' and n.entity_id = r.id and r.status <> 'submitted' and n.title like 'Leave request:%';

-- =============================================================================
-- Phase 9: the rest of a normal week — CRM follow-ups, a won deal, an expired
-- quote, a supplier credit note, a transfer being prepared
-- =============================================================================
-- CRM: calls, meetings and notes by the sales team
select set_config('request.jwt.claim.sub', :'u_dritan', false);
insert into opportunities (company_id, name, partner_id, stage_id, owner_id, expected_value, currency_code, expected_close_date)
values (:'co', 'Mullixhiu: furnizim vjetor me kafe 2027', :'c_mullixhiu', pg_temp.stage('Negotiation'), :'u_dritan', 410000, 'ALL', current_date - 15);
update opportunities set stage_id = pg_temp.stage('Won') where company_id = :'co' and name = 'Mullixhiu: furnizim vjetor me kafe 2027';
insert into entity_activities (company_id, entity_type, entity_id, activity_type, title, body, occurred_at)
select :'co', 'opportunities', o.id, x.kind, x.title, x.body, now() - x.ago
  from opportunities o join (values
    ('Rogner%', 'call', 'Telefonatë me Gentiana Muçën', 'Do 60 filxhanë për banketet e dhjetorit; kërkon provë kafeje para se të firmosë. I dërgova ofertën.', interval '3 days'),
    ('Rogner%', 'meeting', 'Takim në hotel', 'Provë me shefin e kuzhinës. I pëlqeu Përzierja Ylli më shumë se Milano. Të përgatisim ofertë të re me 1 kg.', interval '1 day'),
    ('Mullixhiu: furnizim%', 'call', 'Konfirmim nga pronari', 'Pranoi çmimin 2 750 lekë/kg për gjithë vitin 2027, me dorëzim çdo të hënë.', interval '15 days'),
    ('Klea%', 'task', 'Ta marr në telefon për abonimin', 'Afati ka kaluar — të pyes nëse e do ende kafen për zyrën nga nëntori.', interval '4 days')
  ) x(name, kind, title, body, ago) on o.name like x.name
 where o.company_id = :'co';
select set_config('request.jwt.claim.sub', :'u_elira', false);
insert into entity_activities (company_id, entity_type, entity_id, activity_type, title, body, occurred_at)
select :'co', 'opportunities', o.id, x.kind, x.title, x.body, now() - x.ago
  from opportunities o join (values
    ('Spar: raft%', 'meeting', 'Takim me blerësin e Spar', 'Duan raft të dedikuar për kafe dhe ujë në Ring Center nga 15 nëntori. Kërkojnë 8% zbritje mbi 48 copë.', interval '6 days'),
    ('Komiteti%', 'email', 'Oferta u dërgua me email', 'Oferta për 18 kg Milano me çmim shumice; presim përgjigje deri të premten.', interval '3 days'),
    ('Prishtina Coffee%', 'call', 'Thirrje me Prishtina Coffee', 'Interes për shpërndarje në Kosovë; duan katalogun në EUR dhe kushtet e transportit.', interval '9 days')
  ) x(name, kind, title, body, ago) on o.name like x.name
 where o.company_id = :'co';
insert into entity_activities (company_id, entity_type, entity_id, activity_type, title, body, occurred_at)
select :'co', 'leads', l.id, x.kind, x.title, x.body, now() - x.ago
  from leads l join (values
    ('Filxhanë me logo%', 'call', 'Thirrje e parë', 'Duan 150 filxhanë me logon e tyre për fund viti. Kërkuan mostër.', interval '3 days'),
    ('Furnizim javor%', 'meeting', 'Vizitë në kopsht', 'Konsum rreth 60 litra qumësht dhe 200 shishe ujë në javë. Gati për ofertë.', interval '5 days')
  ) x(title_like, kind, title, body, ago) on l.title like x.title_like
 where l.company_id = :'co';
-- the overdue invoice of Bar Komiteti: the sales manager chased it
insert into entity_activities (company_id, entity_type, entity_id, activity_type, body, occurred_at)
select :'co', 'sales_invoices', i.id, 'comment', 'E mora në telefon pronarin më ' || to_char(current_date - 4, 'DD.MM') || '. Tha se paguan këtë javë me transfertë.', now() - interval '4 days'
  from sales_invoices i join business_partners bp on bp.id = i.partner_id
 where i.company_id = :'co' and bp.code = 'C003' and i.payment_status = 'unpaid' and i.document_type = 'sales_invoice'
 order by i.invoice_date limit 1;

-- a quote Spar let expire
insert into sales_quotes (company_id, partner_id, currency_code, salesperson_id, quote_date, valid_until, terms)
values (:'co', :'c_spar', 'ALL', :'u_elira', current_date - 40, current_date - 26, 'Çmimet vlejnë për 14 ditë.') returning id as q_exp \gset
insert into sales_quote_lines (company_id, quote_id, line_no, variant_id, description, quantity, unit_price, tax_code_id)
select :'co', :'q_exp', 1, v.id, v.name, 120, 2650, :'vat20' from product_variants v where v.company_id = :'co' and v.sku = 'HB-250';
update sales_quotes set status = 'sent' where id = :'q_exp';
update sales_quotes set status = 'expired' where id = :'q_exp';

-- Fermat Lushnja accepted the price difference on its last bill and sent a credit note
select set_config('request.jwt.claim.sub', :'u_arta', false);
select public.create_vendor_credit(:'b_fl') as vc_fl \gset
update vendor_bills set vendor_invoice_number = 'FL/10/2290-K', notes = 'Diferenca e çmimit: faturuar 93,40 në vend të 92,00 lekë/litër' where id = :'vc_fl';
update vendor_bill_lines set unit_price = 1.40, description = 'Kthim i diferencës së çmimit — qumësht 1 L' where bill_id = :'vc_fl';
select public.post_vendor_bill(:'vc_fl');

-- coffee and mugs for the store, prepared by the warehouse, not sent yet
select set_config('request.jwt.claim.sub', :'u_besnik', false);
insert into stock_transfers (company_id, from_warehouse_id, to_warehouse_id, transfer_date, notes)
values (:'co', :'wh', :'st', current_date + 1, 'Për vitrinën e Krishtlindjeve') returning id as trf3 \gset
insert into stock_transfer_lines (company_id, transfer_id, variant_id, from_location_id, to_location_id, quantity)
select :'co', :'trf3', v.id, :'stock', :'floor', x.q from product_variants v join (values ('HB-1KG', 4), ('MUG-CER', 12)) x(sku, q) on x.sku = v.sku where v.company_id = :'co';
select set_config('request.jwt.claim.sub', :'u_arta', false);
