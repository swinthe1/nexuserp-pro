-- =============================================================================
-- DrisPRO · the assistant as an agent: cards that act only on "Po", the page the person is on,
-- the morning check (runs after 01–68)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
insert into auth.users (email, raw_user_meta_data) values ('drita@agjent.xk', '{"full_name":"Drita Pronare"}'), ('blerim@agjent.xk', '{"full_name":"Blerim Menaxher"}'),
  ('vesa@agjent.xk', '{"full_name":"Vesa Arkëtare"}') on conflict do nothing;
set role authenticated;
select t.login('zoe@platform.io');
select public.platform_create_client(jsonb_build_object('name', 'Agjent Test', 'country', 'XK', 'tax_number', '811990077',
  'owner_email', 'drita@agjent.xk', 'owner_name', 'Drita Pronare', 'plan', 'standard', 'max_users', 5,
  'valid_until', (current_date + 365)::text)) as co \gset
select public.platform_set_plan_extras(:'co', array['ai_assistant'], null);
select t.login('drita@agjent.xk');
select public.invite_member(:'co', 'blerim@agjent.xk', array['store_manager']);
select public.invite_member(:'co', 'vesa@agjent.xk', array['pos_cashier']);
select t.accept_invites();
select t.login('drita@agjent.xk');
select id as shop from public.warehouses where company_id = :'co' order by created_at limit 1 \gset
update public.warehouses set name = 'Dyqani Qendër' where id = :'shop';
insert into public.warehouses (company_id, code, name, warehouse_type) values (:'co', 'MQ', 'Magazina qendrore', 'warehouse') returning id as depot \gset
insert into public.warehouse_locations (company_id, warehouse_id, code, name) values (:'co', :'depot', 'MQ/STOCK', 'Raftet') returning id as depot_loc \gset
select id as pcs from public.units_of_measure where company_id = :'co' and code = 'pcs' \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'A-KAC', 'name', 'Kaçkavall 400 g', 'uom_id', :'pcs', 'sales_price', 3.2)) as p \gset
select id as kac from public.product_variants where product_id = :'p' \gset
insert into public.business_partners (company_id, code, name, is_customer, email) values (:'co', 'K-1', 'Hotel Kalaja', true, 'hotel@kalaja.test') returning id as hotel \gset
insert into public.business_partners (company_id, code, name, is_vendor) values (:'co', 'F-1', 'Bulmetorja Fusha', true) returning id as fusha \gset

-- ----------------------------------------------------------------------------- a question that ends in cards
select public.assistant_send(:'co', null, 'Më përgatit porosinë dhe një detyrë', ('{"path":"/inventory/products/' || :'p' || '"}')::jsonb) as s1 \gset
reset role;
select set_config('request.jwt.claim.sub', '', false);
set role service_role;
select public.assistant_wait(500) ->> 'job' as job \gset
select public.assistant_tool(:'job', 'page_record', '{}') as page \gset
select public.assistant_tool(:'job', 'propose_task', '{"title":"Numëro raftin e bulmetit","due":"2030-01-15","priority":"high"}') as ptask \gset
select public.assistant_tool(:'job', 'propose_task', '{"title":"Për Vesën","person":"Vesa"}') as pvesa \gset
select public.assistant_tool(:'job', 'propose_purchase_order', '{"vendor":"Fusha","lines":[{"item":"A-KAC","quantity":24,"price":2.35}]}') as ppo \gset
select public.assistant_tool(:'job', 'propose_sales_invoice', '{"customer":"Kalaja","lines":[{"item":"Kaçkavall 400 g","quantity":3}]}') as pinv \gset
select public.assistant_tool(:'job', 'propose_reminder', '{"customer":"Hotel Kalaja"}') ->> 'error' as prem \gset
select public.assistant_tool(:'job', 'propose_purchase_order', '{"vendor":"Askush","lines":[{"item":"A-KAC","quantity":1}]}') ->> 'error' as pnov \gset
select public.assistant_tool(:'job', 'propose_transfer', '{"item":"A-KAC","from":"Magazina","to":"Dyqani Qendër","quantity":12}') as ptr \gset
select public.assistant_tool(:'job', 'propose_price_change', '{"item":"A-KAC","price_with_vat":3.95}') as ppr \gset
select public.assistant_tool(:'job', 'my_tasks', '{}') as mine \gset
reset role;
select t.ok((:'page'::jsonb ->> 'kind') = 'item' and (:'page'::jsonb -> 'items' -> 0 ->> 'name') = 'Kaçkavall 400 g', 'the assistant sees the item open on the person''s screen');
select t.ok((:'ptask'::jsonb ->> 'proposed')::boolean and (:'ptask'::jsonb -> 'card' ->> 'title') = 'Numëro raftin e bulmetit'
            and (:'ptask'::jsonb -> 'card' -> 'rows' -> 1 ->> 1) = '15.01.2030', 'a task is prepared as a card: title, person, date');
