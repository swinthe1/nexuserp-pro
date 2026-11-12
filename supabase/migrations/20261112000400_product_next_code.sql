-- =============================================================================
-- DrisPRO · 20261112000400 · the next item number ("shifra") for a new product
-- A new product takes the number after the highest numeric code the company has (1001 when it has none yet);
-- the person can still type a code of their own.
-- =============================================================================
create or replace function public.product_next_code(p_company uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v bigint;
begin
  perform app.require_permission(p_company, 'inventory.read');
  select max(p.code::bigint) into v from public.products p where p.company_id = p_company and p.code ~ '^[0-9]{1,12}$';
  return (coalesce(v, 1000) + 1)::text;
end $$;
revoke execute on function public.product_next_code(uuid) from public, anon;
grant execute on function public.product_next_code(uuid) to authenticated;
