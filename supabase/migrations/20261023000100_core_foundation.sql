-- =============================================================================
-- NexusERP Pro · 0100 · Core foundation
--
-- Tenancy (companies, members, roles, permissions), the RLS helper functions,
-- the table-registration convention used by every business table, audit log,
-- soft deletes, document numbering, status-flow enforcement, approvals,
-- attachments, activity timeline, notifications and saved table views.
--
-- CONVENTIONS (apply to every company-scoped table in later migrations)
--   * id uuid primary key, company_id uuid not null references companies.
--   * Immediately after CREATE TABLE we call app.register_table(...), which:
--       - adds created_at/by, updated_at/by (+ deleted_at/by when soft-deletable)
--       - adds UNIQUE (company_id, id) so children can use COMPOSITE foreign
--         keys (company_id, x_id) -> parent(company_id, id). This makes it
--         impossible at the database level to link rows across companies.
--       - attaches audit, soft-delete / immutability and company-guard triggers
--       - enables RLS and creates permission-based policies
--   * Statements issued by SECURITY DEFINER system functions run as the table
--     owner, so "current_user not in (authenticated, anon)" means "system
--     context": business-rule guards only restrict direct client statements.
-- =============================================================================

create extension if not exists pg_trgm    with schema extensions;
create extension if not exists btree_gist with schema extensions;

create schema if not exists app;
comment on schema app is 'Private helpers for RLS, triggers and system logic. Not exposed through the API.';
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;
alter default privileges in schema app revoke execute on functions from public;
alter default privileges in schema app grant execute on functions to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Global reference tables (not company-scoped, read-only for clients)
-- -----------------------------------------------------------------------------
create table public.currencies (
  code      char(3) primary key,
  name      text not null,
  symbol    text not null,
  decimals  smallint not null default 2 check (decimals between 0 and 4),
  is_active boolean not null default true
);

create table public.permissions (
  key         text primary key,               -- e.g. 'inventory.write'
  module      text not null,
  action      text not null check (action in ('read','write','delete','approve')),
  description text
);

create table public.roles (
  id            uuid primary key default gen_random_uuid(),
  key           text not null unique,
  name          text not null,
  description   text,
  is_assignable boolean not null default true, -- super_admin is a platform flag, never assigned per company
  sort_order    smallint not null default 0
);

-- permission may be an exact key or a pattern: 'module.*', '*.read', '*'
create table public.role_permissions (
  role_id    uuid not null references public.roles(id) on delete cascade,
  permission text not null,
  primary key (role_id, permission)
);

create table public.document_types (
  key             text primary key,           -- 'sales_order', 'purchase_order', ...
  name            text not null,
  module          text not null,              -- permission module that owns it
  table_name      text,                       -- physical table (for approvals / traceability)
  default_prefix  text not null,
  pending_status  text,                       -- status while awaiting approval
  approved_status text,                       -- status set on final approval
  rejected_status text                        -- status set on rejection
);

-- Allowed status transitions; from_status '__init__' lists valid initial statuses
create table public.status_transitions (
  doc_type    text not null references public.document_types(key) on delete cascade,
  from_status text not null,
  to_status   text not null,
  primary key (doc_type, from_status, to_status)
);

-- -----------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  email             text,
  full_name         text,
  avatar_url        text,
  phone             text,
  locale            text not null default 'en' check (locale in ('en','sq')),
  theme             text not null default 'system' check (theme in ('light','dark','system')),
  is_super_admin    boolean not null default false,
  last_company_id   uuid,
  preferences       jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Companies (the tenant)
-- -----------------------------------------------------------------------------
create table public.companies (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  legal_name             text,
  slug                   text unique,
  tax_number             text,                -- NIPT (AL) / NUI (XK)
  vat_number             text,
  business_number        text,                -- NRB (XK business registration)
  country_code           char(2) not null default 'AL',
  base_currency          char(3) not null references public.currencies(code),
  address_line1          text,
  address_line2          text,
  city                   text,
  postal_code            text,
  phone                  text,
  email                  text,
  website                text,
  logo_path              text,
  timezone               text not null default 'Europe/Tirane',
  fiscal_year_start_month smallint not null default 1 check (fiscal_year_start_month between 1 and 12),
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  created_by             uuid,
  updated_at             timestamptz not null default now(),
  updated_by             uuid,
  deleted_at             timestamptz,
  deleted_by             uuid
);
alter table public.profiles
  add constraint profiles_last_company_fk foreign key (last_company_id) references public.companies(id) on delete set null;

create table public.company_members (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  user_id       uuid references auth.users(id) on delete cascade,
  invited_email text,
  status        text not null default 'active' check (status in ('invited','active','suspended')),
  joined_at     timestamptz,
  check (user_id is not null or invited_email is not null)
);

create table public.member_roles (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  member_id  uuid not null,
  role_id    uuid not null references public.roles(id),
  unique (member_id, role_id)
);

-- Registry of every table that went through app.register_table()
create table app.table_registry (
  table_name   text primary key,
  module       text not null,
  read_module  text not null,
  soft_delete  boolean not null,
  immutable    boolean not null
);

-- =============================================================================
-- RLS helper functions
-- All SECURITY DEFINER (they read membership tables that are themselves
-- protected by RLS) with an empty search_path. Policies call them wrapped in
-- (select ...) so Postgres evaluates them once per statement (InitPlan), not
-- once per row.
-- =============================================================================
create or replace function app.is_super_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select p.is_super_admin from public.profiles p where p.id = auth.uid()), false)
$$;

-- Companies the current user is an active member of
create or replace function app.my_company_ids()
returns uuid[] language sql stable security definer set search_path = '' as $$
  select case when app.is_super_admin()
    then (select coalesce(array_agg(c.id), '{}') from public.companies c where c.deleted_at is null)
    else (select coalesce(array_agg(m.company_id), '{}')
            from public.company_members m
            join public.companies c on c.id = m.company_id and c.deleted_at is null
           where m.user_id = auth.uid() and m.status = 'active')
  end
$$;

