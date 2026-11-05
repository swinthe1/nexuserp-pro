-- =============================================================================
-- The deep check, phase 2: three things the till could not do.
--   refund without a receipt   the customer lost it: a manager's PIN every time, a reason, at most the
--                              till's price today; the managers are told. (Not with ATK: a fiscal return
--                              needs the original coupon.) A manager's PIN for a refund now covers one refund.
--   sale on account            a known customer takes the goods and pays later: only up to the customer's
--                              credit limit (what the books say they owe, plus what tills sold them on account
--                              today); the debt lands on the customer's card when the shift closes
--   vouchers with a balance    sold at the till (cash or card) with a code; paid with at the till against
--                              the code, as many times as the balance allows. The money is a debt to the
--                              holder (customer advances) until spent: no VAT when sold, VAT when spent.
-- =============================================================================

alter table public.pos_orders add column if not exists refund_reason text;

-- ---------------------------------------------------------------- vouchers
create table if not exists public.gift_vouchers (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id),
  code         text not null check (code ~ '^[0-9A-Z-]{4,32}$'),
  amount       numeric(18,2) not null check (amount > 0),
  balance      numeric(18,2) not null,
  valid_until  date,
  status       text not null default 'active' check (status in ('active', 'used', 'void')),
  session_id   uuid references public.pos_sessions(id),
  sold_method  text check (sold_method in ('cash', 'card')),
  client_uuid  uuid,
  note         text,
  void_reason  text,
  journal_entry_id uuid
);
select app.register_table('public.gift_vouchers', 'pos', p_client_write => false);
create unique index if not exists gift_vouchers_code_key on public.gift_vouchers (company_id, code);
create unique index if not exists gift_vouchers_client_key on public.gift_vouchers (company_id, client_uuid) where client_uuid is not null;

alter table public.pos_payments add column if not exists voucher_id uuid references public.gift_vouchers(id);
alter table public.pos_payments drop constraint if exists pos_payments_method_check;
alter table public.pos_payments add constraint pos_payments_method_check check (method in ('cash', 'card', 'voucher', 'bank_transfer', 'other', 'account'));
alter table public.pos_cash_movements drop constraint if exists pos_cash_movements_kind_check;
alter table public.pos_cash_movements add constraint pos_cash_movements_kind_check check (kind in ('cash', 'supplier', 'expense', 'voucher'));

