-- =============================================================================
-- DrisPRO · bank statements that settle invoices by themselves
--   After a statement is imported, matching first looks for payments already recorded (as
--   before). Then, for money that came in or went out without a payment yet, it looks for the
--   open invoice or vendor bill it pays:
--     sure  → the payment is made, posted and allocated at once:
--             * the invoice number (or the vendor's invoice number) is in the text and the amount fits
--             * the account (IBAN) belongs to a customer/vendor and one open invoice has exactly that
--               amount, or all their open invoices together do
--     likely → kept as a suggestion the person accepts with one tap:
--             * the name looks like the customer's/vendor's and an open invoice has that amount
--             * only one open invoice in the company has exactly that amount
--   An IBAN seen on a settled line is remembered on the customer/vendor, so next time it is sure.
-- =============================================================================

alter table public.business_partners add column bank_iban text;
create index business_partners_iban_idx on public.business_partners (company_id, upper(replace(bank_iban, ' ', ''))) where bank_iban is not null;
alter table public.bank_statement_lines add column suggestion jsonb;

create or replace function app.norm_ref(p text)
returns text language sql immutable set search_path = '' as $$ select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')) $$;

-- the documents a line may pay: {kind, partner_id, docs:[{id, open}], sure, reason}
create or replace function app.statement_candidate(p_line uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.bank_statement_lines; s public.bank_statements; ba public.bank_accounts; v_in boolean; v_amt numeric; v_text text; v_iban text;
  v_partner uuid; r record; v_docs jsonb; v_sum numeric; v_n int;
begin
  select * into l from public.bank_statement_lines where id = p_line;
  select * into s from public.bank_statements where id = l.statement_id;
  select * into ba from public.bank_accounts where id = s.bank_account_id;
  v_in := l.amount > 0; v_amt := abs(l.amount);
  v_text := app.norm_ref(coalesce(l.description, '') || ' ' || coalesce(l.reference, '') || ' ' || coalesce(l.counterparty_name, ''));
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

  -- 1) a document number in the text, and the amount fits in what is open
  select o.* into r from _open o
   where (length(app.norm_ref(o.number)) >= 4 and position(app.norm_ref(o.number) in v_text) > 0)
      or (length(app.norm_ref(o.ext)) >= 3 and position(app.norm_ref(o.ext) in v_text) > 0)
   order by (abs(o.open - v_amt) < 0.005) desc, o.due limit 1;
  if r.id is not null and v_amt <= r.open + 0.005 then
    return jsonb_build_object('partner_id', r.partner_id, 'docs', jsonb_build_array(jsonb_build_object('id', r.id, 'number', r.number, 'amount', least(v_amt, r.open))),
                              'sure', true, 'reason', 'number');
  end if;

  -- 2) the account belongs to a customer/vendor: one document with that amount, or all of theirs together
  if v_iban is not null then
    select o.partner_id into v_partner from _open o where o.iban = v_iban limit 1;
    if v_partner is null then select id into v_partner from public.business_partners where company_id = s.company_id and upper(replace(bank_iban, ' ', '')) = v_iban limit 1; end if;
    if v_partner is not null then
      select count(*) into v_n from _open where partner_id = v_partner and abs(open - v_amt) < 0.005;
      if v_n >= 1 then
        select jsonb_build_array(jsonb_build_object('id', o.id, 'number', o.number, 'amount', o.open)) into v_docs from _open o
         where o.partner_id = v_partner and abs(o.open - v_amt) < 0.005 order by o.due limit 1;
        return jsonb_build_object('partner_id', v_partner, 'docs', v_docs, 'sure', true, 'reason', 'account');
      end if;
      select sum(open), jsonb_agg(jsonb_build_object('id', id, 'number', number, 'amount', open) order by due) into v_sum, v_docs from _open where partner_id = v_partner;
      if v_sum is not null and abs(v_sum - v_amt) < 0.005 then
        return jsonb_build_object('partner_id', v_partner, 'docs', v_docs, 'sure', true, 'reason', 'account_all');
      end if;
    end if;
  end if;

  -- 3) the name looks like theirs and a document has that amount
  if coalesce(l.counterparty_name, l.description, '') <> '' then
    select o.* into r from _open o
     where abs(o.open - v_amt) < 0.005
       and greatest(extensions.similarity(lower(o.partner_name), lower(coalesce(l.counterparty_name, ''))),
                    extensions.word_similarity(lower(o.partner_name), lower(coalesce(l.counterparty_name, '') || ' ' || coalesce(l.description, '')))) >= 0.5
     order by o.due limit 1;
    if r.id is not null then
      return jsonb_build_object('partner_id', r.partner_id, 'docs', jsonb_build_array(jsonb_build_object('id', r.id, 'number', r.number, 'amount', r.open)),
                                'sure', false, 'reason', 'name');
    end if;
  end if;

  -- 4) only one open document in the company has exactly that amount
  select count(*) into v_n from _open where abs(open - v_amt) < 0.005;
  if v_n = 1 then
    select o.* into r from _open o where abs(o.open - v_amt) < 0.005;
    return jsonb_build_object('partner_id', r.partner_id, 'docs', jsonb_build_array(jsonb_build_object('id', r.id, 'number', r.number, 'amount', r.open)),
                              'sure', false, 'reason', 'amount');
  end if;
  return null;
end $$;
revoke execute on function app.statement_candidate(uuid) from public, anon, authenticated;

