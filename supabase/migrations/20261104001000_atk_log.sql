-- =============================================================================
-- DrisPRO · 20261104001000 · Kosovo SEF: the log ATK checks, the server's clock, the paper width
--
-- Kërkesat specifike (neni 25.15 and "Verifikimi dhe Kontrolli"): the SEF keeps a detailed trace of
-- * every coupon sent and every failed send (date and time to the second, coupon number, total),
-- * the errors,
-- * the interruptions of the connection (a technical event when it comes back),
-- * changes made to the SEF (numbers, environment, switch, registering a till),
-- and exports it (CSV) for ATK. The log is only ever added to: nobody edits or deletes a row.
-- "Sinkronizimi i kohës": the till takes the server's time, so a device with a wrong clock still writes the right time.
-- "Letër termike 58 mm deri 100 mm": each till prints for its own paper width.
-- =============================================================================

create table if not exists public.atk_events (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references public.companies(id),
  register_id uuid references public.pos_registers(id),
  client_id   uuid,
  kind        text not null check (kind in ('started', 'offline', 'online', 'clock', 'sent', 'failed', 'change')),
  at          timestamptz not null,
  recorded_at timestamptz not null default now(),
  user_id     uuid default auth.uid(),
  coupon_no   bigint,
  amount      numeric(14, 2),
  details     jsonb not null default '{}'::jsonb
);
create unique index if not exists atk_events_client on public.atk_events (company_id, client_id) where client_id is not null;
create index if not exists atk_events_company_at on public.atk_events (company_id, at desc);

do $$ begin
  if not exists (select 1 from app.table_registry where table_name = 'atk_events') then
    perform app.register_table('public.atk_events', 'tax', p_soft_delete => false, p_client_write => false, p_immutable => true, p_audit => false, p_policies => false);
  end if;
end $$;
-- written only by the functions below; read by those who look after the tax or the tills
revoke all on public.atk_events from public, anon, authenticated;
grant select on public.atk_events to authenticated;
drop policy if exists atk_events_read on public.atk_events;
create policy atk_events_read on public.atk_events for select to authenticated using (app.atk_can(company_id, 'read'));

