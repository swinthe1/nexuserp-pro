-- =============================================================================
-- DrisPRO · search that forgives, on the server too
-- "qumesht fresket 1l" finds "Qumësht i freskët 2,8% 1 L", "kokakola" finds "Coca-Cola 0,5 L",
-- "detergjent enesh" finds "Detergjent enësh 1 L". The same rules as src/lib/fuzzy.ts (the till and
-- the pickers search on the device): ë/e and ç/c do not matter, the words may come in any order and
-- each may be the start of a word, a word of four letters or more may have a typo or be written the way
-- it sounds, numbers match only as numbers, a code or barcode typed whole wins over everything.
-- Used by the agent's item search and by the search box (Ctrl K).
-- =============================================================================

-- typos are counted as letters changed
create extension if not exists fuzzystrmatch with schema extensions;

-- the searchable form of a text: lower case, no accents, "1l" is "1 l", "2,8" is "2.8", punctuation a space
create or replace function app.search_norm(p text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
           translate(lower(coalesce(p, '')), 'ëçéèêäöüáàâíìóòúùñ', 'eceeeaouaaaiioouun'),
           '(\d),(\d)', '\1.\2', 'g'),
           '(\d)([a-z])', '\1 \2', 'g'), '([a-z])(\d)', '\1 \2', 'g'),
           '[^a-z0-9.]+', ' ', 'g'),
           '(^|\s)\.+|\.+(\s|$)', ' ', 'g'))
$$;

