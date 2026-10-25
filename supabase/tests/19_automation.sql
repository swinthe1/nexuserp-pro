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

-- ---------- bank statements that settle invoices ------------------------------------------
set role authenticated;
select t.login('ana@auto.xk');
select id as abank from public.bank_accounts where company_id = :'aco' and account_kind = 'bank' limit 1 \gset
\if :{?abank}
\else
insert into public.bank_accounts (company_id, name, account_kind, currency_code, account_id)
  values (:'aco', 'Banka Test', 'bank', :'acur', (select id from public.accounts where company_id = :'aco' and code = '5121')) returning id as abank \gset
\endif
-- two open invoices of the tenant (the recurring ones above): one paid by number, the next by the remembered account
select i.id as inv1, i.number as inv1_no, i.amount_due as inv1_amt from public.sales_invoices i where i.company_id = :'aco' and i.status = 'posted' and i.payment_status <> 'paid' order by i.invoice_date limit 1 \gset
select i.id as inv2, i.amount_due as inv2_amt from public.sales_invoices i where i.company_id = :'aco' and i.status = 'posted' and i.payment_status <> 'paid' and i.id <> :'inv1' order by i.invoice_date limit 1 \gset
insert into public.bank_statements (company_id, bank_account_id, statement_date, opening_balance, closing_balance) values (:'aco', :'abank', current_date, 0, 0) returning id as stm \gset
insert into public.bank_statement_lines (company_id, statement_id, transaction_date, description, amount, counterparty_name, counterparty_iban) values
  (:'aco', :'stm', current_date, 'Pagesa e qirasë sipas ' || replace(:'inv1_no', '-', ' '), :'inv1_amt', 'QIRAMARRESI', 'XK05 1212 0123 4567 8906'),
  (:'aco', :'stm', current_date, 'Qiraja', :'inv2_amt', 'Dikush', 'XK051212012345678906'),
  (:'aco', :'stm', current_date, 'Pagese', 7777.77, 'Askush', null);
select public.settle_statement(:'stm') as st1 \gset
select t.ok((:'st1'::jsonb ->> 'settled')::int = 2 and (select payment_status = 'paid' from public.sales_invoices where id = :'inv1') and (select payment_status = 'paid' from public.sales_invoices where id = :'inv2'),
  'money in with the invoice number pays that invoice; the account it came from is remembered and pays the next one');
select t.ok((select bank_iban = 'XK051212012345678906' from public.business_partners where id = :'acust'), 'the customer''s account is kept for next time');
select t.ok((select match_status = 'unmatched' and suggestion is null from public.bank_statement_lines where statement_id = :'stm' and amount = 7777.77), 'money that fits nothing is left to the person');
select i.id as inv3, i.amount_due as inv3_amt from public.sales_invoices i where i.company_id = :'aco' and i.status = 'posted' and i.payment_status <> 'paid' order by i.invoice_date limit 1 \gset
insert into public.bank_statement_lines (company_id, statement_id, transaction_date, description, amount, counterparty_name) values
  (:'aco', :'stm', current_date, 'Transfer', :'inv3_amt', 'Qiramarresi sh.p.k.') returning id as sline \gset
select public.settle_statement(:'stm') as st2 \gset
select t.ok((select suggestion ->> 'reason' = 'name' and match_status = 'unmatched' from public.bank_statement_lines where id = :'sline'), 'a name that looks like the customer''s, with a fitting amount, waits as a suggestion');
select public.accept_statement_suggestion(:'sline');
select t.ok((select match_status = 'matched' and matched_payment_id is not null from public.bank_statement_lines where id = :'sline') and (select payment_status = 'paid' from public.sales_invoices where id = :'inv3'),
  'accepting it records the payment and settles the invoice');
reset role;

-- ---------- the supplier's invoice from a photo ------------------------------------------------
set role authenticated;
select t.login('ana@auto.xk');
update public.business_partners set tax_number = '810123456' where id = :'avend';
select public.doc_read_submit(:'aco', encode(decode(repeat('ff', 600), 'hex'), 'base64'), 'image/jpeg', 'fatura.jpg') as rd \gset
select t.throws(format($q$select public.doc_read_submit(%L, 'AAAA', 'image/jpeg')$q$, :'aco'), 'empty', 'an empty file is refused');
reset role;
select set_config('request.jwt.claim.sub', '', false);
set role service_role;
select public.reader_claim() as claimed_doc \gset
select public.reader_done((:'claimed_doc'::jsonb ->> 'id')::uuid, true, '{"vendor_name":"FURNITORI PIJE SHPK","vendor_tax_number":"810 123 456","number":"F-77","date":"2026-10-20",
  "lines":[{"code":"KK-05","name":"Coca-Cola 0,5L","quantity":24,"unit_price":0.41},{"code":"ZZ-1","name":"Artikull i panjohur","quantity":1,"unit_price":3}]}', null, 1500, 300);
