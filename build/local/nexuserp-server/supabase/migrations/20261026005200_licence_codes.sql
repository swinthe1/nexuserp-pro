-- =============================================================================
-- NexusERP Pro · licence codes: cloud or the client's own server
--   Each client's licence gets a code (NXS-XXXX-XXXX-XXXX). The NexusERP program asks for it on its
--   first start (licence_activate) and then works with our cloud or with a server of the client.
--   A local server checks its licence here every night (licence_check): plan, users, dates,
--   suspended or not, and applies it to its own database (app.apply_licence). The first local
--   server that uses a code keeps it; another one needs the platform owner to free the code.
-- =============================================================================

alter table public.licenses
  add column code            text unique,
  add column deployment      text not null default 'any' check (deployment in ('any', 'cloud', 'local')),
  add column local_server_id uuid,
  add column local_seen_at   timestamptz,
  add column local_url       text,
  add column local_version   text;
-- on a local server: the code of the licence this company follows
alter table public.companies add column licence_code text;

create or replace function app.new_licence_code()
returns text language plpgsql volatile set search_path = '' as $$
declare a text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; s text := 'NXS'; i int;
begin
  for i in 1..12 loop
    if i % 4 = 1 then s := s || '-'; end if;
    s := s || substr(a, 1 + floor(random() * length(a))::int, 1);
  end loop;
  return s;
end $$;

-- the platform owner: the code of a client's licence (made the first time), where it may run, the local server seen
create or replace function public.platform_licence_info(p_company uuid, p_deployment text default null, p_free_server boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.licenses;
begin
  perform app.require_super_admin();
  update public.licenses set code = coalesce(code, app.new_licence_code()),
         deployment = coalesce(nullif(p_deployment, ''), deployment),
         local_server_id = case when p_free_server then null else local_server_id end,
         local_url = case when p_free_server then null else local_url end,
         updated_at = now(), updated_by = auth.uid()
   where company_id = p_company
  returning * into l;
  if l.company_id is null then raise exception 'This client has no licence yet' using errcode = 'P0002'; end if;
  return jsonb_build_object('code', l.code, 'deployment', l.deployment, 'local_server', l.local_server_id is not null,
                            'local_seen_at', l.local_seen_at, 'local_url', l.local_url, 'local_version', l.local_version);
end $$;
revoke execute on function public.platform_licence_info(uuid, text, boolean) from public, anon;
grant execute on function public.platform_licence_info(uuid, text, boolean) to authenticated;

create or replace function app.licence_payload(l public.licenses)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'code', l.code, 'deployment', l.deployment,
    'plan', l.plan, 'max_users', l.max_users, 'valid_from', l.valid_from, 'valid_until', l.valid_until, 'status', l.status,
    'extra_features', to_jsonb(l.extra_features), 'max_warehouses', l.max_warehouses,
    'company', (select jsonb_build_object('name', c.name, 'legal_name', c.legal_name, 'tax_number', c.tax_number, 'country', c.country_code)
                  from public.companies c where c.id = l.company_id))
$$;
revoke execute on function app.licence_payload(public.licenses) from public, anon, authenticated;

-- the program on its first start: is the code good, whose is it, and may it run in the cloud or locally
create or replace function public.licence_activate(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.licenses;
begin
  select * into l from public.licenses where code = upper(btrim(p_code));
  if l.company_id is null then raise exception 'This licence code is not known' using errcode = 'P0002'; end if;
  if l.status <> 'active' or current_date not between l.valid_from and l.valid_until then
    raise exception 'This licence is not active; ask your NexusERP supplier' using errcode = '42501';
  end if;
  return app.licence_payload(l);
end $$;
revoke execute on function public.licence_activate(text) from public;
grant execute on function public.licence_activate(text) to anon, authenticated;

-- a local server, every night: its licence as it stands now; the first server keeps the code
create or replace function public.licence_check(p_code text, p_server uuid, p_url text default null, p_version text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.licenses;
begin
  select * into l from public.licenses where code = upper(btrim(p_code)) for update;
  if l.company_id is null then raise exception 'This licence code is not known' using errcode = 'P0002'; end if;
  if l.deployment = 'cloud' then raise exception 'This licence is for the cloud only' using errcode = '42501'; end if;
  if l.local_server_id is not null and l.local_server_id <> p_server then
    raise exception 'This licence is used by another server; ask your NexusERP supplier to move it' using errcode = '42501';
  end if;
  update public.licenses set local_server_id = p_server, local_seen_at = now(), local_url = nullif(btrim(p_url), ''), local_version = nullif(btrim(p_version), '')
   where company_id = l.company_id returning * into l;
  return app.licence_payload(l);
end $$;
revoke execute on function public.licence_check(text, uuid, text, text) from public;
grant execute on function public.licence_check(text, uuid, text, text) to anon, authenticated;

-- on the local server: the licence from the cloud applied here (company made the first time, owned by the local admin)
create or replace function app.apply_licence(p jsonb, p_admin_email text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_co uuid; v_owner uuid;
begin
  if not coalesce((p ->> 'ok')::boolean, false) then raise exception 'No licence to apply' using errcode = '22023'; end if;
  select id into v_co from public.companies where licence_code = p ->> 'code' and deleted_at is null;
  if v_co is null then
    select id into v_owner from auth.users where lower(email) = lower(btrim(p_admin_email));
    if v_owner is null then raise exception 'The administrator % does not exist on this server', p_admin_email using errcode = 'P0002'; end if;
    v_co := app.create_company_core(v_owner, p -> 'company' ->> 'name', coalesce(p -> 'company' ->> 'country', 'XK'), null,
                                    p -> 'company' ->> 'tax_number', p -> 'company' ->> 'legal_name');
    update public.companies set licence_code = p ->> 'code' where id = v_co;
  end if;
  insert into public.licenses as l (company_id, plan, max_users, valid_from, valid_until, status, extra_features, max_warehouses, code, deployment)
  values (v_co, p ->> 'plan', (p ->> 'max_users')::int, (p ->> 'valid_from')::date, (p ->> 'valid_until')::date, p ->> 'status',
          coalesce(array(select jsonb_array_elements_text(p -> 'extra_features')), '{}'), nullif(p ->> 'max_warehouses', '')::int, p ->> 'code', 'local')
  on conflict (company_id) do update set plan = excluded.plan, max_users = excluded.max_users, valid_from = excluded.valid_from,
    valid_until = excluded.valid_until, status = excluded.status, extra_features = excluded.extra_features,
    max_warehouses = excluded.max_warehouses, code = excluded.code, updated_at = now();
  return v_co;
end $$;
revoke execute on function app.apply_licence(jsonb, text) from public, anon, authenticated;
