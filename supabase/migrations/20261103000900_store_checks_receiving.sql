-- =============================================================================
-- DrisPRO · Daily checks in the shop, and receiving with temperature and a discrepancy report
--   (from the shop's own handbooks: the manager's control table, the shelf worker's hygiene and
--   dates, the receiver's cold goods and written discrepancies)
--   1. Check lists per store: opening, dates and shelves, hygiene, fridge temperatures, closing.
--      Each day the staff ticks them and writes the readings; a reading out of its range or a point
--      not done is a problem, and the store managers are told. The shift leader signs the list.
--      A list not done an hour after its time becomes a task (Tasks → Automations).
--   2. Cold goods have a highest temperature; the receiver writes the temperature at the door and a
--      warmer line cannot be accepted. A refused line keeps its reason. The discrepancy report
--      (procesverbal) of a receipt: short, over, refused, too warm, not measured.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Daily checks
-- -----------------------------------------------------------------------------
create table if not exists public.store_checklists (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id),
  warehouse_id uuid,                                    -- null: every store
  name         text not null,
  kind         text not null default 'other' check (kind in ('opening', 'closing', 'hygiene', 'temperature', 'dates', 'other')),
  weekdays     smallint[] not null default '{1,2,3,4,5,6,7}',   -- ISO: 1 Monday … 7 Sunday
  due_time     time not null default '09:00',
  items        jsonb not null default '[]',             -- [{id, label, type: check|number, min, max, unit, required}]
  position     int not null default 0,
  is_active    boolean not null default true,
  foreign key (company_id, warehouse_id) references public.warehouses(company_id, id)
);
select app.register_table('public.store_checklists', 'pos', p_client_write => false);

create table if not exists public.store_checks (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  checklist_id  uuid not null references public.store_checklists(id),
  warehouse_id  uuid not null,
  check_date    date not null,
  status        text not null default 'open' check (status in ('open', 'done')),
  items         jsonb not null default '[]',            -- the list as it was when it was done
  answers       jsonb not null default '{}',            -- {item_id: {ok, value, note}}
  problems      jsonb not null default '[]',            -- [{item_id, label, why: not_done|missing|low|high, value, min, max, unit}]
  note          text,
  done_by       uuid references auth.users(id),
  done_at       timestamptz,
  signed_by     uuid references auth.users(id),
  signed_at     timestamptz,
  foreign key (company_id, warehouse_id) references public.warehouses(company_id, id),
  unique (checklist_id, warehouse_id, check_date)
);
create index if not exists store_checks_day_idx on public.store_checks (company_id, warehouse_id, check_date);
select app.register_table('public.store_checks', 'pos', p_soft_delete => false, p_client_write => false);

