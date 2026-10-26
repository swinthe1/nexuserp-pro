-- =============================================================================
-- Payroll: night and holiday premiums, deductions from pay, salary advances
-- Promotions: % off, a fixed price, "3 for 2" — on the till and in sales
-- =============================================================================

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;

-- two more posting accounts
do $$
declare v_keys text[];
begin
  -- the keys allowed now, whichever way the constraint was written, plus every key in use
  select array_agg(distinct m[1]) into v_keys
    from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '([a-z][a-z_]+[a-z])', 'g') m
   where c.conrelid = 'public.company_account_defaults'::regclass and c.conname = 'company_account_defaults_key_check'
     and m[1] not in ('key', 'any', 'text', 'array', 'check');
  v_keys := v_keys || array(select distinct key from public.company_account_defaults);
  v_keys := array(select distinct unnest(v_keys || array['employee_advances', 'salary_deductions_payable']) order by 1);
  alter table public.company_account_defaults drop constraint company_account_defaults_key_check;
  execute format('alter table public.company_account_defaults add constraint company_account_defaults_key_check check (key = any (%L::text[]))', v_keys);
end $$;

create or replace function app.ensure_payroll_accounts(p_company uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.accounts (company_id, code, name, account_type, account_subtype, cash_flow_category, parent_id)
  select p_company, x.code, x.name, x.t, x.st, 'operating',
         (select id from public.accounts p where p.company_id = p_company and p.code = left(x.code, 1) and p.deleted_at is null)
    from (values ('425', 'Advances and loans to employees', 'asset', 'current_asset'),
                 ('4687', 'Salary deductions owed to others', 'liability', 'current_liability')) x(code, name, t, st)
   where not exists (select 1 from public.accounts a where a.company_id = p_company and a.code = x.code and a.deleted_at is null);
  insert into public.company_account_defaults (company_id, key, account_id)
  select p_company, d.key, a.id from (values ('employee_advances', '425'), ('salary_deductions_payable', '4687')) d(key, code)
    join public.accounts a on a.company_id = p_company and a.code = d.code and a.deleted_at is null
  on conflict do nothing;
end $$;

-- =============================================================================
-- 1. Night and holiday hours
-- =============================================================================
alter table public.attendance_records
  add column if not exists night_hours numeric(6,2),
  add column if not exists holiday_hours numeric(6,2);
alter table public.company_settings
  add column if not exists payroll_night_pct numeric(6,2),
  add column if not exists payroll_holiday_pct numeric(6,2);

-- worked between 22:00 and 06:00, and worked on a public holiday or a rest day, from the clock times
create or replace function app.tg_attendance_premium_hours()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_tz text; a timestamp; b timestamp; d date; v_night numeric := 0; s timestamp; e timestamp;
begin
  if new.check_in is null or new.check_out is null or new.check_out <= new.check_in then return new; end if;
  select coalesce(timezone, 'Europe/Tirane') into v_tz from public.companies where id = new.company_id;
  a := new.check_in at time zone v_tz; b := new.check_out at time zone v_tz;
  if tg_op = 'INSERT' or new.night_hours is not distinct from old.night_hours then
    for d in select generate_series(a::date - 1, b::date, interval '1 day')::date loop
      s := greatest(a, d + time '22:00'); e := least(b, d + 1 + time '06:00');
      if e > s then v_night := v_night + extract(epoch from e - s) / 3600; end if;
    end loop;
    new.night_hours := round(v_night, 2);
  end if;
  if tg_op = 'INSERT' or new.holiday_hours is not distinct from old.holiday_hours then
    new.holiday_hours := case when app.working_days(new.company_id, new.work_date, new.work_date) = 0
                              then round(extract(epoch from b - a) / 3600, 2) else 0 end;
  end if;
  return new;
end $$;
drop trigger if exists trg_10_premium_hours on public.attendance_records;
create trigger trg_10_premium_hours before insert or update of check_in, check_out, night_hours, holiday_hours on public.attendance_records
  for each row execute function app.tg_attendance_premium_hours();

-- the premiums: the company's own, else the law's usual one
create or replace function app.payroll_premiums(p_company uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'night', coalesce(s.payroll_night_pct, case when c.country_code = 'XK' then 20 else 20 end),
    'holiday', coalesce(s.payroll_holiday_pct, case when c.country_code = 'XK' then 50 else 25 end))
    from public.companies c left join public.company_settings s on s.company_id = c.id where c.id = p_company
$$;

-- =============================================================================
-- 2. Deductions from pay (loans, salary advances, court orders, union fees…)
-- =============================================================================
create table public.employee_deductions (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id),
  employee_id  uuid not null,
  kind         text not null check (kind in ('advance', 'loan', 'garnishment', 'union', 'other')),
  name         text not null,
  amount       numeric(18,2) check (amount is null or amount > 0),       -- each month
  percent      numeric(6,3) check (percent is null or (percent > 0 and percent <= 100)),   -- or a share of the net
  total        numeric(18,2) check (total is null or total > 0),         -- stop when this much is taken (null: no end)
  starts_on    date not null default current_date,
  ends_on      date,
  partner_id   uuid,                                                      -- who receives it (a bank, a court, a union)
  is_active    boolean not null default true,
  notes        text,
  check (amount is not null or percent is not null),
  foreign key (company_id, employee_id) references public.employees(company_id, id),
  foreign key (company_id, partner_id) references public.business_partners(company_id, id)
);
select app.register_table('public.employee_deductions', 'payroll');
create index employee_deductions_emp_idx on public.employee_deductions (employee_id) where deleted_at is null;

