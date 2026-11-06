-- =============================================================================
-- A purchase invoice outside the VAT book ("Faturë blerje (pa TVSH)": a till receipt, a paper without the
-- buyer's VAT) often has no invoice number of the supplier. There the number is optional: left empty, the
-- document carries its own number (FB-2026-00028) in its place, so it stays unique and every place that
-- shows "the supplier's number" shows something. A document in the VAT book still needs the supplier's number.
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

select app._patch_function('app.tg_bill_defaults',
  $x$  new.vendor_invoice_number := btrim(new.vendor_invoice_number);
  if new.vendor_invoice_number = '' then$x$,
  $x$  new.vendor_invoice_number := btrim(coalesce(new.vendor_invoice_number, ''));
  -- outside the VAT book the supplier's number may be missing: the document's own number takes its place (below)
  if new.vendor_invoice_number = '' and not (new.document_type = 'vendor_bill' and new.in_vat_book = false) then$x$);
select app._patch_function('app.tg_bill_defaults',
  $x$  if new.status <> 'cancelled' then
    select number into v_dup$x$,
  $x$  if new.status <> 'cancelled' and new.vendor_invoice_number <> '' then
    select number into v_dup$x$);

drop function app._patch_function(text, text, text);

-- after the document has its number (trg_10_number)
create or replace function app.tg_bill_own_reference()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(new.vendor_invoice_number, '') = '' and new.document_type = 'vendor_bill' and new.in_vat_book = false then
    new.vendor_invoice_number := new.number;
  end if;
  return new;
end $$;
drop trigger if exists trg_10b_own_reference on public.vendor_bills;
create trigger trg_10b_own_reference before insert or update on public.vendor_bills
  for each row execute function app.tg_bill_own_reference();
