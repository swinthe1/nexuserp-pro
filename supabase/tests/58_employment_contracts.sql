-- =============================================================================
-- DrisPRO · employment contracts: number, signing, frozen once signed, annex, ending, own view
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
insert into auth.users (email, raw_user_meta_data) values ('hana@kp.al', '{"full_name":"Hana HR"}'), ('eda@kp.al', '{"full_name":"Eda Employee"}') on conflict do nothing;
select id as u_eda from auth.users where email = 'eda@kp.al' \gset
select email as boss from public.profiles where is_super_admin limit 1 \gset
set role authenticated;
select t.login(:'boss');
select public.create_company('Kontrata Test', 'AL') as co \gset
select public.invite_member(:'co', 'hana@kp.al', array['hr_manager']);
select t.accept_invites();
select public.invite_member(:'co', 'eda@kp.al', array['employee']);
select t.accept_invites();
select t.login('hana@kp.al');
insert into public.employees (company_id, user_id, first_name, last_name, hire_date) values (:'co', :'u_eda', 'Eda', 'Employee', current_date - 300) returning id as eda \gset
insert into public.employment_contracts (company_id, employee_id, start_date, gross_salary, currency_code) values (:'co', :'eda', current_date - 300, 100000, 'ALL');

insert into public.employees (company_id, first_name, last_name, hire_date) values (:'co', 'Drita', 'Kontrata', current_date - 60) returning id as drita \gset
insert into public.employment_contracts (company_id, employee_id, contract_type, start_date, gross_salary, currency_code, status, job_title, probation_months, annual_leave_days, body)
values (:'co', :'drita', 'indefinite', current_date - 60, 90000, 'ALL', 'draft', 'Arkëtare', 3, 28, 'Teksti i kontratës')
returning id as k1, number as k1_no \gset
select t.ok(:'k1_no' like 'KP-%', 'a contract gets its own number');
update public.employment_contracts set gross_salary = 95000, body = 'Teksti i ndryshuar' where id = :'k1';
select t.ok((select gross_salary from public.employment_contracts where id = :'k1') = 95000, 'a draft can still be changed');

select public.contract_sign(:'k1', current_date - 61);
select t.ok((select status = 'active' and signed_on = current_date - 61 from public.employment_contracts where id = :'k1'), 'signing puts the contract in force');
select t.throws($$select public.contract_sign('$$ || :'k1' || $$')$$, 'already signed', 'a contract is signed once');
select t.throws($$update public.employment_contracts set gross_salary = 1 where id = '$$ || :'k1' || $$'$$, 'make an annex', 'a signed contract does not change');
select t.throws($$update public.employment_contracts set body = 'x' where id = '$$ || :'k1' || $$'$$, 'make an annex', 'nor does its text');
select t.throws($$delete from public.employment_contracts where id = '$$ || :'k1' || $$'$$, 'cannot be deleted', 'nor can it be deleted');
update public.employment_contracts set signed_file = (:'co')::text || '/' || (:'drita')::text || '/kp.pdf', signed_file_name = 'kp.pdf' where id = :'k1';
select t.ok((select signed_file_name from public.employment_contracts where id = :'k1') = 'kp.pdf', 'the signed copy can be attached');

-- an annex: a raise from a date
select t.throws($$select public.contract_annex('$$ || :'k1' || $$', current_date - 20, '{"start_date":"2020-01-01"}')$$, 'cannot change', 'an annex only changes the terms it may change');
select public.contract_annex(:'k1', current_date - 20, '{"gross_salary": 110000, "job_title": "Përgjegjëse turni"}', 'Aneksi') as a1 \gset
select t.ok((select kind = 'annex' and status = 'draft' and parent_id = :'k1' and gross_salary = 110000 and job_title = 'Përgjegjëse turni' and annual_leave_days = 28
               from public.employment_contracts where id = :'a1'), 'the annex keeps the other terms and changes the raise and the title');
select t.throws($$select public.contract_annex('$$ || :'k1' || $$', current_date - 10, '{}')$$, 'waiting to be signed', 'one annex waits at a time');
select public.contract_sign(:'a1');
select t.ok((select status = 'ended' and end_date = current_date - 21 and ended_reason = 'changed' from public.employment_contracts where id = :'k1'),
            'signing the annex ends the old terms the day before');
select t.ok((select count(*) from public.employment_contracts where employee_id = :'drita' and status = 'active') = 1, 'one contract in force');

-- ending with notice
select t.throws($$select public.contract_end('$$ || :'a1' || $$', current_date - 1, 'bored')$$, 'Choose why', 'the reason is one of the list');
select t.throws($$select public.contract_end('$$ || :'a1' || $$', current_date - 1, 'resigned', current_date + 3)$$, 'before the last day', 'notice comes before the last day');
select public.contract_end(:'a1', current_date - 1, 'resigned', current_date - 31, 'Largohet me dëshirë');
select t.ok((select status = 'ended' and end_date = current_date - 1 and ended_reason = 'resigned' and notice_given_on = current_date - 31 from public.employment_contracts where id = :'a1'),
            'ending records the last day, the reason and the notice');
select t.ok((select termination_date = current_date - 1 and employment_status = 'terminated' from public.employees where id = :'drita'), 'the person has left');
select t.throws($$select public.contract_end('$$ || :'a1' || $$', current_date, 'other')$$, 'in force', 'an ended contract is not ended twice');

-- a new contract replaces the one in force
insert into public.employment_contracts (company_id, employee_id, contract_type, start_date, gross_salary, currency_code, status)
values (:'co', :'eda', 'indefinite', current_date + 1, 120000, 'ALL', 'draft') returning id as k2 \gset
select public.contract_sign(:'k2');
select t.ok((select count(*) from public.employment_contracts where employee_id = :'eda' and status = 'ended' and ended_reason = 'replaced' and end_date = current_date) = 1,
            'the contract it replaces ends the day before');

-- the person sees their own contracts, not drafts and not other people's
insert into public.employment_contracts (company_id, employee_id, contract_type, start_date, gross_salary, currency_code, status)
values (:'co', :'eda', 'fixed_term', current_date + 400, 1, 'ALL', 'draft');
select t.login('eda@kp.al');
select t.ok((select count(*) from public.employment_contracts where employee_id = :'eda') = 2, 'Eda sees her two contracts, not the draft');
select t.ok((select count(*) from public.employment_contracts where employee_id = :'drita') = 0, 'nor anyone else''s');
select t.throws($$select public.contract_sign('$$ || :'k2' || $$')$$, '', 'nor can she sign for the company');

-- every morning: a last day that has passed means the person has left
select t.login('hana@kp.al');
insert into public.employees (company_id, first_name, last_name, hire_date) values (:'co', 'Arben', 'Ikën', current_date - 100) returning id as arb \gset
insert into public.employment_contracts (company_id, employee_id, contract_type, start_date, gross_salary, currency_code) values (:'co', :'arb', 'indefinite', current_date - 100, 50000, 'ALL') returning id as k3 \gset
select public.contract_end(:'k3', current_date + 5, 'dismissed', current_date - 25);
select t.ok((select employment_status = 'active' and termination_date = current_date + 5 from public.employees where id = :'arb'), 'during the notice the person still works');
reset role;
update public.employees set termination_date = current_date - 1 where id = :'arb';
select app.contracts_daily();
select t.ok((select employment_status from public.employees where id = :'arb') = 'terminated', 'the morning job marks people whose last day passed');
\set QUIET off
select count(*) as assertions_passed from t.results;
