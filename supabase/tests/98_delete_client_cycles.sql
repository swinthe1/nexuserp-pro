-- =============================================================================
-- Deleting a client whose rows point at each other in a way that cannot be emptied (a near-expiry markdown
-- and its levelling document, both kept by a rule; a department and its manager, the same): the links are
-- checked once, at the end, so the client goes in one pass. Outside the deletion the links still hold at once.
-- A fiscal request of its register, kept in the internal schema, goes too.
-- (after 94 and 97 on "Kontrolle Test"; the deletion is undone at the end)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Kontrolle Test' \gset
select email as boss from public.profiles where is_super_admin limit 1 \gset

select t.ok(not exists (select 1 from pg_constraint where contype = 'f' and connamespace = 'public'::regnamespace and not condeferrable),
            'every link between the tables can be checked at the end');
select t.throws($$with s as (select set_config('app.allow_hard_delete', 'on', true) x)
                  delete from public.price_levels where exists (select 1 from s)
                     and id in (select level_id from public.expiry_markdowns where company_id = (select id from public.companies where name = 'Kontrolle Test'))$$,
                'foreign key', 'outside the deletion a link still holds at once');

begin;
-- (what is checked inside is kept in variables: the rollback at the end undoes the results table too)
select exists (select 1 from public.expiry_markdowns m join public.price_levels l on l.markdown_id = m.id and l.id = m.level_id
                where m.company_id = :'co') as circle \gset
set session_replication_role = replica;
insert into public.employees (company_id, number, first_name, last_name, hire_date)
values (:'co', 'E-T98', 'Drita', 'Rrethi', current_date) returning id as emp \gset
insert into public.departments (company_id, code, name, manager_id) values (:'co', 'CYC98', 'Rrethi', :'emp') returning id as dep \gset
update public.employees set department_id = :'dep' where id = :'emp';
set session_replication_role = origin;
-- a fiscal request of a register, kept in the internal schema, points at the register
insert into app.atk_jobs (company_id, register_id, kind, env, request)
select :'co', id, 'verify', 'test', '{}'::jsonb from public.pos_registers where company_id = :'co' limit 1;
-- rules that keep both sides of each circle filled: the links cannot be emptied
alter table public.expiry_markdowns add constraint t98_level check (level_id is not null or status <> 'approved') not valid;
alter table public.price_levels add constraint t98_markdown check (markdown_id is not null or source <> 'expiry') not valid;
alter table public.departments add constraint t98_manager check (manager_id is not null or code <> 'CYC98') not valid;
alter table public.employees add constraint t98_department check (department_id is not null or id <> :'emp'::uuid) not valid;

select set_config('app.purge_no_replica', 'on', true);
set local role authenticated;
select t.login(:'boss');
select public.platform_delete_client(:'co', 'Kontrolle Test', true) as del \gset
reset role;
select not exists (select 1 from public.companies where id = :'co') as gone,
       not exists (select 1 from public.expiry_markdowns where company_id = :'co')
         and not exists (select 1 from public.price_levels where company_id = :'co')
         and not exists (select 1 from public.departments where company_id = :'co')
         and not exists (select 1 from app.atk_jobs where company_id = :'co') as rows_gone,
       not exists (select 1 from pg_trigger where not tgisinternal and tgenabled = 'D') as rules_on \gset
rollback;
select t.ok(:'circle'::boolean, 'the client had a markdown and a levelling document that point at each other');
select t.ok(:'gone'::boolean, 'the client is deleted');
select t.ok((:'del'::jsonb ->> 'rounds')::int = 1, 'in one pass');
select t.ok(:'rows_gone'::boolean, 'with the rows that pointed at each other, and those of the internal schema');
select t.ok(:'rules_on'::boolean, 'every paused rule is on again');
select t.ok(exists (select 1 from public.companies where id = :'co'), '(the test puts the client back)');

\set QUIET off
select count(*) as assertions_passed from t.results;
