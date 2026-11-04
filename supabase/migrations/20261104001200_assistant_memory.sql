-- =============================================================================
-- DrisPRO · 20261104001200 · the agent learns the business
--
-- What the company teaches its agent stays with the company: rules ("customers more than 30 days
-- late get no goods before they pay"), its words and names ("kafe" means Kafe turke 200 g), how it
-- works (a procedure with its steps) and what each person prefers. People teach it three ways:
--   * on the page "Çka di agjenti" (Cilësimet → Agjenti AI), for the whole company or for themselves;
--   * in the chat: when they correct it or tell it how they work, the agent offers a card
--     "Ta mbaj mend?" and keeps it on "Po";
--   * with "Jo" on a card and a reason: the reason is kept, so the next proposal is better.
-- Every answer starts with what the company and the person taught it; long procedures are searched.
-- What it learned is always on the page, with where it came from, and can be changed or deleted.
-- A lesson never widens what a person may see or do: the tools keep their permissions.
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

create table if not exists app.assistant_memory (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  user_id     uuid,                               -- null: the whole company; else only this person
  kind        text not null check (kind in ('rule', 'name', 'procedure', 'preference', 'correction')),
  title       text check (length(title) <= 120),
  body        text not null check (length(btrim(body)) between 3 and 4000),
  source      text not null default 'taught' check (source in ('taught', 'chat', 'declined')),
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists assistant_memory_co_idx on app.assistant_memory (company_id, user_id) where deleted_at is null;
revoke all on app.assistant_memory from public, anon, authenticated;

-- who may teach the whole company (a person always teaches it for themselves)
create or replace function app.ai_can_teach(p_co uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select app.has_permission(p_co, 'admin.write') or app.has_permission(p_co, 'tasks.write')
$$;

-- ----------------------------------------------------------------------------- the page
create or replace function public.assistant_memory_list(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'core.read');
  return jsonb_build_object('can_teach_company', app.ai_can_teach(p_company),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'title', m.title, 'body', m.body, 'source', m.source,
                         'company', m.user_id is null, 'by', (select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id = m.created_by),
                         'updated_at', m.updated_at, 'can_edit', coalesce(m.user_id = auth.uid(), false) or (m.user_id is null and app.ai_can_teach(p_company)))
                       order by (m.user_id is null) desc, m.updated_at desc)
                       from app.assistant_memory m where m.company_id = p_company and m.deleted_at is null and (m.user_id is null or m.user_id = auth.uid())), '[]'::jsonb));
end $$;
revoke execute on function public.assistant_memory_list(uuid) from public, anon;
grant execute on function public.assistant_memory_list(uuid) to authenticated;

create or replace function public.assistant_memory_save(p_company uuid, p_id uuid, p_kind text, p_title text, p_body text, p_company_wide boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m app.assistant_memory; v_id uuid := p_id;
begin
  perform app.require_permission(p_company, 'core.read');
  perform app.require_feature(p_company, 'ai_assistant');
  if p_kind not in ('rule', 'name', 'procedure', 'preference', 'correction') then raise exception 'Unknown kind of lesson' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_body, ''))) < 3 then raise exception 'Write what the agent should know' using errcode = '22023'; end if;
  if length(p_body) > 4000 then raise exception 'Write it in at most 4000 characters' using errcode = '22023'; end if;
  if p_company_wide and not app.ai_can_teach(p_company) then raise exception 'Only a manager teaches the agent for the whole company' using errcode = '42501'; end if;
  if v_id is not null then
    select * into m from app.assistant_memory where id = v_id and company_id = p_company and deleted_at is null for update;
    if m.id is null then raise exception 'Not found' using errcode = 'P0002'; end if;
    if not (coalesce(m.user_id = auth.uid(), false) or (m.user_id is null and app.ai_can_teach(p_company))) then raise exception 'Permission denied' using errcode = '42501'; end if;
    update app.assistant_memory set kind = p_kind, title = nullif(btrim(coalesce(p_title, '')), ''), body = btrim(p_body),
           user_id = case when p_company_wide then null else auth.uid() end, updated_at = now() where id = v_id;
  else
    insert into app.assistant_memory (company_id, user_id, kind, title, body, source, created_by)
    values (p_company, case when p_company_wide then null else auth.uid() end, p_kind, nullif(btrim(coalesce(p_title, '')), ''), btrim(p_body), 'taught', auth.uid())
    returning id into v_id;
  end if;
  return jsonb_build_object('id', v_id);
