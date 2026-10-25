-- =============================================================================
-- DrisPRO · the assistant, phase 1: questions in Albanian, answered from the company's data
--   A person writes from any screen; the postier hands the conversation to Claude with a set of
--   tools. Each tool is an ordinary DrisPRO function, called WITH THAT PERSON'S IDENTITY (the
--   worker signs a short-lived token for them), so every permission and row rule applies exactly
--   as on their screen. Phase 1 only reads: nothing is created, changed or sent.
--   Each company has a monthly number of questions by plan (Trial 30, Basic 150, Standard 600,
--   Pro 2000) that the platform owner can change per client; every answer keeps its tokens.
--   A local server's conversation goes to the cloud through its licence for the AI part only;
--   the tools run on the local server.
-- =============================================================================

create table app.assistant_conversations (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  user_id     uuid not null,
  title       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index assistant_conversations_user_idx on app.assistant_conversations (company_id, user_id, updated_at desc);

create table app.assistant_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references app.assistant_conversations(id) on delete cascade,
  role            text not null check (role in ('user', 'assistant')),
  content         text not null,
  tools           jsonb,
  input_tokens    int,
  output_tokens   int,
  model           text,
  created_at      timestamptz not null default now()
);
create index assistant_messages_conv_idx on app.assistant_messages (conversation_id, created_at);

create table app.assistant_jobs (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references app.assistant_conversations(id) on delete cascade,
  company_id      uuid not null,
  user_id         uuid not null,
  context         jsonb,
  status          text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  step            text,
  error           text,
  created_at      timestamptz not null default now(),
  started_at      timestamptz,
  finished_at     timestamptz
);
create index assistant_jobs_due_idx on app.assistant_jobs (created_at) where status = 'queued';
revoke all on app.assistant_conversations, app.assistant_messages, app.assistant_jobs from public, anon, authenticated;

-- ---------------------------------------------------------------- the monthly number of questions
alter table public.licenses add column ai_chat_limit int check (ai_chat_limit is null or ai_chat_limit >= 0);
grant select (ai_chat_limit) on public.licenses to authenticated;

create or replace function app.plan_ai_chat(p_plan text)
returns int language sql immutable set search_path = '' as $$
  select case p_plan when 'trial' then 30 when 'basic' then 150 when 'standard' then 600 else 2000 end
$$;
create or replace function app.ai_chat_limit(p_company uuid)
returns int language sql stable security definer set search_path = '' as $$
  select coalesce((select coalesce(l.ai_chat_limit, app.plan_ai_chat(l.plan)) from public.licenses l where l.company_id = p_company), app.plan_ai_chat('pro'))
$$;
create or replace function app.ai_chat_used(p_company uuid)
returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int from app.assistant_messages m join app.assistant_conversations c on c.id = m.conversation_id
   where c.company_id = p_company and m.role = 'user'
     and m.created_at >= (date_trunc('month', now() at time zone coalesce((select timezone from public.companies where id = p_company), 'Europe/Tirane'))
                          at time zone coalesce((select timezone from public.companies where id = p_company), 'Europe/Tirane'))
$$;

