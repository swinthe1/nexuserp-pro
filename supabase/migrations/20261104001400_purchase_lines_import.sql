-- =============================================================================
-- DrisPRO · the lines of a purchase invoice from the supplier's file
-- The supplier sends an Excel (or the lines are copied from one): barcode, code, name, quantity, price.
-- DrisPRO finds our item for each line the way the invoice reader does (what was linked last time for
-- this supplier, the supplier's code, the barcode, our code, the name — now with the forgiving search),
-- remembers what the person links by hand, and makes a new item for a line that has none.
-- =============================================================================

-- ----------------------------------------------------------------------------- the forgiving search, fast
-- Scoring every item of a big shop for every keystroke is slow (about 0.1 ms an item), so the search
-- first takes the few items that can fit — by their letters in threes, from an index — and scores only
-- those. The longest word of the question decides which those are: written in the name, close to a
-- word of it (a typo), or close to how a word of it sounds. A question of numbers only looks in the
-- names as they are written; a code, barcode or supplier code typed whole always comes.
-- (The indexes hold app.search_norm and app.search_sounds as they are now: a change to them needs a reindex.)
create or replace function app.search_sounds(p text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select coalesce(string_agg(app.search_sound(w), ' '), '') from unnest(string_to_array(app.search_norm(p), ' ')) w where w <> ''
$$;
-- the longest word of a question that is not a number: what the index looks for
create or replace function app.fuzzy_key(p text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select coalesce((select w from unnest(string_to_array(app.search_norm(p), ' ')) w where length(w) >= 3 and w !~ '^[0-9.]+$' order by length(w) desc, w limit 1), '')
$$;
alter function app.fuzzy_score(text, text, text[]) cost 1000;
revoke execute on function app.search_sounds(text), app.fuzzy_key(text) from public;
grant execute on function app.search_sounds(text), app.fuzzy_key(text) to authenticated, service_role;

create index if not exists product_variants_search_norm_trgm on public.product_variants using gin (app.search_norm(name) extensions.gin_trgm_ops);
create index if not exists product_variants_search_sounds_trgm on public.product_variants using gin (app.search_sounds(name) extensions.gin_trgm_ops);
create index if not exists business_partners_search_norm_trgm on public.business_partners using gin (app.search_norm(name) extensions.gin_trgm_ops);
create index if not exists business_partners_search_sounds_trgm on public.business_partners using gin (app.search_sounds(name) extensions.gin_trgm_ops);

-- the items of a company that fit a question, with how well (the name and the category; the codes)
-- runs as the person: they see only what they may see
create or replace function app.fuzzy_variants(p_company uuid, p_query text)
returns table (variant_id uuid, score integer)
language plpgsql stable set search_path = '' set pg_trgm.word_similarity_threshold = 0.4 as $$
declare v_raw text := btrim(coalesce(p_query, '')); v_key text := app.fuzzy_key(p_query); v_snd text; v_norm text := app.search_norm(p_query);
begin
  if v_raw = '' then return; end if;
  v_snd := app.search_sound(v_key);
  return query
  with c as materialized (
    select v.id from public.product_variants v where v.company_id = p_company and v.deleted_at is null and upper(v.sku) = upper(v_raw)
    union select b.variant_id from public.product_barcodes b where b.company_id = p_company and b.deleted_at is null and b.barcode = v_raw
    union select vp.variant_id from public.vendor_products vp where vp.company_id = p_company and vp.deleted_at is null and upper(vp.vendor_sku) = upper(v_raw)
    union select v.id from public.product_variants v where v_key <> '' and v.company_id = p_company and v.deleted_at is null
      and (app.search_norm(v.name) like '%' || v_key || '%' or v_key operator(extensions.<%) app.search_norm(v.name) or v_snd operator(extensions.<%) app.search_sounds(v.name))
    union select v.id from public.product_variants v join public.products p on p.id = v.product_id join public.product_categories cat on cat.id = p.category_id
     where v_key <> '' and v.company_id = p_company and v.deleted_at is null and app.search_norm(cat.name) like '%' || v_key || '%'
    union select v.id from public.product_variants v where v_key = '' and v.company_id = p_company and v.deleted_at is null
      and translate(lower(v.name), ',', '.') like '%' || v_norm || '%')
  select x.id, x.sc from (
    select v.id, app.fuzzy_score(v.name || ' ' || coalesce(cat.name, ''), p_query,
             array[v.sku] || coalesce((select array_agg(b.barcode) from public.product_barcodes b where b.variant_id = v.id and b.deleted_at is null), '{}')
                          || coalesce((select array_agg(vp.vendor_sku) from public.vendor_products vp where vp.variant_id = v.id and vp.deleted_at is null and vp.vendor_sku is not null), '{}')) as sc
      from c join public.product_variants v on v.id = c.id join public.products p on p.id = v.product_id
      left join public.product_categories cat on cat.id = p.category_id
     where p.deleted_at is null offset 0) x
   where x.sc > 0;
end $$;
revoke execute on function app.fuzzy_variants(uuid, text) from public;
grant execute on function app.fuzzy_variants(uuid, text) to authenticated, service_role;

create or replace function app.fuzzy_partners(p_company uuid, p_query text)
returns table (partner_id uuid, score integer)
language plpgsql stable set search_path = '' set pg_trgm.word_similarity_threshold = 0.4 as $$
declare v_raw text := btrim(coalesce(p_query, '')); v_key text := app.fuzzy_key(p_query); v_snd text;
begin
  if v_key = '' then return; end if;
  v_snd := app.search_sound(v_key);
  return query
  select x.id, x.sc from (
    select bp.id, app.fuzzy_score(bp.name, p_query, array[bp.code, bp.tax_number]) as sc
      from public.business_partners bp
     where bp.company_id = p_company and bp.deleted_at is null
       and (app.search_norm(bp.name) like '%' || v_key || '%' or v_key operator(extensions.<%) app.search_norm(bp.name) or v_snd operator(extensions.<%) app.search_sounds(bp.name))
    offset 0) x
   where x.sc > 0;
end $$;
revoke execute on function app.fuzzy_partners(uuid, text) from public;
grant execute on function app.fuzzy_partners(uuid, text) to authenticated, service_role;

-- the agent's item search and the search box, over those few
create or replace function public.ai_find_items(p_company uuid, p_query text, p_limit integer default 8)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'inventory.read');
  return coalesce((select jsonb_agg(x order by sc desc, nm) from (
    select f.score as sc, v.name as nm, jsonb_build_object(
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
      join app.fuzzy_variants(p_company, p_query) f on f.variant_id = v.id
     where v.company_id = p_company and v.deleted_at is null and p.deleted_at is null
     order by f.score desc, v.name limit least(coalesce(p_limit, 8), 20)) q), '[]'::jsonb);
end $$;


create or replace function public.global_search(p_company uuid, p_query text, p_limit integer DEFAULT 6)
 RETURNS TABLE(kind text, id uuid, title text, subtitle text, href text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with q as (select '%' || replace(replace(btrim(p_query), '%', '\%'), '_', '\_') || '%' as pat, app.fold('%' || replace(replace(btrim(p_query), '%', '\%'), '_', '\_') || '%') as fpat)
  (select 'product', p.id, v.name, v.sku, '/inventory/products/' || p.id
     from app.fuzzy_variants(p_company, p_query) f join public.product_variants v on v.id = f.variant_id join public.products p on p.id = v.product_id
    where v.company_id = p_company and v.deleted_at is null and p.deleted_at is null
    order by f.score desc, v.name limit p_limit)
  union all
  (select 'partner', bp.id, bp.name, concat_ws(' · ', bp.code, bp.tax_number), '/partners/' || bp.id
     from public.business_partners bp cross join q
     left join app.fuzzy_partners(p_company, p_query) f on f.partner_id = bp.id
    where bp.company_id = p_company and bp.deleted_at is null
      and (f.partner_id is not null or app.fold(bp.name) like q.fpat or app.fold(bp.code) like q.fpat or app.fold(bp.tax_number) like q.fpat or app.fold(bp.email) like q.fpat)
    order by f.score desc nulls last, bp.name limit p_limit)
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

-- the matcher, also for a supplier already chosen on the screen (p.for_vendor), with the forgiving
-- name search and the item's purchase VAT (to take the VAT out of prices written with it)
create or replace function app.doc_read_match(p_company uuid, p jsonb)
returns jsonb language plpgsql stable security definer set search_path = ''
set pg_trgm.similarity_threshold = 0.3 set pg_trgm.word_similarity_threshold = 0.4 as $$
declare v_vendor uuid; v_name text; l jsonb; v_lines jsonb := '[]'::jsonb; v_var uuid; v_how text; v_code text; v_bar text; v_tax text; v_ln text; v_lk text;
begin
  v_vendor := nullif(p ->> 'for_vendor', '')::uuid;
  v_tax := nullif(regexp_replace(coalesce(p ->> 'vendor_tax_number', ''), '[^0-9A-Za-z]', '', 'g'), '');
  if v_vendor is null and v_tax is not null then
    select id into v_vendor from public.business_partners
     where company_id = p_company and deleted_at is null and is_vendor
       and (regexp_replace(coalesce(tax_number, ''), '[^0-9A-Za-z]', '', 'g') = v_tax or regexp_replace(coalesce(vat_number, ''), '[^0-9A-Za-z]', '', 'g') = v_tax) limit 1;
  end if;
  if v_vendor is null and coalesce(p ->> 'vendor_name', '') <> '' then
    select id into v_vendor from public.business_partners
     where company_id = p_company and deleted_at is null and is_vendor and extensions.similarity(lower(name), lower(p ->> 'vendor_name')) >= 0.45
     order by extensions.similarity(lower(name), lower(p ->> 'vendor_name')) desc limit 1;
  end if;
  select name into v_name from public.business_partners where id = v_vendor;

  for l in select * from jsonb_array_elements(coalesce(p -> 'lines', '[]'::jsonb)) loop
    v_var := null; v_how := null;
    v_code := nullif(btrim(l ->> 'code'), ''); v_bar := nullif(regexp_replace(coalesce(l ->> 'barcode', ''), '\D', '', 'g'), '');
    if v_vendor is not null then
      select a.variant_id into v_var from app.read_aliases a join public.product_variants v on v.id = a.variant_id and v.deleted_at is null
       where a.company_id = p_company and a.vendor_id = v_vendor
         and a.key in ('c:' || app.read_key(v_code), 'b:' || app.read_key(v_bar), 'n:' || app.read_key(l ->> 'name')) order by a.key limit 1;
      if v_var is not null then v_how := 'learned'; end if;
    end if;
    if v_var is null and v_vendor is not null and v_code is not null then
      select vp.variant_id into v_var from public.vendor_products vp where vp.company_id = p_company and vp.vendor_id = v_vendor and vp.deleted_at is null
         and upper(vp.vendor_sku) = upper(v_code) limit 1;
      if v_var is not null then v_how := 'vendor_code'; end if;
    end if;
    if v_var is null and coalesce(v_bar, v_code) ~ '^\d{8,14}$' then
      select b.variant_id into v_var from public.product_barcodes b where b.company_id = p_company and b.deleted_at is null and b.barcode = coalesce(v_bar, v_code) limit 1;
      if v_var is not null then v_how := 'barcode'; end if;
    end if;
    if v_var is null and v_code is not null then
      select v.id into v_var from public.product_variants v where v.company_id = p_company and v.deleted_at is null and upper(v.sku) = upper(v_code) limit 1;
      if v_var is not null then v_how := 'code'; end if;
    end if;
    if v_var is null and coalesce(l ->> 'name', '') <> '' then
      -- the closest name: written alike, or every word of ours found in theirs, or theirs in ours
      v_ln := app.search_norm(l ->> 'name'); v_lk := app.fuzzy_key(l ->> 'name');
      select v.id into v_var from (
          select v.id, v.name from public.product_variants v
           where v.company_id = p_company and v.deleted_at is null and v.is_active
             and (app.search_norm(v.name) operator(extensions.%) v_ln or (v_lk <> '' and v_lk operator(extensions.<%) app.search_norm(v.name)))
          offset 0) v
        cross join lateral (select greatest(extensions.similarity(app.search_norm(v.name), v_ln),
                                            case when app.fuzzy_score(l ->> 'name', v.name) > 0 or app.fuzzy_score(v.name, l ->> 'name') > 0 then 0.6 else 0 end) as s) m
       where m.s >= 0.5
       order by m.s desc, extensions.similarity(app.search_norm(v.name), v_ln) desc limit 1;
      if v_var is not null then v_how := 'name'; end if;
    end if;
    v_lines := v_lines || jsonb_build_array(l || jsonb_build_object('variant_id', v_var, 'matched_by', v_how,
      'variant_name', (select name from public.product_variants where id = v_var), 'variant_sku', (select sku from public.product_variants where id = v_var),
      'item_vat_rate', (select coalesce(pt.rate, st.rate) from public.product_variants v join public.products pr on pr.id = v.product_id
                          left join public.tax_codes pt on pt.id = pr.purchase_tax_code_id left join public.tax_codes st on st.id = pr.sales_tax_code_id where v.id = v_var)));
  end loop;
  return p || jsonb_build_object('vendor_id', v_vendor, 'vendor_match_name', v_name, 'lines', v_lines);
end $$;
revoke execute on function app.doc_read_match(uuid, jsonb) from public, anon, authenticated;

-- ----------------------------------------------------------------------------- finding the items
-- p_lines: [{code, barcode, name}] → the same lines with variant_id, matched_by, variant_name, variant_sku, item_vat_rate
create or replace function public.purchase_lines_match(p_company uuid, p_vendor uuid, p_lines jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'inventory.read');
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) > 2000 then raise exception 'At most 2000 lines at once' using errcode = '22023'; end if;
  return app.doc_read_match(p_company, jsonb_build_object('for_vendor', p_vendor, 'lines', coalesce(p_lines, '[]'::jsonb))) -> 'lines';
end $$;
revoke execute on function public.purchase_lines_match(uuid, uuid, jsonb) from public, anon;
grant execute on function public.purchase_lines_match(uuid, uuid, jsonb) to authenticated;

-- ----------------------------------------------------------------------------- remembering
-- p_lines: [{code, barcode, name, variant_id, price}] — what the lines of this supplier are, for the next time
create or replace function public.purchase_lines_learn(p_company uuid, p_vendor uuid, p_lines jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare l jsonb; n int := 0; v_var uuid; v_cur text;
begin
  perform app.require_permission(p_company, 'invoicing.write');
  if not exists (select 1 from public.business_partners where id = p_vendor and company_id = p_company and deleted_at is null) then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  v_cur := (select coalesce(currency_code, (select base_currency from public.companies where id = p_company)) from public.business_partners where id = p_vendor);
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_var := nullif(l ->> 'variant_id', '')::uuid;
    if v_var is null or not exists (select 1 from public.product_variants where id = v_var and company_id = p_company and deleted_at is null) then continue; end if;
    insert into app.read_aliases (company_id, vendor_id, key, variant_id)
    select p_company, p_vendor, k, v_var
      from unnest(array['c:' || app.read_key(l ->> 'code'), 'b:' || app.read_key(l ->> 'barcode'), 'n:' || app.read_key(l ->> 'name')]) k where length(k) > 3
    on conflict (company_id, vendor_id, key) do update set variant_id = excluded.variant_id, updated_at = now();
    insert into public.vendor_products (company_id, vendor_id, variant_id, vendor_sku, vendor_product_name, price, currency_code)
    values (p_company, p_vendor, v_var, nullif(btrim(l ->> 'code'), ''), left(nullif(l ->> 'name', ''), 200), coalesce(nullif(l ->> 'price', '')::numeric, 0), v_cur)
    on conflict (vendor_id, variant_id) where deleted_at is null
      do update set vendor_sku = coalesce(public.vendor_products.vendor_sku, excluded.vendor_sku),
                    vendor_product_name = coalesce(public.vendor_products.vendor_product_name, excluded.vendor_product_name);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.purchase_lines_learn(uuid, uuid, jsonb) from public, anon;
grant execute on function public.purchase_lines_learn(uuid, uuid, jsonb) to authenticated;

-- ----------------------------------------------------------------------------- a new item from a line
-- p: {name, barcode, code, vat_rate, cost} → {variant_id, sku, name, existed, bad_barcode}. Counted in pieces, VAT by the rate
-- on the line (else the standard rate), a code of its own (the barcode, else A-00001…); the selling
-- price is set on the invoice itself.
create or replace function public.purchase_line_new_item(p_company uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_name text := btrim(coalesce(p ->> 'name', '')); v_bar text := nullif(regexp_replace(coalesce(p ->> 'barcode', ''), '\D', '', 'g'), '');
        v_code text; v_uom uuid; v_tax uuid; v_prod uuid; v_var uuid; n int; v_bad text;
begin
  perform app.require_permission(p_company, 'inventory.write');
  if length(v_name) < 2 then raise exception 'Write the item''s name' using errcode = '23514'; end if;
  if v_bar is not null and (length(v_bar) not between 8 and 14) then v_bar := null; end if;
  -- a barcode that fails its check digit was copied wrong: the item is made without it
  if v_bar is not null and length(v_bar) in (8, 12, 13) and right(v_bar, 1)::int <> app.gtin_check_digit(left(v_bar, length(v_bar) - 1)) then
    v_bad := v_bar; v_bar := null;
  end if;
  if v_bar is not null then
    select b.variant_id into v_var from public.product_barcodes b where b.company_id = p_company and b.barcode = v_bar and b.deleted_at is null limit 1;
    if v_var is not null then
      return (select jsonb_build_object('variant_id', v.id, 'sku', v.sku, 'name', v.name, 'existed', true) from public.product_variants v where v.id = v_var);
    end if;
  end if;
  select id into v_uom from public.units_of_measure where company_id = p_company and code = 'pcs' and deleted_at is null limit 1;
  if v_uom is null then select id into v_uom from public.units_of_measure where company_id = p_company and deleted_at is null order by created_at limit 1; end if;
  select id into v_tax from public.tax_codes
   where company_id = p_company and deleted_at is null and is_active and not is_reverse_charge and scope in ('both', 'purchase', 'sales')
     and rate = coalesce(nullif(p ->> 'vat_rate', '')::numeric, (select max(rate) from public.tax_codes where company_id = p_company and deleted_at is null and is_active and not is_reverse_charge and tax_type = 'vat'))
   order by (scope = 'both') desc, is_exempt, length(code), code limit 1;
  v_code := coalesce(v_bar, nullif(upper(btrim(p ->> 'code')), ''));
  if v_code is null or exists (select 1 from public.product_variants where company_id = p_company and upper(sku) = v_code and deleted_at is null)
     or exists (select 1 from public.products where company_id = p_company and upper(code) = v_code and deleted_at is null) then
    select coalesce(max(substring(sku from '^A-(\d+)$')::int), 0) + 1 into n from public.product_variants where company_id = p_company and sku ~ '^A-\d+$';
    v_code := 'A-' || lpad(n::text, 5, '0');
  end if;
  v_prod := public.create_product(jsonb_build_object('company_id', p_company, 'code', v_code, 'name', left(v_name, 200), 'uom_id', v_uom,
    'sales_tax_code_id', v_tax, 'purchase_tax_code_id', v_tax, 'sales_price', 0, 'standard_cost', nullif(p ->> 'cost', '')::numeric,
    'barcodes', case when v_bar is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('barcode', v_bar, 'symbology', case length(v_bar) when 13 then 'ean13' when 8 then 'ean8' when 12 then 'upca' else 'code128' end)) end));
  return (select jsonb_build_object('variant_id', v.id, 'sku', v.sku, 'name', v.name, 'existed', false, 'bad_barcode', v_bad) from public.product_variants v where v.product_id = v_prod order by v.is_default desc limit 1);
end $$;
revoke execute on function public.purchase_line_new_item(uuid, jsonb) from public, anon;
grant execute on function public.purchase_line_new_item(uuid, jsonb) to authenticated;
