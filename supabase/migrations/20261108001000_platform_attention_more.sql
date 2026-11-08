-- =============================================================================
-- DrisPRO · the platform owner is told about two more things (audit, wave 1)
--   * fiscalization refused at a client in the last 7 days (how many documents)
--   * a client with an active licence that sold nothing for 7 days, when it sold before
--     (a till stopped, a link broke, or the client left: worth a call)
-- =============================================================================
create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_def text; v_oid oid;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname || '.' || p.proname = p_name order by p.oid desc limit 1;
  if v_oid is null then raise exception 'function % not found', p_name; end if;
  v_def := pg_get_functiondef(v_oid);
  if position(p_new in v_def) > 0 then return; end if;
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply', p_name; end if;
  execute replace(v_def, p_old, p_new);
end $$;
select app._patch_function('public.platform_overview',
  $x$     where c.deleted_at is null and l.status = 'active' and app.seats_used(c.id) >= l.max_users and not c.is_training
  ) x;$x$,
  $x$     where c.deleted_at is null and l.status = 'active' and app.seats_used(c.id) >= l.max_users and not c.is_training
    union all
    select jsonb_build_object('kind', 'fiscal_failed', 'rank', 1, 'company_id', c.id, 'company_name', c.name, 'detail', f.n::text, 'at', f.last_at)
      from public.companies c
      join (select g.company_id, count(*) n, max(g.created_at) last_at from public.fiscalization_records g
             where g.status = 'failed' and g.created_at >= now() - interval '7 days'
               and not exists (select 1 from public.fiscalization_records h where h.source_doc_id = g.source_doc_id and h.status = 'fiscalized')
             group by g.company_id) f on f.company_id = c.id
     where c.deleted_at is null and not c.is_training
    union all
    select jsonb_build_object('kind', 'no_sales', 'rank', 4, 'company_id', c.id, 'company_name', c.name, 'at', s.last_at,
                              'days', (current_date - s.last_at::date))
      from public.companies c join public.licenses l on l.company_id = c.id and l.status = 'active'
      join lateral (select greatest((select max(o.order_at) from public.pos_orders o where o.company_id = c.id and o.status = 'paid'),
                                    (select max(i.posted_at) from public.sales_invoices i where i.company_id = c.id and i.status = 'posted')) as last_at) s on true
     where c.deleted_at is null and not c.is_training and s.last_at is not null and s.last_at < now() - interval '7 days'
       and s.last_at >= now() - interval '90 days'
  ) x;$x$);
drop function app._patch_function(text, text, text);
