-- =============================================================================
-- DrisPRO · counting together: the double-blind check (9.11.2026)
--   The manager asks a second person to count some shelves again, on a list of their own that nobody else sees
--   and that sees nobody else's. The two counts are compared by their difference to the stock at the second
--   each was made (so sales between the two counts do not matter): when both found the same difference the line
--   is confirmed by two people; when not, it is sent back to be counted again. A check list is only compared,
--   never posted: when the session is confirmed it is closed without touching the stock.
-- =============================================================================
alter table public.cycle_counts add column if not exists check_session uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cycle_counts_check_session_fkey') then
    alter table public.cycle_counts add constraint cycle_counts_check_session_fkey foreign key (company_id, check_session)
      references public.count_sessions(company_id, id) deferrable initially immediate;
  end if;
end $$;
create index if not exists cycle_counts_check_session_idx on public.cycle_counts (check_session) where check_session is not null;
alter table public.cycle_counts drop constraint if exists cycle_counts_scope_check;
alter table public.cycle_counts add constraint cycle_counts_scope_check
  check (scope in ('full', 'location', 'category', 'abc_class', 'random', 'risk', 'session', 'check'));

-- the stock the program had at a given second (the stock now, less what moved after it)
create or replace function app.stock_at(p_company uuid, p_variant uuid, p_location uuid, p_lot uuid, p_at timestamptz)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce((select sl.on_hand from public.stock_levels sl where sl.variant_id = p_variant and sl.location_id = p_location
                     and sl.lot_id is not distinct from p_lot), 0)
       - coalesce((select sum(case when m.to_location_id = p_location then m.quantity else -m.quantity end)
                     from public.stock_movements m
                    where m.company_id = p_company and m.variant_id = p_variant and m.lot_id is not distinct from p_lot
                      and p_location in (m.from_location_id, m.to_location_id) and m.movement_date > p_at), 0)
$$;
revoke execute on function app.stock_at(uuid, uuid, uuid, uuid, timestamptz) from public, anon, authenticated;

