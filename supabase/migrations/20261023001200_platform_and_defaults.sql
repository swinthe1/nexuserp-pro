-- =============================================================================
-- DrisPRO · 1200 · Storage, realtime, company defaults, safety net
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Storage: every object path starts with the company id: <company_id>/...
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values
  ('attachments',    'attachments',    false),
  ('company-assets', 'company-assets', false)   -- logos, product images (served via signed URLs)
on conflict (id) do nothing;

create policy "company files: read" on storage.objects for select to authenticated
  using (bucket_id in ('attachments','company-assets')
         and (storage.foldername(name))[1] = any ((select app.my_company_ids())::text[]));

create policy "attachments: upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments'
              and (storage.foldername(name))[1] = any ((select app.company_ids_with('collab.write'))::text[]));

create policy "company assets: upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'company-assets'
              and ((storage.foldername(name))[1] = any ((select app.company_ids_with('inventory.write'))::text[])
                or (storage.foldername(name))[1] = any ((select app.company_ids_with('admin.write'))::text[])));

create policy "company files: delete own or with permission" on storage.objects for delete to authenticated
  using (bucket_id in ('attachments','company-assets')
         and (storage.foldername(name))[1] = any ((select app.my_company_ids())::text[])
         and (owner_id = (select auth.uid())::text
              or (storage.foldername(name))[1] = any ((select app.company_ids_with('collab.delete'))::text[])));

-- -----------------------------------------------------------------------------
-- Realtime: tables the UI subscribes to (RLS still applies to every event)
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['notifications','approval_requests','entity_activities','stock_levels',
                             'sales_orders','purchase_orders','pos_orders','warehouse_tasks','work_orders'] loop
      execute format('alter publication supabase_realtime add table public.%I', t);
    end loop;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Defaults seeded for every new company (called by create_company)
