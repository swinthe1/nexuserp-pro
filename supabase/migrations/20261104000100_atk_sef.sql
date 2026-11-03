-- =============================================================================
-- DrisPRO · 20261104000100 · Kosovo: DrisPRO as an electronic fiscal software (SEF) for ATK
--
-- How it works (ATK's technical documentation, github.com/fiskalizimi):
-- * every till (POS) has its own ECDSA P-256 key, made on that device and never sent anywhere;
--   ATK signs the till's certificate request (onboarding: /ca/verify, then /ca/signcsr);
-- * the till builds the coupon (Protobuf), signs it and prints the QR code itself, so it works
--   without internet; the sale carries the signed coupon to the server;
-- * the postier sends each signed coupon to ATK (/pos/coupon) and keeps ATK's transaction number.
-- Numbers ATK sees: BusinessId = NUI, BranchId = the store's ATK number, PosId = the till's ATK number,
-- ApplicationId = DrisPRO's number at ATK, FiscalizationNo = the business's number from EDI.
-- =============================================================================

-- ----------------------------------------------------------------------------- settings
alter table public.platform_settings
  add column if not exists atk_application_id_test bigint check (atk_application_id_test > 0),
  add column if not exists atk_application_id_prod bigint check (atk_application_id_prod > 0);
alter table public.company_settings add column if not exists atk_fiscalization_no text
  check (atk_fiscalization_no is null or atk_fiscalization_no ~ '^[0-9A-Za-z-]{1,40}$');
-- its own switch: Kosovo companies have "fiscalization" on from the start (for the old simulated queue), and turning
-- the tills into signing tills must be a choice, made once they are registered, never a surprise at the till
alter table public.company_settings add column if not exists atk_sef_enabled boolean not null default false;
alter table public.warehouses add column if not exists atk_branch_id smallint check (atk_branch_id between 1 and 999);
create unique index if not exists warehouses_atk_branch on public.warehouses (company_id, atk_branch_id) where atk_branch_id is not null and deleted_at is null;
alter table public.pos_registers
  add column if not exists atk_pos_id smallint check (atk_pos_id between 1 and 99),
  add column if not exists atk_certificate text,
  add column if not exists atk_public_key text,
  add column if not exists atk_cert_env text check (atk_cert_env in ('test', 'production')),
  add column if not exists atk_cert_at timestamptz,
  add column if not exists atk_cert_by uuid,
  add column if not exists atk_device text;
-- the signed coupon the till made: {env, coupon_id, seq, verification_no, details, signature, qr, total, tax}
alter table public.pos_orders add column if not exists atk jsonb;
create unique index if not exists pos_orders_atk_coupon on public.pos_orders (company_id, (atk ->> 'env'), ((atk ->> 'coupon_id')::bigint)) where atk is not null;

-- ----------------------------------------------------------------------------- the onboarding steps the postier runs
create table if not exists app.atk_jobs (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  register_id uuid not null references public.pos_registers(id),
  kind        text not null check (kind in ('verify', 'signcsr')),
  env         text not null check (env in ('test', 'production')),
  request     jsonb not null,
  status      text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  response    jsonb,
  error       text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  done_at     timestamptz
);
create index if not exists atk_jobs_queued on app.atk_jobs (created_at) where status = 'queued';
revoke all on app.atk_jobs from public, anon, authenticated;

create or replace function app.atk_base(p_env text) returns text language sql immutable set search_path = '' as $$
  select case when p_env = 'production' then 'https://fiskalizimi.atk-ks.org' else 'https://fiskalizimi-test.atk-ks.org' end
$$;

create or replace function app.atk_application_id(p_env text) returns bigint language sql stable security definer set search_path = '' as $$
  select case when p_env = 'production' then atk_application_id_prod else atk_application_id_test end from public.platform_settings limit 1
$$;

/** who sets the ATK numbers, and who registers a till (on that till) */
create or replace function app.atk_can(p_company uuid, p_what text) returns boolean language sql stable security definer set search_path = '' as $$
  select case p_what when 'setup' then app.has_permission(p_company, 'tax.write') or app.has_permission(p_company, 'admin.write')
                     else app.has_permission(p_company, 'tax.write') or app.has_permission(p_company, 'pos.approve') end
$$;

/** what is missing before a till can be registered with ATK (empty = ready) */
create or replace function app.atk_missing(p_register uuid) returns text[] language plpgsql stable security definer set search_path = '' as $$
declare r public.pos_registers; w public.warehouses; c public.companies; s public.company_settings; v text[] := '{}';
begin
  select * into r from public.pos_registers where id = p_register;
  select * into w from public.warehouses where id = r.warehouse_id;
  select * into c from public.companies where id = r.company_id;
  select * into s from public.company_settings where company_id = r.company_id;
  if c.country_code <> 'XK' then v := v || 'country'::text; end if;
  if coalesce(c.tax_number, '') !~ '^[0-9]{9}$' then v := v || 'nui'::text; end if;
  if s.atk_fiscalization_no is null then v := v || 'fiscalization_no'::text; end if;
  if app.atk_application_id(s.fiscal_environment) is null then v := v || 'application_id'::text; end if;
  if w.atk_branch_id is null then v := v || 'branch'::text; end if;
  if r.atk_pos_id is null then v := v || 'pos'::text; end if;
  return v;
end $$;

-- ----------------------------------------------------------------------------- the setup page
create or replace function public.atk_setup(p_company uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.companies; s public.company_settings;
begin
  perform app.require_any_permission(p_company, array['tax.read', 'pos.approve', 'admin.read']);
  select * into c from public.companies where id = p_company;
  select * into s from public.company_settings where company_id = p_company;
  return jsonb_build_object(
    'country', c.country_code, 'nui', c.tax_number, 'business', coalesce(c.legal_name, c.name),
    'enabled', s.fiscalization_enabled and s.atk_sef_enabled, 'training', c.is_training, 'env', s.fiscal_environment, 'fiscalization_no', s.atk_fiscalization_no,
    'application_id', app.atk_application_id(s.fiscal_environment),
    'application_ids', case when app.is_super_admin() then (select jsonb_build_object('test', atk_application_id_test, 'production', atk_application_id_prod) from public.platform_settings limit 1) end,
    'is_super_admin', app.is_super_admin(), 'can_setup', app.atk_can(p_company, 'setup'), 'can_register', app.atk_can(p_company, 'register'),
    'stores', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'code', w.code, 'name', w.name, 'city', w.city, 'atk_branch_id', w.atk_branch_id,
                                                           'tills', (select count(*) from public.pos_registers r where r.warehouse_id = w.id and r.deleted_at is null and r.is_active))
                                        order by w.atk_branch_id nulls last, w.code)
                          from public.warehouses w where w.company_id = p_company and w.deleted_at is null and w.is_active
                           and exists (select 1 from public.pos_registers r where r.warehouse_id = w.id and r.deleted_at is null and r.is_active)), '[]'),
    'tills', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'code', r.code, 'name', r.name, 'warehouse_id', r.warehouse_id, 'atk_pos_id', r.atk_pos_id,
                                                          'certified', r.atk_certificate is not null and r.atk_cert_env = s.fiscal_environment,
                                                          'cert_env', r.atk_cert_env, 'cert_at', r.atk_cert_at, 'device', r.atk_device, 'public_key', r.atk_public_key,
                                                          'cert_by', (select full_name from public.profiles where id = r.atk_cert_by), 'missing', app.atk_missing(r.id))
                                       order by r.code)
                         from public.pos_registers r where r.company_id = p_company and r.deleted_at is null and r.is_active), '[]'),
    'queue', (select jsonb_build_object('waiting', count(*) filter (where f.status in ('pending', 'sent')), 'failed', count(*) filter (where f.status = 'failed'),
                                        'sent_today', count(*) filter (where f.status = 'fiscalized' and f.fiscalized_at >= date_trunc('day', now())),
                                        'oldest', min(f.created_at) filter (where f.status in ('pending', 'sent', 'failed')))
                from public.fiscalization_records f where f.company_id = p_company and f.country_code = 'XK' and f.source_doc_type = 'pos_order'
                 -- receipts from before DrisPRO signed them were fiscalized by the shop's own fiscal device
                 and (f.request_payload ? 'atk' or f.error_code = 'NOT_SIGNED')));
