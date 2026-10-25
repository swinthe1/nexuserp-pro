-- =============================================================================
-- DrisPRO · copies of local servers in our cloud
--   Every night a local server sends its database copy here, encrypted, into the private storage
--   bucket local-backups/<licence code>/. For that it asks a ticket with its licence code
--   (licence_backup_ticket): a key valid for one hour that can only write, list and remove files
--   in its own folder, and the encryption key of the copies (kept here, so a new server can read
--   the copies after the platform owner moves the licence to it).
--   The ticket is signed with the API's own secret, which the cloud deploy (update.sh) stores in
--   app.server_secrets; until then the function says that cloud copies are not set up.
-- =============================================================================

create table if not exists app.server_secrets (
  key   text primary key,
  value text not null
);
revoke all on app.server_secrets from public, anon, authenticated;

alter table public.licenses add column backup_key text;

create table app.local_backups (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  licence_code  text not null,
  server_id     uuid not null,
  file          text not null,
  parts         int not null,
  bytes         bigint not null,
  created_at    timestamptz not null default now()
);
create index local_backups_company_idx on app.local_backups (company_id, created_at desc);

-- a JWT signed like the API's own (HS256)
create or replace function app.b64url(p bytea)
returns text language sql immutable set search_path = '' as $$
  select translate(rtrim(replace(encode(p, 'base64'), E'\n', ''), '='), '+/', '-_')
$$;
create or replace function app.sign_jwt(p_claims jsonb)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_secret text := (select value from app.server_secrets where key = 'jwt_secret'); v_head text; v_body text;
begin
  if v_secret is null then raise exception 'Cloud copies are not set up on the cloud yet' using errcode = '55000'; end if;
  v_head := app.b64url(convert_to('{"alg":"HS256","typ":"JWT"}', 'utf8'));
  v_body := app.b64url(convert_to(p_claims::text, 'utf8'));
  return v_head || '.' || v_body || '.' || app.b64url(extensions.hmac(convert_to(v_head || '.' || v_body, 'utf8'), convert_to(v_secret, 'utf8'), 'sha256'));
end $$;
revoke execute on function app.sign_jwt(jsonb) from public, anon, authenticated;

-- the licence and its server, as licence_check accepts them
create or replace function app.backup_licence(p_code text, p_server uuid)
returns public.licenses language plpgsql security definer set search_path = '' as $$
declare l public.licenses;
begin
  select * into l from public.licenses where code = upper(btrim(p_code)) for update;
  if l.company_id is null then raise exception 'This licence code is not known' using errcode = 'P0002'; end if;
  if l.local_server_id is null or l.local_server_id <> p_server then
    raise exception 'This licence is used by another server; ask your DrisPRO supplier to move it' using errcode = '42501';
  end if;
  return l;
end $$;
revoke execute on function app.backup_licence(text, uuid) from public, anon, authenticated;

create or replace function public.licence_backup_ticket(p_code text, p_server uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.licenses; v_now bigint := extract(epoch from now())::bigint;
begin
  l := app.backup_licence(p_code, p_server);
  if l.backup_key is null then
    update public.licenses set backup_key = encode(extensions.gen_random_bytes(32), 'hex') where company_id = l.company_id returning * into l;
  end if;
  return jsonb_build_object('token', app.sign_jwt(jsonb_build_object('role', 'authenticated', 'aud', 'authenticated', 'iss', 'drispro-backup',
                                 'iat', v_now, 'exp', v_now + 3600, 'backup_licence', l.code)),
                            'key', l.backup_key, 'bucket', 'local-backups', 'folder', l.code, 'keep_days', 14);
end $$;
revoke execute on function public.licence_backup_ticket(text, uuid) from public;
grant execute on function public.licence_backup_ticket(text, uuid) to anon, authenticated;

-- a copy that arrived (all its parts); the list keeps 60 days
create or replace function public.licence_backup_done(p_code text, p_server uuid, p_file text, p_parts int, p_bytes bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare l public.licenses;
begin
  l := app.backup_licence(p_code, p_server);
  insert into app.local_backups (company_id, licence_code, server_id, file, parts, bytes) values (l.company_id, l.code, p_server, p_file, p_parts, p_bytes);
  delete from app.local_backups where company_id = l.company_id and created_at < now() - interval '60 days';
end $$;
revoke execute on function public.licence_backup_done(text, uuid, text, int, bigint) from public;
grant execute on function public.licence_backup_done(text, uuid, text, int, bigint) to anon, authenticated;

-- the platform owner: the last copies of a client's local server
create or replace function public.platform_local_backups(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_super_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('file', b.file, 'parts', b.parts, 'bytes', b.bytes, 'created_at', b.created_at) order by b.created_at desc)
                     from (select * from app.local_backups where company_id = p_company order by created_at desc limit 10) b), '[]'::jsonb);
end $$;
revoke execute on function public.platform_local_backups(uuid) from public, anon;
grant execute on function public.platform_local_backups(uuid) to authenticated;

-- the private bucket and who may use it: only the ticket of a licence, only in its own folder
do $$
begin
  if to_regclass('storage.buckets') is null then return; end if;
  insert into storage.buckets (id, name, public) values ('local-backups', 'local-backups', false) on conflict (id) do nothing;
  execute $p$create policy "local backups: own folder (insert)" on storage.objects for insert to authenticated
    with check (bucket_id = 'local-backups' and (storage.foldername(name))[1] = (auth.jwt() ->> 'backup_licence'))$p$;
  execute $p$create policy "local backups: own folder (read)" on storage.objects for select to authenticated
    using (bucket_id = 'local-backups' and (storage.foldername(name))[1] = (auth.jwt() ->> 'backup_licence'))$p$;
  execute $p$create policy "local backups: own folder (remove)" on storage.objects for delete to authenticated
    using (bucket_id = 'local-backups' and (storage.foldername(name))[1] = (auth.jwt() ->> 'backup_licence'))$p$;
end $$;

-- a ticket must not open anything else: company data is reached through my_company_ids, which a ticket
-- (no sub, no membership) never matches; the storage policies above are the only ones that read the claim.