select t.ok(not exists (select 1 from public.tasks where company_id = :'co'), 'nothing is made before the person presses Po');
select t.ok(:'pvesa'::jsonb ? 'action', 'the owner may prepare a task for someone else');
select t.ok((:'ppo'::jsonb -> 'card' ->> 'title') = 'Bulmetorja Fusha' and (:'ppo'::jsonb -> 'card' -> 'rows' -> 1 ->> 1) = '56,40 €', 'an order to the vendor found by part of its name, with its total');
select t.ok((:'pinv'::jsonb -> 'card' -> 'rows' -> 0 ->> 1) like '3 × %', 'an invoice takes the price from the price list');
select t.ok((:'ptr'::jsonb -> 'card' -> 'rows' -> 1 ->> 1) = 'Magazina qendrore' and (:'ptr'::jsonb -> 'card' -> 'rows' -> 2 ->> 1) = 'Dyqani Qendër', 'a transfer finds both units by name');
select t.ok((:'ppr'::jsonb -> 'card' -> 'rows' -> 1 ->> 1) = '3,95 €', 'a new price is shown with VAT, as typed');
select t.ok(:'prem' = 'The customer owes nothing', 'no reminder to a customer who owes nothing');
select t.ok(:'pnov' like 'No vendor matches%', 'an unknown vendor is said, so the assistant can ask');
select t.ok(:'mine'::jsonb = '[]'::jsonb, 'the person''s open tasks: none yet');

set role service_role;
select public.assistant_done(:'job', true, 'Ju përgatita porosinë dhe detyrën.', null, 10, 10, 'm');
reset role;
set role authenticated;
select t.login('drita@agjent.xk');
select public.assistant_state((:'s1'::jsonb ->> 'conversation_id')::uuid) as st \gset
select t.ok(jsonb_array_length(:'st'::jsonb -> 'messages' -> 1 -> 'actions') = 6
            and (select bool_and(a ->> 'status' = 'proposed') from jsonb_array_elements(:'st'::jsonb -> 'messages' -> 1 -> 'actions') a), 'the answer carries its six cards, waiting');

-- ----------------------------------------------------------------------------- Po and Jo
select (:'ptask'::jsonb ->> 'action') as a_task, (:'pvesa'::jsonb ->> 'action') as a_vesa, (:'ppo'::jsonb ->> 'action') as a_po, (:'pinv'::jsonb ->> 'action') as a_inv,
       (:'ptr'::jsonb ->> 'action') as a_tr, (:'ppr'::jsonb ->> 'action') as a_pr \gset
