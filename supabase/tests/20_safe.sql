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


-- ===================== phase 2: control =====================
select id as ana_m from public.company_members where company_id = :'co' and user_id = auth.uid() \gset
select m.id as sami_m from public.company_members m join public.profiles p on p.id = m.user_id where m.company_id = :'co' and p.email = 'sami@wms.al' \gset
select m.id as kasa_m from public.company_members m join public.profiles p on p.id = m.user_id where m.company_id = :'co' and p.email = 'kasa@auto.xk' \gset
select public.member_set_pin(:'ana_m', '4826');
select public.safe_move(jsonb_build_object('safe_id', :'ss', 'kind', 'cash_in', 'amount', 3000, 'reason', 'Nga pronari'));
select t.ok(pg_temp.bal(:'co', 'Sefi i dyqanit') = 3200, 'money put in needs no second person');

-- a second person for big money
select t.login('sami@wms.al');
select t.throws(format($q$select public.safe_move('{"safe_id":"%s","kind":"deposit","amount":1500,"bank_account_id":"%s","reason":"x"}')$q$, :'ss', :'bank'),
  'second person', 'above the limit one person cannot move the money');
select t.ok((public.safe_witness(:'co', :'ana_m', '0000') ->> 'error') = 'Wrong PIN', 'a wrong PIN of the second person is refused');
select t.throws(format($q$select public.safe_witness('%s', '%s', '1111')$q$, :'co', :'sami_m'), 'someone else', 'nobody is their own second person');
select t.throws(format($q$select public.safe_witness('%s', '%s', '1111')$q$, :'co', :'kasa_m'), 'may not handle', 'a cashier cannot be the second person');
select public.safe_witness(:'co', :'ana_m', '4826') ->> 'token' as wt \gset
select public.safe_move(jsonb_build_object('safe_id', :'ss', 'kind', 'deposit', 'amount', 1500, 'bank_account_id', :'bank', 'reason', 'Xhiroja', 'reference', 'FL-77', 'witness', :'wt')) as bigdep \gset
select t.ok((:'bigdep'::jsonb ->> 'status') = 'in_transit', 'with the second person''s PIN it goes');
select t.throws(format($q$select public.safe_move('{"safe_id":"%s","kind":"deposit","amount":1200,"bank_account_id":"%s","reason":"x","witness":"%s"}')$q$, :'ss', :'bank', :'wt'),
  'second person', 'a confirmation is good for one movement only');
select public.safe_move(jsonb_build_object('safe_id', :'ss', 'kind', 'deposit', 'amount', 100, 'bank_account_id', :'bank', 'reason', 'E vogël')) as smalldep \gset

-- the bank statement settles the deposit by itself
select t.login('ana@auto.xk');
insert into public.bank_statements (company_id, bank_account_id, statement_date, opening_balance, closing_balance)
values (:'co', :'bank', current_date, 0, 1500) returning id as stmt \gset
insert into public.bank_statement_lines (company_id, statement_id, transaction_date, description, amount)
values (:'co', :'stmt', current_date, 'Derdhje cash FL-77 Sefi', 1500) returning id as sline \gset
select t.ok((select status = 'posted' and arrived_on = current_date from public.safe_movements where id = (:'bigdep'::jsonb ->> 'id')::uuid),
  'a deposit on the bank statement arrives by itself');
select t.ok((select match_status = 'matched' and matched_journal_line_id is not null from public.bank_statement_lines where id = :'sline'), 'and the statement line is matched to it');
select t.ok((select witnessed_by = auth.uid() from public.safe_movements where id = (:'bigdep'::jsonb ->> 'id')::uuid), 'the movement remembers the second person');

-- every morning
reset role;
update public.safe_movements set moved_on = current_date - 5 where id = (:'smalldep'::jsonb ->> 'id')::uuid;
select app.safe_daily_checks() as n1 \gset
select app.safe_daily_checks() as n2 \gset
select t.ok(:n1 >= 1 and exists (select 1 from public.notifications where company_id = :'co' and title like 'Deposit SEF-%is not in the bank yet%'), 'a deposit late for the bank is reported');
select t.ok((select count(*) from public.notifications where company_id = :'co' and title like 'Deposit SEF-%is not in the bank yet%')
            = (select count(distinct user_id) from public.notifications where company_id = :'co' and title like 'Deposit SEF-%is not in the bank yet%'), 'and only once');
