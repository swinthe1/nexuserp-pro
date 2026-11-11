-- =============================================================================
-- The employee's job with us (main job, second job, intern): the choice on the employee moves the contract in force,
-- a signed one too, and a contract changed moves the employee's choice. (after 147, on "Kontrata Test" with hana, HR)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Kontrata Test' \gset
select c.employee_id as emp, c.id as k from public.employment_contracts c
 where c.company_id = :'co' and c.deleted_at is null and c.signed_on is not null and (c.end_date is null or c.end_date >= current_date)
 order by c.created_at limit 1 \gset

set role authenticated;
select t.login('hana@kp.al');
select t.ok((select job_status = 'primary' from public.employees where id = :'emp'), 'an employee starts on the main job');
update public.employees set job_status = 'secondary' where id = :'emp';
select t.ok((select not is_primary_employer from public.employment_contracts where id = :'k'), 'a second job on the employee shows on the signed contract in force');
update public.employees set job_status = 'intern' where id = :'emp';
select t.ok((select is_primary_employer from public.employment_contracts where id = :'k'), 'an intern is not a second job');
update public.employees set job_status = 'primary' where id = :'emp';
select t.throws(format('update public.employees set job_status = %L where id = %L', 'boss', :'emp'), '', 'only the three choices');
reset role;
\set QUIET off
select count(*) as assertions_passed from t.results;
