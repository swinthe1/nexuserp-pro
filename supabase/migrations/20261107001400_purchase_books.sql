-- =============================================================================
-- DrisPRO · one purchase book, three books inside it: goods, expenses, investments
--   Every purchase invoice (goods into the warehouse, an expense from a photo, the invoice of a vehicle)
--   is a vendor bill. Which book it belongs to follows from what it bought:
--     investments — it made a fixed asset, or a line goes to a fixed-asset account;
--     goods       — most of it is stock (stockable or consumable articles, inventory accounts);
--     expenses    — the rest: services, rent, electricity, fuel… booked to expense accounts.
--   A bill that mixes goods and expenses goes to the book with the larger amount.
--   Read as a computed column: vendor_bills?select=…,book
-- =============================================================================

create or replace function public.book(b public.vendor_bills)
returns text language sql stable security invoker set search_path = '' as $$
  select case
    when exists (select 1 from public.fixed_assets f where f.vendor_bill_id = b.id) then 'investment'
    else coalesce((
      select k from (
        select case when a.account_subtype = 'fixed_asset' then 'investment'
                    when p.product_type in ('stockable', 'consumable') or a.account_subtype = 'inventory' then 'goods'
                    else 'expense' end as k,
               sum(abs(l.line_subtotal)) as amount
          from public.vendor_bill_lines l
          left join public.accounts a on a.id = l.account_id
          left join public.product_variants v on v.id = l.variant_id
          left join public.products p on p.id = v.product_id
         where l.bill_id = b.id
         group by 1) x
      order by (k = 'investment') desc, amount desc, (k = 'goods') desc
      limit 1), 'expense')
  end
$$;
revoke execute on function public.book(public.vendor_bills) from public, anon;
grant execute on function public.book(public.vendor_bills) to authenticated;

notify pgrst, 'reload schema';