reset role;
set role authenticated;
select t.login('ana@auto.xk');
select public.doc_read_get(:'rd') as got \gset
select t.ok((:'got'::jsonb ->> 'status') = 'done' and (:'got'::jsonb -> 'result' ->> 'vendor_id') = :'avend'
            and (:'got'::jsonb -> 'result' -> 'lines' -> 0 ->> 'variant_id') = :'avar' and (:'got'::jsonb -> 'result' -> 'lines' -> 1 ->> 'variant_id') is null,
  'the read invoice finds the vendor by its tax number and the item by its name; an unknown line waits for the person');
select public.doc_read_to_receipt(:'rd', jsonb_build_object('vendor_id', :'avend', 'warehouse_id', :'awh', 'number', 'F-77', 'lines',
  jsonb_build_array(jsonb_build_object('variant_id', :'avar', 'quantity', 24, 'unit_cost', 0.41, 'code', 'KK-05', 'name', 'Coca-Cola 0,5L')))) as rrec \gset
select t.ok((select status = 'draft' and vendor_delivery_note = 'F-77' from public.goods_receipts where id = :'rrec')
            and (select quantity = 24 and unit_cost = 0.41 from public.goods_receipt_lines where receipt_id = :'rrec'), 'a draft goods receipt is made from it, to check and post');
select t.throws(format($q$select public.doc_read_to_receipt(%L, '{}')$q$, :'rd'), 'already made', 'only once per invoice');
select public.doc_read_submit(:'aco', encode(decode(repeat('ee', 600), 'hex'), 'base64'), 'image/png', 'fatura2.png') as rd2 \gset
reset role;
select set_config('request.jwt.claim.sub', '', false);
set role service_role;
select public.reader_claim() as c2 \gset
select public.reader_done((:'c2'::jsonb ->> 'id')::uuid, true, '{"vendor_name":"Furnitori Pije","lines":[{"code":"KK-05","name":"Coca Kola gjysmë litri","quantity":12,"unit_price":0.42}]}');
reset role;
set role authenticated;
select t.login('ana@auto.xk');
select t.ok((public.doc_read_get(:'rd2') -> 'result' -> 'lines' -> 0 ->> 'matched_by') = 'learned', 'the next invoice of that vendor finds the item as the person matched it last time');
select t.throws($$ select public.reader_claim() $$, 'permission denied', 'a signed-in person cannot take the files to read');
reset role;
set role anon;
select public.licence_read_submit(:'alcode', :'asrv', encode(decode(repeat('dd', 600), 'hex'), 'base64'), 'image/jpeg', 'x.jpg') as lr \gset
\if :{?lr}
\endif
reset role;

-- ---------- how many invoices a company may read each month ------------------------------------
set role authenticated;
select t.login('ana@auto.xk');
select t.ok((public.ai_reads_usage(:'aco') ->> 'limit')::int = 300 and (public.ai_reads_usage(:'aco') ->> 'used')::int >= 2, 'the Standard plan reads 300 invoices a month; the month''s reads are counted');
select t.login('zoe@platform.io');
select public.platform_set_ai_limit(:'aco', (public.ai_reads_usage(:'aco') ->> 'used')::int);
select t.ok((public.platform_ai_usage(:'aco') ->> 'override')::int is not null and jsonb_array_length(public.platform_ai_usage(:'aco') -> 'months') >= 1
            and (public.platform_ai_usage(:'aco') -> 'months' -> 0 ->> 'cost_usd') is not null, 'the platform owner sees the reads and their cost per month, and can give another limit');
select t.login('ana@auto.xk');
select t.throws(format($q$select public.doc_read_submit(%L, %L, 'image/jpeg')$q$, :'aco', encode(decode(repeat('ab', 600), 'hex'), 'base64')), 'limit of its plan', 'past the limit, no more reading this month');
reset role;

select t.ok(exists (select 1 from app.document_reads where id = :'lr' and relay_licence = :'alcode'), 'a local server hands its invoice to the cloud with its licence');
update public.licenses set local_server_id = null where company_id = :'aco';

