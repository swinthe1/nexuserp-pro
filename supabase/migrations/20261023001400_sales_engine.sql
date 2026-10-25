-- =============================================================================
-- DrisPRO · 1400 · Phase 3 — CRM & Sales engine
--
-- Leads → Opportunities → Quotes → Sales orders → Deliveries → Invoices
--
-- * Pricing precedence (public.get_price):
--     1. customer-specific price (partner_prices), best matching quantity break
--     2. price list: explicit, else the customer's, else the default sales list
--     3. product / variant base price
--   Discount: the matched rule's discount, else the customer's default discount.
-- * Confirming an order validates it (lines, sellable products, discount cap,
--   credit limit) and then RESERVES stock (FEFO, partial reservations allowed;
--   the shortfall is a backorder). Cancelling/closing releases reservations.
-- * Posting a delivery consumes the reservation, moves stock to the customer
--   location at weighted average cost (= COGS) and advances the order.
-- * Posting an invoice updates invoiced quantities, closes fully delivered and
--   invoiced orders, and queues fiscalization (AL/XK) when enabled.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Schema additions
-- -----------------------------------------------------------------------------
alter table public.business_partners
  add column default_discount_pct numeric(5,2) not null default 0 check (default_discount_pct between 0 and 100);

alter table public.company_settings
  add column max_discount_pct     numeric(5,2) not null default 15 check (max_discount_pct between 0 and 100),
  add column credit_check_enabled boolean not null default true;

-- Customer-specific prices (highest pricing priority)
create table public.partner_prices (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null,
  partner_id   uuid not null,
  variant_id   uuid not null,
  price        numeric(18,4) check (price >= 0),      -- null = keep list/base price, apply discount only
  discount_pct numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  min_quantity numeric(18,4) not null default 1 check (min_quantity > 0),
  valid_from   date,
  valid_to     date,
  notes        text,
  foreign key (company_id, partner_id) references public.business_partners(company_id, id),
  foreign key (company_id, variant_id) references public.product_variants(company_id, id),
  check (price is not null or discount_pct > 0),
  check (valid_to is null or valid_from is null or valid_to >= valid_from)
);
select app.register_table('public.partner_prices', 'sales');
create unique index partner_prices_key on public.partner_prices (partner_id, variant_id, min_quantity) where deleted_at is null;

insert into public.document_types (key, name, module, table_name, default_prefix) values
  ('customer_code', 'Customer code', 'partners', null, 'C'),
  ('vendor_code',   'Vendor code',   'partners', null, 'V')
on conflict (key) do nothing;

insert into app.document_children values
  ('deliveries',     'delivery_lines',      'delivery_id'),
  ('sales_invoices', 'sales_invoice_lines', 'invoice_id'),
  ('price_lists',    'price_list_items',    'price_list_id')
on conflict do nothing;

-- The opportunity status follows its pipeline stage, so the status flow must
-- be validated on every update (not only when 'status' is in the SET list).
drop trigger trg_11_status_flow on public.opportunities;
create trigger trg_11_status_flow before insert or update on public.opportunities
  for each row execute function app.tg_status_flow('opportunity');

-- People columns also reference profiles so the API can embed names
alter table public.leads             add constraint leads_owner_profile_fkey             foreign key (owner_id)       references public.profiles(id);
alter table public.opportunities     add constraint opportunities_owner_profile_fkey     foreign key (owner_id)       references public.profiles(id);
alter table public.sales_quotes      add constraint sales_quotes_salesperson_profile_fkey foreign key (salesperson_id) references public.profiles(id);
alter table public.sales_orders      add constraint sales_orders_salesperson_profile_fkey foreign key (salesperson_id) references public.profiles(id);
alter table public.sales_invoices    add constraint sales_invoices_salesperson_profile_fkey foreign key (salesperson_id) references public.profiles(id);
alter table public.business_partners add constraint business_partners_salesperson_profile_fkey foreign key (salesperson_id) references public.profiles(id);

-- -----------------------------------------------------------------------------
-- Partner codes (C00001 / V00001)
-- -----------------------------------------------------------------------------
create or replace function public.next_partner_code(p_company uuid, p_kind text default 'customer')
returns text language plpgsql security definer set search_path = '' as $$
declare v_type text := case when p_kind = 'vendor' then 'vendor_code' else 'customer_code' end; v_code text;
begin
  perform app.require_permission(p_company, 'partners.write');
  insert into public.document_sequences (company_id, doc_type, prefix, include_year, padding, reset_policy)
  values (p_company, v_type, case when p_kind = 'vendor' then 'V' else 'C' end, false, 5, 'never')
  on conflict (company_id, doc_type) do nothing;
  loop
    v_code := app.next_document_number(p_company, v_type);
    exit when not exists (select 1 from public.business_partners where company_id = p_company and code = v_code and deleted_at is null);
  end loop;
  return v_code;
end $$;

-- =============================================================================
-- Pricing
-- =============================================================================
create or replace function public.get_price(
  p_company    uuid,
  p_partner    uuid,
  p_variant    uuid,
  p_quantity   numeric default 1,
  p_date       date    default current_date,
  p_price_list uuid    default null,
  p_currency   text    default null)
returns table (unit_price numeric, discount_pct numeric, source text, price_list_id uuid, tax_code_id uuid)
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_base numeric; v_tax uuid; v_tax_rate numeric; v_partner_disc numeric := 0; v_partner_list uuid;
  v_list public.price_lists; v_item record; v_cp record; v_cur text; v_base_cur text;
  v_price numeric; v_disc numeric; v_src text; v_pl uuid;
