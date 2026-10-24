-- =============================================================================
-- NexusERP Pro · 1900 · Tax & fiscal compliance engine (Phase 8)
--
-- * Every posted document is classified into VAT entries (app.vat_entries):
--   sales invoices / credit notes, POS receipts (daily totals per register),
--   vendor bills / credits, and import VAT from customs clearance (landed
--   costs carrying the customs declaration).
-- * The Sales Book / Purchase Book are laid out per country:
--     XK — columns numbered as the fields of the ATK VAT return [9]…[66];
--          credit notes issued go to the purchase book [53]–[56], credit
--          notes received to the sales book [16]–[19], as ATK requires.
--     AL — rate columns (20/10/6 %), exports, exempt, imports, investments,
--          reverse charge; credit notes negative in their own book.
-- * The VAT declaration sums the books, carries the credit forward from the
--   previous declaration, posts the settlement entry when submitted and locks
--   the period against back-dated postings.
-- * Reverse charge: the vendor charges no VAT; the company self-assesses
--   (Dr input VAT / Cr output VAT). Non-deductible VAT is expensed.
-- * Fiscalization: posted invoices and paid POS receipts are queued with the
--   fields the authority needs; the test environment simulates the response.
--   The real CIS / ATK call belongs in the `fiscalize` Edge Function.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Schema additions
-- -----------------------------------------------------------------------------
alter table public.tax_codes
  add column vat_category  text check (vat_category in ('exempt_credit','export','farmer')),
  add column is_deductible boolean not null default true;
comment on column public.tax_codes.vat_category is
  'Refines how lines land in the VAT books: exempt_credit = exempt with right to credit (XK [10]); export; farmer = purchases from farmers (XK [51]).';

alter table public.landed_costs
  add column customs_declaration_number text,
  add column customs_declaration_date   date,
  add column customs_value              numeric(18,2) not null default 0 check (customs_value >= 0),
  add column import_vat_rate            numeric(7,4)  not null default 0 check (import_vat_rate >= 0),
  add column import_vat                 numeric(18,2) not null default 0 check (import_vat >= 0);
comment on column public.landed_costs.customs_value is 'VAT base on the customs declaration (customs value + duty), base currency';
comment on column public.landed_costs.import_vat    is 'Import VAT paid at customs; deductible input VAT of the declaration date';

alter table public.vat_declarations
  add column refund_requested numeric(18,2) not null default 0 check (refund_requested >= 0),
  add column carry_forward    numeric(18,2) not null default 0,
  add column payable          numeric(18,2) not null default 0,
  add column decided_at       timestamptz,
  add column decision_note    text;

alter table public.company_account_defaults drop constraint company_account_defaults_key_check;
alter table public.company_account_defaults add constraint company_account_defaults_key_check check (key in (
  'receivable','payable','customer_advances','vendor_advances',
  'inventory','grni','cogs','purchase_price_variance','inventory_adjustment','landed_cost_clearing',
  'wip','labor_absorbed','overhead_absorbed','production_variance',
  'sales_revenue','sales_discount','vat_output','vat_input','vat_settlement',
  'cash','bank','pos_cash','card_clearing','rounding','exchange_gain','exchange_loss',
  'retained_earnings','current_year_earnings',
  'salary_expense','salary_payable','social_security_payable','health_insurance_payable',
  'pension_payable','income_tax_payable','employer_contribution_expense',
  'depreciation_expense','accumulated_depreciation','asset_disposal_gain','asset_disposal_loss',
  'purchase_expense','opening_balance','bank_charges','cash_difference'));