-- Companies in which the current user holds permission p_perm ('module.action').
-- Matches exact keys and the patterns 'module.*', '*.action' and '*'.
create or replace function app.company_ids_with(p_perm text)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select case when app.is_super_admin()
    then (select coalesce(array_agg(c.id), '{}') from public.companies c where c.deleted_at is null)
    else (
      select coalesce(array_agg(distinct m.company_id), '{}')
        from public.company_members m
        join public.companies c        on c.id = m.company_id and c.deleted_at is null
        join public.member_roles mr    on mr.member_id = m.id and mr.company_id = m.company_id
        join public.role_permissions rp on rp.role_id = mr.role_id
       where m.user_id = auth.uid()
         and m.status = 'active'
         and rp.permission in (p_perm,
                               split_part(p_perm, '.', 1) || '.*',
                               '*.' || split_part(p_perm, '.', 2),
                               '*'))
  end
$$;

create or replace function app.has_permission(p_company uuid, p_perm text)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_company = any (app.company_ids_with(p_perm))
$$;

create or replace function app.require_permission(p_company uuid, p_perm text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null and current_user in ('authenticated','anon') then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if auth.uid() is not null and not app.has_permission(p_company, p_perm) then
    raise exception 'Permission denied: % required', p_perm using errcode = '42501';
  end if;
end $$;

create or replace function app.has_role(p_company uuid, p_role_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.company_members m
      join public.member_roles mr on mr.member_id = m.id
      join public.roles r on r.id = mr.role_id
     where m.company_id = p_company and m.user_id = auth.uid()
       and m.status = 'active' and r.key = p_role_key)
$$;

-- true when the statement comes straight from an API client (not a system function)
create or replace function app.is_client_context()
returns boolean language sql stable as $$
  select current_user in ('authenticated', 'anon')
$$;

-- =============================================================================
-- Generic triggers
-- =============================================================================
create or replace function app.tg_set_audit_fields()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := coalesce(auth.uid(), new.created_by);  -- clients cannot spoof authorship
    new.updated_at := new.created_at;
    new.updated_by := new.created_by;
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.updated_at := now();
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  end if;
  return new;
end $$;

create or replace function app.tg_protect_company()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.company_id is distinct from old.company_id then
    raise exception 'company_id cannot be changed' using errcode = '42501';
  end if;
  return new;
end $$;

-- Applies the soft delete on behalf of the trigger. Re-checks permission so it
-- cannot be abused if ever called directly.
create or replace function app.soft_delete_apply(p_table text, p_id uuid, p_company uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_module text;
begin
  select module into v_module from app.table_registry where table_name = p_table;
  if v_module is null then raise exception 'Table % is not registered', p_table; end if;
  if auth.uid() is not null and not app.has_permission(p_company, v_module || '.delete') then
    raise exception 'Permission denied: %.delete required', v_module using errcode = '42501';
  end if;
  execute format('update public.%I set deleted_at = now(), deleted_by = auth.uid() where id = $1 and deleted_at is null', p_table)
    using p_id;
end $$;

-- DELETE on a soft-deletable table becomes an UPDATE of deleted_at.
-- A genuine purge is only possible from a non-client role with
-- SET LOCAL app.allow_hard_delete = 'on' (maintenance / GDPR erasure).
create or replace function app.tg_soft_delete()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not app.is_client_context() and coalesce(current_setting('app.allow_hard_delete', true), '') = 'on' then
    return old;
  end if;
  perform app.soft_delete_apply(tg_table_name, old.id, old.company_id);
  return null;  -- cancel the physical delete
end $$;

create or replace function app.tg_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not app.is_client_context() and coalesce(current_setting('app.allow_hard_delete', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception '% rows are immutable; post a reversing entry instead', tg_table_name using errcode = '42501';
end $$;

-- -----------------------------------------------------------------------------
-- Audit log (append-only)
-- -----------------------------------------------------------------------------
create table public.audit_log (
  id             bigint generated always as identity primary key,
  company_id     uuid,
  table_name     text not null,
  record_id      uuid,
  action         text not null check (action in ('INSERT','UPDATE','DELETE','SOFT_DELETE','RESTORE')),
  old_data       jsonb,
  new_data       jsonb,
  changed_fields text[],
  actor_id       uuid,
  tx_id          bigint not null default txid_current(),
  occurred_at    timestamptz not null default now()
);
create index audit_log_record_idx  on public.audit_log (table_name, record_id, occurred_at desc);
create index audit_log_company_idx on public.audit_log (company_id, occurred_at desc);
create index audit_log_actor_idx   on public.audit_log (actor_id, occurred_at desc);

create or replace function app.tg_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb; v_new jsonb; v_action text := tg_op; v_changed text[];
begin
  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;

  if tg_op = 'UPDATE' then
    select array_agg(k order by k) into v_changed
      from jsonb_object_keys(v_new) as k
     where k not in ('updated_at', 'updated_by') and v_new -> k is distinct from v_old -> k;
    if v_changed is null then return null; end if;   -- no-op update, nothing to log
    if v_old ->> 'deleted_at' is null and v_new ->> 'deleted_at' is not null then v_action := 'SOFT_DELETE';
    elsif v_old ->> 'deleted_at' is not null and v_new ->> 'deleted_at' is null then v_action := 'RESTORE';
    end if;
  end if;

  insert into public.audit_log (company_id, table_name, record_id, action, old_data, new_data, changed_fields, actor_id)
  values (
    coalesce(v_new ->> 'company_id', v_old ->> 'company_id',
             case when tg_table_name = 'companies' then coalesce(v_new ->> 'id', v_old ->> 'id') end)::uuid,
    tg_table_name,
    coalesce(v_new ->> 'id', v_old ->> 'id')::uuid,
    v_action, v_old, v_new, v_changed, auth.uid());
  return null;
end $$;

create trigger trg_immutable before update or delete on public.audit_log
  for each row execute function app.tg_immutable();

-- =============================================================================
-- app.register_table — the one convention every company table goes through
-- =============================================================================
create or replace function app.register_table(
  p_table        regclass,
  p_module       text,                    -- write/delete permission module
  p_read_module  text    default null,    -- read module (defaults to p_module)
  p_soft_delete  boolean default true,    -- DELETE becomes deleted_at
  p_client_write boolean default true,    -- false: only system functions write
  p_immutable    boolean default false,   -- append-only (ledger-style)
  p_audit        boolean default true,    -- row-level audit trail
  p_policies     boolean default true     -- false: caller writes custom policies
) returns void
language plpgsql set search_path = '' as $$
declare
  v_name   text;
  v_read   text := coalesce(p_read_module, p_module);
  v_select text;
begin
  select c.relname into v_name from pg_catalog.pg_class c where c.oid = p_table;

  insert into app.table_registry values (v_name, p_module, v_read, p_soft_delete, p_immutable)
  on conflict (table_name) do update
    set module = excluded.module, read_module = excluded.read_module,
        soft_delete = excluded.soft_delete, immutable = excluded.immutable;

  execute format($f$
    alter table %1$s
      add column if not exists created_at timestamptz not null default now(),
      add column if not exists created_by uuid default auth.uid(),
      add column if not exists updated_at timestamptz not null default now(),
      add column if not exists updated_by uuid default auth.uid()
  $f$, p_table);
  if p_soft_delete then
    execute format('alter table %s add column if not exists deleted_at timestamptz, add column if not exists deleted_by uuid', p_table);
  end if;

  execute format('alter table %s add constraint %I unique (company_id, id)', p_table, v_name || '_company_id_id_key');

  execute format('create trigger trg_00_audit_fields before insert or update on %s for each row execute function app.tg_set_audit_fields()', p_table);
  execute format('create trigger trg_01_protect_company before update on %s for each row execute function app.tg_protect_company()', p_table);
  if p_immutable then
    execute format('create trigger trg_02_immutable before update or delete on %s for each row execute function app.tg_immutable()', p_table);
  elsif p_soft_delete then
    execute format('create trigger trg_02_soft_delete before delete on %s for each row execute function app.tg_soft_delete()', p_table);
  end if;
  if p_audit then
    execute format('create trigger trg_99_audit after insert or update or delete on %s for each row execute function app.tg_audit()', p_table);
  end if;

  execute format('alter table %s enable row level security', p_table);
  execute format('revoke all on %s from anon', p_table);
  execute format('grant select, insert, update, delete on %s to authenticated', p_table);
  execute format('grant all on %s to service_role', p_table);

  if not p_policies then return; end if;

  v_select := format('company_id = any ((select app.company_ids_with(%L))::uuid[])', v_read || '.read');
  if p_soft_delete then
    -- soft-deleted rows are only visible to holders of audit.read (admins, auditors)
    v_select := v_select || ' and (deleted_at is null or company_id = any ((select app.company_ids_with(''audit.read''))::uuid[]))';
  end if;
  execute format('create policy %I on %s for select to authenticated using (%s)', v_name || '_select', p_table, v_select);

  if p_client_write then
    execute format('create policy %I on %s for insert to authenticated with check (company_id = any ((select app.company_ids_with(%L))::uuid[]))',
                   v_name || '_insert', p_table, p_module || '.write');
    if not p_immutable then
      execute format('create policy %I on %s for update to authenticated using (company_id = any ((select app.company_ids_with(%L))::uuid[])) with check (company_id = any ((select app.company_ids_with(%L))::uuid[]))',
                     v_name || '_update', p_table, p_module || '.write', p_module || '.write');
      execute format('create policy %I on %s for delete to authenticated using (company_id = any ((select app.company_ids_with(%L))::uuid[]))',
                     v_name || '_delete', p_table, p_module || case when p_soft_delete then '.delete' else '.write' end);
    end if;
  end if;
end $$;

-- =============================================================================
-- Line-table helpers shared by all document modules
-- =============================================================================

-- Lines of a document may only be changed by clients while the header is in an
-- editable status. args: header table, fk column, editable statuses (csv)
create or replace function app.tg_guard_lines()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_header uuid := case when tg_op = 'DELETE' then (to_jsonb(old) ->> tg_argv[1])::uuid
                        else (to_jsonb(new) ->> tg_argv[1])::uuid end;
  v_status text;
begin
  if not app.is_client_context() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  execute format('select status from public.%I where id = $1', tg_argv[0]) into v_status using v_header;
  if v_status is not null and not (v_status = any (string_to_array(coalesce(tg_argv[2], 'draft'), ','))) then
    raise exception 'Lines cannot be modified while the document is %', v_status using errcode = '55000';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

-- Snapshot the tax rate from tax_codes onto the line (rates may change later)
create or replace function app.tg_snapshot_tax_rate()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.tax_code_id is distinct from old.tax_code_id then
    new.tax_rate := coalesce((select t.rate from public.tax_codes t
                               where t.id = new.tax_code_id and t.company_id = new.company_id), 0);
  end if;
  return new;
end $$;

-- Recalculate header totals from lines. args: header table, fk column
create or replace function app.tg_recalc_totals()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_ids uuid[];
begin
  v_ids := array_remove(array[
    case when tg_op <> 'INSERT' then (to_jsonb(old) ->> tg_argv[1])::uuid end,
    case when tg_op <> 'DELETE' then (to_jsonb(new) ->> tg_argv[1])::uuid end], null);
  execute format($f$
    update public.%1$I h set
      subtotal       = coalesce(s.sub, 0),
      tax_total      = coalesce(s.tax, 0),
      total          = coalesce(s.tot, 0),
      discount_total = coalesce(s.disc, 0)
    from (select x.id,
                 (select sum(l.line_subtotal) from public.%2$I l where l.%3$I = x.id) as sub,
                 (select sum(l.tax_amount)    from public.%2$I l where l.%3$I = x.id) as tax,
                 (select sum(l.line_total)    from public.%2$I l where l.%3$I = x.id) as tot,
                 (select sum(round(l.quantity * l.unit_price, 2)
                             - round(l.quantity * l.unit_price * (1 - l.discount_pct / 100), 2))
                    from public.%2$I l where l.%3$I = x.id) as disc
            from unnest($1) as x(id)) s
    where h.id = s.id
  $f$, tg_argv[0], tg_table_name, tg_argv[1]) using v_ids;
  return null;
end $$;

-- =============================================================================
-- Document numbering (gapless, per company, per document type, yearly reset)
-- =============================================================================
create table public.document_sequences (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id),
  doc_type     text not null references public.document_types(key),
  prefix       text not null,
  include_year boolean not null default true,
  padding      smallint not null default 5 check (padding between 1 and 12),
  reset_policy text not null default 'yearly' check (reset_policy in ('yearly','never')),
  unique (company_id, doc_type)
);

-- One counter per period, so back-dated documents never collide with
-- numbers already issued in another year.
create table public.document_sequence_counters (
  company_id uuid not null references public.companies(id),
  doc_type   text not null references public.document_types(key),
  period_key text not null,                   -- 'YYYY' or '' when never reset
  next_value bigint not null default 1 check (next_value > 0),
  primary key (company_id, doc_type, period_key)
);

-- The row lock makes numbering gapless: a rolled-back transaction also rolls
-- back the increment (required for fiscal invoice series in AL/XK).
create or replace function app.next_document_number(p_company uuid, p_doc_type text, p_date date default current_date)
returns text language plpgsql security definer set search_path = '' as $$
declare s public.document_sequences; v_period text; v_value bigint;
begin
  if auth.uid() is not null and not (p_company = any (app.my_company_ids())) then
    raise exception 'Not a member of this company' using errcode = '42501';
  end if;
  insert into public.document_sequences (company_id, doc_type, prefix)
  select p_company, dt.key, dt.default_prefix from public.document_types dt where dt.key = p_doc_type
  on conflict (company_id, doc_type) do nothing;

  select * into s from public.document_sequences where company_id = p_company and doc_type = p_doc_type;
  if not found then raise exception 'Unknown document type %', p_doc_type; end if;
  v_period := case when s.reset_policy = 'yearly' then to_char(p_date, 'YYYY') else '' end;

  insert into public.document_sequence_counters (company_id, doc_type, period_key)
  values (p_company, p_doc_type, v_period) on conflict do nothing;
  update public.document_sequence_counters
     set next_value = next_value + 1
   where company_id = p_company and doc_type = p_doc_type and period_key = v_period
  returning next_value - 1 into v_value;

  return s.prefix
      || case when s.include_year then to_char(p_date, 'YYYY') || '-' else '' end
      || lpad(v_value::text, s.padding, '0');
end $$;

-- args: doc_type, date column. A 'document_type' column on the row overrides
-- the doc_type (one table can hold invoices + credit notes with own series).
create or replace function app.tg_assign_number()
returns trigger language plpgsql set search_path = '' as $$
declare v_row jsonb := to_jsonb(new);
begin
  if tg_op = 'INSERT' then
    if coalesce(new.number, '') = '' then
      new.number := app.next_document_number(
        new.company_id,
        coalesce(v_row ->> 'document_type', tg_argv[0]),
        coalesce((v_row ->> tg_argv[1])::date, current_date));
    end if;
  elsif new.number is distinct from old.number then
    raise exception 'Document numbers cannot be changed' using errcode = '42501';
  end if;
  return new;
end $$;

-- =============================================================================
-- Activity timeline (comments + automatic status changes)
-- =============================================================================
create table public.entity_activities (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  entity_type   text not null,               -- table name, e.g. 'sales_orders'
  entity_id     uuid not null,
  activity_type text not null default 'comment'
                check (activity_type in ('comment','status_change','system','email','call','meeting','task','approval')),
  title         text,
  body          text,
  metadata      jsonb not null default '{}'::jsonb,
  occurred_at   timestamptz not null default now()
);
select app.register_table('public.entity_activities', 'collab', p_soft_delete => false, p_immutable => true, p_audit => false);
create index entity_activities_entity_idx on public.entity_activities (company_id, entity_type, entity_id, occurred_at desc);

-- Validates status changes against status_transitions and logs them to the
-- timeline. args: doc_type
create or replace function app.tg_status_flow()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_type text := coalesce(to_jsonb(new) ->> 'document_type', tg_argv[0]);
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.status_transitions
                    where doc_type = v_type and from_status = '__init__' and to_status = new.status) then
      raise exception 'Invalid initial status "%" for %', new.status, v_type using errcode = '23514';
    end if;
  elsif new.status is distinct from old.status then
    if not exists (select 1 from public.status_transitions
                    where doc_type = v_type and from_status = old.status and to_status = new.status) then
      raise exception 'Invalid status transition for %: % -> %', v_type, old.status, new.status using errcode = '23514';
    end if;
    insert into public.entity_activities (company_id, entity_type, entity_id, activity_type, title, metadata)
    values (new.company_id, tg_table_name, new.id, 'status_change',
            initcap(replace(old.status, '_', ' ')) || ' → ' || initcap(replace(new.status, '_', ' ')),
            jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  return new;
end $$;

-- Wires numbering + status flow + standard indexes onto a document header table
create or replace function app.register_document(p_table regclass, p_doc_type text, p_date_column text)
returns void language plpgsql set search_path = '' as $$
declare v_name text; v_soft boolean;
begin
  select c.relname into v_name from pg_catalog.pg_class c where c.oid = p_table;
  execute format('create trigger trg_10_number before insert or update of number on %s for each row execute function app.tg_assign_number(%L, %L)',
                 p_table, p_doc_type, p_date_column);
  execute format('create trigger trg_11_status_flow before insert or update of status on %s for each row execute function app.tg_status_flow(%L)',
                 p_table, p_doc_type);
  select exists (select 1 from pg_catalog.pg_attribute where attrelid = p_table and attname = 'deleted_at' and not attisdropped)
    into v_soft;
  execute format('create unique index %I on %s (company_id, number) %s', v_name || '_number_key', p_table,
                 case when v_soft then 'where deleted_at is null' else '' end);
  execute format('create index %I on %s (company_id, status)', v_name || '_status_idx', p_table);
end $$;

-- Wires line guards / tax snapshot / header totals onto a line table
create or replace function app.register_lines(
  p_table regclass, p_header text, p_fk text,
  p_editable_statuses text default 'draft', p_totals boolean default true, p_tax boolean default true)
returns void language plpgsql set search_path = '' as $$
begin
  execute format('create trigger trg_05_guard_lines before insert or update or delete on %s for each row execute function app.tg_guard_lines(%L, %L, %L)',
                 p_table, p_header, p_fk, p_editable_statuses);
  if p_tax then
    execute format('create trigger trg_06_tax_rate before insert or update of tax_code_id on %s for each row execute function app.tg_snapshot_tax_rate()', p_table);
  end if;
  if p_totals then
    execute format('create trigger trg_90_totals after insert or update or delete on %s for each row execute function app.tg_recalc_totals(%L, %L)',
                   p_table, p_header, p_fk);
  end if;
  execute format('create index on %s (%I)', p_table, p_fk);
end $$;

-- Seeds allowed transitions. edges like 'draft>posted'
create or replace function app.define_flow(p_doc_type text, p_initial text[], p_edges text[])
returns void language sql set search_path = '' as $$
  insert into public.status_transitions (doc_type, from_status, to_status)
  select p_doc_type, '__init__', s from unnest(p_initial) s
  union
  select p_doc_type, split_part(e, '>', 1), split_part(e, '>', 2) from unnest(p_edges) e
  on conflict do nothing;
$$;

-- =============================================================================
-- Register core company tables
-- =============================================================================
-- companies: not registered (it *is* the tenant) — triggers and policies by hand
create trigger trg_00_audit_fields before insert or update on public.companies
  for each row execute function app.tg_set_audit_fields();
create trigger trg_99_audit after insert or update or delete on public.companies
  for each row execute function app.tg_audit();

select app.register_table('public.company_members', 'admin', 'core');
alter table public.company_members add constraint company_members_company_fk
  foreign key (company_id) references public.companies(id);
create unique index company_members_user_key on public.company_members (company_id, user_id)
  where deleted_at is null and user_id is not null;
create unique index company_members_invite_key on public.company_members (company_id, lower(invited_email))
  where deleted_at is null and status = 'invited';
create index company_members_user_idx on public.company_members (user_id) where deleted_at is null;

select app.register_table('public.member_roles', 'admin', 'core', p_soft_delete => false);
alter table public.member_roles
  add constraint member_roles_member_fk foreign key (company_id, member_id)
      references public.company_members(company_id, id) on delete cascade;

-- Roles that are not assignable (super_admin) can't be granted inside a company
create or replace function app.tg_member_role_check()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not (select is_assignable from public.roles where id = new.role_id) then
    raise exception 'Role cannot be assigned within a company' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_04_role_check before insert or update on public.member_roles
  for each row execute function app.tg_member_role_check();

-- A soft-deleted membership loses access immediately
create or replace function app.tg_membership_deleted()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    new.status := 'suspended';
  end if;
  return new;
end $$;
create trigger trg_03_membership_deleted before update on public.company_members
  for each row execute function app.tg_membership_deleted();

create table public.company_settings (
  id                            uuid primary key default gen_random_uuid(),
  company_id                    uuid not null unique references public.companies(id),
  allow_negative_stock          boolean not null default false,
  costing_method                text not null default 'weighted_average' check (costing_method in ('weighted_average')),
  amount_decimals               smallint not null default 2,
  quantity_decimals             smallint not null default 4,
  match_qty_tolerance_pct       numeric(5,2) not null default 0,
  match_price_tolerance_pct     numeric(5,2) not null default 2,
  default_sales_tax_code_id     uuid,
  default_purchase_tax_code_id  uuid,
  default_warehouse_id          uuid,
  fiscalization_enabled         boolean not null default false,
  fiscal_environment            text not null default 'test' check (fiscal_environment in ('test','production')),
  fiscal_business_unit_code     text,          -- AL: business unit (njësia e biznesit)
  fiscal_software_code          text,          -- AL: software code
  fiscal_maintainer_code        text,          -- AL: maintainer code
  invoice_footer                text,
  extra                         jsonb not null default '{}'::jsonb
);
select app.register_table('public.company_settings', 'admin', 'core', p_soft_delete => false);

select app.register_table('public.document_sequences', 'admin', 'core', p_soft_delete => false);
alter table public.document_sequence_counters enable row level security;
revoke all on public.document_sequence_counters from anon, authenticated;
grant select on public.document_sequence_counters to authenticated;
create policy document_sequence_counters_select on public.document_sequence_counters for select to authenticated
  using (company_id = any ((select app.company_ids_with('admin.read'))::uuid[]));

create table public.exchange_rates (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  currency_code char(3) not null references public.currencies(code),
  rate_date     date not null,
  rate          numeric(18,8) not null check (rate > 0),  -- base currency per 1 unit of currency_code
  source        text not null default 'manual' check (source in ('manual','central_bank','api'))
);
select app.register_table('public.exchange_rates', 'finance', 'core', p_soft_delete => false);
create unique index exchange_rates_key on public.exchange_rates (company_id, currency_code, rate_date);

-- Latest rate on or before a date (1 for the base currency)
create or replace function app.exchange_rate(p_company uuid, p_currency text, p_date date default current_date)
returns numeric language sql stable security definer set search_path = '' as $$
  select case when p_currency = (select base_currency from public.companies where id = p_company) then 1::numeric
    else (select r.rate from public.exchange_rates r
           where r.company_id = p_company and r.currency_code = p_currency and r.rate_date <= p_date
           order by r.rate_date desc limit 1) end
$$;

-- =============================================================================
-- Approval workflows
-- =============================================================================
create table public.approval_workflows (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  name        text not null,
  doc_type    text not null references public.document_types(key),
  min_amount  numeric(18,2),                 -- applies when document amount (base) >= min_amount
  conditions  jsonb not null default '{}'::jsonb,
  priority    smallint not null default 0,
  is_active   boolean not null default true
);
select app.register_table('public.approval_workflows', 'admin', 'core');

create table public.approval_workflow_steps (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null,
  workflow_id      uuid not null,
  step_order       smallint not null check (step_order > 0),
  name             text not null,
  approver_role_id uuid references public.roles(id),
  approver_user_id uuid references auth.users(id),
  min_approvals    smallint not null default 1 check (min_approvals > 0),
  foreign key (company_id, workflow_id) references public.approval_workflows(company_id, id) on delete cascade,
  check (approver_role_id is not null or approver_user_id is not null),
  unique (workflow_id, step_order)
);
select app.register_table('public.approval_workflow_steps', 'admin', 'core', p_soft_delete => false);

create table public.approval_requests (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id),
  workflow_id     uuid not null,
  doc_type        text not null references public.document_types(key),
  document_id     uuid not null,
  document_number text,
  amount          numeric(18,2),
  status          text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  current_step    smallint not null,
  requested_by    uuid,
  requested_at    timestamptz not null default now(),
  decided_at      timestamptz,
  foreign key (company_id, workflow_id) references public.approval_workflows(company_id, id)
);
select app.register_table('public.approval_requests', 'core', p_soft_delete => false, p_client_write => false);
create unique index approval_requests_one_pending on public.approval_requests (document_id) where status = 'pending';
create index approval_requests_status_idx on public.approval_requests (company_id, status);

create table public.approval_actions (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null,
  request_id  uuid not null,
  step_order  smallint not null,
  actor_id    uuid not null,
  decision    text not null check (decision in ('approved','rejected')),
  comment     text,
  acted_at    timestamptz not null default now(),
  foreign key (company_id, request_id) references public.approval_requests(company_id, id),
  unique (request_id, step_order, actor_id)
);
select app.register_table('public.approval_actions', 'core', p_soft_delete => false, p_client_write => false, p_immutable => true);

-- =============================================================================
-- Notifications (per user)
-- =============================================================================
create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  user_id     uuid not null references auth.users(id) on delete cascade,
  type        text not null default 'info',  -- info, approval, alert, mention, system
  title       text not null,
  body        text,
  link        text,
  entity_type text,
  entity_id   uuid,
  read_at     timestamptz
);
select app.register_table('public.notifications', 'core', p_soft_delete => false, p_audit => false, p_policies => false);
create index notifications_user_idx on public.notifications (user_id, read_at, created_at desc);
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notifications_delete on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));
-- Clients may only flip read_at
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

