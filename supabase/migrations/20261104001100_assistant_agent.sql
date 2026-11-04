-- =============================================================================
-- DrisPRO · 20261104001100 · the assistant becomes an agent inside the program
--
-- 1. It acts, with the person's "Po": it prepares a task, a draft sales invoice, a draft purchase
--    order, a stock transfer request, a new price (into the person's levelling) or a payment
--    reminder to a customer. Nothing happens until the person presses "Po" on the card in the chat;
--    then it runs as that person, with their permissions, like the same click on the screen.
-- 2. It knows the page the person is on: a document, an item or a partner opened on the screen.
--    (What every page of the program is for comes from the page guides, in the postier.)
-- 3. It works by itself every morning for whoever turns it on: a short check of the day with what
--    needs doing, and the actions ready for a "Po". It counts as one question of the month.
-- =============================================================================

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_new in v_def) > 0 then return; end if;
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;

-- ----------------------------------------------------------------------------- what the agent proposes
create table if not exists app.assistant_actions (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  user_id         uuid not null,
  conversation_id uuid not null references app.assistant_conversations(id) on delete cascade,
  job_id          uuid references app.assistant_jobs(id) on delete set null,
  message_id      uuid references app.assistant_messages(id) on delete cascade,
  kind            text not null check (kind in ('task', 'sales_invoice', 'purchase_order', 'transfer', 'price', 'reminder')),
  input           jsonb not null,          -- what will be done, with everything already found
  preview         jsonb not null,          -- what the person sees on the card
  status          text not null default 'proposed' check (status in ('proposed', 'done', 'declined', 'failed', 'expired')),
  result          jsonb,
  error           text,
  created_at      timestamptz not null default now(),
  decided_at      timestamptz
);
create index if not exists assistant_actions_job_idx on app.assistant_actions (job_id);
create index if not exists assistant_actions_msg_idx on app.assistant_actions (message_id);
revoke all on app.assistant_actions from public, anon, authenticated;

-- the morning check, per person
create table if not exists app.assistant_daily (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id    uuid not null,
  hour       smallint not null default 7 check (hour between 5 and 12),
  enabled    boolean not null default true,
  last_day   date,
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);
revoke all on app.assistant_daily from public, anon, authenticated;

-- ----------------------------------------------------------------------------- helpers
create or replace function app.ai_warehouse(p_co uuid, p_q text)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v uuid[]; n text;
begin
  select array_agg(id order by (lower(name) = lower(btrim(p_q))) desc, name), string_agg(name, ', ' order by name) into v, n from (
    select id, name from public.warehouses
     where company_id = p_co and deleted_at is null and (lower(name) = lower(btrim(p_q)) or code = btrim(p_q) or name ilike '%' || btrim(p_q) || '%') limit 6) x;
  if v is null then raise exception 'No store or warehouse matches "%"', p_q using errcode = 'P0002'; end if;
  if cardinality(v) > 1 and not exists (select 1 from public.warehouses where id = v[1] and lower(name) = lower(btrim(p_q))) then
    raise exception 'Several units match "%": %. Ask which one.', p_q, n using errcode = '21000';
  end if;
  return v[1];
end $$;

