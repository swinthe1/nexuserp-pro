-- =============================================================================
-- DrisPRO · public holidays for every year, not only 2026 (audit, wave 1)
--   * the holidays of a year are worked out: fixed dates, both Easters (computed) and the two
--     Bajrams (from a short table, since they follow the moon and are announced each year)
--   * a holiday on a weekend moves: in Albania to the next free working day, in Kosovo to Monday
--   * every company gets the current and the next year now; in December the daily run adds the
--     year after and leaves HR a task to check the dates (and to add the Bajrams if not known yet)
--   * nothing a company entered or deleted by hand is touched: dates already there are skipped
-- =============================================================================

create table if not exists app.holiday_moon_dates (
  country_code char(2) not null check (country_code in ('AL', 'XK')),
  year         int not null,
  kind         text not null check (kind in ('eid_fitr', 'eid_adha')),
  holiday_date date not null,
  primary key (country_code, year, kind)
);
insert into app.holiday_moon_dates values
  ('AL', 2026, 'eid_fitr', '2026-03-20'), ('AL', 2026, 'eid_adha', '2026-05-27'),
  ('XK', 2026, 'eid_fitr', '2026-03-20'), ('XK', 2026, 'eid_adha', '2026-05-28'),
  ('AL', 2027, 'eid_fitr', '2027-03-09'), ('AL', 2027, 'eid_adha', '2027-05-16'),
  ('XK', 2027, 'eid_fitr', '2027-03-09'), ('XK', 2027, 'eid_adha', '2027-05-16')
on conflict do nothing;

-- Gregorian Easter Sunday (anonymous algorithm)
create or replace function app.easter_western(y int) returns date language plpgsql immutable set search_path = '' as $$
declare a int; b int; c int; d int; e int; f int; g int; h int; i int; k int; l int; m int; n int;
begin
  a := y % 19; b := y / 100; c := y % 100; d := b / 4; e := b % 4; f := (b + 8) / 25; g := (b - f + 1) / 3;
  h := (19 * a + b - d - g + 15) % 30; i := c / 4; k := c % 4; l := (32 + 2 * e + 2 * i - h - k) % 7;
  m := (a + 11 * h + 22 * l) / 451; n := h + l - 7 * m + 114;
  return make_date(y, n / 31, n % 31 + 1);
end $$;

-- Orthodox Easter Sunday: Julian computus, shown in the Gregorian calendar (+13 days, right for 1900–2099)
create or replace function app.easter_orthodox(y int) returns date language plpgsql immutable set search_path = '' as $$
declare d int; e int; n int;
begin
  d := (19 * (y % 19) + 15) % 30; e := (2 * (y % 4) + 4 * (y % 7) - d + 34) % 7; n := d + e + 114;
  return make_date(y, n / 31, n % 31 + 1) + 13;
end $$;

-- The days off of one year in one country: (date, name), weekdays only
create or replace function app.holiday_list(p_country text, p_year int)
returns table (holiday_date date, name text) language plpgsql volatile security definer set search_path = '' as $$
declare
  ce date := app.easter_western(p_year); oe date := app.easter_orthodox(p_year);
  base record; taken date[] := '{}'; v_day date;
begin
  if to_regclass('pg_temp._hol') is null then create temp table _hol (d date, n text, o int) on commit drop; end if;
  truncate pg_temp._hol;
  if p_country = 'AL' then
    insert into pg_temp._hol values
      (make_date(p_year, 1, 1), 'New Year''s Day', 1), (make_date(p_year, 1, 2), 'New Year''s Day', 2),
      (make_date(p_year, 3, 14), 'Summer Day', 3), (make_date(p_year, 3, 22), 'Nevruz Day', 4),
      (ce, 'Catholic Easter', 5), (oe, 'Orthodox Easter', 6), (make_date(p_year, 5, 1), 'Labour Day', 7),
      (make_date(p_year, 9, 5), 'Mother Teresa Day', 8), (make_date(p_year, 11, 22), 'Alphabet Day', 9),
      (make_date(p_year, 11, 28), 'Independence Day', 10), (make_date(p_year, 11, 29), 'Liberation Day', 11),
      (make_date(p_year, 12, 8), 'National Youth Day', 12), (make_date(p_year, 12, 25), 'Christmas Day', 13);
  elsif p_country = 'XK' then
    insert into pg_temp._hol values
      (make_date(p_year, 1, 1), 'New Year''s Day', 1), (make_date(p_year, 1, 2), 'New Year''s Day', 2),
      (make_date(p_year, 1, 7), 'Orthodox Christmas', 3), (make_date(p_year, 2, 17), 'Independence Day', 4),
      (ce + 1, 'Catholic Easter Monday', 5), (make_date(p_year, 4, 9), 'Constitution Day', 6),
      (oe + 1, 'Orthodox Easter Monday', 7), (make_date(p_year, 5, 1), 'Labour Day', 8),
      (make_date(p_year, 5, 9), 'Europe Day', 9), (make_date(p_year, 12, 25), 'Christmas Day', 10);
  else
    return;
  end if;
  insert into pg_temp._hol select m.holiday_date, case m.kind when 'eid_fitr' then 'Eid al-Fitr' else 'Eid al-Adha' end, 20
    from app.holiday_moon_dates m where m.country_code = p_country and m.year = p_year;

  -- holidays on weekdays stand as they are
  select coalesce(array_agg(distinct d), '{}') into taken from pg_temp._hol where extract(isodow from d) < 6;
  for base in select distinct on (d) d, n from pg_temp._hol where extract(isodow from d) < 6 order by d, o loop
    holiday_date := base.d; name := base.n; return next;
  end loop;

  -- holidays on a weekend move: Albania to the next free working day, Kosovo to the Monday after
  for base in select d, n from pg_temp._hol where extract(isodow from d) >= 6 order by d, o loop
    v_day := base.d + (8 - extract(isodow from base.d)::int);   -- the Monday after
    if p_country = 'AL' then
      while v_day = any (taken) or extract(isodow from v_day) >= 6 loop v_day := v_day + 1; end loop;
    elsif v_day = any (taken) then
      continue;                                                 -- Kosovo: that Monday is already a day off
    end if;
    taken := taken || v_day;
    holiday_date := v_day; name := base.n || ' (observed)'; return next;
  end loop;
