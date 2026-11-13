-- =============================================================================
-- DrisPRO · 20261113000500 · The company's printed header for the live preview of a document
-- The salesperson writing an invoice sees it as it will print while typing; the header (logo, NUI, banks,
-- colours) comes from here. Those who write sales or purchase documents may read it, not only the admins.
-- =============================================================================
create or replace function public.print_company_header(p_company uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_any_permission(p_company, array['admin.read', 'sales.read', 'invoicing.read', 'procurement.read']);
  return app.print_company(p_company);
end $$;
revoke execute on function public.print_company_header(uuid) from public, anon;
grant execute on function public.print_company_header(uuid) to authenticated;
