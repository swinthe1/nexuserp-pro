-- =============================================================================
-- DrisPRO · public prices and webhooks (runs after 01–38)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

set role anon;
select t.ok(jsonb_array_length(public.public_pricing() -> 'plans') = 3, 'anyone sees the plans');
set role authenticated;
select t.login('alice@alba.al');
select t.throws($q$select public.platform_pricing_save('{"plans":[{"plan":"basic","price_month":1}]}')$q$, 'platform administrator', 'only the platform owner sets prices');
select t.login('zoe@platform.io');
select public.platform_pricing_save('{"plans":[{"plan":"standard","price_month":"39","price_year":"390","users":"5","highlight":true}],"contact":{"email":"info@dris-ks.com"}}');
set role anon;
select t.ok((select (x ->> 'price_month')::numeric = 39 from jsonb_array_elements(public.public_pricing() -> 'plans') x where x ->> 'plan' = 'standard')
        and public.public_pricing() #>> '{contact,email}' = 'info@dris-ks.com', 'the public page shows the prices set');

-- webhooks
set role authenticated;
select t.login('zoe@platform.io');
select public.platform_create_client(jsonb_build_object('name', 'Hook Test', 'country', 'XK', 'owner_email', 'alice@alba.al', 'plan', 'pro', 'max_users', 10,
  'valid_until', (current_date + 365)::text)) as co \gset
select t.login('alice@alba.al');
select t.throws(format($q$select public.webhook_create(%L, 'ftp://x', array['invoice.posted'])$q$, :'co'), 'full address', 'only web addresses');
select t.throws(format($q$select public.webhook_create(%L, 'https://hooks.example.com/x', array['made.up'])$q$, :'co'), 'Choose what to send', 'only known events');
select public.webhook_create(:'co', 'https://hooks.example.com/x', array['partner.created', 'invoice.posted']) as wh \gset
select t.ok((:'wh'::jsonb ->> 'secret') like 'whsec_%', 'the secret is given once');
select t.ok(not (public.webhooks_list(:'co') -> 0 ? 'secret') and (public.webhooks_list(:'co') -> 0 ->> 'secret_hint') like 'whsec_%…', 'the list never shows the secret again');
reset role;
insert into public.business_partners (company_id, code, name, is_customer) values (:'co', 'H1', 'Klienti Hook', true) returning id as cust \gset
select t.ok((select count(*) from app.webhook_deliveries d join app.webhooks w on w.id = d.webhook_id where w.company_id = :'co' and d.event = 'partner.created'
               and d.payload #>> '{data,name}' = 'Klienti Hook') = 1, 'a new client sends partner.created');
insert into public.sales_invoices (company_id, partner_id, currency_code, invoice_date, due_date) values (:'co', :'cust', 'EUR', current_date, current_date) returning id as inv \gset
insert into public.sales_invoice_lines (company_id, invoice_id, line_no, description, quantity, unit_price, tax_code_id)
  values (:'co', :'inv', 1, 'Shërbim', 1, 100, (select id from public.tax_codes where company_id = :'co' and code = 'EXEMPT'));
select set_config('request.jwt.claim.sub', (select id::text from auth.users where email = 'alice@alba.al'), false);
select public.post_sales_invoice(:'inv');
select t.ok((select (d.payload #>> '{data,total}')::numeric = 100 from app.webhook_deliveries d join app.webhooks w on w.id = d.webhook_id
               where w.company_id = :'co' and d.event = 'invoice.posted'), 'posting an invoice sends invoice.posted with its totals');
-- the postier
select set_config('request.jwt.claim.sub', '', false);
select public.postier_webhook_claim() as batch \gset
select t.ok(jsonb_array_length(:'batch') >= 2 and (:'batch'::jsonb -> 0 ->> 'secret') like 'whsec_%', 'the postier gets the messages with the address and the secret');
select public.postier_webhook_done((x ->> 'id')::uuid, true, 200) from jsonb_array_elements(:'batch'::jsonb) x;
select t.ok((select failures = 0 and last_status = 200 from app.webhooks where company_id = :'co'), 'delivered');
update app.webhooks set failures = 49 where company_id = :'co';
insert into app.webhook_deliveries (webhook_id, event, payload) select id, 'webhook.test', '{}' from app.webhooks where company_id = :'co' returning id as d1 \gset
select public.postier_webhook_done(:'d1', false, 500, '500 Internal Server Error');
select t.ok((select not is_active from app.webhooks where company_id = :'co')
        and exists (select 1 from public.notifications where company_id = :'co' and title like 'A webhook was switched off%'), 'fifty failures in a row switch it off and the admins are told');
set role authenticated;
select t.login('alice@alba.al');
select t.throws($q$select public.postier_webhook_claim()$q$, 'permission denied', 'only the server sends them');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
