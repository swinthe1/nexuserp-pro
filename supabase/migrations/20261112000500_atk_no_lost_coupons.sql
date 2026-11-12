-- =============================================================================
-- DrisPRO · 20261112000500 · no fiscal coupon gets lost on the way (Kërkesat, neni 25.5 and 26.4)
--
-- A coupon made without internet waits on the till, signed and numbered. Three things make a coupon that
-- never arrives visible instead of silent:
--   · the till's coupon numbers run one after another, so a number that never arrived leaves a gap: the server
--     writes the gap into the SEF log the moment a later coupon comes in, and lists the missing numbers;
--   · a coupon the server could not take (the sale was refused) is written into the log with what was signed,
--     so its trace is on the server even if the device is lost afterwards;
--   · a fiscal sale cannot be thrown away from the till's queue (the program no longer offers it).
-- =============================================================================
alter table public.atk_events drop constraint if exists atk_events_kind_check;
alter table public.atk_events add constraint atk_events_kind_check
  check (kind in ('started', 'offline', 'online', 'clock', 'sent', 'failed', 'change', 'gap', 'stuck'));

-- a later number arrived while earlier ones are missing
create or replace function app.tg_atk_gap() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_seq bigint := nullif(new.atk ->> 'seq', '')::bigint; v_prev bigint;
begin
  if v_seq is null then return new; end if;
  select max((o.atk ->> 'seq')::bigint) into v_prev from public.pos_orders o
   where o.register_id = new.register_id and o.id <> new.id and o.atk ->> 'env' = new.atk ->> 'env'
     and (o.atk ->> 'pos_id') = (new.atk ->> 'pos_id') and (o.atk ->> 'branch_id') = (new.atk ->> 'branch_id') and (o.atk ->> 'seq')::bigint < v_seq;
  if v_prev is not null and v_seq > v_prev + 1
     and not exists (select 1 from public.pos_orders o where o.register_id = new.register_id and o.id <> new.id and o.atk ->> 'env' = new.atk ->> 'env'
                        and (o.atk ->> 'pos_id') = (new.atk ->> 'pos_id') and (o.atk ->> 'seq')::bigint between v_prev + 1 and v_seq - 1) then
    insert into public.atk_events (company_id, register_id, kind, at, coupon_no, details)
    values (new.company_id, new.register_id, 'gap', now(), nullif(new.atk ->> 'coupon_id', '')::bigint,
            jsonb_build_object('env', new.atk ->> 'env', 'from', v_prev + 1, 'to', v_seq - 1, 'missing', v_seq - v_prev - 1));
  end if;
  return new;
end $$;
drop trigger if exists trg_atk_gap on public.pos_orders;
create trigger trg_atk_gap after insert on public.pos_orders for each row when (new.atk is not null) execute function app.tg_atk_gap();

-- the numbers missing right now, till by till (a number that arrives late leaves the list by itself)
create or replace function public.atk_missing_numbers(p_company uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.atk_can(p_company, 'read') then raise exception 'You cannot see the SEF log' using errcode = '42501'; end if;
  return coalesce((
    with s as (
      select o.register_id, o.atk ->> 'env' as env, (o.atk ->> 'seq')::bigint as seq
        from public.pos_orders o where o.company_id = p_company and o.atk is not null and (o.atk ->> 'seq') ~ '^[0-9]+$'),
    g as (
      select register_id, env, seq, lag(seq) over (partition by register_id, env order by seq) as prev from s)
    select jsonb_agg(jsonb_build_object('register_id', g.register_id, 'till', r.name, 'env', g.env, 'from', g.prev + 1, 'to', g.seq - 1, 'missing', g.seq - g.prev - 1)
                     order by r.name, g.prev)
      from g join public.pos_registers r on r.id = g.register_id
     where g.prev is not null and g.seq > g.prev + 1), '[]'::jsonb);
end $$;
revoke execute on function public.atk_missing_numbers(uuid) from public, anon;
grant execute on function public.atk_missing_numbers(uuid) to authenticated;

-- a signed coupon whose sale the server refused: its trace goes into the log, once
create or replace function public.atk_report_stuck(p_register uuid, p_fiscal jsonb, p_error text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.pos_registers; v_no bigint := nullif(p_fiscal ->> 'coupon_id', '')::bigint;
begin
  select * into r from public.pos_registers where id = p_register;
  if r.id is null or not app.has_permission(r.company_id, 'pos.write') then raise exception 'Not your till' using errcode = '42501'; end if;
  if v_no is null or coalesce(p_fiscal ->> 'details', '') !~ '^[A-Za-z0-9+/=]+$' or length(p_fiscal ->> 'details') not between 8 and 60000 then return; end if;
  if exists (select 1 from public.atk_events e where e.company_id = r.company_id and e.kind = 'stuck' and e.coupon_no = v_no)
     or exists (select 1 from public.pos_orders o where o.company_id = r.company_id and (o.atk ->> 'coupon_id')::bigint = v_no) then return; end if;
  insert into public.atk_events (company_id, register_id, kind, at, coupon_no, amount, details)
  values (r.company_id, r.id, 'stuck', now(), v_no, round(nullif(p_fiscal ->> 'total', '')::numeric / 100, 2),
          jsonb_strip_nulls(jsonb_build_object('env', p_fiscal ->> 'env', 'seq', p_fiscal ->> 'seq', 'error', left(p_error, 300),
            'verification_no', left(p_fiscal ->> 'verification_no', 16), 'coupon_payload', p_fiscal ->> 'details', 'signature', left(p_fiscal ->> 'signature', 200))));
end $$;
revoke execute on function public.atk_report_stuck(uuid, jsonb, text) from public, anon;
grant execute on function public.atk_report_stuck(uuid, jsonb, text) to authenticated;
