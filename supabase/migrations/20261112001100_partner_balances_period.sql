-- =============================================================================
-- DrisPRO · 20261112001100 · Partner balances over a period (request K-0003)
-- Beside the balance on a date: the balance at the start of a period, what was added and what was taken off in it.
-- Same accounts and entries as partner_balances, so the two always agree: start + added − taken off = balance at the end.
-- =============================================================================
create or replace function public.partner_balances_period(p_company uuid, p_side text, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'invoicing.read');
  if p_side not in ('customer', 'vendor') then raise exception 'Choose customer or supplier side' using errcode = '22023'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Check the dates' using errcode = '22023'; end if;
  return coalesce((
    with acc as (
      select a.id from public.accounts a where a.company_id = p_company and a.deleted_at is null
         and a.account_subtype = case when p_side = 'vendor' then 'payable' else 'receivable' end
      union select app.acct(p_company, case when p_side = 'vendor' then 'vendor_advances' else 'customer_advances' end)
      union select case when p_side = 'vendor' then bp.payable_account_id else bp.receivable_account_id end from public.business_partners bp where bp.company_id = p_company),
    m as (
      select jl.partner_id,
             sum(jl.debit - jl.credit) filter (where e.entry_date < p_from) as before,
             sum(jl.debit) filter (where e.entry_date >= p_from) as dr,
             sum(jl.credit) filter (where e.entry_date >= p_from) as cr
        from public.journal_lines jl join public.journal_entries e on e.id = jl.entry_id
       where jl.company_id = p_company and jl.partner_id is not null and jl.account_id in (select id from acc where id is not null)
         and e.status in ('posted', 'reversed') and e.entry_date <= p_to
       group by jl.partner_id)
    select jsonb_object_agg(m.partner_id, jsonb_build_object(
             'opening', round(case when p_side = 'vendor' then -coalesce(m.before, 0) else coalesce(m.before, 0) end, 2),
             'added', round(coalesce(case when p_side = 'vendor' then m.cr else m.dr end, 0), 2),
             'taken', round(coalesce(case when p_side = 'vendor' then m.dr else m.cr end, 0), 2)))
      from m), '{}'::jsonb);
end $$;
revoke execute on function public.partner_balances_period(uuid, text, date, date) from public, anon;
grant execute on function public.partner_balances_period(uuid, text, date, date) to authenticated;
