-- =============================================================================
--  * A person who already has an account is no longer put into a company at once:
--    they get an invitation and accept or refuse it themselves
--  * "Still to pay" on invoices and bills follows every change to payments, compensations,
--    withholding and credit notes, wherever it comes from
--  * The permission check used for the safe follows the licence, like every other check
-- =============================================================================

-- 1. invitations ---------------------------------------------------------------
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
  perform app._patch_function('public.invite_member',
    $p$  values (p_company, v_user, lower(btrim(p_email)), case when v_user is null then 'invited' else 'active' end, case when v_user is null then null else now() end)$p$,
    $p$  values (p_company, v_user, lower(btrim(p_email)), 'invited', null)$p$);
  perform app._patch_function('public.invite_member',
    $p$    perform app.notify(p_company, v_user, 'info', 'You were added to ' || (select name from public.companies where id = p_company), null, '/', null, null);$p$,
    $p$    perform app.notify(p_company, v_user, 'info', 'You are invited to ' || (select name from public.companies where id = p_company), 'Open DrisPRO to accept or refuse the invitation.', '/', null, null);$p$);
end $$;
drop function app._patch_function(text, text, text);

-- the invitations waiting for me
create or replace function public.my_invitations()
returns table (member_id uuid, company_id uuid, company_name text, invited_at timestamptz, invited_by text, roles text[])
language sql stable security definer set search_path = '' as $$
  select m.id, c.id, c.name, m.created_at,
         (select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id = m.created_by),
         array(select coalesce(r.name, r.key) from public.member_roles mr join public.roles r on r.id = mr.role_id where mr.member_id = m.id order by 1)
    from public.company_members m join public.companies c on c.id = m.company_id and c.deleted_at is null
   where m.user_id = auth.uid() and m.status = 'invited' and m.deleted_at is null
   order by m.created_at desc
$$;

-- accept or refuse
create or replace function public.answer_invitation(p_member uuid, p_accept boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare m public.company_members;
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  select * into m from public.company_members where id = p_member for update;
  if m.id is null or m.user_id is distinct from auth.uid() or m.status <> 'invited' or m.deleted_at is not null then
    raise exception 'This invitation is no longer open' using errcode = '55000';
  end if;
  if p_accept then
    update public.company_members set status = 'active', joined_at = now() where id = p_member;
    return 'active';
  end if;
  update public.company_members set deleted_at = now(), deleted_by = auth.uid() where id = p_member;
  return 'refused';
end $$;
revoke execute on function public.my_invitations(), public.answer_invitation(uuid, boolean) from public, anon;
grant execute on function public.my_invitations(), public.answer_invitation(uuid, boolean) to authenticated;

-- 2. "still to pay" follows every change ----------------------------------------
create or replace function app.tg_refresh_paid()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if tg_table_name = 'payment_allocations' then
    for r in select x.sales_invoice_id as inv, x.vendor_bill_id as bill from (select new.* union all select old.*) x where x.id is not null loop
      if r.inv is not null then perform app.refresh_payment_status('sales_invoices', r.inv); end if;
      if r.bill is not null then perform app.refresh_payment_status('vendor_bills', r.bill); end if;
    end loop;
  elsif tg_table_name = 'payments' then
    for r in select distinct a.sales_invoice_id as inv, a.vendor_bill_id as bill from public.payment_allocations a where a.payment_id = new.id loop
      if r.inv is not null then perform app.refresh_payment_status('sales_invoices', r.inv); end if;
      if r.bill is not null then perform app.refresh_payment_status('vendor_bills', r.bill); end if;
    end loop;
  elsif tg_table_name = 'compensations' then
    for r in select distinct cl.sales_invoice_id as inv, cl.vendor_bill_id as bill from public.compensation_lines cl where cl.compensation_id = new.id loop
      if r.inv is not null then perform app.refresh_payment_status('sales_invoices', r.inv); end if;
      if r.bill is not null then perform app.refresh_payment_status('vendor_bills', r.bill); end if;
    end loop;
  elsif tg_table_name = 'withholdings' then
    if new.bill_id is not null then perform app.refresh_payment_status('vendor_bills', new.bill_id); end if;
  elsif tg_table_name = 'sales_invoices' then
    if new.original_invoice_id is not null then perform app.refresh_payment_status('sales_invoices', new.original_invoice_id); end if;
  elsif tg_table_name = 'vendor_bills' then
    if new.original_bill_id is not null then perform app.refresh_payment_status('vendor_bills', new.original_bill_id); end if;
  end if;
  return null;
end $$;

drop trigger if exists trg_96_refresh_paid on public.payment_allocations;
create trigger trg_96_refresh_paid after insert or update or delete on public.payment_allocations for each row execute function app.tg_refresh_paid();
drop trigger if exists trg_96_refresh_paid on public.payments;
create trigger trg_96_refresh_paid after update of status on public.payments for each row when (new.status is distinct from old.status) execute function app.tg_refresh_paid();
drop trigger if exists trg_96_refresh_paid on public.compensations;
create trigger trg_96_refresh_paid after update of status on public.compensations for each row when (new.status is distinct from old.status) execute function app.tg_refresh_paid();
drop trigger if exists trg_96_refresh_paid on public.withholdings;
create trigger trg_96_refresh_paid after update of status on public.withholdings for each row when (new.status is distinct from old.status) execute function app.tg_refresh_paid();
drop trigger if exists trg_96_refresh_paid on public.sales_invoices;
create trigger trg_96_refresh_paid after update of status on public.sales_invoices for each row
  when (new.status is distinct from old.status and new.document_type = 'credit_note') execute function app.tg_refresh_paid();
drop trigger if exists trg_96_refresh_paid on public.vendor_bills;
create trigger trg_96_refresh_paid after update of status on public.vendor_bills for each row
  when (new.status is distinct from old.status and new.document_type = 'vendor_credit') execute function app.tg_refresh_paid();

-- 3. the safe follows the licence -----------------------------------------------
create or replace function app.has_permission_of(p_user uuid, p_company uuid, p_perm text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.company_members m
      join public.companies c on c.id = m.company_id and c.deleted_at is null
      join public.licenses l on l.company_id = c.id and l.status = 'active' and current_date between l.valid_from and l.valid_until
                            and app.module_allowed(l.plan, l.extra_features, split_part(p_perm, '.', 1))
      join public.member_roles mr on mr.member_id = m.id
      join public.role_permissions rp on rp.role_id = mr.role_id
     where m.user_id = p_user and m.company_id = p_company and m.status = 'active' and m.deleted_at is null
       and (rp.permission in (p_perm, '*', split_part(p_perm, '.', 1) || '.*', '*.' || split_part(p_perm, '.', 2))))
$$;
