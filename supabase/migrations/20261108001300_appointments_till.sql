-- =============================================================================
-- DrisPRO · an appointment is paid at the till (audit, wave 1)
--   A salon or clinic client who pays in cash gets a till receipt (fiscal coupon), not an invoice:
--   "Pay at the till" opens the till with the service, its price and the client already on the sale.
--   When the sale is finished, the appointment is marked done and remembers the receipt.
-- =============================================================================
alter table public.appointments add column if not exists pos_client_uuid uuid;
comment on column public.appointments.pos_client_uuid is 'The till sale that paid it (the sale''s client_uuid, also before it reaches the server)';

-- what the till needs to sell an appointment: the service's item, its name, the price with VAT and the client
create or replace function public.appt_for_till(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.appointments; s public.appt_services; v_partner uuid; v_rate numeric; v_tax uuid;
begin
  select * into a from public.appointments where id = p_id and deleted_at is null;
  if a.id is null then raise exception 'Appointment not found' using errcode = 'P0002'; end if;
  if not (app.has_permission(a.company_id, 'pos.write') or app.has_permission(a.company_id, 'sales.write')) then
    raise exception 'Permission denied: pos.write required' using errcode = '42501';
  end if;
  if a.invoice_id is not null or a.pos_client_uuid is not null then raise exception 'This appointment is paid already' using errcode = '55000'; end if;
  if a.status in ('cancelled', 'no_show') then raise exception 'A cancelled appointment is not paid' using errcode = '55000'; end if;
  select * into s from public.appt_services where id = a.service_id;
  if s.id is null then raise exception 'The appointment has no service to sell' using errcode = '23514'; end if;
  if s.variant_id is null then
    update public.appt_services set variant_id = app.service_variant(a.company_id, s.name, s.price, s.tax_code_id, 'SRV') where id = s.id returning variant_id into s.variant_id;
  end if;
  v_partner := app.client_for(a.company_id, a.partner_id, a.client_name, a.client_phone, a.client_email, 'K');
  update public.appointments set partner_id = v_partner where id = a.id and partner_id is distinct from v_partner;
  v_tax := coalesce(s.tax_code_id, (select p.sales_tax_code_id from public.product_variants v join public.products p on p.id = v.product_id where v.id = s.variant_id),
                    (select default_sales_tax_code_id from public.company_settings where company_id = a.company_id));
  select coalesce(rate, 0) into v_rate from public.tax_codes where id = v_tax;
  return jsonb_build_object('appointment', a.id, 'variant_id', s.variant_id, 'sku', (select sku from public.product_variants where id = s.variant_id),
    'name', s.name, 'price', coalesce(a.price, s.price, 0), 'tax_code_id', v_tax, 'tax_rate', coalesce(v_rate, 0),
    'partner_id', v_partner, 'client', a.client_name);
end $$;

-- the till sale is done: the appointment is done and remembers it
create or replace function public.appt_paid_at_till(p_id uuid, p_ref uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.appointments; v_tz text;
begin
  select * into a from public.appointments where id = p_id and deleted_at is null for update;
  if a.id is null then raise exception 'Appointment not found' using errcode = 'P0002'; end if;
  if not (app.has_permission(a.company_id, 'pos.write') or app.has_permission(a.company_id, 'sales.write')) then
    raise exception 'Permission denied: pos.write required' using errcode = '42501';
  end if;
  update public.appointments set pos_client_uuid = p_ref, status = 'done', done_at = coalesce(done_at, now()) where id = a.id;
  if a.card_id is not null and not exists (select 1 from public.card_entries where appointment_id = a.id) then
    select coalesce(timezone, 'Europe/Tirane') into v_tz from public.companies where id = a.company_id;
    insert into public.card_entries (company_id, card_id, entry_date, title, appointment_id)
    values (a.company_id, a.card_id, (a.starts_at at time zone v_tz)::date,
            coalesce((select name from public.appt_services where id = a.service_id), 'Vizitë'), a.id);
  end if;
end $$;
revoke all on function public.appt_for_till(uuid), public.appt_paid_at_till(uuid, uuid) from public, anon;
grant execute on function public.appt_for_till(uuid), public.appt_paid_at_till(uuid, uuid) to authenticated;

-- the calendar knows an appointment paid at the till
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
select app._patch_function('public.appt_board', $x$'invoice_id', a.invoice_id, 'reminded_at', a.reminded_at)$x$,
  $x$'invoice_id', a.invoice_id, 'pos_client_uuid', a.pos_client_uuid, 'reminded_at', a.reminded_at)$x$);
drop function app._patch_function(text, text, text);
