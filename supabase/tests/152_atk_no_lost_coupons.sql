-- =============================================================================
-- No fiscal coupon gets lost silently: a number that never arrived leaves a gap the server writes down and lists,
-- the gap closes when the coupon arrives late, and a coupon the server refused is in the log once.
-- (after 151 on "Kontrolle Test", till T10, bananas)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Kontrolle Test' \gset
select email as boss from public.profiles where is_super_admin limit 1 \gset
select id as reg from public.pos_registers where company_id = :'co' and code = 'T10' \gset
select id as ban from public.product_variants where sku = 'KT-BAN' and company_id = :'co' \gset
create or replace function t.fiscal_sale(p_ses uuid, p_var uuid, p_price numeric, p_seq int) returns jsonb language sql as $$
  select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', p_ses,
    'lines', jsonb_build_array(jsonb_build_object('variant_id', p_var, 'quantity', 1, 'unit_price', p_price)),
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', p_price)),
    'fiscal', jsonb_build_object('env', 'test', 'coupon_id', (101000000000 + p_seq)::text, 'seq', p_seq::text, 'pos_id', '1', 'branch_id', '1', 'verification_no', lpad(p_seq::text, 16, '7'),
      'details', 'AAAAAAAAAAAA', 'signature', repeat('A', 64), 'qr', 'AAAA|BBBB', 'type', '0', 'total', round(p_price * 100)::text, 'tax', '0')))
$$;
grant execute on function t.fiscal_sale(uuid, uuid, numeric, int) to authenticated;
set role authenticated;
select t.login(:'boss');
select coalesce((select id from public.pos_sessions where register_id = :'reg' and status = 'open' limit 1), public.open_pos_session(:'reg', 0)) as ses \gset
select price as p from public.pos_catalog(:'reg') where variant_id = :'ban' \gset

select t.fiscal_sale(:'ses', :'ban', :p, 5) is not null as a \gset
select t.fiscal_sale(:'ses', :'ban', :p, 8) is not null as b \gset
select t.ok((select count(*) = 1 from jsonb_array_elements(public.atk_missing_numbers(:'co')) g where (g ->> 'from')::int = 6 and (g ->> 'to')::int = 7 and (g ->> 'missing')::int = 2),
  'numbers 6 and 7 never arrived: the server lists them');
reset role;
select t.ok((select count(*) = 1 from public.atk_events where company_id = :'co' and kind = 'gap' and details ->> 'from' = '6' and details ->> 'to' = '7'),
  'and the gap is in the SEF log from the moment number 8 came in');
set role authenticated;
select t.login(:'boss');
select t.fiscal_sale(:'ses', :'ban', :p, 6) is not null as c \gset
select t.fiscal_sale(:'ses', :'ban', :p, 7) is not null as d \gset
select t.ok((select count(*) = 0 from jsonb_array_elements(public.atk_missing_numbers(:'co')) g where (g ->> 'from')::int between 6 and 7),
  'the coupons arrive late: nothing is missing any more');

select public.atk_report_stuck(:'reg', jsonb_build_object('env', 'test', 'coupon_id', '101000000099', 'seq', '99', 'details', 'AAAAAAAAAAAA', 'signature', repeat('A', 64), 'total', '150'), 'The sale was refused');
select public.atk_report_stuck(:'reg', jsonb_build_object('env', 'test', 'coupon_id', '101000000099', 'seq', '99', 'details', 'AAAAAAAAAAAA', 'signature', repeat('A', 64), 'total', '150'), 'The sale was refused');
reset role;
select t.ok((select count(*) = 1 and bool_and(details ? 'coupon_payload' and amount = 1.50) from public.atk_events where company_id = :'co' and kind = 'stuck' and coupon_no = 101000000099),
  'a signed coupon the server refused is in the log, once, with what was signed');
set role authenticated;
select t.login('pronari@arberi.xk');
select t.throws(format('select public.atk_missing_numbers(%L)', :'co'), '', 'not for another company');
select t.throws(format('select public.atk_report_stuck(%L, %L, %L)', :'reg', '{}', 'x'), 'Not your till', 'nor its till');
reset role;
drop function t.fiscal_sale(uuid, uuid, numeric, int);
\set QUIET off
select count(*) as assertions_passed from t.results;
