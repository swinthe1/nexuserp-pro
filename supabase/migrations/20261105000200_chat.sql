-- =============================================================================
-- DrisPRO Chat (MVP): the people of a company talk to each other inside the program
--   · one-to-one and group conversations, inside one company only
--   · text, a reply to a message, pictures and files (a private folder per conversation)
--   · edit or delete one's own message within 15 minutes (the deleted text stays in the audit log)
--   · unread counts from one "read up to" mark per member (no per-message receipts)
--   · a phone notification to those who are not looking at the conversation and have not muted it
--   · a DrisPRO link in a message shows as a card, filled with the reader's own rights
-- Each person sees only the conversations they are in.
-- =============================================================================

create table if not exists public.chat_conversations (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  kind             text not null check (kind in ('direct', 'group')),
  title            text check (length(title) <= 80),
  -- a one-to-one conversation is found again by its two people
  direct_key       text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  last_message_at  timestamptz,
  last_preview     text,
  last_sender      uuid
);
create unique index if not exists chat_conversations_direct_key on public.chat_conversations (company_id, direct_key) where direct_key is not null;
create index if not exists chat_conversations_company_idx on public.chat_conversations (company_id, last_message_at desc);

create table if not exists public.chat_members (
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  user_id         uuid not null,
  company_id      uuid not null references public.companies(id) on delete cascade,
  role            text not null default 'member' check (role in ('owner', 'member')),
  joined_at       timestamptz not null default now(),
  last_read_at    timestamptz not null default now(),
  -- when the person last had the conversation open (no phone notification while they look at it)
  last_seen_at    timestamptz,
  muted_until     timestamptz,
  primary key (conversation_id, user_id)
);
create index if not exists chat_members_user_idx on public.chat_members (user_id, company_id);

create table if not exists public.chat_messages (
  id               bigint generated always as identity primary key,
  conversation_id  uuid not null references public.chat_conversations(id) on delete cascade,
  company_id       uuid not null references public.companies(id) on delete cascade,
  sender_id        uuid,
  kind             text not null default 'text' check (kind in ('text', 'system')),
  body             text check (length(body) <= 8000),
  reply_to         bigint references public.chat_messages(id) on delete set null,
  attachments      jsonb not null default '[]',
  created_at       timestamptz not null default now(),
  edited_at        timestamptz,
  deleted_at       timestamptz
);
create index if not exists chat_messages_conv_idx on public.chat_messages (conversation_id, id desc);

-- membership, without going through the policies (they ask the same question)
create or replace function app.chat_is_member(p_conv uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.chat_members where conversation_id = p_conv and user_id = auth.uid())
$$;

alter table public.chat_conversations enable row level security;
alter table public.chat_members enable row level security;
alter table public.chat_messages enable row level security;
revoke all on public.chat_conversations, public.chat_members, public.chat_messages from anon;
revoke insert, update, delete on public.chat_conversations, public.chat_members, public.chat_messages from authenticated;
grant select on public.chat_conversations, public.chat_members, public.chat_messages to authenticated;
drop policy if exists chat_conversations_read on public.chat_conversations;
create policy chat_conversations_read on public.chat_conversations for select to authenticated using (app.chat_is_member(id));
drop policy if exists chat_members_read on public.chat_members;
create policy chat_members_read on public.chat_members for select to authenticated using (app.chat_is_member(conversation_id));
drop policy if exists chat_messages_read on public.chat_messages;
create policy chat_messages_read on public.chat_messages for select to authenticated using (app.chat_is_member(conversation_id));

