-- =============================================================================
-- B2B portal and public API
--
-- Portal: a customer opens a private link (optionally with a PIN) and sees their prices, what is in
-- stock, their orders, invoices and what they owe; they send orders that land as sales orders.
-- No account is made for them: the link is a secret key (only its hash is kept), it can be switched
-- off, it can expire, and five wrong PINs lock it for 15 minutes.
--
-- API: a company key with scopes for other programs (web shop, B2B platforms, BI). Each call runs
-- with the rights of the administrator who made the key, so a key can never do more than they can.
-- =============================================================================

alter table public.sales_orders drop constraint sales_orders_channel_check;
alter table public.sales_orders add constraint sales_orders_channel_check
  check (channel in ('direct','phone','email','ecommerce','pos','marketplace','agent','b2b','api'));

alter table public.company_settings
  add column if not exists portal_auto_confirm boolean not null default false,
  add column if not exists portal_stock text not null default 'level' check (portal_stock in ('none','level','exact'));

-- act as a member for the rest of the transaction (keys and links have no login of their own)
create or replace function app.act_as(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;

-- =============================================================================
-- 1. Portal links
-- =============================================================================
create table public.portal_links (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  partner_id    uuid not null,
  label         text,
  key_prefix    text not null,
  key_hash      text not null unique,
  pin_hash      text,
  pin_failures  int not null default 0,
  locked_until  timestamptz,
  can_order     boolean not null default true,
  can_see_invoices boolean not null default true,
  run_as        uuid not null references auth.users(id),
  is_active     boolean not null default true,
  expires_on    date,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  uses          bigint not null default 0,
  foreign key (company_id, partner_id) references public.business_partners(company_id, id) on delete cascade
);
create index portal_links_partner_idx on public.portal_links (partner_id);
alter table public.portal_links enable row level security;
revoke all on public.portal_links from anon, authenticated;
grant select (id, company_id, partner_id, label, key_prefix, can_order, can_see_invoices, is_active, expires_on, created_at, last_used_at, uses, locked_until)
  on public.portal_links to authenticated;
create policy portal_links_select on public.portal_links for select to authenticated
  using (company_id = any ((select app.company_ids_with('sales.read'))::uuid[]));

create or replace function public.portal_link_create(p_partner uuid, p jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare bp public.business_partners; v_key text; v_id uuid; v_pin text := nullif(btrim(p ->> 'pin'), '');
begin
  select * into bp from public.business_partners where id = p_partner and deleted_at is null;
  if bp.id is null or not bp.is_customer then raise exception 'Customer not found' using errcode = 'P0002'; end if;
  perform app.require_permission(bp.company_id, 'sales.approve');
  if v_pin is not null and v_pin !~ '^\d{4,8}$' then raise exception 'The PIN is 4 to 8 digits' using errcode = '23514'; end if;
  v_key := 'b2b_' || encode(extensions.gen_random_bytes(24), 'hex');
  v_id := gen_random_uuid();
  insert into public.portal_links (id, company_id, partner_id, label, key_prefix, key_hash, pin_hash, can_order, can_see_invoices, run_as, expires_on)
  values (v_id, bp.company_id, bp.id, nullif(btrim(p ->> 'label'), ''), left(v_key, 10), encode(extensions.digest(v_key, 'sha256'), 'hex'),
          case when v_pin is not null then encode(extensions.digest(v_id::text || v_pin, 'sha256'), 'hex') end,
          coalesce((p ->> 'can_order')::boolean, true), coalesce((p ->> 'can_see_invoices')::boolean, true), auth.uid(),
          nullif(p ->> 'expires_on', '')::date);
  return jsonb_build_object('id', v_id, 'key', v_key);   -- shown once, never stored
end $$;

create or replace function public.portal_link_set(p_id uuid, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare l public.portal_links;
begin
  select * into l from public.portal_links where id = p_id;
  if l.id is null then raise exception 'Link not found' using errcode = 'P0002'; end if;
  perform app.require_permission(l.company_id, 'sales.approve');
  update public.portal_links set is_active = coalesce((p ->> 'is_active')::boolean, is_active),
         can_order = coalesce((p ->> 'can_order')::boolean, can_order),
         can_see_invoices = coalesce((p ->> 'can_see_invoices')::boolean, can_see_invoices),
         pin_failures = case when (p ->> 'unlock')::boolean then 0 else pin_failures end,
         locked_until = case when (p ->> 'unlock')::boolean then null else locked_until end
   where id = p_id;
end $$;

create or replace function public.portal_settings_save(p_company uuid, p_auto_confirm boolean, p_stock text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'sales.approve');
  update public.company_settings set portal_auto_confirm = coalesce(p_auto_confirm, portal_auto_confirm),
         portal_stock = coalesce(p_stock, portal_stock) where company_id = p_company;
end $$;

-- The link behind a key. Errors come back as {error} rather than an exception, so a wrong PIN is
-- counted (an exception would undo the count).
create or replace function app.portal_check(p_key text, p_pin text, out link public.portal_links, out err text)
language plpgsql security definer set search_path = '' as $$
begin
  select * into link from public.portal_links where key_hash = encode(extensions.digest(coalesce(p_key, ''), 'sha256'), 'hex') for update;
  if link.id is null or not link.is_active or (link.expires_on is not null and link.expires_on < current_date)
     or not app.license_ok(link.company_id)
     or not exists (select 1 from public.business_partners where id = link.partner_id and is_active and deleted_at is null) then
    link := null; err := 'closed'; return;
  end if;
  if link.locked_until is not null and link.locked_until > now() then err := 'locked'; return; end if;
  if link.pin_hash is not null then
    if nullif(p_pin, '') is null then err := 'pin'; return; end if;
    if encode(extensions.digest(link.id::text || p_pin, 'sha256'), 'hex') <> link.pin_hash then
      update public.portal_links set pin_failures = pin_failures + 1,
             locked_until = case when pin_failures + 1 >= 5 then now() + interval '15 minutes' end where id = link.id;
      err := case when link.pin_failures + 1 >= 5 then 'locked' else 'wrong_pin' end; return;
    end if;
  end if;
  update public.portal_links set pin_failures = 0, locked_until = null, last_used_at = now(), uses = uses + 1 where id = link.id;
  perform app.act_as(link.run_as);
end $$;

create or replace function app.portal_availability(p_company uuid, p_variant uuid, p_mode text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case p_mode
    when 'none' then null
    when 'exact' then to_jsonb(greatest(coalesce(sum(sl.available), 0), 0))
    else to_jsonb(case when coalesce(sum(sl.available), 0) <= 0 then 'out' when sum(sl.available) < 10 then 'low' else 'in' end) end
    from public.stock_levels sl join public.warehouses w on w.id = sl.warehouse_id and w.deleted_at is null and w.is_active
   where sl.company_id = p_company and sl.variant_id = p_variant
$$;

create or replace function public.portal_home(p_key text, p_pin text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c record; bp public.business_partners; co public.companies; v_today date := current_date;
begin
  select * into c from app.portal_check(p_key, p_pin);
  if c.err is not null then return jsonb_build_object('error', c.err); end if;
  select * into bp from public.business_partners where id = (c.link).partner_id;
  select * into co from public.companies where id = bp.company_id;
  return jsonb_build_object(
    'company', jsonb_build_object('name', co.name, 'phone', co.phone, 'email', co.email, 'address', concat_ws(', ', co.address_line1, co.city),
                                  'tax_number', co.tax_number, 'currency', co.base_currency),
    'customer', jsonb_build_object('name', bp.name, 'code', bp.code, 'currency', coalesce(bp.currency_code, co.base_currency)),
    'can_order', (c.link).can_order, 'can_see_invoices', (c.link).can_see_invoices,
    'owed', app.agent_owed(bp.id),
    'overdue', coalesce((select sum(round(i.amount_due * i.exchange_rate, 2)) from public.sales_invoices i where i.partner_id = bp.id and i.status = 'posted'
                           and i.document_type = 'sales_invoice' and i.payment_status <> 'paid' and i.due_date < v_today and i.deleted_at is null), 0),
    'credit_left', case when bp.credit_limit is not null then bp.credit_limit - app.customer_exposure(bp.id, null) end,
    'invoices', case when (c.link).can_see_invoices then coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'number', i.number, 'type', i.document_type,
                    'date', i.invoice_date, 'due', i.due_date, 'total', i.total, 'open', i.amount_due, 'currency', i.currency_code, 'status', i.payment_status)
                    order by i.invoice_date desc, i.number desc)
                    from (select * from public.sales_invoices i where i.partner_id = bp.id and i.status = 'posted' and i.deleted_at is null
                           order by i.invoice_date desc, i.number desc limit 100) i), '[]'::jsonb) else '[]'::jsonb end,
    'orders', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'number', o.number, 'date', o.order_date, 'status', o.status, 'total', o.total,
                    'currency', o.currency_code, 'channel', o.channel, 'invoice_status', o.invoice_status) order by o.order_date desc, o.number desc)
                    from (select * from public.sales_orders o where o.partner_id = bp.id and o.deleted_at is null and o.status <> 'cancelled'
                           order by o.order_date desc, o.created_at desc limit 50) o), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', pc.id, 'name', pc.name) order by pc.name) from public.product_categories pc
                    where pc.company_id = bp.company_id and pc.deleted_at is null
                      and exists (select 1 from public.products p where p.category_id = pc.id and p.is_sellable and p.is_active and p.deleted_at is null)), '[]'::jsonb));
