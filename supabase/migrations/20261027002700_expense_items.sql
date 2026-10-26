-- =============================================================================
-- Ready-made expense items: rent, electricity, water, phone, fuel, accounting… as services that are
-- bought, never sold, each in a category that books it on its expense account and with its usual
-- VAT. A purchase invoice line picks "Rryma" and the account and VAT come by themselves.
-- One click on the Expenses page; running it again adds only what is missing.
-- =============================================================================

create or replace function public.seed_expense_items(p_company uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare v_parent uuid; v_cat uuid; v_acc uuid; v_uom uuid; r record; n int := 0; v_country text; v_std numeric; v_low numeric;
begin
  perform app.require_permission(p_company, 'inventory.write');
  select country_code into v_country from public.companies where id = p_company;
  v_std := case when v_country = 'AL' then 20 else 18 end;
  v_low := case when v_country = 'AL' then 6 else 8 end;
  select id into v_uom from public.units_of_measure where company_id = p_company and code = 'pcs' limit 1;
  select id into v_parent from public.product_categories where company_id = p_company and code = 'SHP' and deleted_at is null;
  if v_parent is null then
    insert into public.product_categories (company_id, code, name) values (p_company, 'SHP', 'Shpenzimet') returning id into v_parent;
  end if;

  for r in select * from (values
    ('SHP-001', 'Shpenzimet e qirasë', 'rent', 'std'),
    ('SHP-002', 'Rryma', 'utilities', 'low'),
    ('SHP-003', 'Uji', 'utilities', 'low'),
    ('SHP-004', 'Ngrohja', 'utilities', 'std'),
    ('SHP-005', 'Interneti', 'telecom', 'std'),
    ('SHP-006', 'Telefoni', 'telecom', 'std'),
    ('SHP-007', 'Karburanti', 'fuel', 'std'),
    ('SHP-008', 'Pastrimi', 'supplies', 'std'),
    ('SHP-009', 'Materiali i zyrës', 'supplies', 'std'),
    ('SHP-010', 'Mirëmbajtja dhe riparimet', 'repairs', 'std'),
    ('SHP-011', 'Marketingu dhe reklamat', 'advertising', 'std'),
    ('SHP-012', 'Reprezentacioni', 'meals', 'std'),
    ('SHP-013', 'Udhëtimet zyrtare', 'transport', 'std'),
    ('SHP-014', 'Transporti', 'transport', 'std'),
    ('SHP-015', 'Shpedicioni', 'transport', 'std'),
    ('SHP-016', 'Shërbimet e kontabilitetit', 'professional', 'std'),
    ('SHP-017', 'Këshillimi dhe shërbimet ligjore', 'professional', 'std'),
    ('SHP-018', 'Mirëmbajtja e softuerit', 'professional', 'std'),
    ('SHP-019', 'Sigurimi i automjeteve', 'insurance', 'none'),
    ('SHP-020', 'Sigurimi i objekteve', 'insurance', 'none'),
    ('SHP-021', 'Regjistrimi i automjeteve', 'other', 'none'),
    ('SHP-022', 'Taksat komunale', 'other', 'none'),
    ('SHP-023', 'Komisionet bankare', 'bank_fees', 'none')) x(code, name, kind, vat)
  loop
    if exists (select 1 from public.products where company_id = p_company and code = r.code and deleted_at is null) then continue; end if;
    -- one category per expense account, under "Shpenzimet"
    select id into v_cat from public.product_categories where company_id = p_company and parent_id = v_parent and code = 'SHP-' || upper(r.kind) and deleted_at is null;
    if v_cat is null then
      v_acc := app.expense_account(p_company, r.kind);
      insert into public.product_categories (company_id, parent_id, code, name, expense_account_id)
      values (p_company, v_parent, 'SHP-' || upper(r.kind), case r.kind when 'rent' then 'Qiraja' when 'utilities' then 'Rryma, uji, ngrohja' when 'telecom' then 'Telefoni dhe interneti'
        when 'fuel' then 'Karburanti' when 'supplies' then 'Materiale dhe shërbime' when 'repairs' then 'Mirëmbajtja' when 'advertising' then 'Reklamat'
        when 'meals' then 'Reprezentacioni' when 'transport' then 'Transporti' when 'professional' then 'Shërbime profesionale' when 'insurance' then 'Sigurimet'
        when 'bank_fees' then 'Komisionet bankare' else 'Shpenzime të tjera' end, v_acc)
      returning id into v_cat;
    end if;
    perform public.create_product(jsonb_build_object('company_id', p_company, 'code', r.code, 'name', r.name, 'uom_id', v_uom, 'product_type', 'service',
      'category_id', v_cat, 'is_sellable', false, 'is_purchasable', true, 'sales_price', 0,
      'purchase_tax_code_id', app.purchase_tax(p_company, case r.vat when 'std' then v_std when 'low' then v_low else 0 end)));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.seed_expense_items(uuid) from public, anon;
grant execute on function public.seed_expense_items(uuid) to authenticated;
