-- =============================================================================
-- Categories and sub-categories: two levels, many sub-categories under one main category, no same name twice in
-- one place, and a deleted main category sets its sub-categories free. (after 144: Mini Market Arbëri)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as mini from public.companies where name = 'Mini Market Arbëri' \gset

set role authenticated;
select t.login('pronari@arberi.xk');
insert into public.product_categories (company_id, name) values (:'mini', 'Pije provë') returning id as main \gset
insert into public.product_categories (company_id, name, parent_id) values (:'mini', 'Alkoolike', :'main') returning id as s1 \gset
insert into public.product_categories (company_id, name, parent_id) values (:'mini', 'Joalkoolike', :'main') returning id as s2 \gset
insert into public.product_categories (company_id, name, parent_id) values (:'mini', 'Ujë', :'main') returning id as s3 \gset
select t.ok((select count(*) = 3 from public.product_categories where parent_id = :'main' and deleted_at is null), 'a main category takes as many sub-categories as it needs');
select t.throws(format('insert into public.product_categories (company_id, name, parent_id) values (%L, %L, %L)', :'mini', ' alkoolike ', :'main'),
  'already has a sub-category', 'not two sub-categories of the same name under one main category');
select t.throws(format('insert into public.product_categories (company_id, name) values (%L, %L)', :'mini', 'PIJE PROVË'),
  'already a category', 'nor two main categories of the same name');
select t.throws(format('insert into public.product_categories (company_id, name, parent_id) values (%L, %L, %L)', :'mini', 'Verë', :'s1'),
  'under a main category', 'no third level: a sub-category under a sub-category');
select t.throws(format('update public.product_categories set parent_id = id where id = %L', :'s1'), 'its own', 'nor under itself');
insert into public.product_categories (company_id, name) values (:'mini', 'Ushqime provë') returning id as main2 \gset
select t.throws(format('update public.product_categories set parent_id = %L where id = %L', :'main2', :'main'),
  'sub-categories of its own', 'a main category with sub-categories does not become a sub-category');
-- the same name is fine under another main category, and a sub-category moves to another main category
insert into public.product_categories (company_id, name, parent_id) values (:'mini', 'Ujë', :'main2') returning id as s4 \gset
update public.product_categories set parent_id = :'main2' where id = :'s2';
select t.ok((select parent_id = :'main2' from public.product_categories where id = :'s2'), 'a sub-category moves under another main category');
select t.throws(format('update public.product_categories set parent_id = %L where id = %L', :'main2', :'s3'),
  'already has a sub-category', 'but not where its name is taken');
-- the main category deleted: its sub-categories become main categories
delete from public.product_categories where id = :'main';
select t.ok((select count(*) = 2 from public.product_categories where id in (:'s1', :'s3') and parent_id is null and deleted_at is null),
  'a deleted main category sets its sub-categories free');
reset role;
\set QUIET off
select count(*) as assertions_passed from t.results;
