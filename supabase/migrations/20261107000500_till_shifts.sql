-- =============================================================================
-- The till in three steps: the cashier opens her shift, the cashier closes it (counts the drawer), the manager
-- reconciles it (checks or counts again, returns it for a recount, or confirms). The sales are booked when the
-- cashier closes; the cash leaves the drawer for the safe, with its difference, only when the manager confirms.
-- Each cashier works in her own shift: a market till sells only for the person who opened it, and every receipt,
-- also one made offline, keeps the cashier who made it.
-- =============================================================================

-- ---------------------------------------------------------------------------------------------------- settings
alter table public.company_settings add column if not exists pos_review text not null default 'manager'
  check (pos_review in ('off', 'manager'));                                 -- a manager reconciles every shift, or the close is final
alter table public.company_settings add column if not exists pos_review_hours int not null default 24
  check (pos_review_hours between 1 and 720);                               -- a reminder when a shift waits longer than this
alter table public.company_settings add column if not exists pos_blind_count boolean not null default true;   -- the cashier counts without seeing what is expected

-- ---------------------------------------------------------------------------------------------------- the shift
alter table public.pos_sessions add column if not exists closed_by uuid references public.profiles (id) on delete set null;
alter table public.pos_sessions add column if not exists review_status text not null default 'reconciled'
  check (review_status in ('pending', 'returned', 'reconciled'));
alter table public.pos_sessions add column if not exists reviewed_by uuid references public.profiles (id) on delete set null;
alter table public.pos_sessions add column if not exists reviewed_at timestamptz;
alter table public.pos_sessions add column if not exists cashier_counted numeric(18, 2);     -- what the cashier counted (the manager's count is closing_cash_counted)
create index if not exists pos_sessions_review_idx on public.pos_sessions (company_id, review_status) where review_status <> 'reconciled';
-- those closed until now: who closed them is who counted them
update public.pos_sessions s set closed_by = c.counted_by, cashier_counted = c.counted
  from public.pos_cash_counts c where c.session_id = s.id and s.closed_by is null;
update public.pos_sessions set cashier_counted = closing_cash_counted where cashier_counted is null and status = 'closed';

-- every step of the reconciling, kept: returned for a recount, counted again, confirmed
create table if not exists public.pos_session_reviews (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id),
  session_id  uuid not null references public.pos_sessions (id),
  action      text not null check (action in ('returned', 'recounted', 'reconciled')),
  counted     numeric(18, 2),
  expected    numeric(18, 2),
  difference  numeric(18, 2),
  notes_coins jsonb,
  note        text,
  by_user     uuid references public.profiles (id) on delete set null default auth.uid(),
  at          timestamptz not null default now()
);
create index if not exists pos_session_reviews_session_idx on public.pos_session_reviews (session_id, at);
do $$ begin
  if not exists (select 1 from app.table_registry where table_name = 'pos_session_reviews') then
    perform app.register_table('public.pos_session_reviews', 'pos', p_soft_delete => false, p_client_write => false, p_immutable => true);
  end if;
end $$;
-- like every link between the tables, checked at the end when a transaction asks (deleting a client)
do $$
declare r record;
begin
  for r in select con.conname, con.conrelid::regclass as tbl from pg_constraint con
            where con.contype = 'f' and con.connamespace = 'public'::regnamespace and not con.condeferrable loop
    execute format('alter table %s alter constraint %I deferrable initially immediate', r.tbl, r.conname);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------- the cash entry
-- the drawer emptied into the safe or the cash box, the difference to "cash over / short"; made by the close when nobody
-- reconciles, else when the manager confirms
create or replace function app.pos_post_cash(p_session uuid, p_counted numeric, p_expected numeric)
returns uuid language plpgsql security definer set search_path = '' as $$
declare s public.pos_sessions; r public.pos_registers; a record; v_lines jsonb := '[]'::jsonb; v_diff numeric := round(p_counted - p_expected, 2);
  v_date date;
