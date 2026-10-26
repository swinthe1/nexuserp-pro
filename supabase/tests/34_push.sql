-- =============================================================================
-- DrisPRO · notifications on the phone, the morning summary (runs after 01–33)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

set role authenticated;
select t.login('zoe@platform.io');
select public.platform_create_client(jsonb_build_object('name', 'Push Test', 'country', 'XK', 'owner_email', 'alice@alba.al', 'plan', 'pro', 'max_users', 10,
  'valid_until', (current_date + 365)::text)) as co \gset
select t.login('alice@alba.al');
select auth.uid() as me \gset
select t.ok(public.push_public_key() is null, 'no key until the postier makes one');
select t.throws($q$select public.push_subscribe('http://x', 'a', 'b')$q$, 'no usable address', 'only real push addresses are kept');
select public.push_subscribe('https://fcm.googleapis.com/fcm/send/abc', 'BPk', 'au', 'Android · Chrome') as sub \gset
select t.ok(public.push_subscribe('https://fcm.googleapis.com/fcm/send/abc', 'BPk2', 'au2') = :'sub', 'the same device is kept once');
select t.ok((select count(*) from public.push_subscriptions) = 1, 'a person sees their own devices');

-- every notification goes to the devices too
reset role;
select app.notify(:'co', :'me', 'info', 'Low stock: MILK-1L', null, '/inventory/alerts', 'stock_alerts', null);
select t.ok((select count(*) from app.push_outbox where subscription_id = :'sub' and title = 'Low stock: MILK-1L') = 1, 'a notification waits to go to the phone');
insert into public.notification_preferences (user_id, company_id, category, push) values (:'me', :'co', 'stock', false);
select app.notify(:'co', :'me', 'info', 'Low stock: BREAD', null, '/inventory/alerts', 'stock_alerts', null);
select t.ok(not exists (select 1 from app.push_outbox where title = 'Low stock: BREAD'), 'a category switched off for the phone stays in the app only');
select t.ok(exists (select 1 from public.notifications where title = 'Low stock: BREAD'), '… and still arrives in the app');
select app.notify(:'co', :'me', 'warning', 'Cash difference at Arka 1: -3.10 EUR', null, '/pos/sessions/' || gen_random_uuid(), null, null);
select t.ok((select category from public.notifications where title like 'Cash difference at Arka 1%' limit 1) = 'cash', 'cash differences have their own category');

-- the morning line (run by the server, as nobody)
select set_config('request.jwt.claim.sub', '', false);
select (select count(*) from app.push_outbox) as before \gset
select app.summary_notify(:'co') as n0 \gset
select t.ok(:n0 = 0, 'a day with nothing to tell sends nothing');
-- the demo market (test 32) sold yesterday: its owner gets the line
select id as dm from public.companies where name = 'Market Demo X' \gset
select app.summary_notify(:'dm') as n1 \gset
select title, body, category from public.notifications where company_id = :'dm' and entity_type = 'daily_summary' limit 1 \gset s_
select t.ok(:n1 >= 1 and :'s_title' like 'Sales on %: %€' and :'s_body' like 'Receipts: %' and :'s_category' = 'summary', 'owners get yesterday in one line every morning');
select t.ok(app.money_txt(1139.38, 'EUR') = '1.139,38 €' and app.money_txt(-3.1, 'ALL') = '-3,10 L', 'amounts are written the Albanian way');

-- the postier
select set_config('request.jwt.claim.sub', '', false);
select t.ok((public.postier_push_keys('BPUB', '{"d":"x"}') ->> 'public') = 'BPUB' and (public.postier_push_keys('OTHER', 'y') ->> 'public') = 'BPUB', 'the keys are made once and kept');
select public.postier_push_claim() as batch \gset
select t.ok(jsonb_array_length(:'batch') >= 2 and (:'batch'::jsonb -> 0 ->> 'endpoint') like 'https://fcm%' and (:'batch'::jsonb -> 0 ->> 'locale') = 'sq', 'the postier gets the address, the keys and the language');
select public.postier_push_done((:'batch'::jsonb -> 0 ->> 'id')::uuid, true);
select t.ok((select last_sent_at from public.push_subscriptions where id = :'sub') is not null, 'a delivered notification is gone from the queue');
select public.postier_push_done((:'batch'::jsonb -> 1 ->> 'id')::uuid, false, '410 Gone', true);
select t.ok(not exists (select 1 from public.push_subscriptions where id = :'sub') and not exists (select 1 from app.push_outbox where subscription_id = :'sub'),
  'a device that said goodbye is forgotten, with what waited for it');
set role authenticated;
select t.login('alice@alba.al');
select t.throws($q$select public.postier_push_claim()$q$, 'permission denied', 'only the server sends');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