end $$;

create or replace function public.atk_settings_save(p_company uuid, p_fiscalization_no text, p_env text default null, p_on boolean default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.atk_can(p_company, 'setup') then raise exception 'Only a manager with the tax rights sets the ATK numbers' using errcode = '42501'; end if;
  if p_env is not null and p_env not in ('test', 'production') then raise exception 'The environment is test or production' using errcode = '23514'; end if;
  if p_on and exists (select 1 from public.companies where id = p_company and is_training) then
    raise exception 'A training company never sends anything to ATK' using errcode = '23514';
  end if;
  update public.company_settings set atk_fiscalization_no = nullif(btrim(p_fiscalization_no), ''),
         fiscal_environment = coalesce(p_env, fiscal_environment),
         atk_sef_enabled = coalesce(p_on, atk_sef_enabled),
         fiscalization_enabled = fiscalization_enabled or coalesce(p_on, false)
   where company_id = p_company;
end $$;

create or replace function public.atk_numbers_save(p_company uuid, p_stores jsonb, p_tills jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare x jsonb;
begin
  if not app.atk_can(p_company, 'setup') then raise exception 'Only a manager with the tax rights sets the ATK numbers' using errcode = '42501'; end if;
  -- clear first so two stores can swap their numbers
  update public.warehouses w set atk_branch_id = null from jsonb_array_elements(coalesce(p_stores, '[]')) e
   where w.id = (e ->> 'id')::uuid and w.company_id = p_company;
  for x in select * from jsonb_array_elements(coalesce(p_stores, '[]')) loop
    update public.warehouses set atk_branch_id = nullif(x ->> 'atk_branch_id', '')::smallint where id = (x ->> 'id')::uuid and company_id = p_company;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p_tills, '[]')) loop
    -- a certificate names its till number: changing the number means registering the till again
    update public.pos_registers set atk_pos_id = nullif(x ->> 'atk_pos_id', '')::smallint,
           atk_certificate = case when atk_pos_id is distinct from nullif(x ->> 'atk_pos_id', '')::smallint then null else atk_certificate end
     where id = (x ->> 'id')::uuid and company_id = p_company;
  end loop;
  if exists (select 1 from public.pos_registers r where r.company_id = p_company and r.deleted_at is null and r.atk_pos_id is not null
              group by r.warehouse_id, r.atk_pos_id having count(*) > 1) then
    raise exception 'Two tills of the same store have the same ATK number' using errcode = '23505';
  end if;
