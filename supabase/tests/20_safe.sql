-- =============================================================================
-- DrisPRO · Sefi, the shop safe (runs after 01–19; uses the shop from 06)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

insert into auth.users (email, raw_user_meta_data) values ('sami@wms.al', '{"full_name":"Sami Shop Manager"}');

set role authenticated;
select t.login('ana@auto.xk');
select id as co from public.companies where name = 'Automatika Test' \gset
select public.invite_member(:'co', 'sami@wms.al', array['store_manager']);
select id as tea from public.product_variants where company_id = :'co' and sku = 'COLA' \gset
select id as shop from public.warehouses where company_id = :'co' order by created_at limit 1 \gset
select id as floor from public.warehouse_locations where company_id = :'co' and warehouse_id = :'shop' order by created_at limit 1 \gset
select id as bank from public.bank_accounts where company_id = :'co' and account_kind = 'bank' and deleted_at is null limit 1 \gset
select id as rent from public.accounts where company_id = :'co' and account_type = 'expense' and is_postable and deleted_at is null order by code limit 1 \gset
select id as receivable from public.accounts where company_id = :'co' and account_subtype = 'receivable' limit 1 \gset
insert into public.bank_accounts (company_id, name, account_kind, currency_code, account_id)
select :'co', 'Till 8 drawer', 'cash', 'EUR', id from public.accounts where company_id = :'co' and code = '5311' returning id as drawer \gset
insert into public.pos_registers (company_id, code, name, warehouse_id, location_id, cash_account_id, journal_id)
select :'co', 'T8', 'Till 8', :'shop', :'floor', :'drawer', id from public.journals where company_id = :'co' and code = 'POS' returning id as reg \gset

create or replace function pg_temp.safe(p_co uuid, p_name text) returns jsonb language sql as $$
  select s from jsonb_array_elements(public.safes_overview(p_co) -> 'safes') s where s ->> 'name' = p_name
$$;
create or replace function pg_temp.bal(p_co uuid, p_name text) returns numeric language sql as $$
  select (pg_temp.safe(p_co, p_name) ->> 'balance')::numeric
$$;

-- setting up
select t.login('kasa@auto.xk');
select t.throws(format($q$select public.safes_overview('%s')$q$, :'co'), 'permission', 'a cashier does not see the safe');
select t.login('sami@wms.al');
select t.throws(format($q$select public.safe_save('{"company_id":"%s","name":"Mine"}')$q$, :'co'), 'permission', 'a shop manager cannot make safes');
select t.login('ana@auto.xk');
select public.safe_save(jsonb_build_object('company_id', :'co', 'name', 'Sefi i dyqanit', 'warehouse_id', :'shop', 'approval_limit', 200, 'tolerance', 5)) as ss \gset
select public.safe_save(jsonb_build_object('company_id', :'co', 'name', 'Sefi qendror')) as cs \gset
select t.ok((select a.account_subtype = 'cash' and a.code like '531_' from public.safes s join public.bank_accounts b on b.id = s.bank_account_id
               join public.accounts a on a.id = b.account_id where s.id = :'ss'), 'a new safe gets its own cash account next to the cash box');
select t.ok((select count(distinct b.account_id) = 2 from public.safes s join public.bank_accounts b on b.id = s.bank_account_id where s.company_id = :'co'),
  'each safe has a different account');
select t.ok(pg_temp.bal(:'co', 'Sefi i dyqanit') = 0 and (public.safes_overview(:'co') -> 'can' ->> 'approve')::boolean, 'a new safe is empty');
select t.ok(pg_temp.safe(:'co', 'Sefi i dyqanit') -> 'tills' ? 'Till 8', 'the tills of the shop empty into its safe');

-- a shift: the drawer is emptied into the shop safe
select t.login('kasa@auto.xk');
select public.open_pos_session(:'reg', 0) as ses \gset
select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', :'ses',
  'lines', jsonb_build_array(jsonb_build_object('variant_id', :'tea', 'quantity', 2, 'unit_price', 120, 'discount_pct', 0, 'manual_pct', 0)),
  'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 240))));
select public.close_pos_session(:'ses', 240);
select t.login('sami@wms.al');
select t.ok(pg_temp.bal(:'co', 'Sefi i dyqanit') = 240, 'closing the till puts its cash in the shop safe');