set role authenticated;
select t.login('ana@auto.xk');
select public.safe_deposit_arrived((:'smalldep'::jsonb ->> 'id')::uuid, current_date);
select public.safe_save(jsonb_build_object('id', :'ss', 'name', 'Sefi i dyqanit', 'warehouse_id', :'shop', 'approval_limit', 200, 'tolerance', 5, 'max_balance', 500, 'dual_limit', 1000));
reset role;
select app.safe_daily_checks();
select t.ok(exists (select 1 from public.notifications where company_id = :'co' and title like 'Sefi i dyqanit holds %'), 'a safe holding too much asks for the bank');
set role authenticated;

-- handing over
select t.login('sami@wms.al');
select public.safe_handover_start(:'ss', (select user_id from public.company_members where id = :'ana_m'), '{"500":3,"100":1}') as ho1 \gset
select t.throws(format($q$select public.safe_handover_start('%s', '%s', '{"500":3,"100":1}')$q$, :'ss', (select user_id from public.company_members where id = :'ana_m')),
  'already being handed', 'one handover at a time');
select t.throws(format($q$select public.safe_handover_accept('%s', '{"500":3,"100":1}')$q$, :'ho1'), 'Only the person', 'the giver cannot take it');
select t.login('ana@auto.xk');
select t.ok((select (h ->> 'to_me')::boolean and not (h ? 'given_total') from jsonb_array_elements(public.safes_overview(:'co') -> 'handovers') h), 'the taker sees it waiting, without the giver''s total');
select public.safe_handover_accept(:'ho1', '{"500":3,"50":2}') as acc1 \gset
select t.ok((:'acc1'::jsonb ->> 'difference')::numeric = 0 and (select holder_id = auth.uid() from public.safes where id = :'ss'), 'the counts agree and the taker holds the safe');
select public.safe_handover_start(:'ss', (select user_id from public.company_members where id = :'sami_m'), '{"500":3,"100":1}') as ho2 \gset
select t.login('sami@wms.al');
select t.throws(format($q$select public.safe_handover_accept('%s', '{"500":3,"50":1,"20":2}')$q$, :'ho2'), 'write what happened', 'a taker who counts less must say so');
select public.safe_handover_accept(:'ho2', '{"500":3,"50":1,"20":2}', 'Mungojnë 10') as acc2 \gset
select t.ok((:'acc2'::jsonb ->> 'difference')::numeric = -10 and pg_temp.bal(:'co', 'Sefi i dyqanit') = 1590, 'the difference is booked when the safe changes hands');
select public.safe_handover_start(:'ss', (select user_id from public.company_members where id = :'ana_m'), '{"500":3,"50":1,"20":2}') as ho3 \gset
select t.login('ana@auto.xk');
select t.ok(exists (select 1 from public.notifications where company_id = :'co' and title like 'Handover of Sefi i dyqanit does not agree%'), 'and reported');
select t.throws(format($q$select public.safe_handover_decline('%s')$q$, :'ho3'), 'why you refuse', 'a refusal says why');
select public.safe_handover_decline(:'ho3', 'Jam me pushim');
select t.ok((select status = 'declined' from public.safe_handovers where id = :'ho3') and (select holder_id <> auth.uid() from public.safes where id = :'ss'),
  'refused, the safe stays with the giver');


-- ===================== phase 3: the law's cash limits, differences, the assistant =====================
select t.ok((public.cash_limits(:'co') ->> 'business')::numeric = 500 and (public.cash_limits(:'co') ->> 'individual')::numeric = 2000,
  'a Kosovo company starts with the legal limits: 500 between businesses, 2,000 with individuals');