create or replace function app.notify(
  p_company uuid, p_user uuid, p_type text, p_title text,
  p_body text default null, p_link text default null, p_entity_type text default null, p_entity_id uuid default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (company_id, user_id, type, title, body, link, entity_type, entity_id)
  values (p_company, p_user, p_type, p_title, p_body, p_link, p_entity_type, p_entity_id);
$$;

create or replace function app.notify_role(
  p_company uuid, p_role_id uuid, p_type text, p_title text,
  p_body text default null, p_link text default null, p_entity_type text default null, p_entity_id uuid default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (company_id, user_id, type, title, body, link, entity_type, entity_id)
  select distinct p_company, m.user_id, p_type, p_title, p_body, p_link, p_entity_type, p_entity_id
    from public.company_members m join public.member_roles mr on mr.member_id = m.id
   where m.company_id = p_company and mr.role_id = p_role_id and m.status = 'active' and m.user_id is not null;
$$;

-- =============================================================================
-- Attachments (files live in Storage bucket 'attachments' under <company_id>/...)
-- =============================================================================
create table public.attachments (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id),
  entity_type  text not null,
  entity_id    uuid not null,
  bucket       text not null default 'attachments',
  storage_path text not null,
  file_name    text not null,
  mime_type    text,
  size_bytes   bigint check (size_bytes >= 0),
  description  text,
  check (split_part(storage_path, '/', 1) = company_id::text)
);
select app.register_table('public.attachments', 'collab');
create index attachments_entity_idx on public.attachments (company_id, entity_type, entity_id) where deleted_at is null;
create unique index attachments_path_key on public.attachments (bucket, storage_path) where deleted_at is null;

-- =============================================================================
-- Saved data-table views (columns, filters, sort) for the advanced table
-- =============================================================================
create table public.data_table_views (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  user_id    uuid not null references auth.users(id) on delete cascade,
  table_key  text not null,                    -- e.g. 'inventory.products'
  name       text not null,
  config     jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  is_shared  boolean not null default false
);
select app.register_table('public.data_table_views', 'core', p_soft_delete => false, p_audit => false, p_policies => false);
create index data_table_views_user_idx on public.data_table_views (user_id, table_key);
create policy data_table_views_select on public.data_table_views for select to authenticated
  using (company_id = any ((select app.my_company_ids())::uuid[])
         and (user_id = (select auth.uid()) or is_shared));
create policy data_table_views_insert on public.data_table_views for insert to authenticated
  with check (user_id = (select auth.uid()) and company_id = any ((select app.my_company_ids())::uuid[]));
create policy data_table_views_update on public.data_table_views for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy data_table_views_delete on public.data_table_views for delete to authenticated
  using (user_id = (select auth.uid()));

-- =============================================================================
-- RLS for global tables, profiles, companies, audit log
-- =============================================================================
alter table public.currencies         enable row level security;
alter table public.permissions        enable row level security;
alter table public.roles              enable row level security;
alter table public.role_permissions   enable row level security;
alter table public.document_types     enable row level security;
alter table public.status_transitions enable row level security;
create policy currencies_read         on public.currencies         for select to authenticated using (true);
create policy permissions_read        on public.permissions        for select to authenticated using (true);
create policy roles_read              on public.roles              for select to authenticated using (true);
create policy role_permissions_read   on public.role_permissions   for select to authenticated using (true);
create policy document_types_read     on public.document_types     for select to authenticated using (true);
create policy status_transitions_read on public.status_transitions for select to authenticated using (true);
grant select on public.currencies, public.permissions, public.roles, public.role_permissions,
                public.document_types, public.status_transitions to authenticated;
revoke all on public.currencies, public.permissions, public.roles, public.role_permissions,
              public.document_types, public.status_transitions from anon;

alter table public.profiles enable row level security;
revoke all on public.profiles from anon;
grant select on public.profiles to authenticated;
grant update (full_name, avatar_url, phone, locale, theme, last_company_id, preferences) on public.profiles to authenticated;
create policy profiles_select on public.profiles for select to authenticated using (
  id = (select auth.uid())
  or id in (select m.user_id from public.company_members m
             where m.company_id = any ((select app.my_company_ids())::uuid[]) and m.deleted_at is null));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid())
              and (last_company_id is null or last_company_id = any ((select app.my_company_ids())::uuid[])));

