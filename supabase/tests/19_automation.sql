-- =============================================================================
-- DrisPRO · work the program does by itself (runs after 18)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

set role authenticated;
select t.login('zoe@platform.io');
select public.platform_create_client(jsonb_build_object('name', 'Automatika Test', 'country', 'XK', 'tax_number', '811990011',
  'owner_email', 'ana@auto.xk', 'owner_name', 'Ana Auto', 'owner_password', 'sekret123', 'plan', 'standard', 'max_users', 5,
  'valid_until', (current_date + 365)::text)) as aco \gset
select t.login('ana@auto.xk');
select id as avat from public.tax_codes where company_id = :'aco' and rate > 0 order by rate desc limit 1 \gset
select rate as avat_rate from public.tax_codes where id = :'avat' \gset
select id as apcs from public.units_of_measure where company_id = :'aco' and code = 'pcs' \gset
insert into public.product_categories (company_id, name) values (:'aco', 'Pije') returning id as acat \gset
insert into public.products (company_id, code, name, uom_id, category_id, sales_price, sales_tax_code_id, product_type)
  values (:'aco', 'COLA', 'Coca Cola 0.5', :'apcs', :'acat', 0.5, :'avat', 'stockable') returning id as aprod \gset
insert into public.product_variants (company_id, product_id, sku, name, is_default)
  values (:'aco', :'aprod', 'COLA', 'Coca Cola 0.5', true) returning id as avar \gset

-- ---------- selling price from the cost ---------------------------------------------
select public.price_rules_save(:'aco', 'markup', 0.05, false, 1, jsonb_build_array(jsonb_build_object('id', :'acat', 'pct', '30')));
reset role;
insert into public.item_costs (company_id, variant_id, avg_cost, qty_on_hand, total_value) values (:'aco', :'avar', 0.40, 10, 4);
select t.ok((select gross_new = ceil(round(0.40 * 1.30 * (1 + :avat_rate / 100.0) / 0.05, 6)) * 0.05 and status = 'pending'
               from public.price_suggestions where variant_id = :'avar'),
  'goods at a new cost: the price that keeps 30% over cost, VAT included, rounded up to 0.05');
select t.ok(exists (select 1 from public.notifications where company_id = :'aco' and link = '/inventory/prices' and read_at is null),
  'whoever may change prices is told');
update public.item_costs set avg_cost = 0.45 where variant_id = :'avar';
update public.item_costs set avg_cost = 0.46 where variant_id = :'avar';
select t.ok((select count(*) from public.price_suggestions where variant_id = :'avar' and status = 'pending') = 1
            and (select count(*) from public.price_suggestions where variant_id = :'avar' and status = 'outdated') = 2,
  'a newer cost replaces the waiting suggestion');
select t.ok((select count(*) from public.notifications where company_id = :'aco' and link = '/inventory/prices' and read_at is null)
            = (select count(distinct user_id) from public.notifications where company_id = :'aco' and link = '/inventory/prices'),
  'one waiting message per person, not one per item');
update public.item_costs set avg_cost = 0.20 where variant_id = :'avar';
select t.ok(not exists (select 1 from public.price_suggestions where variant_id = :'avar' and status = 'pending'),
  'a lower cost does not lower the price unless the shop wants that');
update public.item_costs set avg_cost = 0.50 where variant_id = :'avar';
select id as sug, gross_new as sug_gross from public.price_suggestions where variant_id = :'avar' and status = 'pending' \gset
set role authenticated;
select t.login('ana@auto.xk');
select t.ok(exists (select 1 from public.price_suggestions_list(:'aco') where id = :'sug'), 'the list to review');
select public.price_suggestions_decide(:'aco', array[:'sug']::uuid[], true);
reset role;
select t.ok((select round(sales_price * (1 + :avat_rate / 100.0), 2) = :'sug_gross'::numeric from public.products where id = :'aprod'),
  'accepting it changes the selling price');
