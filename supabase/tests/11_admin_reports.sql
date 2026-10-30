-- =============================================================================
-- DrisPRO · Phase 8 admin, reporting, notifications and search tests (runs after 01–10)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

insert into auth.users (email, raw_user_meta_data) values
  ('amy@adm.al', '{"full_name":"Amy Admin"}'), ('bob@adm.al', '{"full_name":"Bob Sales"}'), ('aud@adm.al', '{"full_name":"Aud Auditor"}'),
  ('hal@adm.al', '{"full_name":"Hal HR"}'), ('cy@adm.al', '{"full_name":"Cy Cashier"}');
select id as u_bob from auth.users where email = 'bob@adm.al' \gset

set role authenticated;
select t.login('alice@alba.al');
select public.create_company('Admin Test', 'AL') as co \gset
select public.create_company('Other Co', 'AL') as other \gset
select public.invite_member(:'co', 'amy@adm.al', array['company_admin']) as m_amy \gset
select t.accept_invites();
select public.invite_member(:'co', 'bob@adm.al', array['sales_rep']) as m_bob \gset
select t.accept_invites();
select public.invite_member(:'co', 'aud@adm.al', array['auditor']);
select t.accept_invites();
select public.invite_member(:'co', 'hal@adm.al', array['hr_manager']);
select t.accept_invites();
select public.invite_member(:'co', 'cy@adm.al', array['pos_cashier']);
select t.accept_invites();
select id as m_alice from public.company_members where company_id = :'co' and user_id = auth.uid() \gset
select t.throws(format($q$select public.invite_member(%L, 'BOB@adm.al', array['sales_rep'])$q$, :'co'), 'already a member', 'no duplicate memberships');
select t.throws(format($q$select public.invite_member(%L, 'not-an-email', array['sales_rep'])$q$, :'co'), 'valid email', 'invites need an email address');

-- ---------- roles and members ----------------------------------------------------------------------
select public.save_custom_role(:'co', null, 'Shop supervisor', 'Runs a shop', array['pos.*','inventory.read','sales.read','reports.read']) as role_ss \gset
select t.throws(format($q$select public.save_custom_role(%L, null, 'Bad', null, array['pos.fly'])$q$, :'co'), 'Unknown permissions', 'permissions come from the catalog');
select t.throws(format($q$select public.save_custom_role(%L, (select id from public.roles where key = 'sales_rep'), 'X', null, array['sales.read'])$q$, :'co'),
                'System roles cannot be changed', 'system roles are fixed');
select public.save_custom_role(:'other', null, 'Elsewhere', null, array['sales.read']) as role_other \gset
select t.throws(format($q$select public.set_member_roles(%L, array[%L]::uuid[])$q$, :'m_bob', :'role_other'), 'cannot be assigned here', 'another company''s role cannot be given');
select public.set_member_roles(:'m_bob', array[:'role_ss']::uuid[]);
select t.login('bob@adm.al');
select t.ok((select c -> 'permissions' @> '["pos.*"]'::jsonb from jsonb_array_elements(public.get_my_context() -> 'companies') c where (c ->> 'id')::uuid = :'co'::uuid),
            'the custom role''s permissions take effect');
select t.ok((select count(*) from public.company_users(:'co')) = 0, 'people without admin rights do not see the user list');
select t.ok((select count(*) from public.roles where company_id = :'other') = 0, 'custom roles of other companies are invisible');
select t.login('alice@alba.al');
select t.throws(format($q$select public.delete_custom_role(%L)$q$, :'role_ss'), 'have this role', 'a role in use cannot be deleted');
select public.set_member_roles(:'m_bob', array[(select id from public.roles where key = 'sales_rep')]::uuid[]);
select public.delete_custom_role(:'role_ss');
select t.ok((select role_names from public.company_users(:'co') where member_id = :'m_bob') = array['Sales Rep'], 'user list shows role names');
select t.throws(format($q$select public.set_member_status(%L, 'suspended')$q$, :'m_alice'), 'yourself', 'nobody suspends themselves');
select public.set_member_status(:'m_amy', 'suspended');
select t.throws(format($q$select public.set_member_roles(%L, array[(select id from public.roles where key = 'sales_rep')]::uuid[])$q$, :'m_alice'),
                'last company admin', 'the last admin keeps admin rights');