end $$;

create or replace function public.atk_platform_save(p_test bigint, p_production bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_super_admin() then raise exception 'Only the platform admin sets DrisPRO''s numbers at ATK' using errcode = '42501'; end if;
  update public.platform_settings set atk_application_id_test = p_test, atk_application_id_prod = p_production;
end $$;

-- ----------------------------------------------------------------------------- registering a till (run on that till)
create or replace function public.atk_onboard_verify(p_register uuid) returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.pos_registers; c public.companies; s public.company_settings; w public.warehouses; v_miss text[]; v_id uuid;
begin
  select * into r from public.pos_registers where id = p_register and deleted_at is null;
  if r.id is null then raise exception 'Till not found' using errcode = 'P0002'; end if;
  if not app.atk_can(r.company_id, 'register') then raise exception 'Only a store manager registers a till with ATK' using errcode = '42501'; end if;
  v_miss := app.atk_missing(p_register);
  if cardinality(v_miss) > 0 then raise exception 'Not ready for ATK yet: %', array_to_string(v_miss, ', ') using errcode = '23514'; end if;
  if exists (select 1 from app.atk_jobs where register_id = p_register and status in ('queued', 'running') and created_at > now() - interval '2 minutes') then
    raise exception 'This till is being registered already; wait a moment' using errcode = '55000';
  end if;
  select * into c from public.companies where id = r.company_id;
  select * into s from public.company_settings where company_id = r.company_id;
  select * into w from public.warehouses where id = r.warehouse_id;
  insert into app.atk_jobs (company_id, register_id, kind, env, request)
  values (r.company_id, p_register, 'verify', s.fiscal_environment, jsonb_build_object(
    'nui', c.tax_number, 'fiscalization_no', s.atk_fiscalization_no, 'pos_id', r.atk_pos_id, 'branch_id', w.atk_branch_id,
    'application_id', app.atk_application_id(s.fiscal_environment)))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.atk_onboard_csr(p_verify uuid, p_csr text, p_public_key text, p_device text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare j app.atk_jobs; v_id uuid;
begin
  select * into j from app.atk_jobs where id = p_verify and kind = 'verify';
  if j.id is null or j.created_by is distinct from auth.uid() then raise exception 'Start the registration again' using errcode = 'P0002'; end if;
  if j.status <> 'done' or j.done_at < now() - interval '30 minutes' then raise exception 'Start the registration again' using errcode = '55000'; end if;
  if p_csr !~ '^-----BEGIN CERTIFICATE REQUEST-----' or length(p_csr) > 4000 then raise exception 'The certificate request is not valid' using errcode = '23514'; end if;
  insert into app.atk_jobs (company_id, register_id, kind, env, request)
  values (j.company_id, j.register_id, 'signcsr', j.env, jsonb_build_object(
    'business_name', j.response ->> 'business_name', 'business_id', (j.request ->> 'nui')::bigint, 'branch_id', (j.request ->> 'branch_id')::bigint,
    'verification_code', j.response ->> 'verification_code', 'pos_id', (j.request ->> 'pos_id')::bigint,
    'application_id', (j.request ->> 'application_id')::bigint, 'csr', p_csr,
    -- kept for the till's record, not sent to ATK
    '_public_key', p_public_key, '_device', left(p_device, 120)))
  returning id into v_id;
  return v_id;
end $$;

/** the till asks how its step went: only the person who started it sees the answer */
create or replace function public.atk_job(p_id uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('status', status, 'error', error,
           'business_name', response ->> 'business_name', 'certificate', response ->> 'signed_certificate')
    from app.atk_jobs where id = p_id and created_by = auth.uid()
$$;

create or replace function public.atk_till_forget(p_register uuid) returns void language plpgsql security definer set search_path = '' as $$
declare r public.pos_registers;
begin
  select * into r from public.pos_registers where id = p_register;
  if r.id is null or not app.atk_can(r.company_id, 'register') then raise exception 'Only a store manager registers a till with ATK' using errcode = '42501'; end if;
  update public.pos_registers set atk_certificate = null, atk_public_key = null, atk_cert_env = null, atk_cert_at = null, atk_cert_by = null, atk_device = null
   where id = p_register;
end $$;

-- ----------------------------------------------------------------------------- what the till needs (kept on the device for offline work)
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
    'branch_id', w.atk_branch_id, 'pos_id', r.atk_pos_id, 'application_id', app.atk_application_id(s.fiscal_environment),
    'location', coalesce(nullif(w.city, ''), nullif(c.city, ''), w.name),
    'certified', r.atk_certificate is not null and r.atk_cert_env = s.fiscal_environment, 'public_key', r.atk_public_key,
    'last_seq', coalesce((select max((o.atk ->> 'seq')::bigint) from public.pos_orders o
                           where o.register_id = r.id and o.atk ->> 'env' = s.fiscal_environment and (o.atk ->> 'pos_id')::int = r.atk_pos_id), 0),
    'missing', app.atk_missing(r.id),
    'exempt_taxes', coalesce((select jsonb_agg(t.id) from public.tax_codes t where t.company_id = r.company_id and t.is_exempt), '[]'),
    -- the unit of each item that is not counted in pieces
    'units', coalesce((select jsonb_object_agg(v.id, coalesce(u.code, u.name)) from public.product_variants v join public.products p on p.id = v.product_id
                         join public.units_of_measure u on u.id = p.uom_id
                        where p.company_id = r.company_id and p.deleted_at is null and lower(u.code) not in ('pcs', 'cope', 'copë', 'pc', 'ea')), '{}'));
end $$;

-- ----------------------------------------------------------------------------- the sale brings its signed coupon
/** the coupon as the till signed it: only the known parts are kept */
create or replace function app.atk_coupon_of(r public.pos_registers, f jsonb) returns jsonb language plpgsql immutable set search_path = '' as $$
begin
  if f is null or jsonb_typeof(f) <> 'object' then return null; end if;
  if coalesce(f ->> 'env', '') not in ('test', 'production') or coalesce(f ->> 'coupon_id', '') !~ '^[0-9]{1,18}$'
     or coalesce(f ->> 'seq', '') !~ '^[0-9]{1,10}$' or coalesce(f ->> 'details', '') !~ '^[A-Za-z0-9+/=]+$' or length(f ->> 'details') not between 8 and 60000
     or coalesce(f ->> 'signature', '') !~ '^[A-Za-z0-9+/=]+$' or length(f ->> 'signature') not between 40 and 200 or coalesce(f ->> 'qr', '') !~ '^[A-Za-z0-9+/=]+\|[A-Za-z0-9+/=]+$' then
    raise exception 'The fiscal coupon of this sale is not complete' using errcode = '23514';
  end if;
  return jsonb_build_object('env', f ->> 'env', 'coupon_id', (f ->> 'coupon_id')::bigint, 'seq', (f ->> 'seq')::bigint, 'pos_id', (f ->> 'pos_id')::int,
    'branch_id', (f ->> 'branch_id')::int, 'verification_no', left(f ->> 'verification_no', 16), 'details', f ->> 'details', 'signature', f ->> 'signature',
    'qr', f ->> 'qr', 'type', (f ->> 'type')::int, 'reference_no', nullif(f ->> 'reference_no', '')::bigint,
    'total', (f ->> 'total')::bigint, 'tax', (f ->> 'tax')::bigint);
end $$;

do $patch$
declare d text;
begin
  d := pg_get_functiondef('public.pos_submit_order(jsonb)'::regprocedure);
  if position('app.atk_coupon_of' in d) > 0 then return; end if;
  if position('offline_created, device_ref, status)' in d) = 0 then raise exception 'pos_submit_order: anchor not found'; end if;
  d := replace(d, 'offline_created, device_ref, status)', 'offline_created, device_ref, status, atk)');
  if position($a$p->>'device_ref', 'draft')$a$ in d) = 0 then raise exception 'pos_submit_order: values anchor not found'; end if;
  d := replace(d, $a$p->>'device_ref', 'draft')$a$, $a$p->>'device_ref', 'draft', app.atk_coupon_of(r, p -> 'fiscal'))$a$);
  execute d;
