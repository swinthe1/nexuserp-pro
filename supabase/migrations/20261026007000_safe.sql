-- =============================================================================
-- DrisPRO · Sefi (the shop safe), phase 1
--   A safe is a cash account (a bank_accounts row of kind 'cash' with its own GL account), so the
--   safe's balance IS its account balance in the books and the two can never disagree.
--   · tills: closing a shift empties the drawer into the till's safe; the opening float and
--     "cash out" during the day come from / go to it (app.pos_accounts now points there)
--   · deposits to the bank go through "cash on its way to the bank" until they arrive
--   · taking money out (owner, expenses) above the safe's limit waits for someone who approves
--   · counting by notes and coins; a difference is booked and, above the tolerance, reported
-- =============================================================================

-- ---------------------------------------------------------------------------
-- posting accounts: cash on its way to the bank, owner drawings
-- ---------------------------------------------------------------------------
do $$
declare v_def text;
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint where conname = 'company_account_defaults_key_check';
  execute 'alter table public.company_account_defaults drop constraint company_account_defaults_key_check';
  execute 'alter table public.company_account_defaults add constraint company_account_defaults_key_check '
       || replace(v_def, '::text]))', '::text, ''cash_in_transit''::text, ''owner_drawings''::text]))');
end $$;

create or replace function app.ensure_safe_accounts(p_company uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.accounts where company_id = p_company and deleted_at is null) then return; end if;
  insert into public.accounts (company_id, code, name, account_type, account_subtype, is_reconcilable, cash_flow_category, parent_id)
  select p_company, x.code, x.name, x.t, x.st, x.rec, x.cf,
         (select a.id from public.accounts a where a.company_id = p_company and a.code = x.parent and a.deleted_at is null limit 1)
    from (values ('582',  'Cash on its way to the bank', 'asset',  'cash',   true,  null::text, '5'),
                 ('1095', 'Owner drawings',              'equity', 'equity', false, 'financing', '1')) x(code, name, t, st, rec, cf, parent)
   where not exists (select 1 from public.accounts a where a.company_id = p_company and a.code = x.code and a.deleted_at is null);
  insert into public.company_account_defaults (company_id, key, account_id)
  select p_company, d.key, a.id
    from (values ('cash_in_transit', '582'), ('owner_drawings', '1095')) d(key, code)
    join public.accounts a on a.company_id = p_company and a.code = d.code and a.deleted_at is null
  on conflict do nothing;
end $$;
revoke execute on function app.ensure_safe_accounts(uuid) from public, anon, authenticated;
select app.ensure_safe_accounts(id) from public.companies;

-- ---------------------------------------------------------------------------
-- safes
-- ---------------------------------------------------------------------------
create table public.safes (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id),
  name            text not null,
  bank_account_id uuid not null,             -- kind 'cash'; its GL account is the safe
  warehouse_id    uuid,                      -- the shop it stands in (tills of that shop empty into it)
  holder_id       uuid references auth.users(id),
  approval_limit  numeric(18,2) not null default 200 check (approval_limit >= 0),
  tolerance       numeric(18,2) not null default 5 check (tolerance >= 0),
  max_balance     numeric(18,2) check (max_balance > 0),
  is_active       boolean not null default true,
  foreign key (company_id, bank_account_id) references public.bank_accounts(company_id, id),
  foreign key (company_id, warehouse_id)    references public.warehouses(company_id, id)
);
select app.register_table('public.safes', 'finance', p_client_write => false);
create unique index safes_account_key on public.safes (bank_account_id) where deleted_at is null;

alter table public.pos_registers add column if not exists safe_id uuid;
alter table public.pos_registers add foreign key (company_id, safe_id) references public.safes(company_id, id);

