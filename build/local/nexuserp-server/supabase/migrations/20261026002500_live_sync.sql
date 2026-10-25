-- =============================================================================
-- NexusERP Pro · live link from the client's old program (one way: old → NexusERP)
--
-- An agent on the client's server reads what changed every ~30 seconds and calls
-- sync_push() with a secret connection key (no user login). The key belongs to one
-- company; work runs with the rights of the platform administrator who made it.
--   products, partners      → the spreadsheet importer (matched by SKU / code)
--   prices                  → price lists (migration_import)
--   stock                   → set to the old program's quantity, per warehouse, with
--                             one correction adjustment per warehouse and batch
--   documents               → external_documents: the old program's invoices with
--                             what is still open; they do not touch NexusERP's books
-- A company in training mode never fiscalizes and shows a banner, so staff can
-- practise on live data while the old program stays the official one.
-- =============================================================================

alter table public.companies add column if not exists is_training boolean not null default false;

-- -----------------------------------------------------------------------------
-- 1. Connections
-- -----------------------------------------------------------------------------
create table public.sync_connections (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  name         text not null,
  source       text not null default 'logmicro',
  key_prefix   text not null,
  key_hash     text not null unique,
  run_as       uuid not null,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz,
  last_counts  jsonb,
  last_error   text,
  pushes       bigint not null default 0
);
create index sync_connections_company_idx on public.sync_connections (company_id);
alter table public.sync_connections enable row level security;
revoke all on public.sync_connections from anon, authenticated;
grant select (id, company_id, name, source, key_prefix, is_active, created_at, last_seen_at, last_counts, last_error, pushes) on public.sync_connections to authenticated;
create policy sync_connections_select on public.sync_connections for select to authenticated
  using (company_id = any ((select app.company_ids_with('admin.read'))::uuid[]));

-- -----------------------------------------------------------------------------
-- 2. The old program's documents (read-only mirror)
-- -----------------------------------------------------------------------------
create table public.external_documents (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  source       text not null default 'logmicro',
  ext_id       text not null,
  kind         text not null check (kind in ('sale','purchase','balance')),
  number       text,
  partner_code text,
  partner_id   uuid,
  doc_date     date,
  due_date     date,
  total        numeric(18,2),
  open_amount  numeric(18,2) not null default 0,
  warehouse_code text,
  synced_at    timestamptz not null default now(),
  unique (company_id, source, ext_id)
);
create index external_documents_open_idx on public.external_documents (company_id, partner_id) where open_amount <> 0;
alter table public.external_documents enable row level security;
revoke all on public.external_documents from anon, authenticated;
grant select on public.external_documents to authenticated;
create policy external_documents_select on public.external_documents for select to authenticated
  using (company_id = any ((select app.company_ids_with('invoicing.read'))::uuid[]));

