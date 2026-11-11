-- =============================================================================
-- Requests while the program is being built: anyone in a company asks to add, take out, change or join
-- something, or reports a mistake, right on the page where they see it. The program keeps the page, the
-- spot they pointed at, a picture of the screen, who, when and the version. Everyone sees the requests (only
-- their own company's pictures), can say "me too", and the platform owner sorts them, answers and marks
-- them done. One switch on the platform turns the whole thing off when the program is finished.
-- =============================================================================

alter table public.platform_settings add column if not exists requests_on boolean not null default true;

create table if not exists public.change_requests (
  id           uuid primary key default gen_random_uuid(),
  number       int generated always as identity unique,
  company_id   uuid not null references public.companies(id) on delete cascade deferrable,
  author_id    uuid references auth.users(id) on delete set null deferrable,
  author_name  text,
  kind         text not null check (kind in ('add', 'remove', 'change', 'merge', 'bug')),
  body         text not null check (length(btrim(body)) between 3 and 4000),
  detail       text,              -- the request written out in detail by the AI and confirmed by the person
  page_path    text,
  page_title   text,
  target       text,              -- the spot the person pointed at, in words (button, column, field)
  screenshot   text,              -- path in the 'attachments' bucket: <company>/requests/<file>
  version      text,
  screen       text,
  status       text not null default 'new' check (status in ('new', 'accepted', 'in_progress', 'done', 'rejected')),
  done_version text,
  reply        text,              -- the platform owner's answer to the person
  duplicate_of uuid references public.change_requests(id) on delete set null deferrable,
  votes        uuid[] not null default '{}',   -- "me too"
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists change_requests_created_idx on public.change_requests (created_at desc);
alter table public.change_requests enable row level security;
revoke all on public.change_requests from anon, authenticated;
-- read and written only through the functions below
create policy change_requests_none on public.change_requests for select to authenticated using (false);

-- pictures: anyone in the company may put one under <company>/requests/, the platform owner reads them all
create policy "requests: upload picture" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and (storage.foldername(name))[2] = 'requests'
              and (storage.foldername(name))[1] = any ((select app.my_company_ids())::text[]));
create policy "requests: platform reads pictures" on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[2] = 'requests' and (select app.is_super_admin()));

create or replace function public.change_requests_on()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select requests_on from public.platform_settings where id), true)
$$;
revoke execute on function public.change_requests_on() from public, anon;
grant execute on function public.change_requests_on() to authenticated;

create or replace function public.change_request_submit(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_co uuid := nullif(p ->> 'company_id', '')::uuid; v_shot text := nullif(p ->> 'screenshot', '');
        v_row public.change_requests;
begin
  if v_uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if not public.change_requests_on() then raise exception 'Requests are closed' using errcode = 'P0001'; end if;
  if v_co is null or not (v_co = any (app.my_company_ids())) then raise exception 'Not your company' using errcode = '42501'; end if;
  if v_shot is not null and split_part(v_shot, '/', 1) <> v_co::text then v_shot := null; end if;
  -- one person cannot flood it
  if (select count(*) from public.change_requests where author_id = v_uid and created_at > now() - interval '1 hour') >= 60 then
    raise exception 'Too many requests in an hour' using errcode = 'P0001';
  end if;
  insert into public.change_requests (company_id, author_id, author_name, kind, body, detail, page_path, page_title, target, screenshot, version, screen)
  values (v_co, v_uid,
          coalesce(nullif(btrim((select full_name from public.profiles where id = v_uid)), ''), (select split_part(email, '@', 1) from public.profiles where id = v_uid)),
          p ->> 'kind', btrim(p ->> 'body'), nullif(left(btrim(p ->> 'detail'), 6000), ''), left(p ->> 'page_path', 300), left(p ->> 'page_title', 200), left(p ->> 'target', 500),
          v_shot, left(p ->> 'version', 40), left(p ->> 'screen', 40))
  returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'number', v_row.number);
end $$;
revoke execute on function public.change_request_submit(jsonb) from public, anon;
grant execute on function public.change_request_submit(jsonb) to authenticated;