-- Accounts and codes added in Phase 8 (idempotent; existing and new companies)
create or replace function app.seed_tax_defaults(p_company uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.companies;
begin
  select * into c from public.companies where id = p_company;
  if not exists (select 1 from public.accounts where company_id = p_company and code = '4') then return; end if;
  insert into public.accounts (company_id, code, name, account_type, account_subtype, is_reconcilable, cash_flow_category, parent_id)
  select p_company, '4455', 'VAT settlement (payable / credit)', 'liability', 'tax', false, 'operating',
         (select id from public.accounts where company_id = p_company and code = '4')
   where not exists (select 1 from public.accounts where company_id = p_company and code = '4455' and deleted_at is null);
  insert into public.company_account_defaults (company_id, key, account_id)
  select p_company, 'vat_settlement', id from public.accounts where company_id = p_company and code = '4455' and deleted_at is null
  on conflict (company_id, key) do nothing;
end $$;

create or replace function app.tg_company_tax_defaults()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform app.seed_tax_defaults(new.id);
  return null;
end $$;
create trigger trg_96_tax_defaults after insert on public.companies
  for each row execute function app.tg_company_tax_defaults();
select app.seed_tax_defaults(id) from public.companies;

-- Albania has a 10 % rate (fertilisers, seeds, plant protection) besides 20 % and 6 %
create or replace function app.tg_tax_code_al10()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.code = 'VAT6' and new.country_code = 'AL' then
    insert into public.tax_codes (company_id, code, name, rate, scope, country_code)
    select new.company_id, 'VAT10', 'TVSH 10%', 10, 'both', 'AL'
     where not exists (select 1 from public.tax_codes where company_id = new.company_id and code = 'VAT10' and deleted_at is null);
  end if;
  return null;
end $$;
create trigger trg_50_al10 after insert on public.tax_codes for each row execute function app.tg_tax_code_al10();
insert into public.tax_codes (company_id, code, name, rate, scope, country_code)
select t.company_id, 'VAT10', 'TVSH 10%', 10, 'both', 'AL' from public.tax_codes t
 where t.code = 'VAT6' and t.country_code = 'AL' and t.deleted_at is null
   and not exists (select 1 from public.tax_codes x where x.company_id = t.company_id and x.code = 'VAT10' and x.deleted_at is null);
update public.tax_codes set vat_category = 'export' where code = 'VAT0' and vat_category is null;
-- new companies: the 0 % sales code is the export code
create or replace function app.tg_tax_code_category()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.code = 'VAT0' and new.vat_category is null and new.rate = 0 and not new.is_exempt then new.vat_category := 'export'; end if;
  return new;
end $$;
create trigger trg_04_category before insert on public.tax_codes for each row execute function app.tg_tax_code_category();

-- -----------------------------------------------------------------------------
-- 2. Reverse charge, non-deductible VAT, import VAT in the ledger
-- -----------------------------------------------------------------------------
-- Lines with a reverse-charge code carry no VAT from the vendor (the buyer self-assesses)
create or replace function app.tg_snapshot_tax_rate()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.tax_code_id is distinct from old.tax_code_id then
    new.tax_rate := coalesce((select case when t.is_reverse_charge then 0 else t.rate end from public.tax_codes t
                               where t.id = new.tax_code_id and t.company_id = new.company_id), 0);
  end if;
  return new;
end $$;

create or replace function app.gl_vendor_bill(p_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare b public.vendor_bills; s int; v_lines jsonb := '[]'::jsonb; l record; v_ap uuid; v_je uuid; v_base numeric; v_exp uuid; v_rc numeric;
begin
  select * into b from public.vendor_bills where id = p_id;
  s := case when b.document_type = 'vendor_credit' then -1 else 1 end;
  select coalesce(payable_account_id, app.acct(b.company_id, 'payable')) into v_ap from public.business_partners where id = b.vendor_id;
  v_lines := v_lines || jsonb_build_object('account_id', v_ap, 'amount', -s * round(b.total * b.exchange_rate, 2), 'partner_id', b.vendor_id,
                                           'currency_code', b.currency_code, 'amount_currency', -s * b.total,
                                           'description', b.number || ' · ' || b.vendor_invoice_number);
  for l in
    select bl.*, t.input_account_id, t.output_account_id, coalesce(t.is_reverse_charge, false) as rc, t.rate as code_rate,
           coalesce(t.is_deductible, true) as deductible,
           coalesce(p.product_type, 'service') as product_type, coalesce(bl.variant_id, pl.variant_id) as item_id
      from public.vendor_bill_lines bl
      left join public.tax_codes t on t.id = bl.tax_code_id
      left join public.purchase_order_lines pl on pl.id = bl.po_line_id
      left join public.product_variants v on v.id = coalesce(bl.variant_id, pl.variant_id)
      left join public.products p on p.id = v.product_id
     where bl.bill_id = b.id
  loop
    v_base := round(l.line_subtotal * b.exchange_rate, 2);
    v_exp := null;
    if l.po_line_id is not null and l.product_type = 'stockable' and l.account_id is null then
      v_lines := v_lines
        || jsonb_build_object('account_id', app.acct(b.company_id, 'grni'), 'amount', s * (v_base - l.capitalized_variance - l.expensed_variance),
                              'variant_id', l.item_id, 'partner_id', b.vendor_id, 'description', l.description)
        || jsonb_build_object('account_id', app.item_acct(b.company_id, l.item_id, 'inventory'), 'amount', s * l.capitalized_variance,
                              'variant_id', l.item_id, 'description', 'Price difference on stock')
        || jsonb_build_object('account_id', app.item_acct(b.company_id, l.item_id, 'purchase_price_variance'), 'amount', s * l.expensed_variance,
                              'variant_id', l.item_id, 'description', 'Price difference on goods already sold');
      v_exp := app.item_acct(b.company_id, l.item_id, 'inventory');
    else
      v_exp := coalesce(l.account_id, case when l.item_id is not null and l.product_type = 'stockable' then app.item_acct(b.company_id, l.item_id, 'cogs')
                                           when l.item_id is not null then app.item_acct(b.company_id, l.item_id, 'expense')
                                           else app.acct(b.company_id, 'purchase_expense') end);
      v_lines := v_lines || jsonb_build_object('account_id', v_exp, 'amount', s * v_base, 'cost_center_id', l.cost_center_id,
                                               'variant_id', l.item_id, 'description', l.description);
    end if;
    if l.tax_amount <> 0 then
      v_lines := v_lines || jsonb_build_object(
        'account_id', case when l.deductible then coalesce(l.input_account_id, app.acct(b.company_id, 'vat_input')) else v_exp end,
        'amount', s * round(l.tax_amount * b.exchange_rate, 2), 'tax_code_id', l.tax_code_id,
        'description', case when l.deductible then 'VAT' else 'Non-deductible VAT' end);
    end if;
    if l.rc and coalesce(l.code_rate, 0) > 0 then
      v_rc := round(v_base * l.code_rate / 100, 2);
      v_lines := v_lines
        || jsonb_build_object('account_id', coalesce(l.input_account_id, app.acct(b.company_id, 'vat_input')), 'amount', s * v_rc,
                              'tax_code_id', l.tax_code_id, 'description', 'Reverse charge VAT (deductible)')
        || jsonb_build_object('account_id', coalesce(l.output_account_id, app.acct(b.company_id, 'vat_output')), 'amount', -s * v_rc,
                              'tax_code_id', l.tax_code_id, 'description', 'Reverse charge VAT (self-assessed)');
    end if;
  end loop;
  v_je := app.gl_post(b.company_id, 'PUR', b.bill_date, b.document_type, b.id, b.number,
                      case when s = 1 then 'Vendor bill ' else 'Vendor credit ' end || b.vendor_invoice_number, v_lines, 'main', b.currency_code);
  update public.vendor_bills set journal_entry_id = v_je where id = b.id;
  return v_je;
end $$;

-- Import VAT paid at customs: Dr input VAT / Cr customs clearing (cleared by the customs or forwarder bill)
create or replace function app.gl_landed_cost(p_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare lc public.landed_costs; v_lines jsonb := '[]'::jsonb; a record; v_je uuid;
begin
  select * into lc from public.landed_costs where id = p_id;
  for a in select la.*, gl.variant_id from public.landed_cost_allocations la join public.goods_receipt_lines gl on gl.id = la.receipt_line_id
            where la.landed_cost_id = lc.id loop
    v_lines := v_lines
      || jsonb_build_object('account_id', app.item_acct(lc.company_id, a.variant_id, 'inventory'), 'amount', a.capitalized_amount, 'variant_id', a.variant_id,
                            'description', 'Landed cost capitalised')
      || jsonb_build_object('account_id', app.item_acct(lc.company_id, a.variant_id, 'cogs'), 'amount', a.expensed_amount, 'variant_id', a.variant_id,
                            'description', 'Landed cost on goods already sold');
  end loop;
  v_lines := v_lines || jsonb_build_object('account_id', app.acct(lc.company_id, 'landed_cost_clearing'), 'amount', -lc.total_amount,
                                           'description', 'Charges to be invoiced by forwarder / customs');
  if lc.import_vat > 0 then
    v_lines := v_lines
      || jsonb_build_object('account_id', app.acct(lc.company_id, 'vat_input'), 'amount', lc.import_vat,
                            'description', 'Import VAT · ' || coalesce(lc.customs_declaration_number, lc.number))
      || jsonb_build_object('account_id', app.acct(lc.company_id, 'landed_cost_clearing'), 'amount', -lc.import_vat,
                            'description', 'Import VAT to be paid to customs');
  end if;
  v_je := app.gl_post(lc.company_id, 'INV', lc.landed_cost_date, 'landed_cost', lc.id, lc.number, 'Landed cost ' || lc.number, v_lines);
  update public.landed_costs set journal_entry_id = v_je where id = lc.id;
  return v_je;
end $$;

create or replace function app.tg_landed_cost_import_vat()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'draft' and tg_op = 'UPDATE' and old.status <> 'draft' then return new; end if;
  if new.customs_value > 0 and new.import_vat_rate = 0 then
    new.import_vat_rate := (select case when country_code = 'XK' then 18 else 20 end from public.companies where id = new.company_id);
  end if;
  if new.customs_value > 0 and (tg_op = 'INSERT' and new.import_vat = 0
       or tg_op = 'UPDATE' and new.import_vat = old.import_vat
          and (new.customs_value is distinct from old.customs_value or new.import_vat_rate is distinct from old.import_vat_rate)) then
    new.import_vat := round(new.customs_value * new.import_vat_rate / 100, 2);
  end if;
  return new;
end $$;
create trigger trg_04_import_vat before insert or update of customs_value, import_vat_rate, import_vat on public.landed_costs
  for each row execute function app.tg_landed_cost_import_vat();

-- -----------------------------------------------------------------------------
-- 3. VAT entries — one row per document × VAT treatment × rate, base currency
-- -----------------------------------------------------------------------------
-- kind (sales side):    taxable | exempt | exempt_credit | export
-- kind (purchase side): domestic | investment | import | farmer | no_vat | no_vat_investment
--                       | non_deductible | non_deductible_investment | reverse_charge
create or replace function app.vat_entries(p_company uuid, p_from date, p_to date)
returns table (side text, src text, doc_type text, doc_id uuid, number text, ref text, doc_date date, partner text, tax_number text,
               fiscal_code text, is_credit boolean, kind text, rate numeric, base numeric, vat numeric, href text)
language sql stable security definer set search_path = '' as $$
  -- customer invoices and credit notes (POS-generated invoices are covered by the POS receipts)
  select 'sale', 'invoice', i.document_type, i.id, i.number, null::text, i.invoice_date, p.name, coalesce(p.tax_number, p.vat_number),
         (select coalesce(f.fic, f.verification_code) from public.fiscalization_records f
           where f.source_doc_id = i.id and f.status = 'fiscalized' order by f.fiscalized_at desc limit 1),
         i.document_type = 'credit_note', x.kind, l.tax_rate,
         round(sum(l.line_subtotal) * i.exchange_rate, 2), round(sum(l.tax_amount) * i.exchange_rate, 2), '/sales/invoices/' || i.id
    from public.sales_invoices i
    join public.sales_invoice_lines l on l.invoice_id = i.id
    join public.business_partners p on p.id = i.partner_id
    left join public.tax_codes tc on tc.id = l.tax_code_id
    cross join lateral (select case when coalesce(tc.is_exempt, false) then case when tc.vat_category = 'exempt_credit' then 'exempt_credit' else 'exempt' end
                                    when l.tax_rate = 0 then 'export' else 'taxable' end as kind) x
   where i.company_id = p_company and i.status = 'posted' and i.deleted_at is null and i.source <> 'pos'
     and i.invoice_date between p_from and p_to
   group by i.id, p.name, p.tax_number, p.vat_number, x.kind, l.tax_rate
  union all
  -- POS receipts: daily totals per register; receipts to a customer with a tax number are listed one by one.
  -- Refund lines are stored negative; entries carry magnitudes with is_credit.
  select 'sale', 'pos', case when q.is_refund then 'credit_note' else 'sales_invoice' end, q.doc_id, q.number,
         case when q.doc_id is null then count(distinct q.order_id) || ' receipts' end, q.d, q.partner, q.tax_number,
         null, q.is_refund, q.kind, q.tax_rate,
         sum(q.line_subtotal) * case when q.is_refund then -1 else 1 end, sum(q.tax_amount) * case when q.is_refund then -1 else 1 end,
         '/pos?register=' || q.register_id
    from (select o.id as order_id, o.is_refund, r.id as register_id, l.tax_rate, l.line_subtotal, l.tax_amount, d.d, x.kind,
                 case when b2b.yes then o.id end as doc_id,
                 case when b2b.yes then o.number else 'POS ' || r.code || ' · ' || to_char(d.d, 'DD.MM.YYYY') end as number,
                 case when b2b.yes then p.name else 'Retail customers' end as partner,
                 case when b2b.yes then p.tax_number end as tax_number
            from public.pos_orders o
            join public.companies c on c.id = o.company_id
            join public.pos_registers r on r.id = o.register_id
            join public.pos_order_lines l on l.pos_order_id = o.id
            left join public.business_partners p on p.id = o.partner_id
            left join public.tax_codes tc on tc.id = l.tax_code_id
            cross join lateral (select (o.order_at at time zone c.timezone)::date as d) d
            cross join lateral (select p.tax_number is not null and p.id is distinct from r.default_customer_id as yes) b2b
            cross join lateral (select case when coalesce(tc.is_exempt, false) then case when tc.vat_category = 'exempt_credit' then 'exempt_credit' else 'exempt' end
                                            when l.tax_rate = 0 then 'export' else 'taxable' end as kind) x
           where o.company_id = p_company and o.status = 'paid' and o.deleted_at is null
             and (o.order_at at time zone c.timezone)::date between p_from and p_to) q
   group by q.is_refund, q.doc_id, q.number, q.d, q.partner, q.tax_number, q.kind, q.tax_rate, q.register_id
  union all
  -- vendor bills and vendor credit notes
  select 'purchase', 'bill', b.document_type, b.id, b.number, b.vendor_invoice_number, b.bill_date, p.name, coalesce(p.tax_number, p.vat_number),
         null, b.document_type = 'vendor_credit', x.kind, x.rate,
         round(sum(l.line_subtotal) * b.exchange_rate, 2),
         case when x.kind = 'reverse_charge' then round(round(sum(l.line_subtotal) * b.exchange_rate, 2) * x.rate / 100, 2)
              else round(sum(l.tax_amount) * b.exchange_rate, 2) end,
         '/procurement/bills/' || b.id
    from public.vendor_bills b
    join public.vendor_bill_lines l on l.bill_id = b.id
    join public.business_partners p on p.id = b.vendor_id
    left join public.tax_codes tc on tc.id = l.tax_code_id
    left join public.accounts a on a.id = l.account_id
    cross join lateral (select coalesce(a.account_subtype = 'fixed_asset', false) as inv) i
    cross join lateral (select
       case when coalesce(tc.is_reverse_charge, false) then 'reverse_charge'
            when not coalesce(tc.is_deductible, true) then case when i.inv then 'non_deductible_investment' else 'non_deductible' end
            when coalesce(tc.is_exempt, false) or l.tax_rate = 0 then case when i.inv then 'no_vat_investment' else 'no_vat' end
            when tc.vat_category = 'farmer' then 'farmer'
            when i.inv then 'investment' else 'domestic' end as kind,
       case when coalesce(tc.is_reverse_charge, false) then tc.rate else l.tax_rate end as rate) x
   where b.company_id = p_company and b.status = 'posted' and b.deleted_at is null and b.bill_date between p_from and p_to
   group by b.id, p.name, p.tax_number, p.vat_number, x.kind, x.rate
  union all
  -- import VAT from the customs declaration (DUD)
  select 'purchase', 'customs', 'landed_cost', lc.id, coalesce(lc.customs_declaration_number, lc.number), lc.number,
         coalesce(lc.customs_declaration_date, lc.landed_cost_date),
         coalesce((select p.name from public.vendor_bills vb join public.business_partners p on p.id = vb.vendor_id where vb.id = lc.vendor_bill_id), 'Customs'),
         null, null, false, 'import', lc.import_vat_rate, lc.customs_value, lc.import_vat, '/inventory/landed-costs/' || lc.id
    from public.landed_costs lc
   where lc.company_id = p_company and lc.status = 'posted' and lc.deleted_at is null and (lc.import_vat > 0 or lc.customs_value > 0)
     and coalesce(lc.customs_declaration_date, lc.landed_cost_date) between p_from and p_to
$$;

-- Where an entry lands: book + columns (sign included). One entry can land in both books (reverse charge).
create or replace function app.vat_cols(p_country text, p_book text, p_side text, p_credit boolean, p_kind text,
                                        p_rate numeric, p_base numeric, p_vat numeric)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare s int := case when p_credit then -1 else 1 end; b text; v text; r text;
begin
  if p_country = 'XK' then
    r := case when p_rate >= 13 then '18' else '8' end;
    if p_book = 'sales' then
      if p_side = 'sale' then
        if p_kind = 'taxable' and p_credit then return null; end if;          -- credit notes issued → purchase book [53]–[56]
        return case p_kind
          when 'exempt'        then jsonb_build_object('9', s * p_base)
          when 'exempt_credit' then jsonb_build_object('10', s * p_base)
          when 'export'        then jsonb_build_object('11', s * p_base)
          else case r when '18' then jsonb_build_object('12', p_base, '13', p_vat) else jsonb_build_object('14', p_base, '15', p_vat) end end;
      end if;
      if p_kind = 'reverse_charge' then return jsonb_build_object('28', s * p_base, '29', s * p_vat); end if;
      if p_credit and p_kind in ('domestic','investment','farmer','import') and p_vat <> 0 then   -- credit notes received
        return case r when '18' then jsonb_build_object('16', p_base, '17', p_vat) else jsonb_build_object('18', p_base, '19', p_vat) end;
      end if;
      return null;
    end if;
    -- purchase book
    if p_side = 'sale' then
      if p_kind = 'taxable' and p_credit then
        return case r when '18' then jsonb_build_object('53', p_base, '54', p_vat) else jsonb_build_object('55', p_base, '56', p_vat) end;
      end if;
      return null;
    end if;
    if p_credit and p_kind in ('domestic','investment','farmer','import') and p_vat <> 0 then return null; end if;
    return case p_kind
      when 'no_vat'                    then jsonb_build_object('31', s * p_base)
      when 'no_vat_investment'         then jsonb_build_object('32', s * p_base)
      when 'non_deductible'            then jsonb_build_object('33', s * (p_base + p_vat))
      when 'non_deductible_investment' then jsonb_build_object('34', s * (p_base + p_vat))
      when 'import'     then case r when '18' then jsonb_build_object('35', s * p_base, '36', s * p_vat) else jsonb_build_object('37', s * p_base, '38', s * p_vat) end
      when 'investment' then case r when '18' then jsonb_build_object('47', s * p_base, '48', s * p_vat) else jsonb_build_object('49', s * p_base, '50', s * p_vat) end
      when 'farmer'     then jsonb_build_object('51', s * p_base, '52', s * p_vat)
      when 'reverse_charge' then jsonb_build_object('65', s * p_base, '66', s * p_vat)
      else case r when '18' then jsonb_build_object('43', s * p_base, '44', s * p_vat) else jsonb_build_object('45', s * p_base, '46', s * p_vat) end end;
  end if;

  -- Albania
  r := case when p_rate >= 15 then '20' when p_rate >= 8 then '10' else '6' end;
  if p_book = 'sales' then
    if p_side = 'sale' then
      return case p_kind
        when 'exempt' then jsonb_build_object('exempt', s * p_base)
        when 'exempt_credit' then jsonb_build_object('exempt', s * p_base)
        when 'export' then jsonb_build_object('export', s * p_base)
        else jsonb_build_object('b' || r, s * p_base, 'v' || r, s * p_vat) end;
    end if;
    if p_kind = 'reverse_charge' then return jsonb_build_object('rcb', s * p_base, 'rcv', s * p_vat); end if;
    return null;
  end if;
  if p_side = 'sale' then return null; end if;
  return case p_kind
    when 'no_vat' then jsonb_build_object('novat', s * p_base)
    when 'no_vat_investment' then jsonb_build_object('novat', s * p_base)
    when 'non_deductible' then jsonb_build_object('nded', s * (p_base + p_vat))
    when 'non_deductible_investment' then jsonb_build_object('nded', s * (p_base + p_vat))
    when 'import' then jsonb_build_object('impb', s * p_base, 'impv', s * p_vat)
    when 'investment' then jsonb_build_object('invb', s * p_base, 'invv', s * p_vat)
    when 'reverse_charge' then jsonb_build_object('rcb', s * p_base, 'rcv', s * p_vat)
    else jsonb_build_object('b' || r, s * p_base, 'v' || r, s * p_vat) end;
end $$;

-- Book and declaration layouts (labels in English and Albanian)
create or replace function public.vat_layout(p_country text)
returns jsonb language sql immutable set search_path = '' as $$
  select case when p_country = 'XK' then jsonb_build_object(
    'sales_title', 'Libri i Shitjes', 'purchase_title', 'Libri i Blerjes', 'form_title', 'Deklarata e TVSH-së (ATK)', 'numbered', true,
    'sales_cols', jsonb_build_array(
      jsonb_build_object('key','9',  'label','Exempt without right to credit', 'sq','Shitjet e liruara pa të drejtë kreditimi'),
      jsonb_build_object('key','10', 'label','Exempt with right to credit',    'sq','Shitjet e liruara me të drejtë kreditimi'),
      jsonb_build_object('key','11', 'label','Exports',                         'sq','Eksportet'),
      jsonb_build_object('key','12', 'label','Taxable 18%',                     'sq','Shitjet e tatueshme me normën 18%'),
      jsonb_build_object('key','13', 'label','VAT 18%',                         'sq','TVSH 18%', 'vat', true),
      jsonb_build_object('key','14', 'label','Taxable 8%',                      'sq','Shitjet e tatueshme me normën 8%'),
      jsonb_build_object('key','15', 'label','VAT 8%',                          'sq','TVSH 8%', 'vat', true),
      jsonb_build_object('key','16', 'label','Credit notes received 18%',       'sq','Nota debitore e lëshuar, nota kreditore e pranuar 18%'),
      jsonb_build_object('key','17', 'label','VAT',                             'sq','TVSH', 'vat', true),
      jsonb_build_object('key','18', 'label','Credit notes received 8%',        'sq','Nota debitore e lëshuar, nota kreditore e pranuar 8%'),
      jsonb_build_object('key','19', 'label','VAT',                             'sq','TVSH', 'vat', true),
      jsonb_build_object('key','28', 'label','Reverse charge purchases',        'sq','Blerjet që i nënshtrohen ngarkesës së kundërt'),
      jsonb_build_object('key','29', 'label','VAT',                             'sq','TVSH', 'vat', true)),
    'purchase_cols', jsonb_build_array(
      jsonb_build_object('key','31', 'label','Purchases and imports without VAT',            'sq','Blerjet dhe importet pa TVSH'),
      jsonb_build_object('key','32', 'label','Capital purchases without VAT',                'sq','Blerjet dhe importet investive pa TVSH'),
      jsonb_build_object('key','33', 'label','With non-deductible VAT',                      'sq','Blerjet dhe importet me TVSH jo të zbritshme'),
      jsonb_build_object('key','34', 'label','Capital, non-deductible VAT',                  'sq','Blerjet dhe importet investive me TVSH jo të zbritshme'),
      jsonb_build_object('key','35', 'label','Imports 18%',                                  'sq','Importet me normë 18%'),
      jsonb_build_object('key','36', 'label','VAT',                                          'sq','TVSH', 'vat', true),
      jsonb_build_object('key','37', 'label','Imports 8%',                                   'sq','Importet me normë 8%'),
      jsonb_build_object('key','38', 'label','VAT',                                          'sq','TVSH', 'vat', true),
      jsonb_build_object('key','43', 'label','Domestic purchases 18%',                       'sq','Blerjet vendore me normë 18%'),
      jsonb_build_object('key','44', 'label','VAT',                                          'sq','TVSH', 'vat', true),
      jsonb_build_object('key','45', 'label','Domestic purchases 8%',                        'sq','Blerjet vendore me normë 8%'),
      jsonb_build_object('key','46', 'label','VAT',                                          'sq','TVSH', 'vat', true),
      jsonb_build_object('key','47', 'label','Domestic capital purchases 18%',               'sq','Blerjet investive vendore me normë 18%'),
      jsonb_build_object('key','48', 'label','VAT',                                          'sq','TVSH', 'vat', true),
      jsonb_build_object('key','49', 'label','Domestic capital purchases 8%',                'sq','Blerjet investive vendore me normë 8%'),
      jsonb_build_object('key','50', 'label','VAT',                                          'sq','TVSH', 'vat', true),
      jsonb_build_object('key','51', 'label','Purchases from farmers 8%',                    'sq','Blerjet nga fermerët vendorë me normë 8%'),
      jsonb_build_object('key','52', 'label','VAT',                                          'sq','TVSH', 'vat', true),
      jsonb_build_object('key','53', 'label','Credit notes issued 18%',                      'sq','Nota debitore e pranuar, nota kreditore e lëshuar 18%'),
      jsonb_build_object('key','54', 'label','VAT',                                          'sq','TVSH', 'vat', true),
      jsonb_build_object('key','55', 'label','Credit notes issued 8%',                       'sq','Nota debitore e pranuar, nota kreditore e lëshuar 8%'),
      jsonb_build_object('key','56', 'label','VAT',                                          'sq','TVSH', 'vat', true),
      jsonb_build_object('key','65', 'label','Reverse charge, right to credit 18%',          'sq','E drejta e kreditimit të TVSH-së në lidhje me ngarkesën e kundërt 18%'),
      jsonb_build_object('key','66', 'label','VAT',                                          'sq','TVSH', 'vat', true)),
    'form', jsonb_build_array(
      jsonb_build_object('section','Supplies (output)', 'sq','Furnizimet'),
      jsonb_build_object('code','9',  'base','9',  'label','Exempt supplies without right to credit', 'sq','Shitjet e liruara pa të drejtë kreditimi'),
      jsonb_build_object('code','10', 'base','10', 'label','Exempt supplies with right to credit', 'sq','Shitjet e liruara me të drejtë kreditimi'),
      jsonb_build_object('code','11', 'base','11', 'label','Exports', 'sq','Eksportet'),
      jsonb_build_object('code','12/13', 'base','12', 'vat','13', 'label','Taxable supplies at 18%', 'sq','Shitjet e tatueshme me normën 18%'),
      jsonb_build_object('code','14/15', 'base','14', 'vat','15', 'label','Taxable supplies at 8%', 'sq','Shitjet e tatueshme me normën 8%'),
      jsonb_build_object('code','16/17', 'base','16', 'vat','17', 'label','Debit notes issued, credit notes received at 18%', 'sq','Nota debitore e lëshuar, nota kreditore e pranuar me normë 18%'),
      jsonb_build_object('code','18/19', 'base','18', 'vat','19', 'label','Debit notes issued, credit notes received at 8%', 'sq','Nota debitore e lëshuar, nota kreditore e pranuar me normë 8%'),
      jsonb_build_object('code','20/21', 'base','20', 'vat','21', 'label','Bad debt recovered at 18%', 'sq','Fatura e borxhit të keq e pranuar, inkasimi i B.K me normë 18%'),
      jsonb_build_object('code','22/23', 'base','22', 'vat','23', 'label','Bad debt recovered at 8%', 'sq','Fatura e borxhit të keq e pranuar, inkasimi i B.K me normë 8%'),
      jsonb_build_object('code','24/25', 'base','24', 'vat','25', 'label','Adjustments increasing VAT at 18%', 'sq','Rregullimet për të rritur TVSH-në me normë 18%'),
      jsonb_build_object('code','26/27', 'base','26', 'vat','27', 'label','Adjustments increasing VAT at 8%', 'sq','Rregullimet për të rritur TVSH-në me normë 8%'),
      jsonb_build_object('code','28/29', 'base','28', 'vat','29', 'label','Purchases subject to reverse charge', 'sq','Blerjet që i nënshtrohen ngarkesës së kundërt'),
      jsonb_build_object('code','30', 'vat','30', 'label','Total VAT calculated', 'sq','TVSH e llogaritur gjithsej', 'total', true),
      jsonb_build_object('section','Purchases (input)', 'sq','Blerjet'),
      jsonb_build_object('code','31', 'base','31', 'label','Purchases and imports without VAT', 'sq','Blerjet dhe importet pa TVSH'),
      jsonb_build_object('code','32', 'base','32', 'label','Capital purchases and imports without VAT', 'sq','Blerjet dhe importet investive pa TVSH'),
      jsonb_build_object('code','33', 'base','33', 'label','Purchases and imports with non-deductible VAT', 'sq','Blerjet dhe importet me TVSH jo të zbritshme'),
      jsonb_build_object('code','34', 'base','34', 'label','Capital purchases and imports with non-deductible VAT', 'sq','Blerjet dhe importet investive me TVSH jo të zbritshme'),
      jsonb_build_object('code','35/36', 'base','35', 'vat','36', 'label','Imports at 18%', 'sq','Importet me normë 18%'),
      jsonb_build_object('code','37/38', 'base','37', 'vat','38', 'label','Imports at 8%', 'sq','Importet me normë 8%'),
      jsonb_build_object('code','39/40', 'base','39', 'vat','40', 'label','Capital imports at 18%', 'sq','Importet investive me normë 18%'),
      jsonb_build_object('code','41/42', 'base','41', 'vat','42', 'label','Capital imports at 8%', 'sq','Importet investive me normë 8%'),
      jsonb_build_object('code','43/44', 'base','43', 'vat','44', 'label','Domestic purchases at 18%', 'sq','Blerjet vendore me normë 18%'),
      jsonb_build_object('code','45/46', 'base','45', 'vat','46', 'label','Domestic purchases at 8%', 'sq','Blerjet vendore me normë 8%'),
      jsonb_build_object('code','47/48', 'base','47', 'vat','48', 'label','Domestic capital purchases at 18%', 'sq','Blerjet investive vendore me normë 18%'),
      jsonb_build_object('code','49/50', 'base','49', 'vat','50', 'label','Domestic capital purchases at 8%', 'sq','Blerjet investive vendore me normë 8%'),
      jsonb_build_object('code','51/52', 'base','51', 'vat','52', 'label','Purchases from domestic farmers at 8%', 'sq','Blerjet nga fermerët vendorë me normë 8%'),
      jsonb_build_object('code','53/54', 'base','53', 'vat','54', 'label','Debit notes received, credit notes issued at 18%', 'sq','Nota debitore e pranuar, nota kreditore e lëshuar me normë 18%'),
      jsonb_build_object('code','55/56', 'base','55', 'vat','56', 'label','Debit notes received, credit notes issued at 8%', 'sq','Nota debitore e pranuar, nota kreditore e lëshuar me normë 8%'),
      jsonb_build_object('code','57/58', 'base','57', 'vat','58', 'label','Bad debt written off at 18%', 'sq','Fatura e borxhit të keq e lëshuar, pagesa e borxhit të keq me normë 18%'),
      jsonb_build_object('code','59/60', 'base','59', 'vat','60', 'label','Bad debt written off at 8%', 'sq','Fatura e borxhit të keq e lëshuar, pagesa e borxhit të keq me normë 8%'),
      jsonb_build_object('code','61/62', 'base','61', 'vat','62', 'label','Adjustments decreasing VAT at 18%', 'sq','Rregullimet për të ulur TVSH-në me normë 18%'),
      jsonb_build_object('code','63/64', 'base','63', 'vat','64', 'label','Adjustments decreasing VAT at 8%', 'sq','Rregullimet për të ulur TVSH-në me normë 8%'),
      jsonb_build_object('code','65/66', 'base','65', 'vat','66', 'label','Right to credit on reverse charge at 18%', 'sq','E drejta e kreditimit të TVSH-së në lidhje me ngarkesën e kundërt me normë 18%'),
      jsonb_build_object('code','67', 'vat','67', 'label','Total deductible VAT', 'sq','TVSH e zbritshme gjithsej', 'total', true),
      jsonb_build_object('section','Calculation', 'sq','Kalkulimi'),
      jsonb_build_object('code','68', 'vat','68', 'label','VAT credit brought forward from last month', 'sq','Teprica e TVSH-së e bartur nga muaji i kaluar'),
      jsonb_build_object('code','69', 'vat','69', 'label','Remaining credit balance', 'sq','Balanca kreditore e mbetur'),
      jsonb_build_object('code','70', 'vat','70', 'label','Refund requested', 'sq','Kërkesa për rimbursim'),
      jsonb_build_object('code','71', 'vat','71', 'label','VAT credit carried to next month', 'sq','Kreditimi i TVSH-së për muajin pasues'),
      jsonb_build_object('code','72', 'vat','72', 'label','VAT payable', 'sq','TVSH që duhet të paguhet', 'total', true)))
  else jsonb_build_object(
    'sales_title', 'Libri i Shitjeve', 'purchase_title', 'Libri i Blerjeve', 'form_title', 'Deklarata e TVSH-së (DPT)', 'numbered', false,
    'sales_cols', jsonb_build_array(
      jsonb_build_object('key','exempt', 'label','Exempt',             'sq','Furnizime të përjashtuara'),
      jsonb_build_object('key','export', 'label','Exports 0%',         'sq','Eksporte (0%)'),
      jsonb_build_object('key','b20',    'label','Taxable 20%',        'sq','Vlera e tatueshme 20%'),
      jsonb_build_object('key','v20',    'label','VAT 20%',            'sq','TVSH 20%', 'vat', true),
      jsonb_build_object('key','b10',    'label','Taxable 10%',        'sq','Vlera e tatueshme 10%'),
      jsonb_build_object('key','v10',    'label','VAT 10%',            'sq','TVSH 10%', 'vat', true),
      jsonb_build_object('key','b6',     'label','Taxable 6%',         'sq','Vlera e tatueshme 6%'),
      jsonb_build_object('key','v6',     'label','VAT 6%',             'sq','TVSH 6%', 'vat', true),
      jsonb_build_object('key','rcb',    'label','Reverse charge',     'sq','Autongarkesë'),
      jsonb_build_object('key','rcv',    'label','VAT',                'sq','TVSH autongarkesë', 'vat', true)),
    'purchase_cols', jsonb_build_array(
      jsonb_build_object('key','novat',  'label','Exempt / without VAT', 'sq','Blerje pa TVSH / të përjashtuara'),
      jsonb_build_object('key','impb',   'label','Imports',              'sq','Importe (vlera e tatueshme)'),
      jsonb_build_object('key','impv',   'label','VAT',                  'sq','TVSH importe', 'vat', true),
      jsonb_build_object('key','b20',    'label','Domestic 20%',         'sq','Blerje vendi 20%'),
      jsonb_build_object('key','v20',    'label','VAT 20%',              'sq','TVSH 20%', 'vat', true),
      jsonb_build_object('key','b10',    'label','Domestic 10%',         'sq','Blerje vendi 10%'),
      jsonb_build_object('key','v10',    'label','VAT 10%',              'sq','TVSH 10%', 'vat', true),
      jsonb_build_object('key','b6',     'label','Domestic 6%',          'sq','Blerje vendi 6%'),
      jsonb_build_object('key','v6',     'label','VAT 6%',               'sq','TVSH 6%', 'vat', true),
      jsonb_build_object('key','invb',   'label','Capital purchases',    'sq','Blerje investimesh'),
      jsonb_build_object('key','invv',   'label','VAT',                  'sq','TVSH investime', 'vat', true),
      jsonb_build_object('key','rcb',    'label','Reverse charge',       'sq','Autongarkesë'),
      jsonb_build_object('key','rcv',    'label','VAT',                  'sq','TVSH autongarkesë', 'vat', true),
      jsonb_build_object('key','nded',   'label','Non-deductible VAT (gross)', 'sq','Me TVSH jo të zbritshme')),
    'form', jsonb_build_array(
      jsonb_build_object('section','Supplies (output VAT)', 'sq','Furnizimet — TVSH e shitjeve'),
      jsonb_build_object('code','A1', 'base','s.b20', 'vat','s.v20', 'label','Taxable supplies at 20%', 'sq','Furnizime të tatueshme me 20%'),
      jsonb_build_object('code','A2', 'base','s.b10', 'vat','s.v10', 'label','Taxable supplies at 10%', 'sq','Furnizime të tatueshme me 10%'),
      jsonb_build_object('code','A3', 'base','s.b6',  'vat','s.v6',  'label','Taxable supplies at 6%',  'sq','Furnizime të tatueshme me 6%'),
      jsonb_build_object('code','A4', 'base','s.export', 'label','Exports and other zero-rated supplies', 'sq','Eksporte dhe furnizime me 0%'),
      jsonb_build_object('code','A5', 'base','s.exempt', 'label','Exempt supplies', 'sq','Furnizime të përjashtuara'),
      jsonb_build_object('code','A6', 'base','s.rcb', 'vat','s.rcv', 'label','Reverse charge (services from abroad)', 'sq','Autongarkesë'),
      jsonb_build_object('code','A7', 'vat','out', 'label','Total output VAT', 'sq','TVSH e shitjeve gjithsej', 'total', true),
      jsonb_build_object('section','Purchases (input VAT)', 'sq','Blerjet — TVSH e zbritshme'),
      jsonb_build_object('code','B1', 'base','p.b20', 'vat','p.v20', 'label','Domestic purchases at 20%', 'sq','Blerje vendi me 20%'),
      jsonb_build_object('code','B2', 'base','p.b10', 'vat','p.v10', 'label','Domestic purchases at 10%', 'sq','Blerje vendi me 10%'),
      jsonb_build_object('code','B3', 'base','p.b6',  'vat','p.v6',  'label','Domestic purchases at 6%',  'sq','Blerje vendi me 6%'),
      jsonb_build_object('code','B4', 'base','p.impb', 'vat','p.impv', 'label','Imports of goods (customs declarations)', 'sq','Importe mallrash'),
      jsonb_build_object('code','B5', 'base','p.invb', 'vat','p.invv', 'label','Capital purchases', 'sq','Blerje investimesh'),
      jsonb_build_object('code','B6', 'base','p.rcb', 'vat','p.rcv', 'label','Reverse charge, deductible', 'sq','Autongarkesë e zbritshme'),
      jsonb_build_object('code','B7', 'base','p.novat', 'label','Exempt purchases and purchases without VAT', 'sq','Blerje të përjashtuara / pa TVSH'),
      jsonb_build_object('code','B8', 'base','p.nded', 'label','Purchases with non-deductible VAT', 'sq','Blerje me TVSH jo të zbritshme'),
      jsonb_build_object('code','B9', 'vat','in', 'label','Total deductible input VAT', 'sq','TVSH e zbritshme gjithsej', 'total', true),
      jsonb_build_object('section','Calculation', 'sq','Llogaritja'),
      jsonb_build_object('code','C1', 'vat','net', 'label','Output VAT less input VAT', 'sq','TVSH e shitjeve minus TVSH e zbritshme'),
      jsonb_build_object('code','C2', 'vat','cbf', 'label','Credit brought forward', 'sq','Teprica kreditore e mbartur'),
      jsonb_build_object('code','C3', 'vat','refund', 'label','Refund requested', 'sq','Kërkesë për rimbursim'),
      jsonb_build_object('code','C4', 'vat','carry', 'label','Credit carried forward', 'sq','Teprica kreditore për periudhën pasardhëse'),
      jsonb_build_object('code','C5', 'vat','payable', 'label','VAT payable', 'sq','TVSH për t''u paguar', 'total', true)))
  end
$$;

-- -----------------------------------------------------------------------------
-- 4. The books
-- -----------------------------------------------------------------------------
create or replace function public.vat_book(p_company uuid, p_from date, p_to date, p_book text)
returns table (line_no int, doc_date date, number text, ref text, fiscal_code text, partner text, tax_number text,
               doc_type text, total numeric, cols jsonb, href text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_country text;
begin
  if not app.has_permission(p_company, 'tax.read') then raise exception 'Permission denied: tax.read required' using errcode = '42501'; end if;
  if p_book not in ('sales','purchase') then raise exception 'Book must be sales or purchase' using errcode = '22023'; end if;
  select country_code into v_country from public.companies where id = p_company;
  return query
  with e as (
    select x.*, app.vat_cols(v_country, p_book, x.side, x.is_credit, x.kind, x.rate, x.base, x.vat) as c
      from app.vat_entries(p_company, p_from, p_to) x
  ), kv as (
    select e.side, e.src, e.doc_type, e.doc_id, e.number, e.ref, e.doc_date, e.partner, e.tax_number, e.fiscal_code, e.href, j.key, j.value::numeric as v
      from e cross join lateral jsonb_each_text(e.c) j
     where e.c is not null
  ), agg as (
    select kv.doc_type, kv.doc_id, kv.number, kv.ref, kv.doc_date, kv.partner, kv.tax_number, kv.fiscal_code, kv.href,
           jsonb_object_agg(kv.key, kv.v) as cols
      from (select doc_type, doc_id, number, ref, doc_date, partner, tax_number, fiscal_code, href, key, sum(v) as v
              from kv group by doc_type, doc_id, number, ref, doc_date, partner, tax_number, fiscal_code, href, key) kv
     group by kv.doc_type, kv.doc_id, kv.number, kv.ref, kv.doc_date, kv.partner, kv.tax_number, kv.fiscal_code, kv.href
  )
  select (row_number() over (order by a.doc_date, a.number))::int, a.doc_date, a.number, a.ref, a.fiscal_code, a.partner, a.tax_number,
         a.doc_type,
         -- row total: bases plus VAT (non-deductible purchases are already shown gross)
         (select coalesce(sum(j.value::numeric), 0) from jsonb_each_text(a.cols) j),
         a.cols, a.href
    from agg a
   order by a.doc_date, a.number;
end $$;

-- Sums of the book columns, the declaration boxes and the ledger check
create or replace function public.vat_return_preview(p_company uuid, p_from date, p_to date,
                                                     p_credit_bf numeric default null, p_refund numeric default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_country text; v_box jsonb := '{}'::jsonb; r record; v_out numeric; v_in numeric; v_cbf numeric; v_net numeric;
  v_payable numeric; v_credit numeric; v_refund numeric; v_carry numeric; v_gl_out numeric; v_gl_in numeric; v_prev record;
  v_counts jsonb; v_taxable numeric; v_exempt numeric; v_ptaxable numeric; v_notes numeric := 0; v_open_pos numeric;
begin
  if not app.has_permission(p_company, 'tax.read') then raise exception 'Permission denied: tax.read required' using errcode = '42501'; end if;
  select country_code into v_country from public.companies where id = p_company;

  for r in
    select b.book, j.key, sum(j.value::numeric) as v
      from (select 'sales' as book, * from public.vat_book(p_company, p_from, p_to, 'sales')
            union all select 'purchase', * from public.vat_book(p_company, p_from, p_to, 'purchase')) b
      cross join lateral jsonb_each_text(b.cols) j
     group by b.book, j.key
  loop
    v_box := v_box || jsonb_build_object(case when v_country = 'XK' then r.key else left(r.book, 1) || '.' || r.key end, round(r.v, 2));
  end loop;

  -- credit brought forward: the last declaration before this period
  select d.number, d.period_end, d.carry_forward into v_prev from public.vat_declarations d
   where d.company_id = p_company and d.deleted_at is null and d.status in ('submitted','accepted') and d.period_end < p_from
   order by d.period_end desc limit 1;
  v_cbf := coalesce(p_credit_bf, v_prev.carry_forward, 0);

  if v_country = 'XK' then
    v_out := 0; foreach r.key in array array['13','15','17','19','21','23','25','27','29'] loop v_out := v_out + coalesce((v_box ->> r.key)::numeric, 0); end loop;
    v_in := 0;  foreach r.key in array array['36','38','40','42','44','46','48','50','52','54','56','58','60','62','64','66'] loop v_in := v_in + coalesce((v_box ->> r.key)::numeric, 0); end loop;
    v_net := v_out - v_in - v_cbf;
    v_payable := greatest(v_net, 0); v_credit := greatest(-v_net, 0);
    v_refund := least(coalesce(p_refund, 0), v_credit); v_carry := v_credit - v_refund;
    v_box := v_box || jsonb_build_object('30', v_out, '67', v_in, '68', v_cbf, '69', v_credit, '70', v_refund, '71', v_carry, '72', v_payable);
    v_taxable := coalesce((v_box->>'12')::numeric,0) + coalesce((v_box->>'14')::numeric,0);
    v_exempt := coalesce((v_box->>'9')::numeric,0) + coalesce((v_box->>'10')::numeric,0) + coalesce((v_box->>'11')::numeric,0);
    v_ptaxable := coalesce((v_box->>'35')::numeric,0) + coalesce((v_box->>'37')::numeric,0) + coalesce((v_box->>'43')::numeric,0)
                + coalesce((v_box->>'45')::numeric,0) + coalesce((v_box->>'47')::numeric,0) + coalesce((v_box->>'49')::numeric,0)
                + coalesce((v_box->>'51')::numeric,0) + coalesce((v_box->>'65')::numeric,0);
    -- credit notes sit on the opposite side of the form; the ledger nets them on their own side
    v_notes := coalesce((v_box->>'17')::numeric,0) + coalesce((v_box->>'19')::numeric,0) + coalesce((v_box->>'54')::numeric,0) + coalesce((v_box->>'56')::numeric,0);
  else
    v_out := coalesce((v_box->>'s.v20')::numeric,0) + coalesce((v_box->>'s.v10')::numeric,0) + coalesce((v_box->>'s.v6')::numeric,0)
           + coalesce((v_box->>'s.rcv')::numeric,0);
    v_in := coalesce((v_box->>'p.v20')::numeric,0) + coalesce((v_box->>'p.v10')::numeric,0) + coalesce((v_box->>'p.v6')::numeric,0)
          + coalesce((v_box->>'p.impv')::numeric,0) + coalesce((v_box->>'p.invv')::numeric,0) + coalesce((v_box->>'p.rcv')::numeric,0);
    v_net := v_out - v_in;
    v_payable := greatest(v_net - v_cbf, 0); v_credit := greatest(v_cbf - v_net, 0);
    v_refund := least(coalesce(p_refund, 0), v_credit); v_carry := v_credit - v_refund;
    v_box := v_box || jsonb_build_object('out', v_out, 'in', v_in, 'net', v_net, 'cbf', v_cbf, 'refund', v_refund, 'carry', v_carry, 'payable', v_payable);
    v_taxable := coalesce((v_box->>'s.b20')::numeric,0) + coalesce((v_box->>'s.b10')::numeric,0) + coalesce((v_box->>'s.b6')::numeric,0);
    v_exempt := coalesce((v_box->>'s.exempt')::numeric,0) + coalesce((v_box->>'s.export')::numeric,0);
    v_ptaxable := coalesce((v_box->>'p.b20')::numeric,0) + coalesce((v_box->>'p.b10')::numeric,0) + coalesce((v_box->>'p.b6')::numeric,0)
                + coalesce((v_box->>'p.impb')::numeric,0) + coalesce((v_box->>'p.invb')::numeric,0) + coalesce((v_box->>'p.rcb')::numeric,0);
  end if;

  -- the ledger: VAT booked on the output and input accounts in the period, before settlement entries
  select coalesce(sum(jl.credit - jl.debit) filter (where jl.account_id in (select app.acct(p_company, 'vat_output') union select output_account_id from public.tax_codes where company_id = p_company and output_account_id is not null)), 0),
         coalesce(sum(jl.debit - jl.credit) filter (where jl.account_id in (select app.acct(p_company, 'vat_input') union select input_account_id from public.tax_codes where company_id = p_company and input_account_id is not null)), 0)
    into v_gl_out, v_gl_in
    from public.journal_lines jl join public.journal_entries je on je.id = jl.entry_id
   where je.company_id = p_company and je.status in ('posted','reversed') and je.entry_date between p_from and p_to
     and coalesce(je.source_doc_type, '') <> 'vat_declaration';

  -- POS receipts reach the ledger when their session is closed
  select coalesce(sum(l.tax_amount), 0) into v_open_pos   -- refund lines are negative
    from public.pos_orders o join public.pos_sessions ps on ps.id = o.session_id join public.pos_order_lines l on l.pos_order_id = o.id
    join public.companies c on c.id = o.company_id
   where o.company_id = p_company and o.status = 'paid' and ps.status <> 'closed'
     and (o.order_at at time zone c.timezone)::date between p_from and p_to;

  select jsonb_build_object('sales', count(*) filter (where side = 'sale'), 'purchases', count(*) filter (where side = 'purchase'),
                            'pos_days', count(distinct (number)) filter (where src = 'pos'))
    into v_counts from app.vat_entries(p_company, p_from, p_to);

  return jsonb_build_object(
    'country', v_country, 'period_start', p_from, 'period_end', p_to, 'boxes', v_box,
    'output_vat', v_out, 'input_vat', v_in, 'credit_brought_forward', v_cbf, 'payable', v_payable, 'credit', v_credit,
    'refund_requested', v_refund, 'carry_forward', v_carry,
    'sales_taxable_base', v_taxable, 'sales_exempt_base', v_exempt, 'purchase_taxable_base', v_ptaxable,
    'previous', case when v_prev.number is not null then jsonb_build_object('number', v_prev.number, 'period_end', v_prev.period_end, 'carry_forward', v_prev.carry_forward) end,
    'ledger', jsonb_build_object('output_vat', v_gl_out, 'input_vat', v_gl_in, 'credit_notes_moved', v_notes, 'open_pos_vat', v_open_pos,
                                 'output_difference', v_gl_out - (v_out - v_notes - v_open_pos), 'input_difference', v_gl_in - (v_in - v_notes)),
    'counts', v_counts);
end $$;

-- -----------------------------------------------------------------------------
-- 5. VAT declarations: draft → submitted → accepted / rejected
-- -----------------------------------------------------------------------------
create or replace function app.vat_apply_preview(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.vat_declarations; p jsonb;
begin
  select * into d from public.vat_declarations where id = p_id;
  p := public.vat_return_preview(d.company_id, d.period_start, d.period_end, null, d.refund_requested);
  update public.vat_declarations set
    sales_taxable_base = (p->>'sales_taxable_base')::numeric, sales_exempt_base = (p->>'sales_exempt_base')::numeric,
    output_vat = (p->>'output_vat')::numeric, purchase_taxable_base = (p->>'purchase_taxable_base')::numeric,
    input_vat = (p->>'input_vat')::numeric, credit_brought_forward = (p->>'credit_brought_forward')::numeric,
    refund_requested = (p->>'refund_requested')::numeric, carry_forward = (p->>'carry_forward')::numeric,
    payable = (p->>'payable')::numeric, details = p
   where id = p_id;
end $$;

create or replace function public.create_vat_declaration(p_company uuid, p_year int, p_month int)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_from date := make_date(p_year, p_month, 1); v_country text;
begin
  perform app.require_permission(p_company, 'tax.write');
  select country_code into v_country from public.companies where id = p_company;
  if v_country not in ('AL','XK') then raise exception 'VAT declarations are available for Albania and Kosovo' using errcode = '23514'; end if;
  if exists (select 1 from public.vat_declarations where company_id = p_company and deleted_at is null and status <> 'rejected'
               and daterange(period_start, period_end, '[]') && daterange(v_from, (v_from + interval '1 month - 1 day')::date, '[]')) then
    raise exception 'There is already a declaration for %', to_char(v_from, 'FMMonth YYYY') using errcode = '23505';
  end if;
  insert into public.vat_declarations (company_id, country_code, period_start, period_end)
  values (p_company, v_country, v_from, (v_from + interval '1 month - 1 day')::date) returning id into v_id;
  perform app.vat_apply_preview(v_id);
  return v_id;
end $$;

create or replace function public.refresh_vat_declaration(p_id uuid, p_refund numeric default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d public.vat_declarations;
begin
  select * into d from public.vat_declarations where id = p_id for update;
  if d.id is null then raise exception 'Declaration not found' using errcode = 'P0002'; end if;
  perform app.require_permission(d.company_id, 'tax.write');
  if d.status <> 'draft' then raise exception 'Declaration % is %; only drafts are recalculated', d.number, d.status using errcode = '55000'; end if;
  if p_refund is not null then update public.vat_declarations set refund_requested = greatest(p_refund, 0) where id = p_id; end if;
  perform app.vat_apply_preview(p_id);
  return (select details from public.vat_declarations where id = p_id);
end $$;

create or replace function public.submit_vat_declaration(p_id uuid, p_reference text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d public.vat_declarations; v_je uuid; v_lines jsonb; v_net numeric;
begin
  select * into d from public.vat_declarations where id = p_id for update;
  if d.id is null then raise exception 'Declaration not found' using errcode = 'P0002'; end if;
  perform app.require_permission(d.company_id, 'tax.write');
  if d.status <> 'draft' then raise exception 'Declaration % is already %', d.number, d.status using errcode = '55000'; end if;
  if exists (select 1 from public.vat_declarations where company_id = d.company_id and deleted_at is null and status = 'draft'
               and period_end < d.period_start) then
    raise exception 'Submit the earlier declarations first; the credit carried forward depends on them' using errcode = '55000';
  end if;
  perform app.vat_apply_preview(p_id);
  select * into d from public.vat_declarations where id = p_id;

  -- settlement: output and input VAT of the period move to the settlement account
  v_net := d.output_vat - d.input_vat;
  if d.output_vat <> 0 or d.input_vat <> 0 then
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', app.acct(d.company_id, 'vat_output'), 'amount', d.output_vat, 'description', 'Output VAT ' || to_char(d.period_start, 'MM/YYYY')),
      jsonb_build_object('account_id', app.acct(d.company_id, 'vat_input'), 'amount', -d.input_vat, 'description', 'Input VAT ' || to_char(d.period_start, 'MM/YYYY')),
      jsonb_build_object('account_id', app.acct(d.company_id, 'vat_settlement'), 'amount', -v_net,
                         'description', case when v_net >= 0 then 'VAT payable ' else 'VAT credit ' end || to_char(d.period_start, 'MM/YYYY')));
    v_je := app.gl_post(d.company_id, 'GEN', d.period_end, 'vat_declaration', d.id, d.number,
                        'VAT declaration ' || to_char(d.period_start, 'MM/YYYY'), v_lines, 'settlement');
  end if;
  update public.vat_declarations set status = 'submitted', submitted_at = now(), submission_reference = nullif(btrim(p_reference), ''),
                                     journal_entry_id = v_je
   where id = p_id;
  return jsonb_build_object('payable', d.payable, 'carry_forward', d.carry_forward, 'journal_entry_id', v_je);
end $$;

-- Mirror of an automatic entry (the original is marked reversed)
create or replace function app.gl_reverse(p_entry uuid, p_date date default current_date, p_memo text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare e public.journal_entries; v_new uuid; v_lines jsonb;
begin
  select * into e from public.journal_entries where id = p_entry for update;
  if e.status <> 'posted' then return null; end if;
  select jsonb_agg(jsonb_build_object('account_id', account_id, 'amount', credit - debit, 'partner_id', partner_id, 'cost_center_id', cost_center_id,
                                      'tax_code_id', tax_code_id, 'variant_id', variant_id, 'description', description,
                                      'currency_code', currency_code, 'amount_currency', -amount_currency) order by line_no)
    into v_lines from public.journal_lines where entry_id = e.id;
  v_new := app.gl_post(e.company_id, (select code from public.journals where id = e.journal_id), greatest(p_date, e.entry_date), e.source_doc_type, e.source_doc_id,
                       e.number, coalesce(p_memo, 'Reversal of ' || e.number), v_lines, 'reversal:' || e.id, e.currency_code, e.id);
  update public.journal_entries set status = 'reversed', reversed_by_id = v_new where id = e.id;
  return v_new;
end $$;
revoke execute on function app.gl_reverse(uuid, date, text) from public, anon, authenticated;

create or replace function public.decide_vat_declaration(p_id uuid, p_accepted boolean, p_note text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare d public.vat_declarations;
begin
  select * into d from public.vat_declarations where id = p_id for update;
  if d.id is null then raise exception 'Declaration not found' using errcode = 'P0002'; end if;
  perform app.require_permission(d.company_id, 'tax.write');
  if d.status <> 'submitted' then raise exception 'Declaration % is %', d.number, d.status using errcode = '55000'; end if;
  if not p_accepted and exists (select 1 from public.vat_declarations where company_id = d.company_id and deleted_at is null
                                  and status in ('submitted','accepted') and period_start > d.period_end) then
    raise exception 'A later declaration builds on this one; reject that one first' using errcode = '55000';
  end if;
  if not p_accepted and d.journal_entry_id is not null then
    perform app.gl_reverse(d.journal_entry_id, d.period_end, 'Declaration ' || d.number || ' rejected');
  end if;
  update public.vat_declarations set status = case when p_accepted then 'accepted' else 'rejected' end,
                                     decided_at = now(), decision_note = p_note
   where id = p_id;
  return case when p_accepted then 'accepted' else 'rejected' end;
end $$;

-- A rejected declaration goes back to draft (new numbers are not needed)
create or replace function public.reopen_vat_declaration(p_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare d public.vat_declarations;
begin
  select * into d from public.vat_declarations where id = p_id for update;
  perform app.require_permission(d.company_id, 'tax.write');
  if d.status <> 'rejected' then raise exception 'Only rejected declarations are reopened' using errcode = '55000'; end if;
  if exists (select 1 from public.vat_declarations where company_id = d.company_id and deleted_at is null and id <> d.id and status <> 'rejected'
               and daterange(period_start, period_end, '[]') && daterange(d.period_start, d.period_end, '[]')) then
    raise exception 'Another declaration covers this period' using errcode = '23505';
  end if;
  update public.vat_declarations set status = 'draft', journal_entry_id = null, submitted_at = null where id = p_id;
  perform app.vat_apply_preview(p_id);
  return 'draft';
end $$;

-- Only the system moves declarations through submitted / accepted / rejected
create trigger trg_04_system_statuses before insert or update of status on public.vat_declarations
  for each row execute function app.tg_system_statuses('submitted','accepted','rejected');

-- Declared periods are closed for VAT: no back-dated invoices, bills or customs entries
create or replace function app.tg_vat_period_lock()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_date date; v_number text; v_period text;
begin
  if new.status <> 'posted' or old.status = 'posted' then return new; end if;
  v_date := case tg_table_name when 'sales_invoices' then (to_jsonb(new) ->> 'invoice_date')::date
                               when 'vendor_bills' then (to_jsonb(new) ->> 'bill_date')::date
                               else coalesce((to_jsonb(new) ->> 'customs_declaration_date')::date, (to_jsonb(new) ->> 'landed_cost_date')::date) end;
  select d.number, to_char(d.period_start, 'FMMonth YYYY') into v_number, v_period from public.vat_declarations d
   where d.company_id = new.company_id and d.deleted_at is null and d.status in ('submitted','accepted')
     and v_date between d.period_start and d.period_end;
  if v_number is not null then
    raise exception 'VAT for % is already declared (%). Date the document in an open VAT period.', v_period, v_number using errcode = '55000';
  end if;
  return new;
end $$;
create trigger trg_08_vat_lock before update of status on public.sales_invoices for each row execute function app.tg_vat_period_lock();
create trigger trg_08_vat_lock before update of status on public.vendor_bills   for each row execute function app.tg_vat_period_lock();
create trigger trg_08_vat_lock before update of status on public.landed_costs   for each row execute function app.tg_vat_period_lock();

-- -----------------------------------------------------------------------------
-- 6. Fiscalization (AL: CIS e-fiscalization; XK: fiscal devices / ATK)
-- -----------------------------------------------------------------------------
-- Queue entries carry what the authority needs. In AL the IIC is the MD5 of the
-- RSA signature of "NIPT|issued|number|business unit|TCR|software|total"; the
-- signature needs the company's certificate, which lives with the Edge Function.
-- Here the IIC is a placeholder (MD5 of the unsigned string) until it is signed.
create or replace function app.fiscal_payload(p_company uuid, p_doc_type text, p_doc_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.companies; s public.company_settings; v_number text; v_total numeric; v_at timestamptz; v_tcr text; v_offline boolean := false; v_string text;
begin
  select * into c from public.companies where id = p_company;
  select * into s from public.company_settings where company_id = p_company;
  if p_doc_type = 'pos_order' then
    select o.number, o.total, o.order_at, coalesce(r.fiscal_tcr_code, r.fiscal_device_serial), o.offline_created
      into v_number, v_total, v_at, v_tcr, v_offline
      from public.pos_orders o join public.pos_registers r on r.id = o.register_id where o.id = p_doc_id;
  else
    select i.number, i.total, coalesce(i.posted_at, now()) into v_number, v_total, v_at from public.sales_invoices i where i.id = p_doc_id;
  end if;
  v_string := concat_ws('|', c.tax_number, to_char(v_at at time zone 'Europe/Tirane', 'YYYY-MM-DD"T"HH24:MI:SS'), v_number,
                        s.fiscal_business_unit_code, v_tcr, s.fiscal_software_code, to_char(v_total, 'FM999999999990.00'));
  return jsonb_build_object('tin', c.tax_number, 'issued_at', v_at, 'number', v_number, 'total', v_total,
                            'business_unit', s.fiscal_business_unit_code, 'tcr', v_tcr, 'software', s.fiscal_software_code,
                            'maintainer', s.fiscal_maintainer_code, 'iic_input', v_string, 'environment', s.fiscal_environment,
                            'offline', coalesce(v_offline, false), 'country', c.country_code);
end $$;

-- Every queued record gets the request fields (invoices are queued by post_sales_invoice, receipts below)
create or replace function app.tg_fiscal_record_fill()
returns trigger language plpgsql security definer set search_path = '' as $$
declare p jsonb;
begin
  if new.request_payload is null then
    p := app.fiscal_payload(new.company_id, new.source_doc_type, new.source_doc_id);
    new.request_payload := p;
    new.iic := coalesce(new.iic, case when new.country_code = 'AL' then upper(md5(p ->> 'iic_input')) end);
    new.tcr_code := coalesce(new.tcr_code, p ->> 'tcr');
    new.business_unit_code := coalesce(new.business_unit_code, p ->> 'business_unit');
    new.software_code := coalesce(new.software_code, p ->> 'software');
    new.is_subsequent := new.is_subsequent or coalesce((p ->> 'offline')::boolean, false);
  end if;
  return new;
end $$;
create trigger trg_05_fill before insert on public.fiscalization_records
  for each row execute function app.tg_fiscal_record_fill();

-- Receipts are queued when they become paid (inserted paid, or paid after a draft)
create or replace function app.tg_pos_fiscal_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'paid' and (tg_op = 'INSERT' or old.status is distinct from 'paid') and new.fiscal_status = 'not_required'
     and exists (select 1 from public.company_settings s join public.companies c on c.id = s.company_id
                  where s.company_id = new.company_id and s.fiscalization_enabled and c.country_code in ('AL','XK')) then
    new.fiscal_status := 'pending';
  end if;
  return new;
end $$;
create trigger trg_07_fiscal before insert or update of status on public.pos_orders for each row execute function app.tg_pos_fiscal_status();

create or replace function app.tg_pos_fiscal_queue()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.fiscal_status = 'pending' and (tg_op = 'INSERT' or old.fiscal_status is distinct from 'pending') then
    insert into public.fiscalization_records (company_id, country_code, source_doc_type, source_doc_id, status)
    select new.company_id, c.country_code, 'pos_order', new.id, 'pending' from public.companies c where c.id = new.company_id
    on conflict do nothing;
  end if;
  return null;
end $$;
-- (any update: the status trigger sets fiscal_status, which an "update of fiscal_status" trigger would not see)
create trigger trg_93_fiscal after insert or update on public.pos_orders for each row execute function app.tg_pos_fiscal_queue();

-- Processes the queue. Test environment: the authority's answer is simulated.
-- Production: needs the `fiscalize` Edge Function (certificate + CIS / ATK endpoint).
create or replace function public.process_fiscal_queue(p_company uuid, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.company_settings; c public.companies; f record; v_ok int := 0; v_failed int := 0; v_fic text; v_qr text;
begin
  perform app.require_permission(p_company, 'tax.write');
  select * into s from public.company_settings where company_id = p_company;
  select * into c from public.companies where id = p_company;
  for f in select * from public.fiscalization_records where company_id = p_company and status in ('pending','failed')
            order by created_at limit p_limit for update skip locked loop
    if s.fiscal_environment = 'test' then
      v_fic := case when f.country_code = 'AL' then gen_random_uuid()::text end;
      v_qr := case when f.country_code = 'AL'
                   then 'https://efiskalizimi-app-test.tatime.gov.al/invoice-check/#/verify?iic=' || f.iic || '&tin=' || coalesce(c.tax_number, '')
                        || '&crtd=' || replace(f.request_payload ->> 'issued_at', ' ', 'T') || '&prc=' || (f.request_payload ->> 'total')
              end;
      update public.fiscalization_records set status = 'fiscalized', fic = v_fic, qr_url = v_qr,
             verification_code = case when f.country_code = 'XK' then upper(substr(md5(f.id::text), 1, 12)) end,
             attempt_count = attempt_count + 1, last_attempt_at = now(), fiscalized_at = now(), error_code = null, error_message = null,
             response_payload = jsonb_build_object('simulated', true, 'environment', 'test')
       where id = f.id;
      v_ok := v_ok + 1;
      if f.source_doc_type = 'pos_order' then update public.pos_orders set fiscal_status = 'fiscalized' where id = f.source_doc_id;
      else update public.sales_invoices set fiscal_status = 'fiscalized' where id = f.source_doc_id; end if;
    else
      update public.fiscalization_records set status = 'failed', attempt_count = attempt_count + 1, last_attempt_at = now(),
             error_code = 'NO_CONNECTOR', error_message = 'The fiscalization connector (Edge Function `fiscalize`) is not configured for production'
       where id = f.id;
      v_failed := v_failed + 1;
      if f.source_doc_type = 'pos_order' then update public.pos_orders set fiscal_status = 'failed' where id = f.source_doc_id;
      else update public.sales_invoices set fiscal_status = 'failed' where id = f.source_doc_id; end if;
    end if;
  end loop;
  return jsonb_build_object('fiscalized', v_ok, 'failed', v_failed);
end $$;

create or replace function public.fiscal_overview(p_company uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when app.has_permission(p_company, 'tax.read') then jsonb_build_object(
    'enabled', coalesce((select fiscalization_enabled from public.company_settings where company_id = p_company), false),
    'environment', (select fiscal_environment from public.company_settings where company_id = p_company),
    'pending', (select count(*) from public.fiscalization_records where company_id = p_company and status in ('pending','sent')),
    'failed', (select count(*) from public.fiscalization_records where company_id = p_company and status = 'failed'),
    'fiscalized_today', (select count(*) from public.fiscalization_records where company_id = p_company and status = 'fiscalized'
                           and fiscalized_at >= date_trunc('day', now())),
    'subsequent', (select count(*) from public.fiscalization_records where company_id = p_company and is_subsequent)) end
$$;

-- -----------------------------------------------------------------------------
-- 7. Tax calendar and overview
-- -----------------------------------------------------------------------------
-- Monthly obligations: VAT return (AL by the 14th, XK by the 20th of the next
-- month) and payroll withholding (AL by the 20th, XK by the 15th).
create or replace function public.tax_calendar(p_company uuid, p_months int default 6)
returns table (obligation text, period_start date, period_end date, due_date date, status text, document_id uuid, document_number text, amount numeric)
language plpgsql stable security definer set search_path = '' as $$
declare v_country text; m date;
begin
  if not (app.has_permission(p_company, 'tax.read') or app.has_permission(p_company, 'payroll.read')) then
    raise exception 'Permission denied: tax.read required' using errcode = '42501';
  end if;
  select country_code into v_country from public.companies where id = p_company;
  for m in select generate_series(date_trunc('month', current_date) - make_interval(months => p_months), date_trunc('month', current_date), interval '1 month')::date loop
    continue when m >= date_trunc('month', current_date)::date and m > current_date;
    return query
    select 'vat'::text, m, (m + interval '1 month - 1 day')::date,
           (m + interval '1 month')::date + case when v_country = 'XK' then 19 else 13 end,
           coalesce(d.status, case when (m + interval '1 month')::date + case when v_country = 'XK' then 19 else 13 end < current_date then 'overdue' else 'open' end),
           d.id, d.number, d.payable
      from (select 1) x left join lateral (select * from public.vat_declarations v where v.company_id = p_company and v.deleted_at is null
                                             and v.status <> 'rejected' and v.period_start = m limit 1) d on true
     where m < date_trunc('month', current_date)::date;
    return query
    select 'payroll'::text, m, (m + interval '1 month - 1 day')::date,
           (m + interval '1 month')::date + case when v_country = 'XK' then 14 else 19 end,
           coalesce(case when r.status in ('posted','paid') then 'declared' else r.status end,
                    case when (m + interval '1 month')::date + case when v_country = 'XK' then 14 else 19 end < current_date then 'overdue' else 'open' end),
           r.id, r.number, r.total_income_tax + r.total_employee_contrib + r.total_employer_contrib
      from (select 1) x left join lateral (select * from public.payroll_runs pr where pr.company_id = p_company and pr.deleted_at is null
                                             and pr.status <> 'cancelled' and pr.period_start = m limit 1) r on true
     where m < date_trunc('month', current_date)::date;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 8. Grants
-- -----------------------------------------------------------------------------
revoke execute on function app.vat_entries(uuid, date, date), app.fiscal_payload(uuid, text, uuid), app.vat_apply_preview(uuid),
                           app.seed_tax_defaults(uuid) from public, anon, authenticated;
grant execute on function public.vat_book(uuid, date, date, text), public.vat_return_preview(uuid, date, date, numeric, numeric),
                          public.vat_layout(text), public.create_vat_declaration(uuid, int, int), public.refresh_vat_declaration(uuid, numeric),
                          public.submit_vat_declaration(uuid, text), public.decide_vat_declaration(uuid, boolean, text),
                          public.reopen_vat_declaration(uuid), public.process_fiscal_queue(uuid, int), public.fiscal_overview(uuid),
                          public.tax_calendar(uuid, int) to authenticated;
