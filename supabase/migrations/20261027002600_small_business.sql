-- =============================================================================
-- Small business (Kosovo): a business not registered for VAT pays a tax on its gross income every
-- quarter, 3% for trade, transport, farming and the like, 9% for services and professions. The
-- accountant picks the rate; DrisPRO adds up the income per quarter from the same documents as the
-- sales book (invoices, tills, Z reports), shows the tax and the day it is due.
-- =============================================================================

alter table public.company_settings add column if not exists small_business_rate numeric(5,2)
  check (small_business_rate is null or small_business_rate between 0 and 50);

create or replace function public.set_small_business_rate(p_company uuid, p_rate numeric)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'tax.write');
  update public.company_settings set small_business_rate = p_rate where company_id = p_company;
end $$;
revoke all on function public.set_small_business_rate(uuid, numeric) from public, anon;
grant execute on function public.set_small_business_rate(uuid, numeric) to authenticated;

-- the year by quarter: income (with VAT, if any was charged), purchases, the tax and its due day
create or replace function public.small_business_tax(p_company uuid, p_year int)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_rate numeric; v_q jsonb := '[]'; q int; v_from date; v_to date; v_in numeric; v_out numeric; v_docs int; v_year numeric := 0;
begin
  if not app.has_permission(p_company, 'tax.read') then raise exception 'Permission denied: tax.read required' using errcode = '42501'; end if;
  select small_business_rate into v_rate from public.company_settings where company_id = p_company;
  for q in 1..4 loop
    v_from := make_date(p_year, (q - 1) * 3 + 1, 1);
    v_to := (v_from + interval '3 months - 1 day')::date;
    select coalesce(sum((case when is_credit then -1 else 1 end) * (base + vat)) filter (where side = 'sale'), 0),
           coalesce(sum((case when is_credit then -1 else 1 end) * (base + vat)) filter (where side = 'purchase'), 0),
           count(distinct coalesce(doc_id::text, number)) filter (where side = 'sale')
      into v_in, v_out, v_docs
      from app.vat_entries(p_company, v_from, v_to);
    v_year := v_year + v_in;
    v_q := v_q || jsonb_build_array(jsonb_build_object('quarter', q, 'from', v_from, 'to', v_to, 'income', round(v_in, 2), 'purchases', round(v_out, 2),
      'documents', v_docs, 'tax', case when v_rate is not null then round(greatest(v_in, 0) * v_rate / 100, 2) end,
      'due', (v_to + interval '15 days')::date, 'closed', v_to < current_date));
  end loop;
  return jsonb_build_object('year', p_year, 'rate', v_rate, 'quarters', v_q, 'income', round(v_year, 2),
    'tax', case when v_rate is not null then round(greatest(v_year, 0) * v_rate / 100, 2) end,
    'limit', 30000, 'over_limit', v_year > 30000,
    'currency', (select base_currency from public.companies where id = p_company),
    'country', (select country_code from public.companies where id = p_company));
end $$;
revoke all on function public.small_business_tax(uuid, int) from public, anon;
grant execute on function public.small_business_tax(uuid, int) to authenticated;
