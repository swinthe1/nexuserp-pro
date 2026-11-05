-- =============================================================================
-- From the meeting with the administrative staff:
--   #11 paying a supplier or an expense with cash from the till: the payment goes onto the
--       supplier's card at once (its open invoices, oldest first, or the ones chosen), the expense
--       into the books with the shop's cost centre; both leave the drawer like a cash out
--   #26 an item taken off at the till: the store's managers are told at once (DrisPRO and phone),
--       and on WhatsApp when numbers are given; the company chooses whether a PIN is still asked
-- =============================================================================

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

-- ---------------------------------------------------------------- choices of the company
alter table public.company_settings
  add column if not exists pos_payouts text not null default 'manager' check (pos_payouts in ('off', 'manager', 'anyone')),
  add column if not exists pos_void_notify boolean not null default false,
  add column if not exists pos_void_notify_over numeric(18,2) not null default 0 check (pos_void_notify_over >= 0),
  add column if not exists pos_void_whatsapp text[] not null default '{}';

select app._patch_function('public.automation_settings_save',
  $x$  if p_patch ?| array['pos_cash_tolerance', 'pos_count_notes', 'pos_void_approval', 'pos_close_witness'] then$x$,
  $x$  if p_patch ?| array['pos_cash_tolerance', 'pos_count_notes', 'pos_void_approval', 'pos_close_witness', 'pos_payouts', 'pos_void_notify', 'pos_void_notify_over', 'pos_void_whatsapp'] then$x$);
select app._patch_function('public.automation_settings_save',
  $x$    pos_void_approval = coalesce((p_patch ->> 'pos_void_approval')::boolean, pos_void_approval),$x$,
  $x$    pos_void_approval = coalesce((p_patch ->> 'pos_void_approval')::boolean, pos_void_approval),
    pos_payouts = coalesce(p_patch ->> 'pos_payouts', pos_payouts),
    pos_void_notify = coalesce((p_patch ->> 'pos_void_notify')::boolean, pos_void_notify),
    pos_void_notify_over = coalesce((p_patch ->> 'pos_void_notify_over')::numeric, pos_void_notify_over),
    pos_void_whatsapp = case when p_patch ? 'pos_void_whatsapp'
      then coalesce((select array_agg(btrim(x)) from jsonb_array_elements_text(p_patch -> 'pos_void_whatsapp') x where btrim(x) <> ''), '{}')
      else pos_void_whatsapp end,$x$);

-- the till knows who may pay out
select app._patch_function('public.pos_till_options',
  $x$'managers', app.pos_managers(v_co));$x$,
  $x$'managers', app.pos_managers(v_co),
    'payouts', coalesce((select pos_payouts from public.company_settings where company_id = v_co), 'manager'));$x$);

-- ---------------------------------------------------------------- the manager's PIN also for a payment
alter table app.pos_approvals drop constraint if exists pos_approvals_purpose_check;
alter table app.pos_approvals add constraint pos_approvals_purpose_check check (purpose in ('void', 'close', 'payout'));
select app._patch_function('public.pos_approve',
  $x$if p_purpose not in ('void', 'close') then$x$,
  $x$if p_purpose not in ('void', 'close', 'payout') then$x$);
-- like a closing: good once, for 10 minutes
select app._patch_function('app.pos_approval_user',
  $x$  if p_purpose = 'close' then$x$,
  $x$  if p_purpose in ('close', 'payout') then$x$);

-- ---------------------------------------------------------------- what a cash out was for
alter table public.pos_cash_movements
  add column if not exists kind        text not null default 'cash' check (kind in ('cash', 'supplier', 'expense')),
  add column if not exists partner_id  uuid,
  add column if not exists payment_id  uuid,
  add column if not exists account_id  uuid,
  add column if not exists document_no text,
  add column if not exists approved_by uuid references auth.users(id),
  add column if not exists journal_entry_id uuid;
create index if not exists pos_cash_movements_partner_idx on public.pos_cash_movements (company_id, partner_id) where partner_id is not null;

