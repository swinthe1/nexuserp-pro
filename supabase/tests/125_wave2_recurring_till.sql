-- =============================================================================
-- Wave 2 of the audit, part 3: a recurring invoice's lines change, its posted invoices wait to be
-- sent to the customer, and each till has its own discount limit. (after 19, on "Automatika Test")
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co, base_currency as cur from public.companies where name = 'Automatika Test' \gset
select x.id as vat from public.tax_codes x where x.company_id = :'co' and x.scope <> 'purchase' and x.rate > 0 order by x.rate desc limit 1 \gset

set role authenticated;
select t.login('ana@auto.xk');
insert into public.business_partners (company_id, code, name, is_customer, email) values (:'co', 'ABON', 'Abonenti', true, 'abonenti@shembull.xk') returning id as cust \gset
insert into public.sales_invoices (company_id, partner_id, currency_code) values (:'co', :'cust', :'cur') returning id as inv \gset
insert into public.sales_invoice_lines (company_id, invoice_id, line_no, description, quantity, unit_price, tax_code_id)
  values (:'co', :'inv', 1, 'Mirëmbajtja {period}', 1, 100, :'vat');
select public.recurring_from_invoice(:'inv', 'Mirëmbajtja', 1, 1, current_date, null, true) as plan \gset

-- 1. the lines change, checked
select public.recurring_update(:'plan', jsonb_build_object('lines', jsonb_build_array(
  jsonb_build_object('description', 'Mirëmbajtja {period}', 'quantity', 2, 'unit_price', 80, 'discount_pct', 0, 'tax_code_id', :'vat'),
  jsonb_build_object('description', 'Hostimi', 'quantity', '1', 'unit_price', '15.5', 'tax_code_id', null, 'surprise', 'x'))));
select t.ok((select jsonb_array_length(lines) = 2 and (lines -> 1 ->> 'unit_price')::numeric = 15.5 and not (lines -> 1 ? 'surprise')
               from public.recurring_invoices where id = :'plan'), 'the new lines are kept, with only what an invoice line has');
select t.throws(format($q$select public.recurring_update(%L, '{"lines": []}')$q$, :'plan'), 'at least one line', 'a plan without lines is refused');
select t.throws(format($q$select public.recurring_update(%L, '{"lines": [{"description": "X", "quantity": 0, "unit_price": 1}]}')$q$, :'plan'),
                'more than 0', 'so is a line without a quantity');

-- 2. by email: off, nothing waits; on, the posted invoice waits until it is sent
select public.recurring_update(:'plan', jsonb_build_object('email_customer', true, 'next_date', current_date));
reset role;
select public.run_recurring_invoices(:'co') as made \gset
set role authenticated;
select t.login('ana@auto.xk');
select i.id as made_inv from public.sales_invoices i where i.recurring_id = :'plan' order by i.created_at desc limit 1 \gset
select t.ok((select status = 'posted' and total > 0 from public.sales_invoices where id = :'made_inv')
            and (select sum(quantity * unit_price) from public.sales_invoice_lines where invoice_id = :'made_inv') = 175.5,
            'the invoice is made from the changed lines');
select t.ok(exists (select 1 from public.recurring_to_send(:'co') where invoice_id = :'made_inv' and email = 'abonenti@shembull.xk'),
            'and waits to go to the customer');
select t.ok((select email_customer from public.recurring_list(:'co') where id = :'plan'), 'the list says the plan sends them');
reset role;
insert into app.message_outbox (company_id, channel, to_address, subject, body_text, purpose, entity_type, entity_id)
  values (:'co', 'email', 'abonenti@shembull.xk', 'Fatura', '.', 'document', 'sales_invoice', :'made_inv');
set role authenticated;
select t.login('ana@auto.xk');
select t.ok(not exists (select 1 from public.recurring_to_send(:'co') where invoice_id = :'made_inv'), 'once sent it no longer waits');
select public.recurring_update(:'plan', '{"email_customer": false}');
select t.ok((select email_from is null from public.recurring_invoices where id = :'plan'), 'switched off, it forgets when it started');
select public.recurring_update(:'plan', '{"delete": true}');
reset role;

-- 3. the till's discount limit
select t.ok((select column_default = '10' from information_schema.columns where table_schema = 'public' and table_name = 'pos_registers' and column_name = 'max_discount_pct'),
            'a till lets the cashier give up to 10% unless set otherwise');
select t.ok(exists (select 1 from pg_constraint where conrelid = 'public.pos_registers'::regclass and contype = 'c'
                      and pg_get_constraintdef(oid) like '%max_discount_pct%100%'), 'and never more than 100%');

\set QUIET off
select count(*) as assertions_passed from t.results;