-- how much a deduction has taken in posted payrolls
create or replace function app.deduction_taken(p_deduction uuid, p_except_run uuid default null)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(pl.amount), 0) from public.payslip_lines pl join public.payslips ps on ps.id = pl.payslip_id
    join public.payroll_runs r on r.id = ps.payroll_run_id
   where pl.code = 'DED:' || p_deduction and r.status in ('posted', 'paid') and r.id is distinct from p_except_run
$$;

create or replace function public.employee_deductions_list(p_employee uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_co uuid;
begin
  select company_id into v_co from public.employees where id = p_employee;
  perform app.require_permission(v_co, 'payroll.read');
  return coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'name', d.name, 'amount', d.amount, 'percent', d.percent, 'total', d.total,
            'starts_on', d.starts_on, 'ends_on', d.ends_on, 'is_active', d.is_active, 'notes', d.notes, 'partner_id', d.partner_id,
            'partner', (select name from public.business_partners where id = d.partner_id), 'taken', app.deduction_taken(d.id)) order by d.is_active desc, d.starts_on desc)
     from public.employee_deductions d where d.employee_id = p_employee and d.deleted_at is null), '[]'::jsonb);
end $$;

-- a salary advance paid now, taken back from the next salaries: {employee_id, amount, months, bank_account_id, date?, note?}
create or replace function public.employee_advance_pay(p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare e public.employees; v_amt numeric; v_months int; v_bank public.bank_accounts; v_date date; v_ded uuid; v_je uuid;
begin
  select * into e from public.employees where id = (p ->> 'employee_id')::uuid and deleted_at is null;
  if e.id is null then raise exception 'Employee not found' using errcode = 'P0002'; end if;
  perform app.require_permission(e.company_id, 'payroll.write');
  perform app.require_permission(e.company_id, 'finance.write');
  v_amt := round((p ->> 'amount')::numeric, 2);
  v_months := greatest(1, coalesce((p ->> 'months')::int, 1));
  if coalesce(v_amt, 0) <= 0 then raise exception 'Enter the amount of the advance' using errcode = '23514'; end if;
  select * into v_bank from public.bank_accounts where id = (p ->> 'bank_account_id')::uuid and company_id = e.company_id;
  if v_bank.id is null then raise exception 'Choose the cash box or bank it is paid from' using errcode = '23514'; end if;
  v_date := coalesce(nullif(p ->> 'date', '')::date, current_date);
  perform app.ensure_payroll_accounts(e.company_id);
  insert into public.employee_deductions (company_id, employee_id, kind, name, amount, total, starts_on, notes)
  values (e.company_id, e.id, 'advance', 'Paradhënie rroge ' || to_char(v_date, 'DD.MM.YYYY'), round(v_amt / v_months, 2), v_amt,
          date_trunc('month', v_date)::date, nullif(p ->> 'note', ''))
  returning id into v_ded;
  v_je := app.gl_post(e.company_id, 'GEN', app.first_open_date(e.company_id, v_date), null, null, 'ADV ' || e.number,
    'Salary advance · ' || e.full_name,
    jsonb_build_array(jsonb_build_object('account_id', app.acct(e.company_id, 'employee_advances'), 'amount', v_amt, 'partner_id', e.partner_id,
                                         'description', 'Salary advance ' || e.full_name),
                      jsonb_build_object('account_id', v_bank.account_id, 'amount', -v_amt, 'description', 'Salary advance ' || e.full_name)),
    'adv:' || v_ded);
  return v_ded;
end $$;

-- the run: premiums after overtime, deductions after tax
do $$ begin
  if position('payroll_premiums' in pg_get_functiondef('public.calculate_payroll'::regproc)) = 0 then
    perform app._patch_function('public.calculate_payroll',
      $o$v_hourly numeric; v_n int := 0;$o$,
      $n$v_hourly numeric; v_prem jsonb; v_nh numeric; v_hh numeric; v_night numeric; v_hol numeric; v_net numeric; v_ded numeric; v_amt numeric; v_left numeric; dd record; v_n int := 0;$n$);
    perform app._patch_function('public.calculate_payroll',
      $o$    v_gross := v_basic + v_ot + v_extra;$o$,
      $n$    -- night and holiday work: the premium on top of the hours already paid
    v_prem := app.payroll_premiums(r.company_id);
    select coalesce(sum(a.night_hours), 0), coalesce(sum(a.holiday_hours), 0) into v_nh, v_hh from public.attendance_records a
     where a.employee_id = k.employee_id and a.work_date between r.period_start and r.period_end;
    v_night := round(v_nh * coalesce(v_hourly, 0) * (v_prem ->> 'night')::numeric / 100, 2);
    v_hol := round(v_hh * coalesce(v_hourly, 0) * (v_prem ->> 'holiday')::numeric / 100, 2);
    v_gross := v_basic + v_ot + v_extra + v_night + v_hol;$n$);
    perform app._patch_function('public.calculate_payroll',
      $o$      values (r.company_id, v_slip, 'earning', it.code, it.name, it.amount);
    end loop;$o$,
      $n$      values (r.company_id, v_slip, 'earning', it.code, it.name, it.amount);
    end loop;
    insert into public.payslip_lines (company_id, payslip_id, line_type, code, name, base, rate_pct, amount)
    select r.company_id, v_slip, 'earning', x.c, x.n, round(coalesce(v_hourly, 0), 2), x.p, x.a from (values
      ('NIGHT', 'Night work · ' || trim_scale(v_nh) || ' h', (v_prem ->> 'night')::numeric, v_night),
      ('HOLIDAY', 'Holiday work · ' || trim_scale(v_hh) || ' h', (v_prem ->> 'holiday')::numeric, v_hol)) x(c, n, p, a)
     where x.a <> 0;
    -- deductions from the net: each month's amount (or share), never more than what is left of it or of the net
    v_net := v_gross - v_ee - v_tax; v_ded := 0;
    for dd in select * from public.employee_deductions
              where employee_id = k.employee_id and is_active and deleted_at is null
                and starts_on <= r.period_end and (ends_on is null or ends_on >= r.period_start)
              order by case kind when 'garnishment' then 0 when 'advance' then 1 when 'loan' then 2 else 3 end, created_at loop
      v_amt := case when dd.percent is not null then round(v_net * dd.percent / 100, 2) else dd.amount end;
      v_left := case when dd.total is null then null else greatest(dd.total - app.deduction_taken(dd.id, r.id), 0) end;
      v_amt := least(v_amt, coalesce(v_left, v_amt), greatest(v_net - v_ded, 0));
      continue when v_amt <= 0;
      insert into public.payslip_lines (company_id, payslip_id, line_type, code, name, amount)
      values (r.company_id, v_slip, 'deduction', 'DED:' || dd.id, dd.name, v_amt);
      v_ded := v_ded + v_amt;
    end loop;
    update public.payslips set other_deductions = v_ded, net_salary = v_net - v_ded where id = v_slip;$n$);
  end if;
  if position('salary_deductions_payable' in pg_get_functiondef('public.post_payroll'::regproc)) = 0 then
    perform app._patch_function('public.post_payroll',
      $o$declare r public.payroll_runs; v_lines jsonb := '[]'::jsonb; c record; v_je uuid;$o$,
      $n$declare r public.payroll_runs; v_lines jsonb := '[]'::jsonb; c record; v_je uuid; c2 record;$n$);
    perform app._patch_function('public.post_payroll',
      $o$  v_je := app.gl_post(r.company_id, 'PAY',$o$,
      $n$  -- what was kept back from the salaries: advances and loans come back, the rest is owed to whom it is for
  if exists (select 1 from public.payslip_lines pl join public.payslips ps on ps.id = pl.payslip_id where ps.payroll_run_id = r.id and pl.line_type = 'deduction') then
    perform app.ensure_payroll_accounts(r.company_id);
  end if;
  for c2 in select case when d.kind in ('advance', 'loan') then app.acct(r.company_id, 'employee_advances') else app.acct(r.company_id, 'salary_deductions_payable') end acc,
                   case when d.kind in ('advance', 'loan') then e.partner_id else d.partner_id end partner, sum(pl.amount) amt
              from public.payslip_lines pl join public.payslips ps on ps.id = pl.payslip_id
              join public.employee_deductions d on 'DED:' || d.id = pl.code join public.employees e on e.id = ps.employee_id
             where ps.payroll_run_id = r.id and pl.line_type = 'deduction' group by 1, 2 loop
    v_lines := v_lines || jsonb_build_object('account_id', c2.acc, 'amount', -c2.amt, 'partner_id', c2.partner, 'description', 'Deductions from salaries');
  end loop;
  v_je := app.gl_post(r.company_id, 'PAY',$n$);
  end if;
end $$;

-- =============================================================================
-- 3. Promotions
-- =============================================================================
create table public.promotions (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  name          text not null,
  kind          text not null check (kind in ('percent', 'fixed_price', 'buy_get')),
  value         numeric(18,4),                 -- % off, or the price with VAT
  buy_qty       int check (buy_qty is null or buy_qty > 0),
  get_qty       int check (get_qty is null or get_qty > 0),
  min_qty       numeric(18,4) not null default 1 check (min_qty > 0),
  variant_ids   uuid[] not null default '{}',  -- empty with no categories: every item
  category_ids  uuid[] not null default '{}',
  starts_on     date,
  ends_on       date,
  weekdays      int[],                         -- 1 Monday … 7 Sunday; null every day
  time_from     time,
  time_to       time,
  channels      text[] not null default '{pos,sales}',
  warehouse_ids uuid[],                        -- null: every shop
  is_active     boolean not null default true,
  check ((kind = 'buy_get' and buy_qty is not null and get_qty is not null) or (kind <> 'buy_get' and value is not null and value >= 0)),
  check (kind <> 'percent' or value <= 100)
);
select app.register_table('public.promotions', 'sales');
create index promotions_company_idx on public.promotions (company_id) where deleted_at is null and is_active;
alter table public.pos_order_lines add column if not exists promotion_id uuid;
-- "3 for 2" is 33.3333 % off: two decimals would leave the receipt a cent off.
-- The amounts computed from the discount (and the one view that reads them) are rebuilt around the change.
do $$
declare v_def text;
begin
  if (select numeric_scale from information_schema.columns where table_schema = 'public' and table_name = 'pos_order_lines' and column_name = 'discount_pct') = 4 then return; end if;
  v_def := pg_get_viewdef('public.v_sales_book'::regclass);
  drop view public.v_sales_book;
  alter table public.pos_order_lines drop column line_total, drop column line_subtotal, drop column tax_amount;
  alter table public.pos_order_lines alter column discount_pct type numeric(9,4);
  alter table public.pos_order_lines
    add column line_total numeric(18,2) generated always as (round(quantity * unit_price * (1 - discount_pct / 100), 2)) stored,
    add column line_subtotal numeric(18,2) generated always as (round(round(quantity * unit_price * (1 - discount_pct / 100), 2) / (1 + tax_rate / 100), 2)) stored,
    add column tax_amount numeric(18,2) generated always as (round(quantity * unit_price * (1 - discount_pct / 100), 2)
                                                            - round(round(quantity * unit_price * (1 - discount_pct / 100), 2) / (1 + tax_rate / 100), 2)) stored;
  execute 'create view public.v_sales_book with (security_invoker = true) as ' || v_def;
  grant select on public.v_sales_book to authenticated;
end $$;

-- the share off a promotion gives on one line (the price with VAT, the quantity)
create or replace function app.promo_pct(k public.promotions, p_price numeric, p_qty numeric)
returns numeric language sql immutable set search_path = '' as $$
  select case
    when abs(p_qty) < k.min_qty then 0
    when k.kind = 'percent' then k.value
    when k.kind = 'fixed_price' then case when p_price > 0 and k.value < p_price then round((1 - k.value / p_price) * 100, 4) else 0 end
    else case when abs(p_qty) >= k.buy_qty + k.get_qty
              then round(floor(abs(p_qty) / (k.buy_qty + k.get_qty)) * k.get_qty / abs(p_qty) * 100, 4) else 0 end end
$$;

-- does a promotion cover this item, here and now
create or replace function app.promo_applies(k public.promotions, p_variant uuid, p_warehouse uuid, p_at timestamptz, p_channel text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_local timestamp; v_cat uuid;
begin
  if not k.is_active or k.deleted_at is not null or not (p_channel = any (k.channels)) then return false; end if;
  select (p_at at time zone coalesce(c.timezone, 'Europe/Tirane')) into v_local from public.companies c where c.id = k.company_id;
  if k.starts_on is not null and v_local::date < k.starts_on then return false; end if;
  if k.ends_on is not null and v_local::date > k.ends_on then return false; end if;
  if k.weekdays is not null and not (extract(isodow from v_local)::int = any (k.weekdays)) then return false; end if;
  if k.time_from is not null and v_local::time < k.time_from then return false; end if;
  if k.time_to is not null and v_local::time > k.time_to then return false; end if;
  if k.warehouse_ids is not null and p_warehouse is not null and not (p_warehouse = any (k.warehouse_ids)) then return false; end if;
  if cardinality(k.variant_ids) = 0 and cardinality(k.category_ids) = 0 then return true; end if;
  if p_variant = any (k.variant_ids) then return true; end if;
  select p.category_id into v_cat from public.product_variants v join public.products p on p.id = v.product_id where v.id = p_variant;
  return v_cat = any (k.category_ids);
end $$;

-- the best promotion for a line: {id, name, pct}
create or replace function app.promo_best(p_company uuid, p_warehouse uuid, p_variant uuid, p_qty numeric, p_price numeric, p_at timestamptz, p_channel text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', k.id, 'name', k.name, 'pct', app.promo_pct(k, p_price, p_qty))
    from public.promotions k
   where k.company_id = p_company and k.deleted_at is null and k.is_active and app.promo_applies(k, p_variant, p_warehouse, p_at, p_channel)
     and app.promo_pct(k, p_price, p_qty) > 0
   order by app.promo_pct(k, p_price, p_qty) desc limit 1
$$;

-- the till takes the promotions with it (it works offline)
create or replace function public.pos_promotions(p_register uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.pos_registers;
begin
  select * into r from public.pos_registers where id = p_register;
  if r.id is null then raise exception 'Register not found' using errcode = 'P0002'; end if;
  perform app.require_permission(r.company_id, 'pos.read');
  return coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name, 'kind', k.kind, 'value', k.value, 'buy_qty', k.buy_qty, 'get_qty', k.get_qty,
            'min_qty', k.min_qty, 'all_items', cardinality(k.variant_ids) = 0 and cardinality(k.category_ids) = 0,
            -- the till has no categories by id: the items of the categories come spelled out
            'variant_ids', array(select unnest(k.variant_ids) union select v.id from public.product_variants v join public.products p on p.id = v.product_id
                                  where p.category_id = any (k.category_ids) and v.deleted_at is null),
            'starts_on', k.starts_on, 'ends_on', k.ends_on,
            'weekdays', k.weekdays, 'time_from', k.time_from, 'time_to', k.time_to))
     from public.promotions k
    where k.company_id = r.company_id and k.deleted_at is null and k.is_active and 'pos' = any (k.channels)
      and (k.ends_on is null or k.ends_on >= current_date - 1)
      and (k.warehouse_ids is null or r.warehouse_id = any (k.warehouse_ids))), '[]'::jsonb);
end $$;

-- a receipt line with a promotion: the server checks it gives no more than the promotion
do $$ begin
  if position('promotion_id' in pg_get_functiondef('public.pos_submit_order'::regproc)) = 0 then
    perform app._patch_function('public.pos_submit_order',
      $o$    if v_allowed is null and coalesce((l->>'discount_pct')::numeric, 0) > v_max_disc and not app.has_permission(s.company_id, 'pos.approve') then$o$,
      $n$    if v_allowed is null and not v_refund and nullif(l->>'promotion_id', '') is not null then
      select app.promo_pct(k, (l->>'unit_price')::numeric, (l->>'quantity')::numeric) into v_allowed from public.promotions k
       where k.id = (l->>'promotion_id')::uuid and k.company_id = s.company_id
         and app.promo_applies(k, (l->>'variant_id')::uuid, r.warehouse_id, v_order_at, 'pos');
      if v_allowed is null and v_offline then
        -- sold offline under a promotion that ended or changed since: keep the sale as it was
        select app.promo_pct(k, (l->>'unit_price')::numeric, (l->>'quantity')::numeric) into v_allowed from public.promotions k where k.id = (l->>'promotion_id')::uuid;
      end if;
      if coalesce((l->>'discount_pct')::numeric, 0) > coalesce(v_allowed, 0) + 0.01 then
        raise exception 'Line %: the promotion gives % %%, not %', n, coalesce(v_allowed, 0), l->>'discount_pct' using errcode = '42501';
      end if;
    end if;
    if v_allowed is null and coalesce((l->>'discount_pct')::numeric, 0) > v_max_disc and not app.has_permission(s.company_id, 'pos.approve') then$n$);
    perform app._patch_function('public.pos_submit_order',
      $o$                                        unit_price, discount_pct, tax_code_id)
    select s.company_id, v_id, n, v.id, nullif(l->>'lot_id', '')::uuid, l->>'barcode', coalesce(nullif(l->>'description', ''), v.name),
           (l->>'quantity')::numeric, (l->>'unit_price')::numeric, coalesce((l->>'discount_pct')::numeric, 0), p.sales_tax_code_id$o$,
      $n$                                        unit_price, discount_pct, tax_code_id, promotion_id)
    select s.company_id, v_id, n, v.id, nullif(l->>'lot_id', '')::uuid, l->>'barcode', coalesce(nullif(l->>'description', ''), v.name),
           (l->>'quantity')::numeric, (l->>'unit_price')::numeric, coalesce((l->>'discount_pct')::numeric, 0), p.sales_tax_code_id,
           nullif(l->>'promotion_id', '')::uuid$n$);
  end if;
  -- sales documents: a promotion of the sales channel when it gives more than the customer's discount
  if position('promo_best' in pg_get_functiondef('public.get_price'::regproc)) = 0 then
    perform app._patch_function('public.get_price',
      $o$v_price numeric; v_disc numeric; v_src text; v_pl uuid;$o$,
      $n$v_price numeric; v_disc numeric; v_src text; v_pl uuid; v_promo jsonb;$n$);
    perform app._patch_function('public.get_price',
      $o$  return query select v_price, v_disc, v_src, v_pl, v_tax;$o$,
      $n$  v_promo := app.promo_best(p_company, null, p_variant, p_quantity, round(v_price * (1 + v_tax_rate / 100), 4), p_date::timestamptz + interval '12 hours', 'sales');
  if v_promo is not null and (v_promo ->> 'pct')::numeric > coalesce(v_disc, 0) then
    v_disc := round((v_promo ->> 'pct')::numeric, 2); v_src := 'promotion';
  end if;
  return query select v_price, v_disc, v_src, v_pl, v_tax;$n$);
  end if;