end $patch$ language plpgsql;

-- ----------------------------------------------------------------------------- the queue: a Kosovo receipt carries its signed coupon
create or replace function app.tg_fiscal_record_fill() returns trigger language plpgsql security definer set search_path = '' as $$
declare p jsonb; a jsonb;
begin
  if new.request_payload is null then
    p := app.fiscal_payload(new.company_id, new.source_doc_type, new.source_doc_id);
    if new.country_code = 'XK' and new.source_doc_type = 'pos_order' then
      select o.atk into a from public.pos_orders o where o.id = new.source_doc_id;
      if a is not null then
        p := p || jsonb_build_object('atk', a);
        new.iic := (a ->> 'coupon_id');
        new.verification_code := a ->> 'verification_no';
        new.qr_url := a ->> 'qr';
      elsif exists (select 1 from public.company_settings where company_id = new.company_id and atk_sef_enabled) then
        -- a sale without a signed coupon (a till not registered with ATK): it cannot be sent
        new.status := 'failed';
        new.error_code := 'NOT_SIGNED';
        new.error_message := 'This receipt was made on a till that is not registered with ATK, so it has no signed coupon';
      end if;
    end if;
    new.request_payload := p;
    new.iic := coalesce(new.iic, case when new.country_code = 'AL' then upper(md5(p ->> 'iic_input')) end);
    new.tcr_code := coalesce(new.tcr_code, p ->> 'tcr');
    new.business_unit_code := coalesce(new.business_unit_code, p ->> 'business_unit');
    new.software_code := coalesce(new.software_code, p ->> 'software');
    new.is_subsequent := new.is_subsequent or coalesce((p ->> 'offline')::boolean, false);
  end if;
  return new;
