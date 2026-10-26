-- =============================================================================
-- Field sales agents: a phone app that works without internet.
--   · an agent is a member with a warehouse to sell from and a cash bag (a safe they hold)
--   · their customers are the partners whose salesperson they are, and the ones on their route
--   · orders, collections and visits are sent with the id made on the phone, so a retry never doubles
--   · the cash they collect sits in their bag until a manager takes it into a safe (/safe)
-- =============================================================================

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;

alter table public.sales_orders drop constraint sales_orders_channel_check;
alter table public.sales_orders add constraint sales_orders_channel_check
  check (channel in ('direct','phone','email','ecommerce','pos','marketplace','agent'));

create table public.sales_agents (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  user_id       uuid not null references auth.users(id),
  warehouse_id  uuid,
  safe_id       uuid,
  is_active     boolean not null default true,
  unique (company_id, user_id),
  foreign key (company_id, warehouse_id) references public.warehouses(company_id, id),
  foreign key (company_id, safe_id)      references public.safes(company_id, id)
);
select app.register_table('public.sales_agents', 'sales', p_soft_delete => false, p_client_write => false);

create table public.agent_route_stops (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  agent_id    uuid not null,
  weekday     smallint not null check (weekday between 1 and 7),   -- 1 Monday … 7 Sunday
  partner_id  uuid not null,
  position    int not null default 0,
  unique (agent_id, weekday, partner_id),
  foreign key (company_id, agent_id)   references public.sales_agents(company_id, id) on delete cascade,
  foreign key (company_id, partner_id) references public.business_partners(company_id, id)
);
select app.register_table('public.agent_route_stops', 'sales', p_soft_delete => false, p_client_write => false, p_audit => false);

create table public.agent_visits (
  id              uuid primary key,                 -- made on the phone
  company_id      uuid not null references public.companies(id),
  agent_id        uuid not null,
  partner_id      uuid not null,
  visited_at      timestamptz not null,
  outcome         text not null check (outcome in ('order','payment','no_order','closed','other')),
  note            text,
  latitude        numeric(9,6),
  longitude       numeric(9,6),
  accuracy_m      numeric(9,1),
  sales_order_id  uuid,
  payment_id      uuid,
  foreign key (company_id, agent_id)   references public.sales_agents(company_id, id),
  foreign key (company_id, partner_id) references public.business_partners(company_id, id)
);
select app.register_table('public.agent_visits', 'sales', p_soft_delete => false, p_client_write => false, p_immutable => true, p_audit => false);
create index agent_visits_day_idx on public.agent_visits (company_id, visited_at desc);
create index agent_visits_partner_idx on public.agent_visits (partner_id, visited_at desc);

-- the agent row of the caller (or null)
create or replace function app.my_agent(p_company uuid)
returns public.sales_agents language sql stable security definer set search_path = '' as $$
  select a.* from public.sales_agents a where a.company_id = p_company and a.user_id = auth.uid() and a.is_active
$$;

create or replace function app.agent_require(p_company uuid)
returns public.sales_agents language plpgsql stable security definer set search_path = '' as $$
declare a public.sales_agents;
begin
  perform app.require_permission(p_company, 'sales.write');
  a := app.my_agent(p_company);
  if a.id is null then raise exception 'You are not set up as a field agent in this company' using errcode = '42501'; end if;
  return a;
end $$;

-- customers the agent may serve: theirs, or on their route (managers: everyone)
create or replace function app.agent_serves(a public.sales_agents, p_partner uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.business_partners bp where bp.id = p_partner and bp.company_id = a.company_id
                   and bp.is_customer and bp.deleted_at is null
                   and (bp.salesperson_id = a.user_id
                        or exists (select 1 from public.agent_route_stops s where s.agent_id = a.id and s.partner_id = bp.id)
                        or app.has_permission(a.company_id, 'sales.approve')))
$$;

-- when something was done on the phone: never in the future, at most a week back
create or replace function app.agent_time(p jsonb)
returns timestamptz language plpgsql stable set search_path = '' as $$
declare v timestamptz := coalesce(nullif(p ->> 'at', '')::timestamptz, now());
begin
  if v > now() + interval '5 minutes' then v := now(); end if;
  if v < now() - interval '7 days' then raise exception 'This was saved on the phone more than a week ago; enter it in the office' using errcode = '23514'; end if;
  return least(v, now());
end $$;

