-- =============================================================================
-- DrisPRO · the modules that cost us money per use are sold separately
--   Reading supplier invoices with AI (ai_reads), the assistant (ai_assistant) and WhatsApp
--   messages (whatsapp) are in no plan: the platform owner turns them on for a client who asked
--   for them and put them in the offer (licenses.extra_features). Off, they are refused here,
--   in the cloud and through a local server alike; WhatsApp messages are simply not made, the
--   email still goes out.
-- =============================================================================

create or replace function public.platform_set_plan_extras(p_company uuid, p_extra text[], p_max_warehouses int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_super_admin();
  update public.licenses
     set extra_features = coalesce((select array_agg(distinct f order by f) from unnest(coalesce(p_extra, '{}')) f
                                     where f in ('transfers', 'accounting', 'restaurant', 'imports', 'approvals', 'hr',
                                                 'wms', 'manufacturing', 'logistics', 'ecommerce', 'livesync',
                                                 'ai_reads', 'ai_assistant', 'whatsapp')), '{}'),
         max_warehouses = p_max_warehouses
   where company_id = p_company;
  if not found then raise exception 'Company not found' using errcode = 'P0002'; end if;
end $$;

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;

-- reading invoices: every way in passes the monthly check
select app._patch_function('app.ai_reads_check',
  $x$begin
  if app.ai_reads_used(p_company) >= v_limit then$x$,
  $x$begin
  perform app.require_feature(p_company, 'ai_reads');
  if app.ai_reads_used(p_company) >= v_limit then$x$);

-- the assistant
select app._patch_function('public.assistant_send',
  $x$  perform app.require_permission(p_company, 'core.read');
  if auth.uid() is null$x$,
  $x$  perform app.require_permission(p_company, 'core.read');
  perform app.require_feature(p_company, 'ai_assistant');
  if auth.uid() is null$x$);
select app._patch_function('public.licence_ai_submit',
  $x$  l := app.backup_licence(p_code, p_server);$x$,
  $x$  l := app.backup_licence(p_code, p_server);
  perform app.require_feature(l.company_id, 'ai_assistant');$x$);

-- WhatsApp: no module, no message (the email of the same summary or reminder still goes)
select app._patch_function('app.enqueue_message',
  $x$  if coalesce(v_to, '') = '' then return null; end if;$x$,
  $x$  if coalesce(v_to, '') = '' then return null; end if;
  if p_channel = 'whatsapp' and not app.has_feature(p_company, 'whatsapp') then return null; end if;$x$);
select app._patch_function('public.licence_whatsapp_relay',
  $x$  l := app.backup_licence(p_code, p_server);$x$,
  $x$  l := app.backup_licence(p_code, p_server);
  perform app.require_feature(l.company_id, 'whatsapp');$x$);
select app._patch_function('public.messaging_settings',
  $x$    'whatsapp_ready',$x$,
  $x$    'whatsapp_module', app.has_feature(p_company, 'whatsapp'),
    'whatsapp_ready',$x$);
drop function app._patch_function(text, text, text);
