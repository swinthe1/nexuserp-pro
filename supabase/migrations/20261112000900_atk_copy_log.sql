-- =============================================================================
-- DrisPRO · 20261112000900 · A copy of a fiscal coupon is written into the SEF log
-- Kërkesat, neni 25.18: a copy of the original coupon may be printed at any time, marked "KOPJE E KUPONIT";
-- neni 25.5.3: the system keeps audit logs of the users' actions. Every copy printed is a row of the log:
-- which coupon, who, when, and which copy it is (first, second…). The row is in the hash chain like the rest.
-- =============================================================================
alter table public.atk_events drop constraint if exists atk_events_kind_check;
alter table public.atk_events add constraint atk_events_kind_check
  check (kind in ('started', 'offline', 'online', 'clock', 'sent', 'failed', 'change', 'gap', 'stuck', 'copy'));
create index if not exists atk_events_copy_order on public.atk_events ((details ->> 'order_id')) where kind = 'copy';

-- a copy was printed: returns which copy of that coupon it is
create or replace function public.atk_copy_printed(p_order uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare o public.pos_orders; n integer;
begin
  select * into o from public.pos_orders where id = p_order;
  if o.id is null or not app.has_permission(o.company_id, 'pos.read') then raise exception 'Receipt not found' using errcode = 'P0002'; end if;
  if coalesce(o.atk ->> 'details', '') = '' then return 0; end if;   -- not a fiscal coupon: nothing for the SEF log
  perform pg_advisory_xact_lock(hashtext('atk_copy:' || p_order::text));
  select count(*) + 1 into n from public.atk_events e where e.company_id = o.company_id and e.kind = 'copy' and e.details ->> 'order_id' = p_order::text;
  insert into public.atk_events (company_id, register_id, kind, at, coupon_no, amount, details)
  values (o.company_id, o.register_id, 'copy', now(), nullif(o.atk ->> 'coupon_id', '')::bigint, o.total,
          jsonb_strip_nulls(jsonb_build_object('order_id', p_order, 'number', o.number, 'copy_no', n,
            'by', (select p.full_name from public.profiles p where p.id = auth.uid()))));
  return n;
end $$;
revoke execute on function public.atk_copy_printed(uuid) from public, anon;
grant execute on function public.atk_copy_printed(uuid) to authenticated;

-- how many copies each coupon of a shift has had
create or replace function public.atk_copy_counts(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.pos_sessions;
begin
  select * into s from public.pos_sessions where id = p_session;
  if s.id is null or not app.has_permission(s.company_id, 'pos.read') then raise exception 'Shift not found' using errcode = 'P0002'; end if;
  return coalesce((select jsonb_object_agg(x.order_id, x.n) from (
    select e.details ->> 'order_id' as order_id, count(*) as n from public.atk_events e
     where e.company_id = s.company_id and e.kind = 'copy'
       and e.details ->> 'order_id' in (select o.id::text from public.pos_orders o where o.session_id = p_session)
     group by 1) x), '{}'::jsonb);
end $$;
revoke execute on function public.atk_copy_counts(uuid) from public, anon;
grant execute on function public.atk_copy_counts(uuid) to authenticated;