create or replace function app.checks_can(p_company uuid, p_what text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case p_what
    when 'fill'   then app.has_permission(p_company, 'pos.write') or app.has_permission(p_company, 'wms.write') or app.has_permission(p_company, 'pos.approve')
                       or app.has_permission(p_company, 'inventory.write')
    when 'sign'   then app.has_permission(p_company, 'pos.approve') or app.has_permission(p_company, 'inventory.approve')
    when 'manage' then app.has_permission(p_company, 'pos.approve') or app.has_permission(p_company, 'admin.write')
    when 'read'   then app.has_permission(p_company, 'pos.read') or app.has_permission(p_company, 'wms.read') or app.has_permission(p_company, 'inventory.read')
    else false end
$$;
revoke execute on function app.checks_can(uuid, text) from public, anon, authenticated;

-- the stores a list for "every store" applies to: the ones with a till, else every active warehouse
create or replace function app.check_stores(p_company uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select w.id from public.warehouses w
   where w.company_id = p_company and w.deleted_at is null and w.is_active
     and (exists (select 1 from public.pos_registers g where g.warehouse_id = w.id and g.deleted_at is null and g.is_active)
          or not exists (select 1 from public.pos_registers g where g.company_id = p_company and g.deleted_at is null and g.is_active))
$$;
revoke execute on function app.check_stores(uuid) from public, anon, authenticated;

-- one list: its points (each keeps an id, so the answers follow it)
create or replace function public.store_checklist_save(p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_co uuid := (p ->> 'company_id')::uuid; v_id uuid := nullif(p ->> 'id', '')::uuid; c public.store_checklists; v_items jsonb := '[]'::jsonb; x jsonb;
begin
  if v_id is not null then
    select * into c from public.store_checklists where id = v_id and deleted_at is null for update;
    if c.id is null then raise exception 'Check list not found' using errcode = 'P0002'; end if;
    v_co := c.company_id;
  end if;
  if not app.checks_can(v_co, 'manage') then raise exception 'Permission denied: only a store manager changes the check lists' using errcode = '42501'; end if;
  if length(btrim(coalesce(p ->> 'name', ''))) < 2 then raise exception 'Give the list a name' using errcode = '22023'; end if;
  for x in select * from jsonb_array_elements(coalesce(p -> 'items', '[]'::jsonb)) loop
    continue when length(btrim(coalesce(x ->> 'label', ''))) = 0;
    if coalesce(x ->> 'type', 'check') not in ('check', 'number') then raise exception 'A point is a tick or a reading' using errcode = '22023'; end if;
    if x ->> 'type' = 'number' and nullif(x ->> 'min', '') is not null and nullif(x ->> 'max', '') is not null and (x ->> 'min')::numeric > (x ->> 'max')::numeric then
      raise exception 'The lowest value of "%" is above its highest', x ->> 'label' using errcode = '22023';
    end if;
    v_items := v_items || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'id', coalesce(nullif(x ->> 'id', ''), gen_random_uuid()::text), 'label', btrim(x ->> 'label'), 'type', coalesce(x ->> 'type', 'check'),
      'min', nullif(x ->> 'min', '')::numeric, 'max', nullif(x ->> 'max', '')::numeric, 'unit', nullif(btrim(x ->> 'unit'), ''),
      'required', coalesce((x ->> 'required')::boolean, true))));
  end loop;
  if jsonb_array_length(v_items) = 0 then raise exception 'Add at least one point to check' using errcode = '22023'; end if;
  if c.id is null then
    insert into public.store_checklists (company_id, warehouse_id, name, kind, weekdays, due_time, items, position)
    values (v_co, nullif(p ->> 'warehouse_id', '')::uuid, btrim(p ->> 'name'), coalesce(nullif(p ->> 'kind', ''), 'other'),
            coalesce((select array_agg(d::smallint order by d::smallint) from jsonb_array_elements_text(p -> 'weekdays') d), '{1,2,3,4,5,6,7}'),
            coalesce(nullif(p ->> 'due_time', '')::time, '09:00'), v_items,
            coalesce((select max(position) + 1 from public.store_checklists where company_id = v_co), 0))
    returning id into v_id;
  else
    update public.store_checklists
       set warehouse_id = case when p ? 'warehouse_id' then nullif(p ->> 'warehouse_id', '')::uuid else warehouse_id end,
           name = btrim(p ->> 'name'), kind = coalesce(nullif(p ->> 'kind', ''), kind),
           weekdays = coalesce((select array_agg(d::smallint order by d::smallint) from jsonb_array_elements_text(p -> 'weekdays') d), weekdays),
           due_time = coalesce(nullif(p ->> 'due_time', '')::time, due_time), items = v_items,
           is_active = coalesce((p ->> 'is_active')::boolean, is_active)
     where id = c.id;
  end if;
  return v_id;
end $$;