begin
  select * into s from public.pos_sessions where id = p_session;
  select * into r from public.pos_registers where id = s.register_id;
  select * into a from app.pos_accounts(r.id);
  v_date := (app.clock() at time zone coalesce((select timezone from public.companies where id = s.company_id), 'Europe/Tirane'))::date;
  if a.drawer <> a.cashbox then
    if p_counted <> 0 then v_lines := v_lines || jsonb_build_object('account_id', a.cashbox, 'amount', p_counted, 'description', 'Cash from the drawer'); end if;
    if p_expected <> 0 then v_lines := v_lines || jsonb_build_object('account_id', a.drawer, 'amount', -p_expected, 'description', 'Drawer emptied'); end if;
  elsif v_diff <> 0 then
    v_lines := v_lines || jsonb_build_object('account_id', a.drawer, 'amount', v_diff, 'description', 'Cash count difference');
  end if;
  if v_diff <> 0 then
    v_lines := v_lines || jsonb_build_object('account_id', app.acct(s.company_id, 'cash_difference'), 'amount', -v_diff,
                                             'description', case when v_diff < 0 then 'Cash short' else 'Cash over' end);
  end if;
  if jsonb_array_length(v_lines) = 0 then return null; end if;
  return app.gl_post(s.company_id, a.journal, v_date, 'pos_session', s.id, s.number, 'Cash count ' || r.name || ' · ' || s.number, v_lines, 'cash');
end $$;
revoke execute on function app.pos_post_cash(uuid, numeric, numeric) from public, anon, authenticated;

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_def text; v_oid oid;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname || '.' || p.proname = p_name order by p.oid desc limit 1;
  if v_oid is null then raise exception 'function % not found', p_name; end if;
  v_def := pg_get_functiondef(v_oid);
  if position(p_new in v_def) > 0 then return; end if;   -- already done
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply', p_name; end if;
  execute replace(v_def, p_old, p_new);
end $$;

-- the close: who closed it; the cash waits for the manager when the company reconciles its tills
select app._patch_function('public.close_pos_session',
  $x$v_z uuid; v_diff numeric; v_pay jsonb;$x$,
  $x$v_z uuid; v_diff numeric; v_pay jsonb; v_review boolean;$x$);
select app._patch_function('public.close_pos_session',
  $x$  if s.status <> 'open' then raise exception 'Session % is already %', s.number, s.status using errcode = '55000'; end if;$x$,
  $x$  if s.status <> 'open' then raise exception 'Session % is already %', s.number, s.status using errcode = '55000'; end if;
  -- her own shift is closed by the cashier; someone else's only by a manager
  if s.opened_by is distinct from auth.uid() and not app.has_permission(s.company_id, 'pos.approve') then
    raise exception 'This shift was opened by %; she closes it, or a manager', app.person_name(s.opened_by) using errcode = '42501';
  end if;
  v_review := coalesce((select pos_review from public.company_settings where company_id = s.company_id), 'manager') = 'manager';$x$);
-- when the manager reconciles every shift, a drawer that is off no longer needs her PIN at the till: she sees it anyway
select app._patch_function('public.close_pos_session',
  $x$  perform app.pos_close_check(s.company_id, v_diff);$x$,
  $x$  if not (v_review and coalesce((select pos_close_witness from public.company_settings where company_id = s.company_id), 'difference') = 'difference') then
    perform app.pos_close_check(s.company_id, v_diff);
  end if;$x$);
select app._patch_function('public.close_pos_session',
  $x$  if jsonb_array_length(v_lines) > 0 then
    v_cje := app.gl_post(s.company_id, a.journal, v_date, 'pos_session', s.id, s.number, 'Cash count ' || r.name || ' · ' || s.number, v_lines, 'cash');
  end if;$x$,
  $x$  if jsonb_array_length(v_lines) > 0 and not v_review then
    v_cje := app.gl_post(s.company_id, a.journal, v_date, 'pos_session', s.id, s.number, 'Cash count ' || r.name || ' · ' || s.number, v_lines, 'cash');
  end if;$x$);
