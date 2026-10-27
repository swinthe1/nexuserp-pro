-- =============================================================================
-- DrisPRO · the business register (ARBK): search, partners from it, closed partners flagged (runs after 01–43)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

insert into app.business_registry_load (nui, name, trade_name, legal_form, activity, city, status) values
  ('811559783', 'LIDER MARKET SH.P.K.', 'LIDER MARKET', 'Shoqëri me përgjegjësi të kufizuara', '4711-Tregtia me pakicë', 'Gllogoc', 'Regjistruar'),
  ('810000099', 'Furra Test B.I.', null, 'Biznes individual', '1071-Prodhimi i bukës', 'Prishtinë', 'Regjistruar'),
  ('810000099', 'Furra Test B.I.', null, 'Biznes individual', '1071-Prodhimi i bukës', 'Prishtinë', 'Regjistruar');
select (app.registry_apply() ->> 'new')::int as n \gset
select t.ok(:n >= 2, 'the register is loaded, a business listed twice counts once');

set role authenticated;
select t.login('zoe@platform.io');
select public.platform_create_client(jsonb_build_object('name', 'Register Test', 'country', 'XK', 'owner_email', 'alice@alba.al', 'plan', 'pro', 'max_users', 10,
  'valid_until', (current_date + 365)::text)) as co \gset
select t.login('alice@alba.al');
select t.ok((public.registry_search('8115597') -> 0 ->> 'name') = 'LIDER MARKET SH.P.K.', 'found by the first digits of the NUI');
select t.ok(exists (select 1 from jsonb_array_elements(public.registry_search('lider mar')) x where x ->> 'nui' = '811559783'), 'found by a part of the name');
select t.ok(jsonb_array_length(public.registry_search('li')) = 0, 'two letters are not enough to search');
select public.partner_from_registry(:'co', '811559783', 'vendor') as p \gset
select t.ok((select name = 'LIDER MARKET' and legal_name = 'LIDER MARKET SH.P.K.' and tax_number = '811559783' and is_vendor from public.business_partners where id = :'p'),
  'picking it adds the supplier with the official name and NUI');
select t.ok(exists (select 1 from public.partner_addresses where partner_id = :'p' and city = 'Gllogoc'), 'with its town');
select public.partner_from_registry(:'co', '811 559 783', 'customer') as p2 \gset
select t.ok(:'p2' = :'p' and (select is_customer and is_vendor from public.business_partners where id = :'p'), 'the same NUI again is the same partner, now also a customer');
select t.throws(format($q$select public.partner_from_registry(%L, '999', 'vendor')$q$, :'co'), 'not in the business register', 'an unknown NUI is refused');
select t.ok((public.partner_registry(:'p') ->> 'active')::boolean, 'the partner page shows what the register says');

-- the business closes: the company is told once
reset role;
insert into app.business_registry_load (nui, name, trade_name, legal_form, city, status) values ('811559783', 'LIDER MARKET SH.P.K.', 'LIDER MARKET', 'Shoqëri me përgjegjësi të kufizuara', 'Gllogoc', 'Shuar');
select app.registry_apply();
select t.ok(exists (select 1 from public.notifications where company_id = :'co' and title like 'LIDER MARKET is Shuar%'), 'a partner that closed is flagged');
select app.registry_apply();
select t.ok((select count(*) from public.notifications where company_id = :'co' and title like 'LIDER MARKET is Shuar%') = 1, 'only once');

\set QUIET off
select count(*) as assertions_passed from t.results;
