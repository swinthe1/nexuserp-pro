-- =============================================================================
-- DrisPRO · the till, step 2: the market's till
--   · a market has 20 000 items and more: its till shows no tiles. The cashier scans, or types a name,
--     a code or a barcode, and the items closest to it come back (on the device, and on the server:
--     public.pos_search, the same forgiving rules as the rest of the program)
--   · up to 24 quick buttons per till, chosen by the manager; without them, what sells most at this till
--   · the café and the bakery keep their tiles (pos_registers.screen: auto / search / tiles)
--   · the device keeps a light copy of the items: only what changed is read again when a till opens
--     during the day, the stock at this till included
--   · the till locks: by itself after some minutes without use (a company setting), or with a button.
--     The cashier opens it with her PIN, or a manager with theirs (pos_unlock, pos_approve 'unlock')
-- =============================================================================

-- ----------------------------------------------------------------------------- the till's screen and its quick buttons
alter table public.pos_registers add column if not exists screen text not null default 'auto';
alter table public.pos_registers drop constraint if exists pos_registers_screen_check;
alter table public.pos_registers add constraint pos_registers_screen_check check (screen in ('auto', 'search', 'tiles'));
alter table public.pos_registers add column if not exists quick_items uuid[] not null default '{}';
alter table public.pos_registers drop constraint if exists pos_registers_quick_items_check;
alter table public.pos_registers add constraint pos_registers_quick_items_check check (cardinality(quick_items) <= 24);
comment on column public.pos_registers.screen is 'auto: tiles for a café or restaurant company, search for the others; search: no tiles (a market); tiles: items by category';
comment on column public.pos_registers.quick_items is 'up to 24 items shown as buttons on the till, in this order';

-- ----------------------------------------------------------------------------- the lock
alter table public.company_settings add column if not exists pos_lock_minutes int not null default 0;
alter table public.company_settings drop constraint if exists company_settings_pos_lock_minutes_check;
alter table public.company_settings add constraint company_settings_pos_lock_minutes_check check (pos_lock_minutes between 0 and 120);
comment on column public.company_settings.pos_lock_minutes is 'minutes without use before the till locks itself (0 = it does not)';

alter table app.pos_approvals drop constraint if exists pos_approvals_purpose_check;
alter table app.pos_approvals add constraint pos_approvals_purpose_check check (purpose in ('void', 'close', 'payout', 'refund', 'unlock'));

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

-- a manager can open a locked till
select app._patch_function('public.pos_approve',
  $x$if p_purpose not in ('void', 'close', 'payout', 'refund') then$x$,
  $x$if p_purpose not in ('void', 'close', 'payout', 'refund', 'unlock') then$x$);

-- the till's options: when it locks
select app._patch_function('public.pos_till_options',
  $x$'void_notify', coalesce((select pos_void_notify from public.company_settings where company_id = v_co), false));$x$,
  $x$'void_notify', coalesce((select pos_void_notify from public.company_settings where company_id = v_co), false),
    'lock_minutes', coalesce((select pos_lock_minutes from public.company_settings where company_id = v_co), 0));$x$);

-- saved with the other till settings, by a manager
select app._patch_function('public.automation_settings_save',
  $x$'pos_review', 'pos_review_hours', 'pos_blind_count',$x$,
  $x$'pos_review', 'pos_review_hours', 'pos_blind_count', 'pos_lock_minutes',$x$);
select app._patch_function('public.automation_settings_save',
  $x$    pos_blind_count = coalesce((p_patch ->> 'pos_blind_count')::boolean, pos_blind_count),$x$,
  $x$    pos_blind_count = coalesce((p_patch ->> 'pos_blind_count')::boolean, pos_blind_count),
    pos_lock_minutes = coalesce((p_patch ->> 'pos_lock_minutes')::int, pos_lock_minutes),$x$);

-- what changed since the till last looked: the stock at this till too (other tills, receipts, transfers)
select app._patch_function('public.pos_catalog_changes',
  $x$    select pp.variant_id from public.partner_prices pp where pp.company_id = r.company_id and pp.partner_id = r.default_customer_id and pp.updated_at > p_since
  ) x$x$,
  $x$    select pp.variant_id from public.partner_prices pp where pp.company_id = r.company_id and pp.partner_id = r.default_customer_id and pp.updated_at > p_since
    union all
    select sl.variant_id from public.stock_levels sl where sl.company_id = r.company_id and sl.location_id = r.location_id and sl.updated_at > p_since
  ) x$x$);

drop function app._patch_function(text, text, text);

-- ----------------------------------------------------------------------------- search on the server
-- the items of this till closest to what the cashier typed or scanned, best first, with the till's price
-- and stock. A code or barcode typed whole comes first; then the names (typos, ë/ç, words in any order).
create or replace function public.pos_search(p_register uuid, p_q text, p_limit integer default 20)
returns table (variant_id uuid, sku text, name text, category text, barcodes jsonb, price numeric, tax_code_id uuid, tax_rate numeric,
               tracking text, on_hand numeric, image_path text, product_type text, uom text, scale_plu text, score integer)
