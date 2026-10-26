-- =============================================================================
-- The bank statement settles itself, and learns
--   · several invoice numbers in one transfer ("fat. 123 dhe 124") are paid together
--   · a short number ("fatura 123") is found among the invoices of the payer it comes from
--   · the payer is known by their account, by what was decided before for that name, or by the name
--   · less than they owe: their oldest invoices first; or the two or three that add up to it
--   · fees, salaries, rent, loans: what a person recorded once for that text is proposed next time,
--     and after the second time done by itself
--   · "Accept all" settles every suggestion of a statement at once
-- =============================================================================

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_new in v_def) > 0 then return; end if;
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;

create table if not exists app.bank_rules (
  company_id uuid not null references public.companies(id) on delete cascade,
  key        text not null,          -- i:<IBAN>, n:<payer's name>, d:<the words of the text, without numbers>
  partner_id uuid,
  account_id uuid,
  memo       text,
  uses       int not null default 1,
  updated_at timestamptz not null default now(),
  primary key (company_id, key)
);
revoke all on app.bank_rules from public, anon, authenticated;

-- the keys a line is known by
create or replace function app.bank_line_keys(l public.bank_statement_lines)
returns text[] language sql immutable set search_path = '' as $$
  select array_remove(array[
    case when nullif(btrim(coalesce(l.counterparty_iban, '')), '') is not null then 'i:' || upper(replace(l.counterparty_iban, ' ', '')) end,
    case when length(app.read_key(l.counterparty_name)) >= 3 then 'n:' || app.read_key(l.counterparty_name) end,
    case when length(regexp_replace(lower(coalesce(l.description, '')), '[^[:alpha:]]+', '', 'g')) >= 6
         then 'd:' || left(regexp_replace(lower(coalesce(l.description, '')), '[^[:alpha:]]+', '', 'g'), 60) end], null)
$$;

create or replace function app.bank_learn(p_co uuid, l public.bank_statement_lines, p_partner uuid, p_account uuid, p_memo text)
returns void language sql security definer set search_path = '' as $$
  insert into app.bank_rules as r (company_id, key, partner_id, account_id, memo)
  select p_co, k, p_partner, p_account, p_memo from unnest(app.bank_line_keys(l)) k
   -- a payer's name and account point at the payer; the words of the text only teach accounts
   where p_account is not null or k not like 'd:%'
  on conflict (company_id, key) do update set
    uses = case when r.partner_id is not distinct from excluded.partner_id and r.account_id is not distinct from excluded.account_id then r.uses + 1 else 1 end,
    partner_id = excluded.partner_id, account_id = excluded.account_id, memo = excluded.memo, updated_at = now()
$$;

