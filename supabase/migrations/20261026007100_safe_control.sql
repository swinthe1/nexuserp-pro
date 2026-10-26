-- =============================================================================
-- DrisPRO · Sefi, phase 2: control
--   · a second person confirms big movements with their PIN (above the safe's dual limit)
--   · handing the safe over: the giver counts, the taker counts again without seeing the giver's
--     total; a disagreement is reported
--   · a deposit is settled by itself when its money shows up on a bank statement
--   · every morning: deposits still not in the bank after 2 days, safes holding more than they should
-- =============================================================================

alter table public.safes add column dual_limit numeric(18,2) default 1000 check (dual_limit >= 0);
alter table public.safe_movements add column witnessed_by uuid references auth.users(id);
alter table public.safe_movements add column alerted_on date;

-- may this person move money in the safes of the company (a store manager or finance)?
create or replace function app.safe_person_can_move(p_user uuid, p_company uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.has_permission_of(p_user, p_company, 'pos.approve') or app.has_permission_of(p_user, p_company, 'finance.write')
$$;

-- ---------------------------------------------------------------------------
-- the second person
-- ---------------------------------------------------------------------------
create table app.safe_witnesses (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  user_id    uuid not null,
  asked_by   uuid not null,
  created_at timestamptz not null default now(),
  used_at    timestamptz
);
revoke all on app.safe_witnesses from public, anon, authenticated;

-- the second person types their PIN on the same screen; a wrong PIN counts towards the lock and is
-- returned (not raised) so the count survives
create or replace function public.safe_witness(p_company uuid, p_member uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m public.company_members; pin app.member_pins; v_id uuid;
begin
  perform app.require_safe(p_company, 'move');
  select * into m from public.company_members where id = p_member and company_id = p_company and status = 'active' and deleted_at is null;
  if m.id is null or m.user_id is null then raise exception 'Person not found' using errcode = 'P0002'; end if;
  if m.user_id = auth.uid() then raise exception 'The second person must be someone else' using errcode = '23514'; end if;
  if not app.safe_person_can_move(m.user_id, p_company) then raise exception 'This person may not handle the safe' using errcode = '42501'; end if;
  select * into pin from app.member_pins where member_id = m.id for update;
  if pin.member_id is null then raise exception 'This person has no PIN yet. The administrator gives one in Settings → Users.' using errcode = '55000'; end if;
  if pin.locked_until > now() then
    raise exception 'Too many wrong PINs; try again in % minutes', ceil(extract(epoch from pin.locked_until - now()) / 60)::int using errcode = '28000';
  end if;
  if pin.pin_hash <> extensions.crypt(coalesce(p_pin, ''), pin.pin_hash) then
    update app.member_pins set failed = failed + 1, locked_until = case when failed + 1 >= 5 then now() + interval '10 minutes' end where member_id = m.id;
    return jsonb_build_object('error', case when pin.failed + 1 >= 5 then 'Too many wrong PINs; try again in 10 minutes' else 'Wrong PIN' end);
  end if;
  update app.member_pins set failed = 0, locked_until = null where member_id = m.id;
  insert into app.safe_witnesses (company_id, user_id, asked_by) values (p_company, m.user_id, auth.uid()) returning id into v_id;
  return jsonb_build_object('token', v_id);
end $$;
revoke execute on function public.safe_witness(uuid, uuid, text) from public, anon;
grant execute on function public.safe_witness(uuid, uuid, text) to authenticated;

-- a confirmation is good for one movement, for 5 minutes, for the one who asked
create or replace function app.safe_use_witness(p_company uuid, p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare w app.safe_witnesses;
begin
  if p_token !~ '^[0-9a-f-]{36}$' then return null; end if;
  select * into w from app.safe_witnesses where id = p_token::uuid for update;
  if w.id is null or w.company_id <> p_company or w.used_at is not null or w.created_at < now() - interval '5 minutes'
     or w.asked_by is distinct from auth.uid() then
    return null;
  end if;
  update app.safe_witnesses set used_at = now() where id = w.id;
  return w.user_id;
end $$;
revoke execute on function app.safe_use_witness(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- safe_move and safe_save learn the second person
-- ---------------------------------------------------------------------------
create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;

select app._patch_function('public.safe_move',
  $x$v_who text; v_cur text; m public.safe_movements;$x$,
  $x$v_who text; v_cur text; m public.safe_movements; v_witness uuid;$x$);
select app._patch_function('public.safe_move',
  $x$  perform app.ensure_safe_accounts(s.company_id);
$x$,
  $x$  perform app.ensure_safe_accounts(s.company_id);

  if v_kind <> 'cash_in' and v_amt > app.safe_balance(s.id) then
    raise exception 'The safe has only % — it cannot give %', to_char(app.safe_balance(s.id), 'FM999G999G990D00'), to_char(v_amt, 'FM999G999G990D00')
      using errcode = '23514';
  end if;
  -- big money never moves on one person's word
  if v_kind <> 'cash_in' and s.dual_limit is not null and v_amt > s.dual_limit then
    v_witness := app.safe_use_witness(s.company_id, coalesce(p ->> 'witness', ''));
    if v_witness is null then
      raise exception 'Above % a second person confirms with their PIN', to_char(s.dual_limit, 'FM999G999G990D00') using errcode = '23514';
    end if;
  end if;
$x$);
select app._patch_function('public.safe_move',
  $x$account_id, reason, reference, notes_coins)$x$,
  $x$account_id, reason, reference, notes_coins, witnessed_by)$x$);
select app._patch_function('public.safe_move',
  $x$nullif(p -> 'notes_coins', 'null'::jsonb))$x$,
  $x$nullif(p -> 'notes_coins', 'null'::jsonb), v_witness)$x$);

select app._patch_function('public.safe_save',
  $x$max_balance = nullif(p ->> 'max_balance', '')::numeric, is_active$x$,
  $x$max_balance = nullif(p ->> 'max_balance', '')::numeric,
           dual_limit = case when p ? 'dual_limit' then nullif(p ->> 'dual_limit', '')::numeric else dual_limit end, is_active$x$);
select app._patch_function('public.safe_save',
  $x$holder_id, approval_limit, tolerance, max_balance)$x$,
  $x$holder_id, approval_limit, tolerance, max_balance, dual_limit)$x$);
