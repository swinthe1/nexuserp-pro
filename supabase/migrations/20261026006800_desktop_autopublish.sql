-- =============================================================================
-- DrisPRO · every new Windows program is published by itself
--   When the desktop code changes, GitHub builds the installer and hands it to the cloud with a
--   publishing key (made once by the platform owner on the Platform page and kept as a GitHub
--   secret). The key buys a one-hour ticket that may only write into the downloads bucket.
-- =============================================================================

create table app.publish_keys (
  id           uuid primary key default gen_random_uuid(),
  key_hash     text not null unique,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
revoke all on app.publish_keys from public, anon, authenticated;

-- a new key; the one before stops working
create or replace function public.platform_desktop_publish_key()
returns text language plpgsql security definer set search_path = '' as $$
declare v_key text := 'dpk_' || encode(extensions.gen_random_bytes(24), 'hex');
begin
  perform app.require_super_admin();
  update app.publish_keys set revoked_at = now() where revoked_at is null;
  insert into app.publish_keys (key_hash, created_by) values (encode(extensions.digest(v_key, 'sha256'), 'hex'), auth.uid());
  return v_key;
end $$;
grant execute on function public.platform_desktop_publish_key() to authenticated;

create or replace function public.platform_desktop_publish_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_super_admin();
  return (select jsonb_build_object('created_at', k.created_at, 'last_used_at', k.last_used_at)
            from app.publish_keys k where k.revoked_at is null order by k.created_at desc limit 1);
end $$;
grant execute on function public.platform_desktop_publish_status() to authenticated;

create or replace function app.publish_key_ok(p_key text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update app.publish_keys set last_used_at = now()
   where key_hash = encode(extensions.digest(coalesce(p_key, ''), 'sha256'), 'hex') and revoked_at is null;
  return found;
end $$;

-- the builder asks: which versions are there already, and a ticket to upload a new one
create or replace function public.desktop_publish_ticket(p_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_now bigint := extract(epoch from now())::bigint;
begin
  if not app.publish_key_ok(p_key) then raise exception 'Unknown publishing key' using errcode = '28000'; end if;
  return jsonb_build_object(
    'token', app.sign_jwt(jsonb_build_object('role', 'authenticated', 'aud', 'authenticated', 'iss', 'drispro-desktop',
                                             'iat', v_now, 'exp', v_now + 3600, 'desktop_publish', true)),
    'versions', coalesce((select jsonb_agg(version) from app.desktop_releases), '[]'::jsonb));
end $$;
revoke execute on function public.desktop_publish_ticket(text) from public;
grant execute on function public.desktop_publish_ticket(text) to anon, authenticated;

create or replace function public.desktop_publish_with_key(p_key text, p_version text, p_file_name text, p_size bigint, p_parts int, p_sha256 text, p_notes text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.publish_key_ok(p_key) then raise exception 'Unknown publishing key' using errcode = '28000'; end if;
  if p_file_name !~ '^[A-Za-z0-9._-]+\.exe$' then raise exception 'The file must be the .exe installer' using errcode = '22023'; end if;
  insert into app.desktop_releases (version, file_name, size_bytes, parts, sha256, notes)
  values (p_version, p_file_name, p_size, p_parts, lower(p_sha256), nullif(btrim(p_notes), ''))
  on conflict (version) do update set file_name = excluded.file_name, size_bytes = excluded.size_bytes, parts = excluded.parts,
    sha256 = excluded.sha256, notes = excluded.notes, published_at = now(), published_by = null;
end $$;
revoke execute on function public.desktop_publish_with_key(text, text, text, bigint, int, text, text) from public;
grant execute on function public.desktop_publish_with_key(text, text, text, bigint, int, text, text) to anon, authenticated;

-- the ticket writes into the downloads bucket and nowhere else
do $$
begin
  if to_regclass('storage.buckets') is null then return; end if;
  execute $p$create policy "downloads: the builder uploads" on storage.objects for insert to authenticated
    with check (bucket_id = 'downloads' and coalesce((auth.jwt() ->> 'desktop_publish')::boolean, false))$p$;
  execute $p$create policy "downloads: the builder replaces" on storage.objects for update to authenticated
    using (bucket_id = 'downloads' and coalesce((auth.jwt() ->> 'desktop_publish')::boolean, false))$p$;
end $$;
