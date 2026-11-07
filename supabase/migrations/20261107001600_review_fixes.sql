-- =============================================================================
-- DrisPRO · fixes from the review of every module
--   * the plans' prices are for the Super Admin only (never on the public website)
--   * the profit report counts only the statutory books (manual management entries stay out)
--   * a year is closed only after the years before it
--   * the background jobs also run on a server without a scheduler (pg_cron)
--   * the portal settings save each control on its own; portal orders use the default warehouse
--   * a transfer already picked is not put on a second pick list
--   * marking the scale prices as sent needs the right to change stock data
-- =============================================================================

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_def text; v_oid oid;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname || '.' || p.proname = p_name order by p.oid desc limit 1;
  if v_oid is null then raise exception 'function % not found', p_name; end if;
  v_def := pg_get_functiondef(v_oid);
  if position(p_new in v_def) > 0 then return; end if;   -- already done
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply', p_name; end if;
  execute replace(v_def, p_old, p_new);
end $$;

-- ---------------------------------------------------------------- prices: the Super Admin only
create or replace function public.public_pricing()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_super_admin() then raise exception 'Only the platform administrator sees the prices' using errcode = '42501'; end if;
  return jsonb_build_object(
    'plans', (select jsonb_agg(jsonb_build_object('plan', p.plan, 'price_month', p.price_month, 'price_year', p.price_year, 'per_user', p.per_user, 'users', p.users,
                'highlight', p.highlight, 'note', p.note, 'features', app.plan_features(p.plan), 'stores', app.plan_max_warehouses(p.plan), 'ai_reads', app.plan_ai_reads(p.plan))
                order by array_position(array['basic', 'standard', 'pro'], p.plan)) from app.public_pricing p),
    'contact', (select jsonb_build_object('email', email, 'phone', phone, 'whatsapp', whatsapp, 'currency', currency, 'vat_note', vat_note) from app.public_contact));
end $$;
revoke execute on function public.public_pricing() from public, anon;
grant execute on function public.public_pricing() to authenticated;

-- ---------------------------------------------------------------- profit: the statutory books only
select app._patch_function('public.profit_report',
  $x$where jl.company_id = p_company and e.status in ('posted', 'reversed') and e.entry_date between v_from and v_to$x$,
  $x$where jl.company_id = p_company and e.status in ('posted', 'reversed') and e.entry_date between v_from and v_to
       and e.reporting_ledger = 'STATUTORY'$x$);

-- ---------------------------------------------------------------- the years close in order
select app._patch_function('public.year_close',
  $x$  if y.end_date >= current_date then raise exception 'The year % has not ended yet', y.name using errcode = '55000'; end if;$x$,
  $x$  if y.end_date >= current_date then raise exception 'The year % has not ended yet', y.name using errcode = '55000'; end if;
  if exists (select 1 from public.fiscal_years f where f.company_id = y.company_id and f.deleted_at is null and f.status <> 'closed' and f.end_date < y.start_date) then
    raise exception 'Close the years before % first', y.name using errcode = '55000';
  end if;$x$);

-- ---------------------------------------------------------------- the jobs on a server without pg_cron
-- (with pg_cron these run on their own schedule; without it, the worker's tick runs them once a day or once an hour)
select app._patch_function('public.automation_tick',
  $x$  return jsonb_build_object('summaries', n_sum, 'reminders', n_dun, 'daily', v_any);$x$,
  $x$  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    if v_hour >= 6 and app.once_today('daily_nocron', '00000000-0000-0000-0000-000000000000', v_day) then
      perform public.run_daily_reminders();
      perform app.contracts_daily();
      perform app.expiry_levels_daily();
    end if;
    if app.once_today('hourly_' || v_hour, '00000000-0000-0000-0000-000000000000', v_day) then
      perform app.tasks_hourly();
      perform public.run_scheduled_replenishment();
      perform app.remind_tills_to_reconcile();
    end if;
  end if;
  return jsonb_build_object('summaries', n_sum, 'reminders', n_dun, 'daily', v_any);$x$);

-- ---------------------------------------------------------------- B2B portal
create or replace function public.portal_settings_save(p_company uuid, p_auto_confirm boolean default null, p_stock text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'sales.approve');
  update public.company_settings set portal_auto_confirm = coalesce(p_auto_confirm, portal_auto_confirm),
         portal_stock = coalesce(p_stock, portal_stock) where company_id = p_company;
end $$;
revoke execute on function public.portal_settings_save(uuid, boolean, text) from public, anon;
grant execute on function public.portal_settings_save(uuid, boolean, text) to authenticated;

select app._patch_function('public.portal_order',
  $x$(select id from public.warehouses where company_id = bp.company_id and deleted_at is null and is_active order by created_at limit 1)$x$,
  $x$(select coalesce((select s.default_warehouse_id from public.company_settings s join public.warehouses dw on dw.id = s.default_warehouse_id
                      where s.company_id = bp.company_id and dw.deleted_at is null and dw.is_active),
                     (select id from public.warehouses where company_id = bp.company_id and deleted_at is null and is_active order by created_at limit 1)))$x$);

-- ---------------------------------------------------------------- picking: a transfer once
select app._patch_function('public.create_transfer_pick_list',
  $x$    if x.is_request then raise exception '% is still a request: accept it first', x.number using errcode = '23514'; end if;$x$,
  $x$    if x.is_request then raise exception '% is still a request: accept it first', x.number using errcode = '23514'; end if;
    if x.picked_at is not null then raise exception 'Transfer % is already picked; send it', x.number using errcode = '23514'; end if;$x$);

-- ---------------------------------------------------------------- scale prices
select app._patch_function('public.scale_mark_sent',
  $x$  perform app.require_permission(p_company, 'inventory.read');$x$,
  $x$  perform app.require_permission(p_company, 'inventory.write');$x$);

-- ---------------------------------------------------------------- the till difference task: once the manager has reconciled the shift
-- (before that the difference may still change, and a cashier counting blind must not learn it from a task)
select app._patch_function('app.tasks_run',
  $x$where ps.company_id = p_company and ps.status = 'closed' and ps.closed_at >= now() - interval '2 days' and abs(coalesce(ps.cash_difference, 0)) > d loop$x$,
  $x$where ps.company_id = p_company and ps.status = 'closed' and coalesce(ps.review_status, 'reconciled') = 'reconciled'
                and coalesce(ps.reviewed_at, ps.closed_at) >= now() - interval '2 days' and abs(coalesce(ps.cash_difference, 0)) > d loop$x$);

drop function app._patch_function(text, text, text);