language plpgsql stable security definer set search_path = '' as $$
declare r public.pos_registers; v_ids uuid[]; v_scores int[]; v_lim int := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  select * into r from public.pos_registers where id = p_register;
  if r.id is null then raise exception 'Register not found' using errcode = 'P0002'; end if;
  perform app.require_permission(r.company_id, 'pos.read');
  if length(btrim(coalesce(p_q, ''))) = 0 then return; end if;
  -- the closest few hundred of the company's items; the till's price only for those
  select array_agg(f.variant_id order by f.score desc), array_agg(f.score order by f.score desc) into v_ids, v_scores
    from (select x.variant_id, x.score from app.fuzzy_variants(r.company_id, left(p_q, 120)) x order by x.score desc limit 300) f;
  if v_ids is null then return; end if;
  return query
    select c.variant_id, c.sku, c.name, c.category, c.barcodes, c.price, c.tax_code_id, c.tax_rate, c.tracking, c.on_hand,
           c.image_path, c.product_type, c.uom, c.scale_plu, s.score
      from public.pos_catalog_part(p_register, v_ids) c
      join unnest(v_ids, v_scores) s(id, score) on s.id = c.variant_id
     order by s.score desc, c.name
     limit v_lim;
end $$;
revoke execute on function public.pos_search(uuid, text, integer) from public, anon;
grant execute on function public.pos_search(uuid, text, integer) to authenticated;

-- ----------------------------------------------------------------------------- quick buttons
-- the manager's choice for this till, and (when there is none) what sells most here in the last 30 days
create or replace function public.pos_quick_items(p_register uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.pos_registers;
begin
  select * into r from public.pos_registers where id = p_register;
  if r.id is null then raise exception 'Register not found' using errcode = 'P0002'; end if;
  perform app.require_permission(r.company_id, 'pos.read');
  return jsonb_build_object(
    'pinned', to_jsonb(r.quick_items),
    'top', coalesce((select jsonb_agg(t.variant_id order by t.n desc) from (
              select l.variant_id, count(*) as n
                from public.pos_order_lines l join public.pos_orders o on o.id = l.pos_order_id
               where o.register_id = r.id and o.status = 'paid' and not o.is_refund and o.order_at > now() - interval '30 days'
                 and l.variant_id is not null
               group by l.variant_id order by count(*) desc limit 24) t), '[]'::jsonb));
end $$;
revoke execute on function public.pos_quick_items(uuid) from public, anon;
grant execute on function public.pos_quick_items(uuid) to authenticated;

create or replace function public.pos_quick_items_set(p_register uuid, p_items uuid[])
returns uuid[] language plpgsql security definer set search_path = '' as $$
declare r public.pos_registers; v_items uuid[];
begin
  select * into r from public.pos_registers where id = p_register;
  if r.id is null then raise exception 'Register not found' using errcode = 'P0002'; end if;
  perform app.require_permission(r.company_id, 'pos.approve');
  -- once each, in the order given, only this company's items
  select coalesce(array_agg(x.id order by x.ord), '{}') into v_items
    from (select distinct on (i.id) i.id, i.ord from unnest(coalesce(p_items, '{}')) with ordinality i(id, ord)
            join public.product_variants v on v.id = i.id and v.company_id = r.company_id and v.deleted_at is null
           order by i.id, i.ord) x;
  if cardinality(v_items) > 24 then raise exception 'A till has at most 24 quick buttons' using errcode = '22023'; end if;
  update public.pos_registers set quick_items = v_items where id = r.id;
  return v_items;
end $$;
revoke execute on function public.pos_quick_items_set(uuid, uuid[]) from public, anon;
grant execute on function public.pos_quick_items_set(uuid, uuid[]) to authenticated;

-- ----------------------------------------------------------------------------- the lock
-- the cashier opens her locked till with her own PIN (the same PIN as on a shared till, the same
-- five tries before ten minutes of waiting)
create or replace function public.pos_unlock(p_register uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.pos_registers; m public.company_members; pin app.member_pins;
begin
  select * into r from public.pos_registers where id = p_register;
  if r.id is null then raise exception 'Register not found' using errcode = 'P0002'; end if;
  perform app.require_permission(r.company_id, 'pos.write');
  select * into m from public.company_members where company_id = r.company_id and user_id = auth.uid() and status = 'active' and deleted_at is null;
  if m.id is null then raise exception 'Person not found' using errcode = 'P0002'; end if;
  select * into pin from app.member_pins where member_id = m.id for update;
  if pin.member_id is null then return jsonb_build_object('error', 'You have no PIN yet', 'no_pin', true, 'member', m.id); end if;
  if pin.locked_until > now() then
    return jsonb_build_object('error', format('Too many wrong PINs; try again in %s minutes', ceil(extract(epoch from pin.locked_until - now()) / 60)::int));
  end if;
  if pin.pin_hash <> extensions.crypt(coalesce(p_pin, ''), pin.pin_hash) then
    update app.member_pins set failed = failed + 1, locked_until = case when failed + 1 >= 5 then now() + interval '10 minutes' end where member_id = m.id;
    return jsonb_build_object('error', case when pin.failed + 1 >= 5 then 'Too many wrong PINs; try again in 10 minutes' else 'Wrong PIN' end);
  end if;
  update app.member_pins set failed = 0, locked_until = null where member_id = m.id;
  return jsonb_build_object('ok', true, 'member', m.id);
end $$;
revoke execute on function public.pos_unlock(uuid, text) from public, anon;
grant execute on function public.pos_unlock(uuid, text) to authenticated;

-- does the person at the till have a PIN (asked before the till locks, so nobody is shut out)
create or replace function public.pos_my_pin(p_company uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('member', m.id, 'has_pin', exists (select 1 from app.member_pins p where p.member_id = m.id))
    from public.company_members m where m.company_id = p_company and m.user_id = auth.uid() and m.status = 'active' and m.deleted_at is null
$$;
revoke execute on function public.pos_my_pin(uuid) from public, anon;
grant execute on function public.pos_my_pin(uuid) to authenticated;

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
