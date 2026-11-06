-- =============================================================================
-- #8, all automatic, the way Rongta allows it: the RLS1000 program on the computer of the store keeps the
-- scale up to date from its PLU file by itself ("Set auto upload & download time": update PLU every N
-- seconds). A small DrisPRO service on that computer (installed once, from the scale page) asks DrisPRO
-- every minute for the items of the scale and writes them into that file: the price, and the new PLUs at
-- the end; the hotkeys and the other settings of the file stay. Every item with a PLU and every new price
-- reaches the scale within a minute or two, without anyone touching anything.
-- The service has a key of its own for one scale: it can only read what goes on that scale.
-- =============================================================================

alter table public.scales
  add column if not exists key_hash   text unique,
  add column if not exists key_prefix text,
  add column if not exists file_path  text;

-- a new key for the service of this scale (the old one stops working); shown once, inside the installer
create or replace function public.scale_agent_key(p_scale uuid, p_file_path text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare s public.scales; v_key text := 'drs_' || encode(extensions.gen_random_bytes(24), 'hex');
begin
  select * into s from public.scales where id = p_scale and deleted_at is null;
  if s.id is null then raise exception 'Scale not found' using errcode = 'P0002'; end if;
  perform app.require_permission(s.company_id, 'inventory.write');
  update public.scales set key_hash = encode(extensions.digest(v_key, 'sha256'), 'hex'), key_prefix = left(v_key, 10),
         file_path = coalesce(nullif(btrim(p_file_path), ''), file_path), last_error = null
   where id = s.id;
  return v_key;
end $$;
revoke execute on function public.scale_agent_key(uuid, text) from public, anon;
grant execute on function public.scale_agent_key(uuid, text) to authenticated;

create or replace function app.scale_by_key(p_key text)
returns public.scales language plpgsql security definer set search_path = '' as $$
declare s public.scales; v_key text;
begin
  v_key := coalesce(nullif(p_key, ''), nullif(current_setting('request.headers', true), '')::json ->> 'x-scale-key');
  select * into s from public.scales where key_hash = encode(extensions.digest(coalesce(v_key, ''), 'sha256'), 'hex') and deleted_at is null;
  if s.id is null then raise exception 'Unknown scale key' using errcode = '28000'; end if;
  if not app.license_ok(s.company_id) then raise exception 'The licence for this company is not active' using errcode = '42501'; end if;
  return s;
end $$;
revoke execute on function app.scale_by_key(text) from public, anon, authenticated;

-- what the scale must hold now: every item with a PLU, its name as the scale shows it and its price with VAT.
-- What is returned is written to the file, so it counts as sent.
create or replace function public.scale_feed(p_key text default null, p_agent text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.scales; v_items jsonb;
begin
  s := app.scale_by_key(p_key);
  if not s.is_active then
    update public.scales set last_seen_at = now(), agent = coalesce(left(nullif(btrim(p_agent), ''), 60), agent) where id = s.id;
    return jsonb_build_object('scale', s.name, 'active', false, 'items', '[]'::jsonb);
  end if;
  with items as (
    select p.id as product_id, nullif(ltrim(p.scale_plu, '0'), '') as plu,
           case when v.is_default or coalesce(v.name, '') = '' then p.name else v.name end as full_name,
           round(coalesce(v.sales_price_override, p.sales_price, 0) * (1 + coalesce(tc.rate, 0) / 100), 2) as price,
           lower(coalesce(u.code, '')) not in ('kg', 'g', 'gr', 'kilogram') as by_piece
      from public.products p
      join lateral (select * from public.product_variants x where x.product_id = p.id and x.deleted_at is null
                     order by x.is_default desc, x.created_at limit 1) v on true
      left join public.units_of_measure u on u.id = p.uom_id
      left join public.tax_codes tc on tc.id = p.sales_tax_code_id
     where p.company_id = s.company_id and p.deleted_at is null and nullif(ltrim(p.scale_plu, '0'), '') is not null
       and coalesce(v.sales_price_override, p.sales_price, 0) > 0),
  named as (
    select *, left(btrim(regexp_replace(regexp_replace(upper(translate(full_name, 'ëËçÇéÉèÈáÁàÀöÖüÜäÄšŠžŽćĆčČđĐ', 'eEcCeEeEaAaAoOuUaAsSzZcCcCdD')),
                   '[^\x20-\x7E]', '', 'g'), '\s+', ' ', 'g')), 36) as name
      from items)
  select coalesce(jsonb_agg(jsonb_build_object('product_id', product_id, 'full_name', full_name, 'plu', plu, 'name', name, 'price', price, 'by_piece', by_piece)
                   order by plu::bigint), '[]'::jsonb)
    into v_items from named;
  insert into public.scale_sync (company_id, scale_id, product_id, plu, name, price)
  select s.company_id, s.id, (x ->> 'product_id')::uuid, x ->> 'plu', x ->> 'full_name', (x ->> 'price')::numeric from jsonb_array_elements(v_items) x
  on conflict (scale_id, product_id) do update set plu = excluded.plu, name = excluded.name, price = excluded.price,
    synced_at = case when (scale_sync.plu, scale_sync.name, scale_sync.price) is distinct from (excluded.plu, excluded.name, excluded.price) then now() else scale_sync.synced_at end;
  -- the price each item has on the scale now (the same as the file made by hand)
  update public.products pr set scale_sent_price = (x ->> 'price')::numeric, scale_sent_at = now()
    from jsonb_array_elements(v_items) x
   where pr.id = (x ->> 'product_id')::uuid and pr.scale_sent_price is distinct from (x ->> 'price')::numeric;
  v_items := coalesce((select jsonb_agg(x - 'product_id' - 'full_name') from jsonb_array_elements(v_items) x), '[]'::jsonb);
  -- what no longer has a PLU is no longer counted as on the scale (the file keeps its line; the scale keeps it until deleted there)
  delete from public.scale_sync x where x.scale_id = s.id
     and not exists (select 1 from public.products p where p.id = x.product_id and p.deleted_at is null and ltrim(p.scale_plu, '0') = x.plu);
  update public.scales set last_seen_at = now(), last_sync_at = now(), last_error = null,
         agent = coalesce(left(nullif(btrim(p_agent), ''), 60), agent)
   where id = s.id;
  return jsonb_build_object('scale', s.name, 'active', true, 'items', v_items);
end $$;

-- the service could not write the file (or RLS1000 is not where it was): the scale page shows it
create or replace function public.scale_feed_error(p_key text default null, p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.scales;
begin
  s := app.scale_by_key(p_key);
  update public.scales set last_seen_at = now(), last_error = left(coalesce(nullif(btrim(p_error), ''), 'Error'), 500) where id = s.id;
end $$;

revoke execute on function public.scale_feed(text, text), public.scale_feed_error(text, text) from public;
grant execute on function public.scale_feed(text, text), public.scale_feed_error(text, text) to anon, authenticated;

-- the list says whether the service is installed
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
select app._patch_function('public.scales_list',
  $x$'last_seen_at', s.last_seen_at,$x$,
  $x$'last_seen_at', s.last_seen_at, 'has_key', s.key_hash is not null, 'file_path', s.file_path,$x$);
drop function app._patch_function(text, text, text);
