-- =============================================================================
-- Price levelling, warehouses per user, advance invoices
--   * price_levels: a document that changes many selling prices at once, with
--     the stock on hand and the value of the change (nivelimi i çmimeve);
--     posting sets the prices and records them in price_changes
--   * company_members.warehouse_ids: a person may work only in these
--     warehouses (empty = all); documents of other warehouses are refused
--   * advance invoices: an invoice for a payment before delivery, booked to
--     customer advances (419) with its VAT; the final invoice deducts it
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

-- =============================================================================
-- 1. Price levelling
-- =============================================================================
create table public.price_levels (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id),
  number       text,
  status       text not null default 'draft',
  level_date   date not null default current_date,
  warehouse_id uuid,                 -- whose stock is counted (null = all)
  notes        text,
  value_change numeric(18,2) not null default 0,
  posted_at    timestamptz,
  posted_by    uuid references public.profiles(id) on delete set null,
  foreign key (company_id, warehouse_id) references public.warehouses(company_id, id)
);
select app.register_table('public.price_levels', 'inventory');
insert into public.document_types (key, name, module, table_name, default_prefix)
values ('price_level', 'Price levelling', 'inventory', 'price_levels', 'NIV-') on conflict (key) do nothing;
insert into public.status_transitions (doc_type, from_status, to_status)
values ('price_level', '__init__', 'draft'), ('price_level', 'draft', 'posted') on conflict do nothing;
select app.register_document('public.price_levels', 'price_level', 'level_date');

create table public.price_level_lines (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  level_id    uuid not null references public.price_levels(id) on delete cascade,
  line_no     int not null default 0,
  variant_id  uuid not null,
  old_price   numeric(18,4),                         -- without VAT, when posted
  new_price   numeric(18,4) not null check (new_price >= 0),   -- without VAT
  quantity    numeric(18,4),                         -- on hand when posted
  value_change numeric(18,2),
  foreign key (company_id, variant_id) references public.product_variants(company_id, id),
  unique (level_id, variant_id)
);
select app.register_table('public.price_level_lines', 'inventory', p_soft_delete => false, p_audit => false);
insert into app.document_children values ('price_levels', 'price_level_lines', 'level_id') on conflict do nothing;

-- the items to level, with their price and stock now
create or replace function public.price_level_items(p_company uuid, p_variants uuid[], p_warehouse uuid default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('variant_id', v.id, 'sku', v.sku,
           'name', case when v.is_default or coalesce(v.name, '') = '' then p.name else v.name end,
           'price', coalesce(v.sales_price_override, p.sales_price, 0), 'vat_rate', coalesce(tc.rate, 0),
           'cost', coalesce(ic.avg_cost, 0), 'category', cat.name,
           'stock', coalesce((select sum(s.on_hand) from public.stock_levels s where s.variant_id = v.id and (p_warehouse is null or s.warehouse_id = p_warehouse)), 0))
           order by p.name, v.sku), '[]'::jsonb)
    from public.product_variants v join public.products p on p.id = v.product_id
    left join public.tax_codes tc on tc.id = p.sales_tax_code_id
    left join public.product_categories cat on cat.id = p.category_id
    left join lateral (select case when sum(qty_on_hand) > 0 then sum(total_value) / sum(qty_on_hand) end avg_cost
                         from public.item_costs where variant_id = v.id) ic on true
   where v.company_id = p_company and v.id = any (p_variants) and v.deleted_at is null
     and p_company = any ((select app.company_ids_with('inventory.read'))::uuid[])
$$;

