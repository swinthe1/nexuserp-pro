-- =============================================================================
-- DrisPRO · the till, step 5: the restaurant and the café — waiters hand over their takings
--   A waiter who takes the payment at the table keeps the cash until he hands it over at the till.
--   What he owes is what he took in cash (less the change he gave) on the receipts he made in the
--   shift, less what he already handed over. The person at the till counts it (by note and coin) and
--   takes it in; a difference is kept with the waiter, not with the drawer: the drawer's expected cash
--   follows what was really handed over, and the difference is booked to cash differences.
--   On a restaurant till the shift does not close while a waiter still owes (a company setting).
--   Only reported: nothing becomes a debt of the waiter.
-- =============================================================================

alter table public.company_settings add column if not exists pos_waiter_handover boolean not null default true;
comment on column public.company_settings.pos_waiter_handover is 'on a restaurant till, the waiters hand over the cash they took before the shift closes';

alter table public.pos_cash_movements drop constraint if exists pos_cash_movements_kind_check;
alter table public.pos_cash_movements add constraint pos_cash_movements_kind_check check (kind = any (array['cash', 'supplier', 'expense', 'voucher', 'waiter']));

create table if not exists public.pos_waiter_handovers (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  session_id   uuid not null references public.pos_sessions(id) on delete cascade,
  waiter_id    uuid not null,
  owed         numeric(14,2) not null,
  counted      numeric(14,2) not null check (counted >= 0),
  difference   numeric(14,2) not null,
  card         numeric(14,2) not null default 0,
  receipts     int not null default 0,
  notes_coins  jsonb,
  note         text,
  received_by  uuid not null default auth.uid(),
  movement_id  uuid references public.pos_cash_movements(id) on delete set null,
  at           timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid default auth.uid()
);
create index if not exists pos_waiter_handovers_session_idx on public.pos_waiter_handovers (session_id);
create index if not exists pos_waiter_handovers_waiter_idx on public.pos_waiter_handovers (company_id, waiter_id, at);
create index if not exists pos_waiter_handovers_movement_idx on public.pos_waiter_handovers (movement_id) where movement_id is not null;
select app.register_table('public.pos_waiter_handovers', 'pos', p_soft_delete => false, p_client_write => false, p_immutable => true);
comment on table public.pos_waiter_handovers is 'cash a waiter took at the tables and handed over at the till, counted, with its difference';

-- ----------------------------------------------------------------------------- what each waiter owes in a shift
-- everyone who took a payment in the shift other than the person who holds the drawer
create or replace function app.pos_waiter_owed(p_session uuid)
returns table (waiter_id uuid, receipts bigint, cash numeric, card numeric, other numeric, handed_owed numeric, handed numeric, owed numeric, open_tables bigint)
language sql stable security definer set search_path = '' as $$
  with s as (select * from public.pos_sessions where id = p_session),
  took as (
    select o.cashier_id as w, count(*) filter (where not o.is_refund) as receipts,
           coalesce(sum(p.cash), 0) - coalesce(sum(o.change_given), 0) as cash, coalesce(sum(p.card), 0) as card, coalesce(sum(p.other), 0) as other
      from s join public.pos_orders o on o.session_id = s.id
      left join lateral (select sum(pp.amount) filter (where pp.method = 'cash') as cash, sum(pp.amount) filter (where pp.method = 'card') as card,
                                sum(pp.amount) filter (where pp.method not in ('cash', 'card')) as other
                           from public.pos_payments pp where pp.pos_order_id = o.id) p on true
     where o.status = 'paid' and o.cashier_id is not null and o.cashier_id is distinct from s.opened_by
     group by o.cashier_id),
  gave as (select h.waiter_id as w, sum(h.owed) as owed, sum(h.counted) as counted from public.pos_waiter_handovers h where h.session_id = p_session group by h.waiter_id),
  ws as (select w from took union select w from gave)
  select ws.w, coalesce(took.receipts, 0), coalesce(took.cash, 0), coalesce(took.card, 0), coalesce(took.other, 0),
         coalesce(gave.owed, 0), coalesce(gave.counted, 0), round(coalesce(took.cash, 0) - coalesce(gave.owed, 0), 2),
         (select count(*) from public.table_orders t join s on true where t.register_id = s.register_id and t.waiter_id = ws.w and t.status = 'open')
    from ws left join took on took.w = ws.w left join gave on gave.w = ws.w
$$;
revoke execute on function app.pos_waiter_owed(uuid) from public, anon, authenticated;

