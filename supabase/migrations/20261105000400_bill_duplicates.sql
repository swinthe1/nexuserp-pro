-- =============================================================================
-- The same supplier invoice is never entered twice (purchases, expenses, investments: all supplier bills)
--   · the number is compared without spaces, dashes, slashes or dots ("F04-2026/1122" = "f04 2026 1122")
--   · the supplier is the same when it is the same partner, or another partner with the same tax number
--     (a supplier opened twice under a slightly different name)
--   · the purchase invoice screen asks while the number is typed, before anything is saved
-- =============================================================================

create or replace function app.invoice_no_key(p text)
returns text language sql immutable set search_path = '' as $$
  select nullif(regexp_replace(lower(coalesce(p, '')), '[^[:alnum:]]', '', 'g'), '')
$$;

create or replace function app.bill_duplicate_of(p_company uuid, p_vendor uuid, p_doc_type text, p_number text, p_exclude uuid)
returns public.vendor_bills language sql stable security definer set search_path = '' as $$
  select b.* from public.vendor_bills b
   where b.company_id = p_company and b.document_type = p_doc_type and b.id is distinct from p_exclude
     and b.deleted_at is null and b.status <> 'cancelled'
     and app.invoice_no_key(b.vendor_invoice_number) = app.invoice_no_key(p_number)
     and (b.vendor_id = p_vendor
          or exists (select 1 from public.business_partners x, public.business_partners y
                      where x.id = b.vendor_id and y.id = p_vendor
                        and nullif(btrim(x.tax_number), '') is not null and btrim(x.tax_number) = btrim(y.tax_number)))
   order by b.created_at limit 1
$$;

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_new in v_def) > 0 then return; end if;
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;

do $$ begin
  perform app._patch_function('app.tg_bill_defaults',
    $o$    select number into v_dup from public.vendor_bills b
     where b.company_id = new.company_id and b.vendor_id = new.vendor_id and b.document_type = new.document_type
       and lower(b.vendor_invoice_number) = lower(new.vendor_invoice_number) and b.id <> new.id
       and b.deleted_at is null and b.status <> 'cancelled' limit 1;$o$,
    $n$    select number into v_dup from app.bill_duplicate_of(new.company_id, new.vendor_id, new.document_type, new.vendor_invoice_number, new.id);$n$);
end $$;
drop function app._patch_function(text, text, text);

-- while the number is typed: is it already in?
create or replace function public.vendor_bill_duplicate(p_company uuid, p_vendor uuid, p_number text, p_exclude uuid default null, p_doc_type text default 'vendor_bill')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare b public.vendor_bills;
begin
  perform app.require_permission(p_company, 'invoicing.read');
  if p_vendor is null or app.invoice_no_key(p_number) is null then return null; end if;
  b := app.bill_duplicate_of(p_company, p_vendor, coalesce(p_doc_type, 'vendor_bill'), p_number, p_exclude);
  if b.id is null then return null; end if;
  return jsonb_build_object('id', b.id, 'number', b.number, 'vendor_invoice_number', b.vendor_invoice_number, 'date', b.bill_date, 'total', b.total, 'status', b.status,
    'vendor', (select name from public.business_partners where id = b.vendor_id));
end $$;
revoke all on function public.vendor_bill_duplicate(uuid, uuid, text, uuid, text) from public, anon;
grant execute on function public.vendor_bill_duplicate(uuid, uuid, text, uuid, text) to authenticated;