create or replace function public.price_level_post(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare h public.price_levels; l record; v_single boolean; v_total numeric := 0; n int := 0; v_qty numeric; v_old numeric;
begin
  select * into h from public.price_levels where id = p_id and deleted_at is null for update;
  if h.id is null then raise exception 'Price levelling not found' using errcode = 'P0002'; end if;
  perform app.require_permission(h.company_id, 'inventory.write');
  if h.status <> 'draft' then raise exception 'It is already posted' using errcode = '55000'; end if;
  if not exists (select 1 from public.price_level_lines where level_id = h.id) then raise exception 'Add at least one item' using errcode = '23514'; end if;
  perform app.check_warehouse(h.company_id, h.warehouse_id);

  for l in select pl.*, v.product_id, v.sales_price_override, p.sales_price, coalesce(tc.rate, 0) rate
             from public.price_level_lines pl join public.product_variants v on v.id = pl.variant_id join public.products p on p.id = v.product_id
             left join public.tax_codes tc on tc.id = p.sales_tax_code_id
            where pl.level_id = h.id order by pl.line_no loop
    v_old := coalesce(l.sales_price_override, l.sales_price, 0);
    select coalesce(sum(on_hand), 0) into v_qty from public.stock_levels where variant_id = l.variant_id and (h.warehouse_id is null or warehouse_id = h.warehouse_id);
    update public.price_level_lines set old_price = v_old, quantity = v_qty,
           value_change = round(v_qty * (l.new_price - v_old) * (1 + l.rate / 100), 2) where id = l.id;
    v_total := v_total + round(v_qty * (l.new_price - v_old) * (1 + l.rate / 100), 2);
    continue when round(v_old, 4) = round(l.new_price, 4);
    -- the item's price when it has one variant (or the variant had none of its own), else the variant's
    v_single := (select count(*) from public.product_variants where product_id = l.product_id and deleted_at is null) = 1;
    if l.sales_price_override is not null and not v_single then
      update public.product_variants set sales_price_override = l.new_price where id = l.variant_id;
    else
      update public.products set sales_price = l.new_price where id = l.product_id;
      if l.sales_price_override is not null then update public.product_variants set sales_price_override = null where id = l.variant_id; end if;
    end if;
    n := n + 1;
  end loop;
  update public.price_levels set status = 'posted', posted_at = now(), posted_by = auth.uid(), value_change = v_total where id = h.id;
  -- the price history knows which document changed them
  update public.price_changes c set doc_number = h.number, warehouse_id = coalesce(c.warehouse_id, h.warehouse_id)
   where c.company_id = h.company_id and c.created_at = now() and c.doc_number is null
     and c.variant_id in (select variant_id from public.price_level_lines where level_id = h.id);
  return jsonb_build_object('changed', n, 'value_change', v_total, 'number', h.number);
end $$;

create or replace function public.price_level_print(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare h public.price_levels;
begin
  select * into h from public.price_levels where id = p_id and deleted_at is null;
  if h.id is null then raise exception 'Price levelling not found' using errcode = 'P0002'; end if;
  perform app.require_permission(h.company_id, 'inventory.read');
  return jsonb_build_object('number', h.number, 'date', h.level_date, 'status', h.status, 'notes', h.notes, 'value_change', h.value_change,
    'warehouse', (select name from public.warehouses where id = h.warehouse_id), 'company', app.print_company(h.company_id),
    'posted_by', (select full_name from public.profiles where id = h.posted_by), 'posted_at', h.posted_at,
    'printed_by', (select full_name from public.profiles where id = auth.uid()), 'printed_at', now(),
    'currency', (select base_currency from public.companies where id = h.company_id),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('sku', v.sku, 'name', case when v.is_default or coalesce(v.name, '') = '' then p.name else v.name end,
               'uom', u.code, 'vat_rate', coalesce(tc.rate, 0), 'quantity', l.quantity,
               'old_price', coalesce(l.old_price, v.sales_price_override, p.sales_price, 0), 'new_price', l.new_price, 'value_change', l.value_change) order by l.line_no)
             from public.price_level_lines l join public.product_variants v on v.id = l.variant_id join public.products p on p.id = v.product_id
             left join public.units_of_measure u on u.id = p.uom_id left join public.tax_codes tc on tc.id = p.sales_tax_code_id
            where l.level_id = h.id), '[]'::jsonb));
end $$;

