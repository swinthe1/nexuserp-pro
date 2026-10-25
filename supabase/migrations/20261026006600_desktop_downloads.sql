-- =============================================================================
-- DrisPRO · the Windows program, always the newest version, from the sign-in page
--   The platform owner uploads the installer on the Platform page; it is kept in a public bucket in
--   parts (each under the storage limit) and the sign-in page offers the newest one to everyone,
--   in the cloud and on local servers (they ask the cloud).
-- =============================================================================

create table app.desktop_releases (
  version      text primary key check (version ~ '^\d+\.\d+\.\d+$'),
  file_name    text not null,
  size_bytes   bigint not null check (size_bytes > 0),
  parts        int not null check (parts between 1 and 50),
  sha256       text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  notes        text,
  published_at timestamptz not null default now(),
  published_by uuid
);
revoke all on app.desktop_releases from public, anon, authenticated;

-- the newest version, for anyone (the sign-in page has nobody signed in yet)
create or replace function public.desktop_release()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('version', r.version, 'file_name', r.file_name, 'size_bytes', r.size_bytes, 'parts', r.parts,
           'sha256', r.sha256, 'notes', r.notes, 'published_at', r.published_at,
           'path', 'windows/' || r.version || '/' || r.file_name)
    from app.desktop_releases r
   order by string_to_array(r.version, '.')::int[] desc limit 1
$$;
grant execute on function public.desktop_release() to anon, authenticated;

-- after the parts are uploaded
create or replace function public.platform_desktop_publish(p_version text, p_file_name text, p_size bigint, p_parts int, p_sha256 text, p_notes text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_super_admin();
  if p_file_name !~ '^[A-Za-z0-9._-]+\.exe$' then raise exception 'The file must be the .exe installer' using errcode = '22023'; end if;
  insert into app.desktop_releases (version, file_name, size_bytes, parts, sha256, notes, published_by)
  values (p_version, p_file_name, p_size, p_parts, lower(p_sha256), nullif(btrim(p_notes), ''), auth.uid())
  on conflict (version) do update set file_name = excluded.file_name, size_bytes = excluded.size_bytes, parts = excluded.parts,
    sha256 = excluded.sha256, notes = excluded.notes, published_at = now(), published_by = excluded.published_by;
end $$;
grant execute on function public.platform_desktop_publish(text, text, bigint, int, text, text) to authenticated;

create or replace function public.platform_desktop_releases()
returns table (version text, file_name text, size_bytes bigint, published_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_super_admin();
  return query select r.version, r.file_name, r.size_bytes, r.published_at from app.desktop_releases r
    order by string_to_array(r.version, '.')::int[] desc limit 10;
end $$;
grant execute on function public.platform_desktop_releases() to authenticated;

-- the public bucket: everyone reads, only the platform owner writes
do $$
begin
  if to_regclass('storage.buckets') is null then return; end if;
  insert into storage.buckets (id, name, public) values ('downloads', 'downloads', true) on conflict (id) do update set public = true;
  execute $p$create policy "downloads: platform owner uploads" on storage.objects for insert to authenticated
    with check (bucket_id = 'downloads' and app.is_super_admin())$p$;
  execute $p$create policy "downloads: platform owner replaces" on storage.objects for update to authenticated
    using (bucket_id = 'downloads' and app.is_super_admin())$p$;
  execute $p$create policy "downloads: platform owner removes" on storage.objects for delete to authenticated
    using (bucket_id = 'downloads' and app.is_super_admin())$p$;
  execute $p$create policy "downloads: everyone reads" on storage.objects for select to anon, authenticated
    using (bucket_id = 'downloads')$p$;
end $$;
