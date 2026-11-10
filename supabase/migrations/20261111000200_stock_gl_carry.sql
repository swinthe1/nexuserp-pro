-- =============================================================================
-- DrisPRO · the stock account follows the stock list to the cent (11.11.2026, the big check)
--   Each stock movement was booked rounded to two decimals on its own. An item that costs 0,2217 was booked 0,22
--   at every sale: after 2 260 loaves the cost of goods sold was 9 EUR short and the stock account 9 EUR too high.
--   Now the rounding left over of each item is carried into its next entry.
--   What drifted before stays as it is (the books check shows it); nothing old is rewritten.
-- =============================================================================

create table if not exists app.stock_gl_carry (
  company_id uuid not null references public.companies(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id) on delete cascade,
  carry numeric(12,6) not null default 0,
  primary key (company_id, variant_id)
);

CREATE OR REPLACE FUNCTION app.tg_stock_movement_gl()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  m record; v_lines jsonb := '[]'::jsonb; v_counter uuid; v_inv numeric; v_je uuid; v_date date; v_ref text;
  v_reason text; v_receipt_type text; v_journal text := 'INV'; v_tz text; v_grni boolean; v_carry numeric; v_exact numeric;
begin
  select timezone into v_tz from public.companies where id = new.company_id;
  if (select journal_entry_id from public.stock_movements where id = new.id) is not null then return null; end if;
  if new.source_doc_type in ('vendor_bill','landed_cost') or new.source_doc_type is null then return null; end if;

  if new.source_doc_type = 'stock_adjustment' then
    select reason into v_reason from public.stock_adjustments where id = new.source_doc_id;
  elsif new.source_doc_type = 'goods_receipt' then
    select receipt_type into v_receipt_type from public.goods_receipts where id = new.source_doc_id;
  elsif new.source_doc_type = 'work_order' then
    v_journal := 'MFG';
  elsif new.source_doc_type = 'pos_order' then
    v_journal := coalesce((select j.code from public.pos_orders o join public.pos_registers r on r.id = o.register_id
                             join public.journals j on j.id = r.journal_id where o.id = new.source_doc_id), 'POS');
  end if;

  for m in
    select sm.* from public.stock_movements sm
     where sm.company_id = new.company_id and sm.source_doc_type = new.source_doc_type and sm.source_doc_id = new.source_doc_id
       and sm.journal_entry_id is null and sm.movement_type not in ('landed_cost')
     order by sm.movement_date, sm.id
  loop
    -- inventory value change: +in / −out (internal relocations net to zero)
    v_inv := (case when m.to_warehouse_id is not null then m.total_cost else 0 end)
           - (case when m.from_warehouse_id is not null then m.total_cost else 0 end);
    v_date := coalesce(v_date, (m.movement_date at time zone coalesce(v_tz, 'Europe/Tirane'))::date);
    v_ref := coalesce(v_ref, m.reference);
    continue when v_inv = 0;
    v_grni := (m.movement_type = 'receipt' and coalesce(v_receipt_type, 'purchase') = 'purchase') or m.movement_type = 'purchase_return';
    -- the stock list counts to four decimals, the accounts to two: what the rounding leaves of each item is kept
    -- and goes into its next entry, so the stock account never drifts from the stock list (bread at 0,2217 was booked 0,22 every time)
    insert into app.stock_gl_carry (company_id, variant_id) values (m.company_id, m.variant_id) on conflict do nothing;
    select c.carry into v_carry from app.stock_gl_carry c where c.company_id = m.company_id and c.variant_id = m.variant_id for update;
    v_exact := v_inv;
    -- goods in from a supplier and back to one keep their own rounding (they must meet the supplier's invoice to the cent)
    v_inv := case when v_grni then round(v_exact, 2) else round(v_exact + v_carry, 2) end;
    update app.stock_gl_carry c set carry = v_carry + v_exact - v_inv where c.company_id = m.company_id and c.variant_id = m.variant_id;
    continue when v_inv = 0;
    v_counter := case
      when m.movement_type = 'receipt' and coalesce(v_receipt_type, 'purchase') = 'purchase' then app.acct(m.company_id, 'grni')
      when m.movement_type in ('receipt') then app.acct(m.company_id, 'inventory_adjustment')
      when m.movement_type = 'purchase_return' then app.acct(m.company_id, 'grni')
      when m.movement_type = 'revaluation' and m.notes like 'Negative stock settled%' then app.item_acct(m.company_id, m.variant_id, 'cogs')
      when m.movement_type in ('delivery','pos_sale','sales_return','pos_return') then app.item_acct(m.company_id, m.variant_id, 'cogs')
      when m.movement_type in ('production_consume','production_output') then app.acct(m.company_id, 'wip')
      when m.movement_type = 'opening' or v_reason = 'opening' then app.acct(m.company_id, 'opening_balance')
      else app.acct(m.company_id, 'inventory_adjustment') end;
    v_lines := v_lines
      || jsonb_build_object('account_id', app.item_acct(m.company_id, m.variant_id, 'inventory'), 'amount', v_inv, 'variant_id', m.variant_id,
                            'description', replace(m.movement_type, '_', ' '))
      || jsonb_build_object('account_id', v_counter, 'amount', -v_inv, 'variant_id', m.variant_id,
                            'description', replace(m.movement_type, '_', ' '));
  end loop;

  if jsonb_array_length(v_lines) > 0 then
    v_je := app.gl_post(new.company_id, v_journal, v_date, new.source_doc_type, new.source_doc_id, v_ref,
                        'Inventory: ' || replace(new.source_doc_type, '_', ' ') || ' ' || coalesce(v_ref, ''),
                        v_lines, 'stock:' || txid_current());
  end if;
  update public.stock_movements set journal_entry_id = v_je
   where company_id = new.company_id and source_doc_type = new.source_doc_type and source_doc_id = new.source_doc_id
     and journal_entry_id is null and v_je is not null;
  if v_je is not null then
    case new.source_doc_type
      when 'goods_receipt' then update public.goods_receipts set journal_entry_id = v_je where id = new.source_doc_id and journal_entry_id is null;
      when 'delivery' then update public.deliveries set journal_entry_id = v_je where id = new.source_doc_id and journal_entry_id is null;
      when 'stock_adjustment' then update public.stock_adjustments set journal_entry_id = v_je where id = new.source_doc_id and journal_entry_id is null;
      else null;
    end case;
  end if;
  return null;
end $function$;
