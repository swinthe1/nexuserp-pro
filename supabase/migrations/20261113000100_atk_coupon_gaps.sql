-- =============================================================================
-- DrisPRO · 20261113000100 · What a fiscal coupon would print without (Kërkesat, neni 25.18)
-- The coupon must carry the address of the unit, the unit's number and the cashier's identification number.
-- The program prints them when they are filled in; this lists what is still empty, so it is filled before
-- ATK's technical test and not noticed on the paper there.
-- =============================================================================
create or replace function public.atk_coupon_gaps(p_company uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c public.companies; v jsonb := '[]'::jsonb; w record; u record;
begin
  perform app.require_any_permission(p_company, array['tax.read', 'pos.approve', 'admin.read']);
  select * into c from public.companies where id = p_company;
  for w in select x.id, x.name, x.address_line1, x.city, x.atk_unit_no from public.warehouses x
            where x.company_id = p_company and x.deleted_at is null and x.is_active
              and exists (select 1 from public.pos_registers r where r.warehouse_id = x.id and r.deleted_at is null and r.is_active)
            order by x.name loop
    if coalesce(nullif(btrim(w.address_line1), ''), nullif(btrim(c.address_line1), '')) is null then
      v := v || jsonb_build_object('what', 'address', 'name', w.name); end if;
    if coalesce(nullif(btrim(w.city), ''), nullif(btrim(c.city), '')) is null then
      v := v || jsonb_build_object('what', 'city', 'name', w.name); end if;
    if nullif(btrim(w.atk_unit_no), '') is null then
      v := v || jsonb_build_object('what', 'unit_no', 'name', w.name); end if;
  end loop;
  -- the cashiers of the last sixty days who have no number in the staff list
  for u in select distinct p.id, coalesce(nullif(p.full_name, ''), p.email) as name
             from public.pos_sessions s join public.profiles p on p.id = s.opened_by
            where s.company_id = p_company and s.opened_at > now() - interval '60 days'
              and not exists (select 1 from public.employees e where e.company_id = p_company and e.user_id = p.id and e.deleted_at is null and nullif(btrim(e.number), '') is not null)
            order by 2 loop
    v := v || jsonb_build_object('what', 'operator_no', 'name', u.name);
  end loop;
  return v;
end $$;
revoke execute on function public.atk_coupon_gaps(uuid) from public, anon;
grant execute on function public.atk_coupon_gaps(uuid) to authenticated;