select id as cashbox from public.bank_accounts where company_id = :'co' and account_kind = 'cash' and id = (select bank_account_id from public.safes where id = :'cs') \gset
insert into public.business_partners (company_id, code, name, is_customer, kind) values (:'co', 'BIZ1', 'Market Dardania', true, 'company') returning id as biz \gset
insert into public.business_partners (company_id, code, name, is_customer, kind) values (:'co', 'IND1', 'Blerim Gashi', true, 'individual') returning id as ind \gset
insert into public.payments (company_id, document_type, partner_id, method, amount, currency_code, bank_account_id, payment_date)
values (:'co', 'customer_payment', :'biz', 'cash', 400, 'EUR', :'cashbox', current_date) returning id as cp1 \gset
select public.post_payment(:'cp1');
select t.ok(not (public.cash_limit_preview(:'co', :'biz', 50, current_date, :'cashbox', 'cash') ->> 'over')::boolean, 'under the limit nothing is said');
select t.ok((public.cash_limit_preview(:'co', :'biz', 150, current_date, :'cashbox', 'cash') ->> 'total')::numeric = 550, 'payments on the same day add up');
select t.ok(public.cash_limit_preview(:'co', :'biz', 150, current_date, :'bank', 'bank_transfer') is null, 'through the bank there is no limit');
insert into public.payments (company_id, document_type, partner_id, method, amount, currency_code, bank_account_id, payment_date)
values (:'co', 'customer_payment', :'biz', 'cash', 150, 'EUR', :'cashbox', current_date) returning id as cp2 \gset
select public.post_payment(:'cp2');
select t.ok(exists (select 1 from public.notifications where user_id = auth.uid() and title = 'Cash above the legal limit: Market Dardania'), 'split cash above the limit is reported');
select public.cash_limits_save(:'co', 500, 2000, true);
insert into public.payments (company_id, document_type, partner_id, method, amount, currency_code, bank_account_id, payment_date)
values (:'co', 'customer_payment', :'ind', 'cash', 2500, 'EUR', :'cashbox', current_date) returning id as cp3 \gset
select t.throws(format($q$select public.post_payment('%s')$q$, :'cp3'), 'limited by law', 'when the company chooses, cash above the limit is refused');
select t.ok((select status = 'draft' from public.payments where id = :'cp3'), 'and the payment stays a draft');
select public.cash_limits_save(:'co', 300, 2000, false);
select t.ok((public.cash_limits(:'co') ->> 'business')::numeric = 300, 'the announced 300 limit can be set as soon as it is in force');

select public.safe_differences(:'co', current_date - 1, current_date) as diffs \gset
select t.ok(exists (select 1 from jsonb_array_elements(:'diffs'::jsonb) d where d ->> 'name' = 'Sami Shop Manager' and (d ->> 'count_diff')::numeric <= -10
                                                                          and (d ->> 'handovers_off')::int = 1), 'differences by person: counts and handovers');
select public.ai_safes(:'co') as ais \gset
select t.ok((:'ais'::jsonb ->> 'total')::numeric = (select sum(app_bal) from (select (s ->> 'balance')::numeric as app_bal from jsonb_array_elements(public.safes_overview(:'co') -> 'safes') s) x)
            and jsonb_array_length(:'ais'::jsonb -> 'recent_movements') > 0, 'the assistant sees the safes, their total and the last movements');
select t.login('kasa@auto.xk');
select t.throws(format($q$select public.ai_safes('%s')$q$, :'co'), 'permission', 'the cashier''s assistant does not see the safe');
select t.login('ana@auto.xk');

reset role;
select t.ok(not exists (select 1 from public.safe_movements where status in ('posted','in_transit') and journal_entry_id is null), 'every movement that happened is in the books');
select t.ok(not exists (select 1 from public.safe_movements m where m.status = 'posted' and m.kind = 'deposit' and m.arrived_entry_id is null), 'every arrived deposit has its bank entry');
select t.ok((select coalesce(sum(jl.debit - jl.credit), 0) from public.journal_lines jl join public.journal_entries je on je.id = jl.entry_id
              where je.company_id = :'co' and je.status = 'posted'
                and jl.account_id = (select account_id from public.company_account_defaults where company_id = :'co' and key = 'cash_in_transit')) = 0,
  'nothing is left on its way');

\set QUIET off
select count(*) as assertions_passed from t.results;