-- money in, to the bank, and back on the statement
select public.safe_move(jsonb_build_object('safe_id', :'ss', 'kind', 'cash_in', 'amount', 1000, 'reason', 'Kusur nga pronari'));
select t.ok(pg_temp.bal(:'co', 'Sefi i dyqanit') = 1240, 'the owner brings change');
select public.safe_move(jsonb_build_object('safe_id', :'ss', 'kind', 'deposit', 'amount', 500, 'bank_account_id', :'bank', 'reason', 'Derdhja e së hënës', 'reference', 'FL-1')) as dep \gset
select t.ok((:'dep'::jsonb ->> 'status') = 'in_transit' and pg_temp.bal(:'co', 'Sefi i dyqanit') = 740, 'a deposit leaves the safe and is on its way');
select t.ok(jsonb_array_length(public.safes_overview(:'co') -> 'on_the_way') = 1, 'the deposit is listed as on its way');
select t.throws(format($q$select public.safe_move('{"safe_id":"%s","kind":"deposit","amount":10,"reason":"x"}')$q$, :'ss'), 'bank account', 'a deposit needs the bank');
select public.safe_deposit_arrived((:'dep'::jsonb ->> 'id')::uuid);
select t.ok(jsonb_array_length(public.safes_overview(:'co') -> 'on_the_way') = 0, 'once it arrives it is no longer on its way');
select t.throws(format($q$select public.safe_deposit_arrived('%s')$q$, :'dep'::jsonb ->> 'id'), 'not on its way', 'a deposit arrives once');

-- taking money out: small goes, large waits for approval
select public.safe_move(jsonb_build_object('safe_id', :'ss', 'kind', 'withdrawal', 'amount', 300, 'reason', 'Për pronarin')) as big \gset
select t.ok((:'big'::jsonb ->> 'status') = 'pending' and pg_temp.bal(:'co', 'Sefi i dyqanit') = 740, 'above the limit it waits and nothing leaves');
select public.safe_move(jsonb_build_object('safe_id', :'ss', 'kind', 'withdrawal', 'amount', 100, 'reason', 'Kafe për stafin'));
select t.ok(pg_temp.bal(:'co', 'Sefi i dyqanit') = 640, 'under the limit it goes at once');
select t.throws(format($q$select public.safe_move('{"safe_id":"%s","kind":"withdrawal","amount":5000,"reason":"x"}')$q$, :'ss'), 'has only', 'the safe cannot give more than it has');
select t.throws(format($q$select public.safe_move('{"safe_id":"%s","kind":"withdrawal","amount":5,"reason":" "}')$q$, :'ss'), 'why', 'every movement says why');
select t.throws(format($q$select public.safe_decide('%s', true)$q$, :'big'::jsonb ->> 'id'), 'permission', 'a shop manager cannot approve');
select t.login('kasa@auto.xk');
select t.throws(format($q$select public.safe_move('{"safe_id":"%s","kind":"withdrawal","amount":5,"reason":"x"}')$q$, :'ss'), 'permission', 'a cashier cannot take from the safe');

select t.login('ana@auto.xk');
select t.ok(exists (select 1 from public.notifications where user_id = auth.uid() and link = '/safe?approve=' || (:'big'::jsonb ->> 'id')), 'the approver is told');
select t.ok(jsonb_array_length(public.safes_overview(:'co') -> 'waiting') = 1, 'the request waits on the safe screen');
select public.safe_decide((:'big'::jsonb ->> 'id')::uuid, true);
select t.ok(pg_temp.bal(:'co', 'Sefi i dyqanit') = 340, 'approved, the money leaves');
select t.ok((select jl.debit from public.journal_lines jl join public.safe_movements m on m.journal_entry_id = jl.entry_id
              where m.id = (:'big'::jsonb ->> 'id')::uuid and jl.account_id = (select account_id from public.company_account_defaults where company_id = :'co' and key = 'owner_drawings')) = 300,
  'what the owner takes goes to owner drawings');
select t.throws(format($q$select public.safe_decide('%s', true)$q$, :'big'::jsonb ->> 'id'), 'already decided', 'a request is decided once');

select t.login('sami@wms.al');
select t.ok(exists (select 1 from public.notifications where user_id = auth.uid() and title like 'Approved: %'), 'the one who asked hears back');
select public.safe_move(jsonb_build_object('safe_id', :'ss', 'kind', 'withdrawal', 'amount', 250, 'reason', 'Edhe pak')) as no \gset
select t.login('ana@auto.xk');
select t.throws(format($q$select public.safe_decide('%s', false)$q$, :'no'::jsonb ->> 'id'), 'why you refuse', 'a refusal says why');
select public.safe_decide((:'no'::jsonb ->> 'id')::uuid, false, 'Jo sot');
select t.ok(pg_temp.bal(:'co', 'Sefi i dyqanit') = 340, 'refused, nothing leaves');
select t.throws(format($q$select public.safe_move('{"safe_id":"%s","kind":"withdrawal","amount":900,"reason":"x"}')$q$, :'ss'), 'has only', 'not even the owner takes more than there is');

