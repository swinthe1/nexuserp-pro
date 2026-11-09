-- =============================================================================
-- DrisPRO · counting together: zones and finished shelves (9.11.2026)
--   · the manager gives each person their shelves (a zone); the person gets a task and sees them on the phone;
--   · the counter says "this shelf is done" when every item on it is counted;
--   · the session shows, shelf by shelf, who has it, how many items were counted there and whether it is done;
--   · closing can count as zero only what is missing on finished shelves, so a shelf nobody reached is not
--     emptied by mistake.
-- =============================================================================
create table if not exists public.count_session_shelves (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) deferrable initially immediate,
  session_id  uuid not null,
  location_id uuid not null,
  assigned_to uuid references public.profiles(id) deferrable initially immediate,
  done_at     timestamptz,
  done_by     uuid references public.profiles(id) deferrable initially immediate,
  foreign key (company_id, session_id) references public.count_sessions(company_id, id) on delete cascade deferrable initially immediate,
  foreign key (company_id, location_id) references public.warehouse_locations(company_id, id) deferrable initially immediate
);
select app.register_table('public.count_session_shelves', 'wms', 'inventory', p_soft_delete => false, p_client_write => false);
create unique index if not exists count_session_shelves_one on public.count_session_shelves (session_id, location_id);
create index if not exists count_session_shelves_person on public.count_session_shelves (assigned_to) where assigned_to is not null;

-- the people who may count in the session's unit
create or replace function public.count_session_people(p_session uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s public.count_sessions;
begin
  select * into s from public.count_sessions where id = p_session and deleted_at is null;
  if s.id is null then raise exception 'Counting session not found' using errcode = 'P0002'; end if;
  perform app.require_any_permission(s.company_id, array['wms.read', 'inventory.read']);
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(p.full_name, p.email)) order by coalesce(p.full_name, p.email))
    from public.company_members m join public.profiles p on p.id = m.user_id
   where m.company_id = s.company_id and m.status = 'active' and m.deleted_at is null
     and (m.warehouse_ids is null or cardinality(m.warehouse_ids) = 0 or s.warehouse_id = any (m.warehouse_ids))
     and app.has_permission_of(m.user_id, s.company_id, 'wms.write')), '[]'::jsonb);
end $$;