end $$;

-- the ATK coupons go through the postier, never through the old queue (which simulates the test answers)
do $patch$
declare d text;
begin
  d := pg_get_functiondef('public.process_fiscal_queue(uuid,integer)'::regprocedure);
  if position('request_payload ? ''atk''' in d) > 0 then return; end if;
  if position($a$status in ('pending','failed')$a$ in d) = 0 then raise exception 'process_fiscal_queue: anchor not found'; end if;
  d := replace(d, $a$status in ('pending','failed')$a$, $a$status in ('pending','failed') and not (country_code = 'XK' and source_doc_type = 'pos_order' and request_payload ? 'atk')$a$);
  execute d;
end $patch$ language plpgsql;

-- ----------------------------------------------------------------------------- the postier
/** how long before a coupon ATK did not take is tried again: 1, 2, 5, 15, 30 minutes, then every hour */
create or replace function app.atk_backoff(p_attempts int) returns interval language sql immutable set search_path = '' as $$
  select case when p_attempts <= 0 then interval '0' when p_attempts = 1 then interval '1 minute' when p_attempts = 2 then interval '2 minutes'
              when p_attempts = 3 then interval '5 minutes' when p_attempts = 4 then interval '15 minutes' when p_attempts = 5 then interval '30 minutes'
              else interval '1 hour' end