-- how a word sounds, for typing it the way it is said
create or replace function app.search_sound(w text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select regexp_replace(
           replace(replace(replace(regexp_replace(
             replace(replace(replace(replace(replace(replace(replace(w, 'sh', 's'), 'zh', 'z'), 'dh', 'd'), 'th', 't'), 'gj', 'g'), 'nj', 'n'), 'xh', 'x'),
             'ck|q|c', 'k', 'g'), 'x', 'ks'), 'y', 'i'), 'w', 'v'),
           '(.)\1+', '\1', 'g')
$$;

-- how well a question fits a text: 0 = it does not (a word of the question found nowhere);
-- 1000 = the question is one of the codes, typed whole
create or replace function app.fuzzy_score(p_text text, p_query text, p_codes text[] default '{}') returns integer
language plpgsql immutable parallel safe set search_path = '' as $$
declare
  v_raw text := lower(btrim(coalesce(p_query, '')));
  v_q text[] := array_remove(string_to_array(app.search_norm(p_query), ' '), '');
  v_t text[] := array_remove(string_to_array(app.search_norm(p_text) || ' ' || app.search_norm(array_to_string(p_codes, ' ')), ' '), '');
  v_words text[] := array_remove(string_to_array(app.search_norm(p_text), ' '), '');
  v_total int := 0; v_best int; s int;
  w text; ws text; t text; ts text; num boolean; i int;
begin
  if v_raw = '' then return 1; end if;
  if v_raw = any (select lower(btrim(c)) from unnest(p_codes) c where c is not null) then return 1000; end if;
  foreach w in array v_q loop
    ws := app.search_sound(w);
    num := w ~ '^\d+(\.\d+)?$';
    v_best := 0;
    foreach t in array v_t loop
      s := 0;
      if t = w then s := 10;
      elsif left(t, length(w)) = w then s := case when length(w) >= 2 or num then 8 else 6 end;
      elsif num then s := case when length(w) >= 2 and strpos(t, w) > 0 then 5 else 0 end;
      elsif length(w) >= 3 and strpos(t, w) > 0 then s := 5;
      elsif length(w) >= 3 then
        ts := app.search_sound(t);
        if ts = ws or left(ts, length(ws)) = ws then s := 6;
        -- a typo (one wrong letter, two in a long word), the start of the word kept: the whole word,
        -- or its start as long as what was typed (a word typed half, with a typo)
        elsif length(w) >= 4 and t !~ '^\d' and (left(ts, 1) = left(ws, 1) or substr(ts, 2, 1) = substr(ws, 2, 1))
              and (extensions.levenshtein_less_equal(ws, ts, case when length(w) >= 8 then 2 else 1 end) <= case when length(w) >= 8 then 2 else 1 end
                   or (length(ts) > length(ws) and extensions.levenshtein_less_equal(ws, left(ts, length(ws)), case when length(w) >= 8 then 2 else 1 end) <= case when length(w) >= 8 then 2 else 1 end)
                   or extensions.similarity(ws, ts) >= 0.5) then s := 4;
        end if;
      end if;
      if s > v_best then v_best := s; end if;
      exit when v_best = 10;
    end loop;
    -- two words written as one: "cocacola", "kokakola"
    if v_best < 4 and not num and length(w) >= 6 then
      for i in 1 .. coalesce(array_length(v_words, 1), 0) - 1 loop
        ts := app.search_sound(v_words[i] || v_words[i + 1]);
        if ts = ws or (left(ts, 1) = left(ws, 1) and extensions.levenshtein_less_equal(ws, ts, 2) <= case when length(w) >= 8 then 2 else 1 end) then v_best := 5; exit; end if;
      end loop;
    end if;
    if v_best = 0 then return 0; end if;
    v_total := v_total + v_best;
  end loop;
  return v_total;
end $$;

-- ----------------------------------------------------------------------------- the agent's item search
create or replace function public.ai_find_items(p_company uuid, p_query text, p_limit integer default 8)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'inventory.read');
  return coalesce((select jsonb_agg(x order by sc desc, nm) from (
    select f.sc, v.name as nm, jsonb_build_object(
      'sku', v.sku, 'name', v.name, 'category', c.name, 'href', '/inventory/products/' || p.id,
      'price_with_vat', round(coalesce(v.sales_price_override, p.sales_price) * (1 + coalesce(t.rate, 0) / 100), 2),
      'avg_cost', round(ic.avg_cost, 2),
      'margin_pct', case when coalesce(v.sales_price_override, p.sales_price) > 0 and ic.avg_cost is not null
                         then round(100 * (coalesce(v.sales_price_override, p.sales_price) - ic.avg_cost) / coalesce(v.sales_price_override, p.sales_price), 1) end,
      'stock', coalesce((select jsonb_agg(jsonb_build_object('warehouse', w.warehouse_name, 'on_hand', w.on_hand, 'reserved', w.reserved, 'available', w.available))
                           from (select s.warehouse_name, sum(s.on_hand) as on_hand, sum(s.reserved) as reserved, sum(s.available) as available
                                   from public.v_stock_levels s where s.variant_id = v.id group by s.warehouse_name) w), '[]'::jsonb),
      'incoming', (select sum(l.quantity - l.qty_received) from public.purchase_order_lines l join public.purchase_orders po on po.id = l.purchase_order_id
                    where l.variant_id = v.id and po.status in ('approved', 'sent', 'partially_received') and po.deleted_at is null),
      'vendors', (select jsonb_agg(jsonb_build_object('vendor', bp.name, 'code', vp.vendor_sku, 'price', vp.price, 'preferred', vp.is_preferred))
                    from public.vendor_products vp join public.business_partners bp on bp.id = vp.vendor_id where vp.variant_id = v.id and vp.deleted_at is null),
      'last_price_change', (select jsonb_build_object('on', pc.changed_on, 'from', pc.old_price, 'to', pc.new_price)
                              from public.price_changes pc where pc.variant_id = v.id order by pc.changed_on desc, pc.created_at desc limit 1)) as x
      from public.product_variants v join public.products p on p.id = v.product_id
      left join public.product_categories c on c.id = p.category_id
      left join public.tax_codes t on t.id = p.sales_tax_code_id
      left join public.item_costs ic on ic.variant_id = v.id
      cross join lateral (select app.fuzzy_score(v.name || ' ' || coalesce(c.name, ''), p_query,
                                   array[v.sku] || coalesce((select array_agg(b.barcode) from public.product_barcodes b where b.variant_id = v.id and b.deleted_at is null), '{}')
                                                || coalesce((select array_agg(vp.vendor_sku) from public.vendor_products vp where vp.variant_id = v.id and vp.deleted_at is null and vp.vendor_sku is not null), '{}')) as sc) f
     where v.company_id = p_company and v.deleted_at is null and p.deleted_at is null and f.sc > 0
     order by f.sc desc, v.name limit least(coalesce(p_limit, 8), 20)) q), '[]'::jsonb);
end $$;

revoke execute on function app.search_norm(text), app.search_sound(text), app.fuzzy_score(text, text, text[]) from public;
grant execute on function app.search_norm(text), app.search_sound(text), app.fuzzy_score(text, text, text[]) to authenticated, service_role;