end $$;
revoke execute on function public.assistant_memory_save(uuid, uuid, text, text, text, boolean) from public, anon;
grant execute on function public.assistant_memory_save(uuid, uuid, text, text, text, boolean) to authenticated;

create or replace function public.assistant_memory_delete(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare m app.assistant_memory;
begin
  select * into m from app.assistant_memory where id = p_id and deleted_at is null for update;
  if m.id is null or not (coalesce(m.user_id = auth.uid(), false) or (m.user_id is null and app.ai_can_teach(m.company_id))) then raise exception 'Not found' using errcode = 'P0002'; end if;
  update app.assistant_memory set deleted_at = now() where id = p_id;
end $$;
revoke execute on function public.assistant_memory_delete(uuid) from public, anon;
grant execute on function public.assistant_memory_delete(uuid) to authenticated;

-- ----------------------------------------------------------------------------- what every answer starts with
-- the short lessons whole; of the long procedures only their titles (the agent searches them)
create or replace function app.ai_memory_for(p_co uuid, p_user uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x ->> 'for', x ->> 'kind'), '[]'::jsonb) from (
    select jsonb_build_object('kind', m.kind, 'for', case when m.user_id is null then 'company' else 'you' end,
             'title', m.title, 'text', case when m.kind = 'procedure' and length(m.body) > 400 then left(m.body, 200) || ' …(company_knowledge for the rest)' else m.body end) as x
      from app.assistant_memory m
     where m.company_id = p_co and m.deleted_at is null and (m.user_id is null or m.user_id = p_user)
     order by m.updated_at desc limit 80) q
$$;

