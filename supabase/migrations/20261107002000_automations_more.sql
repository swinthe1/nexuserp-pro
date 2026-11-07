-- =============================================================================
-- DrisPRO · more work done by itself (from the review, approved by the owner)
--   * a purchase order e-mailed to the supplier on approval is marked "sent" at once
--   * daily: approvals waiting more than two days → a task for the company's administrator
--   * daily: clock-ins left without a clock-out → one task for HR to fix them (the hours are not invented)
--   * daily (hotel): rooms with a guest staying become "to clean"; stays not arrived or not left by
--     their date → a task for the front desk
--   * daily: members whose membership ends in 3 days get a renewal e-mail (when the company has a mailbox)
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

-- ---------------------------------------------------------------- the order e-mailed is the order sent
select app._patch_function('app.tg_po_email',
  $x$    perform app.po_email(new.id, null);$x$,
  $x$    perform app.po_email(new.id, null);
    update public.purchase_orders set status = 'sent' where id = new.id and status = 'approved';$x$);

-- ---------------------------------------------------------------- the daily extras
create or replace function app.automations_daily_more(p_company uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.companies; tz text; v_today date; r record; v_n int; v_who uuid;
  n_appr int := 0; n_att int := 0; n_rooms int := 0; n_desk int := 0; n_mem int := 0;
begin
  select * into c from public.companies where id = p_company and deleted_at is null;
  if c.id is null then return null; end if;
  tz := coalesce(c.timezone, 'Europe/Tirane');
  v_today := (now() at time zone tz)::date;

  -- approvals waiting more than two days
  begin
    v_who := app.first_with_role(p_company, array['company_admin']);
    for r in select a.id, a.document_number, a.doc_type from public.approval_requests a
              where a.company_id = p_company and a.status = 'pending' and a.requested_at < now() - interval '2 days' loop
      if app.auto_task(p_company, 'approval_wait:' || r.id, 'Miratimi pret prej më shumë se 2 ditësh: ' || coalesce(r.document_number, r.doc_type),
                       v_who, v_today, 1::smallint, 'approval_requests', r.id, coalesce(r.document_number, '')) then n_appr := n_appr + 1; end if;
    end loop;
  exception when others then raise warning 'approvals (%): %', p_company, sqlerrm;
  end;

  -- clock-ins of earlier days without a clock-out: HR fixes them (the program does not guess the hours)
  begin
    select count(*) into v_n from public.attendance_records
     where company_id = p_company and check_out is null and work_date < v_today and work_date >= v_today - 14;
    if v_n > 0 then
      if app.auto_task(p_company, 'attendance_open:' || v_today, 'Hyrje pa dalje: ' || v_n || ' regjistrime për t''u plotësuar',
                       app.first_with_role(p_company, array['hr_manager', 'company_admin']), v_today, 2::smallint, null, null, null) then n_att := v_n; end if;
    end if;
  exception when others then raise warning 'attendance (%): %', p_company, sqlerrm;
  end;

  -- hotel: a room with a guest staying is cleaned every morning; arrivals and departures that did not happen
  if exists (select 1 from public.hotel_rooms where company_id = p_company and deleted_at is null) then
    begin
      update public.hotel_rooms h set housekeeping = 'dirty', updated_at = now()
        from public.hotel_reservations s
       where s.room_id = h.id and s.company_id = p_company and s.status = 'checked_in' and s.deleted_at is null
         and s.check_in < v_today and h.housekeeping = 'clean';
      get diagnostics n_rooms = row_count;
      v_who := app.first_with_role(p_company, array['store_manager', 'company_admin']);
      for r in select s.id, s.number, s.guest_name, s.status from public.hotel_reservations s
                where s.company_id = p_company and s.deleted_at is null
                  and ((s.status in ('booked', 'confirmed') and s.check_in < v_today) or (s.status = 'checked_in' and s.check_out < v_today)) loop
        if app.auto_task(p_company, 'stay:' || r.id || ':' || r.status,
                         case when r.status = 'checked_in' then 'Mysafiri ka kaluar datën e largimit: ' else 'Mysafiri nuk erdhi: ' end || coalesce(r.guest_name, r.number),
                         v_who, v_today, 1::smallint, 'hotel_reservations', r.id, r.number) then n_desk := n_desk + 1; end if;
      end loop;
    exception when others then raise warning 'hotel (%): %', p_company, sqlerrm;
    end;
  end if;

  -- members: a renewal e-mail three days before the end (when the company has a mailbox and the member an e-mail)
  if exists (select 1 from app.mail_accounts a where a.company_id = p_company and a.is_active) then
    begin
      for r in select m.id, m.ends_on, p.email, p.name, pl.name as plan from public.memberships m
                 join public.business_partners p on p.id = m.partner_id left join public.membership_plans pl on pl.id = m.plan_id
                where m.company_id = p_company and m.deleted_at is null and m.status = 'active' and m.renewed_by is null
                  and m.ends_on = v_today + 3 and coalesce(p.email, '') like '%@%' loop
        perform app.enqueue_message(p_company, 'email', r.email, 'Anëtarësia juaj mbaron më ' || to_char(r.ends_on, 'DD.MM.YYYY'),
          'Përshëndetje ' || coalesce(r.name, '') || ',' || E'\n\n' || 'Anëtarësia juaj' || coalesce(' (' || r.plan || ')', '') || ' mbaron më '
            || to_char(r.ends_on, 'DD.MM.YYYY') || '. Ju presim ta vazhdoni.' || E'\n\n' || c.name,
          null, 'membership_renewal', null, 'membership_renewal:' || r.id, 'memberships', r.id);
        n_mem := n_mem + 1;
      end loop;
    exception when others then raise warning 'memberships (%): %', p_company, sqlerrm;
    end;
  end if;

  return jsonb_build_object('approval_tasks', n_appr, 'open_clock_ins', n_att, 'rooms_to_clean', n_rooms, 'desk_tasks', n_desk, 'renewal_mails', n_mem);
end $$;
revoke all on function app.automations_daily_more(uuid) from public;

select app._patch_function('app.automations_daily',
  $x$  return jsonb_build_object('quotes_expired', n_exp,$x$,
  $x$  perform app.automations_daily_more(p_company);
  return jsonb_build_object('quotes_expired', n_exp,$x$);

drop function app._patch_function(text, text, text);

-- ---------------------------------------------------------------- a quote or an order e-mailed is sent
-- (one "send" instead of "send by e-mail" and then "mark as sent")
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.document_email(text, uuid, text, text, text, text, text)'::regprocedure);
  if position('mark it sent' in v_def) = 0 then
    v_def := replace(v_def,
      $x$  return app.email_pdf(v_co, p_to, coalesce(nullif(btrim(p_subject), ''), v ->> 'number'), p_message, p_pdf, p_filename, p_kind, p_id);$x$,
      $x$  -- a draft quote or an approved purchase order that goes out by e-mail: mark it sent
  if p_kind in ('sales_quote', 'proforma_quote') then
    update public.sales_quotes set status = 'sent' where id = p_id and status = 'draft';
  elsif p_kind = 'purchase_order' then
    update public.purchase_orders set status = 'sent' where id = p_id and status = 'approved';
  end if;
  return app.email_pdf(v_co, p_to, coalesce(nullif(btrim(p_subject), ''), v ->> 'number'), p_message, p_pdf, p_filename, p_kind, p_id);$x$);
    if position('mark it sent' in v_def) = 0 then raise exception 'patch for document_email does not apply'; end if;
    execute v_def;
  end if;
end $$;
