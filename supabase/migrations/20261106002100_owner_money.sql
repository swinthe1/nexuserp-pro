-- =============================================================================
-- "Paratë e pronarit": the owner pays a supplier (or an expense) from his own pocket. That money never was
-- in the company's cash box or bank, so it is not booked there: the payment goes to the owner's current
-- account (455, a debt of the company to the owner) — Dr supplier / Cr 455 — and the company pays him back
-- later from the bank or the cash box (Dr 455 / Cr bank).
-- It is a "bank or cash account" of its own kind, so every place that pays (purchase invoice, payments,
-- expenses) offers it; it is not money of the company, so the cash book, the bank position and the cash
-- forecast leave it out. Paid in cash by the owner or not, the limits for cash payments still count it.
-- =============================================================================

alter table public.bank_accounts drop constraint if exists bank_accounts_account_kind_check;
alter table public.bank_accounts add constraint bank_accounts_account_kind_check
  check (account_kind in ('bank', 'cash', 'card', 'ewallet', 'owner'));

-- the owner's current account
create or replace function app.ensure_owner_account(p_company uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not exists (select 1 from public.accounts where company_id = p_company and deleted_at is null) then return null; end if;
  select id into v_id from public.accounts where company_id = p_company and code = '455' and deleted_at is null;
  if v_id is null then
    insert into public.accounts (company_id, code, name, account_type, account_subtype, is_reconcilable, cash_flow_category, parent_id)
    values (p_company, '455', 'Owner current account', 'liability', 'current_liability', false, 'financing',
            (select a.id from public.accounts a where a.company_id = p_company and a.code = '4' and a.deleted_at is null limit 1))
    returning id into v_id;
  end if;
  return v_id;
end $$;
revoke execute on function app.ensure_owner_account(uuid) from public, anon, authenticated;
select app.ensure_owner_account(id) from public.companies;

-- the owner's money is booked to a debt or equity account, never to a cash or bank one; the others the other way round
create or replace function app.tg_bank_account_kind()
returns trigger language plpgsql set search_path = '' as $$
declare v_type text;
begin
  select account_type into v_type from public.accounts where id = new.account_id;
  if new.account_kind = 'owner' and v_type not in ('liability', 'equity') then
    raise exception 'The owner''s money goes to the owner''s account (a debt of the company to the owner), not to a cash or bank account' using errcode = '23514';
  end if;
  if new.account_kind <> 'owner' and v_type <> 'asset' then
    raise exception 'A bank or cash account is booked to an asset account' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists trg_05_kind_account on public.bank_accounts;
create trigger trg_05_kind_account before insert or update of account_kind, account_id on public.bank_accounts
  for each row execute function app.tg_bank_account_kind();

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

-- a new chart comes with it
select app._patch_function('app.seed_finance_defaults',
  $x$  perform app.ensure_safe_accounts(p_company);$x$,
  $x$  perform app.ensure_safe_accounts(p_company);
  perform app.ensure_owner_account(p_company);$x$);

-- the way it was paid: the owner's money is "other" (not the company's cash, not a transfer of the company)
select app._patch_function('public.purchase_invoice_complete',
  $x$case when exists (select 1 from public.bank_accounts where id = b.pay_bank_account_id and account_kind = 'cash') then 'cash' else 'bank_transfer' end,$x$,
  $x$case (select account_kind from public.bank_accounts where id = b.pay_bank_account_id) when 'cash' then 'cash' when 'owner' then 'other' else 'bank_transfer' end,$x$);
select app._patch_function('public.pay_vendor_bills',
  $x$case when v_bank.account_kind = 'cash' then 'cash' else 'bank_transfer' end,$x$,
  $x$case v_bank.account_kind when 'cash' then 'cash' when 'owner' then 'other' else 'bank_transfer' end,$x$);
-- in the general journal
select app._patch_function('app.gl_payment',
  $x$case when ba.account_kind = 'cash' then 'CSH' else 'BNK' end$x$,
  $x$case ba.account_kind when 'cash' then 'CSH' when 'owner' then 'GEN' else 'BNK' end$x$);
-- the limits for cash payments count it (the owner may well have paid in cash)
select app._patch_function('public.post_payment',
  $x$where id = p.bank_account_id and account_kind = 'cash') or p.method = 'cash' then$x$,
  $x$where id = p.bank_account_id and account_kind in ('cash', 'owner')) or p.method = 'cash' then$x$);
select app._patch_function('app.cash_limit_check',
  $x$and (b.account_kind = 'cash' or p.method = 'cash')$x$,
  $x$and (b.account_kind in ('cash', 'owner') or p.method = 'cash')$x$);
-- not money of the company
select app._patch_function('public.bank_position',
  $x$     where ba.company_id = p_company and ba.is_active and ba.deleted_at is null$x$,
  $x$     where ba.company_id = p_company and ba.is_active and ba.deleted_at is null and ba.account_kind <> 'owner'$x$);
select app._patch_function('public.cash_forecast',
  $x$     where ba.company_id = p_company and ba.is_active and ba.deleted_at is null$x$,
  $x$     where ba.company_id = p_company and ba.is_active and ba.deleted_at is null and ba.account_kind <> 'owner'$x$);
select app._patch_function('public.cash_accounts',
  $x$where b.company_id = p_company and b.deleted_at is null and b.is_active), '[]'::jsonb);$x$,
  $x$where b.company_id = p_company and b.deleted_at is null and b.is_active and b.account_kind <> 'owner'), '[]'::jsonb);$x$);

drop function app._patch_function(text, text, text);