-- between safes and expenses
select t.login('sami@wms.al');
select public.safe_move(jsonb_build_object('safe_id', :'ss', 'kind', 'transfer', 'amount', 40, 'to_safe_id', :'cs', 'reason', 'Te zyra'));
select t.ok(pg_temp.bal(:'co', 'Sefi i dyqanit') = 300 and pg_temp.bal(:'co', 'Sefi qendror') = 40, 'a transfer moves money between safes');
select t.throws(format($q$select public.safe_move('{"safe_id":"%s","kind":"expense","amount":20,"reason":"x","account_id":"%s"}')$q$, :'ss', :'receivable'), 'kind of expense', 'an expense needs an expense account');
select public.safe_move(jsonb_build_object('safe_id', :'ss', 'kind', 'expense', 'amount', 20, 'account_id', :'rent', 'reason', 'Pastrimi'));
select t.ok(pg_temp.bal(:'co', 'Sefi i dyqanit') = 280, 'an expense is paid from the safe');

-- counting
select public.safe_count(:'ss', '{"200":1,"50":1,"20":1,"5":1}') as c1 \gset
select t.ok((:'c1'::jsonb ->> 'difference')::numeric = -5 and pg_temp.bal(:'co', 'Sefi i dyqanit') = 275, 'a small difference is booked without a note');
select t.throws(format($q$select public.safe_count('%s', '{"100":2}')$q$, :'ss'), 'write what happened', 'a big difference needs a note');
select t.throws(format($q$select public.safe_count('%s', '{"3":1}')$q$, :'ss'), 'no note or coin', 'only real notes and coins');
select public.safe_count(:'ss', '{"100":2}', 'Mungojnë 75, po kontrollojmë kamerën');
select t.ok(pg_temp.bal(:'co', 'Sefi i dyqanit') = 200 and (pg_temp.safe(:'co', 'Sefi i dyqanit') -> 'last_count' ->> 'difference')::numeric = -75,
  'after the count the safe holds what was counted');
select t.login('ana@auto.xk');
select t.ok(exists (select 1 from public.notifications where user_id = auth.uid() and title like 'Safe count difference at Sefi i dyqanit%'), 'a big difference is reported');

-- the book
select public.safe_book(:'ss', current_date - 1, current_date) as book \gset
select t.ok((:'book'::jsonb ->> 'opening')::numeric = 0 and (:'book'::jsonb ->> 'closing')::numeric = 200
            and (:'book'::jsonb -> 'lines' -> -1 ->> 'balance')::numeric = 200, 'the book runs from what was there to what is there');
select t.ok(exists (select 1 from jsonb_array_elements(:'book'::jsonb -> 'lines') l where l ->> 'kind' = 'till')
            and exists (select 1 from jsonb_array_elements(:'book'::jsonb -> 'lines') l where l ->> 'kind' = 'count'), 'the book shows tills and counts');

-- the till takes its float from the safe it is set to
select public.pos_register_set_safe(:'reg', :'cs');
select t.login('kasa@auto.xk');
select public.open_pos_session(:'reg', 30) as ses2 \gset
select t.login('ana@auto.xk');
select t.ok(pg_temp.bal(:'co', 'Sefi qendror') = 10, 'the float comes out of the till''s safe');
select t.throws(format($q$select public.pos_register_set_safe('%s', null)$q$, :'reg'), 'open shift', 'a till changes safe only between shifts');

reset role;
select t.ok(not exists (select 1 from public.safe_movements where status in ('posted','in_transit') and journal_entry_id is null), 'every movement that happened is in the books');
select t.ok(not exists (select 1 from public.safe_movements m where m.status = 'posted' and m.kind = 'deposit' and m.arrived_entry_id is null), 'every arrived deposit has its bank entry');
select t.ok((select coalesce(sum(jl.debit - jl.credit), 0) from public.journal_lines jl join public.journal_entries je on je.id = jl.entry_id
              where je.company_id = :'co' and je.status = 'posted'
                and jl.account_id = (select account_id from public.company_account_defaults where company_id = :'co' and key = 'cash_in_transit')) = 0,
  'nothing is left on its way');

\set QUIET off
select count(*) as assertions_passed from t.results;
