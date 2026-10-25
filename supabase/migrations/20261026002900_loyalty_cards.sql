-- =============================================================================
-- DrisPRO · loyalty cards (kartela e zbritjes)
--
-- programs  what a card gives: a fixed discount, points, or a staff discount with a
--           monthly limit; which categories and stores it applies to; from / until.
-- cards     one per customer, valid in every store of the company. The number is an
--           EAN-13 in the in-store range (prefix 29) so any scanner reads it.
-- ledger    every point earned or spent and every discount given, per receipt.
--
-- At the till the discount is worked out by the server (loyalty_quote) and checked
-- again when the receipt arrives (pos_submit_order), so nobody can type a bigger card
-- discount. Discounts are line discounts: VAT and the fiscal receipt stay correct.
-- =============================================================================

-- phone numbers compare without country code or leading 0: +383 44 123 456 = 044 123 456
create or replace function app.phone_key(p text)
returns text language sql immutable set search_path = '' as $$
  select nullif(regexp_replace(regexp_replace(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '^(00)?(383|355)', ''), '^0+', ''), '')
$$;

create table public.loyalty_programs (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id),
  name                text not null check (length(btrim(name)) between 1 and 80),
  kind                text not null default 'discount' check (kind in ('discount', 'points', 'staff')),
  discount_pct        numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  points_per_unit     numeric(10,4) not null default 0 check (points_per_unit >= 0),   -- points for 1 € (or 1 lek) spent
  point_value         numeric(12,4) not null default 0 check (point_value >= 0),       -- what one point is worth when spent
  min_redeem_points   numeric(12,0) not null default 0 check (min_redeem_points >= 0),
  monthly_limit       numeric(18,2) check (monthly_limit is null or monthly_limit >= 0), -- most discount per card per month
  excluded_category_ids uuid[] not null default '{}',
  warehouse_ids       uuid[] not null default '{}',                                    -- empty = every store
  valid_from          date,
  valid_until         date,
  is_active           boolean not null default true,
  description         text,
  check (valid_until is null or valid_from is null or valid_until >= valid_from)
);
select app.register_table('public.loyalty_programs', 'pos', p_client_write => false);
create unique index loyalty_programs_name_key on public.loyalty_programs (company_id, lower(name)) where deleted_at is null;

create table public.loyalty_cards (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id),
  program_id      uuid not null,
  card_number     text not null,
  partner_id      uuid,
  holder_name     text not null check (length(btrim(holder_name)) between 1 and 120),
  phone           text,
  phone_digits    text generated always as (app.phone_key(phone)) stored,
  email           text,
  status          text not null default 'active' check (status in ('active', 'blocked', 'lost')),
  points_balance  numeric(14,0) not null default 0,
  last_used_at    timestamptz,
  notes           text,
  foreign key (company_id, program_id) references public.loyalty_programs(company_id, id),
  foreign key (company_id, partner_id) references public.business_partners(company_id, id)
);
select app.register_table('public.loyalty_cards', 'pos', p_client_write => false);
create unique index loyalty_cards_number_key on public.loyalty_cards (company_id, card_number) where deleted_at is null;
create index loyalty_cards_phone_idx on public.loyalty_cards (company_id, phone_digits) where deleted_at is null;

create table public.loyalty_ledger (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id),
  card_id      uuid not null,
  kind         text not null check (kind in ('earn', 'redeem', 'discount', 'refund', 'adjust')),
  points       numeric(14,0) not null default 0,
  amount       numeric(18,2) not null default 0,       -- discount given on the receipt
  pos_order_id uuid,
  warehouse_id uuid,
  note         text,
  occurred_at  timestamptz not null default now(),
  foreign key (company_id, card_id) references public.loyalty_cards(company_id, id),
  foreign key (company_id, pos_order_id) references public.pos_orders(company_id, id),
  foreign key (company_id, warehouse_id) references public.warehouses(company_id, id)
);
select app.register_table('public.loyalty_ledger', 'pos', p_soft_delete => false, p_client_write => false, p_immutable => true);
create index loyalty_ledger_card_idx on public.loyalty_ledger (card_id, occurred_at desc);

alter table public.pos_orders
  add column if not exists loyalty_card_id uuid,
  add column if not exists loyalty_discount numeric(18,2) not null default 0,
  add column if not exists points_earned numeric(14,0) not null default 0,
  add column if not exists points_redeemed numeric(14,0) not null default 0;
