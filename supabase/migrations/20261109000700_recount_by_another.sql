-- =============================================================================
-- DrisPRO · counting: a line sent back is counted again by someone else (9.11.2026)
--   The person who counted a line the first time does not confirm their own mistake: when a manager sends lines
--   back, they choose "someone else" (anyone but those who counted it) or a named person, who gets a task.
--   The rule holds wherever a quantity is written: the scan, the typed quantity, Excel and counting together.
-- =============================================================================
alter table public.cycle_count_lines add column if not exists recount_by uuid;
alter table public.cycle_count_lines add column if not exists recount_not uuid[];
do $$ begin
  alter table public.cycle_count_lines add constraint cycle_count_lines_recount_by_fkey
    foreign key (recount_by) references public.profiles(id) deferrable initially immediate;
exception when duplicate_object then null; end $$;
comment on column public.cycle_count_lines.recount_by is 'The person who must count the line again (null: anyone allowed)';
comment on column public.cycle_count_lines.recount_not is 'The people who counted the line before it was sent back: they may not count it again';

-- the people who may count in this unit (for choosing who counts again)
create or replace function public.count_people(p_count uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.cycle_counts;
begin
  select * into c from public.cycle_counts where id = p_count and deleted_at is null;
  if c.id is null then raise exception 'Count not found' using errcode = 'P0002'; end if;
  perform app.require_any_permission(c.company_id, array['wms.read', 'inventory.read']);
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(p.full_name, p.email)) order by coalesce(p.full_name, p.email))
    from public.company_members m join public.profiles p on p.id = m.user_id
   where m.company_id = c.company_id and m.status = 'active' and m.deleted_at is null
     and (m.warehouse_ids is null or cardinality(m.warehouse_ids) = 0 or c.warehouse_id = any (m.warehouse_ids))
     and app.has_permission_of(m.user_id, c.company_id, 'wms.write')), '[]'::jsonb);
end $$;
revoke execute on function public.count_people(uuid) from public, anon;
grant execute on function public.count_people(uuid) to authenticated;

drop function if exists public.count_recount(uuid, numeric, numeric, uuid[]);
create or replace function public.count_recount(p_id uuid, p_min_value numeric default null, p_min_pct numeric default null, p_lines uuid[] default null,
                                                p_person uuid default null, p_other boolean default false)
