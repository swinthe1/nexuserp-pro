-- =============================================================================
-- DrisPRO · counting together, with the shop open (the owner's model from dris-ks, 9.11.2026)
--   A counting session of a unit: each person counts into a list of their own. The first list that counts an
--   item owns it; whoever counts the same item later sees "on Arben's list: 10 pcs, 14:05" and ADDS to it
--   (10 + 10 = 20), never replaces it. Unlike dris-ks:
--   · every entry is kept (who, how many, where, when): the review shows 20 = Arben 10 + Blerim 10, and each
--     person corrects only their own entries (a manager any);
--   · an entry made without internet is kept on the device and lands on the owner's list when it is sent;
--   · the difference is taken from when the item was counted, and the sales right after it (the goods that
--     may have been in a shopping cart) are shown beside it;
--   · closing the session can count as zero what nobody found (with the manager's word).
-- =============================================================================

create table if not exists public.count_sessions (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) deferrable initially immediate,
  warehouse_id  uuid not null,
  name          text not null check (length(btrim(name)) between 1 and 120),
  status        text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  cart_minutes  int not null default 20 check (cart_minutes between 0 and 120),
  closed_at     timestamptz,
  closed_by     uuid references auth.users(id) deferrable initially immediate,
  foreign key (company_id, warehouse_id) references public.warehouses(company_id, id) deferrable initially immediate
);
select app.register_table('public.count_sessions', 'wms', 'inventory', p_client_write => false);
create unique index if not exists count_sessions_one_open on public.count_sessions (warehouse_id) where status = 'open' and deleted_at is null;

alter table public.cycle_counts add column if not exists session_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cycle_counts_session_fkey') then
    alter table public.cycle_counts add constraint cycle_counts_session_fkey foreign key (company_id, session_id)
      references public.count_sessions(company_id, id) deferrable initially immediate;
  end if;
end $$;
create index if not exists cycle_counts_session_idx on public.cycle_counts (session_id) where session_id is not null;
alter table public.cycle_counts drop constraint if exists cycle_counts_scope_check;
alter table public.cycle_counts add constraint cycle_counts_scope_check
  check (scope in ('full', 'location', 'category', 'abc_class', 'random', 'risk', 'session'));

-- every entry of every person; the line's counted quantity is their sum
create table if not exists public.cycle_count_entries (
  id          uuid primary key,                       -- made by the device: an entry sent twice is kept once
  company_id  uuid not null references public.companies(id) deferrable initially immediate,
  line_id     uuid not null,
  count_id    uuid not null,                          -- the list it was entered from (the person's own)
  user_id     uuid not null references public.profiles(id) deferrable initially immediate,
  quantity    numeric(18,4) not null check (quantity >= 0),
  location_id uuid,
  counted_at  timestamptz not null,
  foreign key (company_id, line_id) references public.cycle_count_lines(company_id, id) on delete cascade deferrable initially immediate,
  foreign key (company_id, count_id) references public.cycle_counts(company_id, id) on delete cascade deferrable initially immediate
);
create index if not exists cycle_count_entries_line_idx on public.cycle_count_entries (line_id, counted_at);
create index if not exists cycle_count_entries_count_idx on public.cycle_count_entries (count_id, user_id);
select app.register_table('public.cycle_count_entries', 'wms', 'inventory', p_soft_delete => false, p_client_write => false);

-- the line follows its entries: the sum, the first time and the first person
create or replace function app.count_line_sync(p_line uuid) returns void language sql security definer set search_path = '' as $$
  update public.cycle_count_lines l
     set counted_qty = s.q, counted_at = s.first_at, counted_by = s.first_by
    from (select sum(e.quantity) as q, min(e.counted_at) as first_at,
                 (array_agg(e.user_id order by e.counted_at, e.created_at))[1] as first_by
            from public.cycle_count_entries e where e.line_id = p_line) s
   where l.id = p_line
$$;
revoke execute on function app.count_line_sync(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- the session
-- -----------------------------------------------------------------------------
create or replace function public.count_session_start(p_warehouse uuid, p_name text default null, p_cart_minutes int default 20)
returns uuid language plpgsql security definer set search_path = '' as $$
declare w public.warehouses; v_id uuid;
begin
  select * into w from public.warehouses where id = p_warehouse and deleted_at is null;
  if w.id is null then raise exception 'Warehouse not found' using errcode = 'P0002'; end if;
  perform app.require_permission(w.company_id, 'inventory.write');
  perform app.check_warehouse(w.company_id, w.id);
  if exists (select 1 from public.count_sessions where warehouse_id = w.id and status = 'open' and deleted_at is null) then
    raise exception 'A counting session is open in this unit already: join it' using errcode = '23505';
  end if;
  insert into public.count_sessions (company_id, warehouse_id, name, cart_minutes)
  values (w.company_id, w.id, coalesce(nullif(btrim(p_name), ''), 'Numërim ' || to_char(now() at time zone 'Europe/Tirane', 'DD.MM.YYYY')),
          greatest(0, least(120, coalesce(p_cart_minutes, 20))))
  returning id into v_id;
  return v_id;
end $$;

-- the person's own list in the session (made the first time they join)
create or replace function public.count_session_join(p_session uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare s public.count_sessions; v_id uuid;
begin
  select * into s from public.count_sessions where id = p_session and deleted_at is null;
  if s.id is null then raise exception 'Counting session not found' using errcode = 'P0002'; end if;
  perform app.require_permission(s.company_id, 'wms.write');
  perform app.check_warehouse(s.company_id, s.warehouse_id);
  if s.status <> 'open' then raise exception 'This counting session is closed' using errcode = '55000'; end if;
  select id into v_id from public.cycle_counts
   where session_id = s.id and assigned_to = auth.uid() and status = 'in_progress' and deleted_at is null limit 1;
  if v_id is not null then return v_id; end if;
  insert into public.cycle_counts (company_id, warehouse_id, scope, scope_filter, blind_count, assigned_to, session_id)
  values (s.company_id, s.warehouse_id, 'session', jsonb_build_object('session', s.id), true, auth.uid(), s.id)
  returning id into v_id;
  update public.cycle_counts set status = 'in_progress' where id = v_id;
  return v_id;
end $$;

-- -----------------------------------------------------------------------------
-- an entry: on the person's list, or added to the list that counted the item first
-- -----------------------------------------------------------------------------
create or replace function public.count_entry_add(p_id uuid, p_count uuid, p_variant uuid, p_location uuid, p_qty numeric,
                                                   p_lot uuid default null, p_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.cycle_counts; s public.count_sessions; ln public.cycle_count_lines; loc public.warehouse_locations; e public.cycle_count_entries;
        v_track text; v_at timestamptz := least(coalesce(p_at, now()), now()); v_owner uuid;
begin
  select * into e from public.cycle_count_entries where id = p_id;
  if e.id is not null then
    select * into ln from public.cycle_count_lines where id = e.line_id;
    return app.count_entry_answer(ln, e.count_id, e.quantity);
  end if;
  select * into c from public.cycle_counts where id = p_count and deleted_at is null;
  if c.id is null then raise exception 'Count not found' using errcode = 'P0002'; end if;
  perform app.require_permission(c.company_id, 'wms.write');
  if c.status <> 'in_progress' then raise exception 'Count % is %', c.number, replace(c.status, '_', ' ') using errcode = '55000'; end if;
  if c.session_id is not null then
    select * into s from public.count_sessions where id = c.session_id;
    -- after closing, only a list sent back to count again takes entries
    if s.status <> 'open' and not exists (select 1 from public.cycle_count_lines where cycle_count_id = c.id and recount) then
      raise exception 'This counting session is closed' using errcode = '55000';
    end if;
  end if;
  if p_qty is null or p_qty < 0 then raise exception 'Enter a quantity' using errcode = '23514'; end if;
  select * into loc from public.warehouse_locations where id = p_location;
  if loc.warehouse_id is distinct from c.warehouse_id then raise exception 'Bin % is not in the counted warehouse', loc.code using errcode = '23514'; end if;
  select p.tracking into v_track from public.product_variants v join public.products p on p.id = v.product_id
   where v.id = p_variant and v.company_id = c.company_id;
  if v_track is null then raise exception 'Unknown product' using errcode = '23503'; end if;
  if v_track <> 'none' and p_lot is null then raise exception 'Scan or choose the lot for this item' using errcode = '23514'; end if;

  -- the line: in a session, the one of the list that counted this item first (two people at the same second wait for each other)
  perform pg_advisory_xact_lock(hashtext(coalesce(c.session_id, c.id)::text || p_variant::text || p_location::text || coalesce(p_lot::text, '')));
  if c.session_id is not null then
    select l.* into ln from public.cycle_count_lines l join public.cycle_counts oc on oc.id = l.cycle_count_id
     where oc.session_id = c.session_id and oc.deleted_at is null and oc.status = 'in_progress'
       and l.variant_id = p_variant and l.location_id = p_location and l.lot_id is not distinct from p_lot
     order by l.created_at limit 1;
  else
    select * into ln from public.cycle_count_lines
     where cycle_count_id = c.id and variant_id = p_variant and location_id = p_location and lot_id is not distinct from p_lot;
  end if;
  if ln.id is null then
    insert into public.cycle_count_lines (company_id, cycle_count_id, variant_id, location_id, lot_id, system_qty)
    values (c.company_id, c.id, p_variant, p_location, p_lot,
            coalesce((select on_hand from public.stock_levels where variant_id = p_variant and location_id = p_location and lot_id is not distinct from p_lot), 0))
    returning * into ln;
  end if;
  insert into public.cycle_count_entries (id, company_id, line_id, count_id, user_id, quantity, location_id, counted_at)
  values (p_id, c.company_id, ln.id, c.id, auth.uid(), p_qty, p_location, v_at);
  perform app.count_line_sync(ln.id);
  select * into ln from public.cycle_count_lines where id = ln.id;
  return app.count_entry_answer(ln, c.id, p_qty);
end $$;

-- what the counter is told: whose list it is on, the total, what was there before (never the expected quantity)
create or replace function app.count_entry_answer(ln public.cycle_count_lines, p_from uuid, p_qty numeric)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('line_id', ln.id, 'count_id', ln.cycle_count_id, 'mine', ln.cycle_count_id = p_from,
    'owner', (select p.full_name from public.cycle_counts oc join public.profiles p on p.id = oc.assigned_to where oc.id = ln.cycle_count_id),
    'counted_qty', ln.counted_qty, 'before', ln.counted_qty - p_qty, 'added', p_qty,
    'entries', (select count(*) from public.cycle_count_entries where line_id = ln.id), 'system_qty', null)
$$;
revoke execute on function app.count_entry_answer(public.cycle_count_lines, uuid, numeric) from public, anon, authenticated;

-- a line sent back to count again starts from nothing: its entries go (the first count stays on the line)
create or replace function app.tg_count_line_recount() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.recount and new.counted_qty is null and old.counted_qty is not null then
    delete from public.cycle_count_entries where line_id = new.id;
  end if;
  return null;
end $$;
drop trigger if exists trg_80_recount_entries on public.cycle_count_lines;
create trigger trg_80_recount_entries after update of counted_qty on public.cycle_count_lines
  for each row execute function app.tg_count_line_recount();

-- an entry corrected (or removed with null): one's own while counting; anyone's for a manager
create or replace function public.count_entry_change(p_entry uuid, p_qty numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e public.cycle_count_entries; c public.cycle_counts; ln public.cycle_count_lines;
begin
  select * into e from public.cycle_count_entries where id = p_entry for update;
  if e.id is null then raise exception 'Entry not found' using errcode = 'P0002'; end if;
  select * into ln from public.cycle_count_lines where id = e.line_id;
  select * into c from public.cycle_counts where id = ln.cycle_count_id;
  perform app.require_permission(c.company_id, 'wms.write');
  if e.user_id <> auth.uid() and not app.has_permission(c.company_id, 'inventory.write') then
    raise exception 'Only the person who counted it, or a manager, corrects this entry' using errcode = '42501';
  end if;
  if c.status not in ('in_progress', 'review') then raise exception 'Count % is %', c.number, replace(c.status, '_', ' ') using errcode = '55000'; end if;
  if p_qty is not null and p_qty < 0 then raise exception 'Enter a quantity' using errcode = '23514'; end if;
  if p_qty is null then delete from public.cycle_count_entries where id = e.id;
  else update public.cycle_count_entries set quantity = p_qty where id = e.id; end if;
  perform app.count_line_sync(ln.id);
  if not exists (select 1 from public.cycle_count_entries where line_id = ln.id) then
    update public.cycle_count_lines set counted_qty = null, counted_at = null, counted_by = null where id = ln.id;
  end if;
  select * into ln from public.cycle_count_lines where id = ln.id;
  return jsonb_build_object('line_id', ln.id, 'counted_qty', ln.counted_qty);
end $$;

-- the session at a glance: the people, their lists, how far they are
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
                  where sl.warehouse_id = s.warehouse_id and sl.on_hand > 0));
end $$;

-- closing: the lists go to review; what nobody found can be counted as zero (the manager says so)
create or replace function public.count_session_close(p_session uuid, p_zero_uncounted boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.count_sessions; v_lists int; v_zero int := 0; v_id uuid;
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
    values (s.company_id, s.warehouse_id, 'session', jsonb_build_object('session', s.id, 'zero', true), true, auth.uid(), s.id,
            'Barazim 0: artikujt me stok që askush nuk i gjeti gjatë numërimit')
    returning id into v_id;
    update public.cycle_counts set status = 'in_progress' where id = v_id;
    insert into public.cycle_count_lines (company_id, cycle_count_id, variant_id, location_id, lot_id, system_qty, counted_qty, counted_at, counted_by)
    select s.company_id, v_id, sl.variant_id, sl.location_id, sl.lot_id, sl.on_hand, 0, now(), auth.uid()
      from public.stock_levels sl join public.warehouse_locations wl on wl.id = sl.location_id and wl.location_type = 'internal'
     where sl.warehouse_id = s.warehouse_id and sl.on_hand > 0
       and not exists (select 1 from public.cycle_count_lines l join public.cycle_counts oc on oc.id = l.cycle_count_id
                        where oc.session_id = s.id and oc.id <> v_id and oc.deleted_at is null and oc.status <> 'cancelled'
                          and l.variant_id = sl.variant_id and l.location_id = sl.location_id and l.lot_id is not distinct from sl.lot_id);
    get diagnostics v_zero = row_count;
    if v_zero = 0 then update public.cycle_counts set status = 'cancelled' where id = v_id;
    else update public.cycle_counts set status = 'review' where id = v_id; v_lists := v_lists + 1; end if;
  end if;
  update public.count_sessions set status = 'closed', closed_at = now(), closed_by = auth.uid() where id = s.id;
  return jsonb_build_object('lists', v_lists, 'zero_lines', v_zero);
end $$;

-- confirming the whole session at once: every list in review becomes its stock adjustment
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
  return jsonb_build_object('posted', jsonb_array_length(v_out), 'results', v_out);
end $$;

revoke execute on function public.count_session_start(uuid, text, int), public.count_session_join(uuid),
  public.count_entry_add(uuid, uuid, uuid, uuid, numeric, uuid, timestamptz), public.count_entry_change(uuid, numeric),
  public.count_session_view(uuid), public.count_session_close(uuid, boolean), public.count_session_post(uuid) from public, anon;
grant execute on function public.count_session_start(uuid, text, int), public.count_session_join(uuid),
  public.count_entry_add(uuid, uuid, uuid, uuid, numeric, uuid, timestamptz), public.count_entry_change(uuid, numeric),
  public.count_session_view(uuid), public.count_session_close(uuid, boolean), public.count_session_post(uuid) to authenticated;

-- an entry made without internet is sent later, once
do $patch$
declare d text;
begin
  d := pg_get_functiondef('public.offline_call(uuid,text,jsonb)'::regprocedure);
  if position('count_entry_add' in d) > 0 then return; end if;
  if position($a$'post_goods_receipt', 'count_item')$a$ in d) = 0 then raise exception 'offline_call: anchor not found'; end if;
  execute replace(d, $a$'post_goods_receipt', 'count_item')$a$, $a$'post_goods_receipt', 'count_item', 'count_entry_add')$a$);
end $patch$ language plpgsql;

-- -----------------------------------------------------------------------------
-- the review: who counted what, and what may have been in a shopping cart
-- (the expected quantity is taken from when the goods moved, as the confirmation takes it)
-- -----------------------------------------------------------------------------
create or replace function app.count_review__all(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare c public.cycle_counts; v_out jsonb; v_cart int;
begin
  select * into c from public.cycle_counts where id = p_id and deleted_at is null;
  if c.id is null then raise exception 'Count not found' using errcode = 'P0002'; end if;
  perform app.require_any_permission(c.company_id, array['inventory.read', 'wms.read']);
  v_cart := coalesce((select cart_minutes from public.count_sessions where id = c.session_id), 20);
  with d as (
    select cl.id, cl.variant_id, v.sku, v.name, loc.code as location, lt.lot_number as lot, cl.counted_qty, cl.first_counted_qty, cl.recount, cl.reasons,
           cl.counted_at, cl.location_id, cl.lot_id,
           -- the stock now, less what moved after the line was counted: the same figure the confirmation uses
           coalesce((select sl.on_hand from public.stock_levels sl where sl.variant_id = cl.variant_id and sl.location_id = cl.location_id
                       and sl.lot_id is not distinct from cl.lot_id), 0)
           - coalesce((select sum(case when m.to_location_id = cl.location_id then m.quantity else -m.quantity end)
                         from public.stock_movements m
                        where m.company_id = cl.company_id and m.variant_id = cl.variant_id and m.lot_id is not distinct from cl.lot_id
                          and cl.location_id in (m.from_location_id, m.to_location_id)
                          and m.movement_date > coalesce(cl.counted_at, c.created_at)), 0) as expected,
           coalesce(ic.avg_cost, 0) as unit_cost,
           round(coalesce(v.sales_price_override, p.sales_price, 0) * (1 + coalesce(tc.rate, 0) / 100), 2) as unit_price
      from public.cycle_count_lines cl
      join public.product_variants v on v.id = cl.variant_id
      join public.products p on p.id = v.product_id
      left join public.tax_codes tc on tc.id = p.sales_tax_code_id
      join public.warehouse_locations loc on loc.id = cl.location_id
      left join public.lots lt on lt.id = cl.lot_id
      left join public.item_costs ic on ic.company_id = cl.company_id and ic.variant_id = cl.variant_id
     where cl.cycle_count_id = c.id
  ),
  x as (
    select d.*, d.counted_qty - d.expected as delta, round((d.counted_qty - d.expected) * d.unit_cost, 2) as value,
           case when d.expected <> 0 then round((d.counted_qty - d.expected) / abs(d.expected) * 100, 1) end as pct,
           -- sold within the minutes after it was counted: it may have been in a shopping cart when the shelf was counted
           coalesce((select sum(m.quantity) from public.stock_movements m
                      where m.company_id = c.company_id and m.variant_id = d.variant_id and m.lot_id is not distinct from d.lot_id
                        and m.from_location_id = d.location_id and m.movement_type = 'pos_sale'
                        and m.movement_date > d.counted_at and m.movement_date <= d.counted_at + make_interval(mins => v_cart)), 0) as in_carts
      from d where d.counted_qty is not null
  )
  select jsonb_build_object(
    'lines', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'variant_id', variant_id, 'sku', sku, 'name', name, 'location', location, 'lot', lot,
                                                          'expected', expected, 'counted', counted_qty, 'first_counted', first_counted_qty, 'recount', recount, 'reasons', reasons,
                                                          'delta', delta, 'pct', pct, 'unit_cost', unit_cost, 'value', value,
                                                          'in_carts', case when delta < 0 and in_carts > 0 then least(in_carts, -delta) end,
                                                          'entries', (select jsonb_agg(jsonb_build_object('name', pr.full_name, 'qty', e.quantity, 'at', e.counted_at, 'location', el.code) order by e.counted_at)
                                                                        from public.cycle_count_entries e left join public.profiles pr on pr.id = e.user_id
                                                                        left join public.warehouse_locations el on el.id = e.location_id
                                                                       where e.line_id = x.id))
                                        order by abs(value) desc, sku)
                         from x where delta <> 0), '[]'),
    'counted', (select count(*) from x),
    'not_counted', (select count(*) from d where d.counted_qty is null),
    'differences', (select count(*) from x where delta <> 0),
    'in_carts', (select count(*) from x where delta < 0 and in_carts > 0),
    'gains', coalesce((select sum(value) from x where value > 0), 0),
    'losses', coalesce((select sum(value) from x where value < 0), 0),
    'net', coalesce((select sum(value) from x), 0),
    'counted_value', coalesce((select round(sum(counted_qty * unit_cost), 2) from x), 0),
    'gains_sale', coalesce((select round(sum(delta * unit_price), 2) from x where delta > 0), 0),
    'losses_sale', coalesce((select round(sum(delta * unit_price), 2) from x where delta < 0), 0)
  ) into v_out;
  return v_out;
