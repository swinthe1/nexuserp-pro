-- =============================================================================
-- #17 by unit: a unit's own limit for one receipt; without one, the company's  (runs after 92 on "Kontrolle Test")
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Kontrolle Test' \gset
select email as boss from public.profiles where is_super_admin limit 1 \gset
select id as reg from public.pos_registers where company_id = :'co' and code = 'T10' \gset
select warehouse_id as shop from public.pos_registers where id = :'reg' \gset
select id as ban from public.product_variants where sku = 'KT-BAN' and company_id = :'co' \gset
set role authenticated;
select t.login(:'boss');

select public.automation_settings_save(:'co', '{"pos_receipt_max": 1000}');
select public.pos_receipt_max_unit_save(:'co', :'shop', 50);
select t.ok((public.pos_till_options(:'reg') ->> 'receipt_max')::numeric = 50, 'the till of this unit works with the unit''s limit');
select t.ok(public.pos_receipt_max_units(:'co') @> jsonb_build_array(jsonb_build_object('warehouse_id', :'shop', 'receipt_max', 50)), 'the units with their limits');
select t.throws(format('select public.pos_receipt_max_unit_save(%L, %L, 0)', :'co', :'shop'), 'more than zero', 'a limit of zero is refused');

select coalesce((select id from public.pos_sessions where register_id = :'reg' and status = 'open' limit 1), public.open_pos_session(:'reg', 0)) as ses \gset
select t.throws(format($$select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', %L,
  'lines', jsonb_build_array(jsonb_build_object('variant_id', %L, 'quantity', 40, 'unit_price', 1.5)),
  'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 60))))$$, :'ses', :'ban'), 'at most 50', '60 € is over the unit''s 50 €');

select public.pos_receipt_max_unit_save(:'co', :'shop', null);
select t.ok((public.pos_till_options(:'reg') ->> 'receipt_max')::numeric = 1000, 'no limit of its own: the company''s');
select t.ok(public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', :'ses',
  'lines', jsonb_build_array(jsonb_build_object('variant_id', :'ban', 'quantity', 40, 'unit_price', 1.5)),
  'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 60)))) is not null, 'the same sale under the company''s 1 000 €');
select public.automation_settings_save(:'co', '{"pos_receipt_max": ""}');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
