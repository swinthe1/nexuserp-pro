-- =============================================================================
-- NexusERP Pro · a picture for each product
--   kept in the database (small JPEG/PNG, up to 1.5 MB), so it works the same on every
--   server and comes over the live link from the old program (Logmicro AD_IMAGE).
--   products.image_path says 'db' when a picture exists, so lists know without loading it.
-- =============================================================================

create table public.product_images (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  product_id  uuid not null unique,
  mime        text not null check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  data        bytea not null,
  bytes       int not null,
  source      text not null default 'upload' check (source in ('upload', 'logmicro')),
  ext_id      text,
  created_by  uuid references public.profiles(id) on delete set null,
  updated_at  timestamptz not null default now(),
  foreign key (company_id, product_id) references public.products(company_id, id) on delete cascade
);
select app.register_table('public.product_images', 'inventory', p_soft_delete => false, p_client_write => false, p_audit => false);
-- the picture itself is read through product_images_get, not table by table
revoke select on public.product_images from anon, authenticated;

create or replace function app.tg_product_image_flag()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    update public.products set image_path = null where id = old.product_id and image_path = 'db';
    return null;
  end if;
  update public.products set image_path = 'db' where id = new.product_id and image_path is distinct from 'db';
  return null;
end $$;
create trigger trg_10_product_image_flag after insert or delete on public.product_images
  for each row execute function app.tg_product_image_flag();

-- base64 → bytes, checking it is a picture we can show
create or replace function app.decode_image(p_data text, out mime text, out data bytea)
language plpgsql immutable set search_path = '' as $$
begin
  data := decode(regexp_replace(regexp_replace(coalesce(p_data, ''), '^data:[^,]*,', ''), '\s', '', 'g'), 'base64');
  if length(data) > 1572864 then raise exception 'The picture is too big (at most 1.5 MB)' using errcode = '22023'; end if;
  mime := case when substring(data from 1 for 2) = '\xffd8'::bytea then 'image/jpeg'
               when substring(data from 1 for 4) = '\x89504e47'::bytea then 'image/png'
               when substring(data from 1 for 4) = '\x52494646'::bytea and substring(data from 9 for 4) = '\x57454250'::bytea then 'image/webp' end;
  if mime is null then raise exception 'Only JPEG, PNG or WebP pictures' using errcode = '22023'; end if;
end $$;

-- pictures of up to 60 products, as data: URLs keyed by product id
create or replace function public.product_images_get(p_company uuid, p_products uuid[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (p_company = any (app.my_company_ids())) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if coalesce(array_length(p_products, 1), 0) > 60 then raise exception 'At most 60 pictures at once' using errcode = '54000'; end if;
  return coalesce((select jsonb_object_agg(i.product_id, 'data:' || i.mime || ';base64,' || translate(encode(i.data, 'base64'), E'\n', ''))
                     from public.product_images i where i.company_id = p_company and i.product_id = any (p_products)), '{}'::jsonb);
end $$;
revoke execute on function public.product_images_get(uuid, uuid[]) from public, anon;
grant execute on function public.product_images_get(uuid, uuid[]) to authenticated;

-- set (base64, or a data: URL) or remove (null) the picture of a product
create or replace function public.product_image_set(p_product uuid, p_data text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_co uuid; v_img record;
begin
  select company_id into v_co from public.products where id = p_product and deleted_at is null;
  if v_co is null then raise exception 'Product not found' using errcode = 'P0002'; end if;
  perform app.require_permission(v_co, 'inventory.write');
  if p_data is null then delete from public.product_images where product_id = p_product; return; end if;
  select * into v_img from app.decode_image(p_data);
  insert into public.product_images (company_id, product_id, mime, data, bytes, source, created_by)
  values (v_co, p_product, v_img.mime, v_img.data, length(v_img.data), 'upload', auth.uid())
  on conflict (product_id) do update set mime = excluded.mime, data = excluded.data, bytes = excluded.bytes, source = 'upload',
                                         ext_id = null, created_by = excluded.created_by, updated_at = now();
end $$;
revoke execute on function public.product_image_set(uuid, text) from public, anon;
grant execute on function public.product_image_set(uuid, text) to authenticated;

-- the old program's pictures over the live link: [{sku, data (base64), ext_id}]
create or replace function public.sync_images(p_key text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.sync_connections; r jsonb; v_prod uuid; v_img record; v_n int := 0; v_skip int := 0;
begin
  c := app.sync_connection(p_key);
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Rows must be a list' using errcode = '22023'; end if;
  if jsonb_array_length(p_rows) > 200 then raise exception 'Send at most 200 pictures per push' using errcode = '54000'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    select v.product_id into v_prod from public.product_variants v
     where v.company_id = c.company_id and upper(v.sku) = upper(btrim(r ->> 'sku')) and v.deleted_at is null limit 1;
    if v_prod is null then v_skip := v_skip + 1; continue; end if;
    -- a picture added here by hand is kept
    if exists (select 1 from public.product_images where product_id = v_prod and source = 'upload') then v_skip := v_skip + 1; continue; end if;
    begin
      select * into v_img from app.decode_image(r ->> 'data');
    exception when others then v_skip := v_skip + 1; continue;
    end;
    insert into public.product_images (company_id, product_id, mime, data, bytes, source, ext_id)
    values (c.company_id, v_prod, v_img.mime, v_img.data, length(v_img.data), 'logmicro', nullif(btrim(r ->> 'ext_id'), ''))
    on conflict (product_id) do update set mime = excluded.mime, data = excluded.data, bytes = excluded.bytes,
                                           ext_id = excluded.ext_id, updated_at = now()
     where public.product_images.source = 'logmicro';
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'saved', v_n, 'skipped', v_skip);
end $$;
revoke execute on function public.sync_images(text, jsonb) from public;
grant execute on function public.sync_images(text, jsonb) to anon, authenticated;
