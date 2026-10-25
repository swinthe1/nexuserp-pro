-- =============================================================================
-- DrisPRO · 1940 · Admin, reporting, notifications, search (Phase 8)
--
-- Admin: company-specific custom roles, member administration (roles,
-- suspend, remove — never yourself, never the last admin), approval
-- workflows saved as one document, numbering sequences with a safe "next
-- number", the audit trail with people's names, and CSV imports (products,
-- customers / vendors, employees, opening stock) with a dry run that
-- validates every row and changes nothing.
-- Reporting: one entry point, run_report(company, key, params), returning
-- columns + rows + totals for the chosen grouping. Drill-down = the next
-- grouping with the clicked value added to the filters; the last level
-- lists documents with links.
-- Notifications: categories, per-user mute, daily reminders (VAT and payroll
-- deadlines, contracts ending, lots expiring), scheduled with pg_cron.
-- Search: employees, shipments, routes, declarations, payroll, web orders.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Custom roles
-- -----------------------------------------------------------------------------
alter table public.roles add column company_id uuid references public.companies(id);
alter table public.roles drop constraint roles_key_key;
create unique index roles_key_global  on public.roles (key) where company_id is null;
create unique index roles_key_company on public.roles (company_id, key) where company_id is not null;

drop policy roles_read on public.roles;
create policy roles_read on public.roles for select to authenticated
  using (company_id is null or company_id = any ((select app.my_company_ids())::uuid[]));
drop policy role_permissions_read on public.role_permissions;
create policy role_permissions_read on public.role_permissions for select to authenticated
  using (exists (select 1 from public.roles r where r.id = role_id and (r.company_id is null or r.company_id = any ((select app.my_company_ids())::uuid[]))));

create or replace function app.tg_member_role_check()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r public.roles;
begin
  select * into r from public.roles where id = new.role_id;
  if not r.is_assignable then raise exception 'Role cannot be assigned within a company' using errcode = '42501'; end if;
  if r.company_id is not null and r.company_id <> new.company_id then raise exception 'That role belongs to another company' using errcode = '42501'; end if;
  return new;
end $$;

