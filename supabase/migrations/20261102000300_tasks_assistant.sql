-- =============================================================================
-- Tasks in the assistant (ChatGPT, Claude): "what is on my list?", "give Ilir a task to
-- count shelf A on Friday". Reading needs a read link; making a task needs a link that may
-- prepare drafts, and the assistant confirms with the person first.
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

-- a person by what someone would call them (first name is enough when it is unique)
create or replace function app.mcp_person(p_co uuid, p_q text)
returns uuid language sql stable security definer set search_path = '' as $$
  with m as (
    select mm.user_id, lower(coalesce(nullif(btrim(p.full_name), ''), p.email)) as n
      from public.company_members mm join public.profiles p on p.id = mm.user_id
     where mm.company_id = p_co and mm.status = 'active' and mm.deleted_at is null)
  select case when (select count(*) from m where n like lower(btrim(p_q)) || '%' or n like '% ' || lower(btrim(p_q)) || '%') = 1
              then (select user_id from m where n like lower(btrim(p_q)) || '%' or n like '% ' || lower(btrim(p_q)) || '%') end
$$;

create or replace function app.mcp_tasks(k public.api_keys, i jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_who uuid := k.run_as;
begin
  if nullif(btrim(coalesce(i ->> 'who', '')), '') is not null and lower(i ->> 'who') not in ('me', 'unë', 'une') then
    v_who := app.mcp_person(k.company_id, i ->> 'who');
    if v_who is null then return jsonb_build_object('error', 'No single person matches "' || (i ->> 'who') || '"'); end if;
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('number', t.number, 'title', t.title, 'status', t.status, 'priority', t.priority,
                                                       'due', t.due_date, 'late', t.due_date < current_date, 'about', t.entity_label,
                                                       'person', (select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id = t.assignee_id),
                                                       'link', '/tasks?id=' || t.id) order by t.due_date nulls last, t.priority desc)
                     from public.tasks t
                    where t.company_id = k.company_id and t.deleted_at is null and t.status not in ('done','cancelled') and not t.is_private
                      and t.assignee_id = v_who and (not coalesce((i ->> 'late')::boolean, false) or t.due_date < current_date)), '[]');
end $$;

create or replace function app.mcp_create_task(k public.api_keys, i jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_who uuid := k.run_as; v_id uuid; v_no text; v_p smallint;
begin
  if coalesce(btrim(i ->> 'title'), '') = '' then return jsonb_build_object('error', 'A task needs a title'); end if;
  if nullif(btrim(coalesce(i ->> 'person', '')), '') is not null then
    v_who := app.mcp_person(k.company_id, i ->> 'person');
    if v_who is null then return jsonb_build_object('error', 'No single person matches "' || (i ->> 'person') || '"'); end if;
  end if;
  -- the same rule as in the app: tasks for other people only from someone who may give them
  if v_who is distinct from k.run_as and not exists (
       select 1 from public.company_members m join public.member_roles mr on mr.member_id = m.id join public.role_permissions rp on rp.role_id = mr.role_id
        where m.company_id = k.company_id and m.user_id = k.run_as and m.status = 'active' and rp.permission in ('tasks.write', 'tasks.*', '*.write', '*')) then
    return jsonb_build_object('error', 'Only a manager gives tasks to other people');
  end if;
  v_p := case lower(coalesce(i ->> 'priority', 'normal')) when 'urgent' then 3 when 'high' then 2 when 'low' then 0 else 1 end;
  insert into public.tasks (company_id, title, description, assignee_id, due_date, priority, source, created_by)
  values (k.company_id, left(btrim(i ->> 'title'), 200), nullif(i ->> 'notes', ''), v_who, nullif(i ->> 'due', '')::date, v_p, 'assistant', k.run_as)
  returning id, number into v_id, v_no;
  return jsonb_build_object('number', v_no, 'link', '/tasks?id=' || v_id, 'person', (select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id = v_who));
end $$;
revoke execute on function app.mcp_person(uuid, text), app.mcp_tasks(public.api_keys, jsonb), app.mcp_create_task(public.api_keys, jsonb) from public, anon, authenticated;

do $$ begin
  perform app._patch_function('app.mcp_tools',
    $o$    union all select jsonb_build_object('name', 'safes', 'title', 'Sefi dhe paratë',$o$,
    $n$    union all select jsonb_build_object('name', 'tasks', 'title', 'Detyrat',
      'description', 'Open tasks of the person using this link (who=me), or of another person by name, oldest due date first; late=true for the late ones only.',
      'inputSchema', '{"type":"object","properties":{"who":{"type":"string","description":"me, or a person''s name"},"late":{"type":"boolean"}}}'::jsonb, 'annotations', '{"readOnlyHint":true}'::jsonb)
    union all select jsonb_build_object('name', 'create_task', 'title', 'Krijo një detyrë',
      'description', 'Make a task in DrisPRO for the person using this link or for someone else by name (only managers give tasks to others). '
        || 'due is YYYY-MM-DD, priority low | normal | high | urgent. Always confirm the title, person and date with the user before calling.',
      'inputSchema', '{"type":"object","properties":{"title":{"type":"string"},"person":{"type":"string"},"due":{"type":"string"},"priority":{"type":"string","enum":["low","normal","high","urgent"]},"notes":{"type":"string"}},"required":["title"]}'::jsonb,
      'annotations', '{"readOnlyHint":false,"destructiveHint":false}'::jsonb) where p_can_draft
    union all select jsonb_build_object('name', 'safes', 'title', 'Sefi dhe paratë',$n$);
  perform app._patch_function('app.mcp_run',
    $o$  if p_name like 'draft_%' and not 'ai.write' = any (k.scopes) then$o$,
    $n$  if (p_name like 'draft_%' or p_name = 'create_task') and not 'ai.write' = any (k.scopes) then$n$);
  perform app._patch_function('app.mcp_run',
    $o$    when 'safes'                then public.ai_safes(co)$o$,
    $n$    when 'safes'                then public.ai_safes(co)
    when 'tasks'                then app.mcp_tasks(k, i)
    when 'create_task'          then app.mcp_create_task(k, i)$n$);
end $$;
drop function app._patch_function(text, text, text);
