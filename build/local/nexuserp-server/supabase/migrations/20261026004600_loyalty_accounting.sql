-- =============================================================================
-- NexusERP Pro · loyalty points in the books
--   points earned are a promise to the customer: their value is set aside as a liability
--     Dr 6231 Loyalty programme cost      Cr 4191 Loyalty points not yet used
--   points spent were already given as a discount on the receipt (lower sales), so the
--   promise is released:
--     Dr 4191                             Cr 6231
--   a refund or a correction by hand moves the same two accounts the other way round.
-- Only point cards with a point value post; discount cards are plain discounts on the receipt.
-- =============================================================================

-- two more posting accounts
do $$
declare v_def text;
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint where conname = 'company_account_defaults_key_check';
  execute 'alter table public.company_account_defaults drop constraint company_account_defaults_key_check';
  execute 'alter table public.company_account_defaults add constraint company_account_defaults_key_check '
       || replace(v_def, '::text]))', '::text, ''loyalty_liability''::text, ''loyalty_expense''::text]))');
end $$;

insert into public.document_types (key, name, module, table_name, default_prefix)
values ('loyalty', 'Loyalty points', 'pos', 'loyalty_ledger', 'LOY')
on conflict (key) do nothing;

-- the two accounts and their posting defaults, for a company that has a chart of accounts
create or replace function app.ensure_loyalty_accounts(p_company uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.accounts where company_id = p_company and deleted_at is null) then return; end if;
  insert into public.accounts (company_id, code, name, account_type, account_subtype, is_reconcilable, cash_flow_category, parent_id)
  select p_company, x.code, x.name, x.t, x.st, false, 'operating',
         (select a.id from public.accounts a where a.company_id = p_company and a.code = x.parent and a.deleted_at is null limit 1)
    from (values ('4191', 'Loyalty points not yet used', 'liability', 'current_liability', '4'),
                 ('6231', 'Loyalty programme cost', 'expense', 'expense', '6')) x(code, name, t, st, parent)
   where not exists (select 1 from public.accounts a where a.company_id = p_company and a.code = x.code and a.deleted_at is null);
  insert into public.company_account_defaults (company_id, key, account_id)
  select p_company, d.key, a.id
    from (values ('loyalty_liability', '4191'), ('loyalty_expense', '6231')) d(key, code)
    join public.accounts a on a.company_id = p_company and a.code = d.code and a.deleted_at is null
  on conflict do nothing;
end $$;
revoke execute on function app.ensure_loyalty_accounts(uuid) from public, anon, authenticated;

select app.ensure_loyalty_accounts(id) from public.companies;

create or replace function app.tg_loyalty_gl()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_value numeric; v_tz text; v_ref text; v_lines jsonb;
begin
  if new.points = 0 then return null; end if;
  select round(abs(new.points) * coalesce(p.point_value, 0), 2) into v_value
    from public.loyalty_cards c join public.loyalty_programs p on p.id = c.program_id
   where c.id = new.card_id and p.kind = 'points';
  if coalesce(v_value, 0) = 0 then return null; end if;
  perform app.ensure_loyalty_accounts(new.company_id);
  select timezone into v_tz from public.companies where id = new.company_id;
  v_ref := coalesce((select number from public.pos_orders where id = new.pos_order_id), (select card_number from public.loyalty_cards where id = new.card_id));
  -- earned (or added by hand): set the promise aside; spent, refunded or taken away: release it
  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', app.acct(new.company_id, 'loyalty_expense'), 'amount', case when new.points > 0 then v_value else -v_value end, 'description', 'Loyalty points ' || new.kind),
    jsonb_build_object('account_id', app.acct(new.company_id, 'loyalty_liability'), 'amount', case when new.points > 0 then -v_value else v_value end, 'description', 'Loyalty points ' || new.kind));
  perform app.gl_post(new.company_id, 'POS', (new.occurred_at at time zone coalesce(v_tz, 'Europe/Tirane'))::date, 'loyalty', new.id, v_ref,
                      'Loyalty points ' || new.kind || ' ' || coalesce(v_ref, ''), v_lines, 'loyalty');
  return null;
exception when others then
  -- a sale is never stopped by its points entry (e.g. a closed period); the ledger keeps the points
  raise warning 'loyalty points not posted to the books: %', sqlerrm;
  return null;
end $$;
create trigger trg_90_loyalty_gl after insert on public.loyalty_ledger
  for each row execute function app.tg_loyalty_gl();

-- what is still owed in points, for the loyalty report
create or replace function public.loyalty_liability(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'pos.read');
  return jsonb_build_object(
    'points', coalesce((select sum(l.points) from public.loyalty_ledger l join public.loyalty_cards c on c.id = l.card_id
                          join public.loyalty_programs p on p.id = c.program_id where l.company_id = p_company and p.kind = 'points'), 0),
    'value', coalesce((select sum(l.points * coalesce(p.point_value, 0)) from public.loyalty_ledger l join public.loyalty_cards c on c.id = l.card_id
                         join public.loyalty_programs p on p.id = c.program_id where l.company_id = p_company and p.kind = 'points'), 0),
    'booked', coalesce((select -sum(jl.debit - jl.credit) from public.journal_lines jl join public.journal_entries je on je.id = jl.entry_id
                          where je.company_id = p_company and je.status = 'posted'
                            and jl.account_id = (select account_id from public.company_account_defaults where company_id = p_company and key = 'loyalty_liability')), 0));
end $$;
revoke execute on function public.loyalty_liability(uuid) from public, anon;
grant execute on function public.loyalty_liability(uuid) to authenticated;
