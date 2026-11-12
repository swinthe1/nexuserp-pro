-- =============================================================================
-- ATK's technical test: a discount in euro on a till line and on the whole sale, the cashier's limit on them,
-- the sales book still reading the lines, and the SEF log as a chain of hashes that names a row that was touched.
-- (after 149 on "Kontrolle Test", till T10, bananas)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Kontrolle Test' \gset
select email as boss from public.profiles where is_super_admin limit 1 \gset
select id as reg from public.pos_registers where company_id = :'co' and code = 'T10' \gset
select id as ban from public.product_variants where sku = 'KT-BAN' and company_id = :'co' \gset
-- the cashier's limit counts the euro too
-- (the cashier sells in her own shift: one she has open, or a new one on a till nobody is on)
select (select s.id from public.pos_sessions s join public.profiles pr on pr.id = s.opened_by
 where s.company_id = :'co' and s.status = 'open' and pr.email = 'cora@kt.al' limit 1) as cses \gset
select coalesce((select s.register_id from public.pos_sessions s join public.profiles pr on pr.id = s.opened_by
   where s.company_id = :'co' and s.status = 'open' and pr.email = 'cora@kt.al' limit 1),
  (select r.id from public.pos_registers r where r.company_id = :'co' and r.deleted_at is null and r.id <> :'reg'
   and not exists (select 1 from public.pos_sessions s where s.register_id = r.id and s.status = 'open') order by r.code limit 1)) as creg \gset
set role authenticated;
select t.login('cora@kt.al');
\if :{?cses}
\else
select public.open_pos_session(:'creg', 0) as cses \gset
\endif
select price as cp from public.pos_catalog(:'creg') where variant_id = :'ban' \gset
select t.throws(format($$select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', %L,
  'lines', jsonb_build_array(jsonb_build_object('variant_id', %L, 'quantity', 2, 'unit_price', %s, 'discount_amount', %s)),
  'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', %s))))$$, :'cses', :'ban', :cp, round(:cp, 2), round(:cp, 2)), 'need a manager',
  'half the line off in euro needs a manager, like in %');


select t.login(:'boss');
select coalesce((select id from public.pos_sessions where register_id = :'reg' and status = 'open' limit 1), public.open_pos_session(:'reg', 0)) as ses \gset
select price as p from public.pos_catalog(:'reg') where variant_id = :'ban' \gset

-- 4 pieces, 10 % off, then 0.50 € off the line (0.30 € of it from a discount on the whole sale)
select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', :'ses', 'sale_discount', 0.30, 'sale_discount_pct', 5,
  'lines', jsonb_build_array(jsonb_build_object('variant_id', :'ban', 'quantity', 4, 'unit_price', :p, 'discount_pct', 10, 'discount_amount', 0.50)),
  'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', round(4 * :p * 0.9, 2) - 0.50)))) ->> 'id' as ord \gset
reset role;
select t.ok((select line_total = round(4 * :p * 0.9, 2) - 0.50 and discount_amount = 0.50 and line_subtotal + tax_amount = line_total
  from public.pos_order_lines where pos_order_id = :'ord'), 'a discount in euro comes off the line after the one in %, VAT and base still add up');
select t.ok((select total = round(4 * :p * 0.9, 2) - 0.50 and sale_discount = 0.30 and sale_discount_pct = 5 from public.pos_orders where id = :'ord'),
  'the order keeps what was given on the whole sale');
select t.ok((select count(*) > 0 from public.v_sales_book where company_id = :'co'), 'the sales book still reads the till lines');
set role authenticated;
select t.login(:'boss');
select t.throws(format($$select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', %L,
  'lines', jsonb_build_array(jsonb_build_object('variant_id', %L, 'quantity', 1, 'unit_price', %s, 'discount_amount', %s)),
  'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 0))))$$, :'ses', :'ban', :p, :p + 1), 'more than the line', 'a discount bigger than the line is refused');

-- the SEF log is a chain
reset role;
select app.atk_change(:'co', :'reg', 'test_a', '1', '2');
select app.atk_change(:'co', :'reg', 'test_b', '2', '3');
select t.ok((select count(*) = 0 from public.atk_events where company_id = :'co' and (hash is null or payload is null)), 'every row of the log has its payload and its hash');
select t.ok((select e.prev_hash = (select p.hash from public.atk_events p where p.company_id = e.company_id and p.id < e.id order by p.id desc limit 1)
  from public.atk_events e where e.company_id = :'co' order by e.id desc limit 1), 'a row carries the hash of the row before it');
set role authenticated;
select t.login(:'boss');
select t.ok((public.atk_log_verify(:'co') ->> 'ok')::boolean, 'the chain holds');
reset role;
select id as ev, details as was from public.atk_events where company_id = :'co' and details ->> 'what' = 'test_a' order by id desc limit 1 \gset
select set_config('app.allow_hard_delete', 'on', false);
update public.atk_events set details = details || '{"to":"9"}' where id = :ev;
set role authenticated;
select t.login(:'boss');
select t.ok(not (public.atk_log_verify(:'co') ->> 'ok')::boolean and (public.atk_log_verify(:'co') -> 'broken') @> to_jsonb(:ev::bigint),
  'a row changed behind the program''s back breaks the chain and is named');
reset role;
update public.atk_events set details = :'was'::jsonb where id = :ev;
select set_config('app.allow_hard_delete', 'off', false);
select t.ok((select (app.atk_coupon_of(r, jsonb_build_object('env', 'test', 'coupon_id', '1', 'seq', '1', 'details', 'AAAAAAAAAAAA', 'signature', repeat('A', 60), 'qr', 'AAAA|BBBB',
  'type', '0', 'total', '100', 'tax', '10', 'print', '{"lines":[{"list":15000,"off":50}]}'::jsonb)) -> 'print' -> 'lines' -> 0 ->> 'off') = '50'
  from public.pos_registers r where r.id = :'reg'), 'the coupon keeps the shelf prices and the discounts for its copies');
\set QUIET off
select count(*) as assertions_passed from t.results;