-- -----------------------------------------------------------------------------
-- Setup (sales managers)
-- -----------------------------------------------------------------------------
create or replace function public.agents_list(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'sales.approve');
  return jsonb_build_object(
    'agents', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'user_id', a.user_id, 'name', coalesce(pr.full_name, u.email), 'is_active', a.is_active,
        'warehouse_id', a.warehouse_id, 'warehouse', w.name, 'safe_id', a.safe_id, 'safe', s.name,
        'cash', case when a.safe_id is not null then app.safe_balance(a.safe_id) end,
        'customers', (select count(*) from public.business_partners bp where bp.company_id = a.company_id and bp.salesperson_id = a.user_id
                        and bp.deleted_at is null and bp.is_customer),
        'route', coalesce((select jsonb_agg(jsonb_build_object('weekday', r.weekday, 'partner_id', r.partner_id, 'name', bp.name, 'position', r.position)
                                            order by r.weekday, r.position)
                             from public.agent_route_stops r join public.business_partners bp on bp.id = r.partner_id where r.agent_id = a.id), '[]'::jsonb))
        order by coalesce(pr.full_name, u.email))
        from public.sales_agents a join auth.users u on u.id = a.user_id left join public.profiles pr on pr.id = a.user_id
        left join public.warehouses w on w.id = a.warehouse_id left join public.safes s on s.id = a.safe_id
       where a.company_id = p_company), '[]'::jsonb),
    'members', coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'name', coalesce(pr.full_name, u.email)) order by coalesce(pr.full_name, u.email))
        from public.company_members m join auth.users u on u.id = m.user_id left join public.profiles pr on pr.id = m.user_id
       where m.company_id = p_company and m.status = 'active'
         and not exists (select 1 from public.sales_agents a where a.company_id = p_company and a.user_id = m.user_id)), '[]'::jsonb),
    'warehouses', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name) order by w.name)
        from public.warehouses w where w.company_id = p_company and w.deleted_at is null and w.is_active), '[]'::jsonb),
    'safes', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'holder_id', s.holder_id) order by s.name)
        from public.safes s where s.company_id = p_company and s.deleted_at is null and s.is_active), '[]'::jsonb),
    'can_make_safe', app.safe_can(p_company, 'setup'));
end $$;