select app._patch_function('public.safe_save',
  $x$nullif(p ->> 'max_balance', '')::numeric)
  returning id into v_id;$x$,
  $x$nullif(p ->> 'max_balance', '')::numeric,
          case when p ? 'dual_limit' then nullif(p ->> 'dual_limit', '')::numeric else 1000 end)
  returning id into v_id;$x$);

-- ---------------------------------------------------------------------------
-- deposits that arrive: by hand, or by themselves from the bank statement
-- ---------------------------------------------------------------------------
create or replace function app.safe_arrive(p_id uuid, p_on date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare m public.safe_movements; v_bank uuid; v_je uuid;
begin
  select * into m from public.safe_movements where id = p_id for update;
  if m.kind <> 'deposit' or m.status <> 'in_transit' then raise exception 'This deposit is not on its way' using errcode = '55000'; end if;
  if p_on < m.moved_on then raise exception 'The money cannot arrive before it left' using errcode = '23514'; end if;
  select account_id into v_bank from public.bank_accounts where id = m.bank_account_id;
  v_je := app.gl_post(m.company_id, coalesce((select j.code from public.bank_accounts b join public.journals j on j.id = b.journal_id where b.id = m.bank_account_id), 'BNK'),
            p_on, 'safe_movement', m.id, m.number, 'Deposit arrived: ' || m.reason,
            jsonb_build_array(jsonb_build_object('account_id', v_bank, 'amount', m.amount, 'description', m.reason),
                              jsonb_build_object('account_id', app.acct(m.company_id, 'cash_in_transit'), 'amount', -m.amount, 'description', m.reason)),
            'arrived');
  update public.safe_movements set status = 'posted', arrived_entry_id = v_je, arrived_on = p_on where id = m.id;
  return v_je;
end $$;
revoke execute on function app.safe_arrive(uuid, date) from public, anon, authenticated;

create or replace function public.safe_deposit_arrived(p_id uuid, p_on date default null)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.safe_movements;
begin
  select * into m from public.safe_movements where id = p_id;
  if m.id is null then raise exception 'Not found' using errcode = 'P0002'; end if;
  perform app.require_safe(m.company_id, 'move');
  perform app.safe_arrive(m.id, coalesce(p_on, app.safe_today(m.company_id)));
end $$;

-- money in on a statement line = a deposit on its way to that bank with the same amount, at most
-- 10 days old; the slip number in the text wins, then the oldest
create or replace function app.tg_statement_line_safe()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_bank uuid; m public.safe_movements; v_text text; v_je uuid;
begin
  if new.amount <= 0 or new.match_status <> 'unmatched' then return null; end if;
  select bank_account_id into v_bank from public.bank_statements where id = new.statement_id;
  v_text := app.norm_ref(coalesce(new.description, '') || ' ' || coalesce(new.reference, ''));
  select * into m from public.safe_movements
   where company_id = new.company_id and kind = 'deposit' and status = 'in_transit' and bank_account_id = v_bank
     and amount = new.amount and new.transaction_date between moved_on and moved_on + 10
   order by (length(app.norm_ref(reference)) >= 3 and position(app.norm_ref(reference) in v_text) > 0) desc nulls last, moved_on, created_at
   limit 1;
  if m.id is null then return null; end if;
  begin
    v_je := app.safe_arrive(m.id, new.transaction_date);
    update public.bank_statement_lines
       set match_status = 'matched',
           matched_journal_line_id = (select jl.id from public.journal_lines jl join public.bank_accounts b on b.account_id = jl.account_id
                                       where jl.entry_id = v_je and b.id = v_bank limit 1)
     where id = new.id;
  exception when others then
    -- e.g. a closed period: the deposit stays on its way and the person settles it
    raise warning 'safe deposit not settled from the statement: %', sqlerrm;
  end;
  return null;
end $$;
create trigger trg_80_safe_deposit after insert on public.bank_statement_lines
  for each row execute function app.tg_statement_line_safe();

-- ---------------------------------------------------------------------------
-- handing the safe over
-- ---------------------------------------------------------------------------
create table public.safe_handovers (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id),
  safe_id        uuid not null,
  from_user      uuid not null default auth.uid() references auth.users(id),
  to_user        uuid not null references auth.users(id),
  status         text not null default 'waiting' check (status in ('waiting','accepted','declined','cancelled')),
  given_count_id uuid,
  given_total    numeric(18,2) not null,
  taken_count_id uuid,
  taken_total    numeric(18,2),
  note           text,
  decided_at     timestamptz,
  foreign key (company_id, safe_id)        references public.safes(company_id, id),
  foreign key (company_id, given_count_id) references public.safe_counts(company_id, id),
  foreign key (company_id, taken_count_id) references public.safe_counts(company_id, id)
);
select app.register_table('public.safe_handovers', 'finance', p_soft_delete => false, p_client_write => false);
create unique index safe_handovers_one_waiting on public.safe_handovers (safe_id) where status = 'waiting';

