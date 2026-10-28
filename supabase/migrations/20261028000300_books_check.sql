-- =============================================================================
-- The guard, part 3: what slipped through. Every morning the books are looked
-- over for mistakes that already happened, and the accountant gets a short
-- list, each with the place to fix it:
--   * items below zero (sold before the goods were received)
--   * goods received a week ago without the supplier's invoice
--   * goods delivered to customers without an invoice
--   * business partners on invoices without a NUI; two partners with one NUI
--   * sales of the last week under cost
--   * who waved warnings through this week (to help them, not to blame)
-- Each check gives a count and up to five examples; the app writes the words.
-- =============================================================================

create or replace function app.books_check(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_out jsonb := '[]'; r record;
begin
  -- items below zero
  select count(*) n, coalesce(jsonb_agg(jsonb_build_object('label', label, 'detail', qty, 'href', '/inventory/item-card?v=' || variant_id) order by qty) filter (where rn <= 5), '[]') items
    into r from (
      select sl.variant_id, v.sku || ' · ' || v.name || ' · ' || w.name as label, trim_scale(sum(sl.on_hand)) qty,
             row_number() over (order by sum(sl.on_hand)) rn
        from public.stock_levels sl join public.product_variants v on v.id = sl.variant_id join public.warehouses w on w.id = sl.warehouse_id
       where sl.company_id = p_company group by sl.variant_id, v.sku, v.name, w.name having sum(sl.on_hand) < 0) x;
  if r.n > 0 then v_out := v_out || jsonb_build_object('code', 'negative_stock', 'count', r.n, 'items', r.items, 'href', '/inventory/stock'); end if;

  -- goods in, the invoice not entered
  select count(*) n, coalesce(jsonb_agg(jsonb_build_object('label', number || ' · ' || vendor, 'detail', receipt_date, 'href', '/inventory/receipts/' || id) order by receipt_date) filter (where rn <= 5), '[]') items
    into r from (
      select gr.id, gr.number, gr.receipt_date, p.name vendor, row_number() over (order by gr.receipt_date) rn
        from public.goods_receipts gr join public.business_partners p on p.id = gr.vendor_id
       where gr.company_id = p_company and gr.status = 'done' and gr.receipt_type = 'purchase' and gr.deleted_at is null
         and gr.receipt_date < current_date - 7 and gr.receipt_date >= current_date - 365
         and not exists (select 1 from public.vendor_bills b where b.receipt_id = gr.id and b.deleted_at is null and b.status <> 'cancelled')
         and not exists (select 1 from public.vendor_bill_lines bl join public.goods_receipt_lines gl on gl.id = bl.receipt_line_id
                          join public.vendor_bills b on b.id = bl.bill_id
                          where gl.receipt_id = gr.id and b.deleted_at is null and b.status <> 'cancelled')) x;
  if r.n > 0 then v_out := v_out || jsonb_build_object('code', 'receipts_no_bill', 'count', r.n, 'items', r.items, 'href', '/inventory/receipts'); end if;

  -- goods out to customers, not invoiced
  select count(*) n, coalesce(jsonb_agg(jsonb_build_object('label', number || ' · ' || customer, 'detail', done_on, 'href', '/sales/deliveries/' || id) order by done_on) filter (where rn <= 5), '[]') items
    into r from (
      select d.id, d.number, (d.done_at)::date done_on, p.name customer, row_number() over (order by d.done_at) rn
        from public.deliveries d join public.business_partners p on p.id = d.partner_id
        left join public.sales_orders so on so.id = d.sales_order_id
       where d.company_id = p_company and d.status = 'done' and d.delivery_type = 'outbound' and d.deleted_at is null
         and d.done_at < now() - interval '3 days' and d.done_at >= now() - interval '365 days'
         and coalesce(so.invoice_status, 'not_invoiced') <> 'invoiced'
         and not exists (select 1 from public.sales_invoice_lines il join public.delivery_lines dl on dl.id = il.delivery_line_id
                          join public.sales_invoices i on i.id = il.invoice_id
                          where dl.delivery_id = d.id and i.deleted_at is null and i.status <> 'cancelled')) x;
  if r.n > 0 then v_out := v_out || jsonb_build_object('code', 'deliveries_no_invoice', 'count', r.n, 'items', r.items, 'href', '/sales/deliveries'); end if;

  -- businesses on this year's invoices without a NUI
  select count(*) n, coalesce(jsonb_agg(jsonb_build_object('label', name, 'href', '/partners/' || id) order by name) filter (where rn <= 5), '[]') items
    into r from (
      select p.id, p.name, row_number() over (order by p.name) rn from public.business_partners p
       where p.company_id = p_company and p.deleted_at is null and p.is_active and p.kind = 'company' and coalesce(btrim(p.tax_number), '') = ''
         and (exists (select 1 from public.sales_invoices i where i.partner_id = p.id and i.status = 'posted' and i.invoice_date >= date_trunc('year', current_date))
           or exists (select 1 from public.vendor_bills b where b.vendor_id = p.id and b.status = 'posted' and b.bill_date >= date_trunc('year', current_date)))) x;
  if r.n > 0 then v_out := v_out || jsonb_build_object('code', 'partners_no_nui', 'count', r.n, 'items', r.items, 'href', '/partners'); end if;

  -- one NUI, two partners (entered twice)
  select count(*) n, coalesce(jsonb_agg(jsonb_build_object('label', names, 'detail', nui, 'href', '/partners/' || first_id) order by nui) filter (where rn <= 5), '[]') items
    into r from (
      select p.tax_number nui, string_agg(p.name, ' · ' order by p.created_at) names, (array_agg(p.id order by p.created_at))[1] first_id,
             row_number() over (order by p.tax_number) rn
        from public.business_partners p
       where p.company_id = p_company and p.deleted_at is null and p.is_active and coalesce(btrim(p.tax_number), '') <> ''
       group by p.tax_number having count(*) > 1) x;
  if r.n > 0 then v_out := v_out || jsonb_build_object('code', 'duplicate_nui', 'count', r.n, 'items', r.items, 'href', '/partners'); end if;

  -- sold under cost in the last 7 days
  select count(*) n, coalesce(jsonb_agg(jsonb_build_object('label', number || ' · ' || item, 'detail', price, 'href', '/sales/invoices/' || invoice_id) order by invoice_date desc) filter (where rn <= 5), '[]') items
    into r from (
      select i.id invoice_id, i.number, i.invoice_date, v.sku || ' · ' || v.name item, round(il.unit_price * (1 - coalesce(il.discount_pct, 0) / 100), 2) price,
             row_number() over (order by i.invoice_date desc, i.number) rn
        from public.sales_invoice_lines il join public.sales_invoices i on i.id = il.invoice_id
        join public.product_variants v on v.id = il.variant_id
        join public.item_costs ic on ic.company_id = i.company_id and ic.variant_id = il.variant_id
       where i.company_id = p_company and i.status = 'posted' and i.deleted_at is null and i.document_type = 'invoice'
         and i.invoice_date >= current_date - 7 and ic.avg_cost > 0
         and il.unit_price * (1 - coalesce(il.discount_pct, 0) / 100) < ic.avg_cost) x;
  if r.n > 0 then v_out := v_out || jsonb_build_object('code', 'below_cost', 'count', r.n, 'items', r.items, 'href', '/reports/margin'); end if;

  -- warnings waved through this week, by person
  select count(*) n, coalesce(jsonb_agg(jsonb_build_object('label', who, 'detail', k) order by k desc) filter (where rn <= 5), '[]') items
    into r from (
      select coalesce(pr.full_name, '—') who, count(*) k, row_number() over (order by count(*) desc) rn
        from app.guard_events g left join public.profiles pr on pr.id = g.user_id
       where g.company_id = p_company and g.created_at >= now() - interval '7 days'
       group by pr.full_name) x;
  if r.n > 0 then v_out := v_out || jsonb_build_object('code', 'guard_waved', 'count', (select count(*) from app.guard_events
                                                          where company_id = p_company and created_at >= now() - interval '7 days'),
                                                        'items', r.items); end if;
  return v_out;
end $$;
revoke execute on function app.books_check(uuid) from public, anon, authenticated;

create or replace function public.books_check(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'invoicing.read');
  return app.books_check(p_company);
end $$;
revoke execute on function public.books_check(uuid) from public, anon;
grant execute on function public.books_check(uuid) to authenticated;

-- every morning: one notice when something waits (the daily reminders already run on a schedule)
create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_new in v_def) > 0 then return; end if;
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;

do $$ begin
  perform app._patch_function('public.run_daily_reminders',
    'declare c record; o record; v_n int := 0; k record; l record;',
    'declare c record; o record; v_n int := 0; k record; l record; v_check int;');
  perform app._patch_function('public.run_daily_reminders',
    E'  end loop;\n  return v_n;\nend',
    E'    -- what slipped through in the books\n    select coalesce(sum((x ->> ''count'')::int), 0) into v_check from jsonb_array_elements(app.books_check(c.id)) x where x ->> ''code'' <> ''guard_waved'';\n    if v_check > 0 then\n      v_n := v_n + app.remind(c.id, array[''accountant'', ''finance_manager'', ''company_admin''], v_check || '' things to check in the books'',\n                              null, ''/check'', null, null);\n    end if;\n  end loop;\n  return v_n;\nend');
end $$;

drop function app._patch_function(text, text, text);
