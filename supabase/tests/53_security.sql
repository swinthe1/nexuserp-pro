-- =============================================================================
-- DrisPRO · nobody gets company data without signing in (runs after 52)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

reset role;
select id as co from public.companies where name = 'Tatim Kosova' \gset
select set_config('request.jwt.claims', '{"role":"anon"}', false);
set role anon;
select t.throws($$select public.recurring_list('$$ || :'co' || $$')$$, '', 'a caller with only the public key cannot read repeating invoices');
select t.throws($$select public.daily_summary('$$ || :'co' || $$')$$, '', 'nor the daily summary');
select t.throws($$select public.mail_account_get('$$ || :'co' || $$')$$, '', 'nor the mail settings');
select t.throws($$select public.cash_forecast('$$ || :'co' || $$')$$, '', 'nor the cash forecast');
reset role;
select t.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
                and p.proname not in ('api_invoices', 'api_order_create', 'api_order_get', 'api_partner_upsert', 'api_partners', 'api_prices', 'api_products', 'api_stock',
                  'desktop_publish_ticket', 'desktop_publish_with_key', 'desktop_release', 'licence_activate', 'licence_ai_result', 'licence_ai_submit', 'licence_backup_done',
                  'licence_backup_ticket', 'licence_check', 'licence_read_result', 'licence_read_submit', 'licence_whatsapp_relay', 'mcp_http', 'partner_info_form',
                  'partner_info_submit', 'pin_login', 'pin_login_result', 'portal_catalog', 'portal_document', 'portal_home', 'portal_images', 'portal_order',
                  'public_pricing', 'shared_device_people', 'sync_history', 'sync_images', 'sync_log', 'sync_push')) = 0,
  'only the functions built for it are open without signing in');
-- the same check inside the database's own jobs (no request) still lets them through
select set_config('request.jwt.claims', '', false);
select t.ok((select count(*) from public.recurring_list(:'co')) >= 0, 'the database''s own jobs still run');

\set QUIET off
select count(*) as assertions_passed from t.results;