$$;

/**
 * The next thing to send to ATK, or null after waiting: a registration step first (someone is waiting at the till),
 * then the oldest coupon. The server says where and what; the postier only posts it.
 */
create or replace function public.atk_wait(p_wait_ms int default 6000) returns jsonb language plpgsql security definer set search_path = '' as $$
declare j app.atk_jobs; f public.fiscalization_records; a jsonb;
        v_until timestamptz := clock_timestamp() + make_interval(secs => least(coalesce(p_wait_ms, 6000), 20000) / 1000.0);
begin
  if auth.uid() is not null then raise exception 'Only the server runs this' using errcode = '42501'; end if;
  loop
    select * into j from app.atk_jobs where status = 'queued' and created_at > now() - interval '5 minutes' order by created_at limit 1 for update skip locked;
    if j.id is not null then
      update app.atk_jobs set status = 'running' where id = j.id;
      return jsonb_build_object('kind', j.kind, 'id', j.id, 'method', 'POST',
        'url', app.atk_base(j.env) || case when j.kind = 'verify' then '/ca/verify/' || (j.request ->> 'nui') else '/ca/signcsr' end,
        'body', case when j.kind = 'verify' then jsonb_build_object('fiscalization_no', j.request ->> 'fiscalization_no', 'pos_id', (j.request ->> 'pos_id')::bigint,
                                                                    'branch_id', (j.request ->> 'branch_id')::bigint, 'application_id', (j.request ->> 'application_id')::bigint)
                     else j.request - '_public_key' - '_device' end);
    end if;
    -- a coupon still waiting, or one whose last try is old enough; one "sent" for 5 minutes without an answer is tried again
    select * into f from public.fiscalization_records
     where country_code = 'XK' and source_doc_type = 'pos_order' and request_payload ? 'atk'
       and ((status = 'pending') or (status = 'failed' and error_code is distinct from 'NOT_SIGNED' and coalesce(last_attempt_at, '-infinity') < now() - app.atk_backoff(attempt_count))
            or (status = 'sent' and last_attempt_at < now() - interval '5 minutes'))
     order by created_at limit 1 for update skip locked;
    if f.id is not null then
      a := f.request_payload -> 'atk';
      update public.fiscalization_records set status = 'sent', last_attempt_at = now() where id = f.id;
      return jsonb_build_object('kind', 'coupon', 'id', f.id, 'method', 'POST', 'url', app.atk_base(a ->> 'env') || '/pos/coupon',
        'body', jsonb_build_object('details', a ->> 'details', 'signature', a ->> 'signature'),
        -- in the test environment the citizen's scan is played too, so ATK's checks see both halves
        'citizen', case when a ->> 'env' = 'test' then jsonb_build_object('url', app.atk_base('test') || '/citizen/coupon',
                                                                          'body', jsonb_build_object('citizen_id', 1, 'qr_code', a ->> 'qr')) end);
    end if;
    exit when clock_timestamp() > v_until;
    perform pg_sleep(0.2);
  end loop;
  return null;
end $$;

/** ATK's answer: p_status is the HTTP status (0 when ATK could not be reached), p_body its JSON */
create or replace function public.atk_done(p_kind text, p_id uuid, p_status int, p_body jsonb default null, p_error text default null,
                                           p_citizen_status int default null, p_citizen_body jsonb default null) returns void
