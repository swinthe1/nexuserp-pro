-- =============================================================================
-- DrisPRO · the nightly database copy reports here, so the platform page shows
-- when the last copy was made, how big it is and how much disk is left
-- (written by deploy/coolify/backup-database.sh as the database owner)
-- =============================================================================
create schema if not exists drispro_meta;
create table if not exists drispro_meta.backups (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  ok         boolean not null,
  kind       text not null default 'nightly',     -- nightly | before-update | manual
  file       text,
  size_bytes bigint,
  disk_free_bytes bigint,
  disk_total_bytes bigint,
  message    text
);
revoke all on schema drispro_meta from public, anon, authenticated;

create or replace function public.platform_backup_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_super_admin();
  return jsonb_build_object(
    'last_ok', (select to_jsonb(b) - 'id' from drispro_meta.backups b where ok order by at desc limit 1),
    'last_failed', (select to_jsonb(b) - 'id' from drispro_meta.backups b where not ok order by at desc limit 1),
    'copies_week', (select count(*) from drispro_meta.backups where ok and at > now() - interval '7 days'),
    'recent', coalesce((select jsonb_agg(to_jsonb(x) - 'id' order by x.at desc) from (select * from drispro_meta.backups order by at desc limit 10) x), '[]'::jsonb));
end $$;
revoke execute on function public.platform_backup_status() from public, anon;
grant execute on function public.platform_backup_status() to authenticated;