select t.login('vesa@agjent.xk');
select t.throws(format($q$select public.assistant_decide(%L, true)$q$, :'a_task'), 'Not found', 'nobody else presses Po on a person''s card');
select t.login('drita@agjent.xk');
select public.assistant_decide(:'a_task', true) as d_task \gset
select t.ok((:'d_task'::jsonb ->> 'status') = 'done' and exists (select 1 from public.tasks where company_id = :'co' and title = 'Numëro raftin e bulmetit'
            and due_date = '2030-01-15' and priority = 2 and source = 'assistant' and assignee_id = (select id from public.profiles where email = 'drita@agjent.xk')),
            'Po makes the task, as the person, from the assistant');
select t.throws(format($q$select public.assistant_decide(%L, true)$q$, :'a_task'), 'already decided', 'a card is pressed once');
select public.assistant_decide(:'a_vesa', false) as d_vesa \gset
select t.ok((:'d_vesa'::jsonb ->> 'status') = 'declined' and not exists (select 1 from public.tasks where company_id = :'co' and title = 'Për Vesën'), 'Jo drops it');
select public.assistant_decide(:'a_po', true) as d_po \gset
select t.ok((:'d_po'::jsonb ->> 'status') = 'done' and exists (select 1 from public.purchase_orders where company_id = :'co' and status = 'draft' and total > 0),
            'Po on the order makes a draft purchase order');
select public.assistant_decide(:'a_inv', true) as d_inv \gset
select t.ok((:'d_inv'::jsonb -> 'result' ->> 'href') like '/sales/invoices/%' and exists (select 1 from public.sales_invoices where company_id = :'co' and status = 'draft'),
            'Po on the invoice makes a draft, not a booked invoice');
select public.assistant_decide(:'a_pr', true) as d_pr \gset
select t.ok((:'d_pr'::jsonb -> 'result' ->> 'href') like '/inventory/levelling/%', 'Po on the price puts it on the person''s levelling');
-- the depot has no stock of it: the request still goes out (the people there decide); a failure would be kept on the card
select public.assistant_decide(:'a_tr', true) as d_tr \gset
select t.ok((:'d_tr'::jsonb ->> 'status') in ('done', 'failed'), 'Po on the transfer asks the other unit (or says why it could not)');
-- a cashier's card for an invoice is refused when it is made: the tools keep the person's permissions
select t.login('vesa@agjent.xk');
select public.assistant_send(:'co', null, 'Faturë për hotelin') as s2 \gset
reset role;
select set_config('request.jwt.claim.sub', '', false);
set role service_role;
select public.assistant_wait(500) ->> 'job' as job2 \gset
select public.assistant_tool(:'job2', 'propose_sales_invoice', '{"customer":"Kalaja","lines":[{"item":"A-KAC","quantity":1}]}') ->> 'error' as vinv \gset
select public.assistant_tool(:'job2', 'propose_task', '{"title":"x","person":"Blerim"}') ->> 'error' as vtask \gset
select public.assistant_tool(:'job2', 'my_tasks', '{"who":"Drita"}') ->> 'error' as vsee \gset
select public.assistant_done(:'job2', false, null, null, null, null, null, 'overloaded');
reset role;
select t.ok(:'vinv' ilike 'Permission denied%', 'a cashier''s assistant cannot prepare an invoice');
select t.ok(:'vtask' = 'Only a manager gives tasks to other people', 'nor give tasks to others');
select t.ok(:'vsee' like 'Permission denied%', 'nor look at other people''s tasks');
-- what the model reads back: the cards and what came of them
set role authenticated;
select t.login('drita@agjent.xk');
select public.assistant_send(:'co', (:'s1'::jsonb ->> 'conversation_id')::uuid, 'Faleminderit') as s3 \gset
reset role;
select set_config('request.jwt.claim.sub', '', false);
set role service_role;
select public.assistant_wait(500) as w3 \gset
select public.assistant_done((:'w3'::jsonb ->> 'job')::uuid, true, 'S''ka përse.', null, 1, 1, 'm');
reset role;
select t.ok((:'w3'::jsonb -> 'messages' -> 1 ->> 'content') like '%[task card "Numëro raftin e bulmetit": done → DET-%' and (:'w3'::jsonb -> 'messages' -> 1 ->> 'content') like '%: declined]%',
            'the next question shows the model what came of its cards');