create or replace function public.invite_member(p_company uuid, p_email text, p_role_keys text[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_member uuid; v_user uuid;
begin
  perform app.require_permission(p_company, 'admin.write');
  if nullif(btrim(p_email), '') is null or p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address' using errcode = '23514'; end if;
  if exists (select 1 from public.roles where key = any (p_role_keys) and (company_id is null or company_id = p_company) and not is_assignable) then
    raise exception 'Role cannot be assigned within a company' using errcode = '42501';
  end if;
  if cardinality(coalesce(p_role_keys, '{}')) = 0 then raise exception 'Give the person at least one role' using errcode = '23514'; end if;
  select id into v_user from auth.users where lower(email) = lower(btrim(p_email));
  if exists (select 1 from public.company_members m where m.company_id = p_company and m.deleted_at is null
               and (m.user_id = v_user or lower(m.invited_email) = lower(btrim(p_email)))) then
    raise exception '% is already a member', lower(btrim(p_email)) using errcode = '23505';
  end if;
  insert into public.company_members (company_id, user_id, invited_email, status, joined_at)
  values (p_company, v_user, lower(btrim(p_email)), case when v_user is null then 'invited' else 'active' end, case when v_user is null then null else now() end)
  returning id into v_member;
  insert into public.member_roles (company_id, member_id, role_id)
  select p_company, v_member, r.id from public.roles r where r.key = any (p_role_keys) and (r.company_id is null or r.company_id = p_company);
  if v_user is not null then
    perform app.notify(p_company, v_user, 'info', 'You were added to ' || (select name from public.companies where id = p_company), null, '/', null, null);
  end if;
  return v_member;
end $$;

-- permissions: keys from the catalog, or module.* / *.action patterns
create or replace function public.save_custom_role(p_company uuid, p_role uuid, p_name text, p_description text, p_permissions text[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_bad text; v_key text;
begin
  perform app.require_permission(p_company, 'admin.write');
  if nullif(btrim(p_name), '') is null then raise exception 'Name the role' using errcode = '23514'; end if;
  select string_agg(x, ', ') into v_bad from unnest(p_permissions) x
   where x <> '*' and not exists (select 1 from public.permissions p where p.key = x)
     and not (x ~ '^[a-z_]+\.\*$' and exists (select 1 from public.permissions p where p.module = split_part(x, '.', 1)))
     and not (x ~ '^\*\.[a-z_]+$' and exists (select 1 from public.permissions p where p.action = split_part(x, '.', 2)));
  if v_bad is not null then raise exception 'Unknown permissions: %', v_bad using errcode = '23514'; end if;
  if '*' = any (p_permissions) and not app.has_permission(p_company, '*') then
    raise exception 'Only a company admin can create a role with full access' using errcode = '42501';
  end if;
  if p_role is null then
    v_key := 'custom_' || regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '_', 'g');
    if exists (select 1 from public.roles where (company_id = p_company or company_id is null) and (key = v_key or lower(name) = lower(btrim(p_name)))) then
      raise exception 'A role named % already exists', btrim(p_name) using errcode = '23505';
    end if;
    insert into public.roles (key, name, description, is_assignable, sort_order, company_id)
    values (v_key, btrim(p_name), nullif(btrim(p_description), ''), true, 50, p_company) returning id into v_id;
  else
    select id into v_id from public.roles where id = p_role and company_id = p_company;
    if v_id is null then raise exception 'System roles cannot be changed; copy one into a custom role' using errcode = '42501'; end if;
    update public.roles set name = btrim(p_name), description = nullif(btrim(p_description), '') where id = v_id;
    delete from public.role_permissions where role_id = v_id;
  end if;
  insert into public.role_permissions (role_id, permission) select v_id, x from unnest(p_permissions) x group by x;
  return v_id;
end $$;

create or replace function public.delete_custom_role(p_role uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.roles; v_n int;
begin
  select * into r from public.roles where id = p_role;
  if r.company_id is null then raise exception 'System roles cannot be deleted' using errcode = '42501'; end if;
  perform app.require_permission(r.company_id, 'admin.write');
  select count(*) into v_n from public.member_roles where role_id = r.id;
  if v_n > 0 then raise exception '% people have this role; take it away from them first', v_n using errcode = '23503'; end if;
  delete from public.role_permissions where role_id = r.id;
  delete from public.roles where id = r.id;
end $$;

-- -----------------------------------------------------------------------------
-- 2. Members
-- -----------------------------------------------------------------------------
create or replace function public.company_users(p_company uuid)
returns table (member_id uuid, user_id uuid, email text, full_name text, status text, joined_at timestamptz, last_sign_in_at timestamptz,
               role_ids uuid[], role_names text[], is_self boolean, employee_id uuid)
language sql stable security definer set search_path = '' as $$
  select m.id, m.user_id, coalesce(u.email, m.invited_email), p.full_name, m.status, m.joined_at, u.last_sign_in_at,
         coalesce(array_agg(r.id order by r.sort_order, r.name) filter (where r.id is not null), '{}'),
         coalesce(array_agg(r.name order by r.sort_order, r.name) filter (where r.id is not null), '{}'),
         m.user_id = auth.uid(),
         (select e.id from public.employees e where e.company_id = m.company_id and e.user_id = m.user_id and e.deleted_at is null limit 1)
    from public.company_members m
    left join auth.users u on u.id = m.user_id
    left join public.profiles p on p.id = m.user_id
    left join public.member_roles mr on mr.member_id = m.id
    left join public.roles r on r.id = mr.role_id
   where m.company_id = p_company and m.deleted_at is null and app.has_permission(p_company, 'admin.read')
   group by m.id, u.email, u.last_sign_in_at, p.full_name
   order by m.status = 'active' desc, coalesce(p.full_name, u.email, m.invited_email)
$$;

create or replace function app.admins_left(p_company uuid, p_except_member uuid)
returns int language sql stable security definer set search_path = '' as $$
  select count(distinct m.id)::int from public.company_members m join public.member_roles mr on mr.member_id = m.id
    join public.role_permissions rp on rp.role_id = mr.role_id
   where m.company_id = p_company and m.status = 'active' and m.deleted_at is null and m.id <> p_except_member and rp.permission = '*'
$$;

create or replace function public.set_member_roles(p_member uuid, p_role_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare m public.company_members;
begin
  select * into m from public.company_members where id = p_member and deleted_at is null;
  if m.id is null then raise exception 'Member not found' using errcode = 'P0002'; end if;
  perform app.require_permission(m.company_id, 'admin.write');
  if cardinality(coalesce(p_role_ids, '{}')) = 0 then raise exception 'Keep at least one role; suspend the person instead' using errcode = '23514'; end if;
  if exists (select 1 from unnest(p_role_ids) x left join public.roles r on r.id = x
              where r.id is null or not r.is_assignable or (r.company_id is not null and r.company_id <> m.company_id)) then
    raise exception 'One of those roles cannot be assigned here' using errcode = '42501';
  end if;
  if app.admins_left(m.company_id, m.id) = 0
     and not exists (select 1 from public.role_permissions where role_id = any (p_role_ids) and permission = '*') then
    raise exception 'This is the last company admin; make someone else admin first' using errcode = '55000';
  end if;
  delete from public.member_roles where member_id = m.id and not (role_id = any (p_role_ids));
  insert into public.member_roles (company_id, member_id, role_id)
  select m.company_id, m.id, x from unnest(p_role_ids) x
   where not exists (select 1 from public.member_roles where member_id = m.id and role_id = x);
end $$;

create or replace function public.set_member_status(p_member uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.company_members;
begin
  select * into m from public.company_members where id = p_member and deleted_at is null;
  if m.id is null then raise exception 'Member not found' using errcode = 'P0002'; end if;
  perform app.require_permission(m.company_id, 'admin.write');
  if p_status not in ('active','suspended','removed') then raise exception 'Unknown status %', p_status using errcode = '22023'; end if;
  if m.user_id = auth.uid() then raise exception 'You cannot suspend or remove yourself' using errcode = '42501'; end if;
  if p_status <> 'active' and app.admins_left(m.company_id, m.id) = 0 then
    raise exception 'This is the last company admin' using errcode = '55000';
  end if;
  if p_status = 'active' and m.user_id is null then raise exception 'The invitation has not been accepted yet' using errcode = '55000'; end if;
  if p_status = 'removed' then
    update public.company_members set deleted_at = now(), deleted_by = auth.uid() where id = m.id;
  else
    update public.company_members set status = p_status where id = m.id;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 3. Approval workflows (header + steps in one call)
-- -----------------------------------------------------------------------------
-- p: {id?, company_id, name, doc_type, min_amount, priority, is_active, steps:[{name, approver_role_id?, approver_user_id?, min_approvals}]}
create or replace function public.save_approval_workflow(p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_company uuid := (p ->> 'company_id')::uuid; v_id uuid := nullif(p ->> 'id', '')::uuid; s jsonb; v_n int := 0;
begin
  perform app.require_permission(v_company, 'admin.write');
  if not exists (select 1 from public.document_types where key = p ->> 'doc_type' and pending_status is not null) then
    raise exception 'Documents of type % have no approval step', p ->> 'doc_type' using errcode = '23514';
  end if;
  if jsonb_array_length(coalesce(p -> 'steps', '[]')) = 0 then raise exception 'Add at least one approval step' using errcode = '23514'; end if;
  if v_id is not null and exists (select 1 from public.approval_requests where workflow_id = v_id and status = 'pending') then
    raise exception 'Documents are waiting on this workflow; decide them before changing the steps' using errcode = '55000';
  end if;
  if v_id is null then
    insert into public.approval_workflows (company_id, name, doc_type, min_amount, priority, is_active)
    values (v_company, btrim(p ->> 'name'), p ->> 'doc_type', coalesce((p ->> 'min_amount')::numeric, 0), coalesce((p ->> 'priority')::int, 100),
            coalesce((p ->> 'is_active')::boolean, true))
    returning id into v_id;
  else
    update public.approval_workflows set name = btrim(p ->> 'name'), doc_type = p ->> 'doc_type', min_amount = coalesce((p ->> 'min_amount')::numeric, 0),
           priority = coalesce((p ->> 'priority')::int, 100), is_active = coalesce((p ->> 'is_active')::boolean, true)
     where id = v_id and company_id = v_company;
    if not found then raise exception 'Workflow not found' using errcode = 'P0002'; end if;
  end if;
  for s in select * from jsonb_array_elements(p -> 'steps') loop
    v_n := v_n + 1;
    if nullif(s ->> 'approver_role_id', '') is null and nullif(s ->> 'approver_user_id', '') is null then
      raise exception 'Step % needs an approver role or person', v_n using errcode = '23514';
    end if;
    insert into public.approval_workflow_steps (company_id, workflow_id, step_order, name, approver_role_id, approver_user_id, min_approvals)
    values (v_company, v_id, v_n, coalesce(nullif(btrim(s ->> 'name'), ''), 'Step ' || v_n), nullif(s ->> 'approver_role_id', '')::uuid,
            nullif(s ->> 'approver_user_id', '')::uuid, greatest(coalesce((s ->> 'min_approvals')::int, 1), 1))
    on conflict (workflow_id, step_order) do update set name = excluded.name, approver_role_id = excluded.approver_role_id,
       approver_user_id = excluded.approver_user_id, min_approvals = excluded.min_approvals;
  end loop;
  delete from public.approval_workflow_steps where workflow_id = v_id and step_order > v_n;
  return v_id;
end $$;

-- -----------------------------------------------------------------------------
-- 4. Numbering
-- -----------------------------------------------------------------------------
create or replace function public.numbering_overview(p_company uuid)
returns table (doc_type text, name text, module text, prefix text, include_year boolean, padding int, reset_policy text,
               configured boolean, period_key text, next_value bigint, next_number text, last_used text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not app.has_permission(p_company, 'admin.read') then raise exception 'Permission denied: admin.read required' using errcode = '42501'; end if;
  return query
  select t.key, t.name, t.module, coalesce(s.prefix, t.default_prefix), coalesce(s.include_year, true), coalesce(s.padding, 5)::int,
         coalesce(s.reset_policy, 'yearly'), s.id is not null, pk.k, coalesce(c.next_value, 1),
         coalesce(s.prefix, t.default_prefix) || case when coalesce(s.include_year, true) then extract(year from current_date)::text || '-' else '' end
           || lpad(coalesce(c.next_value, 1)::text, coalesce(s.padding, 5), '0'),
         null::text
    from public.document_types t
    left join public.document_sequences s on s.company_id = p_company and s.doc_type = t.key
    cross join lateral (select case coalesce(s.reset_policy, 'yearly') when 'yearly' then to_char(current_date, 'YYYY') else '' end as k) pk
    left join public.document_sequence_counters c on c.company_id = p_company and c.doc_type = t.key and c.period_key = pk.k
   where t.table_name is not null
   order by t.module, t.name;
end $$;

create or replace function public.save_numbering(p_company uuid, p_doc_type text, p_prefix text, p_include_year boolean, p_padding int,
                                                 p_reset_policy text, p_next_value bigint default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_key text; v_cur bigint;
begin
  perform app.require_permission(p_company, 'admin.write');
  if p_padding not between 2 and 10 then raise exception 'Use 2 to 10 digits' using errcode = '23514'; end if;
  if p_reset_policy not in ('yearly','never') then raise exception 'Restart numbering every year or never' using errcode = '23514'; end if;
  if nullif(btrim(p_prefix), '') is null or p_prefix ~ '\s' then raise exception 'The prefix cannot be empty or contain spaces' using errcode = '23514'; end if;
  insert into public.document_sequences (company_id, doc_type, prefix, include_year, padding, reset_policy)
  values (p_company, p_doc_type, btrim(p_prefix), p_include_year, p_padding, p_reset_policy)
  on conflict (company_id, doc_type) do update set prefix = excluded.prefix, include_year = excluded.include_year,
     padding = excluded.padding, reset_policy = excluded.reset_policy;
  if p_next_value is not null then
    v_key := case p_reset_policy when 'yearly' then to_char(current_date, 'YYYY') else '' end;
    select next_value into v_cur from public.document_sequence_counters where company_id = p_company and doc_type = p_doc_type and period_key = v_key;
    -- numbers only move forward: no reuse of a number that may already exist
    if p_next_value < coalesce(v_cur, 1) then
      raise exception 'The next number can only move forward (it is % now)', coalesce(v_cur, 1) using errcode = '23514';
    end if;
    insert into public.document_sequence_counters (company_id, doc_type, period_key, next_value) values (p_company, p_doc_type, v_key, p_next_value)
    on conflict (company_id, doc_type, period_key) do update set next_value = excluded.next_value;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 5. Audit trail
-- -----------------------------------------------------------------------------
create or replace function public.audit_feed(p_company uuid, p_table text default null, p_actor uuid default null, p_from date default null,
                                             p_to date default null, p_record uuid default null, p_action text default null,
                                             p_limit int default 100, p_offset int default 0)
returns table (id bigint, occurred_at timestamptz, table_name text, record_id uuid, action text, actor_id uuid, actor text,
               changed_fields text[], old_data jsonb, new_data jsonb, record_label text, total bigint)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not app.has_permission(p_company, 'audit.read') then raise exception 'Permission denied: audit.read required' using errcode = '42501'; end if;
  return query
  select a.id, a.occurred_at, a.table_name, a.record_id, a.action, a.actor_id, coalesce(pr.full_name, u.email, 'System'),
         a.changed_fields, a.old_data, a.new_data,
         coalesce(a.new_data ->> 'number', a.old_data ->> 'number', a.new_data ->> 'name', a.old_data ->> 'name', a.new_data ->> 'code',
                  a.new_data ->> 'sku', a.new_data ->> 'full_name', left(a.record_id::text, 8)),
         count(*) over ()
    from public.audit_log a
    left join auth.users u on u.id = a.actor_id
    left join public.profiles pr on pr.id = a.actor_id
   where a.company_id = p_company
     and (p_table is null or a.table_name = p_table) and (p_actor is null or a.actor_id = p_actor)
     and (p_record is null or a.record_id = p_record) and (p_action is null or a.action = p_action)
     and (p_from is null or a.occurred_at >= p_from) and (p_to is null or a.occurred_at < p_to + 1)
   order by a.occurred_at desc, a.id desc
   limit least(p_limit, 500) offset p_offset;
end $$;

-- -----------------------------------------------------------------------------
-- 6. Imports
-- -----------------------------------------------------------------------------
-- Rows are objects keyed by column name. Dry run validates and creates
-- nothing. Each row is all-or-nothing; errors name the row and the field.
create or replace function public.import_rows(p_company uuid, p_kind text, p_rows jsonb, p_dry_run boolean default true)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  r jsonb; i int := 0; v_errors jsonb := '[]'::jsonb; v_created int := 0; v_updated int := 0; v_err text; v_field text;
  v_id uuid; v_uom uuid; v_cat uuid; v_tax uuid; v_ptax uuid; v_wh uuid; v_loc uuid; v_var uuid; v_adj uuid; v_dept uuid; v_pos uuid; v_cost numeric;
  v_country text; v_term uuid; v_lot uuid; v_n int := 0; v_out jsonb;
begin
  if p_kind not in ('products','partners','employees','opening_stock') then raise exception 'Unknown import %', p_kind using errcode = '22023'; end if;
  if not app.has_permission(p_company, case p_kind when 'products' then 'inventory.write' when 'partners' then 'partners.write'
                                                 when 'employees' then 'hr.write' else 'inventory.write' end) then
    raise exception 'Permission denied for this import' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'The file has no rows' using errcode = '23514'; end if;
  if jsonb_array_length(p_rows) > 5000 then raise exception 'Import at most 5,000 rows at a time' using errcode = '23514'; end if;
  select country_code into v_country from public.companies where id = p_company;

  begin   -- outer block: a dry run raises at the end to undo everything
    if p_kind = 'opening_stock' then
      select id into v_wh from public.warehouses where company_id = p_company and deleted_at is null
         and (nullif(btrim(p_rows -> 0 ->> 'warehouse'), '') is null or upper(code) = upper(btrim(p_rows -> 0 ->> 'warehouse')))
       order by created_at limit 1;
      if v_wh is null then raise exception 'Unknown warehouse "%" in row 1', p_rows -> 0 ->> 'warehouse' using errcode = '23514'; end if;
      insert into public.stock_adjustments (company_id, warehouse_id, reason, notes)
      values (p_company, v_wh, 'opening', 'Imported opening stock') returning id into v_adj;
    end if;
    for r in select * from jsonb_array_elements(p_rows) loop
      i := i + 1; v_field := null;
      begin
        if p_kind = 'products' then
          v_field := 'sku';
          if nullif(btrim(r ->> 'sku'), '') is null then raise exception 'SKU is required'; end if;
          v_field := 'name';
          if nullif(btrim(r ->> 'name'), '') is null then raise exception 'Name is required'; end if;
          v_field := 'uom';
          select id into v_uom from public.units_of_measure where company_id = p_company and deleted_at is null
             and (lower(code) = lower(coalesce(nullif(btrim(r ->> 'uom'), ''), 'pcs')) or lower(name) = lower(coalesce(nullif(btrim(r ->> 'uom'), ''), 'pcs'))) limit 1;
          if v_uom is null then raise exception 'Unknown unit "%"', coalesce(r ->> 'uom', 'pcs'); end if;
          v_field := 'category'; v_cat := null;
          if nullif(btrim(r ->> 'category'), '') is not null then
            select id into v_cat from public.product_categories where company_id = p_company and deleted_at is null and lower(name) = lower(btrim(r ->> 'category'));
            if v_cat is null then
              insert into public.product_categories (company_id, name) values (p_company, btrim(r ->> 'category')) returning id into v_cat;
            end if;
          end if;
          v_field := 'vat'; v_tax := null;
          if nullif(btrim(r ->> 'vat'), '') is not null then
            select id into v_tax from public.tax_codes where company_id = p_company and deleted_at is null
               and (upper(code) = upper(btrim(r ->> 'vat')) or rate = nullif(regexp_replace(r ->> 'vat', '[^0-9.]', '', 'g'), '')::numeric) order by is_exempt, code limit 1;
            if v_tax is null then raise exception 'Unknown VAT code "%"', r ->> 'vat'; end if;
          end if;
          v_field := 'type';
          if coalesce(nullif(r ->> 'type', ''), 'stockable') not in ('stockable','consumable','service') then raise exception 'Type must be stockable, consumable or service'; end if;
          select v.id into v_var from public.product_variants v where v.company_id = p_company and v.sku = btrim(r ->> 'sku') and v.deleted_at is null;
          if v_var is null then
            perform public.create_product(jsonb_build_object('company_id', p_company, 'code', btrim(r ->> 'sku'), 'name', btrim(r ->> 'name'),
              'product_type', coalesce(nullif(r ->> 'type', ''), 'stockable'), 'category_id', v_cat, 'uom_id', v_uom,
              'sales_price', coalesce(nullif(r ->> 'price', '')::numeric, 0), 'standard_cost', nullif(r ->> 'cost', ''),
              'sales_tax_code_id', coalesce(v_tax, (select default_sales_tax_code_id from public.company_settings where company_id = p_company)),
              'purchase_tax_code_id', coalesce(v_tax, (select default_purchase_tax_code_id from public.company_settings where company_id = p_company)),
              'weight_kg', nullif(r ->> 'weight_kg', ''), 'brand', nullif(r ->> 'brand', ''),
              'barcodes', case when nullif(btrim(r ->> 'barcode'), '') is not null then jsonb_build_array(jsonb_build_object('barcode', btrim(r ->> 'barcode'))) else '[]'::jsonb end));
            v_created := v_created + 1;
          else
            update public.products p set name = btrim(r ->> 'name'), category_id = coalesce(v_cat, p.category_id),
                   sales_price = coalesce(nullif(r ->> 'price', '')::numeric, p.sales_price), sales_tax_code_id = coalesce(v_tax, p.sales_tax_code_id),
                   weight_kg = coalesce(nullif(r ->> 'weight_kg', '')::numeric, p.weight_kg), brand = coalesce(nullif(r ->> 'brand', ''), p.brand)
              from public.product_variants v where v.id = v_var and p.id = v.product_id;
            update public.product_variants set name = btrim(r ->> 'name'), standard_cost = coalesce(nullif(r ->> 'cost', '')::numeric, standard_cost) where id = v_var;
            v_updated := v_updated + 1;
          end if;

        elsif p_kind = 'partners' then
          v_field := 'name';
          if nullif(btrim(r ->> 'name'), '') is null then raise exception 'Name is required'; end if;
          v_field := 'tax_number';
          if nullif(btrim(r ->> 'tax_number'), '') is not null then
            if v_country = 'AL' and upper(btrim(r ->> 'tax_number')) !~ '^[A-Z][0-9]{8}[A-Z]$' then
              raise exception 'NIPT must be a letter, 8 digits and a letter (e.g. L81234567B)';
            elsif v_country = 'XK' and btrim(r ->> 'tax_number') !~ '^[0-9]{9}$' then
              raise exception 'NUI / fiscal number must be 9 digits';
            end if;
          end if;
          v_field := 'email';
          if nullif(btrim(r ->> 'email'), '') is not null and btrim(r ->> 'email') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Invalid email'; end if;
          v_field := 'role';
          if coalesce(lower(r ->> 'role'), 'customer') not in ('customer','vendor','both') then raise exception 'Role must be customer, vendor or both'; end if;
          v_field := 'payment_terms'; v_term := null;
          if nullif(btrim(r ->> 'payment_terms'), '') is not null then
            select id into v_term from public.payment_terms where company_id = p_company and deleted_at is null and (upper(code) = upper(btrim(r ->> 'payment_terms')) or lower(name) = lower(btrim(r ->> 'payment_terms')));
            if v_term is null then raise exception 'Unknown payment terms "%"', r ->> 'payment_terms'; end if;
          end if;
          v_field := null;
          select id into v_id from public.business_partners where company_id = p_company and deleted_at is null
             and ((nullif(btrim(r ->> 'tax_number'), '') is not null and upper(tax_number) = upper(btrim(r ->> 'tax_number')))
                  or (nullif(btrim(r ->> 'code'), '') is not null and code = btrim(r ->> 'code')))
           limit 1;
          if v_id is null then
            insert into public.business_partners (company_id, code, name, kind, is_customer, is_vendor, tax_number, email, phone, payment_term_id, credit_limit)
            values (p_company, coalesce(nullif(btrim(r ->> 'code'), ''), app.next_document_number(p_company, case when lower(r ->> 'role') = 'vendor' then 'vendor_code' else 'customer_code' end)),
                    btrim(r ->> 'name'), case when nullif(btrim(r ->> 'tax_number'), '') is null then 'individual' else 'company' end,
                    coalesce(lower(r ->> 'role'), 'customer') in ('customer','both'), lower(r ->> 'role') in ('vendor','both'),
                    upper(nullif(btrim(r ->> 'tax_number'), '')), nullif(btrim(r ->> 'email'), ''), nullif(btrim(r ->> 'phone'), ''), v_term,
                    coalesce(nullif(r ->> 'credit_limit', '')::numeric, 0))
            returning id into v_id;
            if nullif(btrim(r ->> 'address'), '') is not null or nullif(btrim(r ->> 'city'), '') is not null then
              insert into public.partner_addresses (company_id, partner_id, address_type, line1, city, country_code, is_default)
              values (p_company, v_id, 'both', coalesce(nullif(btrim(r ->> 'address'), ''), btrim(r ->> 'city')), nullif(btrim(r ->> 'city'), ''),
                      coalesce(nullif(upper(btrim(r ->> 'country')), ''), v_country), true);
            end if;
            v_created := v_created + 1;
          else
            update public.business_partners set name = btrim(r ->> 'name'), email = coalesce(nullif(btrim(r ->> 'email'), ''), email),
                   phone = coalesce(nullif(btrim(r ->> 'phone'), ''), phone), payment_term_id = coalesce(v_term, payment_term_id),
                   is_customer = is_customer or coalesce(lower(r ->> 'role'), 'customer') in ('customer','both'),
                   is_vendor = is_vendor or lower(r ->> 'role') in ('vendor','both'),
                   credit_limit = coalesce(nullif(r ->> 'credit_limit', '')::numeric, credit_limit)
             where id = v_id;
            v_updated := v_updated + 1;
          end if;

        elsif p_kind = 'employees' then
          v_field := 'first_name';
          if nullif(btrim(r ->> 'first_name'), '') is null then raise exception 'First name is required'; end if;
          v_field := 'last_name';
          if nullif(btrim(r ->> 'last_name'), '') is null then raise exception 'Last name is required'; end if;
          v_field := 'hire_date';
          if nullif(r ->> 'hire_date', '') is null then raise exception 'Hire date is required (YYYY-MM-DD)'; end if;
          perform (r ->> 'hire_date')::date;
          v_field := 'personal_number';
          if v_country = 'AL' and nullif(btrim(r ->> 'personal_number'), '') is not null and upper(btrim(r ->> 'personal_number')) !~ '^[A-Z][0-9]{8}[A-Z]$' then
            raise exception 'Albanian personal numbers (NID) are a letter, 8 digits and a letter';
          end if;
          v_field := 'gross_salary';
          if nullif(r ->> 'gross_salary', '') is not null and (r ->> 'gross_salary')::numeric < 0 then raise exception 'Salary cannot be negative'; end if;
          v_field := 'department'; v_dept := null; v_pos := null;
          if nullif(btrim(r ->> 'department'), '') is not null then
            select id into v_dept from public.departments where company_id = p_company and deleted_at is null and lower(name) = lower(btrim(r ->> 'department'));
            if v_dept is null then insert into public.departments (company_id, name) values (p_company, btrim(r ->> 'department')) returning id into v_dept; end if;
          end if;
          if nullif(btrim(r ->> 'position'), '') is not null then
            select id into v_pos from public.job_positions where company_id = p_company and deleted_at is null and lower(title) = lower(btrim(r ->> 'position'));
            if v_pos is null then insert into public.job_positions (company_id, title, department_id) values (p_company, btrim(r ->> 'position'), v_dept) returning id into v_pos; end if;
          end if;
          v_field := null;
          select id into v_id from public.employees where company_id = p_company and deleted_at is null
             and nullif(btrim(r ->> 'personal_number'), '') is not null and upper(personal_number) = upper(btrim(r ->> 'personal_number'));
          if v_id is null then
            insert into public.employees (company_id, first_name, last_name, personal_number, email, phone, department_id, position_id, hire_date,
                                          iban, date_of_birth)
            values (p_company, btrim(r ->> 'first_name'), btrim(r ->> 'last_name'), upper(nullif(btrim(r ->> 'personal_number'), '')),
                    nullif(btrim(r ->> 'email'), ''), nullif(btrim(r ->> 'phone'), ''), v_dept, v_pos, (r ->> 'hire_date')::date,
                    nullif(replace(r ->> 'iban', ' ', ''), ''), nullif(r ->> 'date_of_birth', '')::date)
            returning id into v_id;
            if nullif(r ->> 'gross_salary', '') is not null then
              insert into public.employment_contracts (company_id, employee_id, start_date, gross_salary, currency_code, working_hours_per_week)
              values (p_company, v_id, (r ->> 'hire_date')::date, (r ->> 'gross_salary')::numeric,
                      (select base_currency from public.companies where id = p_company), coalesce(nullif(r ->> 'hours_per_week', '')::numeric, 40));
            end if;
            v_created := v_created + 1;
          else
            update public.employees set first_name = btrim(r ->> 'first_name'), last_name = btrim(r ->> 'last_name'),
                   department_id = coalesce(v_dept, department_id), position_id = coalesce(v_pos, position_id),
                   email = coalesce(nullif(btrim(r ->> 'email'), ''), email), phone = coalesce(nullif(btrim(r ->> 'phone'), ''), phone),
                   iban = coalesce(nullif(replace(r ->> 'iban', ' ', ''), ''), iban)
             where id = v_id;
            v_updated := v_updated + 1;
          end if;

        else  -- opening stock
          v_field := 'sku';
          select v.id into v_var from public.product_variants v join public.products p on p.id = v.product_id
           where v.company_id = p_company and v.sku = btrim(r ->> 'sku') and v.deleted_at is null and p.product_type = 'stockable';
          if v_var is null then raise exception 'Unknown stockable SKU "%"', r ->> 'sku'; end if;
          v_field := 'warehouse';
          select id into v_wh from public.warehouses where company_id = p_company and deleted_at is null
             and (upper(code) = upper(coalesce(nullif(btrim(r ->> 'warehouse'), ''), code)));
          if v_wh is null then raise exception 'Unknown warehouse "%"', r ->> 'warehouse'; end if;
          v_field := 'location';
          if nullif(btrim(r ->> 'location'), '') is not null then
            select id into v_loc from public.warehouse_locations where company_id = p_company and warehouse_id = v_wh and upper(code) = upper(btrim(r ->> 'location'));
            if v_loc is null then raise exception 'Unknown location "%" in that warehouse', r ->> 'location'; end if;
          else
            select l.id into v_loc from public.warehouse_locations l
             where l.warehouse_id = v_wh and l.is_pickable and l.is_active and l.deleted_at is null and l.location_type = 'internal'
             order by (l.code ilike '%/STOCK') desc, l.code limit 1;
            if v_loc is null then raise exception 'The warehouse has no stock location'; end if;
          end if;
          v_field := 'quantity';
          if coalesce(nullif(r ->> 'quantity', '')::numeric, 0) <= 0 then raise exception 'Quantity must be more than zero'; end if;
          v_field := 'unit_cost';
          v_cost := nullif(r ->> 'unit_cost', '')::numeric;
          if v_cost is null or v_cost < 0 then raise exception 'Unit cost is required'; end if;
          v_field := 'lot'; v_lot := null;
          if nullif(btrim(r ->> 'lot'), '') is not null then
            select id into v_lot from public.lots where company_id = p_company and variant_id = v_var and lot_number = btrim(r ->> 'lot') and deleted_at is null;
            if v_lot is null then
              insert into public.lots (company_id, variant_id, lot_number, expiry_date) values (p_company, v_var, btrim(r ->> 'lot'), nullif(r ->> 'expiry', '')::date)
              returning id into v_lot;
            end if;
          elsif exists (select 1 from public.products p join public.product_variants v on v.product_id = p.id where v.id = v_var and p.tracking <> 'none') then
            raise exception 'This item is lot-tracked; give the lot';
          end if;
          if (select warehouse_id from public.stock_adjustments where id = v_adj) <> v_wh then
            raise exception 'Import one warehouse at a time (row 1 is %)', (select code from public.warehouses w join public.stock_adjustments a on a.warehouse_id = w.id where a.id = v_adj);
          end if;
          insert into public.stock_adjustment_lines (company_id, adjustment_id, variant_id, location_id, lot_id, quantity_change, unit_cost)
          values (p_company, v_adj, v_var, v_loc, v_lot, (r ->> 'quantity')::numeric, v_cost);
          v_created := v_created + 1;
        end if;
      exception when others then
        get stacked diagnostics v_err = message_text;
        v_errors := v_errors || jsonb_build_object('row', i, 'field', v_field, 'message', v_err);
      end;
    end loop;

    if p_kind = 'opening_stock' then
      if jsonb_array_length(v_errors) = 0 and v_created > 0 then
        if not p_dry_run then perform public.post_stock_adjustment(v_adj); end if;
      end if;
    end if;
    v_out := jsonb_build_object('rows', i, 'created', v_created, 'updated', v_updated, 'errors', v_errors, 'dry_run', p_dry_run,
                                'adjustment_id', case when p_kind = 'opening_stock' and not p_dry_run and jsonb_array_length(v_errors) = 0 then v_adj end);
    -- dry run, or a stock import with errors (it goes in as one document): undo everything
    if p_dry_run or (p_kind = 'opening_stock' and jsonb_array_length(v_errors) > 0) then
      raise exception using errcode = 'P0D01', message = 'rollback';
    end if;
  exception when sqlstate 'P0D01' then
    null;
  end;
  return v_out;
end $$;

-- -----------------------------------------------------------------------------
-- 7. Reporting
-- -----------------------------------------------------------------------------
-- Facts. Signed: credit notes and refunds are negative. Base currency.
create or replace function app.sales_facts(p_company uuid, p_from date, p_to date)
returns table (doc_type text, doc_id uuid, doc_number text, href text, doc_date date, partner_id uuid, partner text, salesperson_id uuid,
               channel text, variant_id uuid, product text, category_id uuid, category text, warehouse text, city text,
               qty numeric, net numeric, cost numeric)
language sql stable security definer set search_path = '' as $$
  select i.document_type, i.id, i.number, '/sales/invoices/' || i.id, i.invoice_date, i.partner_id, p.name, coalesce(i.salesperson_id, so.salesperson_id),
         coalesce(so.channel, 'direct'), l.variant_id, coalesce(v.sku || ' · ' || v.name, l.description), pr.category_id,
         case when l.variant_id is null then 'Services and other lines' else coalesce(c.name, 'No category') end,
         w.name, (select a.city from public.partner_addresses a where a.partner_id = i.partner_id and a.deleted_at is null order by a.is_default desc limit 1),
         s.s * l.quantity, s.s * round(l.line_subtotal * i.exchange_rate, 2),
         s.s * round(l.quantity * coalesce(dl.unit_cost, ic.avg_cost, v.standard_cost, 0), 2)
    from public.sales_invoices i
    join public.sales_invoice_lines l on l.invoice_id = i.id
    join public.business_partners p on p.id = i.partner_id
    left join public.sales_orders so on so.id = i.sales_order_id
    left join public.warehouses w on w.id = so.warehouse_id
    left join public.delivery_lines dl on dl.id = l.delivery_line_id
    left join public.product_variants v on v.id = l.variant_id
    left join public.products pr on pr.id = v.product_id
    left join public.product_categories c on c.id = pr.category_id
    left join public.item_costs ic on ic.variant_id = l.variant_id
    cross join lateral (select case when i.document_type = 'credit_note' then -1 else 1 end as s) s
   where i.company_id = p_company and i.status = 'posted' and i.deleted_at is null and i.source <> 'pos' and i.invoice_date between p_from and p_to
  union all
  select case when o.is_refund then 'credit_note' else 'pos' end, o.id, o.number, '/pos?register=' || o.register_id, (o.order_at at time zone co.timezone)::date,
         o.partner_id, coalesce(p.name, 'Retail customers'), o.cashier_id, 'pos', l.variant_id, coalesce(v.sku || ' · ' || v.name, l.description),
         pr.category_id, coalesce(c.name, 'No category'), w.name, null,
         l.quantity, l.line_subtotal, round(l.quantity * coalesce(l.unit_cost, 0), 2)
    from public.pos_orders o
    join public.companies co on co.id = o.company_id
    join public.pos_order_lines l on l.pos_order_id = o.id
    join public.pos_registers r on r.id = o.register_id
    left join public.warehouses w on w.id = r.warehouse_id
    left join public.business_partners p on p.id = o.partner_id
    left join public.product_variants v on v.id = l.variant_id
    left join public.products pr on pr.id = v.product_id
    left join public.product_categories c on c.id = pr.category_id
   where o.company_id = p_company and o.status = 'paid' and o.deleted_at is null and (o.order_at at time zone co.timezone)::date between p_from and p_to
$$;

create or replace function app.purchase_facts(p_company uuid, p_from date, p_to date)
returns table (doc_type text, doc_id uuid, doc_number text, href text, doc_date date, partner_id uuid, partner text,
               variant_id uuid, product text, category_id uuid, category text, account text, qty numeric, net numeric, vat numeric)
language sql stable security definer set search_path = '' as $$
  select b.document_type, b.id, b.number || ' · ' || b.vendor_invoice_number, '/procurement/bills/' || b.id, b.bill_date, b.vendor_id, p.name,
         coalesce(l.variant_id, pl.variant_id), coalesce(v.sku || ' · ' || v.name, l.description), pr.category_id,
         coalesce(c.name, case when coalesce(l.variant_id, pl.variant_id) is null then 'Services and expenses' else 'No category' end),
         a.code || ' ' || a.name, s.s * l.quantity, s.s * round(l.line_subtotal * b.exchange_rate, 2), s.s * round(l.tax_amount * b.exchange_rate, 2)
    from public.vendor_bills b
    join public.vendor_bill_lines l on l.bill_id = b.id
    join public.business_partners p on p.id = b.vendor_id
    left join public.purchase_order_lines pl on pl.id = l.po_line_id
    left join public.product_variants v on v.id = coalesce(l.variant_id, pl.variant_id)
    left join public.products pr on pr.id = v.product_id
    left join public.product_categories c on c.id = pr.category_id
    left join public.accounts a on a.id = l.account_id
    cross join lateral (select case when b.document_type = 'vendor_credit' then -1 else 1 end as s) s
   where b.company_id = p_company and b.status = 'posted' and b.deleted_at is null and b.bill_date between p_from and p_to
$$;

-- Stock and value per variant × warehouse at the end of a day, from the stock ledger
create or replace function app.stock_as_of(p_company uuid, p_as_of date)
returns table (variant_id uuid, warehouse_id uuid, qty numeric, value numeric, last_out date, last_in date)
language sql stable security definer set search_path = '' as $$
  with m as (
    select sm.variant_id, sm.to_warehouse_id as warehouse_id, sm.quantity as q, coalesce(sm.total_cost, round(sm.quantity * sm.unit_cost, 2)) as v,
           null::date as out_d, case when sm.quantity > 0 then sm.movement_date::date end as in_d
      from public.stock_movements sm
     where sm.company_id = p_company and sm.to_warehouse_id is not null and sm.movement_date::date <= p_as_of
    union all
    select sm.variant_id, sm.from_warehouse_id, -sm.quantity, -coalesce(sm.total_cost, round(sm.quantity * sm.unit_cost, 2)),
           case when sm.movement_type in ('delivery','pos_sale','production_consume') then sm.movement_date::date end, null
      from public.stock_movements sm
     where sm.company_id = p_company and sm.from_warehouse_id is not null and sm.movement_date::date <= p_as_of
  )
  select variant_id, warehouse_id, sum(q), sum(v), max(out_d), max(in_d) from m group by variant_id, warehouse_id
$$;

-- dims → (key expression, label expression) for each report; values go into filters as text
create or replace function public.run_report(p_company uuid, p_report text, p jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_from date := coalesce(nullif(p ->> 'from', '')::date, date_trunc('year', current_date)::date);
  v_to date := coalesce(nullif(p ->> 'to', '')::date, current_date);
  v_dim text := coalesce(nullif(p ->> 'group_by', ''), 'month');
  v_filters jsonb := coalesce(p -> 'filters', '{}'::jsonb);
  v_dims jsonb; v_measures text; v_cols jsonb; v_src text; v_where text := 'true'; k text; v_sql text; v_rows jsonb; v_totals jsonb;
  v_perm text; v_key text; v_label text; v_sort text; v_href text := 'null::text'; f record;
begin
  v_perm := case p_report when 'sales' then 'sales.read' when 'margin' then 'sales.read' when 'purchases' then 'procurement.read'
                          when 'inventory' then 'inventory.read' when 'stock_aging' then 'inventory.read' when 'payroll' then 'payroll.read'
                          when 'vat' then 'tax.read' when 'production' then 'manufacturing.read' when 'receivables' then 'invoicing.read' end;
  if v_perm is null then raise exception 'Unknown report %', p_report using errcode = '22023'; end if;
  if not (app.has_permission(p_company, v_perm) and (app.has_permission(p_company, 'reports.read') or app.has_permission(p_company, split_part(v_perm, '.', 1) || '.write'))) then
    raise exception 'Permission denied: % and reports.read required', v_perm using errcode = '42501';
  end if;

  -- dimension catalog per report: {dim: [key sql, label sql, sort sql]}
  if p_report in ('sales','margin') then
    v_src := format('app.sales_facts(%L, %L, %L)', p_company, v_from, v_to);
    v_dims := jsonb_build_object(
      'month', jsonb_build_array('to_char(doc_date, ''YYYY-MM'')', 'to_char(doc_date, ''YYYY-MM'')', 'min(doc_date)'),
      'customer', jsonb_build_array('coalesce(partner_id::text, ''retail'')', 'min(partner)', 'sum(net) desc'),
      'product', jsonb_build_array('coalesce(variant_id::text, product)', 'min(product)', 'sum(net) desc'),
      'category', jsonb_build_array('coalesce(category_id::text, category)', 'min(category)', 'sum(net) desc'),
      'salesperson', jsonb_build_array('coalesce(salesperson_id::text, ''none'')', 'coalesce((select coalesce(pr.full_name, pr.email) from public.profiles pr where pr.id = min(salesperson_id::text)::uuid), ''Unassigned'')', 'sum(net) desc'),
      'channel', jsonb_build_array('channel', 'initcap(min(channel))', 'sum(net) desc'),
      'city', jsonb_build_array('coalesce(city, ''—'')', 'coalesce(min(city), ''—'')', 'sum(net) desc'),
      'document', jsonb_build_array('doc_id::text', 'min(doc_number)', 'min(doc_date) desc'));
    v_measures := 'count(distinct doc_id) as documents, round(sum(qty), 2) as quantity, round(sum(net), 2) as revenue, round(sum(cost), 2) as cost, '
               || 'round(sum(net) - sum(cost), 2) as margin, round(100 * (sum(net) - sum(cost)) / nullif(sum(net), 0), 1) as margin_pct';
    v_cols := jsonb_build_array(jsonb_build_object('key','documents','label','Documents','type','int'), jsonb_build_object('key','quantity','label','Quantity','type','qty'),
      jsonb_build_object('key','revenue','label','Revenue','type','money'), jsonb_build_object('key','cost','label','Cost','type','money'),
      jsonb_build_object('key','margin','label','Margin','type','money'), jsonb_build_object('key','margin_pct','label','Margin %','type','pct'));
    if v_dim = 'document' then v_href := 'min(href)'; end if;
  elsif p_report = 'purchases' then
    v_src := format('app.purchase_facts(%L, %L, %L)', p_company, v_from, v_to);
    v_dims := jsonb_build_object(
      'month', jsonb_build_array('to_char(doc_date, ''YYYY-MM'')', 'to_char(doc_date, ''YYYY-MM'')', 'min(doc_date)'),
      'vendor', jsonb_build_array('partner_id::text', 'min(partner)', 'sum(net) desc'),
      'product', jsonb_build_array('coalesce(variant_id::text, product)', 'min(product)', 'sum(net) desc'),
      'category', jsonb_build_array('coalesce(category_id::text, category)', 'min(category)', 'sum(net) desc'),
      'account', jsonb_build_array('coalesce(account, ''—'')', 'coalesce(min(account), ''Stock purchases'')', 'sum(net) desc'),
      'document', jsonb_build_array('doc_id::text', 'min(doc_number)', 'min(doc_date) desc'));
    v_measures := 'count(distinct doc_id) as documents, round(sum(qty), 2) as quantity, round(sum(net), 2) as amount, round(sum(vat), 2) as vat, round(sum(net) + sum(vat), 2) as total';
    v_cols := jsonb_build_array(jsonb_build_object('key','documents','label','Bills','type','int'), jsonb_build_object('key','quantity','label','Quantity','type','qty'),
      jsonb_build_object('key','amount','label','Net amount','type','money'), jsonb_build_object('key','vat','label','VAT','type','money'),
      jsonb_build_object('key','total','label','Total','type','money'));
    if v_dim = 'document' then v_href := 'min(href)'; end if;
  elsif p_report in ('inventory','stock_aging') then
    v_src := format($s$(select s.*, v.sku || ' · ' || v.name as product, pr.category_id, coalesce(c.name, 'No category') as category, w.name as warehouse,
                               (%L::date - coalesce(s.last_out, s.last_in)) as idle_days,
                               case when %L::date - coalesce(s.last_out, s.last_in) <= 30 then '0–30 days' when %L::date - coalesce(s.last_out, s.last_in) <= 90 then '31–90 days'
                                    when %L::date - coalesce(s.last_out, s.last_in) <= 180 then '91–180 days' else 'Over 180 days' end as age
                          from app.stock_as_of(%L, %L) s join public.product_variants v on v.id = s.variant_id join public.products pr on pr.id = v.product_id
                          left join public.product_categories c on c.id = pr.category_id join public.warehouses w on w.id = s.warehouse_id
                         where s.qty <> 0) x$s$, v_to, v_to, v_to, v_to, p_company, v_to);
    v_dims := jsonb_build_object(
      'warehouse', jsonb_build_array('warehouse_id::text', 'min(warehouse)', 'sum(value) desc'),
      'category', jsonb_build_array('coalesce(category_id::text, ''none'')', 'min(category)', 'sum(value) desc'),
      'age', jsonb_build_array('age', 'min(age)', 'min(idle_days)'),
      'product', jsonb_build_array('variant_id::text', 'min(product)', 'sum(value) desc'));
    v_measures := 'count(distinct variant_id) as items, round(sum(qty), 2) as quantity, round(sum(value), 2) as value, '
               || 'round(sum(value) / nullif(sum(qty), 0), 4) as unit_cost, max(idle_days) as idle_days';
    v_cols := jsonb_build_array(jsonb_build_object('key','items','label','Items','type','int'), jsonb_build_object('key','quantity','label','Quantity','type','qty'),
      jsonb_build_object('key','value','label','Value','type','money'), jsonb_build_object('key','unit_cost','label','Avg unit cost','type','money'),
      jsonb_build_object('key','idle_days','label','Days since last movement','type','int'));
    if p_report = 'stock_aging' and p ->> 'group_by' is null then v_dim := 'age'; end if;
    if p_report = 'inventory' and p ->> 'group_by' is null then v_dim := 'warehouse'; end if;
  elsif p_report = 'payroll' then
    v_src := format($s$(select r.period_start as doc_date, r.id as run_id, r.number, e.id as employee_id, e.full_name as employee, d.id as department_id,
                               coalesce(d.name, 'No department') as department, ps.gross_salary, ps.employee_contributions, ps.income_tax, ps.net_salary,
                               ps.employer_contributions
                          from public.payslips ps join public.payroll_runs r on r.id = ps.payroll_run_id join public.employees e on e.id = ps.employee_id
                          left join public.departments d on d.id = e.department_id
                         where r.company_id = %L and r.status in ('posted','paid') and r.deleted_at is null and r.period_start between %L and %L) x$s$,
                    p_company, date_trunc('month', v_from)::date, v_to);
    v_dims := jsonb_build_object(
      'month', jsonb_build_array('to_char(doc_date, ''YYYY-MM'')', 'to_char(doc_date, ''YYYY-MM'')', 'min(doc_date)'),
      'department', jsonb_build_array('coalesce(department_id::text, ''none'')', 'min(department)', 'sum(gross_salary) desc'),
      'employee', jsonb_build_array('employee_id::text', 'min(employee)', 'min(employee)'));
    v_measures := 'count(distinct employee_id) as employees, round(sum(gross_salary), 2) as gross, round(sum(employee_contributions), 2) as employee_contributions, '
               || 'round(sum(income_tax), 2) as income_tax, round(sum(net_salary), 2) as net, round(sum(employer_contributions), 2) as employer_contributions, '
               || 'round(sum(gross_salary + employer_contributions), 2) as employer_cost';
    v_cols := jsonb_build_array(jsonb_build_object('key','employees','label','Employees','type','int'), jsonb_build_object('key','gross','label','Gross','type','money'),
      jsonb_build_object('key','employee_contributions','label','Employee contributions','type','money'), jsonb_build_object('key','income_tax','label','Income tax','type','money'),
      jsonb_build_object('key','net','label','Net','type','money'), jsonb_build_object('key','employer_contributions','label','Employer contributions','type','money'),
      jsonb_build_object('key','employer_cost','label','Employer cost','type','money'));
  elsif p_report = 'vat' then
    v_src := format($s$(select e.*, case when e.side = 'sale' then e.vat * case when e.is_credit then -1 else 1 end else 0 end as output_vat,
                               case when e.side = 'purchase' and e.kind not in ('no_vat','no_vat_investment','non_deductible','non_deductible_investment')
                                    then e.vat * case when e.is_credit then -1 else 1 end else 0 end as input_vat,
                               case when e.kind = 'reverse_charge' then e.vat * case when e.is_credit then -1 else 1 end else 0 end as rc_vat,
                               e.base * case when e.is_credit then -1 else 1 end as signed_base
                          from app.vat_entries(%L, %L, %L) e) x$s$, p_company, v_from, v_to);
    v_dims := jsonb_build_object(
      'month', jsonb_build_array('to_char(doc_date, ''YYYY-MM'')', 'to_char(doc_date, ''YYYY-MM'')', 'min(doc_date)'),
      'treatment', jsonb_build_array('side || '':'' || kind || '':'' || rate', 'initcap(min(side)) || '' · '' || replace(min(kind), ''_'', '' '') || '' · '' || trim_scale(min(rate)) || ''%''', 'min(side), min(kind)'),
      'partner', jsonb_build_array('coalesce(partner, ''—'')', 'min(partner)', 'sum(abs(vat)) desc'),
      'document', jsonb_build_array('coalesce(doc_id::text, number)', 'min(number)', 'min(doc_date) desc'));
    v_measures := 'count(*) as entries, round(sum(signed_base), 2) as base, round(sum(output_vat) + sum(rc_vat), 2) as output_vat, '
               || 'round(sum(input_vat), 2) as input_vat, round(sum(output_vat) + sum(rc_vat) - sum(input_vat), 2) as net_vat';
    v_cols := jsonb_build_array(jsonb_build_object('key','entries','label','Entries','type','int'), jsonb_build_object('key','base','label','Taxable base','type','money'),
      jsonb_build_object('key','output_vat','label','Output VAT','type','money'), jsonb_build_object('key','input_vat','label','Input VAT','type','money'),
      jsonb_build_object('key','net_vat','label','Net VAT','type','money'));
    if v_dim = 'document' then v_href := 'min(href)'; end if;
  elsif p_report = 'production' then
    v_src := format($s$(select w.id as doc_id, w.number, '/manufacturing/orders/' || w.id as href, coalesce(w.closed_at, w.updated_at)::date as doc_date,
                               w.variant_id, v.sku || ' · ' || v.name as product, w.quantity_produced as qty,
                               w.planned_material_cost + w.planned_labor_cost + w.planned_overhead_cost as planned,
                               w.material_cost + w.labor_cost + w.overhead_cost as actual, w.output_value, w.variance_value, w.quantity_planned
                          from public.work_orders w join public.product_variants v on v.id = w.variant_id
                         where w.company_id = %L and w.status = 'closed' and w.deleted_at is null and coalesce(w.closed_at, w.updated_at)::date between %L and %L) x$s$,
                    p_company, v_from, v_to);
    v_dims := jsonb_build_object(
      'month', jsonb_build_array('to_char(doc_date, ''YYYY-MM'')', 'to_char(doc_date, ''YYYY-MM'')', 'min(doc_date)'),
      'product', jsonb_build_array('variant_id::text', 'min(product)', 'sum(actual) desc'),
      'document', jsonb_build_array('doc_id::text', 'min(number)', 'min(doc_date) desc'));
    v_measures := 'count(*) as work_orders, round(sum(qty), 2) as quantity, round(sum(planned * qty / nullif(quantity_planned, 0)), 2) as planned_cost, '
               || 'round(sum(actual), 2) as actual_cost, round(sum(variance_value), 2) as variance, round(sum(actual) / nullif(sum(qty), 0), 2) as unit_cost';
    v_cols := jsonb_build_array(jsonb_build_object('key','work_orders','label','Work orders','type','int'), jsonb_build_object('key','quantity','label','Made','type','qty'),
      jsonb_build_object('key','planned_cost','label','Planned for output','type','money'), jsonb_build_object('key','actual_cost','label','Actual cost','type','money'),
      jsonb_build_object('key','variance','label','Variance','type','money'), jsonb_build_object('key','unit_cost','label','Unit cost','type','money'));
    if v_dim = 'document' then v_href := 'min(href)'; end if;
  else -- receivables: open invoices as of the end date, by customer and age
    v_src := format($s$(select i.id as doc_id, i.number, '/sales/invoices/' || i.id as href, i.invoice_date as doc_date, i.due_date, i.partner_id, p.name as partner,
                               round(i.amount_due * i.exchange_rate, 2) as due, %L::date - i.due_date as overdue_days,
                               case when %L::date <= i.due_date then 'Not due' when %L::date - i.due_date <= 30 then '1–30 days'
                                    when %L::date - i.due_date <= 60 then '31–60 days' when %L::date - i.due_date <= 90 then '61–90 days' else 'Over 90 days' end as bucket
                          from public.sales_invoices i join public.business_partners p on p.id = i.partner_id
                         where i.company_id = %L and i.status = 'posted' and i.document_type = 'sales_invoice' and i.deleted_at is null and i.amount_due > 0) x$s$,
                    v_to, v_to, v_to, v_to, v_to, p_company);
    v_dims := jsonb_build_object(
      'bucket', jsonb_build_array('bucket', 'min(bucket)', 'min(overdue_days)'),
      'customer', jsonb_build_array('partner_id::text', 'min(partner)', 'sum(due) desc'),
      'document', jsonb_build_array('doc_id::text', 'min(number)', 'min(due_date)'));
    v_measures := 'count(*) as invoices, round(sum(due), 2) as due, max(overdue_days) as max_overdue';
    v_cols := jsonb_build_array(jsonb_build_object('key','invoices','label','Invoices','type','int'), jsonb_build_object('key','due','label','Open amount','type','money'),
      jsonb_build_object('key','max_overdue','label','Most days overdue','type','int'));
    if p ->> 'group_by' is null then v_dim := 'bucket'; end if;
    if v_dim = 'document' then v_href := 'min(href)'; end if;
  end if;

  if not v_dims ? v_dim then raise exception 'Cannot group % by %', p_report, v_dim using errcode = '22023'; end if;
  -- filters: only known dims, values bound as literals
  for f in select * from jsonb_each_text(v_filters) loop
    if not v_dims ? f.key then raise exception 'Unknown filter %', f.key using errcode = '22023'; end if;
    v_where := v_where || format(' and (%s) = %L', v_dims -> f.key ->> 0, f.value);
  end loop;
  v_key := v_dims -> v_dim ->> 0; v_label := v_dims -> v_dim ->> 1; v_sort := v_dims -> v_dim ->> 2;

  v_sql := format('select coalesce(jsonb_agg(to_jsonb(t) order by t._n), ''[]'') from (select row_number() over (order by %s) as _n, %s as key, %s as label, %s as href, %s from %s where %s group by %s) t',
                  v_sort, v_key, v_label, v_href, v_measures, v_src, v_where, v_key);
  execute v_sql into v_rows;
  execute format('select to_jsonb(t) from (select %s from %s where %s) t', v_measures, v_src, v_where) into v_totals;
  return jsonb_build_object('report', p_report, 'from', v_from, 'to', v_to, 'group_by', v_dim, 'filters', v_filters,
                            'dims', (select jsonb_agg(k2) from jsonb_object_keys(v_dims) k2), 'columns', v_cols, 'rows', v_rows, 'totals', v_totals);
end $$;

-- -----------------------------------------------------------------------------
-- 8. Notifications: categories, mute, reminders
-- -----------------------------------------------------------------------------
alter table public.notifications add column category text not null default 'general';
create index notifications_user_company_idx on public.notifications (user_id, company_id, created_at desc);

create table public.notification_preferences (
  user_id    uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  category   text not null,
  in_app     boolean not null default true,
  email      boolean not null default false,
  primary key (user_id, company_id, category)
);
alter table public.notification_preferences enable row level security;
create policy notification_preferences_own on public.notification_preferences for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and company_id = any ((select app.my_company_ids())::uuid[]));
grant select, insert, update, delete on public.notification_preferences to authenticated;

create or replace function app.notification_category(p_type text, p_entity text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_type = 'approval' then 'approvals'
    when p_entity in ('leave_requests','payslips','payroll_runs','employment_contracts','employees') then 'people'
    when p_entity in ('vat_declarations','fiscalization_records') then 'tax'
    when p_entity in ('shipments','delivery_routes') then 'logistics'
    when p_entity in ('sales_orders','channel_orders') then 'sales'
    when p_entity in ('stock_alerts','lots','replenishment_runs','product_variants','purchase_orders') then 'stock'
    else 'general' end
$$;

create or replace function app.tg_notification_category()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.category = 'general' then new.category := app.notification_category(new.type, new.entity_type); end if;
  -- muted categories are not delivered in the app (approvals are always delivered)
  if new.category <> 'approvals' and exists (select 1 from public.notification_preferences np where np.user_id = new.user_id and np.company_id = new.company_id
                                                and np.category = new.category and not np.in_app) then
    return null;
  end if;
  return new;
end $$;
create trigger trg_01_category before insert on public.notifications for each row execute function app.tg_notification_category();

-- once per user, title and day
create or replace function app.remind(p_company uuid, p_role_keys text[], p_title text, p_body text, p_link text, p_entity text, p_entity_id uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  insert into public.notifications (company_id, user_id, type, title, body, link, entity_type, entity_id)
  select distinct p_company, m.user_id, 'alert', p_title, p_body, p_link, p_entity, p_entity_id
    from public.company_members m join public.member_roles mr on mr.member_id = m.id join public.roles r on r.id = mr.role_id
   where m.company_id = p_company and m.status = 'active' and m.deleted_at is null and m.user_id is not null and r.key = any (p_role_keys)
     and not exists (select 1 from public.notifications n where n.user_id = m.user_id and n.company_id = p_company and n.title = p_title
                       and n.created_at >= date_trunc('day', now()));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function public.run_daily_reminders()
returns int language plpgsql security definer set search_path = '' as $$
declare c record; o record; v_n int := 0; k record; l record;
begin
  for c in select id, country_code from public.companies where is_active and deleted_at is null loop
    -- tax and payroll deadlines in the next 5 days
    for o in select * from public.tax_calendar_internal(c.id) t where t.status in ('open','draft','overdue') and t.due_date <= current_date + 5 loop
      v_n := v_n + app.remind(c.id, case when o.obligation = 'vat' then array['finance_manager','accountant','company_admin'] else array['hr_manager','finance_manager','company_admin'] end,
                              case when o.obligation = 'vat' then 'VAT return ' else 'Payroll declaration ' end || to_char(o.period_start, 'MM/YYYY')
                                || case when o.due_date < current_date then ' is overdue' else ' due ' || to_char(o.due_date, 'DD Mon') end,
                              case when o.document_number is not null then o.document_number || ' is ' || o.status end,
                              case when o.obligation = 'vat' then '/tax' else '/hr/payroll' end, null, null);
    end loop;
    -- contracts ending within 30 days
    for k in select e.full_name, e.id, ct.end_date from public.employment_contracts ct join public.employees e on e.id = ct.employee_id
              where ct.company_id = c.id and ct.status = 'active' and ct.deleted_at is null and ct.end_date between current_date and current_date + 30 loop
      v_n := v_n + app.remind(c.id, array['hr_manager'], 'Contract of ' || k.full_name || ' ends ' || to_char(k.end_date, 'DD Mon'),
                              null, '/hr/employees/' || k.id, 'employees', k.id);
    end loop;
    -- lots expiring within 14 days with stock on hand
    for l in select lt.id, lt.lot_number, lt.expiry_date, v.sku, sum(sl.on_hand) as qty from public.lots lt join public.product_variants v on v.id = lt.variant_id
               join public.stock_levels sl on sl.lot_id = lt.id
              where lt.company_id = c.id and lt.expiry_date between current_date and current_date + 14 and lt.deleted_at is null
              group by lt.id, lt.lot_number, lt.expiry_date, v.sku having sum(sl.on_hand) > 0 loop
      v_n := v_n + app.remind(c.id, array['inventory_manager','warehouse_operator'], 'Lot ' || l.lot_number || ' (' || l.sku || ') expires ' || to_char(l.expiry_date, 'DD Mon'),
                              trim_scale(l.qty) || ' on hand', '/wms/lots/' || l.id, 'lots', l.id);
    end loop;
  end loop;
  return v_n;
end $$;

-- tax_calendar without the caller's permission check (for the scheduler)
create or replace function public.tax_calendar_internal(p_company uuid)
returns table (obligation text, period_start date, period_end date, due_date date, status text, document_id uuid, document_number text, amount numeric)
language plpgsql stable security definer set search_path = '' as $$
declare v_country text; m date;
begin
  select country_code into v_country from public.companies where id = p_company;
  m := (date_trunc('month', current_date) - interval '1 month')::date;
  return query
  select 'vat'::text, m, (m + interval '1 month - 1 day')::date, (m + interval '1 month')::date + case when v_country = 'XK' then 19 else 13 end,
         coalesce(d.status, case when (m + interval '1 month')::date + case when v_country = 'XK' then 19 else 13 end < current_date then 'overdue' else 'open' end),
         d.id, d.number, d.payable
    from (select 1) x left join lateral (select * from public.vat_declarations v where v.company_id = p_company and v.deleted_at is null
                                           and v.status <> 'rejected' and v.period_start = m limit 1) d on true
  union all
  select 'payroll'::text, m, (m + interval '1 month - 1 day')::date, (m + interval '1 month')::date + case when v_country = 'XK' then 14 else 19 end,
         coalesce(case when r.status in ('posted','paid') then 'declared' else r.status end,
                  case when (m + interval '1 month')::date + case when v_country = 'XK' then 14 else 19 end < current_date then 'overdue' else 'open' end),
         r.id, r.number, r.total_income_tax
    from (select 1) x left join lateral (select * from public.payroll_runs pr where pr.company_id = p_company and pr.deleted_at is null
                                           and pr.status <> 'cancelled' and pr.period_start = m limit 1) r on true
   where exists (select 1 from public.employees e where e.company_id = p_company and e.deleted_at is null);
end $$;
revoke execute on function public.run_daily_reminders(), public.tax_calendar_internal(uuid) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('drispro-reminders', '0 6 * * *', 'select public.run_daily_reminders()');
  end if;
exception when others then
  raise notice 'pg_cron not available (%); schedule public.run_daily_reminders() externally', sqlerrm;
end $$;

-- -----------------------------------------------------------------------------
-- 9. Global search, extended
-- -----------------------------------------------------------------------------
create or replace function public.global_search(p_company uuid, p_query text, p_limit int default 6)
returns table (kind text, id uuid, title text, subtitle text, href text)
language sql stable security invoker set search_path = '' as $$
  with q as (select '%' || replace(replace(btrim(p_query), '%', '\%'), '_', '\_') || '%' as pat)
  (select 'product', p.id, v.name, v.sku, '/inventory/products/' || p.id
     from public.product_variants v join public.products p on p.id = v.product_id, q
    where v.company_id = p_company and v.deleted_at is null and p.deleted_at is null
      and (v.name ilike q.pat or v.sku ilike q.pat
           or exists (select 1 from public.product_barcodes b where b.variant_id = v.id and b.barcode = btrim(p_query)))
    order by v.name limit p_limit)
  union all
  (select 'partner', bp.id, bp.name, concat_ws(' · ', bp.code, bp.tax_number), '/partners/' || bp.id
     from public.business_partners bp, q
    where bp.company_id = p_company and bp.deleted_at is null
      and (bp.name ilike q.pat or bp.code ilike q.pat or bp.tax_number ilike q.pat or bp.email ilike q.pat)
    order by bp.name limit p_limit)
  union all
  (select 'employee', e.id, e.full_name, concat_ws(' · ', e.number, jp.title, d.name), '/hr/employees/' || e.id
     from public.employees e left join public.job_positions jp on jp.id = e.position_id left join public.departments d on d.id = e.department_id, q
    where e.company_id = p_company and e.deleted_at is null
      and (e.full_name ilike q.pat or e.number ilike q.pat or e.email ilike q.pat or e.personal_number ilike q.pat)
    order by e.full_name limit 4)
  union all
  (select 'account', a.id, a.code || ' ' || a.name, 'Account · ' || a.account_type, '/finance/accounts/' || a.id
     from public.accounts a, q
    where a.company_id = p_company and a.deleted_at is null and (a.code ilike btrim(p_query) || '%' or a.name ilike q.pat)
    order by a.code limit 4)
  union all
  (select 'opportunity', o.id, o.name, 'Opportunity · ' || o.status, '/crm/pipeline?open=' || o.id
     from public.opportunities o, q
    where o.company_id = p_company and o.deleted_at is null and (o.name ilike q.pat or o.number ilike q.pat)
    order by o.created_at desc limit 4)
  union all
  (select 'lead', l.id, l.title, concat_ws(' · ', l.company_name, l.contact_name), '/crm/leads?open=' || l.id
     from public.leads l, q
    where l.company_id = p_company and l.deleted_at is null
      and (l.title ilike q.pat or l.company_name ilike q.pat or l.contact_name ilike q.pat or l.number ilike q.pat or l.email ilike q.pat)
    order by l.created_at desc limit 4)
  union all
  (select 'lot', l.id, l.lot_number, 'Lot · ' || v.sku || coalesce(' · expires ' || to_char(l.expiry_date, 'DD Mon YYYY'), ''), '/wms/lots/' || l.id
     from public.lots l join public.product_variants v on v.id = l.variant_id, q
    where l.company_id = p_company and l.deleted_at is null and l.lot_number ilike q.pat
    order by l.expiry_date nulls last limit 4)
  union all
  (select 'bom', b.id, b.code || ' · ' || v.name, 'Bill of materials · v' || b.version, '/manufacturing/boms/' || b.id
     from public.boms b join public.product_variants v on v.id = b.variant_id, q
    where b.company_id = p_company and b.deleted_at is null and (b.code ilike q.pat or b.name ilike q.pat or v.name ilike q.pat or v.sku ilike q.pat)
    order by b.code limit 4)
  union all
  (select 'warehouse', w.id, w.name, w.code, '/inventory/warehouses'
     from public.warehouses w, q
    where w.company_id = p_company and w.deleted_at is null and (w.name ilike q.pat or w.code ilike q.pat)
    limit 3)
  union all
  (select 'vendor_bill', b.id, b.number, 'Vendor bill · ' || b.vendor_invoice_number || ' · ' || b.status, '/procurement/bills/' || b.id
     from public.vendor_bills b, q
    where b.company_id = p_company and b.deleted_at is null and (b.number ilike q.pat or b.vendor_invoice_number ilike q.pat)
    order by b.bill_date desc limit 4)
  union all
  (select 'shipment', s.id, s.number, 'Shipment · ' || replace(s.status, '_', ' ') || coalesce(' · ' || s.tracking_number, ''), '/logistics/shipments/' || s.id
     from public.shipments s, q
    where s.company_id = p_company and s.deleted_at is null and (s.number ilike q.pat or s.tracking_number ilike q.pat)
    order by s.created_at desc limit 4)
  union all
  (select 'channel_order', co.id, coalesce(co.external_order_number, co.external_order_id), 'Web order · ' || ch.name || ' · ' || co.import_status,
          coalesce('/sales/orders/' || co.sales_order_id, '/ecommerce?order=' || co.id)
     from public.channel_orders co join public.sales_channels ch on ch.id = co.channel_id, q
    where co.company_id = p_company and (co.external_order_number ilike q.pat or co.external_order_id ilike q.pat)
    order by co.created_at desc limit 3)
  union all
  (select d.kind, d.id, d.number, d.label, d.href from (
      select 'goods_receipt' as kind, g.id, g.number, 'Goods receipt · ' || g.status as label, '/inventory/receipts/' || g.id as href, g.company_id, g.deleted_at from public.goods_receipts g
      union all select 'stock_adjustment', a.id, a.number, 'Adjustment · ' || a.status, '/inventory/adjustments/' || a.id, a.company_id, a.deleted_at from public.stock_adjustments a
      union all select 'stock_transfer', t.id, t.number, 'Transfer · ' || t.status, '/inventory/transfers/' || t.id, t.company_id, t.deleted_at from public.stock_transfers t
      union all select 'landed_cost', l.id, l.number, 'Landed cost · ' || l.status, '/inventory/landed-costs/' || l.id, l.company_id, l.deleted_at from public.landed_costs l
      union all select 'purchase_requisition', pr.id, pr.number, 'Requisition · ' || pr.status, '/procurement/requisitions/' || pr.id, pr.company_id, pr.deleted_at from public.purchase_requisitions pr
      union all select 'purchase_order', o.id, o.number, 'Purchase order · ' || o.status, '/procurement/orders/' || o.id, o.company_id, o.deleted_at from public.purchase_orders o
      union all select 'sales_quote', sq.id, sq.number, 'Quote · ' || sq.status, '/sales/quotes/' || sq.id, sq.company_id, sq.deleted_at from public.sales_quotes sq
      union all select 'sales_order', s.id, s.number, 'Sales order · ' || s.status, '/sales/orders/' || s.id, s.company_id, s.deleted_at from public.sales_orders s
      union all select 'delivery', dl.id, dl.number, 'Delivery · ' || dl.status, '/sales/deliveries/' || dl.id, dl.company_id, dl.deleted_at from public.deliveries dl
      union all select 'sales_invoice', i.id, i.number, case when i.document_type = 'credit_note' then 'Credit note · ' else 'Invoice · ' end || i.status, '/sales/invoices/' || i.id, i.company_id, i.deleted_at from public.sales_invoices i
      union all select 'payment', pm.id, pm.number, case when pm.document_type = 'customer_payment' then 'Receipt · ' else 'Payment · ' end || pm.status, '/finance/payments/' || pm.id, pm.company_id, pm.deleted_at from public.payments pm
      union all select 'journal_entry', je.id, je.number, 'Journal entry · ' || coalesce(je.memo, je.status), '/finance/journal/' || je.id, je.company_id, je.deleted_at from public.journal_entries je
      union all select 'fixed_asset', fa.id, fa.number, 'Asset · ' || fa.name, '/finance/assets/' || fa.id, fa.company_id, fa.deleted_at from public.fixed_assets fa
      union all select 'work_order', wo.id, wo.number, 'Work order · ' || replace(wo.status, '_', ' '), '/manufacturing/orders/' || wo.id, wo.company_id, wo.deleted_at from public.work_orders wo
      union all select 'delivery_route', rt.id, rt.number, 'Route · ' || to_char(rt.route_date, 'DD Mon') || ' · ' || replace(rt.status, '_', ' '), '/logistics/routes/' || rt.id, rt.company_id, rt.deleted_at from public.delivery_routes rt
      union all select 'vat_declaration', vd.id, vd.number, 'VAT declaration · ' || to_char(vd.period_start, 'MM/YYYY') || ' · ' || vd.status, '/tax/declarations/' || vd.id, vd.company_id, vd.deleted_at from public.vat_declarations vd
      union all select 'payroll_run', pr2.id, pr2.number, 'Payroll · ' || to_char(pr2.period_start, 'MM/YYYY') || ' · ' || pr2.status, '/hr/payroll/' || pr2.id, pr2.company_id, pr2.deleted_at from public.payroll_runs pr2
      union all select 'leave_request', lr.id, lr.number, 'Leave · ' || lr.status, '/hr/leave?id=' || lr.id, lr.company_id, lr.deleted_at from public.leave_requests lr
    ) d, q
    where d.company_id = p_company and d.deleted_at is null and d.number ilike q.pat
    order by d.number desc limit p_limit)
$$;

-- -----------------------------------------------------------------------------
-- 10. Finance overview: VAT due is VAT only; payroll liabilities apart
-- -----------------------------------------------------------------------------
create or replace function public.finance_overview(p_company uuid, p_from date default make_date(extract(year from current_date)::int, 1, 1),
                                                   p_to date default current_date)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with b as (select * from public.account_balances(p_company, p_from, p_to)),
  vat as (select account_id from public.company_account_defaults where company_id = p_company and key in ('vat_output','vat_input','vat_settlement')
          union select output_account_id from public.tax_codes where company_id = p_company and output_account_id is not null
          union select input_account_id from public.tax_codes where company_id = p_company and input_account_id is not null),
  pay as (select account_id from public.company_account_defaults where company_id = p_company
             and key in ('salary_payable','social_security_payable','health_insurance_payable','pension_payable','income_tax_payable'))
  select jsonb_build_object(
    'revenue',  -coalesce((select sum(debit - credit) from b where account_type = 'revenue' and account_subtype = 'revenue'), 0),
    'other_income', -coalesce((select sum(debit - credit) from b where account_type = 'revenue' and account_subtype = 'other_income'), 0),
    'cogs',     coalesce((select sum(debit - credit) from b where account_subtype = 'cogs'), 0),
    'expenses', coalesce((select sum(debit - credit) from b where account_type = 'expense' and account_subtype <> 'cogs'), 0),
    'net_profit', -coalesce((select sum(debit - credit) from b where account_type in ('revenue','expense')), 0),
    'cash', coalesce((select sum(closing) from b where account_subtype in ('cash','bank')), 0),
    'receivables', coalesce((select sum(closing) from b where account_subtype = 'receivable'), 0),
    'payables', -coalesce((select sum(closing) from b where account_subtype = 'payable'), 0),
    'inventory', coalesce((select sum(closing) from b where account_subtype = 'inventory'), 0),
    'vat_due', -coalesce((select sum(closing) from b where account_id in (select account_id from vat)), 0),
    'payroll_due', -coalesce((select sum(closing) from b where account_id in (select account_id from pay)), 0),
    'ar_overdue', coalesce((select sum(d1_30 + d31_60 + d61_90 + d90_plus) from public.partner_aging(p_company, 'ar', p_to)), 0),
    'ap_overdue', coalesce((select sum(d1_30 + d31_60 + d61_90 + d90_plus) from public.partner_aging(p_company, 'ap', p_to)), 0),
    'unmatched_bank_lines', (select count(*) from public.bank_statement_lines where company_id = p_company and match_status = 'unmatched'),
    'draft_entries', (select count(*) from public.journal_entries where company_id = p_company and status = 'draft' and deleted_at is null),
    'cash_by_month', coalesce((select jsonb_agg(x order by x.month) from (
        select to_char(m, 'YYYY-MM') as month,
               coalesce((select sum(jl.debit - jl.credit) from public.journal_lines jl join public.journal_entries e on e.id = jl.entry_id
                          join public.accounts a on a.id = jl.account_id
                         where jl.company_id = p_company and e.status in ('posted','reversed') and a.account_subtype in ('cash','bank')
                           and e.entry_date < m + interval '1 month'), 0) as cash,
               coalesce((select -sum(jl.debit - jl.credit) from public.journal_lines jl join public.journal_entries e on e.id = jl.entry_id
                          join public.accounts a on a.id = jl.account_id
                         where jl.company_id = p_company and e.status in ('posted','reversed') and a.account_type in ('revenue','expense')
                           and e.entry_date >= m and e.entry_date < m + interval '1 month'), 0) as profit
          from generate_series(date_trunc('month', p_to) - interval '11 months', date_trunc('month', p_to), interval '1 month') m) x), '[]'::jsonb)
  )
$$;

-- -----------------------------------------------------------------------------
-- 11. Grants
-- -----------------------------------------------------------------------------
revoke execute on function app.admins_left(uuid, uuid), app.sales_facts(uuid, date, date), app.purchase_facts(uuid, date, date),
  app.stock_as_of(uuid, date), app.remind(uuid, text[], text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.save_custom_role(uuid, uuid, text, text, text[]), public.delete_custom_role(uuid), public.company_users(uuid),
  public.set_member_roles(uuid, uuid[]), public.set_member_status(uuid, text), public.save_approval_workflow(jsonb), public.numbering_overview(uuid),
  public.save_numbering(uuid, text, text, boolean, int, text, bigint), public.audit_feed(uuid, text, uuid, date, date, uuid, text, int, int),
  public.import_rows(uuid, text, jsonb, boolean), public.run_report(uuid, text, jsonb), public.global_search(uuid, text, int) to authenticated;
