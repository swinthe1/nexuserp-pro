-- =============================================================================
-- DrisPRO · Sefi, phase 3
--   · legal limits for cash: a cash payment to or from a business above the business limit, or
--     with an individual above the individual limit, in one day (split payments add up), is
--     reported, or refused when the company chooses so.
--       Kosovo: business 500 € (the 300 € limit has been announced, not yet in force),
--               individuals 2,000 € (Decision 19/2026, from 1 June 2026)
--       Albania: business 150,000 lekë
--   · differences by person: tills, safe counts and handovers
--   · the assistant answers about the safes
-- =============================================================================

alter table public.company_settings
  add column cash_limit_business   numeric(18,2) check (cash_limit_business > 0),
  add column cash_limit_individual numeric(18,2) check (cash_limit_individual > 0),
  add column cash_limit_block      boolean not null default false;

create or replace function app.cash_limit_defaults(p_country text, out business numeric, out individual numeric)
language sql immutable as $$
  select case upper(p_country) when 'XK' then 500 when 'AL' then 150000 end::numeric,
         case upper(p_country) when 'XK' then 2000 end::numeric
$$;

update public.company_settings s
   set cash_limit_business = d.business, cash_limit_individual = d.individual
  from public.companies c, app.cash_limit_defaults(c.country_code) d
 where c.id = s.company_id;

create or replace function app.tg_settings_cash_limits()
returns trigger language plpgsql security definer set search_path = '' as $$
declare d record;
begin
  select * into d from app.cash_limit_defaults((select country_code from public.companies where id = new.company_id));
  new.cash_limit_business := coalesce(new.cash_limit_business, d.business);
  new.cash_limit_individual := coalesce(new.cash_limit_individual, d.individual);
  return new;
end $$;
create trigger trg_05_cash_limits before insert on public.company_settings
  for each row execute function app.tg_settings_cash_limits();

