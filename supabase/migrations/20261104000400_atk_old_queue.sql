-- =============================================================================
-- DrisPRO · 20261104000400 · Kosovo till receipts: only the signed ones are queued for ATK
-- * receipts from before DrisPRO signed them were fiscalized by the shop's own fiscal device:
--   their old queue rows are closed, and a Kosovo company queues receipts only once its tills sign;
-- * the QR text of a coupon is not a link: it stays in the payload, not in qr_url ("Verify").
-- =============================================================================
create or replace function app.tg_pos_fiscal_status() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'paid' and (tg_op = 'INSERT' or old.status is distinct from 'paid') and new.fiscal_status = 'not_required'
     and exists (select 1 from public.company_settings s join public.companies c on c.id = s.company_id
                  where s.company_id = new.company_id and s.fiscalization_enabled
                    and (c.country_code = 'AL' or (c.country_code = 'XK' and s.atk_sef_enabled))) then
    new.fiscal_status := 'pending';
  end if;
  return new;
end $$;

create or replace function app.tg_fiscal_record_fill() returns trigger language plpgsql security definer set search_path = '' as $$
declare p jsonb; a jsonb;
begin
  if new.request_payload is null then
    p := app.fiscal_payload(new.company_id, new.source_doc_type, new.source_doc_id);
    if new.country_code = 'XK' and new.source_doc_type = 'pos_order' then
      select o.atk into a from public.pos_orders o where o.id = new.source_doc_id;
      if a is not null then
        p := p || jsonb_build_object('atk', a);
        new.iic := (a ->> 'coupon_id');
        new.verification_code := a ->> 'verification_no';
      elsif exists (select 1 from public.company_settings where company_id = new.company_id and atk_sef_enabled) then
        -- a sale without a signed coupon (a till not registered with ATK): it cannot be sent
        new.status := 'failed';
        new.error_code := 'NOT_SIGNED';
        new.error_message := 'This receipt was made on a till that is not registered with ATK, so it has no signed coupon';
      end if;
    end if;
    new.request_payload := p;
    new.iic := coalesce(new.iic, case when new.country_code = 'AL' then upper(md5(p ->> 'iic_input')) end);
    new.tcr_code := coalesce(new.tcr_code, p ->> 'tcr');
    new.business_unit_code := coalesce(new.business_unit_code, p ->> 'business_unit');
    new.software_code := coalesce(new.software_code, p ->> 'software');
    new.is_subsequent := new.is_subsequent or coalesce((p ->> 'offline')::boolean, false);
  end if;
  return new;
end $$;

update public.fiscalization_records set qr_url = null where country_code = 'XK' and request_payload ? 'atk' and qr_url is not null;

-- the old rows: never sent anywhere, and never will be
with old as (
  update public.fiscalization_records set status = 'cancelled', error_code = 'OWN_DEVICE',
         error_message = 'Made before DrisPRO signed the receipts: fiscalized by the shop''s own fiscal device'
   where country_code = 'XK' and source_doc_type = 'pos_order' and status in ('pending', 'failed', 'sent')
     and not (request_payload ? 'atk') and error_code is distinct from 'NOT_SIGNED'
  returning source_doc_id)
update public.pos_orders o set fiscal_status = 'not_required' from old where o.id = old.source_doc_id and o.fiscal_status in ('pending', 'failed');
