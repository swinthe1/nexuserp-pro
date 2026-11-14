-- =============================================================================
-- DrisPRO Server is published like the DrisPRO program: the local servers find a newer one and install it over
-- themselves (the watchdog, every 6 hours), so nobody has to go to the server for an update.
-- =============================================================================
alter table app.desktop_releases drop constraint if exists desktop_releases_platform_check;
alter table app.desktop_releases add constraint desktop_releases_platform_check check (platform in ('windows', 'mac', 'mac-update', 'server'));

create or replace function app.desktop_file_ok(p_platform text, p_file_name text)
returns boolean language sql immutable set search_path = '' as $$
  select case p_platform
    when 'windows' then p_file_name ~ '^[A-Za-z0-9._-]+\.exe$'
    when 'mac' then p_file_name ~ '^[A-Za-z0-9._-]+\.dmg$'
    when 'mac-update' then p_file_name ~ '^[A-Za-z0-9._-]+\.zip$'
    when 'server' then p_file_name ~ '^DrisPRO-Server-Setup-[0-9.]+\.exe$'
    else false end
$$;
