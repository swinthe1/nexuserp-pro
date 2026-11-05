-- =============================================================================
-- The deep check, phase 1 (part 2):
--   4081          a bill made from a receipt clears 4081 at the receipt's cost; a price that differs goes to
--                 the stock still on hand, the rest to 6011 (as bills of an order already did); no more is
--                 billed than came in
--   counts        a count corrects for the moves after it by when they happened, not when they reached the
--                 server: a till sale made before the count and sent after it is no longer taken off twice
--   depreciation  two runs at once (the night's and one by hand) wait for each other: a month posts once
--   VAT           a till sale that reaches a month whose VAT is already declared (sent late from a till
--                 without internet) tells the accountant at once: the sale stands, the declaration is corrected
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

-- ---------------------------------------------------------------- 4081: bills made from a receipt
select app._patch_function('public.post_vendor_bill',
  $x$v_cap_total numeric := 0; v_exp_total numeric := 0; v_summary text;$x$,
  $x$v_cap_total numeric := 0; v_exp_total numeric := 0; v_summary text; v_rl record; v_billed numeric;$x$);
select app._patch_function('public.post_vendor_bill',
  $x$    if l.po_line_id is null then continue; end if;$x$,
  $x$    -- billed from a receipt: no more than came in, and the price against the receipt's cost
    if l.po_line_id is null and l.receipt_line_id is not null and v_sign = 1 and l.product_type = 'stockable' and l.account_id is null then
      select gl.quantity, gl.unit_cost, gl.location_id into v_rl from public.goods_receipt_lines gl where gl.id = l.receipt_line_id;
      select coalesce(sum(bl.quantity), 0) into v_billed from public.vendor_bill_lines bl join public.vendor_bills ob on ob.id = bl.bill_id
       where bl.receipt_line_id = l.receipt_line_id and ob.id <> b.id and ob.status = 'posted' and ob.document_type = 'vendor_bill' and ob.deleted_at is null;
      if l.quantity > v_rl.quantity - v_billed + 0.0001 then
        raise exception 'Line %: % received, % billed already, % on this bill', l.line_no, trim_scale(v_rl.quantity), trim_scale(v_billed), trim_scale(l.quantity)
          using errcode = '23514';
      end if;
      v_diff := round((l.line_subtotal / nullif(l.quantity, 0) * b.exchange_rate - coalesce(v_rl.unit_cost, 0)) * l.quantity, 2);
      if abs(v_diff) >= 0.01 then
        select greatest(qty_on_hand, 0), total_value into v_onhand, v_total_value from public.item_costs where variant_id = l.item_id;
        v_cap := round(v_diff * least(l.quantity, coalesce(v_onhand, 0)) / l.quantity, 2);
        v_cap := greatest(v_cap, -coalesce(v_total_value, 0));
        if v_cap <> 0 then
          perform app.post_price_variance(b.company_id, l.item_id, v_rl.location_id, v_cap, b.id, l.id, b.number, (b.bill_date + localtime)::timestamptz);
        end if;
        update public.vendor_bill_lines set capitalized_variance = v_cap, expensed_variance = v_diff - v_cap where id = l.id;
        v_cap_total := v_cap_total + v_cap;
        v_exp_total := v_exp_total + (v_diff - v_cap);
      end if;
      continue;
    end if;
    if l.po_line_id is null then continue; end if;$x$);

select app._patch_function('app.gl_vendor_bill',
  $x$      v_lines := v_lines || jsonb_build_object('account_id', app.acct(b.company_id, 'grni'), 'amount', s * v_base, 'variant_id', l.item_id,
                                               'partner_id', b.vendor_id, 'description', l.description);
      v_exp := app.item_acct(b.company_id, l.item_id, 'inventory');
    elsif l.po_line_id is not null$x$,
  $x$      v_lines := v_lines
        || jsonb_build_object('account_id', app.acct(b.company_id, 'grni'), 'amount', s * (v_base - l.capitalized_variance - l.expensed_variance),
                              'variant_id', l.item_id, 'partner_id', b.vendor_id, 'description', l.description)
        || jsonb_build_object('account_id', app.item_acct(b.company_id, l.item_id, 'inventory'), 'amount', s * l.capitalized_variance,
                              'variant_id', l.item_id, 'description', 'Price difference on stock')
        || jsonb_build_object('account_id', app.item_acct(b.company_id, l.item_id, 'purchase_price_variance'), 'amount', s * l.expensed_variance,
                              'variant_id', l.item_id, 'description', 'Price difference on goods already sold');
      v_exp := app.item_acct(b.company_id, l.item_id, 'inventory');
    elsif l.po_line_id is not null$x$);

-- ---------------------------------------------------------------- counts: by when the moves happened
select app._patch_function('public.post_cycle_count',
  $x$and m.created_at > coalesce(cl.counted_at, c.created_at)$x$,
  $x$and m.movement_date > coalesce(cl.counted_at, c.created_at)$x$);

-- ---------------------------------------------------------------- depreciation: one run at a time
select app._patch_function('public.run_depreciation',
  $x$  perform app.require_permission(p_company, 'finance.write');
  for m in$x$,
  $x$  perform app.require_permission(p_company, 'finance.write');
  -- the night's run and one by hand wait for each other; the second finds the months posted
  perform pg_advisory_xact_lock(hashtext('depreciation:' || p_company));
  for m in$x$);

-- ---------------------------------------------------------------- a till sale in a declared VAT month
create or replace function app.tg_pos_declared_vat()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_date date; v_number text; v_period text;
begin
  if new.status <> 'paid' or old.status = 'paid' then return null; end if;
  v_date := (new.order_at at time zone coalesce((select timezone from public.companies where id = new.company_id), 'Europe/Tirane'))::date;
  select d.number, to_char(d.period_start, 'MM.YYYY') into v_number, v_period from public.vat_declarations d
   where d.company_id = new.company_id and d.deleted_at is null and d.status in ('submitted', 'accepted')
     and v_date between d.period_start and d.period_end;
  if v_number is not null then
    perform app.remind(new.company_id, array['accountant', 'finance_manager', 'company_admin'],
                       'Till receipt ' || coalesce(new.number, new.device_ref, '') || ' of ' || to_char(v_date, 'DD.MM.YYYY') || ' arrived after the VAT for ' || v_period || ' was declared (' || v_number || ')',
                       null, '/tax/declarations', 'pos_orders', new.id);
  end if;
  return null;
end $$;
drop trigger if exists trg_96_declared_vat on public.pos_orders;
create trigger trg_96_declared_vat after update of status on public.pos_orders
  for each row execute function app.tg_pos_declared_vat();

drop function app._patch_function(text, text, text);
