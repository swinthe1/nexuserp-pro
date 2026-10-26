-- =============================================================================
-- DrisPRO · the till, hardened (from the review before going live)
--   · a refund gives back what the receipt was paid: price and discount come from the original line
--   · a price under the till's own price is a discount: far under it needs a manager, otherwise
--     managers are told; table prices (set by the server when added) are trusted
--   · "made offline" is believed only for receipts that are really from the past (2 minutes)
--   · an offline sale on a card blocked meanwhile keeps the card type's discount instead of failing
--   · two refunds of one receipt at the same time cannot both pass (the receipt is locked)
--   · a refund gives back spent points, takes back at most the earned points, frees the monthly
--     discount it used
--   · restaurant: a replayed payment waits for the tab and returns the first answer; a payment made
--     offline while the shift closed goes into the till's open shift
--   · the opening float and cash put into a drawer cannot take more than the safe holds
-- =============================================================================

CREATE OR REPLACE FUNCTION public.pos_submit_order(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s public.pos_sessions; r public.pos_registers; ex record; v_id uuid; v_client uuid; v_refund boolean; v_orig public.pos_orders;
  l jsonb; ln record; n int := 0; v_customer uuid; v_left numeric; v_take numeric; lt record; v_mv uuid; v_cost numeric; v_first_lot uuid;
  v_total numeric; v_paid numeric := 0; v_cash numeric := 0; v_change numeric; pay jsonb; v_amt numeric; v_order_at timestamptz;
  v_max_disc numeric := 10; v_number text; v_kit uuid; kc record; v_loy jsonb; v_card uuid; v_allowed numeric; v_ldisc numeric := 0; v_prog numeric := 0; v_earn numeric := 0; v_lc public.loyalty_cards; v_lg public.loyalty_programs;
  v_offline boolean; v_blocked_pct numeric; v_cat numeric; v_ol record; v_low text[] := '{}'; v_back numeric; v_taken numeric;
begin
  v_client := nullif(p->>'client_uuid', '')::uuid;
  if v_client is null then raise exception 'client_uuid is required' using errcode = '23514'; end if;
  select * into s from public.pos_sessions where id = (p->>'session_id')::uuid for share;
  if s.id is null then raise exception 'Session not found' using errcode = 'P0002'; end if;
  perform app.require_permission(s.company_id, 'pos.write');

  select id, number, total, status into ex from public.pos_orders where company_id = s.company_id and client_uuid = v_client;
  if ex.id is not null then
    return jsonb_build_object('id', ex.id, 'number', ex.number, 'total', ex.total, 'duplicate', true);
  end if;
  if s.status <> 'open' then
    raise exception 'SESSION_CLOSED: session % is already closed', s.number using errcode = '55000';
  end if;
  select * into r from public.pos_registers where id = s.register_id;
  v_refund := coalesce((p->>'is_refund')::boolean, false);
  v_order_at := least(coalesce((p->>'order_at')::timestamptz, now()), now());
  -- "made offline" is believed only for receipts that are really from the past
  v_offline := coalesce((p->>'offline')::boolean, false) and v_order_at < now() - interval '2 minutes';
  if v_refund then
    -- locked: two tills refunding the same receipt at once cannot both pass
    select * into v_orig from public.pos_orders where id = (p->>'refund_of_id')::uuid and company_id = s.company_id for update;
    if v_orig.id is null then raise exception 'Choose the receipt being refunded' using errcode = '23514'; end if;
    if v_orig.is_refund then raise exception 'A refund cannot be refunded' using errcode = '23514'; end if;
  end if;

  insert into public.pos_orders (company_id, client_uuid, session_id, register_id, partner_id, is_refund, refund_of_id, order_at,
                                 offline_created, device_ref, status)
  values (s.company_id, v_client, s.id, r.id, coalesce(nullif(p->>'partner_id', '')::uuid, r.default_customer_id), v_refund, v_orig.id,
          v_order_at, coalesce((p->>'offline')::boolean, false), p->>'device_ref', 'draft')
  returning id, number into v_id, v_number;

  -- loyalty card: the server works the discount out again; nobody can type a bigger one
  v_card := nullif(p -> 'loyalty' ->> 'card_id', '')::uuid;
  if v_card is not null and not v_refund then
    v_loy := app.loyalty_eval(s.company_id, v_card, r.warehouse_id,
               (select jsonb_agg(jsonb_build_object('variant_id', x ->> 'variant_id', 'quantity', x ->> 'quantity', 'unit_price', x ->> 'unit_price',
                                                    'manual_pct', coalesce(x ->> 'manual_pct', case when coalesce((x ->> 'card')::boolean, false) then '0' else x ->> 'discount_pct' end)))
                  from jsonb_array_elements(coalesce(p -> 'lines', '[]'::jsonb)) x),
               coalesce((p -> 'loyalty' ->> 'redeem_points')::numeric, 0), v_order_at);
    if not (v_loy ->> 'usable')::boolean then
      if v_offline then
        -- sold offline on a card that has just been blocked: keep the sale, at most the card type's own discount
        v_loy := null;
        select g.discount_pct into v_blocked_pct from public.loyalty_cards c join public.loyalty_programs g on g.id = c.program_id where c.id = v_card;
        v_blocked_pct := coalesce(v_blocked_pct, 0);
      else raise exception '%', v_loy ->> 'reason' using errcode = '23514'; end if;
    end if;
    if v_loy is not null then update public.pos_orders set loyalty_card_id = v_card where id = v_id; end if;
  end if;

  for l in select * from jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) loop
    n := n + 1;
    if (l->>'quantity')::numeric = 0 or ((l->>'quantity')::numeric < 0) <> v_refund then
      raise exception 'Line %: sales have positive and refunds negative quantities', n using errcode = '23514';
    end if;
    v_allowed := null;
    if v_loy is not null and coalesce((v_loy -> 'lines' -> (n - 1) ->> 'eligible')::boolean, false) then
      -- offline the till cannot know this month's limit: allow the card's own discount
      v_allowed := greatest((v_loy -> 'lines' -> (n - 1) ->> 'pct')::numeric,
                            case when v_offline then (v_loy ->> 'program_pct')::numeric else 0 end);
      if coalesce((l->>'discount_pct')::numeric, 0) > v_allowed + 0.01 then
        raise exception 'Line %: the card gives % %%, not %', n, v_allowed, l->>'discount_pct' using errcode = '42501';
      end if;
    end if;
    if v_refund then
      -- a refund gives back what was paid: price and discount come from the receipt, not from the till
      select ol.unit_price, ol.discount_pct into v_ol from public.pos_order_lines ol
       where ol.pos_order_id = v_orig.id and ol.variant_id = (l->>'variant_id')::uuid order by ol.line_no limit 1;
      if v_ol.unit_price is null then raise exception 'Line %: this item is not on receipt %', n, v_orig.number using errcode = '23514'; end if;
      l := l || jsonb_build_object('unit_price', v_ol.unit_price, 'discount_pct', v_ol.discount_pct);
      v_allowed := v_ol.discount_pct;
    elsif v_allowed is null and v_blocked_pct is not null then
      v_allowed := v_blocked_pct;
      if coalesce((l->>'discount_pct')::numeric, 0) > v_allowed + 0.01 then
        raise exception 'Line %: the card gives % %%, not %', n, v_allowed, l->>'discount_pct' using errcode = '42501';
      end if;
    end if;
    if v_allowed is null and coalesce((l->>'discount_pct')::numeric, 0) > v_max_disc and not app.has_permission(s.company_id, 'pos.approve') then
      raise exception 'Discounts above % %% need a manager', v_max_disc using errcode = '42501';
    end if;
    -- a price under the till's own price is a discount too
    if not v_refund and coalesce(current_setting('app.pos_trusted_prices', true), '') <> 'on' then
      v_cat := app.restaurant_price(r.id, (l->>'variant_id')::uuid);
      if v_cat > 0 and (l->>'unit_price')::numeric < v_cat - 0.005 and not app.has_permission(s.company_id, 'pos.approve') then
        if (l->>'unit_price')::numeric < round(v_cat / 2, 2) and not v_offline then
          raise exception 'Line %: the price % is far under the till price %; a manager must sell it', n, l->>'unit_price', v_cat using errcode = '42501';
        end if;
        if (l->>'unit_price')::numeric < round(v_cat * (1 - v_max_disc / 100), 2) then v_low := v_low || coalesce(nullif(l->>'description', ''), l->>'variant_id'); end if;
      end if;
    end if;
    insert into public.pos_order_lines (company_id, pos_order_id, line_no, variant_id, lot_id, barcode_scanned, description, quantity,
                                        unit_price, discount_pct, tax_code_id)
    select s.company_id, v_id, n, v.id, nullif(l->>'lot_id', '')::uuid, l->>'barcode', coalesce(nullif(l->>'description', ''), v.name),
           (l->>'quantity')::numeric, (l->>'unit_price')::numeric, coalesce((l->>'discount_pct')::numeric, 0), p.sales_tax_code_id
      from public.product_variants v join public.products p on p.id = v.product_id
     where v.id = (l->>'variant_id')::uuid and v.company_id = s.company_id;
    if not found then raise exception 'Line %: unknown product', n using errcode = '23503'; end if;
  end loop;
  if n = 0 then raise exception 'The receipt has no lines' using errcode = '23514'; end if;

  if v_refund then
    for ln in select ol.variant_id, -sum(ol.quantity) as qty from public.pos_order_lines ol where ol.pos_order_id = v_id group by ol.variant_id loop
      if ln.qty > coalesce((select sum(quantity) from public.pos_order_lines where pos_order_id = v_orig.id and variant_id = ln.variant_id), 0)
                  - coalesce((select -sum(ol2.quantity) from public.pos_order_lines ol2 join public.pos_orders o2 on o2.id = ol2.pos_order_id
                               where o2.refund_of_id = v_orig.id and o2.id <> v_id and o2.status = 'paid' and ol2.variant_id = ln.variant_id), 0) then
        raise exception 'Refund is more than what is left to refund on %', v_orig.number using errcode = '23514';
      end if;
    end loop;
  end if;

  -- stock leaves (or comes back to) the register's location; a busy till never stops for stock levels
  perform set_config('app.pos_allow_negative', 'on', true);
  v_customer := app.virtual_location(s.company_id, 'customer');
  for ln in select ol.*, p.product_type, p.tracking from public.pos_order_lines ol
              join public.product_variants v on v.id = ol.variant_id join public.products p on p.id = v.product_id
             where ol.pos_order_id = v_id order by ol.line_no loop
    -- a recipe (kit): the ingredients leave stock instead of the dish
    select b.id into v_kit from public.boms b
     where b.company_id = s.company_id and b.variant_id = ln.variant_id and b.bom_type = 'kit' and b.is_active and b.deleted_at is null
       and (b.valid_from is null or b.valid_from <= v_order_at::date) and (b.valid_to is null or b.valid_to >= v_order_at::date)
     order by b.is_default desc, b.version desc limit 1;
    if v_kit is not null then
      v_cost := 0;
      for kc in select bl.component_variant_id as cv, bl.quantity * (1 + bl.scrap_pct / 100) / b.quantity as per
                  from public.boms b join public.bom_lines bl on bl.bom_id = b.id
                  join public.product_variants cv on cv.id = bl.component_variant_id join public.products cp on cp.id = cv.product_id
                 where b.id = v_kit and not bl.is_optional and cp.product_type = 'stockable' loop
        if ln.quantity > 0 then
          v_mv := app.post_stock_move(s.company_id, 'pos_sale', kc.cv, r.location_id, v_customer, round(ln.quantity * kc.per, 4), null, null,
                                      'pos_order', v_id, ln.id, v_number, v_order_at);
        else
          v_mv := app.post_stock_move(s.company_id, 'pos_return', kc.cv, v_customer, r.location_id, round(-ln.quantity * kc.per, 4), null, null,
                                      'pos_order', v_id, ln.id, v_number, v_order_at);
        end if;
        v_cost := v_cost + coalesce((select total_cost from public.stock_movements where id = v_mv), 0);
      end loop;
      update public.pos_order_lines set unit_cost = round(v_cost / abs(ln.quantity), 6) where id = ln.id;
      continue;
    end if;
    continue when ln.product_type <> 'stockable';
    v_cost := 0; v_first_lot := ln.lot_id;
    if ln.quantity > 0 then
      v_left := ln.quantity;
      if ln.tracking <> 'none' and ln.lot_id is null then
        for lt in select sl.lot_id, sl.on_hand from public.stock_levels sl join public.lots x on x.id = sl.lot_id
                   where sl.variant_id = ln.variant_id and sl.location_id = r.location_id and sl.on_hand > 0
                   order by (x.expiry_date < current_date), x.expiry_date nulls last, x.lot_number loop
          exit when v_left <= 0;
          v_take := least(v_left, lt.on_hand);
          v_mv := app.post_stock_move(s.company_id, 'pos_sale', ln.variant_id, r.location_id, v_customer, v_take, null, lt.lot_id,
                                      'pos_order', v_id, ln.id, v_number, v_order_at);
          v_cost := v_cost + (select total_cost from public.stock_movements where id = v_mv);
          v_first_lot := coalesce(v_first_lot, lt.lot_id); v_left := v_left - v_take;
        end loop;
        if v_left > 0 then
          v_first_lot := coalesce(v_first_lot, (select id from public.lots where variant_id = ln.variant_id and deleted_at is null
                                                  order by expiry_date desc nulls first, created_at desc limit 1));
          if v_first_lot is null then
            raise exception '% is lot-tracked and has no lot at all; receive it with a lot first', ln.description using errcode = '23514';
          end if;
        end if;
      else
        v_first_lot := ln.lot_id;
      end if;
      if v_left > 0 then
        v_mv := app.post_stock_move(s.company_id, 'pos_sale', ln.variant_id, r.location_id, v_customer, v_left, null, v_first_lot,
                                    'pos_order', v_id, ln.id, v_number, v_order_at);
        v_cost := v_cost + (select total_cost from public.stock_movements where id = v_mv);
      end if;
    else
      select ol.lot_id, ol.unit_cost into lt from public.pos_order_lines ol
       where ol.pos_order_id = v_orig.id and ol.variant_id = ln.variant_id order by ol.line_no limit 1;
      v_first_lot := coalesce(ln.lot_id, lt.lot_id);
      if ln.tracking <> 'none' and v_first_lot is null then raise exception 'Choose the lot being returned' using errcode = '23514'; end if;
      v_mv := app.post_stock_move(s.company_id, 'pos_return', ln.variant_id, v_customer, r.location_id, -ln.quantity, lt.unit_cost, v_first_lot,
                                  'pos_order', v_id, ln.id, v_number, v_order_at);
      v_cost := (select total_cost from public.stock_movements where id = v_mv);
    end if;
    update public.pos_order_lines set unit_cost = round(v_cost / abs(ln.quantity), 6), lot_id = v_first_lot where id = ln.id;
  end loop;
  perform set_config('app.pos_allow_negative', 'off', true);

  -- payments
  select total into v_total from public.pos_orders where id = v_id;
  for pay in select * from jsonb_array_elements(coalesce(p->'payments', '[]'::jsonb)) loop
    v_amt := round((pay->>'amount')::numeric, 2);
    continue when coalesce(v_amt, 0) = 0;
    if (v_amt < 0) <> v_refund then raise exception 'Payments are positive on sales and negative on refunds' using errcode = '23514'; end if;
    insert into public.pos_payments (company_id, pos_order_id, method, amount, reference, paid_at)
    values (s.company_id, v_id, pay->>'method', v_amt, nullif(pay->>'reference', ''), v_order_at);
    v_paid := v_paid + v_amt;
    if pay->>'method' = 'cash' then v_cash := v_cash + v_amt; end if;
  end loop;
  v_change := round(v_paid - v_total, 2);
  if v_refund then
    if v_change <> 0 then raise exception 'Refund payments (%) must equal the refund (%)', v_paid, v_total using errcode = '23514'; end if;
  else
    if v_change < 0 then raise exception 'Payment is % short', -v_change using errcode = '23514'; end if;
    if v_change > v_cash then raise exception 'Change can only be given from cash' using errcode = '23514'; end if;
  end if;
  update public.pos_orders set amount_paid = v_paid, change_given = greatest(v_change, 0), status = 'paid' where id = v_id;
  perform app.pos_cash_limit_notice(v_id, v_cash - greatest(v_change, 0));
  if cardinality(v_low) > 0 then
    perform app.notify_permission(s.company_id, 'pos.approve', 'warning', 'Sold under the till price: ' || v_number,
      r.name || ' · ' || array_to_string(v_low, ', '), '/pos/sessions/' || s.id);
  end if;

  -- loyalty: discount given, points spent and earned
  if v_loy is not null then
    select * into v_lc from public.loyalty_cards where id = v_card for update;
    select * into v_lg from public.loyalty_programs where id = v_lc.program_id;
    select coalesce(sum(round(ol.quantity * ol.unit_price, 2) - ol.line_total), 0) into v_ldisc
      from public.pos_order_lines ol where ol.pos_order_id = v_id
       and coalesce((v_loy -> 'lines' -> (ol.line_no - 1) ->> 'eligible')::boolean, false);
    -- the part the card type gives by itself; the rest is what the points paid for
    select coalesce(sum(round(ol.quantity * ol.unit_price, 2) - round(ol.quantity * ol.unit_price * (1 - (v_loy ->> 'pct')::numeric / 100), 2)), 0) into v_prog
      from public.pos_order_lines ol where ol.pos_order_id = v_id
       and coalesce((v_loy -> 'lines' -> (ol.line_no - 1) ->> 'eligible')::boolean, false);
    v_prog := least(v_prog, v_ldisc);
    if v_lg.kind = 'points' then
      select floor(coalesce(sum(ol.line_total), 0) * v_lg.points_per_unit) into v_earn
        from public.pos_order_lines ol where ol.pos_order_id = v_id
         and coalesce((v_loy -> 'lines' -> (ol.line_no - 1) ->> 'eligible')::boolean, false);
    end if;
    if (v_loy ->> 'redeem_points')::numeric > 0 then
      insert into public.loyalty_ledger (company_id, card_id, kind, points, amount, pos_order_id, warehouse_id, occurred_at)
      values (s.company_id, v_card, 'redeem', -(v_loy ->> 'redeem_points')::numeric, v_ldisc - v_prog, v_id, r.warehouse_id, v_order_at);
    else
      v_prog := v_ldisc;
    end if;
    if v_prog > 0 then
      insert into public.loyalty_ledger (company_id, card_id, kind, points, amount, pos_order_id, warehouse_id, occurred_at)
      values (s.company_id, v_card, 'discount', 0, v_prog, v_id, r.warehouse_id, v_order_at);
    end if;
    if v_earn > 0 then
      insert into public.loyalty_ledger (company_id, card_id, kind, points, pos_order_id, warehouse_id, occurred_at)
      values (s.company_id, v_card, 'earn', v_earn, v_id, r.warehouse_id, v_order_at);
    end if;
    update public.loyalty_cards set points_balance = points_balance + v_earn - (v_loy ->> 'redeem_points')::numeric, last_used_at = v_order_at where id = v_card;
    update public.pos_orders set loyalty_discount = v_ldisc, points_earned = v_earn, points_redeemed = (v_loy ->> 'redeem_points')::numeric where id = v_id;
  end if;
  -- a refund takes back the points the sale earned and gives back the points it spent, in proportion
  -- (never more than the sale itself), and frees the card's monthly discount it used
  if v_refund and v_orig.loyalty_card_id is not null and v_orig.total <> 0 then
    select * into v_lc from public.loyalty_cards where id = v_orig.loyalty_card_id for update;
    -- earned points already taken back / spent points already returned by earlier refunds of this receipt
    select coalesce(-sum(points) filter (where kind = 'refund' and points < 0), 0), coalesce(sum(points) filter (where kind = 'refund' and points > 0), 0)
      into v_taken, v_back
      from public.loyalty_ledger where pos_order_id in (select id from public.pos_orders where refund_of_id = v_orig.id and id <> v_id);
    v_earn := least(round(coalesce(v_orig.points_earned, 0) * -v_total / v_orig.total), greatest(coalesce(v_orig.points_earned, 0) - v_taken, 0));
    v_ldisc := least(round(coalesce(v_orig.points_redeemed, 0) * -v_total / v_orig.total), greatest(coalesce(v_orig.points_redeemed, 0) - v_back, 0));
    if v_earn > 0 then
      insert into public.loyalty_ledger (company_id, card_id, kind, points, pos_order_id, warehouse_id, occurred_at)
      values (s.company_id, v_orig.loyalty_card_id, 'refund', -v_earn, v_id, r.warehouse_id, v_order_at);
    end if;
    if v_ldisc > 0 then
      insert into public.loyalty_ledger (company_id, card_id, kind, points, pos_order_id, warehouse_id, occurred_at, note)
      values (s.company_id, v_orig.loyalty_card_id, 'refund', v_ldisc, v_id, r.warehouse_id, v_order_at, 'Points spent on the refunded goods');
    end if;
    if coalesce(v_orig.loyalty_discount, 0) > 0 then
      insert into public.loyalty_ledger (company_id, card_id, kind, points, amount, pos_order_id, warehouse_id, occurred_at)
      select s.company_id, v_orig.loyalty_card_id, 'discount', 0, -round(sum(d.amount) * -v_total / v_orig.total, 2), v_id, r.warehouse_id, v_order_at
        from public.loyalty_ledger d where d.pos_order_id = v_orig.id and d.kind = 'discount'
      having coalesce(sum(d.amount), 0) > 0;
    end if;
    if v_earn > 0 or v_ldisc > 0 then
      update public.loyalty_cards set points_balance = points_balance - v_earn + v_ldisc where id = v_orig.loyalty_card_id;
      update public.pos_orders set loyalty_card_id = v_orig.loyalty_card_id, points_earned = -v_earn, points_redeemed = -v_ldisc where id = v_id;
    end if;
  end if;
  return jsonb_build_object('id', v_id, 'number', (select number from public.pos_orders where id = v_id), 'total', v_total,
                            'change', greatest(v_change, 0), 'duplicate', false);
