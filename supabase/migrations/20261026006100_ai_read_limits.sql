-- =============================================================================
-- DrisPRO · how many supplier invoices a company may read with AI each month
--   By plan: Trial 30, Basic 100, Standard 300, Pro 1000; the platform owner can give one
--   client another number (licenses.ai_reads_limit). Counted per company and calendar month,
--   in the cloud and on local servers alike; a file that could not be read does not count.
--   The platform owner sees, per client, how many were read and what they cost.
-- =============================================================================

alter table public.licenses add column ai_reads_limit int check (ai_reads_limit is null or ai_reads_limit >= 0);
grant select (ai_reads_limit) on public.licenses to authenticated;

create or replace function app.plan_ai_reads(p_plan text)
returns int language sql immutable set search_path = '' as $$
  select case p_plan when 'trial' then 30 when 'basic' then 100 when 'standard' then 300 else 1000 end
$$;

create or replace function app.ai_reads_limit(p_company uuid)
returns int language sql stable security definer set search_path = '' as $$
  select coalesce((select coalesce(l.ai_reads_limit, app.plan_ai_reads(l.plan)) from public.licenses l where l.company_id = p_company), app.plan_ai_reads('pro'))
$$;

-- this month's reads that count (all but those that could not be read)
create or replace function app.ai_reads_used(p_company uuid)
returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int from app.document_reads d
   where d.company_id = p_company and d.status <> 'failed'
     and d.created_at >= (date_trunc('month', now() at time zone coalesce((select timezone from public.companies where id = p_company), 'Europe/Tirane'))
                          at time zone coalesce((select timezone from public.companies where id = p_company), 'Europe/Tirane'))
$$;

create or replace function app.ai_reads_check(p_company uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
declare v_limit int := app.ai_reads_limit(p_company);
begin
  if app.ai_reads_used(p_company) >= v_limit then
    raise exception 'This company has read % invoices this month, the limit of its plan; reading starts again on the 1st', v_limit using errcode = '54000';
  end if;
end $$;

create or replace function public.ai_reads_usage(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'core.read');
  return jsonb_build_object('used', app.ai_reads_used(p_company), 'limit', app.ai_reads_limit(p_company));
end $$;
grant execute on function public.ai_reads_usage(uuid) to authenticated;

-- the limit, where the files come in
create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;
select app._patch_function('public.doc_read_submit',
  $x$  v_bytes := decode(regexp_replace(coalesce(p_file, ''), '^data:[^,]*,', ''), 'base64');$x$,
  $x$  perform app.ai_reads_check(p_company);
  v_bytes := decode(regexp_replace(coalesce(p_file, ''), '^data:[^,]*,', ''), 'base64');$x$);
-- a local server: the company's own plan limit, instead of the flat 500
select app._patch_function('public.licence_read_submit',
  $x$  select count(*) into v_month from app.document_reads where relay_licence = l.code and created_at > date_trunc('month', now());
  if v_month >= 500 then raise exception 'This licence has read 500 invoices this month' using errcode = '54000'; end if;$x$,
  $x$  perform app.ai_reads_check(l.company_id);$x$);
drop function app._patch_function(text, text, text);

-- the platform owner: per client, this month and the months before
create or replace function public.platform_ai_usage(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_super_admin();
  return jsonb_build_object(
    'used', app.ai_reads_used(p_company), 'limit', app.ai_reads_limit(p_company),
    'override', (select ai_reads_limit from public.licenses where company_id = p_company),
    'plan_limit', app.plan_ai_reads((select plan from public.licenses where company_id = p_company)),
    'months', coalesce((select jsonb_agg(m order by m ->> 'month' desc) from (
        select jsonb_build_object('month', to_char(date_trunc('month', created_at), 'YYYY-MM'), 'reads', count(*) filter (where status <> 'failed'),
                 'failed', count(*) filter (where status = 'failed'),
                 'input_tokens', coalesce(sum(input_tokens), 0), 'output_tokens', coalesce(sum(output_tokens), 0),
                 -- Claude Sonnet: $2 per million tokens in, $10 out
                 'cost_usd', round((coalesce(sum(input_tokens), 0) * 2 + coalesce(sum(output_tokens), 0) * 10) / 1000000.0, 2)) as m
          from app.document_reads where company_id = p_company and created_at > now() - interval '6 months'
         group by date_trunc('month', created_at)) x), '[]'::jsonb));
end $$;
grant execute on function public.platform_ai_usage(uuid) to authenticated;

create or replace function public.platform_set_ai_limit(p_company uuid, p_limit int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_super_admin();
  update public.licenses set ai_reads_limit = p_limit where company_id = p_company;
  if not found then raise exception 'Company not found' using errcode = 'P0002'; end if;
end $$;
grant execute on function public.platform_set_ai_limit(uuid, int) to authenticated;
