-- =============================================================================
-- Requests while the program is built: anyone in a company sends one, everyone sees it (the company name and the
-- picture only inside the company), "me too" counts once, only the platform owner changes the status and the
-- person is told; the switch closes it. (after 148: Mini Market Arbëri and Kontrolle Test)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as mini from public.companies where name = 'Mini Market Arbëri' \gset
select id as kt from public.companies where name = 'Kontrolle Test' \gset
select email as boss from public.profiles where is_super_admin limit 1 \gset

set role authenticated;
select t.login('pronari@arberi.xk');
select (public.change_request_submit(jsonb_build_object('company_id', :'mini', 'kind', 'add', 'body', 'Shto kolonën e barkodit',
  'page_path', '/inventory/items', 'target', 'Kolona: Emri', 'screenshot', :'mini' || '/requests/a.jpg'))) ->> 'id' as req \gset
reset role;
select t.ok((select status = 'new' and number > 0 and author_name is not null from public.change_requests where id = :'req'), 'a person sends a request and it gets a number');
set role authenticated;
select t.login('pronari@arberi.xk');
select t.throws(format('select public.change_request_submit(%L)', jsonb_build_object('company_id', :'kt', 'kind', 'add', 'body', 'test')), 'Not your company',
  'nobody sends a request in the name of another company');
select t.throws(format('select public.change_request_submit(%L)', jsonb_build_object('company_id', :'mini', 'kind', 'wish', 'body', 'test')), '',
  'only the five kinds');
select public.change_request_detail_start(:'mini', '{"kind":"add","body":"barkodi te artikujt","page_title":"Artikujt"}') as job \gset
select t.ok((public.change_request_detail_result(:'job')) ->> 'status' = 'queued', 'writing it out in detail waits for the AI');
reset role;
update app.ai_relay set status = 'done', response = '{"content":[{"type":"text","text":"Çka: shto kolonën"}]}' where id = :'job';
set role authenticated;
select t.login('pronari@arberi.xk');
select t.ok((public.change_request_detail_result(:'job')) ->> 'text' = 'Çka: shto kolonën', 'the person reads the request written out');
select t.login('cora@kt.al');
select t.throws(format('select public.change_request_detail_result(%L)', :'job'), 'Not found', 'nobody else reads it');
select t.login('pronari@arberi.xk');
select t.throws(format('select public.change_request_update(%L, %L)', :'req', '{"status":"done"}'), 'platform owner', 'only the platform owner changes the status');
select t.throws(format('select public.platform_set_requests_on(false)'), 'platform owner', 'only the platform owner closes the requests');

select t.login('cora@kt.al');
select t.ok((select (x ->> 'company') is null and (x ->> 'screenshot') is null and x ->> 'body' = 'Shto kolonën e barkodit'
  from jsonb_array_elements(public.change_requests_list()) x where x ->> 'id' = :'req'),
  'another company sees the request, without the company name and the picture');
select public.change_request_vote(:'req');
select public.change_request_vote(:'req');
select public.change_request_vote(:'req');
select t.ok((select (x ->> 'votes')::int = 1 and (x ->> 'voted')::boolean from jsonb_array_elements(public.change_requests_list()) x where x ->> 'id' = :'req'),
  '"me too" counts once and a second click takes it back');
select t.throws(format('select public.change_request_withdraw(%L)', :'req'), 'Only your own', 'one cannot take back the request of another');

select t.login(:'boss');
select public.change_request_update(:'req', '{"status":"done","done_version":"2.51.0","reply":"U shtua"}');
reset role;
select t.ok((select count(*) = 1 from public.notifications n join public.change_requests r on r.id = :'req'
   where n.user_id = r.author_id and n.link = '/requests?k=' || r.number), 'the person is told when the status changes');
set role authenticated;
select t.login(:'boss');
select public.platform_set_requests_on(false);
select t.login('pronari@arberi.xk');
select t.throws(format('select public.change_request_submit(%L)', jsonb_build_object('company_id', :'mini', 'kind', 'bug', 'body', 'test')), 'closed',
  'when the platform closes the requests nobody sends one');
select t.login(:'boss');
select public.platform_set_requests_on(true);
reset role;
\set QUIET off
select count(*) as assertions_passed from t.results;