alter table public.companies enable row level security;
revoke all on public.companies from anon;
grant select, update on public.companies to authenticated;
create policy companies_select on public.companies for select to authenticated
  using (id = any ((select app.my_company_ids())::uuid[]));
create policy companies_update on public.companies for update to authenticated
  using (id = any ((select app.company_ids_with('admin.write'))::uuid[]))
  with check (id = any ((select app.company_ids_with('admin.write'))::uuid[]));

alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;
create policy audit_log_select on public.audit_log for select to authenticated
  using (company_id = any ((select app.company_ids_with('audit.read'))::uuid[]));

-- =============================================================================
-- Auth hooks & tenancy RPCs (public schema = callable via supabase.rpc)
-- =============================================================================
create or replace function app.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;

  -- Accept pending invitations addressed to this email
  update public.company_members
     set user_id = new.id, status = 'active', joined_at = now()
   where user_id is null and status = 'invited' and deleted_at is null
     and lower(invited_email) = lower(new.email);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();

-- Replaced in the final migration once all module tables exist
create or replace function app.seed_company_defaults(p_company uuid)
returns void language plpgsql security definer set search_path = '' as $$ begin null; end $$;

create or replace function public.create_company(
  p_name text, p_country_code text default 'AL', p_base_currency text default null,
  p_tax_number text default null, p_legal_name text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_company uuid; v_member uuid; v_country text := upper(p_country_code);
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Company name is required' using errcode = '23514'; end if;

  insert into public.companies (name, legal_name, country_code, base_currency, tax_number, timezone)
  values (trim(p_name), coalesce(p_legal_name, trim(p_name)), v_country,
          coalesce(p_base_currency, case v_country when 'AL' then 'ALL' else 'EUR' end),
          p_tax_number,
          case v_country when 'XK' then 'Europe/Belgrade' else 'Europe/Tirane' end)
  returning id into v_company;

  insert into public.company_settings (company_id) values (v_company);
  insert into public.company_members (company_id, user_id, status, joined_at)
  values (v_company, v_uid, 'active', now()) returning id into v_member;
  insert into public.member_roles (company_id, member_id, role_id)
  select v_company, v_member, r.id from public.roles r where r.key = 'company_admin';
  update public.profiles set last_company_id = v_company where id = v_uid;

  perform app.seed_company_defaults(v_company);
  return v_company;
end $$;

create or replace function public.invite_member(p_company uuid, p_email text, p_role_keys text[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_member uuid; v_user uuid;
begin
  perform app.require_permission(p_company, 'admin.write');
  if exists (select 1 from public.roles where key = any (p_role_keys) and not is_assignable) then
    raise exception 'Role cannot be assigned within a company' using errcode = '42501';
  end if;
  select id into v_user from auth.users where lower(email) = lower(p_email);

  insert into public.company_members (company_id, user_id, invited_email, status, joined_at)
  values (p_company, v_user, lower(p_email),
          case when v_user is null then 'invited' else 'active' end,
          case when v_user is null then null else now() end)
  returning id into v_member;

  insert into public.member_roles (company_id, member_id, role_id)
  select p_company, v_member, r.id from public.roles r where r.key = any (p_role_keys);
  return v_member;
end $$;

create or replace function public.switch_company(p_company uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (p_company = any (app.my_company_ids())) then
    raise exception 'Not a member of this company' using errcode = '42501';
  end if;
  update public.profiles set last_company_id = p_company where id = auth.uid();
end $$;

-- Everything the client needs to boot: companies + roles + effective permissions
create or replace function public.get_my_context()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'is_super_admin', app.is_super_admin(),
    'last_company_id', (select last_company_id from public.profiles where id = auth.uid()),
    'companies', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'name', c.name, 'country_code', c.country_code,
               'base_currency', c.base_currency, 'logo_path', c.logo_path,
               'roles', (select coalesce(jsonb_agg(r.key order by r.sort_order), '[]')
                           from public.member_roles mr join public.roles r on r.id = mr.role_id
                          where mr.member_id = m.id),
               'permissions', (select coalesce(jsonb_agg(distinct rp.permission), '[]')
                                 from public.member_roles mr join public.role_permissions rp on rp.role_id = mr.role_id
                                where mr.member_id = m.id))
             order by c.name)
        from public.company_members m join public.companies c on c.id = m.company_id
       where m.user_id = auth.uid() and m.status = 'active' and m.deleted_at is null and c.deleted_at is null), '[]'::jsonb));
