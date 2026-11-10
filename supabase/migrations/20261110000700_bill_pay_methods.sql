-- =============================================================================
-- DrisPRO · how each purchase bill was paid: in cash or through the bank (10.11.2026)
--   · the purchase bills and the expenses can be filtered by it; a bill paid both ways is 'mixed';
--     the cash or bank account of the payment decides, its method when it has no account.
-- =============================================================================

create or replace function public.bill_pay_methods(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.has_permission(p_company, 'invoicing.read') then raise exception 'Permission denied' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_object_agg(bill, way) from (
      select a.vendor_bill_id as bill,
             case when bool_and(x.k = 'cash') then 'cash' when bool_and(x.k = 'bank') then 'bank' else 'mixed' end as way
        from public.payment_allocations a
        join public.payments p on p.id = a.payment_id and p.deleted_at is null and p.status = 'posted' and p.reversed_at is null
        left join public.bank_accounts b on b.id = p.bank_account_id
        cross join lateral (select coalesce(b.account_kind, case when p.method = 'cash' then 'cash' else 'bank' end) as k) x
       where a.company_id = p_company and a.vendor_bill_id is not null
       group by a.vendor_bill_id) t), '{}'::jsonb);
end $$;

revoke execute on function public.bill_pay_methods(uuid) from public, anon;
grant execute on function public.bill_pay_methods(uuid) to authenticated;