-- labels for a levelling, with the old price
select app._patch_function('public.label_items',
  $o$if p_source not in ('items', 'products', 'category', 'receipt', 'bill', 'price_changes') then$o$,
  $n$if p_source not in ('items', 'products', 'category', 'receipt', 'bill', 'price_changes', 'price_level') then$n$);
select app._patch_function('public.label_items',
  $o$    union all
    select c.variant_id, 1,$o$,
  $n$    union all
    select l.variant_id, 1, l.old_price, l.line_no from public.price_level_lines l
     where p_source = 'price_level' and l.level_id = any (p_ids) and l.company_id = p_company
    union all
    select c.variant_id, 1,$n$);

-- =============================================================================
-- 2. Warehouses per user
-- =============================================================================
alter table public.company_members add column if not exists warehouse_ids uuid[];

-- null: every warehouse
create or replace function app.my_warehouses(p_company uuid)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select case when app.is_super_admin() or auth.uid() is null then null
    else (select nullif(m.warehouse_ids, '{}') from public.company_members m
           where m.company_id = p_company and m.user_id = auth.uid() and m.status = 'active' and m.deleted_at is null limit 1) end
$$;

create or replace function app.check_warehouse(p_company uuid, p_wh uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
declare v uuid[];
begin
  if p_wh is null then return; end if;
  v := app.my_warehouses(p_company);
  if v is null or p_wh = any (v) then return; end if;
  raise exception 'You do not work in the warehouse %', (select name from public.warehouses where id = p_wh) using errcode = '42501';
end $$;

-- documents of a warehouse: created, moved or advanced only by someone who works there
-- (TG_ARGV: the warehouse columns; for transfers either end is enough)
create or replace function app.tg_warehouse_access()
returns trigger language plpgsql security definer set search_path = '' as $$
declare j jsonb := to_jsonb(new); o jsonb; v uuid[]; c text; ok boolean := false; any_set boolean := false;
begin
  if auth.uid() is null then return new; end if;
  v := app.my_warehouses(new.company_id);
  if v is null then return new; end if;
  if tg_op = 'UPDATE' then
    o := to_jsonb(old);
    if (o ->> 'status') is not distinct from (j ->> 'status')
       and not exists (select 1 from unnest(tg_argv) a where (o ->> a) is distinct from (j ->> a)) then
      return new;
    end if;
  end if;
  foreach c in array tg_argv loop
    if (j ->> c) is not null then
      any_set := true;
      if (j ->> c)::uuid = any (v) then ok := true; end if;
    end if;
  end loop;
  if any_set and not ok then
    raise exception 'You do not work in the warehouse %', (select name from public.warehouses where id = (j ->> tg_argv[0])::uuid) using errcode = '42501';
  end if;
  return new;
end $$;

do $$
declare r record;
begin
  for r in select * from (values
      ('goods_receipts', 'warehouse_id'), ('deliveries', 'warehouse_id'), ('sales_orders', 'warehouse_id'), ('purchase_orders', 'warehouse_id'),
      ('purchase_requisitions', 'warehouse_id'), ('stock_adjustments', 'warehouse_id'), ('cycle_counts', 'warehouse_id'), ('vendor_bills', 'warehouse_id'),
      ('work_orders', 'warehouse_id'), ('price_levels', 'warehouse_id'), ('stock_transfers', 'from_warehouse_id, to_warehouse_id')) x(t, cols) loop
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = r.t and column_name = split_part(r.cols, ',', 1)) then
      execute format('drop trigger if exists trg_07_warehouse_access on public.%I', r.t);
      execute format('create trigger trg_07_warehouse_access before insert or update on public.%I for each row execute function app.tg_warehouse_access(%s)',
                     r.t, (select string_agg(quote_literal(btrim(x)), ', ') from unnest(string_to_array(r.cols, ',')) x));
    end if;
  end loop;
end $$;

-- a till session opens only on a register of one's own warehouse
create or replace function app.tg_pos_session_warehouse()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform app.check_warehouse(new.company_id, (select warehouse_id from public.pos_registers where id = new.register_id));
  return new;
