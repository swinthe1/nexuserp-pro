-- =============================================================================
-- DrisPRO · 20261113000600 · Email without the company's own mailbox
-- A company that has not set up its mailbox can still send invoices, statements and reminders: they go from
-- the platform's mailbox (the mailbox of the platform's own company, the one that bills the clients), with
-- the company's name as the sender's name and the company's email as the address replies go to. The platform
-- owner turns it on in the console; a company's own mailbox, when there is one, always comes first.
-- =============================================================================
alter table public.platform_settings add column if not exists mail_fallback boolean not null default false;

-- the platform's mailbox, dressed for this company, or null when it cannot be used
create or replace function app.mail_fallback(p_company uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('host', a.host, 'port', a.port, 'security', a.security, 'user', a.username, 'pass', a.password,
           'from_name', left(co.name, 120), 'from', a.from_email, 'reply_to', coalesce(nullif(btrim(co.email), ''), a.reply_to), 'platform', true)
    from public.platform_settings s
    join app.mail_accounts a on a.company_id = s.billing_company_id and a.is_active
    join public.companies co on co.id = p_company
   where s.id and s.mail_fallback and s.billing_company_id is not null and s.billing_company_id <> p_company
$$;
revoke execute on function app.mail_fallback(uuid) from public, anon, authenticated;

create or replace function app.mail_ready(p_company uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app.mail_accounts where company_id = p_company and is_active) or app.mail_fallback(p_company) is not null
$$;
revoke execute on function app.mail_ready(uuid) from public, anon, authenticated;

-- every "set up the mailbox first" check accepts the platform's mailbox too
do $$
declare r record; d text; n text; k int := 0;
  -- exists (select 1 from app.mail_accounts [a] where [a.]company_id = X and [a.]is_active), with or without an alias
  v_re text := 'exists \(select 1 from app\.mail_accounts(?: ([a-z]))? where (?:[a-z]\.)?company_id = ([a-z_.]+) and (?:[a-z]\.)?is_active\)';
begin
  for r in select p.oid, n2.nspname || '.' || p.proname as name from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
            where n2.nspname in ('public', 'app') and p.prokind = 'f' and p.proname not in ('mail_ready', 'mail_fallback')
              and pg_get_functiondef(p.oid) ~ v_re loop
    d := pg_get_functiondef(r.oid);
    n := regexp_replace(d, v_re, 'app.mail_ready(\2)', 'g');
    execute n; k := k + 1;
  end loop;
  if k < 6 then raise exception 'mail fallback: only % checks found', k; end if;

  -- the worker gets the platform's mailbox when the company has none
  d := pg_get_functiondef('public.postier_claim(int)'::regprocedure);
  n := replace(d, $a$'mail', case when u.channel = 'email' then (select jsonb_build_object($a$, $a$'mail', case when u.channel = 'email' then coalesce((select jsonb_build_object($a$);
  n := replace(n, $a$where a.company_id = u.company_id and a.is_active) end$a$, $a$where a.company_id = u.company_id and a.is_active), app.mail_fallback(u.company_id)) end$a$);
  if n = d or position('app.mail_fallback(u.company_id)' in n) = 0 then raise exception 'mail fallback: postier_claim not patched'; end if;
  execute n;
end $$;

create or replace function public.platform_set_mail_fallback(p_on boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.platform_settings;
begin
  if not app.is_super_admin() then raise exception 'Only the platform owner' using errcode = '42501'; end if;
  select * into s from public.platform_settings where id;
  if p_on and (s.billing_company_id is null or not exists (select 1 from app.mail_accounts where company_id = s.billing_company_id and is_active)) then
    raise exception 'Set up the mailbox of the platform''s own company first (Contracts › billing company, then its Automations › Email)' using errcode = '55000';
  end if;
  update public.platform_settings set mail_fallback = p_on, updated_at = now() where id;
  return jsonb_build_object('on', p_on);
end $$;
revoke execute on function public.platform_set_mail_fallback(boolean) from public, anon;
grant execute on function public.platform_set_mail_fallback(boolean) to authenticated;

create or replace function public.platform_mail_fallback() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.platform_settings;
begin
  if not app.is_super_admin() then raise exception 'Only the platform owner' using errcode = '42501'; end if;
  select * into s from public.platform_settings where id;
  return jsonb_build_object('on', s.mail_fallback, 'company', (select name from public.companies where id = s.billing_company_id),
    'from', (select from_email from app.mail_accounts where company_id = s.billing_company_id and is_active));
end $$;
revoke execute on function public.platform_mail_fallback() from public, anon;
grant execute on function public.platform_mail_fallback() to authenticated;
