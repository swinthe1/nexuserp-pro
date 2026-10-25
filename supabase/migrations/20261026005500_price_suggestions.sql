-- =============================================================================
-- DrisPRO · new selling prices when the cost changes
--   Each category (or one product) can carry a target margin. When goods arrive at a new cost,
--   the item's average cost changes and DrisPRO works out the selling price that keeps that
--   margin, rounded the way the shop prices its shelf (VAT included). It becomes a suggestion;
--   whoever may change prices accepts it (the price changes, and the price history keeps it)
--   or rejects it. Companies whose prices come from the old program over the live link get no
--   suggestions: their prices are set there.
--
--   markup: price = cost × (1 + p)     ("30% over cost")
--   margin: price = cost ÷ (1 − p)     ("30% of the price is profit")
-- =============================================================================

alter table public.product_categories add column target_margin_pct numeric(6,2) check (target_margin_pct > -100 and target_margin_pct < 1000);
alter table public.products add column target_margin_pct numeric(6,2) check (target_margin_pct > -100 and target_margin_pct < 1000);
alter table public.company_settings
  add column price_margin_basis text not null default 'markup' check (price_margin_basis in ('markup', 'margin')),
  add column price_round_step numeric(12,4) not null default 0 check (price_round_step >= 0),
  add column price_suggest_down boolean not null default false,
  add column price_suggest_min_pct numeric(5,2) not null default 1 check (price_suggest_min_pct >= 0);

create table public.price_suggestions (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  variant_id    uuid not null,
  product_id    uuid not null,
  cost_before   numeric(18,6),
  cost_after    numeric(18,6) not null,
  margin_pct    numeric(6,2) not null,
  basis         text not null,
  tax_rate      numeric(6,2) not null default 0,
  price_now     numeric(18,4),
  price_new     numeric(18,4) not null,
  gross_now     numeric(18,2),
  gross_new     numeric(18,2) not null,
  status        text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'outdated')),
  decided_by    uuid references public.profiles(id) on delete set null,
  decided_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (company_id, variant_id) references public.product_variants(company_id, id) on delete cascade
);
select app.register_table('public.price_suggestions', 'inventory', p_soft_delete => false, p_client_write => false, p_audit => false);
create unique index price_suggestions_pending_idx on public.price_suggestions (company_id, variant_id) where status = 'pending';
create index price_suggestions_company_idx on public.price_suggestions (company_id, status, created_at desc);

