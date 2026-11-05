-- =============================================================================
-- The deep check, phase 2: the shortest shelf life accepted at receiving. A shop does not take yoghurt
-- that expires in three days. Each item can say how many days it must still have when it comes in (else
-- the company's default, else no check). Goods shorter than that are refused at receiving (a lot scanned
-- in the warehouse, a purchase invoice completed with its expiry dates); a manager can still accept them.
-- =============================================================================

alter table public.products add column if not exists min_shelf_days smallint check (min_shelf_days is null or min_shelf_days between 1 and 3650);
alter table public.company_settings add column if not exists min_shelf_days smallint check (min_shelf_days is null or min_shelf_days between 1 and 3650);

-- the days an item must still have, when its expiry is shorter than that (else null)
create or replace function app.shelf_short(p_variant uuid, p_expiry date, p_on date)
returns int language sql stable security definer set search_path = '' as $$
  select x.need from (
    select coalesce(p.min_shelf_days, cs.min_shelf_days)::int as need
      from public.product_variants v join public.products p on p.id = v.product_id
      left join public.company_settings cs on cs.company_id = v.company_id
     where v.id = p_variant) x
   where p_expiry is not null and x.need is not null and p_expiry - coalesce(p_on, current_date) < x.need
$$;

-- a purchase invoice with expiry dates: checked when it is completed
create or replace function app.tg_bill_shelf_life()
returns trigger language plpgsql security definer set search_path = '' as $$
declare l record; v_need int;
begin
  if new.status <> 'posted' or old.status = 'posted' or new.document_type <> 'vendor_bill' then return new; end if;
  if auth.uid() is null or app.has_permission(new.company_id, 'procurement.approve') then return new; end if;
  for l in select bl.line_no, bl.variant_id, bl.expiry_date, coalesce(bl.description, v.name) as name
             from public.vendor_bill_lines bl join public.product_variants v on v.id = bl.variant_id
            where bl.bill_id = new.id and bl.expiry_date is not null order by bl.line_no loop
    v_need := app.shelf_short(l.variant_id, l.expiry_date, coalesce(new.receive_date, new.bill_date));
    if v_need is not null then
      raise exception 'Line %: % expires on %, % days from receiving; it must have at least %. A purchasing manager can accept it.',
        l.line_no, l.name, to_char(l.expiry_date, 'DD.MM.YYYY'), l.expiry_date - coalesce(new.receive_date, new.bill_date), v_need using errcode = '23514';
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists trg_05_shelf_life on public.vendor_bills;
create trigger trg_05_shelf_life before update of status on public.vendor_bills
  for each row execute function app.tg_bill_shelf_life();

-- a new lot scanned in at receiving
create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_def text; v_oid oid;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname || '.' || p.proname = p_name order by p.oid desc limit 1;
  if v_oid is null then raise exception 'function % not found', p_name; end if;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, left(p_old, 60); end if;
  execute replace(v_def, p_old, p_new);
end $$;
select app._patch_function('public.ensure_lot',
  $x$  if v_id is null then
    insert into public.lots$x$,
  $x$  if v_id is null and app.shelf_short(p_variant, p_expiry, current_date) is not null
     and not (app.has_permission(v_company, 'wms.approve') or app.has_permission(v_company, 'procurement.approve')) then
    raise exception 'Lot % expires on %, % days from today; this item must have at least % when it comes in. A manager can accept it.',
      btrim(p_lot_number), to_char(p_expiry, 'DD.MM.YYYY'), p_expiry - current_date, app.shelf_short(p_variant, p_expiry, current_date) using errcode = '23514';
  end if;
  if v_id is null then
    insert into public.lots$x$);

-- the company's default, kept with the other automatic checks
select app._patch_function('public.automation_settings_save',
  $x$  if p_patch ? 'purchase_price_tolerance' then$x$,
  $x$  if p_patch ? 'min_shelf_days' then perform app.require_permission(p_company, 'procurement.approve'); end if;
  if p_patch ? 'purchase_price_tolerance' then$x$);
select app._patch_function('public.automation_settings_save',
  $x$    purchase_price_tolerance = coalesce((p_patch ->> 'purchase_price_tolerance')::numeric, purchase_price_tolerance),$x$,
  $x$    purchase_price_tolerance = coalesce((p_patch ->> 'purchase_price_tolerance')::numeric, purchase_price_tolerance),
    min_shelf_days = case when p_patch ? 'min_shelf_days' then nullif(p_patch ->> 'min_shelf_days', '')::smallint else min_shelf_days end,$x$);
drop function app._patch_function(text, text, text);
