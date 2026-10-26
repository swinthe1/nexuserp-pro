-- =============================================================================
-- DrisPRO for Mac, next to the Windows program
--   A release now belongs to a platform: 'windows' (the .exe installer), 'mac' (the .dmg people
--   download) and 'mac-update' (the .zip the installed Mac program updates itself from).
--   Everything the Windows program and its builder already call keeps working unchanged:
--   without a platform they mean 'windows'.
-- =============================================================================
alter table app.desktop_releases add column if not exists platform text not null default 'windows'
  check (platform in ('windows', 'mac', 'mac-update'));
alter table app.desktop_releases drop constraint if exists desktop_releases_pkey;
alter table app.desktop_releases add primary key (platform, version);

create or replace function app.desktop_file_ok(p_platform text, p_file_name text)
returns boolean language sql immutable set search_path = '' as $$
  select case p_platform
    when 'windows' then p_file_name ~ '^[A-Za-z0-9._-]+\.exe$'
    when 'mac' then p_file_name ~ '^[A-Za-z0-9._-]+\.dmg$'
    when 'mac-update' then p_file_name ~ '^[A-Za-z0-9._-]+\.zip$'
    else false end
$$;

-- the newest version of a platform, for anyone (the sign-in page and the programs themselves)
drop function if exists public.desktop_release();
create or replace function public.desktop_release(p_platform text default 'windows')
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('version', r.version, 'file_name', r.file_name, 'size_bytes', r.size_bytes, 'parts', r.parts,
           'sha256', r.sha256, 'notes', r.notes, 'published_at', r.published_at, 'platform', r.platform,
           'path', r.platform || '/' || r.version || '/' || r.file_name)
    from app.desktop_releases r
   where r.platform = coalesce(p_platform, 'windows')
   order by string_to_array(r.version, '.')::int[] desc limit 1
$$;
grant execute on function public.desktop_release(text) to anon, authenticated;

-- uploaded by hand on the Platform page
drop function if exists public.platform_desktop_publish(text, text, bigint, int, text, text);
create or replace function public.platform_desktop_publish(p_version text, p_file_name text, p_size bigint, p_parts int, p_sha256 text,
                                                           p_notes text default null, p_platform text default 'windows')
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_super_admin();
  if not app.desktop_file_ok(p_platform, p_file_name) then raise exception 'This is not the installer for that system' using errcode = '22023'; end if;
  insert into app.desktop_releases (platform, version, file_name, size_bytes, parts, sha256, notes, published_by)
  values (p_platform, p_version, p_file_name, p_size, p_parts, lower(p_sha256), nullif(btrim(p_notes), ''), auth.uid())
  on conflict (platform, version) do update set file_name = excluded.file_name, size_bytes = excluded.size_bytes, parts = excluded.parts,
    sha256 = excluded.sha256, notes = excluded.notes, published_at = now(), published_by = excluded.published_by;
end $$;
revoke execute on function public.platform_desktop_publish(text, text, bigint, int, text, text, text) from public, anon;
grant execute on function public.platform_desktop_publish(text, text, bigint, int, text, text, text) to authenticated;

drop function if exists public.platform_desktop_releases();
create or replace function public.platform_desktop_releases()
returns table (platform text, version text, file_name text, size_bytes bigint, published_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_super_admin();
  return query select r.platform, r.version, r.file_name, r.size_bytes, r.published_at from app.desktop_releases r
    where r.platform <> 'mac-update'
    order by r.published_at desc limit 12;
end $$;
grant execute on function public.platform_desktop_releases() to authenticated;

-- published by the builder on GitHub
create or replace function public.desktop_publish_ticket(p_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_now bigint := extract(epoch from now())::bigint;
begin
  if not app.publish_key_ok(p_key) then raise exception 'Unknown publishing key' using errcode = '28000'; end if;
  return jsonb_build_object(
    'token', app.sign_jwt(jsonb_build_object('role', 'authenticated', 'aud', 'authenticated', 'iss', 'drispro-desktop',
                                             'iat', v_now, 'exp', v_now + 3600, 'desktop_publish', true)),
    -- 'versions': the Windows ones, as the first builder reads them
    'versions', coalesce((select jsonb_agg(version) from app.desktop_releases where platform = 'windows'), '[]'::jsonb),
    'by_platform', coalesce((select jsonb_object_agg(platform, v) from (select platform, jsonb_agg(version) v from app.desktop_releases group by platform) x), '{}'::jsonb));
end $$;

drop function if exists public.desktop_publish_with_key(text, text, text, bigint, int, text, text);
create or replace function public.desktop_publish_with_key(p_key text, p_version text, p_file_name text, p_size bigint, p_parts int, p_sha256 text,
                                                           p_notes text default null, p_platform text default 'windows')
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.publish_key_ok(p_key) then raise exception 'Unknown publishing key' using errcode = '28000'; end if;
  if not app.desktop_file_ok(p_platform, p_file_name) then raise exception 'This is not the installer for that system' using errcode = '22023'; end if;
  insert into app.desktop_releases (platform, version, file_name, size_bytes, parts, sha256, notes)
  values (p_platform, p_version, p_file_name, p_size, p_parts, lower(p_sha256), nullif(btrim(p_notes), ''))
  on conflict (platform, version) do update set file_name = excluded.file_name, size_bytes = excluded.size_bytes, parts = excluded.parts,
    sha256 = excluded.sha256, notes = excluded.notes, published_at = now(), published_by = null;
end $$;
revoke execute on function public.desktop_publish_with_key(text, text, text, bigint, int, text, text, text) from public;
grant execute on function public.desktop_publish_with_key(text, text, text, bigint, int, text, text, text) to anon, authenticated;