-- the people whose roles give a permission
create or replace function app.notify_permission(p_company uuid, p_perm text, p_type text, p_title text,
  p_body text default null, p_link text default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (company_id, user_id, type, title, body, link)
  select distinct p_company, m.user_id, p_type, p_title, p_body, p_link
    from public.company_members m
    join public.member_roles mr on mr.member_id = m.id and mr.company_id = m.company_id
    join public.role_permissions rp on rp.role_id = mr.role_id
   where m.company_id = p_company and m.status = 'active' and m.user_id is not null
     and rp.permission in (p_perm, split_part(p_perm, '.', 1) || '.*', '*.' || split_part(p_perm, '.', 2), '*')
$$;
revoke execute on function app.notify_permission(uuid, text, text, text, text, text) from public, anon, authenticated;

-- the shelf price for a cost: margin, VAT, then rounded up to the shop's step (on the VAT-included price)
create or replace function app.price_for_cost(p_cost numeric, p_pct numeric, p_basis text, p_tax numeric, p_step numeric)
returns table (net numeric, gross numeric) language sql immutable set search_path = '' as $$
  with b as (
    select case when p_basis = 'margin' then p_cost / nullif(1 - p_pct / 100, 0) else p_cost * (1 + p_pct / 100) end * (1 + coalesce(p_tax, 0) / 100) as g
  ), r as (
    select case when coalesce(p_step, 0) > 0 then ceil(round(g / p_step, 6)) * p_step else round(g, 2) end as g from b
  )
  select round(r.g / (1 + coalesce(p_tax, 0) / 100), 4), round(r.g, 2) from r
$$;

-- one item: a suggestion when its price no longer keeps the target
create or replace function app.suggest_price(p_company uuid, p_variant uuid, p_cost_before numeric, p_cost_after numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.company_settings; v record; r record; v_now numeric; v_gross_now numeric; v_change numeric;
begin
  if coalesce(p_cost_after, 0) <= 0 then return; end if;
  if exists (select 1 from public.sync_connections c where c.company_id = p_company and c.is_active) then return; end if;
  select * into s from public.company_settings where company_id = p_company;
  select pv.id, pv.product_id, pv.sales_price_override, p.sales_price, coalesce(p.target_margin_pct, c.target_margin_pct) as pct, coalesce(t.rate, 0) as rate
    into v
    from public.product_variants pv
    join public.products p on p.id = pv.product_id and p.deleted_at is null and p.is_sellable
    left join public.product_categories c on c.id = p.category_id
    left join public.tax_codes t on t.id = p.sales_tax_code_id
   where pv.id = p_variant and pv.deleted_at is null;
  if v.id is null or v.pct is null then return; end if;
  select * into r from app.price_for_cost(p_cost_after, v.pct, coalesce(s.price_margin_basis, 'markup'), v.rate, coalesce(s.price_round_step, 0));
  v_now := coalesce(v.sales_price_override, v.sales_price);
  v_gross_now := round(coalesce(v_now, 0) * (1 + v.rate / 100), 2);
  v_change := case when coalesce(v_gross_now, 0) > 0 then (r.gross - v_gross_now) / v_gross_now * 100 else 100 end;
  -- an older suggestion for the item gives way to this one
  update public.price_suggestions set status = 'outdated', updated_at = now() where company_id = p_company and variant_id = p_variant and status = 'pending';
  if abs(v_change) < coalesce(s.price_suggest_min_pct, 1) then return; end if;
  if v_change < 0 and not coalesce(s.price_suggest_down, false) then return; end if;
  insert into public.price_suggestions (company_id, variant_id, product_id, cost_before, cost_after, margin_pct, basis, tax_rate, price_now, price_new, gross_now, gross_new)
  values (p_company, p_variant, v.product_id, p_cost_before, p_cost_after, v.pct, coalesce(s.price_margin_basis, 'markup'), v.rate, v_now, r.net, v_gross_now, r.gross);
end $$;
revoke execute on function app.suggest_price(uuid, uuid, numeric, numeric) from public, anon, authenticated;

create or replace function app.tg_cost_suggest()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.avg_cost is distinct from old.avg_cost and abs(coalesce(new.avg_cost, 0) - coalesce(old.avg_cost, 0)) > 0.000001 then
    perform app.suggest_price(new.company_id, new.variant_id, old.avg_cost, new.avg_cost);
  end if;
  return null;
end $$;
create trigger trg_95_price_suggest after update of avg_cost on public.item_costs
  for each row execute function app.tg_cost_suggest();
create or replace function app.tg_cost_suggest_new()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(new.avg_cost, 0) > 0 then perform app.suggest_price(new.company_id, new.variant_id, null, new.avg_cost); end if;
  return null;
end $$;
create trigger trg_95_price_suggest_new after insert on public.item_costs
  for each row execute function app.tg_cost_suggest_new();

-- one waiting message per person: a new suggestion refreshes it instead of adding another
create or replace function app.notify_once(p_company uuid, p_perm text, p_title text, p_body text, p_link text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.notifications set created_at = now(), body = p_body
   where company_id = p_company and link = p_link and read_at is null;
  insert into public.notifications (company_id, user_id, type, title, body, link)
  select distinct p_company, m.user_id, 'info', p_title, p_body, p_link
    from public.company_members m
    join public.member_roles mr on mr.member_id = m.id and mr.company_id = m.company_id
    join public.role_permissions rp on rp.role_id = mr.role_id
   where m.company_id = p_company and m.status = 'active' and m.user_id is not null
     and rp.permission in (p_perm, split_part(p_perm, '.', 1) || '.*', '*.' || split_part(p_perm, '.', 2), '*')
     and not exists (select 1 from public.notifications n where n.company_id = p_company and n.user_id = m.user_id and n.link = p_link and n.read_at is null);
end $$;
revoke execute on function app.notify_once(uuid, text, text, text, text) from public, anon, authenticated;

create or replace function app.tg_price_suggest_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if current_setting('app.quiet_prices', true) = '1' then return null; end if;
  for r in select distinct company_id from new_rows where status = 'pending' loop
    perform app.notify_once(r.company_id, 'inventory.write', 'New selling prices to review',
      'The cost changed and the price no longer keeps the target margin.', '/inventory/prices');
  end loop;
  return null;
end $$;
create trigger trg_price_suggest_notify after insert on public.price_suggestions
  referencing new table as new_rows for each statement execute function app.tg_price_suggest_notify();

-- the list to review
create or replace function public.price_suggestions_list(p_company uuid, p_status text default 'pending')
returns table (id uuid, variant_id uuid, product_id uuid, sku text, name text, category text, cost_before numeric, cost_after numeric,
               margin_pct numeric, basis text, tax_rate numeric, price_now numeric, price_new numeric, gross_now numeric, gross_new numeric,
               on_hand numeric, status text, created_at timestamptz, decided_at timestamptz, decided_by_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'inventory.read');
  return query
  select s.id, s.variant_id, s.product_id, v.sku, v.name, c.name, s.cost_before, s.cost_after, s.margin_pct, s.basis, s.tax_rate,
         s.price_now, s.price_new, s.gross_now, s.gross_new,
         (select sum(sl.on_hand) from public.stock_levels sl where sl.variant_id = s.variant_id), s.status, s.created_at, s.decided_at, pr.full_name
    from public.price_suggestions s
    join public.product_variants v on v.id = s.variant_id
    join public.products p on p.id = s.product_id
    left join public.product_categories c on c.id = p.category_id
    left join public.profiles pr on pr.id = s.decided_by
   where s.company_id = p_company and (p_status = 'all' or s.status = p_status)
   order by s.created_at desc
   limit 500;
end $$;
grant execute on function public.price_suggestions_list(uuid, text) to authenticated;

-- accept (optionally with another price, VAT included) or reject; several at once
create or replace function public.price_suggestions_decide(p_company uuid, p_ids uuid[], p_accept boolean, p_gross numeric default null)
returns int language plpgsql security definer set search_path = '' as $$
declare s record; n int := 0; v_net numeric; v_single boolean;
begin
  perform app.require_permission(p_company, 'inventory.write');
  if p_gross is not null and coalesce(array_length(p_ids, 1), 0) <> 1 then raise exception 'Give another price for one item at a time' using errcode = '22023'; end if;
  if p_gross is not null and p_gross < 0 then raise exception 'The price cannot be negative' using errcode = '22023'; end if;
  for s in select ps.*, pv.sales_price_override from public.price_suggestions ps join public.product_variants pv on pv.id = ps.variant_id
            where ps.company_id = p_company and ps.id = any (p_ids) and ps.status = 'pending' for update of ps loop
    if p_accept then
      v_net := case when p_gross is not null then round(p_gross / (1 + s.tax_rate / 100), 4) else s.price_new end;
      select count(*) = 1 into v_single from public.product_variants where product_id = s.product_id and deleted_at is null;
      -- an item with its own price keeps it there; otherwise the product's price (all its variants without their own)
      if s.sales_price_override is not null and not v_single then
        update public.product_variants set sales_price_override = v_net where id = s.variant_id;
      else
        update public.products set sales_price = v_net where id = s.product_id;
        if s.sales_price_override is not null then update public.product_variants set sales_price_override = null where id = s.variant_id; end if;
      end if;
    end if;
    update public.price_suggestions set status = case when p_accept then 'accepted' else 'rejected' end, decided_by = auth.uid(), decided_at = now(),
           price_new = case when p_accept and p_gross is not null then v_net else price_new end,
           gross_new = case when p_accept and p_gross is not null then round(p_gross, 2) else gross_new end, updated_at = now()
     where id = s.id;
    n := n + 1;
  end loop;
  return n;
end $$;
grant execute on function public.price_suggestions_decide(uuid, uuid[], boolean, numeric) to authenticated;

-- the rules: target per category, how margins are read and how prices are rounded
create or replace function public.price_rules_save(p_company uuid, p_basis text, p_step numeric, p_down boolean, p_min_pct numeric, p_categories jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare c jsonb;
begin
  perform app.require_permission(p_company, 'inventory.write');
  update public.company_settings set price_margin_basis = coalesce(p_basis, price_margin_basis), price_round_step = coalesce(p_step, price_round_step),
         price_suggest_down = coalesce(p_down, price_suggest_down), price_suggest_min_pct = coalesce(p_min_pct, price_suggest_min_pct)
   where company_id = p_company;
  for c in select * from jsonb_array_elements(coalesce(p_categories, '[]'::jsonb)) loop
    update public.product_categories set target_margin_pct = nullif(c ->> 'pct', '')::numeric
     where company_id = p_company and id = (c ->> 'id')::uuid;
  end loop;
end $$;
grant execute on function public.price_rules_save(uuid, text, numeric, boolean, numeric, jsonb) to authenticated;

-- a first look: which items would change today with these rules (nothing is changed)
create or replace function public.price_suggestions_scan(p_company uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  perform app.require_permission(p_company, 'inventory.write');
  perform set_config('app.quiet_prices', '1', true);
  for r in select ic.variant_id, ic.avg_cost from public.item_costs ic where ic.company_id = p_company and ic.avg_cost > 0 loop
    perform app.suggest_price(p_company, r.variant_id, null, r.avg_cost);
  end loop;
  select count(*) into n from public.price_suggestions where company_id = p_company and status = 'pending';
  return n;
end $$;
grant execute on function public.price_suggestions_scan(uuid) to authenticated;
