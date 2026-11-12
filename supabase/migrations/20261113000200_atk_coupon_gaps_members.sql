-- =============================================================================
-- DrisPRO · 20261113000200 · Coupon gaps: only the company's own cashiers
-- A support account that once opened a shift is not on the company's user list and cannot be given a staff
-- number there, so the warning never went away. Now only active users of the company are listed.
-- =============================================================================
do $$
declare d text := pg_get_functiondef('public.atk_coupon_gaps(uuid)'::regprocedure); n text;
begin
  n := replace(d, $a$and s.opened_at > now() - interval '60 days'$a$,
    $a$and s.opened_at > now() - interval '60 days'
              and exists (select 1 from public.company_members m where m.company_id = p_company and m.user_id = p.id and m.deleted_at is null and m.status = 'active')$a$);
  if n = d then raise exception 'atk_coupon_gaps: the place for the members check was not found'; end if;
  execute n;
end $$;