end $$;
drop trigger if exists trg_07_warehouse_access on public.pos_sessions;
create trigger trg_07_warehouse_access before insert on public.pos_sessions for each row execute function app.tg_pos_session_warehouse();

create or replace function public.my_warehouse_access(p_company uuid)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select app.my_warehouses(p_company)
$$;

create or replace function public.member_warehouses(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'admin.read');
  return coalesce((select jsonb_object_agg(id, warehouse_ids) from public.company_members where company_id = p_company and deleted_at is null and warehouse_ids is not null), '{}'::jsonb);
end $$;

create or replace function public.member_set_warehouses(p_member uuid, p_warehouses uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare m public.company_members;
begin
  select * into m from public.company_members where id = p_member and deleted_at is null;
  if m.id is null then raise exception 'Member not found' using errcode = 'P0002'; end if;
  perform app.require_permission(m.company_id, 'admin.write');
  if exists (select 1 from unnest(p_warehouses) w where not exists (select 1 from public.warehouses where id = w and company_id = m.company_id)) then
    raise exception 'Unknown warehouse' using errcode = '23514';
  end if;
  update public.company_members set warehouse_ids = nullif(p_warehouses, '{}') where id = m.id;
end $$;

-- =============================================================================
-- 3. Advance invoices
-- =============================================================================
alter table public.sales_invoices add column if not exists is_advance boolean not null default false;
-- (no foreign key: a second link between invoices and their lines would make the API's line lists ambiguous; the functions below keep it right)
alter table public.sales_invoice_lines add column if not exists advance_invoice_id uuid;
alter table public.sales_invoice_lines drop constraint if exists sales_invoice_lines_unit_price_check;
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.sales_invoice_lines'::regclass and contype = 'c'
            and pg_get_constraintdef(oid) = 'CHECK ((unit_price >= (0)::numeric))' loop
    execute format('alter table public.sales_invoice_lines drop constraint %I', c);
  end loop;
end $$;
-- only the deduction of an advance is negative
alter table public.sales_invoice_lines add constraint sales_invoice_lines_price_check check (unit_price >= 0 or advance_invoice_id is not null);
create index if not exists sales_invoice_lines_advance_idx on public.sales_invoice_lines (advance_invoice_id) where advance_invoice_id is not null;

-- what is still to deduct of an advance invoice (without VAT)
create or replace function app.advance_left(p_advance uuid, p_except uuid default null)
returns numeric language sql stable security definer set search_path = '' as $$
  select a.subtotal
         + coalesce((select sum(l.line_subtotal) from public.sales_invoice_lines l join public.sales_invoices i on i.id = l.invoice_id
                      where l.advance_invoice_id = a.id and i.deleted_at is null and i.status <> 'cancelled' and i.id is distinct from p_except), 0)
         - coalesce((select sum(c.subtotal) from public.sales_invoices c
                      where c.original_invoice_id = a.id and c.document_type = 'credit_note' and c.status = 'posted' and c.deleted_at is null), 0)
    from public.sales_invoices a where a.id = p_advance
$$;

-- (the texts on the lines are printed for the customer, so they are in Albanian, the language of both countries)
-- an advance invoice for an order (or a customer): {order_id | partner_id, amount (with VAT) | percent, tax_code_id?, date?}
create or replace function public.advance_invoice_create(p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare o public.sales_orders; v_co uuid; v_partner uuid; v_cur text; v_rate numeric := 1; v_tax uuid; v_tr numeric; v_gross numeric; v_net numeric;
        v_inv uuid; v_date date; v_days int; v_desc text;
begin
  if p ? 'order_id' then
    select * into o from public.sales_orders where id = (p ->> 'order_id')::uuid and deleted_at is null;
    if o.id is null then raise exception 'Order not found' using errcode = 'P0002'; end if;
    v_co := o.company_id; v_partner := o.partner_id; v_cur := o.currency_code; v_rate := o.exchange_rate;
    if o.status in ('draft', 'cancelled') then raise exception 'Confirm the order first' using errcode = '55000'; end if;
  else
    select company_id, id into v_co, v_partner from public.business_partners where id = (p ->> 'partner_id')::uuid;
    if v_co is null then raise exception 'Customer not found' using errcode = 'P0002'; end if;
    v_cur := coalesce(p ->> 'currency', (select base_currency from public.companies where id = v_co));
  end if;
  perform app.require_permission(v_co, 'invoicing.write');
  -- the VAT of the advance: the one asked, else the order's (largest line), else the company's usual
  v_tax := coalesce(nullif(p ->> 'tax_code_id', '')::uuid,
                    (select tax_code_id from public.sales_order_lines where sales_order_id = o.id and tax_code_id is not null order by line_total desc limit 1),
                    (select default_sales_tax_code_id from public.company_settings where company_id = v_co));
  select coalesce(rate, 0) into v_tr from public.tax_codes where id = v_tax;
  v_gross := case when nullif(p ->> 'percent', '') is not null and o.id is not null then round(o.total * (p ->> 'percent')::numeric / 100, 2)
                  else round((p ->> 'amount')::numeric, 2) end;
  if coalesce(v_gross, 0) <= 0 then raise exception 'Enter the amount of the advance' using errcode = '23514'; end if;
  if o.id is not null and v_gross > o.total then raise exception 'The advance is more than the order' using errcode = '23514'; end if;
  v_net := round(v_gross / (1 + coalesce(v_tr, 0) / 100), 4);
  v_date := coalesce(nullif(p ->> 'date', '')::date, current_date);
  select coalesce(due_days, 0) into v_days from public.payment_terms where id = o.payment_term_id;
  v_desc := coalesce(nullif(btrim(p ->> 'description'), ''), case when o.id is not null then 'Paradhënie për porosinë ' || o.number else 'Paradhënie' end);

  insert into public.sales_invoices (company_id, partner_id, sales_order_id, source, invoice_date, due_date, currency_code, exchange_rate,
                                     payment_term_id, salesperson_id, billing_address_id, notes, is_advance)
  values (v_co, v_partner, o.id, case when o.id is null then 'manual' else 'sales_order' end, v_date, v_date + coalesce(v_days, 0), v_cur, coalesce(v_rate, 1),
          o.payment_term_id, o.salesperson_id, o.billing_address_id, p ->> 'notes', true)
  returning id into v_inv;
  insert into public.sales_invoice_lines (company_id, invoice_id, line_no, description, account_id, quantity, unit_price, tax_code_id)
  values (v_co, v_inv, 1, v_desc, app.acct(v_co, 'customer_advances'), 1, v_net, v_tax);
  return v_inv;
end $$;

-- the final invoice deducts the customer's advances (of its order first, then any other of the customer, when asked)
create or replace function public.invoice_add_advances(p_invoice uuid, p_any boolean default false)
returns int language plpgsql security definer set search_path = '' as $$
declare i public.sales_invoices; a record; v_left numeric; v_room numeric; v_take numeric; n int := 0; v_no int;
begin
  select * into i from public.sales_invoices where id = p_invoice and deleted_at is null for update;
  if i.id is null then raise exception 'Invoice not found' using errcode = 'P0002'; end if;
  perform app.require_permission(i.company_id, 'invoicing.write');
  if i.status <> 'draft' or i.document_type <> 'sales_invoice' or i.is_advance then return 0; end if;
  delete from public.sales_invoice_lines where invoice_id = i.id and advance_invoice_id is not null;
  v_room := coalesce((select sum(line_subtotal) from public.sales_invoice_lines where invoice_id = i.id), 0);
  select coalesce(max(line_no), 0) into v_no from public.sales_invoice_lines where invoice_id = i.id;
  for a in select x.id, x.number, x.invoice_date, (select tax_code_id from public.sales_invoice_lines where invoice_id = x.id order by line_no limit 1) tax
             from public.sales_invoices x
            where x.company_id = i.company_id and x.partner_id = i.partner_id and x.is_advance and x.status = 'posted' and x.deleted_at is null
              and x.currency_code = i.currency_code
              and ((i.sales_order_id is not null and x.sales_order_id = i.sales_order_id) or (p_any and (i.sales_order_id is null or x.sales_order_id is null)))
            order by (x.sales_order_id is not distinct from i.sales_order_id) desc, x.invoice_date, x.number loop
    exit when v_room <= 0;
    v_left := app.advance_left(a.id, i.id);
    continue when v_left <= 0;
    v_take := least(v_left, v_room);
    v_no := v_no + 1;
    insert into public.sales_invoice_lines (company_id, invoice_id, line_no, description, account_id, quantity, unit_price, tax_code_id, advance_invoice_id)
    values (i.company_id, i.id, v_no, 'Zbritje e paradhënies ' || a.number || ' të ' || to_char(a.invoice_date, 'DD.MM.YYYY'),
            app.acct(i.company_id, 'customer_advances'), 1, -v_take, a.tax, a.id);
    v_room := v_room - v_take; n := n + 1;
  end loop;
  return n;
end $$;

do $$ begin
  if position('invoice_add_advances' in pg_get_functiondef('public.create_invoice_from_order'::regproc)) = 0 then
    perform app._patch_function('public.create_invoice_from_order',
      $o$    raise exception 'Nothing to invoice on %: deliver the goods first', o.number using errcode = '23514';
  end if;
  return v_inv;$o$,
      $n$    raise exception 'Nothing to invoice on %: deliver the goods first', o.number using errcode = '23514';
  end if;
  perform public.invoice_add_advances(v_inv);
  return v_inv;$n$);
  end if;
end $$;

-- the advances of an order or a customer, and what is left of each
create or replace function public.advance_invoices(p_company uuid, p_order uuid default null, p_partner uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'invoicing.read');
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'number', a.number, 'date', a.invoice_date, 'status', a.status, 'total', a.total,
            'subtotal', a.subtotal, 'currency', a.currency_code, 'paid', a.amount_paid, 'order_id', a.sales_order_id,
            'left', case when a.status = 'posted' then app.advance_left(a.id) else a.subtotal end,
            'deducted_in', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'number', i.number, 'status', i.status, 'amount', -l.line_subtotal))
                                       from public.sales_invoice_lines l join public.sales_invoices i on i.id = l.invoice_id
                                      where l.advance_invoice_id = a.id and i.deleted_at is null), '[]'::jsonb)) order by a.invoice_date, a.number)
     from public.sales_invoices a
    where a.company_id = p_company and a.is_advance and a.deleted_at is null and a.status <> 'cancelled'
      and (p_order is null or a.sales_order_id = p_order) and (p_partner is null or a.partner_id = p_partner)), '[]'::jsonb);