alter table public.pos_orders drop constraint if exists pos_orders_loyalty_card_fk;
alter table public.pos_orders add constraint pos_orders_loyalty_card_fk foreign key (company_id, loyalty_card_id) references public.loyalty_cards(company_id, id);

insert into public.document_types (key, name, module, table_name, default_prefix)
values ('loyalty_card', 'Loyalty card number (EAN-13, prefix 29)', 'pos', 'loyalty_cards', '29') on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- programs and cards (managers: pos.approve; cashiers may issue cards: pos.write)
-- -----------------------------------------------------------------------------
create or replace function public.loyalty_save_program(p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_company uuid := (p ->> 'company_id')::uuid; v_id uuid := nullif(p ->> 'id', '')::uuid; v_kind text := coalesce(nullif(p ->> 'kind', ''), 'discount');
begin
  perform app.require_permission(v_company, 'pos.approve');
  if nullif(btrim(p ->> 'name'), '') is null then raise exception 'Enter a name' using errcode = '23514'; end if;
  if v_kind = 'points' and (coalesce((p ->> 'points_per_unit')::numeric, 0) <= 0 or coalesce((p ->> 'point_value')::numeric, 0) <= 0) then
    raise exception 'A points card needs points per euro and the value of a point' using errcode = '23514';
  end if;
  if v_kind in ('discount', 'staff') and coalesce((p ->> 'discount_pct')::numeric, 0) <= 0 then
    raise exception 'Enter the discount' using errcode = '23514';
  end if;
  if v_id is null then
    insert into public.loyalty_programs (company_id, name, kind) values (v_company, btrim(p ->> 'name'), v_kind) returning id into v_id;
  end if;
  update public.loyalty_programs set
    name = btrim(p ->> 'name'), kind = v_kind,
    discount_pct = coalesce((p ->> 'discount_pct')::numeric, 0),
    points_per_unit = case when v_kind = 'points' then coalesce((p ->> 'points_per_unit')::numeric, 0) else 0 end,
    point_value = case when v_kind = 'points' then coalesce((p ->> 'point_value')::numeric, 0) else 0 end,
    min_redeem_points = case when v_kind = 'points' then coalesce((p ->> 'min_redeem_points')::numeric, 0) else 0 end,
    monthly_limit = nullif(p ->> 'monthly_limit', '')::numeric,
    excluded_category_ids = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p -> 'excluded_category_ids', '[]')) x), '{}'),
    warehouse_ids = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p -> 'warehouse_ids', '[]')) x), '{}'),
    valid_from = nullif(p ->> 'valid_from', '')::date, valid_until = nullif(p ->> 'valid_until', '')::date,
    is_active = coalesce((p ->> 'is_active')::boolean, true), description = nullif(btrim(p ->> 'description'), '')
  where id = v_id and company_id = v_company and deleted_at is null;
  if not found then raise exception 'Card type not found' using errcode = 'P0002'; end if;
  return v_id;
end $$;

create or replace function public.loyalty_issue_card(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_company uuid := (p ->> 'company_id')::uuid; v_number text := nullif(regexp_replace(coalesce(p ->> 'card_number', ''), '\s', '', 'g'), '');
  v_body text; v_id uuid; v_phone text := nullif(btrim(p ->> 'phone'), '');
begin
  perform app.require_permission(v_company, 'pos.write');
  if not exists (select 1 from public.loyalty_programs where id = (p ->> 'program_id')::uuid and company_id = v_company and deleted_at is null) then
    raise exception 'Choose the type of card' using errcode = '23514';
  end if;
  if nullif(btrim(p ->> 'holder_name'), '') is null then raise exception 'Enter the customer''s name' using errcode = '23514'; end if;
  if v_phone is not null and exists (select 1 from public.loyalty_cards where company_id = v_company and deleted_at is null and status = 'active'
                                      and phone_digits = app.phone_key(v_phone)) then
    raise exception 'A card with this phone number already exists' using errcode = '23505';
  end if;
  if v_number is null then
    insert into public.document_sequences (company_id, doc_type, prefix, include_year, padding, reset_policy)
    values (v_company, 'loyalty_card', '29', false, 10, 'never') on conflict (company_id, doc_type) do nothing;
    loop
      v_body := app.next_document_number(v_company, 'loyalty_card');
      v_number := v_body || app.gtin_check_digit(v_body)::text;
      exit when not exists (select 1 from public.loyalty_cards where company_id = v_company and card_number = v_number);
    end loop;
  elsif exists (select 1 from public.loyalty_cards where company_id = v_company and card_number = v_number and deleted_at is null) then
    raise exception 'This card number is already given to someone' using errcode = '23505';
  end if;
  insert into public.loyalty_cards (company_id, program_id, card_number, partner_id, holder_name, phone, email, notes)
  values (v_company, (p ->> 'program_id')::uuid, v_number, nullif(p ->> 'partner_id', '')::uuid, btrim(p ->> 'holder_name'), v_phone,
          nullif(btrim(p ->> 'email'), ''), nullif(btrim(p ->> 'notes'), ''))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'card_number', v_number);
