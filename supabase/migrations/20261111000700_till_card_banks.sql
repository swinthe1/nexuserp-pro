-- =============================================================================
-- DrisPRO · a card payment at the till says which bank's terminal took it (11.11.2026)
--   The till offers the company's banks (its active bank accounts); the cashier picks the one whose POS terminal
--   was used, and its name is kept on the payment (its reference), where the shift and the reports show it.
--   A cashier does not read the bank accounts themselves: only the names of the banks.
-- =============================================================================
create or replace function public.till_card_banks(p_register uuid)
 returns jsonb language plpgsql stable security definer set search_path to ''
as $function$
declare v_co uuid;
begin
  select company_id into v_co from public.pos_registers where id = p_register;
  if v_co is null then raise exception 'Register not found' using errcode = 'P0002'; end if;
  perform app.require_permission(v_co, 'pos.read');
  return coalesce((select jsonb_agg(x.bank order by x.bank) from (
    select distinct coalesce(nullif(btrim(b.bank_name), ''), b.name) as bank
      from public.bank_accounts b
     where b.company_id = v_co and b.account_kind = 'bank' and b.is_active and b.deleted_at is null) x), '[]'::jsonb);
end
$function$;
grant execute on function public.till_card_banks(uuid) to authenticated;
revoke execute on function public.till_card_banks(uuid) from public, anon;
