-- =============================================================================
-- NexusERP Pro · live link tests (runs after 01–14)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
grant usage on schema t to anon;
grant execute on all functions in schema t to anon;
grant insert, select on t.results to anon;
grant usage on sequence t.results_n_seq to anon;

set role authenticated;
select t.login('zoe@platform.io');
select public.platform_create_client(jsonb_build_object('name', 'Lider Live', 'country', 'XK', 'owner_email', 'live@lider.xk',
  'owner_password', 'sekret123', 'max_users', 5)) as co \gset
select public.migration_import(:'co', 'warehouses', '[{"code":"1","name":"Njesia 1 DRENAS"}]', false, current_date);
select public.set_training_mode(:'co', true);
select public.sync_create_connection(:'co', 'Logmicro LM2026') as conn \gset
select (:'conn'::jsonb ->> 'key') as key \gset
select t.ok(:'key' like 'nxs_%' and length(:'key') = 52, 'a connection key is made and shown once');
select t.login('live@lider.xk');
select t.throws($$ select public.sync_create_connection('$$ || :'co' || $$', 'x') $$, 'Only the platform administrator', 'clients cannot make connection keys');
select t.ok((public.get_my_context() -> 'companies' -> 0 ->> 'is_training')::boolean, 'the app knows the company is in training');
select t.ok(not (select fiscalization_enabled from public.company_settings where company_id = :'co'), 'training companies do not fiscalize');
update public.company_settings set fiscalization_enabled = true where company_id = :'co';
select t.ok(not (select fiscalization_enabled from public.company_settings where company_id = :'co'), 'and cannot be switched to fiscalize');
reset role;
select t.ok(not exists (select 1 from public.sync_connections where key_hash like 'nxs_%' or key_prefix = :'key'), 'only a hash of the key is stored');

-- the agent pushes with the anon role
set role anon;
select t.throws($$ select public.sync_push('nxs_wrong', '{}') $$, 'Unknown or switched-off', 'a wrong key is refused');
reset role;
set role anon;
select public.sync_push(:'key', jsonb_build_object(
  'warehouses', '[{"code":"2","name":"Njesia 2 KORROTICE"}]'::jsonb,
  'products', '[{"sku":"33173","name":"ENERGY DRINK 250ML","uom":"pcs","price":"1","cost":"0.39","vat":"18"},{"sku":"33174","name":"SUGAR FREE","price":"2","vat":"18"}]'::jsonb,
  'partners', '[{"code":"1001","name":"Viva Fresh","role":"customer","tax_number":"810000011"},{"code":"1002","name":"Devolli","role":"vendor"}]'::jsonb,
  'prices', '[{"price_list":"Cm. Shitese_1","sku":"33173","price":"1"}]'::jsonb,
  'stock', '[{"warehouse":"1","sku":"33173","qty":"10","cost":"0.39"},{"warehouse":"1","sku":"NOPE","qty":"1"}]'::jsonb,
  'documents', '[{"ext_id":"100","kind":"sale","number":"F-1","partner":"1001","date":"2026-10-20","due_date":"2026-11-03","total":"120","open":"120"}]'::jsonb,
  'replace_partners', '["1001"]'::jsonb)) as r1 \gset
reset role;
select t.ok((:'r1'::jsonb ->> 'ok')::boolean, 'the agent''s push is accepted');
select t.ok((select count(*) from public.product_variants where company_id = :'co') = 2, 'products arrive');
select t.ok(exists (select 1 from public.warehouses where company_id = :'co' and code = '2'), 'stores arrive');
select t.ok((select count(*) from public.business_partners where company_id = :'co' and code in ('1001','1002')) = 2, 'partners arrive');
select t.ok((select sum(on_hand) from public.stock_levels where company_id = :'co') = 10, 'stock is set to the old program''s quantity');
select t.ok((:'r1'::jsonb -> 'stock' ->> 'unknown_items') = '1' and (:'r1'::jsonb -> 'stock' -> 'unknown_skus' ->> 0) = 'NOPE', 'unknown items are counted and named, not fatal');
select t.ok((select open_amount from public.external_documents where company_id = :'co' and ext_id = '100') = 120, 'open documents are mirrored');
select t.ok((select partner_id is not null from public.external_documents where company_id = :'co' and ext_id = '100'), 'and linked to the partner');
select t.ok(not exists (select 1 from public.journal_entries where company_id = :'co' and source_doc_type = 'sales_invoice'), 'mirrored documents do not touch the books');