end $$;

create or replace function public.loyalty_update_card(p_card uuid, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.loyalty_cards;
begin
  select * into c from public.loyalty_cards where id = p_card and deleted_at is null;
  if c.id is null then raise exception 'Card not found' using errcode = 'P0002'; end if;
  perform app.require_permission(c.company_id, 'pos.approve');
  update public.loyalty_cards set
    holder_name = coalesce(nullif(btrim(p ->> 'holder_name'), ''), holder_name),
    phone = case when p ? 'phone' then nullif(btrim(p ->> 'phone'), '') else phone end,
    email = case when p ? 'email' then nullif(btrim(p ->> 'email'), '') else email end,
    notes = case when p ? 'notes' then nullif(btrim(p ->> 'notes'), '') else notes end,
    status = coalesce(nullif(p ->> 'status', ''), status),
    program_id = coalesce(nullif(p ->> 'program_id', '')::uuid, program_id)
  where id = p_card;
end $$;

-- manual correction of points (a complaint, a lost receipt…)
create or replace function public.loyalty_adjust_points(p_card uuid, p_points numeric, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.loyalty_cards;
begin
  select * into c from public.loyalty_cards where id = p_card and deleted_at is null for update;
  if c.id is null then raise exception 'Card not found' using errcode = 'P0002'; end if;
  perform app.require_permission(c.company_id, 'pos.approve');
  if coalesce(p_points, 0) = 0 or p_points <> trunc(p_points) then raise exception 'Enter whole points, more or less than zero' using errcode = '23514'; end if;
  if nullif(btrim(p_note), '') is null then raise exception 'Write why the points change' using errcode = '23514'; end if;
  if c.points_balance + p_points < 0 then raise exception 'The card has only % points', c.points_balance using errcode = '23514'; end if;
  insert into public.loyalty_ledger (company_id, card_id, kind, points, note) values (c.company_id, c.id, 'adjust', p_points, btrim(p_note));
  update public.loyalty_cards set points_balance = points_balance + p_points where id = c.id;
end $$;

-- -----------------------------------------------------------------------------
-- the discount for a sale
-- p_lines: [{quantity, unit_price (VAT included), manual_pct, category_id? | variant_id}]
-- returns {usable, reason, card_id, program_id, kind, pct (after the monthly limit),
--          redeem_points, redeem_amount, lines: [{eligible, pct}], month_used, month_left}
-- -----------------------------------------------------------------------------
create or replace function app.loyalty_eval(p_company uuid, p_card uuid, p_warehouse uuid, p_lines jsonb, p_redeem numeric, p_at timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.loyalty_cards; g public.loyalty_programs; l jsonb; v_cat uuid; v_base numeric; v_after numeric := 0; v_disc numeric := 0;
  v_pct numeric; v_used numeric := 0; v_left numeric; v_pts numeric := 0; v_amt numeric := 0; v_e numeric := 0; v_out jsonb := '[]'::jsonb;
  v_elig boolean[] := '{}'; v_bases numeric[] := '{}'; i int := 0; v_reason text;
begin
  select * into c from public.loyalty_cards where id = p_card and company_id = p_company and deleted_at is null;
  if c.id is null then return jsonb_build_object('usable', false, 'reason', 'Card not found'); end if;
  select * into g from public.loyalty_programs where id = c.program_id;
  v_reason := case
    when c.status = 'blocked' then 'This card is blocked'
    when c.status = 'lost' then 'This card was reported lost'
    when not g.is_active or g.deleted_at is not null then 'This type of card is switched off'
    when g.valid_from is not null and p_at::date < g.valid_from then 'This card is not valid yet'
    when g.valid_until is not null and p_at::date > g.valid_until then 'This card has expired'
    when cardinality(g.warehouse_ids) > 0 and not (p_warehouse = any (g.warehouse_ids)) then 'This card is not valid in this store'
  end;
  if v_reason is not null then
    return jsonb_build_object('usable', false, 'reason', v_reason, 'card_id', c.id, 'program_id', g.id, 'kind', g.kind);
  end if;

  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    i := i + 1;
    v_cat := coalesce(nullif(l ->> 'category_id', '')::uuid,
                      (select p.category_id from public.product_variants v join public.products p on p.id = v.product_id where v.id = nullif(l ->> 'variant_id', '')::uuid));
    v_base := round(coalesce((l ->> 'quantity')::numeric, 0) * coalesce((l ->> 'unit_price')::numeric, 0), 2);
    v_elig := v_elig || (coalesce((l ->> 'quantity')::numeric, 0) > 0 and coalesce((l ->> 'manual_pct')::numeric, 0) = 0
                         and not (v_cat is not null and v_cat = any (g.excluded_category_ids)));
    v_bases := v_bases || v_base;
  end loop;

  v_pct := g.discount_pct;
  if g.monthly_limit is not null then
    select coalesce(sum(amount), 0) into v_used from public.loyalty_ledger
     where card_id = c.id and kind = 'discount' and occurred_at >= date_trunc('month', p_at) and occurred_at < date_trunc('month', p_at) + interval '1 month';
    v_left := greatest(g.monthly_limit - v_used, 0);
    for i in 1 .. coalesce(array_length(v_bases, 1), 0) loop
      if v_elig[i] then v_disc := v_disc + v_bases[i] * v_pct / 100; end if;
    end loop;
    if v_disc > v_left then v_pct := case when v_disc > 0 then floor(v_pct * v_left / v_disc * 100) / 100 else 0 end; end if;
  end if;

  for i in 1 .. coalesce(array_length(v_bases, 1), 0) loop
    if v_elig[i] then v_after := v_after + round(v_bases[i] * (1 - v_pct / 100), 2); end if;
  end loop;
  if g.kind = 'points' and coalesce(p_redeem, 0) > 0 and g.point_value > 0 then
    v_pts := least(floor(p_redeem), c.points_balance);
    if v_pts < g.min_redeem_points then v_pts := 0; end if;
    v_amt := round(v_pts * g.point_value, 2);
    if v_amt > v_after then v_pts := floor(v_after / g.point_value); v_amt := round(v_pts * g.point_value, 2); end if;
    if v_after > 0 then v_e := v_amt / v_after * 100; end if;
  end if;

  for i in 1 .. coalesce(array_length(v_bases, 1), 0) loop
    v_out := v_out || jsonb_build_object('eligible', v_elig[i],
               'pct', case when v_elig[i] then least(round(100 * (1 - (1 - v_pct / 100) * (1 - v_e / 100)), 2), 100) else 0 end);
  end loop;
  return jsonb_build_object('usable', true, 'card_id', c.id, 'program_id', g.id, 'kind', g.kind, 'program_pct', g.discount_pct, 'pct', v_pct,
    'redeem_points', v_pts, 'redeem_amount', v_amt, 'lines', v_out,
    'month_used', v_used, 'month_left', case when g.monthly_limit is null then null else greatest(g.monthly_limit - v_used, 0) end);
end $$;
revoke execute on function app.loyalty_eval(uuid, uuid, uuid, jsonb, numeric, timestamptz) from public, anon, authenticated;

-- the till asks before payment (online). p_code: card number or phone.
create or replace function public.loyalty_quote(p_register uuid, p_code text, p_lines jsonb, p_redeem numeric default 0)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.pos_registers; c public.loyalty_cards; g public.loyalty_programs; v_code text := btrim(coalesce(p_code, ''));
begin
  select * into r from public.pos_registers where id = p_register;
  if r.id is null then raise exception 'Till not found' using errcode = 'P0002'; end if;
  perform app.require_permission(r.company_id, 'pos.write');
  select * into c from public.loyalty_cards
   where company_id = r.company_id and deleted_at is null
     and (card_number = v_code or (length(coalesce(app.phone_key(v_code), '')) >= 6 and phone_digits = app.phone_key(v_code)))
   order by (status = 'active') desc, (card_number = v_code) desc limit 1;
  if c.id is null then raise exception 'No card with this number or phone' using errcode = 'P0002'; end if;
  select * into g from public.loyalty_programs where id = c.program_id;
  return app.loyalty_eval(r.company_id, c.id, r.warehouse_id, p_lines, p_redeem)
         || jsonb_build_object('card_number', c.card_number, 'holder_name', c.holder_name, 'points_balance', c.points_balance,
                               'program_name', g.name, 'point_value', g.point_value, 'points_per_unit', g.points_per_unit,
                               'min_redeem_points', g.min_redeem_points, 'status', c.status);
end $$;

-- cards and programs kept on the till so a discount card works without internet
create or replace function public.pos_loyalty_data(p_register uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.pos_registers;
begin
  select * into r from public.pos_registers where id = p_register;
  if r.id is null then raise exception 'Till not found' using errcode = 'P0002'; end if;
  perform app.require_permission(r.company_id, 'pos.read');
  return jsonb_build_object(
    'programs', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'kind', g.kind, 'discount_pct', g.discount_pct,
        'points_per_unit', g.points_per_unit, 'point_value', g.point_value, 'min_redeem_points', g.min_redeem_points, 'monthly_limit', g.monthly_limit,
        'valid_from', g.valid_from, 'valid_until', g.valid_until,
        'applies_here', g.is_active and (cardinality(g.warehouse_ids) = 0 or r.warehouse_id = any (g.warehouse_ids)),
        'excluded_categories', coalesce((select jsonb_agg(pc.name) from public.product_categories pc where pc.id = any (g.excluded_category_ids)), '[]'::jsonb)))
      from public.loyalty_programs g where g.company_id = r.company_id and g.deleted_at is null), '[]'::jsonb),
    'cards', coalesce((select jsonb_agg(jsonb_build_array(c.id, c.card_number, c.phone_digits, c.holder_name, c.program_id, c.points_balance,
        (select coalesce(sum(x.amount), 0) from public.loyalty_ledger x where x.card_id = c.id and x.kind = 'discount' and x.occurred_at >= date_trunc('month', now()))))
      from public.loyalty_cards c where c.company_id = r.company_id and c.deleted_at is null and c.status = 'active'), '[]'::jsonb));