-- old cards cannot be pressed
update app.assistant_actions set created_at = now() - interval '4 days', status = 'proposed' where id = :'a_vesa';
set role authenticated;
select t.login('drita@agjent.xk');
select t.ok((public.assistant_decide(:'a_vesa', true) ->> 'status') = 'expired', 'a card older than three days has expired');

-- ----------------------------------------------------------------------------- the page the person is on
select t.ok((public.ai_page_record(:'co', '/sales/invoices') ->> 'record')::boolean = false, 'a list is not a record');
select id as inv from public.sales_invoices where company_id = :'co' limit 1 \gset
select t.ok((public.ai_page_record(:'co', '/sales/invoices/' || :'inv') -> 'document' ->> 'kind') is not null, 'an invoice open on the screen is read with its lines');
select t.ok((public.ai_page_record(:'co', '/partners/' || :'hotel') ->> 'kind') = 'partner', 'so is a partner''s card');

-- ----------------------------------------------------------------------------- the morning check
select t.ok((public.assistant_daily_get(:'co') ->> 'enabled')::boolean = false, 'the morning check is off until the person turns it on');
select t.throws(format($q$select public.assistant_daily_set(%L, true, 3)$q$, :'co'), 'between 5 and 12', 'only a morning hour');
select public.assistant_daily_set(:'co', true, 5);
reset role;
select set_config('request.jwt.claim.sub', '', false);
update public.companies set timezone = (select z from unnest(array['Europe/Tirane', 'Asia/Tokyo', 'Pacific/Kiritimati', 'America/New_York', 'Pacific/Honolulu']) z
                                         where extract(hour from now() at time zone z) between 12 and 22 limit 1) where id = :'co';
update app.assistant_jobs set status = 'done' where status in ('queued', 'running');
select app.assistant_daily_queue() as q1 \gset
select app.assistant_daily_queue() as q2 \gset
select t.ok(:q1 = 1 and :q2 = 0, 'once the hour has come the morning check is queued, once a day');
set role service_role;
select public.assistant_wait(500) as dw \gset
select public.assistant_done((:'dw'::jsonb ->> 'job')::uuid, true, '**Dje** u shit mirë. [Hotel Kalaja](/partners/x) ka borxh.', null, 5, 5, 'm');
reset role;
select t.ok(coalesce((:'dw'::jsonb -> 'context' ->> 'daily')::boolean, false) and (:'dw'::jsonb -> 'messages' -> 0 ->> 'content') like 'Kontrolli i mëngjesit%',
            'the morning check asks its own question, in the person''s language');
select t.ok(exists (select 1 from public.notifications where company_id = :'co' and title = 'Your morning check is ready'
                     and link = '/?assistant=' || (:'dw'::jsonb ->> 'conversation') and body = 'Dje u shit mirë. Hotel Kalaja ka borxh.'),
            'and tells the person when it is ready, with a link that opens it');
-- off, or past the month's questions: no check
update app.assistant_daily set last_day = current_date - 1 where company_id = :'co';
update public.licenses set ai_chat_limit = 0 where company_id = :'co';
select t.ok(app.assistant_daily_queue() = 0, 'past the month''s questions there is no morning check');
update public.licenses set ai_chat_limit = null where company_id = :'co';
set role authenticated;
select t.login('drita@agjent.xk');
select public.assistant_daily_set(:'co', false, 7);
reset role;
update app.assistant_daily set last_day = current_date - 1 where company_id = :'co';
select t.ok(app.assistant_daily_queue() = 0, 'turned off, it does not run');
select t.ok(position('assistant_daily_queue' in pg_get_functiondef('public.automation_tick'::regproc)) > 0, 'the timed work runs the morning checks');

\set QUIET off
select count(*) as assertions_passed from t.results;