-- p: {company_id, id?, user_id, warehouse_id, safe_id | 'new', is_active}
create or replace function public.agent_save(p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_co uuid := (p ->> 'company_id')::uuid; v_id uuid := nullif(p ->> 'id', '')::uuid; v_user uuid; v_safe uuid; v_wh uuid; v_name text;
begin
  if v_id is not null then select company_id, user_id into v_co, v_user from public.sales_agents where id = v_id; end if;
  if v_co is null then raise exception 'Agent not found' using errcode = 'P0002'; end if;
  perform app.require_permission(v_co, 'sales.approve');
  v_user := coalesce(v_user, (p ->> 'user_id')::uuid);
  if not exists (select 1 from public.company_members where company_id = v_co and user_id = v_user and status = 'active') then
    raise exception 'The agent must be a member of the company' using errcode = '23514';
  end if;
  v_wh := nullif(p ->> 'warehouse_id', '')::uuid;
  if v_wh is null then raise exception 'Choose the warehouse the agent sells from' using errcode = '23514'; end if;

  if p ->> 'safe_id' = 'new' then
    if not app.safe_can(v_co, 'setup') then
      raise exception 'Only finance can open a new cash bag; choose an existing safe or ask them' using errcode = '42501';
    end if;
    select coalesce(pr.full_name, u.email) into v_name from auth.users u left join public.profiles pr on pr.id = u.id where u.id = v_user;
    v_safe := public.safe_save(jsonb_build_object('company_id', v_co, 'name', 'Agent · ' || v_name, 'holder_id', v_user,
                                                  'warehouse_id', v_wh, 'approval_limit', 0));
  else
    v_safe := nullif(p ->> 'safe_id', '')::uuid;
    if v_safe is not null and not exists (select 1 from public.safes where id = v_safe and company_id = v_co and deleted_at is null) then
      raise exception 'Safe not found' using errcode = 'P0002';
    end if;
  end if;

  if v_id is null then
    insert into public.sales_agents (company_id, user_id, warehouse_id, safe_id, is_active)
    values (v_co, v_user, v_wh, v_safe, coalesce((p ->> 'is_active')::boolean, true))
    on conflict (company_id, user_id) do update set warehouse_id = excluded.warehouse_id, safe_id = excluded.safe_id, is_active = excluded.is_active
    returning id into v_id;
  else
    update public.sales_agents set warehouse_id = v_wh, safe_id = v_safe, is_active = coalesce((p ->> 'is_active')::boolean, is_active)
     where id = v_id;
  end if;
  return v_id;
end $$;

-- the customers to visit on a weekday, in order; they become the agent's customers when they have none
create or replace function public.agent_route_save(p_agent uuid, p_weekday int, p_partners uuid[])
returns int language plpgsql security definer set search_path = '' as $$
declare a public.sales_agents; v_bad text;
begin
  select * into a from public.sales_agents where id = p_agent;
  if a.id is null then raise exception 'Agent not found' using errcode = 'P0002'; end if;
  perform app.require_permission(a.company_id, 'sales.approve');
  if p_weekday not between 1 and 7 then raise exception 'Day of the week is 1 to 7' using errcode = '22023'; end if;
  select string_agg(x::text, ', ') into v_bad from unnest(coalesce(p_partners, '{}')) x
   where not exists (select 1 from public.business_partners bp where bp.id = x and bp.company_id = a.company_id and bp.is_customer and bp.deleted_at is null);
  if v_bad is not null then raise exception 'Not a customer of this company: %', v_bad using errcode = '23514'; end if;

  delete from public.agent_route_stops where agent_id = a.id and weekday = p_weekday;
  insert into public.agent_route_stops (company_id, agent_id, weekday, partner_id, position)
  select a.company_id, a.id, p_weekday, x, min(n) from unnest(coalesce(p_partners, '{}')) with ordinality t(x, n) group by x;
  update public.business_partners set salesperson_id = a.user_id
   where id = any (p_partners) and company_id = a.company_id and salesperson_id is null;
  return coalesce(array_length(p_partners, 1), 0);
end $$;

-- -----------------------------------------------------------------------------
-- What the phone keeps for the day (and for working without internet)
-- -----------------------------------------------------------------------------
create or replace function public.agent_bootstrap(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare a public.sales_agents; v_cur text; v_today date; v_parts uuid[]; v_lists uuid[]; v_default uuid; s public.company_settings;
begin
  a := app.agent_require(p_company);
  select base_currency into v_cur from public.companies where id = p_company;
  select * into s from public.company_settings where company_id = p_company;
  v_today := app.safe_today(p_company);
  select coalesce(array_agg(distinct bp.id), '{}') into v_parts from public.business_partners bp
   where bp.company_id = p_company and bp.is_customer and bp.is_active and bp.deleted_at is null
     and (bp.salesperson_id = a.user_id or exists (select 1 from public.agent_route_stops r where r.agent_id = a.id and r.partner_id = bp.id));
  select id into v_default from public.price_lists where company_id = p_company and is_default and list_type = 'sales' and deleted_at is null and is_active limit 1;
  select coalesce(array_agg(distinct x), '{}') into v_lists from (
    select price_list_id x from public.business_partners where id = any (v_parts) and price_list_id is not null
    union select v_default where v_default is not null) t;

  return jsonb_build_object(
    'at', now(), 'today', v_today, 'weekday', extract(isodow from v_today)::int, 'currency', v_cur,
    'max_discount', coalesce(s.max_discount_pct, 0),
    'agent', jsonb_build_object('id', a.id, 'warehouse_id', a.warehouse_id,
                                'warehouse', (select name from public.warehouses where id = a.warehouse_id),
                                'safe_id', a.safe_id, 'safe', (select name from public.safes where id = a.safe_id),
                                'cash', case when a.safe_id is not null then app.safe_balance(a.safe_id) end),
    'route', coalesce((select jsonb_agg(jsonb_build_array(r.weekday, r.partner_id, r.position) order by r.weekday, r.position)
                         from public.agent_route_stops r where r.agent_id = a.id), '[]'::jsonb),
    'customers', coalesce((select jsonb_agg(jsonb_build_object(
        'id', bp.id, 'code', bp.code, 'name', bp.name, 'phone', bp.phone, 'tax_number', bp.tax_number,
        'currency', coalesce(bp.currency_code, v_cur), 'price_list_id', bp.price_list_id, 'discount', bp.default_discount_pct,
        'credit_limit', bp.credit_limit, 'exposure', app.customer_exposure(bp.id, null),
        'advance', coalesce((select sum(y.unallocated) from public.payments y where y.partner_id = bp.id and y.status = 'posted'
                               and y.document_type = 'customer_payment' and y.deleted_at is null and y.currency_code = v_cur), 0),
        'address', (select jsonb_build_object('line1', ad.line1, 'city', ad.city, 'lat', ad.latitude, 'lng', ad.longitude)
                      from public.partner_addresses ad where ad.partner_id = bp.id and ad.deleted_at is null
                     order by ad.is_default desc, ad.created_at limit 1),
        'open', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'number', i.number, 'date', i.invoice_date, 'due', i.due_date,
                                                               'currency', i.currency_code, 'total', i.total, 'open', i.amount_due) order by i.due_date, i.invoice_date)
                            from public.sales_invoices i where i.partner_id = bp.id and i.status = 'posted' and i.document_type = 'sales_invoice'
                             and i.payment_status <> 'paid' and i.deleted_at is null and i.amount_due > 0), '[]'::jsonb),
        'orders', coalesce((select jsonb_agg(o) from (select jsonb_build_object('id', o.id, 'number', o.number, 'date', o.order_date, 'status', o.status,
                                                                                 'total', o.total, 'currency', o.currency_code) o
                              from public.sales_orders o where o.partner_id = bp.id and o.deleted_at is null
                             order by o.order_date desc, o.created_at desc limit 5) t), '[]'::jsonb),
        'last_visit', (select max(v.visited_at) from public.agent_visits v where v.partner_id = bp.id))
        order by bp.name)
        from public.business_partners bp where bp.id = any (v_parts)), '[]'::jsonb),
    -- [variant, sku, name, base price, tax rate, available here, uom]
    'items', coalesce((select jsonb_agg(jsonb_build_array(v.id, v.sku, v.name, coalesce(v.sales_price_override, p.sales_price), coalesce(t.rate, 0),
                                  coalesce((select sum(sl.available) from public.stock_levels sl where sl.variant_id = v.id and sl.warehouse_id = a.warehouse_id), 0),
                                  (select u.code from public.units_of_measure u where u.id = p.uom_id)) order by v.name)
                         from public.product_variants v join public.products p on p.id = v.product_id
                         left join public.tax_codes t on t.id = p.sales_tax_code_id
                        where v.company_id = p_company and v.deleted_at is null and v.is_active and p.deleted_at is null and p.is_active and p.is_sellable), '[]'::jsonb),
    -- [partner, variant, min qty, price, discount] (base currency)
    'partner_prices', coalesce((select jsonb_agg(jsonb_build_array(pp.partner_id, pp.variant_id, pp.min_quantity, pp.price, pp.discount_pct))
                                  from public.partner_prices pp where pp.partner_id = any (v_parts) and pp.deleted_at is null
                                   and (pp.valid_from is null or pp.valid_from <= v_today) and (pp.valid_to is null or pp.valid_to >= v_today)), '[]'::jsonb),
    'price_lists', coalesce((select jsonb_agg(jsonb_build_object('id', pl.id, 'currency', pl.currency_code, 'with_tax', pl.prices_include_tax, 'default', pl.id = v_default,
                               'items', coalesce((select jsonb_agg(jsonb_build_array(i.variant_id, i.min_quantity, i.price, i.discount_pct))
                                                    from public.price_list_items i where i.price_list_id = pl.id and i.deleted_at is null
                                                     and (i.valid_from is null or i.valid_from <= v_today) and (i.valid_to is null or i.valid_to >= v_today)), '[]'::jsonb)))
                              from public.price_lists pl where pl.id = any (v_lists) and pl.is_active and pl.deleted_at is null
                               and (pl.valid_from is null or pl.valid_from <= v_today) and (pl.valid_to is null or pl.valid_to >= v_today)), '[]'::jsonb),
    'day', public.agent_my_day(p_company));
