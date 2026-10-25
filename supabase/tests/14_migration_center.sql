-- =============================================================================
-- DrisPRO · Phase 11 tests: moving a client from another program (runs after 01–13)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

set role authenticated;
select t.login('zoe@platform.io');
select public.platform_create_client(jsonb_build_object('name', 'Lider Test', 'country', 'XK', 'owner_email', 'mira@lider.xk',
  'owner_password', 'sekret123', 'max_users', 5)) as co \gset
select t.login('mira@lider.xk');

-- master data first, with the existing importer
select public.import_rows(:'co', 'partners', '[{"name":"Viva Fresh","code":"K001","role":"customer","tax_number":"810000001"},
  {"name":"Meridian","code":"K002","role":"customer","tax_number":"810000002"},
  {"name":"Devolli Corporation","code":"F001","role":"vendor","tax_number":"810000003"}]', false);
select public.import_rows(:'co', 'products', '[{"sku":"UJE-15","name":"Ujë 1.5 L","price":"0.40","vat":"VAT18"},
  {"sku":"KAFE-1","name":"Kafe 1 kg","price":"12.50","vat":"VAT18"}]', false);

-- ---------------------------------------------------------- open customer invoices
select public.migration_import(:'co', 'open_receivables', '[{"partner":"K001","number":"F-120/25","date":"2026-08-10","due_date":"2026-09-10","amount":"1.250,50"},
  {"partner":"nobody","number":"F-1","amount":"10"}]', true, current_date) as chk \gset
select t.ok((:'chk'::jsonb -> 'errors' -> 0 ->> 'row') = '2' and (:'chk'::jsonb ->> 'ok') = '1', 'the check finds the unknown customer and passes the good row');
select t.ok((:'chk'::jsonb ->> 'total')::numeric = 1250.50, 'Albanian number format 1.250,50 is read');
select t.throws($$ select public.migration_import('$$ || :'co' || $$', 'open_receivables', '[{"partner":"nobody","number":"F-1","amount":"10"}]', false, current_date) $$,
  'nothing was imported', 'an import with problem rows saves nothing');
select t.ok(not exists (select 1 from public.sales_invoices where company_id = :'co'), 'and really nothing is saved');

select public.migration_import(:'co', 'open_receivables', '[{"partner":"K001","number":"F-120/25","date":"2026-08-10","due_date":"2026-09-10","amount":"1.250,50"},
  {"partner":"810000002","number":"F-131/25","date":"2026-09-01","amount":"300"},
  {"partner":"Meridian","number":"KM-4/25","date":"2026-09-05","amount":"-50"}]', false, current_date, 'kubit-klientet.xlsx') as ar \gset
select t.ok((select count(*) from public.sales_invoices where company_id = :'co' and is_opening and status = 'posted') = 3, 'open invoices are posted as opening documents');
select t.ok((select number from public.sales_invoices where company_id = :'co' and partner_id = app.mig_partner(:'co', 'K001', 'customer')) = 'F-120/25', 'the old invoice number is kept');
select t.ok((select document_type from public.sales_invoices where company_id = :'co' and number = 'KM-4/25') = 'credit_note', 'a negative amount becomes a credit note');
select t.ok((select due_date from public.sales_invoices where company_id = :'co' and number = 'F-131/25') = date '2026-09-01', 'missing due date = invoice date');
select t.ok((select count(*) from public.journal_entries where id = (:'ar'::jsonb ->> 'journal_entry_id')::uuid and status = 'posted' and entry_date = current_date) = 1,
  'one journal entry on the cut-over date');
select t.ok((select sum(l.debit) - sum(l.credit) from public.journal_lines l join public.accounts a on a.id = l.account_id
              where l.entry_id = (:'ar'::jsonb ->> 'journal_entry_id')::uuid and a.code = '411') = 1500.50, 'receivables 1,500.50 net of the credit note');