returns int language plpgsql security definer set search_path = '' as $$
declare c public.cycle_counts; v_review jsonb; v_ids uuid[]; v_n int; v_who text; v_strict boolean := p_other or p_person is not null;
begin
  select * into c from public.cycle_counts where id = p_id and deleted_at is null for update;
  if c.id is null then raise exception 'Count not found' using errcode = 'P0002'; end if;
  perform app.require_permission(c.company_id, 'wms.write');
  if c.status <> 'review' then raise exception 'Only a count waiting for review can be sent back' using errcode = '55000'; end if;
  if p_lines is not null then
    v_ids := p_lines;
  else
    if p_min_value is null and p_min_pct is null then raise exception 'Say how big a difference must be: a value or a percent' using errcode = '23514'; end if;
    v_review := public.count_review(p_id);
    select array_agg((l ->> 'id')::uuid) into v_ids from jsonb_array_elements(v_review -> 'lines') l
     where (p_min_value is not null and abs((l ->> 'value')::numeric) >= p_min_value)
        or (p_min_pct is not null and (l ->> 'pct') is not null and abs((l ->> 'pct')::numeric) >= p_min_pct)
        or (p_min_pct is not null and (l ->> 'pct') is null);
  end if;
  v_ids := array(select l.id from public.cycle_count_lines l where l.cycle_count_id = c.id and l.id = any (coalesce(v_ids, '{}')));

  if p_person is not null then
    if not exists (select 1 from public.company_members m where m.company_id = c.company_id and m.user_id = p_person and m.status = 'active' and m.deleted_at is null)
       or not app.has_permission_of(p_person, c.company_id, 'wms.write') then
      raise exception 'This person may not count stock in this company' using errcode = '23514';
    end if;
    select string_agg(distinct coalesce(p.full_name, p.email), ', ') into v_who
      from public.cycle_count_lines l
      left join public.cycle_count_entries e on e.line_id = l.id
      join public.profiles p on p.id = coalesce(e.user_id, l.counted_by)
     where l.id = any (v_ids) and p.id = p_person;
    if v_who is null and exists (select 1 from public.cycle_count_lines l where l.id = any (v_ids) and p_person = any (coalesce(l.recount_not, '{}'))) then
      v_who := (select coalesce(full_name, email) from public.profiles where id = p_person);
    end if;
    if v_who is not null then
      raise exception '% counted these lines the first time: choose someone else to count them again', v_who using errcode = '23514';
    end if;
  end if;

  -- who counted each line before (the line's counter and, counting together, everyone with an entry): kept before the entries go
  update public.cycle_count_lines l
     set recount_not = case when v_strict then
           array(select distinct u from unnest(array[l.counted_by] || coalesce((select array_agg(e.user_id) from public.cycle_count_entries e where e.line_id = l.id), '{}')
                                        || coalesce(l.recount_not, '{}')) u where u is not null)
         end,
         recount_by = p_person
   where l.id = any (v_ids);
  update public.cycle_count_lines
     set first_counted_qty = coalesce(first_counted_qty, counted_qty), counted_qty = null, recount = true, counted_by = null, counted_at = null
   where cycle_count_id = c.id and id = any (v_ids);
  get diagnostics v_n = row_count;
  if v_n > 0 then
    update public.cycle_counts set status = 'in_progress' where id = c.id;
    if p_person is not null then
      perform app.auto_task(c.company_id, 'recount:' || c.id || ':' || p_person || ':' || floor(extract(epoch from clock_timestamp()))::bigint,
        'Rinumëro ' || v_n || case when v_n = 1 then ' rresht' else ' rreshta' end || ' te ' || c.number,
        p_person, current_date, 2::smallint, 'cycle_counts', c.id, c.number,
        'Këto rreshta i ka numëruar dikush tjetër dhe kanë diferencë. Numërojini vetë, pa e pyetur se sa gjeti ai.');
    end if;
  end if;
  return v_n;
end $$;
revoke execute on function public.count_recount(uuid, numeric, numeric, uuid[], uuid, boolean) from public, anon;
grant execute on function public.count_recount(uuid, numeric, numeric, uuid[], uuid, boolean) to authenticated;

-- the rule, wherever a quantity is written
create or replace function app.recount_check(p_company uuid, p_recount_by uuid, p_recount_not uuid[], p_user uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if p_user is null then return; end if;
  if p_user = any (coalesce(p_recount_not, '{}')) then
    raise exception 'You counted this line the first time: someone else counts it again' using errcode = '42501';
  end if;
  if p_recount_by is not null and p_user <> p_recount_by and not app.has_permission_of(p_user, p_company, 'inventory.write') then
    raise exception 'This line is counted again by %', (select coalesce(full_name, email) from public.profiles where id = p_recount_by) using errcode = '42501';
  end if;
end $$;
revoke execute on function app.recount_check(uuid, uuid, uuid[], uuid) from public, anon, authenticated;

create or replace function app.tg_recount_line_guard() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.recount and new.counted_qty is not null and (new.recount_by is not null or new.recount_not is not null)
     and (old.counted_qty is distinct from new.counted_qty or old.counted_by is distinct from new.counted_by) then
    perform app.recount_check(new.company_id, new.recount_by, new.recount_not, coalesce(new.counted_by, auth.uid()));
  end if;
  return new;
end $$;
drop trigger if exists trg_06_recount_guard on public.cycle_count_lines;
create trigger trg_06_recount_guard before update of counted_qty, counted_by on public.cycle_count_lines
  for each row execute function app.tg_recount_line_guard();

create or replace function app.tg_recount_entry_guard() returns trigger language plpgsql security definer set search_path = '' as $$
declare l public.cycle_count_lines;
begin
  select * into l from public.cycle_count_lines where id = new.line_id;
  if l.recount and (l.recount_by is not null or l.recount_not is not null) then
    perform app.recount_check(l.company_id, l.recount_by, l.recount_not, new.user_id);
  end if;
  return new;
end $$;
drop trigger if exists trg_06_recount_guard on public.cycle_count_entries;
create trigger trg_06_recount_guard before insert or update of quantity, user_id on public.cycle_count_entries
  for each row execute function app.tg_recount_entry_guard();

-- the task to count again closes when the count goes to review
create or replace function app.tg_count_done_tasks()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('review', 'posted', 'cancelled') and old.status is distinct from new.status then
    update public.tasks set status = 'done', completed_at = now()
     where company_id = new.company_id and (auto_key = 'daily_count:' || new.id or auto_key like 'recount:' || new.id || ':%')
       and status not in ('done', 'cancelled') and deleted_at is null;
  end if;
  return null;
end $$;
