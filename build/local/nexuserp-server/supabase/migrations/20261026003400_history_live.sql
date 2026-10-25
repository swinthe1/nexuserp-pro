-- =============================================================================
-- NexusERP Pro · today's and this month's sales from the old program, for the dashboard
-- (the live link keeps history_documents current every few seconds)
-- =============================================================================

create index if not exists history_documents_wh_date_idx on public.history_documents (company_id, doc_date, warehouse_id);

create or replace function public.history_live(p_company uuid, p_today date default current_date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_month date := date_trunc('month', p_today)::date;
begin
  perform app.require_permission(p_company, 'sales.read');
  if not exists (select 1 from public.history_documents where company_id = p_company) then
    return jsonb_build_object('has_history', false);
  end if;
  return (
    with d as (
      select h.id, h.kind, h.doc_date, h.total, h.net, h.warehouse_id, h.warehouse_code
        from public.history_documents h
       where h.company_id = p_company and h.doc_date between v_month and p_today
         and h.kind in ('sale', 'pos_sale', 'sale_return', 'purchase', 'purchase_return')),
    s as (
      select d.*, case when d.kind = 'sale_return' then -abs(d.total) else d.total end as signed,
             case when d.kind = 'sale_return' then -abs(coalesce(d.net, d.total)) else coalesce(d.net, d.total) end as signed_net
        from d where d.kind in ('sale', 'pos_sale', 'sale_return')),
    c as (
      select sum(case when s.kind = 'sale_return' then -abs(l.quantity) else l.quantity end * l.unit_cost) as cost
        from s join public.history_document_lines l on l.document_id = s.id
       where l.unit_cost is not null)
    select jsonb_build_object(
      'has_history', true,
      'last_date', (select max(doc_date) from public.history_documents where company_id = p_company and kind in ('sale', 'pos_sale')),
      'today', coalesce((select sum(signed) from s where doc_date = p_today), 0),
      'today_receipts', (select count(*) from s where doc_date = p_today and kind <> 'sale_return'),
      'month', coalesce((select sum(signed) from s), 0),
      'month_net', coalesce((select sum(signed_net) from s), 0),
      'month_receipts', (select count(*) from s where kind <> 'sale_return'),
      'month_cost', (select cost from c),
      'month_purchases', coalesce((select sum(case when kind = 'purchase_return' then -abs(total) else total end) from d where kind in ('purchase', 'purchase_return')), 0),
      'by_store', coalesce((select jsonb_agg(x order by x.month desc) from (
          select coalesce(w.name, s.warehouse_code, '—') as store, s.warehouse_id,
                 sum(s.signed) filter (where s.doc_date = p_today) as today,
                 count(*) filter (where s.doc_date = p_today and s.kind <> 'sale_return') as today_receipts,
                 sum(s.signed) as month
            from s left join public.warehouses w on w.id = s.warehouse_id
           group by 1, 2) x), '[]'::jsonb)));
end $$;
revoke execute on function public.history_live(uuid, date) from public;
grant execute on function public.history_live(uuid, date) to authenticated;