-- the shop's cost centre: the one with the code of the till's store
create or replace function app.pos_cost_center(p_register uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select cc.id from public.pos_registers r join public.warehouses w on w.id = r.warehouse_id
    join public.cost_centers cc on cc.company_id = r.company_id and lower(cc.code) = lower(w.code)
   where r.id = p_register limit 1
$$;
revoke execute on function app.pos_cost_center(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- whom the till can pay
-- suppliers with what is still owed to them, and the expense accounts
create or replace function public.pos_payees(p_register uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_co uuid; v_cur text;
begin
  select company_id into v_co from public.pos_registers where id = p_register;
  if v_co is null then raise exception 'Register not found' using errcode = 'P0002'; end if;
  perform app.require_permission(v_co, 'pos.write');
  select base_currency into v_cur from public.companies where id = v_co;
  return jsonb_build_object(
    'payouts', coalesce((select pos_payouts from public.company_settings where company_id = v_co), 'manager'),
    'vendors', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name, 'tax_number', p.tax_number, 'open', coalesce(o.open, 0))
                       order by coalesce(o.open, 0) = 0, p.name)
        from public.business_partners p
        left join lateral (select sum(b.total - b.amount_paid) as open from public.vendor_bills b
                            where b.company_id = v_co and b.vendor_id = p.id and b.status = 'posted' and b.document_type = 'vendor_bill'
                              and b.currency_code = v_cur and b.deleted_at is null and b.total > b.amount_paid) o on true
       where p.company_id = v_co and p.is_vendor and p.is_active and p.deleted_at is null), '[]'::jsonb),
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'code', a.code, 'name', a.name) order by a.code)
        from public.accounts a
       where a.company_id = v_co and a.account_type = 'expense' and a.account_subtype in ('expense', 'other_expense')
         and a.is_postable and a.is_active and a.deleted_at is null), '[]'::jsonb));
end $$;
revoke execute on function public.pos_payees(uuid) from public, anon;
grant execute on function public.pos_payees(uuid) to authenticated;

-- a supplier's open invoices, oldest first
create or replace function public.pos_vendor_bills(p_register uuid, p_vendor uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_co uuid;
begin
  select company_id into v_co from public.pos_registers where id = p_register;
  if v_co is null then raise exception 'Register not found' using errcode = 'P0002'; end if;
  perform app.require_permission(v_co, 'pos.write');
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', b.id, 'number', b.number, 'vendor_invoice_number', b.vendor_invoice_number,
                                        'bill_date', b.bill_date, 'due_date', b.due_date, 'total', b.total, 'open', b.total - b.amount_paid)
                     order by b.bill_date, b.number)
      from public.vendor_bills b
     where b.company_id = v_co and b.vendor_id = p_vendor and b.status = 'posted' and b.document_type = 'vendor_bill'
       and b.currency_code = (select base_currency from public.companies where id = v_co)
       and b.deleted_at is null and b.total > b.amount_paid), '[]'::jsonb);
