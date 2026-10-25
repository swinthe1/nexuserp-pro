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

-- ---------- the till at the end of the day -----------------------------------------------
select set_config('request.jwt.claim.sub', '', false);
select id as sess, company_id as sco from public.pos_sessions where status = 'open' limit 1 \gset
update public.pos_sessions set opened_at = now() - interval '20 hours' where id = :'sess';
select app.remind_open_tills() as open_tills \gset
select t.ok(:'open_tills'::int >= 1 and exists (select 1 from public.notifications where company_id = :'sco' and link = '/pos' and title like 'Tills still open since yesterday%'),
  'a till left open since yesterday is reported in the morning');
-- (the session of the earlier tests has no balanced sales; the close itself is tested in 06, here only what follows it)
alter table public.pos_sessions disable trigger trg_11_status_flow;
alter table public.pos_sessions disable trigger trg_02_system_status;
update public.pos_sessions set status = 'closed', closed_at = now(), expected_cash = 100, closing_cash_counted = 92 where id = :'sess';
alter table public.pos_sessions enable trigger trg_11_status_flow;
alter table public.pos_sessions enable trigger trg_02_system_status;
select t.ok(exists (select 1 from public.notifications where company_id = :'sco' and link = '/pos/sessions/' || :'sess' and type = 'warning' and title like 'Cash difference at %'),
  'closing with cash that does not match tells the managers at once');

-- ---------- the month's payroll, prepared by itself ---------------------------------------
select id as pco from public.companies where name = 'Admin Test' \gset
update public.company_settings set payroll_auto_day = least(extract(day from current_date)::int, 28), payroll_auto_for = 'current' where company_id = :'pco';
select public.run_monthly_payroll() as pay_made \gset
select t.ok(extract(day from current_date) > 28 or (exists (select 1 from public.payroll_runs where company_id = :'pco' and status = 'calculated'
              and period_start = date_trunc('month', current_date)::date)
            and exists (select 1 from public.notifications where company_id = :'pco' and title like 'Payroll for % is ready to check')),
  'on its day the month''s payroll is made and calculated as a draft, and payroll is told');
select public.run_monthly_payroll() as pay_made2 \gset
select t.ok((select count(*) from public.payroll_runs where company_id = :'pco' and period_start = date_trunc('month', current_date)::date) <= 1, 'only once a month');

-- ---------- the postier: email from the company's mailbox, WhatsApp through the cloud ----------
set role authenticated;
select t.login('ana@auto.xk');
select public.mail_account_save(:'aco', '{"host":"smtp.auto.xk","port":587,"security":"starttls","username":"shop@auto.xk","password":"s3cret","from_name":"Automatika","from_email":"Shop@Auto.xk"}');
select t.ok((public.mail_account_get(:'aco') ->> 'has_password')::boolean and public.mail_account_get(:'aco') ->> 'password' is null
            and public.mail_account_get(:'aco') ->> 'from_email' = 'shop@auto.xk', 'the mailbox is saved; its password never comes back to a screen');
select public.mail_account_save(:'aco', '{"host":"smtp2.auto.xk","from_email":"shop@auto.xk","password":""}');
reset role;
select t.ok((select password = 's3cret' and host = 'smtp2.auto.xk' from app.mail_accounts where company_id = :'aco'), 'saving without a password keeps the old one');
set role authenticated;
select t.throws($$ select * from app.mail_accounts $$, 'permission denied', 'nobody reads the mailboxes table directly');
select public.mail_account_test(:'aco', 'ana@auto.xk') as test_msg \gset
update public.business_partners set email = 'qira@klient.xk', phone = '044 555 666' where id = :'acust';
select public.messaging_settings_save(:'aco', '{"summary_hour":"7","summary_emails":["Ana@Auto.xk"],"summary_whatsapp":["+383 44 111 222"],
  "dunning_enabled":true,"dunning_whatsapp":true,"dunning_steps":["3","15","30","x"]}');
select t.ok((public.messaging_settings(:'aco') -> 'dunning_steps') = '[3, 15, 30]'::jsonb and (public.messaging_settings(:'aco') ->> 'summary_hour') = '7', 'the settings are saved and cleaned');
select t.ok((select count(*) from public.dunning_preview(:'aco') where partner_id = :'acust') = 1, 'the reminders of today can be seen before they go');
reset role;
select set_config('request.jwt.claim.sub', '', false);
select public.summary_send_now(:'aco') as sums \gset
select t.ok(:'sums'::int = 2 and exists (select 1 from app.message_outbox where company_id = :'aco' and purpose = 'summary' and channel = 'whatsapp' and to_address = '38344111222'
            and template ->> 'name' = 'drispro_permbledhja'), 'the morning summary goes by email and to WhatsApp (number written as WhatsApp wants it)');
