-- =============================================================================
-- DrisPRO · the category of the items on a purchase document shown in one column: "Pije - Alkolike" (10.11.2026)
--   · doc_item_groups also gives the pairs (main category, sub-category) of each document
-- =============================================================================

CREATE OR REPLACE FUNCTION public.doc_item_groups(p_company uuid, p_doc text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_rows jsonb;
begin
  if not (app.has_permission(p_company, 'procurement.read') or app.has_permission(p_company, 'invoicing.read') or app.has_permission(p_company, 'inventory.read')) then
    raise exception 'Permission denied' using errcode = '42501';
  end if;
  with l as (
    select bl.bill_id as doc_id, bl.variant_id from public.vendor_bill_lines bl where p_doc = 'vendor_bills' and bl.company_id = p_company
    union all select pl.purchase_order_id, pl.variant_id from public.purchase_order_lines pl where p_doc = 'purchase_orders' and pl.company_id = p_company
    union all select gl.receipt_id, gl.variant_id from public.goods_receipt_lines gl where p_doc = 'goods_receipts' and gl.company_id = p_company),
  g as (
    select l.doc_id, coalesce(pc.name, c.name) as grp, case when pc.id is not null then c.name end as sub
      from l join public.product_variants v on v.id = l.variant_id join public.products p on p.id = v.product_id
      join public.product_categories c on c.id = p.category_id left join public.product_categories pc on pc.id = c.parent_id)
  select coalesce(jsonb_object_agg(doc_id, jsonb_build_object('groups', groups, 'subs', subs, 'pairs', pairs)), '{}'::jsonb) into v_rows
    from (select doc_id, jsonb_agg(distinct grp) as groups, coalesce(jsonb_agg(distinct sub) filter (where sub is not null), '[]'::jsonb) as subs,
                 jsonb_agg(distinct jsonb_build_array(grp, sub)) as pairs from g group by doc_id) x;
  if p_doc not in ('vendor_bills', 'purchase_orders', 'goods_receipts') then raise exception 'Unknown document kind %', p_doc using errcode = '22023'; end if;
  return v_rows;
end $function$;