select public.set_member_status(:'m_amy', 'active');

-- ---------- approval workflows and numbering -------------------------------------------------------
select public.save_approval_workflow(jsonb_build_object('company_id', :'co', 'name', 'Large purchases', 'doc_type', 'purchase_order', 'min_amount', 50000,
       'steps', jsonb_build_array(jsonb_build_object('name', 'Finance', 'approver_role_id', (select id from public.roles where key = 'finance_manager')),
                                  jsonb_build_object('name', 'Director', 'approver_role_id', (select id from public.roles where key = 'company_admin'))))) as wf \gset
select t.ok((select count(*) from public.approval_workflow_steps where workflow_id = :'wf') = 2, 'workflow with two steps');
select public.save_approval_workflow(jsonb_build_object('id', :'wf', 'company_id', :'co', 'name', 'Large purchases', 'doc_type', 'purchase_order', 'min_amount', 80000,
       'steps', jsonb_build_array(jsonb_build_object('name', 'Director', 'approver_role_id', (select id from public.roles where key = 'company_admin')))));
select t.ok((select (count(*), min(name)) = (1, 'Director') from public.approval_workflow_steps where workflow_id = :'wf')
            and (select min_amount from public.approval_workflows where id = :'wf') = 80000, 'workflow edited: one step, higher threshold');
select t.throws(format($q$select public.save_approval_workflow(jsonb_build_object('company_id', %L, 'name', 'x', 'doc_type', 'delivery', 'steps', '[{}]'::jsonb))$q$, :'co'),
                'no approval step', 'only documents with an approval status');

select public.save_numbering(:'co', 'sales_invoice', 'FAT-', true, 6, 'yearly', 100);
select t.ok((select next_number from public.numbering_overview(:'co') where doc_type = 'sales_invoice') = 'FAT-' || extract(year from current_date) || '-000100',
            'numbering preview shows the next invoice number');
select t.throws(format($q$select public.save_numbering(%L, 'sales_invoice', 'FAT-', true, 6, 'yearly', 50)$q$, :'co'), 'only move forward', 'numbers never go back');
select t.throws(format($q$select public.save_numbering(%L, 'sales_invoice', 'F A', true, 6, 'yearly')$q$, :'co'), 'spaces', 'prefixes have no spaces');

-- ---------- imports ----------------------------------------------------------------------------------
select public.import_rows(:'co', 'products', '[{"sku":"IMP-1","name":"Imported A","uom":"pcs","price":"1000","cost":"600","vat":"VAT20","category":"Drinks"},
                                               {"sku":"IMP-2","uom":"pcs"},
                                               {"sku":"IMP-3","name":"Bad unit","uom":"barrel"}]', true) as dry \gset
select t.ok(jsonb_array_length(:'dry'::jsonb -> 'errors') = 2 and :'dry'::jsonb #>> '{errors,0,field}' = 'name' and :'dry'::jsonb #>> '{errors,1,field}' = 'uom',
            'dry run reports each bad row and field');
select t.ok((select count(*) from public.product_variants where company_id = :'co' and sku like 'IMP-%') = 0
            and (select count(*) from public.product_categories where company_id = :'co' and name = 'Drinks') = 0, 'a dry run changes nothing');
select t.ok((public.import_rows(:'co', 'products', '[{"sku":"IMP-1","name":"Imported A","uom":"pcs","price":"1000","cost":"600","vat":"VAT20","category":"Drinks"}]', false)) ->> 'created' = '1',
            'import creates the product');