-- settle a line with its documents: a posted payment allocated to them, the line matched to it
create or replace function app.settle_statement_line(p_line uuid, p_cand jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare l public.bank_statement_lines; s public.bank_statements; ba public.bank_accounts; v_pay uuid; d jsonb; v_in boolean; c public.companies;
begin
  select * into l from public.bank_statement_lines where id = p_line for update;
  if l.match_status <> 'unmatched' then return null; end if;
  select * into s from public.bank_statements where id = l.statement_id;
  select * into ba from public.bank_accounts where id = s.bank_account_id;
  select * into c from public.companies where id = s.company_id;
  v_in := l.amount > 0;
  insert into public.payments (company_id, document_type, partner_id, payment_date, method, amount, currency_code, exchange_rate, bank_account_id, reference, notes)
  values (s.company_id, case when v_in then 'customer_payment' else 'vendor_payment' end, (p_cand ->> 'partner_id')::uuid, l.transaction_date, 'bank_transfer',
          abs(l.amount), ba.currency_code,
          case when ba.currency_code = c.base_currency then 1
               else coalesce((select x.rate from public.exchange_rates x where x.company_id = s.company_id and x.currency_code = ba.currency_code and x.rate_date <= l.transaction_date
                              order by x.rate_date desc limit 1), 1) end,
          ba.id, left(coalesce(l.reference, l.description), 120), 'Nga ekstrakti i bankës: ' || left(coalesce(l.description, ''), 200))
  returning id into v_pay;
  for d in select * from jsonb_array_elements(p_cand -> 'docs') loop
    insert into public.payment_allocations (company_id, payment_id, sales_invoice_id, vendor_bill_id, amount)
    values (s.company_id, v_pay, case when v_in then (d ->> 'id')::uuid end, case when not v_in then (d ->> 'id')::uuid end, (d ->> 'amount')::numeric);
  end loop;
  perform public.post_payment(v_pay);
  update public.bank_statement_lines set match_status = 'matched', matched_payment_id = v_pay, partner_id = (p_cand ->> 'partner_id')::uuid, suggestion = null where id = l.id;
  -- remember the account for next time
  if nullif(btrim(coalesce(l.counterparty_iban, '')), '') is not null then
    update public.business_partners set bank_iban = upper(replace(l.counterparty_iban, ' ', ''))
     where id = (p_cand ->> 'partner_id')::uuid and bank_iban is null;
  end if;
  return v_pay;
end $$;
revoke execute on function app.settle_statement_line(uuid, jsonb) from public, anon, authenticated;

-- every unmatched line: settle what is sure, keep a suggestion for what is likely
create or replace function public.settle_statement(p_statement uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.bank_statements; l record; v_c jsonb; n_sure int := 0; n_sug int := 0; n_err int := 0; v_pass int := 0; v_before int;
begin
  select * into s from public.bank_statements where id = p_statement;
  if s.id is null then raise exception 'Statement not found' using errcode = 'P0002'; end if;
  perform app.require_permission(s.company_id, 'finance.write');
  -- a settled line may teach an account that settles another: go round again while that happens
  loop
  v_pass := v_pass + 1; v_before := n_sure; n_sug := 0; n_err := 0;
  for l in select id from public.bank_statement_lines where statement_id = s.id and match_status = 'unmatched' order by transaction_date, id loop
    v_c := app.statement_candidate(l.id);
    if v_c is null then
      update public.bank_statement_lines set suggestion = null where id = l.id;
    elsif (v_c ->> 'sure')::boolean then
      begin
        perform app.settle_statement_line(l.id, v_c);
        n_sure := n_sure + 1;
      exception when others then
        -- e.g. a closed fiscal period: the person decides
        update public.bank_statement_lines set suggestion = v_c || jsonb_build_object('sure', false, 'error', sqlerrm) where id = l.id;
        n_err := n_err + 1;
      end;
    else
      update public.bank_statement_lines set suggestion = v_c where id = l.id;
      n_sug := n_sug + 1;
    end if;
  end loop;
  exit when n_sure = v_before or v_pass >= 3;
  end loop;
  return jsonb_build_object('settled', n_sure, 'suggested', n_sug, 'failed', n_err);
end $$;
grant execute on function public.settle_statement(uuid) to authenticated;

create or replace function public.accept_statement_suggestion(p_line uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare l public.bank_statement_lines; s public.bank_statements; v_c jsonb;
begin
  select * into l from public.bank_statement_lines where id = p_line;
  if l.id is null then raise exception 'Statement line not found' using errcode = 'P0002'; end if;
  select * into s from public.bank_statements where id = l.statement_id;
  perform app.require_permission(s.company_id, 'finance.write');
  if l.match_status <> 'unmatched' then raise exception 'The line is already %', l.match_status using errcode = '55000'; end if;
  -- the documents may have changed since: look again, the person already chose this line
  v_c := coalesce(app.statement_candidate(l.id), l.suggestion);
  if v_c is null then raise exception 'There is nothing to match this line with any more' using errcode = 'P0002'; end if;
  return app.settle_statement_line(l.id, v_c);
end $$;
grant execute on function public.accept_statement_suggestion(uuid) to authenticated;

create or replace function public.dismiss_statement_suggestion(p_line uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.bank_statements;
begin
  select st.* into s from public.bank_statements st join public.bank_statement_lines l on l.statement_id = st.id where l.id = p_line;
  perform app.require_permission(s.company_id, 'finance.write');
  update public.bank_statement_lines set suggestion = null where id = p_line;
end $$;
grant execute on function public.dismiss_statement_suggestion(uuid) to authenticated;
