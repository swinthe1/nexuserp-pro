-- =============================================================================
-- DrisPRO · registering a till at ATK: ATK's own answers say plainly what to do (9.11.2026)
--   · /ca/signcsr "Certificate has already been added": ATK has a certificate for this NUI + store + till
--     number already (an earlier attempt, another device or another program). The number is kept as used
--     and the person is told the next free number.
--   · /ca/verify 404: either the number is registered already, or the NUI / fiscalization number is not the
--     one in EDI. Nothing is marked; the person is told both and given a free number to try.
-- =============================================================================
do $patch$
declare d text; v_anchor text := '    update app.atk_jobs set status = case when v_ok then ''done'' else ''failed'' end, done_at = now(),';
begin
  d := pg_get_functiondef('public.atk_done(text,uuid,integer,jsonb,text,integer,jsonb)'::regprocedure);
  if position('already%added' in d) > 0 then return; end if;
  if position(v_anchor in d) = 0 then raise exception 'atk_done: anchor not found'; end if;
  d := replace(d, v_anchor, $x$    if not v_ok and p_kind = 'signcsr' and v_msg ilike '%already%added%' then
      insert into app.atk_pos_used (nui, env, branch_id, pos_id, company_id, register_id)
      values (coalesce(j.request ->> 'business_id', j.request ->> 'nui'), j.env, (j.request ->> 'branch_id')::int, (j.request ->> 'pos_id')::int,
              j.company_id, j.register_id)
      on conflict do nothing;
      v_msg := 'ATK registers each till number once, and number ' || (j.request ->> 'pos_id') || ' of this store is taken: give this till number '
               || coalesce(app.atk_next_pos(j.company_id, j.env, (j.request ->> 'branch_id')::int)::text, '–');
    elsif not v_ok and p_kind = 'verify' and p_status = 404 then
      v_msg := 'ATK does not know till number ' || (j.request ->> 'pos_id') || ' of store ' || (j.request ->> 'branch_id')
               || ': it is registered already, or the NUI or the fiscalization number is not the one in EDI. Check them, or give this till number '
               || coalesce(app.atk_next_pos(j.company_id, j.env, (j.request ->> 'branch_id')::int)::text, '–');
    end if;
$x$ || v_anchor);
  execute d;
end $patch$ language plpgsql;