end $$;
revoke execute on function public.pos_vendor_bills(uuid, uuid) from public, anon;
grant execute on function public.pos_vendor_bills(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- paying from the drawer
-- p: {kind: supplier | expense, amount, partner_id, bills: [{id, amount}] (else oldest first),
--     account_id, note, document_no, approval}
create or replace function public.pos_pay_out(p_session uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.pos_sessions; r public.pos_registers; v_mode text; v_kind text := p ->> 'kind'; v_amt numeric := round(coalesce((p ->> 'amount')::numeric, 0), 2);
  v_by uuid; v_tz text; v_date date; v_cur text; v_in_drawer numeric; v_partner public.business_partners; v_acc public.accounts;
  v_pay uuid; v_left numeric; b record; v_take numeric; v_period text; v_mv uuid; v_je uuid; v_note text := nullif(btrim(p ->> 'note'), '');
  v_doc text := nullif(btrim(p ->> 'document_no'), ''); v_reason text; v_allocated numeric := 0; x jsonb; a record;
begin
  select * into s from public.pos_sessions where id = p_session for update;
  if s.id is null then raise exception 'Session not found' using errcode = 'P0002'; end if;
  perform app.require_permission(s.company_id, 'pos.write');
  if s.status <> 'open' then raise exception 'Session % is closed', s.number using errcode = '55000'; end if;
  select * into r from public.pos_registers where id = s.register_id;
  if v_kind not in ('supplier', 'expense') then raise exception 'Choose a supplier or an expense' using errcode = '22023'; end if;
  if v_amt <= 0 then raise exception 'Enter an amount' using errcode = '23514'; end if;

  -- who may: the company's choice; a cashier without the right asks for a manager's PIN
  select coalesce(pos_payouts, 'manager') into v_mode from public.company_settings where company_id = s.company_id;
  v_mode := coalesce(v_mode, 'manager');
  if v_mode = 'off' then raise exception 'Payments from the till are switched off. They are made in Finance.' using errcode = '42501'; end if;
  if v_mode = 'manager' and not app.has_permission(s.company_id, 'pos.approve') then
    v_by := app.pos_approval_user(s.company_id, p ->> 'approval', 'payout');
    if v_by is null then raise exception 'A manager confirms a payment from the till with their PIN' using errcode = '42501'; end if;
  end if;

  -- no more than the drawer holds
  v_in_drawer := coalesce((public.pos_session_summary(s.id) ->> 'expected_cash')::numeric, 0);
  if v_amt > v_in_drawer then
    raise exception 'The drawer holds %; it cannot pay %', to_char(v_in_drawer, 'FM999G999G990D00'), to_char(v_amt, 'FM999G999G990D00') using errcode = '23514';
  end if;

  select timezone, base_currency into v_tz, v_cur from public.companies where id = s.company_id;
  v_date := (now() at time zone v_tz)::date;
  select status into v_period from public.fiscal_periods where company_id = s.company_id and v_date between start_date and end_date;
  if coalesce(v_period, 'missing') <> 'open' then
    raise exception 'The fiscal period for % is %', v_date, coalesce(v_period, 'missing') using errcode = '23514';
  end if;

  if v_kind = 'supplier' then
    select * into v_partner from public.business_partners
     where id = (p ->> 'partner_id')::uuid and company_id = s.company_id and is_vendor and deleted_at is null;
    if v_partner.id is null then raise exception 'Choose the supplier' using errcode = '23514'; end if;
    v_reason := v_partner.name || coalesce(' · ' || v_doc, '') || coalesce(' · ' || v_note, '');

    insert into public.payments (company_id, document_type, partner_id, payment_date, method, amount, currency_code, bank_account_id, reference, notes)
    values (s.company_id, 'vendor_payment', v_partner.id, v_date, 'cash', v_amt, v_cur, r.cash_account_id,
            left(r.name || ' · ' || s.number || coalesce(' · ' || v_doc, ''), 200), v_note)
    returning id into v_pay;

    -- onto the invoices chosen, else the oldest first; what is left stays on the card as paid in advance
    v_left := v_amt;
    if jsonb_typeof(p -> 'bills') = 'array' and jsonb_array_length(p -> 'bills') > 0 then
      for x in select * from jsonb_array_elements(p -> 'bills') loop
        select * into b from public.vendor_bills where id = (x ->> 'id')::uuid and company_id = s.company_id;
        if b.id is null or b.vendor_id <> v_partner.id or b.status <> 'posted' or b.document_type <> 'vendor_bill' or b.currency_code <> v_cur then
          raise exception 'Invoice % is not an open invoice of this supplier', coalesce(b.number, '?') using errcode = '23514';
        end if;
        v_take := least(v_left, b.total - b.amount_paid, coalesce(nullif(x ->> 'amount', '')::numeric, b.total - b.amount_paid));
        if v_take > 0 then
          insert into public.payment_allocations (company_id, payment_id, vendor_bill_id, amount) values (s.company_id, v_pay, b.id, v_take);
          v_left := v_left - v_take;
        end if;
      end loop;
    else
      for b in select * from public.vendor_bills
                where company_id = s.company_id and vendor_id = v_partner.id and status = 'posted' and document_type = 'vendor_bill'
                  and currency_code = v_cur and deleted_at is null and total > amount_paid
                order by bill_date, number loop
        exit when v_left <= 0;
        v_take := least(v_left, b.total - b.amount_paid);
        insert into public.payment_allocations (company_id, payment_id, vendor_bill_id, amount) values (s.company_id, v_pay, b.id, v_take);
        v_left := v_left - v_take;
      end loop;
    end if;

    -- posted at once: the money is already out of the drawer
    update public.payments set allocated_amount = coalesce((select sum(amount) from public.payment_allocations where payment_id = v_pay), 0)
     where id = v_pay returning allocated_amount into v_allocated;
    update public.payments set status = 'approved' where id = v_pay;
    update public.payments set status = 'posted', posted_at = now() where id = v_pay;
    for a in select vendor_bill_id from public.payment_allocations where payment_id = v_pay loop
      perform app.refresh_payment_status('vendor_bills', a.vendor_bill_id);
    end loop;
    v_je := app.gl_payment(v_pay);
    update public.payments set journal_entry_id = v_je where id = v_pay;

    insert into public.pos_cash_movements (company_id, session_id, movement_type, amount, reason, kind, partner_id, payment_id, document_no, approved_by, journal_entry_id)
    values (s.company_id, s.id, 'cash_out', v_amt, left(v_reason, 300), 'supplier', v_partner.id, v_pay, v_doc, v_by, v_je)
    returning id into v_mv;
    return jsonb_build_object('id', v_mv, 'payment_id', v_pay, 'number', (select number from public.payments where id = v_pay),
                              'allocated', v_allocated, 'advance', v_amt - v_allocated);
  end if;

  -- an expense: into its account, with the shop's cost centre
  select * into v_acc from public.accounts
   where id = (p ->> 'account_id')::uuid and company_id = s.company_id and account_type = 'expense'
     and account_subtype in ('expense', 'other_expense') and is_postable and is_active and deleted_at is null;
  if v_acc.id is null then raise exception 'Choose what the expense is for' using errcode = '23514'; end if;
  if v_note is null then raise exception 'Write what was paid' using errcode = '23514'; end if;
  v_reason := v_note || coalesce(' · ' || v_doc, '');
  insert into public.pos_cash_movements (company_id, session_id, movement_type, amount, reason, kind, account_id, document_no, approved_by)
  values (s.company_id, s.id, 'cash_out', v_amt, left(v_reason, 300), 'expense', v_acc.id, v_doc, v_by)
  returning id into v_mv;
  v_je := app.gl_post(s.company_id, (select journal from app.pos_accounts(r.id)), v_date, 'pos_session', s.id, s.number,
            left('Expense from ' || r.name || ': ' || v_note, 200),
            jsonb_build_array(
              jsonb_build_object('account_id', v_acc.id, 'amount', v_amt, 'cost_center_id', app.pos_cost_center(r.id), 'description', left(v_note || coalesce(' · ' || v_doc, ''), 200)),
              jsonb_build_object('account_id', (select drawer from app.pos_accounts(r.id)), 'amount', -v_amt, 'description', left(v_note, 200))),
            'payout:' || v_mv);
  update public.pos_cash_movements set journal_entry_id = v_je where id = v_mv;
  return jsonb_build_object('id', v_mv, 'journal_entry_id', v_je);
end $$;
revoke execute on function public.pos_pay_out(uuid, jsonb) from public, anon;
grant execute on function public.pos_pay_out(uuid, jsonb) to authenticated;

-- what was paid from a till (the shift's page and the Z report)
create or replace function public.pos_session_payouts(p_session uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s public.pos_sessions;
begin
  select * into s from public.pos_sessions where id = p_session;
  if s.id is null then raise exception 'Session not found' using errcode = 'P0002'; end if;
  perform app.require_permission(s.company_id, 'pos.read');
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'movement_type', m.movement_type, 'amount', m.amount, 'reason', m.reason,
                     'partner', bp.name, 'payment', py.number, 'account', ac.name, 'document_no', m.document_no, 'at', m.created_at,
                     'by', app.person_name(m.created_by), 'approved_by', app.person_name(m.approved_by)) order by m.created_at)
      from public.pos_cash_movements m
      left join public.business_partners bp on bp.id = m.partner_id
      left join public.payments py on py.id = m.payment_id
      left join public.accounts ac on ac.id = m.account_id
     where m.session_id = s.id), '[]'::jsonb);
