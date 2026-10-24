-- =============================================================================
-- NexusERP Pro · 0110 · Global reference data
-- Currencies, permission catalog, the 14 system roles and their permission
-- matrix, document types (numbering prefixes + approval statuses) and the
-- allowed status flow of every document.
-- =============================================================================

insert into public.currencies (code, name, symbol, decimals) values
  ('ALL', 'Albanian Lek',      'L',   2),
  ('EUR', 'Euro',              '€',   2),
  ('USD', 'US Dollar',         '$',   2),
  ('GBP', 'British Pound',     '£',   2),
  ('CHF', 'Swiss Franc',       'CHF', 2),
  ('MKD', 'Macedonian Denar',  'ден', 2),
  ('RSD', 'Serbian Dinar',     'дин', 2),
  ('TRY', 'Turkish Lira',      '₺',   2);

-- -----------------------------------------------------------------------------
-- Permission catalog: <module>.<action>
-- -----------------------------------------------------------------------------
insert into public.permissions (key, module, action, description)
select m.module || '.' || a.action, m.module, a.action, m.description
from (values
  ('core',          'Company profile, reference data, approvals inbox'),
  ('collab',        'Comments, activity timeline, attachments'),
  ('admin',         'Users, roles, settings, workflows, numbering'),
  ('audit',         'Audit log and soft-deleted records'),
  ('partners',      'Customers and vendors'),
  ('crm',           'Leads, opportunities, pipeline'),
  ('sales',         'Quotes and sales orders'),
  ('invoicing',     'Customer invoices, vendor bills, payments'),
  ('pos',           'Point of sale'),
  ('inventory',     'Products, stock, valuation, adjustments'),
  ('wms',           'Receipts, deliveries, transfers, tasks, counts'),
  ('oms',           'Replenishment rules and suggestions'),
  ('requisitions',  'Purchase requisitions'),
  ('procurement',   'Purchase orders, landed costs, vendor pricing'),
  ('manufacturing', 'BOMs, work centers, work orders'),
  ('finance',       'Chart of accounts, journals, banks, assets'),
  ('tax',           'Tax codes, VAT books and declarations, fiscalization'),
  ('hr',            'Employees, attendance, leave'),
  ('payroll',       'Contracts, payroll runs, payslips'),
  ('logistics',     'Carriers, vehicles, routes, shipments'),
  ('ecommerce',     'Sales channels and order import'),
  ('reports',       'Reporting and analytics')
) as m(module, description)
cross join (values ('read'), ('write'), ('delete'), ('approve')) as a(action);

-- -----------------------------------------------------------------------------
-- Roles
-- -----------------------------------------------------------------------------
insert into public.roles (key, name, description, is_assignable, sort_order) values
  ('super_admin',         'Super Admin',         'Platform operator with access to every company',  false, 0),
  ('company_admin',       'Company Admin',       'Full control of one company',                     true,  1),
  ('finance_manager',     'Finance Manager',     'Owns accounting, tax and AR/AP',                  true,  2),
  ('accountant',          'Accountant',          'Day-to-day bookkeeping',                          true,  3),
  ('sales_manager',       'Sales Manager',       'Runs the sales team and pipeline',                true,  4),
  ('sales_rep',           'Sales Rep',           'Works leads, quotes and orders',                  true,  5),
  ('inventory_manager',   'Inventory Manager',   'Owns stock, costing and replenishment',           true,  6),
  ('warehouse_operator',  'Warehouse Operator',  'Receives, picks, ships and counts',               true,  7),
  ('procurement_manager', 'Procurement Manager', 'Buys from vendors',                               true,  8),
  ('production_manager',  'Production Manager',  'Plans and runs manufacturing',                    true,  9),
  ('hr_manager',          'HR Manager',          'People, attendance, leave and payroll',           true,  10),
  ('pos_cashier',         'POS Cashier',         'Sells at the till',                               true,  11),
  ('employee',            'Employee',            'Self-service: own profile, leave and payslips',   true,  12),
  ('auditor',             'Auditor',             'Read-only access to everything incl. audit log',  true,  13);