-- ----------------------------------------------------------------------------- the search box (Ctrl K): items and partners forgive too
create or replace function public.global_search(p_company uuid, p_query text, p_limit integer DEFAULT 6)
 RETURNS TABLE(kind text, id uuid, title text, subtitle text, href text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with q as (select '%' || replace(replace(btrim(p_query), '%', '\%'), '_', '\_') || '%' as pat, app.fold('%' || replace(replace(btrim(p_query), '%', '\%'), '_', '\_') || '%') as fpat)
  (select 'product', p.id, v.name, v.sku, '/inventory/products/' || p.id
     from public.product_variants v join public.products p on p.id = v.product_id
     cross join lateral (select app.fuzzy_score(v.name, p_query,
                                  array[v.sku] || coalesce((select array_agg(b.barcode) from public.product_barcodes b where b.variant_id = v.id and b.deleted_at is null), '{}')) as sc) f
    where v.company_id = p_company and v.deleted_at is null and p.deleted_at is null and f.sc > 0
    order by f.sc desc, v.name limit p_limit)
  union all
  (select 'partner', bp.id, bp.name, concat_ws(' · ', bp.code, bp.tax_number), '/partners/' || bp.id
     from public.business_partners bp, q
     cross join lateral (select app.fuzzy_score(bp.name, p_query, array[bp.code, bp.tax_number]) as sc) f
    where bp.company_id = p_company and bp.deleted_at is null
      and (f.sc > 0 or app.fold(bp.name) like q.fpat or app.fold(bp.code) like q.fpat or app.fold(bp.tax_number) like q.fpat or app.fold(bp.email) like q.fpat)
    order by f.sc desc, bp.name limit p_limit)
  union all
  (select 'employee', e.id, e.full_name, concat_ws(' · ', e.number, jp.title, d.name), '/hr/employees/' || e.id
     from public.employees e left join public.job_positions jp on jp.id = e.position_id left join public.departments d on d.id = e.department_id, q
    where e.company_id = p_company and e.deleted_at is null
      and (app.fold(e.full_name) like q.fpat or app.fold(e.number) like q.fpat or app.fold(e.email) like q.fpat or app.fold(e.personal_number) like q.fpat)
    order by e.full_name limit 4)
  union all
  (select 'account', a.id, a.code || ' ' || a.name, 'Account · ' || a.account_type, '/finance/accounts/' || a.id
     from public.accounts a, q
    where a.company_id = p_company and a.deleted_at is null and (a.code ilike btrim(p_query) || '%' or app.fold(a.name) like q.fpat)
    order by a.code limit 4)
  union all
  (select 'opportunity', o.id, o.name, 'Opportunity · ' || o.status, '/crm/pipeline?open=' || o.id
     from public.opportunities o, q
    where o.company_id = p_company and o.deleted_at is null and (app.fold(o.name) like q.fpat or app.fold(o.number) like q.fpat)
    order by o.created_at desc limit 4)
  union all
  (select 'lead', l.id, l.title, concat_ws(' · ', l.company_name, l.contact_name), '/crm/leads?open=' || l.id
     from public.leads l, q
    where l.company_id = p_company and l.deleted_at is null
      and (app.fold(l.title) like q.fpat or app.fold(l.company_name) like q.fpat or app.fold(l.contact_name) like q.fpat or app.fold(l.number) like q.fpat or app.fold(l.email) like q.fpat)
    order by l.created_at desc limit 4)
  union all
  (select 'lot', l.id, l.lot_number, 'Lot · ' || v.sku || coalesce(' · expires ' || to_char(l.expiry_date, 'DD Mon YYYY'), ''), '/wms/lots/' || l.id
     from public.lots l join public.product_variants v on v.id = l.variant_id, q
    where l.company_id = p_company and l.deleted_at is null and app.fold(l.lot_number) like q.fpat
    order by l.expiry_date nulls last limit 4)
  union all
  (select 'bom', b.id, b.code || ' · ' || v.name, 'Bill of materials · v' || b.version, '/manufacturing/boms/' || b.id
     from public.boms b join public.product_variants v on v.id = b.variant_id, q
    where b.company_id = p_company and b.deleted_at is null and (app.fold(b.code) like q.fpat or app.fold(b.name) like q.fpat or app.fold(v.name) like q.fpat or app.fold(v.sku) like q.fpat)
    order by b.code limit 4)
  union all
  (select 'warehouse', w.id, w.name, w.code, '/inventory/warehouses'
     from public.warehouses w, q
    where w.company_id = p_company and w.deleted_at is null and (app.fold(w.name) like q.fpat or app.fold(w.code) like q.fpat)
    limit 3)
  union all
  (select 'vendor_bill', b.id, b.number, 'Vendor bill · ' || b.vendor_invoice_number || ' · ' || b.status, '/procurement/bills/' || b.id
     from public.vendor_bills b, q
    where b.company_id = p_company and b.deleted_at is null and (app.fold(b.number) like q.fpat or app.fold(b.vendor_invoice_number) like q.fpat)
    order by b.bill_date desc limit 4)
  union all
  (select 'shipment', s.id, s.number, 'Shipment · ' || replace(s.status, '_', ' ') || coalesce(' · ' || s.tracking_number, ''), '/logistics/shipments/' || s.id
     from public.shipments s, q
    where s.company_id = p_company and s.deleted_at is null and (app.fold(s.number) like q.fpat or app.fold(s.tracking_number) like q.fpat)
    order by s.created_at desc limit 4)
  union all
  (select 'channel_order', co.id, coalesce(co.external_order_number, co.external_order_id), 'Web order · ' || ch.name || ' · ' || co.import_status,
          coalesce('/sales/orders/' || co.sales_order_id, '/ecommerce?order=' || co.id)
     from public.channel_orders co join public.sales_channels ch on ch.id = co.channel_id, q
    where co.company_id = p_company and (app.fold(co.external_order_number) like q.fpat or app.fold(co.external_order_id) like q.fpat)
    order by co.created_at desc limit 3)
  union all
  (select d.kind, d.id, d.number, d.label, d.href from (
      select 'goods_receipt' as kind, g.id, g.number, 'Goods receipt · ' || g.status as label, '/inventory/receipts/' || g.id as href, g.company_id, g.deleted_at from public.goods_receipts g
      union all select 'stock_adjustment', a.id, a.number, 'Adjustment · ' || a.status, '/inventory/adjustments/' || a.id, a.company_id, a.deleted_at from public.stock_adjustments a
      union all select 'stock_transfer', t.id, t.number, 'Transfer · ' || t.status, '/inventory/transfers/' || t.id, t.company_id, t.deleted_at from public.stock_transfers t
      union all select 'landed_cost', l.id, l.number, 'Landed cost · ' || l.status, '/inventory/landed-costs/' || l.id, l.company_id, l.deleted_at from public.landed_costs l
      union all select 'purchase_requisition', pr.id, pr.number, 'Requisition · ' || pr.status, '/procurement/requisitions/' || pr.id, pr.company_id, pr.deleted_at from public.purchase_requisitions pr
      union all select 'purchase_order', o.id, o.number, 'Purchase order · ' || o.status, '/procurement/orders/' || o.id, o.company_id, o.deleted_at from public.purchase_orders o
      union all select 'sales_quote', sq.id, sq.number, 'Quote · ' || sq.status, '/sales/quotes/' || sq.id, sq.company_id, sq.deleted_at from public.sales_quotes sq
      union all select 'sales_order', s.id, s.number, 'Sales order · ' || s.status, '/sales/orders/' || s.id, s.company_id, s.deleted_at from public.sales_orders s
      union all select 'delivery', dl.id, dl.number, 'Delivery · ' || dl.status, '/sales/deliveries/' || dl.id, dl.company_id, dl.deleted_at from public.deliveries dl
      union all select 'sales_invoice', i.id, i.number, case when i.document_type = 'credit_note' then 'Credit note · ' else 'Invoice · ' end || i.status, '/sales/invoices/' || i.id, i.company_id, i.deleted_at from public.sales_invoices i
      union all select 'payment', pm.id, pm.number, case when pm.document_type = 'customer_payment' then 'Receipt · ' else 'Payment · ' end || pm.status, '/finance/payments/' || pm.id, pm.company_id, pm.deleted_at from public.payments pm
      union all select 'journal_entry', je.id, je.number, 'Journal entry · ' || coalesce(je.memo, je.status), '/finance/journal/' || je.id, je.company_id, je.deleted_at from public.journal_entries je
      union all select 'fixed_asset', fa.id, fa.number, 'Asset · ' || fa.name, '/finance/assets/' || fa.id, fa.company_id, fa.deleted_at from public.fixed_assets fa
      union all select 'work_order', wo.id, wo.number, 'Work order · ' || replace(wo.status, '_', ' '), '/manufacturing/orders/' || wo.id, wo.company_id, wo.deleted_at from public.work_orders wo
      union all select 'delivery_route', rt.id, rt.number, 'Route · ' || to_char(rt.route_date, 'DD Mon') || ' · ' || replace(rt.status, '_', ' '), '/logistics/routes/' || rt.id, rt.company_id, rt.deleted_at from public.delivery_routes rt
      union all select 'vat_declaration', vd.id, vd.number, 'VAT declaration · ' || to_char(vd.period_start, 'MM/YYYY') || ' · ' || vd.status, '/tax/declarations/' || vd.id, vd.company_id, vd.deleted_at from public.vat_declarations vd
      union all select 'payroll_run', pr2.id, pr2.number, 'Payroll · ' || to_char(pr2.period_start, 'MM/YYYY') || ' · ' || pr2.status, '/hr/payroll/' || pr2.id, pr2.company_id, pr2.deleted_at from public.payroll_runs pr2
      union all select 'leave_request', lr.id, lr.number, 'Leave · ' || lr.status, '/hr/leave?id=' || lr.id, lr.company_id, lr.deleted_at from public.leave_requests lr
    ) d, q
    where d.company_id = p_company and d.deleted_at is null and app.fold(d.number) like q.fpat
    order by d.number desc limit p_limit)
$function$;
