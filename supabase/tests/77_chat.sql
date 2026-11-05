-- =============================================================================
-- DrisPRO Chat: who sees which conversation, unread counts, edit and delete, files, phone pushes
-- (runs after 69 "Agjent Test": Drita, Blerim, Vesa; 03 "Shitje Test" is another company)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Agjent Test' \gset
select id as other_co from public.companies where name = 'Shitje Test' \gset
select id as drita from auth.users where email = 'drita@agjent.xk' \gset
select id as blerim from auth.users where email = 'blerim@agjent.xk' \gset
select id as vesa from auth.users where email = 'vesa@agjent.xk' \gset
select id as fiona from auth.users where email = 'fiona@shop.al' \gset
-- Blerim has a phone that gets notifications
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values (:'blerim', 'https://push.example/blerim', 'k', 'a') on conflict do nothing;
set role authenticated;

select t.login('drita@agjent.xk');
select public.chat_open_direct(:'co', :'blerim') as dm \gset
select t.ok(public.chat_open_direct(:'co', :'blerim') = :'dm', 'the same two people find the same conversation again');
select t.throws(format($q$select public.chat_open_direct(%L, %L)$q$, :'co', :'fiona'), 'Only people of this company', 'nobody from another company');
select (public.chat_send(:'dm', 'Mirëmëngjes, a erdhi malli?') ->> 'id')::bigint as m1 \gset
reset role;
select t.ok((select count(*) = 1 from app.push_outbox o join public.push_subscriptions s on s.id = o.subscription_id where s.user_id = :'blerim' and o.body like 'Mirëmëngjes%'),
            'Blerim gets it on the phone');
set role authenticated;

select t.login('vesa@agjent.xk');
select t.ok((select count(*) = 0 from public.chat_messages where conversation_id = :'dm') and jsonb_array_length(public.chat_list(:'co')) = 0,
            'Vesa does not see a conversation she is not in');
select t.throws(format($q$select public.chat_send(%L, 'hej')$q$, :'dm'), 'not found', 'nor writes in it');

select t.login('blerim@agjent.xk');
select t.ok((public.chat_list(:'co') -> 0 ->> 'unread')::int = 1 and public.chat_unread(:'co') = 1 and (public.chat_list(:'co') -> 0 ->> 'title') = 'Drita Pronare',
            'Blerim sees one unread, under Drita''s name');
select public.chat_read(:'dm');
select t.ok(public.chat_unread(:'co') = 0, 'read: nothing unread');
select t.throws(format($q$select public.chat_edit(%s, 'ndryshuar')$q$, :m1), 'Only your own', 'one cannot change someone else''s message');
select public.chat_send(:'dm', 'Po, erdhi.', :m1);
select t.throws(format($q$select public.chat_send(%L, null, null, '[{"path":"%s/x/a.pdf","name":"a.pdf"}]')$q$, :'dm', :'co'), 'not in this conversation', 'a file from another folder is refused');
select public.chat_send(:'dm', null, null, jsonb_build_array(jsonb_build_object('path', :'co' || '/' || :'dm' || '/u1/fatura.pdf', 'name', 'fatura.pdf', 'type', 'application/pdf', 'size', 1200))) ;
select (select id from public.chat_messages where conversation_id = :'dm' order by id desc limit 1) as m3 \gset
select public.chat_edit(:m3, 'Ja fatura');
select public.chat_delete(:m3);
reset role;
select t.ok((select deleted_at is not null and body is null and attachments = '[]' from public.chat_messages where id = :m3)
            and exists (select 1 from public.audit_log where table_name = 'chat_messages' and action = 'SOFT_DELETE' and old_data ->> 'body' = 'Ja fatura'),
            'deleted from the conversation, kept in the audit log');
update public.chat_messages set created_at = now() - interval '20 minutes' where id = :m1;
set role authenticated;
select t.login('drita@agjent.xk');
select t.throws(format($q$select public.chat_edit(%s, 'vonë')$q$, :m1), 'within 15 minutes', 'after 15 minutes a message stays as it is');

-- a group
select public.chat_create_group(:'co', 'Magazina', array[:'blerim']::uuid[]) as grp \gset
select public.chat_add_members(:'grp', array[:'vesa']::uuid[]);
select t.login('vesa@agjent.xk');
select t.ok(exists (select 1 from jsonb_array_elements(public.chat_list(:'co')) x where x ->> 'id' = :'grp' and x ->> 'title' = 'Magazina'), 'Vesa is in the group once added');
select public.chat_mute(:'grp', now() + interval '1 day');
select public.chat_leave(:'grp');
select t.ok(not exists (select 1 from jsonb_array_elements(public.chat_list(:'co')) x where x ->> 'id' = :'grp'), 'and out of it once she leaves');

-- a DrisPRO link: the reader's own rights
select t.login('fiona@shop.al');
select t.ok(public.chat_link_card('sales_invoice', (select id from public.sales_invoices where company_id = :'co' limit 1)) is null, 'a link to another company''s invoice shows nothing');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
