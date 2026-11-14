-- =============================================================================
-- The platform enters a client's local server. A client on its own server keeps its books there, not in the
-- cloud: "Open the company" opens that server through its outside address and signs the Super Admin in there.
--   the cloud gives a ticket (2 minutes, used once, for that client only)  →  the page opens
--   https://<name>.drispro.com/login#ticket=…  →  the local server's worker asks the cloud whether the ticket is
--   good (with its licence and server id)  →  it signs the Super Admin in on that server, as platform administrator.
-- =============================================================================

-- ----------------------------------------------------------------------------- in the cloud
create table if not exists app.support_tickets (
  id          uuid primary key default gen_random_uuid(),
  secret_hash text not null,
  company_id  uuid not null references public.companies (id) on delete cascade,
  admin_id    uuid not null,
  email       text not null,
  name        text,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '2 minutes',
  used_at     timestamptz
);
revoke all on app.support_tickets from public, anon, authenticated;

-- where a client keeps its books: a local server (with its outside address) or the cloud
create or replace function public.platform_local_ticket(p_company uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.licenses; tn app.local_tunnels; v_secret text := encode(extensions.gen_random_bytes(24), 'hex'); v_id uuid;
begin
  perform app.require_super_admin();
  select * into l from public.licenses where company_id = p_company;
  if l.company_id is null or l.local_server_id is null or l.deployment = 'cloud' then return jsonb_build_object('local', false); end if;
  select * into tn from app.local_tunnels where company_id = p_company;
  if tn.company_id is null or tn.status <> 'ready' then
    raise exception 'This client works on its own server and it has no outside address yet' using errcode = 'P0002';
  end if;
  delete from app.support_tickets where expires_at < now() - interval '1 day';
  insert into app.support_tickets (secret_hash, company_id, admin_id, email, name)
  values (encode(extensions.digest(v_secret, 'sha256'), 'hex'), p_company, auth.uid(), (select email from auth.users where id = auth.uid()),
          (select full_name from public.profiles where id = auth.uid()))
  returning id into v_id;
  perform app.platform_log('local_entry', p_company, jsonb_build_object('hostname', tn.hostname));
  return jsonb_build_object('local', true, 'url', 'https://' || tn.hostname || '/login#ticket=' || v_id || '.' || v_secret);
end $$;
revoke execute on function public.platform_local_ticket(uuid) from public, anon;
grant execute on function public.platform_local_ticket(uuid) to authenticated;

-- the local server asks whether a ticket is good: once, in time, for its own client
create or replace function public.licence_support_ticket(p_code text, p_server uuid, p_ticket text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.licenses; tk app.support_tickets; v_id uuid;
begin
  l := app.backup_licence(p_code, p_server);
  begin v_id := split_part(coalesce(p_ticket, ''), '.', 1)::uuid; exception when others then raise exception 'This entry is not valid' using errcode = '42501'; end;
  select * into tk from app.support_tickets where id = v_id for update;
  if tk.id is null or tk.company_id <> l.company_id or tk.used_at is not null or tk.expires_at < now()
     or tk.secret_hash <> encode(extensions.digest(split_part(p_ticket, '.', 2), 'sha256'), 'hex') then
    raise exception 'This entry is not valid or has run out; open the company again from the Platform' using errcode = '42501';
  end if;
  update app.support_tickets set used_at = now() where id = tk.id;
  return jsonb_build_object('email', tk.email, 'name', tk.name);
end $$;
revoke execute on function public.licence_support_ticket(text, uuid, text) from public;
grant execute on function public.licence_support_ticket(text, uuid, text) to anon, authenticated;

-- ----------------------------------------------------------------------------- on the local server
create table if not exists app.support_logins (
  id          uuid primary key default gen_random_uuid(),
  ticket      text not null,
  secret_hash text not null,
  status      text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'taken')),
  email       text,
  otp         text,
  company_id  uuid,
  error       text,
  created_at  timestamptz not null default now()
);
revoke all on app.support_logins from public, anon, authenticated;

