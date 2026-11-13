-- =============================================================================
-- A local server is reached from outside by itself: every server with a licence gets its own address,
-- https://<name>.dris-ks.com, through a Cloudflare tunnel, made by the cloud with no step at the shop.
--
--   the local server asks (licence_tunnel, with its licence and server id, at the install and every night)
--   → the cloud's worker makes the tunnel, its address and its route (postier_tunnel_claim / _done)
--   → the next ask hands the server its tunnel key; the server starts the tunnel and is reachable.
-- The platform sees every address, and turns one off (the tunnel and its address are removed) or on.
-- Cloudflare's key, account and zone are kept in app.server_secrets (update.sh --cloudflare), never shown.
-- =============================================================================

create table if not exists app.local_tunnels (
  company_id   uuid primary key references public.companies (id) on delete cascade deferrable initially immediate,
  licence_code text not null,
  server_id    uuid not null,
  hostname     text not null unique check (hostname ~ '^[a-z0-9][a-z0-9-]{1,40}[a-z0-9]\.[a-z0-9.-]+$'),
  status       text not null default 'requested' check (status in ('requested', 'ready', 'failed', 'remove', 'off')),
  tunnel_id    text,
  token        text,
  error        text,
  attempts     int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
revoke all on app.local_tunnels from public, anon, authenticated;

-- a name for the address from the company's name: "Lider Market SH.P.K." → lider-market
create or replace function app.tunnel_slug(p_name text, p_company uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v text; v_base text; i int := 1;
  v_domain text := coalesce((select value from app.server_secrets where key = 'cf_domain'), 'dris-ks.com');
begin
  v_base := translate(lower(coalesce(p_name, '')), 'çëéèêáàâäãöóòôüúùûïíìîšžćčđñ', 'ceeeeaaaaaoooouuuuiiiiszccdn');
  v_base := regexp_replace(v_base, '\m(sh\.?p\.?k|l\.?l\.?c|d\.?o\.?o|sh\.?a|n\.?p\.?sh)\M\.?', '', 'g');
  v_base := trim(both '-' from regexp_replace(v_base, '[^a-z0-9]+', '-', 'g'));
  v_base := left(v_base, 36);
  v_base := trim(both '-' from v_base);
  if length(v_base) < 3 or v_base in ('erp', 'api', 'www', 'app', 'mail', 'admin', 'platform', 'status', 'demo', 'test', 'cdn', 'ftp', 'smtp') then
    v_base := 'drispro-' || left(replace(p_company::text, '-', ''), 6);
  end if;
  v := v_base || '.' || v_domain;
  while exists (select 1 from app.local_tunnels where hostname = v and company_id <> p_company) loop
    i := i + 1; v := v_base || '-' || i || '.' || v_domain;
  end loop;
  return v;
end $$;
revoke execute on function app.tunnel_slug(text, uuid) from public, anon, authenticated;

-- the local server asks for its outside address (anonymous, with its licence and its server id)
create or replace function public.licence_tunnel(p_code text, p_server uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.licenses; t app.local_tunnels;
begin
  l := app.backup_licence(p_code, p_server);
  select * into t from app.local_tunnels where company_id = l.company_id for update;
  if t.company_id is null then
    insert into app.local_tunnels (company_id, licence_code, server_id, hostname)
    values (l.company_id, l.code, p_server, app.tunnel_slug((select name from public.companies where id = l.company_id), l.company_id))
    returning * into t;
  elsif t.server_id <> p_server then
    -- the licence moved to another server: the same address, its tunnel made again for the new one
    update app.local_tunnels set server_id = p_server, status = 'requested', token = null, attempts = 0, error = null, updated_at = now()
     where company_id = l.company_id returning * into t;
  elsif t.status = 'failed' and t.updated_at < now() - interval '1 hour' then
    update app.local_tunnels set status = 'requested', attempts = 0, updated_at = now() where company_id = l.company_id returning * into t;
  end if;
  return case t.status
    when 'ready' then jsonb_build_object('status', 'ready', 'hostname', t.hostname, 'url', 'https://' || t.hostname, 'token', t.token)
    when 'off' then jsonb_build_object('status', 'off')
    when 'remove' then jsonb_build_object('status', 'off')
    when 'failed' then jsonb_build_object('status', 'failed', 'hostname', t.hostname, 'error', t.error)
    else jsonb_build_object('status', 'pending', 'hostname', t.hostname) end;
end $$;
revoke execute on function public.licence_tunnel(text, uuid) from public;
grant execute on function public.licence_tunnel(text, uuid) to anon, authenticated;

-- the cloud's worker: what to make or remove, with Cloudflare's details
create or replace function public.postier_tunnel_claim()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then raise exception 'Only the server runs this' using errcode = '42501'; end if;
  if not exists (select 1 from app.server_secrets where key = 'cf_api_token') then return jsonb_build_object('jobs', '[]'::jsonb); end if;
  return jsonb_build_object(
    'cloudflare', jsonb_build_object(
      'token', (select value from app.server_secrets where key = 'cf_api_token'),
      'account', (select value from app.server_secrets where key = 'cf_account_id'),
      'zone', (select value from app.server_secrets where key = 'cf_zone_id')),
    'jobs', coalesce((select jsonb_agg(jsonb_build_object('company_id', t.company_id, 'hostname', t.hostname, 'status', t.status, 'tunnel_id', t.tunnel_id,
                        'name', 'drispro-' || lower(t.licence_code)) order by t.updated_at)
                      from app.local_tunnels t where t.status in ('requested', 'remove') and t.attempts < 8), '[]'::jsonb));
end $$;
revoke execute on function public.postier_tunnel_claim() from public, anon, authenticated;
grant execute on function public.postier_tunnel_claim() to service_role;

create or replace function public.postier_tunnel_done(p_company uuid, p_ok boolean, p_tunnel_id text default null, p_token text default null, p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare t app.local_tunnels;
begin
  if auth.uid() is not null then raise exception 'Only the server runs this' using errcode = '42501'; end if;
  select * into t from app.local_tunnels where company_id = p_company for update;
  if t.company_id is null then return; end if;
  if t.status = 'remove' then
    update app.local_tunnels set status = case when p_ok then 'off' else 'remove' end, tunnel_id = case when p_ok then null else tunnel_id end,
           token = null, error = left(p_error, 500), attempts = attempts + case when p_ok then 0 else 1 end, updated_at = now() where company_id = p_company;
  elsif p_ok then
    update app.local_tunnels set status = 'ready', tunnel_id = p_tunnel_id, token = p_token, error = null, attempts = 0, updated_at = now() where company_id = p_company;
    perform app.platform_log('tunnel_ready', p_company, jsonb_build_object('hostname', t.hostname));
  else
    update app.local_tunnels set attempts = attempts + 1, error = left(p_error, 500), updated_at = now(),
           status = case when attempts + 1 >= 8 then 'failed' else status end, tunnel_id = coalesce(p_tunnel_id, tunnel_id) where company_id = p_company;
  end if;
end $$;
revoke execute on function public.postier_tunnel_done(uuid, boolean, text, text, text) from public, anon, authenticated;
grant execute on function public.postier_tunnel_done(uuid, boolean, text, text, text) to service_role;

-- the platform: every outside address, and on/off
create or replace function public.platform_tunnels()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_super_admin();
  return jsonb_build_object(
    'configured', exists (select 1 from app.server_secrets where key = 'cf_api_token'),
    'tunnels', coalesce((select jsonb_agg(jsonb_build_object('company_id', t.company_id, 'company', c.name, 'hostname', t.hostname, 'status', t.status,
                 'error', t.error, 'updated_at', t.updated_at, 'local_seen_at', l.local_seen_at) order by c.name)
               from app.local_tunnels t join public.companies c on c.id = t.company_id left join public.licenses l on l.company_id = t.company_id), '[]'::jsonb));
end $$;
revoke execute on function public.platform_tunnels() from public, anon;
grant execute on function public.platform_tunnels() to authenticated;

create or replace function public.platform_tunnel_set(p_company uuid, p_on boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_super_admin();
  if p_on then
    update app.local_tunnels set status = 'requested', attempts = 0, error = null, updated_at = now() where company_id = p_company and status in ('off', 'failed', 'remove');
  else
    update app.local_tunnels set status = case when tunnel_id is null then 'off' else 'remove' end, token = null, attempts = 0, updated_at = now() where company_id = p_company;
  end if;
  perform app.platform_log(case when p_on then 'tunnel_on' else 'tunnel_off' end, p_company, '{}'::jsonb);
end $$;
revoke execute on function public.platform_tunnel_set(uuid, boolean) from public, anon;
grant execute on function public.platform_tunnel_set(uuid, boolean) to authenticated;
