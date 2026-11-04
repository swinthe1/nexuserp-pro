-- =============================================================================
-- DrisPRO · the agent learns the business: lessons for the company and for one person, the
-- "Ta mbaj mend?" card, a "Jo" with its reason (runs after 69)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Agjent Test' \gset
update app.assistant_jobs set status = 'done' where status in ('queued', 'running');
set role authenticated;

-- ----------------------------------------------------------------------------- the page
select t.login('drita@agjent.xk');
select public.assistant_memory_save(:'co', null, 'rule', null, 'Klientët me vonesë mbi 30 ditë nuk marrin mall me borxh.', true) ->> 'id' as m_rule \gset
select public.assistant_memory_save(:'co', null, 'procedure', 'Mbyllja e ditës', '1. Numëro paratë. 2. Printo raportin Z. 3. Paratë në sef, shuma në zarf.', true) ->> 'id' as m_proc \gset
select public.assistant_memory_save(:'co', null, 'preference', null, 'Mua më jep shifrat pa TVSH.', false) ->> 'id' as m_drita \gset
select t.throws(format($q$select public.assistant_memory_save(%L, null, 'rule', null, 'ab', false)$q$, :'co'), 'Write what the agent should know', 'a lesson needs a few words');
select t.throws(format($q$select public.assistant_memory_save(%L, null, 'secret', null, 'abcd', false)$q$, :'co'), 'Unknown kind', 'only the known kinds of lesson');
select t.login('vesa@agjent.xk');
select t.throws(format($q$select public.assistant_memory_save(%L, null, 'rule', null, 'Të gjithë marrin 50%% zbritje', true)$q$, :'co'), 'Only a manager teaches', 'a cashier does not teach the whole company');
select public.assistant_memory_save(:'co', null, 'name', null, 'Kur them "kafe" e kam fjalën Kaçkavall 400 g.', false) ->> 'id' as m_vesa \gset
select public.assistant_memory_list(:'co') as vl \gset
select t.ok(not (:'vl'::jsonb ->> 'can_teach_company')::boolean
            and (select count(*) from jsonb_array_elements(:'vl'::jsonb -> 'items') x where (x ->> 'company')::boolean) = 2
            and (select count(*) from jsonb_array_elements(:'vl'::jsonb -> 'items') x where not (x ->> 'company')::boolean) = 1
            and not exists (select 1 from jsonb_array_elements(:'vl'::jsonb -> 'items') x where x ->> 'body' like 'Mua më jep%'),
            'each person sees the company''s lessons and their own, not another person''s');
select t.ok((select bool_and(not (x ->> 'can_edit')::boolean) from jsonb_array_elements(:'vl'::jsonb -> 'items') x where (x ->> 'company')::boolean), 'a cashier cannot change the company''s lessons');
select t.throws(format($q$select public.assistant_memory_delete(%L)$q$, :'m_rule'), 'Not found', 'nor forget them');
select t.throws(format($q$select public.assistant_memory_save(%L, %L, 'rule', null, 'Ndryshuar', false)$q$, :'co', :'m_rule'), 'Permission denied', 'nor rewrite them');

-- ----------------------------------------------------------------------------- every answer starts with them
select public.assistant_send(:'co', null, 'Sa kafe kemi?') as s1 \gset
reset role;
select set_config('request.jwt.claim.sub', '', false);
set role service_role;
select public.assistant_wait(500) as w1 \gset
select public.assistant_tool((:'w1'::jsonb ->> 'job')::uuid, 'company_knowledge', '{"query":"si mbyllet dita"}') as kn \gset
select public.assistant_tool((:'w1'::jsonb ->> 'job')::uuid, 'remember', '{"text":"Arka 2 hapet në orën 7:00","for_everyone":true}') ->> 'error' as rall \gset
select public.assistant_tool((:'w1'::jsonb ->> 'job')::uuid, 'remember', '{"text":"Unë punoj në turnin e mëngjesit","kind":"preference"}') as rme \gset
select public.assistant_tool((:'w1'::jsonb ->> 'job')::uuid, 'propose_task', '{"title":"Numëro kafen"}') as rtask \gset
select public.assistant_done((:'w1'::jsonb ->> 'job')::uuid, true, 'Kemi 404 copë.', null, 1, 1, 'm');
reset role;
select t.ok(jsonb_array_length(:'w1'::jsonb -> 'memory') = 3
            and exists (select 1 from jsonb_array_elements(:'w1'::jsonb -> 'memory') x where x ->> 'for' = 'you' and x ->> 'text' like 'Kur them "kafe"%')
            and not exists (select 1 from jsonb_array_elements(:'w1'::jsonb -> 'memory') x where x ->> 'text' like 'Mua më jep%'),
            'the cashier''s question comes with the company''s lessons and her own');
select t.ok((:'kn'::jsonb -> 0 ->> 'title') = 'Mbyllja e ditës', 'the agent finds how the company closes the day');
select t.ok(:'rall' like 'Only a manager teaches%', 'it does not offer to teach the whole company for a cashier');
select t.ok((:'rme'::jsonb -> 'card' -> 'rows' -> 0 ->> 1) = 'only you', '"Ta mbaj mend?" is a card, for the person');
set role authenticated;
select t.login('vesa@agjent.xk');
select public.assistant_decide((:'rme'::jsonb ->> 'action')::uuid, true) as dme \gset
select public.assistant_decide((:'rtask'::jsonb ->> 'action')::uuid, false, 'Kafen e numëron Blerimi të premten') as dno \gset
reset role;
select t.ok((:'dme'::jsonb ->> 'status') = 'done' and exists (select 1 from app.assistant_memory where company_id = :'co' and source = 'chat' and kind = 'preference'
            and user_id = (select id from public.profiles where email = 'vesa@agjent.xk') and body = 'Unë punoj në turnin e mëngjesit'), 'on "Po" the agent keeps it');
select t.ok((:'dno'::jsonb ->> 'status') = 'declined' and exists (select 1 from app.assistant_memory where company_id = :'co' and source = 'declined' and kind = 'correction'
            and body like '%"Numëro kafen", the answer was No: Kafen e numëron Blerimi të premten'), 'a "Jo" with a reason becomes a lesson');

set role authenticated;
select t.login('vesa@agjent.xk');
select public.assistant_send(:'co', (:'s1'::jsonb ->> 'conversation_id')::uuid, 'Mirë') as s2 \gset
reset role;
select set_config('request.jwt.claim.sub', '', false);
set role service_role;
select public.assistant_wait(500) as w2 \gset
select public.assistant_done((:'w2'::jsonb ->> 'job')::uuid, true, 'Në rregull.', null, 1, 1, 'm');
reset role;
select t.ok((:'w2'::jsonb -> 'messages' -> 1 ->> 'content') like '%declined — reason: Kafen e numëron Blerimi të premten]%'
            and jsonb_array_length(:'w2'::jsonb -> 'memory') = 5, 'the next answer knows the reason and the two new lessons');

-- ----------------------------------------------------------------------------- forgetting
set role authenticated;
select t.login('drita@agjent.xk');
select public.assistant_memory_delete(:'m_rule');
select t.ok(not exists (select 1 from jsonb_array_elements(public.assistant_memory_list(:'co') -> 'items') x where x ->> 'id' = :'m_rule'), 'a manager makes the agent forget a company lesson');
reset role;
select t.ok(jsonb_array_length(app.ai_memory_for(:'co', (select id from public.profiles where email = 'drita@agjent.xk'))) = 2, 'the owner''s agent: the procedure and her own preference');

\set QUIET off
select count(*) as assertions_passed from t.results;