end $$;

-- a page of the catalogue with this customer's prices
create or replace function public.portal_catalog(p_key text, p_pin text default null, p_search text default null, p_category uuid default null, p_offset int default 0)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c record; bp public.business_partners; v_cur text; v_mode text; v_q text := nullif(btrim(p_search), ''); v_total int; v_items jsonb;
begin
  select * into c from app.portal_check(p_key, p_pin);
  if c.err is not null then return jsonb_build_object('error', c.err); end if;
  select * into bp from public.business_partners where id = (c.link).partner_id;
  v_cur := coalesce(bp.currency_code, (select base_currency from public.companies where id = bp.company_id));
  select portal_stock into v_mode from public.company_settings where company_id = bp.company_id;

  with page as (
    select v.id variant_id, p.id product_id, v.sku, v.name, (select u.code from public.units_of_measure u where u.id = p.uom_id) uom, coalesce(t.rate, 0) tax,
           row_number() over (order by v.name, v.sku) n, count(*) over () total
      from public.product_variants v join public.products p on p.id = v.product_id
      left join public.tax_codes t on t.id = p.sales_tax_code_id
     where v.company_id = bp.company_id and v.deleted_at is null and v.is_active and p.deleted_at is null and p.is_active and p.is_sellable
       and (p_category is null or p.category_id = p_category)
       and (v_q is null or v.name ilike '%' || v_q || '%' or v.sku ilike v_q || '%' or p.brand ilike '%' || v_q || '%'
            or exists (select 1 from public.product_barcodes b where b.variant_id = v.id and b.barcode = v_q and b.deleted_at is null)))
  select coalesce(max(x.total), 0)::int,
         coalesce(jsonb_agg(jsonb_build_object('id', x.variant_id, 'product_id', x.product_id, 'sku', x.sku, 'name', x.name, 'uom', x.uom, 'tax', x.tax,
           'price', pr.unit_price, 'discount', pr.discount_pct,
           'net', round(pr.unit_price * (1 - coalesce(pr.discount_pct, 0) / 100), 2),
           'gross', round(pr.unit_price * (1 - coalesce(pr.discount_pct, 0) / 100) * (1 + x.tax / 100), 2),
           'stock', app.portal_availability(bp.company_id, x.variant_id, v_mode),
           'image', exists (select 1 from public.product_images i where i.product_id = x.product_id)) order by x.n) filter (where x.variant_id is not null), '[]'::jsonb)
    into v_total, v_items
    from (select * from page where n > greatest(p_offset, 0) and n <= greatest(p_offset, 0) + 40) x
    left join lateral public.get_price(bp.company_id, bp.id, x.variant_id, 1, current_date, bp.price_list_id, v_cur) pr on true;
  if v_total = 0 and greatest(p_offset, 0) > 0 then
    select count(*) into v_total from public.product_variants v join public.products p on p.id = v.product_id
     where v.company_id = bp.company_id and v.deleted_at is null and v.is_active and p.deleted_at is null and p.is_active and p.is_sellable
       and (p_category is null or p.category_id = p_category) and (v_q is null or v.name ilike '%' || v_q || '%' or v.sku ilike v_q || '%');
  end if;
  return jsonb_build_object('total', v_total, 'offset', greatest(p_offset, 0), 'currency', v_cur, 'items', v_items);
