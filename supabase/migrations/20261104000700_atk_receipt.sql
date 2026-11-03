-- =============================================================================
-- DrisPRO · 20261104000700 · the fiscal coupon as ATK's Shtojca F shows it, a coupon sent before it is printed,
-- a cancellation coupon with its reason (Kërkesat specifike…, neni 25.11, 25.18, 26.5; UA 01/2026, neni 7)
-- =============================================================================

/** the coupon as the till signed it: only the known parts are kept */
create or replace function app.atk_coupon_of(r public.pos_registers, f jsonb) returns jsonb language plpgsql immutable set search_path = '' as $$
begin
  if f is null or jsonb_typeof(f) <> 'object' then return null; end if;
  if coalesce(f ->> 'env', '') not in ('test', 'production') or coalesce(f ->> 'coupon_id', '') !~ '^[0-9]{1,18}$'
     or coalesce(f ->> 'seq', '') !~ '^[0-9]{1,10}$' or coalesce(f ->> 'details', '') !~ '^[A-Za-z0-9+/=]+$' or length(f ->> 'details') not between 8 and 60000
     or coalesce(f ->> 'signature', '') !~ '^[A-Za-z0-9+/=]+$' or length(f ->> 'signature') not between 40 and 200 or coalesce(f ->> 'qr', '') !~ '^[A-Za-z0-9+/=]+\|[A-Za-z0-9+/=]+$' then
    raise exception 'The fiscal coupon of this sale is not complete' using errcode = '23514';
  end if;
  if (f ->> 'type') = '2' and length(btrim(coalesce(f ->> 'reason', ''))) < 3 then
    raise exception 'A cancellation coupon needs its reason' using errcode = '23514';
  end if;
  return jsonb_build_object('env', f ->> 'env', 'coupon_id', (f ->> 'coupon_id')::bigint, 'seq', (f ->> 'seq')::bigint, 'pos_id', (f ->> 'pos_id')::int,
    'branch_id', (f ->> 'branch_id')::int, 'verification_no', left(f ->> 'verification_no', 16), 'details', f ->> 'details', 'signature', f ->> 'signature',
    'qr', f ->> 'qr', 'type', (f ->> 'type')::int, 'reference_no', nullif(f ->> 'reference_no', '')::bigint,
    'total', (f ->> 'total')::bigint, 'tax', (f ->> 'tax')::bigint,
    'daily_no', nullif(f ->> 'daily_no', '')::int, 'reason', left(nullif(btrim(f ->> 'reason'), ''), 200), 'operator_no', left(f ->> 'operator_no', 30));
end $$;