-- who may do what: store managers (pos.approve) and finance people
create or replace function app.safe_can(p_company uuid, p_level text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case p_level
    when 'see'     then app.has_permission(p_company, 'finance.read') or app.has_permission(p_company, 'pos.approve')
    when 'move'    then app.has_permission(p_company, 'finance.write') or app.has_permission(p_company, 'pos.approve')
    when 'approve' then app.has_permission(p_company, 'finance.approve')
    when 'setup'   then app.has_permission(p_company, 'finance.write')
    else false end
$$;

create or replace function app.require_safe(p_company uuid, p_level text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null and current_user in ('authenticated','anon') then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if auth.uid() is not null and not app.safe_can(p_company, p_level) then
    raise exception 'Permission denied: % required', case p_level when 'approve' then 'finance.approve' when 'setup' then 'finance.write'
                                                                else 'pos.approve or finance.read' end using errcode = '42501';
  end if;
end $$;

create or replace function app.safe_account(p_safe uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select ba.account_id from public.safes s join public.bank_accounts ba on ba.id = s.bank_account_id where s.id = p_safe
$$;

-- what the books say is in the safe
create or replace function app.safe_balance(p_safe uuid, p_until date default null)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(jl.debit - jl.credit), 0)
    from public.journal_lines jl join public.journal_entries je on je.id = jl.entry_id
   where jl.account_id = app.safe_account(p_safe) and je.status = 'posted'
     and je.company_id = (select company_id from public.safes where id = p_safe)
     and (p_until is null or je.entry_date <= p_until)
$$;

-- the till empties into: its own safe → the safe of its shop → the company cash box
create or replace function app.pos_accounts(p_register uuid, out drawer uuid, out cashbox uuid, out journal text)
language sql stable security definer set search_path = '' as $$
  select ba.account_id,
         coalesce((select app.safe_account(s.id) from public.safes s
                    where s.company_id = r.company_id and s.is_active and s.deleted_at is null
                      and (s.id = r.safe_id or (r.safe_id is null and s.warehouse_id = r.warehouse_id))
                    order by (s.id = r.safe_id) desc, s.created_at limit 1),
                  app.acct(r.company_id, 'cash')),
         coalesce(j.code, 'POS')
    from public.pos_registers r join public.bank_accounts ba on ba.id = r.cash_account_id
    left join public.journals j on j.id = r.journal_id
   where r.id = p_register
$$;

-- p: {company_id, id?, name, warehouse_id?, holder_id?, approval_limit?, tolerance?, max_balance?, is_active?, main?}
--    main = true: the safe is the company cash box (the account tills used until now)
create or replace function public.safe_save(p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_co uuid := (p ->> 'company_id')::uuid; v_id uuid := nullif(p ->> 'id', '')::uuid; v_ba uuid; v_acc uuid; v_cash public.accounts;
  v_code text; v_n int := 2; v_cur text; v_name text := nullif(btrim(p ->> 'name'), '');
begin
  if v_id is not null then select company_id into v_co from public.safes where id = v_id and deleted_at is null; end if;
  if v_co is null then raise exception 'Safe not found' using errcode = 'P0002'; end if;
  perform app.require_safe(v_co, 'setup');
  if v_name is null then raise exception 'Give the safe a name' using errcode = '23514'; end if;
  if nullif(p ->> 'holder_id', '') is not null and not exists (
       select 1 from public.company_members where company_id = v_co and user_id = (p ->> 'holder_id')::uuid and status = 'active') then
    raise exception 'The holder must be a member of the company' using errcode = '23514';
  end if;

  if v_id is not null then
    update public.safes set name = v_name, warehouse_id = nullif(p ->> 'warehouse_id', '')::uuid, holder_id = nullif(p ->> 'holder_id', '')::uuid,
           approval_limit = coalesce((p ->> 'approval_limit')::numeric, approval_limit), tolerance = coalesce((p ->> 'tolerance')::numeric, tolerance),
           max_balance = nullif(p ->> 'max_balance', '')::numeric, is_active = coalesce((p ->> 'is_active')::boolean, is_active)
     where id = v_id;
    update public.bank_accounts set name = v_name where id = (select bank_account_id from public.safes where id = v_id);
    return v_id;
  end if;

  perform app.ensure_safe_accounts(v_co);
  select base_currency into v_cur from public.companies where id = v_co;
  if coalesce((p ->> 'main')::boolean, false) then
    v_acc := app.acct(v_co, 'cash');
    if exists (select 1 from public.safes s where s.company_id = v_co and s.deleted_at is null and app.safe_account(s.id) = v_acc) then
      raise exception 'The cash box is already a safe' using errcode = '23505';
    end if;
    select id into v_ba from public.bank_accounts
     where company_id = v_co and account_id = v_acc and account_kind = 'cash' and deleted_at is null
       and id not in (select cash_account_id from public.pos_registers where company_id = v_co)
     order by created_at limit 1;
  else
    -- its own account, next to the cash box in the chart: 5312, 5313, …
    select * into v_cash from public.accounts where id = app.acct(v_co, 'cash');
    loop
      v_code := v_cash.code || v_n;
      exit when not exists (select 1 from public.accounts where company_id = v_co and code = v_code and deleted_at is null);
      v_n := v_n + 1;
    end loop;
    insert into public.accounts (company_id, code, name, account_type, account_subtype, is_reconcilable, cash_flow_category, parent_id)
    values (v_co, v_code, v_name, 'asset', 'cash', false, v_cash.cash_flow_category, v_cash.parent_id)
    returning id into v_acc;
  end if;
  if v_ba is null then
    insert into public.bank_accounts (company_id, name, account_kind, currency_code, account_id, journal_id)
    values (v_co, v_name, 'cash', v_cur, v_acc, (select id from public.journals where company_id = v_co and code = 'CSH' and deleted_at is null))
    returning id into v_ba;
  end if;
  insert into public.safes (company_id, name, bank_account_id, warehouse_id, holder_id, approval_limit, tolerance, max_balance)
  values (v_co, v_name, v_ba, nullif(p ->> 'warehouse_id', '')::uuid, nullif(p ->> 'holder_id', '')::uuid,
          coalesce((p ->> 'approval_limit')::numeric, 200), coalesce((p ->> 'tolerance')::numeric, 5), nullif(p ->> 'max_balance', '')::numeric)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.safe_save(jsonb) from public, anon;
grant execute on function public.safe_save(jsonb) to authenticated;

-- which safe a till empties into (null: the safe of its shop, else the cash box)
create or replace function public.pos_register_set_safe(p_register uuid, p_safe uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_co uuid;
begin
  select company_id into v_co from public.pos_registers where id = p_register;
  if v_co is null then raise exception 'Register not found' using errcode = 'P0002'; end if;
  perform app.require_safe(v_co, 'setup');
  if p_safe is not null and not exists (select 1 from public.safes where id = p_safe and company_id = v_co and deleted_at is null) then
    raise exception 'Safe not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.pos_sessions where register_id = p_register and status <> 'closed' and deleted_at is null) then
    raise exception 'Close the open shift of this till first' using errcode = '55000';
  end if;
  update public.pos_registers set safe_id = p_safe where id = p_register;
end $$;
revoke execute on function public.pos_register_set_safe(uuid, uuid) from public, anon;
grant execute on function public.pos_register_set_safe(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- money in and out of the safe
-- ---------------------------------------------------------------------------
insert into public.document_types (key, name, module, table_name, default_prefix)
values ('safe_movement', 'Safe movement', 'finance', 'safe_movements', 'SEF-'),
       ('safe_count', 'Safe count', 'finance', 'safe_counts', 'NUM-')
on conflict (key) do nothing;
insert into public.status_transitions (doc_type, from_status, to_status)
values ('safe_movement', '__init__', 'pending'), ('safe_movement', '__init__', 'posted'), ('safe_movement', '__init__', 'in_transit'),
       ('safe_movement', 'pending', 'posted'), ('safe_movement', 'pending', 'in_transit'), ('safe_movement', 'pending', 'rejected'),
       ('safe_movement', 'pending', 'cancelled'), ('safe_movement', 'in_transit', 'posted'),
       ('safe_count', '__init__', 'posted')
on conflict do nothing;

create table public.safe_movements (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id),
  number           text not null,
  status           text not null,
  kind             text not null check (kind in ('deposit','withdrawal','expense','transfer','cash_in')),
  safe_id          uuid not null,
  moved_on         date not null,
  amount           numeric(18,2) not null check (amount > 0),
  to_safe_id       uuid,                     -- transfer
  bank_account_id  uuid,                     -- deposit: the bank it goes to
  account_id       uuid,                     -- withdrawal / expense / cash_in: the other side
  reason           text not null,
  reference        text,                     -- deposit slip number
  notes_coins      jsonb,                    -- optional: the notes and coins handed over
  requested_by     uuid not null default auth.uid() references auth.users(id),
  decided_by       uuid references auth.users(id),
  decided_at       timestamptz,
  decision_note    text,
  journal_entry_id uuid,
  arrived_entry_id uuid,
  arrived_on       date,
  foreign key (company_id, safe_id)          references public.safes(company_id, id),
  foreign key (company_id, to_safe_id)       references public.safes(company_id, id),
  foreign key (company_id, bank_account_id)  references public.bank_accounts(company_id, id),
  foreign key (company_id, account_id)       references public.accounts(company_id, id),
  foreign key (company_id, journal_entry_id) references public.journal_entries(company_id, id),
  foreign key (company_id, arrived_entry_id) references public.journal_entries(company_id, id),
  check (kind <> 'transfer' or (to_safe_id is not null and to_safe_id <> safe_id)),
  check (kind <> 'deposit' or bank_account_id is not null)
);
select app.register_table('public.safe_movements', 'finance', p_soft_delete => false, p_client_write => false);
select app.register_document('public.safe_movements', 'safe_movement', 'moved_on');
create index safe_movements_safe_idx on public.safe_movements (safe_id, created_at desc);

create table public.safe_counts (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id),
  number           text not null,
  status           text not null default 'posted',
  safe_id          uuid not null,
  counted_on       date not null,
  counts           jsonb not null,           -- {"50": 3, "20": 10, "0.50": 4, …}
  total            numeric(18,2) not null,
  expected         numeric(18,2) not null,
  difference       numeric(18,2) generated always as (total - expected) stored,
  note             text,
  counted_by       uuid not null default auth.uid() references auth.users(id),
  foreign key (company_id, safe_id)          references public.safes(company_id, id)
);
select app.register_table('public.safe_counts', 'finance', p_soft_delete => false, p_client_write => false, p_immutable => true);
select app.register_document('public.safe_counts', 'safe_count', 'counted_on');
create index safe_counts_safe_idx on public.safe_counts (safe_id, created_at desc);

-- the safe tables are read through the functions below (store managers have no finance.read)
create or replace function app.safe_today(p_company uuid)
returns date language sql stable security definer set search_path = '' as $$
  select (now() at time zone coalesce((select timezone from public.companies where id = p_company), 'Europe/Belgrade'))::date
$$;

create or replace function app.safe_journal(p_safe uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select j.code from public.safes s join public.bank_accounts ba on ba.id = s.bank_account_id
                     join public.journals j on j.id = ba.journal_id where s.id = p_safe),
                  (select j.code from public.safes s join public.journals j on j.company_id = s.company_id and j.code = 'CSH' and j.deleted_at is null
                    where s.id = p_safe),
                  'GEN')
$$;

-- the entry for a movement that is going ahead
create or replace function app.safe_post(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.safe_movements; s public.safes; v_safe uuid; v_other uuid; v_memo text; v_je uuid; v_bal numeric;
begin
  select * into m from public.safe_movements where id = p_id for update;
  select * into s from public.safes where id = m.safe_id for update;
  v_safe := app.safe_account(s.id);
  if m.kind <> 'cash_in' then
    v_bal := app.safe_balance(s.id);
    if m.amount > v_bal then
      raise exception 'The safe has only % — it cannot give %', to_char(v_bal, 'FM999G999G990D00'), to_char(m.amount, 'FM999G999G990D00')
        using errcode = '23514';
    end if;
  end if;
  v_other := case m.kind
    when 'deposit'    then app.acct(m.company_id, 'cash_in_transit')
    when 'transfer'   then app.safe_account(m.to_safe_id)
    when 'withdrawal' then coalesce(m.account_id, app.acct(m.company_id, 'owner_drawings'))
    when 'cash_in'    then coalesce(m.account_id, app.acct(m.company_id, 'owner_drawings'))
    else m.account_id end;
  v_memo := case m.kind when 'deposit' then 'To the bank: ' when 'transfer' then 'To another safe: ' when 'withdrawal' then 'Taken out: '
                        when 'expense' then 'Paid from the safe: ' else 'Into the safe: ' end || m.reason;
  v_je := app.gl_post(m.company_id, app.safe_journal(s.id), m.moved_on, 'safe_movement', m.id, m.number, v_memo,
            jsonb_build_array(
              jsonb_build_object('account_id', v_safe,  'amount', case when m.kind = 'cash_in' then m.amount else -m.amount end, 'description', m.reason),
              jsonb_build_object('account_id', v_other, 'amount', case when m.kind = 'cash_in' then -m.amount else m.amount end, 'description', m.reason)),
            'main');
  update public.safe_movements set journal_entry_id = v_je, status = case when m.kind = 'deposit' then 'in_transit' else 'posted' end
   where id = m.id;
end $$;
revoke execute on function app.safe_post(uuid) from public, anon, authenticated;

-- p: {safe_id, kind, amount, reason, to_safe_id?, bank_account_id?, account_id?, reference?, notes_coins?, moved_on?}
create or replace function public.safe_move(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.safes; v_kind text := p ->> 'kind'; v_amt numeric := round((p ->> 'amount')::numeric, 2); v_id uuid; v_wait boolean;
  v_reason text := nullif(btrim(p ->> 'reason'), ''); v_acc public.accounts; v_who text; v_cur text; m public.safe_movements;
begin
  select * into s from public.safes where id = (p ->> 'safe_id')::uuid and deleted_at is null for update;
  if s.id is null then raise exception 'Safe not found' using errcode = 'P0002'; end if;
  perform app.require_safe(s.company_id, 'move');
  if not s.is_active then raise exception 'This safe is switched off' using errcode = '55000'; end if;
  if v_kind not in ('deposit','withdrawal','expense','transfer','cash_in') then raise exception 'Choose what happens with the money' using errcode = '23514'; end if;
  if coalesce(v_amt, 0) <= 0 then raise exception 'Enter an amount' using errcode = '23514'; end if;
  if v_reason is null then raise exception 'Say why the cash moves' using errcode = '23514'; end if;
  if v_kind = 'deposit' and not exists (select 1 from public.bank_accounts where id = (p ->> 'bank_account_id')::uuid
                                          and company_id = s.company_id and account_kind = 'bank' and deleted_at is null) then
    raise exception 'Choose the bank account' using errcode = '23514';
  end if;
  if v_kind = 'transfer' and not exists (select 1 from public.safes where id = (p ->> 'to_safe_id')::uuid and company_id = s.company_id
                                           and id <> s.id and is_active and deleted_at is null) then
    raise exception 'Choose the safe the money goes to' using errcode = '23514';
  end if;
  if v_kind = 'expense' then
    select * into v_acc from public.accounts where id = (p ->> 'account_id')::uuid and company_id = s.company_id and deleted_at is null;
    if v_acc.id is null or v_acc.account_type <> 'expense' or not v_acc.is_postable then
      raise exception 'Choose the kind of expense' using errcode = '23514';
    end if;
  elsif v_kind in ('withdrawal','cash_in') and nullif(p ->> 'account_id', '') is not null then
    select * into v_acc from public.accounts where id = (p ->> 'account_id')::uuid and company_id = s.company_id and deleted_at is null;
    if v_acc.id is null or not v_acc.is_postable or v_acc.account_subtype in ('cash','bank') then
      raise exception 'Choose where the money comes from or goes to' using errcode = '23514';
    end if;
  end if;
  perform app.ensure_safe_accounts(s.company_id);

  -- the owner's say: money leaving the business above the limit waits for approval
  v_wait := v_kind in ('withdrawal','expense') and v_amt > s.approval_limit and not app.safe_can(s.company_id, 'approve');
  insert into public.safe_movements (company_id, status, kind, safe_id, moved_on, amount, to_safe_id, bank_account_id, account_id, reason, reference, notes_coins)
  values (s.company_id, case when v_wait then 'pending' when v_kind = 'deposit' then 'in_transit' else 'posted' end, v_kind, s.id,
          coalesce(nullif(p ->> 'moved_on', '')::date, app.safe_today(s.company_id)), v_amt,
          case when v_kind = 'transfer' then (p ->> 'to_safe_id')::uuid end, case when v_kind = 'deposit' then (p ->> 'bank_account_id')::uuid end,
          case when v_kind in ('withdrawal','expense','cash_in') then nullif(p ->> 'account_id', '')::uuid end,
          v_reason, nullif(btrim(p ->> 'reference'), ''), nullif(p -> 'notes_coins', 'null'::jsonb))
  returning id into v_id;

  if v_wait then
    if v_amt > app.safe_balance(s.id) then
      raise exception 'The safe has only % — it cannot give %', to_char(app.safe_balance(s.id), 'FM999G999G990D00'), to_char(v_amt, 'FM999G999G990D00')
        using errcode = '23514';
    end if;
    select coalesce(full_name, email) into v_who from public.profiles where id = auth.uid();
    select base_currency into v_cur from public.companies where id = s.company_id;
    perform app.notify_permission(s.company_id, 'finance.approve', 'approval',
      'Approve taking ' || to_char(v_amt, 'FM999G999G990D00') || ' ' || coalesce(v_cur, '') || ' from ' || s.name,
      coalesce(v_who, '') || ': ' || v_reason, '/safe?approve=' || v_id);
  else
    perform app.safe_post(v_id);
  end if;
  select * into m from public.safe_movements where id = v_id;
  return jsonb_build_object('id', m.id, 'number', m.number, 'status', m.status);
end $$;
revoke execute on function public.safe_move(jsonb) from public, anon;
grant execute on function public.safe_move(jsonb) to authenticated;

create or replace function public.safe_decide(p_id uuid, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m public.safe_movements; v_name text;
begin
  select * into m from public.safe_movements where id = p_id for update;
  if m.id is null then raise exception 'Not found' using errcode = 'P0002'; end if;
  perform app.require_safe(m.company_id, 'approve');
  if m.status <> 'pending' then raise exception 'This was already decided' using errcode = '55000'; end if;
  if not p_approve and nullif(btrim(p_note), '') is null then raise exception 'Say why you refuse' using errcode = '23514'; end if;
  update public.safe_movements set decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(p_note), ''),
         status = case when p_approve then status else 'rejected' end
   where id = m.id;
  select name into v_name from public.safes where id = m.safe_id;
  if p_approve then
    perform app.safe_post(m.id);
    perform app.notify(m.company_id, m.requested_by, 'info', 'Approved: ' || m.number || ' · ' || v_name, m.reason, '/safe');
  else
    perform app.notify(m.company_id, m.requested_by, 'warning', 'Refused: ' || m.number || ' · ' || v_name, btrim(p_note), '/safe');
  end if;
  return jsonb_build_object('status', (select status from public.safe_movements where id = m.id));
end $$;
revoke execute on function public.safe_decide(uuid, boolean, text) from public, anon;
grant execute on function public.safe_decide(uuid, boolean, text) to authenticated;

-- whoever asked takes a waiting request back
create or replace function public.safe_cancel(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.safe_movements;
begin
  select * into m from public.safe_movements where id = p_id for update;
  if m.id is null then raise exception 'Not found' using errcode = 'P0002'; end if;
  perform app.require_safe(m.company_id, 'move');
  if m.status <> 'pending' then raise exception 'This was already decided' using errcode = '55000'; end if;
  if m.requested_by <> auth.uid() and not app.safe_can(m.company_id, 'approve') then
    raise exception 'Only the person who asked can take it back' using errcode = '42501';
  end if;
  update public.safe_movements set status = 'cancelled', decided_by = auth.uid(), decided_at = now() where id = m.id;
end $$;
revoke execute on function public.safe_cancel(uuid) from public, anon;
grant execute on function public.safe_cancel(uuid) to authenticated;

-- the deposit is on the bank statement: cash on its way → bank
create or replace function public.safe_deposit_arrived(p_id uuid, p_on date default null)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.safe_movements; v_bank uuid; v_je uuid; v_on date;
begin
  select * into m from public.safe_movements where id = p_id for update;
  if m.id is null then raise exception 'Not found' using errcode = 'P0002'; end if;
  perform app.require_safe(m.company_id, 'move');
  if m.kind <> 'deposit' or m.status <> 'in_transit' then raise exception 'This deposit is not on its way' using errcode = '55000'; end if;
  v_on := coalesce(p_on, app.safe_today(m.company_id));
  if v_on < m.moved_on then raise exception 'The money cannot arrive before it left' using errcode = '23514'; end if;
  select account_id into v_bank from public.bank_accounts where id = m.bank_account_id;
  v_je := app.gl_post(m.company_id, coalesce((select j.code from public.bank_accounts b join public.journals j on j.id = b.journal_id where b.id = m.bank_account_id), 'BNK'),
            v_on, 'safe_movement', m.id, m.number, 'Deposit arrived: ' || m.reason,
            jsonb_build_array(jsonb_build_object('account_id', v_bank, 'amount', m.amount, 'description', m.reason),
                              jsonb_build_object('account_id', app.acct(m.company_id, 'cash_in_transit'), 'amount', -m.amount, 'description', m.reason)),
            'arrived');
  update public.safe_movements set status = 'posted', arrived_entry_id = v_je, arrived_on = v_on where id = m.id;
end $$;
revoke execute on function public.safe_deposit_arrived(uuid, date) from public, anon;
grant execute on function public.safe_deposit_arrived(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- counting by notes and coins
-- ---------------------------------------------------------------------------
create or replace function app.cash_pieces(p_currency text)
returns numeric[] language sql immutable as $$
  select case p_currency
    when 'ALL' then array[10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 1]::numeric[]
    else array[500, 200, 100, 50, 20, 10, 5, 2, 1, 0.50, 0.20, 0.10, 0.05, 0.02, 0.01]::numeric[] end
$$;

-- p_counts: {"50": 3, "0.5": 4, …} — how many of each note and coin
create or replace function public.safe_count(p_safe uuid, p_counts jsonb, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.safes; k text; v text; v_total numeric := 0; v_clean jsonb := '{}'::jsonb; v_exp numeric; v_diff numeric; v_id uuid;
  v_je uuid; v_on date; v_num text; v_who text; v_cur text;
begin
  select * into s from public.safes where id = p_safe and deleted_at is null for update;
  if s.id is null then raise exception 'Safe not found' using errcode = 'P0002'; end if;
  perform app.require_safe(s.company_id, 'move');
  if jsonb_typeof(p_counts) is distinct from 'object' then raise exception 'Count the notes and coins' using errcode = '23514'; end if;
  select base_currency into v_cur from public.companies where id = s.company_id;
  for k, v in select key, value from jsonb_each_text(p_counts) loop
    if k !~ '^\d+(\.\d+)?$' or not (k::numeric = any (app.cash_pieces(v_cur))) then
      raise exception 'There is no note or coin of %', k using errcode = '23514';
    end if;
    if v !~ '^\d+$' then raise exception 'Count whole notes and coins' using errcode = '23514'; end if;
    if v::int > 0 then
      v_clean := v_clean || jsonb_build_object(trim(trailing '.' from trim(trailing '0' from to_char(k::numeric, 'FM9990.00'))), v::int);
      v_total := v_total + k::numeric * v::int;
    end if;
  end loop;
  v_exp := app.safe_balance(s.id);
  v_diff := round(v_total - v_exp, 2);
  if abs(v_diff) > s.tolerance and nullif(btrim(p_note), '') is null then
    raise exception 'The count is % from the books — write what happened', to_char(v_diff, 'FMS999G999G990D00') using errcode = '23514';
  end if;
  v_on := app.safe_today(s.company_id);
  insert into public.safe_counts (company_id, safe_id, counted_on, counts, total, expected, note)
  values (s.company_id, s.id, v_on, v_clean, v_total, v_exp, nullif(btrim(p_note), ''))
  returning id, number into v_id, v_num;
  if v_diff <> 0 then
    v_je := app.gl_post(s.company_id, app.safe_journal(s.id), v_on, 'safe_count', v_id, v_num,
              'Safe count ' || s.name || ': ' || case when v_diff < 0 then 'cash short' else 'cash over' end,
              jsonb_build_array(jsonb_build_object('account_id', app.safe_account(s.id), 'amount', v_diff, 'description', 'Safe count difference'),
                                jsonb_build_object('account_id', app.acct(s.company_id, 'cash_difference'), 'amount', -v_diff,
                                                   'description', case when v_diff < 0 then 'Cash short' else 'Cash over' end)),
              'main');
  end if;
  if abs(v_diff) > s.tolerance then
    select coalesce(full_name, email) into v_who from public.profiles where id = auth.uid();
    perform app.notify_permission(s.company_id, 'finance.approve', 'warning',
      'Safe count difference at ' || s.name || ': ' || to_char(v_diff, 'FMS999G999G990D00') || ' ' || coalesce(v_cur, ''),
      coalesce(v_who, '') || ' · ' || btrim(p_note), '/safe');
  end if;
  return jsonb_build_object('id', v_id, 'number', v_num, 'total', v_total, 'expected', v_exp, 'difference', v_diff);
end $$;
revoke execute on function public.safe_count(uuid, jsonb, text) from public, anon;
grant execute on function public.safe_count(uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- what the screens show
-- ---------------------------------------------------------------------------
create or replace function public.safes_overview(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_today date;
begin
  perform app.require_safe(p_company, 'see');
  v_today := app.safe_today(p_company);
  return jsonb_build_object(
    'can', jsonb_build_object('move', app.safe_can(p_company, 'move'), 'approve', app.safe_can(p_company, 'approve'), 'setup', app.safe_can(p_company, 'setup')),
    'cash_box_free', not exists (select 1 from public.safes s where s.company_id = p_company and s.deleted_at is null
                                   and app.safe_account(s.id) = (select account_id from public.company_account_defaults where company_id = p_company and key = 'cash')),
    'safes', coalesce((select jsonb_agg(x order by x ->> 'name') from (
      select jsonb_build_object('id', s.id, 'name', s.name, 'is_active', s.is_active, 'warehouse_id', s.warehouse_id,
               'warehouse', (select name from public.warehouses where id = s.warehouse_id),
               'holder_id', s.holder_id, 'holder', (select coalesce(full_name, email) from public.profiles where id = s.holder_id),
               'approval_limit', s.approval_limit, 'tolerance', s.tolerance, 'max_balance', s.max_balance,
               'account_code', (select a.code from public.accounts a where a.id = app.safe_account(s.id)),
               'balance', app.safe_balance(s.id),
               'today_in', coalesce((select sum(jl.debit) from public.journal_lines jl join public.journal_entries je on je.id = jl.entry_id
                                      where jl.account_id = app.safe_account(s.id) and je.status = 'posted' and je.entry_date = v_today), 0),
               'today_out', coalesce((select sum(jl.credit) from public.journal_lines jl join public.journal_entries je on je.id = jl.entry_id
                                       where jl.account_id = app.safe_account(s.id) and je.status = 'posted' and je.entry_date = v_today), 0),
               'last_count', (select jsonb_build_object('at', c.created_at, 'difference', c.difference, 'total', c.total,
                                                         'by', (select coalesce(full_name, email) from public.profiles where id = c.counted_by))
                                from public.safe_counts c where c.safe_id = s.id order by c.created_at desc, c.number desc limit 1),
               'tills', coalesce((select jsonb_agg(r.name order by r.name) from public.pos_registers r
                                   where r.company_id = p_company and r.deleted_at is null and r.is_active
                                     and app.safe_account(s.id) = (select cashbox from app.pos_accounts(r.id))), '[]'::jsonb)) as x
        from public.safes s where s.company_id = p_company and s.deleted_at is null) q), '[]'::jsonb),
    'waiting', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'number', m.number, 'kind', m.kind, 'amount', m.amount, 'reason', m.reason,
                                  'safe', (select name from public.safes where id = m.safe_id), 'created_at', m.created_at, 'mine', m.requested_by = auth.uid(),
                                  'by', (select coalesce(full_name, email) from public.profiles where id = m.requested_by)) order by m.created_at)
                           from public.safe_movements m where m.company_id = p_company and m.status = 'pending'), '[]'::jsonb),
    'on_the_way', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'number', m.number, 'amount', m.amount, 'reason', m.reason, 'moved_on', m.moved_on,
                                  'reference', m.reference, 'safe', (select name from public.safes where id = m.safe_id),
                                  'bank', (select name from public.bank_accounts where id = m.bank_account_id)) order by m.moved_on)
                              from public.safe_movements m where m.company_id = p_company and m.status = 'in_transit'), '[]'::jsonb),
    'banks', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) order by b.name) from public.bank_accounts b
                        where b.company_id = p_company and b.account_kind = 'bank' and b.is_active and b.deleted_at is null), '[]'::jsonb),
    'expense_accounts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'code', a.code, 'name', a.name) order by a.code) from public.accounts a
                                   where a.company_id = p_company and a.account_type = 'expense' and a.is_postable and a.is_active and a.deleted_at is null), '[]'::jsonb),
    'tills', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'safe_id', r.safe_id, 'warehouse_id', r.warehouse_id) order by r.name)
                        from public.pos_registers r where r.company_id = p_company and r.deleted_at is null and r.is_active), '[]'::jsonb),
    'currency', (select base_currency from public.companies where id = p_company),
    'pieces', to_jsonb(app.cash_pieces((select base_currency from public.companies where id = p_company))));
