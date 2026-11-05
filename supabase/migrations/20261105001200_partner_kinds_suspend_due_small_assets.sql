-- =============================================================================
-- From the meeting with the administrative staff:
--   #13 the kind of a supplier (goods, expenses, investments; one or more), filled from its
--       invoices as they are posted, and the partner cards filtered by it
--   #5  suspending and deleting an item: an item with stock history is never deleted (it is
--       suspended); a suspended item is neither bought nor sold, and stays in reports and history
--   #1  the debts by due date: every open invoice and bill, week by week, by unit
--   #3  the small inventory: things the company owns and does not sell (without depreciation),
--       where each one is and who has it, with a barcode for the yearly count
-- =============================================================================

-- ---------------------------------------------------------------- 13. the kind of a supplier
alter table public.business_partners add column if not exists vendor_kinds text[] not null default '{}';
alter table public.business_partners drop constraint if exists business_partners_vendor_kinds_check;
alter table public.business_partners add constraint business_partners_vendor_kinds_check
  check (vendor_kinds <@ array['goods', 'expenses', 'investments']::text[]);

-- what a bill says about its supplier: stock items → goods; a fixed-asset account → investments;
-- an expense account without stock items → expenses
create or replace function app.bill_kinds(p_bill uuid)
returns text[] language sql stable security definer set search_path = '' as $$
  select array_remove(array[
    case when exists (select 1 from public.vendor_bill_lines l join public.product_variants v on v.id = l.variant_id join public.products p on p.id = v.product_id
                       where l.bill_id = p_bill and p.product_type = 'stockable') then 'goods' end,
    case when exists (select 1 from public.vendor_bill_lines l join public.accounts a on a.id = l.account_id
                       where l.bill_id = p_bill and a.account_type = 'asset' and a.account_subtype in ('fixed_asset', 'fixed_assets', 'non_current_asset')) then 'investments' end,
    case when exists (select 1 from public.vendor_bill_lines l join public.accounts a on a.id = l.account_id
                       where l.bill_id = p_bill and a.account_type = 'expense')
          and not exists (select 1 from public.vendor_bill_lines l join public.product_variants v on v.id = l.variant_id join public.products p on p.id = v.product_id
                           where l.bill_id = p_bill and p.product_type = 'stockable') then 'expenses' end], null)
$$;
revoke execute on function app.bill_kinds(uuid) from public, anon, authenticated;

create or replace function app.tg_bill_vendor_kinds()
returns trigger language plpgsql security definer set search_path = '' as $$
declare k text[];
begin
  if new.status = 'posted' and old.status is distinct from 'posted' and new.document_type = 'vendor_bill' then
    k := app.bill_kinds(new.id);
    if cardinality(k) > 0 then
      update public.business_partners set vendor_kinds = array(select distinct x from unnest(vendor_kinds || k) x order by x)
       where id = new.vendor_id and not (vendor_kinds @> k);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists trg_80_vendor_kinds on public.vendor_bills;
create trigger trg_80_vendor_kinds after update of status on public.vendor_bills for each row execute function app.tg_bill_vendor_kinds();

-- what is already in the books
update public.business_partners bp set vendor_kinds = k.kinds
  from (select b.vendor_id, array(select distinct x from unnest(array_agg_kinds) x order by x) as kinds
          from (select vendor_id, array_agg(kk) as array_agg_kinds
                  from public.vendor_bills b2, unnest(app.bill_kinds(b2.id)) kk
                 where b2.status = 'posted' and b2.document_type = 'vendor_bill' and b2.deleted_at is null
                 group by vendor_id) b) k
 where bp.id = k.vendor_id and bp.vendor_kinds = '{}';

