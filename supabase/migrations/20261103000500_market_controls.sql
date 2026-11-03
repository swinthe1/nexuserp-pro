-- =============================================================================
-- DrisPRO · Market controls (from the shop's own role handbooks: cashier, shelf worker, receiver, manager)
--   · the till: taking an item off a sale, lowering its quantity or clearing a sale needs the
--     manager's PIN (a company choice, on by default); every such step is kept in the till's log
--     with who confirmed it, and the shift shows how many there were
--   · closing the till: the count by note and coin is kept with the shift; the manager confirms the
--     count with their PIN when the drawer is off (or always, or never: a company choice)
--   · alcohol and tobacco: products or categories for adults only; the till asks the cashier to check
--     the customer's age once per sale, and keeps the answer
--   · short dates: the shelf worker proposes a discount for an item about to expire, the manager
--     approves it (it becomes a promotion in that store until the date), and what expired is
--     taken off the shelf as a loss
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

-- -----------------------------------------------------------------------------
-- choices of the company
-- -----------------------------------------------------------------------------
alter table public.company_settings
  add column if not exists pos_void_approval boolean not null default true,
  add column if not exists pos_close_witness text not null default 'difference' check (pos_close_witness in ('never', 'difference', 'always')),
  add column if not exists pos_age_check boolean not null default true,
  add column if not exists pos_min_age smallint not null default 18 check (pos_min_age between 14 and 25);

select app._patch_function('public.automation_settings_save',
  $x$  if p_patch ?| array['pos_cash_tolerance', 'pos_count_notes'] then$x$,
  $x$  if p_patch ?| array['pos_cash_tolerance', 'pos_count_notes', 'pos_void_approval', 'pos_close_witness', 'pos_age_check', 'pos_min_age'] then$x$);
select app._patch_function('public.automation_settings_save',
  $x$    pos_count_notes = coalesce((p_patch ->> 'pos_count_notes')::boolean, pos_count_notes),$x$,
  $x$    pos_count_notes = coalesce((p_patch ->> 'pos_count_notes')::boolean, pos_count_notes),
    pos_void_approval = coalesce((p_patch ->> 'pos_void_approval')::boolean, pos_void_approval),
    pos_close_witness = coalesce(p_patch ->> 'pos_close_witness', pos_close_witness),
    pos_age_check = coalesce((p_patch ->> 'pos_age_check')::boolean, pos_age_check),
    pos_min_age = coalesce((p_patch ->> 'pos_min_age')::smallint, pos_min_age),$x$);

-- -----------------------------------------------------------------------------
-- adults only: on the product, or on its category (a sub-category follows its parent)
-- -----------------------------------------------------------------------------
alter table public.products add column if not exists adults_only boolean not null default false;
alter table public.product_categories add column if not exists adults_only boolean not null default false;

create or replace function app.adults_only_variants(p_company uuid)
returns uuid[] language sql stable security definer set search_path = '' as $$
  with recursive c as (
    select id from public.product_categories where company_id = p_company and adults_only and deleted_at is null
    union
    select k.id from public.product_categories k join c on k.parent_id = c.id where k.deleted_at is null
  )
  select coalesce(array_agg(v.id), '{}') from public.product_variants v join public.products p on p.id = v.product_id
   where p.company_id = p_company and v.deleted_at is null and p.deleted_at is null
     and (p.adults_only or p.category_id in (select id from c))
$$;
revoke execute on function app.adults_only_variants(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- the manager's PIN at the till
-- -----------------------------------------------------------------------------
-- the managers who can confirm at a till: store managers (pos.approve) with a PIN, other than the cashier
create or replace function app.pos_managers(p_company uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('member_id', m.id, 'name', coalesce(pr.full_name, pr.email)) order by coalesce(pr.full_name, pr.email)), '[]'::jsonb)
    from public.company_members m join public.profiles pr on pr.id = m.user_id
   where m.company_id = p_company and m.status = 'active' and m.deleted_at is null and m.user_id is distinct from auth.uid()
     and exists (select 1 from app.member_pins pn where pn.member_id = m.id)
     and app.has_permission_of(m.user_id, p_company, 'pos.approve')
$$;
revoke execute on function app.pos_managers(uuid) from public, anon, authenticated;

create table app.pos_approvals (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  user_id    uuid not null,
  asked_by   uuid not null,
  purpose    text not null check (purpose in ('void', 'close')),
  created_at timestamptz not null default now(),
  used_at    timestamptz
);
create index on app.pos_approvals (asked_by, created_at);
revoke all on app.pos_approvals from public, anon, authenticated;

-- the manager types their PIN on the cashier's screen; a wrong PIN counts towards the lock and is
-- returned (not raised) so the count survives
create or replace function public.pos_approve(p_register uuid, p_member uuid, p_pin text, p_purpose text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.pos_registers; m public.company_members; pin app.member_pins; v_id uuid;
begin
  select * into r from public.pos_registers where id = p_register;
  if r.id is null then raise exception 'Register not found' using errcode = 'P0002'; end if;
  perform app.require_permission(r.company_id, 'pos.write');
  if p_purpose not in ('void', 'close') then raise exception 'Unknown confirmation' using errcode = '22023'; end if;
  select * into m from public.company_members where id = p_member and company_id = r.company_id and status = 'active' and deleted_at is null;
  if m.id is null or m.user_id is null then raise exception 'Person not found' using errcode = 'P0002'; end if;
  if m.user_id = auth.uid() then raise exception 'The manager must be someone else' using errcode = '23514'; end if;
  if not app.has_permission_of(m.user_id, r.company_id, 'pos.approve') then raise exception 'This person is not a store manager' using errcode = '42501'; end if;
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
  insert into app.pos_approvals (company_id, user_id, asked_by, purpose) values (r.company_id, m.user_id, auth.uid(), p_purpose) returning id into v_id;
  return jsonb_build_object('approval', v_id, 'name', app.person_name(m.user_id));
end $$;
revoke execute on function public.pos_approve(uuid, uuid, text, text) from public, anon;
grant execute on function public.pos_approve(uuid, uuid, text, text) to authenticated;

-- who confirmed: a void's confirmation covers the steps of one sale (it may reach the server hours later,
-- from a till that was offline); a closing's is good once, for 10 minutes
create or replace function app.pos_approval_user(p_company uuid, p_id text, p_purpose text, p_at timestamptz default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare a app.pos_approvals;
begin
  if coalesce(p_id, '') !~ '^[0-9a-f-]{36}$' then return null; end if;
  select * into a from app.pos_approvals where id = p_id::uuid for update;
  if a.id is null or a.company_id <> p_company or a.purpose <> p_purpose or a.asked_by is distinct from auth.uid() then return null; end if;
  if p_purpose = 'close' then
    if a.used_at is not null or a.created_at < now() - interval '10 minutes' then return null; end if;
    update app.pos_approvals set used_at = now() where id = a.id;
  elsif p_at is not null and (p_at < a.created_at - interval '2 minutes' or p_at > a.created_at + interval '12 hours') then
    return null;
  end if;
  return a.user_id;
end $$;
revoke execute on function app.pos_approval_user(uuid, text, text, timestamptz) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- what the till knows about these choices (a cashier may not read the settings)
-- -----------------------------------------------------------------------------
create or replace function public.pos_till_options(p_register uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_co uuid; cs record;
begin
  select company_id into v_co from public.pos_registers where id = p_register;
  if v_co is null then raise exception 'Register not found' using errcode = 'P0002'; end if;
  if not app.has_permission(v_co, 'pos.read') then raise exception 'Permission denied: pos.read required' using errcode = '42501'; end if;
  select coalesce(s.pos_count_notes, true) as count_notes, coalesce(s.pos_void_approval, true) as void_approval,
         coalesce(s.pos_close_witness, 'difference') as close_witness, coalesce(s.pos_cash_tolerance, 0) as tolerance,
         coalesce(s.pos_age_check, true) as age_check, coalesce(s.pos_min_age, 18) as min_age
    into cs from (select 1) one left join public.company_settings s on s.company_id = v_co;
  return jsonb_build_object('count_notes', cs.count_notes, 'void_approval', cs.void_approval, 'close_witness', cs.close_witness,
    'tolerance', cs.tolerance, 'age_check', cs.age_check, 'min_age', cs.min_age,
    'adults_only', case when cs.age_check then to_jsonb(app.adults_only_variants(v_co)) else '[]'::jsonb end,
    'managers', app.pos_managers(v_co));
end $$;

-- -----------------------------------------------------------------------------
-- the till's log: items taken off, quantities lowered, sales cleared, ages checked
-- -----------------------------------------------------------------------------
create table public.pos_till_log (
  id          uuid primary key,                         -- made by the till, so a step sent twice is kept once
  company_id  uuid not null references public.companies(id),
  session_id  uuid not null,
  register_id uuid not null,
  kind        text not null check (kind in ('void_line', 'void_qty', 'void_sale', 'age_ok', 'age_refused')),
  variant_id  uuid,
  description text,
  quantity    numeric(18,4),
  amount      numeric(18,2) not null default 0,         -- with VAT, what left the sale
  at          timestamptz not null,
  cashier_id  uuid not null,
  approved_by uuid references auth.users(id),
  offline     boolean not null default false,
  foreign key (company_id, session_id)  references public.pos_sessions(company_id, id),
  foreign key (company_id, register_id) references public.pos_registers(company_id, id)
);
create index on public.pos_till_log (session_id, kind);
create index on public.pos_till_log (company_id, at);
select app.register_table('public.pos_till_log', 'pos', p_soft_delete => false, p_client_write => false, p_immutable => true);

create or replace function public.pos_log(p_session uuid, p_items jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare s public.pos_sessions; x jsonb; n int := 0; v_at timestamptz; v_kind text;
begin
  select * into s from public.pos_sessions where id = p_session;
  if s.id is null then raise exception 'Session not found' using errcode = 'P0002'; end if;
  perform app.require_permission(s.company_id, 'pos.write');
  if jsonb_typeof(p_items) <> 'array' then raise exception 'Nothing to keep' using errcode = '22023'; end if;
  for x in select * from jsonb_array_elements(p_items) loop
    v_kind := x ->> 'kind';
    if v_kind not in ('void_line', 'void_qty', 'void_sale', 'age_ok', 'age_refused') then continue; end if;
    v_at := least(coalesce((x ->> 'at')::timestamptz, now()), now());
    insert into public.pos_till_log (id, company_id, session_id, register_id, kind, variant_id, description, quantity, amount, at, cashier_id, approved_by, offline)
    values ((x ->> 'id')::uuid, s.company_id, s.id, s.register_id, v_kind,
            (select v.id from public.product_variants v where v.id = (x ->> 'variant_id')::uuid and v.company_id = s.company_id),
            left(x ->> 'description', 200), nullif(x ->> 'quantity', '')::numeric, abs(coalesce(nullif(x ->> 'amount', '')::numeric, 0)),
            v_at, auth.uid(),
            case when v_kind like 'void%' then app.pos_approval_user(s.company_id, x ->> 'approval', 'void', v_at) end,
            coalesce((x ->> 'offline')::boolean, false))
    on conflict (id) do nothing;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke execute on function public.pos_log(uuid, jsonb) from public, anon;
grant execute on function public.pos_log(uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- closing: the count by note and coin, and who confirmed it
-- -----------------------------------------------------------------------------
create table public.pos_cash_counts (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id),
  session_id   uuid not null unique,
  z_report_id  uuid,
  notes_coins  jsonb,                                   -- {"50": 3, "0.5": 4}
  counted      numeric(18,2) not null,
  difference   numeric(18,2) not null default 0,
  counted_by   uuid not null,
  witnessed_by uuid references auth.users(id),
  foreign key (company_id, session_id) references public.pos_sessions(company_id, id)
);
select app.register_table('public.pos_cash_counts', 'pos', p_soft_delete => false, p_client_write => false, p_immutable => true);

-- inside close_pos_session, once the difference is known: is a manager's confirmation needed, and is it here?
create or replace function app.pos_close_check(p_company uuid, p_diff numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare v_mode text; v_tol numeric; v_who uuid; v_tok text := nullif(current_setting('app.pos_close_approval', true), '');
begin
  perform set_config('app.pos_close_witnessed_by', '', true);
  if v_tok is not null then
    v_who := app.pos_approval_user(p_company, v_tok, 'close');
    if v_who is null then raise exception 'The manager''s confirmation has expired. Ask for it again.' using errcode = '23514'; end if;
    perform set_config('app.pos_close_witnessed_by', v_who::text, true);
    return;
  end if;
  select coalesce(pos_close_witness, 'difference'), coalesce(pos_cash_tolerance, 0) into v_mode, v_tol from public.company_settings where company_id = p_company;
  v_mode := coalesce(v_mode, 'difference');
  if v_mode = 'never' or (v_mode = 'difference' and abs(p_diff) <= coalesce(v_tol, 0)) then return; end if;
  -- a manager closing their own till, or a shop without a manager who has a PIN: nobody else can confirm
  if app.has_permission(p_company, 'pos.approve') or jsonb_array_length(app.pos_managers(p_company)) = 0 then return; end if;
  if v_mode = 'always' then
    raise exception 'A manager confirms the count with their PIN' using errcode = '23514';
  end if;
  raise exception 'The drawer is % off: a manager confirms the count with their PIN', to_char(p_diff, 'FMS999G999G990D00') using errcode = '23514';
end $$;
revoke execute on function app.pos_close_check(uuid, numeric) from public, anon, authenticated;

select app._patch_function('public.close_pos_session',
  $x$  v_diff := round(p_counted_cash - v_expected, 2);
$x$,
  $x$  v_diff := round(p_counted_cash - v_expected, 2);
  perform app.pos_close_check(s.company_id, v_diff);
$x$);

-- what the till calls: the count, then the closing itself
create or replace function public.pos_close(p_session uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare s public.pos_sessions; v_z uuid; v_counted numeric := (p ->> 'counted')::numeric; v_notes jsonb := nullif(p -> 'notes_coins', 'null'::jsonb);
begin
  select * into s from public.pos_sessions where id = p_session;
  if s.id is null then raise exception 'Session not found' using errcode = 'P0002'; end if;
  perform app.require_permission(s.company_id, 'pos.write');
  if v_notes is not null and jsonb_typeof(v_notes) <> 'object' then v_notes := null; end if;
  -- the notes and coins only, with how many of each
  if v_notes is not null then
    select nullif(jsonb_object_agg(key, value::int), '{}'::jsonb) into v_notes from jsonb_each_text(v_notes)
     where key ~ '^\d+(\.\d+)?$' and value ~ '^\d+$' and value::int > 0;
  end if;
  perform set_config('app.pos_close_approval', coalesce(p ->> 'approval', ''), true);
  v_z := public.close_pos_session(p_session, v_counted, p ->> 'notes');
  perform set_config('app.pos_close_approval', '', true);
  insert into public.pos_cash_counts (company_id, session_id, z_report_id, notes_coins, counted, difference, counted_by, witnessed_by)
  select s.company_id, s.id, v_z, v_notes, v_counted, z.cash_difference, auth.uid(),
         nullif(current_setting('app.pos_close_witnessed_by', true), '')::uuid
    from public.z_reports z where z.id = v_z;
  return v_z;
end $$;
revoke execute on function public.pos_close(uuid, jsonb) from public, anon;
grant execute on function public.pos_close(uuid, jsonb) to authenticated;

-- for the Z report and the shift's page: the count, who confirmed it, the till's log
create or replace function public.pos_session_controls(p_session uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s public.pos_sessions; c public.pos_cash_counts;
begin
  select * into s from public.pos_sessions where id = p_session;
  if s.id is null then raise exception 'Session not found' using errcode = 'P0002'; end if;
  perform app.require_permission(s.company_id, 'pos.read');
  select * into c from public.pos_cash_counts where session_id = s.id;
  return jsonb_build_object(
    'count', case when c.id is not null then jsonb_build_object('notes_coins', c.notes_coins, 'counted', c.counted, 'difference', c.difference,
               'counted_by', app.person_name(c.counted_by), 'witnessed_by', app.person_name(c.witnessed_by)) end,
    'voids', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(amount), 0),
                'unconfirmed', count(*) filter (where approved_by is null),
                'lines', coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'description', description, 'quantity', quantity, 'amount', amount, 'at', at,
                           'cashier', app.person_name(cashier_id), 'approved_by', app.person_name(approved_by), 'offline', offline) order by at), '[]'::jsonb))
                from public.pos_till_log where session_id = s.id and kind like 'void%'),
    'age', (select jsonb_build_object('checked', count(*) filter (where kind = 'age_ok'), 'refused', count(*) filter (where kind = 'age_refused'))
              from public.pos_till_log where session_id = s.id and kind like 'age%'));
end $$;
revoke execute on function public.pos_session_controls(uuid) from public, anon;
grant execute on function public.pos_session_controls(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- short dates: proposal → manager's approval (a promotion in that store until the date) → write-off
-- -----------------------------------------------------------------------------
create table public.expiry_markdowns (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  warehouse_id  uuid not null,
  variant_id    uuid not null,
  lot_id        uuid references public.lots(id),
  expiry_date   date not null,
  quantity      numeric(18,4) not null check (quantity > 0),
  discount_pct  numeric(5,2) not null check (discount_pct > 0 and discount_pct <= 90),
  status        text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected', 'written_off')),
  note          text,
  promotion_id  uuid references public.promotions(id),
  adjustment_id uuid references public.stock_adjustments(id),
  proposed_by   uuid not null default auth.uid(),
  decided_by    uuid,
  decided_at    timestamptz,
  foreign key (company_id, warehouse_id) references public.warehouses(company_id, id),
  foreign key (company_id, variant_id)   references public.product_variants(company_id, id)
);
create index on public.expiry_markdowns (company_id, status, expiry_date);
select app.register_table('public.expiry_markdowns', 'inventory', p_soft_delete => false, p_client_write => false);

create or replace function app.expiry_can(p_company uuid, p_what text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case p_what
    when 'propose' then app.has_permission(p_company, 'inventory.write') or app.has_permission(p_company, 'wms.write') or app.has_permission(p_company, 'pos.approve')
    when 'decide'  then app.has_permission(p_company, 'pos.approve') or app.has_permission(p_company, 'inventory.approve')
    else false end
$$;
revoke execute on function app.expiry_can(uuid, text) from public, anon, authenticated;

-- what is about to expire (or has) in a store: lots with dates, open proposals, recent decisions
create or replace function public.expiry_overview(p_company uuid, p_warehouse uuid default null, p_days int default 7)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_today date;
begin
  perform app.require_permission(p_company, 'inventory.read');
  v_today := (now() at time zone coalesce((select timezone from public.companies where id = p_company), 'Europe/Tirane'))::date;
  return jsonb_build_object(
    'today', v_today,
    'can', jsonb_build_object('propose', app.expiry_can(p_company, 'propose'), 'decide', app.expiry_can(p_company, 'decide'),
                              'write_off', app.has_permission(p_company, 'inventory.write')),
    'lots', coalesce((select jsonb_agg(x order by x ->> 'expiry_date', x ->> 'name') from (
        select jsonb_build_object('lot_id', l.id, 'lot_number', l.lot_number, 'variant_id', v.id, 'sku', v.sku, 'name', v.name,
                 'warehouse_id', w.id, 'warehouse', w.name, 'expiry_date', l.expiry_date, 'days_left', l.expiry_date - v_today,
                 'on_hand', sum(sl.on_hand), 'value', round(sum(sl.on_hand) * coalesce(max(ic.avg_cost), 0), 2),
                 'price', max(p.sales_price),
                 'markdown', (select jsonb_build_object('id', em.id, 'status', em.status, 'discount_pct', em.discount_pct)
                                from public.expiry_markdowns em where em.lot_id = l.id and em.warehouse_id = w.id and em.status in ('proposed', 'approved')
                               order by em.created_at desc limit 1)) as x
          from public.lots l
          join public.stock_levels sl on sl.lot_id = l.id and sl.on_hand > 0
          join public.warehouses w on w.id = sl.warehouse_id
          join public.product_variants v on v.id = l.variant_id
          join public.products p on p.id = v.product_id
          left join public.item_costs ic on ic.variant_id = l.variant_id
         where l.company_id = p_company and l.deleted_at is null and l.expiry_date is not null
           and l.expiry_date <= v_today + greatest(coalesce(p_days, 7), 0)
           and (p_warehouse is null or w.id = p_warehouse)
         group by l.id, v.id, w.id) q), '[]'::jsonb),
    'markdowns', coalesce((select jsonb_agg(jsonb_build_object('id', em.id, 'status', em.status, 'variant_id', em.variant_id, 'sku', v.sku, 'name', v.name,
                 'warehouse_id', em.warehouse_id, 'warehouse', w.name, 'lot_number', l.lot_number, 'expiry_date', em.expiry_date,
                 'days_left', em.expiry_date - v_today, 'quantity', em.quantity, 'discount_pct', em.discount_pct, 'note', em.note,
                 'price', p.sales_price, 'proposed_by', app.person_name(em.proposed_by), 'decided_by', app.person_name(em.decided_by),
                 'created_at', em.created_at, 'decided_at', em.decided_at, 'mine', em.proposed_by = auth.uid(),
                 'adjustment_number', (select number from public.stock_adjustments where id = em.adjustment_id),
                 'adjustment_status', (select status from public.stock_adjustments where id = em.adjustment_id))
               order by case em.status when 'proposed' then 0 when 'approved' then 1 else 2 end, em.expiry_date, v.name)
          from public.expiry_markdowns em
          join public.product_variants v on v.id = em.variant_id
          join public.products p on p.id = v.product_id
          join public.warehouses w on w.id = em.warehouse_id
          left join public.lots l on l.id = em.lot_id
         where em.company_id = p_company and (p_warehouse is null or em.warehouse_id = p_warehouse)
           and (em.status in ('proposed', 'approved') or em.decided_at > now() - interval '14 days')), '[]'::jsonb));
end $$;
revoke execute on function public.expiry_overview(uuid, uuid, int) from public, anon;
grant execute on function public.expiry_overview(uuid, uuid, int) to authenticated;

create or replace function public.expiry_propose(p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_co uuid := (p ->> 'company_id')::uuid; v_id uuid; v_lot public.lots; v_name text; v_wh text; v_date date;
begin
  if v_co is null or not app.expiry_can(v_co, 'propose') then raise exception 'Permission denied: you may not propose discounts' using errcode = '42501'; end if;
  if nullif(p ->> 'lot_id', '') is not null then
    select * into v_lot from public.lots where id = (p ->> 'lot_id')::uuid and company_id = v_co;
    if v_lot.id is null then raise exception 'Lot not found' using errcode = 'P0002'; end if;
  end if;
  v_date := coalesce(nullif(p ->> 'expiry_date', '')::date, v_lot.expiry_date);
  if v_date is null then raise exception 'Enter the expiry date' using errcode = '23514'; end if;
  if exists (select 1 from public.expiry_markdowns where company_id = v_co and warehouse_id = (p ->> 'warehouse_id')::uuid
              and variant_id = coalesce(v_lot.variant_id, (p ->> 'variant_id')::uuid) and expiry_date = v_date and status in ('proposed', 'approved')) then
    raise exception 'This item with this date already has a discount' using errcode = '23505';
  end if;
  insert into public.expiry_markdowns (company_id, warehouse_id, variant_id, lot_id, expiry_date, quantity, discount_pct, note)
  values (v_co, (p ->> 'warehouse_id')::uuid, coalesce(v_lot.variant_id, (p ->> 'variant_id')::uuid), v_lot.id, v_date,
          (p ->> 'quantity')::numeric, (p ->> 'discount_pct')::numeric, nullif(btrim(p ->> 'note'), ''))
  returning id into v_id;
  if coalesce((p ->> 'approve')::boolean, false) and app.expiry_can(v_co, 'decide') then
    perform public.expiry_decide(v_id, true);
  else
    select v.name into v_name from public.product_variants v where v.id = coalesce(v_lot.variant_id, (p ->> 'variant_id')::uuid);
    select name into v_wh from public.warehouses where id = (p ->> 'warehouse_id')::uuid;
    perform app.notify_permission(v_co, 'pos.approve', 'approval', 'Discount for a short date: ' || v_name,
      v_wh || ' · ' || to_char(v_date, 'DD.MM.YYYY') || ' · −' || trim(to_char((p ->> 'discount_pct')::numeric, 'FM990D##')) || '%', '/inventory/expiry');
  end if;
  return v_id;
end $$;
revoke execute on function public.expiry_propose(jsonb) from public, anon;
grant execute on function public.expiry_propose(jsonb) to authenticated;

-- approving makes a promotion in that store, from today until the date; the manager may change the %
create or replace function public.expiry_decide(p_id uuid, p_approve boolean, p_pct numeric default null, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare em public.expiry_markdowns; v_promo uuid; v_name text; v_today date;
begin
  select * into em from public.expiry_markdowns where id = p_id for update;
  if em.id is null then raise exception 'Proposal not found' using errcode = 'P0002'; end if;
  if not app.expiry_can(em.company_id, 'decide') then raise exception 'Permission denied: a store manager decides on discounts' using errcode = '42501'; end if;
  if em.status <> 'proposed' then raise exception 'This proposal is already %', em.status using errcode = '55000'; end if;
  v_today := (now() at time zone coalesce((select timezone from public.companies where id = em.company_id), 'Europe/Tirane'))::date;
  if not p_approve then
    update public.expiry_markdowns set status = 'rejected', decided_by = auth.uid(), decided_at = now(), note = coalesce(nullif(btrim(p_note), ''), note) where id = em.id;
    return;
  end if;
  if p_pct is not null and (p_pct <= 0 or p_pct > 90) then raise exception 'The discount is between 1 and 90%%' using errcode = '23514'; end if;
  if em.expiry_date < v_today then raise exception 'The date has passed: take it off the shelf instead' using errcode = '23514'; end if;
  select v.name into v_name from public.product_variants v where v.id = em.variant_id;
  insert into public.promotions (company_id, name, kind, value, variant_ids, starts_on, ends_on, channels, warehouse_ids)
  values (em.company_id, left('Afat i afërt · ' || v_name, 120), 'percent', coalesce(p_pct, em.discount_pct), array[em.variant_id], v_today, em.expiry_date,
          array['pos'], array[em.warehouse_id])
  returning id into v_promo;
  update public.expiry_markdowns set status = 'approved', discount_pct = coalesce(p_pct, discount_pct), promotion_id = v_promo,
         decided_by = auth.uid(), decided_at = now(), note = coalesce(nullif(btrim(p_note), ''), note)
   where id = em.id;
  if em.proposed_by is distinct from auth.uid() then
    perform app.notify(em.company_id, em.proposed_by, 'info', 'Discount approved: ' || v_name,
      '−' || trim(to_char(coalesce(p_pct, em.discount_pct), 'FM990D##')) || '% · ' || to_char(em.expiry_date, 'DD.MM.YYYY'), '/inventory/expiry', 'expiry_markdown', em.id);
  end if;
end $$;
revoke execute on function public.expiry_decide(uuid, boolean, numeric, text) from public, anon;
grant execute on function public.expiry_decide(uuid, boolean, numeric, text) to authenticated;

-- off the shelf: a stock adjustment (reason expiry) for what is left; posted when the person may post
-- stock, otherwise it waits for the stock manager. The discount, if any, ends.
create or replace function public.expiry_write_off(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_co uuid := (p ->> 'company_id')::uuid; v_wh uuid := (p ->> 'warehouse_id')::uuid; v_var uuid := nullif(p ->> 'variant_id', '')::uuid;
  v_lot uuid := nullif(p ->> 'lot_id', '')::uuid; v_qty numeric := (p ->> 'quantity')::numeric; v_left numeric; em public.expiry_markdowns;
  v_adj uuid; v_status text; x record; v_take numeric; v_name text;
begin
  if nullif(p ->> 'markdown_id', '') is not null then
    select * into em from public.expiry_markdowns where id = (p ->> 'markdown_id')::uuid for update;
    if em.id is null then raise exception 'Proposal not found' using errcode = 'P0002'; end if;
    if em.status = 'written_off' then raise exception 'This item is already off the shelf' using errcode = '55000'; end if;
    v_co := em.company_id; v_wh := em.warehouse_id; v_var := em.variant_id; v_lot := em.lot_id; v_qty := coalesce(v_qty, em.quantity);
  end if;
  if v_co is null or not app.expiry_can(v_co, 'propose') then raise exception 'Permission denied: you may not take stock off the shelf' using errcode = '42501'; end if;
  if v_lot is not null then select variant_id into v_var from public.lots where id = v_lot and company_id = v_co; end if;
  if v_var is null or v_wh is null then raise exception 'Choose the item and the store' using errcode = '23514'; end if;
  if v_qty is null or v_qty <= 0 then raise exception 'Enter how many are taken off' using errcode = '23514'; end if;
  select v.name into v_name from public.product_variants v where v.id = v_var and v.company_id = v_co;

  insert into public.stock_adjustments (company_id, warehouse_id, adjustment_date, reason, notes)
  values (v_co, v_wh, current_date, 'expiry', left('Afati i skaduar · ' || v_name, 200)) returning id into v_adj;
  v_left := v_qty;
  for x in select sl.location_id, sl.on_hand from public.stock_levels sl
            where sl.company_id = v_co and sl.warehouse_id = v_wh and sl.variant_id = v_var and sl.on_hand > 0
              and (v_lot is null or sl.lot_id = v_lot)
            order by sl.on_hand desc loop
    exit when v_left <= 0;
    v_take := least(v_left, x.on_hand);
    insert into public.stock_adjustment_lines (company_id, adjustment_id, variant_id, location_id, lot_id, quantity_change)
    values (v_co, v_adj, v_var, x.location_id, v_lot, -v_take);
    v_left := v_left - v_take;
  end loop;
  if v_left = v_qty then raise exception 'There is none of this item in stock here' using errcode = '23514'; end if;
  if v_left > 0 then raise exception 'Only % in stock here', trim(to_char(v_qty - v_left, 'FM999G999G990D####')) using errcode = '23514'; end if;

  if app.has_permission(v_co, 'inventory.write') then
    v_status := public.post_stock_adjustment(v_adj);
  else
    v_status := 'draft';
    perform app.notify_permission(v_co, 'inventory.write', 'approval', 'Expired stock to take off: ' || v_name,
      trim(to_char(v_qty, 'FM999G999G990D####')) || ' · ' || (select name from public.warehouses where id = v_wh), '/inventory/adjustments');
  end if;
  if em.id is not null then
    update public.expiry_markdowns set status = 'written_off', adjustment_id = v_adj, decided_by = coalesce(decided_by, auth.uid()), decided_at = coalesce(decided_at, now())
     where id = em.id;
    if em.promotion_id is not null then update public.promotions set is_active = false where id = em.promotion_id; end if;
  end if;
  return jsonb_build_object('adjustment_id', v_adj, 'number', (select number from public.stock_adjustments where id = v_adj), 'status', v_status);
end $$;
revoke execute on function public.expiry_write_off(jsonb) from public, anon;
grant execute on function public.expiry_write_off(jsonb) to authenticated;

drop function app._patch_function(text, text, text);