end $$;

-- what the agent did today
create or replace function public.agent_my_day(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare a public.sales_agents; v_today date;
begin
  a := app.agent_require(p_company);
  v_today := app.safe_today(p_company);
  return jsonb_build_object(
    'visits', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'partner_id', v.partner_id, 'at', v.visited_at, 'outcome', v.outcome, 'note', v.note)
                                         order by v.visited_at)
                          from public.agent_visits v where v.agent_id = a.id and app.agent_local_date(v.company_id, v.visited_at) = v_today), '[]'::jsonb),
    'orders', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'number', o.number, 'partner_id', o.partner_id, 'status', o.status,
                                                            'total', o.total, 'currency', o.currency_code) order by o.created_at)
                          from public.sales_orders o where o.company_id = p_company and o.channel = 'agent' and o.created_by = a.user_id
                           and o.order_date = v_today and o.deleted_at is null), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', y.id, 'number', y.number, 'partner_id', y.partner_id, 'amount', y.amount,
                                                              'currency', y.currency_code, 'status', y.status) order by y.created_at)
                            from public.payments y where y.company_id = p_company and y.created_by = a.user_id and y.payment_date = v_today
                             and y.document_type = 'customer_payment' and y.bank_account_id = (select bank_account_id from public.safes where id = a.safe_id)
                             and y.deleted_at is null), '[]'::jsonb),
    'cash', case when a.safe_id is not null then app.safe_balance(a.safe_id) end);