end $function$;

-- -----------------------------------------------------------------------------
-- what the counting screen shows
-- -----------------------------------------------------------------------------
-- the entries of one line: who, how many, where, when; one's own can be corrected
create or replace function public.count_line_entries(p_line uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare ln public.cycle_count_lines; c public.cycle_counts;
begin
  select * into ln from public.cycle_count_lines where id = p_line;
  if ln.id is null then raise exception 'Count not found' using errcode = 'P0002'; end if;
  select * into c from public.cycle_counts where id = ln.cycle_count_id;
  perform app.require_any_permission(c.company_id, array['wms.read', 'inventory.read']);
  return jsonb_build_object('line_id', ln.id, 'count_id', ln.cycle_count_id, 'counted_qty', ln.counted_qty,
    'owner', (select p.full_name from public.profiles p where p.id = c.assigned_to),
    'entries', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'name', p.full_name, 'qty', e.quantity, 'at', e.counted_at,
                                                             'location', l.code, 'mine', e.user_id = auth.uid()) order by e.counted_at)
                           from public.cycle_count_entries e left join public.profiles p on p.id = e.user_id
                           left join public.warehouse_locations l on l.id = e.location_id
                          where e.line_id = ln.id), '[]'::jsonb));
end $$;

-- the items a person added to other people's lists, from their own list
create or replace function public.count_list_extras(p_count uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.cycle_counts;
begin
  select * into c from public.cycle_counts where id = p_count and deleted_at is null;
  if c.id is null then raise exception 'Count not found' using errcode = 'P0002'; end if;
  perform app.require_any_permission(c.company_id, array['wms.read', 'inventory.read']);
  return coalesce((select jsonb_agg(x order by x ->> 'name') from (
    select jsonb_build_object('line_id', l.id, 'variant_id', l.variant_id, 'location_id', l.location_id, 'lot_id', l.lot_id, 'sku', v.sku, 'name', v.name, 'location', wl.code, 'owner', p.full_name,
                              'counted_qty', l.counted_qty, 'mine_qty', sum(e.quantity)) as x
      from public.cycle_count_entries e
      join public.cycle_count_lines l on l.id = e.line_id
      join public.cycle_counts oc on oc.id = l.cycle_count_id
      join public.product_variants v on v.id = l.variant_id
      join public.warehouse_locations wl on wl.id = l.location_id
      left join public.profiles p on p.id = oc.assigned_to
     where e.count_id = c.id and l.cycle_count_id <> c.id
     group by l.id, l.variant_id, l.location_id, l.lot_id, v.sku, v.name, wl.code, p.full_name, l.counted_qty) q), '[]'::jsonb);
end $$;
revoke execute on function public.count_line_entries(uuid), public.count_list_extras(uuid) from public, anon;
grant execute on function public.count_line_entries(uuid), public.count_list_extras(uuid) to authenticated;