-- everyone sees all requests; the company's name and the picture only for their own company (the owner sees all)
create or replace function public.change_requests_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_admin boolean := app.is_super_admin(); v_mine uuid[] := app.my_company_ids();
begin
  if v_uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'number', r.number, 'kind', r.kind, 'body', r.body, 'detail', r.detail, 'page_path', r.page_path, 'page_title', r.page_title,
      'target', r.target, 'status', r.status, 'done_version', r.done_version, 'reply', r.reply, 'duplicate_of', r.duplicate_of,
      'duplicate_number', (select d.number from public.change_requests d where d.id = r.duplicate_of),
      'author_name', r.author_name, 'mine', r.author_id = v_uid, 'votes', cardinality(r.votes), 'voted', v_uid = any (r.votes),
      'own_company', r.company_id = any (v_mine),
      'company', case when v_admin or r.company_id = any (v_mine) then (select c.name from public.companies c where c.id = r.company_id) end,
      'screenshot', case when v_admin or r.company_id = any (v_mine) then r.screenshot end,
      'version', r.version, 'screen', r.screen, 'created_at', r.created_at, 'updated_at', r.updated_at)
    order by r.created_at desc) from public.change_requests r), '[]'::jsonb);
end $$;
revoke execute on function public.change_requests_list() from public, anon;
grant execute on function public.change_requests_list() to authenticated;

