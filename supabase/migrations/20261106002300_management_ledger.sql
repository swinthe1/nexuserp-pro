-- =============================================================================
-- Two views of the books: the statutory ledger (what the law and ATK see) and the management ledger
-- (the same, plus internal adjustments for running the business: cost allocations between units, imputed
-- rent, management accruals, reclassifications for KPIs).
--
-- What keeps it honest:
--  · every entry made by a document (invoice, till receipt, payment, stock, payroll…) is STATUTORY, always;
--    a management entry can only be a manual journal entry (or the reversal of one)
--  · a management entry touches only income and expense accounts and the management adjustments account
--    (1098) — never cash, bank, VAT, customers, suppliers or stock — so no real money or obligation can live
--    there; and the statutory books never touch 1098
--  · posted entries cannot change ledger (posted entries are immutable already)
--  · the statutory reports (trial balance, financial statements, profit tax, year end, opening balances,
--    the overview) read the statutory ledger only; the management view reads both
--  · the two views keep row-level security (security_invoker): each company sees only its own entries
-- A statutory entry is in the management view too, so two values are enough: STATUTORY and MANAGEMENT.
-- =============================================================================

alter table public.journal_entries add column if not exists reporting_ledger text not null default 'STATUTORY';
alter table public.journal_entries drop constraint if exists journal_entries_reporting_ledger_check;
alter table public.journal_entries add constraint journal_entries_reporting_ledger_check check (reporting_ledger in ('STATUTORY', 'MANAGEMENT'));
create index if not exists journal_entries_management_idx on public.journal_entries (company_id, entry_date) where reporting_ledger = 'MANAGEMENT';

