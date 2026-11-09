-- =============================================================================
-- Registering a till: ATK's "already added" and 404 come back as plain advice with a free number.
-- (after 68, on "SEF Test": till 1 had number 1 and was unregistered; till 2 has number 2)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'SEF Test' and tax_number = '810123456' \gset
select id as reg2 from public.pos_registers where company_id = :'co' and code = 'A2' \gset
select set_config('request.jwt.claim.sub', '', false);
delete from app.atk_jobs where register_id = :'reg2';
update public.platform_settings set atk_application_id_test = 4242 where id;

-- 1. /ca/verify 404: nothing is marked used; the person is told both reasons and a free number
set role authenticated;
select t.login('lume@atk.al');
select public.atk_onboard_verify(:'reg2') as v \gset
reset role;
select set_config('request.jwt.claim.sub', '', false);
select public.atk_done('verify', :'v', 404, '{"code":"","message":"Error verify request. ATK service is responding with code: 404"}');
select t.ok((select error from app.atk_jobs where id = :'v') like 'ATK does not know till number 2 of store 3: %give this till number 3', 'a 404 says what may be wrong and offers number 3');
select t.ok(not exists (select 1 from app.atk_pos_used where nui = '810123456' and env = 'test' and branch_id = 3 and pos_id = 2), 'and does not burn the number');

-- 2. /ca/signcsr "already added": the number is kept as used, and a free one is offered
update app.atk_jobs set status = 'done', response = '{"business_name":"SEF Test SH.P.K.","verification_code":"VC-1"}', error = null where id = :'v';
set role authenticated;
select t.login('lume@atk.al');
select public.atk_onboard_csr(:'v', E'-----BEGIN CERTIFICATE REQUEST-----\nMIIB\n-----END CERTIFICATE REQUEST-----\n', 'BPub2', 'Safari on iPhone') as c \gset
reset role;
select set_config('request.jwt.claim.sub', '', false);
select public.atk_done('signcsr', :'c', 409, '{"message":"Certificate has already been added."}');
select t.ok((select error from app.atk_jobs where id = :'c') = 'ATK registers each till number once, and number 2 of this store is taken: give this till number 3', 'ATK''s "already added" becomes plain advice');
select t.ok(exists (select 1 from app.atk_pos_used where nui = '810123456' and env = 'test' and branch_id = 3 and pos_id = 2), 'the number is remembered as used');
set role authenticated;
select t.login('lume@atk.al');
select t.throws(format($q$select public.atk_onboard_verify('%s')$q$, :'reg2'), 'give this till number 3', 'the next try is stopped before ATK, with the free number');
reset role;
update public.platform_settings set atk_application_id_test = null where id;

\set QUIET off
select count(*) as assertions_passed from t.results;