create or replace function public.change_request_vote(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  update public.change_requests
     set votes = case when v_uid = any (votes) then array_remove(votes, v_uid) else votes || v_uid end
   where id = p_id and author_id is distinct from v_uid;
end $$;
revoke execute on function public.change_request_vote(uuid) from public, anon;
grant execute on function public.change_request_vote(uuid) to authenticated;

-- the person takes back their own request while nobody has looked at it yet
create or replace function public.change_request_withdraw(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.change_requests where id = p_id and status = 'new'
     and (author_id = auth.uid() or app.is_super_admin());
  if not found then raise exception 'Only your own new request can be taken back' using errcode = 'P0001'; end if;
end $$;
revoke execute on function public.change_request_withdraw(uuid) from public, anon;
grant execute on function public.change_request_withdraw(uuid) to authenticated;

-- the platform owner: status, answer, the version it came in, or "the same as K-…"; the person is told
create or replace function public.change_request_update(p_id uuid, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old public.change_requests; v_new public.change_requests; v_dup uuid;
begin
  if not app.is_super_admin() then raise exception 'Only the platform owner' using errcode = '42501'; end if;
  select * into v_old from public.change_requests where id = p_id for update;
  if not found then raise exception 'Request not found' using errcode = 'P0002'; end if;
  if p ? 'duplicate_of' then
    v_dup := nullif(p ->> 'duplicate_of', '')::uuid;
    if v_dup = p_id then raise exception 'A request cannot be the same as itself' using errcode = 'P0001'; end if;
  else v_dup := v_old.duplicate_of; end if;
  update public.change_requests set
    status       = coalesce(nullif(p ->> 'status', ''), status),
    done_version = case when p ? 'done_version' then nullif(btrim(p ->> 'done_version'), '') else done_version end,
    reply        = case when p ? 'reply' then nullif(btrim(p ->> 'reply'), '') else reply end,
    duplicate_of = v_dup,
    updated_at   = now()
  where id = p_id returning * into v_new;
  -- the same as another: the people who asked count there too
  if v_dup is not null and v_dup is distinct from v_old.duplicate_of then
    update public.change_requests d set votes = (select coalesce(array_agg(distinct u), '{}') from unnest(d.votes || v_new.votes || v_new.author_id) u
                                                  where u is not null and u is distinct from d.author_id)
     where d.id = v_dup;
  end if;
  if v_new.author_id is not null and (v_new.status <> v_old.status or v_new.reply is distinct from v_old.reply) then
    insert into public.notifications (company_id, user_id, type, title, body, link)
    values (v_new.company_id, v_new.author_id, 'info',
            'K-' || lpad(v_new.number::text, 4, '0') || ': ' || case v_new.status when 'accepted' then 'pranuar' when 'in_progress' then 'në punë'
              when 'done' then 'kryer' || coalesce(' në ' || v_new.done_version, '') when 'rejected' then 'refuzuar' else 'e re' end,
            coalesce(v_new.reply, left(v_new.body, 200)), '/requests?k=' || v_new.number);
  end if;
end $$;
revoke execute on function public.change_request_update(uuid, jsonb) from public, anon;
grant execute on function public.change_request_update(uuid, jsonb) to authenticated;

create or replace function public.platform_set_requests_on(p_on boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_super_admin() then raise exception 'Only the platform owner' using errcode = '42501'; end if;
  update public.platform_settings set requests_on = p_on, updated_at = now() where id;
end $$;
revoke execute on function public.platform_set_requests_on(boolean) from public, anon;
grant execute on function public.platform_set_requests_on(boolean) to authenticated;

-- "Write it out in detail": the AI turns the person's few words into a clear request; the person reads it and
-- confirms it before it is sent. It goes through the same queue the cloud uses for AI answers (the server's worker).
create or replace function public.change_request_detail_start(p_company uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_id uuid; v_tag text; v_lang text;
begin
  if v_uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if not public.change_requests_on() then raise exception 'Requests are closed' using errcode = 'P0001'; end if;
  if p_company is null or not (p_company = any (app.my_company_ids())) then raise exception 'Not your company' using errcode = '42501'; end if;
  if length(btrim(coalesce(p ->> 'body', ''))) < 3 then raise exception 'Write the request first' using errcode = '22023'; end if;
  v_tag := 'request:' || v_uid;
  if (select count(*) from app.ai_relay where licence = v_tag and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many requests in an hour' using errcode = 'P0001';
  end if;
  v_lang := case when p ->> 'lang' = 'sr' then 'Serbian (Latin script)' else 'Albanian' end;
  insert into app.ai_relay (company_id, licence, request) values (p_company, v_tag, jsonb_build_object(
    'max_tokens', 900,
    'system', 'You help the testers of DrisPRO, a business program (stock, sales, purchases, till, finance, payroll, taxes for Kosovo), '
      || 'write their change requests for the developer. Rewrite the tester''s request as a clear, detailed request in ' || v_lang
      || ', in plain words the tester understands. Use these short parts, each on its own line, with no markdown headings or bold: '
      || '"Çka:" what to add, remove, change, join or fix, naming the page and the exact spot; "Pse:" the reason, only if the tester gave one; '
      || '"Si duhet të duket:" the result expected, step by step if it has steps; "Pyetje:" only what is truly unclear, at most 3 questions. '
      || 'Keep every detail the tester gave. Do not invent numbers, names, rules or reasons the tester did not give. '
      || 'Keep it short: at most 12 lines. Answer with the request only, no greeting and no comments about it.',
    'messages', jsonb_build_array(jsonb_build_object('role', 'user', 'content',
      'Kind: ' || coalesce(p ->> 'kind', '') || E'\nPage: ' || coalesce(p ->> 'page_title', '') || ' (' || coalesce(p ->> 'page_path', '') || ')'
      || coalesce(E'\nSpot the tester pointed at: ' || nullif(p ->> 'target', ''), '')
      || E'\nThe tester wrote:\n' || left(btrim(p ->> 'body'), 4000)))))
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.change_request_detail_start(uuid, jsonb) from public, anon;
grant execute on function public.change_request_detail_start(uuid, jsonb) to authenticated;

create or replace function public.change_request_detail_result(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r app.ai_relay;
begin
  select * into r from app.ai_relay where id = p_id and licence = 'request:' || auth.uid();
  if r.id is null then raise exception 'Not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('status', r.status, 'error', case when r.status = 'failed' then 'The AI could not answer now' end,
    'text', case when r.status = 'done' then (select string_agg(c ->> 'text', '') from jsonb_array_elements(r.response -> 'content') c where c ->> 'type' = 'text') end);
end $$;
revoke execute on function public.change_request_detail_result(uuid) from public, anon;
grant execute on function public.change_request_detail_result(uuid) to authenticated;
