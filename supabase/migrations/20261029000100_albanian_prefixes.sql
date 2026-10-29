-- =============================================================================
-- Document numbers in Albanian for new companies: FAT-2026-00001 for an invoice,
-- not INV-. Companies that already exist keep the numbers they have: their
-- current prefixes are written down for them first, so nothing changes there.
-- =============================================================================

-- 1. every company that exists keeps today's prefix for every document type
insert into public.document_sequences (company_id, doc_type, prefix)
select c.id, dt.key, dt.default_prefix
  from public.companies c cross join public.document_types dt
 where dt.default_prefix is not null
   and not exists (select 1 from public.document_sequences s where s.company_id = c.id and s.doc_type = dt.key)
on conflict (company_id, doc_type) do nothing;

-- 2. the new defaults, for companies made from now on
update public.document_types d set default_prefix = x.p
  from (values
    ('sales_invoice', 'FAT-'), ('credit_note', 'NK-'), ('sales_quote', 'OF-'), ('sales_order', 'PSH-'), ('delivery', 'FD-'),
    ('customer_payment', 'ARK-'), ('vendor_payment', 'PGS-'), ('purchase_order', 'PB-'), ('purchase_requisition', 'KB-'),
    ('vendor_bill', 'FB-'), ('vendor_credit', 'NKF-'), ('goods_receipt', 'PRN-'), ('stock_adjustment', 'RS-'), ('cycle_count', 'INVZ-'),
    ('landed_cost', 'KM-'), ('journal_entry', 'RK-'), ('fixed_asset', 'MTH-'), ('vat_declaration', 'TVSH-'), ('withholding', 'TNB-'),
    ('cit', 'TF-'), ('year_close', 'MBY-'), ('year_carry', 'MBR-'), ('payroll_run', 'LP-'), ('employee', 'PUN-'), ('leave_request', 'LEJ-'),
    ('work_order', 'UP-'), ('pos_order', 'KUP-'), ('pos_session', 'TUR-'), ('shipment', 'DRG-'), ('delivery_route', 'ITN-'),
    ('warehouse_task', 'DET-'), ('hotel_reservation', 'REZ-'), ('lead', 'KON-'), ('opportunity', 'MUN-'),
    ('customer_code', 'K'), ('vendor_code', 'F')
  ) as x(k, p)
 where d.key = x.k;