end $$;

-- how a promotion did: receipts, pieces, the discount given, the takings
create or replace function public.promotion_results(p_company uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'sales.read');
  return coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name, 'receipts', x.receipts, 'qty', x.qty, 'discount', x.discount, 'sales', x.sales) order by x.sales desc)
     from (select ol.promotion_id, count(distinct ol.pos_order_id) receipts, sum(ol.quantity) qty,
                  sum(round(ol.quantity * ol.unit_price * ol.discount_pct / 100, 2)) discount, sum(round(ol.quantity * ol.unit_price * (1 - ol.discount_pct / 100), 2)) sales
             from public.pos_order_lines ol join public.pos_orders o on o.id = ol.pos_order_id
            where ol.company_id = p_company and ol.promotion_id is not null and o.status = 'paid' and o.order_at::date between p_from and p_to
            group by 1) x join public.promotions k on k.id = x.promotion_id), '[]'::jsonb);
end $$;

-- the premiums are set with the other payroll settings
do $$ begin
  if position('payroll_night_pct' in pg_get_functiondef('public.automation_settings_save'::regproc)) = 0 then
    perform app._patch_function('public.automation_settings_save',
      $o$'payroll_deduct_absence'] then$o$, $n$'payroll_deduct_absence', 'payroll_night_pct', 'payroll_holiday_pct'] then$n$);
    perform app._patch_function('public.automation_settings_save',
      $o$payroll_deduct_absence = coalesce((p_patch ->> 'payroll_deduct_absence')::boolean, payroll_deduct_absence)$o$,
      $n$payroll_deduct_absence = coalesce((p_patch ->> 'payroll_deduct_absence')::boolean, payroll_deduct_absence),
    payroll_night_pct = case when p_patch ? 'payroll_night_pct' then nullif(p_patch ->> 'payroll_night_pct', '')::numeric else payroll_night_pct end,
    payroll_holiday_pct = case when p_patch ? 'payroll_holiday_pct' then nullif(p_patch ->> 'payroll_holiday_pct', '')::numeric else payroll_holiday_pct end$n$);
  end if;
end $$;

revoke execute on function public.employee_deductions_list(uuid), public.employee_advance_pay(jsonb), public.pos_promotions(uuid),
  public.promotion_results(uuid, date, date) from public, anon;
grant execute on function public.employee_deductions_list(uuid), public.employee_advance_pay(jsonb), public.pos_promotions(uuid),
  public.promotion_results(uuid, date, date) to authenticated;

drop function app._patch_function(text, text, text);