-- the page asks to be signed in with the ticket it was opened with
create or replace function public.support_login_start(p_ticket text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_secret text := encode(extensions.gen_random_bytes(18), 'hex'); v_id uuid;
begin
  if coalesce(length(p_ticket), 0) < 40 then raise exception 'This entry is not valid' using errcode = '42501'; end if;
  delete from app.support_logins where created_at < now() - interval '1 hour';
  if (select count(*) from app.support_logins where created_at > now() - interval '10 minutes') >= 30 then
    raise exception 'Too many entries asked; wait a little and try again' using errcode = '42501';
  end if;
  insert into app.support_logins (ticket, secret_hash) values (left(p_ticket, 200), encode(extensions.digest(v_secret, 'sha256'), 'hex')) returning id into v_id;
  return jsonb_build_object('request', v_id, 'secret', v_secret);
end $$;
revoke execute on function public.support_login_start(text) from public;
grant execute on function public.support_login_start(text) to anon, authenticated;

create or replace function public.support_login_result(p_request uuid, p_secret text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r app.support_logins;
begin
  select * into r from app.support_logins where id = p_request for update;
  if r.id is null or r.secret_hash <> encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex') then return jsonb_build_object('status', 'failed'); end if;
  if r.status = 'done' then
    update app.support_logins set status = 'taken', otp = null where id = r.id;
    return jsonb_build_object('status', 'done', 'email', r.email, 'otp', r.otp, 'company_id', r.company_id);
  end if;
  return jsonb_build_object('status', r.status, 'error', r.error);
end $$;
revoke execute on function public.support_login_result(uuid, text) from public;
grant execute on function public.support_login_result(uuid, text) to anon, authenticated;

-- the worker takes one, asks the cloud, makes the Super Admin here and gives the page its sign-in
create or replace function public.support_login_wait()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r app.support_logins;
begin
  if auth.uid() is not null then raise exception 'Only the server runs this' using errcode = '42501'; end if;
  select * into r from app.support_logins where status = 'queued' and created_at > now() - interval '2 minutes' order by created_at limit 1 for update skip locked;
  if r.id is null then return null; end if;
  update app.support_logins set status = 'running' where id = r.id;
  return jsonb_build_object('id', r.id, 'ticket', r.ticket);
end $$;
revoke execute on function public.support_login_wait() from public, anon, authenticated;
grant execute on function public.support_login_wait() to service_role;

create or replace function public.support_login_user(p_id uuid, p_code text, p_email text, p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_company uuid;
begin
  if auth.uid() is not null then raise exception 'Only the server runs this' using errcode = '42501'; end if;
  v_company := coalesce((select company_id from public.licenses where code = upper(btrim(p_code))),
                        (select id from public.companies where licence_code = upper(btrim(p_code)) and deleted_at is null limit 1));
  if v_company is null then raise exception 'This licence code is not known' using errcode = 'P0002'; end if;
  v_user := app.create_auth_user(p_email, encode(extensions.gen_random_bytes(24), 'hex'), coalesce(nullif(p_name, ''), 'DrisPRO'));
  update public.profiles set is_super_admin = true, full_name = coalesce(nullif(full_name, ''), nullif(p_name, ''), 'DrisPRO') where id = v_user;
  update app.support_logins set email = lower(btrim(p_email)), company_id = v_company where id = p_id;
  return jsonb_build_object('email', lower(btrim(p_email)), 'company_id', v_company);
end $$;
revoke execute on function public.support_login_user(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.support_login_user(uuid, text, text, text) to service_role;

create or replace function public.support_login_done(p_id uuid, p_ok boolean, p_otp text default null, p_error text default null)
returns void language sql security definer set search_path = '' as $$
  update app.support_logins set status = case when p_ok then 'done' else 'failed' end, otp = p_otp, error = left(p_error, 300)
   where id = p_id and status = 'running' and auth.uid() is null
$$;
revoke execute on function public.support_login_done(uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.support_login_done(uuid, boolean, text, text) to service_role;

notify pgrst, 'reload schema';
