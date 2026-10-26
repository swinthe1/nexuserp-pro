-- =============================================================================
-- DrisPRO · the bank statement settles itself and learns (runs after 01–35)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

set role authenticated;
select t.login('zoe@platform.io');
select public.platform_create_client(jsonb_build_object('name', 'Bank Test', 'country', 'XK', 'owner_email', 'alice@alba.al', 'plan', 'pro', 'max_users', 10,
  'valid_until', (current_date + 365)::text)) as co \gset
select t.login('alice@alba.al');
reset role;
insert into public.business_partners (company_id, code, name, is_customer) values (:'co', 'C1', 'Viva Fresh', true) returning id as viva \gset
create function pg_temp.inv(p_co uuid, p_partner uuid, p_amount numeric, p_days int) returns text language plpgsql as $$
declare v uuid;
begin
  insert into public.sales_invoices (company_id, partner_id, currency_code, invoice_date, due_date)
  values (p_co, p_partner, 'EUR', current_date - p_days, current_date - p_days + 15) returning id into v;
  insert into public.sales_invoice_lines (company_id, invoice_id, line_no, description, quantity, unit_price, tax_code_id)
  values (p_co, v, 1, 'Shërbim', 1, p_amount, (select id from public.tax_codes where company_id = p_co and code = 'EXEMPT'));
  perform public.post_sales_invoice(v);
  return (select number from public.sales_invoices where id = v);
end $$;
select pg_temp.inv(:'co', :'viva', 100, 60) as n100, pg_temp.inv(:'co', :'viva', 200, 50) as n200, pg_temp.inv(:'co', :'viva', 300, 40) as n300,
       pg_temp.inv(:'co', :'viva', 40, 30) as n40, pg_temp.inv(:'co', :'viva', 55, 20) as n55, pg_temp.inv(:'co', :'viva', 70, 10) as n70 \gset
select id as bank from public.bank_accounts where company_id = :'co' and account_kind = 'bank' and deleted_at is null limit 1 \gset
\if :{?bank}
\else
insert into public.bank_accounts (company_id, name, account_kind, currency_code, account_id)
  values (:'co', 'Banka', 'bank', 'EUR', (select id from public.accounts where company_id = :'co' and code = '5121')) returning id as bank \gset
\endif
insert into public.bank_statements (company_id, bank_account_id, statement_date, opening_balance, closing_balance) values (:'co', :'bank', current_date, 0, 0) returning id as st \gset
insert into public.bank_statement_lines (company_id, statement_id, transaction_date, description, amount, counterparty_name) values
  (:'co', :'st', current_date, 'Pagese per fat. ' || :'n100' || ' dhe ' || :'n200', 300, 'VIVA FRESH LLC') returning id as l1 \gset
select public.settle_statement(:'st') as r1 \gset
select t.ok((select match_status = 'matched' from public.bank_statement_lines where id = :'l1')
        and (select count(*) = 2 from public.sales_invoices where company_id = :'co' and number in (:'n100', :'n200') and payment_status = 'paid'),
  'two invoice numbers in one transfer pay both');

-- the name is remembered: a short number, the oldest first, two that add up
insert into public.bank_statement_lines (company_id, statement_id, transaction_date, description, amount, counterparty_name) values
  (:'co', :'st', current_date, 'fatura ' || ltrim(substring(:'n300' from '(\d+)\D*$'), '0'), 300, 'VIVA FRESH LLC') returning id as l2 \gset
insert into public.bank_statement_lines (company_id, statement_id, transaction_date, description, amount, counterparty_name) values
  (:'co', :'st', current_date, 'Transfer', 125, 'VIVA FRESH LLC') returning id as l3 \gset
select public.settle_statement(:'st') as r2 \gset
select t.ok((select match_status = 'matched' from public.bank_statement_lines where id = :'l2') and (select payment_status = 'paid' from public.sales_invoices where company_id = :'co' and number = :'n300'),
  'the payer known from before and a short invoice number: settled by itself');
select t.ok((select suggestion ->> 'reason' = 'combination' and jsonb_array_length(suggestion -> 'docs') = 2 from public.bank_statement_lines where id = :'l3'),
  'two of their invoices that add up to the amount are suggested');
update public.bank_statement_lines set amount = 60 where id = :'l3';
select public.settle_statement(:'st');
select t.ok((select suggestion ->> 'reason' = 'oldest' and (suggestion -> 'docs' -> 0 ->> 'amount')::numeric = 40 and (suggestion -> 'docs' -> 1 ->> 'amount')::numeric = 20
               from public.bank_statement_lines where id = :'l3'), 'less than they owe: the oldest invoices first');
select public.accept_all_statement_suggestions(:'st') as acc \gset
select t.ok((:'acc'::jsonb ->> 'accepted')::int = 1 and (select payment_status = 'paid' from public.sales_invoices where company_id = :'co' and number = :'n40'),
  'accept all settles the suggestions at once');

-- the bank's own charges: proposed, then learned, then done by itself
insert into public.bank_statement_lines (company_id, statement_id, transaction_date, description, amount) values
  (:'co', :'st', current_date, 'PROVIZION MIREMBAJTJE LLOGARIE', -3.50) returning id as f1 \gset
select public.settle_statement(:'st');
select t.ok((select suggestion ->> 'reason' = 'fees' from public.bank_statement_lines where id = :'f1'), 'a small bank charge is proposed for bank charges');
select public.accept_statement_suggestion(:'f1');
select t.ok((select match_status = 'matched' and journal_entry_id is not null from public.bank_statement_lines where id = :'f1'), 'accepting it records the entry');
insert into public.bank_statement_lines (company_id, statement_id, transaction_date, description, amount) values
  (:'co', :'st', current_date, 'PROVIZION MIREMBAJTJE LLOGARIE', -3.50) returning id as f2 \gset
select public.settle_statement(:'st');
select t.ok((select suggestion ->> 'reason' = 'learned_account' and not (suggestion ->> 'sure')::boolean from public.bank_statement_lines where id = :'f2'), 'the second time it is remembered');
select public.accept_statement_suggestion(:'f2');
insert into public.bank_statement_lines (company_id, statement_id, transaction_date, description, amount) values
  (:'co', :'st', current_date, 'PROVIZION MIREMBAJTJE LLOGARIE', -3.50) returning id as f3 \gset
select public.settle_statement(:'st');
select t.ok((select match_status = 'matched' from public.bank_statement_lines where id = :'f3'), 'from the third time it is recorded by itself');

\set QUIET off
select count(*) as assertions_passed from t.results;