end $$;

-- -----------------------------------------------------------------------------
-- the receipt: check the card discount, then book points and discount
-- p.loyalty: {card_id, redeem_points}; each line may carry manual_pct (the cashier's own discount)
-- -----------------------------------------------------------------------------
create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;

select app._patch_function('public.pos_submit_order',
  $x$v_max_disc numeric := 10; v_number text;$x$,
  $x$v_max_disc numeric := 10; v_number text; v_loy jsonb; v_card uuid; v_allowed numeric; v_ldisc numeric := 0; v_prog numeric := 0; v_earn numeric := 0; v_lc public.loyalty_cards; v_lg public.loyalty_programs;$x$);

select app._patch_function('public.pos_submit_order',
  $x$  returning id, number into v_id, v_number;
$x$,
  $x$  returning id, number into v_id, v_number;

  -- loyalty card: the server works the discount out again; nobody can type a bigger one
  v_card := nullif(p -> 'loyalty' ->> 'card_id', '')::uuid;
  if v_card is not null and not v_refund then
    v_loy := app.loyalty_eval(s.company_id, v_card, r.warehouse_id,
               (select jsonb_agg(jsonb_build_object('variant_id', x ->> 'variant_id', 'quantity', x ->> 'quantity', 'unit_price', x ->> 'unit_price',
                                                    'manual_pct', coalesce(x ->> 'manual_pct', case when coalesce((x ->> 'card')::boolean, false) then '0' else x ->> 'discount_pct' end)))
                  from jsonb_array_elements(coalesce(p -> 'lines', '[]'::jsonb)) x),
               coalesce((p -> 'loyalty' ->> 'redeem_points')::numeric, 0), v_order_at);
    if not (v_loy ->> 'usable')::boolean then
      if coalesce((p ->> 'offline')::boolean, false) then v_loy := null;   -- sold offline on a card that has just been blocked: keep the sale
      else raise exception '%', v_loy ->> 'reason' using errcode = '23514'; end if;
    end if;
    if v_loy is not null then update public.pos_orders set loyalty_card_id = v_card where id = v_id; end if;
  end if;
$x$);

select app._patch_function('public.pos_submit_order',
  $x$    if coalesce((l->>'discount_pct')::numeric, 0) > v_max_disc and not app.has_permission(s.company_id, 'pos.approve') then$x$,
  $x$    v_allowed := null;
    if v_loy is not null and coalesce((v_loy -> 'lines' -> (n - 1) ->> 'eligible')::boolean, false) then
      -- offline the till cannot know this month's limit: allow the card's own discount
      v_allowed := greatest((v_loy -> 'lines' -> (n - 1) ->> 'pct')::numeric,
                            case when coalesce((p ->> 'offline')::boolean, false) then (v_loy ->> 'program_pct')::numeric else 0 end);
      if coalesce((l->>'discount_pct')::numeric, 0) > v_allowed + 0.01 then
        raise exception 'Line %: the card gives % %%, not %', n, v_allowed, l->>'discount_pct' using errcode = '42501';
      end if;
    end if;
    if v_allowed is null and coalesce((l->>'discount_pct')::numeric, 0) > v_max_disc and not app.has_permission(s.company_id, 'pos.approve') then$x$);

select app._patch_function('public.pos_submit_order',
  $x$  update public.pos_orders set amount_paid = v_paid, change_given = greatest(v_change, 0), status = 'paid' where id = v_id;
$x$,
  $x$  update public.pos_orders set amount_paid = v_paid, change_given = greatest(v_change, 0), status = 'paid' where id = v_id;

  -- loyalty: discount given, points spent and earned
  if v_loy is not null then
    select * into v_lc from public.loyalty_cards where id = v_card for update;
    select * into v_lg from public.loyalty_programs where id = v_lc.program_id;
    select coalesce(sum(round(ol.quantity * ol.unit_price, 2) - ol.line_total), 0) into v_ldisc
      from public.pos_order_lines ol where ol.pos_order_id = v_id
       and coalesce((v_loy -> 'lines' -> (ol.line_no - 1) ->> 'eligible')::boolean, false);
    -- the part the card type gives by itself; the rest is what the points paid for
    select coalesce(sum(round(ol.quantity * ol.unit_price, 2) - round(ol.quantity * ol.unit_price * (1 - (v_loy ->> 'pct')::numeric / 100), 2)), 0) into v_prog
      from public.pos_order_lines ol where ol.pos_order_id = v_id
       and coalesce((v_loy -> 'lines' -> (ol.line_no - 1) ->> 'eligible')::boolean, false);
    v_prog := least(v_prog, v_ldisc);
    if v_lg.kind = 'points' then
      select floor(coalesce(sum(ol.line_total), 0) * v_lg.points_per_unit) into v_earn
        from public.pos_order_lines ol where ol.pos_order_id = v_id
         and coalesce((v_loy -> 'lines' -> (ol.line_no - 1) ->> 'eligible')::boolean, false);
    end if;
    if (v_loy ->> 'redeem_points')::numeric > 0 then
      insert into public.loyalty_ledger (company_id, card_id, kind, points, amount, pos_order_id, warehouse_id, occurred_at)
      values (s.company_id, v_card, 'redeem', -(v_loy ->> 'redeem_points')::numeric, v_ldisc - v_prog, v_id, r.warehouse_id, v_order_at);
    else
      v_prog := v_ldisc;
    end if;
    if v_prog > 0 then
      insert into public.loyalty_ledger (company_id, card_id, kind, points, amount, pos_order_id, warehouse_id, occurred_at)
      values (s.company_id, v_card, 'discount', 0, v_prog, v_id, r.warehouse_id, v_order_at);
    end if;
    if v_earn > 0 then
      insert into public.loyalty_ledger (company_id, card_id, kind, points, pos_order_id, warehouse_id, occurred_at)
      values (s.company_id, v_card, 'earn', v_earn, v_id, r.warehouse_id, v_order_at);
    end if;
    update public.loyalty_cards set points_balance = points_balance + v_earn - (v_loy ->> 'redeem_points')::numeric, last_used_at = v_order_at where id = v_card;
    update public.pos_orders set loyalty_discount = v_ldisc, points_earned = v_earn, points_redeemed = (v_loy ->> 'redeem_points')::numeric where id = v_id;
  end if;
  -- a refund takes back the points the sale earned, in proportion
  if v_refund and v_orig.loyalty_card_id is not null and v_orig.points_earned > 0 and v_orig.total <> 0 then
    v_earn := round(v_orig.points_earned * v_total / v_orig.total);   -- v_total is negative
    if v_earn <> 0 then
      insert into public.loyalty_ledger (company_id, card_id, kind, points, pos_order_id, warehouse_id, occurred_at)
      values (s.company_id, v_orig.loyalty_card_id, 'refund', v_earn, v_id, r.warehouse_id, v_order_at);
      update public.loyalty_cards set points_balance = points_balance + v_earn where id = v_orig.loyalty_card_id;
      update public.pos_orders set loyalty_card_id = v_orig.loyalty_card_id, points_earned = v_earn where id = v_id;
    end if;
  end if;
$x$);

drop function app._patch_function(text, text, text);

-- reports: what the cards cost and who uses them
create or replace function public.loyalty_overview(p_company uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'pos.read');
  return jsonb_build_object(
    'cards_active', (select count(*) from public.loyalty_cards where company_id = p_company and deleted_at is null and status = 'active'),
    'cards_used', (select count(distinct card_id) from public.loyalty_ledger where company_id = p_company and occurred_at::date between p_from and p_to),
    'discount', (select coalesce(sum(amount), 0) from public.loyalty_ledger where company_id = p_company and kind in ('discount', 'redeem') and occurred_at::date between p_from and p_to),
    'points_earned', (select coalesce(sum(points), 0) from public.loyalty_ledger where company_id = p_company and kind = 'earn' and occurred_at::date between p_from and p_to),
    'points_redeemed', (select coalesce(-sum(points), 0) from public.loyalty_ledger where company_id = p_company and kind = 'redeem' and occurred_at::date between p_from and p_to),
    'points_outstanding', (select coalesce(sum(c.points_balance), 0) from public.loyalty_cards c where c.company_id = p_company and c.deleted_at is null),
    'points_outstanding_value', (select coalesce(sum(c.points_balance * g.point_value), 0) from public.loyalty_cards c join public.loyalty_programs g on g.id = c.program_id
                                   where c.company_id = p_company and c.deleted_at is null),
    'card_sales', (select coalesce(sum(o.total), 0) from public.pos_orders o where o.company_id = p_company and o.loyalty_card_id is not null and o.status = 'paid'
                      and o.order_at::date between p_from and p_to),
    'all_sales', (select coalesce(sum(o.total), 0) from public.pos_orders o where o.company_id = p_company and o.status = 'paid' and o.order_at::date between p_from and p_to),
    'by_store', coalesce((select jsonb_agg(x order by x.discount desc) from (
        select w.name, sum(l.amount) filter (where l.kind in ('discount', 'redeem')) as discount, count(distinct l.pos_order_id) as receipts
          from public.loyalty_ledger l join public.warehouses w on w.id = l.warehouse_id
         where l.company_id = p_company and l.occurred_at::date between p_from and p_to group by w.name) x), '[]'::jsonb),
    'by_program', coalesce((select jsonb_agg(x order by x.discount desc) from (
        select g.name, sum(l.amount) filter (where l.kind in ('discount', 'redeem')) as discount, count(distinct l.card_id) as cards
          from public.loyalty_ledger l join public.loyalty_cards c on c.id = l.card_id join public.loyalty_programs g on g.id = c.program_id
         where l.company_id = p_company and l.occurred_at::date between p_from and p_to group by g.name) x), '[]'::jsonb),
    'top_customers', coalesce((select jsonb_agg(x order by x.spent desc) from (
        select c.id, c.holder_name, c.card_number, sum(o.total) as spent, count(*) as receipts, max(o.order_at) as last_at
          from public.pos_orders o join public.loyalty_cards c on c.id = o.loyalty_card_id
         where o.company_id = p_company and o.status = 'paid' and not o.is_refund and o.order_at::date between p_from and p_to
         group by c.id, c.holder_name, c.card_number order by sum(o.total) desc limit 10) x), '[]'::jsonb));
end $$;

revoke execute on function public.loyalty_save_program(jsonb), public.loyalty_issue_card(jsonb), public.loyalty_update_card(uuid, jsonb),
  public.loyalty_adjust_points(uuid, numeric, text), public.loyalty_quote(uuid, text, jsonb, numeric), public.pos_loyalty_data(uuid),
  public.loyalty_overview(uuid, date, date) from public, anon;
grant execute on function public.loyalty_save_program(jsonb), public.loyalty_issue_card(jsonb), public.loyalty_update_card(uuid, jsonb),
  public.loyalty_adjust_points(uuid, numeric, text), public.loyalty_quote(uuid, text, jsonb, numeric), public.pos_loyalty_data(uuid),
  public.loyalty_overview(uuid, date, date) to authenticated;