create or replace function app.person_name(p_user uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(full_name, email) from public.profiles where id = p_user
$$;

-- the giver counts and names who takes it
create or replace function public.safe_handover_start(p_safe uuid, p_to uuid, p_counts jsonb, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare s public.safes; c jsonb; v_id uuid;
begin
  select * into s from public.safes where id = p_safe and deleted_at is null for update;
  if s.id is null then raise exception 'Safe not found' using errcode = 'P0002'; end if;
  perform app.require_safe(s.company_id, 'move');
  if p_to is null or p_to = auth.uid() then raise exception 'Choose who takes the safe' using errcode = '23514'; end if;
  if not app.safe_person_can_move(p_to, s.company_id) then raise exception 'This person may not handle the safe' using errcode = '42501'; end if;
  if exists (select 1 from public.safe_handovers where safe_id = s.id and status = 'waiting') then
    raise exception 'This safe is already being handed over' using errcode = '23505';
  end if;
  c := public.safe_count(s.id, p_counts, p_note);
  insert into public.safe_handovers (company_id, safe_id, to_user, given_count_id, given_total, note)
  values (s.company_id, s.id, p_to, (c ->> 'id')::uuid, (c ->> 'total')::numeric, nullif(btrim(p_note), ''))
  returning id into v_id;
  perform app.notify(s.company_id, p_to, 'approval', 'Take over ' || s.name || ' from ' || coalesce(app.person_name(auth.uid()), ''),
                     'Count it and confirm', '/safe?handover=' || v_id);
  return v_id;
end $$;
revoke execute on function public.safe_handover_start(uuid, uuid, jsonb, text) from public, anon;
grant execute on function public.safe_handover_start(uuid, uuid, jsonb, text) to authenticated;

-- the taker counts again (without seeing the giver's total) and becomes the holder
create or replace function public.safe_handover_accept(p_id uuid, p_counts jsonb, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare h public.safe_handovers; s public.safes; c jsonb; v_diff numeric; v_cur text;
begin
  select * into h from public.safe_handovers where id = p_id for update;
  if h.id is null then raise exception 'Not found' using errcode = 'P0002'; end if;
  if h.to_user is distinct from auth.uid() then raise exception 'Only the person it is handed to can take it' using errcode = '42501'; end if;
  if h.status <> 'waiting' then raise exception 'This was already decided' using errcode = '55000'; end if;
  select * into s from public.safes where id = h.safe_id;
  c := public.safe_count(s.id, p_counts, p_note);
  v_diff := round((c ->> 'total')::numeric - h.given_total, 2);
  update public.safe_handovers set status = 'accepted', taken_count_id = (c ->> 'id')::uuid, taken_total = (c ->> 'total')::numeric, decided_at = now(),
         note = coalesce(nullif(btrim(p_note), ''), note)
   where id = h.id;
  update public.safes set holder_id = h.to_user where id = s.id;
  select base_currency into v_cur from public.companies where id = s.company_id;
  perform app.notify(s.company_id, h.from_user, 'info', 'Handed over: ' || s.name || ' to ' || coalesce(app.person_name(h.to_user), ''), null, '/safe');
  if v_diff <> 0 then
    perform app.notify_permission(s.company_id, 'finance.approve', 'warning',
      'Handover of ' || s.name || ' does not agree: ' || to_char(v_diff, 'FMS999G999G990D00') || ' ' || coalesce(v_cur, ''),
      coalesce(app.person_name(h.from_user), '') || ' counted ' || to_char(h.given_total, 'FM999G999G990D00') || ', '
        || coalesce(app.person_name(h.to_user), '') || ' counted ' || to_char((c ->> 'total')::numeric, 'FM999G999G990D00'), '/safe');
  end if;
  return jsonb_build_object('given', h.given_total, 'taken', (c ->> 'total')::numeric, 'difference', v_diff);
end $$;
revoke execute on function public.safe_handover_accept(uuid, jsonb, text) from public, anon;
grant execute on function public.safe_handover_accept(uuid, jsonb, text) to authenticated;

-- the taker refuses (says why), or the giver takes it back
create or replace function public.safe_handover_decline(p_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare h public.safe_handovers; v_name text;
begin
  select * into h from public.safe_handovers where id = p_id for update;
  if h.id is null then raise exception 'Not found' using errcode = 'P0002'; end if;
  if h.status <> 'waiting' then raise exception 'This was already decided' using errcode = '55000'; end if;
  select name into v_name from public.safes where id = h.safe_id;
  if h.to_user = auth.uid() then
    if nullif(btrim(p_note), '') is null then raise exception 'Say why you refuse' using errcode = '23514'; end if;
    update public.safe_handovers set status = 'declined', decided_at = now(), note = btrim(p_note) where id = h.id;
    perform app.notify(h.company_id, h.from_user, 'warning', 'Not taken over: ' || v_name, btrim(p_note), '/safe');
  elsif h.from_user = auth.uid() or app.safe_can(h.company_id, 'approve') then
    update public.safe_handovers set status = 'cancelled', decided_at = now() where id = h.id;
  else
    raise exception 'Only the two people of the handover can stop it' using errcode = '42501';
  end if;
end $$;
revoke execute on function public.safe_handover_decline(uuid, text) from public, anon;
grant execute on function public.safe_handover_decline(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- the screen: the second-person limit, handovers, who can be the second person or take the safe
-- ---------------------------------------------------------------------------
select app._patch_function('public.safes_overview',
  $x$'approval_limit', s.approval_limit,$x$,
  $x$'approval_limit', s.approval_limit, 'dual_limit', s.dual_limit,$x$);
select app._patch_function('public.safes_overview',
  $x$    'currency', (select base_currency$x$,
  $x$    'handovers', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'safe_id', h.safe_id, 'safe', (select name from public.safes where id = h.safe_id),
                                 'from', app.person_name(h.from_user), 'to', app.person_name(h.to_user), 'created_at', h.created_at,
                                 'to_me', h.to_user = auth.uid(), 'from_me', h.from_user = auth.uid()) order by h.created_at)
                             from public.safe_handovers h where h.company_id = p_company and h.status = 'waiting'), '[]'::jsonb),
    'people', coalesce((select jsonb_agg(jsonb_build_object('member_id', m.id, 'user_id', m.user_id, 'name', coalesce(pr.full_name, pr.email),
                                 'has_pin', exists (select 1 from app.member_pins pn where pn.member_id = m.id)) order by coalesce(pr.full_name, pr.email))
                         from public.company_members m join public.profiles pr on pr.id = m.user_id
                        where m.company_id = p_company and m.status = 'active' and m.deleted_at is null and m.user_id <> auth.uid()
                          and app.safe_person_can_move(m.user_id, p_company)), '[]'::jsonb),
    'currency', (select base_currency$x$);

-- ---------------------------------------------------------------------------
-- every morning
-- ---------------------------------------------------------------------------
create or replace function app.safe_daily_checks()
returns int language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0; v_today date;
begin
  -- deposits that should be in the bank by now (told once)
  for r in select m.*, (select name from public.bank_accounts where id = m.bank_account_id) as bank, co.base_currency as cur
             from public.safe_movements m join public.companies co on co.id = m.company_id
            where m.kind = 'deposit' and m.status = 'in_transit' and m.alerted_on is null
              and m.moved_on < (now() at time zone coalesce(co.timezone, 'Europe/Belgrade'))::date - 2 loop
    perform app.notify_permission(r.company_id, 'finance.approve', 'warning',
      'Deposit ' || r.number || ' is not in the bank yet: ' || to_char(r.amount, 'FM999G999G990D00') || ' ' || coalesce(r.cur, ''),
      coalesce(r.bank, '') || ' · ' || to_char(r.moved_on, 'DD.MM.YYYY') || ' · ' || r.reason, '/safe');
    update public.safe_movements set alerted_on = current_date where id = r.id;
    n := n + 1;
  end loop;
  -- safes holding more than they should (told once a day)
  for r in select s.*, co.base_currency as cur, coalesce(co.timezone, 'Europe/Belgrade') as tz
             from public.safes s join public.companies co on co.id = s.company_id
            where s.deleted_at is null and s.is_active and s.max_balance is not null loop
    v_today := (now() at time zone r.tz)::date;
    if app.safe_balance(r.id) > r.max_balance and app.once_today('safe_full:' || r.id, r.company_id, v_today) then
      perform app.notify_permission(r.company_id, 'pos.approve', 'warning',
        r.name || ' holds ' || to_char(app.safe_balance(r.id), 'FM999G999G990D00') || ' ' || coalesce(r.cur, '') || ' — take some to the bank',
        'More than ' || to_char(r.max_balance, 'FM999G999G990D00'), '/safe');
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function app.safe_daily_checks() from public, anon, authenticated;

select app._patch_function('public.automation_tick',
  $x$    perform public.run_monthly_payroll();$x$,
  $x$    perform public.run_monthly_payroll();
    perform app.safe_daily_checks();$x$);

drop function app._patch_function(text, text, text);