-- -----------------------------------------------------------------------------
-- 3. Training mode
-- -----------------------------------------------------------------------------
create or replace function public.set_training_mode(p_company uuid, p_on boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_super_admin();
  update public.companies set is_training = p_on where id = p_company;
  if p_on then update public.company_settings set fiscalization_enabled = false where company_id = p_company; end if;
end $$;

-- training companies never send documents to the tax authority
create or replace function app.tg_training_no_fiscal()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.fiscalization_enabled and exists (select 1 from public.companies where id = new.company_id and is_training) then
    new.fiscalization_enabled := false;
  end if;
  return new;
end $$;
drop trigger if exists trg_training_no_fiscal on public.company_settings;
create trigger trg_training_no_fiscal before insert or update of fiscalization_enabled on public.company_settings
  for each row execute function app.tg_training_no_fiscal();

-- -----------------------------------------------------------------------------
-- 4. Managing connections (platform administrator)
-- -----------------------------------------------------------------------------
create or replace function public.sync_create_connection(p_company uuid, p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_key text; v_id uuid;
begin
  perform app.require_super_admin();
  if not exists (select 1 from public.companies where id = p_company and deleted_at is null) then raise exception 'Company not found' using errcode = 'P0002'; end if;
  v_key := 'nxs_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.sync_connections (company_id, name, key_prefix, key_hash, run_as)
  values (p_company, coalesce(nullif(btrim(p_name), ''), 'Logmicro'), left(v_key, 10), encode(extensions.digest(v_key, 'sha256'), 'hex'), auth.uid())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'key', v_key);   -- the key is shown once and never stored
end $$;

create or replace function public.sync_set_active(p_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_super_admin();
  update public.sync_connections set is_active = p_active where id = p_id;
end $$;

-- -----------------------------------------------------------------------------
-- 5. Stock and documents from a push
-- -----------------------------------------------------------------------------
-- p_rows: [{warehouse, sku, qty, cost?}] — the old program's quantity; NexusERP is set to it
create or replace function app.sync_stock(p_company uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  w record; r jsonb; v_adj uuid; v_loc uuid; v_variant uuid; v_cur numeric; v_target numeric; v_delta numeric;
  v_lines int; v_changed int := 0; v_unknown int := 0; v_no_wh int := 0;
begin
  for w in select distinct x ->> 'warehouse' as code from jsonb_array_elements(p_rows) x loop
    select l.id into v_loc from public.warehouses wh join public.warehouse_locations l on l.warehouse_id = wh.id
     where wh.company_id = p_company and upper(wh.code) = upper(w.code) and wh.deleted_at is null
       and l.location_type = 'internal' and l.deleted_at is null
     order by l.is_pickable desc, l.code limit 1;
    if v_loc is null then
      v_no_wh := v_no_wh + (select count(*) from jsonb_array_elements(p_rows) x where x ->> 'warehouse' = w.code);
      continue;
    end if;
    insert into public.stock_adjustments (company_id, warehouse_id, reason, notes)
    values (p_company, (select warehouse_id from public.warehouse_locations where id = v_loc), 'correction', 'Live link: quantities from the old program')
    returning id into v_adj;
    v_lines := 0;
    for r in select x from jsonb_array_elements(p_rows) x where x ->> 'warehouse' = w.code loop
      select v.id into v_variant from public.product_variants v
       where v.company_id = p_company and upper(v.sku) = upper(btrim(r ->> 'sku')) and v.deleted_at is null;
      if v_variant is null then v_unknown := v_unknown + 1; continue; end if;
      select coalesce(sum(sl.on_hand), 0) into v_cur from public.stock_levels sl
       where sl.company_id = p_company and sl.variant_id = v_variant
         and sl.warehouse_id = (select warehouse_id from public.warehouse_locations where id = v_loc);
      v_target := greatest(coalesce(app.mig_num(r ->> 'qty'), 0), 0);
      v_delta := round(v_target - v_cur, 4);
      if v_delta = 0 then continue; end if;
      v_lines := v_lines + 1;
      insert into public.stock_adjustment_lines (company_id, adjustment_id, variant_id, location_id, quantity_change, unit_cost)
      values (p_company, v_adj, v_variant, v_loc, v_delta, case when v_delta > 0 then nullif(app.mig_num(r ->> 'cost'), 0) end);
    end loop;
    if v_lines = 0 then
      delete from public.stock_adjustments where id = v_adj;
    else
      perform public.post_stock_adjustment(v_adj);
      v_changed := v_changed + v_lines;
    end if;
  end loop;
  return jsonb_build_object('changed', v_changed, 'unknown_items', v_unknown, 'unknown_warehouse', v_no_wh);
end $$;

-- p_docs: [{ext_id, kind, number, partner, date, due_date, total, open, warehouse}];
-- p_replace: partner codes whose open documents were all resent (others drop to 0)
create or replace function app.sync_documents(p_company uuid, p_docs jsonb, p_replace jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r jsonb; v_n int := 0;
begin
  if jsonb_typeof(p_replace) = 'array' and jsonb_array_length(p_replace) > 0 then
    update public.external_documents set open_amount = 0, synced_at = now()
     where company_id = p_company and partner_code in (select jsonb_array_elements_text(p_replace)) and open_amount <> 0;
  end if;
  for r in select * from jsonb_array_elements(coalesce(p_docs, '[]'::jsonb)) loop
    insert into public.external_documents as d (company_id, ext_id, kind, number, partner_code, partner_id, doc_date, due_date, total, open_amount, warehouse_code, synced_at)
    values (p_company, r ->> 'ext_id', coalesce(r ->> 'kind', 'sale'), r ->> 'number', r ->> 'partner',
            (select id from public.business_partners where company_id = p_company and upper(code) = upper(r ->> 'partner') and deleted_at is null limit 1),
            nullif(r ->> 'date', '')::date, nullif(r ->> 'due_date', '')::date, app.mig_num(r ->> 'total'),
            coalesce(app.mig_num(r ->> 'open'), 0), r ->> 'warehouse', now())
    on conflict (company_id, source, ext_id) do update set
      kind = excluded.kind, number = excluded.number, partner_code = excluded.partner_code, partner_id = excluded.partner_id,
      doc_date = excluded.doc_date, due_date = excluded.due_date, total = coalesce(excluded.total, d.total),
      open_amount = excluded.open_amount, warehouse_code = excluded.warehouse_code, synced_at = now();
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('documents', v_n);
end $$;

-- -----------------------------------------------------------------------------
-- 6. The push itself (called by the agent with the anon key + connection key)
-- -----------------------------------------------------------------------------
-- p_batch: {warehouses?: [...], products?: [...], partners?: [...], prices?: [...], stock?: [...], documents?: [...], replace_partners?: [...]}
create or replace function public.sync_push(p_key text, p_batch jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.sync_connections; v_out jsonb := '{}'::jsonb; v_res jsonb; v_err text;
  function_rows int;
begin
  select * into c from public.sync_connections
   where key_hash = encode(extensions.digest(coalesce(p_key, ''), 'sha256'), 'hex') and is_active;
  if c.id is null then raise exception 'Unknown or switched-off connection key' using errcode = '28000'; end if;
  if not app.license_ok(c.company_id) then raise exception 'The licence for this company is not active' using errcode = '42501'; end if;
  select sum(jsonb_array_length(v)) into function_rows from jsonb_each(p_batch) e(k, v) where jsonb_typeof(v) = 'array';
  if coalesce(function_rows, 0) > 3000 then raise exception 'Send at most 3,000 rows per push' using errcode = '54000'; end if;

  -- act as the administrator who made the key (transaction-local)
  perform set_config('request.jwt.claim.sub', c.run_as::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', c.run_as, 'role', 'authenticated')::text, true);

  begin
    if jsonb_array_length(coalesce(p_batch -> 'warehouses', '[]')) > 0 then
      v_res := public.migration_import(c.company_id, 'warehouses', p_batch -> 'warehouses', false, current_date, 'live-sync');
      delete from public.migration_runs where company_id = c.company_id and file_name = 'live-sync';
      v_out := v_out || jsonb_build_object('warehouses', jsonb_build_object('created', v_res -> 'created', 'updated', v_res -> 'updated',
                 'errors', jsonb_array_length(v_res -> 'errors')));
    end if;
    if jsonb_array_length(coalesce(p_batch -> 'products', '[]')) > 0 then
      v_res := public.import_rows(c.company_id, 'products', p_batch -> 'products', false);
      v_out := v_out || jsonb_build_object('products', jsonb_build_object('created', v_res -> 'created', 'updated', v_res -> 'updated',
                 'errors', jsonb_array_length(v_res -> 'errors'), 'sample', (select jsonb_agg(e) from (select e from jsonb_array_elements(v_res -> 'errors') e limit 3) s)));
    end if;
    if jsonb_array_length(coalesce(p_batch -> 'partners', '[]')) > 0 then
      v_res := public.import_rows(c.company_id, 'partners', p_batch -> 'partners', false);
      v_out := v_out || jsonb_build_object('partners', jsonb_build_object('created', v_res -> 'created', 'updated', v_res -> 'updated',
                 'errors', jsonb_array_length(v_res -> 'errors'), 'sample', (select jsonb_agg(e) from (select e from jsonb_array_elements(v_res -> 'errors') e limit 3) s)));
    end if;
    if jsonb_array_length(coalesce(p_batch -> 'prices', '[]')) > 0 then
      v_res := public.migration_import(c.company_id, 'price_lists', p_batch -> 'prices', false, current_date, 'live-sync');
      delete from public.migration_runs where company_id = c.company_id and file_name = 'live-sync';
      v_out := v_out || jsonb_build_object('prices', jsonb_build_object('created', v_res -> 'created', 'updated', v_res -> 'updated',
                 'errors', jsonb_array_length(v_res -> 'errors')));
    end if;
    if jsonb_array_length(coalesce(p_batch -> 'stock', '[]')) > 0 then
      v_out := v_out || jsonb_build_object('stock', app.sync_stock(c.company_id, p_batch -> 'stock'));
    end if;
    if jsonb_array_length(coalesce(p_batch -> 'documents', '[]')) > 0 or jsonb_array_length(coalesce(p_batch -> 'replace_partners', '[]')) > 0 then
      v_out := v_out || app.sync_documents(c.company_id, p_batch -> 'documents', coalesce(p_batch -> 'replace_partners', '[]'));
    end if;
  exception when others then
    get stacked diagnostics v_err = message_text;
  end;

  update public.sync_connections
     set last_seen_at = now(), pushes = pushes + 1,
         last_counts = case when v_err is null and v_out <> '{}'::jsonb then v_out else last_counts end,
         last_error = v_err
   where id = c.id;
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
  return jsonb_build_object('ok', true) || v_out;
end $$;

-- -----------------------------------------------------------------------------
-- 7. Context: training flag per company
-- -----------------------------------------------------------------------------
create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;
select app._patch_function('public.get_my_context',
  $x$'base_currency', c.base_currency, 'logo_path', c.logo_path,$x$,
  $x$'base_currency', c.base_currency, 'logo_path', c.logo_path, 'is_training', c.is_training,$x$);
select app._patch_function('public.platform_clients',
  $x$'created_at', c.created_at,$x$,
  $x$'created_at', c.created_at, 'is_training', c.is_training,
               'sync', (select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'key_prefix', s.key_prefix, 'is_active', s.is_active,
                          'last_seen_at', s.last_seen_at, 'last_error', s.last_error, 'pushes', s.pushes, 'last_counts', s.last_counts) order by s.created_at)
                          from public.sync_connections s where s.company_id = c.id),$x$);
drop function app._patch_function(text, text, text);

-- -----------------------------------------------------------------------------
-- 8. Privileges
-- -----------------------------------------------------------------------------
revoke execute on function app.sync_stock(uuid, jsonb), app.sync_documents(uuid, jsonb, jsonb), app.tg_training_no_fiscal() from public, anon, authenticated;
revoke execute on function public.sync_push(text, jsonb), public.sync_create_connection(uuid, text), public.sync_set_active(uuid, boolean),
  public.set_training_mode(uuid, boolean) from public;
grant execute on function public.sync_push(text, jsonb) to anon, authenticated;
grant execute on function public.sync_create_connection(uuid, text), public.sync_set_active(uuid, boolean), public.set_training_mode(uuid, boolean) to authenticated;
