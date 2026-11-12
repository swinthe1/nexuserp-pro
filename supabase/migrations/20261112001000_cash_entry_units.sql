-- =============================================================================
-- DrisPRO · 20261112001000 · The cash book by unit (request K-0013)
-- The cash account is often one for the whole company, so a line of the cash book says nothing about the unit by
-- itself. The unit is read from where the line came from: a till's shift (its till's unit), a movement of a safe
-- (the safe's unit), a payment through a cash account that belongs to one unit only. What has no such origin
-- (an entry typed by hand) has no unit.
-- =============================================================================
create or replace function public.cash_entry_units(p_company uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (app.has_permission(p_company, 'finance.read') or app.has_permission(p_company, 'invoicing.read')) then
    raise exception 'Permission denied' using errcode = '42501';
  end if;
  if p_to < p_from or p_to - p_from > 800 then raise exception 'Check the dates' using errcode = '22023'; end if;
  return coalesce((
    with own as (   -- a cash or bank account that belongs to one unit only
      select x.acc, min(x.wh::text)::uuid as wh from (
        select r.cash_account_id as acc, r.warehouse_id as wh from public.pos_registers r where r.company_id = p_company and r.deleted_at is null and r.cash_account_id is not null
        union select s.bank_account_id, s.warehouse_id from public.safes s where s.company_id = p_company and s.deleted_at is null and s.bank_account_id is not null) x
       group by x.acc having count(distinct x.wh) = 1),
    e as (
      select distinct e.id, e.source_doc_type as st, e.source_doc_id as sid
        from public.journal_entries e join public.journal_lines jl on jl.entry_id = e.id join public.accounts a on a.id = jl.account_id
       where e.company_id = p_company and e.entry_date between p_from and p_to and e.status in ('posted', 'reversed') and a.account_subtype = 'cash'),
    u as (
      select e.id, coalesce(
        (select r.warehouse_id from public.pos_sessions ps join public.pos_registers r on r.id = ps.register_id where e.st = 'pos_session' and ps.id = e.sid),
        (select s.warehouse_id from public.safe_movements m join public.safes s on s.id = m.safe_id where m.journal_entry_id = e.id or m.arrived_entry_id = e.id limit 1),
        (select o.wh from public.payments py join own o on o.acc = py.bank_account_id where py.id = e.sid or py.journal_entry_id = e.id limit 1)) as wh
        from e)
    select jsonb_object_agg(u.id, u.wh) from u where u.wh is not null), '{}'::jsonb);
end $$;
revoke execute on function public.cash_entry_units(uuid, date, date) from public, anon;
grant execute on function public.cash_entry_units(uuid, date, date) to authenticated;
