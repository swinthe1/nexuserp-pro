-- =============================================================================
-- DrisPRO · the shift's card money by bank (11.11.2026)
--   The shift's controls now also say how much each bank's card terminal took, so the X-report, the Z-report,
--   the closing of the shift and the shift's page show it under "Card", to compare with each terminal's own slip.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.pos_session_controls(p_session uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s public.pos_sessions; c public.pos_cash_counts;
begin
  select * into s from public.pos_sessions where id = p_session;
  if s.id is null then raise exception 'Session not found' using errcode = 'P0002'; end if;
  perform app.require_permission(s.company_id, 'pos.read');
  select * into c from public.pos_cash_counts where session_id = s.id;
  return jsonb_build_object(
    'count', case when c.id is not null then jsonb_build_object('notes_coins', c.notes_coins, 'counted', c.counted, 'difference', c.difference,
               'counted_by', app.person_name(c.counted_by), 'witnessed_by', app.person_name(c.witnessed_by)) end,
    'voids', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(amount), 0),
                'unconfirmed', count(*) filter (where approved_by is null),
                'lines', coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'description', description, 'quantity', quantity, 'amount', amount, 'at', at,
                           'cashier', app.person_name(cashier_id), 'approved_by', app.person_name(approved_by), 'offline', offline) order by at), '[]'::jsonb))
                from public.pos_till_log where session_id = s.id and kind like 'void%'),
    -- the card money of the shift by the bank whose terminal took it (refunds taken off); '' = taken before the bank was asked
    'card_banks', (select coalesce(jsonb_object_agg(x.bank, x.amt), '{}'::jsonb) from (
                select coalesce(nullif(btrim(pp.reference), ''), '') as bank, sum(pp.amount) as amt
                  from public.pos_payments pp join public.pos_orders o on o.id = pp.pos_order_id
                 where o.session_id = s.id and o.status = 'paid' and pp.method = 'card'
                 group by 1 having sum(pp.amount) <> 0) x));
end $function$;
