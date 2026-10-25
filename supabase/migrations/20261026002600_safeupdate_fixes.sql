-- =============================================================================
-- DrisPRO · fixes found by the live link at Lider Market
-- 1. Supabase loads pg_safeupdate for API sessions: "DELETE requires a WHERE clause".
--    Two functions emptied a temp table with a bare DELETE; they now say "where true".
--    (app.gl_post is used by every posting, so stock adjustments made through the API failed.)
-- 2. Importing a product whose barcode already belongs to another product failed the whole row;
--    the product now comes in without that barcode.
-- =============================================================================

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;

select app._patch_function('app.gl_post', 'delete from _gl;', 'delete from _gl where true;');
select app._patch_function('public.create_po_from_requisition', 'delete from _req_lines;', 'delete from _req_lines where true;');

select app._patch_function('public.import_rows',
  $x$'barcodes', case when nullif(btrim(r ->> 'barcode'), '') is not null then$x$,
  $x$'barcodes', case when nullif(btrim(r ->> 'barcode'), '') is not null
                         and not exists (select 1 from public.product_barcodes b where b.company_id = p_company and b.barcode = btrim(r ->> 'barcode') and b.deleted_at is null) then$x$);

drop function app._patch_function(text, text, text);