-- ---------------------------------------------------------------- for the person
create or replace function public.assistant_send(p_company uuid, p_conversation uuid, p_text text, p_context jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_conv uuid := p_conversation; v_job uuid; v_limit int;
begin
  perform app.require_permission(p_company, 'core.read');
  if auth.uid() is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if coalesce(btrim(p_text), '') = '' then raise exception 'Write a question' using errcode = '22023'; end if;
  if length(p_text) > 4000 then raise exception 'The question is too long; write it in at most 4000 characters' using errcode = '22023'; end if;
  v_limit := app.ai_chat_limit(p_company);
  if app.ai_chat_used(p_company) >= v_limit then
    raise exception 'This company has asked % questions this month, the limit of its plan; the assistant starts again on the 1st', v_limit using errcode = '54000';
  end if;
  if v_conv is null then
    insert into app.assistant_conversations (company_id, user_id, title) values (p_company, auth.uid(), left(btrim(p_text), 80)) returning id into v_conv;
  elsif not exists (select 1 from app.assistant_conversations where id = v_conv and company_id = p_company and user_id = auth.uid()) then
    raise exception 'Conversation not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from app.assistant_jobs where conversation_id = v_conv and status in ('queued', 'running')) then
    raise exception 'Wait for the answer to the last question' using errcode = '55000';
  end if;
  insert into app.assistant_messages (conversation_id, role, content) values (v_conv, 'user', btrim(p_text));
  insert into app.assistant_jobs (conversation_id, company_id, user_id, context) values (v_conv, p_company, auth.uid(), p_context) returning id into v_job;
  update app.assistant_conversations set updated_at = now() where id = v_conv;
  return jsonb_build_object('conversation_id', v_conv, 'job_id', v_job);
end $$;
grant execute on function public.assistant_send(uuid, uuid, text, jsonb) to authenticated;

create or replace function public.assistant_state(p_conversation uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c app.assistant_conversations; j app.assistant_jobs;
begin
  select * into c from app.assistant_conversations where id = p_conversation and user_id = auth.uid();
  if c.id is null then raise exception 'Conversation not found' using errcode = 'P0002'; end if;
  select * into j from app.assistant_jobs where conversation_id = c.id order by created_at desc limit 1;
  return jsonb_build_object('id', c.id, 'title', c.title,
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'role', m.role, 'content', m.content, 'created_at', m.created_at) order by m.created_at)
                           from app.assistant_messages m where m.conversation_id = c.id), '[]'::jsonb),
    'job', case when j.id is not null then jsonb_build_object('id', j.id, 'status', j.status, 'step', j.step, 'error', j.error) end);
end $$;
grant execute on function public.assistant_state(uuid) to authenticated;