create or replace function app.ai_variant_info(p_co uuid, p_var uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('name', v.name, 'sku', v.sku, 'rate', coalesce(tc.rate, 0))
    from public.product_variants v join public.products p on p.id = v.product_id left join public.tax_codes tc on tc.id = p.sales_tax_code_id
   where v.id = p_var and v.company_id = p_co
$$;

-- an amount as the person reads it: 1.234,50 €
create or replace function app.ai_money(p numeric, p_cur text default 'EUR') returns text language sql immutable set search_path = '' as $$
  select replace(replace(replace(to_char(round(coalesce(p, 0), 2), 'FM999G999G990D00'), ',', '#'), '.', ','), '#', '.')
         || ' ' || case coalesce(p_cur, 'EUR') when 'EUR' then '€' when 'ALL' then 'L' else p_cur end
$$;

-- ----------------------------------------------------------------------------- propose (from the conversation, as the person)
create or replace function app.ai_propose(j app.assistant_jobs, p_kind text, i jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare co uuid := j.company_id; v_in jsonb; v_pre jsonb; v_id uuid; l jsonb; n int := 0;
  v_partner uuid; v_var uuid; v_price numeric; v_disc numeric; v_rate numeric; v_rows jsonb := '[]'; v_net numeric := 0; v_gross numeric := 0;
  v_who uuid; v_due date; v_from uuid; v_to uuid; v_qty numeric; v_info jsonb; v_old numeric; v_new numeric; v_owed numeric; v_late numeric; v_name text;
  v_cur text := (select base_currency from public.companies where id = j.company_id);
begin
  if (select count(*) from app.assistant_actions where job_id = j.id) >= 6 then
    raise exception 'At most six actions in one answer; propose the most important ones' using errcode = '54000';
  end if;
  case p_kind
  when 'task' then
    if coalesce(btrim(i ->> 'title'), '') = '' then raise exception 'A task needs a title' using errcode = '23514'; end if;
    v_who := j.user_id;
    if nullif(btrim(coalesce(i ->> 'person', '')), '') is not null and lower(btrim(i ->> 'person')) not in ('me', 'unë', 'une', 'ja') then
      v_who := app.mcp_person(co, i ->> 'person');
      if v_who is null then raise exception 'No single person matches "%"', i ->> 'person' using errcode = 'P0002'; end if;
    end if;
    if v_who <> j.user_id and not app.has_permission(co, 'tasks.write') then
      raise exception 'Only a manager gives tasks to other people' using errcode = '42501';
    end if;
    v_due := nullif(i ->> 'due', '')::date;
    v_in := jsonb_build_object('title', left(btrim(i ->> 'title'), 200), 'notes', nullif(i ->> 'notes', ''), 'person', v_who, 'due', v_due,
              'priority', case lower(coalesce(i ->> 'priority', 'normal')) when 'urgent' then 3 when 'high' then 2 when 'low' then 0 else 1 end);
    v_pre := jsonb_build_object('title', v_in ->> 'title', 'rows', jsonb_build_array(
      jsonb_build_array('Person', (select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id = v_who)),
      jsonb_build_array('Due', coalesce(to_char(v_due, 'DD.MM.YYYY'), '—')),
      jsonb_build_array('Priority', case (v_in ->> 'priority')::int when 3 then 'urgent' when 2 then 'high' when 0 then 'low' else 'normal' end)));

  when 'sales_invoice' then
    perform app.require_permission(co, 'invoicing.write');
    v_partner := app.mcp_partner(co, i ->> 'customer', false);
    if jsonb_typeof(i -> 'lines') <> 'array' or jsonb_array_length(i -> 'lines') = 0 then raise exception 'An invoice needs at least one line' using errcode = '23514'; end if;
    v_in := jsonb_build_object('customer', (select name from public.business_partners where id = v_partner), 'notes', nullif(i ->> 'notes', ''), 'lines', '[]'::jsonb);
    for l in select * from jsonb_array_elements(i -> 'lines') loop
      n := n + 1;
      if coalesce((l ->> 'quantity')::numeric, 0) <= 0 then raise exception 'Line %: the quantity must be more than zero', n using errcode = '23514'; end if;
      v_var := app.mcp_item(co, l ->> 'item'); v_disc := 0; v_rate := null;
      if v_var is not null then
        select gp.unit_price, coalesce(gp.discount_pct, 0) into v_price, v_disc from public.get_price(co, v_partner, v_var, (l ->> 'quantity')::numeric, current_date, null) gp;
        v_info := app.ai_variant_info(co, v_var); v_rate := (v_info ->> 'rate')::numeric;
      else
        v_info := jsonb_build_object('name', l ->> 'item', 'sku', null);
        select tc.rate into v_rate from public.company_settings s join public.tax_codes tc on tc.id = s.default_sales_tax_code_id where s.company_id = co;
        v_price := null;
      end if;
      v_price := coalesce(nullif(l ->> 'price', '')::numeric, v_price);
      if v_price is null then raise exception 'Line %: give a price for "%"', n, l ->> 'item' using errcode = '23514'; end if;
      v_net := v_net + round((l ->> 'quantity')::numeric * v_price * (1 - v_disc / 100), 2);
      v_gross := v_gross + round((l ->> 'quantity')::numeric * v_price * (1 - v_disc / 100) * (1 + coalesce(v_rate, 0) / 100), 2);
      v_in := jsonb_set(v_in, '{lines}', (v_in -> 'lines') || jsonb_build_object('item', coalesce(v_info ->> 'sku', v_info ->> 'name'), 'quantity', (l ->> 'quantity')::numeric, 'price', v_price));
      v_rows := v_rows || jsonb_build_array(jsonb_build_array(v_info ->> 'name', (l ->> 'quantity') || ' × ' || app.ai_money(v_price, v_cur)));
    end loop;
    v_pre := jsonb_build_object('title', v_in ->> 'customer', 'rows', v_rows || jsonb_build_array(jsonb_build_array('Without VAT', app.ai_money(v_net, v_cur)), jsonb_build_array('With VAT', app.ai_money(v_gross, v_cur))),
                                'note', 'A draft: you check it and book it on its page');

  when 'purchase_order' then
    perform app.require_permission(co, 'procurement.write');
    v_partner := app.mcp_partner(co, i ->> 'vendor', true);
    if jsonb_typeof(i -> 'lines') <> 'array' or jsonb_array_length(i -> 'lines') = 0 then raise exception 'An order needs at least one line' using errcode = '23514'; end if;
    v_in := jsonb_build_object('vendor', (select name from public.business_partners where id = v_partner), 'notes', nullif(i ->> 'notes', ''), 'lines', '[]'::jsonb);
    for l in select * from jsonb_array_elements(i -> 'lines') loop
      n := n + 1;
      if coalesce((l ->> 'quantity')::numeric, 0) <= 0 then raise exception 'Line %: the quantity must be more than zero', n using errcode = '23514'; end if;
      v_var := app.mcp_item(co, l ->> 'item');
      if v_var is null then raise exception 'Line %: no item matches "%"', n, l ->> 'item' using errcode = 'P0002'; end if;
      select coalesce(nullif(l ->> 'price', '')::numeric, nullif(ic.avg_cost, 0), v.standard_cost, 0) into v_price
        from public.product_variants v left join public.item_costs ic on ic.variant_id = v.id where v.id = v_var;
      v_info := app.ai_variant_info(co, v_var);
      v_net := v_net + round((l ->> 'quantity')::numeric * v_price, 2);
      v_in := jsonb_set(v_in, '{lines}', (v_in -> 'lines') || jsonb_build_object('item', coalesce(v_info ->> 'sku', v_info ->> 'name'), 'quantity', (l ->> 'quantity')::numeric, 'price', round(v_price, 4)));
      v_rows := v_rows || jsonb_build_array(jsonb_build_array(v_info ->> 'name', (l ->> 'quantity') || ' × ' || app.ai_money(v_price, v_cur)));
    end loop;
    v_pre := jsonb_build_object('title', v_in ->> 'vendor', 'rows', v_rows || jsonb_build_array(jsonb_build_array('Without VAT', app.ai_money(v_net, v_cur))),
                                'note', 'A draft: you check it and send it on its page');

  when 'transfer' then
    if not (app.has_permission(co, 'inventory.write') or app.has_permission(co, 'wms.write')) then
      raise exception 'Permission denied: wms.write required' using errcode = '42501';
    end if;
    v_var := app.mcp_item(co, i ->> 'item');
    if v_var is null then raise exception 'No item matches "%"', i ->> 'item' using errcode = 'P0002'; end if;
    v_from := app.ai_warehouse(co, i ->> 'from'); v_to := app.ai_warehouse(co, i ->> 'to');
    if v_from = v_to then raise exception 'Choose two different units' using errcode = '23514'; end if;
    v_qty := nullif(i ->> 'quantity', '')::numeric;
    if coalesce(v_qty, 0) <= 0 then raise exception 'The quantity must be more than zero' using errcode = '23514'; end if;
    v_info := app.ai_variant_info(co, v_var);
    v_in := jsonb_build_object('variant', v_var, 'from', v_from, 'to', v_to, 'quantity', v_qty, 'note', nullif(i ->> 'note', ''));
    v_pre := jsonb_build_object('title', v_info ->> 'name', 'rows', jsonb_build_array(
      jsonb_build_array('Quantity', v_qty::text), jsonb_build_array('From', (select name from public.warehouses where id = v_from)),
      jsonb_build_array('To', (select name from public.warehouses where id = v_to))));

  when 'price' then
    perform app.require_permission(co, 'inventory.write');
    v_var := app.mcp_item(co, i ->> 'item');
    if v_var is null then raise exception 'No item matches "%"', i ->> 'item' using errcode = 'P0002'; end if;
    v_new := nullif(i ->> 'price_with_vat', '')::numeric;
    if v_new is null or v_new < 0 then raise exception 'Give the new price with VAT' using errcode = '23514'; end if;
    v_info := app.ai_variant_info(co, v_var); v_rate := (v_info ->> 'rate')::numeric;
    select gp.unit_price into v_old from public.get_price(co, null, v_var, 1, current_date, null) gp;
    v_in := jsonb_build_object('variant', v_var, 'net', round(v_new / (1 + v_rate / 100), 4));
    v_pre := jsonb_build_object('title', v_info ->> 'name', 'rows', jsonb_build_array(
      jsonb_build_array('Price now with VAT', app.ai_money(v_old * (1 + v_rate / 100), v_cur)), jsonb_build_array('New price with VAT', app.ai_money(v_new, v_cur))),
      'note', 'It goes onto your levelling; the price changes when it is posted');

  when 'reminder' then
    perform app.require_permission(co, 'invoicing.write');
    v_partner := app.mcp_partner(co, i ->> 'customer', false);
    select bp.name, (select coalesce(sum(si.amount_due), 0) from public.sales_invoices si where si.partner_id = bp.id and si.deleted_at is null and si.status = 'posted' and si.document_type = 'sales_invoice' and si.amount_due > 0),
           (select coalesce(sum(si.amount_due), 0) from public.sales_invoices si where si.partner_id = bp.id and si.deleted_at is null and si.status = 'posted' and si.document_type = 'sales_invoice' and si.amount_due > 0 and si.due_date < current_date)
      into v_name, v_owed, v_late from public.business_partners bp where bp.id = v_partner;
    if coalesce(v_owed, 0) <= 0 then raise exception 'The customer owes nothing' using errcode = '23514'; end if;
    if not exists (select 1 from public.business_partners where id = v_partner and (nullif(btrim(email), '') is not null or nullif(btrim(phone), '') is not null)) then
      raise exception 'The customer has no email or phone; add one on their card' using errcode = '23514';
    end if;
    v_in := jsonb_build_object('partner', v_partner);
    v_pre := jsonb_build_object('title', v_name, 'rows', jsonb_build_array(jsonb_build_array('Owed', app.ai_money(v_owed, v_cur)), jsonb_build_array('Overdue', app.ai_money(v_late, v_cur))),
                                'note', 'The reminder is sent to the customer now, by email or WhatsApp');
  else
    raise exception 'Unknown action %', p_kind using errcode = '22023';
  end case;
  insert into app.assistant_actions (company_id, user_id, conversation_id, job_id, kind, input, preview)
  values (co, j.user_id, j.conversation_id, j.id, p_kind, v_in, v_pre) returning id into v_id;
  return jsonb_build_object('proposed', true, 'action', v_id, 'kind', p_kind, 'card', v_pre,
    'next', 'Nothing is done yet: the person sees this card under your answer and presses "Po" to do it or "Jo" to drop it. Say what you prepared in one sentence; do not say it is done.');
end $$;
revoke execute on function app.ai_propose(app.assistant_jobs, text, jsonb), app.ai_warehouse(uuid, text), app.ai_variant_info(uuid, uuid), app.ai_money(numeric, text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------- the person decides
create or replace function public.assistant_decide(p_action uuid, p_yes boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a app.assistant_actions; v jsonb; v_id uuid; v_no text; v_err text;
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  select * into a from app.assistant_actions where id = p_action and user_id = auth.uid() for update;
  if a.id is null then raise exception 'Not found' using errcode = 'P0002'; end if;
  if a.status <> 'proposed' then raise exception 'This was already decided' using errcode = '55000'; end if;
  if a.created_at < now() - interval '3 days' then
    update app.assistant_actions set status = 'expired', decided_at = now() where id = a.id;
    return jsonb_build_object('status', 'expired');
  end if;
  if not exists (select 1 from public.company_members m where m.company_id = a.company_id and m.user_id = auth.uid() and m.status = 'active' and m.deleted_at is null) then
    raise exception 'Permission denied' using errcode = '42501';
  end if;
  if not p_yes then
    update app.assistant_actions set status = 'declined', decided_at = now() where id = a.id;
    return jsonb_build_object('status', 'declined');
  end if;
  begin
    case a.kind
    when 'task' then
      if (a.input ->> 'person')::uuid <> auth.uid() and not app.has_permission(a.company_id, 'tasks.write') then
        raise exception 'Only a manager gives tasks to other people' using errcode = '42501';
      end if;
      insert into public.tasks (company_id, title, description, assignee_id, due_date, priority, source, created_by)
      values (a.company_id, a.input ->> 'title', a.input ->> 'notes', (a.input ->> 'person')::uuid, nullif(a.input ->> 'due', '')::date,
              (a.input ->> 'priority')::smallint, 'assistant', auth.uid())
      returning id, number into v_id, v_no;
      v := jsonb_build_object('number', v_no, 'href', '/tasks?id=' || v_id);
    when 'sales_invoice' then
      v := app.mcp_draft_invoice(a.company_id, a.input);
      v := jsonb_build_object('number', (select number from public.sales_invoices where id = (v ->> 'id')::uuid), 'href', v ->> 'href');
    when 'purchase_order' then
      v := app.mcp_draft_po(a.company_id, a.input);
      v := jsonb_build_object('number', v ->> 'number', 'href', v ->> 'href');
    when 'transfer' then
      v := public.item_request(a.company_id, (a.input ->> 'variant')::uuid, (a.input ->> 'from')::uuid, (a.input ->> 'to')::uuid, (a.input ->> 'quantity')::numeric, a.input ->> 'note');
      v := jsonb_build_object('number', v ->> 'number', 'href', '/inventory/transfers/' || (v ->> 'id'));
    when 'price' then
      v := public.level_add_line(a.company_id, (a.input ->> 'variant')::uuid, (a.input ->> 'net')::numeric, null);
      v := jsonb_build_object('href', '/inventory/levelling/' || (v ->> 'id'), 'lines', v -> 'lines');
    when 'reminder' then
      v := public.send_reminder_now((a.input ->> 'partner')::uuid);
    end case;
  exception when others then
    v_err := sqlerrm;
  end;
  if v_err is not null then
    update app.assistant_actions set status = 'failed', error = left(v_err, 400), decided_at = now() where id = a.id;
    return jsonb_build_object('status', 'failed', 'error', v_err);
  end if;
  update app.assistant_actions set status = 'done', result = v, decided_at = now() where id = a.id;
  return jsonb_build_object('status', 'done', 'result', v);
end $$;
revoke execute on function public.assistant_decide(uuid, boolean) from public, anon;
grant execute on function public.assistant_decide(uuid, boolean) to authenticated;

-- ----------------------------------------------------------------------------- the page the person is on
create or replace function public.ai_page_record(p_company uuid, p_path text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare m text[]; v_no text; v_side text;
begin
  m := regexp_match(coalesce(p_path, ''), '^/([a-z-]+)/([a-z-]+)/([0-9a-f-]{36})');
  if m is null then
    m := regexp_match(coalesce(p_path, ''), '^/(partners)/([0-9a-f-]{36})');
    if m is not null then m := array['partners', '', m[2]]; end if;
  end if;
  if m is null then return jsonb_build_object('record', false, 'path', p_path, 'note', 'This page is a list or a screen, not one record; ask what they see or use the other tools'); end if;
  case m[1] || '/' || m[2]
    when 'sales/invoices' then select number into v_no from public.sales_invoices where id = m[3]::uuid and company_id = p_company;
    when 'sales/orders' then select number into v_no from public.sales_orders where id = m[3]::uuid and company_id = p_company;
    when 'procurement/orders' then select number into v_no from public.purchase_orders where id = m[3]::uuid and company_id = p_company;
    when 'procurement/bills' then select number into v_no from public.vendor_bills where id = m[3]::uuid and company_id = p_company;
    when 'inventory/receipts' then select number into v_no from public.goods_receipts where id = m[3]::uuid and company_id = p_company;
    when 'inventory/products' then
      select coalesce(p.code, v2.sku) into v_no from public.products p left join public.product_variants v2 on v2.product_id = p.id
       where p.id = m[3]::uuid and p.company_id = p_company limit 1;
      if v_no is null then return jsonb_build_object('record', false); end if;
      return jsonb_build_object('record', true, 'kind', 'item', 'items', public.ai_find_items(p_company, v_no, 1));
    when 'partners/' then
      select coalesce(nullif(code, ''), name), case when is_customer then 'customer' else 'vendor' end into v_no, v_side from public.business_partners where id = m[3]::uuid and company_id = p_company;
      if v_no is null then return jsonb_build_object('record', false); end if;
      return jsonb_build_object('record', true, 'kind', 'partner', 'balance', public.ai_partner_balance(p_company, v_no, v_side));
    else
      return jsonb_build_object('record', false, 'path', p_path, 'note', 'This kind of record cannot be read yet; use search or find_document');
  end case;
  if v_no is null then return jsonb_build_object('record', false); end if;
  return jsonb_build_object('record', true, 'document', public.ai_find_document(p_company, v_no));
end $$;
revoke execute on function public.ai_page_record(uuid, text) from public, anon;
grant execute on function public.ai_page_record(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------- the tools
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
      when 'safes'           then public.ai_safes(j.company_id)
      when 'page_record'     then public.ai_page_record(j.company_id, coalesce(nullif(i ->> 'path', ''), j.context ->> 'path'))
      when 'my_tasks'        then app.ai_my_tasks(j, i)
      when 'propose_task'            then app.ai_propose(j, 'task', i)
      when 'propose_sales_invoice'   then app.ai_propose(j, 'sales_invoice', i)
      when 'propose_purchase_order'  then app.ai_propose(j, 'purchase_order', i)
      when 'propose_transfer'        then app.ai_propose(j, 'transfer', i)
      when 'propose_price_change'    then app.ai_propose(j, 'price', i)
      when 'propose_reminder'        then app.ai_propose(j, 'reminder', i)
      else jsonb_build_object('error', 'Unknown tool ' || p_name) end;
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

-- a person's open tasks (their own, or someone else's for a manager)
create or replace function app.ai_my_tasks(j app.assistant_jobs, i jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_who uuid := j.user_id;
begin
  if nullif(btrim(coalesce(i ->> 'who', '')), '') is not null and lower(i ->> 'who') not in ('me', 'unë', 'une', 'ja') then
    v_who := app.mcp_person(j.company_id, i ->> 'who');
    if v_who is null then return jsonb_build_object('error', 'No single person matches "' || (i ->> 'who') || '"'); end if;
    if v_who <> j.user_id and not app.has_permission(j.company_id, 'tasks.write') then
      return jsonb_build_object('error', 'Permission denied: only a manager sees other people''s tasks');
    end if;
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('number', t.number, 'title', t.title, 'status', t.status, 'priority', t.priority, 'due', t.due_date,
                                                       'late', t.due_date < current_date, 'about', t.entity_label, 'href', '/tasks?id=' || t.id) order by t.due_date nulls last, t.priority desc)
                     from (select * from public.tasks t where t.company_id = j.company_id and t.deleted_at is null and t.status not in ('done', 'cancelled')
                             and (not t.is_private or t.assignee_id = j.user_id) and t.assignee_id = v_who limit 40) t), '[]');
end $$;
revoke execute on function app.ai_my_tasks(app.assistant_jobs, jsonb) from public, anon, authenticated;

-- ----------------------------------------------------------------------------- the answer keeps its cards
create or replace function public.assistant_done(p_job uuid, p_ok boolean, p_text text default null, p_tools jsonb default null,
  p_input_tokens int default null, p_output_tokens int default null, p_model text default null, p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare j app.assistant_jobs; v_msg uuid; v_title text;
begin
  if auth.uid() is not null then raise exception 'Only the server runs this' using errcode = '42501'; end if;
  update app.assistant_jobs set status = case when p_ok then 'done' else 'failed' end, finished_at = now(), error = case when p_ok then null else left(p_error, 500) end
   where id = p_job returning * into j;
  if j.id is null then return; end if;
  if p_ok then
    insert into app.assistant_messages (conversation_id, role, content, tools, input_tokens, output_tokens, model)
    values (j.conversation_id, 'assistant', coalesce(nullif(btrim(p_text), ''), '…'), p_tools, p_input_tokens, p_output_tokens, p_model)
    returning id into v_msg;
    update app.assistant_actions set message_id = v_msg where job_id = j.id;
    update app.assistant_conversations set updated_at = now() where id = j.conversation_id;
    -- the morning check tells the person it is ready (on the phone too)
    if coalesce((j.context ->> 'daily')::boolean, false) then
      select title into v_title from app.assistant_conversations where id = j.conversation_id;
      insert into public.notifications (company_id, user_id, type, title, body, link)
      values (j.company_id, j.user_id, 'info', 'Your morning check is ready',
              left(regexp_replace(regexp_replace(coalesce(p_text, ''), '[*#_`>\[\]]|\(/[^)]*\)', '', 'g'), '\s+', ' ', 'g'), 160),
              '/?assistant=' || j.conversation_id);
    end if;
  else
    -- an answer that never came: its cards are not shown and cannot be pressed
    update app.assistant_actions set status = 'expired' where job_id = j.id and status = 'proposed';
  end if;
end $$;
revoke execute on function public.assistant_done(uuid, boolean, text, jsonb, int, int, text, text) from public, anon, authenticated;
grant execute on function public.assistant_done(uuid, boolean, text, jsonb, int, int, text, text) to service_role;

create or replace function public.assistant_state(p_conversation uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c app.assistant_conversations; j app.assistant_jobs;
begin
  select * into c from app.assistant_conversations where id = p_conversation and user_id = auth.uid();
  if c.id is null then raise exception 'Conversation not found' using errcode = 'P0002'; end if;
  select * into j from app.assistant_jobs where conversation_id = c.id order by created_at desc limit 1;
  return jsonb_build_object('id', c.id, 'title', c.title,
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'role', m.role, 'content', m.content, 'created_at', m.created_at,
                                 'actions', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'preview', a.preview, 'status',
                                                case when a.status = 'proposed' and a.created_at < now() - interval '3 days' then 'expired' else a.status end,
                                                'result', a.result, 'error', a.error) order by a.created_at), '[]'::jsonb)
                                               from app.assistant_actions a where a.message_id = m.id)) order by m.created_at)
                           from app.assistant_messages m where m.conversation_id = c.id), '[]'::jsonb),
    'job', case when j.id is not null then jsonb_build_object('id', j.id, 'status', j.status, 'step', j.step, 'error', j.error) end);
