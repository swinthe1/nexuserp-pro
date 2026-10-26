-- =============================================================================
-- DrisPRO · the law's cash limit at the till
--   A receipt paid with more cash than the law allows (a business customer: the business limit;
--   the walk-in customer or an individual: the individual limit). The till warns before payment,
--   or refuses cash above the limit when the company chose so. The server never refuses a receipt
--   (receipts made offline arrive later and have already happened); it tells finance instead.
-- =============================================================================

-- what the till keeps for offline use
create or replace function public.pos_cash_limits(p_register uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.pos_registers;
begin
  select * into r from public.pos_registers where id = p_register;
  if r.id is null then raise exception 'Register not found' using errcode = 'P0002'; end if;
  perform app.require_permission(r.company_id, 'pos.read');
  return (select jsonb_build_object('business', s.cash_limit_business, 'individual', s.cash_limit_individual, 'block', s.cash_limit_block)
            from public.company_settings s where s.company_id = r.company_id);
end $$;
revoke execute on function public.pos_cash_limits(uuid) from public, anon;
grant execute on function public.pos_cash_limits(uuid) to authenticated;

create or replace function app.pos_cash_limit_notice(p_order uuid, p_cash numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.pos_orders; r public.pos_registers; s public.company_settings; v_kind text; v_limit numeric; v_cur text;
begin
  select * into o from public.pos_orders where id = p_order;
  if o.is_refund or coalesce(p_cash, 0) <= 0 then return; end if;
  select * into r from public.pos_registers where id = o.register_id;
  select * into s from public.company_settings where company_id = o.company_id;
  v_kind := case when o.partner_id is null or o.partner_id = r.default_customer_id then 'individual'
                 else coalesce((select kind from public.business_partners where id = o.partner_id), 'individual') end;
  v_limit := case when v_kind = 'individual' then s.cash_limit_individual else s.cash_limit_business end;
  if v_limit is null or p_cash <= v_limit then return; end if;
  select base_currency into v_cur from public.companies where id = o.company_id;
  perform app.notify_permission(o.company_id, 'finance.approve', 'warning',
    'Cash above the legal limit at the till: ' || o.number,
    r.name || ' · ' || to_char(p_cash, 'FM999G999G990D00') || ' ' || coalesce(v_cur, '') || ' in cash, the limit is ' || to_char(v_limit, 'FM999G999G990D00'),
    '/pos/sessions/' || o.session_id);
exception when others then
  raise warning 'cash limit notice: %', sqlerrm;   -- a sale is never stopped by its notice
end $$;
revoke execute on function app.pos_cash_limit_notice(uuid, numeric) from public, anon, authenticated;

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;
select app._patch_function('public.pos_submit_order',
  $x$status = 'paid' where id = v_id;$x$,
  $x$status = 'paid' where id = v_id;
  perform app.pos_cash_limit_notice(v_id, v_cash - greatest(v_change, 0));$x$);
drop function app._patch_function(text, text, text);