end $function$

;

CREATE OR REPLACE FUNCTION public.restaurant_pay(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o public.table_orders; s public.pos_sessions; x jsonb; l public.table_order_lines; v_lines uuid[] := '{}'; v_new uuid; v_res jsonb; v_payload jsonb;
begin
  -- a replay (after a timeout) waits for the tab lock, then gets the first answer (the tab may be closed by then)
  select * into o from public.table_orders where id = app.tab_id((p ->> 'tab_id')::uuid) for update;
  if o.id is null then raise exception 'Order not found' using errcode = 'P0002'; end if;
  perform app.require_permission(o.company_id, 'pos.write');
  if nullif(p ->> 'client_uuid', '') is not null then
    select jsonb_build_object('id', po.id, 'number', po.number, 'total', po.total, 'change', 0, 'replayed', true,
                              'closed', not exists (select 1 from public.table_orders t2 where t2.id = o.id and t2.status = 'open'))
      into v_res from public.pos_orders po where po.company_id = o.company_id and po.client_uuid = (p ->> 'client_uuid')::uuid;
    if v_res is not null then return v_res; end if;
  end if;
  o := app.tab_for_update(o.id);
  select * into s from public.pos_sessions where id = (p ->> 'session_id')::uuid and company_id = o.company_id;
  if s.id is not null and s.status <> 'open' then
    -- paid offline while the shift was closed meanwhile: it goes into the till's open shift
    select * into s from public.pos_sessions where register_id = s.register_id and status = 'open' and deleted_at is null;
    if s.id is null then raise exception 'SESSION_CLOSED: open the till first; paying needs an open shift' using errcode = '55000'; end if;
  end if;
  if s.id is null then raise exception 'Session not found' using errcode = 'P0002'; end if;

  if jsonb_array_length(coalesce(p -> 'split', '[]'::jsonb)) > 0 then
    for x in select * from jsonb_array_elements(p -> 'split') loop
      select * into l from public.table_order_lines where id = (x ->> 'line_id')::uuid and table_order_id = o.id and status <> 'void' and pos_order_id is null for update;
      if l.id is null then raise exception 'An item of this bill is paid or cancelled already' using errcode = '55000'; end if;
      if coalesce((x ->> 'quantity')::numeric, l.quantity) <= 0 or coalesce((x ->> 'quantity')::numeric, l.quantity) > l.quantity then
        raise exception 'Pay between 0 and % of %', l.quantity, l.name using errcode = '23514';
      end if;
      if coalesce((x ->> 'quantity')::numeric, l.quantity) < l.quantity then
        -- part of a line: it splits in two
        update public.table_order_lines set quantity = quantity - (x ->> 'quantity')::numeric where id = l.id;
        insert into public.table_order_lines (company_id, table_order_id, variant_id, name, quantity, unit_price, note, station_id, status, waiter_id, sent_at, ready_at)
        values (l.company_id, l.table_order_id, l.variant_id, l.name, (x ->> 'quantity')::numeric, l.unit_price, l.note, l.station_id, l.status, l.waiter_id, l.sent_at, l.ready_at)
        returning id into v_new;
        v_lines := v_lines || v_new;
      else
        v_lines := v_lines || l.id;
      end if;
    end loop;
  else
    select coalesce(array_agg(id), '{}') into v_lines from public.table_order_lines where table_order_id = o.id and status <> 'void' and pos_order_id is null;
  end if;
  if cardinality(v_lines) = 0 then raise exception 'Nothing to pay on this order' using errcode = '23514'; end if;

  update public.table_order_lines set status = 'sent', sent_at = now() where id = any (v_lines) and status = 'new';

  v_payload := jsonb_build_object('client_uuid', p ->> 'client_uuid', 'session_id', s.id, 'device_ref', p ->> 'device_ref', 'partner_id', p ->> 'partner_id',
    'order_at', p ->> 'order_at', 'offline', coalesce((p ->> 'offline')::boolean, false),
    'loyalty', p -> 'loyalty', 'payments', p -> 'payments',
    'lines', (select jsonb_agg(jsonb_build_object('variant_id', tl.variant_id, 'quantity', tl.quantity, 'unit_price', tl.unit_price,
                                                  'discount_pct', coalesce((select (y ->> 'discount_pct')::numeric from jsonb_array_elements(coalesce(p -> 'discounts', '[]'::jsonb)) y
                                                                            where (y ->> 'line_id')::uuid = tl.id or (y ->> 'variant_id')::uuid = tl.variant_id limit 1), 0),
                                                  'manual_pct', coalesce((select (y ->> 'manual_pct')::numeric from jsonb_array_elements(coalesce(p -> 'discounts', '[]'::jsonb)) y
                                                                            where (y ->> 'line_id')::uuid = tl.id or (y ->> 'variant_id')::uuid = tl.variant_id limit 1), 0),
                                                  'description', tl.name) order by tl.created_at)
                from public.table_order_lines tl where tl.id = any (v_lines)));
  -- the prices of a table come from the server when the items were added
  perform set_config('app.pos_trusted_prices', 'on', true);
  v_res := public.pos_submit_order(v_payload);
  perform set_config('app.pos_trusted_prices', 'off', true);
  if coalesce((v_res ->> 'duplicate')::boolean, false) then return v_res; end if;

  update public.table_order_lines set pos_order_id = (v_res ->> 'id')::uuid where id = any (v_lines);
  update public.pos_orders set table_order_id = o.id, waiter_id = o.waiter_id where id = (v_res ->> 'id')::uuid;
  if not exists (select 1 from public.table_order_lines where table_order_id = o.id and status <> 'void' and pos_order_id is null) then
    update public.table_orders set status = 'paid', closed_at = now() where id = o.id;
  end if;
  return v_res || jsonb_build_object('closed', not exists (select 1 from public.table_orders where id = o.id and status = 'open'));
end $function$

;

-- money taken from a safe for a till: never more than the safe holds
create or replace function app.safe_guard_take(p_company uuid, p_account uuid, p_amount numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare v_safe uuid; v_bal numeric;
begin
  if coalesce(p_amount, 0) <= 0 then return; end if;
  select s.id into v_safe from public.safes s join public.bank_accounts b on b.id = s.bank_account_id
   where s.company_id = p_company and b.account_id = p_account and s.deleted_at is null limit 1 for update of s;
  if v_safe is null then return; end if;
  v_bal := app.safe_balance(v_safe);
  if p_amount > v_bal then
    raise exception 'The safe has only % — it cannot give %', to_char(v_bal, 'FM999G999G990D00'), to_char(p_amount, 'FM999G999G990D00') using errcode = '23514';
  end if;
end $$;
revoke execute on function app.safe_guard_take(uuid, uuid, numeric) from public, anon, authenticated;

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;
select app._patch_function('public.open_pos_session',
  $x$  if coalesce(p_opening_cash, 0) > 0 and a.drawer <> a.cashbox then$x$,
  $x$  if coalesce(p_opening_cash, 0) > 0 and a.drawer <> a.cashbox then
    perform app.safe_guard_take(r.company_id, a.cashbox, p_opening_cash);$x$);
select app._patch_function('public.pos_cash_move',
  $x$  if a.drawer <> a.cashbox then$x$,
  $x$  if a.drawer <> a.cashbox then
    if p_type = 'cash_in' then perform app.safe_guard_take(s.company_id, a.cashbox, p_amount); end if;$x$);
drop function app._patch_function(text, text, text);