$$;

-- Restore a soft-deleted row (requires <module>.delete)
create or replace function public.restore_record(p_table text, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r app.table_registry; v_company uuid;
begin
  select * into r from app.table_registry where table_name = p_table;
  if r.table_name is null or not r.soft_delete then raise exception 'Table % does not support restore', p_table; end if;
  execute format('select company_id from public.%I where id = $1', p_table) into v_company using p_id;
  if v_company is null then raise exception 'Record not found'; end if;
  perform app.require_permission(v_company, r.module || '.delete');
  execute format('update public.%I set deleted_at = null, deleted_by = null where id = $1', p_table) using p_id;
end $$;

-- =============================================================================
-- Approval RPCs
-- =============================================================================
create or replace function app.notify_step_approvers(p_request uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare q public.approval_requests; s record;
begin
  select * into q from public.approval_requests where id = p_request;
  for s in select * from public.approval_workflow_steps
            where workflow_id = q.workflow_id and step_order = q.current_step loop
    if s.approver_user_id is not null then
      perform app.notify(q.company_id, s.approver_user_id, 'approval', 'Approval required: ' || coalesce(q.document_number, q.doc_type),
                         s.name, null, q.doc_type, q.document_id);
    end if;
    if s.approver_role_id is not null then
      perform app.notify_role(q.company_id, s.approver_role_id, 'approval', 'Approval required: ' || coalesce(q.document_number, q.doc_type),
                              s.name, null, q.doc_type, q.document_id);
    end if;
  end loop;
end $$;

create or replace function app.set_document_status(p_table text, p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_status is null then return; end if;
  execute format('update public.%I set status = $1 where id = $2', p_table) using p_status, p_id;
end $$;

-- Submits a document. Returns the approval request id, or null when no
-- workflow applies (document goes straight to its approved status).
create or replace function public.submit_for_approval(p_doc_type text, p_document_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare dt public.document_types; v_doc jsonb; v_company uuid; v_amount numeric; w public.approval_workflows; v_req uuid; v_step smallint;
begin
  select * into dt from public.document_types where key = p_doc_type;
  if dt.table_name is null or dt.approved_status is null then raise exception 'Document type % has no approval flow', p_doc_type; end if;

  execute format('select to_jsonb(t) from public.%I t where t.id = $1', dt.table_name) into v_doc using p_document_id;
  if v_doc is null then raise exception 'Document not found'; end if;
  v_company := (v_doc ->> 'company_id')::uuid;
  perform app.require_permission(v_company, dt.module || '.write');
  v_amount := coalesce((v_doc ->> 'total_base')::numeric, (v_doc ->> 'total')::numeric, (v_doc ->> 'estimated_total')::numeric, 0);

  select * into w from public.approval_workflows
   where company_id = v_company and doc_type = p_doc_type and is_active and deleted_at is null
     and (min_amount is null or v_amount >= min_amount)
   order by priority desc, min_amount desc nulls last limit 1;

  if w.id is null then
    perform app.set_document_status(dt.table_name, p_document_id, dt.approved_status);
    return null;
  end if;

  select min(step_order) into v_step from public.approval_workflow_steps where workflow_id = w.id;
  if v_step is null then raise exception 'Workflow "%" has no steps', w.name; end if;

  insert into public.approval_requests (company_id, workflow_id, doc_type, document_id, document_number, amount, current_step, requested_by)
  values (v_company, w.id, p_doc_type, p_document_id, v_doc ->> 'number', v_amount, v_step, auth.uid())
  returning id into v_req;

  perform app.set_document_status(dt.table_name, p_document_id, dt.pending_status);
  perform app.notify_step_approvers(v_req);
  return v_req;
end $$;

create or replace function public.decide_approval(p_request_id uuid, p_decision text, p_comment text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare q public.approval_requests; dt public.document_types; s public.approval_workflow_steps; v_count int; v_next smallint;
begin
  if p_decision not in ('approved','rejected') then raise exception 'Decision must be approved or rejected'; end if;
  select * into q from public.approval_requests where id = p_request_id for update;
  if q.id is null or not (q.company_id = any (app.my_company_ids())) then raise exception 'Approval request not found'; end if;
  if q.status <> 'pending' then raise exception 'Request is already %', q.status using errcode = '55000'; end if;
  if q.requested_by = auth.uid() then
    raise exception 'You cannot approve your own request (segregation of duties)' using errcode = '42501';
  end if;

  select * into s from public.approval_workflow_steps where workflow_id = q.workflow_id and step_order = q.current_step;
  if not (coalesce(s.approver_user_id = auth.uid(), false)   -- null-safe: a NULL here must not let anyone through
          or exists (select 1 from public.company_members m join public.member_roles mr on mr.member_id = m.id
                      where m.company_id = q.company_id and m.user_id = auth.uid() and m.status = 'active'
                        and mr.role_id = s.approver_role_id)
          or app.has_role(q.company_id, 'company_admin')) then
    raise exception 'You are not an approver for this step' using errcode = '42501';
  end if;

  insert into public.approval_actions (company_id, request_id, step_order, actor_id, decision, comment)
  values (q.company_id, q.id, q.current_step, auth.uid(), p_decision, p_comment);
  select * into dt from public.document_types where key = q.doc_type;

  insert into public.entity_activities (company_id, entity_type, entity_id, activity_type, title, body)
  values (q.company_id, dt.table_name, q.document_id, 'approval', initcap(p_decision) || ' · ' || s.name, p_comment);

  if p_decision = 'rejected' then
    update public.approval_requests set status = 'rejected', decided_at = now() where id = q.id;
    perform app.set_document_status(dt.table_name, q.document_id, dt.rejected_status);
    perform app.notify(q.company_id, q.requested_by, 'approval', 'Rejected: ' || coalesce(q.document_number, q.doc_type), p_comment, null, q.doc_type, q.document_id);
    return 'rejected';
  end if;

  select count(*) into v_count from public.approval_actions
   where request_id = q.id and step_order = q.current_step and decision = 'approved';
  if v_count < s.min_approvals then return 'pending'; end if;

  select min(step_order) into v_next from public.approval_workflow_steps
   where workflow_id = q.workflow_id and step_order > q.current_step;
  if v_next is not null then
    update public.approval_requests set current_step = v_next where id = q.id;
    perform app.notify_step_approvers(q.id);
    return 'pending';
  end if;

  update public.approval_requests set status = 'approved', decided_at = now() where id = q.id;
  perform app.set_document_status(dt.table_name, q.document_id, dt.approved_status);
  perform app.notify(q.company_id, q.requested_by, 'approval', 'Approved: ' || coalesce(q.document_number, q.doc_type), p_comment, null, q.doc_type, q.document_id);
  return 'approved';
end $$;

-- =============================================================================
-- Function privileges
-- =============================================================================
revoke execute on all functions in schema app from public;
grant execute on all functions in schema app to authenticated, service_role;
revoke execute on function public.create_company, public.invite_member, public.switch_company,
                           public.get_my_context, public.restore_record,
                           public.submit_for_approval, public.decide_approval from public, anon;
grant execute on function public.create_company, public.invite_member, public.switch_company,
                          public.get_my_context, public.restore_record,
                          public.submit_for_approval, public.decide_approval to authenticated;