-- ---------------------------------------------------------------------------------------------
-- what a line most probably is
-- ---------------------------------------------------------------------------------------------
create or replace function app.statement_candidate(p_line uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.bank_statement_lines; s public.bank_statements; ba public.bank_accounts; v_in boolean; v_amt numeric; v_text text; v_words text; v_iban text;
  v_partner uuid; v_how text; r record; v_docs jsonb; v_sum numeric; v_n int; v_left numeric; rule app.bank_rules; v_sim numeric;
begin
  select * into l from public.bank_statement_lines where id = p_line;
  select * into s from public.bank_statements where id = l.statement_id;
  select * into ba from public.bank_accounts where id = s.bank_account_id;
  v_in := l.amount > 0; v_amt := abs(l.amount);
  v_text := app.norm_ref(coalesce(l.description, '') || ' ' || coalesce(l.reference, '') || ' ' || coalesce(l.counterparty_name, ''));
  v_words := ' ' || regexp_replace(coalesce(l.description, '') || ' ' || coalesce(l.reference, ''), '[^0-9]+', ' ', 'g') || ' ';
  v_iban := nullif(upper(replace(coalesce(l.counterparty_iban, ''), ' ', '')), '');

  -- open documents in the account's currency (other currencies are left to the person)
  if to_regclass('pg_temp._open') is null then
    create temp table _open (id uuid, partner_id uuid, number text, ext text, open numeric, due date, partner_name text, iban text) on commit drop;
  end if;
  truncate _open;
  if v_in then
    insert into _open select i.id, i.partner_id, i.number, null, i.amount_due, i.due_date, bp.name, upper(replace(bp.bank_iban, ' ', ''))
      from public.sales_invoices i join public.business_partners bp on bp.id = i.partner_id
     where i.company_id = s.company_id and i.status = 'posted' and i.deleted_at is null and i.document_type = 'sales_invoice'
       and i.payment_status <> 'paid' and i.amount_due > 0 and i.currency_code = ba.currency_code;
  else
    insert into _open select b.id, b.vendor_id, b.number, b.vendor_invoice_number, b.amount_due, b.due_date, bp.name, upper(replace(bp.bank_iban, ' ', ''))
      from public.vendor_bills b join public.business_partners bp on bp.id = b.vendor_id
     where b.company_id = s.company_id and b.status = 'posted' and b.deleted_at is null and b.document_type = 'vendor_bill'
       and b.payment_status <> 'paid' and b.amount_due > 0 and b.currency_code = ba.currency_code;
  end if;

  -- 1) document numbers in the text: one or several, paid together (oldest first when less is paid)
  select count(*), sum(open), count(distinct partner_id) into v_n, v_sum, v_left from _open o
   where (length(app.norm_ref(o.number)) >= 4 and position(app.norm_ref(o.number) in v_text) > 0)
      or (length(app.norm_ref(o.ext)) >= 3 and position(app.norm_ref(o.ext) in v_text) > 0);
  if v_n >= 1 and v_left = 1 then
    v_left := v_amt;
    select jsonb_agg(d) filter (where (d ->> 'amount')::numeric > 0), max(pid::text)::uuid into v_docs, v_partner from (
      select o.partner_id as pid, jsonb_build_object('id', o.id, 'number', o.number,
               'amount', round(greatest(least(o.open, v_amt - coalesce(sum(o.open) over (order by o.due, o.number rows between unbounded preceding and 1 preceding), 0)), 0), 2)) d
        from _open o
       where (length(app.norm_ref(o.number)) >= 4 and position(app.norm_ref(o.number) in v_text) > 0)
          or (length(app.norm_ref(o.ext)) >= 3 and position(app.norm_ref(o.ext) in v_text) > 0)
       order by o.due, o.number) x;
    return jsonb_build_object('partner_id', v_partner, 'docs', v_docs, 'sure', v_amt <= v_sum + 0.005,
      'reason', case when v_n > 1 then 'numbers' else 'number' end);
  end if;

  -- 2) who paid: their account, what was decided before for this account or name, or a name that looks like theirs
  if v_iban is not null then
    select id into v_partner from public.business_partners where company_id = s.company_id and deleted_at is null and upper(replace(bank_iban, ' ', '')) = v_iban limit 1;
    if v_partner is not null then v_how := 'account'; end if;
  end if;
  if v_partner is null then
    select * into rule from app.bank_rules where company_id = s.company_id and partner_id is not null and account_id is null
       and key = any (app.bank_line_keys(l)) order by key limit 1;   -- i: before n:
    if rule.partner_id is not null then v_partner := rule.partner_id; v_how := 'learned'; end if;
  end if;
  if v_partner is null and coalesce(l.counterparty_name, '') <> '' then
    select o.partner_id, greatest(extensions.similarity(lower(o.partner_name), lower(l.counterparty_name)),
                                  extensions.word_similarity(lower(o.partner_name), lower(l.counterparty_name || ' ' || coalesce(l.description, ''))))
      into v_partner, v_sim from _open o
     order by 2 desc limit 1;
    if coalesce(v_sim, 0) >= 0.5 then v_how := 'name'; else v_partner := null; end if;
  end if;

  if v_partner is not null and exists (select 1 from _open where partner_id = v_partner) then
    -- a short number of one of their invoices ("fatura 123")
    select o.* into r from _open o where o.partner_id = v_partner
       and (position(' ' || ltrim(substring(o.number from '(\d+)\D*$'), '0') || ' ' in v_words) > 0
            or (o.ext is not null and position(' ' || ltrim(substring(o.ext from '(\d+)\D*$'), '0') || ' ' in v_words) > 0))
       and ltrim(substring(o.number from '(\d+)\D*$'), '0') <> ''
     order by abs(o.open - v_amt), o.due limit 1;
    if r.id is not null and v_amt <= r.open + 0.005 then
      return jsonb_build_object('partner_id', v_partner, 'docs', jsonb_build_array(jsonb_build_object('id', r.id, 'number', r.number, 'amount', least(v_amt, r.open))),
                                'sure', v_how <> 'name', 'reason', 'number');
    end if;
    -- one invoice with exactly that amount
    select o.* into r from _open o where o.partner_id = v_partner and abs(o.open - v_amt) < 0.005 order by o.due limit 1;
    if r.id is not null then
      return jsonb_build_object('partner_id', v_partner, 'docs', jsonb_build_array(jsonb_build_object('id', r.id, 'number', r.number, 'amount', r.open)),
                                'sure', v_how <> 'name', 'reason', case v_how when 'name' then 'name' when 'learned' then 'learned' else 'account' end);
    end if;
    -- all of them together
    select sum(open), jsonb_agg(jsonb_build_object('id', id, 'number', number, 'amount', open) order by due) into v_sum, v_docs from _open where partner_id = v_partner;
    if abs(v_sum - v_amt) < 0.005 then
      return jsonb_build_object('partner_id', v_partner, 'docs', v_docs, 'sure', v_how <> 'name', 'reason', 'account_all');
    end if;
    -- two or three of them that add up to it
    select a.id as a_id, b.id as b_id, c.id as c_id into r
      from (select * from _open where partner_id = v_partner order by due limit 25) a
      join (select * from _open where partner_id = v_partner order by due limit 25) b on b.due > a.due or (b.due = a.due and b.id > a.id)
      left join lateral (select c0.id from _open c0 where c0.partner_id = v_partner and (c0.due > b.due or (c0.due = b.due and c0.id > b.id))
                           and abs(a.open + b.open + c0.open - v_amt) < 0.005 limit 1) c on abs(a.open + b.open - v_amt) >= 0.005
     where abs(a.open + b.open - v_amt) < 0.005 or c.id is not null
     order by c.id is null desc limit 1;
    if r.a_id is not null then
      select jsonb_agg(jsonb_build_object('id', o.id, 'number', o.number, 'amount', o.open) order by o.due) into v_docs
        from _open o where o.id in (r.a_id, r.b_id, r.c_id);
      return jsonb_build_object('partner_id', v_partner, 'docs', v_docs, 'sure', false, 'reason', 'combination');
    end if;
    -- less than they owe: the oldest first
    if v_amt < v_sum then
      select jsonb_agg(d) filter (where (d ->> 'amount')::numeric > 0) into v_docs from (
        select jsonb_build_object('id', o.id, 'number', o.number,
                 'amount', round(greatest(least(o.open, v_amt - coalesce(sum(o.open) over (order by o.due, o.number rows between unbounded preceding and 1 preceding), 0)), 0), 2)) d
          from _open o where o.partner_id = v_partner order by o.due, o.number) x;
      return jsonb_build_object('partner_id', v_partner, 'docs', v_docs, 'sure', false, 'reason', 'oldest');
    end if;
  end if;

  -- 3) what a person recorded before for this text, account or name: an account (fees, salaries, rent, a loan…)
  select * into rule from app.bank_rules where company_id = s.company_id and account_id is not null and key = any (app.bank_line_keys(l))
   order by uses desc, key limit 1;
  if rule.account_id is not null and exists (select 1 from public.accounts where id = rule.account_id and is_postable and deleted_at is null) then
    return jsonb_build_object('account_id', rule.account_id, 'account', (select code || ' ' || name from public.accounts where id = rule.account_id),
      'partner_id', rule.partner_id, 'memo', rule.memo, 'sure', rule.uses >= 2, 'reason', 'learned_account');
  end if;

  -- 4) only one open document in the company has exactly that amount
  select count(*) into v_n from _open where abs(open - v_amt) < 0.005;
  if v_n = 1 then
    select o.* into r from _open o where abs(o.open - v_amt) < 0.005;
    return jsonb_build_object('partner_id', r.partner_id, 'docs', jsonb_build_array(jsonb_build_object('id', r.id, 'number', r.number, 'amount', r.open)),
                              'sure', false, 'reason', 'amount');
  end if;

  -- 5) a small charge of the bank itself
  if not v_in and v_amt < 100 and lower(coalesce(l.description, '') || ' ' || coalesce(l.reference, '')) ~ '(provizion|komision|tarif|mir[eë]mbajtj|fee|charge|commission|maintenance|interes)' then
    return jsonb_build_object('account_id', app.acct(s.company_id, 'bank_charges'), 'account', (select code || ' ' || name from public.accounts where id = app.acct(s.company_id, 'bank_charges')),
      'memo', l.description, 'sure', false, 'reason', 'fees');
  end if;
  return null;