-- the manager gives shelves to a person (or takes them back with a null person)
create or replace function public.count_session_assign(p_session uuid, p_locations uuid[], p_person uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare s public.count_sessions; v_n int; v_codes text;
begin
  select * into s from public.count_sessions where id = p_session and deleted_at is null for update;
  if s.id is null then raise exception 'Counting session not found' using errcode = 'P0002'; end if;
  perform app.require_permission(s.company_id, 'inventory.write');
  if s.status <> 'open' then raise exception 'This counting session is closed' using errcode = '55000'; end if;
  if p_person is not null and (not exists (select 1 from public.company_members m where m.company_id = s.company_id and m.user_id = p_person
                                                                                   and m.status = 'active' and m.deleted_at is null)
                               or not app.has_permission_of(p_person, s.company_id, 'wms.write')) then
    raise exception 'This person may not count stock in this company' using errcode = '23514';
  end if;
  if exists (select 1 from unnest(coalesce(p_locations, '{}')) x left join public.warehouse_locations wl on wl.id = x
              where wl.id is null or wl.warehouse_id is distinct from s.warehouse_id or wl.location_type <> 'internal') then
    raise exception 'Only shelves of the counted unit can be given' using errcode = '23514';
  end if;
  insert into public.count_session_shelves (company_id, session_id, location_id, assigned_to)
  select s.company_id, s.id, x, p_person from unnest(coalesce(p_locations, '{}')) x
  on conflict (session_id, location_id) do update set assigned_to = excluded.assigned_to;
  get diagnostics v_n = row_count;
  if p_person is not null and v_n > 0 then
    select string_agg(code, ', ' order by code) into v_codes from public.warehouse_locations where id = any (p_locations);
    perform app.auto_task(s.company_id, 'count_zone:' || s.id || ':' || p_person || ':' || floor(extract(epoch from clock_timestamp()))::bigint,
      'Numëro raftet ' || left(v_codes, 120) || ' (' || s.name || ')', p_person, current_date, 2::smallint, 'count_sessions', s.id, s.name,
      'Hapni numërimin e përbashkët, shtypni Numëro dhe numëroni këto rafte. Kur mbaron një raft, shtypni "Rafti mbaroi".');
  end if;
  return v_n;
end $$;

-- the counter: this shelf is done (or not done after all)
create or replace function public.count_shelf_done(p_count uuid, p_location uuid, p_done boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.cycle_counts; s public.count_sessions; wl public.warehouse_locations;
begin
  select * into c from public.cycle_counts where id = p_count and deleted_at is null;
  if c.id is null then raise exception 'Count not found' using errcode = 'P0002'; end if;
  perform app.require_permission(c.company_id, 'wms.write');
  if c.session_id is null then raise exception 'Shelves are marked done only when counting together' using errcode = '55000'; end if;
  select * into s from public.count_sessions where id = c.session_id;
  if s.status <> 'open' then raise exception 'This counting session is closed' using errcode = '55000'; end if;
  select * into wl from public.warehouse_locations where id = p_location;
  if wl.id is null or wl.warehouse_id is distinct from s.warehouse_id or wl.location_type <> 'internal' then
    raise exception 'Only shelves of the counted unit can be given' using errcode = '23514';
  end if;
  insert into public.count_session_shelves (company_id, session_id, location_id, done_at, done_by)
  values (s.company_id, s.id, wl.id, case when p_done then now() end, case when p_done then auth.uid() end)
  on conflict (session_id, location_id) do update set done_at = excluded.done_at, done_by = excluded.done_by;
  return jsonb_build_object('location_id', wl.id, 'code', wl.code, 'done', p_done);
end $$;

-- the session, now shelf by shelf
create or replace function public.count_session_view(p_session uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s public.count_sessions;
begin
  select * into s from public.count_sessions where id = p_session and deleted_at is null;
  if s.id is null then raise exception 'Counting session not found' using errcode = 'P0002'; end if;
  perform app.require_any_permission(s.company_id, array['wms.read', 'inventory.read']);
  return jsonb_build_object('id', s.id, 'name', s.name, 'status', s.status, 'warehouse_id', s.warehouse_id,
    'warehouse', (select name from public.warehouses where id = s.warehouse_id), 'cart_minutes', s.cart_minutes,
    'started_at', s.created_at, 'closed_at', s.closed_at,
    'mine', (select id from public.cycle_counts where session_id = s.id and assigned_to = auth.uid() and deleted_at is null and status <> 'cancelled' order by created_at desc limit 1),
    'lists', coalesce((select jsonb_agg(jsonb_build_object('id', oc.id, 'number', oc.number, 'status', oc.status, 'person', p.full_name,
                         'items', (select count(*) from public.cycle_count_lines l where l.cycle_count_id = oc.id and l.counted_qty is not null),
                         'entries', (select count(*) from public.cycle_count_entries e where e.count_id = oc.id),
                         'last_at', (select max(e.counted_at) from public.cycle_count_entries e where e.count_id = oc.id)) order by oc.created_at)
                       from public.cycle_counts oc left join public.profiles p on p.id = oc.assigned_to
                      where oc.session_id = s.id and oc.deleted_at is null and oc.status <> 'cancelled'), '[]'::jsonb),
    'items', (select count(*) from public.cycle_count_lines l join public.cycle_counts oc on oc.id = l.cycle_count_id
               where oc.session_id = s.id and oc.deleted_at is null and l.counted_qty is not null),
    'in_stock', (select count(distinct sl.variant_id) from public.stock_levels sl join public.warehouse_locations wl on wl.id = sl.location_id and wl.location_type = 'internal'
                  where sl.warehouse_id = s.warehouse_id and sl.on_hand > 0),
    'shelves', coalesce((select jsonb_agg(jsonb_build_object('location_id', wl.id, 'code', wl.code, 'name', wl.name,
                           'person_id', sh.assigned_to, 'person', pa.full_name, 'done', sh.done_at is not null, 'done_at', sh.done_at, 'done_by', pd.full_name,
                           'counted', (select count(distinct l.variant_id) from public.cycle_count_lines l join public.cycle_counts oc on oc.id = l.cycle_count_id
                                        where oc.session_id = s.id and oc.deleted_at is null and oc.status <> 'cancelled'
                                          and l.location_id = wl.id and l.counted_qty is not null),
                           -- how many items the shelf should hold: for the manager only (counters count blind)
                           'with_stock', case when app.has_permission(s.company_id, 'inventory.write')
                                              then (select count(distinct sl.variant_id) from public.stock_levels sl where sl.location_id = wl.id and sl.on_hand > 0) end)
                         order by wl.code)
                       from public.warehouse_locations wl
                       left join public.count_session_shelves sh on sh.session_id = s.id and sh.location_id = wl.id
                       left join public.profiles pa on pa.id = sh.assigned_to
                       left join public.profiles pd on pd.id = sh.done_by
                      where wl.company_id = s.company_id and wl.warehouse_id = s.warehouse_id and wl.location_type = 'internal'
                        and wl.deleted_at is null and (wl.is_active or sh.id is not null)), '[]'::jsonb));
end $$;

-- closing: what nobody found counts as zero everywhere, or only on the shelves marked done
drop function if exists public.count_session_close(uuid, boolean);
create or replace function public.count_session_close(p_session uuid, p_zero_uncounted boolean default false, p_zero_done_only boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.count_sessions; v_lists int; v_zero int := 0; v_id uuid; v_open int;
begin
  select * into s from public.count_sessions where id = p_session and deleted_at is null for update;
  if s.id is null then raise exception 'Counting session not found' using errcode = 'P0002'; end if;
  perform app.require_permission(s.company_id, 'inventory.write');
  if s.status <> 'open' then raise exception 'This counting session is closed' using errcode = '55000'; end if;
  -- a line whose entries were all taken back was not counted
  delete from public.cycle_count_lines l using public.cycle_counts oc
   where oc.id = l.cycle_count_id and oc.session_id = s.id and l.counted_qty is null
     and not exists (select 1 from public.cycle_count_entries e where e.line_id = l.id);
  update public.cycle_counts oc set status = 'cancelled'
   where oc.session_id = s.id and oc.status = 'in_progress' and oc.deleted_at is null
     and not exists (select 1 from public.cycle_count_lines l where l.cycle_count_id = oc.id);
  update public.cycle_counts set status = 'review' where session_id = s.id and status = 'in_progress' and deleted_at is null;
  get diagnostics v_lists = row_count;
  if p_zero_uncounted then
    insert into public.cycle_counts (company_id, warehouse_id, scope, scope_filter, blind_count, assigned_to, session_id, notes)
    values (s.company_id, s.warehouse_id, 'session', jsonb_build_object('session', s.id, 'zero', true, 'done_only', p_zero_done_only), true, auth.uid(), s.id,
            case when p_zero_done_only then 'Barazim 0: artikujt me stok që askush nuk i gjeti në raftet e mbaruara'
                 else 'Barazim 0: artikujt me stok që askush nuk i gjeti gjatë numërimit' end)
    returning id into v_id;
    update public.cycle_counts set status = 'in_progress' where id = v_id;
    insert into public.cycle_count_lines (company_id, cycle_count_id, variant_id, location_id, lot_id, system_qty, counted_qty, counted_at, counted_by)
    select s.company_id, v_id, sl.variant_id, sl.location_id, sl.lot_id, sl.on_hand, 0, now(), auth.uid()
      from public.stock_levels sl join public.warehouse_locations wl on wl.id = sl.location_id and wl.location_type = 'internal'
     where sl.warehouse_id = s.warehouse_id and sl.on_hand > 0
       and (not p_zero_done_only or exists (select 1 from public.count_session_shelves sh
                                             where sh.session_id = s.id and sh.location_id = sl.location_id and sh.done_at is not null))
       and not exists (select 1 from public.cycle_count_lines l join public.cycle_counts oc on oc.id = l.cycle_count_id
                        where oc.session_id = s.id and oc.id <> v_id and oc.deleted_at is null and oc.status <> 'cancelled'
                          and l.variant_id = sl.variant_id and l.location_id = sl.location_id and l.lot_id is not distinct from sl.lot_id);
    get diagnostics v_zero = row_count;
    if v_zero = 0 then update public.cycle_counts set status = 'cancelled' where id = v_id;
    else update public.cycle_counts set status = 'review' where id = v_id; v_lists := v_lists + 1; end if;
  end if;
  -- shelves with stock that nobody marked done
  select count(distinct sl.location_id) into v_open
    from public.stock_levels sl join public.warehouse_locations wl on wl.id = sl.location_id and wl.location_type = 'internal'
   where sl.warehouse_id = s.warehouse_id and sl.on_hand > 0
     and not exists (select 1 from public.count_session_shelves sh where sh.session_id = s.id and sh.location_id = sl.location_id and sh.done_at is not null);
  update public.count_sessions set status = 'closed', closed_at = now(), closed_by = auth.uid() where id = s.id;
  return jsonb_build_object('lists', v_lists, 'zero_lines', v_zero, 'shelves_not_done', v_open);
end $$;

-- the zone tasks close with the session
create or replace function app.tg_count_session_tasks() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('closed', 'cancelled') and old.status is distinct from new.status then
    update public.tasks set status = 'done', completed_at = now()
     where company_id = new.company_id and auto_key like 'count_zone:' || new.id || ':%' and status not in ('done', 'cancelled') and deleted_at is null;
  end if;
  return null;
end $$;
drop trigger if exists trg_92_done_tasks on public.count_sessions;
create trigger trg_92_done_tasks after update of status on public.count_sessions for each row execute function app.tg_count_session_tasks();

revoke execute on function public.count_session_people(uuid), public.count_session_assign(uuid, uuid[], uuid), public.count_shelf_done(uuid, uuid, boolean),
  public.count_session_view(uuid), public.count_session_close(uuid, boolean, boolean) from public, anon;
grant execute on function public.count_session_people(uuid), public.count_session_assign(uuid, uuid[], uuid), public.count_shelf_done(uuid, uuid, boolean),
  public.count_session_view(uuid), public.count_session_close(uuid, boolean, boolean) to authenticated;