-- new messages and reads reach the open screens at once
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.chat_messages; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.chat_members; exception when duplicate_object then null; end;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- the files: a private folder per company and conversation
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is null then return; end if;
  insert into storage.buckets (id, name, public) values ('chat-files', 'chat-files', false) on conflict (id) do nothing;
  -- at most 25 MB a file, where the storage knows limits
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
    execute 'update storage.buckets set file_size_limit = 26214400 where id = ''chat-files''';
  end if;
  execute 'drop policy if exists "chat files: read" on storage.objects';
  execute 'drop policy if exists "chat files: upload" on storage.objects';
  execute $p$create policy "chat files: read" on storage.objects for select to authenticated
    using (bucket_id = 'chat-files' and (storage.foldername(name))[1] = any ((select app.my_company_ids())::text[])
           and app.chat_is_member(((storage.foldername(name))[2])::uuid))$p$;
  execute $p$create policy "chat files: upload" on storage.objects for insert to authenticated
    with check (bucket_id = 'chat-files' and (storage.foldername(name))[1] = any ((select app.my_company_ids())::text[])
                and app.chat_is_member(((storage.foldername(name))[2])::uuid))$p$;
end $$;

-- ---------------------------------------------------------------------------------------------
-- starting conversations
-- ---------------------------------------------------------------------------------------------
create or replace function app.chat_require_people(p_company uuid, p_users uuid[])
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not (p_company = any (app.my_company_ids())) then raise exception 'Permission denied' using errcode = '42501'; end if;
  if exists (select 1 from unnest(p_users) u
              where not exists (select 1 from public.company_members m where m.company_id = p_company and m.user_id = u and m.status = 'active')) then
    raise exception 'Only people of this company can be in the conversation' using errcode = '23514';
  end if;
end $$;

