-- =============================================================================
-- DrisPRO · the finance overview reads the journal once for its 12 months (11.11.2026, the big check)
--   It scanned the journal twice for every month: 2 seconds on six weeks of a market, far more after a year.
--   The same figures, one pass.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.finance_overview(p_company uuid, p_from date DEFAULT make_date((EXTRACT(year FROM CURRENT_DATE))::integer, 1, 1), p_to date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with b as (select * from public.account_balances(p_company, p_from, p_to)),
  vat as (select account_id from public.company_account_defaults where company_id = p_company and key in ('vat_output','vat_input','vat_settlement')
          union select output_account_id from public.tax_codes where company_id = p_company and output_account_id is not null
          union select input_account_id from public.tax_codes where company_id = p_company and input_account_id is not null),
  -- one pass over the journal for the 12 months (was: two scans for every month)
  mo as (select date_trunc('month', e.entry_date) as mm,
                sum(jl.debit - jl.credit) filter (where a.account_subtype in ('cash','bank')) as cash,
                -sum(jl.debit - jl.credit) filter (where a.account_type in ('revenue','expense') and coalesce(e.source_doc_type, '') <> 'year_close') as profit
           from public.journal_lines jl join public.journal_entries e on e.id = jl.entry_id and e.reporting_ledger = 'STATUTORY'
           join public.accounts a on a.id = jl.account_id
          where jl.company_id = p_company and e.status in ('posted','reversed') and e.entry_date < date_trunc('month', p_to) + interval '1 month'
          group by 1),
  pay as (select account_id from public.company_account_defaults where company_id = p_company
             and key in ('salary_payable','social_security_payable','health_insurance_payable','pension_payable','income_tax_payable'))
  select jsonb_build_object(
    'revenue',  -coalesce((select sum(debit - credit) from b where account_type = 'revenue' and account_subtype = 'revenue'), 0),
    'other_income', -coalesce((select sum(debit - credit) from b where account_type = 'revenue' and account_subtype = 'other_income'), 0),
    'cogs',     coalesce((select sum(debit - credit) from b where account_subtype = 'cogs'), 0),
    'expenses', coalesce((select sum(debit - credit) from b where account_type = 'expense' and account_subtype <> 'cogs'), 0),
    'net_profit', -coalesce((select sum(debit - credit) from b where account_type in ('revenue','expense')), 0),
    'cash', coalesce((select sum(closing) from b where account_subtype in ('cash','bank')), 0),
    'receivables', coalesce((select sum(closing) from b where account_subtype = 'receivable'), 0),
    'payables', -coalesce((select sum(closing) from b where account_subtype = 'payable'), 0),
    'inventory', coalesce((select sum(closing) from b where account_subtype = 'inventory'), 0),
    'vat_due', -coalesce((select sum(closing) from b where account_id in (select account_id from vat)), 0),
    'payroll_due', -coalesce((select sum(closing) from b where account_id in (select account_id from pay)), 0),
    'ar_overdue', coalesce((select sum(d1_30 + d31_60 + d61_90 + d90_plus) from public.partner_aging(p_company, 'ar', p_to)), 0),
    'ap_overdue', coalesce((select sum(d1_30 + d31_60 + d61_90 + d90_plus) from public.partner_aging(p_company, 'ap', p_to)), 0),
    'unmatched_bank_lines', (select count(*) from public.bank_statement_lines where company_id = p_company and match_status = 'unmatched'),
    'draft_entries', (select count(*) from public.journal_entries where company_id = p_company and status = 'draft' and deleted_at is null),
    'cash_by_month', coalesce((select jsonb_agg(x order by x.month) from (
        select to_char(g.m, 'YYYY-MM') as month,
               coalesce((select sum(mo.cash) from mo where mo.mm <= g.m), 0) as cash,
               coalesce((select mo.profit from mo where mo.mm = g.m), 0) as profit
          from generate_series(date_trunc('month', p_to) - interval '11 months', date_trunc('month', p_to), interval '1 month') g(m)) x), '[]'::jsonb)
  )
$function$;
