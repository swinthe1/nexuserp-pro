-- =============================================================================
-- #14 again: the discount for a short date goes through the price calculation. The proposal shows the cost,
-- the price and the margin before and after (the screen works it out with price_level_items); once the
-- manager approves it, it is written as a price levelling of that unit, valid until the expiry date, and
-- the day after that date a second levelling brings the price back. The till keeps selling at the discount
-- through the promotion of that unit, so the price of the other units does not change.
-- =============================================================================

alter table public.price_levels
  add column if not exists source      text not null default 'manual' check (source in ('manual', 'expiry', 'expiry_end')),
  add column if not exists valid_until date,
  add column if not exists markdown_id uuid references public.expiry_markdowns (id);

alter table public.expiry_markdowns
  add column if not exists level_id     uuid references public.price_levels (id),
  add column if not exists end_level_id uuid references public.price_levels (id);

-- one levelling document of one line for a markdown: 'expiry' when it is approved, 'expiry_end' after the date
create or replace function app.expiry_level(p_markdown uuid, p_source text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare em public.expiry_markdowns; v_today date; v_price numeric; v_rate numeric; v_new numeric; v_old numeric; v_qty numeric; v_id uuid;
begin
  select * into em from public.expiry_markdowns where id = p_markdown;
  if em.id is null then return null; end if;
  v_today := (now() at time zone coalesce((select timezone from public.companies where id = em.company_id), 'Europe/Tirane'))::date;
  select coalesce(v.sales_price_override, p.sales_price, 0), coalesce(tc.rate, 0) into v_price, v_rate
    from public.product_variants v join public.products p on p.id = v.product_id
    left join public.tax_codes tc on tc.id = p.sales_tax_code_id
   where v.id = em.variant_id;
  if p_source = 'expiry' then
    v_old := v_price;
    v_new := round(v_price * (1 - em.discount_pct / 100), 4);
    v_qty := em.quantity;
  else
    -- back to the regular price, for what is still on the shelf of that unit
    v_old := round(v_price * (1 - em.discount_pct / 100), 4);
    v_new := v_price;
    v_qty := least(em.quantity, coalesce((select sum(on_hand) from public.stock_levels
                                           where variant_id = em.variant_id and warehouse_id = em.warehouse_id
                                             and (em.lot_id is null or lot_id = em.lot_id)), 0));
    v_qty := greatest(v_qty, 0);
  end if;
  insert into public.price_levels (company_id, level_date, warehouse_id, source, valid_until, markdown_id, status)
  values (em.company_id, v_today, em.warehouse_id, p_source, case when p_source = 'expiry' then em.expiry_date end, em.id, 'draft')
  returning id into v_id;
  insert into public.price_level_lines (company_id, level_id, line_no, variant_id, old_price, new_price, quantity, value_change)
  values (em.company_id, v_id, 1, em.variant_id, v_old, v_new, v_qty, round(v_qty * (v_new - v_old) * (1 + v_rate / 100), 2));
  update public.price_levels set status = 'posted', posted_at = now(), posted_by = auth.uid(),
         value_change = round(v_qty * (v_new - v_old) * (1 + v_rate / 100), 2)
   where id = v_id;
  if p_source = 'expiry' then update public.expiry_markdowns set level_id = v_id where id = em.id;
  else update public.expiry_markdowns set end_level_id = v_id where id = em.id; end if;
  return v_id;
end $$;
revoke execute on function app.expiry_level(uuid, text) from public, anon, authenticated;

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_def text; v_oid oid;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname || '.' || p.proname = p_name order by p.oid desc limit 1;
  if v_oid is null then raise exception 'function % not found', p_name; end if;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply', p_name; end if;
  execute replace(v_def, p_old, p_new);
end $$;

-- approved: the levelling of that unit is written at once
select app._patch_function('public.expiry_decide',
  $x$         decided_by = auth.uid(), decided_at = now(), note = coalesce(nullif(btrim(p_note), ''), note)
   where id = em.id;
  if em.proposed_by$x$,
  $x$         decided_by = auth.uid(), decided_at = now(), note = coalesce(nullif(btrim(p_note), ''), note)
   where id = em.id;
  perform app.expiry_level(em.id, 'expiry');
  if em.proposed_by$x$);

-- the list shows the levelling of each discount
select app._patch_function('public.expiry_overview',
  $x$                 'adjustment_number', (select number from public.stock_adjustments where id = em.adjustment_id),$x$,
  $x$                 'adjustment_number', (select number from public.stock_adjustments where id = em.adjustment_id),
                 'level_id', em.level_id, 'level_number', (select number from public.price_levels where id = em.level_id),
                 'end_level_id', em.end_level_id, 'end_level_number', (select number from public.price_levels where id = em.end_level_id),$x$);

drop function app._patch_function(text, text, text);

-- the day after the date: the price goes back, with its own levelling
create or replace function app.expiry_levels_daily()
returns int language plpgsql security definer set search_path = '' as $$
declare em record; n int := 0;
begin
  for em in select m.id from public.expiry_markdowns m
             where m.level_id is not null and m.end_level_id is null
               and m.expiry_date < (now() at time zone coalesce((select timezone from public.companies where id = m.company_id), 'Europe/Tirane'))::date
  loop
    perform app.expiry_level(em.id, 'expiry_end');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function app.expiry_levels_daily() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('drispro-expiry-levels', '25 0 * * *', 'select app.expiry_levels_daily()');
  end if;
exception when others then
  raise notice 'pg_cron not available (%); schedule app.expiry_levels_daily() externally', sqlerrm;
end $$;

-- what waits for the manager, for the levelling page
create or replace function public.expiry_markdowns_waiting(p_company uuid)
returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.expiry_markdowns
   where company_id = p_company and status = 'proposed'
     and p_company = any ((select app.company_ids_with('inventory.read'))::uuid[])
$$;
revoke execute on function public.expiry_markdowns_waiting(uuid) from public, anon;
grant execute on function public.expiry_markdowns_waiting(uuid) to authenticated;
