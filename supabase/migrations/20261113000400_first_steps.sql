-- =============================================================================
-- DrisPRO · 20261113000400 · First steps of a new company
-- A short list on the dashboard that takes a new company to its first invoice: the company's data, the logo,
-- an item, a customer, a sale, a purchase, a colleague, the bank account. Each step is read from what is
-- already there, so it is ticked the moment it is done, by anyone, however it was done.
-- =============================================================================
create or replace function public.company_first_steps(p_company uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c public.companies; s public.company_settings;
begin
  if not (p_company = any (app.my_company_ids())) then raise exception 'Not a member of this company' using errcode = '42501'; end if;
  select * into c from public.companies where id = p_company;
  select * into s from public.company_settings where company_id = p_company;
  return jsonb_build_array(
    jsonb_build_object('key', 'company', 'done', nullif(btrim(c.tax_number), '') is not null and nullif(btrim(c.address_line1), '') is not null
                                                  and nullif(btrim(c.city), '') is not null and nullif(btrim(c.phone), '') is not null),
    jsonb_build_object('key', 'logo', 'done', s.print_logo is not null),
    jsonb_build_object('key', 'item', 'done', exists (select 1 from public.products p where p.company_id = p_company and p.deleted_at is null)),
    jsonb_build_object('key', 'customer', 'done', exists (select 1 from public.business_partners b where b.company_id = p_company and b.is_customer and b.deleted_at is null)),
    jsonb_build_object('key', 'sale', 'done', exists (select 1 from public.sales_invoices i where i.company_id = p_company and i.status <> 'draft')
                                              or exists (select 1 from public.pos_orders o where o.company_id = p_company and o.status = 'paid')),
    jsonb_build_object('key', 'purchase', 'done', exists (select 1 from public.vendor_bills b where b.company_id = p_company and b.status <> 'draft')),
    jsonb_build_object('key', 'colleague', 'done', (select count(*) from public.company_members m where m.company_id = p_company and m.deleted_at is null and m.status = 'active') > 1),
    jsonb_build_object('key', 'bank', 'done', exists (select 1 from public.bank_accounts a where a.company_id = p_company and a.account_kind = 'bank' and a.deleted_at is null))
  );
end $$;
revoke execute on function public.company_first_steps(uuid) from public, anon;
grant execute on function public.company_first_steps(uuid) to authenticated;