begin
  select coalesce(v.sales_price_override, p.sales_price), p.sales_tax_code_id, coalesce(t.rate, 0)
    into v_base, v_tax, v_tax_rate
    from public.product_variants v join public.products p on p.id = v.product_id
    left join public.tax_codes t on t.id = p.sales_tax_code_id
   where v.id = p_variant and v.company_id = p_company;
  if v_base is null then return; end if;
  select base_currency into v_base_cur from public.companies where id = p_company;
  v_cur := coalesce(p_currency, v_base_cur);

  if p_partner is not null then
    select bp.default_discount_pct, bp.price_list_id into v_partner_disc, v_partner_list
      from public.business_partners bp where bp.id = p_partner and bp.company_id = p_company;
  end if;

  -- 1. customer-specific price
  if p_partner is not null then
    select pp.price, pp.discount_pct into v_cp
      from public.partner_prices pp
     where pp.partner_id = p_partner and pp.variant_id = p_variant and pp.deleted_at is null
       and pp.min_quantity <= p_quantity
       and (pp.valid_from is null or pp.valid_from <= p_date) and (pp.valid_to is null or pp.valid_to >= p_date)
     order by pp.min_quantity desc limit 1;
    if found then
      v_price := coalesce(v_cp.price, v_base);
      v_disc  := case when v_cp.discount_pct > 0 then v_cp.discount_pct else v_partner_disc end;
      v_src   := 'customer_price';
    end if;
  end if;

  -- 2. price list
  if v_src is null then
    select * into v_list from public.price_lists pl
     where pl.company_id = p_company and pl.deleted_at is null and pl.is_active and pl.list_type = 'sales'
       and (pl.valid_from is null or pl.valid_from <= p_date) and (pl.valid_to is null or pl.valid_to >= p_date)
       and pl.id = coalesce(p_price_list, v_partner_list,
                            (select d.id from public.price_lists d where d.company_id = p_company and d.is_default
                               and d.list_type = 'sales' and d.deleted_at is null and d.is_active limit 1));
    if v_list.id is not null then
      select i.price, i.discount_pct into v_item
        from public.price_list_items i
       where i.price_list_id = v_list.id and i.variant_id = p_variant and i.deleted_at is null
         and i.min_quantity <= p_quantity
         and (i.valid_from is null or i.valid_from <= p_date) and (i.valid_to is null or i.valid_to >= p_date)
       order by i.min_quantity desc limit 1;
      if found then
        v_price := v_item.price;
        if v_list.prices_include_tax then v_price := round(v_price / (1 + v_tax_rate / 100), 4); end if;
        -- list prices are in the list's currency; convert through the base currency
        if v_list.currency_code <> v_cur then
          v_price := round(v_price * coalesce(app.exchange_rate(p_company, v_list.currency_code, p_date), 1)
                           / coalesce(app.exchange_rate(p_company, v_cur, p_date), 1), 4);
        end if;
        v_disc := case when v_item.discount_pct > 0 then v_item.discount_pct else v_partner_disc end;
        v_src  := 'price_list';
        v_pl   := v_list.id;
      end if;
    end if;
  end if;

  -- 3. base price (in base currency)
  if v_src is null then
    v_price := v_base;
    if v_cur <> v_base_cur then
      v_price := round(v_price / coalesce(app.exchange_rate(p_company, v_cur, p_date), 1), 4);
    end if;
    v_disc := v_partner_disc;
    v_src  := 'base_price';
  end if;

  return query select v_price, v_disc, v_src, v_pl, v_tax;
end $$;