end $$;
revoke execute on function public.safes_overview(uuid) from public, anon;
grant execute on function public.safes_overview(uuid) to authenticated;

-- the safe book: every euro in and out, with the running balance
create or replace function public.safe_book(p_safe uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s public.safes; v_acc uuid; v_open numeric;
begin
  select * into s from public.safes where id = p_safe and deleted_at is null;
  if s.id is null then raise exception 'Safe not found' using errcode = 'P0002'; end if;
  perform app.require_safe(s.company_id, 'see');
  v_acc := app.safe_account(s.id);
  v_open := app.safe_balance(s.id, p_from - 1);
  return jsonb_build_object('opening', v_open, 'closing', app.safe_balance(s.id, p_to),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('date', x.entry_date, 'reference', x.reference, 'memo', x.memo, 'in', x.debit, 'out', x.credit,
                                     'balance', v_open + x.run, 'source_type', x.source_doc_type, 'source_id', x.source_doc_id, 'entry_id', x.entry_id,
                                     'kind', x.kind, 'by', x.by) order by x.entry_date, x.created_at, x.entry_id, x.line_no)
      from (select je.entry_date, je.reference, je.memo, jl.debit, jl.credit, je.source_doc_type, je.source_doc_id, je.id as entry_id, je.created_at, jl.line_no,
                   sum(jl.debit - jl.credit) over (order by je.entry_date, je.created_at, je.id, jl.line_no rows unbounded preceding) as run,
                   coalesce((select m.kind from public.safe_movements m where m.id = je.source_doc_id and je.source_doc_type = 'safe_movement'),
                            case je.source_doc_type when 'safe_count' then 'count' when 'pos_session' then 'till' else 'other' end) as kind,
                   (select coalesce(full_name, email) from public.profiles where id = je.created_by) as by
              from public.journal_lines jl join public.journal_entries je on je.id = jl.entry_id
             where jl.account_id = v_acc and je.status = 'posted' and je.company_id = s.company_id
               and je.entry_date between p_from and p_to) x), '[]'::jsonb));
end $$;
revoke execute on function public.safe_book(uuid, date, date) from public, anon;
grant execute on function public.safe_book(uuid, date, date) to authenticated;