end $$;

-- A company's holidays for one year (or, without a year, this year and the next)
drop function if exists app.seed_holidays(uuid);
create or replace function app.seed_holidays(p_company uuid, p_year int default null)
returns int language plpgsql security definer set search_path = '' as $$
declare v_country text; v_tz text; v_year int; y int; n int := 0; k int;
begin
  select country_code, coalesce(timezone, 'Europe/Tirane') into v_country, v_tz from public.companies where id = p_company;
  if v_country is null then return 0; end if;
  v_year := extract(year from now() at time zone v_tz)::int;
  for y in select g from generate_series(coalesce(p_year, v_year), coalesce(p_year, v_year + 1)) g loop
    -- a year the company already has (entered or corrected by hand) is left alone
    if exists (select 1 from public.public_holidays h where h.company_id = p_company
                 and h.holiday_date between make_date(y, 1, 1) and make_date(y, 12, 31)) then continue; end if;
    insert into public.public_holidays (company_id, holiday_date, name)
    select p_company, l.holiday_date, l.name from app.holiday_list(v_country, y) l
    on conflict (company_id, holiday_date) do nothing;
    get diagnostics k = row_count; n := n + k;
  end loop;
  return n;
end $$;
create or replace function app.tg_company_holidays()
returns trigger language plpgsql security definer set search_path = '' as $$
begin perform app.seed_holidays(new.id); return null; end $$;
revoke all on function app.seed_holidays(uuid, int), app.holiday_list(text, int) from public, anon, authenticated;

select app.seed_holidays(id) from public.companies where deleted_at is null;

-- In December: next year's holidays, and a task for HR to check them against the official calendar
create or replace function app.holidays_next_year(p_company uuid, p_today date)
returns int language plpgsql security definer set search_path = '' as $$
declare v_year int := extract(year from p_today)::int + 1; v_country text; v_who uuid; v_moon int; n int;
begin
  if extract(month from p_today) <> 12 then return 0; end if;
  select country_code into v_country from public.companies where id = p_company;
  if v_country not in ('AL', 'XK') then return 0; end if;
  n := app.seed_holidays(p_company, v_year);
  select count(*) into v_moon from app.holiday_moon_dates where country_code = v_country and year = v_year;
  v_who := app.first_with_role(p_company, array['hr_manager', 'company_admin']);
  perform app.auto_task(p_company, 'holidays:' || v_year, 'Kontrollo festat zyrtare të vitit ' || v_year, v_who, p_today + 7, 2::smallint,
    null, null, null,
    'Programi i shtoi festat e vitit ' || v_year || ' te Punonjësit › Cilësimet › Festat zyrtare. Krahasoji me kalendarin zyrtar'
    || case when v_moon < 2 then ' dhe shto datat e Fitër Bajramit dhe të Kurban Bajramit sapo të shpallen.' else '.' end);
  return n;
end $$;
revoke all on function app.holidays_next_year(uuid, date) from public, anon, authenticated;

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_def text; v_oid oid;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname || '.' || p.proname = p_name order by p.oid desc limit 1;
  if v_oid is null then raise exception 'function % not found', p_name; end if;
  v_def := pg_get_functiondef(v_oid);
  if position(p_new in v_def) > 0 then return; end if;
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply', p_name; end if;
  execute replace(v_def, p_old, p_new);
end $$;
select app._patch_function('app.automations_daily',
  $x$  perform app.automations_daily_more(p_company);$x$,
  $x$  perform app.automations_daily_more(p_company);
  begin perform app.holidays_next_year(p_company, v_today);
  exception when others then raise warning 'holidays (%): %', p_company, sqlerrm; end;$x$);
drop function app._patch_function(text, text, text);