-- ----------------------------------------------------------------------------- what the till saw (kept on the device first, sent later)
create or replace function public.atk_log_events(p_events jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare x jsonb; r public.pos_registers; n int := 0; v_kind text; v_at timestamptz;
begin
  if jsonb_typeof(p_events) <> 'array' then raise exception 'Nothing to keep' using errcode = '22023'; end if;
  for x in select * from jsonb_array_elements(p_events) limit 500 loop
    v_kind := x ->> 'kind';
    if v_kind not in ('started', 'offline', 'online', 'clock') then continue; end if;
    select * into r from public.pos_registers where id = (x ->> 'register_id')::uuid;
    if r.id is null or not app.has_permission(r.company_id, 'pos.write') then continue; end if;
    -- the device's time, corrected by the server's clock on the till; never later than now
    v_at := least(coalesce((x ->> 'at')::timestamptz, now()), now());
    insert into public.atk_events (company_id, register_id, client_id, kind, at, details)
    values (r.company_id, r.id, (x ->> 'id')::uuid, v_kind, v_at, coalesce(x -> 'details', '{}'::jsonb) - 'register_id')
    on conflict (company_id, client_id) where client_id is not null do nothing;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.atk_log_events(jsonb) from public, anon;
grant execute on function public.atk_log_events(jsonb) to authenticated;

/** the server's time, for the till to set its clock by */
create or replace function public.server_now() returns timestamptz language sql stable set search_path = '' as $$ select clock_timestamp() $$;
revoke execute on function public.server_now() from public, anon;
grant execute on function public.server_now() to authenticated;

-- ----------------------------------------------------------------------------- every try to send a coupon to ATK
create or replace function app.tg_atk_event_send() returns trigger language plpgsql security definer set search_path = '' as $$
declare a jsonb := new.request_payload -> 'atk';
begin
  insert into public.atk_events (company_id, register_id, kind, at, user_id, coupon_no, amount, details)
  values (new.company_id, (select o.register_id from public.pos_orders o where o.id = new.source_doc_id),
          case when new.status = 'fiscalized' then 'sent' else 'failed' end, coalesce(new.last_attempt_at, now()), null,
          nullif(a ->> 'coupon_id', '')::bigint, round(nullif(a ->> 'total', '')::numeric / 100, 2),
          jsonb_strip_nulls(jsonb_build_object('env', a ->> 'env', 'attempt', new.attempt_count, 'transaction', new.fic,
                                               'error_code', new.error_code, 'error', new.error_message)));
  return new;
end $$;
drop trigger if exists trg_atk_event_send on public.fiscalization_records;
create trigger trg_atk_event_send after update of attempt_count on public.fiscalization_records
  for each row when (new.country_code = 'XK' and new.request_payload ? 'atk' and new.attempt_count > old.attempt_count)
  execute function app.tg_atk_event_send();

-- ----------------------------------------------------------------------------- changes to the SEF
create or replace function app.atk_change(p_company uuid, p_register uuid, p_what text, p_from text, p_to text) returns void
language sql security definer set search_path = '' as $$
  insert into public.atk_events (company_id, register_id, kind, at, details)
  values (p_company, p_register, 'change', now(), jsonb_strip_nulls(jsonb_build_object('what', p_what, 'from', p_from, 'to', p_to)))
$$;

create or replace function app.tg_atk_change_company() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.atk_fiscalization_no is distinct from old.atk_fiscalization_no then
    perform app.atk_change(new.company_id, null, 'fiscalization_no', old.atk_fiscalization_no, new.atk_fiscalization_no); end if;
  if new.atk_sef_enabled is distinct from old.atk_sef_enabled then
    perform app.atk_change(new.company_id, null, 'sef_enabled', old.atk_sef_enabled::text, new.atk_sef_enabled::text); end if;
  if new.fiscal_environment is distinct from old.fiscal_environment and (new.atk_sef_enabled or old.atk_sef_enabled) then
    perform app.atk_change(new.company_id, null, 'environment', old.fiscal_environment, new.fiscal_environment); end if;
  return new;
end $$;
drop trigger if exists trg_atk_change_company on public.company_settings;
create trigger trg_atk_change_company after update of atk_fiscalization_no, atk_sef_enabled, fiscal_environment on public.company_settings
  for each row execute function app.tg_atk_change_company();

create or replace function app.tg_atk_change_store() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform app.atk_change(new.company_id, null, 'store_number', coalesce(new.name, '') || ': ' || coalesce(old.atk_branch_id::text, '—'), new.atk_branch_id::text);
  return new;
end $$;
drop trigger if exists trg_atk_change_store on public.warehouses;
create trigger trg_atk_change_store after update of atk_branch_id on public.warehouses
  for each row when (new.atk_branch_id is distinct from old.atk_branch_id) execute function app.tg_atk_change_store();

create or replace function app.tg_atk_change_till() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.atk_pos_id is distinct from old.atk_pos_id then
    perform app.atk_change(new.company_id, new.id, 'till_number', old.atk_pos_id::text, new.atk_pos_id::text); end if;
  if new.atk_certificate is distinct from old.atk_certificate then
    perform app.atk_change(new.company_id, new.id, case when new.atk_certificate is null then 'till_unregistered' else 'till_registered' end,
                           null, case when new.atk_certificate is not null then new.atk_cert_env || ' · ' || coalesce(new.atk_device, '') end);
  end if;
  return new;
end $$;
drop trigger if exists trg_atk_change_till on public.pos_registers;
create trigger trg_atk_change_till after update of atk_pos_id, atk_certificate on public.pos_registers
  for each row execute function app.tg_atk_change_till();

-- ----------------------------------------------------------------------------- the paper each till prints on
alter table public.pos_registers add column if not exists paper_mm smallint not null default 80 check (paper_mm in (58, 80));
