-- =============================================================================
-- New items from supplier invoices wait for someone competent (a company choice)
--   · "anyone" (as before): whoever enters the invoice may make the new item from its line
--   · "approval": an item that is not in DrisPRO yet is not made from an invoice by just anyone; the
--     line stays waiting, the people who approve items (inventory.approve) are told, and one of them
--     makes the item or refuses it with a reason; the one who asked is told either way
-- =============================================================================

alter table public.company_settings add column if not exists new_items_from_bills text not null default 'anyone';
do $$ begin
  alter table public.company_settings add constraint company_settings_new_items_from_bills_check check (new_items_from_bills in ('anyone', 'approval'));
exception when duplicate_object then null; end $$;

create table if not exists public.item_requests (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  name         text not null check (length(btrim(name)) between 2 and 200),
  barcode      text,
  code         text,
  vat_rate     numeric,
  cost         numeric,
  vendor_id    uuid references public.business_partners(id) on delete set null,
  status       text not null default 'pending' check (status in ('pending', 'made', 'refused')),
  variant_id   uuid references public.product_variants(id) on delete set null,
  reason       text,
  requested_by uuid default auth.uid(),
  decided_by   uuid,
  decided_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists item_requests_pending_idx on public.item_requests (company_id, created_at desc) where status = 'pending';
alter table public.item_requests enable row level security;
revoke all on public.item_requests from anon;
revoke insert, update, delete on public.item_requests from authenticated;
grant select on public.item_requests to authenticated;
drop policy if exists item_requests_read on public.item_requests;
create policy item_requests_read on public.item_requests for select to authenticated
  using (app.has_permission(company_id, 'inventory.read') or requested_by = auth.uid());

-- the choice, by an administrator or someone who approves items
create or replace function public.new_items_setting_save(p_company uuid, p_mode text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (app.has_permission(p_company, 'admin.write') or app.has_permission(p_company, 'inventory.approve')) then
    raise exception 'Permission denied' using errcode = '42501';
  end if;
  if p_mode not in ('anyone', 'approval') then raise exception 'Choose who makes new items' using errcode = '22023'; end if;
  update public.company_settings set new_items_from_bills = p_mode where company_id = p_company;
end $$;
revoke all on function public.new_items_setting_save(uuid, text) from public, anon;
grant execute on function public.new_items_setting_save(uuid, text) to authenticated;

-- the new item from an invoice line: made at once, or asked for
create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_new in v_def) > 0 then return; end if;
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;

do $$ begin
  perform app._patch_function('public.purchase_line_new_item',
    $o$  if length(v_name) < 2 then raise exception 'Write the item''s name' using errcode = '23514'; end if;$o$,
    $n$  if length(v_name) < 2 then raise exception 'Write the item''s name' using errcode = '23514'; end if;
  -- the company wants new items approved: not made here by someone who may not approve them
  if coalesce((select new_items_from_bills from public.company_settings where company_id = p_company), 'anyone') = 'approval'
     and not app.has_permission(p_company, 'inventory.approve') and coalesce(current_setting('app.item_request_ok', true), '') <> 'on' then
    return app.item_request_add(p_company, p);
  end if;$n$);
end $$;
drop function app._patch_function(text, text, text);

create or replace function app.item_request_add(p_company uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_name text := btrim(coalesce(p ->> 'name', '')); v_bar text := nullif(regexp_replace(coalesce(p ->> 'barcode', ''), '\D', '', 'g'), '');
begin
  -- the same item asked for again is the same request
  select id into v_id from public.item_requests
   where company_id = p_company and status = 'pending'
     and ((v_bar is not null and barcode = v_bar) or lower(name) = lower(v_name)) limit 1;
  if v_id is null then
    insert into public.item_requests (company_id, name, barcode, code, vat_rate, cost, vendor_id)
    values (p_company, v_name, v_bar, nullif(btrim(coalesce(p ->> 'code', '')), ''), (p ->> 'vat_rate')::numeric, (p ->> 'cost')::numeric,
            nullif(p ->> 'vendor_id', '')::uuid)
    returning id into v_id;
    perform app.notify_permission(p_company, 'inventory.approve', 'item_request', 'New item to approve: ' || v_name,
      'Asked for by ' || coalesce(app.person_name(auth.uid()), ''), '/inventory/item-requests');
  end if;
  return jsonb_build_object('requested', true, 'request_id', v_id, 'name', v_name);
end $$;
revoke execute on function app.item_request_add(uuid, jsonb) from public, anon, authenticated;

-- make the item or refuse it
create or replace function public.item_request_decide(p_id uuid, p_make boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.item_requests; v jsonb;
begin
  select * into r from public.item_requests where id = p_id for update;
  if r.id is null then raise exception 'Request not found' using errcode = 'P0002'; end if;
  perform app.require_permission(r.company_id, 'inventory.approve');
  if r.status <> 'pending' then raise exception 'This request was already decided' using errcode = '55000'; end if;
  if p_make then
    perform set_config('app.item_request_ok', 'on', true);
    v := public.purchase_line_new_item(r.company_id, jsonb_build_object('name', r.name, 'barcode', r.barcode, 'code', r.code, 'vat_rate', r.vat_rate, 'cost', r.cost));
    perform set_config('app.item_request_ok', '', true);
    update public.item_requests set status = 'made', variant_id = (v ->> 'variant_id')::uuid, decided_by = auth.uid(), decided_at = now() where id = p_id;
    if r.requested_by is not null then
      perform app.notify(r.company_id, r.requested_by, 'item_request', 'The new item is made: ' || r.name, 'Add it to the invoice again: it is found now.', '/procurement/bills');
    end if;
    return v;
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Write why it is refused' using errcode = '23514'; end if;
  update public.item_requests set status = 'refused', reason = btrim(p_reason), decided_by = auth.uid(), decided_at = now() where id = p_id;
  if r.requested_by is not null then
    perform app.notify(r.company_id, r.requested_by, 'item_request', 'The new item was refused: ' || r.name, btrim(p_reason), '/procurement/bills');
  end if;
  return jsonb_build_object('refused', true);
end $$;
revoke all on function public.item_request_decide(uuid, boolean, text) from public, anon;
grant execute on function public.item_request_decide(uuid, boolean, text) to authenticated;