create or replace function public.pos_waiters(p_session uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s public.pos_sessions;
begin
  select * into s from public.pos_sessions where id = p_session;
  if s.id is null then raise exception 'Session not found' using errcode = 'P0002'; end if;
  perform app.require_permission(s.company_id, 'pos.read');
  return jsonb_build_object(
    'required', coalesce((select pos_waiter_handover from public.company_settings where company_id = s.company_id), true)
                and coalesce((select mode from public.pos_registers where id = s.register_id), 'retail') = 'restaurant',
    'holder', app.person_name(s.opened_by),
    'waiters', coalesce((select jsonb_agg(jsonb_build_object('waiter_id', w.waiter_id, 'name', app.person_name(w.waiter_id), 'receipts', w.receipts,
                  'cash', w.cash, 'card', w.card, 'other', w.other, 'handed', w.handed, 'handed_owed', w.handed_owed, 'owed', w.owed, 'open_tables', w.open_tables,
                  'me', w.waiter_id = auth.uid()) order by w.owed desc, app.person_name(w.waiter_id))
                from app.pos_waiter_owed(s.id) w
               -- a waiter sees his own; the person at the till and the managers everyone
               where w.waiter_id = auth.uid() or auth.uid() = s.opened_by or app.has_permission(s.company_id, 'pos.approve')), '[]'::jsonb),
    'handovers', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'at', h.at, 'waiter', app.person_name(h.waiter_id), 'waiter_id', h.waiter_id,
                  'owed', h.owed, 'counted', h.counted, 'difference', h.difference, 'card', h.card, 'receipts', h.receipts, 'note', h.note,
                  'notes_coins', h.notes_coins, 'received_by', app.person_name(h.received_by)) order by h.at)
                from public.pos_waiter_handovers h
               where h.session_id = s.id and (h.waiter_id = auth.uid() or auth.uid() = s.opened_by or app.has_permission(s.company_id, 'pos.approve'))), '[]'::jsonb));
end $$;
revoke execute on function public.pos_waiters(uuid) from public, anon;
grant execute on function public.pos_waiters(uuid) to authenticated;

-- ----------------------------------------------------------------------------- the handover, counted at the till
create or replace function public.pos_waiter_handover(p_session uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.pos_sessions; w record; v_waiter uuid := nullif(p ->> 'waiter', '')::uuid; v_counted numeric := round((p ->> 'counted')::numeric, 2);
  v_diff numeric; v_id uuid; v_mv uuid; a record; v_tz text; v_note text := nullif(btrim(p ->> 'note'), ''); v_notes jsonb := nullif(p -> 'notes_coins', 'null'::jsonb);
  v_name text;
begin
  select * into s from public.pos_sessions where id = p_session for update;
  if s.id is null then raise exception 'Session not found' using errcode = 'P0002'; end if;
  perform app.require_permission(s.company_id, 'pos.write');
  if s.status <> 'open' then raise exception 'Session % is closed', s.number using errcode = '55000'; end if;
  -- the person who holds the drawer takes it in, or a manager; never the waiter himself
  if auth.uid() is distinct from s.opened_by and not app.has_permission(s.company_id, 'pos.approve') then
    raise exception 'The person at the till takes the handover in' using errcode = '42501';
  end if;
  if v_waiter is null or v_waiter = auth.uid() then raise exception 'A waiter hands over to someone else' using errcode = '23514'; end if;
  if v_counted is null or v_counted < 0 then raise exception 'Count the cash the waiter hands over' using errcode = '23514'; end if;
  select * into w from app.pos_waiter_owed(s.id) x where x.waiter_id = v_waiter;
  if w.waiter_id is null then raise exception 'This waiter took no payments in this shift' using errcode = '55000'; end if;
  v_diff := round(v_counted - w.owed, 2);
  if v_diff <> 0 and v_note is null then raise exception 'Say why the handover differs from what the waiter owes' using errcode = '23514'; end if;
  if v_notes is not null and jsonb_typeof(v_notes) <> 'object' then v_notes := null; end if;
  v_name := app.person_name(v_waiter);
  -- the drawer's expected cash follows what was really handed over: the difference leaves (or joins) it, booked to cash differences
  if v_diff <> 0 then
    insert into public.pos_cash_movements (company_id, session_id, movement_type, amount, reason, kind)
    values (s.company_id, s.id, case when v_diff < 0 then 'cash_out' else 'cash_in' end, abs(v_diff),
            format('%s: %s / %s', v_name, to_char(v_counted, 'FM999999990.00'), to_char(w.owed, 'FM999999990.00')), 'waiter')
    returning id into v_mv;
    select * into a from app.pos_accounts(s.register_id);
    select timezone into v_tz from public.companies where id = s.company_id;
    perform app.gl_post(s.company_id, a.journal, (app.clock() at time zone coalesce(v_tz, 'Europe/Tirane'))::date, 'pos_session', s.id, s.number,
                        format('Waiter handover %s · %s', v_name, s.number),
                        jsonb_build_array(jsonb_build_object('account_id', a.drawer, 'amount', v_diff, 'description', case when v_diff < 0 then 'Waiter short' else 'Waiter over' end),
                                          jsonb_build_object('account_id', app.acct(s.company_id, 'cash_difference'), 'amount', -v_diff, 'description', v_name)),
                        'cash:' || v_mv);
  end if;
  insert into public.pos_waiter_handovers (company_id, session_id, waiter_id, owed, counted, difference, card, receipts, notes_coins, note, movement_id)
  values (s.company_id, s.id, v_waiter, w.owed, v_counted, v_diff, w.card, w.receipts, v_notes, v_note, v_mv)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'owed', w.owed, 'counted', v_counted, 'difference', v_diff);