select t.ok(not exists (select 1 from public.journal_entries where company_id = :'co' and source_doc_type in ('sales_invoice','credit_note')),
  'no per-invoice postings on old dates');
select t.ok((select count(*) from public.v_sales_book where company_id = :'co') = 0, 'opening invoices stay out of the sales book');
select t.ok((public.sales_overview(:'co', date '2026-01-01', current_date) ->> 'revenue')::numeric = 0, 'and out of sales revenue');
select t.ok((public.sales_overview(:'co', date '2026-01-01', current_date) ->> 'overdue_amount')::numeric > 0, 'but they count as overdue');
select t.ok(app.customer_exposure(app.mig_partner(:'co', 'K001', 'customer')) = 1250.50, 'and in credit limits');
select t.ok((select sum(total) from public.partner_aging(:'co', 'ar', current_date)) = 1500.50, 'and in the aging report');
select t.throws($$ select public.migration_import('$$ || :'co' || $$', 'open_receivables', '[{"partner":"K001","number":"F-120/25","amount":"5"}]', false, current_date) $$,
  'nothing was imported', 'the same invoice cannot come in twice');

-- ---------------------------------------------------------- open vendor bills
select public.migration_import(:'co', 'open_payables', '[{"partner":"F001","number":"DV-889","date":"2026-09-20","due_date":"2026-10-20","amount":"800"},
  {"partner":"F001","number":"DV-901","date":"2026-10-02","amount":"100","currency":"USD","rate":"0.92"}]', false, current_date) as ap \gset
select t.ok((select count(*) from public.vendor_bills where company_id = :'co' and is_opening and status = 'posted') = 2, 'open bills are posted as opening documents');
select t.ok((:'ap'::jsonb ->> 'total')::numeric = 892.00, 'foreign-currency bills use the given rate');
select t.ok((select count(*) from public.v_purchase_book where company_id = :'co') = 0, 'opening bills stay out of the purchase book');

-- ---------------------------------------------------------- opening balances
select public.migration_import(:'co', 'opening_balances', '[{"account":"5121","debit":"10000"},{"account":"411","debit":"1500,50"},
  {"account":"311","debit":"5"},{"account":"9999","debit":"1"},{"account":"164","credit":"4000"}]', true, current_date) as tb \gset
select t.ok(jsonb_array_length(:'tb'::jsonb -> 'errors') = 3, 'customers, stock and unknown accounts are refused in the trial balance');
select public.migration_import(:'co', 'opening_balances', '[{"account":"5121","debit":"10000"},{"account":"531","balance":"250"},
  {"account":"164","credit":"4000"},{"account":"4457","balance":"-180"}]', false, current_date) as tb \gset
select t.ok((select sum(debit) = sum(credit) from public.journal_lines where entry_id = (:'tb'::jsonb ->> 'journal_entry_id')::uuid), 'the opening entry balances');
select t.ok((public.migration_check(:'co', current_date) ->> 'opening_account_balance')::numeric = -(1500.50 - 892.00 + 10000 + 250 - 4000 - 180),
  'the opening balance account holds the difference');
select t.throws($$ select public.migration_import('$$ || :'co' || $$', 'opening_balances', '[{"account":"5121","debit":"1"}]', false, current_date) $$,
  'already imported', 'opening balances come in once');

-- ---------------------------------------------------------- price lists
select public.migration_import(:'co', 'price_lists', '[{"price_list":"Shumicë","sku":"UJE-15","price":"0,32"},{"price_list":"Shumicë","sku":"KAFE-1","price":"10","min_quantity":"10"}]', false, current_date) as pl \gset
select t.ok((:'pl'::jsonb ->> 'created') = '2' and exists (select 1 from public.price_lists where company_id = :'co' and name = 'Shumicë'), 'price lists are created with their prices');
select public.migration_import(:'co', 'price_lists', '[{"price_list":"shumicë","sku":"UJE-15","price":"0.35"}]', false, current_date) as pl \gset
select t.ok((:'pl'::jsonb ->> 'updated') = '1' and (select price from public.price_list_items i join public.product_variants v on v.id = i.variant_id where v.sku = 'UJE-15') = 0.35,
  'importing again updates the price');

