-- =============================================================================
-- DrisPRO · the books check finds four more things (audit, wave 1)
--   * cash below zero: a till or cash box whose balance in the books is negative
--   * fiscalization refused in the last 90 days (and not sent again since)
--   * bank lines left unmatched for more than 30 days
--   * cash payments to or from a business above the cash limit, this year
--     (the limit is a company setting: empty means the default of the country, 300 € in Kosovo
--      and 150 000 lekë in Albania; the rules change, so the owner can set the one in force)
-- =============================================================================

alter table public.company_settings add column if not exists cash_payment_limit numeric(18,2) check (cash_payment_limit is null or cash_payment_limit > 0);
comment on column public.company_settings.cash_payment_limit is 'Largest payment in cash to or from a business; empty: the default of the country';

create or replace function app.cash_limit(p_company uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce((select s.cash_payment_limit from public.company_settings s where s.company_id = p_company),
                  case (select c.country_code from public.companies c where c.id = p_company) when 'AL' then 150000 else 300 end)
$$;
revoke all on function app.cash_limit(uuid) from public, anon;

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_def text; v_oid oid;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname || '.' || p.proname = p_name order by p.oid desc limit 1;
  if v_oid is null then raise exception 'function % not found', p_name; end if;
  v_def := pg_get_functiondef(v_oid);
  if position(p_new in v_def) > 0 then return; end if;
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply', p_name; end if;
  execute replace(v_def, p_old, p_new);
end $$;

select app._patch_function('app.books_check', $x$  return v_out;
end$x$, $x$  -- cash below zero: a till or cash box whose balance in the books is negative
  select count(*) n, coalesce(jsonb_agg(jsonb_build_object('label', name, 'detail', bal, 'href', '/finance/cash-book') order by bal) filter (where rn <= 5), '[]') items
    into r from (
      select ba.name, round(sum(jl.debit - jl.credit), 2) bal, row_number() over (order by sum(jl.debit - jl.credit)) rn
        from public.bank_accounts ba join public.journal_lines jl on jl.account_id = ba.account_id and jl.company_id = ba.company_id
        join public.journal_entries e on e.id = jl.entry_id and e.status in ('posted', 'reversed')
       where ba.company_id = p_company and ba.account_kind = 'cash' and ba.deleted_at is null
       group by ba.id, ba.name having sum(jl.debit - jl.credit) < -0.005) x;
  if r.n > 0 then v_out := v_out || jsonb_build_object('code', 'cash_negative', 'count', r.n, 'items', r.items, 'href', '/finance/cash-book'); end if;

  -- fiscalization refused in the last 90 days, not sent again since
  select count(*) n, coalesce(jsonb_agg(jsonb_build_object('label', label, 'detail', msg, 'href', '/tax/fiscalization') order by at desc) filter (where rn <= 5), '[]') items
    into r from (
      select coalesce(si.number, po.number, f.source_doc_type) label, left(coalesce(f.error_message, f.error_code, ''), 120) msg, f.created_at at,
             row_number() over (order by f.created_at desc) rn
        from public.fiscalization_records f
        left join public.sales_invoices si on si.id = f.source_doc_id and f.source_doc_type in ('sales_invoice', 'credit_note')
        left join public.pos_orders po on po.id = f.source_doc_id and f.source_doc_type = 'pos_order'
       where f.company_id = p_company and f.status = 'failed' and f.created_at >= now() - interval '90 days'
         and not exists (select 1 from public.fiscalization_records g where g.source_doc_id = f.source_doc_id and g.status = 'fiscalized')) x;
  if r.n > 0 then v_out := v_out || jsonb_build_object('code', 'fiscal_failed', 'count', r.n, 'items', r.items, 'href', '/tax/fiscalization'); end if;

  -- bank lines unmatched for more than 30 days
  select count(*) n, coalesce(jsonb_agg(jsonb_build_object('label', label, 'detail', amount, 'href', '/finance/bank/statements/' || statement_id) order by d) filter (where rn <= 5), '[]') items
    into r from (
      select l.statement_id, l.transaction_date d, l.amount, to_char(l.transaction_date, 'DD.MM.YYYY') || ' · ' || coalesce(nullif(l.counterparty_name, ''), left(l.description, 60), '—') label,
             row_number() over (order by l.transaction_date) rn
        from public.bank_statement_lines l
       where l.company_id = p_company and l.match_status = 'unmatched' and l.transaction_date < current_date - 30) x;
  if r.n > 0 then v_out := v_out || jsonb_build_object('code', 'bank_unmatched_old', 'count', r.n, 'items', r.items, 'href', '/finance/bank'); end if;

  -- cash payments to or from a business above the cash limit, this year
  select count(*) n, coalesce(jsonb_agg(jsonb_build_object('label', label, 'detail', amt, 'href', '/finance/payments') order by d desc) filter (where rn <= 5), '[]') items
    into r from (
      select p.number || ' · ' || bp.name label, p.amount_base amt, p.payment_date d, row_number() over (order by p.payment_date desc) rn
        from public.payments p join public.business_partners bp on bp.id = p.partner_id
        left join public.bank_accounts ba on ba.id = p.bank_account_id
       where p.company_id = p_company and p.status = 'posted' and p.deleted_at is null and bp.kind = 'company'
         and (p.method = 'cash' or ba.account_kind = 'cash')
         and p.payment_date >= date_trunc('year', current_date) and p.amount_base > app.cash_limit(p_company)) x;
  if r.n > 0 then v_out := v_out || jsonb_build_object('code', 'cash_over_limit', 'count', r.n, 'items', r.items, 'href', '/finance/payments',
                                                       'limit', app.cash_limit(p_company)); end if;
  return v_out;
end$x$);
drop function app._patch_function(text, text, text);