insert into public.role_permissions (role_id, permission)
select r.id, p from public.roles r
cross join lateral unnest(case r.key
  when 'super_admin'   then array['*']
  when 'company_admin' then array['*']
  when 'finance_manager' then array[
    'core.*','collab.*','finance.*','tax.*','invoicing.*','partners.*','payroll.read','audit.read','reports.*',
    'sales.read','crm.read','procurement.read','requisitions.read','inventory.read','wms.read','pos.read',
    'manufacturing.read','logistics.read','hr.read','ecommerce.read','oms.read']
  when 'accountant' then array[
    'core.read','collab.read','collab.write','finance.read','finance.write','tax.read','tax.write',
    'invoicing.read','invoicing.write','partners.read','partners.write','reports.read',
    'sales.read','procurement.read','inventory.read','wms.read','pos.read']
  when 'sales_manager' then array[
    'core.read','collab.*','crm.*','sales.*','invoicing.read','invoicing.write','partners.*','reports.read',
    'inventory.read','wms.read','logistics.read','pos.read','ecommerce.read']
  when 'sales_rep' then array[
    'core.read','collab.read','collab.write','crm.read','crm.write','sales.read','sales.write',
    'invoicing.read','partners.read','partners.write','inventory.read','wms.read','logistics.read']
  when 'inventory_manager' then array[
    'core.read','collab.*','inventory.*','wms.*','oms.*','requisitions.read','requisitions.write','reports.read',
    'procurement.read','manufacturing.read','logistics.read','partners.read','sales.read']
  when 'warehouse_operator' then array[
    'core.read','collab.read','collab.write','inventory.read','wms.read','wms.write','logistics.read',
    'partners.read','sales.read','procurement.read']
  when 'procurement_manager' then array[
    'core.read','collab.*','procurement.*','requisitions.*','oms.*','partners.*','invoicing.read','reports.read',
    'inventory.read','wms.read']
  when 'production_manager' then array[
    'core.read','collab.*','manufacturing.*','inventory.read','inventory.write','wms.read','wms.write',
    'requisitions.read','requisitions.write','procurement.read','partners.read','sales.read','reports.read']
  when 'hr_manager' then array['core.read','collab.*','hr.*','payroll.*','reports.read']
  when 'pos_cashier' then array['core.read','collab.read','pos.read','pos.write','partners.read','partners.write','inventory.read']
  when 'employee' then array['core.read','collab.read','collab.write']
  when 'auditor' then array['*.read']
end) as p;

-- -----------------------------------------------------------------------------
-- Document types
-- -----------------------------------------------------------------------------
insert into public.document_types (key, name, module, table_name, default_prefix, pending_status, approved_status, rejected_status) values
  ('lead',                 'Lead',                 'crm',           'leads',                  'LD-',   null, null, null),
  ('opportunity',          'Opportunity',          'crm',           'opportunities',          'OPP-',  null, null, null),
  ('sales_quote',          'Sales Quote',          'sales',         'sales_quotes',           'QT-',   null, null, null),
  ('sales_order',          'Sales Order',          'sales',         'sales_orders',           'SO-',   'pending_approval', 'confirmed', 'draft'),
  ('delivery',             'Delivery',             'wms',           'deliveries',             'DO-',   null, null, null),
  ('sales_invoice',        'Sales Invoice',        'invoicing',     'sales_invoices',         'INV-',  null, null, null),
  ('credit_note',          'Credit Note',          'invoicing',     'sales_invoices',         'CN-',   null, null, null),
  ('customer_payment',     'Customer Payment',     'invoicing',     'payments',               'RCP-',  null, null, null),
  ('vendor_payment',       'Vendor Payment',       'invoicing',     'payments',               'PAY-',  'pending_approval', 'approved', 'draft'),
  ('purchase_requisition', 'Purchase Requisition', 'requisitions',  'purchase_requisitions',  'PR-',   'submitted', 'approved', 'rejected'),
  ('purchase_order',       'Purchase Order',       'procurement',   'purchase_orders',        'PO-',   'pending_approval', 'approved', 'draft'),
  ('goods_receipt',        'Goods Receipt',        'wms',           'goods_receipts',         'GRN-',  null, null, null),
  ('vendor_bill',          'Vendor Bill',          'invoicing',     'vendor_bills',           'BILL-', null, null, null),
  ('vendor_credit',        'Vendor Credit Note',   'invoicing',     'vendor_bills',           'VCN-',  null, null, null),
  ('landed_cost',          'Landed Cost',          'procurement',   'landed_costs',           'LC-',   null, null, null),
  ('stock_transfer',       'Stock Transfer',       'wms',           'stock_transfers',        'TRF-',  null, null, null),
  ('stock_adjustment',     'Stock Adjustment',     'inventory',     'stock_adjustments',      'ADJ-',  'pending_approval', 'approved', 'draft'),
  ('cycle_count',          'Cycle Count',          'wms',           'cycle_counts',           'CC-',   null, null, null),
  ('warehouse_task',       'Warehouse Task',       'wms',           'warehouse_tasks',        'TSK-',  null, null, null),
  ('work_order',           'Work Order',           'manufacturing', 'work_orders',            'WO-',   null, null, null),
  ('journal_entry',        'Journal Entry',        'finance',       'journal_entries',        'JE-',   null, null, null),
  ('fixed_asset',          'Fixed Asset',          'finance',       'fixed_assets',           'FA-',   null, null, null),
  ('pos_session',          'POS Session',          'pos',           'pos_sessions',           'SES-',  null, null, null),
  ('pos_order',            'POS Receipt',          'pos',           'pos_orders',             'POS-',  null, null, null),
  ('z_report',             'Z-Report',             'pos',           'z_reports',              'Z-',    null, null, null),
  ('shipment',             'Shipment',             'logistics',     'shipments',              'SHP-',  null, null, null),
  ('delivery_route',       'Delivery Route',       'logistics',     'delivery_routes',        'RT-',   null, null, null),
  ('leave_request',        'Leave Request',        'hr',            'leave_requests',         'LV-',   'submitted', 'approved', 'rejected'),
  ('payroll_run',          'Payroll Run',          'payroll',       'payroll_runs',           'PRL-',  null, 'approved', 'draft'),
  ('vat_declaration',      'VAT Declaration',      'tax',           'vat_declarations',       'VAT-',  null, null, null),
  ('employee',             'Employee',             'hr',            'employees',              'EMP-',  null, null, null);