create or replace function public.pos_voucher_sell(p_session uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.pos_sessions; a record; v_amt numeric := round(coalesce((p ->> 'amount')::numeric, 0), 2); v_method text := coalesce(p ->> 'method', 'cash');
        v_code text; v_id uuid; v_tz text; v_date date; v_je uuid; v_until date; v_client uuid := nullif(p ->> 'client_uuid', '')::uuid; v_old public.gift_vouchers;
begin
  select * into s from public.pos_sessions where id = p_session for update;
  if s.id is null then raise exception 'Session not found' using errcode = 'P0002'; end if;
  perform app.require_permission(s.company_id, 'pos.write');
  if v_client is not null then
    select * into v_old from public.gift_vouchers where company_id = s.company_id and client_uuid = v_client;
    if v_old.id is not null then
      return jsonb_build_object('id', v_old.id, 'code', v_old.code, 'amount', v_old.amount, 'valid_until', v_old.valid_until, 'duplicate', true);
    end if;
  end if;
  if s.status <> 'open' then raise exception 'Session % is closed', s.number using errcode = '55000'; end if;
  if v_amt <= 0 then raise exception 'Enter an amount' using errcode = '23514'; end if;
  if v_method not in ('cash', 'card') then raise exception 'A voucher is sold for cash or by card' using errcode = '23514'; end if;
  select timezone into v_tz from public.companies where id = s.company_id;
  v_date := (now() at time zone coalesce(v_tz, 'Europe/Tirane'))::date;
  v_until := coalesce(nullif(p ->> 'valid_until', '')::date, (v_date + interval '1 year')::date);
  if v_until < v_date then raise exception 'The voucher would be expired already' using errcode = '23514'; end if;
  loop
    v_code := lpad((floor(random() * 1e12))::bigint::text, 12, '0');
    exit when not exists (select 1 from public.gift_vouchers where company_id = s.company_id and code = v_code);
  end loop;
  insert into public.gift_vouchers (company_id, code, amount, balance, valid_until, session_id, sold_method, client_uuid, note)
  values (s.company_id, v_code, v_amt, v_amt, v_until, s.id, v_method, v_client, nullif(btrim(p ->> 'note'), ''))
  returning id into v_id;
  select * into a from app.pos_accounts(s.register_id);
  -- the money is owed to whoever holds the voucher until it is spent
  v_je := app.gl_post(s.company_id, a.journal, v_date, 'pos_session', s.id, s.number, 'Voucher sold ' || v_code,
            jsonb_build_array(
              jsonb_build_object('account_id', case when v_method = 'cash' then a.drawer else app.acct(s.company_id, 'card_clearing') end, 'amount', v_amt, 'description', 'Voucher ' || v_code),
              jsonb_build_object('account_id', app.acct(s.company_id, 'customer_advances'), 'amount', -v_amt, 'description', 'Voucher ' || v_code)),
            'voucher:' || v_id);
  update public.gift_vouchers set journal_entry_id = v_je where id = v_id;
  if v_method = 'cash' then
    -- the drawer holds it: the cash count of the shift expects it
    insert into public.pos_cash_movements (company_id, session_id, movement_type, amount, reason, kind, journal_entry_id)
    values (s.company_id, s.id, 'cash_in', v_amt, 'Voucher ' || v_code, 'voucher', v_je);
  end if;
  return jsonb_build_object('id', v_id, 'code', v_code, 'amount', v_amt, 'valid_until', v_until, 'duplicate', false);
end $$;
revoke execute on function public.pos_voucher_sell(uuid, jsonb) from public, anon;
grant execute on function public.pos_voucher_sell(uuid, jsonb) to authenticated;

create or replace function public.pos_voucher_check(p_register uuid, p_code text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_co uuid; g public.gift_vouchers;
begin
  select company_id into v_co from public.pos_registers where id = p_register;
  if v_co is null then raise exception 'Register not found' using errcode = 'P0002'; end if;
  perform app.require_permission(v_co, 'pos.read');
  select * into g from public.gift_vouchers where company_id = v_co and code = upper(btrim(coalesce(p_code, ''))) and deleted_at is null;
  if g.id is null then return null; end if;
  return jsonb_build_object('id', g.id, 'code', g.code, 'amount', g.amount, 'balance', g.balance, 'valid_until', g.valid_until,
    'status', case when g.status = 'active' and g.valid_until < current_date then 'expired' else g.status end);
end $$;
revoke execute on function public.pos_voucher_check(uuid, text) from public, anon;
grant execute on function public.pos_voucher_check(uuid, text) to authenticated;

-- blocked (lost, stolen, a mistake): it can no longer be spent; what is left on it stays owed in the books
create or replace function public.voucher_block(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare g public.gift_vouchers;
begin
  select * into g from public.gift_vouchers where id = p_id for update;
  if g.id is null then raise exception 'Voucher not found' using errcode = 'P0002'; end if;
  if not (app.has_permission(g.company_id, 'pos.approve') or app.has_permission(g.company_id, 'finance.write')) then
    raise exception 'Only a manager blocks a voucher' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Say why the voucher is blocked' using errcode = '23514'; end if;
  update public.gift_vouchers set status = 'void', void_reason = btrim(p_reason) where id = g.id;
end $$;
revoke execute on function public.voucher_block(uuid, text) from public, anon;
grant execute on function public.voucher_block(uuid, text) to authenticated;

-- ---------------------------------------------------------------- what a customer owes, as the till sees it
create or replace function app.customer_till_exposure(p_partner uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(jl.debit - jl.credit)
                     from public.business_partners bp
                     join public.journal_lines jl on jl.company_id = bp.company_id and jl.partner_id = bp.id
                     join public.journal_entries e on e.id = jl.entry_id and e.status in ('posted', 'reversed')
                    where bp.id = p_partner
                      and jl.account_id in (select a.id from public.accounts a where a.company_id = bp.company_id and a.account_subtype = 'receivable' and a.deleted_at is null
                                            union select d.account_id from public.company_account_defaults d where d.company_id = bp.company_id and d.key = 'customer_advances'
                                            union select bp.receivable_account_id)), 0)
       -- sold on account in shifts not closed yet (not in the books until the shift closes)
       + coalesce((select sum(pp.amount) from public.pos_payments pp join public.pos_orders o on o.id = pp.pos_order_id
                     join public.pos_sessions ss on ss.id = o.session_id
                    where o.partner_id = p_partner and pp.method = 'account' and o.status = 'paid' and ss.status <> 'closed'), 0)
$$;

create or replace function public.pos_customer_credit(p_register uuid, p_partner uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_co uuid; bp public.business_partners; v_owes numeric;
begin
  select company_id into v_co from public.pos_registers where id = p_register;
  if v_co is null then raise exception 'Register not found' using errcode = 'P0002'; end if;
  perform app.require_permission(v_co, 'pos.read');
  select * into bp from public.business_partners where id = p_partner and company_id = v_co and deleted_at is null;
  if bp.id is null then return null; end if;
  v_owes := round(app.customer_till_exposure(bp.id), 2);
  return jsonb_build_object('name', bp.name, 'limit', bp.credit_limit, 'owes', v_owes,
    'available', case when coalesce(bp.credit_limit, 0) > 0 then greatest(round(bp.credit_limit - v_owes, 2), 0) else 0 end);
end $$;
revoke execute on function public.pos_customer_credit(uuid, uuid) from public, anon;
grant execute on function public.pos_customer_credit(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- the till's receipt
create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_def text; v_oid oid;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname || '.' || p.proname = p_name order by p.oid desc limit 1;
  if v_oid is null then raise exception 'function % not found', p_name; end if;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, left(p_old, 60); end if;
  execute replace(v_def, p_old, p_new);
end $$;

-- a manager's PIN for money back covers one refund
select app._patch_function('app.pos_approval_user',
  $x$  elsif p_at is not null and (p_at < a.created_at - interval '2 minutes' or p_at > a.created_at + interval '12 hours') then
    return null;
  end if;$x$,
  $x$  elsif p_purpose = 'refund' then
    if a.used_at is not null or (p_at is not null and (p_at < a.created_at - interval '2 minutes' or p_at > a.created_at + interval '12 hours')) then return null; end if;
    update app.pos_approvals set used_at = now() where id = a.id;
  elsif p_at is not null and (p_at < a.created_at - interval '2 minutes' or p_at > a.created_at + interval '12 hours') then
    return null;
  end if;$x$);

select app._patch_function('public.pos_submit_order',
  $x$v_offline boolean; v_blocked_pct numeric;$x$,
  $x$v_vou public.gift_vouchers; v_bp public.business_partners; v_exp numeric; v_noreceipt boolean := false;
  v_offline boolean; v_blocked_pct numeric;$x$);

select app._patch_function('public.pos_submit_order',
  $x$    select * into v_orig from public.pos_orders where id = (p->>'refund_of_id')::uuid and company_id = s.company_id for update;
    if v_orig.id is null then raise exception 'Choose the receipt being refunded' using errcode = '23514'; end if;$x$,
  $x$    if nullif(p->>'refund_of_id', '') is null then
      -- no receipt: a manager's PIN every time, a reason, at most the till's price today
      v_noreceipt := true;
      if length(btrim(coalesce(p->>'refund_reason', ''))) < 3 then raise exception 'Say why there is no receipt' using errcode = '23514'; end if;
      if not app.has_permission(s.company_id, 'pos.approve') and app.pos_approval_user(s.company_id, p ->> 'approval', 'refund', v_order_at) is null then
        raise exception 'A refund without a receipt needs a manager''s PIN' using errcode = '42501';
      end if;
    else
      select * into v_orig from public.pos_orders where id = (p->>'refund_of_id')::uuid and company_id = s.company_id for update;
      if v_orig.id is null then raise exception 'Choose the receipt being refunded' using errcode = '23514'; end if;
    end if;$x$);

select app._patch_function('public.pos_submit_order',
  $x$    if coalesce((select pos_void_approval from public.company_settings where company_id = s.company_id), true)$x$,
  $x$    if not v_noreceipt and coalesce((select pos_void_approval from public.company_settings where company_id = s.company_id), true)$x$);

select app._patch_function('public.pos_submit_order',
  $x$coalesce(nullif(p->>'partner_id', '')::uuid, r.default_customer_id), v_refund, v_orig.id,$x$,
  $x$coalesce(v_orig.partner_id, nullif(p->>'partner_id', '')::uuid, r.default_customer_id), v_refund, v_orig.id,$x$);

select app._patch_function('public.pos_submit_order',
  $x$  returning id, number into v_id, v_number;$x$,
  $x$  returning id, number into v_id, v_number;
  if v_refund and nullif(btrim(p->>'refund_reason'), '') is not null then
    update public.pos_orders set refund_reason = btrim(p->>'refund_reason') where id = v_id;
  end if;$x$);

select app._patch_function('public.pos_submit_order',
  $x$    if v_refund then
      -- a refund gives back what was paid: price and discount come from the receipt, not from the till$x$,
  $x$    if v_noreceipt then
      -- no receipt: at most the till's price today, no discount
      v_cat := app.restaurant_price(r.id, (l->>'variant_id')::uuid);
      if v_cat is null then raise exception 'Line %: unknown product', n using errcode = '23503'; end if;
      l := l || jsonb_build_object('unit_price', least(coalesce(nullif(l->>'unit_price', '')::numeric, v_cat), v_cat), 'discount_pct', 0);
      v_allowed := 0;
    elsif v_refund then
      -- a refund gives back what was paid: price and discount come from the receipt, not from the till$x$);

select app._patch_function('public.pos_submit_order',
  $x$  if v_refund then
    for ln in select ol.variant_id, -sum(ol.quantity) as qty$x$,
  $x$  if v_refund and not v_noreceipt then
    for ln in select ol.variant_id, -sum(ol.quantity) as qty$x$);

select app._patch_function('public.pos_submit_order',
  $x$    insert into public.pos_payments (company_id, pos_order_id, method, amount, reference, paid_at)
    values (s.company_id, v_id, pay->>'method', v_amt, nullif(pay->>'reference', ''), v_order_at);$x$,
  $x$    v_vou := null;
    -- a voucher: against its code and what is left on it (a till without internet keeps the sale, the managers are told)
    if pay->>'method' = 'voucher' and (nullif(btrim(pay->>'reference'), '') is not null or not v_offline) then
      select * into v_vou from public.gift_vouchers
       where company_id = s.company_id and code = upper(btrim(coalesce(pay->>'reference', ''))) and deleted_at is null for update;
      if v_vou.id is null then raise exception 'No voucher %', coalesce(nullif(pay->>'reference', ''), '(no code)') using errcode = '23514'; end if;
      if v_amt > 0 then
        if v_vou.status <> 'active' or v_vou.valid_until < v_order_at::date or v_amt > v_vou.balance + 0.001 then
          if not v_offline then
            if v_vou.status = 'void' then raise exception 'Voucher % is blocked', v_vou.code using errcode = '23514'; end if;
            if v_vou.valid_until < v_order_at::date then raise exception 'Voucher % expired on %', v_vou.code, to_char(v_vou.valid_until, 'DD.MM.YYYY') using errcode = '23514'; end if;
            raise exception 'Voucher % has % left', v_vou.code, to_char(v_vou.balance, 'FM999G999G990D00') using errcode = '23514';
          end if;
          perform app.notify_permission(s.company_id, 'pos.approve', 'warning', 'Voucher ' || v_vou.code || ' spent offline beyond what it allowed',
            r.name || ' · ' || coalesce(v_number, '') || ' · ' || to_char(v_amt, 'FM999G999G990D00'), '/pos/vouchers');
        end if;
      elsif v_refund and v_orig.id is not null and not exists (select 1 from public.pos_payments where pos_order_id = v_orig.id and voucher_id = v_vou.id) then
        raise exception 'Money goes back on a voucher only when the sale was paid with it' using errcode = '23514';
      end if;
      update public.gift_vouchers
         set balance = balance - v_amt,
             status = case when status = 'void' then 'void' when balance - v_amt <= 0.004 then 'used' else 'active' end
       where id = v_vou.id;
    end if;
    -- on account: a known customer, up to their credit limit
    if pay->>'method' = 'account' then
      select bp.* into v_bp from public.business_partners bp where bp.id = (select partner_id from public.pos_orders where id = v_id);
      if v_bp.id is null or v_bp.id = r.default_customer_id or not v_bp.is_customer or v_bp.deleted_at is not null then
        raise exception 'Choose the customer who takes it on account' using errcode = '23514';
      end if;
      if v_amt > 0 then
        v_exp := app.customer_till_exposure(v_bp.id);
        if coalesce(v_bp.credit_limit, 0) <= 0 or v_exp + v_amt > v_bp.credit_limit + 0.001 then
          if not v_offline and not app.has_permission(s.company_id, 'sales.approve') then
            if coalesce(v_bp.credit_limit, 0) <= 0 then
              raise exception '% has no credit limit: set one on the customer to sell on account', v_bp.name using errcode = '23514';
            end if;
            raise exception 'Over the credit limit of %: owes %, limit %, this sale %', v_bp.name, to_char(v_exp, 'FM999G999G990D00'),
              to_char(v_bp.credit_limit, 'FM999G999G990D00'), to_char(v_amt, 'FM999G999G990D00') using errcode = '23514';
          end if;
          perform app.notify_permission(s.company_id, 'sales.approve', 'warning', 'Sold on account over the credit limit of ' || v_bp.name,
            r.name || ' · ' || coalesce(v_number, '') || ' · ' || to_char(v_amt, 'FM999G999G990D00'), '/partners/' || v_bp.id);
        end if;
      elsif v_orig.id is null or not exists (select 1 from public.pos_payments where pos_order_id = v_orig.id and method = 'account') then
        raise exception 'Money goes back on account only for a sale made on account' using errcode = '23514';
      end if;
    end if;
    insert into public.pos_payments (company_id, pos_order_id, method, amount, reference, paid_at, voucher_id)
    values (s.company_id, v_id, pay->>'method', v_amt, nullif(pay->>'reference', ''), v_order_at, v_vou.id);$x$);

-- the managers hear of every refund without a receipt
select app._patch_function('public.pos_submit_order',
  $x$  if cardinality(v_low) > 0 then$x$,
  $x$  if v_noreceipt then
    perform app.notify_permission(s.company_id, 'pos.approve', 'warning', 'Refund without a receipt: ' || v_number,
      r.name || ' · ' || to_char(-v_total, 'FM999G999G990D00') || ' · ' || btrim(p->>'refund_reason'), '/pos/sessions/' || s.id);
  end if;
  if cardinality(v_low) > 0 then$x$);

-- the shift's entry: what was sold on account goes onto each customer's card
select app._patch_function('public.close_pos_session',
  $x$from jsonb_each_text(v_pay) where key <> 'cash' loop$x$,
  $x$from jsonb_each_text(v_pay) where key not in ('cash', 'account') loop$x$);
select app._patch_function('public.close_pos_session',
  $x$    if jsonb_array_length(v_lines) > 0 then
      v_je := app.gl_post($x$,
  $x$    for x in select o.partner_id, sum(pp.amount) as amt from public.pos_payments pp join public.pos_orders o on o.id = pp.pos_order_id
               where o.session_id = s.id and o.status = 'paid' and pp.method = 'account' group by o.partner_id loop
      if x.amt <> 0 then
        v_lines := v_lines || jsonb_build_object('account_id', coalesce((select receivable_account_id from public.business_partners where id = x.partner_id), app.acct(s.company_id, 'receivable')),
                                                 'amount', x.amt, 'partner_id', x.partner_id, 'description', 'Sales on account');
      end if;
    end loop;
    if jsonb_array_length(v_lines) > 0 then
      v_je := app.gl_post($x$);

drop function app._patch_function(text, text, text);