end $$;
revoke execute on function public.pos_waiter_handover(uuid, jsonb) from public, anon;
grant execute on function public.pos_waiter_handover(uuid, jsonb) to authenticated;

-- ----------------------------------------------------------------------------- the shift does not close while a waiter owes
create or replace function app.trg_pos_waiters_handed() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_who text;
begin
  if new.status <> 'closed' or old.status = 'closed' then return new; end if;
  if coalesce((select mode from public.pos_registers where id = new.register_id), 'retail') <> 'restaurant' then return new; end if;
  if not coalesce((select pos_waiter_handover from public.company_settings where company_id = new.company_id), true) then return new; end if;
  select string_agg(app.person_name(w.waiter_id) || ' ' || to_char(w.owed, 'FM999999990.00'), ', ') into v_who
    from app.pos_waiter_owed(new.id) w where abs(w.owed) > 0.004;
  if v_who is not null then
    raise exception 'WAITERS_OWE: the waiters have not handed over their takings yet: %', v_who using errcode = '55000';
  end if;
  return new;
end $$;
drop trigger if exists trg_07_waiters_handed on public.pos_sessions;
create trigger trg_07_waiters_handed before update of status on public.pos_sessions for each row execute function app.trg_pos_waiters_handed();

-- ----------------------------------------------------------------------------- saved with the other till settings
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
select app._patch_function('public.automation_settings_save',
  $x$'pos_lock_minutes',$x$, $x$'pos_lock_minutes', 'pos_waiter_handover',$x$);
select app._patch_function('public.automation_settings_save',
  $x$    pos_lock_minutes = coalesce((p_patch ->> 'pos_lock_minutes')::int, pos_lock_minutes),$x$,
  $x$    pos_lock_minutes = coalesce((p_patch ->> 'pos_lock_minutes')::int, pos_lock_minutes),
    pos_waiter_handover = coalesce((p_patch ->> 'pos_waiter_handover')::boolean, pos_waiter_handover),$x$);
drop function app._patch_function(text, text, text);

-- ----------------------------------------------------------------------------- the history: every handover
create or replace function public.pos_handover_history(p_company uuid, p jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_mgr boolean; v_q jsonb := p; v_people uuid[];
begin
  perform app.require_permission(p_company, 'pos.read');
  v_mgr := app.has_permission(p_company, 'pos.approve');
  if not v_mgr then v_q := jsonb_set(v_q, '{people}', jsonb_build_array(auth.uid())); end if;
  v_people := array(select jsonb_array_elements_text(coalesce(v_q -> 'people', '[]'::jsonb))::uuid);
  return jsonb_build_object('rows', coalesce((select jsonb_agg(jsonb_build_object(
      'at', h.at, 'register', r.name, 'shift', s.number, 'session_id', s.id, 'name', app.person_name(h.waiter_id), 'key', h.waiter_id,
      'receipts', h.receipts, 'card', h.card, 'owed', h.owed, 'counted', h.counted, 'difference', h.difference, 'note', h.note,
      'received_by', app.person_name(h.received_by)) order by h.at desc)
    from app.pos_hist_sessions(p_company, v_q - 'people') f(sid)
    join public.pos_sessions s on s.id = f.sid join public.pos_registers r on r.id = s.register_id
    join public.pos_waiter_handovers h on h.session_id = s.id
   where cardinality(v_people) = 0 or h.waiter_id = any(v_people) or (v_mgr and h.received_by = any(v_people))), '[]'::jsonb),
    'currency', (select base_currency from public.companies where id = p_company), 'manager', v_mgr);
end $$;
revoke execute on function public.pos_handover_history(uuid, jsonb) from public, anon;
grant execute on function public.pos_handover_history(uuid, jsonb) to authenticated;

-- every public foreign key is deferrable (the restore loads tables in any order)
do $$
declare c record;
begin
  for c in select con.conname, n.nspname, t.relname from pg_constraint con join pg_class t on t.oid = con.conrelid join pg_namespace n on n.oid = t.relnamespace
            where con.contype = 'f' and n.nspname = 'public' and not con.condeferrable loop
    execute format('alter table %I.%I alter constraint %I deferrable initially immediate', c.nspname, c.relname, c.conname);
  end loop;
end $$;

notify pgrst, 'reload schema';
