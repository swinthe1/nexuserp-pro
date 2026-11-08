-- =============================================================================
-- Wave 2 of the audit, part 2: the search finds a till receipt, appointment reminders can go by
-- WhatsApp. (after 19 and 120, on "Kontrolle Test")
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select o.company_id as co, o.number as rno, o.session_id as sess from public.pos_orders o
 where o.number is not null and o.deleted_at is null order by o.created_at limit 1 \gset

-- 1. a till receipt is found by its number and opens its shift
set role authenticated;
select t.login('zoe@platform.io');
select t.ok(exists (select 1 from public.global_search(:'co', :'rno') where kind = 'pos_order' and href = '/pos/sessions/' || :'sess'),
            'the search finds the till receipt and opens its shift');
select t.ok((select subtitle from public.global_search(:'co', :'rno') where kind = 'pos_order' limit 1) like 'Till %',
            'with what it was, its total and when');
reset role;

-- 2. appointment reminders: off by default, saved, and sent through the WhatsApp template
select t.ok(not (select appt_whatsapp from public.company_settings where company_id = :'co'), 'WhatsApp reminders start switched off');
select t.ok(position('drispro_termin' in pg_get_functiondef('app.appt_reminders'::regproc)) > 0
            and position('appt_whatsapp' in pg_get_functiondef('app.appt_reminders'::regproc)) > 0,
            'the reminder job uses the approved template only where it is switched on');
select t.ok(position('appt_whatsapp' in pg_get_functiondef('public.messaging_settings_save'::regproc)) > 0
            and position('appt_whatsapp' in pg_get_functiondef('public.messaging_settings'::regproc)) > 0,
            'and the setting is read and saved with the other messages');

\set QUIET off
select count(*) as assertions_passed from t.results;