-- cash with this partner on that day, this amount included: {kind, limit, total, over, block}
create or replace function app.cash_limit_check(p_company uuid, p_partner uuid, p_amount_base numeric, p_date date, p_exclude uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s public.company_settings; v_kind text; v_limit numeric; v_total numeric;
begin
  select * into s from public.company_settings where company_id = p_company;
  select kind into v_kind from public.business_partners where id = p_partner and company_id = p_company;
  if v_kind is null then return null; end if;
  v_limit := case when v_kind = 'individual' then s.cash_limit_individual else s.cash_limit_business end;
  if v_limit is null then return null; end if;
  select coalesce(sum(p.amount_base), 0) + coalesce(p_amount_base, 0) into v_total
    from public.payments p join public.bank_accounts b on b.id = p.bank_account_id
   where p.company_id = p_company and p.partner_id = p_partner and p.payment_date = p_date and p.status = 'posted'
     and (b.account_kind = 'cash' or p.method = 'cash') and p.id is distinct from p_exclude;
  return jsonb_build_object('kind', v_kind, 'limit', v_limit, 'total', v_total, 'over', v_total > v_limit, 'block', s.cash_limit_block);
end $$;
revoke execute on function app.cash_limit_check(uuid, uuid, numeric, date, uuid) from public, anon, authenticated;

-- for the payment screen, before saving
create or replace function public.cash_limit_preview(p_company uuid, p_partner uuid, p_amount numeric, p_date date, p_bank uuid, p_method text,
                                                     p_exclude uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare b public.bank_accounts; v_base text; v_rate numeric := 1;
begin
  perform app.require_permission(p_company, 'invoicing.read');
  select * into b from public.bank_accounts where id = p_bank and company_id = p_company;
  if p_partner is null or coalesce(p_amount, 0) <= 0 or (coalesce(b.account_kind, '') <> 'cash' and coalesce(p_method, '') <> 'cash') then return null; end if;
  select base_currency into v_base from public.companies where id = p_company;
  if b.currency_code is distinct from v_base then
    select x.rate into v_rate from public.exchange_rates x where x.company_id = p_company and x.currency_code = b.currency_code and x.rate_date <= p_date
     order by x.rate_date desc limit 1;
  end if;
  return app.cash_limit_check(p_company, p_partner, round(p_amount * coalesce(v_rate, 1), 2), p_date, p_exclude);
end $$;
revoke execute on function public.cash_limit_preview(uuid, uuid, numeric, date, uuid, text, uuid) from public, anon;
grant execute on function public.cash_limit_preview(uuid, uuid, numeric, date, uuid, text, uuid) to authenticated;

create or replace function public.cash_limits_save(p_company uuid, p_business numeric, p_individual numeric, p_block boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'finance.write');
  update public.company_settings set cash_limit_business = nullif(p_business, 0), cash_limit_individual = nullif(p_individual, 0),
         cash_limit_block = coalesce(p_block, false)
   where company_id = p_company;
end $$;
revoke execute on function public.cash_limits_save(uuid, numeric, numeric, boolean) from public, anon;
grant execute on function public.cash_limits_save(uuid, numeric, numeric, boolean) to authenticated;

create or replace function public.cash_limits(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'finance.read');
  return (select jsonb_build_object('business', s.cash_limit_business, 'individual', s.cash_limit_individual, 'block', s.cash_limit_block,
                                    'country', c.country_code, 'currency', c.base_currency,
                                    'defaults', (select to_jsonb(d) from app.cash_limit_defaults(c.country_code) d))
            from public.company_settings s join public.companies c on c.id = s.company_id where s.company_id = p_company);
end $$;
revoke execute on function public.cash_limits(uuid) from public, anon;
grant execute on function public.cash_limits(uuid) to authenticated;

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;

select app._patch_function('public.post_payment',
  $x$declare p public.payments; a record; v_open numeric; v_je uuid; v_period text;$x$,
  $x$declare p public.payments; a record; v_open numeric; v_je uuid; v_period text; v_lim jsonb; v_cur text;$x$);
select app._patch_function('public.post_payment',
  $x$    raise exception 'The bank account is inactive' using errcode = '23514';
  end if;$x$,
  $x$    raise exception 'The bank account is inactive' using errcode = '23514';
  end if;
  -- the law's limit for cash (split payments on the same day add up)
  if exists (select 1 from public.bank_accounts where id = p.bank_account_id and account_kind = 'cash') or p.method = 'cash' then
    v_lim := app.cash_limit_check(p.company_id, p.partner_id, p.amount_base, p.payment_date, p.id);
    if coalesce((v_lim ->> 'over')::boolean, false) then
      select base_currency into v_cur from public.companies where id = p.company_id;
      if (v_lim ->> 'block')::boolean then
        raise exception 'Cash with % is limited by law to % a day; with this payment it would be %. Pay through the bank.',
          (select name from public.business_partners where id = p.partner_id),
          to_char((v_lim ->> 'limit')::numeric, 'FM999G999G990D00') || ' ' || coalesce(v_cur, ''),
          to_char((v_lim ->> 'total')::numeric, 'FM999G999G990D00') || ' ' || coalesce(v_cur, '') using errcode = '23514';
      end if;
      perform app.notify_permission(p.company_id, 'finance.approve', 'warning',
        'Cash above the legal limit: ' || (select name from public.business_partners where id = p.partner_id),
        p.number || ' · ' || to_char((v_lim ->> 'total')::numeric, 'FM999G999G990D00') || ' ' || coalesce(v_cur, '') || ' in one day, the limit is '
          || to_char((v_lim ->> 'limit')::numeric, 'FM999G999G990D00'), '/finance/payments/' || p.id);
    end if;
  end if;$x$);

-- ---------------------------------------------------------------------------
-- differences by person
-- ---------------------------------------------------------------------------
create or replace function public.safe_differences(p_company uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_tz text;
begin
  perform app.require_safe(p_company, 'see');
  select coalesce(timezone, 'Europe/Belgrade') into v_tz from public.companies where id = p_company;
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', y.uid, 'name', app.person_name(y.uid),
             'shifts', y.shifts, 'shift_diff', y.shift_diff, 'shift_short', y.shift_short,
             'counts', y.counts, 'count_diff', y.count_diff, 'handovers_off', y.ho_off,
             'total', y.shift_diff + y.count_diff) order by y.shift_short + least(y.count_diff, 0), app.person_name(y.uid))
    from (select x.uid, sum(x.shifts) as shifts, sum(x.shift_diff) as shift_diff, sum(x.shift_short) as shift_short,
                 sum(x.counts) as counts, sum(x.count_diff) as count_diff, sum(x.ho_off) as ho_off
    from (
      select ps.opened_by as uid, count(*) as shifts, coalesce(sum(ps.cash_difference), 0) as shift_diff,
             coalesce(sum(least(ps.cash_difference, 0)), 0) as shift_short, 0 as counts, 0::numeric as count_diff, 0 as ho_off
        from public.pos_sessions ps
       where ps.company_id = p_company and ps.status = 'closed' and ps.deleted_at is null
         and (ps.closed_at at time zone v_tz)::date between p_from and p_to
       group by ps.opened_by
      union all
      select c.counted_by, 0, 0, 0, count(*), coalesce(sum(c.difference), 0), 0
        from public.safe_counts c
       where c.company_id = p_company and c.counted_on between p_from and p_to
       group by c.counted_by
      union all
      select h.to_user, 0, 0, 0, 0, 0, count(*)
        from public.safe_handovers h
       where h.company_id = p_company and h.status = 'accepted' and h.taken_total <> h.given_total
         and (h.decided_at at time zone v_tz)::date between p_from and p_to
       group by h.to_user
    ) x group by x.uid) y), '[]'::jsonb);
