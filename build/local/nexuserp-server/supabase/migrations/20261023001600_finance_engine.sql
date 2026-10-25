-- =============================================================================
-- NexusERP Pro · 1600 · Finance engine (Phase 5)
--
-- Every operational posting produces a balanced, posted journal entry that
-- points back to its source document (source_doc_type / source_doc_id) and is
-- pointed to by it (journal_entry_id):
--
--   sales invoice / credit note ......  Dr receivable · Cr revenue (per line) · Cr VAT output
--   vendor bill / vendor credit ......  Dr GRNI (received goods) / expense · Dr VAT input · Cr payable
--                                        + price differences: Dr inventory (in stock) / Dr PPV (sold)
--   stock movements (per document) ...  receipt Dr inventory · Cr GRNI;  delivery/POS Dr COGS · Cr inventory;
--                                        adjustments ↔ inventory adjustment / opening balance;
--                                        production consume Dr WIP · Cr inventory, output Dr inventory · Cr WIP
--   landed cost ......................  Dr inventory (in stock) / Dr COGS (sold) · Cr landed-cost clearing
--   payments .........................  Dr bank · Cr receivable  /  Dr payable · Cr bank  (+ FX difference)
--   depreciation / disposal ..........  Dr depreciation · Cr accumulated depreciation / disposal gain or loss
--
-- Inventory postings are built by a DEFERRED trigger on stock_movements, so
-- every posting function from earlier phases feeds the ledger without being
-- rewritten: at commit, all movements of one source document become one entry.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Schema additions
-- -----------------------------------------------------------------------------
alter table public.company_account_defaults drop constraint company_account_defaults_key_check;
alter table public.company_account_defaults add constraint company_account_defaults_key_check check (key in (
  'receivable','payable','customer_advances','vendor_advances',
  'inventory','grni','cogs','purchase_price_variance','inventory_adjustment','landed_cost_clearing',
  'wip','labor_absorbed','overhead_absorbed','production_variance',
  'sales_revenue','sales_discount','vat_output','vat_input',
  'cash','bank','pos_cash','card_clearing','rounding','exchange_gain','exchange_loss',
  'retained_earnings','current_year_earnings',
  'salary_expense','salary_payable','social_security_payable','health_insurance_payable',
  'pension_payable','income_tax_payable','employer_contribution_expense',
  'depreciation_expense','accumulated_depreciation','asset_disposal_gain','asset_disposal_loss',
  'purchase_expense','opening_balance','bank_charges','cash_difference'));

-- several automatic entries per source are legitimate (e.g. a work order consuming on two days)
alter table public.journal_entries add column posting_key text not null default 'main';
drop index public.journal_entries_one_auto_per_source;
create unique index journal_entries_one_auto_per_source on public.journal_entries (company_id, source_doc_type, source_doc_id, posting_key)
  where is_automatic and status = 'posted' and reversal_of_id is null;

alter table public.payments            add column reversed_at timestamptz;
alter table public.fixed_assets        add column disposal_account_id uuid,
                                       add foreign key (company_id, disposal_account_id) references public.accounts(company_id, id);
alter table public.bank_statement_lines add column journal_entry_id uuid,
                                        add foreign key (company_id, journal_entry_id) references public.journal_entries(company_id, id);

-- journal lines → profiles not needed; entries: who posted
alter table public.journal_entries add constraint journal_entries_posted_by_profile_fkey foreign key (posted_by) references public.profiles(id);

