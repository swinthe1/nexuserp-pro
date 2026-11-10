-- =============================================================================
-- DrisPRO · returns to the supplier in one place (10.11.2026)
--   · vendor_returns_list: every return with its supplier, receipt, value and whether the supplier's
--     credit note came (none / draft / posted) and how many days it has been waiting;
--   · vendor_return_sources: the supplier's purchase receipts that still have goods to send back;
--   · vendor_return_doc: what the return note (fletëkthimi) prints;
--   · every morning, a return still without a posted credit note after 15 days becomes a task.
-- =============================================================================

create or replace function public.vendor_returns_list(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (app.has_permission(p_company, 'inventory.read') or app.has_permission(p_company, 'invoicing.read')) then
    raise exception 'Permission denied' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(x order by x.return_date desc, x.number desc) from (
    select r.id, r.number, r.return_date, r.reason, r.total_cost, r.vendor_id, bp.name as vendor, r.receipt_id, g.number as receipt_number,
           w.name as warehouse, r.vendor_credit_id, cn.number as credit_number,
           case when r.vendor_credit_id is null then 'none' when cn.status = 'posted' then 'posted' else 'draft' end as credit_state,
           case when r.vendor_credit_id is null or cn.status <> 'posted' then current_date - r.return_date end as days_waiting,
           (select count(*) from public.vendor_return_lines l where l.return_id = r.id) as lines
      from public.vendor_returns r
      left join public.business_partners bp on bp.id = r.vendor_id
      left join public.goods_receipts g on g.id = r.receipt_id
      left join public.warehouses w on w.id = r.warehouse_id
      left join public.vendor_bills cn on cn.id = r.vendor_credit_id
     where r.company_id = p_company) x), '[]'::jsonb);
end $$;

create or replace function public.vendor_return_sources(p_company uuid, p_vendor uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.has_permission(p_company, 'inventory.read') then raise exception 'Permission denied' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(x order by x.receipt_date desc, x.number desc) from (
    select g.id, g.number, g.receipt_date, g.vendor_delivery_note, w.name as warehouse, g.total_value,
           (select string_agg(distinct b.number || coalesce(' · ' || b.vendor_invoice_number, ''), ', ')
              from public.vendor_bill_lines bl join public.vendor_bills b on b.id = bl.bill_id and b.deleted_at is null
             where bl.receipt_line_id in (select id from public.goods_receipt_lines where receipt_id = g.id)) as bills,
           (select count(*) from public.goods_receipt_lines l where l.receipt_id = g.id
              and l.quantity > coalesce((select sum(rl.quantity) from public.vendor_return_lines rl where rl.receipt_line_id = l.id), 0)) as lines_left
      from public.goods_receipts g
      left join public.warehouses w on w.id = g.warehouse_id
     where g.company_id = p_company and g.vendor_id = p_vendor and g.receipt_type = 'purchase' and g.status = 'done'
       and g.deleted_at is null and g.receipt_date >= current_date - 400) x where x.lines_left > 0), '[]'::jsonb);
end $$;

create or replace function public.vendor_return_doc(p_return uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.vendor_returns;
begin
  select * into r from public.vendor_returns where id = p_return;
  if r.id is null then raise exception 'Not found' using errcode = 'P0002'; end if;
  if not (app.has_permission(r.company_id, 'inventory.read') or app.has_permission(r.company_id, 'invoicing.read')) then
    raise exception 'Permission denied' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'number', r.number, 'date', r.return_date, 'reason', r.reason, 'total_cost', r.total_cost,
    'company', (select jsonb_build_object('name', coalesce(c.legal_name, c.name), 'tax_number', c.tax_number, 'address', concat_ws(', ', c.address_line1, c.city))
                  from public.companies c where c.id = r.company_id),
    'vendor', (select jsonb_build_object('name', coalesce(bp.legal_name, bp.name), 'tax_number', bp.tax_number) from public.business_partners bp where bp.id = r.vendor_id),
    'warehouse', (select name from public.warehouses where id = r.warehouse_id),
    'receipt', (select number from public.goods_receipts where id = r.receipt_id),
    'delivery_note', (select vendor_delivery_note from public.goods_receipts where id = r.receipt_id),
    'made_by', app.person_name(r.created_by),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('sku', v.sku, 'name', v.name, 'uom', u.code, 'quantity', l.quantity, 'unit_cost', l.unit_cost,
                         'lot', lo.lot_number, 'value', round(l.quantity * l.unit_cost, 2)) order by v.sku)
                         from public.vendor_return_lines l
                         join public.product_variants v on v.id = l.variant_id join public.products p on p.id = v.product_id
                         left join public.units_of_measure u on u.id = p.uom_id
                         left join public.lots lo on lo.id = l.lot_id
                        where l.return_id = r.id), '[]'::jsonb));
end $$;

-- every morning: a return waiting more than 15 days for the supplier's credit note becomes a task
create or replace function app.vendor_returns_daily() returns int language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in
    select v.*, bp.name as vendor from public.vendor_returns v
      left join public.business_partners bp on bp.id = v.vendor_id
      left join public.vendor_bills cn on cn.id = v.vendor_credit_id
     where v.return_date <= current_date - 15 and (v.vendor_credit_id is null or cn.status <> 'posted')
  loop
    perform app.auto_task(r.company_id, 'vendor_return_credit:' || r.id,
      'Kthimi ' || r.number || ' te ' || coalesce(r.vendor, 'furnitori') || ' pret notën e kreditit',
      app.first_with_role(r.company_id, array['purchasing_manager', 'accountant', 'finance_manager', 'company_admin']), current_date, 2::smallint,
      'vendor_returns', r.id, r.number,
      'Malli u kthye më ' || to_char(r.return_date, 'DD.MM.YYYY') || ' dhe nota e kreditit e furnitorit ende nuk është regjistruar. Kërkojeni te furnitori dhe regjistrojeni te Kthimet te furnitori.');
    n := n + 1;
  end loop;
  -- the credit note posted: the task is done
  update public.tasks t set status = 'done', completed_at = now()
    from public.vendor_returns v join public.vendor_bills cn on cn.id = v.vendor_credit_id and cn.status = 'posted'
   where t.auto_key = 'vendor_return_credit:' || v.id and t.company_id = v.company_id and t.status not in ('done', 'cancelled') and t.deleted_at is null;
  return n;
end $$;
revoke all on function app.vendor_returns_daily() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('drispro-vendor-returns', '35 5 * * *', 'select app.vendor_returns_daily()');
  end if;
exception when others then
  raise notice 'pg_cron not available (%); run app.vendor_returns_daily() every morning elsewhere', sqlerrm;
end $$;

revoke execute on function public.vendor_returns_list(uuid), public.vendor_return_sources(uuid, uuid), public.vendor_return_doc(uuid) from public, anon;
grant execute on function public.vendor_returns_list(uuid), public.vendor_return_sources(uuid, uuid), public.vendor_return_doc(uuid) to authenticated;