select t.ok(exists (select 1 from public.price_changes where variant_id = :'avar'), 'and the price history keeps the change');
update public.item_costs set avg_cost = 0.80 where variant_id = :'avar';
select id as sug2 from public.price_suggestions where variant_id = :'avar' and status = 'pending' \gset
set role authenticated;
select t.login('ana@auto.xk');
select public.price_suggestions_decide(:'aco', array[:'sug2']::uuid[], true, 1.25);
reset role;
select t.ok((select round(sales_price * (1 + :avat_rate / 100.0), 2) = 1.25 from public.products where id = :'aprod'), 'or the person gives another price');
set role authenticated;
select t.login('bob@kosova.xk');
select t.throws(format($q$select public.price_suggestions_list(%L)$q$, :'aco'), 'Permission denied', 'another company cannot see them');
reset role;

-- ---------- invoices that repeat ------------------------------------------------------
set role authenticated;
select t.login('ana@auto.xk');
insert into public.business_partners (company_id, code, name, is_customer) values (:'aco', 'QIRA', 'Qiramarrësi', true) returning id as acust \gset
select base_currency as acur from public.companies where id = :'aco' \gset
insert into public.sales_invoices (company_id, partner_id, currency_code) values (:'aco', :'acust', :'acur') returning id as ainv \gset
insert into public.sales_invoice_lines (company_id, invoice_id, line_no, description, quantity, unit_price, tax_code_id)
  values (:'aco', :'ainv', 1, 'Qiraja {period}', 1, 500, :'avat');
select public.recurring_from_invoice(:'ainv', 'Qiraja e dyqanit', 1, 5, (date_trunc('month', current_date) - interval '2 months')::date) as plan \gset
reset role;
select public.run_recurring_invoices() as made \gset
select t.ok(:'made'::int = 3 - case when extract(day from current_date) < 5 then 1 else 0 end,
  'a plan that started two months ago makes the missed months too');
select t.ok((select count(*) from public.sales_invoices where recurring_id = :'plan' and status = 'draft') = :'made'::int
            and exists (select 1 from public.sales_invoice_lines l join public.sales_invoices i on i.id = l.invoice_id
                         where i.recurring_id = :'plan' and l.description = 'Qiraja ' || to_char(i.invoice_date, 'MM/YYYY') and l.unit_price = 500),
  'each one as a draft, with the month in the line text');
select t.ok((select next_date > current_date and extract(day from next_date) = 5 from public.recurring_invoices where id = :'plan'), 'the next one is on day 5 of a coming month');
select public.run_recurring_invoices() as made2 \gset
select t.ok(:'made2'::int = 0, 'running again the same day makes nothing twice');
select t.ok(exists (select 1 from public.notifications where company_id = :'aco' and link = '/sales/recurring'), 'invoicing is told');
set role authenticated;
select t.login('ana@auto.xk');
select public.recurring_update(:'plan', '{"post": true, "next_date": "2020-01-05"}');
select public.run_recurring_invoices(:'aco') as made3 \gset
select t.ok((select last_error like '%fiscal period%' and next_date = '2020-01-05' from public.recurring_invoices where id = :'plan'),
  'a month that cannot be invoiced stops the plan with the reason, and nothing is skipped');
select public.recurring_update(:'plan', jsonb_build_object('next_date', (date_trunc('year', current_date) + interval '4 days')::date));
select public.run_recurring_invoices(:'aco') as made4 \gset
select t.ok(:'made4'::int = extract(month from current_date)::int - case when extract(day from current_date) < 5 then 1 else 0 end
            and (select count(*) from public.sales_invoices where recurring_id = :'plan' and status = 'posted') = :'made4'::int,
  'a plan set to post makes posted invoices');
select t.ok((select total from public.recurring_list(:'aco') where id = :'plan') = round(500 * (1 + :avat_rate / 100.0), 2), 'the list shows the amount of each invoice');
select public.recurring_update(:'plan', '{"delete": true}');
select t.ok((select count(*) from public.sales_invoices where recurring_id is null and partner_id = :'acust') = 1 + :'made'::int + :'made4'::int, 'removing the plan keeps the invoices it made');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
