-- =============================================================================
-- DrisPRO · appointments, client cards, memberships (runs after 01–37)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

set role authenticated;
select t.login('zoe@platform.io');
select public.platform_create_client(jsonb_build_object('name', 'Sallon Test', 'country', 'XK', 'owner_email', 'alice@alba.al', 'plan', 'pro', 'max_users', 10,
  'business_type', 'beauty', 'valid_until', (current_date + 365)::text)) as co \gset
select public.platform_create_client(jsonb_build_object('name', 'Market Test 38', 'country', 'XK', 'owner_email', 'alice@alba.al', 'business_type', 'retail')) as mk \gset
select t.login('alice@alba.al');
select t.ok(not ('Appointments' = any (select unnest(hidden_menu_sections) from public.company_settings where company_id = :'co'))
        and ('Appointments' = any (select unnest(hidden_menu_sections) from public.company_settings where company_id = :'mk')),
  'a salon sees appointments; a market does not');

-- setup
insert into public.appt_resources (company_id, name, hours) values (:'co', 'Arta', '{"1":[["08:00","20:00"]],"2":[["08:00","20:00"]],"3":[["08:00","20:00"]],"4":[["08:00","20:00"]],"5":[["08:00","20:00"]],"6":[["08:00","20:00"]],"7":[["08:00","20:00"]]}')
  returning id as arta \gset
insert into public.appt_services (company_id, name, duration_min, price) values (:'co', 'Prerje flokësh', 45, 15) returning id as cut \gset
insert into public.client_cards (company_id, kind, title, attrs) values (:'co', 'client', 'Blerta Krasniqi', '{"color":"6.1"}') returning id as card \gset

-- book
select (current_date + 1 + time '10:00')::timestamp at time zone 'Europe/Tirane' as t10 \gset
select public.appt_save(jsonb_build_object('company_id', :'co', 'resource_id', :'arta', 'service_id', :'cut', 'starts_at', :'t10', 'client_name', 'Blerta Krasniqi',
  'client_phone', '044111222', 'card_id', :'card')) as a1 \gset
select t.ok((select ends_at - starts_at = interval '45 minutes' and price = 15 and number like 'TER-%' from public.appointments where id = :'a1'), 'the service gives the length and the price');
select t.throws(format($q$select public.appt_save(jsonb_build_object('company_id', %L, 'resource_id', %L, 'service_id', %L, 'starts_at', %L::timestamptz + interval '30 minutes', 'client_name', 'Tjetër'))$q$,
  :'co', :'arta', :'cut', :'t10'), 'already taken', 'the same person cannot take two clients at once');
select t.ok(not exists (select 1 from jsonb_array_elements(public.appt_slots(:'co', :'cut', current_date + 1)) x
                          where (x ->> 'starts_at')::timestamptz < :'t10'::timestamptz + interval '45 minutes' and (x ->> 'ends_at')::timestamptz > :'t10'::timestamptz),
  'free times leave out what is booked');
select t.ok(jsonb_array_length(public.appt_board(:'co', current_date + 1, current_date + 1) -> 'appointments') = 1, 'the day shows the appointment');
select public.appt_set_status(:'a1', 'arrived');
select public.appt_invoice(:'a1') as inv \gset
select t.ok((select status = 'done' and invoice_id = :'inv' and partner_id is not null from public.appointments where id = :'a1')
        and (select total = 15 from public.sales_invoices where id = :'inv'), 'done: an invoice at the service''s price, and the client is on file');
select t.ok(exists (select 1 from public.card_entries where card_id = :'card' and appointment_id = :'a1' and invoice_id = :'inv'), 'the visit is written in the client''s card');

-- memberships
insert into public.membership_plans (company_id, name, months, price) values (:'co', 'Mujore', 1, 25) returning id as monthly \gset
insert into public.membership_plans (company_id, name, months, visits, price) values (:'co', '10 hyrje', 3, 10, 40) returning id as ten \gset
select public.membership_sell(jsonb_build_object('company_id', :'co', 'plan_id', :'ten', 'client_name', 'Dritan Berisha', 'client_phone', '049222333')) as ms \gset
select t.ok((select ends_on = starts_on + interval '3 months' - interval '1 day' and visits = 10 from public.memberships where id = (:'ms'::jsonb ->> 'id')::uuid)
        and (select total = 40 from public.sales_invoices where id = (:'ms'::jsonb ->> 'invoice_id')::uuid), 'a membership is sold with its invoice');
select public.membership_check_in(:'co', :'ms'::jsonb ->> 'code') as ci \gset
select t.ok((:'ci'::jsonb ->> 'ok')::boolean and (:'ci'::jsonb ->> 'visits_used')::int = 1, 'at the door the card lets them in and counts the visit');
select public.membership_check_in(:'co', '049222333') as ci2 \gset
select t.ok((:'ci2'::jsonb ->> 'again_today')::boolean and (:'ci2'::jsonb ->> 'visits_used')::int = 1, 'the phone number works too; twice a day counts once');
select t.ok((public.membership_check_in(:'co', 'nobody') ->> 'reason') = 'unknown', 'an unknown card is refused');
select public.membership_freeze((:'ms'::jsonb ->> 'id')::uuid, true);
select t.ok((public.membership_check_in(:'co', :'ms'::jsonb ->> 'code') ->> 'reason') = 'frozen', 'a frozen membership is refused at the door');
select public.membership_freeze((:'ms'::jsonb ->> 'id')::uuid, false);
select public.membership_sell(jsonb_build_object('company_id', :'co', 'plan_id', :'monthly', 'partner_id', (select partner_id from public.memberships where id = (:'ms'::jsonb ->> 'id')::uuid))) as ms2 \gset
select t.ok((:'ms2'::jsonb ->> 'starts_on')::date = (select ends_on + 1 from public.memberships where id = (:'ms'::jsonb ->> 'id')::uuid)
        and (:'ms2'::jsonb ->> 'code') = (:'ms'::jsonb ->> 'code'), 'a renewal starts the day after and keeps the card');
reset role;
update public.memberships set ends_on = current_date - 1, starts_on = current_date - 30 where id = (:'ms2'::jsonb ->> 'id')::uuid;
update public.memberships set ends_on = current_date - 2, starts_on = current_date - 60 where id = (:'ms'::jsonb ->> 'id')::uuid;
select app.memberships_daily();
set role authenticated;
select t.login('alice@alba.al');
select t.ok((public.membership_check_in(:'co', :'ms'::jsonb ->> 'code') ->> 'reason') = 'expired', 'an expired membership is refused');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