-- next push: stock goes down, the invoice is paid (partner resent without it)
set role anon;
select public.sync_push(:'key', jsonb_build_object(
  'stock', '[{"warehouse":"1","sku":"33173","qty":"7"}]'::jsonb, 'replace_partners', '["1001"]'::jsonb)) as r2 \gset
select public.sync_push(:'key', jsonb_build_object('stock', '[{"warehouse":"1","sku":"33173","qty":"7"}]'::jsonb)) as r3 \gset
reset role;
select t.ok((select sum(on_hand) from public.stock_levels where company_id = :'co') = 7, 'stock follows the old program down');
select t.ok((:'r3'::jsonb -> 'stock' ->> 'changed') = '0', 'an unchanged quantity makes no adjustment');
select t.ok((select open_amount from public.external_documents where company_id = :'co' and ext_id = '100') = 0, 'a paid document drops to zero');
select t.ok((select pushes from public.sync_connections where company_id = :'co') = 3 and (select last_seen_at is not null from public.sync_connections where company_id = :'co'),
  'the connection records when it was last heard from');

-- a barcode that already belongs to another product does not keep the product out
set role anon;
select public.sync_push(:'key', jsonb_build_object('products',
  '[{"sku":"40001","name":"FIRST","barcode":"3800000000010","vat":"18"},{"sku":"40002","name":"SECOND","barcode":"3800000000010","vat":"18"}]'::jsonb)) as rb \gset
reset role;
select t.ok((:'rb'::jsonb -> 'products' ->> 'errors') = '0' and (select count(*) from public.product_variants where company_id = :'co' and sku in ('40001','40002')) = 2,
  'a product whose barcode is taken comes in without it');

-- bad data is reported, nothing half-done
set role anon;
select public.sync_push(:'key', jsonb_build_object('stock', '[{"warehouse":"1","sku":"33173","qty":"5"}]'::jsonb,
  'documents', '[{"ext_id":"x","kind":"bogus"}]'::jsonb)) as r4 \gset
reset role;
select t.ok(not (:'r4'::jsonb ->> 'ok')::boolean and (select last_error is not null from public.sync_connections where company_id = :'co'), 'a failing push reports its error');
select t.ok((select sum(on_hand) from public.stock_levels where company_id = :'co') = 7, 'and changes nothing');

-- real movements from the old program
set role anon;
select public.sync_push(:'key', jsonb_build_object('movements', '[
  {"ext_id":"9001","type":"C-","warehouse":"1","sku":"33173","qty":"-2","date":"2026-10-24T10:00:00","reference":"POS-77","pos":true},
  {"ext_id":"9002","type":"V+","warehouse":"1","sku":"33173","qty":"5","date":"2026-10-24T11:00:00","reference":"FB-12","cost":"0.40"},
  {"ext_id":"9003","type":"M-","warehouse":"1","sku":"33173","qty":"-1","reference":"MV-3"},
  {"ext_id":"9004","type":"M+","warehouse":"2","sku":"33173","qty":"1","reference":"MV-3"},
  {"ext_id":"9005","type":"X","warehouse":"1","sku":"NOPE","qty":"1"}]'::jsonb,
  'stock', '[{"warehouse":"1","sku":"33173","qty":"9"}]'::jsonb)) as rm \gset