-- one-to-one: the same conversation every time for the same two people
create or replace function public.chat_open_direct(p_company uuid, p_user uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_key text; v_id uuid;
begin
  if p_user = auth.uid() then raise exception 'Choose someone else' using errcode = '22023'; end if;
  perform app.chat_require_people(p_company, array[auth.uid(), p_user]);
  v_key := least(auth.uid()::text, p_user::text) || ':' || greatest(auth.uid()::text, p_user::text);
  select id into v_id from public.chat_conversations where company_id = p_company and direct_key = v_key;
  if v_id is null then
    insert into public.chat_conversations (company_id, kind, direct_key) values (p_company, 'direct', v_key) returning id into v_id;
    insert into public.chat_members (conversation_id, user_id, company_id, role)
    values (v_id, auth.uid(), p_company, 'owner'), (v_id, p_user, p_company, 'member');
  end if;
  return v_id;
end $$;

create or replace function public.chat_create_group(p_company uuid, p_title text, p_users uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_users uuid[] := array(select distinct u from unnest(coalesce(p_users, '{}') || auth.uid()) u);
begin
  if length(btrim(coalesce(p_title, ''))) < 2 then raise exception 'Give the group a name' using errcode = '23514'; end if;
  if cardinality(v_users) < 2 then raise exception 'Add at least one person' using errcode = '23514'; end if;
  perform app.chat_require_people(p_company, v_users);
  insert into public.chat_conversations (company_id, kind, title) values (p_company, 'group', btrim(p_title)) returning id into v_id;
  insert into public.chat_members (conversation_id, user_id, company_id, role)
  select v_id, u, p_company, case when u = auth.uid() then 'owner' else 'member' end from unnest(v_users) u;
  insert into public.chat_messages (conversation_id, company_id, sender_id, kind, body) values (v_id, p_company, auth.uid(), 'system', 'created');
  return v_id;
end $$;

create or replace function public.chat_add_members(p_conv uuid, p_users uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare c public.chat_conversations;
begin
  select * into c from public.chat_conversations where id = p_conv;
  if c.id is null or not app.chat_is_member(p_conv) then raise exception 'Conversation not found' using errcode = 'P0002'; end if;
  if c.kind <> 'group' then raise exception 'People are added to a group, not to a one-to-one conversation' using errcode = '23514'; end if;
  perform app.chat_require_people(c.company_id, p_users);
  insert into public.chat_members (conversation_id, user_id, company_id, last_read_at)
  select p_conv, u, c.company_id, now() from unnest(p_users) u on conflict do nothing;
  insert into public.chat_messages (conversation_id, company_id, sender_id, kind, body, attachments)
  values (p_conv, c.company_id, auth.uid(), 'system', 'added', to_jsonb(p_users));
end $$;

create or replace function public.chat_leave(p_conv uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.chat_conversations;
begin
  select * into c from public.chat_conversations where id = p_conv;
  if c.id is null or not app.chat_is_member(p_conv) then raise exception 'Conversation not found' using errcode = 'P0002'; end if;
  if c.kind <> 'group' then raise exception 'A one-to-one conversation cannot be left; mute it instead' using errcode = '23514'; end if;
  insert into public.chat_messages (conversation_id, company_id, sender_id, kind, body) values (p_conv, c.company_id, auth.uid(), 'system', 'left');
  delete from public.chat_members where conversation_id = p_conv and user_id = auth.uid();
end $$;

create or replace function public.chat_rename(p_conv uuid, p_title text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.chat_is_member(p_conv) then raise exception 'Conversation not found' using errcode = 'P0002'; end if;
  if length(btrim(coalesce(p_title, ''))) < 2 then raise exception 'Give the group a name' using errcode = '23514'; end if;
  update public.chat_conversations set title = left(btrim(p_title), 80) where id = p_conv and kind = 'group';
end $$;

-- ---------------------------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------------------------
create or replace function public.chat_send(p_conv uuid, p_body text, p_reply_to bigint default null, p_attachments jsonb default '[]')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.chat_conversations; v_msg public.chat_messages; v_name text; v_preview text; a jsonb;
begin
  select * into c from public.chat_conversations where id = p_conv;
  if c.id is null or not app.chat_is_member(p_conv) then raise exception 'Conversation not found' using errcode = 'P0002'; end if;
  p_attachments := coalesce(p_attachments, '[]');
  if jsonb_typeof(p_attachments) <> 'array' or jsonb_array_length(p_attachments) > 10 then raise exception 'At most 10 files in one message' using errcode = '23514'; end if;
  for a in select * from jsonb_array_elements(p_attachments) loop
    -- only files in this conversation's own folder
    if coalesce(a ->> 'path', '') not like c.company_id::text || '/' || c.id::text || '/%' or length(a ->> 'path') > 400
       or length(coalesce(a ->> 'name', '')) not between 1 and 200 then
      raise exception 'A file of the message is not in this conversation' using errcode = '23514';
    end if;
  end loop;
  if length(btrim(coalesce(p_body, ''))) = 0 and jsonb_array_length(p_attachments) = 0 then raise exception 'Write something' using errcode = '23514'; end if;
  if p_reply_to is not null and not exists (select 1 from public.chat_messages where id = p_reply_to and conversation_id = p_conv) then p_reply_to := null; end if;
  insert into public.chat_messages (conversation_id, company_id, sender_id, body, reply_to, attachments)
  values (p_conv, c.company_id, auth.uid(), nullif(btrim(coalesce(p_body, '')), ''), p_reply_to, p_attachments)
  returning * into v_msg;
  v_preview := left(coalesce(v_msg.body, '📎 ' || (p_attachments -> 0 ->> 'name')), 140);
  update public.chat_conversations set last_message_at = v_msg.created_at, last_preview = v_preview, last_sender = auth.uid() where id = p_conv;
  update public.chat_members set last_read_at = v_msg.created_at, last_seen_at = now() where conversation_id = p_conv and user_id = auth.uid();
  -- the phone: those who are not looking at it now and have not muted it
  select coalesce(nullif(full_name, ''), email) into v_name from public.profiles where id = auth.uid();
  insert into app.push_outbox (subscription_id, title, body, link, company_name, locale)
  select s.id, case when c.kind = 'group' then coalesce(v_name, '') || ' · ' || coalesce(c.title, '') else coalesce(v_name, '') end,
         v_preview, '/chat?c=' || p_conv, (select name from public.companies where id = c.company_id), coalesce(p.locale, 'sq')
    from public.chat_members m
    join public.push_subscriptions s on s.user_id = m.user_id
    left join public.profiles p on p.id = m.user_id
   where m.conversation_id = p_conv and m.user_id <> auth.uid()
     and (m.muted_until is null or m.muted_until < now())
     and (m.last_seen_at is null or m.last_seen_at < now() - interval '30 seconds');
  return to_jsonb(v_msg);
end $$;

create or replace function public.chat_edit(p_id bigint, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.chat_messages;
begin
  select * into m from public.chat_messages where id = p_id;
  if m.id is null or not app.chat_is_member(m.conversation_id) then raise exception 'Message not found' using errcode = 'P0002'; end if;
  if m.sender_id is distinct from auth.uid() or m.kind <> 'text' or m.deleted_at is not null then raise exception 'Only your own messages can be changed' using errcode = '42501'; end if;
  if m.created_at < now() - interval '15 minutes' then raise exception 'A message can be changed within 15 minutes' using errcode = '23514'; end if;
  if length(btrim(coalesce(p_body, ''))) = 0 and jsonb_array_length(m.attachments) = 0 then raise exception 'Write something' using errcode = '23514'; end if;
  insert into public.audit_log (company_id, table_name, record_id, action, old_data, new_data, actor_id)
  values (m.company_id, 'chat_messages', null, 'UPDATE', jsonb_build_object('id', m.id, 'body', m.body), jsonb_build_object('body', p_body), auth.uid());
  update public.chat_messages set body = nullif(btrim(p_body), ''), edited_at = now() where id = p_id;
end $$;

-- the text goes from the conversation; the audit log keeps it for the administrator
create or replace function public.chat_delete(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.chat_messages;
begin
  select * into m from public.chat_messages where id = p_id;
  if m.id is null or not app.chat_is_member(m.conversation_id) then raise exception 'Message not found' using errcode = 'P0002'; end if;
  if m.sender_id is distinct from auth.uid() or m.kind <> 'text' then raise exception 'Only your own messages can be deleted' using errcode = '42501'; end if;
  if m.created_at < now() - interval '15 minutes' then raise exception 'A message can be deleted within 15 minutes' using errcode = '23514'; end if;
  insert into public.audit_log (company_id, table_name, record_id, action, old_data, actor_id)
  values (m.company_id, 'chat_messages', null, 'SOFT_DELETE', jsonb_build_object('id', m.id, 'body', m.body, 'attachments', m.attachments), auth.uid());
  update public.chat_messages set body = null, attachments = '[]', deleted_at = now() where id = p_id;
end $$;

create or replace function public.chat_read(p_conv uuid)
returns void language sql security definer set search_path = '' as $$
  update public.chat_members set last_read_at = now(), last_seen_at = now() where conversation_id = p_conv and user_id = auth.uid()
$$;

create or replace function public.chat_mute(p_conv uuid, p_until timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.chat_is_member(p_conv) then raise exception 'Conversation not found' using errcode = 'P0002'; end if;
  update public.chat_members set muted_until = p_until where conversation_id = p_conv and user_id = auth.uid();
end $$;

-- ---------------------------------------------------------------------------------------------
-- the list and the badge
-- ---------------------------------------------------------------------------------------------
create or replace function public.chat_list(p_company uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(r order by (r ->> 'last_message_at') desc nulls last), '[]') from (
    select jsonb_build_object(
      'id', c.id, 'kind', c.kind, 'last_message_at', coalesce(c.last_message_at, c.created_at), 'last_preview', c.last_preview,
      'last_sender', c.last_sender, 'muted', m.muted_until is not null and m.muted_until > now(),
      'title', case when c.kind = 'group' then c.title else (select coalesce(nullif(p.full_name, ''), p.email) from public.chat_members o join public.profiles p on p.id = o.user_id
                                                            where o.conversation_id = c.id and o.user_id <> auth.uid() limit 1) end,
      'other', case when c.kind = 'direct' then (select o.user_id from public.chat_members o where o.conversation_id = c.id and o.user_id <> auth.uid() limit 1) end,
      'members', (select count(*) from public.chat_members o where o.conversation_id = c.id),
      'unread', (select count(*) from public.chat_messages x where x.conversation_id = c.id and x.created_at > m.last_read_at
                   and x.sender_id is distinct from auth.uid() and x.deleted_at is null and x.kind = 'text')) r
      from public.chat_members m join public.chat_conversations c on c.id = m.conversation_id
     where m.user_id = auth.uid() and m.company_id = p_company and p_company = any (app.my_company_ids())
       and (c.kind = 'group' or c.last_message_at is not null or c.created_by = auth.uid())) t
$$;

create or replace function public.chat_unread(p_company uuid)
returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.chat_members m join public.chat_messages x on x.conversation_id = m.conversation_id
   where m.user_id = auth.uid() and m.company_id = p_company and (m.muted_until is null or m.muted_until < now())
     and x.created_at > m.last_read_at and x.sender_id is distinct from auth.uid() and x.deleted_at is null and x.kind = 'text'
$$;

-- the people one can talk to: everyone active in the company
create or replace function public.chat_people(p_company uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(nullif(p.full_name, ''), p.email), 'email', p.email) order by coalesce(nullif(p.full_name, ''), p.email)), '[]')
    from public.company_members m join public.profiles p on p.id = m.user_id
   where m.company_id = p_company and m.status = 'active' and p_company = any (app.my_company_ids())
$$;

-- a DrisPRO link in a message: what the reader may see of it (their own rights decide; nothing = no access)
create or replace function public.chat_link_card(p_kind text, p_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v jsonb;
begin
  if p_kind = 'sales_invoice' then
    select jsonb_build_object('number', i.number, 'party', (select name from public.business_partners where id = i.partner_id), 'total', i.total, 'currency', i.currency_code, 'status', i.status, 'date', i.invoice_date)
      into v from public.sales_invoices i where i.id = p_id and i.deleted_at is null;
  elsif p_kind = 'vendor_bill' then
    select jsonb_build_object('number', b.number, 'party', (select name from public.business_partners where id = b.vendor_id), 'total', b.total, 'currency', b.currency_code, 'status', b.status, 'date', b.bill_date)
      into v from public.vendor_bills b where b.id = p_id and b.deleted_at is null;
  elsif p_kind = 'sales_order' then
    select jsonb_build_object('number', o.number, 'party', (select name from public.business_partners where id = o.partner_id), 'total', o.total, 'currency', o.currency_code, 'status', o.status, 'date', o.order_date)
      into v from public.sales_orders o where o.id = p_id and o.deleted_at is null;
  elsif p_kind = 'purchase_order' then
    select jsonb_build_object('number', o.number, 'party', (select name from public.business_partners where id = o.vendor_id), 'total', o.total, 'currency', o.currency_code, 'status', o.status, 'date', o.order_date)
      into v from public.purchase_orders o where o.id = p_id and o.deleted_at is null;
  elsif p_kind = 'product' then
    select jsonb_build_object('number', p.code, 'party', p.name, 'total', p.sales_price, 'status', case when p.is_active then 'active' else 'inactive' end)
      into v from public.products p where p.id = p_id and p.deleted_at is null;
  elsif p_kind = 'partner' then
    select jsonb_build_object('number', bp.code, 'party', bp.name, 'status', case when bp.is_active then 'active' else 'inactive' end, 'tax_number', bp.tax_number)
      into v from public.business_partners bp where bp.id = p_id and bp.deleted_at is null;
  end if;
  return v;
end $$;

revoke all on function public.chat_open_direct(uuid, uuid), public.chat_create_group(uuid, text, uuid[]), public.chat_add_members(uuid, uuid[]),
  public.chat_leave(uuid), public.chat_rename(uuid, text), public.chat_send(uuid, text, bigint, jsonb), public.chat_edit(bigint, text),
  public.chat_delete(bigint), public.chat_read(uuid), public.chat_mute(uuid, timestamptz), public.chat_list(uuid), public.chat_unread(uuid),
  public.chat_people(uuid), public.chat_link_card(text, uuid) from public, anon;
grant execute on function public.chat_open_direct(uuid, uuid), public.chat_create_group(uuid, text, uuid[]), public.chat_add_members(uuid, uuid[]),
  public.chat_leave(uuid), public.chat_rename(uuid, text), public.chat_send(uuid, text, bigint, jsonb), public.chat_edit(bigint, text),
  public.chat_delete(bigint), public.chat_read(uuid), public.chat_mute(uuid, timestamptz), public.chat_list(uuid), public.chat_unread(uuid),
  public.chat_people(uuid), public.chat_link_card(text, uuid) to authenticated;