select app._patch_function('public.close_pos_session',
  $x$         journal_entry_id = v_je, cash_journal_entry_id = v_cje, notes = coalesce(nullif(btrim(p_notes), ''), notes)$x$,
  $x$         journal_entry_id = v_je, cash_journal_entry_id = v_cje, notes = coalesce(nullif(btrim(p_notes), ''), notes),
         closed_by = auth.uid(), cashier_counted = p_counted_cash,
         review_status = case when v_review then 'pending' else 'reconciled' end,
         reviewed_at = case when v_review then null else app.clock() end$x$);

-- a sale keeps the cashier who made it (sent by the till, also for a receipt made offline and sent later by someone else);
-- on a market till only the cashier of the shift sells (and a manager who steps in)
select app._patch_function('public.pos_submit_order',
  $x$  insert into public.pos_orders (company_id, client_uuid, session_id, register_id, partner_id, is_refund, refund_of_id, order_at,
                                 offline_created, device_ref, status, atk)
  values (s.company_id, v_client, s.id, r.id, coalesce(v_orig.partner_id, nullif(p->>'partner_id', '')::uuid, r.default_customer_id), v_refund, v_orig.id,
          v_order_at, coalesce((p->>'offline')::boolean, false), p->>'device_ref', 'draft', app.atk_coupon_of(r, p -> 'fiscal'))
  returning id, number into v_id, v_number;$x$,
  $x$  if coalesce(r.mode, 'retail') = 'retail' and not v_offline and app.pos_cashier_of(s.company_id, p) is distinct from s.opened_by
     and not app.has_permission(s.company_id, 'pos.approve') then
    raise exception 'NOT_YOUR_SHIFT: this shift is %''s; open your own shift', app.person_name(s.opened_by) using errcode = '42501';
  end if;
  insert into public.pos_orders (company_id, client_uuid, session_id, register_id, partner_id, is_refund, refund_of_id, order_at,
                                 offline_created, device_ref, status, atk, cashier_id)
  values (s.company_id, v_client, s.id, r.id, coalesce(v_orig.partner_id, nullif(p->>'partner_id', '')::uuid, r.default_customer_id), v_refund, v_orig.id,
          v_order_at, coalesce((p->>'offline')::boolean, false), p->>'device_ref', 'draft', app.atk_coupon_of(r, p -> 'fiscal'),
          app.pos_cashier_of(s.company_id, p))
  returning id, number into v_id, v_number;$x$);
-- the three new settings are saved with the other till settings, by a manager
select app._patch_function('public.automation_settings_save',
  $x$'pos_close_witness', 'pos_payouts',$x$,
  $x$'pos_close_witness', 'pos_review', 'pos_review_hours', 'pos_blind_count', 'pos_payouts',$x$);
select app._patch_function('public.automation_settings_save',
  $x$    pos_close_witness = coalesce(p_patch ->> 'pos_close_witness', pos_close_witness),$x$,
  $x$    pos_close_witness = coalesce(p_patch ->> 'pos_close_witness', pos_close_witness),
    pos_review = coalesce(p_patch ->> 'pos_review', pos_review),
    pos_review_hours = coalesce((p_patch ->> 'pos_review_hours')::int, pos_review_hours),
    pos_blind_count = coalesce((p_patch ->> 'pos_blind_count')::boolean, pos_blind_count),$x$);
drop function app._patch_function(text, text, text);

-- ---------------------------------------------------------------------------------------------------- the cashier of a sale
-- the person the till says made it, when she works for this company at the till; else whoever sends it
create or replace function app.pos_cashier_of(p_company uuid, p jsonb)
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select cm.user_id from public.company_members cm
      where cm.company_id = p_company and cm.user_id = nullif(p ->> 'cashier_id', '')::uuid and cm.status = 'active' and cm.deleted_at is null
        and app.has_permission_of(cm.user_id, p_company, 'pos.write')),
    auth.uid())
