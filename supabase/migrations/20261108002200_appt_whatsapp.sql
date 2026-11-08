-- =============================================================================
-- DrisPRO · the appointment reminder also goes by WhatsApp (audit, wave 2)
--   The day before, a client with a phone gets the reminder on WhatsApp (the company's WhatsApp
--   module and the switch "Appointment reminders by WhatsApp"), by the approved template
--   "drispro_termin": {{1}} client, {{2}} company, {{3}} date, {{4}} time. Email as before, for the
--   clients with an email address.
-- =============================================================================
alter table public.company_settings add column if not exists appt_whatsapp boolean not null default false;

create or replace function app.appt_reminders()
returns integer language plpgsql security definer set search_path = '' as $$
declare a record; n int := 0; v_sent boolean;
begin
  for a in select ap.*, co.name as company, coalesce(co.timezone, 'Europe/Tirane') as tz, s.name as service, r.name as resource,
                  coalesce(cs.appt_whatsapp, false) and app.has_feature(ap.company_id, 'whatsapp') as wa,
                  exists (select 1 from app.mail_accounts m where m.company_id = ap.company_id and m.is_active) as mail
             from public.appointments ap join public.companies co on co.id = ap.company_id
             join public.appt_resources r on r.id = ap.resource_id left join public.appt_services s on s.id = ap.service_id
             left join public.company_settings cs on cs.company_id = ap.company_id
            where ap.deleted_at is null and ap.status in ('booked', 'confirmed') and ap.reminded_at is null
              and (ap.starts_at at time zone coalesce(co.timezone, 'Europe/Tirane'))::date = (now() at time zone coalesce(co.timezone, 'Europe/Tirane'))::date + 1 loop
    v_sent := false;
    if a.mail and a.client_email is not null then
      perform app.enqueue_message(a.company_id, 'email', a.client_email, 'Kujtesë: termini juaj nesër te ' || a.company,
        format(E'Përshëndetje %s,\n\nJu kujtojmë terminin tuaj nesër, %s në orën %s%s%s.\n\nNëse nuk mund të vini, ju lutemi na njoftoni.\n\n%s',
               a.client_name, to_char(a.starts_at at time zone a.tz, 'DD.MM.YYYY'), to_char(a.starts_at at time zone a.tz, 'HH24:MI'),
               coalesce(' për ' || a.service, ''), case when a.resource is not null then ' (' || a.resource || ')' else '' end, a.company),
        null, 'reminder', null, 'appt:' || a.id, 'appointments', a.id);
      v_sent := true;
    end if;
    if a.wa and coalesce(btrim(a.client_phone), '') <> '' then
      perform app.enqueue_message(a.company_id, 'whatsapp', a.client_phone, null,
        format('Përshëndetje %s, ju kujtojmë terminin nesër te %s, %s në orën %s.', a.client_name, a.company,
               to_char(a.starts_at at time zone a.tz, 'DD.MM.YYYY'), to_char(a.starts_at at time zone a.tz, 'HH24:MI')),
        null, 'reminder',
        jsonb_build_object('name', 'drispro_termin', 'language', 'sq', 'params', jsonb_build_array(a.client_name, a.company,
          to_char(a.starts_at at time zone a.tz, 'DD.MM.YYYY'), to_char(a.starts_at at time zone a.tz, 'HH24:MI'))),
        'appt-wa:' || a.id, 'appointments', a.id);
      v_sent := true;
    end if;
    if v_sent then
      update public.appointments set reminded_at = now() where id = a.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

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
select app._patch_function('public.messaging_settings', $x$'dunning_whatsapp', s.dunning_whatsapp,$x$,
  $x$'dunning_whatsapp', s.dunning_whatsapp, 'appt_whatsapp', s.appt_whatsapp,$x$);
select app._patch_function('public.messaging_settings_save', $x$    dunning_whatsapp = coalesce((p ->> 'dunning_whatsapp')::boolean, dunning_whatsapp),$x$,
  $x$    dunning_whatsapp = coalesce((p ->> 'dunning_whatsapp')::boolean, dunning_whatsapp),
    appt_whatsapp = coalesce((p ->> 'appt_whatsapp')::boolean, appt_whatsapp),$x$);
drop function app._patch_function(text, text, text);