create or replace function app.ai_memory_search(j app.assistant_jobs, i jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare q text := btrim(coalesce(i ->> 'query', '')); w text[];
begin
  w := array(select x from unnest(regexp_split_to_array(lower(q), '\s+')) x where length(x) > 2);
  return coalesce((select jsonb_agg(jsonb_build_object('kind', m.kind, 'title', m.title, 'text', m.body, 'for', case when m.user_id is null then 'company' else 'you' end))
                     from (select * from app.assistant_memory m where m.company_id = j.company_id and m.deleted_at is null and (m.user_id is null or m.user_id = j.user_id)
                             and (cardinality(w) = 0 or exists (select 1 from unnest(w) x where lower(coalesce(m.title, '') || ' ' || m.body) like '%' || left(x, greatest(4, length(x) - 2)) || '%'))
                            order by (select count(*) from unnest(w) x where lower(coalesce(m.title, '') || ' ' || m.body) like '%' || left(x, greatest(4, length(x) - 2)) || '%') desc, m.updated_at desc
                            limit 5) m), '[]'::jsonb);
end $$;
revoke execute on function app.ai_memory_for(uuid, uuid), app.ai_memory_search(app.assistant_jobs, jsonb), app.ai_can_teach(uuid) from public, anon, authenticated;

do $$ begin
  perform app._patch_function('public.assistant_wait',
    $o$    'messages', (select jsonb_agg($o$,
    $n$    'memory', app.ai_memory_for(j.company_id, j.user_id),
    'messages', (select jsonb_agg($n$);
  perform app._patch_function('public.assistant_tool',
    $o$      when 'my_tasks'        then app.ai_my_tasks(j, i)$o$,
    $n$      when 'my_tasks'        then app.ai_my_tasks(j, i)
      when 'company_knowledge' then app.ai_memory_search(j, i)
      when 'remember'        then app.ai_propose(j, 'memory', i)$n$);
  -- "Ta mbaj mend?" is a card like the others
  perform app._patch_function('app.ai_propose',
    $o$  else
    raise exception 'Unknown action %', p_kind using errcode = '22023';$o$,
    $n$  when 'memory' then
    if length(btrim(coalesce(i ->> 'text', ''))) < 3 then raise exception 'Say what to remember' using errcode = '23514'; end if;
    if coalesce((i ->> 'for_everyone')::boolean, false) and not app.ai_can_teach(co) then
      raise exception 'Only a manager teaches the agent for the whole company; offer to remember it for this person only' using errcode = '42501';
    end if;
    v_in := jsonb_build_object('kind', case when i ->> 'kind' in ('rule', 'name', 'procedure', 'preference') then i ->> 'kind' else 'rule' end,
              'title', nullif(left(btrim(coalesce(i ->> 'title', '')), 120), ''), 'text', left(btrim(i ->> 'text'), 4000),
              'company', coalesce((i ->> 'for_everyone')::boolean, false));
    v_pre := jsonb_build_object('title', v_in ->> 'text', 'rows', jsonb_build_array(jsonb_build_array('For', case when (v_in ->> 'company')::boolean then 'the whole company' else 'only you' end)),
                                'note', 'The agent follows it from now on; it is on the page "What the agent knows"');
  else
    raise exception 'Unknown action %', p_kind using errcode = '22023';$n$);
end $$;

alter table app.assistant_actions drop constraint if exists assistant_actions_kind_check;
alter table app.assistant_actions add constraint assistant_actions_kind_check
  check (kind in ('task', 'sales_invoice', 'purchase_order', 'transfer', 'price', 'reminder', 'memory'));
alter table app.assistant_actions add column if not exists reason text check (length(reason) <= 500);

-- ----------------------------------------------------------------------------- Po, and Jo with a reason
drop function if exists public.assistant_decide(uuid, boolean);
create or replace function public.assistant_decide(p_action uuid, p_yes boolean, p_reason text default null)
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
    update app.assistant_actions set status = 'declined', decided_at = now(), reason = nullif(left(btrim(coalesce(p_reason, '')), 500), '') where id = a.id;
    -- the reason teaches the agent, for this person
    if length(btrim(coalesce(p_reason, ''))) >= 3 then
      insert into app.assistant_memory (company_id, user_id, kind, title, body, source, created_by)
      values (a.company_id, auth.uid(), 'correction', left(a.kind || ': ' || coalesce(a.preview ->> 'title', ''), 120),
              'When you proposed ' || replace(a.kind, '_', ' ') || ' "' || coalesce(a.preview ->> 'title', '') || '", the answer was No: ' || left(btrim(p_reason), 500),
              'declined', auth.uid());
    end if;
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
    when 'memory' then
      if (a.input ->> 'company')::boolean and not app.ai_can_teach(a.company_id) then
        raise exception 'Only a manager teaches the agent for the whole company' using errcode = '42501';
      end if;
      insert into app.assistant_memory (company_id, user_id, kind, title, body, source, created_by)
      values (a.company_id, case when (a.input ->> 'company')::boolean then null else auth.uid() end, a.input ->> 'kind', a.input ->> 'title', a.input ->> 'text', 'chat', auth.uid())
      returning id into v_id;
      v := jsonb_build_object('href', '/settings/assistant');
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
revoke execute on function public.assistant_decide(uuid, boolean, text) from public, anon;
grant execute on function public.assistant_decide(uuid, boolean, text) to authenticated;

-- the model reads back the reason of a "Jo" too
do $$ begin
  perform app._patch_function('public.assistant_wait',
    $o$|| coalesce(' (' || a.error || ')', '') || ']'$o$,
    $n$|| coalesce(' (' || a.error || ')', '') || coalesce(' — reason: ' || a.reason, '') || ']'$n$);
end $$;

drop function app._patch_function(text, text, text);