-- =============================================================================
-- CRM: leads and pipeline
-- =============================================================================
create or replace function public.convert_lead(
  p_lead uuid, p_partner uuid default null, p_opportunity_name text default null,
  p_expected_value numeric default null, p_stage uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.leads; v_partner uuid := p_partner; v_stage uuid := p_stage; v_opp uuid; v_cur text;
begin
  select * into l from public.leads where id = p_lead for update;
  if l.id is null then raise exception 'Lead not found' using errcode = 'P0002'; end if;
  perform app.require_permission(l.company_id, 'crm.write');
  if l.status not in ('new','contacted','qualified') then
    raise exception 'Only open leads can be converted (this one is %)', l.status using errcode = '55000';
  end if;

  if v_partner is null then
    perform app.require_permission(l.company_id, 'partners.write');
    insert into public.business_partners (company_id, code, name, kind, is_customer, email, phone, salesperson_id, notes)
    values (l.company_id, public.next_partner_code(l.company_id, 'customer'),
            coalesce(nullif(l.company_name, ''), l.contact_name, l.title),
            case when coalesce(l.company_name, '') = '' then 'individual' else 'company' end,
            true, l.email, l.phone, l.owner_id, l.notes)
    returning id into v_partner;
    if nullif(l.contact_name, '') is not null and nullif(l.company_name, '') is not null then
      insert into public.partner_contacts (company_id, partner_id, name, email, phone, is_primary)
      values (l.company_id, v_partner, l.contact_name, l.email, l.phone, true);
    end if;
  end if;

  if v_stage is null then
    select id into v_stage from public.crm_pipeline_stages
     where company_id = l.company_id and deleted_at is null and not is_won and not is_lost order by sort_order limit 1;
  end if;
  select coalesce(l.currency_code, base_currency) into v_cur from public.companies where id = l.company_id;

  insert into public.opportunities (company_id, name, partner_id, lead_id, stage_id, owner_id, expected_value, currency_code)
  values (l.company_id, coalesce(p_opportunity_name, l.title), v_partner, l.id, v_stage, coalesce(l.owner_id, auth.uid()),
          coalesce(p_expected_value, l.estimated_value, 0), v_cur)
  returning id into v_opp;

  if l.status <> 'qualified' then update public.leads set status = 'qualified' where id = l.id; end if;
  update public.leads set status = 'converted', partner_id = v_partner where id = l.id;
  return jsonb_build_object('partner_id', v_partner, 'opportunity_id', v_opp);
end $$;

-- Stage drives status & probability
create or replace function app.tg_opportunity_stage()
returns trigger language plpgsql security definer set search_path = '' as $$
declare s public.crm_pipeline_stages;
begin
  if tg_op = 'UPDATE' and new.stage_id is not distinct from old.stage_id then return new; end if;
  select * into s from public.crm_pipeline_stages where id = new.stage_id;
  new.probability := s.probability;
  if s.is_won then
    new.status := 'won';  new.closed_at := coalesce(new.closed_at, now());
  elsif s.is_lost then
    new.status := 'lost'; new.closed_at := coalesce(new.closed_at, now());
  else
    new.status := 'open'; new.closed_at := null;
  end if;
  return new;
end $$;
create trigger trg_08_stage before insert or update on public.opportunities
  for each row execute function app.tg_opportunity_stage();

-- =============================================================================
-- Quotes → orders
-- =============================================================================
create or replace function public.convert_quote_to_order(p_quote uuid, p_warehouse uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare q public.sales_quotes; v_so uuid; v_wh uuid; v_won uuid;
begin
  select * into q from public.sales_quotes where id = p_quote for update;
  if q.id is null then raise exception 'Quote not found' using errcode = 'P0002'; end if;
  perform app.require_permission(q.company_id, 'sales.write');
  if q.status not in ('sent','accepted') then
    raise exception 'Only sent or accepted quotes can become orders (this one is %)', q.status using errcode = '55000';
  end if;
  if q.valid_until is not null and q.valid_until < current_date and q.status = 'sent' then
    raise exception 'This quote expired on %; update it and send it again', q.valid_until using errcode = '55000';
  end if;
  if not exists (select 1 from public.sales_quote_lines where quote_id = q.id) then
    raise exception 'The quote has no lines' using errcode = '23514';
  end if;

  v_wh := coalesce(p_warehouse, (select default_warehouse_id from public.company_settings where company_id = q.company_id),
                   (select id from public.warehouses where company_id = q.company_id and deleted_at is null and is_active order by code limit 1));

  insert into public.sales_orders (company_id, partner_id, quote_id, order_date, warehouse_id, currency_code, exchange_rate,
                                   price_list_id, payment_term_id, salesperson_id, billing_address_id, shipping_address_id, notes)
  values (q.company_id, q.partner_id, q.id, current_date, v_wh, q.currency_code, q.exchange_rate, q.price_list_id,
          q.payment_term_id, q.salesperson_id, q.billing_address_id, q.shipping_address_id, q.notes)
  returning id into v_so;

  insert into public.sales_order_lines (company_id, sales_order_id, line_no, variant_id, description, quantity, uom_id,
                                        unit_price, discount_pct, tax_code_id)
  select company_id, v_so, line_no, variant_id, description, quantity, uom_id, unit_price, discount_pct, tax_code_id
    from public.sales_quote_lines where quote_id = q.id order by line_no;

  if q.status = 'sent' then update public.sales_quotes set status = 'accepted' where id = q.id; end if;
  update public.sales_quotes set status = 'converted' where id = q.id;

  -- winning the quote wins the opportunity
  if q.opportunity_id is not null then
    select id into v_won from public.crm_pipeline_stages where company_id = q.company_id and is_won and deleted_at is null limit 1;
    update public.opportunities set stage_id = v_won where id = q.opportunity_id and status = 'open' and v_won is not null;
  end if;
  return v_so;
end $$;

-- =============================================================================
-- Sales order confirmation: validation + reservations
-- =============================================================================

-- Customer exposure = open receivables + confirmed-but-not-invoiced orders (base currency)
create or replace function app.customer_exposure(p_partner uuid, p_exclude_order uuid default null)
returns numeric language sql stable set search_path = '' as $$
  select coalesce((select sum(case when i.document_type = 'credit_note' then -1 else 1 end * round(i.amount_due * i.exchange_rate, 2))
                     from public.sales_invoices i
                    where i.partner_id = p_partner and i.status = 'posted' and i.payment_status <> 'paid' and i.deleted_at is null), 0)
       + coalesce((select sum(round(l.line_total * (l.quantity - l.qty_invoiced) / l.quantity * o.exchange_rate, 2))
                     from public.sales_orders o join public.sales_order_lines l on l.sales_order_id = o.id
                    where o.partner_id = p_partner and o.status in ('confirmed','partially_delivered','delivered')
                      and o.deleted_at is null and o.id is distinct from p_exclude_order), 0)
$$;

create or replace function app.tg_sales_order_confirm()
returns trigger language plpgsql security definer set search_path = '' as $$
declare s public.company_settings; p public.business_partners; v_bad text; v_max numeric; v_exposure numeric;
begin
  if not (new.status = 'confirmed' and old.status in ('draft','pending_approval')) then return new; end if;
  select * into s from public.company_settings where company_id = new.company_id;
  select * into p from public.business_partners where id = new.partner_id;

  if not exists (select 1 from public.sales_order_lines where sales_order_id = new.id) then
    raise exception 'Add at least one line before confirming' using errcode = '23514';
  end if;
  if not p.is_customer or not p.is_active then
    raise exception '% is not an active customer', p.name using errcode = '23514';
  end if;

  select string_agg(v.sku, ', ') into v_bad
    from public.sales_order_lines l join public.product_variants v on v.id = l.variant_id join public.products pr on pr.id = v.product_id
   where l.sales_order_id = new.id and (not pr.is_sellable or not pr.is_active or not v.is_active or v.deleted_at is not null);
  if v_bad is not null then raise exception 'Not for sale: %', v_bad using errcode = '23514'; end if;

  select max(discount_pct) into v_max from public.sales_order_lines where sales_order_id = new.id;
  if v_max > s.max_discount_pct and auth.uid() is not null and not app.has_permission(new.company_id, 'sales.approve') then
    raise exception 'A % %% discount exceeds the % %% limit; a sales manager must confirm this order',
      trim_scale(v_max), trim_scale(s.max_discount_pct) using errcode = '42501';
  end if;

  if s.credit_check_enabled and p.credit_limit is not null then
    -- generated columns (total_base) are not yet computed inside BEFORE triggers
    v_exposure := coalesce(app.customer_exposure(p.id, new.id), 0) + round(new.total * new.exchange_rate, 2);
    if v_exposure > p.credit_limit and auth.uid() is not null and not app.has_permission(new.company_id, 'sales.approve') then
      raise exception 'Credit limit exceeded for %: exposure would be % against a limit of %',
        p.name, to_char(v_exposure, 'FM999G999G990D00'), to_char(p.credit_limit, 'FM999G999G990D00') using errcode = '23514';
    end if;
  end if;

  new.confirmed_at := now();
  return new;
end $$;
create trigger trg_12_confirm before update of status on public.sales_orders
  for each row execute function app.tg_sales_order_confirm();

-- Reserve what is available for each stockable line (rest stays backordered)
create or replace function app.reserve_sales_order(p_order uuid)
returns numeric language plpgsql set search_path = '' as $$
declare o public.sales_orders; l record; v_need numeric; v_got numeric; v_total numeric := 0;
begin
  select * into o from public.sales_orders where id = p_order;
  for l in
    select sl.* from public.sales_order_lines sl
      join public.product_variants v on v.id = sl.variant_id join public.products p on p.id = v.product_id
     where sl.sales_order_id = p_order and p.product_type = 'stockable'
     order by sl.line_no
  loop
    v_need := l.quantity - l.qty_delivered - l.qty_reserved;
    continue when v_need <= 0;
    v_got := app.reserve_stock(o.company_id, l.variant_id, o.warehouse_id, v_need, 'sales_order', o.id, l.id, true);
    if v_got > 0 then
      update public.sales_order_lines set qty_reserved = qty_reserved + v_got where id = l.id;
      v_total := v_total + v_got;
    end if;
  end loop;
  return v_total;
end $$;

create or replace function app.tg_sales_order_after_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'confirmed' and old.status in ('draft','pending_approval') then
    perform app.reserve_sales_order(new.id);
  elsif new.status in ('cancelled','closed') and old.status not in ('cancelled','closed') then
    perform app.release_reservations('sales_order', new.id);
    update public.sales_order_lines set qty_reserved = 0 where sales_order_id = new.id and qty_reserved <> 0;
  end if;
  return null;
end $$;
create trigger trg_91_after_status after update of status on public.sales_orders
  for each row execute function app.tg_sales_order_after_status();

create or replace function public.confirm_sales_order(p_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare o public.sales_orders;
begin
  select * into o from public.sales_orders where id = p_id for update;
  if o.id is null then raise exception 'Order not found' using errcode = 'P0002'; end if;
  perform app.require_permission(o.company_id, 'sales.write');
  if o.status <> 'draft' then raise exception 'Only draft orders can be confirmed (this one is %)', o.status using errcode = '55000'; end if;
  perform public.submit_for_approval('sales_order', p_id);
  return (select status from public.sales_orders where id = p_id);
end $$;

-- Retry reservations for backordered quantities (e.g. after new stock arrived)
create or replace function public.reserve_sales_order(p_id uuid)
returns numeric language plpgsql security definer set search_path = '' as $$
declare o public.sales_orders;
begin
  select * into o from public.sales_orders where id = p_id for update;
  if o.id is null then raise exception 'Order not found' using errcode = 'P0002'; end if;
  perform app.require_permission(o.company_id, 'sales.write');
  if o.status not in ('confirmed','partially_delivered') then
    raise exception 'Only open confirmed orders can reserve stock' using errcode = '55000';
  end if;
  return app.reserve_sales_order(p_id);
end $$;

-- Per-line availability for the order screen
create or replace function public.sales_order_availability(p_id uuid)
returns table (line_id uuid, variant_id uuid, sku text, ordered numeric, delivered numeric, reserved numeric,
               to_reserve numeric, available numeric, incoming numeric, is_stockable boolean)
language sql stable security invoker set search_path = '' as $$
  select l.id, l.variant_id, v.sku, l.quantity, l.qty_delivered, l.qty_reserved,
         greatest(l.quantity - l.qty_delivered - l.qty_reserved, 0),
         coalesce((select sum(sl.available) from public.stock_levels sl where sl.variant_id = l.variant_id and sl.warehouse_id = o.warehouse_id), 0),
         coalesce((select sum(i.incoming_qty) from public.v_incoming_stock i where i.variant_id = l.variant_id and i.warehouse_id = o.warehouse_id), 0),
         coalesce(p.product_type = 'stockable', false)
    from public.sales_orders o
    join public.sales_order_lines l on l.sales_order_id = o.id
    left join public.product_variants v on v.id = l.variant_id
    left join public.products p on p.id = v.product_id
   where o.id = p_id
   order by l.line_no
$$;

-- =============================================================================
-- Deliveries
-- =============================================================================
create or replace function public.create_delivery_from_order(p_order uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  o public.sales_orders; l record; r record; v_del uuid; v_left numeric; v_take numeric; v_lines int := 0;
begin
  select * into o from public.sales_orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found' using errcode = 'P0002'; end if;
  if not (app.has_permission(o.company_id, 'wms.write') or app.has_permission(o.company_id, 'sales.write')) then
    raise exception 'Permission denied: wms.write or sales.write required' using errcode = '42501';
  end if;
  if o.status not in ('confirmed','partially_delivered') then
    raise exception 'Confirm the order before delivering it (it is %)', o.status using errcode = '55000';
  end if;

  insert into public.deliveries (company_id, sales_order_id, partner_id, warehouse_id, shipping_address_id, scheduled_date)
  values (o.company_id, o.id, o.partner_id, o.warehouse_id, o.shipping_address_id, coalesce(o.requested_date, current_date))
  returning id into v_del;

  for l in
    select sl.*, v.id as vid from public.sales_order_lines sl
      join public.product_variants v on v.id = sl.variant_id join public.products p on p.id = v.product_id
     where sl.sales_order_id = o.id and p.product_type = 'stockable'
     order by sl.line_no
  loop
    -- what is still to deliver, minus what is already on other open deliveries
    v_left := l.quantity - l.qty_delivered - coalesce((
      select sum(dl.quantity) from public.delivery_lines dl join public.deliveries d on d.id = dl.delivery_id
       where dl.sales_order_line_id = l.id and d.status in ('draft','ready') and d.deleted_at is null and d.id <> v_del), 0);
    continue when v_left <= 0;
    -- pick from the reserved bins/lots first
    for r in select location_id, lot_id, sum(quantity) as qty from public.stock_reservations
              where source_doc_type = 'sales_order' and source_line_id = l.id and status = 'active'
              group by location_id, lot_id order by sum(quantity) desc loop
      exit when v_left <= 0;
      v_take := least(v_left, r.qty);
      insert into public.delivery_lines (company_id, delivery_id, sales_order_line_id, variant_id, lot_id, location_id, quantity)
      values (o.company_id, v_del, l.id, l.variant_id, r.lot_id, r.location_id, v_take);
      v_left := v_left - v_take; v_lines := v_lines + 1;
    end loop;
    -- then any free (unreserved) stock that arrived since; never more than is on the shelf
    for r in select sl.location_id, sl.lot_id, sl.available from public.stock_levels sl
               join public.warehouse_locations wl on wl.id = sl.location_id
               left join public.lots lt on lt.id = sl.lot_id
              where sl.variant_id = l.variant_id and sl.warehouse_id = o.warehouse_id and sl.available > 0 and wl.is_pickable
              order by lt.expiry_date nulls last, wl.code loop
      exit when v_left <= 0;
      v_take := least(v_left, r.available);
      insert into public.delivery_lines (company_id, delivery_id, sales_order_line_id, variant_id, lot_id, location_id, quantity)
      values (o.company_id, v_del, l.id, l.variant_id, r.lot_id, r.location_id, v_take);
      v_left := v_left - v_take; v_lines := v_lines + 1;
    end loop;
  end loop;

  if v_lines = 0 then
    raise exception 'Nothing can be delivered on % right now: no reserved or free stock for the open quantities', o.number using errcode = '23514';
  end if;
  return v_del;
end $$;

-- Use up the order's reservation for a shipped quantity (preferring the same bin/lot)
create or replace function app.consume_reservation(p_order uuid, p_line uuid, p_location uuid, p_lot uuid, p_qty numeric)
returns void language plpgsql set search_path = '' as $$
declare r record; v_left numeric := p_qty; v_take numeric;
begin
  for r in select * from public.stock_reservations
            where source_doc_type = 'sales_order' and source_doc_id = p_order and source_line_id = p_line and status = 'active'
            order by (location_id = p_location and lot_id is not distinct from p_lot) desc, created_at
            for update loop
    exit when v_left <= 0;
    v_take := least(v_left, r.quantity);
    update public.stock_levels set reserved = greatest(reserved - v_take, 0)
     where company_id = r.company_id and variant_id = r.variant_id and location_id = r.location_id and lot_id is not distinct from r.lot_id;
    if v_take = r.quantity then
      update public.stock_reservations set status = 'consumed' where id = r.id;
    else
      update public.stock_reservations set quantity = quantity - v_take where id = r.id;
    end if;
    v_left := v_left - v_take;
  end loop;
  update public.sales_order_lines set qty_reserved = greatest(qty_reserved - (p_qty - v_left), 0) where id = p_line;
end $$;

create or replace function app.refresh_order_delivery_status(p_order uuid)
returns void language plpgsql set search_path = '' as $$
declare v_open int; v_any int; v_status text;
begin
  select count(*) filter (where l.qty_delivered < l.quantity), count(*) filter (where l.qty_delivered > 0)
    into v_open, v_any
    from public.sales_order_lines l
    join public.product_variants v on v.id = l.variant_id join public.products p on p.id = v.product_id
   where l.sales_order_id = p_order and p.product_type = 'stockable';
  select status into v_status from public.sales_orders where id = p_order;
  if v_status not in ('confirmed','partially_delivered') then return; end if;
  if v_open = 0 then
    update public.sales_orders set status = 'delivered' where id = p_order;
  elsif v_any > 0 and v_status = 'confirmed' then
    update public.sales_orders set status = 'partially_delivered' where id = p_order;
  end if;
end $$;

create or replace function public.post_delivery(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  d public.deliveries; o public.sales_orders; l record; v_customer uuid; v_mv uuid; v_cost numeric; v_total numeric := 0; v_lines int := 0;
  v_at timestamptz;
begin
  select * into d from public.deliveries where id = p_id for update;
  if d.id is null then raise exception 'Delivery not found' using errcode = 'P0002'; end if;
  perform app.require_permission(d.company_id, 'wms.write');
  if d.status not in ('draft','ready') then raise exception 'Delivery is already %', d.status using errcode = '55000'; end if;
  if d.sales_order_id is not null then
    select * into o from public.sales_orders where id = d.sales_order_id for update;
    if o.status not in ('confirmed','partially_delivered') then
      raise exception 'Order % is %; it cannot be delivered', o.number, o.status using errcode = '55000';
    end if;
  end if;
  v_customer := app.virtual_location(d.company_id, 'customer');
  v_at := now();

  for l in
    select dl.*, loc.warehouse_id as loc_wh, loc.code as loc_code, sl.quantity as so_qty, sl.qty_delivered as so_delivered, sl.sales_order_id as so_id
      from public.delivery_lines dl
      join public.warehouse_locations loc on loc.id = dl.location_id
      left join public.sales_order_lines sl on sl.id = dl.sales_order_line_id
     where dl.delivery_id = d.id order by dl.created_at, dl.id
  loop
    v_lines := v_lines + 1;
    if l.loc_wh is distinct from d.warehouse_id then
      raise exception 'Location % is not in the shipping warehouse', l.loc_code using errcode = '23514';
    end if;
    if l.sales_order_line_id is not null then
      if l.so_id is distinct from d.sales_order_id then raise exception 'A line belongs to a different order' using errcode = '23514'; end if;
      -- re-read: several delivery lines can share one order line
      if (select qty_delivered from public.sales_order_lines where id = l.sales_order_line_id) + l.quantity > l.so_qty then
        raise exception 'Over-delivery: % ordered, % already delivered', trim_scale(l.so_qty),
          trim_scale((select qty_delivered from public.sales_order_lines where id = l.sales_order_line_id)) using errcode = '23514';
      end if;
      perform app.consume_reservation(d.sales_order_id, l.sales_order_line_id, l.location_id, l.lot_id, l.quantity);
    end if;
    v_mv := app.post_stock_move(d.company_id, 'delivery', l.variant_id, l.location_id, v_customer, l.quantity, null, l.lot_id,
                                'delivery', d.id, l.id, d.number, v_at);
    select m.unit_cost into v_cost from public.stock_movements m where m.id = v_mv;
    update public.delivery_lines set unit_cost = v_cost where id = l.id;
    if l.sales_order_line_id is not null then
      update public.sales_order_lines set qty_delivered = qty_delivered + l.quantity where id = l.sales_order_line_id;
    end if;
  end loop;
  if v_lines = 0 then raise exception 'Add at least one line' using errcode = '23514'; end if;

  if d.status = 'draft' then update public.deliveries set status = 'ready' where id = d.id; end if;
  update public.deliveries
     set status = 'done', done_at = now(),
         total_cost = (select coalesce(sum(round(quantity * unit_cost, 2)), 0) from public.delivery_lines where delivery_id = d.id)
   where id = d.id;
  if d.sales_order_id is not null then perform app.refresh_order_delivery_status(d.sales_order_id); end if;

  return jsonb_build_object('status', 'done', 'lines', v_lines,
                            'cost', (select total_cost from public.deliveries where id = d.id));
end $$;

-- =============================================================================
-- Invoices & credit notes
-- =============================================================================
create or replace function public.create_invoice_from_order(p_order uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare o public.sales_orders; v_inv uuid; v_days int; v_lines int;
begin
  select * into o from public.sales_orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found' using errcode = 'P0002'; end if;
  perform app.require_permission(o.company_id, 'invoicing.write');
  if o.status not in ('confirmed','partially_delivered','delivered') then
    raise exception 'Order % is %; only confirmed orders can be invoiced', o.number, o.status using errcode = '55000';
  end if;
  select coalesce(due_days, 0) into v_days from public.payment_terms where id = o.payment_term_id;

  insert into public.sales_invoices (company_id, partner_id, sales_order_id, source, invoice_date, due_date, currency_code,
                                     exchange_rate, payment_term_id, salesperson_id, billing_address_id, notes)
  values (o.company_id, o.partner_id, o.id, 'sales_order', current_date, current_date + coalesce(v_days, 0), o.currency_code,
          o.exchange_rate, o.payment_term_id, o.salesperson_id, o.billing_address_id, o.notes)
  returning id into v_inv;

  -- goods: invoice what has been delivered; services: what was ordered. Minus earlier and draft invoices.
  insert into public.sales_invoice_lines (company_id, invoice_id, line_no, sales_order_line_id, variant_id, description, quantity,
                                          uom_id, unit_price, discount_pct, tax_code_id)
  select x.company_id, v_inv, x.line_no, x.id, x.variant_id, x.description, x.to_invoice, x.uom_id, x.unit_price, x.discount_pct, x.tax_code_id
    from (
      select sl.*,
             (case when coalesce(p.product_type, 'service') = 'stockable' then sl.qty_delivered else sl.quantity end)
             - sl.qty_invoiced
             - coalesce((select sum(il.quantity) from public.sales_invoice_lines il join public.sales_invoices i on i.id = il.invoice_id
                          where il.sales_order_line_id = sl.id and i.status = 'draft' and i.deleted_at is null and i.id <> v_inv), 0) as to_invoice
        from public.sales_order_lines sl
        left join public.product_variants v on v.id = sl.variant_id left join public.products p on p.id = v.product_id
       where sl.sales_order_id = o.id) x
   where x.to_invoice > 0
   order by x.line_no;
  get diagnostics v_lines = row_count;
  if v_lines = 0 then
    raise exception 'Nothing to invoice on %: deliver the goods first', o.number using errcode = '23514';
  end if;
  return v_inv;
end $$;

create or replace function public.create_credit_note(p_invoice uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare i public.sales_invoices; v_cn uuid;
begin
  select * into i from public.sales_invoices where id = p_invoice;
  if i.id is null then raise exception 'Invoice not found' using errcode = 'P0002'; end if;
  perform app.require_permission(i.company_id, 'invoicing.write');
  if i.status <> 'posted' or i.document_type <> 'sales_invoice' then
    raise exception 'Credit notes can only be issued against posted invoices' using errcode = '55000';
  end if;
  insert into public.sales_invoices (company_id, document_type, partner_id, sales_order_id, original_invoice_id, source, invoice_date, due_date,
                                     currency_code, exchange_rate, payment_term_id, salesperson_id, billing_address_id, notes)
  values (i.company_id, 'credit_note', i.partner_id, i.sales_order_id, i.id, 'manual', current_date, current_date, i.currency_code,
          i.exchange_rate, i.payment_term_id, i.salesperson_id, i.billing_address_id, 'Credit note for ' || i.number)
  returning id into v_cn;
  insert into public.sales_invoice_lines (company_id, invoice_id, line_no, sales_order_line_id, variant_id, description, account_id,
                                          cost_center_id, quantity, uom_id, unit_price, discount_pct, tax_code_id)
  select company_id, v_cn, line_no, sales_order_line_id, variant_id, description, account_id, cost_center_id, quantity, uom_id,
         unit_price, discount_pct, tax_code_id
    from public.sales_invoice_lines where invoice_id = i.id order by line_no;
  return v_cn;
end $$;

create or replace function public.post_sales_invoice(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  i public.sales_invoices; s public.company_settings; c public.companies; l record; v_sign int; v_period text; v_credited numeric;
  v_order uuid;
begin
  select * into i from public.sales_invoices where id = p_id for update;
  if i.id is null then raise exception 'Invoice not found' using errcode = 'P0002'; end if;
  perform app.require_permission(i.company_id, 'invoicing.write');
  if i.status <> 'draft' then raise exception 'Invoice is already %', i.status using errcode = '55000'; end if;
  if not exists (select 1 from public.sales_invoice_lines where invoice_id = i.id) then
    raise exception 'Add at least one line' using errcode = '23514';
  end if;
  if i.total <= 0 then raise exception 'The total must be greater than zero' using errcode = '23514'; end if;

  select status into v_period from public.fiscal_periods
   where company_id = i.company_id and i.invoice_date between start_date and end_date;
  if v_period is null then raise exception 'No fiscal period covers %', i.invoice_date using errcode = '23514'; end if;
  if v_period <> 'open' then raise exception 'The fiscal period for % is %', i.invoice_date, v_period using errcode = '23514'; end if;

  v_sign := case when i.document_type = 'credit_note' then -1 else 1 end;
  if i.document_type = 'credit_note' then
    select coalesce(sum(total), 0) into v_credited from public.sales_invoices
     where original_invoice_id = i.original_invoice_id and document_type = 'credit_note' and status = 'posted';
    if v_credited + i.total > (select total from public.sales_invoices where id = i.original_invoice_id) then
      raise exception 'Credit notes would exceed the original invoice total' using errcode = '23514';
    end if;
  end if;

  for l in select il.*, sl.quantity as so_qty, sl.qty_invoiced as so_inv, sl.qty_delivered as so_del, sl.sales_order_id
             from public.sales_invoice_lines il left join public.sales_order_lines sl on sl.id = il.sales_order_line_id
            where il.invoice_id = i.id loop
    if l.sales_order_line_id is not null then
      if v_sign = 1 and (select qty_invoiced from public.sales_order_lines where id = l.sales_order_line_id) + l.quantity > l.so_qty then
        raise exception 'Line % invoices more than was ordered', l.line_no using errcode = '23514';
      end if;
      update public.sales_order_lines set qty_invoiced = greatest(qty_invoiced + v_sign * l.quantity, 0) where id = l.sales_order_line_id;
      v_order := l.sales_order_id;
    end if;
  end loop;

  select * into s from public.company_settings where company_id = i.company_id;
  select * into c from public.companies where id = i.company_id;
  update public.sales_invoices
     set status = 'posted', posted_at = now(),
         fiscal_status = case when s.fiscalization_enabled and c.country_code in ('AL','XK') then 'pending' else 'not_required' end
   where id = i.id;

  -- fiscalization placeholder: the Edge Function (phase 8) picks these up
  if s.fiscalization_enabled and c.country_code in ('AL','XK') then
    insert into public.fiscalization_records (company_id, country_code, source_doc_type, source_doc_id, status, business_unit_code, software_code)
    values (i.company_id, c.country_code, i.document_type, i.id, 'pending', s.fiscal_business_unit_code, s.fiscal_software_code);
  end if;

  v_order := coalesce(v_order, i.sales_order_id);
  if v_order is not null then
    perform app.refresh_order_delivery_status(v_order);   -- service-only orders count as delivered
    update public.sales_orders o
       set invoice_status = case
             when not exists (select 1 from public.sales_order_lines where sales_order_id = o.id and qty_invoiced > 0) then 'not_invoiced'
             when exists (select 1 from public.sales_order_lines where sales_order_id = o.id and qty_invoiced < quantity) then 'partially_invoiced'
             else 'invoiced' end
     where o.id = v_order;
    -- fully delivered and fully invoiced orders close themselves
    update public.sales_orders set status = 'closed'
     where id = v_order and status = 'delivered' and invoice_status = 'invoiced';
  end if;

  return jsonb_build_object('status', 'posted', 'total', i.total,
                            'fiscal_status', (select fiscal_status from public.sales_invoices where id = i.id));
end $$;

-- Due date follows the payment terms unless set explicitly
create or replace function app.tg_invoice_due_date()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.payment_term_id is not null and (tg_op = 'INSERT' and new.due_date = new.invoice_date
       or tg_op = 'UPDATE' and (new.payment_term_id is distinct from old.payment_term_id or new.invoice_date is distinct from old.invoice_date)) then
    new.due_date := new.invoice_date + coalesce((select due_days from public.payment_terms where id = new.payment_term_id), 0);
  end if;
  return new;
end $$;
create trigger trg_03_due_date before insert or update of payment_term_id, invoice_date on public.sales_invoices
  for each row execute function app.tg_invoice_due_date();

-- =============================================================================
-- Sales performance
-- =============================================================================
create or replace function public.sales_overview(p_company uuid, p_from date default date_trunc('month', current_date)::date, p_to date default current_date)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with inv as (
    select i.*, case when i.document_type = 'credit_note' then -1 else 1 end as sgn
      from public.sales_invoices i
     where i.company_id = p_company and i.status = 'posted' and i.deleted_at is null
  ),
  inv_range as (select * from inv where invoice_date between p_from and p_to),
  lines_range as (
    select il.*, ir.sgn, ir.exchange_rate, ir.partner_id, ir.salesperson_id
      from public.sales_invoice_lines il join inv_range ir on ir.id = il.invoice_id
  ),
  orders_range as (
    select * from public.sales_orders o
     where o.company_id = p_company and o.deleted_at is null and o.order_date between p_from and p_to
       and o.status not in ('draft','pending_approval','cancelled')
  ),
  quotes_range as (
    select * from public.sales_quotes q where q.company_id = p_company and q.deleted_at is null and q.quote_date between p_from and p_to and q.status <> 'draft'
  ),
  opps_closed as (
    select * from public.opportunities op where op.company_id = p_company and op.deleted_at is null and op.status in ('won','lost')
       and op.closed_at::date between p_from and p_to
  )
  select jsonb_build_object(
    'revenue', coalesce((select sum(sgn * round(subtotal * exchange_rate, 2)) from inv_range), 0),
    'invoice_count', (select count(*) from inv_range where sgn = 1),
    'cogs', coalesce((select sum(d.total_cost) from public.deliveries d where d.company_id = p_company and d.status = 'done'
                       and d.done_at::date between p_from and p_to), 0),
    'orders_count', (select count(*) from orders_range),
    'orders_value', coalesce((select sum(total_base - round(tax_total * exchange_rate, 2)) from orders_range), 0),
    'quotes_sent', (select count(*) from quotes_range),
    'quotes_converted', (select count(*) from quotes_range where status = 'converted'),
    'won', (select count(*) from opps_closed where status = 'won'),
    'lost', (select count(*) from opps_closed where status = 'lost'),
    'backlog', coalesce((select sum(round(l.line_subtotal * (l.quantity - l.qty_delivered) / l.quantity * o.exchange_rate, 2))
                           from public.sales_orders o join public.sales_order_lines l on l.sales_order_id = o.id
                          where o.company_id = p_company and o.status in ('confirmed','partially_delivered') and o.deleted_at is null), 0),
    'overdue_count', (select count(*) from inv where sgn = 1 and payment_status <> 'paid' and due_date < current_date),
    'overdue_amount', coalesce((select sum(round(amount_due * exchange_rate, 2)) from inv where sgn = 1 and payment_status <> 'paid' and due_date < current_date), 0),
    'pipeline', coalesce((select jsonb_agg(x order by x.sort_order) from (
        select s.name, s.sort_order, s.probability, count(op.id) as count,
               coalesce(sum(op.expected_value), 0) as value, coalesce(sum(op.weighted_value), 0) as weighted
          from public.crm_pipeline_stages s
          left join public.opportunities op on op.stage_id = s.id and op.status = 'open' and op.deleted_at is null
         where s.company_id = p_company and s.deleted_at is null and not s.is_won and not s.is_lost
         group by s.id) x), '[]'::jsonb),
    'revenue_by_month', coalesce((select jsonb_agg(x order by x.month) from (
        select to_char(m, 'YYYY-MM') as month,
               coalesce((select sum(sgn * round(subtotal * exchange_rate, 2)) from inv where date_trunc('month', invoice_date) = m), 0) as revenue
          from generate_series(date_trunc('month', p_to) - interval '11 months', date_trunc('month', p_to), interval '1 month') m) x), '[]'::jsonb),
    'top_customers', coalesce((select jsonb_agg(x order by x.revenue desc) from (
        select bp.id, bp.name, sum(lr.sgn * round(lr.line_subtotal * lr.exchange_rate, 2)) as revenue
          from lines_range lr join public.business_partners bp on bp.id = lr.partner_id
         group by bp.id order by 3 desc limit 6) x), '[]'::jsonb),
    'top_products', coalesce((select jsonb_agg(x order by x.revenue desc) from (
        select v.sku, v.name, sum(lr.sgn * lr.quantity) as quantity, sum(lr.sgn * round(lr.line_subtotal * lr.exchange_rate, 2)) as revenue
          from lines_range lr join public.product_variants v on v.id = lr.variant_id
         group by v.id order by 4 desc limit 6) x), '[]'::jsonb),
    'by_salesperson', coalesce((select jsonb_agg(x order by x.revenue desc) from (
        select coalesce(pr.full_name, 'Unassigned') as name,
               sum(lr.sgn * round(lr.line_subtotal * lr.exchange_rate, 2)) as revenue,
               count(distinct lr.invoice_id) as invoices
          from lines_range lr left join public.profiles pr on pr.id = lr.salesperson_id
         group by pr.full_name order by 2 desc limit 8) x), '[]'::jsonb)
  )
$$;

-- -----------------------------------------------------------------------------
-- ⌘K search now covers CRM and sales documents
-- -----------------------------------------------------------------------------
create or replace function public.global_search(p_company uuid, p_query text, p_limit int default 6)
returns table (kind text, id uuid, title text, subtitle text, href text)
language sql stable security invoker set search_path = '' as $$
  with q as (select '%' || replace(replace(btrim(p_query), '%', '\%'), '_', '\_') || '%' as pat)
  (select 'product', p.id, v.name, v.sku, '/inventory/products/' || p.id
     from public.product_variants v join public.products p on p.id = v.product_id, q
    where v.company_id = p_company and v.deleted_at is null and p.deleted_at is null
      and (v.name ilike q.pat or v.sku ilike q.pat
           or exists (select 1 from public.product_barcodes b where b.variant_id = v.id and b.barcode = btrim(p_query)))
    order by v.name limit p_limit)
  union all
  (select 'partner', bp.id, bp.name, concat_ws(' · ', bp.code, bp.tax_number), '/partners/' || bp.id
     from public.business_partners bp, q
    where bp.company_id = p_company and bp.deleted_at is null
      and (bp.name ilike q.pat or bp.code ilike q.pat or bp.tax_number ilike q.pat or bp.email ilike q.pat)
    order by bp.name limit p_limit)
  union all
  (select 'opportunity', o.id, o.name, 'Opportunity · ' || o.status, '/crm/pipeline?open=' || o.id
     from public.opportunities o, q
    where o.company_id = p_company and o.deleted_at is null and (o.name ilike q.pat or o.number ilike q.pat)
    order by o.created_at desc limit 4)
  union all
  (select 'lead', l.id, l.title, concat_ws(' · ', l.company_name, l.contact_name), '/crm/leads?open=' || l.id
     from public.leads l, q
    where l.company_id = p_company and l.deleted_at is null
      and (l.title ilike q.pat or l.company_name ilike q.pat or l.contact_name ilike q.pat or l.number ilike q.pat or l.email ilike q.pat)
    order by l.created_at desc limit 4)
  union all
  (select 'warehouse', w.id, w.name, w.code, '/inventory/warehouses'
     from public.warehouses w, q
    where w.company_id = p_company and w.deleted_at is null and (w.name ilike q.pat or w.code ilike q.pat)
    limit 3)
  union all
  (select d.kind, d.id, d.number, d.label, d.href from (
      select 'goods_receipt' as kind, g.id, g.number, 'Goods receipt · ' || g.status as label, '/inventory/receipts/' || g.id as href, g.company_id, g.deleted_at from public.goods_receipts g
      union all select 'stock_adjustment', a.id, a.number, 'Adjustment · ' || a.status, '/inventory/adjustments/' || a.id, a.company_id, a.deleted_at from public.stock_adjustments a
      union all select 'stock_transfer', t.id, t.number, 'Transfer · ' || t.status, '/inventory/transfers/' || t.id, t.company_id, t.deleted_at from public.stock_transfers t
      union all select 'landed_cost', l.id, l.number, 'Landed cost · ' || l.status, '/inventory/landed-costs/' || l.id, l.company_id, l.deleted_at from public.landed_costs l
      union all select 'purchase_order', o.id, o.number, 'Purchase order · ' || o.status, '/procurement/orders/' || o.id, o.company_id, o.deleted_at from public.purchase_orders o
      union all select 'sales_quote', sq.id, sq.number, 'Quote · ' || sq.status, '/sales/quotes/' || sq.id, sq.company_id, sq.deleted_at from public.sales_quotes sq
      union all select 'sales_order', s.id, s.number, 'Sales order · ' || s.status, '/sales/orders/' || s.id, s.company_id, s.deleted_at from public.sales_orders s
      union all select 'delivery', dl.id, dl.number, 'Delivery · ' || dl.status, '/sales/deliveries/' || dl.id, dl.company_id, dl.deleted_at from public.deliveries dl
      union all select 'sales_invoice', i.id, i.number, case when i.document_type = 'credit_note' then 'Credit note · ' else 'Invoice · ' end || i.status, '/sales/invoices/' || i.id, i.company_id, i.deleted_at from public.sales_invoices i
    ) d, q
    where d.company_id = p_company and d.deleted_at is null and d.number ilike q.pat
    order by d.number desc limit p_limit)
$$;

-- -----------------------------------------------------------------------------
-- Privileges & realtime
-- -----------------------------------------------------------------------------
revoke execute on function public.next_partner_code, public.get_price, public.convert_lead, public.convert_quote_to_order,
                           public.confirm_sales_order, public.reserve_sales_order, public.sales_order_availability,
                           public.create_delivery_from_order, public.post_delivery, public.create_invoice_from_order,
                           public.create_credit_note, public.post_sales_invoice, public.sales_overview from public, anon;
grant execute on function public.next_partner_code, public.get_price, public.convert_lead, public.convert_quote_to_order,
                          public.confirm_sales_order, public.reserve_sales_order, public.sales_order_availability,
                          public.create_delivery_from_order, public.post_delivery, public.create_invoice_from_order,
                          public.create_credit_note, public.post_sales_invoice, public.sales_overview to authenticated;
revoke execute on function app.reserve_sales_order, app.consume_reservation, app.refresh_order_delivery_status, app.customer_exposure from authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.opportunities, public.deliveries;
  end if;
end $$;
