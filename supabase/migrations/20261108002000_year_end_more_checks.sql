-- =============================================================================
-- DrisPRO · two more things to check before closing the year (audit, wave 2)
--   * the yearly stock count: none posted in the last two months of the year (or the month after)
--   * the balances with partners: how many still have an open balance, to confirm them (IOS)
--   Both are yellow: worth doing, they do not stop the closing.
-- =============================================================================
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
select app._patch_function('public.year_end_check',
  $x$      jsonb_build_object('key', 'cit', 'href',$x$,
  $x$      jsonb_build_object('key', 'stock_count', 'href', '/wms/counts',
        'count', case when exists (select 1 from public.stock_levels sl where sl.company_id = v_co and sl.on_hand <> 0)
                       and not exists (select 1 from public.cycle_counts cc where cc.company_id = v_co and cc.deleted_at is null and cc.status = 'posted'
                                         and cc.count_date between y.end_date - 60 and y.end_date + 31) then 1 else 0 end),
      jsonb_build_object('key', 'partner_balances', 'href', '/finance/cards',
        'count', (select count(*) from (
                    select jl.partner_id from public.journal_lines jl join public.journal_entries e on e.id = jl.entry_id
                      join public.accounts a on a.id = jl.account_id
                     where jl.company_id = v_co and jl.partner_id is not null and a.account_subtype in ('receivable', 'payable')
                       and e.status in ('posted', 'reversed') and e.entry_date <= y.end_date
                     group by jl.partner_id having abs(sum(jl.debit - jl.credit)) >= 0.01) x)),
      jsonb_build_object('key', 'cit', 'href',$x$);
drop function app._patch_function(text, text, text);