select app.run_dunning(:'aco') as dun \gset
select t.ok(:'dun'::int = 1 and exists (select 1 from app.message_outbox where company_id = :'aco' and purpose = 'dunning' and channel = 'email' and to_address = 'qira@klient.xk'
              and body_text like '%Qiramarrësi%' and body_text like '%Gjithsej%')
            and exists (select 1 from app.message_outbox where company_id = :'aco' and purpose = 'dunning' and channel = 'whatsapp' and to_address = '38344555666'),
  'a customer with overdue invoices gets one reminder listing them, by email and WhatsApp');
select app.run_dunning(:'aco') as dun2 \gset
select t.ok(:'dun2'::int = 0, 'and not the same step again');
set role service_role;
select public.postier_claim(50) as claimed \gset
reset role;
select t.ok(jsonb_array_length(:'claimed'::jsonb) >= 4 and (select bool_and((m -> 'mail' ->> 'pass') = 's3cret') from jsonb_array_elements(:'claimed'::jsonb) m where m ->> 'channel' = 'email' and m ->> 'company' = :'aco'),
  'the worker gets the messages with the mailbox to send them from');
set role service_role;
select public.postier_done(:'test_msg', true, null, 'id-1');
select public.postier_done((select (m ->> 'id')::uuid from jsonb_array_elements(:'claimed'::jsonb) m where m ->> 'channel' = 'whatsapp' limit 1), false, 'no number');
reset role;
select t.ok((select verified_at is not null from app.mail_accounts where company_id = :'aco'), 'a test email that went out marks the mailbox as working');
select t.ok(exists (select 1 from app.message_outbox where status = 'failed' and last_error = 'no number' and next_try_at > now()), 'a failed message waits and is tried again later');
set role authenticated;
select t.throws($$ select public.postier_claim(1) $$, 'permission denied', 'a signed-in person cannot take the outbox');
reset role;
select public.automation_tick() as tick \gset
select t.ok((:'tick'::jsonb ? 'summaries'), 'the tick runs the timed work');

-- purchase orders to the vendor, and WhatsApp from a local server
set role authenticated;
select t.login('ana@auto.xk');
select public.messaging_settings_save(:'aco', '{"po_email_auto":true}');
insert into public.business_partners (company_id, code, name, is_vendor, email) values (:'aco', 'FURN', 'Furnitori Pije', true, 'porosi@furnitori.xk') returning id as avend \gset
select id as awh from public.warehouses where company_id = :'aco' limit 1 \gset
insert into public.purchase_orders (company_id, vendor_id, warehouse_id) values (:'aco', :'avend', :'awh') returning id as apo \gset
insert into public.purchase_order_lines (company_id, purchase_order_id, line_no, variant_id, description, quantity, unit_price, tax_code_id)
  values (:'aco', :'apo', 1, :'avar', 'Coca Cola 0.5', 48, 0.42, :'avat');
select public.submit_purchase_order(:'apo') as po_status \gset
reset role;
select t.ok(:'po_status' = 'approved' and exists (select 1 from app.message_outbox where entity_id = :'apo' and to_address = 'porosi@furnitori.xk' and body_text like '%48 × Coca Cola 0.5%'),
  'an approved purchase order goes to the vendor by email');
set role authenticated;
select t.login('ana@auto.xk');
select public.email_purchase_order(:'apo', 'tjeter@furnitori.xk') as po_msg \gset
reset role;
select t.ok((select to_address = 'tjeter@furnitori.xk' and purpose = 'purchase_order' from app.message_outbox where id = :'po_msg'), 'or by hand, to another address');
select code as alcode from public.licenses where company_id = :'aco' \gset
select gen_random_uuid() as asrv \gset
update public.licenses set local_server_id = :'asrv' where company_id = :'aco';
set role anon;
select public.licence_whatsapp_relay(:'alcode', :'asrv', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'to', '38344111222', 'text', 'x',
  'template', jsonb_build_object('name', 'drispro_permbledhja', 'params', '[]'::jsonb)), jsonb_build_object('id', gen_random_uuid(), 'to', 'bad', 'template', '{}'::jsonb))) as relayed \gset
select t.throws(format($q$select public.licence_whatsapp_relay(%L, %L, '[]')$q$, :'alcode', gen_random_uuid()), 'another server', 'only the licence''s own server can send through the cloud');
reset role;
select t.ok((:'relayed'::jsonb ->> 'accepted')::int = 1 and exists (select 1 from app.message_outbox where relay_licence = :'alcode' and channel = 'whatsapp'),
  'a local server''s WhatsApp messages wait in the cloud outbox (wrong numbers are left out)');
update public.licenses set local_server_id = null where company_id = :'aco';

\set QUIET off
select count(*) as assertions_passed from t.results;