end $$;

-- printed: an advance invoice says so; a deduction line shows as such
select app._patch_function('public.document_print',
  $o$select jsonb_build_object('kind', case when i.document_type = 'credit_note' then 'credit_note' else 'sales_invoice' end,$o$,
  $n$select jsonb_build_object('kind', case when i.document_type = 'credit_note' then 'credit_note' when i.is_advance then 'advance_invoice' else 'sales_invoice' end,$n$);

revoke execute on function public.price_level_items(uuid, uuid[], uuid), public.price_level_post(uuid), public.price_level_print(uuid),
  public.my_warehouse_access(uuid), public.member_warehouses(uuid), public.member_set_warehouses(uuid, uuid[]),
  public.advance_invoice_create(jsonb), public.invoice_add_advances(uuid, boolean), public.advance_invoices(uuid, uuid, uuid) from public, anon;
grant execute on function public.price_level_items(uuid, uuid[], uuid), public.price_level_post(uuid), public.price_level_print(uuid),
  public.my_warehouse_access(uuid), public.member_warehouses(uuid), public.member_set_warehouses(uuid, uuid[]),
  public.advance_invoice_create(jsonb), public.invoice_add_advances(uuid, boolean), public.advance_invoices(uuid, uuid, uuid) to authenticated;

drop function app._patch_function(text, text, text);