end $$;
revoke execute on function public.assistant_state(uuid) from public, anon;
grant execute on function public.assistant_state(uuid) to authenticated;

-- the conversation the model sees: what came of its cards is part of it
do $$ begin
  perform app._patch_function('public.assistant_wait',
    $o$    'messages', (select jsonb_agg(jsonb_build_object('role', x.role, 'content', x.content) order by x.created_at)$o$,
    $n$    'messages', (select jsonb_agg(jsonb_build_object('role', x.role, 'content', x.content || coalesce((select string_agg(E'\n[' || a.kind || ' card "' || coalesce(a.preview ->> 'title', '') || '": ' || a.status
                              || coalesce(' → ' || (a.result ->> 'number'), '') || coalesce(' (' || a.error || ')', '') || ']', '' order by a.created_at)
                              from app.assistant_actions a where a.message_id = x.id), '')) order by x.created_at)$n$);
end $$;

-- ----------------------------------------------------------------------------- the morning check
create or replace function public.assistant_daily_get(p_company uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object('enabled', d.enabled, 'hour', d.hour, 'last_day', d.last_day)
                     from app.assistant_daily d where d.company_id = p_company and d.user_id = auth.uid()),
                  jsonb_build_object('enabled', false, 'hour', 7))
$$;
revoke execute on function public.assistant_daily_get(uuid) from public, anon;
grant execute on function public.assistant_daily_get(uuid) to authenticated;

create or replace function public.assistant_daily_set(p_company uuid, p_enabled boolean, p_hour int default 7)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'core.read');
  perform app.require_feature(p_company, 'ai_assistant');
  if p_hour is null or p_hour not between 5 and 12 then raise exception 'Choose an hour between 5 and 12' using errcode = '22023'; end if;
  insert into app.assistant_daily (company_id, user_id, hour, enabled) values (p_company, auth.uid(), p_hour, coalesce(p_enabled, false))
  on conflict (company_id, user_id) do update set hour = excluded.hour, enabled = excluded.enabled;
  return public.assistant_daily_get(p_company);
