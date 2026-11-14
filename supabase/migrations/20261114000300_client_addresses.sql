-- =============================================================================
-- Every client its own address: https://<name>.drispro.com. A client on its own server is reached there through
-- its tunnel; a client in the cloud is served there by the cloud. app.drispro.com is the platform's only: the
-- people of a client sign in (user name and PIN) only at their company's address, never at another's.
-- =============================================================================

create or replace function app.app_domain() returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select value from app.server_secrets where key = 'cf_domain'), 'drispro.com')
$$;
revoke execute on function app.app_domain() from public, anon, authenticated;

alter table public.companies add column if not exists app_slug text;
alter table public.companies drop constraint if exists companies_app_slug_check;
alter table public.companies add constraint companies_app_slug_check check (app_slug ~ '^[a-z0-9][a-z0-9-]{1,40}[a-z0-9]$');
create unique index if not exists companies_app_slug_key on public.companies (app_slug);

-- a name for the address from the company's name: "Lider Market SH.P.K." → lider-market (the names DrisPRO uses never)
create or replace function app.company_slug(p_name text, p_company uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v text; v_base text; i int := 1;
begin
  v_base := translate(lower(coalesce(p_name, '')), 'çëéèêáàâäãöóòôüúùûïíìîšžćčđñ', 'ceeeeaaaaaoooouuuuiiiiszccdn');
  v_base := regexp_replace(v_base, '\m(sh\.?p\.?k|l\.?l\.?c|d\.?o\.?o|sh\.?a|n\.?p\.?sh)\M\.?', '', 'g');
  v_base := trim(both '-' from regexp_replace(v_base, '[^a-z0-9]+', '-', 'g'));
  v_base := trim(both '-' from left(v_base, 36));
  if length(v_base) < 3 or v_base in ('erp', 'api', 'www', 'app', 'mail', 'admin', 'platform', 'status', 'demo', 'test', 'cdn', 'ftp', 'smtp', 'turn', 'pin',
                                      'shop', 'blog', 'help', 'docs', 'download', 'downloads', 'updates', 'drispro') then
    v_base := 'drispro-' || left(replace(p_company::text, '-', ''), 6);
  end if;
  v := v_base;
  while exists (select 1 from public.companies where app_slug = v and id <> p_company)
     or exists (select 1 from app.local_tunnels where hostname = v || '.' || app.app_domain() and company_id <> p_company) loop
    i := i + 1; v := v_base || '-' || i;
  end loop;
  return v;
end $$;
revoke execute on function app.company_slug(text, uuid) from public, anon, authenticated;

-- the addresses there are: a tunnel's name first (it is already in use), then every client with a licence
update public.companies c set app_slug = split_part(t.hostname, '.', 1)
  from app.local_tunnels t where t.company_id = c.id and c.app_slug is null;
do $$
declare r record;
begin
  for r in select c.id, c.name from public.companies c where c.app_slug is null and c.deleted_at is null
             and exists (select 1 from public.licenses l where l.company_id = c.id) order by c.created_at loop
    update public.companies set app_slug = app.company_slug(r.name, r.id) where id = r.id;
  end loop;
end $$;

-- a new client gets its address with its licence
create or replace function app.tg_licence_app_slug() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.companies set app_slug = app.company_slug(name, id) where id = new.company_id and app_slug is null;
  return new;
end $$;
drop trigger if exists trg_licence_app_slug on public.licenses;
create trigger trg_licence_app_slug after insert on public.licenses for each row execute function app.tg_licence_app_slug();

create or replace function app.company_url(p_company uuid) returns text language sql stable security definer set search_path = '' as $$
  select 'https://' || app_slug || '.' || app.app_domain() from public.companies where id = p_company and app_slug is not null
$$;
revoke execute on function app.company_url(uuid) from public, anon, authenticated;

-- a local server's tunnel is made at its company's address
create or replace function app.tunnel_slug(p_name text, p_company uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
begin
  return coalesce((select app_slug from public.companies where id = p_company), app.company_slug(p_name, p_company)) || '.' || app.app_domain();
end $$;
revoke execute on function app.tunnel_slug(text, uuid) from public, anon, authenticated;

-- the page asks whose address it is opened at (only the name: nothing else is told)
create or replace function public.company_by_host(p_host text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_host text := lower(btrim(coalesce(p_host, ''))); v_domain text := app.app_domain(); v_slug text; c public.companies;
begin
  if v_host in ('app.' || v_domain, v_domain, 'www.' || v_domain) then return jsonb_build_object('kind', 'platform'); end if;
  if v_host !~ ('^[a-z0-9-]+\.' || replace(v_domain, '.', '\.') || '$') then return jsonb_build_object('kind', 'other'); end if;
  v_slug := split_part(v_host, '.', 1);
  select * into c from public.companies where app_slug = v_slug and deleted_at is null;
  if c.id is null then return jsonb_build_object('kind', 'unknown'); end if;
  return jsonb_build_object('kind', 'client', 'name', c.name, 'slug', c.app_slug);
end $$;
revoke execute on function public.company_by_host(text) from public;
grant execute on function public.company_by_host(text) to anon, authenticated;

-- ----------------------------------------------------------------------------- signing in only at one's own address
create or replace function app.request_host() returns text language sql stable set search_path = '' as $$
  select lower(substring(coalesce(nullif(current_setting('request.headers', true), '')::jsonb ->> 'origin', '') from '^https?://([^/:]+)'))
$$;

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_def text; v_oid oid;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname || '.' || p.proname = p_name order by p.oid desc limit 1;
  if v_oid is null then raise exception 'function % not found', p_name; end if;
  v_def := pg_get_functiondef(v_oid);
  if position(p_new in v_def) > 0 then return; end if;
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply', p_name; end if;
  execute replace(v_def, p_old, p_new);
end $$;

select app._patch_function('public.login_with_pin',
  $x$  if not app.device_allows(l.user_id) then$x$,
  $x$  -- the platform's address is the platform's; a company's address lets in only that company's people
  if not coalesce((select is_super_admin from public.profiles where id = l.user_id), false) then
    if app.request_host() = 'app.' || app.app_domain() then
      return jsonb_build_object('error', 'Sign in at your company''s address', 'company_url',
        (select app.company_url(m.company_id) from public.company_members m where m.user_id = l.user_id and m.status = 'active' and m.deleted_at is null
          order by m.created_at limit 1));
    end if;
    if app.request_host() ~ ('^[a-z0-9-]+\.' || replace(app.app_domain(), '.', '\.') || '$')
       and not exists (select 1 from public.company_members m join public.companies c on c.id = m.company_id
                        where m.user_id = l.user_id and m.status = 'active' and m.deleted_at is null and c.app_slug = split_part(app.request_host(), '.', 1)) then
      return jsonb_build_object('error', 'Wrong user name or PIN');
    end if;
  end if;
  if not app.device_allows(l.user_id) then$x$);

-- the Windows program learns its company's address (activation and every check)
select app._patch_function('public.licence_activate',
  $x$  return app.licence_payload(l);$x$,
  $x$  return app.licence_payload(l) || jsonb_build_object('app_url', app.company_url(l.company_id));$x$);
select app._patch_function('public.device_ping',
  $x$  return app.device_row(d) || jsonb_build_object('channel', d.channel,$x$,
  $x$  return app.device_row(d) || jsonb_build_object('app_url', app.company_url(d.company_id), 'channel', d.channel,$x$);
-- the console shows each client's address
select app._patch_function('public.platform_clients',
  $x$'device_guard', (select l2.device_guard from public.licenses l2 where l2.company_id = c.id),$x$,
  $x$'device_guard', (select l2.device_guard from public.licenses l2 where l2.company_id = c.id), 'app_url', app.company_url(c.id),$x$);
drop function app._patch_function(text, text, text);

notify pgrst, 'reload schema';