-- the partner cards: the kinds next to the groups
create or replace function public.partner_balances(p_company uuid, p_side text, p_date date default current_date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_rows jsonb;
begin
  perform app.require_permission(p_company, 'invoicing.read');
  if p_side not in ('customer', 'vendor') then raise exception 'Choose customer or supplier side' using errcode = '22023'; end if;
  with acc as (
    select a.id from public.accounts a where a.company_id = p_company and a.deleted_at is null
       and a.account_subtype = case when p_side = 'vendor' then 'payable' else 'receivable' end
    union select app.acct(p_company, case when p_side = 'vendor' then 'vendor_advances' else 'customer_advances' end)
    union select case when p_side = 'vendor' then bp.payable_account_id else bp.receivable_account_id end from public.business_partners bp where bp.company_id = p_company),
  bal as (
    select jl.partner_id, sum(jl.debit - jl.credit) as b
      from public.journal_lines jl join public.journal_entries e on e.id = jl.entry_id
     where jl.company_id = p_company and jl.partner_id is not null and jl.account_id in (select id from acc where id is not null)
       and e.status in ('posted', 'reversed') and e.entry_date <= p_date
     group by jl.partner_id),
  late as (
    select partner_id, sum(amount_due) as late from public.sales_invoices
     where p_side = 'customer' and company_id = p_company and status = 'posted' and deleted_at is null and document_type <> 'credit_note' and due_date < p_date and amount_due > 0
     group by partner_id
    union all
    select vendor_id, sum(amount_due) from public.vendor_bills
     where p_side = 'vendor' and company_id = p_company and status = 'posted' and deleted_at is null and document_type <> 'vendor_credit' and due_date < p_date and amount_due > 0
     group by vendor_id)
  select coalesce(jsonb_agg(jsonb_build_object('id', bp.id, 'name', bp.name, 'code', bp.code, 'tax_number', bp.tax_number, 'groups', coalesce(to_jsonb(bp.tags), '[]'),
           'kinds', to_jsonb(bp.vendor_kinds),
           'balance', round(case when p_side = 'vendor' then -coalesce(bal.b, 0) else coalesce(bal.b, 0) end, 2),
           'late', round(coalesce(late.late, 0), 2), 'credit_limit', bp.credit_limit) order by bp.name), '[]') into v_rows
    from public.business_partners bp left join bal on bal.partner_id = bp.id left join late on late.partner_id = bp.id
   where bp.company_id = p_company and bp.deleted_at is null and (case when p_side = 'vendor' then bp.is_vendor else bp.is_customer end)
     and (abs(coalesce(bal.b, 0)) >= 0.005 or bp.is_active);
  return jsonb_build_object('side', p_side, 'date', p_date, 'rows', v_rows, 'currency', (select base_currency from public.companies where id = p_company));
end $$;
revoke execute on function public.partner_balances(uuid, text, date) from public, anon;
grant execute on function public.partner_balances(uuid, text, date) to authenticated;

-- ---------------------------------------------------------------- 5. suspending and deleting an item
-- an item that ever moved in stock is not deleted: its history stays readable; it is suspended
create or replace function app.tg_product_delete_rule()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.deleted_at is null and new.deleted_at is not null
     and exists (select 1 from public.stock_movements m join public.product_variants v on v.id = m.variant_id where v.product_id = new.id limit 1) then
    raise exception '% has stock history: suspend it instead of deleting it', new.name using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists trg_05_delete_rule on public.products;
create trigger trg_05_delete_rule before update of deleted_at on public.products for each row execute function app.tg_product_delete_rule();

-- a suspended item is not put on a new purchase or sale (returns and credit notes still can)
create or replace function app.tg_line_item_active()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_name text; v_ok boolean;
begin
  if new.variant_id is null then return new; end if;
  select v.name, v.is_active and p.is_active into v_name, v_ok
    from public.product_variants v join public.products p on p.id = v.product_id where v.id = new.variant_id;
  if v_ok then return new; end if;
  if tg_table_name = 'vendor_bill_lines' then
    if coalesce(new.is_return, false) or exists (select 1 from public.vendor_bills b where b.id = new.bill_id and (b.document_type <> 'vendor_bill' or b.is_opening)) then return new; end if;
  elsif tg_table_name = 'sales_invoice_lines' then
    if exists (select 1 from public.sales_invoices i where i.id = new.invoice_id and i.document_type <> 'sales_invoice') then return new; end if;
  end if;
  raise exception '% is suspended: it is neither bought nor sold', v_name using errcode = '23514';
end $$;
revoke execute on function app.tg_line_item_active() from public, anon, authenticated;
drop trigger if exists trg_06_item_active on public.purchase_order_lines;
create trigger trg_06_item_active before insert on public.purchase_order_lines for each row execute function app.tg_line_item_active();
drop trigger if exists trg_06_item_active on public.vendor_bill_lines;
create trigger trg_06_item_active before insert on public.vendor_bill_lines for each row execute function app.tg_line_item_active();
drop trigger if exists trg_06_item_active on public.sales_order_lines;
create trigger trg_06_item_active before insert on public.sales_order_lines for each row execute function app.tg_line_item_active();
drop trigger if exists trg_06_item_active on public.sales_invoice_lines;
create trigger trg_06_item_active before insert on public.sales_invoice_lines for each row execute function app.tg_line_item_active();

-- ---------------------------------------------------------------- 1. the debts by due date
-- every open invoice (ar) or bill (ap) with its due date; p: as_of, units[] (bills only), kinds[] (suppliers)
create or replace function public.debts_by_due(p_company uuid, p_kind text, p jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_as_of date := coalesce((p ->> 'as_of')::date, (now() at time zone coalesce((select timezone from public.companies where id = p_company), 'Europe/Tirane'))::date);
  v_units uuid[] := array(select jsonb_array_elements_text(coalesce(p -> 'units', '[]'))::uuid);
  v_kinds text[] := array(select jsonb_array_elements_text(coalesce(p -> 'kinds', '[]')));
begin
  perform app.require_permission(p_company, 'invoicing.read');
  if p_kind not in ('ar', 'ap') then raise exception 'Choose customers or suppliers' using errcode = '22023'; end if;
  return jsonb_build_object('as_of', v_as_of, 'currency', (select base_currency from public.companies where id = p_company), 'rows', coalesce((
    select jsonb_agg(x order by x ->> 'due_date', x ->> 'partner') from (
      select jsonb_build_object('id', i.id, 'number', i.number, 'ref', null, 'partner_id', i.partner_id, 'partner', bp.name,
               'date', i.invoice_date, 'due_date', coalesce(i.due_date, i.invoice_date), 'days', coalesce(i.due_date, i.invoice_date) - v_as_of,
               'total', i.total, 'due', i.amount_due, 'unit', null, 'href', '/sales/invoices/' || i.id) as x
        from public.sales_invoices i join public.business_partners bp on bp.id = i.partner_id
       where p_kind = 'ar' and i.company_id = p_company and i.status = 'posted' and i.deleted_at is null
         and i.document_type <> 'credit_note' and i.amount_due > 0.004
      union all
      select jsonb_build_object('id', b.id, 'number', b.number, 'ref', b.vendor_invoice_number, 'partner_id', b.vendor_id, 'partner', bp.name,
               'date', b.bill_date, 'due_date', coalesce(b.due_date, b.bill_date), 'days', coalesce(b.due_date, b.bill_date) - v_as_of,
               'total', b.total, 'due', b.amount_due, 'unit', w.name, 'unit_id', w.id, 'kinds', to_jsonb(bp.vendor_kinds), 'href', '/procurement/invoice/' || b.id)
        from public.vendor_bills b join public.business_partners bp on bp.id = b.vendor_id left join public.warehouses w on w.id = b.warehouse_id
       where p_kind = 'ap' and b.company_id = p_company and b.status = 'posted' and b.deleted_at is null
         and b.document_type <> 'vendor_credit' and b.amount_due > 0.004
         and (cardinality(v_units) = 0 or b.warehouse_id = any (v_units))
         and (cardinality(v_kinds) = 0 or bp.vendor_kinds && v_kinds)) q), '[]'::jsonb));
end $$;
revoke execute on function public.debts_by_due(uuid, text, jsonb) from public, anon;
grant execute on function public.debts_by_due(uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------- 3. the small inventory
create table if not exists public.small_assets (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id),
  code         text not null,
  name         text not null,
  category     text,
  warehouse_id uuid,
  holder_id    uuid references auth.users(id),
  quantity     numeric(12,2) not null default 1 check (quantity > 0),
  unit_value   numeric(18,2) not null default 0 check (unit_value >= 0),
  acquired_on  date,
  serial_no    text,
  status       text not null default 'in_use' check (status in ('in_use', 'in_store', 'broken', 'written_off')),
  notes        text,
  counted_at   timestamptz,
  counted_by   uuid references auth.users(id),
  foreign key (company_id, warehouse_id) references public.warehouses(company_id, id),
  unique (company_id, code)
);
select app.register_table('public.small_assets', 'finance');
create index if not exists small_assets_company_idx on public.small_assets (company_id, warehouse_id) where deleted_at is null;

-- the next code: INV-00001…
create or replace function app.tg_small_asset_code()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(btrim(new.code), '') = '' then
    perform pg_advisory_xact_lock(hashtext('small_assets:' || new.company_id));
    new.code := 'INV-' || lpad((coalesce((select max(substring(code from '^INV-(\d+)$')::int) from public.small_assets where company_id = new.company_id), 0) + 1)::text, 5, '0');
  end if;
  new.code := upper(btrim(new.code));
  return new;
end $$;
drop trigger if exists trg_03_code on public.small_assets;
create trigger trg_03_code before insert on public.small_assets for each row execute function app.tg_small_asset_code();

-- the yearly count: a scanned code is marked as seen today, where it was found
create or replace function public.small_asset_count(p_company uuid, p_code text, p_warehouse uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.small_assets;
begin
  if not (app.has_permission(p_company, 'finance.write') or app.has_permission(p_company, 'inventory.write') or app.has_permission(p_company, 'wms.write')) then
    raise exception 'Permission denied' using errcode = '42501';
  end if;
  select * into a from public.small_assets where company_id = p_company and code = upper(btrim(p_code)) and deleted_at is null;
  if a.id is null then return jsonb_build_object('found', false); end if;
  update public.small_assets set counted_at = now(), counted_by = auth.uid(),
         warehouse_id = coalesce(p_warehouse, warehouse_id)
   where id = a.id;
  return jsonb_build_object('found', true, 'id', a.id, 'name', a.name, 'moved', p_warehouse is not null and p_warehouse is distinct from a.warehouse_id,
                            'from', (select name from public.warehouses where id = a.warehouse_id));
end $$;
revoke execute on function public.small_asset_count(uuid, text, uuid) from public, anon;
grant execute on function public.small_asset_count(uuid, text, uuid) to authenticated;
