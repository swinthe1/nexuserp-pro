-- =============================================================================
-- First steps of a company, the print header for the live preview, email through the platform's mailbox.
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
select t.ok(jsonb_array_length(public.company_first_steps(:'co')) = 8, 'eight first steps');
select t.ok((select (s ->> 'done')::boolean from jsonb_array_elements(public.company_first_steps(:'co')) s where s ->> 'key' = 'item'), 'a company with items has that step done');
select t.ok((public.print_company_header(:'co') ->> 'name') is not null, 'the print header for the preview');
select t.login('pronari@arberi.xk');
select t.throws(format('select public.company_first_steps(%L)', :'co'), '', 'another company does not see the steps');
select t.throws(format('select public.print_company_header(%L)', :'co'), '', 'nor the header');
select t.throws('select public.platform_set_mail_fallback(true)', 'platform owner', 'only the platform owner turns the shared mailbox on');
reset role;
-- the platform's mailbox: used only when switched on and the company has none of its own
select billing_company_id as bc0, mail_fallback as mf0 from public.platform_settings where id \gset
select id as bc from public.companies where id <> :'co' order by created_at limit 1 \gset
select not exists (select 1 from app.mail_accounts where company_id = :'bc') as add_bc, not exists (select 1 from app.mail_accounts where company_id = :'co') as co_none \gset
insert into app.mail_accounts (company_id, host, from_email) select :'bc', 'smtp.platform.invalid', 'dris@platform.invalid' where :'add_bc';
update public.platform_settings set billing_company_id = :'bc', mail_fallback = false where id;
select t.ok(:'co_none' = 'false' or not app.mail_ready(:'co'), 'switched off: a company without a mailbox cannot send');
update public.platform_settings set mail_fallback = true where id;
select t.ok(app.mail_ready(:'co'), 'switched on: it can');
select t.ok(:'co_none' = 'false' or (app.mail_fallback(:'co') ->> 'from') = (select from_email from app.mail_accounts where company_id = :'bc'), 'it sends from the platform''s address');
select t.ok((app.mail_fallback(:'co') ->> 'from_name') = (select left(name, 120) from public.companies where id = :'co'), 'with the company''s name');
select t.ok(app.mail_fallback(:'bc') is null, 'the platform''s own company uses its own mailbox');
update public.platform_settings set billing_company_id = nullif(:'bc0', '')::uuid, mail_fallback = :'mf0'::boolean where id;
delete from app.mail_accounts where company_id = :'bc' and :'add_bc';
\set QUIET off
select count(*) as assertions_passed from t.results;