end $$;
revoke execute on function public.assistant_daily_set(uuid, boolean, int) from public, anon;
grant execute on function public.assistant_daily_set(uuid, boolean, int) to authenticated;

-- run from the tick: the people whose hour has come get their check queued once a day
create or replace function app.assistant_daily_queue()
returns int language plpgsql security definer set search_path = '' as $$
declare d record; v_conv uuid; n int := 0; v_loc text; v_today date;
begin
  for d in select ad.*, coalesce(co.timezone, 'Europe/Tirane') as tz from app.assistant_daily ad join public.companies co on co.id = ad.company_id
            where ad.enabled and co.deleted_at is null and co.is_active
              and extract(hour from now() at time zone coalesce(co.timezone, 'Europe/Tirane')) >= ad.hour
              and ad.last_day is distinct from (now() at time zone coalesce(co.timezone, 'Europe/Tirane'))::date
            for update of ad skip locked loop
    v_today := (now() at time zone d.tz)::date;
    update app.assistant_daily set last_day = v_today where company_id = d.company_id and user_id = d.user_id;
    -- only while the person still works there, the module is on and the month has questions left
    continue when not exists (select 1 from public.company_members m where m.company_id = d.company_id and m.user_id = d.user_id and m.status = 'active' and m.deleted_at is null);
    continue when not app.has_feature(d.company_id, 'ai_assistant');
    continue when app.ai_chat_used(d.company_id) >= app.ai_chat_limit(d.company_id);
    continue when exists (select 1 from app.assistant_jobs where company_id = d.company_id and user_id = d.user_id and status in ('queued', 'running'));
    select coalesce(locale, 'sq') into v_loc from public.profiles where id = d.user_id;
    insert into app.assistant_conversations (company_id, user_id, title)
    values (d.company_id, d.user_id, case v_loc when 'en' then 'Morning check ' when 'sr' then 'Jutarnja provera ' else 'Kontrolli i mëngjesit ' end || to_char(v_today, 'DD.MM.YYYY'))
    returning id into v_conv;
    insert into app.assistant_messages (conversation_id, role, content)
    values (v_conv, 'user', case v_loc when 'en' then 'Morning check: how do we stand today, and what needs doing?'
                                       when 'sr' then 'Jutarnja provera: kako stojimo danas i šta treba uraditi?'
                                       else 'Kontrolli i mëngjesit: si jemi sot dhe çka duhet bërë?' end);
    insert into app.assistant_jobs (conversation_id, company_id, user_id, context) values (v_conv, d.company_id, d.user_id, jsonb_build_object('daily', true, 'path', '/'));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function app.assistant_daily_queue() from public, anon, authenticated;

do $$ begin
  perform app._patch_function('public.automation_tick',
    '  perform app.assistant_cleanup();',
    '  perform app.assistant_daily_queue();
  perform app.assistant_cleanup();');
end $$;

drop function app._patch_function(text, text, text);