-- Immutable ledgers may still receive their journal-entry link from posting functions
create or replace function app.tg_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not app.is_client_context() and coalesce(current_setting('app.allow_hard_delete', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'UPDATE' and not app.is_client_context()
     and (to_jsonb(old) ->> 'journal_entry_id') is null
     and (to_jsonb(new) - 'journal_entry_id') = (to_jsonb(old) - 'journal_entry_id') then
    return new;
  end if;
  raise exception '% rows are immutable; post a reversing entry instead', tg_table_name using errcode = '42501';
end $$;

-- -----------------------------------------------------------------------------
-- 1. Chart of accounts, posting accounts, journals, cash & bank, asset categories
--    (Albanian SKK-style numbering; same structure works for Kosovo)
-- -----------------------------------------------------------------------------
create or replace function app.seed_finance_defaults(p_company uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.companies; r record;
begin
  select * into c from public.companies where id = p_company;
  if exists (select 1 from public.accounts where company_id = p_company and code = '411' and deleted_at is null) then return; end if;

  -- class headers (group accounts)
  insert into public.accounts (company_id, code, name, account_type, account_subtype, is_postable) values
    (p_company, '1', 'Class 1 · Equity and long-term liabilities', 'equity', 'equity', false),
    (p_company, '2', 'Class 2 · Fixed assets',                     'asset', 'fixed_asset', false),
    (p_company, '3', 'Class 3 · Inventories',                      'asset', 'inventory', false),
    (p_company, '4', 'Class 4 · Third parties',                    'asset', 'current_asset', false),
    (p_company, '5', 'Class 5 · Cash and banks',                   'asset', 'cash', false),
    (p_company, '6', 'Class 6 · Expenses',                         'expense', 'expense', false),
    (p_company, '7', 'Class 7 · Revenues',                         'revenue', 'revenue', false);

  insert into public.accounts (company_id, code, name, account_type, account_subtype, is_reconcilable, cash_flow_category, parent_id)
  select p_company, x.code, x.name, x.t, x.st, x.rec, x.cf,
         (select id from public.accounts p where p.company_id = p_company and p.code = left(x.code, 1))
    from (values
      ('101',  'Share capital',                          'equity',    'equity',                   false, 'financing'),
      ('108',  'Retained earnings',                      'equity',    'retained_earnings',        false, 'financing'),
      ('109',  'Profit or loss for the year',            'equity',    'retained_earnings',        false, 'operating'),
      ('1091', 'Opening balance equity',                 'equity',    'equity',                   false, 'financing'),
      ('164',  'Long-term bank loans',                   'liability', 'long_term_liability',      false, 'financing'),
      ('213',  'Equipment and machinery',                'asset',     'fixed_asset',              false, 'investing'),
      ('215',  'Vehicles',                               'asset',     'fixed_asset',              false, 'investing'),
      ('218',  'Furniture and IT equipment',             'asset',     'fixed_asset',              false, 'investing'),
      ('2813', 'Accumulated depreciation — equipment',   'asset',     'accumulated_depreciation', false, 'investing'),
      ('2815', 'Accumulated depreciation — vehicles',    'asset',     'accumulated_depreciation', false, 'investing'),
      ('2818', 'Accumulated depreciation — furniture & IT','asset',   'accumulated_depreciation', false, 'investing'),
      ('311',  'Merchandise inventory',                  'asset',     'inventory',                false, 'operating'),
      ('321',  'Raw materials',                          'asset',     'inventory',                false, 'operating'),
      ('331',  'Work in progress',                       'asset',     'inventory',                false, 'operating'),
      ('351',  'Finished goods',                         'asset',     'inventory',                false, 'operating'),
      ('401',  'Suppliers',                              'liability', 'payable',                  true,  'operating'),
      ('4081', 'Goods received, not yet invoiced',       'liability', 'current_liability',        false, 'operating'),
      ('409',  'Advances to suppliers',                  'asset',     'current_asset',            true,  'operating'),
      ('411',  'Customers',                              'asset',     'receivable',               true,  'operating'),
      ('419',  'Advances from customers',                'liability', 'current_liability',        true,  'operating'),
      ('421',  'Salaries payable',                       'liability', 'current_liability',        false, 'operating'),
      ('431',  'Social and health contributions payable','liability', 'tax',                      false, 'operating'),
      ('442',  'Personal income tax withheld',           'liability', 'tax',                      false, 'operating'),
      ('4456', 'VAT recoverable (input)',                'asset',     'tax',                      false, 'operating'),
      ('4457', 'VAT payable (output)',                   'liability', 'tax',                      false, 'operating'),
      ('467',  'Landed costs to be invoiced',            'liability', 'current_liability',        false, 'operating'),
      ('5121', 'Bank — current account',                 'asset',     'bank',                     true,  null),
      ('531',  'Cash on hand',                           'asset',     'cash',                     false, null),
      ('5311', 'Cash in POS drawers',                    'asset',     'cash',                     false, null),
      ('581',  'Card payments in transit',               'asset',     'cash',                     true,  null),
      ('601',  'Cost of goods sold',                     'expense',   'cogs',                     false, 'operating'),
      ('6011', 'Purchase price differences',             'expense',   'cogs',                     false, 'operating'),
      ('6012', 'Production variances',                   'expense',   'cogs',                     false, 'operating'),
      ('602',  'Purchased materials and services',       'expense',   'expense',                  false, 'operating'),
      ('6081', 'Inventory adjustments and shrinkage',    'expense',   'expense',                  false, 'operating'),
      ('612',  'Rent',                                   'expense',   'expense',                  false, 'operating'),
      ('614',  'Utilities and telecom',                  'expense',   'expense',                  false, 'operating'),
      ('622',  'Transport and freight',                  'expense',   'expense',                  false, 'operating'),
      ('641',  'Salaries and wages',                     'expense',   'expense',                  false, 'operating'),
      ('644',  'Employer social contributions',          'expense',   'expense',                  false, 'operating'),
      ('658',  'Cash differences and rounding',          'expense',   'other_expense',            false, 'operating'),
      ('662',  'Bank charges',                           'expense',   'expense',                  false, 'operating'),
      ('666',  'Exchange losses',                        'expense',   'other_expense',            false, 'operating'),
      ('667',  'Loss on disposal of assets',             'expense',   'other_expense',            false, 'operating'),
      ('681',  'Depreciation',                           'expense',   'depreciation',             false, 'operating'),
      ('701',  'Sales of goods',                         'revenue',   'revenue',                  false, 'operating'),
      ('704',  'Sales of services',                      'revenue',   'revenue',                  false, 'operating'),
      ('709',  'Sales discounts and returns',            'revenue',   'revenue',                  false, 'operating'),
      ('7212', 'Labour absorbed into production',        'revenue',   'other_income',             false, 'operating'),
      ('7213', 'Overhead absorbed into production',      'revenue',   'other_income',             false, 'operating'),
      ('766',  'Exchange gains',                         'revenue',   'other_income',             false, 'operating'),
      ('767',  'Gain on disposal of assets',             'revenue',   'other_income',             false, 'operating')
    ) x(code, name, t, st, rec, cf);

  insert into public.company_account_defaults (company_id, key, account_id)
  select p_company, d.key, a.id
    from (values
      ('receivable','411'), ('payable','401'), ('customer_advances','419'), ('vendor_advances','409'),
      ('inventory','311'), ('grni','4081'), ('cogs','601'), ('purchase_price_variance','6011'),
      ('inventory_adjustment','6081'), ('landed_cost_clearing','467'),
      ('wip','331'), ('labor_absorbed','7212'), ('overhead_absorbed','7213'), ('production_variance','6012'),
      ('sales_revenue','701'), ('sales_discount','709'), ('vat_output','4457'), ('vat_input','4456'),
      ('cash','531'), ('bank','5121'), ('pos_cash','5311'), ('card_clearing','581'), ('rounding','658'),
      ('exchange_gain','766'), ('exchange_loss','666'), ('retained_earnings','108'), ('current_year_earnings','109'),
      ('salary_expense','641'), ('salary_payable','421'), ('social_security_payable','431'), ('health_insurance_payable','431'),
      ('pension_payable','431'), ('income_tax_payable','442'), ('employer_contribution_expense','644'),
      ('depreciation_expense','681'), ('accumulated_depreciation','2813'), ('asset_disposal_gain','767'), ('asset_disposal_loss','667'),
      ('purchase_expense','602'), ('opening_balance','1091'), ('bank_charges','662'), ('cash_difference','658')
    ) d(key, code)
    join public.accounts a on a.company_id = p_company and a.code = d.code;

  insert into public.journals (company_id, code, name, journal_type, default_account_id)
  select p_company, j.code, j.name, j.t, (select id from public.accounts where company_id = p_company and code = j.acc)
    from (values ('SAL','Sales','sales',null), ('PUR','Purchases','purchase',null), ('INV','Inventory','inventory',null),
                 ('BNK','Bank','bank','5121'), ('CSH','Cash','cash','531'), ('GEN','General','general',null),
                 ('POS','Point of sale','pos','5311'), ('DEP','Depreciation','depreciation',null),
                 ('MFG','Manufacturing','manufacturing',null), ('PAY','Payroll','payroll',null)) j(code, name, t, acc);

  insert into public.bank_accounts (company_id, name, account_kind, currency_code, account_id, journal_id)
  values (p_company, 'Main bank account', 'bank', c.base_currency,
          (select id from public.accounts where company_id = p_company and code = '5121'),
          (select id from public.journals where company_id = p_company and code = 'BNK')),
         (p_company, 'Cash box', 'cash', c.base_currency,
          (select id from public.accounts where company_id = p_company and code = '531'),
          (select id from public.journals where company_id = p_company and code = 'CSH'));

  for r in select * from (values ('Equipment and machinery', 60, '213', '2813'), ('Vehicles', 60, '215', '2815'),
                                 ('Furniture and IT equipment', 48, '218', '2818')) x(name, life, acc, accum) loop
    insert into public.fixed_asset_categories (company_id, name, useful_life_months, asset_account_id,
                                               accumulated_depreciation_account_id, depreciation_expense_account_id)
    values (p_company, r.name, r.life,
            (select id from public.accounts where company_id = p_company and code = r.acc),
            (select id from public.accounts where company_id = p_company and code = r.accum),
            (select id from public.accounts where company_id = p_company and code = '681'));
  end loop;
end $$;

create or replace function app.tg_company_finance_defaults()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform app.seed_finance_defaults(new.id);
  return null;
end $$;
create trigger trg_95_finance_defaults after insert on public.companies
  for each row execute function app.tg_company_finance_defaults();

select app.seed_finance_defaults(id) from public.companies;

-- -----------------------------------------------------------------------------
-- 2. Posting primitives
-- -----------------------------------------------------------------------------
create or replace function app.acct(p_company uuid, p_key text)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v uuid;
begin
  select account_id into v from public.company_account_defaults where company_id = p_company and key = p_key;
  if v is null then
    raise exception 'No posting account is set for "%". Set it under Finance → Posting accounts', replace(p_key, '_', ' ')
      using errcode = '23514';
  end if;
  return v;
end $$;

-- p_lines: [{account_id, amount (+debit / −credit, base currency), partner_id?, cost_center_id?, tax_code_id?, variant_id?,
--            description?, currency_code?, amount_currency?}]
-- Lines with the same account + dimensions are merged; a rounding difference up to 1.00 goes to the rounding account.
create or replace function app.gl_post(
  p_company uuid, p_journal text, p_date date, p_source_type text, p_source_id uuid, p_reference text, p_memo text,
  p_lines jsonb, p_posting_key text default 'main', p_currency text default null, p_reversal_of uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_je uuid; v_diff numeric; r record; v_n int := 0; v_journal uuid;
begin
  select id into v_journal from public.journals where company_id = p_company and code = p_journal and deleted_at is null;
  if v_journal is null then raise exception 'Journal % is missing', p_journal using errcode = '23514'; end if;

  create temp table if not exists _gl (account_id uuid, amount numeric, partner_id uuid, cost_center_id uuid, tax_code_id uuid,
                                       variant_id uuid, description text, currency_code text, amount_currency numeric) on commit drop;
  delete from _gl;
  insert into _gl
  select (l ->> 'account_id')::uuid, round((l ->> 'amount')::numeric, 2), nullif(l ->> 'partner_id', '')::uuid,
         nullif(l ->> 'cost_center_id', '')::uuid, nullif(l ->> 'tax_code_id', '')::uuid, nullif(l ->> 'variant_id', '')::uuid,
         l ->> 'description', l ->> 'currency_code', (l ->> 'amount_currency')::numeric
    from jsonb_array_elements(p_lines) l
   where coalesce((l ->> 'amount')::numeric, 0) <> 0;
  if exists (select 1 from _gl where account_id is null) then
    raise exception 'A posting line has no account' using errcode = '23514';
  end if;

  select coalesce(sum(amount), 0) into v_diff from _gl;
  if abs(v_diff) > 1 then
    raise exception 'Posting for % does not balance (difference %)', coalesce(p_reference, p_source_type), v_diff using errcode = '23514';
  elsif v_diff <> 0 then
    insert into _gl (account_id, amount, description) values (app.acct(p_company, 'rounding'), -v_diff, 'Rounding');
  end if;
  if not exists (select 1 from _gl) then return null; end if;

  insert into public.journal_entries (company_id, journal_id, entry_date, reference, memo, source_doc_type, source_doc_id,
                                      is_automatic, posting_key, currency_code, reversal_of_id)
  values (p_company, v_journal, p_date, p_reference, p_memo, p_source_type, p_source_id, true, coalesce(p_posting_key, 'main'), p_currency,
          p_reversal_of)
  returning id into v_je;

  for r in
    select account_id, partner_id, cost_center_id, tax_code_id, variant_id, min(description) as description,
           max(currency_code) as currency_code, sum(amount_currency) as amount_currency, sum(amount) as amount
      from _gl
     group by account_id, partner_id, cost_center_id, tax_code_id, variant_id
    having sum(amount) <> 0
     order by sum(amount) < 0, account_id
  loop
    v_n := v_n + 1;
    insert into public.journal_lines (company_id, entry_id, line_no, account_id, debit, credit, partner_id, cost_center_id,
                                      tax_code_id, variant_id, description, currency_code, amount_currency)
    values (p_company, v_je, v_n, r.account_id, greatest(r.amount, 0), greatest(-r.amount, 0), r.partner_id, r.cost_center_id,
            r.tax_code_id, r.variant_id, r.description, r.currency_code, r.amount_currency);
  end loop;
  if v_n < 2 then
    delete from public.journal_entries where id = v_je;   -- everything netted to zero
    return null;
  end if;
  update public.journal_entries set status = 'posted' where id = v_je;
  return v_je;
end $$;

-- product-level account (category override → company default)
create or replace function app.item_acct(p_company uuid, p_variant uuid, p_kind text)
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select case p_kind when 'inventory' then c.inventory_account_id when 'revenue' then c.revenue_account_id
                        when 'cogs' then c.cogs_account_id when 'expense' then c.expense_account_id
                        when 'purchase_price_variance' then c.price_difference_account_id end
       from public.product_variants v join public.products p on p.id = v.product_id
       left join public.product_categories c on c.id = p.category_id
      where v.id = p_variant),
    app.acct(p_company, case p_kind when 'revenue' then 'sales_revenue' when 'expense' then 'purchase_expense' else p_kind end))
$$;

-- -----------------------------------------------------------------------------
-- 3. Inventory postings from the stock ledger (deferred, one entry per document)
-- -----------------------------------------------------------------------------
create or replace function app.tg_stock_movement_gl()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  m record; v_lines jsonb := '[]'::jsonb; v_counter uuid; v_inv numeric; v_je uuid; v_date date; v_ref text;
  v_reason text; v_receipt_type text; v_journal text := 'INV'; v_tz text;
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
    v_counter := case
      when m.movement_type = 'receipt' and coalesce(v_receipt_type, 'purchase') = 'purchase' then app.acct(m.company_id, 'grni')
      when m.movement_type in ('receipt') then app.acct(m.company_id, 'inventory_adjustment')
      when m.movement_type = 'purchase_return' then app.acct(m.company_id, 'grni')
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
end $$;
create constraint trigger trg_gl_post after insert on public.stock_movements
  deferrable initially deferred for each row execute function app.tg_stock_movement_gl();

-- -----------------------------------------------------------------------------
-- 4. Sales invoices & credit notes
-- -----------------------------------------------------------------------------
create or replace function app.gl_sales_invoice(p_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare i public.sales_invoices; s int; v_lines jsonb := '[]'::jsonb; l record; v_ar uuid; v_je uuid;
begin
  select * into i from public.sales_invoices where id = p_id;
  s := case when i.document_type = 'credit_note' then -1 else 1 end;
  select coalesce(receivable_account_id, app.acct(i.company_id, 'receivable')) into v_ar from public.business_partners where id = i.partner_id;
  v_lines := v_lines || jsonb_build_object('account_id', v_ar, 'amount', s * round(i.total * i.exchange_rate, 2), 'partner_id', i.partner_id,
                                           'currency_code', i.currency_code, 'amount_currency', s * i.total, 'description', i.number);
  for l in select il.*, t.output_account_id from public.sales_invoice_lines il left join public.tax_codes t on t.id = il.tax_code_id
            where il.invoice_id = i.id loop
    v_lines := v_lines
      || jsonb_build_object('account_id', coalesce(l.account_id, case when l.variant_id is not null then app.item_acct(i.company_id, l.variant_id, 'revenue') else app.acct(i.company_id, 'sales_revenue') end),
                            'amount', -s * round(l.line_subtotal * i.exchange_rate, 2), 'cost_center_id', l.cost_center_id, 'partner_id', i.partner_id,
                            'description', l.description);
    if l.tax_amount <> 0 then
      v_lines := v_lines || jsonb_build_object('account_id', coalesce(l.output_account_id, app.acct(i.company_id, 'vat_output')),
                                               'amount', -s * round(l.tax_amount * i.exchange_rate, 2), 'tax_code_id', l.tax_code_id, 'description', 'VAT');
    end if;
  end loop;
  v_je := app.gl_post(i.company_id, 'SAL', i.invoice_date, i.document_type, i.id, i.number,
                      case when s = 1 then 'Invoice ' else 'Credit note ' end || i.number, v_lines, 'main', i.currency_code);
  update public.sales_invoices set journal_entry_id = v_je where id = i.id;
  return v_je;
end $$;

-- -----------------------------------------------------------------------------
-- 5. Vendor bills & vendor credit notes
-- -----------------------------------------------------------------------------
create or replace function app.gl_vendor_bill(p_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare b public.vendor_bills; s int; v_lines jsonb := '[]'::jsonb; l record; v_ap uuid; v_je uuid; v_base numeric;
begin
  select * into b from public.vendor_bills where id = p_id;
  s := case when b.document_type = 'vendor_credit' then -1 else 1 end;
  select coalesce(payable_account_id, app.acct(b.company_id, 'payable')) into v_ap from public.business_partners where id = b.vendor_id;
  v_lines := v_lines || jsonb_build_object('account_id', v_ap, 'amount', -s * round(b.total * b.exchange_rate, 2), 'partner_id', b.vendor_id,
                                           'currency_code', b.currency_code, 'amount_currency', -s * b.total,
                                           'description', b.number || ' · ' || b.vendor_invoice_number);
  for l in
    select bl.*, t.input_account_id, coalesce(p.product_type, 'service') as product_type, coalesce(bl.variant_id, pl.variant_id) as item_id
      from public.vendor_bill_lines bl
      left join public.tax_codes t on t.id = bl.tax_code_id
      left join public.purchase_order_lines pl on pl.id = bl.po_line_id
      left join public.product_variants v on v.id = coalesce(bl.variant_id, pl.variant_id)
      left join public.products p on p.id = v.product_id
     where bl.bill_id = b.id
  loop
    v_base := round(l.line_subtotal * b.exchange_rate, 2);
    if l.po_line_id is not null and l.product_type = 'stockable' and l.account_id is null then
      -- received goods: clear GRNI at receipt value; price difference to stock (still on hand) or PPV (already sold)
      v_lines := v_lines
        || jsonb_build_object('account_id', app.acct(b.company_id, 'grni'), 'amount', s * (v_base - l.capitalized_variance - l.expensed_variance),
                              'variant_id', l.item_id, 'partner_id', b.vendor_id, 'description', l.description)
        || jsonb_build_object('account_id', app.item_acct(b.company_id, l.item_id, 'inventory'), 'amount', s * l.capitalized_variance,
                              'variant_id', l.item_id, 'description', 'Price difference on stock')
        || jsonb_build_object('account_id', app.item_acct(b.company_id, l.item_id, 'purchase_price_variance'), 'amount', s * l.expensed_variance,
                              'variant_id', l.item_id, 'description', 'Price difference on goods already sold');
    else
      v_lines := v_lines || jsonb_build_object(
        -- stock items billed without a receipt are bought for resale and consumed directly (periodic method): cost of sales
        'account_id', coalesce(l.account_id, case when l.item_id is not null and l.product_type = 'stockable' then app.item_acct(b.company_id, l.item_id, 'cogs')
                                                  when l.item_id is not null then app.item_acct(b.company_id, l.item_id, 'expense')
                                                  else app.acct(b.company_id, 'purchase_expense') end),
        'amount', s * v_base, 'cost_center_id', l.cost_center_id, 'variant_id', l.item_id, 'description', l.description);
    end if;
    if l.tax_amount <> 0 then
      v_lines := v_lines || jsonb_build_object('account_id', coalesce(l.input_account_id, app.acct(b.company_id, 'vat_input')),
                                               'amount', s * round(l.tax_amount * b.exchange_rate, 2), 'tax_code_id', l.tax_code_id, 'description', 'VAT');
    end if;
  end loop;
  v_je := app.gl_post(b.company_id, 'PUR', b.bill_date, b.document_type, b.id, b.number,
                      case when s = 1 then 'Vendor bill ' else 'Vendor credit ' end || b.vendor_invoice_number, v_lines, 'main', b.currency_code);
  update public.vendor_bills set journal_entry_id = v_je where id = b.id;
  return v_je;
end $$;

-- -----------------------------------------------------------------------------
-- 6. Landed costs
-- -----------------------------------------------------------------------------
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
  v_je := app.gl_post(lc.company_id, 'INV', lc.landed_cost_date, 'landed_cost', lc.id, lc.number, 'Landed cost ' || lc.number, v_lines);
  update public.landed_costs set journal_entry_id = v_je where id = lc.id;
  return v_je;
end $$;

-- status → posted triggers
create or replace function app.tg_document_gl()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'posted' and old.status is distinct from 'posted' then
    case tg_table_name
      when 'sales_invoices' then perform app.gl_sales_invoice(new.id);
      when 'vendor_bills'   then perform app.gl_vendor_bill(new.id);
      when 'landed_costs'   then perform app.gl_landed_cost(new.id);
    end case;
  end if;
  return null;
end $$;
create trigger trg_92_gl after update of status on public.sales_invoices for each row execute function app.tg_document_gl();
create trigger trg_92_gl after update of status on public.vendor_bills   for each row execute function app.tg_document_gl();
create trigger trg_92_gl after update of status on public.landed_costs   for each row execute function app.tg_document_gl();

-- -----------------------------------------------------------------------------
-- 7. Payments (customer receipts, vendor payments) with allocations
-- -----------------------------------------------------------------------------
-- defaults: currency from the bank account, rate from the rate table
create or replace function app.tg_payment_defaults()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_rate numeric;
begin
  if tg_op = 'INSERT' then
    new.currency_code := coalesce(new.currency_code, (select currency_code from public.bank_accounts where id = new.bank_account_id));
  end if;
  if (tg_op = 'INSERT' and new.exchange_rate = 1) or (tg_op = 'UPDATE' and new.status = 'draft'
       and (new.currency_code is distinct from old.currency_code or new.payment_date is distinct from old.payment_date) and new.exchange_rate = old.exchange_rate) then
    v_rate := app.exchange_rate(new.company_id, new.currency_code, new.payment_date);
    if v_rate is not null then new.exchange_rate := v_rate; end if;
  end if;
  return new;
end $$;
create trigger trg_03_defaults before insert or update of currency_code, payment_date, bank_account_id on public.payments
  for each row execute function app.tg_payment_defaults();

create or replace function app.refresh_payment_status(p_table text, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_table = 'sales_invoices' then
    update public.sales_invoices i
       set amount_paid = coalesce((select sum(a.amount) from public.payment_allocations a join public.payments p on p.id = a.payment_id
                                     where a.sales_invoice_id = i.id and p.status = 'posted'), 0)
     where i.id = p_id;
    update public.sales_invoices set payment_status = case when amount_paid <= 0 then 'unpaid' when amount_paid < total then 'partially_paid' else 'paid' end
     where id = p_id;
  else
    update public.vendor_bills b
       set amount_paid = coalesce((select sum(a.amount) from public.payment_allocations a join public.payments p on p.id = a.payment_id
                                     where a.vendor_bill_id = b.id and p.status = 'posted'), 0)
     where b.id = p_id;
    update public.vendor_bills set payment_status = case when amount_paid <= 0 then 'unpaid' when amount_paid < total then 'partially_paid' else 'paid' end
     where id = p_id;
  end if;
end $$;

create or replace function app.gl_payment(p_id uuid, p_reverse boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  p public.payments; ba public.bank_accounts; v_ctrl uuid; v_lines jsonb := '[]'::jsonb; a record; s int; v_fx numeric := 0;
  v_alloc_base numeric; v_doc_base numeric; v_je uuid; v_journal text; s0 int;
begin
  select * into p from public.payments where id = p_id;
  select * into ba from public.bank_accounts where id = p.bank_account_id;
  s0 := case when p.document_type = 'customer_payment' then 1 else -1 end;
  s := s0 * case when p_reverse then -1 else 1 end;
  if p.document_type = 'customer_payment' then
    select coalesce(receivable_account_id, app.acct(p.company_id, 'receivable')) into v_ctrl from public.business_partners where id = p.partner_id;
  else
    select coalesce(payable_account_id, app.acct(p.company_id, 'payable')) into v_ctrl from public.business_partners where id = p.partner_id;
  end if;
  -- money side at the payment rate
  v_lines := v_lines || jsonb_build_object('account_id', ba.account_id, 'amount', s * p.amount_base, 'currency_code', p.currency_code,
                                           'amount_currency', s * p.amount, 'description', p.number);
  -- partner side: allocated part at each document's own rate, rest at the payment rate; the gap is an FX gain/loss
  for a in select pa.amount, coalesce(i.exchange_rate, b.exchange_rate) as doc_rate
             from public.payment_allocations pa
             left join public.sales_invoices i on i.id = pa.sales_invoice_id
             left join public.vendor_bills b on b.id = pa.vendor_bill_id
            where pa.payment_id = p.id loop
    v_alloc_base := round(a.amount * p.exchange_rate, 2);
    v_doc_base := round(a.amount * a.doc_rate, 2);
    v_lines := v_lines || jsonb_build_object('account_id', v_ctrl, 'amount', -s * v_doc_base, 'partner_id', p.partner_id, 'description', p.number);
    v_fx := v_fx + (v_alloc_base - v_doc_base);
  end loop;
  v_lines := v_lines || jsonb_build_object('account_id', v_ctrl, 'amount', -s * round(p.unallocated * p.exchange_rate, 2), 'partner_id', p.partner_id,
                                           'description', p.number || ' (unallocated)');
  if v_fx <> 0 then
    -- customer pays more base than booked → gain; for vendor payments the sign flips
    v_lines := v_lines || jsonb_build_object('account_id', app.acct(p.company_id, case when s0 * v_fx > 0 then 'exchange_gain' else 'exchange_loss' end),
                                             'amount', -s * v_fx, 'description', 'Exchange difference');
  end if;
  v_journal := coalesce((select code from public.journals where id = ba.journal_id), case when ba.account_kind = 'cash' then 'CSH' else 'BNK' end);
  v_je := app.gl_post(p.company_id, v_journal, case when p_reverse then current_date else p.payment_date end, p.document_type, p.id, p.number,
                      case when p_reverse then 'Reversal of ' else '' end
                      || case when p.document_type = 'customer_payment' then 'Receipt ' else 'Payment ' end || p.number,
                      v_lines, case when p_reverse then 'reversal' else 'main' end, p.currency_code,
                      case when p_reverse then p.journal_entry_id end);
  return v_je;
end $$;

create or replace function public.post_payment(p_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare p public.payments; a record; v_open numeric; v_je uuid; v_period text;
begin
  select * into p from public.payments where id = p_id for update;
  if p.id is null then raise exception 'Payment not found' using errcode = 'P0002'; end if;
  perform app.require_permission(p.company_id, 'invoicing.write');
  if p.status = 'draft' and p.document_type = 'vendor_payment' then
    perform public.submit_for_approval('vendor_payment', p.id);   -- approves directly when no workflow applies
    select * into p from public.payments where id = p_id;
    if p.status = 'pending_approval' then return p.status; end if;
  end if;
  if p.status not in ('draft','approved') then
    raise exception 'Payment is %; it cannot be posted', replace(p.status, '_', ' ') using errcode = '55000';
  end if;
  if not exists (select 1 from public.bank_accounts where id = p.bank_account_id and is_active and deleted_at is null) then
    raise exception 'The bank account is inactive' using errcode = '23514';
  end if;
  select status into v_period from public.fiscal_periods where company_id = p.company_id and p.payment_date between start_date and end_date;
  if coalesce(v_period, 'missing') <> 'open' then
    raise exception 'The fiscal period for % is %', p.payment_date, coalesce(v_period, 'missing') using errcode = '23514';
  end if;

  for a in select pa.*, i.partner_id as i_partner, i.status as i_status, i.currency_code as i_cur, i.document_type as i_type,
                  i.total - i.amount_paid as i_open, i.number as i_no,
                  b.vendor_id as b_partner, b.status as b_status, b.currency_code as b_cur, b.document_type as b_type,
                  b.total - b.amount_paid as b_open, b.number as b_no
             from public.payment_allocations pa
             left join public.sales_invoices i on i.id = pa.sales_invoice_id
             left join public.vendor_bills b on b.id = pa.vendor_bill_id
            where pa.payment_id = p.id loop
    if p.document_type = 'customer_payment' then
      if a.sales_invoice_id is null then raise exception 'Customer receipts are allocated to customer invoices' using errcode = '23514'; end if;
      if a.i_partner <> p.partner_id or a.i_status <> 'posted' or a.i_type <> 'sales_invoice' then
        raise exception 'Invoice % is not an open invoice of this customer', a.i_no using errcode = '23514';
      end if;
      if a.i_cur <> p.currency_code then raise exception 'Invoice % is in %, the payment in %', a.i_no, a.i_cur, p.currency_code using errcode = '23514'; end if;
      if a.amount > a.i_open then raise exception 'Allocation to % is more than its open amount (%)', a.i_no, a.i_open using errcode = '23514'; end if;
    else
      if a.vendor_bill_id is null then raise exception 'Vendor payments are allocated to vendor bills' using errcode = '23514'; end if;
      if a.b_partner <> p.partner_id or a.b_status <> 'posted' or a.b_type <> 'vendor_bill' then
        raise exception 'Bill % is not an open bill of this vendor', a.b_no using errcode = '23514';
      end if;
      if a.b_cur <> p.currency_code then raise exception 'Bill % is in %, the payment in %', a.b_no, a.b_cur, p.currency_code using errcode = '23514'; end if;
      if a.amount > a.b_open then raise exception 'Allocation to % is more than its open amount (%)', a.b_no, a.b_open using errcode = '23514'; end if;
    end if;
  end loop;

  update public.payments set allocated_amount = coalesce((select sum(amount) from public.payment_allocations where payment_id = p.id), 0)
   where id = p.id;
  update public.payments set status = 'posted', posted_at = now() where id = p.id;
  for a in select * from public.payment_allocations where payment_id = p.id loop
    if a.sales_invoice_id is not null then perform app.refresh_payment_status('sales_invoices', a.sales_invoice_id);
    else perform app.refresh_payment_status('vendor_bills', a.vendor_bill_id); end if;
  end loop;
  v_je := app.gl_payment(p.id);
  update public.payments set journal_entry_id = v_je where id = p.id;
  return 'posted';
end $$;

create or replace function public.reverse_payment(p_id uuid, p_reason text)
returns text language plpgsql security definer set search_path = '' as $$
declare p public.payments; a record; v_je uuid;
begin
  select * into p from public.payments where id = p_id for update;
  if p.id is null then raise exception 'Payment not found' using errcode = 'P0002'; end if;
  perform app.require_permission(p.company_id, 'invoicing.write');
  if p.status <> 'posted' then raise exception 'Only posted payments can be reversed' using errcode = '55000'; end if;
  if exists (select 1 from public.bank_statement_lines where matched_payment_id = p.id and match_status = 'matched') then
    raise exception 'The payment is reconciled with a bank statement; unmatch it first' using errcode = '55000';
  end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'Give a reason' using errcode = '23514'; end if;
  v_je := app.gl_payment(p.id, true);
  update public.journal_entries set status = 'reversed', reversed_by_id = v_je where id = p.journal_entry_id;
  update public.payments set status = 'reversed', reversed_at = now(), notes = concat_ws(E'\n', notes, 'Reversed: ' || btrim(p_reason)) where id = p.id;
  for a in select * from public.payment_allocations where payment_id = p.id loop
    if a.sales_invoice_id is not null then perform app.refresh_payment_status('sales_invoices', a.sales_invoice_id);
    else perform app.refresh_payment_status('vendor_bills', a.vendor_bill_id); end if;
  end loop;
  return 'reversed';
end $$;


-- Approval thresholds also apply to payments (amount_base)
create or replace function public.submit_for_approval(p_doc_type text, p_document_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare dt public.document_types; v_doc jsonb; v_company uuid; v_amount numeric; w public.approval_workflows; v_req uuid; v_step smallint;
begin
  select * into dt from public.document_types where key = p_doc_type;
  if dt.table_name is null or dt.approved_status is null then raise exception 'Document type % has no approval flow', p_doc_type; end if;

  execute format('select to_jsonb(t) from public.%I t where t.id = $1', dt.table_name) into v_doc using p_document_id;
  if v_doc is null then raise exception 'Document not found'; end if;
  v_company := (v_doc ->> 'company_id')::uuid;
  perform app.require_permission(v_company, dt.module || '.write');
  v_amount := abs(coalesce((v_doc ->> 'total_base')::numeric, (v_doc ->> 'amount_base')::numeric, (v_doc ->> 'total')::numeric,
                           (v_doc ->> 'total_value')::numeric, (v_doc ->> 'estimated_total')::numeric, 0));

  select * into w from public.approval_workflows
   where company_id = v_company and doc_type = p_doc_type and is_active and deleted_at is null
     and (min_amount is null or v_amount >= min_amount)
   order by priority desc, min_amount desc nulls last limit 1;

  if w.id is null then
    perform app.set_document_status(dt.table_name, p_document_id, dt.approved_status);
    return null;
  end if;

  select min(step_order) into v_step from public.approval_workflow_steps where workflow_id = w.id;
  if v_step is null then raise exception 'Workflow "%" has no steps', w.name; end if;

  insert into public.approval_requests (company_id, workflow_id, doc_type, document_id, document_number, amount, current_step, requested_by)
  values (v_company, w.id, p_doc_type, p_document_id, v_doc ->> 'number', v_amount, v_step, auth.uid())
  returning id into v_req;

  perform app.set_document_status(dt.table_name, p_document_id, dt.pending_status);
  perform app.notify_step_approvers(v_req);
  return v_req;
end $$;

-- -----------------------------------------------------------------------------
-- 8. Manual journal entries: reversal
-- -----------------------------------------------------------------------------
create or replace function public.reverse_journal_entry(p_id uuid, p_date date default current_date, p_memo text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare e public.journal_entries; v_new uuid;
begin
  select * into e from public.journal_entries where id = p_id for update;
  if e.id is null then raise exception 'Journal entry not found' using errcode = 'P0002'; end if;
  perform app.require_permission(e.company_id, 'finance.write');
  if e.status <> 'posted' then raise exception 'Only posted entries can be reversed' using errcode = '55000'; end if;
  if e.is_automatic then
    raise exception 'Automatic entries are corrected from their source document (credit note, reversal of the payment…)' using errcode = '55000';
  end if;
  insert into public.journal_entries (company_id, journal_id, entry_date, reference, memo, reversal_of_id, currency_code)
  values (e.company_id, e.journal_id, p_date, e.number, coalesce(p_memo, 'Reversal of ' || e.number), e.id, e.currency_code)
  returning id into v_new;
  insert into public.journal_lines (company_id, entry_id, line_no, account_id, debit, credit, currency_code, amount_currency,
                                    partner_id, cost_center_id, tax_code_id, variant_id, description)
  select company_id, v_new, line_no, account_id, credit, debit, currency_code, -amount_currency, partner_id, cost_center_id, tax_code_id,
         variant_id, description
    from public.journal_lines where entry_id = e.id;
  update public.journal_entries set status = 'posted' where id = v_new;
  update public.journal_entries set status = 'reversed', reversed_by_id = v_new where id = e.id;
  return v_new;
end $$;

-- -----------------------------------------------------------------------------
-- 9. Fixed assets & depreciation
-- -----------------------------------------------------------------------------
create or replace function app.asset_schedule(p_asset uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.fixed_assets; v_base numeric; v_book numeric; v_amt numeric; v_acc numeric; i int; v_date date; v_months int;
begin
  select * into a from public.fixed_assets where id = p_asset;
  delete from public.asset_depreciation_lines where asset_id = a.id and status = 'planned';
  v_acc := a.accumulated_depreciation;
  v_base := a.acquisition_cost - a.salvage_value;
  select count(*) into i from public.asset_depreciation_lines where asset_id = a.id;
  v_months := a.useful_life_months;
  while i < v_months and v_acc < v_base loop
    v_date := (date_trunc('month', a.in_service_date) + make_interval(months => i + 1) - interval '1 day')::date;
    if a.depreciation_method = 'declining_balance' then
      v_book := a.acquisition_cost - v_acc;
      v_amt := round(v_book * coalesce(a.declining_rate_pct, 20) / 100 / 12, 2);
      -- switch to straight-line over the remaining life when that is higher
      v_amt := greatest(v_amt, round((v_base - v_acc) / greatest(v_months - i, 1), 2));
    else
      v_amt := round(v_base / v_months, 2);
    end if;
    if i = v_months - 1 or v_acc + v_amt > v_base then v_amt := v_base - v_acc; end if;
    exit when v_amt <= 0;
    v_acc := v_acc + v_amt;
    insert into public.asset_depreciation_lines (company_id, asset_id, period_date, amount, accumulated_after)
    values (a.company_id, a.id, v_date, v_amt, v_acc);
    i := i + 1;
  end loop;
end $$;

-- p_counter: account credited at acquisition when the asset was not bought through a vendor bill
-- (the bill line already debits the asset account). null = no acquisition entry.
create or replace function public.activate_fixed_asset(p_id uuid, p_counter_account uuid default null)
returns text language plpgsql security definer set search_path = '' as $$
declare a public.fixed_assets; c public.fixed_asset_categories; v_je uuid;
begin
  select * into a from public.fixed_assets where id = p_id for update;
  if a.id is null then raise exception 'Asset not found' using errcode = 'P0002'; end if;
  perform app.require_permission(a.company_id, 'finance.write');
  if a.status <> 'draft' then raise exception 'Asset is already %', a.status using errcode = '55000'; end if;
  select * into c from public.fixed_asset_categories where id = a.category_id;
  if p_counter_account is not null then
    v_je := app.gl_post(a.company_id, 'GEN', a.acquisition_date, 'fixed_asset', a.id, a.number, 'Acquisition of ' || a.name,
      jsonb_build_array(
        jsonb_build_object('account_id', c.asset_account_id, 'amount', a.acquisition_cost, 'cost_center_id', a.cost_center_id, 'description', a.name),
        jsonb_build_object('account_id', p_counter_account, 'amount', -a.acquisition_cost, 'partner_id', a.vendor_id, 'description', a.name)));
  end if;
  update public.fixed_assets set status = 'active', journal_entry_id = v_je where id = a.id;
  perform app.asset_schedule(a.id);
  return 'active';
end $$;

-- Posts every planned depreciation line up to p_through: one entry per month
create or replace function public.run_depreciation(p_company uuid, p_through date default current_date, p_asset uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m record; l record; v_lines jsonb; v_je uuid; v_count int := 0; v_total numeric := 0; v_months int := 0;
begin
  perform app.require_permission(p_company, 'finance.write');
  for m in select distinct dl.period_date from public.asset_depreciation_lines dl join public.fixed_assets fa on fa.id = dl.asset_id
            where dl.company_id = p_company and dl.status = 'planned' and dl.period_date <= p_through and fa.status = 'active'
              and (p_asset is null or fa.id = p_asset)
            order by dl.period_date loop
    v_lines := '[]'::jsonb;
    for l in select dl.*, fa.name, fa.number, fa.cost_center_id, c.accumulated_depreciation_account_id as accum, c.depreciation_expense_account_id as exp
               from public.asset_depreciation_lines dl join public.fixed_assets fa on fa.id = dl.asset_id
               join public.fixed_asset_categories c on c.id = fa.category_id
              where dl.company_id = p_company and dl.status = 'planned' and dl.period_date = m.period_date and fa.status = 'active'
                and (p_asset is null or fa.id = p_asset) loop
      v_lines := v_lines
        || jsonb_build_object('account_id', l.exp, 'amount', l.amount, 'cost_center_id', l.cost_center_id, 'description', l.number || ' ' || l.name)
        || jsonb_build_object('account_id', l.accum, 'amount', -l.amount, 'description', l.number || ' ' || l.name);
      v_count := v_count + 1; v_total := v_total + l.amount;
    end loop;
    v_je := app.gl_post(p_company, 'DEP', m.period_date, null, null, 'DEP ' || to_char(m.period_date, 'YYYY-MM'),
                        'Depreciation ' || to_char(m.period_date, 'Mon YYYY'), v_lines, 'dep:' || m.period_date || coalesce(':' || p_asset, ''));
    update public.asset_depreciation_lines dl set status = 'posted', journal_entry_id = v_je
      from public.fixed_assets fa
     where fa.id = dl.asset_id and dl.company_id = p_company and dl.status = 'planned' and dl.period_date = m.period_date and fa.status = 'active'
       and (p_asset is null or fa.id = p_asset);
    v_months := v_months + 1;
  end loop;
  update public.fixed_assets fa
     set accumulated_depreciation = coalesce((select sum(amount) from public.asset_depreciation_lines where asset_id = fa.id and status = 'posted'), 0)
   where fa.company_id = p_company and fa.status = 'active';
  update public.fixed_assets set status = 'fully_depreciated'
   where company_id = p_company and status = 'active' and accumulated_depreciation >= acquisition_cost - salvage_value;
  return jsonb_build_object('lines', v_count, 'amount', v_total, 'months', v_months);
end $$;

create or replace function public.dispose_fixed_asset(p_id uuid, p_date date, p_proceeds numeric, p_proceeds_account uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.fixed_assets; c public.fixed_asset_categories; v_book numeric; v_gain numeric; v_lines jsonb; v_je uuid;
begin
  select * into a from public.fixed_assets where id = p_id for update;
  if a.id is null then raise exception 'Asset not found' using errcode = 'P0002'; end if;
  perform app.require_permission(a.company_id, 'finance.write');
  if a.status not in ('active','fully_depreciated') then raise exception 'Asset is %', a.status using errcode = '55000'; end if;
  if coalesce(p_proceeds, 0) < 0 then raise exception 'Proceeds cannot be negative' using errcode = '23514'; end if;
  if coalesce(p_proceeds, 0) > 0 and p_proceeds_account is null then raise exception 'Choose where the proceeds were received' using errcode = '23514'; end if;
  perform public.run_depreciation(a.company_id, p_date, a.id);       -- catch up to the disposal date
  delete from public.asset_depreciation_lines where asset_id = a.id and status = 'planned';
  select * into a from public.fixed_assets where id = p_id;
  select * into c from public.fixed_asset_categories where id = a.category_id;
  v_book := a.acquisition_cost - a.accumulated_depreciation;
  v_gain := coalesce(p_proceeds, 0) - v_book;
  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', c.accumulated_depreciation_account_id, 'amount', a.accumulated_depreciation, 'description', a.name),
    jsonb_build_object('account_id', c.asset_account_id, 'amount', -a.acquisition_cost, 'description', a.name),
    jsonb_build_object('account_id', p_proceeds_account, 'amount', coalesce(p_proceeds, 0), 'description', 'Disposal proceeds'),
    jsonb_build_object('account_id', app.acct(a.company_id, case when v_gain >= 0 then 'asset_disposal_gain' else 'asset_disposal_loss' end),
                       'amount', -v_gain, 'description', case when v_gain >= 0 then 'Gain on disposal' else 'Loss on disposal' end));
  v_je := app.gl_post(a.company_id, 'GEN', p_date, 'fixed_asset', a.id, a.number, 'Disposal of ' || a.name, v_lines, 'disposal');
  update public.fixed_assets set status = 'disposed', disposal_date = p_date, disposal_amount = coalesce(p_proceeds, 0),
                                 disposal_account_id = p_proceeds_account where id = a.id;
  return jsonb_build_object('book_value', v_book, 'gain', v_gain, 'journal_entry_id', v_je);
end $$;

-- -----------------------------------------------------------------------------
-- 10. Bank reconciliation
-- -----------------------------------------------------------------------------
create or replace function public.auto_match_statement(p_statement uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare s public.bank_statements; ba public.bank_accounts; l record; v_pay uuid; v_jl uuid; v_n int := 0;
begin
  select * into s from public.bank_statements where id = p_statement;
  if s.id is null then raise exception 'Statement not found' using errcode = 'P0002'; end if;
  perform app.require_permission(s.company_id, 'finance.write');
  select * into ba from public.bank_accounts where id = s.bank_account_id;
  for l in select * from public.bank_statement_lines where statement_id = s.id and match_status = 'unmatched' order by transaction_date loop
    v_pay := null; v_jl := null;
    -- 1) a posted payment on this account with the same amount, reference first, then nearest date (±7 days)
    select p.id into v_pay from public.payments p
     where p.company_id = s.company_id and p.bank_account_id = ba.id and p.status = 'posted'
       and (case when p.document_type = 'customer_payment' then 1 else -1 end)
           * (case when p.currency_code = ba.currency_code then p.amount else p.amount_base end) = l.amount
       and abs(p.payment_date - l.transaction_date) <= 7
       and not exists (select 1 from public.bank_statement_lines x where x.matched_payment_id = p.id and x.match_status = 'matched')
     order by (coalesce(l.reference, '') <> '' and (p.reference ilike '%' || l.reference || '%' or l.description ilike '%' || p.number || '%')) desc,
              abs(p.payment_date - l.transaction_date), p.payment_date
     limit 1;
    if v_pay is not null then
      update public.bank_statement_lines set match_status = 'matched', matched_payment_id = v_pay,
             partner_id = coalesce(partner_id, (select partner_id from public.payments where id = v_pay)) where id = l.id;
      v_n := v_n + 1; continue;
    end if;
    -- 2) any posted journal line on the bank's GL account with that amount (transfers, deposits, fees)
    select jl.id into v_jl from public.journal_lines jl join public.journal_entries e on e.id = jl.entry_id
     where jl.company_id = s.company_id and jl.account_id = ba.account_id and e.status = 'posted'
       and (jl.debit - jl.credit) = l.amount and abs(e.entry_date - l.transaction_date) <= 7
       and e.source_doc_type is distinct from 'customer_payment' and e.source_doc_type is distinct from 'vendor_payment'
       and not exists (select 1 from public.bank_statement_lines x where x.matched_journal_line_id = jl.id and x.match_status = 'matched')
     order by abs(e.entry_date - l.transaction_date) limit 1;
    if v_jl is not null then
      update public.bank_statement_lines set match_status = 'matched', matched_journal_line_id = v_jl where id = l.id;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;

-- Book an unmatched statement line straight to an account (bank charges, interest, owner transfers…)
create or replace function public.book_statement_line(p_line uuid, p_account uuid, p_memo text default null, p_partner uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare l public.bank_statement_lines; s public.bank_statements; ba public.bank_accounts; v_je uuid; v_journal text;
begin
  select * into l from public.bank_statement_lines where id = p_line for update;
  if l.id is null then raise exception 'Statement line not found' using errcode = 'P0002'; end if;
  select * into s from public.bank_statements where id = l.statement_id;
  perform app.require_permission(s.company_id, 'finance.write');
  if l.match_status <> 'unmatched' then raise exception 'The line is already %', l.match_status using errcode = '55000'; end if;
  select * into ba from public.bank_accounts where id = s.bank_account_id;
  v_journal := coalesce((select code from public.journals where id = ba.journal_id), 'BNK');
  v_je := app.gl_post(s.company_id, v_journal, l.transaction_date, null, null, coalesce(l.reference, s.reference),
                      coalesce(p_memo, l.description),
                      jsonb_build_array(
                        jsonb_build_object('account_id', ba.account_id, 'amount', l.amount, 'description', l.description),
                        jsonb_build_object('account_id', p_account, 'amount', -l.amount, 'partner_id', p_partner, 'description', coalesce(p_memo, l.description))),
                      'bank:' || l.id);
  update public.bank_statement_lines set match_status = 'matched', journal_entry_id = v_je, partner_id = coalesce(p_partner, partner_id),
         matched_journal_line_id = (select id from public.journal_lines where entry_id = v_je and account_id = ba.account_id limit 1)
   where id = l.id;
  return v_je;
end $$;

create or replace function public.reconcile_statement(p_statement uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare s public.bank_statements; v_sum numeric; v_open int;
begin
  select * into s from public.bank_statements where id = p_statement for update;
  if s.id is null then raise exception 'Statement not found' using errcode = 'P0002'; end if;
  perform app.require_permission(s.company_id, 'finance.write');
  select coalesce(sum(amount), 0), count(*) filter (where match_status = 'unmatched') into v_sum, v_open
    from public.bank_statement_lines where statement_id = s.id;
  if s.opening_balance + v_sum <> s.closing_balance then
    raise exception 'Opening balance + lines (%) does not equal the closing balance (%)', s.opening_balance + v_sum, s.closing_balance
      using errcode = '23514';
  end if;
  if v_open > 0 then raise exception '% line(s) are still unmatched', v_open using errcode = '23514'; end if;
  update public.bank_statements set status = 'reconciled' where id = s.id;
  return 'reconciled';
end $$;

-- -----------------------------------------------------------------------------
-- 11. Reporting
-- -----------------------------------------------------------------------------
-- Opening / period / closing per account (debit-positive). Opening covers everything before p_from.
create or replace function public.account_balances(p_company uuid, p_from date, p_to date, p_cost_center uuid default null)
returns table (account_id uuid, code text, name text, account_type text, account_subtype text, parent_id uuid, is_postable boolean,
               cash_flow_category text, opening numeric, debit numeric, credit numeric, closing numeric)
language sql stable security invoker set search_path = '' as $$
  with mv as (
    select jl.account_id,
           sum(case when e.entry_date < p_from then jl.debit - jl.credit else 0 end) as opening,
           sum(case when e.entry_date between p_from and p_to then jl.debit else 0 end) as debit,
           sum(case when e.entry_date between p_from and p_to then jl.credit else 0 end) as credit
      from public.journal_lines jl join public.journal_entries e on e.id = jl.entry_id
     where jl.company_id = p_company and e.status in ('posted','reversed') and e.entry_date <= p_to
       and (p_cost_center is null or jl.cost_center_id = p_cost_center)
     group by jl.account_id)
  select a.id, a.code, a.name, a.account_type, a.account_subtype, a.parent_id, a.is_postable, a.cash_flow_category,
         coalesce(mv.opening, 0), coalesce(mv.debit, 0), coalesce(mv.credit, 0),
         coalesce(mv.opening, 0) + coalesce(mv.debit, 0) - coalesce(mv.credit, 0)
    from public.accounts a left join mv on mv.account_id = a.id
   where a.company_id = p_company and a.deleted_at is null
   order by a.code
$$;

-- Open receivables / payables by partner and age bucket (days past due, as of a date)
create or replace function public.partner_aging(p_company uuid, p_kind text, p_as_of date default current_date)
returns table (partner_id uuid, partner_name text, not_due numeric, d1_30 numeric, d31_60 numeric, d61_90 numeric, d90_plus numeric,
               unapplied numeric, total numeric, oldest_due date, documents int)
language sql stable security invoker set search_path = '' as $$
  with docs as (
    select i.partner_id, i.due_date, i.document_type,
           round((i.total - coalesce((select sum(a.amount) from public.payment_allocations a join public.payments p on p.id = a.payment_id
                                       where a.sales_invoice_id = i.id and p.status = 'posted' and p.payment_date <= p_as_of), 0)) * i.exchange_rate, 2)
           * case when i.document_type = 'credit_note' then -1 else 1 end as open_base
      from public.sales_invoices i
     where p_kind = 'ar' and i.company_id = p_company and i.status = 'posted' and i.deleted_at is null and i.invoice_date <= p_as_of
    union all
    select b.vendor_id, b.due_date, b.document_type,
           round((b.total - coalesce((select sum(a.amount) from public.payment_allocations a join public.payments p on p.id = a.payment_id
                                       where a.vendor_bill_id = b.id and p.status = 'posted' and p.payment_date <= p_as_of), 0)) * b.exchange_rate, 2)
           * case when b.document_type = 'vendor_credit' then -1 else 1 end
      from public.vendor_bills b
     where p_kind = 'ap' and b.company_id = p_company and b.status = 'posted' and b.deleted_at is null and b.bill_date <= p_as_of
  ),
  unapplied as (
    select p.partner_id, -sum(round(p.unallocated * p.exchange_rate, 2)) as amount
      from public.payments p
     where p.company_id = p_company and p.status = 'posted' and p.payment_date <= p_as_of and p.unallocated > 0
       and p.document_type = case when p_kind = 'ar' then 'customer_payment' else 'vendor_payment' end
     group by p.partner_id
  ),
  agg as (
    select d.partner_id,
           sum(case when d.document_type in ('credit_note','vendor_credit') or d.due_date >= p_as_of then d.open_base else 0 end) as not_due,
           sum(case when d.document_type not in ('credit_note','vendor_credit') and p_as_of - d.due_date between 1 and 30 then d.open_base else 0 end) as d1_30,
           sum(case when d.document_type not in ('credit_note','vendor_credit') and p_as_of - d.due_date between 31 and 60 then d.open_base else 0 end) as d31_60,
           sum(case when d.document_type not in ('credit_note','vendor_credit') and p_as_of - d.due_date between 61 and 90 then d.open_base else 0 end) as d61_90,
           sum(case when d.document_type not in ('credit_note','vendor_credit') and p_as_of - d.due_date > 90 then d.open_base else 0 end) as d90_plus,
           min(d.due_date) filter (where d.open_base > 0) as oldest_due,
           count(*) filter (where d.open_base <> 0) as documents
      from docs d where d.open_base <> 0 group by d.partner_id
  )
  select bp.id, bp.name, coalesce(a.not_due, 0), coalesce(a.d1_30, 0), coalesce(a.d31_60, 0), coalesce(a.d61_90, 0), coalesce(a.d90_plus, 0),
         coalesce(u.amount, 0),
         coalesce(a.not_due, 0) + coalesce(a.d1_30, 0) + coalesce(a.d31_60, 0) + coalesce(a.d61_90, 0) + coalesce(a.d90_plus, 0) + coalesce(u.amount, 0),
         a.oldest_due, coalesce(a.documents, 0)::int
    from public.business_partners bp
    left join agg a on a.partner_id = bp.id
    left join unapplied u on u.partner_id = bp.id
   where bp.company_id = p_company and (a.partner_id is not null or u.partner_id is not null)
   order by 9 desc
$$;

-- Fiscal years for comparisons / opening balances of earlier years
create or replace function public.create_fiscal_year(p_company uuid, p_year int)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_start date; v_year uuid; m int; v_month int;
begin
  perform app.require_permission(p_company, 'finance.write');
  select fiscal_year_start_month into v_month from public.companies where id = p_company;
  v_start := make_date(p_year, coalesce(v_month, 1), 1);
  if exists (select 1 from public.fiscal_years where company_id = p_company and start_date = v_start) then
    raise exception 'Fiscal year % already exists', p_year using errcode = '23505';
  end if;
  insert into public.fiscal_years (company_id, name, start_date, end_date)
  values (p_company, 'FY ' || p_year, v_start, (v_start + interval '1 year' - interval '1 day')::date) returning id into v_year;
  for m in 0..11 loop
    insert into public.fiscal_periods (company_id, fiscal_year_id, period_no, name, start_date, end_date)
    values (p_company, v_year, m + 1, to_char(v_start + make_interval(months => m), 'Mon YYYY'),
            (v_start + make_interval(months => m))::date, (v_start + make_interval(months => m + 1) - interval '1 day')::date);
  end loop;
  return v_year;
end $$;

create or replace function public.set_period_status(p_period uuid, p_status text)
returns text language plpgsql security definer set search_path = '' as $$
declare p public.fiscal_periods;
begin
  select * into p from public.fiscal_periods where id = p_period for update;
  if p.id is null then raise exception 'Period not found' using errcode = 'P0002'; end if;
  perform app.require_permission(p.company_id, 'finance.approve');
  if p_status not in ('open','closed','locked') then raise exception 'Unknown status %', p_status; end if;
  if p.status = 'locked' then raise exception 'Locked periods cannot be reopened' using errcode = '55000'; end if;
  if p_status in ('closed','locked') and exists (select 1 from public.journal_entries where period_id = p.id and status = 'draft' and deleted_at is null) then
    raise exception 'Post or delete the draft journal entries in % first', p.name using errcode = '55000';
  end if;
  update public.fiscal_periods set status = p_status where id = p.id;
  return p_status;
end $$;

-- Finance KPIs for the dashboard
create or replace function public.finance_overview(p_company uuid, p_from date default make_date(extract(year from current_date)::int, 1, 1),
                                                   p_to date default current_date)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with b as (select * from public.account_balances(p_company, p_from, p_to))
  select jsonb_build_object(
    'revenue',  -coalesce((select sum(debit - credit) from b where account_type = 'revenue' and account_subtype = 'revenue'), 0),
    'other_income', -coalesce((select sum(debit - credit) from b where account_type = 'revenue' and account_subtype = 'other_income'), 0),
    'cogs',     coalesce((select sum(debit - credit) from b where account_subtype = 'cogs'), 0),
    'expenses', coalesce((select sum(debit - credit) from b where account_type = 'expense' and account_subtype <> 'cogs'), 0),
    'net_profit', -coalesce((select sum(debit - credit) from b where account_type in ('revenue','expense')), 0),
    'cash', coalesce((select sum(closing) from b where account_subtype in ('cash','bank')), 0),
    'receivables', coalesce((select sum(closing) from b where account_subtype = 'receivable'), 0),
    'payables', -coalesce((select sum(closing) from b where account_subtype = 'payable'), 0),
    'inventory', coalesce((select sum(closing) from b where account_subtype = 'inventory'), 0),
    'vat_due', -coalesce((select sum(closing) from b where account_subtype = 'tax' and account_type = 'liability'), 0)
               - coalesce((select sum(closing) from b where account_subtype = 'tax' and account_type = 'asset'), 0),
    'ar_overdue', coalesce((select sum(d1_30 + d31_60 + d61_90 + d90_plus) from public.partner_aging(p_company, 'ar', p_to)), 0),
    'ap_overdue', coalesce((select sum(d1_30 + d31_60 + d61_90 + d90_plus) from public.partner_aging(p_company, 'ap', p_to)), 0),
    'unmatched_bank_lines', (select count(*) from public.bank_statement_lines where company_id = p_company and match_status = 'unmatched'),
    'draft_entries', (select count(*) from public.journal_entries where company_id = p_company and status = 'draft' and deleted_at is null),
    'cash_by_month', coalesce((select jsonb_agg(x order by x.month) from (
        select to_char(m, 'YYYY-MM') as month,
               coalesce((select sum(jl.debit - jl.credit) from public.journal_lines jl join public.journal_entries e on e.id = jl.entry_id
                          join public.accounts a on a.id = jl.account_id
                         where jl.company_id = p_company and e.status in ('posted','reversed') and a.account_subtype in ('cash','bank')
                           and e.entry_date < m + interval '1 month'), 0) as cash,
               coalesce((select -sum(jl.debit - jl.credit) from public.journal_lines jl join public.journal_entries e on e.id = jl.entry_id
                          join public.accounts a on a.id = jl.account_id
                         where jl.company_id = p_company and e.status in ('posted','reversed') and a.account_type in ('revenue','expense')
                           and e.entry_date >= m and e.entry_date < m + interval '1 month'), 0) as profit
          from generate_series(date_trunc('month', p_to) - interval '11 months', date_trunc('month', p_to), interval '1 month') m) x), '[]'::jsonb)
  )
$$;

-- -----------------------------------------------------------------------------
-- 12. Search, privileges
-- -----------------------------------------------------------------------------
create or replace function public.global_search(p_company uuid, p_query text, p_limit int default 6)
returns table (kind text, id uuid, title text, subtitle text, href text)
language sql stable security invoker set search_path = '' as $$
  with q as (select '%' || replace(replace(btrim(p_query), '%', '\%'), '_', '\_') || '%' as pat)
  (select 'product', p.id, v.name, v.sku, '/inventory/products/' || p.id
     from public.product_variants v join public.products p on p.id = v.product_id, q
    where v.company_id = p_company and v.deleted_at is null and p.deleted_at is null
      and (v.name ilike q.pat or v.sku ilike q.pat
           or exists (select 1 from public.product_barcodes b where b.variant_id = v.id and b.barcode = btrim(p_query)))
    order by v.name limit p_limit)
  union all
  (select 'partner', bp.id, bp.name, concat_ws(' · ', bp.code, bp.tax_number), '/partners/' || bp.id
     from public.business_partners bp, q
    where bp.company_id = p_company and bp.deleted_at is null
      and (bp.name ilike q.pat or bp.code ilike q.pat or bp.tax_number ilike q.pat or bp.email ilike q.pat)
    order by bp.name limit p_limit)
  union all
  (select 'account', a.id, a.code || ' ' || a.name, 'Account · ' || a.account_type, '/finance/accounts/' || a.id
     from public.accounts a, q
    where a.company_id = p_company and a.deleted_at is null and (a.code ilike btrim(p_query) || '%' or a.name ilike q.pat)
    order by a.code limit 4)
  union all
  (select 'opportunity', o.id, o.name, 'Opportunity · ' || o.status, '/crm/pipeline?open=' || o.id
     from public.opportunities o, q
    where o.company_id = p_company and o.deleted_at is null and (o.name ilike q.pat or o.number ilike q.pat)
    order by o.created_at desc limit 4)
  union all
  (select 'lead', l.id, l.title, concat_ws(' · ', l.company_name, l.contact_name), '/crm/leads?open=' || l.id
     from public.leads l, q
    where l.company_id = p_company and l.deleted_at is null
      and (l.title ilike q.pat or l.company_name ilike q.pat or l.contact_name ilike q.pat or l.number ilike q.pat or l.email ilike q.pat)
    order by l.created_at desc limit 4)
  union all
  (select 'warehouse', w.id, w.name, w.code, '/inventory/warehouses'
     from public.warehouses w, q
    where w.company_id = p_company and w.deleted_at is null and (w.name ilike q.pat or w.code ilike q.pat)
    limit 3)
  union all
  (select 'vendor_bill', b.id, b.number, 'Vendor bill · ' || b.vendor_invoice_number || ' · ' || b.status, '/procurement/bills/' || b.id
     from public.vendor_bills b, q
    where b.company_id = p_company and b.deleted_at is null and (b.number ilike q.pat or b.vendor_invoice_number ilike q.pat)
    order by b.bill_date desc limit 4)
  union all
  (select d.kind, d.id, d.number, d.label, d.href from (
      select 'goods_receipt' as kind, g.id, g.number, 'Goods receipt · ' || g.status as label, '/inventory/receipts/' || g.id as href, g.company_id, g.deleted_at from public.goods_receipts g
      union all select 'stock_adjustment', a.id, a.number, 'Adjustment · ' || a.status, '/inventory/adjustments/' || a.id, a.company_id, a.deleted_at from public.stock_adjustments a
      union all select 'stock_transfer', t.id, t.number, 'Transfer · ' || t.status, '/inventory/transfers/' || t.id, t.company_id, t.deleted_at from public.stock_transfers t
      union all select 'landed_cost', l.id, l.number, 'Landed cost · ' || l.status, '/inventory/landed-costs/' || l.id, l.company_id, l.deleted_at from public.landed_costs l
      union all select 'purchase_requisition', pr.id, pr.number, 'Requisition · ' || pr.status, '/procurement/requisitions/' || pr.id, pr.company_id, pr.deleted_at from public.purchase_requisitions pr
      union all select 'purchase_order', o.id, o.number, 'Purchase order · ' || o.status, '/procurement/orders/' || o.id, o.company_id, o.deleted_at from public.purchase_orders o
      union all select 'sales_quote', sq.id, sq.number, 'Quote · ' || sq.status, '/sales/quotes/' || sq.id, sq.company_id, sq.deleted_at from public.sales_quotes sq
      union all select 'sales_order', s.id, s.number, 'Sales order · ' || s.status, '/sales/orders/' || s.id, s.company_id, s.deleted_at from public.sales_orders s
      union all select 'delivery', dl.id, dl.number, 'Delivery · ' || dl.status, '/sales/deliveries/' || dl.id, dl.company_id, dl.deleted_at from public.deliveries dl
      union all select 'sales_invoice', i.id, i.number, case when i.document_type = 'credit_note' then 'Credit note · ' else 'Invoice · ' end || i.status, '/sales/invoices/' || i.id, i.company_id, i.deleted_at from public.sales_invoices i
      union all select 'payment', pm.id, pm.number, case when pm.document_type = 'customer_payment' then 'Receipt · ' else 'Payment · ' end || pm.status, '/finance/payments/' || pm.id, pm.company_id, pm.deleted_at from public.payments pm
      union all select 'journal_entry', je.id, je.number, 'Journal entry · ' || coalesce(je.memo, je.status), '/finance/journal/' || je.id, je.company_id, je.deleted_at from public.journal_entries je
      union all select 'fixed_asset', fa.id, fa.number, 'Asset · ' || fa.name, '/finance/assets/' || fa.id, fa.company_id, fa.deleted_at from public.fixed_assets fa
    ) d, q
    where d.company_id = p_company and d.deleted_at is null and d.number ilike q.pat
    order by d.number desc limit p_limit)
$$;

revoke execute on function public.post_payment, public.reverse_payment, public.reverse_journal_entry, public.activate_fixed_asset,
                           public.run_depreciation(uuid, date, uuid), public.dispose_fixed_asset, public.auto_match_statement, public.book_statement_line,
                           public.reconcile_statement, public.account_balances, public.partner_aging, public.create_fiscal_year,
                           public.set_period_status, public.finance_overview from public, anon;
grant execute on function public.post_payment, public.reverse_payment, public.reverse_journal_entry, public.activate_fixed_asset,
                          public.run_depreciation(uuid, date, uuid), public.dispose_fixed_asset, public.auto_match_statement, public.book_statement_line,
                          public.reconcile_statement, public.account_balances, public.partner_aging, public.create_fiscal_year,
                          public.set_period_status, public.finance_overview to authenticated;
revoke execute on function app.gl_post, app.acct, app.item_acct, app.gl_sales_invoice, app.gl_vendor_bill, app.gl_landed_cost,
                           app.gl_payment, app.asset_schedule, app.seed_finance_defaults, app.refresh_payment_status from public, authenticated;

-- payments, fixed assets and statements post only through their functions
do $$
declare r record;
begin
  for r in select * from (values ('payments', array['pending_approval','approved','posted','reversed']),
                                 ('fixed_assets', array['active','fully_depreciated','disposed'])) x(tbl, statuses) loop
    execute format('create trigger trg_02_system_status before insert or update of status on public.%I
                    for each row execute function app.tg_system_statuses(%s)',
                   r.tbl, (select string_agg(quote_literal(s), ', ') from unnest(r.statuses) s));
  end loop;
end $$;

-- Manual journal entries and payments are saved atomically with their lines
insert into app.document_children values
  ('journal_entries', 'journal_lines',       'entry_id'),
  ('payments',        'payment_allocations', 'payment_id')
on conflict do nothing;

-- Clients create manual entries only; automatic ones come from posting functions
create or replace function app.tg_manual_entries_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  if app.is_client_context() and (new.is_automatic or (tg_op = 'INSERT' and new.reversal_of_id is not null)) then
    raise exception 'Automatic and reversal entries are created by the system' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_03_manual_only before insert or update of is_automatic, reversal_of_id on public.journal_entries
  for each row execute function app.tg_manual_entries_only();