end $$;
revoke execute on function public.pos_session_payouts(uuid) from public, anon;
grant execute on function public.pos_session_payouts(uuid) to authenticated;

-- ---------------------------------------------------------------- an item taken off: tell the managers
create or replace function app.pos_void_alert(p_log uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  l public.pos_till_log; r public.pos_registers; cs public.company_settings; v_tz text; v_cur text; v_co text;
  v_title text; v_body text; v_when text; v_wh text; v_who text; v_qty text; v_amt text; a text;
begin
  select * into l from public.pos_till_log where id = p_log;
  if l.id is null or l.kind not like 'void%' then return; end if;
  select * into cs from public.company_settings where company_id = l.company_id;
  if not coalesce(cs.pos_void_notify, false) or l.amount < coalesce(cs.pos_void_notify_over, 0) then return; end if;
  select * into r from public.pos_registers where id = l.register_id;
  select timezone, base_currency, name into v_tz, v_cur, v_co from public.companies where id = l.company_id;
  select name into v_wh from public.warehouses where id = r.warehouse_id;
  v_when := to_char(l.at at time zone v_tz, 'DD.MM.YYYY HH24:MI');
  v_who := coalesce(app.person_name(l.cashier_id), '?');
  v_qty := coalesce(replace(trim_scale(l.quantity)::text, '.', ','), '—');
  v_amt := app.money_txt(l.amount, v_cur);
  -- the same words the server-template list knows, so each person reads it in their language
  v_title := case l.kind
    when 'void_line' then format('Item taken off at %s (%s): %s', r.name, coalesce(v_wh, ''), coalesce(l.description, '—'))
    when 'void_qty' then format('Quantity lowered at %s (%s): %s', r.name, coalesce(v_wh, ''), coalesce(l.description, '—'))
    else format('Sale cleared at %s (%s): %s', r.name, coalesce(v_wh, ''), coalesce(l.description, '—')) end;
  v_body := case when l.approved_by is not null
    then format('Quantity %s, %s, %s, cashier %s, confirmed by %s', v_qty, v_amt, v_when, v_who, coalesce(app.person_name(l.approved_by), '?'))
    else format('Quantity %s, %s, %s, cashier %s, without a manager', v_qty, v_amt, v_when, v_who) end;

  -- the store's managers (and those for every store), not the cashier
  insert into public.notifications (company_id, user_id, type, title, body, link)
  select distinct l.company_id, m.user_id, 'pos_void', left(v_title, 300), v_body, '/pos/sessions/' || l.session_id
    from public.company_members m
   where m.company_id = l.company_id and m.status = 'active' and m.deleted_at is null and m.user_id is not null
     and m.user_id <> l.cashier_id
     and (m.warehouse_ids is null or cardinality(m.warehouse_ids) = 0 or r.warehouse_id = any (m.warehouse_ids))
     and app.has_permission_of(m.user_id, l.company_id, 'pos.approve');

  -- WhatsApp: the template "drispro_fshirje_arke" {{1}} company, {{2}} till, {{3}} item, {{4}} quantity,
  -- {{5}} amount, {{6}} time, {{7}} cashier, {{8}} manager
  foreach a in array coalesce(cs.pos_void_whatsapp, '{}') loop
    perform app.enqueue_message(l.company_id, 'whatsapp', a, null,
      v_co || ': ' || case l.kind when 'void_line' then 'artikull i fshirë' when 'void_qty' then 'sasi e ulur' else 'shitje e anuluar' end
        || ' në ' || r.name || coalesce(' (' || v_wh || ')', '') || E'\n' || coalesce(l.description, '—') || ', sasia ' || v_qty || ', ' || v_amt
        || E'\n' || v_when || ', kasieri ' || v_who || ', ' || case when l.approved_by is not null then 'konfirmoi ' || coalesce(app.person_name(l.approved_by), '?') else 'pa menaxher' end,
      null, 'pos_void',
      jsonb_build_object('name', 'drispro_fshirje_arke', 'language', 'sq', 'params', jsonb_build_array(
        v_co, r.name || coalesce(' (' || v_wh || ')', ''), coalesce(l.description, '—'), v_qty, v_amt, v_when, v_who,
        case when l.approved_by is not null then coalesce(app.person_name(l.approved_by), '?') else 'pa menaxher' end)),
      'void:' || l.id::text, 'pos_till_log', l.id);
  end loop;
end $$;
revoke execute on function app.pos_void_alert(uuid) from public, anon, authenticated;

select app._patch_function('public.pos_log',
  $x$    if found then n := n + 1; end if;$x$,
  $x$    if found then
      n := n + 1;
      if v_kind like 'void%' then perform app.pos_void_alert((x ->> 'id')::uuid); end if;
    end if;$x$);

-- a cashier may now take an item off without a PIN when the company chooses to be told instead
select app._patch_function('public.pos_till_options',
  $x$'payouts', coalesce((select pos_payouts from public.company_settings where company_id = v_co), 'manager'));$x$,
  $x$'payouts', coalesce((select pos_payouts from public.company_settings where company_id = v_co), 'manager'),
    'void_notify', coalesce((select pos_void_notify from public.company_settings where company_id = v_co), false));$x$);

drop function app._patch_function(text, text, text);
