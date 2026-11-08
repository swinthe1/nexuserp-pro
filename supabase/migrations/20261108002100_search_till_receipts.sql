-- =============================================================================
-- DrisPRO · the search (Ctrl K) finds a till receipt by its number (audit, wave 2)
--   The owner finds a receipt without going through the till history: its total, when, and it opens
--   the shift it belongs to.
-- =============================================================================
create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_def text; v_oid oid;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname || '.' || p.proname = p_name order by p.oid desc limit 1;
  if v_oid is null then raise exception 'function % not found', p_name; end if;
  v_def := pg_get_functiondef(v_oid);
  if position(p_new in v_def) > 0 then return; end if;
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply', p_name; end if;
  execute replace(v_def, p_old, p_new);
end $$;
select app._patch_function('public.global_search',
  $x$      union all select 'leave_request', lr.id, lr.number, 'Leave · ' || lr.status, '/hr/leave?id=' || lr.id, lr.company_id, lr.deleted_at from public.leave_requests lr$x$,
  $x$      union all select 'leave_request', lr.id, lr.number, 'Leave · ' || lr.status, '/hr/leave?id=' || lr.id, lr.company_id, lr.deleted_at from public.leave_requests lr
      union all select 'pos_order', po.id, po.number,
             case when po.is_refund then 'Till refund · ' else 'Till receipt · ' end || to_char(abs(po.total), 'FM999999990.00') || ' · ' || to_char(po.order_at, 'DD.MM.YYYY HH24:MI'),
             '/pos/sessions/' || po.session_id, po.company_id, po.deleted_at from public.pos_orders po where po.number is not null$x$);
drop function app._patch_function(text, text, text);