end $$;
revoke execute on function public.safe_differences(uuid, date, date) from public, anon;
grant execute on function public.safe_differences(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- the assistant: "how much is in the safe?", "who counted it?", "what is on its way to the bank?"
-- ---------------------------------------------------------------------------
create or replace function public.ai_safes(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare o jsonb; v_today date;
begin
  o := public.safes_overview(p_company);   -- checks who may see the safes
  v_today := app.safe_today(p_company);
  return jsonb_build_object(
    'currency', o -> 'currency',
    'safes', (select coalesce(jsonb_agg(s - 'tills' - 'warehouse_id' - 'holder_id' - 'account_code'), '[]'::jsonb) from jsonb_array_elements(o -> 'safes') s),
    'total', (select coalesce(sum((s ->> 'balance')::numeric), 0) from jsonb_array_elements(o -> 'safes') s),
    'waiting_for_approval', o -> 'waiting', 'on_the_way_to_bank', o -> 'on_the_way', 'being_handed_over', o -> 'handovers',
    'recent_movements', coalesce((select jsonb_agg(jsonb_build_object('number', m.number, 'kind', m.kind, 'status', m.status, 'amount', m.amount, 'reason', m.reason,
                                    'on', m.moved_on, 'safe', (select name from public.safes where id = m.safe_id), 'by', app.person_name(m.requested_by)) order by m.created_at desc)
                                   from (select * from public.safe_movements where company_id = p_company order by created_at desc limit 15) m), '[]'::jsonb),
    'differences_this_month', public.safe_differences(p_company, date_trunc('month', v_today)::date, v_today),
    'href', '/safe');
end $$;
revoke execute on function public.ai_safes(uuid) from public, anon;
grant execute on function public.ai_safes(uuid) to authenticated;

select app._patch_function('public.assistant_tool',
  $x$      when 'report'          then public.run_report(j.company_id, i ->> 'report', i - 'report')$x$,
  $x$      when 'report'          then public.run_report(j.company_id, i ->> 'report', i - 'report')
      when 'safes'           then public.ai_safes(j.company_id)$x$);
select app._patch_function('public.assistant_tool',
  $x$'low_stock', 'day_summary', 'report')$x$,
  $x$'low_stock', 'day_summary', 'report', 'safes')$x$);

drop function app._patch_function(text, text, text);