-- a second, blind count of some shelves by another person
create or replace function public.count_check_start(p_session uuid, p_locations uuid[], p_person uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare s public.count_sessions; v_id uuid; v_number text; v_codes text;
begin
  select * into s from public.count_sessions where id = p_session and deleted_at is null;
  if s.id is null then raise exception 'Counting session not found' using errcode = 'P0002'; end if;
  perform app.require_permission(s.company_id, 'inventory.write');
  if s.status <> 'open' then raise exception 'This counting session is closed' using errcode = '55000'; end if;
  if coalesce(cardinality(p_locations), 0) = 0 then raise exception 'Choose the shelves to check' using errcode = '22023'; end if;
  if exists (select 1 from unnest(p_locations) x left join public.warehouse_locations wl on wl.id = x
              where wl.id is null or wl.warehouse_id is distinct from s.warehouse_id or wl.location_type <> 'internal') then
    raise exception 'Only shelves of the counted unit can be given' using errcode = '23514';
  end if;
  if p_person is null or not exists (select 1 from public.company_members m where m.company_id = s.company_id and m.user_id = p_person
                                                                              and m.status = 'active' and m.deleted_at is null)
     or not app.has_permission_of(p_person, s.company_id, 'wms.write') then
    raise exception 'This person may not count stock in this company' using errcode = '23514';
  end if;
  if exists (select 1 from public.count_session_shelves sh where sh.session_id = s.id and sh.location_id = any (p_locations) and sh.assigned_to = p_person)
     or exists (select 1 from public.cycle_count_entries e join public.cycle_counts oc on oc.id = e.count_id
                 where oc.session_id = s.id and e.user_id = p_person and e.location_id = any (p_locations)) then
    raise exception 'The check is made by someone who did not count these shelves' using errcode = '23514';
  end if;
  insert into public.cycle_counts (company_id, warehouse_id, scope, scope_filter, blind_count, assigned_to, check_session, notes)
  values (s.company_id, s.warehouse_id, 'check', jsonb_build_object('session', s.id, 'locations', p_locations), true, p_person, s.id,
          'Numërim kontrolli i verbër: krahasohet me numërimin e përbashkët, nuk ndryshon stokun')
  returning id, number into v_id, v_number;
  insert into public.cycle_count_lines (company_id, cycle_count_id, variant_id, location_id, lot_id, system_qty)
  select s.company_id, v_id, sl.variant_id, sl.location_id, sl.lot_id, sl.on_hand
    from public.stock_levels sl where sl.warehouse_id = s.warehouse_id and sl.location_id = any (p_locations) and sl.on_hand <> 0;
  update public.cycle_counts set status = 'in_progress' where id = v_id;
  select string_agg(code, ', ' order by code) into v_codes from public.warehouse_locations where id = any (p_locations);
  perform app.auto_task(s.company_id, 'count_check:' || v_id, 'Numërim kontrolli: ' || left(v_codes, 120) || ' (' || coalesce(v_number, '') || ')',
    p_person, current_date, 2::smallint, 'cycle_counts', v_id, v_number,
    'Numëroni këto rafte vetë, pa pyetur sa gjetën të tjerët. Numërimi juaj krahasohet me të tyrin dhe nuk e ndryshon stokun.');
  return v_id;
end $$;

-- the comparison: each item of the checked shelves, the two counts, and whether they found the same difference
create or replace function public.count_check_compare(p_check uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare k public.cycle_counts; v_locs uuid[];
begin
  select * into k from public.cycle_counts where id = p_check and deleted_at is null and scope = 'check';
  if k.id is null then raise exception 'Count not found' using errcode = 'P0002'; end if;
  perform app.require_permission(k.company_id, 'inventory.write');
  v_locs := array(select jsonb_array_elements_text(k.scope_filter -> 'locations')::uuid);
  return (with
    chk as (select l.variant_id, l.location_id, l.lot_id, l.counted_qty, l.counted_at from public.cycle_count_lines l where l.cycle_count_id = k.id),
    main as (select l.variant_id, l.location_id, l.lot_id, sum(l.counted_qty) as counted_qty, min(l.counted_at) as counted_at,
                    (array_agg(l.id order by l.counted_at))[1] as line_id, (array_agg(oc.id order by l.counted_at))[1] as count_id,
                    (array_agg(oc.status order by l.counted_at))[1] as count_status,
                    string_agg(distinct p.full_name, ', ') as who
               from public.cycle_count_lines l join public.cycle_counts oc on oc.id = l.cycle_count_id
               left join public.profiles p on p.id = coalesce(oc.assigned_to, l.counted_by)
              where oc.session_id = k.check_session and oc.deleted_at is null and oc.status <> 'cancelled'
                and l.location_id = any (v_locs) and l.counted_qty is not null
              group by l.variant_id, l.location_id, l.lot_id),
    keys as (select variant_id, location_id, lot_id from chk union select variant_id, location_id, lot_id from main),
    x as (
      select ky.variant_id, v.sku, v.name, wl.code as location, lt.lot_number as lot,
             m.counted_qty as main_counted, m.who as main_by, m.line_id, m.count_id, m.count_status,
             ch.counted_qty as check_counted,
             case when m.counted_qty is not null then m.counted_qty - app.stock_at(k.company_id, ky.variant_id, ky.location_id, ky.lot_id, m.counted_at) end as main_diff,
             case when ch.counted_qty is not null then ch.counted_qty - app.stock_at(k.company_id, ky.variant_id, ky.location_id, ky.lot_id, ch.counted_at) end as check_diff
        from keys ky
        join public.product_variants v on v.id = ky.variant_id
        join public.warehouse_locations wl on wl.id = ky.location_id
        left join public.lots lt on lt.id = ky.lot_id
        left join chk ch on ch.variant_id = ky.variant_id and ch.location_id = ky.location_id and ch.lot_id is not distinct from ky.lot_id
        left join main m on m.variant_id = ky.variant_id and m.location_id = ky.location_id and m.lot_id is not distinct from ky.lot_id),
    y as (select x.*, case when main_counted is null or check_counted is null then null else main_diff = check_diff end as agree from x)
    select jsonb_build_object(
      'id', k.id, 'number', k.number, 'status', k.status,
      'person', (select full_name from public.profiles where id = k.assigned_to),
      'locations', (select jsonb_agg(code order by code) from public.warehouse_locations where id = any (v_locs)),
      'compared', count(*) filter (where agree is not null),
      'agree', count(*) filter (where agree),
      'differ', count(*) filter (where not agree),
      'only_one', count(*) filter (where agree is null and (main_counted is not null or check_counted is not null)),
      'lines', coalesce(jsonb_agg(jsonb_build_object('sku', sku, 'name', name, 'location', location, 'lot', lot,
                                                     'main_counted', main_counted, 'main_by', main_by, 'main_diff', main_diff,
                                                     'check_counted', check_counted, 'check_diff', check_diff, 'agree', agree,
                                                     'line_id', line_id, 'count_id', count_id, 'count_status', count_status)
                                  order by agree nulls first, location, sku), '[]'::jsonb))
      from y);
end $$;

-- the session's checks, compared
create or replace function public.count_session_checks(p_session uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s public.count_sessions;
begin
  select * into s from public.count_sessions where id = p_session and deleted_at is null;
  if s.id is null then raise exception 'Counting session not found' using errcode = 'P0002'; end if;
  perform app.require_permission(s.company_id, 'inventory.write');
  return coalesce((select jsonb_agg(public.count_check_compare(k.id) - 'lines' order by k.created_at)
                     from public.cycle_counts k where k.check_session = s.id and k.scope = 'check' and k.deleted_at is null), '[]'::jsonb);
end $$;

-- a check list is never posted
do $patch$
declare d text; v_anchor text := '  if c.status <> ''review'' then raise exception ''Submit the count for review first';
begin
  d := pg_get_functiondef('public.post_cycle_count(uuid)'::regprocedure);
  if position('only compared' in d) > 0 then return; end if;
  if position(v_anchor in d) = 0 then raise exception 'post_cycle_count: anchor not found'; end if;
  d := replace(d, v_anchor, '  if c.scope = ''check'' then raise exception ''A check count is only compared with the other count; it does not change the stock'' using errcode = ''55000''; end if;
' || v_anchor);
  execute d;
end $patch$ language plpgsql;

-- confirming the session closes its checks (without touching the stock)
create or replace function public.count_session_post(p_session uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.count_sessions; r record; v_out jsonb := '[]'::jsonb;
begin
  select * into s from public.count_sessions where id = p_session and deleted_at is null;
  if s.id is null then raise exception 'Counting session not found' using errcode = 'P0002'; end if;
  perform app.require_permission(s.company_id, 'inventory.write');
  if s.status <> 'closed' then raise exception 'Close the counting session first' using errcode = '55000'; end if;
  for r in select id from public.cycle_counts where session_id = s.id and status = 'review' and deleted_at is null order by created_at loop
    v_out := v_out || jsonb_build_array(public.post_cycle_count(r.id));
  end loop;
  update public.cycle_counts set status = 'in_progress' where check_session = s.id and scope = 'check' and status = 'review';
  update public.cycle_counts set status = 'cancelled', scope_filter = scope_filter || '{"compared": true}'
   where check_session = s.id and scope = 'check' and status in ('draft', 'in_progress');
  return jsonb_build_object('posted', jsonb_array_length(v_out), 'results', v_out);
end $$;

-- the check's task closes when the check is sent
create or replace function app.tg_count_done_tasks()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('review', 'posted', 'cancelled') and old.status is distinct from new.status then
    update public.tasks set status = 'done', completed_at = now()
     where company_id = new.company_id
       and (auto_key = 'daily_count:' || new.id or auto_key = 'count_check:' || new.id or auto_key like 'recount:' || new.id || ':%')
       and status not in ('done', 'cancelled') and deleted_at is null;
  end if;
  return null;
end $$;

-- the record says how many lines two people found the same
do $patch$
declare d text; v_anchor text := '    ''lines'', v_lines,';
begin
  d := pg_get_functiondef('public.count_record(uuid,uuid)'::regprocedure);
  if position('''checks''' in d) > 0 then return; end if;
  if position(v_anchor in d) = 0 then raise exception 'count_record: anchor not found'; end if;
  d := replace(d, v_anchor, '    ''checks'', case when p_session is not null then coalesce((select jsonb_agg(public.count_check_compare(k.id) - ''lines'' order by k.created_at)
                 from public.cycle_counts k where k.check_session = p_session and k.scope = ''check'' and k.deleted_at is null), ''[]''::jsonb) else ''[]''::jsonb end,
' || v_anchor);
  execute d;
end $patch$ language plpgsql;

revoke execute on function public.count_check_start(uuid, uuid[], uuid), public.count_check_compare(uuid), public.count_session_checks(uuid) from public, anon;
grant execute on function public.count_check_start(uuid, uuid[], uuid), public.count_check_compare(uuid), public.count_session_checks(uuid) to authenticated;
