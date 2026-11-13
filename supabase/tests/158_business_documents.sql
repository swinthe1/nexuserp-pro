-- =============================================================================
-- The business's own documents (K-0012): who sees them, where the file may sit, the sheet, the email. (on "Kontrolle Test")
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Kontrolle Test' \gset
select email as boss from public.profiles where is_super_admin limit 1 \gset
set role authenticated;
select t.login(:'boss');
insert into public.company_documents (company_id, kind, title, storage_path, file_name, mime_type, size_bytes)
  values (:'co', 'business_certificate', 'Certifikata e biznesit', :'co' || '/business-docs/t158.pdf', 'certifikata.pdf', 'application/pdf', 1200);
select t.ok((select count(*) = 1 from public.company_documents where company_id = :'co' and title = 'Certifikata e biznesit'), 'a document is kept');
select t.throws(format($q$insert into public.company_documents (company_id, title, storage_path, file_name) values (%L, 'x', %L, 'x.pdf')$q$, :'co', :'co' || '/other/x.pdf'), '', 'a file outside business-docs is refused');
select t.throws(format($q$insert into public.company_documents (company_id, title, storage_path, file_name) values (%L, 'x', 'someone-else/business-docs/x.pdf', 'x.pdf')$q$, :'co'), '', 'and one in another company''s folder');
select t.ok((public.business_sheet(:'co') -> 'business' ->> 'name') = 'Kontrolle Test', 'the sheet has the business');
select t.ok((select count(*) = 0 from jsonb_array_elements(public.business_sheet(:'co') -> 'units') u where u ->> 'kind' = 'transit'), 'the sheet lists no transit unit');
select t.ok((select count(*) = (select count(*) from public.warehouses w where w.company_id = :'co' and w.deleted_at is null and w.is_active and w.warehouse_type <> 'transit')
  from jsonb_array_elements(public.business_sheet(:'co') -> 'units')), 'and every other unit');
select t.throws(format($q$select public.business_documents_email(%L, 'not-an-address', 's', 'm', '[{"name":"a.pdf","mime":"application/pdf","data":"QUJD"}]')$q$, :'co'), 'valid email', 'a wrong address is refused');
-- another company's owner sees and gets nothing
select t.login('pronari@arberi.xk');
select t.ok((select count(*) = 0 from public.company_documents where company_id = :'co'), 'another company does not see the documents');
select t.throws(format('select public.business_sheet(%L)', :'co'), '', 'nor the sheet');
select t.throws(format($q$select public.business_documents_email(%L, 'a@b.co', 's', 'm', '[{"name":"a.pdf","mime":"application/pdf","data":"QUJD"}]')$q$, :'co'), '', 'nor sends them');
reset role;
-- with a mailbox: the checks on the files, and the message waits with its attachments
select not exists (select 1 from app.mail_accounts where company_id = :'co') as add_mail \gset
insert into app.mail_accounts (company_id, host, from_email) select :'co', 'smtp.test.invalid', 'prove@test.invalid' where :'add_mail';
set role authenticated;
select t.login(:'boss');
select t.throws(format($q$select public.business_documents_email(%L, 'a@b.co', 's', 'm', '[]')$q$, :'co'), 'at least one', 'no file, no message');
select t.throws(format($q$select public.business_documents_email(%L, 'a@b.co', 's', 'm', '[{"name":"a.exe","mime":"application/x-msdownload","data":"QUJD"}]')$q$, :'co'), 'Only PDF', 'only PDF, JPG and PNG');
select public.business_documents_email(:'co', 'a@b.co', 'Dokumentet', 'm', '[{"name":"a.pdf","mime":"application/pdf","data":"QUJD"},{"name":"b.png","mime":"image/png","data":"QUJD"}]') as mid \gset
reset role;
select t.ok((select jsonb_array_length(attachments) = 2 and channel = 'email' and to_address = 'a@b.co' from app.message_outbox where id = :'mid'), 'the message waits with both attachments');
delete from app.message_outbox where id = :'mid';
delete from app.mail_accounts where company_id = :'co' and :'add_mail';
delete from public.company_documents where company_id = :'co';
\set QUIET off
select count(*) as assertions_passed from t.results;