-- ---------- the assistant: questions, answered with the person's own permissions ---------------
insert into auth.users (email, raw_user_meta_data) values ('kasa@auto.xk', '{"full_name":"Kasa Auto"}');
set role authenticated;
select t.login('ana@auto.xk');
select public.invite_member(:'aco', 'kasa@auto.xk', array['pos_cashier']);
select t.ok((public.assistant_usage(:'aco') ->> 'limit')::int = 600, 'the Standard plan asks the assistant 600 questions a month');
select public.assistant_send(:'aco', null, 'Sa borxh ka Kafe Prizreni?', '{"path":"/sales/invoices"}') as asend \gset
select t.throws(format($q$select public.assistant_send(%L, %L, 'Edhe një')$q$, :'aco', :'asend'::jsonb ->> 'conversation_id'), 'Wait for the answer', 'one question at a time in a conversation');
select t.throws(format($q$select public.assistant_send(%L, null, '   ')$q$, :'aco'), 'Write a question', 'an empty question is refused');
select t.login('kasa@auto.xk');
select t.throws(format($q$select public.assistant_state(%L)$q$, :'asend'::jsonb ->> 'conversation_id'), 'not found', 'nobody else reads a person''s conversation');
select t.throws($$ select public.assistant_wait(10) $$, 'permission denied', 'a signed-in person cannot take the questions');
select public.assistant_send(:'aco', null, 'Sa i paguam rrogat?') as ksend \gset
reset role;
select set_config('request.jwt.claim.sub', '', false);
set role service_role;
select public.assistant_wait(500) as aw \gset
select public.assistant_tool((:'aw'::jsonb ->> 'job')::uuid, 'find_items', '{"query":"Coca"}') as tfi \gset
select public.assistant_tool((:'aw'::jsonb ->> 'job')::uuid, 'report', '{"report":"sales","group_by":"month"}') ? 'totals' as trep \gset
select public.assistant_tool((:'aw'::jsonb ->> 'job')::uuid, 'drop_everything', '{}') ->> 'error' as tbad \gset
select public.assistant_done((:'aw'::jsonb ->> 'job')::uuid, true, 'Kafe Prizreni ka **0 €** borxh.', '[{"name":"partner_balance"}]', 900, 60, 'claude-sonnet-5-5');
select public.assistant_wait(500) as kw \gset
select public.assistant_tool((:'kw'::jsonb ->> 'job')::uuid, 'report', '{"report":"payroll"}') ->> 'error' as kpay \gset
select public.assistant_tool((:'kw'::jsonb ->> 'job')::uuid, 'partner_balance', '{"query":"a"}') ->> 'error' as kbal \gset
select public.assistant_wait(10) is null as anone \gset
select public.assistant_done((:'kw'::jsonb ->> 'job')::uuid, false, null, null, null, null, null, 'overloaded');
reset role;
select t.ok((:'aw'::jsonb ->> 'job') = (:'asend'::jsonb ->> 'job_id') and (:'aw'::jsonb -> 'messages' -> 0 ->> 'content') = 'Sa borxh ka Kafe Prizreni?'
            and (:'aw'::jsonb -> 'company' ->> 'today') is not null, 'the server takes the oldest question with its conversation and the company');
select t.ok(jsonb_array_length(:'tfi'::jsonb) >= 1 and (:'tfi'::jsonb -> 0 ->> 'href') like '/inventory/products/%', 'a tool runs as the person and finds the item');
select t.ok(:'trep'::boolean, 'reports answer with their totals');
select t.ok(:'tbad' like 'Unknown tool%', 'only the known tools exist');
select t.ok(:'kpay' like 'Permission denied%' and :'kbal' ilike '%permission%', 'the cashier''s assistant sees no salaries and no debts: the tools keep the person''s permissions');
select t.ok(:'anone'::boolean, 'no question waiting: nothing to take');
reset role;
set role authenticated;
select t.login('ana@auto.xk');
select public.assistant_state((:'asend'::jsonb ->> 'conversation_id')::uuid) as ast \gset
select t.ok(jsonb_array_length(:'ast'::jsonb -> 'messages') = 2 and (:'ast'::jsonb -> 'messages' -> 1 ->> 'role') = 'assistant'
            and (:'ast'::jsonb -> 'job' ->> 'status') = 'done', 'the answer is in the conversation');
select t.ok((select count(*) from public.assistant_conversations(:'aco')) = 1, 'each person sees only their own conversations');
select t.login('zoe@platform.io');
select public.platform_set_ai_chat_limit(:'aco', 2);
select t.ok((public.platform_ai_chat_usage(:'aco') -> 'months' -> 0 ->> 'questions')::int = 2, 'the platform owner sees the questions per month');
select t.login('ana@auto.xk');
select t.throws(format($q$select public.assistant_send(%L, null, 'Edhe një pyetje')$q$, :'aco'), 'limit of its plan', 'past the month''s questions the assistant waits for the 1st');
select public.assistant_forget((:'asend'::jsonb ->> 'conversation_id')::uuid);
select t.ok((select count(*) from public.assistant_conversations(:'aco')) = 0, 'a person can forget a conversation');
reset role;
update app.assistant_jobs set started_at = now() - interval '5 minutes', status = 'running' where id = (:'kw'::jsonb ->> 'job')::uuid;
select app.assistant_cleanup();
select t.ok((select status = 'failed' and error like '%in time%' from app.assistant_jobs where id = (:'kw'::jsonb ->> 'job')::uuid), 'a question left hanging is given back');
\set QUIET off
select count(*) as assertions_passed from t.results;
