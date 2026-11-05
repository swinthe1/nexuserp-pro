-- =============================================================================
-- The deep check, phase 1 (part 1):
--   roles     nobody gives rights they do not have themselves; only a full admin changes a full admin
--   the till  receipts, their lines, payments and cash movements are written by the till's functions
--             only, never straight into the tables (they check the session, the PIN, the books)
--   refunds   money back needs a manager when the company asks it for voids too; a refund gives back
--             what was paid on average for the item, and never more than the receipt
-- =============================================================================

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_def text; v_oid oid;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname || '.' || p.proname = p_name order by p.oid desc limit 1;
  if v_oid is null then raise exception 'function % not found', p_name; end if;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply', p_name; end if;
  execute replace(v_def, p_old, p_new);
end $$;

-- ---------------------------------------------------------------- roles
-- the rights of a role that this person lacks (rights of a module the licence does not have do nothing and are left out)
create or replace function app.rights_lacking(p_company uuid, p_perms text[])
returns text language sql stable security definer set search_path = '' as $$
  select string_agg(distinct x, ', ' order by x) from unnest(p_perms) x
   where not app.has_permission(p_company, '*')
     and (x = '*' or not app.has_permission(p_company, x))
     and (x like '*%' or exists (select 1 from public.licenses l where l.company_id = p_company and l.status = 'active'
                                   and current_date between l.valid_from and l.valid_until
                                   and app.module_allowed(l.plan, l.extra_features, split_part(x, '.', 1))))
$$;
revoke execute on function app.rights_lacking(uuid, text[]) from public, anon, authenticated;

select app._patch_function('public.set_member_roles',
  $x$declare m public.company_members;$x$,
  $x$declare m public.company_members; v_bad text;$x$);
select app._patch_function('public.set_member_roles',
  $x$  delete from public.member_roles where member_id = m.id and not (role_id = any (p_role_ids));$x$,
  $x$  -- nobody gives more than they have; a full admin's roles are changed by a full admin only
  if not app.has_permission(m.company_id, '*') then
    if exists (select 1 from public.member_roles mr join public.role_permissions rp on rp.role_id = mr.role_id where mr.member_id = m.id and rp.permission = '*') then
      raise exception 'Only a company admin can change the roles of a company admin' using errcode = '42501';
    end if;
    v_bad := app.rights_lacking(m.company_id, array(select rp.permission from public.role_permissions rp where rp.role_id = any (p_role_ids)));
    if v_bad is not null then raise exception 'You cannot give rights you do not have yourself: %', v_bad using errcode = '42501'; end if;
  end if;
  delete from public.member_roles where member_id = m.id and not (role_id = any (p_role_ids));$x$);

select app._patch_function('public.save_custom_role',
  $x$  if p_role is null then
    v_key := $x$,
  $x$  v_bad := app.rights_lacking(p_company, p_permissions);
  if v_bad is not null then raise exception 'You cannot give rights you do not have yourself: %', v_bad using errcode = '42501'; end if;
  if p_role is null then
    v_key := $x$);

-- ---------------------------------------------------------------- the till's tables: through its functions only
drop policy if exists pos_payments_insert on public.pos_payments;
drop policy if exists pos_cash_movements_insert on public.pos_cash_movements;
drop policy if exists pos_orders_insert on public.pos_orders;
drop policy if exists pos_orders_update on public.pos_orders;
drop policy if exists pos_order_lines_insert on public.pos_order_lines;
drop policy if exists pos_order_lines_update on public.pos_order_lines;
drop policy if exists pos_order_lines_delete on public.pos_order_lines;

-- ---------------------------------------------------------------- refunds
alter table app.pos_approvals drop constraint if exists pos_approvals_purpose_check;
alter table app.pos_approvals add constraint pos_approvals_purpose_check check (purpose in ('void', 'close', 'payout', 'refund'));
select app._patch_function('public.pos_approve',
  $x$if p_purpose not in ('void', 'close', 'payout') then$x$,
  $x$if p_purpose not in ('void', 'close', 'payout', 'refund') then$x$);

-- the manager is asked when the company asks it for voids, the cashier is not a manager, and a manager has a PIN
select app._patch_function('public.pos_submit_order',
  $x$    if v_orig.is_refund then raise exception 'A refund cannot be refunded' using errcode = '23514'; end if;
  end if;$x$,
  $x$    if v_orig.is_refund then raise exception 'A refund cannot be refunded' using errcode = '23514'; end if;
    if coalesce((select pos_void_approval from public.company_settings where company_id = s.company_id), true)
       and not app.has_permission(s.company_id, 'pos.approve')
       and exists (select 1 from app.member_pins mp join public.company_members cm on cm.id = mp.member_id
                    where cm.company_id = s.company_id and cm.status = 'active' and cm.deleted_at is null
                      and app.has_permission_of(cm.user_id, s.company_id, 'pos.approve'))
       and app.pos_approval_user(s.company_id, p ->> 'approval', 'refund', v_order_at) is null then
      raise exception 'A refund needs a manager''s confirmation' using errcode = '42501';
    end if;
  end if;$x$);

-- what was paid for the item on the receipt, on average: a discounted and a full-price line of the same item
select app._patch_function('public.pos_submit_order',
  $x$      select ol.unit_price, ol.discount_pct into v_ol from public.pos_order_lines ol
       where ol.pos_order_id = v_orig.id and ol.variant_id = (l->>'variant_id')::uuid order by ol.line_no limit 1;$x$,
  $x$      select round(sum(ol.line_total) / nullif(sum(ol.quantity), 0), 4) as unit_price, 0::numeric as discount_pct into v_ol
        from public.pos_order_lines ol
       where ol.pos_order_id = v_orig.id and ol.variant_id = (l->>'variant_id')::uuid;$x$);

-- never more back than was paid on the receipt, with the refunds made before
select app._patch_function('public.pos_submit_order',
  $x$  -- payments
  select total into v_total from public.pos_orders where id = v_id;$x$,
  $x$  -- payments
  select total into v_total from public.pos_orders where id = v_id;
  if v_refund and -v_total + coalesce((select -sum(o2.total) from public.pos_orders o2
                                        where o2.refund_of_id = v_orig.id and o2.id <> v_id and o2.status = 'paid'), 0) > v_orig.total + 0.01 then
    raise exception 'Refund is more than what was paid on %', v_orig.number using errcode = '23514';
  end if;$x$);

drop function app._patch_function(text, text, text);