end $$;

-- settling a line: an invoice payment, or an entry to an account
create or replace function app.apply_statement_candidate(p_line uuid, p_cand jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if p_cand ? 'account_id' then
    return public.book_statement_line(p_line, (p_cand ->> 'account_id')::uuid, p_cand ->> 'memo', nullif(p_cand ->> 'partner_id', '')::uuid);
  end if;
  return app.settle_statement_line(p_line, p_cand);
end $$;

do $$ begin
  perform app._patch_function('public.settle_statement', 'perform app.settle_statement_line(l.id, v_c);', 'perform app.apply_statement_candidate(l.id, v_c);');
  perform app._patch_function('public.accept_statement_suggestion', 'return app.settle_statement_line(l.id, v_c);', 'return app.apply_statement_candidate(l.id, v_c);');
  -- what a person decides is remembered
  perform app._patch_function('app.settle_statement_line',
    '  -- remember the account for next time',
    '  perform app.bank_learn(s.company_id, l, (p_cand ->> ''partner_id'')::uuid, null, null);
  -- remember the account for next time');
  perform app._patch_function('public.book_statement_line',
    '   where id = l.id;
  return v_je;',
    '   where id = l.id;
  perform app.bank_learn(s.company_id, l, p_partner, p_account, p_memo);
  return v_je;');
end $$;

-- every suggestion of a statement at once
create or replace function public.accept_all_statement_suggestions(p_statement uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.bank_statements; l record; n int := 0; e int := 0;
begin
  select * into s from public.bank_statements where id = p_statement;
  if s.id is null then raise exception 'Statement not found' using errcode = 'P0002'; end if;
  perform app.require_permission(s.company_id, 'finance.write');
  for l in select id from public.bank_statement_lines where statement_id = s.id and match_status = 'unmatched' and suggestion is not null order by transaction_date, id loop
    begin
      perform public.accept_statement_suggestion(l.id);
      n := n + 1;
    exception when others then
      update public.bank_statement_lines set suggestion = suggestion || jsonb_build_object('error', sqlerrm) where id = l.id;
      e := e + 1;
    end;
  end loop;
  return jsonb_build_object('accepted', n, 'failed', e);
end $$;
revoke execute on function public.accept_all_statement_suggestions(uuid) from public, anon;
grant execute on function public.accept_all_statement_suggestions(uuid) to authenticated;

drop function app._patch_function(text, text, text);