-- -----------------------------------------------------------------------------
-- Status flows ('__init__' = allowed initial statuses)
-- -----------------------------------------------------------------------------
select app.define_flow('lead', '{new}',
  '{new>contacted,new>qualified,new>lost,contacted>qualified,contacted>lost,qualified>converted,qualified>lost,lost>new}');
select app.define_flow('opportunity', '{open}', '{open>won,open>lost,lost>open}');
select app.define_flow('sales_quote', '{draft}',
  '{draft>sent,draft>cancelled,sent>accepted,sent>rejected,sent>expired,sent>draft,accepted>converted,rejected>draft,expired>draft}');
select app.define_flow('sales_order', '{draft}',
  '{draft>pending_approval,draft>confirmed,draft>cancelled,pending_approval>confirmed,pending_approval>draft,pending_approval>cancelled,confirmed>partially_delivered,confirmed>delivered,confirmed>cancelled,partially_delivered>delivered,partially_delivered>closed,delivered>closed}');
select app.define_flow('delivery', '{draft}', '{draft>ready,draft>cancelled,ready>draft,ready>done,ready>cancelled}');
select app.define_flow('sales_invoice', '{draft}', '{draft>posted,draft>cancelled}');
select app.define_flow('credit_note',   '{draft}', '{draft>posted,draft>cancelled}');
select app.define_flow('customer_payment', '{draft}', '{draft>posted,draft>cancelled,posted>reversed}');
select app.define_flow('vendor_payment', '{draft}',
  '{draft>pending_approval,draft>approved,draft>cancelled,pending_approval>approved,pending_approval>draft,approved>posted,approved>cancelled,posted>reversed}');
select app.define_flow('purchase_requisition', '{draft}',
  '{draft>submitted,draft>cancelled,submitted>approved,submitted>rejected,submitted>draft,approved>ordered,approved>cancelled,rejected>draft}');
select app.define_flow('purchase_order', '{draft}',
  '{draft>pending_approval,draft>approved,draft>cancelled,pending_approval>approved,pending_approval>draft,pending_approval>cancelled,approved>sent,approved>partially_received,approved>received,approved>cancelled,sent>partially_received,sent>received,sent>cancelled,partially_received>received,partially_received>closed,received>closed}');
select app.define_flow('goods_receipt', '{draft}', '{draft>done,draft>cancelled}');
select app.define_flow('vendor_bill',   '{draft}', '{draft>posted,draft>cancelled}');
select app.define_flow('vendor_credit', '{draft}', '{draft>posted,draft>cancelled}');
select app.define_flow('landed_cost', '{draft}', '{draft>posted,draft>cancelled}');
select app.define_flow('stock_transfer', '{draft}', '{draft>in_transit,draft>done,draft>cancelled,in_transit>done}');
select app.define_flow('stock_adjustment', '{draft}',
  '{draft>pending_approval,draft>approved,draft>cancelled,pending_approval>approved,pending_approval>draft,approved>posted,approved>cancelled}');
select app.define_flow('cycle_count', '{draft}',
  '{draft>in_progress,draft>cancelled,in_progress>review,in_progress>cancelled,review>in_progress,review>posted}');
select app.define_flow('warehouse_task', '{open}', '{open>in_progress,open>cancelled,in_progress>open,in_progress>done}');
select app.define_flow('work_order', '{draft}',
  '{draft>released,draft>cancelled,released>draft,released>in_progress,released>cancelled,in_progress>completed,completed>closed}');
select app.define_flow('journal_entry', '{draft}', '{draft>posted,draft>cancelled,posted>reversed}');
select app.define_flow('fixed_asset', '{draft}', '{draft>active,active>fully_depreciated,active>disposed,fully_depreciated>disposed}');
select app.define_flow('pos_session', '{open}', '{open>closing,closing>open,closing>closed}');
select app.define_flow('pos_order', '{draft,paid}', '{draft>paid,draft>cancelled}');
select app.define_flow('z_report', '{final}', '{}');
select app.define_flow('shipment', '{draft}',
  '{draft>scheduled,draft>cancelled,scheduled>in_transit,scheduled>cancelled,in_transit>delivered,in_transit>failed,failed>scheduled,failed>cancelled}');
select app.define_flow('delivery_route', '{planned}', '{planned>in_progress,planned>cancelled,in_progress>completed}');
select app.define_flow('leave_request', '{draft,submitted}',
  '{draft>submitted,draft>cancelled,submitted>approved,submitted>rejected,submitted>cancelled,approved>cancelled,rejected>draft}');
select app.define_flow('payroll_run', '{draft}',
  '{draft>calculated,draft>cancelled,calculated>draft,calculated>approved,approved>draft,approved>posted,posted>paid}');
select app.define_flow('vat_declaration', '{draft}',
  '{draft>submitted,submitted>accepted,submitted>rejected,rejected>draft}');
