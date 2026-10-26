-- =============================================================================
-- DrisPRO · the outside accountant: free seat, all clients on one page (runs after 01–36)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

set role authenticated;
select t.login('zoe@platform.io');
select public.platform_create_client(jsonb_build_object('name', 'Klienti A', 'country', 'XK', 'owner_email', 'alice@alba.al', 'plan', 'pro', 'max_users', 1,
  'valid_until', (current_date + 365)::text)) as ca \gset
select public.platform_create_client(jsonb_build_object('name', 'Klienti B', 'country', 'AL', 'owner_email', 'alice@alba.al', 'plan', 'pro', 'max_users', 1,
  'valid_until', (current_date + 365)::text)) as cb \gset
select t.login('alice@alba.al');
select t.throws(format($q$select public.invite_member(%L, 'bob@kosova.xk', array['accountant'])$q$, :'ca'), 'allows 1 users', 'the licence is full');
select public.invite_accountant(:'ca', 'bob@kosova.xk') as m1 \gset
select t.ok(app.seats_used(:'ca') = 1, 'the outside accountant does not take a seat');
select t.ok((select external_accountant from public.company_users(:'ca') where member_id = :'m1'), 'the users list shows who the outside accountant is');
select t.throws(format($q$select public.invite_accountant(%L, 'someone@else.al')$q$, :'ca'), 'already has its outside accountant', 'one free accountant per company');
select public.invite_accountant(:'cb', 'bob@kosova.xk');

-- the accountant's page
reset role;
insert into public.business_partners (company_id, code, name, is_customer) values (:'ca', 'C1', 'Klient', true) returning id as cust \gset
insert into public.vendor_bills (company_id, vendor_id, vendor_invoice_number, bill_date, due_date, currency_code)
  select :'ca', id, 'X-1', current_date, current_date, 'EUR' from public.business_partners where id = :'cust';
set role authenticated;
select t.login('bob@kosova.xk');
select public.accountant_overview() as ov \gset
select t.ok((select count(*) from jsonb_array_elements(:'ov'::jsonb) x where x ->> 'id' in (:'ca', :'cb')) = 2, 'the accountant sees all their clients together');
select t.ok((select (x ->> 'draft_bills')::int = 1 and (x ->> 'outside')::boolean from jsonb_array_elements(:'ov'::jsonb) x where x ->> 'id' = :'ca'),
  'with what waits in each one');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
