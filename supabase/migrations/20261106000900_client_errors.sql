-- =============================================================================
-- The deep check, phase 3: the errors people meet in the app are collected. A page that crashes, a script
-- error, a promise nobody caught: the app sends the message, where it happened and the version, the same
-- error counted once a day with how many times and how many people. The platform owner sees them on the
-- server page. Tokens and keys are taken out before they are kept; 30 days are kept.
-- =============================================================================

create table if not exists public.client_errors (
  id          bigserial primary key,
  fingerprint text not null,
  day         date not null default current_date,
  kind        text not null default 'error' check (kind in ('error', 'promise', 'page', 'chunk')),
  message     text not null,
  stack       text,
  url         text,
  version     text,
  user_agent  text,
  seen_in     uuid,                -- the company open on the screen (not a company table: only the platform reads it)
  users       uuid[] not null default '{}',
  count       int not null default 1,
  first_at    timestamptz not null default now(),
  last_at     timestamptz not null default now(),
  unique (fingerprint, day)
);
alter table public.client_errors enable row level security;
revoke all on public.client_errors from anon, authenticated;
-- read and written only through the functions below
create policy client_errors_none on public.client_errors for select to authenticated using (false);
revoke all on sequence public.client_errors_id_seq from anon, authenticated;

create or replace function app.scrub(p text)
returns text language sql immutable set search_path = '' as $$
  select regexp_replace(regexp_replace(regexp_replace(regexp_replace(coalesce(p, ''),
    'eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}', '[token]', 'g'),
    'sk-ant-[A-Za-z0-9_-]+', '[key]', 'g'),
    '(?i)(bearer\s+)[A-Za-z0-9._-]{12,}', '\1[token]', 'g'),
    '(?i)(apikey|api_key|password|secret|token|access_token|refresh_token)=[^&\s"'']+', '\1=[hidden]', 'g')
$$;

create or replace function public.report_client_error(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_msg text; v_stack text; v_fp text; v_kind text := coalesce(p ->> 'kind', 'error');
begin
  if v_uid is null then return; end if;
  v_msg := left(app.scrub(btrim(coalesce(p ->> 'message', ''))), 500);
  if v_msg = '' then return; end if;
  if v_kind not in ('error', 'promise', 'page', 'chunk') then v_kind := 'error'; end if;
  v_stack := left(app.scrub(p ->> 'stack'), 4000);
  -- the same error is one row a day, whoever meets it (numbers and ids out of the message)
  v_fp := md5(v_kind || '|' || regexp_replace(v_msg, '[0-9a-f]{8}-[0-9a-f-]{27}|[0-9]+', '#', 'gi') || '|' || coalesce(split_part(v_stack, E'\n', 2), ''));
  -- one person cannot flood it: at most 50 new rows an hour
  if (select count(*) from public.client_errors where v_uid = any (users) and first_at > now() - interval '1 hour') >= 50 then return; end if;
  insert into public.client_errors (fingerprint, kind, message, stack, url, version, user_agent, seen_in, users)
  values (v_fp, v_kind, v_msg, v_stack, left(app.scrub(p ->> 'url'), 300), left(p ->> 'version', 40), left(p ->> 'user_agent', 300),
          nullif(p ->> 'company_id', '')::uuid, array[v_uid])
  on conflict (fingerprint, day) do update
    set count = public.client_errors.count + 1, last_at = now(),
        users = case when v_uid = any (public.client_errors.users) or cardinality(public.client_errors.users) >= 200 then public.client_errors.users
                     else public.client_errors.users || v_uid end;
  if random() < 0.02 then delete from public.client_errors where day < current_date - 30; end if;
exception when others then
  return;   -- reporting an error never makes another one
end $$;
revoke execute on function public.report_client_error(jsonb) from public, anon;
grant execute on function public.report_client_error(jsonb) to authenticated;

create or replace function public.platform_client_errors(p_days int default 7)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_super_admin() then raise exception 'Only the platform owner sees this' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(x order by x.last_at desc) from (
    select e.fingerprint, min(e.kind) as kind, min(e.message) as message, (array_agg(e.stack order by e.last_at desc))[1] as stack,
           (array_agg(e.url order by e.last_at desc))[1] as url, (array_agg(e.version order by e.last_at desc))[1] as version,
           sum(e.count)::int as count, (select count(distinct u) from public.client_errors e2, unnest(e2.users) u where e2.fingerprint = e.fingerprint and e2.day >= current_date - p_days)::int as people,
           (select string_agg(distinct c.name, ', ') from public.client_errors e3 join public.companies c on c.id = e3.seen_in
             where e3.fingerprint = e.fingerprint and e3.day >= current_date - p_days) as companies,
           min(e.first_at) as first_at, max(e.last_at) as last_at
      from public.client_errors e where e.day >= current_date - greatest(p_days, 1)
     group by e.fingerprint) x), '[]'::jsonb);
end $$;
revoke execute on function public.platform_client_errors(int) from public, anon;
grant execute on function public.platform_client_errors(int) to authenticated;
