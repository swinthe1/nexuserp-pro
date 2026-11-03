-- =============================================================================
-- DrisPRO · 20261104000600 · Kosovo invoices are not queued for ATK
-- ATK's electronic fiscal software (SEF) takes till coupons; its documentation has no invoice service. A Kosovo
-- invoice therefore waits for nothing: it is not put in the fiscal queue, and the ones queued before are closed.
-- =============================================================================
do $patch$
declare d text;
begin
  d := pg_get_functiondef('public.post_sales_invoice(uuid)'::regprocedure);
  if position($a$c.country_code in ('AL','XK')$a$ in d) = 0 then return; end if;
  d := replace(d, $a$c.country_code in ('AL','XK')$a$, $a$c.country_code = 'AL'$a$);
  execute d;
end $patch$ language plpgsql;

with old as (
  update public.fiscalization_records set status = 'cancelled', error_code = 'NOT_SEF',
         error_message = 'Kosovo invoices are not sent to ATK through the fiscal software; only till coupons are'
   where country_code = 'XK' and source_doc_type in ('sales_invoice', 'credit_note') and status in ('pending', 'failed', 'sent')
  returning source_doc_id)
update public.sales_invoices i set fiscal_status = 'not_required' from old where i.id = old.source_doc_id and i.fiscal_status in ('pending', 'failed');