$$;
revoke execute on function app.pos_cashier_of(uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------- one shift per cashier
-- a cashier cannot have a market shift open on two tills at once
create or replace function app.tg_one_shift_per_cashier()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_other text;
begin
  if coalesce((select mode from public.pos_registers where id = new.register_id), 'retail') <> 'retail' then return new; end if;
  select r.name into v_other from public.pos_sessions s join public.pos_registers r on r.id = s.register_id
   where s.company_id = new.company_id and s.opened_by = new.opened_by and s.status <> 'closed' and s.deleted_at is null
     and s.id <> new.id and s.register_id <> new.register_id and coalesce(r.mode, 'retail') = 'retail' limit 1;
  if v_other is not null then
    raise exception 'You already have an open shift at %; close it first', v_other using errcode = '23505';
  end if;
  return new;
end $$;
drop trigger if exists trg_06_one_shift_per_cashier on public.pos_sessions;
create trigger trg_06_one_shift_per_cashier before insert on public.pos_sessions for each row execute function app.tg_one_shift_per_cashier();

-- ---------------------------------------------------------------------------------------------------- the manager's steps
-- the shifts waiting for the manager (and those returned to the cashier), with what each was expected to hold
create or replace function public.pos_review_list(p_company uuid, p jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_access uuid[] := public.my_warehouse_access(p_company); v_status text := coalesce(nullif(p ->> 'status', ''), 'open');
begin
  perform app.require_permission(p_company, 'pos.read');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', s.id, 'number', s.number, 'register', r.name, 'register_id', r.id, 'unit', w.name, 'unit_id', w.id,
             'opened_at', s.opened_at, 'closed_at', s.closed_at, 'reviewed_at', s.reviewed_at,
             'opened_by', app.person_name(s.opened_by), 'closed_by', app.person_name(s.closed_by), 'reviewed_by', app.person_name(s.reviewed_by),
             'opened_by_id', s.opened_by, 'closed_by_id', s.closed_by,
             'expected', s.expected_cash, 'cashier_counted', s.cashier_counted, 'counted', s.closing_cash_counted,
             'cashier_difference', round(s.cashier_counted - s.expected_cash, 2), 'difference', s.cash_difference,
             'review_status', s.review_status, 'sales', z.gross_sales - z.refunds_total, 'receipts', z.order_count,
             'hours_waiting', round(extract(epoch from (now() - s.closed_at)) / 3600, 1),
             'last_note', (select v.note from public.pos_session_reviews v where v.session_id = s.id order by v.at desc limit 1))
           order by s.closed_at desc)
      from public.pos_sessions s
      join public.pos_registers r on r.id = s.register_id
      join public.warehouses w on w.id = r.warehouse_id
      left join public.z_reports z on z.session_id = s.id
     where s.company_id = p_company and s.status = 'closed' and s.deleted_at is null
       and (v_access is null or r.warehouse_id = any (v_access))
       and (case v_status when 'open' then s.review_status <> 'reconciled' when 'all' then true else s.review_status = v_status end)
       and (v_status <> 'all' or s.closed_at > now() - interval '60 days')), '[]'::jsonb);
end $$;
revoke execute on function public.pos_review_list(uuid, jsonb) from public, anon;
grant execute on function public.pos_review_list(uuid, jsonb) to authenticated;

