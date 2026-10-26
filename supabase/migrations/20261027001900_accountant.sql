-- =============================================================================
-- The external accountant: free, and with all their clients on one page
--   Every company may invite one outside accountant who does not take a user seat of the licence.
--   They get the Accountant role (books, VAT, bank, invoices; no money moves of their own beyond that role).
--   An accountant who works for several DrisPRO companies sees them all on "My clients":
--   what waits in each one (bank lines, receipts to book, draft bills, VAT deadlines, overdue debts),
--   and opens a company at the right page with one click.
-- =============================================================================

alter table public.company_members add column if not exists external_accountant boolean not null default false;

-- the free accountant does not count against the licence
create or replace function app.seats_used(p_company uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select (count(*) - least(1, count(*) filter (where m.external_accountant)))::int from public.company_members m
   where m.company_id = p_company and m.deleted_at is null and m.status in ('active','invited')
     and not coalesce((select p.is_super_admin from public.profiles p where p.id = m.user_id), false)
$$;

create or replace function public.invite_accountant(p_company uuid, p_email text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_member uuid; v_user uuid; v_old uuid;
begin
  perform app.require_permission(p_company, 'admin.write');
  if nullif(btrim(p_email), '') is null or p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address' using errcode = '23514'; end if;
  if exists (select 1 from public.company_members where company_id = p_company and deleted_at is null and external_accountant and status in ('active', 'invited')) then
    raise exception 'This company already has its outside accountant; remove them first' using errcode = '23505';
  end if;
  select id into v_user from auth.users where lower(email) = lower(btrim(p_email));
  select id into v_old from public.company_members m where m.company_id = p_company and m.deleted_at is null
     and (m.user_id = v_user or lower(m.invited_email) = lower(btrim(p_email)));
  if v_old is not null then
    -- someone already here becomes the outside accountant (their seat is freed)
    update public.company_members set external_accountant = true where id = v_old;
    insert into public.member_roles (company_id, member_id, role_id)
    select p_company, v_old, r.id from public.roles r where r.key = 'accountant' and r.company_id is null
       and not exists (select 1 from public.member_roles x where x.member_id = v_old and x.role_id = r.id);
    return v_old;
  end if;
  insert into public.company_members (company_id, user_id, invited_email, status, joined_at, external_accountant)
  values (p_company, v_user, lower(btrim(p_email)), case when v_user is null then 'invited' else 'active' end, case when v_user is null then null else now() end, true)
  returning id into v_member;
  insert into public.member_roles (company_id, member_id, role_id)
  select p_company, v_member, r.id from public.roles r where r.key = 'accountant' and r.company_id is null;
  if v_user is not null then
    perform app.notify(p_company, v_user, 'info', 'You were added to ' || (select name from public.companies where id = p_company) || ' as their accountant', null, '/accountant', null, null);
  end if;
  return v_member;
end $$;
revoke execute on function public.invite_accountant(uuid, text) from public, anon;
grant execute on function public.invite_accountant(uuid, text) to authenticated;

-- the users list says who the outside accountant is
drop function if exists public.company_users(uuid);
create or replace function public.company_users(p_company uuid)
returns table (member_id uuid, user_id uuid, email text, full_name text, status text, joined_at timestamptz, last_sign_in_at timestamptz,
               role_ids uuid[], role_names text[], is_self boolean, employee_id uuid, external_accountant boolean)
language sql stable security definer set search_path = '' as $$
  select m.id, m.user_id, coalesce(u.email, m.invited_email), p.full_name, m.status, m.joined_at, u.last_sign_in_at,
         coalesce(array_agg(r.id order by r.sort_order, r.name) filter (where r.id is not null), '{}'),
         coalesce(array_agg(r.name order by r.sort_order, r.name) filter (where r.id is not null), '{}'),
         m.user_id = auth.uid(),
         (select e.id from public.employees e where e.company_id = m.company_id and e.user_id = m.user_id and e.deleted_at is null limit 1),
         m.external_accountant
    from public.company_members m
    left join auth.users u on u.id = m.user_id
    left join public.profiles p on p.id = m.user_id
    left join public.member_roles mr on mr.member_id = m.id
    left join public.roles r on r.id = mr.role_id
   where m.company_id = p_company and m.deleted_at is null and app.has_permission(p_company, 'admin.read')
   group by m.id, u.email, u.last_sign_in_at, p.full_name
   order by m.status = 'active' desc, coalesce(p.full_name, u.email, m.invited_email)
$$;
grant execute on function public.company_users(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- "My clients": every company the person keeps the books of, with what waits in each
-- ---------------------------------------------------------------------------------------------
create or replace function public.accountant_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c record; v jsonb := '[]'; v_vat record; v_bank int; v_exp int; v_bills int; v_inv int; v_overdue numeric; v_reads int; v_period text; v_last date;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  for c in select co.id, co.name, co.country_code, co.base_currency, m.external_accountant
             from public.company_members m join public.companies co on co.id = m.company_id
            where m.user_id = auth.uid() and m.status = 'active' and m.deleted_at is null and co.deleted_at is null and co.is_active
            order by co.name loop
    if not app.has_permission(c.id, 'finance.read') then continue; end if;
    select count(*) into v_bank from public.bank_statement_lines l join public.bank_statements s on s.id = l.statement_id
     where l.company_id = c.id and s.status = 'open' and s.deleted_at is null and l.match_status = 'unmatched';
    select count(*) into v_exp from app.document_reads where company_id = c.id and kind = 'expense' and status = 'done' and bill_id is null;
    select count(*) into v_reads from app.document_reads where company_id = c.id and kind = 'supplier_invoice' and status = 'done' and receipt_id is null
       and created_at > now() - interval '30 days';
    select count(*) into v_bills from public.vendor_bills where company_id = c.id and status = 'draft' and deleted_at is null;
    select count(*) into v_inv from public.sales_invoices where company_id = c.id and status = 'draft' and deleted_at is null;
    select coalesce(sum(amount_due), 0) into v_overdue from public.sales_invoices
     where company_id = c.id and status = 'posted' and deleted_at is null and payment_status <> 'paid' and due_date < current_date;
    select obligation, period_start, due_date, status into v_vat from public.tax_calendar_internal(c.id) t
     where t.status in ('open', 'draft', 'overdue') order by t.due_date limit 1;
    select max(entry_date) into v_last from public.journal_entries where company_id = c.id and status = 'posted';
    select string_agg(name, ', ' order by start_date) into v_period from (
      select name, start_date from public.fiscal_periods where company_id = c.id and status = 'open' and end_date < date_trunc('month', current_date)::date order by start_date limit 3) x;
    v := v || jsonb_build_array(jsonb_build_object(
      'id', c.id, 'name', c.name, 'country', c.country_code, 'currency', c.base_currency, 'outside', c.external_accountant,
      'bank_lines', v_bank, 'expenses', v_exp, 'supplier_reads', v_reads, 'draft_bills', v_bills, 'draft_invoices', v_inv,
      'overdue', v_overdue, 'last_entry', v_last, 'open_periods', v_period,
      'deadline', case when v_vat.due_date is not null then jsonb_build_object('obligation', v_vat.obligation, 'period', to_char(v_vat.period_start, 'MM/YYYY'),
                         'due', v_vat.due_date, 'status', v_vat.status, 'days', v_vat.due_date - current_date) end,
      'todo', v_bank + v_exp + v_bills + case when v_vat.due_date is not null and v_vat.due_date - current_date <= 7 then 1 else 0 end));
  end loop;
  return v;
end $$;
revoke execute on function public.accountant_overview() from public, anon;
grant execute on function public.accountant_overview() to authenticated;