select public.import_rows(:'co', 'products', '[{"sku":"IMP-1","name":"Imported A (1 L)","price":"1100"}]', false) as up \gset
select t.ok(:'up'::jsonb ->> 'updated' = '1' and (select name from public.product_variants where company_id = :'co' and sku = 'IMP-1') = 'Imported A (1 L)',
            're-import by SKU updates');
select public.import_rows(:'co', 'partners', '[{"name":"Klient A","tax_number":"L12345678A","city":"Tirana","role":"customer"},{"name":"Klient B","tax_number":"L1234"}]', false) as pi \gset
select t.ok(:'pi'::jsonb ->> 'created' = '1' and :'pi'::jsonb #>> '{errors,0,field}' = 'tax_number', 'NIPT format is checked');
select public.import_rows(:'co', 'opening_stock', '[{"sku":"IMP-1","warehouse":"WH","quantity":"40","unit_cost":"600"},{"sku":"NOPE","warehouse":"WH","quantity":"1","unit_cost":"1"}]', false) as si \gset
select t.ok(jsonb_array_length(:'si'::jsonb -> 'errors') = 1 and (select count(*) from public.stock_adjustments where company_id = :'co') = 0,
            'opening stock goes in as one document: one bad row, nothing posted');
select public.import_rows(:'co', 'opening_stock', '[{"sku":"IMP-1","warehouse":"WH","quantity":"40","unit_cost":"600"}]', false) as si2 \gset
select t.ok((select sum(on_hand) from public.stock_levels sl join public.product_variants v on v.id = sl.variant_id where v.company_id = :'co' and v.sku = 'IMP-1') = 40,
            'opening stock posted');
select t.login('hal@adm.al');
select public.import_rows(:'co', 'employees', '[{"first_name":"Zana","last_name":"Search","hire_date":"2025-02-01","department":"Shop","position":"Cashier","gross_salary":"55000"}]', false) as ei \gset
select t.ok(:'ei'::jsonb ->> 'created' = '1'
            and (select count(*) from public.employment_contracts c join public.employees e on e.id = c.employee_id where e.full_name = 'Zana Search') = 1,
            'employee import creates department, position and contract');
select t.throws(format($q$select public.import_rows(%L, 'products', '[{"sku":"X","name":"X"}]', true)$q$, :'co'), 'Permission denied', 'HR cannot import products');

-- ---------- audit trail --------------------------------------------------------------------------------
select t.login('aud@adm.al');
select t.ok(exists (select 1 from public.audit_feed(:'co', 'business_partners') where record_label = 'Klient A' and action = 'INSERT' and actor = 'Alice Admin'),
            'audit trail names who created what');
select t.login('bob@adm.al');
select t.throws(format($q$select * from public.audit_feed(%L)$q$, :'co'), 'audit.read', 'sales reps cannot read the audit trail');

-- ---------- reports ------------------------------------------------------------------------------------
select t.login('alice@alba.al');
select id as cust from public.business_partners where company_id = :'co' and name = 'Klient A' \gset
select v.id as impv from public.product_variants v where v.company_id = :'co' and v.sku = 'IMP-1' \gset
select id as vat20 from public.tax_codes where company_id = :'co' and code = 'VAT20' \gset
insert into public.sales_invoices (company_id, partner_id, currency_code) values (:'co', :'cust', 'ALL') returning id as inv \gset
insert into public.sales_invoice_lines (company_id, invoice_id, line_no, variant_id, description, quantity, unit_price, tax_code_id)
values (:'co', :'inv', 1, :'impv', 'Imported A', 10, 1000, :'vat20');
select public.post_sales_invoice(:'inv');
select t.ok((select number from public.sales_invoices where id = :'inv') = 'FAT-' || extract(year from current_date) || '-000100', 'invoice numbered by the new sequence');
select public.run_report(:'co', 'sales', jsonb_build_object('group_by', 'customer', 'from', current_date - 1, 'to', current_date)) as rep \gset
select t.ok((:'rep'::jsonb -> 'totals' ->> 'revenue')::numeric = 10000 and (:'rep'::jsonb -> 'totals' ->> 'cost')::numeric = 6000
            and (:'rep'::jsonb -> 'totals' ->> 'margin_pct')::numeric = 40, 'sales report: 10,000 revenue, 6,000 cost, 40% margin');
select t.ok((:'rep'::jsonb #>> '{rows,0,label}') = 'Klient A', 'grouped by customer');
select public.run_report(:'co', 'sales', jsonb_build_object('group_by', 'document', 'filters', jsonb_build_object('customer', :'cust'))) as rep2 \gset
select t.ok((:'rep2'::jsonb #>> '{rows,0,href}') = '/sales/invoices/' || :'inv', 'drill-down to the documents, with links');
select t.ok(jsonb_array_length((public.run_report(:'co', 'sales', '{"group_by":"customer","filters":{"customer":"x'' or ''1''=''1"}}')) -> 'rows') = 0,
            'filter values are data, not SQL');
select t.throws(format($q$select public.run_report(%L, 'sales', '{"group_by":"pg_sleep(1)"}')$q$, :'co'), 'Cannot group', 'unknown groupings are refused');
select t.ok((public.run_report(:'co', 'inventory', '{}') -> 'totals' ->> 'value')::numeric = 24000, 'inventory report: 40 on hand at 600 (invoicing alone moves no stock)');
select t.ok((public.run_report(:'co', 'receivables', '{}') -> 'totals' ->> 'due')::numeric = 12000, 'receivables report: open 12,000');
select t.login('cy@adm.al');
select t.throws(format($q$select public.run_report(%L, 'sales', '{}')$q$, :'co'), 'Permission denied', 'cashiers cannot run sales reports');

-- ---------- notifications --------------------------------------------------------------------------------
select t.login('bob@adm.al');
insert into public.notification_preferences (user_id, company_id, category, in_app) values (auth.uid(), :'co', 'stock', false);
reset role;
select app.notify(:'co', :'u_bob', 'info', 'Muted stock message', null, null, 'purchase_orders', null);
select app.notify(:'co', :'u_bob', 'approval', 'Approval required: PO-1', null, null, 'purchase_orders', null);
select app.notify(:'co', :'u_bob', 'info', 'People message', null, null, 'leave_requests', null);
select t.ok((select count(*) from public.notifications where user_id = :'u_bob' and title = 'Muted stock message') = 0, 'muted categories are not delivered');
select t.ok((select category from public.notifications where user_id = :'u_bob' and title = 'Approval required: PO-1') = 'approvals', 'approvals always arrive');
select t.ok((select category from public.notifications where user_id = :'u_bob' and title = 'People message') = 'people', 'categories come from the record type');
insert into public.employment_contracts (company_id, employee_id, start_date, end_date, gross_salary, currency_code)
select :'co', id, '2026-01-01', current_date + 10, 60000, 'ALL' from public.employees where company_id = :'co' and full_name = 'Zana Search'
  and not exists (select 1 from public.employment_contracts c where c.employee_id = employees.id and c.status = 'active');
update public.employment_contracts set end_date = current_date + 10 where employee_id = (select id from public.employees where company_id = :'co' and full_name = 'Zana Search');
select public.run_daily_reminders();
select public.run_daily_reminders();
select t.ok((select count(*) from public.notifications n join auth.users u on u.id = n.user_id
              where u.email = 'hal@adm.al' and n.company_id = :'co' and n.title like 'Contract of Zana Search ends%') = 1, 'daily reminder sent once');

-- ---------- search ----------------------------------------------------------------------------------------
set role authenticated;
select t.login('alice@alba.al');
select t.ok(exists (select 1 from public.global_search(:'co', 'zana') where kind = 'employee'), 'search finds employees');
select t.ok(exists (select 1 from public.global_search(:'co', 'FAT-') where kind = 'sales_invoice'), 'search finds documents by number');

reset role;
\set QUIET off
select count(*) as assertions_passed from t.results;