select public.sync_push(:'key', jsonb_build_object('movements', '[{"ext_id":"9001","type":"C-","warehouse":"1","sku":"33173","qty":"-2"}]'::jsonb)) as rm2 \gset
select public.sync_push(:'key', jsonb_build_object('movements', '[{"ext_id":"9006","type":"FD","warehouse":"1","sku":"33173","qty":"-1","reference":"FD-1"}]'::jsonb,
  'stock', '[{"warehouse":"1","sku":"33173","qty":"8"}]'::jsonb)) as rfd \gset
reset role;
select t.ok((select movement_type from public.stock_movements where company_id = :'co' and external_ref = 'LM:9006') = 'pos_sale'
  and (:'rfd'::jsonb -> 'stock' ->> 'changed') = '0', 'a till sale written as FD is a till sale, and the stock needs no correction');
select t.ok((:'rm'::jsonb -> 'movements' ->> 'recorded')::int = 4 and (:'rm'::jsonb -> 'movements' ->> 'unknown_items')::int = 1, 'movements arrive with their own type');
select t.ok((:'rm'::jsonb -> 'stock' ->> 'changed') = '0', 'the quantity check finds nothing left to correct');
select t.ok((:'rm2'::jsonb -> 'movements' ->> 'already')::int = 1, 'a movement sent twice is recorded once');
select t.ok((select string_agg(movement_type || ':' || reference, ',' order by external_ref) from public.stock_movements where company_id = :'co' and external_ref like 'LM:%')
            = 'pos_sale:POS-77,receipt:FB-12,transfer:MV-3,transfer:MV-3,pos_sale:FD-1', 'sale, receipt and transfer, each with its document');
select t.ok(not exists (select 1 from public.stock_movements where company_id = :'co' and external_ref like 'LM:%' and journal_entry_id is not null), 'mirrored movements stay out of the books');

-- stock per store for the dashboard
set role authenticated;
select t.login('live@lider.xk');
select public.stock_by_warehouse(:'co') as sbw \gset
select public.history_live(:'co') as hl \gset
reset role;
select t.ok((select quantity = 1 and amount > 0 from public.sync_till_sales where company_id = :'co' and ext_id = '9006')
  and (:'hl'::jsonb ->> 'today')::numeric = (select amount from public.sync_till_sales where company_id = :'co' and ext_id = '9006')
  and (:'hl'::jsonb -> 'by_store' -> 0 ->> 'from_exits')::boolean, 'a till that writes only stock exits still shows its sales today');
select t.ok((select (e ->> 'items')::int = 1 and (e ->> 'value')::numeric > 0 from jsonb_array_elements(:'sbw'::jsonb) e where e ->> 'code' = '1'),
  'stock by store shows the items and value of each store');
select t.ok((select count(*) from jsonb_array_elements(:'sbw'::jsonb)) >= 2, 'every active store is listed, also empty ones');

-- switched off
set role authenticated;
select t.login('zoe@platform.io');
select public.sync_set_active((select id from public.sync_connections where company_id = :'co'), false);
reset role;
set role anon;
select t.throws($$ select public.sync_push('$$ || :'key' || $$', '{}') $$, 'switched-off', 'a switched-off key is refused');
reset role;

-- type of business
set role authenticated;
select t.login('zoe@platform.io');
select public.platform_create_client(jsonb_build_object('name', 'Kafe Test', 'country', 'XK', 'owner_email', 'kafe@test.xk',
  'owner_password', 'sekret123', 'business_type', 'cafe')) as cafe \gset
select t.ok((select business_type = 'cafe' from public.companies where id = :'cafe'), 'a new client gets its type of business');
select t.ok((select 'Manufacturing' = any(hidden_menu_sections) and 'Sales & CRM' = any(hidden_menu_sections) and not 'Retail' = any(hidden_menu_sections)
               from public.company_settings where company_id = :'cafe'), 'a café starts without manufacturing and sales pipeline, but with the till');
