-- =============================================================================
-- DrisPRO · counting: "this item is also somewhere else" (9.11.2026)
--   When a counter records an item, they are told the other places of the same unit where the item is kept
--   (it has stock there) or where someone in the same counting has found it, and whether each place has been
--   counted already and by whom. The quantity the program expects is never shown: only that the place exists.
-- =============================================================================
create or replace function public.count_item_elsewhere(p_count uuid, p_variant uuid, p_location uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.cycle_counts;
begin
  select * into c from public.cycle_counts where id = p_count and deleted_at is null;
  if c.id is null then raise exception 'Count not found' using errcode = 'P0002'; end if;
  perform app.require_any_permission(c.company_id, array['wms.write', 'inventory.write']);
  return coalesce((select jsonb_agg(jsonb_build_object('location_id', q.id, 'code', q.code, 'name', q.name,
                                                       'counted', q.counted_qty is not null, 'counted_qty', q.counted_qty, 'by', q.who)
                                    order by q.counted_qty is not null, q.code)
    from (
      select wl.id, wl.code, wl.name,
             (select sum(l.counted_qty)
                from public.cycle_count_lines l join public.cycle_counts oc on oc.id = l.cycle_count_id
               where l.variant_id = p_variant and l.location_id = wl.id and l.counted_qty is not null
                 and oc.deleted_at is null and oc.status <> 'cancelled'
                 and (oc.id = c.id or (c.session_id is not null and oc.session_id = c.session_id))) as counted_qty,
             (select string_agg(distinct p.full_name, ', ')
                from public.cycle_count_lines l join public.cycle_counts oc on oc.id = l.cycle_count_id
                join public.profiles p on p.id = coalesce(oc.assigned_to, l.counted_by)
               where l.variant_id = p_variant and l.location_id = wl.id and l.counted_qty is not null
                 and oc.deleted_at is null and oc.status <> 'cancelled'
                 and (oc.id = c.id or (c.session_id is not null and oc.session_id = c.session_id))) as who
        from public.warehouse_locations wl
       where wl.company_id = c.company_id and wl.warehouse_id = c.warehouse_id and wl.location_type = 'internal'
         and wl.deleted_at is null and wl.is_active and wl.id is distinct from p_location
         and (exists (select 1 from public.stock_levels sl
                       where sl.company_id = c.company_id and sl.variant_id = p_variant and sl.location_id = wl.id and sl.on_hand > 0)
              or exists (select 1 from public.cycle_count_lines l join public.cycle_counts oc on oc.id = l.cycle_count_id
                          where l.variant_id = p_variant and l.location_id = wl.id and l.counted_qty is not null
                            and oc.deleted_at is null and oc.status <> 'cancelled'
                            and (oc.id = c.id or (c.session_id is not null and oc.session_id = c.session_id))))
       limit 20) q), '[]'::jsonb);
end $$;
revoke execute on function public.count_item_elsewhere(uuid, uuid, uuid) from public, anon;
grant execute on function public.count_item_elsewhere(uuid, uuid, uuid) to authenticated;