create or replace function public.store_checklist_delete(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.store_checklists;
begin
  select * into c from public.store_checklists where id = p_id and deleted_at is null;
  if c.id is null then raise exception 'Check list not found' using errcode = 'P0002'; end if;
  if not app.checks_can(c.company_id, 'manage') then raise exception 'Permission denied: only a store manager changes the check lists' using errcode = '42501'; end if;
  update public.store_checklists set deleted_at = now(), deleted_by = auth.uid(), is_active = false where id = c.id;
end $$;

-- the lists of the shop's own handbook, to start from
create or replace function public.store_checklists_defaults(p_company uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare n int := 0; d jsonb; it jsonb;
begin
  if not app.checks_can(p_company, 'manage') then raise exception 'Permission denied: only a store manager changes the check lists' using errcode = '42501'; end if;
  for d in select * from jsonb_array_elements($j$[
    {"name": "Hapja e dyqanit", "kind": "opening", "due_time": "07:30", "items": [
      {"label": "Dritat dhe ngrohja/ftohja ndezur"}, {"label": "Arkat dhe sistemi punojnë"}, {"label": "Fondi i arkës u numërua"},
      {"label": "Frigoriferi i bulmetit", "type": "number", "min": 0, "max": 6, "unit": "°C"},
      {"label": "Ngrirësi", "type": "number", "min": -25, "max": -18, "unit": "°C"},
      {"label": "Raftet plot dhe të rregullta"}, {"label": "Hyrja dhe dyshemeja të pastra"}]},
    {"name": "Afatet dhe çmimet", "kind": "dates", "due_time": "10:00", "items": [
      {"label": "U kontrolluan produktet e freskëta që skadojnë"}, {"label": "Asnjë produkt i skaduar në raft"},
      {"label": "Etiketat e çmimeve të sakta (raft = arkë)"}, {"label": "Aksionet me çmimin e duhur"}, {"label": "Kartonët dhe ambalazhet u larguan"}]},
    {"name": "Higjiena", "kind": "hygiene", "due_time": "14:00", "items": [
      {"label": "Sektori i freskët i pastër"}, {"label": "Dyshemetë pa derdhje"}, {"label": "Tualetet të pastra"},
      {"label": "Mbeturinat u larguan"}, {"label": "Uniforma dhe dorezat në rregull"}]},
    {"name": "Temperaturat e frigoriferëve", "kind": "temperature", "due_time": "16:00", "items": [
      {"label": "Frigoriferi i bulmetit", "type": "number", "min": 0, "max": 6, "unit": "°C"},
      {"label": "Frigoriferi i mishit", "type": "number", "min": 0, "max": 4, "unit": "°C"},
      {"label": "Ngrirësi", "type": "number", "min": -25, "max": -18, "unit": "°C"},
      {"label": "Vitrina e freskët", "type": "number", "min": 0, "max": 8, "unit": "°C"}]},
    {"name": "Mbyllja e dyqanit", "kind": "closing", "due_time": "21:30", "items": [
      {"label": "Arkat u mbyllën dhe u numëruan"}, {"label": "Frigoriferët punojnë", "type": "number", "min": 0, "max": 6, "unit": "°C"},
      {"label": "Pajisjet e panevojshme u fikën"}, {"label": "Dyert dhe dalja e rampës të mbyllura"}, {"label": "Alarmi u ndez"}]}
  ]$j$::jsonb) loop
    continue when exists (select 1 from public.store_checklists where company_id = p_company and name = d ->> 'name' and deleted_at is null);
    perform public.store_checklist_save(d || jsonb_build_object('company_id', p_company));
    n := n + 1;
  end loop;
  return n;
end $$;

-- the problems of one set of answers
create or replace function app.check_problems(p_items jsonb, p_answers jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(x order by ord), '[]'::jsonb) from (
    select i.ord, jsonb_strip_nulls(jsonb_build_object('item_id', i.it ->> 'id', 'label', i.it ->> 'label',
             'why', case when i.it ->> 'type' = 'number' and v is null then 'missing'
                         when i.it ->> 'type' = 'number' and v < (i.it ->> 'min')::numeric then 'low'
                         when i.it ->> 'type' = 'number' and v > (i.it ->> 'max')::numeric then 'high'
                         else 'not_done' end,
             'value', v, 'min', (i.it ->> 'min')::numeric, 'max', (i.it ->> 'max')::numeric, 'unit', i.it ->> 'unit')) as x
      from jsonb_array_elements(p_items) with ordinality i(it, ord)
      cross join lateral (select nullif(p_answers -> (i.it ->> 'id') ->> 'value', '')::numeric as v,
                                 coalesce((p_answers -> (i.it ->> 'id') ->> 'ok')::boolean, false) as ok) a
     where case when i.it ->> 'type' = 'number'
                then (v is null and coalesce((i.it ->> 'required')::boolean, true))
                     or v < coalesce((i.it ->> 'min')::numeric, v) or v > coalesce((i.it ->> 'max')::numeric, v)
                else not a.ok and coalesce((i.it ->> 'required')::boolean, true) end) p
$$;

-- what is due in a store on a day, with what was done
create or replace function public.store_checks_day(p_company uuid, p_warehouse uuid, p_date date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_tz text; v_now timestamp; v_date date;
begin
  if not app.checks_can(p_company, 'read') then raise exception 'Permission denied' using errcode = '42501'; end if;
  v_tz := coalesce((select timezone from public.companies where id = p_company), 'Europe/Tirane');
  v_now := now() at time zone v_tz;
  v_date := coalesce(p_date, v_now::date);
  return jsonb_build_object('date', v_date, 'today', v_now::date,
    'can', jsonb_build_object('fill', app.checks_can(p_company, 'fill'), 'sign', app.checks_can(p_company, 'sign'), 'manage', app.checks_can(p_company, 'manage')),
    'lists', coalesce((
      select jsonb_agg(jsonb_build_object('checklist_id', c.id, 'name', c.name, 'kind', c.kind, 'due_time', to_char(c.due_time, 'HH24:MI'),
               'items', coalesce(s.items, c.items), 'check_id', s.id, 'status', coalesce(s.status, 'todo'), 'answers', coalesce(s.answers, '{}'::jsonb),
               'problems', coalesce(s.problems, '[]'::jsonb), 'note', s.note, 'done_by', app.person_name(s.done_by), 'done_at', s.done_at,
               'signed_by', app.person_name(s.signed_by), 'signed_at', s.signed_at,
               'late', coalesce(s.status, 'todo') <> 'done' and (v_date < v_now::date or (v_date = v_now::date and v_now::time > c.due_time)))
             order by c.due_time, c.position)
        from public.store_checklists c
        left join public.store_checks s on s.checklist_id = c.id and s.warehouse_id = p_warehouse and s.check_date = v_date
       where c.company_id = p_company and c.deleted_at is null and (c.is_active or s.id is not null)
         and (c.warehouse_id = p_warehouse or (c.warehouse_id is null and p_warehouse in (select app.check_stores(p_company))))
         and (s.id is not null or extract(isodow from v_date)::smallint = any (c.weekdays))), '[]'::jsonb));
end $$;

-- the answers of a list (kept as a draft, or done); the problems are worked out here
create or replace function public.store_check_submit(p_checklist uuid, p_warehouse uuid, p_date date, p_answers jsonb, p_note text default null, p_done boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.store_checklists; s public.store_checks; v_today date; v_probs jsonb; v_store text;
begin
  select * into c from public.store_checklists where id = p_checklist and deleted_at is null;
  if c.id is null then raise exception 'Check list not found' using errcode = 'P0002'; end if;
  if not app.checks_can(c.company_id, 'fill') then raise exception 'Permission denied' using errcode = '42501'; end if;
  perform app.check_warehouse(c.company_id, p_warehouse);
  if not (c.warehouse_id = p_warehouse or (c.warehouse_id is null and p_warehouse in (select app.check_stores(c.company_id)))) then
    raise exception 'This list is not for that store' using errcode = '22023';
  end if;
  v_today := (now() at time zone coalesce((select timezone from public.companies where id = c.company_id), 'Europe/Tirane'))::date;
  if p_date > v_today or p_date < v_today - 1 then raise exception 'A check is written on its day (or the day after at the latest)' using errcode = '22023'; end if;
  select * into s from public.store_checks where checklist_id = c.id and warehouse_id = p_warehouse and check_date = p_date for update;
  if s.signed_at is not null then raise exception 'The list was signed already; it cannot change' using errcode = '55000'; end if;
  v_probs := app.check_problems(coalesce(s.items, c.items), coalesce(p_answers, '{}'::jsonb));
  if s.id is null then
    insert into public.store_checks (company_id, checklist_id, warehouse_id, check_date, items, answers, problems, note, status, done_by, done_at)
    values (c.company_id, c.id, p_warehouse, p_date, c.items, coalesce(p_answers, '{}'::jsonb), v_probs, nullif(btrim(p_note), ''),
            case when p_done then 'done' else 'open' end, case when p_done then auth.uid() end, case when p_done then now() end)
    returning * into s;
  else
    update public.store_checks set answers = coalesce(p_answers, '{}'::jsonb), problems = v_probs, note = nullif(btrim(p_note), ''),
           status = case when p_done then 'done' else status end, done_by = case when p_done then auth.uid() else done_by end,
           done_at = case when p_done then now() else done_at end
     where id = s.id returning * into s;
  end if;
  -- out of range or not done: the store managers are told at once
  if p_done and jsonb_array_length(v_probs) > 0 then
    select name into v_store from public.warehouses where id = p_warehouse;
    perform app.notify_permission(c.company_id, 'pos.approve', 'alert', 'Check with problems: ' || c.name || ' · ' || v_store,
      (select string_agg(x ->> 'label' || coalesce(' ' || (x ->> 'value') || coalesce(x ->> 'unit', ''), ''), '; ') from jsonb_array_elements(v_probs) x),
      '/pos/checks?store=' || p_warehouse || '&date=' || p_date);
  end if;
  if p_done then
    update public.tasks set status = 'done', completed_at = now()
     where company_id = c.company_id and auto_key = 'store_check:' || c.id || ':' || p_warehouse || ':' || p_date and status not in ('done', 'cancelled') and deleted_at is null;
  end if;
  return jsonb_build_object('id', s.id, 'status', s.status, 'problems', s.problems);
end $$;

-- the shift leader signs the list
create or replace function public.store_check_sign(p_check uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.store_checks;
begin
  select * into s from public.store_checks where id = p_check for update;
  if s.id is null then raise exception 'Check not found' using errcode = 'P0002'; end if;
  if not app.checks_can(s.company_id, 'sign') then raise exception 'Permission denied: the shift leader or store manager signs' using errcode = '42501'; end if;
  if s.status <> 'done' then raise exception 'The list is not finished yet' using errcode = '55000'; end if;
  if s.signed_at is not null then raise exception 'The list was signed already' using errcode = '55000'; end if;
  update public.store_checks set signed_by = auth.uid(), signed_at = now() where id = s.id;
end $$;

-- the days of a period, list by list: done, done with problems, signed, missed
create or replace function public.store_checks_history(p_company uuid, p_warehouse uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_today date;
begin
  if not app.checks_can(p_company, 'read') then raise exception 'Permission denied' using errcode = '42501'; end if;
  if p_to - p_from > 62 then raise exception 'Choose at most two months' using errcode = '22023'; end if;
  v_today := (now() at time zone coalesce((select timezone from public.companies where id = p_company), 'Europe/Tirane'))::date;
  return jsonb_build_object('days', (select jsonb_agg(d::date order by d) from generate_series(p_from, p_to, interval '1 day') d),
    'lists', coalesce((
      select jsonb_agg(jsonb_build_object('checklist_id', c.id, 'name', c.name, 'kind', c.kind,
               'cells', (select jsonb_object_agg(d::date, case
                    when s.id is not null and s.status = 'done' then case when jsonb_array_length(s.problems) > 0 then 'problems' when s.signed_at is not null then 'signed' else 'done' end
                    when not (extract(isodow from d)::smallint = any (c.weekdays)) or d::date < c.created_at::date then 'off'
                    when d::date < v_today then 'missed' else 'todo' end)
                  from generate_series(p_from, p_to, interval '1 day') d
                  left join public.store_checks s on s.checklist_id = c.id and s.warehouse_id = p_warehouse and s.check_date = d::date))
             order by c.due_time, c.position)
        from public.store_checklists c
       where c.company_id = p_company and c.deleted_at is null and c.is_active
         and (c.warehouse_id = p_warehouse or (c.warehouse_id is null and p_warehouse in (select app.check_stores(p_company))))), '[]'::jsonb));
end $$;

-- a list not done an hour after its time: a task for the store manager
do $$
declare v_oid oid; v_def text; v_anchor text := '  -- new contacts nobody has picked up within a day';
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'tasks_run';
  v_def := pg_get_functiondef(v_oid);
  if position('store_check:' in v_def) > 0 then return; end if;
  if position(v_anchor in v_def) = 0 then raise exception 'tasks_run: the place for the store checks was not found'; end if;
  execute replace(v_def, v_anchor, $x$  -- a check list of the shop not done an hour after its time: the store manager sees to it
  if app.auto_on(s, 'store_check') then
    for r in select cl.id, cl.name, w.id as wh, w.name as store from public.store_checklists cl
               join public.warehouses w on w.company_id = cl.company_id and (w.id = cl.warehouse_id or (cl.warehouse_id is null and w.id in (select app.check_stores(p_company))))
              where cl.company_id = p_company and cl.deleted_at is null and cl.is_active
                and extract(isodow from v_today)::smallint = any (cl.weekdays)
                and (now() at time zone coalesce(c.timezone, 'Europe/Tirane'))::time > cl.due_time + interval '1 hour'
                and not exists (select 1 from public.store_checks sc where sc.checklist_id = cl.id and sc.warehouse_id = w.id and sc.check_date = v_today and sc.status = 'done') loop
      if app.auto_task(p_company, 'store_check:' || r.id || ':' || r.wh || ':' || v_today, 'Plotëso kontrollin: ' || r.name || ' · ' || r.store,
                       app.first_with_role(p_company, array['store_manager','company_admin']), v_today, 2::smallint, null, null, null) then n := n + 1; end if;
    end loop;
  end if;

$x$ || v_anchor);
end $$;

-- -----------------------------------------------------------------------------
-- 2. Receiving: temperature and the discrepancy report
-- -----------------------------------------------------------------------------
alter table public.products add column if not exists max_temperature numeric(5,1);   -- cold goods: the highest °C allowed
alter table public.goods_receipt_lines
  add column if not exists temperature numeric(5,1),
  add column if not exists qc_reason text;
alter table public.goods_receipts add column if not exists driver_name text;

-- a cold line warmer than its limit cannot be accepted
create or replace function app.tg_receipt_line_temperature()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_max numeric; v_name text;
begin
  if new.qc_status = 'rejected' or new.temperature is null then return new; end if;
  select p.max_temperature, v.name into v_max, v_name from public.product_variants v join public.products p on p.id = v.product_id where v.id = new.variant_id;
  if v_max is not null and new.temperature > v_max then
    raise exception '% came at % °C, above its % °C: refuse it or write it as refused', v_name, new.temperature, v_max using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists trg_08_temperature on public.goods_receipt_lines;
create trigger trg_08_temperature before insert or update of temperature, qc_status on public.goods_receipt_lines
  for each row execute function app.tg_receipt_line_temperature();

-- the discrepancy report of a receipt (procesverbal): what differs from the order or the delivery note
create or replace function public.receipt_report(p_receipt uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare g public.goods_receipts;
begin
  select * into g from public.goods_receipts where id = p_receipt;
  if g.id is null then raise exception 'Receipt not found' using errcode = 'P0002'; end if;
  if not (app.has_permission(g.company_id, 'wms.read') or app.has_permission(g.company_id, 'inventory.read') or app.has_permission(g.company_id, 'procurement.read')) then
    raise exception 'Permission denied' using errcode = '42501';
  end if;
  return (
  with l as (
    select gl.id, gl.po_line_id, gl.variant_id, v.sku, v.name, gl.quantity, gl.qc_status, gl.qc_reason, gl.temperature, p.max_temperature,
           pl.quantity as ordered,
           -- what was still expected when this receipt came: ordered less what other finished receipts brought before it
           pl.quantity - coalesce((select sum(x.quantity) from public.goods_receipt_lines x join public.goods_receipts y on y.id = x.receipt_id
                                    where x.po_line_id = gl.po_line_id and y.id <> g.id and y.status = 'done' and x.qc_status <> 'rejected'
                                      and (g.done_at is null or y.done_at < g.done_at)), 0) as expected
      from public.goods_receipt_lines gl
      join public.product_variants v on v.id = gl.variant_id join public.products p on p.id = v.product_id
      left join public.purchase_order_lines pl on pl.id = gl.po_line_id
     where gl.receipt_id = g.id
  ), per as (   -- one receipt can split a line (two lots): judged per order line
    select coalesce(po_line_id::text, id::text) as k, min(sku) as sku, min(name) as name, max(expected) as expected,
           sum(quantity) filter (where qc_status <> 'rejected') as accepted, coalesce(sum(quantity) filter (where qc_status = 'rejected'), 0) as refused,
           string_agg(distinct qc_reason, '; ') filter (where qc_reason is not null) as reason,
           max(temperature) as temperature, max(max_temperature) as max_temperature,
           bool_or(max_temperature is not null and temperature is null and qc_status <> 'rejected') as not_measured
      from l group by 1
  ), missing as (   -- order lines that did not come at all with this receipt
    select pl.id::text as k, v.sku, v.name, pl.quantity - pl.qty_received as expected
      from public.purchase_order_lines pl join public.product_variants v on v.id = pl.variant_id
     where g.purchase_order_id is not null and pl.purchase_order_id = g.purchase_order_id and g.status = 'done'
       and not exists (select 1 from l where l.po_line_id = pl.id) and pl.quantity > pl.qty_received
  ), rows as (
    select sku, name, expected, coalesce(accepted, 0) as accepted, refused, reason, temperature, max_temperature,
           array_remove(array[case when expected is not null and coalesce(accepted, 0) < expected then 'short' end,
                              case when expected is not null and coalesce(accepted, 0) > expected then 'over' end,
                              case when refused > 0 then 'refused' end,
                              case when temperature > max_temperature then 'warm' end,
                              case when not_measured then 'not_measured' end], null) as issues
      from per
    union all
    select sku, name, expected, 0, 0, null, null, null, array['short'] from missing
  )
  select jsonb_build_object(
    'id', g.id, 'number', g.number, 'status', g.status, 'date', g.receipt_date, 'done_at', g.done_at,
    'vendor', (select name from public.business_partners where id = g.vendor_id),
    'vendor_tax', (select tax_number from public.business_partners where id = g.vendor_id),
    'order', (select number from public.purchase_orders where id = g.purchase_order_id),
    'delivery_note', g.vendor_delivery_note, 'driver_name', g.driver_name,
    'warehouse', (select name from public.warehouses where id = g.warehouse_id),
    'received_by', app.person_name(coalesce(g.received_by, g.created_by)),
    'company', (select name from public.companies where id = g.company_id),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('sku', sku, 'name', name, 'expected', expected, 'accepted', accepted, 'refused', refused,
               'reason', reason, 'temperature', temperature, 'max_temperature', max_temperature, 'issues', to_jsonb(issues)) order by cardinality(issues) desc, sku)
               from rows), '[]'::jsonb),
    'issues', (select count(*) from rows where cardinality(issues) > 0)));
end $$;

revoke execute on function app.check_problems(jsonb, jsonb), app.tg_receipt_line_temperature() from public, anon, authenticated;
revoke execute on function public.store_checklist_save(jsonb), public.store_checklist_delete(uuid), public.store_checklists_defaults(uuid),
  public.store_checks_day(uuid, uuid, date), public.store_check_submit(uuid, uuid, date, jsonb, text, boolean), public.store_check_sign(uuid),
  public.store_checks_history(uuid, uuid, date, date), public.receipt_report(uuid) from public, anon;
grant execute on function public.store_checklist_save(jsonb), public.store_checklist_delete(uuid), public.store_checklists_defaults(uuid),
  public.store_checks_day(uuid, uuid, date), public.store_check_submit(uuid, uuid, date, jsonb, text, boolean), public.store_check_sign(uuid),
  public.store_checks_history(uuid, uuid, date, date), public.receipt_report(uuid) to authenticated;
