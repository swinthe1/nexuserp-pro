-- =============================================================================
-- DrisPRO · the demo supermarket (runs after 01–31). The tills run for one day here, not thirty.
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

set role authenticated;
select t.login('alice@alba.al');
select t.throws($q$select public.platform_create_demo_client('{"owner_email":"x@y.com","owner_password":"demo12345"}')$q$, 'platform administrator', 'only the platform makes demos');
select t.login('zoe@platform.io');
select (public.platform_create_demo_client('{"name":"Market Demo W","owner_email":"demo@market-test.com","owner_password":"demo12345"}') ->> 'company_id') as co \gset
select t.ok((select base_currency from public.companies where id = :'co') = 'EUR' and (select country_code from public.companies where id = :'co') = 'XK', 'a Kosovo company in euro');
select t.login('zoe@platform.io'); select public.platform_demo_fill(:'co', 2);
select t.login('zoe@platform.io'); select public.platform_demo_fill(:'co', 3);
select 3 + 2 * app.demo_days() as vl \gset
select t.login('zoe@platform.io'); select public.platform_demo_fill(:'co', :vl - 1);
select t.login('zoe@platform.io'); select public.platform_demo_fill(:'co', :vl);
select t.login('zoe@platform.io'); select public.platform_demo_fill(:'co', :vl + 1);
select t.login('zoe@platform.io'); select public.platform_demo_fill(:'co', :vl + 2);
select t.login('zoe@platform.io'); select public.platform_demo_fill(:'co', :vl + 3);
select t.login('zoe@platform.io'); select (public.platform_demo_fill(:'co', :vl + 4) ->> 'next') is null as last \gset
select t.ok(:'last', 'the last step says there is nothing left');
-- a real client is never filled with sample data
select public.platform_create_client(jsonb_build_object('name', 'Real', 'country', 'XK', 'owner_email', 'alice@alba.al')) as real_co \gset
select t.throws(format($q$select public.platform_demo_fill(%L, 2)$q$, :'real_co'), 'Only a demo client', 'a real client is not filled');

-- what each type of business is given
select public.platform_create_client(jsonb_build_object('name', 'Hotel Tipi', 'country', 'XK', 'owner_email', 'alice@alba.al', 'business_type', 'hotel')) as h_co \gset
select public.platform_create_client(jsonb_build_object('name', 'Market Tipi', 'country', 'XK', 'owner_email', 'alice@alba.al', 'business_type', 'retail')) as r_co \gset
reset role;
select t.ok((select not ('Hotel' = any (hidden_menu_sections)) and '/sales/deliveries' = any (hidden_menu_sections) and 'Manufacturing' = any (hidden_menu_sections)
               from public.company_settings where company_id = :'h_co'), 'a hotel gets the hotel, without deliveries or manufacturing');
select t.ok((select 'Hotel' = any (hidden_menu_sections) and '/pos/waiters' = any (hidden_menu_sections) and not ('Retail' = any (hidden_menu_sections))
               from public.company_settings where company_id = :'r_co'), 'a market gets the till, without the hotel or waiters');
select t.ok((select count(*) from public.products where company_id = :'co' and is_sellable) = 66, 'the catalogue: 66 things on the shelves');
select t.ok((select count(*) from public.product_barcodes where company_id = :'co') >= 50, 'packaged goods carry barcodes');
select t.ok((select count(*) from public.purchase_orders where company_id = :'co' and status in ('received', 'closed')) >= 20, 'orders received from the suppliers');
select t.ok((select count(*) from public.vendor_bills where company_id = :'co' and status = 'posted') >= 24, 'supplier and running-cost invoices booked');
select t.ok((select count(*) from public.work_orders where company_id = :'co' and status = 'closed') = 2 * (app.demo_days() / 3 + 1), 'the bakery bakes every third day since the opening, two kinds of bread');
select t.ok((select count(*) from public.pos_orders where company_id = :'co') > 50 and (select count(*) from public.z_reports where company_id = :'co') = 2,
  'yesterday on both tills, closed with a Z report each');
select t.ok((select count(*) from public.pos_sessions where company_id = :'co' and status = 'open') = 1, 'this morning''s till is open');
select t.ok((select count(*) from public.sales_invoices where company_id = :'co' and status = 'posted') = 12, 'eleven wholesale invoices and a credit note');
select t.ok((select count(*) from public.fixed_assets where company_id = :'co' and status = 'active') = 6, 'the shop''s fittings are assets');
select t.ok((select count(*) from public.payroll_runs where company_id = :'co' and status = 'paid') = 1, 'last month''s salaries paid');
select t.ok((select count(*) from public.leads where company_id = :'co') = 4 and (select count(*) from public.loyalty_cards where company_id = :'co') = 10, 'leads and loyalty cards');
select t.ok((select count(*) from public.vat_declarations where company_id = :'co') = 1, 'last month''s VAT return');
select t.ok(not exists (select 1 from public.stock_levels sl join public.warehouse_locations l on l.id = sl.location_id
                         where sl.company_id = :'co' and l.code like 'WH/%' and sl.on_hand < 0), 'the warehouse never goes below zero');
select t.ok((select sum(jl.debit) = sum(jl.credit) from public.journal_lines jl join public.journal_entries e on e.id = jl.entry_id
              where jl.company_id = :'co' and e.status in ('posted', 'reversed')), 'the books balance');
select t.ok((select sum(jl.debit - jl.credit) from public.journal_lines jl join public.journal_entries e on e.id = jl.entry_id
              where jl.company_id = :'co' and e.status in ('posted', 'reversed') and jl.account_id = app.demo_acc(:'co', '701')) < 0, 'sales are booked');

\set QUIET off
select count(*) as assertions_passed from t.results;