-- ---------------------------------------------------------- checklist, log and templates
select t.ok((public.migration_check(:'co', current_date) ->> 'receivables')::numeric = 1500.50 and (public.migration_check(:'co', current_date) ->> 'payables')::numeric = 892.00,
  'the check shows the open totals to compare');
select t.ok(jsonb_array_length(public.migration_check(:'co', current_date) -> 'runs') = 5, 'every import is in the log');
select public.log_migration_run(:'co', 'products', 'artikujt.xlsx', 2, 2, 0, 0);
select t.ok((public.migration_check(:'co', current_date) -> 'runs' -> 0 ->> 'kind') = 'products', 'the spreadsheet importer logs too');
select public.save_import_template(:'co', 'products', 'Kubit · artikujt', 'Kubit', '{"sku":"Shifra","name":"Emërtimi"}');
select t.ok((select mapping ->> 'sku' from public.import_templates where name = 'Kubit · artikujt') = 'Shifra', 'a column mapping is saved as a template');
select t.throws($$ select public.save_import_template('$$ || :'co' || $$', 'products', 'Shared', 'Kubit', '{}', true) $$, 'Only the platform administrator', 'only the platform owner shares templates with every client');
select t.login('zoe@platform.io');
select public.save_import_template(:'co', 'products', 'Logmicro · artikujt', 'Logmicro', '{"sku":"Kodi"}', true);
select t.login('olga@drita.xk');
select t.ok(exists (select 1 from public.import_templates where name = 'Logmicro · artikujt') and not exists (select 1 from public.import_templates where name = 'Kubit · artikujt'),
  'shared templates reach every client, a company''s own stay private');
select t.throws($$ select public.migration_import('$$ || :'co' || $$', 'price_lists', '[]', true, current_date) $$, 'Permission denied', 'other companies cannot import here');
reset role;

-- ---------------------------------------------------------- warehouses and accounts from the old program
set role authenticated;
select t.login('mira@lider.xk');
select public.migration_import(:'co', 'warehouses', '[{"code":"1","name":"Njesia 1 DRENAS","type":"njesia","city":"Drenas"},{"code":"2","name":"Njesia 2 KORROTICE"},{"code":"","name":"x"}]', true, current_date) as wh \gset
select t.ok((:'wh'::jsonb ->> 'ok') = '2' and jsonb_array_length(:'wh'::jsonb -> 'errors') = 1, 'warehouse rows are checked');
select public.migration_import(:'co', 'warehouses', '[{"code":"1","name":"Njesia 1 DRENAS","type":"njesia","city":"Drenas"},{"code":"2","name":"Njesia 2 KORROTICE"}]', false, current_date, 'magazinat.csv');
select t.ok((select count(*) from public.warehouses where company_id = :'co' and warehouse_type = 'store') = 2, 'stores are created');
select public.migration_import(:'co', 'accounts', '[{"code":"12103","name":"Llogarite e Arketushme","type":"A","subtype":"receivable"},{"code":"50001","name":"Shpenzimet e Produktit","type":"E"},{"code":"x","name":"y","type":"Q"}]', false, current_date) as ac \gset
select t.ok((select account_subtype from public.accounts where company_id = :'co' and code = '12103') = 'receivable'
            and (select account_type from public.accounts where company_id = :'co' and code = '50001') = 'expense', 'accounts come in with their type');
select t.ok(jsonb_array_length(:'ac'::jsonb -> 'errors') = 1, 'an unknown account type is reported');
select t.ok((public.migration_check(:'co', current_date) ->> 'warehouses')::int >= 3 and (public.migration_check(:'co', current_date) ->> 'accounts_imported')::int = 2, 'the check counts stores and accounts');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