end $$;

create or replace function public.portal_images(p_key text, p_pin text, p_products uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c record;
begin
  select * into c from app.portal_check(p_key, p_pin);
  if c.err is not null then return jsonb_build_object('error', c.err); end if;
  if coalesce(array_length(p_products, 1), 0) > 40 then raise exception 'At most 40 pictures at once' using errcode = '54000'; end if;
  return coalesce((select jsonb_object_agg(i.product_id, 'data:' || i.mime || ';base64,' || translate(encode(i.data, 'base64'), E'\n', ''))
                     from public.product_images i where i.company_id = (c.link).company_id and i.product_id = any (p_products)), '{}'::jsonb);
end $$;

-- p: {id (made in the browser), lines: [{variant_id, quantity}], note, requested_date}
create or replace function public.portal_order(p_key text, p_pin text, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c record; bp public.business_partners; o public.sales_orders; v_id uuid := (p ->> 'id')::uuid; l jsonb; v_n int := 0; pr record; v_var record;
  v_qty numeric; v_cur text; v_auto boolean; v_why text;
begin
  select * into c from app.portal_check(p_key, p_pin);
  if c.err is not null then return jsonb_build_object('error', c.err); end if;
  if not (c.link).can_order then return jsonb_build_object('error', 'no_orders'); end if;
  select * into bp from public.business_partners where id = (c.link).partner_id;
  select * into o from public.sales_orders where id = v_id;
  if o.id is not null then
    if o.partner_id <> bp.id then raise exception 'Order not found' using errcode = 'P0002'; end if;
    return jsonb_build_object('id', o.id, 'number', o.number, 'status', o.status, 'total', o.total, 'currency', o.currency_code, 'replay', true);
  end if;
  if jsonb_array_length(coalesce(p -> 'lines', '[]'::jsonb)) = 0 then raise exception 'Add at least one line before confirming' using errcode = '23514'; end if;
  if jsonb_array_length(p -> 'lines') > 300 then raise exception 'At most 300 lines in one order' using errcode = '54000'; end if;
  v_cur := coalesce(bp.currency_code, (select base_currency from public.companies where id = bp.company_id));
  select portal_auto_confirm into v_auto from public.company_settings where company_id = bp.company_id;

  insert into public.sales_orders (id, company_id, partner_id, requested_date, warehouse_id, currency_code, price_list_id, payment_term_id,
                                   salesperson_id, channel, customer_reference, notes)
  values (v_id, bp.company_id, bp.id, nullif(p ->> 'requested_date', '')::date,
          (select id from public.warehouses where company_id = bp.company_id and deleted_at is null and is_active order by created_at limit 1),
          v_cur, bp.price_list_id, bp.payment_term_id, bp.salesperson_id, 'b2b', left(nullif(btrim(p ->> 'reference'), ''), 80),
          left(nullif(btrim(p ->> 'note'), ''), 2000));
  for l in select * from jsonb_array_elements(p -> 'lines') loop
    v_qty := (l ->> 'quantity')::numeric;
    if v_qty is null or v_qty <= 0 or v_qty > 1000000 then raise exception 'Quantity must be more than zero' using errcode = '23514'; end if;
    select v.id, v.name, p2.uom_id into v_var from public.product_variants v join public.products p2 on p2.id = v.product_id
     where v.id = (l ->> 'variant_id')::uuid and v.company_id = bp.company_id and v.deleted_at is null and v.is_active and p2.is_sellable and p2.is_active;
    if v_var.id is null then raise exception 'Product not found' using errcode = 'P0002'; end if;
    select * into pr from public.get_price(bp.company_id, bp.id, v_var.id, v_qty, current_date, bp.price_list_id, v_cur);
    v_n := v_n + 1;
    insert into public.sales_order_lines (company_id, sales_order_id, line_no, variant_id, description, quantity, uom_id, unit_price, discount_pct, tax_code_id)
    values (bp.company_id, v_id, v_n, v_var.id, v_var.name, v_qty, v_var.uom_id, coalesce(pr.unit_price, 0), coalesce(pr.discount_pct, 0), pr.tax_code_id);
  end loop;

  if v_auto then
    begin perform public.confirm_sales_order(v_id); exception when others then v_why := sqlerrm; end;
  end if;
  select * into o from public.sales_orders where id = v_id;
  perform app.notify_permission(bp.company_id, 'sales.write', case when o.status = 'draft' then 'warning' else 'info' end,
    'Order from the B2B portal: ' || bp.name, o.number || ' · ' || to_char(o.total, 'FM999G999G990D00') || ' ' || o.currency_code
      || case when v_why is not null then ' · ' || v_why when o.status = 'draft' then ' · confirm it' else '' end,
    '/sales/orders/' || o.id);
  return jsonb_build_object('id', o.id, 'number', o.number, 'status', o.status, 'total', o.total, 'currency', o.currency_code);
end $$;

-- one invoice (or an order) to look at or print
create or replace function public.portal_document(p_key text, p_pin text, p_kind text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c record; r jsonb;
begin
  select * into c from app.portal_check(p_key, p_pin);
  if c.err is not null then return jsonb_build_object('error', c.err); end if;
  if p_kind = 'invoice' then
    if not (c.link).can_see_invoices then return jsonb_build_object('error', 'closed'); end if;
    select jsonb_build_object('number', i.number, 'type', i.document_type, 'date', i.invoice_date, 'due', i.due_date, 'currency', i.currency_code,
             'subtotal', i.subtotal, 'discount', i.discount_total, 'tax', i.tax_total, 'total', i.total, 'paid', i.amount_paid, 'open', i.amount_due,
             'lines', (select jsonb_agg(jsonb_build_object('description', l.description, 'quantity', l.quantity, 'price', l.unit_price, 'discount', l.discount_pct,
                        'tax_rate', l.tax_rate, 'total', l.line_total) order by l.line_no) from public.sales_invoice_lines l where l.invoice_id = i.id))
      into r from public.sales_invoices i where i.id = p_id and i.partner_id = (c.link).partner_id and i.status = 'posted' and i.deleted_at is null;
  else
    select jsonb_build_object('number', o.number, 'type', 'order', 'date', o.order_date, 'status', o.status, 'currency', o.currency_code,
             'subtotal', o.subtotal, 'discount', o.discount_total, 'tax', o.tax_total, 'total', o.total, 'note', o.notes,
             'lines', (select jsonb_agg(jsonb_build_object('description', l.description, 'quantity', l.quantity, 'delivered', l.qty_delivered, 'price', l.unit_price,
                        'discount', l.discount_pct, 'tax_rate', l.tax_rate, 'total', l.line_total) order by l.line_no) from public.sales_order_lines l where l.sales_order_id = o.id))
      into r from public.sales_orders o where o.id = p_id and o.partner_id = (c.link).partner_id and o.deleted_at is null;
  end if;
  if r is null then raise exception 'Document not found' using errcode = 'P0002'; end if;
  return r;
end $$;

-- =============================================================================
-- 2. API keys
-- =============================================================================
create table public.api_keys (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  name          text not null,
  key_prefix    text not null,
  key_hash      text not null unique,
  scopes        text[] not null,
  run_as        uuid not null references auth.users(id),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  calls         bigint not null default 0,
  window_start  timestamptz,
  window_calls  int not null default 0,
  check (scopes <@ array['catalog.read','partners.read','partners.write','orders.read','orders.write','invoices.read']::text[] and cardinality(scopes) > 0)
);
create index api_keys_company_idx on public.api_keys (company_id);
alter table public.api_keys enable row level security;
revoke all on public.api_keys from anon, authenticated;
grant select (id, company_id, name, key_prefix, scopes, is_active, created_at, last_used_at, calls) on public.api_keys to authenticated;
create policy api_keys_select on public.api_keys for select to authenticated
  using (company_id = any ((select app.company_ids_with('admin.read'))::uuid[]));

-- what an outside program sent with an id of its own (a retried call returns the first document)
create table public.api_external_refs (
  company_id   uuid not null references public.companies(id) on delete cascade,
  kind         text not null,
  external_id  text not null,
  document_id  uuid not null,
  created_at   timestamptz not null default now(),
  primary key (company_id, kind, external_id)
);
alter table public.api_external_refs enable row level security;
revoke all on public.api_external_refs from anon, authenticated;
grant select on public.api_external_refs to authenticated;
create policy api_external_refs_select on public.api_external_refs for select to authenticated
  using (company_id = any ((select app.company_ids_with('sales.read'))::uuid[]));

create or replace function public.api_key_create(p_company uuid, p_name text, p_scopes text[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_key text; v_id uuid;
begin
  perform app.require_permission(p_company, 'admin.write');
  if nullif(btrim(p_name), '') is null then raise exception 'Give the key a name' using errcode = '23514'; end if;
  if coalesce(cardinality(p_scopes), 0) = 0 then raise exception 'Choose what the key may do' using errcode = '23514'; end if;
  v_key := 'nxa_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.api_keys (company_id, name, key_prefix, key_hash, scopes, run_as)
  values (p_company, btrim(p_name), left(v_key, 10), encode(extensions.digest(v_key, 'sha256'), 'hex'), p_scopes, auth.uid())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'key', v_key);
end $$;

create or replace function public.api_key_set_active(p_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_co uuid;
begin
  select company_id into v_co from public.api_keys where id = p_id;
  if v_co is null then raise exception 'Key not found' using errcode = 'P0002'; end if;
  perform app.require_permission(v_co, 'admin.write');
  update public.api_keys set is_active = p_active where id = p_id;
end $$;

-- the key of a call: the X-Api-Key header (or p_key); checks the scope and 120 calls a minute
create or replace function app.api_open(p_key text, p_scope text)
returns public.api_keys language plpgsql security definer set search_path = '' as $$
declare k public.api_keys; v_key text;
begin
  v_key := coalesce(nullif(p_key, ''), nullif(current_setting('request.headers', true), '')::json ->> 'x-api-key');
  select * into k from public.api_keys where key_hash = encode(extensions.digest(coalesce(v_key, ''), 'sha256'), 'hex') and is_active for update;
  if k.id is null then raise exception 'Unknown or switched-off API key' using errcode = '28000'; end if;
  if not app.license_ok(k.company_id) then raise exception 'The licence for this company is not active' using errcode = '42501'; end if;
  if not p_scope = any (k.scopes) then raise exception 'This key may not %', p_scope using errcode = '42501'; end if;
  if k.window_start is null or k.window_start < now() - interval '1 minute' then
    update public.api_keys set window_start = now(), window_calls = 1, calls = calls + 1, last_used_at = now() where id = k.id;
  elsif k.window_calls >= 120 then
    raise exception 'Too many calls: at most 120 a minute' using errcode = '54000';
  else
    update public.api_keys set window_calls = window_calls + 1, calls = calls + 1, last_used_at = now() where id = k.id;
  end if;
  perform app.act_as(k.run_as);
  return k;
end $$;

-- products: GET-like, paged by SKU (p_after) and optionally only those changed since a time
create or replace function public.api_products(p_key text default null, p_updated_since timestamptz default null, p_after text default null, p_limit int default 200)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare k public.api_keys; v_rows jsonb; v_lim int := least(greatest(coalesce(p_limit, 200), 1), 500);
begin
  k := app.api_open(p_key, 'catalog.read');
  perform app.require_permission(k.company_id, 'inventory.read');
  select coalesce(jsonb_agg(x order by x ->> 'sku'), '[]'::jsonb) into v_rows from (
    select jsonb_build_object('id', v.id, 'product_id', p.id, 'sku', v.sku, 'name', v.name, 'product_code', p.code, 'brand', p.brand,
             'category', pc.name, 'uom', u.code, 'price', coalesce(v.sales_price_override, p.sales_price), 'tax_rate', coalesce(t.rate, 0),
             'barcodes', coalesce((select jsonb_agg(b.barcode) from public.product_barcodes b where b.variant_id = v.id and b.deleted_at is null), '[]'::jsonb),
             'is_active', v.is_active and p.is_active and p.deleted_at is null and v.deleted_at is null, 'is_sellable', p.is_sellable,
             'updated_at', greatest(v.updated_at, p.updated_at)) x
      from public.product_variants v join public.products p on p.id = v.product_id
      left join public.product_categories pc on pc.id = p.category_id
      left join public.units_of_measure u on u.id = p.uom_id
      left join public.tax_codes t on t.id = p.sales_tax_code_id
     where v.company_id = k.company_id
       and (p_updated_since is null or greatest(v.updated_at, p.updated_at) > p_updated_since)
       and (p_after is null or v.sku > p_after)
       and (p_updated_since is not null or (v.deleted_at is null and p.deleted_at is null))
     order by v.sku limit v_lim) s;
  return jsonb_build_object('data', v_rows, 'next', case when jsonb_array_length(v_rows) = v_lim then v_rows -> -1 ->> 'sku' end);
end $$;

create or replace function public.api_stock(p_key text default null, p_skus text[] default null, p_warehouse text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare k public.api_keys;
begin
  k := app.api_open(p_key, 'catalog.read');
  perform app.require_permission(k.company_id, 'inventory.read');
  if coalesce(cardinality(p_skus), 0) > 1000 then raise exception 'At most 1,000 SKUs per call' using errcode = '54000'; end if;
  return jsonb_build_object('data', coalesce((select jsonb_agg(jsonb_build_object('sku', v.sku, 'warehouse', w.code, 'on_hand', s.on_hand, 'reserved', s.reserved,
             'available', s.available) order by v.sku, w.code)
      from (select sl.variant_id, sl.warehouse_id, sum(sl.on_hand) on_hand, sum(sl.reserved) reserved, sum(sl.available) available
              from public.stock_levels sl where sl.company_id = k.company_id group by 1, 2) s
      join public.product_variants v on v.id = s.variant_id join public.warehouses w on w.id = s.warehouse_id
     where (p_skus is null or v.sku = any (p_skus)) and (p_warehouse is null or w.code = p_warehouse) and w.deleted_at is null), '[]'::jsonb));
end $$;

-- the price a customer gets (their own price, their list, or the list price)
create or replace function public.api_prices(p_key text default null, p_partner_code text default null, p_skus text[] default null, p_quantity numeric default 1)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare k public.api_keys; bp public.business_partners; v_cur text;
begin
  k := app.api_open(p_key, 'catalog.read');
  perform app.require_permission(k.company_id, 'sales.read');
  if coalesce(cardinality(p_skus), 0) = 0 or cardinality(p_skus) > 500 then raise exception 'Send 1 to 500 SKUs' using errcode = '22023'; end if;
  if p_partner_code is not null then
    select * into bp from public.business_partners where company_id = k.company_id and code = p_partner_code and deleted_at is null;
    if bp.id is null then raise exception 'No customer with code %', p_partner_code using errcode = 'P0002'; end if;
  end if;
  v_cur := coalesce(bp.currency_code, (select base_currency from public.companies where id = k.company_id));
  return jsonb_build_object('currency', v_cur, 'data', coalesce((select jsonb_agg(jsonb_build_object('sku', v.sku, 'price', pr.unit_price, 'discount_pct', pr.discount_pct,
             'net', round(pr.unit_price * (1 - coalesce(pr.discount_pct, 0) / 100), 4), 'source', pr.source) order by v.sku)
      from public.product_variants v
      cross join lateral public.get_price(k.company_id, bp.id, v.id, coalesce(p_quantity, 1), current_date, bp.price_list_id, v_cur) pr
     where v.company_id = k.company_id and v.sku = any (p_skus) and v.deleted_at is null), '[]'::jsonb));
end $$;

create or replace function public.api_partners(p_key text default null, p_updated_since timestamptz default null, p_after text default null, p_limit int default 200)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare k public.api_keys; v_rows jsonb; v_lim int := least(greatest(coalesce(p_limit, 200), 1), 500);
begin
  k := app.api_open(p_key, 'partners.read');
  perform app.require_permission(k.company_id, 'partners.read');
  select coalesce(jsonb_agg(x order by x ->> 'code'), '[]'::jsonb) into v_rows from (
    select jsonb_build_object('id', bp.id, 'code', bp.code, 'name', bp.name, 'legal_name', bp.legal_name, 'tax_number', bp.tax_number, 'vat_number', bp.vat_number,
             'email', bp.email, 'phone', bp.phone, 'is_customer', bp.is_customer, 'is_vendor', bp.is_vendor, 'currency', bp.currency_code,
             'credit_limit', bp.credit_limit, 'owed', case when bp.is_customer then app.agent_owed(bp.id) end, 'is_active', bp.is_active and bp.deleted_at is null,
             'updated_at', bp.updated_at) x
      from public.business_partners bp
     where bp.company_id = k.company_id and bp.code is not null
       and (p_updated_since is null or bp.updated_at > p_updated_since) and (p_updated_since is not null or bp.deleted_at is null)
       and (p_after is null or bp.code > p_after)
     order by bp.code limit v_lim) s;
  return jsonb_build_object('data', v_rows, 'next', case when jsonb_array_length(v_rows) = v_lim then v_rows -> -1 ->> 'code' end);
end $$;

-- create or update customers/vendors by code (the same rules as the spreadsheet import)
create or replace function public.api_partner_upsert(p_key text default null, p_rows jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare k public.api_keys; v_res jsonb;
begin
  k := app.api_open(p_key, 'partners.write');
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 500 then
    raise exception 'Send 1 to 500 rows' using errcode = '22023';
  end if;
  v_res := public.import_rows(k.company_id, 'partners', p_rows, false);
  return jsonb_build_object('created', v_res -> 'created', 'updated', v_res -> 'updated', 'errors', v_res -> 'errors');
end $$;

-- p: {external_id, partner_code, lines: [{sku, quantity}], note, requested_date, reference, confirm}
create or replace function public.api_order_create(p_key text default null, p jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare k public.api_keys; bp public.business_partners; o public.sales_orders; v_ext text := nullif(btrim(p ->> 'external_id'), ''); v_doc uuid;
  l jsonb; v_n int := 0; v_var record; pr record; v_qty numeric; v_cur text; v_id uuid := gen_random_uuid(); v_why text;
begin
  k := app.api_open(p_key, 'orders.write');
  perform app.require_permission(k.company_id, 'sales.write');
  if v_ext is not null then
    select document_id into v_doc from public.api_external_refs where company_id = k.company_id and kind = 'sales_order' and external_id = v_ext;
    if v_doc is not null then
      select * into o from public.sales_orders where id = v_doc;
      return jsonb_build_object('id', o.id, 'number', o.number, 'status', o.status, 'total', o.total, 'currency', o.currency_code, 'replay', true);
    end if;
  end if;
  select * into bp from public.business_partners where company_id = k.company_id and code = p ->> 'partner_code' and deleted_at is null;
  if bp.id is null or not bp.is_customer then raise exception 'No customer with code %', coalesce(p ->> 'partner_code', '') using errcode = 'P0002'; end if;
  if jsonb_array_length(coalesce(p -> 'lines', '[]'::jsonb)) = 0 then raise exception 'Add at least one line before confirming' using errcode = '23514'; end if;
  if jsonb_array_length(p -> 'lines') > 500 then raise exception 'At most 500 lines in one order' using errcode = '54000'; end if;
  v_cur := coalesce(bp.currency_code, (select base_currency from public.companies where id = k.company_id));

  insert into public.sales_orders (id, company_id, partner_id, requested_date, warehouse_id, currency_code, price_list_id, payment_term_id,
                                   salesperson_id, channel, customer_reference, notes)
  values (v_id, k.company_id, bp.id, nullif(p ->> 'requested_date', '')::date,
          coalesce((select id from public.warehouses where company_id = k.company_id and code = p ->> 'warehouse' and deleted_at is null),
                   (select id from public.warehouses where company_id = k.company_id and deleted_at is null and is_active order by created_at limit 1)),
          v_cur, bp.price_list_id, bp.payment_term_id, bp.salesperson_id, 'api', left(coalesce(nullif(btrim(p ->> 'reference'), ''), v_ext), 80),
          left(nullif(btrim(p ->> 'note'), ''), 2000));
  for l in select * from jsonb_array_elements(p -> 'lines') loop
    v_qty := (l ->> 'quantity')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'Quantity must be more than zero' using errcode = '23514'; end if;
    select v.id, v.name, p2.uom_id into v_var from public.product_variants v join public.products p2 on p2.id = v.product_id
     where v.company_id = k.company_id and v.sku = l ->> 'sku' and v.deleted_at is null;
    if v_var.id is null then raise exception 'No product with SKU %', coalesce(l ->> 'sku', '') using errcode = 'P0002'; end if;
    select * into pr from public.get_price(k.company_id, bp.id, v_var.id, v_qty, current_date, bp.price_list_id, v_cur);
    v_n := v_n + 1;
    insert into public.sales_order_lines (company_id, sales_order_id, line_no, variant_id, description, quantity, uom_id, unit_price, discount_pct, tax_code_id)
    values (k.company_id, v_id, v_n, v_var.id, v_var.name, v_qty, v_var.uom_id, coalesce(pr.unit_price, 0), coalesce(pr.discount_pct, 0), pr.tax_code_id);
  end loop;
  if v_ext is not null then insert into public.api_external_refs (company_id, kind, external_id, document_id) values (k.company_id, 'sales_order', v_ext, v_id); end if;
  if coalesce((p ->> 'confirm')::boolean, false) then
    begin perform public.confirm_sales_order(v_id); exception when others then v_why := sqlerrm; end;
  end if;
  select * into o from public.sales_orders where id = v_id;
  return jsonb_build_object('id', o.id, 'number', o.number, 'status', o.status, 'total', o.total, 'currency', o.currency_code, 'not_confirmed', v_why);
end $$;

create or replace function public.api_order_get(p_key text default null, p_number text default null, p_external_id text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare k public.api_keys; o public.sales_orders;
begin
  k := app.api_open(p_key, 'orders.read');
  perform app.require_permission(k.company_id, 'sales.read');
  select * into o from public.sales_orders where company_id = k.company_id and deleted_at is null
     and (number = p_number or id = (select document_id from public.api_external_refs where company_id = k.company_id and kind = 'sales_order' and external_id = p_external_id));
  if o.id is null then raise exception 'Order not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('id', o.id, 'number', o.number, 'status', o.status, 'invoice_status', o.invoice_status, 'date', o.order_date,
    'partner_code', (select code from public.business_partners where id = o.partner_id), 'currency', o.currency_code,
    'subtotal', o.subtotal, 'tax', o.tax_total, 'total', o.total,
    'lines', (select jsonb_agg(jsonb_build_object('sku', v.sku, 'name', l.description, 'quantity', l.quantity, 'delivered', l.qty_delivered,
               'invoiced', l.qty_invoiced, 'unit_price', l.unit_price, 'discount_pct', l.discount_pct, 'total', l.line_total) order by l.line_no)
                from public.sales_order_lines l left join public.product_variants v on v.id = l.variant_id where l.sales_order_id = o.id),
    'invoices', (select jsonb_agg(i.number order by i.number) from public.sales_invoices i where i.sales_order_id = o.id and i.status = 'posted'));
end $$;

create or replace function public.api_invoices(p_key text default null, p_since date default null, p_partner_code text default null, p_after text default null, p_limit int default 200)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare k public.api_keys; v_rows jsonb; v_lim int := least(greatest(coalesce(p_limit, 200), 1), 500);
begin
  k := app.api_open(p_key, 'invoices.read');
  perform app.require_permission(k.company_id, 'invoicing.read');
  select coalesce(jsonb_agg(x order by x ->> 'number'), '[]'::jsonb) into v_rows from (
    select jsonb_build_object('id', i.id, 'number', i.number, 'type', i.document_type, 'date', i.invoice_date, 'due', i.due_date,
             'partner_code', bp.code, 'partner', bp.name, 'currency', i.currency_code, 'subtotal', i.subtotal, 'tax', i.tax_total, 'total', i.total,
             'paid', i.amount_paid, 'open', i.amount_due, 'payment_status', i.payment_status,
             'order', (select o.number from public.sales_orders o where o.id = i.sales_order_id)) x
      from public.sales_invoices i join public.business_partners bp on bp.id = i.partner_id
     where i.company_id = k.company_id and i.status = 'posted' and i.deleted_at is null
       and (p_since is null or i.invoice_date >= p_since) and (p_partner_code is null or bp.code = p_partner_code)
       and (p_after is null or i.number > p_after)
     order by i.number limit v_lim) s;
  return jsonb_build_object('data', v_rows, 'next', case when jsonb_array_length(v_rows) = v_lim then v_rows -> -1 ->> 'number' end);
end $$;

-- =============================================================================
revoke execute on function public.portal_link_create(uuid, jsonb), public.portal_link_set(uuid, jsonb), public.portal_settings_save(uuid, boolean, text),
  public.portal_home(text, text), public.portal_catalog(text, text, text, uuid, int), public.portal_images(text, text, uuid[]),
  public.portal_order(text, text, jsonb), public.portal_document(text, text, text, uuid),
  public.api_key_create(uuid, text, text[]), public.api_key_set_active(uuid, boolean),
  public.api_products(text, timestamptz, text, int), public.api_stock(text, text[], text), public.api_prices(text, text, text[], numeric),
  public.api_partners(text, timestamptz, text, int), public.api_partner_upsert(text, jsonb), public.api_order_create(text, jsonb),
  public.api_order_get(text, text, text), public.api_invoices(text, date, text, text, int) from public;
grant execute on function public.portal_link_create(uuid, jsonb), public.portal_link_set(uuid, jsonb), public.portal_settings_save(uuid, boolean, text),
  public.api_key_create(uuid, text, text[]), public.api_key_set_active(uuid, boolean) to authenticated;
grant execute on function public.portal_home(text, text), public.portal_catalog(text, text, text, uuid, int), public.portal_images(text, text, uuid[]),
  public.portal_order(text, text, jsonb), public.portal_document(text, text, text, uuid),
  public.api_products(text, timestamptz, text, int), public.api_stock(text, text[], text), public.api_prices(text, text, text[], numeric),
  public.api_partners(text, timestamptz, text, int), public.api_partner_upsert(text, jsonb), public.api_order_create(text, jsonb),
  public.api_order_get(text, text, text), public.api_invoices(text, date, text, text, int) to anon, authenticated;