end $$;

create or replace function app.agent_local_date(p_company uuid, p_at timestamptz)
returns date language sql stable security definer set search_path = '' as $$
  select (p_at at time zone coalesce((select timezone from public.companies where id = p_company), 'Europe/Belgrade'))::date
$$;

-- what the customer owes on invoices, less what they paid in advance (base currency)
create or replace function app.agent_owed(p_partner uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(case when i.document_type = 'credit_note' then -1 else 1 end * round(i.amount_due * i.exchange_rate, 2))
                     from public.sales_invoices i
                    where i.partner_id = p_partner and i.status = 'posted' and i.payment_status <> 'paid' and i.deleted_at is null), 0)
       - coalesce((select sum(round(y.unallocated * y.exchange_rate, 2)) from public.payments y
                    where y.partner_id = p_partner and y.status = 'posted' and y.document_type = 'customer_payment' and y.deleted_at is null), 0)
$$;

-- -----------------------------------------------------------------------------
-- From the phone (each call carries the id made on the phone; a repeat returns the first answer)
-- -----------------------------------------------------------------------------
create or replace function app.agent_visit(a public.sales_agents, p_id uuid, p_partner uuid, p_at timestamptz, p_outcome text, p jsonb,
                                           p_order uuid default null, p_payment uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_lat numeric := nullif(p ->> 'lat', '')::numeric; v_lng numeric := nullif(p ->> 'lng', '')::numeric;
begin
  if v_lat is not null and (v_lat not between -90 and 90 or v_lng is null or v_lng not between -180 and 180) then v_lat := null; v_lng := null; end if;
  insert into public.agent_visits (id, company_id, agent_id, partner_id, visited_at, outcome, note, latitude, longitude, accuracy_m, sales_order_id, payment_id)
  values (p_id, a.company_id, a.id, p_partner, p_at, p_outcome, nullif(btrim(p ->> 'note'), ''), round(v_lat, 6), round(v_lng, 6),
          case when v_lat is not null then least(nullif(p ->> 'accuracy', '')::numeric, 99999) end, p_order, p_payment)
  on conflict (id) do nothing;
  -- the first good fix becomes the customer's location
  if v_lat is not null and coalesce(nullif(p ->> 'accuracy', '')::numeric, 0) <= 100 and coalesce((p ->> 'set_location')::boolean, false) then
    update public.partner_addresses set latitude = round(v_lat, 6), longitude = round(v_lng, 6)
     where id = (select id from public.partner_addresses where partner_id = p_partner and deleted_at is null order by is_default desc, created_at limit 1)
       and latitude is null;
  end if;
end $$;

-- p: {id, company_id, partner_id, outcome, note, lat, lng, accuracy, at, set_location}
create or replace function public.agent_visit_log(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.sales_agents; v_id uuid := (p ->> 'id')::uuid; v_partner uuid := (p ->> 'partner_id')::uuid; v_out text := coalesce(p ->> 'outcome', 'other');
begin
  a := app.agent_require((p ->> 'company_id')::uuid);
  if exists (select 1 from public.agent_visits where id = v_id) then return jsonb_build_object('id', v_id, 'replay', true); end if;
  if not app.agent_serves(a, v_partner) then raise exception 'This customer is not on your list' using errcode = '42501'; end if;
  if v_out not in ('no_order','closed','other') then raise exception 'Unknown visit result %', v_out using errcode = '22023'; end if;
  perform app.agent_visit(a, v_id, v_partner, app.agent_time(p), v_out, p);
  return jsonb_build_object('id', v_id);
end $$;

-- p: {id, company_id, partner_id, lines: [{variant_id, quantity, discount_pct?}], note, requested_date, lat, lng, accuracy, at}
-- The prices are the company's (the phone's are an estimate); a discount up to the company limit is the agent's to give.
create or replace function public.agent_order_submit(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a public.sales_agents; v_id uuid := (p ->> 'id')::uuid; v_partner uuid := (p ->> 'partner_id')::uuid; bp public.business_partners;
  o public.sales_orders; l jsonb; v_n int := 0; v_at timestamptz; v_date date; v_cur text; pr record; v_var record; v_disc numeric;
  v_qty numeric; v_status text; v_why text;
begin
  a := app.agent_require((p ->> 'company_id')::uuid);
  select * into o from public.sales_orders where id = v_id;
  if o.id is not null then
    if o.company_id <> a.company_id or o.created_by <> a.user_id then raise exception 'Order not found' using errcode = 'P0002'; end if;
    return jsonb_build_object('id', o.id, 'number', o.number, 'status', o.status, 'total', o.total, 'currency', o.currency_code, 'replay', true);
  end if;
  if not app.agent_serves(a, v_partner) then raise exception 'This customer is not on your list' using errcode = '42501'; end if;
  if jsonb_array_length(coalesce(p -> 'lines', '[]'::jsonb)) = 0 then raise exception 'Add at least one line before confirming' using errcode = '23514'; end if;
  select * into bp from public.business_partners where id = v_partner;
  v_at := app.agent_time(p);
  v_date := app.agent_local_date(a.company_id, v_at);
  v_cur := coalesce(bp.currency_code, (select base_currency from public.companies where id = a.company_id));

  insert into public.sales_orders (id, company_id, partner_id, order_date, requested_date, warehouse_id, currency_code, price_list_id, payment_term_id,
                                   salesperson_id, channel, notes)
  values (v_id, a.company_id, v_partner, v_date, nullif(p ->> 'requested_date', '')::date,
          coalesce(a.warehouse_id, (select id from public.warehouses where company_id = a.company_id and deleted_at is null and is_active order by created_at limit 1)),
          v_cur, bp.price_list_id, bp.payment_term_id, a.user_id, 'agent', nullif(btrim(p ->> 'note'), ''));

  for l in select * from jsonb_array_elements(p -> 'lines') loop
    v_qty := (l ->> 'quantity')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'Quantity must be more than zero' using errcode = '23514'; end if;
    select v.id, v.name, v.sku, p2.uom_id into v_var from public.product_variants v join public.products p2 on p2.id = v.product_id
     where v.id = (l ->> 'variant_id')::uuid and v.company_id = a.company_id;
    if v_var.id is null then raise exception 'Product not found' using errcode = 'P0002'; end if;
    select * into pr from public.get_price(a.company_id, v_partner, v_var.id, v_qty, v_date, bp.price_list_id, v_cur);
    v_disc := coalesce(nullif(l ->> 'discount_pct', '')::numeric, pr.discount_pct, 0);
    if v_disc < 0 or v_disc > 100 then raise exception 'A discount is between 0 and 100' using errcode = '23514'; end if;
    v_n := v_n + 1;
    insert into public.sales_order_lines (company_id, sales_order_id, line_no, variant_id, description, quantity, uom_id, unit_price, discount_pct, tax_code_id)
    values (a.company_id, v_id, v_n, v_var.id, v_var.name, v_qty, v_var.uom_id, coalesce(pr.unit_price, 0), v_disc, pr.tax_code_id);
  end loop;

  -- confirm it now; when the credit limit or a big discount stops that, it waits as a draft for the manager
  begin
    perform public.confirm_sales_order(v_id);
  exception when others then
    v_why := sqlerrm;
  end;
  select * into o from public.sales_orders where id = v_id;
  if v_why is not null then
    perform app.notify_permission(a.company_id, 'sales.approve', 'warning', 'Agent order waits for you: ' || bp.name,
      o.number || ' · ' || v_why, '/sales/orders/' || o.id);
  end if;
  perform app.agent_visit(a, coalesce(nullif(p ->> 'visit_id', '')::uuid, gen_random_uuid()), v_partner, v_at, 'order', p, v_id, null);
  return jsonb_build_object('id', o.id, 'number', o.number, 'status', o.status, 'total', o.total, 'currency', o.currency_code, 'held', v_why);
end $$;

-- p: {id, company_id, partner_id, amount, note, invoices?: [id…], lat, lng, accuracy, at}
-- Cash into the agent's bag, set against the oldest open invoices (or the ones picked).
create or replace function public.agent_payment_submit(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a public.sales_agents; v_id uuid := (p ->> 'id')::uuid; v_partner uuid := (p ->> 'partner_id')::uuid; y public.payments;
  v_amount numeric := round((p ->> 'amount')::numeric, 2); v_left numeric; v_at timestamptz; v_cur text; v_ba uuid; i record; v_take numeric;
  v_picked uuid[];
begin
  a := app.agent_require((p ->> 'company_id')::uuid);
  select * into y from public.payments where id = v_id;
  if y.id is not null then
    if y.company_id <> a.company_id or y.created_by <> a.user_id then raise exception 'Payment not found' using errcode = 'P0002'; end if;
    return jsonb_build_object('id', y.id, 'number', y.number, 'status', y.status, 'amount', y.amount, 'currency', y.currency_code,
                              'balance', app.agent_owed(y.partner_id), 'replay', true);
  end if;
  if not app.agent_serves(a, v_partner) then raise exception 'This customer is not on your list' using errcode = '42501'; end if;
  if a.safe_id is null then raise exception 'You have no cash bag yet; ask the manager to set it' using errcode = '23514'; end if;
  if v_amount is null or v_amount <= 0 then raise exception 'The amount must be more than zero' using errcode = '23514'; end if;
  select bank_account_id into v_ba from public.safes where id = a.safe_id and is_active and deleted_at is null;
  if v_ba is null then raise exception 'Your cash bag is closed; ask the manager' using errcode = '23514'; end if;
  select base_currency into v_cur from public.companies where id = a.company_id;
  v_at := app.agent_time(p);

  insert into public.payments (id, company_id, document_type, partner_id, payment_date, method, amount, currency_code, bank_account_id, reference, notes)
  values (v_id, a.company_id, 'customer_payment', v_partner, app.agent_local_date(a.company_id, v_at), 'cash', v_amount, v_cur, v_ba,
          'Agent', nullif(btrim(p ->> 'note'), ''));

  select coalesce(array_agg(x::uuid), '{}') into v_picked from jsonb_array_elements_text(coalesce(p -> 'invoices', '[]'::jsonb)) x;
  v_left := v_amount;
  for i in select inv.id, inv.amount_due from public.sales_invoices inv
            where inv.partner_id = v_partner and inv.company_id = a.company_id and inv.status = 'posted' and inv.document_type = 'sales_invoice'
              and inv.payment_status <> 'paid' and inv.currency_code = v_cur and inv.amount_due > 0 and inv.deleted_at is null
            order by (inv.id = any (v_picked)) desc, inv.due_date, inv.invoice_date, inv.number
            for update loop
    exit when v_left <= 0;
    v_take := least(v_left, i.amount_due);
    insert into public.payment_allocations (company_id, payment_id, sales_invoice_id, amount) values (a.company_id, v_id, i.id, v_take);
    v_left := v_left - v_take;
  end loop;

  perform set_config('app.agent_collection', v_id::text, true);
  perform public.post_payment(v_id);
  perform set_config('app.agent_collection', '', true);
  select * into y from public.payments where id = v_id;
  perform app.agent_visit(a, coalesce(nullif(p ->> 'visit_id', '')::uuid, gen_random_uuid()), v_partner, v_at, 'payment', p, null, v_id);
  return jsonb_build_object('id', y.id, 'number', y.number, 'status', y.status, 'amount', y.amount, 'currency', y.currency_code,
                            'unallocated', v_left, 'balance', app.agent_owed(v_partner),
                            'cash', app.safe_balance(a.safe_id));
end $$;

-- the agent's own collection is posted without invoicing.write
select app._patch_function('public.post_payment',
  $x$  perform app.require_permission(p.company_id, 'invoicing.write');$x$,
  $x$  if current_setting('app.agent_collection', true) is distinct from p.id::text then
    perform app.require_permission(p.company_id, 'invoicing.write');
  end if;$x$);

-- -----------------------------------------------------------------------------
-- The manager's day: per agent, and every visit with where it was
-- -----------------------------------------------------------------------------
create or replace function public.agents_day(p_company uuid, p_date date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_day date;
begin
  perform app.require_permission(p_company, 'sales.approve');
  v_day := coalesce(p_date, app.safe_today(p_company));
  return jsonb_build_object('date', v_day, 'currency', (select base_currency from public.companies where id = p_company),
    'agents', coalesce((select jsonb_agg(x order by x ->> 'name') from (
      select jsonb_build_object(
        'id', a.id, 'name', coalesce(pr.full_name, u.email), 'is_active', a.is_active,
        'planned', (select count(*) from public.agent_route_stops r where r.agent_id = a.id and r.weekday = extract(isodow from v_day)),
        'visited', (select count(distinct v.partner_id) from public.agent_visits v where v.agent_id = a.id and app.agent_local_date(p_company, v.visited_at) = v_day),
        'planned_visited', (select count(*) from public.agent_route_stops r where r.agent_id = a.id and r.weekday = extract(isodow from v_day)
                              and exists (select 1 from public.agent_visits v where v.agent_id = a.id and v.partner_id = r.partner_id
                                            and app.agent_local_date(p_company, v.visited_at) = v_day)),
        'orders', (select count(*) from public.sales_orders o where o.company_id = p_company and o.channel = 'agent' and o.created_by = a.user_id
                     and o.order_date = v_day and o.deleted_at is null),
        'orders_total', (select coalesce(sum(o.total_base), 0) from public.sales_orders o where o.company_id = p_company and o.channel = 'agent'
                           and o.created_by = a.user_id and o.order_date = v_day and o.deleted_at is null and o.status <> 'cancelled'),
        'held', (select count(*) from public.sales_orders o where o.company_id = p_company and o.channel = 'agent' and o.created_by = a.user_id
                   and o.order_date = v_day and o.deleted_at is null and o.status in ('draft','pending_approval')),
        'collected', (select coalesce(sum(y.amount_base), 0) from public.payments y where y.company_id = p_company and y.created_by = a.user_id
                        and y.payment_date = v_day and y.document_type = 'customer_payment' and y.status = 'posted'
                        and y.bank_account_id = (select bank_account_id from public.safes where id = a.safe_id)),
        'cash', case when a.safe_id is not null then app.safe_balance(a.safe_id) end,
        'last', (select jsonb_build_object('at', v.visited_at, 'lat', v.latitude, 'lng', v.longitude, 'partner', bp.name)
                   from public.agent_visits v join public.business_partners bp on bp.id = v.partner_id
                  where v.agent_id = a.id and v.latitude is not null order by v.visited_at desc limit 1)) x
        from public.sales_agents a join auth.users u on u.id = a.user_id left join public.profiles pr on pr.id = a.user_id
       where a.company_id = p_company) t), '[]'::jsonb),
    'visits', coalesce((select jsonb_agg(jsonb_build_object(
        'id', v.id, 'agent_id', v.agent_id, 'partner', bp.name, 'partner_id', bp.id, 'at', v.visited_at, 'outcome', v.outcome, 'note', v.note,
        'lat', v.latitude, 'lng', v.longitude, 'accuracy', v.accuracy_m,
        'order', (select jsonb_build_object('id', o.id, 'number', o.number, 'total', o.total, 'currency', o.currency_code, 'status', o.status)
                    from public.sales_orders o where o.id = v.sales_order_id),
        'payment', (select jsonb_build_object('id', y.id, 'number', y.number, 'amount', y.amount, 'currency', y.currency_code)
                      from public.payments y where y.id = v.payment_id),
        -- how far from the customer's saved location the agent was
        'distance_m', (select round(6371000 * 2 * asin(sqrt(power(sin(radians(ad.latitude - v.latitude) / 2), 2)
                                   + cos(radians(v.latitude)) * cos(radians(ad.latitude)) * power(sin(radians(ad.longitude - v.longitude) / 2), 2))))
                         from public.partner_addresses ad where ad.partner_id = v.partner_id and ad.deleted_at is null and ad.latitude is not null
                          and v.latitude is not null order by ad.is_default desc, ad.created_at limit 1))
        order by v.visited_at)
        from public.agent_visits v join public.business_partners bp on bp.id = v.partner_id
       where v.company_id = p_company and app.agent_local_date(p_company, v.visited_at) = v_day), '[]'::jsonb));
end $$;

-- is the caller an agent here (for the menu)
create or replace function public.am_i_agent(p_company uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (app.my_agent(p_company)).id is not null
$$;

revoke execute on function public.agents_list(uuid), public.agent_save(jsonb), public.agent_route_save(uuid, int, uuid[]),
  public.agent_bootstrap(uuid), public.agent_my_day(uuid), public.agent_visit_log(jsonb), public.agent_order_submit(jsonb),
  public.agent_payment_submit(jsonb), public.agents_day(uuid, date), public.am_i_agent(uuid) from public, anon;
grant execute on function public.agents_list(uuid), public.agent_save(jsonb), public.agent_route_save(uuid, int, uuid[]),
  public.agent_bootstrap(uuid), public.agent_my_day(uuid), public.agent_visit_log(jsonb), public.agent_order_submit(jsonb),
  public.agent_payment_submit(jsonb), public.agents_day(uuid, date), public.am_i_agent(uuid) to authenticated;

drop function app._patch_function(text, text, text);
