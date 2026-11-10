-- =============================================================================
-- DrisPRO · reconciling the tills: what each shift paid out of the drawer to suppliers and for expenses (10.11.2026)
-- =============================================================================
do $patch$
declare d text; v_anchor text := '''last_note'', (select v.note from public.pos_session_reviews v';
begin
  d := pg_get_functiondef('public.pos_review_list(uuid,jsonb)'::regprocedure);
  if position('''supplier_paid''' in d) > 0 then return; end if;
  if position(v_anchor in d) = 0 then raise exception 'pos_review_list: anchor not found'; end if;
  d := replace(d, v_anchor,
    '''supplier_paid'', (select coalesce(sum(m.amount), 0) from public.pos_cash_movements m where m.session_id = s.id and m.kind = ''supplier'' and m.movement_type = ''cash_out''),
             ''expenses'', (select coalesce(sum(m.amount), 0) from public.pos_cash_movements m where m.session_id = s.id and m.kind = ''expense'' and m.movement_type = ''cash_out''),
             ' || v_anchor);
  execute d;
end $patch$ language plpgsql;
