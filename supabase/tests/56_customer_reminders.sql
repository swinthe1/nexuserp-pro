-- =============================================================================
-- DrisPRO · customer payment reminders: before the due date, overdue by step, by instalment,
-- customers left out, sent by hand, and the history on the customer
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select email as boss from public.profiles where is_super_admin limit 1 \gset
select i.company_id as co, i.id as inv, i.partner_id as cust, i.total, i.invoice_date from public.sales_invoices i
 where i.status = 'posted' and i.document_type = 'sales_invoice' and i.amount_due = i.total and i.total > 10 and i.deleted_at is null
 order by i.created_at limit 1 \gset
-- one open invoice for one customer, with an email, and a clean slate
update public.business_partners set email = 'klienti@test.al', phone = null, no_reminders = false where id = :'cust';
update public.sales_invoices set partner_id = :'cust' where id = :'inv';
update public.sales_invoices set payment_status = 'paid' where partner_id = :'cust' and id <> :'inv';
update public.company_settings set dunning_enabled = true, dunning_email = true, dunning_whatsapp = false, dunning_steps = '{1,7}',
       reminder_before_enabled = true, reminder_before_days = 3 where company_id = :'co';
delete from app.dunning_log where invoice_id = :'inv';
delete from public.document_instalments where sales_invoice_id = :'inv';

-- due in 2 days: a reminder before the due date
update public.sales_invoices set due_date = current_date + 2 where id = :'inv';
select count(*) as before_n from app.message_outbox where entity_id = :'cust' and purpose = 'dunning' \gset
select app.run_dunning(:'co') \g /dev/null
select t.ok((select count(*) from app.message_outbox where entity_id = :'cust' and purpose = 'dunning') = :before_n + 1, 'a reminder goes out before the due date');
select t.ok((select subject from app.message_outbox where entity_id = :'cust' and purpose = 'dunning' order by created_at desc limit 1) like 'Afati i pagesës po afron%', 'it says the due date is near');
select app.run_dunning(:'co') \g /dev/null
select t.ok((select count(*) from app.message_outbox where entity_id = :'cust' and purpose = 'dunning') = :before_n + 1, 'only once per invoice');

-- 8 days late: the 7-day step (the 1-day step is skipped: one message, the highest step)
update public.sales_invoices set due_date = current_date - 8 where id = :'inv';
select app.run_dunning(:'co') \g /dev/null
select t.ok((select count(*) from app.message_outbox where entity_id = :'cust' and purpose = 'dunning') = :before_n + 2, 'an overdue reminder goes out');
select t.ok(exists (select 1 from app.dunning_log where invoice_id = :'inv' and step = 7), 'at the 7-day step');
select t.ok((select body_text from app.message_outbox where entity_id = :'cust' and purpose = 'dunning' order by created_at desc limit 1) like '%ende të papaguara%', 'with the overdue text');

-- in instalments: only the part that is late is reminded, for its own amount
delete from app.dunning_log where invoice_id = :'inv';
insert into public.document_instalments (company_id, sales_invoice_id, seq, due_date, amount)
values (:'co', :'inv', 1, current_date - 8, round(:'total'::numeric / 2, 2)), (:'co', :'inv', 2, current_date + 20, :'total'::numeric - round(:'total'::numeric / 2, 2));
select t.ok((select sum(amount) from app.reminder_due(:'co', current_date) where invoice_id = :'inv') = round(:'total'::numeric / 2, 2), 'only the late instalment, for its amount');
select t.ok((select seq from app.reminder_due(:'co', current_date) where invoice_id = :'inv' limit 1) = 1, 'it is the first instalment');

-- a customer left out of reminders
update public.business_partners set no_reminders = true where id = :'cust';
select t.ok(not exists (select 1 from app.reminder_due(:'co', current_date) where partner_id = :'cust'), 'a customer left out gets nothing');
update public.business_partners set no_reminders = false where id = :'cust';

-- by hand, and the history
set role authenticated;
select t.login(:'boss');
select public.send_reminder_now(:'cust') as manual \gset
select t.ok((:'manual'::jsonb ->> 'kind') = 'overdue' and (:'manual'::jsonb ->> 'messages')::int = 1, 'a reminder can be sent by hand');
select t.ok((select count(*) from public.reminder_history(:'cust')) >= 3, 'the customer page lists every reminder');
select t.ok((select count(*) from public.dunning_preview(:'co') where partner_id = :'cust') = 1, 'the next round is shown in advance');
select t.login('bob@kosova.xk');
select t.throws($$select public.send_reminder_now('$$ || :'cust' || $$')$$, '', 'someone from another company cannot send it');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
