-- =============================================================================
-- Testers' requests K-0003 and K-0013: partner balances over a period; the unit of a cash-book line.
-- (on "Kontrolle Test")
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Kontrolle Test' \gset
select email as boss from public.profiles where is_super_admin limit 1 \gset
set role authenticated;
select t.login(:'boss');
-- the balance at the start, plus what was added, less what was taken off, is the balance on the date: for every partner, both sides
select t.ok((
  with b as (select r ->> 'id' as id, (r ->> 'balance')::numeric as bal from jsonb_array_elements(public.partner_balances(:'co', 'vendor', current_date) -> 'rows') r),
       p as (select key as id, (value ->> 'opening')::numeric + (value ->> 'added')::numeric - (value ->> 'taken')::numeric as c
               from jsonb_each(public.partner_balances_period(:'co', 'vendor', (current_date - 30), current_date)))
  select count(*) filter (where abs(b.bal - coalesce(p.c, 0)) > 0.01) = 0 from b left join p using (id)), 'suppliers: start + added − taken off = the balance on the date');
select t.ok((
  with b as (select r ->> 'id' as id, (r ->> 'balance')::numeric as bal from jsonb_array_elements(public.partner_balances(:'co', 'customer', current_date) -> 'rows') r),
       p as (select key as id, (value ->> 'opening')::numeric + (value ->> 'added')::numeric - (value ->> 'taken')::numeric as c
               from jsonb_each(public.partner_balances_period(:'co', 'customer', (current_date - 30), current_date)))
  select count(*) filter (where abs(b.bal - coalesce(p.c, 0)) > 0.01) = 0 from b left join p using (id)), 'customers too');
select t.throws(format('select public.partner_balances_period(%L, %L, current_date, current_date - 1)', :'co', 'vendor'), 'Check the dates', 'the period ends after it starts');
-- a till's shift gives its cash lines the till's unit
select t.ok((
  select count(*) > 0 and bool_and(u.value = r.warehouse_id::text)
    from jsonb_each_text(public.cash_entry_units(:'co', current_date - 400, current_date)) u
    join public.journal_entries e on e.id = u.key::uuid and e.source_doc_type = 'pos_session'
    join public.pos_sessions ps on ps.id = e.source_doc_id join public.pos_registers r on r.id = ps.register_id), 'a shift''s cash belongs to the unit of its till');
select t.login('pronari@arberi.xk');
select t.throws(format('select public.partner_balances_period(%L, %L, current_date - 5, current_date)', :'co', 'vendor'), '', 'not for another company');
select t.throws(format('select public.cash_entry_units(%L, current_date - 5, current_date)', :'co'), 'Permission denied', 'nor its cash book');
reset role;
\set QUIET off
select count(*) as assertions_passed from t.results;
