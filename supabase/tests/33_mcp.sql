-- =============================================================================
-- DrisPRO · inside ChatGPT and Claude: personal links and the protocol (runs after 01–32)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

set role authenticated;
select t.login('zoe@platform.io');
select public.platform_create_client(jsonb_build_object('name', 'MCP Test', 'country', 'XK', 'owner_email', 'alice@alba.al', 'plan', 'pro', 'max_users', 10,
  'valid_until', (current_date + 365)::text)) as co \gset
select t.throws(format($q$select public.ai_connector_create(%L)$q$, :'co'), 'not a member', 'only a member makes a link for the company');
select t.login('alice@alba.al');
select id as pcs from public.units_of_measure where company_id = :'co' and code = 'pcs' \gset
select id as vat from public.tax_codes where company_id = :'co' and rate > 0 and deleted_at is null order by rate desc limit 1 \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'UJE', 'name', 'Ujë Rugove 1.5 L', 'uom_id', :'pcs', 'sales_price', 0.60, 'sales_tax_code_id', :'vat')) as p \gset
insert into public.business_partners (company_id, code, name, is_customer, is_vendor) values (:'co', 'C1', 'Viva Fresh', true, false), (:'co', 'V1', 'Rugove Water', false, true);

select public.ai_connector_create(:'co') ->> 'key' as rk \gset
select public.ai_connector_create(:'co', true) ->> 'key' as wk \gset
select t.ok(:'rk' like 'nxm\_%' and jsonb_array_length(public.ai_connectors(:'co')) = 2, 'a person makes their own links and sees them');
select auth.uid() as me \gset
reset role;
select t.ok((select run_as from public.api_keys where key_hash = encode(extensions.digest(:'rk', 'sha256'), 'hex')) = :'me', 'a link acts as the person who made it');

-- the protocol, as the web server hands it over
set role anon;
select set_config('request.headers', json_build_object('x-mcp-key', :'rk', 'x-app-origin', 'https://erp.test')::text, false);
select t.ok(public.mcp_http('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}') #>> '{result,serverInfo,title}' = 'DrisPRO · MCP Test', 'initialize names the company');
select t.ok(public.mcp_http('{"jsonrpc":"2.0","method":"notifications/initialized"}') is null, 'notifications get no answer');
select t.ok(jsonb_array_length(public.mcp_http('{"jsonrpc":"2.0","id":2,"method":"tools/list"}') #> '{result,tools}') = 8, 'a reading link lists only the reading tools');
select public.mcp_http('{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"find_items","arguments":{"query":"Rugove"}}}') #>> '{result,content,0,text}' as items \gset
select t.ok(:'items' like '%Ujë Rugove%' and :'items' like '%https://erp.test/inventory/products/%', 'tools answer with links to the app');
select t.ok((public.mcp_http('{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"draft_sales_invoice","arguments":{"customer":"Viva","lines":[{"item":"UJE","quantity":2}]}}}') #>> '{result,isError}')::boolean,
  'a reading link may not prepare drafts');
select t.ok(public.mcp_http('{"jsonrpc":"2.0","id":5,"method":"nothing"}') #>> '{error,code}' = '-32601', 'an unknown method is an error');
select t.ok(public.mcp_http('[{"jsonrpc":"2.0","id":6,"method":"ping"},{"jsonrpc":"2.0","method":"notifications/x"}]') = '[{"id": 6, "result": {}, "jsonrpc": "2.0"}]', 'a list of messages gets a list of answers');

select set_config('request.headers', json_build_object('x-mcp-key', :'wk')::text, false);
select t.ok(jsonb_array_length(public.mcp_http('{"jsonrpc":"2.0","id":7,"method":"tools/list"}') #> '{result,tools}') = 10, 'a drafting link also lists the two drafts');
select (public.mcp_http('{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"draft_sales_invoice","arguments":{"customer":"Viva","lines":[{"item":"UJE","quantity":10},{"item":"Transport","quantity":1,"price":5}]}}}') #>> '{result,content,0,text}')::jsonb as inv \gset
reset role;
select t.ok((select status from public.sales_invoices where id = (:'inv'::jsonb ->> 'id')::uuid) = 'draft'
        and (select count(*) from public.sales_invoice_lines where invoice_id = (:'inv'::jsonb ->> 'id')::uuid) = 2
        and (:'inv'::jsonb ->> 'net')::numeric = 11, 'the invoice is a draft with the company''s prices and a free line');
set role anon;
select t.ok(public.mcp_http('{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"draft_purchase_order","arguments":{"vendor":"Rugove","lines":[{"item":"Ujë Rugove 1.5 L","quantity":100}]}}}') #>> '{result,content,0,text}' like '%PO-%',
  'a purchase order draft has its number');
select t.ok(public.mcp_http('{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"draft_sales_invoice","arguments":{"customer":"Nobody","lines":[{"item":"UJE","quantity":1}]}}}') #>> '{result,content,0,text}' like 'No customer%',
  'an unknown customer is said, not guessed');

-- switched off, it stops at once
set role authenticated;
select t.login('alice@alba.al');
select (public.ai_connectors(:'co') -> 0 ->> 'id') as wid \gset
select public.ai_connector_revoke(:'wid');
set role anon;
select t.ok(public.mcp_http('{"jsonrpc":"2.0","id":11,"method":"tools/list"}') #>> '{error,code}' = '-32001', 'a removed link no longer works');
select set_config('request.headers', '{}', false);
reset role;
\set QUIET off
select count(*) as assertions_passed from t.results;