create or replace function public.atk_till(p_register uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.pos_registers; c public.companies; s public.company_settings; w public.warehouses;
begin
  select * into r from public.pos_registers where id = p_register;
  if r.id is null then raise exception 'Till not found' using errcode = 'P0002'; end if;
  perform app.require_permission(r.company_id, 'pos.read');
  select * into c from public.companies where id = r.company_id;
  select * into s from public.company_settings where company_id = r.company_id;
  select * into w from public.warehouses where id = r.warehouse_id;
  if c.country_code <> 'XK' or not s.fiscalization_enabled or not s.atk_sef_enabled or c.is_training then return jsonb_build_object('required', false); end if;
  return jsonb_build_object('required', true, 'env', s.fiscal_environment, 'nui', c.tax_number, 'business', coalesce(c.legal_name, c.name),
    -- what the fiscal coupon prints at its head (Kërkesat, neni 25.18; Shtojca F)
    'header', jsonb_build_object('legal_name', coalesce(c.legal_name, c.name), 'store', w.name, 'store_address', coalesce(nullif(w.address_line1, ''), c.address_line1),
                                 'city', coalesce(nullif(w.city, ''), c.city), 'phone', c.phone, 'vat_number', c.vat_number),
    'operator_no', (select e.number from public.employees e where e.company_id = r.company_id and e.user_id = auth.uid() and e.deleted_at is null limit 1),
    'branch_id', w.atk_branch_id, 'pos_id', r.atk_pos_id, 'application_id', app.atk_application_id(s.fiscal_environment),
    'location', coalesce(nullif(w.city, ''), nullif(c.city, ''), w.name),
    'certified', r.atk_certificate is not null and r.atk_cert_env = s.fiscal_environment, 'public_key', r.atk_public_key,
    'last_seq', coalesce((select max((o.atk ->> 'seq')::bigint) from public.pos_orders o
                           where o.register_id = r.id and o.atk ->> 'env' = s.fiscal_environment and (o.atk ->> 'pos_id')::int = r.atk_pos_id), 0),
    'missing', app.atk_missing(r.id),
    'exempt_taxes', coalesce((select jsonb_agg(t.id) from public.tax_codes t where t.company_id = r.company_id and t.is_exempt), '[]'),
    'default_type', s.atk_default_type,
    -- only what differs from "CP" and from the company's category, so the list stays small
    'units', coalesce((select jsonb_object_agg(v.id, coalesce(u.atk_unit, app.atk_unit_guess(u.code), 'CP'))
                         from public.product_variants v join public.products p on p.id = v.product_id join public.units_of_measure u on u.id = p.uom_id
                        where p.company_id = r.company_id and p.deleted_at is null and coalesce(u.atk_unit, app.atk_unit_guess(u.code), 'CP') <> 'CP'), '{}'),
    'types', coalesce((select jsonb_object_agg(v.id, pc.atk_type)
                         from public.product_variants v join public.products p on p.id = v.product_id join public.product_categories pc on pc.id = p.category_id
                        where p.company_id = r.company_id and p.deleted_at is null and pc.atk_type is not null and pc.atk_type <> s.atk_default_type), '{}'));
end $$;

/** the till asks after its coupon: has ATK taken it (so the coupon can be printed), and how many of its coupons ATK refused lately */
create or replace function public.atk_coupon_status(p_register uuid, p_coupon bigint) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.pos_registers; f public.fiscalization_records;
begin
  select * into r from public.pos_registers where id = p_register;
  if r.id is null then raise exception 'Till not found' using errcode = 'P0002'; end if;
  perform app.require_permission(r.company_id, 'pos.read');
  select fr.* into f from public.fiscalization_records fr join public.pos_orders o on o.id = fr.source_doc_id
   where fr.company_id = r.company_id and fr.source_doc_type = 'pos_order' and o.register_id = r.id and fr.iic = p_coupon::text
   order by fr.created_at desc limit 1;
  return jsonb_build_object('status', f.status, 'error', f.error_message, 'transaction', f.fic,
    'refused', (select count(*) from public.fiscalization_records x join public.pos_orders o on o.id = x.source_doc_id
                 where x.company_id = r.company_id and o.register_id = r.id and x.status = 'failed' and x.error_code like 'ATK\_4%'
                   and x.created_at > now() - interval '7 days'));
end $$;

/** a fiscal coupon printed again ("KOPJE E KUPONIT"): its head, and the coupon exactly as it was signed */
create or replace function public.atk_receipt(p_order uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare o public.pos_orders; r public.pos_registers; c public.companies; w public.warehouses;
begin
  select * into o from public.pos_orders where id = p_order;
  if o.id is null or o.atk is null then return null; end if;
  perform app.require_permission(o.company_id, 'pos.read');
  select * into r from public.pos_registers where id = o.register_id;
  select * into c from public.companies where id = o.company_id;
  select * into w from public.warehouses where id = r.warehouse_id;
  return jsonb_build_object('atk', o.atk, 'number', o.number, 'device_ref', o.device_ref, 'order_at', o.order_at, 'offline', o.offline_created,
    'nui', c.tax_number, 'cashier', (select full_name from public.profiles where id = o.cashier_id),
    'register', jsonb_build_object('code', r.code, 'name', r.name, 'receipt_header', r.receipt_header, 'receipt_footer', r.receipt_footer),
    'header', jsonb_build_object('legal_name', coalesce(c.legal_name, c.name), 'store', w.name, 'store_address', coalesce(nullif(w.address_line1, ''), c.address_line1),
                                 'city', coalesce(nullif(w.city, ''), c.city), 'phone', c.phone, 'vat_number', c.vat_number),
    'fiscal_status', (select f.status from public.fiscalization_records f where f.source_doc_id = o.id order by f.created_at desc limit 1));
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.atk_coupon_status(uuid,bigint)', 'public.atk_receipt(uuid)', 'public.atk_till(uuid)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