-- -----------------------------------------------------------------------------
create or replace function app.seed_company_defaults(p_company uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.companies;
  v_wh uuid; v_year uuid; v_start date; m int;
  v_sales_tax uuid; v_purchase_tax uuid;
begin
  select * into c from public.companies where id = p_company;

  -- Units of measure
  insert into public.units_of_measure (company_id, code, name, category, ratio, is_reference) values
    (p_company, 'pcs', 'Piece',      'unit',   1,     true),
    (p_company, 'dz',  'Dozen',      'unit',   12,    false),
    (p_company, 'box', 'Box',        'unit',   1,     false),
    (p_company, 'kg',  'Kilogram',   'weight', 1,     true),
    (p_company, 'g',   'Gram',       'weight', 0.001, false),
    (p_company, 'l',   'Litre',      'volume', 1,     true),
    (p_company, 'ml',  'Millilitre', 'volume', 0.001, false),
    (p_company, 'm',   'Metre',      'length', 1,     true),
    (p_company, 'cm',  'Centimetre', 'length', 0.01,  false),
    (p_company, 'h',   'Hour',       'time',   1,     true);

  -- VAT codes (editable; rates as in force at setup)
  if c.country_code = 'XK' then
    insert into public.tax_codes (company_id, code, name, rate, scope, country_code, is_exempt, is_reverse_charge) values
      (p_company, 'VAT18',    'TVSH 18%',                  18, 'both',     'XK', false, false),
      (p_company, 'VAT8',     'TVSH 8%',                    8, 'both',     'XK', false, false),
      (p_company, 'VAT0',     'TVSH 0% (export)',           0, 'sales',    'XK', false, false),
      (p_company, 'EXEMPT',   'Exempt',                     0, 'both',     'XK', true,  false),
      (p_company, 'VAT18-RC', 'Reverse charge 18% (import of services)', 18, 'purchase', 'XK', false, true);
    select id into v_sales_tax from public.tax_codes where company_id = p_company and code = 'VAT18';
  else
    insert into public.tax_codes (company_id, code, name, rate, scope, country_code, is_exempt, is_reverse_charge) values
      (p_company, 'VAT20',    'TVSH 20%',                  20, 'both',     'AL', false, false),
      (p_company, 'VAT6',     'TVSH 6%',                    6, 'both',     'AL', false, false),
      (p_company, 'VAT0',     'TVSH 0% (export)',           0, 'sales',    'AL', false, false),
      (p_company, 'EXEMPT',   'Exempt',                     0, 'both',     'AL', true,  false),
      (p_company, 'VAT20-RC', 'Reverse charge 20% (import of services)', 20, 'purchase', 'AL', false, true);
    select id into v_sales_tax from public.tax_codes where company_id = p_company and code = 'VAT20';
  end if;
  v_purchase_tax := v_sales_tax;

  insert into public.payment_terms (company_id, code, name, due_days) values
    (p_company, 'NOW',   'Immediate', 0),
    (p_company, 'NET15', 'Net 15',   15),
    (p_company, 'NET30', 'Net 30',   30),
    (p_company, 'NET60', 'Net 60',   60);

  -- Virtual locations (stock always moves between two locations)
  insert into public.warehouse_locations (company_id, code, name, location_type) values
    (p_company, 'VIRT/SUPPLIER',   'Suppliers',          'supplier'),
    (p_company, 'VIRT/CUSTOMER',   'Customers',          'customer'),
    (p_company, 'VIRT/ADJUSTMENT', 'Inventory adjustment','adjustment'),
    (p_company, 'VIRT/SCRAP',      'Scrap',              'scrap'),
    (p_company, 'VIRT/TRANSIT',    'Inter-warehouse transit', 'transit'),
    (p_company, 'VIRT/PRODUCTION', 'Production',         'production');

  -- Main warehouse with standard locations
  insert into public.warehouses (company_id, code, name, warehouse_type, city, country_code)
  values (p_company, 'WH', 'Main Warehouse', 'warehouse', c.city, c.country_code) returning id into v_wh;
  insert into public.warehouse_locations (company_id, warehouse_id, code, name, location_type, is_pickable) values
    (p_company, v_wh, 'WH/RECEIVING', 'Receiving', 'receiving', false),
    (p_company, v_wh, 'WH/STOCK',     'Stock',     'internal',  true),
    (p_company, v_wh, 'WH/SHIPPING',  'Shipping',  'shipping',  false);

  update public.company_settings
     set default_warehouse_id = v_wh,
         default_sales_tax_code_id = v_sales_tax,
         default_purchase_tax_code_id = v_purchase_tax,
         fiscalization_enabled = c.country_code in ('AL','XK')
   where company_id = p_company;

  -- Fiscal year = current calendar year with 12 monthly periods
  v_start := make_date(extract(year from current_date)::int, c.fiscal_year_start_month, 1);
  if v_start > current_date then v_start := (v_start - interval '1 year')::date; end if;
  insert into public.fiscal_years (company_id, name, start_date, end_date)
  values (p_company, 'FY ' || to_char(v_start, 'YYYY'), v_start, (v_start + interval '1 year' - interval '1 day')::date)
  returning id into v_year;
  for m in 0..11 loop
    insert into public.fiscal_periods (company_id, fiscal_year_id, period_no, name, start_date, end_date)
    values (p_company, v_year, m + 1,
            to_char(v_start + make_interval(months => m), 'Mon YYYY'),
            (v_start + make_interval(months => m))::date,
            (v_start + make_interval(months => m + 1) - interval '1 day')::date);
  end loop;

  insert into public.crm_pipeline_stages (company_id, name, sort_order, probability, is_won, is_lost) values
    (p_company, 'New',         1,  10,  false, false),
    (p_company, 'Qualified',   2,  25,  false, false),
    (p_company, 'Proposal',    3,  50,  false, false),
    (p_company, 'Negotiation', 4,  75,  false, false),
    (p_company, 'Won',         5,  100, true,  false),
    (p_company, 'Lost',        6,  0,   false, true);

  insert into public.leave_types (company_id, name, days_per_year, is_paid, requires_document) values
    (p_company, 'Annual leave',    20, true,  false),
    (p_company, 'Sick leave',       0, true,  true),
    (p_company, 'Maternity leave',  0, true,  true),
    (p_company, 'Unpaid leave',     0, false, false);
end $$;

-- -----------------------------------------------------------------------------
-- Safety net: fail the migration if any public table lacks RLS
-- -----------------------------------------------------------------------------
do $$
declare v_missing text;
begin
  select string_agg(c.relname, ', ') into v_missing
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if v_missing is not null then
    raise exception 'RLS is not enabled on: %', v_missing;
  end if;
end $$;