-- the account that balances management adjustments, never used by the statutory books
alter table public.accounts add column if not exists is_management boolean not null default false;
create or replace function app.ensure_management_account(p_company uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not exists (select 1 from public.accounts where company_id = p_company and deleted_at is null) then return null; end if;
  select id into v_id from public.accounts where company_id = p_company and is_management and deleted_at is null limit 1;
  if v_id is null then
    insert into public.accounts (company_id, code, name, account_type, account_subtype, is_reconcilable, is_management, parent_id)
    values (p_company, case when exists (select 1 from public.accounts where company_id = p_company and code = '1098') then '10989' else '1098' end,
            'Management adjustments (internal)', 'equity', 'equity', false, true,
            (select a.id from public.accounts a where a.company_id = p_company and a.code = '1' and a.deleted_at is null limit 1))
    returning id into v_id;
  end if;
  return v_id;
end $$;
revoke execute on function app.ensure_management_account(uuid) from public, anon, authenticated;
select app.ensure_management_account(id) from public.companies;

-- an entry made by a document is statutory; a reversal follows the entry it reverses
create or replace function app.tg_journal_ledger()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.reversal_of_id is not null then
    new.reporting_ledger := coalesce((select reporting_ledger from public.journal_entries where id = new.reversal_of_id), 'STATUTORY');
  elsif new.reporting_ledger = 'MANAGEMENT' and (new.is_automatic or new.source_doc_type is not null) then
    raise exception 'Entries made by documents (invoices, receipts, payments, stock) always go to the statutory books' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists trg_03b_ledger on public.journal_entries;
create trigger trg_03b_ledger before insert or update of reporting_ledger, is_automatic, source_doc_type, reversal_of_id on public.journal_entries
  for each row execute function app.tg_journal_ledger();

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_def text; v_oid oid;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname || '.' || p.proname = p_name order by p.oid desc limit 1;
  if v_oid is null then raise exception 'function % not found', p_name; end if;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply', p_name; end if;
  execute replace(v_def, p_old, p_new);
end $$;

-- on posting: which accounts each ledger may use
select app._patch_function('app.tg_journal_entry_validate',
  $x$    raise exception 'Accounts % cannot be posted to (group, inactive or deleted)', v_bad using errcode = '23514';
  end if;$x$,
  $x$    raise exception 'Accounts % cannot be posted to (group, inactive or deleted)', v_bad using errcode = '23514';
  end if;

  if e.reporting_ledger = 'MANAGEMENT' then
    select string_agg(a.code, ', ') into v_bad
      from public.journal_lines l join public.accounts a on a.id = l.account_id
     where l.entry_id = e.id and not (a.account_type in ('revenue', 'expense') or a.is_management);
    if v_bad is not null then
      raise exception 'A management entry uses only income and expense accounts and the management adjustments account, not %', v_bad using errcode = '23514';
    end if;
  else
    select string_agg(a.code, ', ') into v_bad
      from public.journal_lines l join public.accounts a on a.id = l.account_id
     where l.entry_id = e.id and a.is_management;
    if v_bad is not null then
      raise exception 'The management adjustments account % is not used in the statutory books', v_bad using errcode = '23514';
    end if;
  end if;$x$);

-- the statutory reports read the statutory ledger only
select app._patch_function('public.finance_overview', $x$join public.journal_entries e on e.id = jl.entry_id$x$,
  $x$join public.journal_entries e on e.id = jl.entry_id and e.reporting_ledger = 'STATUTORY'$x$);
select app._patch_function('app.cit_compute', $x$join public.journal_entries e on e.id = jl.entry_id$x$,
  $x$join public.journal_entries e on e.id = jl.entry_id and e.reporting_ledger = 'STATUTORY'$x$);
select app._patch_function('public.year_end_check', $x$join public.journal_entries e on e.id = jl.entry_id$x$,
  $x$join public.journal_entries e on e.id = jl.entry_id and e.reporting_ledger = 'STATUTORY'$x$);
select app._patch_function('public.year_close', $x$join public.journal_entries e on e.id = jl.entry_id$x$,
  $x$join public.journal_entries e on e.id = jl.entry_id and e.reporting_ledger = 'STATUTORY'$x$);
select app._patch_function('public.migration_check', $x$join public.journal_entries e on e.id = l.entry_id$x$,
  $x$join public.journal_entries e on e.id = l.entry_id and e.reporting_ledger = 'STATUTORY'$x$);
-- a new chart comes with the management adjustments account
select app._patch_function('app.seed_finance_defaults',
  $x$  perform app.ensure_owner_account(p_company);$x$,
  $x$  perform app.ensure_owner_account(p_company);
  perform app.ensure_management_account(p_company);$x$);
drop function app._patch_function(text, text, text);

-- balances by ledger: statutory (default) or management (statutory + management adjustments)
drop function if exists public.account_balances(uuid, date, date, uuid);
create or replace function public.account_balances(p_company uuid, p_from date, p_to date, p_cost_center uuid default null, p_ledger text default 'STATUTORY')
returns table(account_id uuid, code text, name text, account_type text, account_subtype text, parent_id uuid, is_postable boolean,
              cash_flow_category text, opening numeric, debit numeric, credit numeric, closing numeric)
language sql stable set search_path = '' as $$
  with mv as (
    select jl.account_id,
           sum(case when e.entry_date < p_from then jl.debit - jl.credit else 0 end) as opening,
           sum(case when e.entry_date between p_from and p_to and coalesce(e.source_doc_type, '') <> 'year_close' then jl.debit else 0 end) as debit,
           sum(case when e.entry_date between p_from and p_to and coalesce(e.source_doc_type, '') <> 'year_close' then jl.credit else 0 end) as credit
      from public.journal_lines jl join public.journal_entries e on e.id = jl.entry_id
     where jl.company_id = p_company and e.status in ('posted','reversed') and e.entry_date <= p_to
       and (e.reporting_ledger = 'STATUTORY' or upper(coalesce(p_ledger, 'STATUTORY')) = 'MANAGEMENT')
       and (p_cost_center is null or jl.cost_center_id = p_cost_center)
     group by jl.account_id)
  select a.id, a.code, a.name, a.account_type, a.account_subtype, a.parent_id, a.is_postable, a.cash_flow_category,
         coalesce(mv.opening, 0), coalesce(mv.debit, 0), coalesce(mv.credit, 0),
         coalesce(mv.opening, 0) + coalesce(mv.debit, 0) - coalesce(mv.credit, 0)
    from public.accounts a left join mv on mv.account_id = a.id
   where a.company_id = p_company and a.deleted_at is null
     and (upper(coalesce(p_ledger, 'STATUTORY')) = 'MANAGEMENT' or not a.is_management)
   order by a.code
$$;
revoke execute on function public.account_balances(uuid, date, date, uuid, text) from public, anon;
grant execute on function public.account_balances(uuid, date, date, uuid, text) to authenticated;

-- the two ledgers as views; they keep the row-level security of the tables (each company its own entries)
create or replace view public.view_statutory_ledger with (security_invoker = true) as
  select e.company_id, e.id as entry_id, e.number, e.entry_date, e.journal_id, e.reference, e.memo, e.source_doc_type, e.source_doc_id,
         e.reporting_ledger, l.id as line_id, l.line_no, l.account_id, l.debit, l.credit, l.partner_id, l.cost_center_id, l.description
    from public.journal_entries e join public.journal_lines l on l.entry_id = e.id
   where e.status = 'posted' and e.reporting_ledger = 'STATUTORY' and e.deleted_at is null;
create or replace view public.view_management_ledger with (security_invoker = true) as
  select e.company_id, e.id as entry_id, e.number, e.entry_date, e.journal_id, e.reference, e.memo, e.source_doc_type, e.source_doc_id,
         e.reporting_ledger, l.id as line_id, l.line_no, l.account_id, l.debit, l.credit, l.partner_id, l.cost_center_id, l.description
    from public.journal_entries e join public.journal_lines l on l.entry_id = e.id
   where e.status = 'posted' and e.reporting_ledger in ('STATUTORY', 'MANAGEMENT') and e.deleted_at is null;
revoke all on public.view_statutory_ledger, public.view_management_ledger from public, anon;
grant select on public.view_statutory_ledger, public.view_management_ledger to authenticated;