language plpgsql security definer set search_path = '' as $$
declare j app.atk_jobs; f public.fiscalization_records; v_ok boolean := p_status between 200 and 299; v_msg text; o public.pos_orders;
begin
  if auth.uid() is not null then raise exception 'Only the server runs this' using errcode = '42501'; end if;
  v_msg := coalesce(nullif(p_body ->> 'error', ''), nullif(p_body ->> 'message', ''), p_error,
                    case when p_status = 0 then 'ATK could not be reached' when not v_ok then 'ATK answered ' || p_status end);
  if p_kind in ('verify', 'signcsr') then
    select * into j from app.atk_jobs where id = p_id for update;
    if j.id is null then return; end if;
    if v_ok and p_kind = 'verify' and (p_body ->> 'verification_code') is null then v_ok := false; v_msg := coalesce(v_msg, 'ATK gave no verification code'); end if;
    if v_ok and p_kind = 'signcsr' and (p_body ->> 'signed_certificate') is null then v_ok := false; v_msg := coalesce(v_msg, 'ATK gave no certificate'); end if;
    update app.atk_jobs set status = case when v_ok then 'done' else 'failed' end, done_at = now(),
           response = case when v_ok then p_body end, error = case when v_ok then null else left(v_msg, 500) end
     where id = p_id;
    if v_ok and p_kind = 'signcsr' then
      update public.pos_registers set atk_certificate = p_body ->> 'signed_certificate', atk_public_key = j.request ->> '_public_key',
             atk_device = j.request ->> '_device', atk_cert_env = j.env, atk_cert_at = now(), atk_cert_by = j.created_by
       where id = j.register_id;
    end if;
    return;
  end if;

  select * into f from public.fiscalization_records where id = p_id for update;
  if f.id is null then return; end if;
  if v_ok then
    update public.fiscalization_records set status = 'fiscalized', fiscalized_at = now(), attempt_count = attempt_count + 1, last_attempt_at = now(),
           fic = coalesce(p_body ->> 'transaction_id', p_body ->> 'transactionId'), error_code = null, error_message = null,
           response_payload = jsonb_build_object('coupon', p_body, 'citizen', case when p_citizen_status is not null then jsonb_build_object('status', p_citizen_status, 'body', p_citizen_body) end)
     where id = p_id;
    update public.pos_orders set fiscal_status = 'fiscalized' where id = f.source_doc_id;
  else
    update public.fiscalization_records set status = 'failed', attempt_count = attempt_count + 1, last_attempt_at = now(),
           error_code = case when p_status = 0 then 'UNREACHABLE' else 'ATK_' || p_status end, error_message = left(v_msg, 500),
           response_payload = p_body
     where id = p_id;
    update public.pos_orders set fiscal_status = 'failed' where id = f.source_doc_id;
    -- the first refusal of a coupon (not a lost connection) is told to the people who look after the tax
    if p_status between 400 and 499 and f.attempt_count = 0 then
      select * into o from public.pos_orders where id = f.source_doc_id;
      perform app.notify_permission(f.company_id, 'tax.write', 'warning', 'ATK refused a receipt: ' || coalesce(o.number, o.device_ref, ''),
                                    left(v_msg, 300), '/tax/fiscalization');
    end if;
  end if;
end $$;

revoke execute on function public.atk_wait(int) from public, anon, authenticated;
grant execute on function public.atk_wait(int) to service_role;
revoke execute on function public.atk_done(text, uuid, int, jsonb, text, int, jsonb) from public, anon, authenticated;
grant execute on function public.atk_done(text, uuid, int, jsonb, text, int, jsonb) to service_role;
revoke execute on function public.atk_platform_save(bigint, bigint) from public, anon;
do $$
declare f text;
begin
  foreach f in array array['public.atk_setup(uuid)', 'public.atk_settings_save(uuid,text,text,boolean)', 'public.atk_numbers_save(uuid,jsonb,jsonb)',
                           'public.atk_platform_save(bigint,bigint)', 'public.atk_onboard_verify(uuid)', 'public.atk_onboard_csr(uuid,text,text,text)',
                           'public.atk_job(uuid)', 'public.atk_till_forget(uuid)', 'public.atk_till(uuid)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