-- the manager confirms the shift: with the cashier's count, or with her own; the cash goes to the safe with its difference
-- p: counted (the manager's count; the cashier's when left out), notes_coins, note
create or replace function public.pos_reconcile(p_session uuid, p jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.pos_sessions; v_counted numeric; v_diff numeric; v_cje uuid; v_note text := nullif(btrim(p ->> 'note'), '');
begin
  select * into s from public.pos_sessions where id = p_session for update;
  if s.id is null then raise exception 'Session not found' using errcode = 'P0002'; end if;
  perform app.require_permission(s.company_id, 'pos.approve');
  if s.status <> 'closed' or s.review_status = 'reconciled' then raise exception 'This shift is not waiting to be reconciled' using errcode = '55000'; end if;
  if s.review_status = 'returned' then raise exception 'The shift is back with the cashier for a recount' using errcode = '55000'; end if;
  -- the cashier does not confirm her own shift, unless she runs the company
  if auth.uid() in (s.opened_by, s.closed_by) and not app.has_permission(s.company_id, '*') then
    raise exception 'Someone other than the cashier reconciles the shift' using errcode = '42501';
  end if;
  v_counted := coalesce(nullif(p ->> 'counted', '')::numeric, s.cashier_counted, s.closing_cash_counted);
  if v_counted is null or v_counted < 0 then raise exception 'Count the cash in the drawer' using errcode = '23514'; end if;
  v_diff := round(v_counted - s.expected_cash, 2);
  if v_counted <> coalesce(s.cashier_counted, v_counted) and v_note is null then
    raise exception 'Say why your count differs from the cashier''s' using errcode = '23514';
  end if;
  v_cje := app.pos_post_cash(s.id, v_counted, s.expected_cash);
  update public.pos_sessions set closing_cash_counted = v_counted, cash_journal_entry_id = coalesce(v_cje, cash_journal_entry_id),
         review_status = 'reconciled', reviewed_by = auth.uid(), reviewed_at = app.clock()
   where id = s.id;
  insert into public.pos_session_reviews (company_id, session_id, action, counted, expected, difference, notes_coins, note)
  values (s.company_id, s.id, 'reconciled', v_counted, s.expected_cash, v_diff, nullif(p -> 'notes_coins', 'null'::jsonb), v_note);
  return jsonb_build_object('id', s.id, 'counted', v_counted, 'difference', v_diff, 'journal_entry_id', v_cje);
end $$;
revoke execute on function public.pos_reconcile(uuid, jsonb) from public, anon;
grant execute on function public.pos_reconcile(uuid, jsonb) to authenticated;

-- the manager sends the shift back: the cashier counts again
create or replace function public.pos_review_return(p_session uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.pos_sessions;
begin
  select * into s from public.pos_sessions where id = p_session for update;
  if s.id is null then raise exception 'Session not found' using errcode = 'P0002'; end if;
  perform app.require_permission(s.company_id, 'pos.approve');
  if s.status <> 'closed' or s.review_status <> 'pending' then raise exception 'This shift is not waiting to be reconciled' using errcode = '55000'; end if;
  if length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Say what the cashier should check' using errcode = '23514'; end if;
  update public.pos_sessions set review_status = 'returned' where id = s.id;
  insert into public.pos_session_reviews (company_id, session_id, action, expected, note) values (s.company_id, s.id, 'returned', s.expected_cash, btrim(p_note));
  if s.closed_by is not null then
    perform app.notify(s.company_id, s.closed_by, 'alert', 'Count your shift again', 'Shift ' || s.number || ': ' || btrim(p_note), '/pos/sessions/' || s.id, 'pos_session', s.id);
  end if;
end $$;
revoke execute on function public.pos_review_return(uuid, text) from public, anon;
grant execute on function public.pos_review_return(uuid, text) to authenticated;

-- the cashier counts again what was returned to her
create or replace function public.pos_recount(p_session uuid, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.pos_sessions; v_counted numeric := (p ->> 'counted')::numeric;
begin
  select * into s from public.pos_sessions where id = p_session for update;
  if s.id is null then raise exception 'Session not found' using errcode = 'P0002'; end if;
  perform app.require_permission(s.company_id, 'pos.write');
  if s.review_status <> 'returned' then raise exception 'This shift was not returned for a recount' using errcode = '55000'; end if;
  if auth.uid() is distinct from s.closed_by and not app.has_permission(s.company_id, 'pos.approve') then
    raise exception 'The cashier of the shift counts it again' using errcode = '42501';
  end if;
  if v_counted is null or v_counted < 0 then raise exception 'Count the cash in the drawer' using errcode = '23514'; end if;
  update public.pos_sessions set cashier_counted = v_counted, closing_cash_counted = v_counted, review_status = 'pending' where id = s.id;
  insert into public.pos_session_reviews (company_id, session_id, action, counted, expected, difference, notes_coins, note)
  values (s.company_id, s.id, 'recounted', v_counted, s.expected_cash, round(v_counted - s.expected_cash, 2), nullif(p -> 'notes_coins', 'null'::jsonb), nullif(btrim(p ->> 'note'), ''));
end $$;
revoke execute on function public.pos_recount(uuid, jsonb) from public, anon;
grant execute on function public.pos_recount(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------- opening
-- what the till shows before opening: who closed it last, what she counted, what is waiting
create or replace function public.pos_before_open(p_register uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.pos_registers;
begin
  select * into r from public.pos_registers where id = p_register;
  if r.id is null then raise exception 'Register not found' using errcode = 'P0002'; end if;
  perform app.require_permission(r.company_id, 'pos.read');
  return jsonb_build_object(
    'last', (select jsonb_build_object('number', s.number, 'closed_at', s.closed_at, 'closed_by', app.person_name(s.closed_by),
                                       'counted', s.closing_cash_counted, 'difference', s.cash_difference, 'review_status', s.review_status)
               from public.pos_sessions s where s.register_id = r.id and s.status = 'closed' and s.deleted_at is null order by s.closed_at desc limit 1),
    'mine_open', (select jsonb_build_object('register', rr.name, 'number', s.number) from public.pos_sessions s join public.pos_registers rr on rr.id = s.register_id
                   where s.company_id = r.company_id and s.opened_by = auth.uid() and s.status <> 'closed' and s.deleted_at is null and s.register_id <> r.id limit 1),
    'returned', (select count(*) from public.pos_sessions s where s.company_id = r.company_id and s.closed_by = auth.uid() and s.review_status = 'returned'),
    'blind', coalesce((select pos_blind_count from public.company_settings where company_id = r.company_id), true),
    'review', coalesce((select pos_review from public.company_settings where company_id = r.company_id), 'manager') = 'manager');
end $$;
revoke execute on function public.pos_before_open(uuid) from public, anon;
grant execute on function public.pos_before_open(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------- reminders
-- the managers hear of shifts waiting longer than the company allows (run with the other reminders)
create or replace function app.remind_tills_to_reconcile()
returns int language plpgsql security definer set search_path = '' as $$
declare c record; v_n int := 0;
begin
  for c in select s.company_id, count(*) as n, min(s.closed_at) as oldest
             from public.pos_sessions s join public.company_settings cs on cs.company_id = s.company_id
            where s.status = 'closed' and s.review_status = 'pending' and s.closed_at < now() - make_interval(hours => cs.pos_review_hours)
            group by s.company_id loop
    v_n := v_n + app.remind(c.company_id, array['store_manager', 'company_admin'],
             c.n || ' till shift(s) waiting to be reconciled', 'The oldest was closed ' || to_char(c.oldest, 'DD.MM HH24:MI'), '/pos/review', 'pos_session', null);
  end loop;
  return v_n;
end $$;
revoke execute on function app.remind_tills_to_reconcile() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('drispro-tills-to-reconcile', '0 * * * *', 'select app.remind_tills_to_reconcile()');
  end if;
exception when others then
  raise notice 'pg_cron not available (%); run app.remind_tills_to_reconcile() every hour elsewhere', sqlerrm;
end $$;
