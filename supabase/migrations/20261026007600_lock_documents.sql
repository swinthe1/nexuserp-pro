-- =============================================================================
-- DrisPRO · documents that are done cannot be edited from outside their actions
--   (from the review before going live) A posted invoice, a posted payment, an approved payroll…
--   could still be changed with a direct table update by anyone with the module's write right:
--   amount, partner, totals, dates. Now, once a document leaves its editable statuses, the client
--   may change only a few harmless fields (notes, references, delivery details); everything else
--   goes through the document's own actions (post, reverse, cancel, credit note…).
--   Also: accounting months, journal entry statuses and purchase-line quantities are protected.
-- =============================================================================

create or replace function app.tg_lock_done_documents()
returns trigger language plpgsql set search_path = '' as $$
declare v_editable text[] := string_to_array(tg_argv[0], ','); v_allowed text[] := string_to_array(coalesce(tg_argv[1], ''), ',');
  v_keep text[] := array['status', 'updated_at', 'updated_by'];
begin
  if not app.is_client_context() then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    if not (old.status = any (v_editable)) then
      raise exception 'A % document cannot be deleted; cancel or reverse it with its own action', replace(old.status, '_', ' ') using errcode = '42501';
    end if;
    return old;
  end if;
  if old.status = any (v_editable) then return new; end if;
  -- generated columns are not computed yet in a BEFORE trigger: leave them out of the comparison
  v_keep := v_keep || array(select attname::text from pg_catalog.pg_attribute where attrelid = tg_relid and attgenerated <> '' and not attisdropped);
  if (to_jsonb(new) - (v_keep || v_allowed)) is distinct from (to_jsonb(old) - (v_keep || v_allowed)) then
    raise exception 'A % document cannot be changed any more; use its actions (credit note, reverse, cancel)', replace(old.status, '_', ' ')
      using errcode = '42501';
  end if;
  return new;
end $$;

do $$
declare r record;
begin
  for r in select * from (values
    ('sales_quotes',    'draft,sent',                 'notes,terms,valid_until'),
    ('sales_orders',    'draft',                      'notes,requested_date,customer_reference,salesperson_id,shipping_address_id,cancel_reason'),
    ('deliveries',      'draft,waiting,ready,picking', 'notes,carrier_id,carrier_name,tracking_number,package_count,shipping_weight_kg,scheduled_date'),
    ('sales_invoices',  'draft',                      'notes'),
    ('payments',        'draft',                      'notes,reference'),
    ('vendor_bills',    'draft',                      'notes'),
    ('purchase_orders', 'draft,pending_approval',     'notes,expected_date,vendor_reference,buyer_id,cancel_reason,closed_at'),
    ('payroll_runs',    'draft,calculated',           'notes')
  ) t(tbl, editable, allowed) loop
    if to_regclass('public.' || r.tbl) is null then continue; end if;
    execute format('create trigger trg_015_lock_done before update or delete on public.%I for each row execute function app.tg_lock_done_documents(%L, %L)',
                   r.tbl, r.editable, r.allowed);
  end loop;
end $$;

-- accounting months open and close only through their action (which needs finance.approve)
create or replace function app.tg_fiscal_periods_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not app.is_client_context() then return coalesce(new, old); end if;
  if tg_op <> 'UPDATE' or new.status is distinct from old.status or new.start_date is distinct from old.start_date
     or new.end_date is distinct from old.end_date then
    raise exception 'Accounting months are opened and closed in Finance setup' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_03_guard before insert or update or delete on public.fiscal_periods
  for each row execute function app.tg_fiscal_periods_guard();

-- a journal entry is reversed by its action (which books the reversing entry), never by editing its status
create trigger trg_12_system_statuses before insert or update of status on public.journal_entries
  for each row execute function app.tg_system_statuses('reversed');

-- what was received and billed on a purchase order is counted by the receipts and bills themselves
create or replace function app.tg_po_line_counts_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not app.is_client_context() then return new; end if;
  if tg_op = 'INSERT' then
    new.qty_received := 0; new.qty_billed := 0;
  elsif new.qty_received is distinct from old.qty_received or new.qty_billed is distinct from old.qty_billed then
    raise exception 'Received and billed quantities are counted by receipts and bills' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_04_counts before insert or update on public.purchase_order_lines
  for each row execute function app.tg_po_line_counts_guard();

-- one allocation per document in a payment (two rows could together pay more than is open)
create unique index if not exists payment_allocations_invoice_once on public.payment_allocations (payment_id, sales_invoice_id) where sales_invoice_id is not null;
create unique index if not exists payment_allocations_bill_once on public.payment_allocations (payment_id, vendor_bill_id) where vendor_bill_id is not null;
