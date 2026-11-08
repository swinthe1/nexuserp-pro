-- =============================================================================
-- DrisPRO · schema test suite
-- Runs against a database with the stub + all migrations applied.
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/01_rls_and_invariants.sql
-- Every check raises on failure, so a clean run == all assertions passed.
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
set client_min_messages = notice;

-- the till tests written before the manager reconciled every shift test a close that is final; 108 tests the three steps
alter table public.company_settings alter column pos_review set default 'off';

-- ---------- tiny test harness ------------------------------------------------
create schema t;
grant usage on schema t to authenticated;

create table t.results (n serial, label text, passed boolean);
grant insert, select on t.results to authenticated;
grant usage on sequence t.results_n_seq to authenticated;
-- the tests check costs whoever is signed in; who may read them is tested on its own (122)
create view t.item_costs as select * from public.item_costs;
grant select on t.item_costs to authenticated;

create function t.login(p_email text) returns void language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claim.sub', (select id::text from auth.users where email = p_email), false);
end $$;

-- people who already have an account are invited; in the tests they accept at once
create function t.accept_invites() returns void language sql security definer as $$
  update public.company_members set status = 'active', joined_at = now() where status = 'invited' and user_id is not null and deleted_at is null
$$;

create function t.ok(p_cond boolean, p_label text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'FAIL: %', p_label; end if;
  insert into t.results (label, passed) values (p_label, true);
end $$;

-- Runs p_sql and requires it to fail with an error message matching p_pattern
create function t.throws(p_sql text, p_pattern text, p_label text) returns void language plpgsql as $$
declare v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    v_msg := sqlerrm;
  end;
  if v_msg is null then raise exception 'FAIL (no error): %', p_label; end if;
  if v_msg !~* p_pattern then raise exception 'FAIL (wrong error "%"): %', v_msg, p_label; end if;
  insert into t.results (label, passed) values (p_label, true);
end $$;
grant execute on all functions in schema t to authenticated;

-- ---------- users ------------------------------------------------------------
insert into auth.users (email, raw_user_meta_data) values
  ('alice@alba.al',  '{"full_name":"Alice Admin"}'),
  ('bob@kosova.xk',  '{"full_name":"Bob Other-Tenant"}'),
  ('carol@alba.al',  '{"full_name":"Carol Sales Rep"}'),
  ('dave@alba.al',   '{"full_name":"Dave Auditor"}'),
  ('frank@alba.al',  '{"full_name":"Frank Finance"}'),
  ('erin@alba.al',   '{"full_name":"Erin Employee"}'),
  ('zoe@platform.io','{"full_name":"Zoe Super"}');
update public.profiles set is_super_admin = true where email = 'zoe@platform.io';
-- these suites build their own companies as ordinary users (self-service on); 13_platform_licensing covers the closed mode
update public.platform_settings set self_service = true;

select t.ok((select count(*) from public.profiles) = 7, 'profiles auto-created on signup');

-- ---------- tenants ----------------------------------------------------------
set role authenticated;
select t.login('alice@alba.al');
select public.create_company('Alba Retail sh.p.k.', 'AL', null, 'L91234567A') as company_a \gset
select public.invite_member(:'company_a', 'carol@alba.al', array['sales_rep']);
select t.accept_invites();
select public.invite_member(:'company_a', 'dave@alba.al',  array['auditor']);
select t.accept_invites();
select public.invite_member(:'company_a', 'frank@alba.al', array['finance_manager']);
select t.accept_invites();
select public.invite_member(:'company_a', 'erin@alba.al',  array['employee']);
select t.accept_invites();
select public.invite_member(:'company_a', 'late@alba.al',  array['warehouse_operator']);  -- not signed up yet
select t.accept_invites();

select t.login('bob@kosova.xk');
select public.create_company('Kosova Trade L.L.C.', 'XK') as company_b \gset
reset role;

select set_config('t.a', :'company_a', false), set_config('t.b', :'company_b', false);

-- ---------- 1. defaults seeded per country -----------------------------------
select t.ok((select base_currency from public.companies where id = :'company_a') = 'ALL', 'AL company uses ALL');
select t.ok((select base_currency from public.companies where id = :'company_b') = 'EUR', 'XK company uses EUR');
select t.ok(exists (select 1 from public.tax_codes where company_id = :'company_a' and code = 'VAT20' and rate = 20), 'AL VAT 20% seeded');
select t.ok(exists (select 1 from public.tax_codes where company_id = :'company_b' and code = 'VAT18' and rate = 18), 'XK VAT 18% seeded');
select t.ok((select count(*) from public.fiscal_periods where company_id = :'company_a') = 12, '12 fiscal periods seeded');
select t.ok((select count(*) from public.warehouse_locations where company_id = :'company_a') = 9, 'virtual + main warehouse locations seeded');

-- pending invite becomes active on signup
insert into auth.users (email) values ('late@alba.al');
select t.ok((select status from public.company_members where invited_email = 'late@alba.al') = 'active', 'invite accepted on signup');

-- ---------- 2. tenant isolation ---------------------------------------------
set role authenticated;
select t.login('bob@kosova.xk');
select t.ok((select count(*) from public.warehouses) = 1, 'bob sees only his own warehouse');
select t.ok((select count(*) from public.companies) = 1, 'bob sees only his own company');
select t.ok(not exists (select 1 from public.tax_codes where company_id = :'company_a'), 'bob cannot read company A tax codes');
select t.ok((select count(*) from public.profiles) = 1, 'bob sees only his own profile');
select t.throws(format($q$insert into public.warehouses (company_id, code, name) values (%L, 'HACK', 'x')$q$, :'company_a'),
                'row-level security', 'bob cannot insert into company A');
select t.throws(format($q$select public.switch_company(%L)$q$, :'company_a'), 'not a member', 'bob cannot switch into company A');
select t.ok((select jsonb_array_length(public.get_my_context() -> 'companies')) = 1, 'context lists only own companies');
reset role;

-- composite FKs: a company-A product can never point at a company-B unit of measure
select id as uom_b from public.units_of_measure where company_id = :'company_b' and code = 'pcs' \gset
select id as uom_a from public.units_of_measure where company_id = :'company_a' and code = 'pcs' \gset
select id as vat20 from public.tax_codes where company_id = :'company_a' and code = 'VAT20' \gset
set role authenticated;
select t.login('alice@alba.al');
select t.throws(format($q$insert into public.products (company_id, code, name, uom_id) values (%L, 'X1', 'Cross-tenant', %L)$q$, :'company_a', :'uom_b'),
                'foreign key', 'cross-company reference rejected by composite FK');

-- ---------- 3. permissions by role --------------------------------------------
insert into public.products (company_id, code, name, uom_id, sales_price, sales_tax_code_id)
values (:'company_a', 'TSHIRT', 'T-Shirt Basic', :'uom_a', 1200, :'vat20') returning id as product_id \gset
insert into public.product_variants (company_id, product_id, sku, name, is_default)
values (:'company_a', :'product_id', 'TSHIRT-M-NVY', 'T-Shirt Basic / M / Navy', true) returning id as variant_id \gset
insert into public.product_barcodes (company_id, variant_id, barcode, is_primary) values (:'company_a', :'variant_id', '5901234123457', true);
insert into public.business_partners (company_id, code, name, is_customer, tax_number)
values (:'company_a', 'C0001', 'Hotel Tirana', true, 'K12345678B') returning id as customer_id \gset
insert into public.business_partners (company_id, code, name, is_vendor)
values (:'company_a', 'V0001', 'Textile Supplier', true) returning id as vendor_id \gset

select t.ok((select created_by from public.products where id = :'product_id') = auth.uid(), 'created_by stamped from JWT');

select t.login('carol@alba.al');
select t.ok((select count(*) from public.products) = 1, 'sales rep can read products');
select t.throws(format($q$insert into public.products (company_id, code, name, uom_id) values (%L, 'P2', 'x', %L)$q$, :'company_a', :'uom_a'),
                'row-level security', 'sales rep cannot create products');
insert into public.business_partners (company_id, code, name, is_customer) values (:'company_a', 'C0002', 'Cafe Durres', true);
select t.ok(true, 'sales rep can create customers');
select t.ok((select count(*) from public.audit_log) = 0, 'sales rep cannot read the audit log');
select t.throws($q$update public.profiles set is_super_admin = true where id = auth.uid()$q$,
                'permission denied', 'users cannot escalate to super admin');
select t.throws(format($q$select public.invite_member(%L, 'x@y.z', array['company_admin'])$q$, :'company_a'),
                'permission denied', 'sales rep cannot invite members');

select t.login('dave@alba.al');
select t.ok((select count(*) from public.audit_log) > 0, 'auditor can read the audit log');
select t.throws(format($q$insert into public.business_partners (company_id, code, name, is_customer) values (%L, 'C9', 'x', true)$q$, :'company_a'),
                'row-level security', 'auditor is read-only');
reset role;

-- non-assignable roles
select m.id as alice_member from public.company_members m join auth.users u on u.id = m.user_id
 where u.email = 'alice@alba.al' and m.company_id = :'company_a' \gset
select t.throws(format($q$insert into public.member_roles (company_id, member_id, role_id)
                          select %L, %L, id from public.roles where key = 'super_admin'$q$, :'company_a', :'alice_member'),
                'cannot be assigned', 'super_admin cannot be granted inside a company');

-- super admin sees every tenant
set role authenticated;
select t.login('zoe@platform.io');
select t.ok((select count(*) from public.companies) = 2, 'super admin sees all companies');
reset role;

-- ---------- 4. documents: numbering, totals, status flow, line guard ---------
set role authenticated;
select t.login('alice@alba.al');
select id as wh_a from public.warehouses where company_id = :'company_a' \gset

insert into public.sales_orders (company_id, partner_id, warehouse_id, currency_code, order_date)
values (:'company_a', :'customer_id', :'wh_a', 'ALL', '2026-10-23') returning id as so1, number as so1_number \gset
insert into public.sales_orders (company_id, partner_id, warehouse_id, currency_code, order_date)
values (:'company_a', :'customer_id', :'wh_a', 'ALL', '2026-10-23') returning number as so2_number \gset
select t.ok(:'so1_number' = 'PSH-2026-00001' and :'so2_number' = 'PSH-2026-00002', 'document numbers are sequential per type and year');

insert into public.sales_order_lines (company_id, sales_order_id, line_no, variant_id, description, quantity, unit_price, discount_pct, tax_code_id)
values (:'company_a', :'so1', 1, :'variant_id', 'T-Shirt M Navy', 2, 100, 10, :'vat20');
select t.ok((select (line_subtotal, tax_amount, line_total, tax_rate) = (180.00, 36.00, 216.00, 20.0000)
               from public.sales_order_lines where sales_order_id = :'so1'), 'line amounts: 2×100 −10% +20% VAT = 216');
select t.ok((select (subtotal, discount_total, tax_total, total) = (180.00, 20.00, 36.00, 216.00)
               from public.sales_orders where id = :'so1'), 'header totals recalculated from lines');

select t.throws(format($q$update public.sales_orders set number = 'SO-HACK' where id = %L$q$, :'so1'), 'cannot be changed', 'document number is immutable');
select t.throws(format($q$update public.sales_orders set status = 'closed' where id = %L$q$, :'so1'), 'invalid status transition', 'illegal status jump rejected');
select t.throws(format($q$update public.sales_orders set status = 'confirmed' where id = %L$q$, :'so1'), 'set by its own action', 'posting statuses cannot be written directly');
select public.confirm_sales_order(:'so1');
select t.ok(exists (select 1 from public.entity_activities where entity_id = :'so1' and activity_type = 'status_change'), 'status change logged to timeline');
select t.throws(format($q$update public.sales_order_lines set quantity = 5 where sales_order_id = %L$q$, :'so1'),
                'cannot be modified while the document is confirmed', 'lines frozen after confirmation');
select t.throws(format($q$insert into public.sales_orders (company_id, partner_id, warehouse_id, currency_code, status) values (%L, %L, %L, 'ALL', 'closed')$q$,
                       :'company_a', :'customer_id', :'wh_a'),
                'invalid initial status', 'documents must start in an initial status');

-- credit notes share the invoices table but have their own series
insert into public.sales_invoices (company_id, partner_id, currency_code, invoice_date, due_date)
values (:'company_a', :'customer_id', 'ALL', '2026-10-23', '2026-11-22') returning id as inv1, number as inv_number \gset
insert into public.sales_invoices (company_id, document_type, partner_id, currency_code, original_invoice_id, invoice_date, due_date)
values (:'company_a', 'credit_note', :'customer_id', 'ALL', :'inv1', '2026-10-23', '2026-10-23') returning number as cn_number \gset
select t.ok(:'inv_number' = 'FAT-2026-00001' and :'cn_number' = 'NK-2026-00001', 'credit notes use their own number series');
reset role;

-- gapless: a rolled back document does not burn a number
do $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    insert into public.sales_orders (company_id, partner_id, warehouse_id, currency_code, order_date)
    select current_setting('t.a')::uuid, p.id, w.id, 'ALL', '2026-10-23'
      from public.business_partners p, public.warehouses w
     where p.company_id = current_setting('t.a')::uuid and w.company_id = p.company_id limit 1;
    raise exception 'rollback';
  exception when others then null;
  end;
end $$;
select t.ok((select next_value from public.document_sequence_counters where company_id = :'company_a' and doc_type = 'sales_order' and period_key = '2026') = 3,
            'numbering is gapless across rollbacks');

-- ---------- 5. soft delete, restore, audit -----------------------------------
set role authenticated;
select t.login('alice@alba.al');
delete from public.business_partners where code = 'C0002' and company_id = :'company_a';
reset role;
select t.ok((select deleted_at is not null from public.business_partners where code = 'C0002'), 'DELETE became a soft delete (row still exists)');
select t.ok(exists (select 1 from public.audit_log where table_name = 'business_partners' and action = 'SOFT_DELETE'), 'soft delete recorded in audit log');
set role authenticated;
select t.login('carol@alba.al');
select t.ok(not exists (select 1 from public.business_partners where code = 'C0002'), 'soft-deleted row hidden from normal users');
select t.login('dave@alba.al');
select t.ok(exists (select 1 from public.business_partners where code = 'C0002'), 'auditor still sees soft-deleted row');
select t.login('alice@alba.al');
select public.restore_record('business_partners', (select id from public.business_partners where code = 'C0002' and company_id = :'company_a'));
select t.ok((select deleted_at is null from public.business_partners where code = 'C0002'), 'restore_record un-deletes');
select t.throws(format($q$select public.restore_record('business_partners', %L)$q$, (select id from public.business_partners where code = 'C0002' and company_id = :'company_a')),
                'not removed', 'a record that is there cannot be brought back twice');
select t.login('carol@alba.al');
select t.throws(format($q$select public.restore_record('business_partners', %L)$q$, :'customer_id'),
                'permission denied', 'restore requires <module>.delete');
reset role;
select t.ok((select changed_fields = array['deleted_at','deleted_by'] from public.audit_log
               where table_name = 'business_partners' and action = 'RESTORE' order by id desc limit 1), 'restore audited with exact changed fields');

-- ---------- 6. stock ledger & projections ------------------------------------
set role authenticated;
select t.login('alice@alba.al');
select t.throws(format($q$insert into public.stock_levels (company_id, variant_id, warehouse_id, location_id, on_hand)
                          select %L, %L, %L, id, 99 from public.warehouse_locations where code = 'WH/STOCK' and company_id = %L$q$,
                       :'company_a', :'variant_id', :'wh_a', :'company_a'),
                'row-level security', 'clients cannot write stock levels directly');
reset role;
select id as loc_stock from public.warehouse_locations where company_id = :'company_a' and code = 'WH/STOCK' \gset
select id as loc_supplier from public.warehouse_locations where company_id = :'company_a' and code = 'VIRT/SUPPLIER' \gset
insert into public.stock_levels (company_id, variant_id, warehouse_id, location_id, on_hand, reserved)
values (:'company_a', :'variant_id', :'wh_a', :'loc_stock', 10, 3);
select t.ok((select available from public.stock_levels where variant_id = :'variant_id') = 7, 'available = on_hand − reserved');
insert into public.stock_movements (company_id, movement_type, variant_id, from_location_id, to_location_id, to_warehouse_id, quantity, unit_cost, total_cost)
values (:'company_a', 'receipt', :'variant_id', :'loc_supplier', :'loc_stock', :'wh_a', 10, 450, 4500) returning id as mv1 \gset
select t.throws(format($q$update public.stock_movements set quantity = 1 where id = %L$q$, :'mv1'), 'immutable', 'stock ledger is immutable (update)');
select t.throws(format($q$delete from public.stock_movements where id = %L$q$, :'mv1'), 'immutable', 'stock ledger is immutable (delete)');

-- ---------- 7. general ledger integrity --------------------------------------
set role authenticated;
select t.login('frank@alba.al');
insert into public.accounts (company_id, code, name, account_type, account_subtype) values
  (:'company_a', 'T5311', 'Cash',          'asset',   'cash'),
  (:'company_a', 'T411',  'Receivables',   'asset',   'receivable'),
  (:'company_a', 'T70',   'Revenue group', 'revenue', 'revenue');
update public.accounts set is_postable = false where company_id = :'company_a' and code = 'T70';
insert into public.journals (company_id, code, name, journal_type) values (:'company_a', 'TGEN', 'Test general', 'general');
select id as journal from public.journals where company_id = :'company_a' and code = 'TGEN' \gset
select id as acc_cash from public.accounts where company_id = :'company_a' and code = 'T5311' \gset
select id as acc_ar   from public.accounts where company_id = :'company_a' and code = 'T411' \gset
select id as acc_grp  from public.accounts where company_id = :'company_a' and code = 'T70' \gset
reset role;

-- unbalanced entry cannot be posted (checked at commit by the deferred trigger)
select t.throws(format($q$
  with e as (insert into public.journal_entries (company_id, journal_id, entry_date) values (%1$L, %2$L, '2026-10-23') returning id)
  insert into public.journal_lines (company_id, entry_id, line_no, account_id, debit, credit)
  select %1$L::uuid, e.id, 1, %3$L::uuid, 100, 0 from e union all select %1$L::uuid, e.id, 2, %4$L::uuid, 0, 90 from e;
  update public.journal_entries set status = 'posted' where status = 'draft' and company_id = %1$L;
  set constraints all immediate;$q$, :'company_a', :'journal', :'acc_cash', :'acc_ar'),
  'not balanced', 'unbalanced journal entry rejected');

select t.throws(format($q$
  with e as (insert into public.journal_entries (company_id, journal_id, entry_date) values (%1$L, %2$L, '2026-10-23') returning id)
  insert into public.journal_lines (company_id, entry_id, line_no, account_id, debit, credit)
  select %1$L::uuid, e.id, 1, %3$L::uuid, 50, 0 from e union all select %1$L::uuid, e.id, 2, %4$L::uuid, 0, 50 from e;
  update public.journal_entries set status = 'posted' where status = 'draft' and company_id = %1$L;
  set constraints all immediate;$q$, :'company_a', :'journal', :'acc_cash', :'acc_grp'),
  'cannot be posted to', 'posting to a group account rejected');

select t.throws(format($q$
  with e as (insert into public.journal_entries (company_id, journal_id, entry_date) values (%1$L, %2$L, '2019-01-01') returning id)
  insert into public.journal_lines (company_id, entry_id, line_no, account_id, debit, credit)
  select %1$L::uuid, e.id, 1, %3$L::uuid, 50, 0 from e union all select %1$L::uuid, e.id, 2, %4$L::uuid, 0, 50 from e;
  update public.journal_entries set status = 'posted' where status = 'draft' and company_id = %1$L;
  set constraints all immediate;$q$, :'company_a', :'journal', :'acc_cash', :'acc_ar'),
  'no fiscal period', 'posting outside any fiscal period rejected');

begin;
set local role authenticated;
select t.login('frank@alba.al');
insert into public.journal_entries (company_id, journal_id, entry_date, memo)
values (:'company_a', :'journal', '2026-10-23', 'Cash sale') returning id as je \gset
insert into public.journal_lines (company_id, entry_id, line_no, account_id, debit, credit) values
  (:'company_a', :'je', 1, :'acc_cash', 1200, 0),
  (:'company_a', :'je', 2, :'acc_ar',   0, 1200);
update public.journal_entries set status = 'posted' where id = :'je';
commit;
select t.ok((select (status, total_debit, total_credit, period_id is not null) = ('posted', 1200.00, 1200.00, true)
               from public.journal_entries where id = :'je'), 'balanced entry posts with period resolved');
select t.throws(format($q$update public.journal_entries set memo = 'edited' where id = %L$q$, :'je'), 'immutable', 'posted entry header frozen');
select t.throws(format($q$update public.journal_lines set debit = 1 where entry_id = %L$q$, :'je'), 'frozen', 'posted entry lines frozen');
select t.throws(format($q$delete from public.journal_entries where id = %L$q$, :'je'), 'immutable', 'posted entry cannot be deleted');

update public.fiscal_periods set status = 'closed' where company_id = :'company_a' and '2026-09-15' between start_date and end_date;
select t.throws(format($q$
  with e as (insert into public.journal_entries (company_id, journal_id, entry_date) values (%1$L, %2$L, '2026-09-15') returning id)
  insert into public.journal_lines (company_id, entry_id, line_no, account_id, debit, credit)
  select %1$L::uuid, e.id, 1, %3$L::uuid, 50, 0 from e union all select %1$L::uuid, e.id, 2, %4$L::uuid, 0, 50 from e;
  update public.journal_entries set status = 'posted' where status = 'draft' and company_id = %1$L;
  set constraints all immediate;$q$, :'company_a', :'journal', :'acc_cash', :'acc_ar'),
  'is closed', 'posting into a closed period rejected');

-- ---------- 8. approval workflow ---------------------------------------------
set role authenticated;
select t.login('alice@alba.al');
insert into public.approval_workflows (company_id, name, doc_type, min_amount) values (:'company_a', 'POs over 50,000 ALL', 'purchase_order', 50000)
returning id as wf \gset
insert into public.approval_workflow_steps (company_id, workflow_id, step_order, name, approver_role_id)
select :'company_a', :'wf', 1, 'Finance review', id from public.roles where key = 'finance_manager';

insert into public.purchase_orders (company_id, vendor_id, warehouse_id, currency_code, order_date)
values (:'company_a', :'vendor_id', :'wh_a', 'ALL', '2026-10-23') returning id as po_big \gset
insert into public.purchase_order_lines (company_id, purchase_order_id, line_no, variant_id, description, quantity, unit_price, tax_code_id)
values (:'company_a', :'po_big', 1, :'variant_id', 'T-shirts', 200, 450, :'vat20');
select public.submit_for_approval('purchase_order', :'po_big') as req \gset
select t.ok((select status from public.purchase_orders where id = :'po_big') = 'pending_approval', 'PO above threshold goes to pending approval');
select t.throws(format($q$select public.decide_approval(%L, 'approved')$q$, :'req'), 'own request', 'requester cannot approve own document');

insert into public.purchase_orders (company_id, vendor_id, warehouse_id, currency_code, order_date)
values (:'company_a', :'vendor_id', :'wh_a', 'ALL', '2026-10-23') returning id as po_small \gset
insert into public.purchase_order_lines (company_id, purchase_order_id, line_no, variant_id, description, quantity, unit_price)
values (:'company_a', :'po_small', 1, :'variant_id', 'T-shirts', 10, 450);
select public.submit_for_approval('purchase_order', :'po_small') is null as no_request \gset
select t.ok(:'no_request' and (select status from public.purchase_orders where id = :'po_small') = 'approved', 'PO below threshold auto-approved');

select t.login('carol@alba.al');
select t.throws(format($q$select public.decide_approval(%L, 'approved')$q$, :'req'), 'not an approver', 'non-approver cannot decide');
select t.login('frank@alba.al');
select t.ok((select count(*) from public.notifications where type = 'approval') = 1, 'approver was notified');
select t.ok(public.decide_approval(:'req', 'approved', 'Budget OK') = 'approved', 'finance manager approves');
select t.ok((select status from public.purchase_orders where id = :'po_big') = 'approved', 'approval moves PO to approved');
select t.login('alice@alba.al');
select t.ok(exists (select 1 from public.notifications where title like 'Approved:%'), 'requester notified of approval');
select t.ok((select count(*) from public.notifications where user_id <> auth.uid()) = 0, 'users only see their own notifications');

-- duplicate vendor invoice numbers are blocked
insert into public.vendor_bills (company_id, vendor_id, vendor_invoice_number, currency_code) values (:'company_a', :'vendor_id', 'F-2026/118', 'ALL');
select t.throws(format($q$insert into public.vendor_bills (company_id, vendor_id, vendor_invoice_number, currency_code) values (%L, %L, 'f-2026/118', 'ALL')$q$,
                       :'company_a', :'vendor_id'), 'already entered as', 'same vendor invoice cannot be entered twice');

-- ---------- 9. HR self-service -----------------------------------------------
reset role;
insert into public.employees (company_id, user_id, first_name, last_name, hire_date)
select :'company_a', id, 'Erin', 'Krasniqi', '2025-03-01' from auth.users where email = 'erin@alba.al' returning id as emp_erin, number as emp_no \gset
insert into public.employees (company_id, first_name, last_name, hire_date) values (:'company_a', 'Other', 'Person', '2024-01-01') returning id as emp_other \gset
insert into public.leave_types (company_id, name) values (:'company_a', 'Study leave') returning id as lt \gset
insert into public.employees (company_id, first_name, last_name, hire_date) values (:'company_a', 'Third', 'Hire', '2025-06-01') returning number as emp_no3 \gset
select t.ok(:'emp_no' = 'PUN-2025-00001' and :'emp_no3' = 'PUN-2025-00002', 'back-dated numbering keeps a separate counter per year');
set role authenticated;
select t.login('erin@alba.al');
select t.ok((select count(*) from public.employees) = 1 and (select id from public.employees) = :'emp_erin', 'employee sees only own record');
insert into public.leave_requests (company_id, employee_id, leave_type_id, start_date, end_date, days, status)
values (:'company_a', :'emp_erin', :'lt', '2026-11-02', '2026-11-03', 2, 'submitted');
select t.ok((select count(*) from public.leave_requests) = 1, 'employee can request own leave');
select t.throws(format($q$insert into public.leave_requests (company_id, employee_id, leave_type_id, start_date, end_date, days)
                          values (%L, %L, %L, '2026-11-02', '2026-11-02', 1)$q$, :'company_a', :'emp_other', :'lt'),
                'row-level security', 'employee cannot file leave for someone else');
select t.throws($q$update public.leave_requests set status = 'approved'$q$, 'set by its own action', 'employee cannot approve own leave');
reset role;

-- ---------- 10. manufacturing: BOM cycles -------------------------------------
set role authenticated;
select t.login('alice@alba.al');
insert into public.products (company_id, code, name, uom_id, is_manufactured) values
  (:'company_a', 'KIT', 'Gift kit', :'uom_a', true), (:'company_a', 'BOX', 'Gift box', :'uom_a', true);
insert into public.product_variants (company_id, product_id, sku, name, is_default)
select :'company_a', id, code, name, true from public.products where code in ('KIT','BOX') and company_id = :'company_a';
select v.id as v_kit from public.product_variants v where v.sku = 'KIT' \gset
select v.id as v_box from public.product_variants v where v.sku = 'BOX' \gset
insert into public.boms (company_id, code, variant_id, name) values (:'company_a', 'BOM-KIT', :'v_kit', 'Kit') returning id as bom_kit \gset
insert into public.boms (company_id, code, variant_id, name) values (:'company_a', 'BOM-BOX', :'v_box', 'Box') returning id as bom_box \gset
insert into public.bom_lines (company_id, bom_id, line_no, component_variant_id, quantity) values (:'company_a', :'bom_kit', 1, :'v_box', 1);
insert into public.bom_lines (company_id, bom_id, line_no, component_variant_id, quantity) values (:'company_a', :'bom_kit', 2, :'variant_id', 2);
select t.throws(format($q$insert into public.bom_lines (company_id, bom_id, line_no, component_variant_id, quantity) values (%L, %L, 1, %L, 1)$q$,
                       :'company_a', :'bom_box', :'v_kit'), 'circular bom', 'multi-level BOM cycle rejected');
select t.throws(format($q$insert into public.bom_lines (company_id, bom_id, line_no, component_variant_id, quantity) values (%L, %L, 3, %L, 1)$q$,
                       :'company_a', :'bom_kit', :'v_kit'), 'cannot contain the product', 'BOM cannot contain itself');

-- ---------- 11. POS idempotency & tax-inclusive lines ---------------------------
reset role;
insert into public.bank_accounts (company_id, name, account_kind, currency_code, account_id)
values (:'company_a', 'Till cash', 'cash', 'ALL', :'acc_cash') returning id as till_cash \gset
insert into public.pos_registers (company_id, code, name, warehouse_id, location_id, cash_account_id)
values (:'company_a', 'R1', 'Register 1', :'wh_a', :'loc_stock', :'till_cash') returning id as reg \gset
set role authenticated;
select t.login('alice@alba.al');
insert into public.pos_sessions (company_id, register_id, opening_cash) values (:'company_a', :'reg', 5000) returning id as ses \gset
select t.throws(format($q$insert into public.pos_sessions (company_id, register_id) values (%L, %L)$q$, :'company_a', :'reg'),
                'duplicate key', 'only one open session per register');
reset role;   -- receipts are written by the till function (pos_submit_order, Phase 6); here the raw table is exercised
insert into public.pos_orders (company_id, client_uuid, session_id, register_id, status)
values (:'company_a', '11111111-1111-1111-1111-111111111111', :'ses', :'reg', 'draft') returning id as pos1 \gset
insert into public.pos_order_lines (company_id, pos_order_id, line_no, variant_id, description, quantity, unit_price, tax_code_id)
values (:'company_a', :'pos1', 1, :'variant_id', 'T-Shirt', 1, 1200, :'vat20');
select t.ok((select (line_total, line_subtotal, tax_amount) = (1200.00, 1000.00, 200.00) from public.pos_order_lines where pos_order_id = :'pos1'),
            'POS line splits a VAT-inclusive price (1200 = 1000 + 200)');
select t.throws(format($q$insert into public.pos_orders (company_id, client_uuid, session_id, register_id) values (%L, '11111111-1111-1111-1111-111111111111', %L, %L)$q$,
                       :'company_a', :'ses', :'reg'), 'duplicate key', 'offline receipt replay is idempotent (client_uuid)');
update public.pos_orders set status = 'paid' where id = :'pos1';
select t.ok((select vat_amount from public.v_sales_book where document_id = :'pos1') = 200.00, 'POS receipt appears in the sales book');
reset role;

-- ---------- 12. schema-wide guarantees ---------------------------------------
select t.ok(not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity), 'every public table has RLS enabled');
select t.ok(not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and not exists (select 1 from pg_policy p where p.polrelid = c.oid)), 'every public table has at least one policy');
select t.ok(not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and has_table_privilege('anon', c.oid, 'select')), 'anon cannot read any table');
select t.ok(not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'company_id')
     and c.relname not in (select table_name from app.table_registry)
     and c.relname not in ('audit_log', 'document_sequence_counters', 'notification_preferences', 'roles', 'licenses', 'migration_runs', 'import_templates', 'sync_connections', 'external_documents', 'sync_agent_logs', 'portal_links', 'api_keys', 'api_external_refs', 'training_progress', 'task_list_members', 'task_watchers', 'my_exports', 'company_signatures', 'chat_conversations', 'chat_members', 'chat_messages', 'item_requests', 'pos_catalog_pulse')   -- hand-written policies by design
  ), 'every company table went through register_table');

-- ---------- summary ------------------------------------------------------------
\set QUIET off
select count(*) as assertions_passed from t.results;