select public.platform_set_business_type(:'cafe', 'wholesale');
select t.ok((select 'Retail' = any(hidden_menu_sections) and not 'Sales & CRM' = any(hidden_menu_sections) from public.company_settings where company_id = :'cafe'),
  'changing the type changes the menu');
select t.ok((select c -> 'business_type' = '"wholesale"' from jsonb_array_elements(public.platform_clients() -> 'clients') c where c ->> 'id' = :'cafe'), 'the client list shows the type');
select t.throws($$ select public.platform_set_business_type('$$ || :'cafe' || $$', 'casino') $$, 'Unknown type', 'only known types');
select t.login('kafe@test.xk');
select t.ok((public.get_my_context() -> 'companies' -> 0 ->> 'business_type') = 'wholesale', 'the app knows the type');
select t.throws($$ select public.platform_set_business_type('$$ || :'cafe' || $$', 'retail') $$, 'platform', 'clients cannot change their own type');
reset role;


-- the agent's log, heartbeat and outage alerts
update public.sync_connections set is_active = true where company_id = :'co';
set role anon;
select public.sync_log(:'key', '[{"level":"ok","msg":"U dërguan: stok 3"},{"level":"warn","msg":"Kujdes"},{"level":"bogus","msg":"x"},{"msg":""}]'::jsonb, '2.4') as lg \gset
reset role;
select t.ok((:'lg'::jsonb ->> 'saved')::int = 3 and (select agent_version from public.sync_connections where company_id = :'co' limit 1) = '2.4', 'the agent''s log lines arrive');
update public.sync_connections set last_seen_at = now() - interval '25 minutes' where company_id = :'co';
select public.check_sync_health() as hc \gset
select t.ok(:hc >= 1 and (select down_since is not null from public.sync_connections where company_id = :'co' limit 1), 'a link silent for 10 minutes is marked as stopped');
select t.ok(exists (select 1 from public.notifications where company_id = :'co' and type = 'alert' and title like 'Live link stopped:%'), 'and the admins are told');
select t.ok(public.check_sync_health() = 0, 'told once, not every 5 minutes');
set role anon;
select public.sync_log(:'key') as hb \gset
reset role;
select t.ok((select down_since is null and last_seen_at > now() - interval '1 minute' from public.sync_connections where company_id = :'co' limit 1)
  and exists (select 1 from public.notifications where company_id = :'co' and title like 'Live link back:%'), 'a heartbeat closes the outage and says it is back');
set role authenticated;
select t.login('live@lider.xk');
select t.ok(jsonb_array_length(public.sync_agent_log((select id from public.sync_connections where company_id = :'co' limit 1), 'problems')) = 1, 'the admin reads the log, problems only');
reset role;

-- a customer's standing discount from the old program
set role anon;
select public.sync_push(:'key', jsonb_build_object('partners', '[{"code":"1001","name":"Viva Fresh","role":"customer","discount_pct":"5"}]'::jsonb));
reset role;
select t.ok((select default_discount_pct from public.business_partners where company_id = :'co' and code = '1001') = 5, 'the customer''s discount arrives');
set role anon;
select public.sync_push(:'key', jsonb_build_object('partners', '[{"code":"1001","name":"Viva Fresh","role":"customer"}]'::jsonb));
reset role;
select t.ok((select default_discount_pct from public.business_partners where company_id = :'co' and code = '1001') = 5, 'a row without the discount keeps it');
set role anon;
select public.sync_push(:'key', jsonb_build_object('partners', '[{"code":"1001","name":"Viva Fresh","role":"customer","discount_pct":"0"}]'::jsonb));
reset role;
select t.ok((select default_discount_pct from public.business_partners where company_id = :'co' and code = '1001') = 0, 'and a discount taken away is cleared');

\set QUIET off
select count(*) as assertions_passed from t.results;
