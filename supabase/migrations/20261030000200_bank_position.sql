-- =============================================================================
-- Bank position: for every bank and cash account, the balance in the books next to
-- the balance on the bank's last statement, and what explains the difference:
--   * on the statement, not in the books yet (statement lines not matched)
--   * in the books, not on the statement yet (payments and entries the bank has not shown)
-- =============================================================================

create or replace function public.bank_position(p_company uuid, p_as_of date default current_date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_out jsonb;
begin
  perform app.require_permission(p_company, 'finance.read');

  with acc as (
    select ba.id, ba.name, ba.account_kind, ba.currency_code, ba.bank_name, ba.iban, ba.account_id
      from public.bank_accounts ba
     where ba.company_id = p_company and ba.is_active and ba.deleted_at is null
  ),
  -- the account's movements in its own currency (base-currency accounts: debit − credit)
  mv as (
    select a.id as bank_id, jl.id as line_id, jl.entry_id, je.entry_date, je.number as entry_number, coalesce(jl.description, je.memo) as description,
           case when jl.currency_code = a.currency_code and jl.amount_currency is not null then jl.amount_currency else jl.debit - jl.credit end as amount
      from acc a
      join public.journal_lines jl on jl.account_id = a.account_id
      join public.journal_entries je on je.id = jl.entry_id and je.status = 'posted' and je.deleted_at is null
     where je.company_id = p_company and je.entry_date <= p_as_of
  ),
  last_st as (
    select distinct on (s.bank_account_id) s.bank_account_id, s.id, s.statement_date, s.closing_balance, s.status, s.reference
      from public.bank_statements s
     where s.company_id = p_company and s.deleted_at is null and s.statement_date <= p_as_of
     order by s.bank_account_id, s.statement_date desc, s.created_at desc
  ),
  first_day as (
    select s.bank_account_id, min(coalesce(l.transaction_date, s.statement_date)) as d
      from public.bank_statements s left join public.bank_statement_lines l on l.statement_id = s.id
     where s.company_id = p_company and s.deleted_at is null group by s.bank_account_id
  ),
  -- what the statements already explain: matched payments, matched lines, entries booked from a line
  seen as (
    select p.journal_entry_id as entry_id, null::uuid as line_id from public.bank_statement_lines l join public.payments p on p.id = l.matched_payment_id
     where l.company_id = p_company and p.journal_entry_id is not null
    union all select null, l.matched_journal_line_id from public.bank_statement_lines l where l.company_id = p_company and l.matched_journal_line_id is not null
    union all select l.journal_entry_id, null from public.bank_statement_lines l where l.company_id = p_company and l.journal_entry_id is not null
  ),
  not_in_bank as (
    select m.* from mv m
      join last_st ls on ls.bank_account_id = m.bank_id
      join first_day fd on fd.bank_account_id = m.bank_id
     where m.entry_date between fd.d and ls.statement_date
       and not exists (select 1 from seen s where s.entry_id = m.entry_id or s.line_id = m.line_id)
  ),
  not_in_books as (
    select s.bank_account_id as bank_id, l.id, l.transaction_date, l.description, l.counterparty_name, l.amount, s.id as statement_id
      from public.bank_statement_lines l join public.bank_statements s on s.id = l.statement_id
     where l.company_id = p_company and s.deleted_at is null and s.statement_date <= p_as_of
       and l.match_status = 'unmatched' and l.journal_entry_id is null
  ),
  rows as (
    select a.*,
           round(coalesce((select sum(amount) from mv where mv.bank_id = a.id), 0), 2) as book_now,
           round(coalesce((select sum(debit - credit) from public.journal_lines jl join public.journal_entries je on je.id = jl.entry_id
                            where jl.account_id = a.account_id and je.status = 'posted' and je.deleted_at is null and je.entry_date <= p_as_of), 0), 2) as book_base,
           ls.id as st_id, ls.statement_date, ls.closing_balance, ls.status as st_status, ls.reference as st_reference,
           case when ls.id is not null then round(coalesce((select sum(amount) from mv where mv.bank_id = a.id and mv.entry_date <= ls.statement_date), 0), 2) end as book_at_st,
           round(coalesce((select sum(amount) from not_in_books n where n.bank_id = a.id), 0), 2) as nib_sum,
           (select count(*) from not_in_books n where n.bank_id = a.id) as nib_n,
           round(coalesce((select sum(amount) from not_in_bank n where n.bank_id = a.id), 0), 2) as nibank_sum,
           (select count(*) from not_in_bank n where n.bank_id = a.id) as nibank_n,
           round(coalesce((select sum(amount) from mv where mv.bank_id = a.id and mv.entry_date > p_as_of - 30 and amount > 0), 0), 2) as in_30,
           round(coalesce((select -sum(amount) from mv where mv.bank_id = a.id and mv.entry_date > p_as_of - 30 and amount < 0), 0), 2) as out_30
      from acc a left join last_st ls on ls.bank_account_id = a.id
  )
  select jsonb_build_object(
    'as_of', p_as_of,
    'base_currency', (select base_currency from public.companies where id = p_company),
    'accounts', coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'name', r.name, 'kind', r.account_kind, 'currency', r.currency_code, 'bank_name', r.bank_name, 'iban', r.iban, 'account_id', r.account_id,
        'book_balance', r.book_now, 'book_balance_base', r.book_base, 'in_30', r.in_30, 'out_30', r.out_30,
        'statement', case when r.st_id is not null then jsonb_build_object(
            'id', r.st_id, 'date', r.statement_date, 'closing', r.closing_balance, 'status', r.st_status, 'reference', r.st_reference,
            'days_old', p_as_of - r.statement_date,
            'book_at_date', r.book_at_st,
            'difference', round(r.closing_balance - r.book_at_st, 2),
            'not_in_books', r.nib_sum, 'not_in_books_count', r.nib_n,
            'not_in_bank', r.nibank_sum, 'not_in_bank_count', r.nibank_n,
            -- statement = books + what only the bank has − what only the books have; the rest is not explained
            'unexplained', round(r.closing_balance - r.book_at_st - r.nib_sum + r.nibank_sum, 2)) end,
        'not_in_books_items', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'date', n.transaction_date, 'description', coalesce(n.counterparty_name, n.description),
                                                                            'amount', n.amount, 'statement_id', n.statement_id) order by n.transaction_date desc)
                                          from (select * from not_in_books n where n.bank_id = r.id order by n.transaction_date desc limit 30) n), '[]'),
        'not_in_bank_items', coalesce((select jsonb_agg(jsonb_build_object('entry_id', n.entry_id, 'date', n.entry_date, 'number', n.entry_number, 'description', n.description,
                                                                          'amount', round(n.amount, 2)) order by n.entry_date desc)
                                         from (select * from not_in_bank n where n.bank_id = r.id order by n.entry_date desc limit 30) n), '[]')
      ) order by r.account_kind, r.name), '[]')
  ) into v_out
  from rows r;
  return v_out;
end $$;

revoke execute on function public.bank_position(uuid, date) from public, anon;
grant execute on function public.bank_position(uuid, date) to authenticated;
