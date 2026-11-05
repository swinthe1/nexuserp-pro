-- =============================================================================
-- From the meeting with the administrative staff, #30: a signature is used only on the documents
-- it is for (e.g. the finance director's on invoices and payments). Empty: every document.
-- =============================================================================

alter table public.company_signatures add column if not exists doc_kinds text[] not null default '{}';

-- the administrators set which documents a signature is for
create or replace function public.signature_set_kinds(p_id uuid, p_kinds text[])
returns void language plpgsql security definer set search_path = '' as $$
declare v_co uuid;
begin
  select company_id into v_co from public.company_signatures where id = p_id and deleted_at is null;
  if v_co is null then raise exception 'Signature not found' using errcode = 'P0002'; end if;
  perform app.require_permission(v_co, 'admin.write');
  if exists (select 1 from unnest(coalesce(p_kinds, '{}')) k where app.print_table(k) is null) then
    raise exception 'Unknown document kind' using errcode = '22023';
  end if;
  update public.company_signatures set doc_kinds = coalesce(p_kinds, '{}'), updated_at = now() where id = p_id;
  insert into public.audit_log (company_id, table_name, record_id, action, new_data, actor_id)
  values (v_co, 'company_signatures', p_id, 'UPDATE', jsonb_build_object('doc_kinds', p_kinds), auth.uid());
end $$;
revoke all on function public.signature_set_kinds(uuid, text[]) from public, anon;
grant execute on function public.signature_set_kinds(uuid, text[]) to authenticated;

-- the choice when sending: each signature says which documents it is for
create or replace function public.my_signatures(p_company uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.person_name, 'title', s.person_title, 'is_default', s.is_default, 'kinds', to_jsonb(s.doc_kinds))
                            order by s.is_default desc, s.person_name), '[]')
    from public.company_signatures s
   where s.company_id = p_company and s.deleted_at is null and p_company = any (app.my_company_ids())
     and (auth.uid() = any (s.user_ids) or app.has_permission(p_company, 'admin.write'))
$$;

-- signing checks the kind too (also for the administrators: a signature belongs on its documents)
create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_def text; v_oid oid;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname || '.' || p.proname = p_name order by p.oid desc limit 1;
  if v_oid is null then raise exception 'function % not found', p_name; end if;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply', p_name; end if;
  execute replace(v_def, p_old, p_new);
end $$;
select app._patch_function('public.document_sign',
  $x$  insert into public.entity_activities (company_id, entity_type, entity_id, activity_type, title, metadata)$x$,
  $x$  if cardinality(s.doc_kinds) > 0 and not (p_kind = any (s.doc_kinds)) then
    raise exception 'The signature of % is not for this kind of document', s.person_name using errcode = '42501';
  end if;
  insert into public.entity_activities (company_id, entity_type, entity_id, activity_type, title, metadata)$x$);
drop function app._patch_function(text, text, text);

-- =============================================================================
-- #16: the supplier's documents filtered by the group and sub-group of their items
-- =============================================================================
-- for each document: the groups (top categories) and the sub-groups of its items
create or replace function public.doc_item_groups(p_company uuid, p_doc text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
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
  select coalesce(jsonb_object_agg(doc_id, jsonb_build_object('groups', groups, 'subs', subs)), '{}'::jsonb) into v_rows
    from (select doc_id, jsonb_agg(distinct grp) as groups, coalesce(jsonb_agg(distinct sub) filter (where sub is not null), '[]'::jsonb) as subs from g group by doc_id) x;
  if p_doc not in ('vendor_bills', 'purchase_orders', 'goods_receipts') then raise exception 'Unknown document kind %', p_doc using errcode = '22023'; end if;
  return v_rows;
end $$;
revoke all on function public.doc_item_groups(uuid, text) from public, anon;
grant execute on function public.doc_item_groups(uuid, text) to authenticated;