create or replace function public.assistant_conversations(p_company uuid)
returns table (id uuid, title text, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.id, c.title, c.updated_at from app.assistant_conversations c
   where c.company_id = p_company and c.user_id = auth.uid() order by c.updated_at desc limit 30
$$;
grant execute on function public.assistant_conversations(uuid) to authenticated;

create or replace function public.assistant_forget(p_conversation uuid)
returns void language sql security definer set search_path = '' as $$
  delete from app.assistant_conversations where id = p_conversation and user_id = auth.uid()
$$;
grant execute on function public.assistant_forget(uuid) to authenticated;

create or replace function public.assistant_usage(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'core.read');
  return jsonb_build_object('used', app.ai_chat_used(p_company), 'limit', app.ai_chat_limit(p_company));
end $$;
grant execute on function public.assistant_usage(uuid) to authenticated;

-- ---------------------------------------------------------------- the tools (each one checks the person's permission itself)
-- an item: price with VAT, cost, margin, stock per warehouse, what is coming, who supplies it
create or replace function public.ai_find_items(p_company uuid, p_query text, p_limit int default 8)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_pat text := '%' || replace(replace(btrim(coalesce(p_query, '')), '%', '\%'), '_', '\_') || '%';
begin
  perform app.require_permission(p_company, 'inventory.read');
  return coalesce((select jsonb_agg(x) from (
    select jsonb_build_object(
      'sku', v.sku, 'name', v.name, 'category', c.name, 'href', '/inventory/products/' || p.id,
      'price_with_vat', round(coalesce(v.sales_price_override, p.sales_price) * (1 + coalesce(t.rate, 0) / 100), 2),
      'avg_cost', round(ic.avg_cost, 2),
      'margin_pct', case when coalesce(v.sales_price_override, p.sales_price) > 0 and ic.avg_cost is not null
                         then round(100 * (coalesce(v.sales_price_override, p.sales_price) - ic.avg_cost) / coalesce(v.sales_price_override, p.sales_price), 1) end,
      'stock', coalesce((select jsonb_agg(jsonb_build_object('warehouse', w.warehouse_name, 'on_hand', w.on_hand, 'reserved', w.reserved, 'available', w.available))
                           from (select s.warehouse_name, sum(s.on_hand) as on_hand, sum(s.reserved) as reserved, sum(s.available) as available
                                   from public.v_stock_levels s where s.variant_id = v.id group by s.warehouse_name) w), '[]'::jsonb),
      'incoming', (select sum(l.quantity - l.qty_received) from public.purchase_order_lines l join public.purchase_orders po on po.id = l.purchase_order_id
                    where l.variant_id = v.id and po.status in ('approved', 'sent', 'partially_received') and po.deleted_at is null),
      'vendors', (select jsonb_agg(jsonb_build_object('vendor', bp.name, 'code', vp.vendor_sku, 'price', vp.price, 'preferred', vp.is_preferred))
                    from public.vendor_products vp join public.business_partners bp on bp.id = vp.vendor_id where vp.variant_id = v.id and vp.deleted_at is null),
      'last_price_change', (select jsonb_build_object('on', pc.changed_on, 'from', pc.old_price, 'to', pc.new_price)
                              from public.price_changes pc where pc.variant_id = v.id order by pc.changed_on desc, pc.created_at desc limit 1)) as x
      from public.product_variants v join public.products p on p.id = v.product_id
      left join public.product_categories c on c.id = p.category_id
      left join public.tax_codes t on t.id = p.sales_tax_code_id
      left join public.item_costs ic on ic.variant_id = v.id
     where v.company_id = p_company and v.deleted_at is null and p.deleted_at is null
       and (v.name ilike v_pat or v.sku ilike v_pat or exists (select 1 from public.product_barcodes b where b.variant_id = v.id and b.barcode = btrim(p_query) and b.deleted_at is null))
     order by (v.sku ilike btrim(p_query)) desc, v.name limit least(coalesce(p_limit, 8), 20)) q), '[]'::jsonb);
end $$;
grant execute on function public.ai_find_items(uuid, text, int) to authenticated;

-- a customer's or vendor's open documents, how late, and the last payment
create or replace function public.ai_partner_balance(p_company uuid, p_query text, p_side text default 'customer')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_pat text := '%' || replace(replace(btrim(coalesce(p_query, '')), '%', '\%'), '_', '\_') || '%';
begin
  if p_side = 'vendor' then perform app.require_permission(p_company, 'procurement.read'); else perform app.require_permission(p_company, 'invoicing.read'); end if;
  return coalesce((select jsonb_agg(x) from (
    select jsonb_build_object('name', bp.name, 'code', bp.code, 'href', '/partners/' || bp.id, 'email', bp.email, 'phone', bp.phone, 'credit_limit', bp.credit_limit,
      'open', coalesce(case when p_side = 'vendor' then
          (select jsonb_agg(jsonb_build_object('number', b.number, 'vendor_number', b.vendor_invoice_number, 'date', b.bill_date, 'due', b.due_date,
                    'days_late', greatest(current_date - b.due_date, 0), 'amount_due', b.amount_due, 'currency', b.currency_code, 'href', '/procurement/bills/' || b.id) order by b.due_date)
             from public.vendor_bills b where b.vendor_id = bp.id and b.status = 'posted' and b.deleted_at is null and b.payment_status <> 'paid' and b.amount_due > 0)
        else
          (select jsonb_agg(jsonb_build_object('number', i.number, 'date', i.invoice_date, 'due', i.due_date, 'days_late', greatest(current_date - i.due_date, 0),
                    'amount_due', i.amount_due, 'currency', i.currency_code, 'href', '/sales/invoices/' || i.id) order by i.due_date)
             from public.sales_invoices i where i.partner_id = bp.id and i.status = 'posted' and i.deleted_at is null and i.document_type = 'sales_invoice'
              and i.payment_status <> 'paid' and i.amount_due > 0) end, '[]'::jsonb),
      'last_payment', (select jsonb_build_object('date', p.payment_date, 'amount', p.amount, 'number', p.number) from public.payments p
                        where p.partner_id = bp.id and p.status = 'posted' and p.deleted_at is null
                          and p.document_type = case when p_side = 'vendor' then 'vendor_payment' else 'customer_payment' end
                        order by p.payment_date desc limit 1)) as x
      from public.business_partners bp
     where bp.company_id = p_company and bp.deleted_at is null and (case when p_side = 'vendor' then bp.is_vendor else bp.is_customer end)
       and (bp.name ilike v_pat or bp.code ilike v_pat or bp.tax_number = btrim(p_query))
     order by extensions.similarity(lower(bp.name), lower(btrim(p_query))) desc limit 3) q), '[]'::jsonb);
end $$;
grant execute on function public.ai_partner_balance(uuid, text, text) to authenticated;

-- a document by its number: what it is, its state and its lines
create or replace function public.ai_find_document(p_company uuid, p_number text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare n text := upper(btrim(coalesce(p_number, ''))); v jsonb;
begin
  if length(n) < 3 then raise exception 'Give at least 3 characters of the number' using errcode = '22023'; end if;
  if app.has_permission(p_company, 'invoicing.read') then
    select jsonb_build_object('kind', i.document_type, 'number', i.number, 'status', i.status, 'payment_status', i.payment_status, 'date', i.invoice_date, 'due', i.due_date,
      'partner', bp.name, 'total', i.total, 'amount_due', i.amount_due, 'currency', i.currency_code, 'href', '/sales/invoices/' || i.id,
      'lines', (select jsonb_agg(jsonb_build_object('item', l.description, 'qty', l.quantity, 'price', l.unit_price, 'discount_pct', l.discount_pct, 'total', l.line_total) order by l.line_no)
                  from public.sales_invoice_lines l where l.invoice_id = i.id))
      into v from public.sales_invoices i join public.business_partners bp on bp.id = i.partner_id
     where i.company_id = p_company and i.deleted_at is null and upper(i.number) = n;
    if v is not null then return v; end if;
  end if;
  if app.has_permission(p_company, 'sales.read') then
    select jsonb_build_object('kind', 'sales_order', 'number', o.number, 'status', o.status, 'date', o.order_date, 'partner', bp.name, 'total', o.total, 'currency', o.currency_code,
      'href', '/sales/orders/' || o.id,
      'lines', (select jsonb_agg(jsonb_build_object('item', l.description, 'qty', l.quantity, 'delivered', l.qty_delivered, 'invoiced', l.qty_invoiced, 'price', l.unit_price) order by l.line_no)
                  from public.sales_order_lines l where l.sales_order_id = o.id))
      into v from public.sales_orders o join public.business_partners bp on bp.id = o.partner_id
     where o.company_id = p_company and o.deleted_at is null and upper(o.number) = n;
    if v is not null then return v; end if;
  end if;
  if app.has_permission(p_company, 'procurement.read') then
    select jsonb_build_object('kind', 'purchase_order', 'number', o.number, 'status', o.status, 'date', o.order_date, 'expected', o.expected_date, 'vendor', bp.name, 'total', o.total,
      'currency', o.currency_code, 'href', '/procurement/orders/' || o.id,
      'lines', (select jsonb_agg(jsonb_build_object('item', l.description, 'qty', l.quantity, 'received', l.qty_received, 'price', l.unit_price) order by l.line_no)
                  from public.purchase_order_lines l where l.purchase_order_id = o.id))
      into v from public.purchase_orders o join public.business_partners bp on bp.id = o.vendor_id
     where o.company_id = p_company and o.deleted_at is null and upper(o.number) = n;
    if v is not null then return v; end if;
    select jsonb_build_object('kind', b.document_type, 'number', b.number, 'vendor_number', b.vendor_invoice_number, 'status', b.status, 'payment_status', b.payment_status,
      'date', b.bill_date, 'due', b.due_date, 'vendor', bp.name, 'total', b.total, 'amount_due', b.amount_due, 'currency', b.currency_code, 'href', '/procurement/bills/' || b.id)
      into v from public.vendor_bills b join public.business_partners bp on bp.id = b.vendor_id
     where b.company_id = p_company and b.deleted_at is null and (upper(b.number) = n or upper(b.vendor_invoice_number) = n) limit 1;
    if v is not null then return v; end if;
  end if;
  if app.has_permission(p_company, 'inventory.read') then
    select jsonb_build_object('kind', 'goods_receipt', 'number', g.number, 'status', g.status, 'date', g.receipt_date, 'vendor', bp.name, 'vendor_note', g.vendor_delivery_note,
      'href', '/inventory/receipts/' || g.id,
      'lines', (select jsonb_agg(jsonb_build_object('item', v2.name, 'qty', l.quantity, 'unit_cost', l.unit_cost)) from public.goods_receipt_lines l join public.product_variants v2 on v2.id = l.variant_id where l.receipt_id = g.id))
      into v from public.goods_receipts g left join public.business_partners bp on bp.id = g.vendor_id
     where g.company_id = p_company and g.deleted_at is null and (upper(g.number) = n or upper(g.vendor_delivery_note) = n) limit 1;
    if v is not null then return v; end if;
  end if;
  if app.has_permission(p_company, 'pos.read') then
    select jsonb_build_object('kind', 'pos_receipt', 'number', o.number, 'status', o.status, 'at', o.order_at, 'total', o.total, 'refund', o.is_refund,
      'lines', (select jsonb_agg(jsonb_build_object('item', l.description, 'qty', l.quantity, 'total', l.line_total)) from public.pos_order_lines l where l.pos_order_id = o.id))
      into v from public.pos_orders o where o.company_id = p_company and o.deleted_at is null and (upper(o.number) = n or upper(o.device_ref) = n) limit 1;
    if v is not null then return v; end if;
  end if;
  return jsonb_build_object('found', false);
end $$;
grant execute on function public.ai_find_document(uuid, text) to authenticated;

create or replace function public.ai_low_stock(p_company uuid, p_limit int default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'inventory.read');
  return coalesce((select jsonb_agg(jsonb_build_object('sku', l.sku, 'item', l.variant_name, 'warehouse', l.warehouse_name, 'available', l.available, 'reorder_at', l.min_qty,
            'incoming', l.incoming, 'suggested_order', l.suggested_qty, 'vendor', l.preferred_vendor_name, 'href', '/inventory/products/' || l.product_id))
    from (select * from public.v_low_stock where company_id = p_company order by available - min_qty limit least(coalesce(p_limit, 30), 60)) l), '[]'::jsonb);
end $$;
grant execute on function public.ai_low_stock(uuid, int) to authenticated;

-- ---------------------------------------------------------------- for the worker only
-- the next question (waits up to p_wait_ms for one): the conversation, the person and what they may see
create or replace function public.assistant_wait(p_wait_ms int default 8000)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare j app.assistant_jobs; v_until timestamptz := clock_timestamp() + make_interval(secs => least(coalesce(p_wait_ms, 8000), 20000) / 1000.0);
  co public.companies; pr public.profiles;
begin
  if auth.uid() is not null then raise exception 'Only the server runs this' using errcode = '42501'; end if;
  loop
    select * into j from app.assistant_jobs where status = 'queued' order by created_at limit 1 for update skip locked;
    exit when j.id is not null or clock_timestamp() > v_until;
    perform pg_sleep(0.25);
  end loop;
  if j.id is null then return null; end if;
  update app.assistant_jobs set status = 'running', started_at = now(), step = 'thinking' where id = j.id;
  select * into co from public.companies where id = j.company_id;
  select * into pr from public.profiles where id = j.user_id;
  return jsonb_build_object('job', j.id, 'conversation', j.conversation_id, 'company_id', j.company_id, 'user_id', j.user_id, 'context', j.context,
    'company', jsonb_build_object('name', co.name, 'currency', co.base_currency, 'country', co.country_code, 'timezone', coalesce(co.timezone, 'Europe/Tirane'),
                                  'today', (now() at time zone coalesce(co.timezone, 'Europe/Tirane'))::date, 'business_type', co.business_type),
    'person', jsonb_build_object('name', coalesce(pr.full_name, pr.email),
      'roles', (select jsonb_agg(distinct r.name) from public.company_members m join public.member_roles mr on mr.member_id = m.id join public.roles r on r.id = mr.role_id
                 where m.company_id = j.company_id and m.user_id = j.user_id),
      'permissions', (select jsonb_agg(distinct rp.permission) from public.company_members m join public.member_roles mr on mr.member_id = m.id
                        join public.role_permissions rp on rp.role_id = mr.role_id where m.company_id = j.company_id and m.user_id = j.user_id and m.status = 'active')),
    'messages', (select jsonb_agg(jsonb_build_object('role', x.role, 'content', x.content) order by x.created_at)
                   from (select * from app.assistant_messages where conversation_id = j.conversation_id order by created_at desc limit 20) x));
end $$;
revoke execute on function public.assistant_wait(int) from public, anon, authenticated;
grant execute on function public.assistant_wait(int) to service_role;

create or replace function public.assistant_step(p_job uuid, p_step text)
returns void language sql security definer set search_path = '' as $$
  update app.assistant_jobs set step = left(p_step, 60) where id = p_job and status = 'running' and auth.uid() is null
$$;
revoke execute on function public.assistant_step(uuid, text) from public, anon, authenticated;
grant execute on function public.assistant_step(uuid, text) to service_role;

create or replace function public.assistant_done(p_job uuid, p_ok boolean, p_text text default null, p_tools jsonb default null,
  p_input_tokens int default null, p_output_tokens int default null, p_model text default null, p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare j app.assistant_jobs;
begin
  if auth.uid() is not null then raise exception 'Only the server runs this' using errcode = '42501'; end if;
  update app.assistant_jobs set status = case when p_ok then 'done' else 'failed' end, finished_at = now(), error = case when p_ok then null else left(p_error, 500) end
   where id = p_job returning * into j;
  if p_ok and j.id is not null then
    insert into app.assistant_messages (conversation_id, role, content, tools, input_tokens, output_tokens, model)
    values (j.conversation_id, 'assistant', coalesce(nullif(btrim(p_text), ''), '…'), p_tools, p_input_tokens, p_output_tokens, p_model);
    update app.assistant_conversations set updated_at = now() where id = j.conversation_id;
  end if;
end $$;
revoke execute on function public.assistant_done(uuid, boolean, text, jsonb, int, int, text, text) from public, anon, authenticated;
grant execute on function public.assistant_done(uuid, boolean, text, jsonb, int, int, text, text) to service_role;

-- ---------------------------------------------------------------- a local server asks through the cloud
create table app.ai_relay (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  licence       text not null,
  request       jsonb not null,
  response      jsonb,
  status        text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  error         text,
  input_tokens  int,
  output_tokens int,
  created_at    timestamptz not null default now(),
  done_at       timestamptz
);
revoke all on app.ai_relay from public, anon, authenticated;
create index ai_relay_due_idx on app.ai_relay (created_at) where status = 'queued';

create or replace function public.licence_ai_submit(p_code text, p_server uuid, p_request jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare l public.licenses; v_id uuid; v_month int;
begin
  l := app.backup_licence(p_code, p_server);
  -- each question takes a few calls; the cloud keeps a wide safety margin over the plan's questions
  select count(*) into v_month from app.ai_relay where licence = l.code and created_at > date_trunc('month', now());
  if v_month >= 8 * app.ai_chat_limit(l.company_id) then raise exception 'This licence has used the assistant too much this month' using errcode = '54000'; end if;
  if length(p_request::text) > 400000 then raise exception 'The question is too large' using errcode = '22023'; end if;
  insert into app.ai_relay (company_id, licence, request) values (l.company_id, l.code, p_request) returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.licence_ai_submit(text, uuid, jsonb) from public;
grant execute on function public.licence_ai_submit(text, uuid, jsonb) to anon, authenticated;

create or replace function public.licence_ai_result(p_code text, p_server uuid, p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.licenses; r app.ai_relay;
begin
  l := app.backup_licence(p_code, p_server);
  select * into r from app.ai_relay where id = p_id and licence = l.code;
  if r.id is null then raise exception 'Not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('status', r.status, 'response', r.response, 'error', r.error);
end $$;
revoke execute on function public.licence_ai_result(text, uuid, uuid) from public;
grant execute on function public.licence_ai_result(text, uuid, uuid) to anon, authenticated;

create or replace function public.relay_wait(p_wait_ms int default 8000)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r app.ai_relay; v_until timestamptz := clock_timestamp() + make_interval(secs => least(coalesce(p_wait_ms, 8000), 20000) / 1000.0);
begin
  if auth.uid() is not null then raise exception 'Only the server runs this' using errcode = '42501'; end if;
  loop
    select * into r from app.ai_relay where status = 'queued' order by created_at limit 1 for update skip locked;
    exit when r.id is not null or clock_timestamp() > v_until;
    perform pg_sleep(0.25);
  end loop;
  if r.id is null then return null; end if;
  update app.ai_relay set status = 'running' where id = r.id;
  return jsonb_build_object('id', r.id, 'request', r.request);
end $$;
revoke execute on function public.relay_wait(int) from public, anon, authenticated;
grant execute on function public.relay_wait(int) to service_role;

create or replace function public.relay_done(p_id uuid, p_ok boolean, p_response jsonb default null, p_error text default null)
returns void language sql security definer set search_path = '' as $$
  update app.ai_relay set status = case when p_ok then 'done' else 'failed' end, response = p_response, error = left(p_error, 500), done_at = now(),
         input_tokens = (p_response -> 'usage' ->> 'input_tokens')::int, output_tokens = (p_response -> 'usage' ->> 'output_tokens')::int
   where id = p_id and auth.uid() is null
$$;
revoke execute on function public.relay_done(uuid, boolean, jsonb, text) from public, anon, authenticated;
grant execute on function public.relay_done(uuid, boolean, jsonb, text) to service_role;

-- a question left running by a worker that stopped is given back after two minutes
create or replace function app.assistant_cleanup()
returns void language sql security definer set search_path = '' as $$
  update app.assistant_jobs set status = 'failed', error = 'The assistant did not answer in time; ask again', finished_at = now()
   where status = 'running' and started_at < now() - interval '2 minutes';
  update app.assistant_jobs set status = 'failed', error = 'The assistant is not running on this server', finished_at = now()
   where status = 'queued' and created_at < now() - interval '2 minutes';
  -- what passed through the cloud for a local server is not kept: only its tokens stay, for the costs
  update app.ai_relay set request = '{}'::jsonb, response = null
   where created_at < now() - interval '1 hour' and request <> '{}'::jsonb;
  update app.ai_relay set status = 'failed', error = 'The assistant did not answer in time; ask again'
   where status in ('queued', 'running') and created_at < now() - interval '5 minutes';
$$;

-- ---------------------------------------------------------------- the platform owner
create or replace function public.platform_ai_chat_usage(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_super_admin();
  return jsonb_build_object('used', app.ai_chat_used(p_company), 'limit', app.ai_chat_limit(p_company),
    'override', (select ai_chat_limit from public.licenses where company_id = p_company),
    'plan_limit', app.plan_ai_chat((select plan from public.licenses where company_id = p_company)),
    'months', coalesce((select jsonb_agg(m order by m ->> 'month' desc) from (
        select jsonb_build_object('month', to_char(date_trunc('month', x.created_at), 'YYYY-MM'),
                 'questions', count(*) filter (where x.role = 'user'),
                 'cost_usd', round((coalesce(sum(x.input_tokens), 0) * 2 + coalesce(sum(x.output_tokens), 0) * 10) / 1000000.0, 2)
                           + coalesce((select round((coalesce(sum(r.input_tokens), 0) * 2 + coalesce(sum(r.output_tokens), 0) * 10) / 1000000.0, 2)
                                         from app.ai_relay r where r.company_id = p_company and date_trunc('month', r.created_at) = date_trunc('month', min(x.created_at))), 0)) as m
          from app.assistant_messages x join app.assistant_conversations c on c.id = x.conversation_id
         where c.company_id = p_company and x.created_at > now() - interval '6 months'
         group by date_trunc('month', x.created_at)) q), '[]'::jsonb));
end $$;
grant execute on function public.platform_ai_chat_usage(uuid) to authenticated;

create or replace function public.platform_set_ai_chat_limit(p_company uuid, p_limit int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_super_admin();
  update public.licenses set ai_chat_limit = p_limit where company_id = p_company;
  if not found then raise exception 'Company not found' using errcode = 'P0002'; end if;
end $$;
grant execute on function public.platform_set_ai_chat_limit(uuid, int) to authenticated;

-- the cleanup rides on the tick
create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;
select app._patch_function('public.automation_tick',
  $x$  -- the daily jobs of the other automations$x$,
  $x$  perform app.assistant_cleanup();
  -- the daily jobs of the other automations$x$);
drop function app._patch_function(text, text, text);

-- ---------------------------------------------------------------- search, with only what the person may see
-- (global_search leaves it to the row rules, which do not apply inside a definer function; here each kind asks for its permission)
create or replace function public.ai_search(p_company uuid, p_query text, p_limit int default 12)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'core.read');
  return coalesce((select jsonb_agg(jsonb_build_object('kind', s.kind, 'title', s.title, 'subtitle', s.subtitle, 'href', s.href))
    from (select * from public.global_search(p_company, p_query, 40) g
           where app.has_permission(p_company, case
             when g.kind in ('product', 'lot', 'warehouse', 'goods_receipt', 'stock_adjustment', 'stock_transfer', 'landed_cost') then 'inventory.read'
             when g.kind = 'partner' then 'partners.read'
             when g.kind = 'employee' then 'hr.read'
             when g.kind in ('account', 'journal_entry', 'fixed_asset', 'payment') then 'finance.read'
             when g.kind in ('opportunity', 'lead') then 'crm.read'
             when g.kind in ('bom', 'work_order') then 'manufacturing.read'
             when g.kind in ('vendor_bill', 'purchase_order') then 'procurement.read'
             when g.kind = 'purchase_requisition' then 'requisitions.read'
             when g.kind in ('shipment', 'delivery_route') then 'logistics.read'
             when g.kind = 'channel_order' then 'ecommerce.read'
             when g.kind in ('sales_quote', 'sales_order', 'delivery') then 'sales.read'
             when g.kind = 'sales_invoice' then 'invoicing.read'
             else 'core.admin' end)
           limit least(coalesce(p_limit, 12), 25)) s), '[]'::jsonb);
end $$;
grant execute on function public.ai_search(uuid, text, int) to authenticated;

-- ---------------------------------------------------------------- the worker calls a tool AS the person who asked
create or replace function public.assistant_tool(p_job uuid, p_name text, p_input jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare j app.assistant_jobs; i jsonb := coalesce(p_input, '{}'); v jsonb; v_rows int;
  o_sub text := current_setting('request.jwt.claim.sub', true); o_claims text := current_setting('request.jwt.claims', true);
  o_role text := current_setting('request.jwt.claim.role', true);
begin
  if auth.uid() is not null then raise exception 'Only the server runs this' using errcode = '42501'; end if;
  select * into j from app.assistant_jobs where id = p_job and status = 'running';
  if j.id is null then raise exception 'This question is no longer running' using errcode = 'P0002'; end if;
  update app.assistant_jobs set step = left(p_name, 60) where id = j.id;
  -- from here on the database sees the person, with their roles and nothing more
  -- (claim.sub is only overwritten when it holds someone: creating it on a pooled connection would outlive this call)
  if coalesce(o_sub, '') <> '' then perform set_config('request.jwt.claim.sub', j.user_id::text, true); end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', j.user_id, 'role', 'authenticated')::text, true);
  if o_role is not null then perform set_config('request.jwt.claim.role', 'authenticated', true); end if;
  begin
    v := case p_name
      when 'search'          then public.ai_search(j.company_id, i ->> 'query')
      when 'find_items'      then public.ai_find_items(j.company_id, i ->> 'query', coalesce((i ->> 'limit')::int, 8))
      when 'partner_balance' then public.ai_partner_balance(j.company_id, i ->> 'query', coalesce(i ->> 'side', 'customer'))
      when 'find_document'   then public.ai_find_document(j.company_id, i ->> 'number')
      when 'low_stock'       then public.ai_low_stock(j.company_id, coalesce((i ->> 'limit')::int, 30))
      when 'day_summary'     then public.daily_summary(j.company_id, nullif(i ->> 'day', '')::date)
      when 'report'          then public.run_report(j.company_id, i ->> 'report', i - 'report')
      else null end;
    if v is null and p_name not in ('search', 'find_items', 'partner_balance', 'find_document', 'low_stock', 'day_summary', 'report') then
      v := jsonb_build_object('error', 'Unknown tool ' || p_name);
    end if;
    -- a report can be long: the first 40 rows and the totals are enough to answer
    if p_name = 'report' and jsonb_typeof(v -> 'rows') = 'array' then
      v_rows := jsonb_array_length(v -> 'rows');
      v := (v - 'dims' - 'columns') || jsonb_build_object('rows', (select coalesce(jsonb_agg(r), '[]'::jsonb) from (select r from jsonb_array_elements(v -> 'rows') r limit 40) x),
                                                         'row_count', v_rows);
    end if;
  exception when others then
    v := jsonb_build_object('error', sqlerrm);
  end;
  if coalesce(o_sub, '') <> '' then perform set_config('request.jwt.claim.sub', o_sub, true); end if;
  perform set_config('request.jwt.claims', coalesce(nullif(o_claims, ''), '{}'), true);
  if o_role is not null then perform set_config('request.jwt.claim.role', o_role, true); end if;
  return coalesce(v, 'null'::jsonb);
end $$;
revoke execute on function public.assistant_tool(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.assistant_tool(uuid, text, jsonb) to service_role;
