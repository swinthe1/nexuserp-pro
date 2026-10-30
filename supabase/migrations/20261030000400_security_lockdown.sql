-- =============================================================================
-- Security: no data for callers who are not signed in
--  1. The permission checks looked at current_user, which inside a SECURITY DEFINER
--     function is always the owner, so a caller with only the public (anon) key passed.
--     They now look at the request's role: anon / authenticated without a user → refused.
--     Calls with no request at all (the database's own jobs) and the service role still pass.
--  2. Many public functions were executable by anon through the default PUBLIC grant.
--     Every function keeps exactly the signed-in access it had; anon keeps only the
--     functions meant for it (protected by a key, token or PIN).
-- =============================================================================

-- the role of the API request, or null when the call does not come through the API
create or replace function app.request_role()
returns text language sql stable set search_path = '' as $$
  select coalesce(nullif(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'role',
                  case when current_setting('role', true) in ('anon', 'authenticated') then current_setting('role', true) end)
$$;

create or replace function app.require_permission(p_company uuid, p_perm text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    if app.request_role() in ('anon', 'authenticated') then
      raise exception 'Not authenticated' using errcode = '28000';
    end if;
    return;   -- the database's own jobs, the service role
  end if;
  if not app.has_permission(p_company, p_perm) then
    raise exception 'Permission denied: % required', p_perm using errcode = '42501';
  end if;
end $$;

create or replace function app.require_any_permission(p_company uuid, p_perms text[])
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    if app.request_role() in ('anon', 'authenticated') then
      raise exception 'Not authenticated' using errcode = '28000';
    end if;
    return;
  end if;
  if not exists (select 1 from unnest(p_perms) x where app.has_permission(p_company, x)) then
    raise exception 'Permission denied: % required', array_to_string(p_perms, ' or ') using errcode = '42501';
  end if;
end $$;

create or replace function app.require_safe(p_company uuid, p_level text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    if app.request_role() in ('anon', 'authenticated') then
      raise exception 'Not authenticated' using errcode = '28000';
    end if;
    return;
  end if;
  if not app.safe_can(p_company, p_level) then
    raise exception 'Permission denied: % required', case p_level when 'approve' then 'finance.approve' when 'setup' then 'finance.write'
                                                                else 'pos.approve or finance.read' end using errcode = '42501';
  end if;
end $$;

-- function grants: keep what signed-in users and the service role could run, take PUBLIC and anon away,
-- then give anon back only the functions built for it
do $$
declare f record;
  v_anon text[] := array[
    'api_invoices', 'api_order_create', 'api_order_get', 'api_partner_upsert', 'api_partners', 'api_prices', 'api_products', 'api_stock',
    'desktop_publish_ticket', 'desktop_publish_with_key', 'desktop_release',
    'licence_activate', 'licence_ai_result', 'licence_ai_submit', 'licence_backup_done', 'licence_backup_ticket', 'licence_check',
    'licence_read_result', 'licence_read_submit', 'licence_whatsapp_relay',
    'mcp_http', 'partner_info_form', 'partner_info_submit', 'pin_login', 'pin_login_result',
    'portal_catalog', 'portal_document', 'portal_home', 'portal_images', 'portal_order',
    'public_pricing', 'shared_device_people', 'sync_history', 'sync_images', 'sync_log', 'sync_push'];
  v_auth boolean; v_svc boolean; v_was_anon boolean;
begin
  for f in select p.oid, p.proname, p.oid::regprocedure::text as sig
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind = 'f'
              and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') loop
    v_auth := has_function_privilege('authenticated', f.oid, 'execute');
    v_svc := has_function_privilege('service_role', f.oid, 'execute');
    v_was_anon := has_function_privilege('anon', f.oid, 'execute');
    if v_auth then execute format('grant execute on function %s to authenticated', f.sig); end if;
    if v_svc then execute format('grant execute on function %s to service_role', f.sig); end if;
    execute format('revoke execute on function %s from public, anon', f.sig);
    if f.proname = any (v_anon) and v_was_anon then execute format('grant execute on function %s to anon', f.sig); end if;
  end loop;
end $$;

-- functions made from now on are not open to everyone by default
alter default privileges in schema public revoke execute on functions from public, anon;

-- the internal version of reserving an order is only for other functions
revoke execute on function app.reserve_sales_order(uuid) from public, anon, authenticated;
